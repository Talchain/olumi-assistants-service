import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { dropLoopingChips, guardLoopingChipsAtEgress } from '../looping-chip-guard.js';
import type { SuggestedAction } from '../types.js';
import { log } from '../../../utils/telemetry.js';

/**
 * The no-dead-end invariant: a chip that re-submits the user's own message
 * verbatim must never reach the wire.
 *
 * Anchored on the LIVE defect (staging f31e3852, scenario 906d6aff…,
 * 2026-07-15): the user sent "Set Key Talent Attrition to 0.8." and got back a
 * single chip whose replay message was byte-identical to it. Clicking it
 * re-ran the identical turn, which offered the identical chip.
 */
describe('looping-chip guard — no chip may replay the user message', () => {
  const chip = (over: Partial<SuggestedAction> = {}): SuggestedAction =>
    ({
      id: 'chip_clarify_factor_0',
      label: 'Key Talent Attrition',
      message: 'Set Key Talent Attrition to 0.8.',
      ...over,
    }) as SuggestedAction;

  describe('drops the loop', () => {
    it('LIVE DEFECT FIXTURE: drops the chip whose message is byte-identical to the user message', () => {
      const r = dropLoopingChips([chip()], 'Set Key Talent Attrition to 0.8.');
      expect(r.chips).toEqual([]);
      expect(r.dropped_ids).toEqual(['chip_clarify_factor_0']);
    });

    it('drops regardless of the chip id family — the guard is not clarify-specific', () => {
      // A future composer's chip, no `chip_clarify_` prefix. The invariant is
      // about the replay, not about which site emitted it.
      const r = dropLoopingChips(
        [chip({ id: 'chip_prompt_some_future_site' })],
        'Set Key Talent Attrition to 0.8.',
      );
      expect(r.chips).toEqual([]);
    });

    it('normalises case, surrounding whitespace, internal whitespace runs and trailing punctuation', () => {
      const r = dropLoopingChips(
        [chip({ message: 'set key talent   attrition to 0.8' })],
        '  Set Key Talent Attrition to 0.8.  ',
      );
      expect(r.chips).toEqual([]);
    });

    it('drops only the looping chip, keeping its non-looping siblings in order', () => {
      const keepA = chip({ id: 'a', message: 'Set Office Rent to 0.8.' });
      const loop = chip({ id: 'loop' });
      const keepB = chip({ id: 'b', message: 'Add a constraint on Key Talent Attrition.' });
      const r = dropLoopingChips([keepA, loop, keepB], 'Set Key Talent Attrition to 0.8.');
      expect(r.chips.map((c) => (c as { id: string }).id)).toEqual(['a', 'b']);
      expect(r.dropped_ids).toEqual(['loop']);
    });
  });

  describe('does NOT over-reach', () => {
    it('KEEPS a chip carrying an action_type even when its message matches — chip_click routes differently, so it does not reproduce the turn', () => {
      // The exemption that stops this guard from breaking a legitimate
      // surface: an executable chip click enters the chip_click path with a
      // pending action, so identical text is NOT an identical turn.
      const executable = chip({
        id: 'chip_action_rerun',
        message: 'Run the analysis.',
        action_type: 'run_analysis',
      } as Partial<SuggestedAction>);
      const r = dropLoopingChips([executable], 'Run the analysis.');
      expect(r.chips).toHaveLength(1);
      expect(r.dropped_ids).toEqual([]);
    });

    it('KEEPS a chip that differs from the user message by a word — no fuzzy matching', () => {
      const r = dropLoopingChips(
        [chip({ message: 'Set Key Talent Attrition to 0.9.' })],
        'Set Key Talent Attrition to 0.8.',
      );
      expect(r.chips).toHaveLength(1);
    });

    it('KEEPS everything when the chip merely CONTAINS the user message', () => {
      // Offering a superset is a real next step, not a loop.
      const r = dropLoopingChips(
        [chip({ message: 'Set Key Talent Attrition to 0.8 and rerun.' })],
        'Set Key Talent Attrition to 0.8.',
      );
      expect(r.chips).toHaveLength(1);
    });

    it('is inert for a turn with no user message (system events pass null)', () => {
      const r = dropLoopingChips([chip()], null);
      expect(r.chips).toHaveLength(1);
      expect(r.dropped_ids).toEqual([]);
    });

    it('is inert for a blank user message', () => {
      const r = dropLoopingChips([chip({ message: '   ' })], '   ');
      expect(r.chips).toHaveLength(1);
    });
  });

  it('is idempotent — the egress chokepoint re-enters it up to 4x per response', () => {
    const once = dropLoopingChips([chip()], 'Set Key Talent Attrition to 0.8.');
    const twice = dropLoopingChips(once.chips, 'Set Key Talent Attrition to 0.8.');
    expect(twice.chips).toEqual(once.chips);
    expect(twice.dropped_ids).toEqual([]);
  });

  it('returns the original array identity when nothing loops (no needless churn)', () => {
    const input = [chip({ message: 'Set Office Rent to 0.8.' })];
    expect(dropLoopingChips(input, 'Set Key Talent Attrition to 0.8.').chips).toBe(input);
  });

  describe('egress entry point', () => {
    let errSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      errSpy = vi.spyOn(log, 'error').mockImplementation((() => {}) as never);
    });
    afterEach(() => {
      errSpy.mockRestore();
    });

    it('logs an invariant violation when it fires — firing is a bug signal, not routine hygiene', () => {
      const out = guardLoopingChipsAtEgress([chip()], 'Set Key Talent Attrition to 0.8.', {
        requestId: 'req-1',
        exitPath: 'turn_executor',
      });
      expect(out).toEqual([]);
      expect(errSpy).toHaveBeenCalledTimes(1);
      const payload = errSpy.mock.calls[0]![0] as Record<string, unknown>;
      expect(payload.event).toBe('v5.invariant_violation');
      expect(payload.invariant).toBe('no_chip_replays_the_user_message');
      expect(payload.dropped_chip_ids).toEqual(['chip_clarify_factor_0']);
    });

    it('does not log when nothing loops', () => {
      guardLoopingChipsAtEgress([chip({ message: 'Set Office Rent to 0.8.' })], 'Set Key Talent Attrition to 0.8.', {
        requestId: 'req-1',
        exitPath: 'turn_executor',
      });
      expect(errSpy).not.toHaveBeenCalled();
    });

    it('never logs raw user copy — chip ids and counts only (egress redaction posture)', () => {
      guardLoopingChipsAtEgress([chip()], 'Set Key Talent Attrition to 0.8.', {
        requestId: 'req-1',
        exitPath: 'turn_executor',
      });
      const serialised = JSON.stringify(errSpy.mock.calls[0]![0]);
      expect(serialised).not.toContain('Key Talent Attrition');
    });
  });
});
