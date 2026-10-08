/** EVENT-RISK door 1: one existing event, one held conversion, no expected-loss double count. */
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import type { OlumiResponse, HeldProposalBlock } from '@talchain/schemas/boundary';
import type { PatchOperation } from '../../orchestrator/types.js';
import { EventRiskV1 } from '../../schemas/event-risk.js';
import { resolveMagnitudeFrame, sizeLink, unitOf, type MagnitudeNode } from '../../cee/magnitude/link-effect.js';
import { GM_HELD_USER_EVENT_RISK_KEY, readStatedEventRisk, type UserEventRisk } from '../routing/stated-event-risk.js';
import { eventRiskCardLine, eventRiskLikelihoodWords } from '../agent-lane/stated-event-risk-draft.js';
import { sayFigureExactly } from '../agent-lane/say-figure.js';
import { TYPED_TRANSACTION_ENVELOPE_CAP, type FrameFreshness } from '../graph-management/types.js';
import type { PendingAction } from '../session/pending-action.js';
import { chipToBoundaryAction } from './add-option-dispatch.js';
import { evaluateEditGraphMutations, GM_HELD_OPERATIONS_MAX_JSON_CHARS, type EditGmChip } from './edit-graph-referee-gate.js';

type Rec = Record<string, unknown>;
type Node = Rec & { id: string; label: string; kind: string };
type Edge = Rec & { from: string; to: string };
const record = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const viewOf = (graph: unknown): { nodes: Node[]; edges: Edge[] } | undefined => {
  const g = record(graph);
  if (!Array.isArray(g?.nodes) || !Array.isArray(g?.edges)) return undefined;
  if (!g.nodes.every((n) => typeof record(n)?.id === 'string' && typeof record(n)?.label === 'string' && typeof record(n)?.kind === 'string')
    || !g.edges.every((e) => typeof record(e)?.from === 'string' && typeof record(e)?.to === 'string')) return undefined;
  return { nodes: g.nodes as Node[], edges: g.edges as Edge[] };
};
const STOP = new Set(['about', 'after', 'before', 'chance', 'chances', 'expected', 'from', 'into', 'likelihood', 'maybe', 'model', 'might', 'probability', 'risk', 'that', 'their', 'there', 'these', 'this', 'those', 'with', 'within', 'would', 'your']);
const words = (s: string): string[] => [...new Set((s.toLowerCase().match(/[\p{L}]{4,100}/gu) ?? []).filter((w) => !STOP.has(w)))];
/** Prefix stemming is symmetric and bounded by whole content words; a synonym alone cannot block a new event. */
const shared = (left: string, right: string): number => {
  const candidates = words(right);
  let count = 0;
  for (const word of words(left)) {
    const i = candidates.findIndex((candidate) => word.startsWith(candidate) || candidate.startsWith(word));
    if (i >= 0) { candidates.splice(i, 1); count += 1; }
  }
  return count;
};
const negative = (e: Edge): boolean => e.effect_direction === 'negative' || (finite(record(e.strength)?.mean) && (record(e.strength)!.mean as number) < 0);
const percent = (n: Node): number | undefined => {
  const os = record(n.observed_state);
  if (os?.unit !== '%') return undefined;
  const value = finite(os.raw_value) ? os.raw_value
    : finite(os.value) && (os.declared_scale === 'unit_interval' || os.cap === 100) ? os.value * 100 : undefined;
  return value !== undefined && value >= 0 && value <= 100 ? value : undefined;
};
const probabilityFactor = (n: Node): boolean => n.kind === 'factor' && /\b(?:probability|likelihood|chance)\b/i.test(n.label.replace(/_/g, ' '))
  && record(n.observed_state)?.unit === '%';

export interface SameModelledEvent {
  readonly existing_risk_id: string;
  readonly existing_risk_label: string;
  readonly existing_probability_factor_label?: string;
  readonly next: 'propose_risk_likelihood';
}

