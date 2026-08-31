/**
 * THE INSTRUCTION IS PINNED BY A HISTORIC HASH, AND THE LITERAL MAY NOT BE
 * "UPDATED" TO MATCH A CHANGE.
 *
 * Every measurement that justified drafting by records was taken against exactly
 * these bytes. `e630587523d29ace…` / 2,351 bytes is a RECORD of what was served,
 * not a convenience constant: if the instruction changes and someone edits the
 * literal below to match, the whole evidence base silently detaches from the
 * product and nothing anywhere goes red.
 *
 * Changing the instruction is legitimate. Changing it while re-pointing the pin
 * in the same motion is not — move the pin deliberately, in a commit that also
 * carries the new measurement.
 *
 * The pin is derived by HASHING THE SERVED CONSTANT, so it also fails if the
 * concatenation, the trimming or either section moves — not just if someone
 * edits the prose.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DRAFT_RECORDS_INSTRUCTION,
  DRAFT_RECORDS_SHAPE_INSTRUCTION,
  DRAFT_RECORDS_CONNECT_INSTRUCTION,
  draftRecordsInstructionHash,
} from "../instruction.js";
// The grammar's own enums, imported rather than restated: the v12 route test
// binds to the source of truth so a widening there fails this test loud, instead
// of leaving a hand-copied list to drift (CLAUDE.md trap 12).
import { DRAFT_RECORD_STATED_KINDS, DRAFT_RECORD_CLAIM_KINDS } from "../grammar.js";

/**
 * HISTORIC — v2. The bytes served on every run measured up to and including
 * 2026-08-11 (the 0/27-accepted enumeration and the two arm-R1 measured blocks).
 * This literal is a RECORD and is never re-pointed: it is what makes those runs
 * attributable. The current instruction is v3 and deliberately does NOT hash to
 * it; the assertion below is that the two are DISTINCT, which is the honest
 * statement and the one that stays true forever.
 */
const HISTORIC_V2_INSTRUCTION_SHA256 =
  "e630587523d29ace5739d5c26754d787fb00479d542a3cb1fc7ca13ceb1eca26";
const HISTORIC_V2_INSTRUCTION_BYTES = 2351;

/**
 * ⭐ PRE-REGISTERED — v3, frozen 2026-08-12 BEFORE any run was spent on it.
 *
 * Pre-registration is the point: these bytes were hashed and written to the
 * evidence dir (`v3/PRE-REGISTRATION-V3.md`) before measurement, so the result of
 * the five-gate block cannot be attributed to an instruction that was quietly
 * tuned after seeing it.
 *
 * ⚠ STATUS AT THE TIME OF PINNING: UNMEASURED. v3 was written against the gate's
 * grammar derived at the validator's bytes and against the emission anatomy of the
 * banked corpus — NOT against a live result. A reader must not infer from the
 * existence of this pin that a measurement stands behind it; the evidence file
 * says so in terms, and this comment says so here because the pin is what a future
 * session will find first.
 *
 * These bytes SUPERSEDE the spike's pinned instruction BY DESIGN: the spike's
 * §1.4 pin governed the falsification experiment, and this is productionisation
 * under R1's own acceptance design, which is a different question.
 */
const HISTORIC_V3_INSTRUCTION_SHA256 =
  "494e52b9fca948660927849c870ca8a689cac7399ac100b185243f99a54f416b";
const HISTORIC_V3_INSTRUCTION_BYTES = 3673;

/**
 * ⭐ PRE-REGISTERED — v4, frozen 2026-08-12 BEFORE any acceptance run was spent
 * on it (`round7/PRE-REGISTRATION-V4.md`).
 *
 * v4 changes the REFERENCE SYNTAX and the option-chaining rule:
 *   · references are typed by FIELD (`from_stated`/`from_claim`/`to_stated`/
 *     `to_claim`, integers) instead of by a prefix character inside a string.
 *     A grammar cannot constrain a string's shape here — `pattern` is a
 *     forbidden structured-outputs keyword — so a TYPE on a FIELD is the only
 *     enforcement available.
 *   · the model is told to chain the option THE USER NAMED rather than its own
 *     refinement, which is the instruction-side half of a fix whose load-bearing
 *     half is deterministic (the projector merges a single refinement onto its
 *     stated parent).
 *
 * ⚠ v3 IS NOW HISTORIC AND ITS PIN IS NEVER RE-POINTED. Both long-brief
 * measured blocks were taken against exactly those bytes; re-pointing the
 * literal would detach that evidence from the artefact that produced it.
 */
const HISTORIC_V4_INSTRUCTION_SHA256 =
  "edc329f9d2496be3c1fbfba4f5f5968439d4178913f0b5b1967773ee6430e9f3";
const HISTORIC_V4_INSTRUCTION_BYTES = 4426;

/**
 * ⭐ PRE-REGISTERED — v5, frozen 2026-08-12 BEFORE any acceptance run was spent
 * on it (`round9/PRE-REGISTRATION-V5.md`).
 *
 * v5 changes ONE thing in the connect half, and the shape half does not move at
 * all (`175af059…` / 1,771 bytes, unchanged from v4 — asserted below):
 *
 *   **the goal is a `stated_item`, so a link that reaches it sets `to_stated`.**
 *
 * DERIVED, not guessed: `projector.ts` `CLAIM_KIND_TO_NODE_KIND` maps the four
 * claim kinds to `factor | option | null` and NEVER to `goal`, so no claims index
 * IS the goal. MEASURED cause: on round 7's run 8 the single link intended for
 * the goal was written with a claim reference. It resolved SUCCESSFULLY — to a
 * factor — so nothing terminated at the goal, every derived factor was withheld
 * as unconnected, and a completion pass that emitted TEN well-formed causal links
 * contributed ZERO nodes and ZERO edges.
 *
 * ⚠ THE GRAMMAR CANNOT ENFORCE THIS AND NO SCHEMA CAN. `{"to_claim": 0}` is
 * well-formed, in range, and denotes a real node of a legal kind; its wrongness
 * is a fact about what the model MEANT. A schema constrains documents, not
 * intentions. The instruction and the completion ask are the only places this can
 * be said, which is why it is said in both.
 *
 * ⚠ v4 IS NOW HISTORIC AND ITS PIN IS NEVER RE-POINTED — round 7's five-gate
 * block was measured against exactly those bytes.
 */
const HISTORIC_V5_INSTRUCTION_SHA256 =
  "2e5bc9695f1907a802ab9f2dfa7f697bf36692f10c3675e9227c06994de98182";
const HISTORIC_V5_INSTRUCTION_BYTES = 4688;

/**
 * ⭐ v6 — 2026-08-14, the instruction half of the risk/outcome grammar widening.
 *
 * ⚠ STATUS: UNMEASURED AGAINST A LIVE DRAW at the time of pinning, and this
 * comment is what a future session will find first, so it says so plainly. The
 * bytes were written against `grammar.ts`'s widened `DRAFT_RECORD_CLAIM_KINDS`,
 * against `ALLOWED_EDGES`, and against the SERVED graph prompt's own BRIDGE
 * TERMINALITY / NODE ORIENTATION sections — i.e. against three authorities at
 * their bytes, and against ZERO live results. What the model actually emits
 * under the widened schema is the post-merge deploy witness's job
 * (`scripts/records-pinned-brief-acceptance.ts`), and no claim about it is made
 * here.
 *
 * ⚠ v5 IS NOW HISTORIC AND ITS PIN IS NEVER RE-POINTED. The round-11 block and
 * every measurement taken through 2026-08-13 were served exactly those bytes;
 * re-pointing the literal would detach that evidence from the artefact that
 * produced it. Both halves moved in v6, which has not happened before — the
 * shape half changed in v4 only, and the connect half in v3/v4/v5 — because a
 * new claim KIND has to be both declared (shape) and connected (connect).
 */
