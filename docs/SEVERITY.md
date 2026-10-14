# Severity rubric

How `privacy-scan` assigns severity. Every finding cites the exact
`Group:Tag` and the reason, so a severity is never a bare label.

Tag names below are the exact ExifTool names, verified against
https://exiftool.org/TagNames/ (EXIF, GPS, IPTC, XMP, QuickTime pages).

## critical — location

Any evidence of where a photo was taken or what place it shows.
Category name: `gps` (kept short for stable report columns).

- EXIF GPS IFD: `GPSLatitude`, `GPSLongitude`, `GPSAltitude`,
  `GPSTimeStamp`, `GPSDateStamp`, `GPSImgDirection`, `GPSSpeed`,
  `GPSDestLatitude`, `GPSDestLongitude`, `GPSAreaInformation`,
  `GPSProcessingMethod`, and every other `GPS*` tag, including
  `GPSLatitudeRef`/`GPSLongitudeRef` (they still leak hemisphere).
- XMP: `GPSLatitude`, `GPSLongitude`, `GPSAltitude`,
  `GPSAltitudeRef`, `GPSDateTime`, `GPSTimeStamp`, every
  `LocationCreated*` and `LocationShown*` field
  (city, province, country, sublocation, world region, GPS).
- IPTC: `City`, `Sub-location`, `Province-State`,
  `Country-PrimaryLocationCode`, `Country-PrimaryLocationName`.
- QuickTime/MP4: `GPSCoordinates`, `LocationInformation`,
  `LocationNote`, `LocationRole`, `LocationName`, `LocationBody`,
  `LocationDate`, `LocationAccuracyHorizontal`.
- MakerNotes: tag names matching GPS/location/lat/lon, plus freeform
  text that looks like decimal coordinates (`-6.2146, 106.8451`)
  or ISO-6709 style (`+51.5008-000.1246`).

Why critical: coordinates and place names can reveal a home address.

## high — serials and owner identity

- Serials: any tag whose name contains `serial` (e.g.
  `EXIF:SerialNumber`, `EXIF:CameraSerialNumber`,
  `EXIF:LensSerialNumber`). Unique per device.
- Owner: person/creator tags only, matched by exact tag name in any
  group except `ICC_Profile`, `File`, `ExifTool`:
  `Artist`, `Copyright`, `CopyrightNotice`, `By-line`,
  `By-lineTitle`, `Creator`, `Rights`, `Owner`, `OwnerName`,
  `CameraOwnerName`, `Credit`, `Contact`, `Source`.

Why high: names and serials identify a person or a single device.

## medium — device, timestamps, thumbnails

- Device: `EXIF:Make`, `EXIF:Model`, `EXIF:LensModel` (narrows down
  the camera, but millions share one model).
- Timestamps: `DateTimeOriginal`, `CreateDate`, `ModifyDate`,
  `GPSDateStamp`, `GPSTimeStamp` and sub-second variants, except the
  `File:` group (filesystem mtime is not embedded metadata).
- Thumbnails: an embedded thumbnail/preview whose own metadata or
  timestamps differ from the main image (stale copy of the same
  private data). Matching thumbnails are `low`.

Why medium: behavioral fingerprint, rarely identifying alone.

## low — software

- `Software`, `HostComputer`, `XMPToolkit` (editor/OS hints).

## info — not a risk

- `icc`: an ICC color profile is present. Profile strings such as
  `ICC_Profile:ProfileCopyright` ("Google Inc. 2016") describe the
  profile maker and ship in nearly every sRGB file; they are never
  owner findings. Kept unless `clean` runs without `--keep icc`.

## What is deliberately NOT flagged

- `File:` group (filesystem dates, permissions, sizes).
- `ExifTool:` group (tool version, not photo data).
- `Composite:` derived values are shown for context in `gps --show`
  but removed automatically once their source tags are gone.
- Bare descriptive tags (`ImageDescription`, `Title`) stay out of
  privacy findings; removing them is the user's choice via
  `clean`/`strip --mode all`.
