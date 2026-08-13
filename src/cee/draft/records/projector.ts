/**
 * THE DETERMINISTIC PROJECTOR — record set → GraphV3.
 *
 * A PURE function `(DraftStatedItem[], DraftInferenceClaim[]) → GraphV3` with
 * canonical serialisation and stable ids. Its output enters the pipeline exactly
 * where the model's graph output entered before, at the adapter's post-LLM seam,
 * so every existing consumer — normalisation, repair, validation, persistence,
 * analysis, UI — is byte-for-byte unchanged and no published contract moves.
 *
 * ── DETERMINISM IS THE DESIGN'S ENTIRE PREMISE ─────────────────────────────
 * Nothing in this module may read a clock, a random source, a UUID generator, an
 * environment variable, or any module-level mutable state. Identity is a pure
 * function of the record set's CONTENT and ORDER. The property battery
 * (`__tests__/projector-determinism.property.test.ts`) is the instrument; this
 * comment is not the guarantee. Measured 15/15 — 100 property fixtures × 2 runs
 * plus 3 real record sets × 10 runs, with an injected-non-determinism control
 * that REDs.
 *
 * ── ⭐ WHY THIS CANNOT COMMIT FALSE AUTHORSHIP, STRUCTURALLY ───────────────
 * Anything built from a `stated_item` carries STATED provenance with the user's
 * own quote; anything built from a `claim` carries AI-INFERRED provenance. The
 * mechanism that makes that true — rather than merely asserted — is that there
 * is exactly ONE construction site per provenance class, each takes its badge
 * from the ARRAY IT ITERATES rather than from any field the model controls, and
 * THE MODEL HAS NO FIELD THROUGH WHICH TO EXPRESS A PROVENANCE CLAIM AT ALL:
 * `grammar.ts` carries no provenance property. A badge is therefore a function
 * of WHICH LOOP built the element, and the model cannot reach it.
 *
 * ── ⚠ AND THE THIRD CLASS, WHICH IS NEITHER ────────────────────────────────
 * A record set is not a graph: options need a decision to hang from. The
 * projector therefore synthesises a decision node and decision→option edges when
 * options exist. Those are NEITHER stated NOR AI-inferred — they are the
 * projector's own topology. Badging them either way WOULD be false authorship
 * committed by the projector itself. They carry a distinct
 * `projector_structural` class. ANY CONSUMER OR CLASSIFIER MUST TREAT THAT AS A
 * THIRD VALUE and not collapse it into either bucket; a two-class reader scores
 * these as a defect, or — worse — silently as stated.
 *
 * ── ⭐ NODE-LEVEL PROVENANCE HONESTY (the `extractionType` seam) ────────────
 * Node provenance is NOT carried by the `provenance` object below — that object
 * is read by the edge path only. The user-facing NODE badge is derived by
 * `nodeProvenanceDisplay(extractionType)` (`cee/transforms/provenance-display.ts`)
 * from `observed_state.extractionType ?? node.extractionType ?? data.extractionType`,
 * and a `from_brief` claim is then independently RE-EARNED by `mayClaimFromBrief`
 * (`cee/provenance/factor-value-provenance.ts`, ROADMAP 2.972: a value-free node
 * cannot have come from the brief). Derived at those bytes, not inferred from the
 * edge path.
 *
 * The projector therefore sets `extractionType: "explicit"` on EXACTLY ONE class
 * — a `figure` the user stated WITH a number — and sets nothing anywhere else,
 * so everything the model or the projector added falls to the safe `ai_inferred`
 * default. That is the narrowest honest statement available: the value on such a
 * node is the user's own, verbatim from their located quote, and the existing
 * 2.972 gate re-checks the claim independently, so this cannot manufacture a
 * `from_brief` badge for a node that has not earned one.
 */

import { createHash } from "node:crypto";
// ⭐ DERIVED, NEVER MIRRORED. The bound the projector honours is the validator's own
// constant, imported. A hand-copied `6` here would be a second authority for one
// number and would drift silently the day CEE retunes it (trap 12, the estate's
// dominant defect class).
import { MAX_OPTIONS as MAX_PROJECTED_OPTIONS } from "../../../validators/graph-validator.types.js";
// ⭐ THE CONSUMER'S OWN PREDICATE, IMPORTED. `OPTIONS_IDENTICAL` fires when two
// options share this string (`graph-validator.ts:841-862`), and the function is
// EXPORTED for exactly this reuse. A local copy would drift from the rule it
// claims to pre-empt, and this file's own history says the drift reads as green.
import { buildInterventionSignature } from "../../../validators/graph-validator.js";
// ⭐ THE SINGLE BRIEF-BINDING AUTHORITY. Shared with the V3 response transform so
// that a node's badge and an option's badge cannot disagree about one fact — they
// contradicted each other on the wire before this (trap 12, two mirrors).
import {
  bindStatedItemToBrief,
  bindingEarnsBriefClaim,
  type BriefBinding,
} from "../../provenance/brief-binding.js";
import type {
  DraftInferenceClaim,
  DraftRecordSet,
  DraftStatedItem,
} from "./grammar.js";

// ── Provenance ──────────────────────────────────────────────────────────────

export type RecordProvenanceClass = "stated" | "ai_inferred" | "projector_structural";

/**
 * ⭐ THE TWO FIELDS THE CONSUMER REQUIRES, AND WHY THESE VALUES.
 *
 * The first build of this projector had every edge-bearing draft rejected at the
 * validator: `edges.N.provenance.source: Required` / `.quote: Required`. The
 * projector was correct against its OWN types and wrong against the consumer's
 * (trap 13d: write invariants against the consumer's actual predicate). The
 * consumer, derived at the bytes and RE-DERIVED at this tip:
 *
 *   `LLMEdge.provenance = StructuredProvenance.optional()`  (shared-schemas.ts:118)
 *   `StructuredProvenance = z.object({ source: z.string().min(1),
 *                                      quote:  z.string().max(100),
 *                                      location: z.string().optional() }).passthrough()`
 *                                                            (schemas/graph.ts:344)
 *
 * NOTE `LLMEdge` takes the OBJECT only — the `z.union([StructuredProvenance,
 * z.string()])` legacy-string branch exists on `EdgeInput` (graph.ts:409) and NOT
 * here, so "emit a plain string" is not available at the validator that failed.
 * `.passthrough()` is what lets `provenance_class` / `basis` / `unbased` ride
 * alongside, so the projector's own vocabulary is not lost to satisfy the schema.
 *
 * ── THE ATTRIBUTION RULE (orchestrator ruling, 2026-08-11; binding) ─────────
 * Inferred structure is HONESTLY AI-ATTRIBUTED. A user source or quote is NEVER
 * fabricated for an edge the model inferred or the projector scaffolded. Note
 * what that forecloses: `quote: <the stated item's source_quote>` would satisfy
 * the schema on the CRM control brief and fail on the fidelity briefs (whose
 * sentences exceed `max(100)`) — and where it passed it would be a LIE, telling
 * the user their own words justified a link they never drew.
 *
 * ── WHY THESE PARTICULAR STRINGS (derived, not chosen) ─────────────────────
 * `source` is free text (`z.string().min(1)`), so the value is a semantic
 * decision and is taken from the PRODUCER's declared semantics rather than from
 * this lane's reading of what the field ought to mean (trap 13c):
 *   · `"hypothesis"` — named in `StructuredProvenance`'s own comment ("File name,
 *     metric name, or 'hypothesis'"), a member of `ProvenanceSource`
 *     (graph.ts:29), and what CEE's enricher already stamps on machine-asserted
 *     edges (`factor-extraction/enricher.ts:452,1140`).
 *   · `"synthetic"` — what CEE already stamps on machine-scaffolded connectivity
 *     (`unified-pipeline/utils/edge-format.ts:138` `neutralCausalEdge`;
 *     `repair/deterministic-sweep.ts:996,1003,1308`), with a `quote` that
 *     describes the MACHINE ACTION ("Repair edge (structural connectivity)") —
 *     the precedent these two quotes follow.
 *
 * ── THE CONSUMER-SIDE CHECK THAT MADE THIS A DERIVATION AND NOT A TASTE CALL ─
 * `mapToV3ProvenanceSource` (`cee/transforms/schema-v3.ts:728`) is a LOWERCASED
 * SUBSTRING matcher over `source`, and it routes to the user-facing badge:
 * anything containing "brief", "document" or "evidence" becomes
 * `brief_extraction` → wire `provenance_display: "from_brief"`; "user",
 * "specified" or "manual" becomes `user_specified` → `"user_set"`. So the
 * well-meaning `source: "inferred from the brief"` would make the product tell
 * the user their brief stated a link the model invented — false authorship
 * committed by a string. `"hypothesis"` routes EXPLICITLY to `cee_hypothesis`;
 * `"synthetic"` falls to the same default every CEE structural edge takes. Both
 * display `ai_inferred`, which is the honest badge for both classes, and the
 * quotes are worded to contain none of that matcher's routing keywords either.
 */
const EDGE_ATTRIBUTION = {
  ai_inferred: {
    source: "hypothesis",
    quote: "Model-inferred causal link (records projector)",
  },
  projector_structural: {
    source: "synthetic",
    quote: "Decision-to-option scaffold minted by the projector",
  },
} as const;

export interface RecordProvenance {
  readonly provenance_class: RecordProvenanceClass;
  /**
   * REQUIRED by `StructuredProvenance` on any object that reaches an edge.
   * Present on edge provenance; absent on node provenance, which no consumer
   * validates (`LLMNode` and `Node` are `.passthrough()` with no `provenance`
   * key — which is exactly why the live failure named edges only).
   */
  readonly source?: string;
  /** REQUIRED by `StructuredProvenance` (max 100). NEVER user text — see above. */
  readonly quote?: string;
  /** Present iff `stated`. The verbatim quote, canonicalised. */
  readonly source_quote?: string;
  /** Present iff `ai_inferred`. Minted ids of the stated items it builds on. */
  readonly basis?: readonly string[];
  /**
   * Present iff `ai_inferred`. TRUE when `basis` is empty — pure invention,
   * and marked so. Explicit rather than inferable from an empty array,
   * because "no basis supplied" and "basis supplied but empty" must not be
   * distinguishable to a downstream reader that only checks `.length`.
   */
  readonly unbased?: boolean;
  /**
   * Labels of `option_refinement` claims merged into this STATED option (see the
   * merge note in pass 1b). APPEND-ONLY and additive: the node's
   * `provenance_class` and `source_quote` are never rewritten, so the user's own
   * words remain the only thing badged `stated`. This records what the model
   * contributed to an alternative WITHOUT attributing the model's wording to the
   * user — the distinction the whole provenance mechanism exists to hold.
   */
  readonly merged_refinements?: readonly string[];
  /**
   * Labels of MODEL options withdrawn because their intervention signature was
   * identical to this one's (`undeveloped_duplicate_of_*`). APPEND-ONLY, and
   * DELIBERATELY NOT `merged_refinements`: a demote is not a merge. Nothing of
   * the withdrawn option's content is folded into this node, and saying so in
   * the merge field would claim an absorption that never happened.
   */
  readonly undeveloped_duplicates?: readonly string[];
  /**
   * ⭐⭐ PRESENT IFF `stated` — DID THE BRIEF ACTUALLY SAY THIS?
   *
   * `provenance_class: "stated"` is a statement about WHERE THE MODEL PUT THIS
   * RECORD, and it is true by construction: the projector reads it off its own
   * loop position, so the model cannot forge it. That is the property R1 was
   * built for and it holds.
   *
   * It is not the property the user reads off the badge. "Stated" is read as
   * "the brief said this", and nothing in the pipeline was checking that — so
   * unsupported content could enter `stated_items` and leave as `from_brief`
   * without ever touching the model's (non-existent) provenance channel. The two
   * questions are *"who put this here?"* and *"is it supported?"*, and they were
   * being answered by one field (trap 21).
   *
   * This field answers the second one, derived from the brief bytes at
   * projection time by `bindStatedItemToBrief`. `provenance_class` is left
   * alone: it still means what it always meant, and the structural machinery
   * that reads it (the duplication merge, the option budget) is untouched.
   * The WIRE badge is what moves — only `verified` earns `from_brief`.
   */
  readonly brief_binding?: BriefBinding;
}

