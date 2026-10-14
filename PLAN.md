# metascope — PLAN (Phase 0 Recon)

Engine: `exiftool-vendored` only. No hand-written metadata parsers,
except raw PNG chunk scan where ExifTool cannot do the job.
CLI output, code, comments, docs: English.

## 0. Environment verification (real output, 2026-10-14)

```
$ node -v        -> v22.23.3  (OK, required 22)
$ npm -v         -> 10.9.9
$ uname -a       -> Linux localhost 4.19.127+ aarch64 aarch64 GNU/Linux (ARM)
$ perl           -> /usr/bin/perl, v5.38.2 (OK for exiftool-vendored)
$ system exiftool -> missing (OK, vendored binary is used)
$ c2patool       -> missing (OK, optional fallback only)
$ uid            -> 0 (running as root)
```

Load test in `/tmp/opencode/metascope-recon` (isolated, not the repo):

```
$ npm install exiftool-vendored@39.0.1 -> OK, 7 packages
$ node import('exiftool-vendored')     -> OK, exports ExifTool, exiftool, ...
$ new ExifTool().version()             -> 13.59 (proves Perl + binary work)
$ npm install sharp@0.35.5            -> OK, 9 packages
$ require('sharp') / import('sharp')   -> OK (CJS + ESM, aarch64 prebuilt)
```

Verified `ExifTool` API surface from `dist/ExifTool.d.ts` (v39.0.1):
`read(file, options)`, `write(file, tags, options)`, `deleteAllTags`,
`extractThumbnail`, `extractPreview`, `rewriteAllTags`, `version()`, `end()`.

## 1. Pinned versions (all verified via `npm view`, none installed in repo yet)

| pkg                    | version           | note                                                                                                                                         |
| ---------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| exiftool-vendored      | 39.0.1            | engine, bundles ExifTool 13.59                                                                                                               |
| sharp                  | 0.35.5            | OPTIONAL dep only                                                                                                                            |
| commander              | 15.0.0            | CLI (picked over citty, see DECISIONS.md)                                                                                                    |
| zod                    | 4.6.7             | validation; v4 API must be re-read, not assumed from v3                                                                                      |
| vitest                 | 5.0.4             | newer than training data, verify config                                                                                                      |
| eslint                 | 10.12.0           | flat config only, verify                                                                                                                     |
| prettier               | 3.9.10            |                                                                                                                                              |
| typescript             | 7.0.2             | strict, ESM; verify `tsc` flags (may differ from TS 5)                                                                                       |
| tsx                    | 4.23.15           | dev runner                                                                                                                                   |
| @types/node            | pinned in phase 1 | check latest 22.x line at scaffold time                                                                                                      |
| discord.js             | 14.27.0           | phase 5 only                                                                                                                                 |
| @contentauth/c2pa-node | 0.9.9             | EXISTS but native Rust via cargo-cp-artifact; risky on ARM/root. NOT a hard dep. Default: ExifTool JUMBF parse + optional `c2patool` binary. |

## 2. Architecture (enforced from phase 1)

```
src/core/     pure library, zero imports from src/cli or src/discord
src/cli/      thin wrappers: arg parse (commander) + zod validation + call core
src/discord/  phase 5 only, reuses core, never duplicates logic
```

Rules: argument arrays only (never string-interpolated shell).
Never touch originals by default; `--out` dir or new file.
In-place requires explicit `--in-place` plus backup.
Every file < ~300 lines.

## 3. Phases and acceptance

- Phase 1: scaffold (ESM, strict, eslint+prettier, vitest), core reader +
  `read` (namespaces, --format table|json|md, --raw, --thumbnail),
  fixtures generator (sharp-created images, exiftool-written tags in tests).
- Phase 2: `write`, `copyright`, `gps`, `dates`, `strip` + `--verify`,
  `snapshot save|list|show|restore|diff`.
- Phase 3: `hash`, `ai-check` (layered detectors + disclaimers),
  `privacy-scan`.
- Phase 4: `batch`, `watch`, reports, format matrix doc.
- Phase 5: Discord bot (only after explicit "lanjut"; ephemeral replies).
- Phase 6: README, `--help` audit, hallucination self-review.

Per-phase gate: `npm run typecheck && npm run lint && npm test`
with REAL output + live demo on generated fixtures. No stubs/TODOs.
One phase at a time; STOP and wait for "lanjut".

## 4. Key edge cases and risks

- Missing Perl on non-Windows: detect `which perl` / spawn failure,
  print install fix, exit non-zero. Already OK here.
- sharp load failure: try/catch dynamic import, degrade
  pixel-hash/perceptual-hash with clear message, never crash.
- `strip --verify` must re-read output; "clean" only if re-read proves it.
- C2PA/AI removal warns (non-blocking, `--yes` skips).
- Docs + output state: stripping metadata does NOT remove
  invisible pixel watermarks (e.g. SynthID).
- ai-check verdict enum: `confirmed_by_metadata | likely | possible | no_evidence`;
  always print evidence list + absence-of-metadata disclaimer.
- Hashes are integrity/duplicate only, NOT AI detection.
- HEIC/RAW/MP4: document read/write/strip per format; never fake a write.
- Root + ARM: prefer prebuilts, keep native deps minimal, no `sudo` assumptions.
- TS 7 / eslint 10 / vitest 5 / zod v4 are newer than model training:
  README + `.d.ts` must be read before use in phase 1.
