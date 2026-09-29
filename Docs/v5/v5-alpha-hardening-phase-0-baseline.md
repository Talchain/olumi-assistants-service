# V5 Alpha Hardening — Phase 0 Baseline

**Date:** 2026-04-24
**Author:** Claude (Opus 4.7, 1M context)
**Branch:** `claude/v5-alpha-hardening`
**Cut from:** `staging` @ `cf1b74f1264a1785d3c1bfb88117234477434b47`

---

## Purpose

Phase 0 establishes the baseline state against which every subsequent phase is measured. It is a read-only snapshot plus one baseline doc (this file). No source code changes.

## Branch

```
$ git rev-parse --abbrev-ref HEAD
claude/v5-alpha-hardening

$ git rev-parse HEAD
cf1b74f1264a1785d3c1bfb88117234477434b47

$ git log --oneline -5
cf1b74f1 fix(v5): correct coaching-cache walk direction after facts-ordering change
7f4b70bb fix(v5): address second external review — fact-lookup bug + coverage
0a140eb9 fix(v5): address external review findings on context + compose layer
6b4cbd62 docs(v5): context + compose layer completion — evidence pack
25ca1d64 test(v5): update B1 fixture to expect run_analysis chip on analyse stage
```

## Test baseline

Full `pnpm test` run on the fresh branch:

```
 Test Files  694 passed | 32 skipped (726)
      Tests  12307 passed | 228 skipped | 1 todo (12536)
   Duration  34.06s
```

**Failing: 0.** Gate for every subsequent phase: **pass count ≥ 12307, fail count = 0**. Skip count may decrease (not increase) if we un-skip tests as part of the work; any new skip requires justification in the phase-gate report.

The 32 skipped files are almost entirely live-integration tests that require external services (Redis, live PLoT, live Supabase) and are not part of the unit-level baseline. No known flakes referenced in CLAUDE.md.

## Prompt file (v38.2) — path and casing

**Critical:** the working filesystem is case-insensitive (macOS default), but Render runs Linux (case-sensitive). Hard-coding the wrong casing in the loader would compile locally and 500 at module init on deploy.

| Property | Value |
|---|---|
| Path on disk | `Prompts/v38.2.txt` (capital P) |
| Size | 19,314 bytes |
| SHA-256 | `2e25001a025e288c8b1b4b9d88a715d77513394947ea9214f5152a7c7498a08f` |
| Short hash (16-hex prefix for logs) | `2e25001a025e288c` |
| First line | `<ROLE>` |
| Shape | Full Olumi persona prompt (541 lines, ~19.3k chars) |

The 2.1 loader MUST use the exact `Prompts/` casing in its path resolver. A test in 2.1 will assert load succeeds from the compiled `dist/` layout, not only under `tsx`.

No `prompts/` (lowercase) directory exists. Find confirms `./Prompts/v38.2.txt` is the only match for `v38.2.txt` in the repo.

## Current ROUTING_SYSTEM_PROMPT (pre-hardening)

