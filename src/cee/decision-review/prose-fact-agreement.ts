/**
 * Decision Review — PROSE / FACT AGREEMENT SEAM
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS NOT THE CONTRACT GATE, AND THE DISTINCTION IS THE WHOLE POINT
 *
 * `contract-gate.ts` answers: **"does this output obey the prompt contract?"**
 * (required fields present, counts within bounds, ids grounded in the graph).
 * It is entirely satisfied by an output that is well-formed and false.
 *
 * This module answers a DIFFERENT question: **"does this prose agree with the
 * signed analytical fact the producer shipped in the same payload?"**
 *
 * They are named apart and kept apart deliberately. Aligning them — folding
 * one into the other, or making their defaults match — is the estate's
 * signature defect (parent CLAUDE.md trap 21).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEFECT 1 — THE DIRECTIONAL COUNTERFACTUAL IS INVERTED, AND NOTHING LOOKED
 *
 * Measured on the live capture of 2026-09-03 (scenario 7826c742, UI build
 * 86786efb, served prompt decision_review v15; the producer subtrees are
 * frozen VERBATIM at `__tests__/fixtures/live-decision-review-2026-09-03.json`),
 * followed through every hop of the same run:
 *
 *   saved model        graph edge e-12, 919d7f50 → 428612e0, strength_mean 0.65,
 *                      effect_direction "positive"
 *   consumed input     edge_e_values["919d7f50::428612e0"].current_mean = 0.65
 *   calculated result  flip_direction "decrease", flip_mean 0.355: the ISL
 *                      search probed the INCREASE span up to +1.0 first and the
 *                      leader held, then found the flip by DECREASING the link
 *   shown to the model isl_results.fragile_edges[] = { edge_id, from_label,
 *                      to_label, switch_probability, marginal_switch_probability,
 *                      alternative_winner_id, alternative_winner_label } — no
 *                      direction, no sign, no flip requirement; `edge_e_values`
 *                      is never read by `readIslResults`
 *   final explanation  scenario_contexts["919d7f50->428612e0"].trigger_description
 *                      = "If Sales Headcount Investment increases runway
 *                      depletion risk more than forecast," — a STRONGER link
 *
 * The run says the link must get WEAKER (0.65 → 0.36) for the ordering to
 * change, and that a stronger link was tested and did not change it. The prose
 * says stronger. The option name in the consequence was correct — the producer's
 * `alternative_winner_id` for that edge is the option the prose names.
 *
 * The second narrated scenario (`bbbbd8f2->552bd1c0`, "If Customer Acquisition
 * Cost rises faster than expected,") is a different defect class: it is a claim
 * about the FACTOR'S VALUE (it names only the from-label), while the scenario is
 * keyed to a LINK whose producer fact is about the coefficient (−0.5 → −0.079,
 * i.e. the link getting weaker). A value claim and a coefficient claim are not
 * the same claim, and this module does not pretend one refutes the other.
 *
 * ⭐ THE ROOT CAUSE IS UPSTREAM OF THE MODEL. The prompt asks for
 * `trigger_description: "If [condition using from_label/to_label]…"` from an
 * input that contains no direction. The information-path repair lives beside
 * this file: `readIslResults` now forwards a categorical `flip_requirement`
 * on each fragile-edge row (see `decision-review-enricher.ts`); binding the
 * prompt clause to it is a served-prompt change in the governed estate and is
 * handed off, not taken here. This module is the deterministic half, which
 * must exist either way: a prompt instruction is a request, not a gate.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE PRODUCER'S SEARCH DOES AND DOES NOT ESTABLISH
 *
 * `edge_e_values` rows come from ISL's `_compute_edge_e_values`
 * (`services/robustness_analyzer_v2.py`, staging 7781ca4f): for each edge it
 * tries the "increase" span [current, +1] FIRST — probing the far boundary and
 * skipping the span if the leader holds there — then the "decrease" span
 * [−1, current], and reports the FIRST span in which a flip is found. So a row
 * carries three distinct kinds of knowledge:
 *
 *   SUPPORTED   the movement that flips the leader (`requirement`), derived
 *               from the means and cross-checked against `flip_direction`;
 *   REFUTED     when `flip_direction` is "decrease", every movement inside the
 *               increase span was probed at its boundary and the leader held —
 *               "no reversal found within the tested range";
 *   NOT ASSESSED when `flip_direction` is "increase", the decrease span was
 *               never searched — the search stops at the first flip.
 *
 * The three are kept apart in {@link EdgeFlipFact} and in the rule codes. The
 * REMEDY for a prose claim in the refuted span and one in the unassessed span
 * is the same (state what the run supports), so a change in the producer's
 * search order could only mislabel telemetry, never a user-facing sentence.
 *
 * `flip_direction` is the movement of the SIGNED number. On a negative edge
 * "increase" means the coefficient moves toward zero — the harm gets SMALLER.
 * `requirement` is therefore derived from magnitudes, never from the enum's
 * word, and a reader that maps "increase" onto "the phenomenon gets worse"
 * inverts exactly the sentence under test.
 *
 * Unflippable edges never reach this module: ISL reports them with an infinite
 * e-value and PLoT's numeric-egress guard drops non-finite rows. So an edge
 * with no row while its neighbours have rows is UNVERIFIED here, not proven
 * unflippable — absence has several producers (budget, bidirected edge, the
 * egress drop) and this module does not guess which.
 *
 * What this module can NOT establish, stated so it is not over-read: the
 * search runs in the expected-value world against `baseline_winner_id`, and
 * PLoT does not re-emit that field (nor `alternative_winner_id`) on
 * `edge_e_values`, so agreement between the search's baseline and the
 * Monte-Carlo leader is not checkable from this payload. On the 2026-09-03
 * capture they agree (the option with the highest `option_comparison[].
 * outcome.mean` is the Monte-Carlo leader); that is one capture.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE REMEDY CORRECTS OR QUALIFIES; IT DOES NOT DELETE USEFUL REASONING
 *
 * A scenario entry carries two things worth keeping even when its direction is
 * wrong: WHICH link the run found fragile, and WHICH option would overtake.
 * Deleting the entry threw both away. Instead:
 *
 *   • prose direction disagrees with the supported movement → the trigger is
 *     REPLACED by a sentence composed from the structured fact
 *     ({@link composeSupportedTrigger}); the consequence is kept verbatim.
 *   • prose is a factor-VALUE claim on a link scenario → replaced the same way.
 *   • no producer fact for THIS edge (others exist) → the trigger is QUALIFIED
 *     to a direction-free sentence; the consequence is kept.
 *   • the producer shipped NO facts at all → every entry is KEPT and the
 *     condition is counted (`factsUnavailable`). An infrastructure gap is not
 *     evidence about any particular sentence, and blanking every card for it is
 *     the whole-envelope remedy `compose/leading-option-egress-guard.ts` rules
 *     against.
 *   • prose direction this module declines to read, on an edge with a fact →
 *     KEPT and counted. Only the adjacent comparative-to-model frame is read;
 *     an adverb between the comparative and `than` moves the polarity onto the
 *     adverb, and a rule that absorbs it is the next round of an oscillation
 *     this repo has measured (trap 22f). The declined corpus in the suite is a
 *     SAMPLED FLOOR of that gap, not an exact set.
 *   • a replacement cannot be composed (no renderable labels) → the entry is
 *     dropped, and counted separately. This is the only deletion left.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEFECT 2 — INFLUENCE NARRATED AS VALUE OF INFORMATION
 *
 * On the same capture every factor carried `value_of_information: 0`, the one
 * `factor_evppi` row was `below_resolution` and all three `p_win_sensitivity`
 * rows were below_resolution — while the product told the founder that
 * validating ICP clarity was *"the single highest-value check before acting on
 * this result"*. Influence ("how much does this factor move the outcome?") and
 * value of information ("how much is it worth to LEARN this factor first?")
 * are different quantities; a factor can dominate the first and be worthless
 * on the second, which is what this run measured.
 *
 * A superlative needs a SUPPORTED COMPARISON, not merely a non-zero number:
 * {@link deriveVoiLicence} licenses one only when the input the model was
 * shown carried value-of-information readings for at least two factors with a
 * unique, non-zero maximum. `decision_evpi` is deliberately not a licence — it
 * answers a third question (the whole decision), and licensing a per-factor
 * superlative from a decision-level scalar is the same category error.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS SEAM DOES **NOT** COVER, STATED SO IT CANNOT BE OVER-READ
 *
 * It owns the `decision_review` output — the one persisted blob that
 * `phase3-blocks.ts::buildScenarioContextCards` renders as review cards, that
 * the UI's `V5AnalysisResultBlock` renders directly from
 * `enrichment.decision_review.scenario_contexts`, and that
 * `context/context-pack-assembler.ts` feeds to the conversational model as
 * `coaching.decision_review`. Correcting at the one authoring point covers all
 * of those. The directional check reads `scenario_contexts` only;
 * `story_headlines` and `robustness_explanation` carry the same causal story in
 * prose and are NOT checked here.
 *
 * It does NOT cover `assistant_text` composed by the conversational model —
 * where the live "single highest-value check" sentence actually appeared, and
 * where the same session's rerun explanation ("increases … more strongly") was
 * a claim about a factor's VALUE on a rerun. That surface's egress is the
 * finaliser (`turn-executor.ts` and siblings via
 * `compose/forbidden-user-facing-phrases.ts`), which this lane does not own.
 * {@link countVoiSuperlativeClaims} is exported ready for that wiring.
 */

