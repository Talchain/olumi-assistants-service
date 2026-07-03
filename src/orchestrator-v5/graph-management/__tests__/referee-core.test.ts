/**
 * Track 3 — referee R2–R7 + kind-posture + totality.
 *
 * Fail-closed proof: every kind resolves to a classified verdict; the only
 * `would_apply` case is a hash-neutral rename on a fresh, hash-matching frame.
 */
import { describe, it, expect } from 'vitest';
import { refereeMutation, refereeMutationBatch } from '../referee.js';
import {
  FRAME_UNAVAILABLE,
  CURRENT_GRAPH_UNREADABLE,
  BASE_HASH_DIVERGED,
  ENTITY_NOT_FOUND,
  OPTION_ID_COLLISION,
  OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  ADD_OPTION_APPLY_UNWIRED,
  GRAPH_OPTIONS_MALFORMED,
  FIELD_NOT_ALLOWED,
  PIPELINE_OWNED_FIELD,
  ENGINE_CLAIM_IN_TEXT,
  STRUCTURAL_APPLY_HELD,
  TUNABLE_APPLY_HELD,
  REMOVE_UNCONFIRMED,
} from '../reason-codes.js';
import {
  buildReadyGraph,
  buildReadyGraphWithTopLevelOptions,
  frameFor,
  hashOf,
  makeEnvelope,
  SAMPLE_PAYLOADS,
} from './fixtures.js';

const G = buildReadyGraph();
const envFor = (kind: keyof typeof SAMPLE_PAYLOADS, graph: unknown = G, over = {}) =>
  makeEnvelope(kind, SAMPLE_PAYLOADS[kind], { base_graph_hash: hashOf(graph), ...over });

describe('R2 — frame / stale gate', () => {
  it('rename on a fresh, hash-matching frame → would_apply (the only would_apply case)', () => {
    const v = refereeMutation(envFor('rename_node'), G, frameFor(G));
    expect(v.verdict).toBe('would_apply');
    expect(v.candidate).toBeDefined();
    expect(v.mutation_class).toBe('tunable');
    expect(v.base_hash_match).toBe(true);
  });

  it('no frame → held FRAME_UNAVAILABLE', () => {
    const v = refereeMutation(envFor('rename_node'), G, null);
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(FRAME_UNAVAILABLE);
  });

  it('unreadable frame → held CURRENT_GRAPH_UNREADABLE', () => {
    const v = refereeMutation(envFor('rename_node'), G, { currentGraphHash: null, graphReadable: false, freshness: 'unknown' });
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(CURRENT_GRAPH_UNREADABLE);
  });

  it('base hash diverged → stale BASE_HASH_DIVERGED', () => {
    const v = refereeMutation(makeEnvelope('rename_node', SAMPLE_PAYLOADS.rename_node, { base_graph_hash: 'stale-hash' }), G, frameFor(G));
    expect(v.verdict).toBe('stale');
    expect(v.base_hash_match).toBe(false);
    expect(v.blocker?.code).toBe(BASE_HASH_DIVERGED);
  });

  it('freshness unknown → stale (fail-closed) even when the hash matches', () => {
    const v = refereeMutation(envFor('rename_node'), G, frameFor(G, 'unknown'));
    expect(v.verdict).toBe('stale');
  });
});

describe('R7 — kind posture (fail-closed; §3b/§6 pending → held)', () => {
  it('add_node → held STRUCTURAL_APPLY_HELD', () => {
    const v = refereeMutation(envFor('add_node'), G, frameFor(G));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
    expect(v.mutation_class).toBe('structural');
  });

  it('add_edge → held STRUCTURAL_APPLY_HELD', () => {
    const v = refereeMutation(envFor('add_edge'), G, frameFor(G));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });

  it('update_node_field (allowed field) → held TUNABLE_APPLY_HELD (no tunable auto-apply)', () => {
    const v = refereeMutation(envFor('update_node_field'), G, frameFor(G));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(TUNABLE_APPLY_HELD);
    expect(v.mutation_class).toBe('tunable');
  });

  it('remove_node → held REMOVE_UNCONFIRMED', () => {
    const v = refereeMutation(envFor('remove_node'), G, frameFor(G));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(REMOVE_UNCONFIRMED);
  });

  it('flag_uncertainty → clarify_required (never mutates)', () => {
    const v = refereeMutation(envFor('flag_uncertainty'), G, frameFor(G));
    expect(v.verdict).toBe('clarify_required');
    expect(v.mutation_class).toBe('non_mutating');
  });

  it('clarification → clarify_required', () => {
    const v = refereeMutation(envFor('clarification'), G, frameFor(G));
    expect(v.verdict).toBe('clarify_required');
  });
});

