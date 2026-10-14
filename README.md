# metascope

Photo/video metadata toolkit: read everything accurately, edit safely, strip
verifiably, detect AI-generation provenance, and scan whole folders. The
terminal CLI is the primary interface; an optional Discord bot reuses the
same core.

Engine: [ExifTool](https://exiftool.org/) via `exiftool-vendored`. There are
no hand-written metadata parsers except a raw PNG chunk scan where ExifTool
cannot do the job.

## Requirements

- Node.js 22 (`engines.node >= 22`, `.nvmrc` pins `22`).
- Perl on Linux/macOS (required by the vendored ExifTool; the CLI prints the
  install fix when it is missing).
- `sharp` is an **optional** dependency. If it fails to load, pixel and
  perceptual hashes degrade with a clear message instead of crashing.

## Install

```sh
npm install
npm run build
```

Global install (includes the `ms` alias):

```sh
npm pack
npm i -g ./metascope-0.1.0.tgz
cd /tmp/anywhere
metascope scan photo.jpg
ms strip "*.jpg"
```

## Quick start

```sh
# Read: metadata grouped by namespace
metascope read photo.jpg

# Privacy check before sharing
metascope privacy-scan photo.jpg

# Remove GPS/serials/owner/device/timestamps, prove it afterwards
metascope strip photo.jpg --mode privacy --verify

# Full folder report (JSON + Markdown in ./scan-out/)
metascope scan ./photos --out ./scan-out
```

## Safety rules

- Originals are never touched by default. Edit/strip commands write copies
  into `<cwd>/metascope-out/` (overridable with `--out` or config), keeping
  the filename with a `_clean` (strip/clean) or `_edited` (write/copyright/
  gps/dates) suffix, and print absolute output paths.
- In-place edits need explicit `--in-place` and copy a `.metascope.bak`
  backup first.
- `strip --verify` re-reads the output and lists every residual tag. The word
  "clean" is printed only when the re-read proves it.
- Stripping metadata does NOT remove invisible pixel watermarks (e.g. SynthID).

## Commands

| Command                                    | What it does                                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read <files\|globs>`                      | Dump metadata grouped by namespace (`--format table\|json\|md`, `--raw`, `--thumbnail`)                                                                                     |
| `write <file>` (`edit` alias)              | Set tags (`--set TAG=VALUE`, `--from-json`, `--copy-from`); reports every tag NOT written with the reason                                                                   |
| `copyright <file>`                         | Set owner/notice/URL/usage-terms (`--sync` mirrors across EXIF, IPTC, XMP)                                                                                                  |
| `gps <file>`                               | `--set lat,lon` or `--remove`                                                                                                                                               |
| `dates <file>`                             | `--set "YYYY:mm:dd HH:MM:SS"` or `--shift <seconds>`                                                                                                                        |
| `strip <files>`                            | Remove metadata, default mode `privacy` (`all\|privacy\|gps\|custom`, `--keep`, `--verify`, `--reencode`, `--zip`)                                                          |
| `clean <files>`                            | `strip --mode all --verify` in one command                                                                                                                                  |
| `snapshot save\|list\|show\|restore\|diff` | Full-metadata JSON snapshots in the XDG data dir                                                                                                                            |
| `hash <file>`                              | File, pixel, and perceptual hashes (`--compare`); integrity/duplicates only, NOT AI detection                                                                               |
| `ai-check <file>`                          | Layered AI-generation provenance check (metadata only)                                                                                                                      |
| `privacy-scan <files>`                     | Privacy risk report with severity per finding                                                                                                                               |
| `scan [paths...]`                          | Read-only folder scan: metadata, privacy, AI, hashes (`--depth`, `--ext`, `--follow-symlinks`, `--no-hash`, `--concurrency`, `--out`, `--format json,md,csv,html`, `--zip`) |
| `batch strip\|write <inputs...>`           | Bulk runs with concurrency pool (`--dry-run`, `--concurrency`, `--ext`, `--out`, `--zip`)                                                                                   |
| `watch <dirs...>`                          | Auto-scan new/changed files, per-file JSON sidecars (`--depth`, `--ext`, `--debounce-ms`, `--out`)                                                                          |
| `bot`                                      | Start the Discord bot (`--prefix`, `--max-file-mb`; needs `DISCORD_TOKEN`)                                                                                                  |

`ai-check` verdicts are `confirmed_by_metadata | likely | possible |
no_evidence`, always with the evidence list and the disclaimer that missing
metadata proves nothing and offline tools cannot see invisible watermarks.

## Config and environment

Optional `~/.config/metascope/config.json` (zod-validated; CLI flags win):

```json
{
  "outputDir": "./metascope-out",
  "concurrency": 4,
  "snapshotDir": "~/.local/share/metascope/snapshots",
  "discord": { "prefix": "!", "maxFileMb": 10 }
}
```

Snapshots default to the XDG data dir (`~/.local/share/metascope/snapshots`,
honors `XDG_DATA_HOME`). Override order: `METASCOPE_SNAPSHOT_DIR` env, then
`--snapshot-dir` flag, then config file. Secrets never go in config: the bot
token comes only from `DISCORD_TOKEN` in `.env` (see `.env.example`).

## Discord bot

```sh
cp .env.example .env   # then put the real token in DISCORD_TOKEN=
metascope bot
```

Setup: Discord Developer Portal → your application → Bot → enable
**MESSAGE CONTENT INTENT** under Privileged Gateway Intents (prefix commands
need it; without it the bot explains this and exits). Invite with the
`applications.commands` scope for `/meta` slash commands.

- Slash `/meta read|strip|ai-check|hash|scan` (attachment input) reply
  ephemeral by default; full JSON comes back as a file. There is no
  `/meta edit` — freeform tags are clunky as slash options, prefix `!edit`
  covers it.
- Prefix (default `!`): `!scan !read !ai !hash !strip !edit KEY=VALUE !help`,
  plus `!autoscan on|off` (needs Manage Channels). Works on attachments in
  the same message or the replied-to message, max 3 attachments per command.
- In-channel prefix replies are redacted (verdicts/flags only — no GPS,
  serials, or owner names); the full report goes to your DM, or a
  redacted-only notice if DMs are closed.
- Downloads only from `cdn.discordapp.com` / `media.discordapp.net`, size
  checked with HEAD before GET (flag > `MAX_FILE_MB` > config > 10 MB
  default), magic bytes validated instead of trusting the extension,
  per-user rate limit (5/min default), optional guild/user allowlists, temp
  files deleted in `finally`, no uploads stored.
- Auto-scan is OFF by default; per-channel opt-in only.

## Format support

See [docs/FORMAT_MATRIX.md](docs/FORMAT_MATRIX.md) — generated by probing
real fixtures, never assumed. JPEG/PNG/WebP/GIF/AVIF verified for read,
write, and strip; TIFF strip leaves structural EXIF residuals (reported, not
hidden); HEIC/MP4/RAW are detection-level here (no fixtures on the test
host).

## Development

```sh
npm run typecheck && npm run lint && npm test
npm run build
npx tsx scripts/gen-format-matrix.ts   # regenerate docs/FORMAT_MATRIX.md
```

Architecture: `src/core/` is a pure library with zero imports from `src/cli`
or `src/discord`; both are thin wrappers around it. Every source file stays
under ~300 lines. Design history lives in [PLAN.md](PLAN.md) (build plan)
and [DECISIONS.md](DECISIONS.md) (decision log); security practices in
[SECURITY.md](SECURITY.md).

## Limitations

- No C2PA-signed fixture exists (needs a real signer), so manifest
  removal/validation paths are implemented but unproven end to end.
- Synthetic fixtures cannot carry real MakerNotes or camera thumbnails.
- `hash` similarity on flat/solid images is degenerate (no structure).
- `watch` writes per-file JSON sidecars only, no running aggregate.
- The bot has unit/integration tests for security, redaction, and runners,
  but no live-Discord E2E (needs a real token and server).

## License

`package.json` declares MIT, but no `LICENSE` file ships in the repo yet —
add one with the copyright holder before publishing.
