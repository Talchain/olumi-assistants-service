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
 *  - ⭐ SUPERSEDED BY RULING A4 (2026-08-05), recorded rather than deleted so
 *    the sequence stays readable: the R2 relaxation WAS the narrowest one
 *    (tunable-class only). A4 found the D-S rationale class-independent and
 *    generalised it, so the freshness rung now trusts 'stale' for EVERY class
 *    and no longer sees the class at all. What survives A4 verbatim:
 *    'unknown' never auto-applies (it is now a HOLD, FRESHNESS_UNRESOLVED),
 *    and base-hash divergence still stales for EVERY class (CAS untouched).
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
  FRESHNESS_UNRESOLVED,
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

/**
 * ⭐⭐ GENERALISED BY RULING A4 (Paul, 2026-08-05).
 *
 * The D-S relaxation was, in its own commit message, the "NARROWEST R2
 * relaxation" — not the only safe one. A4 read that argument back and found it
 * class-INDEPENDENT: the base-hash rung proves candidate currency for every
 * class, and staleness is a property of the ANALYSIS for every class. So the
 * tunable-only carve-out is now the rule, and the class no longer reaches the
 * gate at all.
 *
 * The pins below therefore flip from "the relaxation is tunable-only" to "the
 * trust set is class-independent". WHAT DOES NOT FLIP, and is asserted harder
 * here than before: base-hash divergence still stales for every class, and
 * `'unknown'` still refuses to auto-apply — it is now a HOLD (the honest ask)
 * rather than a `stale` refusal carrying copy that contradicted its own
 * `base_hash_match` field.
 */
describe('A4 — the freshness rung is class-independent (generalising the D-S relaxation)', () => {
  it('frame gate: freshness=stale + matching hash → proceed (was: tunable-only)', () => {
    const r = evaluateFrameGate(H, frameFor(G, 'stale'));
    expect(r.outcome.kind).toBe('proceed');
    expect(r.baseHashMatch).toBe(true);
  });

  it('frame gate: freshness=unknown → freshness_unresolved (authority unresolved → HOLD, never stale)', () => {
    const r = evaluateFrameGate(H, frameFor(G, 'unknown'));
    expect(r.outcome).toEqual({ kind: 'freshness_unresolved' });
  });

  it('frame gate: DIVERGED hash → stale BASE_HASH_DIVERGED even when freshness would pass (CAS semantics UNTOUCHED)', () => {
    const r = evaluateFrameGate('some-other-hash', frameFor(G, 'stale'));
    expect(r.outcome).toEqual({ kind: 'stale', reason: 'base_hash_diverged' });
    expect(r.baseHashMatch).toBe(false);
  });

  it('referee: tunable update on a stale frame (hash matching) → would_apply (the consecutive-tweak case, unchanged)', () => {
    const raw = makeEnvelope('update_edge_field', SAMPLE_PAYLOADS.update_edge_field, {
      base_graph_hash: H,
    });
    const v = refereeMutation(raw, G, frameFor(G, 'stale'));
    expect(v.verdict).toBe('would_apply');
  });

  it('referee: tunable update on an UNKNOWN-freshness frame → held FRESHNESS_UNRESOLVED (still never auto-applies)', () => {
    const raw = makeEnvelope('update_node_field', SAMPLE_PAYLOADS.update_node_field, {
      base_graph_hash: H,
    });
    const v = refereeMutation(raw, G, frameFor(G, 'unknown'));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(FRESHNESS_UNRESOLVED);
  });

  it('referee: structural mutation on a stale frame → held STRUCTURAL_APPLY_HELD (A4: the dead end becomes a consent ask)', () => {
    const raw = makeEnvelope('add_node', SAMPLE_PAYLOADS.add_node, { base_graph_hash: H });
    const v = refereeMutation(raw, G, frameFor(G, 'stale'));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
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
  it('a tunable that DOWNGRADES readiness (empties a configured option) → held READINESS_DOWNGRADE', () => {
    // Start from a genuinely canonical-ready graph. The former fixture had
    // already removed o-b's value, so the "before" record was non-ready and
    // emptying o-a could not constitute a downgrade.
    const g = buildReadyGraph();
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
