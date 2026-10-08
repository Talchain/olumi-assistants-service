import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TYPED_RUN_PAYLOAD_PATHS, toTypedRunRows } from '../typed-run-rows.js';

type Json = Record<string, any>;
const captured = (path: string): Json => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')).j;
const succeeded = captured('../../agent-lane/__tests__/fixtures/cut9-prod-p1-2-7e3f8fb-readback-run1.json');
const secondSucceeded = captured('../../agent-lane/__tests__/fixtures/waveB5-t1b-3fce64f-readback-run1.json');
const withheld = captured('../../agent-lane/method-turn/__tests__/fixtures/w9b/C.json');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const migration = readFileSync(new URL('../../../../supabase/migrations/20261008170000_phase2_a_typed_runs.sql', import.meta.url), 'utf8');

/**
 * Real served captures supply every result, option, licence, run ID and timestamp.
 * Readback deliberately omits the persisted input_snapshot. This explicit TEST
 * upgrade supplies a schema-valid sentinel snapshot, not reconstructed historical
 * inputs. The unchanged missing-snapshot case below must quarantine. No capture
 * containing both a full RunAnalysisHandlerFact and its snapshot exists in-tree.
 */
function factFromRead(read: Json, includeTestSnapshot = true): Json {
  const result = read.analysis_result;
  return {
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: read.scenario_id,
      leading_option_id: result.leading_option_id,
      summary: result.summary,
      ...(result.constraint_verdict === undefined ? {} : { constraint_verdict: clone(result.constraint_verdict) }),
      ...(result.win_probabilities === undefined ? {} : { win_probabilities: clone(result.win_probabilities) }),
      enrichment: clone(result.enrichment),
      computed_at: read.analysis_state.run_state.computed_at,
      graph_hash_at_run: result.computed_against_hash,
      run_id: read.run_recording?.run_id ?? read.current_read.run_id,
      ...(includeTestSnapshot ? { input_snapshot: {
        snapshot_version: 1, sent_digest: 'a'.repeat(64), goal: null,
        options: result.enrichment.option_comparison.map((row: Json) => ({ option_id: row.option_id, settings: [] })),
        options_not_sent: [], factors: [], constraints: [], links: [],
      } } : {}),
    },
  };
}

function mapFact(fact: Json) {
  return toTypedRunRows(fact, { scenarioId: fact.result.scenario_id });
}

