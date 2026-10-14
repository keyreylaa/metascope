import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { getExifTool } from "../src/core/exiftool.js";
import { scanPngChunks } from "../src/core/pngChunks.js";
import { crc32 } from "../src/core/pngText.js";
import { loadSharp } from "../src/core/sharpLoader.js";

const RUN_ROOT = join(process.cwd(), "test-tmp", `run-${process.pid}`);

/**
 * Per-process fixture root. Deterministic `test-tmp/<name>` paths let two
 * concurrent `npm test` runs `rm -rf` each other's fixtures mid-write, so every
 * path is namespaced by the owning process id instead.
 */
export function testTmp(name: string): string {
  return join(RUN_ROOT, name);
}

export interface Fixtures {
  dir: string;
  jpeg: string;
  png: string;
}

export interface LoadedFixtures extends Fixtures {
  corrupt: string;
  text: string;
}

export async function ensureFixtures(dir?: string): Promise<Fixtures> {
  const outDir = resolve(dir ?? testTmp("fixtures"));
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const { sharp, message } = await loadSharp();
  if (!sharp) {
    throw new Error(`Cannot generate fixtures: ${message}`);
  }

  const jpeg = join(outDir, "fixture.jpg");
  await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .jpeg({ quality: 90 })
    .toFile(jpeg);

  const png = join(outDir, "fixture.png");
  await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 30, g: 60, b: 200 } },
  })
    .png()
    .toFile(png);

  const exiftool = await getExifTool();
  await exiftool.write(jpeg, {
    Artist: "Metascope Test",
    Copyright: "Metascope Fixture",
    ImageDescription: "jpeg fixture",
  });
  await exiftool.write(png, {
    Title: "png fixture",
    ImageDescription: "png fixture",
  });

  return { dir: outDir, jpeg, png };
}

export async function ensureLoadedFixtures(dir?: string): Promise<LoadedFixtures> {
  const outDir = resolve(dir ?? testTmp("loaded"));
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const { sharp, message } = await loadSharp();
  if (!sharp) {
    throw new Error(`Cannot generate fixtures: ${message}`);
  }

  const jpeg = join(outDir, "loaded.jpg");
  await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .jpeg({ quality: 90 })
    .toFile(jpeg);

  const png = join(outDir, "loaded.png");
  await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 30, g: 60, b: 200 } },
  })
    .png()
    .toFile(png);

  const exiftool = await getExifTool();
  await exiftool.write(jpeg, {
    Artist: "Loaded Owner",
    Copyright: "Loaded Notice",
    ImageDescription: "loaded fixture",
    Make: "MetascopeCam",
    Model: "MS-1",
  });
  await exiftool.write(jpeg, { GPSLatitude: -6.2, GPSLongitude: 106.8 });
  await exiftool.write(jpeg, {
    "By-line": "Loaded Owner",
    CopyrightNotice: "Loaded Notice",
    Creator: "Loaded Owner",
    Rights: "Loaded Notice",
    Title: "loaded title",
    AllDates: "2024:01:02 03:04:05",
  });
  await exiftool.write(png, {
    Title: "loaded png title",
    ImageDescription: "loaded png desc",
    Artist: "Loaded Owner",
  });
  await exiftool.write(png, { GPSLatitude: -6.2, GPSLongitude: 106.8 });

  await appendFile(jpeg, Buffer.from("TRAILING_JUNK_JPEG"));
  await appendFile(png, Buffer.from("TRAILING_JUNK_PNG"));

  const corrupt = join(outDir, "corrupt.jpg");
  await writeFile(corrupt, Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0x00, 0x11, 0x22]));
  const text = join(outDir, "note.txt");
  await writeFile(text, "plain text, not an image");

  const { readdir, unlink } = await import("node:fs/promises");
  for (const entry of await readdir(outDir)) {
    if (entry.endsWith("_original")) {
      await unlink(join(outDir, entry));
    }
  }

  return { dir: outDir, jpeg, png, corrupt, text };
}

export function injectPngTextChunk(png: Uint8Array, keyword: string, text: string): Buffer {
  const input = Buffer.from(png);
  const scan = scanPngChunks(input);
  if (!scan.chunks.length) {
    throw new Error("No PNG chunks found; refusing to inject.");
  }
  const iend = scan.chunks[scan.chunks.length - 1]!;
  const keywordBytes = Buffer.from(keyword, "latin1");
  const textBytes = Buffer.from(text, "latin1");
  const data = Buffer.concat([keywordBytes, Buffer.from([0]), textBytes]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write("tEXt", 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(Buffer.concat([Buffer.from("tEXt", "ascii"), data]), 0, 4 + data.length),
    8 + data.length,
  );
  return Buffer.concat([input.subarray(0, iend.offset), chunk, input.subarray(iend.offset)]);
}

export function buildCompressedTextChunk(keyword: string, text: string): Buffer {
  const compressed = deflateSync(Buffer.from(text, "utf8"));
  const data = Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0, 0]), compressed]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write("zTXt", 4, "ascii");
  data.copy(chunk, 8);
  const typeAndData = Buffer.concat([Buffer.from("zTXt", "ascii"), data]);
  chunk.writeUInt32BE(crc32(typeAndData, 0, typeAndData.length), 8 + data.length);
  return chunk;
}

export interface Phase3Fixtures {
  dir: string;
  a1111: string;
  comfy: string;
  aiXmp: string;
  camera: string;
  midjourney: string;
  plainWebp: string;
  corrupt: string;
  fakeJpg: string;
}

