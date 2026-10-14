/** RC3 a′: use the real hold/referee/apply seam; no model can author a Run-exclusion stamp. */
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { PatchOperation } from '../../../orchestrator/types.js';
import { AGENT_TOOLS } from '../../agent-lane/runtime/agent-tools.js';
import { productHoldRecord } from '../../agent-lane/proposal-object/record.js';
import { projectEntity, projectModelContext } from '../../agent-lane/runtime/agent-capabilities.js';
import { buildReadyGraph, hashOf } from '../../graph-management/__tests__/fixtures.js';
import { dispatchAddRiskTransaction } from '../../handlers/add-risk-dispatch.js';
import { assessHeldBatchAgainstGraph, evaluateEditGraphMutations } from '../../handlers/edit-graph-referee-gate.js';
import { executeGmHeldResume, readGmHeldResume } from '../../handlers/gm-held-execute.js';
import { hypothesisEdgeValue } from '../add-option-transaction.js';
import { buildAddRiskTransaction } from '../add-risk-transaction.js';
import { heldReliesOnRiskLines, reliesOnRefereeOperations } from '../relies-on-risk.js';

const graph = buildReadyGraph();
const stamp = { option_id: 'o-a' };
const params = { risk: { label: 'Feature release slips' }, links: [] };
const identities = {
  scenarioId: '11111111-1111-4111-8111-111111111111',
  turnId: '11111111-1111-4111-8111-111111111112', requestId: 'rc3-test',
};
function hold() {
  const outcome = dispatchAddRiskTransaction({ ...identities, params, reliesOn: stamp,
    currentGraph: graph, currentGraphHash: hashOf(graph), freshness: 'fresh', mode: 'live', stage: 'frame' });
  expect(outcome.kind).toBe('held');
  if (outcome.kind !== 'held') throw new Error(`not held: ${outcome.reason}`);
  const read = readGmHeldResume(outcome.pendingActions[0]!);
  if (read.kind !== 'ok') throw new Error(`hold unreadable: ${read.kind}`);
  return { outcome, read };
}
function apply(operations: readonly PatchOperation[], currentGraph: unknown = graph) {
  return executeGmHeldResume({ ...identities, operations: operations as never,
    currentGraph, currentGraphHash: hashOf(currentGraph), freshness: 'fresh', hasExistingAnalysis: false });
}