import { sanitiseLabel } from '../../orchestrator-v5/context/enrichment-graph-labels.js';
import { replaceAssertingUnits } from '../../orchestrator-v5/compose/redactable-units.js';

/**
 * ⚠ CLAIM-SAFETY POSTURE.
 *
 * `edge_e_values` is a RATIFIED TIER-3 DENY field — `compose/lens-selector.ts`
 * records that a consumer may read it "as a structured gate only and no
 * quantity from it may ever be surfaced." This module keeps that posture: it
 * reads the field to decide categorical things (which movement flips the
 * leader, what the search did and did not test) and every NUMBER it touches
 * dies inside this file. What it writes to the output is a fixed sentence
 * shape carrying the producer's own labels and one of three categorical words;
 * the telemetry payload is bounded rule codes and integers. A fixture-bound
 * test asserts that no magnitude from `edge_e_values` reaches the output or the
 * verdict.
 */

// ============================================================================
// Producer fact 1 — the signed flip requirement per edge, and what was tested
// ============================================================================

/**
 * How the SIGNED edge coefficient must move for the ordering to change.
 * `'stronger'` / `'weaker'` are about the MAGNITUDE of the effect in the
 * direction it already points; `'reversed'` is the effect changing sign.
 */
export type EdgeFlipRequirement = 'stronger' | 'weaker' | 'reversed';

