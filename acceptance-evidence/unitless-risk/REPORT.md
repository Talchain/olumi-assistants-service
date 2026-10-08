# Unitless-risk PR-1 execution report

Implemented and locally verified in branch dl/event-risk-unitless-exclude, at unchanged HEAD 2334956288d3a87eaece7a5ab3d948b20a5f9dfb. No commit or push. No Supabase changes. PR-2 writers and presses remain outside this change. The supplied brief/design, Science section (r), lab recordings and /private/tmp/accel-p44 were read only; all new evidence is in this worktree's evidence/unitless-risk.

The twelve final recorded candidates through real admission improve chancesWithheldByAGuess from **10/12 to 4/12**. The separate sixteen stored-graph indicative count improves from **15/16 to 12/16**. No false-to-true withholding regression. The focused suites pass **135 tests**. All three required mutants produce assertion REDs and are restored byte for byte. This is local code/test evidence, with no CI, deployment or served-product claim.

## Files and HOT change

| File | Change |
| --- | --- |
| src/orchestrator-v5/agent-lane/unitless-risk-exclusion.ts | NEW: pure candidate-level exclusion, vetoes and exact disclosure |
| src/orchestrator-v5/agent-lane/product-goal-extra-parent.ts | Export shared usersRisk; recognize from_brief and user_set as user authorship |
| src/orchestrator-v5/agent-lane/admit-model.ts | Call pure exclusion immediately after rerouteExtraParentsOfProductGoal; record loss reason |
| src/orchestrator-v5/agent-lane/runtime/build-model.ts | Add new exclusion reasons to existing not_represented array; no chance-gate change |
| src/orchestrator-v5/agent-lane/goal-chance-screen-lines.ts | One carrier-based omission reader and evidence-position insertion helper |
| src/orchestrator-v5/agent-lane/reply/compose-reply.ts | Optional typed caveat placement marker; retain ordinary caveat-first ordering |
| src/routes/agent-v1-turn.ts | **HOT**: minimal import, live/replay caveat insertion and typed obligations |
| src/orchestrator-v5/agent-lane/__tests__/unitless-risk-exclusion.test.ts | NEW: real admission, registration, Run payload, vetoes and chance-withholding twin |
| src/orchestrator-v5/agent-lane/__tests__/unitless-risk-chance-caveat.test.ts | NEW: omission/direction, placement, composer order and live/replay source binding |
| src/orchestrator-v5/agent-lane/__tests__/goal-chance-screen-lines.route.test.ts | Sent-Run omission, direction, immediate order and zero-exclusion controls |

The HOT route change is 8 added lines and 1 replaced import: derive and insert the omission on the existing live chance-line path and rebuilt Run replay path, plus one caveat obligation in each. Both insertions precede the composer. No post-composer text writer was added. The reply-composer-last-writer test itself is unchanged and green. The optional after_lead_evidence marker is reply-obligation metadata, not a node field.

## RED first and row results

Before any production edit, the exact base produced 4 failing admission/registration/Run-boundary rows and 9 passing controls (red-admission.log). The caveat and real-route batch produced 30 failing rows and 10 passing controls (red-caveat.log): missing omission producers, missing sent omission words and wrong composer ordering were assertion failures. The replay baseline was recorded before production edits and is preserved.

A later styled event-by-date row first reproduced misplaced omission text (1 failed, 28 skipped; red-styled-chance.log), then passed after the narrow placement fix. The initial green attempt exposed an independently unheld/unaccepted core size in the isolated chance fixture and the existing explicit-link neighbour contract. The fixture now uses a real brief-scoped user size and stored goal attributes; the true-before/false-after chance assertion remains intact. Initial logs are retained.

