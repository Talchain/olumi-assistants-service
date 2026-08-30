import type { DraftRecordSet } from '../../../draft/records/grammar.js';
import type { GraphV3T, NodeV3T, EdgeV3T } from '../../../../schemas/cee-v3.js';

/** Authored evaluation fixtures, not captured model output or scientific evidence. */
export interface BriefSource {
  id: string;
  source: 'brief';
  quote: string;
  start: number;
  end: number;
}

export interface QuantificationCase {
  id: string;
  brief: string;
  records: DraftRecordSet;
  /** Explicit pre-estimation canonical input; not claimed to equal a projector result. */
  graph: GraphV3T;
  sources: BriefSource[];
  /** Evaluation context only: do not smuggle this into undeclared GraphV3 node fields. */
  metadata: {
    requested_factors: string[];
    scale: Record<string, {
      declared_scale: 'ratio' | 'anchored_ordinal' | 'unknown';
      source: string | null;
      unit: string | null;
      anchors?: { min: number; min_meaning: string; max: number; max_meaning: string };
    }>;
    consumer_reason: Record<string, string>;
  };
  expected: {
    protected_values: Record<string, number>;
    estimate_candidates: string[];
    must_remain_unknown: string[];
    excluded_factors: string[];
    may_add_options: false;
    may_add_effects: false;
    evidence_controls: Array<{
      target_id: string;
      source_id: string;
      disposition: 'supports_estimate_basis' | 'reject_missing_source' | 'reject_irrelevant_source';
    }>;
    notes: string[];
  };
  variants?: Array<{ id: string; graph: GraphV3T; protected_values: Record<string, number>; notes: string[] }>;
}

function sources(brief: string, quotes: Record<string, string>): BriefSource[] {
  return Object.entries(quotes).map(([id, quote]) => {
    const start = brief.indexOf(quote);
    if (start < 0 || brief.indexOf(quote, start + 1) >= 0) throw new Error(`Source ${id} must occur exactly once`);
    return { id, source: 'brief', quote, start, end: start + quote.length };
  });
}

const unknownPrior = () => ({ distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true, source: 'cee_repair' as const, value_tier: 'fallback_default' as const });
const factor = (id: string, label: string, extra: Partial<NodeV3T> = {}): NodeV3T => ({ id, kind: 'factor', label, ...extra });
const goal = (id: string, label: string): NodeV3T => ({ id, kind: 'goal', label });
const option = (id: string, label: string, target: string, value: number, baseline = false): NodeV3T => ({
  id, kind: 'option', label, is_baseline: baseline,
  interventions: { [target]: { value, source: 'brief_extraction', value_confidence: 'high', target_match: { node_id: target, match_type: 'exact_id', confidence: 'high' } } },
});
/** Edge values hold the surrounding science input constant; they are not fixture evidence. */
const edge = (from: string, to: string, mean = 0.4): EdgeV3T => ({
  from, to, strength: { mean, std: 0.15 }, exists_probability: 0.8,
  effect_direction: mean < 0 ? 'negative' : 'positive',
  provenance: { source: 'cee_hypothesis', reasoning: 'Fixed surrounding model assumption for this controlled fixture.' },
});
const fixedPolicy = { may_add_options: false, may_add_effects: false } as const;

