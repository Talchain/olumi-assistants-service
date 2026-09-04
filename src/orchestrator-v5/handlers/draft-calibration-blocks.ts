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
 * answer routes to `set_factor_value`, which writes the user-edit provenance
 * onto `observed_state.source` — the stamp visible on the founder's own edited
 * factor in the capture. An unanswered factor keeps its ignorance prior and its
 * `value_tier`. User-stated and Olumi-estimated stay distinguishable downstream
 * because neither carrier is touched here.
 *
 * ⚠ THIS MODULE IS NOT A WRITER OF THAT STAMP AND MUST NOT BECOME ONE. It never
 * touches `observed_state`; it only asks. The sentence above deliberately names
 * the field rather than quoting the literal, because
 * `cee/transforms/__tests__/no-brief-derived-user-override.writers.test.ts`
 * scans every non-test `src/` file for that literal and demands a reviewed
 * entry — and its manifest is a list of WRITERS AND READERS. Adding a module
 * that merely mentions the stamp in prose would dilute a guard that exists to
 * stop the product claiming a brief-derived number as the user's own.
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
 * ⭐⭐ AND THE PAIRING IS ENFORCED AT EMIT TIME, NOT ONLY IN A SPEC. The card
 * asks the router whether its OWN exemplar routes, and stays silent when it
 * does not. A spec can only ever check the labels its fixtures happen to
 * carry; the emitter meets every label a real model produces.
 *
 * That gate is not theoretical — it FIRES, and finding out why changed this
 * module. The router's object window is `\S+(?:\s+\S+){0,5}`
 * (`value-update-gate.ts`), so `set <label> to 40%` resolves for a label of at
 * most six tokens (seven with a leading article). A seven-word label passes
 * every copy check, fits the card, reads perfectly — and goes nowhere. The
 * first version of this module would have shipped that ask; the spec caught it
 * on a hand-built label, and the fix is this gate rather than a longer spec.
 *
 * ⚠ AND THE HONEST LIMIT OF THE CLAIM: the gate proves the message leaves the
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
 *   3. the router refuses the card's own exemplar   → []  (P8, above)
 *   4. `gateCoachingCardBody` rejects title or body → []  (see below)
 *   5. the block fails `CoachingBlockSchema`        → []
 *
 * ⚠ THERE IS NO LENGTH CHECK OF THIS MODULE'S OWN, AND THERE WAS ONE UNTIL A
 * MUTANT PROVED IT INERT. It read `if (body.length > 300) return []` — a
 * hand-copied restatement of a cap that `gateCoachingCardBody` and
 * `CoachingBlockSchema` BOTH already enforce (measured: the schema rejects a
 * 301-character body). Deleting it changed no behaviour on any test, which is
 * the definition of a mirror rather than a guard, and this module's own header
 * lectures about exactly that. The length authority is the contract's.
 *
 * ── GATE 4 IS THE INTERESTING ONE, AND IT IS NOT A LENGTH CHECK ────────────
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
 * ── ⭐⭐ AND THE SAME STANDARD, APPLIED TO THE CARD'S OWN SUPERLATIVE ────────
 * The rule above refuses a runner-up because the sentence would be false about
 * the factor named. A TIE is the same false sentence reached by another route:
 * on equal materiality `ranked[0]` is whichever `factor_id` sorts first — a
 * STRING SORT — and "X matters most" reports that coin flip as a fact about
 * the model. The first version of this module shipped exactly that, and it was
 * not a corner case: it is the ENRICHER'S DEFAULT OUTPUT SHAPE (see
 * `buildCalibrationBody`), so the flagship separated model was the exception
 * and the tie was the rule.
 *
 * The resolution is NOT this module's usual silence, and the departure is
 * deliberate. Silence would have dropped the card on the commonest real model
 * shape — a dark ship of the whole feature. The defect is the RANKING CLAIM,
 * not the ask, so the tie body drops the claim and keeps the ask: the count is
 * still true, the named factor is still one of the gaps, and the command is
 * still routable. Both directions are pinned in `__tests__` (a tie must drop
 * it; a genuine separation, including the founder capture, must keep it).
 *
 * ── ⚠ A KNOWN, UNCLOSED GAP, RECORDED RATHER THAN QUIETLY FIXED ────────────
 * A factor LABELLED with " to " in it — "Time to Value", "Lead to Customer
 * Rate" — produces the exemplar `set Time to Value to 40%`, which the router
 * accepts (measured: `true`) but whose OBJECT BOUNDARY is ambiguous: the same
 * separator appears twice.
 *
 * It is not closed here, and the reasoning is recorded so the next reader
 * finds a decision rather than an oversight. This module's claim is ROUTING,
 * not binding (stated at its true strength above), and the binder is a model
 * call on the tool-use path that owns `set_factor_value`. The one-line fix —
 * refuse any label containing the separator — would suppress the card for a
 * COMMON and legitimate label class in this domain, which is a measured cost,
 * against a mis-binding nobody has yet measured at the binder. Quoting the
 * label in the exemplar instead would change the shipped command shape for
 * EVERY card and must be re-measured against the real router first. Either way
 * the owner is the binding hop, not this emitter.
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
import { shouldSuppressEditDispatchForValueUpdate } from '../../orchestrator/routing/value-update-gate.js';
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
 * The card's body, from the WHOLE ranked list.
 *
 * Four things, in this order, and each is load-bearing:
 *   1. what is missing and that the model is standing in for it;
 *   2. why THIS one — only when the ranking can actually support it (see the
 *      tie rule below);
 *   3. the ask, in a shape the router accepts, with the scale named;
 *   4. that analysis is still available — the card is an offer, not a blocker.
 *
 * ⭐⭐ IT TAKES THE LIST, NOT `(top, total)`, AND THAT IS THE FIX'S SHAPE.
 * Whether the superlative may be spoken is a property of `ranked[0]` VERSUS
 * `ranked[1]`, so it is DERIVED here from the only object that carries both
 * (CLAUDE.md trap 12). The rejected alternative was a `sharesLead: boolean`
 * parameter — a mirror of a comparison, which a second caller could compute
 * differently and which nothing would catch.
 */
