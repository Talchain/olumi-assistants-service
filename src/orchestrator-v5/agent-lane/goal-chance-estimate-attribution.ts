import { asAnalysed, holdsTodaysLevel } from '../../orchestrator/context/placeholder-parts.js';
import { validatedDefinitionForGraph } from '../goal-target/held-user-links.js';
import { readGoalRecord } from '../goal-target/goal-record.js';
import { factorValueHash, linkValueHash, type GoalPathFactor, type GoalPathLink } from './turn-context/guidance-signals.js';
import { linkSizing } from '../../cee/magnitude/link-sizing.js';
import {
  inputOriginOf, isEventByDateSwitchCell, isEventByDateSwitchValue, isUnverifiedProvenance, linkProvenanceOf, settingProvenanceOf,
  type InputOrigin,
} from '../../cee/provenance/provenance-of.js';
import { olumiEstimatesFeedingResult, type OlumiEstimates } from './olumi-estimates-feeding-result.js';
import { EventRiskV1 } from '../../schemas/event-risk.js';
import { computeResponseHash } from '../../utils/response-hash.js';
import { likelyRangeUseOf, type LikelyRangeUse } from '../intervention-range.js';

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
  /** ONE PROVENANCE AUTHORITY (internal): starting values that are Olumi's estimates the person ACCEPTED — not counted as
   *  estimates, said apart (the panel's "you accepted" line reads the same rule). */
  readonly acceptedValues: number;
  /** AIE 6121121310 (internal): links whose SIZE has no established origin (an unmarked link that is not structural and
   *  not a brief link stated with its evidence) — never Olumi's wholesale, never dropped: disclosed like any unverified input. */
  readonly unverifiedLinks: number;
  /** ONE PROVENANCE AUTHORITY (internal): links whose size is Olumi's estimate the person ACCEPTED (`olumi_accepted`) —
   *  acceptance is not authorship: still Olumi's, so the result resting on them is provisional (DL 12 Oct, BLOCKING 3). */
  readonly acceptedLinks: number;
  /** C2 join (internal): each option's settings on the set that carry a `likely_range`, which the analysis reads with Olumi's
   *  equal-tail approximation (`likelyRangeUseOf`): the result rests on that approximation too, so it is provisional and says so. */
  readonly likelyRangesByOption?: Readonly<Record<string, readonly LikelyRangeUse[]>>;
}

/**
 * ⭐⭐ ONE PROVENANCE AUTHORITY (DL 12 Oct): the three-origin rule this census introduced (R5-1/R5-2) now lives in
 * `cee/provenance/provenance-of.ts` — every reader of the same value, setting or link asks it, so the panel, the receipts,
 * the compact labels and the readiness ladder agree with this count (`provenance-agreement.test.ts`). Re-exported here.
 */
export { inputOriginOf, isEventByDateSwitchCell, isEventByDateSwitchValue, type InputOrigin };

/** An option cell's origin in this census's words (the authority's `settingProvenanceOf`). */
export function settingOriginOf(cell: unknown, target: unknown): 'human' | 'ai' | 'unverified' | 'structural' {
  const p = settingProvenanceOf(cell, target);
  // A cell that is the person's by its stamp alone (`stampOnly`) is disclosed as unverified: labelled, never withheld.
  return p.structural ? 'structural' : isUnverifiedProvenance(p) || p.stampOnly === true ? 'unverified' : p.origin === 'human' ? 'human' : 'ai';
}

