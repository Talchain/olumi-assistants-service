/**
 * S8 · DURABLE HUMAN REASONING REACHES THE MOUNTED AGENT TURN, BEFORE INFERENCE (register row 2).
 *
 * The user's stated disagreement (`finding_dissent`) had a complete producer chain and, on the Agent lane, no reader:
 * the V5 ContextPack carried it, the lane that actually serves turns did not. These rows read decoded provider bytes of
 * the REAL `/agent/v1/turn` route (provider-harness: storage doubles only, fetch intercepted, no network).
 *
 * Default bytes: with no dissent fact the keys are ABSENT (the parity rows in run-explanation-turn-parity pin the
 * provider SHAs). Contrast: the same request with one dissent fact carries it verbatim, newest-per-finding, at most 3.
 */
import { describe, expect, it } from 'vitest';
import { HandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { capture, findState, valueAt } from './provider-harness.js';

const dissent = (finding: string, statement: string, noop = false): HandlerFact => HandlerFactSchema.parse({
  fact_type: 'finding_dissent', fact_version: 1, noop,
  result: { finding_id: finding, analysis_id: '0d9c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d', statement, provenance: 'user_set' },
});
const withFacts = (facts: readonly HandlerFact[]) => ({
  storage: {
    readRecent: async () => [{ id: 'row-1' }],
    readFactsFor: async () => structuredClone(facts),
  },
});
const payloadsOf = (w: Awaited<ReturnType<typeof capture>>) => w.calls.flatMap(c => c.payloads);

describe.each(['ordinary-converse', 'selected-converse'] as const)('S8 stated objections on %s', turn => {
  it('CONTRAST: no dissent fact → neither key is in any provider payload', async () => {
    const w = await capture(turn, 'run2');
    expect(valueAt(payloadsOf(w), 'stated_objections')).toEqual([]);
    expect(valueAt(payloadsOf(w), 'stated_objections_use')).toEqual([]);
  }, 60_000);

  it('a stated objection reaches the Agent verbatim, addressed by id, with how to use it', async () => {
    const reason = 'We cannot change suppliers: the contract runs to 2028.';
    const w = await capture(turn, 'run2', withFacts([dissent('finding-price', reason)]));
    const carried = valueAt(payloadsOf(w), 'stated_objections');
    expect(carried.length).toBeGreaterThan(0);
    for (const c of carried) {
      expect(c).toEqual([{ finding_id: 'finding-price', analysis_id: '0d9c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d', statement: reason }]);
    }
    expect(valueAt(payloadsOf(w), 'stated_objections_use').length).toBe(carried.length);
    // It sits in the canonical state the model reads, beside the analysis it disagrees with.
    expect(Object.keys(findState(w.calls[0]!.payloads))).toContain('stated_objections');
  }, 60_000);

  it('newest wins per finding (the older reason is not handed over), two findings are both kept, a noop is not an objection', async () => {
    const w = await capture(turn, 'run2', withFacts([ // newest first, as the turn window delivers them
      dissent('finding-a', 'Newest reason about A.'),
      dissent('finding-b', 'Reason about B.'),
      dissent('finding-a', 'Older reason about A, since rewritten.'),
      dissent('finding-c', 'A noop receipt is no objection.', true),
    ]));
    const carried = valueAt(payloadsOf(w), 'stated_objections')[0] as { finding_id: string; statement: string }[];
    expect(carried.map(o => o.statement)).toEqual(['Newest reason about A.', 'Reason about B.']);
    expect(JSON.stringify(payloadsOf(w))).not.toContain('Older reason about A');
    expect(JSON.stringify(payloadsOf(w))).not.toContain('A noop receipt');
  }, 60_000);

  it('an unreadable fact store is no objections, never a failed turn', async () => {
    const w = await capture(turn, 'run2', { storage: {
      readRecent: async () => { throw new Error('store unavailable'); },
    } });
    expect(w.calls.length).toBeGreaterThan(0);
    expect(valueAt(payloadsOf(w), 'stated_objections')).toEqual([]);
  }, 60_000);
});