/** A reference the model emitted that the projector could not resolve. */
export interface DroppedRecordRef {
  readonly claim_index: number;
  readonly claim_kind: string;
  readonly label: string;
  /**
   * ⭐⭐ THE MINTED ID OF THE THING THIS DISCLOSURE IS ABOUT — present whenever the
   * projector knew it, which is every site that discloses a NODE.
   *
   * ⚠ IT IS NOT A PROMISE THAT THE NODE SURVIVED. For `unconnected_to_goal` the
   * node is withdrawn from the graph in the same breath, and that is exactly the
   * case where identity matters most: the consumer needs to say *"you told me
   * this and it is not in the model"*, and it cannot resolve the subject by
   * LABEL because the label is, by construction, no longer in `nodes[]`.
   *
   * Added because the response transform was resolving disclosures by matching
   * labels against the final node list — first-wins, so two same-labelled nodes
   * mis-anchored the notice to the wrong one, and 51 of 56 real disclosures
   * (every `unconnected_to_goal`) matched nothing and were dropped in silence.
   * An id the producer already holds is not something a consumer should be
   * reconstructing from a string.
   */
  readonly node_id?: string;
  readonly reason:
    | "unparseable_ref"
    | "ref_out_of_range"
    | "ref_target_not_a_node"
    | "self_loop"
    | "missing_ref"
    /**
     * The record was projected as a node and then withdrawn because nothing the
     * model emitted connects it to the goal. Kept as a RECORD and reported here;
     * never forced onto the graph with an invented edge, and never silently
     * lost. `claim_index` is -1 for these — they are named by label, because the
     * withdrawal happens after both node passes and a stated item has no claim
     * index to point at.
     */
    | "unconnected_to_goal"
    /**
     * The projected option set exceeded `MAX_OPTIONS` (6, `graph-validator.types.ts:287`)
     * and this refinement was left off the graph to bring it inside the bound.
     * DISCLOSED rather than silently truncated: over-budget is the projector's
     * problem to report, never the user's to discover from a shorter list.
     *
     * ⚠ A STATED option is NEVER dropped for budget. Dropping one narrows the
     * user's own choice set, which is the single thing a decision tool may not
     * do (the same reasoning the connectivity prune states for options). If the
     * user's own options alone exceed the bound, every one of them is kept and
     * `INSUFFICIENT_OPTIONS` is allowed to fire VISIBLY — a loud rejection beats
     * a quiet amputation.
     */
    | "option_budget_exceeded"
    /**
     * BOTH namespace fields of one endpoint were present (`from_stated` AND
     * `from_claim`, or the `to_*` pair). The two say different things and the
     * projector has no basis for preferring either, so it refuses and discloses.
     * Guessing here would reintroduce exactly the silent mis-binding the typed
     * fields were introduced to end.
     */
    | "ambiguous_ref"
    /**
     * ⭐ THE NAMESPACE RESIDUE, CAUGHT. Both endpoints resolved, but their node
     * KINDS cannot form a legal edge under any repair the pipeline performs —
     * see `UNRESCUABLE_EDGE_SHAPES`. This is the class the typed reference
     * fields cannot reach: a well-formed reference into the wrong namespace
     * lands on a real node of the wrong kind, and a well-formed reference into
     * the RIGHT namespace can still express an illegal shape.
     *
     * MEASURED on B1: `c25`/`c28` were namespace slips (they meant the goal
     * `s0`, wrote `c0`, an option refinement) and `c29` was a deliberate,
     * correctly-referenced `factor → option` — three bad edges, two different
     * defects, and only this check sees all three. Disclosing them is what lets
     * the completion pass be asked a precise question instead of being shown a
     * downstream connectivity symptom.
     */
    | "ref_kind_illegal"
    /**
     * An `option_refinement` that names exactly one stated `option` as its whole
     * basis is a refinement OF that option, not a second alternative. The
     * projector binds it to the parent's node instead of minting a competing
     * option, and every link the model drew from or to the refinement lands on
     * the parent. Recorded here so the merge is visible, never silent.
     */
    | "refinement_merged_into_stated_option"
    /**
     * ⭐⭐ THE DEMOTE. A MODEL-emitted option whose intervention signature is
     * IDENTICAL to a USER-STATED option's: the model proposed an alternative and
     * never quantified how it differs, so the analysis cannot tell the two apart
     * (`OPTIONS_IDENTICAL`). The model's one is withdrawn from the option set and
     * DISCLOSED here, naming the stated option it duplicated.
     *
     * A STATED option is NEVER demoted, and a (stated, stated) collision is left
     * standing and blocking — the user's own duplication is the user's to
     * resolve, and resolving it behind them would narrow their choice set.
     *
     * The IDEA is not deleted: it is named here and on the survivor's provenance,
     * so it remains coaching material ("what would make these two different?").
     */
    | "undeveloped_duplicate_of_stated"
    /**
     * Two MODEL options with identical signatures and no stated member in the
     * group. The lowest claim index is kept — a deterministic tie-break, not a
     * judgement about which is better — and the rest are disclosed here.
     *
     * ⚠ MEASURED: this shape does not occur in the banked corpus (round-11
     * population: 4 collision groups, all four (stated, model)). It is
     * implemented and tested synthetically, and that is stated rather than
     * implied.
     */
    | "undeveloped_duplicate_of_model"
    /**
     * A link whose endpoint was demoted above. The reference itself was
     * well-formed — it named a real record — so it is NOT reported as an
     * unresolved reference, which would blame the model for a withdrawal the
     * projector performed. Named apart for that reason (trap 21: two questions
     * under one name is how a disclosure vocabulary starts lying).
     */
    | "endpoint_demoted_duplicate"
    /**
     * ⭐ ROOT 2(a). A `constraint` carried a value but no `direction`, so no
     * operator was asserted. The node keeps the user's words; the THRESHOLD is
     * withheld until the direction is known. This is the ask, not a loss.
     */
    | "constraint_direction_unstated"
    /**
     * ⭐ ROOT 2(b). A `figure` was stated with `role:"target"`. It is on the
     * graph as the user's own words, but it is NOT yet a goal threshold — so
     * nothing downstream should read it as a level that has been ACHIEVED.
     */
    | "stated_target_not_represented_as_threshold"
    /**
     * ⭐ ROOT 2(b), THE WORSE HALF. A stated `role:"target"` carried a number and
     * that number reached the graph NOWHERE — `projectOnce` has no value branch
     * for `goal`, so "cut churn to 8%" lands as a label with the 8 discarded.
     * Distinct from the reason above, where the number is present but modelled as
     * a value that already holds.
     */
    | "stated_target_value_dropped"
    /**
     * ⭐ ROOT 2(c). Two or more parallel `causal_link` claims set the SAME
     * option→factor pair to DIFFERENT levels. One was chosen canonically; the
     * others are named here rather than silently overwritten.
     */
    | "parallel_intervention_conflict";
  /** The reference as emitted, rendered for a reader. */
  readonly from_ref?: string;
  readonly to_ref?: string;
  /** Resolved node kinds — present only on `ref_kind_illegal`, where they ARE the finding. */
  readonly from_kind?: string;
  readonly to_kind?: string;
  /**
   * Present only on the demote reasons: the minted id of the option kept.
   *
   * ⭐ IT ALWAYS NAMES A NODE ON THE FINAL GRAPH, or it is absent. It is
   * RE-RESOLVED at the fixed point rather than copied from the round that
   * decided it, because a model survivor can merge into its stated parent on a
   * later pass and take its id with it.
   */
  readonly duplicate_of?: string;
  /** Its label, so the disclosure reads without a second lookup. */
  readonly duplicate_of_label?: string;
  /**
   * Present only when the option originally kept has itself since merged away:
   * the label it carried. `duplicate_of` then names the node that ABSORBED it,
   * and this names what was actually duplicated — so the record stays true to
   * both questions instead of quietly answering one with the other.
   */
  readonly merged_survivor_label?: string;
  /**
   * The signature the two shared, from the validator's own function. Present on
   * the demote reasons, where it IS the finding — a reader can re-derive the
   * decision from it rather than take the projector's word for it.
   */
  readonly intervention_signature?: string;
}

export interface RecordProjection {
  /** GraphV3, ready for the parse stage's post-LLM seam. */
  readonly graph: ProjectedGraph;
  /** node/edge id → provenance. The authority for every provenance question. */
  readonly provenance: Readonly<Record<string, RecordProvenance>>;
  /**
   * Every reference the projector refused to guess at. DISCLOSED, never silent —
   * a dropped link the user can see is a different and far better thing than one
   * that vanished without trace.
   */
  readonly dropped: readonly DroppedRecordRef[];
}

// ── GraphV3 output shapes (structural mirrors of `schemas/graph.ts`) ─────────

export interface ProjectedNode {
  id: string;
  kind: "goal" | "decision" | "option" | "outcome" | "risk" | "action" | "factor" | "constraint";
  label: string;
  category?: "controllable" | "observable" | "external";
  data?: Record<string, unknown>;
  observed_state?: Record<string, unknown>;
  provenance?: RecordProvenance;
}

export interface ProjectedEdge {
  id: string;
  from: string;
  to: string;
  effect_direction?: "positive" | "negative";
  strength_mean?: number;
  origin: "ai" | "default";
  provenance_source: "inferred" | "structural";
  provenance?: RecordProvenance;
}

export interface ProjectedGraph {
  version: string;
  default_seed: number;
  nodes: ProjectedNode[];
  edges: ProjectedEdge[];
  meta: {
    roots: string[];
    leaves: string[];
    suggested_positions: Record<string, never>;
    source: "assistant";
  };
}

// ── Canonicalisation primitives ─────────────────────────────────────────────

/**
 * NFC-normalise, trim, collapse internal whitespace runs to a single space.
 *
 * ⚠ This is IDENTITY-BEARING: it feeds the hash. Two quotes differing only by
 * a non-breaking space, a CRLF, or a trailing tab MUST mint the same id, or the
 * "same content ⇒ same id" premise fails on input a real model actually emits.
 * `\s` in a JS regex covers NBSP (U+00A0), the Unicode space separators, tabs
 * and every newline form, so one class handles all of them.
 */
export function canonicalText(input: string): string {
  return input.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * First 8 hex chars of sha256 over NUL-joined parts.
 *
 * The NUL separator is not decoration: joining with any printable character
 * makes `("ab","c")` and `("a","bc")` collide. NUL cannot occur in canonicalised
 * text (`\s+` collapsing does not produce it and JSON strings carry it escaped),
 * so the encoding is injective over this domain.
 */
export function sha8(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 8);
}

/**
 * Recursively key-sorted stringify — the canonical serialisation the determinism
 * battery hashes.
 *
 * Object key order is NOT part of graph identity: two projections that differ
 * only in key order are the same graph. Comparing raw `JSON.stringify` output
 * would therefore report a divergence that is not one — and, far worse, could
 * report AGREEMENT for the wrong reason if both sides were built by the same
 * accidental ordering. Sorting makes the comparison a claim about CONTENT.
 * Arrays keep their order, because element order IS identity-bearing here.
 */
export function canonicalSerialise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalSerialise).join(",")}]`;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys
    .filter((k) => rec[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalSerialise(rec[k])}`)
    .join(",")}}`;
}

/**
 * THE `floor`/`ceiling` → wire-operator mapping. The ONLY site.
 *
 * Derived at the CONSUMER's bytes: `ConstraintOperator = z.enum([">=", "<="])`
 * (`schemas/graph.ts:171`). CEE #888 burned four rounds on a floor/ceiling
 * predicate; the lesson taken here is that the gate's language and the wire
 * operator are two vocabularies, the translation happens exactly once, and it
 * is pinned by a test rather than restated in prose.
 */
export function directionToOperator(direction: "floor" | "ceiling"): ">=" | "<=" {
  return direction === "floor" ? ">=" : "<=";
}

// ── Identity minting ────────────────────────────────────────────────────────

/**
 * Deterministic collision suffixing.
 *
 * Two identical `(kind, quote)` pairs are legitimately possible (a model may
 * repeat itself). Both must still get DISTINCT node ids or the graph silently
 * loses one. Suffixing by first-seen array position is deterministic: same
 * input order ⇒ same suffixes.
 */
function mintUnique(base: string, used: Map<string, number>): string {
  const seen = used.get(base) ?? 0;
  used.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen + 1}`;
}

