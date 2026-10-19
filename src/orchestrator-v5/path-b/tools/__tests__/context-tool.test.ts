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

type Rec = Record<string, unknown>;
const STAFF = { value: 1 / 10, raw_value: 1, unit: 'people', source: 'brief_extraction', extractionType: 'explicit' };
const QUEUE = { value: 0.3, raw_value: 30, unit: 'minutes' };
const PRICE = { value: 0.5, raw_value: 5, unit: 'GBP', source: 'cee_inference' };
const ADD_CELL = { value: 2 / 10, source: 'brief_extraction', extractionType: 'explicit' };
const QUOTE = 'Walk-ins swing a lot from week to week.';

function graph(): Rec {
  const options = [
    { id: 'add_staff', option_id: 'add_staff', kind: 'option', label: 'Add a second assistant', interventions: { staff: ADD_CELL } },
    { id: 'carry_on', option_id: 'carry_on', kind: 'option', label: 'Carry on as now', interventions: { staff: { value: 1 / 10, source: 'cee_inference' } }, is_baseline: true },
  ];
  return {
    nodes: [
      { id: 'decision', kind: 'decision', label: 'Staffing' },
      { id: 'goal', kind: 'goal', label: 'Serve every visitor on the day' },
      { id: 'staff', kind: 'factor', label: 'Assistants on shift', category: 'controllable', observed_state: STAFF },
      { id: 'queue', kind: 'factor', label: 'Queue time', category: 'observable', observed_state: QUEUE },
      { id: 'price', kind: 'factor', label: 'Ticket price', category: 'observable', observed_state: PRICE, proposed_by: 'olumi' },
      { id: 'visits', kind: 'factor', label: 'Walk-in visits next week', category: 'observable', user_statements: [{
        subject_key: 'factor|visits|||level', field: 'level', recorded_at: '2026-10-19T09:00:00.000Z', attest: { recorded_by: 'construction' },
        statements: [{ speaker: 'unknown', quote: QUOTE, source: QUOTE, subject: { quantity: 'factor|visits|||level', node_id: 'visits' },
          form: 'describes', reading: 'olumi' }] }] },
      ...options,
    ],
    edges: [
      ...options.map((o) => ({ from: 'decision', to: o.id, strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
      ...options.map((o) => ({ from: o.id, to: 'staff', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
      { from: 'staff', to: 'goal', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'queue', to: 'goal', strength: { mean: -0.2, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
      { from: 'price', to: 'goal', strength: { mean: 0.1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'visits', to: 'goal', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
    goal_node_id: 'goal',
  };
}

function read(extra: Rec = {}): Rec {
  return {
    graph: graph(), graph_hash: 'h_one', graph_identity_hash: { kind: 'graph_identity', value: 'id_one', algorithm: 'sha256' },
    canonical_analysis_view: { staleness: { revision: 7, stale: false }, run: { run_id: 'run_1', graph_hash_at_run: 'h_one' } },
    analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-19T10:00:00.000Z' }, leader_claim: { permitted: false } },
    ...extra,
  };
}

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
