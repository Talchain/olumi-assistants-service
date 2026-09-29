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
        detail: 'Patch operation budget exceeded.',
        node_ops: 5,
        edge_ops: 2,
        breached_dimensions: ['node'],
        suggested_actions: [
          { role: 'facilitator', label: 'Break into smaller steps', prompt: "Let's make this change in smaller steps." },
          { role: 'challenger', label: 'Rebuild from updated brief', prompt: 'Would you like to rebuild the model from an updated brief instead?' },
        ],
      },
      'test-turn-id',
      mockContext,
    );

    // ⚠⚠ ROADMAP 2.655 — THIS TEST USED TO PIN THE DEFECT. It asserted the
    // copy CONTAINED "5 node operations" and "limit: 4 node ops, 8 edge ops",
    // which is precisely the sentence the 2.634 walk received on the canonical
    // compound edit: two internal caps a user cannot act on, one of which had
    // not even been breached. The counts and the caps are gone from user copy
    // entirely; what stays is what happened and what to ask for instead.
    //
    // The 2.624 lesson the old version recorded still stands and is why the
    // numbers went rather than being re-derived once more: a number in user
    // copy is a mirror of an internal rule, and this one had already drifted
    // once (a stale "4-edge limit" that matched nothing, propagated into a
    // comment in `edit-graph.ts` and survived for months). The mirror that
    // cannot drift is the one that is not there. `MAX_NODE_OPS` / `MAX_EDGE_OPS`
    // are imported below only to prove their VALUES are absent.
    expect(envelope.turn_id).toBe('test-turn-id');
    expect(envelope.assistant_text).toBeTruthy();
    expect(envelope.assistant_text).not.toContain('node operations');
    expect(envelope.assistant_text).not.toContain('node ops');
    expect(envelope.assistant_text).not.toContain('limit:');
    expect(envelope.assistant_text).not.toContain(String(MAX_NODE_OPS));
    expect(envelope.assistant_text).not.toContain(String(MAX_EDGE_OPS));
    // The node budget was the one that tripped, and the copy says so in words.
    expect(envelope.assistant_text).toContain('more separate additions than');
    expect(envelope.assistant_text).toContain('Ask me for one part of it');

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

    // Log output — the counts are still LOGGED. They are diagnostics, and
    // removing them from the user's sentence must not remove them from ours.
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'budget_exceeded',
        node_ops: 5,
        edge_ops: 2,
      }),
      expect.any(String),
    );
  });

  /**
   * ⭐ ROADMAP 2.655 — WHICH BUDGET TRIPPED, IN WORDS. The walk's sentence
   * quoted BOTH caps when only the node budget had breached, so a user would
   * have gone looking at links that were never the problem. These three cases
   * are a discriminating set: each dimension must produce a DIFFERENT sentence,
   * or the distinction is decorative.
   */
  describe('the breached dimension is named in plain words, and only that one', () => {
    const build = (dims: readonly ('node' | 'edge')[]) =>
      buildPatchRejectionEnvelope(
        {
          reason: 'budget_exceeded',
          detail: 'Patch operation budget exceeded.',
          node_ops: 9,
          edge_ops: 9,
          breached_dimensions: dims,
          suggested_actions: [
            { role: 'facilitator', label: 'Break into smaller steps', prompt: "Let's make this change in smaller steps." },
          ],
        },
        'test-turn-dims',
        mockContext,
      ).assistant_text ?? '';

    it('node only — additions, and NOT links', () => {
      const text = build(['node']);
      expect(text).toContain('more separate additions than');
      expect(text).not.toContain('links between the pieces');
    });

    it('edge only — links, and NOT additions', () => {
      const text = build(['edge']);
      expect(text).toContain('more links between the pieces of your model than');
      expect(text).not.toContain('more separate additions than');
    });

    it('both — both are named', () => {
      const text = build(['node', 'edge']);
      expect(text).toContain('more separate additions, and more links between them, than');
    });

    it('unknown — the copy stays honest rather than guessing a dimension', () => {
      const text = build([]);
      expect(text).toContain('That is more than I can put into a single change');
      expect(text).not.toContain('separate additions');
      expect(text).not.toContain('links between');
    });

    it('every variant still offers the same actionable next step', () => {
      for (const dims of [['node'], ['edge'], ['node', 'edge'], []] as const) {
        expect(build(dims)).toContain('Ask me for one part of it and I will do that part');
      }
    });
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
