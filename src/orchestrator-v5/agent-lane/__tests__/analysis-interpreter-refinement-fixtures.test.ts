import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface FixtureInput {
  question: string;
  run_result: {
    ok: boolean;
    ran: boolean;
    status: string;
    result: { computed_against_hash: string } | null;
    canonical_state: { analysis_state: {
      run_state: { kind: string };
      leader_claim: { permitted: boolean; withheld_reason?: string };
    } };
  };
  context: {
    transport_status?: number;
    constraints: { requested: boolean; items: { operator: string; status: string }[] };
    assumptions: { raw_value: number; origin: string; adoption: string; evidence_status: string }[];
    available_actions: string[];
    action_support?: { edit_existing_factor: boolean; rerun: boolean };
    comparison?: {
      before_revision: string;
      after_revision: string;
      precomputed_delta: { option_deltas: Record<string, number>; ordering_changed: boolean; material_change: boolean };
    };
    presentation: { result_card: string; contents?: string };
  };
}
interface FixtureCase {
  id: string;
  contrast_group: string;
  input: FixtureInput;
  expected: { must: string[]; avoid: string[]; soft_max_words?: number };
}
const fixture = JSON.parse(readFileSync(new URL(
  '../../../../Docs/evals/interpreter/paul-concision-contrasts-20260924.json', import.meta.url,
), 'utf8')) as { cases: FixtureCase[] };
const find = (id: string): FixtureCase => {
  const found = fixture.cases.find((item) => item.id === id);
  if (!found) throw new Error(`Missing contrast case ${id}`);
  return found;
};

// Fixture integrity only: no assertion here evaluates a generated answer.
describe('Interpreter refinement contrasts remain discriminating', () => {
  it('keeps unique pairs and scoring instructions outside the model input', () => {
    expect(new Set(fixture.cases.map((item) => item.id)).size).toBe(fixture.cases.length);
    const pairs = new Map<string, number>();
    for (const item of fixture.cases) {
      pairs.set(item.contrast_group, (pairs.get(item.contrast_group) ?? 0) + 1);
      expect(item.expected.must.length).toBeGreaterThan(0);
      expect(item.expected.avoid.length).toBeGreaterThan(0);
      expect(item.input).not.toHaveProperty('expected');
      expect(item.input).not.toHaveProperty('soft_max_words');
    }
    expect([...pairs.values()]).toEqual(Array(7).fill(2));
  });

  it('changes the requested detail, not the analysis, in the concision pair', () => {
    const brief = find('PC01_brief_material_limit');
    const detail = find('PC02_requested_detail');
    expect(brief.input.question).not.toBe(detail.input.question);
    expect(brief.input.run_result).toEqual(detail.input.run_result);
    expect(brief.input.context).toEqual(detail.input.context);
    expect(brief.expected.soft_max_words).toBeDefined();
    expect(detail.expected.soft_max_words).toBeUndefined();
  });

  it('distinguishes a domain block from completion despite identical transport success', () => {
    const blocked = find('PC03_http_success_domain_block').input;
    const completed = find('PC04_http_success_completed').input;
    expect(blocked.context.transport_status).toBe(200);
    expect(completed.context.transport_status).toBe(200);
    expect(blocked.run_result.ok).toBe(true);
    expect(completed.run_result.ok).toBe(true);
    expect(blocked.run_result.ran).toBe(false);
    expect(blocked.run_result.result).toBeNull();
    expect(blocked.run_result.canonical_state.analysis_state.run_state.kind).toBe('never_run');
    expect(completed.run_result.ran).toBe(true);
    expect(completed.run_result.canonical_state.analysis_state.run_state.kind).toBe('complete_current');
  });

  it('does not make the generic withheld reason identify a constraint', () => {
    const absent = find('PC05_no_constraints_requested').input;
    const known = find('PC06_known_unassessed_constraint').input;
    expect(absent.run_result).toEqual(known.run_result);
    expect(absent.context.constraints).toEqual({ requested: false, items: [] });
    expect(known.context.constraints.items).toMatchObject([{ operator: '<', status: 'not_evaluated' }]);
  });

  it('holds the native figure constant while distinguishing origin and evidence status', () => {
    const adopted = find('PC07_approved_estimate').input.context.assumptions[0];
    const measured = find('PC08_supplied_measurement').input.context.assumptions[0];
    expect(adopted.raw_value).toBe(measured.raw_value);
    expect(adopted).toMatchObject({ origin: 'ai_proposed', adoption: 'user_approved', evidence_status: 'estimate' });
    expect(measured).toMatchObject({ origin: 'customer_survey', evidence_status: 'measured' });
  });

  it('includes a genuinely changed input with zero supplied effect and a positive effect contrast', () => {
    const zero = find('PC09_changed_input_zero_effect').input.context.comparison!;
    const effect = find('PC10_changed_input_supplied_effect').input.context.comparison!;
    expect(zero.before_revision).not.toBe(zero.after_revision);
    expect(Object.values(zero.precomputed_delta.option_deltas).every((value) => value === 0)).toBe(true);
    expect(zero.precomputed_delta.material_change).toBe(false);
    expect(effect.precomputed_delta.option_deltas.A).toBe(-2);
    expect(effect.precomputed_delta.ordering_changed).toBe(false);
    expect(effect.precomputed_delta.material_change).toBe(true);
  });

  it('holds the requested edit and current result constant while changing action support', () => {
    const unsupported = find('PC11_unsupported_edit_rerun').input;
    const supported = find('PC12_supported_edit_guidance').input;
    expect(unsupported.question).toBe(supported.question);
    expect(unsupported.run_result).toEqual(supported.run_result);
    expect(unsupported.context.available_actions).toEqual([]);
    expect(unsupported.context.action_support?.edit_existing_factor).toBe(false);
    expect(supported.context.available_actions).toEqual(['edit_existing_factor', 'run_analysis']);
  });

  it('changes only supplied presentation evidence in the card-visibility pair', () => {
    const unknown = find('PC13_card_visibility_unknown').input;
    const visible = find('PC14_card_confirmed_visible').input;
    expect(unknown.question).toBe(visible.question);
    expect(unknown.run_result).toEqual(visible.run_result);
    expect(unknown.context.presentation).toEqual({ result_card: 'unknown' });
    expect(visible.context.presentation.result_card).toBe('confirmed_visible');
    const { presentation: _unknownPresentation, ...unknownContext } = unknown.context;
    const { presentation: _visiblePresentation, ...visibleContext } = visible.context;
    expect(unknownContext).toEqual(visibleContext);
  });
});
