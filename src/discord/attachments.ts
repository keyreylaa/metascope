import { detectFormat } from "../core/magic.js";
import { checkSizeBeforeDownload, downloadCapped, isAllowedHost } from "./security.js";

export interface FetchedFile {
  filename: string;
  buffer: Buffer;
}

export async function fetchAttachment(
  url: string,
  filename: string,
  maxBytes: number,
): Promise<FetchedFile> {
  if (!isAllowedHost(url)) {
    throw new Error("Attachment host is not allowed.");
  }
  await checkSizeBeforeDownload(url, maxBytes);
  const buffer = await downloadCapped(url, maxBytes);
  const { format } = detectFormat(buffer.subarray(0, 64));
  if (format === "unknown") {
    throw new Error("Attachment is not a recognized image/video file (magic bytes mismatch).");
  }
  return { filename: filename || "upload.bin", buffer };
}

// Discord documents a 25 MiB maximum request size for sending messages.
// Guild boosts can raise attachment limits; since exact per-tier numbers are
// not something we hardcode, we pre-check against this documented ceiling and
// always fall back gracefully on a 40005 (too large) API error.
export const SEND_LIMIT_BYTES = 25 * 1024 * 1024;
