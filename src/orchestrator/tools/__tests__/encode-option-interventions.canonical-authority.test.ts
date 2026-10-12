import { GraphStateIngressSchema } from '../../../orchestrator-v5/boundary/request-extensions.js';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import * as ts from 'typescript';
import * as nodeUtil from 'node:util';
import * as normalise from '../../../orchestrator-v5/tools/handlers/d1-shared/normalise-factor-value.js';
import * as provenance from '../../../cee/graph-readiness/obligation-provenance.js';
import * as spellings from '../../canonicalise-value-ops.js';
import * as telemetry from '../../../utils/telemetry.js';
import * as scales from '../../../orchestrator-v5/tools/plot-intervention-scale.js';
import * as proposal from '../../../orchestrator-v5/tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import { GraphV3, InterventionV3, OptionV3, type GraphV3T, type InterventionV3T } from '../../../schemas/cee-v3.js';
import { applyPatchOperations } from '../../patch-applier.js';
import { probes, prepare, admitted } from '../../../orchestrator-v5/agent-lane/__tests__/fixtures/r5-verified-cases.js';
import { projectGraphForPersistence } from '../../../orchestrator-v5/persisted-graph-projection.js';
import { encodeOptionInterventionsForEdit, type InterventionHumanAuthority, type InterventionPreimageScope } from '../encode-option-interventions.js';

import { computeAnalysisAffectingGraphHash } from '../../../orchestrator-v5/context/graph-hash.js';
import { assessCanonicalAnalysisReadiness } from '../analysis-ready-helper.js';
import { collectLeaderEstimatedTargetIds, deriveConstraintVerdict, type RatifiedConstraint } from '../../context/constraint-feasibility.js';
import { canonicaliseForAnalysis } from '../../../orchestrator-v5/tools/handlers/analysis-ready-core.js';
import { transformOptionToAnalysisReady, buildAnalysisReadyPayload } from '../../../cee/transforms/analysis-ready.js';
import { decideOptionCostAsk } from '../../../orchestrator-v5/coaching/decide-option-cost-ask.js';

const modulePath = resolve('src/orchestrator/tools/encode-option-interventions.ts');
const moduleBytes = readFileSync(modulePath, 'utf8');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const approved = [{ optionId: 'opt_a', factorId: 'fac_a' }];
function cell(source: InterventionV3T['source'] = 'brief_extraction'): InterventionV3T {
  return { value: 0.4, source,
    target_match: { node_id: 'fac_a', match_type: 'exact_id', confidence: 'high' },
    unit: 'riders', raw_value: 40,
    range: { low: 30, high: 50, meaning: 'likely_range', source: 'user_specified' } };
}
function snapshot(bundle: Record<string, InterventionV3T> = {}): GraphV3T {
  return GraphV3.parse({ nodes: [
    { id: 'goal', kind: 'goal', label: 'Trips' },
    { id: 'fac_a', kind: 'factor', label: 'Riders', observed_state: { value: 0.2, cap: 100, unit: 'riders' } },
    { id: 'fac_b', kind: 'factor', label: 'Other riders', observed_state: { value: 0.2, cap: 100, unit: 'riders' } },
    { id: 'opt_a', kind: 'option', label: 'First option', interventions: bundle },
    { id: 'opt_b', kind: 'option', label: 'Second option', interventions: {} },
  ], edges: [], options: [], goal_node_id: 'goal' });
}
function update(before: GraphV3T, replacement: unknown, option = 'opt_a', root: 'interventions' | 'data/interventions' = 'interventions') {
  // Parsed internal update_node ops name the node, with a nested updates object.
  const value = root === 'interventions' ? { interventions: replacement } : { data: { interventions: replacement } };
  // The edit writer keeps the persisted envelope around the pure applier's nodes/edges.
  return { ...before, ...applyPatchOperations(before, [{ op: 'update_node', path: option, value }]) };
}
function readCell(graph: GraphV3T, factor = 'fac_a', option = 'opt_a'): InterventionV3T {
  const node = graph.nodes.find(n => n.id === option);
  if (!node?.interventions?.[factor]) throw new Error(`Missing ${option}/${factor}`);
  return InterventionV3.parse(node.interventions[factor]);
}
function scope(before: GraphV3T): InterventionPreimageScope {
  const revision = computeAnalysisAffectingGraphHash(before);
  return { scenarioId: 'scenario-a', persistedScenarioId: 'scenario-a', modelRevision: revision, expectedModelRevision: revision };
}
function encode(graph: GraphV3T, before?: GraphV3T | null, authority: InterventionHumanAuthority = [], touched = new Set(['opt_a']), proof = before ? scope(before) : null) {
  const result = encodeOptionInterventionsForEdit(graph, touched, undefined, authority, before, proof);
  expect(result.unresolvedOptionIds).toStrictEqual([]);
  return result.graph;
}
function unmarked(value: InterventionV3T) {
  const { source: _source, ...rest } = value;
  return rest;
}

