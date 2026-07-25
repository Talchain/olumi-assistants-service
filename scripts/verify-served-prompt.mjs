#!/usr/bin/env node
/**
 * LIVE TIER of the prompt↔pack sanction gate.
 *
 * The CI gate (`src/orchestrator-v5/context/__tests__/prompt-pack-sanction.gate.test.ts`)
 * checks the pack against a CHECKED-IN snapshot of the served prompt. That
 * snapshot is a mirror, and the prompt is re-pinnable in PMS with NO deploy —
 * so CI alone would happily validate a prompt we do not serve.
 *
 * This script closes that hole: it reads what CEE is ACTUALLY serving and fails
 * when it is not the bytes CI validated against.
 *
 *   node scripts/verify-served-prompt.mjs
 *
 * Env: CEE_BASE_URL (default https://cee-staging.onrender.com), ADMIN_API_KEY.
 *
 * FAIL-LOUD CONTRACT: every failure path — unreachable, non-200, malformed
 * body, missing key, missing credential, hash mismatch — exits NON-ZERO. There
 * is no skip branch. A gate that quietly passes when it cannot see is the
 * defect class this whole exercise exists to kill.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(
  HERE,
  '..',
  'src/orchestrator-v5/context/__tests__/fixtures/served-orchestrator-prompt.txt',
);
/** The PMS status key whose bytes the CI gate validates the pack against. */
const TRACKED_KEY = 'routing';

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const base = process.env.CEE_BASE_URL ?? 'https://cee-staging.onrender.com';
const adminKey = process.env.ADMIN_API_KEY;
if (!adminKey) die('ADMIN_API_KEY is not set — cannot read the served prompt. Not skipping.');

let snapshot;
try {
  snapshot = readFileSync(SNAPSHOT, 'utf8');
} catch (e) {
  die(`cannot read the checked-in served-prompt snapshot at ${SNAPSHOT}: ${e.message}`);
}
const snapshotHash = createHash('sha256').update(snapshot).digest('hex').slice(0, 16);

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
if (!row) die(`no '${TRACKED_KEY}' row in /admin/prompts/status — the tracked key moved or PMS is degraded`);

// `sent_hash` is the hash of what was last actually SENT to the model; fall
// back to `content_hash` (the resolved-but-not-yet-sent bytes) only if the
// service has not served a turn since boot.
const liveHash = row.sent_hash ?? row.content_hash;
if (!liveHash) die(`'${TRACKED_KEY}' row carries neither sent_hash nor content_hash`);

if (liveHash !== snapshotHash) {
  die(
    `SERVED PROMPT DRIFT.\n` +
      `  live   ${TRACKED_KEY} v${row.version} hash=${liveHash} (${row.content_chars} chars)\n` +
      `  pinned snapshot        hash=${snapshotHash} (${snapshot.length} chars)\n` +
      `The CI sanction gate validated the ContextPack against bytes we are NOT serving.\n` +
      `Re-snapshot and re-ratify: the prompt was re-pinned in PMS without a deploy.`,
  );
}

console.log(
  `OK: served ${TRACKED_KEY} v${row.version} hash=${liveHash} == pinned snapshot (${snapshot.length} chars)`,
);