const HISTORIC_V6_INSTRUCTION_SHA256 =
  "b4916b58954b30838a5ca37a770fd796371b17400a1002131defba6bd7a69162";
const HISTORIC_V6_INSTRUCTION_BYTES = 6021;

/**
 * ⭐ v7 — 2026-08-14, the instruction half of the `is_baseline` widening.
 *
 * Two sentences were added to the SHAPE half, and both close a measured silence
 * rather than restating the served prompt for tidiness:
 *
 *  · `is_baseline` on a status-quo option. The served `draft_graph` v195 has
 *    mandated this at `:282-283` ("mandatory on ANY option representing the
 *    status quo … whatever its label or id") while THIS block — the one sitting
 *    nearest the output shape — named options 21 times and status quo ZERO. The
 *    grammar had no field for it either, so the mandate addressed a shape the
 *    model could not emit. The field now exists (grammar design note 5) and this
 *    is where it is taught.
 *  · `role` on a numeric `goal`. The projector registers a stated goal target as
 *    `goal_threshold_*` only when the number is a TARGET, and refuses when the
 *    model marks it `baseline`, because registering a current level as the
 *    success threshold inverts the objective. That refusal is only reachable if
 *    the model knows the distinction is load-bearing, so it is stated here.
 *
 * ⚠ STATUS: UNMEASURED AGAINST A LIVE DRAW at the time of pinning, said plainly
 * because this comment is what a future session finds first. The bytes were
 * written against three authorities AT THEIR BYTES — the served v195's Status Quo
 * section, `grammar.ts`'s widened schemas, and the `Node` schema's
 * `goal_threshold_*` contract — and against ZERO live results. What the model
 * actually emits under the widened schema is the post-merge deploy witness's job
 * (`scripts/records-pinned-brief-acceptance.ts`); no claim about it is made here.
 *
 * ⚠ v6 IS NOW HISTORIC AND ITS PIN IS NEVER RE-POINTED, exactly as v4's and v5's
 * are not. Every draft served between 2026-08-14's grammar widening and this one
 * received those bytes.
 */
const HISTORIC_V7_INSTRUCTION_SHA256 =
  "37f271b2377bc1f8a84c8b822af1a626aea22832ca767cfa8f897076f8c69af8";
const HISTORIC_V7_INSTRUCTION_BYTES = 6748;

/**
 * ⭐ v8 — 2026-08-29. What a `goal` IS, replacing the four words that were all
 * the served bytes ever said about it.
 *
 * v7 and every version before it defined the goal as "an objective the user
 * stated" — four words, no discriminator, and no instruction for the case where
 * the user states no objective at all. MEASURED at the deployed staging draft
 * endpoint on 2026-08-29 across a 13-brief corpus, served prompt `draft_graph`
 * v195 (`152998b447819c2e`) plus exactly these v7 bytes:
 *
 *   · 6 of 6 briefs that STATE an outcome produced the right goal. That half
 *     works and is what the preservation clause exists to protect.
 *   · 0 of 7 briefs that DO NOT state an outcome produced a goal that is one.
 *     The model quoted, variously, an action the board wants to take, a REASON
 *     ("two of our largest customers have operations there and have asked"), a
 *     symptom, a process wish, and a 147-character sub-question.
 *
 * Why it is worth an instruction change rather than a validator: everything in
 * the graph points AT the goal, so when the goal is one of the options the
 * causal structure is built to justify that option, and the analysis then scores
 * the alternatives against a target that already assumes one of them. On
 * `D1_plant_closure` the model filed ONE span — "The board wants to close our
 * Carlisle plant." — as both the `goal` and an `option`, byte-identical
 * `source_quote` on both records.
 *
 * The three rules added are stated as a DEFINITION plus a structural test, never
 * as a phrase list: a goal is the result wanted rather than the move weighed;
 * every option including the status quo must be a candidate route TO it; and —
 * the opposite-direction half — a stated objective is quoted as the user wrote
 * it even when unquantified, modest or awkward. That last clause is what stops
 * the fix substituting our judgement for theirs, which is the worse harm.
 *
 * ⚠⚠ STATUS AT PINNING: **UNMEASURED AGAINST A LIVE DRAW, AND THE PROXY THAT WAS
 * TRIED FAILED ITS OWN POSITIVE CONTROL.** Said in full because this comment is
 * what a future session finds first, and a hedged version would read as evidence.
 *
 * What was tried: both arms composed from the same two system blocks
 * `anthropic.ts:516-517` composes, the control arm asserted BYTE-IDENTICAL to v7
 * (`37f271b2…` / 6,748) — but drawn by an independent model instance rather than
 * by `claude-sonnet-5` under the structured-outputs grammar. THE CONTROL ARM DID
 * NOT REPRODUCE DEPLOYED BEHAVIOUR: on the 7 briefs that state no outcome it
 * emitted NO goal record at all (6 of 13 overall), where deployed staging emits a
 * goal on 12 of 13. Absolute rates from that instrument are therefore worth
 * nothing, and none is claimed here.
 *
 * What the instrument CAN support, because both arms carry the same bias, is the
 * WITHIN-INSTRUMENT delta: no-goal 6 → 0; all 6 stated-outcome briefs preserved
 * (4 byte-identical quotes, 2 longer spans of the same statement, 0 substituted);
 * and on the 7 unstated-outcome briefs the goal moved from nothing to a
 * decision-relevant quantity in 6 cases. That is directional support, NOT a
 * measurement of the fix.
 *
 * The sanctioned live path is `tools/draft-quality-eval --live --candidate`,
 * which needs `ANTHROPIC_API_KEY`. The lane that wrote these bytes did not hold
 * one. The BEFORE arm above IS deployed truth and stands on its own; the AFTER
 * arm does not exist yet.
 *
 * ⚠ v7 IS NOW HISTORIC AND ITS PIN IS NEVER RE-POINTED. Every draft served
 * between the 2026-08-14 `is_baseline` widening and this one received those
 * bytes, and the 13-brief BEFORE measurement is attributable to exactly them.
 */
const HISTORIC_V8_INSTRUCTION_SHA256 =
  "acd9148eb107ea85d839fd1198a4eff9659b3ab81b36ef2255d5c029837a0b4d";
const HISTORIC_V8_INSTRUCTION_BYTES = 8265;

