import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { aiCheck, AI_DISCLAIMER } from "../core/aiCheck.js";
import { HASH_SCOPE_NOTE, hammingDistanceHex, hashFile, similarityVerdict } from "../core/hash.js";
import { channelSummary } from "./redact.js";
import { readFileGrouped } from "../core/reader.js";
import { renderJson, renderMarkdown, summarize } from "../core/report.js";
import { scanBuffer } from "../core/scan.js";
import { prepareOutput } from "../core/fileOps.js";
import { removeGps } from "../core/gps.js";
import { privacyScan } from "../core/privacy.js";
import { CLEAN_NOTICE, detectProvenance, stripFile } from "../core/strip.js";
import { applyTags } from "../core/write.js";
import { TOOL_VERSION } from "../core/snapshot.js";

export interface OutFile {
  name: string;
  buffer: Buffer;
}

export interface RunResult {
  channelText: string;
  dmText: string;
  files: OutFile[];
}

async function withTempFile(
  buffer: Buffer,
  filename: string,
  task: (input: string, dir: string) => Promise<Omit<RunResult, "files"> & { paths: string[] }>,
): Promise<RunResult> {
  const dir = await mkdtemp(join(tmpdir(), "metascope-discord-"));
  const safeName = basename(filename) || "upload.bin";
  const input = join(dir, safeName);
  try {
    await writeFile(input, buffer);
    const partial = await task(input, dir);
    const files: OutFile[] = [];
    for (const path of partial.paths) {
      files.push({ name: basename(path), buffer: await readFile(path) });
    }
    return { channelText: partial.channelText, dmText: partial.dmText, files };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runScan(buffer: Buffer, filename: string): Promise<RunResult> {
  const single = await scanBuffer(buffer, filename, {});
  const report = {
    tool: "metascope",
    version: TOOL_VERSION,
    createdAt: new Date().toISOString(),
    root: filename,
    summary: summarize([single]),
    files: [single],
  };
  return {
    channelText: channelSummary(report),
    dmText: `Full scan report for ${filename} is attached.\n${AI_DISCLAIMER}`,
    files: [
      { name: "report.json", buffer: Buffer.from(renderJson(report), "utf8") },
      { name: "report.md", buffer: Buffer.from(renderMarkdown(report), "utf8") },
    ],
  };
}

export async function runRead(buffer: Buffer, filename: string): Promise<RunResult> {
  return withTempFile(buffer, filename, async (input, dir) => {
    const read = await readFileGrouped(input, false);
    const sidecar = join(dir, "read.json");
    await writeFile(
      sidecar,
      JSON.stringify({ file: filename, groups: read.groups, pngChunks: read.pngChunks }, null, 2),
    );
    const namespaces = Object.keys(read.groups).sort().join(", ");
    return {
      channelText: `Metadata namespaces for ${filename}: [${namespaces}]. Full dump attached privately.`,
      dmText: `Full metadata dump for ${filename} is attached.`,
      paths: [sidecar],
    };
  });
}

export async function runHash(
  buffer: Buffer,
  filename: string,
  compare?: Buffer,
): Promise<RunResult> {
  return withTempFile(buffer, filename, async (input, dir) => {
    const first = await hashFile(input);
    const lines = [
      `sha256=${first.sha256}`,
      `md5=${first.md5}`,
      `pixel=${first.pixelSha256 ?? "(unavailable)"}`,
      `ahash=${first.ahash ?? "-"} dhash=${first.dhash ?? "-"} phash=${first.phash ?? "-"}`,
    ];
    if (first.note) {
      lines.push(`note: ${first.note}`);
    }
    if (compare) {
      const otherPath = join(dir, "other.bin");
      await writeFile(otherPath, compare);
      const second = await hashFile(otherPath);
      for (const algo of ["ahash", "dhash", "phash"] as const) {
        if (first[algo] && second[algo]) {
          const distance = hammingDistanceHex(first[algo] as string, second[algo] as string);
          lines.push(`${algo}: distance=${distance} (${similarityVerdict(distance)})`);
        }
      }
    }
    lines.push(HASH_SCOPE_NOTE);
    const detail = lines.join("\n");
    return {
      channelText: `Hashes for ${filename}:\n${detail}`,
      dmText: `Hashes for ${filename}:\n${detail}`,
      paths: [],
    };
  });
}

export async function runAi(buffer: Buffer, filename: string): Promise<RunResult> {
  return withTempFile(buffer, filename, async (input) => {
    const read = await readFileGrouped(input, false);
    const result = await aiCheck(input, read.groups);
    const counts = new Map<string, number>();
    for (const item of result.evidence) {
      counts.set(item.confidence, (counts.get(item.confidence) ?? 0) + 1);
    }
    return {
      channelText:
        `AI provenance for ${filename}: verdict=${result.verdict} ` +
        `(evidence: ${[...counts.entries()].map(([level, count]) => `${level}=${count}`).join(", ") || "none"}). ` +
        `Full evidence sent privately.`,
      dmText:
        `AI provenance for ${filename}: verdict=${result.verdict}\n` +
        result.evidence
          .map((item) => `[${item.confidence}] ${item.signal} (${item.source})`)
          .join("\n") +
        `\n${AI_DISCLAIMER}`,
      paths: [],
    };
  });
}

export async function runStrip(buffer: Buffer, filename: string): Promise<RunResult> {
  return withTempFile(buffer, filename, async (input, dir) => {
    const outDir = join(dir, "out");
    await mkdir(outDir, { recursive: true });
    const target = await prepareOutput(input, outDir, undefined, false, "_clean");
    const result = await stripFile(target.output, { mode: "all", verify: true, yes: true });
    const verdict =
      result.residuals.length === 0
        ? "verified clean"
        : `${result.residuals.length} residual(s): ${result.residuals.join(", ")}`;
    return {
      channelText: `Stripped ${filename}: ${verdict}. Cleaned file attached. ${result.notes.join(" ")}`,
      dmText: `Stripped ${filename}: ${verdict}.`,
      paths: [target.output],
    };
  });
}

export async function runEdit(
  buffer: Buffer,
  filename: string,
  tags: Record<string, string>,
): Promise<RunResult> {
  return withTempFile(buffer, filename, async (input, dir) => {
    const outDir = join(dir, "out");
    await mkdir(outDir, { recursive: true });
    const target = await prepareOutput(input, outDir, undefined, false, "_edited");
    const { written, notWritten } = await applyTags(target.output, tags);
    return {
      channelText:
        `Edited ${filename}: ${written.length} tag(s) written` +
        (notWritten.length > 0 ? `, ${notWritten.length} skipped (details privately)` : "") +
        `. Edited file attached.`,
      dmText:
        `Edited ${filename}:\n` +
        written.map((tag) => `ok: ${tag}`).join("\n") +
        notWritten.map((entry) => `skip: ${entry.tag} (${entry.reason ?? "?"})`).join("\n"),
      paths: [target.output],
    };
  });
}

export async function runPrivacy(buffer: Buffer, filename: string): Promise<RunResult> {
  return withTempFile(buffer, filename, async (input) => {
    const read = await readFileGrouped(input, false);
    const result = await privacyScan(input, read.groups);
    const counts = new Map<string, number>();
    for (const finding of result.findings) {
      const key = `${finding.severity}/${finding.category}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const summary =
      [...counts.entries()].map(([key, count]) => `${key}=${count}`).join(", ") || "no findings";
    return {
      channelText: `Privacy scan for ${filename}: ${summary}. Full report sent privately.`,
      dmText:
        `Privacy scan for ${filename}:\n` +
        (result.findings
          .map((finding) => `[${finding.severity}] ${finding.category}: ${finding.detail}`)
          .join("\n") || "No privacy findings.") +
        `\nSuggested: ${result.suggestedCommand}`,
      paths: [],
    };
  });
}

export async function runClean(
  buffer: Buffer,
  filename: string,
  confirmed: boolean,
): Promise<RunResult> {
  return withTempFile(buffer, filename, async (input, dir) => {
    const read = await readFileGrouped(input, false);
    const provenance = detectProvenance(read);
    if (provenance.length > 0 && confirmed !== true) {
      throw new Error(
        `Refusing to remove C2PA/AI provenance (${provenance.slice(0, 5).join(", ")}). Confirm first.`,
      );
    }
    const outDir = join(dir, "out");
    await mkdir(outDir, { recursive: true });
    const target = await prepareOutput(input, outDir, undefined, false, "_clean");
    const result = await stripFile(target.output, { mode: "all", verify: true, yes: true });
    const now = new Date();
    await utimes(target.output, now, now);
    const verdict =
      result.residuals.length === 0
        ? "verified clean"
        : `${result.residuals.length} residual(s): ${result.residuals.join(", ")}`;
    return {
      channelText: `Cleaned ${filename}: ${verdict}. Cleaned file attached. ${CLEAN_NOTICE}`,
      dmText: `Cleaned ${filename}: ${verdict}.`,
      paths: [target.output],
    };
  });
}

export async function runGpsRemove(buffer: Buffer, filename: string): Promise<RunResult> {
  return withTempFile(buffer, filename, async (input, dir) => {
    const outDir = join(dir, "out");
    await mkdir(outDir, { recursive: true });
    const target = await prepareOutput(input, outDir, undefined, false, "_edited");
    const result = await removeGps(target.output);
    const verdict =
      result.residual.length === 0
        ? "no location fields remain (verified on re-read)"
        : `residual: ${result.residual.join(", ")}`;
    return {
      channelText: `GPS removed for ${filename}: ${result.removed.length} tag(s) cleared, ${verdict}.`,
      dmText:
        `GPS removed for ${filename}:\n` +
        `cleared: ${result.removed.join(", ") || "(none)"}\n` +
        `residual: ${result.residual.join(", ") || "(none)"}`,
      paths: [],
    };
  });
}
