#!/usr/bin/env node
// Local boot of the REAL CEE server (src/server.ts `build()`: every route, auth and ownership check) against the
// shared-data experiment's LOCAL PostgREST (scripts/dev/shared-data-db.mjs). Run it with tsx so the TypeScript app loads:
//
//   npx tsx scripts/dev/shared-data-api.mjs [--port 8787] [--require-user-jwt true|false] [--env-dir <dir with .env files>]
//                                           [--origins <comma-separated browser origins; default the UI's :5173>]
//
// Data target: ONLY `connection.json` from the experiment's private state dir, refused unless it is 127.0.0.1.
// Credentials: every inherited SUPABASE_* / ANTHROPIC_* / telemetry var is scrubbed first; then an explicit
// allowlist is read from the existing env files (OpenAI key; PLoT URL + token; the assist key). Nothing is printed.
// User auth is the real path (ES256 via SUPABASE_JWKS_URL, issuer `<SUPABASE_URL>/auth/v1`, audience
// `authenticated`): this script serves a LOCAL JWKS for its own key pair and mints one synthetic user's token into the
// private state dir. It binds 127.0.0.1 only and never touches shared Supabase.
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import net from 'node:net';
import { SignJWT, importJWK } from 'jose';
import { ensureLocalUser, ensureSigningKey, publicJwkOf } from './shared-data-signing-key.mjs';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
};
const instance = process.env.SHARED_DATA_LOCAL_INSTANCE ?? ''; // the same stack switch as shared-data-db.mjs
if (!/^[a-z0-9-]*$/.test(instance)) throw new Error('SHARED_DATA_LOCAL_INSTANCE must be [a-z0-9-]');
const stateDir = resolve(homedir(), `.codex/workspaces/shared-data-spine-local${instance === '' ? '' : `-${instance}`}`);
const envDir = resolve(arg('--env-dir', resolve(homedir(), 'Documents/GitHub/olumi-assistants-service')));
const requestedPort = Number(arg('--port', '0'));

// ── 1. The data target: local only ───────────────────────────────────────────────────────────────────────────────
const connectionFile = resolve(stateDir, 'connection.json');
if (!existsSync(connectionFile)) throw new Error(`No ${connectionFile}: start the local DB first (node scripts/dev/shared-data-db.mjs)`);
const conn = JSON.parse(readFileSync(connectionFile, 'utf8'));
if (typeof conn.supabaseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(conn.supabaseUrl)) {
  throw new Error('Refusing to boot: connection.json supabaseUrl is not a local http://127.0.0.1:<port> URL');
}
if (typeof conn.serviceRoleKey !== 'string' || conn.serviceRoleKey.length < 20) throw new Error('connection.json has no local service key');

