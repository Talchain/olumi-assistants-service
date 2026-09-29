#!/usr/bin/env node
/**
 * CROSS-USER ISOLATION PROBE — deployed behaviour, black-box, no secrets.
 *
 * ⚠ ── IT IS A PROBE, NOT A DRIFT GUARD. THE NAME IS THE HONEST ONE. ─────────
 * An earlier draft of this file called itself a "drift guard" and opened by
 * saying it closed the gap that "a policy changed OUTSIDE the repo would have
 * been invisible to CI". It does not close that gap, and it cannot: there is no
 * `schedule:` trigger (see the workflow, where the reasons are recorded), so
 * every automatic run needs a REPOSITORY EVENT, and a policy changed outside
 * the repo produces none. What actually runs it is a human clicking Run
 * workflow, a PR touching these two files, or a migration landing on staging.
 *
 * That is worth having and it is not drift detection. This estate has already
 * lost a scheduler once and recorded it as RUNNING for a month; a file that
 * promises watching nobody does is how that happens again. The re-surface
 * trigger for the automatic half is recorded in the workflow.
 *
 * ── WHAT IT ESTABLISHES ────────────────────────────────────────────────────
 * The browser addresses `scenarios` rows by `id` ALONE (`scenarioService.ts`:
 * loadScenario, setAnalysisRunning, saveTitle). On that path the database's own
 * row policies are the only authority, and nothing else in CI derives their
 * DEPLOYED state. This mints two real identities and attempts the read, so it
 * settles by observation a question that inspecting rows cannot decide.
 *
 * ⚠ ── WHAT IT DOES **NOT** ESTABLISH, stated here so nobody over-reads it ───
 * It proves DEPLOYED BEHAVIOUR. It does NOT prove the deployed policy came from
 * the checked-in migration: a policy set by hand that happens to coincide would
 * pass this identically. Treat agreement between this probe and the migration
 * as two independent facts that agree, never as one fact.
 *
 * ⚠ AND IT IS NOT THE DOOR THIS PRODUCT'S OWN SERVER USES. This measures the
 * DIRECT browser → PostgREST door, where RLS is the only authority. CEE reaches
 * the same table through `src/orchestrator-v5/session/index.ts:49`, which builds
 * its Supabase client with the SERVICE-ROLE key and touches `.from('scenarios')`
 * at five sites in `supabase-store.ts`. Service role BYPASSES row policies by
 * construction, so a green run here is not evidence about that path — ownership
 * there rests on a caller-supplied parameter and an application-level
 * pre-flight, and that file carries its own `TODO(production)` to move it onto
 * `auth.uid()`. Closing THAT question needs a two-real-user journey witness
 * driven through the CEE turn path, which needs real credentials. Nobody should
 * cite this probe as cover for the cross-user criterion as a whole.
 *
 * It covers SELECT and UPDATE on `scenarios`. It does not cover DELETE as a
 * PROBE, other tables, guest rows (`user_id IS NULL`, which `auth.uid() =
 * user_id` never matches — a guest reading back its own draft is intended
 * posture, not a leak), or the SECURITY DEFINER RPC paths. (Cleanup below does
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
 * ⚠ ── BOUNDED RESIDUE THIS PROBE LEAVES BEHIND, stated so it is never a ─────
 *      surprise. A known and bounded residue is honest; an undocumented one is
 *      how owned rows come to resolve to no auth user.
 *
 *   PER RUN: 2 auth identities, created through open signup, NEVER DELETED.
 *   Scenario rows ARE deleted (and the deletion is asserted — see cleanup).
 *   That includes the FORGED row: it only exists on a run where isolation has
 *   broken, which is the run least able to afford a stranded row. The cleanup
 *   manifest is DERIVED by `rest()` from the POSTs actually made, so adding a
 *   row later cannot silently escape cleanup the way a hand-listed manifest
 *   let the forged row escape it.
 *
 *   WHY NOT DELETED: removing an auth user requires the service-role key. This
 *   probe refuses that key on principle — a CI job holding the most dangerous
 *   credential in the estate to tidy up after itself is a worse trade than the
 *   residue. The rate is instead held down by SCHEDULING: there is no `schedule:`
 *   trigger, so runs are human-initiated (`workflow_dispatch`), or self-scoped
 *   to changes to this probe, or to `supabase/migrations/**` landing on staging.
 *   That is a handful of runs a year, not one a day.
 *
 *   ⚠ CONSEQUENCE FOR ANY LATER HAND-PURGE: `scenarios.user_id` has NO foreign
 *   key to `auth.users` — the `scenarios_user_id_fkey` constraint was dropped
 *   deliberately by `supabase/migrations/20260422000000_v5_guest_mode_nullable_user_id.sql`
 *   for guest mode. So deleting these identities by hand will NOT cascade, and
 *   would turn any surviving row of theirs into an orphan. Purge rows first, or
 *   accept the identities. Identities from this probe are recognisable by the
 *   `olumi-rls-guard+` local-part on an `@example.test` address.
 *
 * ── EXIT-CODE CONTRACT (load-bearing — a broken alarm gets ignored) ─────────
 *   0  every probe ran and held.
 *   1  ISOLATION FAILED — a probe positively observed cross-user access.
 *   2  COULD NOT RUN CLEANLY — target unresolvable, signup refused, a TRANSPORT
 *      error, a response the server DECLINED TO ANSWER, a failed positive
 *      control, an incomplete probe count, or residue this run could not clear.
 *   A network flake must never reach exit 1: "the probe could not run" and
 *   "user B read user A's row" are opposite facts and must not share a code.
 *
 *   ⚠ THAT CONTRACT IS ENFORCED BY `data()`, NOT BY GOODWILL. `rest()` used to
 *   report `count: null` for ANY non-array body, and the negative probes tested
 *   `count === 0` — so `null === 0` was false and a 502 HTML page, an expired
 *   token or a 429 each announced a cross-user read that never happened, on the
 *   exit code reserved for a security klaxon. Every probe verdict is now gated
 *   on a response the server actually answered; anything else is exit 2. The
 *   forged INSERT is the sole exception and it is a MEASURED one, not an
 *   assumed one — see `isPgError`.
 *
 * ── IT FAILS LOUD WHEN IT CANNOT PROVE IT RAN ──────────────────────────────
 * A probe that silently skips is worse than no probe. Every probe increments a
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
const brokenControls = [];
const residue = [];
const sha = (s, n = 16) => createHash('sha256').update(String(s)).digest('hex').slice(0, n);
const log = (o) => console.log(JSON.stringify(o));
/**
 * `kind` decides WHICH failure this is, and therefore which exit code it earns.
 *
 *   'isolation' — the probe positively observed cross-user access. Exit 1.
 *   'control'   — a POSITIVE control failed: this run could not read or write
 *                 its OWN row, so it lost its observation point. That is "could
 *                 not run cleanly" (exit 2), never "isolation failed" — nobody
 *                 read anybody else's row. It still REDs; only the code changes.
 *
 * The CONTRAST control is deliberately 'isolation': if a fabricated id returns
 * a row, the database handed this reader a row it does not own, and that IS a
 * cross-user read.
 */
