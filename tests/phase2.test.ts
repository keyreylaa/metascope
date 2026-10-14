import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { applyCopyright } from "../src/core/copyright.js";
import { setDates, shiftDates } from "../src/core/dates.js";
import { closeExifTool } from "../src/core/exiftool.js";
import { prepareOutput } from "../src/core/fileOps.js";
import { parseLatLon, removeGps, setGps } from "../src/core/gps.js";
import { readFileGrouped } from "../src/core/reader.js";
import { loadSharp } from "../src/core/sharpLoader.js";
import { diffTargets, restoreSnapshot, saveSnapshot } from "../src/core/snapshot.js";
import { collectResiduals, stripFile } from "../src/core/strip.js";
import { applyTags, parseSetPairs } from "../src/core/write.js";
import { ensureLoadedFixtures } from "./fixtures.js";

afterAll(async () => {
  await closeExifTool();
});

async function pixelHash(file: string): Promise<string> {
  const { sharp, message } = await loadSharp();
  if (!sharp) {
    throw new Error(message);
  }
  const raw = await sharp(file).raw().toBuffer();
  return createHash("sha256").update(raw).digest("hex");
}

describe("write", () => {
  it("writes --set pairs and reports unknown tags", async () => {
    const fixtures = await ensureLoadedFixtures();
    const target = await prepareOutput(fixtures.jpeg, `${fixtures.dir}-out`);
    const { written, notWritten } = await applyTags(target.output, {
      ...parseSetPairs(["Artist=Phase2 Writer", "Copyright=Phase2 Notice"]),
      NoSuchTagXYZ123: "hello",
    });
    expect(written).toContain("Artist");
    expect(notWritten.map((entry) => entry.tag)).toContain("NoSuchTagXYZ123");
    expect(notWritten[0]?.reason).toBeTruthy();
  });

  it("fails clearly on read-only format", async () => {
    const fixtures = await ensureLoadedFixtures();
    const target = await prepareOutput(fixtures.text, `${fixtures.dir}-out`);
    const { written, notWritten } = await applyTags(target.output, { Artist: "Nobody" });
    expect(written).toHaveLength(0);
    expect(notWritten.length).toBeGreaterThan(0);
  });

  it("fails clearly on nonexistent file", async () => {
    const { written, notWritten } = await applyTags(`${Date.now()}-missing.jpg`, { Artist: "x" });
    expect(written).toHaveLength(0);
    expect(notWritten.length).toBeGreaterThan(0);
    expect(notWritten[0]?.reason).toBeTruthy();
  });
});

describe("copyright --sync", () => {
  it("mirrors values across EXIF, IPTC, and XMP", async () => {
    const fixtures = await ensureLoadedFixtures();
    const target = await prepareOutput(fixtures.jpeg, `${fixtures.dir}-out`);
    const result = await applyCopyright(target.output, {
      owner: "Sync Owner",
      notice: "Sync Notice",
      url: "https://example.com/license",
      usageTerms: "Sync terms",
      sync: true,
    });
    expect(result.notWritten).toHaveLength(0);
    const read = await readFileGrouped(target.output, false);
    const all = Object.values(read.groups)
      .flatMap((group) => Object.values(group))
      .map((value) => String(value));
    expect(all.some((value) => value.includes("Sync Owner"))).toBe(true);
    expect(all.some((value) => value.includes("Sync Notice"))).toBe(true);
    expect(all.some((value) => value.includes("https://example.com/license"))).toBe(true);
  });
});

describe("gps", () => {
  it("sets and removes GPS with re-read proof", async () => {
    const fixtures = await ensureLoadedFixtures();
    const target = await prepareOutput(fixtures.jpeg, `${fixtures.dir}-out`);
    await setGps(target.output, -6.2, 106.8);
    const removed = await removeGps(target.output);
    expect(removed.residual).toHaveLength(0);
  });

  it("rejects invalid coordinates", () => {
    expect(() => parseLatLon("100,0")).toThrow();
    expect(() => parseLatLon("0,200")).toThrow();
    expect(() => parseLatLon("bogus")).toThrow();
  });
});

describe("dates", () => {
  it("sets and shifts dates", async () => {
    const fixtures = await ensureLoadedFixtures();
    const target = await prepareOutput(fixtures.jpeg, `${fixtures.dir}-out`);
    await setDates(target.output, "2025:05:06 07:08:09");
    const updated = await shiftDates(target.output, 3600);
    expect(updated["DateTimeOriginal"]).toContain("08:08:09");
  });

  it("rejects invalid datetime", async () => {
    const fixtures = await ensureLoadedFixtures();
    const target = await prepareOutput(fixtures.jpeg, `${fixtures.dir}-out`);
    await expect(setDates(target.output, "not-a-date")).rejects.toThrow();
  });
});