export function buildCalibrationBody(ranked: readonly MissingRootAssumption[]): string {
  const top = ranked[0];
  // Not reachable through the emitter (gate 1 returns first) — an empty string
  // is refused by `gateCoachingCardBody`'s `too_short`, so a direct caller
  // gets silence rather than a half-built sentence.
  if (top === undefined) return '';

  const exemplar = calibrationAnswerExemplar(top.factor_label);
  const offer =
    `for example "${exemplar}" on a 0% to 100% scale. `
    + `I can still compare your options meanwhile.`;
  const total = ranked.length;

  if (total <= 1) {
    return (
      `This model is leaning on one assumption you have not given a level for, `
      + `so it is working from a placeholder. Give it a level, ${offer}`
    );
  }

  const gap =
    `This model is leaning on ${total} assumptions you have not given a level for, `
    + `so it is working from placeholders. `;

  // ⭐⭐ THE SUPERLATIVE IS EARNED, NEVER ASSUMED — AND ON A TIE IT IS NOT
  // EARNED. `ranked[0]` on equal materiality is whichever `factor_id` sorts
  // first, which is a STRING SORT; "matters most" would turn a tie-break into
  // a statement about the model, false about the factors it silently demotes.
  //
  // ⚠ AND THE TIE IS THE ENRICHER'S DEFAULT OUTPUT SHAPE, not a corner.
  // `factor-extraction/enricher.ts` gives every factor it adds ONE outgoing
  // edge at `strength_mean: 0.5, defaulted: true` pointed at
  // `findConnectionTarget`'s `candidates[0].id`, so any two enrichment-added
  // unquantified factors tie EXACTLY, by construction. (Measured on a live
  // draft the same day: the deployed product added generic factors labelled
  // "Spend" and "Value" on precisely that path.)
  //
  // ⛔ WHY NOT SILENCE. Silence is this module's answer to five other doubts,
  // and it is the wrong one here: on the population above it would drop the
  // card entirely, which is a dark ship of the whole feature rather than a
  // conservative one. The defect is the RANKING CLAIM, not the ask — so only
  // the claim goes, and the card still names one gap and offers a routable
  // command. The body is 17 characters SHORTER this way, so the choice also
  // costs no budget (pinned in `__tests__`).
  //
  // ⚠ THE LIMIT OF `===`, NAMED RATHER THAN PAPERED OVER. It catches the
  // population that ties by construction — identical defaulted edges produce
  // bit-identical sums. It does NOT catch a near-tie reached by different
  // arithmetic (0.5 vs 0.50000000001), where the superlative is still weak.
  // An epsilon would be an invented tolerance with a cliff either side of it,
  // so the comparison is exact and the residue is recorded here.
  const leaderIsShared = ranked[1]!.materiality === top.materiality;
  if (leaderIsShared) {
    return `${gap}Give ${top.factor_label} a level, ${offer}`;
  }

  // "matters most" is the RANKING's own claim, and its referent is the set the
  // previous sentence just named — the assumptions with no level. It is the
  // locked diagnosis's own wording ("ICP clarity matters most") and it is
  // measured, not asserted: the spec pins it against the derived order, in
  // BOTH directions (a tie must drop it; a real separation must keep it).
  return `${gap}${top.factor_label} matters most. Give it a level, ${offer}`;
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
  // Gate 3 — P8, ENFORCED HERE AND NOT ONLY IN A SPEC. `route-v2` uses this
  // exact predicate to decide whether a message reaches the tool-use path that
  // owns `set_factor_value`, so asking it about the card's own exemplar is the
  // product checking that it can hear its own question. A label the router
  // cannot resolve (its object window is six tokens) yields silence.
  if (!shouldSuppressEditDispatchForValueUpdate(calibrationAnswerExemplar(top.factor_label))) {
    return [];
  }

  // ⚠ NOT TRUNCATED. See the header: a shortened exemplar is an ask this
  // product cannot accept, so an over-long body must be refused, never trimmed.
  // The WHOLE list goes in: whether the card may say "matters most" is a
  // comparison between the top two, so the body owns it rather than a caller.
  const body = buildCalibrationBody(ranked);

  // Gate 4 — on the EXACT bytes that ship, and the ONLY length authority this
  // module invokes. A label that leaks a slug-shaped id, uses graph-shape
  // wording, or pushes the body past the card cap drops the card rather than
  // being rewritten: rewriting the product's own account of a user's model
  // would be its own dishonesty.
  //
  // ⚠⚠ TITLE AND BODY ARE GATED SEPARATELY, AND FOR THIS MODULE'S CURRENT COPY
  // THAT IS LARGELY REDUNDANT — MEASURED, NOT ASSUMED, AND RECORDED RATHER
  // THAN QUIETLY KEPT. `truncateAtWordBoundary` always cuts at a space (the
  // one after "Give" is inside every budget), so the title's tokens are always
  // a SUBSET of `{Give} ∪ tokens(label)` and the body always contains all of
  // `tokens(label)`. Any CONTENT offence therefore trips BOTH, and the title is
  // the one that fires first.
  //
  // Measured, at the mutants, and stated at its true strength rather than
  // softened:
  //
  //   THE TITLE LINE HAS A LIVE CASE OF ITS OWN. A single-token label longer
  //   than the budget leaves the title as the bare word "Give" → `too_short`,
  //   while the body is perfectly fine. Deleting the line REDs the suite.
  //
  //   THE BODY LINE HAS NONE. Deleting it leaves the suite GREEN: content is
  //   caught by the title line, and length by `CoachingBlockSchema` at gate 5
  //   (measured: the schema rejects a 301-character body). It is a SURVIVING
  //   MUTANT and it is kept deliberately — not because it fires today, but
  //   because the subset argument above holds only while the body's sole
  //   variable is the label. The first copy change that puts anything else in
  //   the body (a brief quotation, an engine phrase) breaks that silently, and
  //   the sibling emitters gate both halves for the same reason. Recorded here
  //   so a later reader finds a decision rather than rediscovering a defect.
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

  // Gate 5 — fail closed rather than hand egress a block it drops whole. Also
  // the contract's own length authority; see the header.
  if (!CoachingBlockSchema.safeParse(candidate).success) return [];

  return [candidate];
}
