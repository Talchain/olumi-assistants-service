# V5 Step 4 — chip_click run_analysis commit-failure trace

**Branch:** `claude/v5-step4-investigation`
**HEAD:** `4d7e6c3f`
**Failure signature:** HTTP 500, `error=INTERNAL_ERROR`, `boundary=B1`, `validator=turn_commit`, `reason=chip_click_run_analysis_commit_failed`
**Reproduction:** confirmed twice at `4d7e6c3f` against `https://cee-staging.onrender.com`
- Run 1 request_id: `b92ac362-f20a-4c10-a8e8-4d4112610a1c` (with `OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true`)
- Run 2 request_id: `99a83f32-64b4-4d56-a241-8456c77c5b89` (Phase 1.6, default-mode gate)
- Original (pre-fix) request_id from `Docs/v5/v5-golden-path-evidence-cee.md`: `40e87d14-155d-4f51-bfd3-5b69db3f4915` (at `66d1adb`)

## 1. Call chain (data shape per boundary)

```
HTTP POST /orchestrate/v2/turn (chip_click + run_analysis)
  │
  ├── src/orchestrator/route-v2.ts:175 ceeOrchestratorRouteV2
  │     │
  │     ├── L183  runPreFlight(req)  → src/orchestrator/route-v2-preflight.ts:67
  │     │           ├── parseRequestExtensions  → extracts {graph_state, analysis_state, user_id}
  │     │           ├── validateIngress         → MessageTurnPayload (kind='message')
  │     │           └── preflightEnsureScenario → src/orchestrator-v5/build-turn-context.ts:221
  │     │                 └── store.ensureScenarioExists(scenarioId, userId=null)
  │     │                       └── client.rpc('ensure_scenario_exists', {p_scenario_id, p_user_id:null})
  │     │                       (returns: {user_id: null} for guest scenarios — fail-open on RPC error)
  │     │
  │     └── L258  if (isChipClickRunAnalysis):
  │           │
  │           └── L260  dispatchChipClickRunAnalysis({payload, requestId})
  │                       → src/orchestrator-v5/handlers/chip-click-dispatch.ts:94
  │                 │
  │                 ├── L102  buildTurnContext(payload, requestId)
  │                 │
  │                 ├── L105  resolveHandler(registry, 'run_analysis')
  │                 │           (handler defined in src/orchestrator-v5/tools/handlers/run-analysis.ts;
  │                 │            registered at module load by getDefaultRegistry())
  │                 │
  │                 ├── L142  handlerFn({context, payload, requestId, signal})
  │                 │           → returns { handler_facts: [RunAnalysisHandlerFact], llm_calls_used, ... }
  │                 │           Schema: HandlerFactSchema discriminated union on fact_type='run_analysis'
  │                 │           (see vendor/package/dist/orchestrator/handler-fact.d.ts:48)
  │                 │
  │                 ├── L191  enrichRunAnalysisWithDecisionReview({handlerFacts, ...})
  │                 │           → may add decision-review enrichment to fact.result.enrichment
  │                 │           → returns enrichedFacts (still array of HandlerFact, length ≥ 1)
  │                 │
  │                 ├── L206  composeToolCallResponse({orientation:'', confirmation, coaching:null,
  │                 │                                   stage, handlerFacts: enrichedFacts})
  │                 │           → response: OlumiResponse
  │                 │
  │                 └── L215  commitDirectAnswer(response, metadata)
  │                             → src/orchestrator-v5/commit.ts:77
  │                       │
  │                       └── L99  store.append({
  │                                  scenario_id: payload.scenario_id,    -- UUID
  │                                  turn_id:     payload.turn_id,        -- TEXT (client UUID)
  │                                  turn_class:  'handler',              -- ConversationTurnClass enum
  │                                  handler_id:  'run_analysis',         -- V5ActionType
  │                                  request_hash:'sha256:…' (computed),
  │                                  response_emitted: true (HARDCODED),
  │                                  llm_calls_used: outcome.llm_calls_used,
  │                                  duration_ms: now - startedAt,
  │                                  handler_facts: enrichedFacts,        -- length ≥ 1 for run_analysis
  │                                  graph: undefined                     -- chip-click never sets graph
  │                                })
  │                             → src/orchestrator-v5/session/supabase-store.ts:73 SupabaseSessionStore.append
  │                       │
  │                       └── L74  client.rpc('append_turn_atomic', {
  │                                   p_scenario_id, p_turn_id, p_turn_class, p_handler_id,
  │                                   p_request_hash, p_response_emitted, p_llm_calls_used,
  │                                   p_duration_ms, p_handler_facts: serialiseHandlerFacts(...)
  │                                   -- p_graph omitted because write.graph === undefined
  │                                })
  │                             ↓
  │                       Supabase append_turn_atomic RPC
  │                       (current migration: 20260422210000)
  │                             ↓
  │                       Returns { data?: row UUID, error?: { code, message, details, hint } }
  │
  ├── catch (err) at chip-click-dispatch.ts:226
  │     → log.error 'V5 chip_click run_analysis dispatch — commit failed'
  │     → returns { outcome: 'commit_failed', response, commitPerformed: false }
  │
  └── route-v2.ts:288–297
        if (cc.outcome === 'commit_failed') {
          buildCommitFailureBoundaryError({
            validator: 'turn_commit',
            reason:    'chip_click_run_analysis_commit_failed',
            retryable: true,
            ...
          })
          return reply.code(500).send(boundaryError)
        }
```

## 2. RPC contract (current installed signature is unverified)

**File-level signature** (`supabase/migrations/20260422210000_v5_append_turn_atomic_graph_idempotency_fix.sql:51–62`):

