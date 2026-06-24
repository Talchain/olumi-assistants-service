/**
 * Coaching Context Pack v1 — deterministic output post-check.
 *
 * Proves the boundary the lane enforces: deterministic state owns truth; the
 * LLM only expresses it. The most important case is confident directional /
 * superlative advice under unsafe state, EVEN when the word "fresh" never
 * appears and EVEN when a caveat is bolted on. Fresh + usable state must NOT
 * degrade ordinary coaching (false-positive containment).
 */

import { describe, expect, it } from 'vitest';

import {
  checkCoachingOutput,
  buildCoachingDegradeResponse,
  NEUTRAL_DEGRADE_TEXT,
  type CoachingViolation,
} from '../coaching-output-postcheck.js';
import type { CoachingStatePack } from '../../context/canonical-analysis-state.js';
import {
  buildAnalysisAbsentTemplate,
  buildAnalysisDegradedTemplate,
  buildAnalysisStaleTemplate,
  buildAnalysisUnconfirmedTemplate,
} from '../../tools/handlers/no-op-helpers.js';

// ---------------------------------------------------------------------------
// Pack builders
// ---------------------------------------------------------------------------

function pack(overrides: Partial<CoachingStatePack> = {}): CoachingStatePack {
  return {
    analysis_present: true,
    freshness: 'fresh',
    readiness_status: 'ready',
    rerun_required: false,
    usable_for_prose: true,
    usable_for_chips: true,
    blocked: false,
    actionable_blocker_count: 0,
    ...overrides,
  };
}

const FRESH = pack();
const STALE = pack({ freshness: 'stale', rerun_required: true, usable_for_chips: false });
const UNKNOWN = pack({ freshness: 'unknown', usable_for_chips: false });
const NONE = pack({
  analysis_present: false,
  freshness: 'none',
  readiness_status: null,
  usable_for_prose: false,
  usable_for_chips: false,
});
const BLOCKED = pack({
  freshness: 'stale',
  blocked: true,
  usable_for_prose: false,
  usable_for_chips: false,
  rerun_required: true,
  readiness_status: 'blocked',
});

function expectViolation(
  res: { safe: boolean; violation?: CoachingViolation },
  v: CoachingViolation,
): void {
  expect(res.safe).toBe(false);
  expect(res.violation).toBe(v);
}

// ---------------------------------------------------------------------------
// False-positive containment — fresh + usable allows directional advice
// ---------------------------------------------------------------------------

describe('checkCoachingOutput — fresh + usable allows confident coaching', () => {
  it('directional/superlative advice is allowed when state is fresh + usable', () => {
    expect(checkCoachingOutput('Option A is the strongest choice here.', FRESH)).toEqual({
      safe: true,
    });
    expect(
      checkCoachingOutput('You should choose Option A — it leads at 62%.', FRESH),
    ).toEqual({ safe: true });
  });

  it('ordinary framing prose is allowed in any state', () => {
    expect(
      checkCoachingOutput(
        'Here is how to think about the trade-off between speed and cost.',
        FRESH,
      ),
    ).toEqual({ safe: true });
    expect(
      checkCoachingOutput(
        'There are a few angles worth weighing before you decide.',
        STALE,
      ),
    ).toEqual({ safe: true });
  });

  it('empty prose is safe (nothing to degrade)', () => {
    expect(checkCoachingOutput('', STALE)).toEqual({ safe: true });
    expect(checkCoachingOutput('   ', STALE)).toEqual({ safe: true });
  });
});

// ---------------------------------------------------------------------------
// The dangerous case — confident directional advice under unsafe state
// ---------------------------------------------------------------------------

