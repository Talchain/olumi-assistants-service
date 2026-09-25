/**
 * ⛔ THE HELD STATUS QUO MUST NOT DEPEND ON HOW THE MODEL WORDS ITS LABEL.
 *
 * Served CEE e39f6e0 / c673223: `wireInertStatusQuo` found the status quo ONLY by
 * `labelMatchesBaseline` (the readiness idiom list). Paul's hiring journey drafted
 * "Continue Current Staffing" — not an idiom — so the option stayed inert and the
 * turn was blocked (`OPTION_NO_FACTOR_EDGES`). Other served labels failed the same
 * way. The constructor now DECLARES the current-state option (`is_status_quo`, at
 * most one), admission reads that flag FIRST through the shared baseline-identity
 * reader, and the idiom list is only the fallback. Two flagged options are never
 * guessed between. No idiom is added.
 *
 * Every candidate is validated against the REAL strict construction schema and
 * served through `buildModelFromBrief` → `/graph/register` → `GraphV3`; readiness
 * is the real authority. Assertions name the option by id.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { admitCandidateModel, wireInertStatusQuo, type CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, BUILD_INSTRUCTIONS, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { isRepairAuthoredOptionFactorEdge } from '../../../graph/repair-authored-edge.js';
import { labelMatchesBaseline } from '../../../cee/transforms/analysis-ready.js';
import { slugId } from '../admit-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

/** The served status-quo labels (real model output), and whether the idiom list alone catches each. */
const SERVED = ['Continue Current Staffing', 'Continue current strategy', 'Continue Current Approach', 'Retain monolith'];

type Opt = CandidateModel['options'][number] & { is_status_quo?: boolean | null };

