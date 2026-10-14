import { stat } from "node:fs/promises";
import { glob, isDynamicPattern } from "tinyglobby";

export async function resolveInputs(patterns: string[]): Promise<string[]> {
  const found: string[] = [];
  const staticInputs: string[] = [];
  const dynamicInputs: string[] = [];
  for (const pattern of patterns) {
    if (isDynamicPattern(pattern)) {
      dynamicInputs.push(pattern);
    } else {
      staticInputs.push(pattern);
    }
  }
  if (dynamicInputs.length > 0) {
    const matched = await glob(dynamicInputs, {
      onlyFiles: true,
      dot: false,
      expandDirectories: false,
    });
    found.push(...matched);
  }
  for (const file of staticInputs) {
    try {
      const info = await stat(file);
      if (info.isFile()) {
        found.push(file);
      }
    } catch {
      // Missing static files are reported by the caller; skip here.
      found.push(file);
    }
  }
  return [...new Set(found)].sort();
}
