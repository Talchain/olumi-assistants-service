<!-- v4, updated 3 Oct 2026 by the assigned Codex delta writer after the adversarial review. Source documents sit in this same folder. Historical evidence in §3 retains its original scope. -->

# Olumi model upgrade — implementation delta and handover (v4, 3 Oct 2026)

> **For the session or person taking this over:** read §0, then §5. §2 records the review corrections. §3 is historical evidence, not a current deployment audit. This is now an active implementation handover: the lease-amendment request is posted; code, test and release rungs must be recorded separately.

---

## 0. HANDOVER — start here

**Authoritative update, 3 October 2026 10:04 UTC — PARKED / HARD STOP-AND-BANK.** Both B3 components are merged and actually served: CEE #2537 source `537d5280062a2b8597c902c7089d6840d531f207` → staging `ef65fe160eb58f37b2a40f5c2d236dcbe81b2a58`; UI #2458 source `7299524769adb31d0898760ec73860356199ff87` → staging `b412cd8deb8ed5cee9f2c8197e24c2006afe36ba`. Existing Delivery Executor receipt [5967555552](https://github.com/Talchain/olumi-programme-docs/issues/85#issuecomment-5967555552), independently confirmed by PTL5967571610, proves automatic Render/Netlify identities. Current frontend: https://6ac0c4691a76d50008e75791--olumi.netlify.app. PLoT4526e4322764ba9b33690cdcd87320bc9e77261f / ISL842254da5aab6ff9aa8caf9c2ace1a59cc42e600. Mandatory exact-head gates and independent final HIGH complete; inherited failed advisory rows stay failed.

