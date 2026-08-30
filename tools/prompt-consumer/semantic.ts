/** Offline semantic observations, not an intent classifier or a model-quality certificate.
 * Source-span assertions are deliberately closed-world. Unreviewed paraphrases and
 * open-ended creative quality remain UNVERIFIED rather than becoming keyword tests.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv } from 'ajv';
import { buildDraftRecordsSchema } from '../../src/cee/draft/records/grammar.js';
import { DraftRecordSetWire, projectDraftRecords } from '../../src/cee/draft/records/seam.js';
import { LLMDraftResponse } from '../../src/adapters/llm/shared-schemas.js';
import { ACTIVATION_HASHES, loadActivationEvidence } from './activation.js';
import { assertExactCaseIds, sha256, type ContractStatus } from './contract.js';

const ROOT = resolve(import.meta.dirname, '../..');
const hash = (value: unknown): string => sha256(JSON.stringify(value));
const normalise = (text: string): string => text.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-GB');
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const containsSource = (quote: unknown, source: string): boolean => typeof quote === 'string' && normalise(quote).includes(normalise(source));
const aggregate = (statuses: readonly ContractStatus[]): ContractStatus => statuses.includes('FAIL') ? 'FAIL' : !statuses.length || statuses.includes('UNVERIFIED') ? 'UNVERIFIED' : 'PASS';

export interface DraftSemanticObservation {
  readonly id: string;
  readonly pairId: string;
  readonly arm: 'incumbent' | 'candidate' | 'destroyed' | 'code-only';
  readonly direction: 'diagnostic' | 'decision';
  readonly repetition: number;
  readonly brief: string;
  readonly raw: unknown;
  readonly consumedGraph: unknown;
  readonly primaryResponseText?: string;
  readonly evidenceKind: 'banked-provider' | 'provider-capture' | 'synthetic-mutation';
}

/** A caller must bind fidelity to these exact bodies, not pass a naked PASS. */
export interface SemanticFidelityBinding {
  readonly status: ContractStatus;
  readonly rawSha256: string;
  readonly consumedSha256: string;
  readonly briefSha256: string;
  readonly scope: string;
  readonly componentSourceHashes?: { readonly schema: string; readonly parser: string; readonly projector: string; readonly consumer: string };
  readonly reasons?: readonly string[];
}

export interface AuthoredAction {
  readonly id: string;
  readonly sourceQuote: string;
  /** Reviewed whole-meaning labels, never word lists or regex classifiers. */
  readonly acceptedConsumerLabels?: readonly string[];
}
export interface DraftSemanticOracle {
  readonly id: string;
  readonly pairId: string;
  readonly direction: DraftSemanticObservation['direction'];
  readonly briefSha256: string;
  readonly forbidOptions?: boolean;
  readonly actions?: readonly AuthoredAction[];
  readonly attributedClaims?: readonly { readonly id: string; readonly sourceQuote: string }[];
  /** A reviewed statement about this exact brief, not a number-extraction heuristic. */
  readonly noAbsoluteMeasurementsSupplied?: boolean;
  readonly openEndedActions?: boolean;
}

export interface DraftSemanticAssertionResult {
  readonly id: string;
  readonly status: ContractStatus;
  readonly explanation: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface DraftSemanticCaseResult {
  readonly id: string;
  readonly status: ContractStatus;
  /** Predicate results on supplied bodies, separate from provider/harness fidelity. */
  readonly semanticStatus: ContractStatus;
  readonly behavioralStatus: ContractStatus;
  readonly fidelityStatus: ContractStatus;
  readonly evidenceKind: DraftSemanticObservation['evidenceKind'];
  readonly assertionResults: readonly DraftSemanticAssertionResult[];
  readonly issues: readonly string[];
  readonly hashes: { readonly rawSha256: string; readonly consumedSha256: string; readonly briefSha256: string; readonly oracleSha256: string | null };
  readonly participation: readonly { readonly component: string; readonly calls: number; readonly sourceSha256: string; readonly inputSha256?: string; readonly outputSha256?: string }[];
  readonly limits: readonly string[];
}

const sources = {
  schema: 'src/cee/draft/records/grammar.ts',
  parser: 'src/cee/draft/records/seam.ts',
  projector: 'src/cee/draft/records/projector.ts',
  consumer: 'src/adapters/llm/shared-schemas.ts',
} as const;
const sourceHash = (path: string): string => sha256(readFileSync(resolve(ROOT, path), 'utf8'));
type Graph = ReturnType<typeof LLMDraftResponse.parse>;

export interface DraftSemanticImplementations {
  readonly buildGrammar: typeof buildDraftRecordsSchema;
  readonly parseRecords: typeof DraftRecordSetWire.parse;
  readonly projectRecords: typeof projectDraftRecords;
  readonly parseGraph: typeof LLMDraftResponse.parse;
  readonly sourceHashes: { readonly schema: string; readonly parser: string; readonly projector: string; readonly consumer: string };
}
export function localDraftSemanticImplementations(): DraftSemanticImplementations {
  return { buildGrammar: buildDraftRecordsSchema, parseRecords: DraftRecordSetWire.parse.bind(DraftRecordSetWire),
    projectRecords: projectDraftRecords, parseGraph: LLMDraftResponse.parse.bind(LLMDraftResponse),
    sourceHashes: { schema: sourceHash(sources.schema), parser: sourceHash(sources.parser), projector: sourceHash(sources.projector), consumer: sourceHash(sources.consumer) } };
}

function hasPathToGoal(graph: Graph, start: string): boolean {
  const visited = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const next = queue.shift()!;
    if (visited.has(next)) continue;
    visited.add(next);
    if (graph.nodes.some(node => node.id === next && node.kind === 'goal')) return true;
    queue.push(...graph.edges.filter(edge => edge.from === next).map(edge => edge.to));
  }
  return false;
}

