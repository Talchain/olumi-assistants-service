/** The headline reads the same evaluated Run question and licensed screen lines as Results. */
import { hasRecordedLevelCalculation } from '../goal-target/static-run-evidence.js';
import { deriveRunQuestion, withRunQuestionScope } from '../goal-target/run-question.js';
import { goalChanceScreenLinesForAgent } from '../agent-lane/goal-chance-screen-lines.js';

export function runChanceHeadline(result: unknown, graph: unknown): string | null {
  const question = deriveRunQuestion({ storedResult: result });
  if (hasRecordedLevelCalculation(result) && !question.scope.can_show_goal_chance) return null;
  const lines = goalChanceScreenLinesForAgent(withRunQuestionScope(result, question), graph, true);
  return lines.length === 0 ? null : lines.map(line => line.chance).join(' ');
}
