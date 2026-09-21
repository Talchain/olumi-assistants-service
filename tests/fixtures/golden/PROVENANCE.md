# Golden Fixture Provenance

Three families live here. **Read the `Wire` column before trusting a fixture.**

- **LIVE V5 wire** (`ui-v5-turn-message.live.json`) — the shape the UI's V5
  producer ACTUALLY sends to `/orchestrate/v2/turn` today: `buildV5Payload`
  core keys only, no extension fields. Byte-derived from `DecisionGuideAI/
  src/v5/buildPayload.ts` @ DGAI `6bc31128d`. Load-bearing gate:
  `tests/contract/ui-cee-live-v5-contract.test.ts` (first `describe`).
- **CEE-CAPABILITY (no live producer today)** (`ui-v5-turn-message.cee-capability.json`) —
  an enriched body carrying `graph_state / analysis_state / user_id /
  selected_elements`. **No live producer emits this** (trap-16: the V5 wire
  sends no graph). It exists ONLY to exercise CEE's defensive
  `parseRequestExtensions` so a future producer's extensions are validated at
  the boundary rather than silently dropped. Do NOT read it as "the UI sends
  this". Gate: `ui-cee-live-v5-contract.test.ts` (second `describe`).
- **LEGACY V1-route input** (`ui-turn-*.json`, `ui-analysis-state-real.json`) —
  `TurnRequestSchema`-shaped (`client_turn_id`, flat `conversation_history`).
  These derive from the 410'd V1 route; the live wire would fail them. Kept for
  the UI's #394 KNOWN-DIVERGENCE mirror pins (`tests/contract/ui-cee-contract.test.ts`).

Within a family, if a fixture fails its own schema, fix the schema — not the fixture.

## Why the split (the corrected record)

An earlier `ui-v5-turn-message.captured.json` claimed to be the LIVE V5 wire
WITH all four extensions. That was wrong on two counts, and it was never
"captured": it was hand-shaped, and its extension slice was sourced from a
stale doc header in `src/orchestrator-v5/boundary/request-extensions.ts` that
asserted "The UI ALSO sends graph_state…". Byte-checking the UI producer at
DGAI `6bc31128d` overturned that: the sole live V5 send site posts
`buildV5Payload`'s core keys only; caller identity travels via HTTP headers;
and the graph_state-attaching request builder posts to the **410'd V1 route**,
not the live V5 wire. The single fixture was therefore SPLIT into the two V5
families above, and neither is named `.captured` because neither was.

## Sources

| Fixture | Wire | Source | Date |
|---------|------|--------|------|
| `ui-v5-turn-message.live.json` | **LIVE V5** | Byte-shaped from the UI's live V5 outbound builder (`DecisionGuideAI/src/v5/buildPayload.ts` @ DGAI `6bc31128d`) — core keys only (`kind/turn_id/scenario_id/stage/turn_class/message/source`), turn_class hardcoded `frame` at the sole live call site. NO extension fields (the live wire sends none). UUIDv4 ids; V5 stage/turn_class/source vocabulary. Byte-shaped, not log-captured. | 2026-07-21 |
| `ui-v5-turn-message.cee-capability.json` | **CEE-CAPABILITY (no live producer today — trap-16)** | Hand-built to exercise `parseRequestExtensions` for `graph_state / analysis_state / user_id / selected_elements`. NO live producer emits these on the V5 wire; this fixture is a capability probe, not a wire capture. | 2026-07-21 |
| `ui-analysis-state-real.json` | LEGACY V1 | Constructed from PLoT V2RunResponse type definition + known-good shape from brief. Not extracted from production logs. | 2026-03-17 |
| `ui-turn-conversation.json` | LEGACY V1 | Constructed from TurnRequestSchema fields for a basic conversation turn. | 2026-03-17 |
| `ui-turn-generate-model.json` | LEGACY V1 | Constructed from TurnRequestSchema fields with generate_model + explicit_generate flags. | 2026-03-17 |
| `ui-turn-post-analysis.json` | LEGACY V1 | Constructed from PLoT V2RunResponse embedded in a turn request. | 2026-03-17 |
| `ui-turn-with-graph.json` | LEGACY V1 | Constructed with 13-node, 16-edge graph matching typical UI decision model. | 2026-03-17 |
| `ui-turn-edit-request.json` | LEGACY V1 | Constructed from typical edit-graph conversation flow. | 2026-03-17 |

## Updating fixtures

When real payloads become available from boundary logging or UI exports,
replace these constructed fixtures with production-sourced ones and update
this table. The contract tests (`tests/contract/ui-cee-contract.test.ts` and
`tests/contract/ui-cee-live-v5-contract.test.ts`) will catch any schema drift.
If the LIVE V5 producer ever starts sending extension fields, promote them from
the CEE-CAPABILITY fixture into `ui-v5-turn-message.live.json` and flip the
null-assertions in the live `describe` — that is the signal the wire changed.
