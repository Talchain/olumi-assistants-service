/**
 * PER-RUN leader authorisation in the run-comparison gate.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT. `composeComparison` received ONE permission and composed BOTH
 * runs' leaders from it:
 *
 *     "The leading option has changed. ${prior} came out ahead before,
 *      and ${current} now leads."
 *
 * The caller supplies the TURN's permission, which #730 reads off the
 * scenario's newest CLAIM-BEARING fact — a fact that speaks for the current run
 * and for nothing else. So "What changed?" named a PREVIOUS run's WITHHELD
 * leader whenever the CURRENT run permitted naming: the withhold had an expiry
 * of exactly one more analysis. (Cleanup-review F4 is the same defect from the
 * other end.)
 *
 * TWO PRODUCTION FORMS, and the second needs no unusual state:
 *   (a) the prior run's verdict is stamped withheld;
 *   (b) the prior run PREDATES the #710 verdict stamp, so
 *       `readMayNameLeadingOptionFromResult` fail-closes on it — i.e. every
 *       legacy run on every scenario older than #710.
 * Both are exercised below.
 *
 * WHAT MAKES THIS SUITE NON-VACUOUS. Every case runs the SAME fixture pair and
 * moves only the per-fact `constraint_verdict` stamps, so each difference is
 * attributable to the permissions and to nothing else. The permitted/permitted
 * case is pinned to the FULL expected string as a positive control: if the
 * fixture ever stopped producing a real comparison, that goes red rather than
 * the absence assertions passing on an empty answer (TESTING-DISCIPLINE rule 2
 * / CLAUDE.md trap #13 — an absence assertion must first prove it can see a
 * presence).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import * as gateModule from '../run-comparison-gate.js';
import {
  tryRunComparisonGate,
  WITHHELD_LEADER_COMPARISON_TEXT,
  WITHHELD_PRIOR_LEADER_COMPARISON_TEXT,
  WITHHELD_CURRENT_LEADER_COMPARISON_TEXT,
} from '../run-comparison-gate.js';
import { findLeaderClaims } from '../../compose/leading-option-egress-guard.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';

// ---------------------------------------------------------------------------
// Fixtures. Self-contained; no shared integration mocks.
// ---------------------------------------------------------------------------

function envelope(
  options: Array<{ id: string; label: string; win: number }>,
  band: string,
): V2RunResponseEnvelope {
  return {
    analysis_status: 'completed',
    results: options.map((o) => ({
      option_id: o.id,
      option_label: o.label,
      win_probability: o.win,
    })),
    robustness_synthesis: { overall_assessment: band },
  } as unknown as V2RunResponseEnvelope;
}

/**
 * How a run's claim-safety verdict is recorded on the persisted fact.
 *
 * `'unstamped'` is not a synonym for `'withheld'` and is listed separately for
 * that reason: it is the LEGACY shape (every run persisted before #710), and it
 * reaches `false` through the reader's fail-closed default rather than through
 * a recorded decision. Form (b) of the defect above is entirely made of these.
 */
type VerdictShape = 'permitted' | 'withheld' | 'unstamped';

function runFact(
  env: V2RunResponseEnvelope,
  shape: VerdictShape,
  computedAt: string,
): HandlerFact {
  return {
    fact_type: 'run_analysis',
    noop: false,
    result: {
      enrichment: env,
      computed_at: computedAt,
      graph_hash_at_run: 'h',
      ...(shape === 'unstamped'
        ? {}
        : {
            constraint_verdict: {
              may_name_leading_option: shape === 'permitted',
              constraint_verdict_state:
                shape === 'permitted' ? 'evaluated_feasible' : 'evaluated_infeasible',
            },
          }),
    },
  } as unknown as HandlerFact;
}

const PRIOR_ENV = envelope(
  [
    { id: 'a', label: 'Offshore', win: 0.62 },
    { id: 'b', label: 'Onshore', win: 0.38 },
  ],
  'low',
);
const CURRENT_ENV = envelope(
  [
    { id: 'b', label: 'Onshore', win: 0.55 },
    { id: 'a', label: 'Offshore', win: 0.45 },
  ],
  'high',
);

