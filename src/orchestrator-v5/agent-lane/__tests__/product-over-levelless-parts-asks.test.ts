/**
 * ⛔ A PRODUCT OVER OLUMI'S LEVEL-LESS PARTS IS NOT DECLARED; THE DRAFT ASKS FOR THE MISSING FIGURES (AIQ #72 5898415568
 * run 0 `0c426b00`; R3 5898443502: "ONE question for the two missing figures … admission could refuse a product over
 * level-less Olumi parts and draft the ask instead. Owner: MG").
 *
 * Served cut-costs on `5d559f3`: the drafter chained "Migrated monthly spend" = AWS workload spend × GCP workload share and
 * "GCP monthly saving" = that × GCP saving rate, as Olumi's reading, with NO level on the share or the rate. ISL cannot
 * evaluate a product with a missing operand, so PLoT withheld the goal's chance on every option and the Run ended with no
 * question — a dead end. A declaration Olumi made over parts nobody has given a figure for is not carried; the draft says
 * which figures would let it be worked out that way.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const SCENARIO = '0c426b00-0000-4000-8000-00000000c426';
const BRIEF = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to cut costs by 20% without more than 2 weeks of migration downtime risk.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Dir = 'positive' | 'negative';
const link = (from: string, to: string, direction: Dir) => ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
const set = (factor_label: string, value: number, unit: string) => ({ factor_label, value, value_kind: 'absolute', unit, provenance: 'ai_proposed' });

/** Run 0's shape (`0c426b00`), as served: two chained Olumi products, the share and the rate with no level. */
function run0(over: { share?: number | null; rate?: number | null; provenance?: 'inferred' | 'explicit' } = {}): Record<string, unknown> {
  const share = over.share === undefined ? null : over.share;
  const rate = over.rate === undefined ? null : over.rate;
  return {
    goal: { metric: 'Monthly spend', operator: '<=', target_stated: true, frame: 'level', value: 36000, unit: 'GBP per month', horizon_months: null,
      provenance: 'explicit', baseline_known: true, baseline_value: 45000, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Remain on AWS', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Switch to GCP', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [set('GCP workload share', 1, 'fraction of workload'), set('GCP saving rate', 0.28, 'fraction of migrated spend'), set('Migration safeguards coverage', 0.8, 'fraction')] },
      { label: 'Phased GCP migration', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [set('GCP workload share', 0.5, 'fraction of workload'), set('GCP saving rate', 0.28, 'fraction of migrated spend'), set('Migration safeguards coverage', 0.9, 'fraction')] },
    ],
    factors: [
      { label: 'AWS workload spend', role: 'observable', baseline_known: true, baseline_value: 45000, unit: 'GBP per month', provenance: 'explicit', plausible_max: 100000 },
      { label: 'GCP workload share', role: 'controllable', baseline_known: false, baseline_value: share, unit: 'fraction of workload', provenance: 'ai_proposed', plausible_max: 1 },
      { label: 'GCP saving rate', role: 'controllable', baseline_known: false, baseline_value: rate, unit: 'fraction of migrated spend', provenance: 'ai_proposed', plausible_max: 1 },
      { label: 'Migration safeguards coverage', role: 'controllable', baseline_known: false, baseline_value: 0, unit: 'fraction', provenance: 'ai_proposed', plausible_max: 1 },
    ],
    risks: [],
    outcomes: [{ label: 'Migrated monthly spend', provenance: 'inferred' }, { label: 'GCP monthly saving', provenance: 'inferred' }, { label: 'Migration downtime', provenance: 'inferred' }],
    links: [
      link('AWS workload spend', 'Migrated monthly spend', 'positive'),
      link('GCP workload share', 'Migrated monthly spend', 'positive'),
      link('Migrated monthly spend', 'GCP monthly saving', 'positive'),
      link('GCP saving rate', 'GCP monthly saving', 'positive'),
      link('GCP monthly saving', 'Monthly spend', 'negative'),
      link('GCP workload share', 'Migration downtime', 'positive'),
      link('Migration safeguards coverage', 'Migration downtime', 'negative'),
      link('Migration downtime', 'Monthly spend', 'positive'),
    ],
    identities: [
      { outcome: 'Migrated monthly spend', operation: 'product', factors: ['AWS workload spend', 'GCP workload share'], provenance: over.provenance ?? 'inferred' },
      { outcome: 'GCP monthly saving', operation: 'product', factors: ['Migrated monthly spend', 'GCP saving rate'], provenance: over.provenance ?? 'inferred' },
    ],
    unknowns: [],
    decision_question: null,
  };
}

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };

async function build(wire: Record<string, unknown>, brief = BRIEF, validate = true): Promise<{ graph: Graph; out: unknown }> {
  if (validate) expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let registered: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SCENARIO, brief, dispatch, call);
  expect((out as { ok: boolean }).ok, JSON.stringify(out)).toBe(true);
  return { graph: registered as Graph, out };
}

const carriers = (g: Graph): string[] => g.nodes.filter((n) => n.nonlinear_identity !== undefined).map((n) => n.id as string);

const Q = 'What do you expect ‘GCP workload share’ and ‘GCP saving rate’ to be? ‘GCP workload share’ and ‘GCP saving rate’ have no figure yet, so Olumi adds up their effects on ‘Monthly spend’ instead of multiplying them: treat the comparison as a rough approximation until you say.';

