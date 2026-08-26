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
 * It covers SELECT and UPDATE on `scenarios`. It does not cover DELETE as a
 * PROBE, other tables, or the SECURITY DEFINER RPC paths. (Cleanup below does
 * assert its own DELETEs landed, but that is residue accounting, not a probe —
 * see the exit-code contract.)
 *
 * One asymmetry, recorded rather than papered over: the read-back at the end
 * selects `title` only, so the `analysis_status` write is verified by its
 * affected-row count alone — the count-only shape this file otherwise declines
 * to rest on. In practice the same per-command policy governs the same row via
 * the `title` probe. Not a proven fail-open; noted so nobody cites it as
 * covered.
 *
 * ── CREDENTIALS: NONE ──────────────────────────────────────────────────────
 * It uses the PUBLIC publishable key every browser visitor already downloads,
 * and mints its own throwaway accounts through open signup. It never reads a
 * service-role key, and never logs a token (sha256 prefixes only).
 *
 * ⚠ ── BOUNDED RESIDUE THIS GUARD LEAVES BEHIND, stated so it is never a ─────
 *      surprise. A known and bounded residue is honest; an undocumented one is
 *      how owned rows come to resolve to no auth user.
 *
 *   PER RUN: 2 auth identities, created through open signup, NEVER DELETED.
 *   Scenario rows ARE deleted (and the deletion is asserted — see cleanup).
 *
 *   WHY NOT DELETED: removing an auth user requires the service-role key. This
 *   guard refuses that key on principle — a CI job holding the most dangerous
 *   credential in the estate to tidy up after itself is a worse trade than the
 *   residue. The rate is instead held down by SCHEDULING: there is no `schedule:`
 *   trigger, so runs are human-initiated (`workflow_dispatch`), or self-scoped
 *   to changes to this guard, or to `supabase/migrations/**` landing on staging.
 *   That is a handful of runs a year, not one a day.
 *
 *   ⚠ CONSEQUENCE FOR ANY LATER HAND-PURGE: `scenarios.user_id` has NO foreign
 *   key to `auth.users` — the `scenarios_user_id_fkey` constraint was dropped
 *   deliberately by `supabase/migrations/20260422000000_v5_guest_mode_nullable_user_id.sql`
 *   for guest mode. So deleting these identities by hand will NOT cascade, and
 *   would turn any surviving row of theirs into an orphan. Purge rows first, or
 *   accept the identities. Identities from this guard are recognisable by the
 *   `olumi-rls-guard+` local-part on an `@example.test` address.
 *
 * ── EXIT-CODE CONTRACT (load-bearing — a broken alarm gets ignored) ─────────
 *   0  every probe ran and held.
 *   1  ISOLATION FAILED — a probe positively observed cross-user access.
 *   2  COULD NOT RUN CLEANLY — target unresolvable, signup refused, a TRANSPORT
 *      error, an incomplete probe count, or residue this run could not clear.
 *   A network flake must never reach exit 1: "the guard could not run" and
 *   "user B read user A's row" are opposite facts and must not share a code.
 *
 * ── IT FAILS LOUD WHEN IT CANNOT PROVE IT RAN ──────────────────────────────
 * A guard that silently skips is worse than no guard. Every probe increments a
 * counter and the run REDs unless the counter matches EXPECTED_PROBES exactly.
 * The positive controls are inside the job: if this can no longer see or write
 * a row at all, it REDs rather than reporting a reassuring "nothing leaked".
 */
import { randomUUID, createHash } from 'node:crypto';

const EXPECTED_PROBES = 8;
// Converged on the existing pattern in this repo:
// scripts/ci/staging-structural-delete-witness.mjs:973 — AbortSignal.timeout(30000).
const TIMEOUT_MS = 30000;

let probesRun = 0;
const fails = [];
const residue = [];
const sha = (s, n = 16) => createHash('sha256').update(String(s)).digest('hex').slice(0, n);
const log = (o) => console.log(JSON.stringify(o));
function check(name, ok, detail) {
  probesRun += 1;
  if (!ok) fails.push(name);
  log({ probe: name, ok, ...detail });
}

/**
 * `die()` THROWS rather than calling process.exit(): process.exit() skips
 * `finally`, which would strand the guard's own rows on every abnormal path.
 * Caught once at the bottom and turned into exit 2.
 */
class Fatal extends Error {}
function die(reason, extra = {}) {
  log({ fatal: reason, ...extra });
  throw new Fatal(reason);
}

