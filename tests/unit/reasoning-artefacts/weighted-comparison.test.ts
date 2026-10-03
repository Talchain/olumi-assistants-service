import { describe, expect, it } from 'vitest';

import { assessBindingCurrentness } from '../../../src/orchestrator-v5/agent-lane/runtime/reasoning-artefacts/common.js';
import { assessReasoningArtefactCurrentness, createReasoningArtefact, presentWeightedComparison, serializeReasoningArtefact,
  validateReasoningArtefact } from '../../../src/orchestrator-v5/agent-lane/runtime/reasoning-artefacts/index.js';
import { createWeightedComparison } from '../../../src/orchestrator-v5/agent-lane/runtime/reasoning-artefacts/weighted-comparison.js';

function fixture() {
  const input = {
    option_ids: ['option-a', 'option-b'],
    criteria: [
      { id: 'cost', label: 'Cost', meaning: 'Preference-adjusted affordability', polarity: 'lower', provenance: 'user_stated',
        weight: { value: 2, provenance: 'user_stated' } },
      { id: 'fit', label: 'Fit', meaning: 'Strategic fit', polarity: 'higher', provenance: 'user_stated',
        weight: { value: 1, provenance: 'user_stated' } },
    ],
    utilities: [
      { option_id: 'option-a', criterion_id: 'cost', value: 0.9 as number | null, origin: 'user_supplied', provenance: 'user_stated', source_refs: [] as { source_id: string; source_version: string }[] },
      { option_id: 'option-a', criterion_id: 'fit', value: 0.6 as number | null, origin: 'user_supplied', provenance: 'user_stated', source_refs: [] as { source_id: string; source_version: string }[] },
      { option_id: 'option-b', criterion_id: 'cost', value: 0.4 as number | null, origin: 'user_supplied', provenance: 'user_stated', source_refs: [] as { source_id: string; source_version: string }[] },
      { option_id: 'option-b', criterion_id: 'fit', value: 0.8 as number | null, origin: 'user_supplied', provenance: 'user_stated', source_refs: [] as { source_id: string; source_version: string }[] },
    ],
    sensitivity: null as null | { criterion_id: string; weights: number[] },
  };
  const host = {
    scenario_id: 'scenario-1',
    graph_revision: 'graph-1',
    canonical_options: [{ id: 'option-a', label: 'A' }, { id: 'option-b', label: 'B' }],
    confirmed_preferences: [
      { criterion_id: 'cost', value: 2, confirmation_provenance: 'confirmed by user' },
      { criterion_id: 'fit', value: 1, confirmation_provenance: 'confirmed by user' },
    ],
    required_constraint_ids: ['hard-limit'],
    constraint_verdicts: [
      { option_id: 'option-a', constraint_id: 'hard-limit', status: 'pass' },
      { option_id: 'option-b', constraint_id: 'hard-limit', status: 'pass' },
    ],
    source_statuses: [] as { source_id: string; source_version: string | null; state: string }[],
    analysis_identity: null as null | { scenario_id: string; graph_hash_at_run: string; computed_at: string },
    analysis_state: null as null | 'current' | 'stale' | 'unknown',
    observed_score_attestations: [] as { option_id: string; criterion_id: string; value: number;
      source_refs: { source_id: string; source_version: string }[];
      approved_provenance: 'user_stated' | 'source_evidence'; authority_ref: string; approved: true }[],
    derived_score_lineage_attestations: [] as { option_id: string; criterion_id: string;
      origin: 'evidence_derived' | 'ai_estimate' | 'analysis_derived'; value: number;
      source_refs: { source_id: string; source_version: string }[];
      source_independent: boolean; authority_ref: string }[],
  };
  return { input, host };
}

function attestDerived(input: ReturnType<typeof fixture>['input'], host: ReturnType<typeof fixture>['host'],
  utilityIndex: number, source_independent: boolean): void {
  const utility = input.utilities[utilityIndex]!;
  if (utility.value === null) throw new Error('test utility must be valued');
  host.derived_score_lineage_attestations.push({
    option_id: utility.option_id, criterion_id: utility.criterion_id,
    origin: utility.origin as 'evidence_derived' | 'ai_estimate' | 'analysis_derived', value: utility.value,
    source_refs: structuredClone(utility.source_refs), source_independent,
    authority_ref: `host-lineage-${utility.option_id}-${utility.criterion_id}`,
  });
}

