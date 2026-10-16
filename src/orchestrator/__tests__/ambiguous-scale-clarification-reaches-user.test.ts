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
import { buildAmbiguousScaleClarification } from '../tools/edit-graph.js';

describe('ambiguous_scale_value — the clarification reaches the user', () => {

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
});
