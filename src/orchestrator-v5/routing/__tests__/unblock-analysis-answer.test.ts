/**
 * GOLDEN REGRESSION — Paul's blocked journey, 23 Sep 2026.
 *
 * ⛔ THE FIXTURE IS THE REAL PERSISTED GRAPH, captured from deployed staging
 * (scenario `399c2814`) after the session in which the product failed him. It
 * is not an invention of this author's, which matters: the whole defect was a
 * predicate that looked right against imagined data.
 *
 * ── WHAT HAPPENED ──────────────────────────────────────────────────────────
 * Readiness held exactly ONE blocking issue for thirty-seven minutes:
 *   OPTION_NEEDS_MAPPING — "How does Two Developers change Coordination
 *   Overhead Risk? The proposed relationship is retained, but its mechanism
 *   and value still need clarification." (repairability: human_input_required)
 * "Hire a Tech Lead" was `status: ready` throughout.
 *
 * The product instead told him "'Two Developers' does not have effect values
 * yet" (it had two), and routed "just fix what's stopping me" to
 * `adjust_edge_strength`, which moved a number that could never satisfy a
 * mapping obligation.
 *
 * These assertions are what the user should have been told, derived from the
 * readiness authority and nothing else.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { buildUnblockAnalysisAnswer } from '../unblock-analysis-answer.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';

const blockedGraph = JSON.parse(
  readFileSync('src/orchestrator-v5/routing/__tests__/fixtures/blocked-journey-graph.json', 'utf-8'),
) as unknown;

describe("Paul's blocked journey — the answer he should have received", () => {
  const readiness = buildCanonicalAnalysisReadyFromGraph(blockedGraph as never) as never;

  it('the real graph still reproduces the single blocker', () => {
    const r = readiness as { status?: string; readiness_issues?: readonly { code?: string }[] };
    expect(r.status).toBe('needs_user_mapping');
    expect(r.readiness_issues).toHaveLength(1);
    expect(r.readiness_issues?.[0]?.code).toBe('OPTION_NEEDS_MAPPING');
  });

  it('names the ONE blocker, in the readiness authority’s own words', () => {
    const { assistant_text, offer_run_analysis } = buildUnblockAnalysisAnswer(readiness, {
      authorises_repair: true,
    });
    expect(assistant_text).toContain('One thing is blocking the analysis');
    expect(assistant_text).toContain('Coordination Overhead Risk');
    expect(offer_run_analysis).toBe(false);
  });

  it('does NOT repeat the false claim that sent him in circles', () => {
    const { assistant_text } = buildUnblockAnalysisAnswer(readiness, { authorises_repair: true });
    // The measured misdirection: "'Two Developers' does not have effect values yet."
    expect(assistant_text).not.toMatch(/no effect values|does not have effect values/i);
  });

  it('claims NO change it has not made, and does not promise an assumption it cannot supply', () => {
    const { assistant_text } = buildUnblockAnalysisAnswer(readiness, { authorises_repair: true });
    expect(assistant_text).toContain('I have not changed anything yet');
    // repairability is human_input_required — an estimate cannot resolve it.
    expect(assistant_text).toContain('needs your answer');
    expect(assistant_text).not.toMatch(/\bI (?:have )?(?:updated|adjusted|applied|set)\b/i);
  });

  it('CONTROL: with no repair authorisation it offers nothing extra', () => {
    const { assistant_text } = buildUnblockAnalysisAnswer(readiness, { authorises_repair: false });
    expect(assistant_text).toContain('One thing is blocking the analysis');
    expect(assistant_text).not.toContain('I have not changed anything yet');
  });
});

describe('buildUnblockAnalysisAnswer — the other states', () => {
  it('a ready model says so and offers the run', () => {
    const r = buildUnblockAnalysisAnswer({ status: 'ready', readiness_issues: [] }, { authorises_repair: false });
    expect(r.assistant_text).toContain('Nothing is blocking the analysis');
    expect(r.offer_run_analysis).toBe(true);
  });

  it('an OFFERED obligation is never presented as blocking', () => {
    const r = buildUnblockAnalysisAnswer(
      {
        status: 'needs_user_mapping',
        readiness_issues: [{ code: 'X', message: 'optional extra', obligation: 'offered' }],
      },
      { authorises_repair: false },
    );
    expect(r.assistant_text).toContain('Nothing is blocking the analysis');
  });

  it('several blockers are listed, not summarised away', () => {
    const r = buildUnblockAnalysisAnswer(
      {
        status: 'needs_encoding',
        readiness_issues: [
          { code: 'A', message: 'first thing', repairability: 'auto' },
          { code: 'B', message: 'second thing', repairability: 'auto' },
        ],
      },
      { authorises_repair: true },
    );
    expect(r.assistant_text).toContain('2 things are blocking the analysis');
    expect(r.assistant_text).toContain('first thing');
    expect(r.assistant_text).toContain('second thing');
    // Repairable ones may be estimated — but only after the user says go.
    expect(r.assistant_text).toContain('Tell me to go ahead');
  });

  it('missing readiness says so rather than guessing', () => {
    const r = buildUnblockAnalysisAnswer(undefined, { authorises_repair: false });
    expect(r.assistant_text).toContain('could not read the model state');
    expect(r.offer_run_analysis).toBe(false);
  });
});
