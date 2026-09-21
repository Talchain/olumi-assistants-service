# Orchestrator Streaming Fixtures

**Schema version:** 1.0
**Source of truth:** `src/orchestrator/pipeline/stream-events.ts`

## Consumers

- **CEE emitter tests** — `tests/unit/orchestrator/pipeline/stream-events.test.ts`
- **UI parser tests** — shared with the UI repo for `OrchestratorStreamEvent` parser validation

## Fixture files

| File | Path | Description |
|---|---|---|
| `deterministic.json` | turn_start → turn_complete | Deterministic routing (no LLM) |
| `llm-only.json` | turn_start → text_delta* → turn_complete | LLM text generation, no tool calls |
| `llm-plus-tool.json` | turn_start → text_delta* → tool_start → block* → tool_result → turn_complete | LLM + tool execution |
| `cached-json.json` | Single envelope | Idempotency cache hit (HTTP 200, application/json) |
| `error-mid-llm.json` | turn_start → text_delta* → error | LLM timeout mid-stream |
| `error-mid-tool.json` | turn_start → text_delta* → tool_start → error | Tool error mid-execution |
| `disconnect.json` | turn_start → text_delta* | Client disconnect (no terminal event) |

## Notes

- `tool_result` uses the slim schema: `{ tool_name, success, duration_ms? }` only.
  Visual content comes from `block` events. Canonical state from `turn_complete`.
- Fixtures include parser-hardening edge cases: empty deltas, unicode, newlines.
- All `seq` numbers are monotonically increasing within each fixture.
