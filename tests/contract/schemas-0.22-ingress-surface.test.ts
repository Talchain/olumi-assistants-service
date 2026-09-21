/**
 * @talchain/schemas 0.22.0 — B1 ingress-surface acceptance pins (CEE row 1.181).
 *
 * The 0.22.0 re-vendor widens the INGRESS contract with four new turn-payload
 * fields. B1 (`validateIngress`) derives its accepted surface directly from the
 * vendored `OrchestratorTurnPayloadSchema`, which is `.strict()` and fail-closed
 * (Boundary Contract v1.1 §3.2): an unknown key or an out-of-vocabulary literal
 * 422s the WHOLE turn, not just the offending field. So every field a producer
 * will send has to be ACCEPTED here FIRST — the accept-half of the landing
 * handshake — before the UI's S2/S3 sends land. This is the same MIRROR hazard
 * the action-type-vocabulary pin covers: a contract widening no other test sees.
 *
 * This suite proves CEE now ACCEPTS each new 0.22.0 ingress field. It does NOT
 * route them — the chip.intent router and the feedback / batched-edit handlers
 * are the S2+S3 CEE lanes, later. Un-routed accepted fields must fall through
 * benignly (final describe block).
 *
 * New in 0.22.0 over 0.21.0 (verified by direct 0.21↔0.22 tarball diff):
 *   - chip.id             optional string on the message-turn chip
 *   - chip.intent         optional 11-value Intent enum on the chip
 *   - system_event feedback member   rating / target / comment
 *   - direct_graph_edit batch fields  changed_node_ids, changed_edge_ids,
 *                                     operations, fields_changed, summary
 * (`system_event` as a turn kind already existed at 0.21.0; 0.22.0 adds the
 * feedback member and the batch fields to it.)
 *
 * Doctrine (matches action-type-vocabulary-pin.test.ts): direct calls to the
 * real `validateIngress`. No fixtures, no network, no service. Every acceptance
 * carries a discrimination control so it cannot pass vacuously — the same
 * validator demonstrably 422s a near-miss.
 */
import { describe, expect, it } from 'vitest'

import { validateIngress } from '../../src/validators/b1.js'

const TURN_ID = '11111111-1111-4111-8111-111111111111'
const SCENARIO_ID = '22222222-2222-4222-8222-222222222222'

/** A minimal, schema-valid chip-sourced message turn; caller supplies the chip. */
function chipMessageTurn(chip: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message: 'Prepare first analysis.',
    turn_class: 'frame',
    stage: 'analyse',
    // `chip` is only allowed when source is 'chip' | 'chip_click' (union refinement).
    source: 'chip_click',
    chip,
  }
}

/** A minimal, schema-valid system_event turn; caller supplies the event. */
function systemEventTurn(event: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'system_event',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event,
  }
}

describe('B1 ingress accepts chip.id (0.22.0 — first-class chip identity)', () => {
  it('validateIngress ACCEPTS a chip carrying id', () => {
    const result = validateIngress(
      chipMessageTurn({ id: 'chip-abc123', action_type: 'run_analysis' }),
      'req-chip-id-accept',
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.value as { chip?: { id?: string } }).chip?.id).toBe('chip-abc123')
    }
  })

  // DISCRIMINATION CONTROL. The chip object is `.strict()`, so an unknown
  // sibling key must 422. That proves `id` is accepted because it is a DECLARED
  // field in 0.22.0, not because the chip waves unknown keys through.
  it('validateIngress REJECTS an unknown chip key (chip is strict — acceptance is not vacuous)', () => {
    const result = validateIngress(
      chipMessageTurn({ id: 'chip-abc123', not_a_chip_field: true }),
      'req-chip-id-strict',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.error).toBe('INGRESS_CONTRACT_VIOLATION')
      expect(result.error.boundary).toBe('B1')
      expect(result.error.direction).toBe('ingress')
    }
  })
})

