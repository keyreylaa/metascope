import type { Command } from "commander";
import { aiCheck } from "../core/aiCheck.js";
import { readFileGrouped } from "../core/reader.js";

export function registerAiCheckCommand(program: Command): void {
  program
    .command("ai-check")
    .description("Layered AI-generation provenance check (metadata only)")
    .argument("<file>", "image file")
    .action(async (file: string) => {
      const read = await readFileGrouped(file, false);
      const result = await aiCheck(file, read.groups);
      console.log(`File: ${result.file}`);
      console.log(`Verdict: ${result.verdict}`);
      if (result.evidence.length === 0) {
        console.log("Evidence: (none)");
      } else {
        console.log(`Evidence (${result.evidence.length}):`);
        for (const item of result.evidence) {
          console.log(`  [${item.confidence}] ${item.signal} (${item.source})`);
          if (item.details) {
            console.log(`    ${item.details.slice(0, 300)}`);
          }
        }
      }
      console.log(`Disclaimer: ${result.disclaimer}`);
    });
}
