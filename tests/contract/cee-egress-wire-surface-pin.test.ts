/**
 * Egress wire-surface pin — CEE → UI contract at @talchain/schemas 0.13.0.
 *
 * Egress complement of tests/contract/ui-cee-contract.test.ts (which covers
 * the UI → CEE ingress direction). The UI-facing wire shape of
 * POST /orchestrate/v2/turn is exactly the strict OlumiResponseSchema
 * (validated at the egress seam in src/orchestrator/route-v2.ts, with
 * underscore-prefixed debug fields stripped/re-attached around validation by
 * src/orchestrator/debug-fields.ts).
 *
 * Why this exists: DecisionGuideAI currently pins @talchain/schemas@0.8.1
 * while CEE pins 0.13.0 (vendor/talchain-schemas-0.13.0.tgz). A 0.8.1
 * consumer silently drops everything marked `0.13.0-new` below — that skew
 * is a live output-loss defect, documented in
 * Docs/v5/ui-wire-contract-skew-evidence.md.
 *
 * A failure here means a schema bump changed the UI-relevant wire surface.
 * Update protocol: update the pins below, update the skew evidence doc, and
 * coordinate the DGAI schema bump BEFORE merging the bump into CEE.
 *
 * Deterministic Zod introspection only — no fixtures, no network, no service.
 */
import { describe, expect, it } from 'vitest'

import {
  ActionSchema,
  AnalysisResultBlockSchema,
  BlockSchema,
  ChipSchema,
  CoachingBlockSchema,
  EvidenceBlockSchema,
  ExerciseBlockSchema,
  ExplanationBlockSchema,
  FlipAnalysisBlockSchema,
  OlumiResponseSchema,
  ReviewCardBlockSchema,
} from '@talchain/schemas/boundary'

/**
 * Duck-typed unwrap that tolerates ZodEffects wrappers (e.g.
 * EvidenceBlockSchema is a ZodEffects<ZodObject>) without depending on
 * instanceof against a possibly-duplicated zod module instance.
 */
interface ZodObjectLike {
  shape: Record<string, unknown>
  _def: { unknownKeys?: string }
}

function unwrapToObject(schema: unknown): ZodObjectLike {
  let current: unknown = schema
  for (let depth = 0; depth < 4; depth += 1) {
    if (current !== null && typeof current === 'object' && 'shape' in current) {
      return current as ZodObjectLike
    }
    const effects = current as { innerType?: () => unknown }
    if (typeof effects.innerType !== 'function') break
    current = effects.innerType()
  }
  throw new Error('expected a Zod object schema (possibly wrapped in effects)')
}

function shapeKeys(schema: unknown): string[] {
  return Object.keys(unwrapToObject(schema).shape).sort()
}

/** Minimal response accepted by the strict egress schema. */
function minimalValidResponse(): Record<string, unknown> {
  return {
    response_version: 2,
    assistant_text: 'x',
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'frame',
  }
}

describe('egress wire-surface pin (@talchain/schemas 0.13.0)', () => {
  it('pins the top-level OlumiResponseSchema surface (strict)', () => {
    const top = unwrapToObject(OlumiResponseSchema)
    expect(Object.keys(top.shape).sort()).toEqual([
      'analysis_ready',
      'assistant_text',
      'blocks',
      'draft_graph',
      'insights',
      // 0.15.0-new: optional top-level reasoning (formalises the _reasoning
      // wire sidecar). Approved surface change — 0.15.0 contract wave.
      'reasoning',
      'response_version',
      'stage_indicator',
      'suggested_actions',
    ])
    expect(top._def.unknownKeys).toBe('strict')

    const optionality = (key: string): boolean =>
      (top.shape[key] as { isOptional(): boolean }).isOptional()
    expect(optionality('draft_graph')).toBe(true)
    expect(optionality('analysis_ready')).toBe(true)
    expect(optionality('reasoning')).toBe(true)
    expect(optionality('assistant_text')).toBe(false)
    expect(optionality('blocks')).toBe(false)
  })

  it('accepts a minimal valid response and rejects top-level coaching look-alike fields', () => {
    expect(OlumiResponseSchema.safeParse(minimalValidResponse()).success).toBe(true)

    // These fields do NOT exist on the v2 wire (guidance_items is v1-internal
    // only; next_best_action exists nowhere in CEE). The strict schema
    // rejecting them proves top-level coaching fields cannot appear without a
    // schema bump — which this suite would catch.
    for (const forbidden of ['guidance_items', 'chips', 'next_best_action']) {
      const candidate = { ...minimalValidResponse(), [forbidden]: [] }
      expect(
        OlumiResponseSchema.safeParse(candidate).success,
        `top-level '${forbidden}' must be rejected by the strict egress schema`,
      ).toBe(false)
    }
  })

})