/**
 * ⭐ PRE-REGISTERED — v9, frozen 2026-08-29.
 *
 * ⚠ STATUS AT THE TIME OF PINNING: **UNMEASURED**, and this line is here because
 * the pin is what a future session finds first. No live draw was spent on these
 * bytes. They were written against a WITNESSED defect — option nodes that
 * shipped, scored and ranked with win probabilities on the deployed build across
 * 16 signed-in runs and 7 briefs, among them the user's own question ("Should we
 * hire a sales lead?", which then shipped as the BASELINE option), a stated
 * unknown, and a 60-adviser description of how things work today at win
 * probability 0.0542. Do not read this pin as evidence that the change worked;
 * read it as a record of exactly what was served from this merge onward.
 *
 * WHAT v9 CHANGED, and it is ONE bullet:
 *   · `option` gains a definition, a SPAN rule and three exclusions. The
 *     definition and the exclusions are RECLASSIFICATION — they tell the model
 *     where to put something it was already going to say — so neither applies
 *     any pressure to invent, which is the property every version of this
 *     instruction has had to keep.
 *   · The span rule is the half that reaches the LABEL. On this path an option
 *     node's label IS `source_quote` (`projector.ts`), and `source_quote` must
 *     be verbatim — so the only way a label can stop being a pasted sentence is
 *     for the quoted SPAN to be the one naming the action. "A shorter span is
 *     still verbatim" is the sentence that makes those two rules compatible, and
 *     the `goal` bullet has said the same thing ("Quote the span naming what is
 *     at stake") since v8. This closes an asymmetry inside one file.
 *
 * ⚠ THE CONNECT HALF IS BYTE-IDENTICAL to v6/v7/v8 (`44c96633…` / 3,648,
 * asserted below), so this edit is legible as shape-only without reading the
 * diff — which is the entire reason the halves are pinned apart.
 */
const HISTORIC_V9_INSTRUCTION_SHA256 =
  "7629e9ec738786eb4624b078a62c81a5f4e5c90adc2bb4e1b5edbd820f97def8";
const HISTORIC_V9_INSTRUCTION_BYTES = 9183;

/**
 * ⭐⭐ v10 — THE OPTION-EFFECT-VALUE CHANGE. PRE-REGISTERED, UNMEASURED at pinning.
 *
 * WHAT CHANGED, and it is the CONNECT half only: the
 * `## HOW MUCH EACH OPTION MOVES WHAT IT CHANGES` section stopped instructing
 * the model to WITHHOLD the value.
 *
 * v9 said: *"Set it only where the brief gives you the basis for it … Where the
 * brief does not support a number, leave `sets_to` out. An absent number is a
 * truthful answer; a guessed one is read as the user's own and cannot be told
 * apart from a figure they gave you."*
 *
 * ⚠ THAT SECOND CLAUSE WAS FALSE AT `f18d941b`, AND ITS FALSENESS IS THE WHOLE
 * REASON FOR v10. `projector.ts` `bindDirectStatedMagnitude` already stamps every
 * option→factor magnitude `brief_extraction` (value EQUALS a stated figure that
 * verifies against the brief bytes) or `cee_hypothesis` (ours), and only the
 * first is ever presented as the user's. A guessed number therefore CAN be told
 * apart from a figure the user gave — the instruction was a stale mirror of a
 * distinction the projector gained later (CLAUDE.md trap 12).
 *
 * WHY IT MATTERS ENOUGH TO CHANGE: a messy strategic brief rarely states a
 * per-option-per-factor figure, so the model complied and omitted `sets_to`
 * everywhere. Options then reach `cee/transforms/analysis-ready.ts:741` with no
 * interventions, every option×factor pair raises `MISSING_OPTION_VALUE`, and the
 * existing compute-discard waiver cannot fire because it requires the option to
 * carry at least one real value (`analysis-ready-core.ts:506`). Fresh-journey
 * completion was 1 of 23, with this blocker in 20 of them. The model was not
 * failing to comply — it was complying.
 *
 * ⚠ AND THE HALF THAT MAKES IT HONEST SHIPS WITH IT, not after: `projector.ts`
 * now stamps an UNCITED magnitude `cee_hypothesis` instead of writing no
 * provenance at all. Asking for more estimates while leaving them unattributable
 * would trade a refusal the user can SEE for a fabrication they cannot
 * (`option-effect-value-provenance.test.ts` pins that invariant). The shape half
 * is byte-identical to v9 — the "do not invent a number the user did not state"
 * rule on `stated_items` is untouched, because that governs the USER's half of
 * the record set and is not what was blocking anybody.
 */
const HISTORIC_V10_INSTRUCTION_SHA256 =
  "3a1226696828692f6538a2de8bc8e156c5a9ce69575748c23094444642e81ce1";
const HISTORIC_V10_INSTRUCTION_BYTES = 10079;

/**
 * ⭐⭐ v11 — A PROPOSED CAUSE IS NOT AN OPTION. SHAPE half only; the connect half
 * is byte-identical to v10 (`b631a953…` / 4,544, asserted below).
 *
 * THE WITNESSED DEFECT, measured at the DEPLOYED staging draft endpoint on
 * 2026-08-30 (CEE build `a18e194`, served `draft_graph` v195 `152998b447819c2e`
 * plus exactly the v10 bytes above), on a brief whose leadership team disagrees
 * about why growth stalled:
 *
 *   POST /assist/v1/draft-graph returned option nodes
 *     `0811361d` "The Product Has Fallen Behind Competitors"
 *     `b8e1cbe6` "Onboarding Is the Problem"
 *     `5f615ae5` "We're Selling to the Wrong Customers"
 *   each `provenance: "from_brief"`, each `source_quote` the attributed span,
 *   each `status: "needs_user_mapping"` — i.e. three competing EXPLANATIONS put
 *   on the graph to be scored and ranked against one another. The same draw ALSO
 *   emitted the genuine actions ("Commission structured win/loss review", "Run
 *   rapid customer interviews and churn analysis"), so the model was never
 *   short of the right answer: the instruction simply let the causes stand as
 *   their siblings.
 *
 * WHY HERE AND NOT IN THE SERVED PROMPT: `anthropic.ts:516-517` pushes this
 * constant as a SECOND system block beside PMS `draft_graph`. A control arm
 * carrying v195 ALONE (admin `test-prompt-llm`, 6 briefs) emitted no records at
 * all and never reproduced the defect; the composed arm reproduced it on the
 * first draw. The filing decision is made here, so this is where it is fixed.
 *
 * WHAT v11 ADDS, and it is RECLASSIFICATION ONLY — it tells the model where to
 * put something it was already going to say, applying no pressure to invent,
 * which is the property every version of this instruction has had to keep:
 *   · a carry-out/true-or-false test on what an option IS;
 *   · the proposed-cause exclusion, routing each span to a `factor` or a `risk`;
 *   · the opposite-direction preservation clause — "who said it makes no
 *     difference" — because a rule keyed on ATTRIBUTION rather than on
 *     ACTION would demote "sales says cut the price, product says hold and
 *     ship the integrations", which are two real options. That clause is the
 *     half that stops this fix being worse than the defect (trap 22b).
 *
 * ⚠⚠ STATUS AT PINNING: **MEASURED ON A PROXY, NOT ON THE DEPLOYED PATH, AND THE
 * PROXY IS NOISIER THAN DEPLOYED.** Said in full because this comment is what a
 * future session finds first. Both arms were composed from the same two system
 * blocks and drawn through admin `test-prompt-llm`, which carries NO structured-
 * outputs grammar — so it measures the FILING decision this change governs, and
 * nothing downstream of it. Within that instrument, over a 6-brief corpus:
 *   · diagnostic briefs, causes filed as options: BEFORE 5 of 5 draws, AFTER
 *     3 of 9 draws. A large reduction, NOT elimination — the residual is
 *     stochastic, and deployed behaviour on the witnessed brief was
 *     DETERMINISTIC (identical node ids across independent draws), so the
 *     absolute AFTER rate is not a deployed rate and none is claimed.
 *   · genuine-choice briefs, options preserved: 7 of 7 draws, ZERO losses,
 *     including the attributed-but-real contrast case.
 * The corpus was written by the lane that wrote these bytes, which is the exact
 * limitation trap 22 names: it cannot see the class its author did not imagine.
 * The deployed witness on `/assist/v1/draft-graph` is owed AFTER this merge
 * deploys, and no claim about it is made here.
 *
 * ⚠ v10 IS NOW HISTORIC AND ITS PIN IS NEVER RE-POINTED. Every draft served from
 * the option-effect-value change until this merge received exactly those bytes,
 * and the deployed BEFORE witness above is attributable to them.
 */
