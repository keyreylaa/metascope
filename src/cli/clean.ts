import type { Command } from "commander";
import { effectiveOutDir, getConfig } from "./common.js";
import { prepareOutput } from "../core/fileOps.js";
import { resolveInputs } from "../core/inputs.js";
import { stripFile } from "../core/strip.js";
import { zipFiles } from "../core/zip.js";

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerCleanCommand(program: Command): void {
  program
    .command("clean")
    .description(
      "Strip ALL metadata with verification (alias-friendly: clean = strip all + verify)",
    )
    .argument("<inputs...>", "files or globs")
    .option(
      "--keep <item>",
      "preserve icc and/or orientation (repeatable or comma-separated)",
      collect,
      [] as string[],
    )
    .option("--yes", "skip the C2PA/AI removal warning", false)
    .option("--zip", "bundle outputs into one zip archive", false)
    .option("--out <dir>", "output directory")
    .option("--in-place", "modify originals (creates .metascope.bak per file)", false)
    .action(
      async (
        inputs: string[],
        options: { keep: string[]; yes: boolean; zip: boolean; out?: string; inPlace: boolean },
      ) => {
        const files = await resolveInputs(inputs);
        if (files.length === 0) {
          console.error("No files matched the given inputs.");
          process.exitCode = 1;
          return;
        }
        const outputs: string[] = [];
        for (const file of files) {
          const target = await prepareOutput(
            file,
            effectiveOutDir(options.out, await getConfig()),
            undefined,
            options.inPlace === true,
            "_clean",
          );
          if (target.backup) {
            console.error(`Backup created: ${target.backup}`);
          }
          const result = await stripFile(target.output, {
            mode: "all",
            keep: options.keep ?? [],
            verify: true,
            yes: options.yes === true,
          });
          for (const warning of result.warnings) {
            console.error(warning);
          }
          for (const note of result.notes) {
            console.log(note);
          }
          console.log(`Cleaned -> ${result.output}`);
          outputs.push(result.output);
          if (result.residuals.length === 0) {
            console.log("Verify: clean (re-read proves no residual tags/segments).");
          } else {
            console.log(`Verify: ${result.residuals.length} residual(s):`);
            for (const residual of result.residuals) {
              console.log(`  residual: ${residual}`);
            }
          }
        }
        if (options.zip === true && outputs.length > 0) {
          const { join } = await import("node:path");
          const outDir = effectiveOutDir(options.out, await getConfig()) ?? process.cwd();
          const zipPath = join(
            outDir,
            `metascope-clean-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`,
          );
          await zipFiles(outputs, zipPath);
          console.log(`Zip archive: ${zipPath}`);
        }
      },
    );
}
