#!/usr/bin/env node
/**
 * Ledger-aware, guarded applier for ONE migration against the shared Supabase project.
 *
 * ⛔ THIS WRITES TO A SHARED PRODUCTION DATABASE. It refuses to do anything unless
 *    MIGRATION_APPLY_APPROVED=1 is set, and it is Paul's decision alone.
 *
 * Default mode is --check: it measures and prints, and writes NOTHING. Run that first, always.
 *
 * WHY A BESPOKE RUNNER. scripts/run-sql-migration.ts executes SQL but does NOT insert the row into
 * supabase_migrations.schema_migrations, so a migration applied with it is invisible to every later
 * "has this landed?" question — which is exactly the confusion that made the c8 header wrong twice.
 * scripts/wave0-apply-migration.mjs has the ledger-aware pattern but is hardcoded to one version.
 *
 * WHAT IT PROVES, BEFORE AND AFTER, so the result is not a matter of opinion:
 *   the executable body of the target function is sliced after BEGIN with -- comments stripped, and
 *   the byte offsets of the CAS guard and the replay lookup are printed. Before: CAS precedes the
 *   lookup. After: the lookup precedes CAS. Anything else and it aborts / reports failure.
 *   An ordering measured with a regex a DECLARE line can satisfy has produced the opposite answer
 *   in this estate before; slicing after BEGIN is what prevents that.
 *
 * Usage:
 *   node apply-migration.mjs --check                      # read-only, safe, do this first
 *   MIGRATION_APPLY_APPROVED=1 node apply-migration.mjs --apply
 *   MIGRATION_APPLY_APPROVED=1 node apply-migration.mjs --rollback
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const VERSION = '20260920210000'
const NAME = 'v5_append_v5_replay_precedes_cas'
const FN = 'append_turn_atomic_v5'
const REPO = process.env.CEE_REPO ?? '/private/tmp/claude-502/-Users-paulslee-Documents-GitHub/b9b90b64-25c1-4a6a-b2e8-866693c995f7/scratchpad/cee'
const SQL_PATH = `${REPO}/supabase/migrations/${VERSION}_${NAME}.sql`
const ROLLBACK_PATH = `${REPO}/supabase/migrations/rollback/${VERSION}_${NAME}_rollback.sql.do-not-apply`

const ENV_FILE = '/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env.staging.local'
function envVal(key) {
  const line = readFileSync(ENV_FILE, 'latin1').split('\n').find((l) => l.startsWith(`${key}=`))
  if (!line) throw new Error(`missing ${key} in env file`)
  return line.slice(key.length + 1).replace(/["'\r]/g, '').trim()
}

function connect() {
  const url = envVal('SUPABASE_URL')
  const ref = url.replace('https://', '').split('.')[0]
  return new Client({
    host: 'aws-0-us-east-1.pooler.supabase.com',
    port: 5432,
    user: `postgres.${ref}`,
    password: envVal('SUPABASE_DB_PASSWORD'),
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  })
}

/** Offsets of the CAS guard and the replay lookup inside the EXECUTABLE body only. */
async function measureOrdering(c) {
  const { rows } = await c.query(
    `select pg_get_functiondef(p.oid) def from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname=$1`, [FN])
  if (rows.length !== 1) return { error: `expected 1 ${FN}, found ${rows.length}` }
  const def = rows[0].def
  const begin = def.indexOf('\nBEGIN')
  if (begin < 0) return { error: 'no BEGIN found in function definition' }
  const body = def.slice(begin).replace(/--[^\n]*/g, '')
  const at = (needle) => { const i = body.indexOf(needle); return i < 0 ? null : i }
  const cas = at('IF p_cas_enforce')
  const raise = at("ERRCODE = 'OLGC1'")
  const lookup = at('INTO v_existing_turn_id')
  const guard = at('IF NOT v_turn_preexisting')
  return {
    casGuard: cas, olgc1Raise: raise, replayLookup: lookup, preexistingGuard: guard,
    bodyLength: body.length,
    ordering: cas === null || lookup === null ? 'UNMEASURABLE'
      : lookup < cas ? 'REPLAY_BEFORE_CAS (fixed)' : 'CAS_BEFORE_REPLAY (defective)',
  }
}

async function ledger(c) {
  const { rows } = await c.query(
    `select version, name from supabase_migrations.schema_migrations where version = $1`, [VERSION])
  return rows
}

async function main() {
  const mode = process.argv.includes('--apply') ? 'apply'
    : process.argv.includes('--rollback') ? 'rollback' : 'check'
  const approved = process.env.MIGRATION_APPLY_APPROVED === '1'
  const stamp = new Date().toISOString()
  const c = connect()
  await c.connect()
  try {
    if (mode === 'check') await c.query('set transaction read only')

    const before = await measureOrdering(c)
    const led = await ledger(c)
    console.log(JSON.stringify({ stamp, mode, function: FN, version: VERSION,
      ledgerRowPresent: led.length > 0, orderingBefore: before }, null, 2))

    if (mode === 'check') {
      console.log('\nCHECK ONLY — nothing was written.')
      console.log(before.ordering === 'CAS_BEFORE_REPLAY (defective)'
        ? 'Live function is DEFECTIVE and the migration is NOT in the ledger: the apply is warranted.'
        : 'Live ordering is not the defective one — re-read before applying anything.')
      return
    }
    if (!approved) throw new Error('MIGRATION_APPLY_APPROVED=1 is required; this is Paul’s decision')
    if (mode === 'apply' && led.length > 0) throw new Error(`ledger already contains ${VERSION} — refusing to re-apply`)

    const sql = readFileSync(mode === 'apply' ? SQL_PATH : ROLLBACK_PATH, 'utf8')
    if (!/CREATE OR REPLACE FUNCTION public\.append_turn_atomic_v5/.test(sql)) {
      throw new Error('safety check failed: file does not CREATE OR REPLACE the expected function')
    }
    if (/\bDROP\s+FUNCTION\b/i.test(sql) || /\bDROP\s+TABLE\b/i.test(sql) || /\bDELETE\s+FROM\b/i.test(sql)) {
      throw new Error('safety check failed: file contains a destructive statement')
    }

    await c.query('BEGIN')
    await c.query(sql)
    if (mode === 'apply') {
      await c.query(
        `insert into supabase_migrations.schema_migrations (version, name, statements)
         values ($1, $2, $3) on conflict (version) do nothing`, [VERSION, NAME, [sql]])
    } else {
      await c.query(`delete from supabase_migrations.schema_migrations where version = $1`, [VERSION])
    }
    const after = await measureOrdering(c)
    const want = mode === 'apply' ? 'REPLAY_BEFORE_CAS (fixed)' : 'CAS_BEFORE_REPLAY (defective)'
    if (after.ordering !== want) {
      await c.query('ROLLBACK')
      throw new Error(`post-state ordering is ${after.ordering}, expected ${want} — ROLLED BACK, nothing changed`)
    }
    await c.query('COMMIT')
    console.log(JSON.stringify({ stamp: new Date().toISOString(), mode, result: 'COMMITTED', orderingAfter: after }, null, 2))
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