describe('checkCoachingOutput — confident advice under unsafe state', () => {
  it('stale + "go with X" (no "fresh" wording) degrades', () => {
    expectViolation(
      checkCoachingOutput('Go with Option A — it clearly comes out ahead.', STALE),
      'confident_advice_under_unsafe_state',
    );
  });

  it('unknown ("unconfirmed") + "the best option is X" degrades', () => {
    expectViolation(
      checkCoachingOutput('The best option is Option B by a clear margin.', UNKNOWN),
      'confident_advice_under_unsafe_state',
    );
  });

  it('no-analysis state + "you should choose X" degrades', () => {
    expectViolation(
      checkCoachingOutput('You should choose Option A.', NONE),
      'confident_advice_under_unsafe_state',
    );
  });

  it('blocked state + recommendation degrades', () => {
    expectViolation(
      checkCoachingOutput('I’d recommend Option C.', BLOCKED),
      'confident_advice_under_unsafe_state',
    );
  });

  it('review fix: recommendation + option-selection degrades under unsafe state', () => {
    for (const [prose, pack] of [
      ['I would recommend Option A.', STALE],
      ['Option A is preferable.', UNKNOWN],
      ['Option A is the better option.', BLOCKED],
      ['Option A remains the winner.', STALE],
      // Review round 2: "we should choose" and bare "is better".
      ['We should choose Option A.', UNKNOWN],
      ['Option A is better.', STALE],
    ] as const) {
      expectViolation(checkCoachingOutput(prose, pack), 'confident_advice_under_unsafe_state');
    }
  });

  it('review round 2: recovery / rerun guidance is NEVER a directional violation', () => {
    // The prompt asks the model to suggest re-running under unsafe state — this
    // is the desired behaviour, not confident option-selection advice.
    for (const pack of [STALE, UNKNOWN, NONE, BLOCKED]) {
      for (const prose of [
        'I recommend re-running the analysis.',
        'I suggest we re-run the analysis before deciding.',
        'My advice is to re-run the analysis.',
        'I’d go with re-running the analysis first.',
      ]) {
        expect(checkCoachingOutput(prose, pack), prose).toEqual({ safe: true });
      }
    }
  });

  it('review fix: the same recommendations are ALLOWED under fresh + usable state', () => {
    expect(checkCoachingOutput('I would recommend Option A.', FRESH)).toEqual({ safe: true });
    expect(checkCoachingOutput('Option A is preferable.', FRESH)).toEqual({ safe: true });
    // Process advice with a superlative but no option noun must NOT fire even
    // under unsafe state (no over-blocking).
    expect(
      checkCoachingOutput('Honestly, this is the best way to think it through.', STALE),
    ).toEqual({ safe: true });
    expect(
      checkCoachingOutput('It is better to wait until you have more information.', STALE),
    ).toEqual({ safe: true });
  });

  it('directional advice fires even WITH a caveat (caveat-independent)', () => {
    // The brief's exact requirement: a caveat does not license confident
    // directional advice under unsafe state.
    expectViolation(
      checkCoachingOutput(
        'This may be out of date, but you should go with Option A.',
        STALE,
      ),
      'confident_advice_under_unsafe_state',
    );
  });
});

// ---------------------------------------------------------------------------
// Stale results presented as fresh (no directional advice)
// ---------------------------------------------------------------------------

describe('checkCoachingOutput — stale results presented as fresh', () => {
  it('stale + result figure with NO caveat degrades', () => {
    expectViolation(
      checkCoachingOutput('Option A leads at 62%.', STALE),
      'stale_presented_as_fresh',
    );
  });

  it('blocked + "X wins most of the time" with no caveat degrades', () => {
    expectViolation(
      checkCoachingOutput('Option A wins most of the time.', BLOCKED),
      'stale_presented_as_fresh',
    );
  });

  it('stale + result figure WITH a staleness caveat is allowed', () => {
    // Presenting the old figure WITH a caveat + rerun nudge is the desired
    // behaviour — not a violation.
    expect(
      checkCoachingOutput(
        'Option A led at 62%, though this may be out of date — re-run to refresh.',
        STALE,
      ),
    ).toEqual({ safe: true });
  });
});

// ---------------------------------------------------------------------------
// Always-unsafe rules (independent of freshness)
// ---------------------------------------------------------------------------

