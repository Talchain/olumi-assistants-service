/**
 * NARRATED FIGURES KEEP THEIR MEANING — polarity-bound grounding for the
 * decision review's "how often the ordering holds / flips" percentages.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT (Paul's manual test, 23 Sep 2026, scenario `58af9704`)
 *
 * The decision-review narrative told the user the ordering "holds in about 70%"
 * of variations. The run carried NO stability figure at all. The 70% was PLoT's
 * `fragile_edges[0].switch_probability = 0.6968` — the probability the ordering
 * FLIPS — and the saved run showed PLoT's own "70% chance this flips" beside it.
 * The same number, told to the user with the opposite meaning.
 *
 * Two things let it through:
 *
 *  1. The served prompt tells the model to write "the ordering holds in about
 *     N% of variations" from `robustness.recommendation_stability`, and PLoT
 *     stopped sending that field on 7 Jul. The model reached for the nearest
 *     percentage in the input instead.
 *  2. Number grounding (`shape-check.ts`) asks only whether a figure is NEAR
 *     some input number (±10%). A flip probability therefore "grounds" a holds
 *     claim, because the rule never asks what the number MEANS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE RULE — each polarity has exactly one source, and no other
 *
 *   A HOLDS figure  ("the ordering holds in about N%", "stays the same in N%")
 *                   is grounded ONLY by `isl_results.robustness
 *                   .recommendation_stability`.
 *   A FLIPS figure  ("could flip in about N%", "N% chance this flips", "the
 *                   ordering changes in N%") is grounded ONLY by
 *                   `isl_results.fragile_edges[].switch_probability` /
 *                   `.marginal_switch_probability`.
 *
 * ⚠ ABSENT SOURCE ⇒ UNGROUNDED. This is deliberately the OPPOSITE of the
 * general grounding rule, which passes every number vacuously when the corpus
 * is empty (`shape-check.ts` `isGrounded`). A holds figure with no stability
 * field is not "unchecked"; it is a stability Olumi was never given.
 *
 * ⚠ NO DERIVED EQUIVALENCE. `1 − switch_probability` is NOT a stability. A
 * switch probability is PER-LINK (how often the ordering flips when THAT link's
 * strength is uncertain); `recommendation_stability` is a RUN-LEVEL measure over
 * all variation. Inventing the equivalence would be the same defect with the
 * arithmetic done for the model. Nothing in this file computes one from the
 * other, and a test pins that a holds figure equal to `1 − p` is still refused.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE READER CATCHES, AND ITS BIAS
 *
 * Only a percentage SYNTACTICALLY ATTACHED to a polarity phrase is bound — the
 * verb followed by an optional preposition and approximator and then the figure
 * ("holds in about 70%"), or the figure followed by chance/probability and the
 * verb ("70% chance this flips"), or "in N% of <runs>, the <ordering> <verb>".
 * A percentage elsewhere in the same sentence ("Option A came out ahead in 62%
 * of runs, but could flip if…") is NOT bound and stays under the general rule.
 *
 * This reader ENFORCES (the enricher and the route replace the sentence), so it
 * is biased to FALSE-NEGATIVE, exactly like `runner-up-gap-statistic.ts`: a
 * negated frame ("does not hold in 30%") is declined rather than inverted, and a
 * figure claimed by BOTH polarities is declined as ambiguous. A declined figure
 * is not waved through — it falls back to the general ±10% rule.
 *
 * PURE. No I/O, no config, never throws.
 */

import { replaceAssertingUnits } from '../../orchestrator-v5/compose/redactable-units.js';

// ============================================================================
// Tolerance — the ONE copy of the ±10% proximity rule
// ============================================================================

/**
 * True when `n` is within ±10% of any value in `values`, also trying the
 * percentage ↔ decimal equivalents (0.77 ≈ 77%) and the k / m magnitude
 * multipliers. Returns FALSE for an empty `values` — the vacuous pass is the
 * CALLER's decision (`shape-check.ts` `isGrounded` makes it for the general
 * corpus; the polarity rule never does).
 *
 * Moved here verbatim from `shape-check.ts` `isGrounded` so the general rule
 * and the polarity rule share one tolerance (CLAUDE.md trap 12: two copies of
 * a threshold drift).
 */
