/**
 * ⛔ AN OPTION OLUMI ADDED MUST NOT BLOCK THE USER'S RUN.
 *
 * Served CEE 21e3b38, eng-hiring-2 (AI Quality witness, AQ-FMC): the constructor
 * added "Continue current staffing" — an option the user never gave. It was not
 * flagged `is_status_quo` and is not a readiness idiom, so it stayed inert and the
 * first Run was refused with `needs_user_mapping`. #1873 holds such an option when
 * the drafter flags it; this is the admission backstop when it does not: an inert
 * option Olumi added is withheld, and SAID, when at least two options remain. An
 * option the user stated is never withheld.
 *
 * Every candidate is validated against the REAL strict construction schema and
 * served through `buildModelFromBrief` → `/graph/register` → `GraphV3`; readiness
 * is the authority. Assertions name the option by id.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Iv = { factor_label: string; value: number; value_kind: 'absolute'; unit: string; provenance: string };
type Opt = { label: string; provenance: string; is_status_quo: boolean | null; changes: string[]; interventions: Iv[] };

const lever = (label: string, factor: string, value: number): Opt => ({
  label, provenance: 'explicit', is_status_quo: null, changes: [],
  interventions: [{ factor_label: factor, value, value_kind: 'absolute', unit: 'people', provenance: 'ai_proposed' }],
});

/** eng-hiring-2's shape: two user levers that act, and an inert, unflagged, non-idiom option Olumi added. */
function engHiring2(extra: Partial<Opt> = {}, levers: Opt[] = [lever('Hire a tech lead', 'Tech leads', 1), lever('Hire two developers', 'Developers', 7)]) {
  return {
    goal: { metric: 'Delivery velocity', operator: '>=', target_stated: false, value: null, unit: 'points', horizon_months: null, provenance: 'explicit' },
    constraints: [],
    options: [...levers, { label: 'Continue current staffing', provenance: 'ai_proposed', is_status_quo: null, changes: [], interventions: [], ...extra }],
    factors: [
      { label: 'Tech leads', role: 'controllable', baseline_known: false, baseline_value: 0, unit: 'people', provenance: 'ai_proposed', plausible_max: 5 },
      { label: 'Developers', role: 'controllable', baseline_known: false, baseline_value: 5, unit: 'people', provenance: 'ai_proposed', plausible_max: 20 },
    ],
    risks: [], outcomes: [],
    links: [
      { from: 'Tech leads', to: 'Delivery velocity', direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Developers', to: 'Delivery velocity', direction: 'positive', provenance: 'ai_proposed' },
    ],
    unknowns: [] as string[],
  };
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
type Graph = { nodes: Array<{ id: string; kind: string; is_baseline?: boolean }>; edges: Array<{ from: string; to: string }> };

async function build(model: ReturnType<typeof engHiring2>) {
  expect(strict(model), JSON.stringify(strict.errors)).toBe(true);
  let graph: unknown;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('55555555-5555-4555-8555-555555555555', 'Should we hire a tech lead or two developers?', d,
    async () => ({ text: JSON.stringify(model) })) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(graph) as unknown as Graph, out };
}

const SQ = 'continue_current_staffing';
const has = (g: Graph, id: string) => g.nodes.some((n) => n.id === id);
const optionStatus = (g: Graph, id: string) =>
  (assessCanonicalAnalysisReadiness(g).analysisReady?.options ?? []).find((o) => o.option_id === id)?.status;
const blocksOn = (g: Graph, id: string) =>
  assessCanonicalAnalysisReadiness(g).blockingIssues.filter((i) => (i as { option_id?: string }).option_id === id);
const said = (out: Record<string, unknown>) => ((out.not_represented ?? []) as string[]).filter((s) => s.includes("'Continue current staffing'") && s.includes('left it out'));

describe('an inert option Olumi added never blocks the run (eng-hiring-2)', () => {
  it('RED: the invented inert option is withheld — no node, no edge, no mapping blocker — and the levers stay', async () => {
    const { graph } = await build(engHiring2());
    expect(has(graph, SQ)).toBe(false);
    expect(graph.edges.some((e) => e.from === SQ || e.to === SQ)).toBe(false);
    expect(blocksOn(graph, SQ)).toEqual([]);
    expect(has(graph, 'hire_a_tech_lead') && has(graph, 'hire_two_developers')).toBe(true);
    expect(assessCanonicalAnalysisReadiness(graph).blockingIssues).toEqual([]);
  });

  it('RED: …and it is SAID, once, with how to bring it back', async () => {
    const { out } = await build(engHiring2());
    expect(said(out), JSON.stringify(out.not_represented)).toHaveLength(1);
    expect(said(out)[0]).toContain('say what it would change');
  });

  it('CONTROL: an inert option the USER stated is kept, and still raises the honest mapping question', async () => {
    const { graph, out } = await build(engHiring2({ provenance: 'explicit' }));
    expect(has(graph, SQ)).toBe(true);
    expect(optionStatus(graph, SQ)).toBe('needs_user_mapping');
    expect(said(out)).toEqual([]);
  });

  it('CONTROL (#1873): a FLAGGED invented status quo is held, not withheld', async () => {
    const { graph, out } = await build(engHiring2({ is_status_quo: true }));
    expect(has(graph, SQ)).toBe(true);
    expect(graph.nodes.find((n) => n.id === SQ)?.is_baseline).toBe(true);
    expect(blocksOn(graph, SQ)).toEqual([]);
    expect(said(out)).toEqual([]);
  });

  it('CONTROL: an idiom-labelled invented status quo is held, not withheld', async () => {
    const { graph } = await build(engHiring2({ label: 'Maintain current staffing' }));
    expect(has(graph, 'maintain_current_staffing')).toBe(true);
    expect(graph.edges.some((e) => e.from === 'maintain_current_staffing')).toBe(true);
  });

  it('CONTROL: an invented option that ACTS is kept', async () => {
    const { graph } = await build(engHiring2({ label: 'Use contractors', interventions: [{ factor_label: 'Developers', value: 6, value_kind: 'absolute', unit: 'people', provenance: 'ai_proposed' }] }));
    expect(has(graph, 'use_contractors')).toBe(true);
  });

  it('CONTROL: never withheld when fewer than two options would remain', async () => {
    const { graph } = await build(engHiring2({}, [lever('Hire two developers', 'Developers', 7)]));
    expect(has(graph, SQ)).toBe(true);
  });
});
