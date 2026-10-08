/**
 * ⭐ A2 — "UNDER 4%" IS KEPT AS THE USER SAID IT, BESIDE THE ENGINE'S "<=" (DL #72 5861407189; MG 5861400141).
 *
 * Paul's brief A says "keeping monthly churn under 4%". The drafter types that `<`. The store's comparator is
 * `>=`/`<=` only, and widening that enum is not an option: `GraphV3.safeParse` fails the WHOLE graph on an unknown
 * operator (Canonical 5860723311), and PLoT's preflight refuses any other operator. So the row keeps `operator: '<='`
 * for the engine and gains `operator_as_stated: '<'` beside it. Admission writes it from the TYPED operator (never
 * from words) and no longer records the strictness as a loss. What the Agent's model reads says "less than 4%". The
 * PLoT-bound request still carries `<=` only.
 *
 * Every row is bound by identity: the stored row by its `constraint_id`, the Agent's view by the limit's `on` label
 * beside a contrast limit on another node, and the PLoT row by its `constraint_id`.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import type { CandidateModel } from '../admit-model.js';
import { admitCandidateConstraints, type CandidateConstraint } from '../admit-constraint.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { GoalConstraintSchema } from '../../../schemas/assist.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot, type ScenarioReader } from '../../tools/handlers/run-analysis.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

type Rec = Record<string, unknown>;
const SCENARIO = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r-a2' };
const BRIEF_A = 'Given our goal of reaching £100k MRR within 12 months [Currently 75k] while keeping monthly churn UNDER 4%, '
  + 'should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';
const BRIEF_AT_MOST = BRIEF_A.replace('UNDER 4%', 'at most 4%');

/** The live 22 Sep builder capture (`fixtures/faithful.json`): `monthly churn < 4 %`, explicit — not authored here. */
const captured = (JSON.parse(readFileSync(new URL('./fixtures/faithful.json', import.meta.url), 'utf8')) as { constraints: CandidateConstraint[] }).constraints;

/** Paul's brief A as the drafter types it: the churn limit carries `operator`; a price cap is the contrast limit. */
function candidate(churnOperator: CandidateConstraint['operator'], churnValue = 4): CandidateModel {
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 100000, unit: 'GBP', horizon_months: 12,
      provenance: 'explicit', baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [
      { metric: 'Monthly churn', operator: churnOperator, value: churnValue, unit: '%', provenance: 'explicit', frame: 'level' },
      { metric: 'Pro plan price', operator: '<=', value: 100, unit: 'GBP', provenance: 'explicit', frame: 'level' },
    ],
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

/**
 * Build through the real `buildModelFromBrief`, store the registered bytes as the store would (persisted form, then a
 * cold `GraphV3` parse), and return the churn row found by its `constraint_id` (the churn node's id, `<=`).
 */
async function build(brief: string, churnOperator: CandidateConstraint['operator'], churnValue = 4) {
  let stored: Rec | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = JSON.parse(JSON.stringify(GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph)))) as Rec;
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(candidate(churnOperator, churnValue)) });
  const result = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 300)).toBe(true);
  const cold = GraphV3.parse(stored) as unknown as { nodes: Rec[]; goal_constraints?: Rec[] };
  const churnNode = cold.nodes.find((n) => n.label === 'Monthly churn');
  expect(churnNode, 'the churn node is in the stored model').toBeDefined();
  const bound = churnOperator.startsWith('>') ? '>=' : '<=';
  const churnId = `agent-lane:${String(churnNode!.id)}:${bound}`;
  const churn = (cold.goal_constraints ?? []).find((c) => c.constraint_id === churnId);
  expect(churn, `the churn limit is stored under ${churnId}`).toBeDefined();
  return { stored: stored!, cold, churn: churn!, said: ((result.not_represented ?? []) as string[]).join(' · ') };
}

/** What the Agent's model reads for limits: `get_canonical_state` over the STORED bytes (the read route returns them raw). */
async function agentLimits(graph: unknown): Promise<Rec[]> {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  const r = await createAgentCapabilities(d, new ProposalStore()).getCanonicalState(ctx) as { limits?: Rec[] };
  return r.limits ?? [];
}

