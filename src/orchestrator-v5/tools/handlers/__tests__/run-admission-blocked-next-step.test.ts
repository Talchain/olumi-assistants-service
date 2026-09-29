/**
 * `RunAdmission.blockedNextStep` — the coherence rule, derived once.
 *
 * A two-term gate answers two questions, and this module's own docblocks are
 * emphatic that they are different questions: `strict.nextStep` is "what would
 * have to change for the WHOLE model to be analysable", while `willProceed` is
 * "will this run actually go". Both can be true at once — that is the design,
 * not a bug.
 *
 * The hazard is at the SURFACE. `strict.nextStep` reads as an obligation
 * ("Review all 4 readiness issues together before analysis."), so rendering it
 * while the run proceeds demands work the system does not require — the
 * manufactured-obligation defect, one level up from the per-blocker waiver
 * `stampWaiver` already handles. Until now the rule that prevents that was
 * written by hand at `edit-graph-dispatch.ts`, the one consumer that needed it.
 *
 * These tests pin the derivation so a second consumer cannot get it wrong, and
 * they pin BOTH directions — a rule that only ever nulls, or only ever passes
 * through, would satisfy a one-directional test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveRunAdmission } from '../analysis-ready-core.js';

type Node = { id: string; kind: string; label: string };
type Edge = Record<string, unknown>;

/**
 * The proceeding case comes from a REAL CAPTURE, not from a graph written here.
 *
 * My first version of this fixture was hand-built and produced
 * `willProceed:false` — it encoded my model of the exclusion predicate rather
 * than the predicate. A self-authored input is not evidence about the producer,
 * and here it would have made the whole test vacuous in the one state the rule
 * exists for. `j4-wrong-entity-write.json` is a witnessed 19-node/33-edge draft
 * measured at `willProceed:true` with four options waived and a non-null
 * `strict.nextStep` — precisely the disagreement state. Read-only: a dated
 * capture is append-only evidence, never a fixture to keep current.
 */
const WITNESS = JSON.parse(
  readFileSync(
    new URL(
      '../../../__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { draft_graph: unknown };

const graphWhoseRunProceeds = (): unknown =>
  JSON.parse(JSON.stringify(WITNESS.draft_graph));

function edge(from: string, to: string, value?: number): Edge {
  return {
    from,
    to,
    strength: { mean: 0.4, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'positive',
    ...(value === undefined ? {} : { observed_state: { value } }),
  };
}

/** Structurally broken: no goal, so no exclusion can rescue it. */
function graphWhoseRunIsRefused(): unknown {
  const nodes: Node[] = [
    { id: 'dec', kind: 'decision', label: 'Decision' },
    { id: 'opt_a', kind: 'option', label: 'Option A' },
    { id: 'opt_b', kind: 'option', label: 'Option B' },
    { id: 'fac', kind: 'factor', label: 'Factor' },
  ];
  const edges: Edge[] = [
    edge('dec', 'opt_a'),
    edge('dec', 'opt_b'),
    edge('opt_a', 'fac', 0.4),
    edge('opt_b', 'fac', 0.6),
  ];
  return { nodes, edges };
}

describe('RunAdmission.blockedNextStep — derived once, never hand-kept', () => {
  it('is NULL when the run will proceed, even though the strict verdict still prescribes one', () => {
    const admission = resolveRunAdmission(graphWhoseRunProceeds());

    // PRECONDITION, pinned in-test (trap 13b): this assertion is only
    // meaningful in the state where the two fields genuinely disagree. If the
    // fixture ever stopped producing a proceeding-but-strictly-blocked model,
    // the assertion below would pass for the wrong reason.
    expect(admission.willProceed).toBe(true);
    expect(admission.strict.status).toBe('unrecoverable');
    expect(admission.strict.nextStep).not.toBeNull();

    expect(admission.blockedNextStep).toBeNull();
  });

  it('OPPOSITE DIRECTION — is exactly the strict next step when the run is refused', () => {
    const admission = resolveRunAdmission(graphWhoseRunIsRefused());

    expect(admission.willProceed).toBe(false);
    expect(admission.strict.nextStep).not.toBeNull();
    // Bound by IDENTITY to the strict verdict's own string, not to a shape or a
    // substring another sentence could satisfy.
    expect(admission.blockedNextStep).toBe(admission.strict.nextStep);
  });

  it('never prescribes a step the run does not require, across both fixtures', () => {
    // The invariant stated as an invariant rather than case-by-case: a non-null
    // `blockedNextStep` implies the run is genuinely refused.
    for (const g of [graphWhoseRunProceeds(), graphWhoseRunIsRefused()]) {
      const a = resolveRunAdmission(g);
      if (a.blockedNextStep !== null) expect(a.willProceed).toBe(false);
      if (a.willProceed) expect(a.blockedNextStep).toBeNull();
    }
  });
});
