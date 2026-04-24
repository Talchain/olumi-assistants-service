# V5 Resilience Contract

**Version:** 1.0 (Phase 1 of V5 alpha hardening)
**Date:** 2026-04-24
**Author:** Claude (Opus 4.7, 1M context)
**Branch:** `claude/v5-alpha-hardening`

---

## Purpose

Single source of truth for how V5 handles validator outcomes, handler preconditions, and external contract fields. This document governs failure handling from here — every Phase 2 edit is a row in this table.

**The three principles, restated for quick reference:**
1. Deterministic layer is a safety net, not a cage. Recoverable by default.
2. Permissive accept, strict emit.
3. Observable by default.

**Decisions locked in with Paul:**
- All 7 validator error codes are recoverable. Fatal reserved for infrastructure faults.
- `v5_journey_id` = `payload.scenario_id` (alias, no new UUID).
- No schema extensions to `RunAnalysisHandlerFactSchema` for partial status — surface caveats via existing fields only.

---

## Part A — Validator error codes

Every code returns HTTP 200 with a product-voice coaching response, committed as a `direct_answer` turn via `commitDirectAnswer`. The existing HANDLER_NOT_FOUND recovery path at [turn-executor.ts:573–630](../../src/orchestrator-v5/turn-executor.ts#L573-L630) is the template. Phase 2.2 generalises it via a `Record<ValidationErrorCode, ComposerFn>` map with exhaustiveness check; an impossible-state safety net keeps the 500 path for any code missing from the map at runtime.

| code | recoverable | response_template (composer) | contract_owner |
|---|---|---|---|
| `HANDLER_NOT_FOUND` | yes | `composeUnsupportedActionResponse` (existing, [compose/unsupported-action-response.ts](../../src/orchestrator-v5/compose/unsupported-action-response.ts)) | CEE |
| `ENTITY_KIND_MISMATCH` | yes | new `composeKindMismatchResponse` — coaching keyed on `resolved_kind` / `accepted_kinds`. Copy: "`{safeLabel(entity)}` is a `{resolved_kind}` in your model. Running analysis needs an option to compare against. `{next-step prompt}`." Emits conversational chip, not executable. | CEE |
| `PRECONDITION_UNMET` | yes | new `composePreconditionUnmetResponse` — copy keyed on `details.reason`. Today the only reason is `no_options_defined`: "Before running analysis, add at least one option to this decision. I can help you sketch option sketches." Emits conversational chip. | CEE |
| `ENTITY_NOT_FOUND` | yes | new `composeEntityNotFoundResponse` — copy: "I can't find `{safeLabel(entity)}` in your model." Falls back to `entity.kind` phrasing via `safeLabel` when label is absent. Lists available entities of the same kind as chips (capped at 3). | CEE |
| `ENTITY_RESOLUTION_AMBIGUOUS` | yes | new `composeResolutionAmbiguousResponse` — copy: "I see a few things called `{label}`. Which one did you mean?" Renders `details.candidates[]` as clarify chips. | CEE |
| `ENTITY_RESOLUTION_SUSPICIOUS` | yes | new `composeResolutionSuspiciousResponse` — copy: "Did you mean `{closer_candidate.label}` instead of `{chosen.label}`?" Two confirm/deny chips. | CEE |
| `PARAMETER_INVALID` | yes | new `composeParameterInvalidResponse` — copy: "I need `{describeSchema(constraint)}` for `{parameter}`, not `{sanitised_value}`." Conversational chip with a corrected-example prompt. | CEE |

Every composer reuses [compose/helpers.ts](../../src/orchestrator-v5/compose/helpers.ts) `sanitiseForUser`, `safeLabel`, and `describeSchema`. All `assistant_text` output must pass a per-composer unit test asserting absence of internal terms: `ContextPack`, `handler`, `validator`, `kind_mismatch`, `state_commit`, and raw internal ID prefixes `opt_`, `fac_`, `goal_`, `risk_` (observed in the real staging PLoT response, Part C).

---

## Part B — Fatal conditions

Narrowly enumerated. Every fatal case returns HTTP 500 with a typed `BoundaryError`.

| fatal condition | cause | where raised |
|---|---|---|
| DB write failure inside `commitDirectAnswer` | Supabase RPC `append_turn_atomic` returns error, or non-string id | [supabase-store.ts:73–112](../../src/orchestrator-v5/session/supabase-store.ts#L73-L112) throws `StateCommitFailedError` |
| Commit failure on a recoverable path | `commitDirectAnswer` throws in the Part A recovery branch | [turn-executor.ts](../../src/orchestrator-v5/turn-executor.ts) Part A handler catches and maps to `STATE_COMMIT_FAILED`. **MUST log both the original recoverable outcome AND the commit failure as separate log records** before returning 500. |
| Dispatch invariant violations | BI-01 "exactly one response" broken, `UnhandledTurnClassError`, handler registry returns undefined for a code that validator accepted | [turn-executor.ts](../../src/orchestrator-v5/turn-executor.ts) finally block + `resolveHandler` failure |
| Malformed B1-validated request | Ingress validation passed in `route-v2.ts` but TurnExecutor receives a shape it cannot dispatch | [turn-executor.ts](../../src/orchestrator-v5/turn-executor.ts) dispatch invariant |
| Impossible-state guard (Phase 2.2) | Map lookup for a `ValidationErrorCode` returns undefined at runtime (compile-time exhaustiveness broken) | Logs `assert_unknown_validation_code` at fatal level, routes through existing `composeValidationFailure` + 500 path. Cannot occur under correct compile. |
| Missing/corrupt prompt file at module init (Phase 2.1) | `readFileSync('Prompts/v38.2.txt')` throws | Module-level throw; process fails to start. Correct behaviour. |

**PLoT fatal:** `analysis_status` in {`"blocked"`, `"failed"`}, or unknown status without usable result fields. See Part C.

---

## Part C — PLoT status matrix

### Authoritative reference fixture

**Real staging response captured:** [tests/staging/artifacts/cross-service-2026-03-15T23-24-53-476Z/step-2-analysis.json](../../tests/staging/artifacts/cross-service-2026-03-15T23-24-53-476Z/step-2-analysis.json)

- **File SHA-256:** `2d2aab36a52725f516790a2dfb75144aa20512d234b562a914c33ce4784508d1`
- **Capture date:** 2026-03-15T23:24:53Z
- **Source:** cross-service staging integration artifact
- **`analysis_status`:** `"computed"` — **confirms the staging symptom the brief calls out**
- **`option_comparison`:** 3 entries, each carrying `option_id` (e.g. `"opt_1"`), `option_label` (e.g. `"Raise price to £59"`), `win_probability` (numeric, e.g. `0.347`), `id`, `label`, `outcome`, `status`. Note `outcome_mean` is `null` in this capture.
- **`winner`:** `null` — top-level winner absent; handler must derive from `option_comparison` (consistent with `selectLeadingOptionId` behaviour at [run-analysis.ts:452](../../src/orchestrator-v5/tools/handlers/run-analysis.ts#L452))
- **`meta`:** contains `response_hash`, `seed_used`, `n_samples`, latency fields
- **`response_hash`:** `27a9e6ad4d892525` (also duplicated at top level)
- **`robustness`:** populated with `level`, `fragile_edges`, `recommended_option_id`
- **`factor_sensitivity`:** 1 entry
- **Also verified:** [tests/staging/artifacts/cross-service-2026-03-15T23-23-53-861Z/step-2-analysis.json](../../tests/staging/artifacts/cross-service-2026-03-15T23-23-53-861Z/step-2-analysis.json) carries `analysis_status: "blocked"` — matches the fatal treatment.

**Derived minimum "usable result fields" contract** (verified against the above capture):
- `option_comparison[]` OR `results[]`, length ≥1
- At least one entry carrying `option_id` (string) AND `option_label` (string) AND `win_probability` (finite number)
- Top-level `winner` MAY be null — the handler MUST derive winner from `option_comparison` via `selectLeadingOptionId`

### Status matrix

| `analysis_status` | treatment | required result fields | notes |
|---|---|---|---|
| `null` (absent) | success | as above | current happy path; unchanged. Golden fixtures ([tests/fixtures/plot/v2-run-golden-*.json](../../tests/fixtures/plot/)) exercise this case. |
| `"completed"` | success | as above | current accepted value ([run-analysis.ts:316](../../src/orchestrator-v5/tools/handlers/run-analysis.ts#L316)) |
| `"computed"` | success | as above | **NEW accept in Phase 2.3.** Confirmed by staging capture above. Same downstream shape as `"completed"` — handler reads the same fields. |
| `"partial"` | success w/ caveat | as above | caveat appended to `RunAnalysisHandlerFact.result.summary` and surfaced in `assistant_text`. **Schema NOT extended.** If future PLoT schema changes require richer partial signal, reopen this contract — do not add a field in-flight. |
| `"blocked"` | fatal | — | `HandlerInvocationFailedError`, `cause_kind: 'analysis_blocked'`. Verified by the `23-23-53` capture. |
| `"failed"` | fatal | — | `HandlerInvocationFailedError`, `cause_kind: 'analysis_failed'`. |
| unknown string | degraded if usable, fatal if not | minimum usable-fields contract | log `external_contract_unknown_status` warning with `{status, response_hash, request_id, v5_journey_id}` (no raw response body); proceed as if `"partial"` when fields are usable; raise `HandlerInvocationFailedError(cause_kind: 'analysis_not_completed')` when fields are absent. |

### Consumer contract

The run_analysis handler fact shape is the authoritative consumer:

```ts
{
  fact_type: 'run_analysis',
  fact_version: 1,
  noop: false,
  result: {
    scenario_id: string,
    leading_option_id: string | null,
    win_probabilities?: Record<string, number>,
    summary: string,           // carries partial caveat when applicable
    enrichment: <full PLoT response, byte-for-byte>,
  },
}
```

Changes from current:
- Handler accepts `"computed"` + `"partial"` in addition to `null`/`"completed"`.
- When `"partial"`, `summary` gets a caveat appended (product-voice).
- `leading_option_id` may be null on a partial where no entry carries a finite `win_probability` — existing behaviour ([run-analysis.ts:469–470](../../src/orchestrator-v5/tools/handlers/run-analysis.ts#L469)).
- `enrichment` continues to be byte-for-byte pass-through — no projection, no stripping.

---

## Part D — External contract fields we emit strictly

Per principle 2: permissive accept (Part C), strict emit (here).

| field | shape source | emitter | consumer (UI) |
|---|---|---|---|
| `analysis_ready` | `AnalysisReadyPayload` from [analysis-ready-helper.ts](../../src/orchestrator/tools/analysis-ready-helper.ts) | [handlers/draft-graph-dispatch.ts](../../src/orchestrator-v5/handlers/draft-graph-dispatch.ts) + Phase 2.4 call site in compose layer | UI reads `status` for display; CEE must never fork the shape |
| `SuggestedAction` (chip) | [schemas/boundary](@talchain/schemas/boundary) `Action` | [chip-generator.ts](../../src/orchestrator-v5/compose/chip-generator.ts) | UI renders `label`, submits `message` on conversational click, submits chip_click on executable (`action_type`) click |
| `assistant_text` | compose layer | every composer | UI renders; MUST NOT contain forbidden terms per Part A |
| `turn_class` | `'direct_answer' \| 'handler' \| 'clarify'` | turn-executor | UI uses for stage-appropriate rendering |

**Chip readiness gate (Phase 2.4):**
1. Prefer pre-computed `analysis_ready` on the turn context if present.
2. Otherwise compute via `computeStructuralReadiness(graph)`.
3. If graph is absent, readiness is unknown — executable chip MUST NOT render.

Executable `run_analysis` chip emits iff `analysisReady.status === 'ready'`. `computeStructuralReadiness` already verifies: goal node present, ≥2 options, every non-baseline option has ≥1 numeric intervention. Reuse that authority rather than re-implementing the gate.

---

## Part E — Review findings (current code vs contract)

Each mismatch below becomes a Phase 2 sub-task.

| # | contract | current code | gap | Phase 2 task |
|---|---|---|---|---|
| 1 | ROUTING_SYSTEM_PROMPT = v38.2 (19,314 chars) | Hardcoded 662-char constant at [route-with-tool-use.ts:150–162](../../src/orchestrator-v5/routing/route-with-tool-use.ts#L150-L162) | Prompt not installed | **2.1** |
| 2 | Lifecycle logs carry `prompt_version`, `prompt_hash`, `system_chars`, `v5_journey_id` | Only `request_id` and `session_id` threaded | All four new fields missing | **2.5** |
| 3 | `ENTITY_KIND_MISMATCH` → 200 + `composeKindMismatchResponse` | 500 via `composeValidationFailure` at [turn-executor.ts:632](../../src/orchestrator-v5/turn-executor.ts#L632) | Recoverable path missing | **2.2** |
| 4 | `PRECONDITION_UNMET` → 200 + `composePreconditionUnmetResponse` | 500 via `composeValidationFailure` | Recoverable path missing | **2.2** |
| 5 | `ENTITY_NOT_FOUND` → 200 + `composeEntityNotFoundResponse` | 500 | Recoverable path missing | **2.2** |
| 6 | `ENTITY_RESOLUTION_AMBIGUOUS` → 200 + `composeResolutionAmbiguousResponse` | 500 | Recoverable path missing | **2.2** |
| 7 | `ENTITY_RESOLUTION_SUSPICIOUS` → 200 + `composeResolutionSuspiciousResponse` | 500 | Recoverable path missing | **2.2** |
| 8 | `PARAMETER_INVALID` → 200 + `composeParameterInvalidResponse` | 500 | Recoverable path missing | **2.2** |
| 9 | Commit-failure on recoverable path logs original + commit failure separately | Only commit failure logged at [turn-executor.ts:620–629](../../src/orchestrator-v5/turn-executor.ts#L620-L629) | Single-log gap | **2.2** |
| 10 | PLoT accepts `"computed"` | Hard match on `"completed"` only at [run-analysis.ts:316](../../src/orchestrator-v5/tools/handlers/run-analysis.ts#L316) | Permissive accept missing | **2.3** |
| 11 | PLoT accepts `"partial"` with caveat | Rejected as `analysis_not_completed` | Permissive accept + caveat surfacing | **2.3** |
| 12 | Unknown PLoT status → warn + proceed if usable, fatal if not | Rejected outright | Fallback logic missing | **2.3** |
| 13 | Chip gate: `analysisReady.status === 'ready'` + goal + option + intervention | Gate on `graphOptionCount > 0` only at [chip-generator.ts:94–100](../../src/orchestrator-v5/compose/chip-generator.ts#L94-L100) | Full readiness signal not threaded | **2.4** |
| 14 | Follow-up analysis fallback works end-to-end | `buildAnalysisFromPriorFacts` exists at [analysis-fallback.ts](../../src/orchestrator-v5/context/analysis-fallback.ts); call-site wiring unverified | Verify + fix call site if broken | **Phase 3 step 5** |

---

## Non-goals (explicitly out of scope)

- Context+compose layer changes (just deployed).
- V4 bridge code.
- Schema tarball changes.
- `route-v2.ts` dispatch logic (only additive log fields).
- UI code (separate workstream).
- Conversation history migration (separate follow-up, Task 1.1 deferred).
- Edits to the content of `Prompts/v38.2.txt`.
- Extensions to `RunAnalysisHandlerFactSchema` for partial status.
- New API surface to expose logs (Phase 3 harness captures stdout only).

---

## Acceptance

This contract is accepted when every row of Part E becomes either:
- Green in the Phase 2 commit that implements it (test + code + evidence row in the final contract commit), OR
- Flagged as a halt condition with a clear recommendation to Paul.

The Phase 3 replay harness is the end-to-end regression gate. Evidence pack: [Docs/v5/v5-golden-path-evidence-cee.md](v5-golden-path-evidence-cee.md) (produced in Phase 3).