const nodeIdFor = (metric: string) => (metric.toLowerCase() === 'monthly churn' ? 'monthly_churn' : metric === 'Gross margin' ? 'gross_margin' : undefined);

describe('R1 — Paul\'s brief A ("under 4%", typed "<") is stored as {"<=", as stated "<"}', () => {
  it('R1: the stored churn row (by constraint_id) is {operator "<=", operator_as_stated "<", value 4}, through a cold GraphV3 parse', async () => {
    const { churn } = await build(BRIEF_A, '<');
    expect(churn.operator).toBe('<=');
    expect(churn.operator_as_stated).toBe('<');
    expect(churn.value, 'the user\'s number is never moved').toBe(4);
  });

  it('R1: admission of the live capture writes the field and records NO strictness loss', () => {
    expect(captured[0]!.operator, 'control: the capture is the strict case').toBe('<');
    const r = admitCandidateConstraints(captured, nodeIdFor);
    expect(r.constraints).toHaveLength(1);
    expect(r.constraints[0]).toMatchObject({ constraint_id: 'agent-lane:monthly_churn:<=', operator: '<=', operator_as_stated: '<', value: 4 });
    expect(r.loss.filter((l) => l.field_path.endsWith('.operator')), 'strictness is held, not lost').toEqual([]);
  });

  it('R1: the build no longer tells the Agent the limit is "held as at most"', async () => {
    const { said } = await build(BRIEF_A, '<');
    expect(said).not.toMatch(/strict limit|held as "at most/);
  });
});

describe('R2 — "at most 4%" (typed "<=") carries no operator_as_stated', () => {
  it('R2: the stored churn row has operator "<=" and NO operator_as_stated key', async () => {
    const { churn } = await build(BRIEF_AT_MOST, '<=');
    expect(churn.operator).toBe('<=');
    expect(churn).not.toHaveProperty('operator_as_stated');
  });

  it('R2: the non-strict contrast limit in the SAME build (price ≤ 100) carries none either', async () => {
    const { cold } = await build(BRIEF_A, '<');
    const price = (cold.goal_constraints ?? []).find((c) => c.label === 'Pro plan price');
    expect(price, 'the contrast limit is stored').toBeDefined();
    expect(price).not.toHaveProperty('operator_as_stated');
  });

  it('R2: typed "<=" beside the word "under" is not strict — the TYPED operator decides, never the words', async () => {
    const { churn } = await build(BRIEF_A, '<=');
    expect(churn).not.toHaveProperty('operator_as_stated');
  });
});

describe('R3 — a strict floor (typed ">") is stored as {">=", as stated ">"}', () => {
  it('R3: admission writes {operator ">=", operator_as_stated ">"} with no loss, and GoalConstraintSchema keeps it', () => {
    const r = admitCandidateConstraints(
      [{ metric: 'Gross margin', operator: '>', value: 20, unit: '%', provenance: 'explicit', frame: 'level' }], nodeIdFor);
    expect(r.constraints[0]).toMatchObject({ constraint_id: 'agent-lane:gross_margin:>=', operator: '>=', operator_as_stated: '>' });
    expect(r.loss.filter((l) => l.field_path.endsWith('.operator'))).toEqual([]);
    expect(GoalConstraintSchema.parse(r.constraints[0])).toMatchObject({ operator: '>=', operator_as_stated: '>' });
  });

  it('R3: through a build and a cold GraphV3 parse', async () => {
    const { churn } = await build(BRIEF_A, '>', 1);
    expect(churn).toMatchObject({ operator: '>=', operator_as_stated: '>', value: 1 });
  });
});

const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
const STRICT_ID = 'agent-lane:fac_churn:<=';
const strictRow: Rec = {
  constraint_id: STRICT_ID, node_id: 'fac_churn', operator: '<=', operator_as_stated: '<', value: 4, unit: '%',
  value_frame: 'level', provenance: 'explicit', label: 'Monthly churn',
};
function runGraph(pinChurnAt?: number) {
  const pin = pinChurnAt === undefined ? {} : { fac_churn: pinChurnAt };
  return GraphV3.parse({
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: 0.49, ...pin } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: 0.59 } },
      { id: 'fac_price', kind: 'factor', label: 'Pro plan price' },
      { id: 'fac_churn', kind: 'factor', label: 'Monthly churn', scale_frame: 100,
        observed_state: { value: 0.03, raw_value: 3, unit: '%', source: 'cee_inference', extractionType: 'inferred' } },
    ],
    edges: [
      { from: 'fac_price', to: 'goal_mrr', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'fac_price', to: 'fac_churn', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'fac_churn', to: 'goal_mrr', strength: { mean: -0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    ],
  });
}
function invocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO, request_id: 'req-a2',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-a2', signal: new AbortController().signal, orientationText: '',
  } as HandlerInvocation;
}
/** The PLoT request `run_analysis` sends, through the real handler; the stored rows must come back untouched. */
async function plotLimit(rows: Rec[], pinChurnAt?: number): Promise<Rec> {
  const graph = runGraph(pinChurnAt);
  const goal_constraints = rows.map((r) => JSON.parse(JSON.stringify(r)) as Rec);
  const before = JSON.stringify(goal_constraints);
  const snapshot: RunAnalysisScenarioSnapshot = {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Keep £49', interventions: { fac_price: 0.49, ...(pinChurnAt === undefined ? {} : { fac_churn: pinChurnAt }) } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Raise to £59', interventions: { fac_price: 0.59 } },
    ],
    goal_node_id: 'goal_mrr', goal_constraints, rawPersistedGraph: graph,
  };
  const scenarioReader: ScenarioReader = vi.fn(() => Promise.resolve(snapshot));
  let captured: Rec | undefined;
  const run = vi.fn((payload: Rec) => { captured = payload; return Promise.resolve(JSON.parse(JSON.stringify(happyFixture)) as V2RunResponseEnvelope); });
  await createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient, scenarioReader })(invocation());
  expect(run).toHaveBeenCalledOnce();
  expect(JSON.stringify(goal_constraints), 'the stored rows are never touched').toBe(before);
  const limit = (captured!.goal_constraints as Rec[]).find((c) => c.constraint_id === STRICT_ID);
  expect(limit, 'the churn limit reaches PLoT (found by its id)').toBeDefined();
  return limit!;
}

