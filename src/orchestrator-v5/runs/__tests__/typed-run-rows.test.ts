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

  it.each(['missing', 'null'] as const)('skips a built refusal marker with %s run identity in both modes without quarantine', shape => {
    const fact: Json = clone(buildAnalysisRefusalFact({
      scenarioId: succeeded.scenario_id,
      reasonCode: 'analysis_not_ready',
      computedAt: '2026-10-08T12:00:00.000Z',
    }));
    if (shape === 'null') fact.result.run_id = null;
    const before = clone(fact);
    for (const mode of ['trigger', 'backfill'] as const) {
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
    for (const mode of ['trigger', 'backfill'] as const) {
      expect(toTypedRunRows(fact, { scenarioId: fact.result.scenario_id, mode })).toEqual({ skipped_refusal: true });
    }
  });

  it.each([
    ['another fact type', (fact: Json) => { fact.fact_type = 'create_scenario'; }],
    ['noop', (fact: Json) => { fact.noop = true; }],
    ['another status', (fact: Json) => { fact.result.enrichment.analysis_status = 'blocked'; }],
  ] as const)('does not classify %s as a refusal marker', (_name, change) => {
    const fact: Json = clone(buildAnalysisRefusalFact({
      scenarioId: succeeded.scenario_id, reasonCode: 'analysis_not_ready',
    }));
    change(fact);
    expect(toTypedRunRows(fact, { scenarioId: fact.result.scenario_id, mode: 'trigger' })).toHaveProperty('quarantine');
  });

  it('quarantines a computed fact without run_id in trigger mode', () => {
    const fact = factFromRead(succeeded);
    delete fact.result.run_id;
    expect(toTypedRunRows(fact, { scenarioId: fact.result.scenario_id, mode: 'trigger' }))
      .toEqual({ quarantine: 'run_id_absent' });
  });

  it('maps a refusal carrying a run_id through the normal withheld Run path', () => {
    const fact = factFromRead(succeeded);
    fact.result.enrichment.analysis_status = 'refused';
    for (const mode of ['trigger', 'backfill'] as const) {
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

  it('pins enqueue-only bounded lock handling, compact terminal storage, and recoverable claims', () => {
    const handlers = [...migration.matchAll(/EXCEPTION WHEN ([^\n]+) THEN/g)].map(match => match[1]);
    expect(handlers).toEqual(['lock_not_available']);
    const trigger = migration.match(/CREATE FUNCTION public\.v5_handler_facts_enqueue_run\(\)([\s\S]*?)\$\$;/)?.[1];
    expect(trigger).toContain("SET lock_timeout = '50ms'");
    expect(trigger).not.toMatch(/\bSELECT\b|analysis_runs|analysis_run_options|analysis_run_quarantine/);
    expect(migration).toContain('FOR UPDATE OF h SKIP LOCKED');
    expect(migration).toContain('UNION');
    expect(migration).not.toContain('CREATE FUNCTION public.analysis_run_from_fact');
    expect(migration).not.toContain('CREATE FUNCTION public.backfill_analysis_runs');
    expect(migration).not.toContain('CREATE VIEW public.latest_successful_run');
    const quarantineDefinition = migration.match(/CREATE TABLE public\.analysis_run_quarantine \(([\s\S]*?)\n\);/)?.[1];
    expect(quarantineDefinition).toBeDefined();
    expect(quarantineDefinition).not.toMatch(/\braw\b|\bJSONB\b/i);
    for (const column of ['fact_id', 'scenario_id', 'reason', 'detail', 'seen_at']) expect(quarantineDefinition).toContain(column);
    const rollback = readFileSync(new URL('../../../../supabase/migrations/rollback/20261009010000_phase2_a_typed_runs_rollback.sql.do-not-apply', import.meta.url), 'utf8');
    expect(rollback.replace(/^--.*$/gm, '').trim().split(';')[0]).toBe('DROP TRIGGER v5_handler_facts_enqueue_run ON public.v5_handler_facts');
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
import { readLatestRun, type AnalysisRunReadRow } from '../read-latest-run.js';

/** Mock only transport paging/eligibility; selection runs in the real freshness core. */
function typedTableClient(rows: AnalysisRunReadRow[]): Pick<SupabaseClient, 'from'> {
  return { from(table: string) {
    expect(table).toBe('analysis_runs');
    let scenarioId: string;
    let from = 0; let to = 499;
    const builder = {
      select() { return builder; },
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
  it('reproduces expected.json in-process from the same 31 source payloads', () => {
    expect(loadCorpus()).toHaveLength(31);
    expect(canonicalJson(parity2b())).toBe(readFileSync(new URL('../../../../scripts/phase2/corpus-2b/expected.json', import.meta.url), 'utf8'));
    const rows = parity2b();
    expect(rows.find(row => row.case_id === '30-huge-100-options')?.options).toHaveLength(100);
    expect(rows.find(row => row.case_id === '26-duplicate-run-id')?.quarantine?.reason).toBe('duplicate_run_id');
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
