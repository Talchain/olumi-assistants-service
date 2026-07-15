/**
 * Production unsupported-claim checker, adapted for the G5 gate dim (Wave1-L3).
 *
 * This is the ONLY file in the gate path that imports src/. Same discipline as
 * score-run.ts: the production guard surface is IMPORTED, never copied. If this
 * import breaks, the coaching post-check moved — update the import, do not
 * reimplement the patterns here. A local copy would drift from production and
 * the gate would start certifying prose against rules the product no longer
 * has, which is worse than not checking at all (it looks checked).
 *
 * WHY THE STATE PACK IS RECONSTRUCTED FROM THE WIRE
 * ------------------------------------------------
 * `checkCoachingOutput` is state-conditional: several of its rules only fire
 * when an analysis result actually exists (a genuine pre-analysis coaching turn
 * must not be flagged for weighing options — that narrowing was a deliberate
 * product fix, #450). The harness does not have the server's in-process
 * CanonicalAnalysisState, so we rebuild the minimal CoachingStatePack from the
 * observable wire.
 *
 * That reconstruction is CONSERVATIVE ON PURPOSE. Where the wire is ambiguous
 * we choose the setting that makes the check FIRE LESS, not more:
 *   - freshness 'fresh' when a result is present, so stale-as-fresh and
 *     confident-advice rules stay disarmed unless we positively know otherwise.
 * A gate that over-reports blocks good prompts and gets switched off; a gate
 * that under-reports still catches the always-unsafe rules (fabricated results,
 * invented mutation success, unsupported evidence/confidence claims), which are
 * state-INDEPENDENT and fire regardless of this pack. Those are the claims that
 * matter most for shipping, and they are unaffected by the reconstruction.
 *
 * The honest limit, stated so nobody over-reads a G5 of 0: G5 is a floor on
 * fabrication the production post-check can see from prose alone. It is not a
 * proof that the candidate never misrepresents state.
 */
import { checkCoachingOutput } from '../../../src/orchestrator-v5/coaching/coaching-output-postcheck.js';
import type { CoachingStatePack } from '../../../src/orchestrator-v5/context/canonical-analysis-state.js';
import type { GateTurn, UnsupportedClaimChecker } from './gate-dims.js';

/** Minimal pack rebuilt from what the harness can observe on the wire. */
export function packFromTurn(turn: GateTurn): CoachingStatePack {
  const analysisPresent = turn.surfaces.payloadPercentages.length > 0 || turn.surfaces.winProbabilities != null;
  return {
    analysis_present: analysisPresent,
    // Conservative: an observed result is treated as fresh, so the
    // state-conditional rules stay disarmed unless we positively know
    // otherwise. See the note above on why under-reporting is the safe error.
    freshness: analysisPresent ? 'fresh' : 'none',
    readiness_status: null,
    rerun_required: false,
    usable_for_prose: analysisPresent,
    usable_for_chips: analysisPresent,
    blocked: false,
    actionable_blocker_count: 0,
  } as CoachingStatePack;
}

/**
 * The checker to inject into runGateDims. Returns the production violation tag
 * (a telemetry-safe closed enum — never prose, never a label), or null.
 *
 * PII: `decisionLabels` are passed IN so the production check can recognise the
 * graph's real labels, but only the violation TAG comes back out, so no label
 * can reach a score artifact or a log through this path.
 */
export const productionUnsupportedClaimChecker: UnsupportedClaimChecker = (turn: GateTurn) => {
  const result = checkCoachingOutput(turn.row.assistantText ?? '', packFromTurn(turn), {
    decisionLabels: turn.surfaces.optionLabels,
  });
  return result.safe ? null : (result.violation ?? 'unknown_violation');
};
