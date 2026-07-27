import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { tryRunComparisonGate } from '../run-comparison-gate.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';

// Self-contained fixtures (no shared integration mocks).
function envelope(options: Array<{ id: string; label: string; win: number }>, band?: string): V2RunResponseEnvelope {
  return {
    analysis_status: 'completed',
    results: options.map((o) => ({ option_id: o.id, option_label: o.label, win_probability: o.win })),
    ...(band ? { robustness_synthesis: { overall_assessment: band } } : {}),
  } as unknown as V2RunResponseEnvelope;
}

function runFact(env: V2RunResponseEnvelope): HandlerFact {
  return {
    fact_type: 'run_analysis',
    noop: false,
    result: { enrichment: env, computed_at: '2026-06-06T00:00:00.000Z', graph_hash_at_run: 'h' },
  } as unknown as HandlerFact;
}

const PRIOR = runFact(envelope([{ id: 'a', label: 'Offshore', win: 0.62 }, { id: 'b', label: 'Onshore', win: 0.38 }], 'low'));
const CURRENT = runFact(envelope([{ id: 'b', label: 'Onshore', win: 0.55 }, { id: 'a', label: 'Offshore', win: 0.45 }], 'high'));
const TWO_RUNS = [CURRENT, PRIOR];

// Forbidden in user-facing copy (internal vocab / IDs / raw decimals).
const FORBIDDEN = /\b(node|edge|graph|winner|sensitivity|robustness|_meta|option_id|node_id)\b/i;
const RAW_DECIMAL = /\d\.\d/;

describe('tryRunComparisonGate', () => {
  it('compares two runs on "what changed?" when fresh', () => {
    const out = tryRunComparisonGate({ message: 'What changed?', priorFacts: TWO_RUNS, freshness: 'fresh', mayNameLeadingOption: true });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('compared');
    expect(out.leading_option_changed).toBe(true);
    expect(out.assistant_text).toContain('leading option has changed');
    expect(out.assistant_text).toContain('Offshore');
    expect(out.assistant_text).toContain('Onshore');
    expect(out.assistant_text).toContain('narrowed');
    expect(out.assistant_text).toContain('percentage points');
    // copy safety
    expect(out.assistant_text).not.toMatch(FORBIDDEN);
    expect(out.assistant_text).not.toMatch(RAW_DECIMAL);
    expect(out.assistant_text).not.toContain('--');
  });

  it('matches "why did the result change?" too', () => {
    const out = tryRunComparisonGate({ message: 'Why did the result change?', priorFacts: TWO_RUNS, freshness: 'fresh', mayNameLeadingOption: true });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('compared');
  });

  it('leads with re-run guidance when the model is stale (edited after the latest run)', () => {
    const out = tryRunComparisonGate({ message: 'What changed?', priorFacts: TWO_RUNS, freshness: 'stale', mayNameLeadingOption: true });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('stale');
    expect(out.assistant_text.toLowerCase()).toContain('re-run');
    expect(out.suggested_actions).toHaveLength(1);
    expect(out.suggested_actions[0].action_type).toBe('run_analysis');
    expect(out.assistant_text).not.toMatch(FORBIDDEN);
  });

  // T4 Slice 3 — freshness fail-closed. Before this slice, an `unknown`
  // verdict (legacy fact missing its run-time hash, or an unhashable current
  // graph) fell through to the same comparison path as `fresh`, returning a
  // confident two-run comparison on unverified currency. Merged policy
  // §1b/§1-parity/§5 require holding instead.
  it('FAIL-CLOSED: does NOT compare on unknown freshness — offers an unconfirmed re-run without claiming the model changed', () => {
    const out = tryRunComparisonGate({ message: 'What changed?', priorFacts: TWO_RUNS, freshness: 'unknown', mayNameLeadingOption: true });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    // Never a comparison on unverified currency.
    expect(out.mode).toBe('unconfirmed');
    expect(out.mode).not.toBe('compared');
    // Offers a re-run…
    expect(out.assistant_text.toLowerCase()).toContain('re-run');
    expect(out.suggested_actions).toHaveLength(1);
    expect(out.suggested_actions[0].action_type).toBe('run_analysis');
    // …but must NOT assert the model changed (that is the stale-only claim;
    // on unknown we cannot know it — §1 authority parity).
    expect(out.assistant_text.toLowerCase()).not.toContain('has changed');
    expect(out.assistant_text.toLowerCase()).toContain("can't confirm");
    // No comparison content leaked.
    expect(out.assistant_text).not.toContain('leading option has changed');
    expect(out.leading_option_changed).toBeNull();
    // Copy safety.
    expect(out.assistant_text).not.toMatch(FORBIDDEN);
    expect(out.assistant_text).not.toMatch(RAW_DECIMAL);
  });

  it('FAIL-CLOSED: an absent/unavailable freshness authority (null / undefined) holds like unknown', () => {
    for (const freshness of [null, undefined] as const) {
      const out = tryRunComparisonGate({ message: 'What changed?', priorFacts: TWO_RUNS, freshness, mayNameLeadingOption: true });
      expect(out.matched).toBe(true);
      if (!out.matched) continue;
      expect(out.mode).toBe('unconfirmed');
      expect(out.assistant_text.toLowerCase()).not.toContain('has changed');
      expect(out.suggested_actions[0].action_type).toBe('run_analysis');
    }
  });

  it('unknown freshness holds even when only one run exists (no accidental insufficient_runs downgrade)', () => {
    // The fail-closed branch precedes the run-count check, so unknown never
    // reaches the fresh-only insufficient_runs path.
    const out = tryRunComparisonGate({ message: 'What changed?', priorFacts: [CURRENT], freshness: 'unknown', mayNameLeadingOption: true });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('unconfirmed');
  });

  it('does not hijack a concrete edit / value-update message', () => {
    for (const message of ['Set pricing to 0.7', 'Change marketing channel to TikTok', 'Add a new constraint']) {
      const out = tryRunComparisonGate({ message, priorFacts: TWO_RUNS, freshness: 'fresh', mayNameLeadingOption: true });
      expect(out.matched).toBe(false);
      if (out.matched) continue;
      expect(out.reason).toBe('mutation_signal');
    }
  });

  it('declines non-comparison analytical questions', () => {
    const out = tryRunComparisonGate({ message: 'Explain the results', priorFacts: TWO_RUNS, freshness: 'fresh', mayNameLeadingOption: true });
    expect(out.matched).toBe(false);
    if (out.matched) return;
    expect(out.reason).toBe('not_what_changed');
  });

  it('declines (no_runs) when there is no analysis so the no-analysis guard can own it', () => {
    const out = tryRunComparisonGate({ message: 'What changed?', priorFacts: [], freshness: 'none', mayNameLeadingOption: true });
    expect(out.matched).toBe(false);
    if (out.matched) return;
    expect(out.reason).toBe('no_runs');
  });

  it('returns insufficient_runs with exactly one run', () => {
    const out = tryRunComparisonGate({ message: 'What changed?', priorFacts: [CURRENT], freshness: 'fresh', mayNameLeadingOption: true });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('insufficient_runs');
    expect(out.suggested_actions).toHaveLength(0);
  });

  it('rejects an empty message', () => {
    const out = tryRunComparisonGate({ message: '   ', priorFacts: TWO_RUNS, freshness: 'fresh', mayNameLeadingOption: true });
    expect(out.matched).toBe(false);
    if (out.matched) return;
    expect(out.reason).toBe('empty_message');
  });
});