/** What the producer's search established about the movements it did NOT report. */
export type OppositeSpanAssessment = 'refuted_within_tested_range' | 'not_assessed';

export interface EdgeFlipFact {
  readonly fromId: string;
  readonly toId: string;
  /** Producer labels from the same row, sanitised; null when not renderable. */
  readonly fromLabel: string | null;
  readonly toLabel: string | null;
  /** Null when the two independent derivations disagree or are unusable. */
  readonly requirement: EdgeFlipRequirement | null;
  /**
   * Movements that lie in the span the search did NOT report, and what the
   * search established about that span. Empty when `requirement` is null or
   * `flip_direction` is absent.
   */
  readonly oppositeMovements: ReadonlySet<EdgeFlipRequirement>;
  readonly oppositeAssessment: OppositeSpanAssessment | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Separator for the internal endpoint-pair key. Deliberately NEITHER of the
 * producer's two spellings (`->`, `::`), and a printable character (a control
 * byte in source makes the file binary to `grep` — trap 17). Pinned by a test.
 */
export const EDGE_KEY_SEPARATOR = '|';

/** Canonical join key. Edge ids are NOT joined on — see `splitScenarioKey`. */
export function edgeFlipKey(fromId: string, toId: string): string {
  return `${fromId}${EDGE_KEY_SEPARATOR}${toId}`;
}

/**
 * Split the `scenario_contexts` record key into endpoint ids.
 *
 * ⚠ A NAME IS NOT AN ADDRESS. The producer spells the SAME edge two ways in
 * ONE payload: `fragile_edges[].edge_id` and the `scenario_contexts` key use
 * `"from->to"`, while `edge_e_values[].edge_id` uses `"from::to"`. Joining on
 * the id string reads a flat zero for every edge. The join is on
 * `from_id`/`to_id` — the estate's established idiom (`coaching/select-fragile-
 * edge.ts`, `compose/lens-selector.ts`) — and a fixture-bound test asserts the
 * literal-key join finds NOTHING.
 */
function splitScenarioKey(key: string): { fromId: string; toId: string } | null {
  for (const sep of ['->', '::']) {
    const idx = key.indexOf(sep);
    if (idx > 0 && idx + sep.length < key.length) {
      return { fromId: key.slice(0, idx), toId: key.slice(idx + sep.length) };
    }
  }
  return null;
}

/** The movements that live in each search span, by the sign of the current coefficient. */
function spanMovements(
  currentSign: 1 | -1,
  span: 'increase' | 'decrease',
): ReadonlySet<EdgeFlipRequirement> {
  // Positive coefficient: increasing it strengthens; decreasing it weakens and
  // then reverses. Negative coefficient: increasing it (toward zero and past)
  // weakens and then reverses; decreasing it strengthens.
  const strengthens = (currentSign === 1) === (span === 'increase');
  return strengthens ? new Set(['stronger']) : new Set(['weaker', 'reversed']);
}

/**
 * Derive the flip fact for one `edge_e_values` row using TWO independent
 * readings that must agree: the MEANS (`flip_mean` vs `current_mean`, which
 * alone can express a sign reversal) and the ENUM (`flip_direction`, the
 * producer's label for the movement of the signed number). Disagreement yields
 * `requirement: null` — no fact.
 *
 * The opposite-span assessment reads the enum only, because it encodes the
 * search ORDER (see the header): "decrease" means the increase span was probed
 * and held; "increase" means the decrease span was never searched.
 */
