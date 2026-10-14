import { extractThumbnails } from "./thumbnail.js";
import { getExifTool } from "./exiftool.js";

export type Severity = "high" | "medium" | "low";

export interface PrivacyFinding {
  category: string;
  severity: Severity;
  detail: string;
}

export interface PrivacyResult {
  file: string;
  findings: PrivacyFinding[];
  suggestedCommand: string;
}

function valuesOf(
  groups: Record<string, Record<string, unknown>>,
  test: RegExp,
  skipGroups: RegExp = /$^/,
): string[] {
  const out: string[] = [];
  for (const [group, tags] of Object.entries(groups)) {
    if (skipGroups.test(group)) {
      continue;
    }
    for (const [tag, value] of Object.entries(tags)) {
      if (test.test(`${group}:${tag}`)) {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        if (text && text.trim().length > 0) {
          out.push(`${group}:${tag}=${text.slice(0, 120)}`);
        }
      }
    }
  }
  return out;
}

async function thumbnailMismatch(
  file: string,
  groups: Record<string, Record<string, unknown>>,
): Promise<PrivacyFinding | null> {
  const hasThumb = Object.keys(groups).some((group) =>
    Object.keys(groups[group] ?? {}).some((tag) => /thumbnailimage|previewimage/i.test(tag)),
  );
  if (!hasThumb) {
    return null;
  }
  try {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "metascope-thumb-"));
    try {
      const result = await extractThumbnails(file, dir);
      if (result.extracted.length === 0) {
        return {
          category: "thumbnail",
          severity: "medium",
          detail:
            "Embedded thumbnail/preview is referenced but could not be extracted; verify it after stripping.",
        };
      }
      const exiftool = await getExifTool();
      const mainDates = valuesOf(groups, /datetimeoriginal|createdate|modifydate/i).join("|");
      for (const thumb of result.extracted) {
        const tags = (await exiftool.read(thumb)) as unknown as Record<string, unknown>;
        const thumbGps = Object.keys(tags).filter((key) => /gps/i.test(key));
        if (thumbGps.length > 0) {
          return {
            category: "thumbnail",
            severity: "medium",
            detail: `Embedded thumbnail carries its own metadata (${thumbGps.slice(0, 3).join(", ")}).`,
          };
        }
        const thumbDates = Object.entries(tags)
          .filter(([key]) => /datetimeoriginal|createdate|modifydate/i.test(key))
          .map(([, value]) => String(value))
          .join("|");
        if (thumbDates && mainDates && thumbDates !== mainDates) {
          return {
            category: "thumbnail",
            severity: "medium",
            detail: "Embedded thumbnail timestamps differ from the main image (stale metadata).",
          };
        }
      }
      return {
        category: "thumbnail",
        severity: "low",
        detail: "Embedded thumbnail/preview present; re-check it after stripping.",
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } catch {
    return null;
  }
}

export async function privacyScan(
  file: string,
  groups: Record<string, Record<string, unknown>>,
): Promise<PrivacyResult> {
  const findings: PrivacyFinding[] = [];
  const push = (category: string, severity: Severity, items: string[]): void => {
    for (const detail of items.slice(0, 5)) {
      findings.push({ category, severity, detail });
    }
  };

  push("gps", "high", valuesOf(groups, /gps(latitude|longitude|position|altitude)/i));
  push("serial", "high", valuesOf(groups, /serial/i));
  push(
    "owner",
    "high",
    valuesOf(groups, /artist|by-line|creator|owner|copyright(notice)?|rights/i),
  );
  push("device", "medium", valuesOf(groups, /^(EXIF|IFD0):(Make|Model|LensModel)$/i));
  push(
    "timestamps",
    "medium",
    valuesOf(
      groups,
      /datetimeoriginal|createdate|modifydate|gpsdatestamp|gpstimestamp/i,
      /^file$/i,
    ),
  );
  push("software", "low", valuesOf(groups, /software|hostcomputer|xmptoolkit/i));

  const mismatch = await thumbnailMismatch(file, groups);
  if (mismatch) {
    findings.push(mismatch);
  }

  return { file, findings, suggestedCommand: `metascope clean "${file}"` };
}
