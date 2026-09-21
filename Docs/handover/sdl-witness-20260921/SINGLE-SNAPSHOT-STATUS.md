# Single-snapshot race: REPRODUCED and pushed; the fix is scoped but NOT landed

**Status: SINGLE-SNAPSHOT GUARANTEE = FAIL (reproduced), fix NOT applied.**
Branch `feat/single-snapshot-run-analysis`, remote head
`cbef5cf1880bb1a254df117d9ab6072f805e1cee` (verified at the remote, 40 chars),
based on staging `bd35cc9e1a838159ec3949a278a89820acb01151`.
⛔ Do not merge: the test is RED **by design** — it is the reproduction.

## What is now proven that was not before

The race was previously a code-read inference. It is now an executable failure:

| | value |
|---|---|
| freshness hash (read A) | `08efc1d87bd245cb` |
| fact hash (read B) | `038423e339e50c1a` |
| refusal raised | none |

Run: `pnpm vitest run src/orchestrator-v5/__tests__/run-analysis-single-snapshot.test.ts`
→ `Tests 1 failed | 1 passed (2)`, exit 1.

The **control passes**: an unchanging store returns the identical token from both
reads, and it also pins that the turn really does read the store twice. Without
that control a RED could have been the double or an unfair comparison between
the two hashing routes rather than the race itself. The graph is the real
14-node/25-edge capture `journey-witness-20260921-graph.json`, not a
self-authored fixture.

## Ownership — settled, not assumed

PR #1660 touches **neither** call site. Measured by the Core lane over #1660's
complete six-file list: files matching `build-turn-context|tools/registry` = 0,
with a positive control (`route-v2` = 1) proving the probe discriminates. #1659
is 0 on both as well. So the race is **unowned**, not scheduled elsewhere —
"BLOCKED on #1660" would have parked a real defect behind a PR that cannot close it.

## Why the fix is not in this commit

The guard has nowhere wired to read from yet. `ScenarioReader` is
`(scenarioId, signal?) => Promise<RunAnalysisScenarioSnapshot>`
(`tools/handlers/run-analysis.ts:279-282`) and the handler invokes it with only
the abort signal (`:399`). The handler invocation carries no turn graph or hash,
and production resolves `getDefaultRegistry()` — a process-memoised registry —
so there is no per-turn seam to bind the already-loaded graph into.

Landing an `expectedGraphHash` parameter now would therefore ship a guard with
no producer: it could never fire. That is a failure mode this estate has already
paid for twice, so it is deliberately not done.

## The fix, scoped

Thread the graph the turn already loaded into the reader, so the run-analysis
snapshot is the SAME persisted state the freshness verdict came from:

1. `loadScenarioSnapshotForRunAnalysis` takes the already-loaded graph (or an
   expected analysis-affecting hash) and refuses on divergence with a typed error.
2. The run_analysis dispatch sites inject a bound reader via the registry
   override that already exists (`createRegistry({ scenarioReader })` — the
   pattern is already used at `handlers/chip-click-dispatch.ts:1371`).

Either shape satisfies the committed test, which deliberately admits both and
fails only on the third outcome: proceeding silently against a graph the turn
never saw.

⚠ Step 2 touches `turn-executor.ts` dispatch sites. That is adjacent to the file
#1660 rewrites (`route-v2.ts`, 410 lines), so coordinate before editing rather
than racing it.

## Why it stopped here

The deliverable for tonight is the state-spine witness, and `turn-executor.ts`
is a hot contended file. Threading turn context through it under a deadline is
scope expansion, not the lane. The reproduction plus this scope note is the
honest handoff: the next session starts from a failing test, not from an argument.
