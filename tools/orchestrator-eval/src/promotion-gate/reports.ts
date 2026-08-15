/**
 * PROMOTION GATE — committed promotion-report loader.
 *
 * Reports live one-per-file under the promotion-reports directory. The loader
 * VALIDATES each file's shape and REFUSES a malformed one by name — a report the
 * loader silently dropped would turn a real, hash-matched PASS into a false
 * NO_REPORT block (and, worse, hide a report that was quietly corrupted).
 *
 * An absent or empty directory is NOT an error: no reports simply means every
 * gated task blocks (fail-closed, the safe direction). The vacuity risk lives
 * the other way — a report that PASSES on nothing — and that is caught by the
 * floor in `gate.ts`, not here.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePromotionEvidenceReport } from '../../../../src/prompts/promotion-evidence.js';
import type { PromotionReport } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The committed promotion-report directory. */
export const DEFAULT_REPORTS_DIR = join(HERE, '..', '..', 'reports', 'promotion');

/** Validate one parsed JSON object into a {@link PromotionReport}, or throw. */
export function parsePromotionReport(raw: unknown, where: string): PromotionReport {
  return parsePromotionEvidenceReport(raw, where);
}

/** Load every committed promotion report. Absent dir ⇒ []. Malformed ⇒ throw. */
export function loadPromotionReports(dir: string = DEFAULT_REPORTS_DIR): PromotionReport[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const reports: PromotionReport[] = [];
  for (const file of files) {
    const path = join(dir, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
      throw new Error(`promotion-gate: ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    reports.push(parsePromotionReport(parsed, path));
  }
  return reports;
}
