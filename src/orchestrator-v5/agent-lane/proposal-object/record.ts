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
import { identityCardOfferable } from '../../system-events/identity-confirm-edit.js';
import { identityReadingOf } from '../identity-card.js';
import { GM_HELD_HANDLER_ID, buildGmHeldPublicCopy } from '../../handlers/edit-graph-referee-gate.js';
import { describeChangeset } from '../../handlers/describe-changeset.js';
import { sayFigureWithoutRounding } from '../say-figure.js';
import { GM_HELD_GRADED_TODAY_KEY, GM_HELD_SWITCH_FACTORS_KEY, readGradedTodayMember } from '../../routing/add-option-transaction.js';
import { GM_HELD_USER_TODAY_KEY, readUserTodayMember } from '../../routing/add-factor-transaction.js';
import { EDGE_STRENGTH_MIDPOINTS, edgeBandFromMagnitude, strengthBandFromEdgeBand } from '../../format/edge-strength-bands.js';
import type { InfluenceBand } from '../../format/influence-bands.js';
import { GM_HELD_USER_EVENT_RISK_KEY, readUserEventRiskMember } from '../../routing/stated-event-risk.js';
import { eventRiskCardLine } from '../stated-event-risk-draft.js';
import { heldReliesOnRiskLines, readReliesOnRisk } from '../../routing/relies-on-risk.js';
import { whoSized } from '../strength-authorship-words.js';
import { computeProposalId, type ProposalOperation, type StructuredProposal } from '../proposal.js';
import { heldCardAppliesAt, heldCardUnderReview } from './still-applies.js';
import { reviewChipFor } from './reply.js';
import type { PatchOperation } from '../../../orchestrator/types.js';

/** The approve chip id prefix (`approval-chips.ts` APPROVE_PREFIX), restated here only to build the card's id. */
const APPROVE_PREFIX = 'agent-approve-proposal:';
/** ⭐ The typed decline: words alone never set a held proposal aside; this exact press does. */
export const DECLINE_PREFIX = 'agent-decline-proposal:';
export const declineChipIdFor = (proposalId: string): string => `${DECLINE_PREFIX}${proposalId}`;

/**
 * ⭐ WHAT THE CLIENT SHOWS (Codex BLOCK on #3420, 18 Oct, P1: a replacement whose reply was lost inherited the typed
 * consent given to the card the client still showed). A typed turn carries `displayed_proposals`: the cards the client
 * displays, each by id and the revision it rendered (`_proposal_fields`). Read loosely, as `proposal_edits` is.
 */
export function displayedProposalsOf(raw: unknown): ReadonlyMap<string, string | undefined> {
  const shown = new Map<string, string | undefined>();
  if (!Array.isArray(raw)) return shown;
  for (const entry of raw.slice(0, 16)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const { proposal_id: id, revision } = entry as Record<string, unknown>;
    if (typeof id === 'string' && id.length > 0 && id.length <= 200) shown.set(id, typeof revision === 'string' && revision !== '' ? revision : undefined);
  }
  return shown;
}
/** Typed words bind only to a card the client shows AT the revision held now (none held: a `prop_` id is its content). */
export function shownAsHeldNow(shown: ReadonlyMap<string, string | undefined>, proposalId: string, revisionNow: string | undefined): boolean {
  return shown.has(proposalId) && (revisionNow === undefined || shown.get(proposalId) === revisionNow);
}
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
  set_hiring_times: 'slice_3', // E5: each capacity option's hiring times, like the team's time
  set_option_capacity_change: 'none', // the coaching loop: the user's figure and Olumi's adopted reading, quoted on its card
  add_limit: 'slice_3',
  attest_goal_steady: 'none', // the user's temporal judgement is a card answer, not a numeric field
  set_cohort_forecast: 'none', // the user's own cohort forecast, quoted on its card (science PR-4b): a card answer, not a field
  set_statement_record: 'none', // the user's same-people answer on the goal, quoted on its door card (M4-cohort): a card answer, not a field
  record_statement: 'none', // SYSTEM 1: the user's own statement through the ONE door, quoted on its card: a card answer, not a field
  set_risk_occurrence: 'slice_3', // Olumi's occurrence range for a risk root (`risk-occurrence.ts`): an estimate the user could correct, not yet a card field
  confirm_goal_reading: 'none', // the user's answer to how the goal's target is read: a card answer, not a numeric field
  set_goal_deadline: 'slice_3', // the goal's date (`goal_horizon.deadline`, new on staging 7 Oct): with goal target and limits (S3, S-E)
  confirm_identity: 'none',
  set_option_status: 'none',
  rename_option: 'none', // S5: the option's name, proposed on its card and renamed only by the press: a structural act, not an estimate
  adopt_olumi_option: 'slice_3',
  replace_draft: 'none', // a whole revised draft, approved as one act; nothing in it is a figure this card edits
  repoint_goal: 'none', // a complete governing-outcome interpretation, approved as one act
  apply_saved_correction: 'none', // canonical targeted edits prepared together; no estimate field on this card
  living_change: 'none', // thin core: a living-model change approved as one act; this legacy card edits none of it (a factor's new point value is SHOWN, never editable)
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