describe('toTypedRunRows — one frozen Run, independently quarantined', () => {
  it('pins the SQL trigger payload paths to the specification and captured Run fields', () => {
    const sqlPaths = [...migration.matchAll(/^-- payload_path: (.+)$/gm)].map(match => match[1]);
    expect(sqlPaths).toEqual(TYPED_RUN_PAYLOAD_PATHS);

    const fact = factFromRead(succeeded);
    const mapped = mapFact(fact);
    if (!('ok' in mapped)) throw new Error('quarantine' in mapped ? mapped.quarantine : 'unexpected legacy skip');
    expect(mapped.ok.run_id).toBe(fact.result.run_id);
    expect(mapped.ok.leading_option_id).toBe(fact.result.leading_option_id);
    expect(mapped.ok.constraint_may_name_leading_option).toBe(fact.result.constraint_verdict?.may_name_leading_option ?? null);
    expect(mapped.ok.computed_at).toBe(fact.result.computed_at);
    expect(mapped.ok.canonical_request_hash).toBe(fact.result.input_snapshot.sent_digest);
    expect(mapped.ok.input_snapshot).toEqual(fact.result.input_snapshot);
    const licence = fact.result.enrichment.inference_warnings.find((warning: Json) => warning.code === 'GOAL_CHANCE_LICENSED');
    for (const comparison of fact.result.enrichment.option_comparison) {
      const option = mapped.ok.options.find(row => row.option_id === comparison.option_id)!;
      expect(option.chance).toBe(comparison.probability_of_goal);
      expect(option.low).toBe(comparison.probability_of_goal_precision.interval_lower);
      expect(option.high).toBe(comparison.probability_of_goal_precision.interval_upper);
      expect(option.driver).toEqual(licence.driver_by_option[comparison.option_id] ?? null);
    }
  });

  it('maps every captured succeeded option and binds the exact recorded input digest', () => {
    const fact = factFromRead(succeeded);
    const before = clone(fact);
    const mapped = mapFact(fact);
    expect(mapped).toHaveProperty('ok');
    if (!('ok' in mapped)) throw new Error('quarantine' in mapped ? mapped.quarantine : 'unexpected legacy skip');
    expect(mapped.ok).toMatchObject({
      run_id: fact.result.run_id,
      leading_option_id: fact.result.leading_option_id,
      constraint_may_name_leading_option: fact.result.constraint_verdict?.may_name_leading_option ?? null,
      canonical_request_hash: fact.result.input_snapshot.sent_digest,
      status: 'succeeded', computed_at: fact.result.computed_at,
      graph_identity_hash: null,
      input_snapshot: fact.result.input_snapshot,
    });
    expect(mapped.ok.options).toHaveLength(fact.result.enrichment.option_comparison.length);
    for (const recorded of fact.result.enrichment.option_comparison) {
      const row = mapped.ok.options.find(option => option.option_id === recorded.option_id);
      expect(row).toMatchObject({
        option_id: recorded.option_id,
        chance: recorded.probability_of_goal,
        low: recorded.probability_of_goal_precision.interval_lower,
        high: recorded.probability_of_goal_precision.interval_upper,
        licence_status: 'permitted_with_caveat', withheld_reason: null,
      });
    }
    // A near-tie leader withhold in this capture does not withhold option chances.
    expect(succeeded.analysis_state.leader_claim.permitted).toBe(false);
    expect(mapped.ok.options.every(option => option.chance !== null)).toBe(true);
    expect(mapped.ok.options[0]!.driver).toEqual(
      fact.result.enrichment.inference_warnings.find((warning: Json) => warning.code === 'GOAL_CHANCE_LICENSED')
        .driver_by_option[mapped.ok.options[0]!.option_id],
    );
    expect(fact).toEqual(before);
  });

  it('keeps captured withheld options as rows with NULL chance and the recorded reason', () => {
    const fact = factFromRead(withheld);
    const mapped = mapFact(fact);
    expect(mapped).toHaveProperty('ok');
    if (!('ok' in mapped)) throw new Error('quarantine' in mapped ? mapped.quarantine : 'unexpected legacy skip');
    expect(mapped.ok.options).toHaveLength(3);
    const option = mapped.ok.options.find(row => row.option_id === 'raise_prices_10')!;
    expect(option).toMatchObject({
      chance: null, low: null, high: null, driver: null,
      licence_status: 'withheld', withheld_reason: 'GOAL_FIGURES_PLACEHOLDER_PATH',
    });
  });

  it.each([
    ['missing run_id', (fact: Json) => { delete fact.result.run_id; }, /run_id/],
    ['non-numeric chance', (fact: Json) => { fact.result.enrichment.option_comparison[0].probability_of_goal = '0.5'; }, /chance|probability_of_goal/],
    ['chance above one', (fact: Json) => { fact.result.enrichment.option_comparison[0].probability_of_goal = 1.1; }, /chance|probability_of_goal/],
    ['invalid precision', (fact: Json) => { fact.result.enrichment.option_comparison[0].probability_of_goal_precision.interval_lower = 2; }, /precision|interval/],
  ] as const)('quarantines %s without throwing', (_name, corrupt, reason) => {
    const fact = factFromRead(succeeded);
    corrupt(fact);
    expect(() => mapFact(fact)).not.toThrow();
    const mapped = mapFact(fact);
    expect(mapped).toHaveProperty('quarantine');
    expect(mapped).not.toHaveProperty('ok');
    if ('quarantine' in mapped) expect(mapped.quarantine).toMatch(reason);
  });

  it('quarantines missing captured inputs instead of recreating them from readback', () => {
    const mapped = mapFact(factFromRead(succeeded, false));
    expect(mapped).toHaveProperty('quarantine');
    if ('quarantine' in mapped) expect(mapped.quarantine).toMatch(/input_snapshot/);
  });

  it('one bad fact among N preserves every other mapped fact', () => {
    const first = factFromRead(succeeded);
    const bad = factFromRead(succeeded);
    delete bad.result.run_id;
    const last = factFromRead(secondSucceeded);
    const mapped = [first, bad, last].map(mapFact);
    expect(mapped.filter(result => 'quarantine' in result)).toHaveLength(1);
    expect(mapped.flatMap(result => 'ok' in result ? [result.ok.run_id] : [])).toEqual([
      first.result.run_id, last.result.run_id,
    ]);
  });

  it('rejects a scenario context mismatch instead of misbinding a valid Run', () => {
    const mapped = toTypedRunRows(factFromRead(succeeded), { scenarioId: withheld.scenario_id });
    expect(mapped).toEqual({ quarantine: 'scenario_id_mismatch' });
  });

  it.each(['missing', 'null'] as const)('skips %s legacy identity only in backfill, before current result shape requirements', shape => {
    const fact = factFromRead(succeeded);
    const scenarioId = fact.result.scenario_id;
    fact.result = shape === 'missing' ? {} : { run_id: null };
    expect(toTypedRunRows(fact, { scenarioId, mode: 'backfill' })).toEqual({ skipped_legacy: true });
    expect(toTypedRunRows(fact, { scenarioId })).toEqual({ quarantine: 'run_id_absent' });
    expect(toTypedRunRows(fact, { scenarioId, mode: 'trigger' })).toEqual({ quarantine: 'run_id_absent' });
  });

  it.each(['', ' \t\n', 0, false, [], {}])('quarantines present invalid run identity %j in both modes', runId => {
    const fact = factFromRead(succeeded);
    fact.result.run_id = runId;
    for (const mode of ['trigger', 'backfill'] as const) {
      expect(toTypedRunRows(fact, { scenarioId: fact.result.scenario_id, mode })).toEqual({ quarantine: 'run_id_invalid' });
    }
  });

  it.each([
    ['non-object result', (fact: Json) => { fact.result = []; }, 'result_shape'],
    ['missing leader', (fact: Json) => { delete fact.result.leading_option_id; }, 'leading_option_id_shape'],
    ['non-string leader', (fact: Json) => { fact.result.leading_option_id = 1; }, 'leading_option_id_shape'],
    ['missing summary', (fact: Json) => { delete fact.result.summary; }, 'summary_shape'],
    ['null summary', (fact: Json) => { fact.result.summary = null; }, 'summary_shape'],
    ['non-object verdict', (fact: Json) => { fact.result.constraint_verdict = []; }, 'constraint_may_name_leading_option_shape'],
    ['string producer permission', (fact: Json) => { fact.result.constraint_verdict = { may_name_leading_option: 'false' }; }, 'constraint_may_name_leading_option_shape'],
    ['null producer permission', (fact: Json) => { fact.result.constraint_verdict = { may_name_leading_option: null }; }, 'constraint_may_name_leading_option_shape'],
  ] as const)('keeps %s distinguishable without copying its payload', (_name, corrupt, reason) => {
    const fact = factFromRead(succeeded);
    const scenarioId = fact.result.scenario_id;
    corrupt(fact);
    expect(toTypedRunRows(fact, { scenarioId })).toEqual({ quarantine: reason });
    expect(migration).toContain(`'${reason}'`);
  });

  it.each([true, false, null])('copies producer permission %j independently of compose and goal-chance licences', permission => {
    const fact = factFromRead(succeeded);
    fact.result.leading_option_id = 'producer-leader';
    // The verdict state deliberately differs from the boolean: this reader
    // preserves the source boolean rather than deriving it from state or options.
    if (permission !== null) fact.result.constraint_verdict = {
      may_name_leading_option: permission, constraint_verdict_state: 'unknown',
    };
    else delete fact.result.constraint_verdict;
    const before = clone(fact);
    const mapped = mapFact(fact);
    if (!('ok' in mapped)) throw new Error('quarantine' in mapped ? mapped.quarantine : 'unexpected legacy skip');
    expect(mapped.ok.leading_option_id).toBe('producer-leader');
    expect(mapped.ok.constraint_may_name_leading_option).toBe(permission);
    expect(mapped.ok.options.every(option => option.chance !== null)).toBe(true);
    expect(succeeded.analysis_state.leader_claim.permitted).toBe(false);
    expect(fact).toEqual(before);
  });

  it('retains NULL when the nested producer flag is absent, with no inferred leader or verdict', () => {
    const fact = factFromRead(succeeded);
    fact.result.leading_option_id = null;
    fact.result.constraint_verdict = { constraint_verdict_state: 'verified_feasible' };
    const mapped = mapFact(fact);
    expect(mapped).toHaveProperty('ok');
    if ('ok' in mapped) expect(mapped.ok).toMatchObject({ leading_option_id: null, constraint_may_name_leading_option: null });
  });

  it('pins cancel propagation, compact quarantine storage, and explicit backfill mode without a DB', () => {
    const handlers = [...migration.matchAll(/EXCEPTION WHEN ([^\n]+) THEN/g)].map(match => match[1]);
    expect(handlers).toEqual(['OTHERS', 'OTHERS', 'OTHERS']);
    expect(migration).toContain("p_mode text DEFAULT 'trigger'");
    expect(migration).toContain("analysis_run_from_fact(v_fact, 'backfill')");
    expect(migration).toContain("'skipped_legacy'");
    const quarantineDefinition = migration.match(/CREATE TABLE public\.analysis_run_quarantine \(([\s\S]*?)\n\);/)?.[1];
    expect(quarantineDefinition).toBeDefined();
    expect(quarantineDefinition).not.toMatch(/\braw\b|\bJSONB\b/i);
    for (const column of ['fact_id', 'scenario_id', 'reason', 'seen_at']) expect(quarantineDefinition).toContain(column);
    expect(migration).toContain('INSERT INTO public.analysis_run_quarantine (fact_id, scenario_id, reason)');
    expect(migration).toContain('producer verdict at Run time; compose applies further remove-only gates; NOT the final permission');
  });

  it('uses only an explicitly attested graph identity, never the analysis-affecting currentness hash', () => {
    const fact = factFromRead(succeeded);
    const identity = succeeded.graph_identity_hash.value;
    const mapped = toTypedRunRows(fact, { scenarioId: fact.result.scenario_id, graphIdentityHash: identity });
    expect(mapped).toHaveProperty('ok');
    if ('ok' in mapped) {
      expect(mapped.ok.graph_identity_hash).toBe(identity);
      expect(mapped.ok.graph_identity_hash).not.toBe(fact.result.graph_hash_at_run);
    }
  });
});
