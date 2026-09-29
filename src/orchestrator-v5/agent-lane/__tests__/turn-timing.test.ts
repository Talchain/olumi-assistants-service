/**
 * SEPARATING THE FIRST-TURN LATENCY.
 *
 * ⭐ WHY. Measured on the live estate, 3 days: turns with ONE provider call
 * average 37.6s (p50 47.4s, p95 73.9s) while turns with TWO average 12.2s.
 * Wall time is therefore dominated by the DURATION of a single call, not the
 * NUMBER of calls — and construction writes are 0.58s average, ~0.8% of the
 * turn. That points at model generation rather than request overhead, but the
 * turn record cannot prove it: it stores `duration_ms` and `llm_calls_used` and
 * nothing that separates provider time from in-process time.
 *
 * This is that separation, and it is deliberately arithmetic rather than
 * clever: provider time and tool time are measured directly, and overhead is
 * whatever is left. Overhead is a RESIDUAL, so it cannot silently under-report
 * — anything we forget to attribute lands in it and shows up as unexplained.
 *
 * The clock is injected so these assertions are exact rather than flaky.
 */
import { describe, it, expect, vi } from 'vitest';
import { runAgentTurn } from '../runtime/agent-loop.js';

const ctx = { scenario_id: '11111111-1111-1111-1111-111111111111', authenticated_user_id: 'u', request_id: 'r' };
const base = { ctx, history: [], message: 'hi', instructions: 'be precise', maxOutputTokens: 256 };

/** A clock that advances by a scripted amount on each read. */
function scriptedClock(steps: number[]) {
  let t = 0;
  let i = 0;
  return () => {
    const v = t;
    t += steps[i] ?? 0;
    i += 1;
    return v;
  };
}

/**
 * A clock returning EXACT values per read, so a test can construct the
 * pathological case a delta clock structurally cannot: a provider span wider
 * than the whole turn. A monotonic delta clock always yields
 * provider <= total, which is why the first version of the negative-overhead
 * test below was vacuous — the floor could be deleted and it still passed.
 * Caught by mutating the floor away.
 */
function exactClock(values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

const textOnly = async () => ({
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }],
}) as never;

describe('turn timing — provider time separated from in-process overhead', () => {
  it('reports total, provider, tool and overhead for a text-only turn', async () => {
    // reads: start, before-call, after-call, end  => call took 40_000
    const now = scriptedClock([0, 40_000, 0, 0]);
    const r = await runAgentTurn({ ...base, now }, {} as never, textOnly);
    expect(r.timing.provider_calls).toBe(1);
    expect(r.timing.tool_calls).toBe(0);
    expect(r.timing.provider_ms).toBe(40_000);
    expect(r.timing.tool_ms).toBe(0);
  });

  it('⭐ OVERHEAD IS A RESIDUAL — unattributed time cannot hide', async () => {
    const r = await runAgentTurn({ ...base, now: scriptedClock([0, 30_000, 5_000, 0]) }, {} as never, textOnly);
    expect(r.timing.overhead_ms).toBe(r.timing.total_ms - r.timing.provider_ms - r.timing.tool_ms);
    expect(r.timing.overhead_ms).toBeGreaterThanOrEqual(0);
  });

  it('never reports negative overhead even if the clock goes backwards', async () => {
    // reads: startedAt=0, providerStart=10, providerEnd=5000, end=20.
    // provider_ms = 4990 but total_ms = 20, so the raw residual is -4970.
    const r = await runAgentTurn({ ...base, now: exactClock([0, 10, 5_000, 20]) }, {} as never, textOnly);
    // POSITIVE CONTROL: the pathological case really did occur, or this test
    // proves nothing about the floor.
    expect(r.timing.provider_ms).toBeGreaterThan(r.timing.total_ms);
    expect(r.timing.overhead_ms).toBe(0);
  });

  it('accumulates provider time across HOPS, and counts them', async () => {
    let call = 0;
    const model = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          output: [{ type: 'function_call', name: 'get_canonical_state', arguments: '{}', call_id: 'c1' }],
        } as never;
      }
      return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] } as never;
    });
    const caps = { getCanonicalState: async () => ({ ok: true, mutated: false }) } as never;
    // start, call1(10s), tool(2s), call2(7s), end
    const r = await runAgentTurn({ ...base, now: scriptedClock([0, 10_000, 2_000, 7_000, 0, 0]) }, caps, model as never);
    expect(r.timing.provider_calls).toBe(2);
    expect(r.timing.tool_calls).toBe(1);
    expect(r.timing.provider_ms).toBeGreaterThan(0);
    expect(r.timing.tool_ms).toBeGreaterThan(0);
  });

  it('defaults to a real clock when none is injected — timing is always present', async () => {
    const r = await runAgentTurn(base, {} as never, textOnly);
    expect(r.timing).toBeDefined();
    expect(r.timing.provider_calls).toBe(1);
    expect(r.timing.total_ms).toBeGreaterThanOrEqual(0);
  });
});