/**
 * A core proposal's NEW factor or link (`living_change` add), shown so the canvas can draw it where it would land. Never
 * editable, and never a `ProposalField`: an amend names editable fields only, so an edit naming one is `unknown_field`.
 */
export interface FactorAddField {
  readonly field_id: string;
  readonly kind: 'factor_add';
  readonly node_id: string;
  readonly label: string;
  /** Its point level, when it has one (a range or no unit: null). */
  readonly value: { readonly value: number; readonly unit: string } | null;
  readonly source: 'estimate' | 'yours';
  readonly editable: false;
}
export interface LinkAddField {
  readonly field_id: string;
  readonly kind: 'link_add';
  readonly link_id: string;
  readonly from_id: string;
  readonly to_id: string;
  readonly from_label: string;
  readonly to_label: string;
  readonly direction: 'positive' | 'negative';
  readonly source: 'estimate' | 'yours';
  readonly editable: false;
}
/**
 * Everything else a core approval writes, one plain sentence per changed item (Track 3, 22 Oct: 12/12 approve presses wrote
 * changes the card never showed; 9/12 showed nothing). Never editable; whose figure it is, as for an add.
 */
export interface ChangeNoteField {
  readonly field_id: string;
  readonly kind: 'change_note';
  readonly text: string;
  readonly source: 'estimate' | 'yours' | 'party' | 'unverified';
  readonly editable: false;
}
export type AddField = FactorAddField | LinkAddField | ChangeNoteField;

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
  /** A core proposal's new factors and links, shown (never edited); absent when it adds none. In the digest when present. */
  readonly adds?: readonly AddField[];
  readonly missing: readonly MissingDatum[];
  /**
   * ⭐ NO SILENT LAPSE (PR-2): a card kept for review carries its "Review this change" action. It is projected beside its
   * "Not now" in place of its approve (wire-only: never in the digest), so a reload shows it too.
   */
  readonly review_action?: CardAction;
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
    // A held precondition has no Run level to resolve: the card discloses its option-bound omission below.
    if (kind === 'risk' && readReliesOnRisk((o.value as Rec).relies_on) !== undefined) continue;
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
  // This reader rebuilds card detail on reload; the dispatch-only detail would otherwise disappear.
  for (const line of heldReliesOnRiskLines(ops as PatchOperation[], graph)) {
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
    } else if (o.op === 'living_change' && o.path.startsWith('factor:') && v['change'] === 'change' && isRec(v['after'])) {
      // A core proposal (path-b `living_change`, the whole proposed model diffed item by item): a factor whose point value
      // changes is projected so the canvas can show it on the card it changes (Lenses #2880, 21 Oct: core cards had no
      // fields). A range stays a range (not projected); a party's or unverified figure is never shown as Olumi's estimate;
      // never editable, because a core approval writes the proposed model exactly as prepared. A new figure is the person's
      // only with NEW words of theirs: one kept under their earlier quote is not theirs (Codex #3554 R1: 10 → 24 under
      // "We have 10 hours." read as "yours"), so it is not shown at all.
      const a = v['after'];
      const b = isRec(v['before']) ? v['before'] : {};
      const id = o.path.slice('factor:'.length);
      // Olumi's labelled estimate on anyone's item is Olumi's figure, never "yours" (Codex r2 on #3632).
      const olumis = a['source'] === 'olumi' || a['estimate_by'] === 'olumi';
      const theirs = a['source'] === 'user' && typeof a['quote'] === 'string' && a['quote'] !== '' && a['quote'] !== b['quote'];
      if (typeof a['value'] !== 'number' || !Number.isFinite(a['value']) || a['low'] != null || a['high'] != null
        || typeof a['unit'] !== 'string' || a['unit'] === '' || a['value'] === b['value']
        || (!olumis && !theirs)) continue;
      fields.push({ field_id: `factor_value:${id}`, kind: 'factor_value', node_id: id,
        label: typeof a['label'] === 'string' ? a['label'] : labelOf(id), unit: a['unit'],
        current: { value: a['value'], unit: a['unit'], source: olumis ? 'estimate' : 'yours' },
        filled_missing: typeof b['value'] !== 'number', editable: false });
    }
  }
  // A label the saved graph lacks (an aim with no graph node) is read from the saved living model (Track 3: the link into
  // the hiring aim "productivity" was dropped from the card, then written).
  const living = isRec(graph) && isRec(graph['living_model']) ? graph['living_model'] : {};
  const livingLabel = (id: string): string | undefined => {
    for (const k of ['aims', 'options', 'factors', 'risks']) {
      const hit = (Array.isArray(living[k]) ? living[k] as unknown[] : []).filter(isRec).find((x) => x['id'] === id);
      const words = hit?.['label'] ?? hit?.['text'];
      if (typeof words === 'string' && words.trim() !== '') return words;
    }
    return undefined;
  };
  const savedLabelOf = (id: string): string => { const l = labelOf(id); return l !== id ? l : livingLabel(id) ?? id; };
  const shownAdds = coreAdds(p.operations, savedLabelOf);
  const adds = [...shownAdds, ...coreChangeNotes(p.operations, shownAdds, fields, savedLabelOf)];
  const decline: CardAction = { id: declineChipIdFor(p.proposal_id), label: 'Not now', message: 'Not now.' };
  // A card that adds nothing keeps its digest byte-identical (a card issued before this projection still binds).
  const digest = projectionDigest({ p: p.proposal_id, r: pa.id, g: p.base_graph_identity_hash, approve, decline, fields, missing: [],
    ...(adds.length > 0 ? { adds } : {}) });
  return { proposal_id: p.proposal_id, revision: pa.id, digest, dialect: 'agent', base_graph_hash: p.base_graph_identity_hash,
    approve_action: approve, decline_action: decline, operations: p.operations, fields, ...(adds.length > 0 ? { adds } : {}), missing: [] };
}