export function deriveEdgeFlipRequirement(row: unknown): EdgeFlipFact | null {
  const e = asRecord(row);
  if (e === null) return null;
  const fromId = nonEmptyString(e.from_id);
  const toId = nonEmptyString(e.to_id);
  if (fromId === null || toId === null) return null;

  const fromLabel =
    typeof e.from_label === 'string' ? sanitiseLabel(e.from_label, fromId) : null;
  const toLabel = typeof e.to_label === 'string' ? sanitiseLabel(e.to_label, toId) : null;

  const none: EdgeFlipFact = {
    fromId,
    toId,
    fromLabel,
    toLabel,
    requirement: null,
    oppositeMovements: new Set(),
    oppositeAssessment: null,
  };

  const current = finiteNumber(e.current_mean);
  const flip = finiteNumber(e.flip_mean);
  const declared = typeof e.flip_direction === 'string' ? e.flip_direction : null;

  if (current === null || flip === null || current === 0) return none;

  // The enum, re-derived from the means so a producer typo cannot pass.
  const observedDirection = flip > current ? 'increase' : flip < current ? 'decrease' : null;
  if (observedDirection === null || (declared !== null && declared !== observedDirection)) {
    return none;
  }

  // The means.
  const crossesZero = flip !== 0 && Math.sign(flip) !== Math.sign(current);
  let requirement: EdgeFlipRequirement | null;
  if (crossesZero) {
    requirement = 'reversed';
  } else if (Math.abs(flip) > Math.abs(current)) {
    requirement = 'stronger';
  } else if (Math.abs(flip) < Math.abs(current)) {
    requirement = 'weaker';
  } else {
    requirement = null;
  }
  if (requirement === null) return none;

  const currentSign: 1 | -1 = current > 0 ? 1 : -1;
  let oppositeMovements: ReadonlySet<EdgeFlipRequirement> = new Set();
  let oppositeAssessment: OppositeSpanAssessment | null = null;
  if (declared === 'decrease') {
    oppositeMovements = spanMovements(currentSign, 'increase');
    oppositeAssessment = 'refuted_within_tested_range';
  } else if (declared === 'increase') {
    oppositeMovements = spanMovements(currentSign, 'decrease');
    oppositeAssessment = 'not_assessed';
  }
  // The supported movement is never in the opposite set by construction; a
  // 'reversed' requirement shares its span with 'weaker' (weakening past zero).
  return { fromId, toId, fromLabel, toLabel, requirement, oppositeMovements, oppositeAssessment };
}

/** Index every readable `edge_e_values` row by endpoint pair. */
export function deriveEdgeFlipFacts(enrichment: unknown): ReadonlyMap<string, EdgeFlipFact> {
  const map = new Map<string, EdgeFlipFact>();
  const envelope = asRecord(enrichment);
  const rows = envelope?.edge_e_values;
  if (!Array.isArray(rows)) return map;
  for (const raw of rows) {
    const fact = deriveEdgeFlipRequirement(raw);
    if (fact !== null) map.set(edgeFlipKey(fact.fromId, fact.toId), fact);
  }
  return map;
}

// ============================================================================
// Prose reading 1 — the movement a trigger sentence ASSERTS, and its SUBJECT
// ============================================================================

/**
 * What a `trigger_description` claims about the link's movement, or `null`
 * when this module declines to say.
 *
 * Only the ADJACENT comparative-to-model frame classifies:
 *
 *     <comparative> than <baseline-noun>       e.g. "more than forecast",
 *                                                   "faster than expected",
 *                                                   "weaker than modelled"
 *
 * Anything with a word wedged between the comparative and `than` returns
 * `null` ("more SLOWLY than expected" is a WEAKENING that a `more … than` rule
 * reads as a strengthening). A sentence carrying BOTH polarities also returns
 * `null`. A negated frame returns `null` rather than inverting.
 */
export type AssertedMovement = 'stronger' | 'weaker';

/** Nouns naming the model's own baseline — the thing prose compares against. */
const BASELINE_NOUNS = [
  'forecast',
  'forecasts',
  'forecasted',
  'modelled',
  'modeled',
  'the model',
  'expected',
  'expectations',
  'assumed',
  'assumptions',
  'estimated',
  'estimates',
  'anticipated',
  'planned',
  'projected',
  'predicted',
  'currently assumed',
];

const UP_COMPARATIVES = [
  'more',
  'stronger',
  'higher',
  'bigger',
  'larger',
  'greater',
  'faster',
  'steeper',
  'harder',
  'worse',
  'sharper',
];

const DOWN_COMPARATIVES = [
  'less',
  'weaker',
  'lower',
  'smaller',
  'slower',
  'milder',
  'gentler',
  'better',
  'flatter',
  'softer',
];

function comparativePattern(words: readonly string[]): RegExp {
  // `<comparative> than <baseline>` with NOTHING between the comparative and
  // `than`. Optional determiner/possessive before the baseline noun.
  return new RegExp(
    String.raw`\b(?:${words.join('|')})\s+than\s+(?:the\s+|we\s+|our\s+|you\s+|your\s+|it\s+|is\s+|was\s+|were\s+)*(?:${BASELINE_NOUNS.join(
      '|',
    )})\b`,
    'i',
  );
}

