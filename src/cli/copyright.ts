import type { Command } from "commander";
import { prepareOutput } from "../core/fileOps.js";
import { effectiveOutDir, getConfig } from "./common.js";
import { applyCopyright } from "../core/copyright.js";
import { copyrightOptionsSchema } from "../core/schemas.js";

export function registerCopyrightCommand(program: Command): void {
  program
    .command("copyright")
    .description("Set copyright/owner fields")
    .argument("<file>", "target file")
    .option("--owner <name>", "owner name")
    .option("--notice <text>", "copyright notice")
    .option("--url <url>", "license URL")
    .option("--usage-terms <text>", "usage terms")
    .option("--sync", "mirror values across EXIF, IPTC, and XMP", false)
    .option("--out <dir>", "output directory")
    .option("--in-place", "modify the original (creates .metascope.bak first)", false)
    .action(
      async (
        file: string,
        options: {
          owner?: string;
          notice?: string;
          url?: string;
          usageTerms?: string;
          sync: boolean;
          out?: string;
          inPlace: boolean;
        },
      ) => {
        const parsed = copyrightOptionsSchema.safeParse({
          out: options.out,
          outFile: undefined,
          inPlace: options.inPlace === true,
          owner: options.owner,
          notice: options.notice,
          url: options.url,
          usageTerms: options.usageTerms,
          sync: options.sync === true,
        });
        if (!parsed.success) {
          console.error(`Invalid options: ${parsed.error.message}`);
          process.exitCode = 1;
          return;
        }
        if (
          !parsed.data.owner &&
          !parsed.data.notice &&
          !parsed.data.url &&
          !parsed.data.usageTerms
        ) {
          console.error("Nothing to set: provide --owner, --notice, --url, or --usage-terms.");
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
        const result = await applyCopyright(target.output, {
          owner: parsed.data.owner,
          notice: parsed.data.notice,
          url: parsed.data.url,
          usageTerms: parsed.data.usageTerms,
          sync: parsed.data.sync,
        });
        console.log(
          `Copyright written to ${target.output}: ${result.written.join(", ") || "(none)"}`,
        );
        for (const entry of result.notWritten) {
          console.log(`  skip: ${entry.tag} (${entry.reason ?? "unknown reason"})`);
        }
        console.log("Verified by re-reading EXIF/IPTC/XMP:");
        for (const [group, values] of Object.entries(result.verified)) {
          console.log(`  [${group}] ${values.join("; ") || "(no copyright tags)"}`);
        }
      },
    );
}
