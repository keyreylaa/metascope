import type { Detector, Evidence } from "../aiCheck.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

// Model config
const MODEL_REPO = "onnx-community/ai-image-detect-distilled-ONNX";
const MODEL_FILENAME = "onnx/model.onnx";
const MODEL_SIZE = 58410332;
const MODEL_SHA256 = "87b4331f22418a4cb50901851a1c28f64a0ca4f58728442d073b4bed9922ba86";
const MODEL_LICENSE = "MIT";

// Lazy-loaded pipeline (undefined until first use)
let mlPipeline: unknown = null;
let loadError: string | null = null;

async function getModelPath(): Promise<string | null> {
  const xdgData = process.env["XDG_DATA_HOME"] || join(homedir(), ".local", "share");
  const modelDir = join(xdgData, "metascope", "models", MODEL_REPO);
  const modelPath = join(modelDir, MODEL_FILENAME);
  if (existsSync(modelPath)) {
    return modelPath;
  }
  return null;
}

async function loadMLPipeline(): Promise<unknown> {
  if (mlPipeline) return mlPipeline;
  if (loadError) throw new Error(loadError);

  let transformers: unknown;
  try {
    transformers = await import("@huggingface/transformers");
  } catch (err) {
    loadError = `Transformers failed to load: ${err instanceof Error ? err.message : String(err)}`;
    throw new Error(loadError, { cause: err });
  }

  try {
    const { pipeline, env } = transformers as {
      pipeline: (task: string, model: string, options: { device: string }) => Promise<unknown>;
      env: { localModelPath: string; allowRemoteModels: boolean };
    };
    const modelPath = await getModelPath();

    if (!modelPath) {
      loadError = "Model not installed. Run: ms models install";
      throw new Error(loadError);
    }

    env.localModelPath = join(modelPath, "..", "..");
    env.allowRemoteModels = false;

    mlPipeline = await pipeline("image-classification", modelPath, {
      device: "cpu",
    });

    return mlPipeline;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

// Convert Buffer to Blob for RawImage.fromBlob
// Node.js 22 supports Blob constructor in ESM
function bufferToBlob(buffer: Buffer): Blob {
  // Create Blob from Buffer - this works in Node.js 22 ESM
  // @ts-expect-error - Blob constructor type may not be perfectly typed
  return new Blob([buffer]);
}

export { bufferToBlob };

export const mlPixelDetector: Detector = {
  id: "ml-pixel-classifier",
  run: async (ctx): Promise<Evidence[]> => {
    // Phase 1: Try to load pipeline
    try {
      // Load pipeline to lazy-initialize it (side effect)
      await loadMLPipeline();
    } catch {
      return [
        {
          signal: "ML detector tidak aktif",
          source: "ml-pixel-classifier",
          confidence: "weak",
          details:
            "Model tidak terpasang. Jalankan 'ms models install' untuk mengaktifkan deteksi berbasis piksel.",
        },
      ];
    }

    try {
      const buffer = await readFile(ctx.file);
      const blob = bufferToBlob(buffer);

      // Load RawImage from transformers
      let RawImage: unknown;
      try {
        const mod = await import("@huggingface/transformers");
        RawImage = mod.RawImage;
      } catch {
        return [
          {
            signal: "ML inference gagal",
            source: "ml-pixel-classifier",
            confidence: "weak",
            details: "Transformers module unavailable (native runtime issue).",
          },
        ];
      }

      // RawImage.fromBlob accepts Blob | Buffer
      let image: unknown;
      try {
        // RawImage type varies; using Function call to avoid explicit any
        image = await (RawImage as { fromBlob: (b: Blob) => Promise<unknown> }).fromBlob(blob);
      } catch {
        // Fallback: try passing buffer directly as blob
        image = await (RawImage as { fromBlob: (b: Blob) => Promise<unknown> }).fromBlob(
          bufferToBlob(buffer),
        );
      }

      // @ts-expect-error mlPipeline is of type unknown - needs assertion for dev compatibility
      const result = await mlPipeline(image);

      if (!result || !Array.isArray(result) || result.length === 0) {
        return [
          {
            signal: "ML inference returned no result",
            source: "ml-pixel-classifier",
            confidence: "weak",
            details: "Pipeline returned empty result.",
          },
        ];
      }

      // Parse results - model labels are "fake" / "real"
      const typedResult = result as Array<{ label: string; score: number }>;
      const fakeScore = typedResult.find((r) => r.label.toLowerCase() === "fake")?.score || 0;
      const realScore = typedResult.find((r) => r.label.toLowerCase() === "real")?.score || 0;

      const isAi = fakeScore > realScore;
      const confidence = Math.max(fakeScore, realScore);

      const evidence: Evidence[] = [
        {
          signal: isAi
            ? "Kemungkinan AI-generated (pixel-level)"
            : "Kemungkinan real (pixel-level)",
          source: "ml-pixel-classifier",
          confidence: "possible",
          details: `fake=${fakeScore.toFixed(4)}, real=${realScore.toFixed(4)}. Model: ${MODEL_REPO}. INI ESTIMASI STATISTIK, BISA SALAH (false positive/negative), terutama pada gambar yang dikompres, di-resize, atau dari generator baru. Tidak menggantikan bukti provenance. Watermark tak kasat mata seperti SynthID tidak bisa dideteksi offline.`,
        },
      ];

      if (confidence < 0.6) {
        evidence.push({
          signal: "ML confidence rendah",
          source: "ml-pixel-classifier",
          confidence: "weak",
          details: `Skor tertinggi ${confidence.toFixed(4)} (< 0.6). Hasil tidak dapat diandalkan.`,
        });
      }

      return evidence;
    } catch (err) {
      return [
        {
          signal: "ML inference gagal",
          source: "ml-pixel-classifier",
          confidence: "weak",
          details: err instanceof Error ? err.message : String(err),
        },
      ];
    }
  },
};

export function isModelInstalled(): Promise<boolean> {
  return getModelPath().then((p) => p !== null);
}

export function getModelInfo() {
  return {
    repo: MODEL_REPO,
    filename: MODEL_FILENAME,
    size: MODEL_SIZE,
    sha256: MODEL_SHA256,
    license: MODEL_LICENSE,
    labels: ["fake", "real"],
    inputSize: 224,
    preprocessing: {
      resize: "224x224",
      normalize: "mean=[0.5,0.5,0.5], std=[0.5,0.5,0.5]",
      rescale: "1/255",
      channelOrder: "RGB",
    },
  };
}
