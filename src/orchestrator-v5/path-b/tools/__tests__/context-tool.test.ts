/**
 * PATH-B ONE CANONICAL-CONTEXT READER: a fresh read each call, typed facts only (no ask text), every source as the ONE
 * provenance authority answers it (unknown stays unknown, adoption apart from origin), and truthful outcomes when the
 * read fails. SYNTHETIC scenario.
 */
import { describe, expect, it, vi } from 'vitest';
import { readCanonicalContext } from '../context-tool.js';
import { traceRow } from '../outcome.js';
import { provenanceOf } from '../../../../cee/provenance/provenance-of.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';

import { ADD_CELL, PRICE, QUEUE, QUOTE, STAFF, graph, read, type Rec } from './fixtures.js';

const deps = (status: number, json: Rec) => {
  const dispatch = vi.fn(async () => ({ status, json }));
  return { dispatch };
};
const ctx = { scenario_id: 'scn_1' };
const data = async (json: Rec = read()): Promise<Rec> => {
  const out = await readCanonicalContext(deps(200, json), ctx);
  if (out.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(out)}`);
  return out.data;
};
const node = (d: Rec, id: string): Rec => (d.nodes as Rec[]).find((n) => n.id === id)!;

describe('one fresh read, every call', () => {
  it('the synthetic scenario is a valid saved graph', () => {
    expect(GraphV3.safeParse(graph()).success).toBe(true);
  });

  it('reads the product\'s graph route with a FRESH read, once per call, never a cache', async () => {
    const d = deps(200, read());
    await readCanonicalContext(d, ctx);
    await readCanonicalContext(d, ctx);
    expect(d.dispatch).toHaveBeenCalledTimes(2);
    expect(d.dispatch).toHaveBeenNthCalledWith(1, '/assist/v1/scenarios/scn_1/graph', { fresh: true });
  });

  it('mutates nothing: the read is untouched and the row says no write', async () => {
    const json = read();
    const before = JSON.stringify(json);
    const out = await readCanonicalContext(deps(200, json), ctx);
    expect(JSON.stringify(json)).toBe(before);
    expect(traceRow('read_canonical_context', out)).toEqual({ name: 'read_canonical_context', ok: true, mutated: false, outcome: 'ok', refusal: null, ran: null });
  });
});

describe('typed facts', () => {
  it('revision: the analysis hash, the identity hash (unwrapped from its envelope) and the scenario revision', async () => {
    expect((await data()).revision).toEqual({ graph_hash: 'h_one', graph_identity_hash: 'id_one', scenario_revision: 7 });
  });

  it('readiness: the admission verdict and typed codes, never ask text', async () => {
    const d = await data();
    const readiness = d.readiness as { will_run: boolean; blocking: Rec[] };
    expect(readiness.will_run).toBe(false);
    expect(readiness.blocking).toContainEqual(expect.objectContaining({ code: 'MISSING_FACTOR_LEVEL', factor_id: 'visits' }));
    for (const b of readiness.blocking) expect(b).not.toHaveProperty('message');
    expect(JSON.stringify(d)).not.toMatch(/before any option changes it|What is "/);
  });

  it('the selected Run: its id, the hash it ran on, its currency and leader permission', async () => {
    expect(await data()).toMatchObject({ selected_run: { run_id: 'run_1', graph_hash_at_run: 'h_one', stale: false,
      run_state: { kind: 'complete_current' }, leader_claim_permitted: false } });
  });

  it('a scenario that never ran has no selected Run', async () => {
    const d = await data(read({ canonical_analysis_view: { staleness: { revision: 0 } }, analysis_state: { run_state: { kind: 'never_run' } } }));
    expect(d.selected_run).toBeNull();
  });
});

describe('sources, as the ONE authority answers them', () => {
  it.each([
    ['the person\'s own figure', 'staff', STAFF, 'human'],
    ['a figure whose author is not established: unknown stays unknown', 'queue', QUEUE, 'unknown'],
    ['Olumi\'s figure: Olumi\'s, not accepted', 'price', PRICE, 'ai'],
  ] as const)('%s', async (_name, id, observed, origin) => {
    const n = node(await data(), id);
    expect(n.observed_source).toEqual(provenanceOf({ value: observed }));
    expect((n.observed_source as Rec).origin).toBe(origin);
    // The figure as stored (value, raw value, unit), never converted; its source rides beside it, never inside.
    expect(n.observed).toEqual({ value: observed.value, raw_value: observed.raw_value, unit: observed.unit });
  });

  it('a person\'s figure whose role is unverified says its carrier keeps neither who said it nor their words; a verified one does not', async () => {
    const UNVERIFIED = { value: 0.2, raw_value: 20, unit: 'minutes', cap: 100, source: 'user_override', user_material_unverified: true };
    const g = graph() as { nodes: Rec[] };
    const d = await data(read({ graph: { ...g, nodes: g.nodes.map((n) => n.id === 'queue' ? { ...n, observed_state: UNVERIFIED } : n) } }));
    expect(node(d, 'queue')).toMatchObject({ observed_source: { origin: 'human', role: 'unverified' }, observed_not_recorded: ['speaker', 'words', 'stance'] });
    expect(node(d, 'staff').observed_not_recorded).toBeUndefined();
  });

  it('an option\'s setting carries the authority\'s answer for THAT cell', async () => {
    const settings = node(await data(), 'add_staff').settings as Rec[];
    expect(settings).toEqual([{ factor_id: 'staff', cell: ADD_CELL, source: provenanceOf({ setting: ADD_CELL, target: graph().nodes && (graph().nodes as Rec[]).find((n) => n.id === 'staff') }) }]);
  });

  it('a link carries the authority\'s answer, with the kind of node it leaves', async () => {
    const links = (await data()).links as Rec[];
    const staffGoal = links.find((l) => l.from === 'staff' && l.to === 'goal')!;
    const optionLink = links.find((l) => l.from === 'add_staff')!;
    expect(staffGoal.source).toEqual(provenanceOf({ link: (graph().edges as Rec[]).find((e) => e.from === 'staff' && e.to === 'goal'), context: { fromKind: 'factor' } }));
    expect((optionLink.source as Rec).structural).toBe(true);
  });

  it('kept statements keep their speaker and the verbatim words', async () => {
    expect(node(await data(), 'visits').statements).toEqual([{ subject_key: 'factor|visits|||level', field: 'level',
      statements: [{ speaker: 'unknown', quote: QUOTE, form: 'describes' }] }]);
  });
});

describe('truthful outcomes when the read fails', () => {
  it.each([
    ['not found', 404, read(), { status: 'refused', reason: 'not_found' }],
    ['a server failure', 500, {}, { status: 'unavailable', reason: 'read_failed', write: 'none', detail: 'HTTP 500' }],
    ['a read without its hash', 200, { graph: graph() }, { status: 'unavailable', reason: 'read_malformed', write: 'none' }],
    ['a read without a graph', 200, { graph_hash: 'h_one' }, { status: 'unavailable', reason: 'read_malformed', write: 'none' }],
  ] as const)('%s', async (_name, status, json, outcome) => {
    expect(await readCanonicalContext(deps(status, json as Rec), ctx)).toEqual(outcome);
  });

  it('a read that throws is unavailable, never ok', async () => {
    const out = await readCanonicalContext({ dispatch: vi.fn(async () => { throw new Error('socket'); }) }, ctx);
    expect(out).toEqual({ status: 'unavailable', reason: 'read_failed', write: 'none' });
  });
});
