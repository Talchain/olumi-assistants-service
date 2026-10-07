/**
 * ⭐ S-D — APPROVE-WITH-EDITS: the user's values written INTO the held proposal, in the estate's own provenance
 * vocabulary, before the EXISTING door applies it (design §6). Pure.
 *
 * Only the named fields change; every other byte of the held batch is kept. A link the user sets gets the middle of
 * the band they chose (`EDGE_STRENGTH_MIDPOINTS`, `edgeBandStd` — the canonical link writer's band arithmetic), signed by
 * the held direction, `provenance.source: 'user_specified'` (what `whoSized`, readiness `link-sizing.ts` and the
 * analysis hash read as the user's), and no `defaulted`. Re-choosing an Agent link's current band keeps its
 * strength and records a review; the figure and its provenance source stay unchanged.
 *
 * What Olumi held for each edited field is recorded on the hold (`user_edits`), so the reply can say what the user set
 * against what Olumi had — the AI value is retained, never overwritten into silence.
 */
import { createHash } from 'node:crypto';
import { createProposal, type StructuredProposal } from '../proposal.js';

import { isKeepProposal, KEEP_PROPOSAL_BASIS } from '../approval-chips.js';

import type { StrengthBand } from '@talchain/schemas/boundary';

import { EDGE_STRENGTH_MIDPOINTS, edgeBandFromMagnitude, strengthBandFromEdgeBand, edgeBandFromStrengthBand, edgeBandStd } from '../../format/edge-strength-bands.js';
import { STRENGTH_BANDS, type HeldOp, type LinkStrengthField, type ProposalRecord, type ValueSource } from './record.js';

/** The hold's own record of what the user set and what Olumi held (`inline_patch.user_edits`). */
export const PROPOSAL_USER_EDITS_KEY = 'user_edits';

export interface ProposalEditsRequest {
  readonly proposal_id: string;
  /** The stored revision the panel showed (`ProposalRecord.revision`): the door applies the edits to that one only. */
  readonly revision: string;
  /** What the panel showed (`ProposalRecord.digest`): the door applies the edits only while it is still exactly that. */
  readonly digest: string;
  readonly graph_hash: string;
  readonly fields: readonly ProposalFieldEdit[];
}

export type ProposalFieldEdit = { readonly field_id: string; readonly band: StrengthBand; readonly value?: never }
  | { readonly field_id: string; readonly value: number; readonly band?: never };
export interface FactorUserEdit {
  readonly kind: 'factor_value';
  readonly field_id: string;
  readonly label: string;
  readonly unit: string;
  readonly olumi: { readonly value: number; readonly source: 'estimate' | 'yours' | 'from_brief' };
  readonly user: { readonly value: number } | null;
}
export type UserEdit = LinkUserEdit | FactorUserEdit;
export interface LinkUserEdit {
  readonly kind?: 'link_strength';
  readonly field_id: string;
  readonly from_label: string;
  readonly to_label: string;
  readonly olumi: { readonly band: StrengthBand; readonly source: ValueSource };
  /** `null` = the user left this field as it was (Olumi's, or already theirs). */
  readonly user: { readonly band: StrengthBand } | null;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const BANDS: ReadonlySet<string> = new Set(STRENGTH_BANDS);
/** Bounded, so an oversized request is refused before any work (a hold carries at most a handful of links). */
const MAX_EDITED_FIELDS = 32;

/**
 * The request's `proposal_edits`, by SHAPE only — whether its fields belong to the proposal is `amendHeldOperations`'
 * question. `undefined` = no edits were sent (a plain approve); `null` = edits were sent but are malformed (refuse).
 */
export function parseProposalEdits(raw: unknown): ProposalEditsRequest | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRec(raw)) return null;
  const { proposal_id: id, revision, digest, graph_hash: hash, fields } = raw;
  if (typeof id !== 'string' || id === '' || typeof revision !== 'string' || revision === '' || typeof digest !== 'string' || digest === ''
    || typeof hash !== 'string' || hash === ''
    || !Array.isArray(fields) || fields.length > MAX_EDITED_FIELDS) return null;
  const out: ProposalFieldEdit[] = [];
  for (const f of fields) {
    if (!isRec(f) || typeof f['field_id'] !== 'string' || f['field_id'] === '' || Object.keys(f).some(k => k !== 'field_id' && k !== 'band' && k !== 'value')) return null;
    if (typeof f['band'] === 'string' && !Object.hasOwn(f, 'value')) out.push({ field_id: f['field_id'], band: f['band'] as StrengthBand });
    else if (typeof f['value'] === 'number' && Number.isFinite(f['value']) && !Object.hasOwn(f, 'band')) out.push({ field_id: f['field_id'], value: f['value'] });
    else return null;
  }
  return { proposal_id: id, revision, digest, graph_hash: hash, fields: out };
}

