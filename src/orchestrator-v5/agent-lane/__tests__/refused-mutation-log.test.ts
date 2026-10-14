import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '../../../utils/telemetry.js';
import { runAgentTurn, type CallModel } from '../runtime/agent-loop.js';
import type { AgentCapabilities, ToolResult } from '../runtime/agent-tools.js';

// Captured R4 row; the proposed args and detail below are controlled inputs,
// because neither was retained by the staging capture.
const witnessedRow = {
  name: 'propose_goal_current_level', ok: false, mutated: false,
  refusal: 'figure_not_in_users_words',
};
const detail = 'The figure was not stated by the user. Nothing was changed.';
const args = { goal_label: 'Productivity', value: 28, unit: 'updates/sprint', user_stated: true };
const refused: ToolResult = { ok: false, mutated: false, refusal: witnessedRow.refusal, detail };

const caps = (result: ToolResult): AgentCapabilities => ({
  getCanonicalState: async () => result,
  proposeModelChange: async () => result,
  authoriseChange: async () => result,
  runAnalysis: async () => result,
  buildModelFromBrief: async () => result,
  proposeAssumptions: async () => result,
  proposeNewOption: async () => result,
  proposeOptionInterventions: async () => result,
  proposeStartingPoint: async () => result,
  proposeGoalCurrentLevel: async () => result,
});

async function run(raw: unknown = JSON.stringify(args), result = refused, name = witnessedRow.name) {
  let hop = 0;
  const model: CallModel = async () => ({ output: hop++ === 0
    ? [{ type: 'function_call', name, arguments: raw, call_id: 'c1' }]
    : [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }],
  });
  return runAgentTurn({
    ctx: { scenario_id: 's', authenticated_user_id: null, request_id: 'req-r4' },
    history: [], message: 'The latter.', instructions: 'i', maxOutputTokens: 100,
  }, caps(result), model);
}

const spyInfo = () => vi.spyOn(log, 'info');
let info: ReturnType<typeof spyInfo>;
const events = (): Record<string, unknown>[] => info.mock.calls
  .map(([entry]) => entry as unknown)
  .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
    && (entry as Record<string, unknown>).event === 'v5.agent.tool_refused');

beforeEach(() => { info = spyInfo().mockImplementation(() => undefined as never); });
afterEach(() => { vi.restoreAllMocks(); });

describe('refused mutation diagnostics stay in the server log', () => {
  it('logs exactly once at the projection hop and preserves the witnessed four-key wire row', async () => {
    const result = await run();
    expect(result.tool_calls).toEqual([witnessedRow]);
    expect(events()).toEqual([{
      event: 'v5.agent.tool_refused', request_id: 'req-r4', tool: witnessedRow.name,
      refusal: witnessedRow.refusal, detail, proposed: args,
    }]);
    expect(result.tool_results).toEqual([refused]);
  });

  it('successful mutation produces no new event and keeps its row', async () => {
    const result = await run(JSON.stringify(args), { ok: true, mutated: false, proposal_id: 'p1' });
    expect(events()).toEqual([]);
    expect(result.tool_calls).toEqual([{ name: witnessedRow.name, ok: true, mutated: false, proposal_id: 'p1' }]);
  });

  it('a non-mutation refusal produces no new event and keeps its row', async () => {
    const result = await run('{}', refused, 'get_canonical_state');
    expect(events()).toEqual([]);
    expect(result.tool_calls).toEqual([{ ...witnessedRow, name: 'get_canonical_state' }]);
  });

  it('excludes free text, quoted messages, nested payloads and credential-like values', async () => {
    await run(JSON.stringify({
      ...args, goal_label: 'x'.repeat(81), unit: '"a user message"',
      label: 'Bearer abc123', proposal_id: 'sk-secret123',
      factor_label: 'api_key=secret', option_id: 'AKIA1234567890',
      rationale: 'even short free text', basis: 'private', user_quote: 'The latter.',
      api_key: 'private-key', password: 'private-password',
      level: { value: 123, unit: 'GBP' }, value: { secret: 'do not log' },
    }));
    expect(events()[0].proposed).toEqual({ user_stated: true });
    expect(JSON.stringify(events())).not.toContain('The latter.');
    expect(JSON.stringify(events())).not.toContain('private');
  });

  it('bounds detail to 300 characters and the serialized scalar summary to 600', async () => {
    const many = {
      value: 28, unit: 'u word '.repeat(12).slice(0, 80), label: 'l word '.repeat(12).slice(0, 80), goal_label: 'g word '.repeat(12).slice(0, 80),
      factor_label: 'f word '.repeat(12).slice(0, 80), option_label: 'o word '.repeat(12).slice(0, 80), from_label: 'a word '.repeat(12).slice(0, 80),
      to_label: 'b word '.repeat(12).slice(0, 80), proposal_id: 'p word '.repeat(12).slice(0, 80),
    };
    // Space-separated words avoid being mistaken for an opaque credential.
    await run(JSON.stringify(many), { ...refused, detail: 'Nothing was changed. '.repeat(100) });
    const event = events()[0];
    expect((event.detail as string).length).toBe(300);
    const proposed = event.proposed as Record<string, unknown>;
    expect(JSON.stringify(proposed).length).toBeLessThanOrEqual(600);
    expect(proposed.value).toBe(28);
    expect(Object.keys(proposed).length).toBeLessThan(Object.keys(many).length);
    for (const value of Object.values(proposed)) {
      if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(80);
    }
  });

  it('redacts quoted detail and credentials before bounding', async () => {
    await run(JSON.stringify(args), { ...refused, detail: 'Not stated: “private user\nwords”. Nothing changed.' });
    expect(events()[0].detail).toBe('Not stated: [redacted]. Nothing changed.');
    info.mockClear();
    await run(JSON.stringify(args), { ...refused, detail: `${'Safe words. '.repeat(40)}Bearer secret-value` });
    expect(events()[0].detail).toBe('[redacted]');
  });

  it.each(['{', 'null', '[]', '42', '"private"'])('malformed/non-object args %s are safe', async (raw) => {
    const result = await run(raw);
    expect(events()).toHaveLength(1);
    expect(events()[0].proposed).toEqual({});
    expect(events()[0].refusal).toBe('unparsable_arguments');
    expect(result.tool_calls[0].refusal).toBe('unparsable_arguments');
  });

  it('does not coerce non-string arguments into diagnostic data', async () => {
    await run({ value: 123, unit: 'private' });
    expect(events()).toHaveLength(1);
    expect(events()[0].proposed).toEqual({});
  });

  it('logs another refused mutation without changing its existing exact row', async () => {
    const result = await run('{"proposal_id":"prop_nope"}', {
      ok: false, mutated: false, refusal: 'unknown_proposal',
    }, 'authorise_change');
    expect(result.tool_calls).toEqual([{ name: 'authorise_change', ok: false, mutated: false, refusal: 'unknown_proposal' }]);
    expect(events()).toHaveLength(1);
    expect(events()[0].proposed).toEqual({ proposal_id: 'prop_nope' });
  });
});
