/** AFTER migration operator; PGHOST/PGPORT/PGUSER/PGDATABASE + pgpass supply the target. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export interface LegacyCursor { last_created_at: string; last_id: string }
export interface LegacyBatchReceipt {
  scanned: number; inserted: number; removed: number;
  next_created_at: string | null; next_id: string | null;
}
export interface LegacyBatchStat extends LegacyBatchReceipt, LegacyCursor { batch: number; duration_ms: number }
const INITIAL_CURSOR: LegacyCursor = { last_created_at: '-infinity', last_id: '00000000-0000-0000-0000-000000000000' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PostgreSQL keys have microseconds. Date alone would collapse distinct keys
// into one millisecond and incorrectly reject a valid cursor advance.
function timestampKey(value: string): bigint | null {
  if (value === '-infinity') return null;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!match) throw new Error('Cursor timestamp must be -infinity or an ISO timestamp with timezone');
  const zone = match[4]!.length === 3 ? `${match[4]}:00` : match[4];
  const milliseconds = Date.parse(`${match[1]}T${match[2]}${zone}`);
  if (!Number.isFinite(milliseconds)) throw new Error('Invalid cursor timestamp');
  return BigInt(milliseconds) * 1000n + BigInt((match[3] ?? '').padEnd(6, '0'));
}
function validateCursor(cursor: LegacyCursor): void {
  if (typeof cursor.last_id !== 'string' || !UUID.test(cursor.last_id)
    || typeof cursor.last_created_at !== 'string') throw new Error('Invalid cursor UUID or timestamp');
  timestampKey(cursor.last_created_at);
}
function advances(next: LegacyCursor, prior: LegacyCursor): boolean {
  const nextAt = timestampKey(next.last_created_at); const priorAt = timestampKey(prior.last_created_at);
  if (nextAt !== priorAt) return nextAt !== null && (priorAt === null || nextAt > priorAt);
  return next.last_id.toLowerCase() > prior.last_id.toLowerCase();
}

/** Each invocation owns the SQL batch's transaction and scans at most 250 facts. */
export function classifyLegacyUnattributable(
  runBatch: (cursor: LegacyCursor) => LegacyBatchReceipt,
  emit: (stat: LegacyBatchStat) => void = stat => console.log(JSON.stringify(stat)),
  now: () => number = () => performance.now(),
  startCursor: LegacyCursor = INITIAL_CURSOR,
): LegacyBatchStat[] {
  validateCursor(startCursor);
  let cursor = { ...startCursor };
  const stats: LegacyBatchStat[] = [];
  for (;;) {
    const start = now();
    const receipt = runBatch({ ...cursor });
    if (!receipt || !Number.isSafeInteger(receipt.scanned) || receipt.scanned < 0 || receipt.scanned > 250
      || !Number.isSafeInteger(receipt.inserted) || receipt.inserted < 0 || receipt.inserted > receipt.scanned
      || !Number.isSafeInteger(receipt.removed) || receipt.removed < 0 || receipt.removed > receipt.scanned) {
      throw new Error('Invalid legacy batch receipt; expected scanned in [0,250] and disposition counts <= scanned');
    }
    if (receipt.scanned > 0) {
      if (typeof receipt.next_created_at !== 'string' || typeof receipt.next_id !== 'string') {
        throw new Error('Invalid legacy batch receipt; scanned rows require a cursor');
      }
      const next = { last_created_at: receipt.next_created_at, last_id: receipt.next_id };
      try { validateCursor(next); }
      catch { throw new Error('Invalid legacy batch receipt; malformed cursor'); }
      if (!advances(next, cursor)) throw new Error('Legacy batch cursor did not advance');
      cursor = next;
    } else if (receipt.next_created_at !== null || receipt.next_id !== null) {
      throw new Error('Invalid legacy batch receipt; empty scan must have null next keys');
    }
    // Always print the resumable cursor, including after the empty stop batch.
    const stat = { ...receipt, ...cursor, batch: stats.length + 1, duration_ms: Math.max(0, now() - start) };
    stats.push(stat); emit(stat);
    if (receipt.scanned === 0) return stats;
  }
}

export function parseLegacyOperatorArgs(args: string[]): { cursor: LegacyCursor; scenarioId: string; statsSql?: string } {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]!; const value = args[i + 1];
    if (!['--scenario-id', '--start-created-at', '--start-id', '--stats-sql'].includes(flag)
      || !value || value.startsWith('--') || flags.has(flag)) throw new Error('Invalid or missing operator argument');
    flags.set(flag, value);
  }
  if (flags.has('--start-created-at') !== flags.has('--start-id')) {
    throw new Error('Resume requires both --start-created-at and --start-id');
  }
  const cursor = { last_created_at: flags.get('--start-created-at') ?? INITIAL_CURSOR.last_created_at,
    last_id: flags.get('--start-id') ?? INITIAL_CURSOR.last_id };
  validateCursor(cursor);
  const scenarioId = flags.get('--scenario-id') ?? '';
  if (scenarioId && !UUID.test(scenarioId)) throw new Error('--scenario-id must be a UUID');
  return { cursor, scenarioId, ...(flags.has('--stats-sql') ? { statsSql: flags.get('--stats-sql')! } : {}) };
}

