/**
 * THE RUN-TURN CARD'S GRAPH — used only when it IS the graph the run was computed on.
 *
 * The route hands `runTurnCoaching` the readback's own graph (routes/agent-v1-turn.ts,
 * `readBackState`). A card may read a fact from it only after this module proves the graph
 * is the one the bound run's hash names: `computeAnalysisAffectingGraphHash(graph) === graphHash`.
 * Anything else — no graph, another turn's graph, a graph the hash function cannot read — is
 * `null`, and the card falls back to words that need no graph. A fact is never taken from a
 * graph the run did not see.
 *
 * Pure: no clock, no LLM, no telemetry.
 */
import { CURRENCY_SYMBOL_TO_CODE } from '../../utils/currency-alphabet.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { collectUnanchoredConstraintTargetIds } from '../tools/handlers/d1-shared/constraint-target-alternative.js';
import { readRecord } from './fragile-link-challenge.js';

/** The graph, when (and only when) its analysis-affecting hash is `graphHash`. */
export function graphBoundToHash(graph: unknown, graphHash: string): Record<string, unknown> | null {
  const record = readRecord(graph);
  if (record === null) return null;
  let hash: string | null;
  try {
    hash = computeAnalysisAffectingGraphHash(record as never);
  } catch {
    // The hash function throws on a persisted graph it cannot read (run-analysis-snapshot-binding.ts).
    return null;
  }
  return hash === graphHash ? record : null;
}

/** The most limits one card names; more than this and the card names none (the generic words). */
export const MAX_NAMED_LIMITS = 3;

/** One limit the card may name: its node's label and, when provably the user's own, the stated threshold. */
export interface NamedLimit {
  readonly label: string;
  /** e.g. "10% per month"; null when the row cannot be said back as the user stated it. */
  readonly stated: string | null;
}

/**
 * The writers whose contract is "the value is the user's own number, in the user's units", by the
 * row identity each one mints: the agent lane (`agent-lane/admit-constraint.ts`: "Verbatim. The
 * user's number is never adjusted") and `add_constraint` (`tools/handlers/add-constraint.ts`:
 * "stored in USER UNITS … `{ value: 5, unit: '%' }`, NOT 0.05"; it mints `gc-…` or keeps the row's
 * id). The compound-goal extractor is NOT one: it stores a percent as a fraction (`num / 100`) and
 * keeps `unit: '%'` for 100% and over, so "at least 200%" is stored as `2` (#1948 review 5841979260).
 */
const USER_UNIT_WRITER_ID = /^(?:agent-lane:|gc-)/;
/**
 * Currency symbols written BEFORE the figure ("£400,000", "A$5"), derived from THE canonical map
 * (`utils/currency-alphabet.ts`), never restated: every key but the all-letter ones ("CHF", "kr"),
 * which read after it ("500 CHF"). A hand-written `£$€` class failed the currency-vocabulary guard.
 */
const PREFIX_CURRENCY_SYMBOLS: ReadonlySet<string> = new Set(
  Object.keys(CURRENCY_SYMBOL_TO_CODE).filter((symbol) => !/^[a-z]+$/i.test(symbol)),
);
/**
 * Units spelled as a FRACTION of one ("fraction", "proportion/month", "ratio", "share"). The user never states a limit
 * that way: served 26 Sep, the drafter wrote Paul's "under 10%" as `0.1 proportion/month` (Delivery Lead (F)
 * `f-20260926T033924Z`, AI Quality 5843218716). Saying it back would put "0.1" in his mouth, so the card names the
 * limit without a figure, exactly as for a bare `fraction`.
 */
const FRACTION_SPELLED_UNIT = /^(?:fraction|proportion|ratio|share)\b/i;
/** Units whose scale is ambiguous on the wire (percent vs fraction; points; basis points). */
const PERCENT_LIKE_UNIT = /%|\bpercent\b|\bpp\b|\bbps\b|basis point/i;

