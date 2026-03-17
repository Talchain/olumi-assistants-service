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
