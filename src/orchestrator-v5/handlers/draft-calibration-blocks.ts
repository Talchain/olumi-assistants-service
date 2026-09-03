/**
 * draft-calibration-blocks — ONE card, on a draft turn, asking for the single
 * ROOT assumption whose missing level would most change what the model can say.
 *
 * ⭐ THE QUESTION THIS EMITTER ANSWERS: *"of the assumptions this model is
 * standing in for, which ONE is worth putting to the user now?"* It does not
 * answer "is the model complete?", it never blocks analysis, and it asks for
 * exactly one thing at a time.
 *
 * ── WHY, IN THE FOUNDER'S OWN CASE ─────────────────────────────────────────
 * `DIAGNOSIS-LOCKED-2026-09-03.md`: three root factors carried no value, the
 * engine defaulted them, and the product reported 62% / 38% without ever
 * mentioning it. The locked document is equally explicit about what the fix is
 * NOT: *"Requiring a user to fill them would turn strategic reasoning into data
 * entry, which is the opposite of what this product is for."* Eight of the
 * thirteen entities are computed downstream and correctly carry no baseline.
 *
 * So: one question, about the most material gap, with the model still runnable.
 * The shape the locked document prescribes, verbatim:
 *
 *   > "I can give you a directional comparison now, but three assumptions are
 *   > standing in for information you haven't given me. ICP clarity matters
 *   > most — how would you rate your current ICP confidence, even roughly?"
 *
 * ── WHAT WAS ALREADY BUILT, AND IS REUSED RATHER THAN REBUILT ──────────────
 * Nothing in this module is a new subsystem. The ranking is
 * `cee/graph-readiness/missing-root-assumptions.ts`, which itself imports the
 * estate's existing value and prior predicates. The carrier is the same typed
 * `CoachingBlock` its three sibling draft emitters use. `calibration_prompt`
 * is an EXISTING `coaching_kind` with an existing signal code
 * (`GUIDANCE_SIGNAL_CODES.CALIBRATION_PROMPT`) whose only emitter today is
 * `compose/phase3-blocks.ts` — POST-ANALYSIS, from the engine's
 * `decision_quality_prompts`. On the DRAFT path the kind had no emitter at all
 * (swept with `assumption_check` and `bias_signal` as contrast controls, both
 * of which returned live emitters). This adds the missing writer; it does not
 * open a second channel beside one.
 *
 * ── ⛔ IT PROPOSES NO NUMBER, AND THAT IS A RULING, NOT A GAP ───────────────
 * The obvious next step — "let Olumi suggest a provisional range, labelled
 * Olumi-estimated" — is deliberately NOT taken for these factors, and the
 * reason is the founder's own standing ruling, quoted in
 * `cee/provenance/unquantified-factor.ts`: *"Factors without a defensible
 * value, evidence-backed range or explicit defensible prior remain VISIBLY
 * PRESENT but are NOT given invented quantitative values simply so analysis can
 * consume them."*
 *
 * A factor reaches this module ONLY when it has no value AND no informative
 * prior — i.e. exactly when the brief supplied nothing to estimate from. A
 * range proposed there would be an invented number wearing a provenance label.
 * Where a defensible estimate DOES exist the drafting model already encodes it
 * as a narrowed prior, `shouldPreserveModelPrior` recognises it, and this card
 * stays silent about that factor. The estimate/ignorance discrimination is
 * therefore already made, upstream, by the module that owns it.
 *
 * ⭐ PROVENANCE IS PRESERVED BY THE EXISTING PATH, NOT BY A NEW FIELD. An
 * answer routes to `set_factor_value`, which stamps `observed_state.source:
 * "user_override"` (the stamp visible on the founder's own edited factor in the
 * capture). An unanswered factor keeps its ignorance prior and its
 * `value_tier`. User-stated and Olumi-estimated stay distinguishable
 * downstream because neither carrier is touched here.
 *
 * ── ⭐⭐ P8 — NEVER ASK WHAT YOU CANNOT ACCEPT ──────────────────────────────
 * `routing/__tests__/ask-copy-acceptance-pairing.test.ts` makes this a gate,
 * not a slogan, after recovery copy shipped an exemplar shape all three
 * deterministic readers refused. So the phrasing this card offers is MEASURED
 * against the real router, and the measurement changed the copy:
 *
 *     "set ICP Clarity to 40%"    → routes to the value-update path   ✅
 *     "ICP Clarity is about 40%"  → does NOT                          ❌
 *
 * The natural way to ask ("roughly where does it stand today?") invites the
 * second form, which goes nowhere. The card therefore SHOWS the command shape,
 * and `__tests__/draft-calibration-blocks.test.ts` drives
 * `shouldSuppressEditDispatchForValueUpdate` over the copy's own exemplar so
 * the pairing REDs in both directions.
 *
 * ⚠ AND THE HONEST LIMIT OF THAT CLAIM: the gate proves the message leaves the
 * fragile `edit_graph` JSON route and reaches the tool-use path that owns
 * `set_factor_value`. The final hop is a model call, so this is a claim about
 * ROUTING, not a guarantee of binding. It is the same claim the estate's other
 * ask-copy pairing makes, and it is stated at its true strength.
 *
 * ── ⛔ NO ACTION CHIP, for two derived reasons ──────────────────────────────
 *  1. `action_prompt` is the message the chip SENDS. The only message that
 *     would advance this ask is `set <factor> to <figure>` — and this module
 *     does not have the figure, and may not invent one. A chip carrying a
 *     made-up percentage is the fabrication class the whole lane exists to
 *     remove.
 *  2. The sibling precedent (`draft-framing-blocks.ts`) records that an
 *     `action_label` WITHOUT an `action_prompt` renders an inert `<span>`, so
 *     "no prompt" means "no label" too.
 * The card asks; the user answers in chat, on the route measured above.
 *
 * ── PERCENTAGES, NEVER 0-1 ─────────────────────────────────────────────────
 * `routing/missing-value-answer.ts` carries the founder's ruling of 30 Aug
 * 2026: *a strategic user must never be asked to understand Olumi's internal
 * normalised coefficient scale.* The copy therefore names a 0% to 100% scale
 * and never `0.4`, even though the router accepts both.
 *
 * ── FAIL-CLOSED GATES, in order ────────────────────────────────────────────
 *   1. no ranked unquantified root                  → []
 *   2. the top-ranked factor has no usable label    → []
 *   3. `gateCoachingCardBody` rejects title or body → []  (see below)
 *   4. the block fails `CoachingBlockSchema`        → []
 *
 * ⚠ THERE IS NO LENGTH CHECK OF THIS MODULE'S OWN, AND THERE WAS ONE UNTIL A
 * MUTANT PROVED IT INERT. It read `if (body.length > 300) return []` — a
 * hand-copied restatement of a cap that `gateCoachingCardBody` and
 * `CoachingBlockSchema` BOTH already enforce (measured: the schema rejects a
 * 301-character body). Deleting it changed no behaviour on any test, which is
 * the definition of a mirror rather than a guard, and this module's own header
 * lectures about exactly that. The length authority is the contract's.
 *
 * ── GATE 3 IS THE INTERESTING ONE, AND IT IS NOT A LENGTH CHECK ────────────
 * The exemplar must carry the factor's label EXACTLY, or `set <label> to 40%`
 * resolves nothing and the card breaks P8. So the body is NEVER TRUNCATED —
 * the title is, because it carries no command, and the body is not. A body
 * that does not fit whole is rejected by `gateCoachingCardBody`'s `too_long`
 * and the card is not emitted. On the founder's capture that
 * rule has a real consequence worth stating rather than discovering later — the
 * second-ranked factor is labelled with a 117-character sentence fragment
 * ("which we believe is partly driven by product quality and…"), whose body
 * measures 467 against a 300 budget, and a card asking a user to `set` that
 * would be absurd. The fail-closed budget removes it with no label-quality
 * heuristic at all, which is the right owner boundary: entity quality is a
 * different lane's defect and this module does not guess at it.
 *
 * ⚠ THE BUDGET IS TIGHT AND THE FIRST DRAFT OF THIS COPY MISSED THE FLAGSHIP
 * CASE. An earlier, wordier body measured 310 on the founder's own top-ranked
 * factor, so the one model this lane exists to serve emitted NOTHING — a dark
 * ship with a green derivation behind it. It was caught only by running the
 * emitter over the committed capture, which is why `__tests__` asserts the
 * BLOCK, on the real fixture, and not merely the ranking.
 *
 * ⚠ AND THE COST OF THAT CHOICE, NAMED: when the TOP-ranked factor is the one
 * with the unusable label, this emitter is SILENT rather than falling through
 * to the runner-up. Falling through would ship the sentence "it carries the
 * most weight towards your goal" about a factor for which it is false, and a
 * false sentence on a card is the exact defect class `DIAGNOSIS-LOCKED`
 * addendum B is about. Silence is the honest failure direction here.
 *
 * ── SCOPE — the draft turn only, and this is a boundary, not an oversight ──
 * The emitter runs where the three sibling draft emitters run. It does not
 * re-ask on later conversational turns, so after the user answers, the NEXT
 * most material gap is surfaced on the next draft rather than immediately.
 * Carrying the ask across ordinary turns needs a pending action resumed in
 * `turn-executor.ts`, which is owned by another lane's open PR at the time of
 * writing. Stated here so the next session inherits the boundary rather than
 * the impression that this is the whole loop.
 */

