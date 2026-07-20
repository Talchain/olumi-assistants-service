/**
 * ActionType vocabulary pin — the shared handler/action-type enum, pinned at
 * BOTH seams it reaches.
 *
 * Why this file exists (0.20.0 re-vendor): `analysis_readiness` joined
 * `ActionType` in @talchain/schemas 0.20.0, and NOTHING in this repo went red.
 * The wire-surface pins enumerate schema KEYS, so an enum that gains a VALUE
 * changes the accepted vocabulary invisibly — in either direction. That is the
 * hand-maintained-mirror hazard in its quietest form: a contract widening no
 * test can see.
 *
 * The hazard is asymmetric and it bites on INGRESS. CEE's B1 validator is
 * fail-closed (Boundary Contract v1.1 §3.2): an `action_type` outside the enum
 * fails `OrchestratorTurnPayloadSchema` and 422s the WHOLE turn, not just the
 * chip. So the landing order is forced — CEE must accept `analysis_readiness`
 * BEFORE the UI's readiness sparks send it. This suite is the executable proof
 * that CEE's half of that handshake is in place.
 *
 * Deterministic Zod introspection + a direct call to the real `validateIngress`.
 * No fixtures, no network, no service.
 */
import { describe, expect, it } from 'vitest'

import { ActionSchema, OrchestratorTurnPayloadSchema } from '@talchain/schemas/boundary'

import { validateIngress } from '../../src/validators/b1.js'

/**
 * The complete ActionType vocabulary at @talchain/schemas 0.20.0.
 *
 * Update protocol: a value added here is a CONTRACT WIDENING. CEE must land it
 * (this file + the re-vendor) before any producer sends it — see the landing
 * sequence in the package CHANGELOG.
 */
const ACTION_TYPE_VOCABULARY_0_20_0 = [
  'run_analysis',
  'set_factor_value',
  'add_constraint',
  'adjust_edge_strength',
  'explain_result',
  'explain_results',
  'explain_from_structure',
  'compare_options',
  'what_would_flip',
  // 0.20.0-new: the analysis-preparation / readiness chip intent. Covers the
  // READINESS-CLASS sparks only — a spark whose honest intent differs stays
  // gated dark rather than borrowing this literal (consumer sign-off 1).
  'analysis_readiness',
] as const

/** Duck-typed unwrap to the underlying enum values, tolerating optional/effects wrappers. */
function enumValues(field: unknown): string[] {
  let current: unknown = field
  for (let depth = 0; depth < 6; depth += 1) {
    const def = (current as { _def?: { values?: string[]; innerType?: unknown } })?._def
    if (def?.values) return def.values
    if (def?.innerType !== undefined) {
      current = def.innerType
      continue
    }
    const effects = current as { innerType?: () => unknown }
    if (typeof effects?.innerType !== 'function') break
    current = effects.innerType()
  }
  throw new Error('expected a Zod enum (possibly wrapped in optional/effects)')
}

/** Duck-typed unwrap to a Zod object, tolerating optional/effects wrappers. */
function unwrapToObject(schema: unknown): { shape: Record<string, unknown> } {
  let current: unknown = schema
  for (let depth = 0; depth < 6; depth += 1) {
    if (current !== null && typeof current === 'object' && 'shape' in current) {
      return current as { shape: Record<string, unknown> }
    }
    // ZodOptional/ZodNullable expose `_def.innerType` as a property;
    // ZodEffects exposes `innerType()` as a method.
    const def = (current as { _def?: { innerType?: unknown; schema?: unknown } })?._def
    if (def?.innerType !== undefined) {
      current = def.innerType
      continue
    }
    if (def?.schema !== undefined) {
      current = def.schema
      continue
    }
    const effects = current as { innerType?: () => unknown }
    if (typeof effects?.innerType !== 'function') break
    current = effects.innerType()
  }
  throw new Error('expected a Zod object schema (possibly wrapped in optional/effects)')
}

