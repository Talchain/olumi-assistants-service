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
  const row = (body.keys ?? []).find((k) => k.key === TRACKED_KEY);
  if (!row) {
    die(`no '${TRACKED_KEY}' row in /admin/prompts/status — the tracked key moved or PMS is degraded`);
  }

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
