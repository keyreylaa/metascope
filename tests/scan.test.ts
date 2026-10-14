import { stat } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import { closeExifTool } from "../src/core/exiftool.js";
import { renderCsv, renderMarkdown } from "../src/core/report.js";
import { scanBuffer, scanInputs } from "../src/core/scan.js";
import { zipFiles } from "../src/core/zip.js";
import { ensurePhase3Fixtures, testTmp } from "./fixtures.js";

afterAll(async () => {
  await closeExifTool();
});

const SCAN_DIR = testTmp("scan-mix");

describe("scan folder", () => {
  it("aggregates metadata, privacy, AI, and hashes with errors isolated", async () => {
    const fixtures = await ensurePhase3Fixtures(SCAN_DIR);
    const report = await scanInputs([fixtures.dir], { concurrency: 2 });
    expect(report.files.length).toBe(8);
    expect(report.summary.errors).toBe(2);
    expect(report.summary.withGps).toBe(1);
    expect(report.summary.withSerials).toBe(1);
    expect(report.summary.verdicts.confirmed_by_metadata).toBe(3);
    expect(report.summary.verdicts.likely).toBe(1);
    expect(report.summary.verdicts.no_evidence).toBe(3);
    const errored = report.files.filter((file) => file.scanError);
    expect(errored.length).toBe(2);
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("Files: 8");
    const csv = renderCsv(report);
    expect(csv.split("\n")[0]).toContain("ai_verdict");
  });

  it("scans buffers for thin Discord-style adapters", async () => {
    const fixtures = await ensurePhase3Fixtures(SCAN_DIR);
    const { readFile } = await import("node:fs/promises");
    const result = await scanBuffer(await readFile(fixtures.a1111), "upload.png", {});
    expect(result.aiVerdict).toBe("confirmed_by_metadata");
    expect(result.format).toBe("png");
  });

  it("zips multiple outputs into one archive", async () => {
    const fixtures = await ensurePhase3Fixtures(SCAN_DIR);
    const outZip = `${fixtures.dir}/bundle.zip`;
    await zipFiles([fixtures.a1111, fixtures.camera], outZip);
    expect((await stat(outZip)).size).toBeGreaterThan(0);
    expect(new AdmZip(outZip).getEntries().length).toBe(2);
  });
});
