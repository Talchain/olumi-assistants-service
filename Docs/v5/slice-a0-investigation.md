# Slice A0 — Investigation

Date captured: 2026-04-16.
Environment: CEE worktree `nostalgic-hermann` off `staging`; UI off `main`;
`olumi-schemas` off `main`. No push to remotes.

## 1. Current CEE orchestrator transport

- **Non-streaming:** `POST /orchestrate/v1/turn` in [src/orchestrator/route.ts](../../src/orchestrator/route.ts) —
  buffered single JSON response (`reply.send(v4Envelope)`), no SSE.
- **Streaming variant:** `POST /orchestrate/v1/turn/stream` in
  [src/orchestrator/route-stream.ts](../../src/orchestrator/route-stream.ts) —
  SSE via `reply.raw.write()`, gated by `config.features.orchestratorStreaming`
  (default off).
- **Wire envelope types:** `OrchestratorResponseEnvelope` /
  `OrchestratorResponseEnvelopeV2` in [src/orchestrator/types.ts](../../src/orchestrator/types.ts).
- **UI consumption:** UI calls Netlify BFF `/bff/orchestrate/v1/turn` which
  proxies to `cee-staging.onrender.com`. CEE orchestrator routes have no CORS,
  so the proxy is load-bearing.

## 2. `@talchain/schemas` v0.2.1 inventory (pre-A0)

- Package name: `@talchain/schemas` (not `@olumi/schemas`). Pinned at 0.2.1 in
  CEE and UI.
- Single flat `.` export, no subpaths.
- Boundary-class exports present: `GraphV3`, `NodeV3`, `EdgeV3`,
  `FactorSensitivity`, `FragileEdge`, `AnalysisReadyV3`, `ResponseMeta`,
  `CeeTypedError`, etc.
- Orchestrator-class exports present: `ValidationWarning`,
  `CIL_WARNING_CODES`, `CIL_THRESHOLDS`, `CeeErrorCode`.
- **Critical local redefinitions in CEE** at
  [src/schemas/cee-v3.ts](../../src/schemas/cee-v3.ts): `NodeV3`, `EdgeV3`,
  `GraphV3`, `ObservedStateV3`, `OptionV3` — CEE extends the shared shapes
  with additional metadata. A0 does not attempt to reconcile these; it only
  adds new boundary types alongside.

## 3. Existing B1 validation on `/orchestrate/v1/turn`

- Request schema: `TurnRequestSchema.safeParse(req.body)` in
  [src/orchestrator/route.ts](../../src/orchestrator/route.ts); schema in
  [src/orchestrator/route-schemas.ts](../../src/orchestrator/route-schemas.ts).
- Failure mode: HTTP **400** with code `INVALID_REQUEST` (not 422, not
  typed `BoundaryError`).
- Zod mode: **`.passthrough()`** everywhere — extra fields silently accepted.
- Egress validator: `validateV1EnvelopeContract` /
  `validateV2EnvelopeContract` in
  [src/orchestrator/validation/response-contract.ts](../../src/orchestrator/validation/response-contract.ts).
  Mutates in place (drops invalid suggested_actions / blocks); returns 200
  with repaired envelope; never 422.
- No shared boundary validator middleware; each route owns its own.

## 4. UI response consumption path

- Turn call seam:
  [src/canvas/conversation/turnService.ts](https://github.com/paulslee/DecisionGuideAI/blob/main/src/canvas/conversation/turnService.ts)
  (`callOrchestratorTurn`, `streamOrchestratorTurn`).
- Endpoint construction: `ORCHESTRATOR_URL` constant, defaults to
  `/bff/orchestrate/v1/turn`, override via `VITE_ORCHESTRATOR_BASE`.
- Response consumer: `useConversation` hook → `DraftChat`. Existing typed-error
  path handles V4 envelope errors.
- Existing feature flags: `VITE_FEATURE_PLOT_STREAM`,
  `VITE_FEATURE_SCENARIO_SANDBOX`, `VITE_SHOW_VERDICT_CARD`,
  `VITE_FEATURE_SNAPSHOTS_V2`. Pattern: Vite env + read through `flags.ts`.

## 5. Render env-var mechanism

- Config parsed once by Zod in
  [src/config/index.ts](../../src/config/index.ts) at startup, cached via
  Proxy. Startup validation in
  [src/server.ts](../../src/server.ts). No hot reload — adding
  `ENABLE_V5_ORCHESTRATOR` requires a Render dashboard set + redeploy.
- Existing orchestrator flags under `config.features.*`: `orchestrator`,
  `orchestratorV2`, `orchestratorStreaming`, `pipelineV4Enabled`.

## 6. Decisions locked with Paul

1. Contracts package: **extend** `@talchain/schemas` to v0.3.0 with
   `/boundary` and `/orchestrator` subpaths. Flat `.` export unchanged.
2. B1 Zod mode: **`.strict()`** everywhere in v2 ingress. Unknown → 422 +
   `INGRESS_CONTRACT_VIOLATION`. v1 path stays `.passthrough()` (unchanged).
3. V2 transport: **buffered JSON only.** No SSE in A0.
4. `BoundaryError` shape locked to §6.4:
   `{ error, boundary, direction, validator, details, request_id, retryable }`.
   No top-level `code` or `fields`. Zod issues trimmed under `details.issues[]`.
5. Feature-unavailable envelope: typed OlumiResponse with an `error` block
   (`FEATURE_NOT_ENABLED`, `severity: info`). Safer than a raw "not
   implemented" string if the flag accidentally flips on. Flag-off path stays
   404 (route not registered).
6. Fixture folder: `tests/fixtures/contracts/b1/` for synthetic B1 fixtures.
   `tests/fixtures/v5-replay/` reserved for captured real bundles.
7. Package distribution: `npm run build && npm pack` in `olumi-schemas`,
   install in CEE/UI via `file:` reference to the tarball. **No registry
   publish without Paul's explicit instruction.**
8. V4 regression smoke: automated tests in CEE and UI asserting the V4 path
   is inert to A0 when V5 flags are off.
9. TypedErrorRenderer: one renderer covers every `FailureType` in addendum
   §2.1.5. No revisit.
