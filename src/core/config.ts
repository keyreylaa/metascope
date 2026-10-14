import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import * as z from "zod";

export const configSchema = z.object({
  outputDir: z.string().min(1).optional(),
  concurrency: z.number().int().min(1).max(32).optional(),
  snapshotDir: z.string().min(1).optional(),
  discord: z
    .object({
      prefix: z.string().min(1).max(8).optional(),
      maxFileMb: z.number().min(1).max(100).optional(),
      guildAllowlist: z.array(z.string().min(1)).optional(),
      userAllowlist: z.array(z.string().min(1)).optional(),
      ratePerMinute: z.number().int().min(1).max(60).optional(),
      devGuildId: z.string().min(1).optional(),
    })
    .optional(),
});

export type MetascopeConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONCURRENCY = 4;

export function dataDir(): string {
  const base = process.env["XDG_DATA_HOME"] || join(homedir(), ".local", "share");
  return resolve(join(base, "metascope"));
}

export function configDir(): string {
  const base = process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config");
  return resolve(join(base, "metascope"));
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export async function loadConfig(path?: string): Promise<MetascopeConfig> {
  const target = path ?? configPath();
  try {
    const raw = await readFile(target, "utf8");
    const parsed = configSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.error(`Invalid config at ${target}: ${parsed.error.message}. Using defaults.`);
      return {};
    }
    return parsed.data;
  } catch {
    return {};
  }
}

export function resolveSnapshotDir(options?: { flag?: string; config?: MetascopeConfig }): string {
  if (process.env["METASCOPE_SNAPSHOT_DIR"]) {
    return resolve(process.env["METASCOPE_SNAPSHOT_DIR"] as string);
  }
  if (options?.flag) {
    return resolve(options.flag);
  }
  if (options?.config?.snapshotDir) {
    return resolve(options.config.snapshotDir as string);
  }
  return join(dataDir(), "snapshots");
}

export async function ensureSnapshotDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}
