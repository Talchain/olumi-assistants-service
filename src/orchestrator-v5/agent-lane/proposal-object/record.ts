/**
 * ⭐ S-D USER-IN-CONTROL CHANGE — THE ONE PROPOSAL OBJECT (design: inflight/lane-edit-panel-DESIGN.md §2; Paul 7 Oct).
 *
 * Every change the served lane proposes is already ONE persisted carrier: an `apply_proposed_change` PendingAction on
 * the latest answer row. This module is the ONE reader that projects a held proposal for the user — what it assumes
 * (its editable fields, and whose each value is), what data it is missing, and the exact card that approves it. Nothing
 * new is stored: every value and every provenance is read from the held operations themselves, through the estate's
 * existing predicates (`whoSized` for a link), so this module can never become a second provenance authority (R5v2).
 *
 * ⭐ ONE LIFECYCLE ENVELOPE OVER TYPE-SPECIFIC PAYLOADS (binding: DL, AIE line review #87 6037446159 item 6; design §2a).
 * The record is the ENVELOPE every proposal shares: identity (id, revision, digest), pin, card, lifecycle, the field
 * PROJECTION with provenance, the missing data, and the receipt. The PAYLOAD is the stored carrier, verbatim
 * (`operations`): every quantity, unit, cap, scale, operator, value frame, condition and provenance it was stored with.
 * It is never copied into a generic shape. Each field kind has its own domain and writes back only into its own op
 * (`amend.ts`), and a kind that cannot be projected without loss stays unclassified for editing (`slice_2`/`slice_3`).
 *
 * SLICE 1 implements the product-hold dialect (`gmh_`, `graph_management_held_v1`: the add-option, add-risk and
 * add-factor doors and the edit referee hold) and the `link_strength` field class. Every other op class is CLASSIFIED
 * here (exhaustively, so a new op is a compile error until it is) and declared for the slice that adds it.
 */
import { createHash } from 'node:crypto';

import type { StrengthBand } from '@talchain/schemas/boundary';

import { isPendingActionExpired, parsePendingAction, type PendingAction } from '../../session/pending-action.js';
import { conversationAsSeen } from '../../session/conversation-as-seen.js';
import { GM_HELD_HANDLER_ID, buildGmHeldPublicCopy } from '../../handlers/edit-graph-referee-gate.js';
import { describeChangeset } from '../../handlers/describe-changeset.js';
import { GM_HELD_GRADED_TODAY_KEY, GM_HELD_SWITCH_FACTORS_KEY, readGradedTodayMember } from '../../routing/add-option-transaction.js';
import { GM_HELD_USER_TODAY_KEY, readUserTodayMember } from '../../routing/add-factor-transaction.js';
import { EDGE_STRENGTH_MIDPOINTS, edgeBandFromMagnitude, strengthBandFromEdgeBand } from '../../format/edge-strength-bands.js';
import type { InfluenceBand } from '../../format/influence-bands.js';
import { GM_HELD_USER_EVENT_RISK_KEY, readUserEventRiskMember } from '../../routing/stated-event-risk.js';
import { eventRiskCardLine } from '../stated-event-risk-draft.js';
import { whoSized } from '../strength-authorship-words.js';
import { computeProposalId, type ProposalOperation, type StructuredProposal } from '../proposal.js';
import type { PatchOperation } from '../../../orchestrator/types.js';

/** The approve chip id prefix (`approval-chips.ts` APPROVE_PREFIX), restated here only to build the card's id. */
const APPROVE_PREFIX = 'agent-approve-proposal:';
/** ⭐ The typed decline: words alone never set a held proposal aside; this exact press does. */
export const DECLINE_PREFIX = 'agent-decline-proposal:';
export const declineChipIdFor = (proposalId: string): string => `${DECLINE_PREFIX}${proposalId}`;
const GMH_RE = /^gmh_[0-9a-f]{12}$/;
const PROP_RE = /^prop_[0-9a-f]{32}$/;
/** The held proposal a typed decline press names, or undefined. */
export function declinedProposalOf(chipId: unknown): string | undefined {
  if (typeof chipId !== 'string' || !chipId.startsWith(DECLINE_PREFIX)) return undefined;
  const id = chipId.slice(DECLINE_PREFIX.length);
  return GMH_RE.test(id) || PROP_RE.test(id) ? id : undefined;
}

