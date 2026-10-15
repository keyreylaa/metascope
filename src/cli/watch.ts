import type { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { effectiveOutDir, getConfig } from "./common.js";
import { scanOneFile } from "../core/scan.js";
import { watchOptionsSchema } from "../core/schemas.js";
import { watchPaths } from "../core/watch.js";

export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Watch directories and scan new/changed images (runs until Ctrl+C)")
    .argument("<paths...>", "directories to watch")
    .option("--depth <n>", "max directory depth", String)
    .option("--ext <list>", "comma-separated extensions, e.g. jpg,png")
    .option("--follow-symlinks", "follow symbolic links (off by default)", false)
    .option("--no-hash", "skip perceptual hashing for speed", false)
    .option("--debounce-ms <n>", "per-file debounce window", String)
    .option("--out <dir>", "directory for per-file JSON sidecars")
    .action(
      async (
        paths: string[],
        options: {
          depth?: string;
          ext?: string;
          followSymlinks: boolean;
          hash: boolean;
          debounceMs?: string;
          out?: string;
        },
      ) => {
        const config = await getConfig();
        // Note: commander maps --no-hash to options.hash === false (negated option).
        const parsed = watchOptionsSchema.safeParse({
          depth: options.depth === undefined ? undefined : Number(options.depth),
          ext: options.ext,
          followSymlinks: options.followSymlinks === true,
          noHash: options.hash === false,
          concurrency: undefined,
          debounceMs: options.debounceMs === undefined ? undefined : Number(options.debounceMs),
          out: options.out,
          format: "json",
        });
        if (!parsed.success) {
          console.error(`Invalid options: ${parsed.error.message}`);
          process.exitCode = 1;
          return;
        }
        const outDir = resolve(
          effectiveOutDir(parsed.data.out, config) ?? join(process.cwd(), "metascope-watch"),
        );
        await mkdir(outDir, { recursive: true });
        console.log(`Watching ${paths.join(", ")} -> ${outDir} (Ctrl+C to stop)`);
        const handle = await watchPaths(
          paths,
          {
            depth: parsed.data.depth,
            ext: parsed.data.ext ? parsed.data.ext.split(",") : undefined,
            followSymlinks: parsed.data.followSymlinks,
            debounceMs: parsed.data.debounceMs,
          },
          async (file) => {
            try {
              const report = await scanOneFile(file, { noHash: parsed.data.noHash });
              const safe = file.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
              await writeFile(join(outDir, `${safe}.json`), JSON.stringify(report, null, 2));
              console.log(
                `- ${file} ai=${report.aiVerdict} ${report.scanError ? `error=${report.scanError.slice(0, 80)}` : "ok"}`,
              );
            } catch (error) {
              console.error(
                `Failed on ${file}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          },
        );
        console.log(
          `Watching ${handle.dirs.length} director${handle.dirs.length === 1 ? "y" : "ies"}.`,
        );
        process.on("SIGINT", () => {
          void handle.close();
        });
        await new Promise(() => undefined);
      },
    );
}
