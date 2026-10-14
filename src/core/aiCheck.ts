import { c2paDetector } from "./detectors/c2pa.js";
import { generatorDetector, type GeneratorParams } from "./detectors/generators.js";
import { cameraDetector, vendorDetector, weakDetector } from "./detectors/heuristics.js";
import { digitalSourceDetector } from "./detectors/provenance.js";

export type { GeneratorParams };
export { parseAutomatic1111 } from "./detectors/generators.js";

import { readFile } from "node:fs/promises";
import { parsePngText, type PngText } from "./pngText.js";

export type AiVerdict = "confirmed_by_metadata" | "likely" | "possible" | "no_evidence";

export type Confidence = "confirmed" | "likely" | "possible" | "weak" | "counter";

export interface Evidence {
  signal: string;
  source: string;
  confidence: Confidence;
  details: string;
}

export interface DetectorContext {
  file: string;
  groups: Record<string, Record<string, unknown>>;
  pngTexts: PngText[];
}

export interface Detector {
  id: string;
  run: (ctx: DetectorContext) => Promise<Evidence[]> | Evidence[];
}

export const AI_DISCLAIMER =
  "Absence of metadata does NOT prove an image is real (screenshots and social uploads strip it), " +
  "and invisible watermarks like SynthID cannot be detected offline.";

function textOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

export function flatEntries(groups: Record<string, Record<string, unknown>>): [string, string][] {
  const entries: [string, string][] = [];
  for (const [group, tags] of Object.entries(groups)) {
    for (const [tag, value] of Object.entries(tags)) {
      entries.push([`${group}:${tag}`, textOf(value)]);
    }
  }
  return entries;
}

export const DEFAULT_DETECTORS: Detector[] = [
  c2paDetector,
  digitalSourceDetector,
  generatorDetector,
  vendorDetector,
  cameraDetector,
  weakDetector,
];

const LEVEL: Record<Confidence, number> = {
  confirmed: 3,
  likely: 2,
  possible: 1,
  weak: 0.5,
  counter: -1,
};

export function verdictFor(evidence: Evidence[]): AiVerdict {
  let best = 0;
  let hasCounter = false;
  for (const item of evidence) {
    if (item.confidence === "counter") {
      hasCounter = true;
      continue;
    }
    best = Math.max(best, LEVEL[item.confidence]);
  }
  if (best >= 3) {
    return "confirmed_by_metadata";
  }
  if (best >= 2) {
    return "likely";
  }
  if (best >= 1) {
    return "possible";
  }
  if (best >= 0.5 && !hasCounter) {
    return "possible";
  }
  return "no_evidence";
}

export interface AiResult {
  file: string;
  verdict: AiVerdict;
  evidence: Evidence[];
  disclaimer: string;
}

export async function aiCheck(
  file: string,
  groups: Record<string, Record<string, unknown>>,
  detectors: Detector[] = DEFAULT_DETECTORS,
): Promise<AiResult> {
  let pngTexts: PngText[] = [];
  if (file.toLowerCase().endsWith(".png")) {
    try {
      const buffer = await readFile(file);
      pngTexts = parsePngText(buffer).texts;
    } catch {
      pngTexts = [];
    }
  }
  const ctx: DetectorContext = { file, groups, pngTexts };
  const evidence: Evidence[] = [];
  for (const detector of detectors) {
    evidence.push(...(await detector.run(ctx)));
  }
  return { file, verdict: verdictFor(evidence), evidence, disclaimer: AI_DISCLAIMER };
}
