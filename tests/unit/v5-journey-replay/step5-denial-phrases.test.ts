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
 *
 * Update (Step 5 grounding probe): the staging f588320 replay caught a
 * denial shape — `aren't available in the current context … haven't
 * come through yet` — that the original 8 patterns missed. Two new
 * patterns added to the regex set; new must-trip + whitelist cases
 * lock in the wider coverage.
 *
 * Update (substance + label gates): `assertExplainLeader` now also
 * fails if `text_len <= 200` or if no option label from Step 1 is
 * referenced when journey context is provided. Fixtures here are
 * padded to clear the 200-char bar so each case isolates the
 * denial-phrase regex behaviour from the substance gate.
 */

import { describe, it, expect } from 'vitest';

import { assertExplainLeader } from '../../../tools/v5-journey-replay/assertions.js';

// Ample explain-leader prose used to pad fixtures past the 200-char
// substance gate. Mirrors the realistic shape Step 5 should produce.
const NEUTRAL_PADDING =
  ' The leading option is Launch Now at about 62% probability, with marketing spend as ' +
  'the strongest driver. The result is sensitive to a roughly 10% shift in the ' +
  'launch→revenue edge, and contingency budget is the assumption most worth challenging.';

const PASSING_TEXT =
  'Looking at the analysis, Option Launch wins with about 62% probability. The leading ' +
  'driver is marketing spend, though the margin is sensitive to a 10% shift in the ' +
  'launch→revenue edge. The most fragile assumption is the cost of contingency budget.';

describe('assertExplainLeader — Step 5 denial-phrase regression guard', () => {
  it('passes when assistant_text is substantive and contains no denial phrasing', () => {
    expect(PASSING_TEXT.length).toBeGreaterThan(200);
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
    // Step 5 grounding probe — staging f588320 shapes (the displaced
    // anchor cases that the original eight patterns missed).
    "results aren't available in the current context",
    'analysis is not available in this view',
    "results haven't come through",
    "the simulation results haven't come through yet",
  ])('fails when assistant_text contains denial phrase: %s', (phrase) => {
    const text = `Sorry, ${phrase}. ${NEUTRAL_PADDING}`;
    expect(text.length).toBeGreaterThan(200);
    const r = assertExplainLeader({
      status: 200,
      body: { assistant_text: text, suggested_actions: [] },
      elapsed_ms: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toMatch(/step_5_denial_phrase/);
      expect(r.evidence).toMatch(/denial_phrase=/);
    }
  });

  it('fails on the staging f588320 production-shape text (denial regex trips before substance gate)', () => {
    // Mirror of the staging f588320 Step 5 response observed by the
    // baseline replay (text_len ≈ 282 in production). Reconstructed
    // here at ≥ 200 chars so the denial-phrase regex is the proximate
    // cause — not the substance gate. The verbatim 188-char snippet
    // alone would trip `step_5_text_too_short`, which is correct
    // production behaviour but not what THIS test validates.
    const text =
      "Analysis results aren't available in the current context, the simulation was " +
      "run but the results haven't come through yet. Once the analysis completes I " +
      'can walk you through the leading option, the top drivers, and the assumption ' +
      'most likely to flip the result. Refresh or send another message to retry.';
    expect(text.length).toBeGreaterThan(200);
    const r = assertExplainLeader({
      status: 200,
      body: { assistant_text: text, suggested_actions: [] },
      elapsed_ms: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toMatch(/step_5_denial_phrase/);
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
    // Step 5 grounding probe — phrases that resemble the new patterns
    // but are legitimate (must NOT trip).
    'Once results are available to all stakeholders, we will surface them in the dashboard.',
    'The analysis results came through cleanly and Option A leads on every factor.',
    'The simulation results came through with high confidence.',
  ])('does not false-positive on legitimate phrase: %s', (text) => {
    const padded = `${text} ${NEUTRAL_PADDING}`;
    expect(padded.length).toBeGreaterThan(200);
    const r = assertExplainLeader({
      status: 200,
      body: { assistant_text: padded, suggested_actions: [] },
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

  // Substance gate (Task 3c): a passing Step 5 must have meaningful
  // prose — short stubs are caught with a distinct failing_contract so
  // operators can distinguish denial-phrase escapes from terse evasions.
  it('fails when assistant_text is non-empty but at or under 200 chars', () => {
    const text = 'Option A leads marginally.'; // 26 chars
    const r = assertExplainLeader({
      status: 200,
      body: { assistant_text: text, suggested_actions: [] },
      elapsed_ms: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toBe('step_5_text_too_short');
    }
  });

  // Option-label gate (Task 3c): when the harness threads Step 1's
  // drafted-graph option labels into the assertion context, Step 5
  // prose must reference at least one. Empty labels degrade gracefully
  // (substance check still applies).
  it('fails when option labels are provided and none are referenced', () => {
    const text =
      'The leading option wins by a comfortable margin, and the most fragile assumption ' +
      'is the cost of contingency budget. The simulation confirms strong robustness ' +
      'against a 10% perturbation in the most influential factor.';
    expect(text.length).toBeGreaterThan(200);
    const r = assertExplainLeader(
      {
        status: 200,
        body: { assistant_text: text, suggested_actions: [] },
        elapsed_ms: 100,
      },
      { step1OptionLabels: ['Hire Two Senior Engineers', 'Engage Offshore Partner'] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toBe('step_5_no_option_label_referenced');
    }
  });

  it('passes when at least one Step 1 option label is referenced (case-insensitive)', () => {
    const text =
      'Hire two senior engineers wins with about 62% probability. The strongest driver is ' +
      'engineering capacity, and the margin is sensitive to a 10% shift in the hiring ' +
      'lead-time edge. The most fragile assumption is contractor availability.';
    expect(text.length).toBeGreaterThan(200);
    const r = assertExplainLeader(
      {
        status: 200,
        body: { assistant_text: text, suggested_actions: [] },
        elapsed_ms: 100,
      },
      { step1OptionLabels: ['Hire Two Senior Engineers', 'Engage Offshore Partner'] },
    );
    expect(r.ok).toBe(true);
  });

  it('skips the label gate when no labels are provided (degrades gracefully)', () => {
    expect(PASSING_TEXT.length).toBeGreaterThan(200);
    const r = assertExplainLeader(
      {
        status: 200,
        body: { assistant_text: PASSING_TEXT, suggested_actions: [] },
        elapsed_ms: 100,
      },
      { step1OptionLabels: [] },
    );
    expect(r.ok).toBe(true);
  });
});
