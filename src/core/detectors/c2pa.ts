import { execFile } from "node:child_process";

import type { Detector, Evidence } from "../aiCheck.js";
import { flatEntries } from "../aiCheck.js";

export const c2paDetector: Detector = {
  id: "c2pa",
  run: async (ctx) => {
    // Match on group/tag names only. Matching values would false-positive on
    // strings like the DigitalSourceType URI ".../c2pa/trainedAlgorithmicMedia".
    const hits = flatEntries(ctx.groups).filter(([key]) =>
      /jumbf|c2pa|contentcredentials|manifest|claim|assertion|jumd/i.test(key),
    );
    if (hits.length === 0) {
      return [];
    }
    const evidence: Evidence[] = [
      {
        signal: "C2PA / Content Credentials manifest present",
        source: "ExifTool JUMBF tags",
        confidence: "confirmed",
        details: hits
          .slice(0, 8)
          .map(([key]) => key)
          .join(", "),
      },
    ];
    const signer = hits.find(([key]) => /signer|issuer|claim generator/i.test(key));
    if (signer) {
      evidence.push({
        signal: `Claim generator/signer: ${signer[1].slice(0, 160)}`,
        source: "ExifTool JUMBF tags",
        confidence: "confirmed",
        details: signer[0],
      });
    }
    const c2patool = await probeC2patool(ctx.file);
    evidence.push({
      signal: c2patool,
      source: "c2patool binary",
      confidence: "possible",
      details: "Offline validation status is unverified without a trust list; treat as advisory.",
    });
    return evidence;
  },
};

function probeC2patool(file: string): Promise<string> {
  return new Promise<string>((fulfill) => {
    execFile(
      "c2patool",
      [file],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          fulfill("c2patool not installed (optional; manifest details from ExifTool only)");
          return;
        }
        const output = (stdout || stderr || "").slice(0, 2000).trim();
        if (error) {
          fulfill(`c2patool ran with an error: ${output || String(error).slice(0, 200)}`);
          return;
        }
        fulfill(`c2patool output: ${output || "(empty)"}`);
      },
    );
  });
}
