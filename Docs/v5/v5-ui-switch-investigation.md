# V5 UI-switch investigation

**Date:** 2026-04-21
**Brief:** v5-group3-live-path (Task D)
**Scope:** investigation only — read-only across two repos. No code changes.
**Repos:**
- CEE: `olumi-assistants-service` at branch `staging`
- UI: `DecisionGuideAI` (read-only investigation)

## Summary

| Question | Answer |
|---|---|
| What gates V1 vs V2 from the UI? | **Two independent flags** — CEE `ENABLE_V5_ORCHESTRATOR` env var AND UI `VITE_ENABLE_V5_ORCHESTRATOR` env var. Both must be true. |
| Does V5 support streaming? | **No.** V2 route is buffered JSON only; enforced by a CI invariant. |
| Does the UI already handle non-streaming V2 responses? | **Yes.** Single `res.json()` parse with full typed-error handling. No UI code change required. |
| Minimal switch to staging? | Set both flags to `true`, deploy CEE first, then rebuild/deploy UI. |
| Rollback? | Reverse both flags. Either alone disables V5 fully. |
| Can V5 and V4 coexist safely? | **Yes.** The UI's eligibility filter restricts V5 to free-text frame-stage messages — everything else falls through to V4, and any V5 failure falls through to V4 silently. |

## What V5 handles vs what falls through to V4

Even with both flags flipped, V5 handles only a narrow slice of traffic. The UI's eligibility predicate at [eligibility.ts:75-104](../../../../DecisionGuideAI/src/v5/eligibility.ts) enforces seven conditions (all must hold). Any turn that fails any condition is silently routed to V4 with no V5 artefact.

| Turn type | Routes to | Why (eligibility.ts line) |
|---|---|---|
| Free-text user message, no prior tools, analysis incomplete, frame stage | **V5** | All conditions pass |
| Flag off (`VITE_ENABLE_V5_ORCHESTRATOR !== 'true'`) | V4 | Line 76-77 (`flag_off`) |
| System-origin turn (`mode !== 'user'`) | V4 | Line 79-80 (`system_mode`) |
| Chip click metadata present (`chipMeta` truthy) | V4 | Line 82-83 (`chip_metadata`) |
| Turn-type hint present (`turnType` truthy) | V4 | Line 85-86 (`turn_type_hint`) |
| Source is `'chip'` or `'chip_click'` | V4 | Line 88-89 (`chip_source`) |
| Source is `'retry'` | V4 | Line 91-92 (`retry_source`) |
| Analysis already complete (`analysisStateReady === true` OR `resultsStatus === 'complete'`) | V4 | Line 94-95 (`analysis_ran`) |
| Any prior assistant message has `blocks.length > 0` (i.e. a tool ran earlier in the conversation) | V4 | Line 97-102 (`prior_tool_calls`) |

**Operational implication:** V5 will handle the opening free-text message(s) of a new scenario while analysis hasn't run and no tools have fired. As soon as a tool runs (e.g. `run_analysis`, graph edit, premortem) or analysis completes, the session seamlessly switches to V4 for the rest of that scenario. This is intentional — it is the primary coexistence mechanism and the safety net for the Group 3 transition.

## 1. What determines whether the UI calls V1 or V2?

**Two flags, both required.** Either alone is a no-op.

### 1a. CEE-side flag: `ENABLE_V5_ORCHESTRATOR`

