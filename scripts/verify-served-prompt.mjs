#!/usr/bin/env node
/**
 * LIVE TIER of the prompt↔pack sanction gate.
 *
 * The CI gate (`src/orchestrator-v5/context/__tests__/prompt-pack-sanction.gate.test.ts`)
 * checks the ContextPack against a CHECKED-IN snapshot of the served prompt.
 * That snapshot is a mirror, and **the prompt is re-pinnable in PMS with NO
 * deploy** — so CI alone would happily validate a prompt we do not serve.
 *
 * This script closes that hole: it reads what CEE is ACTUALLY serving and fails
 * when it is not the bytes CI validated against.
 *
 *   pnpm verify:served-prompt
 *
 * Env: CEE_BASE_URL (default https://cee-staging.onrender.com), ADMIN_API_KEY.
 *
 * FAIL-LOUD CONTRACT: every failure path — unreachable, non-200, malformed
 * body, missing key, missing credential, hash mismatch — exits NON-ZERO. There
 * is no skip branch. A gate that quietly passes when it cannot see is the
 * defect class this whole exercise exists to kill.
 *
 * `evaluateDrift` is exported PURE so its discrimination is provable without a
 * network (see tests/unit/ci/served-prompt-drift.test.ts) — an alarm whose
 * comparison is only reachable through a live call cannot be positive-controlled.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = join(
  HERE,
  '..',
  'src/orchestrator-v5/context/__tests__/fixtures/served-orchestrator-prompt.txt',
);
/** The PMS status key whose bytes the CI gate validates the pack against. */
export const TRACKED_KEY = 'routing';

/** Production hostnames this alarm must never be pointed at (staging is the product). */
const PRODUCTION_HOSTS = ['cee-production.onrender.com'];

export function shortSha256(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/**
 * How many times to sample the served prompt before judging it.
 *
 * OBSERVED LIVE (2026-07-25, during the v119->v120 re-pin): consecutive reads
 * of /admin/prompts/status returned 119, then 120, then 119, then 120. CEE
 * staging runs MULTIPLE INSTANCES and the prompt loader caches with a ~5-minute
 * TTL, so after a PMS re-pin the instances flip at different moments. For that
 * window the service genuinely serves TWO DIFFERENT COACH PROMPTS depending on
 * which instance takes the turn.
 *
 * A single sample cannot tell that apart from a settled drift, and would make
 * this alarm flap. Sampling lets the alarm name the condition instead.
 */
const SAMPLES = 3;

/**
 * PURE discriminator: did every sample agree on what is being served?
 * Disagreement is its OWN finding — a settled drift and a mid-propagation
 * split are different operational states and must not be reported as the same
 * thing. Never throws, never reads the network.
 */
export function evaluateConsistency(samples) {
  const seen = [...new Set(samples.map((s) => `v${s.version}/${s.hash}`))];
  if (seen.length <= 1) return { consistent: true, message: '' };
  return {
    consistent: false,
    message:
      `SERVED PROMPT IS NOT CONSISTENT ACROSS INSTANCES.\n` +
      `  ${SAMPLES} samples returned: ${seen.join(', ')}\n` +
      `Different instances are serving DIFFERENT coach prompts, so a user's turn\n` +
      `gets one or the other depending on which instance takes it. Usually a PMS\n` +
      `re-pin still propagating (loader TTL ~5 min) — re-run to confirm it settles.\n` +
      `If it persists, the pin did not reach every instance.`,
  };
}

/**
 * PURE discriminator: does the live served prompt match the pinned snapshot?
 * Returns `{ ok, message }`. Never throws, never reads the network.
 */
export function evaluateDrift({ liveHash, snapshotHash, version, liveChars, snapshotChars }) {
  if (!liveHash) {
    return { ok: false, message: `'${TRACKED_KEY}' row carries neither sent_hash nor content_hash` };
  }
  if (liveHash !== snapshotHash) {
    return {
      ok: false,
      message:
        `SERVED PROMPT DRIFT.\n` +
        `  live   ${TRACKED_KEY} v${version} hash=${liveHash} (${liveChars} chars)\n` +
        `  pinned snapshot        hash=${snapshotHash} (${snapshotChars} chars)\n` +
        `The CI sanction gate validated the ContextPack against bytes we are NOT serving.\n` +
        `Re-snapshot and re-ratify: the prompt was re-pinned in PMS without a deploy.\n` +
        `Every prompt-hash-keyed waiver in the sanction gate has now EXPIRED by design.`,
    };
  }
  return {
    ok: true,
    message: `OK: served ${TRACKED_KEY} v${version} hash=${liveHash} == pinned snapshot (${snapshotChars} chars)`,
  };
}

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  const base = process.env.CEE_BASE_URL ?? 'https://cee-staging.onrender.com';
  if (PRODUCTION_HOSTS.some((h) => base.includes(h))) {
    die(`refusing to run against production (${base}) — staging is the product`);
  }
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) die('ADMIN_API_KEY is not set — cannot read the served prompt. Not skipping.');

  let snapshot;
  try {
    snapshot = readFileSync(SNAPSHOT_PATH, 'utf8');
  } catch (e) {
    die(`cannot read the checked-in served-prompt snapshot at ${SNAPSHOT_PATH}: ${e.message}`);
  }

  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    let res;
    try {
      res = await fetch(`${base}/admin/prompts/status`, {
        headers: { 'X-Admin-Key': adminKey },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      die(`could not reach ${base}/admin/prompts/status: ${e.message}. Not skipping.`);
    }
    if (!res.ok) die(`${base}/admin/prompts/status returned HTTP ${res.status}`);

    let body;
    try {
      body = await res.json();
    } catch (e) {
      die(`status body is not JSON: ${e.message}`);
    }
    const r = (body.keys ?? []).find((k) => k.key === TRACKED_KEY);
    if (!r) {
      die(`no '${TRACKED_KEY}' row in /admin/prompts/status — the tracked key moved or PMS is degraded`);
    }
    samples.push({ version: r.version, hash: r.sent_hash ?? r.content_hash, chars: r.content_chars });
  }

  // A split across instances is a DIFFERENT operational state from settled
  // drift, and is reported as such rather than flapping the drift verdict.
  const consistency = evaluateConsistency(samples);
  if (!consistency.consistent) die(consistency.message);
  const row = { version: samples[0].version, sent_hash: samples[0].hash, content_chars: samples[0].chars };

  // `sent_hash` is the hash of what was last actually SENT to the model; fall
  // back to `content_hash` (resolved-but-not-yet-sent) only if the service has
  // not served a turn since boot.
  const verdict = evaluateDrift({
    liveHash: row.sent_hash ?? row.content_hash,
    snapshotHash: shortSha256(snapshot),
    version: row.version,
    liveChars: row.content_chars,
    snapshotChars: snapshot.length,
  });
  if (!verdict.ok) die(verdict.message);
  console.log(verdict.message);
}

// Only run when executed directly, so the pure exports are importable by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