const PRIOR_LEADER = 'Offshore';
const CURRENT_LEADER = 'Onshore';

/**
 * Ask the gate with one verdict shape per compared run.
 *
 * `turn` defaults to `true` — the matrix varies the PER-RUN permissions, which
 * is the axis the single boolean could not express. The turn-withheld axis is
 * already pinned by `run-comparison-gate.test.ts` and is re-pinned here only
 * for the one-directionality property.
 */
function ask(prior: VerdictShape, current: VerdictShape, turn = true) {
  return tryRunComparisonGate({
    message: 'What changed?',
    // Newest-first, per the loader convention the pair selector relies on.
    priorFacts: [
      runFact(CURRENT_ENV, current, '2026-06-07T00:00:00.000Z'),
      runFact(PRIOR_ENV, prior, '2026-06-06T00:00:00.000Z'),
    ],
    freshness: 'fresh',
    mayNameLeadingOption: turn,
  });
}

function textOf(out: ReturnType<typeof tryRunComparisonGate>): string {
  expect(out.matched).toBe(true);
  if (!out.matched) throw new Error('unreachable: gate declined a fresh 2-run fixture');
  expect(out.mode).toBe('compared');
  return out.assistant_text;
}

/** The leader-free findings both fixtures produce, which must survive everywhere. */
const BAND_SENTENCE = 'The result is now stable, where before it was sensitive to your assumptions.';
const FOLLOW_UP = 'If you want to test this further, ask what would change the result.';

// ---------------------------------------------------------------------------
// 1. THE CODEX SCENARIO — the RED case.
// ---------------------------------------------------------------------------

describe('run-comparison: a WITHHELD prior run under a PERMITTED current run', () => {
  it('does NOT name the prior run\'s leading option', () => {
    // ⭐ THE DEFECT, in one assertion. Before the fix this text read
    // "The leading option has changed. Offshore came out ahead before, and
    // Onshore now leads." — the prior run's withheld leader, named verbatim
    // under the current run's permission.
    const text = textOf(ask('withheld', 'permitted'));
    expect(text).not.toContain(PRIOR_LEADER);
  });

  it('still names the CURRENT run\'s leading option — the withhold is not contagious', () => {
    // Anti-over-suppression. The current run's own verdict permits, so
    // declining to name it would trade a leak for the failure the acceptance
    // criteria weight equally with it.
    const text = textOf(ask('withheld', 'permitted'));
    expect(text).toContain(CURRENT_LEADER);
  });

  it('makes NO cross-run claim — no "has changed", no "still", no margin shift', () => {
    // The implication channel. "The leading option has changed" plus a named
    // current leader determines the prior leader by elimination on a two-option
    // model; "still leads" asserts the prior leader WAS this option, which is a
    // designation of the withheld run's leader in a sentence that never names
    // it. Both are cross-run claims and both require both permissions.
    const text = textOf(ask('withheld', 'permitted'));
    expect(text).not.toMatch(/leading option has changed/i);
    expect(text).not.toMatch(/\bstill leads\b/i);
    expect(text).not.toMatch(/came out ahead before/i);
    expect(text).not.toMatch(/its lead has (?:widened|narrowed)/i);
    expect(text).not.toMatch(/the size of its lead/i);
  });

  it('says WHY the other half is missing rather than silently returning less', () => {
    const text = textOf(ask('withheld', 'permitted'));
    expect(text).toContain(WITHHELD_PRIOR_LEADER_COMPARISON_TEXT);
  });

  it('form (b): an UNSTAMPED legacy prior run is treated exactly the same', () => {
    // The commonest production form, and it needs no unusual state — just a
    // scenario older than #710. "Unknown" and "verified feasible" are different
    // claims and only the second licenses naming a leader.
    const text = textOf(ask('unstamped', 'permitted'));
    expect(text).not.toContain(PRIOR_LEADER);
    expect(text).toContain(CURRENT_LEADER);
    expect(text).toContain(WITHHELD_PRIOR_LEADER_COMPARISON_TEXT);
  });
});

