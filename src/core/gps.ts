import { applyTags } from "./write.js";
import { readFileGrouped } from "./reader.js";
import {
  collectLocationEntries,
  decimalCoordinates,
  LOCATION_REMOVE_TAGS,
  mapsLink,
  type LocationEntry,
} from "./location.js";

export function parseLatLon(text: string): { lat: number; lon: number } {
  const parts = text.split(",");
  if (parts.length !== 2) {
    throw new Error(`Invalid GPS ${JSON.stringify(text)}: expected "lat,lon".`);
  }
  const lat = Number(parts[0].trim());
  const lon = Number(parts[1].trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`Invalid GPS ${JSON.stringify(text)}: not finite numbers.`);
  }
  if (lat < -90 || lat > 90) {
    throw new Error(`Invalid latitude ${lat}: must be within -90..90.`);
  }
  if (lon < -180 || lon > 180) {
    throw new Error(`Invalid longitude ${lon}: must be within -180..180.`);
  }
  return { lat, lon };
}

export async function setGps(output: string, lat: number, lon: number): Promise<void> {
  const { notWritten } = await applyTags(output, { GPSLatitude: lat, GPSLongitude: lon });
  if (notWritten.length > 0) {
    throw new Error(
      `GPS write failed: ${notWritten.map((entry) => `${entry.tag}: ${entry.reason}`).join("; ")}`,
    );
  }
  const read = await readFileGrouped(output, false);
  const position = read.groups["Composite"]?.["GPSPosition"];
  if (!position) {
    throw new Error("GPS write was not confirmed on re-read.");
  }
}

const GPS_REMOVE_TAGS: Record<string, null> = {
  GPSLatitude: null,
  GPSLongitude: null,
  GPSAltitude: null,
  GPSDateStamp: null,
  GPSTimeStamp: null,
  GPSProcessingMethod: null,
  GPSPosition: null,
};

export interface LocationShow {
  entries: LocationEntry[];
  lat: number | null;
  lon: number | null;
  mapsLink: string | null;
}

// Fully offline: reads local metadata only, prints a Google Maps link as
// text. Never performs geocoding requests.
export async function showLocation(file: string): Promise<LocationShow> {
  const read = await readFileGrouped(file, false);
  const entries = collectLocationEntries(read.groups);
  const coords = decimalCoordinates(read.groups);
  return {
    entries,
    lat: coords?.lat ?? null,
    lon: coords?.lon ?? null,
    mapsLink: coords ? mapsLink(coords.lat, coords.lon) : null,
  };
}

export async function removeGps(
  output: string,
): Promise<{ removed: string[]; residual: string[] }> {
  const { written } = await applyTags(output, { ...GPS_REMOVE_TAGS, ...LOCATION_REMOVE_TAGS });
  const read = await readFileGrouped(output, false);
  const residual = collectLocationEntries(read.groups).map((entry) => entry.tag);
  return { removed: written, residual };
}
