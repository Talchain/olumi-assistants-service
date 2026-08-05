/**
 * ⭐ CALIBRATION SEMANTICS — ONE deterministic layer for recognised
 * probability phrases, consumed by the path that MUTATES the graph.
 *
 * WHY THIS EXISTS (witnessed live on staging CEE `e82738b2`, 5 Aug 2026,
 * independent simulated-user review §2.1):
 *
 *   user: "I think monthly churn staying below 3% in December is pretty
 *          likely. Please set that estimate and show me the number you
 *          will use before applying it."
 *   system: applied 3% to Monthly Churn Rate, unconfirmed, and said so
 *           in a reply that also carried its own routing deliberation.
 *
 * TWO separate failures, both fixed here:
 *
 *  1. THE SEMANTIC LAYER EXISTED AND WAS NOT WIRED. `src/cee/belief-
 *     elicitation/index.ts` has mapped "pretty likely" to 0.70 since it
 *     was written. Its ONLY caller in `src/` was the standalone
 *     `/assist/v1/elicit-belief` REST route — never V5 routing. So the
 *     mutating path had no idea what the phrase meant, and in sibling
 *     sessions refused it outright ("...doesn't currently carry a
 *     percentage scale in your model") on factors the UI was rendering
 *     as `0% -> 100%` at 35%.
 *
 *  2. THRESHOLD READ AS VALUE. "churn stays below 3% is pretty likely"
 *     asserts P(churn < 3%) ~ 0.70. It does NOT assert "churn = 3%".
 *     The 3% is the user's THRESHOLD; the estimate is the PROBABILITY.
 *     ⚠ MEASURED ROOT CAUSE: CQE's comparator lexicon
 *     (`COMPARATOR_ATMOST_SOURCE`) admits `under` but NOT `below`, so
 *     `extractQuantities` returned `comparator: null` for the witnessed
 *     sentence and `comparator: 'at_most'` for the same sentence with
 *     `under`. The threshold marker was invisible. This module carries a
 *     SUPERSET of CQE's markers and `__tests__/calibration-semantics
 *     .test.ts` asserts the superset property by importing both sources,
 *     so the two lists cannot drift apart silently (CLAUDE.md trap 12d:
 *     a derived guard proves agreement, never completeness — the union
 *     assertion is the derivable half, the hand-written corpus in the
 *     same spec is the other half; ship BOTH).
 *
 * SCOPE DISCIPLINE — this module is PURE and never applies anything. It
 * classifies. The decision not to mutate is enforced by the caller at the
 * action layer (`mutation-consent.ts` + turn-executor), because a
 * guarantee implemented in prose is not a guarantee.
 */

import {
  COMPARATOR_ATLEAST_SOURCE,
  COMPARATOR_ATMOST_SOURCE,
  CQE_NUMERIC_SOURCE,
} from '../context/cqe/rules.js';
import { CERTAINTY_TERMS } from '../../cee/belief-elicitation/index.js';

/**
 * Phrases from `CERTAINTY_TERMS` that must NOT trigger the deterministic
 * calibration route, because in ordinary conversation they carry no
 * calibration intent at all: "is that possible?", "maybe later", "never
 * mind". Firing on these would hijack the turn away from the LLM for
 * messages that are not calibration messages.
 *
 * DIRECTION OF THE ASYMMETRY (deliberate, same reasoning as the routing
 * `edge_phrasing_gate`): a phrase wrongly EXCLUDED costs one LLM call on
 * a path the LLM already serves. A phrase wrongly INCLUDED hijacks an
 * unrelated turn. Where the phrase is ambiguous it is excluded.
 *
 * This is a subtraction from a canonical map, not a re-listing of it —
 * the VALUES still come from `CERTAINTY_TERMS`, so a value change there
 * propagates here automatically. The spec asserts every remaining phrase
 * resolves to the identical number on both paths.
 */
const CONVERSATIONALLY_AMBIGUOUS_PHRASES: ReadonlySet<string> = new Set([
  'possible',
  'possibly',
  'maybe',
  'perhaps',
  'expected',
  'anticipate',
  'uncertain',
  'never',
  'rare',
  'probable',
  'probably',
  'likely',
  'certain',
  'certainly',
  'definitely',
  'absolutely',
  'guaranteed',
  'inevitable',
  'undoubtedly',
  'unquestionably',
  'unlikely',
  'improbable',
  'doubtful',
  'impossible',
]);

/**
 * The routing-side phrase table: `CERTAINTY_TERMS` minus the
 * conversationally-ambiguous entries. DERIVED, never re-typed.
 */
