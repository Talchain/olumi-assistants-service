#!/usr/bin/env node
/**
 * Wave 0 — apply ONLY 20260505120000_v5_pending_actions.sql to staging.
 *
 * - Reads SUPABASE_DB_PASSWORD from .env.staging.local (gitignored).
 * - Opens a direct SSL Postgres connection to the staging project.
 * - Inside ONE transaction:
 *     a) reads supabase_migrations.schema_migrations to verify the
 *        new file's timestamp is NOT already applied; aborts otherwise;
 *     b) executes the migration file's full contents;
 *     c) inserts a row into schema_migrations recording the apply.
 * - Then runs verification queries (pg_proc, information_schema,
 *   has_function_privilege) and prints results.
 *
 * Aborts on any unexpected condition. Prints a manual-rollback hint.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import postgres from 'postgres';

function loadEnv(path) {
  const raw = readFileSync(path, 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const MIGRATION_PATH = resolve(
  REPO_ROOT,
  'supabase/migrations/20260505120000_v5_pending_actions.sql',
);
const MIGRATION_VERSION = '20260505120000';
const MIGRATION_NAME = 'v5_pending_actions';

const env = loadEnv('/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env.staging.local');
if (!env.SUPABASE_URL || !env.SUPABASE_DB_PASSWORD) {
  console.error('FATAL: missing SUPABASE_URL or SUPABASE_DB_PASSWORD in .env.staging.local');
  process.exit(1);
}

const projectRef = new URL(env.SUPABASE_URL).hostname.split('.')[0];
const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');

console.log(`project ref       : ${projectRef}`);
console.log(`migration file    : ${MIGRATION_PATH}`);
console.log(`migration version : ${MIGRATION_VERSION}`);
console.log(`migration size    : ${migrationSql.length} bytes`);
console.log('---');

// Try direct connection first (db.<ref>.supabase.co:5432). If DNS or
// connect fails (some projects are IPv6-only and the pooler is the
// recommended path), fall back to common pooler regions.
const candidates = [
  {
    label: 'direct',
    host: `db.${projectRef}.supabase.co`,
    port: 5432,
    user: 'postgres',
  },
  {
    label: 'pooler us-east-1 (session)',
    host: 'aws-0-us-east-1.pooler.supabase.com',
    port: 5432,
    user: `postgres.${projectRef}`,
  },
  {
    label: 'pooler us-west-1 (session)',
    host: 'aws-0-us-west-1.pooler.supabase.com',
    port: 5432,
    user: `postgres.${projectRef}`,
  },
  {
    label: 'pooler eu-west-1 (session)',
    host: 'aws-0-eu-west-1.pooler.supabase.com',
    port: 5432,
    user: `postgres.${projectRef}`,
  },
  {
    label: 'pooler eu-central-1 (session)',
    host: 'aws-0-eu-central-1.pooler.supabase.com',
    port: 5432,
    user: `postgres.${projectRef}`,
  },
];

async function tryConnect(c) {
  const sql = postgres({
    host: c.host,
    port: c.port,
    user: c.user,
    password: env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: 'require',
    connect_timeout: 8,
    idle_timeout: 5,
    max: 1,
    onnotice: () => {},
  });
  try {
    const r = await sql`SELECT current_database() AS db, current_user AS user`;
    return { ok: true, sql, info: r[0] };
  } catch (e) {
    try { await sql.end({ timeout: 1 }); } catch {}
    return { ok: false, error: e };
  }
}

let chosen = null;
for (const c of candidates) {
  process.stdout.write(`probe connect [${c.label}] ${c.host}:${c.port} … `);
  const r = await tryConnect(c);
  if (r.ok) {
    console.log(`OK (db=${r.info.db}, user=${r.info.user})`);
    chosen = { ...c, sql: r.sql };
    break;
  }
  const msg = r.error?.message || String(r.error);
  console.log(`fail (${msg.split('\n')[0]})`);
}
if (!chosen) {
  console.error('FATAL: no connection candidate succeeded.');
  process.exit(1);
}

const sql = chosen.sql;

try {
  // Inside ONE transaction: pre-check, apply, record.
  await sql.begin(async (tx) => {
    // 1. Pre-check: schema_migrations row for this version must not exist.
    const existing = await tx`
      SELECT version FROM supabase_migrations.schema_migrations
       WHERE version = ${MIGRATION_VERSION}
    `;
    if (existing.length > 0) {
      throw new Error(
        `ABORT: schema_migrations already has version ${MIGRATION_VERSION}. ` +
          `Migration appears to be applied; not re-applying.`,
      );
    }

    // 2. Pre-check: column must not yet exist (otherwise prior partial
    //    apply from a different mechanism). The migration uses ADD COLUMN
    //    IF NOT EXISTS so this is informational; abort if it would be a
    //    surprise.
    const colCheck = await tx`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'v5_conversation_turns'
         AND column_name = 'pending_actions'
    `;
    if (colCheck.length > 0) {
      throw new Error(
        'ABORT: pending_actions column already exists despite no schema_migrations row.',
      );
    }

    // 3. Run the migration file. Multi-statement; postgres.js sends as
    //    a single simple Query, supports plpgsql $$…$$ bodies.
    console.log('--- applying migration ---');
    await tx.unsafe(migrationSql);

    // 4. Record the apply in schema_migrations. Schema is
    //    (version text PK, name text, statements text[]).
    await tx`
      INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
      VALUES (${MIGRATION_VERSION}, ${MIGRATION_NAME}, ARRAY[${migrationSql}])
    `;
    console.log('--- migration applied; schema_migrations row inserted ---');
  });
} catch (e) {
  console.error('TRANSACTION FAILED:', e.message || e);
  console.error(
    'No changes were committed. To inspect manually, run:\n' +
      `  SELECT * FROM supabase_migrations.schema_migrations WHERE version = '${MIGRATION_VERSION}';\n` +
      "  SELECT proname, pronargs FROM pg_proc WHERE proname = 'append_turn_atomic';\n" +
      `  SELECT column_name, data_type FROM information_schema.columns\n` +
      `   WHERE table_schema='public' AND table_name='v5_conversation_turns' AND column_name='pending_actions';`,
  );
  await sql.end({ timeout: 2 });
  process.exit(1);
}

console.log('--- post-apply verification ---');

const proCheck = await sql`
  SELECT proname,
         pronargs,
         pg_get_function_identity_arguments(oid) AS sig
    FROM pg_proc
   WHERE proname = 'append_turn_atomic'
`;
console.log('append_turn_atomic functions:');
for (const r of proCheck) {
  console.log(`  pronargs=${r.pronargs}  sig=${r.sig}`);
}

const colMeta = await sql`
  SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name='v5_conversation_turns'
     AND column_name='pending_actions'
`;
console.log('pending_actions column metadata:');
for (const r of colMeta) console.log(`  `, r);

const grantCheck = await sql`
  SELECT has_function_privilege(
    'service_role',
    'public.append_turn_atomic(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb)',
    'EXECUTE'
  ) AS service_role_can_exec
`;
console.log(`service_role EXECUTE on 12-arg: ${grantCheck[0].service_role_can_exec}`);

const checkConstraint = await sql`
  SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
   WHERE conname = 'v5_conversation_turns_pending_actions_shape'
`;
console.log('CHECK constraint:');
for (const r of checkConstraint) console.log(`  ${r.conname}: ${r.def}`);

await sql.end({ timeout: 2 });
console.log('--- done ---');