describe('a product Olumi reads over a part with no level is not declared, and its figures are asked once', () => {
  it('ROW 1 (run 0 as served): neither product is carried; ONE question names the share and the rate; each refusal is said', async () => {
    const { graph, out } = await build(run0());
    expect(carriers(graph)).toEqual([]);
    const o = out as { open_questions?: string[]; not_represented?: string[] };
    expect(o.open_questions?.filter((q) => q.includes('What do you expect'))).toEqual([Q]);
    expect(o.open_questions?.some((q) => q.startsWith('Which option does better'))).toBe(false);
    const said = (o.not_represented ?? []).filter((l) => l.includes('multiplied together, but'));
    expect(said).toEqual([
      'Olumi read "Migrated monthly spend" as "AWS workload spend" and "GCP workload share" multiplied together, but "GCP workload share" has no figure yet, so that was not used and nothing about it is assumed.',
      'Olumi read "GCP monthly saving" as "Migrated monthly spend" and "GCP saving rate" multiplied together, but "Migrated monthly spend" and "GCP saving rate" have no figure yet, so that was not used and nothing about it is assumed.',
    ]);
  });

  it('ROW 2 (0 today, the outcome with no level): ISL multiplies it, so both products are carried and nothing is asked (R3 5899153490)', async () => {
    const { graph, out } = await build(run0({ share: 0, rate: 0.25 }));
    expect(carriers(graph).sort()).toEqual(['gcp_monthly_saving', 'migrated_monthly_spend']);
    expect((out as { open_questions?: string[] }).open_questions?.some((q) => q.includes('What do you expect'))).toBe(false);
  });

  it('ROW 2b (0 today, on a GOAL with a level): ISL withholds it (`identity_zero_level`), so it is refused and said as 0', async () => {
    // The ceiling written in the brief (the held-ceiling test's served shape), so the goal keeps today's £45k.
    const ceiling = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to cut it to at most £36k a month without more than 2 weeks of migration downtime risk.';
    const wire = run0({ share: 0, rate: 0.25 });
    wire.goal = { ...(wire.goal as Record<string, unknown>), value: 36, unit: '£k/month', baseline_value: 45 };
    for (const f of wire.factors as Record<string, unknown>[]) if (f.label === 'AWS workload spend') Object.assign(f, { baseline_value: 45, unit: '£k/month', plausible_max: 100 });
    wire.identities = [{ outcome: 'Monthly spend', operation: 'product', factors: ['AWS workload spend', 'GCP workload share'], provenance: 'inferred' }];
    (wire.links as Record<string, unknown>[]).push(link('AWS workload spend', 'Monthly spend', 'positive'), link('GCP workload share', 'Monthly spend', 'positive'));
    const { graph, out } = await build(wire, ceiling);
    expect(graph.nodes.find((n) => n.kind === 'goal')?.observed_state, 'the goal holds its level').toBeDefined();
    expect(carriers(graph)).toEqual([]);
    expect((out as { open_questions?: string[] }).open_questions?.filter((q) => q.includes('What do you expect'))).toEqual([
      'What do you expect ‘GCP workload share’ to be? ‘GCP workload share’ is 0 today, so Olumi adds up their effects on ‘Monthly spend’ instead of multiplying them: treat the comparison as a rough approximation until you say.',
    ]);
  });

  it('ROW 3 (run 0, the chain declared downstream first): refused whole all the same', async () => {
    const wire = run0();
    wire.identities = [...(wire.identities as unknown[])].reverse();
    const { graph, out } = await build(wire);
    expect(carriers(graph)).toEqual([]);
    const asked = (out as { open_questions?: string[] }).open_questions?.filter((q) => q.includes('What do you expect')) ?? [];
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('‘GCP workload share’');
    expect(asked[0]).toContain('‘GCP saving rate’');
  });

  it('ROW 4 (the REAL drafter, Paul\'s cut-costs brief — Baseline v1 corpus `cloud-2`): spend × share × saving, the share 0 today on an outcome with no level → ISL multiplies it, so it is carried and nothing is asked', async () => {
    const corpus = JSON.parse(readFileSync(new URL('./fixtures/baseline-v1-medium-drafts-20260928.json', import.meta.url), 'utf8')) as {
      briefs: Record<string, string>; drafts: Record<string, { brief: string; output_text: string }>;
    };
    const wire = JSON.parse(corpus.drafts['cloud-2']!.output_text) as Record<string, unknown>;
    expect(wire.identities).toEqual([{ outcome: 'Monthly cloud-cost reduction', operation: 'product',
      factors: ['Pre-migration monthly spend', 'GCP workload share', 'GCP unit-cost saving'], provenance: 'ai_proposed' }]);
    const { graph, out } = await build(wire, corpus.briefs.cloud!, false);
    expect(carriers(graph)).toEqual(['monthly_cloud_cost_reduction']);
    expect((out as { open_questions?: string[] }).open_questions?.some((q) => q.includes('What do you expect'))).toBe(false);
  });

  it('CONTROL (every part has a level): both products are carried and nothing is asked', async () => {
    const { graph, out } = await build(run0({ share: 0.1, rate: 0.25 }));
    expect(carriers(graph).sort()).toEqual(['gcp_monthly_saving', 'migrated_monthly_spend']);
    expect((out as { open_questions?: string[] }).open_questions?.some((q) => q.includes('What do you expect'))).toBe(false);
  });

  it('CONTROL (the user\'s own product): a declaration the brief states is kept, level or not', async () => {
    const { graph, out } = await build(run0({ provenance: 'explicit' }));
    expect(carriers(graph).sort()).toEqual(['gcp_monthly_saving', 'migrated_monthly_spend']);
    expect((out as { open_questions?: string[] }).open_questions?.some((q) => q.includes('What do you expect'))).toBe(false);
  });
});
