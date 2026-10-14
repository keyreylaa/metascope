import type { Detector, Evidence } from "../aiCheck.js";
import { flatEntries } from "../aiCheck.js";

export const digitalSourceDetector: Detector = {
  id: "digital-source-type",
  run: (ctx) => {
    const hits = flatEntries(ctx.groups).filter(([key]) => /digitalsourcetype/i.test(key));
    const out: Evidence[] = [];
    for (const [key, value] of hits) {
      const lower = value.toLowerCase();
      if (
        lower.includes("trainedalgorithmicmedia") ||
        lower.includes("compositewithtrainedalgorithmicmedia")
      ) {
        out.push({
          signal: `DigitalSourceType indicates AI generation: ${value.slice(0, 160)}`,
          source: key,
          confidence: "confirmed",
          details: value.slice(0, 300),
        });
      } else if (lower.includes("algorithmicmedia")) {
        out.push({
          signal: `DigitalSourceType indicates algorithmic media: ${value.slice(0, 160)}`,
          source: key,
          confidence: "likely",
          details: value.slice(0, 300),
        });
      } else {
        out.push({
          signal: `DigitalSourceType present (not AI): ${value.slice(0, 160)}`,
          source: key,
          confidence: "counter",
          details: value.slice(0, 300),
        });
      }
    }
    return out;
  },
};
