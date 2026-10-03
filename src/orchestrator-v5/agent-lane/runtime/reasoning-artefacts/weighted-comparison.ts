import {
  ARTEFACT_SCHEMA_VERSION, ArtefactInputError, assessBindingCurrentness, binding, canonicalJson, contentHash,
  dependency, fail, finite, keys, list, own,
  provenance, record, str, unique,
  type ArtefactBinding, type DependencyIdentity, type Provenance, type SourceState, type SourceStatus,
} from './common.js';

export const WEIGHTED_CALCULATION_VERSION = 'weighted_additive_utility/1';

type Polarity = 'higher' | 'lower';
type ScoreOrigin = 'observed' | 'evidence_derived' | 'user_supplied' | 'ai_estimate' | 'analysis_derived' | 'unknown';
type DerivedScoreOrigin = 'evidence_derived' | 'ai_estimate' | 'analysis_derived';
type ConstraintStatus = 'pass' | 'fail' | 'unknown';

export interface Criterion {
  readonly id: string;
  readonly label: string;
  readonly meaning: string;
  readonly polarity: Polarity;
  readonly provenance: Provenance;
  readonly weight: { readonly value: number; readonly provenance: Provenance };
}

export interface Utility {
  readonly option_id: string;
  readonly criterion_id: string;
  readonly value: number | null;
  readonly origin: ScoreOrigin;
  readonly provenance: Provenance;
  readonly source_refs: readonly { readonly source_id: string; readonly source_version: string }[];
}

export interface WeightedComparisonInput {
  readonly option_ids: readonly string[];
  readonly criteria: readonly Criterion[];
  readonly utilities: readonly Utility[];
  readonly sensitivity: { readonly criterion_id: string; readonly weights: readonly number[] } | null;
}

/** The caller must obtain this snapshot from existing authenticated owners, never from model output. */
export interface WeightedComparisonHost {
  readonly scenario_id: string;
  readonly graph_revision: string;
  readonly canonical_options: readonly { readonly id: string; readonly label: string }[];
  readonly confirmed_preferences: readonly {
    readonly criterion_id: string;
    readonly value: number;
    readonly confirmation_provenance: string;
  }[];
  readonly required_constraint_ids: readonly string[];
  readonly constraint_verdicts: readonly {
    readonly option_id: string;
    readonly constraint_id: string;
    readonly status: ConstraintStatus;
  }[];
  readonly source_statuses: readonly SourceStatus[];
  readonly analysis_identity: { readonly scenario_id: string; readonly graph_hash_at_run: string; readonly computed_at: string } | null;
  readonly analysis_state: 'current' | 'stale' | 'unknown' | null;
  /** Exact host-authorised observation claims. Absence cannot be inferred as approval. */
  readonly observed_score_attestations: readonly {
    readonly option_id: string;
    readonly criterion_id: string;
    readonly value: number;
    readonly source_refs: readonly { readonly source_id: string; readonly source_version: string }[];
    readonly approved_provenance: 'user_stated' | 'source_evidence';
    readonly authority_ref: string;
    readonly approved: true;
  }[];
  /** Host-owned score/source lineage. Caller references alone do not establish independence or source status. */
  readonly derived_score_lineage_attestations: readonly {
    readonly option_id: string;
    readonly criterion_id: string;
    readonly origin: DerivedScoreOrigin;
    readonly value: number;
    readonly source_refs: readonly { readonly source_id: string; readonly source_version: string }[];
    readonly source_independent: boolean;
    readonly authority_ref: string;
  }[];
}

