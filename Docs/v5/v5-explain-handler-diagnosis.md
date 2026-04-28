# V5 explain_results / what_would_flip — diagnosis and v40 deployment

**Branch:** `claude/v5-explain-handler-fix` (off `origin/staging` HEAD `6a9d7369`)
**Date:** 2026-04-28
**Author:** Claude (Opus 4.7, supervised by Paul)
**Status:** Diagnosis complete. v40 prompt deployed. No code fix applied — root cause is prompt-side and v40 addresses it directly.

---

## Part 1: v40 deployment

**Status:** Committed locally as `9f4abfa3` on `claude/v5-explain-handler-fix`. Not pushed.

**Files changed (Part 1 only):**

| File | Lines | Change |
|---|---|---|
| `Prompts/v40.txt` | +561 (new) | Copied from `v39.txt` then six surgical edits applied (see below) |
| `src/orchestrator-v5/routing/prompt-loader.ts` | +4 / -4 | `ROUTING_PROMPT_VERSION` `'v39' → 'v40'`; default path `Prompts/v39.txt → Prompts/v40.txt`; two doc comments updated |
| `src/orchestrator-v5/routing/__tests__/prompt-loader.test.ts` | +3 / -3 | Test expectations updated to `'v40'` and the new path |

**Six v39 → v40 prompt deltas (verified line-by-line against v39.txt):**

1. `<META>` — `prompt_version: v39 → v40`
2. `<RUNTIME>` Explanation block — added: *"Never emit a tool call for an explanation handler unless your natural text already contains the complete answer."* (This is the change that targets Test D / Test F.)
3. `<HANDLERS>` `edit_graph` — added: *"or value change (increase/set/reduce a factor value)"* in the description.
4. `<HANDLERS>` `explain_from_structure` — added: *"When the user names a specific factor, target the goal and reference the named factor in your answer."* (Targets Test E factor-targeting validator rejection.)
5. `<ENTITY_RESOLUTION>` — *"clarify with all candidates"* → *"clarify with the 2-3 most plausible candidates"*.
6. `<STYLE>` — added: *"When context provides display-ready values, prefer them over raw decimals"*.

**Why six instead of the two summarised in the brief:** the document Paul provided contains all six. The brief's two-bullet summary was a partial enumeration; I diffed v39.txt against the provided document and applied every actual delta.

**Why I did not paste the document verbatim:** it contained UTF-8 mojibake (`â` characters where em-dashes are present in v39.txt — e.g. in the `<STYLE>` "OLUMI VOCABULARY" bullets). Starting from v39.txt and applying only the six semantic edits preserves correct encoding and matches authorial intent.

**Verification:**
- `npx tsc -p tsconfig.build.json --noEmit` — clean.
- `npx vitest run src/orchestrator-v5/routing/__tests__/prompt-loader.test.ts` — 7 passed, 1 skipped (the dist-bootstrap test, which only runs after `pnpm build`).
- Prompt size: v40.txt = 21,443 bytes (within `EXPECTED_SYSTEM_CHARS_MIN..MAX` = 18,500..22,000). v39 was 21,059.

---

## Part 2: DB-first diagnosis

**Project:** `Olumi` (Supabase project `etmmuzwxtcjipwphdola`, schema `public`).
**Scenario:** `97edece8-16d2-4785-88d7-93b10943022e` (latest pre-this-investigation scenario containing all three of `run_analysis`, `explain_results`, and `what_would_flip` — verified to be the v39 verification scenario by handler set and recency).

### Turn sequence

```
21:08:59  direct_answer       (no handler)         32.3 s   1 LLM call    — initial draft turn
21:09:09  handler             run_analysis         9.6  s   1 LLM call    — chip-click analysis
21:09:14  handler             explain_results      4.3  s   1 LLM call    — Test D
21:09:20  handler             what_would_flip      5.8  s   1 LLM call    — Test F
21:09:30  handler             run_analysis         9.9  s   1 LLM call
21:09:37  handler             explain_results      6.3  s   1 LLM call
```

(Source: `v5_conversation_turns` filtered by `scenario_id`, ordered by `created_at`. Schema does not store `response_text` / `assistant_text` server-side.)

