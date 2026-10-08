# FIX2 E/F evidence fragment

HEAD was asserted as `5f54ca8740095fb744ab1f2717a886fc5e3f5c66` before work. E/F regression rows were run before editing any E/F production source. No commits, pushes, `supabase/` edits or tracked-directory deletions.

## Class fixes

- **E:** `goalChanceEstimateLikelihoods` requires the existing `readOlumiEventRiskBasisText` reader to return a nonblank warrant. An unwarranted occurrence cannot create a likelihood count, licensed likelihood attribution, or Check estimates likelihood item. `eventRiskCardLine` independently renders a placeholder without the occurrence figure or Olumi attribution when the warrant is missing/blank.
- **F:** Added optional `goalPathEventRootIds` to the existing guidance signal input. The existing reverse BFS, bounded simple-path DFS, sizing reader and RC4 census remain the calculation machinery. The path root set now also includes roots returned by the warranted occurrence reader. A common event impact affects every retained option; downstream links shared with lever paths remain deduplicated by the existing link ID census. Both chance attribution and Check estimates provide the same counted roots. No census rewrite was needed.

## Changed source/test files

- `src/orchestrator-v5/agent-lane/goal-chance-estimate-attribution.ts`
- `src/orchestrator-v5/agent-lane/stated-event-risk-draft.ts`
- `src/orchestrator-v5/agent-lane/turn-context/guidance-signals.ts`
- `src/orchestrator-v5/agent-lane/actions/state.ts`
- `src/orchestrator-v5/agent-lane/__tests__/event-risk-fix2-attribution.test.ts`

## RED → GREEN rows

| Claim | RED on reviewed source | GREEN |
| --- | --- | --- |
| E r1 #7: root Olumi occurrence with missing basis | Count 1, expected 0 | Count 0; no likelihood words, licensed likelihood count or Check estimates likelihood |
| E blank/whitespace warrant variants | Count 1, expected 0 | Same no-count/no-attribution behavior |
| E direct basis-less card | `May happen: about 5–18% within 12 months (Olumi's estimate).` | `May happen; its likelihood still needs a basis.` |
| F r1 #6: price → MRR and independent developer departure → MRR both Olumi-sized; developer occurrence warranted | Relationship count 1, expected 2 | Chance line says `on Olumi's estimates (2 relationships, 1 likelihood)` |
| F Check estimates, same graph | Only `price->goal` listed | Both `price->goal` and `dev->goal`; reply lists `Key developer departure → MRR (link size)` and 2 link sizes plus 1 likelihood |
| F shared downstream path | Event root impact omitted | Event impact included; shared downstream relationship counted once |

Readable-basis positive control and basis-less/excluded/off-goal negative controls also pass. The one-file RED run had 9 failed/2 passed; GREEN and post-mutant restored runs each had 11 passed.

## Mutants

All five were killed by assertion failures (exit 1), each source restored byte-for-byte in `finally` before the next run. Script: `fix2-ef-mutants.py`; machine-readable results: `fix2-ef-mutants.json`.

| Mutant | Witness |
| --- | --- |
| E-reader-warrant-off | Missing/blank warrant count becomes 1 |
| E-card-warrant-off | Basis-less card emits `Olumi's estimate` |
| F-attribution-event-roots-off | r1 #6 relationship count becomes 1 |
| F-check-estimates-event-roots-off | Independent event impact disappears from Check estimates |
| F-shared-path-event-roots-off | r1 #6 relationship count becomes 1 |

## Runs

Every run loaded `node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)"` before Vitest, used `--maxWorkers=1 --configLoader=runner`, redirected stdin from `/dev/null`, and contained no more than two test files. Test execution was serialized with the root agent.

- `fix2-ef-red.log`: 9 failed, 2 passed (expected RED).
- `fix2-ef-green.log`: 11 passed.
- Five `fix2-ef-mutant-*.log`: each killed its changed claim.
- `fix2-ef-restored.log`: 11 passed after all mutants restored.
- `fix2-ef-neighbours.log`: `event-branch-copy-count.test.ts` + `rc4-check-estimates-wiring.spec.ts`, 34 passed.
- `git diff --check`: clean.

Full `tsc --noEmit` and all-changed-file eslint belong to the root's final combined verification; this fragment does not claim those results.