export interface WeightedComparisonArtefact {
  readonly kind: 'weighted_comparison';
  readonly schema_version: typeof ARTEFACT_SCHEMA_VERSION;
  readonly calculation_version: typeof WEIGHTED_CALCULATION_VERSION;
  readonly canonical_input_hash: string;
  readonly binding: ArtefactBinding;
  readonly canonical_inputs: { readonly input: WeightedComparisonInput; readonly host: WeightedComparisonHost };
  readonly calculation_validity: {
    readonly status: 'valid' | 'incomplete';
    readonly rows: readonly { readonly option_id: string; readonly total: number | null; readonly missing_criterion_ids: readonly string[] }[];
  };
  readonly preference_ownership: readonly {
    readonly criterion_id: string;
    readonly supplied_weight: number;
    readonly supplied_provenance: Provenance;
    readonly confirmed: boolean;
    readonly confirmation_provenance: string | null;
    readonly normalised_weight: number;
  }[];
  readonly constraint_feasibility: readonly {
    readonly option_id: string;
    readonly status: ConstraintStatus;
    readonly verdicts: readonly { readonly constraint_id: string; readonly status: ConstraintStatus }[];
  }[];
  readonly ordering_permission: {
    readonly permitted: boolean;
    readonly reasons: readonly string[];
    /** Equal totals occupy the same group. No option is promoted past a failed constraint. */
    readonly groups: readonly (readonly string[])[] | null;
  };
  readonly sensitivity: {
    readonly status: 'calculated' | 'withheld';
    readonly reason: string | null;
    readonly criterion_id: string;
    readonly points: readonly {
      readonly tested_weight: number;
      readonly rows: readonly { readonly option_id: string; readonly total: number | null; readonly missing_criterion_ids: readonly string[] }[];
    }[];
  } | null;
}

type DisplayCalculation = Pick<WeightedComparisonArtefact,
  'calculation_validity' | 'preference_ownership' | 'constraint_feasibility' | 'ordering_permission' | 'sensitivity'>;

/** A display-only projection: withheld variants have no utilities, totals, or historical input snapshot. */
export type WeightedComparisonPresentation =
  | ({ readonly kind: 'weighted_comparison'; readonly state: 'current'; readonly canonical_input_hash: string;
    readonly source_states: readonly WeightedSourceState[] } & DisplayCalculation)
  | { readonly kind: 'weighted_comparison'; readonly state: 'stale' | 'withheld';
    readonly reasons: readonly ('invalid_subject' | 'invalid_current_snapshot' | 'relevant_dependency_changed'
      | 'canonical_input_changed'
      | 'source_not_current' | 'analysis_not_current')[];
    readonly changed_dependency_kinds: readonly DependencyIdentity['kind'][] };

interface WeightedSourceState {
  readonly source_id: string;
  readonly bound_version: string;
  readonly current_version: string | null;
  readonly state: SourceState;
}

function parseSourceRefs(raw: unknown): Utility['source_refs'] {
  const source_refs = list(raw).map((x) => {
    const s = record(x);
    keys(s, ['source_id', 'source_version']);
    return { source_id: str(own(s, 'source_id'), 200), source_version: str(own(s, 'source_version'), 200) };
  }).sort((a, b) => a.source_id.localeCompare(b.source_id));
  unique(source_refs.map((s) => s.source_id), 'duplicate_score_source');
  return source_refs;
}

function parseCriterion(raw: unknown): Criterion {
  const r = record(raw);
  keys(r, ['id', 'label', 'meaning', 'polarity', 'provenance', 'weight']);
  const polarity = own(r, 'polarity');
  if (polarity !== 'higher' && polarity !== 'lower') fail('invalid_polarity');
  const w = record(own(r, 'weight'));
  keys(w, ['value', 'provenance']);
  const criterionProvenance = provenance(own(r, 'provenance'));
  const weightProvenance = provenance(own(w, 'provenance'));
  // F2a has no host-owned source binding for criterion text or a preference weight.
  // A utility's source ref must not be borrowed to grant those independent inputs currentness.
  if (criterionProvenance === 'source_evidence' || weightProvenance === 'source_evidence') {
    fail('source_derived_preference_unbound');
  }
  return {
    id: str(own(r, 'id'), 120), label: str(own(r, 'label'), 200), meaning: str(own(r, 'meaning'), 600),
    polarity, provenance: criterionProvenance,
    weight: { value: finite(own(w, 'value'), 0, Number.MAX_VALUE), provenance: weightProvenance },
  };
}