const richBrief = 'Improve support reliability. Keep current overtime at 0% or add overtime of 15% of scheduled hours. Current churn is 12%. There are 20 scheduled agents and 15 are available today. Availability is the available share of scheduled agents, on a 0 to 1 scale. The attendance log reports a daily available-share standard deviation of 0.05 on that same scale. The staff car park has 60 spaces; parking is not part of the support reliability model.';
const richGraph: GraphV3T = {
  nodes: [
    goal('goal_reliability', 'Support reliability'),
    option('opt_current', 'Keep current overtime', 'fac_overtime', 0, true),
    option('opt_overtime', 'Add overtime', 'fac_overtime', 0.15),
    factor('fac_overtime', 'Overtime share', { category: 'controllable', scale_frame: 1, observed_state: { value: 0, raw_value: 0, unit: '%', source: 'brief_extraction', extractionType: 'explicit' } }),
    factor('fac_churn', 'Current churn', { category: 'observable', scale_frame: 1, observed_state: { value: 0.12, raw_value: 12, unit: '%', source: 'brief_extraction', extractionType: 'explicit' } }),
    factor('fac_availability', 'Agent availability share', { category: 'external', scale_frame: 1, prior: unknownPrior() }),
    factor('fac_parking', 'Car park demand', { category: 'external', prior: unknownPrior() }),
    ...['a', 'b', 'c', 'd'].map(id => ({ id: `out_parking_${id}`, kind: 'outcome' as const, label: `Unrelated parking observation ${id}` })),
  ],
  edges: [edge('opt_current', 'fac_overtime'), edge('opt_overtime', 'fac_overtime'), edge('fac_overtime', 'goal_reliability'), edge('fac_churn', 'goal_reliability', -0.3), edge('fac_availability', 'goal_reliability'), ...['a', 'b', 'c', 'd'].map(id => edge('fac_parking', `out_parking_${id}`))],
};

export const figureRich: QuantificationCase = {
  id: 'figure_rich', brief: richBrief, graph: richGraph,
  sources: sources(richBrief, {
    churn: 'Current churn is 12%.', availability_counts: 'There are 20 scheduled agents and 15 are available today.',
    availability_uncertainty: 'The attendance log reports a daily available-share standard deviation of 0.05 on that same scale.',
    availability_scale: 'Availability is the available share of scheduled agents, on a 0 to 1 scale.', parking: 'The staff car park has 60 spaces; parking is not part of the support reliability model.',
  }),
  records: {
    stated_items: [
      { kind: 'goal', source_quote: 'Improve support reliability.' },
      { kind: 'option', source_quote: 'Keep current overtime at 0%', is_baseline: true },
      { kind: 'option', source_quote: 'add overtime of 15% of scheduled hours' },
      { kind: 'figure', source_quote: 'Current churn is 12%.', value: 12, unit: '%' },
      { kind: 'figure', source_quote: 'There are 20 scheduled agents', value: 20, unit: 'agents' },
      { kind: 'figure', source_quote: '15 are available today', value: 15, unit: 'agents' },
    ],
    claims: [
      { claim_kind: 'factor', label: 'Agent availability share', category: 'external', basis: [4, 5] },
      { claim_kind: 'factor', label: 'Current churn', category: 'observable', value: 12, basis: [3] },
      { claim_kind: 'factor', label: 'Overtime share', category: 'controllable', value: 0 },
      { claim_kind: 'causal_link', label: 'Current overtime sets overtime share', from_stated: 1, to_claim: 2, effect: 'positive', sets_to: 0 },
      { claim_kind: 'causal_link', label: 'Extra overtime sets overtime share', from_stated: 2, to_claim: 2, effect: 'positive', sets_to: 15 },
      { claim_kind: 'causal_link', label: 'Availability affects support reliability', from_claim: 0, to_stated: 0, effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Overtime affects support reliability', from_claim: 2, to_stated: 0, effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Churn reduces reliability', from_claim: 1, to_stated: 0, effect: 'negative' },
    ],
  },
  metadata: {
    requested_factors: ['fac_availability'],
    scale: { fac_availability: { declared_scale: 'ratio', source: 'availability_scale', unit: 'share', anchors: { min: 0, min_meaning: 'No scheduled agents available', max: 1, max_meaning: 'All scheduled agents available' } } },
    consumer_reason: { fac_availability: 'External parent of the selected goal; its current level/range is an input to the real structural calculation.', fac_parking: 'No directed path to the selected goal despite more outgoing edges than the requested factor.' },
  },
  expected: {
    ...fixedPolicy, protected_values: { fac_churn: 0.12, fac_overtime: 0 }, estimate_candidates: [], must_remain_unknown: ['fac_availability'], excluded_factors: ['fac_parking'],
    evidence_controls: [
      { target_id: 'fac_availability', source_id: 'availability_counts', disposition: 'supports_estimate_basis' },
      { target_id: 'fac_availability', source_id: 'invented_staffing_report', disposition: 'reject_missing_source' },
      { target_id: 'fac_availability', source_id: 'parking', disposition: 'reject_irrelevant_source' },
    ],
    notes: ['15 / 20 establishes today\'s exact 0.75 arithmetic, but daily variation does not supply uncertainty for that snapshot. The stochastic representation remains unknown.', 'A derived estimate remains Olumi-estimated; a rationale does not convert it into new observed evidence.', 'Do not select the disconnected high-degree factor. Connectivity is a scheduling rule, not scientific materiality.'],
  },
};

