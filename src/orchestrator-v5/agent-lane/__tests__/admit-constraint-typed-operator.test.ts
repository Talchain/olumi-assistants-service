/**
 * ⭐ "UNDER 4%" IS A STRICT BOUND, AND ONLY THE TYPED OPERATOR SAYS SO (Codex PJ-A2 row 14; MG's drafting half of G1).
 *
 * The drafter emits the operator TYPED (`buildCandidateSchema`: `>= <= > <`); admission never reads a word for it. It
 * keeps the typed operator wherever the canonical store can hold it (`admittedOperator`, whose list is
 * `GoalConstraintSchema`'s own). Today the store's `operator` holds only `>=` / `<=`, so "under 4%" is held as
 * `operator: "<="` with `operator_as_stated: "<"` beside it (A2, DL #72 5861407189): nothing is lost, and nothing is
 * said as a widening. The `operator` enum itself moves only WITH PLoT (whose preflight refuses any other operator) —
 * pinned below so that move cannot happen unseen. A2's own rows: `limit-operator-as-stated.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import type { CandidateModel } from '../admit-model.js';
import {
  CANONICAL_CONSTRAINT_OPERATORS,
  admitCandidateConstraints,
  admittedOperator,
  type CandidateConstraint,
} from '../admit-constraint.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

type Rec = Record<string, unknown>;
const SCENARIO = '14141414-1414-4141-8141-141414141414';
const STRICT_BRIEF = 'Given our goal of reaching £100k MRR within 12 months [Currently 75k] while keeping monthly churn under 4%, '
  + 'should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';
const AT_MOST_BRIEF = STRICT_BRIEF.replace('under 4%', 'at most 4%');
const WIDER_STORE = ['>=', '<=', '>', '<'] as const;
const nodeIdFor = (metric: string) => (metric === 'Monthly churn' ? 'monthly_churn' : undefined);
const churn = (operator: CandidateConstraint['operator']): CandidateConstraint =>
  ({ metric: 'Monthly churn', operator, value: 4, unit: '%', provenance: 'explicit', frame: 'level' });

function candidate(operator: CandidateConstraint['operator']): CandidateModel {
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 100000, unit: 'GBP', horizon_months: 12,
      provenance: 'explicit', baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [{ metric: 'Monthly churn', operator, value: 4, unit: '%', provenance: 'explicit', frame: 'level' }],
    options: [
      { label: 'Increase the Pro plan price to £59', provenance: 'explicit', is_status_quo: false, changes: ['Pro plan price'],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
      { label: 'Keep the Pro plan price at £49', provenance: 'explicit', is_status_quo: true, changes: ['Pro plan price'],
        interventions: [{ factor_label: 'Pro plan price', value: 49, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 100 },
      { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: null, unit: '%', provenance: 'explicit', plausible_max: 100 },
    ],
    risks: [], outcomes: [],
    links: [
      { from: 'Pro plan price', to: 'MRR', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
      { from: 'Pro plan price', to: 'Monthly churn', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
      { from: 'Monthly churn', to: 'MRR', direction: 'negative', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
    ],
    identities: [], unknowns: [], decision_question: null,
  } as unknown as CandidateModel;
}

async function build(brief: string, operator: CandidateConstraint['operator']): Promise<{ limits: Rec[]; said: string }> {
  let stored: string | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = JSON.stringify(GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph)));
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(candidate(operator)) });
  const result = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 300)).toBe(true);
  const cold = GraphV3.parse(JSON.parse(stored!));
  return { limits: (cold.goal_constraints ?? []) as unknown as Rec[], said: ((result.not_represented ?? []) as string[]).join(' · ') };
}


describe('the builder types the limit\'s operator; admission keeps it where the store can hold it', () => {
  it('the strict contract offers the strict operators, typed (the drafter says "<", no word is parsed)', () => {
    const limit = (buildCandidateSchema() as { properties: { constraints: { items: { properties: { operator: { enum: string[] } } } } } })
      .properties.constraints.items.properties.operator;
    expect(limit.enum).toEqual(['>=', '<=', '>', '<']);
  });

  it('⭐ a store that can hold "<" keeps "<" — nothing is widened and no loss is recorded', () => {
    for (const op of WIDER_STORE) expect(admittedOperator(op, WIDER_STORE), op).toBe(op);
    const r = admitCandidateConstraints([churn('<')], nodeIdFor, undefined, WIDER_STORE);
    expect(r.constraints[0]!.operator).toBe('<');
    expect(r.loss.filter((l) => l.field_path.endsWith('.operator'))).toEqual([]);
  });

  it('⛔ PIN: today\'s store holds only ">=" / "<=" — widen it only WITH PLoT (preflight-v2 VALID_OPERATORS refuses "<")', () => {
    expect([...CANONICAL_CONSTRAINT_OPERATORS]).toEqual(['>=', '<=']);
    expect(admittedOperator('<')).toBe('<=');
    expect(admittedOperator('>')).toBe('>=');
  });

  it('⭐ A2: "under 4%" typed "<" — held as "<=" WITH operator_as_stated "<", and no widening is said', async () => {
    const { limits, said } = await build(STRICT_BRIEF, '<');
    expect(limits).toHaveLength(1);
    expect(limits[0]!.operator).toBe('<=');
    expect(limits[0]!.operator_as_stated).toBe('<');
    expect(limits[0]!.value, 'the user\'s number is never moved to compensate').toBe(4);
    expect(said).not.toMatch(/strict limit/);
  });

  it('⭐ CONTRAST: "at most 4%" typed "<=" -> "<=", and nothing is said about strictness', async () => {
    const { limits, said } = await build(AT_MOST_BRIEF, '<=');
    expect(limits[0]!.operator).toBe('<=');
    expect(limits[0]).not.toHaveProperty('operator_as_stated');
    expect(said).not.toMatch(/strict limit/);
  });

  it('⭐ THE TYPED OPERATOR DECIDES, NOT THE WORDS: typed "<=" beside "under" is not strict; typed "<" beside "at most" is', async () => {
    expect((await build(STRICT_BRIEF, '<=')).limits[0]).not.toHaveProperty('operator_as_stated');
    expect((await build(AT_MOST_BRIEF, '<')).limits[0]!.operator_as_stated).toBe('<');
  });

  it('a limit Olumi proposed is never called the user\'s', () => {
    const r = admitCandidateConstraints([{ ...churn('<'), provenance: 'ai_proposed' }], nodeIdFor);
    expect(r.constraints[0]!.provenance).toBe('inferred');
  });

  it('a range on one node still names a floor and a cap, strict or not', () => {
    const r = admitCandidateConstraints([{ ...churn('>'), value: 1 }, churn('<')], nodeIdFor, undefined, WIDER_STORE);
    expect(r.constraints.map((c) => `${c.label} ${c.operator}`)).toEqual(['Monthly churn floor >', 'Monthly churn cap <']);
  });

  it('a limit read both ways is withheld, strict or not', () => {
    const r = admitCandidateConstraints([{ ...churn('>'), value: 5 }, churn('<')], nodeIdFor, undefined, WIDER_STORE);
    expect(r.constraints).toEqual([]);
    expect(r.loss.some((l) => l.field_path.endsWith('.bound_direction'))).toBe(true);
  });
});
