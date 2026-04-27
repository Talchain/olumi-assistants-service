/**
 * V5 golden-path Step 5 denial-phrase regression guard.
 *
 * Background: the V5 baseline replay (commit 06e26513) showed Step 5
 * ("Why does the leading option win?") returning "results aren't back
 * yet" because the chip-click run_analysis dispatch path shipped without
 * `analysis_ready` on the wire. After the wire fix, denial phrasing
 * indicates either (a) analysis_ready is still missing on the wire, or
 * (b) the ContextPack is missing the analysis fact. Either way it is a
 * blocker — encoded as a hard assertion on the Step 5 row.
 */

import { describe, it, expect } from 'vitest';

import { assertExplainLeader } from '../../../tools/v5-journey-replay/assertions.js';

const PASSING_TEXT =
  'Option Launch wins with about 62% probability. The leading driver is marketing spend, ' +
  "though the margin is sensitive to a 10% shift in the launch→revenue edge.";

describe('assertExplainLeader — Step 5 denial-phrase regression guard', () => {
  it('passes when assistant_text is substantive and contains no denial phrasing', () => {
    const r = assertExplainLeader({
      status: 200,
      body: { assistant_text: PASSING_TEXT, suggested_actions: [] },
      elapsed_ms: 100,
    });
    expect(r.ok).toBe(true);
  });

  it.each([
    "results aren't back yet",
    'results are not back yet',
    "haven't run the analysis",
    'have not run the analysis',
    "haven't run an analysis",
    "analysis isn't ready",
    'analysis is not ready',
    'analysis is not complete',
    "analysis isn't complete",
    "I don't have any analysis result yet",
    "I do not have the analysis output",
    "results aren't available yet",
    'analysis is not available yet',
    "the simulation hasn't completed",
    'the computation has not finished',
  ])('fails when assistant_text contains denial phrase: %s', (phrase) => {
    const r = assertExplainLeader({
      status: 200,
      body: {
        assistant_text: `Sorry, ${phrase}. Try running it first.`,
        suggested_actions: [],
      },
      elapsed_ms: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toMatch(/step_5_denial_phrase/);
      expect(r.evidence).toMatch(/denial_phrase=/);
    }
  });

  // Improvement 3 (narrowed regexes): legitimate product phrases that
  // discuss analysis state without denying its availability MUST NOT
  // trigger the guard.
  it.each([
    'No new analysis is needed beyond what we have.',
    'No further analysis required to make this call.',
    'No additional analysis is needed — Option A wins on margin alone.',
    "I haven't run a sensitivity analysis on that specific factor, but the leading option is Launch Now at 62%.",
    'I have not run a flip analysis on that sub-question yet, but the main result holds.',
    'The analysis on hiring costs is conclusive.',
    'Looking at the analysis output, Option A leads.',
    'The results are decisive and the analysis confirms Launch Now.',
  ])('does not false-positive on legitimate phrase: %s', (text) => {
    const r = assertExplainLeader({
      status: 200,
      body: { assistant_text: text, suggested_actions: [] },
      elapsed_ms: 100,
    });
    expect(r.ok).toBe(true);
  });

  it('still fails empty assistant_text with the existing contract (denial guard does not displace it)', () => {
    const r = assertExplainLeader({
      status: 200,
      body: { assistant_text: '', suggested_actions: [] },
      elapsed_ms: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toMatch(/empty assistant_text/);
    }
  });
});