// ── 2. Scrub inherited credentials, then allowlist from the env files ────────────────────────────────────────────
const SCRUB = /^(SUPABASE_|ANTHROPIC_|LANGFUSE_|SENTRY_|RENDER_|ADMIN_API_KEY|OLUMI_REPLAY_|DATABASE_URL|PG[A-Z]*$|LLM_FAILOVER_PROVIDERS)/;
for (const key of Object.keys(process.env)) if (SCRUB.test(key)) delete process.env[key];
const ALLOW = { '.env': ['OPENAI_API_KEY'], '.env.staging.local': ['PLOT_BASE_URL', 'PLOT_AUTH_TOKEN', 'ASSIST_API_KEY'] };
const loaded = [];
for (const [file, keys] of Object.entries(ALLOW)) {
  const path = resolve(envDir, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || !keys.includes(m[1])) continue;
    const value = m[2].replace(/^['"]|['"]$/g, '');
    if (value !== '') { process.env[m[1]] = value; loaded.push(m[1]); }
  }
}
process.env.LLM_PROVIDER = 'openai'; // OpenAI only (Anthropic spend is Paul's call)
process.env.SUPABASE_URL = conn.supabaseUrl;
process.env.SUPABASE_SERVICE_ROLE_KEY = conn.serviceRoleKey;
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';
// The Supabase-JWT verification path ships dark (`CEE_REQUIRE_USER_JWT`); ON here by default so a browser's token
// is really verified (a present-but-invalid token is refused `sign_in_required`). `--require-user-jwt false` mirrors
// a flag-off deploy, where the token is ignored and the assist key alone authorises.
process.env.CEE_REQUIRE_USER_JWT = arg('--require-user-jwt', 'true') === 'false' ? 'false' : 'true';
// The product lane staging serves. A localhost UI sends no `x-olumi-ai-mode` header (only staging hosts default to
// 'openai'), so `/proxy/v5/turn` falls to PROXY_V5_TARGET, whose code default is the conventional route (Anthropic, and
// no top-level `goal_certainty` / `limit_verdicts` on the turn). Mount the Agent route and aim the proxy at it.
process.env.AGENT_LANE_ENABLED = 'true';
process.env.PROXY_V5_TARGET = 'agent';
// The UI posts turns only to `/proxy/v5/turn` (its host source is VITE_V5_ENDPOINT); the route is off by default and
// rejects every origin not listed. Local dev origins only (the UI's Vite server and preview are both :5173).
process.env.BROWSER_PROXY_ENABLED = 'true';
process.env.BROWSER_PROXY_ALLOWED_ORIGINS = arg('--origins', 'http://localhost:5173,http://127.0.0.1:5173');
process.env.ALLOWED_ORIGINS = process.env.BROWSER_PROXY_ALLOWED_ORIGINS; // CORS preflight for the same origins

// ── 3. The real user-auth path against a LOCAL JWKS ──────────────────────────────────────────────────────────────
// The experiment's one signing key (shared-data-signing-key.mjs): the local PostgREST verifies the same token.
const privateJwk = ensureSigningKey(stateDir);
const publicJwk = publicJwkOf(privateJwk);
const freePort = () => new Promise((ok, fail) => {
  const s = net.createServer();
  s.once('error', fail);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});
const jwksPort = await freePort();
const jwks = createServer((req, res) => {
  if (req.url !== '/auth/v1/.well-known/jwks.json') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ keys: [publicJwk] }));
});
await new Promise((ok) => jwks.listen(jwksPort, '127.0.0.1', ok));
process.env.SUPABASE_JWKS_URL = `http://127.0.0.1:${jwksPort}/auth/v1/.well-known/jwks.json`;

const user = ensureLocalUser(stateDir);
const token = await new SignJWT({ role: 'authenticated' })
  .setProtectedHeader({ alg: 'ES256', kid: privateJwk.kid, typ: 'JWT' })
  .setSubject(user.id)
  .setAudience('authenticated')
  .setIssuer(`${conn.supabaseUrl}/auth/v1`)
  .setIssuedAt()
  .setExpirationTime('12h')
  .sign(await importJWK(privateJwk, 'ES256'));
const tokenFile = resolve(stateDir, 'api-user-token.txt');
writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });

// ── 4. The real app, bound to localhost ──────────────────────────────────────────────────────────────────────────
const { build } = await import('../../src/server.ts');
const app = await build();
const port = requestedPort > 0 ? requestedPort : await freePort();
await app.listen({ port, host: '127.0.0.1' });
console.log(JSON.stringify({
  api: `http://127.0.0.1:${port}`,
  data_target: conn.supabaseUrl,
  jwks: process.env.SUPABASE_JWKS_URL,
  user_id: user.id,
  user_token_file: tokenFile,
  allowlisted_env: loaded,
  require_user_jwt: process.env.CEE_REQUIRE_USER_JWT,
  proxy_v5_target: process.env.PROXY_V5_TARGET,
  browser_origins: process.env.BROWSER_PROXY_ALLOWED_ORIGINS,
  note: 'Bearer the token file\'s JWT (real ES256 path) or send x-olumi-assist-key for assist routes. Ctrl-C stops both servers.',
}, null, 2));
const stop = async () => { await app.close(); jwks.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