### Handler facts

```
21:09:09  run_analysis    noop=false   payload=74,504 bytes   (full V2RunResponseEnvelope persisted in result.enrichment)
21:09:14  explain_results  noop=true    payload=111 bytes      result={precondition_unmet: false, option_count: 4}
21:09:20  what_would_flip  noop=true    payload=111 bytes      result={precondition_unmet: false, option_count: 4}
21:09:30  run_analysis    noop=false   payload=74,326 bytes
21:09:37  explain_results  noop=true    payload=111 bytes      result={precondition_unmet: false, option_count: 4}
```

(Note: `precondition_unmet` lives at `payload->'result'->>'precondition_unmet'`, not top-level; the handler persists `{result, fact_type, fact_version}` and the row's `noop` column captures the wrapper's `noop` field.)

### Decisive interpretation

**Test D — explain_results stub `"Here is what the analysis shows."` (32 chars):**

- Precondition check: passed. The handler took the happy path. `payload.result.precondition_unmet === false`.
- Therefore the 32-char output is `SAFE_FALLBACK_ASSISTANT_TEXT` from [explain-results.ts:57-58](src/orchestrator-v5/tools/handlers/explain-results.ts#L57-L58), returned only when `invocation.orientationText.trim() === ''` ([explain-results.ts:109-111](src/orchestrator-v5/tools/handlers/explain-results.ts#L109-L111)).
- Conclusion: **Sonnet emitted a bare `tool_use` block with no text blocks before it.** `joinedText` from [route-with-tool-use.ts:454-470](src/orchestrator-v5/routing/route-with-tool-use.ts#L454-L470) was empty; the handler returned the documented fallback; the composer surfaced only the fallback. This is exactly the failure mode the v40 RUNTIME edit was authored to prevent.

**Test F — what_would_flip ~128-char text + `analysis.staleness_reason` flag:**

- Precondition check: passed. `payload.result.precondition_unmet === false`. Handler took the happy path, NOT the analysis-absent branch.
- The brief's characterisation of "128-char `buildAnalysisAbsentTemplate` output" was incorrect: that template for `option_count = 4` is ~143 chars (or ~144 in the `needs_setup` variant), and is only emitted when `precondition_unmet === true`. Neither matches.
- The `what_would_flip` happy-path fallback is `'Here is what could change the outcome.'` = 38 chars. Also does not match 128.
- Conclusion: the ~128 chars on Test F was **Sonnet's actual narration** (the empty-orientation fallback would have been 38 chars, not 128). Sonnet narrated, but only briefly. Same upstream symptom as Test D: Sonnet treated the explanation handlers as mutation-style routing surfaces instead of writing the full answer in natural text. The v40 RUNTIME edit is the targeted fix.

**Staleness flag — `analysis.staleness_reason` present before any graph edit:**

- Source: [turn-executor.ts:455-463](src/orchestrator-v5/turn-executor.ts#L455-L463). When `options.analysisState` is undefined, the executor rebuilds analysis from `prior_facts` and stamps `FALLBACK_STALENESS_REASON = 'loaded_from_prior_run_freshness_unknown'` ([context/analysis-fallback.ts:48](src/orchestrator-v5/context/analysis-fallback.ts#L48)).
- The UI did not echo `analysis_state` on Test F's request body (per memory, the UI client cache is the canonical store; only echoed on chip-click turns).
- Conclusion: **expected behaviour, not a bug.** The staleness flag means "this analysis projection is reconstructed from a prior `run_analysis` fact; freshness against the current graph is unproven." It will fire on every conversational follow-up turn until either (a) the UI starts echoing `analysis_state` forward, or (b) the server adds a graph-hash freshness check. Neither is in the scope of this fix. The flag itself is an honest signal Sonnet's prompt is told to acknowledge.

### Why DB was sufficient — no probes needed

The two `precondition_unmet: false` rows answered the central question of Part 3 without needing instrumentation. Specifically:

- If the precondition had failed, the handler would have returned `buildAnalysisAbsentTemplate(...)` with `suppress_orientation: true`, and `payload.result.precondition_unmet` would have been `true`. It is not.
- That single fact rules out every storage / loader / persistence hypothesis (D, E in the brief's table) and pins the cause squarely at "orientation text from Sonnet was empty / underweight at the routing layer".
- The brief's instruction was: "Report DB findings before proceeding to code instrumentation. The DB queries may answer everything without needing probes." They did.

---

## Part 3: Code instrumentation — skipped

Not executed. Part 2's DB findings were decisive and would have forced any probe to confirm the same conclusion. No diagnostic code was added; no temporary commits exist on the branch beyond the v40 deployment.

---

## Part 4: Fix outcome

**No code fix applied.** Root cause is prompt-side and v40 addresses it directly:

| Symptom | Root cause | Mitigation |
|---|---|---|
| Test D 32-char stub | Sonnet emits bare `tool_use` for `explain_results`; `orientationText` empty; handler returns documented fallback | v40 RUNTIME: *"Never emit a tool call for an explanation handler unless your natural text already contains the complete answer."* |
| Test F ~128-char brief narration | Same shape as Test D, slightly less severe (Sonnet narrated but briefly) | Same v40 edit |
| `analysis.staleness_reason` after no graph edit | UI doesn't echo `analysis_state` on follow-up turns; server falls back to prior facts and stamps unknown-freshness | Expected behaviour, not a bug. No change. |
| Test E (factor-target validator rejection — out of brief scope but covered) | Sonnet was targeting `kind: factor` for `explain_from_structure` | v40 HANDLERS.explain_from_structure: *"When the user names a specific factor, target the goal and reference the named factor in your answer."* |

The brief's decision rules ("fix only if all of: <30 lines, no v40 prompt change, no compose restructure, unit-testable") would have ruled out any handler-side code edit even had I been tempted. The handlers are correctly implemented as pass-throughs; the contract was always "Sonnet writes the full answer". v40 makes that contract explicit and unambiguous.

---

## Verification plan (post-deploy, not run yet)

After this branch is pushed and the staging Render service restarts on v40, replay the v39 verification scenario (or a fresh equivalent) and confirm:

1. `explain_results` turn for "Why is the leading option winning?" returns Sonnet's full structural+result narration as `assistant_text`, not the 32-char fallback. DB row will still show `precondition_unmet: false`, `noop: true` — that part is correct and unchanged.
2. `what_would_flip` turn for "What would need to change for X to win?" returns substantive narration covering sensitivity / robustness, not a brief sentence.
3. `analysis.staleness_reason` continues to appear when the UI omits `analysis_state` (this is correct).
4. `explain_from_structure` for "How does <factor> affect this decision?" no longer 4xx-rejects on entity-kind mismatch; Sonnet targets the goal and references the named factor in prose.

If after v40 deployment Test D / Test F still show fallback text, the next investigation step is either (a) Anthropic API tool-use behaviour (some configurations yield tool-use without text blocks regardless of system prompt instruction), or (b) `tool_choice` settings on the routing call — both out of scope for this branch.

---

## Files changed (whole branch summary)

| File | Status | Lines | Purpose |
|---|---|---|---|
| `Prompts/v40.txt` | new | 561 | v40 prompt body — six surgical edits over v39 |
| `src/orchestrator-v5/routing/prompt-loader.ts` | modified | +4 / -4 | Version constant + default path + doc comments |
| `src/orchestrator-v5/routing/__tests__/prompt-loader.test.ts` | modified | +3 / -3 | Test expectations updated |
| `Docs/v5/v5-explain-handler-diagnosis.md` | new | this file | Diagnosis report |

**Test count touched:** 1 file, 7 passing tests (1 skipped — dist-bootstrap, unchanged).
**Staging-vs-test verification:** local tsc + vitest only. Staging replay must wait for push + Render restart (out of scope per "commit locally only").
**No DB writes or migrations.**

---

## Commits on `claude/v5-explain-handler-fix`

```
9f4abfa3  feat(v5): swap routing prompt v39 → v40 — strengthen explain handler text + edit_graph value-change copy
6a9d7369  feat(v5): swap routing prompt v38.2 → v39 — adds explanation-handler routing guidance   ← branch base (origin/staging)
```

A second commit will land for this report itself.
