/** The headline reads the same evaluated Run question and licensed screen lines as Results. */
import { hasRecordedLevelCalculation } from '../goal-target/static-run-evidence.js';
import { deriveRunQuestion, withRunQuestionScope } from '../goal-target/run-question.js';
import { goalChanceScreenLinesForAgent } from '../agent-lane/goal-chance-screen-lines.js';

export function runChanceHeadline(result: unknown, graph: unknown): string | null {
  const question = deriveRunQuestion({ storedResult: result });
  if (hasRecordedLevelCalculation(result) && question.scope.status !== 'supported_static') return null;
  const lines = goalChanceScreenLinesForAgent(withRunQuestionScope(result, question), graph, true);
  return lines.length === 0 ? null : lines.map(line => line.chance).join(' ');
}
