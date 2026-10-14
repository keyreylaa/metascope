import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

// Entries older than this are leftovers from previous (possibly crashed) runs.
// The age gate is what keeps the sweep safe: a concurrently running second
// `npm test` only ever owns directories created within the last minutes.
const STALE_MS = 2 * 60 * 60 * 1000;

export default async function globalSetup(): Promise<void> {
  const root = join(process.cwd(), "test-tmp");
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return; // No test-tmp yet: nothing to sweep.
  }
  for (const name of names) {
    const path = join(root, name);
    try {
      const info = await stat(path);
      if (Date.now() - info.mtimeMs > STALE_MS) {
        await rm(path, { recursive: true, force: true });
      }
    } catch {
      // Entry vanished or is unreadable mid-sweep; skip it.
    }
  }
}
