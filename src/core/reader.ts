import { readFile, stat } from "node:fs/promises";
import { getExifTool } from "./exiftool.js";
import { scanPngChunks, type PngChunk } from "./pngChunks.js";

export interface GroupedRead {
  file: string;
  groups: Record<string, Record<string, unknown>>;
  pngChunks: PngChunk[];
  isPng: boolean;
  errors: string[];
  warnings: string[];
}

const BARE_GPS_KEYS = new Set(["GPSLatitude", "GPSLatitudeRef", "GPSLongitude", "GPSLongitudeRef"]);

function toDisplayValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "object" && value !== null && "toString" in value) {
    try {
      const text = (value as { toString(): string }).toString();
      if (typeof text === "string" && text.length > 0 && text !== "[object Object]") {
        return text;
      }
    } catch {
      return String(value);
    }
  }
  return value;
}

export function groupTags(sourceFile: string, flat: Record<string, unknown>): GroupedRead {
  const groups: Record<string, Record<string, unknown>> = {};
  const errors: string[] = [];
  const warnings: string[] = [];

  const put = (group: string, key: string, value: unknown): void => {
    if (!groups[group]) {
      groups[group] = {};
    }
    groups[group][key] = toDisplayValue(value);
  };

  for (const [key, value] of Object.entries(flat)) {
    if (key === "errors" && Array.isArray(value)) {
      errors.push(...value.map((entry) => String(entry)));
      continue;
    }
    if (key === "warnings" && Array.isArray(value)) {
      warnings.push(...value.map((entry) => String(entry)));
      continue;
    }
    const separator = key.indexOf(":");
    if (separator <= 0) {
      if (key === "SourceFile") {
        put("File", "SourceFile", sourceFile);
      } else if (BARE_GPS_KEYS.has(key)) {
        put("GPS", key, value);
      } else {
        put("System", key, value);
      }
      continue;
    }
    const group = key.slice(0, separator);
    const tag = key.slice(separator + 1);
    put(group, tag, value);
  }

  if (!groups["File"]) {
    groups["File"] = {};
  }
  if (!groups["File"]["SourceFile"]) {
    groups["File"]["SourceFile"] = sourceFile;
  }

  return { file: sourceFile, groups, pngChunks: [], isPng: false, errors, warnings };
}

export async function readFileGrouped(file: string, raw: boolean): Promise<GroupedRead> {
  const exiftool = await getExifTool();
  const flat = raw
    ? ((await exiftool.read(file, { groupNames: true, numericTags: ["*"] })) as unknown as Record<
        string,
        unknown
      >)
    : ((await exiftool.read(file, { groupNames: true })) as unknown as Record<string, unknown>);
  const grouped = groupTags(file, flat);

  if (file.toLowerCase().endsWith(".png")) {
    try {
      const info = await stat(file);
      if (info.size <= 50_000_000) {
        const buffer = await readFile(file);
        const scan = scanPngChunks(buffer);
        grouped.isPng = scan.isPng;
        grouped.pngChunks = scan.chunks;
      }
    } catch {
      grouped.isPng = false;
    }
  }
  return grouped;
}
