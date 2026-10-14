import type { Confidence, Detector, Evidence } from "../aiCheck.js";
import { flatEntries } from "../aiCheck.js";

const VENDOR_PATTERNS: [RegExp, string][] = [
  [/midjourney/i, "Midjourney"],
  [/dall-?e|openai|gpt image/i, "DALL-E / GPT image"],
  [/firefly|adobe/i, "Adobe Firefly"],
  [/imagen|gemini|google/i, "Gemini / Imagen"],
  [/leonardo/i, "Leonardo"],
];

export const vendorDetector: Detector = {
  id: "vendor-heuristics",
  run: (ctx) => {
    const out: Evidence[] = [];
    for (const [key, value] of flatEntries(ctx.groups)) {
      if (!/software|description|creatortool|creator|generator|comment|artist/i.test(key)) {
        continue;
      }
      for (const [pattern, vendor] of VENDOR_PATTERNS) {
        if (pattern.test(value)) {
          out.push({
            signal: `Vendor heuristic: ${vendor}`,
            source: key,
            confidence: "likely",
            details: value.slice(0, 200),
          });
          break;
        }
      }
    }
    return out;
  },
};

export const weakDetector: Detector = {
  id: "weak-signals",
  run: (ctx) => {
    const out: Evidence[] = [];
    const entries = flatEntries(ctx.groups);
    const hasCamera = entries.some(
      ([key, value]) =>
        /^(EXIF:(Make|Model|LensModel)|MakerNotes:)/i.test(key) && value.trim().length > 0,
    );
    if (!hasCamera) {
      out.push({
        signal:
          "No camera Make/Model/lens/MakerNotes (weak; screenshots and uploads strip these too)",
        source: "EXIF/MakerNotes",
        confidence: "weak",
        details: "Absence of camera data is never decisive on its own.",
      });
    }
    if (/ai-|generated|midjourney|dall-e|stable-diffusion|comfy/i.test(ctx.file.toLowerCase())) {
      out.push({
        signal: `Filename pattern suggests AI generation: ${ctx.file}`,
        source: "filename",
        confidence: "weak",
        details: "Filenames are trivially renamed; never decisive.",
      });
    }
    return out;
  },
};

export const cameraDetector: Detector = {
  id: "camera-evidence",
  run: (ctx) => {
    const entries = flatEntries(ctx.groups);
    const cameraBits = entries.filter(
      ([key, value]) =>
        /make|model|lens|serial|MakerNotes/i.test(key) &&
        !/software|description/i.test(key) &&
        value.trim().length > 0,
    );
    if (cameraBits.length >= 2) {
      return [
        {
          signal: `Consistent camera provenance (${cameraBits.length} Make/Model/lens/serial/MakerNotes fields)`,
          source: cameraBits
            .slice(0, 5)
            .map(([key]) => key)
            .join(", "),
          confidence: "counter" as Confidence,
          details: "Opposite evidence: real capture metadata is present.",
        },
      ];
    }
    return [];
  },
};
