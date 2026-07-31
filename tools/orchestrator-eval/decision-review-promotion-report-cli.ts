/**
 * Generate the committed decision_review PROMOTION REPORT from H1's frozen
 * live-capture scoring. One-shot producer, deterministic, zero network:
 *
 *   pnpm eval:decision-review:promotion-report
 *
 * Reads the H1 live-capture-report.json, hashes the served canonical prompt, and
 * writes reports/promotion/decision_review.json. Re-running it reproduces the
 * committed artifact byte-for-byte (except generatedAt, which is pinned to the
 * capture date so the artifact is stable).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDecisionReviewPromotionReport,
  type LiveCaptureReport,
} from './src/decision-review/promotion-report.js';
import { promptHash16 } from './src/promotion-gate/manifest.js';
import { readServedPromptText } from './src/decision-review/served-contract.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_CAPTURE = join(
  HERE,
  'reports',
  'decision-review-v14-baseline-2026-07-31',
  'live-capture-report.json',
);
const OUT_DIR = join(HERE, 'reports', 'promotion');
const OUT = join(OUT_DIR, 'decision_review.json');

const capture = JSON.parse(readFileSync(LIVE_CAPTURE, 'utf-8')) as LiveCaptureReport;
const servedSha16 = promptHash16(readServedPromptText());

const report = buildDecisionReviewPromotionReport(capture, {
  candidateLabel: 'served_v14',
  promptSha16: servedSha16,
  // Pinned to the capture date, not "now": the outputs are frozen, so the report
  // is a frozen observation. (The gate's expiry window is measured against this.)
  generatedAt: '2026-07-30T00:00:00.000Z',
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(
  `decision_review promotion report -> ${OUT}\n  promptSha16 ${report.promptSha16} · verdict ${report.verdict} · n=${report.sampleSize}\n`,
);
