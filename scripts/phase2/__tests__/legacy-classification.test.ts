import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { legacyClassificationCorpus, legacyMapperSet, legacyRehearsalFixtureSql } from '../legacy-classification-corpus.js';
import { classifyLegacyUnattributable, parseLegacyOperatorArgs, extractLegacyBatchSql, legacyRehearsalSourceSql } from '../classify-legacy-unattributable.js';

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
  it('continues after zero matches, advances the scanned cursor, and stops only on an empty scan', () => {
    const zero = '00000000-0000-0000-0000-000000000000';
    const ids = [2, 1].map(i => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    const receipts = [
      { scanned: 250, inserted: 0, removed: 0, next_created_at: '2026-10-09 00:00:00.000001+00', next_id: ids[0]! },
      { scanned: 1, inserted: 1, removed: 1, next_created_at: '2026-10-09 00:00:00.000002+00', next_id: ids[1]! },
      { scanned: 0, inserted: 0, removed: 0, next_created_at: null, next_id: null },
    ];
    let calls = 0; let clock = 0;
    const cursors: unknown[] = []; const emitted: unknown[] = [];
    const stats = classifyLegacyUnattributable(cursor => {
      cursors.push({ ...cursor }); return receipts[calls++]!;
    }, stat => emitted.push(stat), () => clock++);
    expect(calls).toBe(3);
    expect(cursors).toEqual([
      { last_created_at: '-infinity', last_id: zero },
      { last_created_at: receipts[0]!.next_created_at, last_id: ids[0] },
      { last_created_at: receipts[1]!.next_created_at, last_id: ids[1] },
    ]);
    expect(emitted).toEqual(stats);
    expect(stats.every(s => s.duration_ms === 1)).toBe(true);
    expect(stats.reduce((n, s) => n + s.inserted, 0)).toBe(1);
    expect(stats[2]).toMatchObject({ last_created_at: receipts[1]!.next_created_at, last_id: ids[1] });
  });
  it('accepts increasing UUIDs at a tied timestamp and rejects equal or regressing keys', () => {
    const at = '2026-10-09T00:00:00.000001Z';
    const id = '00000000-0000-0000-0000-000000000002';
    for (const [nextAt, nextId] of [[at, id], [at, id.replace(/2$/, '1')], ['2026-10-09T00:00:00Z', id],
      ['2026-10-09 01:00:00.000001+01', id]]) {
      expect(() => classifyLegacyUnattributable(() => ({ scanned: 1, inserted: 0, removed: 0,
        next_created_at: nextAt!, next_id: nextId! }), () => {}, undefined,
      { last_created_at: at, last_id: id })).toThrow(/cursor.*advance/i);
    }
    let calls = 0;
    classifyLegacyUnattributable(() => calls++ === 0
      ? { scanned: 1, inserted: 0, removed: 0, next_created_at: at, next_id: id.replace(/2$/, '3') }
      : { scanned: 0, inserted: 0, removed: 0, next_created_at: null, next_id: null }, () => {}, undefined,
    { last_created_at: at, last_id: id });
    expect(calls).toBe(2);
  });
  it.each([
    { scanned: 251, inserted: 0, removed: 0 },
    { scanned: 2, inserted: 3, removed: 0 },
    { scanned: 2, inserted: 0, removed: 3 },
    { scanned: -1, inserted: 0, removed: 0 },
    { scanned: 1.5, inserted: 0, removed: 0 },
    { scanned: 1, inserted: -1, removed: 0 },
    { scanned: 1, inserted: 0, removed: NaN },
    { scanned: 0, inserted: 1, removed: 0 },
  ])('rejects invalid receipt counts: %j', counts => {
    let calls = 0;
    expect(() => classifyLegacyUnattributable(() => {
      if (calls++) throw new Error('unexpected second batch');
      return { ...counts, next_created_at: null, next_id: null };
    }))
      .toThrow(/Invalid legacy batch receipt/);
  });
  it('rejects missing or malformed scanned keys and unexpected keys on an empty receipt', () => {
    for (const [scanned, at, id] of [[1, null, null], [1, 'bad', 'bad'],
      [0, '2026-10-09T00:00:00Z', '00000000-0000-0000-0000-000000000001']] as const) {
      expect(() => classifyLegacyUnattributable(() => ({ scanned, inserted: 0, removed: 0,
        next_created_at: at, next_id: id }))).toThrow(/Invalid legacy batch receipt/);
    }
    let calls = 0;
    expect(() => classifyLegacyUnattributable(() => { calls++; throw new Error('timeout'); })).toThrow('timeout');
    expect(calls).toBe(1);
  });
  it('parses resume flags and passes the exact cursor to the first batch', () => {
    const at = '2026-10-09 12:34:56.123456+00'; const id = '00000000-0000-0000-0000-000000000042';
    const args = parseLegacyOperatorArgs(['--start-created-at', at, '--start-id', id, '--scenario-id', id,
      '--stats-sql', '/tmp/stats.sql']);
    expect(args).toEqual({ cursor: { last_created_at: at, last_id: id }, scenarioId: id, statsSql: '/tmp/stats.sql' });
    const cursors: unknown[] = [];
    classifyLegacyUnattributable(cursor => { cursors.push(cursor);
      return { scanned: 0, inserted: 0, removed: 0, next_created_at: null, next_id: null };
    }, () => {}, undefined, args.cursor);
    expect(cursors).toEqual([args.cursor]);
    expect(parseLegacyOperatorArgs([]).cursor.last_created_at).toBe('-infinity');
  });
  it.each([
    ['--start-id', '00000000-0000-0000-0000-000000000042'], ['--start-created-at', '2026-10-09T00:00:00Z'],
    ['--start-created-at', 'bad', '--start-id', 'bad'], ['--start-id'], ['--scenario-id'],
    ['--scenario-id', 'bad'], ['--stats-sql'], ['--unknown'],
  ].map(args => ({ args })))('rejects incomplete or invalid operator arguments: $args', ({ args }) => {
    expect(() => parseLegacyOperatorArgs(args)).toThrow();
  });
  it('batch predicate has the canonical semantics after resolving the result alias and scan eligibility', () => {
    const sql = readFileSync(new URL('../classify-legacy-unattributable.sql', import.meta.url), 'utf8');
    const canonical = readFileSync(new URL('../legacy-unattributable-predicate.sql', import.meta.url), 'utf8');
    const body = canonical.match(/\$predicate\$\s*SELECT ([\s\S]*?);\s*\$predicate\$/)?.[1];
    expect(body).toBeDefined();
    expect(body).toMatch(/p_action_type = 'run_analysis'\s+AND p_noop IS FALSE\s+AND/);
    const normalise = (text: string) => text.replaceAll('p_payload', 'h.payload')
      .replaceAll("h.payload->'result'", 'p.result').replace(/\(p\.result\)\s*\?/g, 'p.result ?')
      .replace(/'(?:''|[^'])*'|\s+/g, token => token.startsWith("'") ? token : '');
    const withoutEligibility = body!.replace(/p_action_type = 'run_analysis'\s+AND p_noop IS FALSE\s+AND/, '');
    expect(normalise(extractLegacyBatchSql(sql).predicate)).toBe(normalise(withoutEligibility));
  });
  it('rehearsal loads the batch statement and predicate from their source file, without embedded copies', () => {
    const sql = readFileSync(new URL('../classify-legacy-unattributable.sql', import.meta.url), 'utf8');
    const bulk = readFileSync(new URL('../rehearse-c-legacy-bulk.sql', import.meta.url), 'utf8');
    const source = extractLegacyBatchSql(sql);
    expect(source.statement).toContain('WITH scanned AS MATERIALIZED');
    expect(source.statement).toContain('($1::timestamptz,$2::uuid)');
    expect(source.statement).not.toMatch(/:'classify_/);
    const generated = legacyRehearsalSourceSql(sql);
    expect(generated).toContain(source.statement.replaceAll("'", "''"));
    expect(generated).toContain(source.predicate.replaceAll("'", "''"));
    expect(bulk).toContain('--rehearsal-sql');
    expect(bulk).toContain('SELECT statement INTO STRICT batch_sql FROM phase2_c_batch_source');
    expect(bulk).toContain('SELECT predicate INTO STRICT predicate_sql FROM phase2_c_batch_source');
    expect(bulk).not.toContain('WITH scanned AS MATERIALIZED');
    expect(bulk).not.toContain("p.result->'run_id'");
    expect(bulk).toContain('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)');
    expect(bulk).toContain("child->>'Index Name'='analysis_run_facts_sweep_idx'");
  });
  it('rejects source extraction without its explicit predicate boundaries or batch statement', () => {
    expect(() => extractLegacyBatchSql('SELECT 1;')).toThrow();
    const sql = readFileSync(new URL('../classify-legacy-unattributable.sql', import.meta.url), 'utf8');
    expect(() => extractLegacyBatchSql(sql.replace('-- legacy-predicate-end', '-- missing-end'))).toThrow();
  });
  it('rehearsal derives scaled counts and pads every source fixture with fresh random text', () => {
    const bulk = readFileSync(new URL('../rehearse-c-legacy-bulk.sql', import.meta.url), 'utf8');
    expect(bulk).toContain('\\set phase2_c_payload_pad_bytes 0');
    expect(bulk).toContain('\\set phase2_c_bulk_scale 1');
    expect(bulk).toContain('2005*c.scale');
    expect(bulk).toContain('md5(random()::text)');
    expect(bulk).toContain("'{result,pad}'");
    expect(bulk).toContain('ceil(count(*)/250.0)');
    expect(bulk).toContain("kind='legacy'");
    expect(bulk).not.toMatch(/scanned=2062|sum\(inserted\)=2005|ordinal BETWEEN 1000 AND 3004/);
  });
  it('SQL scan fence precedes payload work, matches the sweep index and excludes terminal dispositions', () => {
    const sql = readFileSync(new URL('../classify-legacy-unattributable.sql', import.meta.url), 'utf8');
    const scan = sql.slice(sql.indexOf('WITH scanned'), sql.indexOf('), undisposed')).replace(/--[^\n]*/g, '');
    expect(scan).toContain('AS MATERIALIZED');
    expect(scan).toContain("WHERE action_type = 'run_analysis' AND NOT noop");
    expect(scan).toContain('(created_at,id) >');
    expect(scan).toContain('ORDER BY created_at,id LIMIT 250');
    expect(scan).not.toMatch(/payload|is_legacy|NOT EXISTS/i);
    expect(sql.match(/payload->'result'/g)).toHaveLength(1);
    expect(sql).toContain('CROSS JOIN LATERAL');
    expect(sql).toContain('OFFSET 0');
    expect(sql).toContain("SET LOCAL lock_timeout = '3s'");
    expect(sql).toContain("SET LOCAL statement_timeout = '10s'");
    expect(sql).toContain('ON CONFLICT (fact_id) DO NOTHING');
    const ids = sql.slice(sql.indexOf('), undisposed'), sql.indexOf('), evaluated')).replace(/--[^\n]*/g, '');
    expect(ids).toContain('AS MATERIALIZED');
    expect(ids).toContain('SELECT s.id');
    expect(ids).not.toMatch(/payload|is_legacy/i);
    expect(ids).toContain('FROM public.analysis_runs r WHERE r.fact_id=s.id');
    expect(ids).toContain('FROM public.analysis_run_unattributable u WHERE u.fact_id=s.id');
    expect(ids).toContain("malformed.reason IS DISTINCT FROM 'run_id_absent'");
    expect(sql).toContain('FROM undisposed d');
    expect(sql).toContain('WHERE h.id=d.id OFFSET 0');
    expect(sql).toContain("malformed.reason IS DISTINCT FROM 'run_id_absent'");
    expect(sql).toContain("'scanned',(SELECT count(*) FROM scanned)");
    expect(sql).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE|LOCK TABLE)\s+public\.v5_handler_facts|FOR (?:UPDATE|SHARE)/i);
  });
});