// In-memory mutants execute the actual module with its real dependencies. No disk experiment or extra spec run.
function mutantModule(old: string, replacement: string) {
  expect(moduleBytes.split(old)).toHaveLength(2);
  const code = ts.transpileModule(moduleBytes.replace(old, replacement), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies: Record<string, unknown> = {
    '../../orchestrator-v5/tools/handlers/d1-shared/normalise-factor-value.js': normalise,
    'node:util': nodeUtil,
    '../../orchestrator-v5/boundary/request-extensions.js': { GraphStateIngressSchema },
    '../../orchestrator-v5/context/graph-hash.js': { computeAnalysisAffectingGraphHash },
    '../../cee/graph-readiness/obligation-provenance.js': provenance,
    '../canonicalise-value-ops.js': spellings,
    '../../utils/telemetry.js': telemetry,
    '../../orchestrator-v5/tools/plot-intervention-scale.js': scales,
    '../../orchestrator-v5/tools/handlers/d1-shared/evaluate-factor-value-proposal.js': proposal,
  };
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', code)((id: string) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  }, exports);
  const encoder = exports.encodeOptionInterventionsForEdit;
  if (typeof encoder !== 'function') throw new Error('Missing mutant encoder');
  return encoder;
}
function omissions(text: string): number[] {
  const file = ts.createSourceFile('caller.ts', text, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'encodeOptionInterventionsForEdit') {
      const preimage = node.arguments[4];
      if (!preimage || !node.arguments[5] || (preimage.kind === ts.SyntaxKind.NullKeyword
        && !node.getText(file).includes('preimage'))) {
        lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return lines;
}
function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__tests__' || /^run.*-out$/.test(entry.name)) return [];
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? productionFiles(path)
      : /\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [path] : [];
  });
}