function check(name, ok, detail, kind = 'isolation') {
  probesRun += 1;
  if (!ok) (kind === 'control' ? brokenControls : fails).push(name);
  log({ probe: name, ok, kind, ...detail });
}

/**
 * `die()` THROWS rather than calling process.exit(): process.exit() skips
 * `finally`, which would strand this run's own rows on every abnormal path.
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
// The forged row is minted with a BOUND id so `cleanup()` can reach it. See the
// forged-INSERT probe: this row only ever exists when isolation has broken, and
// that is precisely the run that must not strand it.
const scenarioForged = randomUUID();
let forgedRowExists = false;
/**
 * The cleanup manifest, DERIVED by `rest()` from the POSTs actually made rather
 * than hand-listed next to them. See the note in `rest()` for the measurement
 * that motivated it.
 */
const ourRows = [];

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
    die(`could not mint throwaway user ${label} — this run cannot continue`, { http: res.status, keys: body && typeof body === 'object' ? Object.keys(body) : null });
  }
  log({ step: 'mint', label, userId, tokenSha256: sha(token) });
  return { email, userId, accessToken: token };
}

/**
 * A PostgREST error body: `{code, details, hint, message}`. Used ONLY to
 * recognise the forged INSERT's legitimate refusal, which is the one probe on
 * this probe whose healthy answer is not a JSON array.
 *
 * DERIVED, not assumed: runner log for run 32970941736 (this probe, green, on
 * the deployed database) records the forged INSERT as `http 403, rowsCreated
 * null` while all seven other probes answered 200 with an array. So 403-with-an
 * -error-object is the shape a healthy database refuses with, and it is the
 * only non-array shape any probe verdict is allowed to rest on.
 */