const STATED_KIND_TO_NODE_KIND: Readonly<Record<string, ProjectedNode["kind"]>> = {
  goal: "goal",
  option: "option",
  constraint: "constraint",
  // A stated figure is a quantity the user asserted: a factor node carrying it.
  figure: "factor",
};

const CLAIM_KIND_TO_NODE_KIND: Readonly<Record<string, ProjectedNode["kind"] | null>> = {
  factor: "factor",
  option_refinement: "option",
  prior: "factor",
  // Produces an EDGE, never a node.
  causal_link: null,
};

/**
 * ⭐⭐ THE UNRESCUABLE EDGE SHAPES — the only edges this projector refuses.
 *
 * ── WHY THE PROJECTOR CHECKS EDGE SHAPE AT ALL ─────────────────────────────
 * Because a mis-referenced link does not fail; it SUCCEEDS onto the wrong node.
 * B1's three goal-bound links resolved cleanly to an option refinement, so
 * nothing reached the goal, the connectivity prune below removed everything that
 * could not, and a complete 23-item / 34-claim emission became 8 nodes and 6
 * edges. Every instrument upstream reported a healthy draft. The defect was
 * observable HERE, at the moment the endpoints resolve, and nowhere earlier.
 *
 * ── ⚠ THE REJECTION SET IS DELIBERATELY THE *PROVABLY UNRESCUABLE* SET ─────
 * This is not a second copy of `ALLOWED_EDGES` and must never become one. The
 * pipeline legitimately repairs several shapes that `ALLOWED_EDGES` alone would
 * call illegal, and a projector that rejected those would DELETE REAL CAUSALITY
 * the user's model needs — a lie by omission, which is worse than the loud
 * `INVALID_EDGE_TYPE` a wrong acceptance produces. The two errors are not
 * symmetric, so the threshold is not symmetric either (trap 22b): reject only
 * what nothing downstream can rescue, and let everything else meet the real
 * validator.
 *
 * DERIVED at the bytes, 2026-08-12, against `ALLOWED_EDGES`
 * (`graph-validator.types.ts:293-302`) AND every kind-sensitive stage of
 * `deterministic-sweep.ts`. What is NOT rejected, and why:
 *   factor → goal          `fixFactorGoalEdges` (:963-1059, runs unconditionally)
 *                          mints an outcome node and bridges it. LEGAL TO EMIT.
 *   option → goal          `fixOptionGoalShortcut` (:1406-1590) reroutes it when
 *                          the option already has a factor target. Flag-gated
 *                          (`optionShortcutRepair`, default true), so the
 *                          projector stays out of it.
 *   option → constraint    `fixOptionRiskShortcut` (:1223-1390) handles it.
 *   factor → constraint    legal as `factor → risk` (rule :299) — see the
 *                          normalisation note below.
 *   constraint → goal      legal as `risk → goal` (rule :301). The v3
 *                          instruction explicitly asks for this edge.
 *
 * ── ⚠⚠ THE KIND THIS TABLE JUDGES IS THE POST-NORMALISATION KIND ───────────
 * `normaliseDraftResponse` runs at `anthropic.ts:1978` — 53 lines AFTER the
 * projection seam at `:1925` — and `NODE_KIND_MAP` (`normalisation.ts:47`) maps
 * `'constraint' → 'risk'`. So a node this projector mints as `constraint` is a
 * RISK node by the time any validator or sweep stage sees it, and its edges are
 * judged by the risk rules. Verified at the bytes rather than inferred, because
 * judging a constraint edge by the (nonexistent) constraint rules would reject
 * `constraint → goal` — an edge the instruction asks for and the validator
 * accepts.
 */
export const PROJECTED_KIND_AFTER_NORMALISATION: Readonly<Record<string, string>> = {
  // `normalisation.ts` NODE_KIND_MAP. Only the kinds this projector can mint.
  constraint: "risk",
  goal: "goal",
  option: "option",
  factor: "factor",
  decision: "decision",
};

/**
 * Post-normalisation kind for a kind this projector minted. EXPORTED so the
 * completion ask can predict `MISSING_BRIDGE` on the same kinds the validator
 * will judge, instead of carrying its own copy of the normalisation map — the
 * hand-maintained mirror this file already pays to avoid elsewhere (trap 12).
 */
export function projectedKindAfterNormalisation(kind: string): string {
  return PROJECTED_KIND_AFTER_NORMALISATION[kind] ?? kind;
}

/**
 * `${fromKind}->${toKind}` pairs (post-normalisation) that no repair rescues.
 * Each entry carries the derivation that admits it.
 */
export const UNRESCUABLE_EDGE_SHAPES: ReadonlySet<string> = new Set([
  // NOTHING MAY POINT INTO AN OPTION. `decision → option` (rule :294) is the
  // only inbound rule, and the decision node is projector-structural and has no
  // wire reference, so no model-emitted link can legally target an option.
  // Confirmed exhaustively: no sweep stage rewrites, retargets or bridges an
  // edge whose `to` is an option.
  "factor->option",
  "option->option",
  "risk->option",
  "goal->option",
  // NOTHING MAY LEAVE A GOAL. `fixGoalHasOutgoing` (:266-293) deletes every edge
  // whose `from` is a goal. Emitting one is pure loss, so disclose it instead.
  "goal->factor",
  "goal->risk",
  "goal->goal",
  "goal->decision",
  // constraint(→risk) as a SOURCE, other than `risk → goal`.
  "risk->factor",   // no rule; nothing rewrites it
  "risk->risk",     // SIMPLE_REMOVE_PATTERNS (:783-786) deletes it
  "risk->decision",
  "factor->decision",
  "option->decision",
]);

/**
 * THE ONE EDGE RULE, as a predicate rather than a table entry.
 *
 * `factor → factor` is legal only when the TARGET is `observable` or `external`
 * (rules :296/:297), and `inferFactorCategories` (`graph-validator.ts:83-134`)
 * makes a factor `controllable` EXACTLY when a directed option edge points at
 * it. So a link into a factor that an option acts on is illegal, and no sweep
 * stage rewrites `factor → factor`. This is B3's entire failure — three edges,
 * all this one shape.
 *
 * The projector can decide it exactly, because option→factor edges are its own
 * output: the predicate is a function of the projected edge set, not of any
 * category the model declared (which the projector deliberately never
 * propagates).
 */
function isOptionControlledFactor(
  targetId: string,
  kindById: ReadonlyMap<string, string>,
  edges: readonly { from: string; to: string }[],
): boolean {
  if (kindById.get(targetId) !== "factor") return false;
  return edges.some((e) => e.to === targetId && kindById.get(e.from) === "option");
}

// ── Scale projection (pass 3d) ──────────────────────────────────────────────

/**
 * ⭐⭐ WHY DRAFTED MAGNITUDES ARE PROJECTED ONTO THE UNIT INTERVAL.
 *
 * The model states magnitudes RAW, verbatim, in the factor's own unit — that is
 * the records contract, and it is right (asking the model to normalise is
 * asking it to do arithmetic, the failure class this design exists to end).
 * But the analysis seam's scale guard (`plot-intervention-scale.ts`, derived at
 * its bytes) admits a request only when (a) every intervention is within
 * [0,1] — PLoT's request-level gate then SKIPS and reads the values as the
 * levels they are — or (b) every outside value carries a provable unit-interval
 * form. Bare raw magnitudes on capless factors are neither, so a realistic
 * brief (£ costs beside 0–1 proportions) was HONESTLY REFUSED at run_analysis
 * ("the scale of … is unclear", witnessed live 2026-08-12). The guard is
 * correct; the records must satisfy it truthfully. This pass is that
 * satisfaction: per factor, one deterministic frame, every magnitude divided by
 * it, ratios preserved exactly, raw user magnitudes kept on baselines via
 * `raw_value` (which the display chain prefers — `display-value.ts` priorities
 * 1–4 — so the user still sees "£50k", never "0.5").
 *
 * ── ⚠ NO `cap` IS STORED, AND THAT IS LOAD-BEARING, NOT AN OMISSION ─────────
 * Derived at the edit seam's bytes (`d1-shared/normalise-factor-value.ts`):
 * "When `cap` is defined, value = raw_value / cap … when absent,
 * value = raw_value". A stored cap therefore flips every later user edit to a
 * NORMALISED `observed_state.value` write — and the golden-journey harness
 * (INV-7) binds `observed_state.value === <user-stated raw>` after an edit, so
 * a faithful edit would read as a failure. Capless factors keep user-scale
 * round-trips intact. The frame is not persisted; it is recoverable on
 * baseline-bearing factors from the `value`/`raw_value` pair.
 *
 * ── THE FRAME, AND WHY EACH RULE (all deterministic, no model arithmetic) ───
 *   · any magnitude < 0  → NO frame. A negative magnitude has no unit-interval
 *     representation (the guard is sign-symmetric: `v < 0 || v > 1`), and
 *     shifting or folding it would fabricate a value class the user never
 *     stated. The factor stays raw and the guard's honest typed ask stays
 *     reachable — disclosure over fabrication, by construction.
 *   · all magnitudes ≤ 1 → NO frame needed: already the natural unit scale.
 *   · percent-scaled unit AND max ≤ 100 → frame = 100 exactly. A percentage
 *     DECLARES its scale; deriving one instead would discard information the
 *     record genuinely states (3% must be level 0.03, not 0.6-of-a-derived-5).
 *     Detection is corpus-validated: every percent unit across the 30 banked
 *     record sets starts with '%' ('%', '% NRR', '% YoY growth', …).
 *   · otherwise frame = the smallest {1,2,5}·10^k STRICTLY greater than the
 *     largest magnitude. Strictness means no value lands exactly on 1.0 (except
 *     a 100% percentage, where 1.0 is the truth).
 *
 * ── EDITS PRESERVE THE FRAME AT THE EDIT SEAMS, NOT HERE ────────────────────
 * The projector runs at draft time only. A later user edit reaches the
 * persisted baseline through exactly two writers (enumerated repo-wide,
 * pinned in `handlers/__tests__/scale-frame-preserving-edit.test.ts`):
 * `d1-shared/normalise-factor-value.ts` and `canonicalise-value-ops.ts`'s
 * `reconcileObservedValuePair`. Both recover the frame from the factor's own
 * pair (`recoverScaleFrame`, d1-shared/scale-frame.ts: raw_value / value) and
 * write `{value: raw/frame, raw_value: raw}` — so the golden £50,000 → £74,000
 * edit lands as {0.74, 74000} on the SAME 100,000 frame the draft established.
 * An over-frame edit yields an honest level > 1 rather than a silent
 * re-framing (which would rescale every sibling intervention).
 *
 * ── DISCLOSED TRADE: OPTION-IDENTITY RESOLUTION IS NOW 4dp-OF-LEVEL ─────────
 * The demote pass and CEE's OPTIONS_IDENTICAL gate both judge identity via
 * `buildInterventionSignature` (`toFixed(4)`) over the values the graph
 * carries — which are now LEVELS. Raw differences below frame×1e-4 (e.g. £50
 * apart under a £500k frame) therefore collide and the model twin demotes,
 * disclosed. That is consistent with what the analysis itself can distinguish.
 *
 * The frame is a NORMALISATION REFERENCE derived from the user's/model's own
 * stated magnitudes — no invented business value enters the analysis, and
 * within-factor ratios are exact. Where no truthful frame exists (negatives),
 * nothing is invented and the analysis seam asks the user — the same
 * suppress-rather-than-guess principle the guard itself follows.
 */

/**
 * Percent spellings: the banked corpus's ('%-prefixed, all 30 record sets),
 * plus the spelt-out forms the adversarial review supplied from OUTSIDE that
 * corpus ("per cent" — this is a British-English estate — and "pct"). Trap 22:
 * the corpus-only version silently read "3 per cent" as a derived-frame 0.6.
 */
export function isPercentScaledUnit(unit: string | undefined): boolean {
  if (typeof unit !== "string") return false;
  const t = unit.trim().toLowerCase();
  return t.startsWith("%") || t.startsWith("percent") || t.startsWith("per cent") || t.startsWith("pct");
}

/**
 * Basis points declare scale 10,000 — NOT 100. Lumping "bps" into the percent
 * set would be a 100× error in the opposite direction (30 bps = 0.003, never
 * 0.3). Narrow on purpose: "bps" and "basis point(s)"; a bare "bp" is left to
 * the derived frame rather than guessed.
 */
