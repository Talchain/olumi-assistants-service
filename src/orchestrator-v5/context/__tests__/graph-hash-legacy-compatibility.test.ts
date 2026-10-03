import { describe, expect, it } from 'vitest';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../graph-hash.js';
import { computeLegacyAnalysisAffectingGraphHash, computeLegacyAnalysisAffectingGraphHashSha256 } from '../graph-hash-legacy.js';
import { deriveAnalysisFreshness } from '../freshness.js';
import { selectCanonicalAnalysisState } from '../canonical-analysis-state.js';
import { deriveCanonicalNodeLabelTransition } from '../canonical-label-transition.js';
import { bindVersionResults } from '../../model-management/version-result-binding.js';
import { versionRecord, FIX_OWNER } from '../../model-management/__tests__/fixtures.js';
import { factSet } from '../../model-management/__tests__/version-result-fixtures.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { CARRIERS, legacyGraph, legacyRun, LEGACY_SHA256, LEGACY_CHANGED_SHA256, SUBJECT, SCENARIO, AT } from './legacy-gap-projection.fixture.js';
import { stampRunAnalysisProjection, RUN_ANALYSIS_PROJECTION_KEY } from '../analysis-projection-policy.js';

describe.each(CARRIERS)('frozen pre-upgrade identity: %s', carrier => {
  const hash = LEGACY_SHA256[carrier];
  const freshness = (graph: GraphStateIngress) => deriveAnalysisFreshness([legacyRun(carrier)],
    computeAnalysisAffectingGraphHash(graph), undefined, { currentGraph: graph });

  it('pins the exact frozen legacy projection and gap-free byte stability at both widths', () => {
    for (const gaps of [['unmapped effect'], [], undefined]) {
      const graph = legacyGraph(carrier, gaps);
      // Passing undefined uses the default; explicitly remove the fields for the absent control.
      if (gaps === undefined) for (const row of [...graph.nodes, ...(graph.options as Record<string, unknown>[] ?? [])]) delete row.unresolved_targets;
      expect(computeLegacyAnalysisAffectingGraphHashSha256(graph)).toBe(hash);
      expect(computeLegacyAnalysisAffectingGraphHash(graph)).toBe(hash.slice(0, 16));
      if (gaps?.length !== 1) {
        expect(computeAnalysisAffectingGraphHashSha256(graph)).toBe(hash);
        expect(computeAnalysisAffectingGraphHash(graph)).toBe(hash.slice(0, 16));
      }
    }
  });

  it('legacy gapped Run stays stale after upgrade and after the last gap is cleared', () => {
    const gapped = legacyGraph(carrier);
    const cleared = legacyGraph(carrier, []);
    expect(buildCanonicalAnalysisReadyFromGraph(gapped)?.options.find(o => o.option_id === SUBJECT)?.status).toBe('needs_user_mapping');
    expect(buildCanonicalAnalysisReadyFromGraph(cleared)?.options.find(o => o.option_id === SUBJECT)?.status).toBe('ready');
    expect(RunAnalysisHandlerFactSchema.safeParse(legacyRun(carrier)).success).toBe(true);
    expect(freshness(gapped)).toMatchObject({ freshness: 'stale', computed_at: AT });
    expect(freshness(cleared)).toMatchObject({ freshness: 'stale', reason: 'legacy_admission_unverified', computed_at: AT });
    for (const row of [...cleared.nodes, ...(cleared.options as Record<string, unknown>[] ?? [])]) delete row.unresolved_targets;
    expect(freshness(cleared)).toMatchObject({ freshness: 'stale', reason: 'legacy_admission_unverified' });
    expect(selectCanonicalAnalysisState({ priorFacts: [legacyRun(carrier)], currentGraphHash: hash.slice(0, 16),
      currentGraph: cleared, priorFactsReadOk: true })).toMatchObject({ freshness: 'stale', usableForChips: false });
  });

  it('legacy gap-free Run with no carrier stays fresh without churn', () => {
    const graph = legacyGraph(carrier, []);
    for (const row of [...graph.nodes, ...(graph.options as Record<string, unknown>[] ?? [])]) delete row.unresolved_targets;
    expect(deriveAnalysisFreshness([legacyRun(carrier, false, true)], computeAnalysisAffectingGraphHash(graph),
      undefined, { currentGraph: graph })).toMatchObject({ freshness: 'fresh', reason: 'graph_hash_match' });
  });

  it('documents the residual ambiguity when every gap carrier is deleted', () => {
    const graph = legacyGraph(carrier, []);
    for (const row of [...graph.nodes, ...(graph.options as Record<string, unknown>[] ?? [])]) delete row.unresolved_targets;
    // The same legacy digest is now indistinguishable from the gap-free
    // control above. This is the explicitly permitted fallback's limit.
    const unrecorded = legacyRun(carrier);
    delete unrecorded.result.input_snapshot;
    expect(deriveAnalysisFreshness([unrecorded], computeAnalysisAffectingGraphHash(graph),
      undefined, { currentGraph: graph }).freshness).toBe('fresh');
  });

  it('confirms an old Run even when a NULL-hash legacy reader derived the current version digest', () => {
    const version = versionRecord(legacyGraph(carrier));
    expect(version.analysis_affecting_hash).not.toBe(hash);
    expect(bindVersionResults({ scenarioId: SCENARIO, from: version, to: version,
      factSet: factSet([legacyRun(carrier)]) })).toMatchObject({ kind: 'shared' });
    expect(freshness(legacyGraph(carrier)).freshness).toBe('stale');
  });

  it('confirms the legacy gapped version and shared recorded Run in both Compare directions', () => {
    const from = versionRecord(legacyGraph(carrier), { analysis_affecting_hash: hash });
    const to = versionRecord(legacyGraph(carrier), { id: '22222222-2222-4222-8222-222222222222', analysis_affecting_hash: hash });
    for (const [a, b] of [[from, to], [to, from]]) {
      expect(bindVersionResults({ scenarioId: SCENARIO, from: a!, to: b!, factSet: factSet([legacyRun(carrier)]) }))
        .toMatchObject({ kind: 'shared', recordedRun: { graph_hash_at_run: hash.slice(0, 16), run_id: 'legacy-original' } });
    }
  });

  it('confirms paired legacy Runs and preserves their recorded 16-hex identities', () => {
    const changed = legacyGraph(carrier);
    changed.nodes.find(n => n.id === 'factor')!.observed_state = { value: 0.5 };
    expect(computeLegacyAnalysisAffectingGraphHashSha256(changed)).toBe(LEGACY_CHANGED_SHA256[carrier]);
    const from = versionRecord(legacyGraph(carrier), { analysis_affecting_hash: hash });
    const to = versionRecord(changed, { id: '22222222-2222-4222-8222-222222222222', analysis_affecting_hash: LEGACY_CHANGED_SHA256[carrier] });
    for (const [a, b] of [[from, to], [to, from]]) {
      expect(bindVersionResults({ scenarioId: SCENARIO, from: a!, to: b!, factSet: factSet([legacyRun(carrier), legacyRun(carrier, true)]) }).kind).toBe('paired');
    }
  });

  it('keeps a legacy version label-history join without weakening full identity validation', () => {
    const parentId = '11111111-1111-4111-8111-111111111111';
    const ref = { scenario_id: SCENARIO, owner_user_id: FIX_OWNER, source_turn_id: 'label-turn',
      mutation_id: 'label-mutation', conversation_row_id: 'label-row' };
    const parent = versionRecord(legacyGraph(carrier), { id: parentId, root_version_id: parentId,
      creation_kind: 'initial', analysis_affecting_hash: hash });
    const graph = legacyGraph(carrier);
    graph.nodes.find(n => n.id === SUBJECT)!.label = 'Expansion';
    const child = versionRecord(graph, { id: '22222222-2222-4222-8222-222222222222', parent_version_id: parentId,
      root_version_id: parentId, creation_kind: 'committed_mutation', source_turn_id: ref.source_turn_id,
      mutation_id: ref.mutation_id, version_number: 2, analysis_affecting_hash: hash });
    expect(deriveCanonicalNodeLabelTransition(ref, child, parent)).toEqual({ kind: 'node_label_changed', before_label: 'Expand', after_label: 'Expansion' });
    expect(deriveCanonicalNodeLabelTransition(ref, { ...child, graph_identity_hash: 'f'.repeat(64) }, parent)).toBeNull();
    expect(deriveCanonicalNodeLabelTransition(ref, { ...child, analysis_affecting_hash: 'f'.repeat(64) }, parent)).toBeNull();
  });
});

