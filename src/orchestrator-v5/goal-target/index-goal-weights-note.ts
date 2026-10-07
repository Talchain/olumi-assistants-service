/** The value weights feeding an index are Olumi's assumptions, not the user's priorities. Pure. */
import { isSizedOnlyByOlumi } from '../../cee/magnitude/link-sizing.js';
import { goalUnitOf } from './goal-kind.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;

export const GOAL_INDEX_WEIGHTS_ASSUMED = 'GOAL_INDEX_WEIGHTS_ASSUMED';

export interface IndexGoalWeightsNote {
  readonly code: typeof GOAL_INDEX_WEIGHTS_ASSUMED;
  readonly severity: 'info';
  readonly message: string;
  readonly goal_id: string;
  readonly links: readonly { readonly from: string; readonly to: string }[];
}

export function indexGoalWeightsNoteOf(graph: unknown, goalId: unknown): IndexGoalWeightsNote | null {
  const g = rec(graph);
  const nodes = (Array.isArray(g?.nodes) ? g.nodes : []).map(rec).filter((n): n is Rec => n !== undefined);
  const goal = nodes.find((n) => n.id === goalId && n.kind === 'goal');
  if (goal === undefined || typeof goal.id !== 'string' || typeof goal.label !== 'string'
    || goal.label.trim() === '' || goalUnitOf(goal) !== undefined) return null;
  const labels = new Map(nodes.filter((n) => typeof n.id === 'string' && typeof n.label === 'string' && n.label.trim() !== '')
    .map((n) => [n.id as string, n.label as string]));
  const links = (Array.isArray(g?.edges) ? g.edges : []).map(rec).filter((e): e is Rec => e !== undefined)
    .filter((e) => e.to === goal.id && typeof e.from === 'string' && isSizedOnlyByOlumi(e)
      && rec(e.provenance)?.definitional !== true);
  // Every counted link must be nameable from this graph; never substitute an id for a label.
  if (links.length < 2 || links.some((e) => !labels.has(e.from as string))) return null;
  const names = links.map((e) => `‘${labels.get(e.from as string)!}’`);
  const list = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
  return {
    code: GOAL_INDEX_WEIGHTS_ASSUMED,
    severity: 'info',
    message: `How much each of ${list} counts towards ‘${goal.label}’ is Olumi's assumption, not your stated priority. Set them to match what matters to you.`,
    goal_id: goal.id,
    links: links.map((e) => ({ from: e.from as string, to: goal.id as string })),
  };
}

/** The warning rides the existing Run carrier, before the fact is projected and validated. */
export function withIndexGoalWeightsNote<E>(envelope: E, graph: unknown, goalId: unknown): E {
  const env = rec(envelope);
  if (env === undefined) return envelope;
  const note = indexGoalWeightsNoteOf(graph, goalId);
  if (note === null) return envelope;
  const warnings = Array.isArray(env.inference_warnings) ? env.inference_warnings : [];
  return { ...env, inference_warnings: [...warnings, note] } as E;
}

/** Read the Run's own note from either of the estate's existing warning carriers. */
export function indexGoalWeightsMessages(result: unknown): string[] {
  const r = rec(result);
  const messages = [rec(r?.enrichment)?.inference_warnings, r?.inference_warnings]
    .flatMap((ws) => Array.isArray(ws) ? ws : []).map(rec)
    .filter((w): w is Rec => w?.code === GOAL_INDEX_WEIGHTS_ASSUMED && w.severity === 'info'
      && typeof w.message === 'string' && w.message.trim() !== '' && typeof w.goal_id === 'string'
      && Array.isArray(w.links) && w.links.length >= 2
      && w.links.every((l: unknown) => typeof rec(l)?.from === 'string' && rec(l)?.to === w.goal_id))
    .map((w) => w.message as string);
  return [...new Set(messages)];
}
