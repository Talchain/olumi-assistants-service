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

/**
 * The PMS task `TRACKED_KEY` actually RESOLVES FROM.
 *
 * `routing` and `orchestrator` are ONE artefact: the logical key stays
 * `routing`, but its PMS lookup resolves the operator-managed `orchestrator`
 * task — so this is the row Paul edits when he edits "the coach prompt".
 * Declared at `src/prompts/estate.ts` (`PMS_TASK_ALIAS`).
 *
 * A `.mjs` script cannot import that TypeScript map, so this IS a mirror —
 * and the estate's dominant defect is the mirror that drifts silently. It is
 * therefore GUARDED BY DERIVATION in tests/unit/ci/served-prompt-drift.test.ts,
 * which imports `PMS_TASK_ALIAS` and fails if the two disagree. Re-pointing the
 * alias without re-ratifying the snapshot turns that test red.
 */
export const TRACKED_PMS_TASK = 'orchestrator';

/** Rendered where a task could not be established — never a fabricated id. */
const UNKNOWN_TASK = 'unknown';

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
 * PURE: pick the status row this alarm is about.
 *
 * Extracted from `main()` for one measured reason: while this lookup lived
 * inline in the network path, replacing it with `body.keys[0]` left the suite
 * 24/24 GREEN — the selection was the one step nothing could see. Ordering of
 * `/admin/prompts/status` rows is not a contract, so "the first row" is not a
 * stable stand-in for "the routing row".
 *
 * Returns `null` when the tracked key is absent; the caller decides that is
 * fatal (it is). Never throws, never reads the network.
 */
export function selectTrackedRow(body) {
  return (body?.keys ?? []).find((k) => k.key === TRACKED_KEY) ?? null;
}

/**
 * PURE discriminator: are these bytes the bytes of the task we think they are?
 *
 * ── WHY A HASH COMPARISON IS NOT ENOUGH ───────────────────────────────────
 * `evaluateDrift` answers "do these bytes match the snapshot?". It does NOT
 * answer "whose bytes are these?" — and before this function existed, nothing
 * did. The row was selected by `.find(k => k.key === TRACKED_KEY)` inside the
 * un-unit-testable network path, so the binding was unguarded: measured at
 * 9de184f1, re-pointing TRACKED_KEY to `draft_graph` and replacing the row
 * lookup with `body.keys[0]` BOTH left the suite 16/16 green.
 *
 * That matters beyond tidiness. Every A/B verdict this estate has recorded
 * rests on knowing which prompt bytes were live for the turns being compared,
 * and `/admin/prompts/status` has already been observed reporting a version
 * the served turns were not receiving. A PASS that cannot name its own task
 * cannot settle that question.
 *
 * FAIL-LOUD, per this module's contract: an UNPROVEN binding is a failure, not
 * a pass. `pms_task` is populated only from the live routing snapshot
 * (src/prompts/readiness.ts) — its absence means the row did not come from the
 * snapshot we are trying to verify, which is precisely the degraded state the
 * alarm exists to refuse. Never throws, never reads the network.
 */
