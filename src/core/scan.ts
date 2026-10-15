import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { aiCheck, getDefaultDetectors } from "./aiCheck.js";
import { DEFAULT_CONCURRENCY } from "./config.js";
import { Detector } from "./aiCheck.js";
import { getExifTool } from "./exiftool.js";
import { hashFile } from "./hash.js";
import { detectFormat } from "./magic.js";
import { privacyScan } from "./privacy.js";
import { groupTags } from "./reader.js";
import { emptySummary, summarize, type FileReport, type ScanReport } from "./report.js";
import { expandScanInputs, filterByExt } from "./walk.js";
import { TOOL_VERSION } from "./snapshot.js";

export interface ScanFileOptions {
  noHash?: boolean;
  noML?: boolean;
}

export interface ScanInputsOptions extends ScanFileOptions {
  depth?: number;
  ext?: string[];
  followSymlinks?: boolean;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

const SUBSTANTIVE_GROUPS = [
  "exif",
  "iptc",
  "xmp",
  "gps",
  "makernotes",
  "photoshop",
  "jumbf",
  "png",
];

function hasSubstance(groups: Record<string, Record<string, unknown>>): boolean {
  return Object.entries(groups).some(
    ([group, tags]) =>
      SUBSTANTIVE_GROUPS.includes(group.toLowerCase()) && Object.keys(tags).length > 0,
  );
}

async function magicOf(file: string): Promise<{ format: string } | { error: string }> {
  let handle;
  try {
    handle = await open(file, "r");
    const buffer = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buffer, 0, 64, 0);
    return { format: detectFormat(buffer.subarray(0, bytesRead)).format };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    await handle?.close();
  }
}

export async function scanOneFile(
  file: string,
  options: ScanFileOptions,
  extraDetectors: Detector[] = [],
): Promise<FileReport> {
  const absolute = resolve(file);
  const base: FileReport = {
    file: absolute,
    format: "unknown",
    sha256: null,
    md5: null,
    pixelSha256: null,
    ahash: null,
    dhash: null,
    phash: null,
    hashesNote: null,
    groups: null,
    pngChunks: [],
    errors: [],
    privacy: [],
    aiVerdict: "no_evidence",
    aiEvidence: [],
    scanError: null,
  };
  const magic = await magicOf(absolute);
  if ("error" in magic) {
    base.scanError = `Cannot open file: ${magic.error}`;
    return base;
  }
  base.format = magic.format;
  const hashes = await hashFile(absolute).catch((error: unknown) => ({
    file: absolute,
    sha256: null as string | null,
    md5: null as string | null,
    pixelSha256: null as string | null,
    ahash: null as string | null,
    dhash: null as string | null,
    phash: null as string | null,
    note: error instanceof Error ? error.message : String(error),
  }));
  base.sha256 = hashes.sha256;
  base.md5 = hashes.md5;
  base.hashesNote = hashes.note;
  if (options.noHash === true) {
    base.hashesNote = [base.hashesNote, "Perceptual hashing skipped (--no-hash)."]
      .filter(Boolean)
      .join(" ");
  } else {
    base.pixelSha256 = hashes.pixelSha256;
    base.ahash = hashes.ahash;
    base.dhash = hashes.dhash;
    base.phash = hashes.phash;
  }
  try {
    const exiftool = await getExifTool();
    const flat = (await exiftool.read(absolute, { groupNames: true })) as unknown as Record<
      string,
      unknown
    >;
    const grouped = groupTags(absolute, flat);
    base.groups = grouped.groups;
    base.pngChunks = grouped.pngChunks;
    base.errors.push(...grouped.errors);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    base.scanError = `Unreadable (${base.format}): ${message.slice(0, 200)}`;
    return base;
  }
  const groups = base.groups;
  if (!groups) {
    base.scanError = "Unreadable: metadata parse produced no result.";
    return base;
  }
  if (base.format === "unknown" && !hasSubstance(groups)) {
    base.scanError = "Unsupported or corrupt: magic bytes do not match a known image/video format.";
    return base;
  }
  base.privacy = (await privacyScan(absolute, groups)).findings;
  const detectors = [...getDefaultDetectors(), ...extraDetectors];
  const ai = await aiCheck(absolute, groups, detectors);
  base.aiVerdict = ai.verdict;
  base.aiEvidence = ai.evidence;
  return base;
}

export async function scanBuffer(
  buffer: Buffer,
  filenameHint: string,
  options: ScanFileOptions,
  extraDetectors: Detector[] = [],
): Promise<FileReport> {
  const dir = await mkdtemp(join(tmpdir(), "metascope-scan-"));
  const target = join(dir, basename(filenameHint) || "upload.bin");
  try {
    await writeFile(target, buffer);
    return await scanOneFile(target, options, extraDetectors);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function scanInputs(
  inputs: string[],
  options: ScanInputsOptions,
  extraDetectors: Detector[] = [],
): Promise<ScanReport> {
  const roots = inputs.length > 0 ? inputs : [process.cwd()];
  const expanded = await expandScanInputs(roots, {
    depth: options.depth,
    ext: undefined,
    followSymlinks: options.followSymlinks,
  });
  const files = filterByExt([...new Set(expanded)].sort(), options.ext);
  const concurrency = Math.max(1, Math.min(32, options.concurrency ?? DEFAULT_CONCURRENCY));
  const results: FileReport[] = new Array<FileReport>(files.length);
  let done = 0;
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, files.length)) },
    async () => {
      while (cursor < files.length) {
        const index = cursor++;
        results[index] = await scanOneFile(
          files[index]!,
          {
            noHash: options.noHash,
            noML: options.noML,
          },
          extraDetectors,
        );
        done += 1;
        options.onProgress?.(done, files.length);
      }
    },
  );
  await Promise.all(workers);
  return {
    tool: "metascope",
    version: TOOL_VERSION,
    createdAt: new Date().toISOString(),
    root: resolve(roots[0]!),
    summary: files.length > 0 ? summarize(results) : emptySummary(),
    files: results,
  };
}
