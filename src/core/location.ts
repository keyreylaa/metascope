export interface LocationEntry {
  tag: string;
  value: string;
  reason: string;
}

// Exact tag names verified against https://exiftool.org/TagNames/:
// GPS.html (EXIF GPS IFD), IPTC.html (IIM application record),
// XMP.html (exif, iptcExt, photoshop namespaces), QuickTime.html,
// EXIF.html (Artist/Copyright/OwnerName/CameraOwnerName).
// QuickTime has no ISO-6709 tag in the ExifTool docs; QT location is
// covered via GPSCoordinates plus the Location* tags below.

const EXIF_GPS_TAGS = [
  "GPSVersionID",
  "GPSLatitudeRef",
  "GPSLatitude",
  "GPSLongitudeRef",
  "GPSLongitude",
  "GPSAltitudeRef",
  "GPSAltitude",
  "GPSTimeStamp",
  "GPSSatellites",
  "GPSStatus",
  "GPSMeasureMode",
  "GPSDOP",
  "GPSSpeedRef",
  "GPSSpeed",
  "GPSTrackRef",
  "GPSTrack",
  "GPSImgDirectionRef",
  "GPSImgDirection",
  "GPSMapDatum",
  "GPSDestLatitudeRef",
  "GPSDestLatitude",
  "GPSDestLongitudeRef",
  "GPSDestLongitude",
  "GPSDestBearingRef",
  "GPSDestBearing",
  "GPSDestDistanceRef",
  "GPSDestDistance",
  "GPSProcessingMethod",
  "GPSAreaInformation",
  "GPSDateStamp",
  "GPSDifferential",
  "GPSHPositioningError",
];

const XMP_LOCATION_TAGS = [
  "GPSLatitude",
  "GPSLongitude",
  "GPSAltitude",
  "GPSAltitudeRef",
  "GPSDateTime",
  "GPSTimeStamp",
  "LocationCreated",
  "LocationCreatedCity",
  "LocationCreatedCountryCode",
  "LocationCreatedCountryName",
  "LocationCreatedGPSAltitude",
  "LocationCreatedGPSAltitudeRef",
  "LocationCreatedGPSLatitude",
  "LocationCreatedGPSLongitude",
  "LocationCreatedIdentifier",
  "LocationCreatedLocationId",
  "LocationCreatedLocationName",
  "LocationCreatedProvinceState",
  "LocationCreatedSublocation",
  "LocationCreatedWorldRegion",
  "LocationShown",
  "LocationShownCity",
  "LocationShownCountryCode",
  "LocationShownCountryName",
  "LocationShownGPSAltitude",
  "LocationShownGPSAltitudeRef",
  "LocationShownGPSLatitude",
  "LocationShownGPSLongitude",
  "LocationShownIdentifier",
  "LocationShownLocationId",
  "LocationShownLocationName",
  "LocationShownProvinceState",
  "LocationShownSublocation",
  "LocationShownWorldRegion",
];

const IPTC_LOCATION_TAGS = [
  "City",
  "Sub-location",
  "Province-State",
  "Country-PrimaryLocationCode",
  "Country-PrimaryLocationName",
];

const QT_LOCATION_TAGS = [
  "GPSCoordinates",
  "LocationInformation",
  "LocationNote",
  "LocationRole",
  "LocationName",
  "LocationBody",
  "LocationDate",
  "LocationAccuracyHorizontal",
];

const KNOWN_LOCATION_TAGS = new Set(
  [...XMP_LOCATION_TAGS, ...IPTC_LOCATION_TAGS, ...QT_LOCATION_TAGS].map((tag) =>
    tag.toLowerCase(),
  ),
);

function valueText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value) ?? String(value);
}

// Decimal coordinate pair inside freeform MakerNotes text, e.g.
// "-6.2146, 106.8451" or ISO-6709 style "+51.5008-000.1246".
const COORD_PAIR = /[+-]?\d{1,3}\.\d+\s*[,;]\s*[+-]?\d{1,3}\.\d+|[+-]\d{2,3}\.\d+[+-]\d{2,3}\.\d+/;

export function collectLocationEntries(
  groups: Record<string, Record<string, unknown>>,
): LocationEntry[] {
  const entries: LocationEntry[] = [];
  for (const [group, tags] of Object.entries(groups)) {
    const lowerGroup = group.toLowerCase();
    for (const [tag, value] of Object.entries(tags ?? {})) {
      const id = `${group}:${tag}`;
      const text = valueText(value);
      if (!text || text.trim().length === 0) {
        continue;
      }
      if (lowerGroup === "gps") {
        entries.push({ tag: id, value: text.slice(0, 120), reason: "EXIF GPS tag" });
      } else if (/gps|location/i.test(tag) || KNOWN_LOCATION_TAGS.has(tag.toLowerCase())) {
        entries.push({ tag: id, value: text.slice(0, 120), reason: "location tag" });
      } else if (lowerGroup.includes("makernotes") && COORD_PAIR.test(text)) {
        entries.push({
          tag: id,
          value: text.slice(0, 120),
          reason: "possible embedded coordinates in MakerNotes text",
        });
      }
    }
  }
  return entries;
}

// Every known location tag as a bare ExifTool delete name. Verified live:
// after deletion + re-read, collectLocationEntries() must return [].
export const LOCATION_REMOVE_TAGS: Record<string, null> = Object.fromEntries(
  [...EXIF_GPS_TAGS, ...XMP_LOCATION_TAGS, ...IPTC_LOCATION_TAGS, ...QT_LOCATION_TAGS].map(
    (tag) => [tag, null],
  ),
);

function firstNumber(
  groups: Record<string, Record<string, unknown>>,
  names: string[],
): number | null {
  for (const group of Object.values(groups)) {
    for (const name of names) {
      const raw = group?.[name];
      const num =
        typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
      if (Number.isFinite(num)) {
        return num;
      }
    }
  }
  return null;
}

export function decimalCoordinates(
  groups: Record<string, Record<string, unknown>>,
): { lat: number; lon: number } | null {
  const lat = firstNumber(groups, ["GPSLatitude", "GPSDestLatitude"]);
  const lon = firstNumber(groups, ["GPSLongitude", "GPSDestLongitude"]);
  if (lat === null || lon === null) {
    return null;
  }
  return { lat, lon };
}

// Link text only. Never fetched: gps --show is fully offline.
export function mapsLink(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}
