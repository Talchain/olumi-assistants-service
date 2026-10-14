S5 slice 1 — goal-record census CI ratchet

Built locally on `dl/s5-goal-record-census-ratchet`, HEAD asserted as `8cb73b9e603a5ca389cbb1733cb3c4f42daacc4b` before baseline generation. The census was generated with `node scripts/ci/goal-record-census.mjs --write` while production source still matched this tip. No commit, push, or LLM call. Existing B2 evidence logs were left untouched.

The fixed token list comes from `src/schemas/cee-v3.ts`: 19 NodeV3 goal fields, including `quantity_frame`, plus graph-level `goal_constraints` and `goal_node_id`, and the 13 requested reader function identifiers. This is a mechanical, conservative exact-token/file census, using `\bTOKEN\b` over source text; comments and string literals also count. It does not classify writers/readers, trace aliases, or infer semantic ownership. Each file counts once per token, regardless of occurrences.

The walker reads source code extensions `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, and `.cjs` under `src/`, excludes directories named `__tests__`, `fixtures`, and `prompts`, and excludes `.test.*` files. Paths and token keys are sorted. The JSON baseline records the source SHA, file sets, per-field counts, total, and absent-token control.

**Acceptance rows**

| Row | Result | Evidence |
| --- | --- | --- |
| GREEN at tip | Required: 1 file, 3 tests passed | [green-tip.log](green-tip.log) |
| Mutant A | RED, exit 1: `new goal reference: goal_threshold_raw in src/version.ts` after appending `const x = node.goal_threshold_raw;` | [mutant-a.log](mutant-a.log) |
| Mutant B | RED, exit 1: `stale entry: goal_threshold_raw in src/cee/unified-pipeline/stages/threshold-sweep.contract.ts` after replacing all exact references in that file | [mutant-b.log](mutant-b.log) |
| Mutant C | RED, exit 1: removed both regex word boundaries; the contrast control rejected `goal_threshold_raw_extended` | [mutant-c.log](mutant-c.log) |
| Restored GREEN | All mutants restored byte-for-byte in `finally`; Required: 1 file, 3 tests passed | [green-restored.log](green-restored.log) |
| Required collection | `vitest list` using `vitest.required.config.ts` lists all three tests through its existing default include and exclusions | [required-list.log](required-list.log) |
| Pre-push check | Bare Node `--check`, exit 0; wired to `check_goal_record_census` in `scripts/validate-prepush.sh` | [prepush-census.log](prepush-census.log) |
| ESLint new implementation | Exit 0 for census `.mjs`, declaration `.d.mts`, and guard test | [eslint-new.log](eslint-new.log) |
| Full tsc | Exit 2, 284 diagnostics elsewhere, **0 in changed files** | [static-summary.json](static-summary.json) |

The Required config already collects `tests/contract/*.test.ts`, so no include override or workflow change was needed. Its CI shards invoke `pnpm test:required` in `.github/workflows/ci.yml`. The pre-push checker follows the existing exact-baseline guards: both new references and stale entries fail. The guard also rejects mismatched baseline keys/counts, empty populations, and malformed SHA metadata.

Non-vacuity: **703 field/file references > 0**. Positive control: `goal_threshold_raw` appears in **68 files >= 5**. Negative control: `goal_threshold_zzz_absent` appears in **0 files**. Synthetic prefix/suffix controls use the same production matcher: a truly absent token alone cannot detect removal of word boundaries, whereas substring near misses can and did detect mutant C.

**Census timing and counts**

Measured full CLI wall time: **1.394369292 s < 3 s**, including Node startup, filesystem walk/read, regex matching, and JSON emission. Measurement excluded the preceding load gate; typechecking was running during this timing. [census-timing.log](census-timing.log) contains the complete generated census. Its JSON was checked equal to the baseline except for baseline-only `source_sha` metadata.

| Field / reader identifier | Referencing files |
| --- | ---: |
| `extractPersistedGoalTarget` | 6 |
| `findSoleGoalNode` | 2 |
| `goalChanceTargetCause` | 3 |
| `goalDeadlineOf` | 12 |
| `goalKindOf` | 8 |
| `goalUnitOf` | 2 |
| `goal_constraints` | 112 |
| `goal_deadline_as_stated` | 3 |
| `goal_direction` | 26 |
| `goal_horizon` | 19 |
| `goal_horizon_months` | 12 |
| `goal_level_reading` | 7 |
| `goal_node_id` | 68 |
| `goal_period` | 2 |
| `goal_scope` | 13 |
| `goal_sense_reading` | 7 |
| `goal_stated_as` | 2 |
| `goal_threshold` | 73 |
| `goal_threshold_cap` | 41 |
| `goal_threshold_cap_provenance` | 17 |
| `goal_threshold_frame` | 46 |
| `goal_threshold_raw` | 68 |
| `goal_threshold_unit` | 64 |
| `pickGoalThresholdTrio` | 8 |
| `quantity_frame` | 5 |
| `readHeldGoalComparator` | 6 |
| `resolveGoalDirection` | 11 |
| `resolveGoalThresholdStrict` | 5 |
| `scoredGoalIdOf` | 3 |
| `soleGoalOf` | 5 |
| `statedGoalTargetOf` | 11 |
| `success_threshold` | 9 |
| `threshold_source` | 9 |
| `unit_reading` | 18 |
| **Total field/file references** | **703** |

**Execution controls**

Every test/list process had a fresh load gate, checked by exit code before launch: `Number.isFinite(os.loadavg()[0]) && os.loadavg()[0] < 25`. Each run selected exactly one test file and used `--maxWorkers=1 --no-file-parallelism --configLoader=runner`, with stdin closed through `/dev/null`. All commands, gates, process exits, and wall times are preserved in [checks.jsonl](checks.jsonl); the reusable wrapper is [run-check.py](run-check.py). Static processes also use the same gate. A refused gate prevents launch. The evidence-config lint attempt was refused at load 25.239 (no process launched), then passed after a fresh successful gate at 18.762: [eslint-evidence.log](eslint-evidence.log), [eslint-evidence-retry.log](eslint-evidence-retry.log).

The repo normally ignores `scripts/**` in ESLint. For this requested check, the temporary lint config removed only ignore entries and extended the existing TypeScript parser/rules to `.mts`, so the script and declaration were actually linted. The retained equivalent is [eslint.config.mjs](eslint.config.mjs).

Full TypeScript result: `NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/tsc --noEmit` completed in **165.900 s**, exit **2**, with **284 diagnostics in 99 other files and 0 diagnostics in changed files**. The wrapper set `NODE_OPTIONS` to the requested value for this process. This is not a claim that full typechecking is green or that the other diagnostics were introduced in this slice. [tsc-full.log](tsc-full.log) preserves all output; [static-summary.json](static-summary.json) records the changed-file comparison.

Regenerate a shrinking baseline with `node scripts/ci/goal-record-census.mjs --write`, then run the guard. A newly justified site also requires explicit review of the regenerated file sets; the script cannot judge that justification. No product source remains changed, nothing under `supabase/` was changed, and no tracked directory was removed.

## r1 (after Codex r1 FAIL @a42b8338: 4 × P2, 0 P0/P1)

- **Class change: occurrences, not presence.**
  - The baseline is now `references[token][file] = count`. 2,334 occurrences at src 8cb73b9e.
  - A second read in an already-listed file now fails.
- **Files come from `git ls-files src`.**
  - Gitignored `src/generated/*` is out, so `--check` is reproducible on a clean clone.
  - Tracked symlinks are read; a symlinked directory fails closed.
- **Any `*.test.*` basename is excluded.**
- **Mutant pair on committed state:**
  - A: a second `goal_threshold_raw` in goal-chance-licence.ts → RED (`--check` rc 1, guard 2 failed). Restored with `git checkout HEAD --`.
  - B: an untracked `src/generated/mutantB.ts` → GREEN (rc 0, 5/5).
- **Guard:** 5/5 under `vitest.required.config.ts` (1.39 s).

## r2: pre-push wiring removed (CI shard 1, guard-liveness @b413a905)

- `tests/meta/guard-liveness.test.ts` failed: the orphan set grew from 24 to 25.
- Cause: `scripts/ci/goal-record-census.mjs` was reachable only from the pre-push hook, and the liveness closure does not follow vitest imports.
- Fix: the hook call is removed. The ratchet is enforced solely by `tests/contract/goal-record-census.guard.test.ts` in Required, which is the one required check. No new acknowledgement entry.