// ── Supabase target: explicit env, else crawl the deployed bundle ───────────
const ORIGIN = process.env.RLS_GUARD_ORIGIN || 'https://staging--olumi.netlify.app';
async function resolveTarget() {
  const u = process.env.RLS_GUARD_SUPABASE_URL, k = process.env.RLS_GUARD_SUPABASE_KEY;
  if (u && k) return { restBase: `${u.replace(/\/+$/, '')}/rest/v1`, key: k, source: 'environment' };
  const seen = new Set(), queue = [];
  const add = (p) => { const q = p.startsWith('/') ? p : `/${p}`; if (!seen.has(q)) { seen.add(q); queue.push(q); } };
  const index = await fetch(ORIGIN, { signal: AbortSignal.timeout(TIMEOUT_MS) }).then((r) => r.text()).catch(() => null);
  if (index === null) die('could not fetch the deployed page to locate its config', { origin: ORIGIN });
  for (const m of index.matchAll(/["'(/]((?:\/)?assets\/[A-Za-z0-9._-]+\.js)/g)) add(m[1]);
  if (queue.length === 0) die('no asset chunks discovered — the crawl cannot see the bundle', { origin: ORIGIN });
  let host = null, key = null, fetched = 0;
  while (queue.length > 0 && fetched < 400 && (host === null || key === null)) {
    const p = queue.shift();
    const body = await fetch(`${ORIGIN}${p}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      .then((r) => (r.ok ? r.text() : null)).catch(() => null);
    if (body === null) continue;
    fetched += 1;
    host ??= body.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0] ?? null;
    key ??= body.match(/\b(sb_publishable_[A-Za-z0-9_-]+)\b/)?.[1] ?? body.match(/\b(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/)?.[1] ?? null;
    for (const m of body.matchAll(/["'(/]((?:\/)?assets\/[A-Za-z0-9._-]+\.js)/g)) add(m[1]);
  }
  if (host === null || key === null) die('could not resolve the public config from the deployed bundle', { chunksFetched: fetched });
  return { restBase: `${host}/rest/v1`, key, source: `deployed bundle (${fetched} chunks)` };
}

let target = null, A = null, B = null;
const scenarioA = randomUUID(), scenarioB = randomUUID();

// ── Throwaway accounts, minted through open signup ─────────────────────────
async function mint(label) {
  const host = target.restBase.replace(/\/rest\/v1$/, '');
  const email = `olumi-rls-guard+${label}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}@example.test`;
  let res;
  try {
    res = await fetch(`${host}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: target.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: randomUUID() + randomUUID() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // TRANSPORT, not isolation. Exit 2 — never 1.
    die(`transport error minting throwaway user ${label}: ${e?.name ?? e}`);
  }
  const body = await res.json().catch(() => null);
  const token = body?.access_token ?? body?.session?.access_token ?? null;
  const userId = body?.user?.id ?? null;
  if (res.status !== 200 || !token || !userId) {
    die(`could not mint throwaway user ${label} — the guard cannot run`, { http: res.status, keys: body && typeof body === 'object' ? Object.keys(body) : null });
  }
  log({ step: 'mint', label, userId, tokenSha256: sha(token) });
  return { email, userId, accessToken: token };
}

const hdr = (u, extra = {}) => ({
  apikey: target.key, Authorization: `Bearer ${u.accessToken}`,
  'Content-Type': 'application/json', Accept: 'application/json', ...extra,
});
async function rest(method, path, user, body, extraHeaders = {}) {
  let res;
  try {
    res = await fetch(`${target.restBase}${path}`, {
      method, headers: hdr(user, { Prefer: 'return=representation', ...extraHeaders }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // TRANSPORT, not isolation. A DNS blip, a reset socket or a hung request
    // must not be reported with the guard's own code for "isolation FAILED".
    die(`transport error on ${method} ${path.split('?')[0]}: ${e?.name ?? e}`);
  }
  const text = await res.text();
  let rows = null; try { rows = JSON.parse(text); } catch { /* non-JSON */ }
  return { http: res.status, rows, count: Array.isArray(rows) ? rows.length : null };
}

/**
 * Residue accounting, not a probe. Runs in `finally`, so it also runs on the
 * abnormal paths where rows would otherwise be stranded.
 *
 * It ASSERTS the DELETE landed rather than discarding the result. That matters
 * because the DELETE policy is one this guard deliberately does not probe — in
 * a script whose whole premise is that deployed policies may have drifted. A
 * silently-swallowed 403 here would leave rows behind and report nothing.
 *
 * It must never throw past this point and never changes an isolation verdict:
 * unclearable residue is an exit-2 condition, and exit 1 always outranks it.
 */
async function cleanup() {
  for (const [label, id, user] of [['A', scenarioA, A], ['B', scenarioB, B]]) {
    if (user === null) continue; // never minted — nothing of ours can exist
    try {
      const del = await rest('DELETE', `/scenarios?id=eq.${id}`, user);
      const gone = await rest('GET', `/scenarios?id=eq.${id}&select=id`, user);
      const ok = del.http >= 200 && del.http < 300 && gone.count === 0;
      log({ step: 'cleanup', row: label, http: del.http, rowsDeleted: del.count, stillVisibleToOwner: gone.count, ok });
      if (!ok) {
        residue.push(`scenario ${label}: DELETE returned HTTP ${del.http}, ${gone.count} row(s) still visible to the owner`);
      }
    } catch (e) {
      const why = e instanceof Fatal ? e.message : `${e?.name ?? e}`;
      log({ step: 'cleanup', row: label, ok: false, why });
      residue.push(`scenario ${label}: cleanup could not complete (${why})`);
    }
  }
}

let fatal = null;
try {
  target = await resolveTarget();
  log({ step: 'target', source: target.source, restBase: target.restBase, keySha256: sha(target.key) });

  A = await mint('A');
  B = await mint('B');

  // ── Own the rows, and prove the INSERT policy at the same time ───────────
  const insA = await rest('POST', '/scenarios', A, { id: scenarioA, user_id: A.userId, title: 'rls-guard A' });
  const insB = await rest('POST', '/scenarios', B, { id: scenarioB, user_id: B.userId, title: 'rls-guard B' });
  if (insA.count !== 1 || insB.count !== 1) {
    die('could not create the guard’s own rows — it cannot observe anything, so this is not a pass', { insA: insA.http, insB: insB.http });
  }
  check('POSITIVE CONTROL — a user can create a row it owns', true, { http: insA.http });

  const forged = await rest('POST', '/scenarios', A, { id: randomUUID(), user_id: B.userId, title: 'rls-guard forged' });
  check('a user cannot create a row owned by someone else', forged.count === 0 || forged.http >= 400,
    { http: forged.http, rowsCreated: forged.count });

  // ── SELECT ───────────────────────────────────────────────────────────────
  const selOther = await rest('GET', `/scenarios?id=eq.${scenarioB}&select=id,user_id`, A);
  check('a user cannot READ another user’s row', selOther.count === 0, { http: selOther.http, rows: selOther.count });

  const selOwn = await rest('GET', `/scenarios?id=eq.${scenarioA}&select=id,user_id`, A);
  check('POSITIVE CONTROL — a user CAN read its own row', selOwn.count === 1,
    { http: selOwn.http, rows: selOwn.count, ownerMatchesReader: selOwn.rows?.[0]?.user_id === A.userId });

  const selAbsent = await rest('GET', `/scenarios?id=eq.${randomUUID()}&select=id`, A);
  check('CONTRAST CONTROL — a fabricated id returns nothing', selAbsent.count === 0, { http: selAbsent.http, rows: selAbsent.count });

  // ── UPDATE (per-command policies: a scoped SELECT is NOT evidence here) ──
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
} catch (e) {
  // Fatal → "cannot run". Anything unexpected is also "cannot run", never
  // "isolation failed": an unhandled rejection exits Node with 1, which is
  // exactly the collision this contract exists to prevent.
  fatal = e instanceof Fatal ? e.message : `unexpected error: ${e?.stack ?? e}`;
} finally {
  await cleanup();
}

// ── Verdict — silence is not success ──────────────────────────────────────
if (fatal === null && probesRun !== EXPECTED_PROBES) {
  fatal = `ran ${probesRun} probes, expected ${EXPECTED_PROBES} — a guard that cannot prove it ran is not a pass`;
  log({ fatal });
}
log({
  step: 'VERDICT', probesRun, failed: fails, fatal, residue,
  limit: 'Proves DEPLOYED BEHAVIOUR only — not that the deployed policy came from the checked-in migration. Covers SELECT and UPDATE on scenarios; not DELETE, other tables, or the RPC paths.',
});

if (fails.length > 0) {
  console.error(`\nRLS ISOLATION GUARD — FAILED (${fails.length}):\n` + fails.map((f) => `  · ${f}`).join('\n'));
  if (residue.length > 0) console.error(`\n⚠ residue left behind:\n` + residue.map((r) => `  · ${r}`).join('\n'));
  process.exit(1);
}
if (fatal !== null) {
  console.error(`\nRLS ISOLATION GUARD — HARD FAIL (could not run): ${fatal}`);
  if (residue.length > 0) console.error(`\n⚠ residue left behind:\n` + residue.map((r) => `  · ${r}`).join('\n'));
  process.exit(2);
}
if (residue.length > 0) {
  console.error(`\nRLS ISOLATION GUARD — HARD FAIL: probes held, but this run could not clear its own rows:\n`
    + residue.map((r) => `  · ${r}`).join('\n'));
  process.exit(2);
}
console.error(`\nRLS isolation guard: ${probesRun}/${EXPECTED_PROBES} probes ran, all held.`);
