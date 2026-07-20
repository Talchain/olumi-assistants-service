# Golden Fixture Provenance

Two families live here. **Read the `Wire` column before trusting a fixture.**

- **LIVE V5 wire** (`ui-v5-turn-message.captured.json`) — the shape the UI
  actually sends to `/orchestrate/v2/turn` today. Load-bearing gate:
  `tests/contract/ui-cee-live-v5-contract.test.ts`.
- **LEGACY V1-route input** (`ui-turn-*.json`, `ui-analysis-state-real.json`) —
  `TurnRequestSchema`-shaped (`client_turn_id`, flat `conversation_history`).
  These derive from the 410'd V1 route; the live wire would fail them. Kept for
  the UI's #394 KNOWN-DIVERGENCE mirror pins (`tests/contract/ui-cee-contract.test.ts`).

Within a family, if a fixture fails its own schema, fix the schema — not the fixture.

## Sources

| Fixture | Wire | Source | Date |
|---------|------|--------|------|
| `ui-v5-turn-message.captured.json` | LIVE V5 | Byte-shaped from the UI's live V5 outbound builder (`DecisionGuideAI/src/v5/buildPayload.ts` message-turn shape) + the extension slice CEE's `request-extensions.ts` documents the UI sends (`graph_state / analysis_state / user_id / selected_elements`). UUIDv4 ids; V5 stage/turn_class/source vocabulary. | 2026-07-21 |
| `ui-analysis-state-real.json` | LEGACY V1 | Constructed from PLoT V2RunResponse type definition + known-good shape from brief. Not extracted from production logs. | 2026-03-17 |
| `ui-turn-conversation.json` | LEGACY V1 | Constructed from TurnRequestSchema fields for a basic conversation turn. | 2026-03-17 |
| `ui-turn-generate-model.json` | LEGACY V1 | Constructed from TurnRequestSchema fields with generate_model + explicit_generate flags. | 2026-03-17 |
| `ui-turn-post-analysis.json` | LEGACY V1 | Constructed from PLoT V2RunResponse embedded in a turn request. | 2026-03-17 |
| `ui-turn-with-graph.json` | LEGACY V1 | Constructed with 13-node, 16-edge graph matching typical UI decision model. | 2026-03-17 |
| `ui-turn-edit-request.json` | LEGACY V1 | Constructed from typical edit-graph conversation flow. | 2026-03-17 |

## Updating fixtures

When real payloads become available from boundary logging or UI exports,
replace these constructed fixtures with production-sourced ones and update
this table. The contract tests (`tests/contract/ui-cee-contract.test.ts`)
will catch any schema drift.
