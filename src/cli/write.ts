import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import { getExifTool } from "../core/exiftool.js";
import { prepareOutput } from "../core/fileOps.js";
import { effectiveOutDir, getConfig } from "./common.js";
import { readFileGrouped } from "../core/reader.js";
import { writeOptionsSchema } from "../core/schemas.js";
import { applyTags, parseSetPairs } from "../core/write.js";

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerWriteCommand(program: Command): void {
  program
    .command("write")
    .alias("edit")
    .description("Write tags (never touches originals without --in-place)")
    .argument("<file>", "target image/video file")
    .option("--set <tag=value>", "TAG=VALUE (repeatable)", collect, [] as string[])
    .option("--from-json <file>", "JSON object of TAG:VALUE")
    .option("--copy-from <file>", "copy writable tags from another file")
    .option("--out <dir>", "output directory (default: <file-dir>/metascope-out)")
    .option("--in-place", "modify the original (creates .metascope.bak first)", false)
    .action(
      async (
        file: string,
        options: {
          set: string[];
          fromJson?: string;
          copyFrom?: string;
          out?: string;
          inPlace: boolean;
        },
      ) => {
        const parsed = writeOptionsSchema.safeParse({
          out: options.out,
          outFile: undefined,
          inPlace: options.inPlace === true,
          set: options.set ?? [],
          fromJson: options.fromJson,
          copyFrom: options.copyFrom,
        });
        if (!parsed.success) {
          console.error(`Invalid options: ${parsed.error.message}`);
          process.exitCode = 1;
          return;
        }
        const tags: Record<string, unknown> = {};
        if (parsed.data.copyFrom) {
          const exiftool = await getExifTool();
          const source = (await exiftool.read(parsed.data.copyFrom)) as unknown as Record<
            string,
            unknown
          >;
          for (const [key, value] of Object.entries(source)) {
            if (["SourceFile", "errors", "warnings", "Error", "Warning"].includes(key)) {
              continue;
            }
            tags[key] = value;
          }
        }
        if (parsed.data.fromJson) {
          const raw = await readFile(parsed.data.fromJson, "utf8");
          const data: unknown = JSON.parse(raw);
          if (typeof data !== "object" || data === null || Array.isArray(data)) {
            console.error("--from-json must contain a JSON object of TAG:VALUE.");
            process.exitCode = 1;
            return;
          }
          Object.assign(tags, data as Record<string, unknown>);
        }
        Object.assign(tags, parseSetPairs(parsed.data.set));
        if (Object.keys(tags).length === 0) {
          console.error("Nothing to write: provide --set, --from-json, or --copy-from.");
          process.exitCode = 1;
          return;
        }
        const target = await prepareOutput(
          file,
          effectiveOutDir(parsed.data.out, await getConfig()),
          undefined,
          parsed.data.inPlace,
          "_edited",
        );
        if (target.backup) {
          console.error(`Backup created: ${target.backup}`);
        }
        const { written, notWritten } = await applyTags(target.output, tags);
        console.log(`Wrote ${written.length} tag(s) to ${target.output}`);
        for (const tag of written) {
          console.log(`  ok: ${tag}`);
        }
        if (notWritten.length > 0) {
          console.log(`NOT written (${notWritten.length}):`);
          for (const entry of notWritten) {
            console.log(`  skip: ${entry.tag} (${entry.reason ?? "unknown reason"})`);
          }
        }
        const verify = await readFileGrouped(target.output, false);
        if (verify.errors.length > 0) {
          console.error(`Warnings: ${verify.errors.join("; ")}`);
        }
      },
    );
}
