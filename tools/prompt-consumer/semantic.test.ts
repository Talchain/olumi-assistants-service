import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DraftRecordSetWire, projectDraftRecords } from '../../src/cee/draft/records/seam.js';
import { sha256 } from './contract.js';
import {
  buildBankedDraftSemanticReport, evaluateDraftSemanticCase, loadBankedDraftSemanticObservations,
  localDraftSemanticImplementations, oracleForDraftSemanticObservation,
  type DraftSemanticObservation, type DraftSemanticOracle, type SemanticFidelityBinding,
} from './semantic.js';

const expectedTests = [
  'actual-provider-corpus', 'actual-action-counterpart', 'attribution-not-zero-options', 'invented-baselines',
  'syntax-valid-destruction', 'consumer-only-loss', 'unrelated-object-control', 'label-wording-scope',
  'teapot-refusal', 'missing-oracle', 'fidelity-body-binding', 'runtime-source-binding', 'synthetic-not-provider',
] as const;
const collected: string[] = [];
beforeEach(() => expect.hasAssertions());
afterAll(() => expect(collected.sort()).toEqual([...expectedTests].sort()));
const observations = loadBankedDraftSemanticObservations();
const banked = (id: string): DraftSemanticObservation => structuredClone(observations.find(item => item.id === id)!);
const decision = () => banked('logistics-disagreement-decision-1-candidate');
const diagnostic = () => banked('logistics-disagreement-diagnostic-1-candidate');
const actionOracle = (item: DraftSemanticObservation): DraftSemanticOracle => ({ ...oracleForDraftSemanticObservation(item)!, noAbsoluteMeasurementsSupplied: false });
const assertion = (result: ReturnType<typeof evaluateDraftSemanticCase>, id: string) => result.assertionResults.find(entry => entry.id === id)!;
const synthetic = (item: DraftSemanticObservation): DraftSemanticObservation => ({ ...item, evidenceKind: 'synthetic-mutation' });
const replay = (item: DraftSemanticObservation): DraftSemanticObservation => {
  const seam = projectDraftRecords(item.raw, item.brief);
  if (!seam.ok) throw new Error(seam.reason);
  return { ...synthetic(item), consumedGraph: seam.projection.graph };
};
/** Test-only body binding; never presented as a real serving-fidelity receipt. */
const testReceipt = (item: DraftSemanticObservation): SemanticFidelityBinding => ({
  status: 'PASS', rawSha256: sha256(JSON.stringify(item.raw)), consumedSha256: sha256(JSON.stringify(item.consumedGraph)),
  briefSha256: sha256(item.brief), componentSourceHashes: localDraftSemanticImplementations().sourceHashes, scope: 'UNIT CONTROL ONLY',
});

