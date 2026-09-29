/**
 * ⭐ THE ONE READER OF OLUMI'S READING OF A CHANGE GOAL'S TODAY LEVEL (`NodeV3.goal_level_reading`; AIQ (b) 5894808343
 * (1), conditions 5895379601). Every surface that shows a chance or a £ outcome for the goal says the reading's words once,
 * and branches on THIS predicate, never on the field's presence (AIQ: "the same predicate as the chance"): a reading
 * speaks only while the goal's stored level is still exactly the one it read, in its unit, and is still not the user's
 * own. A level the user states or edits since (a `user_stated` source, another figure) replaces it, and the old words are
 * never said.
 *
 * ⛔ AIQ 5895379601 condition 2: the TARGET clause is composed HERE, from the goal's CURRENT target, never stored: after a
 * target edit (−20% → −25%) the reading still speaks for the level, and says the target as it now stands.
 */
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { sayFigure } from '../agent-lane/say-figure.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export type GoalBound = '<=' | '<' | '>=' | '>';
const BOUNDS: readonly string[] = ['<=', '<', '>=', '>'];

/**
 * "Olumi reads your ‘£45k’ (‘Monthly spend is £45k’) as today's level of ‘costs’, so a 20% cut is £36,000 / month or
 * less." The lead is the reading's; the rest is the goal's target as given (`stored`: the contract's fraction r for
 * `change_rel`, the change c for `change_abs`), read from `level`.
 */
export function goalLevelSentence(
  lead: string,
  target: { readonly level: number; readonly frame: unknown; readonly stored: number; readonly unit: string; readonly bound: GoalBound | null },
): string | null {
  const { level, frame, stored, unit, bound } = target;
  if (frame !== 'change_rel' && frame !== 'change_abs') return null;
  const at = frame === 'change_rel' ? level * (1 + stored) : level + stored;
  const size = frame === 'change_rel' ? `${sayFigure(Math.round(Math.abs(stored) * 100 * 1e6) / 1e6, '')}%` : sayFigure(Math.abs(stored), unit);
  const move = stored < 0 ? 'cut' : 'rise';
  const T = sayFigure(Math.round(at * 100) / 100, unit);
  const said = bound === '<=' ? `${T} or less` : bound === '<' ? `less than ${T}` : bound === '>=' ? `${T} or more` : bound === '>' ? `more than ${T}` : T;
  return `${lead}, so a ${size} ${move} is ${said}.`;
}

/** The reading's words while it still speaks for the goal's stored level, else null. Defensive over the graph shape. */
export function goalLevelReadingWords(graph: unknown, goalNodeId: unknown): string | null {
  if (!isRec(graph) || !Array.isArray(graph.nodes) || typeof goalNodeId !== 'string') return null;
  const node = graph.nodes.find((n): n is Rec => isRec(n) && n.id === goalNodeId && n.kind === 'goal');
  const reading = node?.goal_level_reading;
  const os = node?.observed_state;
  if (!isRec(reading) || !isRec(os) || typeof reading.lead !== 'string' || reading.lead === '') return null;
  if (!num(os.raw_value) || os.raw_value !== reading.level) return null;
  const unit = typeof os.unit === 'string' ? os.unit : '';
  if (unit !== reading.level_unit) return null;
  if (classifyValueSource(os.source) === 'user_stated') return null;
  if (!num(node!.goal_threshold_raw)) return null;
  // The user's held comparator speaks first; else the drafter's, as the reading recorded it.
  const held = node!.goal_direction;
  const bound = (typeof held === 'string' && BOUNDS.includes(held) ? held : BOUNDS.includes(reading.bound as string) ? reading.bound : null) as GoalBound | null;
  return goalLevelSentence(reading.lead, { level: os.raw_value, frame: node!.goal_threshold_frame, stored: node!.goal_threshold_raw, unit, bound });
}
