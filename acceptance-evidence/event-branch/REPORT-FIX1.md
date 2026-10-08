# Event branch FIX-1

Implemented in the retained working tree `/private/tmp/accel-er-event-cee`, on `dl/event-risk-olumi-occurrence`, with HEAD still `5b095286bac99763119009304fa9cfbc8f2da812`. DL ruling (C), Science 393023 and the supplied FIX-1 brief govern case (b), superseding the first-build disclosure.

No commit, staging, push, new event-risk writer, offer chip, deployment or file change under `supabase/`. No directory was removed. The existing whole-model construction/register writer remains the only construction write path; no operation was added to set occurrence on an existing risk.

## Behavior and required rows

Case (a) still uses `readStatedEventRiskWithBindingSpan` and the existing user hold/conversion. Case (b) removes the probability factor and withholds the matching drafted occurrence even if an Olumi reference-class basis was supplied. Its code-authored sentence is exactly:

> You said ‘<user's quoted span>’ for ‘<risk label>’; it isn't used as its likelihood yet.

The quote is the complete risk-naming clause sliced by the existing reader's clause boundaries from the brief; boundary whitespace is trimmed, internal wording, case, hedge and spacing are preserved. The first exact matching clause suffices when the user repeats the statement. This quotation detector cannot admit a likelihood. The risk label is the model's matched risk label. Exact percentage tokens are compared without substring matching: drafted `10%` is not found in `15%`, `110%` or `10.5%`. A number belonging to another event/quantity cannot earn a risk attribution.

| Row | First-build evidence / final result |
| --- | --- |
| 5b50b4c8 shape: `Key developer departure: probably 10% within 6 months`, probability factor = 10% | RED on first build. Factor and its incident links removed; no occurrence on the risk; exact `You said …` sentence, no `Olumi had drafted` sentence. Full construction ToolResult/readback also passes. |
| Same hedge, drafted Olumi occurrence = 10% with a reference-class basis | RED on first build. No occurrence or basis sidecar admitted; exact interim sentence. |
| Explicit `a 10% chance he leaves within 6 months` | Existing control remains GREEN: user occurrence 0.1–0.1, horizon 6; factor removed, Olumi text cleared, no interim sentence. |
| Drafted 10% absent from brief and no valid Olumi basis | Existing control remains GREEN: dropped with `Olumi had drafted ‘Key developer departure probability’ = 10% without a basis, so it isn't used.` |
| Brief says 15%, drafted factor 10% | Case (c), not (b): existing drop/disclosure and no interim sentence. Additional 110% and 10.5% controls pass. |
| Percentage absent from brief, with valid Olumi occurrence/basis | Existing Olumi path and odds widening remain GREEN. |
| Verbatim quote with different case and doubled internal spaces | RED on first build; exact original slice retained after FIX-1. |
| Repeated refused hedge, with and without a drafted occurrence | Additional RED: repetition previously fell into case (c), or allowed the Olumi occurrence. Now quotes the first actual span and never applies it. |
| Probability factor with null/NaN, or unitless 2 outside [0,1] | Additional RED: previously escaped removal. All suffix probability factors are now removed before value validation, with no invented missing percentage. |
| Patch/edit_graph authors `event_risk_basis_text` | RED on first build; root, nested-object and add-node paths refuse as `PIPELINE_OWNED_FIELD`. |
| Orphan, malformed, non-risk, user/reference basis text | Admission drops orphan text; egress strips these companions; attribution ignores them, never displays them. |
| User conversion clears Olumi text | Existing early conversion control GREEN; late shared-hold clearing RED on first build and now GREEN. |
| Client-supplied basis text beside valid occurrence, or orphan text | RED on first build; stripped before persistence. Actual route controls preserve exact CEE construction text and unchanged trusted stored Olumi text. |
| Drafter LINK item has no OUR `/occurrence|likelihood|probab/i` properties | GREEN on first build, strengthened probe now GREEN. Same row requires known `effect_amount`, so it is non-vacuous. No whole LINK-schema pin and no rejection of P44's future `basis` field. |

## Science optional clause: permitted fallback

The interim sentence ships **without** `so the chance doesn't include this risk yet`.

