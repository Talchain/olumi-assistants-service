/**
 * ⭐⭐ THE WORD "PERCENT" IS A STATED UNIT — AND IT MUST SURVIVE TO THE ANALYSIS
 * GATE, EXACTLY AS THE SYMBOL DOES.
 *
 * THE CAPTURED FAILURE (deployed staging, native guest, 2026-08-31 02:48-02:50
 * UTC; UI 80843cb6 / CEE fa2c9e93 / PLoT d37c8cf / ISL 28fe0c9). The user typed:
 *
 *   "For the factor Specialist review coverage, record 12 percent as the
 *    current measured coverage: 12 out of every 100 solved tickets currently
 *    receive specialist review."
 *
 * The edit was ACCEPTED and attributed to the user. The rerun then refused:
 * "Specialist review coverage is recorded as a bare amount with no range for me
 * to measure it against."
 *
 * THE FIRST LOST CONTRACT, derived at the bytes with a contrast control: CQE's
 * grammar (`rules.ts`) knew `%` and did not know the word. So
 * `extractQuantities` returned `{value: 12, unit: null}` for the sentence above
 * and `{value: 0.12, unit: 'percentage'}` for the same sentence written "12%".
 * Every later hop then carried the unitless 12 faithfully — proposal
 * `{value: 12}` with no unit, `inputHasUnit: false`, and a persisted pair
 * `{value: 12, raw_value: 12}` that positively asserts "12 is already on the
 * analysis scale". The baseline gate was RIGHT to refuse that pair; it is not
 * touched by this fix, and every test below that asserts a refusal proves it.
 *
 * WHAT THIS SPEC WALKS — the whole chain, in production order, no fixture
 * standing in for a producer:
 *
 *   extractQuantities                (CQE grammar — the repaired hop)
 *     → mapCqeQuantityToProposalValue (routing: CQE units → proposal units)
 *     → canonicaliseUnitForDisplay    (what `parseProposalValue` applies, and
 *                                      the sole source of `inputHasUnit`)
 *     → normaliseFactorValue          (the canonical edit writer, #1236)
 *     → findScaleIncoherentBaselineFactorIds / decideAnalysisScaleBlock
 *                                     (the analysis-readiness gate)
 *
 * THE FIXTURE'S STATE-CLASS IS NAMED, because it decides the outcome. The
 * captured target was "Moderate / estimated with NO OBSERVED DATA": no
 * `observed_state.value`, no `raw_value`, no `cap`, no `scale_frame`. A factor
 * that DOES carry a recorded value but no unit is refused earlier and
 * separately by `unit_redeclares_scale` (ROADMAP 2.159) — for the SYMBOL and
 * the WORD alike, before and after this change. That arm is pinned below so
 * the two refusals are never conflated.
 */

import { describe, expect, it } from 'vitest';
import { extractQuantities } from '../extract-quantities.js';
import {
  mapCqeQuantityToProposalValue,
  tryDeterministicValueUpdate,
} from '../../../routing/deterministic-value-update.js';
import type { GraphLookup } from '../../../routing/validator.js';
import { canonicaliseUnitForDisplay } from '../../../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import { normaliseFactorValue } from '../../../tools/handlers/d1-shared/normalise-factor-value.js';
import {
  decideAnalysisScaleBlock,
  findScaleIncoherentBaselineFactorIds,
} from '../../../tools/plot-intervention-scale.js';
import type { QuantityExtractionResult } from '../schema-types.js';

/** The exact factor the native capture edited. Bound by id, never by value. */
const TARGET = 'f_specialist_review_coverage';
/**
 * The unrelated named factor the capture used as its own binding control: it
 * stayed "Moderate / estimated" throughout and must NEVER appear in a verdict.
 */
const DECOY_ESTIMATE = 'f_self_service_guidance_quality';
/**
 * ⭐ THE DISCRIMINATION CONTROL, and the reason a passing arm below is not
 * vacuous. This factor carries a genuinely unframed raw baseline
 * (`{value: 12, raw_value: 12}`) — the SAME magnitude 12 as the target's
 * `raw_value`, so no value predicate can tell the two apart. The gate MUST
 * keep listing it in every arm, including the arms where the target is
 * cleared. A gate that had simply been switched off would pass the "target is
 * absent" assertion and fail this one.
 */
const DECOY_UNFRAMED = 'f_unframed_raw_sibling';

interface BeforeState {
  readonly value?: number;
  readonly unit?: string;
}