export const STRENGTH_BANDS: readonly StrengthBand[] = ['slight', 'moderate', 'strong', 'very_strong'];

/** Whose a value is NOW, read from the held op's own provenance. */
export type ValueSource = 'placeholder' | 'estimate' | 'yours';
export type FieldKind = 'link_strength' | 'factor_value';

/**
 * ⛔ ONE EXHAUSTIVE CLASSIFIER over every op either dialect can hold (the product's patch ops + the Agent's proposal
 * ops). `Record<…>` so a new op is a COMPILE ERROR until it is classified (trap 12; the `PENDING_KIND_IS_RECORDED_ASK`
 * construction). The value is the field class the op yields, or the slice that will add it, or `none` (a decision or
 * a structural act: nothing in it is an estimate the user could correct).
 */
export const FIELD_CLASS_BY_OP: Readonly<Record<PatchOperation['op'] | ProposalOperation['op'], FieldKind | 'slice_2' | 'slice_3' | 'none'>> = {
  add_edge: 'link_strength',
  update_edge: 'slice_2', // an edited link in an edit-referee hold (H4): its landed check is node-based today (S2)
  add_node: 'slice_2', // a new factor's / risk's level today; an option's levels (S2)
  update_node: 'slice_2', // a factor value (S2)
  remove_node: 'none',
  remove_edge: 'none',
  set_factor_value: 'factor_value',
  set_option_intervention: 'slice_2',
  set_link_strength: 'link_strength', // the Agent dialect's link band (S2)
  set_link_effect: 'none', // the user's own verbatim figures: shown, never re-authored
  set_goal_target: 'slice_3',
  set_limit: 'slice_3',
  set_team_time: 'slice_3',
  set_goal_deadline: 'slice_3', // the goal's date (`goal_horizon.deadline`, new on staging 7 Oct): with goal target and limits (S3, S-E)
  confirm_identity: 'none',
  set_option_status: 'none',
  adopt_olumi_option: 'slice_3',
};

export interface LinkStrengthField {
  readonly field_id: string;
  readonly kind: 'link_strength';
  readonly from_id: string;
  readonly to_id: string;
  readonly from_label: string;
  readonly to_label: string;
  readonly direction: 'positive' | 'negative';
  /** The value the proposal holds now, and whose it is. */
  readonly current: { readonly band: StrengthBand; readonly source: ValueSource };
  readonly allowed_bands: readonly StrengthBand[];
  readonly editable: boolean;
}

/** Native figure and its stored domain. Units are read-only. No quantity is normalised by this projection. */
export interface FactorValueField {
  readonly field_id: string;
  readonly kind: 'factor_value';
  readonly node_id: string;
  readonly label: string;
  readonly unit: string;
  readonly cap?: number;
  readonly declared_scale?: unknown;
  readonly current: { readonly value: number; readonly unit: string; readonly source: 'estimate' | 'yours' | 'from_brief' };
  readonly filled_missing: boolean;
  readonly editable: boolean;
}
export type ProposalField = LinkStrengthField | FactorValueField;

export interface MissingDatum {
  readonly node_id: string;
  readonly label: string;
  readonly kind: 'risk' | 'factor';
  readonly what: 'level_today';
}

export interface CardAction { readonly id: string; readonly label: string; readonly message: string; readonly detail?: string }