function parseUtility(raw: unknown): Utility {
  const r = record(raw);
  keys(r, ['option_id', 'criterion_id', 'value', 'origin', 'provenance', 'source_refs']);
  const origin = own(r, 'origin');
  if (origin !== 'observed' && origin !== 'evidence_derived' && origin !== 'user_supplied' && origin !== 'ai_estimate'
    && origin !== 'analysis_derived' && origin !== 'unknown') fail('invalid_score_origin');
  const value = own(r, 'value') === null ? null : finite(own(r, 'value'), 0, 1);
  if ((origin === 'unknown') !== (value === null)) fail('unknown_score_mismatch');
  const source_refs = parseSourceRefs(own(r, 'source_refs'));
  const source = provenance(own(r, 'provenance'));
  if (origin === 'user_supplied' && source !== 'user_stated') fail('score_origin_provenance_mismatch');
  if (origin === 'ai_estimate' && source !== 'olumi_hypothesis') fail('score_origin_provenance_mismatch');
  if (origin === 'analysis_derived' && source !== 'olumi_hypothesis') fail('score_origin_provenance_mismatch');
  if (origin === 'evidence_derived' && source !== 'source_evidence') fail('score_origin_provenance_mismatch');
  if (origin === 'observed' && source !== 'source_evidence' && source !== 'user_stated') {
    fail('score_origin_provenance_mismatch');
  }
  if (origin === 'unknown' && source !== 'unknown') fail('score_origin_provenance_mismatch');
  if ((origin === 'evidence_derived' || (origin === 'observed' && source === 'source_evidence'))
    && source_refs.length === 0) {
    fail('evidence_score_without_source');
  }
  if ((origin === 'user_supplied' || origin === 'unknown') && source_refs.length > 0) {
    fail('score_origin_source_mismatch');
  }
  return {
    option_id: str(own(r, 'option_id'), 160), criterion_id: str(own(r, 'criterion_id'), 120),
    value, origin, provenance: source, source_refs,
  };
}

function parseInput(raw: unknown): WeightedComparisonInput {
  const r = record(raw);
  keys(r, ['option_ids', 'criteria', 'utilities'], ['sensitivity']);
  const option_ids = list(own(r, 'option_ids')).map((x) => str(x, 160));
  if (option_ids.length < 2) fail('insufficient_options');
  unique(option_ids, 'duplicate_option');
  const criteria = list(own(r, 'criteria')).map(parseCriterion);
  if (criteria.length === 0) fail('missing_criteria');
  unique(criteria.map((c) => c.id), 'duplicate_criterion');
  const utilities = list(own(r, 'utilities')).map(parseUtility)
    .sort((a, b) => option_ids.indexOf(a.option_id) - option_ids.indexOf(b.option_id)
      || criteria.findIndex((c) => c.id === a.criterion_id) - criteria.findIndex((c) => c.id === b.criterion_id));
  unique(utilities.map((u) => JSON.stringify([u.option_id, u.criterion_id])), 'duplicate_utility');
  for (const u of utilities) {
    if (!option_ids.includes(u.option_id) || !criteria.some((c) => c.id === u.criterion_id)) fail('unknown_utility_identity');
  }
  const s = own(r, 'sensitivity');
  let sensitivity: WeightedComparisonInput['sensitivity'] = null;
  if (s !== undefined && s !== null) {
    const q = record(s);
    keys(q, ['criterion_id', 'weights']);
    const criterion_id = str(own(q, 'criterion_id'), 120);
    if (!criteria.some((c) => c.id === criterion_id)) fail('unknown_sensitivity_criterion');
    const weights = list(own(q, 'weights')).map((w) => finite(w, 0, 1));
    if (weights.length === 0) fail('missing_sensitivity_points');
    sensitivity = { criterion_id, weights };
  }
  return { option_ids, criteria, utilities, sensitivity };
}