const poorBrief = 'We want dependable service. Keep manual recovery or automate recovery. For recovery preparedness, 0 means no documented recovery process and 1 means fully rehearsed automatic recovery. We have a written manual recovery checklist and an on-call rota, but have never rehearsed recovery. Treat readiness as provisional, not a measured reliability probability.';
export const figurePoor: QuantificationCase = {
  id: 'figure_poor_anchored', brief: poorBrief,
  graph: { nodes: [goal('goal_service', 'Dependable service'), option('opt_manual', 'Keep manual recovery', 'fac_automation', 0, true), option('opt_automate', 'Automate recovery', 'fac_automation', 1), factor('fac_automation', 'Recovery automation', { category: 'controllable', scale_frame: 1, observed_state: { value: 0, source: 'brief_extraction', extractionType: 'explicit' } }), factor('fac_preparedness', 'Recovery preparedness', { category: 'external', scale_frame: 1, prior: unknownPrior() })], edges: [edge('opt_manual', 'fac_automation'), edge('opt_automate', 'fac_automation'), edge('fac_automation', 'goal_service'), edge('fac_preparedness', 'goal_service')] },
  sources: sources(poorBrief, { preparedness_scale: 'For recovery preparedness, 0 means no documented recovery process and 1 means fully rehearsed automatic recovery.', preparedness_context: 'We have a written manual recovery checklist and an on-call rota, but have never rehearsed recovery.', probability_limit: 'Treat readiness as provisional, not a measured reliability probability.' }),
  records: { stated_items: [{ kind: 'goal', source_quote: 'We want dependable service.' }, { kind: 'option', source_quote: 'Keep manual recovery', is_baseline: true }, { kind: 'option', source_quote: 'automate recovery' }], claims: [{ claim_kind: 'factor', label: 'Recovery preparedness', category: 'external' }, { claim_kind: 'factor', label: 'Recovery automation', category: 'controllable', value: 0 }, { claim_kind: 'causal_link', label: 'Manual recovery leaves automation off', from_stated: 1, to_claim: 1, sets_to: 0, effect: 'positive' }, { claim_kind: 'causal_link', label: 'Automate recovery enables automation', from_stated: 2, to_claim: 1, sets_to: 1, effect: 'positive' }, { claim_kind: 'causal_link', label: 'Preparedness affects dependable service', from_claim: 0, to_stated: 0, effect: 'positive' }, { claim_kind: 'causal_link', label: 'Automation affects dependable service', from_claim: 1, to_stated: 0, effect: 'positive' }] },
  metadata: { requested_factors: ['fac_preparedness'], scale: { fac_preparedness: { declared_scale: 'anchored_ordinal', source: 'preparedness_scale', unit: 'preparedness level', anchors: { min: 0, min_meaning: 'No documented recovery process', max: 1, max_meaning: 'Fully rehearsed automatic recovery' } } }, consumer_reason: { fac_preparedness: 'External current preparedness affects the goal in the existing model; estimate only this baseline, not option effects.' } },
  expected: { ...fixedPolicy, protected_values: { fac_automation: 0 }, estimate_candidates: [], must_remain_unknown: ['fac_preparedness'], excluded_factors: [], evidence_controls: [], notes: ['The unchanged brief supports partial preparedness qualitatively, but has no interior scoring rubric, quantitative reference class or calibrated uncertainty.', 'Endpoint anchors do not justify a point, range shape or standard deviation. This input must receive explicit unknown while preserving the qualitative context.', 'The previously accepted 0.35/std 0.15 output was mechanically valid but unsupported; the old 66.7% adoption rate is not a defensible-quality rate.'] },
};

