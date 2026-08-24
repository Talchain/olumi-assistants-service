/**
 * The two provider-constrained tasks (explain_diff, critique_graph) must honour
 * the rejects-sampling-params gate.
 *
 * Both Anthropic limbs hardcoded `temperature: 0` instead of routing through
 * `anthropicTemperatureFor`, the single source the estate introduced precisely
 * because call sites kept forgetting the gate. It was unreachable and therefore
 * invisible: neither task's checked-in default resolved to an Anthropic model,
 * so the router's capability gate rejected the task before any Anthropic request
 * was built. Giving both tasks an Anthropic default makes these limbs live — and
 * claude-sonnet-5 is a rejects-sampling-params model, so the hardcoded value
 * would have produced an API 400 on every call.
 *
 * The twin below is the discrimination: a model that does NOT reject sampling
 * params must still receive temperature 0, so this is a gate, not a blanket
 * removal.
 */
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  bodies: [] as Array<Record<string, unknown>>,
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: (body: Record<string, unknown>) => {
        h.bodies.push(body);
        return Promise.resolve({
          content: [
            {
              type: 'text',
              text: '{"rationales":[{"target":"n1","why":"added to represent the option","provenance_source":"user_brief"}]}',
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        });
      },
    };
  }
  return { default: MockAnthropic };
});

const REJECTS_SAMPLING_MODEL = 'claude-sonnet-5';
const ACCEPTS_SAMPLING_MODEL = 'claude-sonnet-4-5-20250929';

let explainDiffWithAnthropic: typeof import('../anthropic.js').explainDiffWithAnthropic;
let priorKey: string | undefined;

const PATCH = {
  adds: { nodes: [{ id: 'n1', kind: 'factor', label: 'N1' }], edges: [] },
  updates: [],
  removes: [],
};

beforeAll(async () => {
  priorKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-sampling-gate';
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
  ({ explainDiffWithAnthropic } = await import('../anthropic.js'));
});

afterAll(async () => {
  if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = priorKey;
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
});

afterEach(() => {
  h.bodies.length = 0;
});

describe('provider-constrained task sampling-param gate', () => {
  it('pins the precondition: the two models under test differ on rejectsSamplingParams', async () => {
    const { rejectsSamplingParams } = await import('../../../config/models.js');
    expect(rejectsSamplingParams(REJECTS_SAMPLING_MODEL)).toBe(true);
    expect(rejectsSamplingParams(ACCEPTS_SAMPLING_MODEL)).toBe(false);
  });

  it('omits temperature entirely for explain_diff on a rejects-sampling-params model', async () => {
    await explainDiffWithAnthropic({ patch: PATCH, model: REJECTS_SAMPLING_MODEL });
    expect(h.bodies).toHaveLength(1);
    const body = h.bodies[0]!;
    expect(body.model).toBe(REJECTS_SAMPLING_MODEL);
    expect(Object.prototype.hasOwnProperty.call(body, 'temperature')).toBe(true);
    expect(body.temperature).toBeUndefined();
  });

  it('still sends temperature 0 for explain_diff on a model that accepts sampling params', async () => {
    await explainDiffWithAnthropic({ patch: PATCH, model: ACCEPTS_SAMPLING_MODEL });
    expect(h.bodies).toHaveLength(1);
    const body = h.bodies[0]!;
    expect(body.model).toBe(ACCEPTS_SAMPLING_MODEL);
    expect(body.temperature).toBe(0);
  });
});
