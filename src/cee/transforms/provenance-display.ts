/**
 * Provenance display mappers.
 *
 * Project the internal `extractionType` (nodes) and structured
 * `provenance.source` (edges) into the UI's display vocabulary
 * (`from_brief` / `ai_inferred` / `user_set`).
 *
 * UI-only. The structural `extractionType` and `provenance.source` fields stay
 * untouched on the V3 response — these mappers add a sibling display string
 * so existing consumers of the structured fields are unaffected (F.6: UI
 * displays, never computes).
 */
import type { KnownObservedStateSourceLiteral } from "@talchain/schemas";

export type ProvenanceDisplay = "from_brief" | "ai_inferred" | "user_set";

/**
 * Map a node's `extractionType` to UI display vocabulary.
 *
 * - `explicit` / `observed` → `from_brief` (extracted directly from the brief)
 * - `inferred` / `range`    → `ai_inferred` (model-inferred)
 * - any other / absent      → `ai_inferred` (safe default — anything we did
 *   not directly take from the brief is, by elimination, an AI estimate)
 */
export function nodeProvenanceDisplay(extractionType: unknown): ProvenanceDisplay {
  if (typeof extractionType !== "string") return "ai_inferred";
  if (extractionType === "explicit" || extractionType === "observed") return "from_brief";
  if (extractionType === "inferred" || extractionType === "range") return "ai_inferred";
  return "ai_inferred";
}

/**
 * Map an edge's structured `provenance.source` enum to UI display vocabulary.
 *
 * - `brief_extraction` → `from_brief`
 * - `user_specified`   → `user_set`
 * - `cee_hypothesis` / `domain_knowledge` / absent / unknown → `ai_inferred`
 */
export function edgeProvenanceDisplay(source: unknown): ProvenanceDisplay {
  if (source === "brief_extraction") return "from_brief";
  if (source === "user_specified") return "user_set";
  return "ai_inferred";
}

// ============================================================================
// ⭐ WHOSE NUMBER IS THIS? — projected from `observed_state.source`
// ============================================================================

/**
 * The legacy three-member node-source vocabulary. Declared here, beside the
 * display vocabulary it travels with, so the two projections of one stamp come
 * out of ONE table and cannot drift. `CompactNodeSource`
 * (`orchestrator/context/graph-compact.ts`) is an alias of this.
 */
export type ValueSourceDisplay = "user" | "assumption" | "system";

/** Both projections of one authorship stamp, emitted together. */
export interface ValueAuthorshipDisplay {
  /** Legacy `CompactNodeSource` vocabulary (context-pack-assembler, telemetry). */
  readonly source: ValueSourceDisplay;
  /** Display vocabulary (UI / coaching / LLM context). */
  readonly provenance: ProvenanceDisplay;
}

