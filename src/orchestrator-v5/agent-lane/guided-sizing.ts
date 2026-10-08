import { GOAL_FIGURES_CHANCE_AS_GOAL, GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_PRODUCT_NOT_READ } from '../../orchestrator/context/option-result-source.js';
import { isPlaceholderLink } from '../../cee/magnitude/link-sizing.js';
import { goalOrderedLinks } from '../admission/target-testability.js';
import type { SuggestedAction } from '../compose/types.js';
import { placeholderGoalWarning, unsizedLeaderGoalPaths } from './goal-certainty.js';
import { withoutAskedQuestion } from './goal-chance-withheld.js';

type Rec = Record<string, unknown>;
const record = (v: unknown): Rec | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;

/** Display/selection data only. No graph postimage, coefficients or executable operations. */
export interface GuidedSizingDraft {
  readonly v: 1;
  readonly total: number;
  readonly links: readonly {
    readonly id?: string;
    readonly from: string; readonly to: string;
    readonly from_label: string; readonly to_label: string;
    /** Zero-based position, nearest the goal first; equal distances retain warning order. */
    readonly order: number;
  }[];
}

export type GuidedSizingAction = SuggestedAction & {
  readonly parameters: { readonly from: string; readonly to: string; readonly edge_id?: string };
};
export interface GuidedSizing extends Omit<GuidedSizingDraft, 'links'> {
  readonly graph_hash: string;
  readonly run_key: string;
  readonly links: readonly (GuidedSizingDraft['links'][number] & {
    readonly press: Pick<GuidedSizingAction, 'id' | 'parameters'>;
  })[];
  readonly remaining?: number;
  readonly progress_line?: string;
}

/** Science §(i) 4: the ONE multi-link sentence; never an estimate or a graph-derived count. */
export const guidedSizingSentence = (total: number): string =>
  `Not shown yet: ${total} links on the way to your goal have no size, so any figure would come from Olumi's stand-ins, not your model. Size them to see the chance.`;

/** N comes solely from ONE typed warning. The graph supplies labels and ordering, never membership/count. */
export function guidedSizingFromWarning(warning: unknown, graph: unknown): GuidedSizingDraft | undefined {
  const w = record(warning);
  if (w?.code !== GOAL_FIGURES_PLACEHOLDER_PATH || !Array.isArray(w.acceptable_links) || w.acceptable_links.length < 2) return undefined;
  const links = w.acceptable_links.map(record);
  if (!links.every((l): l is Rec & { from: string; to: string } => l !== undefined
    && typeof l.from === 'string' && l.from !== '' && typeof l.to === 'string' && l.to !== '')) return undefined;
  const nodes = record(graph)?.nodes;
  const byId = new Map((Array.isArray(nodes) ? nodes.map(record).filter((n): n is Rec => n !== undefined) : []).map(n => [n.id, n]));
  const label = (id: string): string => typeof byId.get(id)?.label === 'string' ? byId.get(id)!.label as string : id;
  // Existing reverse shortest-hop relaxation from goals; the optional tie rule preserves THIS warning's order.
  const ordered = goalOrderedLinks(graph, links, true);
  const edges = record(graph)?.edges;
  return { v: 1, total: links.length,
    links: ordered.map((l, order) => {
      const matches = (Array.isArray(edges) ? edges.map(record) : []).filter(e => e?.from === l.from && e.to === l.to);
      const id = matches.length === 1 && typeof matches[0]?.id === 'string' ? matches[0].id : undefined;
      return { ...l, ...(id !== undefined ? { id } : {}), from_label: label(l.from), to_label: label(l.to), order };
    }) };
}

export function guidedSizingForRun(result: unknown, graph: unknown): GuidedSizingDraft | undefined {
  const r = record(result);
  const warnings = record(r?.enrichment)?.inference_warnings ?? r?.inference_warnings;
  if (!Array.isArray(warnings)) return undefined;
  // The words reader's dominant gates still own the reply and prohibit sizing offers.
  if (warnings.some(w => [GOAL_FIGURES_CHANCE_AS_GOAL, GOAL_FIGURES_PRODUCT_NOT_READ].includes(String(record(w)?.code)))) return undefined;
  return guidedSizingFromWarning(warnings.find(w => record(w)?.code === GOAL_FIGURES_PLACEHOLDER_PATH), graph);
}

const PRESS_PREFIX = 'agent-size-link:';
/** DGAI 0.81.0's strict ActionSchema accepts no parameters. The hook alone carries inspector data. */
export function guidedSizingWireAction(action: SuggestedAction): SuggestedAction {
  return action.id.startsWith(PRESS_PREFIX)
    ? { id: action.id, label: action.label, message: action.message }
    : action;
}

