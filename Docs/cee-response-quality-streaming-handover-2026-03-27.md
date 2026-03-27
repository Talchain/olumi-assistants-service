# CEE Response Quality & Streaming Fixes — Handover

**Date:** 2026-03-27
**Branch:** fix/deterministic-routing-hardening

---

## Summary

Six fixes addressing raw XML leaking into the chat panel, artefact rendering, coaching duplication, "Changes applied." duplicate bubbles, edit_graph timeouts, and repair prompt quality.

---

## Task 1: XML Envelope Stripping in Streaming Path

**Root cause:** `pipeline-stream.ts:194-195` relayed raw LLM text deltas directly to the client. The XML parser (`response-parser.ts`) only ran on `message_complete`, so during streaming the user saw `<response><assistant_text>Here are four...` as raw text.

**Fix:** Added `StreamingEnvelopeStripper` class (`src/orchestrator/pipeline/streaming-xml-stripper.ts`) — a stateful incremental XML tag stripper that:
- Strips all known envelope tags (`<response>`, `<assistant_text>`, `<diagnostics>`, `<blocks>`, `<block>`, `<type>`, `<artefact_type>`, `<title>`, `<description>`, `<content>`, `<suggested_actions>`, `<action>`, `<label>`, `<message>`, `<role>`, `<tone>`, `<actions>`)
- Suppresses content within `<diagnostics>`, `<blocks>`, and `<suggested_actions>` sections entirely
- Handles tag boundaries that span multiple deltas via buffering
- Flushes remaining buffer on `message_complete`

Wired into `pipeline-stream.ts` — processes each `text_delta` before emission. Final envelope parsing still runs on `message_complete` via `prep.postProcess()`.

**Test:** `tests/unit/orchestrator/pipeline/streaming-xml-stripper.test.ts` (9 tests)

---

## Task 2: Artefact Block Handling

**Finding:** The response parser and block factory already correctly handle artefact blocks. `parseBlocksWithWarnings()` supports `artefact` type, `convertExtractedBlocks()` creates `ArtefactBlock` via `createArtefactBlock()`, and Phase 4 merges them into the envelope.

**Fix:** Added `CEE_ARTEFACT_RENDERING_ENABLED` feature flag (default: `false`). When disabled, artefact blocks are suppressed in `convertExtractedBlocks()` and replaced with a commentary fallback: "I've prepared a decision toolkit, but interactive artefacts aren't available yet."

When the UI has a renderer, set `CEE_ARTEFACT_RENDERING_ENABLED=true` to enable artefact blocks.

**Files:** `src/config/index.ts`, `src/orchestrator/turn-handler.ts`

---

## Task 3: Post-Draft Coaching Duplication

**Root cause:** `draft-graph.ts:194-195` set `assistantText = patchData.summary`, where `buildPatchSummary()` returns the full `coachingSummary`. This same text also lived in the block's `coaching.summary` field, so the UI rendered it twice.

**Fix:** Changed `assistantText` to use only the first sentence of the summary (via `extractFirstSentence()` helper, capped at 200 chars). The full coaching text remains in the block's `coaching.summary` for the card interior.

**Files:** `src/orchestrator/tools/draft-graph.ts`

---

## Task 4: "Changes applied." Duplicate Bubble

**Root cause:** `handleDirectGraphEdit()` in `system-event-router.ts:549` returned `assistantText: 'Changes applied.'` as a separate turn after the UI auto-applied a patch. The patch card already showed "Applied."

**Fix:** Changed `assistantText` to `null`. The system context entry still records the change for LLM context. The UI already shows the visual update in the graph canvas.

**Files:** `src/orchestrator/system-event-router.ts`
**Test updates:** `system-event-router.test.ts`, `ack-timeout.test.ts` — updated assertions from `'Changes applied.'` to `null`

---

## Task 5: edit_graph Timeout / max_tokens

**Root cause:** `edit-graph.ts:1416` used `getMaxTokensFromConfig('edit_graph') ?? 16000` — the fallback was 16K tokens, far too high for patch operations. The model was generating full graph rewrites (7644 tokens, 101 seconds).

**Fix:** Reduced the hardcoded fallback from `16000` to `4000`. The config's adapter default is already 4096. An existing `MAX_PATCH_OPERATIONS` guard (configurable, default 15) already rejects oversized patches.

**Files:** `src/orchestrator/tools/edit-graph.ts`

---

## Task 6: repair_edit_graph Prompt Strengthening

**Root cause:** The repair prompt (`defaults.ts:1992-2010`) mentioned canonical fields but lacked concrete examples. The model was generating edges without `strength` objects (flat `strength_mean`, `strength_std`) and nodes with `data` wrappers.

**Fix:** Expanded the prompt (still under 2000 chars) with:
- Canonical edge format with concrete example: `{ from, to, strength: { mean, std }, exists_probability, effect_direction }`
- Canonical node fields: `id, kind, label, category` (top-level), `prior` for externals, `observed_state` for factors
- Explicit forbidden fields: `data` (as wrapper), `strength_mean`, `strength_std`, `belief`, `belief_exists`, `confidence`
- One example `add_edge` and one example `add_node` operation

**Files:** `src/prompts/defaults.ts`

---

## Changed Files

| File | Change |
|------|--------|
| `src/orchestrator/pipeline/streaming-xml-stripper.ts` | **NEW** — incremental XML envelope stripper |
| `src/orchestrator/pipeline/pipeline-stream.ts` | Wire XML stripper into streaming path |
| `src/config/index.ts` | Add `CEE_ARTEFACT_RENDERING_ENABLED` feature flag |
| `src/orchestrator/turn-handler.ts` | Artefact block suppression guard |
| `src/orchestrator/tools/draft-graph.ts` | First-sentence headline for assistant_text |
| `src/orchestrator/system-event-router.ts` | Suppress "Changes applied." bubble |
| `src/orchestrator/tools/edit-graph.ts` | Reduce max_tokens fallback from 16K to 4K |
| `src/prompts/defaults.ts` | Strengthen repair_edit_graph prompt |
| `tests/unit/orchestrator/pipeline/streaming-xml-stripper.test.ts` | **NEW** — 9 tests |
| `tests/unit/orchestrator/system-event-router.test.ts` | Update assertion |
| `tests/unit/orchestrator/ack-timeout.test.ts` | Update assertions |

---

## Test Results

- `tsc -p tsconfig.build.json --noEmit`: **Clean** (no errors)
- Streaming XML stripper: **9/9 passed**
- System event router: **48/48 passed**
- Ack timeout: **4/4 passed**
- Edit graph max ops: **3/3 passed**
- Phase5 envelope assembler: **4 pre-existing failures** (not related to these changes)
