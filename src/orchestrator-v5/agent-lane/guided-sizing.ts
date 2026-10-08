import { createHash } from 'node:crypto';
import { readOptionResultSources, GOAL_FIGURES_CHANCE_AS_GOAL, GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_PRODUCT_NOT_READ, GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../orchestrator/context/option-result-source.js';
import { isPlaceholderLink, linkSizing } from '../../cee/magnitude/link-sizing.js';
import { convertingOlumiEstimate, goalOrderedLinks, scoredGoalIdOf, targetTestabilityOf, untestableTargetTail, type TargetTestability } from '../admission/target-testability.js';
import { GOAL_CHANCE_RANGE, goalChanceRangeOf } from '../goal-target/goal-chance-range.js';
import { linkEffectEndUnits } from '../system-events/link-effect-edit.js';
import type { SuggestedAction } from '../compose/types.js';
import { placeholderGoalWarning, unsizedLeaderGoalPaths } from './goal-certainty.js';

type Rec = Record<string, unknown>;
const record = (v: unknown): Rec | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const hasOlumiSize = (edge: unknown): boolean => {
  const sizing = linkSizing(edge);
  return sizing === 'olumi_estimate' || sizing === 'olumi_accepted';
};

/** Display/selection data only. No graph postimage, coefficients or executable operations. */
export interface GuidedSizingDraft {
  readonly v: 1;
  readonly total: number;
  /** Existing user-size recovery, from this same scoped verdict; internal words only, never a hook field. */
  readonly recovery_line?: string;
  /** Internal scored identity for conversion readers; omitted from the transport hook. */
  readonly scored_goal_id?: string;
  /** Same scoped target verdict as this draft; internal only, never transported in the hook. */
  readonly target_verdict?: TargetTestability;
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
export interface GuidedSizing extends Omit<GuidedSizingDraft, 'links' | 'recovery_line' | 'scored_goal_id' | 'target_verdict'> {
  readonly graph_hash: string;
  readonly run_key: string;
  readonly links: readonly (GuidedSizingDraft['links'][number] & {
    readonly press: Pick<GuidedSizingAction, 'id' | 'parameters'>;
  })[];
  readonly remaining?: number;
  readonly progress_line?: string;
}

/** DL r14: ONE word producer, naming the same ordered placeholder pairs as the offers. */
export function guidedSizingSentence(draft: Pick<GuidedSizingDraft, 'total' | 'links'>, invite = true): string {
  const names = draft.links.filter(l => l.nonconverting !== true).slice(0, 3)
    .map(l => `how strongly ‘${l.from_label}’ affects ‘${l.to_label}’`);
  const named = names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return `The chance isn't shown yet: the model doesn't yet say ${named}${draft.total > 3 ? ` and ${draft.total - 3} more` : ''}, so any figure would be a guess.${invite
    ? ` Give a rough strength for ${draft.total === 1 ? 'it' : 'each'} to see the chance.` : ''}`;
}

/** Adapt retained GP prose without rewriting the factor labels inside it. */
export function withoutGuidedSizingJargon(words: string, labels: readonly string[] = []): string {
  const kept = ['‘[^’]*’', ...labels.filter(Boolean).sort((a, b) => b.length - a.length)
    .map(label => label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))];
  return words.split(new RegExp(`(${kept.join('|')})`, 'u')).map((part, i) => i % 2 === 1 ? part : part
    .replace(/\b(the|This|this|for \d+) (link|links)\b/gu, (_match, prefix: string, noun: string) => `${prefix} effect${noun === 'links' ? 's' : ''}`)
    .replace(/\bstand-ins\b/gu, 'rough strengths')).join('');
}

/** The warning reader alone establishes a legacy Run's sole-placeholder cause set before calling this helper. */
export function legacyGuidedSizingReplyText(draft: GuidedSizingDraft | undefined): string | null {
  return draft !== undefined && draft.total >= 1 ? guidedSizingSentence(draft) : null;
}

/** The consumer supplies a draft only when its complete cause set permits these words; other reasons are retained. */
export function withoutStaleGuidedSizingWords(words: string, draft: GuidedSizingDraft | undefined): string {
  if (draft !== undefined && draft.total >= 1) return words;
  // Read old persisted copy only to remove it; it is never produced again.
  return words.replace(/^(?:Not shown yet: \d+ links[^.]*\. Size them to see the chance\.|The chance isn't shown yet: [\s\S]*?, so any figure would be a guess\.(?: Give a rough strength for (?:it|each) to see the chance\.)?)\s*/u, '').trim();
}

/** The promise requires exactly this draft's placeholders to be the target's only remaining blockers. */
export function guidedSizingOnlyPlaceholders(draft: GuidedSizingDraft | undefined): boolean {
  const verdict = draft?.target_verdict;
  if (draft === undefined || draft.total < 1 || draft.links.some(l => l.nonconverting === true)
    || verdict?.kind !== 'not_testable' || verdict.failures.length === 0
    || verdict.failures.some(f => (f.precondition !== 'P5' && f.precondition !== 'P6') || f.code !== 'goal_path_placeholder')) return false;
  const key = (l: { from: string; to: string }): string => JSON.stringify([l.from, l.to]);
  const offered = new Set(draft.links.map(key));
  const failed = new Set(verdict.failures.flatMap(f => f.links ?? []).map(key));
  return offered.size === draft.total && failed.size === offered.size && [...failed].every(k => offered.has(k));
}

/** The exact GP words for this reply, from its one scoped draft and fresh progress read. */
export function guidedSizingReplyText(draft: GuidedSizingDraft | undefined,
  progress?: { readonly progress_line: string }, invite = guidedSizingOnlyPlaceholders(draft)): { progress: string | null; guided: string | null } {
  return {
    progress: progress?.progress_line ?? null,
    guided: draft !== undefined && draft.total >= 1 && draft.links.some(l => l.nonconverting !== true)
      ? [guidedSizingSentence(draft, invite), draft.recovery_line].filter(Boolean).join(' ') : null,
  };
}

/** N comes solely from ONE typed placeholder warning. The SAME case-(c) verdict supplies conversion carve-outs. */
export function guidedSizingFromWarning(warning: unknown, graph: unknown, identityEvaluations?: readonly unknown[],
  optionIds?: readonly string[], scoredGoalId?: unknown, wordsOnly = false): GuidedSizingDraft | undefined {
  const w = record(warning);
  if (w?.code !== GOAL_FIGURES_PLACEHOLDER_PATH && w?.code !== GOAL_FIGURES_TARGET_NOT_TESTABLE) return undefined;
  const links = (w.code === GOAL_FIGURES_PLACEHOLDER_PATH && Array.isArray(w.acceptable_links) ? w.acceptable_links : []).map(record);
  if (!links.every((l): l is Rec & { from: string; to: string } => l !== undefined
    && typeof l.from === 'string' && l.from !== '' && typeof l.to === 'string' && l.to !== '')) return undefined;
  const nodes = record(graph)?.nodes;
  const byId = new Map((Array.isArray(nodes) ? nodes.map(record).filter((n): n is Rec => n !== undefined) : []).map(n => [n.id, n]));
  // Legacy warnings retain factor labels in their recorded pair explanation, even without a graph.
  const recordedLabels = new Map<string, string>();
  const isNamedHeader = typeof w.message === 'string' && w.message.includes("The chance isn't shown yet:");
  const recordedPairs = !isNamedHeader && Array.isArray(w.links) ? w.links.map(record) : links;
  const namedPairs = typeof w.message === 'string' ? [...w.message.matchAll(/(?:from|how strongly) ‘([^’]+)’ (?:to|affects) ‘([^’]+)’/gu)] : [];
  namedPairs.forEach((pair, i) => {
    const ends = recordedPairs[i];
    if (typeof ends?.from === 'string' && typeof ends.to === 'string') {
      recordedLabels.set(ends.from, pair[1]!); recordedLabels.set(ends.to, pair[2]!);
    }
  });
  const label = (id: string): string => typeof byId.get(id)?.label === 'string' ? byId.get(id)!.label as string : recordedLabels.get(id) ?? id;
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
  const verdict = targetTestabilityOf(targetGraph, identityEvaluations, scoredGoalId);
  const carveouts = verdict.kind !== 'not_testable' ? [] : verdict.failures.filter(f => f.case === 'c').flatMap(f => f.links ?? [])
    .filter(l => hasOlumiSize(edgeFor(l)) && !convertingOlumiEstimate(edgeFor(l), graph, verdict.goal_id, identityEvaluations));
  if (placeholders.length < (wordsOnly ? 1 : 2) && carveouts.length === 0) return undefined;
  // A user-stated size that still cannot convert retains the established recovery, rather than Olumi attribution.
  const recovery = (() => {
    if (verdict.kind !== 'not_testable') return null;
    const failure = verdict.failures.find(f => f.case === 'c');
    const userLinks = (failure?.links ?? []).filter(l => linkSizing(edgeFor(l)) === 'user');
    const first = userLinks[0];
    return failure === undefined || first === undefined ? null : untestableTargetTail(graph, { ...verdict,
      failures: [{ ...failure, links: userLinks, link: first, lever: label(first.from), link_to: label(first.to) }] });
  })();
  // Existing reverse shortest-hop relaxation from goals; the optional tie rule preserves THIS warning's order.
  const ordered = [...goalOrderedLinks(graph, placeholders, true), ...goalOrderedLinks(graph, carveouts, true)];
  const goalId = verdict.kind === 'no_goal' ? undefined : verdict.goal_id;
  return { v: 1, total: placeholders.length, target_verdict: verdict, ...(goalId !== undefined ? { scored_goal_id: goalId } : {}),
    ...(recovery !== null ? { recovery_line: withoutGuidedSizingJargon(recovery,
      [...byId.values()].flatMap(n => typeof n.label === 'string' ? [n.label] : [])) } : {}),
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

/** The selected Run's scored identity is shared with its licence and later conversion checks. */
function scoredGoalIdForRun(result: unknown, graph: unknown): string | undefined {
  const r = record(result);
  const enrichment = record(r?.enrichment);
  const warnings = enrichment?.inference_warnings ?? r?.inference_warnings;
  const licence = (Array.isArray(warnings) ? warnings.map(record) : []).find(w => w?.code === 'GOAL_CHANCE_LICENSED');
  return scoredGoalIdOf(graph, record(r?.input_snapshot)?.goal_node_id ?? licence?.goal_node_id
    ?? r?.goal_node_id ?? enrichment?.goal_node_id);
}

export function guidedSizingForRun(result: unknown, graph: unknown, wordsOnly = false): GuidedSizingDraft | undefined {
  const r = record(result);
  const warnings = record(r?.enrichment)?.inference_warnings ?? r?.inference_warnings;
  if (!Array.isArray(warnings)) return undefined;
  // The words reader's dominant gates still own the reply and prohibit sizing offers.
  if (warnings.some(w => [GOAL_FIGURES_CHANCE_AS_GOAL, GOAL_FIGURES_PRODUCT_NOT_READ].includes(String(record(w)?.code)))) return undefined;
  const evaluations = r?.identity_evaluations ?? record(r?.enrichment)?.identity_evaluations;
  const warning = warnings.find(w => record(w)?.code === GOAL_FIGURES_PLACEHOLDER_PATH)
    ?? warnings.find(w => record(w)?.code === GOAL_FIGURES_TARGET_NOT_TESTABLE);
  return guidedSizingFromWarning(warning, graph, Array.isArray(evaluations) ? evaluations : undefined,
    scoredOptionIdsForRun(result, warning), scoredGoalIdForRun(result, graph), wordsOnly);
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
  // When the offered pairs exhaust an unconfirmed identity's links, the original target requirement must own
  // the reply. Its existing words survive; a sizing list cannot stand in for confirming that identity.
  const offeredPairs = new Set(sizing.links.map(l => JSON.stringify([l.from, l.to])));
  if (sizing.target_verdict?.kind === 'not_testable' && sizing.target_verdict.failures.some(f =>
    f.code === 'identity_unconfirmed' && f.links !== undefined && f.links.length > 0
    && f.links.every(l => offeredPairs.has(JSON.stringify([l.from, l.to]))))) return [];
  return sizing.links.flatMap(l => {
    const matches = edges.map(record).filter(e => l.id !== undefined ? e?.id === l.id && e.from === l.from && e.to === l.to : e?.from === l.from && e.to === l.to);
    // The selected warning can predate a size: ask only for the SAME held, still-unsized edge.
    if (matches.length !== 1 || (l.nonconverting === true
      ? !hasOlumiSize(matches[0]) || convertingOlumiEstimate(matches[0], graph, sizing.scored_goal_id ?? scoredGoalIdOf(graph))
      : !isPlaceholderLink(matches[0]))) return [];
    const ends = l.nonconverting === true ? linkEffectEndUnits(graph, l.from, l.to) : null;
    const unit = ends?.target.own[0] ?? ends?.target.adopted;
    if (l.nonconverting === true && unit === undefined) return [];
    const label = l.nonconverting === true
      ? `How much does ‘${l.from_label}’ change ‘${l.to_label}’, in ${unit}?${NONCONVERTING_REASON}`
      : `How strongly does ‘${l.from_label}’ affect ‘${l.to_label}’?`;
    const pressId = `${PRESS_PREFIX}${encodeURIComponent(l.from)}:${encodeURIComponent(l.to)}`;
    // The existing chip discriminator records the directed pair in every completed press's request hash.
    // Resolve against the same unique held edge above; a matching display label cannot close another edge.
    const pressDigest = createHash('sha256').update(`chip:${JSON.stringify([pressId, null])}`).digest('hex').slice(0, 32);
    if (history.some(row => typeof row !== 'string' && row.request_hash?.endsWith(`#chip:${pressDigest}`))) return [];
    // Labels in a legacy question or receipt record no historical endpoint identity.
    // Renames and label reuse cannot close an edge; only the recorded chip pair above can.
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
  // A recorded Run scope owns M, including an explicitly empty scope. Legacy Runs
  // without a recorded scope retain the stored-graph progress used by the inspector.
  const options = (r !== undefined ? scoredOptionIdsForRun(run, warning) : undefined)
    ?? (Array.isArray(nodes) ? nodes.map(record) : []).filter(n => n?.kind === 'option')
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
  const goalId = scoredGoalIdForRun(run, graph);
  const heldGraph = record(graph);
  const scoredGraph = heldGraph !== undefined && goalId !== undefined ? { ...heldGraph, goal_node_id: goalId } : graph;
  const paths = unsizedLeaderGoalPaths(scoredGraph, options, evals, interventions.size > 0 ? interventions : undefined);
  // Same predicate AND same deduplicating warning producer as a Run's N; no stale-warning subtraction.
  const freshWarning = placeholderGoalWarning(graph, paths, GOAL_FIGURES_PLACEHOLDER_PATH);
  const draft = guidedSizingFromWarning(freshWarning, graph, evals, r !== undefined ? options : undefined, goalId);
  // The producer's range carrier attests that PLoT did not already withhold this option. Re-run G0 against the
  // authoritative post-commit graph and retained driver evidence; a stale carrier alone cannot promise a range.
  const rangeWarnings = Array.isArray(enrichment?.inference_warnings) ? enrichment.inference_warnings.map(record) : [];
  const rangeOptions = new Set(rangeWarnings.filter(w => w?.code === GOAL_CHANCE_RANGE)
    .flatMap(w => Object.keys(record(w?.range_by_option) ?? {})));
  const driversByOption = new Map<string, unknown>();
  for (const row of readOptionResultSources(enrichment ?? r ?? {}).flat()) {
    const id = typeof row.option_id === 'string' ? row.option_id : row.id;
    if (typeof id === 'string' && !driversByOption.has(id)) driversByOption.set(id, row.probability_of_goal_drivers);
  }
  const rangeEnvelope = { ...(enrichment ?? r ?? {}), ...(evals !== undefined ? { identity_evaluations: evals } : {}) };
  const showsRange = guidedSizingOnlyPlaceholders(draft) && options.some(id => rangeOptions.has(id) && goalChanceRangeOf(rangeEnvelope, scoredGraph, id,
    { driversByOption, goalPaths: paths, plotWithheld: false, goalId }) !== null);
  return draft === undefined || draft.total < 2 ? undefined : { draft, remaining: draft.total,
    progress_line: `${draft.total} more to go${showsRange ? '; with 1 left, Olumi can show a range' : ''}.` };
}

export function guidedSizingProgressLine(graph: unknown, run?: unknown): string | null {
  return guidedSizingReplyText(undefined, guidedSizingProgress(graph, run)).progress;
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
  return { v: draft.v, total: draft.total, ...identity, links,
    ...(progress !== undefined ? { remaining: progress.remaining, progress_line: progress.progress_line } : {}) };
}
