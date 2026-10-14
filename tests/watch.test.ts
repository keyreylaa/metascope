import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { closeExifTool } from "../src/core/exiftool.js";
import { renderHtml } from "../src/core/report.js";
import { collectWatchDirs, watchPaths } from "../src/core/watch.js";
import { testTmp } from "./fixtures.js";

afterAll(async () => {
  await closeExifTool();
});

describe("collectWatchDirs", () => {
  it("recurses, skips ignored dirs, and honors depth", async () => {
    const root = testTmp("watch-dirs");
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
    await mkdir(join(root, "a", "b"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    const all = await collectWatchDirs([root], {});
    expect(all).toContain(root);
    expect(all).toContain(join(root, "a"));
    expect(all).toContain(join(root, "a", "b"));
    expect(all.some((dir) => dir.includes("node_modules") || dir.endsWith(".git"))).toBe(false);
    const shallow = await collectWatchDirs([root], { depth: 1 });
    expect(shallow).toContain(join(root, "a"));
    expect(shallow).not.toContain(join(root, "a", "b"));
  });
});

describe("watchPaths", () => {
  it("delivers new files debounced and stops on close", async () => {
    const root = testTmp("watch-live");
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    const seen: string[] = [];
    const handle = await watchPaths([root], { debounceMs: 100 }, (file) => {
      seen.push(file);
    });
    expect(handle.dirs).toContain(root);
    await writeFile(join(root, "dropped.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0x00]));
    await new Promise((fulfill) => setTimeout(fulfill, 1500));
    await handle.close();
    expect(seen).toContain(join(root, "dropped.jpg"));
  });
});

describe("renderHtml", () => {
  it("is self-contained and escapes user data", () => {
    const evil = '<script>alert("x")</script>.jpg';
    const html = renderHtml({
      tool: "metascope",
      version: "0.1.0",
      createdAt: "2026-01-01T00:00:00Z",
      root: "/tmp/<evil>",
      summary: {
        files: 1,
        withGps: 0,
        withSerials: 0,
        withC2pa: 0,
        verdicts: { confirmed_by_metadata: 0, likely: 0, possible: 0, no_evidence: 1 },
        errors: 0,
      },
      files: [
        {
          file: evil,
          format: "unknown",
          sha256: null,
          md5: null,
          pixelSha256: null,
          ahash: null,
          dhash: null,
          phash: null,
          hashesNote: null,
          groups: null,
          pngChunks: [],
          errors: ["<b>oops</b>"],
          privacy: [{ category: "<i>gps</i>", severity: "high", detail: "a&b" }],
          aiVerdict: "no_evidence",
          aiEvidence: [],
          scanError: "bad <thing>",
        },
      ],
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a&amp;b");
    expect(html).not.toContain('src="http');
    expect(html).not.toContain("<link");
    expect(html).toContain("<table>");
  });
});
