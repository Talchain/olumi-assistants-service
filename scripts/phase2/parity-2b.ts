/** Shared 2B corpus: run with `node --import tsx scripts/phase2/parity-2b.ts` from the repo root. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { toTypedRunRows } from '../../src/orchestrator-v5/runs/typed-run-rows.js';

export interface CorpusCase {
  case_id: string;
  fact_id: string;
  scenario_id: string;
  /** Scenario state in the fixture, deliberately NEVER used as evaluated Run provenance. */
  scenario_revision: number;
  created_at: string;
  fact: unknown;
}
const corpusDir = new URL('./corpus-2b/', import.meta.url);
export function loadCorpus(): CorpusCase[] {
  return readdirSync(corpusDir).filter(name => /^\d\d-.*\.json$/.test(name)).sort()
    .map(name => JSON.parse(readFileSync(new URL(name, corpusDir), 'utf8')) as CorpusCase);
}

/** Storage retains its SQLSTATE/message; compare explicit semantic codes, never arbitrary diagnostic wording. */
export function quarantineCode(reason: string): string {
  for (const code of ['result_shape', 'run_id_invalid', 'scenario_id_mismatch',
    'leading_option_id_shape', 'summary_shape', 'constraint_may_name_leading_option_shape']) {
    if (reason === code) return code;
  }
  if (/duplicate key value.*analysis_runs_pkey|duplicate_run_id/.test(reason)) return 'duplicate_run_id';
  if (/input_snapshot/.test(reason)) return 'input_snapshot_invalid';
  if (/computed_at/.test(reason)) return 'computed_at_invalid';
  if (/analysis_status/.test(reason)) return 'analysis_status_unsupported';
  if (/probability_of_goal_precision|Wilson|precision/.test(reason)) return 'precision_invalid';
  if (/probability_of_goal/.test(reason)) return 'probability_invalid';
  if (/option_comparison/.test(reason)) return 'option_comparison_invalid';
  if (/result.enrichment(?:\s|:|$)/.test(reason)) return 'enrichment_invalid';
  throw new Error(`Unrecognised quarantine diagnostic: ${reason}`);
}

/** Models inserts in file order, including the table's PK conflict. Derivation is atomic per fact. */
export function parity2b(corpus = loadCorpus()) {
  const runIds = new Set<string>();
  return corpus.map(entry => {
    const mapped = toTypedRunRows(entry.fact, { scenarioId: entry.scenario_id, mode: 'live' });
    if ('unattributable' in mapped) {
      return { case_id: entry.case_id, disposition: 'unattributable', run: null, options: [], quarantine: null,
        unattributable: { fact_id: entry.fact_id, reason: mapped.unattributable } };
    }
    const conflict = 'ok' in mapped && runIds.has(mapped.ok.run_id);
    if ('ok' in mapped && !conflict) {
      runIds.add(mapped.ok.run_id);
      const { options, ...row } = mapped.ok;
      return { case_id: entry.case_id, disposition: 'derived', run: {
        ...row, computed_at: new Date(row.computed_at).toISOString(), scenario_id: entry.scenario_id,
        user_id: null, fact_id: entry.fact_id,
      }, options: [...options].sort((a, b) => a.option_id < b.option_id ? -1 : a.option_id > b.option_id ? 1 : 0), quarantine: null };
    }
    const reason = conflict ? 'duplicate_run_id' : 'quarantine' in mapped ? quarantineCode(mapped.quarantine) : null;
    return { case_id: entry.case_id, disposition: reason === null ? 'skipped_refusal' : 'quarantined',
      run: null, options: [], quarantine: reason === null ? null : {
        fact_id: entry.fact_id, scenario_id: entry.scenario_id, reason,
      } };
  });
}
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v, 2) + '\n';
}
export function writeExpected() {
  const bytes = canonicalJson(parity2b());
  writeFileSync(new URL('expected.json', corpusDir), bytes);
  return bytes;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeExpected();
