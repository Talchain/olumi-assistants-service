/**
 * V5 Phase 1 — graph compaction adapter for the ContextPack.
 *
 * The V4 `compactGraph()` utility (src/orchestrator/context/graph-compact.ts)
 * takes a strict Zod-parsed `GraphV3T` and produces a deterministic, compact
 * projection (~800–1200 tokens for a 10-node graph). The V5 TurnExecutor
 * receives a permissive `GraphStateIngress` at its boundary. This adapter
 * bridges the two so the ContextPack presented to Sonnet uses the compact
 * form instead of full-JSON passthrough.
 *
 * On strict-parse failure (ingress shape that doesn't satisfy GraphV3), the
 * adapter falls back to a structural projection — the same pattern used by
 * `graphStateToGraphV3` in handlers/edit-graph-dispatch.ts. Required GraphV3
 * fields the ingress doesn't carry (edge.strength object, effect_direction,
 * exists_probability) are stamped with inert defaults so `compactGraph` can
 * still run; those defaults never mislead Sonnet because zero-mean fallback
 * edges receive neither a plain interpretation nor a coefficient-confidence
 * band. Strict causal edges retain only the compactor's closed band; raw std
 * remains absent from model-facing context.
 *
 * The full graph remains available to the validator via `graphLookupForValidate`
 * in turn-executor.ts — only the Sonnet-facing ContextPack is compacted.
 */

import { log } from '../../utils/telemetry.js';
import { readIsBaseline } from '../../cee/baseline-identity.js';
import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import {
  compactGraph,
  type GraphV3Compact,
} from '../../orchestrator/context/graph-compact.js';

import type { GraphStateIngress } from '../boundary/request-extensions.js';
import {
  isSelectedContextGraphSnapshot,
  type ContextGraphSelection,
} from './context-graph-snapshot.js';

export interface CompactGraphForContextPackOptions {
  readonly requestId: string;
}

/**
 * ⚠ THE SUCCESS-TARGET RECORD IS DELIBERATELY *NOT* DERIVED HERE.
 *
 * It lived on this outcome in the first draft of the fix and that was wrong.
 * This adapter is handed the ContextPack selector's single canonical or
 * provisional snapshot. That graph may support reasoning, but only the
 * selector's `canonical` arm can license a claim about what is SAVED.
 *
 * The record now has its own module and its own authority order
 * (`context/goal-target-record.ts`, emitted by turn-executor only for the
 * canonical selector arm). Do not reintroduce it here: graph structure and a
 * saved-record assertion are different contracts.
 */
export type CompactGraphOutcome =
  | {
      readonly kind: 'compacted';
      readonly compact: GraphV3Compact;
      readonly via: 'strict_parse' | 'structural_fallback';
    }
  | { readonly kind: 'absent' };

/**
 * Compact a GraphStateIngress for inclusion in the ContextPack.
 *
 * Returns `absent` when graphState is null/undefined (no graph on this turn).
 * Returns `compacted` with `via: 'strict_parse'` when GraphV3 validation
 * passes, or `via: 'structural_fallback'` when we had to coerce the ingress
 * into a minimal GraphV3T before compacting.
 *
 * Never throws. A structural-fallback construction that itself throws falls
 * back to `absent` and logs — the caller treats that the same as "no graph",
 * which is safe (Sonnet sees ContextPack.graph nodes/edges empty).
 */
export function compactGraphForContextPack(
  graphState: GraphStateIngress | null | undefined,
  options: CompactGraphForContextPackOptions,
): CompactGraphOutcome {
  if (!graphState) return { kind: 'absent' };

  const parsed = GraphV3.safeParse(graphState);
  if (parsed.success) {
    return {
      kind: 'compacted',
      compact: compactGraph(withProducerBaselineIdentity(parsed.data, graphState)),
      via: 'strict_parse',
    };
  }

  log.warn(
    {
      request_id: options.requestId,
      issue_count: parsed.error.issues.length,
      first_issue_path: parsed.error.issues[0]?.path.join('.') ?? null,
    },
    'V5 context pack: graph ingress did not pass strict GraphV3 parse; attempting structural fallback compaction',
  );

  try {
    const fallback = toStructuralGraphV3(graphState);
    return {
      kind: 'compacted',
      compact: compactGraph(fallback),
      via: 'structural_fallback',
    };
  } catch (err) {
    log.warn(
      {
        request_id: options.requestId,
        err: err instanceof Error ? err.message : String(err),
      },
      'V5 context pack: structural fallback compaction failed; returning absent graph',
    );
    return { kind: 'absent' };
  }
}

