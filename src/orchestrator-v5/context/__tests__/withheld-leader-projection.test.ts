/**
 * T1 claim safety — the INPUT-side projections and the ONE fact-array read.
 * ROADMAP 1.231 + 1.233.
 *
 * These are unit tests on pure functions. The behavioural proof that they are
 * WIRED lives at the boundary, in
 * `__tests__/claim-safety-hoist-and-input-gate-route-level.test.ts` — a unit
 * test of a projection cannot tell you the projection is applied, which is the
 * distinction TESTING-DISCIPLINE rule 3 exists to enforce. What this file adds
 * is the field-level and edge-case coverage that would bloat the route file.
 */
import { describe, it, expect } from 'vitest';

import {
  WITHHELD_DROPPED_DISPLAY_ANALYSIS_MEMBERS,
  WITHHELD_DROPPED_PACK_ANALYSIS_MEMBERS,
  WITHHELD_LEADER_INPUT_NOTE,
  WITHHELD_LEADER_INPUT_NOTE_NO_CAUSE,
  projectContextPackAnalysisForWithheldClaim,
  projectDisplayAnalysisForWithheldClaim,
  withheldLeaderInputNoteForState,
} from '../withheld-leader-projection.js';
import {
  readConstraintVerdictStateForFacts,
  readMayNameLeadingOptionForFacts,
} from '../claim-safety-read.js';
import { findLeaderClaims } from '../../compose/leading-option-egress-guard.js';
import type { ContextPackAnalysis } from '../context-pack-assembler.js';
import type { DisplaySafeAnalysis } from '../../format/format-analysis-for-context.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

/**
 * The verdict state used by the tests that are not ABOUT the note. `unevaluated`
 * is the canonical withheld state with a genuinely-ratified condition behind it,
 * so it selects the cause-bearing note and leaves those assertions unchanged.
 */
const WITHHELD_STATE = 'unevaluated' as const;

const DISPLAY: DisplaySafeAnalysis = {
  status: 'completed',
  leading_option: { label: 'Standardise on MacBook Pro', win_probability: '56%' },
  runner_up: { label: 'Standardise on Dell XPS', win_probability: '26%' },
  margin: '30 percentage points',
  robustness_band: 'sensitive to your assumptions',
  top_drivers: [{ label: 'Toolchain risk', influence: 'strong negative influence' }],
  fragile_edges: [{ from_label: 'Toolchain risk', to_label: 'Delivery' }],
  options: [
    { label: 'Standardise on MacBook Pro', win_probability: '56%' },
    { label: 'Standardise on Dell XPS', win_probability: '26%' },
  ],
  fragile_edge_count: '3',
  goal_fit: 'Target fit was not scored for this run.',
  confidence_tier: 'analysis confidence needs work',
} as unknown as DisplaySafeAnalysis;

const PACK: ContextPackAnalysis = {
  status: 'completed',
  leading_option: { label: 'Standardise on MacBook Pro', probability: 0.56 },
  runner_up: { label: 'Standardise on Dell XPS', probability: 0.26 },
  margin_pp: 30,
  robustness_band: 'fragile',
  top_drivers: [{ factor_label: 'Toolchain risk', sensitivity_value: -0.6 }],
  fragile_edges: [{ from_label: 'Toolchain risk', to_label: 'Delivery' }],
  options: [
    { label: 'Standardise on MacBook Pro', probability: 0.56 },
    { label: 'Standardise on Dell XPS', probability: 0.26 },
  ],
} as unknown as ContextPackAnalysis;

