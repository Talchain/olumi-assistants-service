/**
 * ⛔ THE SAME FALSE "SAVED" ON THE LEVEL PATH — `authoriseChange` → `set_option_intervention`.
 *
 * Two defects of D1's family on this sibling own-write site (8428207):
 *
 *   1. `recorded` was read back from the model alone, so a REFUSED edit counted as
 *      recorded whenever the pair already held a level (the old one, or another
 *      writer's) — `landed` then marked the proposal applied.
 *   2. After each success the CAS base was taken from a RE-READ, so another
 *      writer's edit landing just after ours became our base, and the next op
 *      passed CAS on a model the user never approved.
 *
 * The served wire (`dispatchOptionInterventionEdit` via `route-v2.ts`): committed →
 * 200 with the write's own persisted `graph_hash`; verified no-op → 200 with none;
 * stale base → 409; any other refusal → 422; unverified → 500. The fake answers
 * exactly those, and it is CAS-gated like the real event.
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { nextRequest } from './fixtures/next-request.js';

const SCENARIO = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const guest = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r-guest' };

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown>; interventions?: Record<string, unknown> };

const BASE: Node[] = [
  { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.5, raw_value: 50, cap: 100 } },
  { id: 'reach', kind: 'factor', label: 'Reach', observed_state: { value: 0.4 } },
  // Already sets Price to 0.3 — so a read-back of this pair ALWAYS finds a number.
  { id: 'raise', kind: 'option', label: 'Raise price', interventions: { price: { value: 0.3 } } },
];
const EDGES = [
  { from: 'raise', to: 'price', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
  { from: 'raise', to: 'reach', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
];

function product(opts: { foreignBeforeFirst?: boolean; foreignAfterFirst?: boolean } = {}) {
  let nodes: Node[] = BASE.map((n) => ({ ...n, ...(n.interventions ? { interventions: { ...n.interventions } } : {}) }));
  let rev = 0;
  let levelWrites = 0;
  const posted: { pair: string; base: string; status: number }[] = [];
  const foreign = () => {
    nodes = nodes.map((n) => (n.id === 'reach' ? { ...n, observed_state: { value: 0.45 } } : n));
    rev += 1;
  };
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      nodes = (b as { graph: { nodes: Node[] } }).graph.nodes;
      rev += 1;
      return { status: 200, json: { registered: true, graph_hash: `h${rev}` } };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as { option_id: string; factor_id: string; value: number; base_graph_hash: string };
      levelWrites += 1;
      if (levelWrites === 1 && opts.foreignBeforeFirst === true) foreign();
      const pair = `${ev.option_id}::${ev.factor_id}`;
      if (ev.base_graph_hash !== `h${rev}`) {
        posted.push({ pair, base: ev.base_graph_hash, status: 409 });
        return { status: 409, json: { code: 'GRAPH_DIVERGED' } };
      }
      nodes = nodes.map((n) => (n.id === ev.option_id ? { ...n, interventions: { ...(n.interventions ?? {}), [ev.factor_id]: { value: ev.value } } } : n));
      rev += 1;
      const own = `h${rev}`;
      posted.push({ pair, base: ev.base_graph_hash, status: 200 });
      // Another writer lands in the milliseconds after our commit.
      if (levelWrites === 1 && opts.foreignAfterFirst === true) foreign();
      return { status: 200, json: { graph_hash: own } };
    }
    return { status: 200, json: { graph: { nodes, edges: EDGES }, graph_hash: `h${rev}` } };
  };
  return { d, posted };
}

async function approveLevels(p: ReturnType<typeof product>, levels: Record<string, unknown>[]) {
  const caps = createAgentCapabilities(p.d, new ProposalStore());
  const prop = await caps.proposeOptionInterventions(guest, { interventions: levels } as never);
  expect(prop.ok, JSON.stringify(prop)).toBe(true);
  return (await caps.authoriseChange(nextRequest(guest), { proposal_id: String(prop.proposal_id) })) as Record<string, unknown>;
}

const PRICE_TO_60 = { option_label: 'Raise price', factor_label: 'Price', value: 60, basis: 'the user said 60' };
const REACH_TO_07 = { option_label: 'Raise price', factor_label: 'Reach', value: 0.7, basis: 'the user said 0.7' };

describe('a level is "recorded" only when THIS approval\'s own write committed it', () => {
  it('⛔ a REFUSED edit on a pair that already holds a level is NOT reported recorded', async () => {
    const p = product({ foreignBeforeFirst: true });
    const r = await approveLevels(p, [PRICE_TO_60]);
    expect(p.posted.map((x) => x.status), 'our write must really have been refused').toEqual([409]);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.applied).toBe(false);
    expect(r.interventions).toEqual([{ option: 'Raise price', factor: 'Price', requested: 60, recorded: null }]);
  });

  it('⛔ the next op is CAS-gated on OUR write\'s revision, never on a foreign edit read back after it', async () => {
    const p = product({ foreignAfterFirst: true });
    const r = await approveLevels(p, [PRICE_TO_60, REACH_TO_07]);
    // Bound by identity: the second op carries the hash OUR first write reported (h1),
    // so the foreign edit (h2) refuses it instead of being absorbed.
    expect(p.posted).toEqual([
      { pair: 'raise::price', base: 'h0', status: 200 },
      { pair: 'raise::reach', base: 'h1', status: 409 },
    ]);
    expect(r.interventions).toEqual([
      { option: 'Raise price', factor: 'Price', requested: 60, recorded: 0.6 },
      { option: 'Raise price', factor: 'Reach', requested: 0.7, recorded: null },
    ]);
    expect(JSON.stringify(r.failures)).toContain('raise::reach');
  });

  it('⭐ POSITIVE CONTROL: with no other writer, every level lands and the chain follows our own revisions', async () => {
    const p = product();
    const r = await approveLevels(p, [PRICE_TO_60, REACH_TO_07]);
    expect(p.posted).toEqual([
      { pair: 'raise::price', base: 'h0', status: 200 },
      { pair: 'raise::reach', base: 'h1', status: 200 },
    ]);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.recorded_count).toBe(2);
    expect(r.interventions).toEqual([
      { option: 'Raise price', factor: 'Price', requested: 60, recorded: 0.6 },
      { option: 'Raise price', factor: 'Reach', requested: 0.7, recorded: 0.7 },
    ]);
  });
});
