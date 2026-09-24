# Interpreter v0.3 candidate

Status: implemented as pure prompt data and composition; **unbenchmarked and not mounted**. The banked v0.2 remains unchanged and available for the immediate OpenAI journey. This candidate adds no release gate.

## Intended user improvement

The candidate makes incomplete analysis understandable without turning every withheld claim into an invented constraint failure. When a material constraint is explicitly unassessed, the explanation leads with that limit. A generic `constraint_verdict_withheld` value alone establishes neither a failed constraint nor the existence of a constraint. Permitted metric-only findings retain their exact meaning, scope and model assumptions.

It also distinguishes a useful investigation suggestion from a claim of optimal priority. Supplied factor sensitivity or influence, together with uncertainty, can justify inspecting an assumption. Missing investigation costs do not require refusing all help. A lone edge-switch result still cannot establish sensitivity, importance or priority. Declining a method still means answering without starting it.

## Existing seam and ownership

`composeAnalysisInterpreterV03(baseInstructions)` returns the caller's existing baseline plus the candidate and hashes of the profile, baseline and complete instructions. It rejects an empty baseline. This is the same composition pattern as v0.2, not a replacement kernel or registry.

The inspected FP3 request supplies a `run_analysis` function result with its existing `result` and sibling `canonical_state.analysis_state` / `canonical_state.analysis_ready`. The profile consumes those supplied facts; it does not fetch, reconstruct or write them. Canonical currentness and permissions govern the explanation even when result prose is less restrictive. Readiness is not evidence that analysis completed. It cannot close the race between a request snapshot and delivery; that remains a runtime responsibility.

If evaluation supports promotion, Connected can select this composition at the existing `instructions:` seam on the single interpretation call. Tool restrictions, completed-run recovery, canonical reads and delivery currentness remain with their existing owners. No new call, router, service, state authority or science selector is introduced. Core retains science implementation and applicability ownership.

## Preserved protections

The candidate retains model-relative claims and human judgement; separate metric meanings; probability and edge-metric limits; exact units and strict constraints; excluded-option scope; stale-result and action-eligibility limits; analysed-revision fidelity; repeatability versus validation; zero-effect controls; supplied deltas and compatible comparison frames; no invented sensitivity, thresholds or priority; method decline/applicability; and no invented business or exercise assumptions. Approved estimates are explicitly kept distinct from verified evidence.

## Evidence and remaining work

- Static implementation: 9 profile/comparison-preparation tests, ESLint and strict targeted TypeScript checks passed. Those checks do not establish generated-answer quality.
- v0.2 remains 2,929 characters with SHA-256 `3d979e8406693be42d3b340fd245d76a501c4b1c191d5ffaa1353f2f0380ba32`.
- Candidate: 3,566 characters with SHA-256 `454c2a83d4f4bfeb829437a9f351add33bfaa903982117eee5d637d9948ebb0a`. That is 637 additional characters; character length is not measured token usage or latency.
- No paid model calls or generated-answer evaluation were performed for this candidate. The v0.2 benchmark does not establish v0.3 quality.

The existing six PJ cases should be combined with controls where the withheld reason has no supplied cause, a constraint actually fails, no constraints were requested, metric-only permission is denied, or one edge flip is the sole investigation evidence. Preserve positive controls for legitimate metric-only findings and useful inspection grounded in supplied sensitivity plus uncertainty. Retain all before/after and existing v0.2 regression cases.

The principal quality risks are over-cautious language around missing permissions, greater prompt length, and treating any uncertain factor as a priority despite the bounded wording. Compare matched outputs for helpfulness and correctness before changing the live profile; offline request transport and composition checks cannot prove those outcomes.

## Repeatable offline comparison

`tools/interpreter-eval/prepare-comparison.ts` prepares a matched comparison without connecting to a provider. It preserves every captured request field except the profile suffix, retains the current baseline, counterbalances profile order and separates request bodies, scoring guidance and the version/hash key. It refuses tool-enabled requests, changed v0.2 boundaries and ambiguous duplicate case IDs.

Run with the repository's existing `tsx` dependency:

```sh
node_modules/.bin/tsx tools/interpreter-eval/prepare-comparison.ts Docs/evals/interpreter/fp3-captured-cases-20260924.json /tmp/interpreter-comparison
```

The checked-in cases come from the actual FP3 serialisation at `9af274b1f3f2f63cc74ed397b6b6dc46550a3d83`, with synthetic upstream data and intercepted provider calls. Eight input-transport checks passed: PJ01–PJ05, the PJ06 ordinary-conversation contrast, an unknown withholding-cause contrast and a positive permitted model-leader contrast. Seven enter FP3, yielding fourteen prepared requests across v0.2 and v0.3. PJ06 correctly stays outside this Interpreter comparison. These are not seven observed user sessions or fourteen executed model calls.

To reproduce capture, copy `Docs/evals/interpreter/fp3-capture-test.reference.ts.txt` to `src/orchestrator-v5/agent-lane/__tests__/interpreter-input-audit.test.ts` in an isolated checkout of that FP3 head. Run only that test using Vitest; `INTERPRETER_CAPTURE_PATH` optionally selects the output JSON. The reference is deliberately outside automatic test discovery: the candidate branch does not own or contain the FP3 route. The checked-in fixture adds human scoring guidance outside the captured request bodies.

For a subsequent authorised model comparison, keep `manifest.json` hidden from the scorer; score all hard grounding rules plus directness, usefulness and concision. Preserve raw outputs, failures, provider/model/settings, usage and cache counts, and timings. The seven-case set is an integration-focused screen, not sufficient promotion evidence: retain the earlier v0.2 and before/after regressions and add fresh held-out cases. An automated pass over request data must never be reported as a model-quality pass.