/**
 * ⭐ THE THIRD QUESTION OVER `observed_state.source`, NAMED APART FROM ITS TWO
 * SIBLINGS ON PURPOSE (CLAUDE.md trap 21).
 *
 * The estate already runs two exhaustive authorities over this vocabulary, and
 * a fix that folded this into either of them would be reconciling two
 * authorities that answer different questions:
 *
 *   `graph-readiness/obligation-provenance.ts`   → *may this gap be DEMANDED of
 *                                                  the user?*  (INV-P6)
 *   `decision-review/value-source-extraction-type.ts`
 *                                                → *how widely may the sampler
 *                                                   DRAW this number?*
 *   THIS FILE                                    → *whose number is this, as we
 *                                                   PRESENT it?*
 *
 * The third is not derivable from the other two, and the proof is one row:
 * `brief_extraction` and `user_override` are BOTH `user_stated` for the
 * obligation rule and BOTH `explicit` for the sampling rule, while here they
 * must stay APART — `from_brief` ("we read this in your brief") and `user_set`
 * ("you typed this") are different statements to make to a user, and collapsing
 * them is how a product tells someone it extracted a number they actually
 * corrected by hand.
 *
 * ── WHY THIS READS `source` AND NOT `extractionType` ──────────────────────
 *
 * `extractionType` has four members — `explicit | inferred | range | observed`
 * — and every one of them describes HOW THE EXTRACTION PIPELINE READ THE BRIEF.
 * There is no member meaning "the user typed this", so a user edit cannot be
 * expressed in that vocabulary at all: no writer in the estate updates it on a
 * user edit, and none could. Reading authorship off it therefore reports the
 * DRAFTING pipeline's account of a value that has since been overwritten.
 *
 * `observed_state.source` is the field the shared contract owns the vocabulary
 * for, the field every user-edit writer stamps (`USER_EDIT_SOURCE`), and the
 * one `orchestrator-v5/build-turn-context.ts` already names authoritative while
 * refusing the response-only `NodeV3.provenance`. The contract instructs
 * consumers to derive from it in as many words:
 *
 *   > Consumers should DERIVE their classifier/validator membership from this
 *   > list … while keeping their behaviour on UNKNOWN literals honest-neutral.
 *
 * ── ⚠⚠ WHY THIS DOES *NOT* SIMPLY OVERRIDE `extractionType` ────────────────
 *
 * The obvious implementation — "`source` is authoritative, so let it win" —
 * ships a regression, and the estate has already measured the defect it would
 * reopen. `source` is NOT independent evidence for its whole vocabulary:
 *
 *   `transforms/schema-v3.ts:361-362` SYNTHESISES it from `extractionType` for
 *   every drafted factor —
 *       `extractionType === 'inferred' ? 'cee_inference' : 'brief_extraction'`
 *   — coarsening four members into two. (It assigns through a VARIABLE, so a
 *   literal grep for `source: "cee_inference"` finds ZERO writers in this repo
 *   while the writer runs on every draft.)
 *
 * So for those two literals `source` is a LOSSY COPY of the field beside it,
 * and preferring the copy loses the `observed` / `range` distinctions the
 * original still carries. Worse, the copy goes STALE: the ROADMAP 2.972
 * withdrawal in `schema-v3.ts` rewrites `provenance` AND `extractionType` when
 * a node has not earned its brief claim, and does NOT rewrite
 * `observed_state.source`. A reader preferring `source` would therefore
 * resurrect exactly the claim that withdrawal exists to retract — through the
 * one field the withdrawal does not reach.
 *
 * That is not hypothetical. Measured on deployed build `41156fc` (14 Aug,
 * recorded at `repair/deterministic-sweep.ts:449-465`): a repair's own guess
 * shipped as `{value: 0, source: 'brief_extraction', extractionType:
 * 'observed'}` — *"the product claiming it had OBSERVED, FROM THE USER'S BRIEF,
 * a burnout of zero"*.
 *
 * ── THE RULE, THEREFORE ────────────────────────────────────────────────────
 *
 * `source` governs ONLY where it says something `extractionType` structurally
 * cannot. A literal that IS an `extractionType` member, or is synthesised from
 * one, defers (`null`) and the caller's existing `extractionType` mapping runs
 * byte-unchanged. The user-authorship literals have no `extractionType`
 * expression at all, so for them `source` is the only evidence there is.
 *
 * The blast radius is exactly that: the ONLY nodes whose projection moves are
 * those carrying an authorship stamp the old code could not have read.
 *
 * ── ⚠ AND WHAT "DEFERS" ACTUALLY MEANS, STATED PRECISELY ──────────────────
 *
 * The rule as implemented is PER-LITERAL. It is NOT conditional on
 * `extractionType` being present — the table decides from `source` alone, and
 * `null` hands the decision back to the caller whether or not the caller has
 * anything to decide with. Where the caller has nothing, its own default arm
 * runs: `system` / `ai_inferred`.
 *
 * That is reachable, and it is worth naming because it is the OPPOSITE harm in
 * miniature. Goal baselines minted at `schema-v3.ts:351-358` and by
 * `add-constraint.ts:909/939` carry `source: 'brief_extraction'` with NO
 * `extractionType`, and factors take the same shape whenever `extractionType`
 * is absent (`schema-v3.ts` writes that field only when defined). Such a value
 * defers to a field that says nothing and falls through to `ai_inferred` — so
 * a brief-stated goal is classified as the model's own guess.
 *
 * ⚠ IT IS DELIBERATELY NOT FIXED HERE, and the reason is not squeamishness.
 * Letting `brief_extraction` govern when `extractionType` is absent is exactly
 * the "let `source` win" move the whole section above refutes: the 2.972
 * withdrawal rewrites `extractionType` and leaves `source` standing, so
 * "`source` governs when `extractionType` is missing" would resurrect
 * retracted brief claims through the one field the withdrawal cannot reach.
 * Widening this predicate needs the withdrawal to reach `source` first, which
 * is a different lane's change.
 *
 * The misclassification is PRE-EXISTING, errs conservatively (it under-claims
 * on the user's behalf rather than over-claiming), and is contained: the
 * display-safe node projection in `orchestrator-v5/format/format-graph-for-
 * context.ts` carries ONLY `user_set` to the model precisely so this default
 * is not broadcast as a finding.
 *
 * ── DERIVED, NOT MIRRORED (CLAUDE.md trap 12) ─────────────────────────────
 *
 * Keyed `Record<KnownObservedStateSourceLiteral, …>`, exactly as both siblings
 * are, so the re-vendor that mints a thirteenth literal FAILS TYPECHECK here
 * rather than dropping it into a default arm that reads green. `null` is a
 * DECISION recorded per literal, not an absence — every member is listed.
 */
