/**
 * Zod schema mirroring OrchestratorResponseEnvelopeV2 (pipeline/types.ts).
 *
 * Contract-testing only — not used at runtime. Kept intentionally loose
 * (.passthrough()) on nested objects so the contract catches structural
 * regressions without breaking on additive fields.
 */

import { z } from "zod";

const SpecialistAdviceSchema = z.object({
  specialist_id: z.string(),
  recommendation: z.string(),
  confidence: z.number(),
}).passthrough();

const ScienceLedgerSchema = z.object({
  claims_used: z.array(z.unknown()),
  techniques_used: z.array(z.unknown()),
  scope_violations: z.array(z.unknown()),
  phrasing_violations: z.array(z.unknown()),
  rewrite_applied: z.boolean(),
}).passthrough();

const GuidanceItemSchema = z.object({
  item_id: z.string(),
  signal_code: z.string(),
  category: z.string(),
  source: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  primary_action: z.string(),
  target_object: z.object({
    type: z.enum(['node', 'edge', 'option', 'graph', 'framing']),
    id: z.string().optional(),
    label: z.string().optional(),
  }).passthrough().optional(),
  valid_while: z.object({
    stage: z.string().optional(),
    max_turns: z.number().optional(),
  }).passthrough().optional(),
}).passthrough();

const ModelReceiptSchema = z.object({
  node_count: z.number(),
  edge_count: z.number(),
  option_labels: z.array(z.string()),
  goal_label: z.string().nullable(),
  top_insight: z.string().nullable(),
  readiness_status: z.string().nullable(),
  repairs_applied_count: z.number(),
}).passthrough();

export const OrchestratorResponseEnvelopeV2Schema = z.object({
  turn_id: z.string(),
  assistant_text: z.string().nullable(),
  assistant_tool_calls: z.array(z.object({
    name: z.string(),
    input: z.record(z.unknown()),
  })).optional(),
  blocks: z.array(z.object({
    block_id: z.string(),
    block_type: z.string(),
    data: z.unknown(),
  }).passthrough()),
  suggested_actions: z.array(z.object({
    label: z.string(),
    prompt: z.string(),
    role: z.enum(['facilitator', 'challenger']),
  })),
  proposed_changes: z.unknown().optional(),
  analysis_response: z.unknown().optional(),
  applied_changes: z.unknown().optional(),
  deterministic_answer_tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),

  lineage: z.object({
    context_hash: z.string(),
    plan_hash: z.string().optional(),
    response_hash: z.string().optional(),
    dsk_version_hash: z.string().nullable(),
  }),

  stage_indicator: z.object({
    stage: z.enum(['frame', 'ideate', 'evaluate', 'decide', 'optimise']),
    substate: z.string().optional(),
    confidence: z.enum(['high', 'medium', 'low']),
    source: z.enum(['explicit_event', 'inferred']),
    transition: z.object({
      from: z.enum(['frame', 'ideate', 'evaluate', 'decide', 'optimise']),
      to: z.enum(['frame', 'ideate', 'evaluate', 'decide', 'optimise']),
      trigger: z.string(),
    }).optional(),
  }),

  science_ledger: ScienceLedgerSchema,

  progress_marker: z.object({
    kind: z.enum(['changed_model', 'ran_analysis', 'added_evidence', 'committed', 'none']),
  }),

  observability: z.object({
    triggers_fired: z.array(z.string()),
    triggers_suppressed: z.array(z.string()),
    intent_classification: z.string(),
    specialist_contributions: z.array(SpecialistAdviceSchema),
    specialist_disagreement: z.null(),
  }),

  turn_plan: z.object({
    selected_tool: z.string().nullable(),
    routing: z.enum(['deterministic', 'llm']),
    long_running: z.boolean(),
    tool_latency_ms: z.number().optional(),
    executed_tools: z.array(z.string()).optional(),
    deferred_tools: z.array(z.string()).optional(),
    system_event: z.object({
      type: z.string(),
      event_id: z.string(),
    }).optional(),
  }).passthrough(),

  guidance_items: z.array(GuidanceItemSchema),

  analysis_ready: z.unknown().optional(),

  analysis_status: z.string().optional(),
  status_reason: z.string().optional(),
  retryable: z.boolean().optional(),
  critiques: z.array(z.unknown()).optional(),
  meta: z.record(z.unknown()).optional(),

  error: z.object({
    code: z.string(),
    message: z.string(),
  }).optional(),

  model_receipt: ModelReceiptSchema.optional(),

  diagnostics: z.string().optional(),
  parse_warnings: z.array(z.string()).optional(),
}).passthrough();