export function isBasisPointsUnit(unit: string | undefined): boolean {
  if (typeof unit !== "string") return false;
  const t = unit.trim().toLowerCase();
  return t.startsWith("bps") || t.startsWith("basis point");
}

/**
 * The smallest {1,2,5}·10^k STRICTLY greater than `x` (x > 0, finite).
 * Pure arithmetic, no floating log tricks at the boundaries: the exponent scan
 * starts safely below x and walks up, so exact powers (100 → 200) behave.
 */
export function nextNiceNumberAbove(x: number): number {
  let magnitude = 10 ** Math.floor(Math.log10(x));
  // Math.log10 can land one bucket high or low at representation boundaries;
  // step down until magnitude ≤ x so the candidate walk below is complete.
  while (magnitude > x) magnitude /= 10;
  for (;;) {
    for (const m of [1, 2, 5]) {
      const candidate = m * magnitude;
      if (candidate > x) return candidate;
    }
    magnitude *= 10;
  }
}

/**
 * The per-factor frame, or `undefined` when none is needed (already unit
 * interval) or none truthfully exists (a negative magnitude).
 */
export function deriveFactorScaleFrame(
  magnitudes: readonly number[],
  unit: string | undefined,
): number | undefined {
  if (magnitudes.length === 0) return undefined;
  if (magnitudes.some((m) => m < 0)) return undefined;
  const max = Math.max(...magnitudes);
  if (max <= 1) return undefined;
  if (isPercentScaledUnit(unit) && max <= 100) return 100;
  if (isBasisPointsUnit(unit) && max <= 10000) return 10000;
  const frame = nextNiceNumberAbove(max);
  // ~1.6e308 upward the {1,2,5}·10^k ladder overflows to Infinity, and an
  // infinite frame would ship a fabricated level 0 under a green guard
  // (review breadth finding). Non-finite frame → unframed, the honest path.
  if (!Number.isFinite(frame)) return undefined;
  return frame;
}

// ── The projector ───────────────────────────────────────────────────────────

/** One demote decision, keyed by the claim index it withdraws. */
interface DemoteDecision {
  readonly claimIndex: number;
  readonly label: string;
  readonly reason: "undeveloped_duplicate_of_stated" | "undeveloped_duplicate_of_model";
  /** The minted id of the option kept, AS OBSERVED when the decision fired. */
  readonly survivorId: string;
  readonly survivorLabel: string;
  /**
   * Present IFF the survivor is a MODEL option, and it is what makes the
   * disclosure re-resolvable.
   *
   * ⭐⭐ A MODEL SURVIVOR IS NOT A STABLE ADDRESS. Withdrawing this option's
   * rival can leave the SURVIVOR the only refinement of its parent, so on the
   * next pass the survivor MERGES and mints no node at all — and a disclosure
   * still pointing at its id names nothing the reader can find. (Measured: the
   * round-11 review's B1, `duplicate_of: "b1d470fa"` against a graph whose
   * parent is `234dcb3d`.) A STATED survivor has no such problem — options are
   * exempt from the connectivity prune and the budget surrender, and a stated
   * option cannot be demoted — so only the model case carries this.
   */
  readonly survivorClaimIndex?: number;
  readonly signature: string;
}

/** `projectOnce`'s output plus the binding the demote pass needs. */
interface OneProjection extends RecordProjection {
  /** Minted option-node id → the claim index that minted it. Model options only. */
  readonly optionClaimIndexById: ReadonlyMap<string, number>;
}

/**
 * ONE projection pass. `demoted` names claim indices withdrawn by a previous
 * pass: they mint no node, they are not merge candidates, and links naming them
 * are disclosed as `endpoint_demoted_duplicate`.
 *
 * ⚠ The claims ARRAY IS NOT FILTERED, deliberately. Every wire reference is an
 * array POSITION (`from_claim`, `to_claim`, `basis`), so removing an element
 * would silently re-point every later reference — the exact class of silent
 * mis-binding the typed reference fields were introduced to end.
 */