describe('RC3 server-authored precondition hold', () => {
  it('rc3-stamp-authority: ordinary model calls cannot create zero-link risks or set relies_on', () => {
    expect(buildAddRiskTransaction(params, graph)).toEqual({ matched: false, reason: 'no_links' });
    expect(buildAddRiskTransaction({ ...params, risk: { ...params.risk, relies_on: stamp } }, graph))
      .toEqual({ matched: false, reason: 'parameters_invalid' });
    const tool = AGENT_TOOLS.find((t) => t.name === 'propose_new_risk')!;
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(tool.parameters.properties).not.toHaveProperty('relies_on');
    const operations: PatchOperation[] = [{ op: 'add_node', path: 'risk_feature_release_slips',
      value: { id: 'risk_feature_release_slips', kind: 'risk', label: params.risk.label, relies_on: stamp } }];
    const generic = evaluateEditGraphMutations({ ...identities, mode: 'live', operations,
      currentGraph: graph, currentGraphHash: hashOf(graph), baseGraphHash: hashOf(graph), freshness: 'fresh' });
    expect(generic.governing).toBe('rejected');
  });

  it('rc3-held-stamp: stamp lives in held add_node and survives the real confirm and GraphV3 re-parse', () => {
    const { outcome, read } = hold();
    expect(read.operations).toEqual([{ op: 'add_node', path: outcome.riskId,
      value: { id: outcome.riskId, kind: 'risk', label: params.risk.label, relies_on: stamp } }]);
    const card = productHoldRecord(outcome.pendingActions[0]!, graph)!;
    const line = heldReliesOnRiskLines(read.operations, graph)[0]!;
    expect(outcome.chip.detail).toContain(line);
    expect(card.approve_action.detail).toContain(line);
    expect(card.missing).toEqual([]);
    const result = apply(read.operations);
    expect(result.status).toBe('executed');
    if (result.status !== 'executed') return;
    const parsed = GraphV3.parse(result.mutatedGraph);
    expect(parsed.nodes.find((n) => n.id === outcome.riskId)?.relies_on).toEqual(stamp);
    expect(parsed.edges.filter((e) => e.from === outcome.riskId || e.to === outcome.riskId)).toEqual([]);
  });

  it.each(['incoming', 'outgoing'])('rc3-held-no-edges: apply rejects a stamped hold with an added %s edge (M2)', (direction) => {
    const { outcome, read } = hold();
    const from = direction === 'incoming' ? 'f-spend' : outcome.riskId;
    const to = direction === 'incoming' ? outcome.riskId : 'g-profit';
    const operations: PatchOperation[] = [...read.operations, { op: 'add_edge', path: `${from}::${to}`,
      value: hypothesisEdgeValue(from, to, 'negative') }];
    expect(reliesOnRefereeOperations(operations, graph)).toBeUndefined();
    expect(apply(operations).status).toBe('apply_failed');
    expect(assessHeldBatchAgainstGraph({ ...identities, operations, currentGraph: graph, currentGraphHash: hashOf(graph) }).valid).toBe(false);
  });

  it('rc3-held-current-option: a removed, retyped or duplicate option identity declines the whole apply', () => {
    const { read } = hold();
    const removed = { ...graph, nodes: graph.nodes.filter((n) => n.id !== stamp.option_id) };
    const retyped = { ...graph, nodes: graph.nodes.map((n) => n.id === stamp.option_id ? { ...n, kind: 'factor' } : n) };
    const duplicate = { ...graph, nodes: [...graph.nodes, { id: stamp.option_id, kind: 'factor', label: 'Ambiguous identity' }] };
    expect(apply(read.operations, removed).status).toBe('apply_failed');
    expect(apply(read.operations, retyped).status).toBe('apply_failed');
    expect(buildAddRiskTransaction(params, duplicate, stamp)).toEqual({ matched: false, reason: 'parameters_invalid' });
    expect(apply(read.operations, duplicate).status).toBe('apply_failed');
  });

  it('rc3-held-thread: an unrelated edit retains a valid stamp-bearing hold and its reload disclosure', () => {
    const { outcome, read } = hold();
    const changed = { ...graph, nodes: graph.nodes.map((n) => n.id === 'f-spend' ? { ...n, observed_state: { value: 0.7 } } : n) };
    expect(assessHeldBatchAgainstGraph({ ...identities, operations: read.operations,
      currentGraph: changed, currentGraphHash: hashOf(changed) }).valid).toBe(true);
    const repinned = { ...outcome.pendingActions[0]!, preconditions: { graph_hash: hashOf(changed) } };
    expect(productHoldRecord(repinned, changed)!.approve_action.detail)
      .toContain(heldReliesOnRiskLines(read.operations, changed)[0]);
  });

  it('rc3-stamp-hash: removal/rebinding invalidates the analysis; absent/malformed leaves legacy bytes unchanged', () => {
    const risk = { id: 'risk_feature_release_slips', kind: 'risk' as const, label: params.risk.label };
    const plain = { ...graph, nodes: [...graph.nodes, risk] };
    const stamped = { ...graph, nodes: [...graph.nodes, { ...risk, relies_on: stamp }] };
    const rebound = { ...graph, nodes: [...graph.nodes, { ...risk, relies_on: { option_id: 'o-b' } }] };
    expect(hashOf(stamped)).not.toBe(hashOf(plain));
    expect(hashOf(stamped)).not.toBe(hashOf(rebound));
    expect(hashOf({ ...graph, nodes: [...graph.nodes, { ...risk, relies_on: { option_id: 'bad id' } }] })).toBe(hashOf(plain));
  });

  it('rc3-agent-context: canonical context discloses the excluded risk and forbids citing it as a chance driver', () => {
    const risk = { id: 'risk_feature_release_slips', kind: 'risk', label: params.risk.label, relies_on: stamp };
    const saved = { ...graph, nodes: [...graph.nodes, risk] };
    const context = projectModelContext({ ...saved, raw: saved, analysis_state: undefined });
    expect(projectEntity(risk).relies_on).toEqual(stamp);
    expect(context.left_out_of_run).toEqual([expect.objectContaining({
      id: risk.id, relies_on: stamp, reason: expect.stringContaining("that option's chance doesn't include it yet"),
      use: expect.stringContaining('never cite it as a reason for a goal chance'),
    })]);
    const linked = GraphV3.parse({ ...saved, edges: [...saved.edges, hypothesisEdgeValue(risk.id, 'g-profit', 'negative')] });
    expect(projectModelContext({ ...linked, raw: linked, analysis_state: undefined })).not.toHaveProperty('left_out_of_run');
  });
});