export const CALIBRATION_PHRASES: ReadonlyMap<string, number> = new Map(
  Object.entries(CERTAINTY_TERMS)
    .filter(([phrase]) => !CONVERSATIONALLY_AMBIGUOUS_PHRASES.has(phrase))
    .map(([phrase, value]) => [phrase.toLowerCase(), value]),
);

/**
 * Threshold markers. A SUPERSET of CQE's two comparator alternations,
 * plus the words CQE's lexicon is measurably missing.
 *
 * `below` / `above` / `beneath` / `beyond` are the measured gap (see the
 * module docstring); `at or below` / `at or above` / `no higher than` /
 * `no lower than` come from the hand-written corpus in the spec, which is
 * what can notice the list is SHORT — derivation from CQE can only notice
 * that the two lists DISAGREE.
 */
const EXTRA_THRESHOLD_MARKERS = String.raw`below|above|beneath|beyond|at\s+or\s+below|at\s+or\s+above|no\s+higher\s+than|no\s+lower\s+than|stays?\s+below|stays?\s+above`;

const THRESHOLD_MARKER_SOURCE = `${COMPARATOR_ATMOST_SOURCE}|${COMPARATOR_ATLEAST_SOURCE}|${EXTRA_THRESHOLD_MARKERS}`;

/** Exposed for the union assertion in the spec — never for re-implementation. */
export const THRESHOLD_MARKER_SOURCE_FOR_TESTS = THRESHOLD_MARKER_SOURCE;

const AT_LEAST_TEST = new RegExp(
  `^(?:${COMPARATOR_ATLEAST_SOURCE}|above|beyond|at\\s+or\\s+above|no\\s+lower\\s+than|stays?\\s+above)$`,
  'i',
);

/**
 * `<marker> <optional currency-ish prefix> <number> <optional %>`.
 * The numeric grammar is CQE's own (`CQE_NUMERIC_SOURCE`) so the two
 * cannot drift — the same reuse discipline the routing `from X to Y`
 * anchor adopted after two drift bugs.
 */
const THRESHOLD_ANCHOR_PATTERN = new RegExp(
  String.raw`\b(?<marker>${THRESHOLD_MARKER_SOURCE})\s+(?<num>${CQE_NUMERIC_SOURCE})\s*(?<pct>%)?`,
  'i',
);

export interface CalibrationThreshold {
  /** Normalised: a `%` threshold is expressed on 0-1, matching CQE. */
  readonly value: number;
  readonly raw_number: number;
  readonly unit: 'percentage' | null;
  readonly comparator: 'at_least' | 'at_most';
  readonly marker: string;
}

export interface CalibrationPhraseMatch {
  readonly phrase: string;
  readonly value: number;
}

/**
 * Longest-match-wins lookup of a recognised probability phrase.
 *
 * Longest first matters: "pretty likely" and "likely" would both match
 * "…is pretty likely", and only the longer one carries the user's
 * meaning. (`likely` is excluded above anyway; the ordering is what stops
 * the class of bug, not the specific entry.)
 */
export function detectProbabilityPhrase(
  message: string,
): CalibrationPhraseMatch | null {
  const haystack = message.toLowerCase();
  let best: CalibrationPhraseMatch | null = null;
  for (const [phrase, value] of CALIBRATION_PHRASES) {
    if (!haystack.includes(phrase)) continue;
    if (best === null || phrase.length > best.phrase.length) {
      best = { phrase, value };
    }
  }
  return best;
}

/**
 * The number the user named as a BOUND, not as the value.
 *
 * Returns null when the message carries no threshold marker — in which
 * case any quantity present really is a candidate value and the ordinary
 * numeric path owns it.
 */
export function detectThreshold(message: string): CalibrationThreshold | null {
  const m = THRESHOLD_ANCHOR_PATTERN.exec(message);
  if (m?.groups === undefined) return null;
  const rawNumber = Number(m.groups.num?.replace(/minus\s+/i, '-'));
  if (!Number.isFinite(rawNumber)) return null;
  const isPercent = m.groups.pct !== undefined;
  const marker = (m.groups.marker ?? '').trim().toLowerCase();
  return {
    value: isPercent ? rawNumber / 100 : rawNumber,
    raw_number: rawNumber,
    unit: isPercent ? 'percentage' : null,
    comparator: AT_LEAST_TEST.test(marker) ? 'at_least' : 'at_most',
    marker,
  };
}

