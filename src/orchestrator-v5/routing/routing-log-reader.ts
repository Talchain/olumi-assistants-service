/**
 * Routing Log Reader
 *
 * Reads a single RoutingLog entry from the JSONL file by turn_id.
 * Used by the /admin/v1/routing-log/:turn_id admin endpoint.
 *
 * The JSONL file is append-only with no rotation (see DEFAULT_ROUTING_LOG_PATH).
 * Reads the file line-by-line to avoid loading the entire file into memory.
 */

import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { DEFAULT_ROUTING_LOG_PATH, type RoutingLog } from './routing-log.js';
import { log } from '../../utils/telemetry.js';

/**
 * Read a single RoutingLog entry by turn_id from the JSONL file.
 *
 * Returns:
 *   RoutingLog  — entry found
 *   null        — turn_id not found in the file
 *   'file_absent' — JSONL file does not exist (never written, or rotated/deleted)
 */
export async function readRoutingLogEntry(
  turn_id: string,
  filePath: string = DEFAULT_ROUTING_LOG_PATH,
): Promise<RoutingLog | null | 'file_absent'> {
  // Check file existence before opening a stream
  try {
    await access(filePath);
  } catch {
    return 'file_absent';
  }

  return new Promise<RoutingLog | null>((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let found: RoutingLog | null = null;

    rl.on('line', (line) => {
      if (found) return; // Already found — drain remaining events cheaply
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const record = JSON.parse(trimmed) as RoutingLog;
        if (record.turn_id === turn_id) {
          found = record;
          // Close the stream immediately — no need to read further
          rl.close();
          stream.destroy();
        }
      } catch {
        // Malformed JSONL line — skip silently
      }
    });

    rl.on('close', () => resolve(found));
    rl.on('error', (err) => {
      log.warn({ turn_id, err }, 'routing-log-reader: readline error');
      resolve(null);
    });
    stream.on('error', (err) => {
      log.warn({ turn_id, err }, 'routing-log-reader: stream error');
      resolve(null);
    });
    // stream.on('error') rejects the readline interface too — resolve with null rather than reject
    stream.on('error', () => reject);
  }).catch((err) => {
    log.warn({ turn_id, err }, 'routing-log-reader: unexpected error, returning null');
    return null;
  });
}
