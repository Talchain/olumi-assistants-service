# Post-draft coaching — gated-hybrid composer update

**Scope.** Update layered on top of PR #207 commit [`9fd3c2b4`](https://github.com/Talchain/olumi-assistants-service/commit/9fd3c2b4) (`feat(v5/draft-graph): replace thin post-draft copy with deterministic coaching narrative`). Goal: surface the rich LLM coaching fields (`coachingSummary`, `strengthenItems`, `coachingBiasSignals`) that `draft_graph` already produces, behind a strict deterministic copy-quality gate, so the first post-draft turn carries real coaching value when the LLM output is good — and falls through to the deterministic five-sentence narrative otherwise.

Working branch: `claude/reverent-kare-b06303` (fast-forwarded to `9fd3c2b4`, then five files modified + two new files added).

## Files changed

| File | Status | Δ lines |
|---|---|---|
| [src/orchestrator-v5/coaching/copy-quality-gate.ts](src/orchestrator-v5/coaching/copy-quality-gate.ts) | new | +230 |
| [src/orchestrator-v5/coaching/__tests__/copy-quality-gate.test.ts](src/orchestrator-v5/coaching/__tests__/copy-quality-gate.test.ts) | new | +232 |
| [src/orchestrator-v5/coaching/post-draft-narrative.ts](src/orchestrator-v5/coaching/post-draft-narrative.ts) | modified | +435 / −141 (full refactor; widened input, gated-hybrid pickers, new return shape) |
| [src/orchestrator-v5/coaching/__tests__/post-draft-narrative.test.ts](src/orchestrator-v5/coaching/__tests__/post-draft-narrative.test.ts) | modified | +424 (existing tests rebased onto new return shape; 18 new test cases for gated-hybrid + coachingSummary) |
| [src/orchestrator-v5/handlers/draft-graph-dispatch.ts](src/orchestrator-v5/handlers/draft-graph-dispatch.ts) | modified | +17 (pass new fields; emit source-selection telemetry; unwrap `.text`) |
| [src/orchestrator-v5/handlers/__tests__/draft-graph-dispatch.test.ts](src/orchestrator-v5/handlers/__tests__/draft-graph-dispatch.test.ts) | modified | +176 (telemetry mock + 6 new wiring tests) |
| [src/utils/telemetry.ts](src/utils/telemetry.ts) | modified | +18 (`V5PostDraftCoachingSourceSelected` event registered with full field-set comment) |

Total: **5 modified source files, 2 new source files, 1,532 lines added / 141 removed**.

## Source-selection logic implemented

Sentence 4 ("One assumption worth checking: …") picks from a strict priority chain. The first source that passes [gateAssumptionFragment](src/orchestrator-v5/coaching/copy-quality-gate.ts:140) wins.

| Priority | Source | Field consumed | Telemetry label |
|---|---|---|---|
| 1 | `strengthenItems[0].detail` | full string; falls back to first-sentence slice if too long | `strengthen_item_detail` |
| 1b | `strengthenItems[0].label` | only when detail fails the gate | `strengthen_item_label` |
| 2 | `analysisReady.bias_findings[0].explanation` | first finding whose explanation passes the gate | `bias_finding` |
| 3 | `coachingBiasSignals[0].detail` | first signal whose detail passes the gate | `coaching_bias_signal` |
| 4 | `factor.observed_state.uncertainty_drivers[0]` | first driver passing the existing `validateUncertaintyDriver` grammar guard | `uncertainty_driver` |
| 5 | fixed-generic prompt | never null | `deterministic_fallback` |

`coachingSummary` short-circuits the whole pipeline: if present and it passes [gateFullResponse](src/orchestrator-v5/coaching/copy-quality-gate.ts:180), the summary becomes the entire `assistant_text` (no opener prepended). Telemetry label: `coaching_summary`.

