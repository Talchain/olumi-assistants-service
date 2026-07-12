/**
 * D-S ruling acceptance (ROADMAP §D, Paul 2026-07-12 / 1.16h) — tunable
 * mutations AUTO-APPLY with an honest receipt; propose-confirm is reserved
 * for STRUCTURAL changes; R2 is relaxed for consecutive tunable tweaks.
 *
 * Fixture of record: the 2026-07-11 manual-test batch shape — 8
 * update_edge_field envelopes, mutation_class=tunable, base_hash_match=true.
 * On the pre-D-S base every one of the 8 was held TUNABLE_APPLY_HELD (the
 * RED evidence for this lane); post-fix all 8 are would_apply and the batch
 * governs proceed, so the existing apply path commits them in one turn with
 * the existing applied receipt + edit fact + rerun chip.
 *
 * Doctrine boundaries pinned here (each one is a D-S MUST-HOLD):
 *  - STRUCTURAL mutations still hold (propose-confirm unchanged).
 *  - MIXED tunable+structural batches still hold WHOLESALE (worst-of
 *    governing; no partial apply).
 *  - R2 relaxation is the NARROWEST one: tunable-class edits are
 *    additionally allowed when freshness='stale' (the first auto-applied
 *    edit flips freshness to stale, so the old rule would block every
 *    consecutive tweak); 'unknown' still fails closed; base-hash
 *    divergence still stales for EVERY class (CAS semantics untouched).
 *  - R6 non-downgrade still governs: a tunable that reduces EP2 readiness
 *    is held READINESS_DOWNGRADE, never auto-applied.
 *  - A tunable whose candidate fails GraphV3 validation is rejected
 *    (fail-closed, mirroring the rename_node precedent).
 */
import { describe, it, expect } from 'vitest';
import { refereeMutation, refereeMutationBatch } from '../referee.js';
import { evaluateFrameGate } from '../frame-gate.js';
import {
  buildUpdateEdgeFieldCandidate,
  buildUpdateNodeFieldCandidate,
} from '../candidate-graph.js';
import {
  ANALYSIS_NOT_FRESH,
  BASE_HASH_DIVERGED,
  CANDIDATE_BUILD_FAILED,
  GRAPH_INVARIANT_VIOLATED,
  READINESS_DOWNGRADE,
  STRUCTURAL_APPLY_HELD,
} from '../reason-codes.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import {
  buildReadyGraph,
  frameFor,
  hashOf,
  makeEnvelope,
  SAMPLE_PAYLOADS,
} from './fixtures.js';

const G = buildReadyGraph();
const H = hashOf(G);

/** The 11 Jul manual-test batch shape: 8 tunable edge tweaks on the ready graph. */
function eightTunableEdgeOps(): Record<string, unknown>[] {
  const targets = [
    { from_node: 'f-spend', to_node: 'g-profit' },
    { from_node: 'f-reach', to_node: 'g-profit' },
  ];
  return Array.from({ length: 8 }, (_, i) => {
    const t = targets[i % 2]!;
    return makeEnvelope(
      'update_edge_field',
      {
        ...t,
        field: i < 4 ? 'strength' : 'exists_probability',
        from: i < 4 ? { mean: 0.5, std: 0.1 } : 0.9,
        to: i < 4 ? { mean: 0.3 + i * 0.05, std: 0.1 } : 0.8 - i * 0.02,
      },
      { base_graph_hash: H },
    );
  });
}

describe('D-S fixture of record — 8 tunable update_edge_field ops, base_hash_match=true', () => {
  it('all 8 verdict would_apply (zero held) so the batch governs proceed and applies in one commit', () => {
    const vs = refereeMutationBatch(eightTunableEdgeOps(), G, frameFor(G));
    expect(vs).toHaveLength(8);
    for (const v of vs) {
      expect(v.verdict).toBe('would_apply');
      expect(v.mutation_class).toBe('tunable');
      expect(v.base_hash_match).toBe(true);
      expect(v.blocker).toBeUndefined();
      expect(v.candidate).toBeDefined();
    }
  });
});

