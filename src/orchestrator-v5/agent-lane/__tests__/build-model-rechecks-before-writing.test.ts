/**
 * ⛔⛔ A CONSTRUCTION MUST NOT DESTROY AN EDIT MADE WHILE IT WAS THINKING.
 *
 * `agent-capabilities.ts` refuses `model_already_exists` when the graph already
 * has nodes — but it reads that BEFORE calling `buildModelFromBrief`, and the
 * generative call inside takes tens of seconds. A person who starts a build from
 * a brief and then adds a node on the canvas, well within that window, had their
 * node REPLACED: registration writes the whole graph, and `operation_id` only
 * de-duplicates an IDENTICAL construction, so it cannot see a different writer.
 *
 * ⚠ THE CONTROL BELOW IS BUILT TO CATCH THE MISTAKE I ACTUALLY MADE. My first
 * attempt put the re-check AFTER `buildModelFromBrief` returned — which is too
 * late, because the registration happens inside it. So this test asserts the
 * ORDER (no register call at all), not merely the refusal: a check placed after
 * the write would still produce a refusal while having already overwritten.
 *
 * ⚠ IT NARROWS THE WINDOW, IT DOES NOT CLOSE IT — the remaining gap is this read
 * to the route's own read. A creation write cannot express a CAS expectation at
 * all: `computeExpectedGraphCasHashes` returns `analysis=null` for `null`,
 * `undefined` and `{nodes:[],edges:[]}` alike, so any expectation would 409 every
 * construction. That closure belongs at the write boundary.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const BRIEF = 'Decide whether to raise the Pro price.';

/**
 * The candidate fixture from `build-model-capability.test.ts` — the shape the
 * admitter actually accepts. ⚠ My first attempt invented a nodes/edges graph and
 * every test failed with `construction_failed`, because `callStructured` returns
 * `{ text }` carrying a CANDIDATE (goal/options/factors/links), not a graph.
 */
const CANDIDATE = {
  goal: { metric: 'MRR', operator: '>=', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit' },
  constraints: [{ metric: 'Monthly churn', operator: '<', value: 4, unit: '%', provenance: 'explicit' }],
  options: [{ label: 'Raise Pro to \u00a359', provenance: 'explicit', interventions: [] }],
  factors: [
    { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit' },
    { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: null, unit: '%', provenance: 'explicit' },
  ],
  risks: [{ label: 'Churn rises', provenance: 'inferred' }],
  outcomes: [{ label: 'Monthly recurring revenue', provenance: 'inferred' }],
  links: [{ from: 'Pro plan price', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
};

const structured: CallStructuredModel = async () => ({ text: JSON.stringify(CANDIDATE) });

/**
 * `concurrentWriteAfterRead` models the race. ⚠ This test calls
 * `buildModelFromBrief` DIRECTLY, so the caller's own guard read does not happen
 * here — the only graph read inside this function is the re-check under test.
 * My first harness populated only from the SECOND read, modelling a call path
 * this test does not exercise, and both race assertions passed for the wrong
 * reason. The node is therefore present from the first read: the caller already
 * saw empty, seconds ago, which is precisely the premise.
 */
function product(opts: { concurrentWriteAfterRead?: boolean; readFails?: boolean } = {}) {
  const calls: string[] = [];
  let reads = 0;
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph/register')) {
      calls.push('REGISTER');
      return { status: 200, json: { model_version: { version_number: 1, version_id: 'v1', mutation_id: 'm1' } } };
    }
    if (path.endsWith('/versions')) { calls.push('VERSIONS'); return { status: 200, json: { versions: [] } }; }
    reads += 1;
    calls.push(`READ${reads}`);
    if (opts.readFails === true) return { status: 503, json: {} };
    const populated = opts.concurrentWriteAfterRead === true;
    return {
      status: 200,
      json: {
        graph: populated ? { nodes: [{ id: 'mine', kind: 'factor', label: 'A factor I added myself' }], edges: [] } : { nodes: [], edges: [] },
        graph_hash: populated ? 'moved' : 'empty',
      },
    };
  };
  return { d, calls, registers: () => calls.filter((c) => c === 'REGISTER').length };
}

describe('a construction re-checks the model immediately before it writes', () => {
  it('⛔⛔ NOTHING IS REGISTERED when a node appeared while the model was thinking', async () => {
    const p = product({ concurrentWriteAfterRead: true });
    const r = await buildModelFromBrief(SCENARIO, BRIEF, p.d, structured);

    expect(r.ok).toBe(false);
    expect(r.mutated).toBe(false);
    expect(r.refusal).toBe('model_already_exists');
    // ⭐ THE ORDER IS THE PROPERTY, not the refusal. A re-check placed AFTER the
    // register — the mistake I made first — would still refuse here while having
    // already destroyed the user's node. Zero register calls is what proves it.
    expect(p.registers(), 'the construction wrote before re-checking').toBe(0);
  });

  it('⭐ the refusal tells the user their own change is untouched', async () => {
    // A refusal that does not say the edit survived invites them to redo it.
    const p = product({ concurrentWriteAfterRead: true });
    const r = await buildModelFromBrief(SCENARIO, BRIEF, p.d, structured);
    expect(String(r.detail)).toContain('nothing was written');
    expect(String(r.detail)).toContain('untouched');
  });

  it('⭐ POSITIVE CONTROL — an undisturbed scenario still builds and registers', async () => {
    // Without this the rule above could be satisfied by never building at all.
    const p = product();
    const r = await buildModelFromBrief(SCENARIO, BRIEF, p.d, structured);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(p.registers()).toBe(1);
  });

  it('⛔ a FAILED re-read does not refuse — it must not throw away a paid-for build', async () => {
    // Degrading to prior behaviour is right: losing the user's turn because a
    // READ failed costs them work for no protection.
    const p = product({ readFails: true });
    const r = await buildModelFromBrief(SCENARIO, BRIEF, p.d, structured);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(p.registers()).toBe(1);
  });

  it('⭐ the re-read happens AFTER the generative call, not before it', async () => {
    // Otherwise it is the same stale read the caller already took, and buys
    // nothing. Two reads before the register is the signature.
    const p = product();
    await buildModelFromBrief(SCENARIO, BRIEF, p.d, structured);
    const regAt = p.calls.indexOf('REGISTER');
    const readsBefore = p.calls.slice(0, regAt).filter((c) => c.startsWith('READ')).length;
    expect(readsBefore, 'no re-read happened before the register').toBeGreaterThanOrEqual(1);
  });
});