type WalkOutcome =
  | { readonly kind: 'no_quantity' }
  | { readonly kind: 'rejected_at_writer'; readonly rejection_reason: unknown }
  | {
      readonly kind: 'walked';
      readonly cqe: { readonly value: number | null; readonly unit: string | null };
      readonly proposalValue: number;
      readonly proposalUnit: string | undefined;
      readonly inputHasUnit: boolean;
      readonly pair: { readonly raw_value: number; readonly value: number };
      readonly blockedIds: readonly string[];
      readonly verdict: ReturnType<typeof decideAnalysisScaleBlock>;
    };

/**
 * Walk one user sentence through the production chain. `before` is the target
 * factor's PERSISTED state; the default `{}` is the captured native state — an
 * unframed, unvalued, uncapped factor.
 */
function walk(message: string, before: BeforeState = {}): WalkOutcome {
  const quantities = extractQuantities(message);
  const quantity = quantities[0];
  if (quantity === undefined) return { kind: 'no_quantity' };

  const mapped = mapCqeQuantityToProposalValue(quantity as QuantityExtractionResult);
  // `parseProposalValue` (set-factor-value.ts) applies exactly this
  // canonicalisation and derives `inputHasUnit` from its result — a
  // whitespace-only unit is not a unit.
  const unit = canonicaliseUnitForDisplay(mapped.unit ?? undefined);
  const inputHasUnit = unit !== undefined;

  let pair: { raw_value: number; value: number };
  try {
    pair = normaliseFactorValue({
      rawInput: mapped.value,
      ...(unit !== undefined ? { unit } : {}),
      ...(before.value !== undefined ? { factorObservedValue: before.value } : {}),
      ...(before.unit !== undefined ? { factorUnit: before.unit } : {}),
      inputHasUnit,
    });
  } catch (error) {
    const details = (error as { details?: { rejection_reason?: unknown } }).details;
    return { kind: 'rejected_at_writer', rejection_reason: details?.rejection_reason };
  }

  const nodes = [
    {
      id: TARGET,
      kind: 'factor',
      label: 'Specialist review coverage',
      observed_state: { value: pair.value, raw_value: pair.raw_value },
    },
    {
      id: DECOY_ESTIMATE,
      kind: 'factor',
      label: 'Self-service guidance quality',
      observed_state: { value: 0.5 },
    },
    {
      id: DECOY_UNFRAMED,
      kind: 'factor',
      label: 'Unframed raw sibling',
      observed_state: { value: 12, raw_value: 12 },
    },
  ];

  const blockedIds = findScaleIncoherentBaselineFactorIds(nodes, [], []);
  return {
    kind: 'walked',
    cqe: { value: quantity.value, unit: quantity.unit },
    proposalValue: mapped.value,
    proposalUnit: mapped.unit,
    inputHasUnit,
    pair,
    blockedIds,
    verdict: decideAnalysisScaleBlock(
      { mixedUnresolved: false, unresolvedFactorIds: [] },
      blockedIds,
    ),
  };
}

function walked(message: string, before: BeforeState = {}) {
  const out = walk(message, before);
  if (out.kind !== 'walked') {
    throw new Error(`expected a completed walk for ${JSON.stringify(message)}, got ${out.kind}`);
  }
  return out;
}

/** The captured utterance, verbatim, minus nothing. */
const CAPTURED_UTTERANCE =
  'For the factor Specialist review coverage, record 12 percent as the current measured coverage: ' +
  '12 out of every 100 solved tickets currently receive specialist review. This is new information ' +
  "I am supplying now. Change only this factor's current baseline value; leave all option effects, " +
  'other factors and the goal unchanged.';

/** Every spelled-out form this change admits. Exhaustive by intent. */
const PERCENT_SPELLINGS = ['percent', 'per cent', 'pct'] as const;

