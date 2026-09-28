/**
 * ⭐ PJ-C1 TOKENS: A TOOL PAIR WHOSE OUTPUT IS ALREADY A STUB LEAVES THE HISTORY — CALL, STUB AND ITS REASONING.
 *
 * Measured on the DL's joined run 1 (CEE c35f1c7, `pj-20260928T074951Z` A09, 18,284 input tokens), split exactly with
 * OpenAI's token counter on the route's real request: instructions 4,035 + tools 5,638 + state 3,084 + message 40, and
 * about 5,490 of history. Bottom-up from the served per-turn deltas, about 1.2k of that history is the ARGUMENTS of three
 * proposals already approved and applied: `pruneSupersededToolOutputs` stubbed their outputs but kept every call. A
 * kept reasoning item is re-billed too (measured: +39 tokens for a 39-token item) and must travel with its call.
 *
 * THE RULE: after the prune, a `function_call` whose output is one of the prune's stubs (a superseded snapshot, an
 * applied proposal, an earlier approval) is dropped WITH that output, and the reasoning item that produced it is dropped
 * when EVERY call it produced is dropped. Messages are never touched: the user's words and Olumi's replies stay, and the
 * model is given the current state every turn. The latest run's pair, the latest approval and a proposal still
 * awaiting a yes are kept byte for byte. The result is always valid input: no output without its call, no call without
 * the reasoning item it came with.
 *
 * The history is the journey-A-shaped fixture #2130 measured on (`fixtures/a-journey-history.ts`), with a reasoning item
 * before each model output, as the loop echoes it (`agent-loop.ts`: "the whole output array first").
 */
import { describe, expect, it } from 'vitest';
import { journeyTurns, SERVED_READBACK } from './fixtures/a-journey-history.js';
import {
  APPLIED_PROPOSAL_OUTPUT, EARLIER_APPROVAL_OUTPUT, SUPERSEDED_OUTPUT, dropSupersededPairs, pruneSupersededToolOutputs,
} from '../history-store.js';

type Item = { type?: string; role?: string; call_id?: string; name?: string; output?: string; id?: string };
const STUBS = new Set([SUPERSEDED_OUTPUT, APPLIED_PROPOSAL_OUTPUT, EARLIER_APPROVAL_OUTPUT]);

/** Each model call's output as the loop echoes it: a reasoning item first, then its calls or message. */
function withReasoning(items: readonly unknown[]): Item[] {
  const out: Item[] = [];
  let n = 0;
  let prevWasModel = false;
  for (const raw of items) {
    const i = raw as Item;
    const fromModel = i.type === 'function_call' || (i.type === 'message' && i.role === 'assistant');
    if (fromModel && !prevWasModel) out.push({ type: 'reasoning', id: `rs_${(n += 1)}` });
    out.push(i);
    prevWasModel = i.type === 'function_call';
  }
  return out;
}

/** The history as the route stores it, turn by turn: prune, then drop. */
function stored(path: 'chip' | 'composer', drop = true): Item[] {
  let items: unknown[] = [];
  for (const t of journeyTurns(path)) {
    items = pruneSupersededToolOutputs([...items, ...withReasoning(t.items)], t.approvals, SERVED_READBACK as never);
    if (drop) items = dropSupersededPairs(items);
  }
  return items as Item[];
}

/** Valid Responses input: every output has its call; every call that came with a reasoning item still has it. */
function assertValidInput(items: readonly Item[]): void {
  const calls = new Set(items.filter((i) => i.type === 'function_call').map((i) => i.call_id));
  for (const o of items.filter((i) => i.type === 'function_call_output')) expect(calls.has(o.call_id), `output ${o.call_id} has its call`).toBe(true);
  items.forEach((i, k) => {
    if (i.type !== 'reasoning') return;
    const next = items[k + 1];
    expect(next?.type === 'function_call' || (next?.type === 'message'), `reasoning ${i.id} is followed by what it produced`).toBe(true);
  });
}

const messages = (items: readonly Item[]) => items.filter((i) => i.role === 'user' || i.type === 'message').map((i) => JSON.stringify(i));