/**
 * ⛔ A TOOL THAT MAKES ITS OWN PROVIDER CALL WAS BEING COUNTED AS OVERHEAD.
 *
 * `build_model_from_brief` is dispatched as a TOOL, and inside it
 * `build-model.ts:117` makes its own `callStructured` provider call — the
 * single most expensive call in the product. Its banked budget evidence reads
 * "in 838 / out 3404 incl. 2070 reasoning, 54.4 s".
 *
 * So the ~54s construction call landed in `tool_ms`, i.e. was reported as
 * in-process overhead. That is precisely the misattribution this split exists
 * to prevent: a latency diagnostic that files the biggest provider call in the
 * system under "overhead" would send whoever reads it after the wrong thing.
 *
 * A tool may now report `provider_ms` (and optionally `provider_calls`) on its
 * result, and the loop RECLASSIFIES that time out of `tool_ms` into
 * `provider_ms`. Absent the field nothing changes, so no other lane has to move
 * for this to be correct once they opt in.
 */
describe('turn timing — provider time INSIDE a tool is not overhead', () => {
  const ctx2 = { scenario_id: '11111111-1111-1111-1111-111111111111', authenticated_user_id: 'u', request_id: 'r' };
  const base2 = { ctx: ctx2, history: [], message: 'hi', instructions: 'go', maxOutputTokens: 256 };

  /** Model asks for the tool once, then answers. */
  function toolThenAnswer(toolResult: Record<string, unknown>) {
    let n = 0;
    const model = async () => {
      n += 1;
      if (n === 1) {
        return { output: [{ type: 'function_call', name: 'build_model_from_brief', arguments: '{"brief":"b"}', call_id: 'c1' }] } as never;
      }
      return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] } as never;
    };
    const caps = { buildModelFromBrief: async () => toolResult } as never;
    return { model: model as never, caps };
  }

  it('reclassifies a tool-reported provider_ms out of tool_ms', async () => {
    const { model, caps } = toolThenAnswer({ ok: true, mutated: true, provider_ms: 54_400 });
    // reads: start, pStart, pEnd, tStart, tEnd, pStart2, pEnd2, timingAt
    // gaps:        0,  1_000,    0, 56_000,    0,   1_000,      0
    const r = await runAgentTurn({ ...base2, now: scriptedClock([0, 1_000, 0, 56_000, 0, 1_000, 0]) }, caps, model);
    expect(r.timing.provider_ms).toBeGreaterThanOrEqual(54_400);
    // the tool wall time minus its provider time is what remains as tool time
    expect(r.timing.tool_ms).toBe(56_000 - 54_400);
    expect(r.timing.tool_provider_ms).toBe(54_400);
  });

  it('counts the tool-internal provider call', async () => {
    const { model, caps } = toolThenAnswer({ ok: true, mutated: true, provider_ms: 5_000, provider_calls: 1 });
    const r = await runAgentTurn({ ...base2, now: scriptedClock([0, 1_000, 0, 6_000, 0, 1_000, 0]) }, caps, model);
    // 2 loop calls + 1 reported by the tool
    expect(r.timing.provider_calls).toBe(3);
  });

  it('CONTRAST CONTROL — a tool that reports nothing behaves exactly as before', async () => {
    const { model, caps } = toolThenAnswer({ ok: true, mutated: true });
    const r = await runAgentTurn({ ...base2, now: scriptedClock([0, 1_000, 0, 56_000, 0, 1_000, 0]) }, caps, model);
    expect(r.timing.tool_ms).toBe(56_000);
    expect(r.timing.tool_provider_ms).toBe(0);
    expect(r.timing.provider_calls).toBe(2);
  });

  it('⛔ a tool cannot claim MORE provider time than it actually took', async () => {
    // A hostile or buggy tool reporting 10 minutes inside a 2s call must not
    // drive tool_ms negative or inflate provider_ms beyond the wall clock.
    const { model, caps } = toolThenAnswer({ ok: true, mutated: true, provider_ms: 600_000 });
    const r = await runAgentTurn({ ...base2, now: scriptedClock([0, 1_000, 0, 2_000, 0, 1_000, 0]) }, caps, model);
    expect(r.timing.tool_ms).toBeGreaterThanOrEqual(0);
    expect(r.timing.tool_provider_ms).toBeLessThanOrEqual(2_000);
  });

  it('a non-numeric provider_ms is ignored, not coerced', async () => {
    const { model, caps } = toolThenAnswer({ ok: true, mutated: true, provider_ms: 'lots' });
    const r = await runAgentTurn({ ...base2, now: scriptedClock([0, 1_000, 0, 3_000, 0, 1_000, 0]) }, caps, model);
    expect(r.timing.tool_provider_ms).toBe(0);
    expect(r.timing.tool_ms).toBe(3_000);
  });
});