/** Prefer the drafted probability path over its duplicate event; uncertainty leaves the add door unchanged. */
export function detectSameModelledEvent(graph: unknown, label: string, targetId: string | undefined, userText: string): SameModelledEvent | undefined {
  const g = viewOf(graph);
  if (g === undefined || typeof label !== 'string' || typeof userText !== 'string') return undefined;
  const risks = g.nodes.filter((n) => n.kind === 'risk');
  const probabilityMatches = targetId === undefined ? [] : risks.flatMap((risk) => {
    if (!g.edges.some((e) => e.from === risk.id && e.to === targetId && negative(e))) return [];
    const incoming = g.edges.filter((e) => e.to === risk.id).map((e) => g.nodes.find((n) => n.id === e.from));
    return incoming.filter((n): n is Node => n !== undefined && probabilityFactor(n)
      && (shared(n.label, label) >= 2 || shared(n.label, userText) >= 2)).map((factor) => ({ risk, factor }));
  });
  if (probabilityMatches.length === 1) {
    const { risk, factor } = probabilityMatches[0]!;
    return { existing_risk_id: risk.id, existing_risk_label: risk.label, existing_probability_factor_label: factor.label, next: 'propose_risk_likelihood' };
  }
  // Two plausible existing events do not justify a deterministic refusal unless one is the drafted path above.
  const direct = risks.filter((n) => shared(n.label, label) >= 2);
  if (direct.length !== 1) return undefined;
  return { existing_risk_id: direct[0]!.id, existing_risk_label: direct[0]!.label, next: 'propose_risk_likelihood' };
}

export const GM_HELD_RISK_LIKELIHOOD_KEY = 'risk_likelihood_update';
const Id = z.string().min(1).max(100);
const NaturalEffect = z.object({ amount: z.number().finite(), amount_unit: z.string().min(1),
  per_source_change: z.literal(1), per_source_change_unit: z.literal('occurrence'),
  strength_mean: z.number().finite(), strength_mean_frame: z.literal('edge_strength') }).strict();
const RiskLikelihoodMemberSchema = z.object({
  version: z.literal(1), risk_id: Id,
  probability_factor_ids: z.array(Id).max(1),
  share_links: z.array(z.object({ from: Id, to: Id }).strict()).max(16),
  duplicate_risk_ids: z.array(Id).max(16),
  impact_path: z.enum(['ii', 'i', 'none']),
  effects: z.array(z.object({ from: Id, to: Id, strength: z.object({ mean: z.number().finite(), std: z.number().nonnegative().finite() }).strict(), natural_effect: NaturalEffect }).strict()).max(16),
  figure_choices: z.object({ drafted: z.string().min(1).max(300), stated: z.string().min(1).max(300) }).strict().optional(),
}).strict().refine((m) => new Set(m.probability_factor_ids).size === m.probability_factor_ids.length
  && new Set(m.duplicate_risk_ids).size === m.duplicate_risk_ids.length
  && (m.impact_path === 'ii' ? m.effects.length > 0 : m.effects.length === 0));
