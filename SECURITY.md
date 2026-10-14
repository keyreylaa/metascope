# Security

What metascope does with your files, credentials, and network access. All
statements below describe verified behavior in this repo, not aspirations.

## Files

- CLI edit/strip commands never modify originals by default. They write
  copies into `<cwd>/metascope-out/` (or `--out` / config `outputDir`).
- `--in-place` is the only path that modifies an original, and it copies a
  `.metascope.bak` backup first (ExifTool additionally keeps `*_original`
  files when it writes; tests clean those up).
- `scan`, `read`, `hash`, `ai-check`, `privacy-scan`, and `watch` are
  read-only. The one exception: `read --thumbnail` writes extracted
  thumbnail files to `--out` when given, otherwise next to the source
  file — pass `--out` to keep scanned folders clean.
- `batch --dry-run` resolves inputs and prints the plan; the audit report
  (`report.json`/`report.csv`) is still written, originals are untouched.

## Credentials

- The Discord bot token comes only from the `DISCORD_TOKEN` environment
  variable (typically via a local `.env` file, see `.env.example`). It is
  never logged, never written to config, and the config schema
  (`src/core/config.ts`) accepts only non-secret Discord settings
  (prefix, size cap, allowlists, rate limit, dev guild id).
- `.env` is gitignored. Do not paste tokens into issues, logs, or reports.

## Discord bot

- Attachments download only from `cdn.discordapp.com` and
  `media.discordapp.net` (exact host match — subdomains of lookalikes are
  rejected).
- Size is checked with a HEAD request before download (flag
  `--max-file-mb` > `MAX_FILE_MB` env > config > 10 MB default). Files
  without a declared `content-length` are refused.
- Downloaded bytes are validated by magic bytes, not file extension.
- In-channel prefix replies are redacted: verdicts and yes/no flags only.
  GPS coordinates, serials, and owner names never appear in channel text;
  full reports go via DM, with a redacted-only notice when DMs are closed.
- Temp files are removed in a `finally` block; uploads are never stored.
- Per-user rate limit (default 5 calls/minute). Optional guild/user
  allowlists (default open); prefix denials are silent, slash denials are
  ephemeral. Auto-scan is off by default and opt-in per channel.

## Reporting a problem

No dedicated security contact is set up for this project yet. If you find a
vulnerability (path traversal, SSRF via attachment URLs, secret leakage into
reports), do not open a public issue with exploit details — describe the
impact privately to the maintainer first.
