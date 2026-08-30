import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCanonicalAnalysisReadyFromGraph } from '../../src/orchestrator/tools/analysis-ready-helper.js';
import { projectReadinessRecovery } from '../../src/orchestrator-v5/coaching/readiness-recovery.js';
import { MISSING_VALUE_ASK_EXEMPLARS, MISSING_VALUE_ASK_FORMAT_HINT, readMissingValueAnswer } from '../../src/orchestrator-v5/routing/missing-value-answer.js';
import { deriveOnScreenEffectAsk, resolveRepairValueBinding } from '../../src/orchestrator-v5/routing/repair-value-binding.js';
import { resolveOptionEffectWrite, buildOptionEffectRawOperation } from '../../src/orchestrator-v5/routing/option-effect-write.js';
import { parseEditGraphResponse } from '../../src/orchestrator/tools/edit-graph.js';
import { component, runContractProbe, runSemanticMutationFamily } from './contract.js';

const witness = JSON.parse(readFileSync(new URL('../../src/orchestrator-v5/__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json', import.meta.url), 'utf8')) as {
  draft_graph: { nodes: Array<{ id: string; label: string; kind: string }>; edges: unknown[] };
};
export const recoveryExamples = () => MISSING_VALUE_ASK_EXEMPLARS;
// Independent quantities make a shared reader/binder unit mistake observable.
// These are numerical test oracles, not a second product parser.
const expectedValues = new Map([['0%', 0], ['100%', 1], ['60%', 0.6], ['about 60%', 0.6], ['0.6', 0.6]]);

/** Ends at the immediate, canonical edit operation. Pending routing belongs to B. */
export function runRecoveryProbe(message = '60%', mutation?: 'zero-for-no-change' | 'wrong-owner' | 'wrong-answer-form' | 'unrelated') {
  const graph = structuredClone(witness.draft_graph);
  if (mutation === 'unrelated') {
    const goal = graph.nodes.find(n => n.kind === 'goal');
    if (goal) goal.label = 'A renamed goal, unrelated to the asked effect';
  }
  const readiness = buildCanonicalAnalysisReadyFromGraph(graph);
  const asked = deriveOnScreenEffectAsk(readiness);
  assert(asked, 'banked recovery fixture must have a real outstanding question');
  return runContractProbe({
    id: 'recovery.ask-to-bind', task: 'orchestrator',
    components: {
      schema: component({ path: 'src/orchestrator-v5/coaching/readiness-recovery.ts', exportName: 'projectReadinessRecovery' }, projectReadinessRecovery),
      parser: component({ path: 'src/orchestrator-v5/routing/missing-value-answer.ts', exportName: 'readMissingValueAnswer' }, readMissingValueAnswer),
      consumer: component({ path: 'src/orchestrator-v5/routing/repair-value-binding.ts', exportName: 'resolveRepairValueBinding' }, resolveRepairValueBinding),
    },
    execute(c) {
      const producedQuestion = c.schema(readiness, graph.nodes);
      const question = mutation === 'wrong-answer-form'
        ? { ...producedQuestion, nextStep: 'Reply with a colour name, red or blue; no numbers.' }
        : producedQuestion;
      const reading = c.parser(message);
      const bound = c.consumer({ message: mutation === 'zero-for-no-change' ? '0%' : message, readiness });
      let canonical: ReturnType<typeof parseEditGraphResponse> | undefined;
      if (bound.matched && bound.kind === 'bind') {
        const write = resolveOptionEffectWrite({ message: bound.instruction, graph });
        assert(write.matched && write.kind === 'write', 'binder output must be consumable by actual edit writer');
        canonical = parseEditGraphResponse(JSON.stringify({ operations: [buildOptionEffectRawOperation(write)], removed_edges: [], warnings: [], coaching: null }));
        if (mutation === 'wrong-owner') canonical.operations[0]!.path = 'wrong-existing-owner';
      }
      return { question, reading, bound, canonical };
    },
    verify({ question, reading, bound, canonical }) {
      assert.equal(question.kind, 'provide_value');
      assert.equal(question.optionLabelFull, asked.optionLabel);
      assert.equal(question.factorLabelFull, asked.factorLabel);
      // Bind the emitted question to the canonical advertised response contract.
      // This is participation, not a claim to infer arbitrary prose semantics:
      // real readers, independent quantities and canonical writes below prove
      // the supported examples actually mean what that contract advertises.
      assert(question.nextStep.includes(MISSING_VALUE_ASK_FORMAT_HINT), 'issued question did not carry the tested answer contract');
      assert(reading, 'answer must be understood, not just mentioned in ask copy');
      if (reading.kind === 'no_change') {
        assert(!bound.matched || bound.kind !== 'bind', 'no change must never become zero or baseline pinning');
        assert.equal(canonical, undefined, 'no fabricated numeric write for no-change');
        return;
      }
      assert.equal(reading.kind, 'numeric');
      assert(reading.kind === 'numeric' && bound.matched && bound.kind === 'bind');
      assert(expectedValues.has(message), 'new response form needs an independent quantity oracle');
      assert.equal(Number(reading.modelUnitText), expectedValues.get(message), 'answer meaning changed at the unit boundary');
      assert.equal(bound.valueText, reading.modelUnitText);
      assert.equal(bound.pair.optionId, asked.optionId);
      assert.equal(bound.pair.factorId, asked.factorId);
      assert(canonical);
      assert.equal(canonical.operations.length, 1);
      const op = canonical.operations[0]!;
      assert.equal(op.path, asked.optionId);
      assert.equal(op.op, 'update_node');
      const values = op.value as Record<string, { value: number }>;
      assert.deepEqual(Object.keys(values), [`data/interventions/${asked.factorId}`]);
      assert.equal(values[`data/interventions/${asked.factorId}`]!.value, Number(reading.modelUnitText));
    },
  });
}

export function runRecoveryProbes() {
  return [...recoveryExamples().map(e => runRecoveryProbe(e.example)), runRecoveryProbe('no change')];
}
export function runRecoveryMutations() {
  return runSemanticMutationFamily({ id: 'ask-to-binder', expectedCaseIds: ['baseline', 'wrong-owner', 'wrong-answer-form', 'no-change-as-zero', 'unrelated'], cases: [
    { id: 'baseline', kind: 'baseline', run: () => runRecoveryProbe() },
    { id: 'wrong-owner', kind: 'semantic_break', run: () => runRecoveryProbe('60%', 'wrong-owner') },
    { id: 'wrong-answer-form', kind: 'semantic_break', run: () => runRecoveryProbe('60%', 'wrong-answer-form') },
    { id: 'no-change-as-zero', kind: 'semantic_break', run: () => runRecoveryProbe('no change', 'zero-for-no-change') },
    { id: 'unrelated', kind: 'unrelated', run: () => runRecoveryProbe('60%', 'unrelated') },
  ] });
}
