import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { encodeOptionInterventionsForEdit } from '../../../../orchestrator/tools/encode-option-interventions.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import * as census from '../../olumi-estimates-feeding-result.js';
import { actionFactsOf, type ActionRead } from '../state.js';

function graph(source?: string) {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'MRR' },
      { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: 'GBP', source: 'user_edited' } },
      { id: 'raise', kind: 'option', label: 'Raise price', interventions: { price: { value: 0.59, raw_value: 59, unit: 'GBP', ...(source === undefined ? {} : { source }) } } },
    ],
    edges: [{ from: 'price', to: 'goal', exists_probability: 1, strength: { mean: 0.5, std: 0.1 }, effect_direction: 'positive' }],
  };
}

function readSettings(input: unknown) {
  const cold = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(input))));
  const hash = computeAnalysisAffectingGraphHash(cold);
  if (hash === null) throw new Error('Expected graph hash');
  const read: ActionRead = {
    scenarioId: '7d2e3f40-5b6c-4d7e-8f90-a1b2c3d4e5f6', graph: cold, graphHash: hash,
    analysisState: { run_state: { kind: 'complete_current', computed_at: '2026-10-07T12:00:00.000Z' }, usable_for_chips: true,
      leader_claim: { permitted: false, withheld_reason: 'goal_path_unsized' } },
    analysisReady: { status: 'ready', may_run: true },
    analysisResult: { type: 'analysis_result', computed_against_hash: hash, data: {} },
  };
  // Observe the actual state reader's inputs to its existing census; no replacement classifier.
  const spy = vi.spyOn(census, 'olumiEstimatesFeedingResult');
  const facts = actionFactsOf(read);
  expect(facts.readable).toBe(true);
  expect(facts.runBound).toBe(true);
  expect(spy).toHaveBeenCalledOnce();
  return { settings: spy.mock.calls[0]![0].optionSettings, cold, facts };
}

afterEach(() => vi.restoreAllMocks());

describe('action readback keeps intervention authorship honest before source relaxation', () => {
  it('source-less native quantity survives reload as unknown, never user or AI', () => {
    const { settings, cold, facts } = readSettings(graph());
    expect(settings).toStrictEqual([{ id: 'raise:price', label: 'Price under Raise price', authorship: 'unknown' }]);
    const cell = cold.nodes.find(n => n.id === 'raise')!.interventions!.price;
    expect(cell).toMatchObject({ value: 0.59, raw_value: 59, unit: 'GBP' });
    expect(cell).not.toHaveProperty('source');
    expect(facts.olumiEstimates?.count).toBe(0);
  });

  it.each([['brief_extraction', 'user'], ['user_specified', 'user'], ['cee_hypothesis', 'olumi_estimate']])(
    'preserves %s through the existing state reader', (source, authorship) => {
      const { settings } = readSettings(graph(source));
      expect(settings).toStrictEqual([{ id: 'raise:price', label: 'Price under Raise price', authorship }]);
    },
  );

  it('an exact human-approved cell stays user-owned through the existing encoder and reload', () => {
    const approved = encodeOptionInterventionsForEdit(graph(), new Set(['raise']), undefined, [{ optionId: 'raise', factorId: 'price' }]);
    const { settings, cold } = readSettings(approved.graph);
    expect(settings).toStrictEqual([{ id: 'raise:price', label: 'Price under Raise price', authorship: 'user' }]);
    expect(cold.nodes.find(n => n.id === 'raise')!.interventions!.price).toMatchObject({ value: 0.59, raw_value: 59, unit: 'GBP', source: 'user_specified' });
  });

  it('a junk source gets no user-authorship fact and leaves its native quantity untouched', () => {
    const { settings, cold } = readSettings(graph('not_a_source'));
    expect(settings).toStrictEqual([]);
    expect(cold.nodes.find(n => n.id === 'raise')!.interventions!.price).toMatchObject({ value: 0.59, raw_value: 59, source: 'not_a_source' });
  });
});
