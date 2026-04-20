import { describe, expect, it } from 'vitest';
import { assembleContextPack } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

// End-to-end sanity: confirm parsed_quantities populated by CQE reaches the
// ContextPack produced by assembleContextPack(), preserving optional
// value_origin through serialisation. Covers brief §10 (liveness) and §8
// (code-path trace).

const basePayload: OrchestratorTurnPayload = {
  turn_id: '11111111-1111-4111-8111-111111111111',
  scenario_id: '22222222-2222-4222-8222-222222222222',
  message: 'placeholder',
  turn_class: 'handler',
  stage: 'evaluate',
};

describe('CQE end-to-end via assembleContextPack', () => {
  it('populates parsed_quantities for a quantity-bearing message', () => {
    const pack = assembleContextPack({
      payload: { ...basePayload, message: 'set churn to 5% and cost to 50000' },
      priorTurns: [],
    });
    expect(pack.parsed_quantities.length).toBeGreaterThan(0);
    const first = pack.parsed_quantities[0]!;
    expect(first.value).toBeCloseTo(0.05);
    expect(first.unit).toBe('percentage');
    expect(first.operator).toBe('set');
  });

  it('yields empty parsed_quantities for a quantity-free message', () => {
    const pack = assembleContextPack({
      payload: { ...basePayload, message: 'what about churn?' },
      priorTurns: [],
    });
    expect(pack.parsed_quantities).toEqual([]);
  });

  it('preserves value_origin after JSON.stringify (Sonnet serialisation path)', () => {
    const pack = assembleContextPack({
      payload: { ...basePayload, message: 'the budget is £150k' },
      priorTurns: [],
    });
    const serialised = JSON.stringify(pack, null, 2);
    const roundTripped = JSON.parse(serialised) as typeof pack;
    expect(roundTripped.parsed_quantities[0]?.value_origin).toBe(
      'suffix_expansion',
    );
    expect(serialised).toContain('"value_origin": "suffix_expansion"');
  });

  it('runs for non-action turns (coach / converse) just as for action turns', () => {
    const coachPack = assembleContextPack({
      payload: { ...basePayload, message: 'at least 3 developers', turn_class: 'direct_answer' as const },
      priorTurns: [],
    });
    expect(coachPack.parsed_quantities.length).toBeGreaterThan(0);
  });
});