function projectOnce(
  records: DraftRecordSet,
  demoted: ReadonlyMap<number, DemoteDecision>,
  brief: string | undefined,
): OneProjection {
  const statedItems: readonly DraftStatedItem[] = records.stated_items ?? [];
  const claims: readonly DraftInferenceClaim[] = records.claims ?? [];

  const nodes: ProjectedNode[] = [];
  const edges: ProjectedEdge[] = [];
  const dropped: DroppedRecordRef[] = [];
  /** edge id → the model's stated option→factor intervention level (`sets_to`). */
  const setsToByEdgeId = new Map<string, number>();
  const provenance: Record<string, RecordProvenance> = {};
  const usedIds = new Map<string, number>();

  /** Wire-ref token → minted node id. Populated in emission order. */
  const statedIdByIndex = new Map<number, string>();
  const claimIdByIndex = new Map<number, string>();
  /** Minted OPTION node id → the claim index that minted it (model options only). */
  const optionClaimIndexById = new Map<string, number>();

  // ── Pass 1: stated items → nodes. Provenance badge is `stated`, taken from
  // the loop, not from any model-supplied field.
  statedItems.forEach((item, index) => {
    const quote = canonicalText(item.source_quote ?? "");
    const kind = STATED_KIND_TO_NODE_KIND[item.kind];
    // An unknown kind cannot occur through the grammar (enum-constrained), but
    // the projector is also called from tests and fixtures. Skip loudly rather
    // than emit an untyped node.
    if (!kind) return;

    const id = mintUnique(sha8(item.kind, quote), usedIds);
    statedIdByIndex.set(index, id);

    // ⭐⭐ ROOT 1 — THE BADGE IS NOW EARNED, NOT ASSUMED.
    //
    // `provenance_class` still comes from the loop position, because that fact
    // ("the model put this in `stated_items`") is what the loop position knows.
    // What it never knew is whether the brief SAYS this, and that is the thing
    // the user reads off the badge. Derived here, at the brief's bytes, by the
    // one authority the response transform also uses.
    const briefBinding = bindStatedItemToBrief({
      quote: item.source_quote,
      value: item.value,
      unit: item.unit,
      brief,
    });
    const prov: RecordProvenance = {
      provenance_class: "stated",
      source_quote: quote,
      brief_binding: briefBinding,
    };
    provenance[id] = prov;

    const node: ProjectedNode = {
      id,
      kind,
      // The label IS the user's own words. Nothing is paraphrased: a paraphrase
      // badged `stated` would be a misrepresentation of the user to themselves,
      // so the projector never rewrites a quote it attributes.
      label: quote,
      provenance: prov,
    };

    const statedDirection = item.direction;
    if (kind === "constraint" && typeof item.value === "number" && statedDirection === undefined) {
      // ⭐⭐ ROOT 2(a) — DO NOT GUESS A DIRECTION. ASK.
      //
      // `direction` is OPTIONAL in the grammar (`required: ["kind",
      // "source_quote"]`), so the model may omit it — and this line used to read
      // `item.direction ?? "ceiling"`, which turns EVERY unstated direction into
      // `<=`. For "Cash must stay above 1000 pounds" that is not a missing
      // detail, it is **the opposite constraint**, asserted with full
      // confidence and no disclosure, while `analysis_ready` reports ready.
      //
      // There is no defensible default. A floor and a ceiling are not near-
      // misses of one another; a 50/50 guess on a threshold the user gave us in
      // words is the estate's ratified never-do (trap 22f — where direction
      // cannot be determined, make the AMBIGUITY the product and ask, rather
      // than pick a side and be silently wrong half the time).
      //
      // So the node keeps the user's own words and its place on the graph — no
      // stated content is lost — but asserts NO threshold and NO operator, and
      // says so. `enumerateCompletionAsk` turns this disclosure into a question.
      dropped.push({
        claim_index: -1,
        claim_kind: "stated_item",
        label: quote,
        node_id: id,
        reason: "constraint_direction_unstated",
      });
    } else if (kind === "constraint" && typeof item.value === "number" && statedDirection !== undefined) {
      const operator = directionToOperator(statedDirection);
      // PLoT reads the operator in BOTH places (graph.ts:176-178, 252-258).
      node.data = { operator };
      node.observed_state = {
        value: item.value,
        metadata: {
          operator,
          original_value: item.value,
          ...(item.unit ? { unit: item.unit } : {}),
        },
      };
    } else if (kind === "factor" && typeof item.value === "number") {
      node.data = {
        value: item.value,
        ...(item.unit ? { unit: item.unit } : {}),
        // ⭐ THE ONE PLACE THIS PROJECTOR CLAIMS THE BRIEF, and the only one.
        //
        // `extractionType` is a DECLARED field (`FactorNodeData.extractionType`,
        // `schemas/graph.ts:135`) — it does not ride a `.passthrough()`. The
        // consumer chain, derived at the bytes rather than inferred:
        //   `schema-v3.ts` reads `observed_state.extractionType ?? node.extractionType
        //   ?? data.extractionType` (via `isFactorData`), maps it through
        //   `nodeProvenanceDisplay` ("explicit"|"observed" → `from_brief`), and then
        //   WITHDRAWS the claim unless `mayClaimFromBrief` re-earns it
        //   (`classifyFactorValueTier === "explicit"`, i.e. the label AND a numeric
        //   value both present — ROADMAP 2.972).
        //
        // The claim is honest here by construction: this branch runs only inside the
        // stated-items loop, only for a `figure`, and only when the USER stated the
        // number — `item.value` is the model's transcription of their own quote, not
        // an estimate. Every other node this projector emits sets no
        // `extractionType` at all and therefore falls to the safe `ai_inferred`
        // default. And because 2.972's gate re-derives the verdict from the value it
        // can see, this line cannot manufacture a `from_brief` badge for a node that
        // has not earned one — the badge and the pipeline's own value accounting
        // come from ONE derivation and cannot drift apart (trap 12).
        // ⭐⭐ ROOT 1, THE GATE ITSELF — and the note above was TRUE AND
        // INSUFFICIENT, which is why the audit got through it.
        //
        // Everything the old note says about 2.972 is correct: the badge is
        // re-derived downstream and cannot be manufactured by a node that has no
        // value. But 2.972's gate asks *"is there a label and a number?"* — a
        // question about the record's SHAPE. It cannot ask whether the number is
        // the user's, because it never sees the brief. So a fabricated figure,
        // being perfectly well-shaped, sailed through it: an audit put
        // "Revenue is 10 million pounds" against a brief about commute time and
        // it emerged `from_brief`. And an exact quote carrying a CONTRADICTED
        // value ("Churn is 10 percent", value 90) did too, because shape was
        // never the failing part.
        //
        // The claim is now made only when the brief BEARS it. Absent or
        // unverified, the key is simply not set, and the node falls to the safe
        // `ai_inferred` default that every other node here already takes — the
        // content is untouched, only the attribution is withdrawn.
        ...(bindingEarnsBriefClaim(briefBinding) ? { extractionType: "explicit" as const } : {}),
      };
      // ⚠ FactorObservedState REFUSES any `metadata` key (graph.ts:225-233) —
      // a factor carrying constraint metadata matches NEITHER union branch and
      // 400s. Unit lives on `data`, never here.
      node.observed_state = { value: item.value, raw_value: item.value };
    }

    // ⚠ `role` DOES NOT SET A CATEGORY — `target`/`baseline` describe what the
    // user was doing with the number; `controllable`/`observable`/`external`
    // describe the node's position in the causal structure. They are two
    // different questions, and answering one with the other is how a `figure` an
    // option acts on ends up labelled `observable` and its edge rejected.
    //
    // ⭐⭐ ROOT 2(b) — BUT "NOT A CATEGORY" IS NOT "NOT ANYTHING", AND THAT SLIP
    // IS THE DEFECT. The reasoning above is sound and it was used to justify
    // reading `role` NOWHERE AT ALL. The grammar admits it, the seam carries it,
    // and the projector dropped it on the floor: `role:"target"` and
    // `role:"baseline"` produced BYTE-IDENTICAL projections, so a target the
    // user asked us to reach became just another observed value — no threshold,
    // no warning, and `analysis_ready` reporting ready over the top of it.
    //
    // A target and a current reading are opposite claims about the same number.
    // Carrying the distinction costs nothing and makes the two projections
    // differ; DISCLOSING it is what stops the silence.
    // ⚠ ONLY ONTO AN EXISTING `data`, AND THIS IS NOT A STYLE CHOICE — the first
    // version of this line wrote `{ ...(node.data ?? {}), role }`, which MINTS a
    // `data` object on a node that had none. `NodeData` is a UNION whose branches
    // are keyed on a required field each (`interventions` / `operator` / `value`),
    // so `{ role }` alone matches NOTHING and the consumer rejects the whole
    // draft — caught by `projector-consumer-contract`'s C-BUILD-1, which is
    // exactly the assertion that suite exists to make. A node with no data keeps
    // no data; the `target` disclosure below is what stops that being silent.
    if (item.role !== undefined && node.data !== undefined) {
      node.data = { ...node.data, role: item.role };
    }
    // ⭐⭐ WHEN A STATED TARGET'S NUMBER FAILED TO BECOME A THRESHOLD.
    //
    // ⚠⚠ THIS CONDITION HAS BEEN WRONG IN BOTH DIRECTIONS, AND THE SECOND TIME
    // IS THE INSTRUCTIVE ONE. It first fired on EVERY `role:"target"`, including
    // a bare `goal` with no number, which put a standing notice on ordinary
    // correct briefs. I then narrowed it with `&& kind !== "goal"` — and an
    // adversarial review showed I had narrowed it to fit TWO ARRAY-LENGTH
    // ASSERTIONS in fixtures that happened to contain a valueless goal target,
    // not because the domain said so. Worse, `projectOnce` has a value branch for
    // `constraint` and for `factor` and **NONE FOR `goal`** — so a stated numeric
    // goal target ("cut churn to 8%", value 8) lands with no data, no
    // observed_state and no threshold, and the narrowing removed the ONE notice
    // that would have named it. I carved out the case that needed it most.
    //
    // ⭐ SO THE PREDICATE IS NOW DERIVED FROM THE NODE'S ACTUAL STATE, not from a
    // list of kinds: fire when a target's NUMBER exists and did not end up
    // expressed as a threshold. A valueless target has no number to lose and
    // raises nothing; a `constraint` target that got its operator IS a threshold
    // and raises nothing. Neither a kind list nor a test's array length decides
    // it — the question "was this number represented?" is asked of the node.
    const targetValueUnrepresented =
      item.role === "target" &&
      typeof item.value === "number" &&
      (node.data as { operator?: string } | undefined)?.operator === undefined;
    if (targetValueUnrepresented) {
      // ⚠ TWO OUTCOMES, TWO NAMES (trap 21). They are different facts about the
      // user's number and a single reason would blur them:
      //  • the number reached the graph but as an OBSERVED value — modelled as
      //    something that already HOLDS rather than something to REACH;
      //  • the number reached the graph NOWHERE AT ALL (the `goal` case), which
      //    is the strictly worse member of the same family.
      const valueLandedSomewhere = node.observed_state !== undefined;
      dropped.push({
        claim_index: -1,
        claim_kind: "stated_item",
        label: quote,
        node_id: id,
        reason: valueLandedSomewhere
          ? "stated_target_not_represented_as_threshold"
          : "stated_target_value_dropped",
      });
    }

    nodes.push(node);
  });

  // ── Pass 1b: WHICH REFINEMENTS ARE THE SAME ALTERNATIVE AS A STATED OPTION ──
  //
  // ⭐⭐ THE OPTION-DUPLICATION FIX, and it is deterministic rather than a
  // request to the model.
  //
  // MEASURED, and it is the mirror of a fix that already shipped. Instruction v3
  // told the model that an `option_refinement` IS an option needing its own
  // chain, because 0 of 26 refinements had carried an outgoing link. The model
  // complied — and stopped chaining the USER'S OWN options instead. B1 then
  // emitted three refinements, each with a full chain, alongside three bare
  // stated options, and the projector minted SIX option nodes for THREE
  // alternatives. One predicate, two opposite harms, and closing one direction
  // reopened the other (trap 22b).
  //
  // A third instruction sentence would have to pick a side. This does not: the
  // duplication itself is removed, so it no longer matters which of the two
  // names the model chose to chain. Whatever it connected lands on ONE node.
  //
  // ── THE PARENT LINK WAS ALREADY ON THE WIRE ────────────────────────────────
  // `basis` is the array positions of the stated_items a claim builds on. A
  // refinement whose basis NAMES EXACTLY ONE stated `option` is, by the
  // grammar's own semantics, a refinement of that option. No new field, no new
  // prompt sentence. Measured on B1: three of four refinements name exactly one
  // stated option (`c0→s20`, `c1→s21`, `c2→s22`).
  //
  // ── ⭐⭐ COUNT THE OPTIONS, NOT THE ENTRIES (round 10) ──────────────────────
  // This test was `basis.length === 1` and that was a DEFECT in the
  // implementation of the rule above, not a different rule. The property is
  // "names exactly one stated OPTION"; what was tested is "has exactly one basis
  // ENTRY". `basis` is an EVIDENCE field — the instruction says "set `basis` to
  // the array positions of the stated_items your claim builds on" — which this
  // projector REPURPOSED as a parent pointer ("the link was already on the
  // wire"). So one field answers two questions: *what did you build on?* and
  // *which option is this a refinement of?* A figure in the basis answers the
  // first and says nothing about the second, and the length test let it veto the
  // parent link. Two questions under one name (trap 21), at FIELD level.
  //
  // ⭐ MEASURED over 28 banked record sets / 50 refinements, deduplicated by
  // capture body hash (`round9/ROUND10-STEP1-2-DECISION-AND-POPULATION.md`):
  //
  //     names NO stated option                              9   18.0%
  //     exactly one option, ALONE                          15   30.0%
  //     exactly one option PLUS non-option entries         17   34.0%   ← was refused
  //     two or more stated options                          9   18.0%
  //
  // **The refused shape is the MOST COMMON composition in the corpus** — more
  // common than the one the rule was written for — because the instruction
  // actively produces it. Blast radius of the correction: 17 refinements start
  // merging, **ZERO stop**. The corpus the original decision was written against
  // (B1's four refinements) contained no option-plus-non-option basis at all, so
  // no prior decision covered this shape.
  //
  // The two-or-more-OPTIONS case is unchanged and still does not merge: those are
  // genuinely distinct alternatives (B1's `[19,20]`; B3's "Rewrite first, then
  // copilot (sequenced)" naming both stated options). Collapsing one would narrow
  // the user's own choice set, which this projector may never do.
  //
  // ── ⚠ WHERE IT DELIBERATELY DOES NOT FIRE, AND WHY ─────────────────────────
  // If TWO OR MORE refinements name the same stated option, they are competing
  // sub-alternatives of a category the user named, not two words for one thing —
  // and collapsing them would silently narrow the user's choice set, the single
  // thing a decision tool may never do. B1's fourth refinement (`c3`, basis
  // `[19,20]`, "Defer Germany 12 months, accelerate UK NRR") names two items and
  // correctly does not merge: it is a genuinely distinct alternative.
  //
  // The parent keeps its `stated` provenance and the user's VERBATIM quote as
  // its label. The refinement's wording is never promoted onto it: a model
  // paraphrase wearing a `stated` badge is the exact false authorship this
  // mechanism exists to prevent. The refinement is recorded in the parent's
  // provenance (append-only) and disclosed in `dropped`.
  const refinementParentStatedIndex = new Map<number, number>();
  {
    const candidates = new Map<number, number[]>();
    claims.forEach((claim, index) => {
      if (claim.claim_kind !== "option_refinement") return;
      // ⭐ A DEMOTED REFINEMENT IS NOT A CANDIDATE, AND THIS IS WHY THE PASS MUST
      // ITERATE. Two refinements naming one parent trip the choice-set guard and
      // NEITHER merges. Withdraw one and the other becomes the parent's only
      // refinement — so it merges, its magnitudes land on the parent, and the
      // PARENT'S SIGNATURE CHANGES. A collision that did not exist on the first
      // pass can exist on the second.
      if (demoted.has(index)) return;
      const basis = claim.basis ?? [];
      // The stated OPTIONS this refinement names, deduplicated: naming the same
      // option twice still names one option.
      const namedOptions = [
        ...new Set(
          basis.filter((b) => Number.isInteger(b) && statedItems[b]?.kind === "option"),
        ),
      ];
      if (namedOptions.length !== 1) return;
      const parent = namedOptions[0]!;
      const list = candidates.get(parent);
      if (list) list.push(index);
      else candidates.set(parent, [index]);
    });
    for (const [parent, claimIndices] of candidates) {
      // Exactly one refinement for this option ⇒ one alternative under two
      // names. Two or more ⇒ distinct alternatives; leave every one of them
      // standing.
      if (claimIndices.length === 1) refinementParentStatedIndex.set(claimIndices[0], parent);
    }
  }

  // ── Pass 2: claims → nodes. Badge is `ai_inferred`, again taken from the loop.
  claims.forEach((claim, index) => {
    // A demoted claim mints nothing at all. Its disclosure is written once, by
    // the fixed-point wrapper, with the collision that caused it — not here,
    // where the reason would have to be re-derived.
    if (demoted.has(index)) return;
    const nodeKind = CLAIM_KIND_TO_NODE_KIND[claim.claim_kind];
    if (nodeKind === null || nodeKind === undefined) return;

    const label = canonicalText(claim.label ?? "");

    // A merged refinement mints NO node. Its wire reference resolves to the
    // parent option, so every link the model drew from or to it lands there and
    // pass 3 needs no knowledge of the merge.
    const mergedParent = refinementParentStatedIndex.get(index);
    if (mergedParent !== undefined) {
      const parentId = statedIdByIndex.get(mergedParent);
      if (parentId !== undefined) {
        claimIdByIndex.set(index, parentId);
        const parentProv = provenance[parentId];
        if (parentProv) {
          // APPEND-ONLY. The parent's class and quote are untouched; the
          // refinement is added alongside them so the record shows what the
          // model contributed without the model's words ever being attributed to
          // the user.
          provenance[parentId] = {
            ...parentProv,
            merged_refinements: [...(parentProv.merged_refinements ?? []), label],
          };
          const parentNode = nodes.find((n) => n.id === parentId);
          if (parentNode) parentNode.provenance = provenance[parentId];
        }
        dropped.push({
          claim_index: index,
          claim_kind: claim.claim_kind,
          label,
          reason: "refinement_merged_into_stated_option",
        });
        return;
      }
    }
    const id = mintUnique(sha8(claim.claim_kind, label), usedIds);
    claimIdByIndex.set(index, id);
    // The demote pass binds a model option to the claim that minted it BY
    // IDENTITY. Recorded here, at the one construction site, so no later pass
    // has to infer provenance from a label or a value (trap 19).
    if (nodeKind === "option") optionClaimIndexById.set(id, index);

    const basisIds = (claim.basis ?? [])
      .filter((i) => Number.isInteger(i) && statedIdByIndex.has(i))
      .map((i) => statedIdByIndex.get(i)!);

    const prov: RecordProvenance = {
      provenance_class: "ai_inferred",
      basis: basisIds,
      unbased: basisIds.length === 0,
    };
    provenance[id] = prov;

    const node: ProjectedNode = { id, kind: nodeKind, label, provenance: prov };
    if (nodeKind === "factor") {
      // ⚠ THE MODEL'S DECLARED `category` IS DELIBERATELY NOT PROPAGATED.
      //
      // Derived at the consumer's bytes, and measured live before this line was
      // written. `category` is INFERRED FROM STRUCTURE by the validator
      // (`graph-validator.ts:83-134`): a factor is `controllable` because an
      // option edge points at it. And the edge rule CONSULTS the category —
      // `{ fromKind: "option", toKind: "factor", toFactorCategory: "controllable" }`
      // (`graph-validator.types.ts:295`) — so a factor the model labelled
      // `observable` that an option points at is not merely mislabelled: the
      // edge itself becomes `INVALID_EDGE_TYPE` (`:518`), and `CATEGORY_MISMATCH`
      // fires alongside it (`:787`).
      //
      // Measured on a live draft: after the factor→goal split cleared every
      // kind-level violation, the graph still carried `INVALID_EDGE_TYPE ×2` and
      // `CATEGORY_MISMATCH ×2` — entirely from copied categories. The instruction
      // already declines to ASK the model for a category for exactly this reason;
      // the projector was quietly undoing that by copying the one the grammar
      // still allows it to volunteer.
      //
      // So the honest move is a deletion, not a translation: the projector does
      // not know the category, the validator derives it, and a value we cannot
      // justify is not one we should place on the user's graph. (The grammar
      // keeps the field: removing it is a wire change for no gain, and an
      // unread optional property costs one slot, not a rejection.)
      if (typeof claim.value === "number") {
        node.data = { value: claim.value };
        node.observed_state = { value: claim.value };
      }
    }
    nodes.push(node);
  });

  // ── Pass 3: causal_link claims → edges. Runs AFTER both node passes so a
  // link may reference a claim declared later in the array.
  const nodeIds = new Set(nodes.map((n) => n.id));

  /**
   * Resolve ONE endpoint from its typed namespace fields.
   *
   * The namespace is the FIELD, so there is no token to parse and no prefix that
   * could be mistyped — `unparseable_ref` is now unreachable through the grammar
   * and survives only for the fixture/test callers the header mentions.
   * Emitting BOTH fields of a pair is a contradiction, not a preference: the two
   * index different arrays and nothing here is entitled to choose.
   */
  const resolveEndpoint = (
    statedIdx: number | undefined,
    claimIdx: number | undefined,
  ): { id?: string; reason?: DroppedRecordRef["reason"] } => {
    if (statedIdx !== undefined && claimIdx !== undefined) return { reason: "ambiguous_ref" };
    if (statedIdx === undefined && claimIdx === undefined) return { reason: "missing_ref" };
    const idx = statedIdx ?? claimIdx!;
    if (!Number.isInteger(idx)) return { reason: "unparseable_ref" };
    // A demoted endpoint resolved perfectly well; the projector then withdrew
    // the node. Reporting `ref_out_of_range` here would blame the model for our
    // own decision, so the two are named apart.
    if (claimIdx !== undefined && demoted.has(idx)) return { reason: "endpoint_demoted_duplicate" };
    const id = statedIdx !== undefined ? statedIdByIndex.get(idx) : claimIdByIndex.get(idx);
    if (id === undefined) return { reason: "ref_out_of_range" };
    if (!nodeIds.has(id)) return { reason: "ref_target_not_a_node" };
    return { id };
  };

  /** How an endpoint reads back to a human, for the disclosure only. */
  const renderRef = (statedIdx: number | undefined, claimIdx: number | undefined): string | undefined => {
    if (statedIdx !== undefined && claimIdx !== undefined) return `stated_items[${statedIdx}]+claims[${claimIdx}]`;
    if (statedIdx !== undefined) return `stated_items[${statedIdx}]`;
    if (claimIdx !== undefined) return `claims[${claimIdx}]`;
    return undefined;
  };

  const kindAtLinkTime = new Map(nodes.map((n) => [n.id, n.kind as string]));

  // Provisional option→factor edge set, needed by the one-edge rule below. Built
  // from ALL the claims up front rather than from the `edges` array as it fills,
  // because the rule must give the same answer for the FIRST link considered as
  // for the last. Evaluating it against a partially-built edge list would make
  // the verdict depend on emission order, and this projector's entire premise is
  // that its output is a pure function of the record set's content AND order —
  // an order-dependent guard would be a non-determinism source wearing a
  // correctness rationale.
  const provisionalOptionTargets: { from: string; to: string }[] = [];
  for (const claim of claims) {
    if (claim.claim_kind !== "causal_link") continue;
    const f = resolveEndpoint(claim.from_stated, claim.from_claim);
    const t = resolveEndpoint(claim.to_stated, claim.to_claim);
    if (f.id && t.id && kindAtLinkTime.get(f.id) === "option") provisionalOptionTargets.push({ from: f.id, to: t.id });
  }

  claims.forEach((claim, index) => {
    if (claim.claim_kind !== "causal_link") return;
    const label = canonicalText(claim.label ?? "");
    const from = resolveEndpoint(claim.from_stated, claim.from_claim);
    const to = resolveEndpoint(claim.to_stated, claim.to_claim);
    const fromRef = renderRef(claim.from_stated, claim.from_claim);
    const toRef = renderRef(claim.to_stated, claim.to_claim);

    const bad = from.reason ?? to.reason;
    if (bad || !from.id || !to.id) {
      dropped.push({
        claim_index: index,
        claim_kind: claim.claim_kind,
        label,
        reason: bad ?? "missing_ref",
        ...(fromRef !== undefined ? { from_ref: fromRef } : {}),
        ...(toRef !== undefined ? { to_ref: toRef } : {}),
      });
      return;
    }
    if (from.id === to.id) {
      dropped.push({
        claim_index: index,
        claim_kind: claim.claim_kind,
        label,
        reason: "self_loop",
        ...(fromRef !== undefined ? { from_ref: fromRef } : {}),
        ...(toRef !== undefined ? { to_ref: toRef } : {}),
      });
      return;
    }

    // ── THE KIND-LEGALITY GATE. Both endpoints resolved; are they a shape any
    // repair can rescue? See `UNRESCUABLE_EDGE_SHAPES` for the derivation and
    // for why the set is the provably-unrescuable one rather than a copy of
    // `ALLOWED_EDGES`.
    const fromRaw = kindAtLinkTime.get(from.id) ?? "";
    const toRaw = kindAtLinkTime.get(to.id) ?? "";
    const fromKind = PROJECTED_KIND_AFTER_NORMALISATION[fromRaw] ?? fromRaw;
    const toKind = PROJECTED_KIND_AFTER_NORMALISATION[toRaw] ?? toRaw;
    const illegal =
      UNRESCUABLE_EDGE_SHAPES.has(`${fromKind}->${toKind}`) ||
      // The one edge rule: nothing may point INTO a factor an option acts on.
      (fromKind === "factor" &&
        toKind === "factor" &&
        isOptionControlledFactor(to.id, kindAtLinkTime, provisionalOptionTargets));
    if (illegal) {
      dropped.push({
        claim_index: index,
        claim_kind: claim.claim_kind,
        label,
        reason: "ref_kind_illegal",
        ...(fromRef !== undefined ? { from_ref: fromRef } : {}),
        ...(toRef !== undefined ? { to_ref: toRef } : {}),
        from_kind: fromKind,
        to_kind: toKind,
      });
      return;
    }

    const basisIds = (claim.basis ?? [])
      .filter((i) => Number.isInteger(i) && statedIdByIndex.has(i))
      .map((i) => statedIdByIndex.get(i)!);
    // The EDGE provenance carries the two consumer-required fields; the badge
    // and the basis are unchanged. The basis is the honest reference to the
    // records this link was built on — the record IDS, never their quotes.
    const prov: RecordProvenance = {
      provenance_class: "ai_inferred",
      ...EDGE_ATTRIBUTION.ai_inferred,
      basis: basisIds,
      unbased: basisIds.length === 0,
    };

    // Edge identity includes its endpoints, so two links with the same label
    // between different pairs stay distinct.
    const edgeId = mintUnique(sha8("edge", label, from.id, to.id), usedIds);
    provenance[edgeId] = prov;
    // Recorded per EDGE ID, not per claim index, so pass 3c reads the magnitude of
    // the edge that actually survived rather than re-deriving it from the claim
    // array — the two can diverge once the prune and the option budget have run.
    if (typeof claim.sets_to === "number") setsToByEdgeId.set(edgeId, claim.sets_to);
    edges.push({
      id: edgeId,
      from: from.id,
      to: to.id,
      ...(claim.effect ? { effect_direction: claim.effect } : {}),
      ...(typeof claim.strength === "number" ? { strength_mean: claim.strength } : {}),
      origin: "ai",
      provenance_source: "inferred",
      provenance: prov,
    });
  });

  // ── Pass 3b: DISCLOSE what the model never connected; never force it in. ───
  //
  // MEASURED, and this is the finding the whole slice turned on. A record set is
  // not a graph, and a record the model states but never links is not a graph
  // node: the consumer's `NO_PATH_TO_GOAL` (`graph-validator.ts:620`) requires
  // EVERY node except the decision to reach the goal. On a live draft, 8 of 17
  // projected nodes reached nothing — mostly stated figures the model correctly
  // kept in `stated_items` (the instruction tells it never to drop what the user
  // said) and correctly declined to connect, because they did not bear on the
  // goal. Projecting them anyway manufactured the rejection.
  //
  // There are exactly three things the projector can do with such a record, and
  // two of them are defects:
  //   FORCE IT IN   — place the node and let a repair invent an edge to the
  //                   goal. That is a machine-authored causal claim presented to
  //                   the user as part of their model. The worst option, and it
  //                   is the one that happens by default if we do nothing.
  //   DROP IT       — silently lose something the user said. The second worst.
  //   DISCLOSE IT   — keep the RECORD, leave it off the graph, and say so.
  // Only the third is honest, so it is the only one implemented.
  //
  // ⭐ WHAT IS DELIBERATELY *NOT* PRUNED, because the reasoning differs per kind:
  //   `goal`     — the graph has no meaning without it.
  //   `option`   — an option the user named must appear even if the model failed
  //                to connect it; dropping options also trips
  //                `INSUFFICIENT_OPTIONS` and silently narrows the user's own
  //                choice set, which is the one thing a decision tool may never
  //                do. A disconnected option is the sweep's problem
  //                (`NO_EFFECT_PATH`), and it is a VISIBLE problem.
  //   `decision` — minted below, structural.
  // So the rule bites only on factors and constraints: the derived material,
  // where "we could not place this" is a truthful and useful thing to report.
  //
  // The predicate is the CONSUMER's, derived at its bytes rather than invented
  // here: can this node reach the goal along emitted causal links? Reachability
  // is computed on the reverse graph from the goal, so it is a pure function of
  // the record set and stays deterministic.
  const goalNodes = nodes.filter((n) => n.kind === "goal");
  if (goalNodes.length > 0) {
    const incoming = new Map<string, string[]>();
    for (const e of edges) {
      const list = incoming.get(e.to);
      if (list) list.push(e.from);
      else incoming.set(e.to, [e.from]);
    }
    const reachesGoal = new Set<string>();
    const stack = goalNodes.map((n) => n.id);
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (reachesGoal.has(current)) continue;
      reachesGoal.add(current);
      for (const from of incoming.get(current) ?? []) stack.push(from);
    }

    const unmodelled = nodes.filter(
      (n) => (n.kind === "factor" || n.kind === "constraint") && !reachesGoal.has(n.id),
    );
    if (unmodelled.length > 0) {
      const unmodelledIds = new Set(unmodelled.map((n) => n.id));
      for (const node of unmodelled) {
        // Disclosed through the SAME channel as an unresolvable reference, so a
        // reader has one list to consult rather than two vocabularies for "the
        // projector did not place this" (trap 21).
        dropped.push({
          claim_index: -1,
          claim_kind: node.provenance?.provenance_class === "stated" ? "stated_item" : "claim",
          label: node.label,
          node_id: node.id,
          reason: "unconnected_to_goal",
        });
        delete provenance[node.id];
      }
      // Edges among pruned nodes go with them. An edge whose endpoint is not on
      // the graph is not a partial truth, it is a dangling reference.
      for (const edge of edges.filter((e) => unmodelledIds.has(e.from) || unmodelledIds.has(e.to))) {
        delete provenance[edge.id];
      }
      const keptEdges = edges.filter((e) => !unmodelledIds.has(e.from) && !unmodelledIds.has(e.to));
      edges.length = 0;
      edges.push(...keptEdges);
      const keptNodes = nodes.filter((n) => !unmodelledIds.has(n.id));
      nodes.length = 0;
      nodes.push(...keptNodes);
    }
  }

  // ── Pass 3b: OPTION BUDGET. The projector mints an option per stated option AND
  // per `option_refinement` claim (CLAIM_KIND_TO_NODE_KIND), so the minted count can
  // exceed the validator's `MAX_OPTIONS` even when the user named only two or three
  // things. Measured on the banked corpus: minted options ran 3..7 per set against a
  // bound of 6.
  //
  // Same three-way choice as the connectivity prune, and the same answer: FORCE IT IN
  // (let `INSUFFICIENT_OPTIONS` reject the whole draft) and DROP IT (silently shorten
  // the user's choice set) are both defects; DISCLOSE IT is the honest one. Refinements
  // are surrendered first and in reverse emission order, so the result is deterministic
  // and a stated option is never the thing that goes.
  {
    const optionNodesForBudget = nodes.filter((n) => n.kind === "option");
    if (optionNodesForBudget.length > MAX_PROJECTED_OPTIONS) {
      const isRefinement = (id: string) => provenance[id]?.provenance_class === "ai_inferred";
      const surrenderable = optionNodesForBudget.filter((n) => isRefinement(n.id)).reverse();
      const overBy = optionNodesForBudget.length - MAX_PROJECTED_OPTIONS;
      const surrendered = surrenderable.slice(0, overBy);
      if (surrendered.length > 0) {
        const goneIds = new Set(surrendered.map((n) => n.id));
        for (const node of surrendered) {
          dropped.push({
            claim_index: -1,
            claim_kind: "claim",
            label: node.label,
            reason: "option_budget_exceeded",
          });
          delete provenance[node.id];
        }
        for (const edge of edges.filter((e) => goneIds.has(e.from) || goneIds.has(e.to))) {
          delete provenance[edge.id];
        }
        const keptEdges = edges.filter((e) => !goneIds.has(e.from) && !goneIds.has(e.to));
        edges.length = 0;
        edges.push(...keptEdges);
        const keptNodes = nodes.filter((n) => !goneIds.has(n.id));
        nodes.length = 0;
        nodes.push(...keptNodes);
      }
    }
  }

  // ── Pass 3c: INTERVENTIONS. `sets_to` on an option→factor causal_link is the level
  // that factor takes under that option, and `OptionData.interventions`
  // (`schemas/graph.ts:163`, `z.record(z.string(), z.number())`) is where the analysis
  // reads it. Without this the maths can only compare bare labels.
  //
  // ⭐ THE PROJECTOR INVENTS NOTHING HERE. An entry exists if and only if the model
  // stated a number for that exact option→factor pair; there is no default, no
  // neutral fill and no derivation from `strength` (a different question — see the
  // grammar's note on why the two fields are named apart). A missing magnitude stays
  // missing, and the analysis is entitled to see that it is missing.
  //
  // Built from the SURVIVING edges, after both the connectivity prune and the option
  // budget, so an intervention can never name a factor that is no longer on the graph
  // — a dangling `interventions` key is `INVALID_INTERVENTION_REF` downstream.
  {
    const kindById = new Map(nodes.map((n) => [n.id, n.kind]));
    const interventionsByOption = new Map<string, Record<string, number>>();
    // ⭐⭐ ROOT 2(c) — CANONICAL, NOT POSITIONAL.
    //
    // This was `bucket[edge.to] = setsTo`: an unconditional write, so when two
    // `causal_link` claims set the same option→factor pair to different levels,
    // the one LATER IN CLAIM ORDER silently won. Two record sets identical in
    // every respect except the order of two equivalent claims therefore analysed
    // to DIFFERENT numbers, with nothing dropped and nothing disclosed — the
    // model's emission order, which carries no meaning, was deciding the answer.
    //
    // Candidates are now gathered first and resolved by a rule that reads only
    // their CONTENT, so any permutation of the same claims yields the same
    // projection. Where they disagree, the smallest magnitude wins: among
    // contradictory claims about how far an option moves a factor, that is the
    // least extravagant one, and over-claiming an option's effect is the harm
    // that matters here. `edge.id` (a content hash) breaks an exact tie so the
    // rule is total.
    //
    // ⚠ The choice is CANONICAL, not correct — nothing here can know which claim
    // the user meant. So it is DISCLOSED rather than absorbed: the conflict and
    // the discarded levels are named, which is the difference between a decision
    // and a silent overwrite.
    const candidatesByPair = new Map<string, { edgeId: string; setsTo: number }[]>();
    for (const edge of edges) {
      if (kindById.get(edge.from) !== "option") continue;
      if (kindById.get(edge.to) !== "factor") continue;
      const setsTo = setsToByEdgeId.get(edge.id);
      if (typeof setsTo !== "number" || !Number.isFinite(setsTo)) continue;
      const key = `${edge.from} ${edge.to}`;
      const list = candidatesByPair.get(key) ?? [];
      list.push({ edgeId: edge.id, setsTo });
      candidatesByPair.set(key, list);
    }
    for (const [key, candidates] of [...candidatesByPair.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      const [optionId, factorId] = key.split(" ") as [string, string];
      const ordered = [...candidates].sort(
        (a, b) =>
          a.setsTo - b.setsTo || (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0),
      );
      const chosen = ordered[0]!;
      const rejected = ordered.slice(1).filter((c) => c.setsTo !== chosen.setsTo);
      if (rejected.length > 0) {
        dropped.push({
          claim_index: -1,
          claim_kind: "claim",
          label: nodes.find((n) => n.id === optionId)?.label ?? optionId,
          node_id: optionId,
          reason: "parallel_intervention_conflict",
          intervention_signature: `${factorId}:${[chosen, ...rejected]
            .map((c) => c.setsTo)
            .join("|")}`,
        });
      }
      const bucket = interventionsByOption.get(optionId) ?? {};
      bucket[factorId] = chosen.setsTo;
      interventionsByOption.set(optionId, bucket);
    }
    for (const node of nodes) {
      const built = interventionsByOption.get(node.id);
      // An option with no stated magnitude gets NO `interventions` key at all. An
      // empty object is a sentinel the sweep strips (`deterministic-sweep.ts:494`)
      // and would claim we looked and found nothing, which is not what happened.
      //
      // ⭐ The `undefined` check is the WHOLE check, deliberately. A defensive
      // `Object.keys(built).length === 0` clause stood here and a mutant proved it
      // UNREACHABLE: a bucket is only ever stored after a key has been written to
      // it, so an empty one cannot exist. It was removed rather than left in — an
      // unreachable guard is a branch no test can ever kill, which is the same
      // "guard that cannot fail" shape this module's tests exist to hunt.
      if (built === undefined) continue;
      node.data = { ...(node.data ?? {}), interventions: built };
    }
  }

  // ── Pass 3d: SCALE PROJECTION — one wire scale per request, one frame per
  // factor. See the module-level note above `isPercentScaledUnit` for the full
  // derivation (why unit-interval, why no `cap`, why negatives are left raw).
  // Runs AFTER the connectivity prune, the option budget and pass 3c, so the
  // frame is a function of exactly the magnitudes that survive onto the graph
  // — and stays a pure function of the record set (determinism preserved: the
  // inputs are the surviving nodes, whose derivation is itself deterministic).
  {
    const optionNodes3d = nodes.filter(
      (n): n is ProjectedNode & { data: { interventions: Record<string, number> } } =>
        n.kind === "option" &&
        n.data !== undefined &&
        typeof (n.data as { interventions?: unknown }).interventions === "object" &&
        (n.data as { interventions?: unknown }).interventions !== null,
    );
    for (const factor of nodes) {
      if (factor.kind !== "factor") continue;
      const observed = factor.observed_state as { value?: unknown } | undefined;
      const baseline =
        typeof observed?.value === "number" && Number.isFinite(observed.value)
          ? observed.value
          : undefined;
      const magnitudes: number[] = baseline !== undefined ? [baseline] : [];
      for (const opt of optionNodes3d) {
        const v = opt.data.interventions[factor.id];
        if (typeof v === "number" && Number.isFinite(v)) magnitudes.push(v);
      }
      if (magnitudes.length === 0) continue;
      const unit = (factor.data as { unit?: unknown } | undefined)?.unit;
      const frame = deriveFactorScaleFrame(magnitudes, typeof unit === "string" ? unit : undefined);
      if (frame === undefined) continue;
      if (baseline !== undefined) {
        // The raw user magnitude is KEPT (`raw_value`), never overwritten with
        // the level: the display chain and the edit path's delta operators both
        // read `raw_value` first, so this is what keeps "£50,000" true on
        // screen while the analysis computes on 0.5. Both carriers are written
        // because `schema-v3.ts` rebuilds factor observed_state FROM `data`.
        factor.observed_state = { ...factor.observed_state, value: baseline / frame, raw_value: baseline };
        factor.data = { ...(factor.data ?? {}), value: baseline / frame, raw_value: baseline };
      }
      for (const opt of optionNodes3d) {
        const v = opt.data.interventions[factor.id];
        if (typeof v === "number" && Number.isFinite(v)) {
          opt.data.interventions[factor.id] = v / frame;
        }
      }
    }
  }

  // ── Pass 4: projector-structural topology. See the header's third-class note.
  const optionNodes = nodes.filter((n) => n.kind === "option");
  if (optionNodes.length > 0) {
    // ONE construction site for this class, as the header's mechanism requires —
    // the decision node and its edges share it. The two consumer-required fields
    // are load-bearing on the EDGES (nodes are not validated); carrying them on
    // the node too is honest of a scaffold node and keeps the class to one site.
    const structuralProv: RecordProvenance = {
      provenance_class: "projector_structural",
      ...EDGE_ATTRIBUTION.projector_structural,
    };
    // Identity is derived from the option ids it joins, so the decision node is
    // stable across runs and distinct across different option sets.
    const decisionId = mintUnique(sha8("decision", ...optionNodes.map((n) => n.id)), usedIds);
    provenance[decisionId] = structuralProv;
    // Unshifted so the decision precedes its options in emission order.
    nodes.unshift({
      id: decisionId,
      kind: "decision",
      label: "Decision",
      provenance: structuralProv,
    });
    for (const opt of optionNodes) {
      const edgeId = mintUnique(sha8("edge", "structural", decisionId, opt.id), usedIds);
      provenance[edgeId] = structuralProv;
      edges.push({
        id: edgeId,
        from: decisionId,
        to: opt.id,
        origin: "default",
        provenance_source: "structural",
        provenance: structuralProv,
      });
    }
  }

  // ── Pass 5: THE DEMOTE DISCLOSURES, written once against the FINAL node set.
  // Sorted by claim index so the list is a function of the record set's content
  // and order, never of the round in which a decision happened to fire.
  //
  // ⭐⭐ THE DISCLOSURE IS RE-RESOLVED HERE, NOT COPIED FROM THE DECISION. A
  // survivor recorded in round 1 can be gone by the fixed point — merged into
  // its stated parent, or demoted in its own right — and an id that names
  // nothing is a record the reader cannot follow. So a MODEL survivor is chased
  // by CLAIM INDEX (identity) to whatever node it ended up as, and the chain is
  // followed if that node was itself withdrawn. The walk is bounded by the
  // number of demotes, which is an EXHAUSTION bound: every hop moves to a
  // different demoted claim, and there are finitely many.
  const labelOf = (id: string): string | undefined => nodes.find((n) => n.id === id)?.label;
  const resolveSurvivor = (
    d: DemoteDecision,
  ): { id?: string; label?: string; mergedFrom?: string } => {
    if (d.survivorClaimIndex === undefined) {
      // A stated survivor is on the graph by construction — see the field note.
      return { id: d.survivorId, label: labelOf(d.survivorId) ?? d.survivorLabel };
    }
    let idx = d.survivorClaimIndex;
    for (let hop = 0; hop <= demoted.size; hop++) {
      // Its own minted node, OR — when it merged — the parent it now resolves to.
      const landed = claimIdByIndex.get(idx);
      if (landed !== undefined) {
        return {
          id: landed,
          label: labelOf(landed) ?? d.survivorLabel,
          mergedFrom: landed === d.survivorId ? undefined : d.survivorLabel,
        };
      }
      const next = demoted.get(idx);
      if (next === undefined) break;
      if (next.survivorClaimIndex === undefined) {
        return { id: next.survivorId, label: labelOf(next.survivorId), mergedFrom: d.survivorLabel };
      }
      idx = next.survivorClaimIndex;
    }
    return {};
  };

  for (const decision of [...demoted.values()].sort((a, b) => a.claimIndex - b.claimIndex)) {
    const survivor = resolveSurvivor(decision);
    dropped.push({
      claim_index: decision.claimIndex,
      claim_kind: "option_refinement",
      label: decision.label,
      reason: decision.reason,
      // Emitted only when they name a node on THIS graph. A missing pointer is
      // honest; a dangling one is not.
      ...(survivor.id !== undefined && survivor.label !== undefined
        ? { duplicate_of: survivor.id, duplicate_of_label: survivor.label }
        : {}),
      // The option originally kept, when that option has since merged away — so
      // `undeveloped_duplicate_of_model` still names the model option it
      // duplicated even though `duplicate_of` now points at the node that
      // absorbed it. Two different questions, named apart (trap 21).
      ...(survivor.mergedFrom !== undefined ? { merged_survivor_label: survivor.mergedFrom } : {}),
      intervention_signature: decision.signature,
    });
    // APPEND-ONLY on whatever the survivor RESOLVED to — the merged parent when
    // the survivor merged, which is where a reader will look. Its class and its
    // quote are untouched, so the user's own words remain the only thing badged
    // `stated`; this records that the model offered something the analysis could
    // not distinguish from it.
    const survivorProv = survivor.id === undefined ? undefined : provenance[survivor.id];
    if (survivor.id !== undefined && survivorProv) {
      provenance[survivor.id] = {
        ...survivorProv,
        undeveloped_duplicates: [...(survivorProv.undeveloped_duplicates ?? []), decision.label],
      };
      const survivorNode = nodes.find((n) => n.id === survivor.id);
      if (survivorNode) survivorNode.provenance = provenance[survivor.id];
    }
  }

  // ── meta: derived, in node-emission order (never Set-iteration order).
  const hasIncoming = new Set(edges.map((e) => e.to));
  const hasOutgoing = new Set(edges.map((e) => e.from));

  return {
    optionClaimIndexById,
    graph: {
      version: "1",
      // The frozen default (`schemas/graph.ts` `default_seed: 17`). A projector
      // that minted its own seed would be a non-determinism source AND would
      // fork the graph hash — the exact defect trap 10 was written about.
      default_seed: 17,
      nodes,
      edges,
      meta: {
        roots: nodes.filter((n) => !hasIncoming.has(n.id)).map((n) => n.id),
        leaves: nodes.filter((n) => !hasOutgoing.has(n.id)).map((n) => n.id),
        suggested_positions: {},
        source: "assistant",
      },
    },
    provenance,
    dropped,
  };
}

