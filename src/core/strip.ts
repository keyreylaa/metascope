import { getExifTool } from "./exiftool.js";
import { loadSharp } from "./sharpLoader.js";
import { LOCATION_REMOVE_TAGS } from "./location.js";
import { readFileGrouped, type GroupedRead } from "./reader.js";
import { applyTags } from "./write.js";

export type StripMode = "all" | "privacy" | "gps" | "custom";

export interface StripOptions {
  mode: StripMode;
  tags?: string[];
  keep?: string[];
  verify?: boolean;
  reencode?: boolean;
  yes?: boolean;
}

export interface StripResult {
  output: string;
  warnings: string[];
  notes: string[];
  residuals: string[];
  clean: boolean | null;
}

export const SYNTHID_NOTE =
  "Note: stripping metadata does NOT remove invisible pixel watermarks (e.g. SynthID).";

export const CLEAN_NOTICE =
  "Metadata dibersihkan. Watermark tak kasat mata di dalam pixel (mis. SynthID) dan watermark visual TIDAK dihapus dan di luar scope tool ini.";

const KEEP_MAP: Record<string, string> = {
  icc: "ICC_Profile",
  orientation: "Orientation",
};

const PRIVACY_TAGS: Record<string, null> = {
  GPSLatitude: null,
  GPSLongitude: null,
  GPSAltitude: null,
  GPSDateStamp: null,
  GPSTimeStamp: null,
  GPSPosition: null,
  Artist: null,
  Copyright: null,
  "By-line": null,
  CopyrightNotice: null,
  Creator: null,
  Rights: null,
  Owner: null,
  Make: null,
  Model: null,
  LensMake: null,
  LensModel: null,
  LensInfo: null,
  LensID: null,
  SerialNumber: null,
  CameraSerialNumber: null,
  LensSerialNumber: null,
  Software: null,
  HostComputer: null,
  OwnerName: null,
  DateTimeOriginal: null,
  CreateDate: null,
  ModifyDate: null,
  ThumbnailImage: null,
  PreviewImage: null,
};

const GPS_TAGS: Record<string, null> = { ...LOCATION_REMOVE_TAGS, GPSPosition: null };

const SENSITIVE_GROUPS = [
  "exif",
  "iptc",
  "xmp",
  "gps",
  "makernotes",
  "photoshop",
  "jumbf",
  "c2pa",
  "icc_profile",
];

export function detectProvenance(read: GroupedRead): string[] {
  const hits: string[] = [];
  for (const [group, tags] of Object.entries(read.groups)) {
    const lower = group.toLowerCase();
    if (lower.includes("jumbf") || lower.includes("c2pa")) {
      hits.push(`${group} manifest present`);
    }
    for (const tag of Object.keys(tags)) {
      if (/c2pa|manifest|claim|digitalsourcetype|contentcredentials/i.test(tag)) {
        hits.push(`${group}:${tag}`);
      }
    }
  }
  return hits;
}

export function assertCleanConfirmed(read: GroupedRead, yes: boolean): void {
  if (yes === true) {
    return;
  }
  const provenance = detectProvenance(read);
  if (provenance.length > 0) {
    throw new Error(
      `Refusing to remove C2PA/AI provenance (${provenance.slice(0, 5).join(", ")}). ` +
        `This cannot be undone. Re-run with --yes to confirm.`,
    );
  }
}

function mapKeep(keep: string[] | undefined): string[] {
  const retain: string[] = [];
  for (const item of keep ?? []) {
    for (const part of item
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)) {
      const mapped = KEEP_MAP[part];
      if (mapped && !retain.includes(mapped)) {
        retain.push(mapped);
      }
    }
  }
  return retain;
}

export function collectResiduals(read: GroupedRead, keep: string[] | undefined): string[] {
  const kept = new Set(mapKeep(keep).map((entry) => entry.toLowerCase()));
  const residuals: string[] = [];
  for (const [group, tags] of Object.entries(read.groups)) {
    const lower = group.toLowerCase();
    if (!SENSITIVE_GROUPS.includes(lower)) {
      continue;
    }
    for (const tag of Object.keys(tags)) {
      if (kept.has(tag.toLowerCase()) || kept.has(`${group}:${tag}`.toLowerCase())) {
        continue;
      }
      residuals.push(`${group}:${tag}`);
    }
  }
  if (read.isPng) {
    for (const chunk of read.pngChunks) {
      if (["tEXt", "zTXt", "iTXt"].includes(chunk.type)) {
        residuals.push(`PNG chunk:${chunk.type}`);
      }
    }
  }
  return residuals.sort();
}

export async function stripFile(output: string, options: StripOptions): Promise<StripResult> {
  const warnings: string[] = [];
  const notes: string[] = [SYNTHID_NOTE];
  const exiftool = await getExifTool();
  const before = await readFileGrouped(output, false);
  const provenance = detectProvenance(before);
  if (provenance.length > 0) {
    const message =
      `Warning: removing C2PA/AI provenance data (${provenance.slice(0, 5).join(", ")}). ` +
      `This cannot be undone from the stripped copy.`;
    if (options.yes !== true) {
      warnings.push(`${message} (pass --yes to skip this warning)`);
    }
  }

  if (options.mode === "all") {
    const retain = mapKeep(options.keep);
    await exiftool.deleteAllTags(output, retain.length > 0 ? { retain } : undefined);
  } else if (options.mode === "gps") {
    await applyTags(output, GPS_TAGS);
  } else if (options.mode === "privacy") {
    const payload = { ...PRIVACY_TAGS };
    for (const kept of mapKeep(options.keep)) {
      delete payload[kept];
    }
    await applyTags(output, payload);
  } else {
    if (!options.tags || options.tags.length === 0) {
      throw new Error('Custom strip mode requires --tags TAG (repeatable, e.g. --tags "GPS:all").');
    }
    const payload: Record<string, null> = {};
    for (const tag of options.tags) {
      payload[tag] = null;
    }
    await applyTags(output, payload);
  }

  if (options.reencode === true) {
    warnings.push(
      "Warning: --reencode re-encodes pixels; quality loss is possible on lossy formats.",
    );
    const { sharp, message } = await loadSharp();
    if (!sharp) {
      throw new Error(`Cannot --reencode: ${message}`);
    }
    const temp = `${output}.reencode.tmp`;
    const { copyFile, rename } = await import("node:fs/promises");
    await copyFile(output, temp);
    try {
      const lower = output.toLowerCase();
      let pipeline = sharp(temp);
      if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
        pipeline = pipeline.jpeg({ quality: 92 });
      } else if (lower.endsWith(".png")) {
        pipeline = pipeline.png();
      } else if (lower.endsWith(".webp")) {
        pipeline = pipeline.webp({ quality: 92 });
      }
      await pipeline.toFile(`${temp}.out`);
      await rename(`${temp}.out`, output);
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(temp, { force: true });
      await rm(`${temp}.out`, { force: true });
    }
  }

  let residuals: string[] = [];
  let clean: boolean | null = null;
  if (options.verify === true) {
    const after = await readFileGrouped(output, false);
    residuals = collectResiduals(after, options.keep);
    clean = residuals.length === 0;
  }
  return { output, warnings, notes, residuals, clean };
}
