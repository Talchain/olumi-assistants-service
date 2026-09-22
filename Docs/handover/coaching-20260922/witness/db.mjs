/**
 * Shared connection for the wire-replay witness.
 *
 * Reads credentials from `.env.staging.local` at the repo root — that file is
 * gitignored and is NOT reproduced here. Nothing in this file is a secret.
 *
 * ⚠ ONLY `aws-0-us-east-1` RESOLVES. `eu-west-1` and `eu-west-2` both answer
 *   "Tenant or user not found", which reads like a credentials failure and is
 *   not one. Cost 20 minutes the first time.
 *
 * ⚠ The repo has `postgres` (postgres.js), NOT `pg`, and there is no `psql` on
 *   the usual macOS box. Import path is resolved from this file so the harness
 *   runs from anywhere.
 *
 * ⛔ staging, production and demo share ONE Supabase project. This harness only
 *    READS, plus INSERTs its own clearly-labelled throwaway scenarios. Do not
 *    extend it to write to anything it did not create.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.CEE_REPO_ROOT ?? path.resolve(HERE, '../../..');
const require = createRequire(import.meta.url);
const postgres = require(path.join(REPO_ROOT, 'node_modules/postgres'));

const envPath = process.env.CEE_ENV_FILE ?? path.join(REPO_ROOT, '.env.staging.local');
export const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

const ref = env.SUPABASE_URL.replace('https://', '').replace(/\.supabase\.co.*/, '');

export const sql = postgres({
  host: 'aws-0-us-east-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  username: `postgres.${ref}`,
  password: env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connect_timeout: 15,
  max: 1,
});