describe('F2a weighted comparison', () => {
  it('uses already-normalised higher-is-better utilities, retaining supplied and normalised weights', () => {
    const { input, host } = fixture();
    const artefact = createWeightedComparison(input, host);
    expect(artefact.calculation_validity.status).toBe('valid');
    expect(artefact.calculation_validity.rows.map((r) => r.option_id)).toEqual(['option-a', 'option-b']);
    expect(artefact.calculation_validity.rows.map((r) => r.missing_criterion_ids)).toEqual([[], []]);
    expect(artefact.calculation_validity.rows[0]?.total).toBeCloseTo(0.8);
    expect(artefact.calculation_validity.rows[1]?.total).toBeCloseTo((0.4 * 2 + 0.8) / 3);
    expect(artefact.preference_ownership).toEqual([
      { criterion_id: 'cost', supplied_weight: 2, supplied_provenance: 'user_stated', confirmed: true,
        confirmation_provenance: 'confirmed by user', normalised_weight: 2 / 3 },
      { criterion_id: 'fit', supplied_weight: 1, supplied_provenance: 'user_stated', confirmed: true,
        confirmation_provenance: 'confirmed by user', normalised_weight: 1 / 3 },
    ]);
    expect(artefact.ordering_permission).toEqual({ permitted: true, reasons: [], groups: [['option-a'], ['option-b']] });
  });

  it('keeps stable tie groups and deterministic content hashes for identical consumed inputs', () => {
    const { input, host } = fixture();
    input.utilities[2]!.value = 0.9;
    input.utilities[3]!.value = 0.6;
    const first = createWeightedComparison(input, host);
    const second = createWeightedComparison(structuredClone(input), structuredClone(host));
    expect(first.canonical_input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.canonical_input_hash).toBe(first.canonical_input_hash);
    expect(first.ordering_permission.groups).toEqual([['option-a', 'option-b']]);
    expect(first.calculation_validity.rows[0]?.total).toBeCloseTo(0.8);
    expect(first.calculation_validity.rows[1]?.total).toBeCloseTo(0.8);
  });

  it('rejects all-zero, negative and non-finite weights and malformed utilities', () => {
    for (const weights of [[0, 0], [-1, 1], [Number.NaN, 1], [Number.POSITIVE_INFINITY, 1]]) {
      const { input, host } = fixture();
      input.criteria[0]!.weight.value = weights[0]!;
      input.criteria[1]!.weight.value = weights[1]!;
      expect(() => createWeightedComparison(input, host)).toThrow();
    }
    for (const value of [-0.01, 1.01, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const { input, host } = fixture();
      input.utilities[0]!.value = value;
      expect(() => createWeightedComparison(input, host)).toThrow();
    }
  });

  it('keeps totals and ordering invariant when all supplied weights are scaled equally', () => {
    const baseline = fixture();
    const scaled = fixture();
    for (const criterion of scaled.input.criteria) criterion.weight.value *= 10;
    for (const preference of scaled.host.confirmed_preferences) preference.value *= 10;
    const a = createWeightedComparison(baseline.input, baseline.host);
    const b = createWeightedComparison(scaled.input, scaled.host);
    expect(b.calculation_validity).toEqual(a.calculation_validity);
    expect(b.ordering_permission).toEqual(a.ordering_permission);
    expect(b.preference_ownership.map((p) => p.normalised_weight)).toEqual(a.preference_ownership.map((p) => p.normalised_weight));
    expect(b.preference_ownership.map((p) => p.supplied_weight)).toEqual([20, 10]);
    expect(b.canonical_input_hash).not.toBe(a.canonical_input_hash);
  });

  it('does not mutate caller objects and refuses inherited required properties', () => {
    const { input, host } = fixture();
    const originalInput = structuredClone(input);
    const originalHost = structuredClone(host);
    createWeightedComparison(input, host);
    expect(input).toEqual(originalInput);
    expect(host).toEqual(originalHost);

    const inherited = Object.assign(Object.create({ option_ids: input.option_ids }) as Record<string, unknown>, {
      criteria: input.criteria, utilities: input.utilities, sensitivity: null,
    });
    expect(() => createWeightedComparison(inherited, host)).toThrow();

    const sparse = new Array(1) as typeof input.utilities;
    Object.setPrototypeOf(sparse, Object.assign(Object.create(Array.prototype) as object, { 0: input.utilities[0] }));
    input.utilities = sparse;
    expect(() => createWeightedComparison(input, host)).toThrow('sparse_array');
  });

  it('requires the selected option set to match the host canonical projection', () => {
    const { input, host } = fixture();
    host.canonical_options.push({ id: 'option-c', label: 'C' });
    expect(() => createWeightedComparison(input, host)).toThrow('option_selection_mismatch');
  });

  it('withholds an option total for an unknown positive-weight utility', () => {
    const { input, host } = fixture();
    input.utilities[1]!.value = null;
    input.utilities[1]!.origin = 'unknown';
    input.utilities[1]!.provenance = 'unknown';
    const artefact = createWeightedComparison(input, host);
    expect(artefact.calculation_validity.status).toBe('incomplete');
    expect(artefact.calculation_validity.rows[0]).toEqual({
      option_id: 'option-a', total: null, missing_criterion_ids: ['fit'],
    });
    expect(artefact.ordering_permission.permitted).toBe(false);
    expect(artefact.ordering_permission.reasons).toContain('incomplete_utilities');
  });

  it('shows a zero-weight unknown and blocks it when sensitivity gives that criterion weight', () => {
    const { input, host } = fixture();
    input.criteria[0]!.weight.value = 1;
    input.criteria[1]!.weight.value = 0;
    host.confirmed_preferences[0]!.value = 1;
    host.confirmed_preferences[1]!.value = 0;
    input.utilities[1]!.value = null;
    input.utilities[1]!.origin = 'unknown';
    input.utilities[1]!.provenance = 'unknown';
    input.sensitivity = { criterion_id: 'fit', weights: [0, 0.25] };
    const artefact = createWeightedComparison(input, host);
    expect(artefact.calculation_validity.status).toBe('valid');
    expect(artefact.calculation_validity.rows[0]?.total).toBe(0.9);
    expect(artefact.sensitivity?.status).toBe('calculated');
    expect(artefact.sensitivity?.points[0]?.rows[0]?.total).toBe(0.9);
    expect(artefact.sensitivity?.points[1]?.rows[0]).toEqual({
      option_id: 'option-a', total: null, missing_criterion_ids: ['fit'],
    });
  });

  it('calculates each sensitivity point even when a missing base score makes the base incomplete', () => {
    const { input, host } = fixture();
    input.utilities[1]!.value = null;
    input.utilities[1]!.origin = 'unknown';
    input.utilities[1]!.provenance = 'unknown';
    input.sensitivity = { criterion_id: 'fit', weights: [0, 0.5] };
    const artefact = createWeightedComparison(input, host);
    expect(artefact.calculation_validity.status).toBe('incomplete');
    expect(artefact.sensitivity?.status).toBe('calculated');
    expect(artefact.sensitivity?.points[0]?.rows[0]?.total).toBe(0.9);
    expect(artefact.sensitivity?.points[1]?.rows[0]?.total).toBeNull();
  });

  it('retains a highest utility result that fails a hard constraint without naming a usable leader', () => {
    const { input, host } = fixture();
    host.constraint_verdicts[0]!.status = 'fail';
    const artefact = createWeightedComparison(input, host);
    expect(artefact.calculation_validity.status).toBe('valid');
    expect(artefact.calculation_validity.rows[0]?.total).toBeCloseTo(0.8);
    expect(artefact.constraint_feasibility.map((f) => f.status)).toEqual(['fail', 'pass']);
    expect(artefact.ordering_permission.permitted).toBe(false);
    expect(artefact.ordering_permission.groups).toBeNull();
    expect(artefact.ordering_permission.reasons).toContain('hard_constraint_failed');
  });

  it('keeps unknown feasibility separate from pass and fail and withholds unconfirmed preferences', () => {
    const { input, host } = fixture();
    host.constraint_verdicts.splice(0, 1);
    host.confirmed_preferences.splice(0, 1);
    const artefact = createWeightedComparison(input, host);
    expect(artefact.calculation_validity.status).toBe('valid');
    expect(artefact.constraint_feasibility[0]?.status).toBe('unknown');
    expect(artefact.preference_ownership[0]?.confirmed).toBe(false);
    expect(artefact.ordering_permission.reasons).toEqual(expect.arrayContaining(['hard_constraint_unknown', 'unconfirmed_preferences']));
  });

  it('treats graph revision as provenance and only relevant consumed edits as stale', () => {
    const { input, host } = fixture();
    const saved = createWeightedComparison(input, host);
    host.graph_revision = 'graph-2';
    const unrelated = createWeightedComparison(input, host);
    expect(unrelated.canonical_input_hash).toBe(saved.canonical_input_hash);
    expect(assessBindingCurrentness(saved.binding, unrelated.binding).state).toBe('current');
    input.utilities[0]!.value = 0.85;
    const changed = createWeightedComparison(input, host);
    expect(assessBindingCurrentness(saved.binding, changed.binding)).toEqual({
      state: 'stale', changed_dependencies: ['utility:["option-a","cost"]'],
    });
    input.utilities[0]!.value = 0.9;
    host.required_constraint_ids.push('new-limit');
    const addedRelevantDependency = createWeightedComparison(input, host);
    expect(assessBindingCurrentness(saved.binding, addedRelevantDependency.binding).changed_dependencies).toEqual([
      'constraint:["option-a","new-limit"]', 'constraint:["option-b","new-limit"]',
    ]);
  });

  it('keeps composite identities distinct when canonical ids contain delimiters', () => {
    const { input, host } = fixture();
    input.option_ids = ['a\u0000b', 'a'];
    input.criteria[0]!.id = 'c';
    input.criteria[1]!.id = 'b\u0000c';
    input.utilities = [{ option_id: 'a\u0000b', criterion_id: 'c', value: 0.9,
      origin: 'user_supplied', provenance: 'user_stated', source_refs: [] }];
    host.canonical_options = [{ id: 'a\u0000b', label: 'First' }, { id: 'a', label: 'Second' }];
    host.confirmed_preferences = [
      { criterion_id: 'c', value: 2, confirmation_provenance: 'owner' },
      { criterion_id: 'b\u0000c', value: 1, confirmation_provenance: 'owner' },
    ];
    host.required_constraint_ids = [];
    host.constraint_verdicts = [];
    const noBorrowedScore = createWeightedComparison(input, host);
    expect(noBorrowedScore.calculation_validity.rows[1]?.missing_criterion_ids).toEqual(['c', 'b\u0000c']);

    input.option_ids = ['a:b', 'a'];
    input.criteria[0]!.id = 'c';
    input.criteria[1]!.id = 'b:c';
    input.utilities = [];
    host.canonical_options = [{ id: 'a:b', label: 'First' }, { id: 'a', label: 'Second' }];
    host.confirmed_preferences[1]!.criterion_id = 'b:c';
    expect(() => createWeightedComparison(input, host)).not.toThrow();
  });

  it('binds analysis identity only when an analysis-derived utility was consumed', () => {
    const { input, host } = fixture();
    host.analysis_identity = { scenario_id: 'scenario-1', graph_hash_at_run: 'hash-1', computed_at: 'time-1' };
    const withoutAnalysis = createWeightedComparison(input, host);
    host.analysis_identity.graph_hash_at_run = 'hash-2';
    const stillIndependent = createWeightedComparison(input, host);
    expect(stillIndependent.canonical_input_hash).toBe(withoutAnalysis.canonical_input_hash);
    expect(assessBindingCurrentness(withoutAnalysis.binding, stillIndependent.binding).state).toBe('current');

    input.utilities[0]!.origin = 'analysis_derived';
    input.utilities[0]!.provenance = 'olumi_hypothesis';
    attestDerived(input, host, 0, true);
    host.analysis_state = 'current';
    const bound = createWeightedComparison(input, host);
    expect(bound.ordering_permission.permitted).toBe(true);
    host.analysis_identity.graph_hash_at_run = 'hash-3';
    const changed = createWeightedComparison(input, host);
    expect(assessBindingCurrentness(bound.binding, changed.binding)).toEqual({
      state: 'stale', changed_dependencies: ['analysis:run'],
    });
    host.analysis_state = 'stale';
    const staleAtCreation = createWeightedComparison(input, host);
    expect(staleAtCreation.ordering_permission.reasons).toContain('analysis_not_current');
    host.analysis_state = 'current';
    host.analysis_identity.computed_at = 'later-timestamp-same-run';
    const sameAnalysisIdentity = createWeightedComparison(input, host);
    expect(sameAnalysisIdentity.canonical_input_hash).toBe(changed.canonical_input_hash);
    expect(assessBindingCurrentness(changed.binding, sameAnalysisIdentity.binding).state).toBe('current');
  });

  it('ignores incidental ordering of confirmed preferences, verdicts and source statuses', () => {
    const { input, host } = fixture();
    input.utilities[0]!.origin = 'evidence_derived';
    input.utilities[0]!.provenance = 'source_evidence';
    input.utilities[0]!.source_refs = [{ source_id: 'source-a', source_version: 'v1' }];
    input.utilities[1]!.origin = 'evidence_derived';
    input.utilities[1]!.provenance = 'source_evidence';
    input.utilities[1]!.source_refs = [{ source_id: 'source-b', source_version: 'v2' }];
    host.source_statuses = [
      { source_id: 'source-b', source_version: 'v2', state: 'current' },
      { source_id: 'source-a', source_version: 'v1', state: 'current' },
    ];
    attestDerived(input, host, 0, false);
    attestDerived(input, host, 1, false);
    const first = createWeightedComparison(input, host);
    host.confirmed_preferences.reverse();
    host.constraint_verdicts.reverse();
    host.source_statuses.reverse();
    input.utilities.reverse();
    const reordered = createWeightedComparison(input, host);
    expect(reordered.canonical_input_hash).toBe(first.canonical_input_hash);
    expect(reordered).toEqual(first);
  });

  it('revalidates serialised calculations and assesses currentness before a host persistence port', () => {
    const { input, host } = fixture();
    const created = createReasoningArtefact('weighted_comparison', input, host);
    const serialised = serializeReasoningArtefact(created);
    const reloaded = validateReasoningArtefact(JSON.parse(serialised) as unknown);
    expect(reloaded).toEqual(created);
    host.graph_revision = 'unrelated-revision';
    expect(assessReasoningArtefactCurrentness(reloaded, input, host).state).toBe('current');
    const corrupted = JSON.parse(serialised) as { calculation_validity: { rows: { total: number }[] } };
    corrupted.calculation_validity.rows[0]!.total = 1;
    expect(() => validateReasoningArtefact(corrupted)).toThrow('artefact_revalidation_failed');
  });

  it('matches recovered weightedMatrix and weightSensitivity on an identical valid fixture', () => {
    // Frozen results from programme-docs recovery a5f5847: capabilities.mjs weightedMatrix/weightSensitivity.
    // The same fixture was run against both implementations during F2a; these values guard arithmetic drift.
    const { input, host } = fixture();
    input.sensitivity = { criterion_id: 'cost', weights: [0, 0.5, 1] };
    const artefact = createWeightedComparison(input, host);
    expect(artefact.calculation_validity.rows.map((row) => row.total)).toEqual([0.7999999999999999, 0.5333333333333333]);
    expect(artefact.sensitivity?.points.map((point) => point.rows.map((row) => row.total))).toEqual([
      [0.6, 0.8], [0.75, 0.6000000000000001], [0.9, 0.4],
    ]);
  });

  it('rejects score-origin laundering across user, AI, evidence, analysis, observed and unknown states', () => {
    const invalid = [
      { origin: 'user_supplied', provenance: 'source_evidence', value: 0.9 },
      { origin: 'ai_estimate', provenance: 'user_stated', value: 0.9 },
      { origin: 'evidence_derived', provenance: 'user_stated', value: 0.9 },
      { origin: 'analysis_derived', provenance: 'source_evidence', value: 0.9 },
      { origin: 'observed', provenance: 'olumi_hypothesis', value: 0.9 },
      { origin: 'unknown', provenance: 'user_stated', value: null },
      { origin: 'unknown', provenance: 'unknown', value: 0.9 },
    ];
    for (const specimen of invalid) {
      const { input, host } = fixture();
      Object.assign(input.utilities[0]!, specimen);
      expect(() => createWeightedComparison(input, host)).toThrow();
    }
    const ai = fixture();
    ai.input.utilities[0]!.origin = 'ai_estimate';
    ai.input.utilities[0]!.provenance = 'olumi_hypothesis';
    attestDerived(ai.input, ai.host, 0, true);
    expect(createWeightedComparison(ai.input, ai.host).calculation_validity.status).toBe('valid');

    const analysis = fixture();
    analysis.input.utilities[0]!.origin = 'analysis_derived';
    analysis.input.utilities[0]!.provenance = 'olumi_hypothesis';
    attestDerived(analysis.input, analysis.host, 0, true);
    expect(() => createWeightedComparison(analysis.input, analysis.host)).toThrow('analysis_identity_required');
  });

  it('rejects source-derived criterion or weight provenance without an independent host source binding', () => {
    for (const field of ['criterion', 'weight'] as const) {
      const { input, host } = fixture();
      // Utilities remain user-supplied and unsourced. Their provenance cannot cover a sourced preference.
      expect(input.utilities.every((utility) => utility.source_refs.length === 0)).toBe(true);
      host.source_statuses = [{ source_id: 'weight-note', source_version: 'v1', state: 'revoked' }];
      if (field === 'criterion') input.criteria[0]!.provenance = 'source_evidence';
      else input.criteria[0]!.weight.provenance = 'source_evidence';
      expect(() => createWeightedComparison(input, host)).toThrow('source_derived_preference_unbound');
    }
  });

  it('requires host-owned exact lineage for evidence, AI and analysis-derived scores', () => {
    for (const origin of ['evidence_derived', 'ai_estimate', 'analysis_derived'] as const) {
      const { input, host } = fixture();
      input.utilities[0]!.origin = origin;
      input.utilities[0]!.provenance = origin === 'evidence_derived' ? 'source_evidence' : 'olumi_hypothesis';
      if (origin === 'evidence_derived') {
        input.utilities[0]!.source_refs = [{ source_id: 'source-a', source_version: 'v1' }];
        host.source_statuses = [{ source_id: 'source-a', source_version: 'v1', state: 'current' }];
      }
      if (origin === 'analysis_derived') {
        host.analysis_identity = { scenario_id: 'scenario-1', graph_hash_at_run: 'analysis-hash', computed_at: 'time' };
        host.analysis_state = 'current';
      }
      expect(() => createWeightedComparison(input, host)).toThrow('derived_score_lineage_not_attested');
      attestDerived(input, host, 0, origin !== 'evidence_derived');
      expect(createWeightedComparison(input, host).calculation_validity.status).toBe('valid');
      host.derived_score_lineage_attestations[0]!.value = 0.8;
      expect(() => createWeightedComparison(input, host)).toThrow('derived_score_lineage_not_attested');
    }
  });

  it('rejects contradictory host claims of derived-score source independence', () => {
    const independent = fixture();
    independent.input.utilities[0]!.origin = 'ai_estimate';
    independent.input.utilities[0]!.provenance = 'olumi_hypothesis';
    attestDerived(independent.input, independent.host, 0, false);
    expect(() => createWeightedComparison(independent.input, independent.host)).toThrow('invalid_derived_score_lineage');

    const conditioned = fixture();
    conditioned.input.utilities[0]!.origin = 'ai_estimate';
    conditioned.input.utilities[0]!.provenance = 'olumi_hypothesis';
    conditioned.input.utilities[0]!.source_refs = [{ source_id: 'private-source', source_version: 'v1' }];
    conditioned.host.source_statuses = [{ source_id: 'private-source', source_version: 'v1', state: 'current' }];
    attestDerived(conditioned.input, conditioned.host, 0, true);
    expect(() => createWeightedComparison(conditioned.input, conditioned.host)).toThrow('invalid_derived_score_lineage');
  });

  it('allows a host-attested source-independent AI estimate despite an unrelated revoked source', () => {
    const { input, host } = fixture();
    input.utilities[0]!.origin = 'ai_estimate';
    input.utilities[0]!.provenance = 'olumi_hypothesis';
    attestDerived(input, host, 0, true);
    host.source_statuses = [{ source_id: 'unrelated-private-source', source_version: 'v1', state: 'revoked' }];
    const saved = createWeightedComparison(input, host);
    expect(saved.ordering_permission.permitted).toBe(true);
    const current = presentWeightedComparison(saved, input, host);
    expect(current.state).toBe('current');
    expect(current).toHaveProperty('calculation_validity.rows.0.total');
    expect(current).not.toHaveProperty('canonical_inputs');
  });

  it('withholds a source-conditioned AI estimate after source-only revocation and reload', () => {
    const { input, host } = fixture();
    input.utilities[0]!.origin = 'ai_estimate';
    input.utilities[0]!.provenance = 'olumi_hypothesis';
    input.utilities[0]!.source_refs = [{ source_id: 'private-source', source_version: 'v1' }];
    host.source_statuses = [{ source_id: 'private-source', source_version: 'v1', state: 'current' }];
    attestDerived(input, host, 0, false);
    const saved = createWeightedComparison(input, host);
    const reloaded = validateReasoningArtefact(JSON.parse(serializeReasoningArtefact(saved)) as unknown);
    host.source_statuses[0]!.state = 'revoked';
    const withheld = presentWeightedComparison(reloaded, input, host);
    expect(withheld).toMatchObject({ state: 'stale', reasons: ['relevant_dependency_changed', 'source_not_current'] });
    expect(withheld).not.toHaveProperty('calculation_validity');
    expect(withheld).not.toHaveProperty('source_states');
    expect(JSON.stringify(withheld)).not.toContain('private-source');
    expect(JSON.stringify(withheld)).not.toContain('"total"');
  });

  it('requires an exact, source-bound host attestation before an observation can be calculated', () => {
    const { input, host } = fixture();
    input.utilities[0]!.origin = 'observed';
    input.utilities[0]!.provenance = 'source_evidence';
    input.utilities[0]!.source_refs = [{ source_id: 'measurement-1', source_version: 'v1' }];
    host.source_statuses = [{ source_id: 'measurement-1', source_version: 'v1', state: 'current' }];
    expect(() => createWeightedComparison(input, host)).toThrow('observation_not_attested');
    host.observed_score_attestations.push({ option_id: 'option-a', criterion_id: 'cost', value: 0.9,
      source_refs: [{ source_id: 'measurement-1', source_version: 'v1' }],
      approved_provenance: 'source_evidence', authority_ref: 'host-measurement-verdict-1', approved: true });
    const attested = createWeightedComparison(input, host);
    expect(attested.ordering_permission.permitted).toBe(true);
    host.observed_score_attestations[0]!.value = 0.8;
    expect(() => createWeightedComparison(input, host)).toThrow('observation_not_attested');
    host.observed_score_attestations[0]!.value = 0.9;
    host.observed_score_attestations[0]!.approved_provenance = 'user_stated';
    expect(() => createWeightedComparison(input, host)).toThrow('observation_not_attested');
    host.observed_score_attestations[0]!.approved_provenance = 'source_evidence';
    const restored = createWeightedComparison(input, host);
    host.observed_score_attestations.push({ option_id: 'option-b', criterion_id: 'fit', value: 0.8,
      source_refs: [{ source_id: 'unrelated-measurement', source_version: 'v2' }],
      approved_provenance: 'source_evidence', authority_ref: 'host-measurement-verdict-2', approved: true });
    const withUnrelatedAttestation = createWeightedComparison(input, host);
    expect(withUnrelatedAttestation.canonical_input_hash).toBe(restored.canonical_input_hash);
    expect(assessBindingCurrentness(restored.binding, withUnrelatedAttestation.binding).state).toBe('current');
  });

  it('accepts a user-stated observation only when the host explicitly attests that exact provenance and score', () => {
    const { input, host } = fixture();
    input.utilities[0]!.origin = 'observed';
    host.observed_score_attestations.push({ option_id: 'option-a', criterion_id: 'cost', value: 0.9,
      source_refs: [], approved_provenance: 'user_stated', authority_ref: 'host-report-verdict-1', approved: true });
    const accepted = createWeightedComparison(input, host);
    expect(accepted.calculation_validity.status).toBe('valid');
    expect(accepted.canonical_inputs.input.utilities[0]?.provenance).toBe('user_stated');
    host.observed_score_attestations[0]!.authority_ref = 'different-host-verdict';
    const changed = createWeightedComparison(input, host);
    expect(assessBindingCurrentness(accepted.binding, changed.binding).changed_dependencies).toContain(
      'utility:["option-a","cost","observation_attestation"]');
  });

  it('projects fresh calculations only while consumed inputs are current, including after reload', () => {
    const { input, host } = fixture();
    const saved = createWeightedComparison(input, host);
    const reloaded = validateReasoningArtefact(JSON.parse(serializeReasoningArtefact(saved)) as unknown);
    host.graph_revision = 'graph-unrelated';
    const current = presentWeightedComparison(reloaded, input, host);
    expect(current.state).toBe('current');
    expect(current).not.toHaveProperty('canonical_inputs');
    expect(current).toHaveProperty('calculation_validity.rows.0.total');

    input.utilities[0]!.value = 0.85;
    const stale = presentWeightedComparison(reloaded, input, host);
    expect(stale).toMatchObject({ state: 'stale', reasons: ['relevant_dependency_changed'] });
    expect(stale).not.toHaveProperty('canonical_inputs');
    expect(stale).not.toHaveProperty('calculation_validity');
    expect(stale).not.toHaveProperty('sensitivity');
    expect(stale).not.toHaveProperty('source_states');
    expect(stale).toHaveProperty('changed_dependency_kinds', ['utility']);
    expect(JSON.stringify(stale)).not.toContain('"total"');
    expect(JSON.stringify(stale)).not.toContain('"utilities"');
  });

  it('withholds historical totals when sensitivity points change without a dependency fingerprint change', () => {
    const { input, host } = fixture();
    input.sensitivity = { criterion_id: 'cost', weights: [0.25, 0.75] };
    const saved = createWeightedComparison(input, host);
    host.graph_revision = 'unrelated-graph-edit';
    expect(presentWeightedComparison(saved, input, host).state).toBe('current');
    input.sensitivity.weights = [0.1, 0.9];
    const current = createWeightedComparison(input, host);
    expect(assessBindingCurrentness(saved.binding, current.binding).state).toBe('current');
    const withheld = presentWeightedComparison(saved, input, host);
    expect(withheld).toMatchObject({ state: 'stale', reasons: ['canonical_input_changed'], changed_dependency_kinds: [] });
    expect(withheld).not.toHaveProperty('calculation_validity');
    expect(withheld).not.toHaveProperty('sensitivity');
    expect(withheld).not.toHaveProperty('canonical_inputs');
  });

  it('withholds source-derived totals when a source is revoked or its version changes after reload', () => {
    const { input, host } = fixture();
    input.utilities[0]!.origin = 'evidence_derived';
    input.utilities[0]!.provenance = 'source_evidence';
    input.utilities[0]!.source_refs = [{ source_id: 'source-a', source_version: 'v1' }];
    host.source_statuses = [{ source_id: 'source-a', source_version: 'v1', state: 'current' }];
    attestDerived(input, host, 0, false);
    const saved = createWeightedComparison(input, host);
    const reloaded = validateReasoningArtefact(JSON.parse(serializeReasoningArtefact(saved)) as unknown);
    host.source_statuses[0]!.state = 'revoked';
    const revoked = presentWeightedComparison(reloaded, input, host);
    expect(revoked).toMatchObject({ state: 'stale', reasons: ['relevant_dependency_changed', 'source_not_current'] });
    expect(revoked).not.toHaveProperty('calculation_validity');
    expect(revoked).not.toHaveProperty('source_states');
    expect(JSON.stringify(revoked)).not.toContain('source-a');
    expect(JSON.stringify(revoked)).not.toContain('"total"');

    host.source_statuses[0]!.state = 'current';
    host.source_statuses[0]!.source_version = 'v2';
    const changed = presentWeightedComparison(reloaded, input, host);
    expect(changed).toMatchObject({ state: 'stale', reasons: ['relevant_dependency_changed', 'source_not_current'] });
    expect(changed).not.toHaveProperty('calculation_validity');
    expect(changed).not.toHaveProperty('source_states');
  });

  it('withholds a sourced calculation when both saved and fresh snapshots say the source is revoked', () => {
    const { input, host } = fixture();
    input.utilities[0]!.origin = 'evidence_derived';
    input.utilities[0]!.provenance = 'source_evidence';
    input.utilities[0]!.source_refs = [{ source_id: 'source-a', source_version: 'v1' }];
    host.source_statuses = [{ source_id: 'source-a', source_version: 'v1', state: 'revoked' }];
    attestDerived(input, host, 0, false);
    const saved = createWeightedComparison(input, host);
    const fresh = createWeightedComparison(input, host);
    expect(assessBindingCurrentness(saved.binding, fresh.binding).state).toBe('current');
    const withheld = presentWeightedComparison(saved, input, host);
    expect(withheld).toMatchObject({ state: 'withheld', reasons: ['source_not_current'] });
    expect(withheld).not.toHaveProperty('calculation_validity');
    expect(withheld).not.toHaveProperty('source_states');
  });

  it('withholds a historical observed total if fresh host approval is withdrawn', () => {
    const { input, host } = fixture();
    input.utilities[0]!.origin = 'observed';
    input.utilities[0]!.provenance = 'source_evidence';
    input.utilities[0]!.source_refs = [{ source_id: 'measurement-1', source_version: 'v1' }];
    host.source_statuses = [{ source_id: 'measurement-1', source_version: 'v1', state: 'current' }];
    host.observed_score_attestations.push({ option_id: 'option-a', criterion_id: 'cost', value: 0.9,
      source_refs: [{ source_id: 'measurement-1', source_version: 'v1' }],
      approved_provenance: 'source_evidence', authority_ref: 'host-measurement-verdict-1', approved: true });
    const reloaded = validateReasoningArtefact(JSON.parse(serializeReasoningArtefact(
      createWeightedComparison(input, host))) as unknown);
    host.observed_score_attestations = [];
    const withheld = presentWeightedComparison(reloaded, input, host);
    expect(withheld).toMatchObject({ state: 'withheld', reasons: ['invalid_current_snapshot'] });
    expect(withheld).not.toHaveProperty('calculation_validity');
    expect(withheld).not.toHaveProperty('canonical_inputs');
    expect(withheld).not.toHaveProperty('source_states');
  });
});
