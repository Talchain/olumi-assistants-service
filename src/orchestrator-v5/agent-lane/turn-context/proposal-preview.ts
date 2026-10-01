/**
 * ⭐ THE SUGGESTION PREVIEW ON THE WIRE (DL 5941839936; PANEL 5941783386; the T2 `guidance` precedent). The Agent turn
 * may carry ONE optional root key `proposal_preview: { proposal_id, ops }`: a DISPLAY projection of the STORED
 * proposal's `operations[]`, bound by identity to the consent chip this turn offers for that same proposal id, so the
 * canvas can ghost what a Yes would do before the user presses it. Accept stays on the consent chip: there is no new
 * write path, and nothing here is ever read back as an instruction.
 *
 * Projected: what a Yes would change on the canvas, as ids + op class + band + flags only, never values, reasons,
 * provenance or prose (Codex pre-review on #2494):
 *   - a new link (`add_edge`), with the band its stored strength falls in when it carries one;
 *   - an edited link (`update_edge`) and a sized link (`set_link_strength`), with the stored band, and `keeps: true` when
 *     the Yes only CONFIRMS the strength it already has (`intent: 'confirm_current'`), so a keep is never drawn as a
 *     change; an edited link also says when it `reverses` its direction;
 *   - an option put in or taken out of the comparison (`set_option_status`), by option id and the status it gets.
 * A figure, a level, a limit or a goal target has nothing to draw and is left out. An op whose ids the graph does not
 * hold as the right kind, whose key is not exactly two ids, or whose band/status is not a known one is left out (fail
 * closed). No projected op → no preview. Pure.
 */
import { edgeBandFromMagnitude } from '../../format/edge-strength-bands.js';
import type { InfluenceBand } from '../../format/influence-bands.js';
import type { StructuredProposal } from '../proposal.js';

type OptionStatus = 'feasible' | 'infeasible' | 'removed';
export type PreviewOp =
  | { readonly op: 'add_edge'; readonly from_id: string; readonly to_id: string; readonly band?: InfluenceBand }
  | { readonly op: 'update_edge'; readonly from_id: string; readonly to_id: string; readonly band: InfluenceBand; readonly keeps: boolean; readonly reverses: boolean }
  | { readonly op: 'set_link_strength'; readonly from_id: string; readonly to_id: string; readonly band: InfluenceBand; readonly keeps: boolean }
  | { readonly op: 'set_option_status'; readonly option_id: string; readonly status: OptionStatus };
export interface ProposalPreview { readonly proposal_id: string; readonly ops: readonly PreviewOp[] }

const BANDS: ReadonlySet<string> = new Set<InfluenceBand>(['weak', 'moderate', 'strong', 'very strong']);
const OPTION_STATUSES: ReadonlySet<string> = new Set<OptionStatus>(['feasible', 'infeasible', 'removed']);
const DIRECTIONS: ReadonlySet<string> = new Set(['positive', 'negative']);
const LINK_KEY_SEP = '::';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The two ends of a link op's key (`from::to`), only when both are node ids this graph holds. */
function endsOf(path: string, kinds: ReadonlyMap<string, unknown>): { from_id: string; to_id: string } | undefined {
  const parts = path.split(LINK_KEY_SEP);
  if (parts.length !== 2) return undefined;
  const [from, to] = parts as [string, string];
  return from !== '' && to !== '' && kinds.has(from) && kinds.has(to) ? { from_id: from, to_id: to } : undefined;
}

const bandOf = (v: unknown): InfluenceBand | undefined => (typeof v === 'string' && BANDS.has(v) ? v as InfluenceBand : undefined);

/**
 * The preview for the proposal a consent chip names, or undefined. Identity: the stored proposal's own id must be the
 * chip's; ids are read against `graph`, the same readback the turn returns.
 */
export function proposalPreviewFor(proposalId: string, proposal: StructuredProposal | undefined, graph: unknown): ProposalPreview | undefined {
  if (proposal === undefined || proposal.proposal_id !== proposalId || !isRec(graph)) return undefined;
  const kinds = new Map((Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [])
    .filter((n) => typeof n.id === 'string').map((n) => [n.id as string, n.kind] as const));
  const ops: PreviewOp[] = [];
  for (const o of proposal.operations) {
    const value = isRec(o.value) ? o.value : {};
    if (o.op === 'set_option_status') {
      const status = value.status;
      if (typeof o.path === 'string' && kinds.get(o.path) === 'option' && typeof status === 'string' && OPTION_STATUSES.has(status)) {
        ops.push({ op: 'set_option_status', option_id: o.path, status: status as OptionStatus });
      }
      continue;
    }
    if (o.op !== 'add_edge' && o.op !== 'update_edge' && o.op !== 'set_link_strength') continue;
    const ends = typeof o.path === 'string' ? endsOf(o.path, kinds) : undefined;
    if (ends === undefined) continue;
    if (o.op === 'add_edge') {
      const magnitude = value.magnitude;
      const band = typeof magnitude === 'number' && Number.isFinite(magnitude) ? edgeBandFromMagnitude(Math.abs(magnitude)) : undefined;
      ops.push({ op: 'add_edge', ...ends, ...(band !== undefined ? { band } : {}) });
      continue;
    }
    const band = bandOf(value.band);
    if (band === undefined) continue;
    const keeps = value.intent === 'confirm_current';
    if (o.op === 'set_link_strength') { ops.push({ op: 'set_link_strength', ...ends, band, keeps }); continue; }
    const wanted = value.direction_intent;
    const was = isRec(value.expected) ? value.expected.effect_direction : undefined;
    const reverses = typeof wanted === 'string' && DIRECTIONS.has(wanted) && typeof was === 'string' && wanted !== was;
    ops.push({ op: 'update_edge', ...ends, band, keeps, reverses });
  }
  return ops.length === 0 ? undefined : { proposal_id: proposalId, ops };
}

/**
 * The preview rides ONLY beside its own consent chip, as the turn ships (Codex pre-review P1 #4 on #2494): the route
 * attaches it AFTER the final egress, with that egress's surviving chips. A turn whose egress removed the chip, or fell
 * back to its safe envelope, carries no preview, and the egress walk never sees (or half-scrubs) these ids.
 */
export function previewBesideItsChip(preview: ProposalPreview | undefined, chipIdFor: (proposalId: string) => string,
  suggestedActions: unknown): ProposalPreview | undefined {
  if (preview === undefined || !Array.isArray(suggestedActions)) return undefined;
  const chip = chipIdFor(preview.proposal_id);
  return suggestedActions.some((a) => isRec(a) && a.id === chip) ? preview : undefined;
}
