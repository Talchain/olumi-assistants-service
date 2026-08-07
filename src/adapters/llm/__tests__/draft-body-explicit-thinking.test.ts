/**
 * FINAL-SWEEP (pre-handover) — Codex F-5: the draft body must send an EXPLICIT
 * thinking posture even when disabled. Previously it OMITTED `thinking` when off,
 * while the chat path's R1 fix claimed to "mirror the draft path's explicit-posture
 * idiom" — an idiom that did not exist. A thinking-class model (Sonnet-5) routed
 * to draft_graph would then run adaptive thinking, burn the budget, and false-abort
 * at the stall gate (thinking deltas don't refresh the progress clock).
 *
 * Fix: the draft request always carries `thinking:{type:'disabled'}` when off — a
 * true mirror of R1. RED-first: the captured request body carries the explicit
 * disabled posture; the pre-fix body OMITS the field (mutation-checked).
 */

import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  bodies: [] as Array<{ thinking?: unknown }>,
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: (body: { thinking?: unknown }) => {
        h.bodies.push(body);
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: '{"nodes":[{"id":"a","kind":"factor","label":"A"}],"edges":[{"from":"a","to":"b"}]}' },
            };
          },
          async finalMessage() {
            return {
              content: [{ type: 'text', text: '{"nodes":[{"id":"a","kind":"factor","label":"A"}],"edges":[{"from":"a","to":"b"}]}' }],
              usage: { input_tokens: 100, output_tokens: 50 },
              stop_reason: 'end_turn',
            };
          },
        };
      },
    };
  }
  return { default: MockAnthropic };
});

let draftGraphWithAnthropic: typeof import('../anthropic.js').draftGraphWithAnthropic;
let priorKey: string | undefined;

beforeAll(async () => {
  priorKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-f5-draft';
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
  ({ draftGraphWithAnthropic } = await import('../anthropic.js'));
});

afterAll(async () => {
  if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = priorKey;
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
});

afterEach(() => {
  h.bodies = [];
});

describe('draft_graph body — explicit thinking posture when disabled (F-5)', () => {
  it('the request carries thinking:{type:"disabled"} (never omits the field) when draft thinking is off', async () => {
    await draftGraphWithAnthropic(
      { brief: 'Should we launch A or B?', docs: [], seed: 1 },
      { timeoutMs: 120_000, forceDefault: true },
    ).catch(() => undefined);

    expect(h.bodies.length).toBeGreaterThanOrEqual(1);
    // Post-fix: explicit disabled posture. Pre-fix: the field is OMITTED → RED.
    expect(h.bodies[0]!.thinking).toEqual({ type: 'disabled' });
  });
});
