import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadDotEnv(dir: string = process.cwd()): Promise<Record<string, string>> {
  const loaded: Record<string, string> = {};
  let text: string;
  try {
    text = await readFile(join(dir, ".env"), "utf8");
  } catch {
    return loaded;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    loaded[key] = value;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return loaded;
}
