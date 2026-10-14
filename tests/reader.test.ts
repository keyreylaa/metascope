import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkPerl, closeExifTool } from "../src/core/exiftool.js";
import { formatJson, formatMarkdown, formatTable } from "../src/core/formatters.js";
import { resolveInputs } from "../src/core/inputs.js";
import { groupTags, readFileGrouped } from "../src/core/reader.js";
import { readOptionsSchema } from "../src/core/schemas.js";
import { loadSharp } from "../src/core/sharpLoader.js";
import { extractThumbnails } from "../src/core/thumbnail.js";
import { ensureFixtures } from "./fixtures.js";

afterAll(async () => {
  await closeExifTool();
});

describe("perl environment", () => {
  it("detects Perl on Linux", async () => {
    const result = await checkPerl();
    expect(result.ok).toBe(true);
  });
});

describe("sharp optional dependency", () => {
  it("loads on this host or reports a clear message", async () => {
    const { sharp, message } = await loadSharp();
    if (!sharp) {
      expect(message).toMatch(/optional dependency/i);
    } else {
      expect(typeof sharp).toBe("function");
    }
  });
});

describe("schemas", () => {
  it("accepts valid read options", () => {
    const parsed = readOptionsSchema.safeParse({ format: "json", raw: false, thumbnail: false });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown format", () => {
    const parsed = readOptionsSchema.safeParse({ format: "xml", raw: false, thumbnail: false });
    expect(parsed.success).toBe(false);
  });
});

describe("groupTags", () => {
  it("groups prefixed keys by namespace", () => {
    const grouped = groupTags("a.jpg", {
      SourceFile: "a.jpg",
      "EXIF:Make": "Canon",
      "XMP:Title": "hi",
      GPSLatitude: 1.5,
    });
    expect(grouped.groups["File"]?.["SourceFile"]).toBe("a.jpg");
    expect(grouped.groups["EXIF"]?.["Make"]).toBe("Canon");
    expect(grouped.groups["XMP"]?.["Title"]).toBe("hi");
    expect(grouped.groups["GPS"]?.["GPSLatitude"]).toBe(1.5);
  });
});

describe("reader with generated fixtures", () => {
  it("reads JPEG fixture and finds written tags", async () => {
    const { sharp } = await loadSharp();
    if (!sharp) {
      console.warn("Skipping fixture test: sharp unavailable.");
      return;
    }
    const fixtures = await ensureFixtures();
    const jpegInfo = await stat(fixtures.jpeg);
    expect(jpegInfo.isFile()).toBe(true);

    const read = await readFileGrouped(fixtures.jpeg, false);
    expect(read.groups["File"]).toBeDefined();
    const flatValues = Object.values(read.groups)
      .flatMap((group) => Object.values(group))
      .map((value) => String(value));
    expect(flatValues.some((value) => value.includes("Metascope"))).toBe(true);
  });

  it("reads PNG fixture and lists PNG chunks", async () => {
    const { sharp } = await loadSharp();
    if (!sharp) {
      console.warn("Skipping fixture test: sharp unavailable.");
      return;
    }
    const fixtures = await ensureFixtures();
    const read = await readFileGrouped(fixtures.png, false);
    expect(read.isPng).toBe(true);
    const types = read.pngChunks.map((chunk) => chunk.type);
    expect(types).toContain("IHDR");
    expect(types).toContain("IEND");
  });

  it("supports raw numeric mode", async () => {
    const { sharp } = await loadSharp();
    if (!sharp) {
      return;
    }
    const fixtures = await ensureFixtures();
    const cooked = await readFileGrouped(fixtures.jpeg, false);
    const raw = await readFileGrouped(fixtures.jpeg, true);
    expect(cooked.groups["File"]).toBeDefined();
    expect(raw.groups["File"]).toBeDefined();
  });

  it("thumbnail extraction degrades gracefully when none embedded", async () => {
    const { sharp } = await loadSharp();
    if (!sharp) {
      return;
    }
    const fixtures = await ensureFixtures();
    const result = await extractThumbnails(fixtures.jpeg, `${fixtures.dir}-thumbs`);
    expect(result.file).toBe(fixtures.jpeg);
    expect(result.extracted.length + result.skipped.length).toBeGreaterThan(0);
  });

  it("resolveInputs expands globs", async () => {
    const { sharp } = await loadSharp();
    if (!sharp) {
      return;
    }
    const fixtures = await ensureFixtures();
    const matched = await resolveInputs([`${fixtures.dir}/*.jpg`]);
    expect(matched.map((entry) => resolve(entry))).toContain(fixtures.jpeg);
  });

  it("formatters include file and groups", async () => {
    const { sharp } = await loadSharp();
    if (!sharp) {
      return;
    }
    const fixtures = await ensureFixtures();
    const read = await readFileGrouped(fixtures.jpeg, false);
    expect(formatJson([read])).toContain(fixtures.jpeg);
    expect(formatTable([read])).toContain("File:");
    expect(formatMarkdown([read])).toContain("# ");
  });

  it("fails clearly on missing file", async () => {
    await expect(readFileGrouped(`${Date.now()}-missing.jpg`, false)).rejects.toThrow();
  });
});
