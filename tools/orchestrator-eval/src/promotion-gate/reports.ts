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
import type { PromotionReport, PromotionReportDim, PromotionReportDimStatus } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The committed promotion-report directory. */
export const DEFAULT_REPORTS_DIR = join(HERE, '..', '..', 'reports', 'promotion');

const DIM_STATUSES: readonly PromotionReportDimStatus[] = ['pass', 'fail', 'not_applicable'];

function parseDim(raw: unknown, where: string): PromotionReportDim {
  const d = raw as Record<string, unknown>;
  if (
    d === null ||
    typeof d !== 'object' ||
    typeof d.name !== 'string' ||
    typeof d.required !== 'boolean' ||
    typeof d.status !== 'string' ||
    !(DIM_STATUSES as readonly string[]).includes(d.status)
  ) {
    throw new Error(
      `promotion-gate: ${where} has a malformed dim (need {name:string, status:pass|fail|not_applicable, ` +
        `required:boolean}): ${JSON.stringify(raw)}`,
    );
  }
  return {
    name: d.name,
    status: d.status as PromotionReportDimStatus,
    required: d.required,
    detail: typeof d.detail === 'string' ? d.detail : undefined,
  };
}

/** Validate one parsed JSON object into a {@link PromotionReport}, or throw. */
export function parsePromotionReport(raw: unknown, where: string): PromotionReport {
  const r = raw as Record<string, unknown>;
  if (r === null || typeof r !== 'object') {
    throw new Error(`promotion-gate: ${where} is not a JSON object.`);
  }
  const missing: string[] = [];
  if (r.schemaVersion !== 1) missing.push('schemaVersion=1');
  if (typeof r.task !== 'string') missing.push('task');
  if (typeof r.promptSha16 !== 'string') missing.push('promptSha16');
  if (typeof r.generatedAt !== 'string' || Number.isNaN(Date.parse(r.generatedAt as string)))
    missing.push('generatedAt(ISO)');
  if (r.verdict !== 'PASS' && r.verdict !== 'BLOCK') missing.push('verdict=PASS|BLOCK');
  if (typeof r.sampleSize !== 'number') missing.push('sampleSize');
  if (!Array.isArray(r.dims)) missing.push('dims[]');
  if (missing.length > 0) {
    throw new Error(`promotion-gate: ${where} is not a valid promotion report (bad/missing: ${missing.join(', ')}).`);
  }
  const dims = (r.dims as unknown[]).map((d, i) => parseDim(d, `${where} dims[${i}]`));
  return {
    schemaVersion: 1,
    task: r.task as string,
    promptSha16: r.promptSha16 as string,
    generatedAt: r.generatedAt as string,
    verdict: r.verdict as 'PASS' | 'BLOCK',
    sampleSize: r.sampleSize as number,
    dims,
    evidence: (r.evidence as Record<string, unknown> | undefined) ?? undefined,
  };
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
