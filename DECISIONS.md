# DECISIONS

Log for ambiguous choices. Safest default wins. No user interrogation.

## 2026-10-14 (Phase 0 recon)

- CLI: `commander@15.0.0` over `citty@0.2.2`.
  Reason: commander is mature, stable API, wider examples.
  citty is smaller but less proven for this matrix of subcommands.
- C2PA: default to ExifTool JUMBF parse + optional `c2patool` binary.
  Reason: `@contentauth/c2pa-node@0.9.9` exists but pulls native
  Rust build (cargo-cp-artifact); risky on ARM/root/Termux.
  Re-evaluate as optional experiment in phase 3 only.
- sharp@0.35.5 is OPTIONAL dependency with graceful degrade.
  Reason: prebuilt works on this aarch64 box today, but must not
  crash on hosts where it fails (Termux/proot).
- Validation: `zod@4.6.7` (current latest), but v4 API must be
  re-read from README + `.d.ts` at scaffold time, not assumed from v3.
- Toolchain pins deferred to phase 1 scaffold (`typescript@7.0.2`,
  `vitest@5.0.4`, `eslint@10.12.0` are newer than training data;
  config must follow installed docs, not memory).

## 2026-10-14 (Phase 1 scaffold)

- TypeScript: `5.9.3` over `7.0.2`.
  Reason: `typescript-eslint@8.71.2` peer requires `<6.1.0`;
  TS 7 has no eslint support yet. Node 22 works fine on TS 5.9.
- Glob: `tinyglobby@0.2.17` for `<files|globs>`.
  Reason: lightweight, no native deps, verified `glob()` signature.
  Test normalizes with `resolve()` because glob returns relative
  paths even for absolute patterns when `absolute: false`.
- WriteTags: use bare names (`Artist`, `Title`) not prefixed
  (`EXIF:`, `XMP:`). Reason: `WriteTags.d.ts` only allows prefixed
  date tags; bare names are the writable contract. Verified live.
- Bin: `./dist/src/cli/index.js` (not `./dist/cli/index.js`).
  Reason: `rootDir: "."` preserves `src/` prefix in `dist/` output.
- Raw mode: `numericTags: ["*"]`.
  Reason: verified live (`YCbCrPositioning` 1 vs Centered).
  Default (cooked) omits the option to keep ExifTool print conversion.

## 2026-10-14 (Phase 2 edits)

- Strip default mode: `privacy` (not `all`).
  Reason: `all` is the most destructive; the safe default removes
  GPS/serials/owner/device/timestamps while keeping orientation + ICC.
- `--shift` takes integer seconds with wall-time arithmetic
  (not ExifTool shift syntax). Reason: unambiguous, testable, and
  timezone-independent (uses `rawValue` + UTC math, so the +07:00
  inference cannot drift the result on re-read).
- Copyright mapping: owner to Artist/By-line/Creator/Owner, notice to
  Copyright/CopyrightNotice/Rights, URL to WebStatement, terms to
  UsageTerms. Without `--sync`, only Artist/Copyright (+ URL/terms)
  are written. Verified live on JPEG (all nine tags round-trip).
- Privacy mode keeps descriptive/structural tags (ImageDescription,
  Title, YCbCrPositioning, XMPToolkit) but removes embedded
  thumbnails/previews (they can leak the same private data).
  `--verify` always lists residuals; "clean" only when zero remain.
- Write verification is date-aware (first-14-digits compare).
  Reason: `ExifDateTime.toString()` renders ISO with inferred zone
  (`...+07:00`), never equal to EXIF input text. Identical-value
  writes count as written (ExifTool reports `unchanged`).
- `Orientation` is written/read as `Orientation#` (numeric).
  Reason: bare numeric write fails PrintConv (FAQ Q6); `#` form and
  `retain: ["Orientation"]` verified live.
- In-place backup: `<file>.metascope.bak` copy before any mutation
  (ExifTool also keeps `file_original`). No original is touched
  without `--in-place`.
- CLI errors print one clean line + exit 1 (global catch in
  `src/cli/index.ts`); SIGINT/SIGTERM always close the ExifTool
  child so the CLI never hangs.