const WITHDRAWN_V11_INSTRUCTION_SHA256 =
  "e778852c76a27469e26d8d61f3685bb2f91a20524d89bfd577b70dbe393e3f75";
const WITHDRAWN_V11_INSTRUCTION_BYTES = 11171;

/**
 * ⭐⭐⭐ v12 — v11's EXCLUSION WAS RIGHT AND ITS DESTINATION DID NOT EXIST.
 *
 * v11 was never served. It is pinned here as WITHDRAWN rather than deleted
 * because it WAS measured, and this is what the measurement found.
 *
 * ── THE BLOCKER, MEASURED ──────────────────────────────────────────────────
 * v11 read as working: 6 of 9 draws on the diagnostic briefs stopped filing the
 * competing explanations as options. **All six were clean only by emitting
 * `stated_items[].kind = "claim"` — a value that does not exist.**
 * `DRAFT_RECORD_STATED_KINDS` is `["goal","option","constraint","figure"]`, and
 * `grammar.ts:453` puts exactly that enum in the structured-outputs schema the
 * deployed draft sends (`structured_outputs_used: true` in the capture). The
 * escape route is CLOSED ON THE WIRE, so those six draws could not happen in
 * production. Of the 3 draws that stayed inside the legal enum, 3 of 3 filed the
 * causes as options, and 0 of 27 cause-instances reached the intended
 * destination. Contrast control: the illegal kind occurs 25 times across 8 AFTER
 * draws and 0 times in any BEFORE draw — v11's own wording introduced it.
 *
 * ── WHY THE MODEL REACHED FOR AN ILLEGAL VALUE ─────────────────────────────
 * Two defects in one paragraph, both of them about DESTINATION, not about the
 * rule:
 *   · v11 wrote "File each as a `claim`" and "the disagreement itself is a
 *     `claim`" INSIDE the `kind` enumeration, where `option`, `constraint` and
 *     `figure` are the sibling bullets. Read in place, `claim` is a fifth `kind`.
 *     The model did as it was told, in the only list it was standing in.
 *   · v11 then said "the options are what the user could DO about the problem"
 *     while still inside `stated_items`, every entry of which must be a VERBATIM
 *     span of the brief. On a brief that names no course of action there is no
 *     such span, so the sentence asked for something the stated grammar cannot
 *     express and named no other place to put it.
 *
 * ── ⭐ WHAT v12 CHANGES: IT NAMES THE ROUTE THAT ALREADY EXISTS ────────────
 * NO record kind is added and the grammar is untouched — that would solve a
 * carrier problem that does not exist. `option_refinement` is already a
 * `DRAFT_RECORD_CLAIM_KINDS` member, `CLAIM_KIND_TO_NODE_KIND` already maps it
 * to `option`, and pass 1b already declines to merge one whose `basis` names no
 * stated option, so it stands as its OWN alternative with its OWN chain.
 * Independently confirmed by four executable same-module controls at `a18e1943`
 * (`olumi-programme-docs@f862392d/codex-evidence/resume-20260830/1238-route`):
 * zero stated options plus goal-based proposed actions project to option nodes
 * with `ai_inferred` provenance; the empty-basis variant stays `unbased: true`;
 * the stated-action twin still projects as `stated`; and flipping only the claim
 * role to `factor` yields factors, not options — the discriminating control.
 *
 * ⚠ SCOPE OF THAT EVIDENCE, NOT FLATTENED: it measures PROJECTED CARRIAGE. It
 * proves the grammar CAN carry an AI-proposed option. It does NOT prove the
 * model WILL emit one on a diagnostic brief. That is what v12 must be measured
 * for, and it is measured on grammar-legal draws only.
 *
 * So v12 keeps v11's exclusion verbatim and replaces only the destination:
 *   · `kind` has no fifth value — said in the list itself, which is where the
 *     model was standing when it invented one;
 *   · the cause goes to `claims` as `factor` / `risk`, named by `claim_kind`;
 *   · every hypothesis is RETAINED — the disagreement is the user's reasoning,
 *     not clutter to tidy away;
 *   · an action the model puts forward is an `option_refinement`, which is how
 *     something becomes an option when the user named none, and it arrives
 *     BADGED AS OURS and open to challenge;
 *   · `basis` empty is honest, and stays marked unbased.
 *
 * ⚠ WHAT v12 DELIBERATELY DOES NOT DO, because the product ruling forbids both:
 * it does not push `sets_to` onto explanation-framed options (it cannot: the
 * explanations are no longer options, so no `sets_to` pressure reaches them —
 * the constraint is met STRUCTURALLY, by reclassification, not by a new
 * sentence), and it does not erase attribution to make a gate go green. It also
 * sets NO quota of options: manufacturing alternatives to green the readiness
 * gate is the failure mode this instruction has to avoid, not its objective.
 */
const PREREGISTERED_V12_INSTRUCTION_SHA256 =
  "9c3906151c4a6abec7906fc430c3c26bc8d6c92559a8e859401dd03b9682f232";
const PREREGISTERED_V12_INSTRUCTION_BYTES = 12280;

// Source candidate only: these pins identify the bounded retention instruction,
// not a provider measurement or a served/PMS version. Keep v12's record intact.
const CANDIDATE_V13_INSTRUCTION_SHA256 =
  "6fbac9beae2598e9943d3f33fcd6b58fa995eb6bb3a3b610af5f8355c3438f02";
const CANDIDATE_V13_INSTRUCTION_BYTES = 12632;

