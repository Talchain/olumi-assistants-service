/**
 * ⭐ "WHAT WOULD CHANGE THIS?" — RC-WHAT-CHANGES answered from MEASURED tipping points (SCIENCE ROBUSTNESS, EXPERIMENT;
 * SCIENCE/DSK, programme-docs #85 lease 5950283606; DL ruling 5948081549; HARNESS leased the route hunk 5950400056).
 *
 * Today the "What would change the result?" press is a free Agent turn. This turn answers it with NO model call:
 *   press → `assembleGuidanceSignals` (the ONE signal derivation, explicit request RC-WHAT-CHANGES) → on a current Run
 *   with a licensed leader, the plan's goal-path links → `dispatchDecisionFlip` (the Run's own payload, top-2 links,
 *   ISL's licensed tipping points, strict-parsed) → RC's link copy per link → the reply.
 * Anything that is not a measured answer is RC's honest limit (`method_turns.RC-WHAT-CHANGES.honest_limit`), never a
 * figure, never "nothing would change" — including a PLoT/ISL timeout (DL condition 4).
 *
 * THE WORDS ARE RC'S. `LINK_COPY` / the fraction ladder are `method_turns.RC-WHAT-CHANGES.link_tipping_points_copy`
 * at RC @a4992165, verbatim; a row binds them to that contract's bytes (`__tests__/fixtures/`). The guidance JSON
 * re-pin to ≥ a4992165 is HARNESS's (it also carries COMPARISON-ANSWER); after it, these read `POLICY` instead.
 *
 * PURE except `ask` (injected). Never throws for a model reason: an unread model or a refused Run is a reply.
 */

import type { SuggestedAction } from '../../compose/types.js';
import { leaderLicenceFromState } from '../../compose/leader-licence.js';
import type { DecisionFlipDispatchResult, FlipLinkRef } from '../../handlers/decision-flip-dispatch.js';
import { selectGuidance } from '../guidance/index.js';
import { POLICY } from '../guidance/policy.js';
import { cut, midSentence } from '../guidance/render.js';
import { assembleGuidanceSignals, type GuidanceSignals as TurnSignals } from '../turn-context/guidance-signals.js';
import { itemRefOf } from '../turn-context/guidance-wire.js';
import { selectorSignalsOf, TALK_IT_THROUGH_CHIP, type MethodReadback } from './method-turn.js';

export const WHAT_CHANGES_PRESS_ID = 'agent-next-what-would-change';
const METHOD = 'RC-WHAT-CHANGES' as const;

export function isWhatChangesPress(chipId: unknown): boolean {
  return chipId === WHAT_CHANGES_PRESS_ID;
}

/** RC @a4992165 `method_turns.RC-WHAT-CHANGES.link_tipping_points_copy`, verbatim (bound by a fixture row). */
export const LINK_COPY = {
  quoted: "{other} would come out ahead if {from}'s effect on {to} fell below about {fraction} of what it is now.",
  below_a_tenth: "{other} would come out ahead only if {from}'s effect on {to} all but disappeared.",
  no_change: '{leader} would still lead even if {from} had no effect on {to}.',
} as const;

/** The ladder, largest first. {fraction} = the LARGEST value <= ratio (rounded DOWN: always a sufficient condition). */
export const FRACTION_LADDER: ReadonlyArray<readonly [number, string]> = [
  [0.9, 'nine tenths'], [0.8, 'four fifths'], [0.75, 'three quarters'], [2 / 3, 'two thirds'], [0.6, 'three fifths'],
  [0.5, 'half'], [0.4, 'two fifths'], [1 / 3, 'a third'], [0.25, 'a quarter'], [0.2, 'a fifth'], [0.1, 'a tenth'],
];

/** RC's fraction rule: null = absent (no claim) for a ratio >= 1, non-finite, or current 0; 'below_a_tenth' under 0.1. */
export function fractionOf(threshold: number, current: number): string | 'below_a_tenth' | null {
  if (!Number.isFinite(threshold) || !Number.isFinite(current) || current === 0) return null;
  const ratio = Math.abs(threshold) / Math.abs(current);
  if (!Number.isFinite(ratio) || ratio >= 1) return null;
  if (ratio < 0.1) return 'below_a_tenth';
  return FRACTION_LADDER.find(([value]) => value <= ratio)?.[1] ?? null;
}

/** The parsed block's link entries this turn reads (a structural subset of `DecisionFlipLinkV1`). */
interface FlipLink {
  readonly from_id: string;
  readonly to_id: string;
  readonly status: string;
  readonly threshold: number | null;
  readonly current_mean: number;
  readonly to_option_id: string | null;
}

export interface LinkLabels {
  readonly node: Readonly<Record<string, string>>;
  readonly option: Readonly<Record<string, string>>;
  readonly leaderId: string;
}

const optionQuote = (label: string): string => `‘${cut(label)}’`;
const fill = (template: string, slots: Readonly<Record<string, string>>): string =>
  template.replace(/\{(\w+)\}/g, (_m, k: string) => slots[k] ?? `{${k}}`);

/**
 * RC's sentence per link, or nothing: an absent link is silent, and a label that is unavailable is never invented
 * (the link goes silent instead). Option labels are quoted and keep their case; node labels follow the mid-sentence rule.
 */