/**
 * Every MODEL option this projection cannot distinguish from another option,
 * with the decision to withdraw it.
 *
 * ⭐ THE GROUPING IS THE VALIDATOR'S, NOT A RESTATEMENT OF IT. Membership is
 * `data.interventions` present (the validator's own `continue`, :843) and the
 * key is its own exported `buildInterventionSignature`. An option with NO stated
 * magnitude does not participate — the validator skips it, and demoting on a
 * shared absence would withdraw alternatives for a collision that never fires.
 *
 * ⚠ AN OPTION'S CLASS COMES FROM THE PROJECTOR'S PROVENANCE MAP, keyed by minted
 * id (trap 19). Never from its label, its position, or the shape of its data.
 */
function findUndevelopedDuplicates(projection: OneProjection): DemoteDecision[] {
  // ⭐ THE CONSUMER'S OWN PRECONDITION, derived at its bytes rather than
  // inferred from the symptom (13d). `validateSemantic` opens with
  //   `const goals = nodeMap.byKind.get("goal") ?? []; if (goals.length === 0) return issues;`
  // so `OPTIONS_IDENTICAL` CANNOT fire on a goal-less graph. Without this gate
  // the demote would withdraw an option to pre-empt a violation the validator
  // would never raise — a predicate broader than the rule it serves, which is
  // this estate's most-repeated defect shape.
  if (!projection.graph.nodes.some((n) => n.kind === "goal")) return [];

  const groups = new Map<string, { id: string; label: string; claimIndex?: number }[]>();
  for (const node of projection.graph.nodes) {
    if (node.kind !== "option") continue;
    const interventions = (node.data as { interventions?: Record<string, number> } | undefined)
      ?.interventions;
    if (!interventions) continue;
    const signature = buildInterventionSignature(interventions);
    const member = {
      id: node.id,
      label: node.label,
      claimIndex: projection.optionClaimIndexById.get(node.id),
    };
    const list = groups.get(signature);
    if (list) list.push(member);
    else groups.set(signature, [member]);
  }

  // ⚠⚠ ROADMAP 2.1092 — AUDIT FINDING 6 IS **OPEN**, AND THE FIX DOES NOT BELONG
  // HERE. READ THIS BEFORE "FIXING" IT AGAIN.
  //
  // THE DEFECT IS REAL. The grouping key is `buildInterventionSignature` — the
  // VALIDATOR'S own predicate for `OPTIONS_IDENTICAL`, imported rather than
  // restated, which is right. But it sees ONLY interventions, so two options that
  // move the same factors to the same levels group together no matter how
  // differently they behave elsewhere. An audit produced the case: "Launch
  // nationally" and "Launch with an unlicensed pilot" set revenue identically, so
  // they grouped — but the pilot ALSO ran an edge into a regulatory-exposure
  // constraint the national launch never touched. It was withdrawn as an
  // "undeveloped duplicate", and the only representation of that risk went with
  // it. Identical in the one dimension measured; opposite in the one that would
  // have decided between them.
  //
  // ⚠ AND THE OBVIOUS FIX HERE — sparing a candidate that reaches somewhere the
  // survivor does not — WAS IMPLEMENTED, MEASURED, AND REVERTED, because it makes
  // things WORSE. Executed end to end by an independent review at that commit:
  //   1. the projector spares the pilot;
  //   2. both launch options still share one intervention signature;
  //   3. `validateGraph` raises OPTIONS_IDENTICAL;
  //   4. `attemptOptionsIdenticalGracefulDedup` returns **null** — it declines at
  //      guard 3b, the label-distinctness floor
  //      (`options-identical-graceful-dedup.ts:190-196`), and a spared option is
  //      BY CONSTRUCTION structurally distinct and therefore differently
  //      labelled, so the spare routes deterministically into the ONE guard that
  //      refuses to dedup;
  //   5. `options-identical-bypass.ts` emits `CEE_GRAPH_INVALID` — **the draft
  //      fails**, where the merge base shipped a graph.
  // A silent content loss became a hard draft failure, and the spared option
  // reached the wire in NEITHER shape (where the collision arises in pass 2
  // instead, `shouldKeepCompletion` discards the completion and the option never
  // exists). Nothing was bought.
  //
  // ⭐ THE EVIDENCE WAS INSIDE THE FIXTURE ALL ALONG, and this is the lesson worth
  // keeping: `round7-completion-pass05-tie.json`'s own `__PROVENANCE__` records
  // `live_outcome: "FAIL 500 · CEE_GRAPH_INVALID via
  // cee.options_identical.pre_repair_bypass"`. The reassurance attached to the
  // change ("this cannot produce a 500") was contradicted by the banked capture
  // whose expectation was being moved. **Before moving a fixture's expectation,
  // read its provenance block — a captured fixture often records the very outcome
  // you are about to predict.**
  //
  // THE REAL FIX IS DOWNSTREAM, in whichever of these two owns the question:
  // `buildInterventionSignature` (so structurally distinct options do not collide
  // in the first place), or guard 3b (so a structurally distinct group is treated
  // as a legitimate clarification rather than a fail-fast). Both live outside
  // this file. Until one of them lands, this pass demotes as before — a known,
  // rowed, DISCLOSED loss rather than an unknown draft failure.
  const decisions: DemoteDecision[] = [];
  for (const [signature, members] of groups) {
    if (members.length < 2) continue;
    const stated = members.filter(
      (m) => projection.provenance[m.id]?.provenance_class === "stated",
    );
    // A model option is one this projector minted FROM A CLAIM.
    //
    // ⭐⭐ AND THIS IS WHY A STATED OPTION CANNOT BE DEMOTED — by CONSTRUCTION,
    // not by a filter clause someone could delete. Withdrawal works by excluding
    // a CLAIM INDEX from the next projection, and a stated option has none: its
    // node is minted in pass 1 from `stated_items` and never enters
    // `optionClaimIndexById`. There is literally no lever here that removes the
    // user's own alternative. (An explicit `!stated.includes(m)` clause stood
    // here and a reading proved it unreachable for exactly this reason; it was
    // removed rather than left in, because an unreachable guard is a branch no
    // test can kill — the same call this file makes in pass 3c.)
    const model = members.filter((m) => m.claimIndex !== undefined);

    if (stated.length > 0 && model.length > 0) {
      // A USER-STATED OPTION IS NEVER DEMOTED. Every model duplicate goes; the
      // stated one it duplicated is named in the disclosure. Where more than one
      // stated option is in the group, the first in node-emission order is named
      // — the group is already blocking on its own (stated, stated) collision,
      // which this pass deliberately leaves for the user to resolve.
      const survivor = stated[0]!;
      for (const m of model) {
        decisions.push({
          claimIndex: m.claimIndex!,
          label: m.label,
          reason: "undeveloped_duplicate_of_stated",
          survivorId: survivor.id,
          survivorLabel: survivor.label,
          signature,
        });
      }
      continue;
    }
    if (stated.length === 0 && model.length > 1) {
      // Deterministic tie-break, and it is a tie-break rather than a judgement:
      // nothing here knows which of two indistinguishable model options is
      // better, so the earliest-emitted one is kept for reproducibility alone.
      const ordered = [...model].sort((a, b) => a.claimIndex! - b.claimIndex!);
      const survivor = ordered[0]!;
      for (const m of ordered.slice(1)) {
        decisions.push({
          claimIndex: m.claimIndex!,
          label: m.label,
          reason: "undeveloped_duplicate_of_model",
          survivorId: survivor.id,
          survivorLabel: survivor.label,
          // The survivor is a MODEL option, so its address can move — see the
          // field note on `survivorClaimIndex`.
          survivorClaimIndex: survivor.claimIndex!,
          signature,
        });
      }
    }
    // (stated, stated) — and any group with fewer than two withdrawable members
    // — falls through untouched, and OPTIONS_IDENTICAL fires VISIBLY.
  }
  return decisions;
}

