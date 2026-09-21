/**
 * Synthetic owned-scenario auth for the SDL state-spine witness (W3-B).
 *
 * WHY THIS EXISTS. CEE decides scenario ownership from the VERIFIED Supabase JWT subject only
 * (route-v2-preflight.ts ~:328-349 -> preflightEnsureScenario -> ensure_scenario_exists(id, user_id)).
 * There is no p_user_id on append_turn_atomic_v5 and the browser proxy strips body.user_id
 * unconditionally, so `Authorization: Bearer <access_token>` is the ONLY way to make a scenario owned,
 * and an owned scenario is the ONLY way a model_versions row is ever written
 * (c8 migration ~:615, `v_should_create := v_user_id IS NOT NULL AND ...`).
 *
 * ⛔ createWitnessUser() and deleteWitnessUser() WRITE to the shared production auth project.
 *    They are gated behind WITNESS_AUTH_APPROVED=1 and refuse otherwise. Paul's approval only.
 *    Everything else in this module is read-only and safe to run now.
 *
 * VERIFIED READ-ONLY 21 Sep 2026 ~22:4x BST against the live project:
 *   GET  /auth/v1/admin/users?page=1&per_page=2   -> HTTP 200, {users:[...]}, aud "authenticated"
 *   POST /auth/v1/token?grant_type=password (bad creds, anon key)
 *                                                 -> HTTP 400 {"error_code":"invalid_credentials"}
 *   i.e. both endpoints and both keys work; only the create step is unproven, by design.
 *
 * Token requirements CEE enforces (src/utils/supabase-user-jwt.ts ~:36-52): ES256/RS256 via the
 * project JWKS (HS256 retired, so a locally minted token can NEVER work), iss = <url>/auth/v1,
 * aud contains "authenticated", unexpired, sub is a UUID. The access_token from the password grant
 * satisfies all of these.
 *
 * Domain choice: olumi-witness.test — 2 such accounts already exist, and 3,484 of the project's
 * 3,503 users are @example.test synthetic accounts, so this is the estate's established pattern.
 */

const ADMIN_WRITE_ENV = 'WITNESS_AUTH_APPROVED'

function need(name, value) {
  if (!value) throw new Error(`witness-auth: missing ${name}`)
  return value
}

export function authConfig(env = process.env) {
  return {
    url: need('SUPABASE_URL', env.SUPABASE_URL).replace(/\/$/, ''),
    serviceRole: need('SUPABASE_SERVICE_ROLE_KEY_NEW', env.SUPABASE_SERVICE_ROLE_KEY_NEW),
    anon: need('SUPABASE_ANON_KEY', env.SUPABASE_ANON_KEY),
  }
}

async function call(url, init, what) {
  const res = await fetch(url, init)
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text.slice(0, 400) } }
  return { ok: res.ok, status: res.status, body, what }
}

/** READ-ONLY. Proves the admin credential and endpoint work before anything is created. */
export async function probeAdminReadable(cfg) {
  const r = await call(`${cfg.url}/auth/v1/admin/users?page=1&per_page=1`, {
    headers: { apikey: cfg.serviceRole, Authorization: `Bearer ${cfg.serviceRole}` },
  }, 'admin.list')
  return { reachable: r.status === 200 && Array.isArray(r.body?.users), status: r.status }
}

/**
 * READ-ONLY negative control. A deliberately wrong password MUST return 400 invalid_credentials.
 * If it returns anything else the anon key or endpoint is wrong and a later 400 would be
 * uninterpretable — this is the contrast control for the sign-in step.
 */
export async function probeTokenEndpoint(cfg) {
  const r = await call(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nonexistent-probe@olumi-witness.test', password: 'not-a-real-password' }),
  }, 'token.negative')
  return { discriminates: r.status === 400 && r.body?.error_code === 'invalid_credentials', status: r.status }
}

/** ⛔ WRITE. Requires Paul's approval via WITNESS_AUTH_APPROVED=1. */
export async function createWitnessUser(cfg, { email, password }, env = process.env) {
  if (env[ADMIN_WRITE_ENV] !== '1') {
    throw new Error(`witness-auth: refusing to create an auth user; ${ADMIN_WRITE_ENV}=1 requires Paul's approval`)
  }
  if (!/@olumi-witness\.test$/.test(email)) {
    throw new Error('witness-auth: refusing a non-synthetic email; use @olumi-witness.test')
  }
  const r = await call(`${cfg.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: cfg.serviceRole, Authorization: `Bearer ${cfg.serviceRole}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  }, 'admin.create')
  if (!r.ok || !r.body?.id) throw new Error(`witness-auth: create failed ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`)
  return { userId: r.body.id, email }
}

/** Sign in and return the access token CEE will verify against the project JWKS. */
export async function signIn(cfg, { email, password }) {
  const r = await call(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }, 'token.password')
  if (!r.ok || !r.body?.access_token) throw new Error(`witness-auth: sign-in failed ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`)
  const sub = JSON.parse(Buffer.from(r.body.access_token.split('.')[1], 'base64url').toString()).sub
  return { accessToken: r.body.access_token, sub }
}

/** ⛔ WRITE. Cleanup. Same approval gate. */
export async function deleteWitnessUser(cfg, userId, env = process.env) {
  if (env[ADMIN_WRITE_ENV] !== '1') throw new Error(`witness-auth: refusing to delete; ${ADMIN_WRITE_ENV}=1 required`)
  const r = await call(`${cfg.url}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: cfg.serviceRole, Authorization: `Bearer ${cfg.serviceRole}` },
  }, 'admin.delete')
  return { deleted: r.ok, status: r.status }
}

/** Headers for every witness call to CEE: service auth AND user identity. Both are required. */
export function witnessHeaders({ assistKey, accessToken }) {
  return {
    'Content-Type': 'application/json',
    'x-olumi-assist-key': assistKey,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }
}
