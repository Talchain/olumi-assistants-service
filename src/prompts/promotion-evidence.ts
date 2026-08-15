/**
 * Shared, deterministic prompt-promotion evidence floor.
 *
 * Both the hermetic Git gate and the live PMS pointer gate consume this file.
 * Keeping the floor here prevents the dangerous split where CI rejects a
 * report that the admin route accepts (or vice versa).
 */

import { createHash } from 'node:crypto';

export const MIN_CERTIFYING_SAMPLE_SIZE = 3;
export const DEFAULT_MAX_REPORT_AGE_DAYS = 90;
export const DEFAULT_MAX_FUTURE_SKEW_DAYS = 1;

export type PromotionReportDimStatus = 'pass' | 'fail' | 'not_applicable';

export interface PromotionEvidenceDim {
  readonly name: string;
  readonly status: PromotionReportDimStatus;
  readonly required: boolean;
  readonly detail?: string;
}

export interface PromotionEvidenceReport {
  readonly schemaVersion: 1;
  readonly task: string;
  /** sha256(prompt content)[:16]. */
  readonly promptSha16: string;
  readonly generatedAt: string;
  readonly verdict: 'PASS' | 'BLOCK';
  readonly sampleSize: number;
  readonly dims: readonly PromotionEvidenceDim[];
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export type PromotionEvidenceBlockKind =
  | 'NO_REPORT'
  | 'HASH_MISMATCH'
  | 'EXPIRED'
  | 'FUTURE_DATED'
  | 'EVAL_FAILED';

export type PromotionEvidenceDecision =
  | {
      readonly decision: 'GATED_PASS';
      readonly task: string;
      readonly promptSha16: string;
      readonly report: PromotionEvidenceReport;
      readonly reason: string;
    }
  | {
      readonly decision: 'BLOCK';
      readonly task: string;
      readonly promptSha16: string;
      readonly blockKind: PromotionEvidenceBlockKind;
      readonly reason: string;
      readonly report?: PromotionEvidenceReport;
    };

export function promptContentHash16(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
}

/** Validate one committed report. Malformed evidence is never skipped. */
export function parsePromotionEvidenceReport(
  raw: unknown,
  where: string,
): PromotionEvidenceReport {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(`prompt-promotion: ${where} is not a JSON object`);
  }
  const report = raw as Record<string, unknown>;
  const missing: string[] = [];
  if (report.schemaVersion !== 1) missing.push('schemaVersion=1');
  if (typeof report.task !== 'string') missing.push('task');
  if (typeof report.promptSha16 !== 'string') missing.push('promptSha16');
  if (
    typeof report.generatedAt !== 'string' ||
    Number.isNaN(Date.parse(report.generatedAt))
  ) {
    missing.push('generatedAt(ISO)');
  }
  if (report.verdict !== 'PASS' && report.verdict !== 'BLOCK') {
    missing.push('verdict=PASS|BLOCK');
  }
  if (typeof report.sampleSize !== 'number') missing.push('sampleSize');
  if (!Array.isArray(report.dims)) missing.push('dims[]');
  if (missing.length > 0) {
    throw new Error(
      `prompt-promotion: ${where} is malformed (bad/missing: ${missing.join(', ')})`,
    );
  }

  const dims = (report.dims as unknown[]).map((rawDim, index): PromotionEvidenceDim => {
    if (rawDim === null || typeof rawDim !== 'object') {
      throw new Error(`prompt-promotion: ${where} dims[${index}] is not an object`);
    }
    const dim = rawDim as Record<string, unknown>;
    if (
      typeof dim.name !== 'string' ||
      typeof dim.required !== 'boolean' ||
      (dim.status !== 'pass' && dim.status !== 'fail' && dim.status !== 'not_applicable')
    ) {
      throw new Error(
        `prompt-promotion: ${where} dims[${index}] has malformed dim ` +
          '(need {name, required, status:pass|fail|not_applicable})',
      );
    }
    return {
      name: dim.name,
      required: dim.required,
      status: dim.status,
      ...(typeof dim.detail === 'string' ? { detail: dim.detail } : {}),
    };
  });

  return {
    schemaVersion: 1,
    task: report.task as string,
    promptSha16: report.promptSha16 as string,
    generatedAt: report.generatedAt as string,
    verdict: report.verdict as 'PASS' | 'BLOCK',
    sampleSize: report.sampleSize as number,
    dims,
    ...(report.evidence !== null && typeof report.evidence === 'object'
      ? { evidence: report.evidence as Record<string, unknown> }
      : {}),
  };
}