`fallback_reason` distinguishes `gate_rejected` (a higher-priority candidate existed but failed) from `no_candidate` (nothing was available at all), so ops can tell rejection rate apart from coverage gaps.

## Copy-quality gate rules

Defined in [src/orchestrator-v5/coaching/copy-quality-gate.ts](src/orchestrator-v5/coaching/copy-quality-gate.ts). Pure deterministic functions; no I/O.

Shared rejections (both fragment and full-response surfaces):
- empty / whitespace-only
- em dash `—` or en dash `–`
- internal-id prefix tokens: `\b(?:fac|opt|out|risk|goal|dec|node)_[a-z0-9]+`
- named schema/service terms: `intervention`, `schema`, `payload`, `analysis_ready`, `model_adjustment`, `bias_finding`, `factor_id`, `node_id`, `graph_node`, `enrichment`, `envelope`
- premature recommendation: `recommend(s|ed|ation|ations)?`, `winner`, `winning option`, `best option`, `top choice`, `chosen route/option`, `favoured/favored option`, `preferred option`

Fragment-only rejections (`gateAssumptionFragment`):
- length < 5 or > 150 chars
- trailing `.?!,;:` (the builder appends `.` itself)
- question-shaped first word (what/why/how/when/where/which/who/is/are/does/do/can/should/would/will/could/might)
- low letter density (catches glyph-heavy fragments)

Full-response-only rejections (`gateFullResponse`):
- length < 80 or > 1200 chars
- missing decision-framing token (decision/model/option/route/path/choice/trade-off)
- missing trade-off/gap token (trade-off/balance/risk/assume/assumption/consider/weigh/gap/unknown/uncertain/tension/constraint)
- missing next-step token (run/next/then/try/check/explore/review/inspect/validate/stress-test)

**Snake-case allowance.** Generic snake-case is NOT rejected — only the specific internal-id prefixes are. So `go_to_market`, `b2b_partnership`, `cost_factor` etc. pass cleanly when they are user-facing labels.

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
  fallback_reason: 'gate_rejected' | 'no_candidate' | null,
  strengthen_items_count: number,
  bias_findings_count: number,
  coaching_bias_signals_count: number }
