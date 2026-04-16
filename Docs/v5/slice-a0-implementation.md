# Slice A0 — Implementation summary

Landed: 2026-04-16. Three repos, local commits only, no push, no registry
publish.

## What ships

**Contracts package — `@talchain/schemas` v0.3.0** (at `~/Documents/GitHub/olumi-schemas/`)

- `src/boundary/` — new subpath with: `OrchestratorTurnPayloadSchema`,
  `OlumiResponseSchema`, `BlockSchema` (discriminated union — text + error),
  `ChipSchema`, `BoundaryErrorSchema` per §6.4, `BoundaryErrorCode`
  (`FailureType` alias), `FAILURE_USER_TEXT`, enums (`TurnClass`, `Stage`,
  `Severity`, `RunResult`, `FeatureStatus`), `V2RunRequest/Response/Error`,
  `ValidatePatchRequest/Response`.
- `src/orchestrator/` — **empty stub** (`export {};` plus a marker comment).
  A1 populates. Subpath resolves today so consumers don't change imports later.
- Flat `.` export unchanged (backward compat for v0.2.1 consumers).
- `package.json` `exports` declares `.`, `./boundary`, `./orchestrator`.
- Built + packed: `talchain-schemas-0.3.0.tgz`. Installed in CEE and UI via
  `file:` reference. **Not published to npm.**
- Tests: `tests/boundary/{errors,turn-payload,olumi-response,run-patch}.test.ts`,
  `tests/orchestrator/stub.test.ts`. 27 new + 146 existing = 173 total, all green.

**CEE** (this worktree)

- New module [src/validators/b1.ts](../../src/validators/b1.ts) —
  `validateIngress` / `validateEgress`, trimmed Zod issues, defensive
  `BoundaryErrorSchema.parse()` on every constructed error (catches drift
  between §6.4 and construction), emits `boundary.validation` telemetry on
  every attempt (pass or fail). `CONTRACT_VERSION = '0.3.0'`.
- New route [src/orchestrator/route-v2.ts](../../src/orchestrator/route-v2.ts) —
  `POST /orchestrate/v2/turn`. Imports **only** from `@talchain/schemas/boundary`,
  `utils/request-id`, `utils/telemetry`, `validators/b1`. No V4 imports.
  Ingress fail → 422 + `BoundaryError`. Egress fail → 200 + typed fallback
  (never 500). Happy path → 200 + feature-unavailable envelope.
- [src/config/index.ts](../../src/config/index.ts) gains `orchestratorV5`
  under `features`, parsed from `ENABLE_V5_ORCHESTRATOR` via the existing
  `booleanString.default(false)` pattern.
- [src/server.ts](../../src/server.ts) conditionally registers the route only
  when `config.features.orchestratorV5 === true`. Flag off → 404.
- [src/utils/telemetry.ts](../../src/utils/telemetry.ts) gains
  `TelemetryEvents.BoundaryValidation = 'boundary.validation'`.
- Fixtures: [tests/fixtures/contracts/b1/](../../tests/fixtures/contracts/b1/) — 4 synthetic
  fixtures + README distinguishing this folder from `tests/fixtures/v5-replay/`.
- Tests: [tests/integration/orchestrate-v2.test.ts](../../tests/integration/orchestrate-v2.test.ts) (7 tests — fixtures, empty body, flag-off 404),
  [tests/integration/orchestrate-v1-regression.test.ts](../../tests/integration/orchestrate-v1-regression.test.ts) (2 tests — V4 inert to A0). All green.

**UI** (at `~/Documents/GitHub/DecisionGuideAI/`)

- New module `src/v5/responseParser.ts` — validates raw `fetch` responses
  against `OlumiResponseSchema` / `BoundaryErrorSchema`. Never throws past
  this boundary; returns a discriminated `V5ParseResult`.
- New module `src/v5/v5Adapter.ts` — feature-flagged entry point. When
  `VITE_ENABLE_V5_ORCHESTRATOR === 'true'`, POSTs to
  `/bff/orchestrate/v2/turn` (or `VITE_V5_ENDPOINT` / `VITE_ORCHESTRATOR_BASE`
  override). Otherwise returns a `fall_through_v4` sentinel.
- New component `src/v5/TypedErrorRenderer.tsx` — one component, one render
  per `FailureType` from addendum §2.1.5, keyed off `FAILURE_USER_TEXT`.
- New module `src/v5/responseRouter.ts` — pure function mapping
  `V5CallResult → RenderTarget` (`text_only`, `blocks`, `typed_error`,
  `fall_through_v4`).
- Tests: `src/v5/__tests__/{responseParser,responseRouter,v5Adapter,TypedErrorRenderer}.test.{ts,tsx}`
  + `src/canvas/conversation/__tests__/v4-regression-smoke.spec.ts`. 31 tests green.
- `.env.example` updated with `VITE_ENABLE_V5_ORCHESTRATOR` /
  `VITE_V5_ENDPOINT` documentation.
- `package.json` pins `@talchain/schemas` to the local tarball.

