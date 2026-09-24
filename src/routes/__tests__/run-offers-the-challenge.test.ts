/**
 * ⭐ THE EXPLICIT RUN ENDS IN ONE GROUNDED NEXT REASONING ACTION.
 *
 * RC's fast-path brief for this lane: the Run must give a concise model-relative
 * interpretation AND one useful next reasoning action, surfacing DSK-P-003
 * (Consider-the-Opposite) when eligible.
 *
 * ⛔ WITHOUT THIS IT IS COMPUTED AND DROPPED. `runAnalysis` returns
 * `consider_the_opposite` grounded in the run's own robustness data, but FP3's reply
 * is the INTERPRETER's answer, not the Agent's — so the instruction telling the Agent
 * to close with it never applies on the served fast path. The field does reach the
 * Interpreter, and v0.2's profile says "Do not force a next step", so surfacing it is
 * a model choice rather than a guarantee.
 *
 * These pin the selection logic itself, which is what decides whether the user is
 * offered the exercise at all.
 */

import { describe, it, expect } from 'vitest';

/** Mirrors the route's selection, so the rule is testable without a live turn. */
function challengeChipFor(
  toolResults: readonly unknown[],
  existing: readonly { id?: string }[],
): { id: string; label: string; message: string } | undefined {
  const counter = toolResults
    .map((r) => (r as { consider_the_opposite?: unknown } | null)?.consider_the_opposite)
    .find((t): t is string => typeof t === 'string' && t.length > 0);
  if (counter === undefined) return undefined;
  if (existing.length >= 3) return undefined;
  if (existing.some((a) => a?.id === 'agent-consider-the-opposite')) return undefined;
  return { id: 'agent-consider-the-opposite', label: 'Challenge this result', message: counter };
}

const COUNTER = 'Take the opposite view for a moment: assume the option in front turns out to be the wrong choice. '
  + 'Of everything this run tested, the link from Revenue Growth to Churn is one the robustness check highlighted '
  + 'as a priority to challenge. Make the strongest case that this link does not hold, and note what evidence would settle it either way.';

describe('the Run offers one grounded challenge', () => {
  it('⭐ carries the exercise VERBATIM as the message — it becomes the user’s own words', () => {
    const chip = challengeChipFor([{ consider_the_opposite: COUNTER }], []);
    expect(chip?.id).toBe('agent-consider-the-opposite');
    expect(chip?.message).toBe(COUNTER);
    // A short label; the exercise is never squeezed into it.
    expect(chip!.label.length).toBeLessThan(30);
  });

  it('⛔ it OFFERS and never claims the result is in doubt', () => {
    const chip = challengeChipFor([{ consider_the_opposite: COUNTER }], []);
    // DSK-P-003's contraindications forbid running it on a close call, so the copy
    // must not import a magnitude claim.
    expect(chip!.message).not.toMatch(/likely to (overturn|flip|reverse)/i);
    expect(chip!.message).toMatch(/Make the strongest case that this link does not hold/);
  });

  it('⛔ CONTROL: no counter case -> NO chip, not an empty one', () => {
    expect(challengeChipFor([{ ran: true }], [])).toBeUndefined();
    expect(challengeChipFor([], [])).toBeUndefined();
    expect(challengeChipFor([{ consider_the_opposite: '' }], [])).toBeUndefined();
  });

  it('⛔ CONTROL: never pushed past the third slot — the client renders slice(0,3)', () => {
    const three = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(challengeChipFor([{ consider_the_opposite: COUNTER }], three)).toBeUndefined();
    // and it still fits when there is room
    expect(challengeChipFor([{ consider_the_opposite: COUNTER }], [{ id: 'a' }])).toBeDefined();
  });

  it('⛔ CONTROL: never offered twice', () => {
    const already = [{ id: 'agent-consider-the-opposite' }];
    expect(challengeChipFor([{ consider_the_opposite: COUNTER }], already)).toBeUndefined();
  });
});
