# CEE boundary contracts

These JSON Schema files define CEE's input and output contracts.
They are auto-generated from Zod schemas — do not edit manually.

## Consuming services

UI and other consumers should validate their payloads against these
schemas in CI. Fetch from the CEE repo or use git submodules.

## Regenerating

    npx tsx scripts/export-schemas.ts

CI will fail if committed schemas are out of date.

## Schema inventory

| File | Direction | Zod source |
|------|-----------|------------|
| turn-request.schema.json | UI → CEE | TurnRequestSchema |
| system-event.schema.json | UI → CEE | SystemEventSchema |
| analysis-state.schema.json | UI → CEE | AnalysisStateSchema |
| graph-state.schema.json | UI → CEE | GraphSchema |
| orchestrator-response-v2.schema.json | CEE → UI | OrchestratorResponseEnvelopeV2Schema |
| stream-event.schema.json | CEE → UI | OrchestratorStreamEventSchema |

## Refinement gap

JSON Schema 7 cannot express Zod `.refine()` / `.superRefine()` logic.
Two runtime rules are **not** captured in the exported schemas:

1. **`SystemEventSchema` (`patch_accepted`)** — `superRefine` requires at
   least one of `patch_id` or `block_id` in `details`. The exported schema
   allows both to be absent.
2. **`AnalysisResponseSchema`** (nested in `turn-request.schema.json` via
   `context.analysis_response`) — `refine` requires at least one of
   `analysis_status`, `results`, or `meta`. The exported schema allows all
   three to be absent.

Consumers should add equivalent validation in their own CI if these
constraints matter. The self-validation tests in
`tests/contracts/schema-self-test.test.ts` include known-bad boundary
cases that document these gaps.
