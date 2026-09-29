/**
 * ⭐ "ADD TO COMPARISON": THE USER ADOPTS AN OPTION OLUMI PROPOSED — the canonical writer (DL #72 5887489508 /
 * 5887510885: Canonical owns the persisted, approved-card write; Runtime supplies the card; Canvas the surface).
 *
 * Construction marks an option Olumi added `proposed_by: 'olumi'` (MG #2295) and the Run's post-gate filter keeps it out
 * of the ordinary comparison. Adopting it REMOVES the mark — nothing else — so the option becomes one of the user's own
 * and the next Run compares it. Since schemas 0.64.0 `proposed_by` is an analysis-hash input, so the write moves the
 * analysis revision: the Run that excluded the option reads stale and a new, user-authorised Run is required.
 *
 * Only on the approval of a DISPLAYED card (`optionAdoptReadingToken` over the option and the card's words), only on the
 * revision the card was issued against, and only for an option that IS Olumi's proposal. The link-effect writer's shape:
 * pure, in-process, committed by the level door's `adopt_option` on the one CAS-guarded append with the existing
 * `edit_graph` receipt.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { EditGraphHandlerFactSchema } from '@talchain/schemas/orchestrator';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { isOlumiProposedOption } from '../context/olumi-proposed-option.js';
import { normaliseAbsenceOnly } from '../persisted-graph-projection.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The reading the approval card SHOWED: which option, in the card's own words. */
export interface OptionAdoptReading {
  readonly option_id: string;
  /** The card's displayed sentence (1..400), bound into the token so other words cannot approve it. */
  readonly words: string;
}

export interface ApplyOptionAdoptEditParams extends OptionAdoptReading {
  /** The STORED graph (strict server-side read) — never a client copy. */
  readonly persistedGraph: unknown;
  /** The wire analysis hash the card was issued against; moved ⇒ `superseded`. */
  readonly expected_graph_hash: string;
  /** `optionAdoptReadingToken` of the reading the user APPROVED; absent or different ⇒ `reading_not_confirmed`. */
  readonly reading_token: string;
}

export type OptionAdoptRefusal =
  | 'words_invalid'
  | 'reading_not_confirmed'
  | 'invalid_graph'
  | 'superseded'
  | 'option_not_found'
  | 'not_proposed';

export type OptionAdoptEditResult =
  | { readonly kind: 'mutated'; readonly mutatedGraph: unknown; readonly graph: GraphV3T; readonly handlerFacts: readonly HandlerFact[] }
  | { readonly kind: 'refused'; readonly reason: OptionAdoptRefusal };

const WORDS_MAX = 400;

/** The token of the card the user approved: the option and the card's own words (no card shown ⇒ no token). */
export function optionAdoptReadingToken(reading: OptionAdoptReading): string {
  const bound = { option_id: reading.option_id, adopt: true, words: reading.words };
  return `adopt:${createHash('sha256').update(stableStringify(bound)).digest('hex')}`;
}

const refuse = (reason: OptionAdoptRefusal): OptionAdoptEditResult => ({ kind: 'refused', reason });

export function applyOptionAdoptEdit(params: ApplyOptionAdoptEditParams): OptionAdoptEditResult {
  const { option_id, words } = params;
  if (typeof words !== 'string' || words.trim() === '' || words.length > WORDS_MAX) return refuse('words_invalid');
  if (typeof params.reading_token !== 'string' || params.reading_token !== optionAdoptReadingToken({ option_id, words })) {
    return refuse('reading_not_confirmed');
  }
  if (!isRec(params.persistedGraph) || !Array.isArray(params.persistedGraph.nodes) || !Array.isArray(params.persistedGraph.edges)) {
    return refuse('invalid_graph');
  }
  const hashBefore = computeAnalysisAffectingGraphHash(params.persistedGraph as never);
  if (hashBefore !== params.expected_graph_hash) return refuse('superseded');

  const graph = structuredClone(params.persistedGraph) as Rec & { nodes: unknown[]; edges: unknown[]; options?: unknown };
  const node = graph.nodes.find((n): n is Rec => isRec(n) && n.id === option_id && n.kind === 'option');
  if (node === undefined) return refuse('option_not_found');
  // Nothing to adopt: the user's own option (or one already adopted) is never "re-adopted" — no write, said so.
  if (!isOlumiProposedOption(node)) return refuse('not_proposed');

  delete node.proposed_by;
  const record = Array.isArray(graph.options)
    ? (graph.options as unknown[]).find((o): o is Rec => isRec(o) && (o.id === option_id || o.option_id === option_id))
    : undefined;
  if (record !== undefined) delete record.proposed_by;

  const parsed = GraphV3.safeParse(graph);
  if (!parsed.success) return refuse('invalid_graph');
  if ((parsed.data.nodes.find((n) => n.id === option_id) as Rec | undefined)?.proposed_by !== undefined) return refuse('invalid_graph');

  const hashAfter = computeAnalysisAffectingGraphHash(graph as never) || null;
  const label = typeof node.label === 'string' && node.label.trim() !== '' ? node.label.trim() : 'this option';
  const summary = `Added "${label}" to the comparison`;
  const fact = EditGraphHandlerFactSchema.parse({
    fact_type: 'edit_graph',
    fact_version: 1,
    noop: false,
    result: {
      edit_kind: 'option_configuration',
      status: 'applied',
      operations_count: 1,
      affected_entities: [{ kind: 'option', label: label.slice(0, 120) }],
      graph_hash_before: hashBefore || null,
      graph_hash_after: hashAfter,
      safe_summary: summary.length <= 80 ? summary : 'Added an option to the comparison',
      impact: 'high',
      rerun_recommended: true,
    },
  });
  return { kind: 'mutated', mutatedGraph: graph, graph: parsed.data, handlerFacts: [fact as HandlerFact] };
}

/** ⛔ ONLY THE ONE MARK MAY GO: no other node, no other member, no edge, no top-level field, no other option record. */
export function optionAdoptPostimageIsScoped(storedBefore: unknown, after: unknown, optionId: string): boolean {
  const before = normaliseAbsenceOnly(storedBefore);
  if (!isRec(before) || !isRec(after) || !Array.isArray(before.nodes) || !Array.isArray(after.nodes)) return false;
  const restored = structuredClone(after) as Rec & { nodes: unknown[]; options?: unknown };
  const at = restored.nodes.findIndex((n) => isRec(n) && n.id === optionId);
  const was = (before.nodes as unknown[]).find((n) => isRec(n) && n.id === optionId);
  if (at < 0 || !isRec(was) || !isOlumiProposedOption(was) || isOlumiProposedOption(restored.nodes[at])) return false;
  (restored.nodes[at] as Rec).proposed_by = was.proposed_by;
  const wasRecord = Array.isArray(before.options)
    ? (before.options as unknown[]).find((o) => isRec(o) && (o.id === optionId || o.option_id === optionId)) : undefined;
  const nowRecord = Array.isArray(restored.options)
    ? (restored.options as unknown[]).find((o) => isRec(o) && (o.id === optionId || o.option_id === optionId)) : undefined;
  if (isRec(wasRecord) && isRec(nowRecord) && Object.hasOwn(wasRecord, 'proposed_by')) nowRecord.proposed_by = wasRecord.proposed_by;
  return isDeepStrictEqual(restored, before);
}
