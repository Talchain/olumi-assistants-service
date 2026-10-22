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
import { sayFigureAsWritten } from '../say-figure.js';
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
const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** The canvas reader drops a longer note (DGAI proposalFields): a longer sentence is split into parts, never cut. */
const NOTE_MAX = 400;
const quoted = (t: string): string => `‘${t}’`;
/** Content, never key order (a stored hold may come back from JSONB in another order; Codex r1 on #3632). */
const stableJson = (v: unknown): string => (Array.isArray(v) ? `[${v.map(stableJson).join(',')}]`
  : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Rec)[k])}`).join(',')}}`
    : JSON.stringify(v ?? null));
/** A figure as written: its point, its range, its stated spread. */
function figureOf(x: unknown): string | undefined {
  if (!isRec(x)) return undefined;
  const unit = typeof x['unit'] === 'string' ? x['unit'] : '';
  const say = (v: number): string => sayFigureAsWritten(v, unit);
  const parts = [finiteNum(x['value']) ? say(x['value']) : undefined,
    finiteNum(x['low']) && finiteNum(x['high']) ? `between ${say(x['low'])} and ${say(x['high'])}` : undefined,
    finiteNum(x['sd']) ? `standard deviation ${say(x['sd'])}` : undefined].filter((t): t is string => t !== undefined);
  return parts.length === 0 ? undefined : parts.join(', ');
}
/**
 * A link's effect in words. A direction word only where the sign is stated and the figures agree with it; otherwise the
 * figures as written, signed, and what the sign says (Codex r1 on #3632: a range across zero read as "between 2 and 2").
 */
function effectOf(e: unknown): string | undefined {
  if (!isRec(e)) return undefined;
  const verb = e['sign'] === '+' ? 'raises' : e['sign'] === '-' ? 'lowers' : undefined;
  const nums = [e['value'], e['low'], e['high']].filter(finiteNum);
  const crosses = nums.some((n) => n < 0) && nums.some((n) => n > 0);
  const asWritten = figureOf(e);
  if (verb === undefined || crosses || (verb === 'raises' && nums.some((n) => n < 0))) {
    if (asWritten === undefined) return verb === undefined ? undefined : `each 1 more ${verb} it`;
    return `each 1 more changes it by ${asWritten} (${verb === undefined ? 'direction not stated' : `marked as ${verb === 'raises' ? 'raising' : 'lowering'} it`})`;
  }
  const abs = (x: unknown): number | null => (finiteNum(x) ? Math.abs(x) : null);
  const lo = abs(e['low']);
  const hi = abs(e['high']);
  const size = figureOf({ unit: e['unit'], value: abs(e['value']), sd: e['sd'],
    low: lo !== null && hi !== null ? Math.min(lo, hi) : null, high: lo !== null && hi !== null ? Math.max(lo, hi) : null });
  return size === undefined ? `each 1 more ${verb} it` : `each 1 more ${verb} it by ${size}`;
}
/** Whose it is: Olumi's estimate, the person's, a named party's, or a source not yet confirmed. */
function whoseOf(x: unknown): { readonly tag: string; readonly source: NoteSource } {
  const r = isRec(x) ? x : {};
  if (r['source'] === 'olumi') return { tag: 'Olumi’s estimate', source: 'estimate' };
  if (r['source'] === 'user') return { tag: 'yours', source: 'yours' };
  if (r['source'] === 'party') return { tag: typeof r['party'] === 'string' && r['party'] !== '' ? `${r['party']}’s` : 'a party’s', source: 'party' };
  return { tag: 'source not yet confirmed', source: 'unverified' };
}
/** Whose a FIGURE is: Olumi's labelled estimate on anyone's item is Olumi's (Codex r1 on #3632: it was called "yours"). */
function figureWhoseOf(x: unknown): { readonly tag: string; readonly source: NoteSource } {
  return isRec(x) && x['estimate_by'] === 'olumi' ? { tag: 'Olumi’s estimate', source: 'estimate' } : whoseOf(x);
}
const PART_WORDS: Readonly<Record<string, string>> = { label: 'its name', text: 'its wording', value: 'its figure', low: 'its figure',
  high: 'its figure', unit: 'its unit', sd: 'its figure', form: 'its figure', sign: 'its direction', effect: 'its effect', quote: 'the words recorded',
  source: 'whose it is', party: 'whose it is', estimate_by: 'whose figure it is', limit: 'its limit', defined_as: 'its definition',
  target: 'its target', settings: 'what it sets', status: 'whether it is compared', occurrence: 'its chance', horizon_months: 'its window',
  horizon_by: 'its window', mitigations: 'what reduces it', developed_from: 'where it came from', from: 'its ends', to: 'its ends',
  role: 'its role', applies_to: 'what it applies to', holder: 'whose view it is', position: 'the view' };
