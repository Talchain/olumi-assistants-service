/**
 * CHANGESET HONESTY MECHANISM (ROADMAP 1.134 — kills F6+F7).
 *
 * Paul's 16-Jul verdict-flip: an applied edit surfaced as the opaque label
 * "…and 3 more changes" in the hold ask, the chip, AND the applied receipt,
 * so GM could not audit its own applied changeset. The edits applied; the
 * honesty gap was the DESCRIPTION — `describeHeldOperationsSubject` named
 * only the first operation and collapsed the rest into a count.
 *
 * This module is the ONE source of changeset description copy. It derives
 * SPECIFIC, deterministic, per-operation copy (no LLM call) for every
 * operation in the validated PatchOperation vocabulary
 * (`orchestrator/patch-validation.ts`: add/remove/update × node/edge, with
 * tunable value updates named explicitly), and it is consumed by ALL THREE
 * user-facing surfaces via `describeHeldOperationsSubject`:
 *
 *   1. the hold ask        — `buildGmHeldAssistantText` (edit-graph-referee-gate.ts)
 *   2. the chip copy       — `buildGmHeldPublicCopy`   (edit-graph-referee-gate.ts),
 *                            persisted as the pending's public_label/message
 *   3. the applied receipt — `buildGmHeldAppliedReceipt` (gm-held-execute.ts),
 *                            fed from turn-executor's held-execute paths
 *
 * so the three can never diverge again. Unknown operation types get an
 * honest explicit fallback NAMING the op — never a silent count.
 *
 * Copy-shape constraints (load-bearing — see route-v2's replay resolution):
 *   - never `set|update … to …` within the value-update gate's object
 *     window where avoidable: tunable updates say "change 'X' to 0.8"
 *     (`change` is not a clause-A verb in value-update-gate.ts), so
 *     `isValueUpdatePhrasing` stays false on the minted chip message and
 *     the route-level proposal-replay resolution keeps running;
 *   - never `add … constraint` as a direct object (clause D): constraint-
 *     kind nodes render WITHOUT their kind word;
 *   - never the literal phrase "success target" (clause C): goal-threshold
 *     updates say "change the target for 'X' to …";
 *   - no em dash, no internal ids, no raw op tokens outside the sanitised
 *     unknown-op fallback — every subject still passes through each
 *     surface's `sanitisePublicCopyOrFallback` sweep, which falls back to
 *     the generic swept copy if a hostile label sneaks a forbidden token in.
 */

import { formatFactorValue } from '../compose/format-factor-value.js';
import { parseEdgeTargetPath } from '../graph-management/adapters/edit-graph-producer.js';
import { SAFETY_FORBIDDEN_TOKENS } from '../compose/proposed-change.js';

/** Structural view of a patch operation — enough to name its subject. */
export interface ChangesetOpLike {
  readonly op: string;
  readonly path: string;
  readonly value?: unknown;
}

/** Backwards-compatible alias for the referee gate's original name. */
export type HeldOpLike = ChangesetOpLike;

export interface ChangesetDescription {
  /** One specific description per operation, order-preserving. */
  readonly items: readonly string[];
  /** The items joined for prose ("a", "a and b", "a, b and c"). */
  readonly subject: string;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Truncate a label for chip/ask interpolation (keeps copy short). */
export function clampLabel(label: string): string {
  const trimmed = label.trim().replace(/\s+/g, ' ');
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}

/**
 * Kind words rendered next to a node label. `constraint` is deliberately
 * ABSENT: "add … constraint" is claimed by the value-update gate's clause D
 * (route-v2 would then skip its replay resolution for the minted chip
 * copy), so constraint-kind nodes render label-only.
 */
const NODE_KIND_WORDS: ReadonlyMap<string, string> = new Map([
  ['option', 'option'],
  ['risk', 'risk'],
  ['factor', 'factor'],
  ['goal', 'goal'],
  ['decision', 'decision'],
  ['outcome', 'outcome'],
]);

interface ResolvedNode {
  readonly label: string | null;
  readonly kind: string | null;
}

/**
 * Resolve a node id to its label/kind. Sources, in order: the pre-edit
 * graph, then any `add_node` EARLIER in the same batch (a batch may add a
 * node and immediately update it — the pre-edit graph cannot name it, the
 * batch can). Never returns the raw id as a label — internal ids must not
 * leak into user copy.
 */
function resolveNode(
  nodeId: string,
  graph: unknown,
  batchAdds: ReadonlyMap<string, ResolvedNode>,
): ResolvedNode {
  const nodes = asRecord(graph).nodes;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      const rec = asRecord(n);
      if (rec.id === nodeId) {
        const label =
          typeof rec.label === 'string' && rec.label.trim().length > 0
            ? clampLabel(rec.label)
            : null;
        const kind = typeof rec.kind === 'string' ? rec.kind : null;
        if (label !== null) return { label, kind };
      }
    }
  }
  return batchAdds.get(nodeId) ?? { label: null, kind: null };
}

