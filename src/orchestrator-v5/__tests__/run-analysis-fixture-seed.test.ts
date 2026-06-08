/**
 * CEE / Branch A fixture seed pass-through — config + reader behaviour.
 *
 * Env-gated, fixture-only deterministic analysis settings. When
 * `CEE_ANALYSIS_SEED` / `CEE_ANALYSIS_N_SAMPLES` are set, the scenario snapshot
 * built by `loadScenarioSnapshotForRunAnalysis` carries `seed` / `n_samples`,
 * which the run_analysis handler forwards to PLoT `/v2/run`. When UNSET (the
 * production default), the snapshot omits both keys, so the constructed
 * `/v2/run` body is byte-identical to today and PLoT keeps its random seed.
 *
 * The handler-side forwarding (snapshot.seed → plotPayload.seed) and the
 * round-trip into evidence (enrichment.meta.seed_used) are covered in
 * `tools/handlers/__tests__/run-analysis.test.ts`. This file pins the new
 * pieces: the config plumbing and the reader populating the snapshot.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { config, _resetConfigCache } from '../../config/index.js';
import { loadScenarioSnapshotForRunAnalysis } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// A minimal valid GraphV3 with a goal + two options so the reader can derive
// goal_node_id + options (mirrors the existing reader fixture).
const GRAPH = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Ship AI Features Within 6 Months' },
    { id: 'dec_1', kind: 'decision', label: 'Hiring Decision' },
    { id: 'opt_lead', kind: 'option', label: 'Hire Tech Lead', interventions: { fac_cost: 1, fac_velocity: 1 } },
    { id: 'opt_devs', kind: 'option', label: 'Hire Two Developers', interventions: { fac_cost: 0.6, fac_velocity: 0.7 } },
    { id: 'fac_cost', kind: 'factor', label: 'Hiring Cost', category: 'controllable', observed_state: { value: 120000, unit: 'GBP', extractionType: 'explicit', factor_type: 'cost' } },
    { id: 'fac_velocity', kind: 'factor', label: 'Team Velocity', category: 'controllable', observed_state: { value: 0.7, extractionType: 'inferred', factor_type: 'other' } },
    { id: 'out_delivery', kind: 'outcome', label: 'Feature Delivery Rate' },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_lead', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_1', to: 'opt_devs', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_lead', to: 'fac_cost', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_lead', to: 'fac_velocity', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_devs', to: 'fac_cost', strength: { mean: 0.6, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_devs', to: 'fac_velocity', strength: { mean: 0.7, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'fac_cost', to: 'out_delivery', strength: { mean: -0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
    { from: 'fac_velocity', to: 'out_delivery', strength: { mean: 0.75, std: 0.08 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'out_delivery', to: 'goal_1', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};

describe('CEE fixture analysis-seed pass-through — config + reader', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    delete process.env.CEE_ANALYSIS_SEED;
    delete process.env.CEE_ANALYSIS_N_SAMPLES;
    _resetConfigCache();
  });

  afterEach(() => {
    process.env = savedEnv;
    _resetConfigCache();
  });

  describe('config plumbing', () => {
    it('parses CEE_ANALYSIS_SEED / CEE_ANALYSIS_N_SAMPLES into config.cee when set', () => {
      process.env.CEE_ANALYSIS_SEED = '4242';
      process.env.CEE_ANALYSIS_N_SAMPLES = '1500';
      _resetConfigCache();
      expect(config.cee.analysisSeed).toBe(4242);
      expect(config.cee.analysisNSamples).toBe(1500);
    });

    it('leaves config.cee.analysisSeed / analysisNSamples undefined when env unset', () => {
      _resetConfigCache();
      expect(config.cee.analysisSeed).toBeUndefined();
      expect(config.cee.analysisNSamples).toBeUndefined();
    });

    it('treats a blank / whitespace env value as UNSET (NOT coerced to 0)', () => {
      // Some deploy systems materialise an unset var as "". z.coerce.number()
      // would turn "" into 0 and silently send seed:0 in production — the
      // preprocess guard maps blanks back to undefined so it stays omitted.
      process.env.CEE_ANALYSIS_SEED = '';
      process.env.CEE_ANALYSIS_N_SAMPLES = '   ';
      _resetConfigCache();
      expect(config.cee.analysisSeed).toBeUndefined();
      expect(config.cee.analysisNSamples).toBeUndefined();
    });
  });

  describe('reader populates snapshot from config', () => {
    it('SET → snapshot carries seed: 4242 and the configured n_samples', async () => {
      process.env.CEE_ANALYSIS_SEED = '4242';
      process.env.CEE_ANALYSIS_N_SAMPLES = '1500';
      _resetConfigCache();
      const store = createNoopSessionStore({ loadGraphResult: GRAPH });
      const snap = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, 'req-seed-set', store);
      expect(snap.seed).toBe(4242);
      expect(snap.n_samples).toBe(1500);
    });

    it('UNSET → snapshot OMITS seed and n_samples (production default unchanged)', async () => {
      _resetConfigCache();
      const store = createNoopSessionStore({ loadGraphResult: GRAPH });
      const snap = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, 'req-seed-unset', store);
      expect(snap.seed).toBeUndefined();
      expect(snap.n_samples).toBeUndefined();
      // The keys are OMITTED entirely (spread of `{}`), not present-as-undefined,
      // so the downstream `/v2/run` body stays byte-identical to today.
      expect('seed' in snap).toBe(false);
      expect('n_samples' in snap).toBe(false);
    });

    it('seed-only set → snapshot carries seed, still omits n_samples', async () => {
      process.env.CEE_ANALYSIS_SEED = '4242';
      _resetConfigCache();
      const store = createNoopSessionStore({ loadGraphResult: GRAPH });
      const snap = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, 'req-seed-only', store);
      expect(snap.seed).toBe(4242);
      expect('n_samples' in snap).toBe(false);
    });
  });
});
