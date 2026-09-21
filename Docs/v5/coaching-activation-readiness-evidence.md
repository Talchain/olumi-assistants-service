# Coaching activation readiness: evidence pack (component 4)

**Status:** verification complete in local/test. No flags flipped, no staging writes, no live runs, no Render probes. Every live action remains held for Paul's authorisation (final section).
**Baseline:** `origin/staging` @ `3e4b86115` (PR #316 merged). **Branch:** `claude/harness-c4-coaching-readiness`. **Date:** 2026-07-02.
**Changes in this unit:** two new test files plus this document. Zero production edits. `turn-executor.ts` untouched.

## 1. What this pack proves, in plain language

Two finished coaching capabilities sit dark behind default-off switches: Cap-1 answers "how can we improve this?" style questions with grounded next steps after an analysis, and Cap-2A explains, when a risk could not be added because it is not connected into the model, what the person can do about it. This pack proves both are wired end to end and safe with their switches on in local tests, that turning them off leaves behaviour exactly as it is today (byte for byte), that they do not interfere with each other, and that every user-facing sentence in the new paths is a neutral placeholder awaiting final wording from Paul's copy track. What it deliberately does not prove is live behaviour on staging; that requires the authorisations listed at the end.

## 2. Flag matrix

| Flag | Default | State under test | Asserted behaviour | Proving test |
|---|---|---|---|---|
| `CEE_POST_ANALYSIS_LOOP_ENABLED` (`config.cee.postAnalysisLoopEnabled`, `src/config/index.ts:621`) | false | ON | Deterministic grounded answer (`canonical_rich`), zero LLM calls, gate telemetry `matched=true`, `loop_enabled=true` | `src/orchestrator-v5/__tests__/turn-executor-post-analysis-loop.integration.test.ts` (pre-existing) and the Cap-1 leg of `tests/unit/ai-harness/coaching-flags-combined.test.ts` (new) |
| same | false | OFF | Falls through `data_unavailable_for_class` to the LLM router (the lived defect) | pre-existing integration test, flag-off case |
| `CEE_ADD_RISK_REJECTION_GUIDANCE_ENABLED` (`config.cee.addRiskRejectionGuidanceEnabled`, `src/config/index.ts:427`) | false | ON, matching rejection | Wire text is exactly `ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER` | `tests/unit/orchestrator/edit-graph-add-risk-flag-seam.test.ts` (new) |
| same | false | OFF, same turn | Wire text is byte-identical to the pre-change generic copy | same file |
| same | false | ON, non-matching rejection (cycle) | Byte-identical generic copy; the classifier never broadens | same file |
| both | false | BOTH ON | Each capability's output byte-identical to its single-flag run; chips unchanged | `tests/unit/ai-harness/coaching-flags-combined.test.ts` (new) |

Runtime posture on Render (which of these env vars is set on staging or production) remains an unknown recorded in the plan's unknowns register; nothing here changes it.

## 3. Gap A closed: the real Cap-2A flag conditional is now executed by a test

Before this unit, no test executed the flag branch. The complete flag-name manifest (scope: `git grep` of the whole tree at the baseline; claim type: where the name appears at all): three non-comment code references under `src/` (the config declaration at `src/config/index.ts:427`, the env mapping at `:921`, and the consuming branch at `src/orchestrator/tools/edit-graph.ts:2322`), plus a config comment at `src/config/index.ts:418` and two mentions in the Cap-2A contract doc `Docs/v5/capability-2a-add-risk-rejection-guidance.md`. Nothing in `tests/` referenced it. The render test proves the composition beneath the flag by re-implementing it in-test; the e2e suite covers the bare add-risk clarification path, which short-circuits before this branch.

The new flag-seam test drives the real path end to end: `dispatchEditGraph` with a compound add-risk message (bypasses the deterministic clarification pre-route, classifies as a structural edit), an LLM adapter mock proposing a risk wired only to an option, structural validation failing with the reachability class, immediate rejection, and the real conditional at `:2322`.

**RED proof (discriminating form, run first).** The assertion "flag ON produces the generic copy" was run and FAILED with the placeholder as the received value, proving the test genuinely reaches the branch rather than passing vacuously:

```
FAIL  tests/unit/orchestrator/edit-graph-add-risk-flag-seam.test.ts
  > flag ON + targeted add-risk reachability rejection
AssertionError: expected 'I wasn't able to add that as describ…'
             to be 'I wasn't able to apply that change …'
Expected: "I wasn't able to apply that change — it would create an inconsistency in the model structure. …"
Received: "I wasn't able to add that as described, because the new risk isn't connected into the model yet, …"
Tests  1 failed | 3 passed (4)
```

**GREEN (final form).** 4 tests passed: placeholder on the wire with the flag on; byte-identical generic copy with the flag off (strict string equality against the baseline pinned in the render test); byte-identical generic copy for a non-matching rejection class with the flag on; chips identical between flag states. Wire shape re-validated with `OlumiResponseSchema.parse` in every case, including both flag states of the chips-parity case (added after review: the first version validated three of the four cases).

A harness note for the record: the patch applier treats `op.path` as the authoritative identifier when adding to the model, so the mocked proposal must carry the identifier in `path`, not only in `value`. The first RED run surfaced this (the test passed vacuously until fixed), which is exactly what the RED-first discipline is for.

## 4. Gap B closed: both flags on, non-interference proven

`tests/unit/ai-harness/coaching-flags-combined.test.ts` runs the Cap-1 scenario and the Cap-2A scenario under three postures (each alone, both on).

**RED proofs (run first; transcripts in [the durable appendix](coaching-activation-readiness-transcripts.md)).** Each leg was first asserted NOT to activate under the combined posture, and each failed:

```
× Cap-1 leg: … AssertionError: expected true to be false        (gate matched=true with both flags on)
× Cap-2A leg: … AssertionError: expected '…' not to be '…'      (placeholder rendered with both flags on)
```

**GREEN (final form).** 3 tests passed:
- Cap-1 leg: with both flags on, the answer text is byte-identical to the Cap-1-alone run; gate telemetry fields (`matched`, `copy_source`, `routing_path`, `deterministic`) identical; the routing adapter is a throwing mock, so the zero-LLM property holds by construction.
- Cap-2A leg: with both flags on, the placeholder text and the chips are identical to the Cap-2A-alone run.
- Neutrality (section 5) asserted on both live outputs.

## 5. Copy-slot inventory (all neutral; final wording from Paul's copy track)

No candidate copy was authored in this lane. The inventory below is where final wording lands.

| Slot | Location | Status |
|---|---|---|
| Cap-2A rejection guidance | `ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER`, `src/orchestrator/add-risk-rejection-guidance.ts:74` | Neutral placeholder, marked PLACEHOLDER-SAFE in source; final copy required before any live enablement |
| Cap-2A generic fallback (unchanged baseline) | `src/orchestrator/patch-rejection-helper.ts:120` | Pre-existing copy; byte-identical off-path proven |
| Cap-1 grounded answer composition | per-class composers in `src/orchestrator-v5/routing/post-analysis-advice-gate.ts` (canonical_rich branch), drawing on `routing/readiness-summary.ts`, `coaching/robustness-honesty.ts`, `context/recent-changes.ts` | Existing safe-now copy, live only behind the default-off flag; review before enablement |
| Always-on decline text (not flag-gated) | `V5_STRUCTURAL_DECLINE_TEXT`, used at `turn-executor.ts:5597` and `:6033` | Pre-existing; unchanged |

**Neutrality assertion (test-enforced, supplementary evidence):** the combined suite scans both capabilities' live output text and the Cap-2A placeholder for held-science vocabulary (sensitivity, fragility, flip, robustness, elasticity, EVPI/VoI, driver, influence, causal), success-claim phrasing (`findSuccessClaimHit`), and forbidden phrases (`findForbiddenPhraseHit`). All clean. This scan is evidence beside the allowlist guards, not a guard of record.

## 6. Telemetry inventory

| Capability | Signal | Status |
|---|---|---|
| Cap-1 | `v5.post_analysis_advice_gate` with `loop_enabled`, `matched`, `copy_source`, `routing_path`, `deterministic` (emitted from `turn-executor.ts`) | Present and asserted in tests; sufficient to prove live-and-effective after any future enablement |
| Cap-1 (always-on neutraliser) | `V5StructuralSuccessClaimSwapped` | Present (pre-existing tests) |
| Cap-2A | none today: the flag-on match branch emits no event | **Known gap (gap C).** Closed by component 6 (planned event `cee.add_risk_rejection_guidance.rendered`); until then, live-and-effective proof for Cap-2A rests on wire text alone |

## 7. Freshness enforcement citation

Cap-1 only composes on a fresh verdict: the gate returns unmatched at `src/orchestrator-v5/routing/post-analysis-advice-gate.ts:1001` when the analysis is not fresh, so stale analysis is never narrated by this path. Unchanged by this unit; cited because activation reviews should know the guard exists.

## 8. Verification gates (this branch)

- `pnpm typecheck:src`: clean, 0 errors.
- `pnpm typecheck` (full, includes tests): 462 errors. Precise claim and method: the error COUNT equals the staging baseline and a grep of the error list shows none reference the two new files; this is count parity plus per-file grep, not a per-error manifest diff, so offsetting changes elsewhere would not be visible to it.
- `pnpm test:required`: green. 864 files passed (8 skipped), 17646+ tests passed, exit 0, with both new files inside the gate (re-run green after the review fixes).
- New tests: 7/7 green in final form. RED/GREEN transcripts archived durably in [coaching-activation-readiness-transcripts.md](coaching-activation-readiness-transcripts.md).

## 9. Requires Paul authorisation (explicitly out of this lane)

1. Flipping either flag on staging or production (env change on Render).
2. Any live acceptance run (for example a flags-on golden-journey run against staging).
3. Final product copy for the Cap-2A slot and review of the Cap-1 composition copy.
4. Graduating the harness's A8b rejection-grounding invariant from advisory to gating once live evidence exists.
5. The component-6 telemetry event that closes the Cap-2A observability gap (sequenced with the telemetry file's pending lane disposition).