const cellFigure = (cell: unknown): number | undefined => {
  const v = typeof cell === 'number' ? cell : rec(cell)?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

const NONE: GoalChanceEstimateCounts = { links: 0, values: 0, settingsByOption: {}, unverifiedValues: 0, unverifiedSettingsByOption: {}, unread: false,
  acceptedValues: 0, unverifiedLinks: 0, acceptedLinks: 0 };
const UNREAD: GoalChanceEstimateCounts = { ...NONE, unread: true };

export function goalChanceEstimateCounts(graph: unknown, optionIds?: readonly string[], goalId?: unknown,
  eventNodeIds: readonly string[] = [],
  /** A MARGINAL measures one condition alone: its event is that condition, without the scored goal (DL AMEND item 3). */
  opts: { readonly scoredInEvent?: boolean } = {}): GoalChanceEstimateCounts {
  return goalChanceEstimateCensus(graph, optionIds, goalId, eventNodeIds, opts).counts;
}

/**
 * ⭐ ONE CENSUS FOR THE FACE AND THE PANEL (DL 12 Oct, BLOCKING 4): the counts the chance face says AND the Check-estimates
 * panel's own items (`estimates`, the feeder's result over the SAME inputs), so the panel can never list fewer figures than
 * the face names. `estimates` is null when the census cannot read the event (`unread`).
 */
export function goalChanceEstimateCensus(graph: unknown, optionIds?: readonly string[], goalId?: unknown,
  eventNodeIds: readonly string[] = [],
  opts: { readonly scoredInEvent?: boolean } = {}): { readonly counts: GoalChanceEstimateCounts; readonly estimates: OlumiEstimates | null } {
  const UNREAD_CENSUS = { counts: UNREAD, estimates: null };
  const stored = rec(graph);
  if (stored === undefined || !Array.isArray(stored.nodes)) return UNREAD_CENSUS;
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
  if (scored === undefined || eventNodeIds.some(id => !byId.has(id))) return UNREAD_CENSUS;
  const event = [...new Set([...(opts.scoredInEvent === false ? [] : [scored.id as string]), ...eventNodeIds])];
  if (event.length === 0) return UNREAD_CENSUS;
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
  // ⭐ (a′) A risk's occurrence that is OLUMI'S range (`event_risk.occurrence.basis: 'olumi'`, written only by its approved card,
  // `risk-occurrence.ts`) is a starting value Olumi estimated: counted on the face and listed on the panel alike (DL 14 Oct:
  // the chance says it rests on that estimate too). Approval applied it; the basis stays Olumi's, so it is never "accepted".
  const occurrences = upstream.filter(id => !valued.includes(id) && byId.get(id)!.kind === 'risk'
    && EventRiskV1.safeParse(byId.get(id)!.event_risk).data?.occurrence.basis === 'olumi');
  for (const id of occurrences) {
    factors.push({ factor_id: id, label: labelOf(id), value_authorship: 'olumi_estimate', goal_distance: distance.get(id)!,
      value_hash: computeResponseHash({ event_risk: byId.get(id)!.event_risk }) });
  }
  // (b) Every setting of every option in this Run on the set (the scored goal and the status quo included; a baseline cell
  // that holds today's level is today's figure, not a setting).
  const setsOf = (o: Rec): Rec => rec(o.interventions) ?? rec(rec(o.data)?.interventions) ?? {};
  const optionOf = new Map<string, string>();
  const ownSetting = new Set<string>();
  const unverifiedSettingsByOption: Record<string, number> = {};
  const likelyRangesByOption: Record<string, LikelyRangeUse[]> = {};
  const settings = nodes.flatMap((o) => {
    if (o.kind !== 'option') return [];
    return Object.entries(setsOf(o)).flatMap(([nodeId, cell]) => {
      if (!distance.has(nodeId) || cellFigure(cell) === undefined) return [];
      ownSetting.add(`${o.id as string}->${nodeId}`);
      // RC4 (the old panel walk's rule, now in the ONE census so the face and the panel count alike): a BASELINE option's cell
      // that holds today's level mirrors today's figure, which the node's own starting value already counts — never a
      // setting Olumi filled, whatever its stamp.
      if (o.is_baseline === true && holdsTodaysLevel(cell, byId.get(nodeId))) return [];
      // C2 join: a likely range on this setting is read with Olumi's equal-tail approximation, whoever gave its ends.
      const range = likelyRangeUseOf(nodeId, cell);
      if (range !== undefined) (likelyRangesByOption[o.id as string] ??= []).push(range);
      const whose = settingOriginOf(cell, byId.get(nodeId));
      if (whose === 'unverified') unverifiedSettingsByOption[o.id as string] = (unverifiedSettingsByOption[o.id as string] ?? 0) + 1;
      if (whose !== 'human' && whose !== 'ai') return [];
      const id = `${o.id as string}:${nodeId}`;
      optionOf.set(id, o.id as string);
      // The panel's own words for a setting ("<factor> under <option>"); the face counts it, the panel lists it.
      const optionLabel = typeof o.label === 'string' && o.label !== '' ? o.label : o.id as string;
      return [{ id, label: `${labelOf(nodeId)} under ${optionLabel}`, authorship: whose === 'ai' ? 'olumi_estimate' as const : 'user' as const }];
    });
  });
  // (c) Every link into the set; an option's own link to a node it sets is that setting (counted once, above).
  const inSet = edges.filter(e => distance.has(e.to as string) && !ownSetting.has(`${e.from as string}->${e.to as string}`));
  const links: GoalPathLink[] = inSet.map(e => ({
    link_id: `${e.from as string}->${e.to as string}`, from_label: labelOf(e.from as string), to_label: labelOf(e.to as string),
    link_sizing: linkSizing(e), option_ids: [], goal_distance: distance.get(e.to as string)! + 1, value_hash: linkValueHash(e) }));
  const validatedDefinitionForLink = validatedDefinitionForGraph(analysed);
  // AIE 6121121310: a link whose size has no established origin is disclosed, never dropped (`linkProvenanceOf`).
  const unverifiedLinks = inSet.filter(e => isUnverifiedProvenance(linkProvenanceOf(e, { fromKind: byId.get(e.from as string)?.kind,
    validatedDefinition: validatedDefinitionForLink(`${e.from as string}->${e.to as string}`) !== undefined }))).length;
  const census = olumiEstimatesFeedingResult({ validatedDefinitionForLink,
    goalPathFactors: factors, goalPathLinks: links, optionSettings: settings });
  const valueIds = new Set([...valued, ...occurrences]);
  const settingsByOption: Record<string, number> = {};
  for (const v of census.values) {
    const option = valueIds.has(v.id) ? undefined : optionOf.get(v.id);
    if (option !== undefined) settingsByOption[option] = (settingsByOption[option] ?? 0) + 1;
  }
  const counts: GoalChanceEstimateCounts = { links: census.links.length, values: census.values.filter(v => valueIds.has(v.id)).length,
    settingsByOption, unverifiedValues: factors.filter(f => f.value_authorship === 'unknown').length, unverifiedSettingsByOption,
    unread: false, acceptedValues: factors.filter(f => f.value_authorship === 'olumi_accepted').length, unverifiedLinks,
    acceptedLinks: links.filter(l => l.link_sizing === 'olumi_accepted').length,
    ...(Object.keys(likelyRangesByOption).length > 0 ? { likelyRangesByOption } : {}) };
  return { counts, estimates: census };
}

/** The words the screen says a provisional point rests on: "1 starting value, 2 option settings and 3 relationships". */
export function olumiEstimateWords(counts: { readonly links?: number; readonly values?: number; readonly settings?: number }): string | undefined {
  const part = (n: number | undefined, one: string, many: string): string[] => (n !== undefined && n > 0 ? [`${n} ${n === 1 ? one : many}`] : []);
  const parts = [...part(counts.values, 'starting value', 'starting values'), ...part(counts.settings, 'option setting', 'option settings'),
    ...part(counts.links, 'relationship', 'relationships')];
  return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
