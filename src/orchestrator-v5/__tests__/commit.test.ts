import { describe, it, expect } from 'vitest';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';

const META = {
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  turn_class: 'direct_answer' as const,
  handler_id: null,
  request_hash: 'sha256:test',
  llm_calls_used: 2,
  duration_ms: 42,
  handler_facts: [],
};

describe('commitDirectAnswer (slice B — RPC-backed persistence)', () => {
  it('returns the composed response unchanged on RPC success', async () => {
    const composed = composeDirectAnswerResponse({
      assistant_text: 'hi',
      stage: 'frame',
    });
    const result = await commitDirectAnswer(
      composed,
      META,
      createNoopSessionStore({ appendId: 'row-abc' }),
    );
    expect(result.response).toBe(composed);
    expect(result.performed).toBe(true);
    expect(result.persisted_row_id).toBe('row-abc');
  });

  it('throws on falsy response (invariant guard)', async () => {
    await expect(
      // @ts-expect-error — deliberately invalid for invariant assertion
      commitDirectAnswer(null, META, createNoopSessionStore()),
    ).rejects.toThrow(/invariant/i);
  });

  it('propagates SessionStore.append errors so TurnExecutor catch can map them', async () => {
    const composed = composeDirectAnswerResponse({
      assistant_text: 'hi',
      stage: 'frame',
    });
    const boom = new Error('simulated RPC failure');
    await expect(
      commitDirectAnswer(
        composed,
        META,
        createNoopSessionStore({ throwOnAppend: boom }),
      ),
    ).rejects.toBe(boom);
  });
});

describe('computeRequestHash', () => {
  // v0.7.0 schema: payload is a discriminated union on `kind`.
  // computeRequestHash switches on `payload.kind` so the `kind: 'message'`
  // discriminator must be present for the hash to include `message` as a
  // distinguishing field.
  const BASE_PAYLOAD = {
    kind: 'message' as const,
    turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    message: 'hello',
    turn_class: 'frame' as const,
    stage: 'frame' as const,
    source: 'composer' as const,
  };

  it('produces a non-empty sha256-prefixed string', () => {
    const h = computeRequestHash(BASE_PAYLOAD);
    expect(h).toMatch(/^sha256:[0-9a-f]{32}$/);
  });

  it('is stable for identical payloads', () => {
    expect(computeRequestHash(BASE_PAYLOAD)).toBe(computeRequestHash(BASE_PAYLOAD));
  });

  it('differs when the message differs', () => {
    const different = { ...BASE_PAYLOAD, message: 'different' };
    expect(computeRequestHash(BASE_PAYLOAD)).not.toBe(computeRequestHash(different));
  });

  it('differs when the scenario_id differs', () => {
    const different = { ...BASE_PAYLOAD, scenario_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
    expect(computeRequestHash(BASE_PAYLOAD)).not.toBe(computeRequestHash(different));
  });
});