- File: [src/config/index.ts:299](../../src/config/index.ts#L299), [src/config/index.ts:674](../../src/config/index.ts#L674)
- Zod default: `false`
- Surfaced on `config.features.orchestratorV5`
- Gate: [src/server.ts:956-959](../../src/server.ts#L956-L959) — the `POST /orchestrate/v2/turn` route is only registered when this flag is true. When false, the endpoint returns 404.

```ts
// src/server.ts:956-959
if (config.features.orchestratorV5) {
  await ceeOrchestratorRouteV2(app);
  app.log.info({}, 'V5 orchestrator scaffold registered (POST /orchestrate/v2/turn)');
}
```

### 1b. UI-side flag: `VITE_ENABLE_V5_ORCHESTRATOR`

- File: [src/v5/v5Adapter.ts:19-22](../../../../DecisionGuideAI/src/v5/v5Adapter.ts) — Vite inlines at build time.
- Strict string equality: `import.meta.env.VITE_ENABLE_V5_ORCHESTRATOR === 'true'`.
- Current staging default: `false` (see [.env.example:152](../../../../DecisionGuideAI/.env.example) — `VITE_ENABLE_V5_ORCHESTRATOR=false`).
- When `false`, `callV5Turn` returns the `{ kind: 'fall_through_v4' }` sentinel at [v5Adapter.ts:43-44](../../../../DecisionGuideAI/src/v5/v5Adapter.ts) and the conversation path routes to V4 with no V5 artefact.
- When `true`, eligibility filter (above) gates individual turns. Eligible turns POST to `/bff/orchestrate/v2/turn` (or `VITE_V5_ENDPOINT` / `${VITE_ORCHESTRATOR_BASE}/orchestrate/v2/turn` if set — see [v5Adapter.ts:24-30](../../../../DecisionGuideAI/src/v5/v5Adapter.ts)).
- Wired into the conversation hook at [useConversation.ts:2408-2492](../../../../DecisionGuideAI/src/canvas/conversation/useConversation.ts).

### 1c. V4 endpoints for comparison

- Non-streaming: `/bff/orchestrate/v1/turn` (default in [turnService.ts:69-72](../../../../DecisionGuideAI/src/canvas/conversation/turnService.ts))
- Streaming: `/bff/orchestrate/v1/turn/stream` (SSE; [turnService.ts:81-82](../../../../DecisionGuideAI/src/canvas/conversation/turnService.ts) and onward for chunk handling).

## 2. Does V5 support streaming?

**No.**

- [src/orchestrator/route-v2.ts:1-17](../../src/orchestrator/route-v2.ts#L1-L17) — header comment explicitly states "buffered JSON only (no raw-stream writes, no SSE Content-Type). Enforced by `scripts/validate-transport-invariants.sh` in CI."
- Line 44: only `app.post('/orchestrate/v2/turn', ...)` is registered. No `/orchestrate/v2/turn/stream` route exists anywhere under `src/`.
- Line 78-92: synchronous `runTurnExecutor()` → single `reply.code(200).send(envelope)`. No `reply.raw` writes, no `text/event-stream` headers, no chunked transfer.

## 3. Can the UI consume a non-streaming V2 response?

**Yes. Already implemented.** No UI change required.

- [src/v5/v5Adapter.ts:50-69](../../../../DecisionGuideAI/src/v5/v5Adapter.ts): single `fetch` POST, returns `Response` directly to `parseV5Response`. No streaming reader, no SSE handling.
- [src/v5/responseParser.ts:22-59](../../../../DecisionGuideAI/src/v5/responseParser.ts): single `await res.json()` at line 25, branches on `res.ok`.
  - 2xx: validates against `OlumiResponseSchema` from `@talchain/schemas/boundary`.
  - Non-2xx: validates against `BoundaryErrorSchema`; on match returns `{ kind: 'boundary_error', error }`.
  - On any parse failure: returns `{ kind: 'parse_error', reason, http_status, raw }` — never throws.
- [src/v5/responseRouter.ts:25-56](../../../../DecisionGuideAI/src/v5/responseRouter.ts): maps each `V5CallResult` kind to a render target:
  - `boundary_error` → `{ kind: 'typed_error', code: error.error, requestId, boundaryError }`
  - `parse_error` → `{ kind: 'typed_error', code: 'INTERNAL_ERROR' }`
  - Response with `error` block → `{ kind: 'typed_error', code: errorBlock.error_code }`
  - Response with only info/no blocks → `text_only`
  - Response with non-error blocks → `blocks`
- [src/canvas/conversation/useConversation.ts:2464-2480](../../../../DecisionGuideAI/src/canvas/conversation/useConversation.ts): renders `text_only`, `blocks`, or `typed_error` (via `FAILURE_USER_TEXT[code]` from `@talchain/schemas/boundary`). Any V5 error surfaces as an assistant-authored message; nothing crashes the UI.

## 4. Minimal change to route staging UI traffic to V5

Four steps, in order. **Both flags are required; either alone is a no-op.**

1. **CEE:** ensure the staging deploy env sets `ENABLE_V5_ORCHESTRATOR=true`.
2. **Deploy CEE** to staging. Verify the startup log shows `V5 orchestrator scaffold registered (POST /orchestrate/v2/turn)` — if this log is absent, the flag didn't parse and the route is still 404.
3. **UI:** set `VITE_ENABLE_V5_ORCHESTRATOR=true` in the staging env file (`.env.development` for local dev, or whatever env the staging build consumes — e.g. Netlify env vars injected at build time). Vite inlines at build; the flag is embedded in the JS bundle, not read at runtime.
4. **Rebuild and deploy UI** to staging. Hard-refresh the browser to bust the bundle cache.

Reference (UI env file, for local testing):
```
# .env.development (DecisionGuideAI)
VITE_ENABLE_V5_ORCHESTRATOR=true
```

Reference (CEE, for local testing against a real CEE):
```
# .env (olumi-assistants-service)
ENABLE_V5_ORCHESTRATOR=true
```

Optional UI endpoint override (rarely needed): set `VITE_V5_ENDPOINT=https://cee-staging.onrender.com/orchestrate/v2/turn` to bypass the `/bff` proxy, but this requires CORS on CEE (currently absent). Prefer the default `/bff/orchestrate/v2/turn` path.

## 5. Rollback mechanism

**Reverse both flags.** The order of rollback does not matter; either flag alone makes V5 inert.

- **Immediate disablement (without redeploy):** set the CEE env var `ENABLE_V5_ORCHESTRATOR=false` and restart the CEE service. V2 route stops being registered → UI hits 404 on V5 calls → `parseV5Response` returns a `parse_error` → `responseRouter` maps to `typed_error` with code `INTERNAL_ERROR` → user sees an assistant-authored error bubble. To avoid surfacing 404 errors to users, also flip the UI flag.
- **Clean rollback:** set `VITE_ENABLE_V5_ORCHESTRATOR=false` (or remove the line), rebuild and redeploy the UI. `isV5Enabled()` returns false → `{ kind: 'fall_through_v4' }` sentinel at [v5Adapter.ts:43-44](../../../../DecisionGuideAI/src/v5/v5Adapter.ts) → V4 path with no V5 artefact.

Both flag reversions together constitute the complete rollback. There is no runtime toggle, no admin endpoint, no database flag — the rollback is purely deploy-time.

## 6. Can V5 and V4 coexist safely?

**Yes. Coexistence is the intended operating mode during transition.** Three mechanisms enforce it:

### 6a. Eligibility filter (primary gate)

See the table in the "What V5 handles vs what falls through to V4" section above. Only free-text frame-stage user messages with no prior tool calls reach V5. Everything else — chips, retries, post-analysis, tool results — goes to V4 unchanged. V5 never intercepts a turn that V4 needs to handle.

### 6b. Fall-through scope (precise)

The UI falls through to V4 in exactly two cases:

1. **`fall_through_v4` sentinel** — the V5 adapter returns this when `isV5Enabled()` is false OR when the UI eligibility filter rejects the turn. See [v5Adapter.ts:43-44](../../../../DecisionGuideAI/src/v5/v5Adapter.ts).
2. **Caught exception from the V5 code path** — if any V5 call throws (network error, adapter crash), the `try/catch` in the conversation hook falls through to V4.

The UI does **NOT** fall through on:

- **`typed_error` render targets** — V5 returned a valid BoundaryError or an OlumiResponse with an error block. The UI renders the error text directly via `FAILURE_USER_TEXT[code]` at [useConversation.ts:2473-2479](../../../../DecisionGuideAI/src/canvas/conversation/useConversation.ts). A retryable typed error (e.g. Task B's commit-failure `retryable: true`) stays on V5 and the user retries the turn; it does NOT silently switch the session to V4.
- **Pre-flight 422 (`scenario_not_found`)** — same as above; rendered as a typed error on V5.

Operational consequence: a persistent V5 fault (e.g. a broken adapter returning BoundaryError on every request) will NOT quietly migrate users to V4. The user will see repeated retryable errors until the CEE-side flag is flipped off. This is the intended fail-closed behaviour — a silent degradation here would mask the underlying defect.

### 6c. Typed-error handling at the UI

Every non-2xx V5 response is mapped to a typed error and rendered as a user-facing assistant message (see §3). The UI never crashes on a V5 error envelope; it never shows a raw HTTP status code; it never loses state.

**Wire shape invariant (Group 3 P0 follow-up):** non-2xx V5 responses MUST be `BoundaryError` envelopes, not `OlumiResponse`. The UI parser at [responseParser.ts:35](../../../../DecisionGuideAI/src/v5/responseParser.ts#L35) treats every non-ok status as BoundaryError; sending an OlumiResponse on non-2xx collapses to a generic `parse_error` → `INTERNAL_ERROR` on the UI, losing typed `error_code` and `retryable`. The CEE V2 route honours this invariant for pre-flight failures (422), egress-validation failures (200 + fallback OlumiResponse by design), and commit failures (500 + BoundaryError).

### 6d. No shared state between V4 and V5

- V4 writes to `conversation_turns` (legacy schema).
- V5 writes to `v5_conversation_turns` (new schema; see [supabase/migrations/20260417160000_v5_session_store.sql](../../supabase/migrations/20260417160000_v5_session_store.sql)).
- The two session stores are disjoint. A turn processed by V5 does not need to be reconciled with V4 session state, and vice versa. In a scenario where V5 handles turn 1 and V4 handles turn 2+ (because a tool fired), each system reads only its own history.

**Caveat — cross-version history visibility:** V5's `readRecent` only sees `v5_conversation_turns` rows. If a future brief needs V5 turns to reference V4-era history, that's a schema-bridge problem deferred beyond Group 3. For Group 3, the eligibility filter guarantees V5 only sees the opening message(s) of a fresh scenario, so history visibility is a non-issue.

## Operational risk notes

- **Scenario pre-creation dependency.** V5 assumes a row exists in `public.scenarios` before the first V2 turn. The UI creates this row during scenario creation via [scenarioService.ts](../../../../DecisionGuideAI/src/services/scenarioService.ts). If the UI ever stops inserting the row (e.g. a future refactor), V5 will emit `SCENARIO_NOT_FOUND` on every turn. Task A of this brief adds a pre-flight check that surfaces this failure as a clear 422 instead of an opaque commit failure — see the Task A commit for details.
- **Observability gap in V4 fall-through.** When the UI silently falls through on a V5 failure, the only signal on the CEE side is the absence of a `/orchestrate/v2/turn` log entry for a scenario that should have had one. Consider adding UI-side Sentry breadcrumbs for `fall_through_v4` events caused by V5 errors (out of scope for Group 3; flag as follow-up).
- **Bundle-cache staleness.** Because `VITE_ENABLE_V5_ORCHESTRATOR` is inlined at build time, a user with a cached bundle will keep behaving according to the flag value at their last page load. Staging rollout must account for cache TTLs and service-worker refresh. Hard-refresh test devices before verifying.
- **V5-in-prod gating.** `config.features.orchestratorV5` defaults to false ([src/config/index.ts:299](../../src/config/index.ts#L299)). Keep it false in production until the Group 3 staging soak passes. The production env var is independent of staging's — flipping staging does not affect production.