/**
 * THE USER'S OWN THRESHOLD, said back — or null. Only for a row the user stated
 * (`provenance: 'explicit'`) with a canonical operator, in a LEVEL frame (absent or `'level'`; a
 * `'delta'` threshold is a change from the baseline). A fraction spelling ({@link FRACTION_SPELLED_UNIT}) is never the
 * user's wording.
 * A PERCENT-LIKE unit is said back only when the row proves its scale: an audit trail naming the
 * user's original (`provenance_unit_normalised`, preferred), or a row minted by a user-units writer
 * ({@link USER_UNIT_WRITER_ID}). Scale is never inferred from magnitude.
 *
 * No operator words: the agent lane widens a strict "under 10%" to `<=` and records that as a loss,
 * so "at most 10%" would put the widened bound in the user's mouth. "(10% per month)" is true either way.
 */
export function statedThreshold(row: Record<string, unknown>): string | null {
  if (row.operator !== '<=' && row.operator !== '>=') return null;
  if (row.provenance !== 'explicit') return null;
  if (row.value_frame !== undefined && row.value_frame !== 'level') return null;
  const audit = readRecord(row.provenance_unit_normalised);
  const value = audit !== null ? audit.original_value : row.value;
  const unitRaw = audit !== null ? audit.original_unit : row.unit;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const unit = typeof unitRaw === 'string' ? unitRaw.trim() : '';
  if (FRACTION_SPELLED_UNIT.test(unit)) return null;
  if (PERCENT_LIKE_UNIT.test(unit) && audit === null
    && !(typeof row.constraint_id === 'string' && USER_UNIT_WRITER_ID.test(row.constraint_id))) return null;
  return sayLevel(value, unit);
}

/**
 * A level in its own units, the one way every coaching card says it: "10% per month", "£400,000",
 * "500 CHF", "10 hours"; a bare number when there is no unit. `unit` is trimmed by the caller.
 */
export function sayLevel(value: number, unit: string): string {
  const n = value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  if (unit === '') return n;
  if (unit.startsWith('%')) return `${n}${unit}`;
  if (PREFIX_CURRENCY_SYMBOLS.has(unit)) return `${unit}${n}`;
  return `${n} ${unit}`;
}

/**
 * The labels of THE nodes the model's limits sit on, joined by identity:
 * `goal_constraints[].node_id` → that node's `label`, in the rows' order, one per distinct node.
 * Null when there is no limit row, when a row carries no node id, when a row's node is missing,
 * duplicated or unlabelled, when two limit nodes share a label (the card would name one limit
 * twice), or when the limits sit on more than {@link MAX_NAMED_LIMITS} nodes — the caller then
 * names no limit rather than guessing or truncating.
 */
export function limitNodeLabels(graph: Record<string, unknown>): readonly NamedLimit[] | null {
  const rows = graph.goal_constraints;
  const nodes = graph.nodes;
  if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(nodes)) return null;
  const nodeIds: string[] = [];
  const rowsByNode = new Map<string, Record<string, unknown>[]>();
  for (const raw of rows) {
    const row = readRecord(raw);
    const nodeId = row?.node_id;
    if (row === null || typeof nodeId !== 'string' || nodeId.length === 0) return null;
    if (!nodeIds.includes(nodeId)) nodeIds.push(nodeId);
    rowsByNode.set(nodeId, [...(rowsByNode.get(nodeId) ?? []), row]);
  }
  if (nodeIds.length > MAX_NAMED_LIMITS) return null;
  const limits: NamedLimit[] = [];
  for (const nodeId of nodeIds) {
    const matches = nodes.filter((n) => readRecord(n)?.id === nodeId);
    if (matches.length !== 1) return null;
    const label = readRecord(matches[0])?.label;
    if (typeof label !== 'string' || label.trim().length === 0) return null;
    // The threshold is joined by the SAME identity (node_id), and said only for a node with ONE row.
    const nodeRows = rowsByNode.get(nodeId)!;
    limits.push({ label: label.trim(), stated: nodeRows.length === 1 ? statedThreshold(nodeRows[0]!) : null });
  }
  return new Set(limits.map((l) => l.label)).size === limits.length ? limits : null;
}

