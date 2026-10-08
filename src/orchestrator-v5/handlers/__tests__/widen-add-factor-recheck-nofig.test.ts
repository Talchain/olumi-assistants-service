/** P14 DL condition 1: a widen factor Add has no user_today member but retains the door's commit-time rules. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import type { PendingAction } from '../../session/pending-action.js';
import { buildAddFactorTransaction, GM_HELD_OLUMI_DIRECTION_KEY, isNewFactorTarget, recheckAddFactorBatch } from '../../routing/add-factor-transaction.js';
import { hypothesisEdgeValue } from '../../routing/add-option-transaction.js';
import { factorDefinitionRedirect } from '../../routing/factor-definition-target.js';
import { evaluateEditGraphMutations } from '../edit-graph-referee-gate.js';
import { toGraphView } from '../add-option-dispatch.js';
import { dispatchAddFactorTransaction } from '../add-factor-dispatch.js';
import { executeGmHeldResume, readGmHeldResume } from '../gm-held-execute.js';

type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>>; [key: string]: unknown };
const TARGET = 'incremental_platform_delivery_capacity';
const LABEL = 'Customer continuity';
const SCENARIO = 'f1a8bd5d-7807-4095-bef8-a335b6067865';
const graph = (): Graph => projectGraphForPersistence(JSON.parse(readFileSync(
  new URL('../../agent-lane/__tests__/fixtures/journey-e-e07-draft-graph.json', import.meta.url), 'utf8',
))) as Graph;
const hash = (g: Graph): string => computeAnalysisAffectingGraphHash(g as never)!;

describe('P14 no-figure add-factor hold recheck', () => {
  it('STAMP-NOT-SHAPE: an unstamped edit_graph factor+edge hold keeps the shared approval behavior even when its target fails the add-factor rules', () => {
    const before = graph();
    const target = 'senior_hiring_lead_time_risk';
    expect(isNewFactorTarget(toGraphView(before)!.nodes.find((n) => n.id === target))).toBe(false);
    const operations = [
      { op: 'add_node', path: 'fac_customer_continuity', value: {
        id: 'fac_customer_continuity', kind: 'factor', label: LABEL, category: 'external',
      } },
      { op: 'add_edge', path: `fac_customer_continuity::${target}`,
        value: hypothesisEdgeValue('fac_customer_continuity', target, 'positive') },
    ];
    expect(recheckAddFactorBatch(operations, toGraphView(before))).toBe('target_not_allowed');
    const held = evaluateEditGraphMutations({
      mode: 'live', operations, currentGraph: before, currentGraphHash: hash(before),
      baseGraphHash: hash(before), freshness: 'none', dispatchPath: 'edit_graph',
      scenarioId: SCENARIO, turnId: 'p14-edit-propose', requestId: 'p14-edit-propose',
    });
    expect(held.governing).toBe('held');
    expect(held.pendingActions).toHaveLength(1);
    const pending = held.pendingActions![0]!;
    const patch = pending.action.kind === 'apply_proposed_change'
      ? pending.action.inline_patch as Record<string, unknown> : {};
    expect(patch).not.toHaveProperty(GM_HELD_OLUMI_DIRECTION_KEY);
    const read = readGmHeldResume(pending);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') throw new Error(read.kind);
    expect(read.userToday).toBeUndefined();
    expect(read.olumiDirection).toBe(false);
    const beforeBytes = JSON.stringify(before);
    const approved = executeGmHeldResume({
      ...read, currentGraph: before, currentGraphHash: hash(before), freshness: 'none', hasExistingAnalysis: false,
      scenarioId: SCENARIO, turnId: 'p14-edit-confirm', requestId: 'p14-edit-confirm',
    });
    expect(approved.status).toBe('executed');
    if (approved.status !== 'executed') throw new Error(approved.status);
    expect((approved.mutatedGraph as Graph).nodes.find((n) => n.id === 'fac_customer_continuity'))
      .toMatchObject({ kind: 'factor', label: LABEL });
    expect((approved.mutatedGraph as Graph).edges.find((e) => e.from === 'fac_customer_continuity' && e.to === target))
      .toBeDefined();
    expect(JSON.stringify(before)).toBe(beforeBytes);
  });

  it.each([false, null, 'true', 1, {}, [], ''].map((marker) => ({ marker, label: JSON.stringify(marker) })))('STAMP-FAIL-CLOSED: malformed marker $label declines at readback', ({ marker }) => {
    const before = graph();
    const held = dispatchAddFactorTransaction({
      params: { factors: [{ label: LABEL, link: { to_id: TARGET, effect_direction: 'positive' } }] },
      variant: 'olumi_direction', mode: 'live', currentGraph: before,
      currentGraphHash: hash(before), freshness: 'none',
      scenarioId: SCENARIO, turnId: 'p14-marker-propose', requestId: 'p14-marker-propose', stage: 'frame',
    });
    expect(held.kind).toBe('held');
    if (held.kind !== 'held') throw new Error(held.reason);
    const pending = held.pendingActions[0]!;
    if (pending.action.kind !== 'apply_proposed_change') throw new Error(pending.action.kind);
    const malformed = { ...pending, action: { ...pending.action, inline_patch: {
      ...pending.action.inline_patch as Record<string, unknown>, [GM_HELD_OLUMI_DIRECTION_KEY]: marker,
    } } } as PendingAction;
    expect(readGmHeldResume(malformed)).toEqual({ kind: 'no_payload' });
  });

  it('RECHECK-NOFIG: approval refuses the whole no-figure factor hold when its name was taken; nothing persists; unchanged-graph control executes', () => {
    const before = graph();
    const params = { factors: [
      { label: LABEL, link: { to_id: TARGET, effect_direction: 'positive' } },
    ] };
    const built = buildAddFactorTransaction(params, toGraphView(before), { kind: 'olumi_direction' });
    expect(built.matched).toBe(true);
    if (!built.matched) throw new Error(built.reason);
    expect(built.proposal.operations.map((o) => o.op)).toEqual(['add_node', 'add_edge']);
    expect(built.proposal.operations[1]!.value).toMatchObject({ provenance: { magnitude: 'olumi_placeholder' } });
    const held = dispatchAddFactorTransaction({
      params, variant: 'olumi_direction', mode: 'live', currentGraph: before,
      currentGraphHash: hash(before), freshness: 'none',
      scenarioId: SCENARIO, turnId: 'p14-propose', requestId: 'p14-propose', stage: 'frame',
    });
    expect(held.kind).toBe('held');
    if (held.kind !== 'held') throw new Error(held.reason);
    expect(held.pendingActions).toHaveLength(1);
    const pending = held.pendingActions![0]!;
    expect(pending.action.kind === 'apply_proposed_change' && pending.action.inline_patch)
      .toHaveProperty(GM_HELD_OLUMI_DIRECTION_KEY, true);
    const read = readGmHeldResume(pending);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') throw new Error(read.kind);
    expect(read.userToday).toBeUndefined();
    expect(read.olumiDirection).toBe(true);
    const confirm = (currentGraph: Graph) => executeGmHeldResume({
      operations: read.operations,
      olumiDirection: read.olumiDirection,
      ...(read.envelopeCap !== undefined ? { envelopeCap: read.envelopeCap } : {}),
      currentGraph, currentGraphHash: hash(currentGraph), freshness: 'none', hasExistingAnalysis: false,
      scenarioId: SCENARIO, turnId: 'p14-confirm', requestId: 'p14-confirm',
    });
    const moved: Graph = {
      ...before,
      nodes: [...before.nodes, { id: 'canvas_factor', kind: 'factor', label: '  CUSTOMER   continuity ', category: 'external' }],
      edges: [...before.edges, { from: 'canvas_factor', to: TARGET, strength: { mean: 0.5, std: 0.1 },
        exists_probability: 1, effect_direction: 'positive' }],
    };
    const movedBytes = JSON.stringify(moved);
    const refused = confirm(moved);
    expect(refused).toEqual({ status: 'apply_failed', reason: 'apply_error' });
    expect('mutatedGraph' in refused).toBe(false);
    expect(JSON.stringify(moved), 'the graph handed to the commit door remains byte-identical').toBe(movedBytes);

    const beforeBytes = JSON.stringify(before);
    const control = confirm(before);
    expect(control.status).toBe('executed');
    if (control.status !== 'executed') throw new Error(control.status);
    expect((control.mutatedGraph as Graph).nodes).toHaveLength(before.nodes.length + 1);
    expect((control.mutatedGraph as Graph).edges).toHaveLength(before.edges.length + 1);
    expect((control.mutatedGraph as Graph).nodes.find((n) => n.id === built.proposal.factors[0]!.id)?.observed_state)
      .toBeUndefined();
    expect(JSON.stringify(before), 'successful application also clones its input graph').toBe(beforeBytes);
  });

  it.each(['sum identity', 'held definitional link'] as const)('RECHECK-DEFINITION: approval refuses when the target became a %s; nothing persists; unchanged target executes', (definition) => {
    const before = graph();
    const held = dispatchAddFactorTransaction({
      params: { factors: [{ label: LABEL, link: { to_id: TARGET, effect_direction: 'positive' } }] },
      variant: 'olumi_direction', mode: 'live', currentGraph: before,
      currentGraphHash: hash(before), freshness: 'none',
      scenarioId: SCENARIO, turnId: 'p14-definition-propose', requestId: 'p14-definition-propose', stage: 'frame',
    });
    expect(held.kind).toBe('held');
    if (held.kind !== 'held') throw new Error(held.reason);
    const read = readGmHeldResume(held.pendingActions[0]!);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') throw new Error(read.kind);
    expect(read.olumiDirection).toBe(true);
    const confirm = (currentGraph: Graph) => executeGmHeldResume({
      ...read, currentGraph, currentGraphHash: hash(currentGraph), freshness: 'none', hasExistingAnalysis: false,
      scenarioId: SCENARIO, turnId: 'p14-definition-confirm', requestId: 'p14-definition-confirm',
    });
    const moved = structuredClone(before);
    if (definition === 'sum identity') {
      moved.nodes.find((n) => n.id === TARGET)!.nonlinear_identity = {
        operation: 'sum', factor_ids: ['new_senior_engineers_hired', 'new_junior_engineers_hired'], stated_in_brief: true,
      };
    } else {
      const edge = moved.edges.find((e) => e.from === 'new_senior_engineers_hired' && e.to === TARGET)!;
      edge.strength = { mean: 0.5, std: 0.1 };
      edge.provenance = { source: 'user_specified', magnitude: 'user_stated', definitional: true,
        natural_effect: { amount: 1, amount_unit: 'engineers', strength_mean: 0.5, per_source_change: 1,
          per_source_change_unit: 'engineers', strength_mean_frame: 'edge_strength', stated_range: { low: 0.5, high: 1.5 } } };
    }
    // The changed target remains a valid graph and otherwise meets the factor door's name, kind and reachability rules.
    expect(toGraphView(moved)).not.toBeNull();
    expect(factorDefinitionRedirect(moved, TARGET)).toBeDefined();
    expect(recheckAddFactorBatch(read.operations, toGraphView(moved))).toBeNull();
    const movedBytes = JSON.stringify(moved);
    const refused = confirm(moved);
    expect(refused).toEqual({ status: 'apply_failed', reason: 'apply_error' });
    expect('mutatedGraph' in refused).toBe(false);
    expect(JSON.stringify(moved), 'the graph handed to the commit door remains byte-identical').toBe(movedBytes);

    const beforeBytes = JSON.stringify(before);
    const control = confirm(before);
    expect(control.status).toBe('executed');
    if (control.status !== 'executed') throw new Error(control.status);
    expect((control.mutatedGraph as Graph).nodes).toHaveLength(before.nodes.length + 1);
    expect((control.mutatedGraph as Graph).edges).toHaveLength(before.edges.length + 1);
    expect(JSON.stringify(before)).toBe(beforeBytes);
  });
});
