/**
 * RT-10 (DL spec 3): Compare binds a saved version to its Run through `bindVersionResults`, which reuses the Run-snapshot
 * goal check. A Run that SENT no direction on a version whose graph now sends `minimise` would show the upside-down
 * order in Compare, so it is refused (`incompatible_results`); the same version with a Run that sent `minimise` binds,
 * and a held floor that sends nothing then and now binds.
 */
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { resolveGoalDirection } from '../../goal-target/goal-direction.js';
import { bindVersionResults } from '../version-result-binding.js';
import { FIX_SCENARIO, versionRecord } from './fixtures.js';
import { FROM, factSet, savedRun } from './version-result-fixtures.js';

type Rec = Record<string, any>;
const AT = '2026-10-05T10:41:07.000Z';
// The served pre-fix B2 goal (churn fixture): `<` beside a typed LEVEL target of 2 %.
const versionHolding = (goal_direction: '<' | '>=') => {
  const graph = structuredClone(FROM.graph) as Rec;
  Object.assign(graph.nodes.find((n: Rec) => n.id === 'n_revenue'), {
    goal_direction, goal_threshold_frame: 'level', goal_threshold_raw: 2, goal_threshold_unit: '%',
  });
  return versionRecord(GraphStateIngressSchema.parse(graph));
};
const runSent = (version: ReturnType<typeof versionHolding>, id: string, direction?: 'minimise'): HandlerFact => {
  const run = savedRun(version, id, AT) as unknown as { result: { input_snapshot: { goal: Rec } } };
  if (direction !== undefined) run.result.input_snapshot.goal.direction = direction;
  return run as unknown as HandlerFact;
};
const bind = (version: ReturnType<typeof versionHolding>, run: HandlerFact) =>
  bindVersionResults({ scenarioId: FIX_SCENARIO, from: version, to: version, factSet: factSet([run]) });

describe('RT-10 — Compare refuses a saved version whose Run sent a direction the version no longer sends', () => {
  it('precondition: the held ceiling version sends minimise; the floor version sends nothing', () => {
    expect(resolveGoalDirection(versionHolding('<').graph, 'n_revenue')?.direction).toBe('minimise');
    expect(resolveGoalDirection(versionHolding('>=').graph, 'n_revenue')).toBeUndefined();
  });

  it('a Run that sent nothing → unavailable (incompatible_results)', () => {
    const version = versionHolding('<');
    expect(bind(version, runSent(version, 'pre-fix'))).toEqual({ kind: 'unavailable', reason: 'incompatible_results' });
  });

  it('CONTRAST: the rerun that sent minimise binds', () => {
    const version = versionHolding('<');
    expect(bind(version, runSent(version, 'rerun', 'minimise')))
      .toMatchObject({ kind: 'shared', recordedRun: { run_id: 'rerun' } });
  });

  it('CONTRAST: a held floor that sent nothing binds', () => {
    const version = versionHolding('>=');
    expect(bind(version, runSent(version, 'floor'))).toMatchObject({ kind: 'shared', recordedRun: { run_id: 'floor' } });
  });
});
