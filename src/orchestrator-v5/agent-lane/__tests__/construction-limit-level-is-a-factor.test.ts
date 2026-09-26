/**
 * ⛔ A LIMIT THE USER STATED ON A LEVEL NAMES A QUANTITY THAT CAN HOLD ONE (R&C 5842795947, DL 5842800634).
 *
 * SERVED (CEE 08f6f90, OpenAI-only, Paul's pricing brief "…while keeping monthly churn under 10%…"): in about 2 of 7
 * first passes the drafter made "Monthly churn" an OUTCOME. The limit attached to it, but when Paul then said "Our
 * monthly churn today is about 4%, from our billing data", the revision had nowhere to land: "Monthly churn is
 * currently an outcome, not a factor that can hold a starting value". As a FACTOR the same journey reached a proposal
 * 5/5. The value writer's rule is `SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS` (`tools/handlers/set-factor-value.ts`), the
 * one `propose_assumptions` imports to refuse a non-factor (`not_a_factor`).
 *
 * The drafts below are the two SERVED first passes, rebuilt by node id from their own `draft_graph`
 * (`fixtures/served-paul-churn-*.json`), and pushed through the real path: strict candidate schema →
 * `buildModelFromBrief` with a faked drafter → the `/graph/register` body → `GraphV3.parse` → readiness.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS } from '../../tools/handlers/set-factor-value.js';

type Node = Record<string, unknown> & { id: string; kind: string };
type Edge = Record<string, unknown> & { from: string; to: string };
type Graph = { nodes: Node[]; edges: Edge[]; goal_constraints?: Record<string, unknown>[] };
const served = (name: string): Graph =>
  (JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as { draft_graph: Graph }).draft_graph;
const SERVED_OUTCOME = served('served-paul-churn-outcome-20260926T032916Z.json');
const SERVED_FACTOR = served('served-paul-churn-factor-20260926T032913Z.json');

const BRIEF =
  'Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 10%, should we increase the '
  + 'Pro plan price from £49 to £59 per month with the next AI feature release?';
const CHURN_LIMIT = { metric: 'Monthly churn', operator: '<', value: 10, unit: 'percent per month', provenance: 'explicit' };
const link = (from: string, to: string, direction: 'positive' | 'negative') => ({ from, to, direction, provenance: 'inferred' });

/** Served 20260926T032916Z-48389, by node id: `monthly_churn` is an OUTCOME the user's limit names. */
function outcomeDraft(over: Record<string, unknown> = {}) {
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP per month', horizon_months: 12, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit',
    },
    constraints: [CHURN_LIMIT],
    options: [
      { label: 'Keep Pro at £49', provenance: 'explicit', changes: [], interventions: [], is_status_quo: true },
      { label: 'Raise Pro to £59', provenance: 'explicit', changes: [], is_status_quo: null,
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP per month', provenance: 'explicit' }] },
      { label: 'Raise Pro to £54', provenance: 'inferred', changes: [], is_status_quo: null,
        interventions: [{ factor_label: 'Pro plan price', value: 54, value_kind: 'absolute', unit: 'GBP per month', provenance: 'ai_proposed' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP per month', provenance: 'explicit', plausible_max: 200 },
      { label: 'Pro plan subscribers', role: 'observable', baseline_known: false, baseline_value: 250, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
      { label: 'AI feature value', role: 'observable', baseline_known: false, baseline_value: 50, unit: 'score out of 100', provenance: 'ai_proposed', plausible_max: 100 },
    ],
    risks: [{ label: 'Price sensitivity', provenance: 'inferred' }],
    outcomes: [{ label: 'Monthly churn', provenance: 'explicit' }],
    links: [
      link('Pro plan price', 'Pro plan subscribers', 'negative'),
      link('Pro plan price', 'MRR', 'positive'),
      link('Pro plan price', 'Price sensitivity', 'positive'),
      link('AI feature value', 'Pro plan subscribers', 'positive'),
      link('AI feature value', 'Monthly churn', 'negative'),
      link('Price sensitivity', 'Monthly churn', 'positive'),
      link('Monthly churn', 'Pro plan subscribers', 'negative'),
      link('Pro plan subscribers', 'MRR', 'positive'),
    ],
    unknowns: [],
    ...over,
  };
}

/** Served 20260926T032913Z-48332, by node id: the drafter made `monthly_churn` a FACTOR itself. */
function factorDraft() {
  return {
    goal: {
      metric: 'Monthly recurring revenue (MRR)', operator: '>=', target_stated: true, value: 20000, unit: 'GBP per month', horizon_months: 12,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit',
    },
    constraints: [CHURN_LIMIT],
    options: [
      { label: 'Keep Pro at £49', provenance: 'inferred', changes: [], interventions: [], is_status_quo: true },
      { label: 'Raise Pro to £59', provenance: 'explicit', changes: ['AI feature value'], is_status_quo: null,
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP per month', provenance: 'explicit' }] },
      { label: 'Raise Pro to £54', provenance: 'inferred', changes: ['AI feature value'], is_status_quo: null,
        interventions: [{ factor_label: 'Pro plan price', value: 54, value_kind: 'absolute', unit: 'GBP per month', provenance: 'ai_proposed' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP per month', provenance: 'explicit', plausible_max: 200 },
      { label: 'AI feature value', role: 'controllable', baseline_known: false, baseline_value: 50, unit: 'value score out of 100', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'New Pro conversion rate', role: 'observable', baseline_known: false, baseline_value: 15, unit: 'percent', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: null, unit: 'percent per month', provenance: 'explicit', plausible_max: 100 },
      { label: 'Active Pro subscribers', role: 'observable', baseline_known: false, baseline_value: null, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
    ],
    risks: [{ label: 'Price resistance', provenance: 'inferred' }],
    outcomes: [],
    links: [
      link('Pro plan price', 'Price resistance', 'positive'),
      link('Price resistance', 'New Pro conversion rate', 'negative'),
      link('Price resistance', 'Monthly churn', 'positive'),
      link('AI feature value', 'New Pro conversion rate', 'positive'),
      link('AI feature value', 'Monthly churn', 'negative'),
      link('New Pro conversion rate', 'Active Pro subscribers', 'positive'),
      link('Monthly churn', 'Active Pro subscribers', 'negative'),
      link('Active Pro subscribers', 'Monthly recurring revenue (MRR)', 'positive'),
      link('Pro plan price', 'Monthly recurring revenue (MRR)', 'positive'),
    ],
    unknowns: [],
  };
}

/** The production contract: the candidate must pass the real strict schema, as the model's output would. */
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

async function register(wire: Record<string, unknown>): Promise<{ graph: Graph; out: Record<string, unknown> }> {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let body: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) {
      body = structuredClone((b as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('88888888-8888-4888-8888-888888888888', BRIEF, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(body) as unknown as Graph, out };
}

const byId = (g: Graph, id: string): Node | undefined => g.nodes.find((n) => n.id === id);
/** An edge's identity as the served draft shows it: its ends, its sign, who stated it, and whether it is a repair. */
const edgeKeys = (g: Graph): string[] => g.edges
  .map((e) => `${e.from}->${e.to}:${String(e.effect_direction)}:${String((e.provenance as { source?: unknown } | undefined)?.source)}:${String(e.origin ?? '')}`)
  .sort();
const parents = (g: Graph, id: string): string[] => g.edges.filter((e) => e.to === id).map((e) => e.from).sort();
const children = (g: Graph, id: string): string[] => g.edges.filter((e) => e.from === id).map((e) => e.to).sort();
const blockingCodes = (g: unknown): string[] => assessCanonicalAnalysisReadiness(g).blockingIssues.map((i) => i.code).sort();
const canHoldAStartingValue = (n: Node | undefined): boolean => n !== undefined && SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS.includes(n.kind);

describe('a limit the user states on a level is admitted on a factor that can hold a starting value', () => {
  it('FIDELITY: the rebuilt served outcome draft reproduces the served graph on every other node and every edge', async () => {
    const { graph } = await register(outcomeDraft());
    expect(edgeKeys(graph)).toEqual(edgeKeys(SERVED_OUTCOME));
    for (const s of SERVED_OUTCOME.nodes.filter((n) => n.id !== 'monthly_churn')) {
      expect(byId(graph, s.id), s.id).toStrictEqual(s);
    }
  });

  it('RED: "Monthly churn" registers as the served FACTOR shape — same id, label and authorship, observable, framed, no value', async () => {
    const { graph } = await register(outcomeDraft());
    // The served factor-kind draft's own node, byte for byte: what the 5/5 journeys started from.
    expect(byId(graph, 'monthly_churn')).toStrictEqual(byId(SERVED_FACTOR, 'monthly_churn'));
    expect(byId(graph, 'monthly_churn')).toStrictEqual({
      id: 'monthly_churn', kind: 'factor', label: 'Monthly churn', provenance: 'from_brief', category: 'observable', scale_frame: 100,
    });
  });

  it('RED (oracle): the value writer accepts it — the check behind "an outcome, not a factor that can hold a starting value"', async () => {
    expect(canHoldAStartingValue(byId(SERVED_OUTCOME, 'monthly_churn')), 'PRECONDITION: served, it was refused').toBe(false);
    const { graph } = await register(outcomeDraft());
    expect(canHoldAStartingValue(byId(graph, 'monthly_churn'))).toBe(true);
  });

  it('RED: the limit still names that node, as the served factor-kind draft carries it (unit on the node’s frame)', async () => {
    const { graph } = await register(outcomeDraft());
    expect(graph.goal_constraints).toStrictEqual(SERVED_FACTOR.goal_constraints);
    expect(graph.goal_constraints).toStrictEqual([{
      constraint_id: 'agent-lane:monthly_churn:<=', node_id: 'monthly_churn', operator: '<=', value: 10, label: 'Monthly churn', unit: '%',
      provenance: 'explicit',
      provenance_unit_relabelled: { rule: 'agent_lane_limit_unit_v1', pre_normalisation_value: 10, pre_normalisation_unit: 'percent per month' },
    }]);
  });

  it('it keeps every link in and out: the same parents and the same child as served', async () => {
    const { graph } = await register(outcomeDraft());
    expect(parents(graph, 'monthly_churn')).toEqual(['ai_feature_value', 'price_sensitivity']);
    expect(children(graph, 'monthly_churn')).toEqual(['pro_plan_subscribers']);
    expect(parents(graph, 'monthly_churn')).toEqual(parents(SERVED_OUTCOME, 'monthly_churn'));
    expect(children(graph, 'monthly_churn')).toEqual(children(SERVED_OUTCOME, 'monthly_churn'));
  });

  it('readiness is not newly blocked: the same blockers and the same run admission as the served outcome draft', async () => {
    const { graph, out } = await register(outcomeDraft());
    const servedGraph = GraphV3.parse(SERVED_OUTCOME);
    expect(blockingCodes(graph)).toEqual(blockingCodes(servedGraph));
    expect(resolveRunAdmission(graph).willProceed).toBe(resolveRunAdmission(servedGraph).willProceed);
    expect(resolveRunAdmission(graph).willProceed).toBe(true);
    expect(out.goal_constraints_carried).toBe(1);
  });

  // Every unit the served OUTCOME-kind first passes carried (R&C 0317Z/0326Z "%", 032916Z "percent per month";
  // Delivery Lead f-20260925T234631Z "% per month"), each at the user's 10.
  it('every limit spelling the served outcome-kind first passes used is converted', async () => {
    for (const unit of ['%', 'percent per month', '% per month']) {
      const { graph } = await register(outcomeDraft({ constraints: [{ ...CHURN_LIMIT, unit }] }));
      expect(byId(graph, 'monthly_churn'), unit).toStrictEqual(byId(SERVED_FACTOR, 'monthly_churn'));
      expect(graph.goal_constraints?.map((c) => [c.node_id, c.value, c.unit]), unit).toEqual([['monthly_churn', 10, '%']]);
    }
  });

  it('the user’s own figures are kept exactly, and no starting value is invented from the limit', async () => {
    const { graph } = await register(outcomeDraft());
    expect(byId(graph, 'monthly_churn')).not.toHaveProperty('observed_state');
    expect(byId(graph, 'pro_plan_price')?.observed_state).toStrictEqual({
      value: 0.245, raw_value: 49, cap: 200, declared_scale: 'unit_interval', unit: 'GBP per month', source: 'brief_extraction',
    });
    expect(graph.goal_constraints?.[0]?.value).toBe(10);
  });
});

describe('CONTROLS — what the rule must leave alone', () => {
  it('the served FACTOR-kind draft registers byte-identical to what was served', async () => {
    const { graph } = await register(factorDraft());
    expect(graph.nodes).toStrictEqual(SERVED_FACTOR.nodes);
    expect(edgeKeys(graph)).toEqual(edgeKeys(SERVED_FACTOR));
    expect(graph.goal_constraints).toStrictEqual(SERVED_FACTOR.goal_constraints);
  });

  it('an outcome NO limit names stays the served outcome', async () => {
    const { graph } = await register(outcomeDraft({ constraints: [] }));
    expect(byId(graph, 'monthly_churn')).toStrictEqual(byId(SERVED_OUTCOME, 'monthly_churn'));
    expect(byId(graph, 'monthly_churn')?.kind).toBe('outcome');
  });

  it('a limit Olumi proposed (not the user’s) leaves the outcome an outcome', async () => {
    for (const provenance of ['ai_proposed', 'inferred']) {
      const { graph } = await register(outcomeDraft({ constraints: [{ ...CHURN_LIMIT, provenance }] }));
      expect(byId(graph, 'monthly_churn'), provenance).toStrictEqual(byId(SERVED_OUTCOME, 'monthly_churn'));
      expect(graph.goal_constraints?.map((c) => c.node_id), provenance).toEqual(['monthly_churn']);
    }
  });

  it('a relative-change limit ("must not rise by more than 2 points") leaves the outcome an outcome', async () => {
    for (const unit of ['percentage points', 'pp']) {
      const { graph } = await register(outcomeDraft({ constraints: [{ metric: 'Monthly churn', operator: '<=', value: 2, unit, provenance: 'explicit' }] }));
      expect(byId(graph, 'monthly_churn'), unit).toStrictEqual(byId(SERVED_OUTCOME, 'monthly_churn'));
      expect(graph.goal_constraints?.map((c) => c.node_id), unit).toEqual(['monthly_churn']);
    }
  });

  it('a limit on the goal stays on the goal, and one on a risk leaves the risk a risk', async () => {
    const { graph } = await register(outcomeDraft({ constraints: [
      CHURN_LIMIT,
      { metric: 'MRR', operator: '<=', value: 50, unit: '%', provenance: 'explicit' },
      { metric: 'Price sensitivity', operator: '<=', value: 50, unit: '%', provenance: 'explicit' },
    ] }));
    expect(byId(graph, 'mrr')).toStrictEqual(byId(SERVED_OUTCOME, 'mrr'));
    expect(byId(graph, 'price_sensitivity')).toStrictEqual(byId(SERVED_OUTCOME, 'price_sensitivity'));
    expect(graph.goal_constraints?.map((c) => c.node_id).sort()).toEqual(['monthly_churn', 'mrr', 'price_sensitivity']);
    expect(byId(graph, 'monthly_churn')?.kind, 'the churn limit alone still converts its node').toBe('factor');
  });

  it('a money limit on a limited total stays on its outcome (the rule is the percent level only)', async () => {
    const { graph } = await register(outcomeDraft({ constraints: [{ metric: 'Monthly churn', operator: '<=', value: 5000, unit: 'GBP', provenance: 'explicit' }] }));
    expect(byId(graph, 'monthly_churn')).toStrictEqual(byId(SERVED_OUTCOME, 'monthly_churn'));
  });
});
