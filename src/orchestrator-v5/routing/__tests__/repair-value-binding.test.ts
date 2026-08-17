/**
 * ⭐ ROADMAP 2.1261 — repair-leg bare-value binding: the claim predicate and
 * the pair derivation.
 *
 * CORPUS PROVENANCE (trap 22 — never from the author's head alone):
 *   - the wire-witnessed strings from the #998 witness run, VERBATIM
 *     (olumi-docs/witness-998-2026-08-16, scenario a05fefcd…): the trapped
 *     user's exact turn-3 message, their turn-2 unit message, the diagnostic
 *     turn-4 explicit phrasing, and the product's own retry-chip copy;
 *   - the #998 lane's pinned qualitative gap set
 *     (`QUALITATIVE_VALUE_KNOWN_DROPPED`), imported, not copied;
 *   - the #998 review's own boundary example ("Update the timeline to
 *     3 months") and the estate's T12/T12c/T15 configure capture shapes.
 *
 * Every positive case has opposite-direction twins (unit-bearing, named
 * target, question lead, trailing clause) asserted NOT to match.
 */
import { describe, expect, it } from 'vitest';

import {
  REPAIR_BARE_VALUE_KNOWN_DROPPED,
  deriveMissingEffectPairs,
  matchBareRepairValue,
  resolveRepairValueBinding,
} from '../repair-value-binding.js';
import { QUALITATIVE_VALUE_KNOWN_DROPPED } from '../../compose/configure-option-clarify-response.js';
import type { AnalysisReadyPayload } from '../../compose/analysis-ready-emit.js';

// ── the claim predicate ─────────────────────────────────────────────────────

/** Messages the predicate MUST claim. RED if the anchor silently narrows. */
const CLAIMED: ReadonlyArray<readonly [string, string]> = [
  // The witnessed trapped message, byte-verbatim (a2-turn3-request.json).
  ['Set it to 0.12.', '0.12'],
  ['set it to 0.12', '0.12'],
  ['Set it to 0.12!', '0.12'],
  ['Please set it to 0.5.', '0.5'],
  ['Change it to 0.3.', '0.3'],
  ['Update it to 1.', '1'],
  ['Adjust it to 0.25.', '0.25'],
  ['Set that to 0.12.', '0.12'],
  ['Set this one to 0.4.', '0.4'],
  ['Set the value to 0.12.', '0.12'],
  ['Set the effect value to 0.7.', '0.7'],
  ['Set the missing value to 0.12.', '0.12'],
  ['Set to 0.12.', '0.12'],
  ['set   it   to   0.12 .', '0.12'],
  ['Set it to 1,200.', '1,200'],
];

/** Messages the predicate MUST NOT claim — each is an opposite-direction twin. */
const NEVER_CLAIMED: readonly string[] = [
  // Witnessed turn 2, byte-verbatim: names a factor AND carries a unit — its
  // honest refusal must stay reachable exactly as it is.
  'The subcontractor cost should be 12% of revenue on the affected routes.',
  // Witnessed turn 4, byte-verbatim: the explicit phrasing routes via the
  // configure/effect lane and must keep doing so.
  'For the subcontracting option, set the effect value on Subcontractor cost as share of affected revenue to 0.12 — a share, no unit.',
  // The product's own retry-chip message (a2-turn2-response.json) — replayed
  // chips must never be claimed as values.
  'Use a different value for value.',
  // Unit-bearing variants of the trapped message.
  'Set it to 12%.',
  'Set it to 12 percent.',
  'Set it to £5000.',
  'Set it to 3 months.',
  'Set it to 0.12 percent.',
  // The #998 review's boundary example — names a non-graph target + unit.
  'Update the timeline to 3 months',
  // Named targets — a value for a DIFFERENT factor must not be captured.
  'Set the delivery share to 0.4.',
  'Set Customer price increase applied to 0.3.',
  // Question / hypothetical shapes.
  'Should I set it to 0.12?',
  'What if we set it to 0.12?',
  // Compound / trailing clauses.
  'Set it to 0.12 and add a risk.',
  'Set it to 0.12, then run the analysis.',
  // Plural referent — one value, several targets, must clarify elsewhere.
  'Set them to 0.12.',
  // Relative edit — no absolute "to <value>" spine.
  'Increase it by 0.12.',
];

