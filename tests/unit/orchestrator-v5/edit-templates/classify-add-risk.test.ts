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

  it('matches "Team dynamics is a risk we should consider"', () => {
    const result = classifyAddRiskIntent('Team dynamics is a risk we should consider', emptyGraph());
    expect(result).toEqual({ intent: 'add_risk', label: 'Team dynamics', confidence: 'high' });
  });

  it('matches "We should add supply chain risk"', () => {
    const result = classifyAddRiskIntent('We should add supply chain risk', emptyGraph());
    expect(result).toEqual({ intent: 'add_risk', label: 'supply chain', confidence: 'high' });
  });

  it('rejects pronoun labels: "this"', () => {
    expect(classifyAddRiskIntent('add this as a risk', emptyGraph())).toEqual({ intent: 'llm_required' });
  });

  it('rejects pronoun labels: "that"', () => {
    expect(classifyAddRiskIntent('that is a risk', emptyGraph())).toEqual({ intent: 'llm_required' });
  });

  it('rejects pronoun labels: "it"', () => {
    expect(classifyAddRiskIntent("It is a risk", emptyGraph())).toEqual({ intent: 'llm_required' });
  });

  it('rejects pronoun labels: "these"', () => {
    expect(classifyAddRiskIntent('These is a risk', emptyGraph())).toEqual({ intent: 'llm_required' });
  });

  it('rejects pronoun labels: "those"', () => {
    expect(classifyAddRiskIntent('Those is a risk', emptyGraph())).toEqual({ intent: 'llm_required' });
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