| Required row | Result / witness |
| --- | --- |
| Real admission retains risk and edges, stamps exclusion purely | GREEN, original candidate unchanged |
| Exact omission disclosure through not_represented | GREEN, one copy through real fixture registration |
| Omission present with one or more excluded risks, absent with zero | GREEN, helper and actual sent Run reply |
| All negative goal paths: may be too high | GREEN, direct/indirect/all-path cases |
| Mixed, unknown, no sign or no goal path: may move | GREEN, helper and sent Run cases |
| User-authored/from_brief or user-named risk never excluded | GREEN; shared usersRisk, no copied predicate |
| User-sized incident link never excluded | GREEN; every incident link inspected |
| User likelihood never excluded | GREEN; singular/plural hold independently misses usersRisk; both held and cause-refused claims protected |
| Definitional addend never excluded | GREEN |
| Conservative label/metric constraint match never newly excluded | GREEN; metric-only contrast included |
| Option intervention target never excluded | GREEN, actual target survives without Run refusal |
| Natural-unit risk remains included | GREEN |
| Excluded risk and both incident edges absent from actual PLoT payload | GREEN through createRunAnalysisHandler |
| Risk links no longer listed by existing chance gate | GREEN; separately stated core stays sized, original-risk twin still withholds |
| Caveat immediately after chance evidence on face | GREEN; multiple findings, driver, styled canonical/date words, accepted own words, quote restyling, single copy |
| Last composer remains the final writer | GREEN, unchanged guard |

## Real-admission replay: 12 exact final provider outputs, zero LLM

Uses the last provider_calls[].output_text, including the adopted retry's final candidate. Original brief bytes and candidate/source bytes are hashed and checked. Callbacks are the real build-model brief-attestation callbacks, identical before/after. This is admission replay, without rewriting candidates or replaying the full builder preparation/registration/later held-goal-attributes pipeline. False here means this predicate no longer withholds, not a promise that every analysis gate passes.

| Draft | Withheld before | Withheld after | Additional excluded risks |
| --- | --- | --- | --- |
| two-risks/B1-d1.json | yes | yes | 2 |
| two-risks/B1-d2.json | no | no | 0 |
| two-risks/B1-d3.json | yes | no | 2 |
| two-risks/sealed-d1.json | yes | yes | 0 |
| two-risks/sealed-d2.json | yes | no | 1 |
| two-risks/sealed-d3.json | yes | yes | 0 |
| arm2-floor-plus-line/B1-d1.json | no | no | 0 |
| arm2-floor-plus-line/B1-d2.json | yes | yes | 1 |
| arm2-floor-plus-line/B1-d3.json | yes | no | 2 |
| arm2-floor-plus-line/sealed-d1.json | yes | no | 1 |
| arm2-floor-plus-line/sealed-d2.json | yes | no | 2 |
| arm2-floor-plus-line/sealed-d3.json | yes | no | 1 |

The four remaining drafts have independent sizing blockers; quantity risks and user risks stay included:

- two-risks/B1-d1.json: `monthly_churn→pro_paying_subscribers`.
- two-risks/sealed-d1.json: `starter_tier_monthly_price→starter_subscribers`, `support_cost_per_starter_subscriber→starter_tier_demand_shortfall`, `starter_tier_demand_shortfall→starter_subscribers`.
- two-risks/sealed-d3.json: `existing_plan_mrr→monthly_recurring_revenue`, `starter_tier_support_cost→monthly_recurring_revenue`.
- arm2-floor-plus-line/B1-d2.json: `monthly_new_pro_subscribers→pro_paying_subscribers`, `monthly_churn→pro_paying_subscribers`, `pro_plan_price→monthly_new_pro_subscribers`.

## Stored-graph indicative count: 16 exact P44 paths

Persisted risks do not retain the candidate unit declaration, so these cloned-graph counterfactuals are indicative only. Stored unit/frame evidence, non-placeholder links, definitions, user naming/authorship/likelihood, option targets and constraint matches veto the indicator. Source paths and hashes are in replay.json; no P44 file was changed. Existing exclusions are preserved.

