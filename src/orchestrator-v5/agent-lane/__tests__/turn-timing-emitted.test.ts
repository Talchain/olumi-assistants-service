/**
 * ⛔ A MEASUREMENT NOBODY CAN SEE IS NOT A MEASUREMENT.
 *
 * `TurnTiming` was computed and returned on the result, and then read by
 * nobody: a repo-wide sweep for `.timing` found 23 hits, every one of them the
 * estate's pre-existing `timingDebugEnabled` system, and ZERO reading
 * `result.timing`. `agent-loop.ts` had 0 emit/log calls. Contrast control: the
 * sibling field `.tool_calls` has 6 non-test readers, including
 * `agent-v1-turn.ts:587` which logs them — so the probe was not blind.
 *
 * That is the same "inert" failure as the eligibility helper earlier: complete,
 * tested, and reachable by nobody. I have spent the night arguing from latency
 * attribution while the attribution itself could not be observed in production.
 *
 * The natural consumer is `agent-v1-turn.ts`, which is inside another lane's
 * lease, so the loop logs it itself — gated on the estate's OWN timing flags so
 * it is default-OFF and consistent with every other timing surface here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock('../../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  mockConfig.value = {
    ...actual.config,
    cee: { ...actual.config.cee, timingDebugEnabled: false },
    features: { ...actual.config.features, diagnosticTraceEnabled: false },
  };
  return { ...actual, config: mockConfig.value };
});

const info = vi.fn();
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

// Force the config mock factory to run before any setFlags call — the factory
// only executes on first import of the mocked module.
await import('../../../config/index.js');
const { runAgentTurn, toolCallOutcome } = await import('../runtime/agent-loop.js');

const ctx = { scenario_id: '11111111-1111-1111-1111-111111111111', authenticated_user_id: 'u', request_id: 'req-9' };
const base = { ctx, history: [], message: 'hi', instructions: 'go', maxOutputTokens: 256 };
const textOnly = async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }) as never;

function setFlags(timing: boolean, diagnostic = false) {
  const c = mockConfig.value as { cee: Record<string, unknown>; features: Record<string, unknown> };
  c.cee.timingDebugEnabled = timing;
  c.features.diagnosticTraceEnabled = diagnostic;
}

beforeEach(() => { info.mockClear(); setFlags(false, false); });

const timingLogs = () => info.mock.calls.filter((c) => (c[0] as { event?: string })?.event === 'agent_lane.turn_timings');

describe('turn timing is observable in production', () => {
  it('emits the timing under the estate timing flag', async () => {
    setFlags(true);
    await runAgentTurn(base, {} as never, textOnly);
    const logs = timingLogs();
    expect(logs).toHaveLength(1);
    const payload = logs[0][0] as Record<string, unknown>;
    // Identity, not shape: the line must name THIS turn and carry the split.
    expect(payload.scenario_id).toBe(ctx.scenario_id);
    expect(payload.request_id).toBe('req-9');
    expect(payload).toHaveProperty('provider_ms');
    expect(payload).toHaveProperty('tool_ms');
    expect(payload).toHaveProperty('overhead_ms');
    expect(payload).toHaveProperty('tool_provider_ms');
    expect(payload).toHaveProperty('provider_calls');
  });

  it('also emits under the diagnostic-trace flag, matching the estate pattern', async () => {
    setFlags(false, true);
    await runAgentTurn(base, {} as never, textOnly);
    expect(timingLogs()).toHaveLength(1);
  });

  it('⛔ CONTRAST CONTROL — DEFAULT OFF: both flags false emits nothing', async () => {
    setFlags(false, false);
    await runAgentTurn(base, {} as never, textOnly);
    expect(timingLogs()).toHaveLength(0);
  });

  it('⭐ names each tool call and its outcome, in order (DL S4: the 16:17Z RCA had to read code; the line held only a count)', async () => {
    setFlags(true);
    let n = 0;
    const scripted = async () => (++n === 1 ? { output: [
      { type: 'function_call', name: 'get_canonical_state', call_id: 'c1', arguments: '{}' },
      { type: 'function_call', name: 'propose_goal_deadline', call_id: 'c2', arguments: JSON.stringify({ deadline_words: 'six months', rationale: 'x' }) },
    ] } : { output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }) as never;
    const capabilities = {
      getCanonicalState: async () => ({ ok: true, mutated: false }),
      proposeGoalDeadline: async () => ({ ok: false, mutated: false, refusal: 'origin_unknown', detail: 'x' }),
    };
    await runAgentTurn(base, capabilities as never, scripted);
    expect((timingLogs()[0]![0] as Record<string, unknown>).calls).toEqual([
      { tool: 'get_canonical_state', outcome: 'done' },
      { tool: 'propose_goal_deadline', outcome: 'refused', code: 'origin_unknown' },
    ]);
  });

  it.each([
    [{ name: 'authorise_change', ok: true, mutated: true, proposal_id: 'p1', outcome: 'applied' }, { tool: 'authorise_change', outcome: 'committed', detail: 'applied' }],
    [{ name: 'propose_assumptions', ok: true, mutated: false, proposal_id: 'p2' }, { tool: 'propose_assumptions', outcome: 'proposed' }],
    [{ name: 'withdraw_proposal', ok: true, mutated: false, proposal_id: 'p3' }, { tool: 'withdraw_proposal', outcome: 'withdrawn' }],
    [{ name: 'authorise_change', ok: false, mutated: false }, { tool: 'authorise_change', outcome: 'refused', code: 'error' }],
  ])('outcome of %j', (call, expected) => {
    expect(toolCallOutcome(call)).toEqual(expected);
  });

  it('the returned result still carries the timing regardless of the flag', async () => {
    setFlags(false, false);
    const r = await runAgentTurn(base, {} as never, textOnly);
    expect(r.timing.provider_calls).toBe(1);
  });
});
