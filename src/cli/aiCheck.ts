import type { Command } from "commander";
import { aiCheck, getDefaultDetectors } from "../core/aiCheck.js";
import { mlPixelDetector } from "../core/detectors/mlPixel.js";
import { readFileGrouped } from "../core/reader.js";

export function registerAiCheckCommand(program: Command): void {
  program
    .command("ai-check")
    .description("Layered AI-generation provenance check (metadata + optional ML)")
    .argument("<file>", "image file")
    .option("--no-ml", "skip ML pixel classifier")
    // Note: commander maps --no-ml to options.ml === false (negated option),
    // not options.noMl. See https://github.com/tj/commander.js#other-option-types
    .action(async (file: string, options: { ml?: boolean }) => {
      const read = await readFileGrouped(file, false);
      const detectors = getDefaultDetectors();
      if (options.ml !== false) {
        detectors.push(mlPixelDetector);
      }
      const result = await aiCheck(file, read.groups, detectors);
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
