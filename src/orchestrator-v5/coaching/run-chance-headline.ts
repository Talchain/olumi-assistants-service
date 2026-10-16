/** The headline reads the same evaluated Run question and licensed screen lines as Results. */
import { withGoalChanceReadback } from '../goal-target/goal-chance-licence.js';
import { goalChanceScreenLinesForAgent } from '../agent-lane/goal-chance-screen-lines.js';

export function runChanceHeadline(result: unknown, graph: unknown): string | null {
  const lines = goalChanceScreenLinesForAgent(withGoalChanceReadback(result), graph, true);
  return lines.length === 0 ? null : lines.map(line => line.chance).join(' ');
}
