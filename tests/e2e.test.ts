import { execFile, spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSharp } from "../src/core/sharpLoader.js";
import { testTmp } from "./fixtures.js";

const TSX = resolve(process.cwd(), "node_modules/.bin/tsx");
const ENTRY = "src/cli/index.ts";

function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((fulfill, reject) => {
    execFile(
      TSX,
      [ENTRY, ...args],
      { cwd: process.cwd(), timeout: 120000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`exit ${String(error)}: ${stdout}\n${stderr}`));
          return;
        }
        fulfill({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

async function paintJpeg(target: string): Promise<void> {
  const { sharp, message } = await loadSharp();
  if (!sharp) {
    throw new Error(message);
  }
  await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .jpeg()
    .toFile(target);
}

describe("cli e2e: batch strip --dry-run", () => {
  it("exits 0, prints dry-run lines, creates no outputs", async () => {
    const dir = testTmp("e2e-batch");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await paintJpeg(join(dir, "a.jpg"));
    const before = await readFile(join(dir, "a.jpg"));
    const { stdout } = await runCli([
      "batch",
      "strip",
      dir,
      "--dry-run",
      "--out",
      join(dir, "out"),
    ]);
    expect(stdout).toMatch(/dry-run/);
    expect(stdout).toContain("a.jpg");
    expect((await readFile(join(dir, "a.jpg"))).equals(before)).toBe(true);
    const leftovers = await readdir(dir);
    expect(leftovers.some((entry) => entry.includes("_clean") || entry.endsWith(".bak"))).toBe(
      false,
    );
  });
});

describe("cli e2e: clean --rename random", () => {
  it("prints the notice, randomizes the name, and resets timestamps", async () => {
    const dir = testTmp("e2e-clean");
    const outDir = testTmp("e2e-clean-out");
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await paintJpeg(join(dir, "named.jpg"));
    const { stdout } = await runCli([
      "clean",
      join(dir, "named.jpg"),
      "--rename",
      "random",
      "--out",
      outDir,
    ]);
    expect(stdout).toContain("Metadata dibersihkan.");
    expect(stdout).toContain("Verify: clean");
    const outputs = await readdir(outDir);
    expect(outputs.some((entry) => /^clean-[0-9a-f]{16}\.jpg$/.test(entry))).toBe(true);
    expect(outputs.some((entry) => entry.includes("named"))).toBe(false);
    const { stat } = await import("node:fs/promises");
    const info = await stat(
      join(
        outDir,
        outputs.find((entry) => entry.startsWith("clean-"))!,
      ),
    );
    expect(Date.now() - info.mtimeMs).toBeLessThan(120000);
  });
});

describe("cli e2e: watch", () => {
  it("scans a dropped file and writes a sidecar", async () => {
    const dir = testTmp("e2e-watch");
    const outDir = testTmp("e2e-watch-out");
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const child = spawn(TSX, [ENTRY, "watch", dir, "--debounce-ms", "150", "--out", outDir], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output += String(chunk);
    });
    const deadline = Date.now() + 90000;
    try {
      while (!output.includes("Watching 1 director") && Date.now() < deadline) {
        await new Promise((fulfill) => setTimeout(fulfill, 200));
      }
      expect(output).toContain("Watching 1 director");
      await paintJpeg(join(dir, "drop.jpg"));
      while (!output.includes("drop.jpg") && Date.now() < deadline) {
        await new Promise((fulfill) => setTimeout(fulfill, 300));
      }
      expect(output).toContain("drop.jpg");
      const sidecars = await readdir(outDir);
      expect(sidecars.some((entry) => entry.includes("drop") && entry.endsWith(".json"))).toBe(
        true,
      );
      const sidecar = sidecars.find((entry) => entry.includes("drop"))!;
      const parsed = JSON.parse(await readFile(join(outDir, sidecar), "utf8")) as {
        aiVerdict: string;
      };
      expect(typeof parsed.aiVerdict).toBe("string");
    } finally {
      child.kill("SIGINT");
      await new Promise((fulfill) => setTimeout(fulfill, 2000));
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }
  }, 120000);
});