const diagnosticBrief = 'Help us understand declining product adoption. Onboarding friction and weak product fit are competing hypotheses, not options we can choose. We have not interviewed users or measured either cause. Preserve both explanations and identify what evidence would distinguish them; do not rank interventions.';
export const diagnostic: QuantificationCase = {
  id: 'diagnostic_open_problem', brief: diagnosticBrief,
  graph: { nodes: [goal('goal_understand', 'Understand declining product adoption'), factor('fac_onboarding', 'Onboarding friction', { category: 'external', prior: unknownPrior() }), factor('fac_fit', 'Weak product fit', { category: 'external', prior: unknownPrior() })], edges: [edge('fac_onboarding', 'goal_understand', -0.4), edge('fac_fit', 'goal_understand', -0.4)] },
  sources: sources(diagnosticBrief, { hypotheses: 'Onboarding friction and weak product fit are competing hypotheses, not options we can choose.', missing_observations: 'We have not interviewed users or measured either cause.', task_limit: 'Preserve both explanations and identify what evidence would distinguish them; do not rank interventions.' }),
  records: { stated_items: [{ kind: 'goal', source_quote: 'Help us understand declining product adoption.' }], claims: [{ claim_kind: 'factor', label: 'Onboarding friction', category: 'external' }, { claim_kind: 'factor', label: 'Weak product fit', category: 'external' }, { claim_kind: 'causal_link', label: 'Onboarding friction may explain adoption decline', from_claim: 0, to_stated: 0, effect: 'negative' }, { claim_kind: 'causal_link', label: 'Weak product fit may explain adoption decline', from_claim: 1, to_stated: 0, effect: 'negative' }] },
  metadata: { requested_factors: [], scale: { fac_onboarding: { declared_scale: 'unknown', source: null, unit: null }, fac_fit: { declared_scale: 'unknown', source: null, unit: null } }, consumer_reason: { fac_onboarding: 'An explanation to investigate, with neither quantitative scale nor requested option comparison.', fac_fit: 'An explanation to investigate, with neither quantitative scale nor requested option comparison.' } },
  expected: { ...fixedPolicy, protected_values: {}, estimate_candidates: [], must_remain_unknown: ['fac_onboarding', 'fac_fit'], excluded_factors: ['fac_onboarding', 'fac_fit'], evidence_controls: [{ target_id: 'fac_onboarding', source_id: 'missing_observations', disposition: 'reject_irrelevant_source' }], notes: ['The absence-of-measurement span supports refusal, not a numeric causal probability.', 'No option or intervention may be created to satisfy readiness; if directly asked to estimate either gap it must remain unknown.'] },
};