describe('D-S — tunable kinds are would_apply-eligible (was held TUNABLE_APPLY_HELD)', () => {
  it('update_node_field (allowed field) → would_apply with a built candidate', () => {
    const raw = makeEnvelope('update_node_field', SAMPLE_PAYLOADS.update_node_field, {
      base_graph_hash: H,
    });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('would_apply');
    expect(v.mutation_class).toBe('tunable');
    expect(v.candidate).toBeDefined();
  });

  it('update_edge_field (allowed field) → would_apply with a built candidate', () => {
    const raw = makeEnvelope('update_edge_field', SAMPLE_PAYLOADS.update_edge_field, {
      base_graph_hash: H,
    });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('would_apply');
    expect(v.candidate).toBeDefined();
  });
});

describe('D-S doctrine boundary — STRUCTURAL still holds; MIXED batches hold wholesale', () => {
  it('structural mutations keep the propose-confirm posture (STRUCTURAL_APPLY_HELD unchanged)', () => {
    const v = refereeMutation(
      makeEnvelope('add_node', SAMPLE_PAYLOADS.add_node, { base_graph_hash: H }),
      G,
      frameFor(G),
    );
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });

  it('mixed tunable+structural batch: the tunable is would_apply but the structural still holds (worst-of governing holds the WHOLE batch downstream)', () => {
    const vs = refereeMutationBatch(
      [
        makeEnvelope('update_edge_field', SAMPLE_PAYLOADS.update_edge_field, { base_graph_hash: H }),
        makeEnvelope('add_node', SAMPLE_PAYLOADS.add_node, { base_graph_hash: H }),
      ],
      G,
      frameFor(G),
    );
    expect(vs.map((v) => v.verdict)).toEqual(['would_apply', 'held']);
    expect(vs[1]!.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });
});

describe('D-S R2 relaxation — consecutive tunable tweaks on a stale frame', () => {
  it('frame gate: tunable + freshness=stale + matching hash → proceed', () => {
    const r = evaluateFrameGate(H, frameFor(G, 'stale'), 'tunable');
    expect(r.outcome.kind).toBe('proceed');
    expect(r.baseHashMatch).toBe(true);
  });

  it('frame gate: tunable + freshness=unknown → stale (still fails closed)', () => {
    const r = evaluateFrameGate(H, frameFor(G, 'unknown'), 'tunable');
    expect(r.outcome).toEqual({ kind: 'stale', reason: 'freshness_not_fresh' });
  });

  it('frame gate: structural + freshness=stale → stale (relaxation is tunable-only)', () => {
    const r = evaluateFrameGate(H, frameFor(G, 'stale'), 'structural');
    expect(r.outcome).toEqual({ kind: 'stale', reason: 'freshness_not_fresh' });
  });

  it('frame gate: no class given + freshness=stale → stale (default posture unchanged)', () => {
    const r = evaluateFrameGate(H, frameFor(G, 'stale'));
    expect(r.outcome).toEqual({ kind: 'stale', reason: 'freshness_not_fresh' });
  });

  it('frame gate: tunable + DIVERGED hash → stale BASE_HASH_DIVERGED even when freshness would pass (CAS semantics untouched)', () => {
    const r = evaluateFrameGate('some-other-hash', frameFor(G, 'stale'), 'tunable');
    expect(r.outcome).toEqual({ kind: 'stale', reason: 'base_hash_diverged' });
    expect(r.baseHashMatch).toBe(false);
  });

  it('referee: tunable update on a stale frame (hash matching) → would_apply (the consecutive-tweak case)', () => {
    const raw = makeEnvelope('update_edge_field', SAMPLE_PAYLOADS.update_edge_field, {
      base_graph_hash: H,
    });
    const v = refereeMutation(raw, G, frameFor(G, 'stale'));
    expect(v.verdict).toBe('would_apply');
  });

  it('referee: tunable update on an UNKNOWN-freshness frame → stale ANALYSIS_NOT_FRESH (still blocked)', () => {
    const raw = makeEnvelope('update_node_field', SAMPLE_PAYLOADS.update_node_field, {
      base_graph_hash: H,
    });
    const v = refereeMutation(raw, G, frameFor(G, 'unknown'));
    expect(v.verdict).toBe('stale');
    expect(v.blocker?.code).toBe(ANALYSIS_NOT_FRESH);
  });

  it('referee: structural mutation on a stale frame → stale (structural posture unchanged by the relaxation)', () => {
    const raw = makeEnvelope('add_node', SAMPLE_PAYLOADS.add_node, { base_graph_hash: H });
    const v = refereeMutation(raw, G, frameFor(G, 'stale'));
    expect(v.verdict).toBe('stale');
    expect(v.blocker?.code).toBe(ANALYSIS_NOT_FRESH);
  });

  it('referee: tunable with a diverged base hash → stale BASE_HASH_DIVERGED (stale-write behaviour unchanged)', () => {
    const raw = makeEnvelope('update_edge_field', SAMPLE_PAYLOADS.update_edge_field, {
      base_graph_hash: 'diverged-hash',
    });
    const v = refereeMutation(raw, G, frameFor(G, 'fresh'));
    expect(v.verdict).toBe('stale');
    expect(v.base_hash_match).toBe(false);
    expect(v.blocker?.code).toBe(BASE_HASH_DIVERGED);
  });
});

describe('D-S rails — R6 non-downgrade and fail-closed builds still govern tunables', () => {
  /** Ready graph where ONLY o-a is configured: emptying o-a's interventions
   *  leaves zero ready options → EP2 OPTIONS_NOT_CONFIGURED (blocked). */
  function singleConfiguredOptionGraph(): GraphV3T {
    const g = buildReadyGraph();
    return {
      ...g,
      nodes: g.nodes.map((n) =>
        n.id === 'o-b' ? { id: n.id, kind: n.kind, label: n.label } : n,
      ),
    };
  }

  it('a tunable that DOWNGRADES readiness (empties the only configured option) → held READINESS_DOWNGRADE', () => {
    const g = singleConfiguredOptionGraph();
    const raw = makeEnvelope(
      'update_node_field',
      { node_id: 'o-a', field: 'interventions', from: { 'f-spend': { value: 0.6 } }, to: {} },
      { base_graph_hash: hashOf(g) },
    );
    const v = refereeMutation(raw, g, frameFor(g));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(READINESS_DOWNGRADE);
  });

  it('a tunable whose candidate fails GraphV3 validation (exists_probability > 1) → rejected GRAPH_INVARIANT_VIOLATED', () => {
    const raw = makeEnvelope(
      'update_edge_field',
      { from_node: 'f-spend', to_node: 'g-profit', field: 'exists_probability', from: 0.9, to: 1.5 },
      { base_graph_hash: H },
    );
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(GRAPH_INVARIANT_VIOLATED);
  });
});

describe('candidate builders — safety rails', () => {
  it('prototype-pollution field paths are refused (held CANDIDATE_BUILD_FAILED), Object.prototype stays clean', () => {
    const built = buildUpdateNodeFieldCandidate(G, {
      node_id: 'f-spend',
      field: '__proto__/polluted',
      to: 'boom',
    });
    expect(built.candidate).toBeUndefined();
    expect(built.error?.code).toBe(CANDIDATE_BUILD_FAILED);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('dotted sub-paths write the leaf (strength.mean) and the candidate revalidates', () => {
    const built = buildUpdateEdgeFieldCandidate(G, {
      from_node: 'f-spend',
      to_node: 'g-profit',
      field: 'strength.mean',
      to: 0.7,
    });
    expect(built.error).toBeUndefined();
    const edges = (built.candidate as GraphV3T).edges;
    const e = edges.find((x) => x.from === 'f-spend' && x.to === 'g-profit');
    expect(e?.strength.mean).toBe(0.7);
    expect(e?.strength.std).toBe(0.1); // sibling leaf preserved
  });

  it('candidates are deep clones — mutating the candidate never aliases the input graph', () => {
    const base = buildReadyGraph();
    const built = buildUpdateNodeFieldCandidate(base, {
      node_id: 'f-spend',
      field: 'description',
      to: 'Quarterly ad budget',
    });
    expect(built.candidate).toBeDefined();
    (built.candidate as GraphV3T).nodes[0]!.label = 'MUTATED';
    expect(base.nodes[0]!.label).not.toBe('MUTATED');
  });

  it('missing target edge → ENTITY_NOT_FOUND error (redacted readable)', () => {
    const built = buildUpdateEdgeFieldCandidate(G, {
      from_node: 'f-spend',
      to_node: 'no-such-node-xyz',
      field: 'exists_probability',
      to: 0.5,
    });
    expect(built.candidate).toBeUndefined();
    expect(built.error?.readable).not.toContain('no-such-node-xyz');
  });
});
