import type { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { effectiveConcurrency, effectiveOutDir, getConfig } from "./common.js";
import {
  renderBatchCsv,
  runBatchStrip,
  runBatchWrite,
  type BatchItemResult,
} from "../core/batch.js";
import { batchStripOptionsSchema, batchWriteOptionsSchema } from "../core/schemas.js";
import { zipFiles } from "../core/zip.js";

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

async function writeBatchReport(
  outDir: string | undefined,
  stem: string,
  results: BatchItemResult[],
): Promise<string[]> {
  const dir = resolve(outDir ?? join(process.cwd(), `metascope-${stem}-report`));
  await mkdir(dir, { recursive: true });
  const jsonPath = join(dir, "report.json");
  const csvPath = join(dir, "report.csv");
  await writeFile(jsonPath, JSON.stringify(results, null, 2));
  await writeFile(csvPath, renderBatchCsv(results));
  return [resolve(jsonPath), resolve(csvPath)];
}

export function registerBatchCommand(program: Command): void {
  const batch = program.command("batch").description("Bulk strip/write over directories");

  batch
    .command("strip")
    .description("Strip metadata across many files")
    .argument("<inputs...>", "files, directories, or globs")
    .option("--mode <mode>", "all|privacy|gps|custom (default: privacy)", "privacy")
    .option("--tags <tag>", "tag/group for custom mode (repeatable)", collect, [] as string[])
    .option("--keep <item>", "preserve icc/orientation (repeatable)", collect, [] as string[])
    .option("--verify", "re-read outputs and list residuals", false)
    .option("--reencode", "re-encode pixels (warns about quality loss)", false)
    .option("--yes", "skip the C2PA/AI removal warning", false)
    .option("--dry-run", "print what would happen without writing", false)
    .option("--concurrency <n>", "parallel files", String)
    .option("--ext <list>", "comma-separated extensions")
    .option("--zip", "bundle outputs into one zip archive", false)
    .option("--out <dir>", "output directory")
    .option("--in-place", "modify originals (creates .metascope.bak per file)", false)
    .action(
      async (
        inputs: string[],
        options: {
          mode: string;
          tags: string[];
          keep: string[];
          verify: boolean;
          reencode: boolean;
          yes: boolean;
          dryRun: boolean;
          concurrency?: string;
          ext?: string;
          zip: boolean;
          out?: string;
          inPlace: boolean;
        },
      ) => {
        const config = await getConfig();
        const parsed = batchStripOptionsSchema.safeParse({
          out: options.out,
          outFile: undefined,
          inPlace: options.inPlace === true,
          mode: options.mode,
          tags: options.tags ?? [],
          keep: options.keep ?? [],
          verify: options.verify === true,
          reencode: options.reencode === true,
          yes: options.yes === true,
          dryRun: options.dryRun === true,
          concurrency: options.concurrency === undefined ? undefined : Number(options.concurrency),
          ext: options.ext,
          zip: options.zip === true,
        });
        if (!parsed.success) {
          console.error(`Invalid options: ${parsed.error.message}`);
          process.exitCode = 1;
          return;
        }
        const results = await runBatchStrip(inputs, {
          mode: parsed.data.mode,
          tags: parsed.data.tags,
          keep: parsed.data.keep,
          verify: parsed.data.verify,
          reencode: parsed.data.reencode,
          yes: parsed.data.yes,
          out: effectiveOutDir(parsed.data.out, config),
          inPlace: parsed.data.inPlace,
          dryRun: parsed.data.dryRun,
          concurrency: effectiveConcurrency(parsed.data.concurrency, config),
          ext: parsed.data.ext ? parsed.data.ext.split(",") : undefined,
        });
        for (const item of results) {
          console.log(
            `[${item.status}] ${item.file}${item.output ? ` -> ${item.output}` : ""} ${item.detail}`,
          );
        }
        const written = await writeBatchReport(
          effectiveOutDir(parsed.data.out, config),
          "batch-strip",
          results,
        );
        for (const target of written) {
          console.log(`Wrote: ${target}`);
        }
        if (parsed.data.zip && !parsed.data.dryRun) {
          const outputs = results
            .map((item) => item.output)
            .filter((entry): entry is string => !!entry);
          if (outputs.length > 0) {
            const dir = effectiveOutDir(parsed.data.out, config) ?? process.cwd();
            const zipPath = join(dir, `metascope-batch-${Date.now()}.zip`);
            await zipFiles(outputs, zipPath);
            console.log(`Zip archive: ${zipPath}`);
          }
        }
      },
    );

  batch
    .command("write")
    .description("Write tags across many files")
    .argument("<inputs...>", "files, directories, or globs")
    .option("--set <tag=value>", "TAG=VALUE (repeatable)", collect, [] as string[])
    .option("--dry-run", "print what would happen without writing", false)
    .option("--concurrency <n>", "parallel files", String)
    .option("--ext <list>", "comma-separated extensions")
    .option("--out <dir>", "output directory")
    .option("--in-place", "modify originals (creates .metascope.bak per file)", false)
    .action(
      async (
        inputs: string[],
        options: {
          set: string[];
          dryRun: boolean;
          concurrency?: string;
          ext?: string;
          out?: string;
          inPlace: boolean;
        },
      ) => {
        const config = await getConfig();
        const parsed = batchWriteOptionsSchema.safeParse({
          out: options.out,
          outFile: undefined,
          inPlace: options.inPlace === true,
          set: options.set ?? [],
          dryRun: options.dryRun === true,
          concurrency: options.concurrency === undefined ? undefined : Number(options.concurrency),
          ext: options.ext,
        });
        if (!parsed.success) {
          console.error(`Invalid options: ${parsed.error.message}`);
          process.exitCode = 1;
          return;
        }
        const results = await runBatchWrite(inputs, {
          set: parsed.data.set,
          out: effectiveOutDir(parsed.data.out, config),
          inPlace: parsed.data.inPlace,
          dryRun: parsed.data.dryRun,
          concurrency: effectiveConcurrency(parsed.data.concurrency, config),
          ext: parsed.data.ext ? parsed.data.ext.split(",") : undefined,
        });
        for (const item of results) {
          console.log(
            `[${item.status}] ${item.file}${item.output ? ` -> ${item.output}` : ""} ${item.detail}`,
          );
        }
        const written = await writeBatchReport(
          effectiveOutDir(parsed.data.out, config),
          "batch-write",
          results,
        );
        for (const target of written) {
          console.log(`Wrote: ${target}`);
        }
      },
    );
}
