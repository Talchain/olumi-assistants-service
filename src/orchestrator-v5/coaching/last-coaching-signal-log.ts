/**
 * V5 Group 1 Task C (follow-up): last-coaching-signal sidecar.
 *
 * Problem the sidecar solves:
 *  - Edit-handler fact variants (set_factor_value, adjust_edge_strength,
 *    add_constraint) have no `enrichment` field in the frozen
 *    @talchain/schemas HandlerFactSchema. Step 5 therefore cannot attach
 *    coaching_signal_id to those facts.
 *  - The routing-log JSONL carries coaching_signal_id for every turn
 *    (analytics purpose), but scanning it per V5 turn is an unbounded
 *    linear read over a globally-scoped file.
 *
 * Fix: mirror the draft-coaching sidecar pattern. One JSONL file scoped
 * to scenarios in the same directory, append-only, last-write-wins on
 * read. Coaching-cache-reader reads both the sidecar and prior-facts
 * enrichment, picks the newer by timestamp so fresh edit-turn signals
 * never get masked by older analysis-turn signals.
 *
 * Non-throwing on I/O failure; swallow and warn. Same contract as the
 * draft-coaching sidecar.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { log } from '../../utils/telemetry.js';

import { isCoachingSignalId, type CoachingSignalId } from './types.js';

export const DEFAULT_LAST_COACHING_SIGNAL_LOG_PATH = resolve(
  process.cwd(),
  'logs',
  'v5-last-coaching-signal.jsonl',
);

export interface LastCoachingSignalRecord {
  readonly scenario_id: string;
  readonly signal_id: CoachingSignalId;
  readonly turn_id: string;
  readonly produced_at: string;
}

/**
 * Append a last-coaching-signal record. Swallows I/O errors; never throws.
 * Fire-and-forget from turn-executor Step 5.
 */
export async function appendLastCoachingSignal(
  record: LastCoachingSignalRecord,
  filePath: string = DEFAULT_LAST_COACHING_SIGNAL_LOG_PATH,
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
      'V5 last-coaching-signal log append failed, swallowed',
    );
  }
}

/**
 * Read the most recent LastCoachingSignalRecord for a scenario. Linear
 * scan; at PoC volumes (typically <10 signals per scenario) this is cheap.
 * Returns null on file-not-found or when no scenario match exists.
 */
export async function readLatestLastCoachingSignal(
  scenarioId: string,
  filePath: string = DEFAULT_LAST_COACHING_SIGNAL_LOG_PATH,
): Promise<LastCoachingSignalRecord | null> {
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
        'V5 last-coaching-signal log read failed, returning null',
      );
    }
    return null;
  }

  let latest: LastCoachingSignalRecord | null = null;
  for (const line of contents.split('\n')) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isLastCoachingSignalRecord(parsed)) continue;
    if (parsed.scenario_id !== scenarioId) continue;
    if (latest === null || parsed.produced_at >= latest.produced_at) {
      latest = parsed;
    }
  }
  return latest;
}

function isLastCoachingSignalRecord(value: unknown): value is LastCoachingSignalRecord {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.scenario_id === 'string' &&
    typeof obj.turn_id === 'string' &&
    typeof obj.produced_at === 'string' &&
    // Derived from COACHING_SIGNAL_IDS (types.ts) — previously a hand-list
    // that silently dropped any signal id it had not been manually taught.
    isCoachingSignalId(obj.signal_id)
  );
}
