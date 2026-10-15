import type { Command } from "commander";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { rm } from "node:fs";
import { createHash } from "node:crypto";
import { getModelInfo, isModelInstalled, bufferToBlob } from "../core/detectors/mlPixel.js";

const HF_REPO = "onnx-community/ai-image-detect-distilled-ONNX";
const HF_FILE = "onnx/model.onnx";
const MODEL_INFO = getModelInfo();

function getModelDir(): string {
  const xdgData = process.env["XDG_DATA_HOME"] || join(homedir(), ".local", "share");
  return join(xdgData, "metascope", "models", HF_REPO);
}

function getModelPath(): string {
  return join(getModelDir(), HF_FILE);
}

async function downloadModel(): Promise<void> {
  const modelDir = getModelDir();
  await mkdir(modelDir, { recursive: true });
  const modelPath = getModelPath();

  console.log(`Mengunduh model dari Hugging Face: ${HF_REPO}/${HF_FILE}`);
  console.log(`Ukuran: ~${(MODEL_INFO.size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Lisensi: ${MODEL_INFO.license}`);
  console.log(`Target: ${modelPath}`);

  const { pipeline, env } = await import("@huggingface/transformers");

  env.localModelPath = modelDir;
  env.allowRemoteModels = true;

  try {
    interface PipelineOptions {
      device?: string;
      localModelPath?: string;
    }
    /* @ts-expect-error pipeline type varies by transformers version */
    await pipeline("image-classification", HF_REPO, {
      device: "cpu",
      localModelPath: modelDir,
    } as PipelineOptions);
    console.log("Model berhasil diunduh dan diverifikasi.");
  } catch (err) {
    console.error("Gagal mengunduh model:", err instanceof Error ? err.message : String(err));
    // @ts-expect-error rm options type varies in Node.js types
    await rm(modelDir, { recursive: true, force: true });
    throw err;
  }
}

async function verifyModel(): Promise<boolean> {
  const modelPath = getModelPath();
  if (!(await isModelInstalled())) {
    return false;
  }

  const buffer = await readFile(modelPath);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const expected = MODEL_INFO.sha256;

  if (hash !== expected) {
    console.error(`SHA256 tidak cocok!`);
    console.error(`  Diharapkan: ${expected}`);
    console.error(`  Ditemukan:  ${hash}`);
    return false;
  }

  console.log(`SHA256 verified: ${hash}`);
  return true;
}

async function testModel(): Promise<void> {
  console.log("Testing model inference...");
  const { pipeline, env, RawImage } = await import("@huggingface/transformers");

  const modelDir = getModelDir();
  env.localModelPath = modelDir;
  env.allowRemoteModels = false;

  const pipe = await pipeline("image-classification", getModelPath(), { device: "cpu" });

  const testBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const testBlob = bufferToBlob(testBuffer);
  const testImage = await RawImage.fromBlob(testBlob);
  const result = await pipe(testImage);
  console.log("Test inference OK:", result);
}

export function registerModelsCommand(program: Command): void {
  const modelsCmd = program.command("models").description("Manage ML models for AI detection");

  modelsCmd
    .command("install")
    .description("Download and install the AI detection model")
    .action(async () => {
      const info = getModelInfo();
      console.log("=== Model Info ===");
      console.log(`Repository: ${info.repo}`);
      console.log(`File: ${info.filename}`);
      console.log(`Ukuran: ${(info.size / 1024 / 1024).toFixed(1)} MB`);
      console.log(`Lisensi: ${info.license}`);
      console.log(`Labels: ${info.labels.join(", ")}`);
      console.log(`Input size: ${info.inputSize}x${info.inputSize}`);
      console.log(`Preprocessing: ${JSON.stringify(info.preprocessing)}`);
      console.log("");

      if (await isModelInstalled()) {
        console.log(
          "Model sudah terpasang. Gunakan 'ms models remove' dulu kalau mau install ulang.",
        );
        return;
      }

      const readline = await import("node:readline/promises");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await rl.question("Lanjutkan download? [y/N] ");
      rl.close();

      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.log("Dibatalkan.");
        return;
      }

      await downloadModel();
      const ok = await verifyModel();
      if (!ok) {
        console.error("Verifikasi gagal. Model dihapus.");
        process.exitCode = 1;
        return;
      }
      await testModel();
      console.log("Model siap dipakai!");
    });

  modelsCmd
    .command("list")
    .description("List installed models")
    .action(async () => {
      const installed = await isModelInstalled();
      if (!installed) {
        console.log("Belum ada model terpasang.");
        console.log("Jalankan: ms models install");
        return;
      }

      const modelPath = getModelPath();
      const { stat } = await import("node:fs/promises");
      const stats = await stat(modelPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

      const buffer = await readFile(modelPath);
      const hash = createHash("sha256").update(buffer).digest("hex");

      console.log("=== Installed Model ===");
      console.log(`Repository: ${HF_REPO}`);
      console.log(`Path: ${modelPath}`);
      console.log(`Size: ${sizeMB} MB`);
      console.log(`SHA256: ${hash}`);
      console.log(`License: ${MODEL_INFO.license}`);
      console.log(`Modified: ${stats.mtime.toISOString()}`);
    });

  modelsCmd
    .command("remove")
    .description("Remove installed model")
    .option("--yes", "skip confirmation")
    .action(async (options: { yes?: boolean }) => {
      if (!(await isModelInstalled())) {
        console.log("Tidak ada model terpasang.");
        return;
      }

      if (!options.yes) {
        const readline = await import("node:readline/promises");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await rl.question("Hapus model? [y/N] ");
        rl.close();
        if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
          console.log("Dibatalkan.");
          return;
        }
      }

      const modelDir = getModelDir();
      // @ts-expect-error rm options type varies in Node.js types
      await rm(modelDir, { recursive: true, force: true });
      console.log("Model dihapus.");
    });

  modelsCmd
    .command("verify")
    .description("Verify installed model integrity")
    .action(async () => {
      if (!(await isModelInstalled())) {
        console.log("Model tidak terpasang.");
        process.exitCode = 1;
        return;
      }
      const ok = await verifyModel();
      if (ok) {
        console.log("Model valid.");
      } else {
        console.error("Model rusak atau dimodifikasi.");
        process.exitCode = 1;
      }
    });
}