describe('matchBareRepairValue — the whole-message claim anchor', () => {
  it.each(CLAIMED)('claims %j with value %j', (message, value) => {
    const match = matchBareRepairValue(message);
    expect(match).not.toBeNull();
    expect(match!.valueText).toBe(value);
  });

  it.each(NEVER_CLAIMED.map((m) => [m] as const))('never claims %j', (message) => {
    expect(matchBareRepairValue(message)).toBeNull();
  });

  it('never claims empty or non-string input', () => {
    expect(matchBareRepairValue('')).toBeNull();
    expect(matchBareRepairValue('   ')).toBeNull();
    expect(matchBareRepairValue(undefined as unknown as string)).toBeNull();
  });

  // Trap 22f's honest-gap protocol, BOTH WAYS: every knowingly-dropped
  // phrasing stays dropped (the predicate must not silently widen), and the
  // set itself is pinned so removing an entry without a conscious decision
  // REDs here rather than silently shrinking the record.
  it.each(REPAIR_BARE_VALUE_KNOWN_DROPPED.map((m) => [m] as const))(
    'KNOWN-DROPPED stays dropped: %j',
    (message) => {
      expect(matchBareRepairValue(message)).toBeNull();
    },
  );

  it('the KNOWN-DROPPED set is exactly the reviewed FOUR — it shrank by four, consciously', () => {
    // ⚠⚠ THIS SET WAS EIGHT AND IS NOW FOUR. The protocol above says the set must
    // shrink CONSCIOUSLY and RED here otherwise; this is that conscious decision,
    // recorded where the next reader will find it (ROADMAP 2.1267).
    //
    // CLAIMED, and each has a binding twin in
    // `routing/__tests__/missing-value-answer.test.ts`:
    //   'Make it 0.12.'          — a set verb with no "to" spine
    //   'Use 0.12.'              — a set verb with no referent and no "to"
    //   'Set it to .12.'         — a bare decimal; the same intent, one character short
    //   'Yes, set it to 0.12.'   — an affirmative lead; a human agreeing before answering
    // Measured at pristine: all four were refused by the binder AND by the
    // configure composer's termination signal, so an ordinary answer to the
    // product's own ask got the identical demand back.
    //
    // STILL DROPPED, with the reason stated at the owner
    // (`MISSING_VALUE_ANSWER_KNOWN_DROPPED`): a hedge, a word number, a bare
    // number with no antecedent, and a named target the edit lane owns.
    expect(REPAIR_BARE_VALUE_KNOWN_DROPPED).toEqual([
      'Set it to about 0.12.',
      'Set it to a third.',
      '0.12',
      'Set it to 0.12 for the subcontracting option.',
    ]);
  });

  it('the four that LEFT the set are now genuinely claimed (the other direction)', () => {
    // A shrinking set is only honest if the members left because they WORK.
    for (const [message, value] of [
      ['Make it 0.12.', '0.12'],
      ['Use 0.12.', '0.12'],
      ['Set it to .12.', '.12'],
      ['Yes, set it to 0.12.', '0.12'],
    ] as const) {
      expect(matchBareRepairValue(message)?.valueText, message).toBe(value);
    }
  });

  // The #998 lane's qualitative gap set (imported from the sibling module —
  // the same user intent with no digit) must also never be claimed here.
  it.each(QUALITATIVE_VALUE_KNOWN_DROPPED.map((m) => [m] as const))(
    'the #998 qualitative gap stays on its own route: %j',
    (message) => {
      expect(matchBareRepairValue(message)).toBeNull();
    },
  );
});

// ── the pair derivation ─────────────────────────────────────────────────────

function blocker(over: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    option_id: 'opt_sub',
    option_label: 'subcontracting inner-city deliveries to a green courier',
    factor_id: 'fac_sub_cost',
    factor_label: 'Subcontractor cost as share of affected revenue',
    blocker_type: 'missing_value',
    message: 'Choose the missing effect value.',
    suggested_action: 'add_value',
    ...over,
  };
}