/** Executes the real grammar, parser/projector and captured consumer graph parser.
 * It does not replay completion/repair or pretend a captured graph was recreated.
 */
export function evaluateDraftSemanticCase(input: {
  readonly observation: DraftSemanticObservation;
  readonly oracle?: DraftSemanticOracle;
  readonly fidelity?: SemanticFidelityBinding;
  readonly implementations?: DraftSemanticImplementations;
}): DraftSemanticCaseResult {
  const { observation: item, oracle, fidelity } = input;
  const implementations = input.implementations ?? localDraftSemanticImplementations();
  const hashes = { rawSha256: hash(item.raw), consumedSha256: hash(item.consumedGraph), briefSha256: sha256(item.brief), oracleSha256: oracle ? hash(oracle) : null };
  const issues: string[] = [];
  const assertionResults: DraftSemanticAssertionResult[] = [];
  const participation: DraftSemanticCaseResult['participation'][number][] = [];
  const add = (id: string, status: ContractStatus, explanation: string, evidence: Record<string, unknown> = {}) => assertionResults.push({ id, status, explanation, evidence });
  let fidelityStatus: ContractStatus = fidelity?.status ?? 'UNVERIFIED';
  if (!fidelity) issues.push('No hash-bound fidelity receipt; supplied output is not a certified serving configuration.');
  else if (!fidelity.rawSha256 || !fidelity.consumedSha256 || !fidelity.briefSha256 || !fidelity.scope) {
    fidelityStatus = 'UNVERIFIED'; issues.push('Fidelity receipt lacks body bindings or scope.');
  } else if (fidelity.rawSha256 !== hashes.rawSha256 || fidelity.consumedSha256 !== hashes.consumedSha256 || fidelity.briefSha256 !== hashes.briefSha256) {
    fidelityStatus = 'FAIL'; issues.push('Fidelity receipt belongs to different emitted, consumed or brief bytes.');
  }
  if (fidelity && !fidelity.componentSourceHashes) {
    if (fidelityStatus !== 'FAIL') fidelityStatus = 'UNVERIFIED';
    issues.push('Fidelity receipt lacks schema/parser/projector/consumer source bindings.');
  } else if (fidelity?.componentSourceHashes && (['schema', 'parser', 'projector', 'consumer'] as const).some(role => fidelity.componentSourceHashes?.[role] !== implementations.sourceHashes[role])) {
    fidelityStatus = 'FAIL'; issues.push('Semantic replay schema/parser/projector/consumer differs from the measured runtime.');
  }
  if (item.evidenceKind !== 'synthetic-mutation' && item.primaryResponseText !== undefined) {
    try {
      if (hash(JSON.parse(item.primaryResponseText)) !== hashes.rawSha256) { fidelityStatus = 'FAIL'; issues.push('Raw records differ from the captured primary provider response.'); }
    } catch { fidelityStatus = 'FAIL'; issues.push('Captured primary provider response is not JSON.'); }
  }

  let records: ReturnType<typeof DraftRecordSetWire.parse> | undefined;
  let consumed: Graph | undefined;
  let projected: Graph | undefined;
  try {
    const schema = implementations.buildGrammar();
    participation.push({ component: 'buildDraftRecordsSchema', calls: 1, sourceSha256: implementations.sourceHashes.schema, outputSha256: hash(schema) });
    const validate = new Ajv().compile(schema);
    if (!validate(item.raw)) add('grammar', 'FAIL', 'Actual attached records grammar rejects the emission.', { errors: validate.errors });
    records = implementations.parseRecords(item.raw);
    participation.push({ component: 'DraftRecordSetWire.parse', calls: 1, sourceSha256: implementations.sourceHashes.parser, inputSha256: hashes.rawSha256, outputSha256: hash(records) });
    const seam = implementations.projectRecords(item.raw, item.brief);
    participation.push({ component: 'projectDraftRecords', calls: 1, sourceSha256: implementations.sourceHashes.projector, inputSha256: hash([item.raw, item.brief]), outputSha256: hash(seam) });
    if (!seam.ok) add('projector', 'FAIL', 'Real records projector rejected the emission.', { reason: seam.reason });
    else projected = implementations.parseGraph(seam.projection.graph);
    consumed = implementations.parseGraph(item.consumedGraph);
    participation.push({ component: 'LLMDraftResponse.parse(captured-consumer)', calls: 1, sourceSha256: implementations.sourceHashes.consumer, inputSha256: hashes.consumedSha256, outputSha256: hash(consumed) });
  } catch (error) { add('actual-components', 'FAIL', error instanceof Error ? error.message : String(error)); }

  let oracleBound = false;
  if (!oracle) add('oracle', 'UNVERIFIED', 'No independently authored proposition oracle was supplied.');
  else if (oracle.briefSha256 !== hashes.briefSha256 || oracle.pairId !== item.pairId || oracle.direction !== item.direction) add('oracle', 'FAIL', 'Oracle belongs to a different brief, semantic twin or case.');
  else {
    oracleBound = true;
    const authoredQuotes = [...(oracle.actions ?? []), ...(oracle.attributedClaims ?? [])];
    for (const entry of authoredQuotes) {
      if (!entry.sourceQuote.trim() || !containsSource(item.brief, entry.sourceQuote)) {
        oracleBound = false; add(`oracle.${entry.id}`, 'FAIL', 'Authored proposition is not in the bound brief.');
      }
    }
  }
  if (oracle && oracleBound && records && consumed && projected) {
    if (oracle.forbidOptions) {
      const rawOptions = records.stated_items.filter(record => record.kind === 'option').length + records.claims.filter(record => record.claim_kind === 'option_refinement').length;
      const projectedOptions = projected.nodes.filter(node => node.kind === 'option').length;
      const consumedOptions = consumed.nodes.filter(node => node.kind === 'option').length;
      add('diagnostic.non-collapse', rawOptions || projectedOptions || consumedOptions ? 'FAIL' : 'PASS', 'Only tests absence of action identity; zero options does not prove hypothesis retention.', { rawOptions, projectedOptions, consumedOptions });
    }
    for (const action of oracle.actions ?? []) {
      const rawMatches = records.stated_items.filter(record => record.kind === 'option' && normalise(record.source_quote) === normalise(action.sourceQuote));
      const projectedMatches = projected.nodes.filter(node => node.kind === 'option' && normalise(String(object(node.provenance).source_quote ?? '')) === normalise(action.sourceQuote));
      const consumedMatches = consumed.nodes.filter(node => node.kind === 'option' && normalise(String(object(node.provenance).source_quote ?? '')) === normalise(action.sourceQuote));
      const badOwnership = [...projectedMatches, ...consumedMatches].some(node => object(node.provenance).provenance_class !== 'stated' || object(node.provenance).brief_binding !== 'verified');
      const disconnected = consumedMatches.some(node => !hasPathToGoal(consumed!, node.id));
      const labels = new Set([action.sourceQuote, ...(action.acceptedConsumerLabels ?? [])].map(normalise));
      const unknownLabel = consumedMatches.some(node => !labels.has(normalise(node.label ?? '')));
      const status = rawMatches.length !== 1 || projectedMatches.length !== 1 || consumedMatches.length !== 1 || badOwnership || disconnected ? 'FAIL' : unknownLabel ? 'UNVERIFIED' : 'PASS';
      add(`action.${action.id}`, status, status === 'UNVERIFIED' ? 'Action source survives, but a novel consumer label needs a semantic review; string similarity cannot certify it.' : 'The authored prospective action retains option identity, user source ownership and a consumed path to a goal.', {
        sourceQuote: action.sourceQuote, rawMatches: rawMatches.length, projectedIds: projectedMatches.map(node => node.id), consumedIds: consumedMatches.map(node => node.id), consumedLabels: consumedMatches.map(node => node.label), badOwnership, disconnected,
      });
    }
    for (const claim of oracle.attributedClaims ?? []) {
      const rawMatches = records.stated_items.filter(record => containsSource(record.source_quote, claim.sourceQuote));
      const consumedMatches = consumed.nodes.filter(node => containsSource(object(node.provenance).source_quote, claim.sourceQuote));
      const collapsed = rawMatches.some(record => record.kind === 'option') || consumedMatches.some(node => node.kind === 'option');
      const wrongOwnership = consumedMatches.some(node => object(node.provenance).provenance_class !== 'stated' || object(node.provenance).brief_binding !== 'verified');
      add(`attribution.${claim.id}`, !rawMatches.length || !consumedMatches.length || collapsed || wrongOwnership ? 'FAIL' : 'UNVERIFIED',
        !rawMatches.length || !consumedMatches.length ? 'The whole attributed proposition is absent from emitted records or consumed node provenance; fragments and disclosures are not preservation.' : 'Whole quoted attribution survives, but the records consumer has no typed attributed-hypothesis carrier; quotation alone cannot certify semantic preservation.', {
          sourceQuote: claim.sourceQuote, rawQuotes: rawMatches.map(record => record.source_quote), consumedIds: consumedMatches.map(node => node.id), collapsed, wrongOwnership,
        });
    }
    if (oracle.noAbsoluteMeasurementsSupplied) {
      // This oracle is authored for a brief without an absolute measurement.
      // Prior distributions, edge strengths and prospective sets_to are not
      // measurements. A numeric current-state slot is, even if its source is AI.
      const emittedBaselines = records.claims.flatMap((claim, index) => claim.claim_kind === 'factor' && typeof claim.value === 'number' ? [{ index, label: claim.label, value: claim.value }] : []);
      const emittedFigures = records.stated_items.flatMap((record, index) => typeof record.value === 'number' ? [{ index, quote: record.source_quote, value: record.value }] : []);
      const consumedBaselines = consumed.nodes.flatMap(node => {
        const data = object(node.data), observed = object(node.observed_state);
        return node.kind === 'factor' && (typeof observed.value === 'number' || typeof data.value === 'number') ? [{ id: node.id, label: node.label, value: observed.value ?? data.value, provenance: node.provenance }] : [];
      });
      add('measurement.no-invented-baseline', emittedBaselines.length || emittedFigures.length || consumedBaselines.length ? 'FAIL' : 'PASS',
        'No absolute measurements were supplied in this exact authored brief; an AI numeric baseline is not made supported by syntactic validity or AI attribution.', { emittedBaselines, emittedFigures, consumedBaselines });
    }
    if (oracle.openEndedActions) add('action.open-ended-quality', 'UNVERIFIED', 'Options exist or survive, but their practical relevance and distinctness require an independent meaning-level oracle; counts and labels cannot prove creative quality.', { consumedOptions: consumed.nodes.filter(node => node.kind === 'option').map(node => ({ id: node.id, label: node.label })) });
    if (item.direction === 'diagnostic' && !(oracle.attributedClaims?.length)) add('diagnostic.explanation-retention', 'UNVERIFIED', 'This diagnostic brief has no bound proposition-retention oracle; absence of options is insufficient.');
  }
  const semanticStatus = aggregate(assertionResults.map(result => result.status));
  const behavioralStatus = item.evidenceKind === 'synthetic-mutation' || fidelityStatus !== 'PASS' ? 'UNVERIFIED' : semanticStatus;
  return { id: item.id, status: aggregate([semanticStatus, fidelityStatus]), semanticStatus, behavioralStatus, fidelityStatus, evidenceKind: item.evidenceKind,
    assertionResults, issues, hashes, participation,
    limits: ['Local replay of original emitted records and captured consumed graph; no new model draw or deployed witness.', 'Completion and repair are captured, not re-executed; fidelity must establish their provenance.', 'Bound source-span/action carriage is narrower than general natural-language meaning or hypothesis preservation.', 'Synthetic mutations test the evaluator, never model quality.'] };
}

