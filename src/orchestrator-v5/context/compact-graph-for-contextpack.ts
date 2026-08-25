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
 * still run; those defaults never mislead Sonnet because the compactor drops
 * std / uncertainty and maps zero-mean edges to `undefined` plain_interpretation.
 *
 * The full graph remains available to the validator via `graphLookupForValidate`
 * in turn-executor.ts — only the Sonnet-facing ContextPack is compacted.
 */

import { log } from '../../utils/telemetry.js';
import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import {
  compactGraph,
  type GraphV3Compact,
} from '../../orchestrator/context/graph-compact.js';

import { extractPersistedGoalTarget } from '../compose/goal-target-receipt-guard.js';

import type { GraphStateIngress } from '../boundary/request-extensions.js';

export interface CompactGraphForContextPackOptions {
  readonly requestId: string;
}

/**
 * THE RECORD'S ANSWER TO "IS A SUCCESS TARGET SET, AND TO WHAT?"
 *
 * ── WHY THIS EXISTS, AT THE BYTES ──────────────────────────────────────────
 * `compactGraph` lists `goal_threshold` in its "Dropped per node" set
 * (orchestrator/context/graph-compact.ts:223) and `CompactNode` has no
 * threshold field, so the success target reached the model through NOTHING —
 * neither set nor unset. `formatGraphForContext` then strips node
 * `value`/`raw_value`/`cap` as well, and the one readiness kind that could
 * have named the gap (`goal_threshold_missing`) has no producer.
 *
 * Meanwhile `ContextPack.conversation.recent_turns[].user_message` carries the
 * user's verbatim sentence, and `buildUserMessage` serialises the whole pack
 * as ONE JSON document under ONE header with `conversation` and `graph` as
 * sibling keys. Asked "what is the success measure, or is it unset?", the only
 * place in the model's entire context where an answer existed was the
 * TRANSCRIPT — so a number the user had merely MENTIONED came back quoted as
 * persisted state, with provenance. Witnessed on deployed staging (CEE
 * `cd3d6ae`), fresh state-class.
 *
 * ── WHY THE FIX IS A FACT AND NOT AN INSTRUCTION ───────────────────────────
 * "Answer from the record, not the conversation" alone would make the model
 * say UNSET on every turn — including when a target IS recorded — because the
 * record it receives still would not carry one. That is over-suppression: it
 * trades a fabrication for a dead end that denies the user's own data. The
 * model needs the fact, then the precedence rule.
 *
 * ── THE THREE STATES ARE DELIBERATE ────────────────────────────────────────
 *   · `{ status: 'set', value, unit? }` — the record HAS one; quote it.
 *   · `{ status: 'unset' }` — the graph WAS read and registers no target.
 *     A POSITIVE, checkable statement. Key-absence could not carry this: an
 *     absent key is indistinguishable from a projection that dropped it,
 *     which is precisely the ambiguity that caused the defect.
 *   · key ABSENT (outcome `absent`) — no graph was read, so nothing is known.
 *     UNKNOWN REMAINS UNKNOWN; it is never downgraded to a reassuring
 *     "unset". Same discipline `readiness` already uses.
 *
 * Derived on every read from the persisted graph, so it cannot go stale
 * against a graph edited since — never a snapshot.
 */
export type ContextPackGoalTarget =
  | { readonly status: 'set'; readonly value: number; readonly unit?: string }
  | { readonly status: 'unset' };

/**
 * Read the success target from a raw ingress graph through the SINGLE
 * authority (`extractPersistedGoalTarget`, compose/goal-target-receipt-guard
 * .ts). No second predicate is minted here: the pack tells the model exactly
 * what the receipt guard would police, so the two can never disagree.
 */
function projectGoalTarget(graphState: GraphStateIngress): ContextPackGoalTarget {
  const found = extractPersistedGoalTarget(graphState);
  if (found === null) return { status: 'unset' };
  return {
    status: 'set',
    value: found.value,
    ...(found.unit === undefined ? {} : { unit: found.unit }),
  };
}

export type CompactGraphOutcome =
  | {
      readonly kind: 'compacted';
      readonly compact: GraphV3Compact;
      readonly via: 'strict_parse' | 'structural_fallback';
      /**
       * The success-target record, repaired HERE because this is the exact
       * site of the loss: this adapter exists to bridge what `compactGraph`
       * drops, and `goal_threshold` is on its dropped list. Derived from the
       * RAW ingress, never from `compact` (which no longer carries it).
       */
      readonly goalTarget: ContextPackGoalTarget;
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
      compact: compactGraph(parsed.data),
      via: 'strict_parse',
      goalTarget: projectGoalTarget(graphState),
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
      goalTarget: projectGoalTarget(graphState),
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
