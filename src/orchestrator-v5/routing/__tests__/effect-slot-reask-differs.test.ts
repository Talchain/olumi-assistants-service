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
  type PendingAction,
} from '../../session/pending-action.js';
import { projectReadinessRecovery } from '../../coaching/readiness-recovery.js';
import { formatEffectSlotReask } from '../../tools/handlers/d1-shared/format-confirmation.js';
import { resolveAnswerForKnownSlot, resolveRecordedOptionEffectAnswer } from '../repair-value-binding.js';

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

/**
 * ⚠⚠ TWO FIELDS THAT USED TO BE PINNED HERE ARE GONE — `last_user_reply` and
 * `failure_reason`, together with the closed `ELICIT_OPTION_EFFECT_FAILURE_REASONS`
 * set and its length bound. THE PIN WAS VACUOUS IN ONE DIRECTION AND THE FIELDS
 * HAD NO ONE TO SERVE:
 *
 *   · ADDING `zzz_bogus_member` to the closed set left the suite fully GREEN —
 *     the pin bit on REMOVAL only, so it could never have caught the drift it
 *     was written for;
 *   · both fields had ZERO production writers and ZERO production readers
 *     (contrast control in the same sweep: `attempt` hit 142 files, so the
 *     sweep discriminated rather than reading blind), and three of the five
 *     reasons were unreachable from any verdict the contract can emit.
 *
 * A write-only column with no reader cannot fork anything (trap 10), and a pin
 * over a fictional set is worse than no pin because it reads as settled
 * contract. Deleted rather than better-pinned. What remains below is `attempt`,
 * which has a real writer (`readiness-recovery.ts`) and a real reader
 * (`repair-value-binding.ts`'s confirm arm).
 */
describe('the record validates `attempt` rather than trusting it', () => {
  it('accepts a row carrying the attempt count', () => {
    expect(parsePendingAction(pendingWith({ attempt: 2 }))).not.toBeNull();
  });

  it('accepts a row carrying none (rows written before this change)', () => {
    expect(parsePendingAction(pendingWith({}))).not.toBeNull();
  });

  it.each([
    ['attempt below 1', { attempt: 0 }],
    ['a non-integer attempt', { attempt: 1.5 }],
  ])('refuses %s', (_label, over) => {
    expect(parsePendingAction(pendingWith(over))).toBeNull();
  });
});

/**
 * ⭐⭐ THE WIDENING IS ADDITIVE — it may add a BIND or a CONFIRM, never a REFUSAL.
 *
 * `stale` / `ambiguous` / `unavailable` are TERMINAL exits at route-v2 that emit
 * "I cannot safely match that answer to the previous question" and return.
 * Before this lane they could only fire for a message the context-free grammar
 * had already read as a number. The widened gate admits any message carrying a
 * digit, so without the additive-only clamp an ordinary edit instruction would
 * be hijacked by a refusal about a question the user was not answering.
 */
describe('the widened gate can never add a refusal', () => {
  const graph = {
    nodes: [
      { id: 'opt-a', kind: 'option', label: 'Two Developers' },
      { id: 'fac-a', kind: 'factor', label: 'Development throughput' },
    ],
    edges: [],
  } as never;
  // An EXPIRED effect ask lying around — the state that made this reachable.
  const expired = { ...pendingWith({}), expires_at_iso: '2020-01-01T00:00:00.000Z' } as PendingAction;

  it.each([
    'add factor Q3 revenue',
    'run analysis 2',
    'rename option 1 to Pilot',
  ])('%s is UNRELATED, never a refusal about the previous question', message => {
    const result = resolveRecordedOptionEffectAnswer({
      message, pendings: [expired], graph, readiness: undefined,
      scenarioId: 'scenario', nowMs: Date.parse('2026-08-30T20:00:00Z'),
    });
    expect(result.kind).toBe('unrelated');
  });

  // ── OPPOSITE-DIRECTION TWIN: a context-free numeric answer KEEPS the honest
  //    stale refusal it has always had. The clamp must not silence that.
  it('a bare number against an expired ask still reports stale, as it always did', () => {
    const result = resolveRecordedOptionEffectAnswer({
      message: '0.7', pendings: [expired], graph, readiness: undefined,
      scenarioId: 'scenario', nowMs: Date.parse('2026-08-30T20:00:00Z'),
    });
    expect(result.kind).toBe('stale');
  });
});

