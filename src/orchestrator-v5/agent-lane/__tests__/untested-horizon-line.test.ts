import { describe, expect, it } from 'vitest';
import {
  decisionInputLines,
  GOAL_HORIZON_NOT_TESTED,
  UNTESTED_HORIZON_PREFIXES,
  untestedHorizonLine,
  withA7AfterGate,
  withUntestedHorizonWarning,
} from '../decision-input-ask.js';

type Rec = Record<string, unknown>;
const graphWith = (over: Rec = {}) => ({ nodes: [{
  id: 'goal', kind: 'goal', label: 'Monthly recurring revenue', provenance: 'from_brief',
  goal_threshold_raw: 20000, goal_threshold_unit: '£/month', goal_horizon_months: 12,
  ...over,
}], edges: [] });
const FULL = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach £20,000 within 12 months.";
const NO_TARGET = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll get there within 12 months.";
const PLURAL = "These chances use the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach £20,000 within 12 months.";
const SHORT = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet.";
const PLURAL_SHORT = "These chances use the model's numbers as they are today; the model doesn't project how they change over time yet.";

describe('ONE reply horizon clause: exact held-target and present-number wording', () => {
  it('B1 Paul: the full sentence is byte-exact and strips only the money period from its target', () => {
    expect(untestedHorizonLine(graphWith(), { besideChance: true })).toBe(FULL);
    expect(untestedHorizonLine(graphWith())).toBe(FULL);
  });

  it('no stated target + held months uses the no-target form', () => {
    expect(untestedHorizonLine(graphWith({ goal_threshold_raw: undefined }), { besideChance: true })).toBe(NO_TARGET);
  });

  it('two options’ chances use the exact plural form', () => {
    expect(untestedHorizonLine(graphWith(), { besideChance: true, plural: true })).toBe(PLURAL);
  });

  it('B3 by Q3 without a month count uses the short form only beside a chance', () => {
    const graph = graphWith({ goal_horizon_months: undefined, goal_deadline_as_stated: 'by Q3' });
    expect(untestedHorizonLine(graph, { besideChance: true })).toBe(SHORT);
    expect(untestedHorizonLine(graph)).toBeNull();
  });

  it('no deadline uses the short form beside a chance, including plural', () => {
    const graph = graphWith({ goal_horizon_months: undefined });
    expect(untestedHorizonLine(graph, { besideChance: true })).toBe(SHORT);
    expect(untestedHorizonLine(graph, { besideChance: true, plural: true })).toBe(PLURAL_SHORT);
  });

  it.each([0, -1, Number.NaN])('a non-positive or unknown month count (%s) keeps the short form beside a chance', (goal_horizon_months) => {
    const graph = graphWith({ goal_horizon_months });
    expect(untestedHorizonLine(graph, { besideChance: true })).toBe(SHORT);
    expect(untestedHorizonLine(graph)).toBeNull();
  });

  it('hiring uses its own held target and unit', () => {
    const graph = graphWith({ label: 'Hire engineers', goal_threshold_raw: 6, goal_threshold_unit: 'engineers', goal_horizon_months: 9 });
    expect(untestedHorizonLine(graph, { besideChance: true })).toBe("This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach 6 engineers within 9 months.");
  });

  it('a target with no unit is bare and a one-month horizon is singular', () => {
    expect(untestedHorizonLine(graphWith({ goal_threshold_raw: 6, goal_threshold_unit: undefined, goal_horizon_months: 1 }))).toBe("This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach 6 within 1 month.");
  });

  it('reads the target from the goal’s own limit row through the shared target reader', () => {
    for (const unit of ['GBP', '£/month']) {
      const graph = { ...graphWith({ goal_threshold_raw: undefined }), goal_constraints: [
        { node_id: 'goal', label: 'Monthly recurring revenue', value: 20000, unit, operator: '>=' },
      ] };
      expect(untestedHorizonLine(graph), unit).toBe(FULL);
      expect(untestedHorizonLine(graph, { besideChance: true }), unit).toBe(FULL);
    }
  });

  it('a duration limit suppresses the full form while a chance still owes the short form', () => {
    const graph = { ...graphWith(), goal_constraints: [{ node_id: 'duration', value: 12, unit: 'months', operator: '<=' }] };
    expect(untestedHorizonLine(graph)).toBeNull();
    expect(untestedHorizonLine(graph, { besideChance: true })).toBe(SHORT);
  });

  it('draft without a chance and no held months owes no short form or Run warning', () => {
    const graph = graphWith({ goal_horizon_months: undefined });
    const context = { restingText: 'Draft ready.', builtOrRan: true, awaitingApproval: false, questionsToggle: false };
    expect(decisionInputLines(graph, context)).toEqual([]);
    const envelope = { inference_warnings: [] };
    expect(withUntestedHorizonWarning(envelope, graph)).toBe(envelope);
  });

  it('chat A7 and Run warning keep the held-month trigger and inherit the exact full line', () => {
    const graph = graphWith();
    expect(decisionInputLines(graph, { restingText: 'Draft ready.', builtOrRan: true, awaitingApproval: false, questionsToggle: false })).toEqual([FULL]);
    expect(withUntestedHorizonWarning({ inference_warnings: [] }, graph).inference_warnings).toEqual([
      { code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: FULL, node_ids: ['goal'] },
    ]);
  });

  it('a Run with multiple chance lines gives its host the same plural fact without changing the warning default', () => {
    const graph = graphWith();
    expect(decisionInputLines(graph, {
      restingText: 'Run ready.', builtOrRan: true, awaitingApproval: false, questionsToggle: false, horizonPlural: true,
    })).toEqual([PLURAL]);
    expect(withA7AfterGate('Run ready.\n\nSaved.', graph, {
      builtOrRan: true, awaitingApproval: false, horizonPlural: true,
    }, 'Saved.')).toBe(`Run ready.\n\n${PLURAL}\n\nSaved.`);
    expect(withUntestedHorizonWarning({ inference_warnings: [] }, graph).inference_warnings).toEqual([
      { code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: FULL, node_ids: ['goal'] },
    ]);
  });

  it('no single goal means no clause even beside a chance', () => {
    for (const nodes of [[], [...graphWith().nodes, { id: 'other', kind: 'goal' }]]) {
      expect(untestedHorizonLine({ nodes, edges: [] }, { besideChance: true })).toBeNull();
    }
  });

  it('the exported identification pair is exact, with straight apostrophes', () => {
    expect(UNTESTED_HORIZON_PREFIXES).toEqual([
      "This chance uses the model's numbers as they are today",
      "These chances use the model's numbers as they are today",
    ]);
  });
});