export type RiskLikelihoodMember = z.infer<typeof RiskLikelihoodMemberSchema>;
export function readRiskLikelihoodMember(raw: unknown): RiskLikelihoodMember | undefined {
  const parsed = RiskLikelihoodMemberSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

const userSizedPercent = (node: Node): number | undefined => {
  const source = record(node.observed_state)?.source;
  return ['brief_extraction', 'user_stated', 'user_specified'].includes(String(source)) ? percent(node) : undefined;
};
const shareFactor = (node: Node, probability: Node, risk: Node): boolean => node.kind === 'factor'
  && /\bshare\b/i.test(node.label.replace(/_/g, ' ')) && percent(node) !== undefined
  && Math.max(shared(node.label, probability.label), shared(node.label, risk.label)) >= 2;
const targetForShare = (share: Node, risk: Node, g: NonNullable<ReturnType<typeof viewOf>>): Node | undefined => {
  const targets = g.edges.filter((e) => e.from === risk.id && negative(e))
    .map((e) => g.nodes.find((n) => n.id === e.to && (n.kind === 'goal' || n.kind === 'outcome')))
    .filter((n): n is Node => n !== undefined && shared(share.label, n.label) >= 1);
  return targets.length === 1 ? targets[0] : undefined;
};

/** Science FIX-3: a stated link may replace only a share whose sole incident edge fed this event. */
const soleShareLink = (shareId: string, riskId: string, g: NonNullable<ReturnType<typeof viewOf>>): boolean => {
  const incident = g.edges.filter((edge) => edge.from === shareId || edge.to === shareId);
  return incident.length === 1 && incident[0]!.from === shareId && incident[0]!.to === riskId;
};
const removedShareIds = (member: RiskLikelihoodMember, g: NonNullable<ReturnType<typeof viewOf>>): string[] =>
  member.impact_path === 'ii' ? member.share_links.filter((link) => soleShareLink(link.from, member.risk_id, g)).map((link) => link.from) : [];

/** Use the estate's sizer on a binary occurrence. No old expected-money source frame survives this conversion. */
const conditionalEffect = (share: Node, risk: Node, target: Node): RiskLikelihoodMember['effects'][number] | undefined => {
  const pct = userSizedPercent(share);
  const os = record(target.observed_state);
  const targetView = { ...target, option_levels: [] } as unknown as MagnitudeNode;
  const frame = resolveMagnitudeFrame(targetView);
  const baseline = os?.source === 'cee_inference' || os?.extractionType === 'inferred' ? undefined
    : finite(os?.raw_value) ? os.raw_value : finite(os?.value) && frame !== undefined ? os.value * frame : undefined;
  if (pct === undefined || baseline === undefined || baseline <= 0 || frame === undefined || unitOf(targetView) === undefined) return undefined;
  const sourceView: MagnitudeNode = { label: risk.label, kind: 'risk', observed_state: { value: 0, raw_value: 0, unit: 'occurrence' }, option_levels: [] };
  const sized = sizeLink({ direction: 'negative', effect_amount: -baseline * pct / 100, effect_per_source_change: 1, user_stated: true }, sourceView, targetView);
  if (sized.outcome !== 'user_stated' || sized.natural_effect === undefined || Math.abs(sized.mean) > 1) return undefined;
  // The shared sizer calls a binary 0/1 source a "switch". Here that SAME unit move is one event occurrence,
  // not a controllable switch; keep the sized amount/strength and bind its unit to this door's event semantics.
  const parsed = NaturalEffect.safeParse({ ...sized.natural_effect, per_source_change_unit: 'occurrence' });
  return parsed.success ? { from: risk.id, to: target.id, strength: { mean: sized.mean, std: sized.std }, natural_effect: parsed.data } : undefined;
};

const sameJson = (a: unknown, b: unknown): boolean => isDeepStrictEqual(a, b);
const duplicateEvents = (risk: Node, probability: Node | undefined, g: NonNullable<ReturnType<typeof viewOf>>): Node[] => {
  if (probability === undefined) return [];
  const targets = g.edges.filter((e) => e.from === risk.id && negative(e)).map((e) => e.to);
  return g.nodes.filter((n) => n.kind === 'risk' && n.id !== risk.id && EventRiskV1.safeParse(n.event_risk).success
    && shared(n.label, probability.label) >= 2 && g.edges.some((e) => e.from === n.id && targets.includes(e.to) && negative(e)));
};
function checkedMember(operations: readonly PatchOperation[], raw: unknown, graph: unknown, stamped = false): RiskLikelihoodMember | undefined {
  const member = readRiskLikelihoodMember(raw);
  const g = viewOf(graph);
  if (member === undefined || g === undefined) return undefined;
  // Path (i) needs an identity-bound source stamp across readiness and Run. Until that exists, refuse even old holds.
  if (member.impact_path === 'i' || (member.share_links.length === 0 ? member.impact_path !== 'none'
    : member.impact_path !== 'ii' || member.effects.length !== member.share_links.length)) return undefined;
  const risk = g.nodes.find((n) => n.id === member.risk_id && n.kind === 'risk');
  const updates = operations.filter((o) => o.op === 'update_node' && o.path === member.risk_id);
  const marker = record(updates[0]?.value);
  if (risk === undefined || g.nodes.filter((n) => n.id === risk.id).length !== 1 || risk.relies_on !== undefined
    || updates.length !== 1 || marker?.label !== risk.label || marker.scale_frame !== 1
    || Object.keys(marker).some((k) => !['label', 'scale_frame', ...(stamped ? ['event_risk'] : [])].includes(k))) return undefined;
  const probability = member.probability_factor_ids.map((id) => g.nodes.find((n) => n.id === id));
  if (probability.some((n) => n === undefined || !probabilityFactor(n)
    || !g.edges.some((e) => e.from === n.id && e.to === risk.id)
    || g.edges.some((e) => e.from === n.id && e.to !== risk.id)
    || !operations.some((o) => o.op === 'remove_node' && o.path === n.id))) return undefined;
  for (const link of member.share_links) {
    const share = g.nodes.find((n) => n.id === link.from);
    if (link.to !== risk.id || probability[0] === undefined || share === undefined || !shareFactor(share, probability[0], risk)
      || !g.edges.some((e) => e.from === link.from && e.to === link.to)
      || !operations.some((o) => o.op === 'remove_edge' && o.path === `${link.from}::${link.to}`)) return undefined;
  }
  if (member.impact_path === 'ii') {
    const effects = member.share_links.map((link) => {
      const share = g.nodes.find((node) => node.id === link.from)!;
      const target = targetForShare(share, risk, g);
      return target === undefined ? undefined : conditionalEffect(share, risk, target);
    });
    // Each removed figure must survive on its own checked impact; repeated effects cannot conceal a lost share.
    if (effects.some((effect) => effect === undefined) || new Set(effects.map((effect) => effect!.to)).size !== effects.length
      || !sameJson(member.effects, effects)) return undefined;
  }
  for (const id of member.duplicate_risk_ids) {
    const duplicate = g.nodes.find((n) => n.id === id && n.kind === 'risk');
    if (duplicate === undefined || id === risk.id || !EventRiskV1.safeParse(duplicate.event_risk).success
      || probability[0] === undefined || shared(duplicate.label, probability[0].label) < 2
      || g.edges.some((e) => e.to === duplicate.id)
      || !g.edges.some((e) => e.from === duplicate.id && negative(e)
        && g.edges.some((kept) => kept.from === risk.id && kept.to === e.to && negative(kept)))
      || !operations.some((o) => o.op === 'remove_node' && o.path === id)) return undefined;
  }
  // ALL drivers must be part of this named conversion; an extra driver cannot hide inside a held occurrence.
  if (g.edges.some((e) => e.to === risk.id && !member.probability_factor_ids.includes(e.from)
    && !member.share_links.some((l) => l.from === e.from && l.to === e.to))) return undefined;
  const duplicateIds = duplicateEvents(risk, probability[0], g).map((n) => n.id).sort();
  if (!sameJson(duplicateIds, [...member.duplicate_risk_ids].sort())) return undefined;
  const expected = [
    `update_node:${risk.id}`,
    ...member.probability_factor_ids.map((id) => `remove_node:${id}`),
    ...member.share_links.map((link) => `remove_edge:${link.from}::${link.to}`),
    ...removedShareIds(member, g).map((id) => `remove_node:${id}`),
    ...member.duplicate_risk_ids.map((id) => `remove_node:${id}`),
    ...g.edges.filter((e) => e.from === risk.id).map((e) => `update_edge:${e.from}::${e.to}`),
  ].sort();
  if (!sameJson(expected, operations.map((op) => `${op.op}:${op.path}`).sort())) return undefined;
  for (const effect of member.effects) {
    const target = g.nodes.find((n) => n.id === effect.to);
    const share = member.share_links.map((l) => g.nodes.find((n) => n.id === l.from)).find((n) => n !== undefined && targetForShare(n, risk, g)?.id === effect.to);
    const op = operations.find((o) => o.op === 'update_edge' && o.path === `${effect.from}::${effect.to}`);
    if (effect.from !== risk.id || target === undefined || share === undefined || op === undefined
      || !sameJson(effect, conditionalEffect(share, risk, target)) || !sameJson(record(op.value)?.strength, effect.strength)
      || record(op.value)?.exists_probability !== 1) return undefined;
  }
  for (const edge of g.edges.filter((e) => e.from === risk.id)) {
    const effect = member.effects.find((e) => e.to === edge.to);
    const expectedStrength = effect?.strength;
    const value = record(operations.find((o) => o.op === 'update_edge' && o.path === `${edge.from}::${edge.to}`)!.value);
    if (value?.exists_probability !== 1 || !sameJson(value.strength, expectedStrength)
      || (!stamped && Object.keys(value).some((key) => !['strength', 'exists_probability'].includes(key)))) return undefined;
  }
  return member;
}

/** Pure pre-referee guard. Natural-effect provenance is held externally until after the referee. */
export function riskLikelihoodRefereeOperations(operations: readonly PatchOperation[], raw: unknown, graph: unknown): PatchOperation[] | undefined {
  if (raw === undefined) return [...operations];
  const member = checkedMember(operations, raw, graph);
  if (member === undefined) return undefined;
  // This typed host conversion changes the source from a money amount into binary occurrence. The producer never
  // receives permission to write frames: the SAME validated original marker is retained for the atomic host apply.
  return operations.map((op) => op.op === 'update_node' && op.path === member.risk_id
    ? { ...op, value: { label: record(op.value)!.label } } : op);
}

/** Exact identity-bound host stamp, in the SAME atomic apply as the removals and event occurrence. */
export function stampRiskLikelihoodImpact(operations: readonly PatchOperation[], raw: unknown, graph: unknown): PatchOperation[] | undefined {
  if (raw === undefined) return [...operations];
  const member = checkedMember(operations, raw, graph, true);
  const g = viewOf(graph);
  if (member === undefined || g === undefined) return undefined;
  return operations.map((o) => {
    const effect = member.effects.find((e) => o.op === 'update_edge' && o.path === `${e.from}::${e.to}`);
    if (effect === undefined) {
      if (member.probability_factor_ids.length === 0 || o.op !== 'update_edge') return o;
      // An old expected-money effect cannot describe a conditional event. Until sized, it is explicitly a placeholder.
      return { ...o, value: { ...record(o.value), defaulted: true, std_defaulted: true, exists_defaulted: false,
        provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } } };
    }
    const risk = g.nodes.find((node) => node.id === member.risk_id)!;
    const share = member.share_links.map((link) => g.nodes.find((node) => node.id === link.from))
      .find((node) => node !== undefined && targetForShare(node, risk, g)?.id === effect.to)!;
    return { ...o, value: { ...record(o.value), defaulted: false, std_defaulted: true, exists_defaulted: false,
      provenance: { source: record(share.observed_state)?.source === 'brief_extraction' ? 'brief_extraction' : 'user_specified',
        magnitude: 'user_stated', reading: 'agent_proposed_user_confirmed', natural_effect: effect.natural_effect } } };
  });
}

