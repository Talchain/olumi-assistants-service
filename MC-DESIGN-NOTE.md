# MC lane (Model Compiler) — progress

Session started 6 Oct 16:33Z, fresh. Clone `~/olumi-work/mc-cee`, branch `mc/brief-factor-review-boundary` at CEE staging `692fb96e91bcdc3082b28ba4be2b6e15ec28de45` (= `gh api`, 16:34Z). Nothing pushed.

## State (6 Oct 16:50Z)
- **Item 1 = brief → factor-review boundary** (addendum + PL 6020583623 + DL 6020890223). The launch prompt's "C1 #2678 design note" is stale: C1 stays PARKED.
- **DL RULED 16:4xZ: build C** as one CEE HIGH PR. Press item first, words exactly "The result moves most with '<factor>'. A question to test it: <question>"; rank only, no elasticity figure; the question is model-relative and never asserts the factor's value. Rows: RED at base · OpenAI-policy row (provider asserted) · no-sensitivity control (nothing served, no call) · cold-reload row. Enumerate every reader/writer of the Run field at lease time. Codex builds from my brief.
- **⛔ STOPPED on the DL's own stop condition (16:50Z): staging extraction resolves to ANTHROPIC.** Render env read (read-only, 126 keys, paginated): `CEE_MODEL_EXTRACTION=claude-sonnet-5`; `LLM_PROVIDER` unset (code default `openai`, `config/index.ts:604`); `models.ts:329-331` registers `claude-sonnet-5` as `anthropic`; `extraction.ts:441-454` switches provider to the model's. So C as ruled is refused before network on staging (`extraction.ts:307`) and serves nothing. **WAITING on the DL:** (i) per-call OpenAI model on the agent-lane call only (my default: `gpt-4.1-2025-04-14`, the checked-in extraction default, registered `openai` at `models.ts:138`; no env change, `/assist/v1/review` byte-identical), or (ii) the DL changes the env.
- Other env facts read at the same time: staging CEE `CEE_SEND_BRIEF_TO_PLOT=true`, `CEE_MODEL_DECISION_REVIEW=claude-sonnet-5`, `AGENT_LANE_ENABLED=true`; staging PLoT `DECISION_REVIEW_ENABLE=1`, `CEE_BASE_URL=https://cee-staging.onrender.com`. **So the addendum's "Anthropic-backed" is RIGHT on staging; the "Correction" paragraph below holds only for the checked-in defaults.** And M2 would switch on the moment the brief crossed.
- Untracked probe row in the clone: `tests/integration/mc-probe.factor-review-wire.test.ts` (2/2 pass at 692fb96e; becomes a RED row if option C is built).
- PLoT clone for line refs: `/private/tmp/mc-plot-1791304456-70678` @ `0f21df07b3ff74fbde6e0aedb65899adae6d9bd7`. Delete after the ruling.

---

## DESIGN NOTE 1 — brief → factor-review boundary (6 Oct 16:45Z)

**Verdict: do not build the brief carry. Sending the brief to PLoT restores no factor review.** The chain is broken at five hops; the brief gate is only the first, and the factor enricher never reads the brief.

### What is proven (heads: CEE `692fb96e`, PLoT `0f21df07`, DGAI `a8c07268`; all = `gh api` this session)
| # | Hop | Finding | Evidence | Rung |
|---|---|---|---|---|
| 1 | CEE → PLoT | Brief is withheld under the Agent's provider policy | `run-analysis.ts:1206` | code read |
| 2 | PLoT → CEE request | Factor-review body is `{brief, graph}` only. PLoT's own test pins "no `factor_sensitivity`" | `cee/client.ts:384-405`; `tests/cee-factor-review.test.ts:71-79` | code read |
| 3 | CEE review route | Writes `factor_enrichments` only when `robustness_data.factor_sensitivity` is present. The enricher has 0 mentions of "brief" (contrast: 37 of "sensitivity") | `assist.v1.review.ts:429-471`; `services/review/enrichFactors.ts` | **TESTED** (probe, below) |
| 4 | CEE → UI and → Agent | `factor_enrichments` is not in the 19-key transport keep-list (contrast present: `decision_brief`, `factor_sensitivity`) and is skip-listed for the Agent's context | `compose.ts:810-975`; `enrichment-manifest.ts:473` | code read |
| 5 | UI | The v5 mapper never maps it (0 hits; contrast `factor_sensitivity` 15). Only reader: `useResultsSectionData.ts:3160` → `DriversSection.tsx:520`; whether that surface is mounted on staging is UNVERIFIED | DGAI `src/v5/mapV5AnalysisToReport.ts` | code read |

**Probe row (hop 3), 1 file, 0 LLM, load 13:** PLoT's exact body posted to `/assist/v1/review?schema=v2` → `200`, no `factor_enrichments` key, **0** extraction calls. Contrast, same body + one `robustness_data.factor_sensitivity` row → **1** extraction call. So the leg returns nothing on any lane, brief or no brief. (Served `enrichment_count` on a brief-carrying Run: UNVERIFIED, needs Render logs.)

