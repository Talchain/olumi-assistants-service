/**
 * ⭐⭐ THE R1 DISCLOSURES REACH THE USER — THE V5 TURN HOP.
 *
 * ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 * The record projector refuses to invent: it will not guess a constraint's
 * direction, will not pick between contradictory intervention levels, will not
 * pretend a stated target became a goal threshold. Every refusal is recorded in
 * `projection.dropped[]` and rides the R1 channel adapter → parse → package →
 * V3 boundary as `record_disclosures`.
 *
 * **And the V5 turn — the path a user's browser actually renders — never saw
 * any of it.** `orchestrator/tools/draft-graph.ts` rebuilds its result as a
 * FRESH OBJECT LITERAL from named keys off the pipeline body, so the field died
 * at the tool boundary with nothing to catch it: `handleDraftGraph`'s
 * `DraftGraphResult` is a DIFFERENT interface from the adapter's same-named one
 * (`adapters/llm/types.ts:80`), and only the adapter's declares the field. Two
 * same-named types, one silent drop — the estate's twins defect.
 * `r1-disclosure-carrier.e2e.test.ts` names the hop and its measured cost:
 * the count goes **56 → 0** downstream of everything that file covers. Its own
 * verdict was *"reaches the CEE V3 wire" — never "reaches the user"*.
 *
 * ── WHY THIS FILE ADDS NO NEW AUTHORITY ────────────────────────────────────
 * `model_building_notices` is NOT minted here. It is an EXISTING, PUBLISHED
 * field on `OlumiResponseSchema` (`@talchain/schemas` 0.48.0,
 * `boundary/olumi-response.d.ts:2228`) that CEE has never once written — a
 * canonical carrier with zero producers. Derived 2026-08-19 at the vendored
 * contract: `model_building_notices` appears in 0 files under `src/`, while the
 * contrast controls `analysis_state` (48 files) and `decision_classification`
 * (2) are live. So this is the missing WRITER for an owner that already exists,
 * not a second channel beside one.
 *
 * There is exactly ONE source of truth — `projection.dropped[]` — and it is
 * read here in the form it already ships (`record_disclosures`). The notices
 * are an AGGREGATION of that array, never a re-derivation from somewhere else,
 * so the two surfaces cannot drift into disagreeing about what was refused.
 *
 * ── WHY COUNTS AND NOT TEXT ────────────────────────────────────────────────
 * Not a choice this file gets to make: the contract pins `details_redacted` to
 * the LITERAL `true`. The user's own words stay off this channel by design; the
 * detailed, node-anchored form remains `record_disclosures` on the V3 surface.
 * What the turn carries is the honest shape of the loss — how many, of what
 * kind — which is what a "your model is quieter than your brief" affordance
 * needs and is all the contract admits.
 *
 * ── THE MAPPING IS EXHAUSTIVE BY CONSTRUCTION ──────────────────────────────
 * `NOTICE_KIND_BY_REASON` is typed `Record<DroppedRecordRef["reason"], …>`, so
 * a reason added to the producer's union WILL NOT COMPILE until it is given a
 * kind here. That is a DERIVED guard against the producer, not a hand-kept
 * mirror of it (trap 12): the one thing a hand-written list cannot do is notice
 * that the list is short, and the type system does exactly that here.
 *
 * Every entry is mapped from the PRODUCER's declared semantics — its own doc
 * comments at `projector.ts:348-527` — never from this author's reading of what
 * a name ought to mean (trap 13c: a mutant kit measures whether a test can
 * detect a change, never whether the expectation is right).
 *
 * ⚠ AND WHERE THE PRODUCER'S SEMANTICS DO NOT CLEANLY MATCH A KIND, THE ANSWER
 * IS `other`, NOT THE NEAREST-LOOKING LABEL. `option_budget_exceeded` is the
 * case in hand: an option was left OFF to stay inside `MAX_OPTIONS`, which is
 * not a consolidation — nothing was merged into anything. Calling it
 * `alternative_consolidated` would tell the user their alternatives were
 * combined when in fact one was dropped. A coarse-but-true bucket beats a
 * specific-but-false one on a channel whose entire purpose is telling the truth
 * about what was lost.
 */

import type { ModelBuildingNoticeKind, ModelBuildingNotices } from "@talchain/schemas/boundary";
import type { DroppedRecordRef } from "./projector.js";