describe('controlled observations of actual emitted and consumed semantic meaning', () => {
  it('collects the independent 54+2 provider corpus and refuses unmeasured serving/wording claims', () => {
    collected.push('actual-provider-corpus');
    const report = buildBankedDraftSemanticReport();
    expect(report.collectionStatus).toBe('PASS');
    expect(report.cases.map(item => item.id).sort()).toEqual([...report.expectedCaseIds].sort());
    expect(report.cases).toHaveLength(56);
    expect(report.cases.every(item => item.evidenceKind === 'banked-provider')).toBe(true);
    expect(report.status).toBe('FAIL');
    expect(report.behavioralStatus).toBe('UNVERIFIED');
    expect(report.wordingVariation.status).toBe('UNVERIFIED');
    expect(report.promotionPermission).toBe('NOT_GRANTED');
    expect(report.cases.filter(item => item.arm === 'candidate' && item.direction === 'diagnostic').every(item => assertion(item, 'diagnostic.non-collapse').status === 'PASS')).toBe(true);
    expect(report.cases.filter(item => item.arm === 'incumbent' && item.direction === 'diagnostic').some(item => assertion(item, 'diagnostic.non-collapse').status === 'FAIL')).toBe(true);
  });

  it('proves the genuine authored action counterpart through real source, option, provenance and graph connections', () => {
    collected.push('actual-action-counterpart');
    for (const id of ['logistics-disagreement-decision-1-candidate', 'museum-chronology-decision-1-candidate']) {
      const item = banked(id);
      const result = evaluateDraftSemanticCase({ observation: item, oracle: actionOracle(item) });
      expect(result.semanticStatus).toBe('PASS');
      expect(result.behavioralStatus).toBe('UNVERIFIED');
      expect(result.assertionResults.filter(entry => entry.id.startsWith('action.'))).toHaveLength(2);
      expect(result.participation.map(entry => entry.component)).toEqual(['buildDraftRecordsSchema', 'DraftRecordSetWire.parse', 'projectDraftRecords', 'LLMDraftResponse.parse(captured-consumer)']);
      expect(result.participation.every(entry => entry.calls === 1 && entry.sourceSha256.length === 64)).toBe(true);
    }
  });

  it('does not certify candidate hypotheses from zero options: whole actor/proposition attribution is missing', () => {
    collected.push('attribution-not-zero-options');
    const item = diagnostic();
    const result = evaluateDraftSemanticCase({ observation: item, oracle: oracleForDraftSemanticObservation(item) });
    expect(assertion(result, 'diagnostic.non-collapse').status).toBe('PASS');
    expect(assertion(result, 'attribution.operations-overload')).toMatchObject({ status: 'FAIL', evidence: { rawQuotes: [], consumedIds: [] } });
    expect(assertion(result, 'attribution.dispatch-lateness').status).toBe('FAIL');
    expect(result.semanticStatus).toBe('FAIL');
    const hybrid = banked('logistics-disagreement-diagnostic-1-code-only');
    expect(assertion(evaluateDraftSemanticCase({ observation: hybrid, oracle: oracleForDraftSemanticObservation(hybrid) }), 'diagnostic.non-collapse')).toMatchObject({ status: 'FAIL', evidence: { consumedOptions: 2 } });
  });

  it('exposes unsupported absolute baselines in actual output and distinguishes absent values from zero', () => {
    collected.push('invented-baselines');
    const item = diagnostic(), oracle = oracleForDraftSemanticObservation(item)!;
    const measured = assertion(evaluateDraftSemanticCase({ observation: item, oracle }), 'measurement.no-invented-baseline');
    expect(measured.status).toBe('FAIL');
    expect(measured.evidence.emittedBaselines).toHaveLength(5);
    expect(measured.evidence.consumedBaselines).toHaveLength(3);
    const raw = item.raw as { claims: Array<{ claim_kind: string; value?: number }> };
    for (const claim of raw.claims) if (claim.claim_kind === 'factor') delete claim.value;
    const withoutNumbers = replay(item);
    const scoped = { ...oracle, forbidOptions: false, attributedClaims: undefined };
    const absent = assertion(evaluateDraftSemanticCase({ observation: withoutNumbers, oracle: scoped }), 'measurement.no-invented-baseline');
    expect(absent.status).toBe('PASS');
    const factor = raw.claims.find(claim => claim.claim_kind === 'factor')!;
    factor.value = 0;
    expect(assertion(evaluateDraftSemanticCase({ observation: replay(item), oracle: scoped }), 'measurement.no-invented-baseline').status).toBe('FAIL');
  });

  it('RED: syntax-valid semantic destruction survives grammar but not an authored action assertion', () => {
    collected.push('syntax-valid-destruction');
    const item = decision(), oracle = actionOracle(item);
    const raw = item.raw as { stated_items: Array<{ kind: string; source_quote: string }> };
    raw.stated_items[1]!.source_quote = 'cut missed delivery windows';
    expect(DraftRecordSetWire.safeParse(item.raw).success).toBe(true);
    const result = evaluateDraftSemanticCase({ observation: replay(item), oracle });
    expect(result.semanticStatus).toBe('FAIL');
    expect(assertion(result, 'action.authored-1').status).toBe('FAIL');
    expect(assertion(result, 'action.authored-2').status).toBe('PASS');
    expect(result.assertionResults.some(entry => entry.id === 'grammar')).toBe(false);
  });

  it('RED: silent consumer-only loss and false source ownership fail while the primary emission stays valid', () => {
    collected.push('consumer-only-loss');
    const item = decision(), oracle = actionOracle(item);
    const graph = item.consumedGraph as { nodes: Array<{ kind: string; provenance?: { source_quote?: string; provenance_class: string } }> };
    const node = graph.nodes.find(node => node.provenance?.source_quote === 'reducing stops per route')!;
    node.kind = 'factor';
    expect(assertion(evaluateDraftSemanticCase({ observation: synthetic(item), oracle }), 'action.authored-1').status).toBe('FAIL');
    node.kind = 'option';
    node.provenance!.provenance_class = 'ai_inferred';
    expect(assertion(evaluateDraftSemanticCase({ observation: synthetic(item), oracle }), 'action.authored-1')).toMatchObject({ status: 'FAIL', evidence: { badOwnership: true } });
  });

  it('GREEN: a different unrelated object in a risk caption cannot destroy the authored action relationship', () => {
    collected.push('unrelated-object-control');
    const item = decision(), oracle = actionOracle(item);
    const graph = item.consumedGraph as { nodes: Array<{ kind: string; label: string }> };
    graph.nodes.find(node => node.kind === 'risk')!.label = 'A porcelain teapot is now a brass telescope';
    const result = evaluateDraftSemanticCase({ observation: synthetic(item), oracle });
    expect(result.semanticStatus).toBe('PASS');
    expect(result.behavioralStatus).toBe('UNVERIFIED');
  });

  it('accepts a reviewed whole-action paraphrase but refuses unreviewed labels rather than using word overlap', () => {
    collected.push('label-wording-scope');
    const item = decision();
    const oracle = actionOracle(item);
    const graph = item.consumedGraph as { nodes: Array<{ label: string; provenance?: { source_quote?: string } }> };
    const node = graph.nodes.find(node => node.provenance?.source_quote === 'reducing stops per route')!;
    node.label = 'Give each route fewer delivery stops';
    const reviewed = { ...oracle, actions: oracle.actions!.map((action, index) => index ? action : { ...action, acceptedConsumerLabels: ['Give each route fewer delivery stops'] }) };
    expect(evaluateDraftSemanticCase({ observation: synthetic(item), oracle: reviewed }).semanticStatus).toBe('PASS');
    expect(evaluateDraftSemanticCase({ observation: synthetic(item), oracle }).semanticStatus).toBe('UNVERIFIED');
    node.label = 'A teapot explains reducing stops per route';
    expect(evaluateDraftSemanticCase({ observation: synthetic(item), oracle: reviewed }).semanticStatus).toBe('UNVERIFIED');
  });

  it('cannot obtain a semantic pass from unrelated teapot prose with incidental action vocabulary', () => {
    collected.push('teapot-refusal');
    const item = decision(), oracle = actionOracle(item);
    const destroyed = { ...synthetic(item), brief: 'A teapot has two alternatives and a depot. It has uncertainty.' };
    expect(evaluateDraftSemanticCase({ observation: destroyed, oracle }).semanticStatus).toBe('FAIL');
    const retargeted = { ...oracle, briefSha256: sha256(destroyed.brief) };
    const result = evaluateDraftSemanticCase({ observation: destroyed, oracle: retargeted });
    expect(result.semanticStatus).toBe('FAIL');
    expect(result.assertionResults.some(entry => entry.id.startsWith('oracle.authored-'))).toBe(true);
  });

  it('returns UNVERIFIED for an absent oracle or open-ended creative quality', () => {
    collected.push('missing-oracle');
    const missing = evaluateDraftSemanticCase({ observation: decision() });
    expect(missing.semanticStatus).toBe('UNVERIFIED');
    const item = banked('manufacturer-open-decision-1-candidate');
    const result = evaluateDraftSemanticCase({ observation: item, oracle: oracleForDraftSemanticObservation(item) });
    expect(assertion(result, 'action.open-ended-quality').status).toBe('UNVERIFIED');
    expect(assertion(result, 'action.open-ended-quality').evidence.consumedOptions).toHaveLength(5);
  });

  it('refuses a naked or wrong-body fidelity receipt even when the scoped semantic predicates pass', () => {
    collected.push('fidelity-body-binding');
    const item = synthetic(decision()), oracle = actionOracle(item);
    const naked = evaluateDraftSemanticCase({ observation: item, oracle, fidelity: { status: 'PASS' } as SemanticFidelityBinding });
    expect(naked.semanticStatus).toBe('PASS');
    expect(naked.fidelityStatus).toBe('UNVERIFIED');
    const wrong = evaluateDraftSemanticCase({ observation: item, oracle, fidelity: { ...testReceipt(item), consumedSha256: 'f'.repeat(64) } });
    expect(wrong.status).toBe('FAIL');
    expect(wrong.fidelityStatus).toBe('FAIL');
  });

  it('refuses a correct-body receipt for the wrong schema/parser/consumer implementation revision', () => {
    collected.push('runtime-source-binding');
    const item = synthetic(decision()), oracle = actionOracle(item), receipt = testReceipt(item);
    const implementations = localDraftSemanticImplementations();
    const result = evaluateDraftSemanticCase({ observation: item, oracle, fidelity: receipt,
      implementations: { ...implementations, sourceHashes: { ...implementations.sourceHashes, parser: 'e'.repeat(64) } } });
    expect(result.fidelityStatus).toBe('FAIL');
    expect(result.issues).toContain('Semantic replay schema/parser/projector/consumer differs from the measured runtime.');
    const projectorDrift = evaluateDraftSemanticCase({ observation: item, oracle, fidelity: receipt,
      implementations: { ...implementations, sourceHashes: { ...implementations.sourceHashes, projector: 'd'.repeat(64) } } });
    expect(projectorDrift.fidelityStatus).toBe('FAIL');
    expect(result.behavioralStatus).toBe('UNVERIFIED');
  });

  it('never upgrades a synthetic mutation into model-behaviour evidence', () => {
    collected.push('synthetic-not-provider');
    const item = synthetic(decision());
    const result = evaluateDraftSemanticCase({ observation: item, oracle: actionOracle(item), fidelity: testReceipt(item) });
    expect(result.semanticStatus).toBe('PASS');
    expect(result.fidelityStatus).toBe('PASS');
    expect(result.behavioralStatus).toBe('UNVERIFIED');
    expect(result.evidenceKind).toBe('synthetic-mutation');
  });
});
