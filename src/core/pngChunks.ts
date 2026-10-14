export interface PngChunk {
  type: string;
  length: number;
  crc: number;
  offset: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isAsciiLetterOrDigit(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39)
  );
}

export function scanPngChunks(buffer: Buffer): { isPng: boolean; chunks: PngChunk[] } {
  if (buffer.length < 8) {
    return { isPng: false, chunks: [] };
  }
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) {
      return { isPng: false, chunks: [] };
    }
  }
  const chunks: PngChunk[] = [];
  let offset = 8;
  let guard = 0;
  while (offset + 8 <= buffer.length && guard < 100) {
    guard += 1;
    const length = buffer.readUInt32BE(offset);
    if (length > 100_000_000) {
      break;
    }
    const typeBytes = buffer.subarray(offset + 4, offset + 8);
    for (const byte of typeBytes) {
      if (!isAsciiLetterOrDigit(byte)) {
        return { isPng: true, chunks };
      }
    }
    const type = typeBytes.toString("ascii");
    if (offset + 12 + length > buffer.length) {
      break;
    }
    const crc = buffer.readUInt32BE(offset + 8 + length);
    chunks.push({ type, length, crc, offset });
    offset += 12 + length;
    if (type === "IEND") {
      break;
    }
  }
  return { isPng: true, chunks };
}