const UP_PATTERN = comparativePattern(UP_COMPARATIVES);
const DOWN_PATTERN = comparativePattern(DOWN_COMPARATIVES);

/**
 * Negation governing the comparative frame within a short window ("not more
 * than forecast", "doesn't drive B more than forecast", "unless it rises faster
 * than expected"). Present ⇒ decline, rather than invert.
 *
 * Contractions are matched as a word ending in `n't` (either apostrophe):
 * `\bn't\b` cannot match inside "doesn't" because `\b` needs a non-word
 * character before the `n`. Each covered form is pinned by a corpus member.
 */
const NEGATION_PATTERN =
  /(?:\b(?:not|no|never|without|unless|fails?\s+to|stops?|no\s+longer)\b|\w+n['’]t\b)[^.!?]{0,40}?\bthan\b/i;

export function classifyAssertedMovement(text: unknown): AssertedMovement | null {
  if (typeof text !== 'string' || text.trim().length === 0) return null;
  if (NEGATION_PATTERN.test(text)) return null;
  const up = UP_PATTERN.test(text);
  const down = DOWN_PATTERN.test(text);
  if (up === down) return null; // neither, or both
  return up ? 'stronger' : 'weaker';
}

/**
 * WHAT the trigger sentence is about, read from LABEL STRUCTURE rather than
 * from more grammar: a scenario is keyed to a link, and the prompt contract
 * asks for a condition "using from_label/to_label". A sentence that names BOTH
 * endpoints is a claim about the link; one that names only ONE endpoint is a
 * claim about that factor's value ("If Customer Acquisition Cost rises faster
 * than expected"). A change in a factor's value and a change in a relationship's
 * coefficient are different claims, and the producer fact here is about the
 * coefficient.
 *
 * `'unknown'` when neither label is found (the model paraphrased). An
 * edge-keyed scenario whose subject cannot be read is treated as a link claim
 * by the caller, because the key itself is the claim about the link.
 */
export type TriggerSubject = 'link' | 'factor_value' | 'unknown';

export function classifyTriggerSubject(
  text: unknown,
  fromLabel: string | null,
  toLabel: string | null,
): TriggerSubject {
  if (typeof text !== 'string' || text.length === 0) return 'unknown';
  const haystack = text.toLowerCase();
  const mentions = (label: string | null): boolean =>
    label !== null && label.length > 0 && haystack.includes(label.toLowerCase());
  const from = mentions(fromLabel);
  const to = mentions(toLabel);
  if (from && to) return 'link';
  if (from !== to) return 'factor_value';
  return 'unknown';
}

/**
 * How an asserted movement stands against the producer fact.
 *
 *   'agrees'        the prose states the supported movement, or 'weaker' on a
 *                   link the run says must reverse (weakening past zero is on
 *                   the path to a reversal — not contradicted).
 *   'refuted'       the prose states a movement the search probed and the
 *                   leader held.
 *   'not_assessed'  the prose states a movement the search never reached, or
 *                   the row carried no `flip_direction` to say which.
 */
export type MovementAssessment = 'agrees' | 'refuted' | 'not_assessed';

export function assessAssertedMovement(
  fact: EdgeFlipFact,
  asserted: AssertedMovement,
): MovementAssessment | null {
  if (fact.requirement === null) return null;
  if (asserted === fact.requirement) return 'agrees';
  if (fact.requirement === 'reversed' && asserted === 'weaker') return 'agrees';
  if (fact.oppositeMovements.has(asserted)) {
    return fact.oppositeAssessment === 'refuted_within_tested_range' ? 'refuted' : 'not_assessed';
  }
  return 'not_assessed';
}

// ============================================================================
// The replacement — a sentence composed from the structured fact
// ============================================================================

/**
 * The supported condition, in the link's own terms. Sign- and unit-neutral by
 * design: "weaker" means a smaller coefficient magnitude whatever the sign, so
 * on a negative link it reads as the harm getting smaller — which is what the
 * producer's number says — without this module guessing whether "more delay"
 * or "faster delivery" is the good direction for the affected variable.
 *
 * Returns null when either label is not renderable; the caller then has no
 * honest sentence to write and drops the entry.
 */
export function composeSupportedTrigger(
  fact: Pick<EdgeFlipFact, 'fromLabel' | 'toLabel'>,
  movement: EdgeFlipRequirement | 'unverified',
): string | null {
  if (fact.fromLabel === null || fact.toLabel === null) return null;
  const link = `the link from ${fact.fromLabel} to ${fact.toLabel}`;
  switch (movement) {
    case 'stronger':
      return `If ${link} turns out stronger than the model assumes,`;
    case 'weaker':
      return `If ${link} turns out weaker than the model assumes,`;
    case 'reversed':
      return `If ${link} turns out to run the opposite way to what the model assumes,`;
    case 'unverified':
      return `If ${link} turns out different from what the model assumes,`;
  }
}

// ============================================================================
// Producer fact 2 — the value-of-information licence
// ============================================================================

/**
 * The licence question is not "does a VOI number exist anywhere in the
 * enrichment?" It is **"did the input this model wrote from carry a
 * value-of-information COMPARISON that supports a superlative?"**
 *
 * `readIslResults` / `normaliseDeterministicCoachingFromM1` in
 * `orchestrator-v5/coaching/decision-review-enricher.ts` define that input.
 * The VOI-bearing fields they admit, re-derived at the bytes:
 *
 *   • `deterministic_coaching.evidence_gaps[].voi` (renamed from the upstream
 *     `voi_score` by `normaliseEvidenceGap`) and, on the same rows,
 *     `evpi_percentage_points` / `evpi_method`, which `normaliseEvidenceGap`
 *     forwards as an allowlisted passthrough;
 *   • `isl_results.factor_sensitivity[].evpi_percentage_points`, forwarded
 *     when upstream supplies it.
 *
 * `factor_evppi`, `decision_evpi`, `p_win_sensitivity` and
 * `factor_sensitivity[].value_of_information` are NOT forwarded to this
 * prompt — `context/enrichment-manifest.ts::R_VOI_NOT_COACH_NARRATED` records
 * that as deliberate. An earlier draft of this licence read those enrichment
 * fields and re-derived a status label the producer says to read, not
 * re-derive; it is replaced, not tightened.
 *
 * A superlative ("the single highest-value check") is a claim about a RANKING.
 * It is licensed only when at least two factors carry a reading and one of
 * them is the unique, non-zero maximum. A single non-zero reading compares
 * against nothing.
 */
export interface VoiLicence {
  readonly licensed: boolean;
  /** Rows in the input carrying at least one value-of-information field. */
  readonly rowsInspected: number;
  /** Finite readings that entered the comparison. */
  readonly readingsCompared: number;
}

function voiReadingOf(row: Record<string, unknown>): number | null {
  // Both spellings of the gap field, plus the ISL field the enricher forwards
  // onto the same rows. Reading all three means the licence does not depend on
  // which side of a rename it is standing on.
  return (
    finiteNumber(row.voi) ??
    finiteNumber(row.voi_score) ??
    finiteNumber(row.evpi_percentage_points)
  );
}

export function deriveVoiLicence(invokeInput: unknown): VoiLicence {
  const input = asRecord(invokeInput);
  const readings: number[] = [];
  let rowsInspected = 0;

  const gaps = asRecord(input?.deterministic_coaching)?.evidence_gaps;
  if (Array.isArray(gaps)) {
    for (const raw of gaps) {
      const row = asRecord(raw);
      if (row === null) continue;
      const reading = voiReadingOf(row);
      if (reading === null) continue;
      rowsInspected += 1;
      readings.push(Math.abs(reading));
    }
  }

  const sensitivity = asRecord(input?.isl_results)?.factor_sensitivity;
  if (Array.isArray(sensitivity)) {
    for (const raw of sensitivity) {
      const row = asRecord(raw);
      if (row === null) continue;
      const evpi = finiteNumber(row.evpi_percentage_points);
      if (evpi === null) continue;
      rowsInspected += 1;
      readings.push(Math.abs(evpi));
    }
  }

  let licensed = false;
  if (readings.length >= 2) {
    const max = Math.max(...readings);
    const atMax = readings.filter((r) => r === max).length;
    licensed = max > 0 && atMax === 1;
  }
  return { licensed, rowsInspected, readingsCompared: readings.length };
}

// ============================================================================
// Prose reading 2 — superlative value-of-information claims
// ============================================================================

/**
 * Superlative VALUE-OF-LEARNING frames. Each anchors the superlative to an
 * INFORMATION quantity, never to a structural influence quantity:
 *
 *   CAUGHT   "…validating it is the single highest-value check…"
 *   CAUGHT   "…would settle the single largest source of uncertainty here."
 *   ALLOWED  "ICP clarity has the biggest influence on this result"
 *   ALLOWED  "is the second strongest driver"
 *
 * The allowed set is asserted as a NON-matching corpus in the suite.
 */
export const VOI_SUPERLATIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:single\s+)?(?:highest|greatest|best|most)[-\s]value\b/i,
  /\bmost\s+valuable\b/i,
  /\b(?:single\s+)?(?:largest|biggest|greatest)\s+source\s+of\s+uncertainty\b/i,
  /\bworth\s+(?:the\s+)?most\s+to\s+(?:learn|know|find\s+out|resolve|test|check)\b/i,
  /\b(?:highest|best|greatest)\s+(?:expected\s+)?(?:information\s+)?(?:value|payoff|return)\s+(?:of|from|on)\s+(?:learning|testing|resolving|investigating|research)\b/i,
];