describe('RUN63b canonical intervention authority at the real encode boundary', () => {
  it('RUN66b read-only continuity keeps the original graph reference and every cell byte', () => {
    const graph = snapshot({ fac_a: cell() }); const bytes = JSON.stringify(graph);
    expect(canonicaliseForAnalysis(graph)).toBe(graph);
    expect(JSON.stringify(graph)).toBe(bytes);
  });
  it('RUN66b extraction metadata requires current exact-cell authority, never historical continuity', () => {
    const graph = snapshot({ fac_a: { ...cell('user_specified'), reasoning: 'Original claim' } });
    const bytes = JSON.stringify(graph);
    const option = OptionV3.parse({ ...graph.nodes.find(n => n.id === 'opt_a'), status: 'ready' });
    const without = transformOptionToAnalysisReady(option);
    const withAuthority = transformOptionToAnalysisReady(option, 0, false, approved);
    const siblingOnly = transformOptionToAnalysisReady(option, 0, false, [{ optionId: 'opt_a', factorId: 'fac_b' }]);
    expect(without.extraction_metadata?.source).toBeUndefined();
    expect(siblingOnly.extraction_metadata?.source).toBeUndefined();
    expect(withAuthority.extraction_metadata?.source).toBe('user_specified');
    const historical = OptionV3.parse({ ...option, interventions: { fac_a: cell('brief_extraction') } });
    expect(transformOptionToAnalysisReady(historical, 0, false, approved).extraction_metadata?.source).toBe('user_specified');
    expect(historical.interventions.fac_a.source).toBe('brief_extraction');
    expect(without.extraction_metadata?.reasoning).toBe('Original claim');
    expect(without.interventions).toStrictEqual(withAuthority.interventions);
    expect(JSON.stringify(graph)).toBe(bytes);
  });
  it('RUN66b direct raw-magnitude licence needs exact authority; number, native frame and stored bytes stay', () => {
    const graph = snapshot({ fac_a: { ...cell('user_specified'), reasoning: 'Direct causal value bound by edge' } });
    const bytes = JSON.stringify(graph);
    const option = OptionV3.parse({ ...graph.nodes.find(n => n.id === 'opt_a'), status: 'ready',
      raw_interventions: { fac_a: 40 }, provenance: { source: 'brief_extraction', brief_quote: 'Original claim' } });
    const without = buildAnalysisReadyPayload([option], 'goal', graph);
    const withAuthority = buildAnalysisReadyPayload([option], 'goal', graph, { humanAuthority: approved });
    const unresolved = (payload: typeof without) => payload.blockers?.filter(b => b.factor_id === 'fac_a'
      && b.blocker_type === 'ambiguous_value' && b.message.includes('source binding is unresolved')) ?? [];
    expect(unresolved(without)).toHaveLength(1);
    expect(unresolved(withAuthority)).toStrictEqual([]);
    expect(without.options[0].raw_interventions).toStrictEqual(withAuthority.options[0].raw_interventions);
    expect(without.options[0].intervention_details).toStrictEqual(withAuthority.options[0].intervention_details);
    expect(JSON.stringify(graph)).toBe(bytes);
  });
  it('RUN66b obligation wording checks the exact effect, not its option or stored source', () => {
    const graph = snapshot({ fac_a: cell('user_specified') }); const bytes = JSON.stringify(graph);
    const issue = { issue_id: 'missing', code: 'MISSING_OPTION_VALUE' as const, category: 'option_values' as const,
      message: 'Existing ask', repairability: 'human_input_required' as const, option_id: 'opt_a', factor_id: 'fac_a' };
    expect(provenance.classifyIssueObligation(issue, graph, [], []).provenance).toBe('unattributed');
    expect(provenance.classifyIssueObligation(issue, graph, [], approved).provenance).toBe('user_stated');
    expect(provenance.classifyIssueObligation(issue, graph, [], [{ optionId: 'opt_a', factorId: 'fac_b' }]).provenance).toBe('unattributed');
    const withSibling = snapshot({ fac_a: cell('user_specified'), fac_b: { ...cell(), source: undefined } });
    expect(provenance.structureProvenanceOfEffect(withSibling, 'opt_a', 'fac_b', approved)).toBe('unattributed');
    expect(JSON.stringify(graph)).toBe(bytes);
  });
  it('RUN66b native rule (d) withholds unknown authority without calling it an AI estimate', () => {
    const graph = snapshot({ fac_a: cell('user_specified') }); const bytes = JSON.stringify(graph);
    const ratified: RatifiedConstraint[] = [{ constraint_id: 'limit', label: 'Riders limit', node_id: 'fac_a' }];
    const options = graph.nodes.filter(n => n.kind === 'option');
    const unattributed = new Set<string>();
    const without = collectLeaderEstimatedTargetIds(graph, ratified, 'opt_a',
      { options, held: [], humanAuthority: [], unattributedTargetIds: unattributed });
    const withAuthority = collectLeaderEstimatedTargetIds(graph, ratified, 'opt_a',
      { options, held: [], humanAuthority: approved });
    expect([...without]).toStrictEqual(['limit']);
    expect([...unattributed]).toStrictEqual(['limit']);
    expect([...withAuthority]).toStrictEqual([]);
    const envelope = { constraints_status: 'computed',
      constraint_results: [{ constraint_id: 'limit', scale_provenance: { source: 'scale_frame', range_unified: true, decision_grade: true } }],
      option_comparison: [{ option_id: 'opt_a', constraint_probabilities: { limit: 0.9 } }] };
    const result = deriveConstraintVerdict(envelope, ratified, 'opt_a', undefined, without,
      { userBaselineIds: new Set(['limit']), userAssumptionIds: new Set(), unattributedInterventionIds: unattributed });
    expect(result.perLimit).toStrictEqual([{ constraint_id: 'limit', state: 'unscored', reason: 'base_owner_unestablished' }]);
    expect(deriveConstraintVerdict(envelope, ratified, 'opt_a', undefined, withAuthority,
      { userBaselineIds: new Set(['limit']), userAssumptionIds: new Set() }).perLimit)
      .toStrictEqual([{ constraint_id: 'limit', state: 'scored' }]);
    expect(JSON.stringify(graph)).toBe(bytes);
  });
  it('RUN66b native-cost answer suppression requires current exact-cell authority, graph bytes unchanged', () => {
    const graph = snapshot({ fac_a: cell('user_specified') }); const bytes = JSON.stringify(graph);
    const input = { notDecisionGrade: true, ratified: [{ constraint_id: 'limit', node_id: 'fac_a', unit: 'riders' }],
      nodes: graph.nodes, options: graph.nodes.filter(n => n.kind === 'option') };
    expect(decideOptionCostAsk(input)).toMatchObject({ option_id: 'opt_a', factor_id: 'fac_a' });
    expect(decideOptionCostAsk({ ...input, humanAuthority: approved })).toBeNull();
    expect(decideOptionCostAsk({ ...input, humanAuthority: [{ optionId: 'opt_a', factorId: 'fac_b' }] }))
      .toMatchObject({ option_id: 'opt_a', factor_id: 'fac_a' });
    expect(JSON.stringify(graph)).toBe(bytes);
  });

  it.each(['brief_extraction', 'user_specified'] as const)('%s: new model stamp absent; exact human change is user_specified', source => {
    const before = snapshot(); const written = cell(source);
    const after = update(before, { fac_a: written });
    expect(readCell(encode(after, before))).toStrictEqual(unmarked(written));
    expect(provenance.classifyValueSource(readCell(encode(after, before)).source)).toBe('unattributed');
    expect(readCell(encode(after, before, approved))).toStrictEqual({ ...written, source: 'user_specified' });
    expect(before).toStrictEqual(snapshot());
    expect(readCell(after)).toStrictEqual(written);
  });
  it('non-user cee_hypothesis fabric passes unchanged', () => {
    const before = snapshot(); const written = { ...cell('cee_hypothesis'), reasoning: 'Draft estimate', value_confidence: 'medium' as const };
    expect(readCell(encode(update(before, { fac_a: written }), before))).toStrictEqual(written);
  });
  it('data.interventions and canonical demotion are byte-equal, with value/raw/unit/range/target retained', () => {
    const before = snapshot(); const written = cell();
    const canonical = encode(update(before, { fac_a: written }), before);
    const data = encode(update(before, { fac_a: written }, 'opt_a', 'data/interventions'), before);
    expect(readCell(data)).toStrictEqual(readCell(canonical));
    expect(JSON.stringify(data.nodes.find(n => n.id === 'opt_a')!.interventions!.fac_a))
      .toBe(JSON.stringify(canonical.nodes.find(n => n.id === 'opt_a')!.interventions!.fac_a));
  });
  it('human authority is cell-scoped, not option-wide', () => {
    const before = snapshot(); const sibling = { ...cell(), target_match: { ...cell().target_match, node_id: 'fac_b' } };
    const after = encode(update(before, { fac_a: cell(), fac_b: sibling }), before, approved);
    expect(readCell(after)).toStrictEqual({ ...cell(), source: 'user_specified' });
    expect(readCell(after, 'fac_b')).toStrictEqual(unmarked(sibling));
  });
  it.each([new Set(['opt_b']), new Set(['opt_a'])])('persisted unchanged credit survives touched set %j', touched => {
    const before = snapshot({ fac_a: cell() });
    expect(readCell(encode(structuredClone(before), before, [], touched))).toStrictEqual(cell());
  });
  it('real receipt-admitted N0 graph retains its verified cell across an unrelated edit', () => {
    const original = probes.find(p => p.id === 'N0');
    if (!original) throw new Error('Missing original N0 control');
    const model = structuredClone(original.model);
    const receiptCell = model.options.find(o => o.label === original.option)?.interventions?.find(iv => iv.factor_label === original.factor);
    if (!receiptCell) throw new Error('Missing N0 receipt cell');
    // Original protected control setup supplies this exact receipt; no invented quote.
    receiptCell.stated_evidence = original.evidence;
    const prepared = prepare(model, original.brief);
    const before = GraphV3.parse(admitted(prepared.candidate, original.brief));
    const option = before.nodes.find(n => n.label === original.option)!;
    const factor = before.nodes.find(n => n.label === original.factor)!;
    expect(readCell(before, factor.id, option.id).source).toBe('brief_extraction');
    const encoded = encodeOptionInterventionsForEdit(structuredClone(before), new Set(['unrelated']), undefined, [], before, scope(before)).graph;
    expect(readCell(encoded, factor.id, option.id)).toStrictEqual(readCell(before, factor.id, option.id));
  });
  const changes: Array<[string, Partial<InterventionV3T>]> = [
    ['value', { value: 0.45 }], ['raw_value', { raw_value: 45 }], ['unit', { unit: 'trips' }],
    ['range', { range: { low: 20, high: 60, meaning: 'likely_range', source: 'user_specified' } }],
    ['target_match', { target_match: { node_id: 'fac_b', match_type: 'exact_id', confidence: 'high' } }],
    ['source', { source: 'user_specified' }],
    ['basis', { basis: 'absolute' }],
    ['receipt', { receipt: { quote: 'different original words' } }],
    ['stated_evidence', { stated_evidence: { quote: 'different original words' } }],
    ['reasoning', { reasoning: 'Different claim basis' }],
    ['value_kind', { value_kind: 'additional' }],
    ['derived_total', { derived_total: true }],
  ];
  it.each(changes)('persisted equality refuses changed %s', (_name, delta) => {
    const before = snapshot({ fac_a: cell() }); const written = { ...cell(), ...delta };
    expect(readCell(encode(update(before, { fac_a: written }), before))).toStrictEqual(unmarked(written));
  });
  it.each(['unit', 'cap', 'kind', 'label', 'factor_type'] as const)('changed factor %s invalidates continuity', field => {
    const before = snapshot({ fac_a: cell() }); const after = structuredClone(before);
    const factor = after.nodes.find(n => n.id === 'fac_a')!;
    if (field === 'unit') factor.observed_state!.unit = 'trips';
    else if (field === 'cap') factor.observed_state!.cap = 200;
    else if (field === 'kind') factor.kind = 'goal';
    else if (field === 'label') factor.label = 'Trips';
    else factor.factor_type = 'categorical';
    expect(readCell(encode(after, before))).toStrictEqual(unmarked(cell()));
  });
  it.each(['stale', 'scenario', 'absent', 'blank'] as const)('no continuity for %s revision proof', issue => {
    const before = snapshot({ fac_a: cell() });
    const proof = issue === 'absent' ? null : { ...scope(before),
      ...(issue === 'stale' ? { expectedModelRevision: 'stale' } : {}),
      ...(issue === 'scenario' ? { persistedScenarioId: 'different' } : {}),
      ...(issue === 'blank' ? { modelRevision: null, expectedModelRevision: null } : {}) };
    expect(readCell(encode(structuredClone(before), before, [], undefined, proof))).toStrictEqual(unmarked(cell()));
  });
  it('unchanged old unproved stamp and full receipt/basis remain historical data', () => {
    const historical = { ...cell(), basis: 'absolute', stated_evidence: { quote: 'Unproved historic claim' },
      receipt: { source_hash: 'original-hash', quote: 'Unproved historic claim' } };
    const before = snapshot({ fac_a: historical });
    expect(readCell(encode(structuredClone(before), before))).toStrictEqual(historical);
  });
  it('analysis withholds a fresh source verdict without rewriting history or proposing source-only migration', () => {
    const before = snapshot({ fac_a: cell() }); const bytes = JSON.stringify(before);
    const assessment = assessCanonicalAnalysisReadiness(before);
    expect(JSON.stringify(before)).toBe(bytes);
    expect(assessment.issues.filter(issue => issue.code === 'OPTION_NEEDS_ENCODING')).toStrictEqual([]);
    expect(assessment.proposedGraph).toBeNull();
    if (assessment.canonicalGraph) expect(readCell(GraphV3.parse(assessment.canonicalGraph))).toStrictEqual(cell());
    // An analysis view cannot use a bare historic source as a new verified cell verdict.
    const view = encodeOptionInterventionsForEdit(before, undefined, undefined, [], null /* no scoped preimage */, null).graph;
    expect(readCell(view)).toStrictEqual(unmarked(cell()));
  });
  it('readiness options mirror cannot renew inherited authorship or a fresh numeric licence', () => {
    const before = GraphV3.parse(projectGraphForPersistence(snapshot({ fac_a: cell() })));
    const bytes = JSON.stringify(before);
    const assessment = assessCanonicalAnalysisReadiness(before);
    const option = assessment.analysisReady?.options.find(o => o.option_id === 'opt_a');
    expect(option).toBeDefined();
    expect(option?.interventions.fac_a).toBe(cell().value);
    expect(option?.extraction_metadata?.source).toBeUndefined();
    expect(assessment.issues.filter(issue => issue.code === 'OPTION_NEEDS_ENCODING')).toStrictEqual([]);
    expect(JSON.stringify(before)).toBe(bytes);
    expect(readCell(before).source).toBe('brief_extraction');
  });
  it('source copied to another option or factor is not persisted authority', () => {
    const before = snapshot({ fac_a: cell() });
    expect(readCell(encode(update(before, { fac_a: cell() }, 'opt_b'), before), 'fac_a', 'opt_b')).toStrictEqual(unmarked(cell()));
    expect(readCell(encode(update(before, { fac_b: cell() }), before), 'fac_b')).toStrictEqual(unmarked(cell()));
  });
  it('omitted/null preimage fails closed; payload-smuggled preimage is ignored', () => {
    const before = snapshot({ fac_a: cell() }); const after = update(snapshot(), { fac_a: cell() });
    const smuggled = { ...after, ...applyPatchOperations(after, [{ op: 'update_node', path: 'opt_a', value: { data: { persistedGraph: before } } }]) };
    expect(readCell(encode(smuggled))).toStrictEqual(unmarked(cell()));
    expect(readCell(encode(smuggled, null))).toStrictEqual(unmarked(cell()));
    expect(readCell(encode(smuggled, undefined, approved))).toStrictEqual({ ...cell(), source: 'user_specified' });
  });
  it('ambiguous duplicate persisted option identity does not license credit', () => {
    const before = snapshot({ fac_a: cell() }); before.nodes.push(structuredClone(before.nodes.find(n => n.id === 'opt_a')!));
    expect(readCell(encode(update(snapshot(), { fac_a: cell() }), before))).toStrictEqual(unmarked(cell()));
  });
  it.each(['fac_a', 'opt_a'] as const)('ambiguous duplicate persisted %s identity refuses continuity', id => {
    const before = snapshot({ fac_a: cell() }); before.nodes.push(structuredClone(before.nodes.find(n => n.id === id)!));
    expect(readCell(encode(structuredClone(snapshot({ fac_a: cell() })), before))).toStrictEqual(unmarked(cell()));
  });
  it('projection and JSON reload retain unattributed, approved and unchanged cells', () => {
    const before = snapshot({ fac_a: cell() });
    const written = { ...cell(), value: 0.45, raw_value: 45 };
    for (const [after, authority] of [[update(before, { fac_a: written }), []], [update(before, { fac_a: written }), approved], [structuredClone(before), []]] as const) {
      const encoded = encodeOptionInterventionsForEdit(after, new Set(['opt_a']), undefined, authority, before, scope(before)).graph;
      const reloaded = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(encoded, { humanAuthority: authority }))));
      expect(readCell(reloaded)).toStrictEqual(readCell(encoded));
    }
  });
  it('production callers provide their preimage explicitly; omission mutant is RED', () => {
    const violations = productionFiles(resolve('src')).flatMap(path => omissions(readFileSync(path, 'utf8')).map(line => `${relative(process.cwd(), path)}:${line}`));
    expect(violations).toStrictEqual([]);
    const caller = 'encodeOptionInterventionsForEdit(after, touched, undefined, approved, before, scope);';
    expect(omissions(caller)).toStrictEqual([]);
    expect(() => expect(omissions(caller.replace(', scope', ''))).toStrictEqual([])).toThrow();
  });
  it('mutant: omit basis from full equality -> changed authority basis RED, bytes untouched', () => {
    const encoder = mutantModule('isDeepStrictEqual(previous, cell)',
      'isDeepStrictEqual({ ...previous, basis: undefined }, { ...cell, basis: undefined })');
    const previous = { ...cell(), basis: 'original' };
    const before = snapshot({ fac_a: previous });
    const written = { ...previous, basis: 'changed' };
    const after = update(before, { fac_a: written });
    const expected = encodeOptionInterventionsForEdit(after, undefined, undefined, [], before, scope(before));
    expect(readCell(expected.graph).source).toBeUndefined();
    expect(() => expect(encoder(after, undefined, undefined, [], before, scope(before))).toStrictEqual(expected)).toThrow();
    expect(sha(readFileSync(modulePath, 'utf8'))).toBe(sha(moduleBytes));
  });
  it('mutant: omit revision check -> stale preimage RED, bytes untouched', () => {
    const encoder = mutantModule('scope.modelRevision === scope.expectedModelRevision', 'true');
    const before = snapshot({ fac_a: cell() }); const after = structuredClone(before);
    const stale = { ...scope(before), expectedModelRevision: 'stale' };
    const expected = encodeOptionInterventionsForEdit(after, undefined, undefined, [], before, stale);
    expect(readCell(expected.graph).source).toBeUndefined();
    expect(() => expect(encoder(after, undefined, undefined, [], before, stale)).toStrictEqual(expected)).toThrow();
    expect(sha(readFileSync(modulePath, 'utf8'))).toBe(sha(moduleBytes));
  });
  it('mutant: remove exact human authority -> approved control RED, bytes untouched', () => {
    const old = 'const approved = humanAuthority.some(pair => pair.optionId === id && pair.factorId === fac);';
    const encoder = mutantModule(old, 'const approved = false;');
    const before = snapshot(); const after = update(before, { fac_a: cell() });
    const expected = encodeOptionInterventionsForEdit(after, undefined, undefined, approved, before, scope(before));
    expect(readCell(expected.graph).source).toBe('user_specified');
    expect(() => expect(encoder(after, undefined, undefined, approved, before, scope(before))).toStrictEqual(expected)).toThrow();
    expect(sha(readFileSync(modulePath, 'utf8'))).toBe(sha(moduleBytes));
  });
});
