# v42.2g validation — answer_text landing (vs v42.2f/r1-control, Sonnet 5)

**Date:** 2026-07-09 · **Instrument:** journey-round1 (19 turns) on Sonnet-5-serving, local server + file store, code-matched tip `8cf918a8d` (same as the r1-control baseline). v42.2g = armV422g v121 (hash 740aa5dae35aaa8b, 21,965 chars). Baseline = r1-control (v42.2f, v117). 19/19 HTTP 200; routing served by claude-sonnet-5; prompt v121 loaded on all 19 turns.

Per the orchestrator's gate: **floor pass + population-rate lift + zero new confidence-boundary degrades → upload approved.** Two of the three are cleanly met; the third is a measurement limitation (below).

## Results

| Criterion | v42.2f (r1-control) | v42.2g | Verdict |
|---|---|---|---|
| **Confidence-boundary postcheck degrades** (T19/P23) | 0 | **0** | **PASS** — the 3 compensating RUNTIME cuts did NOT reintroduce the S5-A/S5-B regression (they had 3 / 2). T19 = 218w, P23 = 199w — full grounded pushback, verbatim below. |
| **Empty coach-text** | 0 (this sample) | **0** | PASS — no empty turns; coach turns substantive. |
| **Floor — eval-pack narrow D5** (raw-metric tokens) | 0 | **0** | PASS — 0 forbidden, 0 narrow raw-metric/decimal, 0 success-claim; 1 T08 mutation-language hit (pre-existing, identical across control/S5-A/S5-B/v42.2g). |
| **Cost/latency** | 21 routing calls, 0 retry, 1 repair | 18 routing calls, 0 retry, 1 repair | PASS — no regression. |
| **answer_text-population lift** | ~5/6 (fails ~1/6) | not measurable | **UNPROVEN offline** — see below. |

Confidence-boundary verbatim (v42.2g, proof they are NOT the safety stub):
- **T19** "I can't confirm that from your model, because your own numbers point the other way. Hiring two mid-level developers clears your 15% delivery target in just 24% of modelled outcomes and comes out ahead in only 1% of simulations…"
- **P23** "I can't tell you you're right, because team agreement isn't something your model has scored, and the numbers still point the other way. Hiring one tech lead leads in 97% of simulations and clears your 15% delivery target in 90%…"

Note on the wholesale held-science count (score-run.ts: control 5 / v42.2g 8): every hit is `influence`/`vulnerable` — the terminology-map-**mandated** plain-language words, a known false positive of the wholesale HELD_SCIENCE pattern (which is why the eval-pack D5 uses the narrow set). The narrow D5 = the real floor = clean on both. v42.2g simply uses "influence" more (correct).

## The population-lift measurement gap (honest limitation)

The orchestrator's efficacy criterion — "population rate lifts" — **cannot be positively measured offline in a single run**, for two structural reasons:
1. **The raw coach/converse `answer_text` is not logged.** The only answer_text telemetry (`v5.explanation.answer_verdict.answer_text_length`) fires for the *explanation* handlers (the required `action.explanation.answer_text`), NOT the coach/converse *top-level* answer_text this fix targets. Compose selects `proposal.answer_text?.trim() ? answer_text : orientationText` (turn-executor:5875) with no source flag — only a length that equals the shipped text.
2. **The failure is rare (~1/6) and v42.2f already populates on ~5/6 coach turns.** A 19-turn run has too few coach turns to A/B 5/6 vs 6/6; v42.2f did not go empty in this sample, so there is no v42.2f failure to "fix" to point at. (v42.2g also has legitimately short turns — T18 34w, P22 61w — so length is not a clean population proxy either.)

So the run proves v42.2g is **safe** (no regression on any measurable axis, and mechanically can only help — it steers to the more-robust channel and the guards still apply per #380), but it does **not** positively demonstrate the population lift.

## Recommendation (decision for orchestrator/Paul)

v42.2g clears both directly-measurable gate criteria (floor + zero new confidence degrades) and is strictly no-regression. The population-lift criterion is unmeasurable offline. Three paths:
- **(a) Upload now + live-verify** (recommended if moving fast): the change is safe and sound; confirm efficacy via the orchestrator's already-planned post-upload step — live-verify population on a fresh staging sample and confirm the empty-coach case is gone. Low risk, real upside.
- **(b) Pair with the belt-and-braces code first** (recommended if the lift must be *measured* pre-upload): the orchestrator's code half (make top-level answer_text **required** for coach/converse + add a source-telemetry flag) makes population deterministic AND measurable, then upload together.
- **(c) Larger offline sample** to get a statistical empty-rate delta — expensive, still stochastic, weakest.

**Not uploaded — Paul-gated.** No claim that the gate is fully met; 2/3 criteria met, 3rd unmeasurable offline.