/** How many VOI-superlative frames a string carries (0 when none). */
export function countVoiSuperlativeClaims(text: unknown): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  let hits = 0;
  for (const pattern of VOI_SUPERLATIVE_PATTERNS) {
    if (pattern.test(text)) hits += 1;
  }
  return hits;
}

// ============================================================================
// The seam
// ============================================================================

/** Bounded vocabulary — no prose, labels, ids, or user text ever leave here. */
export type ProseFactRule =
  /** Prose stated a movement the search probed and the leader held. Corrected. */
  | 'directional_claim_contradicts_flip_fact'
  /** Prose stated a movement the search never reached. Corrected to the supported one. */
  | 'directional_claim_direction_not_assessed'
  /** Prose was about a factor's value on a link scenario. Corrected to the link fact. */
  | 'directional_claim_about_factor_value'
  /** No producer fact for this edge while others exist. Qualified, direction removed. */
  | 'directional_claim_unverified'
  /** No renderable labels to compose a replacement. Dropped. */
  | 'directional_claim_uncomposable'
  | 'voi_superlative_without_voi_evidence';

export interface ProseFactViolation {
  readonly rule: ProseFactRule;
  /** Count of affected items — a finite integer, never user text. */
  readonly observed: number;
}

/**
 * What replaces a sentence that crowns a value-of-information superlative the
 * run has no supported comparison for. It names no other factor and no number:
 * a runner-up would be the same fabrication one rank down, and a magnitude is
 * the claim class `R_VOI_NOT_COACH_NARRATED` forbids.
 */
