# Synthetic shared-data witness, 29 September 2026

**Technical mechanics pass; goal provenance, goal-direction attestation and edit acknowledgement still have visible gaps.** No production or other team's state changed. This is an explicitly artificial, source-complete fixture with an injected faithful CandidateModel; it does not measure live extraction, real-brief fidelity or customer decision quality.

The exact source and candidate are frozen in `synthetic-spine-fixture.json`. The real route used CEE source `153be0fa89082efdf74da5e13a8b0297f398b7cd`, UI source `4d64ce41c8958d97cfb27f8359ab1d35d57dc52e`, real isolated Postgres/PostgREST, and the existing PLoT staging `/v2/run` endpoint. A subsequent zero-provider replay through A port `59643202823cf0b2a621479a26310495e79e4a12` produces the same graph values recursively. Strict serialized bytes differ only because JSON property order differs; sorted graph SHA256 is `a108eadff937a527efb8e3a156d9c0e1d490291fa4637face26f7d7d28807a99`. The API runtime itself was not upgraded to A port.

The artificial claim is Pro MRR = price × subscribers, with current £50 × 1,000 = £50,000/month, target above £55,000/month at three months, and two explicit options: £60 × 960 and £50 × 1,120. Existing admission supplies normalisation caps and structural identity-edge placeholders; no experimental causal coefficient was invented. The fixture's descriptive option labels avoid the old constructor's literal “Option A” retention defect. Latest A fixes that defect separately.

Scenario `0bd917dc-1267-4351-a623-45109261aec8` completed:

1. Real BFF registration: graph `ef498f8d869fc030`, version 1, six nodes/eight edges.
2. Existing Run chip through `/bff/orchestrate/v2/turn`: HTTP 200, 4.9 seconds, `complete_current`, outcomes approximately £57,600 versus £56,000.
3. Existing `option_intervention_edit` route: synthetic instruction to change the first option's expected subscribers 960 → 1,000; HTTP 200; hash `560d2a4baa47bdf9`, `complete_stale`, leader withheld.
4. Rerun: HTTP 200, 4.2 seconds; £60,000 versus £56,000; `complete_current` on the new hash.
5. Separate-process BFF cold read retains that exact hash, result revision, edited intervention and user attribution.
6. Fresh signed-in browser load plus explicit reload receives that same graph/current-run record. Once hydration settles, it displays “Current model”, 100%/0%, “Your analysis is ready”, and the edited option shows “This option sets 1,000 subscribers” / “Set by you”.

The initial browser screenshot was taken during hydration: “set a success target” and “Analyse first pass” disappeared in the settled capture. Do **not** report those as persistent cold-reload failures. The settled screenshot still shows the goal's target source as unrecorded.

Remaining first failing boundaries:

- **Run objective attestation:** M1 produces `goal_direction: '>'`, and registration/cold-read preserve it. `goal-target/goal-direction.ts` deliberately emits only `minimise`; `run-analysis.ts:1042` therefore omits a `maximise` direction on the PLoT wire. The response contains `GOAL_DIRECTION_UNATTESTED` and discloses that higher was assumed better. This is an existing Run-wire meaning gap, not a constructor/persistence loss.
- **Edit acknowledgement:** `system-events/option-intervention-edit.ts:887` passes normalised `modelValue` into `routing/option-effect-write.ts:1487`; the formatter says “effect value of 0.1”. Canonical `0.1 × cap 10,000` is correctly 1,000 subscribers and the UI inspector displays 1,000. The missing human-unit display is at the acknowledgement formatter.
- **Goal provenance consumer:** canonical goal holds target 55,000, `threshold_source: brief_extraction` and the exact target quote. UI `canvas/domain/goalTarget.ts:137` treats every CEE raw target as `source: unrecorded`; it does not consume the carried brief origin. The settled goal card therefore says “Source not recorded”.

No new CEE provider attempt was made: the shared ledger remains **55/60**. These were deterministic analysis-route calls; no conversational LLM was needed. The PLoT output has additional warnings about unavailable edge sensitivity/E-values and deterministic zero-variance outcomes; this technical receipt is not scientific validation of uncertainty or a real decision recommendation.

Durable local evidence lives under `.artifacts/alternative-constructor/synthetic-spine/`: `journey-receipt.json`, exact requests/responses, `current-port-replay.json`, `cold-reload.json`, `browser-reload-settled-receipt.json`, `fresh-browser-reload-settled.png`, `edited-option-inspector-settled.png`. The receipt records scenario, source hashes, timestamps, state transitions, warnings and the exact boundary findings. Isolated instance `constructor-c-20260929` used ports 56431–56433, 8891 and 5278; cleanup status is in `cleanup-receipt.json`.
