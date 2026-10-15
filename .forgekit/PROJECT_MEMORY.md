# metascope — Project Memory

> Compressed index of durable facts. Not a transcript. Verify against current repo.

---

## Product Goals & Constraints

- **Engine**: ExifTool via `exiftool-vendored@39.0.1` (bundles ExifTool 13.59). No hand-written parsers except PNG chunk scan.
- **CLI**: `commander@15.0.0`, Node ≥22, ESM, strict TS.
- **Primary interface**: Terminal CLI (`metascope` / `ms`). Discord bot optional (Phase 5).
- **Safety invariants**: Originals never touched by default; `--out` dir or new file with suffix; `--in-place` requires explicit flag + `.metascope.bak` backup; `--verify` re-reads and proves `clean` only when residuals empty.
- **Dependencies**: `sharp` optional (graceful degrade); no native deps required for core. `onnxruntime-node` avoided (ARM/Termux risk).
- **Licenses**: All deps Apache-2.0 / MIT / BSD-compatible. Model downloads must verify license.

---

## Architecture Boundaries (enforced)

```
src/core/      pure library, zero imports from src/cli or src/discord
src/cli/       thin wrappers: arg parse + zod validation + call core
src/discord/   reuses core, never duplicates logic
```

- Every file ≤ 300 lines.
- Argument arrays only (never string-interpolated shell).
- XDG data dir for snapshots: `~/.local/share/metascope/snapshots` (honors `XDG_DATA_HOME`).
- Config: optional `~/.config/metascope/config.json` (zod-validated; CLI flags win). No secrets in config.

---

## Key Decisions (from DECISIONS.md)

| Date       | Decision                                                      | Rationale                                                                                                                                              |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-14 | Strip default mode = `privacy` (not `all`)                    | Safe default: removes GPS/serials/owner/device/timestamps, keeps orientation + ICC                                                                     |
| 2026-10-14 | `onnxruntime-node` NOT used                                   | Native Rust build (cargo-cp-artifact); fails on ARM/Termux/proot                                                                                       |
| 2026-10-14 | C2PA: ExifTool JUMBF parse + optional `c2patool` binary       | Avoid native deps; `@contentauth/c2pa-node` pulls Rust                                                                                                 |
| 2026-10-14 | AI verdict rules                                              | `confirmed_by_metadata` only from C2PA manifest / DigitalSourceType / generator params; vendor strings cap at `likely`; camera EXIF = counter evidence |
| 2026-10-14 | Perceptual hashes: pure TS (aHash/dHash/pHash)                | No external dep; Hamming: identical(0)/likely-same(≤5)/similar(≤10)                                                                                    |
| 2026-10-14 | Discord: ephemeral slash, redacted prefix, DM full report     | Privacy: GPS/serials/owner never in channel                                                                                                            |
| 2026-10-14 | ICC_Profile:ProfileCopyright = profile maker, not photo owner | Fixed false positive; owner tags from explicit allowlist only                                                                                          |
| 2026-10-14 | Test isolation: per-process `test-tmp/run-<pid>/`             | Prevents parallel `npm test` collision                                                                                                                 |

---

## Phase Status (from PLAN.md)

| Phase | Scope                                                              | Status                                |
| ----- | ------------------------------------------------------------------ | ------------------------------------- |
| 1     | Scaffold, core reader, `read` command, fixtures                    | ✅ Done                               |
| 2     | `write`, `copyright`, `gps`, `dates`, `strip --verify`, `snapshot` | ✅ Done                               |
| 3     | `hash`, `ai-check` (layered metadata detectors), `privacy-scan`    | ✅ Done                               |
| 4     | `batch`, `watch`, reports (JSON/MD/CSV/HTML), format matrix        | ✅ Done                               |
| 5     | Discord bot (slash `/meta`, prefix `!`, ephemeral/redacted)        | ✅ Done (wired per DISCORD_PARITY.md) |
| 6     | README, `--help` audit, hallucination self-review                  | ✅ Done                               |

**Current gate**: `npm run typecheck && npm run lint && npm test` — all pass (66 tests).

---

## Known Limitations (documented, not claimed as features)

