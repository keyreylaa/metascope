import { collectLocationEntries } from "./location.js";
import { extractThumbnails } from "./thumbnail.js";
import { getExifTool } from "./exiftool.js";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

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

// Owner findings come ONLY from person/creator tags (exact names,
// verified against https://exiftool.org/TagNames/EXIF.html,
// IPTC.html, XMP.html). ICC color-profile strings such as
// ICC_Profile:ProfileCopyright ("Google Inc. 2016") describe the
// profile maker, never the photo owner, so the ICC_Profile group is
// skipped here and reported as info instead.
const OWNER_TAGS = new Set(
  [
    "artist",
    "copyright",
    "copyrightnotice",
    "by-line",
    "bylinetitle",
    "creator",
    "rights",
    "owner",
    "ownername",
    "cameraownername",
    "credit",
    "contact",
    "source",
  ].map((tag) => tag.toLowerCase()),
);

const SKIP_GROUPS = new Set(["icc_profile", "file", "exiftool"]);

function valuesOf(
  groups: Record<string, Record<string, unknown>>,
  test: (group: string, tag: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const [group, tags] of Object.entries(groups)) {
    if (SKIP_GROUPS.has(group.toLowerCase())) {
      continue;
    }
    for (const [tag, value] of Object.entries(tags ?? {})) {
      if (test(group, tag)) {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        if (text && text.trim().length > 0) {
          out.push(`${group}:${tag}=${text.slice(0, 120)}`);
        }
      }
    }
  }
  return out;
}

async function thumbnailFinding(
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
      const mainDates = valuesOf(groups, (_group, tag) =>
        /datetimeoriginal|createdate|modifydate/i.test(tag),
      ).join("|");
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

  push(
    "gps",
    "critical",
    collectLocationEntries(groups).map((entry) => `${entry.tag}=${entry.value}`),
  );
  push(
    "serial",
    "high",
    valuesOf(groups, (_group, tag) => /serial/i.test(tag)),
  );
  push(
    "owner",
    "high",
    valuesOf(groups, (_group, tag) => OWNER_TAGS.has(tag.toLowerCase())),
  );
  push(
    "device",
    "medium",
    valuesOf(
      groups,
      (group, tag) => /^(EXIF|IFD0)$/i.test(group) && /^(Make|Model|LensModel)$/.test(tag),
    ),
  );
  push(
    "timestamps",
    "medium",
    valuesOf(groups, (_group, tag) =>
      /datetimeoriginal|createdate|modifydate|gpsdatestamp|gpstimestamp/i.test(tag),
    ),
  );
  push(
    "software",
    "low",
    valuesOf(groups, (_group, tag) => /software|hostcomputer|xmptoolkit/i.test(tag)),
  );

  const iccTags = Object.keys(groups["ICC_Profile"] ?? {}).filter(
    (tag) => String(groups["ICC_Profile"]?.[tag] ?? "").trim().length > 0,
  );
  if (iccTags.length > 0) {
    findings.push({
      category: "icc",
      severity: "info",
      detail:
        "ICC color profile present (color management data, not owner info; kept unless clean runs without --keep icc).",
    });
  }

  const mismatch = await thumbnailFinding(file, groups);
  if (mismatch) {
    findings.push(mismatch);
  }

  return { file, findings, suggestedCommand: `metascope clean "${file}"` };
}
