import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { renderBatchCsv, runBatchStrip, runBatchWrite } from "../src/core/batch.js";
import { closeExifTool } from "../src/core/exiftool.js";
import { ensureLoadedFixtures, testTmp } from "./fixtures.js";

afterAll(async () => {
  await closeExifTool();
});

function shaOf(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

describe("batch strip", () => {
  it("dry-runs without touching anything", async () => {
    const fixtures = await ensureLoadedFixtures(testTmp("batch-dry"));
    const before = shaOf(await readFile(fixtures.jpeg));
    const results = await runBatchStrip([fixtures.dir], { mode: "privacy", dryRun: true });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((item) => item.status === "dry-run")).toBe(true);
    expect(results.every((item) => item.output === null)).toBe(true);
    expect(shaOf(await readFile(fixtures.jpeg))).toBe(before);
  });

  it("strips a directory with concurrency and reports residuals", async () => {
    const fixtures = await ensureLoadedFixtures(testTmp("batch-real"));
    const outDir = testTmp("batch-real-out");
    const results = await runBatchStrip([fixtures.dir], {
      mode: "gps",
      verify: true,
      out: outDir,
      concurrency: 2,
    });
    expect(results.length).toBe(4);
    expect(results.every((item) => item.status === "ok" || item.status === "error")).toBe(true);
    expect(
      results
        .filter((item) => item.status === "ok")
        .every((item) => (item.output ?? "").startsWith(outDir)),
    ).toBe(true);
    const csv = renderBatchCsv(results);
    expect(csv.split("\n")[0]).toBe("file,status,detail,output");
  });
});

describe("batch write", () => {
  it("dry-runs and then writes across files", async () => {
    const fixtures = await ensureLoadedFixtures(testTmp("batch-write"));
    const dry = await runBatchWrite([fixtures.dir], { set: ["Artist=Batch Writer"], dryRun: true });
    expect(dry.every((item) => item.status === "dry-run")).toBe(true);
    const outDir = testTmp("batch-write-out");
    const real = await runBatchWrite([fixtures.dir], {
      set: ["Artist=Batch Writer"],
      out: outDir,
      concurrency: 2,
    });
    expect(real.every((item) => item.status === "ok")).toBe(true);
    expect(real.every((item) => (item.output ?? "").includes("_edited"))).toBe(true);
  });

  it("rejects empty --set", async () => {
    await expect(runBatchWrite(["."], { set: [] })).rejects.toThrow();
  });
});
