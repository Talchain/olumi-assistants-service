/**
 * ⭐ A PRE-FIX STORED SUMMARY'S OBJECTIVE-CONTRADICTION TAIL, FOR FIXTURES ONLY (DL producers re-scope P2, 12 Oct).
 *
 * Since P2, `composeObjectiveContradictionDisclosure` composes nothing for a NEW Run. Summaries stored before that still
 * carry the tail, and their readers (`projectObjectiveContradictionSummary`, the egress grammar) are still under test
 * (Q2/P3: no surgery on stored text; a pre-fix stored summary is a stated residual until its scenario re-runs). This
 * rebuilds the tail exactly as the pre-P2 composer did, from the module's own exported detectors and builder, so a
 * fixture describing a stored row cannot drift from the words such a row really holds. It is never a producer.
 */
import {
  buildObjectiveContradictionDisclosure,
  detectDirectionalContradiction,
  detectGoalAttainmentContradiction,
  readGoalLabel,
  readInterventionViews,
  readObjectiveOptionViews,
  type GoalFrame,
} from '../../objective-contradiction.js';
import { projectGoalProbabilitiesForTransport } from '../../../compose/goal-probability-transport.js';

export function storedObjectiveContradictionDisclosure(
  rawGraph: unknown,
  records: ReadonlyArray<Record<string, unknown>>,
  leaderWasNamed: boolean,
  goalFrame: GoalFrame,
  claims?: { readonly goalCertainty: unknown },
): string {
  if (!leaderWasNamed) return '';
  const claimedRecords = claims === undefined ? records : projectGoalProbabilitiesForTransport(
    { option_comparison: records }, claims.goalCertainty,
  )?.option_comparison as ReadonlyArray<Record<string, unknown>>;
  const options = readObjectiveOptionViews(claimedRecords);
  if (options.length < 2) return '';
  const attainment = goalFrame === 'goal_framed' ? detectGoalAttainmentContradiction(options) : null;
  if (attainment !== null) return buildObjectiveContradictionDisclosure(attainment, leaderWasNamed, goalFrame);
  return buildObjectiveContradictionDisclosure(
    detectDirectionalContradiction(readGoalLabel(rawGraph), options, readInterventionViews(rawGraph)),
    leaderWasNamed,
    goalFrame,
  );
}