const insufficientBrief = 'Grow trial signups. Spend £10,000 on campaign A or £20,000 on campaign B. We have no previous campaign data, no audience definition and no observed conversion rate. Conversion rate means the fraction of reached people who sign up, from 0 to 1. Our annual office rent is £250,000; this says nothing about conversion.';
export const insufficientInformation: QuantificationCase = {
  id: 'insufficient_information', brief: insufficientBrief,
  graph: { nodes: [goal('goal_signups', 'Trial signups'), option('opt_a', 'Campaign A', 'fac_spend', 0.1, true), option('opt_b', 'Campaign B', 'fac_spend', 0.2), factor('fac_spend', 'Campaign spend', { category: 'controllable', scale_frame: 100000, observed_state: { value: 0.1, raw_value: 10000, unit: 'GBP', source: 'brief_extraction', extractionType: 'explicit' } }), factor('fac_conversion', 'Campaign conversion rate', { category: 'external', scale_frame: 1, prior: unknownPrior() })], edges: [edge('opt_a', 'fac_spend'), edge('opt_b', 'fac_spend'), edge('fac_spend', 'goal_signups'), edge('fac_conversion', 'goal_signups')] },
  sources: sources(insufficientBrief, { absence: 'We have no previous campaign data, no audience definition and no observed conversion rate.', conversion_scale: 'Conversion rate means the fraction of reached people who sign up, from 0 to 1.', rent: 'Our annual office rent is £250,000; this says nothing about conversion.' }),
  records: { stated_items: [{ kind: 'goal', source_quote: 'Grow trial signups.' }, { kind: 'option', source_quote: 'Spend £10,000 on campaign A', is_baseline: true }, { kind: 'option', source_quote: '£20,000 on campaign B' }, { kind: 'figure', source_quote: '£10,000', value: 10000, unit: 'GBP' }, { kind: 'figure', source_quote: '£20,000', value: 20000, unit: 'GBP' }], claims: [{ claim_kind: 'factor', label: 'Campaign spend', category: 'controllable' }, { claim_kind: 'factor', label: 'Campaign conversion rate', category: 'external' }, { claim_kind: 'causal_link', label: 'Campaign A sets spend', from_stated: 1, to_claim: 0, sets_to: 10000, basis: [3], effect: 'positive' }, { claim_kind: 'causal_link', label: 'Campaign B sets spend', from_stated: 2, to_claim: 0, sets_to: 20000, basis: [4], effect: 'positive' }, { claim_kind: 'causal_link', label: 'Spend affects signups', from_claim: 0, to_stated: 0, effect: 'positive' }, { claim_kind: 'causal_link', label: 'Conversion affects signups', from_claim: 1, to_stated: 0, effect: 'positive' }] },
  metadata: { requested_factors: ['fac_conversion'], scale: { fac_conversion: { declared_scale: 'ratio', source: 'conversion_scale', unit: 'share', anchors: { min: 0, min_meaning: 'Nobody reached signs up', max: 1, max_meaning: 'Everyone reached signs up' } } }, consumer_reason: { fac_conversion: 'Missing external response rate on the causal path to trial signups; the valid probability scale does not supply a rate.' } },
  expected: { ...fixedPolicy, protected_values: { fac_spend: 0.1 }, estimate_candidates: [], must_remain_unknown: ['fac_conversion'], excluded_factors: [], evidence_controls: [{ target_id: 'fac_conversion', source_id: 'industry_benchmark_2026', disposition: 'reject_missing_source' }, { target_id: 'fac_conversion', source_id: 'rent', disposition: 'reject_irrelevant_source' }], notes: ['A ratio domain is not a prior estimate. Do not turn complete ignorance into a plausible industry conversion figure.', 'Unknown must survive with no claimed point estimate; any resilience distribution remains explicitly separate and material use fails strict evaluation.'] },
};

