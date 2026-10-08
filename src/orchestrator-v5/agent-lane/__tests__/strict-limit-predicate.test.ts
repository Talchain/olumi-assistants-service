import { describe, expect, it } from 'vitest';
import * as limitWords from '../limit-operator-words.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

type Operator = '<' | '<=' | '>' | '>=';
type Predicate = (level: number, operator: Operator, threshold: number) => boolean | 'at_threshold';
// Namespace lookup makes the missing shared predicate a RED assertion at the bound staging HEAD.
const predicate = (): Predicate => {
  expect(limitWords).toHaveProperty('meetsLimit');
  return (limitWords as unknown as { meetsLimit: Predicate }).meetsLimit;
};

describe('R6: one limit predicate, with the existing relative tie tolerance', () => {
  for (const [operator, below, at, above] of [
    ['<', true, 'at_threshold', false], ['<=', true, true, false],
    ['>', false, 'at_threshold', true], ['>=', false, true, true],
  ] as const) {
    it.each([[3.9, below], [4, at], [4.1, above]] as const)(`${operator} 4 at level %s`, (level, expected) => {
      expect(predicate()(level, operator, 4)).toBe(expected);
    });
  }
  it('tolerance: a float round-trip at the threshold is a tie for strict and inclusive operators', () => {
    expect(predicate()(4 + 2e-9, '<', 4)).toBe('at_threshold');
    expect(predicate()(4 + 2e-9, '<=', 4)).toBe(true);
    expect(predicate()(4 + 8e-9, '<=', 4)).toBe(false);
    expect(predicate()(0.04 - 5e-10, '<', 0.04)).toBe('at_threshold');
  });
  it('nonfinite inputs never establish that a limit is met', () => {
    for (const operator of ['<', '<=', '>', '>='] as const) {
      expect(predicate()(NaN, operator, 4)).toBe(false);
      expect(predicate()(4, operator, Infinity)).toBe(false);
    }
  });
});

const LIMIT_ID = 'agent-lane:monthly_churn_rate:<=';
type Rec = Record<string, unknown>;
async function modelLimits(graph: Rec): Promise<Rec[]> {
  const dispatch: InternalDispatch = async () => ({ status: 200, json: { graph, graph_hash: 'h-strict' } });
  const result = await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({
    scenario_id: '632b92b9-82df-4a46-933f-3a64e49004bd', authenticated_user_id: null, request_id: 'strict-test',
  });
  if (!Array.isArray(result.limits)) throw new Error('the model view did not carry limits');
  return result.limits as Rec[];
}

async function modelLimit(level: number | undefined, operatorAsStated?: '<', frame = 'level', raw = level, observed: Rec = {}, unit = '%', fixture: { nonRoot?: boolean; constraint?: Rec; goalNodeId?: string; retainedExcluded?: boolean } = {}) {
  const graph = {
    ...(fixture.goalNodeId === undefined ? {} : { goal_node_id: fixture.goalNodeId }),
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
      { id: 'monthly_churn_rate', kind: 'factor', label: 'Monthly churn rate', scale_frame: 100,
        ...(fixture.retainedExcluded ? { analysis_participation: 'retained_excluded' } : {}),
        ...(level === undefined ? {} : { observed_state: { value: level / 100, raw_value: raw, unit, source: 'user_override', ...observed } }) },
      ...(fixture.nonRoot ? [{ id: 'unchanged_parent', kind: 'factor', label: 'Customer experience' }] : []),
    ], edges: fixture.nonRoot ? [{ from: 'unchanged_parent', to: 'monthly_churn_rate', exists_probability: 1 }] : [],
    goal_constraints: [{ constraint_id: LIMIT_ID, node_id: 'monthly_churn_rate', label: 'Monthly churn rate',
      operator: '<=', ...(operatorAsStated === undefined ? {} : { operator_as_stated: operatorAsStated }),
      value: 4, unit, value_frame: frame, provenance: 'explicit', ...fixture.constraint }],
  };
  const limits = await modelLimits(graph);
  expect(limits).toHaveLength(1);
  const limit = limits.find((row) => row.constraint_id === LIMIT_ID && row.node_id === 'monthly_churn_rate');
  expect(limit, `identity-bound reply row ${LIMIT_ID}`).toBeDefined();
  return limit!;
}