describe('a stated percentage survives CQE → proposal → writer → analysis gate', () => {
  it('extracts the captured native utterance as a percentage, not a bare 12', () => {
    const quantities = extractQuantities(CAPTURED_UTTERANCE);
    expect(quantities.length).toBeGreaterThan(0);
    expect(quantities[0]).toMatchObject({ value: 0.12, unit: 'percentage' });
  });

  it('walks the captured native utterance to a RUNNABLE analysis', () => {
    const out = walked(CAPTURED_UTTERANCE);
    // The unit reaches the writer, and the writer frames by 100.
    expect(out.proposalUnit).toBe('%');
    expect(out.inputHasUnit).toBe(true);
    expect(out.pair).toEqual({ raw_value: 12, value: 0.12 });
    // Bound by IDENTITY: the target is cleared, the unframed sibling is not.
    expect(out.blockedIds).not.toContain(TARGET);
    expect(out.blockedIds).toContain(DECOY_UNFRAMED);
    expect(out.blockedIds).not.toContain(DECOY_ESTIMATE);
  });

  it.each(PERCENT_SPELLINGS)(
    'honours the spelled-out "%s" on an explicit set, exactly as the symbol is honoured',
    (spelling) => {
      const word = walked(`Set Specialist review coverage to 12 ${spelling}`);
      const symbol = walked('Set Specialist review coverage to 12%');
      expect(word.pair).toEqual({ raw_value: 12, value: 0.12 });
      expect(word.pair).toEqual(symbol.pair);
      expect(word.verdict).toEqual(symbol.verdict);
      expect(word.blockedIds).not.toContain(TARGET);
    },
  );

  /**
   * ⭐ THE PRODUCTION PRE-ROUTE, not a stand-in. `tryDeterministicValueUpdate`
   * is the branch turn-executor.ts consults before the LLM; when it matches,
   * the whole edit is deterministic and no model judgement is involved.
   */
  const GRAPH: GraphLookup = {
    findEntityById: (id) =>
      id === TARGET
        ? { id: TARGET, kind: 'node', label: 'Specialist review coverage' }
        : id === DECOY_ESTIMATE
          ? { id: DECOY_ESTIMATE, kind: 'node', label: 'Self-service guidance quality' }
          : null,
    listEntitiesByKind: (kind) =>
      kind === 'node'
        ? [
            { id: TARGET, label: 'Specialist review coverage' },
            { id: DECOY_ESTIMATE, label: 'Self-service guidance quality' },
          ]
        : [],
  };

  it.each(PERCENT_SPELLINGS)(
    'the deterministic pre-route dispatches the edit on the named factor for "%s"',
    (spelling) => {
      const message = `Set Specialist review coverage to 12 ${spelling}`;
      const result = tryDeterministicValueUpdate(
        message,
        extractQuantities(message),
        GRAPH,
        [],
        new Set([TARGET, DECOY_ESTIMATE]),
        false,
      );
      expect(result.matched).toBe(true);
      // Bound by IDENTITY — the decoy shares the word "coverage".
      expect(result).toMatchObject({
        dispatch: 'set_factor_value',
        candidate: { id: TARGET },
        quantity: { value: 0.12, unit: 'percentage' },
      });
    },
  );

  /**
   * ⭐ WHEN THE PRE-ROUTE ABSTAINS the turn goes to the LLM, which is handed
   * `parsed_quantities` under a routing prompt that says "Use parsed_quantities
   * first". That array now carries the FRACTION (CQE's convention) rather than
   * a unitless 12 — so this pins the claim that matters and no more: whichever
   * of the two numbers a router forwards under the '%' unit, the writer lands
   * inside [0,1] and the gate passes. `unitPinnedScaleFrame` abstains at or
   * below magnitude 1 and pins 100 above it, which is what makes both true.
   */
  it('either number a router could forward under "%" reaches a runnable analysis', () => {
    for (const rawInput of [12, 0.12]) {
      const pair = normaliseFactorValue({ rawInput, unit: '%', inputHasUnit: true });
      expect(pair.value, String(rawInput)).toBeGreaterThanOrEqual(0);
      expect(pair.value, String(rawInput)).toBeLessThanOrEqual(1);
      expect(pair.value, String(rawInput)).toBeCloseTo(0.12, 10);
    }
  });

  it('is the exact repair for the captured refusal: the same sentence WITHOUT a stated unit is still refused, by name', () => {
    const unitless = walked(
      'For the factor Specialist review coverage, record 12 as the current measured coverage.',
    );
    expect(unitless.inputHasUnit).toBe(false);
    expect(unitless.pair).toEqual({ raw_value: 12, value: 12 });
    expect(unitless.verdict).toEqual({
      blocked: true,
      reason_code: 'baseline_scale_unresolved',
      unresolvedFactorIds: [TARGET, DECOY_UNFRAMED],
    });
  });
});

