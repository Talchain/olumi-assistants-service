/**
 * ⛔ A LIMIT THE USER STATED WAS DRAFTED, THEN WITHHELD, BECAUSE ITS METRIC NAMED NO NODE.
 *
 * Admission attaches a limit to the node whose label equals `constraints[].metric` (exact or case-insensitive,
 * `admit-model.ts`), and withholds it otherwise (`admit-constraint.ts`). BUILD_INSTRUCTIONS already told the
 * drafter to use the goal metric's EXACT label; nothing told it the same about a limit's metric. So "keep total
 * first-year cost under £250k" became a limit on "Total first-year cost" in a model with no such node, and "Budget
 * is £900k" became "GTM budget" beside factors called "Outbound sales team size" and "Self-serve motion investment".
 *
 * MEASURED offline on staging 8c799d68's build-model with gpt-5.6-terra (6 estate briefs × 5 draws per arm; evidence
 * on programme-docs `evidence/ai-quality-20260925`, cap-attach/): see the PR body for the table.
 *
 * So the drafter is now told that every limit names a node it keeps, by its exact label, and that a limited total
 * (cost, budget, spend) is kept as a node for the purpose. The rule must travel on every call, including a retry.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const SCENARIO = '66666666-6666-4666-8666-666666666666';
const BRIEF = 'We need to decide whether to build our own billing system or buy one. We must keep total first-year cost under £250k.';
const RULE = /EVERY LIMIT MUST NAME A NODE THE ANALYSIS CAN CHECK/;
const EXACT = /`constraints\[\]\.metric` must be the EXACT label of a factor or outcome you keep/;
const TOTAL = /If the user limits a total such as cost, budget or spend, keep that total in the model/;

const factor = (label: string, provenance = 'inferred') => ({
  label, role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance, plausible_max: 100,
});
const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'inferred' });
function candidate(limitMetric: string, extra = 0) {
  const names = Array.from({ length: extra }, (_, i) => `Speculative factor ${i}`);
  return {
    goal: { metric: 'Billing capability', operator: '>', target_stated: false, value: null, unit: null, horizon_months: 12, provenance: 'inferred' },
    constraints: [{ metric: limitMetric, operator: '<', value: 250000, unit: 'GBP', provenance: 'explicit' }],
    options: [
      { label: 'Build in-house', provenance: 'explicit', changes: ['Engineering spend'], interventions: [], is_status_quo: false },
      { label: 'Buy a platform', provenance: 'explicit', changes: ['Platform fees'], interventions: [], is_status_quo: false },
    ],
    factors: [factor('Engineering spend'), factor('Platform fees'), ...names.map((n) => factor(n, 'ai_proposed'))],
    risks: [],
    outcomes: [{ label: 'Total first-year cost', provenance: 'inferred' }],
    links: [
      link('Engineering spend', 'Total first-year cost'), link('Platform fees', 'Total first-year cost'),
      link('Engineering spend', 'Billing capability'), link('Platform fees', 'Billing capability'),
      ...names.map((n) => link(n, 'Billing capability')),
    ],
    unknowns: [],
  };
}
function sequence(...payloads: unknown[]) {
  const reqs: { instructions: string; input: string }[] = [];
  const fn = vi.fn(async (req: { instructions: string; input: string }) => {
    reqs.push(req); return { text: JSON.stringify(payloads[Math.min(reqs.length - 1, payloads.length - 1)]) };
  }) as unknown as CallStructuredModel;
  return { fn, reqs };
}
function run(...payloads: unknown[]) {
  let registered: { goal_constraints?: { node_id?: string }[]; nodes?: { id: string; label?: string }[] } | null = null;
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { registered = (body as { graph: typeof registered }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  const s = sequence(...payloads);
  return buildModelFromBrief(SCENARIO, BRIEF, dispatch, s.fn).then((r) => ({ r: r as Record<string, unknown>, reqs: s.reqs, registered: registered as typeof registered }));
}

describe('every limit the drafter writes names a node it keeps', () => {
  it('the first call tells the drafter to name a kept node by its EXACT label, and to keep a limited total as a node', async () => {
    const { reqs } = await run(candidate('Total first-year cost'));
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.instructions).toMatch(RULE);
    expect(reqs[0]!.instructions).toMatch(EXACT);
    expect(reqs[0]!.instructions).toMatch(TOTAL);
  });

  it('the rule travels on a size retry too (the retry rebuilds the limits)', async () => {
    const { r, reqs } = await run(candidate('Total first-year cost', 20), candidate('Total first-year cost'));
    expect(r['size_retried'], 'PRECONDITION: the first draft was oversized').toBe(true);
    expect(reqs).toHaveLength(2);
    expect(reqs[1]!.instructions).toMatch(RULE);
    expect(reqs[1]!.instructions).toMatch(EXACT);
  });

  // The admission contract the rule relies on, pinned so a change to label matching is seen here as well.
  it('CONTRACT: a limit whose metric is a kept node\'s exact label attaches to THAT node', async () => {
    const { r, registered } = await run(candidate('Total first-year cost'));
    expect(r.ok).toBe(true);
    expect(r.goal_constraints_carried).toBe(1);
    const node = registered?.nodes?.find((n) => n.label === 'Total first-year cost');
    expect(node, 'PRECONDITION: the cost node was kept').toBeDefined();
    expect(registered?.goal_constraints?.map((g) => g.node_id)).toEqual([node!.id]);
  });

  it('CONTRACT CONTROL: a near-synonym ("First-year cost total") attaches to nothing', async () => {
    const { r, registered } = await run(candidate('First-year cost total'));
    expect(r.ok, 'a withheld limit is not a failed build').toBe(true);
    expect(r.goal_constraints_carried).toBe(0);
    expect(registered?.goal_constraints ?? []).toEqual([]);
  });
});
