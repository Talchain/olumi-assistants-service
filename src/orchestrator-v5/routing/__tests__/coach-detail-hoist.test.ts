/**
 * ⭐⭐ THE COACH-BRANCH DETAIL HOIST — a coaching answer that arrives one field
 * out of place is folded, not repaired and not discarded.
 *
 * MEASURED, not imagined. On the existing paid comparison run recorded in
 * `output/olumi-coaching-capability-20260908/SEQ16-TRACE.md`, 1 of 18 records
 * (`seq16`) put 1,645 characters of `detail` prose at the ROOT of the tool call
 * instead of inside `answer_shape`. `RawToolCallSchema` is `.strict()`, so the
 * root produced `unrecognized_keys`, the parse failed, and the turn went to
 * REPAIR_ONCE — a SECOND LLM call whose only job was to move one field. If that
 * repair also fails the turn ends in `RoutingError('schema_repair_failed')` and
 * the person gets no answer at all.
 *
 * The control in the SAME run is `seq4`: identical prose, placed INSIDE
 * `answer_shape.detail`, accepted and delivered in full. The two records differ
 * by field position and nothing else, which is the whole evidence base for this
 * change and the reason it is a fold rather than a guess.
 *
 * ⚠ WHAT THIS SUITE IS NOT. It does not claim the hoist caused the 2026-09-08
 * 16:47Z native coaching failure — nothing connects the two, and the trace that
 * found seq16 says so explicitly. It also does not claim generated answers are
 * better; that arm is blocked on a credential and is not this change's claim.
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, expect, it } from 'vitest';

import { coerceFirstPassToolCall } from '../tool-schema.js';

const DETAIL = 'Hiring two developers front-loads cost against an uncertain revenue ramp.';

/** A coach turn shaped exactly as `seq16` was: prose at the root. */
function seq16Shaped(overrides: Record<string, unknown> = {}) {
  return {
    intent_class: 'coach',
    coaching_mode: 'reframe',
    answer_shape: { headline: 'Two questions decide this.', bullets: [] },
    detail: DETAIL,
    ...overrides,
  };
}

describe('a coach turn that hoists its detail is folded on the first pass', () => {
  it('⭐ the prose reaches answer_shape.detail, and the root key is gone', () => {
    const { value, coercions } = coerceFirstPassToolCall(seq16Shaped());
    const out = value as Record<string, unknown>;
    expect((out.answer_shape as Record<string, unknown>).detail).toBe(DETAIL);
    expect('detail' in out).toBe(false);
    expect(coercions.map((c) => c.reason)).toEqual(['coach_detail_hoist']);
  });

  it('the headline and bullets are carried through untouched', () => {
    // The fold must move ONE key. If it rebuilt the shape it could drop the
    // parts the answer is actually made of.
    const { value } = coerceFirstPassToolCall(
      seq16Shaped({ answer_shape: { headline: 'H', bullets: ['a', 'b'] } }),
    );
    const shape = (value as Record<string, unknown>).answer_shape as Record<string, unknown>;
    expect(shape.headline).toBe('H');
    expect(shape.bullets).toEqual(['a', 'b']);
  });

  it('does not mutate the caller-supplied object', () => {
    const input = seq16Shaped();
    const snapshot = JSON.stringify(input);
    coerceFirstPassToolCall(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('the fold is narrow — everything else keeps byte-identical passthrough', () => {
  it('⭐ EXECUTE IS UNREACHABLE — a hoisted detail on an execute turn is not folded', () => {
    // The load-bearing boundary. This coercion must never touch a turn that
    // carries mutation authority; the execute branch keeps its own class-(d)
    // strip and this helper is not on its path.
    const { value, coercions } = coerceFirstPassToolCall({
      intent_class: 'execute',
      action: {
        handler_id: 'run_analysis',
        entity: { id: 'n1', kind: 'option', resolution_status: 'resolved', resolution_method: 'id_match' },
        parameters: [],
        cited_context_fields: [],
      },
      detail: DETAIL,
    });
    const out = value as Record<string, unknown>;
    expect(coercions.map((c) => c.reason)).not.toContain('coach_detail_hoist');
    expect((out.answer_shape as unknown) ?? null).toBeNull();
  });

  it('⭐ A POPULATED SHAPE DETAIL WINS — the model is not overruled', () => {
    // Both keys populated is ambiguous, and guessing would be this seam's
    // version of inventing an answer. The turn repairs instead, and the same
    // reference comes back so the passthrough contract is untouched.
    const both = seq16Shaped({
      answer_shape: { headline: 'H', bullets: [], detail: 'the model put it here' },
    });
    const { value, coercions } = coerceFirstPassToolCall(both);
    expect(coercions).toHaveLength(0);
    expect(value).toBe(both);
  });

  it('⭐ NO SHAPE, NO FOLD — orphaned prose does not get a shape invented around it', () => {
    // Creating an `answer_shape` would mean authoring a headline the model
    // never wrote. Refuse and let the repair happen.
    const orphan = { intent_class: 'coach', coaching_mode: 'reframe', detail: DETAIL };
    const { value, coercions } = coerceFirstPassToolCall(orphan);
    expect(coercions).toHaveLength(0);
    expect(value).toBe(orphan);
  });

  it('a blank or non-string root detail is not a hoist', () => {
    for (const detail of ['', '   ', 42, null, { nested: true }]) {
      const input = seq16Shaped({ detail });
      const { value, coercions } = coerceFirstPassToolCall(input);
      expect(coercions, JSON.stringify(detail)).toHaveLength(0);
      expect(value, JSON.stringify(detail)).toBe(input);
    }
  });

  it('CONTRAST — an ordinary coach turn with no root detail is the same object', () => {
    // The pre-existing non-execute contract, re-pinned here so this file fails
    // if the fold ever starts copying every coach turn.
    const coach = {
      intent_class: 'coach',
      coaching_mode: 'reframe',
      answer_shape: { headline: 'H', bullets: [] },
    };
    const { value, coercions } = coerceFirstPassToolCall(coach);
    expect(coercions).toHaveLength(0);
    expect(value).toBe(coach);
  });
});
