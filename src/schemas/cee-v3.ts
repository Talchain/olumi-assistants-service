/**
 * CEE V3 Schema Types
 *
 * V3 introduces a canonical intervention model where options are separate from
 * graph nodes and include explicit intervention mappings to factor nodes.
 *
 * Key changes from V2:
 * - Options moved from graph.nodes to top-level options[] array
 * - Options include interventions: { factor_id: { value, source, target_match } }
 * - Options have status: 'ready' | 'needs_user_mapping'
 * - goal_node_id is required at top level
 * - Edge strength uses strength_mean (unconstrained) instead of weight (0-1)
 */

import { z } from "zod";
import type { ValidationMetadata } from "../cee/validation-pipeline/types.js";
import { GoalConstraintSchema } from "./assist.js";
import { CausalClaimsArraySchema } from "./causal-claims.js";
import { GoalThresholdCapProvenanceSchema } from "../utils/goal-threshold-cap.js";
import { ValidationWarningSchema as SharedValidationWarningSchema, CIL_WARNING_CODES, GoalThresholdFrame, OBSERVED_STATE_SOURCE_LITERALS } from "@talchain/schemas";
import { CAUSAL_CLAIMS_WARNING_CODES } from "./causal-claims.js";
import { CANONICAL_ID_REGEX } from "../cee/utils/id-normalizer.js";
import { OBSERVED_STATE_STATED_ROLES } from "../cee/context-integrity/stated-role-vocabulary.js";

// ============================================================================
// Node Types
// ============================================================================

/**
 * Valid node kinds in V3.
 * Options are included for graph connectivity (decision→option→factor).
 * Options also exist in the separate options[] array with intervention metadata.
 */
export const NodeKindV3 = z.enum([
  "goal",
  "factor",
  "outcome",
  "decision",
  "risk",
  "action",
  "option",
]);
export type NodeKindV3T = z.infer<typeof NodeKindV3>;

/**
 * Factor type classification for downstream enrichment.
 */
export const FactorTypeV3 = z.enum(["cost", "price", "time", "probability", "revenue", "demand", "quality", "other"]);
export type FactorTypeV3T = z.infer<typeof FactorTypeV3>;

/**
 * Observed state for factor nodes with quantitative values.
 */
export const ObservedStateV3 = z.object({
  /** Current or proposed value */
  value: z.number(),
  /** Baseline/original value */
  baseline: z.number().optional(),
  /** Unit of measurement (e.g., 'GBP', 'USD', 'percent', 'count', 'months') */
  unit: z.string().optional(),
  /** How the value was determined.
   *
   *  PRODUCER members: `brief_extraction` / `cee_inference` (CEE's own
   *  extraction/inference writers).
   *
   *  USER-OWNED members (2.396(b), P4 transport 2026-08-05): the literals the
   *  estate's user-edit writers actually stamp — CEE's own chat-edit seams
   *  write `user_override` (stampUserEditProvenance / set_factor_value), and
   *  the UI's edit surfaces write `user_override` / `user_confirmed` /
   *  `user` (+ `user_assumption` / `user_edited` recognised forward-compat by
   *  its REVIEWED_SOURCES predicate, DecisionGuideAI isReviewedByUser.ts —
   *  the acknowledged cross-repo source of this list). Before this widening
   *  the enum was structurally incapable of carrying ANY user stamp, so every
   *  chat-set value rendered as "Olumi estimate", and a UI-stamped stored
   *  graph FAILED this parse at every edit seam.
   *
   *  The pill-earning wire literal is `user_override` (witnessed runE2,
   *  journey-witness-final-2026-08-04). The shared contract types this field
   *  as a free string (`ObservedStateSchema.source: z.string()`), and ISL as
   *  `Optional[str]` — this enum is the narrowest validator in the chain, so
   *  it is the one that must name every legitimate writer.
   *
   *  ⭐ 0.40.0 — THIS LIST IS NO LONGER HAND-MAINTAINED. It is DERIVED from the
   *  shared contract's `OBSERVED_STATE_SOURCE_LITERALS`, which 0.40.0 minted as
   *  the single owner of this vocabulary precisely so the two mirrors it names
   *  (this enum, and the UI's `SOURCE_CLASSES`) stop drifting. The contract's
   *  own instruction: "consumers should DERIVE their classifier/validator
   *  membership from this list at their >=0.40.0 re-vendor". CLAUDE.md trap 12
   *  — a list a human must remember to sync WILL drift, and the drift reads
   *  green. `observed-state-source-derivation.test.ts` asserts SET EQUALITY
   *  with the canonical list, so this fails loud in BOTH directions.
   *
   *  ⚠ MEASURED CONSEQUENCE, disclosed rather than glossed. The derivation
   *  WIDENS this validator from 7 literals to 12. The five newly-accepted are
   *  `explicit`, `inferred`, `cee_repair`, `user_calibration`, `panel_elicited`.
   *  Four of those five were ALREADY writable somewhere in the estate — they
   *  are members of the UI's 11-literal `SOURCE_CLASSES`, which the paragraph
   *  above names as "the acknowledged cross-repo source of this list" — and so
   *  were already capable of failing this parse. The widening closes latent
   *  refusals; it does not open a new hole.
   *
   *  ⚠ THE SENTENCE THAT USED TO FOLLOW IS NOW FALSE, AND ITS FALSENESS WAS THE
   *  DEFECT. It read: "Nothing in CEE BRANCHES on any `source` value other than
   *  `brief_extraction` (complete non-test sweep at this tip:
   *  `cee/decision-review/graph-normalizer.ts:122` and
   *  `cee/provenance/money-invariant.ts`, both testing only for
   *  `brief_extraction`, whose behaviour is byte-unchanged), so a wider accept
   *  set cannot redirect an existing decision." The sweep was accurate; the
   *  INFERENCE was not. `graph-normalizer.ts` tested only for `brief_extraction`
   *  because it held a private TWO-member mirror of this very vocabulary, and
   *  its `else` arm sampled every user-authored literal — including a verified
   *  `panel_elicited` answer — 50% WIDER than the model's own reading of the
   *  brief. Testing for ONE literal out of twelve is not "not branching"; it is
   *  branching with an inverted default.
   *
   *  Corrected at `cee/decision-review/value-source-extraction-type.ts`, which
   *  maps the whole vocabulary under a `Record<KnownObservedStateSourceLiteral,
   *  …>` so a thirteenth literal fails typecheck. `cee/provenance/
   *  money-invariant.ts` still tests only for `brief_extraction`; that read was
   *  NOT re-derived by this lane and is stated as unexamined, not as safe.
   *
   *  `panel_elicited` is the one genuinely NEW member, and CEE is its ONLY
   *  stamper — `set_factor_value`, and only after `verifyAppliedFrom` has
   *  checked the client's claim against CEE's own collab store. Without it
   *  here CEE REJECTS ITS OWN STAMP: the post-mutation `GraphV3.safeParse` in
   *  `system-events/factor-value-edit.ts` fails and the user is told "I
   *  couldn't save that change." Derived BY EXECUTION at this tip, with a
   *  `user_override` positive control, before this line was written. */
  source: z.enum(OBSERVED_STATE_SOURCE_LITERALS).optional(),
  /** Raw value before normalization (preserves original extraction) */
  raw_value: z.number().optional(),
  /** Upper bound/cap for the value (e.g., "up to £500k" → cap is 500000) */
  cap: z.number().optional(),
  /** How the value was extracted (explicit, inferred, range, observed) */
  extractionType: z.enum(["explicit", "inferred", "range", "observed"]).optional(),
  /**
   * ⭐⭐ WHAT THE USER STATED THIS MAGNITUDE **AS** — the role axis.
   *
   * `extractionType` beside it answers a DIFFERENT question and the two must
   * not be collapsed (CLAUDE.md trap 21): its four members all describe HOW THE
   * PIPELINE READ THE BRIEF, and `explicit` is stamped just as readily on a
   * ceiling as on a measurement. Measured live 14 Sep 2026: a brief saying
   * *"keeping monthly churn under 4%"* reached this object as
   * `{ value: 0.04, extractionType: "explicit" }` — an `observed_state`, the
   * field for what is CURRENTLY TRUE, asserting that churn IS 4%.
   *
   * `constraint` means: the user stated this magnitude as a LIMIT, and the
   * level stored beside it is that limit re-used as the node's position, NOT a
   * level the user asserted. The value is deliberately left in place — PLoT
   * needs `observed_state.value` to evaluate the limit at all
   * (`constraint-pu-injection.ts` → `missing_observed_state`), so deleting it
   * would trade a false statement for an unevaluable one. What changes is that
   * the claim is no longer silent.
   *
   * ABSENCE MEANS UNDECLARED and MUST fail open to today's behaviour. It is
   * absent on every node written before this field existed and on every node
   * whose role no producer could settle — a consumer must never read absence as
   * "therefore an observation".
   *
   * Producer: `deriveStatedQuantityRoles`
   * (`cee/context-integrity/not-modelled-manifest.ts`), stamped at the V3
   * boundary. Vocabulary derived from `OBSERVED_STATE_STATED_ROLES` rather than
   * restated, and that module explains why it has one member.
   */
  stated_role: z.enum(OBSERVED_STATE_STATED_ROLES).optional(),
  /** Factor type classification for downstream enrichment */
  factor_type: FactorTypeV3.optional(),
  /** 1-2 short phrases explaining sources of epistemic uncertainty */
  uncertainty_drivers: z.array(z.string()).max(2).refine(
    (arr) => new Set(arr).size === arr.length,
    { message: "uncertainty_drivers must not contain duplicates" }
  ).optional(),
}).passthrough(); // CIL Phase 0: preserve additive fields from LLM/enrichment
export type ObservedStateV3T = z.infer<typeof ObservedStateV3>;

