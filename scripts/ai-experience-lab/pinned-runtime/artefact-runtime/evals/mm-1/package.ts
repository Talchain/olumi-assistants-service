import { z } from 'zod';
import { contentHash } from '../../canonical.js';

/**
 * MM-1 is an offline construction+widening evaluation package.
 * It never mutates canonical state and contains no provider client.
 */

export const MM1_CASES = [
  { id: 'MM-A', source_case: 'Baseline-v1/A', control_kind: 'representative' },
  { id: 'MM-C', source_case: 'Baseline-v1/C', control_kind: 'representative' },
  { id: 'MM-E', source_case: 'Baseline-v1/E', control_kind: 'representative' },
  { id: 'MM-SUPPORT', source_case: 'Baseline-v1/support', control_kind: 'representative' },
  { id: 'MM-TECHLEAD', source_case: 'Baseline-v1/techlead', control_kind: 'representative' },
] as const;

export const MM1_REPEATS = 2;
export const MM1_ARMS = ['m1_only', 'same_model_widening', 'different_model_widening'] as const;

const EvidencePointerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('brief_span'),
    quote: z.string().trim().min(1).max(600),
  }).strict(),
  z.object({
    kind: z.literal('evidence_ref'),
    ref_id: z.string().trim().min(1).max(240),
  }).strict(),
  z.object({
    kind: z.literal('model_ref'),
    ref_id: z.string().trim().min(1).max(240),
  }).strict(),
  z.object({
    kind: z.literal('validation_warning'),
    code: z.string().trim().min(1).max(160),
  }).strict(),
  z.object({
    kind: z.literal('graph_absence'),
    missing_concept: z.string().trim().min(1).max(240),
    basis: z.string().trim().min(1).max(600),
  }).strict(),
]);

export const MM1ProposalSchema = z.object({
  proposal_id: z.string().trim().min(1).max(120),
  proposal_type: z.enum([
    'missing_factor',
    'different_option',
    'missing_risk_or_outcome',
    'hidden_assumption',
    'counter_hypothesis',
    'disconfirming_evidence_need',
    'missing_stakeholder_or_perspective',
    'temporal_dependency',
    'consequential_evidence_gap',
  ]),
  candidate: z.string().trim().min(1).max(800),
  why_it_may_matter: z.string().trim().min(1).max(1200),
  evidence_pointers: z.array(EvidencePointerSchema).min(1).max(6),
  origin: z.enum(['olumi_hypothesis', 'evidence_derived']),
  uncertainty: z.enum(['hypothesis', 'evidence_gap', 'contested', 'unknown']),
  how_to_test_or_explore: z.string().trim().min(1).max(1000),
  affected_model_refs: z.array(z.string().trim().min(1).max(240)).max(12),
}).strict();

export const MM1OutputSchema = z.object({
  proposals: z.array(MM1ProposalSchema).max(8),
}).strict();

