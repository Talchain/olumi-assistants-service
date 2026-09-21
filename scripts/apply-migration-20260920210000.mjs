#!/usr/bin/env node
/**
 * Apply (or roll back) 20260920210000_v5_append_v5_replay_precedes_cas.sql
 * against the shared Supabase project, LEDGER-AWARE.
 *
 * ⛔ PAUL-GATED. One Supabase project serves staging, production AND demo
 *    (all three CEE services carry the same SUPABASE_URL — measured
 *    2026-09-21T23:10Z via the fully-paginated Render API, 121/118/114 env
 *    vars). Running this IS a production schema change.
 *
 * Why this exists rather than `scripts/run-sql-migration.ts`: that script does
 * NOT write `supabase_migrations.schema_migrations`, so a migration applied
 * with it is invisible to the ledger and will be re-applied or mis-diffed
 * later. This follows `scripts/wave0-apply-migration.mjs`, which does.
 *
 * SAFETY, in order, all inside ONE transaction:
 *   1. the ledger must NOT already carry this version;
 *   2. the CURRENTLY INSTALLED body must be the one we proved against —
 *      md5(prosrc) = EXPECT_BEFORE. If someone has changed the function since,
 *      this aborts rather than overwriting work it has not seen;
 *   3. apply the file;
 *   4. record the ledger row (version, name, statements);
 *   5. post-check md5, arity, SECURITY DEFINER, ACL and the STATEMENT ORDER
 *      (comments stripped, body sliced after BEGIN) — any mismatch rolls the
 *      whole transaction back.
 *
 * USAGE (from the repo root, with .env.staging.local present):
 *   node scripts/apply-migration-20260920210000.mjs            # dry run
 *   node scripts/apply-migration-20260920210000.mjs --apply
 *   node scripts/apply-migration-20260920210000.mjs --rollback --apply
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import postgres from 'postgres';

const MIGRATION_VERSION = '20260920210000';
const MIGRATION_NAME = 'v5_append_v5_replay_precedes_cas';

/** md5(prosrc) of append_turn_atomic_v5 as deployed by 20260824200000. */
const MD5_C8 = '829c3deb90594099397d64d747f4854e';
/** md5(prosrc) after this migration. */
const MD5_FIXED = '7b78d8e12550628570e15b2b739c2d4d';

const ROLLBACK = process.argv.includes('--rollback');
const APPLY = process.argv.includes('--apply');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const FORWARD_PATH = resolve(
  REPO_ROOT,
  `supabase/migrations/${MIGRATION_VERSION}_${MIGRATION_NAME}.sql`,
);
const ROLLBACK_PATH = resolve(
  REPO_ROOT,
  `supabase/migrations/rollback/${MIGRATION_VERSION}_${MIGRATION_NAME}_rollback.sql.do-not-apply`,
);

const sqlPath = ROLLBACK ? ROLLBACK_PATH : FORWARD_PATH;
const migrationSql = readFileSync(sqlPath, 'utf8');
const expectBefore = ROLLBACK ? MD5_FIXED : MD5_C8;
const expectAfter = ROLLBACK ? MD5_C8 : MD5_FIXED;

