/**
 * ⭐ S-D — APPROVE-WITH-EDITS: the user's values written INTO the held proposal, in the estate's own provenance
 * vocabulary, before the EXISTING door applies it (design §6). Pure.
 *
 * Only the named fields change; every other byte of the held batch is kept. A link the user sets gets the middle of
 * the band they chose (`EDGE_STRENGTH_MIDPOINTS`, `edgeBandStd` — the canonical link writer's band arithmetic), signed by
 * the held direction, `provenance.source: 'user_specified'` (what `whoSized`, readiness `link-sizing.ts` and the
 * analysis hash read as the user's), and no `defaulted`. Re-choosing the band the link already sits in keeps its
 * strength and makes it the user's (they stated it), so no figure moves without a reason the user can see.
 *
 * What Olumi held for each edited field is recorded on the hold (`user_edits`), so the reply can say what the user set
 * against what Olumi had — the AI value is retained, never overwritten into silence.
 */
import { createHash } from 'node:crypto';

import type { StrengthBand } from '@talchain/schemas/boundary';

import { EDGE_STRENGTH_MIDPOINTS, edgeBandFromStrengthBand, edgeBandStd } from '../../format/edge-strength-bands.js';
import { STRENGTH_BANDS, type HeldOp, type ProposalRecord, type ValueSource } from './record.js';

/** The hold's own record of what the user set and what Olumi held (`inline_patch.user_edits`). */
export const PROPOSAL_USER_EDITS_KEY = 'user_edits';

export interface ProposalEditsRequest {
  readonly proposal_id: string;
  /** The stored revision the panel showed (`ProposalRecord.revision`): the door applies the edits to that one only. */
  readonly revision: string;
  /** What the panel showed (`ProposalRecord.digest`): the door applies the edits only while it is still exactly that. */
  readonly digest: string;
  readonly graph_hash: string;
  readonly fields: readonly { readonly field_id: string; readonly band: StrengthBand }[];
}

export interface UserEdit {
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
  const out: { field_id: string; band: StrengthBand }[] = [];
  for (const f of fields) {
    if (!isRec(f) || typeof f['field_id'] !== 'string' || f['field_id'] === '' || typeof f['band'] !== 'string') return null;
    out.push({ field_id: f['field_id'], band: f['band'] as StrengthBand });
  }
  return { proposal_id: id, revision, digest, graph_hash: hash, fields: out };
}

/**
 * The edits' identity for a request (Codex P1 on the design): the same press with different values is a DIFFERENT
 * request, so a retry can never replay one set of values as another. Canonical: fields sorted by id.
 */
export function proposalEditsDigest(edits: ProposalEditsRequest): string {
  const canonical = JSON.stringify({ p: edits.proposal_id, r: edits.revision, d: edits.digest, g: edits.graph_hash,
    f: [...edits.fields].sort((a, b) => (a.field_id < b.field_id ? -1 : a.field_id > b.field_id ? 1 : 0)).map((f) => [f.field_id, f.band]) });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export type AmendRefusal = 'unknown_field' | 'not_editable' | 'band_not_allowed' | 'duplicate_field';
export type AmendResult =
  | { readonly ok: true; readonly operations: readonly HeldOp[]; readonly userEdits: readonly UserEdit[] }
  | { readonly ok: false; readonly reason: AmendRefusal };

/** The held batch with the user's values in it, or the reason it cannot be — never a partial amendment. */
export function amendHeldOperations(record: ProposalRecord, edits: ProposalEditsRequest['fields']): AmendResult {
  const byId = new Map(record.fields.map((f) => [f.field_id, f] as const));
  const wanted = new Map<string, StrengthBand>();
  for (const e of edits) {
    if (wanted.has(e.field_id)) return { ok: false, reason: 'duplicate_field' };
    const field = byId.get(e.field_id);
    if (field === undefined) return { ok: false, reason: 'unknown_field' };
    if (!field.editable) return { ok: false, reason: 'not_editable' };
    if (!BANDS.has(e.band) || !field.allowed_bands.includes(e.band)) return { ok: false, reason: 'band_not_allowed' };
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
