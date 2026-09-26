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
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
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
  /** e.g. "at most 10% per month"; null when the row cannot be said back as the user stated it. */
  readonly stated: string | null;
}

const OPERATOR_WORDS: Readonly<Record<string, string>> = Object.freeze({ '<=': 'at most', '>=': 'at least' });

/**
 * THE USER'S OWN THRESHOLD, said back — or null. Only for a row the user stated
 * (`provenance: 'explicit'`) in a LEVEL frame (absent or `'level'`; a `'delta'` threshold is
 * a change from the baseline and is not said as a level). `value` is "in the user's units"
 * (DraftGoalConstraintSchema) unless CEE rewrote percent → fraction, whose audit trail
 * (`provenance_unit_normalised`) carries the user's original, which is preferred. A bare
 * `fraction` unit with no audit trail is not the user's wording, so it is not said.
 */
export function statedThreshold(row: Record<string, unknown>): string | null {
  const op = typeof row.operator === 'string' ? OPERATOR_WORDS[row.operator] : undefined;
  if (op === undefined || row.provenance !== 'explicit') return null;
  if (row.value_frame !== undefined && row.value_frame !== 'level') return null;
  const audit = readRecord(row.provenance_unit_normalised);
  const value = audit !== null ? audit.original_value : row.value;
  const unitRaw = audit !== null ? audit.original_unit : row.unit;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const unit = typeof unitRaw === 'string' ? unitRaw.trim() : '';
  if (/^fraction$/i.test(unit)) return null;
  const n = value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  if (unit === '') return `${op} ${n}`;
  if (unit.startsWith('%')) return `${op} ${n}${unit}`;
  if (/^[£$€]$/.test(unit)) return `${op} ${unit}${n}`;
  return `${op} ${n} ${unit}`;
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