export function isWithinGroundingTolerance(n: number, values: readonly number[]): boolean {
  // Check the original number, percentage equivalents (n/100, n*100),
  // and common magnitude multipliers (k=1000, m=1000000) so that
  // "200" is grounded when the corpus contains 200000 (from "£200k").
  const candidates = [n, n / 100, n * 100, n * 1000, n * 1_000_000];
  for (const candidate of candidates) {
    for (const g of values) {
      if (g === 0 && candidate === 0) return true;
      if (g === 0) continue;
      if (Math.abs((candidate - g) / g) <= 0.10) return true;
    }
  }
  return false;
}

// ============================================================================
// The corpus — one source per polarity
// ============================================================================

export type FigurePolarity = 'holds' | 'flips';

export interface PolarityCorpus {
  /** `isl_results.robustness.recommendation_stability`, when finite. Nothing else. */
  readonly holds: readonly number[];
  /** `isl_results.fragile_edges[].switch_probability` / `.marginal_switch_probability`. Nothing else. */
  readonly flips: readonly number[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Read the two polarity sources from a decision-review input. Accepts both the
 * route's `ReviewInputForGrounding` and the enricher's `invokeInput` — they
 * share the `isl_results.{robustness,fragile_edges}` shape.
 */
export function derivePolarityCorpus(input: unknown): PolarityCorpus {
  const isl = asRecord(asRecord(input)?.isl_results);
  const holds: number[] = [];
  const stability = finite(asRecord(isl?.robustness)?.recommendation_stability);
  if (stability !== null) holds.push(stability);

  const flips: number[] = [];
  const fragile = isl?.fragile_edges;
  if (Array.isArray(fragile)) {
    for (const raw of fragile) {
      const edge = asRecord(raw);
      if (edge === null) continue;
      const p = finite(edge.switch_probability);
      if (p !== null) flips.push(p);
      const marginal = finite(edge.marginal_switch_probability);
      if (marginal !== null) flips.push(marginal);
    }
  }
  return { holds, flips };
}

// ============================================================================
// The reader — which percentages are bound to a polarity phrase
// ============================================================================

export interface PolarityBoundFigure {
  readonly polarity: FigurePolarity;
  /** The figure as written, e.g. 70 for "70%". */
  readonly value: number;
  /** Index of the figure's first digit in the scanned text. */
  readonly index: number;
}

const PCT = String.raw`(?<pct>\d+(?:\.\d+)?)\s*(?:%|per\s?cent\b)`;
const APPROX = String.raw`(?:(?:about|around|roughly|approximately|nearly|almost|some|just\s+(?:over|under)|over|under|more\s+than|less\s+than|at\s+least)\s+)?`;
const PREP = String.raw`(?:(?:in|across|under|over|for|at)\s+)?`;
const ORDER_NOUN = String.raw`(?:ordering|order|ranking|result|recommendation|outcome|lead|leader|winner|choice|conclusion)`;
const RUN_NOUN = String.raw`(?:variations?|runs?|simulations?|scenarios?|samples?|draws?|cases|trials?|the\s+time)`;
const MODAL = String.raw`(?:could|would|may|might|can|will)`;

const HOLDS_VERB = String.raw`(?:holds?|held|holding|(?:stays?|stayed|remains?|remained)\s+(?:the\s+same|unchanged|in\s+place))`;
const FLIPS_VERB = String.raw`(?:flips?|flipped|flipping|${MODAL}\s+flip|${ORDER_NOUN}\s+(?:${MODAL}\s+)?(?:changes?|changed))`;

interface PolarityForm {
  readonly polarity: FigurePolarity;
  readonly re: RegExp;
  /** Whether the verb opens the match, so a negator can be looked for BEFORE it. */
  readonly verbFirst: boolean;
}

function forms(polarity: FigurePolarity, verb: string): PolarityForm[] {
  return [
    // "holds in about 70%", "could flip in roughly 70% of runs", "stays the same in 71%"
    {
      polarity,
      verbFirst: true,
      re: new RegExp(String.raw`\b${verb}(?:\s+(?:up|true|firm))?\s+${PREP}${APPROX}(?:the\s+)?${PCT}`, 'gid'),
    },
    // "70% chance this flips", "a 71% probability that the ordering holds",
    // PLoT's own "45% chance of flipping decision"
    {
      polarity,
      verbFirst: false,
      re: new RegExp(
        String.raw`(?<![\w.])${PCT}\s+(?:chance|probability|likelihood|risk|odds)\s+(?:that\s+|of\s+)?(?:(?:this|it|the\s+${ORDER_NOUN})\s+)?${verb}\b`,
        'gid',
      ),
    },
    // "in about 70% of variations, the ordering holds"
    {
      polarity,
      verbFirst: false,
      re: new RegExp(
        String.raw`\bin\s+${APPROX}${PCT}\s+of\s+(?:the\s+)?${RUN_NOUN},?\s+(?:the\s+)?${ORDER_NOUN}\s+${verb}\b`,
        'gid',
      ),
    },
  ];
}

const POLARITY_FORMS: readonly PolarityForm[] = [
  ...forms('holds', HOLDS_VERB),
  ...forms('flips', FLIPS_VERB),
];

/**
 * A negator shortly before the verb ("does not hold", "won't flip", "never
 * changes"). Present ⇒ decline, rather than invert — the same convention as
 * `prose-fact-agreement.ts`'s NEGATION_PATTERN.
 */
const NEGATION_BEFORE_VERB = /(?:\b(?:not|never|no\s+longer|fails?\s+to|failed\s+to)\s+(?:\w+\s+)?|\w+n['’]t\s+(?:\w+\s+)?)$/i;

/**
 * Every percentage in `text` that is bound to a holds or flips phrase. A figure
 * claimed by both polarities is dropped as ambiguous; a negated frame is
 * declined. Order follows position in `text`.
 */
export function findPolarityBoundFigures(text: string): PolarityBoundFigure[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const byIndex = new Map<number, PolarityBoundFigure | 'ambiguous'>();
  for (const form of POLARITY_FORMS) {
    form.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = form.re.exec(text)) !== null) {
      const span = m.indices?.groups?.pct;
      const raw = m.groups?.pct;
      if (span === undefined || raw === undefined) continue;
      if (form.verbFirst && NEGATION_BEFORE_VERB.test(text.slice(Math.max(0, m.index - 24), m.index))) {
        continue;
      }
      const value = parseFloat(raw);
      if (!Number.isFinite(value)) continue;
      const index = span[0];
      const previous = byIndex.get(index);
      if (previous === undefined) {
        byIndex.set(index, { polarity: form.polarity, value, index });
      } else if (previous !== 'ambiguous' && previous.polarity !== form.polarity) {
        byIndex.set(index, 'ambiguous');
      }
    }
  }
  const out: PolarityBoundFigure[] = [];
  for (const entry of byIndex.values()) {
    if (entry !== 'ambiguous') out.push(entry);
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Is this bound figure grounded by the ONE source its polarity allows? An
 * absent source is ungrounded — never vacuous.
 */
export function isFigureGroundedForPolarity(
  figure: Pick<PolarityBoundFigure, 'polarity' | 'value'>,
  corpus: PolarityCorpus,
): boolean {
  const source = figure.polarity === 'holds' ? corpus.holds : corpus.flips;
  if (source.length === 0) return false;
  return isWithinGroundingTolerance(figure.value, source);
}

// ============================================================================
// The egress repair — per-sentence, never a drop
// ============================================================================

/**
 * The replacement for a sentence whose polarity figure is ungrounded. Two
 * honest cases, because they are different facts:
 *
 *  - the run supplied NO figure for this polarity (today's case for "holds":
 *    PLoT stopped sending `recommendation_stability` on 7 Jul);
 *  - the run supplied one, and the narrated figure does not match it.
 *
 * No digits, no internal field names, no dashes (the review prompt's own
 * punctuation ban). Pinned against the egress forbidden-phrase guard in tests.
 */
export function ungroundedFigureReplacement(polarity: FigurePolarity, sourcePresent: boolean): string {
  const verb = polarity === 'holds' ? 'holds' : 'flips';
  return sourcePresent
    ? `A figure for how often the ordering ${verb} is left out here, because it does not match this run.`
    : `This run does not report how often the ordering ${verb}, so no figure is given for it.`;
}

export interface PolarityFigureRedaction<T> {
  /** The value with every offending sentence replaced. Same reference when clean. */
  readonly value: T;
  /** Sorted dotted field paths that were edited. Never contains prose. */
  readonly paths: readonly string[];
  /** Ungrounded HOLDS figures found in edited fields. */
  readonly holds: number;
  /** Ungrounded FLIPS figures found in edited fields. */
  readonly flips: number;
  /** Whether each polarity's source was present in the input (telemetry, never prose). */
  readonly holdsSourcePresent: boolean;
  readonly flipsSourcePresent: boolean;
}

/**
 * Walk every string in a decision-review output and replace each SENTENCE that
 * narrates a holds / flips percentage its polarity's source does not ground.
 *
 * Per-field, per-sentence, never a drop: the mechanism is
 * `redactable-units.ts` `replaceAssertingUnits` (lossless split, same reference
 * when nothing asserts, never empties), exactly as the runner-up gap policy
 * uses it one step earlier at the same seams. Dropping the whole review would
 * trade one wrong figure for no review at all.
 *
 * The walk is total rather than a field allowlist for the reason
 * `redactRunnerUpGapStatistic` gives: the review writes this figure in more than
 * one field, and ids / timestamps / enums cannot satisfy a polarity pattern.
 */
export function redactUngroundedPolarityFigures<T>(
  value: T,
  reviewInput: unknown,
): PolarityFigureRedaction<T> {
  const corpus = derivePolarityCorpus(reviewInput);
  const holdsSourcePresent = corpus.holds.length > 0;
  const flipsSourcePresent = corpus.flips.length > 0;
  const holdsReplacement = ungroundedFigureReplacement('holds', holdsSourcePresent);
  const flipsReplacement = ungroundedFigureReplacement('flips', flipsSourcePresent);
  const paths = new Set<string>();
  let holds = 0;
  let flips = 0;

  const ungroundedIn = (text: string, polarity: FigurePolarity): number =>
    findPolarityBoundFigures(text).filter(
      (f) => f.polarity === polarity && !isFigureGroundedForPolarity(f, corpus),
    ).length;

  const walk = (node: unknown, path: string): unknown => {
    if (typeof node === 'string') {
      const badHolds = ungroundedIn(node, 'holds');
      const badFlips = ungroundedIn(node, 'flips');
      if (badHolds === 0 && badFlips === 0) return node;
      let next = node;
      if (badHolds > 0) {
        next = replaceAssertingUnits(next, (unit) => ungroundedIn(unit, 'holds') > 0, holdsReplacement);
      }
      if (badFlips > 0) {
        next = replaceAssertingUnits(next, (unit) => ungroundedIn(unit, 'flips') > 0, flipsReplacement);
      }
      // A figure whose binding spans a sentence boundary is not in any one
      // unit, so nothing is replaced — the honest outcome, and the reason this
      // reads the RESULT rather than the whole-string count.
      if (next === node) return node;
      holds += badHolds;
      flips += badFlips;
      paths.add(path === '' ? '<root>' : path);
      return next;
    }
    if (Array.isArray(node)) {
      let changed = false;
      const out = node.map((item, i) => {
        const next = walk(item, `${path}[${i}]`);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? out : node;
    }
    if (node !== null && typeof node === 'object') {
      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
        const next = walk(item, path === '' ? key : `${path}.${key}`);
        if (next !== item) changed = true;
        out[key] = next;
      }
      return changed ? out : node;
    }
    return node;
  };

  return {
    value: walk(value, '') as T,
    paths: [...paths].sort(),
    holds,
    flips,
    holdsSourcePresent,
    flipsSourcePresent,
  };
}