describe('⭐ PJ-C1 tokens: a pair whose output is a stub leaves the history', () => {
  for (const path of ['chip', 'composer'] as const) {
    it(`RED (${path}): no stub is carried, and no call whose output was a stub`, () => {
      const before = stored(path, false);
      expect(before.some((i) => i.type === 'function_call_output' && STUBS.has(String(i.output))), 'precondition: the prune leaves stubs').toBe(true);
      const after = stored(path);
      expect(after.filter((i) => i.type === 'function_call_output' && STUBS.has(String(i.output)))).toEqual([]);
      assertValidInput(after);
    });

    it(`(${path}) every message is kept, in order, byte for byte`, () => {
      expect(messages(stored(path))).toEqual(messages(stored(path, false)));
    });

    it(`(${path}) the latest run, the latest approval and their reasoning stay`, () => {
      const before = stored(path, false);
      const after = stored(path);
      const kept = (i: Item) => i.type === 'function_call_output' && !STUBS.has(String(i.output));
      expect(after.filter(kept)).toEqual(before.filter(kept));
      for (const o of after.filter(kept)) {
        const k = after.findIndex((i) => i.type === 'function_call' && i.call_id === o.call_id);
        expect(k, `call ${o.call_id} is kept`).toBeGreaterThanOrEqual(0);
      }
      expect(after.filter((i) => i.type === 'function_call' && i.name === 'run_analysis')).toHaveLength(1);
    });

    it(`MEASURED (${path}): the stored history shrinks`, () => {
      const size = (xs: readonly unknown[]) => JSON.stringify(xs).length;
      const b = size(stored(path, false));
      const a = size(stored(path));
      expect(a).toBeLessThan(b);
      // Printed for the PR: the served token effect is the gate, not this count.
      console.log(`[${path}] stored history ${b} → ${a} chars (−${(100 * (b - a) / b).toFixed(1)}%)`);
    });
  }

  it('a reasoning item that also produced a KEPT call keeps all its calls (never a reasoning item without what it produced)', () => {
    const items: Item[] = [
      { role: 'user' },
      { type: 'reasoning', id: 'rs_1' },
      { type: 'function_call', call_id: 'a', name: 'propose_new_risk' },
      { type: 'function_call', call_id: 'b', name: 'propose_link_strength' },
      { type: 'function_call_output', call_id: 'a', output: APPLIED_PROPOSAL_OUTPUT },
      { type: 'function_call_output', call_id: 'b', output: JSON.stringify({ ok: true, proposal_id: 'prop_pending' }) },
      { type: 'message', role: 'assistant' },
    ];
    expect(dropSupersededPairs(items)).toEqual(items);
  });

  it('a pending proposal pair and its reasoning are kept byte for byte', () => {
    const items: Item[] = [
      { role: 'user' },
      { type: 'reasoning', id: 'rs_1' },
      { type: 'function_call', call_id: 'p', name: 'propose_new_option' },
      { type: 'function_call_output', call_id: 'p', output: JSON.stringify({ ok: true, proposal_id: 'gmh_1' }) },
      { type: 'message', role: 'assistant' },
    ];
    expect(dropSupersededPairs(items)).toEqual(items);
  });

  it('drops a lone stubbed pair with its reasoning; the reply stays', () => {
    const items: Item[] = [
      { role: 'user' },
      { type: 'reasoning', id: 'rs_1' },
      { type: 'function_call', call_id: 'x', name: 'build_model_from_brief' },
      { type: 'function_call_output', call_id: 'x', output: SUPERSEDED_OUTPUT },
      { type: 'reasoning', id: 'rs_2' },
      { type: 'message', role: 'assistant' },
    ];
    expect(dropSupersededPairs(items)).toEqual([{ role: 'user' }, { type: 'reasoning', id: 'rs_2' }, { type: 'message', role: 'assistant' }]);
  });

  it('idempotent: dropping twice is dropping once', () => {
    const once = stored('chip');
    expect(dropSupersededPairs(once)).toEqual(once);
  });
});
