import type { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { effectiveConcurrency, effectiveOutDir, getConfig } from "./common.js";
import {
  renderCsv,
  renderHtml,
  renderJson,
  renderMarkdown,
  type ScanReport,
} from "../core/report.js";
import { scanInputs } from "../core/scan.js";
import { scanOptionsSchema } from "../core/schemas.js";

function parseFormats(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function reportFileName(format: string): string {
  if (format === "md") {
    return "report.md";
  }
  return `report.${format}`;
}

async function writeScanOutputs(
  report: ScanReport,
  outDir: string,
  formats: string[],
): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  const filesDir = join(outDir, "files");
  await mkdir(filesDir, { recursive: true });
  for (const file of report.files) {
    const safe = file.file.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const target = join(filesDir, `${safe}.json`);
    await writeFile(target, JSON.stringify(file, null, 2));
    written.push(resolve(target));
  }
  for (const format of formats) {
    if (format === "json") {
      const target = join(outDir, reportFileName("json"));
      await writeFile(target, renderJson(report));
      written.push(resolve(target));
    } else if (format === "md") {
      const target = join(outDir, reportFileName("md"));
      await writeFile(target, renderMarkdown(report));
      written.push(resolve(target));
    } else if (format === "csv") {
      const target = join(outDir, reportFileName("csv"));
      await writeFile(target, renderCsv(report));
      written.push(resolve(target));
    } else if (format === "html") {
      const target = join(outDir, "report.html");
      await writeFile(target, renderHtml(report));
      written.push(resolve(target));
    } else {
      throw new Error(`Unknown format ${JSON.stringify(format)}: expected json|md|csv|html.`);
    }
  }
  return written;
}

export function registerScanCommand(program: Command): void {
  program
    .command("scan")
    .description("Scan files/dirs/globs: metadata, privacy, AI provenance, hashes (read-only)")
    .argument("[paths...]", "files, directories, or globs (default: current directory)")
    .option("--depth <n>", "max directory depth", String)
    .option("--ext <list>", "comma-separated extensions, e.g. jpg,png")
    .option("--follow-symlinks", "follow symbolic links (off by default)", false)
    .option("--no-hash", "skip perceptual hashing for speed", false)
    .option("--concurrency <n>", "parallel files", String)
    .option("--out <dir>", "report directory")
    .option("--zip", "bundle the report directory into one zip archive", false)
    .option("--format <list>", "comma list: json|md|csv|html", "json,md")
    .action(
      async (
        paths: string[],
        options: {
          depth?: string;
          ext?: string;
          followSymlinks: boolean;
          noHash: boolean;
          concurrency?: string;
          out?: string;
          zip: boolean;
          format: string;
        },
      ) => {
        const config = await getConfig();
        const parsed = scanOptionsSchema.safeParse({
          depth: options.depth === undefined ? undefined : Number(options.depth),
          ext: options.ext,
          followSymlinks: options.followSymlinks === true,
          noHash: options.noHash === true,
          concurrency: options.concurrency === undefined ? undefined : Number(options.concurrency),
          out: options.out,
          format: options.format,
        });
        if (!parsed.success) {
          console.error(`Invalid options: ${parsed.error.message}`);
          process.exitCode = 1;
          return;
        }
        const formats = parseFormats(parsed.data.format);
        if (formats.length === 0) {
          console.error("Empty --format list.");
          process.exitCode = 1;
          return;
        }
        const report = await scanInputs(paths, {
          depth: parsed.data.depth,
          ext: parsed.data.ext ? parsed.data.ext.split(",") : undefined,
          followSymlinks: parsed.data.followSymlinks,
          noHash: parsed.data.noHash,
          concurrency: effectiveConcurrency(parsed.data.concurrency, config),
          onProgress: (done, total) => {
            const line = `Scanning ${done}/${total}`;
            if (process.stderr.isTTY) {
              process.stderr.write(`\r${line}`);
              if (done === total) {
                process.stderr.write("\n");
              }
            } else if (done === 1 || done === total || done % 25 === 0) {
              console.error(line);
            }
          },
        });
        for (const file of report.files) {
          const gps = file.privacy.some((finding) => finding.category === "gps")
            ? "gps=yes"
            : "gps=no";
          const serials = file.privacy.some((finding) => finding.category === "serial")
            ? "serials=yes"
            : "serials=no";
          const status = file.scanError
            ? `error=${file.scanError.slice(0, 80)}`
            : `ai=${file.aiVerdict}`;
          console.log(`- ${file.file} (${file.format}) ${status} ${gps} ${serials}`);
        }
        console.log(
          `Scanned ${report.summary.files} file(s): ` +
            `GPS=${report.summary.withGps} serials=${report.summary.withSerials} ` +
            `C2PA=${report.summary.withC2pa} errors=${report.summary.errors} ` +
            `verdicts(confirmed=${report.summary.verdicts.confirmed_by_metadata},` +
            `likely=${report.summary.verdicts.likely},possible=${report.summary.verdicts.possible},` +
            `none=${report.summary.verdicts.no_evidence})`,
        );
        const stamp = report.createdAt.replace(/[:.]/g, "-");
        const defaultDir = join(process.cwd(), `metascope-report-${stamp}`);
        const outDir = resolve(effectiveOutDir(parsed.data.out, config) ?? defaultDir);
        const written = await writeScanOutputs(report, outDir, formats);
        for (const target of written.slice(0, 20)) {
          console.log(`Wrote: ${target}`);
        }
        if (written.length > 20) {
          console.log(`... and ${written.length - 20} more file(s) in ${outDir}`);
        }
        if (options.zip === true) {
          const { zipFiles } = await import("../core/zip.js");
          const { readdir } = await import("node:fs/promises");
          const topLevel = (await readdir(outDir, { withFileTypes: true }))
            .filter((entry) => entry.isFile())
            .map((entry) => join(outDir, entry.name));
          const sidecars = (await readdir(join(outDir, "files"), { withFileTypes: true }))
            .filter((entry) => entry.isFile())
            .map((entry) => join(outDir, "files", entry.name));
          const zipPath = join(outDir, `metascope-report-${stamp}.zip`);
          await zipFiles([...topLevel, ...sidecars], zipPath);
          console.log(`Zip archive: ${zipPath}`);
        }
      },
    );
}
