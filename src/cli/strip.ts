import type { Command } from "commander";
import { prepareOutput } from "../core/fileOps.js";
import { effectiveOutDir, getConfig } from "./common.js";
import { resolveInputs } from "../core/inputs.js";
import { stripOptionsSchema } from "../core/schemas.js";
import { stripFile } from "../core/strip.js";

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerStripCommand(program: Command): void {
  program
    .command("strip")
    .description("Remove metadata (writes to a copy unless --in-place)")
    .argument("<inputs...>", "files or globs")
    .option("--mode <mode>", "all|privacy|gps|custom (default: privacy)", "privacy")
    .option(
      "--tags <tag>",
      "tag/group to clear for custom mode (repeatable)",
      collect,
      [] as string[],
    )
    .option(
      "--keep <item>",
      "preserve icc and/or orientation (repeatable or comma-separated)",
      collect,
      [] as string[],
    )
    .option("--verify", "re-read output and list residuals", false)
    .option("--reencode", "re-encode pixels as last resort (warns about quality loss)", false)
    .option("--yes", "skip the C2PA/AI removal warning", false)
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
          zip: boolean;
          out?: string;
          inPlace: boolean;
        },
      ) => {
        const parsed = stripOptionsSchema.safeParse({
          out: options.out,
          outFile: undefined,
          inPlace: options.inPlace === true,
          mode: options.mode,
          tags: options.tags ?? [],
          keep: options.keep ?? [],
          verify: options.verify === true,
          reencode: options.reencode === true,
          yes: options.yes === true,
          zip: options.zip === true,
        });
        if (!parsed.success) {
          console.error(`Invalid options: ${parsed.error.message}`);
          process.exitCode = 1;
          return;
        }
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
            effectiveOutDir(parsed.data.out, await getConfig()),
            undefined,
            parsed.data.inPlace,
            "_clean",
          );
          if (target.backup) {
            console.error(`Backup created: ${target.backup}`);
          }
          const result = await stripFile(target.output, {
            mode: parsed.data.mode,
            tags: parsed.data.tags,
            keep: parsed.data.keep,
            verify: parsed.data.verify,
            reencode: parsed.data.reencode,
            yes: parsed.data.yes,
          });
          for (const warning of result.warnings) {
            console.error(warning);
          }
          for (const note of result.notes) {
            console.log(note);
          }
          console.log(`Stripped (${parsed.data.mode}) -> ${result.output}`);
          outputs.push(result.output);
          if (parsed.data.verify) {
            if (result.residuals.length === 0) {
              console.log("Verify: clean (re-read proves no residual tags/segments).");
            } else {
              console.log(`Verify: ${result.residuals.length} residual(s):`);
              for (const residual of result.residuals) {
                console.log(`  residual: ${residual}`);
              }
            }
          }
        }
        if (parsed.data.zip && outputs.length > 0) {
          const { zipFiles } = await import("../core/zip.js");
          const { join } = await import("node:path");
          const outDir = effectiveOutDir(parsed.data.out, await getConfig()) ?? process.cwd();
          const zipPath = join(
            outDir,
            `metascope-strip-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`,
          );
          await zipFiles(outputs, zipPath);
          console.log(`Zip archive: ${zipPath}`);
        }
      },
    );
}