/**
 * A core proposal's new factors and links (path-b `living_change` adds), for the canvas to draw where they would land
 * (DL lease, 21 Oct). Same author rule as a changed figure: Olumi's own item is its estimate; the person's only with their
 * words; a party's or unverified item is not shown. A link with no sign is not shown (its direction is unstated). Labels
 * come from the proposed model's own items, else the saved graph; an item with no label anywhere is not shown.
 */
const CARD_KINDS: ReadonlySet<string> = new Set(['aim', 'option', 'factor', 'risk']);
function coreAdds(operations: readonly HeldOp[], savedLabel: (id: string) => string): AddField[] {
  const after = (o: HeldOp): Rec | undefined => (o.op === 'living_change' && isRec(o.value) && isRec(o.value['after']) ? o.value['after'] : undefined);
  // Only items that are cards: a condition, view or history entry has a POSITIONAL id that may equal a card's (Codex R1).
  const proposed = new Map<string, string>();
  for (const o of operations) {
    const a = after(o);
    const words = a?.['label'] ?? a?.['text'];
    const sep = o.path.indexOf(':');
    if (a !== undefined && CARD_KINDS.has(o.path.slice(0, sep)) && typeof words === 'string' && words.trim() !== '') proposed.set(o.path.slice(sep + 1), words);
  }
  const labelOf = (id: unknown): string | undefined => {
    if (typeof id !== 'string') return undefined;
    const saved = savedLabel(id);
    return proposed.get(id) ?? (saved !== id ? saved : undefined);
  };
  const source = (a: Rec): 'estimate' | 'yours' | undefined =>
    a['source'] === 'olumi' ? 'estimate' : a['source'] === 'user' && typeof a['quote'] === 'string' && a['quote'] !== '' ? 'yours' : undefined;
  const adds: AddField[] = [];
  for (const o of operations) {
    const a = after(o);
    if (a === undefined || (o.value as Rec)['change'] !== 'add') continue;
    const by = source(a);
    if (by === undefined) continue;
    const id = o.path.slice(o.path.indexOf(':') + 1);
    if (o.path.startsWith('factor:')) {
      const label = labelOf(id);
      if (label === undefined) continue;
      const point = typeof a['value'] === 'number' && Number.isFinite(a['value']) && a['low'] == null && a['high'] == null
        && typeof a['unit'] === 'string' && a['unit'] !== '';
      adds.push({ field_id: `factor_add:${id}`, kind: 'factor_add', node_id: id, label,
        value: point ? { value: a['value'] as number, unit: a['unit'] as string } : null,
        source: point && a['estimate_by'] === 'olumi' ? 'estimate' : by, editable: false });
    } else if (o.path.startsWith('link:')) {
      const sign = isRec(a['effect']) ? a['effect']['sign'] : null;
      const from = labelOf(a['from']);
      const to = labelOf(a['to']);
      if ((sign !== '+' && sign !== '-') || from === undefined || to === undefined) continue;
      adds.push({ field_id: `link_add:${id}`, kind: 'link_add', link_id: id, from_id: String(a['from']), to_id: String(a['to']),
        from_label: from, to_label: to, direction: sign === '-' ? 'negative' : 'positive', source: by, editable: false });
    }
  }
  return adds;
}
type NoteSource = ChangeNoteField['source'];
type Who = { readonly tag: string; readonly source: NoteSource };
/** The canvas reader drops a longer note (DGAI proposalFields): a longer sentence is split into parts, never cut. */
const NOTE_MAX = 400;
const quoted = (t: string): string => `‘${t}’`;
/** Content, never key order (a stored hold may come back from JSONB in another order; Codex r1 on #3632). */
const stableJson = (v: unknown): string => (Array.isArray(v) ? `[${v.map(stableJson).join(',')}]`
  : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Rec)[k])}`).join(',')}}`
    : JSON.stringify(v ?? null));