/** The parts of an item a change touches, in words, each once, in a fixed order (sorted keys). */
function changedParts(before: Rec, after: Rec): string[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter((k) => k !== 'id'
    && stableJson(before[k]) !== stableJson(after[k]));
  return [...new Set(keys.map((k) => PART_WORDS[k] ?? k.replace(/_/g, ' ')))];
}

/**
 * ⭐ THE CARD SHOWS EVERY CHANGE IT WRITES (Track 3, 22 Oct, consent: 12/12 core approvals wrote changes the card never
 * showed: option settings, conditions, range figures, renames, link-effect corrections, removals). One sentence for each
 * changed item a field or add does not already show in full; history entries (the host's own record) excepted. Nothing is
 * cut: a sentence longer than the canvas reads is split into numbered parts.
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
  const CMP: Readonly<Record<string, string>> = { '<=': 'at most', '>=': 'at least', '<': 'below', '>': 'above' };
  // What else an item carries that a field or add never shows: its limit and its definition, each said on its own.
  const limitOf = (x: Rec): string | undefined => {
    const l = isRec(x['limit']) ? x['limit'] : undefined;
    return l !== undefined && finiteNum(l['value'])
      ? `${CMP[String(l['comparator'])] ?? String(l['comparator'])} ${sayFigureAsWritten(l['value'], typeof x['unit'] === 'string' ? x['unit'] : '')} (${whoseOf(l).tag})`
      : undefined;
  };
  const definitionOf = (x: Rec): string | undefined => {
    const d = isRec(x['defined_as']) ? x['defined_as'] : undefined;
    return d !== undefined && Array.isArray(d['of'])
      ? `the ${d['op'] === 'product' ? 'product' : 'sum'} of ${d['of'].map(name).join(' and ')} (${whoseOf(d).tag})` : undefined;
  };
  const extrasOf = (x: Rec): string[] => {
    const l = limitOf(x);
    const d = definitionOf(x);
    return [...(l === undefined ? [] : [`limit ${l}`]), ...(d === undefined ? [] : [`defined as ${d}`])];
  };
  // Whose a limit or definition is, or its recorded words, where only that changes.
  const attributionChange = (part: string, b: Rec, a: Rec): string | undefined => {
    if (whoseOf(b).tag !== whoseOf(a).tag) return `${part} is now ${whoseOf(a).tag} (was ${whoseOf(b).tag})`;
    if (stableJson(b['quote'] ?? null) === stableJson(a['quote'] ?? null)) return undefined;
    return typeof a['quote'] === 'string' && a['quote'] !== '' ? `the words recorded for ${part} are now \u201c${a['quote']}\u201d` : `the words recorded for ${part} are removed`;
  };
  // A changed limit or definition, each part on its own, compared by content (ids, not names; Codex r2 on #3632). A part
  // changed in a way not said here is left to the item's "also changes" list.
  const extraChanges = (before: Rec, after: Rec): { readonly said: string[]; readonly parts: string[] } => {
    const said: string[] = [];
    const parts: string[] = [];
    const lb = isRec(before['limit']) ? before['limit'] : undefined;
    const la = isRec(after['limit']) ? after['limit'] : undefined;
    const limitContent = (l: Rec, x: Rec): string => stableJson([l['comparator'], l['value'], x['unit'] ?? null]);
    const limitSaid = la === undefined ? (lb === undefined ? undefined : `no longer has a limit${limitOf(before) === undefined ? '' : ` (was ${limitOf(before)})`}`)
      : lb === undefined ? (limitOf(after) === undefined ? undefined : `now has a limit of ${limitOf(after)}`)
        : limitContent(lb, before) !== limitContent(la, after) ? `limit now ${limitOf(after) ?? 'not stated'} (was ${limitOf(before) ?? 'not stated'})`
          : attributionChange('its limit', lb, la);
    if (limitSaid !== undefined) { said.push(limitSaid); parts.push('its limit'); }
    const db = isRec(before['defined_as']) ? before['defined_as'] : undefined;
    const da = isRec(after['defined_as']) ? after['defined_as'] : undefined;
    const defContent = (d: Rec): string => stableJson([d['op'], d['of']]);
    const was = definitionOf(before);
    const is = definitionOf(after);
    const defSaid = da === undefined ? (db === undefined ? undefined : `no longer defined${was === undefined ? '' : ` as ${was}`}`)
      : db === undefined ? (is === undefined ? undefined : `now defined as ${is}`)
        : defContent(db) !== defContent(da) ? (was === is ? `now defined as ${is}, from different items with the same names` : `now defined as ${is ?? 'not stated'} (was ${was ?? 'not stated'})`)
          : attributionChange('its definition', db, da);
    if (defSaid !== undefined) { said.push(defSaid); parts.push('its definition'); }
    return { said, parts };
  };
  // A risk's chance, window and what reduces it; an aim's target; an option's status: each said with its content and whose
  // its figure is (buddy BLOCK on #3632: these changes were named, never shown).
  const pct = (x: unknown): string | undefined => (finiteNum(x) ? `${Math.round(x * 1000) / 10}%` : undefined);
  const chanceOf = (x: Rec): string | undefined => {
    const occ = isRec(x['occurrence']) ? x['occurrence'] : {};
    const lo = pct(occ['low']);
    const hi = pct(occ['high']);
    if (lo === undefined || hi === undefined) return finiteNum(x['horizon_months']) ? `within ${x['horizon_months']} months` : undefined;
    // The chance carries no source of its own: it is the risk's, unless marked as Olumi's estimate.
    const whose = occ['estimate_by'] === 'olumi' ? 'Olumi\u2019s estimate' : whoseOf(x).tag;
    return `a ${lo === hi ? lo : `${lo} to ${hi}`} chance${finiteNum(x['horizon_months']) ? ` within ${x['horizon_months']} months` : ''} (${whose})`;
  };
  const reducersOf = (x: Rec): string | undefined => {
    const ms = (Array.isArray(x['mitigations']) ? x['mitigations'] : []).filter(isRec);
    return ms.length === 0 ? undefined : `reduced by ${ms.map((m) => `${name(m['factor_id'])}${pct(m['reduction']) === undefined ? '' : ` (${pct(m['reduction'])} less likely)`}`).join(' and ')}`;
  };
  const CMP_AIM: Readonly<Record<string, string>> = { '>=': 'at least', '<=': 'at most', '=': 'exactly', increase: 'an increase of', decrease: 'a decrease of' };
  const targetOf = (x: Rec): string | undefined => {
    const t = isRec(x['target']) ? x['target'] : undefined;
    if (t === undefined) return undefined;
    const fig = figureOf(t);
    const unitToday = typeof t['current_unit'] === 'string' ? t['current_unit'] : typeof t['unit'] === 'string' ? t['unit'] : '';
    const today = finiteNum(t['current']) ? `, today ${sayFigureAsWritten(t['current'], unitToday)}` : '';
    const by = typeof t['by_when'] === 'string' && t['by_when'] !== '' ? ` by ${t['by_when']}` : '';
    return `target ${CMP_AIM[String(t['comparator'])] ?? String(t['comparator'] ?? '')} ${fig ?? 'no figure yet'}${by}${today}`;
  };
  const STATUS: Readonly<Record<string, string>> = { feasible: 'compared', infeasible: 'ruled out (kept in view)', removed: 'taken out of the comparison' };
  const shownFigure = new Set(fields.flatMap((f) => (f.kind === 'factor_value' ? [`factor:${f.node_id}`] : [])));
  const addOf = new Map(adds.map((a) => [a.kind === 'factor_add' ? `factor:${a.node_id}` : a.kind === 'link_add' ? `link:${a.link_id}` : '', a]));
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
    const own = kind === 'link' ? `${name(item['from'])} → ${name(item['to'])}`
      : typeof ownWords === 'string' && ownWords.trim() !== '' ? quoted(ownWords) : name(id);
    // A view names its holder and carries no source of its own: it is that party's.
    const who = kind === 'view' ? { tag: `${String(item['holder'] ?? 'a party')}’s`, source: 'party' as const } : whoseOf(item);
    const figureOfItem = (x: Rec): string | undefined => (kind === 'link' ? effectOf(x['effect']) : figureOf(x));
    const figureWho = (x: Rec) => figureWhoseOf(kind === 'link' ? (isRec(x['effect']) ? { ...x, ...x['effect'] } : x) : x);
    let text: string | undefined;
    let source: NoteSource = who.source;
    if (v['change'] === 'remove') {
      text = kind === 'link' ? `Removes the link ${own}.` : kind === 'condition' ? `Moves the condition “${String(before['text'] ?? '')}” to history.`
        : kind === 'view' ? `Replaces ${String(before['holder'] ?? 'a party')}’s earlier view.` : `Removes ${own}.`;
    } else if (v['change'] === 'add') {
      const shown = addOf.get(o.path);
      const extras = extrasOf(after);
      const figure = kind === 'factor' || kind === 'link' ? figureOfItem(after) : undefined;
      const fw = figureWho(after);
      // Whose the item is, said beside its name, where its figure is someone else's (a person's factor, Olumi's estimate).
      const split = figure !== undefined && fw.tag !== who.tag;
      if (kind === 'factor' && shown?.kind === 'factor_add' && (shown.value !== null || figure === undefined) && extras.length === 0
        && !split && fw.source === shown.source) continue;
      if (kind === 'link' && shown !== undefined && figure === undefined) continue;
      if (kind === 'factor' || kind === 'link') {
        const said = [figure === undefined ? undefined : `${figure} (${fw.tag})`, ...extras].filter((t): t is string => t !== undefined);
        const tail = shown === undefined && figure === undefined ? ` (${who.tag})` : '';
        text = `${shown !== undefined ? '' : 'Adds '}${kind === 'link' && shown === undefined ? 'the link ' : ''}${own}${split ? ` (${who.tag})` : ''}${said.length > 0 ? `: ${said.join('; ')}` : ''}${tail}.`;
        source = figure !== undefined ? fw.source : who.source;
      } else if (kind === 'option') {
        const sets = (Array.isArray(after['settings']) ? after['settings'] : []).filter(isRec)
          .map((st) => `${name(st['factor_id'])} to ${figureOf(st) ?? 'no figure yet'} (${figureWhoseOf(st).tag})`);
        text = `Adds the option ${own}${sets.length > 0 ? `, which sets ${sets.join('; ')}` : ''} (${who.tag}).`;
      } else if (kind === 'condition') {
        text = `Adds the condition “${String(after['text'] ?? '')}” (${who.tag}).`;
      } else if (kind === 'view') {
        text = `Records ${String(after['holder'] ?? 'a party')}’s view: “${String(after['position'] ?? '')}”.`;
      } else if (kind === 'risk') {
        const said = [chanceOf(after), reducersOf(after)].filter((t): t is string => t !== undefined);
        text = `Adds the risk ${own}${said.length > 0 ? `: ${said.join('; ')}` : ''} (${who.tag}).`;
      } else if (kind === 'aim') {
        const t = targetOf(after);
        text = `Adds the aim ${own}${t === undefined ? '' : `: ${t}`} (${who.tag}).`;
      } else {
        text = `Adds ${own} (${who.tag}).`;
      }
    } else {
      const parts = changedParts(before, after);
      if (kind === 'factor' && shownFigure.has(o.path) && parts.every((p) => p === 'its figure')) continue;
      const said: string[] = [];
      // Whether whose it is has been said beside a figure (else the item's attribution closes the note).
      let tagged = false;
      const oldName = before['label'] ?? before['text'];
      if (parts.includes('its name') || parts.includes('its wording')) said.push(`Renames ${quoted(String(oldName ?? ''))} to ${own}`);
      const done = new Set(['its name', 'its wording']);
      if (kind === 'option') {
        done.add('what it sets');
        const was = new Map((Array.isArray(before['settings']) ? before['settings'] : []).filter(isRec).map((st) => [String(st['factor_id']), st]));
        const now = (Array.isArray(after['settings']) ? after['settings'] : []).filter(isRec);
        for (const st of now) if (stableJson(was.get(String(st['factor_id'])) ?? null) !== stableJson(st)) tagged = said.push(`${own} now sets ${name(st['factor_id'])} to ${figureOf(st) ?? 'no figure yet'} (${figureWhoseOf(st).tag})`) > 0;
        for (const f of was.keys()) if (!now.some((st) => String(st['factor_id']) === f)) said.push(`${own} no longer sets ${name(f)}`);
      } else {
        const was = figureOfItem(before);
        const is = figureOfItem(after);
        if (was !== is) {
          const fw = figureWho(after);
          said.push(`${kind === 'link' ? 'The link ' : ''}${own}: was ${was ?? 'no figure'}, now ${is ?? 'no figure'} (${fw.tag})`);
          tagged = true;
          source = fw.source;
          for (const p of [kind === 'link' ? 'its effect' : 'its figure', 'whose figure it is']) done.add(p);
        }
        if (kind === 'risk') {
          const cWas = chanceOf(before);
          const cIs = chanceOf(after);
          if (cWas !== cIs) { tagged = said.push(`${own}: was ${cWas ?? 'no chance stated'}, now ${cIs ?? 'no chance stated'}`) > 0; for (const p of ['its chance', 'its window', 'whose figure it is']) done.add(p); }
          const rWas = reducersOf(before);
          const rIs = reducersOf(after);
          if (rWas !== rIs) { said.push(`${own}: ${rIs === undefined ? 'no longer reduced by anything' : `now ${rIs}`}`); done.add('what reduces it'); }
        }
        if (kind === 'aim') {
          const tWas = targetOf(before);
          const tIs = targetOf(after);
          if (tWas !== tIs) { said.push(`${own}: was ${tWas ?? 'no target'}, now ${tIs ?? 'no target'}`); done.add('its target'); }
        }
        const extra = extraChanges(before, after);
        for (const x of extra.said) tagged = said.push(`${own}: ${x}`) > 0;
        for (const p of extra.parts) done.add(p);
      }
      if (kind === 'option' && before['status'] !== after['status'] && typeof after['status'] === 'string') { said.push(`${own} is now ${STATUS[after['status']] ?? after['status']}`); done.add('whether it is compared'); }
      const whoWas = whoseOf(before).tag;
      if (parts.includes('whose it is') && kind !== 'view' && whoWas !== who.tag) { said.push(`${own} is now ${who.tag} (was ${whoWas})`); tagged = true; done.add('whose it is'); }
      if (parts.includes('the words recorded') && typeof after['quote'] === 'string' && after['quote'] !== '') { said.push(`${own}: the words recorded are now \u201c${after['quote']}\u201d`); done.add('the words recorded'); }
      const rest = parts.filter((p) => !done.has(p));
      if (rest.length > 0) said.push(said.length === 0 ? `Changes ${kind === 'link' ? 'the link ' : ''}${own}: ${rest.join(', ')}` : `also changes ${rest.join(', ')}`);
      if (said.length === 0) said.push(`Changes ${own}`);
      text = `${said.join('; ')}${tagged ? '' : ` (${who.tag})`}.`;
    }
    push(o.path, String(v['change']), text, source);
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
