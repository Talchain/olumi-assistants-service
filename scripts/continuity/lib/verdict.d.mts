/**
 * Type declarations for the continuity harness verdict machinery.
 *
 * See `redact.d.mts` for why the runtime modules are `.mjs`. These types make
 * the three-outcome model explicit at the type level: a verdict is PASS, FAIL
 * or COULD_NOT_MEASURE, and nothing in the harness may collapse the third into
 * either of the other two.
 */

export type Verdict = 'PASS' | 'FAIL' | 'COULD_NOT_MEASURE';

export const PASS: 'PASS';
export const FAIL: 'FAIL';
export const CNM: 'COULD_NOT_MEASURE';

export const EXIT: {
  /** every case passed */
  OK: 0;
  /** a real, measured product defect */
  FAILED: 1;
  /** the instrument is not entitled to an opinion — NEVER a pass */
  COULD_NOT_MEASURE: 2;
};

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface GateResult {
  ok: boolean;
  reason?: string;
}

export interface CollapseResult {
  verdict: Verdict;
  distribution: Record<string, number>;
  split: boolean;
  reason: string;
}

export interface ScoreInput {
  preconditionChecks?: CheckResult[];
  discrimination?: GateResult | null;
  armChecks?: CheckResult[];
  controlChecks?: CheckResult[];
}

export interface ScoreResult {
  verdict: Verdict;
  stage: 'precondition' | 'discrimination' | 'arm' | 'control' | 'complete' | 'exception';
  reason: string;
}

export interface ShapeValidation {
  ok: boolean;
  problems: string[];
}

/** Refuse a value that is absent/empty before any comparison believes it. */
export function requireNonEmpty(
  label: string,
  value: unknown,
  opts?: { minLength?: number },
): GateResult;

/** Arms must be independently non-empty AND not byte-identical. */
export function assertArmsDiscriminate(armText: unknown, controlText: unknown): GateResult;

/** Disagreeing replays become COULD_NOT_MEASURE plus a finding — never a majority vote. */
export function collapseReplays(verdicts: Verdict[]): CollapseResult;

/** Precondition and discrimination are gates; only assertion failures yield FAIL. */
export function scoreCase(input: ScoreInput): ScoreResult;

/** Build a named check result. */
export function check(name: string, ok: unknown, detail?: unknown): CheckResult;

/** Refuse a case that cannot be falsified (no control, no precondition, bad state class). */
export function validateCaseShape(c: Record<string, unknown>): ShapeValidation;
