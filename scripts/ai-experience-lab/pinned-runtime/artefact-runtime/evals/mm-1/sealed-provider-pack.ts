import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { contentHash } from '../../canonical.js';
import {
  buildMM1Runs,
  MM1_CASES,
  MM1_PROPOSAL_JSON_SCHEMA,
  type MM1Binding,
} from './package.js';

/**
 * Exact offline provider hand-off for MM-1.
 *
 * No provider client, live host binding, canonical write or product integration is present here.
 * The five M1 fixtures are frozen from Model Generation evidence and copied into this branch.
 */
export const MM1_SEALED_STATUS = 'READY_FOR_AUTHORISED_PROVIDER_EXECUTION_NOT_RUN' as const;
export const MM1_FROZEN_SOURCE_COMMIT = '6032fbf99c904e9920de5a530a0caa33cbd998e1' as const;
export const MM1_FROZEN_SOURCE_BLOB = 'c0294d7e7a62c534f705ce75f6991c6bbf6c92d0' as const;
export const MM1_SAME_MODEL = 'gpt-5.6-terra' as const;
export const MM1_DIFFERENT_MODEL = 'gpt-6-luna' as const;
export const MM1_EFFORT = 'low' as const;
export const MM1_REPEATS = 2 as const;

export const MM1_WIDENING_PROMPT = [
  'You are performing a read-only widening pass over a provisional Olumi Living Model.',
  'Use only the supplied brief and admitted model. Do not claim external case-specific facts.',
  'Identify 0-8 materially useful items that may be absent. Zero proposals is valid when the model is already strong.',
  'Allowed proposal types are exactly those in the supplied output schema.',
  'Each proposal must remain provisional and point to exact supplied brief text, a supplied model ref, a supplied validation warning, or a precise graph absence.',
  'A graph absence may motivate a generic hypothesis, but must not be presented as a fact about this case.',
  'Do not recommend a winner or optimal option. Do not claim a write, save, edit or mutation.',
  'Do not fabricate probability, sensitivity, robustness, VOI, calibrated confidence or numerical uncertainty.',
  'Model disagreement is not probability. Preserve provenance and uncertainty.',
  'Return only JSON matching the supplied schema.',
].join('\n\n');

const FrozenCaseSchema = z.object({
  case_id: z.enum(['MM-A', 'MM-C', 'MM-E', 'MM-SUPPORT', 'MM-TECHLEAD']),
  source_case: z.string().min(1),
  source_rep: z.number().int().nonnegative(),
  domain: z.string().min(1),
  source_description: z.string().min(1),
  brief_text: z.string().min(1),
  scenario_id: z.string().min(1),
  admitted_graph: z.object({
    nodes: z.array(z.object({ id: z.string().min(1) }).passthrough()).min(1),
    edges: z.array(z.object({
      from: z.string().min(1),
      to: z.string().min(1),
    }).passthrough()),
  }).passthrough(),
  m1_model: z.string().min(1),
  m1_reasoning_effort: z.string().min(1),
}).passthrough();

const FrozenSourceSchema = z.object({
  schema_version: z.literal('mm1-frozen-source-v0.1'),
  status: z.literal('FROZEN_SOURCE_ONLY_NOT_PROVIDER_PACK'),
  source: z.object({
    repository: z.literal('Talchain/olumi-programme-docs'),
    commit: z.literal(MM1_FROZEN_SOURCE_COMMIT),
    result_path: z.string().min(1),
    briefs_path: z.string().min(1),
    briefs_blob_sha: z.string().regex(/^[0-9a-f]{40}$/),
    admitted_models_path: z.string().min(1),
    admitted_models_blob_sha: z.string().regex(/^[0-9a-f]{40}$/),
    construction_arm: z.string().min(1),
    note: z.string().min(1),
  }).strict(),
  cases: z.array(FrozenCaseSchema).length(5),
}).strict();

type FrozenCase = z.infer<typeof FrozenCaseSchema>;

