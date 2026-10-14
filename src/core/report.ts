import type { Evidence, AiVerdict } from "./aiCheck.js";
import type { PrivacyFinding } from "./privacy.js";
import type { PngChunk } from "./pngChunks.js";

export interface FileReport {
  file: string;
  format: string;
  sha256: string | null;
  md5: string | null;
  pixelSha256: string | null;
  ahash: string | null;
  dhash: string | null;
  phash: string | null;
  hashesNote: string | null;
  groups: Record<string, Record<string, unknown>> | null;
  pngChunks: PngChunk[];
  errors: string[];
  privacy: PrivacyFinding[];
  aiVerdict: AiVerdict;
  aiEvidence: Evidence[];
  scanError: string | null;
}

export interface ScanSummary {
  files: number;
  withGps: number;
  withSerials: number;
  withC2pa: number;
  verdicts: Record<AiVerdict, number>;
  errors: number;
}

export interface ScanReport {
  tool: string;
  version: string;
  createdAt: string;
  root: string;
  summary: ScanSummary;
  files: FileReport[];
}

export function emptySummary(): ScanSummary {
  return {
    files: 0,
    withGps: 0,
    withSerials: 0,
    withC2pa: 0,
    verdicts: { confirmed_by_metadata: 0, likely: 0, possible: 0, no_evidence: 0 },
    errors: 0,
  };
}

export function summarize(files: FileReport[]): ScanSummary {
  const summary = emptySummary();
  summary.files = files.length;
  for (const report of files) {
    if (report.scanError) {
      summary.errors += 1;
    }
    if (report.privacy.some((finding) => finding.category === "gps")) {
      summary.withGps += 1;
    }
    if (report.privacy.some((finding) => finding.category === "serial")) {
      summary.withSerials += 1;
    }
    if (
      report.aiEvidence.some(
        (item) =>
          item.signal.startsWith("C2PA / Content Credentials") || /jumbf/i.test(item.source),
      )
    ) {
      summary.withC2pa += 1;
    }
    summary.verdicts[report.aiVerdict] += 1;
  }
  return summary;
}

export function renderJson(report: ScanReport): string {
  return JSON.stringify(report, null, 2);
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderMarkdown(report: ScanReport): string {
  const lines: string[] = [];
  lines.push(`# metascope scan: ${report.root}`);
  lines.push("");
  lines.push(`- Files: ${report.summary.files}`);
  lines.push(`- With GPS: ${report.summary.withGps}`);
  lines.push(`- With serials: ${report.summary.withSerials}`);
  lines.push(`- With C2PA: ${report.summary.withC2pa}`);
  lines.push(
    `- AI verdicts: confirmed=${report.summary.verdicts.confirmed_by_metadata}, likely=${report.summary.verdicts.likely}, possible=${report.summary.verdicts.possible}, no_evidence=${report.summary.verdicts.no_evidence}`,
  );
  lines.push(`- Errors: ${report.summary.errors}`);
  lines.push("");
  lines.push(`| File | Format | AI verdict | GPS | Serials | Error |`);
  lines.push(`| --- | --- | --- | --- | --- | --- |`);
  for (const file of report.files) {
    lines.push(
      `| ${escapeCell(file.file)} | ${file.format} | ${file.aiVerdict} | ` +
        `${file.privacy.some((finding) => finding.category === "gps") ? "yes" : "no"} | ` +
        `${file.privacy.some((finding) => finding.category === "serial") ? "yes" : "no"} | ` +
        `${escapeCell(file.scanError ?? "")} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function renderCsv(report: ScanReport): string {
  const rows: string[][] = [
    ["file", "format", "ai_verdict", "gps", "serials", "c2pa", "sha256", "error"],
  ];
  for (const file of report.files) {
    rows.push([
      file.file,
      file.format,
      file.aiVerdict,
      file.privacy.some((finding) => finding.category === "gps") ? "yes" : "no",
      file.privacy.some((finding) => finding.category === "serial") ? "yes" : "no",
      file.aiEvidence.some(
        (item) =>
          item.signal.startsWith("C2PA / Content Credentials") || /jumbf/i.test(item.source),
      )
        ? "yes"
        : "no",
      file.sha256 ?? "",
      file.scanError ?? "",
    ]);
  }
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n") + "\n";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderHtml(report: ScanReport): string {
  const rows = report.files
    .map((file) => {
      const evidence = file.aiEvidence
        .map(
          (item) =>
            `<li>[${escapeHtml(item.confidence)}] ${escapeHtml(item.signal)} (${escapeHtml(item.source)})</li>`,
        )
        .join("");
      const findings = file.privacy
        .map(
          (finding) =>
            `<li>[${escapeHtml(finding.severity)}] ${escapeHtml(finding.category)}: ${escapeHtml(finding.detail)}</li>`,
        )
        .join("");
      return `<tr><td>${escapeHtml(file.file)}</td><td>${escapeHtml(file.format)}</td><td>${escapeHtml(file.aiVerdict)}</td><td><ul>${evidence}</ul></td><td><ul>${findings}</ul></td><td>${escapeHtml(file.scanError ?? "")}</td></tr>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>metascope scan: ${escapeHtml(report.root)}</title>
<style>body{font-family:sans-serif;margin:2em}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px}ul{margin:0;padding-left:1.2em}</style>
</head>
<body>
<h1>metascope scan: ${escapeHtml(report.root)}</h1>
<p>Files: ${report.summary.files}, GPS: ${report.summary.withGps}, serials: ${report.summary.withSerials}, C2PA: ${report.summary.withC2pa}, errors: ${report.summary.errors}</p>
<p>AI verdicts: confirmed=${report.summary.verdicts.confirmed_by_metadata}, likely=${report.summary.verdicts.likely}, possible=${report.summary.verdicts.possible}, no_evidence=${report.summary.verdicts.no_evidence}</p>
<table>
<thead><tr><th>File</th><th>Format</th><th>AI verdict</th><th>Evidence</th><th>Privacy</th><th>Error</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
}