function readinessWith(blockers: readonly Record<string, unknown>[]): AnalysisReadyPayload {
  return { status: 'needs_user_input', options: [], blockers } as unknown as AnalysisReadyPayload;
}

describe('deriveMissingEffectPairs — read off the canonical readiness payload', () => {
  it('keeps only missing_value blockers with full option+factor identity', () => {
    const pairs = deriveMissingEffectPairs(
      readinessWith([
        blocker({}),
        // ⚠ DISTINCT pair identity on purpose: with the same (option, factor)
        // as the row above, the dedupe would absorb this row and a deleted
        // blocker_type filter would survive the mutant kit unobserved
        // (measured — M8's first run survived on exactly that masking).
        blocker({
          blocker_type: 'ambiguous_value',
          option_id: 'opt_amb',
          option_label: 'ambiguous option',
          factor_id: 'fac_amb',
          factor_label: 'Ambiguous factor',
        }),
        blocker({ option_id: undefined, factor_id: 'fac_other', factor_label: 'Other' }),
        blocker({ option_label: '', factor_id: 'fac_third', factor_label: 'Third' }),
      ]),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ optionId: 'opt_sub', factorId: 'fac_sub_cost' });
  });

  it('dedupes by (option_id, factor_id) preserving first-seen order', () => {
    const pairs = deriveMissingEffectPairs(
      readinessWith([
        blocker({}),
        blocker({}),
        blocker({
          option_id: 'opt_pass',
          option_label: 'paying the daily charges and passing costs to customers',
          factor_id: 'fac_price_up',
          factor_label: 'Customer price increase applied',
        }),
      ]),
    );
    expect(pairs.map((p) => p.optionId)).toEqual(['opt_sub', 'opt_pass']);
  });

  it('returns empty for absent/empty payloads', () => {
    expect(deriveMissingEffectPairs(undefined)).toEqual([]);
    expect(deriveMissingEffectPairs(null)).toEqual([]);
    expect(deriveMissingEffectPairs(readinessWith([]))).toEqual([]);
  });
});

// ── the resolution ──────────────────────────────────────────────────────────

describe('resolveRepairValueBinding — bind one, ask many, decline none', () => {
  const TWO = readinessWith([
    blocker({}),
    blocker({
      option_id: 'opt_pass',
      option_label: 'paying the daily charges and passing costs to customers',
      factor_id: 'fac_price_up',
      factor_label: 'Customer price increase applied',
    }),
  ]);

  it('BINDS the sole missing pair, with the advised-format instruction carrying the value verbatim', () => {
    const result = resolveRepairValueBinding({
      message: 'Set it to 0.12.',
      readiness: readinessWith([blocker({})]),
    });
    expect(result).toMatchObject({ matched: true, kind: 'bind', valueText: '0.12' });
    if (result.matched && result.kind === 'bind') {
      expect(result.instruction).toBe(
        "Set the subcontracting inner-city deliveries to a green courier option's " +
          'effect on Subcontractor cost as share of affected revenue to 0.12.',
      );
      expect(result.pair.optionId).toBe('opt_sub');
    }
  });

  it('ASKS when two pairs are missing — never guesses', () => {
    const result = resolveRepairValueBinding({ message: 'Set it to 0.12.', readiness: TWO });
    expect(result).toMatchObject({ matched: true, kind: 'ask', valueText: '0.12' });
    if (result.matched && result.kind === 'ask') {
      expect(result.pairs).toHaveLength(2);
    }
  });

  it('DECLINES with nothing missing — no repair context, no referent to bind', () => {
    const result = resolveRepairValueBinding({
      message: 'Set it to 0.12.',
      readiness: readinessWith([]),
    });
    expect(result).toEqual({ matched: false, reason: 'no_missing_effect_values' });
  });

  it('DECLINES a non-bare message whatever the readiness state', () => {
    const result = resolveRepairValueBinding({
      message: 'The subcontractor cost should be 12% of revenue on the affected routes.',
      readiness: readinessWith([blocker({})]),
    });
    expect(result).toEqual({ matched: false, reason: 'not_bare_value_shape' });
  });
});
