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
