import { asAnalysed } from '../../orchestrator/context/placeholder-parts.js';
import { validatedDefinitionForGraph } from '../goal-target/held-user-links.js';
import { readGoalRecord } from '../goal-target/goal-record.js';
import { factorValueHash, linkValueHash, valueAuthorshipOf, type GoalPathFactor, type GoalPathLink } from './turn-context/guidance-signals.js';
import { linkSizing } from '../../cee/magnitude/link-sizing.js';
import { olumiEstimatesFeedingResult } from './olumi-estimates-feeding-result.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;

/** RC4 alone supplies the attribution stored with this Run's licensed points (the one census below, its relationships). */
export function goalChanceEstimateLinkCount(graph: unknown, optionIds?: readonly string[], goalId?: unknown): number {
  return goalChanceEstimateCounts(graph, optionIds, goalId).links;
}

/**
 * ⭐ Recovery Batch C, amendment 7 (independent check r1 item 6): a result rests on EVERY Olumi input it is computed from, not
 * only its link sizes — an estimated starting value and an Olumi option setting count too. RC4's one census
 * (`olumiEstimatesFeedingResult`) counts them, apart, so the sentence can name them. Restricted to this Run's options.
 *
 * ⛔ RE-SCOPE 2 (DL 12 Oct, R5-1; re-scope check r2 BLOCKING 1 — the third round in a row that found one more input class
 * missing): ONE census definition. The inputs a chance rests on are, for EVERY node N that has a path to ANY node of the event
 * it MEASURES (the scored goal alone for the goal's own figure and range; the goal and every condition the Run sent for the
 * joint — `eventNodeIds`), the event nodes themselves and the scored goal included:
 *   (a) N's starting value — the scored goal's own too. The base of a RELATIVE change (`change_rel`) is said on its own by
 *       ruling 21 / amendment 7's `estimate_only` ("Using … as today's …", or Olumi's assumed starting value), so it is never
 *       counted a second time; only an UNVERIFIED base is still disclosed (below);
 *   (b) every setting of every option in this Run on N — on the scored goal too (r2 BLOCKING 1: a setting there was left out
 *       with the goal's own value) and the status quo's own too (said only on its own chance, like any option's);
 *   (c) every link into N. An option's own link to a node it sets IS that setting, counted once (as the setting).
 * A node with no starting value has no (a); an option cell with no figure sends nothing, so it is no (b).
 *
 * THREE PROVENANCE STATES, NEVER TWO (DL AMEND, AIE #94 6119326092 / R5 handback item 1): HUMAN only on positive attestation;
 * AI ORIGIN only for a recognised AI source; anything else — missing, unrecognised or contradictory — UNVERIFIED, which is never
 * counted as an Olumi estimate and never read as the person's (`inputOriginOf`, `settingOriginOf`). An unverified input is
 * disclosed once beside the result (the licence's note), and a census that cannot read the event whole (no readable graph,
 * no scored goal, or a node of the event outside the analysed view) is `unread`: it can attest no complete census, so it is
 * never "zero estimates" either.
 */
export interface GoalChanceEstimateCounts {
  readonly links: number;
  readonly values: number;
  /** An option setting is that option's own input: counted per option, never said on another option's result. */
  readonly settingsByOption: Readonly<Record<string, number>>;
  /** R5-2 (internal, never persisted): starting values whose origin is unverified — neither Olumi's nor the person's. */
  readonly unverifiedValues: number;
  /** R5-2 (internal): each option's own settings whose origin is unverified (no structural marker). */
  readonly unverifiedSettingsByOption: Readonly<Record<string, number>>;
  /** R5-2 (internal): the census could not read the event whole — never "zero estimates". */
  readonly unread: boolean;
}

/** HUMAN by positive attestation: the person's own source stamps (`InterventionV3.source`'s human members, cee-v3.ts; the same
 * membership as `obligation-provenance.ts` `INTERVENTION_SOURCE` → `user_stated`). */
