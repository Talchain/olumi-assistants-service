/**
 * ROADMAP 2.973 — claude-sonnet-5 lost GA structured outputs on the draft path
 * when the draft/edit task defaults moved 4.6 → 5 (#871, 2026-08-08).
 *
 * The adapter gated `output_config` on a SHARED set that also keys strict tool
 * calling (with NO env gate), so sonnet-5 was deliberately excluded — and the
 * model flip silently turned every draft into prompt-only JSON.
 *
 * Live-probed 2026-08-08 against api.anthropic.com (see PR body for verbatim
 * responses): sonnet-5 ACCEPTS output_config.format (HTTP 200, real 2689-byte
 * draft grammar compiles) and REJECTS thinking:{type:'enabled'} (HTTP 400).
 *
 * RED-first at pristine: the draft body carries NO `output_config` for sonnet-5.
 */

import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ bodies: [] as Array<Record<string, unknown>> }));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: (body: Record<string, unknown>) => {
        h.bodies.push(body);
        // ⚠ A RECORD SET, NOT A GRAPH (draft-by-records cutover): the draft path
        // asks for `{stated_items, claims}` and projects the graph itself, so a
        // graph payload is refused at the seam. This file reads the REQUEST, but
        // a fixture that makes every draft fail would leave these request
        // assertions riding on a swallowed rejection rather than a real draft.
        const payload = JSON.stringify({
          stated_items: [
            { kind: 'goal', source_quote: 'open a second warehouse in Leeds' },
          ],
          claims: [
            { claim_kind: 'factor', label: 'A', basis: [0] },
            {
              claim_kind: 'causal_link',
              label: 'A bears on the goal',
              basis: [0],
              from_claim: 0,
              to_stated: 0,
              effect: 'positive',
            },
          ],
        });
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: payload } };
          },
          async finalMessage() {
            return {
              content: [{ type: 'text', text: payload }],
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
const prior: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ['ANTHROPIC_API_KEY', 'CEE_ANTHROPIC_STRUCTURED_OUTPUTS']) prior[k] = process.env[k];
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-sonnet5-so';
  // Deployed staging posture, derived from the Render API 2026-08-08.
  process.env.CEE_ANTHROPIC_STRUCTURED_OUTPUTS = 'true';
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
  ({ draftGraphWithAnthropic } = await import('../anthropic.js'));
});

afterAll(async () => {
  for (const [k, v] of Object.entries(prior)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
});

afterEach(() => { h.bodies = []; });

async function draftWith(model: string): Promise<Record<string, unknown>> {
  await draftGraphWithAnthropic(
    { brief: 'Should we open a second warehouse in Leeds?', docs: [], seed: 1, model },
    { timeoutMs: 120_000, forceDefault: true },
  ).catch(() => undefined);
  expect(h.bodies.length, `no request body captured for ${model}`).toBeGreaterThanOrEqual(1);
  return h.bodies[0]!;
}

describe('draft_graph structured outputs — claude-sonnet-5 capability (ROADMAP 2.973)', () => {
  it('claude-sonnet-5 draft request carries output_config.format with the draft grammar', async () => {
    const body = await draftWith('claude-sonnet-5');
    // Identity-bound: assert on the model this test is named for, not "some model".
    expect(body.model).toBe('claude-sonnet-5');
    const oc = body.output_config as { format?: { type?: string; schema?: Record<string, unknown> } } | undefined;
    expect(oc, 'sonnet-5 draft fell back to prompt-only JSON').toBeDefined();
    expect(oc!.format!.type).toBe('json_schema');
    // Bind to the DRAFT grammar specifically, not any schema. RE-POINTED, not
    // relaxed: the draft grammar is now the RECORDS grammar (`stated_items` /
    // `claims`), because the model states records and the projector builds the
    // graph. The assertion still fails if the slot carries some other schema.
    expect(Object.keys((oc!.format!.schema as { properties: Record<string, unknown> }).properties))
      .toEqual(expect.arrayContaining(['stated_items', 'claims']));
  });

  it('claude-sonnet-4-6 keeps carrying output_config (must-not-change regression fixture)', async () => {
    const body = await draftWith('claude-sonnet-4-6');
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.output_config).toBeDefined();
  });

  it('a model with NO structured-outputs support still falls back to prompt-only, exactly as today', async () => {
    // claude-3-5-haiku-20241022: live-probed 2026-08-08 → HTTP 404 (not available).
    const body = await draftWith('claude-3-5-haiku-20241022');
    expect(body.model).toBe('claude-3-5-haiku-20241022');
    expect(body.output_config).toBeUndefined();
  });

  it('claude-sonnet-5 draft still sends thinking:{type:"disabled"} — the API REJECTS thinking.enabled for it (HTTP 400, live-probed)', async () => {
    const body = await draftWith('claude-sonnet-5');
    expect(body.thinking).toEqual({ type: 'disabled' });
  });
});