/** ⭐ THE ONE PROPOSAL OBJECT — a read model over the persisted carrier. */
export interface ProposalRecord<F extends ProposalField = ProposalField> {
  readonly proposal_id: string;
  /**
   * The exact stored revision of this proposal (the carrier's own id). Edits name it, and the door applies them ONLY to
   * that revision, so two panels can never approve each other's values (Codex P0 on the design).
   */
  readonly revision: string;
  /** Carrier time for bounded issuance lookup only; excluded from the displayed digest and wire. */
  /**
   * What the panel SHOWED, bound: the card's words, every field (its ends, their labels, direction, value and whose it
   * is) and the missing data, hashed. Edits name it and the door re-derives it from the stored hold on the stored model,
   * so a rename or any other change to what was shown applies nothing — the analysis hash alone ignores labels
   * (Codex r1 P1 on #2743: a renamed factor took the user's value under a name they never saw).
   */
  readonly digest: string;
  readonly dialect: 'product_hold' | 'agent';
  readonly base_graph_hash: string;
  readonly approve_action: CardAction;
  readonly decline_action: CardAction;
  readonly operations: readonly HeldOp[];
  readonly fields: readonly F[];
  readonly missing: readonly MissingDatum[];
}

export type HeldOp = { readonly op: string; readonly path: string; readonly value?: unknown };
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Digest only the envelope projection; sort nested keys so JSONB key order cannot invalidate a displayed panel. */
function projectionDigest(projection: unknown): string {
  return createHash('sha256').update(JSON.stringify(projection, (_key, value: unknown) => {
    if (!isRec(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  })).digest('hex').slice(0, 32);
}

/** True iff `pa` is a product hold (`gmh_`, `graph_management_held_v1`). */
export function isProductHold(pa: PendingAction): boolean {
  return pa.action.kind === 'apply_proposed_change'
    && typeof pa.chip_id === 'string' && GMH_RE.test(pa.chip_id)
    && isRec(pa.action.inline_patch) && pa.action.inline_patch['handler_id'] === GM_HELD_HANDLER_ID;
}

export function heldOperationsOf(pa: PendingAction): HeldOp[] {
  const ops = isRec((pa.action as { inline_patch?: unknown }).inline_patch)
    ? ((pa.action as { inline_patch: Rec }).inline_patch['operations']) : undefined;
  return Array.isArray(ops)
    ? ops.filter((o): o is HeldOp => isRec(o) && typeof o['op'] === 'string' && typeof o['path'] === 'string')
    : [];
}

/** The field id of a held link: the class and the op's own path (`from::to`), so it is bound to THAT op by identity. */
export const linkFieldId = (path: string): string => `link_strength:${path}`;

function endsOf(path: string): { from: string; to: string } | undefined {
  const parts = path.split('::');
  return parts.length === 2 && parts[0] !== '' && parts[1] !== '' ? { from: parts[0]!, to: parts[1]! } : undefined;
}

/** Labels: the batch's own new nodes first, then the graph. */
function labelResolver(ops: readonly HeldOp[], graph: unknown): (id: string) => string | undefined {
  const labels = new Map<string, string>();
  const nodes = isRec(graph) && Array.isArray(graph['nodes']) ? (graph['nodes'] as unknown[]).filter(isRec) : [];
  for (const n of nodes) if (typeof n['id'] === 'string' && typeof n['label'] === 'string') labels.set(n['id'], n['label']);
  for (const o of ops) {
    if (o.op !== 'add_node' || !isRec(o.value)) continue;
    const { id, label } = o.value as { id?: unknown; label?: unknown };
    if (typeof id === 'string' && typeof label === 'string') labels.set(id, label);
  }
  return (id) => labels.get(id);
}

/** A held link's strength field, or undefined when the op carries no readable strength. */
function linkField(o: HeldOp, labelOf: (id: string) => string | undefined): LinkStrengthField | undefined {
  if (!isRec(o.value)) return undefined;
  const ends = endsOf(o.path);
  if (ends === undefined) return undefined;
  const v = o.value;
  const strength = isRec(v['strength']) ? v['strength'] : undefined;
  const mean = strength?.['mean'];
  if (typeof mean !== 'number' || !Number.isFinite(mean)) return undefined;
  const fromLabel = labelOf(ends.from);
  const toLabel = labelOf(ends.to);
  if (fromLabel === undefined || toLabel === undefined) return undefined;
  const stated = v['effect_direction'];
  const direction: 'positive' | 'negative' = stated === 'negative' || stated === 'positive' ? stated : mean < 0 ? 'negative' : 'positive';
  const who = whoSized({ provenance: v['provenance'] });
  return {
    field_id: linkFieldId(o.path),
    kind: 'link_strength',
    from_id: ends.from,
    to_id: ends.to,
    from_label: fromLabel,
    to_label: toLabel,
    direction,
    current: { band: strengthBandFromEdgeBand(edgeBandFromMagnitude(Math.abs(mean))), source: who === 'yours' ? 'yours' : who === 'estimate' ? 'estimate' : 'placeholder' },
    allowed_bands: STRENGTH_BANDS,
    // A link that holds BY DEFINITION is arithmetic, never anyone's estimate (`strength-authorship-words.ts`).
    editable: who !== 'definition',
  };
}

/** The new nodes this batch adds with no level today, other than those whose level the hold itself records. */
function missingOf(pa: PendingAction, ops: readonly HeldOp[]): MissingDatum[] {
  const patch = (pa.action as { inline_patch?: Rec }).inline_patch ?? {};
  const recorded = new Set<string>([
    ...(Array.isArray(patch[GM_HELD_SWITCH_FACTORS_KEY]) ? (patch[GM_HELD_SWITCH_FACTORS_KEY] as unknown[]).filter((x): x is string => typeof x === 'string') : []),
    ...(readGradedTodayMember(patch[GM_HELD_GRADED_TODAY_KEY]) ?? []).map((l) => l.factor_id),
    ...(readUserTodayMember(patch[GM_HELD_USER_TODAY_KEY]) ?? []).map((l) => l.factor_id),
  ]);
  const out: MissingDatum[] = [];
  for (const o of ops) {
    if (o.op !== 'add_node' || !isRec(o.value)) continue;
    const { id, label, kind } = o.value as { id?: unknown; label?: unknown; kind?: unknown };
    if (typeof id !== 'string' || typeof label !== 'string' || (kind !== 'risk' && kind !== 'factor')) continue;
    const observed = (o.value as Rec)['observed_state'];
    if (isRec(observed) && typeof observed['value'] === 'number') continue;
    if (recorded.has(id)) continue;
    out.push({ node_id: id, label, kind, what: 'level_today' });
  }
  return out;
}

/** The card's approve action: the hold's OWN words (exactly what `confirmHeld` checks), with its changeset lines. */
function approveActionOf(pa: PendingAction, ops: readonly HeldOp[], graph: unknown): CardAction | undefined {
  const { public_label: label, public_message: message } = pa.action as { public_label?: unknown; public_message?: unknown };
  if (typeof label !== 'string' || label.trim() === '' || typeof message !== 'string' || message.trim() === '') return undefined;
  const patch = (pa.action as { inline_patch?: Rec }).inline_patch ?? {};
  const switches = Array.isArray(patch[GM_HELD_SWITCH_FACTORS_KEY]) ? (patch[GM_HELD_SWITCH_FACTORS_KEY] as unknown[]).filter((x): x is string => typeof x === 'string') : undefined;
  let detail: string | undefined;
  try {
    // The changeset lines, re-derived from the held batch; shown ONLY when they re-derive the SAME card words.
    const changeset = describeChangeset(ops as PatchOperation[], graph, switches !== undefined ? { switchFactorIds: switches } : undefined);
    const copy = buildGmHeldPublicCopy(changeset?.subject ?? null, changeset?.items);
    if (copy.label === label && copy.message === message) detail = copy.detail;
  } catch { detail = undefined; }
  // The member reader validates the occurrence with EventRiskV1 before any copy is added.
  const eventRisk = readUserEventRiskMember(patch[GM_HELD_USER_EVENT_RISK_KEY]);
  if (eventRisk !== undefined) {
    const line = eventRiskCardLine(eventRisk.event_risk);
    detail = detail !== undefined ? `${detail}\n${line}` : line;
  }
  return { id: `${APPROVE_PREFIX}${pa.chip_id}`, label, message, ...(detail !== undefined ? { detail } : {}) };
}

/**
 * The ONE proposal object for a held product proposal, read against `graph` (the model it is pinned to, or the model
 * it was just re-pinned to). Undefined for anything that is not a live product hold, or whose card words are missing.
 */
export function productHoldRecord(pa: PendingAction, graph: unknown, nowMs: number = Date.now()): ProposalRecord<LinkStrengthField> | undefined {
  if (!isProductHold(pa) || isPendingActionExpired(pa, nowMs)) return undefined;
  const pin = pa.preconditions.graph_hash;
  if (typeof pin !== 'string' || pin === '') return undefined;
  const ops = heldOperationsOf(pa);
  // SLICE 1: a hold that ADDS something (H1 add-option, H2 add-risk, H3 add-factor). An edge-only or update-only hold
  // (H4/H5) is confirmed by a landed check that reads added nodes (`confirmHeld` `holdsAll`), so it is not offered (S2).
  if (!ops.some((o) => o.op === 'add_node')) return undefined;
  const approve = approveActionOf(pa, ops, graph);
  if (approve === undefined) return undefined;
  const labelOf = labelResolver(ops, graph);
  const fields: LinkStrengthField[] = [];
  for (const o of ops) {
    if (FIELD_CLASS_BY_OP[o.op as keyof typeof FIELD_CLASS_BY_OP] !== 'link_strength') continue;
    const f = linkField(o, labelOf);
    if (f !== undefined) fields.push(f);
  }
  const missing = missingOf(pa, ops);
  const digest = projectionDigest({ p: pa.chip_id, r: pa.id, g: pin, approve,
    decline: { id: declineChipIdFor(pa.chip_id), label: 'Not now', message: 'Not now.' }, fields, missing });
  return {
    proposal_id: pa.chip_id,
    revision: pa.id,
    digest,
    dialect: 'product_hold',
    base_graph_hash: pin,
    approve_action: approve,
    decline_action: { id: declineChipIdFor(pa.chip_id), label: 'Not now', message: 'Not now.' },
    operations: ops,
    fields,
    missing,
  };
}

/** Integrity and carrier identity are checked before a typed Agent payload is projected. */
export function agentProposalOf(pa: PendingAction): StructuredProposal | undefined {
  if (pa.action.kind !== 'apply_proposed_change') return undefined;
  const p = pa.action.inline_patch['agent_proposal'] as StructuredProposal | undefined;
  if (!p || typeof p.proposal_id !== 'string' || !PROP_RE.test(p.proposal_id)
    || pa.chip_id !== `${APPROVE_PREFIX}${p.proposal_id}` || p.scenario_id !== pa.scenario_id
    || p.base_graph_identity_hash !== pa.preconditions.graph_hash) return undefined;
  try { return computeProposalId(p) === p.proposal_id ? p : undefined; } catch { return undefined; }
}
export const isHeldProposal = (pa: PendingAction): boolean => isProductHold(pa) || agentProposalOf(pa) !== undefined;
export const heldProposalId = (pa: PendingAction): string => agentProposalOf(pa)?.proposal_id ?? pa.chip_id;

export function agentProposalRecord(pa: PendingAction, graph: unknown, nowMs = Date.now()): ProposalRecord | undefined {
  const p = agentProposalOf(pa);
  if (!p || isPendingActionExpired(pa, nowMs)) return undefined;
  const action = pa.action as Extract<PendingAction['action'], { kind: 'apply_proposed_change' }>;
  if (!action.public_label || !action.public_message) return undefined;
  const detail = action.inline_patch['approve_detail'];
  const approve: CardAction = { id: pa.chip_id, label: action.public_label, message: action.public_message,
    ...(typeof detail === 'string' ? { detail } : {}) };
  const nodes = isRec(graph) && Array.isArray(graph['nodes']) ? graph['nodes'].filter(isRec) : [];
  const labelOf = (id: string): string => String(nodes.find(n => n['id'] === id)?.['label'] ?? id);
  const fields: ProposalField[] = [];
  for (const o of p.operations) {
    if (!isRec(o.value)) continue;
    const v = o.value;
    if (o.op === 'set_factor_value' && typeof v['value'] === 'number' && Number.isFinite(v['value']) && typeof v['unit'] === 'string') {
      const node = nodes.find(n => n['id'] === o.path);
      const os = isRec(node?.['observed_state']) ? node['observed_state'] : {};
      // No brief provenance is inferred from words, a basis, or approval. A1/A2 store no R5v2 verified brief marker.
      const source = v['authored_by'] === 'user_stated' ? 'yours' : 'estimate';
      fields.push({ field_id: `factor_value:${o.path}`, kind: 'factor_value', node_id: o.path, label: labelOf(o.path),
        unit: v['unit'], ...(typeof v['cap'] === 'number' ? { cap: v['cap'] } : {}),
        ...(v['declared_scale'] !== undefined ? { declared_scale: v['declared_scale'] } : {}),
        current: { value: v['value'], unit: v['unit'], source }, filled_missing: typeof os['value'] !== 'number', editable: source !== 'yours' });
    } else if (o.op === 'set_link_strength' && typeof v['band'] === 'string' && Object.hasOwn(EDGE_STRENGTH_MIDPOINTS, v['band'])) {
      const [from, to] = o.path.split('::');
      if (!from || !to) continue;
      const expected = isRec(v['expected']) ? v['expected'] : {};
      const yours = v['author'] === 'user_stated' && v['intent'] !== 'confirm_current';
      fields.push({ field_id: linkFieldId(o.path), kind: 'link_strength', from_id: from, to_id: to,
        from_label: labelOf(from), to_label: labelOf(to), direction: expected['effect_direction'] === 'negative' ? 'negative' : 'positive',
        current: { band: strengthBandFromEdgeBand(v['band'] as InfluenceBand), source: yours ? 'yours' : 'estimate' },
        allowed_bands: STRENGTH_BANDS, editable: !yours });
    }
  }
  const decline: CardAction = { id: declineChipIdFor(p.proposal_id), label: 'Not now', message: 'Not now.' };
  const digest = projectionDigest({ p: p.proposal_id, r: pa.id, g: p.base_graph_identity_hash, approve, decline, fields, missing: [] });
  return { proposal_id: p.proposal_id, revision: pa.id, digest, dialect: 'agent', base_graph_hash: p.base_graph_identity_hash,
    approve_action: approve, decline_action: decline, operations: p.operations, fields, missing: [] };
}
/** One envelope, with a reader for each stored dialect. */
export function proposalRecord(pa: PendingAction, graph: unknown, nowMs = Date.now()): ProposalRecord | undefined {
  return productHoldRecord(pa, graph, nowMs) ?? agentProposalRecord(pa, graph, nowMs);
}

/** What the change is, in the user's words: "the risk 'X'", "the option 'X'", "the factors 'X' and 'Y'". */
export function heldChangeLabel(pa: PendingAction): string | undefined {
  const agent = agentProposalOf(pa);
  if (agent !== undefined) return agent.public_label;
  const nodes = heldOperationsOf(pa).filter((o) => o.op === 'add_node' && isRec(o.value))
    .map((o) => o.value as { kind?: unknown; label?: unknown })
    .filter((v): v is { kind: string; label: string } => typeof v.kind === 'string' && typeof v.label === 'string' && v.label.trim() !== '');
  const lead = nodes.find((v) => v.kind === 'option') ?? nodes.find((v) => v.kind === 'risk') ?? nodes[0];
  if (lead === undefined) return undefined;
  const sameKind = nodes.filter((v) => v.kind === lead.kind);
  const kindWord = lead.kind === 'option' || lead.kind === 'risk' || lead.kind === 'factor' ? lead.kind : 'item';
  if (sameKind.length === 1) return `the ${kindWord} '${lead.label}'`;
  return `the ${kindWord}s ${sameKind.map((v) => `'${v.label}'`).slice(0, -1).join(', ')} and '${sameKind.at(-1)!.label}'`;
}

/** The whole subject of a lapse sentence, for either held dialect. */
export function heldChangeName(pa: PendingAction): string | undefined {
  const name = heldChangeLabel(pa);
  if (name === undefined) return undefined;
  return agentProposalOf(pa) !== undefined ? `The held change "${name.replace(/\.$/, '')}"` : `The held change to add ${name}`;
}

/** The existing conversation rows needed to locate the answer that first carried a held revision. */
export interface ProposalIssuingRow {
  readonly turn_id: string;
  readonly created_at?: string;
  readonly request_hash?: string | null;
  readonly user_message?: string | null;
  readonly assistant_message?: string | null;
  readonly pending_actions?: readonly unknown[];
}

/** PostgreSQL and ISO instants, padded to UTC microseconds. Date only shifts whole seconds; it never orders fractions. */
function proposalRowTimestamp(value: string | undefined, shiftSeconds = 0): string | undefined {
  const parts = value?.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/);
  if (parts === undefined || parts === null) return undefined;
  const localTime = `${parts[1]}T${parts[2]}`;
  const localSeconds = Date.parse(`${localTime}Z`);
  if (!Number.isFinite(localSeconds) || new Date(localSeconds).toISOString().slice(0, 19) !== localTime) return undefined;
  const zone = parts[4]!.length === 3 ? `${parts[4]}:00` : parts[4]!;
  const wholeSeconds = Date.parse(`${localTime}${zone}`);
  if (!Number.isFinite(wholeSeconds)) return undefined;
  return `${new Date(wholeSeconds + shiftSeconds * 1000).toISOString().slice(0, 19)}.${(parts[3] ?? '').padEnd(6, '0')}Z`;
}

/**
 * P53: use only the loaded window. The earliest public answer at/after emission (allowing 2 s app/DB clock skew)
 * is the ONE candidate for a revision. It must carry that revision and its chronological predecessor must not:
 * at most two exact-row reads, never scan onward. Without a predecessor, only a complete raw window proves issuance.
 * Tied timestamps, a hold predating this window and unverifiable rows stay unknown. Claim markers and conversation
 * the user did not see never issue cards. Neither graph nor stored conversation changes.
 */
/** Each record's revision with the emission time of the held action that carries it; a record without one is skipped. */
export function proposalIssuances(records: readonly ProposalRecord[], pending: readonly PendingAction[]): readonly ProposalIssuance[] {
  return records.flatMap((r) => {
    const pa = pending.find((p) => p.id === r.revision);
    return pa === undefined ? [] : [{ revision: r.revision, emitted_at_iso: pa.emitted_at_iso }];
  });
}

/** What locating an issuing answer needs; deliberately NOT part of the record (its shape and digest stay as shown). */
export interface ProposalIssuance { readonly revision: string; readonly emitted_at_iso: string }

export async function issuedTurnIdsForProposalRecords(
  records: readonly ProposalIssuance[],
  rows: readonly ProposalIssuingRow[],
  windowSize: number,
  readCommittedTurn?: (turnId: string) => Promise<{ readonly pending_actions?: readonly unknown[] } | null>,
): Promise<ReadonlyMap<string, string>> {
  const issued = new Map<string, string>();
  if (records.length === 0) return issued;
  const datedRows = rows.flatMap(row => {
    const at = proposalRowTimestamp(row.created_at);
    return at === undefined ? [] : [at];
  });
  if (datedRows.length === 0) return issued;
  const windowStart = datedRows.sort()[0]!;
  const earliestEmission = proposalRowTimestamp(windowStart, -2)!;
  const chronological = [...conversationAsSeen(rows)].reverse()
    .filter(row => !row.turn_id.endsWith(':claim')
      && (typeof row.user_message === 'string' || typeof row.assistant_message === 'string'))
    .map(row => ({ row, at: proposalRowTimestamp(row.created_at) }));
  // An undated public row makes its place in the carry run unverifiable.
  if (chronological.some(row => row.at === undefined)) return issued;
  chronological.sort((a, b) => {
    const at = a.at!; const bt = b.at!;
    return (at < bt ? -1 : at > bt ? 1 : 0) || a.row.turn_id.localeCompare(b.row.turn_id);
  });
  const timestampCounts = new Map<string, number>();
  for (const { at } of chronological) {
    if (at !== undefined) timestampCounts.set(at, (timestampCounts.get(at) ?? 0) + 1);
  }
  const carriesRevision = async (row: ProposalIssuingRow, revision: string): Promise<boolean | undefined> => {
    let pendingActions = row.pending_actions;
    if (pendingActions === undefined) {
      try { pendingActions = (await readCommittedTurn?.(row.turn_id))?.pending_actions; }
      catch { return undefined; }
    }
    if (pendingActions === undefined) return undefined;
    return pendingActions.some(raw => parsePendingAction(raw)?.id === revision);
  };
  for (const record of records) {
    const emittedAt = proposalRowTimestamp(record.emitted_at_iso);
    if (emittedAt === undefined || emittedAt < earliestEmission) continue;
    const cutoff = proposalRowTimestamp(emittedAt, -2)!;
    const index = chronological.findIndex(candidate => candidate.at !== undefined && candidate.at >= cutoff);
    const candidate = chronological[index];
    if (candidate === undefined || timestampCounts.get(candidate.at!) !== 1) continue;
    const predecessor = chronological[index - 1];
    if (predecessor !== undefined && timestampCounts.get(predecessor.at!) !== 1) continue;
    if (await carriesRevision(candidate.row, record.revision) !== true) continue;
    if (predecessor === undefined) {
      if (!(rows.length < windowSize)) continue;
    } else if (await carriesRevision(predecessor.row, record.revision) !== false) continue;
    issued.set(record.revision, candidate.row.turn_id);
  }
  return issued;
}

/** ⭐ THE WIRE (design §4): `_proposal_fields` on a turn, `proposal_fields` on the graph read. Absent when none is held. */
export interface ProposalFieldsWire {
  readonly version: 1;
  readonly graph_hash: string;
  readonly proposals: readonly {
    readonly proposal_id: string;
    readonly revision: string;
    readonly digest: string;
    readonly issued_turn_id: string | null;
    readonly approve_action: CardAction;
    readonly decline_action: CardAction;
    readonly fields: readonly ProposalField[];
    readonly missing: readonly MissingDatum[];
  }[];
}

/** Only records pinned to `graphHash` are projected: the values shown are the values on the model the user sees. */
export function proposalFieldsWire(
  records: readonly ProposalRecord[],
  graphHash: string | undefined,
  issuedTurnIds: ReadonlyMap<string, string> = new Map(),
): ProposalFieldsWire | undefined {
  if (graphHash === undefined || graphHash === '') return undefined;
  const pinned = records.filter((r) => r.base_graph_hash === graphHash);
  if (pinned.length === 0) return undefined;
  return {
    version: 1,
    graph_hash: graphHash,
    proposals: pinned.map((r) => ({
      proposal_id: r.proposal_id, revision: r.revision, digest: r.digest, approve_action: r.approve_action, decline_action: r.decline_action,
      // Wire-only context: issuing a card never changes the digest of what that card showed.
      issued_turn_id: issuedTurnIds.get(r.revision) ?? null,
      fields: r.fields, missing: r.missing,
    })),
  };
}
