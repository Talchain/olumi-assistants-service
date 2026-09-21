import { describe, it, expect } from "vitest";
import { buildAddRiskClarification } from "../../../../src/orchestrator-v5/handlers/edit-templates/add-risk-template.js";

describe('buildAddRiskClarification', () => {
  it('asks what factor drives the risk without saying a graph edit was applied', () => {
    const text = buildAddRiskClarification('team dynamics');

    expect(text).toBe(
      'I can add ‘Team dynamics’ as a risk. What factor drives it most — for example team size, hiring pace, or onboarding complexity?',
    );
    expect(text).toContain('What factor drives it most');
    expect(text).not.toMatch(/I(?:'|’)ve added/i);
    expect(text).not.toMatch(/connected/i);
  });

  it('normalises display whitespace and preserves user-facing label casing', () => {
    expect(buildAddRiskClarification('  market   competition  ')).toContain('‘Market competition’');
    expect(buildAddRiskClarification('Team dynamics')).toContain('‘Team dynamics’');
  });

  it('contains no raw IDs, topology language, operation counts, patch, schema, or Zod terms', () => {
    const text = buildAddRiskClarification('team dynamics');

    expect(text).not.toMatch(/risk_team_dynamics/);
    expect(text).not.toMatch(/\b(?:decision|node|edge|topology|graph mechanics)\b/i);
    expect(text).not.toMatch(/\boperation\b/i);
    expect(text).not.toMatch(/\bpatch\b/i);
    expect(text).not.toMatch(/\bschema\b/i);
    expect(text).not.toMatch(/\bzod\b/i);
    expect(text).not.toMatch(/\b\d+\s*(?:operation|edge|node)/i);
  });
});
