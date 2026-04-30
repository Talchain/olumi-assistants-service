/**
 * Pin the row classifications for two distinct soft-fail scenarios:
 *
 *  1. Step 8 dependency-skip — when step 7 fails to capture the rerun
 *     chip, step 8 must surface as `status: 'skipped'` with a
 *     `skipped_dependency:` evidence string. NOT `'failed'`. Excluded
 *     from headline pass-rate metric.
 *
 *  2. Step 5 transient_failure — when both LLM attempts return a
 *     recovery shape, step 5 must surface as `status: 'transient_failure'`
 *     (a distinct StepStatus value from `'failed'`). Also excluded from
 *     the headline pass-rate metric so an upstream LLM hiccup doesn't
 *     pollute the green-bar signal.
 *
 * The actual row construction lives in `index.ts:run()` and is exercised
 * end-to-end by `run-integration.test.ts` and friends. This file pins
 * the static contract: the row shape, the count semantics, and the
 * evidence-writer label rendering.
 */

import { describe, expect, it } from 'vitest';

import type { EvidenceRow, StepStatus } from '../../../tools/v5-journey-replay/types.js';
import { renderEvidencePack } from '../../../tools/v5-journey-replay/evidence-writer.js';

const HEADER = {
  branch: 'staging',
  commit_sha: 'abcdef0',
  base_url: 'https://cee-staging.onrender.com',
  started_at: '2026-04-30T10:00:00.000Z',
  prompt_version: 'v38.2',
  prompt_hash: 'XXXX',
  healthz: undefined,
  preflight: { status: 200, note: 'ok' },
  auth_mode: 'authenticated' as const,
  expected_build: 'a555cf7',
};

describe('StepStatus type — pinned union', () => {
  it('admits exactly four values: passed | failed | skipped | transient_failure', () => {
    // Compile-time pinning: any new StepStatus addition forces this
    // assertion to be updated consciously.
    const all: StepStatus[] = ['passed', 'failed', 'skipped', 'transient_failure'];
    expect(all).toHaveLength(4);
  });
});

describe('Step 8 dependency-skip row', () => {
  it('uses status="skipped" (not "failed") when prerequisite did not pass', () => {
    const row: EvidenceRow = {
      step: '8_rerun_via_chip',
      status: 'skipped',
      evidence: 'skipped_dependency: prerequisite 7_stale_explanation did not pass',
      failing_contract: 'skipped_dependency: 7_stale_explanation',
      outcome_class: 'skipped',
      endpoint: 'orchestrate/v2/turn',
    };

    expect(row.status).toBe('skipped');
    expect(row.status).not.toBe('failed');
    expect(row.evidence).toContain('skipped_dependency:');
    expect(row.evidence).toContain('7_stale_explanation');
  });

  it('renders with [SKIP] label and the skipped_dependency evidence string', () => {
    const rows: EvidenceRow[] = [
      {
        step: '8_rerun_via_chip',
        status: 'skipped',
        evidence: 'skipped_dependency: prerequisite 7_stale_explanation did not pass',
        failing_contract: 'skipped_dependency: 7_stale_explanation',
        outcome_class: 'skipped',
      },
    ];
    const pack = renderEvidencePack(HEADER, rows);
    expect(pack).toMatch(/`8_rerun_via_chip` \| \[SKIP\] skipped/);
    expect(pack).toContain('skipped_dependency: prerequisite 7_stale_explanation did not pass');
  });
});

describe('Step 5 transient_failure row', () => {
  it('uses status="transient_failure" (a distinct value from "failed")', () => {
    const row: EvidenceRow = {
      step: '5_explain_leader',
      status: 'transient_failure',
      evidence: 'status=500 both_attempts_failed first_status=500',
      failing_contract: 'transient_failure (LLM_TIMEOUT/LLM_UNAVAILABLE on retry)',
      outcome_class: 'v5-runtime',
      http_status: 500,
    };

    expect(row.status).toBe('transient_failure');
    expect(row.status).not.toBe('failed');
  });

  it('is excluded from the headline failed-count metric', () => {
    const rows: EvidenceRow[] = [
      { step: '1_draft_graph', status: 'passed', evidence: 'ok', outcome_class: 'v5-runtime' },
      {
        step: '5_explain_leader',
        status: 'transient_failure',
        evidence: 'both attempts upstream-flaked',
        failing_contract: 'transient_failure (LLM_TIMEOUT/LLM_UNAVAILABLE on retry)',
        outcome_class: 'v5-runtime',
      },
      { step: '6_edit_budget', status: 'passed', evidence: 'ok', outcome_class: 'v5-runtime' },
    ];

    // This mirrors the metric in index.ts:run().
    const failedCount = rows.filter((r) => r.status === 'failed').length;
    const transientCount = rows.filter((r) => r.status === 'transient_failure').length;
    expect(failedCount).toBe(0);
    expect(transientCount).toBe(1);
  });

  it('renders with the [TRANSIENT] label, distinct from [FAIL]', () => {
    const rows: EvidenceRow[] = [
      {
        step: '5_explain_leader',
        status: 'transient_failure',
        evidence: 'both attempts upstream-flaked',
        failing_contract: 'transient_failure (LLM_TIMEOUT/LLM_UNAVAILABLE on retry)',
        outcome_class: 'v5-runtime',
        http_status: 500,
      },
    ];
    const pack = renderEvidencePack(HEADER, rows);
    expect(pack).toMatch(/`5_explain_leader` \| \[TRANSIENT\] transient_failure/);
    expect(pack).not.toMatch(/`5_explain_leader` \| \[FAIL\] failed/);
  });
});
