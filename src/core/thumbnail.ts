import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { getExifTool } from "./exiftool.js";

export interface ThumbnailResult {
  file: string;
  extracted: string[];
  skipped: string[];
}

function outputPath(sourceFile: string, kind: "thumb" | "preview", outDir?: string): string {
  const base = basename(sourceFile);
  const name = `${base}.${kind}.jpg`;
  if (outDir) {
    return resolve(join(outDir, name));
  }
  return resolve(join(dirname(resolve(sourceFile)), name));
}

export async function extractThumbnails(
  sourceFile: string,
  outDir?: string,
): Promise<ThumbnailResult> {
  const extracted: string[] = [];
  const skipped: string[] = [];
  const exiftool = await getExifTool();

  if (outDir) {
    await mkdir(outDir, { recursive: true });
  }

  const thumbPath = outputPath(sourceFile, "thumb", outDir);
  try {
    await exiftool.extractThumbnail(sourceFile, thumbPath);
    extracted.push(thumbPath);
  } catch {
    skipped.push(`no embedded thumbnail in ${sourceFile}`);
  }

  const previewPath = outputPath(sourceFile, "preview", outDir);
  try {
    await exiftool.extractPreview(sourceFile, previewPath);
    extracted.push(previewPath);
  } catch {
    skipped.push(`no embedded preview in ${sourceFile}`);
  }

  return { file: sourceFile, extracted, skipped };
}