describe('checkCoachingOutput — always-unsafe rules fire regardless of state', () => {
  it('genuine graph/model mutation-success claims degrade', () => {
    for (const prose of [
      'I’ve updated the budget factor for you.',
      'I changed the option value.',
      'Done — I changed the graph.',
      'I updated the model.',
      'The model has been updated.',
      // Review fix: `created` is a mutation verb when it acts on a graph object.
      'I created a new option for you.',
      'The graph was created.',
      // Review round 2: hyphenated modifier must not break the object match.
      'I updated the high-priority factor.',
      'Your high-priority factor has been updated.',
      // Review round 2: a directly-named option needs no determiner.
      'I created Option A.',
      'We removed Factor 3.',
    ]) {
      expectViolation(checkCoachingOutput(prose, FRESH), 'invented_mutation_success');
    }
  });

  it('ordinary coaching that uses completion words but claims NO mutation is safe', () => {
    for (const prose of [
      'I’ve created a summary of the trade-offs.',
      'Created a comparison of your options.',
      'All set — here’s my take.',
      'Done.',
      'I’ve added real value to this discussion.',
      // Named-entity rule is case-sensitive: lowercase prose is not a mutation.
      'I changed option settings in my head while weighing this.',
      'Let’s weigh option a against option b before deciding.',
    ]) {
      expect(checkCoachingOutput(prose, FRESH), prose).toEqual({ safe: true });
    }
  });

  it('first-person value-change narration degrades', () => {
    for (const prose of [
      'I set the budget to £50k.',
      'I changed the timeline from 12 months to 18 months.',
      'I updated churn to 5%.',
      // Review fix: `by` / `at` value-change prepositions, not just `to`/`from`.
      'I increased the budget by £50k.',
      'I set the budget at £50k.',
      // Review round 3: unit-less integers after to/from are value changes.
      'I set the headcount to 10.',
      'I changed the timeline from 12 to 18.',
    ]) {
      expectViolation(checkCoachingOutput(prose, FRESH), 'value_change_narration');
    }
  });

  it('descriptive mentions of display-safe values are NOT degraded', () => {
    // These reach the LLM legitimately via display_graph.display_value.
    for (const prose of [
      'Your budget is £50k, which is tight for this goal.',
      'An 18 month timeline may be ambitious.',
      'A 5% churn assumption is material.',
    ]) {
      expect(checkCoachingOutput(prose, FRESH), prose).toEqual({ safe: true });
    }
  });

  it('review round 2: clock times are NOT value-change narration', () => {
    // `at`/`by` must match a VALUE shape, not any number — so times stay safe,
    // even under unsafe state.
    for (const prose of [
      'I changed my mind at 5pm.',
      'I set up the meeting at 5pm.',
      'I changed my plan at 3 today.',
    ]) {
      expect(checkCoachingOutput(prose, FRESH), prose).toEqual({ safe: true });
      expect(checkCoachingOutput(prose, STALE), prose).toEqual({ safe: true });
    }
  });

  it('hypothetical / second-person value advice is NOT a mutation/value-change claim', () => {
    // Conditional advice and instructions to the user are not first-person
    // completed claims, so the always-on mutation/value-change rules must not
    // fire. Asserted under FRESH to isolate those rules (under unsafe state the
    // separate directional/result rules may legitimately apply to some prose).
    for (const prose of [
      'I’d set the budget to £50k if growth is the priority.',
      'If you increased churn, the picture would change.',
      'You could move the timeline to 18 months.',
      'Consider setting the budget to £50k.',
      'I changed my approach after thinking it through.',
      'I set a clear goal for the team to rally around.',
    ]) {
      expect(checkCoachingOutput(prose, FRESH), prose).toEqual({ safe: true });
    }
  });

  it('bare percentages are NOT treated as raw values (analysis probabilities)', () => {
    // A probability in fresh-state coaching is legitimate (it comes from the
    // analysis projection the LLM already holds) — not a value/unit leak.
    expect(checkCoachingOutput('Option A wins about 62% of the time.', FRESH)).toEqual({
      safe: true,
    });
  });

  it('unsupported evidence / confidence / bias claims degrade (even fresh state)', () => {
    expectViolation(
      checkCoachingOutput('The evidence strongly supports Option A.', FRESH),
      'unsupported_evidence_or_confidence_claim',
    );
    expectViolation(
      checkCoachingOutput('This result is statistically significant.', FRESH),
      'unsupported_evidence_or_confidence_claim',
    );
    expectViolation(
      checkCoachingOutput('This avoids your confirmation bias.', FRESH),
      'unsupported_evidence_or_confidence_claim',
    );
  });

  it('internal field / hash exposure degrades', () => {
    expectViolation(
      checkCoachingOutput('The graph_hash a1b2c3d4e5f6 changed.', FRESH),
      'internal_field_exposed',
    );
    expectViolation(
      checkCoachingOutput('The validator rejected fac_price.', FRESH),
      'internal_field_exposed',
    );
    expectViolation(
      checkCoachingOutput('The edge fac_price->goal_revenue is fragile.', FRESH),
      'internal_field_exposed',
    );
  });

  it('does NOT over-fire on ordinary decision words ("model", "options", "factor")', () => {
    expect(
      checkCoachingOutput(
        'Your model has a few options, and this factor matters most to the outcome.',
        FRESH,
      ),
    ).toEqual({ safe: true });
  });
});