describe('R4 — CEE\'s own read-back keeps the field; the PLoT-bound request carries "<=" only', () => {
  it('R4: the stored bytes read back into the Agent\'s view with operator "<=" AND operator_as_stated "<"', async () => {
    const { stored } = await build(BRIEF_A, '<');
    const churn = (await agentLimits(stored)).find((l) => l.on === 'Monthly churn');
    expect(churn).toMatchObject({ operator: '<=', operator_as_stated: '<', value: 4 });
  });

  it('R4: the PLoT-bound row (by constraint_id) is {operator "<=", value 4} with NO operator_as_stated', async () => {
    const limit = await plotLimit([strictRow]);
    expect(limit).toMatchObject({ operator: '<=', value: 4, unit: '%' });
    expect(limit).not.toHaveProperty('operator_as_stated');
  });

  it('R4 (disclosed, not modelled): an option that PINS churn at exactly 4% still meets "<= 4" on the engine — the one case where "<" and "<=" differ', async () => {
    // Over continuous draws P(X < 4) = P(X <= 4). A level pinned exactly at the threshold is the exception: the engine
    // (PLoT/ISL, untouched) still receives "<=" and counts exactly 4% as meeting the limit. This row pins that the wire
    // is unchanged for that case; the difference is disclosed here and at `withholdStatedOperator`, not modelled.
    const limit = await plotLimit([strictRow], 0.04);
    expect(limit).toMatchObject({ operator: '<=', value: 4 });
    expect(limit).not.toHaveProperty('operator_as_stated');
  });
});