const OLUMI: Who = { tag: 'Olumi’s estimate', source: 'estimate' };
/** Whose a record is: Olumi's estimate, the person's, a named party's, or a source not yet confirmed. */
function whoseOf(r: Rec): Who {
  if (r['source'] === 'olumi') return OLUMI;
  if (r['source'] === 'user') return { tag: 'yours', source: 'yours' };
  if (r['source'] === 'party') return { tag: typeof r['party'] === 'string' && r['party'] !== '' ? `${r['party']}’s` : 'a party’s', source: 'party' };
  return { tag: 'source not yet confirmed', source: 'unverified' };
}
/** The words for each part of a living-model item (src/schemas/living-model.ts); an unlisted key is said as written. */
const KEY_WORDS: Readonly<Record<string, string>> = { label: 'name', text: 'wording', quote: 'recorded words', value: 'figure',
  low: 'low end', high: 'high end', sd: 'spread', unit: 'unit', form: 'form', sign: 'direction', target: 'target', quantity: 'measure',
  comparator: 'comparison', by_when: 'date', period_months: 'period', baseline: 'baseline', current: 'today’s level',
  current_unit: 'today’s unit', change_kind: 'kind of change', status: 'status', kind: 'type', limit: 'limit', defined_as: 'definition',
  op: 'kind', of: 'parts', occurrence: 'chance', horizon_months: 'window', effect: 'effect', from: 'from', to: 'to',
  applies_to: 'applies to', role: 'role', developed_from: 'developed from', holder: 'holder', position: 'view', reduction: '' };
const VALUE_WORDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  comparator: { '>=': 'at least', '<=': 'at most', '<': 'below', '>': 'above', '=': 'exactly', increase: 'an increase', decrease: 'a decrease' },
  sign: { '+': 'raises it', '-': 'lowers it' }, op: { sum: 'the sum', product: 'the product' },
  status: { feasible: 'compared', infeasible: 'ruled out (kept in view)', removed: 'taken out of the comparison', current: 'current', later: 'for later', withdrawn: 'withdrawn' },
  form: { point: 'a point figure', exact: 'exact', range: 'a range', normal: 'a normal spread', direction_only: 'direction only', unknown: 'not known' },
  change_kind: { absolute: 'an absolute change', relative: 'a relative change', points: 'percentage points' },
  role: { challenge: 'a challenge', assumption: 'an assumption', prerequisite: 'a prerequisite' }, kind: { factor: 'a factor', outcome: 'an outcome' } };
const KEY_ORDER: readonly string[] = ['label', 'text', 'holder', 'position', 'quantity', 'comparator', 'op', 'of', 'value', 'reduction', 'low', 'high', 'sd', 'unit', 'form', 'sign'];
/** Parts said in the plural. */
const PLURAL: ReadonlySet<string> = new Set(['quote', 'of', 'applies_to']);
/** Keys whose values are other items' ids, said by name. */
const REF_KEYS: ReadonlySet<string> = new Set(['from', 'to', 'factor_id', 'of', 'applies_to', 'developed_from']);
/** Who-keys of a record, and the parts of that record each one says whose they are; `source`/`party` say the rest. */
const OWNER_KEYS: Readonly<Record<string, { readonly words: string; readonly parts: readonly string[] }>> = {
  // Olumi's WHOLE figure on another's item (schema `estimateBy`): its size, never the direction the source stated (Codex r4).
  estimate_by: { words: 'figure', parts: ['value', 'low', 'high', 'sd', 'unit', 'form'] },
  current_source: { words: 'today’s level', parts: ['current', 'current_unit'] }, horizon_by: { words: 'window', parts: ['horizon_months'] } };
const WHO_KEYS: ReadonlySet<string> = new Set(['source', 'party', ...Object.keys(OWNER_KEYS)]);
/** Lists of records, each told apart by the item it names. */
const ELEMENT: Readonly<Record<string, { readonly key: string; readonly words: (name: string) => string }>> = {
  settings: { key: 'factor_id', words: (n) => `setting for ${n}` }, mitigations: { key: 'factor_id', words: (n) => `reduction by ${n}` } };
/** A share said as an exact percentage (a risk's chance, a step's reduction), never rounded away (Codex r3: 0.0004 read 0%). */
const SHARE = /(?:^|\.)(?:occurrence\.(?:low|high)|reduction)$/;
/**
 * A share as a percentage, by moving the decimal point in its written digits: every digit kept, never re-read as a number
 * (Codex r4: 12.3456789012%; r5: a re-read rounded 12.345678901234568% to …567%).
 */
