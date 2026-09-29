/**
 * ROADMAP 2.1265 — THE BLOCKER/CLAIM MUTUAL-EXCLUSION INVARIANT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE INVARIANT, stated once
 *
 *   A missing-value BLOCKER and a claim that the value EXISTS are mutually
 *   exclusive. Where the payload's own readiness says option O has no value for
 *   factor F, the answer may not assert that the model already holds one.
 *
 * A reply that contradicts its own payload is unconditionally wrong, and no
 * amount of copy review fixes it, because the reply is written by a model. So
 * the contradiction is removed AT EGRESS, from the text that actually ships.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WITNESSED DEFECT (deployed CEE `8be62df`, 2026-08-17, journey J4 turn 2,
 * scenario 289c2690…, captured in `olumi-docs/witness-acceptance-2026-08-17/`)
 *
 *   assistant_text : "Your model already reflects subcontractor cost at 12% of
 *                     affected-route revenue, so no change is needed there."
 *   same payload   : blocker `missing_value`, option `21ea9b80` × factor
 *                    `49a2b80b`, message "Factor … is currently 0.5. What
 *                    should option … set it to?"
 *   persisted      : factor baseline 0.5 (`cee_inference`); the option carries
 *                    NO intervention. No 0.12 / 12% anywhere claimable.
 *
 * The composer was the generic routing/direct-answer path. It had read the
 * user's own "12%" from one turn earlier and the analysis summary naming that
 * factor a top driver — and had NOT read the factor's value. It is not a
 * phrasing accident; it is an ungrounded claim, and the payload it shipped in
 * already contained the refutation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ WHY THIS IS NOT THE FIRST ATTEMPT, AND WHAT THE FIRST ONE DID
 *
 * PR #1007 targeted the same defect and was measured shipping THE EXACT
 * INVERSE. Run against its own fixture with an EMPTY blocker list it replaced
 * ordinary TRUE prose and destroyed the reply around it:
 *
 *   · "Your model already contains 12 nodes."  → a generic refusal.
 *   · "I already ran the analysis at 1,000 samples. Here is what it found: the
 *      EV route dominates."                    → THE ANALYSIS RESULT DESTROYED.
 *
 * Three harms compounded, and each one is answered by a named property below:
 *
 *   1. it DENIED a true statement about the user's own persisted model
 *        → {@link GROUNDED_VALUE_EXEMPTION} + the attribution rule;
 *   2. the surrounding content did not survive, because the substitution was
 *      WHOLE-TEXT
 *        → sentence-level surgery via `replaceAssertingUnits`;
 *   3. the replacement asked for "the value you want" naming NO SLOT, so no
 *      answer could be accepted
 *        → {@link buildBlockedSlotCorrection} names the pair and hands over the
 *          sanctioned acceptance phrasing (P8).
 *
 * Two further findings from that review are load-bearing here:
 *
 *   · Its claim of being "STRUCTURALLY impossible" was FALSE. Grounding used
 *     `some` over an UNATTRIBUTED value set, so the witnessed fabrication with
 *     50% / 0.5 still passed — 0.5 is the `cee_inference` default sitting on the
 *     very factor the blocker is about. Grounding here is ATTRIBUTED: a claimed
 *     number must be the value persisted FOR THAT SLOT, never a number found
 *     somewhere in the graph.
 *   · An absent-marker escape re-admitted the fabrication verbatim with a
 *     trailing "; nothing is missing." — because the escape looked for an
 *     absence marker ANYWHERE in the sentence. Here the negative-polarity test
 *     is ADJACENCY-BOUND to the possession verb's own object determiner
 *     ({@link NEGATED_POSSESSION}), so a trailing clause cannot flip it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE GATE IS NARROW BY CONSTRUCTION, not by tuning
 *
 * Recognising `already` + a verb + a number is far too wide for natural
 * language, and this is MEASURED rather than argued. Over 1,323 distinct real
 * `assistant_text` strings harvested from live wire captures, exactly 21
 * sentences carry `already` beside a digit — and 20 of the 21 are TRUE:
 *
 *   "Incident Detection Coverage is already set to 90 scale."
 *   "The £250,000 MRR figure is already in your model as the goal itself…"
 *   "Monthly Observability Spend is already set to £3,300."
 *
 * A fabrication recogniser is therefore the wrong instrument. This module is a
 * CONTRADICTION detector: all four conditions below must hold together, and the
 * first of them is structural and comes from the payload, not from prose.
 *
 *   (1) a LIVE missing-value blocker for a specific option × factor pair;
 *   (2) the unit NAMES that pair's option or factor by label IDENTITY, and
 *       names it better than any other node in the graph (trap 19 — never a
 *       predicate another entity could satisfy);
 *   (3) the unit ASSERTS THE MODEL POSSESSES a value (not a question, not a
 *       request to confirm, not a conditional, not a negation);
 *   (4) the number it asserts is NOT the value attributed to that slot.
 *
 * ⭐ NO BLOCKER ⇒ NO OPINION. With an empty blocker list this module is inert
 * and returns the input REFERENCE. That is the property #1007 lacked, and it is
 * asserted by identity in the suite rather than described here.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REUSE, not a second implementation (CLAUDE.md trap 12)
 *
 *   · sentence surgery      → `compose/redactable-units.ts`
 *                             (lossless split · input reference on no-hit ·
 *                              NEVER empties · lines before sentences, so a
 *                              bullet list cannot be fused and swallowed)
 *   · option interventions  → `analysis-ready-helper.ts::mergeInterventionSources`
 *   · factor value          → `cee/provenance/factor-value-provenance.ts::readFactorValueView`
 *   · the acceptance phrasing → `configure-option-chip-text.ts::buildConfigureOptionAdvisedFormat`
 *
 * Nothing here re-derives any of those. In particular the acceptance phrasing
 * is IMPORTED so that the sentence this guard hands the user is the same
 * sentence the repair path is pinned to accept — the ask and its acceptance
 * path cannot drift apart, because there is only one of each.
 */