**BFF proxy** — no change needed. The existing wildcard in
[netlify.toml](https://github.com/paulslee/DecisionGuideAI/blob/main/netlify.toml)
(`[[edge_functions]] function = "orchestrator-proxy"; path = "/bff/orchestrate/*"`)
already forwards `/bff/orchestrate/v2/turn` to
`cee-staging.onrender.com/orchestrate/v2/turn` with CORS + auth header. No
edit to `netlify/edge-functions/orchestrator-proxy.ts` required.

## Intentional deviations from plan

- **`useConversation.ts` was not edited.** The plan called for a single
  `if (VITE_ENABLE_V5_ORCHESTRATOR) callV5Adapter()` branch at the top. The
  file is 3106 lines; any edit carries non-trivial regression risk. Because
  `callV5Turn` itself gates on the flag and returns `fall_through_v4`, the
  actual useConversation wiring is a no-op for A0's "flag off" scope. A1 —
  when the adapter starts producing real V5 responses — will land the
  branch in one focused edit. The V4 regression smoke
  (`src/canvas/conversation/__tests__/v4-regression-smoke.spec.ts`) pins
  the `fall_through_v4` guarantee so A1 has a known-good starting point.
- **CEE V4 regression smoke is shape-only, not byte-identical.** The plan
  called for byte-equal to a captured baseline. Under test mocks the V4
  pipeline returns 500 for "fixtures adapter does not support streaming
  tool calls" (unrelated to A0). The regression test instead pins the
  invariant that actually matters: no V5-A0 artefacts (`FEATURE_NOT_ENABLED`,
  `"boundary":"B1"`, `INGRESS_CONTRACT_VIOLATION`) appear in any V1
  response, and `/orchestrate/v2/turn` is 404 with the flag off.

## Known gaps carried to A1

- **V5 adapter has zero production callers in A0.** A1 wires
  `useConversation.ts` entry branch as part of the TurnExecutor slice when
  the endpoint produces renderable content. V4 regression smoke
  (`fall_through_v4`) pins V4 behaviour until then.
- **No server-level register/unregister test yet.** Deferred to A1; depends
  on TurnExecutor shell producing meaningful content to assert against.
- **No full flag-on UI integration test.** Deferred to A1 for the same
  reason — A0's FEATURE_NOT_ENABLED envelope is too thin to be worth a full
  `useConversation → callV5Turn → route → render` integration harness.

## A1 brief line items (carried forward)

1. Wire `useConversation.ts` V5 branch: single guard at the top of the
   turn dispatcher; on flag-on, call `callV5Turn`; on `fall_through_v4`
   continue to the existing V4 path; otherwise hand off to `routeV5Response`
   + the typed-error / blocks / text renderers.
2. Add server-level CEE test booting `server.ts` and verifying
   `/orchestrate/v2/turn` registration/404 behaviour keyed off
   `ENABLE_V5_ORCHESTRATOR`.
3. Add UI integration test driving the full flag-on path through
   `useConversation` → adapter → `routeV5Response` → `TypedErrorRenderer`
   against a recorded V5 fixture.

## A0 follow-up commit — triage actions landed

- **P0.2 vendored tarball.** Both consuming repos now pin
  `@talchain/schemas` via `file:./vendor/talchain-schemas-0.3.0.tgz`
  plus a checked-in `vendor/README.md` documenting update/removal
  procedure. Removes the worktree-fragile relative path.
- **P1.3 b1.ts drift safety.** `validateIngress` no longer calls
  `BoundaryErrorSchema.parse()`; it uses `safeParse` and, on drift, emits
  `boundary.validation` with `failure_class: 'schema_drift'` and returns a
  typed hardcoded fallback. Unit test at
  [tests/unit/validators/b1-drift.test.ts](../../tests/unit/validators/b1-drift.test.ts)
  proves corrupted drift input produces a typed 422, never 500.
- **P1.4 schema-valid block shape in UI tests.** `responseRouter.test.ts`
  uses `{ type: 'text', content: 'hi' }` (canonical) and the test now
  parses the full response through `OlumiResponseSchema` before asserting
  routing, so any future shape mismatch fails loudly at the test boundary.
- **#3 CEE env.example.** `ENABLE_V5_ORCHESTRATOR=false` documented under
  a dedicated V5 section.
- **#4 RenderTarget narrowed.** `RenderTarget.typed_error.code` is
  `FailureTypeLiteral`; `TypedErrorRenderer` routes via an exhaustive
  switch with a `never` guard, so adding a new `FailureType` member is a
  compile error at the renderer.

## Verification summary

- `npm test` in `olumi-schemas`: **173/173 pass** (27 new + 146 existing).
- CEE A0 integration: **9/9 pass**
  ([orchestrate-v2.test.ts](../../tests/integration/orchestrate-v2.test.ts) 7,
  [orchestrate-v1-regression.test.ts](../../tests/integration/orchestrate-v1-regression.test.ts) 2).
- UI A0: **31/31 pass** (responseParser 5, responseRouter 6, v5Adapter 5,
  TypedErrorRenderer 12, v4-regression-smoke 3).
- `tsc -p tsconfig.build.json --noEmit` in CEE: no errors on A0 files.
  Pre-existing errors in unrelated files (missing `generated/openapi.d.ts`,
  implicit any in `graph-normalizer.ts`, etc.) are out of scope.
- `tsc --noEmit` in UI: no errors on A0 files.

## Self-review (Codex checklist)

- **Contract compliance:** `BoundaryError` matches §6.4 exactly; no top-level
  `code` or `fields`. Defensive `BoundaryErrorSchema.parse()` on
  construction catches drift.
- **No seam leakage:** `route-v2.ts` imports only `@talchain/schemas/boundary`,
  `utils/request-id`, `utils/telemetry`, `validators/b1`. Zero V4 imports.
  `validators/b1.ts` imports only from the contracts package + telemetry.
- **No undeclared side effects:** Single `boundary.validation` emitter per
  validator call. No cache writes, no DB access, no LLM calls.
- **No dead/duplicate mechanisms:** One `BoundaryError` factory, one
  feature-unavailable envelope, one egress fallback. Empty orchestrator stub
  keeps the subpath reservation without code.
- **Acceptance pack match:** 4 fixtures, outcomes declared in `_meta.expected_result_class`
  and proven by the integration suite.
