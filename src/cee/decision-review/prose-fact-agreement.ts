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
 * signature defect (parent CLAUDE.md trap 21): two authorities answering
 * different questions look like an inconsistency to reconcile, and
 * reconciling them is the wrong fix.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEFECT 1 — THE DIRECTIONAL COUNTERFACTUAL IS INVERTED, AND NOTHING LOOKED
 *
 * Measured on the live capture of 2026-09-03 (scenario 7826c742, UI build
 * 86786efb; the producer subtrees are frozen VERBATIM at
 * `__tests__/fixtures/live-decision-review-2026-09-03.json`):
 *
 *   scenario_contexts["919d7f50->428612e0"] =
 *     trigger:     "If Sales Headcount Investment increases runway depletion
 *                   risk more than forecast,"
 *     consequence: "then Hire a Dedicated Sales Team overtakes Continue With
 *                   Founder-Led Sales."
 *
 * In the SAME enrichment the producer states the signed fact:
 *
 *   edge_e_values["919d7f50::428612e0"] =
 *     { flip_direction: "decrease", current_mean: 0.65, flip_mean: 0.355 }
 *
 * i.e. for the ordering to change, that link must get **WEAKER** (0.65 →
 * 0.36). The prose asserts the opposite. The same inversion rides the CAC
 * scenario (`bbbbd8f2->552bd1c0`: current −0.5 → flip −0.079, i.e. CAC
 * mattering LESS, narrated as "rises faster than expected").
 *
 * ⭐ THE ROOT CAUSE IS UPSTREAM OF THE MODEL, AND IT IS NOT A PROMPT-QUALITY
 * PROBLEM. `readIslResults` in `orchestrator-v5/coaching/decision-review-
 * enricher.ts` forwards each fragile edge as
 * `{ edge_id, from_label, to_label, switch_probability,
 *    marginal_switch_probability, alternative_winner_id,
 *    alternative_winner_label }` — **every one of those is unsigned**, and
 * `edge_e_values` (the only field carrying a direction) is never read there
 * and never reaches the prompt. The served prompt then instructs:
 * `trigger_description (string): "If [condition using from_label/to_label]…"`.
 * So the model is asked to author a directional claim from an input set that
 * contains no direction. Getting it right would be luck.
 *
 * The smallest enabling upstream change is to forward `flip_direction` /
 * `current_mean` / `flip_mean` onto the fragile-edge rows and bind the prompt
 * clause to them. That is a served-prompt change in the governed prompt
 * estate, which this lane does not own — it is reported, not taken. This
 * module is the deterministic half, and it is the half that must exist
 * either way: a prompt instruction is not a gate (the same file records a
 * measured case where prompt-level suppression was ignored on 5/5 turns).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEFECT 2 — INFLUENCE NARRATED AS VALUE OF INFORMATION
 *
 * On the same capture every factor carried `value_of_information: 0`, the one
 * `factor_evppi` row was `status: "below_resolution"` (evppi 1e-05 against a
 * 2.2e-05 noise floor) and all three `p_win_sensitivity` rows were
 * below_resolution — while the product told the founder that validating ICP
 * clarity was *"the single highest-value check before acting on this result"*.
 *
 * ⚠ TWO QUESTIONS, ONE NAME AGAIN, and this one is the estate's own
 * vocabulary:
 *   - influence / elasticity / sensitivity_score / influence_rank answer
 *     **"how much does this factor move the outcome?"**
 *   - value_of_information / factor_evppi / p_win_sensitivity answer
 *     **"how much is it worth to LEARN this factor's true value first?"**
 * A factor can dominate the first and be worthless on the second — which is
 * exactly what this run measured. The product may say a factor is
 * influential. It may not say investigating it is the highest-value action
 * unless a VOI field says so.
 *
 * ⚠ `decision_evpi` IS DELIBERATELY NOT A LICENCE. It answers a THIRD
 * question — "what would perfect information about the WHOLE decision be
 * worth?" — and licensing a per-factor superlative from a decision-level
 * scalar is the same category error one level up. A mutant that lets it
 * license is pinned RED in the suite.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO HARMS, TWO PARAMETERS (parent CLAUDE.md trap 22b)
 *
 * A single window cannot guard both directions here, so it is not asked to:
 *
 *   • A claim we can PROVE wrong → redact. (`..._contradicts_flip_fact`)
 *   • A claim we have NO producer fact for → redact, because it is
 *     ungrounded by construction. This mirrors what `phase3-blocks.ts`
 *     already does with a scenario whose edge id misses the graph lookup:
 *     "fail-closed instead". (`..._ungrounded`)
 *   • A claim whose prose direction this module cannot classify, on an edge
 *     that DOES have a fact → KEPT and COUNTED. It is not certified and it is
 *     not condemned; the residue is reported rather than guessed at, and the
 *     exact known-gap corpus is pinned by a test that REDs if the set grows
 *     OR shrinks.
 *
 * That third state exists because four consecutive rounds on a different
 * natural-language predicate in this repo each fixed one direction and opened
 * the other (parent CLAUDE.md trap 22f). The exit ruled there — "make the
 * ambiguity the product" — is applied here as: classify ONLY the adjacent
 * comparative frame, and decline everything else out loud.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS SEAM DOES **NOT** COVER, STATED SO IT CANNOT BE OVER-READ
 *
 * It owns the `decision_review` output — which the result panel, the
 * explanation, the pre-mortem and the walk-through all read, because every one
 * of them consumes the PERSISTED blob (`phase3-blocks.ts::
 * buildScenarioContextCards` renders it directly, and
 * `context/context-pack-assembler.ts` feeds the same blob to the
 * conversational model as `coaching.decision_review`). Suppressing at the one
 * authoring point is therefore what covers those four surfaces; a per-surface
 * fix would have been four mirrors.
 *
 * It does NOT cover `assistant_text` composed by the conversational model,
 * which is where the live *"the single highest-value check"* sentence actually
 * appeared. That surface's egress guard is the finaliser
 * (`turn-executor.ts` / `chip-click-dispatch.ts` / `edit-graph-dispatch.ts`
 * via `compose/forbidden-user-facing-phrases.ts`), and its VOI licence is a
 * DIFFERENT question again — the analysis→LLM projection withholds the VOI
 * family entirely (`context/enrichment-manifest.ts::R_VOI_NOT_COACH_NARRATED`),
 * so on that surface a VOI superlative is fabricated by construction with no
 * licence to derive at all. {@link countVoiSuperlativeClaims} is exported
 * ready for that wiring. This lane does not own those files and has not
 * touched them.
 */