import { replaceAssertingUnits, splitIntoRedactableUnits } from './redactable-units.js';
import { buildConfigureOptionAdvisedFormat } from '../configure-option-chip-text.js';
import { mergeInterventionSources } from '../../orchestrator/tools/analysis-ready-helper.js';
import { readFactorValueView } from '../../cee/provenance/factor-value-provenance.js';
import {
  deriveMissingEffectPairs,
  type MissingEffectPair,
} from '../routing/repair-value-binding.js';

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 · THE BLOCKER READ — IMPORTED, because there is already an owner
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * "Which option × factor pairs is the product currently saying it has no value
 * for" already has exactly one owner: `deriveMissingEffectPairs` in
 * `routing/repair-value-binding.ts`. It is imported, not reimplemented.
 *
 * ⭐ THAT SHARING IS THE INVARIANT, NOT HOUSEKEEPING. This module's whole claim
 * is that a blocker and a possession claim are MUTUALLY EXCLUSIVE. Two readers
 * of "which pairs are blocked" could disagree about exactly the pair under
 * dispute — and then the guard and the repair path would be enforcing two
 * different exclusions under one name (CLAUDE.md trap 12/21). One reader means
 * the pair the repair path offers to fix is necessarily the pair the guard
 * refuses to let the product claim.
 *
 * Extending that owner to read the second wire spelling
 * (`code: "MISSING_OPTION_VALUE"`) was part of this change; see its header for
 * the measured evidence and the widening direction.
 */
export type BlockedValueSlot = MissingEffectPair;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** Live missing-value slots for this payload, via the single owner. */
export function readBlockedValueSlots(blockers: unknown): readonly BlockedValueSlot[] {
  return deriveMissingEffectPairs({ blockers });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 · IDENTITY BINDING — the unit must name THIS pair, better than any other
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Words carrying no discriminating power between two labels in this domain.
 *
 * Deliberately SMALL and purely grammatical. A domain stop-list ("cost",
 * "revenue", "rate") would silently destroy the binding for the very labels
 * this estate generates, which are built almost entirely from those words.
 */
const NON_DISCRIMINATING: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'as', 'by', 'with',
  'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that',
  'these', 'those', 'over', 'under', 'per', 'into', 'out', 'up', 'down', 'not', 'no', 'nor',
  'but', 'if', 'then', 'than', 'you', 'your', 'yours', 'we', 'our', 'us', 'they', 'their',
  'there', 'here', 'which', 'who', 'whom', 'whose', 'what', 'when', 'where', 'how',
]);

