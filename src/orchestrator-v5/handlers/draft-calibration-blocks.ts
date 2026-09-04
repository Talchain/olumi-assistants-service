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
 * the model. The first version of this module shipped exactly that.
 *
 * ⭐ WHY THE RESOLUTION IS NOT THIS MODULE'S USUAL SILENCE. The reason is
 * stated first BECAUSE IT DOES NOT DEPEND ON HOW OFTEN TIES OCCUR — the
 * frequency argument recorded further down cannot carry this decision, and an
 * earlier version of this header wrongly made it do so:
 *
 *   THE CARD CARRIES TWO THINGS, AND ONLY ONE OF THEM IS THE RANKING. It
 *   DISCLOSES that the model is standing in for assumptions the user never
 *   gave, and it RANKS them. Silence on a tie would suppress both — and the
 *   disclosure is the entire point of this lane.
 *   `DIAGNOSIS-LOCKED-2026-09-03.md` is a record of the product reporting
 *   62% / 38% over three engine-defaulted root assumptions and never saying
 *   so. Dropping the card to avoid an unearned superlative would reproduce
 *   that exact silence, in the name of accuracy. The defect is the RANKING
 *   CLAIM, not the ask — so only the claim goes.
 *
 * The tie body therefore keeps the count (still true), the named factor (still
 * one of the gaps) and the routable command, and drops only the comparative.
 * Both directions are pinned in `__tests__` (a tie must drop it; a genuine
 * separation, including the founder capture, must keep it).
 *
 * ⚠ AND THE FREQUENCY CLAIM, CORRECTED TO WHAT WAS ACTUALLY MEASURED. This
 * header used to assert as fact that the tie "is the ENRICHER'S DEFAULT OUTPUT
 * SHAPE… so the flagship separated model was the exception and the tie was the
 * rule". The MECHANISM behind that sentence is verified at the bytes (see
 * `buildCalibrationBody`); the FREQUENCY never was. The leap from one to the
 * other is CLAUDE.md trap 20 — an honest mechanism observation generalised
 * into a population claim at the moment of recording, and then used as the
 * load-bearing reason to depart from a brief.
 *
 *   WHAT IS TRUE: a tie is structurally POSSIBLE and REACHABLE BY
 *   CONSTRUCTION. That is the whole of the mechanism claim.
 *
 *   WHAT IS MEASURED (4 Sep 2026): `deriveMissingRootAssumptions` run over
 *   every graph-shaped JSON object in this repo — 378 files parsed, 154 graph
 *   objects — yields 51 models with a non-empty `ranked`: 40 SINGULAR, 11
 *   SEPARATED, **0 TIED AT THE TOP**.
 *
 *   ⚠ THE SCOPE LIMIT OF THAT NUMBER, WHICH IS THE WHOLE OF IT: this corpus
 *   contains NO enricher-produced edges. `"origin": "enrichment"` and
 *   `"defaulted": true` each return 0 files repo-wide, while the same sweep's
 *   contrast controls return 56 (`"strength_mean"`), 45 (`"origin"`, any
 *   value) and 116 (`"kind": "factor"`) — so the probe is not blind, the
 *   population is simply absent. It therefore CANNOT certify the
 *   enricher-added population, and no corpus available here measures it.
 *   The tie detector is not blind either: a constructed enricher-shaped tie
 *   classifies TIE_AT_TOP and its separated twin SEPARATED.
 *
 * The tie branch is nevertheless marker-independent — two 0.5 edges to one
 * target tie whether or not `origin`/`defaulted` survive serialisation — so
 * the narrow measured statement stands: IN EVERY COMMITTED MODEL THAT REACHES
 * THIS CARD, THE TIE BRANCH NEVER FIRES. It is kept regardless, because the
 * disclosure argument above does not rest on that rate and so cannot be
 * falsified by a future measurement of it.
 *
 * ── ⚠ A KNOWN, UNCLOSED GAP, RECORDED RATHER THAN QUIETLY FIXED ────────────
 * A factor LABELLED with " to " in it — "Time to Value", "Lead to Customer
 * Rate" — produces the exemplar `set Time to Value to 40%`, which the router
 * accepts (measured: `true`) but whose OBJECT BOUNDARY is ambiguous: the same
 * separator appears twice.
 *
 * It is not closed here, and the reasoning is recorded so the next reader
 * finds a decision rather than an oversight.
 *
 * ⭐ THE REASON IS THE BINDER'S MATCHING STRATEGY, NOT A HOPE ABOUT THE MODEL.
 * An earlier version of this note rested the case on "the binder is a model
 * call on the tool-use path", i.e. on the final hop being unmeasurable. That
 * undersold it. There is a DETERMINISTIC PRE-BINDER ahead of the model call:
 * `orchestrator-v5/routing/deterministic-value-update.ts`'s
 * `tryDeterministicValueUpdate`, inserted into the TurnExecutor lifecycle
 * BEFORE `routeWithToolUse` (its own header says so; the production call site
 * is `orchestrator-v5/turn-executor.ts`). It does NOT positionally parse
 * `set X to Y`. It matches candidate labels against the message by
 * case-insensitive SUBSTRING first, with a bigram-Dice fallback, over the
 * graph's own node labels. So `set Time to Value to 40%` matches the factor
 * labelled "Time to Value" ON ITS OWN FULL TEXT, and the realistic failure
 * mode is an ambiguity CLARIFY — one extra question, with the user picking
 * from chips — not a silent mis-bind.
 *
 * Suppressing a common, legitimate label class to avoid one extra question is
 * the wrong trade, and that is the whole argument for leaving this open. The
 * one-line fix (refuse any label containing the separator) buys nothing
 * against a cost that is now understood. Quoting the label in the exemplar
 * instead would change the shipped command shape for EVERY card and must be
 * re-measured against the real router first.
 *
 * ⚠ THE RUNG OF THAT PARAGRAPH, STATED SO IT IS NOT SILENTLY UPGRADED: it is
 * DERIVED BY READING `deterministic-value-update.ts` and its call site — CODE
 * READ, not executed, and not witnessed on a wire. No probe here has driven
 * `set Time to Value to 40%` through the pre-binder against a graph carrying
 * that label. Anyone closing this gap should measure that first.
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
 * ── ⚠⚠ WHAT THE SPOKEN COUNT COUNTS, PINNED BECAUSE IT IS NOT `ranked.length`
 * BY ACCIDENT ──────────────────────────────────────────────────────────────
 * "leaning on N assumptions you have not given a level for" reports
 * `ranked.length`, which OMITS `unreachable_count`. That omission is a
 * DECISION, and the decision is forced by the fact that `unreachable_count`
 * has TWO CAUSES which the sentence cannot both be true of
 * (`missing-root-assumptions.ts` names them; CLAUDE.md trap 21):
 *
 *   CAUSE 1 — no directed path to any goal. The model is NOT leaning on it:
 *             nothing it could say would move the answer. Counting it makes
 *             this sentence FALSE.
 *   CAUSE 2 — a path exists, but some edge on it states no strength. The model
 *             IS leaning on it. NOT counting it makes this sentence an
 *             UNDER-CLAIM.
 *
 * ⭐ SO THE COUNT IS "GAPS THAT CAN MOVE THE ANSWER", not "gaps". Widening it
 * to `ranked.length + unreachable_count` would trade the under-claim for a
 * falsehood, which is strictly worse on a card whose entire purpose is to stop
 * the product asserting more than it knows — and it would collapse two
 * questions into one number, which is the defect that field's own doc-comment
 * exists to forbid.
 *
 * ⚠ AND THE RESIDUAL UNDER-CLAIM IS REAL, MEASURED, AND LEFT OPEN ON PURPOSE.
 * Measured 4 Sep 2026 across the 51 in-repo models with a non-empty `ranked`:
 * exactly TWO have `ranked = 1, unreachable_count = 1`, and they split ONE
 * EACH across the two causes —
 *   · `tools/graph-evaluator/fixtures/repair-graph/10-bidirected-preservation.json`
 *     — `fac_market_noise` has ZERO out-edges. CAUSE 1, so "leaning on one" is
 *     CORRECT there and widening would have made it a lie.
 *   · `tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json`
 *     — `b10644be` "Gross Margin Rate" → "Gross Profit Generation" → goal; its
 *     OWN edge states 0.7 and the SECOND hop states nothing, so the product is
 *     zero. CAUSE 2, and a genuine under-claim: the card says "one" where two
 *     unquantified roots exist.
 * Direction is under-claim, and "leaning on" carries a materiality sense, so
 * this ships. Separating the causes is a change to
 * `missing-root-assumptions.ts`'s contract (two fields, named apart), not a
 * wider count here. `__tests__` pins BOTH directions so neither can drift.
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
  // ⚠ THE TIE IS REACHABLE BY CONSTRUCTION — A MECHANISM CLAIM, AT ITS TRUE
  // STRENGTH AND NO FURTHER. Verified at the bytes in
  // `factor-extraction/enricher.ts` (both injection sites): every factor it
  // adds gets ONE outgoing edge at `strength_mean: 0.5, defaulted: true,
  // origin: "enrichment"`, pointed at `findConnectionTarget`'s target — the
  // first node of the first present kind in `decision > option > goal >
  // outcome`, i.e. `candidates[0].id` unless a candidate LABEL-MATCHES the
  // factor. So two enrichment-added unquantified factors that land on the same
  // target tie EXACTLY, by construction.
  //
  // ⛔ WHAT THAT DOES NOT SAY, because the earlier version of this comment did
  // say it: it is NOT a claim about how OFTEN ties occur. Measured 4 Sep 2026
  // over every graph-shaped JSON in this repo — 51 models with a non-empty
  // `ranked`, 0 tied at the top — with the scope limit that the corpus holds
  // no enricher-produced edges at all. See the header for the full figures,
  // the contrast controls and the tie detector's own positive control.
  //
  // ⛔ WHY NOT SILENCE — AND THE REASON IS NOT THE RATE. Silence is this
  // module's answer to five other doubts. It is the wrong one here because the
  // card DISCLOSES as well as ranks, and dropping it would suppress the
  // disclosure this lane exists to add (the founder's model reported 62% / 38%
  // over three engine-defaulted roots and never said so). The defect is the
  // RANKING CLAIM, not the ask — so only the claim goes, and the card still
  // names one gap and offers a routable command. That argument holds at any
  // tie rate, including zero. The body is 17 characters SHORTER this way, so
  // the choice also costs no budget (pinned in `__tests__`).
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