The authoritative final input is `plotPayload.graph` in `src/orchestrator-v5/tools/handlers/run-analysis.ts`, after participation/precondition exclusions and final wire transforms, sent by `deps.plotClient.run`. At that point the original case-(b) candidate/refusal ledger is unavailable. Conversely construction's `event_risk_disclosures` and the auto-Run reply caller have the refusal receipt but do not receive that final sent graph. The existing recorded input snapshot is not a substitute: its link list filters links without finite strength and is not transported back on this result surface. No one existing point holds both facts. Adding the clause would need a new carrier/transport workflow or a second exclusion authority. The supplied brief expressly allows the sentence without the clause in this situation.

`fix1-run-binding-audit.md` records the exact source points and lifecycle. A retained Olumi-sized risk link still counts as incidence; withholding occurrence alone does not establish that the risk was absent from the Run.

| Science row | Honest FIX-1 scope |
| --- | --- |
| Risk absent from actual Run input, or no incident link → clause present | Not implemented under the permitted fallback; no passing actual-Run inclusion claim. |
| Risk still in actual Run input with an Olumi-sized incident link → clause absent | Clause absent by fallback, not a newly bound Run-input witness. |
| Clause always on mutant → RED | Killed by exact interim/no-clause assertions. This guards the permitted fallback and does not claim the absent/present Run rows were implemented. |

## Changed files

| Source file | Change |
| --- | --- |
| `src/orchestrator-v5/agent-lane/olumi-event-risk-draft.ts` | Exact refused-user quotation/disclosure, occurrence withholding, repeated-hedge safety and unconditional suffix-factor removal. |
| `src/orchestrator-v5/agent-lane/stated-event-risk-draft.ts` | Shared user hold clears Olumi's basis text. |
| `src/orchestrator-v5/agent-lane/goal-chance-estimate-attribution.ts` | Uses the common validated sidecar reader. |
| `src/schemas/event-risk.ts` | Common `readOlumiEventRiskBasisText` risk/valid-Olumi/nonempty-text gate. Strict event_risk.v1 fields unchanged. |
| `src/schemas/cee-v3.ts` | Documents dependent CEE-owned text; preserves plain object shape. No new node field in FIX-1. |
| `src/orchestrator-v5/graph-management/field-safety.ts` | Basis text joins CEE-owned roots. |
| `src/routes/assist.v1.scenario-graph-register.ts` | Strips client authorship, carries exact trusted construction/stored text, clears changed/user companions. |
| New `src/orchestrator-v5/agent-lane/event-risk-construction-context.ts` | Narrow in-process grant on existing register path; exact scenario/node/occurrence/text, cloned occurrence snapshot, expires in finally. No body/header trust. |
| `src/orchestrator-v5/agent-lane/runtime/build-model.ts` | Wraps its existing registration call in that grant. |
| `src/cee/transforms/schema-v3.ts` | Carries validated risk occurrence and its valid Olumi text through the existing field-by-field egress transform. |
| `src/schemas/value-warrant-guard.ts` | Updates the existing attestation explanation for the Olumi writer and dependent text; no numeric detector/token expansion. |

Changed tests: `src/orchestrator-v5/agent-lane/__tests__/olumi-event-risk-admission.test.ts`, `event-branch-construction.test.ts`, `event-risk-drafter-contract.test.ts`; `src/orchestrator-v5/graph-management/__tests__/field-safety-corpus.test.ts`; `src/routes/__tests__/assist.v1.scenario-graph-register.event-risk.test.ts`; new `src/cee/transforms/__tests__/event-risk-basis-text-egress.test.ts`.

New evidence in `acceptance-evidence/event-branch/`: this report, `fix1-*.log`, `fix1-mutants.json`, `fix1-run-mutants.py`, `fix1-run-binding-audit.md`, `fix1-safety-sites.md`, `fix1-source-sha256.json` and `replay-source-hashes.json`. Existing replay comparison and first-build source hashes remain unchanged.

## Per-site basis-text classification

