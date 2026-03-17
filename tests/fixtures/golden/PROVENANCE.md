# Golden Fixture Provenance

These fixtures represent the payload shapes the UI sends to the CEE service.
If a fixture fails schema validation, fix the schema — not the fixture.

## Sources

| Fixture | Source | Date |
|---------|--------|------|
| `ui-analysis-state-real.json` | Constructed from PLoT V2RunResponse type definition + known-good shape from brief. Not extracted from production logs. | 2026-03-17 |
| `ui-turn-conversation.json` | Constructed from TurnRequestSchema fields for a basic conversation turn. | 2026-03-17 |
| `ui-turn-generate-model.json` | Constructed from TurnRequestSchema fields with generate_model + explicit_generate flags. | 2026-03-17 |
| `ui-turn-post-analysis.json` | Constructed from PLoT V2RunResponse embedded in a turn request. | 2026-03-17 |
| `ui-turn-with-graph.json` | Constructed with 13-node, 16-edge graph matching typical UI decision model. | 2026-03-17 |
| `ui-turn-edit-request.json` | Constructed from typical edit-graph conversation flow. | 2026-03-17 |

## Updating fixtures

When real payloads become available from boundary logging or UI exports,
replace these constructed fixtures with production-sourced ones and update
this table. The contract tests (`tests/contract/ui-cee-contract.test.ts`)
will catch any schema drift.
