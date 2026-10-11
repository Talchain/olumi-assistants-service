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
import { createHash } from 'node:crypto';
import { HandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { capture, findState, valueAt } from './provider-harness.js';

const AIE_APPROVED_USE_SHA256 = '7819664466d9f90cbe478b0b6804b98c44c6265ccbb41f2313b0f9381daf479e';
const dissent = (finding: string, statement: string, noop = false): HandlerFact => HandlerFactSchema.parse({
  fact_type: 'finding_dissent', fact_version: 1, noop,
  result: { finding_id: finding, analysis_id: '0d9c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d', statement, provenance: 'user_set' },
});
// The scenario-wide `finding_dissent` read, NOT the conversation window: `readRecent`/`readFactsFor` are NOT given, so a
// regression that reads objections through the turn window (a second history read per turn) finds none and goes RED.
const withFacts = (facts: readonly HandlerFact[]) => ({
  storage: {
    readStatedObjectionFactsFor: async () => structuredClone(facts),
  },
});
const payloadsOf = (w: Awaited<ReturnType<typeof capture>>) => w.calls.flatMap(c => c.payloads);

describe.each(['ordinary-converse', 'selected-converse'] as const)('S8 stated objections on %s', turn => {
  it('CONTRAST: no dissent fact → neither key is in any provider payload', async () => {
    const w = await capture(turn, 'run2');
    expect(valueAt(payloadsOf(w), 'stated_objections')).toEqual([]);
    expect(valueAt(payloadsOf(w), 'stated_objections_use')).toEqual([]);
    expect(valueAt(payloadsOf(w), 'stated_objections_unreadable')).toEqual([]);
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
    // The LLM-facing sentence is pinned BY BYTES to the AIE-approved amendment (#94 6103551589).
    for (const use of valueAt(payloadsOf(w), 'stated_objections_use')) {
      expect(createHash('sha256').update(String(use)).digest('hex')).toBe(AIE_APPROVED_USE_SHA256);
    }
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

  it('an unreadable fact store never fails the turn and is UNKNOWN, not none: the model is told the list could not be read', async () => {
    const w = await capture(turn, 'run2', { storage: {
      readStatedObjectionFactsFor: async () => { throw new Error('store unavailable'); },
    } });
    expect(w.calls.length).toBeGreaterThan(0);
    expect(valueAt(payloadsOf(w), 'stated_objections')).toEqual([]);
    expect(valueAt(payloadsOf(w), 'stated_objections_use')).toEqual([]);
    const flags = valueAt(payloadsOf(w), 'stated_objections_unreadable');
    expect(flags.length).toBeGreaterThan(0);
    for (const f of flags) expect(f).toBe(true);
  }, 60_000);

  it('a store WITHOUT the stated-objections read is UNKNOWN as well: an absent capability is not a successful empty read', async () => {
    // `undefined` overrides the harness default (a successful empty read), so the route finds no reader at all.
    const w = await capture(turn, 'run2', { storage: { readStatedObjectionFactsFor: undefined } });
    expect(w.calls.length).toBeGreaterThan(0);
    expect(valueAt(payloadsOf(w), 'stated_objections')).toEqual([]);
    expect(valueAt(payloadsOf(w), 'stated_objections_use')).toEqual([]);
    const flags = valueAt(payloadsOf(w), 'stated_objections_unreadable');
    expect(flags.length).toBeGreaterThan(0);
    for (const f of flags) expect(f).toBe(true);
  }, 60_000);

  it('CONTRAST: a readable list with no dissent, and a readable list with one, never carry the unreadable flag', async () => {
    const none = await capture(turn, 'run2', withFacts([]));
    expect(valueAt(payloadsOf(none), 'stated_objections_unreadable')).toEqual([]);
    const one = await capture(turn, 'run2', withFacts([dissent('finding-price', 'The contract runs to 2028.')]));
    expect(valueAt(payloadsOf(one), 'stated_objections_unreadable')).toEqual([]);
    expect(valueAt(payloadsOf(one), 'stated_objections').length).toBeGreaterThan(0);
  }, 60_000);
});
