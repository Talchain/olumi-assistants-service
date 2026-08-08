/**
 * ROADMAP 2.973 — MUST-NOT-CHANGE fixture at the CALL SITE.
 *
 * Restoring GA structured outputs for claude-sonnet-5 must NOT switch strict tool
 * calling on for it. `buildStrictAnthropicTools` has NO env gate, so a widening
 * there lands on every live turn the moment it deploys — and the edit path's
 * `propose_structural_edit` schema deliberately omits `required` on a nested
 * object, which its own comment records as safe ONLY because strict is not sent.
 *
 * Pinning this at the SET alone would be trap 13b (presence of a control is not
 * coverage of the branch): a one-line revert of the concept split at the call
 * site would leave the set correct and the behaviour wrong. So this asserts the
 * TOOL BODY that actually goes on the wire.
 */

import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ bodies: [] as Array<Record<string, unknown>> }));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: async (body: Record<string, unknown>) => {
        h.bodies.push(body);
        return {
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        };
      },
    };
  }
  return { default: MockAnthropic };
});

let chatWithToolsAnthropic: typeof import('../anthropic.js').chatWithToolsAnthropic;
let priorKey: string | undefined;

beforeAll(async () => {
  priorKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-strict-tools';
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
  ({ chatWithToolsAnthropic } = await import('../anthropic.js'));
});

afterAll(async () => {
  if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = priorKey;
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
});

afterEach(() => { h.bodies = []; });

const TOOL = {
  name: 'propose_structural_edit',
  description: 'Propose an edit',
  input_schema: { type: 'object', properties: { op: { type: 'string' } } } as Record<string, unknown>,
};

async function toolsSentFor(model: string) {
  await chatWithToolsAnthropic({
    system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [TOOL], model,
  }).catch(() => undefined);
  expect(h.bodies.length, `no body captured for ${model}`).toBeGreaterThanOrEqual(1);
  const body = h.bodies[0]!;
  expect(body.model).toBe(model);
  return (body.tools as Array<Record<string, unknown>>)[0]!;
}

describe('strict tool calling — unchanged by the sonnet-5 structured-outputs fix (2.973)', () => {
  it('claude-sonnet-5 tools are sent NON-strict (no strict flag, no additionalProperties)', async () => {
    const tool = await toolsSentFor('claude-sonnet-5');
    expect(tool.name).toBe('propose_structural_edit');
    expect(tool.strict).toBeUndefined();
    expect((tool.input_schema as Record<string, unknown>).additionalProperties).toBeUndefined();
  });

  it('claude-sonnet-4-6 tools stay STRICT (regression fixture — the split must not narrow it either)', async () => {
    const tool = await toolsSentFor('claude-sonnet-4-6');
    expect(tool.name).toBe('propose_structural_edit');
    expect(tool.strict).toBe(true);
    expect((tool.input_schema as Record<string, unknown>).additionalProperties).toBe(false);
  });
});