import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import {
  deriveMissingRootAssumptions,
  type MissingRootAssumption,
} from '../../cee/graph-readiness/missing-root-assumptions.js';
import { gateCoachingCardBody } from '../coaching/copy-quality-gate.js';
import { deterministicBlockId } from '../compose/block-id.js';
import { guidanceSignalsForCoachingKind } from '../compose/guidance-signals.js';

/** Namespace for the signal id this module mints. One per factor. */
export const DRAFT_CALIBRATION_SIGNAL_PREFIX = 'draft_calibration:root_level:';

/**
 * The title cap. It is a mirror of `CoachingBlockSchema`'s (module-private)
 * bound, and it is here ONLY because truncation needs a number to truncate to —
 * a length no downstream authority can supply. The mirror is CONTAINED: the
 * final schema parse re-checks the whole block, so a drift drops the card
 * rather than shipping an over-long title.
 *
 * There is deliberately no BODY twin. The body is never truncated, so nothing
 * here needs its cap, and restating it bought nothing — see the header.
 */
const TITLE_BUDGET = 80;

/**
 * The illustrative figure in the command exemplar.
 *
 * ⚠ IT IS A SHAPE, NEVER A SUGGESTION, and the copy frames it as one ("for
 * example"). It is deliberately a mid-scale figure rather than an anchor: "set
 * X to 0%" reads as an instruction to zero the factor, which is the opposite of
 * an illustration. The scale anchors are stated separately in the same
 * sentence, following `missing-value-answer.ts`'s hint, which names its anchors
 * rather than leaving the reader to infer the range.
 */
