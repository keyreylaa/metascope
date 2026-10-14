import type { FileReport, ScanReport } from "../core/report.js";

const SECRET_CATEGORIES = new Set(["gps", "serial", "owner"]);

function hasSecrets(report: FileReport): boolean {
  return report.privacy.some((finding) => SECRET_CATEGORIES.has(finding.category));
}

export function redactFileLine(report: FileReport): string {
  const flags = [
    `ai=${report.aiVerdict}`,
    report.privacy.some((finding) => finding.category === "gps") ? "gps=yes" : "gps=no",
    report.privacy.some((finding) => finding.category === "serial") ? "serials=yes" : "serials=no",
  ].join(" ");
  if (report.scanError) {
    return `- ${report.file} error (details sent privately)`;
  }
  return `- ${report.file} (${report.format}) ${flags}${hasSecrets(report) ? " (details redacted, sent privately)" : ""}`;
}

export function channelSummary(report: ScanReport): string {
  const lines = report.files.map((file) => redactFileLine(file)).join("\n");
  return (
    `Scan of ${report.summary.files} file(s): ` +
    `GPS=${report.summary.withGps} serials=${report.summary.withSerials} ` +
    `C2PA=${report.summary.withC2pa} errors=${report.summary.errors}\n` +
    `Verdicts: confirmed=${report.summary.verdicts.confirmed_by_metadata}, ` +
    `likely=${report.summary.verdicts.likely}, possible=${report.summary.verdicts.possible}, ` +
    `none=${report.summary.verdicts.no_evidence}\n${lines}`
  );
}