const HUMAN_SOURCES: ReadonlySet<string> = new Set(['user_specified', 'brief_extraction']);
/** AI ORIGIN: the recognised AI sources only (DL AMEND / AIE R5 item 1). Mere absence from the human set is NOT AI origin. */
const AI_SOURCES: ReadonlySet<string> = new Set(['cee_hypothesis', 'domain_knowledge', 'cee_inference']);

export type InputOrigin = 'human' | 'ai' | 'ai_accepted' | 'unverified';

/**
 * A starting value's origin, by the one existing reader (`valueAuthorshipOf`, F1: its extraction type and the user-material
 * receipt are the finer instruments). Where that reader cannot decide only because a stamp DEFERS to an extraction type that is
 * not there, the recognised stamp itself decides (human: `brief_extraction`, `user_specified`; AI: `cee_inference`,
 * `cee_hypothesis`, `domain_knowledge`); unverified user material, an unrecognised or a missing stamp stays UNVERIFIED. An
 * accepted Olumi estimate keeps its origin, apart from its acceptance (`ai_accepted`, read as before).
 */
export function inputOriginOf(observed: unknown): InputOrigin {
  const f1 = valueAuthorshipOf(observed);
  if (f1 === 'yours') return 'human';
  if (f1 === 'olumi_estimate') return 'ai';
  if (f1 === 'olumi_accepted') return 'ai_accepted';
  const os = rec(observed);
  if (os === undefined || os.user_material_unverified === true || os.extractionType !== undefined) return 'unverified';
  // The existing source-bound writer of a share-by-date team share (`team-share-write.ts` `teamObservedState`,
  // `event-by-date-model.ts` `withEventShareDate`): its value is the completion share COMPUTED from the person's own stated
  // team time, held beside it as `stated_time` ("a team-time answer is held as time"); the `cee_inference` stamp marks the
  // computation, not an estimate of the time — Olumi's own estimates there (hiring time, pace) are said by the share's words.
  if (rec(os.stated_time)?.quantity === 'months_to_finish') return 'human';
  if (typeof os.source !== 'string') return 'unverified';
  return HUMAN_SOURCES.has(os.source) ? 'human' : AI_SOURCES.has(os.source) ? 'ai' : 'unverified';
}