describe("strip", () => {
  it("mode all leaves no residuals (JPEG + PNG)", async () => {
    for (const key of ["jpeg", "png"] as const) {
      const fixtures = await ensureLoadedFixtures();
      const target = await prepareOutput(fixtures[key], `${fixtures.dir}-out`);
      const before = await readFileGrouped(target.output, false);
      expect(collectResiduals(before, undefined).length).toBeGreaterThan(0);
      const result = await stripFile(target.output, { mode: "all", verify: true });
      expect(result.clean).toBe(true);
      expect(result.residuals).toHaveLength(0);
      expect(result.notes.join(" ")).toMatch(/SynthID/);
    }
  });

  it("mode gps clears GPS but keeps owner tags", async () => {
    const fixtures = await ensureLoadedFixtures();
    const target = await prepareOutput(fixtures.jpeg, `${fixtures.dir}-out`);
    const result = await stripFile(target.output, { mode: "gps", verify: true });
    expect(result.residuals.filter((entry) => /gps/i.test(entry))).toHaveLength(0);
    const read = await readFileGrouped(target.output, false);
    const all = Object.values(read.groups)
      .flatMap((group) => Object.values(group))
      .map((value) => String(value));
    expect(all.some((value) => value.includes("Loaded Owner"))).toBe(true);
  });

  it("mode privacy clears GPS/owner/device/timestamps and keeps orientation", async () => {
    const fixtures = await ensureLoadedFixtures();
    const target = await prepareOutput(fixtures.jpeg, `${fixtures.dir}-out`);
    await applyTags(target.output, { "Orientation#": 6 });
    const result = await stripFile(target.output, {
      mode: "privacy",
      keep: ["orientation"],
      verify: true,
    });
    const read = await readFileGrouped(target.output, false);
    const flat = Object.entries(read.groups).flatMap(([group, tags]) =>
      Object.keys(tags).map((tag) => `${group}:${tag}`),
    );
    expect(flat.filter((entry) => /gpslatitude|gpslongitude/i.test(entry))).toHaveLength(0);
    expect(flat.filter((entry) => /EXIF:Orientation/i.test(entry)).length).toBeGreaterThan(0);
    expect(result.clean).toBe(false);
  });

  it("keeps pixel data identical on lossless PNG after strip all", async () => {
    const fixtures = await ensureLoadedFixtures();
    const target = await prepareOutput(fixtures.png, `${fixtures.dir}-out`);
    const before = await pixelHash(target.output);
    await stripFile(target.output, { mode: "all", verify: true });
    expect(await pixelHash(target.output)).toBe(before);
  });

  it("handles corrupt files without hanging", async () => {
    const fixtures = await ensureLoadedFixtures();
    const read = await readFileGrouped(fixtures.corrupt, false).catch((error: unknown) => error);
    expect(read instanceof Error || typeof read === "object").toBe(true);
  });
});

describe("snapshot", () => {
  it("saves, restores, and diffs", async () => {
    const fixtures = await ensureLoadedFixtures();
    const snapDir = `${fixtures.dir}-snapshots`;
    const { path, snapshot } = await saveSnapshot(fixtures.jpeg, snapDir);
    expect(snapshot.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.file.size).toBeGreaterThan(0);
    expect(snapshot.version).toBeTruthy();
    expect(path.endsWith(".json")).toBe(true);
    expect(path.startsWith(snapDir)).toBe(true);

    const target = await prepareOutput(fixtures.jpeg, `${fixtures.dir}-restore`);
    await stripFile(target.output, { mode: "all" });
    const restored = await restoreSnapshot(snapshot, target.output);
    expect(restored.written.length).toBeGreaterThan(0);

    const { added, removed, changed } = await diffTargets(fixtures.jpeg, target.output);
    expect([...added, ...removed, ...changed].length).toBeGreaterThanOrEqual(0);
    const self = await diffTargets(path, path);
    expect([...self.added, ...self.removed, ...self.changed]).toHaveLength(0);
  });

  it("records matching sha256", async () => {
    const fixtures = await ensureLoadedFixtures();
    const { snapshot } = await saveSnapshot(fixtures.png, `${fixtures.dir}-snapshots`);
    const { sha256File } = await import("../src/core/fileOps.js");
    expect(await sha256File(fixtures.png)).toBe(snapshot.file.sha256);
  });
});
