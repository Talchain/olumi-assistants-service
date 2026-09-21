# #1674 — exact-head CI and review state

**Not broadened. This is the closing record for the lane.**

## Head

```
3b9a0b9f2e8f4f73051b8585aec2f772ea34b05f
```
branch `feat/observed-state-must-not-destroy-the-model` → base `staging`
(`e717e19d05542a80254ea056aa95a59c2cde4053`)

## CI at that exact head

| check | state |
|---|---|
| **`Lint, TypeCheck, Unit Tests`** (required) | ✅ **completed success** |
| `Graph Evaluator (advisory)` | ❌ failure — **inherited** |
| everything else completed | success / skipped |

⚠ A duplicate instance of the required check was still `in_progress` when this
was written — CEE's `ci.yml` has no concurrency group, so `push` and
`pull_request` both fire. **One instance has completed success.**

**The advisory failure is inherited, with a contrast control:** `Graph
Evaluator (advisory)` fails on **5 of 5** recent `staging` commits, including
this PR's own base `e717e19d`. It is not required and not caused by this branch.

`mergeable = MERGEABLE`, `mergeStateStatus = BLOCKED`, `reviewDecision = ""`.
BLOCKED is the missing review, not a failing gate.

## What changed since the approval, and why

⛔ **The APPROVE (comment 5765757286) was against `ce28ab22` and is STALE.**

At `ce28ab22` the required check was **RED** — `2 failed | 2414 passed`, job
106468877344, completed 19:13:38Z. Both failures were mine; neither was flake:

1. `tests/witness/observed-state-witness.test.ts` wrote to the literal
   `/private/tmp/WITNESS.txt` — macOS-only, so **ENOENT on the Linux runner
   while all three behaviour assertions passed**. Now
   `RUNNER_TEMP ?? tmpdir()`, path reported not assumed, write wrapped.
2. `no-brief-derived-user-override.writers.test.ts` refused
   `observed-state-salvage.ts` as an unreviewed carrier of the `user_override`
   literal. **The guard was right.** Added as a READER entry.

### Controls, each discriminating

| mutation | result |
|---|---|
| remove ONLY the manifest key | `1 failed \| 3 passed` — exit 1 |
| restore an unwritable witness path | `1 failed \| 2 passed` — exit 1 |
| restored | `7 passed` (2 files) — exit 0 |

## Fresh verdict requested

Comment **5766648604** (2,455 bytes, length-verified) posted at the exact head,
naming `REVIEWED_HEAD: 3b9a0b9f…` in full and flagging the one call a reviewer
should challenge — that the module keeps a local `USER_AUTHORED_SOURCES` set
instead of delegating to `classifyValueSource`/`reflectsAHumanAct`, because
those classify `brief_extraction` as `user_stated` and delegating would both
adopt a forbidden reading and decline almost every salvage.

**Do not merge without that fresh verdict.** Never merge own work.

## Parallel-session branches, preserved

| branch | SHA | why keep |
|---|---|---|
| `feat/1674-behaviour-witness` | `35efdff30ab84dff60788be4d5981c610265ae86` | independent witness from the reviewing session |
| `rescue/f0eef277-declined-axis` | `f0eef27799347b35433d5c93e2685cd684813edd` | `declined_axis: "role"\|"shape"\|"kind"` — **better than the single flat decline reason now shipped**; worth folding in |

⚠ I force-pushed over both during the session; both were recovered and verified
at the remote.