describe('block-type registry (@talchain/schemas 0.13.0)', () => {
  const inner = (BlockSchema as { innerType(): { options: Array<unknown> } }).innerType()
  const discriminators = inner.options
    .map((option) => (unwrapToObject(option).shape.type as { value: string }).value)
    .sort()

  it('pins the 14 block-type discriminators', () => {
    expect(discriminators).toEqual([
      'analysis_result',
      'coaching',
      'comparison',
      'draft_graph',
      'error',
      'evidence',
      'exercise',
      'explanation',
      'flip_analysis',
      'graph_patch',
      // 0.15.0-new: held_proposal (ROADMAP 1.43 durable held-mutation shape)
      // + ui_directive (seamlessness R4). Approved surface change — 0.15.0
      // contract wave. Neither is emitted by CEE yet (dormant-but-armed).
      'held_proposal',
      'review_card',
      'text',
      'ui_directive',
    ])
  })

  it('names the 0.13.0-new Phase-3 block types unknown to the 0.8.1-pinned UI', () => {
    // The skew evidence: DGAI at 0.8.1 drops these four block types entirely.
    const BLOCK_TYPES_UNKNOWN_TO_UI_0_8_1 = ['coaching', 'evidence', 'exercise', 'review_card']
    for (const blockType of BLOCK_TYPES_UNKNOWN_TO_UI_0_8_1) {
      expect(discriminators).toContain(blockType)
    }
  })
})

describe('Phase-3 block field pins (0.13.0-new, dropped by a 0.8.1 consumer)', () => {
  it('pins CoachingBlockSchema keys', () => {
    expect(shapeKeys(CoachingBlockSchema)).toEqual([
      'action_intent',
      'action_label',
      'block_id',
      'body',
      'coaching_kind',
      'created_at',
      'freshness',
      'graph_hash_at_generation',
      'priority_rank',
      'signal_id',
      'source',
      'source_handler',
      'target_refs',
      'title',
      'type',
    ])
  })

  it('pins ReviewCardBlockSchema keys', () => {
    expect(shapeKeys(ReviewCardBlockSchema)).toEqual([
      'action_intent',
      'action_label',
      'block_id',
      'body',
      'card_kind',
      'created_at',
      'freshness',
      'graph_hash_at_generation',
      'priority_rank',
      'severity',
      'signal_id',
      'source_handler',
      'target_refs',
      'title',
      'type',
    ])
  })

  it('pins EvidenceBlockSchema keys', () => {
    expect(shapeKeys(EvidenceBlockSchema)).toEqual([
      'action_intent',
      'action_label',
      'block_id',
      'created_at',
      'current_confidence',
      'evidence_gap',
      'factor_label',
      'factor_ref',
      'freshness',
      'graph_hash_at_generation',
      'impact_if_gathered',
      'priority_rank',
      'severity',
      'signal_id',
      'source_handler',
      'suggested_technique',
      'target_refs',
      'type',
    ])
  })

  it('pins ExerciseBlockSchema keys', () => {
    expect(shapeKeys(ExerciseBlockSchema)).toEqual([
      'block_id',
      'counter_case',
      'created_at',
      'exercise_kind',
      'failure_scenario',
      'freshness',
      'graph_hash_at_generation',
      'mitigation',
      'reference_class',
      'review_trigger',
      'signal_id',
      'source_handler',
      'target_element_ref',
      'target_refs',
      'type',
      'warning_signs',
    ])
  })
})

describe('affordance pins (chips-on-the-wire)', () => {
  it('pins ActionSchema keys — suggested_actions[] carries action_type (0.5.0+)', () => {
    expect(shapeKeys(ActionSchema)).toEqual(['action_type', 'id', 'label', 'message'])
  })

  it('pins ChipSchema keys (0.13.0 export, not yet rendered by the UI)', () => {
    expect(shapeKeys(ChipSchema)).toEqual(['action', 'id', 'label'])
  })
})

describe('enrichment carriers (schema-unpinned — values ride z.record/passthrough)', () => {
  // The runtime keys riding these carriers today include: edge_e_values,
  // flip_thresholds, confidence_tier, inference_warnings, factor_sensitivity,
  // m1_coaching, conditional_probabilities. They are intentionally NOT pinned
  // here because the schema declares the carriers as open
  // (z.record(z.unknown()) / passthrough). Full enumeration + producers in
  // Docs/v5/ui-wire-contract-skew-evidence.md.
  it('pins that the three analysis block schemas expose an enrichment carrier', () => {
    for (const schema of [
      AnalysisResultBlockSchema,
      ExplanationBlockSchema,
      FlipAnalysisBlockSchema,
    ]) {
      expect(Object.keys(unwrapToObject(schema).shape)).toContain('enrichment')
    }
  })

  it('pins analysis_ready as a passthrough object with three declared keys', () => {
    const top = unwrapToObject(OlumiResponseSchema)
    const analysisReady = (top.shape.analysis_ready as { unwrap(): unknown }).unwrap()
    const inner = unwrapToObject(analysisReady)
    expect(Object.keys(inner.shape).sort()).toEqual(['goal_node_id', 'options', 'status'])
    expect(inner._def.unknownKeys).toBe('passthrough')
  })
})
