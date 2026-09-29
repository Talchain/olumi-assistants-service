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
import { ensureLocalUser, ensureSigningKey, publicJwkOf } from './shared-data-signing-key.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// SHARED_DATA_LOCAL_INSTANCE=<name> runs a wholly separate stack (state dir, containers, ports) beside the default one,
// e.g. to measure a change without restarting a running session. Unset = the default stack, exactly as before.
const instance = process.env.SHARED_DATA_LOCAL_INSTANCE ?? '';
if (!/^[a-z0-9-]*$/.test(instance)) throw new Error('SHARED_DATA_LOCAL_INSTANCE must be [a-z0-9-]');
const suffix = instance === '' ? '' : `-${instance}`;
const port = Number(process.env.SHARED_DATA_LOCAL_PORT_BASE ?? 55431); // REST route; Postgres +1; PostgREST +2
const stateDir = resolve(homedir(), `.codex/workspaces/shared-data-spine-local${suffix}`);
const stateFile = resolve(stateDir, 'connection.json');
const network = `olumi-shared-data-local${suffix}`;
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
    supabaseUrl: `http://127.0.0.1:${port}`, databaseUrl: null,
  };
  state.databaseUrl = `postgres://postgres:${state.password}@127.0.0.1:${port + 1}/cee`;
  writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
}
if (!has('network', network)) docker('network', 'create', network);
if (!has('container', db)) {
  const envFile = resolve(stateDir, 'postgres.env');
  writeFileSync(envFile, `POSTGRES_PASSWORD=${state.password}\nPOSTGRES_DB=cee\n`, { mode: 0o600 });
  docker('run', '-d', '--name', db, '--label', 'olumi.experiment=shared-data', '--network', network,
    '--cpus', '1', '--memory', '384m', '-p', `127.0.0.1:${port + 1}:5432`, '--env-file', envFile, 'postgres:17');
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

// ── THE UI's OWN PLATFORM BASELINE (P0 builder 5889727894: reuse, never emulate) ──────────────────────────────────────
// The browser's own Supabase calls (scenario create/list/load, thread and turn RPCs) need columns and RPCs only the UI
// repository's migrations define. Their statements are applied VERBATIM from a UI checkout (SHARED_DATA_UI_ROOT), each
// file once, recorded as `ui:<file>`. The one rewrite: v2's `CREATE TABLE IF NOT EXISTS scenarios` is a no-op here (the
// table predates it), so its column definitions are lifted into ADD COLUMN IF NOT EXISTS — minus `id` and `user_id`
// (CEE 20260422000000 dropped the auth.users reference for guest mode). Left out: v2's PUBLIC scenario policies (the owner
// policy above covers every operation), every sharing RPC (it grants anon), and apply_patch_and_log (client graph writes
// are off: the UI's clientCanWriteReadableGraph() is false). RLS, the owner checks inside each RPC and anon's empty
// grants are exactly the UI's.
const sqlStatements = text => {
  const out = []; let cur = ''; let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const dollar = /^\$[A-Za-z0-9_]*\$/.exec(rest);
    if (dollar) { const end = text.indexOf(dollar[0], i + dollar[0].length); const stop = end < 0 ? text.length : end + dollar[0].length; cur += text.slice(i, stop); i = stop; continue; }
    if (rest.startsWith('--')) { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl; continue; }
    if (rest.startsWith('/*')) { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2; continue; }
    if (text[i] === "'") { let j = i + 1; while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1; cur += text.slice(i, j + 1); i = j + 1; continue; }
    if (text[i] === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += text[i]; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
const liftScenarioColumns = createTable => {
  const body = createTable.slice(createTable.indexOf('(') + 1, createTable.lastIndexOf(')'));
  const cols = []; let depth = 0, cur = '';
  for (const c of body) { if (c === ',' && depth === 0) { cols.push(cur.trim()); cur = ''; continue; } depth += c === '(' ? 1 : c === ')' ? -1 : 0; cur += c; }
  cols.push(cur.trim());
  const kept = cols.filter(c => c !== '' && !/^(id|user_id)\s/i.test(c)).map(c => `ADD COLUMN IF NOT EXISTS ${c.replace(/\s+/g, ' ')}`);
  return `ALTER TABLE scenarios ${kept.join(', ')}`;
};
const V2_RPCS = ['append_scenario_event', 'store_analysis_and_log', 'store_analysis_failure', 'store_brief_and_log', 'set_stage_and_log'];
const namesRpc = st => V2_RPCS.some(f => new RegExp(`FUNCTION\\s+(public\\.)?${f}\\s*\\(`, 'i').test(st));
const UI_BASELINE = [
  ['20260226000000_scenario_schema_v2.sql', sts => [
    liftScenarioColumns(sts.find(st => /^CREATE TABLE IF NOT EXISTS scenarios\s*\(/i.test(st))),
    ...sts.filter(st => /^CREATE INDEX IF NOT EXISTS idx_scenarios_/i.test(st)
      || /^CREATE OR REPLACE FUNCTION update_updated_at\(/i.test(st) || /^CREATE TRIGGER scenarios_updated_at\b/i.test(st)
      || (/^(CREATE OR REPLACE|GRANT|REVOKE)\b/i.test(st) && namesRpc(st))),
  ]],
  ['20260306000000_auth_hub_profiles.sql', sts => sts.filter(st => /^ALTER TABLE scenarios\s+ADD COLUMN IF NOT EXISTS is_pinned\b/i.test(st)
    || /^CREATE INDEX IF NOT EXISTS idx_scenarios_(hub_query|user_updated)\b/i.test(st))],
  ['20260308000000_thread_persistence.sql', sts => sts],
  ['20260309000000_scenario_snapshots.sql', sts => sts],
  ['20260309000001_conversation_turns.sql', sts => sts],
];
const uiRoot = process.env.SHARED_DATA_UI_ROOT;
if (!uiRoot) {
  console.warn('UI platform baseline NOT imported (set SHARED_DATA_UI_ROOT=<DecisionGuideAI checkout>): the browser\'s scenario create/list will fail.');
} else {
  const done = docker('exec', db, 'psql', '-U', 'postgres', '-d', 'cee', '-Atc',
    "SELECT name FROM public.shared_data_local_migrations WHERE name LIKE 'ui:%'").split('\n').filter(Boolean);
  const imported = [];
  for (const [file, pick] of UI_BASELINE) {
    if (done.includes(`ui:${file}`)) continue;
    const chosen = pick(sqlStatements(readFileSync(resolve(uiRoot, 'supabase/migrations', file), 'utf8')));
    if (chosen.length === 0 || chosen.includes(undefined)) throw new Error(`UI baseline: nothing matched in ${file}`);
    try { sql(`BEGIN;\n${chosen.map(st => `${st};`).join('\n')}\nINSERT INTO public.shared_data_local_migrations VALUES ('ui:${file}');\nCOMMIT;`); }
    catch (error) { throw new Error(`UI baseline failed: ${file}`, { cause: error }); }
    imported.push(`${file} (${chosen.length} statements)`);
  }
  // The synthetic user exists in the local auth.users, as a signed-in user does on the platform (snapshot/turn rows reference it).
  sql(`INSERT INTO auth.users (id) VALUES ('${ensureLocalUser(stateDir).id}') ON CONFLICT DO NOTHING; NOTIFY pgrst, 'reload schema';`);
  console.log(imported.length ? `Imported the UI platform baseline: ${imported.join('; ')}` : 'UI platform baseline already imported.');
}
// USER TOKENS: PostgREST verifies the same ES256 token CEE does (the experiment's one signing key) AND keeps the
// service_role HMAC secret, as one JWKS. The token's `role` claim (`authenticated`) selects the role and `sub` feeds
// auth.uid(), so RLS decides ownership exactly as for the HMAC path; anon keeps no grants.
const signingKey = ensureSigningKey(stateDir);
const jwks = { keys: [
  { kty: 'oct', alg: 'HS256', k: Buffer.from(state.secret, 'utf8').toString('base64url') },
  { ...publicJwkOf(signingKey), use: 'sig' },
] };
const restEnvFile = resolve(stateDir, 'postgrest.env');
const restEnv = `PGRST_DB_URI=postgres://authenticator:${state.password}@${db}:5432/cee\nPGRST_DB_SCHEMAS=public\nPGRST_DB_ANON_ROLE=anon\nPGRST_JWT_SECRET=${JSON.stringify(jwks)}\nPGRST_DB_POOL=3\n`;
// PostgREST reads its config at start and holds no data: a container whose ACTUAL env lacks this config (an older
// runner's, or a hand-made one) is replaced; the database container is never touched.
if (has('container', rest)) {
  const actual = JSON.parse(docker('inspect', '-f', '{{json .Config.Env}}', rest));
  if (!restEnv.trim().split('\n').every(line => actual.includes(line))) docker('rm', '-f', rest);
}
if (!has('container', rest)) {
  writeFileSync(restEnvFile, restEnv, { mode: 0o600 });
  docker('run', '-d', '--name', rest, '--label', 'olumi.experiment=shared-data', '--network', network,
    '--cpus', '0.5', '--memory', '128m', '-p', `127.0.0.1:${port + 2}:3000`, '--env-file', restEnvFile, 'postgrest/postgrest:v12.2.3');
} else docker('start', rest);

// Supabase's client adds /rest/v1. Forward bytes to real PostgREST; no queries,
// auth decisions, RPCs or persistence are implemented in this transport shim.
const server = http.createServer((req, res) => {
  if (!req.url?.startsWith('/rest/v1/')) { res.writeHead(404); res.end(); return; }
  const upstream = http.request({ hostname: '127.0.0.1', port: port + 2,
    method: req.method, path: req.url.slice('/rest/v1'.length), headers: req.headers }, reply => {
    res.writeHead(reply.statusCode ?? 502, reply.headers); reply.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end('Local PostgREST unavailable'); });
  req.pipe(upstream);
});
server.listen(port, '127.0.0.1', () => console.log(`Local Supabase REST route: ${state.supabaseUrl}; private connection file: ${stateFile}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
