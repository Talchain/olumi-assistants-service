**FIX-1 for #2879 — P2: empty licences still generate `reason_not_recorded`**

Date: 8 October 2026. Worktree: `/private/tmp/accel-er-b2scope-cee`. Branch: `dl/b2-zero-spread-when-none-licensed`. HEAD was asserted before editing and remains `5e5dd51b27368926382ba982454dc8b2fb6dfb0e` (buddy r1 base).

`goalChanceWithheldReasonsForAgent` now gates the fallback marker on a non-empty `pct_by_option` in the parser-accepted licence record. Its named zero-spread reason still takes precedence, and scoped warnings retain their recorded wording. An empty licence provides no generic withholding attestation for another option.

Only two TypeScript files changed: `src/orchestrator-v5/goal-target/goal-chance-range-agent.ts` and `src/routes/__tests__/b2-zero-spread.test.ts`. The malformed-reason table now requires exactly `[]` for empty licences. Its conflicting-percentage case explicitly retains the existing marker because that mutated licence contains a percentage.

| Required row | Input and result | Evidence |
| --- | --- | --- |
| Reviewer's exact row | B2 graph; only Starter and Keep in the producer envelope; Keep's unearned `p=0`, zero spread at £120,000; Starter's unearned `p=1`, nonzero spread; warnings cleared, including the fixture's Starter range. Producer has `pct_by_option: {}`, `message: ''`, both IDs withheld, and Keep's named reason. Starter reader returns `[]`, canonical cell is exactly `{ kind: 'none' }`. Keep reader returns `[{ code: 'zero_spread', message: 'Not shown yet: needs month-by-month changes' }]`; its canonical reason and face retain that line. | [Restored B2 suite](fix1-green-restored-b2-canonical.log) |
| Licensed-point control | Same envelope, with Starter changed to `p=0.97` and Keep changed to nonzero spread while retaining unearned `p=0`; no warning. Producer licenses `{ launch_starter_tier: 97 }` and withholds Keep without a named reason. Keep still returns `[{ code: 'reason_not_recorded', message: null }]` and has a `withheld` canonical cell. | Same log; existing canonical `DATA-REASON-ABSENT` control also passes |
| Staging control | Existing Starter-point fixture still verifies byte-identical producer, transport, Agent facts and screen lines against captured staging, with the prior intended Keep reason/face change. | Same log |
| Malformed reasons | Every empty-licence malformed case now requires `[]`; none can pass with `reason_not_recorded`. The nonempty conflicting-percentage case rejects the named zero-spread reason and preserves its old fallback marker. | Same log |
| Remove the point gate | **RED as required**: removing only `hasLicensedPoint &&` makes the reviewer's Starter assertion receive `reason_not_recorded` instead of `[]`. Load gate exit **0**, test exit **1**, one failing reviewer row. | [Mutant log](fix1-mutant-no-point-gate.log) |
| Restore source | Restored source bytes match the original SHA-256 `3a79d0279a5761eac4462bbaeb3fbdcfdd27eacfbd1f533a768b2311da125484`; the complete B2 suite passes after restoration. | [Restoration record](fix1-mutant-restoration.json), restored B2 log |

All processes ran sequentially after a fresh Node load gate: `Number.isFinite(os.loadavg()[0]) && os.loadavg()[0] < 25`. The wrapper checks the gate's **exit code** before launching a process; a nonzero gate prevents launch. Every process receives closed stdin through `/dev/null`. Test batches contain at most two explicitly named files and use `--maxWorkers=1 --no-file-parallelism --configLoader=runner`. Exact commands and gate/process exit codes are retained in [fix1-checks.jsonl](fix1-checks.jsonl).

| Validation | Result | Load / gate exit / process exit |
| --- | --- | --- |
| Initial `b2-zero-spread.test.ts` | 17 passed | 3.69873046875 / 0 / 0 |
| Reviewer row with gate removed | 1 failed as required; 16 skipped | 3.86767578125 / 0 / 1 |
| Restored `b2-zero-spread.test.ts` + `canonical-analysis-view.test.ts` | 26 passed | 3.36669921875 / 0 / 0 |
| `agent-goal-chance-licence.test.ts` + `goal-chance-screen-lines.test.ts` | 90 passed | 3.8818359375 / 0 / 0 |
| `goal-chance-sides.test.ts` | 36 passed | 4.44140625 / 0 / 0 |
| ESLint on the two changed TypeScript files | Clean; no diagnostics | 4.8291015625 / 0 / 0 |
| Full `NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/tsc --noEmit < /dev/null` | 290 diagnostics; **0 in either changed file** | 5.30810546875 / 0 / 2 |

The final green suites cover **152 distinct tests across five files**, plus the initial successful B2 run. Agent licence, screen-line and goal-chance-side suites exercise the existing `goal-chance-range-agent` consumers. Logs: [Agent/screen](fix1-green-agent-screen.log), [sides](fix1-green-sides.log), [ESLint](fix1-eslint-changed.log), [full TypeScript diagnostics](fix1-tsc-full.log). Full-repository typechecking remains unsuccessful; no global typecheck pass is claimed.

Independent read-only patch review found no findings. Final `git diff --check` passes. HEAD and branch remain pinned as above; changes consist only of the two TypeScript files and FIX-1 evidence in this directory. Nothing under `supabase/` changed. No commit, push or deployment was performed.