function percentText(v: number): string {
  const [m = '', e = '0'] = String(v).split('e');
  const neg = m.startsWith('-');
  const [i = '', f = ''] = m.replace('-', '').split('.');
  let digits = i + f;
  let point = i.length + Number(e) + 2;
  if (point <= 0) { digits = '0'.repeat(1 - point) + digits; point = 1; }
  if (point > digits.length) digits += '0'.repeat(point - digits.length);
  const whole = digits.slice(0, point).replace(/^0+(?=\d)/, '');
  const frac = digits.slice(point).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac === '' ? '' : `.${frac}`}%`;
}
/** A unit is said with its figures; on its own only where its record has none. */
const UNIT_OF: Readonly<Record<string, readonly string[]>> = { unit: ['value', 'low', 'high', 'sd'], current_unit: ['current'] };
const hasFigure = (r: Rec, unitKey: string): boolean => (UNIT_OF[unitKey] ?? []).some((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));

/** One said part of an item: its words, what it says, and whose it is (absent where the part says whose it is itself). */
interface Said { readonly path: string; readonly text: string; readonly who?: Who; readonly owners?: readonly Who[] }

/**
 * ⭐ THE CARD SHOWS EVERY CHANGE IT WRITES (Track 3, 22 Oct, consent: 12/12 core approvals wrote changes the card never
 * showed). Re-scoped after Codex r3 on #3632 (per-kind sentences kept leaving parts unshown or misattributed): each note is
 * built BY STRUCTURE. A changed item says every part that differs, "<part> was X, now Y"; an added item says every part it
 * writes; a removed item is named. Each value as written (its record's unit; a share as an exact %; ids by name), each run of
 * parts with whose its record is (Olumi's labelled estimate first). What a field or add already shows in full is not repeated.
 * History entries (the host's own record) excepted. Nothing is cut: a longer note is split into numbered parts.
 */
function coreChangeNotes(operations: readonly HeldOp[], adds: readonly AddField[], fields: readonly ProposalField[],
  savedLabel: (id: string) => string): ChangeNoteField[] {
  // Labels as the card's adds read them: the proposed model's own items first, then the saved ones.
  const proposed = new Map<string, string>();
  for (const o of operations) {
    const a = o.op === 'living_change' && isRec(o.value) && isRec(o.value['after']) ? o.value['after'] : undefined;
    const words = a?.['label'] ?? a?.['text'];
    const sep = o.path.indexOf(':');
    if (a !== undefined && CARD_KINDS.has(o.path.slice(0, sep)) && typeof words === 'string' && words.trim() !== '') proposed.set(o.path.slice(sep + 1), words);
  }
  const name = (id: unknown): string => quoted(typeof id === 'string' ? proposed.get(id) ?? savedLabel(id) : 'an item');
  // Whose a part is: its record's own who-key for that part, else the nearest record that says whose it is.
  const whoOf = (chain: readonly Rec[], key?: string): Who => {
    const own = chain[chain.length - 1]!;
    for (const [k, o] of Object.entries(OWNER_KEYS)) {
      if (key !== undefined && o.parts.includes(key) && own[k] === 'olumi') return OLUMI;
      if (key !== undefined && o.parts.includes(key) && own[k] === 'user') return { tag: 'yours', source: 'yours' };
    }
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const r = chain[i]!;
      if (r['source'] != null) return whoseOf(r);
      if (i === 0 && typeof r['holder'] === 'string') return { tag: `${r['holder']}’s`, source: 'party' };
    }
    return whoseOf(chain[0]!);
  };
  const unitOf = (chain: readonly Rec[], key: string): string => {
    const own = chain[chain.length - 1]!;
    if (key === 'current' && typeof own['current_unit'] === 'string') return own['current_unit'];
    if (key === 'horizon_months' || key === 'period_months') return 'months';
    for (let i = chain.length - 1; i >= 0; i -= 1) if (typeof chain[i]!['unit'] === 'string') return chain[i]!['unit'] as string;
    return '';
  };
  const say = (v: unknown, key: string, path: string, chain: readonly Rec[]): string => {
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return 'not stated';
    if (REF_KEYS.has(key)) return Array.isArray(v) ? v.map(name).join(' and ') : name(v);
    if (typeof v === 'string') return VALUE_WORDS[key]?.[v] ?? `“${v}”`;
    if (typeof v === 'number') return SHARE.test(path)
      ? percentText(v) : sayFigureWithoutRounding(v, unitOf(chain, key));
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? `“${x}”` : stableJson(x))).join(' and ');
    return stableJson(v);
  };
  // A fixed order (the item's words, then its figure as a person reads it, the rest by key, the recorded words last): never key order.
  const rank = (k: string): number => { const i = KEY_ORDER.indexOf(k); return k === 'quote' ? KEY_ORDER.length + 1 : i < 0 ? KEY_ORDER.length : i; };
  // Each run of parts with the same owner closes with whose they are.
  const tagged = (said: readonly Said[], sep: string): string => said.map((s, i) => {
    const next = said[i + 1];
    return s.who !== undefined && (next?.who === undefined || next.who.tag !== s.who.tag) ? `${s.text} (${s.who.tag})` : s.text;
  }).join(sep);
  const keysOf = (b: Rec, a: Rec): string[] => [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()
    .sort((x, y) => rank(x) - rank(y)).filter((k) => k !== 'id' && !WHO_KEYS.has(k));
  const join = (words: readonly string[]): string => words.filter((w) => w !== '').join(' ');
  // Every part a record writes (an added item or sub-record), skipping empty parts.
  const list = (a: Rec, chain: readonly Rec[], words: readonly string[], path: string, skip: ReadonlySet<string>, out: Said[]): void => {
    for (const k of keysOf({}, a)) {
      const v = a[k];
      const p = path === '' ? k : `${path}.${k}`;
      if (skip.has(p) || v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (k in UNIT_OF && hasFigure(a, k))) continue;
      const w = [...words, KEY_WORDS[k] ?? k.replace(/_/g, ' ')];
      if (ELEMENT[k] !== undefined && Array.isArray(v)) {
        for (const el of v.filter(isRec)) list(el, [...chain, el], [...words, ELEMENT[k]!.words(name(el[ELEMENT[k]!.key]))], p, new Set([`${p}.${ELEMENT[k]!.key}`]), out);
      } else if (isRec(v)) list(v, [...chain, v], w, p, skip, out);
      else out.push({ path: p, text: `${join(w)} ${say(v, k, p, chain)}`, who: whoOf(chain, k) });
    }
  };
  // A removed record's parts, each run with whose they were (Codex r4: a removed party's limit lost its owner), and those
  // owners, for the note's own source (r5: a removed Olumi estimate under the person's setting read as "yours").
  const removed = (path: string, words: readonly string[], a: Rec, chain: readonly Rec[], skip: ReadonlySet<string> = new Set()): Said => {
    const out: Said[] = [];
    list(a, chain, [], path, skip, out);
    return { path, text: `${join(words)} removed (was ${tagged(out, ', ') || 'nothing'})`, owners: out.flatMap((x) => (x.who === undefined ? [] : [x.who])) };
  };
  // Every part that differs between two versions of a record, and every change of whose a part is.
  const diff = (b: Rec, a: Rec, cb: readonly Rec[], ca: readonly Rec[], words: readonly string[], path: string, out: Said[]): void => {
    for (const k of keysOf(b, a)) {
      const bv = b[k];
      const av = a[k];
      if (stableJson(bv ?? null) === stableJson(av ?? null)) continue;
      const p = path === '' ? k : `${path}.${k}`;
      const w = [...words, KEY_WORDS[k] ?? k.replace(/_/g, ' ')];
      const el = ELEMENT[k];
      if (el !== undefined && (Array.isArray(bv) || Array.isArray(av))) {
        // Each entry kept, a repeat of the same item by its turn (Codex r4: a duplicate setting hid a write).
        const byId = (xs: unknown): Map<string, Rec> => {
          const m = new Map<string, Rec>();
          (Array.isArray(xs) ? xs : []).filter(isRec).forEach((x, i) => {
            const base = typeof x[el.key] === 'string' ? x[el.key] as string : `#${i}`;
            let k = base;
            for (let n = 2; m.has(k); n += 1) k = `${base}#${n}`;
            m.set(k, x);
          });
          return m;
        };
        const was = byId(bv);
        const now = byId(av);
        for (const id of [...new Set([...now.keys(), ...was.keys()])]) {
          const eb = was.get(id);
          const ea = now.get(id);
          const named = name((ea ?? eb)![el.key]);
          const ew = [...words, `${el.words(named)}${id.includes('#') ? ` (entry ${id.slice(id.indexOf('#') + 1)})` : ''}`];
          if (eb === undefined) list(ea!, [...ca, ea!], [...words, `new ${ew[ew.length - 1]}`], p, new Set([`${p}.${el.key}`]), out);
          else if (ea === undefined) out.push(removed(p, ew, eb, [...cb, eb], new Set([`${p}.${el.key}`])));
          else if (stableJson(eb) !== stableJson(ea)) diff(eb, ea, [...cb, eb], [...ca, ea], ew, p, out);
        }
      } else if ((isRec(bv) || bv == null) && (isRec(av) || av == null)) {
        if (isRec(bv) && isRec(av)) diff(bv, av, [...cb, bv], [...ca, av], w, p, out);
        else if (isRec(av)) list(av, [...ca, av], [...words, `new ${KEY_WORDS[k] ?? k.replace(/_/g, ' ')}`], p, new Set(), out);
        else if (isRec(bv)) out.push(removed(p, w, bv, [...cb, bv]));
      } else {
        const was = say(bv, k, p, cb);
        const now = say(av, k, p, ca);
        out.push({ path: p, text: `${join(w)} ${PLURAL.has(k) ? 'were' : 'was'} ${was}, now ${now}${was === now ? ' (a different item with the same name)' : ''}`, who: whoOf(ca, k) });
      }
    }
    // Whose it is, said where it changes: the record's own source, and each who-key's parts.
    if (stableJson([b['source'], b['party']]) !== stableJson([a['source'], a['party']]) && whoOf(cb).tag !== whoOf(ca).tag) {
      out.push({ path: `${path}.source`, text: `${join(words) === '' ? 'it' : join(words)} is now ${whoOf(ca).tag} (was ${whoOf(cb).tag})` });
    }
    for (const [k, o] of Object.entries(OWNER_KEYS)) {
      const part = o.parts.find((x) => x in a || x in b) ?? o.parts[0]!;
      if (b[k] !== a[k] && whoOf(cb, part).tag !== whoOf(ca, part).tag) {
        const what = k === 'estimate_by' && join(words) !== '' ? join(words) : join([...words, o.words]);
        out.push({ path: `${path}.${k}`, text: `${what} is now ${whoOf(ca, part).tag} (was ${whoOf(cb, part).tag})` });
      }
    }
  };
  const sentence = (said: readonly Said[]): string => tagged(said, '; ');
  // Olumi's estimate anywhere marks the note Olumi's; else one owner of every part is the note's; else the item's.
  const sourceOf = (said: readonly Said[], item: Who): NoteSource => {
    const owners = new Set(said.flatMap((s) => [...(s.who === undefined ? [] : [s.who]), ...(s.owners ?? [])].map((w) => w.source)));
    return owners.has('estimate') ? 'estimate' : owners.size === 1 ? [...owners][0]! : item.source;
  };
  const shownFigure = new Map<string, string>();
  for (const f of fields) if (f.kind === 'factor_value') shownFigure.set(`factor:${f.node_id}`, f.current.source);
  const addOf = new Map(adds.map((a) => [a.kind === 'factor_add' ? `factor:${a.node_id}` : a.kind === 'link_add' ? `link:${a.link_id}` : '', a]));
  const KIND_WORDS: Readonly<Record<string, string>> = { aim: 'the aim', option: 'the option', factor: 'the factor', risk: 'the risk', link: 'the link', condition: 'the condition', view: '' };
  const notes: ChangeNoteField[] = [];
  const used = new Set<string>();
  const push = (path: string, change: string, text: string, source: NoteSource): void => {
    // Split into parts the canvas reads in full (each "(n/N)"), at clause boundaries ("; ") so a figure stays with its unit;
    // only a single clause longer than a part is split between words, and a single word longer than a part between
    // characters (Codex r2 on #3632: a 401-character word made a 409-character part). No written detail is cut.
    const room = NOTE_MAX - ' (999/999)'.length;
    const words = (clause: string): string[] => clause.split(' ').flatMap((w) => {
      const out: string[] = [];
      for (let k = 0; k < w.length; k += room) out.push(w.slice(k, k + room));
      return out.length === 0 ? [w] : out;
    });
    const pieces = text.length <= NOTE_MAX ? [text] : text.split('; ').flatMap((clause) => {
      if (clause.length <= room) return [clause];
      const out: string[] = [];
      let cur = '';
      for (const w of words(clause)) { if (cur !== '' && `${cur} ${w}`.length > room) { out.push(cur); cur = w; } else cur = cur === '' ? w : `${cur} ${w}`; }
      return cur === '' ? out : [...out, cur];
    });
    const chunks: string[] = [];
    let cur = '';
    for (const piece of pieces) {
      if (cur !== '' && `${cur}; ${piece}`.length > room) { chunks.push(cur); cur = piece; } else cur = cur === '' ? piece : `${cur}; ${piece}`;
    }
    if (cur !== '') chunks.push(cur);
    // One id per note: a positional path (a condition removed and another added at index 0) is told apart by its change.
    let base = `change_note:${path}`;
    for (let n = 1; used.has(base); n += 1) base = `change_note:${path}:${change}${n === 1 ? '' : `:${n}`}`;
    used.add(base);
    chunks.forEach((c, k) => notes.push({ field_id: chunks.length === 1 ? base : `${base}#${k + 1}`, kind: 'change_note',
      text: chunks.length === 1 ? c : `${c} (${k + 1}/${chunks.length})`, source, editable: false }));
  };
  for (const o of operations) {
    if (o.op !== 'living_change' || !isRec(o.value)) continue;
    const sep = o.path.indexOf(':');
    const kind = o.path.slice(0, sep);
    const id = o.path.slice(sep + 1);
    if (kind === 'history') continue;
    const v = o.value;
    const before = isRec(v['before']) ? v['before'] : {};
    const after = isRec(v['after']) ? v['after'] : {};
    const item = v['change'] === 'remove' ? before : after;
    // An item's own words first (a removed item is in no proposed list and may have no saved node), then the card's labels.
    const ownWords = item['label'] ?? item['text'];
    const own = kind === 'link' ? `${name(item['from'])} → ${name(item['to'])}` : kind === 'view' ? `${String(item['holder'] ?? 'a party')}’s view`
      : kind === 'condition' ? `“${String(item['text'] ?? '')}”`
      : typeof ownWords === 'string' && ownWords.trim() !== '' ? quoted(ownWords) : name(id);
    const who = whoOf([item]);
    if (v['change'] === 'remove') {
      push(o.path, 'remove', kind === 'link' ? `Removes the link ${own}.` : kind === 'condition' ? `Moves the condition “${String(before['text'] ?? '')}” to history.`
        : kind === 'view' ? `Replaces ${own}.` : `Removes ${own}.`, who.source);
      continue;
    }
    const said: Said[] = [];
    if (v['change'] === 'add') {
      const shown = addOf.get(o.path);
      // What the add already shows, unless it shows another owner than the item's (then the name says whose it is).
      const skip = new Set(['label', 'text', 'holder', ...(after['kind'] === 'factor' ? ['kind'] : []),
        ...(after['status'] === 'feasible' || after['status'] === 'current' ? ['status'] : [])]);
      // The add shows a point figure with its unit; a figureless add's unit is said here (Codex r4: "hours" was unshown).
      if (shown?.kind === 'factor_add' && shown.value !== null) { skip.add('value'); skip.add('unit'); }
      if (shown?.kind === 'link_add') {
        const e = isRec(after['effect']) ? after['effect'] : {};
        for (const k of ['from', 'to', 'effect.sign', ...(e['form'] === 'direction_only' ? ['effect.form'] : []), ...(hasFigure(e, 'unit') ? [] : ['effect.unit'])]) skip.add(k);
      }
      list(after, [after], [], '', skip, said);
      // A shown add says whose its figure is; where the item is someone else's, the note says so.
      const otherOwner = shown !== undefined && shown.source !== who.source;
      if (shown !== undefined && said.length === 0 && !otherOwner) continue;
      const head = shown !== undefined ? `${own}${otherOwner ? ` is ${who.tag}` : ''}` : `${kind === 'view' ? 'Records' : `Adds ${KIND_WORDS[kind] ?? ''}`.trimEnd()} ${own}`;
      push(o.path, 'add', said.length === 0 ? `${head}${shown !== undefined ? '' : ` (${who.tag})`}.` : `${head}: ${sentence(said)}.`, sourceOf(said, who));
      continue;
    }
    diff(before, after, [before], [after], [], '', said);
    // A changed point figure the card's field shows, with the same owner, is not repeated.
    const field = shownFigure.get(o.path);
    const rest = said.filter((s) => !(field !== undefined && s.path === 'value' && s.who?.source === field));
    if (field !== undefined && rest.length === 0) continue;
    push(o.path, 'change', rest.length === 0 ? `Changes ${own} (${who.tag}).` : `Changes ${kind === 'link' ? 'the link ' : ''}${own}: ${sentence(rest)}.`, sourceOf(rest, who));
  }
  return notes;
}