describe('projectDisplayAnalysisForWithheldClaim — the MODEL-facing gate (1.231)', () => {
  it('removes every leader-designating member, INCLUDING the ranked options table', () => {
    const out = projectDisplayAnalysisForWithheldClaim(DISPLAY, WITHHELD_STATE)!;
    for (const member of WITHHELD_DROPPED_DISPLAY_ANALYSIS_MEMBERS) {
      expect(out, `${member} must not survive a withheld projection`).not.toHaveProperty(member);
    }
  });

  it('the live leaking sentence is NOT RECONSTRUCTIBLE from what survives', () => {
    // The assertion that actually matters, and the reason `options` is dropped.
    // "MacBook Pro leads at 56% against Dell XPS at 26%" (the walk's §4 body,
    // verbatim) is buildable from `options` alone — it is sorted by win
    // probability and carries the probabilities. A member-by-member check
    // would pass on a projection that kept the table under a new name; this
    // one would not.
    const serialised = JSON.stringify(projectDisplayAnalysisForWithheldClaim(DISPLAY, WITHHELD_STATE));
    expect(serialised).not.toContain('MacBook Pro');
    expect(serialised).not.toContain('Dell XPS');
    expect(serialised).not.toContain('56%');
    expect(serialised).not.toContain('26%');
    expect(serialised).not.toContain('30 percentage points');
  });

  it('KEEPS every non-comparative field verbatim (anti-over-suppression)', () => {
    const out = projectDisplayAnalysisForWithheldClaim(DISPLAY, WITHHELD_STATE)! as unknown as Record<string, unknown>;
    // These are the substance a user needs MOST on the turn a recommendation is
    // withheld. Losing them would be the failure weighted equally with the leak.
    for (const kept of [
      'status',
      'robustness_band',
      'top_drivers',
      'fragile_edges',
      'fragile_edge_count',
      'goal_fit',
      'confidence_tier',
    ]) {
      expect(out[kept], `${kept} must survive`).toEqual(
        (DISPLAY as unknown as Record<string, unknown>)[kept],
      );
    }
  });

  it('is NEVER SILENT — it stamps the note in place of what it removed', () => {
    const out = projectDisplayAnalysisForWithheldClaim(DISPLAY, WITHHELD_STATE)! as unknown as Record<string, unknown>;
    expect(out['leading_option_note']).toBe(WITHHELD_LEADER_INPUT_NOTE);
  });

  it('stamps the note even when the producer sent NO ranking to begin with', () => {
    // Otherwise the note's presence would itself disclose which shape the
    // producer sent — a withheld turn should read the same either way.
    const bare = { status: 'completed' } as unknown as DisplaySafeAnalysis;
    const out = projectDisplayAnalysisForWithheldClaim(bare, WITHHELD_STATE)! as unknown as Record<string, unknown>;
    expect(out['leading_option_note']).toBe(WITHHELD_LEADER_INPUT_NOTE);
  });

  it('null in, null out — a turn with no analysis grows no note', () => {
    expect(projectDisplayAnalysisForWithheldClaim(null, WITHHELD_STATE)).toBeNull();
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(DISPLAY);
    projectDisplayAnalysisForWithheldClaim(DISPLAY, WITHHELD_STATE);
    expect(JSON.stringify(DISPLAY)).toBe(before);
  });

  it('the INJECTED NOTE is invisible to the alarm it would otherwise trip', () => {
    // The module asserts this at load time and throws; this is the readable
    // regression pin. It caught a real defect during development: the first
    // draft said "which option is out in front", and `out in front` is a live
    // pattern — the gate would have injected the exact residue the alarm
    // measures, into every withheld prompt.
    expect(findLeaderClaims({ assistant_text: WITHHELD_LEADER_INPUT_NOTE } as never)).toHaveLength(
      0,
    );
    // BOTH voices, or the probe covers only the one that already shipped.
    expect(
      findLeaderClaims({ assistant_text: WITHHELD_LEADER_INPUT_NOTE_NO_CAUSE } as never),
    ).toHaveLength(0);
  });
});

/**
 * F2 — THE FABRICATED CAUSE, and why it is a CORRECTNESS cost rather than a
 * content one.
 *
 * The fail-closed default fires for EVERY unstamped pre-#710 fact, including
 * scenarios where the user ratified NO constraint at all. Had a verdict been
 * derived for one of those, it would have been `not_applicable` — permitted.
 * The note, however, was unconditional:
 *
 *   "a condition the user ratified could not be checked against this result"
 *
 * On those turns the model is handed a FALSE FACTUAL PREMISE about the user's
 * own scenario and coached to explain the withheld ranking with it. Withholding
 * a ranking we cannot stand behind is the doctrine; inventing a reason for the
 * withholding is the opposite of it.
 */