describe('legacy node shapes with a valid mirror', () => {
  const FROZEN_LEGACY = {
    option: 'e2a118c22bac9b69fc06ec86a26e21762013755bf51a28b1c21db0375fe530e1',
    factor: 'd23400714100301ef9062ac5d4efeec6f82d8716cc3f41748cc0dc7cd574f105',
    goal: '4fcd3178dd444395bf059be072d14da6a434bc0fd34e1fb51bad38496960cc02',
  };
  it.each(['option', 'factor', 'goal'] as const)('missing/null/numeric ids on %s never throw and retain pre-gap bytes', kind => {
    for (const id of [undefined, null, 42]) {
      const graph = { nodes: [{ kind, label: 'Legacy node', ...(id === undefined ? {} : { id }) }], edges: [],
        options: [{ id: 'valid-option', label: 'Valid mirror', status: 'ready', interventions: { factor: { value: 0.5 } } }] } as unknown as GraphStateIngress;
      const before = structuredClone(graph);
      const legacy = FROZEN_LEGACY[kind];
      expect(computeLegacyAnalysisAffectingGraphHashSha256(graph)).toBe(legacy);
      expect(() => computeAnalysisAffectingGraphHashSha256(graph)).not.toThrow();
      expect(computeAnalysisAffectingGraphHashSha256(graph)).toBe(legacy);
      expect(graph).toEqual(before);
    }
  });
});

