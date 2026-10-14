import type { Command } from "commander";
import { stat } from "node:fs/promises";
import { closeExifTool } from "../core/exiftool.js";
import { formatJson, formatMarkdown, formatTable } from "../core/formatters.js";
import { resolveInputs } from "../core/inputs.js";
import { readFileGrouped } from "../core/reader.js";
import { readOptionsSchema } from "../core/schemas.js";
import { extractThumbnails } from "../core/thumbnail.js";

export function registerReadCommand(program: Command): void {
  program
    .command("read")
    .description("Dump metadata grouped by namespace")
    .argument("<inputs...>", "files or globs")
    .option("--format <format>", "table|json|md", "table")
    .option("--raw", "show numeric raw values", false)
    .option("--thumbnail", "extract embedded thumbnails/previews", false)
    .option("--out <dir>", "output directory for thumbnails")
    .action(
      async (
        inputs: string[],
        options: { format: string; raw: boolean; thumbnail: boolean; out?: string },
      ) => {
        const parsed = readOptionsSchema.safeParse({
          format: options.format,
          raw: options.raw === true,
          thumbnail: options.thumbnail === true,
          out: options.out,
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
        const reads = [];
        let failures = 0;
        for (const file of files) {
          try {
            const info = await stat(file);
            if (!info.isFile()) {
              console.error(`Skipped (not a file): ${file}`);
              failures += 1;
              continue;
            }
            reads.push(await readFileGrouped(file, parsed.data.raw));
            if (parsed.data.thumbnail) {
              const result = await extractThumbnails(file, parsed.data.out);
              for (const written of result.extracted) {
                console.error(`Thumbnail written: ${written}`);
              }
              for (const note of result.skipped) {
                console.error(note);
              }
            }
          } catch (error) {
            failures += 1;
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Failed to read ${file}: ${message}`);
          }
        }
        if (reads.length > 0) {
          if (parsed.data.format === "json") {
            console.log(formatJson(reads));
          } else if (parsed.data.format === "md") {
            console.log(formatMarkdown(reads));
          } else {
            console.log(formatTable(reads));
          }
        }
        await closeExifTool();
        if (failures > 0 && reads.length === 0) {
          process.exitCode = 1;
        }
      },
    );
}
