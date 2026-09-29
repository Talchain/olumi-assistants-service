/**
 * THE PROVISIONAL ADMISSION CAP REACHES ONE ARM OF ONE SIGNAL, DELIBERATELY.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `detectCoachingSignal`'s run_analysis branch consults
 * `admissionPermitsLeaderNaming` on the FIRST-RUN arm and not on the RERUN arm.
 * That asymmetry was raised as a suspected trust defect on 2026-09-11 — "a turn
 * misclassified as a re-run skips the provisional softening and names the leading
 * option" — and it is REAL as an observation and WRONG as a defect diagnosis.
 * It is a ruling, made in #1412, reversed inside #1412's own commit sequence
 * ("respect admission in first and rerun exploration" → "scope admission-aware
 * exploration to first run"), and it is load-bearing:
 *
 *   FIRST-RUN arm composes a CALL TO ACTION. Under the cap there is no
 *   designated leader to send someone to explore, so the nudge is redirected.
 *   No finding is lost, because a nudge carries none.
 *
 *   RERUN arm composes a COMPLETED COMPARISON — the delta, its attribution, the
 *   inert-edit explanation. Suppressing that deletes a finding the person asked
 *   for. The admission caps DESIGNATION, not measurement, and the qualification
 *   is carried at the wire instead (`enforceLeadingOptionClaimsAtWire`'s
 *   `separableProvisional` permit-with-caveat arm).
 *
 * ⚠⚠ SO THIS SPEC PINS A DIVERGENCE, NOT AN INVARIANT. Its whole job is to make
 * the next attempt to "fix" the asymmetry fail loudly, in a file that explains
 * why — because the previous attempt was made, reversed, and left only a
 * two-line comment behind, which is how a ruling becomes an oversight to a
 * reader six weeks later (CLAUDE.md trap 22f: count the rounds; this would be
 * round three).
 *
 * ── THE CASE THAT MADE IT LOOK LIKE A DEFECT, AND WHERE IT IS ACTUALLY FIXED ─
 * A FIRST-EVER run that reaches the rerun arm does skip the softening. It skips
 * it because the turn was MISCLASSIFIED by the phantom prior, and the fix is at
 * the classifier (`AUTO_RUN_RESULT_REACHES_USER`, fail-closed in
 * `context/run-initiator.ts`), not here: softening the rerun arm would have left
 * the fabricated "The result is unchanged" comparison standing and merely
 * stripped the option's name off it. The last describe below binds that
 * interaction, so the two fixes cannot be separated by a later edit without a
 * RED.
 *
 * ── BINDING ─────────────────────────────────────────────────────────────────
 * Copy is asserted against the exported production constants
 * (`FIRST_ANALYSIS_COMPLETE_PROVISIONAL_TEXT`, `COACHING_TEXT.*`), never against
 * a re-typed sentence — a copied literal in a spec is a mirror of the copy it
 * pins, and a substring match passes on a paraphrase (CLAUDE.md traps #12, #19).
 * Leader designation is asserted against the fixture's own label, so the
 * assertion names the object it is about.
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { SuccessfulHandlerOutcome } from '../../tools/handler-outcome.js';
import {
  buildAutoRunProvenance,
  RUN_PROVENANCE_ENRICHMENT_KEY,
} from '../../context/run-initiator.js';
import {
  COACHING_TEXT,
  FIRST_ANALYSIS_COMPLETE_PROVISIONAL_TEXT,
  detectCoachingSignal,
} from '../coaching-signals.js';

// ── fixtures ────────────────────────────────────────────────────────────────
//
// Same carriers as the two posture specs beside this one, so a fixture drift in
// one is visible as a disagreement rather than as two files quietly testing
// different objects.

const LEADING_LABEL = 'build self-hosting this year';

const OPTIONS = [
  { id: 'opt-build', label: LEADING_LABEL, win: 0.6 },
  { id: 'opt-defer', label: 'defer it to next year', win: 0.4 },
];

function runEnvelope(): Record<string, unknown> {
  return {
    analysis_status: 'completed',
    results: OPTIONS.map((o) => ({
      option_id: o.id,
      option_label: o.label,
      win_probability: o.win,
      factor_sensitivity: [],
    })),
  };
}

/** This turn's own run_analysis outcome — identical numbers to the prior, so the
 *  rerun composer's "unchanged" arm is the one that fires when a prior counts. */