/**
 * Factor category classification (V12.4+).
 * - controllable: Has incoming edge from option node, options set this value
 * - observable: No option edge but has known current state (data.value)
 * - external: No option edge, unknown/variable state (no data field)
 */
export const FactorCategoryV3 = z.enum(["controllable", "observable", "external"]);
export type FactorCategoryV3T = z.infer<typeof FactorCategoryV3>;

/**
 * V3 node schema.
 */
export const NodeV3 = z.object({
  /** Node ID - canonical pattern: lowercase alphanumeric, underscores, colons, hyphens */
  id: z.string().regex(CANONICAL_ID_REGEX, "Node ID must contain only lowercase alphanumeric, underscores, colons, or hyphens"),
  /** Node kind */
  kind: NodeKindV3,
  /** Human-readable label */
  label: z.string(),
  /** Optional description */
  description: z.string().optional(),
  /** Quantitative data for factor nodes */
  observed_state: ObservedStateV3.optional(),
  /** Factor category (V12.4+): controllable, observable, external - only for factor nodes */
  category: FactorCategoryV3.optional(),
  /**
   * Goal threshold fields (V14+).
   * Only applies to goal nodes. Extracted from explicit numeric targets in brief.
   */
  /** Normalised threshold in model units (0-1), computed as goal_threshold_raw / goal_threshold_cap */
  goal_threshold: z.number().optional(),
  /** Raw threshold value from brief for UI display (e.g., 800 for "target 800 customers") */
  goal_threshold_raw: z.number().optional(),
  /** Unit of measurement for display (e.g., "customers", "%", "£") */
  goal_threshold_unit: z.string().optional(),
  /** Normalisation denominator (e.g., 1000 for "800/1000 = 0.8") */
  goal_threshold_cap: z.number().optional(),
  /**
   * WHICH RULE PRODUCED `goal_threshold_cap` — see
   * `GOAL_THRESHOLD_CAP_PROVENANCE` (utils/goal-threshold-cap.ts).
   *
   * On `target_derived_headroom` the denominator is `raw * 1.25`, so
   * `goal_threshold = raw / cap` is the CONSTANT 0.8 for every target and
   * carries no information about the goal; the other two rules take their
   * denominator from outside the target and do. A consumer cannot fail closed
   * on a denominator it cannot see.
   *
   * ⚠ THIS DECLARATION IS LOAD-BEARING, NOT DOCUMENTATION — the same warning
   * `goal_threshold_frame` carries below. `NodeV3` is a plain `z.object`
   * ("declared fields only — unknown fields stripped"), so an undeclared
   * provenance is SILENTLY DELETED by `GraphV3.safeParse` on the run path and
   * the stamp would reach nothing, with no error anywhere. Proven by a positive
   * control in `__tests__/goal-threshold-cap-provenance-wire-survival.test.ts`.
   *
   * ABSENCE MEANS UNATTESTED — never defaulted. CEE mints it; no model authors
   * it (`CEE_MINTED_GOAL_FIELDS`).
   */
  goal_threshold_cap_provenance: GoalThresholdCapProvenanceSchema.optional(),
  /**
   * The FRAME `goal_threshold` is stated in (ROADMAP 2.258, schemas 0.31.0).
   * Always `'level'` from CEE — see `CEE_GOAL_THRESHOLD_FRAME`.
   *
   * ⚠ THIS DECLARATION IS LOAD-BEARING, NOT DOCUMENTATION. `NodeV3` is a plain
   * `z.object` — "declared fields only — unknown fields stripped" (see the
   * closing comment on this object). An undeclared `goal_threshold_frame`
   * would be SILENTLY DELETED by `GraphV3.safeParse` on the run path
   * (build-turn-context.ts), so the stamp would reach nothing and the goal
   * probability would stay absent with no error anywhere. Derived from the
   * contract's own enum rather than restated as a local literal union.
   */
  goal_threshold_frame: GoalThresholdFrame.optional(),
  /**
   * ⛔ WHO STATED THE GOAL TARGET, AND THE TARGET THEY STATED (goal nodes; written by the UI's register).
   *
   * THIS DECLARATION IS LOAD-BEARING, the same warning `goal_threshold_frame` carries above. The UI keeps
   * `threshold_source: 'user'` + `success_threshold` as its durable per-goal source of truth. Undeclared,
   * both survived the register write (passthrough) and were then SILENTLY DELETED by the next unrelated
   * turn-path write's re-parse; served on `bed9a0c`, the user's stated target then read back as not stated.
   * `field-safety.ts` still denies every producer from SETTING `threshold_source` (ruling J2); this only
   * keeps what was written. A malformed value is dropped exactly as before (`.catch`), never a new reason
   * to refuse a stored graph.
   */
  threshold_source: z.string().max(64).optional().catch(undefined),
  success_threshold: z.number().finite().nullable().optional().catch(undefined),
  /**
   * ⭐⭐ THE PER-FACTOR SCALE FRAME (factor nodes only) — the divisor pass 3d
   * projected this factor's baseline and every option intervention magnitude
   * onto, so within-factor ratios are exact.
   *
   * ⚠ THIS DECLARATION IS LOAD-BEARING, NOT DOCUMENTATION — the same warning
   * `goal_threshold_frame` carries above, and it was measured here with a
   * positive control before this line was written. `NodeV3` is a plain
   * `z.object` (see the closing comment), so an undeclared `scale_frame` is
   * SILENTLY DELETED by `GraphV3.safeParse` and the edit seam would find
   * nothing, with no error anywhere.
   *
   * ⚠ AND IT IS THIS SCHEMA THAT STRIPS, NOT THE SHARED CONTRACT.
   * `@talchain/schemas`' own `NodeV3Schema` is `.passthrough()` and keeps
   * unknown keys; a fix applied there alone would change nothing. Two
   * same-named `NodeV3`s — name the twin before you fix one.
   *
   * WHY NOT `cap`: a stored cap flips `normaliseFactorValue` to the
   * cap-normalised, clamping branch (breaking the user-scale round-trip the
   * golden journey binds) and EXEMPTS the factor from the analysis seam's
   * baseline coherence gate. A frame is a normalisation reference, not a bound.
   *
   * NOT AI-EDITABLE, and deny-by-default already enforces it: the root is
   * absent from `aiEditableFieldRoots('node')` (17 roots, measured), so
   * `field-safety.ts` refuses any `update_node` op naming it — the same posture
   * its sibling `goal_threshold_frame` has. CEE mints it; no model authors it.
   *
   * ABSENCE MEANS NEVER FRAMED. Consumers MUST NOT default it — a defaulted
   * frame is a manufactured scale, the fabrication class this field exists to
   * kill.
   */
  scale_frame: z.number().positive().optional(),
  /** Encoding map for categorical factor labels (v191+). Maps encoded integer keys to display strings.
   * e.g. { "0": "Developers", "1": "Tech Lead" } for "Team Structure (0=Developers, 1=Tech Lead)".
   * Node-level field (not in observed_state) — describes label encoding, not observed state. */
  encoding_map: z.record(z.string(), z.string()).optional(),
  /**
   * COLLAB Track A — whether this node participates in the CALCULATION.
   *
   * `'retained_excluded'` — the node is kept in the model with its wording,
   * identity and authorship intact, is still visible to coaching, and is
   * DELIBERATELY EXCLUDED from the analysis. `'included'` is ordinary
   * participation.
   *
   * ⚠ THIS DECLARATION IS LOAD-BEARING, NOT DOCUMENTATION — the same warning
   * `scale_frame` carries above, and for the same measured reason: this
   * `NodeV3` is a plain `z.object` (see the closing comment at the end of the
   * object), so an undeclared root is SILENTLY DELETED by `GraphV3.safeParse`
   * with no error anywhere. `@talchain/schemas`' own `NodeV3Schema` is
   * `.passthrough()` and would have kept it — declaring it THERE alone changes
   * nothing here. Two same-named `NodeV3`s; this is the one that strips.
   *
   * ⛔ ABSENCE IS NOT A CLAIM, AND CONSUMERS MUST NOT INFER ONE.
   * Absent ⇒ treat as included FOR COMPUTATION ONLY: 182,015 existing nodes
   * carry no field and must not be dropped from anyone's analysis. But absence
   * and inclusion are therefore INDISTINGUISHABLE, so a surface MUST render an
   * exclusion claim ONLY on an explicit `'retained_excluded'` — never from
   * absence, never from a negation, and never from an unrecognised value.
   * An unknown value is NOT an exclusion claim: render nothing. A wrong
   * exclusion claim about a node CEE never stamped is worse than a missing one.
   * (Agreed with the Canvas lane, 18 Sep, as the binding display contract.)
   *
   * WHY AN ENUM AND NOT A BOOLEAN: the state is named, so a third state later
   * does not need a second flag. `waived_by_exclusion` became unable to answer
   * the adjacent question for exactly that reason.
   *
   * ⚠ NAME THE THREE APART — they share the English phrase and they are NOT
   * this field. Do not "reconcile" them; that reconciliation is what cost this
   * estate the leader-claim seam:
   *   · `GroundedUnresolved = 'none' | 'not_in_model' | 'could_not_check'`
   *     (UI `canvas/conversation/groundedSelection.ts`) — whether a selection
   *     the USER REFERENCED exists in the graph. Its own docblock insists
   *     `not_in_model` ("we read the graph and it isn't there") and
   *     `could_not_check` ("we couldn't read") must not collapse.
   *   · `in_model` as a COUNT in a quantities tally `{total, in_model,
   *     prose_only, absent}` (UI `adapters/cee/notModelled.ts`) — whether a
   *     number from the brief reached the model.
   *   · THIS field — whether a node that IS in the model participates in the
   *     CALCULATION. Neither of the others is about participation.
   *
   * PROMOTION IS A SINGLE FIELD FLIP on the existing node — never
   * create-and-delete. Paul's ruling requires promotion "without duplication or
   * loss", and any design that mints a second node fails it however clean it
   * looks.
   *
   * NOT AI-EDITABLE, and deny-by-default already enforces it: the root is
   * absent from `aiEditableFieldRoots('node')`, so `field-safety.ts` refuses any
   * `update_node` op naming it — the same posture as `scale_frame` and
   * `goal_threshold_frame`. CEE mints it; no model authors it.
   */
  analysis_participation: z.enum(['included', 'retained_excluded']).optional(),
  /** Prior distribution data for external factors (set by LLM or synthesised by unreachable-factors repair).
   *  ISL needs prior ranges to run Monte Carlo sampling on external factors. */
  prior: z.object({ distribution: z.string(), range_min: z.number(), range_max: z.number() }).passthrough().optional(),
  /** Factor type classification (e.g. "continuous", "categorical") — promoted to node level by repair stages */
  factor_type: z.string().optional(),
  /** Extraction type: "extracted" or "inferred" — promoted to node level by repair stages */
  extractionType: z.string().optional(),
  /** Uncertainty driver labels for controllable factors — promoted to node level by repair stages */
  uncertainty_drivers: z.array(z.string()).optional(),
  /** Prior mean / base rate for root nodes in ISL inference (v191+) */
  intercept: z.number().optional(),
  /** Human-readable value string for UI rendering (e.g. "£40,000", "18 months") */
  display_value: z.string().optional(),
  /** Intervention bundle copied from options[] for canvas display (option-kind nodes only).
   *  options[] remains the canonical source for analysis; graph nodes carry this for ConnRow rendering.
   *  Typed as z.any() per-value to avoid forward reference to InterventionV3; canonical shape lives on OptionV3. */
  interventions: z.record(z.string(), z.any()).optional(),
  /** Marks the status-quo / baseline option node (option-kind nodes only, v191+). */
  is_baseline: z.boolean().optional(),
  /** UI display vocabulary for the node's origin. Set by the V3 transform from
   *  `extractionType`: `explicit`/`observed` → `from_brief`,
   *  `inferred`/`range` → `ai_inferred`, absent/unknown → `ai_inferred`.
   *  RESPONSE-ONLY: recomputed deterministically by `transformResponseToV3`
   *  on every response. Not read by analysis, repair, or PLoT pipelines.
   *  Safe to ignore on round-tripped graphs — value is regenerated. */
  provenance: z.enum(["from_brief", "ai_inferred", "user_set"]).optional(),
  /** ⭐⭐ THE USER'S EXACT WORDS, for the inspector and the hover surface.
   *
   *  Present only on nodes projected from a stated record, carrying that
   *  record's `provenance.source_quote` verbatim. It exists because the goal
   *  node's LABEL is now an authored objective rather than the user's raw brief
   *  fragment (quality bar §8 A1), and that ruling is only honest if the exact
   *  language is still retrievable: A1 keeps the verbatim as PROVENANCE, shown
   *  in the inspector and on hover, NOT as a permanent second line under every
   *  node. Without a declared field here it would not survive — `NodeV3` strips
   *  undeclared keys, so the V1 node's structured provenance object (which does
   *  carry `source_quote`) is replaced by the bare `provenance` enum above and
   *  the user's own words never reached the wire. A label change without this
   *  field would delete them from the product, which is strictly worse than the
   *  defect it fixes.
   *
   *  RESPONSE-ONLY, like its two neighbours: recomputed from the source node on
   *  every response, never read by analysis, repair or PLoT. Additive and
   *  optional — `NodeV3` is not mirrored in `openapi.yaml` (verified: three
   *  distinctive NodeV3 field names return zero there while `provenance`
   *  returns 40), so this is not a published-contract change. */
  source_quote: z.string().optional(),
  /** TRUE when `label` is our authored display string rather than the user's
   *  verbatim words. Sibling of `source_quote`: together they let a surface say
   *  *"you said: …"* beside an authored objective. DERIVED at the producer from
   *  `label !== source_quote`, never hand-set. Absent means the label IS the
   *  user's own text — which is still the case for options, constraints,
   *  factors, and for the goals whose quote states a decision rather than an
   *  objective, where authoring is refused rather than guessed. */
  label_authored: z.boolean().optional(),
  /** ⭐⭐ TRUE when `label` is the GENERIC MINT we fall back to, not a name the
   *  user chose or that we derived from their brief.
   *
   *  ── TWO QUESTIONS, NAMED APART (trap 21). READ THIS BEFORE "FIXING" EITHER.
   *    Q1  "is this display string OURS rather than the user's?"  -> Q1 is what
   *        a surface needs to decide whether to show an empty/unnamed state.
   *    Q2  "did we DERIVE a meaningful label from the brief?"     -> Q2 is what
   *        the post-draft narrative needs to decide whether to hedge its claim
   *        about the model it built.
   *
   *  `label_authored` (above) encodes **Q2** while its own comment documents
   *  **Q1**. On every node but the decision placeholder the two answers
   *  coincide, which is why the divergence went unseen. THIS field answers Q1
   *  for that one node. ⚠ DO NOT "RECONCILE" THEM: `label_authored`'s Q2
   *  reading has a live consumer (`hasProvisionalDecision`,
   *  `post-draft-narrative.ts`), and gating on that flag alone already shipped
   *  a witnessed false claim in the opposite direction.
   *
   *  ── WHY A BOOLEAN AND NOT A STRING MATCH ──────────────────────────────────
   *  It exists so a consumer never has to compare `label` against a known
   *  placeholder word. Two services agreeing on a display string is a
   *  coincidence waiting to lapse — which is exactly what happened when the UI
   *  renamed this node's vocabulary and the server kept minting the old word.
   *
   *  RESPONSE-ONLY, like `provenance`, `source_quote` and `label_authored`:
   *  RE-DERIVED by `transformResponseToV3` on every response from the banked
   *  provenance AND the node's current label, so a user rename clears it by
   *  derivation rather than by a rename writer remembering to drop it.
   *
   *  ⚠ NARROW BY DESIGN. A BLANK label is NOT marked — `NodeV3` accepts `""`
   *  and `"   "` and no validator rejects them, but "unnamed" is a different
   *  question from "generic mint" and the surface's own unnamed handling owns
   *  it. Widening this to mean "not a real name" would put two questions back
   *  under one boolean.
   *
   *  Additive and optional, and `NodeV3` is not mirrored in `openapi.yaml`
   *  (re-derived: `label_authored`/`source_quote`/`is_baseline` return 0 hits
   *  there while `provenance` returns 41 and `label` 80), so this is not a
   *  published-contract change. A consumer on a stale pin simply drops it. */
  label_placeholder: z.boolean().optional(),
  /**
   * ⛔ C46 — THIS QUANTITY IS ITS FACTORS MULTIPLIED TOGETHER (goal / outcome / factor nodes).
   *
   * The analyse path is a linear SCM (`node = intercept + Σ parent × strength`, #70
   * 5841215337): it ADDS the factors' effects, so for a product such as MRR = price ×
   * subscribers it can get even the SIGN of an option's effect wrong (£49 → £59: −1,360 at
   * 100 subscribers, +640 at 300; the linear model says −960 at both). The ruling (#70
   * 5841314428) is that no leader may be named on it where the sign can flip.
   *
   * CEE-MINTED at construction (`agent-lane/admit-model.ts` `markProductIdentities`) from a
   * product the drafter DECLARED and admission checked structurally — never from a label.
   * It persists the DECLARATION, never a verdict: `run_analysis` re-runs the same sign test
   * on the graph it actually analysed (`nonlinearIdentityLeaderWithhold`), so an option added
   * after construction is judged too. `stated_in_brief` says whose reading it is (the
   * brief's, or Olumi's), so the sentence never presents Olumi's reading as the user's.
   *
   * ⚠ THIS DECLARATION IS LOAD-BEARING, NOT DOCUMENTATION — the warning `goal_threshold_frame`
   * carries. `NodeV3` is a plain `z.object`, so an undeclared `nonlinear_identity` is SILENTLY
   * DELETED by `GraphV3.safeParse` on the run path and the withhold reaches nothing.
   *
   * ABSENCE MEANS NO DECLARED PRODUCT — every graph persisted before this field, and every
   * linear brief, reads exactly as before. A malformed value is dropped (`.catch`), never a
   * new reason to refuse a stored graph. REMOVE-ONLY BY CONSTRUCTION: the only reader can
   * withhold a leader claim, never grant one.
   *
   * WHO CAN WRITE IT, stated precisely (the `goal_direction` precedent's wording):
   *  · an UPDATE cannot — the root is absent from `aiEditableFieldRoots('node')`, so
   *    `field-safety.ts` refuses any `update_node` op naming it;
   *  · the draft path does not — its field-by-field `transformNodeToV3` does not copy it;
   *  · ⚠ a model `add_node` COULD carry it (`CEE_ANALYSIS_OWNED_ROOTS` does not list it). Its
   *    worst case is an over-withheld leader, never a false one. Listing it there is a
   *    follow-up for the field-safety owner.
   *
   * NOT VALUE-BEARING: it names which nodes multiply, never a magnitude. Not mirrored in
   * `openapi.yaml`; a consumer on a stale pin simply drops it.
   */
  nonlinear_identity: z
    .object({
      operation: z.literal('product'),
      factor_ids: z.array(z.string().min(1)).min(2),
      stated_in_brief: z.boolean(),
    })
    .strict()
    .optional()
    .catch(undefined),
}); // CIL Phase 1: declared fields only — unknown fields stripped with warning
export type NodeV3T = z.infer<typeof NodeV3>;

