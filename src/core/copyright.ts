import { applyTags } from "./write.js";
import { readFileGrouped } from "./reader.js";

export interface CopyrightInput {
  owner?: string;
  notice?: string;
  url?: string;
  usageTerms?: string;
  sync?: boolean;
}

export interface CopyrightResult {
  written: string[];
  notWritten: { tag: string; ok: boolean; reason?: string }[];
  verified: Record<string, string[]>;
}

export function buildCopyrightTags(input: CopyrightInput): Record<string, string> {
  const tags: Record<string, string> = {};
  if (input.sync === true) {
    if (input.owner) {
      tags["Artist"] = input.owner;
      tags["By-line"] = input.owner;
      tags["Creator"] = input.owner;
      tags["Owner"] = input.owner;
    }
    if (input.notice) {
      tags["Copyright"] = input.notice;
      tags["CopyrightNotice"] = input.notice;
      tags["Rights"] = input.notice;
    }
  } else {
    if (input.owner) {
      tags["Artist"] = input.owner;
    }
    if (input.notice) {
      tags["Copyright"] = input.notice;
    }
  }
  if (input.url) {
    tags["WebStatement"] = input.url;
  }
  if (input.usageTerms) {
    tags["UsageTerms"] = input.usageTerms;
  }
  return tags;
}

export async function applyCopyright(
  output: string,
  input: CopyrightInput,
): Promise<CopyrightResult> {
  const tags = buildCopyrightTags(input);
  const { written, notWritten } = await applyTags(output, tags);
  const read = await readFileGrouped(output, false);
  const verified: Record<string, string[]> = {};
  for (const groupName of ["EXIF", "IPTC", "XMP", "Composite"]) {
    const group = read.groups[groupName] ?? {};
    verified[groupName] = Object.entries(group)
      .filter(([tag]) =>
        /artist|copyright|creator|rights|owner|webstatement|usageterms|by-line/i.test(tag),
      )
      .map(([tag, value]) => `${tag}=${JSON.stringify(value)}`);
  }
  return { written, notWritten, verified };
}
