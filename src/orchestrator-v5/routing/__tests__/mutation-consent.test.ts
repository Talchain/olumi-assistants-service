/**
 * `detectWithheldConsent` — the predicate behind the action-layer guarantee.
 *
 * THE CORPUS IS HAND-WRITTEN ON PURPOSE. CLAUDE.md trap 12d: a guard derived
 * from a list can only prove the copies AGREE; only a corpus of real inputs
 * notices the list is WRONG or SHORT. Both directions are represented, and
 * the negative direction carries the trap that matters — if "yes, apply it"
 * ever reads as a withholding, the user can never confirm anything and the
 * fix becomes a worse bug than the defect.
 */
import { describe, it, expect } from 'vitest';

import {
  detectWithheldConsent,
  buildConsentWithheldText,
  GRAPH_MUTATING_HANDLER_IDS,
} from '../mutation-consent.js';

/** Captured verbatim from the 5 Aug simulated-user review snapshots. */
const CAPTURED_A =
  'I think monthly churn staying below 3% in December is pretty likely. Please set that estimate and show me the number you will use before applying it.';
const CAPTURED_B =
  'No - that is not what I meant. Please undo that change. By ‘pretty likely’ I mean the probability that churn stays below 3%. What numerical probability does ‘pretty likely’ map to? Do not change the graph until I confirm.';
const CAPTURED_C =
  '"Give each option its own driver: add a separate driver factor for Hire Two Sales Reps, Invest in Partner Channel, Launch Self-Serve Tier, and Keep Current Approach, and connect each driver to its matching option only. Show one confirmation proposal naming every addition and connection. Do not apply anything until I confirm."';

describe('detectWithheldConsent — WITHHOLDS', () => {
  const WITHHOLDING: ReadonlyArray<readonly [string, string]> = [
    ['CAPTURED prompt A (the witnessed mutation)', CAPTURED_A],
    ['CAPTURED prompt B (the witnessed denial)', CAPTURED_B],
    ['CAPTURED prompt C (the compound structural request)', CAPTURED_C],
    ['bare "before applying"', 'Set churn to 3% before applying anything.'],
    ['"before you apply"', 'Raise the budget to £50k, but tell me the number before you apply it.'],
    ['"before it is applied"', 'Show me the value before it is applied, please.'],
    ['"until I confirm"', 'Do not change anything until I confirm.'],
    ["contraction \"don't ... until I confirm\"", "Don't apply that until I confirm."],
    ['"unless I say so"', 'Do not update the graph unless I say so.'],
    ['"not yet"', 'Do not apply it yet — I want to look first.'],
    ['"hold off applying"', 'Hold off applying that change for now.'],
    ['"let me see it before applying"', 'Let me see the number before applying it.'],
    [
      'a hold that arrives alongside an affirmative (fail-safe: the hold wins)',
      'Yes, apply the first one — but do not change anything else until I confirm.',
    ],
  ];

  it.each(WITHHOLDING)('withholds: %s', (_name, message) => {
    const d = detectWithheldConsent(message);
    expect(d.withheld).toBe(true);
  });
});

describe('detectWithheldConsent — DOES NOT withhold', () => {
  const PERMITTED: ReadonlyArray<readonly [string, string]> = [
    ['a plain edit', 'Set Monthly Churn Rate to 3%.'],
    ['a plain edit with a reason', 'Raise the budget to £50,000 because sales grew.'],
    // ⭐ THE TRAP. If any of these withhold, confirmation becomes impossible
    // and the user is locked out of their own model.
    ['a bare confirmation', 'Yes, apply that change.'],
    ['"go ahead and apply"', 'Go ahead and apply it.'],
    ['"apply it"', 'Apply it.'],
    ['"confirm that"', 'Please confirm that change.'],
    ['"do it"', 'Do it, apply the 70%.'],
    ['a question about the past, not a hold', 'Did you apply that before I asked?'],
    ['an unrelated question', 'What is driving the result?'],
    ['an unrelated use of "before"', 'What did the model look like before the last analysis?'],
    ['empty', ''],
    ['whitespace', '   '],
  ];

  it.each(PERMITTED)('permits: %s', (_name, message) => {
    expect(detectWithheldConsent(message).withheld).toBe(false);
  });
});

describe('detectWithheldConsent — the matched span is reported honestly', () => {
  it('reports the phrase it actually matched, so telemetry can be audited against the user text', () => {
    const d = detectWithheldConsent(CAPTURED_B);
    expect(d.withheld).toBe(true);
    if (!d.withheld) throw new Error('unreachable');
    expect(d.rule).toBe('not_until_confirmed');
    // Bound to the user's OWN words, not a canned label — a reviewer can
    // grep the transcript for this substring.
    expect(CAPTURED_B).toContain(d.matched);
  });

  it('classifies prompt A as show-before-applying, not as a confirmation hold', () => {
    const d = detectWithheldConsent(CAPTURED_A);
    expect(d.withheld).toBe(true);
    if (!d.withheld) throw new Error('unreachable');
    expect(d.rule).toBe('show_before_applying');
  });
});

describe('buildConsentWithheldText', () => {
  it('states the outcome first and never claims an inference it did not make', () => {
    const text = buildConsentWithheldText('Monthly Churn Rate');
    expect(text.startsWith('Nothing has been changed')).toBe(true);
    expect(text).toContain('Monthly Churn Rate');
  });

  it('falls back to "anything" rather than naming a factor it could not resolve', () => {
    expect(buildConsentWithheldText(null)).toContain('anything');
  });
});

describe('GRAPH_MUTATING_HANDLER_IDS', () => {
  it('names the three D1 mutation handlers and, deliberately, not edit_graph', () => {
    expect([...GRAPH_MUTATING_HANDLER_IDS].sort()).toEqual([
      'add_constraint',
      'adjust_edge_strength',
      'set_factor_value',
    ]);
    // edit_graph has its own consent mechanism (the GM referee). Listing it
    // here would collide with that lane rather than reinforce it.
    expect(GRAPH_MUTATING_HANDLER_IDS.has('edit_graph')).toBe(false);
  });
});