// ============================================================================
// Edge Types
// ============================================================================

/**
 * Edge provenance in V3.
 */
export const EdgeProvenanceV3 = z.object({
  /** Source of the relationship */
  source: z.enum(["brief_extraction", "cee_hypothesis", "domain_knowledge", "user_specified"]),
  /** Optional reasoning */
  reasoning: z.string().optional(),
  /** Who sized the link (magnitude contract D9); `source: 'user_specified'` wins at read time. A malformed value is dropped. */
  magnitude: z.enum(["user_stated", "olumi_estimate", "olumi_placeholder"]).optional().catch(undefined),
  /**
   * The size the link carries in natural units (magnitude contract; #70 5845713522). `strength_mean` is the β it was
   * written for: a reader says it only while the edge's mean equals it (R&C 5845818897). A malformed value is dropped.
   */
  natural_effect: z.object({
    amount: z.number().finite(),
    amount_unit: z.string(),
    per_source_change: z.number().finite(),
    per_source_change_unit: z.string(),
    strength_mean: z.number().finite(),
    strength_mean_frame: z.literal("edge_strength"),
  }).optional().catch(undefined),
}).passthrough(); // CIL Phase 0: preserve additive fields
export type EdgeProvenanceV3T = z.infer<typeof EdgeProvenanceV3>;

