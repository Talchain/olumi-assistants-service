/**
 * RT-10 B′ R2 in the ONE leader licence: a target-only withhold KEEPS the shares (its `withheld_claims` lists no
 * `win_share`), so it withholds no leader. Any OTHER goal-figure withhold on the same Run that removed the shares still
 * withholds it, in either order on the carrier — the reader used to take only the first goal-figure warning.
 * SYNTHETIC inputs (the shapes `withholdOptionGoalFigures` records), pure.
 */
import { describe, expect, it } from 'vitest';
import { leaderLicenceVerdict, type LeaderLicenceVerdictInput } from '../leader-licence-verdict.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../../orchestrator/context/option-result-source.js';

type Rec = Record<string, unknown>;
const TARGET_ONLY: Rec = { code: GOAL_FIGURES_TARGET_NOT_TESTABLE, message: 'Not shown. …', severity: 'warning',
  option_ids: ['opt_a', 'opt_b'], withheld_claims: ['goal_probability', 'joint_probability', 'outcome', 'downside'] };
const PLACEHOLDER: Rec = { code: GOAL_FIGURES_PLACEHOLDER_PATH, message: 'Not shown. …', severity: 'warning', option_ids: ['opt_b'] };
const withWarnings = (warnings: Rec[]): LeaderLicenceVerdictInput => ({
  runId: 'run-1', graphHash: 'gh-1',
  result: { leading_option_id: 'opt_a',
    enrichment: { inference_warnings: warnings, option_comparison: [{ option_id: 'opt_a', win_probability: 0.7 }, { option_id: 'opt_b', win_probability: 0.3 }] },
    input_snapshot: { options: [{ option_id: 'opt_a' }, { option_id: 'opt_b' }] } },
  licence: 'permitted', leaderClaim: { permitted: true, separation: 'separated' },
  analysisReady: { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } },
  constraintEntitled: true, robustnessLevel: 'moderate',
});

describe('B′ R2 — the licence reads every goal-figure withhold, not the first', () => {
  it('a target-only withhold alone names the leader (the shares were kept)', () => {
    expect(leaderLicenceVerdict(withWarnings([TARGET_ONLY]))).toMatchObject({ verdict: 'permitted', leader_option_id: 'opt_a' });
  });
  it.each([
    ['target-only first', [TARGET_ONLY, PLACEHOLDER]],
    ['placeholder first', [PLACEHOLDER, TARGET_ONLY]],
  ])('beside a placeholder-path withhold (%s) the leader stays withheld, for the placeholder\'s reason', (_o, warnings) => {
    expect(leaderLicenceVerdict(withWarnings(warnings as Rec[]))).toMatchObject({ verdict: 'withheld', reason: 'goal_figures_withheld', leader_option_id: null });
  });
  it('CONTROL: a target withhold that did NOT keep the shares still withholds, as target_not_testable', () => {
    const { withheld_claims: _kept, ...full } = TARGET_ONLY;
    expect(leaderLicenceVerdict(withWarnings([full]))).toMatchObject({ verdict: 'withheld', reason: 'target_not_testable' });
  });
});