const cellFigure = (cell: unknown): number | undefined => {
  const v = typeof cell === 'number' ? cell : rec(cell)?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

/**
 * ⛔ THE ONE NAMED STRUCTURAL MARKER for a sourceless option cell: THE EVENT-BY-DATE SWITCH. `admitEventByDate`
 * (`event-by-date-model.ts`) writes `{ value: 1 }` on each option's own switch and `{ value: 0 }` on every other — no `source`:
 * the option turning the switch on IS what the switch means. Its marker is the switch node's own
 * `observed_state.extra_share_by_date` (the record `unresolvedEventOptionIds` reads), and only a 0 or a 1 is that definition.
 * Derived 12 Oct at e58b8dbd: the only other sourceless cells are a generic patch and a bare level stored before the source
 * stamp — both unverified.
 */
export function isEventByDateSwitchCell(cell: unknown, target: unknown): boolean {
  const v = cellFigure(cell);
  return (v === 0 || v === 1) && rec(rec(rec(target)?.observed_state)?.extra_share_by_date) !== undefined;
}

/**
 * The same marker on the switch node's OWN starting value: `admitEventByDate` writes `{ value: 0, source: 'cee_inference',
 * extra_share_by_date }` — "this option is not adding capacity today", the switch's definition, never an estimate of a
 * level (its pace and lead time are said by the share's own estimate words). Only the 0 under that marker is structural.
 */
export function isEventByDateSwitchValue(node: unknown): boolean {
  const os = rec(rec(node)?.observed_state);
  return os !== undefined && os.value === 0 && rec(os.extra_share_by_date) !== undefined;
}

/**
 * An option cell's origin. HUMAN only on a human stamp that nothing contradicts (`estimate: true` is Olumi's draft-widening
 * level, "never user-authored": a human stamp beside it is contradictory, so UNVERIFIED); AI only on a recognised AI stamp;
 * the event-by-date switch is structural; anything else — missing, unrecognised (a legacy `user`: derived 12 Oct, no production
 * writer stamps it on a cell) — is UNVERIFIED.
 */
export function settingOriginOf(cell: unknown, target: unknown): 'human' | 'ai' | 'unverified' | 'structural' {
  const source = rec(cell)?.source;
  if (typeof source === 'string') {
    if (HUMAN_SOURCES.has(source)) return rec(cell)?.estimate === true ? 'unverified' : 'human';
    return AI_SOURCES.has(source) ? 'ai' : 'unverified';
  }
  return isEventByDateSwitchCell(cell, target) ? 'structural' : 'unverified';
}

const NONE: GoalChanceEstimateCounts = { links: 0, values: 0, settingsByOption: {}, unverifiedValues: 0, unverifiedSettingsByOption: {}, unread: false };
const UNREAD: GoalChanceEstimateCounts = { ...NONE, unread: true };

export function goalChanceEstimateCounts(graph: unknown, optionIds?: readonly string[], goalId?: unknown,
  eventNodeIds: readonly string[] = [],
  /** A MARGINAL measures one condition alone: its event is that condition, without the scored goal (DL AMEND item 3). */
  opts: { readonly scoredInEvent?: boolean } = {}): GoalChanceEstimateCounts {
  const stored = rec(graph);
  if (stored === undefined || !Array.isArray(stored.nodes)) return UNREAD;
  const omitted = new Set(stored.nodes.map(rec).filter(n => n?.kind === 'option'
    && optionIds !== undefined && !optionIds.includes(String(n.id))).map(n => n!.id));
  const analysed = asAnalysed({ ...stored, nodes: stored.nodes.filter(n => !omitted.has(rec(n)?.id)),
    edges: Array.isArray(stored.edges) ? stored.edges.filter(e => !omitted.has(rec(e)?.from) && !omitted.has(rec(e)?.to)) : stored.edges });
  const nodes = analysed.nodes.map(rec).filter((n): n is Rec => n !== undefined && typeof n.id === 'string');
  const byId = new Map(nodes.map(n => [n.id as string, n] as const));
  const edges = (Array.isArray(analysed.edges) ? analysed.edges : []).map(rec)
    .filter((e): e is Rec => e !== undefined && typeof e.from === 'string' && typeof e.to === 'string' && byId.has(e.from) && byId.has(e.to));
  // The scored goal, as before (this Run's goal when given, else the first goal), and every other node of the event.
  const goals = nodes.filter(n => n.kind === 'goal');
  const scored = (typeof goalId === 'string' ? goals.find(n => n.id === goalId) : undefined) ?? goals[0];
  // R5-2: a node of the event this view does not hold (unresolved, or left out of the analysed view) is never read as "none".
  if (scored === undefined || eventNodeIds.some(id => !byId.has(id))) return UNREAD;
  const event = [...new Set([...(opts.scoredInEvent === false ? [] : [scored.id as string]), ...eventNodeIds])];
  if (event.length === 0) return UNREAD;
  // Everything upstream of the event, by any path (reverse breadth-first; the distance orders RC4's examples only).
  const distance = new Map<string, number>(event.map(id => [id, 0]));
  const into = new Map<string, string[]>();
  for (const e of edges) (into.get(e.to as string) ?? into.set(e.to as string, []).get(e.to as string)!).push(e.from as string);
  for (const queue = [...event]; queue.length > 0;) {
    const u = queue.shift()!;
    for (const v of into.get(u) ?? []) if (!distance.has(v)) { distance.set(v, distance.get(u)! + 1); queue.push(v); }
  }
  const labelOf = (id: string): string => (typeof byId.get(id)?.label === 'string' ? byId.get(id)!.label as string : id);
  const upstream = [...distance.keys()];
  // (a) Every starting value on the set — the scored goal's own too, except a relative change's base, which ruling 21 /
  // `estimate_only` say on their own (an unverified one is still disclosed).
  const originOf = new Map(upstream.map(id => [id, inputOriginOf(byId.get(id)!.observed_state)] as const));
  const relativeChange = readGoalRecord(stored, scored.id as string)?.target?.frame === 'change_rel';
  const baseSaidApart = (id: string): boolean => id === scored.id && relativeChange && originOf.get(id) !== 'unverified';
  const valued = upstream.filter(id => !baseSaidApart(id) && !isEventByDateSwitchValue(byId.get(id))
    && typeof rec(byId.get(id)!.observed_state)?.value === 'number'
    && Number.isFinite(rec(byId.get(id)!.observed_state)!.value));
  const RC4_AUTHORSHIP = { human: 'yours', ai: 'olumi_estimate', ai_accepted: 'olumi_accepted', unverified: 'unknown' } as const;
  const factors: GoalPathFactor[] = valued.map(id => ({ factor_id: id, label: labelOf(id),
    value_authorship: RC4_AUTHORSHIP[originOf.get(id)!], goal_distance: distance.get(id)!, value_hash: factorValueHash(byId.get(id)!) }));
  // (b) Every setting of every option in this Run on the set (the scored goal and the status quo included).
  const setsOf = (o: Rec): Rec => rec(o.interventions) ?? rec(rec(o.data)?.interventions) ?? {};
  const optionOf = new Map<string, string>();
  const ownSetting = new Set<string>();
  const unverifiedSettingsByOption: Record<string, number> = {};
  const settings = nodes.flatMap((o) => {
    if (o.kind !== 'option') return [];
    return Object.entries(setsOf(o)).flatMap(([nodeId, cell]) => {
      if (!distance.has(nodeId) || cellFigure(cell) === undefined) return [];
      ownSetting.add(`${o.id as string}->${nodeId}`);
      const whose = settingOriginOf(cell, byId.get(nodeId));
      if (whose === 'unverified') unverifiedSettingsByOption[o.id as string] = (unverifiedSettingsByOption[o.id as string] ?? 0) + 1;
      if (whose !== 'human' && whose !== 'ai') return [];
      const id = `${o.id as string}:${nodeId}`;
      optionOf.set(id, o.id as string);
      return [{ id, label: labelOf(nodeId), authorship: whose === 'ai' ? 'olumi_estimate' as const : 'user' as const }];
    });
  });
  // (c) Every link into the set; an option's own link to a node it sets is that setting (counted once, above).
  const links: GoalPathLink[] = edges.filter(e => distance.has(e.to as string) && !ownSetting.has(`${e.from as string}->${e.to as string}`)).map(e => ({
    link_id: `${e.from as string}->${e.to as string}`, from_label: labelOf(e.from as string), to_label: labelOf(e.to as string),
    link_sizing: linkSizing(e), option_ids: [], goal_distance: distance.get(e.to as string)! + 1, value_hash: linkValueHash(e) }));
  const census = olumiEstimatesFeedingResult({ validatedDefinitionForLink: validatedDefinitionForGraph(analysed),
    goalPathFactors: factors, goalPathLinks: links, optionSettings: settings });
  const valueIds = new Set(valued);
  const settingsByOption: Record<string, number> = {};
  for (const v of census.values) {
    const option = valueIds.has(v.id) ? undefined : optionOf.get(v.id);
    if (option !== undefined) settingsByOption[option] = (settingsByOption[option] ?? 0) + 1;
  }
  return { links: census.links.length, values: census.values.filter(v => valueIds.has(v.id)).length, settingsByOption,
    unverifiedValues: factors.filter(f => f.value_authorship === 'unknown').length, unverifiedSettingsByOption, unread: false };
}

/** The words the screen says a provisional point rests on: "1 starting value, 2 option settings and 3 relationships". */
export function olumiEstimateWords(counts: { readonly links?: number; readonly values?: number; readonly settings?: number }): string | undefined {
  const part = (n: number | undefined, one: string, many: string): string[] => (n !== undefined && n > 0 ? [`${n} ${n === 1 ? one : many}`] : []);
  const parts = [...part(counts.values, 'starting value', 'starting values'), ...part(counts.settings, 'option setting', 'option settings'),
    ...part(counts.links, 'relationship', 'relationships')];
  return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
