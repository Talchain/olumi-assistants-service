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