export const MM1_PROPOSAL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    proposals: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          proposal_id: { type: 'string' },
          proposal_type: {
            type: 'string',
            enum: [
              'missing_factor', 'different_option', 'missing_risk_or_outcome',
              'hidden_assumption', 'counter_hypothesis', 'disconfirming_evidence_need',
              'missing_stakeholder_or_perspective', 'temporal_dependency',
              'consequential_evidence_gap',
            ],
          },
          candidate: { type: 'string' },
          why_it_may_matter: { type: 'string' },
          evidence_pointers: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: {
              anyOf: [
                {
                  type: 'object', additionalProperties: false,
                  properties: { kind: { const: 'brief_span' }, quote: { type: 'string' } },
                  required: ['kind', 'quote'],
                },
                {
                  type: 'object', additionalProperties: false,
                  properties: { kind: { const: 'evidence_ref' }, ref_id: { type: 'string' } },
                  required: ['kind', 'ref_id'],
                },
                {
                  type: 'object', additionalProperties: false,
                  properties: { kind: { const: 'model_ref' }, ref_id: { type: 'string' } },
                  required: ['kind', 'ref_id'],
                },
                {
                  type: 'object', additionalProperties: false,
                  properties: { kind: { const: 'validation_warning' }, code: { type: 'string' } },
                  required: ['kind', 'code'],
                },
                {
                  type: 'object', additionalProperties: false,
                  properties: {
                    kind: { const: 'graph_absence' },
                    missing_concept: { type: 'string' },
                    basis: { type: 'string' },
                  },
                  required: ['kind', 'missing_concept', 'basis'],
                },
              ],
            },
          },
          origin: { type: 'string', enum: ['olumi_hypothesis', 'evidence_derived'] },
          uncertainty: { type: 'string', enum: ['hypothesis', 'evidence_gap', 'contested', 'unknown'] },
          how_to_test_or_explore: { type: 'string' },
          affected_model_refs: { type: 'array', items: { type: 'string' }, maxItems: 12 },
        },
        required: [
          'proposal_id', 'proposal_type', 'candidate', 'why_it_may_matter',
          'evidence_pointers', 'origin', 'uncertainty', 'how_to_test_or_explore',
          'affected_model_refs',
        ],
      },
    },
  },
  required: ['proposals'],
} as const;

export interface MM1Binding {
  case_id: (typeof MM1_CASES)[number]['id'];
  brief: { id: string; revision: string; text: string; content_hash: string };
  admitted_m1: {
    scenario_id: string;
    graph_revision: string;
    graph_hash: string;
    model: unknown;
    model_refs: string[];
    model_name: string;
  };
  evidence_refs: string[];
  validation_warning_codes: string[];
  different_model_name: string;
}

export interface MM1Run {
  run_id: string;
  case_id: MM1Binding['case_id'];
  arm: 'same_model_widening' | 'different_model_widening';
  repeat: number;
  model: string;
  input_sha256: string;
  output_schema_sha256: string;
}

function normaliseText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const forbiddenAuthority = /\b(recommend(?:ed|ation)?|winner|best option|optimal option|i (?:have )?(?:added|changed|updated|saved)|confidence\s*\d+\s*%)\b/i;

export function validateMM1Output(binding: MM1Binding, output: unknown): string[] {
  const parsed = MM1OutputSchema.safeParse(output);
  if (!parsed.success) return ['invalid_output_contract'];
  const errors: string[] = [];
  const proposalIds = new Set<string>();
  const dedupe = new Set<string>();
  const modelRefs = new Set(binding.admitted_m1.model_refs);
  const evidenceRefs = new Set(binding.evidence_refs);
  const warningCodes = new Set(binding.validation_warning_codes);

  for (const proposal of parsed.data.proposals) {
    if (proposalIds.has(proposal.proposal_id)) errors.push(`duplicate_proposal_id:${proposal.proposal_id}`);
    proposalIds.add(proposal.proposal_id);

    const fingerprint = `${proposal.proposal_type}:${normaliseText(proposal.candidate)}`;
    if (dedupe.has(fingerprint)) errors.push(`duplicate_proposal:${proposal.proposal_id}`);
    dedupe.add(fingerprint);

    if (forbiddenAuthority.test([
      proposal.candidate, proposal.why_it_may_matter, proposal.how_to_test_or_explore,
    ].join(' '))) {
      errors.push(`forbidden_authority_or_confidence:${proposal.proposal_id}`);
    }

    for (const ref of proposal.affected_model_refs) {
      if (!modelRefs.has(ref)) errors.push(`unknown_affected_model_ref:${proposal.proposal_id}:${ref}`);
    }

    proposal.evidence_pointers.forEach((pointer, index) => {
      if (pointer.kind === 'brief_span' && !binding.brief.text.includes(pointer.quote)) {
        errors.push(`unlocatable_brief_span:${proposal.proposal_id}:${index}`);
      }
      if (pointer.kind === 'evidence_ref' && !evidenceRefs.has(pointer.ref_id)) {
        errors.push(`unknown_evidence_ref:${proposal.proposal_id}:${index}`);
      }
      if (pointer.kind === 'model_ref' && !modelRefs.has(pointer.ref_id)) {
        errors.push(`unknown_model_ref:${proposal.proposal_id}:${index}`);
      }
      if (pointer.kind === 'validation_warning' && !warningCodes.has(pointer.code)) {
        errors.push(`unknown_validation_warning:${proposal.proposal_id}:${index}`);
      }
      if (pointer.kind === 'graph_absence' && normaliseText(pointer.missing_concept).length < 3) {
        errors.push(`invalid_graph_absence:${proposal.proposal_id}:${index}`);
      }
    });
  }
  return errors;
}