function thisTurnRunOutcome(): SuccessfulHandlerOutcome {
  const fact = {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-build',
      summary: 'Ran analysis',
      enrichment: runEnvelope(),
    },
  } as unknown as HandlerFact;
  return { assistant_text: 'done', handler_facts: [fact], llm_calls_used: 0 };
}

function priorRunFact(provenance: Record<string, unknown> | null): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-build',
      summary: 'prior',
      computed_at: '2026-09-11T09:05:00.000Z',
      graph_hash_at_run: 'hash-prior',
      enrichment: {
        ...runEnvelope(),
        ...(provenance === null ? {} : { [RUN_PROVENANCE_ENRICHMENT_KEY]: provenance }),
      },
    },
  } as unknown as HandlerFact;
}

/** A prior the user really saw: their own "Run analysis", no provenance stamp. */
const USER_RUN_PRIOR = (): HandlerFact => priorRunFact(null);

/** The phantom: the fact `scheduleAutoRunAfterFreshDraft` commits after a fresh
 *  draft. Provenance built by the SAME function the production writer calls, so
 *  the fixture cannot drift from the writer's carrier. */
const AUTO_RUN_PRIOR = (): HandlerFact =>
  priorRunFact(buildAutoRunProvenance('draft-turn-abc') as unknown as Record<string, unknown>);

/**
 * One dispatch helper, so every case below differs ONLY in the two inputs under
 * test: the prior facts and the admission cap. `mayNameLeadingOption` is held
 * TRUE throughout — this file is about the MODEL's designation cap, and letting
 * the TURN's entitlement vary would let a case pass for the other reason.
 */
function runBranch(
  priorFacts: readonly HandlerFact[],
  admissionPermitsLeaderNaming: boolean,
) {
  return detectCoachingSignal({
    proposedHandlerId: 'run_analysis',
    mayNameLeadingOption: true,
    admissionPermitsLeaderNaming,
    outcome: thisTurnRunOutcome(),
    contextPack: null,
    priorFacts,
  });
}

// ── the divergence, asserted against ONE admission value ────────────────────

