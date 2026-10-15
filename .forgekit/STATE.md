# metascope — ForgeKit State (2026-10-14)

## Goal

Continue metascope development from Phase 3 (AI detection + scan/hash/global) toward Phase 4 (batch/watch/reports). Current focus: ML pixel classifier integration and model management.

## Acceptance Criteria

- ML pixel classifier (`mlPixel.ts`) works as optional detector in `ai-check` and `scan`
- `ms models install|list|remove|verify` CLI manages ONNX model lifecycle
- `--no-ml` flag disables ML detector without breaking flows
- All gates pass: `npm run typecheck && npm run lint && npm test`
- No regression in existing metadata read/write/strip/privacy/C2PA paths

## Constraints (Hard)

- Node.js 22, ESM, strict TS (TS 5.9.3 due to eslint peer)
- `exiftool-vendored@39.0.1` only engine; no hand-written parsers
- `sharp@0.35.5` optional, graceful degrade
- `@huggingface/transformers` for ML — pure JS, no native deps
- ARM64 + root host; prefer prebuilts, no sudo assumptions
- Originals never touched without `--in-place` + backup
- `clean` = max privacy; pixel watermarks (SynthID) never claimed removed
- No secrets in config/memory; token only from `DISCORD_TOKEN` env

## Decisions & Rationale

| Decision                                                                      | Rationale                                                                                                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| ML detector is optional, lazy-loaded, returns `weak`/`possible` evidence only | Prevents crash on missing model; evidence capped at `possible` per DECISIONS (vendor strings cap at `likely`, weak signals → `possible`) |
| Model stored in XDG data dir (`~/.local/share/metascope/models/...`)          | Consistent with snapshot dir; no litter in scanned folders                                                                               |
| `--no-ml` flag on `ai-check` and `scan`                                       | User control; Discord bot can disable for speed                                                                                          |
| `ms models install` requires interactive confirmation                         | Large download (~58 MB); explicit consent                                                                                                |
| SHA256 verification mandatory after download                                  | Supply-chain integrity; model hash pinned in code                                                                                        |

## Completed Work (this session)

1. Added `src/core/detectors/mlPixel.ts` — ONNX image classifier detector (`ml-pixel-classifier`)
2. Added `src/cli/models.ts` — `ms models install|list|remove|verify` command group
3. Modified `src/core/aiCheck.ts`:
   - `getDefaultDetectors()` factory (non-ML detectors only)
   - Core library no longer imports ML detector
4. Modified `src/cli/aiCheck.ts`:
   - `--no-ml` option
   - Explicitly imports and passes `mlPixelDetector` when enabled
5. Modified `src/core/scan.ts` + `src/cli/scan.ts`:
   - `noML` option propagated
   - Added `extraDetectors` parameter for optional ML detector
6. Updated `src/core/schemas.ts` — `noML` in scanOptionsSchema
7. Minor CI formatting (yaml quotes) + README whitespace cleanup
8. `package-lock.json`: `discord.js` pinned exact `14.27.0` (was `^14.27.0`)
9. Added `/meta privacy-scan` slash command (`src/discord/commands.ts`) — maps to existing `runPrivacy`
10. Updated `docs/DISCORD_PARITY.md` — added privacy-scan to slash command map
11. **Fixed vitest SIGILL on ARM64**: Removed ML detector from core library import chain; CLI/Discord explicitly import and pass `mlPixelDetector` via `extraDetectors` parameter. Added `vite.config.ts` with SSR external config.
12. Added `@huggingface/transformers@3.8.0` to package.json and ran `npm install`
13. **Fixed `ms models install` SIGILL**: download now direct HTTP via `fetch` from HF Hub (no transformers import); removed inference smoke test, replaced with file-size check + SHA256 verify. Model 55.7 MB downloaded and SHA256-verified OK.
14. **Fixed `mlPixel` load order**: model-existence check now runs BEFORE importing transformers (native SIGILL is uncatchable, so never import when no model exists)
15. **Fixed commander `--no-*` flag bug**: `--no-ml`/`--no-hash` map to `options.ml/hash === false`, not `options.noMl/noHash` — flags never worked before. Fixed in `aiCheck.ts`, `scan.ts`, `watch.ts` (this also fixes pre-existing `--no-hash` no-op)

## Exact Verification Results

- **Typecheck**: ✅ `tsc --noEmit` passes (2026-10-15)
- **Lint**: ✅ `eslint . && prettier --check .` passes (2026-10-15)
- **Tests**: ✅ 66/66 pass, 0 failures (2026-10-15)
- **Build**: ✅ `tsc` + `npm link` OK, global `ms` works (2026-10-15)
- **Manual smoke** (2026-10-15):
  - `ms models install` → download 55.7 MB + SHA256 verified OK, exit 0
  - `ms models list` → shows installed model, exit 0
  - `ms ai-check <png> --no-ml` (model installed) → exit 0, no crash
  - `ms scan <dir> --no-ml --format json` → exit 0, report written
  - `ms ai-check <png>` (model installed, ML enabled) → SIGILL exit 132 (expected: native crash, uncatchable)

