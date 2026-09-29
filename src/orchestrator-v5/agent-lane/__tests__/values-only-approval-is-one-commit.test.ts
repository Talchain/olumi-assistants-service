/**
 * ⛔ OLUMI'S STARTING POINT, APPROVED, IS ONE COMMIT (Canonical #70 5850018984; DL GO 5850026671; ChatGPT 5850029446:
 * "Runtime switches the values-only starting-point branch from N `factor_value_edit` calls to ONE door call").
 *
 * Measured on the wire: DL's joined run `f-20260926T201724Z` F1s approved "Use these 3 starting figures" (AI feature
 * availability 0, Pro paying subscribers 300, Monthly churn 7%) and the model gained THREE versions — one
 * `factor_value_edit` commit per value — so a refusal part-way could leave some values written. A values-only approval
 * never reached the compound path (#2035), which already sends values and their ranges as ONE port call.
 *
 * FIXTURE: that run's model at approval time (`01-F1-brief.json` `draft_graph`, scenario 38b6c2a6, CEE d6b09c0).
 * Bound here to the PORT (one call, all values, nothing else written); the real door's one commit is pinned in
 * `tests/integration/orchestrator/agent-compound-is-one-commit.test.ts` once Canonical's values-only door lands.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { ProposalStore } from '../proposal.js';
import { levelsPortOver } from './fixtures/levels-port.js';

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> | null; scale_frame?: number };
const served = JSON.parse(readFileSync(new URL('./fixtures/served-f1s-before-approval-d6b09c0.json', import.meta.url), 'utf8')) as { nodes: Node[]; edges: unknown[] };
const ctx = { scenario_id: '38b6c2a6-0000-4000-8000-000000000001', authenticated_user_id: null, request_id: 'r', user_text: 'Work out whether £59 improves MRR.' };
/** The three figures F1s approved, as Olumi's assumptions (served reply: "Olumi assumptions, not measurements"). */
const F1S = { assumptions: [
  { factor_label: 'AI feature availability', value: 0, basis: 'not available today; the release options set it' },
  { factor_label: 'Pro paying subscribers', value: 300, basis: 'a working baseline' },
  { factor_label: 'Monthly churn', value: 7, unit: '%', basis: 'below the 10% limit, to test price sensitivity' },
], option_levels: [] };

function product() {
  let nodes: Node[] = structuredClone(served.nodes);
  let rev = 0;
  const writes: string[] = [];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      writes.push('register');
      if (typeof b.expected_graph_hash === 'string' && b.expected_graph_hash !== `h${rev}`) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      nodes = (b as { graph: { nodes: Node[] } }).graph.nodes;
      rev += 1;
      return { status: 200, json: { registered: true, graph_hash: `h${rev}` } };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      // A per-value write the capability sends itself: the N-commit path this test forbids.
      writes.push(String((b.event as { kind?: unknown }).kind));
      const ev = b.event as { target_id?: string; value?: number };
      nodes = nodes.map((n) => (n.id === ev.target_id ? { ...n, observed_state: { ...(n.observed_state ?? {}), value: ev.value } } : n));
      rev += 1;
      return { status: 200, json: { graph_hash: `h${rev}` } };
    }
    return { status: 200, json: { graph: { nodes, edges: served.edges }, graph_hash: `h${rev}` } };
  };
  return { d, writes, nodes: () => nodes };
}

async function approve(port: (p: ReturnType<typeof product>) => (input: CommitOptionLevelsInput) => Promise<CommitOptionLevelsResult>) {
  const p = product();
  const calls: CommitOptionLevelsInput[] = [];
  const inner = port(p);
  const store = new ProposalStore();
  const caps = createAgentCapabilities(p.d, store, undefined, 'full', undefined, {
    commitOptionLevels: async (input) => { calls.push(structuredClone(input)); return inner(input); },
  });
  const r = await caps.proposeStartingPoint(ctx, F1S as never);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const before = structuredClone(p.nodes());
  const writesBefore = p.writes.length;
  const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
  return { p, calls, out, before, writesBefore, again: () => caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) }) };
}

describe('a values-only approval (Olumi\'s starting point) is ONE door call, all values or none', () => {
  it('RED (served F1s): the three figures go to the writer as ONE port call — values only — and the capability writes nothing itself', async () => {
    const { calls, out, p, writesBefore } = await approve((pr) => levelsPortOver(pr.d));
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(calls, 'one approval, one call').toHaveLength(1);
    expect(calls[0]!.levels).toEqual([]);
    expect(calls[0]!.links).toEqual([]);
    // All three, in the user's units, as Olumi's (order is the proposal's own).
    expect(calls[0]!.values?.map((v) => [v.factor_id, v.value, v.author]).sort()).toEqual([
      ['ai_feature_availability', 0, 'model_proposed'],
      ['monthly_churn', 7, 'model_proposed'],
      ['pro_paying_subscribers', 300, 'model_proposed'],
    ]);
    // Not one `factor_value_edit` from the capability: the N-commit path is gone.
    expect(p.writes.slice(writesBefore).filter((w) => w === 'factor_value_edit')).toEqual([]);
  });

  it('RED (all or nothing): a refused value leaves the persisted model byte-identical, and the reply says nothing was written', async () => {
    const { out, p, before, calls } = await approve(() => async () => ({ status: 'refused', reason: 'value_out_of_domain', value: { factor_id: 'monthly_churn' } }));
    expect(calls).toHaveLength(1);
    expect(out.ok).toBe(false);
    expect(out.mutated).toBe(false);
    expect(JSON.stringify(out)).toMatch(/nothing in this change was written/);
    expect(p.nodes()).toEqual(before);
  });

  it('RED (retry): approving the same starting point again writes nothing more', async () => {
    const { calls, again, p } = await approve((pr) => levelsPortOver(pr.d));
    const writesAfterFirst = p.writes.length;
    await again();
    expect(calls, 'no second port call').toHaveLength(1);
    expect(p.writes.length).toBe(writesAfterFirst);
  });
});