Both local writer clones are clean at the source heads above; no B3 process remains. Overnight automation is PAUSED. Current restart bank is `OLUMI-B3-RESTART-SAFE-2026-10-03/RESTART-HERE.md` beside this file; read it first after reboot. Programme [5967939666](https://github.com/Talchain/olumi-programme-docs/issues/85#issuecomment-5967939666) forbids new implementation until the master census closes.

**Acceptance remains PARTIAL.** R and D are UNCLAIMED. Matching-current-tuple pricing+sprint approval/readback/rerun/Compare/cold-reload is NOT_OBSERVED. Existing B1→SCI original guest read action is COMPLETE/STOP on old immutable UI622; natural reload included graph/readiness POSTs, provider ledger and storage revision remain unattested, and there is no demonstrated same-case current-UI continuity (PTL5967769291). Do not reopen it with copy/reset/auth/newscenario/provider actions. Constraint recurrence remains INCONCLUSIVE. Paid and capacity holds persist. Earlier timestamps below are historical and are superseded by this update.

**Deliverable.** ONE bounded B3 repair with TWO explicit milestones:
- **Milestone R (repair served):** B3-7 (inferred objective offered, non-blocking, on the visible ask surface) + B3-8 (a licensed leader carries a truthful, coverage-stated disclosure of the Olumi-authored inputs it rests on), served on staging and witnessed on the pricing and sprint briefs with reload.
- **Milestone D (demonstration):** a substantive challenge or alternative → a supported model change → an intelligible consequence or evidence test → save → reload. Joins B3-5 (per-seat option resolved) only when its mechanism is proved. **R does not complete D. Do not label D complete early.**

**Historical programme state (verified through 3 Oct 00:29:23Z; later rulings below and checkpoint supersede it):**
- DL **4563ad** accepted successor control (5962859978), then reported 95% usage and transferred sequencing to successor PTL (5963409587). Old PTL stood down (5963382898); successor PTL receipts 5963490942/5963498690 require an acknowledged credential-holding integration successor. Reviewer availability remains a dependency.
- **B2 #2527 and history #2528 are merged/served** at 9bc21041 and 752c487b. Compare #2525 remains under repair; #2524 remains before B3. Canvas remains held until Compare is served. Delta lease ACK 5963116124 requires a separate PR and shared route hunks after history/#2524.
- Paul assigned this Codex chat the bounded B3-7/B3-8 + measurement delta. Core B3 has an acknowledged lease (5962897346), branch `b3/model-fidelity-admission`; its named remote ref/open PR was absent at the initial check. By 3 Oct 00:20Z, core B3 had pushed [#2530](https://github.com/Talchain/olumi-assistants-service/pull/2530) at `cb0a3a85fa43861ecfeea4f85584d9a35edba5f0`, based on 752c487b; its route file is untouched. Review/CI/served evidence remain separate. Keep the delta file-disjoint and sequence shared hunks.
- Capacity truth (5963328643): the named Claude “cloud” lanes actually run on this Mac. One test process per lane, maximum two workers; 5963254028 holds local installs/full gates until free disk exceeds 20 GB. No remote runtime was demonstrated for this delta. Successor PTL reconfirmed the delta gate hold in 5963587914; no focused-suite substitution is authorised.
- Independent CODEX buddy = `/root/b3_codex_buddy`; MG 0ebb952a supplies domain review/support; DL supplies HIGH verdict. Independence is a separate reviewer/session, not a different model vendor. MG does not silently replace the required Codex buddy.
- RC dedicated lane **PARKED** (5962307459): the writer owns the sentence wording, with AI HARNESS / R3 acceptance. No RC hand-off.
- Hotspots (one writer, DL-sequenced): those above plus `agent-v1-turn.ts`. The delta needs small route hunks for ask recognition/dedup/replay and disclosure assembly; they are named in the amendment request and wait for sequencing. Admission, drafter, final-egress, run-analysis and agent-capabilities changes are outside this delta.
- C acceptance freeze Sat 3 Oct 10:00Z; PTL runs D1 + fresh pricing by 14:00Z.

**Latest execution state, 3 Oct 05:55Z.** Pricing #2533 is merged at CEE `ff5a2c253a61d7a64c40d10e3cc00d4e8827f2da` and actually served: Render `dep-db095otg1s2s738gapb0` LIVE05:32:21Z, public build matched05:34:11Z; receipts5966023194/#875966023097. Actual tuple UI622ac235 / CEEff5a2c253 / PLoT4526e432 / ISL842254da. Pricing final HIGH5399181467 and its full gates are complete. Its remaining boundary is original B1→SCI joined acceptance. The original caseb04becba reached one natural provisional Run/cold canonical read with scope/withholding retained; further paid actions paused because the complete original provider ledger was not captured. Existing Executor has durably cleared the serving hold under the PTL nonconflicting external-stop rule (see checkpoint receipts), preserving the same case/UNKNOWN budget and no new B3 provider trial.

**B3 current candidate:** [CEE #2537](https://github.com/Talchain/olumi-assistants-service/pull/2537) remains published at old reviewed `b35ed5db177cebd86f360240b7885088c6ceda04`; [UI #2458](https://github.com/Talchain/DecisionGuideAI/pull/2458) remains unchanged `bc90486b9467853bca9d360607ce74e84990abf8`. Own local CEE rebased cleanly onto servedff5 at `c4db7ef73d5fcdede5722c4bec24d860cb4d7dee`, all6old commits byte-equivalent. Oldb35 is preserved at `b3/reviewed-b35-before-pricing`. No dependency refresh/change. Static/schema/build/ratchet290<=291/pinned guards passed atc4, but no full gate or approval transfers to this descendant.

**Concrete integration repair, current freeze 2026-10-03T06:37Z:** scopedisplayfixfcb222GREEN remains banked. Run-replay/history fix63f9 closed rawID return/repeatedobjective (actual4RED/71controls→224GREEN;3mutants2/3/9). Independent buddy then found raw hidden narrator objective interaction before full; formal63f9SOURCEPASS explicitly withdrawn. Actual successfulbuild2RED/9controls→10files227GREEN;remove2/overtrigger7 killed/byte-restored. Clean combined CEE `8f94a41eb31af263d6f4f12d1767172530dd596b` / tree `43546ca426fd1c63744e782e4411e0f85c4a7986` factors the existing raw host ask once, normalizes only its exact narrator copies with the existing display scrub, and retains the same eligibility/history/permission/pending authority. UIbc unchanged. Both fresh buddy/formalwholeintegrationSOURCEHIGH PASS; restored78GREEN/typecheck/lint/schema/build/ratchet290<=291/pinnedguardsPASS. Mandatoryfullno-pathRUNNING since06:41:11Z, oneforegroundworker/session96917; no sourceedits during it. Full63f9/fcb neverstarted; dddfull130NOT_PASS, logs preserved.91base/finalunique source anchors re-derived,0ambiguities. No newpush/provider call, R/D unclaimed.

**Latest gate correction,07:24Z:** full8f94completed2423.97s/rc1:3154files/54308testsPASS,2stale source-wiring pins expected old narration.text;1expectedfail/179skip/12todo. ExactFAILEDresult/logSHA0272c0aab2bbf12431d693f4fcf5c68244d98f7ed0b9ceb1ff6537507728cc42 preserved. No push. Clean test-only CEE `537d5280062a2b8597c902c7089d6840d531f207` / tree `5de90acdf0290ab42940e8a66607b4fdeb56482c` strengthens only goal-chance/value-change wiring specs (2paths8insertions2deletions), retains every old semantic guard and verifies normalize→sameowed→finalreply.4files116GREEN. ALL product blobs/UIbc unchanged; Both currentbuddy/formalSOURCEHIGH PASS537d, allproduct8f94identical; fresh4staticPASS. MandatoryfullNO-PATH RUNNING since07:31:59Z/session16724,oneforegroundworker; no sourceedits. Publication helduntilcompletefull/currentreviews/remoteCI/FINALHIGH.91citations remappeduniquely to537d. Old8f94running description above is historical/superseded bythis completeFAILEDresult.

**Latest gate/publication,08:12Z:** CEE537d mandatory full NO-PATH completed rc0 at08:11:50Z:3156filesPASS/20skip;54310testsPASS/1expectedfail/179skip/12todo,0unexpected,2389.54s. Exact full-logSHA b385d675bc1edc7191c1b0e6d189772e5da32e91ec3d9c6ab878396275bf258f. All5same-head gatesPASS and bothSOURCEreviewsPASS. Foreground exactb35-lease update of existingHIGH2537 succeeded; remoteGit/API now537d, currentstagingff5 unchanged. UIbc unchanged; existing Executor owns one remote UI full run37108150404. FreshCEEremoteCI/independentFINALHIGH/soleMG actualCEEserve-beforeUI remain owed. No new paid journey or R/D claim. Prior RUNNING descriptions are superseded.

**Latest UI gate repair,08:26Z:** oldbc full37108150404 completedFAILED (newB3copy oracle-vocabulary conflict,1failure/7253PASS). PTL5967110853/5967111149 bounded repair: UI7299524769adb31d0898760ec73860356199ff87/tree075a61df007ac16ce1c488a7d59bd8bba11c2379 changes only comparison referent +mountedbroadercaveat assertion (2paths2insertions1deletion), guard/authority/filter/canonicalbinding unchanged. Real1RED/319controls→320GREEN, remove1/overtrigger1killed/restored320GREEN; scopedbuddySOURCEPASS; nativefreshprepushALLPASS/609criticalsmoke/TC2059 unchanged. ForegroundnormalFF existingUI2458 update verifiedGit/API729. ExistingExecutor owns one fresh729 remote full; CEE537d unchanged full0/currentremoteshards pending. ExactpairFINALHIGH/serve stillowed, oldbcfull remainsFAILED. No paidcalls/R/Dclaim.

**Current release checkpoint,08:52Z:** both exact537d/UI729 mandatorygatesPASS. CEEfull54310/0unexpected +remoteRequired4/aggregate/Drift/CodeQLgreen. UI72937109795921 full6/summary/StagingGate/TS+selftest/build/securitygreen; CEEContractValidation111164878658green. VisualadvisoryFAILED34/19pass/completeness4of10 matches served622 case/errorfingerprints; PTL5967321720/5967322178 exactpair inheritedadvisory accepted, no pixel/browsergreen. Existing independentFINALHIGH finishing; then soleMG guardedCEEactualserve-first→UI. No source/test/provider action, R/Djoinedunclaimed.

**Current independent approval,08:54Z:** exact537d/UI729 FINALHIGH APPROVE receipt5967344790; commit-bound COMMENTreviews5399800842/5399801048 independently APIreadbackverified againstbothheads. AllmandatorygatesPASS, inheritedvisual/CEEfailedjobs retained. ExistingsoleMG owns guardedCEEmerge→actualautomaticRenderLIVE/fullSHA/publicidentity→UIrelease/Netlifyactualidentity. PRs stillOPEN at08:53 directmetadata; previewmergeSHAs are NOT merges/serving. No sourceedit/newtest/paidcall, R/Djoinedunclaimed; stopheartbeat09UTC.

**Morning cutoff09:00UTC:** CEE2537 merged08:56:34Z at ef65fe160eb58f37b2a40f5c2d236dcbe81b2a58/tree5de90acdf exactreviewedtree, parentff5. ActualautomaticRender dep-db0c6h3tqb8s7388q8u0 LIVE08:58:40Z +matchingpublicbuildHTTP200 verified08:59:23Z byexistingExecutor. UI729 finalapproved/mandatorygatesPASS remainsreleasepending; actuallyservedUI622 atlastproof. ExistingsoleMG owns remainingUImerge/Netlifyverification; no newwriter/controller. ThiswriterheartbeatnativePAUSED atcutoff; checkpoint/concise morningcard retainactualtuple/remainingfreshworkspacesandpaidpause. BackendSERVED is notjoinedR/D; R/Dunclaimed, recurrenceINCONCLUSIVE.

**Review and release ownership:** PTL5965658295/#875965658469 assigns existing Delivery Executor `01a0ff01-4aa4-7982-9f2e-891fac9475ab` as MG successor and independent CODEX CEE BUDDY `01a0e9db-482e-7371-9447-e5099c3f30e9` as formal HIGH successor. Oldb35/bc SOURCE/FINAL HIGH APPROVE5965840205 and commit-bound reviews5399122213/5399122336 remain banked only for those heads. Shared-account native self-APPROVE is not claimed. Historical MG0ebb952a/DL4563ad are superseded.

**Current release order:** PTL5965970249/#875965970482 explicitly removes core2530 as a required predecessor for this bounded B3 pair. Pricingserved→original B1→SCI witness completes OR genuine external/runtime nonconflicting blocker durably receipted→fresh reviewed/gated B3 CEE-first (or reviewed joined wire train). Core2530 retains its own writer/lease; no core-fidelity or demonstration claim. B3 has no merge/deployment, R/D or joined pricing+sprint cold acceptance. Constraint recurrence remains INCONCLUSIVE. Pricing serving hold is CLEARED by the existing Executor at the genuine nonconflicting evidence-capture stop; source/gates/HIGH/MG/mergegate still govern B3. Capacity exception permits only this one foreground worker/minimum own frozen refresh below20GB. No new controller, clone, paid journey or background push/merge.

**Continuation checklist (completed work is in the checkpoint; do not restart it):**
1. Read this file. Do not run `session-start-derive.sh` wholesale: its line 101 calls `/healthz`, contrary to the current prohibition. Use the bounded GitHub + Render derivation below.
2. Read #85 with `since=` from the last recorded receipt, polling no more frequently than every 120 seconds: shared-hunk sequencing, isolation rulings and witness windows.
3. Confirm the served tuple (CEE staging head + Render live via `tools/renderlive.sh`, programme-docs `dl/claude-27fbe09b`; never poll `/healthz`). Code citations below are at CEE `9a9bf022…`; re-derive every line.
4. Amendment request posted: https://github.com/Talchain/olumi-programme-docs/issues/85#issuecomment-5963071165 (DL/PTL, cc MG/HARNESS; writer, buddy, chain, route hunks, policies). ACK 5963116124 received; shared route hunks authorised, separate PR after history/#2524. Do not repost duplicate chases.
5. Reuse the clean CEE/UI clones and committed delta listed below; no duplicate clone/writer/controller. Source producer, actual label writer and all ask consumers are mapped historically in `current-cee-source-citations.json` at895/b35; `pricing-cee-source-citations.json` re-derived79unique anchors atff5/c4. Refresh final corrected-head citations/review/gates before push.
6. RED rows first (§6), each with an untouched control and a mutant that removes AND one that over-triggers the behaviour. Zero collected tests = could-not-measure.
7. Build B3-7, then B3-8, through existing machinery. CEE gate = `vitest.required.config.ts` with NO path + `scripts/ci/typecheck-ratchet.sh` + `prepush.sh <tree>` before every push; specs need dummy `VITE_SUPABASE_URL`/`ANON_KEY`.
8. Record before/after `computeAnalysisAffectingGraphHash` on the pricing and sprint fixtures in the PR body (expected unchanged for pure disclosure).
9. Push foreground; verify with `git ls-remote` + `gh api`. PR title `[HIGH]`. REVIEW-READY on the PR + #85 with the gate log (0 failures) and mutants. Independent Codex buddy + MG review + successor DL HIGH verdict.
10. Merge only via `tools/mergegate.sh` (renderlive + holdcheck), one CEE merge at a time, outside any `WINDOW OPEN` / "RUN STARTS NOW" post; scratch-merge onto today's staging first. Never `main`, never from a background job. Then R3 witness rows (pricing + sprint, with reload); Paul's signed-in look is Paul's.

**Budgets and traps:** BUDGET line before any paid run, abort on first 429, honour active runs on #85; watchers `since=` ≥120 s; delete only task-owned `/private/tmp` trees after the relevant verdict (`git worktree list` first); zsh does not word-split; macOS bash 3.2. No borrowed `node_modules` or copied `.env.local`.

**Author cleanup completed:** the four named clean clones beneath `/private/tmp/claude-502/-Users-paulslee-Documents-GitHub/32a91d1a-6d63-4b88-a458-3ff6af119452/scratchpad/agent2/` had no linked worktrees and were deleted, along with the ten enumerated `.ts`/`.md` scratch copies beside them. Original `.txt` inputs and the unlisted `.tsx` copy were retained.

**Current task checkout:** `/private/tmp/olumi-b3-delta-20261003.62tEvb/cee`, branch `b3/model-upgrade-delta-7-8`, baseff5a2c253a61d7a64c40d10e3cc00d4e8827f2da (local integrated candidate; old remoteb35 remains); UI clone branch `b3/model-upgrade-delta-7-8-ui`, base622ac23570690d0056a45bbc152c49e44d2b262d. Own frozen installs refreshed under PTL01:56 exception. Zero experimental live-data writes/provider calls.

**Inputs:** the three documents + 9 screenshots in `output/Pauls manual test 011026/`; ChatGPT brief v0.2 (`~/Downloads/Olumi_Model_Upgrade_Review_Brief_v0_2_2026-10-02.md`); Codex review (pasted 3 Oct); #85 5956160243 · 5959007568 · 5959070402 · 5959278854 · 5962102719 · 5962307459 · 5962348405 · 5962496956; SSOT @27069241; Supabase `Olumi` `etmmuzwxtcjipwphdola` (shared with PROD, reads only): scenarios `5400c082-6de3-4450-b969-7f95aa8fca47` (pricing) / `8e8e8a6d-5910-4fbf-9f7e-affe35fa06d9` (sprint), `v5_conversation_turns`, `model_versions`. SHAs: schemas main 55a72e62 (0.75.0) · CEE staging 9a9bf022 · PLoT 4526e432 · DGAI a521c6b7.

---

## 1. Verdicts
- **Brief v0.1 → REVISE. Brief v0.2 → ACCEPT with three refinements (§2.1). Codex review → ACCEPT all seven findings; §5 amended accordingly (§2.2).**
- **Audit → ACCEPT all four defects**; corrections: disclosure + withholding already served; live defect = a leader licensed on one user-stated parameter while resting on Olumi's others; sprint evidence is a scripted 0-LLM session; "5,181" is a `model_versions` monthly count (88 / 1,855 / 3,238).
- **First-principles review → ACCEPT the six design choices as acceptance criteria; comparison study off the critical path.** Headline gap = per-claim dependency coverage.

---

## 2. What the two reviews changed

### 2.1 ChatGPT v0.2 (checked at CEE 9a9bf022)
| Point | Verdict | Evidence |
|---|---|---|
| No blanket confirmation gate; confirm ≠ evidence | ACCEPT; my earlier gate was wrong | `analysis-admission.ts:902-938` `user_ratified` tallies as machine-authored; mode ladder `none/exploratory/quantified_provisional/comparative_leader` (:227-231); floor `material_parameters_user_stated > 0` (:1072) |
| Claim control exists; completeness is the question | ACCEPT; gap now precise | one user-stated material parameter satisfies the authorship floor, not the whole leader licence; `leader_claim.permitted` also depends on the current Run, separation and limits. The candidate-id list is partial |
| Hash finding partly wrong | ACCEPT | `graph-hash.ts:22` imports `CANONICAL_GRAPH_HASH_NESTED_PROJECTION`; node fields vocabulary-driven (:309), edge provenance (:360); edge/option/intervention/observed_state hand-written. Node `provenance` not hashed. Measure, never assert |
| No PLoT "ignore unknown kinds" | ACCEPT | explicit projection, named exclusions, withheld dependents |
| Opt-in ≠ data isolation | ACCEPT | branch + storage doubles + 0-LLM replay; preview is a separate dependency; sequencing choice §5.5 |
| Check while building; paired generations only where variable | ACCEPT | two historical drafts differed; recurrence under the same brief/route/config remains unmeasured |
Refinements: objective offer must be non-blocking; the positive capability is B3-5, not a new SCI item; §6 rows are the executable "accept or refute".

### 2.2 Codex review (3 Oct; every citation verified at the SHAs)
| Finding | Verified? | Consequence in §5 |
|---|---|---|
| B3-7 on `analysis_ready.user_questions` is the wrong surface: DGAI shows it only in `needs_input` (`DecisionOverviewCard.tsx:821`); the target ask is produced by the host (`decision-input-ask.ts:132-158`) | **YES** | B3-7 extends `decisionInputLines` (the host's ONE-ask writer), prioritised over the target ask |
| `threshold_source` attests a target figure, not objective acceptance (`stated-by-user.ts:275-323`) | **YES** | objective acceptance needs its own carrier (find, don't invent); a user-set number does not suppress the offer |
| `material_parameters_awaiting_user_node_ids` is not a dependency inventory: node ids only (`baselineReachesTheOrdering` = factors), no edges, includes `unattributed`, includes a factor every option sets ("KNOWN REMAINDER" :846-852), excludes exogenous roots by design (:746-751) | **YES** | B3-8 treats it as candidate ids, filters, reads `observed_state.source` before naming Olumi, and states coverage ("factor baselines on this comparison's path") |
| UI reader collapses absent/malformed/empty to `[]` (`materialParametersAwaitingUser.ts:35-75`, deliberate) | **YES** | disclosure composed server-side; "known empty" vs "basis unavailable" kept distinct; never attribute unknown origin to Olumi |
| `leader-final-egress.ts:260-261` returns licensed responses unchanged → not a disclosure producer | **YES** | B3-8 goes through reply composition / result presentation; the hotspot is untouched |
| Constraint *presence* is too weak a criterion; six generations prove nothing | ACCEPT | semantic retention and computational use measured separately; captures first; ≤3 paired generations |
| B3-5 "add seats + value + edge" does not prove seats × price economics (goal identity is price × subscribers) | ACCEPT | two milestones R and D; D requires a supported mechanism and consequence |
| This chat owns the bounded delta | Paul's direct allocation governs | DL/PTL still sequence shared hunks and release; the staffed core B3 lease is a coordination boundary |
| Policy defaults (isolation: demonstrated before connected writes; objective UX: visible question; disclosure: inline, existing fields) | ADOPT as defaults pending PTL ruling | §5.5 |
| Neutral framing wording | ADOPT with the one-ask constraint; the ask must end in a recognisable suffix for dedup/replay | §5.1 |

---

## 3. Evidence (keep for citation)

**Pricing `5400c082` (15:22Z, 3 LLM calls, auto-run 0 LLM):** 300 / 20 / 3% all `cee_inference`; reply discloses them and withholds the leader because the MRR identity is unconfirmed (`nonlinear_identity {product, stated_in_brief:false}`); no churn→subscribers edge; 7/7 non-structural edges `exists 0.8`, `defaulted`; `goal_horizon_months 12`; churn ≤4 constraint retained; `pro_plan_price` is `brief_extraction` and material → once the identity is confirmed the leader is licensed on it while 300/20/3% are Olumi's.

**Sprint `8e8e8a6d` (11:06:06→35Z, 0 LLM every turn, 3 auto-"accepted" edge rows in 3 s = scripted probe):** goal `quarterly_revenue` `ai_inferred`, no threshold; reply asks for the figure (presupposes the objective); `split_sprint_capacity` `proposed_by: olumi` 50/50; **no constraint node and no `goal_constraints`** (Paul's 1 Oct draft had "Total sprint capacity allocated ≤100% · Inferred limit"); signing likelihood 10% + 60 pp guessed; both runs withheld the ranking.

**September corpus** (programme-docs `claude/r3b-sim-evaluation-5df3vn` @5a3f8fb3 / `dl/cloud-context-20260927` @a6168b08; docs ISL `r3b/sim-prototype` @5d5309d0): 44/67 ✔ · 142 edges at 0.8 ✔ · 31/31 templated spreads ✔ · 101/142 under the hand mapping (111 mechanical) · 3/4 flips as documented · scorer 30% constant ✔ (`tools/graph-evaluator/README.md:276-281`).

**Carriers:** NodeKind = goal, factor, outcome, risk, action, decision, option, constraint — no question/assumption/unknown/evidence kinds; no edge relation kind; strength + `exists_probability` required on every edge; one required goal (`NO_GOAL`, `graph-structure-validator.ts:419`); `constraint` + `goal_constraints` exist; `observed_state.source`, edge `provenance.source/magnitude`, `defaulted`, `obligation-provenance.ts` authorship ruling; `unresolved_targets` → `needs_user_mapping` (drafter-only writer today); readiness whole-graph; pins schemas 0.75.0 · CEE 0.73.0 · DGAI 0.70.0 · PLoT 0.61.0. Widen gate rejects new factors (`widen-turn.ts:276`). Critic: legacy Pass-2 always on, agent-lane none (UNVERIFIED which path serves drafts).

**Preview/isolation: does not exist** (no Render preview config; `cee-proxy.ts:85`/`orchestrator-proxy.ts:31` hardcode cee-staging, CSP pins it; no per-scenario opt-in in orchestrator-v5; no sandbox column; hand-made `cee-native-context-trial` not test-ready).

**Branch protection:** CEE and DGAI `staging` `required_status_checks.contexts: []` and `rules/branches/staging: []` → "Required" checks not GitHub-enforced. Not authorised to change; one line to successor control.

---

## 4. The v0.1 flaws, final state
1 second programme → resolved (existing tracks). 2 preview assumed → separate dependency. 3 estimate-policy gate → withdrawn; code already encodes confirm ≠ evidence; replaced by disclosure. 4 carriers overstated → stands, with measure-the-hash and no-ignore-rule. 5 checks without controls → §6.

---

## 5. THE IMPLEMENTATION DELTA

### 5.1 B3-7 — the inferred objective is offered, visibly and non-blockingly
- **Producer:** extend `decisionInputLines` / `targetAsk` in `src/orchestrator-v5/agent-lane/decision-input-ask.ts` (the host's ONE ask per turn, said on the build turn and every Run; dedup by exact string in `recentReplies`; `decisionInputAsk` currently selects by `endsWith('as your target.')`).
- **Predicate:** exactly one goal with `provenance === 'ai_inferred'`; a numeric target does not suppress the offer. `threshold_source` and `goal_stated_as` describe numerical targets, not objective acceptance. Existing structural rename changes label/provenance only; its committed `edit_graph` receipt is authoritative and the display provenance is advisory. Prove the real write/read/reload path instead of inventing a goal-review field.
- **Priority:** replace the target ask with the objective ask on the first eligible successful build/run turn (one ask per turn; pending approval and an existing at-rest question still suppress a second ask). Copy: *"I used 'Quarterly revenue' as a provisional objective. What should this model help you explore?"* Use one shared internal recogniser for both ask kinds at all selectors, retaining exact rendered-text history dedup. Product wording must not be distorted to satisfy the old target suffix.
- **Behaviour:** run proceeds; the mounted Reasoning goal line discloses the provisional objective; rerun/replay does not duplicate the offer within the existing durable history window. A real user-authored label edit retires the label offer after persisted readback/reload. Do not call a rename a semantic replacement. Changes to quantity/unit/direction require their actual canonical edit path and analysis-input revalidation; preserve independent constraints and revalidate affected ones.
- **Hash:** node `provenance` not in the projection; prove unchanged on the sprint fixture.

### 5.2 B3-8 — a licensed leader names the Olumi-authored inputs it rests on, with coverage stated
- **Producer/consumer:** existing host reply composition plus mounted Reasoning/result presentation. Server prose alone does not update the result view-model: today's named list populates only `designationWithheldRemedy === 'estimate'`. Lease the smallest actual UI consumer change. Retain the current same-run `leader_claim.permitted`; no new licence.
- **Inputs:** use `material_parameters_awaiting_user_node_ids` as candidate ids, resolve against the bound Run and final submitted values, and omit baselines overridden by all actually analysed options only when the submitted semantics establish they are unused. Reuse existing value-authorship readers. Use canonical `structureProvenance` plus the specific `isAcceptedOlumiEstimate` marker, and the documented legacy `user_confirmed` case; the generic display-authorship table is not sufficient for that legacy case. The accepted marker distinguishes an adopted Olumi estimate from a bare user-invented `user_assumption`; the broad `user_ratified` census class is not sufficient to attribute authorship.
- **Copy/coverage:** name only verified Olumi-authored values; an existing unattributed value is "source unrecorded", not "not yet set". Names come from ids, never a hard-coded subscribers/churn example. State that the named coverage is comparison-path factor baselines; keep existing broader assumptions disclosure. Omit the proposed link count. Exogenous-root/edge estimates outside the list must not turn its empty result into an all-user claim.
- **Distinguish** absent/malformed/unresolved disclosure data from a known-empty candidate list. Empty means no named estimates within this limited census, not that every input was supplied by the user; preserve existing sentences where no named addition is warranted.
- **Bind** the disclosure to the displayed run, including after reload (served-bytes row; see the turn-vs-stored hash lesson: capture both writers).
- **Never** change `semanticQualitySufficient`, admission predicates, the drafter, or final egress unless a failing row proves it necessary.

### 5.3 Files (CEE at the current head; re-derive lines) and readers
- Change: CEE `agent-lane/decision-input-ask.ts`, a small disclosure helper and specs; leased `routes/agent-v1-turn.ts` ask-recognition/dedup/replay/disclosure hunks. DGAI existing mounted Reasoning goal and result view-model/display consumers plus their focused specs as required by the witness.
- Verify: current-run binding, canonical rename receipt/readback, admission census semantics, value-authorship helpers, Reasoning/result mount, questions-toggle split and transcript-free reload. No second admission/provenance authority or general dependency engine.
- Lease must name the file list; `decision-input-ask.ts` sits in HARNESS's K3 territory (header cites DL lease 5945974225) — tell HARNESS.

### 5.4 Constraint retention — measurement only (MG owns any drafter row)
1. Captures first (R3 fixtures, `cloud-context-20260927` corpus, the two scenarios): for each capacity-type brief, record quantity, operator, threshold, unit, provenance, persistence (`goal_constraints` / `constraint` node) **and** computational use (does it reach PLoT limits / the constraint verdict).
2. If recurrence is still uncertain and an isolated route is available: at most three paired generations (six generations), with identical verbatim brief and recorded route/model/prompt/config. Hard cap six total provider calls including routing/repair/retries; incomplete pairs remain inconclusive. BUDGET line first on #85; stop on first 429. No recurrence does not clear the defect. No paid run has started. Capture-first measurement is complete: Oct2 sprint submitted no constraints on either actual run; pricing submitted churn but per-limit verdict was unscored. September captures supply no matching sprint brief. Recurrence remains inconclusive. See [measurement](OLUMI-CONSTRAINT-RETENTION-MEASUREMENT-2026-10-03.md).
3. Any drafter repair = explicit scope amendment, not this delta.

### 5.5 Policy choices — defaults adopted, PTL rules
1. **Isolation:** local branch + storage doubles + 0-LLM replay now; connected experimental writes only after demonstrated isolation (Codex/Paul default). Op model v2's "staging is the sandbox" is the alternative; sequencing is PTL/Paul's.
2. **Objective UX:** visible question first; a held approval card only if the correction needs that transaction.
3. **Leader disclosure:** existing fields + inline conditional wording; a wire field only for a demonstrated consumer gap (then schemas minor, DGAI vendors first).

---

## 6. RED rows (each: RED on the named SHA · untouched control · mutant-remove · mutant-over-trigger · served witness)
**B3-7:** offer visible at rest on first eligible build/run · explicit/from-brief and real user-authored-label controls unchanged · a user-set numerical target alone does not suppress the inferred-objective offer · approval/existing-question/failed-run controls · rerun and replay dedup through actual route selectors · persisted rename/readback/reload retires the label offer without dropping constraints · original D1 fixture bytes unchanged, but its inferred-goal first ask changes under the explicit B3-7 predicate. Derived from-brief controls retain the prior target ask; no claim that the original D1 reply is unchanged (5963196833).
**B3-8:** current licensed result displays conditional disclosure in chat and the mounted result surface · all-user-stated control unchanged · actually unused overridden baseline omitted, excluded option cannot affect that predicate · unattributed-present numeric says source unrecorded · raw user_assumption vs user_confirmed vs accepted-Olumi marker vs confirm_pairing · empty candidates with exogenous/edge estimate cannot imply all-user inputs · absent/malformed/unresolved data remains distinct · stale/withheld result gains no leader · same bound disclosure after transcript-free reload.
**Pure disclosure:** analysis inputs, permissions, and measured fixture hashes unchanged (digests in the PR body).
**Milestone D (separate):** challenge/alternative → supported change → changed consequence or evidence test → save → reload; control = untouched journey.

---

## 7. Order, estimates, backlog
**Order:** #85 receipt → lease amendment (writer, buddy, files) → RED rows → B3-7 → B3-8 → gate → buddy + MG + HIGH verdict → mergegate after #2524 in the PTL order → Render live = head → R3 rows → Paul's look (Milestone R). Milestone D joins B3-5 when proved.
**Estimates (planning ranges, not promises):** B3-7 3–5 h · B3-8 4–8 h · rows/mutants 3–4 h · integration 4–8 h plus the current DL queue · constraint measurement 1–2 h, with at most three paired generations and the separate six-provider-call cap. Preview provisioning, reviewer availability and merge sequencing are separate dependencies; no guaranteed 24-hour served result.
**Parallel / next (owned elsewhere):** B3-1…B3-6 (B3 writer) · SCI-HERO/CHANGE/TEMPORAL · smallest typed carrier for the prospect's prerequisite, proven neither coerced to a coefficient nor dropped · saved action / evidence test.
**Not this delta:** Living Model store · relation-kind schema change · universal compiler · simulation code · migration · scorer reweighting · comparison study.

## 8. Corrections to circulate with the three documents
Audit: scripted sprint session; constraint absent; disclosure + withholding already served; 5,181 = monthly count (state the query); 101/142 = hand mapping. FP review: six choices = acceptance criteria; headline gap = dependency coverage. Brief: v0.2 + this file supersede v0.1.

## 9. Re-verification
SELECTs in §3; `gh api …/issues/comments/{5962348405,5962496956}`; `gh api repos/Talchain/olumi-assistants-service/contents/src/orchestrator-v5/agent-lane/decision-input-ask.ts?ref=9a9bf022…` (:132-158); `…/leader-final-egress.ts` (:260); `…/admission/analysis-admission.ts` (:734-1018); DGAI `DecisionOverviewCard.tsx` (:821) and `materialParametersAwaitingUser.ts` (:35-75) at a521c6b7.

## 10. Implementation checkpoint — 3 October, unpushed

Lease ACK: [5963116124](https://github.com/Talchain/olumi-programme-docs/issues/85#issuecomment-5963116124). Status receipt: [5963523325](https://github.com/Talchain/olumi-programme-docs/issues/85#issuecomment-5963523325). CEE base is `752c487b4392cb1ccd299d0ebae4a039e6696ade`; UI base remains `a521c6b754c7117036e3d4c646a6bb4737efaf84`.

- B3-7 extends the host's one-ask writer, all three recognisers and durable replay. Mounted Reasoning discloses the provisional label; numeric-target ownership never suppresses it.
- B3-8 adds named bounded disclosure to current licensed reply composition/replay and the mounted result through existing fields. Known empty differs from unavailable; accepted, legacy-confirmed, bare assumptions and unattributed inputs stay distinct. Failed/excluded options cannot make a baseline appear used.
- Focused GREEN: CEE 127 tests (including route storage/replay and rename writer); UI 50 tests (mounted result, real currentness subscription and production hydration's UNKNOWN hold). These are writer/store contracts, not an end-to-end persisted-report mapping or served reload witness.
- Six explicit remove/over-trigger mutants killed: B3-7 remove 4 RED / over-trigger 1 RED; B3-8 remove 9 RED / over-trigger 2 RED; UI B3-8 remove 9 RED / stale over-trigger 2 RED. Every source was restored. Evidence logs and runner are in `/private/tmp/olumi-b3-delta-20261003.62tEvb/`.
- Disclosure fixture hashes unchanged: sprint `f34bc5e3a047ff4c` before/after; pricing `f3009a6e58c60480` before/after. Original fixture bytes also unchanged. Full digests are in `fixture-hashes.json` and the measurement data.
- Local commits CEE `3bcee7083262f2295eb17d3fade4a5b9e3becc6e`, UI `725ef2a57b4d16a7b43a3e08f8a61b33d987895f` preserve the patch. No push/PR/merge or new provider call at this checkpoint. Full gate remains held by the >20 GB capacity rule; bounded slot/ruling requested at [5963559446](https://github.com/Talchain/olumi-programme-docs/issues/85#issuecomment-5963559446); MG/DL HIGH, merge sequencing, serving and R3 pricing/sprint reload witnesses are outstanding. **Milestones R and D are unclaimed.**

### Current base citations re-derived at 752c487b

These are staging-base lines, distinct from the uncommitted delta's changed line positions. Historical citations in §2 retain their original SHA scope.

| Reader/boundary | Current file and verified lines |
|---|---|
| Host ask producer/target/selector | `src/orchestrator-v5/agent-lane/decision-input-ask.ts` 132, 155, 162 |
| Route durable ask/replay/composition | `src/routes/agent-v1-turn.ts` 431, 1716–1749, 3003–3036 |
| Admission factor candidate scope/remainder | `src/orchestrator-v5/admission/analysis-admission.ts` 746–751, 846–854 |
| Ratification and user-stated floor | same file 902–938, 1073; mode vocabulary 227–231 |
| Hash vocabulary/node/edge projection | `src/orchestrator-v5/context/graph-hash.ts` 22, 309, 358–360 |
| Licensed final-egress pass-through | `src/orchestrator-v5/agent-lane/leader-final-egress.ts` 260–261 |
| Numerical target ownership | `src/orchestrator-v5/agent-lane/stated-by-user.ts` 275–323 |
| Canonical element/value authorship | `src/cee/graph-readiness/obligation-provenance.ts` 540; `src/cee/transforms/provenance-display.ts` 420 |
| Actual label writer | `src/orchestrator-v5/system-events/structural-rename.ts` 587–597, 883–895 |
| Canonical graph reader | `src/routes/assist.v1.scenario-graph.ts` 597–601 |
| Required goal violation | `src/orchestrator/graph-structure-validator.ts` 420 |

Re-derive again after the next base change and at the pushed review head.

### UI shared-file coordination

SCIENCE UI receipt 5963583773 proposed a lease for `analysisNewTypes.ts` (science finding optional fields) and `buildAnalysisNewViewModel.ts` (`voiFinding` only) remotely. This delta changes the `AtAGlanceVM` field, `buildAtAGlance` result and hook inputs; the hunks are separate. That VOI UI scope was subsequently parked by SCI-HERO (5963595108); no active overlapping implementation is assumed. If reopened, rebase/integrate once; neither lane owns the other's hunk.

### Final local checkpoint

Independent Codex buddy: **PASS implementation review** at CEE `3bcee7083262f2295eb17d3fade4a5b9e3becc6e` and the final UI head at `725ef2a57b4d16a7b43a3e08f8a61b33d987895f`. No release approval is implied. Latest partial-result counterexample was collected RED before the correction; final focused counts are 127 CEE and 50 UI.

Portable patches are saved beside this file: `OLUMI-B3-7-8-CEE-2026-10-03.patch` and `OLUMI-B3-7-8-UI-2026-10-03.patch`. Task-root `EVIDENCE-CHECKPOINT.json` records exact heads, logs, mutants, fixture hashes and the unrun full gate. Use these to transfer the patch to a genuinely remote executor; do not duplicate the builder. No push or PR exists for this delta.

Final board receipt: [5963659044](https://github.com/Talchain/olumi-programme-docs/issues/85#issuecomment-5963659044). Capacity hold remains; independent buddy closes at both exact heads with PASS implementation review.


## 11. Overnight continuation — 3 October 01:12Z

Paul explicitly authorised overnight execution, acceleration and lead alignment. [Goal/plan receipt](https://github.com/Talchain/olumi-programme-docs/issues/85#issuecomment-5963736645) is posted; existing integration lead and operational Delivery Executor `01a0ff01-4aa4-7982-9f2e-891fac9475ab` received the exact checkpoint. The latter ACKed operational release ownership; PTL retains sequencing. This delta is not a second release controller.

- Current local CEE stays `3bcee7083262f2295eb17d3fade4a5b9e3becc6e`; UI is now `b44faa269dff1ac39289abb5b922c18bfb910782`. The owned display guard now keeps a named current licensed basis visible when the producer supplies no stability verdict. Primary UI 51 tests and adjacent AtAGlance 61 tests pass; restoring the old guard is killed by the new regression. Independent Codex buddy **PASS scoped implementation** at both exact heads. No HIGH/served approval is implied.
- A real canonical read → mapper → store → results hook → mounted result test demonstrates a remaining consumer gap. Its corrected stale control uses the shared schema, a stored report and affirmative `complete_stale`/non-fresh preconditions; no invalid-fixture pass. One intended census-loss RED, two controls GREEN. This synthetic supplied-census test isolates the UI loss; it is not a served producer-consumer witness.
- The producer row uses the existing captured `cbd15f83-bdd43f4-paul.draft-graph.json`, with only the authority suite's target-free materiality control applied. The actual authority admits it as comparative_leader and supplies three candidate IDs. The projection loses both these IDs and a known-empty control. Two intended RED rows, one unchanged hash/licence/no-prose/absent-graph control GREEN. Original capture SHA256 `d4613a3a229c2e0ec3945761a39670b9ffa08ca54b88638ca239a4f8f53495b4`.
- [Amendment and corrected design request](https://github.com/Talchain/olumi-programme-docs/issues/85#issuecomment-5963942893): retain only the existing machine census and subject; attach a **separate disclosure carrier** under accepted-current-read proof, including same-report-hash restoration. **Never stamp current-graph `/graph` admission into the original Run's `run_analysis_admission`; never manufacture reasons/readiness or compare raw CAS and canonical analysis hashes.** Shared Data/PTL own allocation and wire/schema sequencing. No unleased shared-transport product edit has been made.
- RED specs and a captured producer case are banked outside the clean source trees at task-root `conditionalInputBasis.canonicalReload.pending.tsx`, `b3-input-basis-cold-projection.pending.test.ts` and `b3-captured-census-read.pending.json`. Logs: `ui-canonical-reload-transport-red.log`, `cee-cold-projection-red.log`. Do not copy only a made-up UI census and call the producer-consumer gap closed; use the actual captured case and add empty/absent/mismatched-subject/same-hash controls.
- Full CEE gate remains held below the 20GB capacity threshold. No push/PR/merge; measurement remains inconclusive, zero new provider calls. R and D remain unclaimed. The UI portable patch and `EVIDENCE-CHECKPOINT.json` were refreshed.
- Scoped heartbeat **`olumi-b3-delta-overnight-delivery` is ACTIVE**, every five minutes through 09:00Z, quiet on unchanged state. Reuse this checkpoint, read #85/#87 incrementally (at least 120s apart), take the authorised serial transport slot when assigned, then full gates → exact-head reviews → existing Executor's guarded merge/deploy → joined pricing/sprint reload witness → morning card. Never treat the heartbeat as permission for a shell background push/merge.

Current cursors and any later ruling live in `EVIDENCE-CHECKPOINT.json`; refresh them before release. Morning URL is `https://staging--olumi.netlify.app`; existing pricing and sprint routes are `/scenario/5400c082-6de3-4450-b969-7f95aa8fca47` and `/scenario/8e8e8a6d-5910-4fbf-9f7e-affe35fa06d9`. These routes alone do not prove the delta is deployed or its scenarios are valid positive controls.

### 01:27Z captured consumer instrument and release dependency

- Captured authority graph/census now feeds the actual UI cold reader, mapper, store, results hooks and mounted result. Three intended RED (nonempty, known-empty, same-report-hash) / three GREEN (actual projection unavailable, schema-valid stale read clears held report, mismatched census subject unavailable without changing original Run permission/currentness). Independent buddy PASS for banking; explicit `alreadyHeld` and report-clear assertions added and rerun. Analysis result remains an explicitly constructed offline mapper fixture, not a computation or serving witness. Banked spec `conditionalInputBasis.capturedReload.pending.tsx`, log `ui-captured-reload-transport-red.log`; temporary source copies removed, both product trees clean. Subject-binding requires a discriminating mutant after the leased repair.
- Compare is now merged/served at `634b02f2ec416bfea8a2dcf96eda4e0474048de8` (DL receipt5964058734); direct staging head matches. UI serving remains `a521c6b7` at 01:25Z. Re-derive citations and integrate the final staging base before a delta push; no rebase or dependency install has been performed at this checkpoint.
- SCIENCE UI's remote gate offer5964054348 requires a pushed branch and cannot bypass the full-gate-before-push rule. Existing Delivery Executor received the unpushed-patch route / narrow-PTL-amendment request; no new writer or release controller. Current Mac free17GiB; full gate and shared-transport lease remain held. Latest scoped programme receipt5964092408.
- Scoped [morning test card](OLUMI-B3-MORNING-MANUAL-TEST-2026-10-03.md) is prepared with BLOCKED status, actual URLs, seven decisive checks and separate R/D/constraint limits. Refresh served tuple, fresh positive scenario IDs and joined witnesses before marking it READY.

### 01:50Z task-owned capacity recovery

UI `node_modules` was retired after its completed focused/mutant/buddy evidence; code, local commits, frozen lock and portable patch remain intact. Shared package-store links meant only27MB was freed, so capacity stays below20GB. **Future UI tests require a frozen reinstall when the hold permits, or a demonstrated remote runtime; never borrow another checkout's dependencies.** CEE dependencies remain available. No new gate/transport ruling was supplied in Executor5964257823. Latest cursors and exact free bytes are saved in the checkpoint.

### 01:56Z PTL rulings — work resumed

Direct current PTL chat6ac049f3, completed turn2c7c022b, agent item96fb0e0b, explicitly assigns this existing Codex writer the bounded census transport: CEE `analysis-admission-projection.ts` existing machine census only; UI `scenarioGraph.ts`, `serverGraphHydration.ts`, `applyScenarioAnalysisRead.ts`, disclosure-only report/consumer hunk. Shared Data alone owns P3/finalizer/permission; no original Run stamping or CAS/canonical-hash logic. CEE carrier/schema first or deliberately joined exact-head train; consumer must target that exact contract. Named/empty/same-hash regressions and stale/missing/mismatched controls required.

Capacity hold is NARROWLY AMENDED at18.399GiB: one bounded foreground worker and minimum frozen dependency refresh, no parallel heavy local jobs/other workstreams' cache/store deletion. Full no-path Required + ratchet + pinned prepush BEFORE EVERY push remains mandatory; no CI-only substitute. Stop before push if unsafe/incomplete, then demonstrated remote runtime. Landing order2524→2530→delta; separate HIGH CEE/UI PRs unless release controller deliberately joins wire landing. Exact ruling relayed to #85 and existing Executor; checkpoint records provenance. No push/gate/served claim at this point.

### 02:31Z bounded transport repaired; full gate running

The01:56 PTL lease is implemented. CEE existing machine census now survives its route-local projection; the UI carries it separately from original Run admission through accepted canonical reads, including same-report restoration. Absence/mismatched subject remain unavailable; known-empty stays distinct. Original Run admission and canonical permission/currentness authority are untouched. Independent buddy found no shared strict response schema requiring a version change; use CEE-first/deliberately joined wire landing as PTL ruled.

Captured producer RED2/control1 became3GREEN; production read→map→store→hooks→mounted UI RED3/control3 became8GREEN (offline constructed analysis_result, not a computed or served witness). All six transport mutants killed and restored: remove/widen producer, omit consumer write, remove subject binding, skip same-hash restore, stamp original Run. Wider UI18files/233tests GREEN. Own frozen dependency refreshes completed under the narrow exception. Historical01:50 UI retirement is superseded.

CEE rebased cleanly onto coaching895dd7778cc10c38b33fa2ce93091fb88fd50df8 at3f5c6243c1380600e0df8c1d4415ac6b576e28ae; all3commits byte-equivalent by range-diff. UI f63326435d18e4db2d0ccd818c8053f3a1e72318 on622ac235. Buddy PASS source at pre-rebase9a8e/f633; final-base seam confirmation requested. Full CEE no-path Required is RUNNING with one foreground worker, followed by ratchet/pinned prepush; no push/PR exists. Existing Executor retains release control. R/D unclaimed, zero new provider calls. Live checkpoint/log paths and saved #85/#87 cursors are in EVIDENCE-CHECKPOINT.json.

### 03:44Z final source frozen; completed gates still owed

First full no-path diagnostic at3f5c ran32min and was interrupted rc130 after13 collected failures; it is not a completed gate. Existing malformed census capture remains unchanged; explicit known-empty shape controls preserve the old branch, unavailable contrast covers the original. Existing owed pipeline restored; exact narrator basis deduplicated, basis stays outside answer shaping. Local CLI temp-path alias fixed by TMPDIR=/private/tmp without changing guards/baselines. Build/lint/ratchet290<=291/pinned prepush passed at5b763c66.

Independent buddy then found questions-tail collapse, distinct from answer shaping. Fixed in leased host only: move bound non-null basis and actually selected inferred-objective ask before the tail using existing textAtRest; exact hidden copies become one. Handles unpunctuated tails and arbitrary unknown-origin labels. Original CEE/UI questions predicates untouched. Parser lease request5965109234 was approved5965098558 then withdrawn for this smaller complete producer repair5965118501. An initial objective extra-ask row was ineligible on an explain turn and was removed; selected host-helper proof is explicitly separate from actual-route proof, without changing one-ask eligibility.

Final CEE21451b55 focused3files92GREEN; remove9/overtrigger15/hidden-duplicate1 mutants killed and restored. Final UIbc90486b focused3files63GREEN includes6actual stubbed Agent-route outputs plus2selected-objective helper outputs rendered by actual MessageBubble, with existing33question controls. This is local producer/consumer proof, not computation/serving or persisted canonical witness. Five test-only missing required AtAGlance props fixed; baseline untouched. Final UI prepush running; CEE fresh build/static guards then completed full no-path required suite remain due. Exact-head buddy requested; MG/independent HIGH follow eligible PRs. No push/PR/provider calls, R/D unclaimed.

PTL's morning priority is ONE coherent SharedData+B1 pricing semantic spine, fresh review/gates, served transcript-free canonical state→readiness→captured Run→Agent→explanation→cold reload. B3 remains bounded behind the agreed slot. SCI witness released its obsolete895pin after0/11; served Import scenario drops goal_constraints/reseeds embedded intervention references, so its positive load is blocked and no destructive workaround is authorised. That loading-fidelity boundary is separate from B3 source or scientific computation proof.

### 03:54Z final reviewed head gates

Fresh buddy P2 at21451 showed placement after proposal-ID scrub could reinsert a raw ID-bearing label and duplicate the obligation. Short full run stopped immediately rc130, not a completed gate. Goal/factor actual stubbed-route RED2/control61 reproduced the issue. Corrected to placement-before-scrub; final3files94GREEN, lintPASS. CEEb35ed5db/UIbc90486b now both scoped independent sourcePASS, with no release verdict implied. Same-head CEE schema/build/ratchet290<=291/pinned guardsPASS; UI prepushALLCHECKSPASS, baseline unchanged. Final CEE full no-path suite RUNNING after source review; all logs preserved. No code changes during it. HIGH bodies prepared but no PR until completed gate.


### 04:52Z published gates and successor review allocation

Both final HIGH PRs are attached and review-ready, with the completed local full gate and remote Required aggregate PASS. Final fixture byte/analysis hashes remeasured unchanged; portable patches contain finalb35/bc heads. Base-versus-delta remote failure log comparison is saved in `remote-ci-failure-comparison.json`; no inherited advisory/security alarm was suppressed or declared cleared. PTL allocated existing MG/HIGH successors, and each received exact heads, scope, controls and evidence. The source writer is idle for concrete review/integration fixes while pricing stays first. Morning card remains DRAFT until actual serving and joined runtime observations.


### 04:56Z existing reviewers accepted

MG pickup5965712608/#875965712445 and formal HIGH pickup5965735405 are accepted against finalb35/bc heads. Read-only whole pair review proceeds while pricing is repaired, and pricing immediately preempts it. No source edit, new test process or paid generation. The canonical-only witness CONTROL is explicitly separate from the original paid B1→SCI journey; normal reload cannot claim transcript-free acceptance (PTL5965683756). Final HIGH, security policy, landing and served R/D proof remain owed.


### 05:09Z formal source HIGH and exact-head policy disposition

Independent whole-delta SOURCE HIGH PASS5965776489 covers both frozen heads,10CEE/20UIpath reader/writer/permission/origin and cold carrier chain. No new source defect. PTL5965787842/#875965788014 resolves the inherited audit and skipped conditional UI jobs under the existing exact-head release policy; both MG and formalHIGH received the concrete disposition. Final HIGH APPROVE remains pending pricing priority, then guarded integration/merge/actual serving/joined proof. No source change, tests or paid generation were added.


### 05:18Z final independent HIGH approved; banked for release

FINAL independentHIGH APPROVE5965840205 is verified against both exact final heads through commit-bound COMMENT reviews5399122213/5399122336. PTL5965846142/#875965846351 accepts REVIEWED / RELEASE-READY-BANKED. No further review/gates on unchanged heads. Pricing107 test-only repair is published with fresh remoteCI/review running; B3 stays behind pricing and the agreed core/wire order. Any descendant/joined source delta needs fresh applicable exact-head evidence. No merge/serving/paid or R/D proof.


### 05:26Z advisory complete; bounded release-order ruling requested

CEE full advisory completedSUCCESS in addition to mandatory localfull and remoteRequired aggregate. Core2530 directmetadata remainsOPEN7b32078b/UNSTABLE/unmerged;24corepaths havezerooverlap with10deltaCEEpaths (metadata only, not runtime independence). PTL received one concrete proposal to release the reviewed boundedrepair afterpricing and existingwitnesshold, CEE-first, leavingcoreunderitsownlease/Dunclaimed. Originalcore-predecessor/order remains until an explicit ruling; fresh sourceintegration/gates/review still required for descendants. No duplicate writer/clone/gate/provider action.
