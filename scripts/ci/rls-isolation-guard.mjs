#!/usr/bin/env node
/**
 * CROSS-USER ISOLATION DRIFT GUARD — deployed behaviour, black-box, no secrets.
 *
 * ── WHAT IT GUARDS ─────────────────────────────────────────────────────────
 * The browser addresses `scenarios` rows by `id` ALONE (`scenarioService.ts`:
 * loadScenario, setAnalysisRunning, saveTitle). On that path the database's own
 * row policies are the only authority. Those policies are version-controlled
 * (`supabase/migrations/20260226010000_scenario_schema_v2_0_1_hardening.sql`),
 * but nothing derived their DEPLOYED state — so a policy weakened outside the
 * repo would have been invisible to CI. This closes that.
 *
 * ⚠ ── WHAT IT DOES **NOT** ESTABLISH, stated here so nobody over-reads it ───
 * It proves DEPLOYED BEHAVIOUR. It does NOT prove the deployed policy came from
 * the checked-in migration: a policy set by hand that happens to coincide would
 * pass this identically. Treat agreement between this guard and the migration
 * as two independent facts that agree, never as one fact.
 *
 * It covers SELECT and UPDATE on `scenarios`. It does not cover DELETE, other
 * tables, or the SECURITY DEFINER RPC paths.
 *
 * ── CREDENTIALS: NONE ──────────────────────────────────────────────────────
 * It uses the PUBLIC publishable key every browser visitor already downloads,
 * and mints its own throwaway accounts through open signup. It never reads a
 * service-role key, and never logs a token (sha256 prefixes only).
 *
 * ── IT FAILS LOUD WHEN IT CANNOT PROVE IT RAN ──────────────────────────────
 * A guard that silently skips is worse than no guard. Every probe increments a
 * counter and the run REDs unless the counter matches EXPECTED_PROBES exactly.
 * The positive controls are inside the job: if this can no longer see or write
 * a row at all, it REDs rather than reporting a reassuring "nothing leaked".
 */
import { randomUUID, createHash } from 'node:crypto';

const EXPECTED_PROBES = 8;
let probesRun = 0;
const fails = [];
const sha = (s, n = 16) => createHash('sha256').update(String(s)).digest('hex').slice(0, n);
const log = (o) => console.log(JSON.stringify(o));
function check(name, ok, detail) {
  probesRun += 1;
  if (!ok) fails.push(name);
  log({ probe: name, ok, ...detail });
}
function die(reason, extra = {}) {
  log({ fatal: reason, ...extra });
  console.error(`\nRLS ISOLATION GUARD — HARD FAIL: ${reason}`);
  process.exit(2);
}

