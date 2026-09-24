# Interpreter v0.3 candidate

Status: implemented as pure prompt data and composition; **unbenchmarked and not mounted**. The banked v0.2 remains unchanged and available for the immediate OpenAI journey. This candidate adds no release gate.

## Intended user improvement

The candidate makes incomplete analysis understandable without turning every withheld claim into an invented constraint failure. When a material constraint is explicitly unassessed, the explanation leads with that limit. A generic `constraint_verdict_withheld` value alone establishes neither a failed constraint nor the existence of a constraint. Permitted metric-only findings retain their exact meaning, scope and model assumptions.

It also distinguishes a useful investigation suggestion from a claim of optimal priority. Supplied factor sensitivity or influence, together with uncertainty, can justify inspecting an assumption. Missing investigation costs do not require refusing all help. A lone edge-switch result still cannot establish sensitivity, importance or priority. Declining a method still means answering without starting it.

Paul's live test exposed a 321-word construction answer and a 282-word analysis answer, followed by a result card that repeated much of the explanation. The refinement targets the **post-analysis explanation only**: normally 2–4 sentences and about 50–90 words, with the material limitation beside the finding and at most one supported next step. Detailed requests and accuracy take precedence over the length target. This profile cannot shorten the constructor response until its separate owner improves that path.

The interpretation omits routine internal-normalisation and save/version notices while retaining relevant save failures or uncertainty. It must not assume a result card rendered: presentation evidence is required before relying on an existing card to avoid duplication. Native values, explicit incomplete assessment and currentness remain essential. HTTP success is explicitly distinct from a completed analysis, and next-step guidance must not promise unsupported edits, controls or reruns.

A later write conflict also limits what earlier receipts establish. A successful value save remains a historical event when a subsequent range write is refused; the refusal neither rolls it back nor proves that its value remains current. Current values, ranges and readiness require authoritative readback after the conflict. Without that readback, the explanation must leave current state unknown and avoid repair advice based on the earlier snapshot.

## Existing seam and ownership

`composeAnalysisInterpreterV03(baseInstructions)` returns the caller's existing baseline plus the candidate and hashes of the profile, baseline and complete instructions. It rejects an empty baseline. This is the same composition pattern as v0.2, not a replacement kernel or registry.

The inspected FP3 request supplies a `run_analysis` function result with its existing `result` and sibling `canonical_state.analysis_state` / `canonical_state.analysis_ready`. The profile consumes those supplied facts; it does not fetch, reconstruct or write them. Canonical currentness and permissions govern the explanation even when result prose is less restrictive. Readiness is not evidence that analysis completed. It cannot close the race between a request snapshot and delivery; that remains a runtime responsibility.

If evaluation supports promotion, Connected can select this composition at the existing `instructions:` seam on the single interpretation call. Tool restrictions, completed-run recovery, canonical reads and delivery currentness remain with their existing owners. No new call, router, service, state authority or science selector is introduced. Core retains science implementation and applicability ownership.

## Preserved protections

The candidate retains model-relative claims and human judgement; separate metric meanings; probability and edge-metric limits; exact units and strict constraints; excluded-option scope; stale-result and action-eligibility limits; analysed-revision fidelity; repeatability versus validation; zero-effect controls; supplied deltas and compatible comparison frames; no invented sensitivity, thresholds or priority; method decline/applicability; and no invented business or exercise assumptions. Approved estimates are explicitly kept distinct from verified evidence.

## Evidence and remaining work

- Static implementation: the focused suite now contains 18 profile/comparison-preparation/fixture-integrity tests, delegated to the targeted cloud workflow below. The previous 17-test suite passed on cloud head `c33e7b2d242b49086c6b98618a49bda6fd9fa4f9`; that earlier result is not execution evidence for the added post-conflict contrast. Use the latest exact-head check on the PR. These checks do not establish generated-answer quality.
- v0.2 remains 2,929 characters with SHA-256 `3d979e8406693be42d3b340fd245d76a501c4b1c191d5ffaa1353f2f0380ba32`.
- Refined candidate: 4,125 characters with SHA-256 `75ac5f6e70b14151b2032cd881caadbdc57b0522c723e0d488b38db94d168922`. The temporal-grounding addition is 281 characters; the profile is 1,196 characters longer than v0.2. The intended reduction is in answer length, not instruction length. Character length is not measured token usage or latency.
- No paid model calls or generated-answer evaluation were performed for this candidate. The v0.2 benchmark does not establish v0.3 quality.

The existing six PJ cases should be combined with controls where the withheld reason has no supplied cause, a constraint actually fails, no constraints were requested, metric-only permission is denied, or one edge flip is the sole investigation evidence. Preserve positive controls for legitimate metric-only findings and useful inspection grounded in supplied sensitivity plus uncertainty. Retain all before/after and existing v0.2 regression cases.

The principal quality risks are over-cautious language around missing permissions, greater prompt length, and treating any uncertain factor as a priority despite the bounded wording. Compare matched outputs for helpfulness and correctness before changing the live profile; offline request transport and composition checks cannot prove those outcomes.

