/**
 * ⭐⭐ THE REPETITION HALF — "the next response must DIFFER from the last".
 *
 * Measured at `915da5a3`: nine of nine unrecognised replies to the effect ask
 * received the BYTE-IDENTICAL demand. The cause is structural —
 * `projectReadinessRecovery` is a pure function of `(analysisReady, nodes)` and
 * never sees the user's message, so it composes from the GRAPH (unchanged)
 * rather than from the EXCHANGE (changed). These tests pin the two mechanisms
 * that make a repeat impossible rather than merely unlikely:
 *
 *   1. every re-ask QUOTES the user, which the opening ask cannot do;
 *   2. the attempt counter is carried off the SUPERSEDED row, so a second ask
 *      knows it is a second ask.
 */
import { describe, expect, it } from 'vitest';
import {
  carryForwardOptionEffectAttempt,
  parsePendingAction,
  ELICIT_OPTION_EFFECT_FAILURE_REASONS,
  ELICIT_OPTION_EFFECT_REPLY_MAX,
  type PendingAction,
} from '../../session/pending-action.js';
import { formatEffectSlotReask } from '../../tools/handlers/d1-shared/format-confirmation.js';
import { resolveAnswerForKnownSlot } from '../repair-value-binding.js';

const SLOT = { optionId: 'opt-a', factorId: 'fac-a' };

const pendingWith = (over: Record<string, unknown>): PendingAction => ({
  id: '00000000-0000-4000-8000-000000000001',
  scenario_id: 'scenario',
  chip_id: 'chip_configure_option_clarify',
  action: {
    kind: 'elicit_option_effect',
    option_id: 'opt-a', option_label: 'Two Developers',
    factor_id: 'fac-a', factor_label: 'Development throughput',
    ...over,
  },
  preconditions: { graph_hash: 'h' },
  emitted_at_iso: '2026-08-30T20:00:00.000Z',
  expires_at_iso: '2026-08-30T20:10:00.000Z',
  expires_at_turn_count: 2,
} as PendingAction);

describe('attempt carry-forward — off the superseded row, by identity', () => {
  it('is 1 with no prior pendings at all', () => {
    expect(carryForwardOptionEffectAttempt(null, SLOT)).toBe(1);
    expect(carryForwardOptionEffectAttempt([], SLOT)).toBe(1);
  });

  it('increments from a prior ask about the SAME cell', () => {
    expect(carryForwardOptionEffectAttempt([pendingWith({ attempt: 1 })], SLOT)).toBe(2);
    expect(carryForwardOptionEffectAttempt([pendingWith({ attempt: 4 })], SLOT)).toBe(5);
  });

  it('treats a pre-change row (no attempt field) as attempt 1, never refusing it', () => {
    expect(carryForwardOptionEffectAttempt([pendingWith({})], SLOT)).toBe(2);
  });

  // ── OPPOSITE-DIRECTION TWIN: a DIFFERENT cell must not inherit the count ──
  it('restarts at 1 for a different factor — frustration is per cell, not global', () => {
    const other = pendingWith({ attempt: 6, factor_id: 'fac-OTHER' });
    expect(carryForwardOptionEffectAttempt([other], SLOT)).toBe(1);
  });

  it('restarts at 1 for a different option', () => {
    const other = pendingWith({ attempt: 6, option_id: 'opt-OTHER' });
    expect(carryForwardOptionEffectAttempt([other], SLOT)).toBe(1);
  });

  it('ignores a pending of an unrelated kind', () => {
    const unrelated = { ...pendingWith({}), action: { kind: 'run_analysis' } } as PendingAction;
    expect(carryForwardOptionEffectAttempt([unrelated], SLOT)).toBe(1);
  });
});

describe('the record validates its new fields rather than trusting them', () => {
  it('accepts a row carrying all three re-ask fields', () => {
    const parsed = parsePendingAction(pendingWith({
      attempt: 2, last_user_reply: 'a third', failure_reason: 'imprecise_quantity',
    }));
    expect(parsed).not.toBeNull();
  });

  it('accepts a row carrying none of them (rows written before this change)', () => {
    expect(parsePendingAction(pendingWith({}))).not.toBeNull();
  });

  it.each([
    ['attempt below 1', { attempt: 0 }],
    ['a non-integer attempt', { attempt: 1.5 }],
    ['an over-long reply', { last_user_reply: 'x'.repeat(ELICIT_OPTION_EFFECT_REPLY_MAX + 1) }],
    ['an empty reply', { last_user_reply: '' }],
    ['a failure reason outside the closed set', { failure_reason: 'made_up' }],
  ])('refuses %s', (_label, over) => {
    expect(parsePendingAction(pendingWith(over))).toBeNull();
  });

  it('the closed reason set is the one the contract can actually produce', () => {
    // DERIVED, not mirrored: every reason the contract emits must be storable.
    for (const reason of ['imprecise_quantity', 'scale_ambiguous'] as const) {
      expect(ELICIT_OPTION_EFFECT_FAILURE_REASONS).toContain(reason);
    }
  });
});