### What sending the brief WOULD switch on
- PLoT's M2 decision review (`run.ts:9908-9953`), if PLoT's `DECISION_REVIEW_ENABLE` is on (UNVERIFIED; not in `render.yaml`). Its `narrative_summary` becomes the `decision_brief` headline (`assembly/decision-brief.ts:321-323`), and `decision_brief` IS transported.
- That is an LLM-written headline, from prompt defaults that contain "best outcome" 6 times (`src/prompts/defaults.ts`; which prompt: per founder-trace Q5, UNVERIFIED by me), on a second blocking LLM call inside the Run.
- This is the Q5 / F1 seam (decision review on the agent lane), not factor review.

### Correction to the brief's premise
- "Anthropic-backed": checked-in defaults route both legs to `gpt-4.1` (`model-routing.ts:296`, `:335`). The #1749 problem is that a callback is a new HTTP request outside the policy and off `_provider_calls`. Effective staging env (`LLM_PROVIDER`, `CEE_MODEL_EXTRACTION`, `CEE_SEND_BRIEF_TO_PLOT`): UNVERIFIED.

### Options
- **A. Literal: carry brief + policy across the callback** (CEE + PLoT, 2 HIGH PRs). Result: PLoT logs `brief_present:true`; factor review still returns nothing (hop 3); M2 switches on. **INERT for factor review. Not recommended.**
- **B. Make PLoT's factor review real:** A + PLoT sends sensitivity (flip its pinned row) + CEE keep-list + UI mapping. 3 repos, 4–5 PRs, and the brief is still unused by the enricher.
- **C. CEE-only pull-through, 1 HIGH PR (RECOMMENDED).**
  - **Producer:** after PLoT returns on an agent-lane Run, CEE calls its existing `enrichFactors(graph, factor_sensitivity)` in-process. CEE already holds the authoritative brief, the canonical graph and the result.
  - **Provider policy:** the call runs inside the turn's `OPENAI_ONLY` scope, so `extraction.ts:250` asserts OpenAI and writes the ledger row; any other provider is refused before network. No header, no callback. The brief gate stays shut, so M2 stays off.
  - **Contract / write:** the existing `factor_enrichments[]` key on the Run's persisted enrichment (already manifest-listed). No new fact type, no migration, no schema bump.
  - **Consumer / words:** ONE challenge per Run, on the rank-1 driver, as a press item: **"The result moves most with ‘<factor label>’. A question to test it: <confidence question>"**, plus up to two "Another way to see it: <perspective>" lines. Every string through the #2660 egress ladder (named in founder-trace F1; its entry point is the first thing the build reads). Press module: `agent-lane/decision-review-press.ts`, wired from `agent-v1-turn.ts`.
  - **Reload:** same words from the persisted enrichment, 0 LLM calls.
  - **Product test:** it points the team at the assumption their result depends on most and asks them to test it. It names no option and gives no answer.
  - **Input exists:** 94 of 97 banked served runs carry `factor_sensitivity`, all 94 with ≥1 row on a factor the enricher covers (97/97 graphs have an option→factor edge).
  - **PLoT side:** no change. `run.ts:9567-9575` keeps logging `no_brief`; the PR says so.

### Rows for C (RED first; one mutant per claim)
1. Agent-lane Run with sensitivity → enrichment carries `factor_enrichments` for the rank-1 factor; the press item quotes its question; ledger has 1 `extraction.openai` row and 0 anthropic.
2. Control: provider not allowed → refused before network, Run result byte-identical to today, no item.
3. Control: Conventional lane byte-identical (no call).
4. Enricher fails or times out → Run unaffected (time-boxed, non-blocking).
5. Reload → same words, 0 LLM.
6. Egress: a planted "best" / "recommend" / raw elasticity figure is dropped.
7. The probe row above flips to pin PLoT's callback as still empty (documents why the fix is in CEE).

### Class enumeration (every reader / writer)
- **Brief readers in PLoT:** `run.ts:9523-9524` (log) · `:9564` (legacy review) · `:9567-9568` (factor review) · `:9911` (M2 gate) · `:9953` (M2 input).
- **`factor_enrichments` writers:** CEE `assist.v1.review.ts:559`; PLoT `run.ts:4987` (always absent today).
- **`factor_enrichments` readers:** CEE `enrichment-manifest.ts:128/473/534`; DGAI `useResultsSectionData.ts:3160` → `DriversSection.tsx:520`.
- **Policy choke points:** `openai.ts`, `anthropic.ts`, `extraction.ts`, `agent-v1-turn.ts:4131` (the only `runWithProviderPolicy`).

### Expected gain
- Construction arm: 0 (not a construction change). System 4: one stranded science capability taken from never-computed to rendered and actionable.

### Questions
- **DL-1:** A, B or C? (default C)
- **DL-2:** surface for C: press item, CEE-only (default) — or the Results panel (needs the keep-list + a DGAI mapping PR)?
- **DL-3:** pre-build env read on Render: staging CEE `LLM_PROVIDER` / `CEE_MODEL_EXTRACTION`. If extraction resolves to Anthropic there, C is refused by the policy and serves nothing.
- **Science-1:** the enricher prompt tells the model to quote ISL elasticity ("elasticity 0.62"). Default: drop the figure at projection and say rank only. Is the elasticity sayable?
- **Owner check:** founder-trace F1 (agent-lane challenge review) covers the M2 half; no owner found on #87 since 14:00Z. C does not touch it.