export function evaluateTaskBinding({ key, pmsTask, source }) {
  if (key !== TRACKED_KEY) {
    return {
      ok: false,
      message:
        `WRONG PROMPT ROW.\n` +
        `  verified  key=${key ?? UNKNOWN_TASK}\n` +
        `  expected  key=${TRACKED_KEY} (resolving PMS task '${TRACKED_PMS_TASK}')\n` +
        `The snapshot pins the '${TRACKED_KEY}' prompt. A hash comparison against\n` +
        `any other row proves nothing about the prompt users are served.`,
    };
  }
  if (pmsTask == null) {
    return {
      ok: false,
      message:
        `PROMPT TASK NOT ESTABLISHED.\n` +
        `  '${TRACKED_KEY}' row carries no pms_task, so the bytes cannot be bound to\n` +
        `  the '${TRACKED_PMS_TASK}' PMS row they are supposed to come from.\n` +
        `Only the LIVE routing snapshot populates pms_task, so this row was resolved\n` +
        `some other way (pre-boot, or a fallback). Not skipping: an unprovable\n` +
        `binding is exactly the state this alarm exists to refuse.`,
    };
  }
  if (pmsTask !== TRACKED_PMS_TASK) {
    return {
      ok: false,
      message:
        `PROMPT ALIAS RE-POINTED.\n` +
        `  '${TRACKED_KEY}' now resolves PMS task '${pmsTask}', not '${TRACKED_PMS_TASK}'.\n` +
        `The bytes may still match the snapshot, but the row an operator edits to\n` +
        `change this prompt has MOVED. Re-ratify the alias and the snapshot together.`,
    };
  }
  return {
    ok: true,
    message: `${TRACKED_KEY}<-${pmsTask} [source=${source ?? UNKNOWN_TASK}]`,
  };
}

/**
 * PURE discriminator: does the live served prompt match the pinned snapshot?
 * Returns `{ ok, message }`. Never throws, never reads the network.
 */
export function evaluateDrift({
  liveHash,
  snapshotHash,
  version,
  liveChars,
  snapshotChars,
  pmsTask,
  source,
}) {
  // The task identity travels ON THE SAME LINE as the hash, deliberately: a
  // hash in one log line and a task id in another cannot be correlated after
  // the fact — least of all across the multi-instance split documented above.
  const who = `${TRACKED_KEY}<-${pmsTask ?? UNKNOWN_TASK} [source=${source ?? UNKNOWN_TASK}]`;
  if (!liveHash) {
    return { ok: false, message: `'${TRACKED_KEY}' row carries neither sent_hash nor content_hash` };
  }
  if (liveHash !== snapshotHash) {
    return {
      ok: false,
      message:
        `SERVED PROMPT DRIFT.\n` +
        `  live   ${who} v${version} hash=${liveHash} (${liveChars} chars)\n` +
        `  pinned snapshot        hash=${snapshotHash} (${snapshotChars} chars)\n` +
        `The CI sanction gate validated the ContextPack against bytes we are NOT serving.\n` +
        `Re-snapshot and re-ratify: the prompt was re-pinned in PMS without a deploy.\n` +
        `Every prompt-hash-keyed waiver in the sanction gate has now EXPIRED by design.`,
    };
  }
  return {
    ok: true,
    message: `OK: served ${who} v${version} hash=${liveHash} == pinned snapshot (${snapshotChars} chars)`,
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
    const r = selectTrackedRow(body);
    if (!r) {
      die(`no '${TRACKED_KEY}' row in /admin/prompts/status — the tracked key moved or PMS is degraded`);
    }
    // key / pms_task / source travel WITH the bytes. They used to be dropped
    // here, which is what made the whole verdict task-blind downstream.
    samples.push({
      version: r.version,
      hash: r.sent_hash ?? r.content_hash,
      chars: r.content_chars,
      key: r.key,
      pmsTask: r.pms_task,
      source: r.source,
    });
  }

  // A split across instances is a DIFFERENT operational state from settled
  // drift, and is reported as such rather than flapping the drift verdict.
  const consistency = evaluateConsistency(samples);
  if (!consistency.consistent) die(consistency.message);

  // WHOSE bytes are these? Asked BEFORE the hash comparison, because a hash
  // match against the wrong row is a false green, not a weaker pass. Every
  // sample is checked: `evaluateConsistency` compares version+hash only, so a
  // row substitution that happened to carry matching bytes would slip past it.
  for (const sample of samples) {
    const binding = evaluateTaskBinding(sample);
    if (!binding.ok) die(binding.message);
  }

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
    pmsTask: samples[0].pmsTask,
    source: samples[0].source,
  });
  if (!verdict.ok) die(verdict.message);
  console.log(verdict.message);
}

// Only run when executed directly, so the pure exports are importable by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