describe('projection evidence cannot be silently repaired', () => {
  it.each([undefined, null, {}, { nodes: [], edges: 'invalid' }])('withholds legacy freshness without a verifiable graph: %j', graph => {
    const fact = legacyRun('node');
    expect(deriveAnalysisFreshness([fact], fact.result.graph_hash_at_run!, undefined, { currentGraph: graph }))
      .toMatchObject({ freshness: 'stale', reason: 'legacy_admission_unverified' });
  });
  it('unknown projection stamps fail closed; a supported stamp preserves new Run freshness', () => {
    const graph = legacyGraph('both', []);
    const fact = legacyRun('both');
    const hash = computeAnalysisAffectingGraphHash(graph);
    fact.result.enrichment = { [RUN_ANALYSIS_PROJECTION_KEY]: 'unsupported' };
    expect(deriveAnalysisFreshness([fact], hash, undefined, { currentGraph: graph }).freshness).toBe('stale');
    fact.result.enrichment = stampRunAnalysisProjection({ analysis_status: 'computed' });
    expect(RunAnalysisHandlerFactSchema.safeParse(fact).success).toBe(true);
    expect(deriveAnalysisFreshness([fact], hash, undefined, { currentGraph: graph }).freshness).toBe('fresh');
  });
  it.each(['unresolved_targets', 'user_questions'])('any option %s field, even null, empty or shadowed, makes an unstamped Run ambiguous', field => {
    const graph = legacyGraph('both', []);
    for (const row of [...graph.nodes, ...(graph.options as Record<string, unknown>[] ?? [])]) delete row.unresolved_targets;
    for (const value of [null, [], ['old gap note']]) {
      graph.nodes.find(n => n.id === SUBJECT)![field] = value;
      expect(deriveAnalysisFreshness([legacyRun('both')], LEGACY_SHA256.both.slice(0, 16), undefined, { currentGraph: graph }).freshness).toBe('stale');
    }
  });
});
