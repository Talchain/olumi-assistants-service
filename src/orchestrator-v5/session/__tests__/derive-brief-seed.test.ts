/**
 * Lane 28 — brief pipeline seam 1: unit coverage for `deriveBriefTextSeed`.
 *
 * The seed decides when a committed turn may SEED `scenarios.brief_text`
 * (write-once at the RPC: `WHERE brief_text IS NULL OR brief_text = ''`).
 * Because a wrong seed poisons the scenario's brief forever, the gate is
 * deliberately conservative and mirrors the ACTUAL scope of route-v2's
 * draft-dispatch heuristic (`isDraftGraphShape`, route-v2.ts): no committed
 * graph yet + message-kind + frame stage + ≥ DRAFT_GRAPH_MIN_BRIEF_LENGTH
 * chars + decision-brief regex + NOT a question (a permanent first-write-wins
 * field must not be claimable by any mid-conversation question). The returned
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

const BRIEF =
  'We need to decide whether to hire two senior engineers locally or use an offshore partner.';
const NO_GRAPH = { hasCommittedGraph: false } as const;

describe('deriveBriefTextSeed — shape gate', () => {
  it('seeds a first-turn (no committed graph) frame-stage decision-brief statement', () => {
    const seed = deriveBriefTextSeed(
      makeMessagePayload({ stage: 'frame', message: BRIEF }),
      NO_GRAPH,
    );
    expect(seed?.value).toBe(BRIEF);
    expect(seed?.truncated).toBe(false);
  });

  it('trims surrounding whitespace from the seeded value', () => {
    const seed = deriveBriefTextSeed(
      makeMessagePayload({ stage: 'frame', message: `  ${BRIEF}\n` }),
      NO_GRAPH,
    );
    expect(seed?.value).toBe(BRIEF);
  });

  it('does NOT seed when the scenario already has a committed graph', () => {
    // The framing turn is behind us: even a perfectly brief-shaped statement
    // must not claim the permanent first-write-wins slot mid-conversation.
    expect(
      deriveBriefTextSeed(makeMessagePayload({ stage: 'frame', message: BRIEF }), {
        hasCommittedGraph: true,
      }),
    ).toBeUndefined();
  });

  it('does NOT seed from a question, even one with decision verbs', () => {
    // A permanent first-write-wins field must not be claimable by any
    // mid-conversation question — this is a prompt to the assistant, not
    // the user's decision brief.
    const question = 'Should we hire two senior engineers locally or use an offshore partner?';
    expect(
      deriveBriefTextSeed(makeMessagePayload({ stage: 'frame', message: question }), NO_GRAPH),
    ).toBeUndefined();
  });

  it('does NOT seed from a mid-conversation question with no decision verb', () => {
    // Pre-narrowing this seeded via the regex's `\?$` alternative — the exact
    // poisoning path the review flagged.
    const question = 'What is the best way to grow revenue in the next two quarters?';
    expect(
      deriveBriefTextSeed(makeMessagePayload({ stage: 'frame', message: question }), NO_GRAPH),
    ).toBeUndefined();
  });

  it('does NOT seed a trailing-space question (the "?" check runs on the TRIMMED text)', () => {
    const question = `Should we expand into the European market next year?   `;
    expect(
      deriveBriefTextSeed(makeMessagePayload({ stage: 'frame', message: question }), NO_GRAPH),
    ).toBeUndefined();
  });

  it('returns undefined off the frame stage (analyse/decide/review are never briefs)', () => {
    for (const stage of ['analyse', 'decide', 'review'] as const) {
      expect(
        deriveBriefTextSeed(makeMessagePayload({ stage, message: BRIEF }), NO_GRAPH),
      ).toBeUndefined();
    }
  });

  it('returns undefined for system-event payloads (no user text)', () => {
    expect(
      deriveBriefTextSeed(makeSystemEventPayload({ stage: 'frame' }), NO_GRAPH),
    ).toBeUndefined();
  });

  it('returns undefined under the draft minimum length (a greeting is not a brief)', () => {
    expect(
      deriveBriefTextSeed(
        makeMessagePayload({ stage: 'frame', message: 'hello there' }),
        NO_GRAPH,
      ),
    ).toBeUndefined();
  });

  it('returns undefined for a long frame message with no decision shape', () => {
    // ≥ 30 chars but no decision verb and no trailing question mark — must
    // NOT become the scenario's permanent brief.
    const chatter = 'I enjoy long walks near the coast with my dog most mornings';
    expect(chatter.length).toBeGreaterThanOrEqual(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
    expect(
      deriveBriefTextSeed(makeMessagePayload({ stage: 'frame', message: chatter }), NO_GRAPH),
    ).toBeUndefined();
  });

  it('returns undefined for whitespace-padding that shrinks below the minimum when trimmed', () => {
    const padded = `${' '.repeat(40)}should we?`;
    expect(padded.length).toBeGreaterThanOrEqual(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
    expect(
      deriveBriefTextSeed(makeMessagePayload({ stage: 'frame', message: padded }), NO_GRAPH),
    ).toBeUndefined();
  });

  it('bounds an over-8000-char brief with disclosed truncation metadata', () => {
    const long = `We should expand. ${'x'.repeat(9000)}`;
    const seed = deriveBriefTextSeed(
      makeMessagePayload({ stage: 'frame', message: long }),
      NO_GRAPH,
    );
    expect(seed?.truncated).toBe(true);
    expect(seed?.value?.length).toBeLessThanOrEqual(8000);
    expect(seed?.originalLength).toBe(long.length);
  });
});
