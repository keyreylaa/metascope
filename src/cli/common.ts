import { loadConfig, type MetascopeConfig } from "../core/config.js";

let cached: MetascopeConfig | null = null;

export async function getConfig(): Promise<MetascopeConfig> {
  if (!cached) {
    cached = await loadConfig();
  }
  return cached;
}

export function effectiveOutDir(
  flag: string | undefined,
  config: MetascopeConfig,
): string | undefined {
  return flag ?? config.outputDir;
}

export function effectiveConcurrency(
  flag: number | undefined,
  config: MetascopeConfig,
): number | undefined {
  return flag ?? config.concurrency;
}