- Fully loaded fixture cannot synthesize real MakerNotes or embedded
  thumbnails without a camera. Removal is proven by absence
  (zero MakerNotes/Thumbnail residuals) plus the exercised code
  paths; documented as a limitation, not claimed otherwise.

## 2026-10-14 (Phase 3 scan/hash/AI/global)

- Zip: `adm-zip@0.6.1` (pure JS, zero deps) over `jszip`/`archiver`.
  Reason: smallest safe option for ARM/root, verified
  `new AdmZip()/addLocalFile/writeZipPromise` in its `types.d.ts`.
  `--zip` lives on `strip`/`clean` (multi-output commands only).
- Snapshots moved from `./.metascope/` to XDG data dir
  (`~/.local/share/metascope/snapshots`, honors `XDG_DATA_HOME`).
  Reason: never litter scanned folders. Override order:
  `METASCOPE_SNAPSHOT_DIR` env > `--snapshot-dir` flag > config file.
  Tests use explicit per-test directories.
- Config: optional `~/.config/metascope/config.json` (zod-validated:
  outputDir, concurrency 1-32, snapshotDir, non-secret discord
  settings only — never a token). CLI flags always override config.
- Default outputs: `./metascope-out/<name>_clean.<ext>` for
  strip/clean, `<name>_edited.<ext>` for write/copyright/gps/dates.
  Reason: original filenames stay grabbable, originals never touched.
  `clean` = strip all + verify; `edit` is a commander alias of write;
  `ms` is a second `bin` entry.
- `strip` default mode stays `privacy`, now also clears
  LensMake/LensModel/LensInfo/LensID (device-identifying).
  Descriptive tags (ImageDescription, Title) and structural tags are
  kept and disclosed by `--verify`, never silently claimed clean.
- Privacy timestamps skip the `File:` group (filesystem mtime is not
  embedded metadata and stripping cannot remove it).
- Perceptual hashes are pure-TS (aHash 8x8/mean, dHash 9x8/gradients,
  pHash 32x32/DCT with DC excluded) per the HackerFactor reference;
  Hamming verdicts identical(0)/likely-same(<=5)/similar(<=10).
  `--no-hash` skips pixel decode + perceptual hashes, keeps file hashes.
- AI verdict: `confirmed` needs a C2PA manifest, an AI DigitalSourceType,
  or generator params; vendor strings cap at `likely`; weak signals
  alone give at most `possible`; camera EXIF+ counts as counter evidence.
  The C2PA detector matches group/tag names only (a DigitalSourceType
  URI containing "c2pa" must not count as a manifest).
  `c2patool` is probed read-only when a manifest exists; offline
  validation status is reported as unverified, never valid.
- Scan reports count C2PA only for manifest evidence (same URI guard).
  Unknown-magic files are still tried in ExifTool; only files with no
  substantive metadata groups are reported as unsupported/corrupt.
  `--format html` fails with a clear Phase-4 message; the report model
  stays a pure render step. `scanBuffer` spills to temp for thin
  Discord-style adapters (no bot built yet).
- No real C2PA-signed fixture exists (needs a camera/service signer),
  so manifest removal/validation is unproven and claimed as such.
  ComfyUI prompt/workflow chunks are hand-injected with valid CRCs
  (ExifTool defines no such tags) and cross-read by ExifTool.
- Buffer typings: `@types/node@22.20` distinguishes
  `Buffer<ArrayBufferLike>`/`NonSharedBuffer`; boundaries use
  `Uint8Array` to stay compatible.
- Test isolation: parallel vitest workers must not share fixture dirs
  (each file uses its own directory) after rename/contention failures.

## 2026-10-14 (Phase 4 batch/watch/reports/matrix)

- Watch uses manual per-directory `fs.watch` (verified in
  `@types/node/fs.d.ts` + live node check), NOT `recursive: true`.
  Reason: recursive watching is not portable to Linux (the primary
  target); manual recursion honors depth/skips and picks up new
  subdirs. Per-file debounce (default 500ms); deleted files skip
  quietly; watch writes per-file JSON sidecars only (no aggregate
  while streaming).
