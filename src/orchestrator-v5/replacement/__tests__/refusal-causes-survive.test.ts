/**
 * ⭐ "PRESERVE REFUSAL CAUSES" — Paul's directive, 21 Sep 2026.
 *
 * Measured before the change: of the nine refusal codes, three are raised
 * because a SUBSYSTEM WE DO NOT OWN told us why — `write_failed` carries the
 * writer's `outcome.reason`, `write_outcome_unknown` carries the thrown
 * message, `checkpoint_refused` carries the store's. All three reached the
 * model in prose and then died: the durable trace kept the token alone, so a
 * reader could not separate a revision conflict from a validation refusal from
 * a transport error — which is exactly the difference between "retry this" and
 * "never retry this".
 *
 * ⛔ WHY THE LIST IS DERIVED AND NOT ACCUMULATED TWICE. The obvious shape is a
 * second array pushed alongside the first. That is two lists a human must keep
 * in step, i.e. the hand-maintained mirror (trap 12) — and the drift always
 * reads green, because both lists are individually well-formed. `refusals` is
 * therefore MAPPED from `refusal_details` inside `finish()`. The test below
 * pins that relation rather than trusting the comment.
 */
import { describe, it, expect } from 'vitest';
import {
  createReplacementTraceRecorder,
  MAX_REFUSAL_CAUSE,
} from '../turn-trace.js';

function recorder() {
  return createReplacementTraceRecorder({
    correlationId: 'turn-1',
    modelRevision: 'rev-1',
  });
}

function finish(r: ReturnType<typeof recorder>) {
  return r.finish({
    outcome: 'completed',
    proposalsOpen: 0,
    proposalsInFlight: 0,
    toolsCalled: [],
    iterations: 1,
  });
}

describe('a refusal keeps the cause the subsystem gave it', () => {
  it('carries an adapter reason into the durable record', () => {
    const r = recorder();
    r.refused('write_failed', 'model_revision_conflict: expected 5555664b, found 4dadc7e6');
    const t = finish(r);
    expect(t.refusal_details).toEqual([
      {
        code: 'write_failed',
        cause: 'model_revision_conflict: expected 5555664b, found 4dadc7e6',
      },
    ]);
  });

  it('POSITIVE CONTROL: the old shape genuinely loses it', () => {
    // Refuse with NO cause — the pre-change behaviour. If this ever came back
    // carrying a cause, the assertion above would be passing for free.
    const r = recorder();
    r.refused('write_failed');
    const t = finish(r);
    expect(t.refusal_details[0]!.cause, 'a code with no cause must read null').toBeNull();
  });

  it('null and "" are not the same answer', () => {
    // Absence must mean "there was nothing more to say", never "we lost it".
    const r = recorder();
    r.refused('quote_not_from_message');
    r.refused('checkpoint_refused', '   ');
    const t = finish(r);
    expect(t.refusal_details.map((d) => d.cause)).toEqual([null, null]);
  });

  it('bounds a hostile cause and MARKS the truncation', () => {
    // A truncated string and a terse one are otherwise byte-identical.
    const r = recorder();
    r.refused('write_outcome_unknown', 'x'.repeat(MAX_REFUSAL_CAUSE + 500));
    const t = finish(r);
    const cause = t.refusal_details[0]!.cause!;
    expect(cause.length).toBe(MAX_REFUSAL_CAUSE);
    expect(cause.endsWith('…'), 'truncation must be visible').toBe(true);
  });

  it('collapses newlines so a stack trace cannot reshape the record', () => {
    const r = recorder();
    r.refused('write_outcome_unknown', 'boom\n    at foo (bar.ts:1:1)\n    at baz');
    const t = finish(r);
    expect(t.refusal_details[0]!.cause).toBe('boom at foo (bar.ts:1:1) at baz');
  });

  it('`refusals` is DERIVED from the details, so the two cannot drift', () => {
    const r = recorder();
    r.refused('no_checkpoint');
    r.refused('write_failed', 'writer said no');
    const t = finish(r);
    // Same length, same order, same codes — derived, not maintained.
    expect(t.refusals).toEqual(t.refusal_details.map((d) => d.code));
    expect(t.refusals).toEqual(['no_checkpoint', 'write_failed']);
  });

  it('the existing reader contract is unchanged for a clean turn', () => {
    const t = finish(recorder());
    expect(t.refusals).toEqual([]);
    expect(t.refusal_details).toEqual([]);
  });
});
