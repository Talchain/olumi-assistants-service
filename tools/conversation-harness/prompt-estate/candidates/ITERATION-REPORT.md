# v42.2 candidate iteration — live A/B evidence (deliverable, 2026-07-08 early hours)

**Method.** Full-pipeline A/B through a local CEE server at the deployed staging tip (`e122f16b6`, fresh throwaway worktree), staging-parity env (all 90 non-secret Render env vars mirrored: models `claude-sonnet-4-6`, coaching-context prompt ON, post-analysis loop ON, max_tokens 18000, DSK ON…), sessions/graphs on staging Supabase via disposable client-minted scenarios, candidates served through the **file prompt store** (env-shim around the Supabase auto-detect landmine; zero repo writes, zero PMS writes, zero staging-prompt changes). All 23 staging PMS rows mirrored byte-exact into the local store so draft/edit lanes match staging (`draft_graph_default@194` etc.). Identity proven per call from `v5.routing.calling_anthropic`:

| Arm | Prompt | Version logged | sent_hash | Chars | Routing calls | Journey |
|---|---|---|---|---|---|---|
| A | v42.1a (= PMS 111 frozen, byte-identical to staging: same hash `2324652e87768f5f` staging logged on 7 Jul) | 111 | `2324652e87768f5f` | 20,359 | 19/19 | 25 turns, HTTP 200 all |
| B | v42.2a (P1 guard-mirror + P1b explanation shape + P2 starved-pack/claim-type) | 112 | `f08759b1253e5f5c` | 21,958 | 19/19 | 25 turns, HTTP 200 all |
| C | v42.2b (B + shaped-explanation worked example, gerund-anywhere ban, one-question-mark cap, thin-view scoping widened; paid for by cutting routing examples 1+3, duplicated in HANDLERS) | 113 | `a207c0e10d066f49` | 21,972 | see below | 25 turns |

Journey = the 20 Phase-1 baseline turns verbatim + 5 probes (thin-context, goal-fit, confirmation-demand, structural-advice, recommendation-echo). T12's factor label adapts to each run's own draft. Spend: ~cents per arm. Scorer = production guard modules (byte-exact at the serving tip), per-run label grounding. Caveat: n=1 journey per arm; Monte-Carlo and draft variance mean single-turn differences are indicative, not proof — the repeated-defect patterns are the signal.

## v42.2a vs v42.1a — scorecard by patch goal