- `batch strip|write` reuses `stripFile`/`applyTags`/`prepareOutput`
  with a concurrency pool (default 4, cap 32, config-overridable).
  `--dry-run` resolves inputs and prints the plan but writes nothing
  except the audit report (report.json/csv always written — the audit
  trail; originals provably untouched by hash check in tests).
  Single-file commands (copyright/gps/dates) stay single-file.
- HTML report is one self-contained file (inline CSS, no external
  assets); every interpolated user string goes through `escapeHtml`
  (proven by a `<script>`-filename unit test). CSV renderers escape
  per RFC-4180-ish quoting.
- Format matrix (`docs/FORMAT_MATRIX.md`) is generated, not hand-written,
  by `scripts/gen-format-matrix.ts` (read/write/strip probes per format).
  Honest cells: TIFF strip leaves structural EXIF residuals; HEIC/MP4/RAW
  are detection-only or not-recommended, marked untested here.
  No encoder for HEIC on this host (sharp `.heif()` needs explicit
  options and still failed), so no HEIC fixture exists.
- E2E tests invoke the real CLI via `node_modules/.bin/tsx` with
  argument arrays (no shell implicitly): batch dry-run asserts exit 0
  - untouched originals; watch asserts a dropped file is scanned and a
    sidecar with `aiVerdict` appears. One transient failure occurred
    under parallel load (demos running alongside the suite); green on
    reruns including an isolated re-run of the timing-sensitive files.

## 2026-10-14 (Phase 5 Discord bot + Phase 6 docs/review)

- discord.js v14 (pinned 14.27.0, pure-JS deps only, Node >= 18) over
  raw REST calls. Verified at runtime: Client, intent bits, builders,
  events, `ephemeral` reply option, `fetchReference`, `createDM`,
  `isSendable`, `ApplicationCommandManager.set`, error 40005.
- Slash `/meta` (read/strip/ai-check/hash/scan) always ephemeral with
  attachments; no `/meta edit` (freeform tags are clunky as slash
  options — prefix `!edit` covers it).
- Prefix in-channel output is redacted (verdicts/flags only, secrets
  never printed); cleaned/edited images are safe to post publicly,
  reports go to DM with a redacted-only fallback when DMs are closed.
  Max 3 attachments per prefix command (abuse cap).
- Upload ceiling: official API docs state 25 MiB max request size, used
  as the pre-send check; per-tier boost numbers are NOT hardcoded
  (unverified) — oversized sends fall back via 40005 catch to
  zip/text-only. Download cap: flag > `MAX_FILE_MB` > config > 10 MB,
  HEAD-checked before GET, host-exact allowlist, magic-bytes validated.
- Token only from `DISCORD_TOKEN` (`.env`, never logged); missing
  MessageContent intent fails with portal steps (4014/DisallowedIntents
  handled); rate limit 5/min/user; allowlists default-open, deny is
  silent for prefix (anti-probe) and ephemeral for slash; autoscan
  in-memory per channel, Manage-Channels-gated, OFF by default.
- Bot has offline unit/integration tests (policy, redaction, runners)
  but no live-Discord E2E — stated in README, not claimed.
- README is the canonical overview; `docs/FORMAT_MATRIX.md` stays as
  the generated reference. `--help` audited for all 15 commands.

## 2026-10-14 (test harness: parallel-run collision fix)

- Two overlapping `npm test` runs shared deterministic `test-tmp/<name>`
  paths; each `ensure*()` starts with `rm -rf`, so run B deleted run A's
  fixtures mid-write (`sharp toFile ENOENT`, `ENOTEMPTY rmdir`, scan seeing
  9 files instead of 8, e2e timeout under double load).
- Fix: `testTmp()` in `tests/fixtures.ts` namespaces every fixture path
  under `test-tmp/run-<pid>/`; all call sites migrated, plus
  `tests/globalSetup.ts` sweeping only entries older than 2h (safe against
  a concurrently running suite). Legacy top-level leftovers removed.
