/**
 * COMPOSITION WITNESS — the user's intervention reaches `options[]` through the
 * REAL persistence projection, not just through the reconciler in isolation.
 *
 * A unit witness on `reconcileTopLevelOptionsFromNodes` proves that function
 * propagates. It does NOT prove the composition does: `projectGraphForPersistence`
 * runs `repairGraphForPersistence` → `normaliseOptionInterventionContract` →
 * `reconcileTopLevelOptionsFromNodes`, and the ORDER is load-bearing (the
 * reconcile must see the ALREADY-canonical node bundle). N green seams do not
 * sum to a working path, so this pins the seam itself.
 *
 * The fixture is the shape `mergeAppliedGraphForPersistence` actually produces
 * on the live edit path: `{...persistedBase, nodes, edges}` — i.e. the STALE
 * pre-edit `options[]` carried through byte-for-byte by the spread, beside the
 * freshly-edited option NODE. That is exactly the divergence a user hits.
 *
 * MUTATION-CHECK (revert → RED): remove the propagation limb in
 * `reconcile-top-level-options.ts` and `the user's value reaches options[]`
 * fails — the stale 0.2 survives.
 */
import { describe, expect, it } from 'vitest';

import { projectGraphForPersistence } from '../persisted-graph-projection.js';

describe('projectGraphForPersistence — option intervention propagation (composition)', () => {
  /** The post-merge persist candidate: fresh nodes + the pre-edit options[]. */
  function mergedPersistCandidate() {
    return {
      goal_node_id: 'goal',
      nodes: [
        { id: 'goal', kind: 'goal', label: 'G' },
        { id: 'fac_cost', kind: 'factor', label: 'Cost', category: 'controllable' },
        {
          id: 'opt_outsource',
          kind: 'option',
          label: 'Outsource the second-line support desk to a managed provider',
          // The user's write — landed on the NODE by encode-option-interventions.
          interventions: {
            fac_cost: { value: 0.75, source: 'user_specified' },
          },
        },
      ],
      edges: [{ from: 'opt_outsource', to: 'fac_cost' }],
      // The PRE-EDIT array, carried through `{...base}` by the persist merge.
      options: [
        {
          id: 'opt_outsource',
          label: 'Outsource the second-line support desk to a managed provider',
          status: 'needs_encoding',
          interventions: { fac_cost: { value: 0.2, source: 'assistant_estimated' } },
        },
      ],
    };
  }

  it("the user's value reaches options[] — the surface the analysis reads", () => {
    const out = projectGraphForPersistence(mergedPersistCandidate()) as ReturnType<
      typeof mergedPersistCandidate
    >;
    // BIND BY IDENTITY: (option_id, factor_id).
    const entry = out.options.find((o) => o.id === 'opt_outsource');
    expect(entry).toBeDefined();
    expect(
      (entry!.interventions as Record<string, { value: number }>).fac_cost.value,
    ).toBe(0.75);
  });

  it('THE INVERSION ASSERT: the OPTION gains the value and the FACTOR is untouched', () => {
    const out = projectGraphForPersistence(mergedPersistCandidate()) as ReturnType<
      typeof mergedPersistCandidate
    > & { nodes: { id: string; value?: unknown }[] };

    const entry = out.options.find((o) => o.id === 'opt_outsource')!;
    expect((entry.interventions as Record<string, { value: number }>).fac_cost.value).toBe(0.75);

    // The measured defect wrote the user's number onto the FACTOR's observed
    // state instead of the option's intervention. Assert BOTH halves — the
    // right entity moved AND the wrong one did not.
    const factor = out.nodes.find((n) => n.id === 'fac_cost')!;
    expect(factor.value).toBeUndefined();
  });

  it('POSITIVE CONTROL: an unrelated already-consistent graph projects to itself', () => {
    // Proves the two assertions above are real propagation, not a function that
    // rewrites everything it touches.
    const consistent = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'G' },
        {
          id: 'opt_a',
          kind: 'option',
          label: 'A',
          interventions: { fac_x: { value: 1, source: 'user_specified' } },
        },
      ],
      edges: [],
      options: [
        {
          id: 'opt_a',
          label: 'A',
          status: 'ready',
          interventions: { fac_x: { value: 1, source: 'user_specified' } },
        },
      ],
    };
    expect(projectGraphForPersistence(consistent)).toBe(consistent);
  });
});
