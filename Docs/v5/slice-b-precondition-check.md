# Slice B — Deliverable 1 precondition check

**Date:** 2026-04-18
**Branch:** `claude/v5-slice-b` (off `staging`)
**Branch-base commit:** `a08f651a` — `docs(v5): evidence pack §3.1 — surface SQL review's 3 non-blocking observations`

---

## Preamble

| Step | Command | Result |
|---|---|---|
| 1 | `git branch --show-current` | `claude/v5-slice-b` |
| 2 | `git log --oneline -5` | Phase 0 commits confirmed (`a08f651a`, `708fb058`, `21f50dad`, `2eb83214`, `c763c070`) |
| 3 | `git status --short` | 13 pre-existing modifications (node_modules bins + `Docs/CLAUDE.md` + `data/prompts.json` + `src/adapters/llm/normalisation.ts`), ~140 untracked docs/tools. None in Slice B scope. |

---

## Precondition 1 — migration applied to staging Supabase

Applied via Supabase MCP (Paul, 2026-04-18):
- `v5_conversation_turns` — 11 cols, RLS on, UNIQUE + 2 CHECKs, 2 indexes
- `v5_handler_facts` — 10 cols, RLS on, 2 indexes
- `append_turn_atomic` RPC — present, explicit `GRANT EXECUTE … TO service_role`

**Throwaway scenario:** `TEST_SCENARIO_ID=f5a9fa2b-3aae-4562-96e9-7589a4ae85a5` (staging `public.scenarios`).

---

## Precondition 2 — post-apply validator exit 0

```
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
TEST_SCENARIO_ID=f5a9fa2b-3aae-4562-96e9-7589a4ae85a5 \
pnpm exec tsx scripts/phase-0-post-apply-validate.ts --strict --json
```

**Exit code: 0.** JSON captured at `/tmp/pre-slice-b-validation.json` (9/9 required checks PASS, 3 NOT-VERIFIED items are supplementary dashboard-only queries — not gate-blocking).

| Check | Status |
|---|---|
| `preflight-scenario-exists` | PASS |
| `columns-v5_conversation_turns` | PASS (all 11 columns present) |
| `columns-v5_handler_facts` | PASS (all 10 columns present) |
| `rpc-callable` | PASS (service_role has EXECUTE; body raises expected "scenario not found") |
| `unique-constraint-idempotency` | PASS (second call returned same turn_id — `ON CONFLICT (scenario_id, turn_id)` works) |
| `check-biconditional` | PASS (`turn_class='handler' ⇔ handler_id IS NOT NULL` fires) |
| `check-turn_class` | PASS (`turn_class IN (...)` fires) |
| `fk-v5_handler_facts.v5_conversation_turn_id` | PASS (FK violation 23503) |
| `rls-v5_conversation_turns` | PASS (anon read returns 0 rows) |
| `rls-v5_handler_facts` | PASS (anon read returns 0 rows) |

NOT-VERIFIED items (supplementary): `index-presence`, `named-constraints`, `function-acl` — PostgREST doesn't expose `pg_catalog`. Operator SQL snippets provided; Tranche 2 evidence pack records the output.

---

## Precondition 3 — baseline typecheck + test suite

| Gate | Command | Result |
|---|---|---|
| Typecheck (build) | `pnpm exec tsc -p tsconfig.build.json --noEmit` | **clean** (exit 0) |
| Scoped vitest baseline | `pnpm exec vitest run src/orchestrator-v5 tests/regression tests/integration/orchestrate-v2-{a0,a1,a2} tests/integration/server-boot tests/unit/prompts.defaults.test.ts` | **178/178 pass across 16 files** (higher than Phase 0 pack's 152/152 — 26 additional tests landed since) |

Test file raw output captured at `/tmp/pre-slice-b-tests.txt`.

---

## Verdict

All D1 gates green. Preconditions satisfied. Dispatching to D2 (schemas audit).

**Decisive outcome: proceed.**
