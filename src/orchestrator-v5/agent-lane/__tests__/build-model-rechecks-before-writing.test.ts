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
import { buildModelFromBrief, constructionOperationId, type CallStructuredModel } from '../runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
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

/**
 * ⛔ CREATE-ONLY (ChatGPT #69 5834761926 item 1): the re-read above left the gap from that read to the route's own
 * read. The registration now sends an explicit `null` `expected_graph_identity_hash`, the route's existing absence
 * contract, which refuses 409 `GRAPH_STALE` when a graph exists at the route's read. This fake route honours the
 * assertion exactly as the real one does: with the key present and null it refuses a present graph; WITHOUT the key
 * it overwrites, which is today's defect and what makes the rows below RED at the base.
 */

function route(opts: { editLandsBeforeRegister?: boolean; ownConstructionCommitted?: boolean; foreignVersion?: boolean } = {}) {
  const writes: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const present = opts.editLandsBeforeRegister === true || opts.ownConstructionCommitted === true;
  const ours = registrationTurnId(SCENARIO, constructionOperationId(SCENARIO, BRIEF));
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      const b = (body ?? {}) as Record<string, unknown>;
      bodies.push(b);
      const assertsAbsent = Object.prototype.hasOwnProperty.call(b, 'expected_graph_identity_hash') && b.expected_graph_identity_hash === null;
      if (present && assertsAbsent) return { status: 409, json: { code: 'BAD_INPUT', details: { code: 'GRAPH_STALE', failed_expectation: 'absence' } } };
      writes.push(present ? 'OVERWRITE' : 'CREATE');
      return { status: 200, json: { model_version: { version_number: 1, version_id: 'v-new', mutation_id: 'm-new' } } };
    }
    if (path.endsWith('/versions')) {
      const versions = opts.ownConstructionCommitted === true
        ? [{ version_id: 'v-ours', sequence: 1, creation: { kind: 'initial', mutation_id: 'm-ours', source_turn_id: ours } }]
        : opts.foreignVersion === true
          ? [{ version_id: 'v-theirs', sequence: 1, creation: { kind: 'initial', mutation_id: 'm-theirs', source_turn_id: 'someone-else' } }]
          : [];
      return { status: 200, json: { versions, next_cursor: null } };
    }
    // Every READ sees the scenario empty: the edit (or our own earlier commit) lands after the re-read.
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'empty' } };
  };
  return { d, writes, bodies };
}

describe('a construction registers create-only — it asserts the model is still empty', () => {
  it('RED: the registration carries an explicit null expected_graph_identity_hash', async () => {
    const r = route();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, r.d, structured);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(r.bodies).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(r.bodies[0], 'expected_graph_identity_hash')).toBe(true);
    expect(r.bodies[0]!.expected_graph_identity_hash).toBeNull();
  });

  it('⛔⛔ RED: an edit that lands between the re-read and the register SURVIVES — refused, nothing overwritten', async () => {
    const r = route({ editLandsBeforeRegister: true });
    const out = await buildModelFromBrief(SCENARIO, BRIEF, r.d, structured);
    expect(r.writes, 'the construction overwrote a model that was no longer empty').toEqual([]);
    expect(out.ok).toBe(false);
    expect(out.mutated).toBe(false);
    expect(out.refusal).toBe('model_already_exists');
    expect(String(out.detail)).toContain('untouched');
  });

  it('RED: a retry of THIS construction, already committed, recovers its receipt and writes nothing again', async () => {
    const r = route({ ownConstructionCommitted: true });
    const out = await buildModelFromBrief(SCENARIO, BRIEF, r.d, structured) as { ok: boolean; mutated: boolean; replayed?: boolean; model_version?: { version_id: string } };
    expect(r.writes).toEqual([]);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.mutated).toBe(false);
    expect(out.replayed).toBe(true);
    expect(out.model_version?.version_id).toBe('v-ours');
  });

  it('CONTRAST: a present graph whose version is NOT this construction is refused, never claimed as ours', async () => {
    const r = route({ editLandsBeforeRegister: true, foreignVersion: true });
    const out = await buildModelFromBrief(SCENARIO, BRIEF, r.d, structured);
    expect(r.writes).toEqual([]);
    expect(out.ok).toBe(false);
    expect(out.refusal).toBe('model_already_exists');
  });

  it('POSITIVE CONTROL: an empty scenario is created exactly once', async () => {
    const r = route();
    const out = await buildModelFromBrief(SCENARIO, BRIEF, r.d, structured);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(r.writes).toEqual(['CREATE']);
  });
});