const EXEMPLAR_FIGURE = '40%';

/**
 * The exemplar a user could type, built from the factor's OWN label.
 *
 * Exported so the P8 pairing spec drives the REAL router over the REAL bytes
 * this card ships, rather than over a second spelling that could drift from it
 * (CLAUDE.md trap 12 — the copy and the guard must read the same string).
 */
export function calibrationAnswerExemplar(factorLabel: string): string {
  return `set ${factorLabel} to ${EXEMPLAR_FIGURE}`;
}

/** Truncate at a word boundary; never mid-word, never past the budget. */
function truncateAtWordBoundary(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cut = text.slice(0, budget);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

/**
 * The card's body.
 *
 * Four things, in this order, and each is load-bearing:
 *   1. what is missing and that the model is standing in for it;
 *   2. why THIS one (only claimed when there is more than one — with a single
 *      gap "it carries the most weight" is a comparison against nothing);
 *   3. the ask, in a shape the router accepts, with the scale named;
 *   4. that analysis is still available — the card is an offer, not a blocker.
 */
export function buildCalibrationBody(top: MissingRootAssumption, total: number): string {
  const exemplar = calibrationAnswerExemplar(top.factor_label);
  const ask =
    `Give it a level, for example "${exemplar}" on a 0% to 100% scale. `
    + `I can still compare your options meanwhile.`;
  if (total <= 1) {
    return (
      `This model is leaning on one assumption you have not given a level for, `
      + `so it is working from a placeholder. ${ask}`
    );
  }
  // "matters most" is the RANKING's own claim, and its referent is the set the
  // previous sentence just named — the assumptions with no level. It is the
  // locked diagnosis's own wording ("ICP clarity matters most") and it is
  // measured, not asserted: the spec pins it against the derived order.
  return (
    `This model is leaning on ${total} assumptions you have not given a level for, `
    + `so it is working from placeholders. ${top.factor_label} matters most. ${ask}`
  );
}

export interface BuildDraftCalibrationBlocksParams {
  /**
   * The drafted graph, in either edge vocabulary. The SOLE input to the
   * ranking — no readiness gate, deliberately: an unquantified root is equally
   * worth asking about whether or not the model happens to be runnable, and the
   * founder's model WAS runnable. Gating on readiness is what left this
   * population unserved.
   */
  readonly graph: unknown;
  /** ISO-8601 timestamp with offset, stamped on the emitted block. */
  readonly createdAt: string;
}

/**
 * Build at most one root-calibration coaching block. Pure, never throws,
 * returns `[]` on every doubt.
 */
export function buildDraftCalibrationBlocks(
  params: BuildDraftCalibrationBlocksParams,
): CoachingBlock[] {
  const { graph, createdAt } = params;

  // Gate 1.
  const { ranked } = deriveMissingRootAssumptions(graph);
  const top = ranked[0];
  if (top === undefined) return [];

  // Gate 2. A factor with no label cannot be named in an ask, and cannot be
  // named in a command the router could resolve.
  if (top.factor_label.length === 0) return [];

  const title = truncateAtWordBoundary(`Give ${top.factor_label} a level`, TITLE_BUDGET);
  // ⚠ NOT TRUNCATED. See the header: a shortened exemplar is an ask this
  // product cannot accept, so an over-long body must be refused, never trimmed.
  const body = buildCalibrationBody(top, ranked.length);

  // Gate 3 — on the EXACT bytes that ship, and the ONLY length authority this
  // module invokes. A label that leaks a slug-shaped id, uses graph-shape
  // wording, or pushes the body past the card cap drops the card rather than
  // being rewritten: rewriting the product's own account of a user's model
  // would be its own dishonesty.
  //
  // ⭐ TITLE AND BODY ARE GATED SEPARATELY AND THAT IS NOT REDUNDANT. The title
  // is truncated first, so an offending token near the end of a long label is
  // cut out of the title and survives in the body. The suite drives exactly
  // that divergence, with the body-under-cap precondition asserted, so this
  // line REDs on its own rather than leaning on its neighbour.
  if (!gateCoachingCardBody(title).accept) return [];
  if (!gateCoachingCardBody(body).accept) return [];

  const signalId = `${DRAFT_CALIBRATION_SIGNAL_PREFIX}${top.factor_id}`;

  const candidate: CoachingBlock = {
    block_id: deterministicBlockId(signalId),
    signal_id: signalId,
    created_at: createdAt,
    source_handler: 'draft_graph',
    freshness: 'fresh',
    type: 'coaching',
    coaching_kind: 'calibration_prompt',
    title,
    body,
    source: 'draft_graph',
    // ⭐ UNLIKE THE FRAMING SIBLING, THIS CARD NAMES A REAL CANVAS ENTITY, so
    // the ref resolves and the UI can mark the factor the question is about.
    // The sibling ships `[]` because a goal not yet reframed has no node; here
    // the node is the whole subject of the ask.
    target_refs: [{ id: top.factor_id, label: top.factor_label, kind: 'factor' }],
    // ⚠ NOT A FORMALITY — the sibling emitters' measured lesson, inherited
    // rather than re-derived: coaching sits in the UI's PHASE3_CARD_TYPES with
    // PHASE3_DEFAULT_EXPANDED = 6 against live counts of 8-14 cards per turn,
    // so a card ranked 7th or later collapses behind "Show N more" and renders
    // NULL. Rank 1 is the difference between shipping and dark-shipping.
    priority_rank: 1,
    // Producer-owned guidance signals, derived from the kind, never hand-typed.
    ...guidanceSignalsForCoachingKind('calibration_prompt'),
    // No action chip. See the header — there is no honest `action_prompt`
    // available, and a label without a prompt renders inert.
  } as CoachingBlock;

  // Gate 4 — fail closed rather than hand egress a block it drops whole. Also
  // the contract's own length authority; see the header.
  if (!CoachingBlockSchema.safeParse(candidate).success) return [];

  return [candidate];
}
