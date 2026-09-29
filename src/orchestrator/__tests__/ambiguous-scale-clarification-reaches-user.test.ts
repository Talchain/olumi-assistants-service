/**
 * THE AMBIGUOUS-SCALE CLARIFICATION MUST REACH THE USER.
 *
 * The `ambiguous_scale_value` rejection in `edit-graph.ts` composes a precise,
 * actionable sentence — "0.4 reads as a proportion, but “Delivery cost” is
 * recorded as an amount (currently 200000). Tell me the amount you want…" —
 * and, before this fix, put it ONLY on `PatchRejectionContext.detail`.
 *
 * `buildAssistantText` never reads `detail` on a `structural_violation`. It
 * reads `structural_guidance`, then `user_safe_reasons`, then falls through to
 * generic copy. So the user was told "it would create an inconsistency in the
 * model structure" — which is NOT what happened and offers nothing to act on —
 * while the "State the amount" chip DID survive. The product showed a precise
 * next step beside a vague, wrong reason.
 *
 * These tests are a DISCRIMINATING PAIR. The positive proves the clarification
 * now reaches `assistant_text`; the contrast removes ONLY `structural_guidance`
 * and proves the generic line returns. Without the contrast the positive could
 * pass for reasons unrelated to the field under test.
 */

import { describe, expect, it } from 'vitest';

import { findAmbiguousScaleValueOps } from '../canonicalise-value-ops.js';
import { buildPatchRejectionEnvelope, type PatchRejectionContext } from '../patch-rejection-helper.js';
import { buildAmbiguousScaleClarification } from '../tools/edit-graph.js';
import type { ConversationContext } from '../types.js';

/** The exact generic copy the user used to receive. Pinned so a copy change is visible. */
const GENERIC =
  "I wasn't able to apply that change — it would create an inconsistency in the model structure."
  + ' You could try describing the change differently, or I can rebuild the model from an updated brief.';

/**
 * The sentence the PRODUCT composes — taken from the real exported builder, never
 * re-typed here. A hand-copied expectation would keep passing if the copy changed.
 */
const CLARIFICATION = buildAmbiguousScaleClarification({
  newValue: 0.4,
  label: 'Delivery cost',
  currentRawValue: 200000,
});

function buildContext(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'dec_a', kind: 'decision', label: 'Decide' },
        { id: 'fac_cost', kind: 'factor', label: 'Delivery cost' },
        { id: 'goal_m', kind: 'goal', label: 'Margin' },
      ],
      edges: [
        {
          from: 'fac_cost',
          to: 'goal_m',
          strength: { mean: -0.35, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'negative',
        },
      ],
    },
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'scn-ambiguous-scale',
  } as unknown as ConversationContext;
}

/** The context shape `edit-graph.ts` builds for this rejection class. */
function ambiguousScaleCtx(): PatchRejectionContext {
  return {
    reason: 'structural_violation',
    detail: CLARIFICATION,
    structural_guidance: CLARIFICATION,
    violations: ['ambiguous_scale_value: 0.4 on Delivery cost'],
    suggested_actions: [
      {
        role: 'facilitator',
        label: 'State the amount',
        prompt: 'Set Delivery cost to the exact amount I mean, once I say it with its unit.',
      },
    ],
  } as unknown as PatchRejectionContext;
}

describe('ambiguous_scale_value — the clarification reaches the user', () => {
  it('POSITIVE: assistant_text carries the specific clarification, not the generic line', () => {
    const env = buildPatchRejectionEnvelope(ambiguousScaleCtx(), 'turn-1', buildContext());

    expect(env.assistant_text).toContain('reads as a proportion');
    expect(env.assistant_text).toContain('Tell me the amount you want');
    expect(env.assistant_text).toContain('Delivery cost');
    // The whole point: the vague line is GONE.
    expect(env.assistant_text).not.toContain('inconsistency in the model structure');
    expect(env.assistant_text).toBe(CLARIFICATION);
  });

  it('DISCRIMINATING CONTRAST: drop ONLY structural_guidance → the generic line returns', () => {
    const ctx = ambiguousScaleCtx();
    delete (ctx as { structural_guidance?: string }).structural_guidance;

    const env = buildPatchRejectionEnvelope(ctx, 'turn-2', buildContext());

    // This is exactly what the user received before the fix.
    expect(env.assistant_text).toBe(GENERIC);
    expect(env.assistant_text).not.toContain('reads as a proportion');
  });

  it('the "State the amount" chip survives — it always did, which is why the vague copy was incoherent', () => {
    const withGuidance = buildPatchRejectionEnvelope(ambiguousScaleCtx(), 'turn-3', buildContext());
    expect(withGuidance.suggested_actions?.[0]?.label).toBe('State the amount');

    const ctx = ambiguousScaleCtx();
    delete (ctx as { structural_guidance?: string }).structural_guidance;
    const withoutGuidance = buildPatchRejectionEnvelope(ctx, 'turn-4', buildContext());
    // Chip present, reason vague: the pre-fix incoherence, pinned so it cannot return unnoticed.
    expect(withoutGuidance.suggested_actions?.[0]?.label).toBe('State the amount');
    expect(withoutGuidance.assistant_text).toBe(GENERIC);
  });

  it('the REAL predicate detects this class, and the REAL builder names the factor and its amount', () => {
    const graph = {
      nodes: [
        { id: 'fac_cost', kind: 'factor', label: 'Delivery cost', observed_state: { value: 200000 } },
        { id: 'goal_m', kind: 'goal', label: 'Margin' },
      ],
      edges: [],
    };
    const ops = [
      { op: 'update_node', path: 'fac_cost', value: { observed_state: { value: 0.4 } } },
    ] as unknown as Parameters<typeof findAmbiguousScaleValueOps>[0];

    const found = findAmbiguousScaleValueOps(ops, graph);
    // If this ever reads 0 the whole rejection class is unreachable and the copy
    // question is moot — so assert it rather than assume it.
    expect(found.length).toBeGreaterThan(0);

    const sentence = buildAmbiguousScaleClarification(found[0]!);
    expect(sentence).toContain('Delivery cost');
    expect(sentence).toContain('reads as a proportion');
    expect(sentence).toContain('Tell me the amount you want');
  });

  it('raw violation codes never reach the user', () => {
    const env = buildPatchRejectionEnvelope(ambiguousScaleCtx(), 'turn-5', buildContext());
    expect(env.assistant_text).not.toContain('ambiguous_scale_value');
  });
});