/**
 * ⭐⭐ THE PROJECTOR — projection to a FIXED POINT.
 *
 * `projectOnce` is run, its option signatures are compared with the VALIDATOR'S
 * OWN function, and any MODEL option indistinguishable from another is withdrawn
 * and re-projected. The loop repeats because a withdrawal can change what merges
 * (pass 1b), and a merge can change a surviving option's signature — so a
 * collision invisible on the first pass can exist on the second.
 *
 * TERMINATION IS STRUCTURAL: every iteration adds at least one claim index to
 * `demoted`, a demoted claim mints no option and so can never be chosen again,
 * and only claims can be demoted. The bound is therefore the claim count and it
 * is an EXHAUSTION bound, not a truncation — reaching it means every claim has
 * been withdrawn, at which point no option remains to collide.
 *
 * ⚠ WHY HERE AND NOT AT THE REPAIR STAGE. `options-identical-graceful-dedup.ts`
 * dedups colliding options later, and its guard 3b DECLINES whenever the labels
 * differ — because, in its own words, *"with no per-option brief provenance
 * reaching this stage, differently-LABELLED duplicates are the only remaining
 * signal that ≥2 user-traceable alternatives were collapsed onto one signature"*.
 * That decline is right, and it names precisely what is missing there and present
 * here: the projector BUILT the option set and knows which node is the user's.
 * The two stages answer different questions (trap 21), and this one DISCLOSES
 * where the repair stage is deliberately silent.
 */