export const VOI_SUPERLATIVE_REPLACEMENT =
  'This run produced no value-of-information comparison, so it cannot say which unknown is ' +
  'worth checking first.';

export interface ProseFactAgreementResult {
  /** The review with corrections applied. A NEW object; the input is never mutated. */
  readonly output: Record<string, unknown>;
  readonly violations: readonly ProseFactViolation[];
  /** Triggers replaced because the prose movement was refuted by the search. */
  readonly correctedContradicted: number;
  /** Triggers replaced because the prose movement was never assessed by the search. */
  readonly correctedNotAssessed: number;
  /** Triggers replaced because the prose was a factor-value claim on a link scenario. */
  readonly correctedValueClaim: number;
  /** Triggers qualified to a direction-free sentence: no fact for this edge. */
  readonly qualifiedUnverified: number;
  /** Entries dropped because no replacement could be composed. */
  readonly redactedUncomposable: number;
  /** Entries KEPT whose prose direction this module declined to classify. */
  readonly unclassifiedKept: number;
  /** True when the producer shipped no usable facts at all; every entry was kept. */
  readonly factsUnavailable: boolean;
  /** Prose fields whose VOI superlative was replaced. */
  readonly voiFieldsRedacted: number;
}

/**
 * Run the prose/fact agreement seam over a parsed decision_review output.
 *
 * Neither remedy drops the review (the per-field ruling in
 * `compose/leading-option-egress-guard.ts`, applied to this surface by
 * `compose/runner-up-gap-statistic.ts`). Pure and total: never throws, never
 * mutates `output`, and yields an empty verdict on unrecognisable inputs.
 *
 * @param output       the parsed decision_review JSON
 * @param enrichment   the persisted enrichment, for the signed edge facts
 * @param invokeInput  the object the PROMPT was built from, for the VOI
 *                     licence — read separately from `enrichment` because
 *                     licensing a claim on evidence the model never saw is a
 *                     fabrication with a citation.
 */