/**
 * The edits' identity for a request (Codex P1 on the design): the same press with different values is a DIFFERENT
 * request, so a retry can never replay one set of values as another. Canonical: fields sorted by id.
 */
export function proposalEditsDigest(edits: ProposalEditsRequest): string {
  const canonical = JSON.stringify({ p: edits.proposal_id, r: edits.revision, d: edits.digest, g: edits.graph_hash,
    f: [...edits.fields].sort((a, b) => (a.field_id < b.field_id ? -1 : a.field_id > b.field_id ? 1 : 0)).map((f) => [f.field_id, f.band ?? f.value]) });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export type AmendRefusal = 'unknown_field' | 'not_editable' | 'band_not_allowed' | 'duplicate_field' | 'value_not_allowed';
export type AmendResult =
  | { readonly ok: true; readonly operations: readonly HeldOp[]; readonly userEdits: readonly UserEdit[] }
  | { readonly ok: false; readonly reason: AmendRefusal };

/** The held batch with the user's values in it, or the reason it cannot be — never a partial amendment. */
export function amendHeldOperations(record: ProposalRecord<LinkStrengthField>, edits: ProposalEditsRequest['fields']): AmendResult {
  const byId = new Map(record.fields.map((f) => [f.field_id, f] as const));
  const wanted = new Map<string, StrengthBand>();
  for (const e of edits) {
    if (wanted.has(e.field_id)) return { ok: false, reason: 'duplicate_field' };
    const field = byId.get(e.field_id);
    if (field === undefined) return { ok: false, reason: 'unknown_field' };
    if (!field.editable) return { ok: false, reason: 'not_editable' };
    if (e.band === undefined || !BANDS.has(e.band) || !field.allowed_bands.includes(e.band)) return { ok: false, reason: 'band_not_allowed' };
    wanted.set(e.field_id, e.band);
  }
  const operations = record.operations.map((o): HeldOp => {
    const field = o.op === 'add_edge' ? record.fields.find((f) => f.field_id === `link_strength:${o.path}`) : undefined;
    const band = field !== undefined ? wanted.get(field.field_id) : undefined;
    if (field === undefined || band === undefined || !isRec(o.value)) return o;
    const v = o.value;
    const strength = isRec(v['strength']) ? v['strength'] : {};
    const sign = field.direction === 'negative' ? -1 : 1;
    const edgeBand = edgeBandFromStrengthBand(band);
    const keep = band === field.current.band;
    const { defaulted: _defaulted, ...rest } = v;
    return {
      ...o,
      value: {
        ...rest,
        strength: keep ? strength : { ...strength, mean: sign * EDGE_STRENGTH_MIDPOINTS[edgeBand], std: edgeBandStd(edgeBand) },
        effect_direction: field.direction,
        provenance: { source: 'user_specified' },
      },
    };
  });
  // Every field, in the held order: what Olumi held, and what the user set (or `null` when they left it).
  const userEdits: UserEdit[] = record.fields.map((f) => ({ field_id: f.field_id, from_label: f.from_label, to_label: f.to_label,
    olumi: { band: f.current.band, source: f.current.source }, user: wanted.has(f.field_id) ? { band: wanted.get(f.field_id)! } : null }));
  return { ok: true, operations, userEdits };
}

/** The `user_edits` a hold records, read fail-closed (a malformed member is no record). */
export function readUserEdits(raw: unknown): readonly UserEdit[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: UserEdit[] = [];
  for (const x of raw) {
    if (isRec(x) && x['kind'] === 'factor_value') {
      const olumi = x['olumi']; const user = x['user'];
      if (typeof x['field_id'] !== 'string' || typeof x['label'] !== 'string' || typeof x['unit'] !== 'string' || !isRec(olumi)
        || typeof olumi['value'] !== 'number' || !Number.isFinite(olumi['value'])
        || !['estimate', 'yours', 'from_brief'].includes(String(olumi['source']))
        || (user !== null && (!isRec(user) || typeof user['value'] !== 'number' || !Number.isFinite(user['value'])))) return undefined;
      const source = olumi['source'] as FactorUserEdit['olumi']['source'];
      out.push({ kind: 'factor_value', field_id: x['field_id'], label: x['label'], unit: x['unit'],
        olumi: { value: olumi['value'] as number, source }, user: user === null ? null : { value: (user as Rec)['value'] as number } });
      continue;
    }
    if (!isRec(x) || typeof x['field_id'] !== 'string' || typeof x['from_label'] !== 'string' || typeof x['to_label'] !== 'string') return undefined;
    const olumi = x['olumi'];
    const user = x['user'];
    if (!isRec(olumi) || !BANDS.has(String(olumi['band']))) return undefined;
    if (user !== null && (!isRec(user) || !BANDS.has(String(user['band'])))) return undefined;
    const source = olumi['source'];
    if (source !== 'placeholder' && source !== 'estimate' && source !== 'yours') return undefined;
    out.push({ field_id: x['field_id'], from_label: x['from_label'], to_label: x['to_label'],
      olumi: { band: olumi['band'] as StrengthBand, source }, user: user === null ? null : { band: (user as Rec)['band'] as StrengthBand } });
  }
  return out;
}

/** Native domain, as stored on this op. No unit change or model-selected conversion is accepted. */
export function factorValueAllowed(field: import('./record.js').FactorValueField, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (field.cap !== undefined && value > field.cap) return false;
  const scale = field.declared_scale;
  if (scale === 'unit_interval' && value < 0) return false;
  if (isRec(scale)) {
    const min = scale['min']; const max = scale['max'];
    if (typeof min === 'number' && value < min) return false;
    if (typeof max === 'number' && value > max) return false;
  }
  return true;
}

/** New content identity. Only edited ops change, and all untouched keys and ops survive verbatim. */
export function amendAgentProposal(record: ProposalRecord, original: StructuredProposal, edits: ProposalEditsRequest['fields']):
  { ok: true; proposal: StructuredProposal; userEdits: readonly UserEdit[] } | { ok: false; reason: AmendRefusal } {
  const wanted = new Map<string, ProposalFieldEdit>();
  const submitted = new Set<string>();
  for (const e of edits) {
    if (submitted.has(e.field_id)) return { ok: false, reason: 'duplicate_field' };
    submitted.add(e.field_id);
    const f = record.fields.find(f => f.field_id === e.field_id);
    if (!f) return { ok: false, reason: 'unknown_field' };
    if (f.kind === 'factor_value' ? e.value === f.current.value : e.band === f.current.band) continue;
    if (!f.editable) return { ok: false, reason: 'not_editable' };
    if (f.kind === 'factor_value' ? e.value === undefined || !factorValueAllowed(f, e.value)
      : e.band === undefined || !f.allowed_bands.includes(e.band)) return { ok: false, reason: f.kind === 'factor_value' ? 'value_not_allowed' : 'band_not_allowed' };
    wanted.set(e.field_id, e);
  }
  if (wanted.size === 0) return { ok: true, proposal: original, userEdits: [] };
  const reviewed = new Set<string>();
  const operations = original.operations.map(o => {
    const key = o.op === 'set_factor_value' ? `factor_value:${o.path}` : o.op === 'set_link_strength' ? `link_strength:${o.path}` : '';
    const e = wanted.get(key);
    if (!e || !isRec(o.value)) return o;
    if (e.value !== undefined) return { ...o, value: { ...o.value, value: e.value, authored_by: 'user_stated' } };
    const f = record.fields.find(f => f.field_id === key);
    if (!f || f.kind !== 'link_strength') return o;
    const expected = isRec(o.value['expected']) ? o.value['expected'] : {};
    const currentMagnitude = Math.abs(Number(expected['mean']));
    // A review only against a figure the link really holds: a missing mean is never read as 'weak'.
    const keeps = Number.isFinite(currentMagnitude) && e.band === strengthBandFromEdgeBand(edgeBandFromMagnitude(currentMagnitude));
    const magnitude = keeps ? currentMagnitude : EDGE_STRENGTH_MIDPOINTS[edgeBandFromStrengthBand(e.band!)];
    if (keeps) reviewed.add(key);
    return { ...o, value: { ...o.value, magnitude, band: edgeBandFromStrengthBand(e.band!), intent: keeps ? 'confirm_current' : 'set', author: 'user_stated' } };
  });
  const userEdits: UserEdit[] = record.fields.map(f => {
    const e = wanted.get(f.field_id);
    return f.kind === 'factor_value'
      ? { kind: 'factor_value', field_id: f.field_id, label: f.label, unit: f.unit, olumi: { value: f.current.value, source: f.current.source }, user: e?.value !== undefined ? { value: e.value } : null }
      : { field_id: f.field_id, from_label: f.from_label, to_label: f.to_label, olumi: f.current, user: e?.band !== undefined && !reviewed.has(f.field_id) ? { band: e.band } : null };
  });
  return { ok: true, proposal: createProposal({ ...original, operations, provenance: { authored_by: 'user_stated', basis: `edited_from:${original.proposal_id}`, ...(isKeepProposal(original) ? { original_basis: KEEP_PROPOSAL_BASIS } : {}) } }), userEdits };
}
