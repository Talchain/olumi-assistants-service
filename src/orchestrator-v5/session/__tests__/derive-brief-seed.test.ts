/**
 * Lane 28 — brief pipeline seam 1: unit coverage for `deriveBriefTextSeed`.
 *
 * The seed decides when a committed turn may SEED `scenarios.brief_text`
 * (write-once at the RPC: `WHERE brief_text IS NULL OR brief_text = ''`).
 * Because a wrong seed poisons the scenario's brief forever, the gate is
 * deliberately conservative and mirrors route-v2's draft-dispatch shape
 * heuristic (`isDraftGraphShape`, route-v2.ts): message-kind + frame stage +
 * ≥ DRAFT_GRAPH_MIN_BRIEF_LENGTH chars + decision-brief regex. The returned
 * value is `normaliseBriefText`-bounded (trim; 8000-char cap; word-boundary
 * truncation) so it always satisfies the DB CHECK constraint.
 */
import { describe, expect, it } from 'vitest';

import { DRAFT_GRAPH_MIN_BRIEF_LENGTH } from '../../../schemas/assist.js';
import { deriveBriefTextSeed } from '../derive-brief-seed.js';
import {
  makeMessagePayload,
  makeSystemEventPayload,
} from '../../__tests__/fixtures.js';

const BRIEF = 'Should we hire two senior engineers locally or use an offshore partner?';

describe('deriveBriefTextSeed — shape gate', () => {
  it('seeds a frame-stage message that looks like a decision brief', () => {
    const seed = deriveBriefTextSeed(
      makeMessagePayload({ stage: 'frame', message: BRIEF }),
    );
    expect(seed?.value).toBe(BRIEF);
    expect(seed?.truncated).toBe(false);
  });

  it('trims surrounding whitespace from the seeded value', () => {
    const seed = deriveBriefTextSeed(
      makeMessagePayload({ stage: 'frame', message: `  ${BRIEF}\n` }),
    );
    expect(seed?.value).toBe(BRIEF);
  });

  it('accepts a question-mark brief with no decision verb', () => {
    const message = 'What is the best way to grow revenue in the next two quarters?';
    const seed = deriveBriefTextSeed(makeMessagePayload({ stage: 'frame', message }));
    expect(seed?.value).toBe(message);
  });

  it('returns undefined off the frame stage (analyse/decide/review are never briefs)', () => {
    for (const stage of ['analyse', 'decide', 'review'] as const) {
      expect(
        deriveBriefTextSeed(makeMessagePayload({ stage, message: BRIEF })),
      ).toBeUndefined();
    }
  });

  it('returns undefined for system-event payloads (no user text)', () => {
    expect(
      deriveBriefTextSeed(makeSystemEventPayload({ stage: 'frame' })),
    ).toBeUndefined();
  });

  it('returns undefined under the draft minimum length (a greeting is not a brief)', () => {
    expect(
      deriveBriefTextSeed(makeMessagePayload({ stage: 'frame', message: 'hello there' })),
    ).toBeUndefined();
  });

  it('returns undefined for a long frame message with no decision shape', () => {
    // ≥ 30 chars but no decision verb and no trailing question mark — must
    // NOT become the scenario's permanent brief.
    const chatter = 'I enjoy long walks near the coast with my dog most mornings';
    expect(chatter.length).toBeGreaterThanOrEqual(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
    expect(
      deriveBriefTextSeed(makeMessagePayload({ stage: 'frame', message: chatter })),
    ).toBeUndefined();
  });

  it('returns undefined for whitespace-padding that shrinks below the minimum when trimmed', () => {
    const padded = `${' '.repeat(40)}should we?`;
    expect(padded.length).toBeGreaterThanOrEqual(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
    expect(
      deriveBriefTextSeed(makeMessagePayload({ stage: 'frame', message: padded })),
    ).toBeUndefined();
  });

  it('bounds an over-8000-char brief with disclosed truncation metadata', () => {
    const long = `Should we expand? ${'x'.repeat(9000)}`;
    const seed = deriveBriefTextSeed(
      makeMessagePayload({ stage: 'frame', message: long }),
    );
    expect(seed?.truncated).toBe(true);
    expect(seed?.value?.length).toBeLessThanOrEqual(8000);
    expect(seed?.originalLength).toBe(long.length);
  });
});