const suppliedBrief = 'Improve retained customers. I set the current churn rate to 12%; keep that number unchanged. A stale unknown marker may remain from an earlier draft. We are not asking for an estimate or replacement of churn.';
const suppliedGraph = (value: number, withSource: boolean): GraphV3T => ({
  nodes: [goal('goal_retention', 'Retained customers'), factor('fac_churn', 'Current churn', { category: 'observable', scale_frame: 1, prior: unknownPrior(), observed_state: { value, raw_value: value * 100, unit: '%', ...(withSource ? { source: 'user_override' as const } : {}), extractionType: 'inferred' } })],
  edges: [edge('fac_churn', 'goal_retention', -0.4)],
});
export const suppliedValueControl: QuantificationCase = {
  id: 'supplied_value_prevents_estimation', brief: suppliedBrief, graph: suppliedGraph(0.12, true),
  sources: sources(suppliedBrief, { supplied: 'I set the current churn rate to 12%; keep that number unchanged.', stale_flag: 'A stale unknown marker may remain from an earlier draft.' }),
  records: { stated_items: [{ kind: 'goal', source_quote: 'Improve retained customers.' }, { kind: 'figure', source_quote: 'I set the current churn rate to 12%', value: 12, unit: '%' }], claims: [{ claim_kind: 'factor', label: 'Current churn', category: 'observable', value: 12, basis: [1] }, { claim_kind: 'causal_link', label: 'Churn reduces retained customers', from_claim: 0, to_stated: 0, effect: 'negative' }] },
  metadata: { requested_factors: [], scale: { fac_churn: { declared_scale: 'ratio', source: 'supplied', unit: '%' } }, consumer_reason: { fac_churn: 'The current value already exists and is authoritative; a stale prior marker cannot create a missing input.' } },
  expected: { ...fixedPolicy, protected_values: { fac_churn: 0.12 }, estimate_candidates: [], must_remain_unknown: [], excluded_factors: ['fac_churn'], evidence_controls: [], notes: ['No estimator call for this factor; an injected overwrite result must be rejected/no-op.', 'Do not infer fallback from .12, .24, inferred extraction type or a stale prior flag. Positive provenance protection and missingness are separate questions.'] },
  variants: [
    { id: 'user_override_012_stale_prior', graph: suppliedGraph(0.12, true), protected_values: { fac_churn: 0.12 }, notes: ['Explicit user ownership survives the stale unknown prior.'] },
    { id: 'user_override_024_stale_prior', graph: suppliedGraph(0.24, true), protected_values: { fac_churn: 0.24 }, notes: ['Authoritative later user edit to 24%; graph record outranks the older 12% brief.'] },
    { id: 'unattributed_012_stale_prior', graph: suppliedGraph(0.12, false), protected_values: {}, notes: ['Byte-identical numeric/prior twin except source omission: must not claim user ownership; source absence alone is not permission to overwrite an existing number.'] },
    { id: 'unattributed_024_stale_prior', graph: suppliedGraph(0.24, false), protected_values: {}, notes: ['Keep the existing point value unless explicit fallback provenance or user action authorises replacement; do not manufacture either user attribution or ignorance.'] },
  ],
};

export const factorQuantificationCorpus: readonly QuantificationCase[] = [figureRich, figurePoor, diagnostic, insufficientInformation, suppliedValueControl];

/**
 * Keep the failing external baseline separate from the viable vertical control.
 * Reproduce with replayRecordSet -> transformGraphToV3: the stated raw 12 is
 * framed to .6, unreachable-factor repair removes data, and V3 loses the point.
 * This is an upstream regression fixture, not an estimator success fixture.
 */
export const externalStatedPointLossControl = {
  brief: figureRich.brief,
  records: figureRich.records,
  target_label: 'Current churn',
  stated_raw_value: 12,
  source_quote: 'Current churn is 12%.',
};