function parseHost(raw: unknown): WeightedComparisonHost {
  const r = record(raw);
  keys(r, ['scenario_id', 'graph_revision', 'canonical_options', 'confirmed_preferences', 'required_constraint_ids',
    'constraint_verdicts', 'source_statuses', 'analysis_identity'],
  ['analysis_state', 'observed_score_attestations', 'derived_score_lineage_attestations']);
  const scenario_id = str(own(r, 'scenario_id'), 160);
  const graph_revision = str(own(r, 'graph_revision'), 160);
  const canonical_options = list(own(r, 'canonical_options')).map((x) => {
    const o = record(x); keys(o, ['id', 'label']);
    return { id: str(own(o, 'id'), 160), label: str(own(o, 'label'), 200) };
  });
  unique(canonical_options.map((o) => o.id), 'duplicate_canonical_option');
  const confirmed_preferences = list(own(r, 'confirmed_preferences')).map((x) => {
    const p = record(x); keys(p, ['criterion_id', 'value', 'confirmation_provenance']);
    return { criterion_id: str(own(p, 'criterion_id'), 120), value: finite(own(p, 'value'), 0, Number.MAX_VALUE),
      confirmation_provenance: str(own(p, 'confirmation_provenance'), 240) };
  }).sort((a, b) => a.criterion_id.localeCompare(b.criterion_id));
  unique(confirmed_preferences.map((p) => p.criterion_id), 'duplicate_confirmation');
  const required_constraint_ids = list(own(r, 'required_constraint_ids')).map((x) => str(x, 160));
  unique(required_constraint_ids, 'duplicate_constraint');
  const constraint_verdicts = list(own(r, 'constraint_verdicts')).map((x) => {
    const v = record(x); keys(v, ['option_id', 'constraint_id', 'status']);
    const status = own(v, 'status') as ConstraintStatus;
    if (status !== 'pass' && status !== 'fail' && status !== 'unknown') fail('invalid_constraint_status');
    return { option_id: str(own(v, 'option_id'), 160), constraint_id: str(own(v, 'constraint_id'), 160), status };
  }).sort((a, b) => a.option_id.localeCompare(b.option_id) || a.constraint_id.localeCompare(b.constraint_id));
  unique(constraint_verdicts.map((v) => JSON.stringify([v.option_id, v.constraint_id])), 'duplicate_constraint_verdict');
  const source_statuses = list(own(r, 'source_statuses')).map((x) => {
    const s = record(x); keys(s, ['source_id', 'source_version', 'state']);
    const state = own(s, 'state') as SourceState;
    if (state !== 'current' && state !== 'changed' && state !== 'revoked' && state !== 'unavailable') fail('invalid_source_state');
    const version = own(s, 'source_version');
    return { source_id: str(own(s, 'source_id'), 200), source_version: version === null ? null : str(version, 200), state };
  }).sort((a, b) => a.source_id.localeCompare(b.source_id));
  unique(source_statuses.map((s) => s.source_id), 'duplicate_source_status');
  const a = own(r, 'analysis_identity');
  let analysis_identity: WeightedComparisonHost['analysis_identity'] = null;
  if (a !== null) {
    const x = record(a); keys(x, ['scenario_id', 'graph_hash_at_run', 'computed_at']);
    analysis_identity = { scenario_id: str(own(x, 'scenario_id'), 160), graph_hash_at_run: str(own(x, 'graph_hash_at_run'), 160),
      computed_at: str(own(x, 'computed_at'), 160) };
    if (analysis_identity.scenario_id !== scenario_id) fail('foreign_analysis');
  }
  const suppliedAnalysisState = own(r, 'analysis_state');
  if (suppliedAnalysisState !== undefined && suppliedAnalysisState !== null && suppliedAnalysisState !== 'current'
    && suppliedAnalysisState !== 'stale' && suppliedAnalysisState !== 'unknown') fail('invalid_analysis_state');
  const analysis_state = suppliedAnalysisState === undefined ? null : suppliedAnalysisState as WeightedComparisonHost['analysis_state'];
  const observed_score_attestations = (own(r, 'observed_score_attestations') === undefined
    ? [] : list(own(r, 'observed_score_attestations'))).map((x) => {
    const a = record(x); keys(a, ['option_id', 'criterion_id', 'value', 'source_refs', 'approved_provenance', 'authority_ref', 'approved']);
    if (own(a, 'approved') !== true) fail('observation_not_approved');
    const approved_provenance = own(a, 'approved_provenance');
    if (approved_provenance !== 'user_stated' && approved_provenance !== 'source_evidence') fail('invalid_observation_provenance');
    const source_refs = parseSourceRefs(own(a, 'source_refs'));
    if (approved_provenance === 'source_evidence' && source_refs.length === 0) fail('observation_without_source');
    return { option_id: str(own(a, 'option_id'), 160), criterion_id: str(own(a, 'criterion_id'), 120),
      value: finite(own(a, 'value'), 0, 1), source_refs,
      approved_provenance: approved_provenance as 'user_stated' | 'source_evidence',
      authority_ref: str(own(a, 'authority_ref'), 240), approved: true as const };
  }).sort((a, b) => a.option_id.localeCompare(b.option_id) || a.criterion_id.localeCompare(b.criterion_id));
  unique(observed_score_attestations.map((a) => JSON.stringify([a.option_id, a.criterion_id])), 'duplicate_observation_attestation');
  const derived_score_lineage_attestations = (own(r, 'derived_score_lineage_attestations') === undefined
    ? [] : list(own(r, 'derived_score_lineage_attestations'))).map((x) => {
    const a = record(x); keys(a, ['option_id', 'criterion_id', 'origin', 'value', 'source_refs', 'source_independent', 'authority_ref']);
    const origin = own(a, 'origin');
    if (origin !== 'evidence_derived' && origin !== 'ai_estimate' && origin !== 'analysis_derived') {
      fail('invalid_derived_score_origin');
    }
    const source_independent = own(a, 'source_independent');
    if (source_independent !== true && source_independent !== false) fail('invalid_source_independence');
    const source_refs = parseSourceRefs(own(a, 'source_refs'));
    if (source_independent === (source_refs.length > 0) || (origin === 'evidence_derived' && source_independent)) {
      fail('invalid_derived_score_lineage');
    }
    return { option_id: str(own(a, 'option_id'), 160), criterion_id: str(own(a, 'criterion_id'), 120),
      origin: origin as DerivedScoreOrigin, value: finite(own(a, 'value'), 0, 1), source_refs,
      source_independent, authority_ref: str(own(a, 'authority_ref'), 240) };
  }).sort((a, b) => a.option_id.localeCompare(b.option_id) || a.criterion_id.localeCompare(b.criterion_id));
  unique(derived_score_lineage_attestations.map((a) => JSON.stringify([a.option_id, a.criterion_id])),
    'duplicate_derived_score_lineage');
  return { scenario_id, graph_revision, canonical_options, confirmed_preferences, required_constraint_ids,
    constraint_verdicts, source_statuses, analysis_identity, analysis_state,
    observed_score_attestations, derived_score_lineage_attestations };
}

