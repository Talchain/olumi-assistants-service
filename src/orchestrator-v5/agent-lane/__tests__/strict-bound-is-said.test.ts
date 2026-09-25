/**
 * ⛔ A STRICT BOUND THE USER STATED MUST NOT SILENTLY BECOME A NON-STRICT ONE.
 *
 * Served CEE 21e3b38 (AI Quality witness): "under 4%" and "under £400k" were stored
 * with operator `<=`. The drafter captured `<` faithfully; admission widens it
 * because the canonical `GoalConstraintSchema.operator` holds only ">=" and "<="
 * (`admit-constraint.ts`), and records the widening as a warn-level loss — but the
 * build result's disclosure filter never let that loss through, so the user was
 * told nothing. The value is verbatim; the widening is the whole difference, and it
 * decides the boundary case. Full fidelity needs a strict operator in the canonical
 * contract (outside this lease); until then it is SAID.
 *
 * Served through `buildModelFromBrief` with the REAL strict schema; the constraint
 * is found by its node id and bound to its own sentence.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

type Constraint = { metric: string; operator: '<' | '<=' | '>' | '>='; value: number; unit: string; provenance: string };

function hiring(constraints: Constraint[]) {
  return {
    goal: { metric: 'Delivery velocity', operator: '>=', target_stated: false, value: null, unit: 'points', horizon_months: null, provenance: 'explicit' },
    constraints,
    options: [
      { label: 'Hire a tech lead', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [{ factor_label: 'Hiring cost', value: 120000, value_kind: 'absolute', unit: '£', provenance: 'ai_proposed' }] },
      { label: 'Hire two developers', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [{ factor_label: 'Hiring cost', value: 180000, value_kind: 'absolute', unit: '£', provenance: 'ai_proposed' }] },
    ],
    factors: [
      { label: 'Hiring cost', role: 'controllable', baseline_known: false, baseline_value: 0, unit: '£', provenance: 'ai_proposed', plausible_max: 1000000 },
      { label: 'Attrition', role: 'external', baseline_known: false, baseline_value: 3, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
    ],
    risks: [], outcomes: [],
    links: [
      { from: 'Hiring cost', to: 'Delivery velocity', direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Attrition', to: 'Delivery velocity', direction: 'negative', provenance: 'ai_proposed' },
    ],
    unknowns: [] as string[],
  };
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

async function build(model: ReturnType<typeof hiring>) {
  expect(strict(model), JSON.stringify(strict.errors)).toBe(true);
  let graph: { goal_constraints?: Array<{ node_id: string; operator: string; value: number }> } | undefined;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: typeof graph }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('66666666-6666-4666-8666-666666666666', 'Hire a tech lead or two developers, keeping attrition under 4% and cost under £400k?', d,
    async () => ({ text: JSON.stringify(model) })) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { out, graph: graph! };
}

const lines = (out: Record<string, unknown>) => (out.not_represented ?? []) as string[];
const UNDER_4 = { metric: 'Attrition', operator: '<' as const, value: 4, unit: '%', provenance: 'explicit' };
const UNDER_400K = { metric: 'Hiring cost', operator: '<' as const, value: 400000, unit: '£', provenance: 'explicit' };

describe('a strict bound the user stated is said when it is widened', () => {
  it('RED: "under 4%" — the value is verbatim, the operator widens, and the user is told exactly what that means', async () => {
    const { out, graph } = await build(hiring([UNDER_4]));
    expect(graph.goal_constraints?.find((c) => c.node_id === 'attrition')).toMatchObject({ operator: '<=', value: 4 });
    const said = lines(out).filter((s) => s.includes('Attrition'));
    expect(said, JSON.stringify(lines(out))).toEqual([
      'You said Attrition under 4%, but the model can only hold "at most 4%", so exactly 4% counts as meeting it.',
    ]);
  });

  it('RED: each strict bound gets its own sentence ("under £400k" too) — never merged, never dropped', async () => {
    const { out } = await build(hiring([UNDER_4, UNDER_400K]));
    expect(lines(out).filter((s) => s.startsWith('You said Hiring cost under'))).toEqual([
      'You said Hiring cost under £400000, but the model can only hold "at most £400000", so exactly £400000 counts as meeting it.',
    ]);
    expect(lines(out).filter((s) => s.startsWith('You said Attrition under'))).toHaveLength(1);
  });

  it('RED: a strict LOWER bound is said as "at least"', async () => {
    const { out } = await build(hiring([{ ...UNDER_4, operator: '>' }]));
    expect(lines(out)).toContain('You said Attrition over 4%, but the model can only hold "at least 4%", so exactly 4% counts as meeting it.');
  });

  it('CONTROL: a non-strict bound ("at most 4%") is not widened, so nothing is said', async () => {
    const { out } = await build(hiring([{ ...UNDER_4, operator: '<=' }]));
    expect(lines(out).filter((s) => s.includes('Attrition') && s.includes('counts as meeting'))).toEqual([]);
  });

  it('CONTROL: a bound Olumi proposed is said as Olumi\'s, never "You said"', async () => {
    const { out } = await build(hiring([{ ...UNDER_4, provenance: 'ai_proposed' }]));
    expect(lines(out).filter((s) => s.startsWith('You said'))).toEqual([]);
    expect(lines(out)).toContain('Olumi proposed Attrition under 4%, but the model can only hold "at most 4%", so exactly 4% counts as meeting it.');
  });
});