/**
 * Producer reason → contract kind. Exhaustive over the projector's union by
 * TYPE, so the compiler is the completeness check.
 *
 * The justification beside each group is the producer's own, quoted from its
 * declaration site; where this file's reading and the producer's wording could
 * diverge, the producer wins.
 */
export const NOTICE_KIND_BY_REASON: Record<
  DroppedRecordRef["reason"],
  ModelBuildingNoticeKind
> = {
  // ── A RELATIONSHIP THE MODEL ASSERTED WAS NOT USED ────────────────────────
  // Each of these is a LINK that did not make it onto the graph. The reference
  // was malformed, unresolvable, ambiguous, self-referential, an illegal kind
  // pair, or pointed at a record the projector had already withdrawn. In every
  // case the user-visible fact is the same: a stated relationship is not in the
  // model.
  unparseable_ref: "relationship_not_used",
  ref_out_of_range: "relationship_not_used",
  ref_target_not_a_node: "relationship_not_used",
  self_loop: "relationship_not_used",
  missing_ref: "relationship_not_used",
  // "BOTH namespace fields of one endpoint were present … the projector has no
  // basis for preferring either, so it refuses and discloses."
  ambiguous_ref: "relationship_not_used",
  // "Both endpoints resolved, but their node KINDS cannot form a legal edge
  // under any repair the pipeline performs."
  ref_kind_illegal: "relationship_not_used",
  // "A link whose endpoint was demoted above. The reference itself was
  // well-formed … NOT reported as an unresolved reference." Named apart at the
  // producer for a reason that does not change its user-facing class: the link
  // is not in the model.
  endpoint_demoted_duplicate: "relationship_not_used",

  // ── A DETAIL FROM THE BRIEF IS NOT CONNECTED TO THE DECISION ──────────────
  // "The record was projected as a node and then withdrawn because nothing the
  // model emitted connects it to the goal."
  unconnected_to_goal: "detail_not_connected",
  // "THE PROJECTOR'S OWN GATE DISCONNECTED THIS RECORD — not the model." The
  // producer separates the two so it never blames the model for our refusal;
  // the user-facing fact is identical (the detail is not connected), and the
  // contract has no kind that distinguishes cause. Kept together deliberately
  // rather than split into `other`, which would say less that is true.
  disconnected_by_shape_gate: "detail_not_connected",

  // ── AN ALTERNATIVE WAS FOLDED INTO ANOTHER ────────────────────────────────
  // "a refinement OF that option, not a second alternative. The projector binds
  // it to the parent's node instead of minting a competing option."
  refinement_merged_into_stated_option: "alternative_consolidated",
  // "The model's one is withdrawn from the option set and DISCLOSED here,
  // naming the stated option it duplicated."
  undeveloped_duplicate_of_stated: "alternative_consolidated",
  // "Two MODEL options with identical signatures … The lowest claim index is
  // kept … and the rest are disclosed here."
  undeveloped_duplicate_of_model: "alternative_consolidated",

  // ── A CONFLICT WAS RESOLVED WITHOUT INVENTING AN ANSWER ───────────────────
  // "Two or more parallel `causal_link` claims set the SAME option→factor pair
  // to DIFFERENT levels. One was chosen canonically; the others are named here
  // rather than silently overwritten."
  parallel_intervention_conflict: "conflict_resolved_conservatively",
  // "THE EDGE-LEVEL TWIN … the SAME `from → to` pair with DIFFERENT `strength`.
  // One is chosen canonically; the others are named here."
  parallel_causal_link_conflict: "conflict_resolved_conservatively",
  // "A `constraint` carried a value but no `direction`, so no operator was
  // asserted. The node keeps the user's words; the THRESHOLD is withheld until
  // the direction is known. This is the ask, not a loss." The projector
  // declined to assert rather than guessing a direction — the conservative
  // resolution of an ambiguity, which is what this kind names.
  constraint_direction_unstated: "conflict_resolved_conservatively",

  // ── A STATED TARGET IS NOT MODELLED AS A THRESHOLD ────────────────────────
  // "It is on the graph as the user's own words, but it is NOT yet a goal
  // threshold — so nothing downstream should read it as a level that has been
  // ACHIEVED."
  stated_target_not_represented_as_threshold: "target_not_modelled_as_threshold",
  // "THE WORSE HALF … that number reached the graph NOWHERE … 'cut churn to 8%'
  // lands as a label with the 8 discarded." Same user-facing claim — the target
  // is not a threshold — and the producer keeps them apart because the detailed
  // V3 channel can say which; this channel cannot.
  stated_target_value_dropped: "target_not_modelled_as_threshold",

  // ── HONESTLY UNCLASSIFIED ─────────────────────────────────────────────────
  // "The projected option set exceeded `MAX_OPTIONS` … and this refinement was
  // left off the graph to bring it inside the bound." Left OFF, not merged —
  // see the file header for why this is not `alternative_consolidated`.
  option_budget_exceeded: "other",
  // ⭐ A `factor` claim restating a stated `cause` was folded into it. NOT
  // `alternative_consolidated`: the user's ALTERNATIVES were not consolidated —
  // nothing in their choice set was touched at all. What merged was the model's
  // own restatement of an explanation the user gave, into the user's words for
  // it. Per this file's header rule, the answer when no specific kind is TRUE is
  // the coarse-but-true bucket, never the nearest-looking label.
  factor_merged_into_stated_cause: "other",
};