```

Suggested operator queries:
- "what fraction of draft_graph turns get rich LLM coaching surfaced?" — `assumption_source != 'deterministic_fallback' && assumption_source != 'uncertainty_driver'`.
- "is coachingSummary usable?" — `coaching_summary_present / coaching_summary_passed_gate` ratio.
- "where is the LLM drifting?" — bucket by `fallback_reason == 'gate_rejected'` over time, segment by source.

## Before / after examples

All examples use the same fixture graph (goal: "Deliver Successful Launch Within Three Months"; three options; two factors).

### 1. Pre-branch THIN copy (now removed)
```
Your decision model for "Deliver Successful Launch Within Three Months" is ready, with 3 options and 2 factors to explore.
```

### 2. PR #207 base (commit 9fd3c2b4) — deterministic five-sentence
```
I've built a first decision model for "Deliver Successful Launch Within Three Months". I'm comparing three routes: Hire a tech lead, Hire two mid-weight developers and Outsource delivery to an agency. The main trade-off centres on Leadership quality balanced against Delivery capacity. One assumption worth checking: extra developers may add coordination overhead rather than throughput. Next, run the analysis to see how the options compare and what could shift the outcome.
```
Telemetry: `assumption_source: uncertainty_driver, fallback_reason: null`

### 3. NEW (this update) — clean strengthen.detail surfaces in sentence 4
With `strengthenItems[0].detail = 'the synergy assumption sits as a point value and warrants a 10 to 30M range to surface downside scenarios'`:
```
I've built a first decision model for "Deliver Successful Launch Within Three Months". I'm comparing three routes: …. The main trade-off centres on Leadership quality balanced against Delivery capacity. One assumption worth checking: the synergy assumption sits as a point value and warrants a 10 to 30M range to surface downside scenarios. Next, run the analysis to see how the options compare and what could shift the outcome.
```
Telemetry: `assumption_source: strengthen_item_detail, fallback_reason: null`

### 4. NEW — long strengthen.detail → first-sentence slice surfaces
With a 168-char detail ending with `.`: the picker tries the full string (rejected for length), then the first-sentence slice. Result:
```
… One assumption worth checking: the synergy assumption sits as a point value. Next, run the analysis …
```
Telemetry: `assumption_source: strengthen_item_detail`

### 5. NEW — gate-failing strengthen.detail (contains "recommend") → falls back to label
With detail `'we recommend hiring a senior lead …'` and label `'tighten the cost ramp curve'`:
```
… One assumption worth checking: tighten the cost ramp curve. …
```
Telemetry: `assumption_source: strengthen_item_label`

### 6. NEW — clean coachingSummary replaces the whole response
With a summary that passes all three full-response gate axes (decision framing + trade-off + next step), the deterministic five-sentence path is skipped:
```
The routes here weigh delivery speed against quality risk. One assumption worth checking is whether the team can absorb extra coordination overhead in the first quarter. Next, run the analysis to see how the options compare under stress.
```
Telemetry: `assumption_source: coaching_summary, coaching_summary_passed_gate: true`

### 7. NEW — gate-rejected coachingSummary → five-sentence fires
With a summary containing `'We recommend hiring …'`:
- The whole response gate rejects (premature recommendation).
- The deterministic five-sentence builder produces the same output as case 2 (uncertainty_driver source path).
Telemetry: `coaching_summary_present: true, coaching_summary_passed_gate: false, assumption_source: uncertainty_driver`

### 8. NEW — go_to_market / b2b_partnership labels render cleanly
With option labels `go_to_market` and `b2b_partnership`:
```
I've built a first decision model for "…". I'm comparing two routes: go_to_market and b2b_partnership. The main trade-off centres on …
```
The gate's prefix-aware internal-id regex does not match these legitimate user-facing snake-case labels.

## Test results

- **Unit tests, touched-file surface:**
  ```
  pnpm exec vitest run \
    src/orchestrator-v5/coaching/__tests__/ \
    src/orchestrator-v5/handlers/__tests__/draft-graph-dispatch.test.ts \
    src/orchestrator-v5/handlers/__tests__/narration-count-guard.test.ts \
    src/orchestrator-v5/__tests__/route-v2-draft-graph-persistence.test.ts
  → 15 test files, 313 tests, ALL PASSED
  ```
  Including:
  - `copy-quality-gate.test.ts` — 31 tests, all passed (one per rejection axis)
  - `post-draft-narrative.test.ts` — 82 tests, all passed (existing 64 rebased + 18 new for gated-hybrid + coachingSummary + telemetry)
  - `draft-graph-dispatch.test.ts` — 46 tests, all passed (existing 40 + 6 new for source-selection wiring)
  - `route-v2-draft-graph-persistence.test.ts` — all passed
  - `narration-count-guard.test.ts` — all passed

- **TypeScript build typecheck:**
  ```
  pnpm exec openapi-typescript openapi.yaml -o src/generated/openapi.d.ts   # required first run
  pnpm exec tsc -p tsconfig.build.json --noEmit
  → 0 errors
  ```

- **Lint, touched files:**
  ```
  pnpm exec eslint <7 touched paths>
  → 0 errors
  ```

- **No untracked source files outside the planned new modules:**
  ```
  git status --short | grep '^?? src/'
  ??  src/orchestrator-v5/coaching/__tests__/copy-quality-gate.test.ts
  ??  src/orchestrator-v5/coaching/copy-quality-gate.ts
  ```

- **Broader regression (vitest `-t "post-draft|draft_graph|coaching|narrative|chip"`):**
  1,071 tests passed, 17 failed. Every failure was confirmed pre-existing by re-running on the stashed feat branch state (commit `9fd3c2b4`, with my edits temporarily reverted) — the same files fail. None of the failing suites exercise the gated-hybrid composer code paths.

  Pre-existing failure clusters:
  - 5 in `tests/integration/cee.draft-graph.coaching*` — require live LLM connectivity for the integration suite.
  - 5 in `tests/integration/orchestrate-v2-unsupported-action.test.ts` — fastify boot needs env that isn't configured locally.
  - 2 in `tests/contract/endpoint-feature-matrix.test.ts` — same server-startup gap.
  - 2 in `tests/integration/cee.draft-graph.coaching.test.ts` — integration env.
  - 1 in `tests/integration/orchestrate-v2-chip-click-resume.test.ts` — integration env.
  - 2 in `src/orchestrator-v5/__tests__/d1-followup-fixes.test.ts` (normaliseFactorValue) — unrelated unit test drift.
  - 4 in `src/orchestrator-v5/__tests__/turn-executor-*.test.ts` — unrelated executor surface.
  - 1 in `tests/unit/v5-journey-replay/explain-leader-stale-chips.test.ts` — chip staleness assertion drift.
  - 1 in `tools/graph-evaluator/tests/adapters.test.ts` — tools directory, separate package.

## Residual risks

1. **LLM coachingSummary pass rate is unmeasured pre-deploy.** The full-response gate is strict (length 80–1200, plus three token-class checks). It may reject most summaries in practice, in which case the visible benefit is whatever sentence 4 picks up via strengthen/bias paths. Telemetry will surface the rate per request; tune thresholds in a follow-up if needed.

2. **Strengthen-item `detail` truncation strategy.** When detail is too long, the picker tries the first sentence (split on `.!?`). If the LLM emits a single 200-char sentence, both candidates fail, and we use the label. Acceptable but slightly noisier copy than ideal — tightening the picker (e.g. clause-boundary slicing) is a future move, not a blocker.

3. **`go_to_market` allowance widens the snake-case ban.** A leaked raw identifier whose prefix is NOT in the internal-id list (e.g. `cost_factor`, `revenue_metric`) would slip through this gate. The egress sanitiser at [output-safety.ts](src/orchestrator-v5/compose/output-safety.ts) remains the second line of defence — see the existing pinned tests at lines 410–448 of [post-draft-narrative.test.ts](src/orchestrator-v5/coaching/__tests__/post-draft-narrative.test.ts).

4. **`assertCleanCopy` helper was relaxed**. The previous blanket snake-case ban (`/\b[a-z]+(?:_[a-z0-9]+){1,}\b/`) was replaced with the prefix-aware internal-id regex. Existing tests that don't introduce snake-case continue to pass cleanly; the new behaviour is now under explicit test (`preserves legitimate snake-case option labels verbatim` and `snake-case option labels survive the egress sanitiser unchanged`).

5. **`model_adjustments` is no longer surfaced.** The prior commit had it as priority 2 in sentence-4 sources. The brief explicitly drops it. Any downstream consumer that depended on user-visible `model_adjustment.reason` text in `assistant_text` will see the assumption sentence go silent on those signals — but `analysisReady.model_adjustments` is still on the wire envelope for the UI to surface separately.

## PR #207 readiness

PR is [open](https://github.com/Talchain/olumi-assistants-service/pull/207). Base branch `main`; head branch `feat/v5-post-draft-coaching-copy` currently at `9fd3c2b4`.

Status of this update:
- Code, tests, typecheck, lint: green.
- Changes are uncommitted on the worktree branch (`claude/reverent-kare-b06303`).
- To refresh PR #207: commit the seven file changes onto `feat/v5-post-draft-coaching-copy` and push. The PR's existing description references "deterministic post-draft coaching narrative"; the new commit message should describe the gated-hybrid composer addition (suggested subject: `feat(v5/draft-graph): gated-hybrid post-draft composer over rich LLM coaching`).
- **No push / merge / deploy performed**, per the user instruction.
