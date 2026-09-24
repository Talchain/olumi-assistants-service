/**
 * ⛔ AN INERT STATUS QUO IS A HELD BASELINE, NOT A BROKEN OPTION (Paul's ruling).
 *
 * At staging 8428207a an option such as "Maintain current staffing", given no
 * `changes` and no `interventions`, was admitted with no option→factor edge.
 * Readiness then raised `OPTION_NO_FACTOR_EDGES`, a blocker that is not waivable,
 * so the WHOLE model was refused — 4 of 9 hiring builds in an earlier witness.
 *
 * The conventional lane already connects such an option with deterministic
 * repair edges (`status-quo-fix.ts`), which readiness EXCLUDES from its mapping
 * count (`isRepairAuthoredOptionFactorEdge`), so the option is HELD at every
 * starting value rather than asked for a level. This suite proves the agent lane
 * now does the same, through the real `buildModelFromBrief` → `/graph/register`
 * payload, parsed with CEE's own `GraphV3`, and judged by the real readiness
 * authority. Every assertion names the option or edge by id.
 */
import { describe, it, expect } from 'vitest';
import {
  admitCandidateModel,
  wireInertStatusQuo,
  type CandidateModel,
} from '../admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { isRepairAuthoredOptionFactorEdge, REPAIR_AUTHORED_ORIGIN } from '../../../graph/repair-authored-edge.js';
import { CONNECTIVITY_REPAIR_WIRING_REASON } from '../../../cee/unified-pipeline/stages/repair/status-quo-fix.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';

type Option = CandidateModel['options'][number];

const SQ = 'maintain_current_staffing';

/** Paul's hiring decision; the status quo says nothing about what it changes. */
function hiring(statusQuo: Partial<Option> | null = {}, extraOptions: Option[] = []): CandidateModel {
  return {
    goal: { metric: 'Velocity', operator: '>', value: 30, unit: 'points per sprint', horizon_months: null, provenance: 'explicit' },
    constraints: [],
    options: [
      { label: 'Hire a Tech Lead', provenance: 'explicit', changes: [],
        interventions: [{ factor_label: 'Tech leads hired', value: 1, unit: 'hires', provenance: 'explicit' }] },
      { label: 'Hire Two Developers', provenance: 'explicit', changes: ['Onboarding workload'],
        interventions: [{ factor_label: 'Developers hired', value: 2, unit: 'hires', provenance: 'explicit' }] },
      ...(statusQuo === null ? [] : [{ label: 'Maintain current staffing', provenance: 'ai_proposed', changes: [], interventions: [], ...statusQuo }]),
      ...extraOptions,
    ],
    factors: [
      { label: 'Tech leads hired', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'hires', provenance: 'explicit', plausible_max: 10 },
      { label: 'Developers hired', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'hires', provenance: 'explicit', plausible_max: 20 },
      { label: 'Onboarding workload', role: 'controllable', baseline_known: false, baseline_value: 30, unit: 'score', provenance: 'ai_proposed', plausible_max: 100 },
    ],
    risks: [],
    outcomes: [],
    links: [
      { from: 'Tech leads hired', to: 'Velocity', direction: 'positive', provenance: 'inferred' },
      { from: 'Developers hired', to: 'Velocity', direction: 'positive', provenance: 'inferred' },
      { from: 'Developers hired', to: 'Onboarding workload', direction: 'positive', provenance: 'inferred' },
      { from: 'Onboarding workload', to: 'Velocity', direction: 'negative', provenance: 'inferred' },
    ],
  } as CandidateModel;
}

type Edge = { from: string; to: string; origin?: unknown; provenance?: { source?: string; reasoning?: string }; strength?: unknown; exists_probability?: number; effect_direction?: string };
type Graph = { nodes: { id: string; kind: string; label: string; interventions?: unknown; is_baseline?: unknown; provenance?: unknown }[]; edges: Edge[] };