// F2 CHANGE B — the typed `what_changed` pill declares the intent, so the gate
// skips the free-text `classifyAnalyticalIntent` regex (`forceIntent: true`)
// while keeping every OTHER gate — the empty/mutation fail-safes and, crucially,
// the freshness fail-closed switch — exactly as-is.
describe('tryRunComparisonGate — forceIntent (typed what_changed pill)', () => {
  it('compares a fresh two-run pair even when the message does NOT match the free-text regex', () => {
    // A pill could carry copy the regex would reject; typing the intent must be
    // enough. This is the anti-"regex-on-UI-copy" property.
    const out = tryRunComparisonGate({
      message: 'Give me the run comparison, please.',
      priorFacts: TWO_RUNS,
      freshness: 'fresh',
      mayNameLeadingOption: true,
      forceIntent: true,
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('compared');
    expect(out.leading_option_changed).toBe(true);
    expect(out.assistant_text).toContain('Offshore');
    expect(out.assistant_text).toContain('Onshore');
  });

  // POSITIVE CONTROL for the skip: the SAME non-matching message WITHOUT
  // forceIntent declines `not_what_changed`. Proves forceIntent is what flips it,
  // not that the message happened to match.
  it('positive control: the same message declines not_what_changed WITHOUT forceIntent', () => {
    const out = tryRunComparisonGate({
      message: 'Give me the run comparison, please.',
      priorFacts: TWO_RUNS,
      freshness: 'fresh',
      mayNameLeadingOption: true,
    });
    expect(out.matched).toBe(false);
    if (out.matched) return;
    expect(out.reason).toBe('not_what_changed');
  });

  it('FAIL-CLOSED untouched: a typed pill on a STALE model still gets the honest re-run answer, never a comparison', () => {
    const out = tryRunComparisonGate({
      message: 'What changed since the last run?',
      priorFacts: TWO_RUNS,
      freshness: 'stale',
      mayNameLeadingOption: true,
      forceIntent: true,
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('stale');
    expect(out.mode).not.toBe('compared');
    expect(out.assistant_text.toLowerCase()).toContain('re-run');
  });

  it('FAIL-CLOSED untouched: a typed pill on UNKNOWN freshness still holds (unconfirmed), never claims the model changed', () => {
    const out = tryRunComparisonGate({
      message: 'What changed since the last run?',
      priorFacts: TWO_RUNS,
      freshness: 'unknown',
      mayNameLeadingOption: true,
      forceIntent: true,
    });
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('unconfirmed');
    expect(out.mode).not.toBe('compared');
  });

  it('FAIL-CLOSED untouched: a typed pill with no analysis declines no_runs (no-analysis guard owns it)', () => {
    const out = tryRunComparisonGate({
      message: 'What changed since the last run?',
      priorFacts: [],
      freshness: 'none',
      mayNameLeadingOption: true,
      forceIntent: true,
    });
    expect(out.matched).toBe(false);
    if (out.matched) return;
    expect(out.reason).toBe('no_runs');
  });

  it('mutation fail-safe still applies even under forceIntent', () => {
    const out = tryRunComparisonGate({
      message: 'Set pricing to 0.7',
      priorFacts: TWO_RUNS,
      freshness: 'fresh',
      mayNameLeadingOption: true,
      forceIntent: true,
    });
    expect(out.matched).toBe(false);
    if (out.matched) return;
    expect(out.reason).toBe('mutation_signal');
  });
});

/**
 * T1 claim safety — ROADMAP 1.233.
 *
 * `runComparisonOutcome.assistant_text` was one of the eight sites #713's drift
 * register pinned as `ungated`. It composes leader prose in CODE with zero LLM
 * calls, so the sibling 1.231 input gate cannot reach it: there is no model to
 * withhold the leader from. This gate has to consume the verdict itself.
 *
 * BOTH ARMS RUN THE SAME INPUTS AND FLIP ONE BOOLEAN, so every difference below
 * is attributable to the permission and to nothing in the fixture.
 */
describe('tryRunComparisonGate — claim safety (ROADMAP 1.233)', () => {
  const ask = (mayName: boolean, facts: readonly HandlerFact[] = TWO_RUNS) =>
    tryRunComparisonGate({
      message: 'What changed?',
      priorFacts: facts,
      freshness: 'fresh',
      mayNameLeadingOption: mayName,
    });

  it('POSITIVE CONTROL: a PERMITTED verdict keeps the ordering AND the margin', () => {
    // The over-suppression arm, and the non-vacuity proof for the arm below:
    // these strings are what the withheld arm must lose, so if the fixture ever
    // stopped producing a `compared` outcome THIS goes red rather than the
    // absence assertions passing on an empty comparison.
    const out = ask(true);
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('compared');
    expect(out.assistant_text).toContain('Onshore');
    expect(out.assistant_text).toMatch(/leads|now leads|came out ahead/);
  });

  it('a WITHHELD verdict drops the ordering and the margin sentences', () => {
    const out = ask(false);
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    // Still a comparison — the gate does not decline, it answers honestly.
    expect(out.mode).toBe('compared');
    // No option is named, in either direction.
    expect(out.assistant_text).not.toContain('Onshore');
    expect(out.assistant_text).not.toContain('Offshore');
    // No ordering language, and no claim about a lead moving.
    expect(out.assistant_text).not.toMatch(/leads|came out ahead|its lead/i);
    // And it SAYS so, rather than silently returning a shorter answer.
    expect(out.assistant_text).toContain('No single option can be put forward');
  });

  it('ANTI-OVER-SUPPRESSION: the withheld answer KEEPS the leader-free findings', () => {
    // The suppression is deliberately partial. A robustness-band shift and a
    // driver-influence change rank nothing — they are statements about the
    // result's stability and about factors — and they are the substance of the
    // user's actual question. Dropping the whole comparison would trade a leak
    // for the failure the acceptance criteria weight equally with it.
    const permitted = ask(true);
    const withheld = ask(false);
    expect(permitted.matched && withheld.matched).toBe(true);
    if (!permitted.matched || !withheld.matched) return;

    // The band sentence is present in BOTH arms, byte-identical.
    const bandSentence = /The result is now [^.]+, where before it was [^.]+\./;
    const permittedBand = permitted.assistant_text.match(bandSentence);
    expect(permittedBand, 'fixture must produce a band shift, else this test is vacuous').not.toBeNull();
    expect(withheld.assistant_text).toContain(permittedBand![0]);

    // The follow-up invitation survives too — a withheld turn is not a dead end.
    expect(withheld.assistant_text).toContain('ask what would change the result');
  });

  it('the withheld copy does not leak internal vocabulary or raw decimals', () => {
    // The substituted sentence goes through no separate review, so it is held
    // to the SAME copy rules as every other branch in this file.
    const out = ask(false);
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(FORBIDDEN.test(out.assistant_text)).toBe(false);
    expect(RAW_DECIMAL.test(out.assistant_text)).toBe(false);
  });

  it('the non-comparing modes are untouched by the permission (byte-identical)', () => {
    // `stale` / `unconfirmed` / `insufficient_runs` / `incomparable` are frozen
    // constants with no option label in them. The gate must not have made them
    // verdict-dependent — that would be suppression with no leak to prevent.
    for (const facts of [[] as HandlerFact[], [CURRENT]]) {
      for (const freshness of ['stale', 'unknown', 'none', 'fresh'] as const) {
        const permitted = tryRunComparisonGate({
          message: 'What changed?', priorFacts: facts, freshness, mayNameLeadingOption: true,
        });
        const withheld = tryRunComparisonGate({
          message: 'What changed?', priorFacts: facts, freshness, mayNameLeadingOption: false,
        });
        expect(withheld).toEqual(permitted);
      }
    }
  });
});
