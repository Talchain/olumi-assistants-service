#!/usr/bin/env node
// Disposable local transport for the existing SupabaseSessionStore and SQL RPCs.
// This never reads the application's .env or accepts a remote database URL.
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = fileURLToPath(new URL('../../', import.meta.url));
const stateDir = resolve(homedir(), '.codex/workspaces/shared-data-spine-local');
const stateFile = resolve(stateDir, 'connection.json');
const network = 'olumi-shared-data-local';
const db = `${network}-db`;
const rest = `${network}-rest`;
const command = process.argv[2] ?? 'serve';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const has = (kind, name) => { try { docker(kind, 'inspect', name); return true; } catch { return false; } };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

if (command === 'stop') {
  for (const name of [rest, db]) if (has('container', name)) docker('stop', name);
  console.log('Stopped only the shared-data experiment containers; data retained.');
  process.exit(0);
}
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
let state;
if (existsSync(stateFile)) state = JSON.parse(readFileSync(stateFile, 'utf8'));
else {
  const secret = randomBytes(32).toString('hex');
  const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'service_role', iss: 'local-shared-data', exp: Math.floor(Date.now() / 1000) + 604800 })}`;
  state = {
    secret, password: randomBytes(24).toString('hex'),
    serviceRoleKey: `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`,
    supabaseUrl: 'http://127.0.0.1:55431', databaseUrl: null,
  };
  state.databaseUrl = `postgres://postgres:${state.password}@127.0.0.1:55432/cee`;
  writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
}
if (!has('network', network)) docker('network', 'create', network);
if (!has('container', db)) {
  const envFile = resolve(stateDir, 'postgres.env');
  writeFileSync(envFile, `POSTGRES_PASSWORD=${state.password}\nPOSTGRES_DB=cee\n`, { mode: 0o600 });
  docker('run', '-d', '--name', db, '--label', 'olumi.experiment=shared-data', '--network', network,
    '--cpus', '1', '--memory', '384m', '-p', '127.0.0.1:55432:5432', '--env-file', envFile, 'postgres:17');
} else docker('start', db);
let ready = false;
for (let i = 0; i < 40; i++) {
  try { docker('exec', db, 'pg_isready', '-U', 'postgres', '-d', 'cee'); ready = true; break; } catch { await pause(500); }
}
if (!ready) throw new Error('Local Postgres did not become ready');
const sql = input => execFileSync('docker', ['exec', '-i', db, 'psql', '-U', 'postgres', '-d', 'cee', '-v', 'ON_ERROR_STOP=1', '-q'],
  { input, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
if (!existsSync(resolve(stateDir, 'migrations.json'))) {
  // The scenario table predates this repository's migrations. Baseline from
  // tests/integration/README-c4-local-db.md; auth.uid reads real JWT claims.
  if (!docker('exec', db, 'psql', '-U', 'postgres', '-d', 'cee', '-Atc', "SELECT coalesce(to_regclass('public.shared_data_local_migrations')::text, '')")) sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE authenticator LOGIN PASSWORD '${state.password}' NOINHERIT;
    GRANT anon, authenticated, service_role TO authenticator;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
    CREATE TABLE public.scenarios (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, workspace_id uuid,
      brief jsonb, graph jsonb, events jsonb NOT NULL DEFAULT '[]', event_seq integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON public.scenarios TO service_role;
    CREATE POLICY local_scenario_owner ON public.scenarios TO authenticated
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenarios TO authenticated;
    GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
    CREATE TABLE public.shared_data_local_migrations (name text PRIMARY KEY);
    ALTER TABLE public.shared_data_local_migrations ENABLE ROW LEVEL SECURITY;`);
  sql(`CREATE TABLE IF NOT EXISTS public.shared_briefs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scenario_id uuid REFERENCES public.scenarios(id),
    user_id uuid, brief jsonb, graph_hash text, seed_used integer, response_hash text,
    slug text, created_at timestamptz DEFAULT now());
    ALTER TABLE public.shared_briefs ENABLE ROW LEVEL SECURITY;`);
  const skipped = new Set(['20260226010000_scenario_schema_v2_0_1_hardening.sql', '20260610120000_v5_db_security_tier1_hardening.sql']);
  const applied = docker('exec', db, 'psql', '-U', 'postgres', '-d', 'cee', '-Atc',
    'SELECT name FROM public.shared_data_local_migrations ORDER BY name').split('\n').filter(Boolean);
  for (const file of readdirSync(resolve(root, 'supabase/migrations')).filter(x => x.endsWith('.sql')).sort()) {
    if (skipped.has(file)) continue; // Legacy sharing/observation tables outside this local fixture.
    if (applied.includes(file)) continue;
    try { sql(readFileSync(resolve(root, 'supabase/migrations', file), 'utf8')); }
    catch (error) { throw new Error(`Local migration failed: ${file}`, { cause: error }); }
    sql(`INSERT INTO public.shared_data_local_migrations VALUES ('${file}');`);
    applied.push(file);
  }
  writeFileSync(resolve(stateDir, 'migrations.json'), JSON.stringify({ applied, skipped: [...skipped] }, null, 2));
  console.log(`Applied ${applied.length} repository migrations to isolated Postgres.`);
}
// Supabase supplies these service-role grants outside application migrations.
// Reproduce that platform baseline without granting the anonymous role access.
sql(`GRANT USAGE ON SCHEMA public TO service_role;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;`);
if (!has('container', rest)) {
  const envFile = resolve(stateDir, 'postgrest.env');
  writeFileSync(envFile, `PGRST_DB_URI=postgres://authenticator:${state.password}@${db}:5432/cee\nPGRST_DB_SCHEMAS=public\nPGRST_DB_ANON_ROLE=anon\nPGRST_JWT_SECRET=${state.secret}\nPGRST_DB_POOL=3\n`, { mode: 0o600 });
  docker('run', '-d', '--name', rest, '--label', 'olumi.experiment=shared-data', '--network', network,
    '--cpus', '0.5', '--memory', '128m', '-p', '127.0.0.1:55433:3000', '--env-file', envFile, 'postgrest/postgrest:v12.2.3');
} else docker('start', rest);

// Supabase's client adds /rest/v1. Forward bytes to real PostgREST; no queries,
// auth decisions, RPCs or persistence are implemented in this transport shim.
const server = http.createServer((req, res) => {
  if (!req.url?.startsWith('/rest/v1/')) { res.writeHead(404); res.end(); return; }
  const upstream = http.request({ hostname: '127.0.0.1', port: 55433,
    method: req.method, path: req.url.slice('/rest/v1'.length), headers: req.headers }, reply => {
    res.writeHead(reply.statusCode ?? 502, reply.headers); reply.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end('Local PostgREST unavailable'); });
  req.pipe(upstream);
});
server.listen(55431, '127.0.0.1', () => console.log(`Local Supabase REST route: ${state.supabaseUrl}; private connection file: ${stateFile}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
