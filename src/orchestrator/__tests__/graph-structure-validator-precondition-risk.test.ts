/** FIX-r1 P1: stamp-bearing preconditions cannot acquire an incident link through any edit/apply path. */
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { preconditionRiskLinkViolations, validateGraphStructure } from '../graph-structure-validator.js';
import { applyPatchOperations, PatchApplyError } from '../patch-applier.js';
import { applyAndValidateMutation } from '../../orchestrator-v5/tools/handlers/d1-shared/apply-graph-mutation.js';

const REASON = "‘Feature release slips’ is tied to ‘Raise Pro price to £59’ and left out of the Run; this model can't link it yet.";
const graph = () => GraphV3.parse({
  nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR' },
    { id: 'price', kind: 'factor', label: 'Pro plan price' },
    { id: 'release', kind: 'risk', label: 'Feature release slips', relies_on: { option_id: 'raise_59' } },
    { id: 'decision', kind: 'decision', label: 'Pro pricing' },
    { id: 'keep_49', kind: 'option', label: 'Keep £49' },
    { id: 'raise_59', kind: 'option', label: 'Raise Pro price to £59' },
  ],
  edges: [['decision', 'keep_49'], ['decision', 'raise_59'], ['keep_49', 'price'], ['raise_59', 'price'], ['price', 'mrr']]
    .map(([from, to]) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const })),
});
const edge = (from: string, to: string, edge_type?: 'bidirected') => ({
  from, to, strength: { mean: -0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' as const,
  ...(edge_type === undefined ? {} : { edge_type }),
});

describe('RC3 FIX-r1 — central incident-link prohibition', () => {
  it.each([
    ['whole', { relies_on: { option_id: 'raise_59' } }],
    ['nested merge', { data: { relies_on: { option_id: 'raise_59' } } }],
    ['dotted merge', { 'data.relies_on': { option_id: 'raise_59' } }],
  ])('rc3-r1-lowlevel-update-stamp-authority: %s cannot manufacture an exemption', (_spelling, value) => {
    const before = graph();
    delete before.nodes.find((node) => node.id === 'release')!.relies_on;
    const bytes = JSON.stringify(before);
    let thrown: unknown;
    try { applyPatchOperations(before, [{ op: 'update_node', path: 'release', value }]); }
    catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(PatchApplyError);
    expect(thrown).toMatchObject({ code: 'INVALID_OPERATION' });
    expect(JSON.stringify(before)).toBe(bytes);
    expect(validateGraphStructure(before).violations).toContainEqual(expect.objectContaining({ code: 'ORPHAN_NODE' }));
  });

  it.each([
    ['outgoing', 'release', 'mrr', undefined],
    ['incoming', 'price', 'release', undefined],
    ['bidirected', 'price', 'release', 'bidirected'],
  ] as const)('rc3-r1-central-incident-edge: %s is refused by default edit AND readiness validation', (_direction, from, to, edge_type) => {
    const g = graph();
    expect(validateGraphStructure(g).valid, 'the stamped zero-link risk is valid before the attempted link').toBe(true);
    g.edges.push(edge(from, to, edge_type));
    for (const opts of [{}, { leaveOutInertRisks: true }]) {
      const result = validateGraphStructure(g, opts);
      expect(result.valid).toBe(false);
      expect(result.violations, 'M-r1-incident-edge: remove the central prohibition → RED')
        .toContainEqual(expect.objectContaining({ code: 'PRECONDITION_RISK_LINKED', detail: REASON }));
    }
  });

  it.each([['release', 'mrr'], ['price', 'release']] as const)('rc3-r1-patch-writer-atomic: %s → %s throws the same named reason and changes no bytes', (from, to) => {
    const before = graph();
    const bytes = JSON.stringify(before);
    let thrown: unknown;
    try { applyPatchOperations(before, [{ op: 'add_edge', path: `${from}::${to}`, value: edge(from, to) }]); }
    catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(PatchApplyError);
    expect(thrown).toMatchObject({ code: 'PRECONDITION_RISK_LINKED', message: REASON });
    expect(JSON.stringify(before)).toBe(bytes);
    expect(before.nodes.find((n) => n.id === 'release')?.relies_on).toEqual({ option_id: 'raise_59' });
  });

  it('rc3-r1-central-retype-cannot-hide-stamp: a stamped precondition renamed to a factor still cannot link to MRR', () => {
    const retyped = graph();
    retyped.nodes.find((node) => node.id === 'release')!.kind = 'factor';
    retyped.edges.push(edge('release', 'mrr'));
    for (const opts of [{}, { leaveOutInertRisks: true }]) {
      const result = validateGraphStructure(retyped, opts);
      expect(result.valid).toBe(false);
      expect(result.violations, 'M-r1-retype-stamp: require current kind risk in the central rule → RED')
        .toContainEqual(expect.objectContaining({ code: 'PRECONDITION_RISK_LINKED', detail: REASON }));
    }
  });

  it('rc3-r1-atomic-retype-plus-edge: generic kind update and edge batch is refused without changing the risk or stamp', () => {
    const before = graph();
    const bytes = JSON.stringify(before);
    let thrown: unknown;
    try { applyPatchOperations(before, [
      { op: 'update_node', path: 'release', value: { kind: 'factor' } },
      { op: 'add_edge', path: 'release::mrr', value: edge('release', 'mrr') },
    ]); } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(PatchApplyError);
    expect(thrown).toMatchObject({ code: 'PRECONDITION_RISK_LINKED', message: REASON });
    expect(JSON.stringify(before)).toBe(bytes);
    expect(before.nodes.find((node) => node.id === 'release')).toMatchObject({ kind: 'risk', relies_on: { option_id: 'raise_59' } });
  });

  it('rc3-r1-direct-mutation-writer: a non-patch edge mutation cannot bypass the same central rule', () => {
    const before = graph();
    const bytes = JSON.stringify(before);
    expect(() => applyAndValidateMutation(before, (candidate) => {
      candidate.edges.push(edge('release', 'mrr'));
      return { before: null, after: null };
    })).toThrow(REASON);
    expect(JSON.stringify(before)).toBe(bytes);
  });

  it('rc3-r1-incomplete-model-control: the incident-link backstop permits an unrelated edit to an incomplete model', () => {
    const incomplete = GraphV3.parse({ nodes: [{ id: 'price', kind: 'factor', label: 'Pro plan price' }], edges: [] });
    expect(validateGraphStructure(incomplete).valid).toBe(false);
    expect(applyPatchOperations(incomplete, [{ op: 'update_node', path: 'price', value: { label: 'Pro price' } }]).nodes[0]?.label).toBe('Pro price');
    expect(applyAndValidateMutation(incomplete, (candidate) => {
      candidate.nodes[0]!.label = 'Pro price';
      return { before: null, after: null };
    }).mutatedGraph.nodes[0]?.label).toBe('Pro price');
  });

  it('rc3-r1-raw-floor-control: malformed stamp metadata never crashes the shared check or becomes a stamp', () => {
    for (const stamp of [null, 'raise_59', { option_id: 59 }, { option_id: 'raise_59', extra: true }]) {
      const raw = { nodes: [{ id: 'release', kind: 'risk', label: 'Feature release slips', relies_on: stamp }], edges: [edge('release', 'mrr')] };
      expect(preconditionRiskLinkViolations(raw as never)).toEqual([]);
    }
    const missingOption = { nodes: [{ id: 'release', kind: 'risk', label: 'Feature release slips', relies_on: { option_id: 'gone' } }], edges: [edge('release', 'mrr')] };
    const violation = preconditionRiskLinkViolations(missingOption as never)[0]!;
    expect(violation.code).toBe('PRECONDITION_RISK_LINKED');
    expect(violation.detail).toBe("‘Feature release slips’ is tied to ‘its option’ and left out of the Run; this model can't link it yet.");
    expect(violation.detail).not.toContain('gone');
  });
});