/**
 * V3 edge strength — nested { mean, std } format (canonical Schema v2.2).
 */
export const EdgeStrengthV3 = z.object({
  /** Signed linear coefficient [-1, +1] */
  mean: z.number(),
  /** Parametric uncertainty, must be > 0 */
  std: z.number().positive(),
});
export type EdgeStrengthV3T = z.infer<typeof EdgeStrengthV3>;

/**
 * V3 edge schema with strength coefficients.
 * Canonical Schema v2.2: nested strength + exists_probability.
 */
export const EdgeV3 = z.object({
  /** Source node ID */
  from: z.string(),
  /** Target node ID */
  to: z.string(),
  /** Strength coefficient: { mean, std } (canonical nested format) */
  strength: EdgeStrengthV3,
  /** Existence probability [0, 1] */
  exists_probability: z.number().min(0).max(1),
  /** Effect direction (derived from strength.mean sign) */
  effect_direction: z.enum(["positive", "negative"]),
  /** Provenance */
  provenance: EdgeProvenanceV3.optional(),
  /** UI display vocabulary for the edge's origin. Set by the V3 transform
   *  from `provenance.source`: `brief_extraction` → `from_brief`,
   *  `user_specified` → `user_set`, otherwise `ai_inferred`. Sibling of the
   *  structured `provenance` enum so existing consumers of `provenance.source`
   *  are unaffected. RESPONSE-ONLY: recomputed deterministically by
   *  `transformResponseToV3` on every response. Not read by analysis, repair,
   *  or PLoT pipelines. Safe to ignore on round-tripped edges. */
  provenance_display: z.enum(["from_brief", "ai_inferred", "user_set"]).optional(),
  /** Edge creation source: ai, user, repair, enrichment, default */
  origin: z.string().optional(),
  /** Edge type: directed (default) or bidirected (unmeasured confounder). Phase 3A-trust. */
  edge_type: z.enum(["directed", "bidirected"]).optional(),
  /** Per-edge validation metadata from the two-pass parameter review pipeline.
   *  Absent when the pipeline is disabled, skipped, or failed gracefully.
   *  Full type definition: ValidationMetadata (src/cee/validation-pipeline/types.ts). */
  validation: z.any().optional(),
  /** CIL flag: true when default strength was applied (no LLM differentiation) */
  defaulted: z.boolean().optional(),
}); // CIL Phase 1: declared fields only — unknown fields stripped with warning
/** EdgeV3 with full ValidationMetadata typing (superset of Zod schema). */
export type EdgeV3T = z.infer<typeof EdgeV3> & {
  /** Per-edge validation metadata from the two-pass parameter review pipeline.
   *  Absent when the pipeline is disabled, skipped, or failed gracefully. */
  validation?: ValidationMetadata;
};