- No C2PA-signed fixture → manifest removal/validation unproven end-to-end.
- Synthetic fixtures lack real MakerNotes / camera thumbnails.
- Perceptual hash degenerate on flat/solid images.
- `watch` writes per-file JSON sidecars only (no running aggregate).
- Discord bot: no live-Discord E2E tests (needs real token/server).
- HEIC/MP4/RAW: detection-level only (no fixtures on test host).
- `hash` similarity NOT AI detection.

---

## Reproducible Commands

```bash
# Full CI gate
npm run typecheck && npm run lint && npm test

# Build
npm run build

# Run CLI (dev)
npx tsx src/cli/index.ts <command>

# Run CLI (built)
./dist/src/cli/index.js <command>

# Regenerate format matrix
npx tsx scripts/gen-format-matrix.ts

# Discord bot (needs .env with DISCORD_TOKEN)
npx tsx src/cli/index.ts bot
```

---

## Next Actions (this task: AI Pixel Detector)

### Research Completed (2026-10-14)

- **Runtime**: `@huggingface/transformers` (WASM/ONNX Runtime Web) — works on Linux arm64 + Termux proot, no native deps. Uses `sharp` for decode.
- **Model candidates** (Apache-2.0, ONNX):
  1. `onnx-community/ai-image-detect-distilled-ONNX` — 11.8 MB, ViT-distilled (11.8M params), 74% val / 72% real-world acc. **Recommended default**.
  2. `onnx-community/ai-image-detection-ONNX` — 935 MB, ViT-B/16 (86M params), CIFAKE dataset (pre-2024 generators).
  3. `onnx-community/SMOGY-Ai-images-detector-ONNX` — license unclear, skip.
- **Preprocessing**: 224×224 resize → normalize with ImageNet mean/std `[0.485,0.456,0.406]` / `[0.229,0.224,0.225]` (handled by transformers.js `RawImage.fromBlob` + processor).
- **Output labels**: `Real` / `Fake` (binary classification).

### Implementation Plan (awaiting "lanjut")

#### 1. Core: `src/core/mlDetector.ts`

- New `Detector` plugin: `id: "ml-pixel-classifier"`
- Lazy-load `@huggingface/transformers` + model on first `run()`
- Returns `Evidence[]` with confidence **capped at "possible"**
- Adds quality warnings: small image (<224px), heavy JPEG compression, upscaled
- If model not installed → graceful skip (evidence: `"ML detector tidak aktif"`)

#### 2. CLI: `src/cli/models.ts` → `ms models install|list|remove`

- `ms models install` — shows model card (size, license), prompts confirm, downloads to XDG data dir (`~/.local/share/metascope/models/`), verifies sha256
- `ms models list` — shows installed models with versions
- `ms models remove` — deletes model files

#### 3. Integration

- `aiCheck.ts` — add `mlPixelDetector` to `DEFAULT_DETECTORS` (optional, skipped if not installed)
- `scan.ts` — include ML score in report JSON/MD/HTML/CSV
- Discord `runAi` / `runScan` — automatically use via core (no duplicate logic)
- Flag `--no-ml` to disable

#### 4. Evaluation: `ms ai-eval <real-dir> <ai-dir>`

- Runs detector on labeled folders, prints confusion matrix, FPR/FNR/accuracy
- **Never claims accuracy without real user data**

#### 5. Remote API Plugin (OPT-IN ONLY, DEFAULT OFF)

- Separate plugin, explicit config enable
- Privacy warning + per-session confirm
- Never in Discord bot by default

---

## Blocker / Open Questions

1. **Model choice**: `ai-image-detect-distilled-ONNX` (11.8 MB) vs `ai-image-detection-ONNX` (935 MB)? → Recommended: distilled.
2. **Scope**: Full plan above, or start with detector plugin + `models` CLI only?
3. **Discord parity**: Add `/meta privacy-scan` slash command (currently missing per DISCORD_PARITY.md)?
4. **Evaluation data**: User must provide labeled real/ai folders for `ai-eval` — synthetic fixtures don't count.

---

## What NOT in Scope (per user instruction)

- ❌ Removing/defeating watermarks (SynthID, C2PA)
- ❌ Spoofing detection results
- ❌ Any destructive operation on provenance
