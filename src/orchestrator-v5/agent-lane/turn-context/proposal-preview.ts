/**
 * ⭐ THE SUGGESTION PREVIEW ON THE WIRE (DL 5941839936; PANEL 5941783386; the T2 `guidance` precedent). The Agent turn
 * may carry ONE optional root key `proposal_preview: { proposal_id, ops }`: a DISPLAY projection of the STORED
 * proposal's `operations[]`, bound by identity to the consent chip this turn offers for that same proposal id, so the
 * canvas can ghost what a Yes would add before the user presses it. Accept stays on the consent chip: there is no new
 * write path, and nothing here is ever read back as an instruction.
 *
 * Projected: the structure a Yes would draw (`add_edge`, `update_edge`, `set_link_strength` with its band). ids and the
 * band only: never values, reasons, provenance or prose. Every other op (a figure, a level, a limit, a goal target, a
 * status) has nothing to draw and is left out. An op whose ends the graph does not hold, or whose key does not split
 * into exactly two ids, is left out (fail closed). No projected op → no preview. Pure.
 */
import type { InfluenceBand } from '../../format/influence-bands.js';
import type { StructuredProposal } from '../proposal.js';

export type PreviewOp =
  | { readonly op: 'add_edge'; readonly from_id: string; readonly to_id: string }
  | { readonly op: 'update_edge'; readonly from_id: string; readonly to_id: string }
  | { readonly op: 'set_link_strength'; readonly from_id: string; readonly to_id: string; readonly band: InfluenceBand };
export interface ProposalPreview { readonly proposal_id: string; readonly ops: readonly PreviewOp[] }

const BANDS: ReadonlySet<string> = new Set<InfluenceBand>(['weak', 'moderate', 'strong', 'very strong']);
const LINK_KEY_SEP = '::';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The two ends of a link op's key (`from::to`), only when both are node ids this graph holds. */
function endsOf(path: string, nodeIds: ReadonlySet<string>): { from_id: string; to_id: string } | undefined {
  const parts = path.split(LINK_KEY_SEP);
  if (parts.length !== 2) return undefined;
  const [from, to] = parts as [string, string];
  return from !== '' && to !== '' && nodeIds.has(from) && nodeIds.has(to) ? { from_id: from, to_id: to } : undefined;
}

/**
 * The preview for the proposal a consent chip names, or undefined. Identity: the stored proposal's own id must be the
 * chip's; the ends are read against `graph`, the same readback the turn returns.
 */
export function proposalPreviewFor(proposalId: string, proposal: StructuredProposal | undefined, graph: unknown): ProposalPreview | undefined {
  if (proposal === undefined || proposal.proposal_id !== proposalId || !isRec(graph)) return undefined;
  const nodeIds = new Set((Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [])
    .map((n) => n.id).filter((id): id is string => typeof id === 'string'));
  const ops: PreviewOp[] = [];
  for (const o of proposal.operations) {
    if (o.op !== 'add_edge' && o.op !== 'update_edge' && o.op !== 'set_link_strength') continue;
    const ends = typeof o.path === 'string' ? endsOf(o.path, nodeIds) : undefined;
    if (ends === undefined) continue;
    if (o.op === 'set_link_strength') {
      const band = isRec(o.value) ? o.value.band : undefined;
      if (typeof band === 'string' && BANDS.has(band)) ops.push({ op: 'set_link_strength', ...ends, band: band as InfluenceBand });
      continue;
    }
    ops.push({ op: o.op, ...ends });
  }
  return ops.length === 0 ? undefined : { proposal_id: proposalId, ops };
}