const isPgError = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (typeof v.message === 'string' || typeof v.code === 'string');

const hdr = (u, extra = {}) => ({
  apikey: target.key, Authorization: `Bearer ${u.accessToken}`,
  'Content-Type': 'application/json', Accept: 'application/json', ...extra,
});
async function rest(method, path, user, body, extraHeaders = {}) {
  // ── The cleanup manifest is DERIVED HERE, not hand-maintained beside it ──
  // Registered BEFORE the request, so a row created by a call that then fails
  // in transit is still cleaned up. Measured reason: with a hand-listed
  // manifest, dropping one entry stranded a real row while the run reported
  // `residue: []` and exited 0 — which is G2's defect at a different index. A
  // list a human must remember to keep in step with reality drifts silently,
  // and the drift always reads as green.
  if (method === 'POST' && path.startsWith('/scenarios') && body?.id) {
    ourRows.push({ id: body.id, ownerId: body.user_id ?? null, label: body.title ?? body.id });
  }
  let res;
  try {
    res = await fetch(`${target.restBase}${path}`, {
      method, headers: hdr(user, { Prefer: 'return=representation', ...extraHeaders }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // TRANSPORT, not isolation. A DNS blip, a reset socket or a hung request
    // must not be reported with this file's own code for "isolation FAILED".
    die(`transport error on ${method} ${path.split('?')[0]}: ${e?.name ?? e}`);
  }
  const text = await res.text();
  let rows = null; try { rows = JSON.parse(text); } catch { /* non-JSON */ }
  const ok2xx = res.status >= 200 && res.status < 300;
  const dataResponse = ok2xx && Array.isArray(rows);
  const policyRefusal = res.status === 403 && isPgError(rows);
  return {
    http: res.status,
    rows,
    // `count` is now defined ONLY on a response the server actually answered
    // with data. It is `null` on every other shape — and `data()` below makes
    // that null unreachable by any probe verdict, rather than letting
    // `null === 0` decide one.
    count: dataResponse ? rows.length : null,
    dataResponse,
    policyRefusal,
    unanswered: !dataResponse && !policyRefusal,
    bodyKind: Array.isArray(rows) ? 'array' : rows === null ? 'non-json' : 'object',
    bodySha256: sha(text, 12),
  };
}

/**
 * THE SINGLE GATE BETWEEN A RESPONSE AND A PROBE VERDICT.
 *
 * A probe may only be judged on a response the server actually answered with
 * data. Anything else — a gateway's HTML 502, a 401 because this run's own
 * token was refused, a 429, a 404, an empty body — is the server declining to
 * answer, and `die()`ing on it is what keeps exit 1 meaning what the EXIT-CODE
 * CONTRACT above says it means. Called BEFORE `check()`, so a declined response
 * never increments `probesRun`, never lands in `fails`, and can neither fake a
 * pass nor fake an isolation failure.
 *
 * Without this, `count` was `null` on every such response, and SIX probes could
 * read a network event as a verdict: the four negatives test `count === 0` and
 * the three positive controls test `count === 1`, and `null` fails both — so a
 * 502 announced a cross-user read that never happened, on the exit code
 * reserved for a security klaxon.
 */
function data(r, what) {
  if (!r.dataResponse) {
    die(`the server did not answer ${what} with a data response — this run cannot judge isolation`,
      { http: r.http, bodyKind: r.bodyKind, bodySha256: r.bodySha256 });
  }
  return r;
}

/**
 * Residue accounting, not a probe. Runs in `finally`, so it also runs on the
 * abnormal paths where rows would otherwise be stranded.
 *
 * It ASSERTS the DELETE landed rather than discarding the result. That matters
 * because the DELETE policy is one this file deliberately does not probe — in
 * a script whose whole premise is that deployed policies may have drifted. A
 * silently-swallowed 403 here would leave rows behind and report nothing.
 *
 * It must never throw past this point and never changes an isolation verdict:
 * unclearable residue is an exit-2 condition, and exit 1 always outranks it.
 */
async function cleanup() {
  // Iterates the DERIVED manifest — every `/scenarios` POST this run made,
  // including the forged row, whose owner is B (that is what made it a forgery)
  // and who is therefore the identity that can delete it under `Users can
  // delete own scenarios`.
  for (const { id, ownerId, label } of ourRows) {
    const user = [A, B].find((u) => u !== null && u.userId === ownerId) ?? null;
    if (user === null) {
      // Fail LOUD rather than skipping: a row we created whose owner we cannot
      // resolve is exactly the "owned row resolving to no auth user" class.
      log({ step: 'cleanup', row: label, ok: false, why: 'no minted identity owns this row' });
      residue.push(`scenario ${label} (${id}): created by this run, but no minted identity owns it — cannot be deleted here`);
      continue;
    }
    try {
      const del = await rest('DELETE', `/scenarios?id=eq.${id}`, user);
      const gone = await rest('GET', `/scenarios?id=eq.${id}&select=id`, user);
      const ok = del.http >= 200 && del.http < 300 && gone.dataResponse && gone.count === 0;
      log({ step: 'cleanup', row: label, http: del.http, rowsDeleted: del.count, stillVisibleToOwner: gone.count, readBackHttp: gone.http, ok });
      if (!ok) {
        residue.push(`scenario ${label} (${id}): DELETE returned HTTP ${del.http}; owner read-back HTTP ${gone.http} showed ${gone.dataResponse ? `${gone.count} row(s) still visible` : 'no answerable response'}`);
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
    die('could not create this run’s own rows — it cannot observe anything, so this is not a pass', { insA: insA.http, insB: insB.http });
  }
  check('POSITIVE CONTROL — a user can create a row it owns', true, { http: insA.http }, 'control');

  // The forged row's id is BOUND, not minted inline: on the one run where this
  // INSERT succeeds — i.e. exactly when isolation has broken — the row must be
  // deletable by `cleanup()`. An unbound id would strand a row owned by an
  // identity nobody will delete, in a table with no FK to `auth.users`, on the
  // most alarming run, while reporting `"residue":[]`.
  const forged = await rest('POST', '/scenarios', A, { id: scenarioForged, user_id: B.userId, title: 'rls-guard forged' });
  if (forged.unanswered) {
    die('the server answered the forged INSERT with neither a data response nor a policy refusal',
      { http: forged.http, bodyKind: forged.bodyKind, bodySha256: forged.bodySha256 });
  }
  // A 403 PostgREST refusal, or an answered INSERT that created nothing. NOT
  // `http >= 400`, which passed this probe on any 502 — the same defect as G1
  // pointing the other way, at a FALSE GREEN.
  check('a user cannot create a row owned by someone else', forged.policyRefusal || forged.count === 0,
    { http: forged.http, rowsCreated: forged.count, refusedByPolicy: forged.policyRefusal });
  if (forged.dataResponse && forged.count > 0) forgedRowExists = true;

  // ── SELECT ───────────────────────────────────────────────────────────────
  const selOther = data(await rest('GET', `/scenarios?id=eq.${scenarioB}&select=id,user_id`, A), 'the cross-user READ');
  check('a user cannot READ another user’s row', selOther.count === 0, { http: selOther.http, rows: selOther.count });

  const selOwn = data(await rest('GET', `/scenarios?id=eq.${scenarioA}&select=id,user_id`, A), 'the own-row READ');
  check('POSITIVE CONTROL — a user CAN read its own row', selOwn.count === 1,
    { http: selOwn.http, rows: selOwn.count, ownerMatchesReader: selOwn.rows?.[0]?.user_id === A.userId }, 'control');

  const selAbsent = data(await rest('GET', `/scenarios?id=eq.${randomUUID()}&select=id`, A), 'the fabricated-id READ');
  check('CONTRAST CONTROL — a fabricated id returns nothing', selAbsent.count === 0, { http: selAbsent.http, rows: selAbsent.count });

  // ── UPDATE (per-command policies: a scoped SELECT is NOT evidence here) ──
  const MARKER = `rls-guard-${randomUUID().slice(0, 8)}`;
  const updOther = data(await rest('PATCH', `/scenarios?id=eq.${scenarioB}`, A, { title: MARKER }), 'the cross-user WRITE');
  check('a user cannot WRITE another user’s row', updOther.count === 0, { http: updOther.http, rowsAffected: updOther.count });

  const updStatus = data(await rest('PATCH', `/scenarios?id=eq.${scenarioB}`, A, { analysis_status: 'running' }), 'the cross-user status WRITE');
  check('a user cannot write another user’s analysis status', updStatus.count === 0, { http: updStatus.http, rowsAffected: updStatus.count });

  const updOwn = data(await rest('PATCH', `/scenarios?id=eq.${scenarioA}`, A, { title: `${MARKER}-own` }), 'the own-row WRITE');
  check('POSITIVE CONTROL — a user CAN write its own row', updOwn.count === 1, { http: updOwn.http, rowsAffected: updOwn.count }, 'control');

  // Bind to the OUTCOME, read back as the owner — not to the write's status code.
  const readBack = data(await rest('GET', `/scenarios?id=eq.${scenarioB}&select=title`, B), 'the owner read-back');
  // ⚠ THIS IS THE VACUITY PIN. DO NOT REMOVE IT AS REDUNDANT.
  // Every negative probe above asks whether A can reach B's row. If B's row is
  // not there — or is visible to nobody — all of them pass TRIVIALLY, and the
  // run would report "8/8 probes ran, all held" while having observed nothing.
  // This asserts the payload under test genuinely COULD have exhibited the
  // property, so a pass is the policy's doing and not the fixture's failure.
  // MEASURED: against a fixture where B's row exists but is visible to nobody,
  // this line is what turns a green exit 0 into exit 2 — removing it (and
  // null-guarding the line below) flips that fixture to a full green pass.
  // It is currently also backstopped by a TypeError on the next line, but that
  // is an ACCIDENT of null-dereference, not a guard: a routine `?.` tidy-up
  // would silently delete the only real protection. Hence this comment.
  if (readBack.count !== 1) die('could not read the second user’s own row back — this run lost its observation point', { http: readBack.http });
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
  fatal = `ran ${probesRun} probes, expected ${EXPECTED_PROBES} — a probe that cannot prove it ran is not a pass`;
  log({ fatal });
}
log({
  step: 'VERDICT', probesRun, failed: fails, brokenControls, fatal, residue, forgedRowCreated: forgedRowExists,
  limit: 'Proves DEPLOYED BEHAVIOUR on the DIRECT browser→PostgREST door only — not that the deployed policy came from the checked-in migration, and NOT the path this product’s own server uses (that one holds the service-role key and bypasses these policies by construction). Covers SELECT and UPDATE on scenarios; not DELETE, other tables, guest rows, or the RPC paths.',
});

// Exit 1 outranks everything: a positive observation of cross-user access is
// the one fact that must never be downgraded by a tidy-up problem.
if (fails.length > 0) {
  console.error(`\nISOLATION PROBE — FAILED (${fails.length}):\n` + fails.map((f) => `  · ${f}`).join('\n'));
  if (residue.length > 0) console.error(`\n⚠ residue left behind:\n` + residue.map((r) => `  · ${r}`).join('\n'));
  process.exit(1);
}
if (brokenControls.length > 0 && fatal === null) {
  fatal = `positive control(s) failed — this run could not read or write its OWN row, so it had no observation point: ${brokenControls.join('; ')}`;
  log({ fatal });
}
if (fatal !== null) {
  console.error(`\nISOLATION PROBE — HARD FAIL (could not run): ${fatal}`);
  if (residue.length > 0) console.error(`\n⚠ residue left behind:\n` + residue.map((r) => `  · ${r}`).join('\n'));
  process.exit(2);
}
if (residue.length > 0) {
  console.error(`\nISOLATION PROBE — HARD FAIL: probes held, but this run could not clear its own rows:\n`
    + residue.map((r) => `  · ${r}`).join('\n'));
  process.exit(2);
}
console.error(`\ncross-user isolation probe: ${probesRun}/${EXPECTED_PROBES} probes ran, all held.`);