describe('F2 — the input note must not assert a cause the evidence does not support', () => {
  it('state UNREADABLE (null) ⇒ the CAUSE-FREE note, naming no ratified condition', () => {
    const out = projectDisplayAnalysisForWithheldClaim(
      DISPLAY,
      null,
    )! as unknown as Record<string, unknown>;
    expect(out['leading_option_note']).toBe(WITHHELD_LEADER_INPUT_NOTE_NO_CAUSE);
    // The specific fabrication, asserted on the note's own bytes so a reworded
    // cause-bearing note cannot creep back into the null branch.
    expect(out['leading_option_note']).not.toContain('ratified');
    expect(out['leading_option_note']).not.toContain('condition');
  });

  it('a state where a constraint GENUINELY EXISTS keeps the ratified-condition wording', () => {
    // Anti-over-correction, weighted equally: the cause is TRUE on these states
    // and deleting it would leave the model with no account of why the ranking
    // is absent — the "narrate around a missing section" failure the
    // never-silent rule exists for.
    for (const state of ['evaluated_infeasible', 'unevaluated', 'identity_unresolved'] as const) {
      const out = projectDisplayAnalysisForWithheldClaim(
        DISPLAY,
        state,
      )! as unknown as Record<string, unknown>;
      expect(out['leading_option_note'], `state ${state}`).toBe(WITHHELD_LEADER_INPUT_NOTE);
    }
  });

  it('BOTH notes still carry the instruction the gate exists to give', () => {
    // The cause clause is what changes; the operative half must not be lost in
    // the edit. Without it a bare "this was removed" invites the model to reach
    // for the numbers it can still see in `top_drivers`.
    for (const note of [WITHHELD_LEADER_INPUT_NOTE, WITHHELD_LEADER_INPUT_NOTE_NO_CAUSE]) {
      expect(note).toContain('Do not name or imply any option as the answer');
      expect(note).toContain('do not infer one from the drivers below');
    }
  });

  it('the two notes are DIFFERENT copy — a null state must be distinguishable', () => {
    expect(WITHHELD_LEADER_INPUT_NOTE_NO_CAUSE).not.toBe(WITHHELD_LEADER_INPUT_NOTE);
  });

  it('withheldLeaderInputNoteForState is the single selector both callers share', () => {
    expect(withheldLeaderInputNoteForState(null)).toBe(WITHHELD_LEADER_INPUT_NOTE_NO_CAUSE);
    expect(withheldLeaderInputNoteForState('unevaluated')).toBe(WITHHELD_LEADER_INPUT_NOTE);
    // The two PERMITTED states cannot reach a withheld projection (the caller
    // owns the permission), so the honest answer for them is the cause-free
    // note rather than a fabricated ratified-condition claim.
    expect(withheldLeaderInputNoteForState('not_applicable')).toBe(
      WITHHELD_LEADER_INPUT_NOTE_NO_CAUSE,
    );
    expect(withheldLeaderInputNoteForState('evaluated_feasible')).toBe(
      WITHHELD_LEADER_INPUT_NOTE_NO_CAUSE,
    );
  });
});

/**
 * The STATE sibling of the permission read. It exists so the note and the
 * permission are read off the SAME fact by the SAME content-based selector —
 * two selectors is how one response ends up describing two analyses.
 */
describe('readConstraintVerdictStateForFacts — the state behind the note (F2)', () => {
  const runFact = (result: Record<string, unknown>): HandlerFact =>
    ({ fact_type: 'run_analysis', noop: false, result } as unknown as HandlerFact);

  const base = {
    scenario_id: 's',
    summary: 'x',
    leading_option_id: 'opt_a',
    computed_at: '2026-07-01T00:00:00.000Z',
    graph_hash_at_run: 'h',
    enrichment: { analysis_status: 'completed' },
  };

  it('no analysis at all ⇒ null (nothing was recorded, and nothing is invented)', () => {
    expect(readConstraintVerdictStateForFacts([])).toBeNull();
  });

  it('a PRE-#708 fact ⇒ null — the exact input the fabricated cause was asserted on', () => {
    expect(readConstraintVerdictStateForFacts([runFact({ ...base })])).toBeNull();
  });

  it('reads the TYPED state first, and the INTERIM stamp second', () => {
    expect(
      readConstraintVerdictStateForFacts([
        runFact({
          ...base,
          constraint_verdict: {
            may_name_leading_option: false,
            constraint_verdict_state: 'identity_unresolved',
          },
        }),
      ]),
    ).toBe('identity_unresolved');
    expect(
      readConstraintVerdictStateForFacts([
        runFact({
          ...base,
          enrichment: {
            analysis_status: 'completed',
            __cee_claim_safety: {
              may_name_leading_option: false,
              constraint_verdict_state: 'unevaluated',
            },
          },
        }),
      ]),
    ).toBe('unevaluated');
  });

  it('selects the SAME fact the permission read selects', () => {
    // The load-bearing property. If these two ever selected different facts the
    // note would describe one analysis and the withholding another.
    const older = runFact({
      ...base,
      computed_at: '2026-07-01T00:00:00.000Z',
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      },
    });
    const newer = runFact({
      ...base,
      computed_at: '2026-07-02T00:00:00.000Z',
      constraint_verdict: {
        may_name_leading_option: false,
        constraint_verdict_state: 'unevaluated',
      },
    });
    expect(readMayNameLeadingOptionForFacts([older, newer])).toBe(false);
    expect(readConstraintVerdictStateForFacts([older, newer])).toBe('unevaluated');
    expect(readConstraintVerdictStateForFacts([newer, older])).toBe('unevaluated');
  });
});