describe('R5 — the Agent\'s model-facing limit says it as the user did', () => {
  it('R5: "under 4%" reaches the Agent as "less than 4%", never "at most"; the contrast price cap says "at most 100"', async () => {
    const { stored } = await build(BRIEF_A, '<');
    const limits = await agentLimits(stored);
    const churn = limits.find((l) => l.on === 'Monthly churn');
    const price = limits.find((l) => l.on === 'Pro plan price');
    expect(churn?.in_words).toBe('less than 4%');
    expect(JSON.stringify(churn)).not.toMatch(/at most/);
    expect(price?.in_words).toBe('at most 100 GBP');
  });

  it('R5: "at most 4%" reaches the Agent as "at most 4%"', async () => {
    const { stored } = await build(BRIEF_AT_MOST, '<=');
    const churn = (await agentLimits(stored)).find((l) => l.on === 'Monthly churn');
    expect(churn?.in_words).toBe('at most 4%');
    expect(churn).not.toHaveProperty('operator_as_stated');
  });

  it('R5: a strict floor reaches the Agent as "more than"', async () => {
    const { stored } = await build(BRIEF_A, '>', 1);
    const churn = (await agentLimits(stored)).find((l) => l.on === 'Monthly churn');
    expect(churn?.in_words).toBe('more than 1%');
  });

  it('R5: a stamp that contradicts the held comparator (">" on "<=") is never said — the held one is', async () => {
    const { stored } = await build(BRIEF_AT_MOST, '<=');
    const rows = (stored.goal_constraints as Rec[]).map((c) => (c.label === 'Monthly churn' ? { ...c, operator_as_stated: '>' } : c));
    const churn = (await agentLimits({ ...stored, goal_constraints: rows })).find((l) => l.on === 'Monthly churn');
    expect(churn?.in_words).toBe('at most 4%');
    expect(churn).not.toHaveProperty('operator_as_stated');
  });
});

describe('R5-S4 — a limit stated as a CHANGE from today reaches the Agent as the change (R1 S4-core)', () => {
  it('R5-S4: change_rel 0.1 is said "no more than 10% above today" with its frame, never "at most 0.1"; the level price cap is unchanged', async () => {
    const { stored } = await build(BRIEF_AT_MOST, '<=');
    const rows = (stored.goal_constraints as Rec[]).map((c) => (c.label === 'Monthly churn'
      ? (({ unit: _u, ...rest }) => ({ ...rest, value: 0.1, value_frame: 'change_rel' }))(c as Rec & { unit?: unknown })
      : c));
    const limits = await agentLimits({ ...stored, goal_constraints: rows });
    const churn = limits.find((l) => l.on === 'Monthly churn');
    expect(churn).toMatchObject({ frame: 'change_rel', value: 0.1, in_words: 'no more than 10% above today' });
    expect(JSON.stringify(churn)).not.toMatch(/at most 0\.1/);
    expect(limits.find((l) => l.on === 'Pro plan price')?.in_words, 'CONTROL: a level is said exactly as before').toBe('at most 100 GBP');
  });
});

describe('R6 — an older reader (a schema without the field) strips it and the graph stays valid', () => {
  it('R6: parsed by a GraphV3 whose constraint schema lacks operator_as_stated, the graph is valid and the row keeps "<="', async () => {
    const { stored } = await build(BRIEF_A, '<');
    const OldGoalConstraint = GoalConstraintSchema.omit({ operator_as_stated: true });
    const OldGraphV3 = GraphV3.extend({ goal_constraints: z.array(OldGoalConstraint).optional() });
    const parsed = OldGraphV3.safeParse(stored);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
    const rows = (parsed.success ? parsed.data.goal_constraints ?? [] : []) as Rec[];
    const churn = rows.find((c) => c.label === 'Monthly churn');
    expect(churn).toMatchObject({ operator: '<=', value: 4 });
    expect(churn).not.toHaveProperty('operator_as_stated');
  });

  it('PIN: the store\'s comparator enum is NOT widened (a "<" operator still fails GraphV3 — Canonical 5860723311)', () => {
    expect([...GoalConstraintSchema.shape.operator.options]).toEqual(['>=', '<=']);
    expect(GoalConstraintSchema.safeParse({ ...strictRow, operator: '<' }).success).toBe(false);
  });
});