// ---------------------------------------------------------------------------
// Label-aware detection — the graph's ACTUAL option / factor labels
// ---------------------------------------------------------------------------

describe('checkCoachingOutput — label-aware mutation / directional detection', () => {
  const LABELS = ['Plan A', 'Plan B', 'Pricing', 'Headcount'];
  const opts = { decisionLabels: LABELS };

  it('a mutation verb acting on a known factor label degrades', () => {
    expectViolation(
      checkCoachingOutput('I updated Pricing for you.', FRESH, opts),
      'invented_mutation_success',
    );
    expectViolation(
      checkCoachingOutput('I’ve changed Headcount.', FRESH, opts),
      'invented_mutation_success',
    );
  });

  it('a recommendation pointing at a known option label degrades under unsafe state', () => {
    expectViolation(
      checkCoachingOutput('I recommend Plan A.', STALE, opts),
      'confident_advice_under_unsafe_state',
    );
    expectViolation(
      checkCoachingOutput('I’d go with Plan B.', UNKNOWN, opts),
      'confident_advice_under_unsafe_state',
    );
  });

  it('the same option recommendation is allowed under fresh + usable state', () => {
    expect(checkCoachingOutput('I recommend Plan A.', FRESH, opts)).toEqual({ safe: true });
  });

  it('recovery guidance is still safe even with labels supplied', () => {
    // The label is NOT the verb's object — recovery advice must survive.
    expect(
      checkCoachingOutput('I recommend re-running the analysis before Plan A vs Plan B.', STALE, opts),
    ).toEqual({ safe: true });
    expect(checkCoachingOutput('My advice is to re-run the analysis.', STALE, opts)).toEqual({
      safe: true,
    });
  });

  it('case-sensitive: a lowercase common word matching a label is NOT a mutation', () => {
    // Factor labelled "Pricing"/"Headcount" must not degrade lowercase idiom.
    expect(checkCoachingOutput('I’ve added real value while weighing pricing.', FRESH, opts)).toEqual(
      { safe: true },
    );
    expect(
      checkCoachingOutput('I changed my mind about the headcount question.', FRESH, opts),
    ).toEqual({ safe: true });
  });

  it('without supplied labels, arbitrary labels are not recognised (unchanged behaviour)', () => {
    expect(checkCoachingOutput('I recommend Plan A.', STALE)).toEqual({ safe: true });
    expect(checkCoachingOutput('I updated Pricing.', FRESH)).toEqual({ safe: true });
  });
});

