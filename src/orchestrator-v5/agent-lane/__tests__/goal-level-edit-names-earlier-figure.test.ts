/**
 * ⛔ A CORRECTION TO TODAY'S LEVEL NAMES EVERY PART STILL HOLDING THE USER'S EARLIER FIGURE (R3 #75 5902892629 r1; AIQ
 * 5902905975: "supplied by Olumi" = false authorship, required before the share build; DL 5902916137 (2c)).
 *
 * Served cut-costs on CEE `f074916` (R3 Train 2 witness, scenario 2d85ed7f): the brief's "Monthly spend is £45k" was the
 * goal's level AND "AWS monthly cost at full workload" (`brief_extraction`), which both GCP options also set at £45k. The
 * user's "£50k, not £45k" corrected the goal alone, so the model held £50k today against £45k on that part, and the reply
 * said "20 values supplied by Olumi … including £45k/month for full AWS workload". The approval now NAMES that part and the
 * options that set it, says the £45k is the user's, and leaves it to them whether it changes too.
 *
 * FIXTURE: the served stored graph after the brief. Path: the Agent's real `dispatchTool` → `createAgentCapabilities`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';

type Json = Record<string, any>;
const F = JSON.parse(readFileSync(new URL('./fixtures/served-cut-costs-f074916-r1-components-graph.json', import.meta.url), 'utf8')) as {
  _provenance: { edit: string }; graph: Json;
};
const SCENARIO = '550e8400-e29b-41d4-a716-44665544cc51';
const ARGS = { goal_label: 'Monthly spend', value: 50000, unit: '£/month', user_stated: true };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

async function propose(graph: Json, said = F._provenance.edit) {
  const dispatch: InternalDispatch = async (path) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) return { status: 200, json: { graph: clone(graph), graph_hash: 'h0', graph_identity_hash: { value: 'id-h0' } } };
    return { status: 500, json: {} };
  };
  const caps = createAgentCapabilities(dispatch, new ProposalStore());
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-cc', user_text: said };
  return await dispatchTool('propose_goal_current_level', JSON.stringify(ARGS), ctx, caps) as ToolResult & { public_label?: string; note?: string };
}

describe('PREMISE — the served graph, read off the stored bytes', () => {
  it('the goal and "AWS monthly cost at full workload" both hold the brief\'s £45,000; both GCP options set it there', () => {
    const nodes = F.graph.nodes as Json[];
    expect(nodes.find((n) => n.kind === 'goal')).toMatchObject({ id: 'monthly_spend', observed_state: { raw_value: 45000 } });
    expect(nodes.find((n) => n.id === 'aws_monthly_cost_at_full_workload')!.observed_state).toMatchObject({ raw_value: 45000, source: 'brief_extraction', unit: '£/month' });
    const setters = nodes.filter((n) => n.kind === 'option' && n.interventions?.aws_monthly_cost_at_full_workload?.raw_value === 45000).map((n) => n.label);
    expect(setters.sort()).toEqual(['Full GCP Migration', 'Phased GCP Migration']);
  });
});

describe('the correction names the part still holding the user\'s earlier £45,000, as theirs', () => {
  it('RED (served r1): the approval says the part still holds their £45,000, which options set it, and that this does not change it', async () => {
    const r = await propose(F.graph);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.public_label).toContain('"AWS monthly cost at full workload" still holds your earlier £45,000 / month ("Full GCP Migration" and "Phased GCP Migration" set it there too); this does not change it');
  });

  it('RED: the Agent is told the £45,000 is THEIR figure, never one Olumi supplied, and to ask whether it should change', async () => {
    const r = await propose(F.graph);
    expect(r.note).toContain('that is THEIR figure from the brief, never a value Olumi supplied, and this approval does not change it; ask whether it should change too');
  });

  it('CONTROL: a part holding the same amount as OLUMI\'s estimate is not called the user\'s', async () => {
    const g = clone(F.graph);
    (g.nodes as Json[]).find((n) => n.id === 'aws_monthly_cost_at_full_workload')!.observed_state.source = 'cee_inference';
    const r = await propose(g);
    expect(r.ok).toBe(true);
    expect(r.public_label).not.toContain('still holds your earlier');
    expect(r.note).not.toContain('THEIR figure from the brief');
  });

  it('the goal unit spelled "GBP per month" still names the "£/month" part (one unit, two spellings)', async () => {
    const g = clone(F.graph);
    const goal = (g.nodes as Json[]).find((n) => n.kind === 'goal')!;
    goal.observed_state.unit = 'GBP per month';
    goal.goal_threshold_unit = 'GBP per month';
    const r = await propose(g);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.public_label).toContain('"AWS monthly cost at full workload" still holds your earlier');
  });

  it('CONTROL: a part in another unit is not the goal\'s figure', async () => {
    const g = clone(F.graph);
    (g.nodes as Json[]).find((n) => n.id === 'aws_monthly_cost_at_full_workload')!.observed_state.unit = 'subscribers';
    const r = await propose(g);
    expect(r.public_label).not.toContain('still holds your earlier');
  });
});
