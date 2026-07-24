/**
 * Decision Records — knowledge-over-time projection + loader (ROADMAP 1.199, P6).
 *
 * Proves the READ slice is bounded + DISCLOSED (the enforced cut fires — a
 * positive control, trap #13), scenario-scoped, provenance-stamped, and
 * fire-safe. The projection is the cut site that makes the coach_converse
 * `older_relevant_facts` policy row honestly `enforced`.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  projectDecisionRecords,
  loadOlderRelevantFactsSection,
} from '../project.js';
import { DECISION_RECORDS_HARD_CAP } from '../store-adapter.js';
import type { DecisionRecordRead } from '../store-adapter.js';
import { POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET } from '../../context/context-policy.js';

function makeRecord(overrides: Partial<DecisionRecordRead> & { option?: string; statement?: string; date?: string } = {}): DecisionRecordRead {
  const { option = 'Hire locally', statement = 'Local hiring leads on win probability (0.62).', date = '2026-07-24', ...rest } = overrides;
  return {
    record_id: rest.record_id ?? `rec_${Math.random().toString(36).slice(2)}`,
    scenario_id: rest.scenario_id ?? 'scen-1',
    created_at: rest.created_at ?? `${date}T10:00:00.000Z`,
    decision: rest.decision ?? { chosen_option_label: option, chosen_option_id: 'opt', graph_hash: 'aag_v1:sha256:x' },
    prediction: rest.prediction ?? { statement, confidence_source: 'model_derived' },
  };
}

describe('projectDecisionRecords — bounded, disclosed, provenance-stamped', () => {
  it('projects records newest-first with option + rationale + [date] provenance', () => {
    const records = [
      makeRecord({ option: 'Ship in Q3', statement: 'Q3 ship maximises revenue capture.', date: '2026-07-24' }),
      makeRecord({ option: 'Hire locally', statement: 'Local hiring leads on robustness.', date: '2026-07-20' }),
    ];
    const p = projectDecisionRecords(records, POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET);
    expect(p).not.toBeNull();
    expect(p!.includedCount).toBe(2);
    expect(p!.truncated).toBe(false);
    expect(p!.text).toContain('Ship in Q3');
    expect(p!.text).toContain('Hire locally');
    expect(p!.text).toContain('[2026-07-24]');
    expect(p!.text).toContain('Q3 ship maximises revenue capture.');
  });

  it('a turn-1 durable decision appears in the projection (acceptance-style)', () => {
    const turn1 = makeRecord({ option: 'Bootstrap first', statement: 'DURABLE-CONSTRAINT: keep runway ≥ 18 months.', date: '2026-07-01' });
    const laterNoise = Array.from({ length: 3 }, (_, i) =>
      makeRecord({ option: `Option ${i}`, statement: `later decision ${i}`, date: `2026-07-${10 + i}` }),
    );
    const p = projectDecisionRecords([...laterNoise, turn1], POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET);
    expect(p!.text).toContain('DURABLE-CONSTRAINT: keep runway ≥ 18 months.');
  });

  it('POSITIVE CONTROL — the enforced cut FIRES: over-budget records are dropped + DISCLOSED, and the text stays within budget', () => {
    // 8 records each ~220 chars of rationale — far over a tiny budget.
    const many = Array.from({ length: DECISION_RECORDS_HARD_CAP }, (_, i) =>
      makeRecord({ option: `Decision ${i}`, statement: 'x'.repeat(300), date: `2026-07-0${(i % 9) + 1}` }),
    );
    const tinyBudget = 600;
    const p = projectDecisionRecords(many, tinyBudget)!;
    expect(p.includedCount).toBeLessThan(DECISION_RECORDS_HARD_CAP); // some were dropped
    expect(p.truncated).toBe(true);
    expect(p.text).toMatch(/\[\+\d+ earlier decisions? omitted for length\]/); // disclosure present
    expect(p.text.length).toBeLessThanOrEqual(tinyBudget); // never exceeds budget
  });

  it('caps at DECISION_RECORDS_HARD_CAP even if more are passed', () => {
    const tooMany = Array.from({ length: DECISION_RECORDS_HARD_CAP + 5 }, (_, i) =>
      makeRecord({ option: `D${i}`, statement: `s${i}`, date: '2026-07-24' }),
    );
    const p = projectDecisionRecords(tooMany, 100_000)!;
    expect(p.includedCount).toBeLessThanOrEqual(DECISION_RECORDS_HARD_CAP);
  });

  it('returns null when NO record carries a usable option + statement', () => {
    const unusable = [
      makeRecord({ decision: { chosen_option_id: 'opt', graph_hash: 'x' } }), // no label
      makeRecord({ prediction: { confidence_source: 'model_derived' } }), // no statement
    ];
    expect(projectDecisionRecords(unusable, 3_000)).toBeNull();
    expect(projectDecisionRecords([], 3_000)).toBeNull();
  });

  it('caps a runaway single rationale so it cannot eat the whole budget', () => {
    const p = projectDecisionRecords([makeRecord({ statement: 'y'.repeat(5_000) })], 3_000)!;
    expect(p.truncated).toBe(true);
    expect(p.text).toContain('…');
    expect(p.text.length).toBeLessThanOrEqual(3_000);
  });
});

describe('loadOlderRelevantFactsSection — fire-safe read + project', () => {
  it('returns the projection text when the store yields records', async () => {
    const store = { retrieveRecords: vi.fn(async () => [makeRecord({ option: 'Chosen X', statement: 'because Y' })]) };
    const p = await loadOlderRelevantFactsSection({ store, scenarioId: 'scen-1', charBudget: 3_000 });
    expect(p?.text).toContain('Chosen X');
    // The loader hard-caps the read.
    expect(store.retrieveRecords).toHaveBeenCalledWith('scen-1', { limit: DECISION_RECORDS_HARD_CAP });
  });

  it('returns undefined when the scenario has no records (pack key absent → byte-identity)', async () => {
    const store = { retrieveRecords: vi.fn(async () => []) };
    expect(await loadOlderRelevantFactsSection({ store, scenarioId: 'scen-1', charBudget: 3_000 })).toBeUndefined();
  });

  it('NEVER throws — a store read fault degrades to undefined (the turn is unaffected)', async () => {
    const store = { retrieveRecords: vi.fn(async () => { throw new Error('supabase down'); }) };
    await expect(
      loadOlderRelevantFactsSection({ store, scenarioId: 'scen-1', charBudget: 3_000 }),
    ).resolves.toBeUndefined();
  });
});