export function projectRecordsToGraph(
  records: DraftRecordSet,
  /**
   * ⭐ THE BRIEF, AS READ-ONLY EVIDENCE — never a source of values.
   *
   * OPTIONAL, and its absence is FAIL-CLOSED rather than fail-open: with no
   * brief in scope nothing can be tied to it, every stated item binds
   * `unchecked`, and no node earns `from_brief`. A caller that cannot supply the
   * brief gets honest under-claiming, never a badge it did not establish.
   */
  brief?: string,
): RecordProjection {
  const claimCount = (records.claims ?? []).length;
  const demoted = new Map<number, DemoteDecision>();
  let projection = projectOnce(records, demoted, brief);
  for (let pass = 0; pass < claimCount; pass++) {
    const decisions = findUndevelopedDuplicates(projection);
    if (decisions.length === 0) break;
    for (const d of decisions) demoted.set(d.claimIndex, d);
    projection = projectOnce(records, demoted, brief);
  }
  // The internal binding is not part of the contract: consumers get the same
  // three fields they always did.
  return { graph: projection.graph, provenance: projection.provenance, dropped: projection.dropped };
}

/** The determinism-comparison value: one canonical string per projection. */
export function projectionFingerprint(projection: RecordProjection): string {
  return canonicalSerialise({
    graph: projection.graph,
    provenance: projection.provenance,
    dropped: projection.dropped,
  });
}
