import { createHash } from 'node:crypto';
import { readOptionResultSources, GOAL_FIGURES_CHANCE_AS_GOAL, GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_PRODUCT_NOT_READ, GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../orchestrator/context/option-result-source.js';
import { isPlaceholderLink } from '../../cee/magnitude/link-sizing.js';
import { convertingOlumiEstimate, goalOrderedLinks, targetTestabilityOf } from '../admission/target-testability.js';
import { linkEffectEndUnits } from '../system-events/link-effect-edit.js';
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
    /** Science §(i) carve-out: a held size that case (c) still cannot convert, after placeholders. */
    readonly nonconverting?: true;
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

/** N comes solely from ONE typed placeholder warning. The SAME case-(c) verdict supplies conversion carve-outs. */
export function guidedSizingFromWarning(warning: unknown, graph: unknown, identityEvaluations?: readonly unknown[],
  optionIds?: readonly string[]): GuidedSizingDraft | undefined {
  const w = record(warning);
  if (w?.code !== GOAL_FIGURES_PLACEHOLDER_PATH && w?.code !== GOAL_FIGURES_TARGET_NOT_TESTABLE) return undefined;
  const links = (w.code === GOAL_FIGURES_PLACEHOLDER_PATH && Array.isArray(w.acceptable_links) ? w.acceptable_links : []).map(record);
  if (!links.every((l): l is Rec & { from: string; to: string } => l !== undefined
    && typeof l.from === 'string' && l.from !== '' && typeof l.to === 'string' && l.to !== '')) return undefined;
  const nodes = record(graph)?.nodes;
  const byId = new Map((Array.isArray(nodes) ? nodes.map(record).filter((n): n is Rec => n !== undefined) : []).map(n => [n.id, n]));
  const label = (id: string): string => typeof byId.get(id)?.label === 'string' ? byId.get(id)!.label as string : id;
  const edges = record(graph)?.edges;
  const edgeFor = (l: { from: string; to: string }): Rec | undefined =>
    (Array.isArray(edges) ? edges.map(record) : []).find(e => e?.from === l.from && e.to === l.to);
  const placeholders = graph === undefined ? links : links.filter(l => isPlaceholderLink(edgeFor(l)));
  // The conversion carve-out is part of this Run's same guided list, so excluded options cannot add asks.
  // Reuse case (c)'s reader on its selected option scope; the stored graph itself is never changed.
  const heldGraph = record(graph);
  const scope = optionIds === undefined ? undefined : new Set(optionIds);
  const targetGraph = heldGraph !== undefined && Array.isArray(nodes) && scope !== undefined
    ? { ...heldGraph, nodes: nodes.filter(n => record(n)?.kind !== 'option' || scope.has(String(record(n)?.id))) }
    : graph;
  const verdict = targetTestabilityOf(targetGraph, identityEvaluations);
  const carveouts = verdict.kind !== 'not_testable' ? [] : verdict.failures.filter(f => f.case === 'c').flatMap(f => f.links ?? [])
    .filter(l => edgeFor(l) !== undefined && !isPlaceholderLink(edgeFor(l)) && !convertingOlumiEstimate(edgeFor(l), graph));
  if (placeholders.length < 2 && carveouts.length === 0) return undefined;
  // Existing reverse shortest-hop relaxation from goals; the optional tie rule preserves THIS warning's order.
  const ordered = [...goalOrderedLinks(graph, placeholders, true), ...goalOrderedLinks(graph, carveouts, true)];
  return { v: 1, total: placeholders.length,
    links: ordered.map((l, order) => {
      const matches = (Array.isArray(edges) ? edges.map(record) : []).filter(e => e?.from === l.from && e.to === l.to);
      const id = matches.length === 1 && typeof matches[0]?.id === 'string' ? matches[0].id : undefined;
      return { ...l, ...(id !== undefined ? { id } : {}), from_label: label(l.from), to_label: label(l.to), order,
        ...(order >= placeholders.length ? { nonconverting: true as const } : {}) };
    }) };
}

/** The selected Run's scored rows own the scope; a legacy warning retains its producer's recorded option ids. */
function scoredOptionIdsForRun(result: unknown, warning: unknown): string[] | undefined {
  const r = record(result);
  if (r === undefined) return undefined;
  const scored = readOptionResultSources(record(r.enrichment) ?? r).flat().flatMap(row => {
    const id = typeof row.option_id === 'string' ? row.option_id : row.id;
    return typeof id === 'string' && id !== '' ? [id] : [];
  });
  const recorded = record(warning)?.option_ids;
  return scored.length > 0 ? [...new Set(scored)] : Array.isArray(recorded)
    ? [...new Set(recorded.filter((id): id is string => typeof id === 'string'))] : undefined;
}

export function guidedSizingForRun(result: unknown, graph: unknown): GuidedSizingDraft | undefined {
  const r = record(result);
  const warnings = record(r?.enrichment)?.inference_warnings ?? r?.inference_warnings;
  if (!Array.isArray(warnings)) return undefined;
  // The words reader's dominant gates still own the reply and prohibit sizing offers.
  if (warnings.some(w => [GOAL_FIGURES_CHANCE_AS_GOAL, GOAL_FIGURES_PRODUCT_NOT_READ].includes(String(record(w)?.code)))) return undefined;
  const evaluations = r?.identity_evaluations ?? record(r?.enrichment)?.identity_evaluations;
  const warning = warnings.find(w => record(w)?.code === GOAL_FIGURES_PLACEHOLDER_PATH)
    ?? warnings.find(w => record(w)?.code === GOAL_FIGURES_TARGET_NOT_TESTABLE);
  return guidedSizingFromWarning(warning, graph, Array.isArray(evaluations) ? evaluations : undefined,
    scoredOptionIdsForRun(result, warning));
}

const PRESS_PREFIX = 'agent-size-link:';
const NONCONVERTING_REASON = " Olumi has it as a band, which can't be turned into your goal's units.";
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

/** Existing answer rows bind a sizing press durably in request_hash; no labels serve as identity. */
export type GuidedSizingHistory = string | { readonly request_hash?: string | null; readonly assistant_message?: string | null };
export function guidedSizingActions(sizing: GuidedSizingDraft | undefined, graph: unknown, history: readonly GuidedSizingHistory[] = []): GuidedSizingAction[] {
  const edges = record(graph)?.edges;
  if (sizing === undefined || !Array.isArray(edges)) return [];
  const recentReplies = history.flatMap(row => typeof row === 'string' ? [row]
    : typeof row.assistant_message === 'string' ? [row.assistant_message] : []);
  const nodes = record(graph)?.nodes;
  const uniqueLabelId = (label: string): string | undefined => {
    const matches = (Array.isArray(nodes) ? nodes.map(record) : []).filter(n => n?.label === label);
    return matches.length === 1 && typeof matches[0]?.id === 'string' ? matches[0].id : undefined;
  };
  return sizing.links.flatMap(l => {
    const matches = edges.map(record).filter(e => l.id !== undefined ? e?.id === l.id && e.from === l.from && e.to === l.to : e?.from === l.from && e.to === l.to);
    // The selected warning can predate a size: ask only for the SAME held, still-unsized edge.
    if (matches.length !== 1 || (l.nonconverting === true
      ? isPlaceholderLink(matches[0]) || convertingOlumiEstimate(matches[0], graph)
      : !isPlaceholderLink(matches[0]))) return [];
    const ends = l.nonconverting === true ? linkEffectEndUnits(graph, l.from, l.to) : null;
    const unit = ends?.target.own[0] ?? ends?.target.adopted;
    if (l.nonconverting === true && unit === undefined) return [];
    const label = l.nonconverting === true
      ? `How much does ‘${l.from_label}’ change ‘${l.to_label}’, in ${unit}?${NONCONVERTING_REASON}`
      : `How strongly does ‘${l.from_label}’ affect ‘${l.to_label}’?`;
    const question = l.nonconverting === true ? label.slice(0, -NONCONVERTING_REASON.length) : label;
    const legacy = `How much does ‘${l.from_label}’ change ‘${l.to_label}’?`;
    const pressId = `${PRESS_PREFIX}${encodeURIComponent(l.from)}:${encodeURIComponent(l.to)}`;
    // The existing chip discriminator records the directed pair in every completed press's request hash.
    // Resolve against the same unique held edge above; a matching display label cannot close another edge.
    const pressDigest = createHash('sha256').update(`chip:${JSON.stringify([pressId, null])}`).digest('hex').slice(0, 32);
    if (history.some(row => typeof row !== 'string' && row.request_hash?.endsWith(`#chip:${pressDigest}`))) return [];
    // Pre-identity history is usable only when BOTH labels resolve to these exact stored endpoints.
    // An ambiguous legacy question or FU-1 receipt closes no edge; its remaining controls stay available.
    const legacyIsThisEdge = uniqueLabelId(l.from_label) === l.from && uniqueLabelId(l.to_label) === l.to;
    if (legacyIsThisEdge && (withoutAskedQuestion(question, recentReplies) === '' || withoutAskedQuestion(legacy, recentReplies) === '')) return [];
    const stays = `Nothing is recorded: the link from “${l.from_label}” to “${l.to_label}” stays as it is.`;
    if (legacyIsThisEdge && recentReplies.some(reply => reply.includes(stays))) return [];
    return [{ id: pressId, label, message: label,
      parameters: { from: l.from, to: l.to, ...(l.id !== undefined ? { edge_id: l.id } : {}) } }];
  });
}

/** The existing never-reask reader takes questions ending in '?', not a press's following explanation. */
export function guidedSizingQuestions(sizing: GuidedSizingDraft | undefined, graph: unknown): string[] {
  return guidedSizingActions(sizing, graph).map(a => a.label.endsWith(NONCONVERTING_REASON)
    ? a.label.slice(0, -NONCONVERTING_REASON.length) : a.label);
}

/** M is produced afresh from the authoritative stored graph AFTER the existing door verifies its commit. */
export function guidedSizingProgress(graph: unknown, run?: unknown): { draft: GuidedSizingDraft; remaining: number; progress_line: string } | undefined {
  const nodes = record(graph)?.nodes;
  const r = record(run);
  const enrichment = record(r?.enrichment);
  const warning = (Array.isArray(enrichment?.inference_warnings) ? enrichment.inference_warnings : []).map(record)
    .find(w => w?.code === GOAL_FIGURES_PLACEHOLDER_PATH);
  // A selected Run owns M's option scope, just as it owned N. Never include excluded stored options.
  const options = r !== undefined ? scoredOptionIdsForRun(run, warning) ?? []
    : (Array.isArray(nodes) ? nodes.map(record) : []).filter(n => n?.kind === 'option')
      .flatMap(n => typeof n?.id === 'string' ? [n.id] : []);
  const evaluations = r?.identity_evaluations ?? enrichment?.identity_evaluations;
  const snapshot = record(r?.input_snapshot);
  const snapshotOptions = Array.isArray(snapshot?.options) ? snapshot.options.map(record) : [];
  const interventions = new Map(snapshotOptions.flatMap(o => {
    const id = o?.option_id ?? o?.id;
    const settings = Array.isArray(o?.settings) ? o.settings.map(record) : [];
    const held: Rec = Object.fromEntries(settings.flatMap(setting => typeof setting?.factor_id === 'string'
      && typeof setting.encoded === 'number' ? [[setting.factor_id, { value: setting.encoded,
        ...(typeof setting.raw === 'number' ? { raw_value: setting.raw } : {}) }]] : []));
    return typeof id === 'string' ? [[id, held] as const] : [];
  }));
  const evals = Array.isArray(evaluations) ? evaluations : undefined;
  const paths = unsizedLeaderGoalPaths(graph, options, evals, interventions.size > 0 ? interventions : undefined);
  // Same predicate AND same deduplicating warning producer as a Run's N; no stale-warning subtraction.
  const freshWarning = placeholderGoalWarning(graph, paths, GOAL_FIGURES_PLACEHOLDER_PATH);
  const draft = guidedSizingFromWarning(freshWarning, graph, evals, r !== undefined ? options : undefined);
  return draft === undefined || draft.total < 2 ? undefined : { draft, remaining: draft.total,
    progress_line: `${draft.total} more to go; with 1 left, Olumi can show a range.` };
}

export function guidedSizingProgressLine(graph: unknown, run?: unknown): string | null {
  return guidedSizingProgress(graph, run)?.progress_line ?? null;
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
