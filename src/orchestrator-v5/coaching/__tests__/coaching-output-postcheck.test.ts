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
  selectLiveHoldForDegrade,
  NEUTRAL_DEGRADE_TEXT,
  type CoachingViolation,
} from '../coaching-output-postcheck.js';
import type { PendingAction } from '../../session/pending-action.js';
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
      // Review round 4: unit-less integers after `by` too (not a clock-time risk).
      'I increased the headcount by 5.',
      'I reduced the timeline by 3.',
      'I updated churn by 2.',
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

  it('review round 4: quoted / passive / subject-judgement / let-us / lean forms degrade', () => {
    // Mutation forms (always-on): quoted object + passive label subject.
    for (const prose of ['I updated "Pricing".', 'Pricing was updated.', '“Pricing” has been changed.']) {
      expectViolation(checkCoachingOutput(prose, FRESH, opts), 'invented_mutation_success');
    }
    // Directional forms (under unsafe state): quoted, let's, lean, label-subject.
    for (const prose of [
      'I recommend "Plan A".',
      'Let’s go with Plan A.',
      'I would lean towards Plan A.',
      'Plan A is the best.',
      'Plan A is our top choice.',
    ]) {
      expectViolation(checkCoachingOutput(prose, STALE, opts), 'confident_advice_under_unsafe_state');
    }
  });

  it('review round 5: bare imperative recommendations on a known label degrade', () => {
    for (const prose of ['Choose Plan A.', 'Pick Plan A.', 'Select Plan A.', 'Go for Plan A.']) {
      expectViolation(checkCoachingOutput(prose, STALE, opts), 'confident_advice_under_unsafe_state');
    }
  });

  it('review round 5: "got" and contracted "’s been" passive mutations degrade', () => {
    for (const prose of [
      'Pricing got updated.',
      'Pricing’s been updated.',
      "Pricing's been changed.",
      'Pricing is being updated.',
    ]) {
      expectViolation(checkCoachingOutput(prose, FRESH, opts), 'invented_mutation_success');
    }
  });

  it('review round 5: bare verbs / passive auxiliaries do NOT over-fire without a real claim', () => {
    // Bare verb with no known label, and label + non-mutation predicate.
    for (const prose of [
      'Choose wisely and weigh both sides.',
      'Pricing got complicated this quarter.',
      'Pricing’s important to your goal.',
    ]) {
      expect(checkCoachingOutput(prose, STALE, opts), prose).toEqual({ safe: true });
    }
  });

  it('review round 4: label-as-subject judgement does NOT over-fire on non-option superlatives', () => {
    // A factor label as subject of a NON-option superlative is process talk.
    expect(checkCoachingOutput('Pricing is the best metric to track here.', STALE, opts)).toEqual({
      safe: true,
    });
    expect(checkCoachingOutput('Pricing was discussed at length today.', FRESH, opts)).toEqual({
      safe: true,
    });
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

// ---------------------------------------------------------------------------
// F-HELD fix 3b (wire capture 13c is the RED fixture): while a GM hold is
// live, the state-unsafe degrade previously stomped the reply with
// buildAnalysisAbsentTemplate + a competing run_analysis chip — hijacking the
// consent flow ("yes" then bound to the fresh rerun offer, 14c). With a live
// hold the degrade must restate the held offer + its confirm chip instead.
// ---------------------------------------------------------------------------

describe('buildCoachingDegradeResponse — held-aware degrade (F-HELD 3b)', () => {
  const LIVE_HOLD = {
    chip_id: 'gmh_13cfixture01',
    label: 'Continue with this change',
    message: 'Yes',
  } as const;

  it('13c shape: state-unsafe (none) + live hold → held-aware template + the hold confirm chip, NOT the absent template, NO rerun chip', () => {
    const r = buildCoachingDegradeResponse(NONE, { optionCount: 3, liveHold: LIVE_HOLD });
    expect(r.assistant_text).not.toBe(buildAnalysisAbsentTemplate(3, undefined));
    expect(r.assistant_text.toLowerCase()).toContain('holding');
    expect(r.assistant_text.toLowerCase()).toContain('confirm');
    expect(r.suggested_actions).toHaveLength(1);
    expect(r.suggested_actions[0]!.id).toBe('gmh_13cfixture01');
    expect(r.suggested_actions[0]!.label).toBe('Continue with this change');
    expect(r.suggested_actions[0]!.message).toBe('Yes');
    // No competing run_analysis offer minted by the degrade.
    expect(
      r.suggested_actions.some(
        (c) => (c as { action_type?: string }).action_type === 'run_analysis',
      ),
    ).toBe(false);
  });

  it('every state-unsafe branch (stale / unknown / blocked) is held-aware when a hold is live', () => {
    for (const p of [STALE, UNKNOWN, BLOCKED]) {
      const r = buildCoachingDegradeResponse(p, { liveHold: LIVE_HOLD });
      expect(r.assistant_text.toLowerCase()).toContain('holding');
      expect(r.suggested_actions[0]!.id).toBe('gmh_13cfixture01');
    }
  });

  it('fresh + usable state stays NEUTRAL even when a hold is live (the analysis is fine; only the prose was unsafe)', () => {
    const r = buildCoachingDegradeResponse(FRESH, { liveHold: LIVE_HOLD });
    expect(r.assistant_text).toBe(NEUTRAL_DEGRADE_TEXT);
    expect(r.suggested_actions).toHaveLength(0);
  });

  it('no live hold → behaviour unchanged (absent template + rerun chip)', () => {
    const r = buildCoachingDegradeResponse(NONE, { optionCount: 3 });
    expect(r.assistant_text).toBe(buildAnalysisAbsentTemplate(3, undefined));
    expect(r.suggested_actions[0]!.id).toBe('chip_action_rerun_analysis');
  });

  it('held-aware copy never narrates a value, hash, option label or internal token', () => {
    const r = buildCoachingDegradeResponse(NONE, { liveHold: LIVE_HOLD });
    expect(r.assistant_text).not.toMatch(/[£$€]/);
    expect(r.assistant_text).not.toMatch(/\b[0-9a-f]{12,}\b/i);
    expect(r.assistant_text).not.toMatch(/apply_proposed_change|graph_hash|pending/i);
  });
});

// ---------------------------------------------------------------------------
// F-HELD round 2, FIXUP 3 — hold selection for the held-aware degrade.
// A hold read at expires_at_turn_count=1 lapses at THIS turn's commit (the
// carry-forward decrements 1 → 0), so restating it with a confirm chip in the
// same message that carries the lapse notice would contradict itself and ship
// a dead chip. The selector requires expires_at_turn_count > 1.
// ---------------------------------------------------------------------------

describe('selectLiveHoldForDegrade — same-commit lapse contradiction guard (F-HELD round 2)', () => {
  const NOW = Date.parse('2026-07-11T12:00:00.000Z');

  function hold(overrides: {
    id?: string;
    ref?: string;
    turnCount?: number;
    expiresAtIso?: string;
    emittedAtIso?: string;
    legacy?: boolean;
  } = {}): PendingAction {
    const ref = overrides.ref ?? 'gmh_degrade000001';
    return {
      id: overrides.id ?? `pa-${ref}`,
      scenario_id: 'sc-degrade',
      chip_id: ref,
      action: overrides.legacy
        ? {
            kind: 'apply_proposed_change',
            proposal_ref: ref,
            inline_patch: { handler_id: 'graph_management_held_v1' },
            __legacy_no_public_copy: true,
          }
        : {
            kind: 'apply_proposed_change',
            proposal_ref: ref,
            inline_patch: { handler_id: 'graph_management_held_v1' },
            public_label: 'Continue with this change',
            public_message: 'Yes',
          },
      preconditions: { graph_hash: 'hash_d' },
      expires_at_turn_count: overrides.turnCount ?? 4,
      expires_at_iso: overrides.expiresAtIso ?? '2099-12-31T23:59:59.000Z',
      emitted_at_iso: overrides.emittedAtIso ?? '2026-07-11T11:59:00.000Z',
    } as PendingAction;
  }

  it('a live hold with turn budget remaining (TTL 4) is selected with its public copy', () => {
    const r = selectLiveHoldForDegrade([hold()], NOW);
    expect(r).toEqual({
      chip_id: 'gmh_degrade000001',
      label: 'Continue with this change',
      message: 'Yes',
    });
  });

  it('RED F-HELD round 2: a hold at expires_at_turn_count=1 is NOT selected (it lapses at this very commit)', () => {
    expect(selectLiveHoldForDegrade([hold({ turnCount: 1 })], NOW)).toBeUndefined();
  });

  it('a wall-expired hold is NOT selected', () => {
    expect(
      selectLiveHoldForDegrade(
        [hold({ expiresAtIso: '2026-07-11T11:00:00.000Z' })],
        NOW,
      ),
    ).toBeUndefined();
  });

  it('a legacy no-public-copy hold is NOT selected (nothing safe to restate)', () => {
    expect(selectLiveHoldForDegrade([hold({ legacy: true })], NOW)).toBeUndefined();
  });

  it('the NEWEST qualifying hold wins when several are live', () => {
    const older = hold({ id: 'pa-old', ref: 'gmh_older0000001', emittedAtIso: '2026-07-11T11:00:00.000Z' });
    const newer = hold({ id: 'pa-new', ref: 'gmh_newer0000001', emittedAtIso: '2026-07-11T11:30:00.000Z' });
    const r = selectLiveHoldForDegrade([older, newer], NOW);
    expect(r?.chip_id).toBe('gmh_newer0000001');
  });

  it('undefined / empty input → undefined', () => {
    expect(selectLiveHoldForDegrade(undefined, NOW)).toBeUndefined();
    expect(selectLiveHoldForDegrade([], NOW)).toBeUndefined();
  });
});
