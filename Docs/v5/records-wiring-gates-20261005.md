# Records wiring — offline gates, 5 October 2026

Single served constructor seam now calls buildModelFromRecords. No provider, network, install, push or signed-in witness was used. No edits under src/cee/draft/records/.

| Gate | Exit | Evidence |
|---|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | 0 | Installed local binary; npm offline. After local OpenAPI generation. |
| `bash scripts/ci/typecheck-ratchet.sh` | 0 | 100 files / 290 errors within baseline 103 files / 291; baseline unchanged. |
| `node node_modules/eslint/bin/eslint.js <changed .ts/.mjs files>` | 0 | No source errors; scripts excluded by repo config (2 warnings). New checker/identity helper also forced-linted successfully. |
| `bash scripts/check-forbidden-boundary-patterns.sh` | 0 | Exact baseline: warnOnInvalid 0; double cast 58; science fallback 10. |
| `VITE_SUPABASE_URL=http://localhost VITE_SUPABASE_ANON_KEY=dummy node node_modules/vitest/vitest.mjs run tests/meta/eval-briefs-absent-from-prompts.test.ts --maxWorkers=1` | 0 | 43/43; GIT_INDEX_FILE pointed to the writable index containing all new tracked sources. |

OpenAPI declarations were generated locally from the checked-in schema (all references local) and remain ignored/uncommitted. The ratchet baseline is unchanged. New test stores narrow unknown registration bodies before inspecting them.

W4: unswapped RED 4/6 (rows i and iii fail on legacy identity/acceptance); swapped GREEN 6/6. Full strict-schema and instruction hashes are computed from the live definitions in each test, not pinned copies.

Reader inventory: 365 existing/direct-import files plus the new records build-output diagnostic. All runs are single-file Vitest, --maxWorkers=1, with the prescribed localhost/dummy environment. Latest results: 358/366 PASS; eight files remain RED for DL decisions. The separate unchanged graph-register writer suite also passes.

RED files: build-model-capability.test.ts; c46-leader-withheld-on-a-product.test.ts; construction-goal-losses-are-said.test.ts; construction-range-carrier.test.ts; first-analysis-route.test.ts; graph-ready-frame.test.ts; rebuild-after-too-large.test.ts; records-build-output-parity.test.ts.

The new diagnostic keeps eleven missing legacy output requirements RED. The unfit-edge case binds source/target through typed quantity refs: the edge exists but is stored at mean 0.5, rather than legacy mean 1 with clamped_from/natural-effect audit. No output or refusal is fabricated to pass a test.

Configured ESLint passes source changes; the two new scripts are also explicitly forced-linted successfully. A copied J4 lib has 16 inherited errors under forced lint; it was not changed to suppress them. All four prepared external .mjs files pass syntax-only node --check. None was executed.

The signed-in J4 harness copies remain only at /private/tmp/mc-wire-out/journey5, outside the tracked prompt corpus. The tracked W6 checker and identity generator were included through the writable Git index in the 43/43 contamination test.

Full per-file reader results, rebindings, losses, RED/GREEN logs, gate logs and prepared witness instructions are in /private/tmp/mc-wire-out/REPORT.md and /private/tmp/mc-wire-out/evidence/. Real served/provider, S2, persistence RPC and browser reload evidence remain unrun.
