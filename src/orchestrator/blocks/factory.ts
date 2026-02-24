/**
 * Block Factory
 *
 * Creates ConversationBlock instances with deterministic or ephemeral IDs.
 *
 * Deterministic IDs (content-addressed, idempotent):
 * - FactBlock: fact_type + facts + lineage.response_hash + lineage.seed
 * - ReviewCardBlock: canonicalised card payload (sorted keys)
 * - BriefBlock: canonicalised brief payload (sorted keys)
 * - GraphPatchBlock: patch_type + operations + applied_graph_hash
 *   (sort keys within each op, but preserve array order — operation sequence is meaningful)
 *   Excludes: status, summary, rejection.message, timestamps
 *
 * Ephemeral IDs (random, non-deterministic):
 * - FramingBlock: randomUUID
 * - CommentaryBlock: randomUUID
 *
 * Format: blk_<type>_<16-char-hex>
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  ConversationBlock,
  BlockProvenance,
  BlockAction,
  GraphPatchBlockData,
  FactBlockData,
  CommentaryBlockData,
  SupportingRef,
  BriefBlockData,
  ReviewCardBlockData,
  FramingBlockData,
  DecisionStage,
} from "../types.js";

// ============================================================================
// Stable JSON for deterministic hashing
// ============================================================================

/**
 * Sorted JSON replacer for deterministic hashing.
 * Sorts object keys recursively, preserves array order.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((sorted: Record<string, unknown>, k) => {
        sorted[k] = (value as Record<string, unknown>)[k];
        return sorted;
      }, {});
  }
  return value;
}

function stableStringify(data: unknown): string {
  return JSON.stringify(data, sortedReplacer);
}

// ============================================================================
// ID Generation
// ============================================================================

function deterministicId(type: string, ...parts: string[]): string {
  const hash = createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .substring(0, 16);
  return `blk_${type}_${hash}`;
}

function ephemeralId(type: string): string {
  const hex = randomUUID().replace(/-/g, '').substring(0, 16);
  return `blk_${type}_${hex}`;
}

// ============================================================================
// Provenance Helper
// ============================================================================

function makeProvenance(trigger: string, turnId: string): BlockProvenance {
  return {
    trigger,
    turn_id: turnId,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Block Factories
// ============================================================================

/**
 * Create a GraphPatchBlock.
 *
 * Deterministic ID from: patch_type + canonicalised operations + applied_graph_hash.
 * Sort keys within each operation, but preserve array order.
 * Excludes: status, summary, rejection.message, timestamps.
 */
export function createGraphPatchBlock(
  data: GraphPatchBlockData,
  turnId: string,
  relatedElements?: { node_ids?: string[]; edge_ids?: string[] },
  actions?: BlockAction[],
): ConversationBlock {
  // Hash input: patch_type + operations (sorted keys, preserved order) + graph hash
  const opsForHash = data.operations.map((op) => ({
    op: op.op,
    path: op.path,
    value: op.value,
    old_value: op.old_value,
  }));

  const blockId = deterministicId(
    'graph_patch',
    data.patch_type,
    stableStringify(opsForHash),
    data.applied_graph_hash ?? '',
  );

  return {
    block_id: blockId,
    block_type: 'graph_patch',
    data,
    provenance: makeProvenance('tool:draft_graph', turnId),
    ...(relatedElements && { related_elements: relatedElements }),
    ...(actions && { actions }),
  };
}

/**
 * Create a FactBlock.
 *
 * Deterministic ID from: fact_type + facts + response_hash + seed.
 */
export function createFactBlock(
  data: FactBlockData,
  turnId: string,
  responseHash?: string,
  seed?: number,
  relatedElements?: { node_ids?: string[]; edge_ids?: string[] },
): ConversationBlock {
  const blockId = deterministicId(
    'fact',
    data.fact_type,
    stableStringify(data.facts),
    responseHash ?? '',
    seed !== undefined ? String(seed) : '',
  );

  return {
    block_id: blockId,
    block_type: 'fact',
    data,
    provenance: makeProvenance('tool:run_analysis', turnId),
    ...(relatedElements && { related_elements: relatedElements }),
  };
}

/**
 * Create a ReviewCardBlock.
 *
 * Deterministic ID from: canonicalised card payload.
 */
export function createReviewCardBlock(
  card: unknown,
  turnId: string,
  actions?: BlockAction[],
): ConversationBlock {
  const blockId = deterministicId(
    'review_card',
    stableStringify(card),
  );

  const data: ReviewCardBlockData = { card };

  return {
    block_id: blockId,
    block_type: 'review_card',
    data,
    provenance: makeProvenance('tool:run_analysis', turnId),
    ...(actions && { actions }),
  };
}

/**
 * Create a BriefBlock.
 *
 * Deterministic ID from: canonicalised brief payload.
 */
export function createBriefBlock(
  brief: unknown,
  turnId: string,
  actions?: BlockAction[],
): ConversationBlock {
  const blockId = deterministicId(
    'brief',
    stableStringify(brief),
  );

  const data: BriefBlockData = { brief };

  return {
    block_id: blockId,
    block_type: 'brief',
    data,
    provenance: makeProvenance('tool:generate_brief', turnId),
    ...(actions && { actions }),
  };
}

/**
 * Create a CommentaryBlock.
 *
 * Ephemeral ID (commentary is context-dependent, not deterministic).
 */
export function createCommentaryBlock(
  narrative: string,
  turnId: string,
  trigger: string,
  supportingRefs: SupportingRef[] = [],
  relatedElements?: { node_ids?: string[]; edge_ids?: string[] },
): ConversationBlock {
  const blockId = ephemeralId('commentary');

  const data: CommentaryBlockData = { narrative, supporting_refs: supportingRefs };

  return {
    block_id: blockId,
    block_type: 'commentary',
    data,
    provenance: makeProvenance(trigger, turnId),
    ...(relatedElements && { related_elements: relatedElements }),
  };
}

/**
 * Create a FramingBlock.
 *
 * Ephemeral ID (framing evolves with conversation).
 */
export function createFramingBlock(
  stage: DecisionStage,
  turnId: string,
  goal?: string,
  constraints?: unknown[],
): ConversationBlock {
  const blockId = ephemeralId('framing');

  const data: FramingBlockData = { stage };
  if (goal !== undefined) {
    data.goal = goal;
  }
  if (constraints !== undefined) {
    data.constraints = constraints;
  }

  return {
    block_id: blockId,
    block_type: 'framing',
    data,
    provenance: makeProvenance('system', turnId),
  };
}