describe('R4 — field-safety', () => {
  it('rejects a disallowed update field (FIELD_NOT_ALLOWED)', () => {
    const raw = makeEnvelope('update_node_field', { node_id: 'f-spend', field: 'kind', from: 'factor', to: 'goal' }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(FIELD_NOT_ALLOWED);
  });

  it('rejects a pipeline-owned field (PIPELINE_OWNED_FIELD)', () => {
    const raw = makeEnvelope('update_node_field', { node_id: 'f-spend', field: 'sensitivity_score', from: 0, to: 1 }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('rejects an engine-claim in narrative free text (ENGINE_CLAIM_IN_TEXT)', () => {
    const raw = makeEnvelope('rename_node', SAMPLE_PAYLOADS.rename_node, { base_graph_hash: hashOf(G), rationale: 'This raises the EVPI substantially.' });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(ENGINE_CLAIM_IN_TEXT);
  });
});

describe('add_option — always held (never would_apply)', () => {
  it('no top-level options[] → held ADD_OPTION_APPLY_UNWIRED', () => {
    const v = refereeMutation(envFor('add_option'), G, frameFor(G));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(ADD_OPTION_APPLY_UNWIRED);
    expect(v.candidate).toBeDefined(); // built for transparency
  });

  it('top-level options[] present → held OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE', () => {
    const graph = buildReadyGraphWithTopLevelOptions();
    const v = refereeMutation(envFor('add_option', graph), graph, frameFor(graph));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE);
  });

  it('id collision → held OPTION_ID_COLLISION', () => {
    const payload = { option: { id: 'g-profit', label: 'Dup', edges: [{ to_factor_id: 'f-spend' }] } };
    const raw = makeEnvelope('add_option', payload, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(OPTION_ID_COLLISION);
  });
});

describe('general graph-corruption + R3 guards', () => {
  it('malformed top-level options on the current graph → held GRAPH_OPTIONS_MALFORMED', () => {
    const corrupt = { ...buildReadyGraph(), options: 'oops' };
    const v = refereeMutation(makeEnvelope('rename_node', SAMPLE_PAYLOADS.rename_node, { base_graph_hash: hashOf(corrupt) }), corrupt, frameFor(corrupt));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(GRAPH_OPTIONS_MALFORMED);
  });

  it('rename of a missing node → held ENTITY_NOT_FOUND', () => {
    const raw = makeEnvelope('rename_node', { node_id: 'does-not-exist', to_label: 'X' }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(ENTITY_NOT_FOUND);
  });
});

describe('provenance-independence + totality', () => {
  it('verdict is independent of provenance.source (AI-suggested vs chip vs user-direct)', () => {
    const sources = ['dual_model_m2', 'edit_graph_llm', 'flip_proposal', 'user_direct'] as const;
    const verdicts = sources.map(
      (source) => refereeMutation(makeEnvelope('rename_node', SAMPLE_PAYLOADS.rename_node, { base_graph_hash: hashOf(G), source }), G, frameFor(G)).verdict,
    );
    expect(new Set(verdicts)).toEqual(new Set(['would_apply']));
  });

  it('TOTALITY: garbage / throwing input resolves to a classified verdict, never throws', () => {
    const throwing = new Proxy({}, { get() { throw new Error('boom'); } });
    for (const bad of [null, undefined, 42, 'x', [], {}, throwing]) {
      const v = refereeMutation(bad, G, frameFor(G));
      expect(['rejected', 'held', 'stale', 'clarify_required', 'would_apply']).toContain(v.verdict);
    }
  });

  it('batch: non-array input → single rejected verdict; array → per-envelope verdicts', () => {
    expect(refereeMutationBatch('nope', G, frameFor(G))).toHaveLength(1);
    const batch = [envFor('rename_node'), envFor('add_option'), envFor('flag_uncertainty')];
    const vs = refereeMutationBatch(batch, G, frameFor(G));
    expect(vs.map((v) => v.verdict)).toEqual(['would_apply', 'held', 'clarify_required']);
  });
});
