import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { loadSharp, type SharpInstance } from "./sharpLoader.js";

export interface HashResult {
  file: string;
  sha256: string;
  md5: string;
  pixelSha256: string | null;
  ahash: string | null;
  dhash: string | null;
  phash: string | null;
  note: string | null;
}

export function hashStream(file: string, algorithm: string): Promise<string> {
  const hash = createHash(algorithm);
  return new Promise<string>((fulfill, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk as Buffer));
    stream.on("end", () => fulfill(hash.digest("hex")));
    stream.on("error", (error) => reject(error));
  });
}

async function grayPixels(
  sharp: (input: unknown) => SharpInstance,
  file: string,
  width: number,
  height: number,
): Promise<number[]> {
  const raw = await sharp(file).resize({ width, height, fit: "fill" }).raw().toBuffer();
  const channels = raw.length / (width * height);
  const gray: number[] = new Array<number>(width * height);
  for (let i = 0; i < width * height; i++) {
    const base = Math.floor(i * channels);
    if (channels >= 3) {
      gray[i] = 0.299 * raw[base]! + 0.587 * raw[base + 1]! + 0.114 * raw[base + 2]!;
    } else {
      gray[i] = raw[base]!;
    }
  }
  return gray;
}

function bitsToHex(bits: number[]): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i]! << 3) | (bits[i + 1]! << 2) | (bits[i + 2]! << 1) | bits[i + 3]!;
    hex += nibble.toString(16);
  }
  return hex;
}

function averageHash(gray: number[]): string {
  const mean = gray.reduce((sum, value) => sum + value, 0) / gray.length;
  return bitsToHex(gray.map((value) => (value > mean ? 1 : 0)));
}

function differenceHash(gray9x8: number[]): string {
  const bits: number[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      bits.push(gray9x8[row * 9 + col]! > gray9x8[row * 9 + col + 1]! ? 1 : 0);
    }
  }
  return bitsToHex(bits);
}

function dct1D(input: number[]): number[] {
  const n = input.length;
  const output = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += input[i]! * Math.cos(((2 * i + 1) * k * Math.PI) / (2 * n));
    }
    output[k] = sum * (k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n));
  }
  return output;
}

function dct2D(matrix: number[][], size: number): number[][] {
  const rows = matrix.map((row) => dct1D(row));
  const output: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let col = 0; col < size; col++) {
    const column = rows.map((row) => row[col]!);
    const transformed = dct1D(column);
    for (let row = 0; row < size; row++) {
      output[row]![col] = transformed[row]!;
    }
  }
  return output;
}

function perceptualHash(gray32: number[]): string {
  const matrix: number[][] = [];
  for (let row = 0; row < 32; row++) {
    matrix.push(gray32.slice(row * 32, row * 32 + 32));
  }
  const dct = dct2D(matrix, 32);
  const low: number[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (row === 0 && col === 0) {
        continue;
      }
      low.push(dct[row]![col]!);
    }
  }
  const mean = low.reduce((sum, value) => sum + value, 0) / low.length;
  const bits = low.map((value) => (value > mean ? 1 : 0));
  bits.unshift(dct[0]![0]! > mean ? 1 : 0);
  return bitsToHex(bits);
}

export async function hashFile(file: string): Promise<HashResult> {
  const [sha256, md5] = await Promise.all([hashStream(file, "sha256"), hashStream(file, "md5")]);
  const { sharp, message } = await loadSharp();
  if (!sharp) {
    return {
      file,
      sha256,
      md5,
      pixelSha256: null,
      ahash: null,
      dhash: null,
      phash: null,
      note: message,
    };
  }
  try {
    const factory = sharp as unknown as (input: unknown) => SharpInstance;
    const [pixel, tiny8, wide9, big32] = await Promise.all([
      factory(file).raw().toBuffer(),
      grayPixels(factory, file, 8, 8),
      grayPixels(factory, file, 9, 8),
      grayPixels(factory, file, 32, 32),
    ]);
    return {
      file,
      sha256,
      md5,
      pixelSha256: createHash("sha256").update(pixel).digest("hex"),
      ahash: averageHash(tiny8),
      dhash: differenceHash(wide9),
      phash: perceptualHash(big32),
      note: null,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      file,
      sha256,
      md5,
      pixelSha256: null,
      ahash: null,
      dhash: null,
      phash: null,
      note: `Pixel decode failed (${reason}); file hashes above are still valid.`,
    };
  }
}

export function hammingDistanceHex(first: string, second: string): number {
  if (first.length !== second.length) {
    throw new Error("Cannot compare hashes of different lengths.");
  }
  let distance = 0;
  for (let i = 0; i < first.length; i++) {
    let xor = parseInt(first[i]!, 16) ^ parseInt(second[i]!, 16);
    while (xor > 0) {
      distance += xor & 1;
      xor >>>= 1;
    }
  }
  return distance;
}

export function similarityVerdict(distance: number): string {
  if (distance === 0) {
    return "identical";
  }
  if (distance <= 5) {
    return "likely-same";
  }
  if (distance <= 10) {
    return "similar";
  }
  return "different";
}

export const HASH_SCOPE_NOTE =
  "Hashes are for integrity and duplicate detection only, NOT AI detection.";