type Row = WeightedComparisonArtefact['calculation_validity']['rows'][number];

function calculateRows(input: WeightedComparisonInput, normalised: ReadonlyMap<string, number>): Row[] {
  const score = new Map(input.utilities.map((u) => [JSON.stringify([u.option_id, u.criterion_id]), u.value]));
  return input.option_ids.map((option_id) => {
    const missing_criterion_ids: string[] = [];
    let total = 0;
    for (const criterion of input.criteria) {
      const weight = normalised.get(criterion.id)!;
      const value = score.get(JSON.stringify([option_id, criterion.id]));
      if (value == null) {
        if (weight > 0) missing_criterion_ids.push(criterion.id);
      } else {
        // Utility is already higher-is-better: polarity never transforms it.
        total += weight * value;
      }
    }
    return { option_id, total: missing_criterion_ids.length ? null : total, missing_criterion_ids };
  });
}

export function createWeightedComparison(rawInput: unknown, rawHost: unknown): WeightedComparisonArtefact {
  const input = parseInput(rawInput);
  const host = parseHost(rawHost);
  const observedUtilities = input.utilities.filter((utility) => utility.origin === 'observed');
  for (const utility of observedUtilities) {
    const attestation = host.observed_score_attestations.find((candidate) =>
      candidate.option_id === utility.option_id && candidate.criterion_id === utility.criterion_id);
    if (attestation === undefined || attestation.value !== utility.value
      || attestation.approved_provenance !== utility.provenance
      || canonicalJson(attestation.source_refs) !== canonicalJson(utility.source_refs)) fail('observation_not_attested');
  }
  const derivedUtilities = input.utilities.filter((utility) => utility.origin === 'evidence_derived'
    || utility.origin === 'ai_estimate' || utility.origin === 'analysis_derived');
  for (const utility of derivedUtilities) {
    const attestation = host.derived_score_lineage_attestations.find((candidate) =>
      candidate.option_id === utility.option_id && candidate.criterion_id === utility.criterion_id);
    if (attestation === undefined || attestation.origin !== utility.origin || attestation.value !== utility.value
      || canonicalJson(attestation.source_refs) !== canonicalJson(utility.source_refs)) fail('derived_score_lineage_not_attested');
  }
  const options = new Map(host.canonical_options.map((o) => [o.id, o]));
  if (options.size !== input.option_ids.length || input.option_ids.some((id) => !options.has(id))) {
    fail('option_selection_mismatch');
  }
  if (host.constraint_verdicts.some((v) => !input.option_ids.includes(v.option_id)
    || !host.required_constraint_ids.includes(v.constraint_id))) fail('foreign_constraint_verdict');
  const rawTotal = input.criteria.reduce((sum, c) => sum + c.weight.value, 0);
  if (!Number.isFinite(rawTotal) || rawTotal <= 0) fail('invalid_weight_total');
  const normalised = new Map(input.criteria.map((c) => [c.id, c.weight.value / rawTotal]));
  const preference_ownership = input.criteria.map((c) => {
    const confirmation = host.confirmed_preferences.find((p) => p.criterion_id === c.id && p.value === c.weight.value);
    return { criterion_id: c.id, supplied_weight: c.weight.value, supplied_provenance: c.weight.provenance,
      confirmed: confirmation !== undefined, confirmation_provenance: confirmation?.confirmation_provenance ?? null,
      normalised_weight: normalised.get(c.id)! };
  });
  const rows = calculateRows(input, normalised);
  const constraint_feasibility = input.option_ids.map((option_id) => {
    const verdicts = host.required_constraint_ids.map((constraint_id) => ({ constraint_id,
      status: host.constraint_verdicts.find((v) => v.option_id === option_id && v.constraint_id === constraint_id)?.status ?? 'unknown' as const }));
    const status = verdicts.some((v) => v.status === 'fail') ? 'fail' as const
      : verdicts.some((v) => v.status === 'unknown') ? 'unknown' as const : 'pass' as const;
    return { option_id, status, verdicts };
  });
  const referenced = new Map(input.utilities.flatMap((u) => u.source_refs).map((s) => [s.source_id, s.source_version]));
  for (const reference of input.utilities.flatMap((u) => u.source_refs)) {
    if (referenced.get(reference.source_id) !== reference.source_version) fail('conflicting_source_versions');
  }
  const sourceStatuses = [...referenced].map(([id, expectedVersion]) => {
    const supplied = host.source_statuses.find((s) => s.source_id === id);
    return { source_id: id, expected_version: expectedVersion, current_version: supplied?.source_version ?? null,
      state: supplied?.state ?? 'unavailable' as const };
  });
  const analysisUsed = input.utilities.some((u) => u.origin === 'analysis_derived');
  if (analysisUsed && host.analysis_identity === null) fail('analysis_identity_required');
  const deps = [
    ...input.option_ids.map((id) => dependency('option', id, options.get(id))),
      ...input.criteria.flatMap((c) => [dependency('criterion', c.id, { id: c.id, label: c.label, meaning: c.meaning,
      polarity: c.polarity, provenance: c.provenance }), dependency('preference', c.id, {
        weight: c.weight, confirmation: host.confirmed_preferences.find((p) => p.criterion_id === c.id) ?? null,
      })]),
    ...input.option_ids.flatMap((id) => input.criteria.map((c) => dependency('utility', JSON.stringify([id, c.id]),
      input.utilities.find((u) => u.option_id === id && u.criterion_id === c.id) ?? { value: null, origin: 'unknown' }))),
    ...input.option_ids.flatMap((id) => host.required_constraint_ids.map((constraintId) => dependency('constraint', JSON.stringify([id, constraintId]),
      host.constraint_verdicts.find((v) => v.option_id === id && v.constraint_id === constraintId) ?? { status: 'unknown' }))),
    ...sourceStatuses.map((s) => dependency('source', s.source_id, s)),
    ...observedUtilities.map((u) => dependency('utility', JSON.stringify([u.option_id, u.criterion_id, 'observation_attestation']),
      host.observed_score_attestations.find((a) => a.option_id === u.option_id && a.criterion_id === u.criterion_id))),
    ...derivedUtilities.map((u) => dependency('utility', JSON.stringify([u.option_id, u.criterion_id, 'derived_lineage_attestation']),
      host.derived_score_lineage_attestations.find((a) => a.option_id === u.option_id && a.criterion_id === u.criterion_id))),
    ...(analysisUsed ? [dependency('analysis', 'run', {
      scenario_id: host.analysis_identity!.scenario_id,
      graph_hash_at_run: host.analysis_identity!.graph_hash_at_run,
      state: host.analysis_state,
    })] : []),
  ];
  const historicalBinding = binding(host.scenario_id, host.graph_revision, deps);
  const reasons: string[] = [];
  if (rows.some((r) => r.total === null)) reasons.push('incomplete_utilities');
  if (preference_ownership.some((p) => !p.confirmed)) reasons.push('unconfirmed_preferences');
  if (constraint_feasibility.some((f) => f.status === 'fail')) reasons.push('hard_constraint_failed');
  if (constraint_feasibility.some((f) => f.status === 'unknown')) reasons.push('hard_constraint_unknown');
  if (sourceStatuses.some((s) => s.state !== 'current' || s.current_version !== s.expected_version)) reasons.push('source_not_current');
  if (analysisUsed && host.analysis_state !== 'current') reasons.push('analysis_not_current');
  const permitted = reasons.length === 0;
  const sorted = permitted ? [...rows].sort((a, b) => b.total! - a.total! || a.option_id.localeCompare(b.option_id)) : [];
  const groups: string[][] = [];
  for (const row of sorted) {
    const previous = sorted.find((r) => r.option_id === groups.at(-1)?.[0]);
    if (previous === undefined || previous.total !== row.total) groups.push([row.option_id]);
    else groups[groups.length - 1]!.push(row.option_id);
  }
  let sensitivity: WeightedComparisonArtefact['sensitivity'] = null;
  if (input.sensitivity !== null) {
    const selected = input.sensitivity;
    const otherTotal = input.criteria.filter((c) => c.id !== selected.criterion_id)
      .reduce((sum, c) => sum + c.weight.value, 0);
    const reason = input.criteria.length < 2 || otherTotal <= 0 ? 'no_redistribution_basis' : null;
    const points = reason === null ? selected.weights.map((weight) => {
      const adjusted = new Map(input.criteria.map((c) => [c.id, c.id === selected.criterion_id
        ? weight : (1 - weight) * c.weight.value / otherTotal]));
      return { tested_weight: weight, rows: calculateRows(input, adjusted) };
    }) : [];
    sensitivity = { status: reason === null ? 'calculated' : 'withheld', reason, criterion_id: selected.criterion_id, points };
  }
  // Copy the validated, consumed snapshot. Unrelated graph fields and provider payloads never enter this hash.
  const canonical_inputs = { input, host: {
    ...host,
    canonical_options: input.option_ids.map((id) => options.get(id)!),
    confirmed_preferences: host.confirmed_preferences.filter((p) => input.criteria.some((c) => c.id === p.criterion_id)),
    constraint_verdicts: host.constraint_verdicts.filter((v) => input.option_ids.includes(v.option_id)),
    source_statuses: host.source_statuses.filter((s) => referenced.has(s.source_id)),
    observed_score_attestations: host.observed_score_attestations.filter((a) => observedUtilities.some((u) =>
      u.option_id === a.option_id && u.criterion_id === a.criterion_id)),
    derived_score_lineage_attestations: host.derived_score_lineage_attestations.filter((a) => derivedUtilities.some((u) =>
      u.option_id === a.option_id && u.criterion_id === a.criterion_id)),
    analysis_identity: analysisUsed ? host.analysis_identity : null,
    analysis_state: analysisUsed ? host.analysis_state : null,
  } };
  // Staging's analysis result exposes a graph hash and computed_at, but no stable run ID.
  // The consumed score and graph hash carry identity; the timestamp remains provenance only.
  const { graph_revision: _historicalRevision, analysis_identity: historicalAnalysis, ...consumedHost } = canonical_inputs.host;
  const hashHost = { ...consumedHost, analysis_identity: historicalAnalysis === null ? null : {
    scenario_id: historicalAnalysis.scenario_id,
    graph_hash_at_run: historicalAnalysis.graph_hash_at_run,
  } };
  return {
    kind: 'weighted_comparison', schema_version: ARTEFACT_SCHEMA_VERSION,
    calculation_version: WEIGHTED_CALCULATION_VERSION,
    canonical_input_hash: contentHash({ input: canonical_inputs.input, host: hashHost }),
    binding: historicalBinding, canonical_inputs,
    calculation_validity: { status: rows.some((r) => r.total === null) ? 'incomplete' : 'valid', rows },
    preference_ownership, constraint_feasibility,
    ordering_permission: { permitted, reasons, groups: permitted ? groups : null }, sensitivity,
  };
}

