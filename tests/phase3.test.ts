import { afterAll, describe, expect, it } from "vitest";
import { aiCheck } from "../src/core/aiCheck.js";
import { configSchema, resolveSnapshotDir } from "../src/core/config.js";
import { closeExifTool } from "../src/core/exiftool.js";
import { hammingDistanceHex, hashFile, similarityVerdict } from "../src/core/hash.js";
import { detectFormat } from "../src/core/magic.js";
import { parseAutomatic1111 } from "../src/core/aiCheck.js";
import { parsePngText, crc32 } from "../src/core/pngText.js";
import { privacyScan } from "../src/core/privacy.js";
import { readFileGrouped } from "../src/core/reader.js";
import { A1111_PARAMETERS, buildCompressedTextChunk, ensurePhase3Fixtures } from "./fixtures.js";

afterAll(async () => {
  await closeExifTool();
});

describe("magic bytes", () => {
  it("detects formats without trusting extensions", async () => {
    const fixtures = await ensurePhase3Fixtures();
    const { readFile } = await import("node:fs/promises");
    expect(detectFormat((await readFile(fixtures.a1111)).subarray(0, 64)).format).toBe("png");
    expect(detectFormat((await readFile(fixtures.camera)).subarray(0, 64)).format).toBe("jpeg");
    expect(detectFormat((await readFile(fixtures.plainWebp)).subarray(0, 64)).format).toBe("webp");
    expect(
      detectFormat(Buffer.from([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]))
        .format,
    ).toBe("avif");
    expect(detectFormat(Buffer.from("plain text pretending"))).toEqual({ format: "unknown" });
  });
});

describe("png text chunks", () => {
  it("round-trips ExifTool-written parameters", async () => {
    const fixtures = await ensurePhase3Fixtures();
    const { readFile } = await import("node:fs/promises");
    const { texts } = parsePngText(await readFile(fixtures.a1111));
    const params = texts.find((entry) => entry.keyword.toLowerCase() === "parameters");
    expect(params?.text).toContain("Seed: 123456");
  });

  it("parses deflated zTXt", () => {
    const chunk = buildCompressedTextChunk("comment", "hello compressed world");
    const parsed = parsePngText(
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk,
        Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
      ]),
    );
    expect(parsed.isPng).toBe(true);
    expect(parsed.texts[0]).toMatchObject({ keyword: "comment", text: "hello compressed world" });
    expect(crc32(Buffer.from("123456789"), 0, 9)).toBe(0xcbf43926);
  });
});

describe("a1111 parser", () => {
  it("extracts prompt, seed, sampler, steps, model", () => {
    const parsed = parseAutomatic1111(A1111_PARAMETERS);
    expect(parsed?.prompt).toContain("a cat sitting on a mat");
    expect(parsed?.negativePrompt).toContain("blurry");
    expect(parsed?.seed).toBe("123456");
    expect(parsed?.sampler).toBe("Euler a");
    expect(parsed?.steps).toBe("20");
    expect(parsed?.model).toBe("realisticVisionV51");
    expect(parsed?.modelHash).toBe("ab12cd34");
  });
});

describe("ai-check detectors", () => {
  it("confirms A1111, ComfyUI, and DigitalSourceType fixtures", async () => {
    const fixtures = await ensurePhase3Fixtures();
    for (const file of [fixtures.a1111, fixtures.comfy, fixtures.aiXmp]) {
      const read = await readFileGrouped(file, false);
      const result = await aiCheck(file, read.groups);
      expect(result.verdict).toBe("confirmed_by_metadata");
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.disclaimer).toMatch(/SynthID/);
    }
  });

  it("marks vendor heuristics as likely and camera EXIF as no_evidence", async () => {
    const fixtures = await ensurePhase3Fixtures();
    const mid = await aiCheck(
      fixtures.midjourney,
      (await readFileGrouped(fixtures.midjourney, false)).groups,
    );
    expect(mid.verdict).toBe("likely");
    const cam = await aiCheck(
      fixtures.camera,
      (await readFileGrouped(fixtures.camera, false)).groups,
    );
    expect(cam.verdict).toBe("no_evidence");
    expect(cam.evidence.some((item) => item.confidence === "counter")).toBe(true);
  });
});

describe("hash", () => {
  it("computes file, pixel, and perceptual hashes with compare verdicts", async () => {
    const fixtures = await ensurePhase3Fixtures();
    const first = await hashFile(fixtures.a1111);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.md5).toMatch(/^[0-9a-f]{32}$/);
    expect(first.pixelSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.ahash).toMatch(/^[0-9a-f]{16}$/);
    expect(first.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(first.phash).toMatch(/^[0-9a-f]{16}$/);
    const same = await hashFile(fixtures.a1111);
    expect(hammingDistanceHex(first.ahash!, same.ahash!)).toBe(0);
    expect(similarityVerdict(0)).toBe("identical");
    const other = await hashFile(fixtures.camera);
    const distance = hammingDistanceHex(first.ahash!, other.ahash!);
    expect(similarityVerdict(distance)).toBeTruthy();
    expect(first.note).toBeNull();
  });
});

describe("privacy-scan", () => {
  it("flags location as critical and serials as high with a clean suggestion", async () => {
    const fixtures = await ensurePhase3Fixtures();
    const read = await readFileGrouped(fixtures.camera, false);
    const result = await privacyScan(fixtures.camera, read.groups);
    const byCategory = new Map(
      result.findings.map((finding) => [finding.category, finding.severity]),
    );
    expect(byCategory.get("gps")).toBe("critical");
    expect(byCategory.get("serial")).toBe("high");
    expect(result.suggestedCommand).toContain("metascope clean");
  });

  it("never reports ICC profile strings as owner findings", async () => {
    const groups = {
      ICC_Profile: {
        ProfileCopyright: "Google Inc. 2016",
        ProfileDescription: "sRGB",
      },
      JFIF: { JFIFVersion: "1.01" },
      File: { FileType: "JPEG" },
    };
    const result = await privacyScan("plain-srgb.jpg", groups);
    const highs = result.findings.filter(
      (finding) => finding.severity === "critical" || finding.severity === "high",
    );
    expect(highs).toHaveLength(0);
    expect(result.findings.map((finding) => finding.category)).toContain("icc");
  });
});

describe("config", () => {
  it("honors the snapshot env var and validates config", () => {
    process.env["METASCOPE_SNAPSHOT_DIR"] = "/tmp/ms-test-snaps";
    expect(resolveSnapshotDir()).toBe("/tmp/ms-test-snaps");
    delete process.env["METASCOPE_SNAPSHOT_DIR"];
    expect(configSchema.safeParse({ concurrency: 99 }).success).toBe(false);
    expect(configSchema.safeParse({ outputDir: "out", concurrency: 8 }).success).toBe(true);
  });
});