// ============================================================================
// Intervention Types
// ============================================================================

/**
 * How an intervention target was matched to a graph node.
 */
export const TargetMatch = z.object({
  /** The matched node ID */
  node_id: z.string(),
  /** How the match was determined */
  match_type: z.enum(["exact_id", "exact_label", "semantic"]),
  /** Confidence in the match */
  confidence: z.enum(["high", "medium", "low"]),
}).passthrough(); // CIL Phase 0: preserve additive fields
export type TargetMatchT = z.infer<typeof TargetMatch>;

/**
 * Value types supported for interventions.
 * - numeric: Standard quantitative value (e.g., price: 59)
 * - categorical: Named category (e.g., region: "UK")
 * - boolean: Toggle flag (e.g., feature_enabled: true)
 */
export const InterventionValueType = z.enum(["numeric", "categorical", "boolean"]);
export type InterventionValueTypeT = z.infer<typeof InterventionValueType>;

/**
 * Raw intervention value - supports numeric, categorical, or boolean.
 * Used in raw_interventions field for pre-encoding values.
 */
export const RawInterventionValue = z.union([
  z.number(),
  z.string(),
  z.boolean(),
]);
export type RawInterventionValueT = z.infer<typeof RawInterventionValue>;

/**
 * A single intervention on a factor.
 *
 * Supports the Raw+Encoded pattern:
 * - value: REQUIRED numeric value (for PLoT compatibility)
 * - raw_value: OPTIONAL original value before encoding (string/number/boolean)
 * - value_type: OPTIONAL type indicator for non-numeric interventions
 *
 * For numeric interventions: value = raw_value (or raw_value omitted)
 * For categorical: value = encoded integer, raw_value = "UK", value_type = "categorical"
 * For boolean: value = 0|1, raw_value = true|false, value_type = "boolean"
 */
export const InterventionV3 = z.object({
  /** Numeric value (MUST be numeric for PLoT compatibility) */
  value: z.number(),
  /** Unit (should match target factor's observed_state.unit) */
  unit: z.string().optional(),
  /** How this intervention was determined */
  source: z.enum(["brief_extraction", "cee_hypothesis", "user_specified"]),
  /** How the target was matched */
  target_match: TargetMatch,
  /** Confidence in the value itself */
  value_confidence: z.enum(["high", "medium", "low"]).optional(),
  /** Explanation for transparency */
  reasoning: z.string().optional(),
  // --- Raw+Encoded pattern fields (additive, optional) ---
  /** Original value before encoding (for categorical/boolean interventions) */
  raw_value: RawInterventionValue.optional(),
  /** Type of the intervention value */
  value_type: InterventionValueType.optional(),
  /** Encoding map for categorical values: raw_value -> encoded integer */
  encoding_map: z.record(z.string(), z.number()).optional(),
  /**
   * Presentation-only human-readable string for the intervention value.
   * Populated either by the LLM/draft prompt or deterministically by the
   * analysis-ready transformer via synthesiseDisplayValue(). Must NEVER
   * be read by inference, readiness, or flattening logic — those paths
   * read `value` (and optionally `raw_value`) only.
   */
  display_value: z.string().optional(),
}).passthrough(); // CIL Phase 0: preserve additive fields from LLM/enrichment
export type InterventionV3T = z.infer<typeof InterventionV3>;

/**
 * Option provenance.
 */
export const OptionProvenanceV3 = z.object({
  /** Source of the option */
  source: z.enum(["brief_extraction", "cee_hypothesis", "user_specified"]),
  /** The text this was extracted from (dev only) */
  brief_quote: z.string().optional(),
}).passthrough(); // CIL Phase 0: preserve additive fields
export type OptionProvenanceV3T = z.infer<typeof OptionProvenanceV3>;

/**
 * Option status values.
 * - ready: All interventions encoded, ready for analysis
 * - needs_user_mapping: Missing factor matches or values
 * - needs_encoding: Has raw values (categorical/boolean) awaiting numeric encoding
 */
export const OptionStatusV3 = z.enum(["ready", "needs_user_mapping", "needs_encoding"]);
export type OptionStatusV3T = z.infer<typeof OptionStatusV3>;

// Compile-time guard: needs_user_input is payload-level only, never option-level (CIL Step 12)
type _AssertNeedsUserInputNotV3OptionStatus =
  "needs_user_input" extends OptionStatusV3T ? never : true;
const _assertV3OptionStatusExcludesNeedsUserInput: _AssertNeedsUserInputNotV3OptionStatus = true;
void _assertV3OptionStatusExcludesNeedsUserInput;

/**
 * V3 option schema - decision paths with intervention bundles.
 *
 * Supports the Raw+Encoded pattern for categorical/boolean interventions:
 * - interventions: ALWAYS present, contains encoded numeric values
 * - raw_interventions: OPTIONAL, contains original values before encoding
 * - status: "needs_encoding" when raw values exist but aren't yet encoded
 */
export const OptionV3 = z.object({
  /** Option ID - canonical pattern: lowercase alphanumeric, underscores, colons, hyphens */
  id: z.string().regex(CANONICAL_ID_REGEX, "Option ID must contain only lowercase alphanumeric, underscores, colons, or hyphens"),
  /** Human-readable label */
  label: z.string(),
  /** Optional description */
  description: z.string().optional(),
  /** Option readiness status */
  status: OptionStatusV3,
  /** Intervention bundle: factor_id -> intervention (encoded numeric values) */
  interventions: z.record(z.string(), InterventionV3),
  // --- Raw+Encoded pattern: parallel raw values (additive field) ---
  /** Raw intervention values before encoding (for categorical/boolean) */
  raw_interventions: z.record(z.string(), RawInterventionValue).optional(),
  /** Concepts mentioned but not matched to factors */
  unresolved_targets: z.array(z.string()).optional(),
  /** Specific questions for the user */
  user_questions: z.array(z.string()).optional(),
  /** Provenance */
  provenance: OptionProvenanceV3.optional(),
  /** Marks the status-quo / baseline option (v191+). Exactly one option should be true.
   * Set by the LLM; preserved through extraction and assembly. PLoT handles deduplication. */
  is_baseline: z.boolean().optional(),
}).passthrough(); // CIL Phase 0: preserve additive fields from LLM/enrichment
export type OptionV3T = z.infer<typeof OptionV3>;