import { replaceAssertingUnits } from '../../orchestrator-v5/compose/redactable-units.js';

// ============================================================================
// Producer fact 1 — the signed flip requirement per edge
// ============================================================================

/**
 * How the SIGNED edge weight must move for the ordering to change.
 *
 * `'stronger'` / `'weaker'` are about the MAGNITUDE of the effect in the
 * direction it already points; `'reversed'` is the effect changing sign.
 *
 * ⚠ THIS IS NOT `flip_direction`, AND CONFLATING THEM IS A REAL DEFECT.
 * `flip_direction` is the movement of the signed NUMBER. On a negative edge
 * (`bbbbd8f2::552bd1c0`, current_mean −0.5) `flip_direction: "increase"`
 * means the weight moves −0.5 → −0.08, i.e. the harm gets **smaller**. A
 * reader who maps "increase" to "the phenomenon gets worse" inverts exactly
 * the class of sentence this module exists to catch.
 */
export type EdgeFlipRequirement = 'stronger' | 'weaker' | 'reversed';

export interface EdgeFlipFact {
  readonly fromId: string;
  readonly toId: string;
  /** Null when the two independent derivations disagree or are unusable. */
  readonly requirement: EdgeFlipRequirement | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Separator for the internal endpoint-pair key.
 *
 * Deliberately NEITHER of the producer's two spellings (`->`, `::`), so a
 * key built here can never be mistaken for — or accidentally compared
 * against — a producer edge id. Deliberately a printable character too: a
 * control byte in source makes the file binary to `grep`, and a sweep that
 * cannot see a file returns the same clean output as a sweep that looked and
 * found nothing (parent CLAUDE.md trap 17). Pinned by a test.
 */
export const EDGE_KEY_SEPARATOR = '|';

/** Canonical join key. Edge ids are NOT joined on — see the note below. */
function edgeKey(fromId: string, toId: string): string {
  return `${fromId}${EDGE_KEY_SEPARATOR}${toId}`;
}

/**
 * Split the `scenario_contexts` record key into endpoint ids.
 *
 * ⚠ A NAME IS NOT AN ADDRESS. The producer spells the SAME edge two ways in
 * ONE payload: `fragile_edges[].edge_id` and the `scenario_contexts` key use
 * `"from->to"`, while `edge_e_values[].edge_id` uses `"from::to"`. Joining on
 * the id string reads a flat zero for every edge and the whole check silently
 * degrades to "no fact available". The join is therefore on `from_id`/`to_id`
 * — the structured fields — and a fixture-bound test asserts the literal-key
 * join finds NOTHING, so the hazard cannot quietly return.
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

/**
 * Derive the flip requirement for one `edge_e_values` row using TWO
 * independent readings that must agree:
 *
 *   (a) the MEANS — `flip_mean` vs `current_mean`, which alone can express
 *       a sign reversal;
 *   (b) the ENUM — `flip_direction`, the producer's own label for the
 *       movement of the signed number.
 *
 * Requiring agreement is the union assertion: a guard derived from one field
 * only ever proves that field is self-consistent (parent CLAUDE.md trap 12d).
 * Disagreement yields `null` — no fact — which fails CLOSED at the call site.
 */
export function deriveEdgeFlipRequirement(row: unknown): EdgeFlipFact | null {
  const e = asRecord(row);
  if (e === null) return null;
  const fromId = typeof e.from_id === 'string' ? e.from_id : null;
  const toId = typeof e.to_id === 'string' ? e.to_id : null;
  if (fromId === null || toId === null || fromId.length === 0 || toId.length === 0) return null;

  const current = finiteNumber(e.current_mean);
  const flip = finiteNumber(e.flip_mean);
  const declared = typeof e.flip_direction === 'string' ? e.flip_direction : null;

  if (current === null || flip === null || current === 0) {
    return { fromId, toId, requirement: null };
  }

  // (b) the enum, re-derived from the means so a producer typo cannot pass.
  const observedDirection = flip > current ? 'increase' : flip < current ? 'decrease' : null;
  if (observedDirection === null || (declared !== null && declared !== observedDirection)) {
    return { fromId, toId, requirement: null };
  }

  // (a) the means.
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

  return { fromId, toId, requirement };
}

/** Index every usable `edge_e_values` row by endpoint pair. */
export function deriveEdgeFlipFacts(enrichment: unknown): ReadonlyMap<string, EdgeFlipFact> {
  const map = new Map<string, EdgeFlipFact>();
  const envelope = asRecord(enrichment);
  const rows = envelope?.edge_e_values;
  if (!Array.isArray(rows)) return map;
  for (const raw of rows) {
    const fact = deriveEdgeFlipRequirement(raw);
    if (fact !== null) map.set(edgeKey(fact.fromId, fact.toId), fact);
  }
  return map;
}

// ============================================================================
// Prose reading 1 — the movement a trigger sentence ASSERTS
// ============================================================================

/**
 * What a `trigger_description` claims about the link's movement, or `null`
 * when this module declines to say.
 *
 * ⭐ THE SCOPE IS DELIBERATELY NARROW AND IT IS THE DESIGN, NOT A SHORTFALL.
 * Only the ADJACENT comparative-to-model frame classifies:
 *
 *     <comparative> than <baseline-noun>       e.g. "more than forecast",
 *                                                   "faster than expected",
 *                                                   "weaker than modelled"
 *
 * Anything with a word wedged between the comparative and `than` returns
 * `null`, because that is exactly where the polarity moves to the wedged word
 * ("more SLOWLY than expected" is a WEAKENING that a `more … than` rule reads
 * as a strengthening). A rule that tries to absorb the adverb is the fifth
 * round of an oscillation this repo has already run four times and measured
 * (parent CLAUDE.md trap 22f); declining is stable, and the decline is
 * counted rather than hidden.
 *
 * A sentence carrying BOTH polarities also returns `null` — a mixed sentence
 * is a claim about two things, and picking one is guessing.
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
 * Negation immediately governing the comparative frame ("not more than
 * forecast"). Present ⇒ decline, rather than invert: an inverted reading of a
 * negated comparative is precisely the interrupted-construction class that
 * has produced a defect and then its mirror in this repo (trap 22b).
 */
const NEGATION_PATTERN = /\b(?:not|no|never|n't|without)\b[^.!?]{0,24}?\bthan\b/i;

export function classifyAssertedMovement(text: unknown): AssertedMovement | null {
  if (typeof text !== 'string' || text.trim().length === 0) return null;
  if (NEGATION_PATTERN.test(text)) return null;
  const up = UP_PATTERN.test(text);
  const down = DOWN_PATTERN.test(text);
  if (up === down) return null; // neither, or both
  return up ? 'stronger' : 'weaker';
}

/**
 * Does an asserted movement CONTRADICT the producer's requirement?
 *
 * `'reversed'` is deliberately NOT contradicted by either assertion: a sign
 * reversal is reachable by weakening past zero, and it is arguable that a
 * strengthening of an already-reversing relationship reads the same way.
 * Where the answer is arguable this module does not answer.
 */
function contradicts(
  requirement: EdgeFlipRequirement,
  asserted: AssertedMovement,
): boolean {
  if (requirement === 'reversed') return false;
  return requirement !== asserted;
}

// ============================================================================
// Producer fact 2 — the value-of-information licence
//
// ⚠⚠ THE FIRST VERSION OF THIS SECTION WAS WRONG IN THE PERMISSIVE DIRECTION,
// AND IT IS REPLACED RATHER THAN QUIETLY CORRECTED (parent CLAUDE.md trap 14).
// It licensed a superlative from `p_win_sensitivity` and re-derived
// "above resolution" by comparing each row's magnitude against its own
// `noise_floor`. Both are refuted by the producer's own bytes, as already
// recorded in `orchestrator-v5/coaching/uncertainty-priority.ts`:
//
//   1. ISL states of `p_win_sensitivity`, verbatim: *"This is NOT
//      value-of-information … For decision value use `decision_evpi` (whole
//      decision) and `factor_evppi` (per-factor)."* Reading it as a VOI
//      channel is an expectation written from the implementer's reading
//      instead of the producer's semantics — trap 13c, which a full mutant
//      kit would have certified with a perfect score against a wrong oracle.
//   2. That module also rules: the emitted delta and floor are rounded to
//      6dp, so a consumer re-deriving the label can disagree with the
//      producer within ~1e-6 of the boundary. **Read the LABEL.** So the
//      re-derivation is removed, not tightened.
//   3. My status literal was invented too: the producer's enum is
//      `'resolved' | 'below_resolution'`, never `'above_resolution'`. The
//      test that "proved" it licensed correctly used a fixture I had written
//      myself — which is exactly why it agreed with me.
//
// WHAT REPLACES IT IS NARROWER AND DERIVED FROM WHAT THE MODEL WAS SHOWN.
//
// The licence question is not "does a VOI number exist anywhere in the
// enrichment?" It is **"was a value-of-information reading in the input this
// model wrote from?"** — the same shape as the contract gate's R-CONT rule
// ("the decision_review input carries NO conversation history, so ANY
// reference to a prior exchange is fabricated by construction").
//
// `readIslResults` / `normaliseDeterministicCoachingFromM1` in
// `orchestrator-v5/coaching/decision-review-enricher.ts` are the complete
// definition of that input, and they admit exactly TWO VOI-bearing fields:
//
//   • `deterministic_coaching.evidence_gaps[].voi`   (renamed from the
//     upstream `m1_coaching.evidence_gaps[].voi_score` by `normaliseEvidenceGap`)
//   • `isl_results.factor_sensitivity[].evpi_percentage_points` (forwarded
//     only when upstream supplies it)
//
// `factor_evppi`, `decision_evpi`, `p_win_sensitivity` and
// `factor_sensitivity[].value_of_information` are NOT forwarded to this
// prompt at all — and `context/enrichment-manifest.ts` records why that is
// deliberate rather than a wiring gap: `R_VOI_NOT_COACH_NARRATED`, *"narrating
// them in prose is the 'worth X' / 'by N pp' claim class the no-EVPI-display
// doctrine forbids. Adding a deriver is a doctrine ruling, not a wiring gap."*
//
// So a superlative value-of-information claim is licensed ONLY by a non-zero
// reading on one of those two fields. On the 2026-09-03 capture both were
// empty — `m1_coaching` was absent entirely, so `evidence_gaps` normalised to
// `[]` — and the model still produced three evidence enhancements keyed on
// factors 16ec3d64 / 26fbdff5 / 422ceee7, which are influence ranks 1, 2 and
// 3. It ranked by the only quantity it had.
// ============================================================================

export interface VoiLicence {
  /**
   * True ⇔ the input this review was written from carried at least one
   * non-zero value-of-information reading. False ⇔ nothing in the model's
   * input could ground a "worth learning most" claim.
   */
  readonly licensed: boolean;
  /** VOI-bearing rows present in the input — 0 means "the model saw none". */
  readonly rowsInspected: number;
}

/**
 * Derive the licence from the INVOKE INPUT — the object the prompt was built
 * from — never from the raw enrichment. Reading the enrichment here would
 * license a claim on evidence the model never saw, which is a fabrication
 * with a citation.
 */
export function deriveVoiLicence(invokeInput: unknown): VoiLicence {
  const input = asRecord(invokeInput);
  let rowsInspected = 0;
  let licensed = false;

  const gaps = asRecord(input?.deterministic_coaching)?.evidence_gaps;
  if (Array.isArray(gaps)) {
    for (const raw of gaps) {
      const row = asRecord(raw);
      if (row === null) continue;
      rowsInspected += 1;
      // Both spellings: `voi` is the adapter's name, `voi_score` the
      // upstream one. Reading both means the licence does not depend on
      // which side of that rename it is standing on.
      const voi = finiteNumber(row.voi) ?? finiteNumber(row.voi_score);
      if (voi !== null && Math.abs(voi) > 0) licensed = true;
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
      if (Math.abs(evpi) > 0) licensed = true;
    }
  }

  return { licensed, rowsInspected };
}

// ============================================================================
// Prose reading 2 — superlative value-of-information claims
// ============================================================================

/**
 * Superlative VALUE-OF-LEARNING frames. Each anchors the superlative to an
 * INFORMATION quantity, never to a structural influence quantity — that
 * boundary is the whole discrimination, and it is drawn from the live
 * capture's own sentences rather than from this author's head (trap 22a):
 *
 *   CAUGHT   "…validating it is the single highest-value check…"
 *   CAUGHT   "…would settle the single largest source of uncertainty here."
 *   ALLOWED  "ICP clarity has the biggest influence on this result"
 *   ALLOWED  "is the second strongest driver"
 *   ALLOWED  "Your ICP clarity assumption is doing most of the work."
 *
 * The allowed set is asserted as a NON-matching corpus in the suite, so a
 * pattern that widens into influence language REDs.
 */
export const VOI_SUPERLATIVE_PATTERNS: readonly RegExp[] = [
  // "highest-value check", "single highest value action", "best-value test"
  /\b(?:single\s+)?(?:highest|greatest|best|most)[-\s]value\b/i,
  // "the most valuable thing to learn / find out / test"
  /\bmost\s+valuable\b/i,
  // "the single largest source of uncertainty"
  /\b(?:single\s+)?(?:largest|biggest|greatest)\s+source\s+of\s+uncertainty\b/i,
  // "worth the most to learn / find out / resolve"
  /\bworth\s+(?:the\s+)?most\s+to\s+(?:learn|know|find\s+out|resolve|test|check)\b/i,
  // "highest expected value of learning / return on testing"
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
  | 'directional_claim_contradicts_flip_fact'
  | 'directional_claim_ungrounded'
  | 'voi_superlative_without_voi_evidence';

export interface ProseFactViolation {
  readonly rule: ProseFactRule;
  /** Count of offending items — a finite integer, never user text. */
  readonly observed: number;
}

/**
 * What replaces a sentence that crowns a value-of-information superlative the
 * run has no reading for.
 *
 * ⚠ IT DELIBERATELY DOES NOT SUBSTITUTE A DIFFERENT FACTOR, OR A NUMBER. The
 * honest content of this state is that the run produced no value-of-information
 * reading at all; naming a runner-up "next best check" would be the same
 * fabrication one rank down, and quoting a magnitude is the claim class
 * `enrichment-manifest.ts::R_VOI_NOT_COACH_NARRATED` records as forbidden
 * pending doctrine.
 *
 * It describes what the PRODUCT did, never what the user did — the standing
 * ruling that `coaching/pick-defaulted-assumptions.ts` states for the
 * defaulted-value disclosure, applied to the same kind of admission.
 */
export const VOI_SUPERLATIVE_REPLACEMENT =
  'This run produced no value-of-information reading, so it cannot say which unknown is ' +
  'worth checking first.';

export interface ProseFactAgreementResult {
  /**
   * The review, with unshippable directional claims removed and unlicensed
   * value-of-information superlatives replaced. A NEW object; the input is
   * never mutated.
   */
  readonly output: Record<string, unknown>;
  readonly violations: readonly ProseFactViolation[];
  /** Scenario entries deleted because they contradict the producer's fact. */
  readonly redactedContradicted: number;
  /** Scenario entries deleted because no producer fact grounds them. */
  readonly redactedUngrounded: number;
  /**
   * Scenario entries KEPT whose prose direction this module declined to
   * classify. The honest residue — see the header's third state. Reported so
   * the gap is observable instead of inferred.
   */
  readonly unclassifiedKept: number;
  /** Prose fields whose VOI superlative was replaced. */
  readonly voiFieldsRedacted: number;
}

/**
 * Run the prose/fact agreement seam over a parsed decision_review output.
 *
 * ⚠ NEITHER REMEDY DROPS THE REVIEW, and that is a ratified position rather
 * than a preference. `compose/leading-option-egress-guard.ts` ends with the
 * ruling that such a decision is *"per-field, not whole-response — blanking an
 * envelope at egress trades one dishonest answer for no answer at all"*, and
 * `compose/runner-up-gap-statistic.ts` applies it verbatim to this exact
 * surface: routing through the contract gate's `mustDrop` path would take out
 * the whole decision review — bias findings, evidence enhancements, flip
 * thresholds and all — on every analysed turn for as long as the served prompt
 * keeps asking for the claim. Both of these conditions ARE prompt-systemic
 * (the prompt asks for a direction it is given no data for, and ranks evidence
 * gaps by a VOI field that is usually absent), so a drop remedy would fire
 * routinely and remove the product's real coaching along with the defect.
 *
 * The two remedies differ in GRANULARITY because the claims do:
 *   • a `scenario_contexts` entry IS the counterfactual claim, whole — its two
 *     fields are one sentence in two halves, and replacing the trigger would
 *     leave "then X overtakes Y" dangling. The entry is dropped, which the
 *     prompt contract explicitly permits (`scenario_contexts: {}`).
 *   • a VOI superlative is one sentence inside prose that is otherwise fine,
 *     so it is replaced per-sentence by the shared `replaceAssertingUnits`
 *     surgery — the third consumer of that primitive, differing only in the
 *     reader and the replacement string.
 *
 * Pure and total: never throws, never mutates `output`, and yields an empty
 * verdict on unrecognisable inputs — so a payload this module cannot read is
 * never made worse by it.
 *
 * @param output       the parsed decision_review JSON
 * @param enrichment   the persisted enrichment, for the signed edge facts
 * @param invokeInput  the object the PROMPT was built from, for the VOI
 *                     licence. Read separately from `enrichment` on purpose:
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

  // Deep clone so redactions never reach the caller's object.
  let next: Record<string, unknown> = JSON.parse(JSON.stringify(output)) as Record<
    string,
    unknown
  >;

  // ── Directional claims ────────────────────────────────────────────────
  let redactedContradicted = 0;
  let redactedUngrounded = 0;
  let unclassifiedKept = 0;

  const scenarios = asRecord(next.scenario_contexts);
  if (scenarios !== null) {
    for (const [key, rawEntry] of Object.entries(scenarios)) {
      const entry = asRecord(rawEntry);
      if (entry === null) continue;
      const endpoints = splitScenarioKey(key);
      const fact = endpoints === null
        ? undefined
        : facts.get(edgeKey(endpoints.fromId, endpoints.toId));

      if (fact === undefined || fact.requirement === null) {
        // No signed fact for this edge: the direction the sentence asserts is
        // unverifiable by construction. Fail closed — the same action
        // `phase3-blocks.ts` already takes on a scenario whose edge id misses
        // the graph lookup.
        delete scenarios[key];
        redactedUngrounded += 1;
        continue;
      }

      const asserted = classifyAssertedMovement(entry.trigger_description);
      if (asserted === null) {
        unclassifiedKept += 1;
        continue;
      }
      if (contradicts(fact.requirement, asserted)) {
        delete scenarios[key];
        redactedContradicted += 1;
      }
    }
  }

  if (redactedContradicted > 0) {
    violations.push({
      rule: 'directional_claim_contradicts_flip_fact',
      observed: redactedContradicted,
    });
  }
  if (redactedUngrounded > 0) {
    violations.push({ rule: 'directional_claim_ungrounded', observed: redactedUngrounded });
  }

  // ── Value-of-information claims ───────────────────────────────────────
  //
  // The walk is TOTAL rather than a field allowlist, for the reason
  // `runner-up-gap-statistic.ts` states about the same output: the contract
  // gate one rail over already scans every prose string here for R-CONT, the
  // measured corpus puts this claim family in several different fields, and a
  // hand-listed field allowlist is a mirror waiting for the next schema
  // addition. It is safe over non-prose strings by construction — an id, a
  // timestamp or an enum cannot satisfy a superlative frame, and
  // `replaceAssertingUnits` returns its INPUT REFERENCE when no unit asserts.
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
        // The split can put the superlative's halves in different sentences,
        // in which case nothing is replaced and nothing is reported — the
        // honest outcome, and why this reads the RESULT, not the hit count.
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
  if (voiFieldsRedacted > 0) {
    violations.push({
      rule: 'voi_superlative_without_voi_evidence',
      observed: voiFieldsRedacted,
    });
  }

  return {
    output: next,
    violations,
    redactedContradicted,
    redactedUngrounded,
    unclassifiedKept,
    voiFieldsRedacted,
  };
}

/**
 * Reduce a verdict to a telemetry payload. Bounded rule codes and finite
 * integers only — no prose, label, id, or user text (R-004).
 */
export interface ProseFactAgreementTelemetry {
  readonly reason: ProseFactRule;
  readonly reasons: string;
  readonly violation_count: number;
}

export function summariseProseFactViolations(
  violations: readonly ProseFactViolation[],
): ProseFactAgreementTelemetry {
  const codes = [...new Set(violations.map((v) => v.rule))].sort();
  return {
    reason: codes[0] as ProseFactRule,
    reasons: codes.join(','),
    violation_count: codes.length,
  };
}
