export const ALLOWED_CDN_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];

export const DEFAULT_MAX_FILE_MB = 10;

export interface Allowlist {
  guildIds?: string[];
  userIds?: string[];
}

export function isAllowedHost(urlText: string): boolean {
  try {
    const host = new URL(urlText).hostname.toLowerCase();
    return ALLOWED_CDN_HOSTS.includes(host);
  } catch {
    return false;
  }
}

export function resolveMaxFileBytes(options?: { envMb?: string; configMb?: number }): number {
  const fromEnv = options?.envMb ? Number(options.envMb) : Number.NaN;
  const mb =
    Number.isFinite(fromEnv) && fromEnv > 0
      ? fromEnv
      : options?.configMb && options.configMb > 0
        ? options.configMb
        : DEFAULT_MAX_FILE_MB;
  return Math.floor(mb * 1024 * 1024);
}

export async function checkSizeBeforeDownload(url: string, maxBytes: number): Promise<number> {
  if (!isAllowedHost(url)) {
    throw new Error(`Refused host (only ${ALLOWED_CDN_HOSTS.join(", ")} are allowed).`);
  }
  const response = await fetch(url, { method: "HEAD" });
  if (!response.ok) {
    throw new Error(`HEAD request failed with status ${response.status}.`);
  }
  const length = response.headers.get("content-length");
  if (length === null) {
    throw new Error("Refused: server did not declare content-length before download.");
  }
  const size = Number(length);
  if (!Number.isFinite(size) || size < 0) {
    throw new Error("Refused: invalid content-length before download.");
  }
  if (size > maxBytes) {
    throw new Error(
      `Refused: file is ${(size / 1048576).toFixed(1)} MB, limit is ${(maxBytes / 1048576).toFixed(1)} MB.`,
    );
  }
  return size;
}

export async function downloadCapped(url: string, maxBytes: number): Promise<Buffer> {
  await checkSizeBeforeDownload(url, maxBytes);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with status ${response.status}.`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Refused: file exceeded the size limit during download.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly maxCalls: number = 5,
    private readonly windowMs: number = 60_000,
  ) {}

  take(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((stamp) => stamp > cutoff);
    if (recent.length >= this.maxCalls) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

export function isAllowed(
  ids: { guildId?: string | null; userId: string },
  list: Allowlist,
): boolean {
  if (list.userIds && list.userIds.length > 0 && !list.userIds.includes(ids.userId)) {
    return false;
  }
  if (list.guildIds && list.guildIds.length > 0) {
    if (!ids.guildId || !list.guildIds.includes(ids.guildId)) {
      return false;
    }
  }
  return true;
}

export function parseKeyValueArgs(args: string[]): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const arg of args) {
    const separator = arg.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Invalid argument ${JSON.stringify(arg)}: expected KEY=VALUE.`);
    }
    tags[arg.slice(0, separator).trim()] = arg.slice(separator + 1);
  }
  if (Object.keys(tags).length === 0) {
    throw new Error("Nothing to set: provide at least one KEY=VALUE.");
  }
  return tags;
}
