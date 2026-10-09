import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { legacyClassificationCorpus, legacyMapperSet, legacyRehearsalFixtureSql } from '../legacy-classification-corpus.js';
import { classifyLegacyUnattributable } from '../classify-legacy-unattributable.js';

const expected = ['02-legacy-missing-run', '03-legacy-null-run', 'synthetic-missing', 'synthetic-null',
  'synthetic-blocked', 'synthetic-enrichment-array', 'synthetic-enrichment-null', 'synthetic-payload-noop-overridden'].sort();
describe('legacy classifier parity and bounded operator', () => {
  it.each(['live', 'backfill'] as const)('TS half: 31 corpus cases + synthetic persisted boundaries have the exact unattributable set in %s', mode => {
    const rows = legacyClassificationCorpus();
    expect(rows).toHaveLength(53);
    expect(new Set(rows.map(r => r.case_id)).size).toBe(rows.length);
    expect(legacyMapperSet(rows, mode)).toEqual(expected);
    const sql = legacyRehearsalFixtureSql();
    expect(sql.match(/INSERT INTO phase2_c_parity VALUES/g)).toHaveLength(rows.length);
    // The SQL half reads these same payloads/TS expectations and evaluates the
    // shared SQL predicate in the rehearsal; no second TS predicate is invented.
    for (const id of expected) expect(sql).toContain(`'${id}'`);
  });
  it('runs five productive <=500 batches, commits via the runner, prints each duration, then stops on zero', () => {
    const receipts = [500, 500, 500, 500, 5, 0]; const emitted: number[] = [];
    let calls = 0; let clock = 0;
    const stats = classifyLegacyUnattributable(() => ({ inserted: receipts[calls++]!, removed: 0 }),
      stat => emitted.push(stat.inserted), () => clock++);
    expect(calls).toBe(6); expect(emitted).toEqual(receipts);
    expect(stats.every(s => s.duration_ms === 1)).toBe(true);
    expect(stats.reduce((n, s) => n + s.inserted, 0)).toBe(2005);
  });
  it('rejects an oversized batch and stops immediately on a real batch error', () => {
    expect(() => classifyLegacyUnattributable(() => ({ inserted: 501, removed: 0 }))).toThrow(/\[0,500\]/);
    let calls = 0;
    expect(() => classifyLegacyUnattributable(() => { calls++; throw new Error('timeout'); })).toThrow('timeout');
    expect(calls).toBe(1);
  });
  it('SQL batch is separate, read-only on source, bounded and excludes existing terminal dispositions', () => {
    const sql = readFileSync(new URL('../classify-legacy-unattributable.sql', import.meta.url), 'utf8');
    expect(sql).toContain("SET LOCAL lock_timeout = '3s'");
    expect(sql).toContain("SET LOCAL statement_timeout = '10s'");
    expect(sql).toContain('ORDER BY h.created_at,h.id LIMIT 500');
    expect(sql).toContain('ON CONFLICT (fact_id) DO NOTHING');
    expect(sql).toContain('FROM public.analysis_runs r WHERE r.fact_id=h.id');
    expect(sql).toContain("malformed.reason IS DISTINCT FROM 'run_id_absent'");
    expect(sql).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE|LOCK TABLE)\s+public\.v5_handler_facts|FOR (?:UPDATE|SHARE)/i);
  });
});
