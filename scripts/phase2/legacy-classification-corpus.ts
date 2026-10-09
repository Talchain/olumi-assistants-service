/** Shared persisted corpus + edge cases. Generates TS expectations for the SQL rehearsal, not a SQL mapper. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { loadCorpus } from './parity-2b.js';
import { toTypedRunRows } from '../../src/orchestrator-v5/runs/typed-run-rows.js';

export interface LegacyCorpusRow { case_id: string; payload: unknown; noop: boolean; action_type: string; scenario_id: string }
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
export function legacyClassificationCorpus(): LegacyCorpusRow[] {
  const corpus = loadCorpus();
  const scenario_id = corpus[0]!.scenario_id;
  const base = { fact_type: 'run_analysis', fact_version: 1, result: {} };
  const synthetic: Array<[string, unknown, boolean?, string?]> = [
    ['synthetic-missing', base], ['synthetic-null', { ...base, result: { run_id: null } }],
    ['synthetic-empty', { ...base, result: { run_id: '' } }],
    ['synthetic-number', { ...base, result: { run_id: 123 } }],
    ['synthetic-refusal', { ...base, result: { enrichment: { analysis_status: 'refused' } } }],
    ['synthetic-refusal-null', { ...base, result: { run_id: null, enrichment: { analysis_status: 'refused' } } }],
    ['synthetic-noop', base, true], ['synthetic-wrong-action', base, false, 'create_scenario'],
    ['synthetic-wrong-type', { ...base, fact_type: 'create_scenario' }],
    ['synthetic-result-null', { ...base, result: null }], ['synthetic-result-array', { ...base, result: [] }],
    ['synthetic-payload-null', null], ['synthetic-payload-array', []], ['synthetic-payload-string', 'unreadable'],
    ['synthetic-version-string', { ...base, fact_version: '1' }], ['synthetic-version-2', { ...base, fact_version: 2 }],
    ['synthetic-version-missing', { fact_type: 'run_analysis', result: {} }],
    ['synthetic-blocked', { ...base, result: { enrichment: { analysis_status: 'blocked' } } }],
    ['synthetic-enrichment-array', { ...base, result: { enrichment: ['refused'] } }],
    ['synthetic-enrichment-null', { ...base, result: { enrichment: null } }],
    ['synthetic-payload-noop-overridden', { ...base, noop: true }],
    ['synthetic-noop-refusal', { ...base, result: { enrichment: { analysis_status: 'refused' } } }, true],
  ];
  return [...corpus.map(c => ({ case_id: c.case_id, payload: c.fact, noop: object(c.fact)?.noop === true,
    action_type: 'run_analysis', scenario_id: c.scenario_id })),
  ...synthetic.map(([case_id, payload, noop = false, action_type = 'run_analysis']) => ({ case_id, payload, noop, action_type, scenario_id }))];
}
export function legacyMapperSet(rows = legacyClassificationCorpus(), mode: 'live' | 'backfill' = 'live'): string[] {
  // This is the existing claim eligibility boundary, then the ONE mapper. The
  // mapper receives source noop overriding payload noop, exactly as the drain.
  return rows.filter(row => row.action_type === 'run_analysis' && !row.noop
    && 'unattributable' in toTypedRunRows({ ...object(row.payload), noop: row.noop }, { scenarioId: row.scenario_id, mode }))
    .map(row => row.case_id).sort();
}
const literal = (text: string): string => "'" + text.replaceAll("'", "''") + "'";
export function legacyRehearsalFixtureSql(): string {
  const rows = legacyClassificationCorpus(); const selected = new Set(legacyMapperSet(rows));
  const scenarioId = 'f2c00000-0000-4000-8000-000000000001';
  const payload = structuredClone(loadCorpus()[0]!.fact) as Record<string, unknown>;
  const result = object(payload.result); if (!result) throw new Error('Golden result missing');
  result.scenario_id = scenarioId; result.run_id = 'phase2-c-bulk-template';
  const mapped = toTypedRunRows({ ...payload, noop: false }, { scenarioId });
  if (!('ok' in mapped)) throw new Error('Golden bulk template did not map');
  const { options, ...run } = mapped.ok;
  return 'CREATE TEMP TABLE phase2_c_parity(case_id text PRIMARY KEY,payload jsonb,noop boolean,action_type text,ts_unattributable boolean);\n'
    + rows.map(row => `INSERT INTO phase2_c_parity VALUES (${literal(row.case_id)},${literal(JSON.stringify(row.payload))}::jsonb,${row.noop},${literal(row.action_type)},${selected.has(row.case_id)});`).join('\n')
    + '\nCREATE TEMP TABLE phase2_c_bulk_template(payload jsonb,run jsonb,options jsonb);\n'
    + `INSERT INTO phase2_c_bulk_template VALUES (${literal(JSON.stringify(payload))}::jsonb,${literal(JSON.stringify(run))}::jsonb,${literal(JSON.stringify(options))}::jsonb);\n`;
}
export function prepareLegacyRehearsal(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const migration = readFileSync(new URL('../../supabase/migrations/20261009040000_phase2_a_legacy_unattributable.sql', import.meta.url), 'utf8');
  const ending = '\nCOMMIT;\nRESET lock_timeout;\n';
  if (!migration.endsWith(ending)) throw new Error('Migration transaction ending changed; update the lock-probe harness explicitly');
  // Execute the exact migration bytes, withholding ONLY its final commit so the
  // rehearsal can inspect held locks before committing. Never ship this copy.
  writeFileSync(join(dir, 'migration-open.sql'), migration.slice(0, -ending.length) + '\n');
  writeFileSync(join(dir, 'parity-fixture.sql'), legacyRehearsalFixtureSql());
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2]; if (!dir) throw new Error('Local rehearsal output directory required');
  prepareLegacyRehearsal(dir);
}
