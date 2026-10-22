# Useful, faithful first models from weak briefs

Candidate rebased onto staging `05745055ee4f9ca5aa1963712ba78ac2b6013d3f` (#3689 readiness self-check included); not deployed or behaviourally validated.

## Intended behaviour

A rough brief should yield a useful provisional representation without requiring a rewrite: retain the person's purpose, quantities, mechanisms, disagreement and contradictions; add useful, attributed hypotheses; ask only a clarification that changes the next step. A brief about understanding a situation need not become an option-ranking exercise. Scientific credibility means transparent, defensible structure and uncertainty; it cannot establish the truth of missing facts.

The candidate consolidates the existing 14-replacement fidelity packet rather than creating a competing patch. It preserves the newer signed-sum definition and attributed calendar-reading contracts, including their current limitations. Do not apply the old packet on top of this branch.

## Changes and policy decisions for DL

| Boundary | Candidate change |
| --- | --- |
| First-model guidance | Explicit weak-brief construction, semantic ambiguity, contradictory source claims and a qualitative purpose; useful mechanisms and countereffects remain encouraged. |
| Completion policy | Supported provisional figures remain allowed and visibly Olumi's; missing values, strengths and probabilities are not manufactured merely to make Run available. |
| Model structure | Retain worthwhile alternative routes; remove a mandatory extra option, forced connectivity and an unsupported claim that one constraint is binding. Classify by meaning rather than by whether a measurement exists. |
| Tool schema descriptions | Apply the same figure/direction/uncertainty rules on follow-up turns; no schema shape or arithmetic changes. |
| Advisory critic | Check fidelity and contradictions before enriching; suggest useful measures/links rather than requiring them. An unnecessary question may be empty. |
| Standing and post-save instructions | Clarify material meaning before requesting numerical completion; a requested calculation still receives the specific necessary input question. |
| Readiness repair feedback (#3689) | Preserve DL's self-check, protected content and bounded retries. Its repair text follows the same supportability rule; a blocker is not evidence for a missing figure or link. |

The completion and mandatory-structure changes amend existing DL rules recorded after Paul's served tests. They are explicit candidate policy changes for DL's disposition, not claims those rules were previously unapproved. This branch retains **show, label, de-bias** and useful generative reasoning. It does not adopt a blanket ban on estimates or turn incomplete inputs into automatic refusal.

No new model stage, provider, budget, route, persistent schema, approval flow, calculation implementation or automatic timer is added. First-save/retry semantics and the restriction on rebuilding after a verified save are unchanged.

## Efficient behavioural comparison

Use the existing native core runner and one frozen compatible build in both arms; one arm is current source, the other the complete five-file instruction/schema-description candidate. Record actual outgoing instructions, schemas, model/effort, failures, retries, critic calls, usage and timing. Do not use the legacy PMS swap as a substitute or pool the old unpaired baseline with this build.

Reuse the six development families already prepared in [the execution request](https://github.com/Talchain/olumi-programme-docs/issues/94#issuecomment-6350126559). `tools/graph-evaluator/weak-brief-pairs.json` supplies rough, semantically equivalent variants and concrete checks. These are newly authored development inputs, not held-outs or results.

Suggested bounded allocation: first the existing six full briefs in both arms (12 first-draft turns), then their six rough variants in both arms (12 more), alternating arm order. This **replaces** the earlier second repetition within the same 24-turn ceiling; it is a proposed schedule amendment, not an instruction to start a second experiment. It measures robustness to phrasing, not repeated-sampling consistency. Stop on a critical candidate regression. Any repetition needed to resolve a mixed finding must be separately counted; do not claim consistency from one draw.

Blind the arm labels before judging. Count every attempt, including invalid outputs. Grade separately: material meaning/figures; source/conditional/time fidelity; scientific structure and countereffects; unjustified additions/estimates; useful attributed enrichment; schema/save success and honest calculation limitations. A sparse restatement does not win for caution; a runnable fabrication fails. Different graphs may represent the same claims. Judge completeness against source meaning and supportable mechanisms, not node count or fluency.

Use the existing two high-risk correction → approval → analysis → reopen scripts to check cross-turn behaviour after a promising first-draft screen. Record those turns separately; no full estate rerun or model tournament. A small screen supports a bounded adoption decision, never a claim of universal optimality.

## Known execution limit

The existing local execution status records one baseline draft and an automatic approval-review rejection of further transmission of Olumi prompts, tool schemas and the six development briefs to `api.openai.com`. No candidate output or valid paired comparison exists. This task has made no model calls and does not retry that rejected transmission, change credentials or request another runner to bypass it. The receiving DL must retain that explicit hold until it is resolved through the permitted approval route; it is not a missing API-key problem.

## Validation record

Local validation on the rebased candidate: **198 checks pass across nine existing files**: draft-tool, goal-path-feedback, kernel, core-prompt-arm, signed-sum, calendar-window, mapper, mapper-level-range and mapper-range-law. This includes the newly merged self-check's real-code paths and content-protection contrasts. The initial pre-rebase run exposed six old wording/hash assertions for deliberately changed policy; these pins were explicitly updated, with no operational test changed. The 198 checks include textual pins; they are not 198 independent quality cases.

JSON Schema comparison after removing descriptions confirms the Living Model shape is unchanged. TypeScript syntax checks cover the eight changed source/test modules, and `git diff --check` passes. This is not a full repository typecheck or suite pass. Existing wording/hash pins must change for an intentional policy change; their passing is not evidence of improved model behaviour. Runtime, source attribution, signed-definition and calendar compatibility checks remain separate from prompt-quality evaluation. Integration and release remain with DL; this branch is a reviewable implementation candidate.
