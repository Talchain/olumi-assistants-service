import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPatchRejectionEnvelope } from '../../../src/orchestrator/patch-rejection-helper.js';
import type { ConversationContext } from '../../../src/orchestrator/types.js';
import {
  MAX_NODE_OPS,
  MAX_EDGE_OPS,
} from '../../../src/orchestrator/tools/patch-budget-limits.js';

// Suppress log output in tests
vi.mock('../../../src/utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

const mockContext: ConversationContext = {
  messages: [],
  framing: null,
  graph: null,
  analysis_response: null,
  scenario_id: 'test',
};

describe('buildPatchRejectionEnvelope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('produces valid envelope for budget_exceeded — no GraphPatchBlock, has suggested_actions', async () => {
    const { log } = await import('../../../src/utils/telemetry.js');

    const envelope = buildPatchRejectionEnvelope(
      {
        reason: 'budget_exceeded',
        detail: 'Patch contains 5 node operations.',
        node_ops: 5,
        edge_ops: 2,
        suggested_actions: [
          { role: 'facilitator', label: 'Break into smaller steps', prompt: "Let's make this change in smaller steps." },
          { role: 'challenger', label: 'Rebuild from updated brief', prompt: 'Would you like to rebuild the model from an updated brief instead?' },
        ],
      },
      'test-turn-id',
      mockContext,
    );

    // Envelope shape. ROADMAP 2.624: when `max_*_ops` is not supplied the copy
    // falls back to THE ENFORCER'S OWN CONSTANTS, derived here rather than
    // spelled. This test previously pinned a hardcoded "limit: 3 node ops, 4
    // edge ops" — numbers that matched nothing: the caps are 4 and 8, and that
    // stale "4-edge limit" was the origin of a false comment in `edit-graph.ts`
    // that survived for months. A user reading the old sentence was told a
    // limit the pipeline does not apply.
    expect(envelope.turn_id).toBe('test-turn-id');
    expect(envelope.assistant_text).toBeTruthy();
    expect(envelope.assistant_text).toContain('5 node operations');
    expect(envelope.assistant_text).toContain(
      `limit: ${MAX_NODE_OPS} node ops, ${MAX_EDGE_OPS} edge ops`,
    );
    // The numbers the fallback used to invent, gone. Bound to the exact
    // rendered clause so an unrelated "4" elsewhere in the copy cannot hide it.
    expect(envelope.assistant_text).not.toContain('limit: 3 node ops, 4 edge ops');

    // No GraphPatchBlock
    expect(envelope.blocks).toHaveLength(0);
    const graphPatchBlocks = envelope.blocks.filter(
      (b) => b.block_type === 'graph_patch',
    );
    expect(graphPatchBlocks).toHaveLength(0);

    // Suggested actions present
    expect(envelope.suggested_actions).toHaveLength(2);
    expect(envelope.suggested_actions![0].role).toBe('facilitator');
    expect(envelope.suggested_actions![1].role).toBe('challenger');

    // Log output
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'budget_exceeded',
        node_ops: 5,
        edge_ops: 2,
      }),
      expect.any(String),
    );
  });

  it('renders dynamic limits when max_node_ops / max_edge_ops are specified', async () => {
    const envelope = buildPatchRejectionEnvelope(
      {
        reason: 'budget_exceeded',
        detail: 'Too many edges for option addition.',
        node_ops: 1,
        edge_ops: 9,
        max_node_ops: 3,
        max_edge_ops: 8,
        suggested_actions: [
          { role: 'facilitator', label: 'Break into smaller steps', prompt: "Let's make this change in smaller steps." },
        ],
      },
      'test-turn-id-dynamic',
      mockContext,
    );

    expect(envelope.assistant_text).toContain('limit: 3 node ops, 8 edge ops');
    expect(envelope.assistant_text).not.toContain('4 edge ops');
  });

  it('renders standard limit when unrelated edges breach during option-addition', async () => {
    const envelope = buildPatchRejectionEnvelope(
      {
        reason: 'budget_exceeded',
        detail: 'Too many unrelated edge changes.',
        node_ops: 1,
        edge_ops: 8,
        max_node_ops: 3,
        max_edge_ops: 4, // unrelated edges use standard cap
        suggested_actions: [
          { role: 'facilitator', label: 'Break into smaller steps', prompt: "Let's make this change in smaller steps." },
        ],
      },
      'test-turn-id-unrelated',
      mockContext,
    );

    expect(envelope.assistant_text).toContain('limit: 3 node ops, 4 edge ops');
  });

  it('produces valid envelope for structural_violation — no GraphPatchBlock, has suggested_actions', async () => {
    const { log } = await import('../../../src/utils/telemetry.js');

    const envelope = buildPatchRejectionEnvelope(
      {
        reason: 'structural_violation',
        detail: 'Consider simplifying the change.',
        violations: [
          'This change would leave a node with no connections.',
          'This change would create a circular dependency in the model.',
        ],
        suggested_actions: [
          { role: 'facilitator', label: 'Simplify the change', prompt: 'Try a smaller change.' },
        ],
      },
      'test-turn-id-2',
      mockContext,
    );

    // Envelope shape
    expect(envelope.turn_id).toBe('test-turn-id-2');
    expect(envelope.assistant_text).toBeTruthy();
    // Raw violation strings must NOT appear in user-facing text (security: no structural leakage)
    expect(envelope.assistant_text).not.toContain('invalid state');
    expect(envelope.assistant_text).not.toContain('no connections');
    expect(envelope.assistant_text).not.toContain('circular dependency');
    // New production message — "inconsistency in the model structure" copy
    expect(envelope.assistant_text).toContain("inconsistency in the model structure");
    // Legacy copy must NOT appear (regression guard against revert)
    expect(envelope.assistant_text).not.toContain("too complex for a single edit");
    expect(envelope.assistant_text).not.toContain("which option should we configure first");

    // No GraphPatchBlock
    expect(envelope.blocks).toHaveLength(0);

    // Suggested actions present
    expect(envelope.suggested_actions).toHaveLength(1);
    expect(envelope.suggested_actions![0].role).toBe('facilitator');

    // Violations must be logged (for debugging) even though they are suppressed from user-facing text
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'structural_violation',
        violations: expect.arrayContaining([
          expect.stringContaining('no connections'),
        ]),
      }),
      expect.any(String),
    );
    // Second warn call logs the suppression of violations from user-facing text
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ violations: expect.any(Array) }),
      expect.stringContaining('suppressed'),
    );
  });

  // Lane 22 (live 2026-07-07 session-ending failure): a NO_PATH_TO_GOAL
  // structural rejection shipped only vague copy while the claim-safe
  // actionable reason ("This change would leave a node that cannot reach
  // the goal.") was suppressed. `user_safe_reasons` carries CALLER-VETTED
  // translated reasons (VIOLATION_MESSAGES members only) into the copy;
  // the raw `violations` field stays suppressed exactly as before.
  it('surfaces caller-vetted user_safe_reasons in structural_violation copy', () => {
    const envelope = buildPatchRejectionEnvelope(
      {
        reason: 'structural_violation',
        detail: 'Consider simplifying the change or approaching it differently.',
        violations: ['NO_PATH_TO_GOAL raw detail with node ids fac_x'],
        user_safe_reasons: [
          'This change would leave a node that cannot reach the goal.',
        ],
        suggested_actions: [
          { role: 'facilitator', label: 'What would work instead?', prompt: 'What would work instead?' },
        ],
      },
      'test-turn-id-3',
      mockContext,
    );

    expect(envelope.assistant_text).toContain(
      'This change would leave a node that cannot reach the goal.',
    );
    // The raw violation string stays suppressed.
    expect(envelope.assistant_text).not.toContain('fac_x');
    expect(envelope.assistant_text).not.toContain('NO_PATH_TO_GOAL');
    // The vague generic line is replaced, not appended.
    expect(envelope.assistant_text).not.toContain('inconsistency in the model structure');
  });

  it('caps user_safe_reasons at two and dedupes them', () => {
    const envelope = buildPatchRejectionEnvelope(
      {
        reason: 'structural_violation',
        detail: 'Consider simplifying the change or approaching it differently.',
        user_safe_reasons: [
          'This change would leave a node that cannot reach the goal.',
          'This change would leave a node that cannot reach the goal.',
          'This change would create a circular dependency in the model.',
          'The model would have no goal node.',
        ],
        suggested_actions: [
          { role: 'facilitator', label: 'What would work instead?', prompt: 'What would work instead?' },
        ],
      },
      'test-turn-id-4',
      mockContext,
    );

    const text = envelope.assistant_text!;
    expect(text.match(/cannot reach the goal/g)).toHaveLength(1);
    expect(text).toContain('circular dependency in the model');
    expect(text).not.toContain('no goal node');
  });

  it('empty user_safe_reasons falls back to the generic structural copy (byte-identical default)', () => {
    const envelope = buildPatchRejectionEnvelope(
      {
        reason: 'structural_violation',
        detail: 'Consider simplifying the change or approaching it differently.',
        user_safe_reasons: [],
        suggested_actions: [
          { role: 'facilitator', label: 'What would work instead?', prompt: 'What would work instead?' },
        ],
      },
      'test-turn-id-5',
      mockContext,
    );
    expect(envelope.assistant_text).toContain('inconsistency in the model structure');
  });
});