/** Regression: claim-mediated amounts lack a validated factor source stamp. */
export const claimMediatedStatedPointControl = {
  brief: 'Improve support reliability. Keep overtime share at 0.12 or raise overtime share to 0.24. Current overtime share is 0.12. There are 20 scheduled agents and 15 are available today. Availability is the available share of scheduled agents on a 0 to 1 scale. The attendance log reports a daily available-share standard deviation of 0.05 on that same scale.',
  records: {
    stated_items: [
      { kind: 'goal', source_quote: 'Improve support reliability.' },
      { kind: 'option', source_quote: 'Keep overtime share at 0.12', is_baseline: true },
      { kind: 'option', source_quote: 'raise overtime share to 0.24' },
      { kind: 'figure', source_quote: 'Current overtime share is 0.12.', value: 0.12, unit: 'share' },
      { kind: 'figure', source_quote: '0.24', value: 0.24, unit: 'share' },
      { kind: 'figure', source_quote: 'There are 20 scheduled agents', value: 20, unit: 'agents' },
      { kind: 'figure', source_quote: '15 are available today', value: 15, unit: 'agents' },
      { kind: 'figure', source_quote: 'The attendance log reports a daily available-share standard deviation of 0.05 on that same scale.', value: 0.05, unit: 'share' },
    ],
    claims: [
      { claim_kind: 'factor', label: 'Overtime share', value: 0.12, basis: [3] },
      { claim_kind: 'factor', label: 'Agent availability share', basis: [5, 6] },
      { claim_kind: 'causal_link', label: 'Keep the stated overtime', from_stated: 1, to_claim: 0, sets_to: 0.12, basis: [3], effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Raise overtime to the proposed share', from_stated: 2, to_claim: 0, sets_to: 0.24, basis: [4], effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Overtime supports reliability', from_claim: 0, to_stated: 0, effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Agent availability supports reliability', from_claim: 1, to_stated: 0, effect: 'positive' },
    ],
  } satisfies DraftRecordSet,
  protected_label: 'Overtime share',
  protected_value: 0.12,
  missing_label: 'Agent availability share',
};

/** The source-authoritative point is a direct stated figure, not an AI claim. */
export const liveRecordsFigureRichControl = {
  ...claimMediatedStatedPointControl,
  records: {
    stated_items: claimMediatedStatedPointControl.records.stated_items,
    claims: [
      { claim_kind: 'factor', label: 'Agent availability share', basis: [5, 6] },
      { claim_kind: 'causal_link', label: 'Keep the stated overtime', from_stated: 1, to_stated: 3, sets_to: 0.12, basis: [3], effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Raise overtime to the proposed share', from_stated: 2, to_stated: 3, sets_to: 0.24, basis: [4], effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Overtime supports reliability', from_stated: 3, to_stated: 0, effect: 'positive' },
      { claim_kind: 'causal_link', label: 'Agent availability supports reliability', from_claim: 0, to_stated: 0, effect: 'positive' },
    ],
  } satisfies DraftRecordSet,
  protected_label: 'Current overtime share is 0.12.',
};

/** Separate positive: do not rewrite the original snapshot/variation ambiguity
 * or the claim-mediated source-loss fixture to make an estimate appear valid.
 * The random-day planning quantity and transfer assumption are explicit. */
export const liveRecordsPlanningDayControl = {
  ...liveRecordsFigureRichControl,
  brief: 'Improve support reliability. Keep overtime share at 0.12 or raise overtime share to 0.24. Current overtime share is 0.12. Model agent availability share for a randomly selected operating day in the next four weeks, not today or the four-week average. In the attendance log for the last four weeks, each operating day had 20 scheduled agents; the daily available-agent count averaged 15. Availability is the available share of scheduled agents on a 0 to 1 scale. The attendance log reports a daily available-share standard deviation of 0.05 on that same scale. For this provisional planning comparison, assume the next four weeks use the same daily attendance process and staffing conditions as the logged period. This assumption is not evidence of future outcomes; the standard deviation describes variation between operating days, not uncertainty in the historical mean.',
  missing_label: 'Agent availability share on a planning day',
  records: {
    stated_items: liveRecordsFigureRichControl.records.stated_items.map((item, index) => {
      if (index === 5) return { kind: 'figure' as const, source_quote: 'each operating day had 20 scheduled agents', value: 20, unit: 'agents' };
      if (index === 6) return { kind: 'figure' as const, source_quote: 'the daily available-agent count averaged 15', value: 15, unit: 'agents' };
      return { ...item };
    }),
    claims: liveRecordsFigureRichControl.records.claims.map(item => item.claim_kind === 'factor'
      ? { ...item, label: 'Agent availability share on a planning day' } : { ...item }),
  } satisfies DraftRecordSet,
};