// ---------------------------------------------------------------------------
// 2. THE FOUR-CASE MATRIX — each combination gets an explicit composed shape.
// ---------------------------------------------------------------------------

describe('run-comparison: the four per-run permission combinations', () => {
  it('PERMITTED / PERMITTED — byte-identical to the pre-fix answer (POSITIVE CONTROL)', () => {
    // Pinned to the FULL string, not to fragments. This is the control that
    // makes every absence assertion in this file non-vacuous: it proves the
    // fixture produces a real, leader-naming, margin-carrying comparison, so
    // the "not.toContain" assertions elsewhere are measuring suppression rather
    // than an empty answer. It is also the one-directionality proof at the
    // bytes — this branch must not move at all.
    expect(textOf(ask('permitted', 'permitted'))).toBe(
      'The leading option has changed. Offshore came out ahead before, and Onshore now leads.'
        + ' Its lead has narrowed by about 14 percentage points.'
        + ` ${BAND_SENTENCE}`
        + ` ${FOLLOW_UP}`,
    );
  });

  it('WITHHELD / WITHHELD — the pre-fix fully-withheld shape, unchanged', () => {
    expect(textOf(ask('withheld', 'withheld'))).toBe(
      `${WITHHELD_LEADER_COMPARISON_TEXT} ${BAND_SENTENCE} ${FOLLOW_UP}`,
    );
  });

  it('WITHHELD / PERMITTED — the current leader, and an honest gap where the prior one was', () => {
    expect(textOf(ask('withheld', 'permitted'))).toBe(
      'Onshore leads on the latest result.'
        + ` ${WITHHELD_PRIOR_LEADER_COMPARISON_TEXT}`
        + ` ${BAND_SENTENCE}`
        + ` ${FOLLOW_UP}`,
    );
  });

  it('PERMITTED / WITHHELD — the prior leader, scoped to its own run, and no current one', () => {
    // The rarer direction: it needs the turn permission and the compared
    // current run to come from DIFFERENT facts (a newer stamped-permitted
    // non-successful fact carries the turn while the newest SUCCESSFUL run
    // withheld). Enumerated and given a shape anyway — a case left to fall
    // through to a neighbouring branch degrades however the last `else` was
    // written, which is not "degrades honestly".
    expect(textOf(ask('permitted', 'withheld'))).toBe(
      'Offshore came out ahead in the earlier run.'
        + ` ${WITHHELD_CURRENT_LEADER_COMPARISON_TEXT}`
        + ` ${BAND_SENTENCE}`
        + ` ${FOLLOW_UP}`,
    );
  });

  it('every combination keeps the leader-FREE findings (anti-over-suppression)', () => {
    // The band shift and the driver mover rank nothing — they are statements
    // about the result's stability and about factors, and they are the
    // substance of the user's actual question. Dropping them would be
    // suppression with no leak to prevent.
    for (const prior of ['permitted', 'withheld', 'unstamped'] as const) {
      for (const current of ['permitted', 'withheld', 'unstamped'] as const) {
        const text = textOf(ask(prior, current));
        expect(text, `${prior}/${current} lost the band sentence`).toContain(BAND_SENTENCE);
        expect(text, `${prior}/${current} lost the follow-up`).toContain(FOLLOW_UP);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. ONE-DIRECTIONALITY — the safety property the fix rests on.
// ---------------------------------------------------------------------------

describe('run-comparison: per-run authority is one-directional', () => {
  it('a WITHHELD turn still withholds both runs, whatever the per-run verdicts say', () => {
    // The per-run reads are conjoined with the turn permission, never
    // substituted for it. A permitted run inside a withheld turn must not
    // become nameable — that would be the `false -> true` move #726's
    // one-directionality argument forbids, and it would also strand the
    // `fail_closed_truncated` provenance, which no per-fact read can see.
    for (const prior of ['permitted', 'withheld', 'unstamped'] as const) {
      for (const current of ['permitted', 'withheld', 'unstamped'] as const) {
        const text = textOf(ask(prior, current, /* turn */ false));
        expect(text, `${prior}/${current} named a leader on a withheld turn`).not.toContain(PRIOR_LEADER);
        expect(text).not.toContain(CURRENT_LEADER);
        expect(text).toContain(WITHHELD_LEADER_COMPARISON_TEXT);
      }
    }
  });

  it('no per-run combination names a leader the pre-fix boolean would have hidden', () => {
    // The other direction of the same property, stated over the whole matrix:
    // the set of named labels can only shrink. With the turn permitted, the
    // pre-fix answer named BOTH labels; every combination here names a subset.
    for (const prior of ['permitted', 'withheld', 'unstamped'] as const) {
      for (const current of ['permitted', 'withheld', 'unstamped'] as const) {
        const text = textOf(ask(prior, current));
        if (prior !== 'permitted') expect(text).not.toContain(PRIOR_LEADER);
        if (current !== 'permitted') expect(text).not.toContain(CURRENT_LEADER);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. THE ALARM — withheld copy must stay invisible to the instrument that
//    measures the residue it exists to remove.
// ---------------------------------------------------------------------------

describe('run-comparison: mixed-case copy vs the production alarm', () => {
  it('the two new substituted constants are invisible to the alarm', () => {
    expect(
      findLeaderClaims({ assistant_text: WITHHELD_PRIOR_LEADER_COMPARISON_TEXT } as never),
    ).toHaveLength(0);
    expect(
      findLeaderClaims({ assistant_text: WITHHELD_CURRENT_LEADER_COMPARISON_TEXT } as never),
    ).toHaveLength(0);
  });

  it('DERIVED: every exported *_TEXT constant is covered by the module-load probe', () => {
    // CLAUDE.md trap #12 — the probe's list is hand-maintained, so this is the
    // fail-loud drift guard on it. Derived from the module's own exports rather
    // than from a second copy of the list: a third withheld constant added
    // without a probe entry fails HERE, in the same PR, instead of shipping
    // copy that raises an error-level `v5.invariant_violation` on every turn it
    // appears on.
    //
    // The probe itself runs at module load and throws, so it cannot be called
    // directly; this asserts the equivalent property over the same inputs using
    // the same reader the probe uses.
    //
    // ⚠ BROADENED from `WITHHELD_*` to every exported `*_TEXT` constant. The
    // prefix was not the property that mattered — being SUBSTITUTED COPY IN
    // THIS FILE was. `UNMATCHED_LEADER_IDENTITY_TEXT` is not a withhold (both
    // verdicts permit; the two runs' identities merely cannot be lined up), so
    // under the old filter it would have been exactly the constant this
    // reflection exists to catch and the only one it could not see: a
    // completeness guard whose scope was an accident of naming.
    const withheldConstants = Object.entries(gateModule).filter(
      (entry): entry is [string, string] =>
        entry[0].endsWith('_TEXT') && typeof entry[1] === 'string',
    );
    // Non-vacuity: the reflection must actually find them.
    expect(withheldConstants.length).toBeGreaterThanOrEqual(5);
    for (const [name, copy] of withheldConstants) {
      expect(
        findLeaderClaims({ assistant_text: copy } as never),
        `${name} trips the shared leader vocabulary`,
      ).toHaveLength(0);
    }
  });

  it('POSITIVE CONTROL: the alarm DOES see the leader the mixed answer names', () => {
    // Without this, the absence assertions above would pass identically against
    // a broken scanner.
    const text = textOf(ask('withheld', 'permitted'));
    expect(findLeaderClaims({ assistant_text: text } as never).length).toBeGreaterThan(0);
  });
});