describe('R2/R4/R5: the reply reads a computed fact for the stored strict churn limit', () => {
  it('R2: keeping monthly churn UNDER 4% at today = 4% is at_threshold (not met)', async () => {
    const limit = await modelLimit(4, '<');
    expect(limit).toMatchObject({ operator: '<=', operator_as_stated: '<', today_within_limit: 'at_threshold' });
    expect(limit.today_within_limit_instruction).toMatch(/at_threshold.*does not meet/);
    expect(limit.today_within_limit_instruction).toMatch(/do no arithmetic/i);
  });
  it('R4: at most 4% includes today = 4%', async () => {
    expect(await modelLimit(4)).toMatchObject({ operator: '<=', today_within_limit: true });
  });
  it.each([[3.9, true], [4.1, false]] as const)('R5: under 4%% at today = %s agrees with the shared predicate', async (level, expected) => {
    expect((await modelLimit(level, '<')).today_within_limit).toBe(expected);
  });
  it('the reply uses the same normalized tolerance as analysis', async () => {
    expect((await modelLimit(4 - 5e-8, '<')).today_within_limit).toBe('at_threshold');
  });
  it('no current level, a change frame, or an unproven frame supplies no today fact', async () => {
    expect(await modelLimit(undefined, '<')).not.toHaveProperty('today_within_limit');
    expect(await modelLimit(4, '<', 'change_rel')).not.toHaveProperty('today_within_limit');
    expect(await modelLimit(4, '<', 'level', 40)).not.toHaveProperty('today_within_limit');
  });
  it.each([
    [3.9, 0.04, 'at_threshold'],
    [4, 0.039, true],
  ] as const)('non-root effective today uses preserved baseline: value %s%%, baseline %s', async (level, baseline, expected) => {
    expect((await modelLimit(level, '<', 'level', level, { baseline }, '%', { nonRoot: true })).today_within_limit).toBe(expected);
  });
  it.each([
    [4.1, 0.04, '<', false],
    [4.1, 0.04, undefined, false],
    [4, 0.041, '<', 'at_threshold'],
    [4, 0.041, undefined, true],
  ] as const)('ROOT RED: value %s%% overrides stale baseline %s for stated %s', async (level, baseline, operator, expected) => {
    const limit = await modelLimit(level, operator, 'level', level, { baseline });
    expect(limit, `identity-bound root ${LIMIT_ID} on monthly_churn_rate`).toMatchObject({
      constraint_id: LIMIT_ID, node_id: 'monthly_churn_rate', today_within_limit: expected,
    });
  });
  it.each(['<', undefined] as const)('PERIOD RED: a relabelled annual %% limit supplies no monthly today fact (%s)', async (operator) => {
    const limit = await modelLimit(3, operator, 'level', 3, { baseline: 0.10 }, '% per month', {
      nonRoot: true,
      constraint: { value: 10, unit: '%', provenance_unit_relabelled: {
        rule: 'rule1-limit-period', pre_normalisation_value: 10, pre_normalisation_unit: '% per year',
      } },
    });
    expect(limit).toMatchObject({ constraint_id: LIMIT_ID, node_id: 'monthly_churn_rate', value: 10 });
    expect(limit, 'annual constraint is not a fact about monthly churn, even beside a threshold baseline').not.toHaveProperty('today_within_limit');
    expect(limit).not.toHaveProperty('today_within_limit_instruction');
  });
  it('a stored limit used for positioning is not today\'s measurement or a does-not-meet instruction', async () => {
    const limit = await modelLimit(4, '<', 'level', 4, { stated_role: 'constraint' });
    expect(limit).not.toHaveProperty('today_within_limit');
    expect(limit).not.toHaveProperty('today_within_limit_instruction');
  });
  it('READER ONLY: a retained-excluded non-root node supplies no today fact or instruction', async () => {
    const limit = await modelLimit(4, '<', 'level', 4, {}, '%', { nonRoot: true, retainedExcluded: true });
    expect(limit).not.toHaveProperty('today_within_limit');
    expect(limit).not.toHaveProperty('today_within_limit_instruction');
  });
  it('AUTHOR RED: an unattested current value supplies no today fact or instruction', async () => {
    const limit = await modelLimit(4, '<', 'level', 4, { source: undefined });
    expect(limit).not.toHaveProperty('today_within_limit');
    expect(limit).not.toHaveProperty('today_within_limit_instruction');
  });
  it('GOAL ID RED: an explicitly selected non-root factor goal supplies no carried today fact', async () => {
    const limit = await modelLimit(4, '<', 'level', 4, {}, '%', {
      nonRoot: true, goalNodeId: 'monthly_churn_rate',
    });
    expect(limit).toMatchObject({ constraint_id: LIMIT_ID, node_id: 'monthly_churn_rate' });
    expect(limit, 'the explicit goal id is the same input the analysis baseline carrier reads').not.toHaveProperty('today_within_limit');
    expect(limit).not.toHaveProperty('today_within_limit_instruction');
  });
  it.each([
    ['missing own-unit raw measurement', { raw_value: undefined }],
    ['own-unit value/raw pair on different scales', { raw_value: 40 }],
  ] as const)('%s supplies no today fact or instruction', async (_name, observed) => {
    const limit = await modelLimit(4, '<', 'level', 4, observed, 'GBP');
    expect(limit).not.toHaveProperty('today_within_limit');
    expect(limit).not.toHaveProperty('today_within_limit_instruction');
  });
  it('an attested own-unit current value retains the strict-tie fact', async () => {
    expect(await modelLimit(4, '<', 'level', 4, {}, 'GBP')).toMatchObject({ today_within_limit: 'at_threshold' });
  });
});

describe('reply facts retain the stored node and constraint identities', () => {
  it('same label/operator/value rows each receive their own current-level fact', async () => {
    const graph = {
      nodes: [
        { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
        ...([['churn_tie', 0.04], ['churn_inside', 0.039]] as const).map(([id, value]) => ({
          id, kind: 'factor', label: 'Monthly churn',
          observed_state: { value, raw_value: Number(value) * 100, cap: 100, unit: '%', source: 'user_override' },
        })),
      ], edges: [],
      goal_constraints: ['churn_inside', 'churn_tie'].map((node_id) => ({
        constraint_id: `limit_${node_id}`, node_id, label: 'Monthly churn', operator: '<=', operator_as_stated: '<',
        value: 4, unit: '%', value_frame: 'level', provenance: 'explicit',
      })),
    };
    const limits = await modelLimits(graph);
    expect(limits).toHaveLength(2);
    for (const [node_id, fact] of [['churn_tie', 'at_threshold'], ['churn_inside', true]] as const) {
      const limit = limits.find((row) => row.node_id === node_id && row.constraint_id === `limit_${node_id}`);
      expect(limit, `identity-bound reply fact for limit_${node_id}`).toMatchObject({
        node_id, constraint_id: `limit_${node_id}`, today_within_limit: fact,
      });
    }
  });
});
