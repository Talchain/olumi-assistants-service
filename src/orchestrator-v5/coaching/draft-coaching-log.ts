/**
 * V5 Group 1 — Draft-graph coaching sidecar (JSONL append, PoC fallback).
 *
 * Brief specified session persistence via v5_handler_facts; implemented
 * JSONL sidecar because the HandlerFact discriminated union in
 * @talchain/schemas is frozen at seven literals (no draft_graph, no
 * coaching). Acceptable for single-instance staging. Production path:
 * extend HandlerFactSchema with a coaching fact variant, or migrate to a
 * Supabase coaching_state table. See commit message for deviation record.
 *
 * Pattern mirrors routing-log.ts:
 *  - Appends to `logs/v5-draft-graph-coaching.jsonl` relative to CWD.
 *  - Non-throwing on I/O failure; swallow and log a warning.
 *  - Read path scans the file, returns the most recent record for a given
 *    scenario_id. Linear scan is fine at PoC volumes (1 draft per scenario,
 *    low scenario count on staging).
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { log } from '../../utils/telemetry.js';

import type { DraftCoaching } from './types.js';

export const DEFAULT_DRAFT_COACHING_LOG_PATH = resolve(
  process.cwd(),
  'logs',
  'v5-draft-graph-coaching.jsonl',
);

/**
 * Append a draft-coaching record. Swallows I/O errors; never throws.
 * Observability-only sidecar; MC-29 log-and-continue policy does not apply
 * (this is not a boundary validator).
 *
 * ⚠⚠ BLOCKED DEPENDENCY — DO NOT WIRE THIS INTO PRODUCTION YET (P5, 2026-07-27).
 *
 * This writer has ZERO production callers. Verified at tip `60d234a6`, complete
 * manifest, scope = whole repo excluding `node_modules`/`.git`, plus an
 * unrestricted grep for the filename `v5-draft-graph-coaching`: every
 * non-definition hit is under `__tests__/`. Claim type: **no-writer** — so
 * {@link readLatestDraftCoaching} always returns null today.
 *
 * The READ end, however, is already wired: `coaching-cache-reader.ts` feeds
 * `CoachingCache.draft_coaching` into ContextPack assembly. So the day a
 * production caller lands here, **pre-analysis coaching starts flowing into
 * POST-analysis prompts as apparent prior state** — and that coaching is
 * produced by a prompt with no output-quality eval, on a turn where nothing has
 * been computed. Speculation would be replayed downstream as though it were
 * established context.
 *
 * PRECONDITION FOR WIRING: the coaching-output eval checks
 * (`coaching-eval-checks.ts` — audit checks 1/2/5/7) green on the surface being
 * replayed, and the bias-detail content gate (P1, `gateCoachingCardBody`)
 * covering whatever reaches a user. This is a blocked dependency, not a TODO.
 *
 * ENFORCED, not merely documented: `__tests__/draft-coaching-log-writer-blocked.test.ts`
 * derives the caller set from the source tree and goes RED the moment a
 * non-test caller appears. Wiring it is therefore a deliberate act that must
 * delete that pin, not something that can happen by accident.
 */
export async function appendDraftCoaching(
  record: DraftCoaching,
  filePath: string = DEFAULT_DRAFT_COACHING_LOG_PATH,
): Promise<void> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    log.warn(
      {
        scenario_id: record.scenario_id,
        file_path: filePath,
        err: err instanceof Error ? err.message : String(err),
      },
      'V5 draft-coaching log append failed, swallowed',
    );
  }
}

/**
 * Read the most recent DraftCoaching record for a scenario. Returns null if
 * no record exists, if the file does not exist, or if reading/parsing fails.
 * Linear scan over the JSONL file; PoC scale.
 */
export async function readLatestDraftCoaching(
  scenarioId: string,
  filePath: string = DEFAULT_DRAFT_COACHING_LOG_PATH,
): Promise<DraftCoaching | null> {
  let contents: string;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      log.warn(
        {
          scenario_id: scenarioId,
          file_path: filePath,
          err: err instanceof Error ? err.message : String(err),
        },
        'V5 draft-coaching log read failed, returning null',
      );
    }
    return null;
  }

  let latest: DraftCoaching | null = null;
  for (const line of contents.split('\n')) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isDraftCoaching(parsed)) continue;
    if (parsed.scenario_id !== scenarioId) continue;
    if (latest === null || parsed.produced_at >= latest.produced_at) {
      latest = parsed;
    }
  }
  return latest;
}

function isDraftCoaching(value: unknown): value is DraftCoaching {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.scenario_id === 'string' &&
    typeof obj.produced_at === 'string' &&
    (obj.summary === null || typeof obj.summary === 'string') &&
    Array.isArray(obj.strengthen_items) &&
    (obj.widening_log === null || Array.isArray(obj.widening_log)) &&
    (obj.bias_signals === null || Array.isArray(obj.bias_signals))
  );
}