describe('⭐ NO RE-ASK IS BYTE-IDENTICAL TO THE ASK THAT PRECEDED IT', () => {
  const cell = { optionLabel: 'Two Developers', factorLabel: 'Development throughput' };

  // The opening demand, verbatim from `readiness-recovery.ts`'s provide_value
  // branch — the sentence the founder received twice.
  const OPENING_ASK =
    'Next, choose the missing effect value for "Two Developers" on '
    + '"Development throughput" so the comparison can be prepared.';

  const reask = (over: Parameters<typeof formatEffectSlotReask>[0]) =>
    formatEffectSlotReask(over);

  it('every re-ask differs from the opening demand', () => {
    const all = [
      reask({ ...cell, heardText: 'a third', suggestedModelUnitText: '0.33', reason: 'imprecise_quantity' }),
      reask({ ...cell, heardText: '25', suggestedModelUnitText: '0.25', reason: 'scale_ambiguous' }),
      reask({ ...cell, heardText: 'a third', suggestedModelUnitText: '0.33', reason: 'imprecise_quantity', attempt: 2 }),
    ];
    for (const text of all) expect(text).not.toBe(OPENING_ASK);
  });

  it('produces three DIFFERENT second asks, each quoting the user', () => {
    const texts = [
      reask({ ...cell, heardText: 'a third', suggestedModelUnitText: '0.33', reason: 'imprecise_quantity' }),
      reask({ ...cell, heardText: '25', suggestedModelUnitText: '0.25', reason: 'scale_ambiguous' }),
      reask({ ...cell, heardText: 'a quarter', suggestedModelUnitText: '0.25', reason: 'imprecise_quantity', attempt: 2 }),
    ];
    expect(new Set(texts).size).toBe(3);
    expect(texts[0]).toContain('"a third"');
    expect(texts[1]).toContain('"25"');
    expect(texts[2]).toContain('"a quarter"');
    // ...and each names the scale it wants.
    for (const text of texts) expect(text).toMatch(/%/u);
  });

  it('the SECOND attempt differs from the FIRST on identical input', () => {
    const args = {
      ...cell, heardText: 'a third', suggestedModelUnitText: '0.33',
      reason: 'imprecise_quantity' as const,
    };
    expect(reask({ ...args, attempt: 2 })).not.toBe(reask({ ...args, attempt: 1 }));
  });

  // ── THE EGRESS RULE: percentages, never a raw internal decimal ───────────
  it('never leaks the internal 0-1 coefficient into user-facing prose', () => {
    // `RAW_DECIMAL_RE` bans a leading-decimal probability from prose, and the
    // product ruling is that a user is never shown the internal scale.
    const texts = [
      reask({ ...cell, heardText: 'a third', suggestedModelUnitText: '0.33', reason: 'imprecise_quantity' }),
      reask({ ...cell, heardText: '25', suggestedModelUnitText: '0.25', reason: 'scale_ambiguous' }),
      reask({ ...cell, heardText: 'half', suggestedModelUnitText: '0.5', reason: 'imprecise_quantity', attempt: 3 }),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/(?:^|[\s(=,])(?:0\.\d|\.\d)/u);
    }
    expect(texts[0]).toContain('33%');
    expect(texts[1]).toContain('25%');
    expect(texts[2]).toContain('50%');
  });

  it('the contract and the composer agree on what is confirmable', () => {
    // The composer must be total over every `confirm` the contract can emit.
    const graph = { nodes: [
      { id: 'opt-a', kind: 'option', label: 'Two Developers' },
      { id: 'fac-a', kind: 'factor', label: 'Development throughput' },
    ] };
    const slot = { optionId: 'opt-a', optionLabel: 'Two Developers',
      factorId: 'fac-a', factorLabel: 'Development throughput' };
    for (const message of ['a third', 'a quarter', 'half', '25', '7']) {
      const result = resolveAnswerForKnownSlot({ message, slot, graph });
      expect(result.kind).toBe('confirm');
      if (result.kind !== 'confirm') continue;
      const text = reask({ ...cell, heardText: result.heardText,
        suggestedModelUnitText: result.suggestedModelUnitText, reason: result.reason });
      expect(text).toContain(`"${result.heardText}"`);
    }
  });
});