describe('closing the percent gap does not open a currency or count lie', () => {
  it('a currency amount pins no frame and the run is still refused, naming the target', () => {
    const out = walked('Set Specialist review coverage to £12000');
    expect(out.proposalUnit).toBe('£');
    expect(out.inputHasUnit).toBe(true);
    // The unit is stated and honoured as metadata, but no frame is pinned:
    // `unitPinnedScaleFrame` returns percent and basis points and NOTHING else.
    expect(out.pair).toEqual({ raw_value: 12000, value: 12000 });
    expect(out.verdict).toEqual({
      blocked: true,
      reason_code: 'baseline_scale_unresolved',
      unresolvedFactorIds: [TARGET, DECOY_UNFRAMED],
    });
  });

  it('a bare count is still refused', () => {
    const out = walked('Set Specialist review coverage to 12000');
    expect(out.inputHasUnit).toBe(false);
    expect(out.pair).toEqual({ raw_value: 12000, value: 12000 });
    expect(out.verdict).toMatchObject({ reason_code: 'baseline_scale_unresolved' });
  });

  it('percentage points keep their own class and are NOT re-read as percent', () => {
    for (const message of [
      'Set Specialist review coverage to 12 percentage points',
      'Set Specialist review coverage to 12 percentage point',
      'Set Specialist review coverage to 12 pp',
      'increase Specialist review coverage by 12 percentage points',
    ]) {
      const quantity = extractQuantities(message)[0];
      expect(quantity, message).toMatchObject({ value: 12, unit: 'percentage_points' });
    }
  });

  it('the word boundary holds: percentile / percentage / plurals are not percent', () => {
    // Each of these ends the percent token with a letter, so `(?![a-z])`
    // refuses it. Abstention is the safe direction: the value stays unitless
    // and the analysis gate keeps refusing it, visibly.
    for (const token of ['percentile', 'percentage', 'percents', 'pcts', 'percentiles']) {
      const quantity = extractQuantities(`Set Specialist review coverage to 12 ${token}`)[0];
      expect(quantity, token).toMatchObject({ value: 12, unit: null });
    }
  });

  it('a factor that already records a value but no unit is refused EARLIER, and identically for the word and the symbol (ROADMAP 2.159, untouched)', () => {
    // Named apart from the baseline gate so the two refusals are never
    // conflated: this one fires at the WRITER, before any gate runs.
    for (const message of [
      'Set Specialist review coverage to 12 percent',
      'Set Specialist review coverage to 12%',
    ]) {
      expect(walk(message, { value: 0.5 }), message).toEqual({
        kind: 'rejected_at_writer',
        rejection_reason: 'unit_redeclares_scale',
      });
    }
  });
});

/**
 * ⭐ THE DERIVED GUARD. It does not restate the grammar — it asserts the
 * PROPERTY the change exists to establish: a sentence written with the word
 * extracts exactly as the same sentence written with the symbol. It is
 * therefore blind to nothing that a rule I failed to update would break, and it
 * needs no second copy of the vocabulary to stay true.
 *
 * ⚠ It pins its own size and its own DISCRIMINATION, because a comparator that
 * cannot tell anything apart agrees with everything (trap 13b).
 */
const DIFFERENTIAL_TEMPLATES = [
  'Set coverage to 12{U}',
  'Set the churn rate to 4{U}',
  'Increase coverage by 12{U}',
  'Reduce churn by 12{U}',
  'grew 5{U}',
  'raise it 5{U}',
  'coverage is 12{U}',
  'record 12{U} as the current measured coverage',
  'at least 12{U}',
  'at most 12{U}',
  'between 10{U} and 20{U}',
  'from 10{U} to 20{U}',
  'about 12{U}',
  'coverage of 12.5{U}',
  'Set coverage to 0.5{U}',
  'Set coverage to 150{U}',
  'change coverage to 12{U} and churn to 4{U}',
] as const;

/** Everything a consumer reads. `raw_text` and spans legitimately differ. */
function semantics(message: string): string {
  return extractQuantities(message)
    .map((q) => `${q.value}|${q.unit}|${q.operator}|${q.direction}|${q.source}`)
    .join(' ; ');
}

describe('the word and the symbol are one grammar (derived differential)', () => {
  it('pins the corpus size, so a silently emptied corpus cannot pass', () => {
    expect(DIFFERENTIAL_TEMPLATES.length).toBe(17);
    expect(PERCENT_SPELLINGS.length).toBe(3);
  });

  it('the comparator discriminates — it is not agreeing with itself', () => {
    // A percentage and its percentage-POINTS neighbour must not compare equal,
    // or every "SAME" below would be worthless.
    expect(semantics('Set coverage to 12%')).not.toBe(
      semantics('Set coverage to 12 percentage points'),
    );
    // And the pre-repair shape (a bare number) must differ from the repaired one.
    expect(semantics('Set coverage to 12')).not.toBe(semantics('Set coverage to 12%'));
    // Non-empty inputs, asserted rather than assumed.
    expect(semantics('Set coverage to 12%').length).toBeGreaterThan(0);
  });

  it.each(PERCENT_SPELLINGS)('every template agrees for "%s"', (spelling) => {
    for (const template of DIFFERENTIAL_TEMPLATES) {
      const symbol = semantics(template.replaceAll('{U}', '%'));
      const word = semantics(template.replaceAll('{U}', ` ${spelling}`));
      expect(word, `${template} [${spelling}]`).toBe(symbol);
    }
  });
});
