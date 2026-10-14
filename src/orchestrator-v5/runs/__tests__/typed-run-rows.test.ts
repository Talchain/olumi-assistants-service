import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAnalysisRefusalFact } from '../../context/analysis-refusal-continuity.js';
import { TYPED_RUN_PAYLOAD_PATHS, toTypedRunRows } from '../typed-run-rows.js';

type Json = Record<string, any>;
const captured = (path: string): Json => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')).j;
const succeeded = captured('../../agent-lane/__tests__/fixtures/cut9-prod-p1-2-7e3f8fb-readback-run1.json');
const secondSucceeded = captured('../../agent-lane/__tests__/fixtures/waveB5-t1b-3fce64f-readback-run1.json');
const withheld = captured('../../agent-lane/method-turn/__tests__/fixtures/w9b/C.json');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const migration = readFileSync(new URL('../../../../supabase/migrations/20261009010000_phase2_a_typed_runs.sql', import.meta.url), 'utf8');

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
  it.each(['live', 'backfill'] as const)('maps evaluated revisions in %s and keeps null rows byte-identical', mode => {
    const fact = factFromRead(succeeded);
    const ctx = { scenarioId: fact.result.scenario_id, mode };
    const legacy = toTypedRunRows(fact, ctx);
    expect(JSON.stringify(toTypedRunRows(fact, { ...ctx, evaluatedScenarioRevision: null }))).toBe(JSON.stringify(legacy));
    expect(legacy).toMatchObject({ ok: { scenario_revision: null, revision_source: 'legacy_unknown' } });
    for (const n of [0, 7, 2147483647, Number.MAX_SAFE_INTEGER]) {
      expect(toTypedRunRows(fact, { ...ctx, evaluatedScenarioRevision: n })).toEqual({
        ok: { ...('ok' in legacy ? legacy.ok : {}), scenario_revision: n, revision_source: 'recorded' },
      });
    }
  });
  it.each([-1, 1.5, '7', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, true])('quarantines invalid evaluated revision %j', evaluatedScenarioRevision => {
    const fact = factFromRead(succeeded);
    for (const mode of ['live', 'backfill'] as const) {
      expect(toTypedRunRows(fact, { scenarioId: fact.result.scenario_id, mode, evaluatedScenarioRevision }))
        .toEqual({ quarantine: 'evaluated_scenario_revision_invalid' });
    }
  });

  it('maps the captured Run fields through the ONE TS specification', () => {
    expect(TYPED_RUN_PAYLOAD_PATHS).toContain('result.input_snapshot');

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
    ['invalid run_id', (fact: Json) => { fact.result.run_id = ''; }, /run_id/],
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
    bad.result.run_id = '';
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

  it.each(['missing', 'null'] as const)('marks %s legacy identity unattributable in both modes, before current result shape requirements', shape => {
    const fact = factFromRead(succeeded);
    const scenarioId = fact.result.scenario_id;
    fact.result = shape === 'missing' ? {} : { run_id: null };
    expect(toTypedRunRows(fact, { scenarioId, mode: 'backfill' })).toEqual({ unattributable: 'run_id_absent' });
    expect(toTypedRunRows(fact, { scenarioId })).toEqual({ unattributable: 'run_id_absent' });
    expect(toTypedRunRows(fact, { scenarioId, mode: 'live' })).toEqual({ unattributable: 'run_id_absent' });
  });

  it.each(['missing', 'null'] as const)('skips a built refusal marker with %s run identity in both modes without quarantine', shape => {
    const fact: Json = clone(buildAnalysisRefusalFact({
      scenarioId: succeeded.scenario_id,
      reasonCode: 'analysis_not_ready',
      computedAt: '2026-10-08T12:00:00.000Z',
    }));
    if (shape === 'null') fact.result.run_id = null;
    const before = clone(fact);
    for (const mode of ['live', 'backfill'] as const) {
      expect(toTypedRunRows(fact, { scenarioId: fact.result.scenario_id, mode })).toEqual({ skipped_refusal: true });
    }
    expect(mapFact(fact)).toEqual({ skipped_refusal: true });
    expect(fact).toEqual(before);
  });

  it('uses only the shared refusal predicate before current schema validation', () => {
    const fact: Json = clone(buildAnalysisRefusalFact({
      scenarioId: succeeded.scenario_id, reasonCode: 'analysis_blocked',
    }));
    delete fact.fact_version;
    delete fact.result.summary;
    delete fact.result.computed_at;
    for (const mode of ['live', 'backfill'] as const) {
      expect(toTypedRunRows(fact, { scenarioId: fact.result.scenario_id, mode })).toEqual({ skipped_refusal: true });
    }
  });

  it.each([
    ['another fact type', (fact: Json) => { fact.fact_type = 'create_scenario'; }],
    ['noop', (fact: Json) => { fact.noop = true; }],
  ] as const)('does not classify %s as a refusal marker', (_name, change) => {
    const fact: Json = clone(buildAnalysisRefusalFact({
      scenarioId: succeeded.scenario_id, reasonCode: 'analysis_not_ready',
    }));
    change(fact);
    expect(toTypedRunRows(fact, { scenarioId: fact.result.scenario_id, mode: 'live' })).toHaveProperty('quarantine');
  });

  it.each(['live', 'backfill'] as const)('a non-refusal legacy status is unattributable in %s; malformed with run_id stays quarantined', mode => {
    const fact: Json = clone(buildAnalysisRefusalFact({ scenarioId: succeeded.scenario_id, reasonCode: 'analysis_not_ready' }));
    fact.result.enrichment.analysis_status = 'blocked';
    expect(toTypedRunRows(fact, { scenarioId: fact.result.scenario_id, mode })).toEqual({ unattributable: 'run_id_absent' });
    const malformed = factFromRead(succeeded);
    malformed.result.input_snapshot.options = [null];
    expect(toTypedRunRows(malformed, { scenarioId: malformed.result.scenario_id, mode })).toHaveProperty('quarantine', expect.stringContaining('input_snapshot.options.0'));
  });

  it('marks a computed fact without run_id unattributable in live mode', () => {
    const fact = factFromRead(succeeded);
    delete fact.result.run_id;
    expect(toTypedRunRows(fact, { scenarioId: fact.result.scenario_id, mode: 'live' }))
      .toEqual({ unattributable: 'run_id_absent' });
  });

  it('maps a refusal carrying a run_id through the normal withheld Run path', () => {
    const fact = factFromRead(succeeded);
    fact.result.enrichment.analysis_status = 'refused';
    for (const mode of ['live', 'backfill'] as const) {
      const mapped = toTypedRunRows(fact, { scenarioId: fact.result.scenario_id, mode });
      expect(mapped).toHaveProperty('ok');
      if ('ok' in mapped) {
        expect(mapped.ok.status).toBe('withheld');
        expect(mapped.ok.run_id).toBe(fact.result.run_id);
        expect(mapped.ok.options.every(option => option.chance === null && option.withheld_reason === 'analysis_refused')).toBe(true);
      }
    }
  });

  it.each(['', ' \t\n', 0, false, [], {}])('quarantines present invalid run identity %j in both modes', runId => {
    const fact = factFromRead(succeeded);
    fact.result.run_id = runId;
    for (const mode of ['live', 'backfill'] as const) {
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

  it('slice C replaces three functions: only claim anti-joins and finisher terminal check; rollback exact', () => {
    const slice = readFileSync(new URL('../../../../supabase/migrations/20261009040000_phase2_a_legacy_unattributable.sql', import.meta.url), 'utf8');
    const rollback = readFileSync(new URL('../../../../supabase/migrations/rollback/20261009040000_phase2_a_legacy_unattributable_rollback.sql.do-not-apply', import.meta.url), 'utf8');
    expect(slice.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(3);
    for (const name of ['claim_analysis_run_facts', 'claim_analysis_run_reconciliation', 'finish_analysis_run_sweep']) {
      const pattern = new RegExp('CREATE (?:OR REPLACE )?FUNCTION public\\.' + name + '\\([\\s\\S]*?\\$\\$;');
      const original = migration.match(pattern)?.[0]?.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
      const changed = slice.match(pattern)?.[0];
      expect(original).toBeDefined();
      const expected = name === 'finish_analysis_run_sweep'
        ? original?.replace(
          '      OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id) AS terminal',
          '      OR EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id)\n'
            + '      OR EXISTS (SELECT 1 FROM public.analysis_run_unattributable u WHERE u.fact_id = h.id) AS terminal')
        : original?.replace(
          '      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id)\n',
          '      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id)\n'
            + '      AND NOT EXISTS (SELECT 1 FROM public.analysis_run_unattributable u WHERE u.fact_id = h.id)\n');
      expect(changed).toBe(expected);
      expect(rollback.match(pattern)?.[0]).toBe(original);
    }
    for (const sql of [slice, rollback]) {
      expect(sql.replace(/^--.*$/gm, '').trim().split(';')[0]).toBe("SET lock_timeout = '3s'");
      expect(sql).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    }
    expect(slice).not.toMatch(/REFERENCES\s+public\.v5_handler_facts|CREATE\s+TRIGGER/i);
    const outsideBodies = slice.replace(/AS \$\$[\s\S]*?\$\$;/g, '');
    expect(outsideBodies).not.toMatch(/\b(?:FROM|JOIN|ALTER TABLE|LOCK TABLE)\s+public\.v5_handler_facts/i);
    expect(slice).toContain("reason TEXT NOT NULL CHECK (reason IN ('run_id_absent'))");
    expect(slice).toContain('ALTER TABLE public.analysis_run_unattributable ENABLE ROW LEVEL SECURITY');
    expect(slice).toContain('REVOKE ALL ON TABLE public.analysis_run_unattributable FROM PUBLIC, anon, authenticated');
    expect(slice).toContain('REVOKE ALL ON FUNCTION public.mark_analysis_fact_unattributable(uuid,text) FROM PUBLIC, anon, authenticated');
    // DL ruling: the already-quarantined legacy move stays in the migration; it reads only the quarantine table.
    expect(slice).toContain('SELECT fact_id, reason, seen_at FROM public.analysis_run_quarantine');
    expect(slice).toContain('ON CONFLICT (fact_id) DO NOTHING');
    const marker = slice.match(/CREATE FUNCTION public\.mark_analysis_fact_unattributable\([\s\S]*?\$\$;/)?.[0];
    expect(marker).toContain('SECURITY DEFINER');
    expect(marker).toContain('SET search_path = pg_catalog, public');
    expect(marker).toContain('FROM public.analysis_run_attempts WHERE fact_id = p_fact_id FOR UPDATE');
    expect(marker).toContain('FROM public.analysis_run_unattributable WHERE fact_id = p_fact_id');
  });

  it('reconciliation uses the indexed anti-join without a watermark and releases the shared lease without advancing it', () => {
    const body = migration.match(/CREATE FUNCTION public\.claim_analysis_run_reconciliation\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/)?.[1];
    expect(body).toBeDefined();
    expect(body).toContain("h.action_type = 'run_analysis' AND NOT h.noop");
    expect(body).toContain('NOT EXISTS (SELECT 1 FROM public.analysis_runs r WHERE r.fact_id = h.id)');
    expect(body).toContain('NOT EXISTS (SELECT 1 FROM public.analysis_run_quarantine q WHERE q.fact_id = h.id)');
    expect(body).toContain('ORDER BY h.created_at, h.id LIMIT p_sweep_limit');
    expect(body).toContain('p_sweep_limit > 20');
    expect(body).toContain('FOR UPDATE SKIP LOCKED');
    expect(body).not.toMatch(/processed_at|processed_id/);
    const releaseOnly = migration.match(/IF s\.window_last_at IS NULL THEN([\s\S]*?)END IF;/)?.[1];
    expect(releaseOnly).toContain('lease_id = NULL');
    expect(releaseOnly).not.toMatch(/processed_at|processed_id/);
  });
  it('adds only objects, with compact terminal storage and bounded durable watermark ranges', () => {
    expect(migration).not.toMatch(/CREATE TRIGGER|CREATE TABLE public\.analysis_run_queue|ALTER TABLE public\.(v5_handler_facts|scenarios)/);
    expect(migration).not.toMatch(/REFERENCES public\.(v5_handler_facts|scenarios)/);
    expect(migration).toContain('FOR UPDATE SKIP LOCKED');
    expect(migration).toContain('WITH fact_window AS MATERIALIZED');
    expect(migration).toContain('(h.created_at, h.id) > (s.processed_at, s.processed_id)');
    expect(migration).toContain('ORDER BY h.created_at, h.id LIMIT p_sweep_limit');
    expect(migration).toContain('LEAST(failure_count+1,5)');
    expect(migration).toContain('pg_stat_activity');
    const quarantineDefinition = migration.match(/CREATE TABLE public\.analysis_run_quarantine \(([\s\S]*?)\n\);/)?.[1];
    expect(quarantineDefinition).not.toMatch(/\braw\b|\bJSONB\b/i);
    const rollback = readFileSync(new URL('../../../../supabase/migrations/rollback/20261009010000_phase2_a_typed_runs_rollback.sql.do-not-apply', import.meta.url), 'utf8');
    expect(rollback.replace(/^--.*$/gm, '').trim().split(';')[0]).toBe("SET LOCAL lock_timeout = '3s'");
  });

  it('separates the exact concurrent-index DDL and rolls it back before transactional objects', () => {
    const index = readFileSync(new URL('../../../../supabase/migrations/20261009010100_phase2_a_sweep_index.sql', import.meta.url), 'utf8');
    const rollback = readFileSync(new URL('../../../../supabase/migrations/rollback/20261009010100_phase2_a_sweep_index_rollback.sql.do-not-apply', import.meta.url), 'utf8');
    const statements = (sql: string) => sql.replace(/^--.*$/gm, '').trim();
    expect(statements(index)).toBe("SET lock_timeout = '3s';\nCREATE INDEX CONCURRENTLY IF NOT EXISTS analysis_run_facts_sweep_idx ON public.v5_handler_facts (created_at, id) WHERE action_type = 'run_analysis' AND NOT noop;");
    expect(statements(rollback)).toBe("SET lock_timeout='3s';\nDROP INDEX CONCURRENTLY IF EXISTS public.analysis_run_facts_sweep_idx;");
    expect(index).toContain('SELECT indisvalid FROM pg_index');
    expect(migration).toContain('no trigger, no write-blocking DDL; one concurrent index allowed (DL 87114 amendment)');
    expect(migration).toContain("h.action_type = 'run_analysis' AND NOT h.noop");
    const mainRollback = readFileSync(new URL('../../../../supabase/migrations/rollback/20261009010000_phase2_a_typed_runs_rollback.sql.do-not-apply', import.meta.url), 'utf8');
    expect(mainRollback).toContain('FIRST step: run 20261009010100_phase2_a_sweep_index_rollback.sql.do-not-apply');
  });

  it('options=[null] quarantines; no derivation-time revision is invented', () => {
    const fact = factFromRead(succeeded);
    const valid = mapFact(fact);
    expect(valid).toHaveProperty('ok.scenario_revision', null);
    expect(valid).toHaveProperty('ok.revision_source', 'legacy_unknown');
    fact.result.input_snapshot.options = [null];
    expect(mapFact(fact)).toHaveProperty('quarantine', expect.stringContaining('input_snapshot.options.0'));
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

import type { SupabaseClient } from '@supabase/supabase-js';
import { HandlerFactSchema } from '@talchain/schemas/orchestrator';
import { canonicalJson, loadCorpus, parity2b } from '../../../../scripts/phase2/parity-2b.js';
import { selectRunAnalysisFact } from '../../context/freshness.js';
import { readLatestRun, readTwoLatestRuns, type AnalysisRunReadRow } from '../read-latest-run.js';

/** Mock only transport paging/eligibility; selection runs in the real freshness core. */
function typedTableClient(rows: AnalysisRunReadRow[]): Pick<SupabaseClient, 'from'> {
  return { from(table: string) {
    expect(table).toBe('analysis_runs');
    let scenarioId: string;
    let from = 0; let to = 499;
    const builder = {
      select(columns: string) {
        expect(columns.split(',').map(column => column.trim())).toEqual(expect.arrayContaining(['scenario_revision', 'revision_source']));
        return builder;
      },
      eq(column: string, value: string) { if (column === 'scenario_id') scenarioId = value;
        else { expect(column).toBe('status'); expect(value).toBe('succeeded'); } return builder; },
      order(column: string, opts: { ascending: boolean }) {
        expect(column).toBe('fact_id'); expect(opts.ascending).toBe(true); return builder;
      },
      range(a: number, b: number) { from = a; to = b; return builder; },
      returns() { return Promise.resolve({ data: rows.filter(row => row.scenario_id === scenarioId && row.status === 'succeeded')
        .sort((a, b) => a.fact_id.localeCompare(b.fact_id)).slice(from, to + 1), error: null }); },
    };
    return builder;
  } } as unknown as Pick<SupabaseClient, 'from'>;
}
function materialisedCorpus() {
  return parity2b().flatMap(entry => entry.run === null ? [] : [{ ...entry.run,
    fact_created_at: loadCorpus().find(c => c.case_id === entry.case_id)!.created_at,
    created_at: '2026-10-10T00:00:00Z', // derivation time is deliberately unrelated
  }]);
}
describe('S1 TS golden corpus and dormant typed reader', () => {
  it('both typed read ports project recorded and explicit legacy revisions unchanged', async () => {
    const rows = materialisedCorpus().filter(row => row.status === 'succeeded').slice(0, 2);
    expect(rows).toHaveLength(2);
    const first = { ...rows[0]!, computed_at: '2026-10-09T12:00:00Z', scenario_revision: 7, revision_source: 'recorded' as const };
    const second = { ...rows[1]!, scenario_id: first.scenario_id, computed_at: '2026-10-09T11:00:00Z',
      scenario_revision: null, revision_source: 'legacy_unknown' as const };
    await expect(readLatestRun(typedTableClient([second, first]), first.scenario_id)).resolves.toEqual(first);
    await expect(readTwoLatestRuns(typedTableClient([second, first]), first.scenario_id)).resolves.toEqual([first, second]);
    await expect(readLatestRun(typedTableClient([second]), first.scenario_id)).resolves.toEqual(second);
  });

  it('reproduces expected.json in-process from the same 31 source payloads', () => {
    expect(loadCorpus()).toHaveLength(31);
    expect(canonicalJson(parity2b())).toBe(readFileSync(new URL('../../../../scripts/phase2/corpus-2b/expected.json', import.meta.url), 'utf8'));
    const rows = parity2b();
    expect(rows.find(row => row.case_id === '30-huge-100-options')?.options).toHaveLength(100);
    expect(rows.find(row => row.case_id === '26-duplicate-run-id')?.quarantine?.reason).toBe('duplicate_run_id');
    for (const caseId of ['02-legacy-missing-run', '03-legacy-null-run']) {
      expect(rows.find(row => row.case_id === caseId)).toMatchObject({ disposition: 'unattributable', quarantine: null,
        unattributable: { reason: 'run_id_absent' } });
    }
    expect(rows.find(row => row.case_id === '04-refusal-marker')?.disposition).toBe('skipped_refusal');
    expect(rows.find(row => row.case_id === '31-null-input-option')?.quarantine?.reason).toBe('input_snapshot_invalid');
    expect(rows.filter(row => row.run !== null).every(row => row.run?.scenario_revision === null && row.run.revision_source === 'legacy_unknown')).toBe(true);
  });
  it('same shared corpus: readLatestRun chooses selectRunAnalysisFact’s successful Run', async () => {
    const corpus = loadCorpus();
    const derivedIds = new Set(parity2b().flatMap(entry => entry.run === null ? [] : [entry.run.fact_id]));
    const facts = [...corpus].filter(entry => derivedIds.has(entry.fact_id)).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.fact_id.localeCompare(a.fact_id))
      .flatMap(entry => { const parsed = HandlerFactSchema.safeParse(entry.fact); return parsed.success ? [parsed.data] : []; });
    const selected = selectRunAnalysisFact(facts);
    if (selected?.fact.fact_type !== 'run_analysis') throw new Error('No corpus success');
    const actual = await readLatestRun(typedTableClient(materialisedCorpus()), corpus[0]!.scenario_id);
    expect(actual?.run_id).toBe(selected.fact.result.run_id);
    expect(actual?.computed_at).toBe(selected.computed_at);
    expect(actual?.scenario_revision).toBeNull();
  });
  it.each([false, true])('malformed-row isolation (corruption=%s) preserves the valid newest Run', async corrupt => {
    const corpus = loadCorpus();
    const first = structuredClone(corpus[0]!); const newest = structuredClone(corpus[9]!);
    const bad = structuredClone(corpus[12]!);
    const derived = parity2b(corrupt ? [first, bad, newest] : [first, newest]);
    expect(derived.filter(entry => entry.quarantine !== null)).toHaveLength(corrupt ? 1 : 0);
    const rows = derived.flatMap(entry => entry.run === null ? [] : [{ ...entry.run, fact_created_at: first.created_at, created_at: first.created_at }]);
    await expect(readLatestRun(typedTableClient(rows), first.scenario_id)).resolves.toMatchObject({ run_id: (newest.fact as Json).result.run_id, fact_id: newest.fact_id });
  });
  it.each(['higher-revision-earlier-time', 'computed-time-tie', 'null-computed-time', 'both-null', 'insertion-tie', 'same-instant-different-ISO-text'] as const)(
    'same selection as the fact selector: %s', async contrast => {
      const corpus = loadCorpus();
      const old = structuredClone(corpus[0]!); const newer = structuredClone(corpus[9]!);
      const oldFact = HandlerFactSchema.parse(old.fact); const newFact = HandlerFactSchema.parse(newer.fact);
      if (oldFact.fact_type !== 'run_analysis' || newFact.fact_type !== 'run_analysis') throw new Error('Fixture type');
      const rows: AnalysisRunReadRow[] = parity2b([old, newer]).flatMap(entry => entry.run === null ? [] : [{ ...entry.run,
        fact_created_at: entry.run.fact_id === newer.fact_id ? '2026-10-10T02:00:00Z' : '2026-10-10T01:00:00Z', created_at: '2026-10-11T00:00:00Z' }]);
      expect(rows).toHaveLength(2);
      rows[0] = { ...rows[0]!, scenario_revision: 9, revision_source: 'recorded' };
      rows[1] = { ...rows[1]!, scenario_revision: 1, revision_source: 'recorded' };
      if (contrast === 'computed-time-tie' || contrast === 'insertion-tie') {
        newFact.result.computed_at = oldFact.result.computed_at;
        rows[1] = { ...rows[1]!, computed_at: rows[0]!.computed_at };
      }
      if (contrast === 'null-computed-time' || contrast === 'both-null') {
        delete newFact.result.computed_at; rows[1] = { ...rows[1]!, computed_at: null };
      }
      if (contrast === 'both-null') { delete oldFact.result.computed_at; rows[0] = { ...rows[0]!, computed_at: null }; }
      if (contrast === 'insertion-tie') rows[0] = { ...rows[0]!, fact_created_at: rows[1]!.fact_created_at };
      if (contrast === 'same-instant-different-ISO-text') {
        oldFact.result.computed_at = '2026-10-10T01:00:00Z'; newFact.result.computed_at = '2026-10-10T01:00:00.000Z';
        rows[0] = { ...rows[0]!, computed_at: oldFact.result.computed_at }; rows[1] = { ...rows[1]!, computed_at: newFact.result.computed_at };
      }
      // The sanctioned fact loader supplies created_at DESC, id DESC.
      const ordered = rows.slice().sort((a, b) => b.fact_created_at.localeCompare(a.fact_created_at) || b.fact_id.localeCompare(a.fact_id))
        .map(row => row.fact_id === old.fact_id ? oldFact : newFact);
      const selected = selectRunAnalysisFact(ordered);
      if (selected?.fact.fact_type !== 'run_analysis') throw new Error('No selected Run');
      await expect(readLatestRun(typedTableClient(rows), old.scenario_id)).resolves.toHaveProperty('run_id', selected.fact.result.run_id);
    });
});


// SQL remains operator-rehearsed. These rows pin source bytes and prevent an
// accidental rewrite of unrelated writer/claim behaviour or rollback drift.
describe('B2 migration function byte boundaries', () => {
  const sql = (name: string) => readFileSync(new URL(`../../../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const forward = sql('20261009160000_b2_fact_evaluated_revision.sql');
  const rollback = sql('rollback/20261009160000_b2_fact_evaluated_revision_rollback.sql.do-not-apply');
  const definition = (text: string, name: string) => {
    const found = text.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS (\\$(?:function)?\\$)[\\s\\S]*?\\1;`));
    if (!found) throw new Error(`Missing ${name}`);
    return found[0];
  };
  const body = (text: string) => {
    const found = text.match(/AS (\$(?:function)?\$)([\s\S]*?)\1;/);
    if (!found) throw new Error('Missing dollar-quoted function body');
    return found[2]!;
  };
  const md5 = (text: string) => createHash('md5').update(body(text), 'utf8').digest('hex');
  it('changes only the v4 fact INSERT, preserving exact arguments/attributes and rollback bytes', () => {
    const original = definition(rollback, 'append_turn_atomic_v4');
    expect(md5(original)).toBe('db7bdbe3e2052237c623d8c5477a96e5');
    expect(body(original).length).toBe(4856);
    const revised = definition(forward, 'append_turn_atomic_v4');
    const insert = /INSERT INTO v5_handler_facts \([\s\S]*?\n {6}\);/;
    expect(revised.replace(insert, '<fact INSERT>')).toBe(original.replace(insert, '<fact INSERT>'));
    expect(revised.match(insert)?.[0]).toContain("jsonb_typeof(v_fact->'evaluated_scenario_revision') = 'number'");
    const signature = 'public.append_turn_atomic_v4(uuid,text,text,text,text,boolean,integer,integer,jsonb,jsonb,text,jsonb,jsonb,text,text,text,text,boolean,bigint)';
    expect(forward).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`);
    expect(forward).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`);
    expect(forward).toContain("md5(p.prosrc) = 'db7bdbe3e2052237c623d8c5477a96e5'");
    expect(rollback).toContain(`md5(p.prosrc) = '${md5(revised)}'`);
  });
  it.each([
    ['claim_analysis_run_facts', 'aa43423e62f68b00a07f1f116e406ad8'],
    ['claim_analysis_run_reconciliation', '3c14bc6590d368ca44f690f938ad55b0'],
  ])('pins %s current body hash and the sole sibling-key addition', (name, expectedHash) => {
    const original = definition(sql('20261009040000_phase2_a_legacy_unattributable.sql'), name);
    const revised = definition(forward, name);
    expect(md5(original)).toBe(expectedHash);
    const constant = `expected_${name}_md5`;
    expect(forward).toContain(`${constant} CONSTANT text := '${expectedHash}';`);
    expect(forward).toContain(`md5(p.prosrc) = ${constant}`);
    expect(forward.split(expectedHash)).toHaveLength(2);
    expect(revised.replace(",'evaluated_scenario_revision',h.evaluated_scenario_revision", '')).toBe(original);
    expect(definition(rollback, name)).toBe(original);
    expect(rollback).toContain(`md5(p.prosrc) = '${md5(revised)}'`);
  });
});
