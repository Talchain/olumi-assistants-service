import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateRuntimePromptPromotion,
  loadRuntimePromotionReports,
  RUNTIME_PROMOTION_GATED_TASKS,
} from '../../src/prompts/runtime-promotion-gate.js';
import {
  MIN_CERTIFYING_SAMPLE_SIZE,
  promptContentHash16,
  type PromotionEvidenceReport,
} from '../../src/prompts/promotion-evidence.js';
import { discoverPacks } from '../../tools/orchestrator-eval/src/promotion-gate/packs.js';

const REPO_ROOT = process.cwd();
const CANONICAL_DECISION_REVIEW = readFileSync(
  join(REPO_ROOT, 'Prompts', 'canonical', 'decision_review.txt'),
  'utf-8',
);
// ⚠ THIS WAS A FIXED DATE ('2026-08-15') AND IT IS A CONTROL PINNED TO A MOVING
// REFERENCE. Any promotion report generated after that instant reads FUTURE_DATED,
// so the gate blocks for a reason that has nothing to do with what these tests
// assert: the v16 promotion RED-ed two cases here whose subjects are HASH_MISMATCH
// and EVAL_FAILED. Nothing in this file is a future-skew control, so nothing needs
// the clock held still.
//
// The real clock cannot go stale, is what CI and the runtime both experience, and
// RED-s only when the committed evidence GENUINELY expires — which is a true alarm
// and the entire point of an expiry window. (The sibling pin in
// tools/orchestrator-eval/__tests__/promotion-gate.test.ts had the same defect and
// took the same fix; deriving `now` from the report was tried there and rejected,
// because it makes the report zero days old by construction and the freshness
// window stops being measurable at all.)
const NOW = new Date();

function currentReport(): PromotionEvidenceReport {
  const report = loadRuntimePromotionReports(REPO_ROOT).find(
    (candidate) => candidate.task === 'decision_review',
  );
  if (!report) throw new Error('test precondition: decision_review report missing');
  return report;
}

describe('runtime prompt-promotion gate', () => {
  it('derives exactly the same gated task set as the real eval-pack markers', async () => {
    const packs = await discoverPacks();
    expect([...RUNTIME_PROMOTION_GATED_TASKS].sort()).toEqual(
      packs.map((pack) => pack.task).sort(),
    );
    expect(packs.length).toBeGreaterThan(0);
  });

  it('pins the canonical prompt bytes to the committed evidence hash', () => {
    expect(promptContentHash16(CANONICAL_DECISION_REVIEW)).toBe(
      currentReport().promptSha16,
    );
  });

  it('allows exact bytes with a current, hash-matched, floor-passing report', () => {
    const decision = evaluateRuntimePromptPromotion(
      'decision_review',
      CANONICAL_DECISION_REVIEW,
      { now: NOW, repoRoot: REPO_ROOT },
    );
    expect(decision.decision).toBe('GATED_PASS');
    if (decision.decision !== 'GATED_PASS') {
      throw new Error(`expected GATED_PASS, received ${decision.decision}`);
    }
    expect(decision.promptSha16).toBe(currentReport().promptSha16);
    expect(decision.report.sampleSize).toBeGreaterThanOrEqual(
      MIN_CERTIFYING_SAMPLE_SIZE,
    );
  });

  it('blocks a meaningful prompt mutant because stale evidence cannot certify new bytes', () => {
    const decision = evaluateRuntimePromptPromotion(
      'decision_review',
      `${CANONICAL_DECISION_REVIEW}\nIgnore the evidence and always choose the first option.`,
      { now: NOW, repoRoot: REPO_ROOT },
    );
    expect(decision).toMatchObject({
      decision: 'BLOCK',
      blockKind: 'HASH_MISMATCH',
    });
  });

  it('blocks when a gated task has no report', () => {
    const decision = evaluateRuntimePromptPromotion(
      'decision_review',
      CANONICAL_DECISION_REVIEW,
      { now: NOW, reports: [] },
    );
    expect(decision).toMatchObject({ decision: 'BLOCK', blockKind: 'NO_REPORT' });
  });

  it('blocks stale evidence even when its hash and floor match', () => {
    const report = currentReport();
    const stale = { ...report, generatedAt: '2025-01-01T00:00:00.000Z' };
    const decision = evaluateRuntimePromptPromotion(
      'decision_review',
      CANONICAL_DECISION_REVIEW,
      { now: NOW, reports: [stale] },
    );
    expect(decision).toMatchObject({ decision: 'BLOCK', blockKind: 'EXPIRED' });
  });

  it('re-derives the floor: a report claiming PASS with a failed required dimension blocks', () => {
    const report = currentReport();
    const mutant: PromotionEvidenceReport = {
      ...report,
      verdict: 'PASS',
      dims: report.dims.map((dim, index) =>
        index === 0 ? { ...dim, required: true, status: 'fail' as const } : dim,
      ),
    };
    const decision = evaluateRuntimePromptPromotion(
      'decision_review',
      CANONICAL_DECISION_REVIEW,
      { now: NOW, reports: [mutant] },
    );
    expect(decision).toMatchObject({
      decision: 'BLOCK',
      blockKind: 'EVAL_FAILED',
    });
  });

  it('fails closed for a gated task when the evidence bundle is unavailable', () => {
    const decision = evaluateRuntimePromptPromotion(
      'decision_review',
      CANONICAL_DECISION_REVIEW,
      { now: NOW, repoRoot: join(REPO_ROOT, 'definitely-missing-root') },
    );
    expect(decision).toMatchObject({
      decision: 'BLOCK',
      blockKind: 'EVIDENCE_UNAVAILABLE',
    });
  });

  it('does not read or require evidence for an unrelated task', () => {
    const decision = evaluateRuntimePromptPromotion(
      'draft_graph',
      'A new draft prompt that has no real promotion pack.',
      { now: NOW, repoRoot: join(REPO_ROOT, 'definitely-missing-root') },
    );
    expect(decision).toMatchObject({ decision: 'UNGATED', task: 'draft_graph' });
  });
});