const SOURCE_AUTHORSHIP: Readonly<
  Record<KnownObservedStateSourceLiteral, ValueAuthorshipDisplay | null>
> = {
  // ── DEFER: synthesised from `extractionType`, so the original is richer ──
  // `schema-v3.ts:361-362` writes these two from `extractionType` itself.
  // Preferring them would coarsen `observed`/`range` away and would outlive
  // the 2.972 withdrawal, which rewrites `extractionType` and leaves these
  // standing. The caller's `extractionType` mapping is the finer instrument
  // AND the one the withdrawal keeps honest.
  brief_extraction: null,
  cee_inference: null,

  // ── DEFER: these ARE `extractionType` members, stamped into `source` ─────
  // The contract notes producers spell extraction types into this field too.
  // A restatement of the neighbouring field is not independent evidence, and
  // deferring keeps one authority for the brief-vs-inferred axis rather than
  // two that can disagree.
  explicit: null,
  inferred: null,

  // ── INDEPENDENT: the deterministic repair authored this value ────────────
  // `extractionType` has four members and no "repaired" class, so it cannot
  // express this. A repair's own number badged as the user's brief is the
  // measured 14 Aug defect above, in the other direction.
  cee_repair: { source: "assumption", provenance: "ai_inferred" },

  // ── The user, speaking directly. THE ARM THIS CHANGE EXISTS FOR ──────────
  // Contract provenance, verbatim:
  //   user             — Model-tab factor-value edits
  //   user_override    — typed value (UI edit surfaces AND CEE
  //                      set_factor_value / chat edits)
  //   user_confirmed   — "confirm as is"
  //   user_edited      — OutputsDock transition bridge
  //   user_calibration — inspector calibration
  user: { source: "user", provenance: "user_set" },

  // ⚠⚠ `user_override` GOVERNS ON A STAMP THIS REPO DOCUMENTS AS NOT A
  // SINGLE-MEANING RECEIPT. Read `FORGEABLE_USER_AUTHORSHIP_LITERALS` below
  // before changing this row — the gap is accepted here, deliberately, and the
  // reasoning is not obvious from this line.
  //
  //   `orchestrator/canonicalise-value-ops.ts` `stampUserEditProvenance`
  //   stamps `USER_EDIT_SOURCE` onto EVERY value-writing `update_node` op that
  //   reaches either edit seam — its own comment: *"An explicit LLM-claimed
  //   producer source on a value write is OVERRIDDEN."*
  //
  //   `orchestrator-v5/routing/mutation-consent.ts` records that `edit_graph`
  //   is *"genuinely UNCOVERED by withheld-consent enforcement"*, with
  //   `update_node` ops applying *"regardless of what the user's message asked
  //   for"* (gap ROADMAP 2.628a).
  //
  //   `cee/context-integrity/not-modelled-manifest.ts` states the consequence
  //   outright — *"`user_override` IS NOT A SINGLE-MEANING RECEIPT"* — one
  //   literal serving (a) a genuine user edit and (b) a MODEL-AUTHORED
  //   `update_node` op.
  //
  // So the header above is right about the VOCABULARY (`extractionType` cannot
  // express user authorship) and, for class (b), wrong about the STAMP.
  user_override: { source: "user", provenance: "user_set" },
  user_confirmed: { source: "user", provenance: "user_set" },
  user_edited: { source: "user", provenance: "user_set" },
  user_calibration: { source: "user", provenance: "user_set" },

  // ⚠ `user_assumption` ("mark as assumption") is `user_set` HERE and
  // `inferred` for the SAMPLING-WIDTH authority, and the divergence is
  // deliberate rather than an oversight. A declared guess should be sampled as
  // widely as a model's guess — that is a claim about PRECISION. It is still
  // the user's guess, not ours — that is a claim about AUTHORSHIP, and calling
  // it `ai_inferred` would tell the user we invented a number they marked up
  // themselves. Same literal, two questions, two answers.
  user_assumption: { source: "user", provenance: "user_set" },

  // ⚠ LOSSY, AND THE LOSS IS NAMED. `panel_elicited` is a named colleague's
  // answer, verified server-side by `collab/apply-verification.ts` before the
  // stamp is written. This vocabulary has three members and none of them means
  // "a colleague, not you", so the distinction is carried by `elicited_from`,
  // which is the field 0.40.0 minted for it and the field a surface needing the
  // identity must read.
  //
  // What is NOT in doubt is the direction: the most strongly attested
  // human-supplied number in the system must not be projected as the model's
  // own guess. `ai_inferred` would be a straightforward lie about the one value
  // we can prove a person gave us.
  panel_elicited: { source: "user", provenance: "user_set" },
};

