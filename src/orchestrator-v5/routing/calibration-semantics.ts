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
 * ⭐⭐ MAY THIS CLASSIFICATION BE TURNED INTO A POINT VALUE FOR THE FACTOR?
 * (ROADMAP 2.627.)
 *
 * `probability_only` — YES. "Set X to pretty likely" names one quantity and
 * the phrase IS the user's estimate of it. 0.70 is what they said.
 *
 * `probability_of_threshold` — NO, and this is the whole of 2.627. "Churn
 * staying below 3% is pretty likely" asserts P(churn < 3%) ~ 0.70. It names
 * TWO numbers and the factor's value is NEITHER of them:
 *
 *   - 0.03 is the user's BOUND. The PR already refused to store it (that was
 *     the witnessed live defect).
 *   - 0.70 is a probability ABOUT that bound. `belief-elicitation/index.ts`
 *     declares `CERTAINTY_TERMS` as probability expressions and feeds them to
 *     `elicitBelief` for `target_type: 'prior' | 'edge_weight'` — P(event),
 *     never a factor's level. Storing it as churn says churn is 70%.
 *
 * The statement fixes 3% at roughly the user's 70th percentile. Recovering a
 * point estimate from ONE quantile requires assuming a distributional family
 * the user never named, and inventing one is the same class of defect as the
 * fabricated numbers this estate has spent the week removing.
 *
 * ⚠ AND THE SECOND ANCHOR HAS NOWHERE TO GO — derived at the bytes, because
 * the obvious remedy is to elicit one ("what figure would surprise you to
 * exceed?") and store the resulting range. There is no reachable field:
 *
 *   - `GRAPH_MUTATING_HANDLER_IDS` is {set_factor_value, add_constraint,
 *     adjust_edge_strength}. `set-factor-value.ts`'s own docstring: it
 *     "mutates a factor node's `observed_state.{value, raw_value}`" — a point
 *     value, and nothing else.
 *   - `ObservedStateSchema.std` exists but no handler writes it; the schemas
 *     package's own `EDITABLE_FIELD_TABLE` calls it "a pure uncertainty
 *     tunable with a human setter and NO AI ACCESS".
 *   - `PriorSchema {distribution, range_min, range_max}` and
 *     `StateSpaceSchema {range}` exist on the node but are reachable only
 *     through the `edit_graph` path, which does not run inside
 *     `runTurnExecutor` at all (ROADMAP 2.628a).
 *
 * Two quantiles are two points on a CDF; `range_min`/`range_max` is a support
 * interval and `std` is a Gaussian dispersion. Converting between them needs
 * the same invented assumption — and no reachable handler could store the
 * result anyway. So asking for a second anchor would pose a question whose
 * answer this product cannot keep. The schemas table's own verdict on a field
 * with no reader applies exactly: it "manufactures a lever that moves nothing
 * while looking like it moves something".
 *
 * WHAT IS LEFT IS THE HONEST MINIMUM: say what was understood, say why it is
 * not a value, and ask for the one number that IS storable.
 */
export function mayOfferPointValue(
  classification: CalibrationClassification,
): classification is Extract<CalibrationClassification, { kind: 'probability_only' }> {
  return classification.kind === 'probability_only';
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
    // ⭐ 2.627 — NO POINT VALUE IS OFFERED HERE. See `mayOfferPointValue`
    // above for the derivation. The copy keeps BOTH numbers, each named as
    // what it is (discarding them would throw away the only thing the user
    // actually told us), and ends by asking for the one number this product
    // can honestly store.
    const t = classification.threshold;
    const bound = t.comparator === 'at_most' ? 'stays below' : 'stays above';
    return (
      `I read that as a probability, not as a value: you are saying there is about a ` +
      `${pct} chance that ${target} ${bound} ${formatThreshold(t)} — ` +
      `not that ${target} equals ${formatThreshold(t)}, and not that it equals ${pct}. ` +
      `Nothing has been changed. ` +
      `One probability about one threshold does not pin down a single number for ${target}: ` +
      `I would have to invent a spread you have not given me. ` +
      `What would you put down as your best estimate for ${target} itself?`
    );
  }

  return (
    `"${classification.probability.phrase}" maps to ${pct}. ` +
    `Nothing has been changed. Confirm and I will set ${target} to ${pct}, ` +
    `or give me a different number.`
  );
}

/**
 * The replay message a confirm chip sends — an explicit, unambiguous number,
 * so confirming travels the ordinary numeric path.
 *
 * ⚠ REFUSES `probability_of_threshold` BY CONSTRUCTION (2.627). It threw only
 * on `none` before, and the caller minted a chip reading "Set Monthly Churn
 * Rate to 70%." for a sentence that never said churn was 70%. Making the
 * unsafe conversion UNREPRESENTABLE is the point: a future call site cannot
 * reintroduce it by forgetting a condition. Ask `mayOfferPointValue` first.
 */
export function buildCalibrationConfirmMessage(
  classification: CalibrationClassification,
  targetLabel: string,
): string {
  if (!mayOfferPointValue(classification)) {
    throw new Error(
      `buildCalibrationConfirmMessage refuses classification "${classification.kind}": ` +
        'no point value is derivable from it (ROADMAP 2.627)',
    );
  }
  return `Set ${targetLabel} to ${formatProbabilityPercent(classification.probability.value)}.`;
}

/**
 * ⭐ THE SINGLE PLACE A CALIBRATION REPLY IS ASSEMBLED — text AND chips.
 *
 * Both turn-executor call sites (the STEP 2 consent gate and the calibration
 * pre-route) consume THIS, rather than composing a chip apiece beside a
 * shared text builder. That was the shape 2.627 shipped in, and it is a
 * hand-maintained mirror in miniature (CLAUDE.md trap 12): two sites, one
 * "is a value offerable here?" judgement, no derivation between them. Now
 * there is exactly one, and a call site cannot mint a numeric chip because it
 * never constructs one.
 */
export function buildCalibrationReply(
  classification: CalibrationClassification,
  targetLabel: string | null,
): {
  readonly assistant_text: string;
  readonly suggested_actions: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly message: string;
  }>;
} {
  const assistant_text = buildCalibrationPreviewText(classification, targetLabel);
  if (targetLabel === null || !mayOfferPointValue(classification)) {
    return { assistant_text, suggested_actions: [] };
  }
  return {
    assistant_text,
    suggested_actions: [
      {
        // `chip_prompt_*` (suggestion family), not `chip_clarify_*`: this is
        // a route the user MAY take, not an answer to a question we asked.
        // The egress chip finaliser sizes and dedupes the two differently.
        id: 'chip_prompt_calibration_confirm',
        label: `Use ${formatProbabilityPercent(classification.probability.value)}`,
        message: buildCalibrationConfirmMessage(classification, targetLabel),
      },
    ],
  };
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
