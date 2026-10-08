## Class D — goal horizon

Reviewed source assertion: `HEAD=5f54ca8740095fb744ab1f2717a886fc5e3f5c66`; branch `dl/event-risk-olumi-occurrence`. Production was unchanged when the D RED rows ran.

| Row | Input | RED on reviewed source | GREEN |
| --- | --- | --- | --- |
| D1 / r1 #5 | Goal: Revenue within 12 months; drafted developer departure occurrence: 10% over 3 months, with readable basis | FAIL: admitted an Olumi occurrence with horizon 3 months | PASS: no occurrence or basis sidecar; a warning identifies drafted 3 months versus goal 12 months |
| D2 control | Goal within 12 months; drafted occurrence over 12 months | PASS: admitted the unchanged odds-width occurrence and its basis | PASS: estimate and 12-month horizon admitted without rescaling |
| D3 control | Goal states no horizon; drafted occurrence over 6 months | PASS: admitted the drafted six-month period and its basis | PASS: drafted six-month period and basis admitted |
| D4 instruction | Drafting instruction may use another period only if the goal states no horizon | FAIL: old unrestricted `or the period you mean` phrase | PASS: conditional no-goal-horizon phrase appears and the old phrase is absent |

RED command (one file, one worker, stdin closed):

```sh
node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)" && node_modules/.bin/vitest run src/orchestrator-v5/agent-lane/__tests__/fix2-event-risk-horizon.test.ts --maxWorkers=1 --no-file-parallelism --configLoader=runner < /dev/null
```

Evidence: `fix2-d-red.log`: 2 failed / 2 passed. An initial CLI-only attempt rejected Vitest 4's unsupported `--minWorkers`; no tests ran then. That output is retained in `fix2-d-cli-error.log`, followed by the corrected gated command above.

Instruction edit: only the existing line's `over the goal's horizon in months (or the period you mean)` became `over the goal's horizon in months (if the goal states no horizon, the period you mean)`. The existing exact instruction contract expectation was updated to that phrase. All other instruction lines are unchanged.

Changed D files:

- `src/orchestrator-v5/agent-lane/runtime/build-model.ts` (the exact instruction replacement only; other classes may make separate non-instruction changes).
- `src/orchestrator-v5/agent-lane/__tests__/event-risk-drafter-contract.test.ts` (exact expected phrase only).
- `src/orchestrator-v5/agent-lane/__tests__/fix2-event-risk-horizon.test.ts` (four D rows).
- `src/orchestrator-v5/agent-lane/olumi-event-risk-draft.ts` (D admission change applied by root alongside A/B).

Admission uses the candidate goal's finite, positive `horizon_months` directly and rejects a differing Olumi period. It performs no horizon extraction or rescaling. The existing user likelihood path keeps its own period and precedence.

GREEN: `fix2-d-green.log` — 9/9 tests passed in the D file and existing drafter contract file (2 files). The latter checks the exact instruction immediately after the unchanged user-risk floor and occurrence schema compatibility.

| Mutant | Changed claim | Result | Evidence |
| --- | --- | --- | --- |
| `horizon-mismatch-admitted` | Remove the goal-horizon mismatch rejection | KILLED by D1: a three-month occurrence appears | `fix2-d-mutant-horizon-mismatch-admitted.log` |
| `horizon-mismatch-disclosure-off` | Omit the mismatch warning while withholding the occurrence | KILLED by D1: required risk-specific 3-to-12-month disclosure is absent | `fix2-d-mutant-horizon-mismatch-disclosure-off.log` |
| `unrestricted-drafter-period` | Restore the old instruction allowing any period | KILLED by D4: required conditional phrase is absent | `fix2-d-mutant-unrestricted-drafter-period.log` |

The disclosure mutant initially survived an overly broad test predicate: the generic goal horizon ledger referred to `GraphV3`, satisfying a loose `12.*3` pattern. That result is retained in `fix2-d-mutant-horizon-mismatch-disclosure-off-weak-oracle.log`. The oracle now requires the risk's exact `event_risk` ledger field, `before: 3`, `after: null`, and the warning naming both the drafted three-month period and goal's twelve-month horizon. GREEN was rerun, then the same mutant was killed.

Every mutant invocation ran one test file with the load gate, one worker, `--configLoader=runner` and stdin closed. Both changed source files were restored byte-for-byte in `finally`; restoration SHA256 values were `dd5d480194be2ef1f09df1faf95cce9cb48eddab5af504338a9f6c56a4e2bf23` for `olumi-event-risk-draft.ts` and `ca59e6b648f66dcd35b6daf8874f1c315e9e35afa3b4bba4e78f9f59621ca432` for `runtime/build-model.ts` at this D checkpoint.

Final restored/neighbour check: `fix2-d-restored-neighbours.log` — 48/48 tests passed in the D file plus existing Olumi admission file (2 files), including the existing user six-month horizon precedence row.

Full tsc and eslint results belong to the joined final report.
