/**
 * A decision model needs a decision node, and the product says so.
 *
 * Running analysis through the real endpoint returned `analysis_ready.status:
 * "blocked"` with 31 readiness issues, the first of which was literally **"The
 * model has no decision node."** The banked construction contract emits goal,
 * options, factors, risks, outcomes and links — and no decision. So every model
 * this lane admits is unanalysable before anything else is even considered.
 *
 * ⭐ THE DECISION→OPTION EDGES ARE TOPOLOGY, NOT BELIEF, and that distinction is
 * load-bearing here. `STRUCTURAL_EDGE_DEFAULTS` (1.0 / mean 1.0 / std 0.01,
 * `orchestrator/context/constants.ts:25`) exists precisely for edges that
 * "represent graph topology, not causal beliefs". So unlike a causal edge, these
 * are NOT marked `defaulted` and NOT ledgered as projected magnitudes — there is
 * no magnitude anybody could have authored. Marking them would dilute the
 * ledger with noise and make the real projections harder to see.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';

const d = new URL('./fixtures/', import.meta.url);
const admitted = () => admitCandidateModel(
  JSON.parse(readFileSync(new URL('faithful.json', d), 'utf8')) as CandidateModel,
  JSON.parse(readFileSync(new URL('widened.json', d), 'utf8')),
);

describe('decision topology', () => {
  it('the banked contract supplies no decision node — control on the fixture', () => {
    const f = JSON.parse(readFileSync(new URL('faithful.json', d), 'utf8'));
    expect(Object.keys(f)).not.toContain('decision');
  });

  it('admits exactly one decision node, marked as inferred', () => {
    const decisions = admitted().nodes.filter((n) => n.kind === 'decision');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].provenance, 'nobody stated it; it is read off the question').toBe('ai_inferred');
  });

  it('connects the decision to every option', () => {
    const m = admitted();
    const decision = m.nodes.find((n) => n.kind === 'decision')!;
    const options = m.nodes.filter((n) => n.kind === 'option');
    expect(options.length).toBeGreaterThanOrEqual(2);
    for (const o of options) {
      expect(
        m.edges.some((e) => e.from === decision.id && e.to === o.id),
        `decision -> ${o.id} missing`,
      ).toBe(true);
    }
  });

  it('topology edges use the canonical constant and are NOT ledgered as projections', () => {
    const m = admitted();
    const decision = m.nodes.find((n) => n.kind === 'decision')!;
    const topo = m.edges.filter((e) => e.from === decision.id);
    for (const e of topo) {
      expect(e.exists_probability).toBe(STRUCTURAL_EDGE_DEFAULTS.exists_probability);
      expect(e.strength).toEqual(STRUCTURAL_EDGE_DEFAULTS.strength);
      expect(e.defaulted, 'topology carries no magnitude anyone could have authored').toBeUndefined();
    }
    const ledgered = m.loss.filter((l) => l.field_path.includes(decision.id));
    expect(ledgered, 'topology must not dilute the projection ledger').toHaveLength(0);
  });

  it('the graph still passes the validator the write path runs', () => {
    const m = admitted();
    const parsed = GraphV3.safeParse({ nodes: m.nodes, edges: m.edges });
    expect(parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'))).toEqual([]);
  });
});