describe('⭐ NO RE-ASK IS BYTE-IDENTICAL TO THE ASK THAT PRECEDED IT', () => {
  const cell = { optionLabel: 'Two Developers', factorLabel: 'Development throughput' };

  /**
   * ⭐⭐ THE OPENING DEMAND, DERIVED FROM THE PRODUCT — never re-typed here.
   *
   * ⚠⚠ IT USED TO BE A HAND-COPIED LITERAL AND THE COPY WAS ALREADY WRONG. It
   * omitted the ` ${MISSING_VALUE_ASK_FORMAT_HINT}` clause that
   * `readiness-recovery.ts`'s `provide_value` branch APPENDS, so every
   * `not.toBe(OPENING_ASK)` below was asserting inequality against a string the
   * product has never emitted — a test that passes because it is pointed at
   * nothing (CLAUDE.md trap 12: a hand-maintained mirror inside the guard
   * written to stop repetition).
   *
   * Now taken from `projectReadinessRecovery` itself, on a readiness payload
   * shaped like the one the founder's journey produced. If the ask's wording
   * moves, this moves with it, and the inequality stays a real claim.
   */
  const OPENING_ASK = projectReadinessRecovery(
    {
      status: 'needs_user_input',
      blockers: [{
        blocker_type: 'missing_value',
        option_id: 'opt-a', option_label: 'Two Developers',
        factor_id: 'fac-a', factor_label: 'Development throughput',
      }],
    },
    [
      { id: 'opt-a', kind: 'option', label: 'Two Developers' },
      { id: 'fac-a', kind: 'factor', label: 'Development throughput' },
    ],
  ).nextStep;

  /**
   * ⚠ THE POSITIVE CONTROL for the derivation above. A projection that fell
   * through to some other branch would yield an unrelated sentence, and every
   * `not.toBe` below would then pass for the wrong reason — the same vacuity
   * the hand-copied literal had. This asserts we are holding the
   * `provide_value` ask, and that it carries the format hint the literal
   * dropped.
   */
  it('the derived opening ask IS the provide_value demand, hint included', () => {
    expect(OPENING_ASK).toContain('choose the missing effect value');
    expect(OPENING_ASK).toContain('"Two Developers"');
    expect(OPENING_ASK).toContain('"Development throughput"');
    // The clause the hand-copied literal omitted.
    expect(OPENING_ASK).toContain('Just the percentage is enough');
  });

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

  /**
   * ⭐⭐⭐ TURN N VERSUS TURN N+1, WHICH IS THE CLAIM THAT ACTUALLY MATTERS.
   *
   * ⚠⚠ THE OLD TEST COMPARED `attempt: 1` WITH `attempt: 2` AND STOPPED THERE.
   * That proves the composer VARIES with its input; it says nothing about
   * whether the input ever varies in production — and it did not. The route's
   * confirm exit commits `pending_actions: []` and carries the recorded ask
   * forward VERBATIM, so the stored `attempt` never moved: every re-ask
   * composed at 1, the attempt-2 copy was UNREACHABLE, and two identical
   * unreadable replies produced BYTE-IDENTICAL re-asks. The counter was dark
   * inside the fix that introduced it.
   *
   * So this walks the count the way the route now advances it — the ask's own
   * number PLUS ONE, because emitting the re-ask IS the next attempt — and
   * asserts consecutive turns differ on IDENTICAL user input, which is the
   * only condition under which the repetition defect can reproduce.
   */
  it('consecutive turns differ on identical input, walking the attempt as the route does', () => {
    const args = {
      ...cell, heardText: 'a third', suggestedModelUnitText: '0.33',
      reason: 'imprecise_quantity' as const,
    };
    // The route composes at the RECORDED ask's count PLUS ONE, so the first
    // re-ask a user can receive is attempt 2, the second is 3, and so on.
    const turn = (n: number) => reask({ ...args, attempt: n + 1 });

    // ⭐ THE DEFECT, CLOSED: turn 1's re-ask is not the ask that preceded it,
    // and turn 2's is not turn 1's. Both were byte-identical before this fix.
    expect(turn(1)).not.toBe(OPENING_ASK);
    expect(turn(2)).not.toBe(OPENING_ASK);
    expect(turn(2)).not.toBe(turn(1));

    // ⚠ AND THE HONEST LIMIT, STATED RATHER THAN IMPLIED: from turn 2 the copy
    // has changed strategy and stops changing. A user who sends the SAME
    // unreadable reply a third time gets turn 2's sentence again. That is
    // deliberate — the information is in the two transitions, and inventing a
    // fourth phrasing would be noise — but it IS a plateau, so it is pinned
    // here rather than left for the next reader to discover as a surprise.
    expect(turn(3)).toBe(turn(2));
  });

  /**
   * ⭐ AND THE HONEST GAP, PINNED BY NAME RATHER THAN LEFT TO BE DISCOVERED.
   *
   * The escalation has THREE bands — first ask, "still not certain", and a
   * strategy change that stops explaining the scale and reduces the exchange to
   * a binary. From band three it PLATEAUS: attempts 4, 5 and 6 repeat band
   * three for an identical reply. That is a decision, not an oversight —
   * endless novelty is noise, and the information is in the first two
   * transitions. This test REDs if the plateau moves, in either direction.
   */
  it('escalates over exactly three bands and then deliberately plateaus', () => {
    const args = {
      ...cell, heardText: 'a third', suggestedModelUnitText: '0.33',
      reason: 'imprecise_quantity' as const,
    };
    const at = (attempt: number) => reask({ ...args, attempt });
    expect(new Set([at(1), at(2), at(3)]).size).toBe(3);
    // KNOWN AND ACCEPTED: band three is terminal.
    expect(at(4)).toBe(at(3));
    expect(at(9)).toBe(at(3));
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
