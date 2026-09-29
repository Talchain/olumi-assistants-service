# explain_results Response Quality Fixes — Handover

**Date:** 2026-03-27
**Branch:** fix/deterministic-routing-hardening

## Changed Files

| File | Changes |
|------|---------|
| `src/config/index.ts` | Added `CEE_EXPLAIN_QUALITY_ENABLED` feature flag (default true) |
| `src/orchestrator/tools/explain-results.ts` | Tasks 1-5 implementation |
| `tests/unit/orchestrator/tools/explain-results-quality.test.ts` | New: 27 tests for all quality fixes |
| `tests/unit/orchestrator/tools/explain-results.test.ts` | Updated chip and numeric-stripping assertions |
| `tests/unit/orchestrator/tools/explain-results-deterministic.test.ts` | Updated headline truncation threshold (120 -> 150) |

## Task 1: assistant_text / commentary separation (R8)

**Fix:** `extractHeadline()` now strips leading markdown headers (`## Heading\n`) before extracting the first sentence, and truncates at 150 chars (whichever comes first). Result never exceeds 200 chars and never starts with `#`.

**How it works:** Every return path in `handleExplainResults()` calls `extractHeadline(fullText)` for `assistantText` while the full text goes to the commentary block `narrative`. Since `extractHeadline` now strips markdown and truncates, `assistantText` will always be shorter than the narrative for any multi-sentence or markdown-headed response.

**Gated by:** `CEE_EXPLAIN_HEADLINE_ENABLED` (existing) + quality improvements are unconditional in the function itself.

## Task 2: Driver fabrication guard (R14)

**Fix:** New `buildDriverGuard(response)` function checks:
- `top_drivers` empty (factor_sensitivity array absent or length 0)
- `sensitivity_concentration` is 0, absent, or null

When both conditions are true, `buildExplanationPrompt()` injects guard text: *"Driver and sensitivity data is not available for this analysis. Do not explain which factors drive the result..."*

**Gated by:** `CEE_EXPLAIN_QUALITY_ENABLED` — guard is only computed and passed when flag is true.

## Task 3: Context-aware chips (R15 + R9)

**Fix:** `buildExplainChips()` rewritten with priority-based selection, max 3 chips:

1. If `robustness` is fragile/moderate: "Stress-test the weakest assumption" (challenger)
2. If `top_drivers` populated: "Dig into [top driver label]" (facilitator) — uses actual factor name
3. If analysis stale (graph changed): "Re-run analysis" (facilitator)
4. Fallback (none match): "What does this result mean for my decision?" (facilitator)

Hardcoded generic list removed. Chip prompts reference actual factor/option names from analysis data.

**Gated by:** `CEE_EXPLAIN_CHIPS_ENABLED` (existing, controls whether chips are included at all).

## Task 4: brief_text passthrough (R10)

**Status: Architectural gap — not fixable within explain_results scope.**

**Root cause:** `brief_text` is defined in the context-fabric `FramingSchema` (`src/orchestrator/context-fabric/types.ts`) but is **never populated** in `ConversationContext.framing`. The `ConversationContext` type doesn't even declare `brief_text` on its framing shape — code reads it via unsafe `as Record<string, unknown>` casts.

**What would be needed:**
1. Add `brief_text?: string` to `ConversationContext['framing']` in `src/orchestrator/types.ts`
2. Create a write path that populates `framing.brief_text` when:
   - The user provides a brief in the initial message
   - `draft_graph` generates one and returns it
   - Context-fabric renders it from decision state
3. Include `brief_text` in `buildDecisionState()` output in `turn-handler.ts`

This requires changes to the turn handler, context assembly, and types — all outside the constraint boundary ("explain_results tool path only").

## Task 5: [value] placeholder leakage (R17)

**Source identified:** `stripUngroundedNumerics()` (line 605) replaces ungrounded numbers with literal `[value]`. This is the numeric freehand filter working as designed — but when `briefText` is unavailable (Task 4 gap), numbers that should be grounded (from the brief) get incorrectly stripped to `[value]`, which then leaks into user-facing text.

**Fix:** New `stripPlaceholderTokens()` function runs after `stripUngroundedNumerics()` on the Tier 3 LLM path. Replaces `[value]`, `[number]`, `[X]`, `[placeholder]`, `[TBD]`, `[TODO]` with "the relevant figure" to maintain sentence readability.

**Not gated** — this is a bug fix, not a feature.

## Test Results

```
Test Files  3 passed (3)
     Tests  177 passed (177)
```

New test file: `explain-results-quality.test.ts` — 27 tests covering:
- Headline never exceeds 200 chars, never starts with `#`
- Markdown header stripping
- Driver guard present/absent in prompt based on data availability
- Chip count <= 3, context-aware selection varies by analysis state
- Placeholder tokens stripped from all user-facing text
- assistant_text != commentary narrative for Tier 3 responses

## Feature Flag Summary

| Flag | Default | Scope |
|------|---------|-------|
| `CEE_EXPLAIN_QUALITY_ENABLED` | true | Tasks 1-3 (driver guard computation) |
| `CEE_EXPLAIN_HEADLINE_ENABLED` | true | Pre-existing: controls headline extraction |
| `CEE_EXPLAIN_CHIPS_ENABLED` | true | Pre-existing: controls chip inclusion |