/** The wire's final revision token is the only identity DGAI stores. No token means no hook. */
export function guidedSizingOnWire(sizing: GuidedSizing | undefined, graphHash: unknown): GuidedSizing | undefined {
  return sizing !== undefined && typeof graphHash === 'string' && /^[0-9a-f]{16}$/u.test(graphHash)
    ? { ...sizing, graph_hash: graphHash } : undefined;
}

/** An identity-bound prompt chip, using the existing Agent/selection/link-effect door, never a new action_type. */
export function parseGuidedSizingPress(value: unknown): { from: string; to: string; edge_id?: string } | null {
  const id = typeof value === 'string' ? value : record(value)?.id;
  if (typeof id !== 'string' || !id.startsWith(PRESS_PREFIX)) return null;
  const parts = id.slice(PRESS_PREFIX.length).split(':');
  if (parts.length !== 2) return null;
  try {
    const [from, to] = parts.map(decodeURIComponent);
    if (!from || !to) return null;
    const parameters = record(record(value)?.parameters);
    if (parameters !== undefined && (parameters.from !== from || parameters.to !== to)) return null;
    return { from, to, ...(typeof parameters?.edge_id === 'string' ? { edge_id: parameters.edge_id } : {}) };
  } catch { return null; }
}

export function guidedSizingActions(sizing: GuidedSizingDraft | undefined, graph: unknown, recentReplies: readonly string[] = []): GuidedSizingAction[] {
  const edges = record(graph)?.edges;
  if (sizing === undefined || !Array.isArray(edges)) return [];
  return sizing.links.flatMap(l => {
    const matches = edges.map(record).filter(e => l.id !== undefined ? e?.id === l.id && e.from === l.from && e.to === l.to : e?.from === l.from && e.to === l.to);
    // The selected warning can predate a size: ask only for the SAME held, still-unsized edge.
    if (matches.length !== 1 || !isPlaceholderLink(matches[0])) return [];
    const label = `How strongly does ‘${l.from_label}’ affect ‘${l.to_label}’?`;
    const legacy = `How much does ‘${l.from_label}’ change ‘${l.to_label}’?`;
    if (withoutAskedQuestion(label, recentReplies) === '' || withoutAskedQuestion(legacy, recentReplies) === '') return [];
    // FU-1's existing denial closes the ask without sizing the edge. Its receipt is the durable answer text.
    const stays = `Nothing is recorded: the link from “${l.from_label}” to “${l.to_label}” stays as it is.`;
    if (recentReplies.some(reply => reply.includes(stays))) return [];
    return [{ id: `${PRESS_PREFIX}${encodeURIComponent(l.from)}:${encodeURIComponent(l.to)}`, label, message: label,
      parameters: { from: l.from, to: l.to, ...(l.id !== undefined ? { edge_id: l.id } : {}) } }];
  });
}

/** M is produced afresh from the authoritative stored graph AFTER the existing door verifies its commit. */
export function guidedSizingProgress(graph: unknown): { draft: GuidedSizingDraft; remaining: number; progress_line: string } | undefined {
  const nodes = record(graph)?.nodes;
  const options = (Array.isArray(nodes) ? nodes.map(record) : []).filter(n => n?.kind === 'option')
    .flatMap(n => typeof n?.id === 'string' ? [n.id] : []);
  const paths = unsizedLeaderGoalPaths(graph, options);
  // Same predicate AND same deduplicating warning producer as a Run's N; no stale-warning subtraction.
  const warning = placeholderGoalWarning(graph, paths, GOAL_FIGURES_PLACEHOLDER_PATH);
  const draft = guidedSizingFromWarning(warning, graph);
  return draft === undefined ? undefined : { draft, remaining: draft.total,
    progress_line: `${draft.total} more to go; with 1 left, Olumi can show a range.` };
}

export function guidedSizingProgressLine(graph: unknown): string | null {
  return guidedSizingProgress(graph)?.progress_line ?? null;
}

/** Bind the actual offered presses, never regenerate them for the hook. Identity is the caller's stored read + Run. */
export function bindGuidedSizing(draft: GuidedSizingDraft | undefined, actions: readonly GuidedSizingAction[],
  identity: { graph_hash: string; run_key: string }, progress?: { remaining: number; progress_line: string }): GuidedSizing | undefined {
  if (draft === undefined || !identity.graph_hash || !identity.run_key) return undefined;
  const links = draft.links.flatMap(l => {
    const press = actions.find(a => l.id !== undefined ? a.parameters.edge_id === l.id
      : a.parameters.from === l.from && a.parameters.to === l.to);
    return press === undefined ? [] : [{ ...l, press: { id: press.id, parameters: press.parameters } }];
  });
  return { ...draft, ...identity, links, ...(progress !== undefined ? { remaining: progress.remaining, progress_line: progress.progress_line } : {}) };
}
