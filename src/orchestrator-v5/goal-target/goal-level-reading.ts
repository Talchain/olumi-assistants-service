/**
 * ⭐ THE ONE READER OF OLUMI'S READING OF A CHANGE GOAL'S TODAY LEVEL (`NodeV3.goal_level_reading`; AIQ (b) 5894808343
 * (1)). Every surface that shows a chance or a £ outcome for the goal says the reading's words once, and branches on
 * THIS predicate, never on the field's presence (AIQ: "the same predicate as the chance"): a reading speaks only while
 * the goal's stored level is still exactly the one it read, in its unit, and is still not the user's own. A level the
 * user states or edits since (a `user_stated` source, another figure) replaces it, and the old words are never said.
 */
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The reading's words while it still speaks for the goal's stored level, else null. Defensive over the graph shape. */
export function goalLevelReadingWords(graph: unknown, goalNodeId: unknown): string | null {
  if (!isRec(graph) || !Array.isArray(graph.nodes) || typeof goalNodeId !== 'string') return null;
  const node = graph.nodes.find((n): n is Rec => isRec(n) && n.id === goalNodeId && n.kind === 'goal');
  const reading = node?.goal_level_reading;
  const os = node?.observed_state;
  if (!isRec(reading) || !isRec(os) || typeof reading.words !== 'string' || reading.words === '') return null;
  if (typeof os.raw_value !== 'number' || os.raw_value !== reading.level) return null;
  if ((typeof os.unit === 'string' ? os.unit : '') !== reading.level_unit) return null;
  if (classifyValueSource(os.source) === 'user_stated') return null;
  return reading.words;
}
