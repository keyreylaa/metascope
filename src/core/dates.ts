import { getExifTool } from "./exiftool.js";
import { applyTags } from "./write.js";

const DATE_RE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

export const DEFAULT_DATE_TAGS = ["DateTimeOriginal", "CreateDate", "ModifyDate"];

export function validateDateTime(text: string): void {
  const match = DATE_RE.exec(text.trim());
  if (!match) {
    throw new Error(
      `Invalid datetime ${JSON.stringify(text)}: expected "YYYY:mm:dd HH:MM:SS" (from exiftool.org/faq.html Q5).`,
    );
  }
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) {
    throw new Error(`Invalid datetime ${JSON.stringify(text)}: out-of-range component.`);
  }
}

export function parseShiftSeconds(text: string): number {
  const seconds = Number(text.trim());
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds)) {
    throw new Error(
      `Invalid --shift ${JSON.stringify(text)}: expected integer seconds (e.g. 3600 or -86400).`,
    );
  }
  return seconds;
}

const WALL_RE = /^(\d{4})[-:](\d{2})[-:](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/;

function wallToMillis(raw: string): number | null {
  const match = WALL_RE.exec(raw.trim());
  if (!match) {
    return null;
  }
  const millis = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return Number.isFinite(millis) ? millis : null;
}

function rawWallTime(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "rawValue" in value) {
    const raw = (value as { rawValue: unknown }).rawValue;
    if (typeof raw === "string") {
      return raw;
    }
  }
  return String(value);
}

function millisToExif(millis: number): string {
  const date = new Date(millis);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}:${pad(date.getUTCMonth() + 1)}:${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

export async function setDates(
  output: string,
  datetime: string,
  tags: string[] = DEFAULT_DATE_TAGS,
): Promise<void> {
  validateDateTime(datetime);
  const payload: Record<string, string> = {};
  for (const tag of tags) {
    payload[tag] = datetime;
  }
  const { notWritten } = await applyTags(output, payload);
  if (notWritten.length > 0) {
    throw new Error(
      `Date write failed: ${notWritten.map((entry) => `${entry.tag}: ${entry.reason}`).join("; ")}`,
    );
  }
}

export async function shiftDates(
  output: string,
  seconds: number,
  tags: string[] = DEFAULT_DATE_TAGS,
): Promise<Record<string, string>> {
  const exiftool = await getExifTool();
  const current = (await exiftool.read(output)) as unknown as Record<string, unknown>;
  const payload: Record<string, string> = {};
  for (const tag of tags) {
    const value = current[tag];
    if (value === undefined) {
      throw new Error(`Cannot shift ${tag}: tag not present in file.`);
    }
    const millis = wallToMillis(rawWallTime(value));
    if (millis === null) {
      throw new Error(`Cannot shift ${tag}: unreadable value ${JSON.stringify(value)}.`);
    }
    payload[tag] = millisToExif(millis + seconds * 1000);
  }
  const { notWritten } = await applyTags(output, payload);
  if (notWritten.length > 0) {
    throw new Error(
      `Date shift failed: ${notWritten.map((entry) => `${entry.tag}: ${entry.reason}`).join("; ")}`,
    );
  }
  return payload;
}