export type CalibrationClassification =
  | { readonly kind: 'none' }
  /**
   * The user asserted a probability ABOUT a threshold:
   * "churn staying below 3% is pretty likely" -> P(churn < 3%) ~ 0.70.
   * The 3% is `threshold`; the estimate is `probability`. Storing
   * `threshold` as the factor's value is THE witnessed defect.
   */
  | {
      readonly kind: 'probability_of_threshold';
      readonly probability: CalibrationPhraseMatch;
      readonly threshold: CalibrationThreshold;
    }
  /** "Set <factor> to pretty likely" — a bare qualitative estimate. */
  | {
      readonly kind: 'probability_only';
      readonly probability: CalibrationPhraseMatch;
    };

export function classifyCalibrationMessage(
  message: string,
): CalibrationClassification {
  const probability = detectProbabilityPhrase(message);
  if (probability === null) return { kind: 'none' };
  const threshold = detectThreshold(message);
  return threshold === null
    ? { kind: 'probability_only', probability }
    : { kind: 'probability_of_threshold', probability, threshold };
}

/** `0.7` -> `"70%"`. Trailing zeros trimmed; never scientific notation. */
export function formatProbabilityPercent(value: number): string {
  const pct = value * 100;
  const rounded = Math.round(pct * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatThreshold(t: CalibrationThreshold): string {
  return t.unit === 'percentage' ? `${t.raw_number}%` : `${t.raw_number}`;
}

/**
 * The user-visible preview. Composed HERE, deterministically, from the
 * classification — never by the model. That is not a style choice: on the
 * witnessed turn the model's own routing deliberation was rendered into
 * the reply, and a reply this module composes cannot carry it.
 *
 * `targetLabel` is null when the factor could not be resolved with
 * certainty; the copy then asks which factor rather than guessing one.
 */
export function buildCalibrationPreviewText(
  classification: CalibrationClassification,
  targetLabel: string | null,
): string {
  if (classification.kind === 'none') {
    throw new Error('buildCalibrationPreviewText called with no classification');
  }
  const pct = formatProbabilityPercent(classification.probability.value);
  const target = targetLabel ?? 'that factor';

  if (classification.kind === 'probability_of_threshold') {
    const t = classification.threshold;
    const bound = t.comparator === 'at_most' ? 'stays below' : 'stays above';
    return (
      `I read that as a probability, not as the value itself: you are saying there is about a ` +
      `${pct} chance that ${target} ${bound} ${formatThreshold(t)} — ` +
      `not that ${target} equals ${formatThreshold(t)}. ` +
      `"${classification.probability.phrase}" maps to ${pct}. ` +
      `Nothing has been changed. Confirm and I will set ${target} to ${pct}, ` +
      `or give me a different number.`
    );
  }

  return (
    `"${classification.probability.phrase}" maps to ${pct}. ` +
    `Nothing has been changed. Confirm and I will set ${target} to ${pct}, ` +
    `or give me a different number.`
  );
}

/** The replay message a confirm chip sends — an explicit, unambiguous number. */
export function buildCalibrationConfirmMessage(
  classification: CalibrationClassification,
  targetLabel: string,
): string {
  if (classification.kind === 'none') {
    throw new Error('buildCalibrationConfirmMessage called with no classification');
  }
  return `Set ${targetLabel} to ${formatProbabilityPercent(classification.probability.value)}.`;
}

/**
 * Resolve the ONE factor the user's message names, for the preview copy.
 *
 * Substring only, and only when EXACTLY ONE factor label matches. No fuzzy
 * matching: naming the wrong factor in a sentence that says "nothing has
 * been changed" would be its own trust defect, and "that factor" is an
 * honest fallback. The caller passes null through to copy that asks which
 * factor rather than guessing one.
 *
 * Deliberately NOT the routing matcher (`tryDeterministicValueUpdate`'s
 * Dice fallback): that matcher exists to pick a MUTATION target with the
 * validator downstream of it. This one only decorates a sentence, so it is
 * held to a stricter, evidence-only standard.
 */
export function resolveFactorLabelForConsentPreview(
  message: string,
  graph: { readonly nodes?: readonly unknown[] } | null | undefined,
): string | null {
  const nodes = graph?.nodes ?? [];
  const haystack = message.toLowerCase();
  const hits: string[] = [];
  for (const raw of nodes) {
    const n = raw as { kind?: unknown; label?: unknown };
    if (n.kind !== 'factor') continue;
    if (typeof n.label !== 'string') continue;
    const label = n.label.trim();
    if (label.length === 0) continue;
    if (haystack.includes(label.toLowerCase())) hits.push(label);
  }
  return hits.length === 1 ? hits[0]! : null;
}