export function renderLinkTippingPoints(links: readonly FlipLink[], labels: LinkLabels): string[] {
  const out: string[] = [];
  const leader = labels.option[labels.leaderId];
  for (const link of links) {
    const from = labels.node[link.from_id];
    const to = labels.node[link.to_id];
    if (from === undefined || to === undefined) continue;
    const nodeSlots = { from: midSentence(cut(from)), to: midSentence(cut(to)) };
    if (link.status === 'no_change') {
      if (leader !== undefined) out.push(fill(LINK_COPY.no_change, { ...nodeSlots, leader: optionQuote(leader) }));
      continue;
    }
    if (link.status !== 'quoted' || link.threshold === null || link.to_option_id === null) continue;
    const other = labels.option[link.to_option_id];
    const fraction = fractionOf(link.threshold, link.current_mean);
    if (other === undefined || fraction === null) continue;
    out.push(fraction === 'below_a_tenth'
      ? fill(LINK_COPY.below_a_tenth, { ...nodeSlots, other: optionQuote(other) })
      : fill(LINK_COPY.quoted, { ...nodeSlots, other: optionQuote(other), fraction }));
  }
  return out;
}

const nodeLabelsOf = (graph: unknown): Record<string, string> => {
  const nodes = (graph as { nodes?: unknown } | null)?.nodes;
  const out: Record<string, string> = {};
  for (const n of Array.isArray(nodes) ? nodes : []) {
    const node = n as { id?: unknown; label?: unknown };
    if (typeof node.id === 'string' && typeof node.label === 'string' && node.label.trim().length > 0) out[node.id] = node.label;
  }
  return out;
};

/** RC's honest limit, rendered (`honest_limit.text` + `item_label`); with no item, its first sentence only. */
export function honestLimitReply(s: TurnSignals, graph: unknown): string {
  const contract = POLICY.method_turns[METHOD].honest_limit;
  const [first] = contract.text.split(/(?<=\.)\s+/);
  const selection = selectGuidance(selectorSignalsOf(s, null), {});
  const ref = itemRefOf(selection.item, graph);
  const labels = nodeLabelsOf(graph);
  const itemLabel = ref === undefined ? undefined
    : ref.kind === 'link'
      ? labels[ref.from_id] !== undefined && labels[ref.to_id] !== undefined
        ? `how much ${midSentence(cut(labels[ref.from_id]!))} affects ${midSentence(cut(labels[ref.to_id]!))}` : undefined
      : labels[ref.factor_id] !== undefined ? `the figure for ${midSentence(cut(labels[ref.factor_id]!))}` : undefined;
  return itemLabel === undefined ? first! : fill(contract.text, { item_label: itemLabel });
}

/** Sentences this turn owns outside RC's two contracts. RC owns their wording too; flagged on the lease for RC. */
export const WHAT_CHANGES_REPLY = {
  model_unread: 'I can’t check what would change this result right now because I couldn’t read your model. Try again in a moment.',
  stale: 'Your model has changed since its last analysis, so I can’t say what would change that result. Run the analysis again, then ask.',
} as const;

export interface WhatChangesTurn {
  readonly reply: string;
  /** Telemetry only: which answer this was. */
  readonly outcome: 'measured' | 'honest_limit' | 'stale' | 'model_unread';
  readonly actions: readonly SuggestedAction[];
}

export type AskDecisionFlip = (candidateLinks: readonly FlipLinkRef[]) => Promise<DecisionFlipDispatchResult>;

/**
 * The turn for a "What would change the result?" press, or null when the request carries no such press (a recognised
 * press is always answered here, never handed to the Agent as an ordinary turn).
 */
export async function whatChangesTurnFor(chipId: unknown, rb: MethodReadback, ask: AskDecisionFlip): Promise<WhatChangesTurn | null> {
  if (!isWhatChangesPress(chipId)) return null;
  const actions = [TALK_IT_THROUGH_CHIP];
  if (rb.graph === undefined || rb.graph === null) return { reply: WHAT_CHANGES_REPLY.model_unread, outcome: 'model_unread', actions };
  const s = assembleGuidanceSignals({
    offeredSpecific: [],
    graph: rb.graph,
    analysisState: rb.analysisState,
    analysisResult: rb.analysisResult,
    optionParticipation: rb.optionParticipation,
    ...(rb.identityEvaluated !== undefined
      ? { identityEvaluations: [...rb.identityEvaluated].map((node_id) => ({ node_id, evaluated: true })) } : {}),
    leaderLicensed: leaderLicenceFromState(rb.analysisState, rb.analysisReady) !== 'withheld',
    request: 'method',
    explicitRequest: METHOD,
  });
  const honest = (): WhatChangesTurn => ({ reply: honestLimitReply(s, rb.graph), outcome: 'honest_limit', actions });
  const leaderId = s['run.leader_option_id'];
  // Only a CURRENT Run with a licensed leader has a recommendation whose tipping points mean anything.
  if (s['run.kind'] !== 'complete_current' || s['run.leader_licensed'] !== true || leaderId === null) return honest();
  const candidates: FlipLinkRef[] = [...s['model.goal_path_links']]
    .sort((a, b) => a.goal_distance - b.goal_distance)
    .flatMap((l) => {
      const ref = itemRefOf(l.link_id, rb.graph);
      return ref?.kind === 'link' ? [{ from_id: ref.from_id, to_id: ref.to_id }] : [];
    });
  if (candidates.length === 0) return honest();
  let result: DecisionFlipDispatchResult;
  try {
    result = await ask(candidates);
  } catch {
    return honest(); // the fetch is an answer or the honest limit, never a failed turn
  }
  if (result.status === 'stale') return { reply: WHAT_CHANGES_REPLY.stale, outcome: 'stale', actions };
  if (result.status !== 'measured') return honest();
  if (result.block.leader_option_id !== leaderId) return honest(); // never tipping points about another leader
  const sentences = renderLinkTippingPoints(result.block.links, {
    node: nodeLabelsOf(rb.graph), option: s['model.option_labels'], leaderId,
  });
  return sentences.length === 0 ? honest() : { reply: sentences.join(' '), outcome: 'measured', actions };
}