| P44 graph | Withheld before | Withheld after, indicative |
| --- | --- | --- |
| d01-B1 | yes | yes |
| d02-B1 | yes | yes |
| d03-B1 | yes | yes |
| d04-B2 | yes | yes |
| d05-B2 | no | no |
| d06-B2 | yes | no |
| d07-B3 | yes | yes |
| d08-B3 | yes | yes |
| d09-B3 | yes | yes |
| d10-UNSEEN | yes | yes |
| goalreach/draw-1 | yes | yes |
| goalreach/draw-2 | yes | yes |
| goalreach/draw-3 | yes | no |
| goalreach/draw-4 | yes | yes |
| s2j/out | yes | no |
| stall-witness/p44-stall-cut-1791444936035 | yes | yes |

## Mutants

| Mutation | Witness | Restored |
| --- | --- | --- |
| user-named-excluded | RED: Tests  1 failed | 14 skipped (15) | yes |
| limit-veto-dropped | RED: Tests  1 failed | 1 passed | 13 skipped (15) | yes |
| caveat-dropped | RED: Tests  3 failed | 10 skipped (13) | yes |

The user-named mutation removes the shared usersRisk veto. The limit mutation removes predicate (d) from exclusion. The caveat mutation drops the omission producer and fails three actual sent-reply rows. These are assertion REDs, not import/transform failures. mutants.json pins original and mutated SHA256 values; manifest.json pins final files. The runner can resume after a load-gate refusal while reusing only byte-matching restored witnesses.

## Verification and judgement calls

Every test/replay run followed the exact load gate; tests used at most two files, one worker, --configLoader=runner and /dev/null input. Load refusals prevented runs. Source typecheck and targeted lint pass; final logs are typecheck-final.log and lint-final.log. No full importer sweep or CI was run; the brief leaves the other importers to CI.

| Final suite batch | Tests |
| --- | --- |
| unitless-risk-exclusion + construction-product-goal-extra-parent (green-admission-final.log) | 43 passed |
| unitless-risk-chance-caveat + unchanged reply-composer-last-writer (green-caveat-guard-final.log) | 35 passed |
| goal-chance-screen-lines + stated-event-risk-draft (green-neighbours.log) | 40 passed |
| goal-chance-screen-lines.route + goal-chance-screen-lines.explain.route (green-routes-final.log) | 17 passed |

- Predicate (d) is deliberately broad: any shared three-character-or-longer alphanumeric metric word protects the risk; an empty metric also vetoes. All declared constraints protect even if their provenance is uncertain. No synonym or numeric meaning is inferred.
- An explicit authored incident link also vetoes the new exclusion, even when its size is absent. This conservative protection is needed to keep the mandated extra-parent neighbour's existing user-link contract green. User_set and from_brief authorship are explicitly protected by the exported shared usersRisk.
- Both held likelihoods and likelihoods refused for an incoming cause veto exclusion: a refused representation does not make the user's probability disposable. Qualitative option changes also conservatively protect their target.
- Existing extra-parent exclusions are preserved and retain their existing disclosures; this rule never reverses or double-discloses them. The caveat uses the approved paired persisted carrier (risk kind, retained_excluded and ai_inferred), with no added reason field or risk re-include writer. It therefore identifies the existing draft-time producer family, not a new independently persisted subrule tag.
- Negative direction is earned only when every reachable goal path is negative. Unknown/mixed signs or no path say may move. Traversal is bounded to three signed states per node, including malformed cycles.
- The placement helper relocates exact existing omission copies to one location and reuses the existing chance-word matcher for styled evidence. Without displayed chance evidence the caveat still stays visible before the existing questions toggle. The composer preserves ordinary robustness-caveat ordering.
- A lever whose only goal path goes through an excluded risk may remain blocked by existing gates. Those gates are unchanged; this work proves the bounded PR-1 behavior, not universal chance readiness.

Replay commands and scope details are in REPLAY-README.md. The local replay script is replay.ts, the comparison artifact is replay.json, and the immutable base snapshot is replay-baseline.json.

Scripts, logs and the replay JSON are kept in the lane evidence folder (unitless-risk/codex-evidence/), not the repo. Author re-ran: new rows 44; reply-composer-last-writer + screen-lines route 19; compose-reply restatement 26; construction extra-parent 28. Supabase diff is empty.