/** One envelope, with a reader for each stored dialect. */
export function proposalRecord(pa: PendingAction, graph: unknown, nowMs = Date.now()): ProposalRecord | undefined {
  // ⛔ #2851 buddy r2 P1: a held identity card is projected (carried on a turn, served on reload) only while it is still
  // offerable on THIS graph; otherwise its Yes would be refused, which is confirm-then-refuse again (B1 9f32a4b4).
  // Only on a graph actually read: callers that project a record without one (`proposalRecord(h, undefined)`) are unchanged.
  // A card carrying the user's typed part figures (#4b) is judged WITH them, as its Yes would write them.
  const held = agentProposalOf(pa);
  if (isRec(graph) && Array.isArray(graph.nodes) && held !== undefined && held.operations.some((o) => o.op === 'confirm_identity')) {
    const reading = identityReadingOf(held);
    if (reading === undefined || !identityCardOfferable(graph, reading.part_levels, reading)) return undefined;
  }
  const record = productHoldRecord(pa, graph, nowMs) ?? agentProposalRecord(pa, graph, nowMs);
  return record !== undefined && heldCardUnderReview(pa) ? { ...record, review_action: reviewChipFor(record.proposal_id, heldChangeLabel(pa)) } : record;
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
    readonly review_action?: CardAction;
    readonly fields: readonly ProposalField[];
    /** A core proposal's new factors and links (display only); absent when it adds none. */
    readonly adds?: readonly AddField[];
    readonly missing: readonly MissingDatum[];
  }[];
}

