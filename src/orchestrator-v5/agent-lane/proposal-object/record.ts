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

import { isPendingActionExpired, type PendingAction } from '../../session/pending-action.js';
import { GM_HELD_HANDLER_ID, buildGmHeldPublicCopy } from '../../handlers/edit-graph-referee-gate.js';
import { describeChangeset } from '../../handlers/describe-changeset.js';
import { GM_HELD_GRADED_TODAY_KEY, GM_HELD_SWITCH_FACTORS_KEY, readGradedTodayMember } from '../../routing/add-option-transaction.js';
import { GM_HELD_USER_TODAY_KEY, readUserTodayMember } from '../../routing/add-factor-transaction.js';
import { edgeBandFromMagnitude, strengthBandFromEdgeBand } from '../../format/edge-strength-bands.js';
import { whoSized } from '../strength-authorship-words.js';
import type { ProposalOperation } from '../proposal.js';
import type { PatchOperation } from '../../../orchestrator/types.js';

/** The approve chip id prefix (`approval-chips.ts` APPROVE_PREFIX), restated here only to build the card's id. */
const APPROVE_PREFIX = 'agent-approve-proposal:';
/** ⭐ The typed decline: words alone never set a held proposal aside; this exact press does. */
export const DECLINE_PREFIX = 'agent-decline-proposal:';
export const declineChipIdFor = (proposalId: string): string => `${DECLINE_PREFIX}${proposalId}`;
const GMH_RE = /^gmh_[0-9a-f]{12}$/;
/** The held proposal a typed decline press names, or undefined. */
export function declinedProposalOf(chipId: unknown): string | undefined {
  if (typeof chipId !== 'string' || !chipId.startsWith(DECLINE_PREFIX)) return undefined;
  const id = chipId.slice(DECLINE_PREFIX.length);
  return GMH_RE.test(id) ? id : undefined;
}

export const STRENGTH_BANDS: readonly StrengthBand[] = ['slight', 'moderate', 'strong', 'very_strong'];

/** Whose a value is NOW, read from the held op's own provenance. */
export type ValueSource = 'placeholder' | 'estimate' | 'yours';
export type FieldKind = 'link_strength';

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
  set_factor_value: 'slice_2',
  set_option_intervention: 'slice_2',
  set_link_strength: 'slice_2', // the Agent dialect's link band (S2)
  set_link_effect: 'none', // the user's own verbatim figures: shown, never re-authored
  set_goal_target: 'slice_3',
  set_limit: 'slice_3',
  set_team_time: 'slice_3',
  set_goal_deadline: 'slice_3', // the goal's date (`goal_horizon.deadline`, new on staging 7 Oct): with goal target and limits (S3, S-E)
  confirm_identity: 'none',
  set_option_status: 'none',
  adopt_olumi_option: 'slice_3',
};

export interface ProposalField {
  readonly field_id: string;
  readonly kind: FieldKind;
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

export interface MissingDatum {
  readonly node_id: string;
  readonly label: string;
  readonly kind: 'risk' | 'factor';
  readonly what: 'level_today';
}

export interface CardAction { readonly id: string; readonly label: string; readonly message: string; readonly detail?: string }

/** ⭐ THE ONE PROPOSAL OBJECT — a read model over the persisted carrier. */
export interface ProposalRecord {
  readonly proposal_id: string;
  /**
   * The exact stored revision of this proposal (the carrier's own id). Edits name it, and the door applies them ONLY to
   * that revision, so two panels can never approve each other's values (Codex P0 on the design).
   */
  readonly revision: string;
  /**
   * What the panel SHOWED, bound: the card's words, every field (its ends, their labels, direction, value and whose it
   * is) and the missing data, hashed. Edits name it and the door re-derives it from the stored hold on the stored model,
   * so a rename or any other change to what was shown applies nothing — the analysis hash alone ignores labels
   * (Codex r1 P1 on #2743: a renamed factor took the user's value under a name they never saw).
   */
  readonly digest: string;
  readonly dialect: 'product_hold';
  readonly base_graph_hash: string;
  readonly approve_action: CardAction;
  readonly decline_action: CardAction;
  readonly operations: readonly HeldOp[];
  readonly fields: readonly ProposalField[];
  readonly missing: readonly MissingDatum[];
}

export type HeldOp = { readonly op: string; readonly path: string; readonly value?: unknown };
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

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
function linkField(o: HeldOp, labelOf: (id: string) => string | undefined): ProposalField | undefined {
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
  return { id: `${APPROVE_PREFIX}${pa.chip_id}`, label, message, ...(detail !== undefined ? { detail } : {}) };
}

/**
 * The ONE proposal object for a held product proposal, read against `graph` (the model it is pinned to, or the model
 * it was just re-pinned to). Undefined for anything that is not a live product hold, or whose card words are missing.
 */
export function productHoldRecord(pa: PendingAction, graph: unknown, nowMs: number = Date.now()): ProposalRecord | undefined {
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
  const fields: ProposalField[] = [];
  for (const o of ops) {
    if (FIELD_CLASS_BY_OP[o.op as keyof typeof FIELD_CLASS_BY_OP] !== 'link_strength') continue;
    const f = linkField(o, labelOf);
    if (f !== undefined) fields.push(f);
  }
  const missing = missingOf(pa, ops);
  const digest = createHash('sha256').update(JSON.stringify({
    p: pa.chip_id, r: pa.id, g: pin, m: approve.message,
    f: fields.map((f) => [f.field_id, f.from_id, f.to_id, f.from_label, f.to_label, f.direction, f.current.band, f.current.source, f.editable]),
    x: missing.map((m) => [m.node_id, m.label, m.kind, m.what]),
  })).digest('hex').slice(0, 32);
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

/** What the change is, in the user's words: "the risk 'X'", "the option 'X'", "the factors 'X' and 'Y'". */
export function heldChangeName(pa: PendingAction): string | undefined {
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

/** ⭐ THE WIRE (design §4): `_proposal_fields` on a turn, `proposal_fields` on the graph read. Absent when none is held. */
export interface ProposalFieldsWire {
  readonly version: 1;
  readonly graph_hash: string;
  readonly proposals: readonly {
    readonly proposal_id: string;
    readonly revision: string;
    readonly digest: string;
    readonly approve_action: CardAction;
    readonly decline_action: CardAction;
    readonly fields: readonly ProposalField[];
    readonly missing: readonly MissingDatum[];
  }[];
}

/** Only records pinned to `graphHash` are projected: the values shown are the values on the model the user sees. */
export function proposalFieldsWire(records: readonly ProposalRecord[], graphHash: string | undefined): ProposalFieldsWire | undefined {
  if (graphHash === undefined || graphHash === '') return undefined;
  const pinned = records.filter((r) => r.base_graph_hash === graphHash);
  if (pinned.length === 0) return undefined;
  return {
    version: 1,
    graph_hash: graphHash,
    proposals: pinned.map((r) => ({
      proposal_id: r.proposal_id, revision: r.revision, digest: r.digest, approve_action: r.approve_action, decline_action: r.decline_action,
      fields: r.fields, missing: r.missing,
    })),
  };
}