/**
 * Is EVERY limit on the run's own graph PROVED to sit on a part of the model Olumi works out from
 * other parts, so that the run certainly could not check it? The proof is the estate's one mirror of
 * PLoT's anchor rule, `collectUnanchoredConstraintTargetIds` (`tools/handlers/d1-shared/
 * constraint-target-alternative.ts`), read on its REFUSAL side, which its docblock says carries the
 * proof: "a node it REFUSES would certainly not have been scored". The run's own summary speaks the
 * same arm from the same collector (`run-analysis.ts` → `constraint-gap-disclosure.ts`
 * `unanchoredTargetRepairStep`), so the card and the summary above it say one thing.
 *
 * `runOptions` is the bound run's `analysis_ready.options` (their interventions). The graph the card
 * holds carries no option interventions, and the anchor rule's second test ("every option pins the
 * target") needs them, so an absent or empty list proves nothing. Every row needs a `constraint_id`;
 * a row without one, a target this graph does not hold, or any row not proved → `false` (today's words).
 * Pure.
 */
export function everyLimitProvedUnanchored(graph: Record<string, unknown>, runOptions: unknown): boolean {
  const rows = graph.goal_constraints;
  if (!Array.isArray(rows) || rows.length === 0) return false;
  if (!Array.isArray(runOptions) || runOptions.length === 0) return false;
  const ids = rows.map((raw) => readRecord(raw)?.constraint_id);
  if (!ids.every((id): id is string => typeof id === 'string' && id.length > 0)) return false;
  const proved = collectUnanchoredConstraintTargetIds(rows, { nodes: graph.nodes, edges: graph.edges, options: runOptions });
  return ids.every((id) => proved.has(id));
}

/**
 * THE LIMITS NAMED BY THESE ROW IDS, joined by identity: each `constraint_id` → its ONE `goal_constraints` row →
 * that row's `node_id` → the node's `label`, with the user's own figure ({@link statedThreshold}) only for a node
 * carrying ONE row (the same rule as {@link limitNodeLabels}). In the ids' order, one per distinct node.
 * Null when any id matches no row or more than one, a row's node is missing, duplicated or unlabelled, two limits
 * share a label, or they sit on more than {@link MAX_NAMED_LIMITS} nodes: the caller then names no limit.
 */
export function limitsNamedByIds(graph: Record<string, unknown>, constraintIds: readonly string[]): readonly NamedLimit[] | null {
  const rows = graph.goal_constraints;
  const nodes = graph.nodes;
  if (constraintIds.length === 0 || !Array.isArray(rows) || !Array.isArray(nodes)) return null;
  const nodeIds: string[] = [];
  for (const id of constraintIds) {
    const matches = rows.filter((r) => readRecord(r)?.constraint_id === id);
    if (matches.length !== 1) return null;
    const nodeId = readRecord(matches[0])?.node_id;
    if (typeof nodeId !== 'string' || nodeId.length === 0) return null;
    if (!nodeIds.includes(nodeId)) nodeIds.push(nodeId);
  }
  if (nodeIds.length > MAX_NAMED_LIMITS) return null;
  const limits: NamedLimit[] = [];
  for (const nodeId of nodeIds) {
    const matches = nodes.filter((n) => readRecord(n)?.id === nodeId);
    if (matches.length !== 1) return null;
    const label = readRecord(matches[0])?.label;
    if (typeof label !== 'string' || label.trim().length === 0) return null;
    const nodeRows = rows.filter((r) => readRecord(r)?.node_id === nodeId);
    limits.push({ label: label.trim(), stated: nodeRows.length === 1 ? statedThreshold(readRecord(nodeRows[0])!) : null });
  }
  return new Set(limits.map((l) => l.label)).size === limits.length ? limits : null;
}