| Site | Decision and reason |
| --- | --- |
| `graph-management/field-safety.ts` | Same CEE-owned write class as `event_risk`. Added to `PIPELINE_OWNED_ROOTS`. Update-field, nested object and add-node payloads refuse it as `PIPELINE_OWNED_FIELD`; no patch/edit producer can author it. |
| `schemas/value-warrant-guard.ts`, CEE occurrence `p_low` | Readable textual companion supports the CEE Olumi writer's attestation. Updated adjudication to name the Olumi admission, CEE ownership and trusted register path. Do not add the text as a numeric leaf or generic `WARRANT_TOKENS` member. |
| `schemas/value-warrant-guard.ts`, CEE occurrence `p_high` | Same decision as `p_low`, inherited via existing adjudication reference. No detector expansion. |
| `schemas/value-warrant-guard.ts`, CEE horizon `months` | The numeric horizon remains warranted by its months unit and the valid occurrence basis; text is not a separate duration/warrant. |
| `schemas/value-warrant-guard.ts`, CEE mitigation `occurrence_reduction` | Fraction remains warranted by its existing event occurrence block, not by the textual companion. |
| `schemas/value-warrant-guard.ts`, contract occurrence `p_low` | Same attestation semantics, but the vendor block declares no companion. Do not pretend text is in the strict event_risk block or vendor contract. |
| `schemas/value-warrant-guard.ts`, contract occurrence `p_high` | Same decision as contract `p_low`. |
| `schemas/value-warrant-guard.ts`, contract horizon `months` | Same unit/basis semantics as CEE horizon; no textual numeric field. |
| `schemas/value-warrant-guard.ts`, contract mitigation `occurrence_reduction` | Same fraction/basis semantics as CEE mitigation; no textual numeric field. |
| `cee/transforms/schema-v3.ts` | Treat as a dependent occurrence companion at field-by-field egress. Forward only validated risk occurrence; forward text only when the shared gate accepts an Olumi occurrence. Orphan/malformed/non-risk/user/reference text disappears. |
| `routes/assist.v1.scenario-graph-register.ts` | CEE-only authorship. Strip client input text. The same existing register write accepts a construction's exact scenario/node/occurrence/text through an in-process AsyncLocalStorage grant. Preserve an unchanged stored valid Olumi occurrence's own text. User conversion or changed occurrence clears it. No request body/header confers trust. |
| `orchestrator/tools/analysis-ready-helper.ts` | Keep independent of numeric readiness. This reader tests `EventRiskV1` to excuse today's level; basis text alone must not qualify or change readiness. No sidecar reader exists here. |
| `agent-lane/disclosure.ts` | No new sidecar reader. It consumes code-authored outcome loss sentences, not raw node warrants. The interim sentence remains a code-authored disclosure. |
| `agent-lane/proposal-reply.ts` | No Olumi sidecar copying. Its add-risk likelihood is the existing held user figure and user quote; readable Olumi text cannot create a user claim. |
| `agent-lane/proposal-object/record.ts` | No raw sidecar reader. The card's existing user-event member is validated before its likelihood line. It does not copy arbitrary graph text. |
| `goal-target/held-user-links.ts` | No sidecar reader. The block's mitigation factor ids affect held-link semantics; textual basis must not alter a link, its size, existence or coverage. |
| `handlers/gm-held-execute.ts` | No sidecar writer. The existing user-event stamp only applies to new held risk nodes after re-referee; producer arguments are screened upstream. It creates no event-risk edit door on an existing risk. |
| `system-events/dispatch.ts` | No sidecar wire/hold member. Existing validated user-event input and member are carried; new occurrence basis text stays out of link objects and user holds. |
| `agent-lane/admit-model.ts` | Existing admission delegates to prepareDraftEventRisks before copying risk fields. Only its valid admitted Olumi occurrence may supply text; raw previous/orphan text is stripped there. No separate writer needed. |
| `agent-lane/olumi-event-risk-draft.ts` | Admission writes text only on a valid Olumi occurrence; previous/orphan text is removed and conversion to basis user clears it. |
| `agent-lane/stated-event-risk-draft.ts` | Changed the shared user hold to clear the old Olumi sidecar whenever replacing an occurrence with basis user, including the late construction hold. |
| `agent-lane/goal-chance-estimate-attribution.ts` | Display uses the shared gate after its existing valid Olumi/root/path checks; invalid/orphan/user/reference text earns no displayed basis. |
| `schemas/cee-v3.ts` | Preserve its plain `z.object` shape for existing introspection and ownership derivation. Declare the readable text, but companion validity is enforced by admission/ingress/egress/display readers; a parsed orphan is ignored and never displayed. |