// Runtime attestation for the exact immutable compact object produced from the
// selector's canonical arm. Identity rejects clones; recursively freezing the
// object before membership is minted rejects post-compaction mutation and
// `toJSON`-based fingerprint bypasses. The key remains weak and is collected at
// end of turn.
const CANONICAL_STRICT_COMPACTIONS = new WeakSet<object>();

function deepFreezeContextCompaction<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreezeContextCompaction(nested, seen);
  }
  return Object.freeze(value);
}

/**
 * Compact the selector's single reasoning snapshot and attest only the exact
 * canonical + strict result. This is the production ContextPack entrypoint;
 * the generic compactor remains useful for non-authoritative projections and
 * tests, but its result alone never licenses a confidence claim.
 */
export function compactSelectedGraphForContextPack(
  selection: ContextGraphSelection,
  options: CompactGraphForContextPackOptions,
): CompactGraphOutcome {
  const outcome = compactGraphForContextPack(selection.graph, options);
  if (
    isSelectedContextGraphSnapshot(selection) &&
    selection.status === 'canonical' &&
    outcome.kind === 'compacted' &&
    outcome.via === 'strict_parse'
  ) {
    deepFreezeContextCompaction(outcome.compact);
    CANONICAL_STRICT_COMPACTIONS.add(outcome.compact);
  }
  return outcome;
}

/** True only for the exact compact object attested by the selector-aware path. */
export function isCanonicalStrictContextGraphCompaction(
  graph: GraphV3Compact | null | undefined,
): boolean {
  return (
    graph != null &&
    Object.isFrozen(graph) &&
    CANONICAL_STRICT_COMPACTIONS.has(graph)
  );
}

/**
 * GraphV3's strict projection intentionally removes the legacy `data` bag.
 * Baseline identity is one of the few producer-attested facts that can still
 * arrive on that surface, so resolve the estate's existing authority rule
 * before parsing and carry only an explicit effective `true` onto the parsed
 * option at the same position with the same ID and kind. This is transport,
 * not adjudication: labels and the ingress `options[]` index are never
 * consulted. A positional mismatch fails weak instead of letting one raw node
 * license a different parsed node that happens to share its ID.
 */
function withProducerBaselineIdentity(
  parsed: GraphV3T,
  raw: GraphStateIngress,
): GraphV3T {
  let changed = false;
  const nodes = parsed.nodes.map((parsedNode, index) => {
    const candidate = raw.nodes[index] as {
      readonly id?: unknown;
      readonly kind?: unknown;
      readonly is_baseline?: unknown;
      readonly data?: unknown;
    } | undefined;
    if (
      candidate === undefined ||
      parsedNode.kind !== 'option' ||
      candidate.kind !== parsedNode.kind ||
      candidate.id !== parsedNode.id
    ) {
      return parsedNode;
    }
    const data =
      typeof candidate.data === 'object' && candidate.data !== null
        ? (candidate.data as { readonly is_baseline?: boolean })
        : undefined;
    const effective = readIsBaseline({
      ...(typeof candidate.is_baseline === 'boolean'
        ? { is_baseline: candidate.is_baseline }
        : {}),
      ...(data === undefined ? {} : { data }),
    });
    if (effective !== true || parsedNode.is_baseline === true) return parsedNode;
    changed = true;
    return { ...parsedNode, is_baseline: true };
  });

  if (!changed) return parsed;
  return {
    ...parsed,
    nodes,
  };
}

/**
 * Build a minimal GraphV3T-shaped object from a permissive ingress. Same
 * inert defaults as graphStateToGraphV3 in edit-graph-dispatch.ts — the
 * compactor consumes `kind`, `label`, and `observed_state.value`; everything
 * else survives passthrough from the ingress object.
 */
function toStructuralGraphV3(graphState: GraphStateIngress): GraphV3T {
  const nodes: GraphV3T['nodes'] = graphState.nodes.map((raw) => {
    const n = raw as { id: string; kind: string; label?: string; [k: string]: unknown };
    return {
      ...n,
      id: n.id,
      kind: n.kind as GraphV3T['nodes'][number]['kind'],
      label: n.label ?? n.id,
    } as GraphV3T['nodes'][number];
  });

  const edges: GraphV3T['edges'] = graphState.edges.map((raw) => {
    const e = raw as { from: string; to: string; [k: string]: unknown };
    return {
      ...e,
      from: e.from,
      to: e.to,
      strength: { mean: 0, std: 0 },
      exists_probability: 1,
      effect_direction: 'positive',
    } as GraphV3T['edges'][number];
  });

  return { nodes, edges };
}
