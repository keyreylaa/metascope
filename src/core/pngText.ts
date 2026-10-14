import { inflateSync } from "node:zlib";

export interface PngText {
  keyword: string;
  text: string;
  chunkType: "tEXt" | "zTXt" | "iTXt";
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = (CRC_TABLE[(crc ^ buffer[i]!) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function latin1(buffer: Buffer): string {
  return buffer.toString("latin1");
}

export function parsePngText(buffer: Buffer): { isPng: boolean; texts: PngText[] } {
  const texts: PngText[] = [];
  if (buffer.length < 8) {
    return { isPng: false, texts };
  }
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) {
      return { isPng: false, texts };
    }
  }
  let offset = 8;
  let guard = 0;
  while (offset + 8 <= buffer.length && guard < 200) {
    guard += 1;
    const length = buffer.readUInt32BE(offset);
    if (length > 50_000_000 || offset + 12 + length > buffer.length) {
      break;
    }
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "tEXt") {
      const zero = data.indexOf(0);
      if (zero > 0) {
        texts.push({
          keyword: latin1(data.subarray(0, zero)),
          text: latin1(data.subarray(zero + 1)),
          chunkType: "tEXt",
        });
      }
    } else if (type === "zTXt") {
      const zero = data.indexOf(0);
      if (zero > 0 && data[zero + 1] === 0) {
        try {
          const inflated = inflateSync(data.subarray(zero + 2));
          texts.push({
            keyword: latin1(data.subarray(0, zero)),
            text: latin1(inflated),
            chunkType: "zTXt",
          });
        } catch {
          // Corrupt compressed text: skip the chunk, keep scanning.
        }
      }
    } else if (type === "iTXt") {
      const zero = data.indexOf(0);
      if (zero > 0 && data.length > zero + 3) {
        const compFlag = data[zero + 1];
        let cursor = zero + 3;
        const langEnd = data.indexOf(0, cursor);
        if (langEnd >= 0) {
          cursor = langEnd + 1;
          const keyEnd = data.indexOf(0, cursor);
          if (keyEnd >= 0) {
            const payload = data.subarray(keyEnd + 1);
            try {
              const text =
                compFlag === 1 ? inflateSync(payload).toString("utf8") : payload.toString("utf8");
              texts.push({
                keyword: data.subarray(0, zero).toString("utf8"),
                text,
                chunkType: "iTXt",
              });
            } catch {
              // Corrupt compressed text: skip the chunk, keep scanning.
            }
          }
        }
      }
    }
    offset += 12 + length;
    if (type === "IEND") {
      break;
    }
  }
  return { isPng: true, texts };
}