function conditionalEffectCopy(effect: RiskLikelihoodMember['effects'][number], member: RiskLikelihoodMember, g: NonNullable<ReturnType<typeof viewOf>>): { description: string; subject: string } {
  const risk = g.nodes.find((n) => n.id === member.risk_id)!;
  const share = member.share_links.map((l) => g.nodes.find((n) => n.id === l.from))
    .find((n) => n !== undefined && targetForShare(n, risk, g)?.id === effect.to)!;
  const target = g.nodes.find((n) => n.id === effect.to)!;
  const os = record(target.observed_state);
  const targetFrame = resolveMagnitudeFrame({ ...target, option_levels: [] } as unknown as MagnitudeNode)!;
  const baseline = finite(os?.raw_value) ? os.raw_value : (os!.value as number) * targetFrame;
  const loss = sayFigureExactly(Math.abs(effect.natural_effect.amount), effect.natural_effect.amount_unit)
    ?? `${Math.abs(effect.natural_effect.amount)} ${effect.natural_effect.amount_unit}`;
  const reference = sayFigureExactly(baseline, effect.natural_effect.amount_unit) ?? `${baseline} ${effect.natural_effect.amount_unit}`;
  return {
    description: `If it happens, ${target.label} falls by ${percent(share)}% at the model's current ${reference} reference (${loss}); this link carries that fixed loss.`,
    subject: `make the effect on ‘${target.label}’ a ${percent(share)}% loss if it happens`,
  };
}

