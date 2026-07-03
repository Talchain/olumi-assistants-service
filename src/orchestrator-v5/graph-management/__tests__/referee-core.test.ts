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
  ANALYSIS_NOT_FRESH,
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

  it('freshness STALE → stale (fail-CLOSED — regression: previously fell through to would_apply)', () => {
    const v = refereeMutation(envFor('rename_node'), G, frameFor(G, 'stale'));
    expect(v.verdict).toBe('stale');
    // No-silent-outcome: the freshness-driven stale carries a machine-readable code.
    expect(v.blocker?.code).toBe(ANALYSIS_NOT_FRESH);
  });

  it('freshness NONE (pre-analysis) → would_apply for a hash-matching rename (legitimate pre-analysis edit)', () => {
    const v = refereeMutation(envFor('rename_node'), G, frameFor(G, 'none'));
    expect(v.verdict).toBe('would_apply');
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

  it('redaction: a candidate-build error does NOT leak the raw node_id into blocker.readable', () => {
    const raw = makeEnvelope('rename_node', { node_id: 'secret-project-x-node', to_label: 'X' }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.blocker?.code).toBe(ENTITY_NOT_FOUND);
    expect(v.blocker?.readable).not.toContain('secret-project-x-node');
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

  it('TOTALITY: a batch array whose element READ throws resolves that slot to a classified verdict (never throws)', () => {
    const arr: unknown[] = [];
    // Defining an array-index property auto-updates length to 1; the getter throws on read.
    Object.defineProperty(arr, '0', { get() { throw new Error('boom'); }, enumerable: true, configurable: true });
    let vs: ReturnType<typeof refereeMutationBatch> | undefined;
    expect(() => { vs = refereeMutationBatch(arr, G, frameFor(G)); }).not.toThrow();
    expect(vs).toHaveLength(1);
    expect(vs![0].verdict).toBe('rejected');
  });
});

describe('code-review regressions', () => {
  it('redaction: R4 field-safety rejection does NOT echo the raw field name into blocker.readable', () => {
    const raw = makeEnvelope('update_node_field', { node_id: 'f-spend', field: 'secret_titan_layoff_field', from: 1, to: 2 }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(FIELD_NOT_ALLOWED);
    expect(v.blocker?.readable).not.toContain('secret_titan_layoff_field');
  });

  it('base graph invalid (not a candidate fault) → held CURRENT_GRAPH_UNREADABLE, not rejected', () => {
    // A structurally-invalid GraphV3 (node missing kind/label); frame reports readable + matching hash.
    const badGraph = { nodes: [{ id: 'x' }], edges: [] };
    const frame = { currentGraphHash: 'h1', graphReadable: true, freshness: 'fresh' as const };
    const raw = makeEnvelope('rename_node', { node_id: 'x', to_label: 'Y' }, { base_graph_hash: 'h1' });
    const v = refereeMutation(raw, badGraph, frame);
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(CURRENT_GRAPH_UNREADABLE);
  });

  it('engine-claim in a flag_uncertainty question is REJECTED (field-safety now runs before the clarify short-circuit)', () => {
    const raw = makeEnvelope('flag_uncertainty', { target_ref: 'f-spend', question: 'What is the EVPI of this factor?' }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(ENGINE_CLAIM_IN_TEXT);
  });

  it('engine-claim smuggled as an update_node_field VALUE is rejected', () => {
    const raw = makeEnvelope('update_node_field', { node_id: 'f-spend', field: 'label', from: 'Marketing spend', to: 'flip-point at 42%' }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(ENGINE_CLAIM_IN_TEXT);
  });
});
