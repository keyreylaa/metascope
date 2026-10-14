import type { Command } from "commander";
import { resolveInputs } from "../core/inputs.js";
import { privacyScan } from "../core/privacy.js";
import { readFileGrouped } from "../core/reader.js";

export function registerPrivacyScanCommand(program: Command): void {
  program
    .command("privacy-scan")
    .description("Privacy risk report with severity per finding")
    .argument("<inputs...>", "files or globs")
    .action(async (inputs: string[]) => {
      const files = await resolveInputs(inputs);
      if (files.length === 0) {
        console.error("No files matched the given inputs.");
        process.exitCode = 1;
        return;
      }
      for (const file of files) {
        try {
          const read = await readFileGrouped(file, false);
          const result = await privacyScan(file, read.groups);
          console.log(`File: ${result.file}`);
          if (result.findings.length === 0) {
            console.log("  No privacy findings.");
          } else {
            for (const finding of result.findings) {
              console.log(`  [${finding.severity}] ${finding.category}: ${finding.detail}`);
            }
          }
          console.log(`  Suggested: ${result.suggestedCommand}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Failed to scan ${file}: ${message}`);
        }
      }
    });
}