describe('a capped admission redirects the first-run nudge and leaves the rerun comparison intact', () => {
  it('THE SPLIT, IN ONE TEST: same cap, same entitlement, two arms, two treatments', () => {
    // ⭐ THE POINT OF ASSERTING BOTH HERE RATHER THAN IN TWO TESTS: the claim is
    // about a DIFFERENCE, and a difference asserted in two files can be half
    // deleted without either half looking wrong. Both calls take the identical
    // cap, so neither outcome can be explained by the input.
    const firstRun = runBranch([], false);
    const genuineRerun = runBranch([USER_RUN_PRIOR()], false);

    // FIRST RUN — the nudge is redirected, and designates nothing.
    expect(firstRun?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
    expect(firstRun?.coaching_text).toBe(FIRST_ANALYSIS_COMPLETE_PROVISIONAL_TEXT);
    expect(firstRun?.coaching_text).not.toContain(LEADING_LABEL);
    expect(firstRun?.coaching_text).not.toContain('the leading option');

    // GENUINE RE-RUN — the completed comparison survives, leader named.
    expect(genuineRerun?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
    expect(genuineRerun?.coaching_text).toContain('The result is unchanged');
    expect(genuineRerun?.coaching_text).toContain(LEADING_LABEL);

    // …and the two are genuinely different strings on the same input pair. A
    // future edit that collapses the arms makes this line fail even if both
    // assertions above were loosened to substring matches.
    expect(firstRun?.coaching_text).not.toBe(genuineRerun?.coaching_text);
  });

  it('OPPOSITE-DIRECTION TWIN: an UNCAPPED admission leaves BOTH arms at their standard copy', () => {
    // Without this, every assertion above could be satisfied by the cap simply
    // not being read at all on either arm (trap 22b: one direction alone lets
    // the other through). Same fixtures, cap flipped.
    const firstRun = runBranch([], true);
    const genuineRerun = runBranch([USER_RUN_PRIOR()], true);

    expect(firstRun?.coaching_text).toBe(COACHING_TEXT.FIRST_ANALYSIS_COMPLETE({}));
    expect(firstRun?.coaching_text).not.toBe(FIRST_ANALYSIS_COMPLETE_PROVISIONAL_TEXT);
    // The standard first-run copy DOES point at the leading option — which is
    // precisely what the cap redirects, and why the two copies exist.
    expect(firstRun?.coaching_text).toContain('the leading option');

    // The rerun arm is byte-identical across the cap: it never read it.
    expect(genuineRerun?.coaching_text).toBe(runBranch([USER_RUN_PRIOR()], false)?.coaching_text);
  });

  it('the cap reaches the FIRST-RUN arm only — the rerun copy is invariant under it, by ruling', () => {
    // Stated as its own case because it is the sentence a reviewer will want to
    // check: is the rerun arm really insensitive to this input, or does it just
    // happen to agree on this fixture? Asserted as equality of the composed
    // text across both values of the ONLY input that differs.
    const cappedRerun = runBranch([USER_RUN_PRIOR()], false);
    const uncappedRerun = runBranch([USER_RUN_PRIOR()], true);
    expect(cappedRerun?.signal_id).toBe(uncappedRerun?.signal_id);
    expect(cappedRerun?.coaching_text).toBe(uncappedRerun?.coaching_text);

    // …and the discriminating contrast IN THE SAME TEST, so this cannot be
    // satisfied by `detectCoachingSignal` ignoring the parameter everywhere.
    expect(runBranch([], false)?.coaching_text).not.toBe(runBranch([], true)?.coaching_text);
  });

  it('an UNDEFINED admission is not a cap — absent evidence must not be read as a restriction', () => {
    // `admissionPermitsLeaderNaming` is optional on the input, and the read is
    // `=== false` rather than a falsy test, deliberately: a dispatch path that
    // assembles no admission must get today's behaviour, not a silent
    // suppression. Fail-open here is the same ruling the wire enforcer's mode
    // reader makes, for the same reason.
    const noAdmission = detectCoachingSignal({
      proposedHandlerId: 'run_analysis',
      mayNameLeadingOption: true,
      outcome: thisTurnRunOutcome(),
      contextPack: null,
      priorFacts: [],
    });
    expect(noAdmission?.coaching_text).toBe(COACHING_TEXT.FIRST_ANALYSIS_COMPLETE({}));
  });
});

// ── the interaction that made the asymmetry look like the defect ────────────

describe('the phantom prior is what exposed the rerun arm, and the classifier is where it is fixed', () => {
  it('A PHANTOM PRIOR UNDER A CAP TAKES THE FIRST-RUN ARM, so the softening applies', () => {
    // ⭐ THIS IS THE 2026-09-11 WITNESS, WITH BOTH FIXES IN FORCE. Before the
    // classifier was made fail-closed, this fixture took the RERUN arm: it
    // asserted "The result is unchanged: build self-hosting this year still
    // leads" on a first-ever analysis AND named the leader past the cap. Both
    // halves are closed by the one change, at the classifier.
    const signal = runBranch([AUTO_RUN_PRIOR()], false);

    expect(signal?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
    expect(signal?.coaching_text).toBe(FIRST_ANALYSIS_COMPLETE_PROVISIONAL_TEXT);
    // The witnessed sentence, and the designation it carried.
    expect(signal?.coaching_text).not.toContain('The result is unchanged');
    expect(signal?.coaching_text).not.toContain(LEADING_LABEL);
  });

  it('DISCRIMINATING TWIN: the identical fixture with a USER prior still names the leader under the same cap', () => {
    // The pair is what binds the previous case to the PROVENANCE of the prior
    // rather than to the cap. One fixture field differs; the outcome inverts.
    // Neither case alone shows that (CLAUDE.md trap #19).
    const signal = runBranch([USER_RUN_PRIOR()], false);
    expect(signal?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
    expect(signal?.coaching_text).toContain(LEADING_LABEL);
  });

  it('an uncapped phantom prior is ALSO a first run — the classifier fix is not conditional on the cap', () => {
    // The two fixes are independent, and this says so. A later edit that made
    // the phantom-prior suppression depend on the admission would pass every
    // case above and fail here.
    const signal = runBranch([AUTO_RUN_PRIOR()], true);
    expect(signal?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
    expect(signal?.coaching_text).toBe(COACHING_TEXT.FIRST_ANALYSIS_COMPLETE({}));
  });
});
