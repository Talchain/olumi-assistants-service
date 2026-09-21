# V5 composer-liveness — who owns final tool/action-turn text (M5 finding)

Read-only mapping produced during the M5 live-state lane. **No ownership was
refactored** — this records the *current* live-path behaviour so the durable
composer / typed-edit lane (#288) and Brief 4's live honesty rail can be scoped
accurately. Pinned by
`src/orchestrator-v5/routing/__tests__/composer-liveness-ownership.test.ts`.

## Verdict: **C — MIXED / transitional**

Final `assistant_text` on a successful tool/action turn is assembled by
`composeToolCallResponse` from `orientation + confirmation + coaching`. The
`confirmation` piece is produced by the handler's `confirmation_template`
(run via `renderConfirmation` at turn-executor STEP 4 CONFIRM). Ownership splits
by handler family:

| Handler family | confirmation_template | Who authors the success text | Ownership |
|---|---|---|---|
| `set_factor_value`, `add_constraint`, `adjust_edge_strength` (mutations) | `noopHandlerConfirmationTemplate` (forwards verbatim) | The handler — **deterministic** templated copy, no LLM call | **Handler / deterministic** |
| `run_analysis` | `runAnalysisConfirmationTemplate` (locked allowlist) | Deterministic headline or a locked template; arbitrary text → fallback | **Deterministic (gated)** |
| `explain_results`, `what_would_flip`, `explain_from_structure` (explanations) | `noopHandlerConfirmationTemplate` (forwards verbatim) | The handler returns **Sonnet's validated `answer_text`** when valid | **Free LLM text can reach the wire** |

So on **mutation and run_analysis** tool-turns the success text is
composer/handler-outcome owned and deterministic. On **explanation** tool-turns,
free LLM prose can reach the wire (forwarded verbatim from the handler outcome).

## The Brief 4 STEP 6.6 gate is the reactive honesty rail

`turn-executor.ts` STEP 6.6 (`classifyStructuralClaim`, `mutation-language.ts`)
scans the FINAL composed `assistant_text` and SWAPS it to an honest decline when
it detects a high-confidence first-person structural-completion/commitment claim
AND no durable mutation committed. Its existence — operating on already-composed
text with no handler_id filter — confirms free LLM text *can* carry structural
success claims on tool-turns; the gate is the live, reactive rail. Broad /
passive / ambiguous claims are monitor-only (telemetry), deferred to #288/#289.

## Consequence

- **Mutation / run_analysis success text is composer/handler-outcome owned and
  deterministic** → for those paths #288 is the *smaller* problem; Brief 4 can
  later shrink toward non-tool turns there.
- **Free LLM text CAN emit tool-turn text on explanation handlers** → #288
  (durable composer / typed-edit enforcement) remains a **priority durable fix**
  for the explanation residual, and **Brief 4 STEP 6.6 remains the live honesty
  rail** in the meantime. The monitor-only residual (broad/passive/ambiguous
  claims) is owned by #288/#289.

Net: the answer is not a clean "all composer-owned" — it is **mixed**, so the
durable composer/typed-edit work stays on the priority list, scoped to the
explanation-handler passthrough, while the deterministic mutation path is already
handler-owned.