The review's 16 textual event_risk sites in `value-warrant-guard.ts` are eight adjudication entries plus their references; all eight and their shared decisions are covered above. Basis text is not a numeric leaf or generic warrant token. No occurrence, likelihood, probability, basis, reason, why, rationale or justif* property was added to the drafter LINK schema or any link object. P44 link basis ownership remains separate.

## Verification and mutants

Every Vitest run used the exact load gate `node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)" && …`, at most two explicit test files, one worker, `--fileParallelism=false`, `--configLoader=runner`, and `/dev/null` stdin. Test runs were serialized. Gate failures/empty selections were not counted as assertion kills.

| Evidence | Result |
| --- | --- |
| `fix1-admission-construction-red.log` | First-build RED: 5 assertion failures, 37 controls passing. |
| `fix1-additional-refusal-red.log` | Additional RED: 5 failures (repeated hedge, missing/nonfinite/invalid probability factor). Relevant factor-loop behavior was still the first build's. |
| `fix1-safety-red-field-egress.log` | First-build RED: 5 failures, 87 controls passing. |
| `fix1-safety-red-register.log` | First-build RED: 3 failures, 13 controls passing. |
| `fix1-admission-construction-final.log` | 47 passing admission/construction rows after mutant restoration and additional fixes. |
| `fix1-p44-green.log` | 5 passing drafter-contract rows. |
| `fix1-safety-green-field-egress.log` | 92 passing field-safety/egress rows. |
| `fix1-safety-green-register-warrant.log` | 52 passing registration/value-warrant rows. |
| `fix1-safety-final-restored.log` | 112 passing field-safety/registration rows after both safety mutants restored. |
| `fix1-neighbours-copy-reader.log` | 53 passing existing copy/count and shared draft-reader rows. |
| `fix1-neighbours-reply-routing.log` | 357 passing existing reply-route and explicit likelihood routing rows. |
| `fix1-typecheck.log` | Source TypeScript check passed (`tsc -p tsconfig.build.json --noEmit`). |
| `fix1-lint.log` | Targeted ESLint on all 17 changed/new source/test files passed. |

| Mutant | Result and evidence |
| --- | --- |
| Interim path applies occurrence by removing refused-quote gate | RED, 1 assertion failure; `fix1-mutant-interim-applies-occurrence.log`. |
| Case (b) uses `Olumi had drafted … without a basis` | RED, 1 assertion failure; `fix1-mutant-interim-misattributed-to-olumi.log`. |
| Optional chance clause always on | RED, 1 assertion failure; `fix1-mutant-chance-clause-always-on.log`. |
| Basis-text CEE ownership removed | RED, 1 assertion failure; `fix1-safety-mutant-field-ownership.log`. |
| Client basis stripping bypassed | RED, 3 assertion failures; `fix1-safety-mutant-client-basis.log`. |

All mutant production sources were restored. `fix1-mutants.json` and the reproducible root runner retain the three requested copy/admission mutation results; the two safety logs retain their executed assertion failures. `git diff --check` passes.

## Replay footprint and evidence boundary

`replay-base/` and `replay-after/` were already absent, untracked and uncommitted in this checkout. No deletion was needed or performed. Kept `replay-comparison.json` unchanged and recovered only compact source identities in `replay-source-hashes.json`: 116 exact source SHA-256/brief SHA-256 pairs, each brief hash checked against its recording. No graph bodies or replay directories were copied. The comparison is historical first-build evidence; FIX-1 did not rerun that corpus or any live provider draw. `fix1-source-sha256.json` identifies the final changed source/test bytes separately from the preserved first-build manifest.

This is verified local working-tree implementation and mocked registration/reply evidence. No live deployment, served PLoT/ISL Run, live pilot, or whole-PoC acceptance is claimed.