/** Only a validated door-1 member may replace an impact op's generic numeric wording. */
export function riskLikelihoodImpactDescriptions(raw: unknown, operations: readonly PatchOperation[], graph: unknown): { path: string; description: string; subject?: string }[] | undefined {
  const member = checkedMember(operations, raw, graph);
  const g = viewOf(graph);
  if (member === undefined || g === undefined) return undefined;
  return operations.filter((op) => op.op === 'update_edge').map((op) => {
    const effect = member.effects.find((e) => op.path === `${e.from}::${e.to}`);
    if (effect !== undefined) return { path: op.path, ...conditionalEffectCopy(effect, member, g) };
    const edge = g.edges.find((e) => op.path === `${e.from}::${e.to}`)!;
    const target = g.nodes.find((n) => n.id === edge.to)!;
    const risk = g.nodes.find((n) => n.id === member.risk_id)!;
    return { path: op.path, description: member.probability_factor_ids.length > 0
      ? `Keep the impact on ‘${target.label}’ as a placeholder; the effect size is still needed before goal chances can use it.`
      : `Keep the impact link from ‘${risk.label}’ to ‘${target.label}’ conditional on this event happening.` };
  });
}

/** Card detail is rebuilt from the persisted ids and graph, never arbitrary stored prose. */
export function riskLikelihoodCardLines(raw: unknown, operations: readonly PatchOperation[], graph: unknown, userEventRisk?: UserEventRisk): string[] {
  const member = checkedMember(operations, raw, graph);
  const g = viewOf(graph);
  if (member === undefined || g === undefined) return [];
  const label = (id: string): string => g.nodes.find((n) => n.id === id)!.label;
  const lines = member.probability_factor_ids.map((id) => `‘${label(id)}’ becomes this risk's likelihood, so it's removed as a separate factor.`);
  const removedShares = new Set(removedShareIds(member, g));
  for (const link of member.share_links) {
    if (removedShares.has(link.from)) {
      const share = g.nodes.find((node) => node.id === link.from)!;
      lines.push(`Remove the link from ‘${label(link.from)}’ to ‘${label(link.to)}’.`,
        `‘${label(link.from)}’: its ${percent(share)}% is now the size of the loss on the link, so it's removed as a separate factor.`);
    } else lines.push(`Remove the link from ‘${label(link.from)}’ to ‘${label(link.to)}’; the share remains the size of the loss if it happens.`);
  }
  for (const id of member.duplicate_risk_ids) lines.push(`Merge ‘${label(id)}’ into ‘${label(member.risk_id)}’ and remove the duplicate risk.`);
  if (member.figure_choices !== undefined) lines.push(`Drafted from your brief: ${member.figure_choices.drafted}.`, `Just now: ${member.figure_choices.stated}.`);
  for (const effect of member.effects) {
    lines.push(conditionalEffectCopy(effect, member, g).description,
      "This assumes the whole contract is lost; if they'd only cut part of it, how much?");
  }
  if (member.impact_path === 'i') lines.push('The share is the size of the loss if it happens. Its impact link stays a placeholder; the effect size is still needed before goal chances can use it.');
  if (userEventRisk?.risk_id === member.risk_id) {
    const months = userEventRisk.event_risk.horizon.months;
    for (const goal of g.nodes.filter((n) => n.kind === 'goal' && finite(n.goal_horizon_months) && n.goal_horizon_months !== months
      && g.edges.some((edge) => edge.from === member.risk_id && edge.to === n.id))) {
      lines.push(`‘${goal.label}’ has a ${goal.goal_horizon_months}-month goal horizon; this likelihood is for ${months} months. Keep the event's own window?`);
    }
  }
  return lines;
}

