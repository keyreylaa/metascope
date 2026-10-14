import { randomBytes } from "node:crypto";
import { utimes } from "node:fs/promises";
import { extname } from "node:path";
import type { Command } from "commander";
import { effectiveOutDir, getConfig } from "./common.js";
import { prepareOutput } from "../core/fileOps.js";
import { resolveInputs } from "../core/inputs.js";
import { stripFile, CLEAN_NOTICE, assertCleanConfirmed } from "../core/strip.js";
import { readFileGrouped } from "../core/reader.js";
import { zipFiles } from "../core/zip.js";

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function randomName(source: string): string {
  return `clean-${randomBytes(8).toString("hex")}${extname(source).toLowerCase()}`;
}

export function registerCleanCommand(program: Command): void {
  program
    .command("clean")
    .description(
      "Maximum-privacy strip: EXIF/IPTC/XMP/MakerNotes/thumbnails/JUMBF-C2PA/ICC removed, verified clean",
    )
    .argument("<inputs...>", "files or globs")
    .option(
      "--keep <item>",
      "preserve icc and/or orientation (repeatable or comma-separated)",
      collect,
      [] as string[],
    )
    .option("--yes", "required when the file carries C2PA/AI provenance", false)
    .option(
      "--rename <mode>",
      "random: output filename is a random id, not derived from the original",
    )
    .option("--zip", "bundle outputs into one zip archive", false)
    .option("--out <dir>", "output directory")
    .option("--in-place", "modify originals (creates .metascope.bak per file)", false)
    .action(
      async (
        inputs: string[],
        options: {
          keep: string[];
          yes: boolean;
          rename?: string;
          zip: boolean;
          out?: string;
          inPlace: boolean;
        },
      ) => {
        const files = await resolveInputs(inputs);
        if (files.length === 0) {
          console.error("No files matched the given inputs.");
          process.exitCode = 1;
          return;
        }
        const renameRandom = options.rename?.toLowerCase() === "random";
        if (options.rename && !renameRandom) {
          console.error('Invalid --rename: only "random" is supported.');
          process.exitCode = 1;
          return;
        }
        if (renameRandom && options.inPlace === true) {
          console.error("--rename random cannot be combined with --in-place.");
          process.exitCode = 1;
          return;
        }
        const outDir = effectiveOutDir(options.out, await getConfig());
        const outputs: string[] = [];
        for (const file of files) {
          const before = await readFileGrouped(file, false);
          try {
            assertCleanConfirmed(before, options.yes === true);
          } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
            return;
          }
          const { join } = await import("node:path");
          const outFile = renameRandom
            ? join(outDir ?? process.cwd(), randomName(file))
            : undefined;
          const target = await prepareOutput(
            file,
            outDir,
            outFile,
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
            yes: true,
          });
          const now = new Date();
          await utimes(target.output, now, now);
          for (const warning of result.warnings) {
            console.error(warning);
          }
          for (const note of result.notes) {
            console.log(note);
          }
          console.log(CLEAN_NOTICE);
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
          const zipDir = outDir ?? process.cwd();
          const zipPath = join(
            zipDir,
            `metascope-clean-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`,
          );
          await zipFiles(outputs, zipPath);
          console.log(`Zip archive: ${zipPath}`);
        }
      },
    );
}
