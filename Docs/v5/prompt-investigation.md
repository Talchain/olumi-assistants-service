# V5 prompt and context-assembly investigation

**Date:** 2026-04-23
**Branch:** `claude/v5-golden-path-completion`
**Scope:** Answer whether the generic follow-up response quality ("this is a great coaching moment, let's think beyond the three options") is caused by missing context, bad prompt instructions, or both.

This is an investigation document. No prompt rewrites are included — by design, those are owned elsewhere per the CEE brief hard scope.

---

## Prompt source

- **Source:** hardcoded constant `ROUTING_SYSTEM_PROMPT` in [src/orchestrator-v5/routing/route-with-tool-use.ts:131](src/orchestrator-v5/routing/route-with-tool-use.ts#L131).
- **Length:** ~1,000 chars (~250 tokens). Matches the `system_chars: 1000` the brief observed.
- **Delivery:** passed as Anthropic `system:` parameter on every routing call at [route-with-tool-use.ts:290](src/orchestrator-v5/routing/route-with-tool-use.ts#L290). Repair-once retries reuse the same system prompt verbatim.
- **Not loaded from:** PMS, prompt files, or any external system. It is a literal TypeScript string constant.

### What the prompt contains (complete inventory)

```text
You are Olumi's routing layer. You receive a ContextPack and a user turn.
Your single job is to decide the intent:

- Call the olumi_action tool with intent_class="execute" when an action is needed.
- Call the olumi_action tool with intent_class="clarify" when the turn is ambiguous and you cannot safely act.
- Respond with plain text (no tool call) for conversational turns.
- Call the olumi_action tool with intent_class="coach" to mark the turn as coaching — the user-facing text you emit alongside is the coaching response.

Rules:
- When calling the tool on execute turns, you may accompany it with SHORT pre-action orientation text (context, not outcomes). Never narrate results you have not seen.
- When resolving entities, cite which ContextPack fields you used in cited_context_fields.
- When the user's request is ambiguous (entity, parameter, intent, scope, or missing context), prefer clarify over a guessed execute.
- Do not invent entities or parameters not present in the ContextPack.
```

### What the prompt does NOT contain

- No handler descriptions (no listing of `run_analysis` semantics, no descriptions of which handlers exist).
- No coaching-quality instructions (no guidance on what "good" coaching text looks like, no tone, no grounding requirements).
- No stage-specific behaviour rules (frame/analyse/decide/review not mentioned).
- No examples (few-shot, format, or otherwise).
- No user-facing style rules (no "reference specific options", no "quote factors from the analysis", no "ground in the goal").
- No instructions about how to handle post-analysis follow-ups specifically.
- No coaching-mode definitions despite the prompt referencing coaching mode (reframe, challenge, deepen, summarise live in the tool schema only).

---

## Anthropic request payload — actual shape

Reconstructed from the code path without running the LLM (the codebase has no hard dependency on a network call to inspect this):

- `system` — the hardcoded `ROUTING_SYSTEM_PROMPT` verbatim. Always the same.
- `messages` — exactly one user-role message on the first call:
  - role: `user`
  - content: a single `string` (not blocks) built by [buildUserMessage()](src/orchestrator-v5/routing/route-with-tool-use.ts#L429):
    ```
    ## ContextPack
    <JSON.stringify(contextPack, null, 2)>
    
    ## User turn
    <payload.message>
    ```
- `tools` — `[OLUMI_ACTION_TOOL]` (one tool).
- `tool_choice` — `{ type: 'auto' }`.
- `temperature` — `0`.

**Repair-once retry** adds an `assistant` message with the failed tool_use and a `user` message with a `tool_result` block explaining the Zod failure. On repair, `message_count` becomes 3; first-call paths are 1.

### Where the graph, analysis, and coaching context live

Every piece of decision context goes into the ContextPack that is JSON-serialised into the user message. The ContextPack shape is defined at [context-pack-assembler.ts:91](src/orchestrator-v5/context/context-pack-assembler.ts#L91) and carries:

- `stage` — frame / analyse / decide / review
- `graph` — full nodes/edges plus kind-partitioned `options[]`, `goals[]`, `constraints[]` plus `counts`
- `analysis` — `ContextPackAnalysis` with `status`, `leading_option`, `runner_up`, `robustness_band`, `top_drivers[]`, `fragile_edges[]`, `staleness_reason`
- `conversation` — last 5 turns with turn_class + handler_id + created_at
- `coaching` — draft_coaching + decision_review from prior run_analysis
- `parsed_quantities` — CQE extractions
- `compound_detected` / `compound_segments`

All fields flow through as JSON. No field is elevated to the system prompt.

---

## Token budget breakdown (follow-up turn with ~10-node graph + analysis)

| Component | Estimated tokens | Source |
| --- | --- | --- |
| `system` (ROUTING_SYSTEM_PROMPT) | ~250 | hardcoded string |
| Tool schema (olumi_action JSON schema) | ~1,800 | [tool-schema.ts:35](src/orchestrator-v5/routing/tool-schema.ts#L35) (nested action + entity + parameters + candidates) |
| User message: ContextPack JSON | ~6,000–7,000 | JSON.stringify(pack, null, 2) with full nodes/edges/options/goals/analysis |
| User message: user turn text | ~20–50 | payload.message |
| **Total input_tokens** | **~8,100–9,100** | matches observed 9,400–10,100 |

**Conclusion:** the 9,400 input_tokens the brief observed is NOT the system prompt growing — it is the ContextPack JSON filling the user message. The graph + analysis data IS reaching Sonnet.

---

## Diagnosis

Given that the data IS present but responses are generic, the root cause is NOT missing context. It is split across two compounding issues:

### 1. The prompt is routing-focused, not quality-focused

The prompt instructs Sonnet to pick an intent class, optionally emit short orientation text, and forbids hallucinating entities. That is a classification prompt. It contains zero instructions for generating grounded coaching text:

- No rule to reference the goal by label
- No rule to reference options by label
- No rule to ground coaching in `analysis.top_drivers` or `analysis.leading_option`
- No rule to cite specific factors when reasoning about trade-offs
- No rule to match the user's framing (e.g., if the user asks "which option is best and why", a coaching turn should ground in `leading_option` + `top_drivers`)

Sonnet defaults to generic coaching because the prompt rewards being terse and safe, not being specific.

### 2. Context is present but not salient

The ContextPack is dumped as a single pretty-printed JSON blob under `## ContextPack`. Sonnet must:
1. Scan ~7,000 tokens of JSON
2. Locate the specific fields relevant to the user's question
3. Synthesise them into grounded text

This works for short questions with strong cues ("run analysis" → obviously call `run_analysis`). It's weak for open-ended follow-ups because:

- No field ranking — `graph.edges[17].weight` sits at the same depth as `analysis.leading_option`
- No natural-language summary — the model sees `top_drivers: ["fac_churn_x7", "fac_retention_q2"]` and has to infer that these are the drivers rather than seeing "Top drivers: Churn risk, Q2 retention uplift"
- No handler-hint projection — if the user asks about trade-offs, there's nothing in the prompt that tells Sonnet "the analysis block in the ContextPack has the data to answer trade-off questions"

### What is NOT the problem

- Missing context (ruled out above — 9,400 input_tokens proves the data is reaching the model)
- The tool schema hiding handler IDs — Sonnet has open latitude via `handler_id: string` and is fine proposing actions; the quality issue is the TEXT it emits alongside, not the tool call itself
- Temperature=0 (temperature=0 isn't causing genericness; a quality-tuned prompt at temp=0 would still ground in specific data)

---

## Recommended next step

Both a prompt rewrite and context restructuring are warranted, but the prompt rewrite should come first because it's cheaper to iterate on and will unblock quality evaluation of the existing ContextPack shape. Specifically:

1. **Prompt rewrite** (owned by project architect per brief hard scope). The new prompt needs:
   - Explicit rules for grounding coaching text in specific ContextPack fields (cite the goal label, cite option labels, cite `top_drivers` when discussing trade-offs).
   - A small number of few-shot examples showing grounded vs generic coaching text.
   - Clear instruction that follow-up turns post-analysis should reference the analysis results (at minimum `leading_option`, `top_drivers`, or `fragile_edges`).
   - Retained classification rules (keep the existing intent-class logic — it is fine).

2. **Context restructuring** (deferrable until after prompt rewrite is evaluated). The ContextPack could surface a pre-built natural-language summary field (e.g., `context_summary: "Goal: Increase Q2 revenue. Options: Plan A (leading, 72% win probability), Plan B (28%), Plan C (eliminated). Top drivers: Churn risk, Q2 retention uplift."`) alongside the raw structured fields. This would reduce Sonnet's "scan the JSON" overhead without losing the underlying data. Not needed if a prompt rewrite alone gets response quality to the bar.

The prompt rewrite alone is likely sufficient for the brief's golden-path bar. Context restructuring is a longer-horizon optimisation.

---

## What was changed in this branch (for completeness)

No prompt content was modified. Only scope changes in this branch are to Task 1 (unsupported-action fallback) and the evidence pack (Task 5). The investigation above is purely descriptive.
