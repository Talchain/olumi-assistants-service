import { describe, expect, it } from 'vitest';
import { prepareComparison } from './prepare-comparison.js';
import { composeAnalysisInterpreterV02 } from '../../src/orchestrator-v5/agent-lane/prompt-profiles/analysis-interpreter-v02.js';

function fixture() {
  return {
    source_head: '9af274b1f3f2f63cc74ed397b6b6dc46550a3d83',
    evidence: 'synthetic upstream; real FP3 request serialisation' as const,
    captures: [{
      case_id: 'known-stale',
      request: {
        instructions: composeAnalysisInterpreterV02('Existing baseline; unchanged.').instructions,
        input: [{ type: 'function_call_output', call_id: 'run-7', output: JSON.stringify({ result: { computed_against_hash: 'r7' }, canonical_state: { analysis_state: { run_state: { kind: 'complete_stale' } } } }) }],
        tool_choice: 'none', model: 'supplied-model', max_output_tokens: 400,
      },
      expected: ['SCORER_ONLY_SENTINEL: historical result, no invented effect'],
    }],
  };
}

describe('offline matched Interpreter comparison preparation', () => {
  it('preserves stale provenance and every non-instruction request field across arms, without leaking the answer rubric', () => {
    const input = fixture();
    const original = structuredClone(input);
    const { samples, scoring, manifest } = prepareComparison(input);
    expect(samples).toHaveLength(2);
    for (const sample of samples) {
      expect({ ...sample.request, instructions: undefined }).toEqual({ ...input.captures[0].request, instructions: undefined });
      expect(JSON.stringify(sample.request)).not.toContain('SCORER_ONLY_SENTINEL');
    }
    expect(samples[0].request.instructions).not.toBe(samples[1].request.instructions);
    expect(scoring[0].expected).toContain(input.captures[0].expected[0]);
    expect(manifest[0].input_sha256).toBe(manifest[1].input_sha256);
    expect(manifest[0].instructions_sha256).not.toBe(manifest[1].instructions_sha256);
    expect(input).toEqual(original);
  });
  it('refuses a tool-enabled request or a silently changed baseline/profile boundary', () => {
    const input = fixture();
    input.captures[0].request.tool_choice = 'auto';
    expect(() => prepareComparison(input)).toThrow(/answer-only/);
    input.captures[0].request.tool_choice = 'none';
    input.captures[0].request.instructions += 'untracked instruction';
    expect(() => prepareComparison(input)).toThrow(/exact banked/);
  });
  it('refuses duplicate case identities rather than producing ambiguous scores', () => {
    const input = fixture();
    input.captures.push(structuredClone(input.captures[0]));
    expect(() => prepareComparison(input)).toThrow(/unique ID/);
  });
  it('counterbalances arm order and keeps the version key out of the scoring guide', () => {
    const input = fixture();
    input.captures.push({ ...structuredClone(input.captures[0]), case_id: 'second' });
    const { scoring, manifest } = prepareComparison(input);
    expect(manifest.map(x => x.profile_version)).toEqual(['0.2', '0.3-candidate', '0.3-candidate', '0.2']);
    expect(JSON.stringify(scoring)).not.toContain('profile_version');
  });
});
