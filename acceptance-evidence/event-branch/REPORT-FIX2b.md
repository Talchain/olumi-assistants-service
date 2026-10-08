# FIX-2b — refused event-risk horizon telemetry (Science 393023)

Worktree: `/private/tmp/accel-er-event-cee`; branch: `dl/event-risk-olumi-occurrence`; unchanged HEAD: `5f54ca8740095fb744ab1f2717a886fc5e3f5c66`.

## Incremental change

Only three TypeScript files were edited for FIX-2b:

- `src/orchestrator-v5/agent-lane/olumi-event-risk-draft.ts`: `prepareDraftEventRisks` returns typed `horizonMismatches: { label: string; drafted_months: number; goal_months: number }[]`. Each entry is pushed directly beside the existing mismatch loss entry, inside its unchanged condition. No second predicate was added.
- `src/orchestrator-v5/agent-lane/admit-model.ts`: imports the existing telemetry `log` and emits one `log.info` call per returned mismatch immediately after preparation. The payload contains only `event`, `risk_node_id: slugId(label)`, `drafted_months` and `goal_months`; neither the raw label, basis text nor brief is logged. The message is exactly `event risk: drafted horizon differs from the goal horizon; likelihood not used`.
- `src/orchestrator-v5/agent-lane/__tests__/fix2-event-risk-horizon.test.ts`: spies on the real telemetry logger, restores it after each test, and adds exact payload/message/count assertions to the existing horizon rows.

The exact delta from the supplied working tree is [fix2b-incremental.patch](fix2b-incremental.patch).

## Required rows and mutant

| Row | Result |
| --- | --- |
| Goal 12 months, drafted 3 months | Exactly one call: `{ event: 'cee.event_risk.horizon_mismatch', risk_node_id: 'key_developer_departure', drafted_months: 3, goal_months: 12 }`, with the exact static message. Existing refusal/placeholder assertions still pass. |
| Goal 12 months, drafted 12 months | No logger call; existing occurrence remains admitted. |
| No goal horizon, drafted 6 months | No logger call; existing occurrence remains admitted. |
| Remove admission logging loop | RED: expected one logger call, received zero; 1 failed / 3 passed. Source restored byte-for-byte in `finally`. |

The initial test-only RED also failed solely on the missing logger call, with both no-log controls and the instruction control passing.

Every test invocation passed the one-minute load gate (`loadavg()[0] < 25`), used at most two files, one worker, `--no-file-parallelism`, `--configLoader=runner`, and stdin from `/dev/null`:

```sh
node -e "const load = require('os').loadavg()[0]; console.log('Load gate:', load, '< 25'); process.exit(load < 25 ? 0 : 1)" && node_modules/.bin/vitest run <one-or-two-files> --maxWorkers=1 --no-file-parallelism --configLoader=runner < /dev/null
```

| Evidence | Executed result |
| --- | --- |
| [fix2b-red.log](fix2b-red.log) | Horizon file: 1 expected failure / 3 passes before production changes. |
| [fix2b-green.log](fix2b-green.log) | Horizon + Olumi event admission: 48/48 pass. |
| [fix2b-mutant-no-log.log](fix2b-mutant-no-log.log) | No-log mutant killed by the logger-count assertion; 1 failure / 3 passes. |
| [fix2b-restored-green.log](fix2b-restored-green.log) | Restored horizon + whole-candidate admission: 18/18 pass. |

Mutation/restoration metadata: [fix2b-mutant-summary.json](fix2b-mutant-summary.json).

## Full TypeScript and ESLint

The required full command ran without narrowing its scope:

```sh
NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/tsc --noEmit
```

**Zero errors in the three incremental files and all 20 currently changed TypeScript files.** Full command exits 2 with 290 diagnostics in unchanged files. Those diagnostic lines exactly match the existing FIX-2 TypeScript evidence; this is not a repository-wide clean TypeScript result. See [fix2b-tsc-full.log](fix2b-tsc-full.log) and [fix2b-tsc-summary.json](fix2b-tsc-summary.json).

ESLint ran on all 20 changed TypeScript files, including the pre-existing FIX-2 changes: **exit 0, no errors or warnings**. See [fix2b-eslint.log](fix2b-eslint.log), [fix2b-eslint-summary.json](fix2b-eslint-summary.json), and [fix2b-changed-files.json](fix2b-changed-files.json).

## Preservation

All 93 pre-existing files outside the three incremental files remain byte-identical to the starting snapshot. The prior edits within those three files remain intact apart from the additions shown in the incremental patch. `turn-executor.ts` and both controlled-factor-authority guard/scan files are unchanged; the request-parser strip design is preserved. No changes under `supabase/`, no commit, push or staging, and no HEAD/branch/index change. `git diff --check` passes.

Checks and final source hashes: [fix2b-preservation-summary.json](fix2b-preservation-summary.json). This report and the `fix2b-*` evidence files are the only additional artifacts. Evidence is local source/tests, without a deployment or live-runtime claim.