> Gates 3/3 passed + smoke partial (ML-off paths OK).

## Blockers

- ML inference UNSUPPORTED on this host: bare `import('@huggingface/transformers')` → SIGILL exit 132 (onnxruntime-node@1.21.0 native build incompatible with this ARM64 CPU). Try/catch cannot catch native crashes. Use `--no-ml` here.
- No test fixtures for ML detector
- Inference path still untested on a compatible host

## Changed Paths

```
M .github/workflows/ci.yml          (formatting only)
M README.md                         (whitespace only)
M package-lock.json                 (discord.js pin + transformers)
M package.json                      (+ @huggingface/transformers)
M src/cli/aiCheck.ts                (--no-ml flag, explicit ML detector import)
M src/cli/scan.ts                   (--no-ml flag, passes extraDetectors)
M src/core/aiCheck.ts               (getDefaultDetectors factory, no ML import)
M src/core/scan.ts                  (noML option, extraDetectors parameter)
M src/core/schemas.ts               (noML in schema)
M src/discord/commands.ts           (+ privacy-scan, passes mlPixelDetector)
M src/discord/runner.ts             (runScan/runAi accept extraDetectors, no ML import)
M docs/DISCORD_PARITY.md            (+ privacy-scan in slash map)
A src/core/detectors/mlPixel.ts     (NEW: ML pixel detector)
A src/cli/models.ts                 (NEW: models CLI command)
A vite.config.ts                    (NEW: SSR external for mlPixelDetector)

Uncommitted (post-dcbb344):
M src/cli/aiCheck.ts                (commander --no-ml mapping fix)
M src/cli/models.ts                 (HTTP direct download, no transformers import)
M src/cli/scan.ts                   (commander --no-ml/--no-hash mapping fix)
M src/cli/watch.ts                  (commander --no-hash mapping fix)
M src/core/detectors/mlPixel.ts     (model check before transformers import)
M vite.config.ts                    (removed invalid deps/ssr keys)
```

## Next Actions (Ordered)

1. Add unit test for `mlPixelDetector` (mock pipeline, verify evidence shape)
2. Add integration test for `--no-ml` flag on `ai-check` and `scan`
3. Consider: `ai-eval` command + remote API detector (opt-in, default OFF) per original plan

## Docs pass (2026-10-15, uncommitted)

- README rewritten for consistency: commands table now matches `src/core/help.ts`
  (added `models`, `help`, `--no-ml`/`--no-hash`; fixed `ai-check` row, `gps --show`);
  new "AI pixel classifier" section (model, install, XDG path, SHA256, `possible`
  cap, ARM64 SIGILL note); Discord slash list + `privacy-scan`; prefix list now
  matches `prefix.ts` reality with parity-doc footnote; License section fixed
  (LICENSE exists); Limitations += ML runtime note.
- `src/core/help.ts`: ai-check one-liner (drop "metadata only"), privacy-scan
  slash `/meta privacy-scan`, new `models` entry (keeps `ms help models` truthful).
- Verified: typecheck/lint/build OK, full suite 66/66, `ms help models` smoke OK.

## Assumptions

- `@huggingface/transformers` works on Node 22 ARM64 without native build (pure JS ONNX runtime)
- Model `onnx-community/ai-image-detect-distilled-ONNX` remains available on HF Hub
- `env.localModelPath` + `allowRemoteModels: false` fully prevents network calls at inference time
- XDG data dir is writable (running as root here, but should work for regular users)
- vitest/esbuild static analysis avoided by keeping ML detector out of core library import chain

## Risks

| Risk                                                   | Likelihood | Impact                                         | Mitigation                                                                                                                                                                                                |
| ------------------------------------------------------ | ---------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transformers fails to load on some ARM64/Termux hosts  | Medium     | ML detector returns `weak` evidence (graceful) | JS errors handled: try/catch → `weak` signal; NATIVE SIGILL (onnxruntime-node@1.21.0, confirmed exit 132 on this host) is uncatchable → use `--no-ml`; consider onnxruntime-web (wasm) as future fallback |
| Model download fails (network/HF rate limit)           | Low        | `install` command errors, user retries         | Interactive confirm + cleanup on failure                                                                                                                                                                  |
| False positives/negatives on compressed/resized images | High       | Evidence marked `possible` with disclaimer     | Already in detector details text                                                                                                                                                                          |
| Test parallelism collides with model cache             | Low        | Flaky tests                                    | Fixture isolation already fixed (run-<pid> namespaces)                                                                                                                                                    |

---

_Generated by forge-session-handoff + forge-project-memory. Verify against worktree before handoff._