## Real-journey semantic contrasts

`Docs/evals/interpreter/paul-concision-contrasts-20260924.json` contains sixteen authored cases in eight pairs. They are conceptual semantic fixtures, **not captured FP3 requests**, observed model answers or a new runtime contract:

| Pair | What changes while relevant facts stay fixed |
|---|---|
| Brief / requested detail | Same result, material churn limit and uncertainty; different requested depth |
| Domain block / completed run | Both HTTP 200 and `ok:true`; different run outcome |
| No constraints / known unassessed constraint | Same generic withheld reason; different supplied cause evidence |
| Approved estimate / supplied measurement | Same native figure; different origin and evidence status |
| Zero effect / supplied effect | Changed revision in both; precomputed zero versus non-zero delta |
| Unsupported edit / supported guidance | Same requested edit and current result; different available product actions |
| Unknown card / confirmed visible card | Same analysis and question; different presentation evidence |
| Saved write then conflict / authoritative reread | Same historical save and range-write refusal; current state unknown versus a changed value, an attached range and available analysis |

Send only `case.input` as context when a later evaluation is authorised. Keep expected behaviour, scoring limits and contrast labels outside the model request. Word limits are soft: retaining a material caveat and answering an explicit request for detail are more important than a short answer. The new static tests verify that the pairs actually differ in the intended evidence and that scoring fields are separate; they do not score language-model behaviour.

`PC15_saved_then_conflict_unknown` and `PC16_saved_then_conflict_refreshed` derive from the [independent #1743 review](https://github.com/Talchain/olumi-assistants-service/pull/1743#issuecomment-5806305332). Both record a save of 50 followed by a refused range write. The first has no post-conflict readback; the second supplies an authoritative later value of 40, a 0–100 range and readiness to analyse, while analysis itself remains unrun. The static check verifies the ordering and a genuinely different later state. It does not execute competing writers, repair the runtime race or establish how a model will describe it.

## Repeatable offline comparison

`tools/interpreter-eval/prepare-comparison.ts` prepares a matched comparison without connecting to a provider. It preserves every captured request field except the profile suffix, retains the current baseline, counterbalances profile order and separates request bodies, scoring guidance and the version/hash key. It refuses tool-enabled requests, changed v0.2 boundaries and ambiguous duplicate case IDs.

Run with the repository's existing `tsx` dependency:

```sh
node_modules/.bin/tsx tools/interpreter-eval/prepare-comparison.ts Docs/evals/interpreter/fp3-captured-cases-20260924.json /tmp/interpreter-comparison
```

The checked-in cases come from the actual FP3 serialisation at `9af274b1f3f2f63cc74ed397b6b6dc46550a3d83`, with synthetic upstream data and intercepted provider calls. Eight input-transport checks passed: PJ01–PJ05, the PJ06 ordinary-conversation contrast, an unknown withholding-cause contrast and a positive permitted model-leader contrast. Seven enter FP3, yielding fourteen prepared requests across v0.2 and v0.3. PJ06 correctly stays outside this Interpreter comparison. These are not seven observed user sessions or fourteen executed model calls.

To reproduce capture, copy `Docs/evals/interpreter/fp3-capture-test.reference.ts.txt` to `src/orchestrator-v5/agent-lane/__tests__/interpreter-input-audit.test.ts` in an isolated checkout of that FP3 head. Run only that test using Vitest; `INTERPRETER_CAPTURE_PATH` optionally selects the output JSON. The reference is deliberately outside automatic test discovery: the candidate branch does not own or contain the FP3 route. The checked-in fixture adds human scoring guidance outside the captured request bodies.

For a subsequent authorised model comparison, keep `manifest.json` hidden from the scorer; score all hard grounding rules plus directness, usefulness and concision. Preserve raw outputs, failures, provider/model/settings, usage and cache counts, and timings. The seven-case set is an integration-focused screen, not sufficient promotion evidence: retain the earlier v0.2 and before/after regressions and add fresh held-out cases. An automated pass over request data must never be reported as a model-quality pass.

## Targeted cloud validation

`.github/workflows/interpreter-offline.yml` runs the focused tests, targeted lint/strict TypeScript and matched-request preparation on GitHub. Its pull-request trigger has no target-branch restriction, so it covers this stacked draft without retargeting it or launching the full service suite. Relevant profile, fixture, test, workflow and dependency/configuration changes trigger it; superseded runs for the same PR are cancelled.

The job follows the repository's checkout v4, Node 20, pnpm 9 and frozen-lockfile installation pattern. It has read-only contents permission, no model credentials, no package secret (the locked Talchain dependency is vendored), no deployment and no artefact upload. Comparison files stay in runner temporary storage. Its result is additional offline validation, not a newly required status, an independent code review, a quality benchmark or permission to mount the candidate. A workflow being committed or queued is not a passing cloud result; cite the actual run and head when reporting completion.
