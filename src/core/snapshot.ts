import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { ensureSnapshotDir, resolveSnapshotDir } from "./config.js";
import { fileSize, sha256File } from "./fileOps.js";
import { applyTags } from "./write.js";
import { readFileGrouped, type GroupedRead } from "./reader.js";

export const TOOL_VERSION = "0.1.0";

export interface Snapshot {
  version: string;
  createdAt: string;
  file: { path: string; sha256: string; size: number };
  tags: GroupedRead;
}

export function snapshotFileName(file: string, sha256: string, createdAt: string): string {
  const safeTime = createdAt.replace(/[:.]/g, "-");
  const short = sha256.slice(0, 12);
  return `${basename(file)}.${short}.${safeTime}.json`;
}

export async function saveSnapshot(
  file: string,
  dir?: string,
): Promise<{ path: string; snapshot: Snapshot }> {
  const tags = await readFileGrouped(file, false);
  const snapshot: Snapshot = {
    version: TOOL_VERSION,
    createdAt: new Date().toISOString(),
    file: { path: resolve(file), sha256: await sha256File(file), size: await fileSize(file) },
    tags,
  };
  const targetDir = await ensureSnapshotDir(dir ?? resolveSnapshotDir());
  const path = join(targetDir, snapshotFileName(file, snapshot.file.sha256, snapshot.createdAt));
  await writeFile(path, JSON.stringify(snapshot, null, 2));
  return { path, snapshot };
}

export async function listSnapshots(dir?: string): Promise<string[]> {
  try {
    const entries = await readdir(dir ?? resolveSnapshotDir());
    return entries.filter((entry) => entry.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

export async function showSnapshot(name: string, dir?: string): Promise<Snapshot> {
  const direct = resolve(name);
  const fromDir = resolve(join(dir ?? resolveSnapshotDir(), basename(name)));
  for (const candidate of [direct, fromDir]) {
    try {
      return JSON.parse(await readFile(candidate, "utf8")) as Snapshot;
    } catch {
      continue;
    }
  }
  throw new Error(`Snapshot not found: ${name}`);
}

function flattenGrouped(read: GroupedRead): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [group, tags] of Object.entries(read.groups)) {
    for (const [tag, value] of Object.entries(tags)) {
      flat[`${group}:${tag}`] = value;
    }
  }
  return flat;
}

const RESTORE_SKIP_GROUPS = new Set(["File", "Composite", "ExifTool", "System"]);

export async function restoreSnapshot(
  snapshot: Snapshot,
  output: string,
): Promise<{ written: string[]; skipped: { tag: string; reason: string }[] }> {
  const payload: Record<string, unknown> = {};
  for (const [group, tags] of Object.entries(snapshot.tags.groups)) {
    if (RESTORE_SKIP_GROUPS.has(group)) {
      continue;
    }
    for (const [tag, value] of Object.entries(tags)) {
      if (value === null || value === undefined) {
        continue;
      }
      payload[`${group}:${tag}`] = value;
    }
  }
  const { written, notWritten } = await applyTags(output, payload);
  return {
    written,
    skipped: notWritten.map((entry) => ({ tag: entry.tag, reason: entry.reason ?? "unknown" })),
  };
}

export interface DiffEntry {
  tag: string;
  before: string;
  after: string;
}

async function loadGrouped(target: string, dir?: string): Promise<GroupedRead> {
  if (target.toLowerCase().endsWith(".json")) {
    const snapshot = await showSnapshot(target, dir);
    return snapshot.tags;
  }
  return readFileGrouped(target, false);
}

export async function diffTargets(
  first: string,
  second: string,
  dir?: string,
): Promise<{ added: DiffEntry[]; removed: DiffEntry[]; changed: DiffEntry[] }> {
  const [groupA, groupB] = await Promise.all([loadGrouped(first, dir), loadGrouped(second, dir)]);
  const flatA = flattenGrouped(groupA);
  const flatB = flattenGrouped(groupB);
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const changed: DiffEntry[] = [];
  for (const [tag, valueB] of Object.entries(flatB)) {
    if (!(tag in flatA)) {
      added.push({ tag, before: "-", after: JSON.stringify(valueB) ?? "" });
    } else {
      const before = JSON.stringify(flatA[tag]);
      const after = JSON.stringify(valueB);
      if (before !== after) {
        changed.push({ tag, before: before ?? "", after: after ?? "" });
      }
    }
  }
  for (const [tag, valueA] of Object.entries(flatA)) {
    if (!(tag in flatB)) {
      removed.push({ tag, before: JSON.stringify(valueA) ?? "", after: "-" });
    }
  }
  const sort = (entries: DiffEntry[]): DiffEntry[] =>
    entries.sort((left, right) => left.tag.localeCompare(right.tag));
  return { added: sort(added), removed: sort(removed), changed: sort(changed) };
}