/**
 * A held card's record applies to this graph by the one rule (#3024): an Agent card by `heldCardAppliesAt` (its own subject,
 * read on a moved model too: an unrelated approval never hides it); a product hold by its pin.
 */
export function heldRecordAppliesAt(hold: PendingAction, record: ProposalRecord, graph: unknown, graphHash: string | undefined): boolean {
  // A card kept for review is projected on any model (as review, never approvable): a reload must show it (PR-2, A6).
  if (heldCardUnderReview(hold)) return true;
  const p = agentProposalOf(hold);
  return p !== undefined ? heldCardAppliesAt(p, graph, graphHash) : record.base_graph_hash === graphHash;
}

/** The predicate {@link proposalFieldsWire} reads for records built from `holds` on `graph`: each record by its own carrier (revision and proposal id). */
export function heldRecordsApplyAt(holds: readonly PendingAction[], graph: unknown, graphHash: string | undefined): (r: ProposalRecord) => boolean {
  return (r) => holds.some((h) => h.id === r.revision && heldProposalId(h) === r.proposal_id && heldRecordAppliesAt(h, r, graph, graphHash));
}

/**
 * Only records that apply to the model the user sees are projected: pinned to `graphHash`, or (with `applies`, #3024) still
 * applying there by their own rule.
 */
export function proposalFieldsWire(
  records: readonly ProposalRecord[],
  graphHash: string | undefined,
  issuedTurnIds: ReadonlyMap<string, string> = new Map(),
  applies?: (r: ProposalRecord) => boolean,
): ProposalFieldsWire | undefined {
  if (graphHash === undefined || graphHash === '') return undefined;
  const pinned = records.filter((r) => (applies !== undefined ? applies(r) : r.base_graph_hash === graphHash));
  if (pinned.length === 0) return undefined;
  return {
    version: 1,
    graph_hash: graphHash,
    proposals: pinned.map((r) => ({
      proposal_id: r.proposal_id, revision: r.revision, digest: r.digest, approve_action: r.approve_action, decline_action: r.decline_action,
      // Wire-only context: issuing a card never changes the digest of what that card showed.
      issued_turn_id: issuedTurnIds.get(r.revision) ?? null,
      ...(r.review_action !== undefined ? { review_action: r.review_action } : {}),
      fields: r.fields, ...(r.adds !== undefined ? { adds: r.adds } : {}), missing: r.missing,
    })),
  };
}
