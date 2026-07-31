/**
 * PROMOTION GATE — grandfather baseline loader.
 *
 * The frozen, shrink-only allowlist of pre-gate promotions tolerated at their
 * exact hash. Committed at `tools/orchestrator-eval/promotion-gate-baseline.json`.
 * FAIL-LOUD on a malformed file: a baseline the loader silently read as empty
 * would drop every grandfather and redden CI (safe direction), but a malformed
 * ENTRY silently skipped could drop a real grandfather — so entries are
 * validated by name.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GrandfatherEntry } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_BASELINE_PATH = join(HERE, '..', '..', 'promotion-gate-baseline.json');

export function loadGrandfatherBaseline(path: string = DEFAULT_BASELINE_PATH): GrandfatherEntry[] {
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(`promotion-gate: baseline ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const root = parsed as { entries?: unknown } | null;
  const list = root && Array.isArray(root.entries) ? root.entries : null;
  if (!list) {
    throw new Error(`promotion-gate: baseline ${path} has no "entries" array.`);
  }
  return list.map((raw, i) => {
    const e = raw as Record<string, unknown>;
    if (
      e === null ||
      typeof e !== 'object' ||
      typeof e.task !== 'string' ||
      typeof e.promotedHash !== 'string' ||
      typeof e.reason !== 'string' ||
      typeof e.recordedAt !== 'string'
    ) {
      throw new Error(
        `promotion-gate: baseline ${path} entries[${i}] is malformed ` +
          '(need {task, promotedHash, reason, recordedAt} all strings).',
      );
    }
    return { task: e.task, promotedHash: e.promotedHash, reason: e.reason, recordedAt: e.recordedAt };
  });
}