// ============================================================================
// Validation Warning Types
// ============================================================================

/**
 * Validation warning codes.
 * Includes CEE-specific intervention/structure codes plus CIL codes from @talchain/schemas.
 */
export const ValidationWarningCode = z.enum([
  "INTERVENTION_TARGET_DISCONNECTED",
  "INTERVENTION_TARGET_NOT_FOUND",
  "UNIT_MISMATCH_SUSPECTED",
  "MISSING_UNIT",
  "LOW_CONFIDENCE_MATCH",
  "EMPTY_INTERVENTIONS_READY",
  "GOAL_NODE_MISSING",
  "OPTION_NODE_IN_GRAPH",
  "DUPLICATE_NODE_ID",
  "INVALID_NODE_ID",
  // An AI-drafted option was absorbed into the user-authored option it restates.
  // Registered here for consistency with the other transform-stage codes
  // (`ValidationWarningV3.code` is the shared `z.string()`, so an unregistered
  // code was never at risk of being stripped — this is legibility, not a fix).
  "OPTION_REPHRASE_ABSORBED",
  // CIL warning codes from @talchain/schemas
  CIL_WARNING_CODES.STRENGTH_DEFAULT_APPLIED,
  CIL_WARNING_CODES.STRENGTH_MEAN_DEFAULT_DOMINANT,
  CIL_WARNING_CODES.EDGE_STRENGTH_LOW,
  CIL_WARNING_CODES.EDGE_STRENGTH_NEGLIGIBLE,
  // STRP constraint direction heuristic (Rule 3b)
  "CONSTRAINT_DIRECTION_HEURISTIC",
  // WS-A item 1(b) — the commit-time money invariant. A factor the extractor
  // stamped `brief_extraction`, denominated in a currency the brief uses,
  // whose encoding (`level × cap`) reproduces NO magnitude the brief states.
  // Disclosure only: the graph commits unchanged and no magnitude is ever
  // rewritten (see cee/provenance/money-invariant.ts for why that direction is
  // a ruling and not a preference). Additive at every hop — the shared
  // contract types `code` as `z.string()` with `.passthrough()`.
  "STATED_MAGNITUDE_UNRECONCILED",
  // Causal claims validation warning codes (Phase 2B)
  CAUSAL_CLAIMS_WARNING_CODES.MALFORMED,
  CAUSAL_CLAIMS_WARNING_CODES.DROPPED,
  CAUSAL_CLAIMS_WARNING_CODES.INVALID_REF,
  CAUSAL_CLAIMS_WARNING_CODES.TRUNCATED,
]);
export type ValidationWarningCodeT = z.infer<typeof ValidationWarningCode>;

/**
 * Validation warning.
 * Extends SharedValidationWarningSchema (code, message, severity, details)
 * with CEE-specific fields for affected entities and suggestions.
 */
export const ValidationWarningV3 = SharedValidationWarningSchema.extend({
  /** Affected option ID */
  affected_option_id: z.string().optional(),
  /** Affected node ID */
  affected_node_id: z.string().optional(),
  /** Affected edge ID in format "from_id→to_id" */
  affected_edge_id: z.string().optional(),
  /** Suggested fix */
  suggestion: z.string().optional(),
  /** Pipeline stage that detected this issue */
  stage: z.string().optional(),
}); // SharedValidationWarningSchema already uses .passthrough()
export type ValidationWarningV3T = z.infer<typeof ValidationWarningV3>;

// ============================================================================
// Graph Types
// ============================================================================

/**
 * V3 graph structure.
 * Includes option nodes for connectivity (decision→option→factor).
 */
export const GraphV3 = z.object({
  /** Graph nodes */
  nodes: z.array(NodeV3),
  /** Graph edges */
  edges: z.array(EdgeV3),
  /**
   * Goal constraints attached to the scenario. Optional top-level array
   * mirroring CEEGraphResponseV3.goal_constraints — keeps the in-memory
   * GraphV3T as the single canonical persistence surface for V5 D1
   * `add_constraint` mutations. PLoT already merges this field with
   * compiled constraint nodes when present.
   */
  goal_constraints: z.array(GoalConstraintSchema).optional(),
});
export type GraphV3T = z.infer<typeof GraphV3>;

/**
 * Graph metadata.
 */
export const GraphMetaV3 = z.object({
  /** Root node IDs */
  roots: z.array(z.string()).optional(),
  /** Leaf node IDs */
  leaves: z.array(z.string()).optional(),
  /** Graph source */
  source: z.enum(["assistant", "user", "imported"]).optional(),
}).passthrough(); // CIL Phase 0: preserve additive fields
export type GraphMetaV3T = z.infer<typeof GraphMetaV3>;

// ============================================================================
// Response Types
// ============================================================================

/**
 * Complete CEE V3 response schema.
 * Note: nodes and edges are at root level (not nested under graph).
 */
