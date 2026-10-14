import { prepareOutput } from "./fileOps.js";
import { stripFile, type StripMode } from "./strip.js";
import { applyTags, parseSetPairs } from "./write.js";
import { expandScanInputs, filterByExt } from "./walk.js";

export interface BatchItemResult {
  file: string;
  status: "ok" | "dry-run" | "skipped" | "error";
  detail: string;
  output: string | null;
}

export interface BatchStripOptions {
  mode: StripMode;
  tags?: string[];
  keep?: string[];
  verify?: boolean;
  reencode?: boolean;
  yes?: boolean;
  out?: string;
  inPlace?: boolean;
  dryRun?: boolean;
  concurrency?: number;
  ext?: string[];
}

export interface BatchWriteOptions {
  set: string[];
  out?: string;
  inPlace?: boolean;
  dryRun?: boolean;
  concurrency?: number;
  ext?: string[];
}

async function pool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(32, concurrency));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++]!;
        await worker(item);
      }
    }),
  );
}

export async function runBatchStrip(
  inputs: string[],
  options: BatchStripOptions,
): Promise<BatchItemResult[]> {
  const expanded = await expandScanInputs(inputs, {});
  const files = filterByExt([...new Set(expanded)].sort(), options.ext);
  const results: BatchItemResult[] = [];
  if (options.dryRun === true) {
    return files.map((file) => ({
      file,
      status: "dry-run" as const,
      detail: `would strip (${options.mode}) -> copy, originals untouched`,
      output: null,
    }));
  }
  await pool(files, options.concurrency ?? 4, async (file) => {
    try {
      const target = await prepareOutput(file, options.out, undefined, options.inPlace, "_clean");
      const result = await stripFile(target.output, {
        mode: options.mode,
        tags: options.tags,
        keep: options.keep,
        verify: options.verify,
        reencode: options.reencode,
        yes: options.yes,
      });
      const suffix =
        options.verify === true
          ? result.residuals.length === 0
            ? "verified clean"
            : `${result.residuals.length} residual(s): ${result.residuals.slice(0, 5).join(", ")}`
          : "done";
      results.push({ file, status: "ok", detail: suffix, output: result.output });
    } catch (error) {
      results.push({
        file,
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
        output: null,
      });
    }
  });
  return results.sort((left, right) => left.file.localeCompare(right.file));
}

export async function runBatchWrite(
  inputs: string[],
  options: BatchWriteOptions,
): Promise<BatchItemResult[]> {
  const tags = parseSetPairs(options.set);
  if (Object.keys(tags).length === 0) {
    throw new Error("Nothing to write: provide --set TAG=VALUE.");
  }
  const expanded = await expandScanInputs(inputs, {});
  const files = filterByExt([...new Set(expanded)].sort(), options.ext);
  const results: BatchItemResult[] = [];
  if (options.dryRun === true) {
    return files.map((file) => ({
      file,
      status: "dry-run" as const,
      detail: `would write ${Object.keys(tags).join(",")} -> copy, originals untouched`,
      output: null,
    }));
  }
  await pool(files, options.concurrency ?? 4, async (file) => {
    try {
      const target = await prepareOutput(file, options.out, undefined, options.inPlace, "_edited");
      const { written, notWritten } = await applyTags(target.output, tags);
      const detail =
        notWritten.length === 0
          ? `${written.length} tag(s) written`
          : `${written.length} written, skipped: ${notWritten.map((entry) => `${entry.tag} (${entry.reason ?? "?"})`).join("; ")}`;
      results.push({ file, status: "ok", detail, output: target.output });
    } catch (error) {
      results.push({
        file,
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
        output: null,
      });
    }
  });
  return results.sort((left, right) => left.file.localeCompare(right.file));
}

export function renderBatchCsv(results: BatchItemResult[]): string {
  const escape = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const rows: string[][] = [["file", "status", "detail", "output"]];
  for (const item of results) {
    rows.push([item.file, item.status, item.detail, item.output ?? ""]);
  }
  return rows.map((row) => row.map(escape).join(",")).join("\n") + "\n";
}