Hardcoded constant in [src/orchestrator-v5/routing/route-with-tool-use.ts](../../src/orchestrator-v5/routing/route-with-tool-use.ts#L150-L162). 662 characters. This is the 1000-ish `system_chars` figure the brief's symptom list calls out as "not installed". Phase 2.1 replaces it with file-loaded v38.2.

## Cross-workstream ownership — confirmed

The table from Paul's brief is consistent with the current code:

| Contract | CEE owns | UI owns | Confirmation |
|---|---|---|---|
| Suggested chip generation | yes | no | [src/orchestrator-v5/compose/chip-generator.ts](../../src/orchestrator-v5/compose/chip-generator.ts) |
| Executable chip `action_type` metadata | yes (sets) | consumes | [chip-generator.ts:189](../../src/orchestrator-v5/compose/chip-generator.ts#L189) |
| Final chip render/hide decision | no | yes | N/A (UI repo) |
| `analysis_ready` source of truth | yes | consumes | [src/orchestrator/tools/analysis-ready-helper.ts](../../src/orchestrator/tools/analysis-ready-helper.ts) `computeStructuralReadiness` |
| `analysis_status` display | no | yes | N/A (UI repo) |
| Analysis results persistence | yes | consumes | [src/orchestrator-v5/tools/handlers/run-analysis.ts](../../src/orchestrator-v5/tools/handlers/run-analysis.ts) + [src/orchestrator-v5/session/supabase-store.ts](../../src/orchestrator-v5/session/supabase-store.ts) `append_turn_atomic` |
| Orchestrator prompt v38.2 installation | yes | n/a | Phase 2.1 target |

**Flagged change from current state → hardening target:**
- The CEE-side chip gate today is `graphOptionCount > 0` ([chip-generator.ts:95](../../src/orchestrator-v5/compose/chip-generator.ts#L95)). Phase 2.4 replaces this with a full `analysis_ready.status === 'ready'` gate derived from `computeStructuralReadiness`. The chip payload SHAPE is unchanged (`SuggestedAction { id, label, message, action_type? }`) — UI consumers should see no breaking change; only the frequency of the executable variant drops when readiness is not met.
- Documented assumption: UI continues to consume the final chip list verbatim and does not re-derive chip visibility from response state. If UI hardening changes that assumption, cross-check needed before 2.4 commits.

## Assumptions corrected from the initial inventory

Items that surfaced during exploration and are now locked in:

1. **Prompt casing**: `Prompts/` (capital P), not `prompts/`. The brief's lowercase reference was prose; the loader uses the on-disk casing. Confirmed above.
2. **All 7 validator codes recoverable** (Paul's decision): `HANDLER_NOT_FOUND`, `ENTITY_KIND_MISMATCH`, `PRECONDITION_UNMET`, `ENTITY_NOT_FOUND`, `ENTITY_RESOLUTION_AMBIGUOUS`, `ENTITY_RESOLUTION_SUSPICIOUS`, `PARAMETER_INVALID`. Phase 2.2 implements the generalised pattern. The existing `composeValidationFailure` + 500 path stays as an impossible-state safety net (correction 8), not a default.
3. **`v5_journey_id` = `payload.scenario_id`** (Paul's decision). No new UUID generation. One scenario = one journey id.
4. **`buildAnalysisFromPriorFacts`** is already present at [src/orchestrator-v5/context/analysis-fallback.ts](../../src/orchestrator-v5/context/analysis-fallback.ts). The "analysis: null on follow-up turn" symptom is therefore a call-site wiring issue, not a missing helper. Root-cause in the call site during Phase 3 replay step 5.
5. **Observability fields** are scoped to primary lifecycle events only (correction 12): `turn_executor.started`, `context_pack.assembled`, `v5.routing.calling_anthropic`, `validator_outcome`, `recovery_response`, `handler_invocation`, `turn_executor.completed`. Lower-level debug/warn logs get only `request_id` + `v5_journey_id` added.
6. **PLoT response fixture**: Phase 1's Part C matrix references a real captured staging response rather than inferring shape from code alone (correction 3). A real capture will be filed at `Docs/v5/fixtures/plot-response-computed-staging-YYYY-MM-DD.json` before the matrix is treated as authoritative; if no capture is available when Phase 1 starts, flag and pause.
7. **Handler fact schema is frozen for partial status** (correction 4): no new field added to `RunAnalysisHandlerFactSchema` for partial-caveat. Caveat surfaces through existing `summary` and `assistant_text`.
8. **Log capture is stdout-only** (correction 15): the Phase 3 replay harness captures stdout of the local server process. No new log-exposure API surface.

## Phase gate

**Phase 0 exits when:** this doc is committed, baseline test counts are recorded, and Phase 1 can start with a clean reference. No further Phase 0 work is required.

**Next:** Phase 1 — write `Docs/v5/v5-resilience-contract.md` and capture a real staging PLoT response for the Part C fixture.

---

_Authored during Claude Code session 2026-04-24. No push executed._