export const CEEGraphResponseV3 = z.object({
  /** Schema version marker */
  schema_version: z.literal("3.0"),
  /** Graph nodes at root level */
  nodes: z.array(NodeV3),
  /** Graph edges at root level */
  edges: z.array(EdgeV3),
  /** Decision paths with intervention bundles */
  options: z.array(OptionV3),
  /** Goal node ID - must reference a node with kind='goal' */
  goal_node_id: z.string(),
  /** Validation warnings */
  validation_warnings: z.array(ValidationWarningV3).optional(),
  /**
   * Goal constraints extracted from compound goals (Phase 3).
   * Populated when brief contains multiple quantitative targets.
   * PLoT merges these with compiled constraint nodes (explicit wins on conflict).
   */
  goal_constraints: z.array(GoalConstraintSchema).optional(),
  /** LLM coaching output. v0.11.0 schema amendment: Stage 6 V3 transform
   *  ALWAYS emits a coaching block (canonical-empty when V1 omits it),
   *  so production responses always carry the field. The Zod schema
   *  keeps `.optional()` so existing consumer tests that construct V3
   *  payloads without coaching still parse — the runtime contract
   *  ("V3 output carries coaching") is enforced by the transform, not
   *  by Zod rejection. The wire-facing `coaching` field on
   *  /assist/v1/draft-graph is narrowed to typed display shapes at the
   *  Stage 5 boundary by `narrowCoachingForResponse` in
   *  src/orchestrator/draft-coaching.ts. The wrapper is `.passthrough()`
   *  so additive future coaching fields reach downstream consumers. */
  coaching: z.object({
    // Nullable so that a coaching block with widening_log / bias_signals but
    // no LLM-produced summary still reaches the UI. The UI renders null as
    // "no summary" rather than dropping the entire panel.
    summary: z.string().nullable(),
    strengthen_items: z.array(z.object({
      id: z.string(),
      label: z.string(),
      detail: z.string(),
      action_type: z.string(),
      bias_category: z.string().optional(),
    })), // strict — matches DraftGraphResult.strengthenItems contract
    // v0.11.0 schema amendment: widening_log is the canonical OBJECT
    // shape. Inner sub-fields use permissive types here so V3 validation
    // accepts what narrowCoachingForResponse produces; the canonical
    // shape is enforced at @talchain/schemas/CoachingSchema for cross-
    // service consumers.
    widening_log: z.object({
      elements_added: z.array(z.string()),
      elements_considered_but_excluded: z.array(z.string()),
      brief_completeness: z.enum(["complete", "partial", "thin"]),
    }).passthrough().optional(),
    bias_signals: z.array(z.unknown()).optional(),
  }).passthrough().optional(),
  /** LLM causal claims — stated reasoning about direct effects, mediations, confounders.
   *  v0.11.0 schema amendment: Stage 6 V3 transform ALWAYS emits this
   *  field (defaulting absent V1 input to []), so production responses
   *  always carry it. Zod schema keeps `.optional()` so consumer tests
   *  constructing V3 payloads without it still parse — the runtime
   *  contract is enforced by the transform, not by Zod rejection. The
   *  Phase 2B provenance distinction (undefined vs [] meaning "LLM
   *  didn't emit" vs "emitted but dropped") is preserved internally on
   *  ctx.causalClaims for analytics. */
  causal_claims: CausalClaimsArraySchema.optional(),
  /** v0.11.0 schema amendment: topology_plan — string array describing
   *  graph layout. Required at the canonical contract; preserved
   *  V1 → V3 with deep-equality (length + order + string contents). */
  topology_plan: z.array(z.string()).optional(),
  /**
   * ⭐⭐ WHAT THE PROJECTOR REFUSED TO ASSERT, AND WHY — the R1 disclosure channel.
   *
   * The record projector deliberately declines to invent: it will not guess a
   * constraint's direction, it will not silently pick between two contradictory
   * intervention levels, and it will not pretend a stated target became a goal
   * threshold. Every one of those refusals was already recorded internally in
   * `projection.dropped[]` — and **`projection.dropped[]` had no reader anywhere
   * downstream**, so a user saw a graph quietly weaker than their brief with no
   * indication why. The projector's honesty had improved; the product's had not
   * moved at all. This field is the carrier that closes that.
   *
   * ⚠⚠ `node_id` IS OPTIONAL, AND THE FIRST CUT OF THIS FIELD GOT THAT WRONG IN
   * THE MOST EXPENSIVE WAY AVAILABLE. It required an anchor in `nodes[]` and
   * dropped anything it could not anchor. Measured on both real banked B3
   * captures: **the projector produced 56 disclosures, 1 reached the wire, and 55
   * were discarded with no log, no counter and no field.**
   *
   * The reason is structural, not a bug in the matching. The dominant class —
   * `unconnected_to_goal`, 51 of the 56 — describes a record that was
   * **WITHDRAWN FROM THE GRAPH**. Its label can never appear in `nodes[]`,
   * because not appearing in `nodes[]` is precisely what it is disclosing. So the
   * anchoring rule silently deleted the disclosures a user most needs — *"you
   * told me this and it is not in the model"* — and kept only the ones about
   * things they could already see. A channel delivering 2% of its own volume,
   * silently, is the guarantee-theatre class this estate exists to kill.
   *
   * ⭐ SO: `withdrawn` carries the fact the anchor cannot. `node_id` is the
   * projector's OWN minted id, present whenever it knew one — it is an identity,
   * not a promise that the node survived, and a consumer must check `withdrawn`
   * before looking it up in `nodes[]`. NOTHING IS DROPPED: see
   * `record_disclosures_omitted`.
   *
   * ⚠ THE TOP LEVEL OF THIS SCHEMA IS PLAIN `z.object` — undeclared fields are
   * STRIPPED, silently, with only a warn log. That is precisely why this must be
   * declared here and not left to ride a passthrough.
   */
  record_disclosures: z
    .array(
      z.object({
        /** The projector's own reason vocabulary — one string, not a sentence. */
        reason: z.string(),
        /** The user-facing label, which is the user's own words for stated items. */
        label: z.string(),
        /**
         * TRUE when the subject is NOT on the final graph — the "you gave me this
         * and it is not in the model" case. Read this BEFORE resolving `node_id`.
         */
        withdrawn: z.boolean(),
        /** The projector's minted id. Resolvable in `nodes[]` only when `withdrawn` is false. */
        node_id: z.string().optional(),
        /**
         * ⭐ THE MAGNITUDE THE USER STATED, when the withdrawn record carried one.
         *
         * Present on `unconnected_to_goal` disclosures about STATED records — the
         * class this channel exists for. Measured on the banked live emission: 12
         * of 12 stated magnitudes were destroyed by the withdrawal that produced
         * these very disclosures, so the notice reached the wire with the user's
         * words and without their number.
         *
         * ⚠ IT IS THE STATED MAGNITUDE, NEVER A NORMALISED LEVEL. £7.2m is
         * disclosed as `7200000`, not as the `0.72` the graph computes on. A
         * consumer may render it verbatim beside `label` (which is the user's own
         * quote) without rescaling anything.
         */
        value: z.number().optional(),
        /** The unit the user stated, alongside `value` (e.g. `"£"`, `"%"`). */
        unit: z.string().optional(),
      }),
    )
    .optional(),
  /**
   * ⭐ HOW MANY DISCLOSURES COULD NOT BE REPRESENTED AT ALL — normally absent.
   *
   * The rule this field enforces is "no silent drops, ever". If the transform
   * ever meets an entry it cannot express (a non-object, or a record with no
   * reason or no label), the count surfaces here rather than the entry
   * evaporating. A channel that quietly loses part of its payload is
   * indistinguishable from one that had nothing to say, and that is exactly how
   * 55 of 56 went missing.
   *
   * ⚠⚠ SCOPED TO ONE FUNCTION, AND THE DISTINCTION IS LOAD-BEARING.
   * `omitted: 0` means **"the transform expressed everything it was handed"**. It
   * does NOT mean "the user received everything", and it cannot: this counter is
   * blind to every hop downstream of `transformResponseToV3`. A measured example
   * is live today — the v5 turn payload rebuilds its graph block FIELD BY FIELD
   * (`orchestrator/tools/draft-graph.ts`, a closed `GraphPatchBlockData`
   * interface, no spread), so `record_disclosures` reaches the CEE V3 wire and
   * then **56 → 0** on that path, while this counter still reads zero and the
   * `emitted === produced` invariant upstream still passes.
   * ROADMAP 2.1094. Say "reaches the CEE V3 wire", never "reaches the user".
   */
  record_disclosures_omitted: z.number().optional(),
  /** Draft warnings from the pipeline — CEEStructuralWarningV1 shape from structure detection.
   *  Fields: id (warning type), severity, affected_node_ids, affected_edge_ids, explanation, fix_hint. */
  draft_warnings: z.array(z.object({
    id: z.string(),
    severity: z.string(),
    node_ids: z.array(z.string()).optional(),
    edge_ids: z.array(z.string()).optional(),
    affected_node_ids: z.array(z.string()).default([]),
    affected_edge_ids: z.array(z.string()).default([]),
    explanation: z.string().optional(),
    fix_hint: z.string().optional(),
  })).optional(),
  /** Pre-computed analysis-ready payload for PLoT (complex nested structure) */
  analysis_ready: z.any().optional(),
  /** Per-node LLM reasoning from Stage 1 (parse). Carried through V1→V3 boundary. */
  rationales: z.array(z.object({
    target: z.string(),
    why: z.string(),
    provenance_source: z.string().optional(),
  })).optional(),
  /** Graph metadata */
  meta: GraphMetaV3.optional(),
  /** Quality metrics (1–10 integer scale; see computeQuality / openapi.yaml CEEQualityMeta) */
  quality: z.object({
    overall: z.number().min(1).max(10),
    structure: z.number().min(1).max(10).optional(),
    coverage: z.number().min(1).max(10).optional(),
    structural_proxy: z.number().min(1).max(10).optional(),
    safety: z.number().min(1).max(10).optional(),
  }).optional(),
  /** Trace information */
  trace: z.object({
    request_id: z.string().optional(),
    correlation_id: z.string().optional(),
    engine: z.record(z.unknown()).optional(),
    /** Goal handling observability */
    goal_handling: z.object({
      goal_source: z.enum(["llm_generated", "retry_generated", "inferred", "placeholder"]),
      retry_attempted: z.boolean(),
      original_missing_kinds: z.array(z.string()).optional(),
      goal_node_id: z.string().optional(),
    }).optional(),
    /** Pipeline diagnostics (P0) */
    pipeline: z.record(z.unknown()).optional(),
  }).passthrough().optional(), // Keep passthrough: trace is internal/extensible
}); // CIL Phase 1: declared fields only — unknown fields stripped with warning
export type CEEGraphResponseV3T = z.infer<typeof CEEGraphResponseV3>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an option is ready for analysis.
 */
