import type { Command } from "commander";
import { DEFAULT_DATE_TAGS, parseShiftSeconds, setDates, shiftDates } from "../core/dates.js";
import { prepareOutput } from "../core/fileOps.js";
import { effectiveOutDir, getConfig } from "./common.js";
import { datesOptionsSchema } from "../core/schemas.js";

export function registerDatesCommand(program: Command): void {
  program
    .command("dates")
    .description("Set or shift date/time tags")
    .argument("<file>", "target file")
    .option("--set <datetime>", 'e.g. --set "2024:01:02 03:04:05"')
    .option("--shift <seconds>", "shift by integer seconds, e.g. --shift 3600 or --shift -86400")
    .option("--tags <list>", "comma list (default: DateTimeOriginal,CreateDate,ModifyDate)")
    .option("--out <dir>", "output directory")
    .option("--in-place", "modify the original (creates .metascope.bak first)", false)
    .action(
      async (
        file: string,
        options: { set?: string; shift?: string; tags?: string; out?: string; inPlace: boolean },
      ) => {
        const parsed = datesOptionsSchema.safeParse({
          out: options.out,
          outFile: undefined,
          inPlace: options.inPlace === true,
          set: options.set,
          shift: options.shift,
          tags: options.tags,
        });
        if (!parsed.success) {
          console.error(`Invalid options: ${parsed.error.message}`);
          process.exitCode = 1;
          return;
        }
        if ((parsed.data.set ? 1 : 0) + (parsed.data.shift ? 1 : 0) !== 1) {
          console.error("Provide exactly one of --set or --shift.");
          process.exitCode = 1;
          return;
        }
        const tags = parsed.data.tags
          ? parsed.data.tags
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [...DEFAULT_DATE_TAGS];
        if (tags.length === 0) {
          console.error("Empty --tags list.");
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
        if (parsed.data.set) {
          await setDates(target.output, parsed.data.set, tags);
          console.log(`Dates set to ${parsed.data.set} in ${target.output} (${tags.join(",")}).`);
        } else {
          const seconds = parseShiftSeconds(parsed.data.shift as string);
          const updated = await shiftDates(target.output, seconds, tags);
          console.log(`Dates shifted by ${seconds}s in ${target.output}:`);
          for (const [tag, value] of Object.entries(updated)) {
            console.log(`  ${tag} = ${value}`);
          }
        }
      },
    );
}