export function buildMM1Runs(bindings: readonly MM1Binding[]): MM1Run[] {
  const runs: MM1Run[] = [];
  for (const binding of bindings) {
    const spec = MM1_CASES.find(item => item.id === binding.case_id);
    if (!spec) throw new Error(`unknown_mm1_case:${binding.case_id}`);
    if (!/^[0-9a-f]{64}$/.test(binding.brief.content_hash) ||
        !/^[0-9a-f]{64}$/.test(binding.admitted_m1.graph_hash)) {
      throw new Error(`invalid_binding_hash:${binding.case_id}`);
    }
    if (!binding.brief.text.trim() || !binding.admitted_m1.model_name.trim()) {
      throw new Error(`missing_binding_identity:${binding.case_id}`);
    }
    if (binding.different_model_name === binding.admitted_m1.model_name) {
      throw new Error(`different_model_arm_not_independent:${binding.case_id}`);
    }

    const shared = {
      brief: binding.brief,
      admitted_m1: {
        scenario_id: binding.admitted_m1.scenario_id,
        graph_revision: binding.admitted_m1.graph_revision,
        graph_hash: binding.admitted_m1.graph_hash,
        model: binding.admitted_m1.model,
        model_refs: binding.admitted_m1.model_refs,
      },
      evidence_refs: binding.evidence_refs,
      validation_warning_codes: binding.validation_warning_codes,
    };
    const input_sha256 = contentHash(shared);
    const schema_sha256 = contentHash(MM1_PROPOSAL_JSON_SCHEMA);

    for (const arm of ['same_model_widening', 'different_model_widening'] as const) {
      const model = arm === 'same_model_widening'
        ? binding.admitted_m1.model_name
        : binding.different_model_name;
      for (let repeat = 1; repeat <= MM1_REPEATS; repeat += 1) {
        runs.push({
          run_id: `MM1-${binding.case_id}-${arm}-r${repeat}`,
          case_id: binding.case_id,
          arm,
          repeat,
          model,
          input_sha256,
          output_schema_sha256: schema_sha256,
        });
      }
    }
  }
  return runs;
}

export const MM1_SCORECARD = {
  hard_fails: [
    'invented_case_fact_or_number',
    'false_missing_claim',
    'unlocatable_evidence_pointer',
    'unsupported_recommendation_or_winner',
    'fabricated_analysis_probability_or_uncertainty',
    'silent_mutation_or_write_claim',
    'provenance_laundering',
    'minority_or_dissent_loss',
  ],
  quality_dimensions: [
    'materially_useful_non_redundant_additions',
    'non_obvious_alternatives_or_mechanisms',
    'consequential_assumptions_or_evidence_gaps',
    'disconfirmation_value',
    'restraint_when_no_widening_is_needed',
    'inspectability_and_actionability',
  ],
  rules: {
    proposal_count_is_not_quality: true,
    zero_proposals_is_valid: true,
    model_disagreement_is_not_probability: true,
    blind_score_before_unblinding_model_identity: true,
  },
} as const;
