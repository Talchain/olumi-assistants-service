/**
 * ROADMAP 2.258 — CHARACTERISATION PIN: the goal node reaches the wire with a
 * FRAME but NO BASELINE, so ISL still fails closed.
 *
 * ⚠ THIS TEST PINS A KNOWN-OPEN GAP, NOT A DESIRED BEHAVIOUR. It exists so the
 * gap is discoverable and so it cannot be silently closed or silently
 * forgotten: the moment anything starts populating a goal baseline, these
 * assertions RED and whoever did it must come here, delete this file, and close
 * the follow-up row. That is the intended lifecycle.
 *
 * WHAT ISL NEEDS, derived at ISL staging head `29cb4e27`
 * (`src/services/robustness_analyzer_v2.py`,
 * `_resolve_goal_threshold_in_sample_frame`):
 *
 *     3206:  observed = goal_node.observed_state
 *     3207:  baseline = observed.baseline if observed is not None else None
 *     3303:  converted = threshold - baseline + intercept
 *
 * With `frame == 'level'` and no baseline it refuses at :3208 with
 * `GOAL_THRESHOLD_NOT_CONVERTIBLE`, `reason="missing_goal_baseline"`,
 * `field="nodes[<goal_id>].observed_state.baseline"`, and
 * `probability_of_goal` is omitted for every option (:3391-3394). The run still
 * SUCCEEDS — a disclosed gap, never a fabricated number.
 *
 * WHY THIS PR DOES NOT POPULATE IT. Derived at the bytes on this branch, not
 * assumed: the extracted target factor that feeds the mint site carries NO
 * `baseline` for any brief shape tried, including ones that state the current
 * level outright ("Grow revenue FROM 4000000 to a target of 6000000",
 * "target is 800 customers, CURRENTLY AT 500") — see the extraction assertion
 * below, which is the evidence rather than a claim about it. So there is no
 * baseline available at the mint site to carry, and the only ways to produce
 * one would be to INVENT a value or to build new extraction. Inventing it is
 * precisely the fabrication this whole train exists to retire: a wrong baseline
 * yields a confident wrong probability, which is strictly worse than the honest
 * absence ISL produces today. Closing it properly is a modelling change (find
 * the goal metric's current level, normalise it against the SAME cap so it
 * clears ISL's `abs(v) > 1.5` domain guard at :3273-3297), not plumbing.
 */
import { describe, expect, it } from 'vitest';

import { enrichGraphWithFactorsAsync } from '../enricher.js';
import { extractFactors } from '../index.js';
import { transformNodeToV3 } from '../../transforms/schema-v3.js';
import type { GraphT, NodeT } from '../../../schemas/graph.js';

const BRIEFS_STATING_A_CURRENT_LEVEL = [
  'Grow revenue from 4000000 to a target of 6000000 this year.',
  'Our target is 800 customers, currently at 500.',
];

function freshGraph(): GraphT {
  return {
    version: '1',
    default_seed: 17,
    nodes: [
      { id: 'g1', kind: 'goal', label: 'Revenue Goal' },
      { id: 'd1', kind: 'decision', label: 'Pricing decision' },
    ],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'test' },
  } as unknown as GraphT;
}

describe('ROADMAP 2.258 — goal baseline is ABSENT (characterisation, not approval)', () => {
  it('the extracted target factor carries NO baseline, even when the brief states one', async () => {
    // THE EVIDENCE for "there is nothing to carry". If extraction ever starts
    // producing a baseline, this REDs first and points at the real fix.
    for (const brief of BRIEFS_STATING_A_CURRENT_LEVEL) {
      const factors = (await extractFactors(brief)) as ReadonlyArray<{
        label: string;
        baseline?: number;
      }>;
      const target = factors.find((f) => /target/i.test(f.label));
      expect(target, `no target factor extracted from: ${brief}`).toBeDefined();
      expect(target?.baseline).toBeUndefined();
    }
  });

  it('the minted goal node carries a FRAME but no observed_state at all', async () => {
    for (const brief of BRIEFS_STATING_A_CURRENT_LEVEL) {
      const out = await enrichGraphWithFactorsAsync(freshGraph(), brief);
      const goalV1 = out.graph.nodes.find((n) => n.kind === 'goal');
      const goalV3 = transformNodeToV3(goalV1 as NodeT) as Record<string, unknown>;

      // The half this PR delivers.
      expect(goalV3.goal_threshold).toBeDefined();
      expect(goalV3.goal_threshold_frame).toBe('level');

      // The half it does NOT. ISL's stronger refusal limb —
      // `observed_state_present=False`, "carries no observed_state at all".
      expect(goalV3.observed_state).toBeUndefined();
    }
  });

  it('POSITIVE CONTROL — observed_state IS built for nodes that have the data', async () => {
    // Without this, "the goal has no observed_state" would pass just as
    // happily in a world where the transform never builds one for anything
    // (CLAUDE.md trap 13) — which would make this a test of nothing.
    const out = await enrichGraphWithFactorsAsync(
      freshGraph(),
      'Increase retention from 85% to a target of 95%.',
    );
    const factorV1 = out.graph.nodes.find((n) => n.kind === 'factor');
    expect(factorV1, 'no factor node was enriched').toBeDefined();
    const factorV3 = transformNodeToV3(factorV1 as NodeT) as Record<string, unknown>;
    expect(factorV3.observed_state).toBeDefined();
    // ...and note it still has no `baseline` — the gap is not goal-specific.
    expect((factorV3.observed_state as Record<string, unknown>).value).toBeDefined();
  });
});
