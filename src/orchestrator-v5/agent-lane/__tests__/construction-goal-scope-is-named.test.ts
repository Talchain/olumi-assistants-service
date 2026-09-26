/**
 * ⛔ C46 — "£20k MRR" MUST NOT SILENTLY BECOME PRO MRR (OR TOTAL MRR).
 *
 * Ruling (ChatGPT #70 5841314428, binding): "£20k MRR scope (Pro MRR vs total MRR) must be
 * clarified or explicitly named before analysis; never silently pick one." MEASURED on Paul's
 * captured brief (runs f-20260925T230446Z, f-20260925T230854Z, f-20260925T231324Z): the goal
 * came back as bare "MRR" while every path into it was Pro price and Pro subscribers — the
 * model measured Pro MRR and called it MRR. The scope question existed only as prose in
 * `open_questions`, and the first pass still ran on "MRR".
 *
 * The drafter DECLARES the scope (`goal.scope`); admission names the modelled scope in the
 * goal itself (the node's id is unchanged, so every link still resolves) and the build asks
 * the question once, in the existing `open_questions` channel. A brief that states its scope
 * ("total MRR") is not asked. Every candidate passes the REAL strict schema and is served
 * through `buildModelFromBrief` -> `/graph/register` -> `GraphV3.parse`. Bound by node id.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, retrySchemaPinningGoal, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const BRIEF =
  'Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 10%, should we increase ' +
  'the Pro plan price from £49 to £59 per month with the next AI feature release?';

type Scope = { modelled: string; alternative: string; stated_in_brief: boolean } | null;

const AMBIGUOUS: Scope = { modelled: 'the Pro plan only', alternative: 'all plans together', stated_in_brief: false };
const STATED_TOTAL: Scope = { modelled: 'all plans together', alternative: 'the Pro plan only', stated_in_brief: true };

function pricing(metric: string, scope: Scope, unknowns: string[] = []): Record<string, unknown> {
  return {
    goal: {
      metric, operator: '>=', target_stated: true, value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope,
    },
    constraints: [],
    options: [
      { label: 'Keep Pro at £49', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Raise Pro to £59', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
      { label: 'Pro subscribers', role: 'observable', baseline_known: false, baseline_value: 300, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
    ],
    risks: [], outcomes: [],
    links: [
      { from: 'Pro plan price', to: 'Pro subscribers', direction: 'negative', provenance: 'inferred' },
      { from: 'Pro plan price', to: metric, direction: 'positive', provenance: 'inferred' },
      { from: 'Pro subscribers', to: metric, direction: 'positive', provenance: 'inferred' },
    ],
    identities: [],
    unknowns,
  };
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Graph = { nodes: { id: string; kind: string; label: string; description?: string }[]; edges: { from: string; to: string }[] };

async function build(wire: Record<string, unknown>) {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let registered: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('20202020-2020-4020-8020-202020202020', BRIEF, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(registered) as unknown as Graph, out };
}

const goalOf = (g: Graph) => g.nodes.find((n) => n.kind === 'goal')!;
const questions = (out: Record<string, unknown>) => (out.open_questions as string[] | undefined) ?? [];
const scopeLoss = (m: ReturnType<typeof admitCandidateModel>) => m.loss.filter((l) => /\.goal_scope$/.test(l.field_path));
const SCOPE_QUESTION =
  'The brief does not say whether your "MRR" goal covers the Pro plan only or all plans together, so the model ' +
  'measures it for the Pro plan only. Which did you mean?';

describe('an unstated scope is named in the goal and asked, never silently picked', () => {
  it('RED: bare "MRR" measured on the Pro plan: the goal NAMES the scope, and its id is unchanged', async () => {
    const { graph } = await build(pricing('MRR', AMBIGUOUS));
    const goal = goalOf(graph);
    expect(goal.id).toBe('mrr');
    expect(goal.label).toBe('MRR (the Pro plan only)');
    // Every link still lands on the goal by id.
    expect(graph.edges.filter((e) => e.to === 'mrr').map((e) => e.from).sort()).toEqual(['pro_plan_price', 'pro_subscribers']);
  });

  it('RED: the question is asked ONCE, first, in the existing open_questions channel, beside the drafter’s own', async () => {
    const { out } = await build(pricing('MRR', AMBIGUOUS, ['How price-sensitive are current Pro subscribers?']));
    expect(questions(out)).toEqual([SCOPE_QUESTION, 'How price-sensitive are current Pro subscribers?']);
  });

  it('RED: admission records the choice as a warning on the goal, with both readings', () => {
    const [entry, ...more] = scopeLoss(admitCandidateModel(pricing('MRR', AMBIGUOUS) as unknown as CandidateModel));
    expect(more).toEqual([]);
    expect(entry?.field_path).toBe('nodes[mrr].goal_scope');
    expect(entry?.severity).toBe('warn');
    expect(entry?.before).toEqual({ metric: 'MRR', modelled: 'the Pro plan only', alternative: 'all plans together' });
    expect(entry?.after).toBe('MRR (the Pro plan only)');
    expect(entry?.reason).toBe(SCOPE_QUESTION);
  });

  it('a goal whose name already carries the modelled scope is not renamed, but is still asked', async () => {
    const { graph, out } = await build(pricing('MRR for the Pro plan only', AMBIGUOUS));
    expect(goalOf(graph).label).toBe('MRR for the Pro plan only');
    expect(questions(out)).toHaveLength(1);
    expect(questions(out)[0]).toContain('covers the Pro plan only or all plans together');
  });

  it('naming the scope adds no readiness blocker', async () => {
    const named = await build(pricing('MRR', AMBIGUOUS));
    const plain = await build(pricing('MRR', null));
    const codes = (g: unknown) => assessCanonicalAnalysisReadiness(g).blockingIssues.map((i) => i.code).sort();
    expect(codes(named.graph)).toEqual(codes(plain.graph));
  });
});

describe('controls: a stated scope, or no scope question at all, changes nothing', () => {
  it('CONTROL: "total MRR" stated in the brief: no question, no rename, no ledger entry', async () => {
    const { graph, out } = await build(pricing('Total MRR', STATED_TOTAL));
    expect(goalOf(graph).label).toBe('Total MRR');
    expect(out).not.toHaveProperty('open_questions');
    expect(scopeLoss(admitCandidateModel(pricing('Total MRR', STATED_TOTAL) as unknown as CandidateModel))).toEqual([]);
  });

  it('CONTROL: scope null (a metric with no part-or-whole reading): no question, no rename', async () => {
    const { graph, out } = await build(pricing('MRR', null));
    expect(goalOf(graph).label).toBe('MRR');
    expect(out).not.toHaveProperty('open_questions');
  });
});

describe('the contract: the scope is required, and a compaction retry cannot change it', () => {
  it('RED: strict output must say "no scope question" (null) rather than omit the key', () => {
    const wire = pricing('MRR', null);
    const { scope: _dropped, ...goalWithout } = wire.goal as Record<string, unknown>;
    expect(strict({ ...wire, goal: goalWithout })).toBe(false);
  });

  it('RED: the retry pins the declared scope, and still accepts a null one', () => {
    const goal = pricing('MRR', AMBIGUOUS).goal as unknown as CandidateModel['goal'];
    const pinned = new Ajv({ strict: false }).compile(retrySchemaPinningGoal(goal));
    expect(pinned(pricing('MRR', AMBIGUOUS)), JSON.stringify(pinned.errors)).toBe(true);
    expect(pinned(pricing('MRR', STATED_TOTAL)), 'the retry cannot switch to the other reading').toBe(false);
    expect(pinned(pricing('MRR', null)), 'nor drop the question').toBe(false);
    const pinnedNull = new Ajv({ strict: false }).compile(retrySchemaPinningGoal(pricing('MRR', null).goal as unknown as CandidateModel['goal']));
    expect(pinnedNull(pricing('MRR', null)), JSON.stringify(pinnedNull.errors)).toBe(true);
  });
});