function sourceStatesFor(saved: WeightedComparisonArtefact, currentHost: WeightedComparisonHost): WeightedSourceState[] {
  const statuses = new Map(currentHost.source_statuses.map((status) => [status.source_id, status]));
  const references = new Map(saved.canonical_inputs.input.utilities.flatMap((utility) => utility.source_refs)
    .map((reference) => [reference.source_id, reference.source_version]));
  return [...references].map(([source_id, bound_version]) => {
    const supplied = statuses.get(source_id);
    const state: SourceState = supplied === undefined ? 'unavailable'
      : supplied.state !== 'current' ? supplied.state
        : supplied.source_version === bound_version ? 'current' : 'changed';
    return { source_id, bound_version, current_version: supplied?.source_version ?? null, state };
  });
}

/** Verify saved bytes and a fresh authoritative snapshot before exposing any current-use result. */
export function presentWeightedComparison(
  rawSaved: unknown, rawCurrentInput: unknown, rawCurrentHost: unknown,
): WeightedComparisonPresentation {
  const r = record(rawSaved);
  keys(r, [
    'kind', 'schema_version', 'calculation_version', 'canonical_input_hash', 'binding', 'canonical_inputs',
    'calculation_validity', 'preference_ownership', 'constraint_feasibility', 'ordering_permission', 'sensitivity',
  ]);
  if (own(r, 'kind') !== 'weighted_comparison') fail('invalid_artefact_kind');
  const snapshot = record(own(r, 'canonical_inputs'));
  keys(snapshot, ['input', 'host']);
  const saved = createWeightedComparison(own(snapshot, 'input'), own(snapshot, 'host'));
  if (canonicalJson(r) !== canonicalJson(saved)) fail('artefact_revalidation_failed');

  let current: WeightedComparisonArtefact;
  try {
    current = createWeightedComparison(rawCurrentInput, rawCurrentHost);
  } catch (error) {
    if (error instanceof ArtefactInputError) return { kind: 'weighted_comparison', state: 'withheld',
      reasons: ['invalid_current_snapshot'], changed_dependency_kinds: [] };
    throw error;
  }
  const source_states = sourceStatesFor(saved, current.canonical_inputs.host);
  const freshness = assessBindingCurrentness(saved.binding, current.binding);
  if (freshness.state === 'invalid') return { kind: 'weighted_comparison', state: 'withheld',
    reasons: ['invalid_subject'], changed_dependency_kinds: [] };
  const unsafeSource = source_states.some((source) => source.state !== 'current');
  const analysisUsed = saved.canonical_inputs.input.utilities.some((utility) => utility.origin === 'analysis_derived');
  const unsafeAnalysis = analysisUsed && current.canonical_inputs.host.analysis_state !== 'current';
  const canonicalInputChanged = saved.canonical_input_hash !== current.canonical_input_hash;
  if (freshness.state === 'stale' || canonicalInputChanged || unsafeSource || unsafeAnalysis) {
    const changed_dependency_kinds = [...new Set(freshness.changed_dependencies.map((identity) =>
      identity.slice(0, identity.indexOf(':')) as DependencyIdentity['kind']))];
    return { kind: 'weighted_comparison', state: freshness.state === 'stale' || canonicalInputChanged ? 'stale' : 'withheld',
      reasons: [
        ...(freshness.state === 'stale' ? ['relevant_dependency_changed' as const] : []),
        ...(canonicalInputChanged && freshness.state !== 'stale' ? ['canonical_input_changed' as const] : []),
        ...(unsafeSource ? ['source_not_current' as const] : []),
        ...(unsafeAnalysis ? ['analysis_not_current' as const] : []),
      ], changed_dependency_kinds };
  }
  return { kind: 'weighted_comparison', state: 'current', canonical_input_hash: current.canonical_input_hash,
    source_states, calculation_validity: current.calculation_validity,
    preference_ownership: current.preference_ownership, constraint_feasibility: current.constraint_feasibility,
    ordering_permission: current.ordering_permission, sensitivity: current.sensitivity };
}
