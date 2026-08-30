import assert from 'node:assert/strict';
import { parsePass2Response } from '../../src/cee/validation-pipeline/validate-graph.js';
import { runEnforcementLints } from '../../src/cee/validation-pipeline/enforcement-lints.js';
import { computeBiasOffsets, applyBiasCorrection } from '../../src/cee/validation-pipeline/bias-correction.js';
import { compareEdge } from '../../src/cee/validation-pipeline/comparison.js';
import type { Pass2Response } from '../../src/cee/validation-pipeline/types.js';
import type { EdgeV3T } from '../../src/schemas/cee-v3.js';
import { component, runContractProbe, runSemanticMutationFamily } from './contract.js';

// Pass 2 has no attached JSON schema. Do not invent one and call it live.
export const validationWireContract = () => ({ mode: 'json_object', attachedSchema: null } as const);
export { parsePass2Response };
export function validationSample(): Pass2Response {
  return { edges: ['capacity', 'demand', 'quality'].map((from, i) => ({
    from, to: 'goal', strength: { mean: 0.5, std: i === 0 ? 0.25 : 0.05 },
    exists_probability: 0.8, basis: 'domain_prior',
    reasoning: `Independent estimate of ${from}'s effect`, needs_user_input: false,
  })), model_notes: [] };
}

/** Real immediate semantic consumer, including the pipeline's bias correction. */
export function consumeValidation(parsed: Pass2Response, ignoreUncertainty = false) {
  const pass1 = parsed.edges.map(e => ({
    from: e.from, to: e.to, strength: { mean: 0.5, std: 0.05 }, exists_probability: 0.8,
  })) as EdgeV3T[];
  const linted = runEnforcementLints(parsed.edges);
  const bias = computeBiasOffsets(pass1, linted.edges);
  const adjusted = applyBiasCorrection(linted.edges, bias.offsets);
  // The mutation is local to the probe, never a production fallback.
  if (ignoreUncertainty) adjusted[0]!.strength.std = 0.05;
  return {
    offsets: bias.offsets,
    metadata: pass1.map((edge, i) => compareEdge(edge, linted.edges[i]!, adjusted[i]!, linted.lintLog, 1)),
  };
}

export function verifyValidationCarriage(
  result: ReturnType<typeof consumeValidation>, expected: Pass2Response = validationSample(),
): void {
  assert.equal(result.metadata.length, 3, 'the selected edges must participate');
  assert.equal(result.offsets.strength_std, 0, 'control edges must isolate uncertainty, not cancel it');
  result.metadata.forEach((m, i) => {
    assert.equal(m.pass2.strength_std, expected.edges[i]!.strength.std);
    assert.equal(m.pass2.reasoning, expected.edges[i]!.reasoning);
    assert.equal(m.pass2.basis, expected.edges[i]!.basis);
  });
  assert.equal(result.metadata[0]!.status, 'contested');
  assert.deepEqual(result.metadata[0]!.contested_reasons, ['confidence_band_change']);
  assert.equal(result.metadata[1]!.status, 'agreed');
  assert.equal(result.metadata[2]!.status, 'agreed');
}

export function runValidationProbe(raw = JSON.stringify(validationSample()), ignoreUncertainty = false) {
  return runContractProbe({
    id: 'validate_graph.edge_uncertainty', task: 'validate_graph',
    components: {
      // Descriptor only. The separate provider-bound assembly test executes
      // callValidateGraph and verifies the real JSON-object wire request.
      schema: component({ path: 'tools/prompt-consumer/validation.ts', exportName: 'validationWireContract (descriptor, not provider participation)' }, validationWireContract),
      parser: component({ path: 'src/cee/validation-pipeline/validate-graph.ts', exportName: 'parsePass2Response' }, parsePass2Response),
      consumer: component({ path: 'src/cee/validation-pipeline/comparison.ts', exportName: 'compareEdge' }, compareEdge),
      lints: component({ path: 'src/cee/validation-pipeline/enforcement-lints.ts', exportName: 'runEnforcementLints' }, runEnforcementLints),
      bias: component({ path: 'src/cee/validation-pipeline/bias-correction.ts', exportName: 'computeBiasOffsets' }, computeBiasOffsets),
      adjust: component({ path: 'src/cee/validation-pipeline/bias-correction.ts', exportName: 'applyBiasCorrection' }, applyBiasCorrection),
    },
    execute(c) {
      assert.deepEqual(c.schema(), { mode: 'json_object', attachedSchema: null });
      const parsed = c.parser(raw);
      const pass1 = parsed.edges.map(e => ({ from: e.from, to: e.to, strength: { mean: 0.5, std: 0.05 }, exists_probability: 0.8 })) as EdgeV3T[];
      const linted = c.lints(parsed.edges);
      const bias = c.bias(pass1, linted.edges);
      const adjusted = c.adjust(linted.edges, bias.offsets);
      if (ignoreUncertainty) adjusted[0]!.strength.std = 0.05;
      return { expected: parsed, offsets: bias.offsets, metadata: pass1.map((e, i) => c.consumer(e, linted.edges[i]!, adjusted[i]!, linted.lintLog, 1)) };
    },
    verify(result) { verifyValidationCarriage(result, result.expected); },
  });
}

export function runValidationMutations() {
  const missing = validationSample() as unknown as { edges: Array<{ strength: Record<string, number> }> };
  delete missing.edges[0]!.strength.std;
  const unrelated = validationSample();
  unrelated.edges[0]!.reasoning = 'An independently worded rationale about museum capacity.';
  return runSemanticMutationFamily({ id: 'edge-uncertainty', expectedCaseIds: ['baseline', 'missing-std', 'ignored-std', 'unrelated'], cases: [
    { id: 'baseline', kind: 'baseline', run: () => runValidationProbe() },
    { id: 'missing-std', kind: 'semantic_break', run: () => runValidationProbe(JSON.stringify(missing)) },
    { id: 'ignored-std', kind: 'semantic_break', run: () => runValidationProbe(undefined, true) },
    { id: 'unrelated', kind: 'unrelated', run: () => runValidationProbe(JSON.stringify(unrelated)) },
  ] });
}
