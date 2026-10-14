import { getExifTool } from "./exiftool.js";
import { readFileGrouped } from "./reader.js";

export interface TagReport {
  tag: string;
  ok: boolean;
  reason?: string;
}

function tagValueText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value) ?? String(value);
}

function dateDigits14(text: string): string | null {
  if (!/^\d{4}[-:]\d{2}[-:]\d{2}/.test(text.trim())) {
    return null;
  }
  const digits = text.replace(/\D/g, "");
  return digits.length >= 14 ? digits.slice(0, 14) : null;
}

function valuesMatch(actual: string, expected: string): boolean {
  if (actual.includes(expected) || expected.includes(actual)) {
    return true;
  }
  const actualDate = dateDigits14(actual);
  const expectedDate = dateDigits14(expected);
  return actualDate !== null && expectedDate !== null && actualDate === expectedDate;
}

async function verifyTag(output: string, tag: string, expected: unknown): Promise<boolean> {
  try {
    const read = await readFileGrouped(output, false);
    const wanted = tag.includes(":") ? tag.split(":").slice(1).join(":") : tag;
    for (const group of Object.values(read.groups)) {
      if (wanted in group) {
        const actual = tagValueText(group[wanted]);
        if (expected === null) {
          return false;
        }
        return valuesMatch(actual, tagValueText(expected));
      }
    }
    return expected === null;
  } catch {
    return false;
  }
}

export async function applyTags(
  output: string,
  tags: Record<string, unknown>,
): Promise<{ written: string[]; notWritten: TagReport[] }> {
  const written: string[] = [];
  const notWritten: TagReport[] = [];
  const entries = Object.entries(tags);
  if (entries.length === 0) {
    return { written, notWritten };
  }
  const exiftool = await getExifTool();
  try {
    const result = await exiftool.write(output, tags as Record<string, string>);
    const warnings = (result.warnings ?? []).join("; ");
    if (result.updated === 0 && result.created === 0) {
      for (const [tag, value] of entries) {
        const alreadyThere = await verifyTag(output, tag, value);
        if (alreadyThere) {
          written.push(tag);
        } else {
          notWritten.push({ tag, ok: false, reason: warnings || "no change applied" });
        }
      }
      return { written, notWritten };
    }
    for (const [tag, value] of entries) {
      const confirmed = await verifyTag(output, tag, value);
      if (confirmed) {
        written.push(tag);
      } else {
        notWritten.push({ tag, ok: false, reason: warnings || "not present after write" });
      }
    }
    return { written, notWritten };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const [tag, value] of entries) {
      try {
        const single = await exiftool.write(output, { [tag]: value } as Record<string, string>);
        if (single.updated === 0 && single.created === 0) {
          const alreadyThere = await verifyTag(output, tag, value);
          if (alreadyThere) {
            written.push(tag);
          } else {
            notWritten.push({
              tag,
              ok: false,
              reason: (single.warnings ?? []).join("; ") || "no change applied",
            });
          }
        } else {
          const confirmed = await verifyTag(output, tag, value);
          if (confirmed) {
            written.push(tag);
          } else {
            notWritten.push({ tag, ok: false, reason: "not present after write" });
          }
        }
      } catch (inner) {
        const reason = inner instanceof Error ? inner.message : String(inner);
        notWritten.push({ tag, ok: false, reason });
      }
    }
    if (written.length === 0 && notWritten.length > 0 && entries.length > 1) {
      notWritten.unshift({ tag: "(batch)", ok: false, reason: `batch failed: ${message}` });
    }
    return { written, notWritten };
  }
}

export function parseSetPairs(pairs: string[]): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Invalid --set ${JSON.stringify(pair)}: expected TAG=VALUE.`);
    }
    const tag = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1);
    if (!tag) {
      throw new Error(`Invalid --set ${JSON.stringify(pair)}: empty tag name.`);
    }
    tags[tag] = value;
  }
  return tags;
}
