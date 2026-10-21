/**
 * ⭐ PATH-B: OLUMI'S NOTE ON ONE ITEM (DL ruling, 21 Oct 2026; Paul 20 Oct: the AI is part of the canvas). The AI points at
 * ONE item of the saved model and says one short thing beside it: a question, a challenge or what is missing. The note is
 * the existing `ui_directive` block (`highlight`, one target, `note` ≤ 140, `source: 'composer'`), which the canvas shows
 * beside the item as Olumi's. It writes nothing to the model.
 *  · `ok` with `data.ui_directive` — the block, schema-checked;
 *  · `refused('item_not_in_model')` — the id is not an item of the saved model (or names the decision, which has no card note);
 *  · `refused('note_empty' | 'note_too_long')` — strict schemas carry no length limits, so the adapter keeps the contract's;
 *  · `refused('one_note_per_turn')` — the canvas shows one directive per turn;
 *  · `unavailable` — the saved model could not be read.
 */
import { z } from 'zod-v4';
import { UiDirectiveBlockSchema } from '@talchain/schemas/boundary';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import { isSavedRead, readSaved } from './context-tool.js';
import { ok, refused, type ToolOutcome } from './outcome.js';
import type { RunDeps } from './run-tool.js';

export const NOTE_ON_ITEM = 'note_on_item';
export const NOTE_MAX = 140;
export const NoteOnItemParams = z.object({
  /** The id of one factor, option, goal, risk, outcome or link in the saved model, as read_canonical_context returns it. */
  item_id: z.string(),
  /** One short sentence for the user, said beside that item. */
  note: z.string(),
}).strict();
export type NoteOnItemArgs = z.infer<typeof NoteOnItemParams>;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);
const NODE_KINDS = new Set(['factor', 'option', 'goal', 'risk', 'constraint', 'outcome']);

export async function noteOnItem(deps: Pick<RunDeps, 'dispatch'>, ctx: Pick<AgentToolContext, 'scenario_id'>, args: NoteOnItemArgs,
  turn: { notes: number }): Promise<ToolOutcome> {
  const note = args.note.trim();
  if (note === '') return refused('note_empty');
  if (note.length > NOTE_MAX) return refused('note_too_long', undefined, { max: NOTE_MAX, length: note.length });
  if (turn.notes > 0) return refused('one_note_per_turn');
  const saved = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(saved)) return saved.status === 'refused' ? refused('item_not_in_model') : saved;
  const node = recs(saved.graph.nodes).find((n) => n.id === args.item_id);
  const edge = node === undefined ? recs(saved.graph.edges).find((e) => e.id === args.item_id) : undefined;
  const label = (r: Rec | undefined, key: string): string => (typeof r?.[key] === 'string' ? (r[key] as string).trim() : '');
  const target = node !== undefined && NODE_KINDS.has(String(node.kind)) && label(node, 'label') !== ''
    ? { id: args.item_id, label: label(node, 'label'), kind: String(node.kind) }
    : edge !== undefined
      ? { id: args.item_id, label: `${label(nodeById(saved.graph, edge.from), 'label') || String(edge.from)} → ${label(nodeById(saved.graph, edge.to), 'label') || String(edge.to)}`, kind: 'edge' }
      : null;
  if (target === null) return refused('item_not_in_model');
  const block = UiDirectiveBlockSchema.safeParse({ type: 'ui_directive', verb: 'highlight', targets: [target], note, source: 'composer' });
  if (!block.success) return refused('item_not_in_model');
  turn.notes += 1;
  return ok({ ui_directive: block.data });
}

function nodeById(graph: Rec, id: unknown): Rec | undefined {
  return recs(graph.nodes).find((n) => n.id === id);
}
