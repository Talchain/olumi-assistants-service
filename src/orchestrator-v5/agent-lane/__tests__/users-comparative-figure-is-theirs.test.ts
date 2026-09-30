/**
 * ⛔ THE USER'S OWN "25% CHEAPER" WAS STORED AS OLUMI'S ASSUMPTION (AIQ #75 5902528686: FALSE AUTHORSHIP; DL routes the
 * writer to MG, 5902536669).
 *
 * Served cut-costs on CEE `1f9d769` (DL alt-B r0 `714abc5c`, r1 `572bbddb`): the user wrote "Our team's quote shows GCP
 * would be about 25% cheaper than AWS for our workload." The Agent revised the discount factor to 0.25, the user's exact
 * figure, and it was stored as `user_assumption` ("Olumi's suggestion the user accepted", `derived-split.ts`), with the reply
 * "recorded as Olumi's assumption based on your team's quote". The door's word-proximity matcher read "AWS … workload"
 * after the comparative as another quantity's ("Current AWS-equivalent workload cost"), so the figure was nobody's.
 *
 * The rule (the DL's #2235 ruling for the add-factor door, "human control is the provenance gate"): a revision the user
 * asked for, whose figure IS written in this message, is theirs when the approval shows the pairing with their own
 * sentence, verbatim. A figure Olumi worked out from theirs is not written, so it stays Olumi's.
 *
 * FIXTURE: the served stored graphs before the edit, and what the served approval stored (`_provenance`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';

type Json = Record<string, any>;
const F = JSON.parse(readFileSync(new URL('./fixtures/served-cut-costs-altB-before-edit-1f9d769.json', import.meta.url), 'utf8')) as {
  _provenance: { edit: string; served_after_edit: Record<string, { id: string; observed_state: Json }[]> }; r0: Json; r1: Json;
};
const EDIT = F._provenance.edit;
const ctxSaying = (user_text: string) => ({ scenario_id: '550e8400-e29b-41d4-a716-44665544ab00', authenticated_user_id: null, request_id: 'r', user_text });
const setup = (graph: Json) => {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  const store = new ProposalStore();
  return { caps: createAgentCapabilities(d, store), store };
};
type R = ToolResult & { proposal_id: string; note: string; public_label: string; assumptions: { factor: string; your_figure?: boolean }[] };
const ASSUMPTION_WORDS = /assumptions? to adopt or correct|NOT measurements?/i;
const authorOf = (store: ProposalStore, id: string, path: string) =>
  (store.get(id)?.operations.find((o) => (o as { path?: string }).path === path) as { value?: { authored_by?: string } } | undefined)?.value?.authored_by;

describe('PREMISE — what the served approval stored', () => {
  it('both reps stored the user\'s 25% as user_assumption', () => {
    expect(F._provenance.served_after_edit.r0).toEqual([{ id: 'gcp_unit_cost_discount', observed_state: expect.objectContaining({ raw_value: 0.25, source: 'user_assumption' }) }]);
    expect(F._provenance.served_after_edit.r1).toEqual([{ id: 'gcp_unit_cost_advantage', observed_state: expect.objectContaining({ raw_value: 0.25, source: 'user_assumption' }) }]);
  });
});

describe('the user\'s own comparative figure is theirs, on an approval that shows their sentence', () => {
  for (const [rep, label, id, unit] of [['r0', 'GCP unit-cost discount', 'gcp_unit_cost_discount', 'share'], ['r1', 'GCP unit-cost advantage', 'gcp_unit_cost_advantage', 'proportion']] as const) {
    it(`RED (served ${rep}): ${label} 0.25 → stored as the user's, marked your_figure, never called an assumption`, async () => {
      const { caps, store } = setup(F[rep]);
      const r = await caps.proposeAssumptions(ctxSaying(EDIT), { assumptions: [{ factor_label: label, value: 0.25, unit, basis: 'the team\'s quote', revise: true }] }) as R;
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(authorOf(store, r.proposal_id, id)).toBe('user_stated');
      expect(r.assumptions).toEqual([expect.objectContaining({ factor: label, your_figure: true })]);
      expect(r.note).not.toMatch(ASSUMPTION_WORDS);
      // The approval shows the factor, before → after in the user's units, and their own sentence, verbatim (AIQ 5902884139).
      expect(r.public_label).toContain(`${label}: ${rep === 'r0' ? '15%' : '20%'} \u2192 25% (your figure, in your words: "${EDIT}")`);
    });
  }

  it('CONTROL (AIQ): a figure Olumi worked out from theirs (not written) stays Olumi\'s, and is said as an assumption', async () => {
    const { caps, store } = setup(F.r0);
    const r = await caps.proposeAssumptions(ctxSaying(EDIT), { assumptions: [{ factor_label: 'GCP unit-cost discount', value: 0.3, unit: 'share', basis: 'derived', revise: true }] }) as R;
    expect(authorOf(store, r.proposal_id, 'gcp_unit_cost_discount')).toBe('model_proposed');
    expect(r.assumptions[0]).not.toHaveProperty('your_figure');
    expect(r.note).toMatch(ASSUMPTION_WORDS);
    expect(r.public_label).not.toContain('in your words');
  });

  it('CONTROL: a figure the matcher already binds keeps today\'s approval words (no sentence added)', async () => {
    const { caps, store } = setup(F.r0);
    const r = await caps.proposeAssumptions(ctxSaying('Set the GCP unit-cost discount to 25%.'), { assumptions: [{ factor_label: 'GCP unit-cost discount', value: 0.25, unit: 'share', basis: 'the user', revise: true }] }) as R;
    expect(authorOf(store, r.proposal_id, 'gcp_unit_cost_discount')).toBe('user_stated');
    expect(r.public_label).not.toContain('in your words');
  });

  it('CONTROL: two figures written → the strict matcher decides, as before (no pairing credited by the card)', async () => {
    const { caps, store } = setup(F.r0);
    const r = await caps.proposeAssumptions(ctxSaying("Our team's quote shows GCP would be about 25% cheaper than AWS, and we'd move 60% of workloads."),
      { assumptions: [{ factor_label: 'GCP unit-cost discount', value: 0.25, unit: 'share', basis: 'the quote', revise: true }] }) as R;
    expect(authorOf(store, r.proposal_id, 'gcp_unit_cost_discount')).toBe('model_proposed');
    expect(r.public_label).not.toContain('in your words');
  });

  it('CONTROL: a new value Olumi offers (no revision) is Olumi\'s even when the figure is written', async () => {
    const g = JSON.parse(JSON.stringify(F.r0)) as Json;
    delete (g.nodes as Json[]).find((n) => n.id === 'gcp_unit_cost_discount')!.observed_state;
    const { caps, store } = setup(g);
    const r = await caps.proposeAssumptions(ctxSaying(EDIT), { assumptions: [{ factor_label: 'GCP unit-cost discount', value: 0.25, unit: 'share', basis: 'the quote' }] }) as R;
    expect(authorOf(store, r.proposal_id, 'gcp_unit_cost_discount')).toBe('model_proposed');
  });
});
