/**
 * ⭐ THE RUN TURN SAYS OLUMI'S READINGS OF THE GOAL, ONCE (AIQ 5895379601 condition 1; DL 5895411225 (2); AIQ 5893587951
 * (1) for the direction reading).
 *
 * Two readings of the goal are OLUMI'S, never the user's, and a chance or an outcome for the goal rests on each:
 *  · `goal_sense_reading` — "cut costs by 20%" read as a target to bring DOWN (the Run minimises from it);
 *  · `goal_level_reading` — the brief's "£45k" read as today's level of ‘costs’ (the chance of the cut is measured from it).
 * Construction said each once, in a list no served surface showed (R3-B 5894575583: "Olumi reads" 0 times). The Run's
 * reply now says each, through the SAME predicate the Run acts on: the direction reading only when the Run's direction
 * came from it (`resolveGoalDirection` → `typed_change_sign`), the level reading only while it still speaks for the
 * goal's stored level (`goalLevelReadingWords`, its target as it now stands). Nothing held ⇒ nothing said.
 *
 * ⛔ THE EGRESS ADMITS THIS TAIL BY EXACT EQUALITY, NEVER A PATTERN (AIQ 5895590866 (2); DL lease 5895635885). The Run's
 * reply is checked again by the registry forwarder, which knows only the handler's outcome. The handler therefore hands it
 * the graph it analysed and the goal it read (`__goal_reading_source`), and the forwarder REBUILDS this tail from them
 * (`goalReadingTailOf`): the reply may carry exactly that string and nothing shaped like it. A model-written "Olumi reads
 * …" that is not the builder's output for THIS graph is rejected whole, as before.
 *
 * A reading whose words trip the reply's content defences (a raw decimal such as "£4.5k" in the quoted clause, a
 * forbidden word) is left out, exactly as every other disclosure builder degrades: the defences are not widened for it.
 * Named residual: that reading's chance is then shown without its words.
 */
import { passesAssistantTextContentDefences } from './assistant-text-defences.js';
import { resolveGoalDirection } from '../goal-target/goal-direction.js';
import { goalLevelReadingWords } from '../goal-target/goal-level-reading.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The direction reading's words when the Run's direction came from it, else null. */
function senseReadingWords(graph: unknown, goalNodeId: unknown): string | null {
  if (resolveGoalDirection(graph, goalNodeId)?.provenance !== 'typed_change_sign') return null;
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes : [];
  const node = nodes.find((n): n is Rec => isRec(n) && n.id === goalNodeId);
  const words = isRec(node?.goal_sense_reading) ? (node!.goal_sense_reading as Rec).words : undefined;
  return typeof words === 'string' && words.trim() !== '' ? words.trim() : null;
}

/** ' <direction words> <level words>' for the reply, or '' when the goal holds no reading that speaks. */
export function buildGoalReadingDisclosure(graph: unknown, goalNodeId: unknown): string {
  return [senseReadingWords(graph, goalNodeId), goalLevelReadingWords(graph, goalNodeId)]
    .filter((w): w is string => w !== null && passesAssistantTextContentDefences(w))
    .map((w) => ` ${w}`)
    .join('');
}

/** The handler's internal channel: the graph the Run analysed and the goal it read. Server-only, never the wire. */
export interface GoalReadingSource {
  readonly graph: unknown;
  readonly goal_node_id: string;
}

/** The tail the forwarder admits for THIS outcome, rebuilt from the handler's own graph; '' when there is none. */
export function goalReadingTailOf(outcome: unknown): string {
  if (outcome === null || typeof outcome !== 'object') return '';
  const source = (outcome as { __goal_reading_source?: unknown }).__goal_reading_source;
  if (!isRec(source) || typeof source.goal_node_id !== 'string') return '';
  return buildGoalReadingDisclosure(source.graph, source.goal_node_id);
}
