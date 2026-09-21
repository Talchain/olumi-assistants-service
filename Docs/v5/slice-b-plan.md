# Slice B — execution plan

**Branch:** `claude/v5-slice-b` off `staging` (created at `a08f651a`)
**Date:** 2026-04-18
**Risk tier:** C (new persistence layer, Supabase-dependent)

---

## Tranche boundaries

Slice B builds the runtime session-persistence layer every Slice-C+ handler depends on. Sequential deliverables per brief §2:

| D | Work | Gate |
|---|---|---|
| D1 | Precondition verification | tsc clean, validator exit 0, baseline green |
| D2 | Schemas audit (no bump by default) | Coverage confirmed; halt if bump needed |
| D3 | Session store implementation | Unit-testable, state-write invariant holds |
| D4 | TurnContext readRecent + commit RPC | Minimal edits to turn-executor/commit/build-turn-context |
| D5 | Unit tests (≥25 new; floor not ceiling) | All new tests green, A0/A1/A2 no regression |
| D6 | Integration tests (incl. D6 preflight) | Real staging Supabase, concurrent-writes idempotency proven |
| D7 | State-write invariant script | Wired into `scripts/validate-prepush.sh` |
| D8 | Service-role grant validation test | Closes audit §4.4 Tranche-2 obligation |
| D9 | Evidence pack | Gates, DoD evidence, telemetry snapshot, deviations |
| D10 | Morning handoff doc + final commit | No pushes; all local |

Definition of done (brief §1): session state survives restart; invalidation fires on correct scope; write idempotency holds under retry.

---

## Deviations from brief (all approved 2026-04-18)

1. **Module layout** — collapse `session-cache/` into `session/`. Brief puts cache in sibling folder; invalidation types are consumed only by the cache, one folder keeps import graph local.
2. **Facts read pattern — lazy, not eager.** Brief says `readRecent` joins `v5_handler_facts`; we expose `readFactsFor(turn_ids, handler_id)` separately. Most turns have no facts; joining every read wastes I/O.
3. **Env reads call-time, not module-load.** Match `budgets.ts` pattern. Module-load breaks `vi.stubEnv` and couples import-graph init to env presence. Fail-fast on first call, not first import.

Per-deliverable refinements also baked in (Paul 2026-04-18):
- D3 cache: deep-freeze snapshots (recursive), not `Object.freeze` alone
- D3 session/index.ts: inline comment explaining call-time env rationale
- D5: `≥25 new` is floor, not ceiling
- D8: test docstring cites audit §4.4 explicitly

---

## Risk register

| Risk | Mitigation |
|---|---|
| Precondition failure at D1 | Brief §4 halt; captured as precondition-check doc |
| Supabase outage mid-turn | `session_read_degraded` telemetry with `severity: 'warning'` + counter; commit failure maps to `STATE_COMMIT_FAILED` wire code (already in `INTERNAL_TO_WIRE`) |
| Concurrent writes duplicate | RPC takes client-provided `turn_id`; `ON CONFLICT (scenario_id, turn_id) DO NOTHING` — D6 concurrent-writes test asserts identical `(scenario_id, turn_id)` → exactly one row |
| Cache-read during sibling commit stale | Commit ordering: RPC success → cache evict → return |
| LRU eviction mid-read | `readRecent` returns deep-frozen snapshots |
| Schema bump mid-slice | D2 halts for approval before any bump |
| BI-01 regression | Existing catch at [turn-executor.ts:223-232](../../src/orchestrator-v5/turn-executor.ts#L223-L232) already handles `STATE_COMMIT_FAILED` path; `response_emitted: true` hardcoded at [L244](../../src/orchestrator-v5/turn-executor.ts#L244) |
| Migration unapplied at D6 boundary | D6 preflight test (`slice-b-preflight.test.ts`) probes `to_regclass` + `pg_proc` — early abort with clear message before other integration tests try |

---

## Safety rails (brief §4 acknowledgement)

**Halt conditions:** precondition failure, schema bump required, A0/A1/A2 regression, unexpected RPC error shape, data-state mismatch, self-review blocker, invariant violation, test count regression, BI-01 edge case, cross-service computation.

**No-go actions:** unauthorised push, editing A0/A1/A2 files outside declared integration points, V4 edits, prompt changes, schema major bump, BC wire semantics changes, skipped tests, `@ts-ignore`, UI repo touches, migration-file edits, destructive SQL, `v5_*` schema changes, new Supabase tables, service_role key rotation, handler implementations, coaching state.

**Push discipline:** no pushes overnight. Morning handoff commit last, local. Paul decides push order after review.

**Rollback triggers:** test count drops below baseline, BI-01–BI-08 violation, commit stage breaks A0/A1/A2, silent-success on permission-denied. On rollback: tag `recovery/slice-b-<ISO>` before any destructive reset.

---

## Critical files

**New:**
- `src/orchestrator-v5/session/{store,supabase-store,cache,invalidation,index}.ts`
- `src/orchestrator-v5/session/__tests__/{store,supabase-store,cache,invalidation}.test.ts`
- `tests/integration/slice-b-{preflight,persistence,invalidation,commit-failure,concurrent-writes,rpc-grant}.test.ts`
- `scripts/validate-state-write-invariant.sh`
- `Docs/v5/slice-b-{plan,precondition-check,schemas-audit,evidence-pack}.md`
- `Docs/v5/overnight-chat-2-summary.md`

**Modified (surgical):**
- [src/orchestrator-v5/commit.ts](../../src/orchestrator-v5/commit.ts) — no-op → RPC call
- [src/orchestrator-v5/build-turn-context.ts](../../src/orchestrator-v5/build-turn-context.ts) — add readRecent
- [src/orchestrator-v5/turn-executor.ts:217](../../src/orchestrator-v5/turn-executor.ts#L217) — commitDirectAnswer → async (minimal diff)
- [scripts/validate-prepush.sh](../../scripts/validate-prepush.sh) — wire new invariant check

**Untouched (scope guard):** migration file, `src/orchestrator-v5/types.ts` (STATE_COMMIT_FAILED already present), V4 code, LLM prompts, UI repo.

---

## Execution flow

1. ✓ Brief + governing docs read. Plan written (this file). Precondition evidence captured.
2. D1 commit, then sequential D2→D10. Per-deliverable: both self-review rounds before advancing.
3. Morning handoff commit last. Push recommendation surfaced; no pushes overnight.