interface IntentPair { id: string; diagnostic: string; decision: string; actionSpans: string[] }
export function loadDraftSemanticPairs(): readonly IntentPair[] {
  const pairs = JSON.parse(readFileSync(resolve(ROOT, 'src/cee/draft/records/__tests__/fixtures/draft-intent-pairs.json'), 'utf8')) as IntentPair[];
  if (hash(pairs) !== ACTIVATION_HASHES.corpus) throw new Error('Independent semantic corpus identity changed; review the oracle before use.');
  return pairs;
}

/** These whole propositions are authored from the input corpus, not model labels. */
const attributedSources: Readonly<Record<string, readonly { id: string; sourceQuote: string }[]>> = {
  'logistics-disagreement': [
    { id: 'operations-overload', sourceQuote: 'Operations believes drivers have too many stops' },
    { id: 'dispatch-lateness', sourceQuote: 'dispatch believes parcels leave the depot too late' },
  ],
  'museum-chronology': [
    { id: 'curator-programme', sourceQuote: 'the curator thinks the exhibition programme explains the fall' },
    { id: 'treasurer-price', sourceQuote: 'the treasurer suspects the price change' },
  ],
};
export function oracleForDraftSemanticObservation(item: DraftSemanticObservation): DraftSemanticOracle | undefined {
  const pair = loadDraftSemanticPairs().find(candidate => candidate.id === item.pairId);
  if (!pair || pair[item.direction] !== item.brief) return undefined;
  return { id: `${pair.id}.${item.direction}.v1`, pairId: pair.id, direction: item.direction, briefSha256: sha256(item.brief),
    forbidOptions: item.direction === 'diagnostic', actions: item.direction === 'decision' ? pair.actionSpans.map((sourceQuote, index) => ({ id: `authored-${index + 1}`, sourceQuote })) : [],
    attributedClaims: item.direction === 'diagnostic' ? attributedSources[pair.id] : [],
    noAbsoluteMeasurementsSupplied: true,
    openEndedActions: item.direction === 'decision' && !pair.actionSpans.length };
}