export function checkProseFactAgreement(
  output: Record<string, unknown>,
  enrichment: unknown,
  invokeInput: unknown = null,
): ProseFactAgreementResult {
  const violations: ProseFactViolation[] = [];
  const facts = deriveEdgeFlipFacts(enrichment);
  const usableFacts = [...facts.values()].filter((f) => f.requirement !== null).length;

  // Deep clone so corrections never reach the caller's object.
  let next: Record<string, unknown> = JSON.parse(JSON.stringify(output)) as Record<
    string,
    unknown
  >;

  // ── Directional claims ────────────────────────────────────────────────
  let correctedContradicted = 0;
  let correctedNotAssessed = 0;
  let correctedValueClaim = 0;
  let qualifiedUnverified = 0;
  let redactedUncomposable = 0;
  let unclassifiedKept = 0;
  let factsUnavailable = false;

  const scenarios = asRecord(next.scenario_contexts);
  if (scenarios !== null && Object.keys(scenarios).length > 0) {
    if (usableFacts === 0) {
      // The producer shipped no signed facts for this run. Nothing here can be
      // checked, and nothing here has been shown wrong: keep every entry and
      // say so. This is the fail-OPEN arm, taken deliberately (see the header).
      factsUnavailable = true;
    } else {
      for (const [key, rawEntry] of Object.entries(scenarios)) {
        const entry = asRecord(rawEntry);
        if (entry === null) continue;
        const endpoints = splitScenarioKey(key);
        if (endpoints === null) continue; // not an edge key; phase3's lookup handles it
        const fact = facts.get(edgeFlipKey(endpoints.fromId, endpoints.toId));

        if (fact === undefined || fact.requirement === null) {
          // No signed fact for THIS edge although the producer shipped facts:
          // the direction is unverifiable. Keep the scenario, remove the
          // direction.
          const labels = fact ?? { fromLabel: null, toLabel: null };
          const qualified = composeSupportedTrigger(labels, 'unverified');
          if (qualified === null) {
            delete scenarios[key];
            redactedUncomposable += 1;
          } else {
            entry.trigger_description = qualified;
            qualifiedUnverified += 1;
          }
          continue;
        }

        const subject = classifyTriggerSubject(
          entry.trigger_description,
          fact.fromLabel,
          fact.toLabel,
        );
        const asserted = classifyAssertedMovement(entry.trigger_description);

        let replaceBecause: Exclude<ProseFactRule, 'voi_superlative_without_voi_evidence'> | null =
          null;
        if (subject === 'factor_value') {
          replaceBecause = 'directional_claim_about_factor_value';
        } else if (asserted === null) {
          unclassifiedKept += 1;
          continue;
        } else {
          const assessment = assessAssertedMovement(fact, asserted);
          if (assessment === 'agrees') continue;
          replaceBecause =
            assessment === 'refuted'
              ? 'directional_claim_contradicts_flip_fact'
              : 'directional_claim_direction_not_assessed';
        }

        const supported = composeSupportedTrigger(fact, fact.requirement);
        if (supported === null) {
          delete scenarios[key];
          redactedUncomposable += 1;
          continue;
        }
        entry.trigger_description = supported;
        if (replaceBecause === 'directional_claim_contradicts_flip_fact') correctedContradicted += 1;
        else if (replaceBecause === 'directional_claim_direction_not_assessed') correctedNotAssessed += 1;
        else correctedValueClaim += 1;
      }
    }
  }

  const push = (rule: ProseFactRule, observed: number): void => {
    if (observed > 0) violations.push({ rule, observed });
  };
  push('directional_claim_contradicts_flip_fact', correctedContradicted);
  push('directional_claim_direction_not_assessed', correctedNotAssessed);
  push('directional_claim_about_factor_value', correctedValueClaim);
  push('directional_claim_unverified', qualifiedUnverified);
  push('directional_claim_uncomposable', redactedUncomposable);

  // ── Value-of-information claims ───────────────────────────────────────
  //
  // The walk is TOTAL rather than a field allowlist, for the reason
  // `runner-up-gap-statistic.ts` states about the same output: a hand-listed
  // field allowlist is a mirror waiting for the next schema addition. It is
  // safe over non-prose strings by construction — an id, a timestamp or an
  // enum cannot satisfy a superlative frame, and `replaceAssertingUnits`
  // returns its INPUT REFERENCE when no unit asserts.
  let voiFieldsRedacted = 0;
  if (!deriveVoiLicence(invokeInput).licensed) {
    const walk = (node: unknown): unknown => {
      if (typeof node === 'string') {
        if (countVoiSuperlativeClaims(node) === 0) return node;
        const replaced = replaceAssertingUnits(
          node,
          (unit) => countVoiSuperlativeClaims(unit) > 0,
          VOI_SUPERLATIVE_REPLACEMENT,
        );
        if (replaced === node) return node;
        voiFieldsRedacted += 1;
        return replaced;
      }
      if (Array.isArray(node)) return node.map(walk);
      const record = asRecord(node);
      if (record !== null) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(record)) out[k] = walk(v);
        return out;
      }
      return node;
    };
    next = walk(next) as Record<string, unknown>;
  }
  push('voi_superlative_without_voi_evidence', voiFieldsRedacted);

  return {
    output: next,
    violations,
    correctedContradicted,
    correctedNotAssessed,
    correctedValueClaim,
    qualifiedUnverified,
    redactedUncomposable,
    unclassifiedKept,
    factsUnavailable,
    voiFieldsRedacted,
  };
}

/**
 * Reduce a verdict to a telemetry payload. Bounded rule codes and finite
 * integers only — no prose, label, id, or user text (R-004).
 */
export interface ProseFactAgreementTelemetry {
  /** The first rule code in sorted order, or 'none' when nothing was corrected. */
  readonly reason: ProseFactRule | 'none';
  readonly reasons: string;
  /** Distinct rule codes present — NOT the number of affected items. */
  readonly rule_count: number;
}

export function summariseProseFactViolations(
  violations: readonly ProseFactViolation[],
): ProseFactAgreementTelemetry {
  const codes = [...new Set(violations.map((v) => v.rule))].sort();
  return {
    reason: codes.length > 0 ? codes[0] : 'none',
    reasons: codes.join(','),
    rule_count: codes.length,
  };
}