export interface LocationFixtures {
  dir: string;
  located: string;
}

export async function ensureLocationFixtures(dir?: string): Promise<LocationFixtures> {
  const outDir = resolve(dir ?? testTmp("location"));
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const { sharp, message } = await loadSharp();
  if (!sharp) {
    throw new Error(`Cannot generate fixtures: ${message}`);
  }
  const located = join(outDir, "located.jpg");
  await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 120, b: 60 } },
  })
    .jpeg({ quality: 90 })
    .toFile(located);

  const exiftool = await getExifTool();
  await exiftool.write(located, { GPSLatitude: -6.2, GPSLongitude: 106.8 });
  // Prefixed writes land in their own groups (proven live, zero warnings).
  await exiftool.write(located, {
    "XMP:GPSLatitude": -6.2,
    "XMP:GPSLongitude": 106.8,
    "XMP:LocationShownCity": "Jakarta",
    "IPTC:City": "Jakarta",
    "IPTC:Province-State": "DKI Jakarta",
    "IPTC:Country-PrimaryLocationName": "Indonesia",
  } as unknown as { Artist: string });

  const { readdir, unlink } = await import("node:fs/promises");
  for (const entry of await readdir(outDir)) {
    if (entry.endsWith("_original")) {
      await unlink(join(outDir, entry));
    }
  }
  return { dir: outDir, located };
}

export const A1111_PARAMETERS = [
  "a cat sitting on a mat, highly detailed",
  "Negative prompt: blurry, watermark, text",
  "Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 123456, Size: 512x512, Model hash: ab12cd34, Model: realisticVisionV51",
].join("\n");

export async function ensurePhase3Fixtures(dir?: string): Promise<Phase3Fixtures> {
  const outDir = resolve(dir ?? testTmp("phase3"));
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const { sharp, message } = await loadSharp();
  if (!sharp) {
    throw new Error(`Cannot generate fixtures: ${message}`);
  }
  const paint = async (
    target: string,
    color: { r: number; g: number; b: number },
    format: "png" | "jpeg" | "webp",
  ): Promise<void> => {
    const base = sharp({
      create: { width: 32, height: 32, channels: 3, background: color },
    });
    if (format === "png") {
      await base.png().toFile(target);
    } else if (format === "webp") {
      await base.webp().toFile(target);
    } else {
      await base.jpeg({ quality: 90 }).toFile(target);
    }
  };

  const exiftool = await getExifTool();
  // WriteTags is documented as non-comprehensive; these tag names are validated
  // at runtime by validateTagName and proven by live ExifTool round-trips.
  const writeRaw = async (file: string, tags: Record<string, string>): Promise<void> => {
    await exiftool.write(file, tags as unknown as { Artist: string });
  };
  const a1111 = join(outDir, "a1111.png");
  await paint(a1111, { r: 120, g: 40, b: 200 }, "png");
  await writeRaw(a1111, { Parameters: A1111_PARAMETERS });

  const comfy = join(outDir, "comfy.png");
  await paint(comfy, { r: 40, g: 160, b: 90 }, "png");
  const { readFile } = await import("node:fs/promises");
  const comfyPrompt = JSON.stringify({
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "a dog in space" } },
  });
  const comfyWorkflow = JSON.stringify({ last_node_id: 2, last_link_id: 1, nodes: [], links: [] });
  let comfyBytes: Uint8Array = await readFile(comfy);
  comfyBytes = injectPngTextChunk(comfyBytes, "prompt", comfyPrompt);
  comfyBytes = injectPngTextChunk(comfyBytes, "workflow", comfyWorkflow);
  await writeFile(comfy, comfyBytes);

  const aiXmp = join(outDir, "ai-xmp.jpg");
  await paint(aiXmp, { r: 200, g: 120, b: 30 }, "jpeg");
  await writeRaw(aiXmp, {
    DigitalSourceType: "http://cv.iptc.org/newscodes/c2pa/trainedAlgorithmicMedia",
    Title: "synthetic test image",
  });

  const camera = join(outDir, "camera.jpg");
  await paint(camera, { r: 30, g: 90, b: 160 }, "jpeg");
  await exiftool.write(camera, {
    Make: "FakeCam",
    Model: "FC-1000",
    LensModel: "FC 24-70mm",
    SerialNumber: "SN-000-1234",
    AllDates: "2024:06:07 08:09:10",
  });
  await exiftool.write(camera, { GPSLatitude: 51.5, GPSLongitude: -0.12 });

  const midjourney = join(outDir, "midjourney.jpg");
  await paint(midjourney, { r: 90, g: 30, b: 120 }, "jpeg");
  await exiftool.write(midjourney, {
    Software: "Midjourney v6",
    ImageDescription: "a castle on a hill --ar 16:9 --v 6.0",
  });

  const plainWebp = join(outDir, "plain.webp");
  await paint(plainWebp, { r: 60, g: 60, b: 60 }, "webp");

  const corrupt = join(outDir, "corrupt.jpg");
  await writeFile(corrupt, Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0x00, 0x11, 0x22]));
  const fakeJpg = join(outDir, "renamed.jpg");
  await writeFile(fakeJpg, "plain text pretending to be a jpeg");

  const { readdir, unlink } = await import("node:fs/promises");
  for (const entry of await readdir(outDir)) {
    if (entry.endsWith("_original")) {
      await unlink(join(outDir, entry));
    }
  }

  return { dir: outDir, a1111, comfy, aiXmp, camera, midjourney, plainWebp, corrupt, fakeJpg };
}