/** The real registration path, and the build result the Agent reads. */
async function build(model: CandidateModel) {
  let graph: unknown = null;
  const call = (async () => ({ text: JSON.stringify({ ...model, unknowns: [] }) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      graph = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('55555555-5555-4555-8555-555555555555', 'Should I hire a tech lead or two developers, or keep the team as it is?', d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(graph) as unknown as Graph, out };
}

const kinds = (g: Graph) => new Map(g.nodes.map((n) => [n.id, n.kind]));
const optionFactorEdgesFrom = (g: Graph, optionId: string) => {
  const k = kinds(g);
  return g.edges.filter((e) => e.from === optionId && k.get(e.to) === 'factor');
};
const readiness = (g: Graph) => assessCanonicalAnalysisReadiness(g);
/**
 * `OPTION_NO_FACTOR_EDGES` carries no option identity (its message is generic), so
 * it is attributed through the vacuity arm (absent without the option) and the
 * option's own readiness entry, which IS keyed by id.
 */
const noFactorEdgeIssues = (g: Graph) => readiness(g).issues.filter((i) => i.code === 'OPTION_NO_FACTOR_EDGES');
const optionReadiness = (g: Graph, id: string) =>
  (readiness(g).analysisReady?.options ?? []).find((o) => o.option_id === id);

describe('an inert status quo is connected as a held baseline', () => {
  it('vacuity: without the status quo, the rest of the model raises no OPTION_NO_FACTOR_EDGES', async () => {
    const { graph } = await build(hiring(null));
    expect(noFactorEdgeIssues(graph)).toEqual([]);
  });

  it('RED: readiness raises no OPTION_NO_FACTOR_EDGES, and holds the status quo as the ready baseline', async () => {
    const { graph } = await build(hiring());
    expect(noFactorEdgeIssues(graph)).toEqual([]);
    const sq = optionReadiness(graph, SQ);
    expect(sq, 'the status quo is an option readiness judges').toBeDefined();
    expect(sq!.is_baseline).toBe(true);
    expect(sq!.status).toBe('ready');
    // …and no readiness issue asks the held baseline for a level of its own. (An
    // edge WITHOUT the repair origin is read as the user's mapping, and readiness
    // then asks "What should option … set it to?" for every target.)
    expect(readiness(graph).issues.filter((i) => String(i.message).includes('option "Maintain current staffing"'))).toEqual([]);
  });

  it('RED: every minted edge is repair-authored, and targets exactly the factors the other options set levels on', async () => {
    const { graph } = await build(hiring());
    const minted = optionFactorEdgesFrom(graph, SQ);
    expect(minted.map((e) => e.to)).toEqual(['tech_leads_hired', 'developers_hired']);
    for (const e of minted) {
      expect(isRepairAuthoredOptionFactorEdge(e, kinds(graph)), `${e.from}->${e.to}`).toBe(true);
      expect(e.origin).toBe(REPAIR_AUTHORED_ORIGIN);
      expect(e.provenance).toEqual({ source: 'cee_hypothesis', reasoning: CONNECTIVITY_REPAIR_WIRING_REASON });
      expect(e.strength).toEqual(STRUCTURAL_EDGE_DEFAULTS.strength);
      expect(e.exists_probability).toBe(STRUCTURAL_EDGE_DEFAULTS.exists_probability);
    }
  });

  it('RED: nothing is invented on the option — no level, no baseline stamp, no user authority', async () => {
    const { graph } = await build(hiring());
    const sq = graph.nodes.find((n) => n.id === SQ)!;
    expect(sq).not.toHaveProperty('interventions');
    expect(sq).not.toHaveProperty('is_baseline');
    expect(sq.provenance).toBe('ai_inferred');
    expect(JSON.stringify(optionFactorEdgesFrom(graph, SQ))).not.toMatch(/user_/);
  });

  it('RED: the build discloses the held baseline instead of calling the option inert', async () => {
    const m = admitCandidateModel(hiring());
    expect(m.withheld.filter((w) => w.from === 'Maintain current staffing')).toEqual([]);
    const [held] = m.loss.filter((l) => l.field_path === `nodes[${SQ}].status_quo_held`);
    expect(held?.reason).toBe(
      "'Maintain current staffing' reads as carrying on as now, so I connected it to Tech leads hired and Developers hired "
      + 'with no level of its own; the analysis holds each at its starting value, which may be an estimate rather than a '
      + 'figure you gave. If carrying on as now would itself change any of them, say how.',
    );
    const { out } = await build(hiring());
    expect(out.options_that_change_nothing).toEqual([]);
  });

  it('CONTROL: a non-baseline inert option ("Does nothing new") stays flagged and unlinked', async () => {
    const { graph, out } = await build(hiring(null, [{ label: 'Does nothing new', provenance: 'ai_proposed', changes: [], interventions: [] }]));
    expect(optionFactorEdgesFrom(graph, 'does_nothing_new')).toEqual([]);
    expect(noFactorEdgeIssues(graph)).toHaveLength(1);
    expect(optionReadiness(graph, 'does_nothing_new')?.status).toBe('needs_user_mapping');
    expect(optionReadiness(graph, 'does_nothing_new')?.is_baseline).toBe(false);
    expect(readiness(graph).issues.filter((i) => i.code === 'OPTION_NEEDS_MAPPING').map((i) => i.message))
      .toContain('Choose which factor "Does nothing new" changes and by how much.');
    expect(out.options_that_change_nothing).toEqual(['Does nothing new']);
  });

  it('CONTROL: two status quos are ambiguous, so neither is linked', async () => {
    const { graph, out } = await build(hiring({}, [{ label: 'Status quo', provenance: 'ai_proposed', changes: [], interventions: [] }]));
    expect(optionFactorEdgesFrom(graph, SQ)).toEqual([]);
    expect(optionFactorEdgesFrom(graph, 'status_quo')).toEqual([]);
    expect(out.options_that_change_nothing).toEqual(['Maintain current staffing', 'Status quo']);
  });

  it('CONTROL: a status quo that already acts on a factor is untouched', async () => {
    const { graph } = await build(hiring({ changes: ['Onboarding workload'] }));
    const edges = optionFactorEdgesFrom(graph, SQ);
    expect(edges.map((e) => e.to)).toEqual(['onboarding_workload']);
    expect(edges[0]).not.toHaveProperty('origin');
  });
});

describe('wireInertStatusQuo (pure)', () => {
  const nodes = [
    { id: 'a', kind: 'option', label: 'Raise price' },
    { id: 'b', kind: 'option', label: 'Cut price' },
    { id: 'sq', kind: 'option', label: 'Keep things as they are' },
    { id: 'f1', kind: 'factor', label: 'F1' },
    { id: 'f2', kind: 'factor', label: 'F2' },
    { id: 'f3', kind: 'factor', label: 'F3' },
  ];

  it('the basis is the ordered union of the factors the other options set levels on', () => {
    const levels = new Map([['a', { f2: {}, f1: {} }], ['b', { f1: {}, f3: {} }]]);
    expect(wireInertStatusQuo(nodes, [], levels)).toEqual({ optionId: 'sq', factorIds: ['f2', 'f1', 'f3'] });
  });

  it('falls back to the other options’ option→factor targets when none sets a level', () => {
    const edges = [{ from: 'a', to: 'f3' }, { from: 'b', to: 'f1' }, { from: 'b', to: 'f3' }];
    expect(wireInertStatusQuo(nodes, edges, new Map())).toEqual({ optionId: 'sq', factorIds: ['f3', 'f1'] });
  });

  it('an empty basis leaves the status quo inert (null)', () => {
    expect(wireInertStatusQuo(nodes, [], new Map())).toBeNull();
  });

  it('a status quo with any option→factor edge is left alone (null)', () => {
    const levels = new Map([['a', { f1: {} }]]);
    expect(wireInertStatusQuo(nodes, [{ from: 'sq', to: 'f2' }], levels)).toBeNull();
  });
});