/** Original provider bodies are loaded losslessly with immutable archive hashes. */
export function loadBankedDraftSemanticObservations(): DraftSemanticObservation[] {
  const evidence = loadActivationEvidence();
  const pairs = loadDraftSemanticPairs();
  return [evidence.archive, ...(evidence.codeOnly ? [evidence.codeOnly] : [])].flatMap(block => block.cases.map(item => {
    const score = item.scores ?? item.summary;
    if (!score) throw new Error('Banked semantic case lacks identity.');
    const pair = pairs.find(candidate => score.id === `${candidate.id}-${score.direction}-${score.repetition}-${score.arm}`);
    if (!pair) throw new Error('Banked semantic case is not in the authored corpus.');
    const primary = item.captures.find(capture => capture.kind === 'draft');
    if (!primary) throw new Error('Banked semantic case lacks a primary provider response.');
    return { id: score.id, pairId: pair.id, arm: score.arm, direction: score.direction, repetition: score.repetition,
      brief: item.brief, raw: item.raw, consumedGraph: item.consumed.graph,
      primaryResponseText: primary.response.content.filter(block => block.type === 'text').map(block => block.text ?? '').join(''), evidenceKind: 'banked-provider' as const };
  }));
}

export function buildBankedDraftSemanticReport(input: { readonly fidelityByCaseId?: Readonly<Record<string, SemanticFidelityBinding>> } = {}) {
  const observations = loadBankedDraftSemanticObservations();
  const expected = loadDraftSemanticPairs().flatMap(pair => (['diagnostic', 'decision'] as const).flatMap(direction => [1, 2, 3].flatMap(repetition => (['incumbent', 'candidate', 'destroyed'] as const).map(arm => `${pair.id}-${direction}-${repetition}-${arm}`))));
  expected.push('logistics-disagreement-diagnostic-1-code-only', 'logistics-disagreement-decision-1-code-only');
  assertExactCaseIds(expected, observations.map(item => item.id));
  const cases = observations.map(observation => ({ pairId: observation.pairId, arm: observation.arm, direction: observation.direction,
    ...evaluateDraftSemanticCase({ observation, oracle: oracleForDraftSemanticObservation(observation), fidelity: input.fidelityByCaseId?.[observation.id] }) }));
  return { format: 'olumi.draft-semantic-observations.v1' as const, collectionStatus: 'PASS' as const, expectedCaseIds: expected,
    status: aggregate(cases.map(item => item.status)), behavioralStatus: aggregate(cases.map(item => item.behavioralStatus)), cases,
    wordingVariation: { status: 'UNVERIFIED' as const, reason: 'The banked corpus contains independently authored domain/intent twins, not same-meaning paraphrase provider runs. Offline wording mutations are evaluator controls, not model-behaviour evidence.' },
    promotionPermission: 'NOT_GRANTED' as const };
}
