/**
 * Every Anthropic limb made LIVE by a checked-in Anthropic task default must
 * honour the rejects-sampling-params gate: the two provider-constrained tasks
 * (explain_diff, critique_graph) and clarify_brief.
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
 * clarify_brief arrived by the SAME route (2026-08-29): its limb hardcoded
 * `temperature: args.seed ? 0 : 0.1` and was unreachable while the task had no
 * checked-in default and fell through to the OpenAI provider default. Pinning
 * it to claude-sonnet-5 makes the limb live, so without the gate every
 * POST /assist/clarify-brief would 400. Third instance of one defect shape.
 *
 * The twin below is the discrimination: a model that does NOT reject sampling
 * params must still receive its requested temperature, so this is a gate, not a
 * blanket removal.
 */
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  bodies: [] as Array<Record<string, unknown>>,
  // Explicit per-test response selector. Left unset the mock keeps its original
  // system-block heuristic, so the existing explain_diff/critique cases are
  // byte-for-byte unchanged.
  mode: undefined as undefined | 'clarify',
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: (body: Record<string, unknown>) => {
        h.bodies.push(body);
        // The critique limb sends a `system` block; explain-diff does not.
        const text = h.mode === 'clarify'
          ? '{"questions":[{"question":"Which market segment matters most here?","why_we_ask":"the answer changes which options are worth modelling at all","impacts_draft":"it decides which decision node anchors the resulting graph"}],"confidence":0.6,"should_continue":true}'
          : body.system
          ? '{"issues":[{"level":"OBSERVATION","note":"the graph omits a cost factor"}],"suggested_fixes":[],"overall_quality":"good"}'
          : '{"rationales":[{"target":"n1","why":"added to represent the option","provenance_source":"user_brief"}]}';
        return Promise.resolve({
          content: [{ type: 'text', text }],
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
let critiqueGraphWithAnthropic: typeof import('../anthropic.js').critiqueGraphWithAnthropic;
let clarifyBriefWithAnthropic: typeof import('../anthropic.js').clarifyBriefWithAnthropic;
let priorKey: string | undefined;

const GRAPH = {
  nodes: [
    { id: 'n1', kind: 'factor', label: 'Price' },
    { id: 'n2', kind: 'outcome', label: 'Margin' },
  ],
  edges: [{ id: 'e1', from: 'n1', to: 'n2' }],
};

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
  ({
    explainDiffWithAnthropic,
    critiqueGraphWithAnthropic,
    clarifyBriefWithAnthropic,
  } = await import('../anthropic.js'));
});

afterAll(async () => {
  if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = priorKey;
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
});

afterEach(() => {
  h.bodies.length = 0;
  h.mode = undefined;
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

  it('omits temperature entirely for critique_graph on a rejects-sampling-params model', async () => {
    await critiqueGraphWithAnthropic({
      graph: GRAPH,
      model: REJECTS_SAMPLING_MODEL,
    } as Parameters<typeof critiqueGraphWithAnthropic>[0]);
    expect(h.bodies).toHaveLength(1);
    const body = h.bodies[0]!;
    expect(body.model).toBe(REJECTS_SAMPLING_MODEL);
    expect(body.temperature).toBeUndefined();
  });

  it('still sends temperature 0 for critique_graph on a model that accepts sampling params', async () => {
    await critiqueGraphWithAnthropic({
      graph: GRAPH,
      model: ACCEPTS_SAMPLING_MODEL,
    } as Parameters<typeof critiqueGraphWithAnthropic>[0]);
    expect(h.bodies).toHaveLength(1);
    const body = h.bodies[0]!;
    expect(body.model).toBe(ACCEPTS_SAMPLING_MODEL);
    expect(body.temperature).toBe(0);
  });
  const BRIEF =
    'We must decide whether to move upmarket to enterprise or double down on SMB self-serve.';

  it('omits temperature entirely for clarify_brief on a rejects-sampling-params model', async () => {
    h.mode = 'clarify';
    await clarifyBriefWithAnthropic({
      brief: BRIEF,
      round: 0,
      model: REJECTS_SAMPLING_MODEL,
    } as Parameters<typeof clarifyBriefWithAnthropic>[0]);
    expect(h.bodies).toHaveLength(1);
    const body = h.bodies[0]!;
    expect(body.model).toBe(REJECTS_SAMPLING_MODEL);
    expect(body.temperature).toBeUndefined();
  });

  it('still sends the requested temperature for clarify_brief on a model that accepts sampling params', async () => {
    h.mode = 'clarify';
    await clarifyBriefWithAnthropic({
      brief: BRIEF,
      round: 0,
      model: ACCEPTS_SAMPLING_MODEL,
    } as Parameters<typeof clarifyBriefWithAnthropic>[0]);
    expect(h.bodies).toHaveLength(1);
    const body = h.bodies[0]!;
    expect(body.model).toBe(ACCEPTS_SAMPLING_MODEL);
    expect(body.temperature).toBe(0.1);
  });

  it('keeps clarify_brief deterministic (temperature 0) for a seeded request on a sampling-capable model', async () => {
    h.mode = 'clarify';
    await clarifyBriefWithAnthropic({
      brief: BRIEF,
      round: 0,
      seed: 42,
      model: ACCEPTS_SAMPLING_MODEL,
    } as Parameters<typeof clarifyBriefWithAnthropic>[0]);
    expect(h.bodies).toHaveLength(1);
    expect(h.bodies[0]!.temperature).toBe(0);
  });
});
