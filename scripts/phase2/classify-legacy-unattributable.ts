/** AFTER migration operator; PGHOST/PGPORT/PGUSER/PGDATABASE + pgpass supply the target. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export interface LegacyBatchReceipt { inserted: number; removed: number }
export interface LegacyBatchStat extends LegacyBatchReceipt { batch: number; duration_ms: number }

/** Each invocation of runBatch must execute the SQL batch's own short transaction. */
export function classifyLegacyUnattributable(
  runBatch: () => LegacyBatchReceipt,
  emit: (stat: LegacyBatchStat) => void = stat => console.log(JSON.stringify(stat)),
  now: () => number = () => performance.now(),
): LegacyBatchStat[] {
  const stats: LegacyBatchStat[] = [];
  for (;;) {
    const start = now();
    const receipt = runBatch();
    if (!Number.isSafeInteger(receipt.inserted) || receipt.inserted < 0 || receipt.inserted > 500
      || !Number.isSafeInteger(receipt.removed) || receipt.removed < 0 || receipt.removed > 500) {
      throw new Error('Invalid legacy batch receipt; expected counts in [0,500]');
    }
    const stat = { ...receipt, batch: stats.length + 1, duration_ms: Math.max(0, now() - start) };
    stats.push(stat); emit(stat);
    if (receipt.inserted === 0) return stats;
  }
}

function runOperator(): void {
  if (process.env.CI) throw new Error('Legacy classification is an operator job, not CI');
  const batchFile = fileURLToPath(new URL('./classify-legacy-unattributable.sql', import.meta.url));
  const scopeIndex = process.argv.indexOf('--scenario-id');
  const scope = scopeIndex >= 0 ? process.argv[scopeIndex + 1] : '';
  if (scope === undefined || (scope !== '' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope))) {
    throw new Error('--scenario-id must be a UUID');
  }
  const stats = classifyLegacyUnattributable(() => {
    // Each subprocess owns BEGIN / SET LOCAL / <=500 inserts+deletes / COMMIT.
    // No connection string or credential is printed; libpq reads inherited PG*.
    const output = execFileSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', `classify_scenario_id=${scope}`, '-f', batchFile],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 });
    return JSON.parse(output.trim()) as LegacyBatchReceipt;
  });
  const durations = stats.map(stat => stat.duration_ms);
  console.log(JSON.stringify({ batches: stats.length, productive_batches: stats.filter(s => s.inserted > 0).length,
    inserted: stats.reduce((n, s) => n + s.inserted, 0), max_ms: Math.max(...durations),
    avg_ms: durations.reduce((n, ms) => n + ms, 0) / durations.length }));
  const index = process.argv.indexOf('--stats-sql');
  if (index >= 0) {
    const path = process.argv[index + 1];
    if (!path) throw new Error('--stats-sql requires a local file path');
    writeFileSync(path, 'CREATE TEMP TABLE phase2_c_bulk_stats(batch integer, inserted integer, removed integer, duration_ms double precision);\n'
      + stats.map(s => `INSERT INTO phase2_c_bulk_stats VALUES (${s.batch},${s.inserted},${s.removed},${s.duration_ms});`).join('\n') + '\n');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) console.log('After slice C migration: PGHOST=... PGPORT=... PGUSER=... PGDATABASE=... node --import tsx scripts/phase2/classify-legacy-unattributable.ts\nBatches <=500, independent transactions, lock_timeout=3s, statement_timeout=10s; stops at inserted=0.');
  else {
    try { runOperator(); }
    catch (error) { console.error(error instanceof Error ? error.message : 'Legacy classification failed'); process.exitCode = 1; }
  }
}
