/**
 * Runtime counterpart of the hermetic prompt-promotion gate.
 *
 * CI can only see committed manifest changes. PMS pointers can move through
 * the admin API without a commit, so gated tasks are checked again against the
 * exact target bytes before `stagingVersion` or `activeVersion` is persisted.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluatePromotionEvidence,
  parsePromotionEvidenceReport,
  promptContentHash16,
  type PromotionEvidenceDecision,
  type PromotionEvidenceReport,
} from './promotion-evidence.js';

/**
 * Production-readable declaration of the tasks with eval-pack markers.
 * `prompt-promotion-runtime-gate.test.ts` derives the pack set from disk and
 * requires exact equality, so a new/deleted pack cannot silently escape here.
 */
export const RUNTIME_PROMOTION_GATED_TASKS = [
  'decision_review',
] as const;

export type RuntimePromotionGatedTask =
  (typeof RUNTIME_PROMOTION_GATED_TASKS)[number];

export type RuntimePromotionDecision =
  | { readonly decision: 'UNGATED'; readonly task: string; readonly promptSha16: string }
  | PromotionEvidenceDecision
  | {
      readonly decision: 'BLOCK';
      readonly task: string;
      readonly promptSha16: string;
      readonly blockKind: 'EVIDENCE_UNAVAILABLE';
      readonly reason: string;
    };

function isRuntimeGated(task: string): task is RuntimePromotionGatedTask {
  return (RUNTIME_PROMOTION_GATED_TASKS as readonly string[]).includes(task);
}

export function loadRuntimePromotionReports(
  repoRoot: string = process.cwd(),
): PromotionEvidenceReport[] {
  const dir = join(
    repoRoot,
    'tools',
    'orchestrator-eval',
    'reports',
    'promotion',
  );
  if (!existsSync(dir)) {
    throw new Error(`promotion evidence directory is missing: ${dir}`);
  }
  const files = readdirSync(dir).filter((file) => file.endsWith('.json')).sort();
  if (files.length === 0) {
    throw new Error(`promotion evidence directory is empty: ${dir}`);
  }
  return files.map((file) => {
    const path = join(dir, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (error) {
      throw new Error(
        `cannot read promotion evidence ${path}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return parsePromotionEvidenceReport(parsed, path);
  });
}

export interface EvaluateRuntimePromotionOptions {
  readonly now?: Date;
  readonly repoRoot?: string;
  /** Tests may inject evidence; production reads the committed reports. */
  readonly reports?: readonly PromotionEvidenceReport[];
}

export function evaluateRuntimePromptPromotion(
  task: string,
  content: string,
  options: EvaluateRuntimePromotionOptions = {},
): RuntimePromotionDecision {
  const promptSha16 = promptContentHash16(content);
  if (!isRuntimeGated(task)) {
    return { decision: 'UNGATED', task, promptSha16 };
  }

  let reports: readonly PromotionEvidenceReport[];
  try {
    reports = options.reports ?? loadRuntimePromotionReports(options.repoRoot);
  } catch (error) {
    return {
      decision: 'BLOCK',
      task,
      promptSha16,
      blockKind: 'EVIDENCE_UNAVAILABLE',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  return evaluatePromotionEvidence(task, content, reports, {
    now: options.now ?? new Date(),
  });
}