function contentTokens(text: string): string[] {
  const out: string[] = [];
  for (const t of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (t.length <= 2) continue;
    if (NON_DISCRIMINATING.has(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * How completely a unit spells a label, and how many tokens that took.
 *
 * ⚠ EXACT-LABEL BINDING WOULD NEVER HAVE FIRED ON THE WITNESSED BYTES, and
 * this was measured before the approach was chosen. The reply says
 * "subcontractor cost at 12% of affected-route revenue"; the persisted label is
 * "Subcontractor cost as share of affected-route revenue". The obvious trap-19
 * binding — compare against `factor_label` — would have been perfectly correct
 * and pointed at the wrong bytes.
 *
 * Measured on the witnessed sentence against all 19 persisted node labels:
 * the blocked factor scores 5/6 and the NEXT BEST scores 1/6. The separation is
 * an order of magnitude, which is why the uniqueness rule below carries the
 * discrimination and the ratio only has to exclude noise.
 */
function labelOverlap(unit: string, label: string): { coverage: number; matched: number } {
  const labelTokens = contentTokens(label);
  if (labelTokens.length === 0) return { coverage: 0, matched: 0 };
  const unitTokens = new Set(contentTokens(unit));
  const matched = labelTokens.filter((t) => unitTokens.has(t)).length;
  return { coverage: matched / labelTokens.length, matched };
}

/**
 * Floors for "this unit is talking about this label".
 *
 * ⭐ THESE ARE NOT THE DISCRIMINATOR — {@link namesEntityUniquely} is. A ratio
 * with a hard cliff either side is precisely the shape CLAUDE.md trap 22f rules
 * against, so it is not asked to settle anything ambiguous: it excludes a unit
 * that shares one or two incidental words with a label, and the UNIQUENESS
 * comparison against every other node decides which entity is meant.
 *
 * Both directions of a wrong answer here are bounded and unequal:
 *   · too high ⇒ a contradiction is MISSED (a gap, pinned as data below);
 *   · too low  ⇒ true prose is refused (a lie) — which is why uniqueness is
 *     required as well, and why a grounded number exits earlier regardless.
 */
const MIN_MATCHED_TOKENS = 2;
const MIN_LABEL_COVERAGE = 0.6;

/**
 * Does this unit name `label`, and name it better than every one of
 * `otherLabels`?
 *
 * The uniqueness comparison is what makes this an IDENTITY binding rather than
 * a value predicate another object could satisfy. The witnessed graph contains
 * a near-duplicate option pair — `21ea9b80` "subcontracting inner-city
 * deliveries to a green courier" (from the user's brief) and `862169d7`
 * "Subcontract inner-city runs to green courier" (the drafter's twin) — and a
 * guard that cannot tell them apart would refuse prose about the wrong one.
 */
export function namesEntityUniquely(
  unit: string,
  label: string,
  otherLabels: readonly string[],
): boolean {
  const { coverage, matched } = labelOverlap(unit, label);
  if (matched < MIN_MATCHED_TOKENS || coverage < MIN_LABEL_COVERAGE) return false;
  for (const other of otherLabels) {
    if (labelOverlap(unit, other).coverage >= coverage) return false;
  }
  return true;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 · THE POSSESSION ASSERTION — the one natural-language predicate here
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * "The MODEL holds a value" — asserted, in the present or perfect.
 *
 * ⭐ EVERY PATTERN QUOTES A SENTENCE THE PRODUCT ACTUALLY EMITTED, taken from
 * the 1,323-string live capture corpus, never from this author's idea of how a
 * model might phrase possession. That is the same rule
 * `defaulted-value-egress.ts` states for its own matcher, and it is the only
 * defence against a corpus that shares the author's blind spot (trap 22).
 *
 * What is deliberately NOT here, each because the corpus contains it as TRUE
 * prose that must survive:
 *   · requests to confirm — "…so confirming it at 12% keeps that comparison
 *     accurate."               (J4 t2 bullet 1: a true claim about the ANALYSIS)
 *   · conditionals/futures  — "…sharing it would let the model reflect it
 *     precisely."                                              (J4 t2 closing)
 *   · questions             — "Is the 12% from the quotes you mentioned…?"
 *   · influence claims      — "…is the strongest driver against subcontracting
 *     in the latest run."                     (true, and about the run not the
 *                                              stored value)
 */
const MODEL_POSSESSION_PATTERNS: readonly RegExp[] = [
  // J4 t2 sentence 1, the witnessed fabrication:
  // "Your model already reflects subcontractor cost at 12% of affected-route revenue…"
  //
  // ⚠ THE VERB IS INFLECTED, AND THE `s` IS NOT OPTIONAL. Written as
  // `reflects?` this pattern matched the BARE INFINITIVE in a modal clause —
  // "sharing it would let the model reflect it precisely", the closing sentence
  // of the very same witnessed reply, which is a conditional offer and TRUE.
  // Measured against the live corpus, not reasoned about. Third-person
  // agreement is what distinguishes an assertion from an infinitive here, and
  // "your model reflect" is not a sentence anyone writes.
  /\b(?:your|the|this)\s+(?:model|graph)\s+(?:already\s+|now\s+)?(?:reflects|contains|has|holds|includes|carries|uses|records)\b/i,
  // J4 t2 final paragraph:
  // "The subcontracting option's costs are modelled using this 12% figure already…"
  /\b(?:is|are|was|were)\s+(?:already\s+|currently\s+)?(?:modelled|modeled)\s+(?:using|with|at|on)\b/i,
  // Corpus (true prose, and caught ONLY when its slot is blocked and the number
  // is unattributed): "Incident Detection Coverage is already set to 90 scale."
  // / "Monthly Observability Spend is already set to £3,300."
  /\b(?:is|are)\s+(?:already|currently)\s+(?:set|fixed|recorded|captured|entered)\b/i,
  // Corpus: "The £250,000 MRR figure is already in your model as the goal itself…"
  /\balready\s+(?:in|within|part\s+of)\s+(?:your|the|this)\s+(?:model|graph)\b/i,
];

/**
 * ⭐⭐ THE NEGATION TEST IS ADJACENCY-BOUND, AND THAT IS THE WHOLE POINT.
 *
 * #1007 exempted a sentence when an absence marker appeared ANYWHERE in it, and
 * the review re-admitted the fabrication verbatim by appending "; nothing is
 * missing." — a trailing clause flipped a guard about the leading one.
 *
 * Here the negative must be the possession verb's OWN object determiner, i.e.
 * immediately after the verb. That is a local grammatical fact, not general
 * negation-scope parsing (which CLAUDE.md trap 22f rules is unwinnable): it
 * cannot be reached from a later clause, so there is no escape to close.
 *
 * It also makes this module's own replacement copy — which says the model has
 * NO value — provably immune to itself. The suite asserts that by running the
 * guard over its own output.
 */
const NEGATED_POSSESSION =
  /\b(?:reflects?|contains?|has|holds?|includes?|carries|uses?|records?|set|fixed|recorded|captured|entered|modelled|modeled)\s+(?:no|not|none|nothing|neither)\b/i;

/** Does this unit assert that the model possesses a value? */
export function assertsModelPossession(unit: string): boolean {
  if (NEGATED_POSSESSION.test(unit)) return false;
  if (/\bn['’]t\b/i.test(unit)) return false;
  return MODEL_POSSESSION_PATTERNS.some((re) => re.test(unit));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 · ATTRIBUTED GROUNDING — a number is grounded FOR A SLOT, never in general
 * ═════════════════════════════════════════════════════════════════════════ */

/** A number as written, and as a magnitude comparable with persisted state. */
interface ClaimedNumber {
  readonly raw: string;
  readonly value: number;
}

/**
 * ⚠ THE SCOPE IS THE CLAIM'S OWN TEXT, NEVER THE OBJECT GRAPH. A whole-object
 * numeric sweep GRANTS the permission by accident: hex node ids contain digit
 * runs (`21ea9b80` → 21, 80) and the witnessed graph carries twelve edges at
 * `strength.std = 0.11999999999999998`, which matches 0.12 within any tolerance
 * anyone would choose. Grounding is read from the SLOT, and only from the slot.
 */
const NUMBER_IN_PROSE = /(?<![\w.])(?:£|\$|€)?\s?\d[\d,]*(?:\.\d+)?\s?%?/g;

export function readClaimedNumbers(unit: string): ClaimedNumber[] {
  const out: ClaimedNumber[] = [];
  for (const m of unit.matchAll(NUMBER_IN_PROSE)) {
    const raw = m[0].trim();
    const digits = raw.replace(/[^\d.]/g, '');
    if (digits === '' || digits === '.') continue;
    const parsed = Number(digits);
    if (!Number.isFinite(parsed)) continue;
    out.push({ raw, value: raw.endsWith('%') ? parsed / 100 : parsed });
  }
  return out;
}

/**
 * The values the model genuinely attributes to THIS option × factor slot.
 *
 * Two carriers, and both are legitimate grounds for a possession claim:
 *
 *   1. the OPTION's intervention for that factor — absent whenever the blocker
 *      is live, which is what the blocker means;
 *   2. the FACTOR's own persisted value — the blocker's own message states it
 *      ("Factor … is currently 0.5"), so a reply quoting it is telling the
 *      truth about the model even while the option-level value is missing.
 *
 * ⭐ INCLUDING (2) IS THE ANTI-OVER-REFUSAL PROPERTY, and it is the direction
 * #1007 got wrong: refusing a sentence that correctly quotes persisted state
 * would make the product deny the user's own model. P3 — an emission must not
 * be less true than the behaviour it replaces.
 */
export const GROUNDED_VALUE_EXEMPTION = 'attributed_to_slot' as const;

function nodesOf(graph: unknown): Array<Record<string, unknown>> {
  if (typeof graph !== 'object' || graph === null) return [];
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.filter(
    (n): n is Record<string, unknown> => typeof n === 'object' && n !== null,
  );
}

function nodeLabel(node: Record<string, unknown>): string {
  return str(node.label) ?? '';
}

export function groundedValuesForSlot(graph: unknown, slot: BlockedValueSlot): number[] {
  const values: number[] = [];
  for (const node of nodesOf(graph)) {
    const id = str(node.id);
    if (id === slot.optionId) {
      const merged = mergeInterventionSources(node);
      const own = merged?.[slot.factorId];
      if (typeof own === 'number' && Number.isFinite(own)) values.push(own);
    }
    if (id === slot.factorId) {
      const view = readFactorValueView(node);
      if (typeof view.value === 'number' && Number.isFinite(view.value)) values.push(view.value);
    }
  }
  return values;
}

/**
 * Comparison tolerance.
 *
 * Relative, because the claims range from `0.12` to `£250,000`, and an absolute
 * epsilon would be simultaneously too tight for one and meaninglessly loose for
 * the other. Kept as tight as float noise allows: a LOOSE tolerance here grants
 * permission it should not, which is the dangerous direction.
 */
function sameMagnitude(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 · THE REPLACEMENT — honest, slot-named, and with an acceptance path (P8)
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * The example value shown in the acceptance phrasing.
 *
 * IMPORTED VALUE, NOT A LITERAL: this is the same concrete example the
 * configure-option remedy already advises, so the sentence this guard hands the
 * user is byte-identical in shape to the one the repair path is pinned to
 * accept. A second example value here would be a second concept (trap 21) and
 * would drift.
 */
export const BLOCKED_SLOT_EXAMPLE_VALUE = '0.6';

/**
 * ⭐ P8 — NEVER ASK WHAT YOU CANNOT ACCEPT.
 *
 * #1007's replacement asked for "the value you want" and named no slot at all,
 * so there was no answer the product could bind. This one:
 *
 *   · states what is TRUE of the persisted model (no value on that pair);
 *   · NAMES the pair, both halves, from the blocker's own labels;
 *   · hands over the sanctioned acceptance phrasing, generated by the shared
 *     builder — so the suite can pin that a direct answer in that form is
 *     ACCEPTED by the repair path, rather than asserting it in prose.
 *
 * It deliberately makes no claim about whether the analysis can run: that is a
 * separate derivation this module does not hold, and guessing it is how a
 * neighbouring composer shipped a promise the server refused.
 */
export function buildBlockedSlotCorrection(slot: BlockedValueSlot): string {
  const example = buildConfigureOptionAdvisedFormat(
    slot.optionLabel,
    slot.factorLabel,
    BLOCKED_SLOT_EXAMPLE_VALUE,
  );
  return (
    `Your model does not have a value for "${slot.factorLabel}" on ` +
    `"${slot.optionLabel}" yet, so I cannot say it already reflects one. ` +
    `Tell me what to set it to, like this: ${example}.`
  );
}

/**
 * What a RESTATEMENT of the same contradiction is replaced with.
 *
 * ⚠ SHORT ON PURPOSE, AND THE REASON IS AN OBSERVED OUTPUT RATHER THAN A
 * PREFERENCE. Replacing both the anchor and its restatement with the full
 * correction was measured on the witnessed reply and shipped a 330-character
 * sentence TWICE, ~660 characters of repetition around two true bullets. It was
 * honest and it read as a malfunction. The correction is stated once, where the
 * claim was first made; a restatement is reduced to the same fact in a clause.
 *
 * It carries NO number and NO possession assertion, so it can neither anchor
 * nor restate — the guard is idempotent over its own output, which the suite
 * asserts rather than assumes.
 */
export const BLOCKED_SLOT_RESTATEMENT_TEXT = 'That figure is not in the model yet.';

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 · THE GUARD
 * ═════════════════════════════════════════════════════════════════════════ */

export interface BlockedSlotClaimGuardInput {
  readonly assistantText: string | null | undefined;
  /**
   * The payload's OWN readiness blockers — `analysis_ready.blockers` or
   * `analysis_state.readiness.blockers`. Typed `unknown` because that is how
   * the in-process canonical payload declares it (`orchestrator/types.ts:645`).
   */
  readonly blockers: unknown;
  /**
   * P5 — THE AUTHORITATIVE READ. The graph the readiness above was computed
   * from (`canonicalReadinessGraphForRun`), never a request-derived graph and
   * never a reconstruction. If the two could disagree, the guard would be
   * deciding a contradiction against the wrong state.
   */
  readonly persistedGraph: unknown;
}

export type BlockedSlotClaimGuardMode =
  | 'no_blockers'
  | 'no_text'
  | 'no_contradiction'
  | 'applied';

export interface BlockedSlotClaimGuardResult {
  /** The text to ship. The SAME REFERENCE as the input when unchanged. */
  readonly text: string;
  readonly changed: boolean;
  readonly mode: BlockedSlotClaimGuardMode;
  /** Units removed for contradicting a live blocker, in document order. */
  readonly contradictions: readonly string[];
  /** The slot whose correction shipped — null when nothing changed. */
  readonly slot: BlockedValueSlot | null;
  /** The ungrounded numbers, as written, that anchored the contradiction. */
  readonly ungroundedValues: readonly string[];
}

function unchanged(
  text: string,
  mode: BlockedSlotClaimGuardMode,
): BlockedSlotClaimGuardResult {
  return {
    text,
    changed: false,
    mode,
    contradictions: [],
    slot: null,
    ungroundedValues: [],
  };
}

/**
 * Apply the mutual-exclusion invariant. PURE — never throws, never mutates.
 *
 * NEVER THROWS is the house rule at this chokepoint: throwing at egress hands
 * the user a 500 in place of an answer, which is strictly worse than the
 * sentence being repaired.
 *
 * ═══ THE TWO-STAGE BINDING, and why the second stage exists ═══
 *
 * ANCHOR — a unit satisfying all four conditions. Bound to the blocked pair by
 * label identity.
 *
 * RESTATEMENT — the witnessed reply contradicted itself TWICE, and the second
 * time ANAPHORICALLY: "The subcontracting option's costs are modelled using
 * this 12% figure already". Measured, that sentence scores 1/6 on the option
 * label and 0/6 on the factor label, so NO label binding can reach it — the
 * referent is "this … figure", pointing back at the first sentence. Resolving
 * anaphora over prose is the unwinnable class (trap 22f), so it is not
 * attempted. Instead the second stage is bound by identity to the exact
 * ungrounded numeric STRING the anchor established: a further unit asserting
 * possession of THAT number is the same contradiction restated.
 *
 * ⭐ Stage 2 cannot fire without stage 1. There is no path on which a number
 * alone, or possession language alone, removes anything.
 *
 * ═══ WHY REPEATS ARE ACCEPTED ═══
 *
 * `replaceAssertingUnits` writes one replacement per CONTIGUOUS run, so two
 * non-adjacent contradictions yield the correction twice. That is deliberate.
 * The alternatives are a bespoke collapse rule (a second implementation of the
 * shared surgery — trap 12) or leaving the restatement to ship (a surviving
 * contradiction). A true sentence appearing twice is the mildest of the three
 * harms, and the witnessed output is pinned byte-exactly in the suite so a
 * reviewer reads exactly what a user would.
 */
export function applyBlockedSlotClaimGuard(
  input: BlockedSlotClaimGuardInput,
): BlockedSlotClaimGuardResult {
  const text = input.assistantText;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return unchanged(typeof text === 'string' ? text : '', 'no_text');
  }
  const slots = readBlockedValueSlots(input.blockers);
  // NO BLOCKER ⇒ NO OPINION. Not one byte, and the same reference back.
  if (slots.length === 0) return unchanged(text, 'no_blockers');

  const allLabels = nodesOf(input.persistedGraph).map(nodeLabel).filter((l) => l.length > 0);

  // ONE enumeration, shared by both stages AND by the substitution.
  // `replaceAssertingUnits` re-splits internally, so the predicate it receives
  // must be asked about exactly the strings THIS splitter produces — hence the
  // same exported function, not a second enumeration (trap 12 in the space of
  // two adjacent lines).
  const allUnits = splitIntoRedactableUnits(text);

  const units = new Set<string>();
  const ungrounded = new Set<string>();
  let anchoredSlot: BlockedValueSlot | null = null;

  // ── STAGE 1 · ANCHOR ────────────────────────────────────────────────────
  for (const unit of allUnits) {
    if (!assertsModelPossession(unit)) continue;
    const claimed = readClaimedNumbers(unit);
    if (claimed.length === 0) continue;
    for (const slot of slots) {
      const others = allLabels.filter(
        (l) => l !== slot.optionLabel && l !== slot.factorLabel,
      );
      const names =
        namesEntityUniquely(unit, slot.factorLabel, others)
        || namesEntityUniquely(unit, slot.optionLabel, others);
      if (!names) continue;
      const grounded = groundedValuesForSlot(input.persistedGraph, slot);
      const notAttributed = claimed.filter(
        (c) => !grounded.some((g) => sameMagnitude(c.value, g)),
      );
      // EVERY number grounded ⇒ the sentence is true of this slot. Leave it.
      if (notAttributed.length === 0) continue;
      if (anchoredSlot === null) anchoredSlot = slot;
      for (const c of notAttributed) ungrounded.add(c.raw);
      units.add(unit);
      break;
    }
  }
  if (anchoredSlot === null) return unchanged(text, 'no_contradiction');

  // ── STAGE 2 · RESTATEMENT, bound to the anchored number by identity ──────
  const restatements = new Set<string>();
  for (const unit of allUnits) {
    if (units.has(unit)) continue;
    if (!assertsModelPossession(unit)) continue;
    for (const raw of ungrounded) {
      if (unit.includes(raw)) {
        restatements.add(unit);
        break;
      }
    }
  }

  // TWO PASSES OF THE SAME SHARED SURGERY, not a bespoke collapse rule. The
  // correction is stated once where the claim was first made; a restatement is
  // reduced to a clause. Both passes go through `replaceAssertingUnits`, so the
  // lossless / never-empties / input-reference properties are the shared
  // module's, in both directions (trap 12 — no second implementation).
  const afterAnchors = replaceAssertingUnits(
    text,
    (unit) => units.has(unit),
    buildBlockedSlotCorrection(anchoredSlot),
  );
  const out = replaceAssertingUnits(
    afterAnchors,
    (unit) => restatements.has(unit),
    BLOCKED_SLOT_RESTATEMENT_TEXT,
  );
  if (out === text) return unchanged(text, 'no_contradiction');

  return {
    text: out,
    changed: true,
    mode: 'applied',
    contradictions: Object.freeze([...units, ...restatements]),
    slot: anchoredSlot,
    ungroundedValues: Object.freeze([...ungrounded]),
  };
}
