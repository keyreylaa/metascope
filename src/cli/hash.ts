import type { Command } from "commander";
import { HASH_SCOPE_NOTE, hammingDistanceHex, hashFile, similarityVerdict } from "../core/hash.js";
import { hashOptionsSchema } from "../core/schemas.js";

export function registerHashCommand(program: Command): void {
  program
    .command("hash")
    .description("File, pixel, and perceptual hashes (integrity/duplicates, NOT AI detection)")
    .argument("<file>", "image file")
    .option("--compare <other>", "compare perceptual hashes with another file")
    .action(async (file: string, options: { compare?: string }) => {
      const parsed = hashOptionsSchema.safeParse({ compare: options.compare });
      if (!parsed.success) {
        console.error(`Invalid options: ${parsed.error.message}`);
        process.exitCode = 1;
        return;
      }
      const result = await hashFile(file);
      console.log(`File: ${result.file}`);
      console.log(`  sha256: ${result.sha256}`);
      console.log(`  md5: ${result.md5}`);
      console.log(`  pixel-sha256: ${result.pixelSha256 ?? "(unavailable)"}`);
      console.log(`  ahash: ${result.ahash ?? "(unavailable)"}`);
      console.log(`  dhash: ${result.dhash ?? "(unavailable)"}`);
      console.log(`  phash: ${result.phash ?? "(unavailable)"}`);
      if (result.note) {
        console.log(`  note: ${result.note}`);
      }
      console.log(HASH_SCOPE_NOTE);
      if (parsed.data.compare) {
        const other = await hashFile(parsed.data.compare);
        for (const algo of ["ahash", "dhash", "phash"] as const) {
          const left = result[algo];
          const right = other[algo];
          if (!left || !right) {
            console.log(`  ${algo}: cannot compare (missing hash)`);
            continue;
          }
          const distance = hammingDistanceHex(left, right);
          console.log(`  ${algo}: distance=${distance} (${similarityVerdict(distance)})`);
        }
      }
    });
}
