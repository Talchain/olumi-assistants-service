/**
 * ⭐ PATH-B: OLUMI'S NOTE ON ONE ITEM (DL ruling, 21 Oct 2026; Paul 20 Oct: the AI is part of the canvas). The AI points at
 * ONE item of the saved model and says one short thing beside it: a question, a challenge or what is missing. The note is
 * the existing `ui_directive` block (`highlight`, one target, `note` ≤ 140, `source: 'composer'`), which the canvas shows
 * beside the item as Olumi's. It writes nothing to the model.
 *  · `ok` with `data.ui_directive` (the block, schema-checked) and `data.graph_identity` (identity.v1 of the model it was read
 *    on, labels included: the route ships the note only while the saved model is still that model);
 *  · `refused('item_not_in_model')` — the id is neither a card nor a living-model link of the saved model (the decision has
 *    no card note). A link's note sits on the card where the link starts (or ends), the only place the canvas can show it;
 *  · `refused('note_empty' | 'note_too_long')` — strict schemas carry no length limits, so the adapter keeps the contract's;
 *  · `refused('item_id_ambiguous')` — the id names both a card and a link of the saved model;
 *  · `refused('note_ranks_options')` — "best", "recommend", "winner", "go with": Olumi never chooses for the person;
 *  · `refused('note_names_an_id')` — an item's id in the note (egress would rewrite it to its label, past the limit);
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
  /** The id of one factor, option, goal, risk or outcome, or of one link, in the saved model, as read_canonical_context returns it. */
  item_id: z.string(),
  /** One short sentence for the user, said beside that item. */
  note: z.string(),
}).strict();
export type NoteOnItemArgs = z.infer<typeof NoteOnItemParams>;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);
/** The card kinds a note can sit beside (the decision is the question itself, never a card to note). */
export const NOTE_NODE_KINDS: ReadonlySet<string> = new Set(['factor', 'option', 'goal', 'risk', 'constraint', 'outcome']);
const NODE_KINDS = NOTE_NODE_KINDS;
const RANKS_OPTIONS = /\b(best|recommend\w*|winner|go with|should (?:choose|pick))\b/i;
const escape = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function noteOnItem(deps: Pick<RunDeps, 'dispatch'>, ctx: Pick<AgentToolContext, 'scenario_id'>, args: NoteOnItemArgs,
  turn: { notes: number }): Promise<ToolOutcome> {
  const note = args.note.trim();
  if (note === '') return refused('note_empty');
  if (note.length > NOTE_MAX) return refused('note_too_long', undefined, { max: NOTE_MAX, length: note.length });
  if (RANKS_OPTIONS.test(note)) return refused('note_ranks_options');
  if (turn.notes > 0) return refused('one_note_per_turn');
  const saved = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(saved)) return saved.status === 'refused' ? refused('item_not_in_model') : saved;
  if (saved.identity === null) return refused('item_not_in_model');
  const nodes = recs(saved.graph.nodes);
  const card = (id: unknown): Rec | undefined => {
    const n = nodes.find((x) => x.id === id);
    return n !== undefined && NODE_KINDS.has(String(n.kind)) && typeof n.label === 'string' && n.label.trim() !== '' ? n : undefined;
  };
  // A living-model link (`a link nobody has sized`) has no card of its own: its note sits on the card where it starts
  // (or, if that is not a card, where it ends), so the canvas can show it. An edge-only note would render nowhere.
  const link = isRec(saved.graph.living_model) ? recs(saved.graph.living_model.links).find((l) => l.id === args.item_id) : undefined;
  // One raw id can name both a card and a link: which one the AI meant is not ours to guess, so it is told and picks.
  if (link !== undefined && nodes.some((n) => n.id === args.item_id)) return refused('item_id_ambiguous');
  const node = card(args.item_id) ?? (link === undefined ? undefined : card(link.from) ?? card(link.to));
  if (node === undefined) return refused('item_not_in_model');
  const label = String(node.label).trim();
  // A machine-shaped id (`tech_lead`, `f2`), never a plain word that happens to be an id (`goal`): the route re-checks after egress.
  if (nodes.some((n) => typeof n.id === 'string' && /[_\d]/.test(n.id) && new RegExp(`\\b${escape(n.id)}\\b`).test(note))) return refused('note_names_an_id');
  const block = UiDirectiveBlockSchema.safeParse({ type: 'ui_directive', verb: 'highlight', targets: [{ id: String(node.id), label, kind: String(node.kind) }],
    note, source: 'composer' });
  if (!block.success) return refused('item_not_in_model');
  turn.notes += 1;
  return ok({ ui_directive: block.data, graph_identity: saved.identity, ...(link !== undefined ? { anchored_on: String(node.id), for_link: args.item_id } : {}) });
}
