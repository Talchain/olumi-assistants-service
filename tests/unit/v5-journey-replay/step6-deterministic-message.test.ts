/**
 * Pin step 6's deterministic edit-message construction.
 *
 * Phase 1 of the staleness-after-edit fix brief replaced the non-
 * deterministic "Increase the budget factor." message with a message
 * that names the EXACT factor label parsed from step 1's draft graph.
 * This bypasses the orchestrator's "did you mean?" clarifier and
 * produces a real graph mutation — a precondition for steps 7-9 to
 * assert staleness against an actually-edited graph.
 *
 * The Phase 1 contract:
 *  - Prefer a factor whose label matches /(cost|budget|price|hiring|
 *    staffing|spend|invest)/i (the original brief intent).
 *  - Fall back to the first factor in `step1FactorLabels`.
 *  - Fall back to the original generic message when no factors were
 *    parsed (the step-6 mutation gate then fires and steps 7-9 skip).
 */

import { describe, expect, it } from 'vitest';

import { CANONICAL_STEPS, type JourneyContext } from '../../../tools/v5-journey-replay/steps.js';

function getStep6() {
  const step = CANONICAL_STEPS.find((s) => s.name === '6_edit_budget');
  if (!step) throw new Error('6_edit_budget step missing from CANONICAL_STEPS');
  return step;
}

function ctx(factorLabels: string[] | undefined): JourneyContext {
  return {
    scenario_id: '00000000-0000-0000-0000-000000000000',
    turn_counter: { value: 0 },
    step1FactorLabels: factorLabels,
  };
}

describe('step 6 — deterministic edit message construction', () => {
  it('prefers a hint-matching factor label (cost / budget / price / hiring / ...)', () => {
    const step = getStep6();
    const req = step.buildPayload(
      ctx(['Engineering Delivery Capacity', 'Hiring and Staffing Cost', 'Talent Market']),
    );
    expect(req.kind).toBe('turn');
    if (req.kind !== 'turn') throw new Error('expected turn');
    expect(req.payload.message).toBe('Set the Hiring and Staffing Cost factor to 0.7.');
  });

  it('matches "Incremental Hiring Cost" via the hint regex', () => {
    const step = getStep6();
    const req = step.buildPayload(ctx(['Incremental Hiring Cost', 'Talent Market']));
    if (req.kind !== 'turn') throw new Error('expected turn');
    expect(req.payload.message).toBe('Set the Incremental Hiring Cost factor to 0.7.');
  });

  it('falls back to the first factor when none match the hint regex', () => {
    const step = getStep6();
    const req = step.buildPayload(ctx(['Talent Market', 'Customer Mix']));
    if (req.kind !== 'turn') throw new Error('expected turn');
    expect(req.payload.message).toBe('Set the Talent Market factor to 0.7.');
  });

  it('falls back to the generic message when no factors were parsed', () => {
    const step = getStep6();
    const req = step.buildPayload(ctx([]));
    if (req.kind !== 'turn') throw new Error('expected turn');
    expect(req.payload.message).toBe('Increase the budget factor.');
  });

  it('falls back to the generic message when ctx.step1FactorLabels is undefined', () => {
    const step = getStep6();
    const req = step.buildPayload(ctx(undefined));
    if (req.kind !== 'turn') throw new Error('expected turn');
    expect(req.payload.message).toBe('Increase the budget factor.');
  });

  it('uses stage="frame", turn_class="frame", source="composer"', () => {
    const step = getStep6();
    const req = step.buildPayload(ctx(['Hiring Cost']));
    if (req.kind !== 'turn') throw new Error('expected turn');
    expect(req.payload.stage).toBe('frame');
    expect(req.payload.turn_class).toBe('frame');
    expect(req.payload.source).toBe('composer');
  });
});
