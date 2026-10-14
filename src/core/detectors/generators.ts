import type { Detector, Evidence } from "../aiCheck.js";
import { flatEntries } from "../aiCheck.js";

export interface GeneratorParams {
  tool: string;
  prompt?: string;
  negativePrompt?: string;
  seed?: string;
  sampler?: string;
  steps?: string;
  model?: string;
  modelHash?: string;
}

export function parseAutomatic1111(text: string): GeneratorParams | null {
  if (!/steps:\s*\d+/i.test(text) || !/sampler:/i.test(text)) {
    return null;
  }
  const lines = text.split("\n");
  const negIndex = lines.findIndex((line) => /^negative prompt:/i.test(line.trim()));
  const stepsIndex = lines.findIndex((line) => /steps:\s*\d+/i.test(line));
  const prompt = (negIndex >= 0 ? lines.slice(0, negIndex) : lines.slice(0, stepsIndex))
    .join("\n")
    .trim();
  let negativePrompt: string | undefined;
  let paramsText = "";
  if (negIndex >= 0) {
    const end = stepsIndex >= 0 ? stepsIndex : lines.length;
    const negLines = lines.slice(negIndex, end);
    negLines[0] = (negLines[0] ?? "").replace(/^negative prompt:/i, "");
    negativePrompt = negLines.join("\n").trim() || undefined;
    paramsText = lines.slice(end).join(" ");
  } else if (stepsIndex >= 0) {
    paramsText = lines.slice(stepsIndex).join(" ");
  }
  const params: GeneratorParams = {
    tool: "Automatic1111",
    prompt: prompt || undefined,
    negativePrompt,
  };
  for (const part of paramsText.split(/,\s*/)) {
    const match = /^([^:]+):\s*(.+)$/.exec(part.trim());
    if (!match) {
      continue;
    }
    const key = match[1]!.trim().toLowerCase();
    const value = match[2]!.trim();
    if (key === "seed") {
      params.seed = value;
    } else if (key === "sampler") {
      params.sampler = value;
    } else if (key === "steps") {
      params.steps = value;
    } else if (key === "model") {
      params.model = value;
    } else if (key === "model hash") {
      params.modelHash = value;
    }
  }
  return params;
}

export const generatorDetector: Detector = {
  id: "generator-params",
  run: (ctx) => {
    const out: Evidence[] = [];
    const seen = new Set<string>();
    const candidates: [string, string][] = ctx.pngTexts.map((entry) => [
      `PNG:${entry.keyword}`,
      entry.text,
    ]);
    for (const [key, value] of flatEntries(ctx.groups)) {
      if (/usercomment|description|parameters|prompt|workflow|software|comment/i.test(key)) {
        candidates.push([key, value]);
      }
    }
    for (const [source, text] of candidates) {
      if (text.length === 0 || text.length > 200_000) {
        continue;
      }
      const a1111 =
        /automatic1111|stable diffusion/i.test(text.slice(0, 500)) ||
        parseAutomatic1111(text) !== null;
      if (/^parameters$/i.test(source.split(":").pop() ?? "") || (a1111 && /steps:/i.test(text))) {
        const parsed = parseAutomatic1111(text);
        if (parsed) {
          const identity = `a1111:${parsed.seed ?? "?"}:${parsed.sampler ?? "?"}:${parsed.steps ?? "?"}`;
          if (!seen.has(identity)) {
            seen.add(identity);
            out.push({
              signal: `Automatic1111 parameters (seed ${parsed.seed ?? "?"}, ${parsed.sampler ?? "?"}, ${parsed.steps ?? "?"} steps, model ${parsed.model ?? parsed.modelHash ?? "?"})`,
              source,
              confidence: "confirmed",
              details: `prompt=${(parsed.prompt ?? "").slice(0, 200)}`,
            });
          }
          continue;
        }
      }
      if (/comfyui|prompt|workflow/i.test(source) && text.trimStart().startsWith("{")) {
        try {
          const data = JSON.parse(text) as Record<string, unknown>;
          const nodes = Object.keys(data).length;
          out.push({
            signal: `ComfyUI ${/workflow/i.test(source) ? "workflow" : "prompt"} JSON (${nodes} top-level entr${nodes === 1 ? "y" : "ies"})`,
            source,
            confidence: "confirmed",
            details: `keys=${Object.keys(data).slice(0, 5).join(",")}`,
          });
          continue;
        } catch {
          // Not JSON; fall through to keyword checks.
        }
      }
      if (/novelai|invokeai|fooocus|stable diffusion|midjourney/i.test(text.slice(0, 2000))) {
        out.push({
          signal: `Generator marker in ${source}`,
          source,
          confidence: "likely",
          details: text.slice(0, 200),
        });
      }
    }
    return out;
  },
};