/**
 * The `kind: 'message'` member of the ingress discriminated union.
 *
 * `OrchestratorTurnPayloadSchema` is a ZodEffects (the cross-field chip/source
 * refinement) wrapping a ZodDiscriminatedUnion, so the member is reached
 * through `_def.schema._def.options` rather than a plain `.shape`.
 */
function messageTurnMember(): { shape: Record<string, unknown> } {
  const options =
    (
      OrchestratorTurnPayloadSchema as unknown as {
        _def: { schema?: { _def?: { options?: unknown[] } }; options?: unknown[] }
      }
    )._def.schema?._def?.options ??
    (OrchestratorTurnPayloadSchema as unknown as { _def: { options?: unknown[] } })._def.options ??
    []
  for (const option of options) {
    const obj = unwrapToObject(option)
    if (obj.shape.chip) return obj
  }
  throw new Error("could not locate the kind:'message' member carrying `chip`")
}

/** A minimal, schema-valid chip-sourced turn carrying the given action_type. */
function chipTurn(actionType: string): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '11111111-1111-4111-8111-111111111111',
    scenario_id: '22222222-2222-4222-8222-222222222222',
    message: 'Prepare first analysis.',
    turn_class: 'frame',
    stage: 'analyse',
    source: 'chip',
    chip: { action_type: actionType },
  }
}

describe('ActionType vocabulary pin (@talchain/schemas 0.20.0)', () => {
  it('pins the vocabulary at the B1 ingress seam (chip.action_type)', () => {
    const chipField = messageTurnMember().shape.chip
    const actionType = unwrapToObject(chipField).shape.action_type
    expect(enumValues(actionType)).toEqual([...ACTION_TYPE_VOCABULARY_0_20_0])
  })

  it('pins the vocabulary at the egress seam (ActionSchema.action_type)', () => {
    const actionType = unwrapToObject(ActionSchema).shape.action_type
    expect(enumValues(actionType)).toEqual([...ACTION_TYPE_VOCABULARY_0_20_0])
  })

  it('binds the two seams to ONE enum — ingress and egress cannot drift apart', () => {
    const ingress = enumValues(unwrapToObject(messageTurnMember().shape.chip).shape.action_type)
    const egress = enumValues(unwrapToObject(ActionSchema).shape.action_type)
    expect(ingress).toEqual(egress)
  })
})

describe('B1 ingress accepts analysis_readiness (0.20.0 handshake — UI is gated on this)', () => {
  it('validateIngress ACCEPTS a chip carrying action_type=analysis_readiness', () => {
    const result = validateIngress(chipTurn('analysis_readiness'), 'req-readiness-accept')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.value as { chip?: { action_type?: string } }).chip?.action_type).toBe(
        'analysis_readiness',
      )
    }
  })

  // DISCRIMINATION CONTROL. Without this, the acceptance above is vacuous — a
  // validator that accepts everything would pass it. This proves B1 really is
  // fail-closed on the enum, which is exactly why the UI cannot send
  // `analysis_readiness` until this re-vendor lands.
  it('validateIngress REJECTS an action_type outside the vocabulary (fail-closed, 422 class)', () => {
    const result = validateIngress(chipTurn('not_a_real_action_type'), 'req-readiness-reject')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.error).toBe('INGRESS_CONTRACT_VIOLATION')
      expect(result.error.boundary).toBe('B1')
      expect(result.error.direction).toBe('ingress')
    }
  })

  // The pre-0.20.0 vocabulary must keep working — this bump is strictly additive.
  it('still accepts every pre-0.20.0 action_type (additive, nothing displaced)', () => {
    for (const actionType of ACTION_TYPE_VOCABULARY_0_20_0) {
      const result = validateIngress(chipTurn(actionType), `req-vocab-${actionType}`)
      expect(result.ok, `${actionType} must be accepted at B1 ingress`).toBe(true)
    }
  })
})