describe('projectContextPackAnalysisForWithheldClaim — the DETERMINISTIC-composer gate (1.233)', () => {
  it('nulls the declared-nullable leader members and removes the options list', () => {
    const out = projectContextPackAnalysisForWithheldClaim(PACK)! as unknown as Record<string, unknown>;
    expect(out['leading_option']).toBeNull();
    expect(out['runner_up']).toBeNull();
    expect(out['margin_pp']).toBeNull();
    expect(out).not.toHaveProperty('options');
    // The member list and the behaviour must agree, or the exported constant
    // becomes a stale mirror of what the function does.
    for (const member of WITHHELD_DROPPED_PACK_ANALYSIS_MEMBERS) {
      const value = out[member];
      expect(value === null || value === undefined, `${member} must be null or absent`).toBe(true);
    }
  });

  it('NULL, not deleted, for the three declared members — consumers branch on ===null', () => {
    // The distinction is load-bearing: `AdviceGateAnalysis.leading_option` is
    // `Option | null`, and the advice gate's availability check reads
    // `analysis.leading_option == null`. Deleting the key would work today by
    // accident; handing it the null it is written to expect exercises a path
    // that exists and is tested.
    const out = projectContextPackAnalysisForWithheldClaim(PACK)!;
    expect('leading_option' in (out as object)).toBe(true);
    expect('runner_up' in (out as object)).toBe(true);
    expect('margin_pp' in (out as object)).toBe(true);
  });

  it('keeps the non-comparative fields verbatim', () => {
    const out = projectContextPackAnalysisForWithheldClaim(PACK)! as unknown as Record<string, unknown>;
    expect(out['status']).toBe('completed');
    expect(out['top_drivers']).toEqual(PACK.top_drivers);
    expect(out['fragile_edges']).toEqual(PACK.fragile_edges);
    expect(out['robustness_band']).toBe('fragile');
  });

  it('null in, null out; and does not mutate its input', () => {
    expect(projectContextPackAnalysisForWithheldClaim(null)).toBeNull();
    const before = JSON.stringify(PACK);
    projectContextPackAnalysisForWithheldClaim(PACK);
    expect(JSON.stringify(PACK)).toBe(before);
  });
});

/**
 * The shared read behind the hoist. Its two defaults are DIFFERENT THINGS and
 * the difference is the whole safety argument, so both are pinned.
 */
describe('readMayNameLeadingOptionForFacts — the ONE claim-safety read (1.233)', () => {
  const runFact = (result: Record<string, unknown>): HandlerFact =>
    ({ fact_type: 'run_analysis', noop: false, result } as unknown as HandlerFact);

  const base = {
    scenario_id: 's',
    summary: 'x',
    leading_option_id: 'opt_a',
    computed_at: '2026-07-01T00:00:00.000Z',
    graph_hash_at_run: 'h',
    enrichment: { analysis_status: 'completed' },
  };

  it('NO analysis at all ⇒ true (honest, not fail-open: there is nothing to leak)', () => {
    expect(readMayNameLeadingOptionForFacts([])).toBe(true);
  });

  it('a completed analysis with NO verdict stamp ⇒ FALSE (fail closed)', () => {
    // The distinction that matters. "Unknown" and "verified feasible" are
    // different claims and only the second licenses naming a leader; a write
    // path that forgets to stamp must not be silent.
    expect(readMayNameLeadingOptionForFacts([runFact({ ...base })])).toBe(false);
  });

  it('reads the TYPED constraint_verdict first (schemas 0.25.0)', () => {
    expect(
      readMayNameLeadingOptionForFacts([
        runFact({
          ...base,
          constraint_verdict: {
            may_name_leading_option: true,
            constraint_verdict_state: 'evaluated_feasible',
          },
        }),
      ]),
    ).toBe(true);
    expect(
      readMayNameLeadingOptionForFacts([
        runFact({
          ...base,
          constraint_verdict: {
            may_name_leading_option: false,
            constraint_verdict_state: 'unevaluated',
          },
        }),
      ]),
    ).toBe(false);
  });

  it('falls back to the INTERIM stamp on facts persisted before 0.25.0', () => {
    // The migration ramp: facts written between #710 and that release carry
    // only this key, and dropping the reader would silently reclassify every
    // one of them as withheld.
    expect(
      readMayNameLeadingOptionForFacts([
        runFact({
          ...base,
          enrichment: {
            analysis_status: 'completed',
            __cee_claim_safety: {
              may_name_leading_option: true,
              constraint_verdict_state: 'evaluated_feasible',
            },
          },
        }),
      ]),
    ).toBe(true);
  });

  it('selects the NEWEST analysis, so a stale permissive fact cannot license a withheld turn', () => {
    const older = runFact({
      ...base,
      computed_at: '2026-07-01T00:00:00.000Z',
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      },
    });
    const newer = runFact({
      ...base,
      computed_at: '2026-07-02T00:00:00.000Z',
      constraint_verdict: {
        may_name_leading_option: false,
        constraint_verdict_state: 'unevaluated',
      },
    });
    expect(readMayNameLeadingOptionForFacts([older, newer])).toBe(false);
    // Order-independent — the selector orders by content, not by position.
    expect(readMayNameLeadingOptionForFacts([newer, older])).toBe(false);
  });
});