describe("the draft records instruction preserves source identity and historical attribution", () => {
  it("hashes to the registered v13 SOURCE CANDIDATE at the pinned byte length", () => {
    expect(draftRecordsInstructionHash()).toBe(CANDIDATE_V13_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).toBe(
      CANDIDATE_V13_INSTRUCTION_BYTES,
    );
  });

  it("is DISTINCT from the historical v12 instruction and cannot inherit its measurements", () => {
    expect(draftRecordsInstructionHash()).not.toBe(PREREGISTERED_V12_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(PREREGISTERED_V12_INSTRUCTION_BYTES);
  });

  it("is DISTINCT from the WITHDRAWN v11 bytes, so v11's measurement stays its own", () => {
    // v11 is the artefact the illegal-`kind` measurement belongs to: 25
    // `kind: "claim"` emissions across 8 draws, 0 in any BEFORE draw. Re-pointing
    // this literal would let that finding read as a finding about v12, which is
    // the version written to remove its cause.
    expect(draftRecordsInstructionHash()).not.toBe(WITHDRAWN_V11_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(
      WITHDRAWN_V11_INSTRUCTION_BYTES,
    );
  });

  it("is DISTINCT from the historic v10 bytes, so v10's runs stay attributable", () => {
    // v10 is the artefact the deployed BEFORE witness was served: the three
    // explanation-shaped option nodes came back from a build running exactly
    // these bytes. Re-pointing this literal would make that measurement read as
    // a measurement of the CURRENT instruction, which is the one thing it is not.
    expect(draftRecordsInstructionHash()).not.toBe(HISTORIC_V10_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(
      HISTORIC_V10_INSTRUCTION_BYTES,
    );
  });

  it("is DISTINCT from the historic v9 bytes, so v9's runs stay attributable", () => {
    // v9 is the artefact every draw behind the 1-of-23 completion measurement was
    // served. Whatever is logged against v10 must stay separable from it, or the
    // before/after on this change becomes unattributable.
    expect(draftRecordsInstructionHash()).not.toBe(HISTORIC_V9_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(
      HISTORIC_V9_INSTRUCTION_BYTES,
    );
  });

  it("is DISTINCT from the historic v8 bytes, so v8's runs stay attributable", () => {
    // v8 was served from the goal-bullet change until this merge. Its own
    // pre-registration note says it was unmeasured at pinning; whatever was
    // logged against it must stay separable from what is logged against v9.
    expect(draftRecordsInstructionHash()).not.toBe(HISTORIC_V8_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(
      HISTORIC_V8_INSTRUCTION_BYTES,
    );
  });

  it("is DISTINCT from the historic v7 bytes, so the 13-brief BEFORE arm stays attributable", () => {
    // The BEFORE half of this change's own evidence was served exactly v7. If a
    // later edit ever lands back on those bytes, that measurement would silently
    // become a measurement of the CURRENT artefact, which is the one thing it is
    // not. Asserting distinctness is also what makes an accidental revert loud.
    expect(draftRecordsInstructionHash()).not.toBe(HISTORIC_V7_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(
      HISTORIC_V7_INSTRUCTION_BYTES,
    );
  });

  it("is DISTINCT from the historic v5 bytes, so round 11's block stays attributable", () => {
    expect(draftRecordsInstructionHash()).not.toBe(HISTORIC_V5_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(
      HISTORIC_V5_INSTRUCTION_BYTES,
    );
  });

  it("is DISTINCT from the historic v4 bytes, so round 7's block stays attributable", () => {
    expect(draftRecordsInstructionHash()).not.toBe(HISTORIC_V4_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(
      HISTORIC_V4_INSTRUCTION_BYTES,
    );
  });

  it("is DISTINCT from the historic v3 bytes, so v3's measured blocks stay attributable", () => {
    expect(draftRecordsInstructionHash()).not.toBe(HISTORIC_V3_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(
      HISTORIC_V3_INSTRUCTION_BYTES,
    );
  });

  it("is DISTINCT from the historic v2 bytes, so v2's measurements stay attributable", () => {
    // The failure this guards is not a typo — it is someone "restoring" the old
    // pin, or hand-editing v3 back toward v2, and thereby making two different
    // instructions share one evidence base.
    expect(draftRecordsInstructionHash()).not.toBe(HISTORIC_V2_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(
      HISTORIC_V2_INSTRUCTION_BYTES,
    );
  });

  it("is exactly the two declared sections, in order, and nothing else", () => {
    // Derived rather than restated: if a third section is ever appended without
    // being exported, this fails even though the hash test might have been
    // "fixed" by someone re-pinning it.
    expect(DRAFT_RECORDS_INSTRUCTION).toBe(
      `${DRAFT_RECORDS_SHAPE_INSTRUCTION}\n${DRAFT_RECORDS_CONNECT_INSTRUCTION}`.trimEnd(),
    );
    expect(DRAFT_RECORDS_INSTRUCTION.startsWith(DRAFT_RECORDS_SHAPE_INSTRUCTION)).toBe(true);
  });

  it("is DISTINCT from the historic v6 instruction, so v6's runs stay attributable", () => {
    // Not decoration. Every draft served between the 2026-08-14 grammar widening
    // and the `is_baseline` widening received exactly those bytes, and a reader of
    // those logs must be able to tell which instruction produced them. Asserting
    // distinctness is also what makes an accidental REVERT loud: a re-pointed pin
    // and a reverted artefact are indistinguishable from a single equality check.
    expect(draftRecordsInstructionHash()).not.toBe(HISTORIC_V6_INSTRUCTION_SHA256);
    expect(Buffer.byteLength(DRAFT_RECORDS_INSTRUCTION, "utf8")).not.toBe(
      HISTORIC_V6_INSTRUCTION_BYTES,
    );
  });

  it("keeps the shape half independently pinned, so a reference-syntax edit is legible as one", () => {
    // The two halves were measured separately: the shape half alone produced
    // ZERO option-origin causal links over 44 links / 9 runs; adding the connect
    // half moved that to 28 of 75 on the first attempt. Pinning them apart is
    // what makes a future edit attributable to one half or the other.
    //
    // ⚠⚠ THE SHAPE HALF MOVED IN v4, AND IT HAD NEVER MOVED BEFORE. v2 and v3
    // shared it byte-for-byte (`a6de4225…`, 1,443 bytes) because both described
    // the same reference syntax. v4 changes that syntax — the namespace is now
    // the FIELD, not a prefix character inside a string — and the sentence that
    // teaches it lives in the shape half. Recorded explicitly because "the shape
    // half is unchanged" was true for two versions running and is exactly the
    // kind of inherited sentence that survives past the change that falsified it.
    //
    // ⚠⚠ AND IT MOVED AGAIN IN v7 — the second consecutive version to touch it,
    // which the v4 note above could not have anticipated. Both v7 sentences
    // (`is_baseline` on a status-quo option, `role` on a numeric goal) are
    // SHAPE-half statements: each tells the model what to PUT IN A FIELD, not how
    // to connect two records. The connect half is byte-identical to v6, and that
    // asymmetry is the point of pinning the halves apart — this edit is legible
    // as a shape-only change without reading the diff.
    //
    // ⚠⚠ AND AGAIN IN v8 — the THIRD consecutive version to touch it, and the
    // largest single move it has ever made (3,100 → 4,617 bytes). The whole of
    // v8 is shape-half: what a `goal` IS is a statement about which span goes in
    // a field, not about how two records connect. The connect half is
    // byte-identical to v6/v7 (`44c96633…` / 3,648, asserted below), so this
    // edit is legible as shape-only without reading the diff — which is the
    // entire reason the halves are pinned apart.
    //
    // ⚠⚠ AND AGAIN IN v9 — the FOURTH consecutive version to touch it. What an
    // `option` IS, and which span of the brief names it, are both statements
    // about what goes in a field, so v9 is shape-half in its entirety and the
    // connect half is byte-identical to v6/v7/v8 (asserted in the next test).
    //
    // ⚠⚠ AND AGAIN IN v11 — the FIFTH version to touch it, after v10 left it
    // alone entirely. What an `option` IS, and which spans are excluded from
    // being one, are statements about what goes in a field, so v11 is shape-half
    // in its entirety and the connect half is byte-identical to v10 (asserted in
    // the next test). That asymmetry is the point of pinning the halves apart:
    // this edit is legible as "the option bullet changed" without reading a diff.
    expect(createHash("sha256").update(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8").digest("hex")).toBe(
      "aa3d7c18d26326260476ce5ae674f7dfee91fc8bf10b5eaf0ce5996625f28b3f",
    );
    expect(Buffer.byteLength(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8")).toBe(7736);
    // WITHDRAWN — v11's shape half. Asserted DISTINCT because the illegal-`kind`
    // draws were produced by exactly these bytes and must stay attributable to
    // them; v12 replaced this paragraph's DESTINATION, not its rule.
    expect(createHash("sha256").update(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8").digest("hex")).not.toBe(
      "5f058e0be800bda882350a1c33b88e89b4308b16e57cfff9c83a63c0bce0b3c3",
    );
    expect(Buffer.byteLength(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8")).not.toBe(6627);
    // HISTORIC — the v9/v10 SHARED shape half (v10 moved the connect half only).
    // Asserted DISTINCT: these are the bytes the deployed BEFORE witness was
    // served, so they must stay separable from the ones that replace them.
    expect(createHash("sha256").update(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8").digest("hex")).not.toBe(
      "9dfb9f583edaf66df70d355a260a9a56ef9b80fe3367a5043a97d3cca048a207",
    );
    expect(Buffer.byteLength(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8")).not.toBe(5535);
    // HISTORIC — v8's shape half. Asserted DISTINCT so v8's runs stay
    // attributable to the bytes that produced them.
    expect(createHash("sha256").update(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8").digest("hex")).not.toBe(
      "03974285d14572f39df7a7758ce553de956798c48a5a88376346ec12a203fe04",
    );
    // HISTORIC — v7's shape half. Asserted DISTINCT: it is the artefact the
    // 13-brief BEFORE arm was served, and it must stay separable from this one.
    expect(createHash("sha256").update(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8").digest("hex")).not.toBe(
      "8964de6b75f45814bdbf0af7f8439e27a7a6ed75022368cca927d9105c225a4d",
    );
    // HISTORIC — v6's shape half. Asserted DISTINCT so v6's runs stay attributable.
    expect(createHash("sha256").update(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8").digest("hex")).not.toBe(
      "575509cbc8570c1bd4fb8d31f9ce8b83f3d5508f28f37a5f11417a1f6dd30a3e",
    );
    // HISTORIC — v4/v5's shared shape half. Asserted DISTINCT: it stood
    // unchanged for two versions, which is exactly the kind of "unchanged" a
    // reader inherits past the change that ended it.
    expect(createHash("sha256").update(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8").digest("hex")).not.toBe(
      "175af059317040381c4529c0e9ec0342070b7d14425b62fd6c5b374df48a99d6",
    );
    // HISTORIC — v2/v3's shared shape half. Asserted DISTINCT so the two cannot
    // be conflated in the record.
    expect(createHash("sha256").update(DRAFT_RECORDS_SHAPE_INSTRUCTION, "utf8").digest("hex")).not.toBe(
      "a6de4225a94bf321185775a7b34d01b1eb4f7f9def5c0c6ee7b2f1fc95692a80",
    );
  });

  it("pins the v5 CONNECT half independently, so the half that changed is legible", () => {
    // v4 changes the connect half too: "chain the option the USER named" replaces
    // v3's "an option_refinement IS an option needing its own chain". That v3
    // sentence closed one direction of a defect and opened its mirror — the model
    // complied and left the user's own options bare — so the load-bearing half of
    // the v4 fix is DETERMINISTIC (the projector merges a lone refinement onto its
    // stated parent) and this sentence is only its instruction-side complement.
    //
    // ⭐ v5 adds ONE bullet to this half and changes nothing else: the goal is a
    // `stated_item`, so `to_stated` is how a link reaches it. That sentence is
    // the instruction-side half of round 9's goal-targeting fix; its
    // completion-side half names the goal's exact index in the ask.
    //
    // ⭐⭐ v10 MOVES THIS HALF, and it is the ONLY half it moves — the shape half
    // is byte-identical to v9. That is exactly what pinning the halves apart is
    // for: this edit is legible as "the option-effect-value section changed"
    // without reading the diff. See the v10 block above for why the sentence it
    // replaced was false at `f18d941b`.
    expect(
      createHash("sha256").update(DRAFT_RECORDS_CONNECT_INSTRUCTION, "utf8").digest("hex"),
    ).toBe("b631a9538e5c1e9a5bcb1e0c884c2cb81f7920ab5c1b61f3a15ba12d106691f9");
    expect(Buffer.byteLength(DRAFT_RECORDS_CONNECT_INSTRUCTION, "utf8")).toBe(4544);
    // HISTORIC — the v6/v7/v8/v9 connect half, asserted DISTINCT. Every draw in
    // the 1-of-23 measurement was served these bytes.
    expect(
      createHash("sha256").update(DRAFT_RECORDS_CONNECT_INSTRUCTION, "utf8").digest("hex"),
    ).not.toBe("44c966336427c2672c2a0ee96bb6a507877ee7819660d77d496d9f982d1b879f");
    expect(Buffer.byteLength(DRAFT_RECORDS_CONNECT_INSTRUCTION, "utf8")).not.toBe(3648);
    // HISTORIC — v5's connect half, asserted DISTINCT.
    expect(
      createHash("sha256").update(DRAFT_RECORDS_CONNECT_INSTRUCTION, "utf8").digest("hex"),
    ).not.toBe("6f395141d575f2b1b6e04454da84dc0b755cadfc60bd77fde7894207913a5b87");
    // HISTORIC — v4's connect half, asserted DISTINCT.
    expect(
      createHash("sha256").update(DRAFT_RECORDS_CONNECT_INSTRUCTION, "utf8").digest("hex"),
    ).not.toBe("cb7fa43faf8237c974f044c098a6c97d8d9003733705f58ff2df3cf41786af74");
    // HISTORIC — v3's connect half, asserted DISTINCT.
    expect(
      createHash("sha256").update(DRAFT_RECORDS_CONNECT_INSTRUCTION, "utf8").digest("hex"),
    ).not.toBe("53a6955a40d9a8c877d8f1dc09f24343b3cfac540d74dfcc82aa507ea131d856");
  });

  /**
   * ⭐ THE v5 SENTENCE, PINNED BY CONTENT rather than only by a hash.
   *
   * A hash pin fails on ANY edit, which means it cannot tell "someone removed
   * the goal-targeting rule" from "someone fixed a typo two bullets away". This
   * is the one sentence round 9's whole goal-link fix rests on, so it is bound to
   * its own content — and bound to BOTH halves of the claim, because the negative
   * half ("`to_claim` cannot reach it") is the one that names the actual defect.
   */
  /**
   * ⭐⭐ THE v11 RULE, PINNED BY CONTENT — AND THE TWO DIRECTIONS PINNED APART.
   *
   * A hash pin cannot tell "someone deleted the preservation clause" from
   * "someone fixed a typo two bullets away", and here that distinction is the
   * whole safety argument. Two OPPOSITE harms, asserted separately, because a
   * fix for either alone reopens the other (CLAUDE.md trap 22b):
   *
   *   (a) A PROPOSED CAUSE IS SCORED AS AN OPTION. The witnessed defect: three
   *       competing explanations of why growth stalled shipped as ranked
   *       alternatives, so the analysis reported a win probability for
   *       "The Product Has Fallen Behind Competitors".
   *   (b) A REAL OPTION IS DEMOTED BECAUSE SOMEONE IS NAMED AS PROPOSING IT.
   *       STRICTLY WORSE than (a): it silently deletes the user's actual
   *       alternatives from their own decision, and it would not show up in any
   *       corpus of diagnostic briefs. A rule keyed on attribution rather than
   *       on action produces exactly this, which is why the clause naming it is
   *       asserted in its own right and not folded into (a).
   */
  it("excludes a proposed cause from being an option, without demoting attributed actions", () => {
    // (a) the exclusion, bound to the discriminator rather than to a phrase list
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "An option is something you can CARRY OUT.",
    );
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "A proposed CAUSE is the case this catches most often.",
    );
    // and where the demoted span is to go, or the rule only says "not here"
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "with `claim_kind` `factor` for what it says varies\n  and `risk` for what it says threatens the goal",
    );
    // (b) the opposite-direction half — the one that keeps this fix from being
    // worse than the defect it closes.
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain("Who said it makes no difference.");
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "names two real acts, and both are options",
    );
  });

  /**
   * ⭐⭐⭐ THE v12 ROUTE, PINNED BY CONTENT — THE THREE PARTS THAT MADE v11
   * UNSHIPPABLE, EACH ASSERTED IN ITS OWN RIGHT.
   *
   * v11's rule was right and its DESTINATION did not exist, so 6 of its 9 clean
   * draws were clean only by emitting an illegal `stated_items[].kind`. Each
   * assertion below closes one of the three ways that happened, and they are
   * separate because a fix for any one alone leaves the others open.
   */
  it("routes a demoted cause to a destination that EXISTS on the wire", () => {
    // (1) THE ILLEGAL ESCAPE, closed in the list the model was standing in when
    // it invented a fifth value. Bound to the grammar's own enum rather than to
    // a phrase, so it fails loud if `DRAFT_RECORD_STATED_KINDS` ever widens
    // without this sentence moving with it.
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "It is not a stated_item of any kind: the four above are the\n  only values `kind` takes, and there is no fifth.",
    );
    expect(DRAFT_RECORD_STATED_KINDS).toHaveLength(4);
    expect([...DRAFT_RECORD_STATED_KINDS]).not.toContain("claim");

    // (2) THE CARRIER, NAMED. v11 described an end state ("the options are what
    // the user could DO about the problem") and left the model to find a shape
    // for it. `option_refinement` is that shape and it already existed.
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "An action YOU are putting forward is an\n  `option_refinement` claim",
    );
    expect([...DRAFT_RECORD_CLAIM_KINDS]).toContain("option_refinement");
    // named in the claim-kind list too, or the model meets the term cold
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "when the user named no\n  course of action and the option is one you are proposing",
    );

    // (3) THE TWO THINGS THE PRODUCT RULING FORBIDS TRADING AWAY TO GET AN
    // ANALYSIS TO RUN. Both are asserted here because both are invisible to a
    // "zero false options" count — the symptom metric that passed v11.
    //   · hypotheses are RETAINED, not tidied away
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain("Keep every one of them.");
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "a hypothesis dropped to tidy the graph removes the thing\n  they are arguing about",
    );
    //   · attribution SURVIVES: ours arrives marked ours, unbased stays unbased
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "so putting it there is what lets the user\n  tell your proposal from their own words and argue with it",
    );
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "an option that honestly rests on nothing is worth more than one\n  resting on a basis that does not hold",
    );
    // ⚠ AND IT SAYS ALL THAT WITHOUT A WORD OF PROVENANCE VOCABULARY, which is
    // load-bearing and is NOT decoration: the model has no provenance channel,
    // and the suite below ("the instruction says nothing it must not say")
    // forbids the concept outright, because a model that is told about a stamp
    // it cannot set will approximate one. The guarantee is delivered by the
    // PROJECTOR; this sentence only tells the model which array it is writing in.
  });

  /**
   * ⭐ THE NEGATIVE HALF, and it is the one a later tidy-up would delete.
   *
   * v12 must NOT buy a completed analysis with either of the two currencies the
   * product ruling puts off the table. A hash pin cannot see the difference
   * between adding a clarifying sentence and adding a quota, so the prohibitions
   * are asserted as ABSENCES with a contrast control proving the probe can see a
   * presence at all (CLAUDE.md trap 13).
   */
  it("adds no option quota and no sets_to pressure on explanations", () => {
    const shape = DRAFT_RECORDS_SHAPE_INSTRUCTION;
    // CONTRAST CONTROL — the probe must find a string that IS there, or every
    // absence below is vacuous.
    expect(shape).toContain("option_refinement");

    // No quota: "at least two options", "two or more options" and friends would
    // make the model manufacture alternatives to clear `options.length < 2` in
    // `analysis-ready-helper.ts:1487`. That is forcing a decision framing onto
    // diagnostic work, which is worse than blocking.
    expect(shape).not.toMatch(/at least (two|2|three|3) option/i);
    expect(shape).not.toMatch(/(two|three|2|3) or more option/i);

    // No `sets_to` in the shape half at all. It belongs to the connect half, and
    // it must never be asked for on something explanation-framed: "the value
    // that factor would take if that option were chosen" is undefined for a
    // hypothesis, and forcing it would rank hypotheses as if they were actions.
    expect(shape).not.toContain("sets_to");
    // The connect half is where it lives, unchanged — the contrast that proves
    // the absence above is about placement, not about the string being gone.
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain("sets_to");
  });

  it("keeps the goal-is-a-stated-item rule that round 9 added", () => {
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain(
      "The goal is a `stated_item`, so a link that reaches it sets `to_stated`.",
    );
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain(
      "goal is never one of your `claims`, so `to_claim` cannot reach it",
    );
  });

  /**
   * ⭐⭐ THE v10 RULES, PINNED BY CONTENT — AND THE TWO DIRECTIONS PINNED APART.
   *
   * A hash pin cannot tell "someone reinstated the withholding rule" from
   * "someone fixed a typo", and here that distinction is the difference between
   * a product that runs and one that refuses 20 journeys in 23.
   *
   * TWO OPPOSITE HARMS, asserted separately, because a fix for either alone
   * reopens the other (CLAUDE.md trap 22b — the opposite-direction twin):
   *
   *   (a) THE VALUE IS WITHHELD. The model omits `sets_to`, options carry no
   *       interventions, every pair raises `MISSING_OPTION_VALUE` and nothing
   *       can be analysed. This is what v9 instructed, and it is the defect.
   *   (b) THE VALUE IS INVENTED AND PASSED OFF AS THE USER'S. Strictly worse —
   *       it is the class-1 defect on the field the analysis ranks options on.
   *       The instruction guards this by still routing stated figures through
   *       `basis`; the PROJECTOR guards it by stamping provenance, which is why
   *       `option-effect-value-provenance.test.ts` is the other half of the pair.
   *
   * ⚠ The negative assertion is the load-bearing one: it names the exact
   * withdrawn sentence, so an accidental revert to v9's policy is LOUD rather
   * than silently re-blocking the product under a green suite.
   */
  it("asks for the option effect value on every link, instead of instructing its omission", () => {
    // (a) the ask itself
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain(
      "Set it on every option→factor link you emit.",
    );
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain(
      "give your best estimate, reasoned from what",
    );
    // (b) the stated figure still routes through `basis` — the estimate is not
    // bought by loosening the user's own half.
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain(
      "set `basis` to the stated_items it came from",
    );
    // The shape half's invention prohibition on the USER's values is untouched.
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "Do not invent a number the\nuser did not state",
    );
  });

  it("no longer carries v9's withholding rule, in either of its two sentences", () => {
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).not.toContain(
      "Where the brief does not support a number,\nleave `sets_to` out.",
    );
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).not.toContain(
      "a guessed one is\nread as the user's own and cannot be told apart from a figure they gave you",
    );
    // POSITIVE CONTROL for both negatives: the probe can still find a string
    // that IS present in this half, so a `not.toContain` above is a
    // discrimination rather than a dead assertion (CLAUDE.md trap 13).
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain("## HOW MUCH EACH OPTION MOVES");
  });

  /**
   * ⭐⭐ THE v8 RULES, PINNED BY CONTENT — AND THE TWO DIRECTIONS PINNED APART.
   *
   * A hash pin cannot tell "someone deleted the preservation clause" from
   * "someone fixed a typo", and here that distinction is the whole safety
   * argument. This guards TWO OPPOSITE HARMS, and they are asserted separately
   * on purpose, because a fix for either one alone reopens the other:
   *
   *   (a) THE GOAL IS AN OPTION. The frame is pre-committed and every causal
   *       chain is built to justify a move the user has not finished making.
   *   (b) A STATED OBJECTIVE IS DISCARDED and a better-formed one substituted.
   *       That is the WORSE harm — it silently replaces the user's judgement
   *       with ours — and 6 of 6 briefs that state an outcome already get it
   *       right today, so it is a live regression risk, not a hypothetical.
   *
   * Deleting either group must go red BY NAME, not as an unexplained hash drift.
   */
  it("keeps the v8 rule that a goal is the result wanted, not the move weighed", () => {
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "the result the user wants, not the move they are weighing to get",
    );
    // The structural test, which is what makes this a rule about the GRAPH
    // rather than a rule about wording. Without it the definition is a slogan.
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "has to be a candidate route TO the goal",
    );
    // Derived from a live observation, not invented: on the 2026-08-29 corpus
    // the model filed ONE span as both records, byte-identical `source_quote`.
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "Never file one span as both a `goal` and an `option`",
    );
    // The constructive half. Without it the model is told what a goal is NOT and
    // given nothing to do on the 7-of-13 briefs that never state one — and the
    // measured failure mode is precisely falling back to the sentence that
    // frames the choice.
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "that sentence is the decision, not its purpose",
    );
  });

  it("keeps the v8 clause that protects a stated objective from being improved", () => {
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "When the user HAS said what they are trying to achieve, that is the goal.",
    );
    // The three adjectives are the load-bearing part: they are the cases where
    // substituting a sharper objective is most tempting and most wrong.
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "even if it is unquantified, modest or awkwardly worded",
    );
  });

  /**
   * ⭐⭐ THE v9 RULES, PINNED BY CONTENT — AND THE TWO HALVES PINNED APART,
   * because they answer different questions and only one of them reaches a label.
   *
   * A hash pin cannot tell "someone deleted the span rule" from "someone fixed a
   * typo two bullets away", and here the span rule is the ONLY sentence in the
   * whole instruction that can shorten an option label: on this path the label
   * IS `source_quote`, and `source_quote` must be verbatim, so "a shorter span
   * is still verbatim" is what makes a short label reachable at all. Delete it
   * and the classification half still reads correctly while every option node
   * silently goes back to carrying a pasted sentence.
   */
  it("keeps the v9 span rule, which is the only sentence that can shorten an option label", () => {
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "Quote the span that NAMES the action, not the sentence it sits in.",
    );
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain("A shorter\n  span is still verbatim");
  });

  it("keeps the v9 exclusions, which are what stop a non-option being scored", () => {
    // The decision question shipped as an option — and then as the BASELINE
    // option — in the witnessed corpus. This is the sentence that addresses it.
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "The question the user is deciding is not an option.",
    );
    // The other three witnessed classes: a stated unknown, a piece of history,
    // and a description of how things work today.
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "something they say they do not know,\n  something that already happened, nor a description of how things work today",
    );
    // ⚠ AND THE REASON, which is what makes it a contract rather than a rule the
    // model discards under load — the same discipline v6 states for its own
    // reclassification lines.
    expect(DRAFT_RECORDS_SHAPE_INSTRUCTION).toContain(
      "to be scored and ranked against the others",
    );
  });
});

describe("the instruction says nothing it must not say", () => {
  /**
   * The model has NO provenance channel — `grammar.ts` carries no provenance
   * property, and that absence is the mechanism that makes false authorship
   * structurally impossible rather than merely discouraged. An instruction that
   * discussed provenance would invite the model to try to express one, and the
   * first thing a model does when it cannot express something is approximate it.
   *
   * Bound to the CONCEPT's vocabulary, not to one phrasing.
   */
  it("never mentions provenance, attribution or authorship", () => {
    const lowered = DRAFT_RECORDS_INSTRUCTION.toLowerCase();
    for (const forbidden of ["provenance", "attribut", "authorship", "badge", "from_brief", "ai_inferred"]) {
      expect(lowered).not.toContain(forbidden);
    }
  });

  /**
   * `category` is INFERRED FROM STRUCTURE by the validator
   * (`graph-validator.ts:83-134`): a factor is `controllable` because an option
   * edge points at it. Asking the model to DECLARE it invites `CATEGORY_MISMATCH`
   * — the instruction would be manufacturing the very rejection it exists to
   * avoid.
   */
  it("never asks the model to declare a category", () => {
    expect(DRAFT_RECORDS_INSTRUCTION.toLowerCase()).not.toContain("category");
    expect(DRAFT_RECORDS_INSTRUCTION).not.toContain("controllable");
  });

  /**
   * A number the model was not asked for is invented precision, and the repair
   * machinery defaults edge strength anyway — so asking for it buys nothing and
   * costs honesty.
   */
  it("never asks the model for an edge strength", () => {
    expect(DRAFT_RECORDS_INSTRUCTION).not.toContain("strength");
  });

  /**
   * The one prohibition that must survive every future edit: the model must not
   * invent a number the user did not state. This is the sentence the fabrication
   * gate rests on, so it is pinned by content rather than left to a hash that a
   * legitimate edit elsewhere would move.
   */
  it("keeps the do-not-invent-a-number prohibition", () => {
    expect(DRAFT_RECORDS_INSTRUCTION).toContain(
      "Do not invent a number the\nuser did not state, and do not round or rescale one they did.",
    );
  });

  /**
   * ⭐ AND THE ANTI-PRESSURE CLAUSE, which is the reason zero claims is a
   * legitimate answer. Without it, "emit claims" reads as "emit claims", and a
   * model that cannot find a basis will manufacture one.
   */
  it("keeps empty basis as an explicitly legitimate answer", () => {
    expect(DRAFT_RECORDS_INSTRUCTION).toContain("leave `basis` empty — that\nis a legitimate and expected answer");
    expect(DRAFT_RECORDS_INSTRUCTION).toContain("An empty `claims` list is a valid response.");
  });

  /**
   * The connect half is the half that could most easily be turned into pressure
   * to invent. It must keep BOTH of its balancing sentences: the one that removes
   * a claim, and the one that forbids dropping anything the user stated.
   */
  it("keeps the conditional connection rule and protection of user-stated material", () => {
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain("Outside that case, do not emit a factor you cannot connect.");
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain("But never drop\nsomething the user stated");
  });

  it("names the v13 numberless-retention exception without instructing fabricated links or priors", () => {
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain("With no decision or options, keep unresolved explanations as numberless");
    expect(DRAFT_RECORDS_CONNECT_INSTRUCTION).toContain("do not invent a link, value or prior merely to connect them or enable analysis.");
  });
});