const draftedFigure = (probability: Node, brief: string | undefined): string | undefined => {
  const pct = percent(probability);
  if (pct === undefined) return undefined;
  const sentences = typeof brief === 'string' ? brief.split(/[.!?](?=\s|$)|[\r\n]/u) : [];
  const matches = sentences.filter((sentence) => shared(probability.label, sentence) >= 2
    && new RegExp(`(?<![\\d.])${pct}(?:\\.0+)?[ \\t]*(?:%|percent\\b)`, 'i').test(sentence));
  // More than one window in the source sentence cannot attest which belongs to this event (for example the goal's
  // nine months and the client's 'this year'). Ask rather than borrow the first window or silently rescale it.
  const horizons = matches.length === 1 ? [...matches[0]!.matchAll(/\bthis year\b|\b(?:within|in|over|during)\s+(?:(?:the\s+)?(?:next|coming|following)\s+)?(?:\d+(?:\.\d+)?|a|an|one)?\s*(?:months?|years?|weeks?)\b/gi)] : [];
  const horizon = horizons.length === 1 ? horizons[0]![0] : undefined;
  return `about ${pct}%${horizon === undefined ? ' (time window not recorded)' : ` ${horizon}`}`;
};
/** A selection is made in the user's positive typed words, not a model tool argument or an approval guess. */
export function isExplicitLikelihoodChoice(userText: string): boolean {
  return /^(?:please\s+)?(?:use|choose|pick)\b/i.test(userText.trim()) && !/\?|\b(?:not|never|no|don't)\b/i.test(userText)
    && readStatedEventRisk(userText) !== undefined;
}

export type RiskLikelihoodConversion =
  | { readonly matched: false; readonly reason: string; readonly detail: string }
  | { readonly matched: true; readonly riskId: string; readonly riskLabel: string; readonly operations: PatchOperation[];
      readonly userEventRisk: UserEventRisk; readonly member: RiskLikelihoodMember; readonly detailLines: string[];
      readonly figureChoices?: { readonly drafted: string; readonly stated: string }; readonly requiresChoice: boolean; readonly impactPath: 'ii' | 'i' | 'none' };

export function buildRiskLikelihoodConversion(input: { currentGraph: unknown; riskLabel: string; userText: string; briefText?: string }): RiskLikelihoodConversion {
  const refuse = (reason: string, detail: string): RiskLikelihoodConversion => ({ matched: false, reason, detail });
  const g = viewOf(input.currentGraph);
  const risks = g?.nodes.filter((n) => n.kind === 'risk' && n.label === input.riskLabel) ?? [];
  if (g === undefined || risks.length !== 1) return refuse('risk_not_found', 'Name exactly one existing risk as the model labels it. Nothing was prepared.');
  const risk = risks[0]!;
  if (risk.relies_on !== undefined) return refuse('precondition_risk', `‘${risk.label}’ is an option precondition. Its option link must be kept; nothing was changed.`);
  const stated = readStatedEventRisk(input.userText);
  if (stated === undefined) return refuse('figure_not_stated', `What likelihood and time window should ‘${risk.label}’ use? Give a percentage or range and its window; nothing was changed.`);
  const incoming = g.edges.filter((e) => e.to === risk.id);
  const probabilities = incoming.map((e) => g.nodes.find((n) => n.id === e.from)).filter((n): n is Node => n !== undefined && probabilityFactor(n));
  if (probabilities.length > 1) return refuse('other_driver', `‘${risk.label}’ has several probability drivers. Which links should be removed? Removing a link is a separate choice; nothing was changed.`);
  const probability = probabilities[0];
  const shares = probability === undefined ? [] : incoming.map((e) => g.nodes.find((n) => n.id === e.from))
    .filter((n): n is Node => n !== undefined && shareFactor(n, probability, risk));
  const other = incoming.filter((e) => e.from !== probability?.id && !shares.some((n) => n.id === e.from));
  if (other.length > 0) return refuse('other_driver', `I can't hold a likelihood for ‘${risk.label}’ while it has the driver ${other.map((e) => `‘${g.nodes.find((n) => n.id === e.from)?.label ?? e.from}’`).join(' and ')} yet. Would you like to remove that link as a separate change? Nothing was changed.`);
  if (probability !== undefined && g.edges.some((e) => e.from === probability.id && e.to !== risk.id)) return refuse('shared_probability_factor', `‘${probability.label}’ also feeds another node. Removing that factor needs a separate choice, so nothing was held.`);
  const operations: PatchOperation[] = [{ op: 'update_node', path: risk.id, value: { label: risk.label, scale_frame: 1 } }];
  if (probability !== undefined) operations.push({ op: 'remove_node', path: probability.id });
  for (const share of shares) operations.push({ op: 'remove_edge', path: `${share.id}::${risk.id}` });
  const duplicates = duplicateEvents(risk, probability, g);
  if (duplicates.some((duplicate) => g.edges.some((e) => e.to === duplicate.id
    || (e.from === duplicate.id && !g.edges.some((kept) => kept.from === risk.id && kept.to === e.to))))) {
    return refuse('duplicate_has_other_links', 'The duplicate event also has other links. Choose how to merge those links before converting it; nothing was changed.');
  }
  for (const duplicate of duplicates) operations.push({ op: 'remove_node', path: duplicate.id });
  const effects: RiskLikelihoodMember['effects'] = [];
  for (const share of shares) {
    const target = targetForShare(share, risk, g);
    const effect = target === undefined ? undefined : conditionalEffect(share, risk, target);
    if (effect !== undefined && !effects.some((e) => e.to === effect.to)) effects.push(effect);
  }
  const impactPath = shares.length === 0 ? 'none' : effects.length === shares.length ? 'ii' : 'i';
  // FIX-3 permits refusal instead of expanding the source-stamp/readiness/Run contract for a placeholder impact.
  if (impactPath === 'i') return refuse('impact_source_not_preserved',
    `I can't convert this yet without losing your ${shares.map((share) => `${percent(share)}%`).join(' and ')}; I've kept the model as it is`);
  for (const share of shares) {
    if (soleShareLink(share.id, risk.id, g)) operations.push({ op: 'remove_node', path: share.id });
  }
  for (const edge of g.edges.filter((e) => e.from === risk.id)) {
    const effect = effects.find((e) => e.to === edge.to);
    operations.push({ op: 'update_edge', path: `${edge.from}::${edge.to}`, value: {
      ...(effect === undefined ? {} : { strength: effect.strength }), exists_probability: 1,
    } });
  }
  const drafted = probability === undefined ? undefined : draftedFigure(probability, input.briefText);
  const draftedOccurrence = drafted === undefined ? undefined : readStatedEventRisk(drafted)?.event_risk;
  const figuresDiffer = drafted !== undefined && (draftedOccurrence === undefined
    || draftedOccurrence.occurrence.p_low !== stated.event_risk.occurrence.p_low
    || draftedOccurrence.occurrence.p_high !== stated.event_risk.occurrence.p_high
    || draftedOccurrence.horizon.months !== stated.event_risk.horizon.months);
  const figureChoices = drafted === undefined ? undefined : { drafted, stated: eventRiskLikelihoodWords(stated.event_risk) };
  const member: RiskLikelihoodMember = { version: 1, risk_id: risk.id, probability_factor_ids: probability === undefined ? [] : [probability.id],
    share_links: shares.map((n) => ({ from: n.id, to: risk.id })), duplicate_risk_ids: duplicates.map((n) => n.id), impact_path: impactPath, effects,
    ...(figureChoices === undefined ? {} : { figure_choices: figureChoices }) };
  const detailLines = riskLikelihoodCardLines(member, operations, input.currentGraph, { risk_id: risk.id, ...stated });
  return { matched: true, riskId: risk.id, riskLabel: risk.label, operations, userEventRisk: { risk_id: risk.id, ...stated }, member,
    detailLines, ...(figureChoices === undefined ? {} : { figureChoices }), requiresChoice: figuresDiffer && !isExplicitLikelihoodChoice(input.userText), impactPath };
}

export interface RiskLikelihoodTransactionInput {
  readonly currentGraph: unknown; readonly currentGraphHash: string | null; readonly riskLabel: string; readonly userText: string;
  readonly briefText?: string; readonly freshness: FrameFreshness; readonly mode: 'off' | 'shadow' | 'live';
  readonly scenarioId: string; readonly turnId: string; readonly requestId: string; readonly stage: OlumiResponse['stage_indicator'];
}
export type RiskLikelihoodTransactionOutcome =
  | { readonly kind: 'refused'; readonly reason: string; readonly detail?: string; readonly conversion?: Extract<RiskLikelihoodConversion, { matched: true }> }
  | { readonly kind: 'held'; readonly response: OlumiResponse; readonly pendingActions: readonly PendingAction[]; readonly chip: EditGmChip;
      readonly riskId: string; readonly riskLabel: string; readonly conversion: Extract<RiskLikelihoodConversion, { matched: true }> };

export function dispatchRiskLikelihoodTransaction(input: RiskLikelihoodTransactionInput): RiskLikelihoodTransactionOutcome {
  if (input.mode !== 'live') return { kind: 'refused', reason: 'gm_not_live' };
  if (input.currentGraphHash === null) return { kind: 'refused', reason: 'no_graph_hash' };
  const conversion = buildRiskLikelihoodConversion(input);
  if (!conversion.matched) return { kind: 'refused', reason: conversion.reason, detail: conversion.detail };
  if (conversion.requiresChoice) return { kind: 'refused', reason: 'likelihood_choice_required', conversion,
    detail: [...conversion.detailLines, 'Which should the model use? Pick a figure with its own time window.'].join('\n') };
  if (JSON.stringify(conversion.operations).length > GM_HELD_OPERATIONS_MAX_JSON_CHARS) return { kind: 'refused', reason: 'payload_too_large' };
  const refereeOperations = riskLikelihoodRefereeOperations(conversion.operations, conversion.member, input.currentGraph);
  if (refereeOperations === undefined) return { kind: 'refused', reason: 'parameters_invalid' };
  const impactDescriptions = riskLikelihoodImpactDescriptions(conversion.member, conversion.operations, input.currentGraph);
  if (impactDescriptions === undefined) return { kind: 'refused', reason: 'parameters_invalid' };
  const decision = evaluateEditGraphMutations({ mode: 'live', operations: refereeOperations, currentGraph: input.currentGraph,
    currentGraphHash: input.currentGraphHash, baseGraphHash: input.currentGraphHash, freshness: input.freshness,
    scenarioId: input.scenarioId, turnId: input.turnId, requestId: input.requestId, dispatchPath: 'edit_graph', envelopeCap: TYPED_TRANSACTION_ENVELOPE_CAP,
    requireConfirmation: true, changesetOptions: { riskLikelihoodImpactDescriptions: impactDescriptions } });
  const offered = decision.suggestedActions?.[0];
  if (decision.governing !== 'held' || decision.pendingActions?.length !== 1 || offered === undefined) return { kind: 'refused', reason: 'not_held' };
  const offeredLines = offered.detail?.split('\n') ?? [];
  const chip = { ...offered, detail: [...offeredLines, eventRiskCardLine(conversion.userEventRisk.event_risk),
    ...conversion.detailLines.filter((line) => !offeredLines.includes(line))].join('\n') };
  const pending = decision.pendingActions[0]!;
  if (pending.action.kind !== 'apply_proposed_change') return { kind: 'refused', reason: 'not_held' };
  const pendingActions = [{ ...pending, action: { ...pending.action, inline_patch: { ...(record(pending.action.inline_patch) ?? {}),
    operations: conversion.operations, [GM_HELD_USER_EVENT_RISK_KEY]: conversion.userEventRisk, [GM_HELD_RISK_LIKELIHOOD_KEY]: conversion.member } } } as PendingAction];
  const response: OlumiResponse = { response_version: 2, assistant_text: decision.assistantText ?? '',
    blocks: decision.heldProposalBlock == null ? [] : [decision.heldProposalBlock as HeldProposalBlock],
    suggested_actions: (decision.suggestedActions ?? []).map((c, i) => chipToBoundaryAction(i === 0 ? chip : c)), insights: [], stage_indicator: input.stage } as OlumiResponse;
  return { kind: 'held', response, pendingActions, chip, riskId: conversion.riskId, riskLabel: conversion.riskLabel, conversion };
}
