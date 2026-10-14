export type DetectedFormat =
  | "jpeg"
  | "png"
  | "webp"
  | "gif"
  | "tiff"
  | "heic"
  | "heif"
  | "avif"
  | "mp4"
  | "mov"
  | "iso-media"
  | "cr2"
  | "unknown";

export interface MagicResult {
  format: DetectedFormat;
  brand?: string;
}

function ascii(buffer: Buffer, start: number, length: number): string {
  return buffer.subarray(start, start + length).toString("ascii");
}

export function detectFormat(buffer: Buffer): MagicResult {
  if (buffer.length < 4) {
    return { format: "unknown" };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { format: "jpeg" };
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { format: "png" };
  }
  if (
    buffer.length >= 6 &&
    (ascii(buffer, 0, 6) === "GIF87a" || ascii(buffer, 0, 6) === "GIF89a")
  ) {
    return { format: "gif" };
  }
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a) ||
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2b && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2b)
  ) {
    if (buffer.length >= 10 && ascii(buffer, 8, 2) === "CR") {
      return { format: "cr2" };
    }
    return { format: "tiff" };
  }
  if (buffer.length >= 12 && ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 4) === "WEBP") {
    return { format: "webp" };
  }
  if (buffer.length >= 12 && ascii(buffer, 4, 4) === "ftyp") {
    const brand = ascii(buffer, 8, 4);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"].includes(brand)) {
      return { format: "heic", brand };
    }
    if (["mif1", "msf1"].includes(brand)) {
      return { format: "heif", brand };
    }
    if (["avif", "avis"].includes(brand)) {
      return { format: "avif", brand };
    }
    if (brand === "qt") {
      return { format: "mov", brand };
    }
    if (brand === "isom") {
      return { format: "mp4", brand };
    }
    return { format: "iso-media", brand };
  }
  return { format: "unknown" };
}

export function isSupportedContainer(format: DetectedFormat): boolean {
  return format !== "unknown";
}
