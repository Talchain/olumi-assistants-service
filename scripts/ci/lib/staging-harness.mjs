/**
 * Shared transport helpers for the two dependency-free staging alarms —
 * `staging-journey-smoke.mjs` and `staging-structural-delete-witness.mjs`.
 *
 * WHY THIS FILE EXISTS. Both scripts carried near-verbatim copies of
 * `postTurn` / `waitForBuild` / `readyOptionIds` / `uuid` / `log`. That is the
 * hand-maintained mirror (CLAUDE.md trap 12) at its most ordinary, and it had
 * ALREADY drifted: the second copy of `waitForBuild` dropped the
 * deadline-clamp comment explaining why the final sleep is `Math.min(15000,
 * remaining)` — so the next reader of that copy had a magic number and no
 * reason, and the reason is a real one (a fixed 15s wait on the last iteration
 * burns job time after the poll has already given up). One drifting copy is
 * how the two alarms end up disagreeing about what they measured.
 *
 * ⚠⚠ THE NO-INSTALL PROPERTY IS LOAD-BEARING AND THIS FILE MUST PRESERVE IT.
 * Both workflows check out `sparse-checkout: scripts/ci` and run NO
 * `pnpm install`, deliberately: the alarms must keep working when the
 * dependency graph is what broke. So:
 *   · node BUILT-INS ONLY — no package imports, ever, not even dev-only ones;
 *   · this file must stay UNDER `scripts/ci/`, because that one directory is
 *     the whole checkout those jobs get. Moving it anywhere else makes both
 *     alarms fail at import time with `ERR_MODULE_NOT_FOUND`;
 *   · it reads no repository files and has no side effects at import time.
 *
 * Everything here is pure transport or formatting. No assertion, no verdict:
 * the alarms own their own semantics, and sharing a JUDGEMENT between two
 * alarms would let one defect silence both.
 */

/** A fresh turn id. `crypto` is a node built-in global on 20+. */
export const uuid = () => globalThis.crypto.randomUUID();

/** One line to stdout. The workflows `| tee` this into an uploaded artefact. */
export const log = (msg) => process.stdout.write(`${msg}\n`);

/**
 * POST one turn to `/orchestrate/v2/turn`.
 *
 * Never throws on a non-2xx or an unparseable body — it returns them, so the
 * caller's failure message stays in one place and a 500 with an HTML body is
 * reported as what it is rather than as a JSON parse crash.
 *
 * The timer is an explicit `AbortController` + `clearTimeout` in `finally`
 * rather than `AbortSignal.timeout(ms)`: the latter leaves a live timer holding
 * the event loop open for the remainder of the timeout after a fast response,
 * which on a script making dozens of calls with a 300s budget is a measurable
 * tail on job time.
 *
 * @returns {Promise<{status: number, body: unknown, ms: number}>}
 */
export async function postTurn(base, key, payload, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${base}/orchestrate/v2/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Olumi-Assist-Key": key },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { __unparseable: text.slice(0, 500) };
    }
    return { status: res.status, body, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Poll `/healthz` until the served build matches `expectSha`.
 *
 * Returns `{ok, served, waitedMs, attempt}` and NEVER throws on a bad build —
 * the caller decides what a stale deploy means, so the failure message stays in
 * one place.
 *
 * @returns {Promise<{ok: boolean, served: string|null, waitedMs: number, attempt: number}>}
 */
export async function waitForBuild(base, expectSha, timeoutMs) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const want = expectSha.slice(0, 7);
  let served = null;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(20000) });
      served = (await res.json())?.build ?? null;
      if (served && served.slice(0, 7) === want) {
        return { ok: true, served, waitedMs: Date.now() - startedAt, attempt };
      }
      log(`  [freshness] attempt ${attempt}: serving ${served ?? "?"}, want ${want} — waiting…`);
    } catch (e) {
      log(`  [freshness] attempt ${attempt}: /healthz unreachable (${e.name}) — waiting…`);
    }
    // ⭐ NEVER SLEEP PAST THE DEADLINE, and this comment is the reason the file
    // exists: the SECOND copy of this function dropped it, leaving a bare
    // `Math.min(15000, remaining)` with no explanation. A fixed 15s wait on the
    // final iteration burns up to 15s of job time AFTER the poll has already
    // given up. The 15s interval itself is deliberately kept — ~60 healthz GETs
    // over 15 minutes is negligible load and needs no backoff.
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(15000, remaining)));
  }
  return { ok: false, served, waitedMs: Date.now() - startedAt, attempt };
}

/** The option OBJECTS a response says the model is comparing (shape only). */
export function readyOptions(body) {
  return Array.isArray(body?.analysis_ready?.options) ? body.analysis_ready.options : [];
}

/**
 * The USABLE `option_id`s a response says the model is comparing.
 *
 * Note what this drops, and pin the precondition at the call site before
 * relying on it: an option object whose `option_id` is `""`, `null` or absent
 * is NOT identifiable, so it cannot participate in an identity check. The
 * contract admits all three — `OptionForAnalysis.id` is `z.string()` with no
 * `.min(1)` (src/schemas/analysis-ready.ts:85), the emit is
 * `option_id: opt.id` (analysis-ready-helper.ts:1123), and the wire envelope
 * validates `analysis_ready` as `z.unknown().optional()`
 * (src/orchestrator/validation/response-envelope-schema.ts:135) — so nothing
 * enforces a usable `option_id` on egress. A caller that judges on the short
 * list without pinning its own precondition is judging on a silence.
 */
export function readyOptionIds(body) {
  return readyOptions(body)
    .map((o) => o?.option_id)
    .filter((id) => typeof id === "string" && id.length > 0);
}