function modelRefs(item: FrozenCase): string[] {
  return [...new Set(item.admitted_graph.nodes.map(node => node.id))].sort();
}

function bindingFromFrozen(item: FrozenCase): MM1Binding {
  if (item.m1_model !== MM1_SAME_MODEL) {
    throw new Error(`unexpected_m1_model:${item.case_id}:${item.m1_model}`);
  }
  return {
    case_id: item.case_id,
    brief: {
      id: `Baseline-v1/${item.source_case}`,
      revision: `${MM1_FROZEN_SOURCE_COMMIT}:${item.source_rep}`,
      text: item.brief_text,
      content_hash: contentHash(item.brief_text),
    },
    admitted_m1: {
      scenario_id: item.scenario_id,
      graph_revision: `${MM1_FROZEN_SOURCE_COMMIT}:${item.scenario_id}`,
      graph_hash: contentHash(item.admitted_graph),
      model: item.admitted_graph,
      model_refs: modelRefs(item),
      model_name: item.m1_model,
    },
    evidence_refs: [],
    validation_warning_codes: [],
    different_model_name: MM1_DIFFERENT_MODEL,
  };
}

function providerInput(binding: MM1Binding) {
  return {
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
}

export function buildMM1SealedProviderPack() {
  const raw = readFileSync(new URL('./MM1_FROZEN_SOURCE_v0_1.json', import.meta.url), 'utf8');
  const frozen = FrozenSourceSchema.parse(JSON.parse(raw));
  const caseIds = frozen.cases.map(item => item.case_id);
  if (new Set(caseIds).size !== MM1_CASES.length ||
      MM1_CASES.some(item => !caseIds.includes(item.id))) {
    throw new Error('mm1_case_set_mismatch');
  }

  const bindings = frozen.cases.map(bindingFromFrozen);
  const inputs = bindings.map(binding => {
    const input = providerInput(binding);
    return {
      case_id: binding.case_id,
      input,
      input_sha256: contentHash(input),
    };
  });
  const runs = buildMM1Runs(bindings);
  for (const run of runs) {
    const row = inputs.find(item => item.case_id === run.case_id);
    if (!row || row.input_sha256 !== run.input_sha256) {
      throw new Error(`mm1_input_hash_mismatch:${run.run_id}`);
    }
  }

  const instruction_sha256 = createHash('sha256')
    .update(MM1_WIDENING_PROMPT, 'utf8').digest('hex');
  const schema_sha256 = contentHash(MM1_PROPOSAL_JSON_SCHEMA);
  if (runs.some(run => run.output_schema_sha256 !== schema_sha256)) {
    throw new Error('mm1_schema_hash_mismatch');
  }

  return {
    schema_version: 'mm1-provider-pack-v0.1',
    status: MM1_SEALED_STATUS,
    source: {
      repository: frozen.source.repository,
      commit: frozen.source.commit,
      frozen_source_blob_sha: MM1_FROZEN_SOURCE_BLOB,
      briefs_blob_sha: frozen.source.briefs_blob_sha,
      admitted_models_blob_sha: frozen.source.admitted_models_blob_sha,
      construction_arm: frozen.source.construction_arm,
    },
    configuration: {
      same_model: MM1_SAME_MODEL,
      different_model: MM1_DIFFERENT_MODEL,
      reasoning_effort: MM1_EFFORT,
      repeats: MM1_REPEATS,
      tool_policy: 'none',
      temperature: 'not_sent',
      top_p: 'not_sent',
      semantic_retries: 0,
      one_axis: 'widening_model_only',
      m1_control_provider_calls: 0,
    },
    prompt: MM1_WIDENING_PROMPT,
    instruction_sha256,
    output_schema: MM1_PROPOSAL_JSON_SCHEMA,
    schema_sha256,
    inputs,
    runs: runs.map(run => ({ ...run, instruction_sha256 })),
    rules: {
      zero_proposals_is_valid: true,
      proposal_count_is_not_quality: true,
      model_disagreement_is_not_probability: true,
      no_product_or_model_default_change: true,
    },
  };
}