function loadEnv(path) {
  const raw = readFileSync(path, 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const ENV_PATH = process.env.STAGING_ENV_FILE ?? '.env.staging.local';
const env = loadEnv(ENV_PATH);
if (!env.SUPABASE_URL || !env.SUPABASE_DB_PASSWORD) {
  console.error('FATAL: missing SUPABASE_URL or SUPABASE_DB_PASSWORD in', ENV_PATH);
  process.exit(1);
}
const projectRef = new URL(env.SUPABASE_URL).hostname.split('.')[0];

console.log(`direction         : ${ROLLBACK ? 'ROLLBACK' : 'FORWARD'}`);
console.log(`project ref       : ${projectRef}`);
console.log(`file              : ${sqlPath}`);
console.log(`file sha256       : ${createHash('sha256').update(migrationSql).digest('hex')}`);
console.log(`expect md5 before : ${expectBefore}`);
console.log(`expect md5 after  : ${expectAfter}`);
console.log(`mode              : ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no write)'}`);
console.log('---');

/** Port 5432 is the SESSION pooler; 6543 (transaction mode) cannot do DDL. */
const sql = postgres({
  host: 'aws-0-us-east-1.pooler.supabase.com',
  port: 5432,
  user: `postgres.${projectRef}`,
  password: env.SUPABASE_DB_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connect_timeout: 15,
  max: 1,
  onnotice: () => {},
});

/** Order probe: strip `--` comments, slice after BEGIN, then index. */
function ordering(def) {
  const stripped = def
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
  const beginAt = stripped.search(/\nBEGIN\b/);
  if (beginAt < 0) return null;
  const body = stripped.slice(beginAt);
  return {
    lookup: body.indexOf('INTO v_existing_turn_id'),
    cas: body.indexOf('IF p_cas_enforce'),
    guard: body.indexOf('IF NOT v_turn_preexisting THEN'),
  };
}

async function readState(tx) {
  const [row] = await tx`
    SELECT md5(p.prosrc) AS md5, p.pronargs, p.prosecdef, p.proacl::text AS acl,
           pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'append_turn_atomic_v5'`;
  return row;
}

let failed = false;
try {
  await sql.begin(async (tx) => {
    const ledger = await tx`
      SELECT version FROM supabase_migrations.schema_migrations
       WHERE version = ${MIGRATION_VERSION}`;
    const ledgerHas = ledger.length > 0;
    console.log(`ledger row present: ${ledgerHas}`);
    if (!ROLLBACK && ledgerHas) {
      throw new Error(`ABORT: ledger already carries ${MIGRATION_VERSION}.`);
    }
    if (ROLLBACK && !ledgerHas) {
      throw new Error(`ABORT: ledger has no ${MIGRATION_VERSION} row to remove.`);
    }

    const before = await readState(tx);
    if (!before) throw new Error('ABORT: append_turn_atomic_v5 is not installed.');
    console.log(`installed md5     : ${before.md5}  (nargs ${before.pronargs}, secdef ${before.prosecdef})`);
    console.log(`installed acl     : ${before.acl}`);
    if (before.md5 !== expectBefore) {
      throw new Error(
        `ABORT: installed body md5 ${before.md5} is not the expected ${expectBefore}. ` +
          'Someone changed this function since the proof was taken — re-derive before applying.',
      );
    }

    if (!APPLY) {
      console.log('DRY RUN: all pre-checks passed. Re-run with --apply to write.');
      throw new Error('__DRY_RUN__');
    }

    await tx.unsafe(migrationSql);

    if (ROLLBACK) {
      await tx`DELETE FROM supabase_migrations.schema_migrations WHERE version = ${MIGRATION_VERSION}`;
    } else {
      await tx`
        INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
        VALUES (${MIGRATION_VERSION}, ${MIGRATION_NAME}, ARRAY[${migrationSql}])`;
    }

    const after = await readState(tx);
    console.log(`resulting md5     : ${after.md5}`);
    console.log(`resulting acl     : ${after.acl}`);
    if (after.md5 !== expectAfter) {
      throw new Error(`ABORT: resulting md5 ${after.md5} is not the expected ${expectAfter}.`);
    }
    if (after.pronargs !== before.pronargs) throw new Error('ABORT: arity changed.');
    if (after.prosecdef !== before.prosecdef) throw new Error('ABORT: SECURITY DEFINER changed.');
    if (after.acl !== before.acl) throw new Error(`ABORT: ACL changed (${before.acl} -> ${after.acl}).`);

    const ord = ordering(after.def);
    if (!ord) throw new Error('ABORT: could not slice the body after BEGIN.');
    console.log(`order offsets     : lookup=${ord.lookup} cas=${ord.cas} guard=${ord.guard}`);
    if (ord.lookup < 0 || ord.cas < 0) throw new Error('ABORT: order probe is blind.');
    if (ROLLBACK) {
      if (ord.guard !== -1) throw new Error('ABORT: rollback left the replay guard in place.');
      if (ord.cas > ord.lookup) throw new Error('ABORT: rollback did not restore CAS-before-lookup.');
    } else {
      if (ord.guard < 0) throw new Error('ABORT: the replay guard is absent after apply.');
      if (ord.lookup > ord.cas) throw new Error('ABORT: the CAS still precedes the replay lookup.');
    }
    console.log(`--- ${ROLLBACK ? 'ROLLBACK' : 'MIGRATION'} committed, ledger updated ---`);
  });
} catch (e) {
  const msg = e?.message ?? String(e);
  if (msg === '__DRY_RUN__') {
    console.log('--- nothing was committed (dry run) ---');
  } else {
    failed = true;
    console.error('TRANSACTION ROLLED BACK:', msg);
  }
}

await sql.end({ timeout: 5 });
process.exit(failed ? 1 : 0);
