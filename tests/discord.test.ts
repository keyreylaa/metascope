import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadDotEnv } from "../src/discord/dotenv.js";
import { channelSummary } from "../src/discord/redact.js";
import { runAi, runHash, runScan } from "../src/discord/runner.js";
import {
  isAllowed,
  isAllowedHost,
  parseKeyValueArgs,
  RateLimiter,
  resolveMaxFileBytes,
} from "../src/discord/security.js";
import { closeExifTool } from "../src/core/exiftool.js";
import { ensurePhase3Fixtures, testTmp } from "./fixtures.js";

afterAll(async () => {
  await closeExifTool();
});

describe("cdn allowlist", () => {
  it("accepts only the two discord cdn hosts", () => {
    expect(isAllowedHost("https://cdn.discordapp.com/attachments/1/2/a.jpg")).toBe(true);
    expect(isAllowedHost("https://media.discordapp.net/attachments/1/2/a.jpg")).toBe(true);
    expect(isAllowedHost("https://cdn.discordapp.com.evil.com/a.jpg")).toBe(false);
    expect(isAllowedHost("https://evil.com/a.jpg")).toBe(false);
    expect(isAllowedHost("not a url")).toBe(false);
  });
});

describe("size and allowlist policy", () => {
  it("defaults to 10 MB and honors env/config", () => {
    expect(resolveMaxFileBytes({})).toBe(10 * 1024 * 1024);
    expect(resolveMaxFileBytes({ envMb: "5" })).toBe(5 * 1024 * 1024);
    expect(resolveMaxFileBytes({ envMb: "bogus", configMb: 7 })).toBe(7 * 1024 * 1024);
  });

  it("enforces guild/user allowlists", () => {
    expect(isAllowed({ userId: "u1" }, {})).toBe(true);
    expect(isAllowed({ userId: "u1" }, { userIds: ["u2"] })).toBe(false);
    expect(isAllowed({ guildId: "g1", userId: "u1" }, { guildIds: ["g1"] })).toBe(true);
    expect(isAllowed({ userId: "u1" }, { guildIds: ["g1"] })).toBe(false);
  });
});

describe("rate limiter", () => {
  it("blocks after the quota and refills later", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.take("u", 0)).toBe(true);
    expect(limiter.take("u", 10)).toBe(true);
    expect(limiter.take("u", 20)).toBe(false);
    expect(limiter.take("u", 2000)).toBe(true);
  });
});

describe("key=value parsing", () => {
  it("parses pairs and rejects junk", () => {
    expect(parseKeyValueArgs(["Artist=x", "A=b=c"])).toEqual({ Artist: "x", A: "b=c" });
    expect(() => parseKeyValueArgs(["nope"])).toThrow();
    expect(() => parseKeyValueArgs([])).toThrow();
  });
});

describe("redaction", () => {
  it("keeps secrets out of channel text", async () => {
    const fixtures = await ensurePhase3Fixtures(testTmp("discord-redact"));
    const buffer = await readFile(fixtures.camera);
    const single = await import("../src/core/scan.js").then((mod) =>
      mod.scanBuffer(buffer, "camera.jpg", {}),
    );
    const report = {
      tool: "metascope",
      version: "0.1.0",
      createdAt: new Date().toISOString(),
      root: "camera.jpg",
      summary: (await import("../src/core/report.js")).summarize([single]),
      files: [single],
    };
    const text = channelSummary(report);
    expect(text).toContain("gps=yes");
    expect(text).not.toContain("SN-000-1234");
    expect(text).not.toContain("51.5");
    expect(text).not.toContain("FakeCam");
  });
});

describe("runner on buffers", () => {
  it("scans, hashes, and ai-checks without touching disk inputs", async () => {
    const fixtures = await ensurePhase3Fixtures(testTmp("discord-run"));
    const buffer = await readFile(fixtures.a1111);
    const scan = await runScan(buffer, "a1111.png");
    expect(scan.channelText).toContain("confirmed_by_metadata");
    expect(scan.files.map((file) => file.name).sort()).toEqual(["report.json", "report.md"]);
    const hash = await runHash(buffer, "a1111.png");
    expect(hash.channelText).toContain("sha256=");
    const ai = await runAi(buffer, "a1111.png");
    expect(ai.channelText).toContain("confirmed_by_metadata");
    expect(ai.dmText).toMatch(/SynthID/);
  });
});

describe("dotenv loader", () => {
  it("parses KEY=VALUE and never requires a token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ms-env-"));
    try {
      await writeFile(join(dir, ".env"), "# comment\nDISCORD_TOKEN=abc123\nEMPTY=\n");
      const loaded = await loadDotEnv(dir);
      expect(loaded["DISCORD_TOKEN"]).toBe("abc123");
      expect(await loadDotEnv(join(dir, "missing"))).toEqual({});
    } finally {
      delete process.env["DISCORD_TOKEN"];
      await rm(dir, { recursive: true, force: true });
    }
  });
});