function hiring(statusQuo: Partial<Opt> & { label: string }, extra: Opt[] = []): CandidateModel {
  const lever = (label: string, factor: string, value: number): Opt => ({
    label, provenance: 'explicit', changes: [], is_status_quo: null,
    interventions: [{ factor_label: factor, value, value_kind: 'absolute', unit: 'hires', provenance: 'explicit' } as never],
  });
  return {
    goal: { metric: 'Velocity', operator: '>=', target_stated: false, value: null, unit: 'points', horizon_months: null, provenance: 'explicit' },
    constraints: [],
    options: [
      lever('Hire a Tech Lead', 'Tech leads hired', 1),
      lever('Hire Two Developers', 'Developers hired', 2),
      { provenance: 'ai_proposed', changes: [], interventions: [], is_status_quo: true, ...statusQuo },
      ...extra,
    ],
    factors: [
      { label: 'Tech leads hired', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'hires', provenance: 'explicit', plausible_max: 10 },
      { label: 'Developers hired', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'hires', provenance: 'explicit', plausible_max: 20 },
    ],
    risks: [], outcomes: [],
    links: [
      { from: 'Tech leads hired', to: 'Velocity', direction: 'positive', provenance: 'inferred' },
      { from: 'Developers hired', to: 'Velocity', direction: 'positive', provenance: 'inferred' },
    ],
  } as unknown as CandidateModel;
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Graph = { nodes: { id: string; kind: string; label: string }[]; edges: { from: string; to: string; origin?: unknown }[] };

async function build(model: CandidateModel) {
  const wire = { ...model, unknowns: [] };
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let graph: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', 'Should I hire a tech lead or two developers?', d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(graph) as unknown as Graph, out };
}

const kinds = (g: Graph) => new Map(g.nodes.map((n) => [n.id, n.kind]));
const heldEdges = (g: Graph, id: string) => g.edges.filter((e) => e.from === id && isRepairAuthoredOptionFactorEdge(e, kinds(g)));
const optionReady = (g: Graph, id: string) => (assessCanonicalAnalysisReadiness(g).analysisReady?.options ?? []).find((o) => o.option_id === id);
const noFactorEdgeIssues = (g: Graph) => assessCanonicalAnalysisReadiness(g).issues.filter((i) => i.code === 'OPTION_NO_FACTOR_EDGES');

describe('the constructor declares the status quo, and admission holds it whatever its label', () => {
  it('vacuity: none of the served labels is caught by the idiom list alone', () => {
    expect(SERVED.filter(labelMatchesBaseline)).toEqual([]);
  });

  it.each(SERVED)('RED: "%s", flagged is_status_quo, is held (repair edges; no OPTION_NO_FACTOR_EDGES)', async (label) => {
    const { graph, out } = await build(hiring({ label }));
    const id = slugId(label);
    expect(heldEdges(graph, id).map((e) => e.to).sort()).toEqual(['developers_hired', 'tech_leads_hired']);
    expect(noFactorEdgeIssues(graph)).toEqual([]);
    expect(out.options_that_change_nothing).toEqual([]);
    expect((out.not_represented as string[]).filter((s) => s.includes(`'${label}' reads as carrying on as now`))).toHaveLength(1);
  });

  it('RED (readiness): the flagged "Continue Current Staffing" is the READY held baseline, and nothing blocks', async () => {
    const { graph } = await build(hiring({ label: 'Continue Current Staffing' }));
    const sq = optionReady(graph, 'continue_current_staffing');
    expect([sq?.is_baseline, sq?.status]).toEqual([true, 'ready']);
    expect(assessCanonicalAnalysisReadiness(graph).blockingIssues.map((i) => i.code)).toEqual([]);
  });

  it('CONTROL: an option that changes something is never held, even if flagged', async () => {
    const { graph } = await build(hiring({ label: 'Continue Current Staffing', changes: ['Developers hired'] }));
    expect(heldEdges(graph, 'continue_current_staffing')).toEqual([]);
    expect(graph.edges.filter((e) => e.from === 'continue_current_staffing').map((e) => e.to)).toContain('developers_hired');
  });

  it('CONTROL: the idiom path is unchanged — an unflagged "Maintain current staffing" is still held', async () => {
    const { graph } = await build(hiring({ label: 'Maintain current staffing', is_status_quo: null }));
    expect(heldEdges(graph, 'maintain_current_staffing')).toHaveLength(2);
  });

  it('CONTROL: an unflagged, non-idiom inert option is NOT held — the flag, not the wording, is what counts', async () => {
    const { graph } = await build(hiring({ label: 'Continue Current Staffing', is_status_quo: null }));
    expect(heldEdges(graph, 'continue_current_staffing')).toEqual([]);
    expect(noFactorEdgeIssues(graph)).toHaveLength(1);
  });

  it('CONTROL: two flagged options are never guessed between — neither is held', async () => {
    const second: Opt = { label: 'Retain monolith', provenance: 'ai_proposed', changes: [], interventions: [], is_status_quo: true };
    const { graph } = await build(hiring({ label: 'Continue Current Staffing' }, [second]));
    expect(heldEdges(graph, 'continue_current_staffing')).toEqual([]);
    expect(heldEdges(graph, 'retain_monolith')).toEqual([]);
  });

  it('CONTROL: a flag outranks an idiom — flagged "Continue Current Staffing" is held, an unflagged "Status quo" is not', async () => {
    const idiom: Opt = { label: 'Status quo', provenance: 'ai_proposed', changes: [], interventions: [], is_status_quo: null };
    const { graph } = await build(hiring({ label: 'Continue Current Staffing' }, [idiom]));
    expect(heldEdges(graph, 'continue_current_staffing')).toHaveLength(2);
    expect(heldEdges(graph, 'status_quo')).toEqual([]);
  });

  it('the pure helper reads the flag through the baseline-identity reader, idioms only as fallback', () => {
    const nodes = [
      { id: 'a', kind: 'option', label: 'Raise price' },
      { id: 'sq', kind: 'option', label: 'Continue current strategy' },
      { id: 'f1', kind: 'factor', label: 'F1' },
    ];
    const levels = new Map([['a', { f1: {} }]]);
    expect(wireInertStatusQuo(nodes, [], levels)).toBeNull();
    expect(wireInertStatusQuo(nodes, [], levels, new Set(['sq']))).toEqual({ optionId: 'sq', factorIds: ['f1'] });
    expect(wireInertStatusQuo(nodes, [], levels, new Set(['sq', 'a']))).toBeNull();
  });

  it('the schema carries is_status_quo on every option (strict: required, boolean or null) and the instructions explain it', () => {
    const opt = (buildCandidateSchema() as { properties: { options: { items: { required: string[]; properties: Record<string, unknown> } } } }).properties.options.items;
    expect(opt.required).toContain('is_status_quo');
    expect(opt.properties.is_status_quo).toMatchObject({ anyOf: [{ type: 'boolean' }, { type: 'null' }] });
    expect(BUILD_INSTRUCTIONS).toContain('is_status_quo');
  });

  it('admission alone: only the DECLARED held option carries is_baseline; the idiom path and the levers carry none', () => {
    const m = admitCandidateModel(hiring({ label: 'Continue Current Staffing' }));
    const node = m.nodes.find((n) => n.id === 'continue_current_staffing') as unknown as Record<string, unknown>;
    expect(node.is_baseline).toBe(true);
    expect(node).not.toHaveProperty('is_status_quo');
    expect(m.nodes.filter((n) => (n as { is_baseline?: unknown }).is_baseline === true).map((n) => n.id)).toEqual(['continue_current_staffing']);
    const idiom = admitCandidateModel(hiring({ label: 'Maintain current staffing', is_status_quo: null }));
    expect(idiom.nodes.find((n) => n.id === 'maintain_current_staffing')).not.toHaveProperty('is_baseline');
  });

  it('CONTROL: a flagged option that changes something gets no is_baseline stamp', () => {
    const m = admitCandidateModel(hiring({ label: 'Continue Current Staffing', changes: ['Developers hired'] }));
    expect(m.nodes.find((n) => n.id === 'continue_current_staffing')).not.toHaveProperty('is_baseline');
  });
});
