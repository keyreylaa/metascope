import type { GroupedRead } from "./reader.js";

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function formatJson(reads: GroupedRead[]): string {
  return JSON.stringify(reads, null, 2);
}

export function formatTable(reads: GroupedRead[]): string {
  const lines: string[] = [];
  for (const read of reads) {
    lines.push(`File: ${read.file}`);
    const groupNames = Object.keys(read.groups).sort();
    for (const group of groupNames) {
      lines.push(`  [${group}]`);
      const tags = read.groups[group] ?? {};
      const tagNames = Object.keys(tags).sort();
      const width = tagNames.reduce((max, name) => Math.max(max, name.length), 0);
      for (const tag of tagNames) {
        lines.push(`    ${tag.padEnd(width)} = ${stringify(tags[tag])}`);
      }
    }
    if (read.isPng) {
      lines.push(`  [PNG chunks]`);
      if (read.pngChunks.length === 0) {
        lines.push(`    (none parsed)`);
      }
      for (const chunk of read.pngChunks) {
        lines.push(`    ${chunk.type} length=${chunk.length} crc=${chunk.crc >>> 0}`);
      }
    }
    if (read.errors.length > 0) {
      lines.push(`  [errors]`);
      for (const error of read.errors) {
        lines.push(`    ${error}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function formatMarkdown(reads: GroupedRead[]): string {
  const lines: string[] = [];
  for (const read of reads) {
    lines.push(`# ${read.file}`);
    lines.push("");
    const groupNames = Object.keys(read.groups).sort();
    for (const group of groupNames) {
      lines.push(`## ${group}`);
      lines.push("");
      lines.push(`| Tag | Value |`);
      lines.push(`| --- | --- |`);
      const tags = read.groups[group] ?? {};
      for (const tag of Object.keys(tags).sort()) {
        const value = stringify(tags[tag]).replace(/\|/g, "\\|").replace(/\n/g, " ");
        lines.push(`| ${tag} | ${value} |`);
      }
      lines.push("");
    }
    if (read.isPng) {
      lines.push(`## PNG chunks`);
      lines.push("");
      lines.push(`| Type | Length | CRC |`);
      lines.push(`| --- | --- | --- |`);
      for (const chunk of read.pngChunks) {
        lines.push(`| ${chunk.type} | ${chunk.length} | ${chunk.crc >>> 0} |`);
      }
      lines.push("");
    }
    if (read.errors.length > 0) {
      lines.push(`## errors`);
      lines.push("");
      for (const error of read.errors) {
        lines.push(`- ${error}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}