/**
 * ⚠⚠ THE KNOWN GAP, PINNED AS AN EXPLICIT SET RATHER THAN LEFT AS PROSE.
 *
 * These are the literals whose `user_set` verdict above rests on a stamp that
 * CANNOT distinguish a genuine user edit from a model-authored `update_node`
 * op. For those writes this module tells the model *"the user supplied this
 * number"* about a value the user never supplied — the exact untruth the
 * surrounding change exists to remove, arriving through the stamp rather than
 * through the vocabulary.
 *
 * ── WHY THE GAP IS ACCEPTED RATHER THAN CLOSED HERE ───────────────────────
 * Because the alternative is worse, and measurably so. Making `user_override`
 * DEFER would restore the original defect for the COMMON case — the user
 * genuinely typing a number, which is what every edit seam is for — in
 * exchange for closing a rarer one. The honest fix is a SEPARABLE STAMP for
 * model-authored edit ops, which belongs to the lane that owns
 * `stampUserEditProvenance`, not to a display projection. That is the same
 * call `not-modelled-manifest.ts` made on the same gap, for the same reason,
 * and it is recorded there as a re-surface trigger rather than as a fix.
 *
 * ── WHY IT IS A SET AND NOT A SENTENCE ────────────────────────────────────
 * CLAUDE.md's honest-gap rule: a gap recorded in the SUITE is honest; a gap
 * visible only in prose is how the next session ships past it. Every test in
 * `graph-compact-user-authorship.test.ts` sits on the SAFE side of this
 * predicate, so nothing would go red if class (b) grew — this set plus its
 * spec is what makes growth observable. The spec asserts this set EXACTLY
 * (`toEqual`), so it REDs if a literal is added AND if one is removed, and it
 * anchors membership to `USER_EDIT_SOURCE` at the stamper itself so the named
 * re-surface trigger (*"`stampUserEditProvenance` gains a distinct stamp for
 * model-authored ops"*) fires here automatically rather than by memory.
 *
 * ── WHAT IS DELIBERATELY *NOT* IN THIS SET ────────────────────────────────
 * `panel_elicited` is server-VERIFIED against the collab store by
 * `collab/apply-verification.ts` before it is stamped, so it is the one
 * human-authorship literal with an independent receipt. The remaining user
 * literals are written by surfaces that are not this stamper. Listing them
 * would make the set unfalsifiable-by-breadth — a gap set that names every
 * literal records nothing.
 */
export const FORGEABLE_USER_AUTHORSHIP_LITERALS: ReadonlySet<KnownObservedStateSourceLiteral> =
  new Set<KnownObservedStateSourceLiteral>(["user_override"]);

/**
 * Project one `observed_state.source` stamp, or `undefined` when this stamp is
 * not the authority for the question — because it is absent, outside the
 * declared vocabulary, or a restatement of `extractionType` (see the table).
 *
 * ⚠ THE THREE CASES COLLAPSE TO ONE ANSWER ON PURPOSE. All three mean *"do not
 * decide authorship from this field"*, and the caller's existing behaviour is
 * the correct response to each. Absence in particular is the contract's own
 * instruction rather than a convenience — from `ObservedStateSchema.source`:
 *
 *   > Absence means the producer stamped no provenance — a consumer MUST NOT
 *   > read absence as any particular class; classify unknown/absent as neutral,
 *   > never guess.
 *
 * The wire field is `z.string()` by deliberate contract design, so this takes
 * `unknown` and never assumes a parse.
 */
export function valueSourceAuthorship(source: unknown): ValueAuthorshipDisplay | undefined {
  if (typeof source !== "string") return undefined;
  if (Object.prototype.hasOwnProperty.call(SOURCE_AUTHORSHIP, source)) {
    return SOURCE_AUTHORSHIP[source as KnownObservedStateSourceLiteral] ?? undefined;
  }
  return undefined;
}

/**
 * The table as data, exported so a test can assert it against the contract's
 * own literal list and against the two sibling authorities. Not for product
 * use — call {@link valueSourceAuthorship}.
 */
export const SOURCE_AUTHORSHIP_TABLE: Readonly<
  Record<KnownObservedStateSourceLiteral, ValueAuthorshipDisplay | null>
> = SOURCE_AUTHORSHIP;