/** Extract the operator's own statement and marked data predicate; fail closed
 * if the source layout changes. No separately maintained rehearsal SQL body. */
export function extractLegacyBatchSql(sql: string): { statement: string; predicate: string } {
  const statement = sql.match(/(?:^|\n)(WITH scanned AS MATERIALIZED \([\s\S]+?;)\s*\nCOMMIT;/)?.[1];
  const predicate = statement?.match(/-- legacy-predicate-begin\s*([\s\S]+?)\s*-- legacy-predicate-end\s+AS is_legacy/)?.[1]?.trim();
  if (!statement || !predicate || sql.split('-- legacy-predicate-begin').length !== 2
    || sql.split('-- legacy-predicate-end').length !== 2) throw new Error('Invalid legacy batch SQL source boundaries');
  const parameterised = statement.replaceAll(":'classify_last_created_at'", '$1')
    .replaceAll(":'classify_last_id'", '$2').replaceAll(":'classify_scenario_id'", '$3');
  if (/:'/.test(parameterised)) throw new Error('Unexpected psql variable in legacy batch SQL source');
  return { statement: parameterised, predicate };
}

/** A session-local source row, generated afresh from the actual batch file. */
export function legacyRehearsalSourceSql(sql: string): string {
  const { statement, predicate } = extractLegacyBatchSql(sql);
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  return 'CREATE TEMP TABLE phase2_c_batch_source(statement text NOT NULL, predicate text NOT NULL);\n'
    + `INSERT INTO phase2_c_batch_source VALUES (${quote(statement)},${quote(predicate)});\n`;
}

function runOperator(): void {
  if (process.env.CI) throw new Error('Legacy classification is an operator job, not CI');
  const batchFile = fileURLToPath(new URL('./classify-legacy-unattributable.sql', import.meta.url));
  if (process.argv[2] === '--rehearsal-sql') {
    const target = process.argv[3];
    if (process.argv.length !== 4 || !target || target.startsWith('--')) throw new Error('--rehearsal-sql requires one local path');
    writeFileSync(target, legacyRehearsalSourceSql(readFileSync(batchFile, 'utf8')));
    return;
  }
  const options = parseLegacyOperatorArgs(process.argv.slice(2));
  const stats = classifyLegacyUnattributable(cursor => {
    // Each subprocess owns BEGIN / SET LOCAL / <=250 scans / COMMIT.
    // Suppress subprocess errors: child_process errors can contain libpq
    // diagnostics. Never print inherited credentials or connection strings.
    let output: string;
    try {
      output = execFileSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
        '-v', `classify_scenario_id=${options.scenarioId}`,
        '-v', `classify_last_created_at=${cursor.last_created_at}`, '-v', `classify_last_id=${cursor.last_id}`, '-f', batchFile],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 });
    } catch { throw new Error('Legacy psql batch failed; resume from the last printed cursor'); }
    try { return JSON.parse(output.trim()) as LegacyBatchReceipt; }
    catch { throw new Error('Invalid legacy batch JSON receipt; resume from the last printed cursor'); }
  }, undefined, undefined, options.cursor);
  const durations = stats.map(stat => stat.duration_ms);
  console.log(JSON.stringify({ batches: stats.length, productive_batches: stats.filter(s => s.scanned > 0).length,
    scanned: stats.reduce((n, s) => n + s.scanned, 0), inserted: stats.reduce((n, s) => n + s.inserted, 0),
    max_ms: Math.max(...durations), avg_ms: durations.reduce((n, ms) => n + ms, 0) / durations.length }));
  if (options.statsSql) {
    // All SQL values below are validated counts/keys, with literal quoting.
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    writeFileSync(options.statsSql, 'CREATE TEMP TABLE phase2_c_bulk_stats(batch integer, scanned integer, inserted integer, removed integer, duration_ms double precision, last_created_at timestamptz, last_id uuid);\n'
      + stats.map(s => `INSERT INTO phase2_c_bulk_stats VALUES (${s.batch},${s.scanned},${s.inserted},${s.removed},${s.duration_ms},${quote(s.last_created_at)},${quote(s.last_id)});`).join('\n') + '\n');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) console.log('After slice C migration: PGHOST=... PGPORT=... PGUSER=... PGDATABASE=... node --import tsx scripts/phase2/classify-legacy-unattributable.ts\nBatches <=250 scanned facts, independent transactions, lock_timeout=3s, statement_timeout=10s; stops at scanned=0.\nResume: --start-created-at <last_created_at> --start-id <last_id>. --scenario-id <UUID> is for rehearsal only; --stats-sql <local path> records receipts. --rehearsal-sql <local path> exports batch source for local SQL proofs.');
  else {
    try { runOperator(); }
    catch (error) { console.error(error instanceof Error ? error.message : 'Legacy classification failed'); process.exitCode = 1; }
  }
}