**Confirmed wins (B over A):**
1. **Claim-type discipline (P2) — the headline win.** Asked whether the leading option will hit the 15% target with no target-scored values in context: arm B answered "the analysis has not yet scored either option against that threshold, so we cannot say from the current results…", then clearly typed its structural reasoning as structural (P22). Arm A on the same question class argued target-fit from win-share ("well-placed to meet the 15% target", T09) — the exact conflation Paul's 7 Jul test surfaced.
2. **Stale discipline with taught vocabulary.** Arm B's T13 opened "The analysis is stale following the change to AI Feature Complexity… The 96% figure comes from **the latest available run**, not the updated model" — the P1 guard-safe phrasing, applied natively, and the answer shipped rich (230w, shaped) instead of being substituted. Arm A's T13 showed a stale 98% with no staleness framing and the banned "with a probability of" dialect (that text is the deterministic substitution template — a composer-copy item, but the LLM answer it displaced failed to ship at all).
3. **Guard collisions 1 → 0.** Arm A: one coaching-postcheck degrade (`invented_mutation_success` on T11's clarify — 21-word safe copy shipped). Arm B: zero postcheck violations, zero egress hits, zero degrades on 19 LLM turns.
4. **Recommendation-mirror fix held.** "What's your recommendation here?" → arm B answered decisively with zero "recommend*" echo ("The numbers point clearly toward Hire One Tech Lead, though the call is yours to make") in clean coaching shape. (Arm A also avoided it this run; the unconditional rule removes the luck element the old "unless the user uses them" line invited.)
5. **Structural-advice shape.** P24: 0 bullets (A) → 4 bold-led insight-plus-action bullets (B), no mutation-language hit on either.
6. **Em dashes 5 → 0** across shipped text (style rule adherence; weak signal at n=1 but directionally right).
7. **No regressions detected:** dispatch paths identical turn-for-turn (same intercepts fired: T03 no-analysis guard, T08 advice gate, T12/T14/T16 deterministic), draft unaffected, receipts unaffected, chips within budget, zero generic-filler markers in both arms, label grounding equal (avg ~6 real labels per LLM answer).

**Misses (fixed in v42.2b, arm C):**
1. **Explanation answers stayed prose** (T07 272w/0 bullets, T17 282w, T20 203w, P21 338w — same as A). The RUNTIME/RESPONSE_DISCIPLINE instruction alone does not reshape `answer_text` inside the tool call. v42.2b adds a worked example OF a shaped explanation answer (the only mechanism that worked for coach turns).
2. **Mid-sentence mutation gerund.** B's P25 contained "adjusting that is the fastest way…" — flagged by the production matcher; harmless on a coach turn but would invalidate an explanation answer. v42.2b bans mutation gerunds anywhere in advice.
3. **Question discipline on challenge turns.** T19: 1→3 question marks; P23: 2 in both arms. v42.2b: hard one-question-mark cap.
4. **Thin-view scoping did not trigger on the all-factors ask** (P21: comprehensive-sounding influence story in both arms). v42.2b adds the explicit trigger.

**External (not prompt) findings from these runs, for the orchestrator session:**
- `unexpected_stop_reason` → error fallback reproduced locally (arm B T09, 31.5s; third specimen incl. staging T02) — the 1.20-class lane now has a concrete cause and local repro.
- Arm A's P22 was eaten by a **misfiring clarify-fallback**: "Will the leading option actually hit the 15% improvement target?" → "I wasn't sure what you meant by AI Feature Delivery Speed…" (post-analysis label intercept matching an outcome label inside an unrelated question). New specimen for the #368 clarify lane.
- The T08 advice-gate template ships its known mutation-language match locally too (both arms) — composer-copy alignment item confirmed at tip.
- The stale-substitution template (arm A T13) presents a stale percentage without stale framing and in the "with a probability of" dialect — worse than the LLM answer it replaces when that answer opens with correct staleness (arm B). Candidate for composer review once v42.2x lands.

## v42.2b (arm C) results — the explanation-shape fix landed

Identity: 19/19 routing calls `113 / a207c0e10d066f49`. Zero postcheck violations, zero egress hits, zero em dashes.

1. **The worked example did what instructions alone could not.** Explanation answers now ship in the coaching shape: T02 (189w, 3 bold bullets), T17 (301w, 3 bullets), T20 (238w, 3 bullets), P21 (277w, 3 bullets) — versus pure prose in BOTH arms A and B. This confirms the mechanism: this model family follows demonstrated shape, not described shape, inside tool-call answer text.
2. **T09 — the live-defect bullseye on the verbatim baseline turn.** "The 15% delivery speed target hasn't been scored in your model yet, so the current analysis can't tell you which options clear that bar," then cleanly-typed win-share ("leads in 93% of simulated scenarios **against the 6-month shipping goal**"), then the concrete step (add the constraint, rerun) + one question. 100 words. Arm A's answer to the same turn was 252 words of win-share dressed as target-fit. P22 same discipline in 37 words.
3. **Question-mark cap partially effective:** T19 3→2, P23 2→1, P25 1. Residual: T19/T18 still 2 (challenge turns like to end each bullet with a rhetorical question).
4. **Word budget still not honoured on the heaviest turns** (T17 301w, P21 277w) — but now structured; the felt quality is different in kind from 300-word prose.
5. **One new collision specimen, self-inflicted and instructive:** arm C's T07 answer (1,260 chars, valid content) was invalidated `forbidden_internal_term` and replaced by the deterministic template. The v42.2b worked-example header read "Explanation answer **inside a tool call**" — teaching copy that names internals invites echoes. **v42.2c** rewords the header ("Every answer you write is user-visible…"); arm D is the confirmation run. Meta-lesson for all future prompt copy: never name internals even in instructions, or the guard that enforces rule 4 will eat real answers.
6. Deterministic-lane variance observed across arms (not prompt-caused): the T13 stale substitution shipped three different template voices across A/B/C — including arm A's version that shows a stale percentage with no stale framing in the banned "with a probability of" dialect, while arm B's LLM answer (which opened with correct staleness and survived) was materially better than the template that displaced arm C's. Composer-alignment item for the orchestrator session.

## v42.2c (arm D) confirmation

Identity: 19/19 routing calls `114 / 9e3f060c8fb5b5fd`. **7/7 explanation answers valid — the internal-term echo risk is gone** (arm C: 1/7 invalidated). Zero postcheck violations, zero egress hits, zero em dashes, zero mutation-language on LLM turns. Shape held everywhere it applies: T13 (225w, 3 bullets — with correct stale framing), T17 (240w, 3), T20 (244w, 3), P21 (303w, 3), P22 (222w, 2), P25 (178w, 3, no "recommend*" echo), T10/P23/P24 shaped. T09-class claim-typing held (this run's T09 was eaten by the clarify-fallback misfire — external, see below).

Arm D also sharpened two external findings:
- **`unexpected_stop_reason` is a hot lane:** T02 and T07 both died to it this run. Across all evidence (staging baseline + 4 local arms): 4 failures in ~90 routed turns ≈ **4–5% of routing calls die to an unexpected stop reason** and ship "I couldn't complete that turn cleanly". No prompt version affects it (hit v42.1a and v42.2c alike). This is now arguably the single most user-felt AI defect and it has a named cause and a local repro.
- The clarify-fallback misfire (outcome-label matched inside an unrelated question) recurred: 2 specimens in 4 runs (arm A P22, arm D T09).

## Recommendation

**Recommend v42.2c for Paul review and a controlled manual staging test** (brief §15.6 category: "recommend candidate prompt for Paul review"). Grounds: across four live full-pipeline runs, the v42.2 series measurably fixes, with zero observed regressions on routing, dispatch, drafting, receipts, grounding, or vocabulary:
- the goal-fit conflation from Paul's 7 Jul manual test (target-not-scored honesty demonstrated on the verbatim baseline turn, twice);
- the explanation-shape defect (prose → headline + bold insight-with-action bullets, via the worked-example mechanism);
- guard-boundary collisions (1 postcheck degrade → 0; taught stale/change vocabulary used natively; recommendation-mirror closed; internal-term echo risk removed);
- stale discipline in prompt-owned answers.

Residuals accepted into the next batch (v42.2d / P3), not blockers: hard word budget on the heaviest shaped turns (240–300w vs the 130w target), the one-question cap on challenge turns (still 2), P21-class full honest-scoping, and the signal-to-move map (P3) which needs the eval pack's fixture variety rather than one journey. Per ruling 8, Regime-W evaluation (post-P0-A) is still owed before any production promotion; the staging_version manual test is the right next gate and does not pre-empt it.

**Proposed Phase-4 path (all Paul-gated):** review `candidates/v42.2c.txt` (diff is mechanically reviewable: run `build-v42.2a.py` + `build-v42.2b.py` + the v42.2c header edit against the frozen v111) → upload to PMS as a new version with `staging_version` pointing at it (active untouched, one-call rollback) → §14 manual smoke on a disposable scenario. Total offline spend for all four arms: under $2 of the $50 batch.

---

# ADDENDUM (2026-07-08 ~02:45) — assessment session: verification of the above + the first cross-regime runs (P0-A merged mid-programme)

**Who/what:** a follow-on session audited every claim above against the artefacts (hashes, stores, run captures, server logs) — **all held** — then found two ruling gaps in v42.2c, fixed them, and ran the first widened-context arms after **P0-A (#369) merged and deployed to staging at 01:08** (tip + live build now `8a495c80f`). Regime W is no longer pending: **staging is serving it now**, which materially changes what the manual test would exercise.

## Corrections to v42.2c (ruling compliance)

1. **Ruling 6 (D3 chips) was not implemented** — CHIP_GUIDANCE still said "up to three candidates" (unchanged from v111). Fixed in **v42.2d** (`2c9ff9d785a5aa70`, 21,978 ch): at most two candidates, three only on a coaching or explanation turn; paid for by dropping the secondary win-probability phrasing option.
2. **Amendment A2 (goal-fit vocabulary, P4) was silently absent.** Initially logged as a deferral (unexercisable under starved context) — then **overturned by events**: P0-A's widened pack carries a `goal_fit` provenance signal, and the first widened-context run proved the gap live (below). Fixed in **v42.2e**.

## The cross-regime evidence (arms E/F/G, all at tip `8a495c80f`, identity hash-verified 19/19 each)

| Arm | Prompt | Regime | Key result |
|---|---|---|---|
| F | v111 control (`2324652e…`) | W (widened) | Explanation turns STILL 230–320w prose (shape is prompt-owned, regime-independent). T09 STILL conflates win-share with target-fit. 1 max-tokens death + **2 headline-only truncations** (new defect class, below). Richer grounding though: answers now cite causal links. |
| E | v42.2d (`2c9ff9d7…`) | W | Shape held on every explanation turn (bullets, bold leads) — the worked-example mechanism is regime-robust. **BUT T09 regressed to conflation in a NEW form:** the pack's goal-fit provenance ("scored from the modelled outcome distribution") plus win-share licensed "Only X clears the 15% target… leading in 97% of simulations". The starved-era rule ("if no target-scored values are present, say not scored") does not cover the scored-but-values-withheld state. Also: T13's stale answer invalidated `mutation_language_detected` (gerund reference to the user's own edit), T11 postcheck degrade (same class as control arms). |
| G | **v42.2e** (`3356c574a58b6023`, 21,860 ch, headroom 140) | W | **Cleanest arm of the programme: zero postcheck, zero invalidated answers, zero bounded fallbacks, zero egress hits.** T09 opens with the taught provenance framing ("scored from the modelled outcome distribution, so the comparison is built into the analysis results rather than shown as a separate per-option score") and types win figures to the goal. Shape held everywhere. Stale turn shipped the honest template (prerequisite path, doctrine-correct). |

**v42.2e = v42.2d + two edits + one cut** (`build-v42.2e.py`): the goal-fit scored-but-values-withheld rule ("win figures are never evidence a target is cleared; point to the goal-fit view for the scores"); noun-form references to the user's own edits ("your update to X", never -ing verbs — kills the T13 invalidation class); paid for by cutting the final routing example (content duplicated in ENTITY_RESOLUTION/RULES 8/INTENT_CLASSIFICATION; clarify verified working in arm G, though it named no candidate choices on T11 this run — watch item, n=1).

**What the quadrant now proves (Paul's central question, measured):** context widening alone fixed NEITHER the shape defect NOR the claim-typing defect (arm F); the prompt patches fixed both, in both regimes (arms D/E/G); and the widened context *created* one new prompt requirement (goal-fit provenance discipline) that v42.2e closes. Context and prompt are complements, not substitutes — exactly as the two-regime design predicted.

## Externals — two upgraded, one new (for the orchestrator session)

1. **`unexpected_stop_reason` ROOT-CAUSED — no longer a provider mystery.** It is the routing call hitting `V5_ROUTING_MAX_OUTPUT_TOKENS = 2048` with a deliberate no-retry policy (`route-with-tool-use.ts:50,671`; the recovery-chips test literally names "unexpected_stop_reason via max_tokens"). Live proof: arm F's P22 failure burned exactly 2,048 completion tokens. The cap's "generous headroom" comment predates the widened context; richer packs make verbose prompts (v111 especially) overflow it. Fix menu: raise the cap, retry-with-brevity, or salvage the partial. Note the coupling: v42.2x's word budgets reduce trigger frequency, but the handling fix is code.
2. **NEW: headline-only truncation on coach/direct-answer turns** (3 specimens, all Regime W: armF T10 `683ae80f` 90tok→11w, armF P24 `d75a1f01` 93tok→13w, armG T10 `52013422` 105tok→19w). The model emits ~90–105 tokens; only the first sentence ships, reading as a complete-but-hollow answer. Compose-path defect (first-text-block-only?), prompt-version-independent, ~5–10% of routed turns in the affected runs. This will feel like "the coach gave me one line" — user-felt, insidious, needs its own lane item.
3. Scenario debris for cleanup (this session's arms, all local-run disposable): `6433f7e6…` (F), `4ec4c955…` (E), `88a86c10…` (G).

## Revised recommendation

**Recommend v42.2e (not v42.2c) for Paul review and the §14 manual staging test.** Grounds: staging now serves the widened context; v42.2c was never tested under it and v42.2d demonstrably conflates goal-fit there; v42.2e carries every v42.2c win (shape, guard vocabulary, stale discipline, recommendation-mirror, internal-term hygiene) plus ruling-6 chip doctrine, the goal-fit provenance discipline the widened context demands, and the noun-form fix — and produced the programme's only fully-clean arm under the live regime. Ruling 8's two-regime requirement is now genuinely satisfied for the candidate line (starved: arms B/C/D; widened: arms E/G). Residuals unchanged in kind (word budget on heaviest turns ~250–330w vs 130 target; occasional second question mark; T11 clarify choice-naming watch item) — none are manual-test blockers.

---

# ADDENDUM 2 (2026-07-08 ~10:15) — Phase 4 executed; one verdict FLIPPED with corrections cascaded

## What happened

1. **v42.2e was uploaded and served on staging** (PMS version 112; discovered en route: the routing snapshot builder ignores `staging_version` — `loadPrompt('routing')` is called without `useStaging`, so the documented staged-rollout path is a NO-OP for this key; served flip required `active_version`. Prod-safety verified first: cee-prod has no `ENABLE_V5_ORCHESTRATOR` and no `PROMPTS_SUPABASE_URL` — it cannot be affected. Fix included in PR #374.)
2. **Full 25-turn §14 smoke on real staging**: 19/19 routing calls identity-verified (`112 / 3356c574a58b6023`), 0 postcheck, 0 egress, shape held on explanation turns, 1 max-tokens bounded fallback, 2 invalidated answers (known classes), 1 headline-only truncation (first REAL-staging specimen, T10 19w).
3. **A goal-fit "fabrication" was called on smoke T09 and re-probe R06 — and then OVERTURNED.** The false positive was mine: the grounding check used the pre-#371 field name (`prob_satisfied`). While this workstream ran, the orchestrator session's **Lane 30 (#371, deployed build `2082168` during both staging runs) independently found and fixed the same defect class at the PACK layer** — per-option `goal_fit_probability` (PLoT `option_comparison[].probability_of_joint_goal`) now projects into the pack as display-safe target-fit percentages with a win%-vs-target-fit definition sentence. Re-grounding against the correct field: **R06's 75%/83% = payload 0.7495/0.8255; T09's "9 out of 10"/"two-thirds" = payload 0.904/0.660. GROUNDED, correctly typed, honestly explained — the model did exactly the right thing with values in view.** The goal-fit journey now works end-to-end on staging.
4. **v42.2f was authored and promoted during the (then-believed) fabrication window** (PMS 113, `9254a116c70a4cfe`, 21,958 ch — now the served staging prompt). Although its motivating incident dissolved, the text is kept: WORKED EXAMPLE C teaches the values-NOT-in-view answer (still reachable — #371's own disclosed states 2/3: provenance-without-values and not-scored), the "never state how often an option meets a target unless that exact figure is in view" rule is exactly correct in the #371 world (figures often ARE in view now — R06 used them properly), and local arm H (19/19 identity, 0 postcheck, 0 fallbacks) plus the staging re-probe show no regressions. Rollback ladder: PATCH activeVersion 112 (v42.2e) or 111 (v42.1a) + reload.

## Corrections cascaded from the flip

- The smoke was NOT a claim-safety failure; v42.2e's staging T09 was clean.
- Arm E's provenance-licensed conflation finding REMAINS VALID (it ran at pre-#371 tip `8a495c80f`, provenance-only pack) and is corroborated by Lane 30's own live evidence (scenario 90385279: "leads comfortably at 89%" vs joint-goal 29.3%). The pack fix (#371) and the prompt teaching (v42.2e/f) are complementary layers of the same defence.
- The "unconditional never-state-target-scores" patch drafted as v42.2g was ABANDONED before authoring — it would have been wrong in the #371 world. Verify-before-author caught it.

## Externals updated

- max_tokens bounded fallback: 3 more specimens tonight (smoke ×1, re-probe R04 ×1 on the primary goal-fit question, plus arm F) — **PR #374 (draft) now carries the fix**: retry-once at 4096, served-snapshot telemetry identity (1.32), and the `useStaging` routing-snapshot fix. Branch `claude-prompt-ws/routing-identity-and-max-tokens`, gates green, NOT merged (orchestrator merges).
- Headline-only truncation: 4th specimen, first on real staging (smoke T10). Documented in PR #374 body as follow-up with request ids.
- Scenario debris added: `f07f0318…` (smoke), `c87ec4d2…` (re-probe), `d048d4ce…` (arm H).

## Final state

**Served on staging: v42.2f (PMS 113, `9254a116c70a4cfe`) — the full v42.2 line live, with the goal-fit journey now truthful end-to-end** (pack values from #371 + prompt discipline from this line). Paul's §14 manual UI run remains the human-experience gate; the API-level §14 evidence is complete and green apart from the two known external classes (max-tokens deaths — fix in PR #374; truncation class — diagnosis owed).
