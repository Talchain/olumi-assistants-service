import { describe, expect, it } from 'vitest';
import { propagateConfirmedInterventionRemovals } from '../confirmed-intervention-removals.js';
import { evaluateEditGraphMutations } from '../../handlers/edit-graph-referee-gate.js';
import { executeGmHeldResume, readGmHeldResume } from '../../handlers/gm-held-execute.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { PatchOperation } from '../../../orchestrator/types.js';

const CAPITAL = 'f-capital';
const CAPACITY = 'f-capacity';
const OPTION = 'o-a';
const pair = { optionId: OPTION, factorId: CAPITAL };
const intervention = (node_id: string, value: number) => ({ value, unit: '%', source: 'user_specified',
  target_match: { node_id, match_type: 'exact_id', confidence: 'high' }, reasoning: 'Retain this evidence', value_confidence: 'medium' });
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const });

function graph() {
  const first = { [CAPITAL]: intervention(CAPITAL, 0.8), [CAPACITY]: intervention(CAPACITY, 0.4) };
  const second = { [CAPITAL]: intervention(CAPITAL, 0.6), [CAPACITY]: intervention(CAPACITY, 0.2) };
  return {
    goal_node_id: 'g', schema_version: 'v3', metadata: { reasoning: 'Preserve the qualitative context' },
    nodes: [
      { id: 'g', kind: 'goal', label: 'Success' },
      { id: CAPITAL, kind: 'factor', label: 'Capital Raised', observed_state: { value: 0.5, unit: '%' } },
      { id: CAPACITY, kind: 'factor', label: 'Founder Capacity', observed_state: { value: 0.5, unit: '%' } },
      { id: OPTION, kind: 'option', label: 'Plan A', interventions: first },
      { id: 'o-b', kind: 'option', label: 'Plan B', interventions: second },
    ],
    edges: [edge(OPTION, CAPITAL), edge(OPTION, CAPACITY), edge('o-b', CAPITAL), edge('o-b', CAPACITY), edge(CAPACITY, CAPITAL), edge(CAPITAL, 'g')],
    options: [
      { id: OPTION, label: 'Plan A', status: 'ready', interventions: structuredClone(first), raw_interventions: { [CAPITAL]: 80 }, provenance: { source: 'brief_extraction', reasoning: 'Original plan' } },
      { id: 'o-b', label: 'Plan B', status: 'ready', interventions: structuredClone(second), raw_interventions: {}, provenance: { source: 'brief_extraction', reasoning: 'Alternative plan' } },
    ],
  };
}

function operations(before = graph()): PatchOperation[] {
  const retained: Record<string, ReturnType<typeof intervention>> = structuredClone(before.nodes.find(node => node.id === OPTION)!.interventions!);
  delete retained[CAPITAL];
  return [{ op: 'update_node', path: OPTION, value: { interventions: retained } }, { op: 'remove_edge', path: `${OPTION}::${CAPITAL}` }];
}

function applied(before = graph(), batch = operations(before)) {
  const candidate = applyPatchOperations(GraphV3.parse(before), batch);
  return { ...structuredClone(before), nodes: structuredClone(candidate.nodes), edges: structuredClone(candidate.edges) };
}