export function isOptionReady(option: OptionV3T): boolean {
  return (
    option.status === "ready" &&
    Object.keys(option.interventions).length > 0
  );
}

/**
 * Get all intervention target node IDs for an option.
 */
export function getInterventionTargets(option: OptionV3T): string[] {
  return Object.values(option.interventions).map((i) => i.target_match.node_id);
}

/**
 * Check if a node is a valid intervention target (must be a factor).
 */
export function isValidInterventionTarget(node: NodeV3T): boolean {
  return node.kind === "factor";
}

/**
 * What a magnitude says about causal direction. THREE classes, not two.
 *
 * ⚠ ZERO IS ITS OWN CLASS, AND COLLAPSING IT INTO "positive" IS THE DEFECT THIS
 * EXISTS TO NAME. The previous definition was `mean >= 0 ? "positive" :
 * "negative"`, which is total over `number` but has only two outputs, so a
 * magnitude that states NOTHING about direction was resolved to a POSITIVE
 * CAUSAL CLAIM. `EffectDirection` documents "positive" as "increasing source
 * increases target" (`schemas/graph.ts:459-462`) — false of a zero coefficient.
 *
 * `edgeSign()` (`orchestrator-v5/coaching/post-draft-narrative.ts:1340-1352`)
 * had already reached this conclusion and states it in its own words: "a mean
 * of exactly 0 yields `null` rather than a guess — at zero the sign cannot
 * recover direction, and `-0 >= 0` is `true`, so an unguarded test calls every
 * zero positive." That is the evidence `>= 0` was the wrong DEFINITION rather
 * than merely an inconsistency between copies — a guard derived from the old
 * rule could only ever have proved the copies agreed with it.
 *
 * (`orchestrator/context/graph-compact.ts` also never names a direction at
 * zero, but incidentally: an earlier `absMean < 0.1` sub-threshold skip makes
 * its `mean > 0 ? 'positive' : 'negative'` ternary unreachable there. It
 * corroborates; it is not a second independent witness.)
 *
 * ⚠ `-0` MUST classify as carrying no sign information. `-0 >= 0` and
 * `-0 > 0 === false` and `-0 < 0 === false`, so the ordering comparisons below
 * place it in this class correctly — but only because zero is the FALL-THROUGH
 * rather than a `>= 0` test. Do not "simplify" this to `mean >= 0`.
 */
export type MagnitudeSignClass = "positive" | "negative" | "no_sign_information";

export function classifyMagnitudeSign(strengthMean: number): MagnitudeSignClass {
  if (strengthMean > 0) return "positive";
  if (strengthMean < 0) return "negative";
  return "no_sign_information";
}

/** The outcome of resolving the two direction carriers against each other. */
export interface EffectDirectionResolution {
  /** The direction to put on the wire. */
  readonly direction: "positive" | "negative";
  /**
   * `true` when NEITHER carrier stated a direction and one had to be invented
   * to satisfy the two-member egress enum. The caller MUST disclose it — see
   * `transformEdgeToV3`, which records it in `transform_defaults` alongside
   * every other invented edge value.
   */
  readonly invented: boolean;
}

/**
 * Resolve causal direction from its two carriers.
 *
 * Direction is carried TWICE — as the `effect_direction` enum and as the SIGN
 * of `strength_mean` (`schemas/graph.ts:488`: "sign indicates direction"). This
 * is the single place that decides what the pair jointly states, so the two
 * cannot drift apart at the point of use.
 *
 * The two ordering rulings are UNCHANGED and are not reopened here:
 *   Q_A (`cee.edge-direction-derives-from-mean-sign.test.ts`) — a SIGNED
 *       magnitude is self-describing, so it wins and a stale label is corrected.
 *   Q_B (`cee.edge-polarity-direction-authority.test.ts`) — an UNSIGNED
 *       magnitude carries no polarity, so the label wins and the SIGN is moved
 *       onto the magnitude upstream (`transformEdgeToV3`), which is why by the
 *       time this runs the mean is already signed.
 *
 * What is NEW is the third class. Both rulings, STRP Rule 4
 * (`validators/structural-reconciliation.ts:901`, guarded `!== 0`) and
 * `fixSignMismatch` (via `graph-validator.ts:1405`, guarded `!== 0`) ABSTAIN at
 * a zero magnitude. Nothing reconciled it, and this function then filled the
 * silence with "positive". Now: at zero the magnitude states nothing, so a
 * STATED direction is preserved, and if nothing was stated the invention is
 * reported to the caller rather than made silently.
 */
export function resolveEffectDirection(
  strengthMean: number,
  statedDirection?: unknown
): EffectDirectionResolution {
  const cls = classifyMagnitudeSign(strengthMean);
  if (cls !== "no_sign_information") {
    return { direction: cls, invented: false };
  }
  if (statedDirection === "positive" || statedDirection === "negative") {
    return { direction: statedDirection, invented: false };
  }
  // Nothing stated a direction and the magnitude states none either. The egress
  // enum has no member for "unresolved" (see this file's EdgeV3
  // `effect_direction`), so a value must be chosen — but it is DISCLOSED.
  return { direction: "positive", invented: true };
}

/**
 * Derive effect_direction from strength_mean.
 *
 * Thin wrapper over `resolveEffectDirection` so there is ONE definition. Callers
 * that hold a stated direction should call `resolveEffectDirection` directly and
 * disclose an invented result; this single-argument form is retained for the
 * call sites that genuinely have only a magnitude, and is byte-identical to the
 * previous implementation for every magnitude that carries its own sign.
 */
export function deriveEffectDirection(
  strengthMean: number,
  statedDirection?: unknown
): "positive" | "negative" {
  return resolveEffectDirection(strengthMean, statedDirection).direction;
}

// ============================================================================
// CIL Phase 1: Unknown field detection for strip-mode schemas
// ============================================================================

/** Known keys for each egress schema (used by warnOnUnknownV3Fields). */
const NODE_V3_KEYS = new Set(Object.keys(NodeV3.shape));
const EDGE_V3_KEYS = new Set(Object.keys(EdgeV3.shape));
const RESPONSE_V3_KEYS = new Set(Object.keys(CEEGraphResponseV3.shape));

/**
 * Log a warning when an egress-facing V3 object contains fields that will be
 * silently stripped by Zod's default strip behaviour.  Call this BEFORE parse
 * so the caller can observe drift without production failures.
 *
 * @param input - Raw object before Zod parse
 * @param schemaName - Human-readable label for log context ("NodeV3" | "EdgeV3" | "CEEGraphResponseV3")
 * @param logFn - Logger callback (receives structured payload)
 */
export function warnOnUnknownV3Fields(
  input: Record<string, unknown>,
  schemaName: "NodeV3" | "EdgeV3" | "CEEGraphResponseV3",
  logFn: (payload: { event: string; schema: string; unknownKeys: string[]; nodeId?: string }) => void,
): void {
  const knownKeys = schemaName === "NodeV3" ? NODE_V3_KEYS
    : schemaName === "EdgeV3" ? EDGE_V3_KEYS
    : RESPONSE_V3_KEYS;

  const unknownKeys = Object.keys(input).filter((k) => !knownKeys.has(k));
  if (unknownKeys.length > 0) {
    logFn({
      event: "cee.v3_schema.unknown_fields_stripped",
      schema: schemaName,
      unknownKeys,
      ...(typeof input.id === "string" ? { nodeId: input.id } : {}),
    });
  }
}