```sql
CREATE OR REPLACE FUNCTION append_turn_atomic(
  p_scenario_id      UUID,
  p_turn_id          TEXT,
  p_turn_class       TEXT,
  p_handler_id       TEXT,
  p_request_hash     TEXT,
  p_response_emitted BOOLEAN,
  p_llm_calls_used   INTEGER,
  p_duration_ms      INTEGER,
  p_handler_facts    JSONB,
  p_graph            JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
```

**Client invocation** (`src/orchestrator-v5/session/supabase-store.ts:74-88`): passes 9 named params + 10th conditionally. **File-level diff: clean.** All param names, types, and order match.

**RPC body operations** (post-migration `20260422210000`, diffed against the prior `20260422200000` and `20260422000000`):

1. `SELECT user_id FROM scenarios WHERE id = p_scenario_id` → `v_user_id` (may be NULL in guest mode)
2. If row absent → `RAISE EXCEPTION 'scenario % not found'`
3. `INSERT INTO v5_conversation_turns (..., user_id, ...) VALUES (..., v_user_id, ...) ON CONFLICT DO NOTHING RETURNING id INTO v_turn_id`
4. If conflict (FOUND=false) → re-SELECT id, return early (idempotent retry, no fact write)
5. If `p_graph IS NOT NULL` → `UPDATE scenarios SET graph = p_graph` + ROW_COUNT guard
6. **If `jsonb_array_length(p_handler_facts) > 0` → FOR EACH fact: `INSERT INTO v5_handler_facts (..., user_id, ...) VALUES (..., v_user_id, ...)`** ← critical line for chip-click
7. Return `v_turn_id`

## 3. Table schemas (file-level)

`supabase/migrations/20260417160000_v5_session_store.sql:` v5_handler_facts column:
```sql
user_id  UUID NOT NULL,
```

`supabase/migrations/20260422000000_v5_guest_mode_nullable_user_id.sql:59–60`:
```sql
ALTER TABLE v5_conversation_turns ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE v5_handler_facts      ALTER COLUMN user_id DROP NOT NULL;
```

The relaxation **is in the migration files** but its application status on staging is **unverified**.

## 4. Why Steps 1–3 succeed but Step 4 fails

| Step | Path | handler_facts shape | Hits step 6 of RPC? |
|---|---|---|---|
| 1 `draft_graph` | `handlers/draft-graph-dispatch.ts:216–232` | `[]` (hardcoded — see comment at lines 38-39: "v0.7.0's HandlerFact union has no draft_graph variant") | **No** — `jsonb_array_length([]) === 0` |
| 2 `weakest_option` (text) | TurnExecutor → text_only handler | `[]` | No |
| 3 `add_option` (text) | TurnExecutor → text_only handler | `[]` | No |
| 4 `chip_click run_analysis` | `chip-click-dispatch.ts:215–224` | `[RunAnalysisHandlerFact]` (length ≥ 1) | **Yes** |
| 5 `explain_leader` | skipped (depends_on Step 4) | — | — |
| 6 `edit_budget` (text) | TurnExecutor → text_only handler | `[]` | No |

Step 4 is the only step that exercises the inner FOR LOOP that inserts into `v5_handler_facts`. If the staging table's `user_id` column is still `NOT NULL` (i.e. migration `20260422000000` was not applied), the INSERT raises a `23502 not_null_violation` and the entire RPC rolls back, returning a Supabase error that `supabase-store.ts:90-95` wraps as `StateCommitFailedError`.

## 5. Service-role and connectivity

Client constructed in `src/orchestrator-v5/session/index.ts:45–59` with `SUPABASE_SERVICE_ROLE_KEY`. Service role bypasses RLS, so RLS is not the cause. `ensureScenarioExists` (Steps 1–3) and `append_turn_atomic` (Steps 1–3) succeed against the same project, so credentials, URL, and basic RPC reachability are confirmed.

## 6. What the staging logs will show (verifiable by Paul)

For `request_id ∈ {b92ac362-f20a-4c10-a8e8-4d4112610a1c, 99a83f32-64b4-4d56-a241-8456c77c5b89}`, the structured log line emitted by `chip-click-dispatch.ts:227` will carry:
```
'V5 chip_click run_analysis dispatch — commit failed'
err: { name: 'StateCommitFailedError', message: 'append_turn_atomic RPC failed: <postgres error>' }
```

The `<postgres error>` text discriminates the hypotheses below. Expected if H1: `'null value in column "user_id" of relation "v5_handler_facts" violates not-null constraint'` (Postgres error code `23502`).

## 7. Files to read for fix planning

| File | Lines | Why |
|---|---|---|
| `src/orchestrator-v5/handlers/chip-click-dispatch.ts` | 94–240 | Dispatch + commit catch |
| `src/orchestrator-v5/commit.ts` | 77–114 | `commitDirectAnswer` |
| `src/orchestrator-v5/session/supabase-store.ts` | 73–112, 321–330 | RPC call + fact serialiser |
| `supabase/migrations/20260422210000_*.sql` | 51–134 | Current RPC body |
| `supabase/migrations/20260422000000_*.sql` | 50–60 | The DROP NOT NULL changes |
| `supabase/migrations/20260417160000_*.sql` | (CREATE TABLE) | Original NOT NULL on `v5_handler_facts.user_id` |
| `vendor/package/dist/orchestrator/handler-fact.d.ts` | 1–48 | `RunAnalysisHandlerFact` schema |
| `tools/v5-journey-replay/steps.ts`, `client.ts` | (entire) | Confirms harness sends NO user_id (guest mode) |