// ── Supabase target: explicit env, else crawl the deployed bundle ───────────
const ORIGIN = process.env.RLS_GUARD_ORIGIN || 'https://staging--olumi.netlify.app';
async function resolveTarget() {
  const u = process.env.RLS_GUARD_SUPABASE_URL, k = process.env.RLS_GUARD_SUPABASE_KEY;
  if (u && k) return { restBase: `${u.replace(/\/+$/, '')}/rest/v1`, key: k, source: 'environment' };
  const seen = new Set(), queue = [];
  const add = (p) => { const q = p.startsWith('/') ? p : `/${p}`; if (!seen.has(q)) { seen.add(q); queue.push(q); } };
  const index = await fetch(ORIGIN).then((r) => r.text()).catch(() => null);
  if (index === null) die('could not fetch the deployed page to locate its config', { origin: ORIGIN });
  for (const m of index.matchAll(/["'(/]((?:\/)?assets\/[A-Za-z0-9._-]+\.js)/g)) add(m[1]);
  if (queue.length === 0) die('no asset chunks discovered — the crawl cannot see the bundle', { origin: ORIGIN });
  let host = null, key = null, fetched = 0;
  while (queue.length > 0 && fetched < 400 && (host === null || key === null)) {
    const p = queue.shift();
    const body = await fetch(`${ORIGIN}${p}`).then((r) => (r.ok ? r.text() : null)).catch(() => null);
    if (body === null) continue;
    fetched += 1;
    host ??= body.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0] ?? null;
    key ??= body.match(/\b(sb_publishable_[A-Za-z0-9_-]+)\b/)?.[1] ?? body.match(/\b(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/)?.[1] ?? null;
    for (const m of body.matchAll(/["'(/]((?:\/)?assets\/[A-Za-z0-9._-]+\.js)/g)) add(m[1]);
  }
  if (host === null || key === null) die('could not resolve the public config from the deployed bundle', { chunksFetched: fetched });
  return { restBase: `${host}/rest/v1`, key, source: `deployed bundle (${fetched} chunks)` };
}

const target = await resolveTarget();
log({ step: 'target', source: target.source, restBase: target.restBase, keySha256: sha(target.key) });

// ── Throwaway accounts, minted through open signup ─────────────────────────
async function mint(label) {
  const host = target.restBase.replace(/\/rest\/v1$/, '');
  const email = `olumi-rls-guard+${label}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}@example.test`;
  const res = await fetch(`${host}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: target.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: randomUUID() + randomUUID() }),
  });
  const body = await res.json().catch(() => null);
  const token = body?.access_token ?? body?.session?.access_token ?? null;
  const userId = body?.user?.id ?? null;
  if (res.status !== 200 || !token || !userId) {
    die(`could not mint throwaway user ${label} — the guard cannot run`, { http: res.status, keys: body && typeof body === 'object' ? Object.keys(body) : null });
  }
  log({ step: 'mint', label, userId, tokenSha256: sha(token) });
  return { email, userId, accessToken: token };
}
const A = await mint('A');
const B = await mint('B');

const hdr = (u, extra = {}) => ({
  apikey: target.key, Authorization: `Bearer ${u.accessToken}`,
  'Content-Type': 'application/json', Accept: 'application/json', ...extra,
});
async function rest(method, path, user, body, extraHeaders = {}) {
  const res = await fetch(`${target.restBase}${path}`, {
    method, headers: hdr(user, { Prefer: 'return=representation', ...extraHeaders }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let rows = null; try { rows = JSON.parse(text); } catch { /* non-JSON */ }
  return { http: res.status, rows, count: Array.isArray(rows) ? rows.length : null };
}

// ── Own the rows, and prove the INSERT policy at the same time ─────────────
const scenarioA = randomUUID(), scenarioB = randomUUID();
const insA = await rest('POST', '/scenarios', A, { id: scenarioA, user_id: A.userId, title: 'rls-guard A' });
const insB = await rest('POST', '/scenarios', B, { id: scenarioB, user_id: B.userId, title: 'rls-guard B' });
if (insA.count !== 1 || insB.count !== 1) {
  die('could not create the guard’s own rows — it cannot observe anything, so this is not a pass', { insA: insA.http, insB: insB.http });
}
check('POSITIVE CONTROL — a user can create a row it owns', true, { http: insA.http });

const forged = await rest('POST', '/scenarios', A, { id: randomUUID(), user_id: B.userId, title: 'rls-guard forged' });
check('a user cannot create a row owned by someone else', forged.count === 0 || forged.http >= 400,
  { http: forged.http, rowsCreated: forged.count });

// ── SELECT ─────────────────────────────────────────────────────────────────
const selOther = await rest('GET', `/scenarios?id=eq.${scenarioB}&select=id,user_id`, A);
check('a user cannot READ another user’s row', selOther.count === 0, { http: selOther.http, rows: selOther.count });

const selOwn = await rest('GET', `/scenarios?id=eq.${scenarioA}&select=id,user_id`, A);
check('POSITIVE CONTROL — a user CAN read its own row', selOwn.count === 1,
  { http: selOwn.http, rows: selOwn.count, ownerMatchesReader: selOwn.rows?.[0]?.user_id === A.userId });

const selAbsent = await rest('GET', `/scenarios?id=eq.${randomUUID()}&select=id`, A);
check('CONTRAST CONTROL — a fabricated id returns nothing', selAbsent.count === 0, { http: selAbsent.http, rows: selAbsent.count });

// ── UPDATE (per-command policies: a scoped SELECT is NOT evidence here) ────
const MARKER = `rls-guard-${randomUUID().slice(0, 8)}`;
const updOther = await rest('PATCH', `/scenarios?id=eq.${scenarioB}`, A, { title: MARKER });
check('a user cannot WRITE another user’s row', updOther.count === 0, { http: updOther.http, rowsAffected: updOther.count });

const updStatus = await rest('PATCH', `/scenarios?id=eq.${scenarioB}`, A, { analysis_status: 'running' });
check('a user cannot write another user’s analysis status', updStatus.count === 0, { http: updStatus.http, rowsAffected: updStatus.count });

const updOwn = await rest('PATCH', `/scenarios?id=eq.${scenarioA}`, A, { title: `${MARKER}-own` });
check('POSITIVE CONTROL — a user CAN write its own row', updOwn.count === 1, { http: updOwn.http, rowsAffected: updOwn.count });

// Bind to the OUTCOME, read back as the owner — not to the write's status code.
const readBack = await rest('GET', `/scenarios?id=eq.${scenarioB}&select=title`, B);
if (readBack.count !== 1) die('could not read the second user’s own row back — the guard lost its observation point', { http: readBack.http });
if (readBack.rows[0].title === MARKER) fails.push('the other user’s row WAS modified (read-back)');

// ── Cleanup: each user removes only its own row ───────────────────────────
await rest('DELETE', `/scenarios?id=eq.${scenarioA}`, A).catch(() => null);
await rest('DELETE', `/scenarios?id=eq.${scenarioB}`, B).catch(() => null);

// ── Verdict — silence is not success ──────────────────────────────────────
if (probesRun !== EXPECTED_PROBES) {
  die(`ran ${probesRun} probes, expected ${EXPECTED_PROBES} — a guard that cannot prove it ran is not a pass`);
}
log({
  step: 'VERDICT', probesRun, failed: fails,
  limit: 'Proves DEPLOYED BEHAVIOUR only — not that the deployed policy came from the checked-in migration. Covers SELECT and UPDATE on scenarios; not DELETE, other tables, or the RPC paths.',
});
if (fails.length > 0) {
  console.error(`\nRLS ISOLATION GUARD — FAILED (${fails.length}):\n` + fails.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.error(`\nRLS isolation guard: ${probesRun}/${EXPECTED_PROBES} probes ran, all held.`);
