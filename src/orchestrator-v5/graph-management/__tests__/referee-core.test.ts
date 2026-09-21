/**
 * Track 3 — referee R2–R7 + kind-posture + totality.
 *
 * Fail-closed proof: every kind resolves to a classified verdict. Since the
 * D-S ruling (ROADMAP §D, Paul 2026-07-12) the would_apply-eligible set is
 * the TUNABLE class (rename_node, update_node_field, update_edge_field) via
 * candidate-build + R6 parity; every structural kind stays held
 * (propose-confirm), removes stay held-unconfirmed.
 */
import { describe, it, expect } from 'vitest';
import { refereeMutation, refereeMutationBatch } from '../referee.js';
import {
  FRAME_UNAVAILABLE,
  CURRENT_GRAPH_UNREADABLE,
  BASE_HASH_DIVERGED,
  FRESHNESS_UNRESOLVED,
  BATCH_CAP_EXCEEDED,
  ENTITY_NOT_FOUND,
  ENTITY_ID_COLLISION,
  OPTION_ID_COLLISION,
  OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  ADD_OPTION_APPLY_UNWIRED,
  GRAPH_OPTIONS_MALFORMED,
  FIELD_NOT_ALLOWED,
  PIPELINE_OWNED_FIELD,
  ENGINE_CLAIM_IN_TEXT,
  STRUCTURAL_APPLY_HELD,
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
  it('rename on a fresh, hash-matching frame → would_apply', () => {
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

  /**
   * FLIPPED by RULING A4 (Paul, 2026-08-05) from `stale`. `'unknown'` is the
   * freshness AUTHORITY being unresolved, not the analysis being out of date;
   * the ladder holds every other unresolved-authority state (FRAME_UNAVAILABLE,
   * CURRENT_GRAPH_UNREADABLE) and this one now joins them. Note the direction:
   * a hold ASKS the user, where `stale` refused them — and refused them with
   * copy that said "the model has moved" while `base_hash_match` was true in
   * the same payload.
   */
  it('freshness unknown → HELD FRESHNESS_UNRESOLVED when the hash matches (A4: authority unresolved, not staleness)', () => {
    const v = refereeMutation(envFor('rename_node'), G, frameFor(G, 'unknown'));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(FRESHNESS_UNRESOLVED);
    expect(v.base_hash_match).toBe(true);
  });

  it('freshness STALE + tunable (rename) → would_apply (D-S R2 relaxation — consecutive tunable tweaks; ROADMAP §D, Paul 2026-07-12)', () => {
    // Pre-D-S this pinned stale-fail-closed for ALL kinds; the D-S ruling
    // consciously relaxes the freshness rung for the TUNABLE class only
    // (the first auto-applied tunable flips freshness to stale, so the old
    // rule would block every consecutive tweak). Hash divergence still
    // stales (see the base-hash test above) and 'unknown' still fails
    // closed (see below).
    const v = refereeMutation(envFor('rename_node'), G, frameFor(G, 'stale'));
    expect(v.verdict).toBe('would_apply');
  });

  /**
   * FLIPPED by RULING A4 from `stale ANALYSIS_NOT_FRESH`. This pin recorded the
   * dead end the ruling exists to kill: a structural edit on a scenario that
   * has been analysed once was refused, because applying ANY edit flips
   * freshness to `stale` by construction. The base-hash rung above still proves
   * the candidate was generated against the current graph — which is the only
   * currency an edit needs — so the verdict is the propose-confirm HOLD the
   * structural class has always had. Nothing auto-applies that did not before.
   */
  it('freshness STALE + STRUCTURAL → held STRUCTURAL_APPLY_HELD (A4: staleness is a property of the RESULTS, not a lock on the graph)', () => {
    const v = refereeMutation(envFor('add_node'), G, frameFor(G, 'stale'));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });

  it('freshness NONE (pre-analysis) → would_apply for a hash-matching rename (legitimate pre-analysis edit)', () => {
    const v = refereeMutation(envFor('rename_node'), G, frameFor(G, 'none'));
    expect(v.verdict).toBe('would_apply');
  });
});

describe('R7 — kind posture (structural held; tunables auto-apply per D-S)', () => {
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

  it('update_node_field (allowed field) → would_apply (D-S tunable auto-apply — ROADMAP §D, Paul 2026-07-12; was held TUNABLE_APPLY_HELD)', () => {
    const v = refereeMutation(envFor('update_node_field'), G, frameFor(G));
    expect(v.verdict).toBe('would_apply');
    expect(v.candidate).toBeDefined();
    expect(v.mutation_class).toBe('tunable');
  });

  it('update_edge_field (allowed field) → would_apply (D-S tunable auto-apply)', () => {
    const v = refereeMutation(envFor('update_edge_field'), G, frameFor(G));
    expect(v.verdict).toBe('would_apply');
    expect(v.candidate).toBeDefined();
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

  it('rename of a missing node → rejected ENTITY_NOT_FOUND (R3 integrity, first-failure-wins)', () => {
    const raw = makeEnvelope('rename_node', { node_id: 'does-not-exist', to_label: 'X' }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
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

describe('codex-review regressions', () => {
  // Finding 1 — batch cap enforcement (T4.0 PROPOSAL_CAP = 8).
  it('a batch of 9 → single rejected BATCH_CAP_EXCEEDED (never partially processed)', () => {
    const batch = Array.from({ length: 9 }, () => envFor('rename_node'));
    const vs = refereeMutationBatch(batch, G, frameFor(G));
    expect(vs).toHaveLength(1);
    expect(vs[0].verdict).toBe('rejected');
    expect(vs[0].blocker?.code).toBe(BATCH_CAP_EXCEEDED);
  });

  it('a sparse array with a huge length is rejected in O(1), never iterated', () => {
    const sparse: unknown[] = [];
    sparse.length = 1_000_000; // hostile: huge length, no real elements
    let vs: ReturnType<typeof refereeMutationBatch> | undefined;
    expect(() => { vs = refereeMutationBatch(sparse, G, frameFor(G)); }).not.toThrow();
    expect(vs).toHaveLength(1);
    expect(vs![0].blocker?.code).toBe(BATCH_CAP_EXCEEDED);
  });

  // Finding 2 — R3 referential integrity for the posture-held kinds (first-failure-wins).
  it('add_edge with a missing endpoint → rejected ENTITY_NOT_FOUND (not a doctrine hold)', () => {
    const raw = makeEnvelope('add_edge', { edge: { from: 'f-spend', to: 'no-such-node' } }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(ENTITY_NOT_FOUND);
  });

  it('update_node_field on a missing node → rejected ENTITY_NOT_FOUND', () => {
    const raw = makeEnvelope('update_node_field', { node_id: 'no-such-node', field: 'label', from: 'a', to: 'b' }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(ENTITY_NOT_FOUND);
  });

  it('remove_edge on a missing edge → rejected ENTITY_NOT_FOUND', () => {
    const raw = makeEnvelope('remove_edge', { from_node: 'f-spend', to_node: 'f-reach', reason: 'x' }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(ENTITY_NOT_FOUND);
  });

  it('add_node with a colliding id → rejected ENTITY_ID_COLLISION', () => {
    const raw = makeEnvelope('add_node', { node: { id: 'g-profit', kind: 'factor', label: 'Dup' } }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(ENTITY_ID_COLLISION);
  });

  it('valid refs still reach the posture hold (R3 passes) — add_edge existing endpoints → STRUCTURAL_APPLY_HELD', () => {
    const v = refereeMutation(envFor('add_edge'), G, frameFor(G)); // from f-spend to g-profit (both exist)
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });

  // Finding 3 — R1 failure must not leak an unvalidated candidate_id.
  it('R1-rejected envelope with a NON-uuid candidate_id → verdict.candidate_id is null (no leak)', () => {
    const raw = makeEnvelope('rename_node', SAMPLE_PAYLOADS.rename_node, { candidate_id: 'arbitrary secret text', envelope_version: 2 });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.candidate_id).toBeNull();
  });

  it('R1-rejected envelope with a VALID uuid candidate_id → the uuid survives (diagnostic)', () => {
    const raw = makeEnvelope('rename_node', SAMPLE_PAYLOADS.rename_node, { candidate_id: '11111111-1111-4111-8111-111111111111', envelope_version: 2 });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.candidate_id).toBe('11111111-1111-4111-8111-111111111111');
  });

  // Finding 4 — engine-claim scan covers labels / all string payload fields.
  it('add_option whose LABEL carries an engine claim → rejected ENGINE_CLAIM_IN_TEXT', () => {
    const raw = makeEnvelope('add_option', { option: { id: 'o-c', label: 'EVPI of switching plans', edges: [{ to_factor_id: 'f-spend' }] } }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(ENGINE_CLAIM_IN_TEXT);
  });

  it('add_node whose LABEL carries a flip-point claim → rejected ENGINE_CLAIM_IN_TEXT', () => {
    const raw = makeEnvelope('add_node', { node: { id: 'n-fp', kind: 'factor', label: 'flip point sensitivity' } }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(ENGINE_CLAIM_IN_TEXT);
  });

  // Round 2 [P1] — add_option linkage integrity (dangling parent decision / target factor).
  it('add_option with a MISSING parent_decision_id → rejected ENTITY_NOT_FOUND (no dangling edge)', () => {
    const raw = makeEnvelope('add_option', { option: { id: 'o-c', label: 'Plan C', parent_decision_id: 'no-such-decision', edges: [{ to_factor_id: 'f-spend' }] } }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(ENTITY_NOT_FOUND);
  });

  it('add_option with a MISSING target factor → rejected ENTITY_NOT_FOUND (no dangling edge)', () => {
    const raw = makeEnvelope('add_option', { option: { id: 'o-c', label: 'Plan C', parent_decision_id: 'd-choice', edges: [{ to_factor_id: 'no-such-factor' }] } }, { base_graph_hash: hashOf(G) });
    const v = refereeMutation(raw, G, frameFor(G));
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(ENTITY_NOT_FOUND);
  });

  it('add_option with VALID linkage still reaches the held divergence outcome (R3 passes)', () => {
    // parent d-choice + factor f-spend both exist in G → R3 null → held (unwired, nodes-only graph).
    const v = refereeMutation(envFor('add_option'), G, frameFor(G));
    expect(v.verdict).toBe('held');
  });
});
