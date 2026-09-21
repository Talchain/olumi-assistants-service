# Post-draft coaching — gated-hybrid composer update

**Scope.** Update layered on top of PR #207 commit [`9fd3c2b4`](https://github.com/Talchain/olumi-assistants-service/commit/9fd3c2b4) (`feat(v5/draft-graph): replace thin post-draft copy with deterministic coaching narrative`). Goal: surface the rich LLM coaching fields (`coachingSummary`, `strengthenItems`, `coachingBiasSignals`) that `draft_graph` already produces, behind a strict deterministic copy-quality gate, so the first post-draft turn carries real coaching value when the LLM output is good — and falls through to the deterministic five-sentence narrative otherwise.

## Status

PR is [#207](https://github.com/Talchain/olumi-assistants-service/pull/207) targeting `staging`. Head currently at `460d1284` plus the self-assessment commit on top (see "Round-by-round evolution" below for the commit history).

Mergeable from git perspective. The CI `Lint, TypeCheck, Unit Tests` job is red on PR #207, but it is also red on PR #205 (the most recent merge to staging) — same set of unrelated pre-existing test-file typecheck errors. Awaits Paul's baseline-CI exception OR a separate workstream to clear the inherited errors.

## Files changed

| File | Status |
|---|---|
| [src/orchestrator-v5/coaching/copy-quality-gate.ts](src/orchestrator-v5/coaching/copy-quality-gate.ts) | **new** — two-stage gate (broad candidate regex + central `isSlugShapedEntityId` confirmation), 15 reject reasons |
| [src/orchestrator-v5/coaching/__tests__/copy-quality-gate.test.ts](src/orchestrator-v5/coaching/__tests__/copy-quality-gate.test.ts) | **new** — 60+ tests covering every rejection axis and legitimate-compound positives |
| [src/orchestrator-v5/coaching/post-draft-narrative.ts](src/orchestrator-v5/coaching/post-draft-narrative.ts) | modified — widened input contract; `{ text, telemetry }` return; gated-hybrid pickers; `coachingSummary` short-circuit |
| [src/orchestrator-v5/coaching/__tests__/post-draft-narrative.test.ts](src/orchestrator-v5/coaching/__tests__/post-draft-narrative.test.ts) | modified — rebased existing tests; added gated-hybrid + coachingSummary + telemetry + decimal-handling cases |
| [src/orchestrator-v5/handlers/draft-graph-dispatch.ts](src/orchestrator-v5/handlers/draft-graph-dispatch.ts) | modified — pass new fields to builder; emit source-selection telemetry; unwrap `.text` |
| [src/orchestrator-v5/handlers/__tests__/draft-graph-dispatch.test.ts](src/orchestrator-v5/handlers/__tests__/draft-graph-dispatch.test.ts) | modified — telemetry mock; +10 wiring/negative dispatch tests; `MINIMAL_ANALYSIS_READY` fixture cast tightened |
| [src/utils/telemetry.ts](src/utils/telemetry.ts) | modified — registered `V5PostDraftCoachingSourceSelected` with full field-set doc |

10 files total in the PR diff (the 7 above plus 1 doc note (this file) and 2 from the original `9fd3c2b4` commit: `tests/integration/orchestrator/route-v2-draft-graph-persistence.test.ts` and `tests/unit/v5-journey-replay/mutation-ack-pattern.test.ts`).

## Source-selection logic

Sentence 4 ("One assumption worth checking: …") picks from a strict priority chain. The first source that passes [gateAssumptionFragment](src/orchestrator-v5/coaching/copy-quality-gate.ts) wins.

| Priority | Source | Field consumed | Telemetry label |
|---|---|---|---|
| 1a | `strengthenItems[0].detail` | full string; falls back to first-sentence slice if too long | `strengthen_item_detail` |
| 1b | `strengthenItems[0].label` | only when both `.detail` candidates fail the gate | `strengthen_item_label` |
| 2 | `analysisReady.bias_findings[*].explanation` | first acceptable element (iterates the array) | `bias_finding` |
| 3 | `coachingBiasSignals[*].detail` | first acceptable element (iterates the array) | `coaching_bias_signal` |
| 4 | `factor.observed_state.uncertainty_drivers[0]` | first driver passing the existing `validateUncertaintyDriver` grammar guard | `uncertainty_driver` |
| 5 | fixed-generic prompt | never null | `deterministic_fallback` |

`coachingSummary` short-circuits the whole pipeline: if present and it passes [gateFullResponse](src/orchestrator-v5/coaching/copy-quality-gate.ts), the summary becomes the entire `assistant_text` (no opener prepended). Telemetry label: `coaching_summary`.

`fallback_reason` distinguishes `gate_rejected` (a higher-priority candidate existed but failed) from `no_candidate` (nothing was available at all), so ops can tell rejection rate apart from coverage gaps.

## Copy-quality gate rules

Defined in [src/orchestrator-v5/coaching/copy-quality-gate.ts](src/orchestrator-v5/coaching/copy-quality-gate.ts). Pure deterministic; no I/O.

**Shared rejections** (both `gateAssumptionFragment` and `gateFullResponse`):
- empty / whitespace-only
- em dash `—` or en dash `–`
- internal-id leak: two-stage detection — broad candidate regex (`fac|opt|goal|dec|out|risk|con|factor|option|decision|outcome|constraint` + `[_:-]`) followed by [isSlugShapedEntityId](src/orchestrator/shared/output-safety.ts) confirmation (digit anywhere → ID; `fac`/`opt` short prefix → ID; multi-segment first ≥ 4 chars → ID; single-segment suffix or short-connector first segment → English compound, NOT an ID)
- graph-shape language: `\b(?:nodes?|edges?|graphs?)\b`
- named schema/service terms (substring, case-insensitive): `intervention`, `schema`, `payload`, `analysis_ready`, `model_adjustment`, `bias_finding`, `factor_id`, `node_id`, `graph_node`, `enrichment`, `envelope`
- premature recommendation (multi-pattern regex): `recommend(s|ed|ation|ations)?`, `winner`, `winning option/route/path/choice`, `best option/route/path/choice/approach`, `top option/choice/route/path`, `chosen route/option/path/choice`, `favoured/favored option/route/path/choice`, `preferred option/route/path/choice`, `(you|i) (should|would) (choose|pick|go with|select)`, `(clear|obvious) (choice|winner|favourite)`, `(strongest|most promising|leading) (option|route|path|choice)`

**Fragment-only rejections** (`gateAssumptionFragment`):
- length < 5 or > 150 chars
- trailing `.?!,;:` (the builder appends `.` itself)
- question-shaped first word (`what/why/how/when/where/which/who/is/are/does/do/can/should/would/will/could/might`), with apostrophe-`s` contraction stripped (`What's`, `Where’s` also trip)
- low letter density (< 40% letters → glyph-heavy filler)

**Full-response-only rejections** (`gateFullResponse`):
- length < 80 or > 800 chars (tightened from 1200 → 800 to align with the deterministic five-sentence budget)
- markdown / bullet / numbered-list / header formatting (`-/*/+` bullets, `N.` numbered, `#` headers)
- missing decision-framing token (decision/model/option/route/path/choice/trade-off)
- missing trade-off/gap token (trade-off/balance/risk/assume/assumption/consider/weigh/gap/unknown/uncertain/tension/constraint)
- missing next-step token (run/next/then/try/check/explore/review/inspect/validate/stress-test)

**Snake-case allowance.** Generic snake-case is NOT rejected — only the specific internal-id prefixes are, and the slug-shape heuristic filters out English compounds. So `go_to_market`, `b2b_partnership` (no matching prefix) pass; `risk_adjusted`, `out_of_scope`, `option_value`, `constraint_based`, `factor_analysis` (matching prefix but English compound) also pass.

## Telemetry

New event [`V5PostDraftCoachingSourceSelected`](src/utils/telemetry.ts) → wire name `v5.post_draft_coaching.source_selected`. Emitted by the dispatcher on every successful draft turn. Category/count only — no raw user or coaching text logged.

Payload:
```
{ request_id, scenario_id,
  assumption_source: 'coaching_summary' | 'strengthen_item_detail' | 'strengthen_item_label'
                   | 'bias_finding' | 'coaching_bias_signal' | 'uncertainty_driver'
                   | 'deterministic_fallback',
  coaching_summary_present: boolean,
  coaching_summary_passed_gate: boolean,
  coaching_summary_reject_reason: GateRejectReason | null,
  fallback_reason: 'gate_rejected' | 'no_candidate' | null,
  strengthen_items_count: number,
  bias_findings_count: number,
  coaching_bias_signals_count: number }
```

`GateRejectReason` values: `empty | too_short | too_long | em_dash | internal_id | schema_term | graph_shape | premature_recommendation | question_shaped | trailing_punctuation | awkward_grammar | markdown | no_decision_framing | no_tradeoff_or_gap | no_next_step`.

Suggested operator queries:
- "what fraction of draft_graph turns get rich LLM coaching surfaced?" — `assumption_source != 'deterministic_fallback' && assumption_source != 'uncertainty_driver'`.
- "is `coachingSummary` usable?" — pass rate = `count(coaching_summary_passed_gate=true) / count(coaching_summary_present=true)`.
- "why are summaries failing?" — bucket by `coaching_summary_reject_reason`.

## Before / after examples

All examples use the same fixture graph (goal: "Deliver Successful Launch Within Three Months"; three options; two factors).

### 1. Pre-branch THIN copy (removed by `9fd3c2b4`)
```
Your decision model for "Deliver Successful Launch Within Three Months" is ready, with 3 options and 2 factors to explore.
```

### 2. PR #207 base — deterministic five-sentence
```
I've built a first decision model for "Deliver Successful Launch Within Three Months". I'm comparing three routes: Hire a tech lead, Hire two mid-weight developers and Outsource delivery to an agency. The main trade-off centres on Leadership quality balanced against Delivery capacity. One assumption worth checking: extra developers may add coordination overhead rather than throughput. Next, run the analysis to see how the options compare and what could shift the outcome.
```
Telemetry: `assumption_source: uncertainty_driver, fallback_reason: null`

### 3. Clean strengthen.detail surfaces in sentence 4
With `strengthenItems[0].detail = 'the synergy assumption sits as a point value and warrants a 10 to 30M range to surface downside scenarios'`:
```
… One assumption worth checking: the synergy assumption sits as a point value and warrants a 10 to 30M range to surface downside scenarios. Next, run the analysis …
```

### 4. Long strengthen.detail → first-sentence slice
With a detail that ends with `.` and exceeds 150 chars whole, the picker takes the first sentence:
```
… One assumption worth checking: the synergy assumption sits as a point value. …
```
Decimal numbers in the first sentence are preserved (`"the cost ramp passes $1.5M…"` is NOT truncated to `"$1"`).

### 5. Clean coachingSummary replaces the whole response
```
The routes here weigh delivery speed against quality risk. One assumption worth checking is whether the team can absorb extra coordination overhead in the first quarter. Next, run the analysis to see how the options compare under stress.
```
Telemetry: `assumption_source: coaching_summary, coaching_summary_passed_gate: true`

### 6. Gate-rejected coachingSummary → five-sentence fires
With a summary containing `"We recommend hiring …"` or `"7 nodes and 8 edges"` or `"best route here is to…"`:
- Gate rejects (`premature_recommendation`, `graph_shape`, or `premature_recommendation` respectively).
- Five-sentence builder produces case 2 output.
- Telemetry: `coaching_summary_present: true, coaching_summary_passed_gate: false, coaching_summary_reject_reason: <reason>`.

### 7. go_to_market / b2b_partnership / risk_adjusted survive
Both legitimate user-facing labels (`go_to_market`, `b2b_partnership` — no matching prefix) and prefix-shaped English compounds (`risk_adjusted return`, `out_of_scope`, `option_value`, `factor_analysis` — slug-shape heuristic rejects them as IDs) pass the gate cleanly.

## Round-by-round evolution

| Commit | Subject | Scope |
|---|---|---|
| `9fd3c2b4` | feat(v5/draft-graph): replace thin post-draft copy with deterministic coaching narrative | original deterministic 5-sentence builder |
| `cefada9d` | feat(v5/draft-graph): gated-hybrid post-draft composer over rich LLM coaching | wires strengthen / bias / coachingSummary behind copy-quality gate |
| `1a99fa37` | test(v5/draft-graph): positive E2E for realistic coachingSummary replacing assistant_text | dispatch-level positive E2E |
| `83b1e406` | fix(v5/draft-graph): tighten gated-hybrid copy gate per PR #207 review | graph-shape, broader recommendation regex, markdown guard, reject-reason telemetry, 800-char cap |
| `460d1284` | fix(v5/draft-graph): use central slug-shape heuristic to reduce false positives | aligns gate with `isSlugShapedEntityId`; legitimate domain compounds pass |
| (self-assessment) | fix(v5/draft-graph): decimal-aware first-sentence extraction + cleanLeadIn doubled-punct + apostrophe contractions | self-review tightening of internal helpers |

## Test results

After the self-assessment fixes:

- **Unit tests, touched-file surface**: `vitest run` on the three modified test files + co-located coaching tests + dispatch tests + narration-count-guard + route-v2-persistence:
  - **15 test files, 354 tests, all passed**
  - `copy-quality-gate.test.ts` — 60+ tests, one per rejection axis plus legitimate-compound positives
  - `post-draft-narrative.test.ts` — 100+ tests including decimal-handling regression
  - `draft-graph-dispatch.test.ts` — 51 tests including 4 negative dispatch tests for realistic-shape-but-banned summaries
- **TypeScript build typecheck** (`tsc -p tsconfig.build.json --noEmit`): **0 errors**
- **Touched-file lint** (eslint on the 7 paths above): **0 errors**
- **Full `tsc --noEmit`** on touched files only: **0 errors**
- **Broader regression** (vitest `-t "post-draft|draft_graph|coaching|narrative|chip"`): ~1,071 pass, 17 fail. **All 17 confirmed pre-existing** by stash-and-rerun against `9fd3c2b4` base — same files fail without these changes.

## Residual risks

1. **LLM coachingSummary pass rate is unmeasured pre-deploy.** The full-response gate is strict. Telemetry `coaching_summary_passed_gate` + `coaching_summary_reject_reason` will surface the rate per request; tune thresholds in a follow-up if the rejection rate is unexpectedly high.

2. **Single-segment real IDs (`risk_churn`, `goal_revenue`) can pass the graph-free copy gate.** Because `isSlugShapedEntityId` operates without graph context, a real ID whose suffix happens to be a single English word slips this gate. The egress sanitiser at [output-safety.ts](src/orchestrator-v5/compose/output-safety.ts) operates WITH graph context and still rewrites these before wire. Tracked as a future improvement (let the copy gate optionally receive graph context for exact-ID confirmation). Reviewer flagged as "defence-layer boundary issue, not a blocker."

3. **`model_adjustments` is no longer a sentence-4 source.** Round-1 design explicitly dropped it from the brief. `analysisReady.model_adjustments` remains on the wire envelope; the UI can surface it separately if needed.

4. **Strengthen-item `detail` truncation strategy.** When detail is too long, the picker tries the first sentence. If the LLM emits a single 200-char sentence with no internal terminator, both candidates fail and we use `.label`. Acceptable; tightening to clause-boundary slicing is a future move.

5. **Recommendation-by-synonym** (`leading candidate`, `clearest path`, `the sensible choice`, `the route to take`). Round-3 reviewer marked as "can track unless these phrasings have appeared in staging captures". Revisit when telemetry shows them slipping through.

## CI status

The `Lint, TypeCheck, Unit Tests` job on PR #207 is failing on pre-existing test-file typecheck errors in files this PR does not touch (`src/cee/decision-review/__tests__/invoke.test.ts`, `src/orchestrator-v5/__tests__/phase3-lifecycle.test.ts`, `src/orchestrator-v5/__tests__/response-finaliser.test.ts`, `src/orchestrator-v5/handlers/__tests__/edit-graph-dispatch-fact-emission.test.ts`, etc.). The same job fails on PR #205 (merged to staging at `e9e0bbce`), confirming this is staging-baseline debt rather than a PR #207 regression. Merge requires either Paul's baseline-CI exception OR a separate workstream to clear the inherited errors.