describe('confirmed intervention removal propagation', () => {
  it('closes the node-only deletion reproduction through canonical projection and analysis', () => {
    const before = graph();
    const batch = operations(before);
    const after = applied(before, batch);
    const snapshots = structuredClone({ before, after, batch });
    const uncorrected = buildCanonicalAnalysisReadyFromGraph(projectGraphForPersistence(after));
    expect(uncorrected?.options.find(option => option.option_id === OPTION)?.interventions).toHaveProperty(CAPITAL);
    const result = propagateConfirmedInterventionRemovals({ beforeGraph: before, afterGraph: after, operations: batch });
    expect(result.status).toBe('reconciled');
    if (result.status === 'refused') throw new Error(result.reason);
    expect(result.removedPairs).toEqual([pair]);
    const persisted = projectGraphForPersistence(result.graph);
    expect(persisted.options[0]!.interventions).not.toHaveProperty(CAPITAL);
    expect(persisted.options[0]!.raw_interventions).not.toHaveProperty(CAPITAL);
    expect(persisted.nodes.find(node => node.id === OPTION)!.interventions).not.toHaveProperty(CAPITAL);
    expect(persisted.options[0]!.interventions[CAPACITY]).toEqual(before.options[0]!.interventions[CAPACITY]);
    expect(persisted.options[0]!.provenance).toEqual(before.options[0]!.provenance);
    expect(persisted.options[1]).toEqual(before.options[1]);
    expect(persisted.nodes.find(node => node.id === 'o-b')).toEqual(before.nodes.find(node => node.id === 'o-b'));
    expect(persisted.metadata).toEqual(before.metadata);
    const ready = buildCanonicalAnalysisReadyFromGraph(persisted);
    expect(ready?.options.find(option => option.option_id === OPTION)?.interventions).toEqual({ [CAPACITY]: 0.4 });
    expect(ready?.options.find(option => option.option_id === 'o-b')?.interventions).toHaveProperty(CAPITAL, 0.6);
    expect({ before, after, batch }).toEqual(snapshots);
  });

  it('works through the real held proposal, payload reader and confirmed executor', () => {
    const before = graph();
    const hash = computeAnalysisAffectingGraphHash(before)!;
    const batch = operations(before);
    const context = { currentGraph: before, currentGraphHash: hash, freshness: 'none' as const,
      scenarioId: 'scenario-capacity', turnId: 'turn-capacity', requestId: 'request-capacity' };
    const held = evaluateEditGraphMutations({ ...context, operations: batch, baseGraphHash: hash, mode: 'live' });
    expect(held.governing).toBe('held');
    const read = readGmHeldResume(held.pendingActions![0]!);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') throw new Error('Expected executable held batch');
    const executed = executeGmHeldResume({ ...context, operations: read.operations, hasExistingAnalysis: false });
    expect(executed.status).toBe('executed');
    if (executed.status !== 'executed') throw new Error(executed.status);
    const result = propagateConfirmedInterventionRemovals({ beforeGraph: before, afterGraph: executed.mutatedGraph, operations: read.operations });
    if (result.status === 'refused') throw new Error(result.reason);
    const ready = buildCanonicalAnalysisReadyFromGraph(projectGraphForPersistence(result.graph));
    expect(ready?.options.find(option => option.option_id === OPTION)?.interventions).toEqual({ [CAPACITY]: 0.4 });
    expect(result.removedPairs).toEqual([pair]);
  });

  it.each(['no operations', 'map only', 'edge only', 'wrong edge'] as const)('creates no deletion authority from %s', (kind) => {
    const before = graph();
    const batch = operations(before);
    const selected = kind === 'map only' ? [batch[0]!] : kind === 'edge only' ? [batch[1]!] :
      kind === 'wrong edge' ? [batch[0]!, { op: 'remove_edge' as const, path: `${OPTION}::${CAPACITY}` }] : [];
    const after = applied(before, batch);
    const result = propagateConfirmedInterventionRemovals({ beforeGraph: before, afterGraph: after, operations: selected });
    expect(result).toEqual({ status: 'unchanged', graph: after, removedPairs: [] });
    if (result.status !== 'refused') expect(result.graph).toBe(after);
  });

  it('accepts the existing arrow edge spelling using exact endpoint identity', () => {
    const before = graph();
    const batch = operations(before);
    batch[1]!.path = `${OPTION}->${CAPITAL}`;
    const result = propagateConfirmedInterventionRemovals({ beforeGraph: before, afterGraph: applied(before, batch), operations: batch });
    expect(result.status).toBe('reconciled');
  });

  it('preserves ordinary first-intervention additions with an unrelated link removal', () => {
    const before = graph();
    delete before.nodes.find(node => node.id === OPTION)!.interventions;
    const batch: PatchOperation[] = [
      { op: 'update_node', path: OPTION, value: { interventions: { [CAPITAL]: intervention(CAPITAL, 0.8) } } },
      { op: 'remove_edge', path: `${OPTION}::${CAPACITY}` },
    ];
    const after = applied(before, batch);
    expect(propagateConfirmedInterventionRemovals({ beforeGraph: before, afterGraph: after, operations: batch }))
      .toEqual({ status: 'unchanged', graph: after, removedPairs: [] });
  });

  it('accepts an equivalent replacement when its saved property order differs', () => {
    const before = graph();
    const batch = operations(before);
    const after = applied(before, batch);
    const retained = after.nodes.find(node => node.id === OPTION)!.interventions!;
    retained[CAPACITY] = Object.fromEntries(Object.entries(retained[CAPACITY]!).reverse()) as typeof retained[typeof CAPACITY];
    expect(propagateConfirmedInterventionRemovals({ beforeGraph: before, afterGraph: after, operations: batch }).status).toBe('reconciled');
  });

  it('prunes agreeing legacy mirrors while preserving sibling fields and differing provenance metadata', () => {
    const before = graph();
    const node = before.nodes.find(node => node.id === OPTION)!;
    Object.assign(node, {
      data: { notes: 'Keep these notes', interventions: structuredClone(node.interventions) },
      [`data/interventions/${CAPITAL}`]: structuredClone(node.interventions![CAPITAL]),
      [`observed_state/interventions/${CAPITAL}`]: structuredClone(node.interventions![CAPITAL]),
    });
    before.options[0]!.interventions[CAPITAL]!.reasoning = 'The mirror has its own explanation';
    delete (before.options[0]!.interventions[CAPITAL] as { unit?: string }).unit;
    const batch = operations(before);
    const after = applied(before, batch);
    Object.assign(after.nodes.find(node => node.id === OPTION)!, {
      data: structuredClone((node as typeof node & { data: unknown }).data),
      [`data/interventions/${CAPITAL}`]: structuredClone(node.interventions![CAPITAL]),
      [`observed_state/interventions/${CAPITAL}`]: structuredClone(node.interventions![CAPITAL]),
    });
    const result = propagateConfirmedInterventionRemovals({ beforeGraph: before, afterGraph: after, operations: batch });
    expect(result.status).toBe('reconciled');
    if (result.status === 'refused') throw new Error(result.reason);
    const saved = result.graph.nodes.find(node => node.id === OPTION)! as Record<string, unknown>;
    expect(saved).not.toHaveProperty(`data/interventions/${CAPITAL}`);
    expect(saved).not.toHaveProperty(`observed_state/interventions/${CAPITAL}`);
    expect(saved.data).toEqual({ notes: 'Keep these notes', interventions: { [CAPACITY]: node.interventions![CAPACITY] } });
  });

  it.each(['different value', 'different unit', 'different target', 'malformed map', 'duplicate option', 'edge still present', 'cell still present', 'duplicate replacement', 'readded edge', 'readded legacy cell'] as const)(
    'refuses %s without modifying the input', (kind) => {
      const before = graph();
      const batch = operations(before);
      const after = applied(before, batch);
      if (kind === 'different value') after.options[0]!.interventions[CAPITAL]!.value = 0.9;
      if (kind === 'different unit') after.options[0]!.interventions[CAPITAL]!.unit = 'USD';
      if (kind === 'different target') after.options[0]!.interventions[CAPITAL]!.target_match.node_id = CAPACITY;
      if (kind === 'malformed map') Object.assign(after.options[0]!, { interventions: null });
      if (kind === 'duplicate option') after.options.push(structuredClone(after.options[0]!));
      if (kind === 'edge still present') after.edges.push(edge(OPTION, CAPITAL));
      if (kind === 'cell still present') after.nodes.find(node => node.id === OPTION)!.interventions![CAPITAL] = structuredClone(before.options[0]!.interventions[CAPITAL]);
      if (kind === 'duplicate replacement') batch.push(structuredClone(batch[0]!));
      if (kind === 'readded edge') batch.push({ op: 'add_edge', path: `${OPTION}::${CAPITAL}`, value: edge(OPTION, CAPITAL) });
      if (kind === 'readded legacy cell') batch.push({ op: 'update_node', path: OPTION, value: { [`data/interventions/${CAPITAL}`]: structuredClone(before.options[0]!.interventions[CAPITAL]) } });
      const snapshot = structuredClone({ before, after, batch });
      expect(propagateConfirmedInterventionRemovals({ beforeGraph: before, afterGraph: after, operations: batch }).status).toBe('refused');
      expect({ before, after, batch }).toEqual(snapshot);
    },
  );
});
