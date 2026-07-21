# CEE boundary contracts

These JSON Schema files define CEE's input and output contracts.
They are auto-generated from Zod schemas — do not edit manually.

## Consuming services

UI and other consumers should validate their payloads against these
schemas in CI. Fetch from the CEE repo or use git submodules.

## Regenerating

    npx tsx scripts/export-schemas.ts

CI will fail if committed schemas are out of date.

## Live vs legacy — read before consuming an input schema

CEE's live ingress path (`/orchestrate/v2/turn` → `runPreFlight`) validates the
**live V5** schemas below. The **legacy V1** input schemas
(`TurnRequestSchema` & co.) derive from the 410'd V1 route (`route.ts` /
`route-stream.ts`) — their only runtime importers are those dead routes, and
they REJECT a real V5 payload (they require `client_turn_id`; the live wire
sends `turn_id`). They are still exported here because the UI's mirror gate
(#394) pins them as KNOWN-DIVERGENCE; retiring them is a cross-repo window —
warn the UI first (their pins go red by design).

## Schema inventory

| File | Direction | Wire | Zod source |
|------|-----------|------|------------|
| orchestrator-turn-payload.schema.json | UI → CEE | **LIVE V5** | `OrchestratorTurnPayloadSchema` (`@talchain/schemas/boundary`) — B1 core |
| v5-request-extensions.schema.json | UI → CEE | **LIVE V5** | `V5RequestExtensionsSchema` (`src/orchestrator-v5/boundary/request-extensions.ts`) — the graph_state/analysis_state/user_id/selected_elements slice re-parsed after B1 |
| turn-request.schema.json | UI → CEE | legacy V1 | TurnRequestSchema |
| system-event.schema.json | UI → CEE | legacy V1 | SystemEventSchema |
| analysis-state.schema.json | UI → CEE | legacy V1 | AnalysisStateSchema |
| graph-state.schema.json | UI → CEE | legacy V1 | GraphSchema |
| orchestrator-response-v2.schema.json | CEE → UI | live | OrchestratorResponseEnvelopeV2Schema |
| stream-event.schema.json | CEE → UI | live | OrchestratorStreamEventSchema |

## Refinement gap

JSON Schema 7 cannot express Zod `.refine()` / `.superRefine()` logic.
These runtime rules are **not** captured in the exported schemas:

1. **`OrchestratorTurnPayloadSchema` (LIVE V5)** — a union-level `superRefine`
   enforces `chip` only when `source` ∈ {chip, chip_click}, and `retry_of`
   only when `source === 'retry'`. The exported `anyOf` allows either
   sub-object regardless of `source`.
2. **`SystemEventSchema` (`patch_accepted`)** — `superRefine` requires at
   least one of `patch_id` or `block_id` in `details`. The exported schema
   allows both to be absent.
3. **`AnalysisResponseSchema`** (nested in `turn-request.schema.json` via
   `context.analysis_response`) — `refine` requires at least one of
   `analysis_status`, `results`, or `meta`. The exported schema allows all
   three to be absent.
4. **`V5RequestExtensionsSchema` (LIVE V5) — `selected_elements` fail-open**.
   The exported `v5-request-extensions.schema.json` declares `selected_elements`
   as a union (`{node_ids?, edge_ids?}` **or** `string[]`), which reads as
   "a structurally-invalid value is REJECTED". The RUNTIME diverges: unlike the
   other three extensions (whose invalid values return a 422 `BoundaryError`),
   `parseRequestExtensions` treats `selected_elements` as best-effort context —
   a structurally-invalid value is **silently DROPPED** (a `pass:false`
   boundary-validation telemetry event is emitted, and the pre-route falls back
   to label-only matching, identical to a turn that carried no selection). The
   turn is NOT rejected. JSON Schema cannot express this per-field
   fail-open-with-drop policy, so a consumer validating against the exported
   schema would over-reject relative to CEE's actual behaviour.

Consumers should add equivalent validation in their own CI if these
constraints matter. The self-validation tests in
`tests/contracts/schema-self-test.test.ts` include known-bad boundary
cases that document these gaps.