/** Re-derive the floor; never trust a report's verdict by itself. */
export function passesPromotionFloor(
  report: PromotionEvidenceReport,
): { ok: boolean; reason: string } {
  if (report.dims.length === 0) {
    return {
      ok: false,
      reason: 'report carries ZERO dimensions — a report that measured nothing cannot certify a pass',
    };
  }
  const measured = report.dims.filter((dim) => dim.status !== 'not_applicable');
  if (measured.length === 0) {
    return {
      ok: false,
      reason: `report measured ZERO dimensions (all ${report.dims.length} not_applicable) — examined nothing`,
    };
  }
  const failed = report.dims.filter((dim) => dim.status === 'fail').map((dim) => dim.name);
  if (failed.length > 0) {
    return { ok: false, reason: `failing dimension(s): ${failed.join(', ')}` };
  }
  const requiredNotMeasured = report.dims
    .filter((dim) => dim.required && dim.status === 'not_applicable')
    .map((dim) => dim.name);
  if (requiredNotMeasured.length > 0) {
    return {
      ok: false,
      reason:
        `required dimension(s) not measured (not_applicable): ${requiredNotMeasured.join(', ')} — ` +
        'cannot certify a floor on data we do not have',
    };
  }
  const measuredRequired = report.dims.filter(
    (dim) => dim.required && dim.status !== 'not_applicable',
  );
  if (measuredRequired.length === 0) {
    return {
      ok: false,
      reason:
        `ZERO required dimensions measured (${report.dims.length} dim(s), none required-and-measured) — ` +
        'a conditional dimension cannot, on its own, satisfy the floor',
    };
  }
  if (
    !Number.isFinite(report.sampleSize) ||
    report.sampleSize < MIN_CERTIFYING_SAMPLE_SIZE
  ) {
    return {
      ok: false,
      reason:
        `sample size n=${report.sampleSize} is below the certifying minimum of ` +
        `${MIN_CERTIFYING_SAMPLE_SIZE} — fewer runs is a compliance rate nobody has estimated, not a score`,
    };
  }
  if (report.verdict !== 'PASS') {
    return { ok: false, reason: `report verdict is ${report.verdict}, not PASS` };
  }
  return {
    ok: true,
    reason: `${measuredRequired.length} required dimension(s) measured and clear, n=${report.sampleSize}`,
  };
}

export interface EvaluatePromotionEvidenceOptions {
  readonly now: Date;
  readonly maxReportAgeDays?: number;
  readonly maxFutureSkewDays?: number;
}

/**
 * Decide whether these exact prompt bytes have current, hash-bound evidence.
 * The caller decides which tasks are gated; this function only evaluates a
 * task that is already known to require evidence.
 */
export function evaluatePromotionEvidence(
  task: string,
  content: string,
  reports: readonly PromotionEvidenceReport[],
  options: EvaluatePromotionEvidenceOptions,
): PromotionEvidenceDecision {
  const promptSha16 = promptContentHash16(content);
  const forTask = reports.filter((report) => report.task === task);
  const matching = forTask.filter((report) => report.promptSha16 === promptSha16);

  if (matching.length === 0) {
    return {
      decision: 'BLOCK',
      task,
      promptSha16,
      blockKind: forTask.length === 0 ? 'NO_REPORT' : 'HASH_MISMATCH',
      reason:
        forTask.length === 0
          ? `no committed promotion report exists for gated task "${task}"`
          : `promotion report hash(es) ${[...new Set(forTask.map((r) => r.promptSha16))].join(', ')} ` +
            `do not match target prompt hash ${promptSha16}`,
    };
  }

  const report = [...matching].sort(
    (a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt),
  )[0];
  const ageDays =
    (options.now.getTime() - Date.parse(report.generatedAt)) / 86_400_000;
  const maxFutureSkewDays =
    options.maxFutureSkewDays ?? DEFAULT_MAX_FUTURE_SKEW_DAYS;
  const maxReportAgeDays =
    options.maxReportAgeDays ?? DEFAULT_MAX_REPORT_AGE_DAYS;

  if (ageDays < -maxFutureSkewDays) {
    return {
      decision: 'BLOCK',
      task,
      promptSha16,
      blockKind: 'FUTURE_DATED',
      report,
      reason:
        `hash-matched report is ${(-ageDays).toFixed(0)}d in the future ` +
        `(tolerance ${maxFutureSkewDays}d)`,
    };
  }
  if (ageDays > maxReportAgeDays) {
    return {
      decision: 'BLOCK',
      task,
      promptSha16,
      blockKind: 'EXPIRED',
      report,
      reason:
        `hash-matched report is ${ageDays.toFixed(0)}d old ` +
        `(maximum ${maxReportAgeDays}d)`,
    };
  }

  const floor = passesPromotionFloor(report);
  if (!floor.ok) {
    return {
      decision: 'BLOCK',
      task,
      promptSha16,
      blockKind: 'EVAL_FAILED',
      report,
      reason: `hash-matched report does not clear the floor: ${floor.reason}`,
    };
  }

  return {
    decision: 'GATED_PASS',
    task,
    promptSha16,
    report,
    reason: `hash-matched current report clears the floor: ${floor.reason}`,
  };
}
