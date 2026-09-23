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
import {
  buildCanonicalAnalysisReadyFromGraph,
  buildAnalysisRefusalReadiness,
} from '../../../orchestrator/tools/analysis-ready-helper.js';

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
    // ⚠ THIS ASSERTION WAS CORRECTED, AND IT HAD ENCODED THE BUG. It used to
    // demand "Nothing is blocking the analysis" for a payload whose status is
    // `needs_user_mapping` — which is precisely the false readiness claim a
    // reviewer then found reachable from a real refusal producer. The real
    // property is narrower: an `offered` obligation is not LISTED as a blocker,
    // and readiness is still not claimed.
    expect(r.assistant_text).not.toContain('optional extra');
    expect(r.assistant_text).not.toMatch(/Nothing is blocking/i);
    expect(r.assistant_text).toContain('needs_user_mapping');
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

/**
 * ⛔ "NOTHING IS BLOCKING" IS ONLY SAYABLE ON AN EXPLICIT `ready`.
 *
 * The predicate was `status === 'ready' || blocking.length === 0`, so an empty
 * issue list alone produced the claim. A reviewer fed it a REAL production
 * producer and got the opposite of the truth — the payload said `blocked` and
 * named its blocker, and the answer said the model was ready to run.
 *
 * These bind the real producer, not a hand-authored shape, because the shape is
 * exactly what I got wrong.
 */
describe('a payload that says it is blocked is never called ready', () => {
  for (const code of ['NO_PATH_TO_GOAL', 'ORPHAN_NODE', 'NO_OPTIONS']) {
    it(`the real refusal producer for ${code} is not answered as ready`, () => {
      const readiness = buildAnalysisRefusalReadiness(code as never) as never;
      const { assistant_text, offer_run_analysis } = buildUnblockAnalysisAnswer(readiness, {
        authorises_repair: false,
      });
      expect(assistant_text).not.toMatch(/Nothing is blocking/i);
      expect(assistant_text).not.toMatch(/ready to run/i);
      expect(offer_run_analysis).toBe(false);
    });
  }

  it('it names the blocked_reason the payload gave, and claims no itemised list', () => {
    const readiness = buildAnalysisRefusalReadiness('NO_PATH_TO_GOAL' as never) as never;
    const { assistant_text } = buildUnblockAnalysisAnswer(readiness, { authorises_repair: false });
    expect(assistant_text).toContain('NO_PATH_TO_GOAL');
    expect(assistant_text).toContain('I do not have an itemised list');
  });

  it('CONTROL: an explicit ready IS answered as ready', () => {
    const r = buildUnblockAnalysisAnswer({ status: 'ready', readiness_issues: [] }, { authorises_repair: false });
    expect(r.assistant_text).toContain('Nothing is blocking the analysis');
    expect(r.offer_run_analysis).toBe(true);
  });

  it('an unknown status with no issues is stated, not guessed', () => {
    const r = buildUnblockAnalysisAnswer({ status: 'needs_user_mapping' }, { authorises_repair: false });
    expect(r.assistant_text).toContain('needs_user_mapping');
    expect(r.assistant_text).not.toMatch(/Nothing is blocking/i);
  });

  it('the repair tail sits on its own line after a LIST, not glued to the last item', () => {
    const r = buildUnblockAnalysisAnswer(
      {
        status: 'needs_encoding',
        readiness_issues: [
          { code: 'A', message: 'first thing', repairability: 'human_input_required' },
          { code: 'B', message: 'second thing', repairability: 'human_input_required' },
          { code: 'C', message: 'third thing', repairability: 'human_input_required' },
        ],
      },
      { authorises_repair: true },
    );
    expect(r.assistant_text).toContain('- third thing\nI have not changed anything yet');
    expect(r.assistant_text).not.toContain('- third thing I have not changed');
  });
});