/** `remove option 'X'` / `remove 'X'` — kind word only for the known set. */
function withKindWord(kind: string | null, label: string): string {
  const word = kind !== null ? NODE_KIND_WORDS.get(kind) : undefined;
  return word !== undefined ? `${word} '${label}'` : `'${label}'`;
}

/**
 * Render a proposed value for user copy. Prefers the shared conservative
 * display formatter (currency/percent/time shapes); otherwise renders the
 * changeset's own value plainly — describing a held changeset must echo
 * exactly what the changeset carries, never hide it.
 */
function formatChangeValue(value: unknown, unit: unknown): string | null {
  const unitStr = typeof unit === 'string' && unit.trim().length > 0 ? unit.trim() : null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const shared = formatFactorValue(value, unitStr);
    if (shared !== null) return shared.display;
    const n = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
    if (unitStr === null) return n;
    if (unitStr === '%') return `${n}%`;
    return `${n} ${clampLabel(unitStr.replace(/_/g, ' '))}`;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return `'${clampLabel(value)}'`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

/**
 * Edge-path parsing — DERIVED, not re-guessed. The paths reaching this
 * module on the live wire are minted by exactly two producers:
 *
 *   1. `from::to` (CEE canonical) — `normalisePath` in
 *      `orchestrator/tools/edit-graph.ts` converts the LLM's v2
 *      `/edges/from->to` paths to this form before validation, and
 *      `patch-validation.ts` checks it against `${from}::${to}` edge keys.
 *      This is the format the referee gate actually receives from
 *      `handleEditGraph`.
 *   2. `from->to` (v2 bare) — deterministic actions
 *      (`adjust-edge-strength.ts`, `remove-factor.ts`) mint it directly,
 *      and bare LLM paths without a `/` prefix pass through
 *      `normalisePath` unchanged.
 *
 * `parseEdgeTargetPath` (edit-graph-producer.ts) is the pipeline's own
 * parser for BOTH — the very producer that projects these held operations
 * into referee envelopes uses it, and the applier's `parseEdgePath`
 * accepts the same two shapes (rejecting everything else, including
 * 3-part `from::to::index` edge ids). Reusing it here means the describe
 * layer can never again recognise fewer formats than the pipeline mints.
 * Anything it cannot parse gets the explicit unrecognised-reference
 * fallback below — naming the op and (when safe) the path, never a
 * silent generic.
 */

/**
 * A path token safe to echo into user copy: a short machine identifier
 * (the two minted edge-path shapes fit), screened against the SAME
 * `SAFETY_FORBIDDEN_TOKENS` list every surface's sanitiser enforces —
 * derived, not hand-mirrored, so a token added there is honoured here.
 * An unsafe path would otherwise trip `sanitisePublicCopyOrFallback`
 * downstream and silently collapse the WHOLE changeset description to
 * the generic swept copy.
 */
function safeEchoPath(path: string): string | null {
  const trimmed = path.trim();
  if (!/^[A-Za-z0-9_.:>-]{1,80}$/.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  for (const token of SAFETY_FORBIDDEN_TOKENS) {
    if (lower.includes(token.toLowerCase())) return null;
  }
  return trimmed;
}

/**
 * The honest fallback for an edge op whose path no pipeline parser
 * recognises: names the action and, when safe to echo, the reference —
 * never a silent generic. (`change`-family verbs avoided: clause-A of the
 * value-update gate.)
 */
function describeUnparseableEdgeOp(action: 'remove' | 'adjust', path: string): string {
  const echo = safeEchoPath(path);
  return echo !== null
    ? `${action} a link with an unrecognised reference '${echo}'`
    : `${action} a link with an unrecognised reference`;
}

/** The honest fallback for an op the vocabulary does not know. */
function describeUnknownOp(op: string): string {
  // Name the op only when its token is a plain machine identifier — a
  // hostile or malformed op string must not flow into user copy.
  if (/^[a-z][a-z0-9_]{0,39}$/i.test(op)) {
    return `apply an unrecognised change of type '${op.replace(/_/g, ' ').toLowerCase()}'`;
  }
  return 'apply an unrecognised change';
}

/**
 * Name ONE operation. Total: every op yields copy — specific when the
 * label/value can be safely derived, an honest op-shaped generic when not,
 * and the explicit unknown-op fallback outside the vocabulary. NEVER null,
 * NEVER a count.
 */
function describeOp(
  op: ChangesetOpLike,
  graph: unknown,
  batchAdds: ReadonlyMap<string, ResolvedNode>,
): string {
  switch (op.op) {
    case 'add_node': {
      const v = asRecord(op.value);
      const kind = typeof v.kind === 'string' ? v.kind : null;
      const kindWord = kind !== null ? NODE_KIND_WORDS.get(kind) : undefined;
      const label =
        typeof v.label === 'string' && v.label.trim().length > 0
          ? clampLabel(v.label)
          : null;
      if (label !== null) return `add ${withKindWord(kind, label)}`;
      return kindWord !== undefined ? `add a new ${kindWord}` : 'add a new part of the model';
    }
    case 'remove_node': {
      const node = resolveNode(op.path, graph, batchAdds);
      return node.label !== null
        ? `remove ${withKindWord(node.kind, node.label)}`
        : 'remove a part of the model';
    }
    case 'update_node': {
      const v = asRecord(op.value);
      const node = resolveNode(op.path, graph, batchAdds);
      // Rename: the update carries a new label.
      if (typeof v.label === 'string' && v.label.trim().length > 0) {
        const newLabel = clampLabel(v.label);
        return node.label !== null
          ? `rename '${node.label}' to '${newLabel}'`
          : `rename a part of the model to '${newLabel}'`;
      }
      // Tunable: observed_state.{value,unit} (set_factor_value's contract).
      const observed = asRecord(v.observed_state);
      const observedValue = formatChangeValue(observed.value, observed.unit);
      if (observedValue !== null) {
        return node.label !== null
          ? `change '${node.label}' to ${observedValue}`
          : `change a part of the model to ${observedValue}`;
      }
      // Goal target: goal_threshold (+ unit) — never the literal phrase
      // "success target" (value-update gate clause C).
      const threshold = formatChangeValue(v.goal_threshold, v.unit);
      if (threshold !== null) {
        return node.label !== null
          ? `change the target for '${node.label}' to ${threshold}`
          : `change a target to ${threshold}`;
      }
      // Description-only update.
      const keys = Object.keys(v);
      if (keys.length === 1 && typeof v.description === 'string') {
        return node.label !== null
          ? `update the description of '${node.label}'`
          : 'update the description of a part of the model';
      }
      return node.label !== null ? `update '${node.label}'` : 'update a part of the model';
    }
    case 'add_edge': {
      const v = asRecord(op.value);
      const from =
        typeof v.from === 'string' ? resolveNode(v.from, graph, batchAdds).label : null;
      const to = typeof v.to === 'string' ? resolveNode(v.to, graph, batchAdds).label : null;
      return from !== null && to !== null ? `link '${from}' to '${to}'` : 'add a link';
    }
    case 'remove_edge': {
      const endpoints = parseEdgeTargetPath(op.path);
      if (endpoints === null) return describeUnparseableEdgeOp('remove', op.path);
      const from = resolveNode(endpoints.from, graph, batchAdds).label;
      const to = resolveNode(endpoints.to, graph, batchAdds).label;
      if (from !== null && to !== null) return `remove the link from '${from}' to '${to}'`;
      // Parseable path, endpoints absent from the graph: internal ids
      // must not leak as labels, so the op-shaped generic stands.
      return 'remove a link';
    }
    case 'update_edge': {
      const endpoints = parseEdgeTargetPath(op.path);
      if (endpoints === null) return describeUnparseableEdgeOp('adjust', op.path);
      const from = resolveNode(endpoints.from, graph, batchAdds).label;
      const to = resolveNode(endpoints.to, graph, batchAdds).label;
      const strength = asRecord(asRecord(op.value).strength);
      const mean = formatChangeValue(strength.mean, undefined);
      if (from !== null && to !== null) {
        return mean !== null
          ? `change the strength of the link from '${from}' to '${to}' to ${mean}`
          : `adjust the link from '${from}' to '${to}'`;
      }
      return 'adjust a link';
    }
    default:
      return describeUnknownOp(op.op);
  }
}

/** Join items for prose: "a" / "a and b" / "a, b and c". */
function joinItems(items: readonly string[]): string {
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

/**
 * Describe EVERY operation in a changeset. Returns null only for an empty
 * batch (callers fall back to their generic swept copy — never blank text).
 * For a non-empty batch this is total: `items.length === operations.length`
 * and every item is specific or an honest named fallback — the opaque
 * "and N more changes" collapse is dead by construction.
 */
export function describeChangeset(
  operations: readonly ChangesetOpLike[],
  currentGraph: unknown,
): ChangesetDescription | null {
  if (operations.length === 0) return null;
  // Pre-scan batch adds so later ops on batch-added nodes resolve labels.
  const batchAdds = new Map<string, ResolvedNode>();
  for (const op of operations) {
    if (op.op !== 'add_node') continue;
    const v = asRecord(op.value);
    if (
      typeof v.id === 'string' &&
      typeof v.label === 'string' &&
      v.label.trim().length > 0
    ) {
      batchAdds.set(v.id, {
        label: clampLabel(v.label),
        kind: typeof v.kind === 'string' ? v.kind : null,
      });
    }
  }
  const items = operations.map((op) => describeOp(op, currentGraph, batchAdds));
  return { items, subject: joinItems(items) };
}

/**
 * The single seam ALL THREE surfaces consume (hold ask, chip copy, applied
 * receipt). Kept under its original name so existing call sites and pins
 * stay importable; delegates to {@link describeChangeset}.
 */
export function describeHeldOperationsSubject(
  operations: readonly ChangesetOpLike[],
  currentGraph: unknown,
): string | null {
  return describeChangeset(operations, currentGraph)?.subject ?? null;
}