// ---------------------------------------------------------------------------
// Degrade-to-safe response selects verdict-correct trust copy + rerun chip
// ---------------------------------------------------------------------------

describe('buildCoachingDegradeResponse — verdict-correct safe copy', () => {
  it('stale → #298 stale template + rerun chip', () => {
    const r = buildCoachingDegradeResponse(STALE);
    expect(r.assistant_text).toBe(buildAnalysisStaleTemplate());
    expect(r.suggested_actions).toHaveLength(1);
    expect(r.suggested_actions[0]!.id).toBe('chip_action_rerun_analysis');
    expect(r.suggested_actions[0]!.action_type).toBe('run_analysis');
  });

  it('unknown → #298 unconfirmed template (NOT the stale one)', () => {
    const r = buildCoachingDegradeResponse(UNKNOWN);
    expect(r.assistant_text).toBe(buildAnalysisUnconfirmedTemplate());
    expect(r.assistant_text).not.toBe(buildAnalysisStaleTemplate());
  });

  it('no analysis / none → #298 absent template', () => {
    const r = buildCoachingDegradeResponse(NONE, { optionCount: 3 });
    expect(r.assistant_text).toBe(buildAnalysisAbsentTemplate(3, undefined));
  });

  it('blocked → #298 degraded template', () => {
    const r = buildCoachingDegradeResponse(BLOCKED);
    expect(r.assistant_text).toBe(buildAnalysisDegradedTemplate());
  });

  it('fresh + usable (always-on violation) → NEUTRAL copy, NOT a trust template', () => {
    // An always-on rule fired but the analysis itself is fine — the fallback
    // must not claim stale / missing / degraded analysis.
    const r = buildCoachingDegradeResponse(FRESH);
    expect(r.assistant_text).toBe(NEUTRAL_DEGRADE_TEXT);
    expect(r.assistant_text).not.toBe(buildAnalysisDegradedTemplate());
    expect(r.assistant_text).not.toBe(buildAnalysisStaleTemplate());
    // No rerun nudge for a fresh analysis.
    expect(r.suggested_actions).toHaveLength(0);
  });

  it('end-to-end: fresh state + evidence claim → violation + neutral degrade copy', () => {
    const verdict = checkCoachingOutput('The evidence strongly supports Option A.', FRESH);
    expect(verdict.safe).toBe(false);
    expect(buildCoachingDegradeResponse(FRESH).assistant_text).toBe(NEUTRAL_DEGRADE_TEXT);
  });

  it('end-to-end: an always-on violation under UNSAFE state keeps the TRUST template (not neutral)', () => {
    // When the state itself is unsafe it is the dominant fact — the trust
    // signal must survive even though the violation was an always-on rule.
    const claim = 'The evidence strongly supports Option A.'; // always-on (evidence) violation
    const cases = [
      { pack: STALE, expected: buildAnalysisStaleTemplate() },
      { pack: UNKNOWN, expected: buildAnalysisUnconfirmedTemplate() },
      { pack: NONE, expected: buildAnalysisAbsentTemplate(0, undefined) },
      { pack: BLOCKED, expected: buildAnalysisDegradedTemplate() },
    ];
    for (const { pack, expected } of cases) {
      expect(checkCoachingOutput(claim, pack).safe).toBe(false);
      const text = buildCoachingDegradeResponse(pack).assistant_text;
      expect(text).toBe(expected);
      expect(text).not.toBe(NEUTRAL_DEGRADE_TEXT);
    }
  });

  it('safe copy never narrates a value, unit, hash or option label', () => {
    for (const p of [STALE, UNKNOWN, NONE, BLOCKED, FRESH]) {
      const { assistant_text } = buildCoachingDegradeResponse(p);
      expect(assistant_text).not.toMatch(/[£$€]/);
      expect(assistant_text).not.toMatch(/\b[0-9a-f]{12,}\b/i);
      expect(assistant_text).not.toMatch(/Option [A-Z]\b/);
    }
  });
});