describe('B1 ingress accepts chip.intent (0.22.0 — typed Intent enum)', () => {
  it('validateIngress ACCEPTS a chip carrying a valid intent', () => {
    const result = validateIngress(chipMessageTurn({ intent: 'elicit_options' }), 'req-chip-intent-accept')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.value as { chip?: { intent?: string } }).chip?.intent).toBe('elicit_options')
    }
  })

  // DISCRIMINATION CONTROL — an intent outside the Intent enum must 422
  // fail-closed, so the acceptance above is a property of the real vocabulary.
  it('validateIngress REJECTS an out-of-vocabulary intent (fail-closed on the enum)', () => {
    const result = validateIngress(chipMessageTurn({ intent: 'not_a_real_intent' }), 'req-chip-intent-bad')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.error).toBe('INGRESS_CONTRACT_VIOLATION')
      expect(result.error.boundary).toBe('B1')
    }
  })
})

describe('B1 ingress accepts the feedback system event (0.22.0 — typed feedback)', () => {
  it('validateIngress ACCEPTS a system_event turn carrying a feedback event', () => {
    const result = validateIngress(
      systemEventTurn({
        kind: 'feedback',
        rating: 'up',
        target: { id: 'block-1', kind: 'block' },
        comment: 'This was useful.',
      }),
      'req-feedback-accept',
    )
    expect(result.ok).toBe(true)
  })

  // DISCRIMINATION CONTROL — the rating is a two-value enum (`up` | `down`); an
  // out-of-vocabulary rating must 422, proving the feedback member really is
  // validated rather than passed through untyped.
  it('validateIngress REJECTS a feedback event with an out-of-vocabulary rating (fail-closed)', () => {
    const result = validateIngress(
      systemEventTurn({
        kind: 'feedback',
        rating: 'sideways',
        target: { id: 'block-1', kind: 'block' },
      }),
      'req-feedback-bad',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.error).toBe('INGRESS_CONTRACT_VIOLATION')
      expect(result.error.boundary).toBe('B1')
    }
  })
})

describe('B1 ingress accepts batched direct_graph_edit fields (0.22.0)', () => {
  it('validateIngress ACCEPTS a direct_graph_edit event carrying every batch field', () => {
    const result = validateIngress(
      systemEventTurn({
        kind: 'direct_graph_edit',
        target_id: 'node-1',
        operation: 'update',
        changed_node_ids: ['node-1', 'node-2'],
        changed_edge_ids: ['edge-1'],
        operations: ['update', 'add'],
        fields_changed: ['label', 'weight'],
        summary: 'Renamed two nodes and reweighted an edge.',
      }),
      'req-batch-edit-accept',
    )
    expect(result.ok).toBe(true)
  })

  // DISCRIMINATION CONTROL — the direct_graph_edit event is `.strict()`; an
  // unknown key must 422, proving the batch fields are accepted because they are
  // DECLARED in 0.22.0, not because the event waves unknown keys through.
  it('validateIngress REJECTS an unknown direct_graph_edit key (event is strict — acceptance is not vacuous)', () => {
    const result = validateIngress(
      systemEventTurn({
        kind: 'direct_graph_edit',
        target_id: 'node-1',
        operation: 'update',
        not_a_batch_field: ['x'],
      }),
      'req-batch-edit-strict',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.error).toBe('INGRESS_CONTRACT_VIOLATION')
      expect(result.error.boundary).toBe('B1')
    }
  })
})

describe('un-routed 0.22.0 ingress fields fall through benignly (routing lands with S2+S3)', () => {
  // "Completes normally" at the ingress seam: the turn is ACCEPTED (ok:true, no
  // 422) and the new intent survives the strict parse WITHOUT displacing the
  // existing routing key — `action_type` stays undefined. CEE's V5 dispatch keys
  // off `action_type`, so an intent-only chip carries no directive the
  // un-updated router can trip on; it flows down the normal message path.
  // Routing off `intent` is the S2 lane, deliberately not built here.
  it('a chip.intent-carrying turn completes ingress normally — no crash, no 422', () => {
    const result = validateIngress(chipMessageTurn({ intent: 'discuss' }), 'req-intent-fallthrough')
    expect(result.ok).toBe(true)
    if (result.ok) {
      const chip = (result.value as { chip?: { intent?: string; action_type?: string } }).chip
      expect(chip?.intent).toBe('discuss') // the new field survives the strict parse
      expect(chip?.action_type).toBeUndefined() // the existing routing key is untouched
    }
  })
})
