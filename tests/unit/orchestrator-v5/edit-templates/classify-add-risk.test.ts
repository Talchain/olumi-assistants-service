import { describe, it, expect } from "vitest";
import { classifyAddRiskIntent, riskNodeIdFor } from "../../../../src/orchestrator-v5/handlers/edit-templates/classify-add-risk.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";

const emptyGraph = (): GraphV3T => ({
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Reach 1000 users' },
    { id: 'dec_1', kind: 'decision', label: 'Pricing model' },
  ],
  edges: [],
} as unknown as GraphV3T);

describe('classifyAddRiskIntent', () => {
  it('matches "Add team dynamics as a risk"', () => {
    const result = classifyAddRiskIntent('Add team dynamics as a risk', emptyGraph());
    expect(result).toEqual({ intent: 'add_risk', label: 'team dynamics', confidence: 'high' });
  });

  it('matches "Please add market competition as a risk"', () => {
    const result = classifyAddRiskIntent('Please add market competition as a risk', emptyGraph());
    expect(result).toEqual({ intent: 'add_risk', label: 'market competition', confidence: 'high' });
  });

  it('matches "Include cyber attacks as a risk"', () => {
    const result = classifyAddRiskIntent('Include cyber attacks as a risk', emptyGraph());
    expect(result).toEqual({ intent: 'add_risk', label: 'cyber attacks', confidence: 'high' });
  });

  // Statements of the form "X is a risk" intentionally fall through to the
  // LLM path. The earlier draft accepted this form via a leading-anchor-less
  // pattern that captured arbitrary preamble — e.g. "I think team dynamics
  // is a risk" produced label "I think team dynamics". Retired in favour of
  // the explicit verb-anchored forms below.
  it('falls through on "Team dynamics is a risk" (no leading verb anchor)', () => {
    expect(
      classifyAddRiskIntent('Team dynamics is a risk', emptyGraph()),
    ).toEqual({ intent: 'llm_required' });
  });

  it('falls through on "Team dynamics is a risk we should consider"', () => {
    expect(
      classifyAddRiskIntent('Team dynamics is a risk we should consider', emptyGraph()),
    ).toEqual({ intent: 'llm_required' });
  });

  it('matches "We should add supply chain risk"', () => {
    const result = classifyAddRiskIntent('We should add supply chain risk', emptyGraph());
    expect(result).toEqual({ intent: 'add_risk', label: 'supply chain', confidence: 'high' });
  });

  it('rejects pronoun labels: "this"', () => {
    expect(classifyAddRiskIntent('add this as a risk', emptyGraph())).toEqual({ intent: 'llm_required' });
  });

  it('rejects pronoun labels: "it"', () => {
    expect(classifyAddRiskIntent('add it as a risk', emptyGraph())).toEqual({ intent: 'llm_required' });
  });

  it('rejects pronoun labels: "these"', () => {
    expect(classifyAddRiskIntent('add these as a risk', emptyGraph())).toEqual({ intent: 'llm_required' });
  });

  it('rejects pronoun labels: "those"', () => {
    expect(classifyAddRiskIntent('add those as a risk', emptyGraph())).toEqual({ intent: 'llm_required' });
  });

  // Regression: filler-preamble variants of the retired "X is a risk" form
  // must NOT match any verb-anchored pattern. Locks in the pattern-4 retirement.
  it('falls through on "I think X is a risk" (no longer captures preamble)', () => {
    expect(
      classifyAddRiskIntent('I think team dynamics is a risk', emptyGraph()),
    ).toEqual({ intent: 'llm_required' });
  });

  it('falls through on "But really X is a risk"', () => {
    expect(
      classifyAddRiskIntent('But really team dynamics is a risk', emptyGraph()),
    ).toEqual({ intent: 'llm_required' });
  });

  it('falls through on "I worry that X is a risk"', () => {
    expect(
      classifyAddRiskIntent('I worry that team dynamics is a risk', emptyGraph()),
    ).toEqual({ intent: 'llm_required' });
  });

  it('rejects short labels (< 3 chars)', () => {
    expect(classifyAddRiskIntent('add ai as a risk', emptyGraph())).toEqual({ intent: 'llm_required' });
  });

  it('rejects labels longer than 80 chars', () => {
    const longLabel = 'a'.repeat(85);
    expect(classifyAddRiskIntent(`add ${longLabel} as a risk`, emptyGraph())).toEqual({ intent: 'llm_required' });
  });

  it('rejects existing risk node (deterministic ID collision)', () => {
    const graph: GraphV3T = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Goal' },
        { id: 'dec_1', kind: 'decision', label: 'Decision' },
        { id: 'risk_team_dynamics', kind: 'risk', label: 'Team dynamics' },
      ],
      edges: [],
    } as unknown as GraphV3T;
    expect(classifyAddRiskIntent('add team dynamics as a risk', graph)).toEqual({ intent: 'llm_required' });
  });

  it('does not match meta questions ("What about team dynamics?")', () => {
    expect(classifyAddRiskIntent('What about team dynamics?', emptyGraph())).toEqual({ intent: 'llm_required' });
  });

  it('does not match "add X as a factor"', () => {
    expect(classifyAddRiskIntent('Add team dynamics as a factor', emptyGraph())).toEqual({ intent: 'llm_required' });
  });

  it('does not match value-update phrasings ("Set churn to 5%")', () => {
    expect(classifyAddRiskIntent('Set churn to 5%', emptyGraph())).toEqual({ intent: 'llm_required' });
  });

  it('does not match edge-strength phrasings ("Make the link stronger")', () => {
    expect(classifyAddRiskIntent('Make the link stronger', emptyGraph())).toEqual({ intent: 'llm_required' });
  });

  // ---- Compound / trailing-clause guards (Commit 4) ----

  it('falls through on compound: "Add X as a risk and connect it to Y"', () => {
    expect(
      classifyAddRiskIntent('Add team dynamics as a risk and connect it to churn', emptyGraph()),
    ).toEqual({ intent: 'llm_required' });
  });

  it('falls through on compound: "Add X as a risk, then link it to Y"', () => {
    expect(
      classifyAddRiskIntent('Add team dynamics as a risk, then link it to churn', emptyGraph()),
    ).toEqual({ intent: 'llm_required' });
  });

  it('falls through on compound: "Add X as a risk with a stronger link"', () => {
    expect(
      classifyAddRiskIntent('Add team dynamics as a risk with a stronger link', emptyGraph()),
    ).toEqual({ intent: 'llm_required' });
  });

  it('falls through on compound: "Include X as a risk and adjust the bridge"', () => {
    expect(
      classifyAddRiskIntent('Include market competition as a risk and adjust the bridge', emptyGraph()),
    ).toEqual({ intent: 'llm_required' });
  });

  it('still accepts trailing period / exclamation / question mark', () => {
    expect(classifyAddRiskIntent('Add team dynamics as a risk.', emptyGraph()).intent).toBe('add_risk');
    expect(classifyAddRiskIntent('Add team dynamics as a risk!', emptyGraph()).intent).toBe('add_risk');
  });

  // ---- Sanitisation guards (Commit 4) ----

  it('rejects label with control characters', () => {
    expect(
      classifyAddRiskIntent('add teamdynamics as a risk', emptyGraph()),
    ).toEqual({ intent: 'llm_required' });
  });

  it('rejects label with zero-width / BiDi characters', () => {
    expect(
      classifyAddRiskIntent('add team​dynamics as a risk', emptyGraph()),
    ).toEqual({ intent: 'llm_required' });
  });

  it('rejects label with excessive punctuation density', () => {
    expect(
      classifyAddRiskIntent('add !!!!!!!!! as a risk', emptyGraph()),
    ).toEqual({ intent: 'llm_required' });
  });

  it('runs in under 5ms for typical inputs', () => {
    const graph = emptyGraph();
    const start = process.hrtime.bigint();
    for (let i = 0; i < 100; i++) {
      classifyAddRiskIntent('Add team dynamics as a risk', graph);
    }
    const elapsedNs = Number(process.hrtime.bigint() - start);
    const perCallMs = elapsedNs / 100 / 1_000_000;
    expect(perCallMs).toBeLessThan(5);
  });
});

describe('riskNodeIdFor', () => {
  it('slugifies multi-word labels', () => {
    expect(riskNodeIdFor('team dynamics')).toBe('risk_team_dynamics');
  });

  it('lowercases capitals', () => {
    expect(riskNodeIdFor('Market Competition')).toBe('risk_market_competition');
  });

  it('collapses non-alphanumeric runs', () => {
    expect(riskNodeIdFor('cyber-attacks/breaches!')).toBe('risk_cyber_attacks_breaches');
  });

  it('caps slug at 40 chars', () => {
    const long = 'a'.repeat(80);
    const id = riskNodeIdFor(long);
    expect(id.length).toBeLessThanOrEqual(45); // "risk_" + 40
  });
});