/** The kinds in the order they are emitted — stable, so the wire is stable. */
const KIND_ORDER: readonly ModelBuildingNoticeKind[] = [
  "detail_not_connected",
  "relationship_not_used",
  "alternative_consolidated",
  "conflict_resolved_conservatively",
  "target_not_modelled_as_threshold",
  "other",
];

/**
 * Aggregate the R1 disclosures into the contract's notices object.
 *
 * @param disclosures  The `record_disclosures` array as it ships on the V3
 *                     body. Typed `unknown` because that is how it arrives at
 *                     the tool boundary (`pipelineResult.body` is
 *                     `Record<string, unknown>`); a non-array is treated as
 *                     "nothing to say", never as an error.
 * @param omittedCount `record_disclosures_omitted` — entries the V3 transform
 *                     could not render. They were still REFUSED, so they are
 *                     counted here under `other` rather than vanishing. A
 *                     channel that quietly loses part of its payload reads
 *                     exactly like one that had nothing to say.
 *
 * @returns `undefined` when nothing was refused — the ONLY legal representation
 *          of that, not a stylistic choice. The contract cannot encode zero:
 *          `total_count` is a positive integer and `groups` requires at least
 *          one entry, so a zeroed object is not a weaker signal but an INVALID
 *          carrier. In the contract's own words: *"Omission means no notice
 *          attestation was supplied (including every legacy producer), never
 *          zero."* Consumers fail closed on absence and render nothing.
 */
export function buildModelBuildingNotices(
  disclosures: unknown,
  omittedCount?: unknown,
): ModelBuildingNotices | undefined {
  const counts = new Map<ModelBuildingNoticeKind, number>();
  let total = 0;

  const bump = (kind: ModelBuildingNoticeKind): void => {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    total += 1;
  };

  if (Array.isArray(disclosures)) {
    for (const raw of disclosures) {
      if (!raw || typeof raw !== "object") {
        // Unreadable entry. It is still a refusal — count it rather than drop
        // it, for the same reason the V3 transform counts rather than throws.
        bump("other");
        continue;
      }
      const reason = (raw as { reason?: unknown }).reason;
      if (typeof reason !== "string") {
        bump("other");
        continue;
      }
      // A reason the table does not know is `other`, never a guess. The typed
      // table makes this unreachable from the current producer; it stays
      // because this function's input is `unknown` and a wire value is not
      // bound by our types.
      bump(NOTICE_KIND_BY_REASON[reason as DroppedRecordRef["reason"]] ?? "other");
    }
  }

  if (typeof omittedCount === "number" && Number.isFinite(omittedCount) && omittedCount > 0) {
    const whole = Math.floor(omittedCount);
    counts.set("other", (counts.get("other") ?? 0) + whole);
    total += whole;
  }

  if (total === 0) return undefined;

  return {
    total_count: total,
    groups: KIND_ORDER.filter((kind) => (counts.get(kind) ?? 0) > 0).map((kind) => ({
      kind,
      count: counts.get(kind) as number,
    })),
    details_redacted: true,
  };
}
