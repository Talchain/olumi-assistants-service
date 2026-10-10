import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { admitCandidateModel, framedObservedState, type CandidateModel } from '../admit-model.js';
import { verifiedFactorLevel, verifiedGoalLevel, verifiedOptionSetting } from '../verified-option-setting.js';
import { prepareProvisionalCandidate, BUILD_INSTRUCTIONS, buildCandidateSchema, strictForTheDrafter, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { valueAuthorshipOf } from '../turn-context/guidance-signals.js';
import { nodeProvenanceDisplay } from '../../../cee/transforms/provenance-display.js';
import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import { normaliseOptionInterventionContract } from '../../normalise-option-interventions.js';
import { buildAddOptionTransaction } from '../../routing/add-option-transaction.js';
import { classifyValueSource } from '../../../cee/graph-readiness/obligation-provenance.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { executeGmHeldResume } from '../../handlers/gm-held-execute.js';
import { PatchOperationsArraySchema } from '../../../orchestrator/patch-validation.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const CURRENT = 'Our backlog is 40 jobs.';
const candidate = (quote: string | null = CURRENT): CandidateModel => ({
  goal: { metric: 'Backlog', value: 100, unit: 'jobs', operator: '>=', horizon_months: null, provenance: 'explicit',
    baseline_known: true, baseline_value: 40, baseline_provenance: 'explicit',
    baseline_evidence: quote === null ? null : { quote } },
  constraints: [], options: [], factors: [], risks: [], outcomes: [], links: [],
});
const goalNode = (m: CandidateModel, brief?: string) => admitCandidateModel(m, {}, brief).nodes.find(n => n.kind === 'goal')!;

describe('one authority construction', () => {
  it('A a unique owned current goal receipt earns real user credit on its native frame', () => {
    const m = candidate();
    expect(verifiedGoalLevel(m, CURRENT)).toBe(true);
    const os = goalNode(m, CURRENT).observed_state!;
    expect(os).toMatchObject({ raw_value: 40, unit: 'jobs', source: 'brief_extraction', extractionType: 'explicit' });
    expect(os.value).toBe(40 / os.cap!);
    expect(valueAuthorshipOf(os)).toBe('yours');
    expect(nodeProvenanceDisplay(os.extractionType, os)).toBe('from_brief');
    const f: CandidateModel['factors'][number] = { label: m.goal.metric, unit: m.goal.unit, role: 'observable',
      baseline_known: true, baseline_value: 40, provenance: 'explicit', baseline_evidence: { quote: CURRENT } };
    expect(verifiedFactorLevel({ ...m, factors: [f] }, f, CURRENT)).toBe(true);
  });
  it('A known and explicit flags without a receipt never license a goal baseline', () => {
    const m = candidate(null);
    expect(verifiedGoalLevel(m, CURRENT)).toBe(false);
    const os = goalNode(m, CURRENT).observed_state!;
    expect(os).toMatchObject({ raw_value: 40, unit: 'jobs', source: 'cee_inference', user_material_unverified: true });
    expect(valueAuthorshipOf(os)).toBe('unknown');
    expect(nodeProvenanceDisplay(os.extractionType, os)).toBe('unverified_brief');
  });
  for (const quote of [
    'Our competitor has 40 backlog jobs.', 'Our backlog target is 40 jobs.', 'Our backlog is at most 40 jobs.',
    'Our backlog forecast is 40 jobs.', 'Our backlog is 40 engineers.', 'Our backlog is 40 jobs a month.',
    'Backlog is 40 jobs.',
  ]) {
    it(`A refuses ${quote}`, () => expect(verifiedGoalLevel(candidate(quote), quote)).toBe(false));
  }
  it('A goal target, rival, paraphrase, duplicate and attributed paragraph remain refused', () => {
    expect(verifiedGoalLevel({ ...candidate(), goal: { ...candidate().goal, value: 40 } }, CURRENT)).toBe(false);
    expect(verifiedGoalLevel({ ...candidate(), constraints: [{ metric: 'Backlog', value: 40, unit: 'jobs', operator: '<=', provenance: 'explicit' }] }, CURRENT)).toBe(false);
    const rival: CandidateModel['factors'][number] = { label: 'Backlog', unit: 'jobs', baseline_known: true,
      baseline_value: 40, provenance: 'explicit', role: 'observable' };
    expect(verifiedGoalLevel({ ...candidate(), factors: [rival] }, CURRENT)).toBe(false);
    expect(verifiedGoalLevel(candidate(), 'We have 40 backlog jobs.')).toBe(false);
    expect(verifiedGoalLevel(candidate(), `${CURRENT} ${CURRENT}`)).toBe(false);
    expect(verifiedGoalLevel(candidate(), `${CURRENT} Olumi suggested 40.`)).toBe(false);
    expect(verifiedGoalLevel(candidate(), undefined)).toBe(false);
  });
  it('A an AI-estimated goal is withheld, even with an owned receipt', () => {
    const m = candidate();
    expect(goalNode({ ...m, goal: { ...m.goal, baseline_known: false, baseline_provenance: 'ai_proposed' } }, CURRENT).observed_state).toBeUndefined();
  });
  it('B explicit entity provenance with a refused verdict is never numeric user credit', () => {
    const os = framedObservedState({ baseline_value: 40, unit: 'jobs', provenance: 'explicit' }, false, true);
    expect(os.source).toBe('cee_inference');
    expect(valueAuthorshipOf(os)).toBe('unknown');
    expect(nodeProvenanceDisplay(os.extractionType, os)).toBe('unverified_brief');
  });
  it('B an explicit human-authority verdict preserves the trusted legacy carrier', () => {
    expect(framedObservedState({ baseline_value: 40, unit: 'jobs', provenance: 'explicit', plausible_max: 100 }, 'human_authority'))
      .toStrictEqual({ value: 0.4, raw_value: 40, cap: 100, declared_scale: 'unit_interval', unit: 'jobs', source: 'brief_extraction' });
    expect(framedObservedState({ baseline_value: 40, unit: 'jobs', provenance: 'explicit' }, 'legacy').source).toBe('cee_inference');
  });
  it('C computed additions retain numbers but need an independently verified total receipt', () => {
    const m = addition(2, 3, null);
    const prepared = prepareProvisionalCandidate(m, 'We have 2 engineers. We could hire 3 engineers.').candidate;
    expect(prepared.options[0]!.interventions![0]).toMatchObject({ value: 5, provenance: 'ai_proposed', derived_total: true });
  });
  it('C a zero baseline and explicit addition flags without a receipt are insufficient', () => {
    expect(prepareProvisionalCandidate(addition(0, 3, null), 'We could hire 3 engineers.').candidate.options[0]!.interventions![0])
      .toMatchObject({ value: 3, provenance: 'ai_proposed', derived_total: true });
  });
  it('C an owned absolute total receipt alone licenses computed-total credit', () => {
    const quote = 'One option is to hire 5 engineers.';
    const m = addition(2, 3, quote);
    const iv = m.options[0]!.interventions![0]!;
    expect(verifiedOptionSetting(m, m.options[0]!, { ...iv, value: 5, value_kind: 'absolute' }, quote)).toBe(true);
    expect(prepareProvisionalCandidate(m, quote).candidate.options[0]!.interventions![0])
      .toMatchObject({ value: 5, provenance: 'explicit', derived_total: true });
  });
  it('C an addition receipt cannot attest a different computed total', () => {
    const quote = 'One option is to hire 3 engineers.';
    expect(prepareProvisionalCandidate(addition(2, 3, quote), quote).candidate.options[0]!.interventions![0])
      .toMatchObject({ value: 5, provenance: 'ai_proposed', derived_total: true });
  });
  it('frozen drafter instructions and schema bytes are unchanged', () => {
    const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
    const start = BUILD_INSTRUCTIONS.indexOf('For a factor whose CURRENT level');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = BUILD_INSTRUCTIONS.indexOf('ambiguous ownership.', start) + 'ambiguous ownership.'.length;
    const sentence = BUILD_INSTRUCTIONS.slice(start, end);
    expect(digest(sentence)).toBe('804e8f225835fd0b37446fec7c1a9fe82e06001866930d0f80868131d92b0846');
    // The schema itself, not a hand-repeated description.
    const schema = buildCandidateSchema() as { properties: { factors: { items: { properties: { baseline_evidence: { description: string } } } } } };
    expect(digest(schema.properties.factors.items.properties.baseline_evidence.description))
      .toBe('4dc9d74132cc8c62b3748ff426eb6275bff736edebe2c8de0af4815bb0ef2349');
  });
});

// These are caller proofs, not candidate/graph flags. Approval is scoped to one cell.
const HUMAN_CELL = [{ optionId: 'option', factorId: 'factor' }] as const;
const interventionGraph = (level: unknown = { value: 0.4 }) => ({
  nodes: [
    { id: 'decision', kind: 'decision', label: 'Choose' },
    { id: 'factor', kind: 'factor', label: 'Spend', observed_state: { value: 0.2, raw_value: 20, cap: 100, unit: 'GBP', source: 'cee_inference' } },
    { id: 'sibling', kind: 'factor', label: 'Other spend' },
    { id: 'option', kind: 'option', label: 'Improve', data: { interventions: { factor: level, sibling: { value: 0.2 } } } },
  ], edges: [],
});
function storedCells(graph: unknown) {
  const stored = projectGraphForPersistence(graph);
  const reloaded = GraphV3.parse(JSON.parse(JSON.stringify(stored)));
  return reloaded.nodes.find(n => n.id === 'option')!.interventions!;
}

describe('RUN25 producer receipts and source defaults', () => {
  it('RUN27 first, event and retry provider assemblies retain the identical goal receipt contract without a provider', async () => {
    type Request = Parameters<CallStructuredModel>[0];
    const dispatch: InternalDispatch = async () => ({ status: 200, json: { graph: { nodes: [], edges: [] } } });
    async function capture(brief: string, firstAnswer?: CandidateModel): Promise<Request[]> {
      const requests: Request[] = [];
      const call: CallStructuredModel = async req => {
        requests.push(req);
        return { text: requests.length === 1 && firstAnswer ? JSON.stringify(firstAnswer) : '' };
      };
      await buildModelFromBrief('77777777-7777-4777-8777-777777777777', brief, dispatch, call);
      return requests;
    }
    const first = await capture(CURRENT);
    const event = await capture('We need to launch our platform by June 2027.');
    const repair: CandidateModel = { ...candidate(),
      factors: [{ label: 'Engineers', role: 'controllable', baseline_known: false, baseline_value: null, unit: 'engineers', provenance: 'ai_proposed' }],
      options: [{ label: 'Improve', provenance: 'ai_proposed', changes: ['Engineers'], interventions: [] }] };
    const retried = await capture(CURRENT, repair);
    expect(first).toHaveLength(1);
    expect(event).toHaveLength(1);
    expect(retried).toHaveLength(2);
    expect(event[0]!.instructions).toContain('The deterministic reader attests an event by a date.');
    expect(retried[1]!.instructions).toContain('Repair only the listed construction issues.');
    const assemblies = { first: first[0]!, event: event[0]!, retry: retried[1]! };
    const sha = (bytes: string) => createHash('sha256').update(bytes, 'utf8').digest('hex');
    console.info('RUN27_ASSEMBLY_HASHES', JSON.stringify(Object.fromEntries(Object.entries(assemblies).map(([name, req]) => [name, {
      instructions_sha256: sha(req.instructions),
      provider_schema_sha256: sha(JSON.stringify(strictForTheDrafter(req.schema))),
      callback_schema_sha256: sha(JSON.stringify(req.schema)),
    }]))));
    function goalReceipt(schema: Record<string, unknown>) {
      const properties = schema.properties;
      if (!properties || typeof properties !== 'object' || !('goal' in properties)) throw new Error('Missing goal schema');
      const goal = properties.goal;
      if (!goal || typeof goal !== 'object' || !('properties' in goal) || !('required' in goal)) throw new Error('Missing goal properties');
      const fields = goal.properties;
      if (!fields || typeof fields !== 'object' || !('baseline_evidence' in fields)) throw new Error('Missing goal receipt');
      return { receipt: fields.baseline_evidence, required: goal.required };
    }
    const expected = goalReceipt(strictForTheDrafter(buildCandidateSchema())).receipt;
    expect(expected).toStrictEqual({ anyOf: [{ type: 'null' }, {
      type: 'object', additionalProperties: false, properties: { quote: { type: 'string' } }, required: ['quote'],
    }], description: 'Complete verbatim brief sentence stating the goal’s current level; null otherwise.' });
    for (const req of Object.values(assemblies)) {
      const providerGoal = goalReceipt(strictForTheDrafter(req.schema));
      expect(providerGoal.receipt).toStrictEqual(expected);
      expect(providerGoal.required).toContain('baseline_evidence');
      expect(goalReceipt(req.schema).required).not.toContain('baseline_evidence');
    }
    expect(strictForTheDrafter(event[0]!.schema)).toStrictEqual(strictForTheDrafter(first[0]!.schema));
    expect(strictForTheDrafter(retried[0]!.schema)).toStrictEqual(strictForTheDrafter(first[0]!.schema));
    expect(strictForTheDrafter(retried[1]!.schema)).toHaveProperty('properties.goal.properties.metric.enum', ['Backlog']);
  });
  it('goal receipt mirrors the factor schema and is compulsory only at the provider boundary', () => {
    type Receipt = { anyOf: unknown[]; description: string };
    type Schema = { properties: { goal: { properties: { baseline_evidence: Receipt }; required: string[] }; factors: { items: { properties: { baseline_evidence: Receipt } } } } };
    const schema = buildCandidateSchema();
    const typed = schema as Schema;
    expect(typed.properties.goal.properties.baseline_evidence.anyOf).toStrictEqual(typed.properties.factors.items.properties.baseline_evidence.anyOf);
    expect(typed.properties.goal.properties.baseline_evidence.description).toBe('Complete verbatim brief sentence stating the goal’s current level; null otherwise.');
    for (const providerBoundary of [true, false]) {
      const strict = strictForTheDrafter(schema, { providerBoundary }) as Schema;
      expect(strict.properties.goal.required.includes('baseline_evidence')).toBe(providerBoundary);
    }
    const validate = new Ajv({ strict: false }).compile((schema.properties as Record<string, object>).goal!);
    const old = { ...candidate(null).goal, frame: 'level', target_stated: true, scope: null };
    delete old.baseline_evidence;
    expect(validate(old), JSON.stringify(validate.errors)).toBe(true);
    expect(createHash('sha256').update(BUILD_INSTRUCTIONS, 'utf8').digest('hex')).toBe('ca036d122da73946c2d7d68ca135d44e512b2769d654bad6785b9b1199b6c444');
  });
  it('generated goal receipt survives the real zero-provider build and registration path', async () => {
    for (const quote of [CURRENT, null]) {
      const m = { ...candidate(quote), goal: { ...candidate(quote).goal, frame: 'level', target_stated: true, scope: null },
        identities: [], unknowns: [], decision_question: null,
        options: [{ label: 'Keep current', provenance: 'ai_proposed', changes: [], interventions: [], is_status_quo: true },
          { label: 'Improve', provenance: 'ai_proposed', changes: [], interventions: [], is_status_quo: null }] };
      let graph: ReturnType<typeof GraphV3.parse> | undefined;
      const dispatch: InternalDispatch = async (path, body) => {
        if (path.endsWith('/graph/register')) graph = GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph));
        return { status: 200, json: { registered: true, graph: { nodes: [], edges: [] } } };
      };
      const call: CallStructuredModel = async () => ({ text: JSON.stringify(m) });
      const out = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', CURRENT, dispatch, call);
      expect(out.ok, JSON.stringify(out)).toBe(true);
      const os = graph!.nodes.find(n => n.kind === 'goal')!.observed_state!;
      expect(os.raw_value).toBe(40);
      expect(valueAuthorshipOf(os)).toBe(quote === null ? 'unknown' : 'yours');
      expect(nodeProvenanceDisplay(os.extractionType, os)).toBe(quote === null ? 'unverified_brief' : 'from_brief');
    }
  });
  for (const source of [undefined, 'unrecognised', 'brief_extraction', 'user_specified']) {
    it(`encoder withheld absent/unproved ${String(source)} provenance survives projection and reload`, () => {
      const g = interventionGraph({ value: 0.4, raw_value: 40, unit: 'GBP', ...(source === undefined ? {} : { source }), human_authority: true });
      const encoded = encodeOptionInterventionsForEdit(g);
      expect(encoded.unresolvedOptionIds).toStrictEqual([]);
      const cell = storedCells(encoded.graph).factor!;
      expect(cell).toMatchObject({ value: 0.4, raw_value: 40, unit: 'GBP' });
      expect(cell.source).toBeUndefined();
      expect(classifyValueSource(cell.source)).toBe('unattributed');
    });
  }
  it('encoder direct human approval marks only approved cells, preserves conversion and AI attribution', () => {
    const g = interventionGraph({ raw_value: 40, unit: 'GBP' });
    const encoded = encodeOptionInterventionsForEdit(g, undefined, undefined, HUMAN_CELL);
    expect(encoded.unresolvedOptionIds).toStrictEqual([]);
    const cells = storedCells(encoded.graph);
    expect(cells.factor).toMatchObject({ value: 0.4, raw_value: 40, unit: 'GBP', source: 'user_specified' });
    expect(classifyValueSource(cells.factor!.source)).toBe('user_stated');
    expect(cells.sibling!.source).toBeUndefined();
    const ai = encodeOptionInterventionsForEdit(interventionGraph({ value: 0.4, source: 'cee_hypothesis', reasoning: 'A provisional estimate', value_confidence: 'low' }), undefined, undefined, HUMAN_CELL);
    expect(storedCells(ai.graph).factor).toMatchObject({ source: 'cee_hypothesis', reasoning: 'A provisional estimate', value_confidence: 'low' });
  });
  it('encoder legacy canonical levels stay unknown until that cell is directly approved', () => {
    const g = { nodes: [{ id: 'option', kind: 'option', label: 'Improve', interventions: { factor: { value: 0.4 }, sibling: { value: 0.2 } } }], edges: [] };
    expect(encodeOptionInterventionsForEdit(g).graph).toBe(g);
    expect(storedCells(g).factor!.source).toBeUndefined();
    const edited = storedCells(encodeOptionInterventionsForEdit(g, undefined, undefined, HUMAN_CELL).graph);
    expect(edited.factor!.source).toBe('user_specified');
    expect(edited.sibling!.source).toBeUndefined();
  });
  for (const location of ['data', 'slash']) {
    it(`normalizer ${location} is unattributed without a scoped human edit and refuses graph flags`, () => {
      const g = location === 'data' ? interventionGraph({ value: 0.4, source: 'user_specified', human_authority: true })
        : { nodes: [{ id: 'option', kind: 'option', label: 'Improve', 'data/interventions/factor': 0.4 }], edges: [] };
      const unknown = storedCells(normaliseOptionInterventionContract(g, { source: 'set_factor_value' }));
      expect(unknown.factor!.source).toBeUndefined();
      expect(classifyValueSource(unknown.factor!.source)).toBe('unattributed');
      const human = storedCells(normaliseOptionInterventionContract(g, { humanAuthority: HUMAN_CELL }));
      expect(human.factor!.source).toBe('user_specified');
      expect(classifyValueSource(human.factor!.source)).toBe('user_stated');
    });
  }
  it('normalizer never inherits old user authority onto a replacement and keeps explicit AI origin', () => {
    const g = { ...interventionGraph(), nodes: interventionGraph().nodes.map(n => n.kind === 'option'
      ? { ...n, interventions: { factor: { value: 0.1, source: 'user_specified', reasoning: 'Old text' } } } : n) };
    expect(storedCells(normaliseOptionInterventionContract(g)).factor).toStrictEqual({ value: 0.4, target_match: { node_id: 'factor', match_type: 'exact_id', confidence: 'high' } });
    expect(storedCells(normaliseOptionInterventionContract(interventionGraph({ value: 0.4, source: 'cee_hypothesis' }), { humanAuthority: HUMAN_CELL })).factor!.source).toBe('cee_hypothesis');
  });
  it('actual held human approval grants exact cells while an approved AI estimate stays AI', () => {
    for (const source of [undefined, 'cee_hypothesis'] as const) {
      const g = GraphV3.parse({ nodes: interventionGraph().nodes.filter(n => n.kind !== 'option'), edges: [] });
      const built = buildAddOptionTransaction({ parent_decision_id: 'decision', label: 'Improve',
        interventions: [{ factor_id: 'factor', value: 0.4, raw_value: 40, unit: 'GBP', ...(source === undefined ? {} : { source }) }] },
      { nodes: g.nodes, edges: g.edges });
      expect(built.matched).toBe(true);
      if (!built.matched) throw new Error(built.reason);
      const out = executeGmHeldResume({ operations: PatchOperationsArraySchema.parse(built.proposal.operations), currentGraph: g,
        currentGraphHash: computeAnalysisAffectingGraphHash(g)!, freshness: 'none', hasExistingAnalysis: false,
        scenarioId: 's', turnId: 'confirm', requestId: 'r' });
      expect(out.status, JSON.stringify(out)).toBe('executed');
      if (out.status !== 'executed') throw new Error(out.status);
      const stored = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(out.mutatedGraph))));
      const cell = stored.nodes.find(n => n.kind === 'option')!.interventions!.factor!;
      expect(cell).toMatchObject({ value: 0.4, raw_value: 40, unit: 'GBP' });
      expect(cell.source).toBe(source === undefined ? 'user_specified' : 'cee_hypothesis');
      expect(classifyValueSource(cell.source)).toBe(source === undefined ? 'user_stated' : 'ai_drafted');
    }
  });
  for (const source of [undefined, 'user_specified', 'cee_hypothesis'] as const) {
    it(`add-option preparation preserves ${String(source)} without a missing-source user default`, () => {
      const out = buildAddOptionTransaction({ parent_decision_id: 'decision', label: 'Improve',
        interventions: [{ factor_id: 'factor', value: 0.4, raw_value: 40, unit: 'GBP', ...(source === undefined ? {} : { source }) }], human_authority: true },
      { nodes: [{ id: 'decision', kind: 'decision' }, { id: 'factor', kind: 'factor' }], edges: [] });
      expect(out.matched).toBe(true);
      if (!out.matched) throw new Error(out.reason);
      const node = out.proposal.operations.find(op => op.op === 'add_node')!.value;
      const cells = storedCells({ nodes: [{ ...node as object, id: 'option' }], edges: [] });
      expect(cells.factor).toMatchObject({ value: 0.4, raw_value: 40, unit: 'GBP' });
      expect(cells.factor!.source).toBe(source);
      expect(classifyValueSource(cells.factor!.source)).toBe(source === undefined ? 'unattributed' : source === 'user_specified' ? 'user_stated' : 'ai_drafted');
    });
  }
});

function addition(baseline: number, increment: number, quote: string | null): CandidateModel {
  return { ...candidate(null), goal: { ...candidate(null).goal, metric: 'Outcome', unit: 'GBP', value: 1000 },
    factors: [{ label: 'Engineers', unit: 'engineers', role: 'controllable', baseline_known: true,
      baseline_value: baseline, provenance: 'explicit' }],
    options: [{ label: 'Hire engineers', provenance: 'explicit', interventions: [{ factor_label: 'Engineers',
      value: increment, value_kind: 'additional', unit: 'engineers', provenance: 'explicit', stated_evidence: quote === null ? null : {
        quote, start: 0, end: quote.length, amount_start: 0, option_quote: quote, option_start: 0, option_end: quote.length } }] }] };
}

// Fixed site budgets, not an automatically refreshed census. Deletions may shrink these;
// additions must not increase them. They include disclosed pre-existing debt below.
const ALLOWED_SITES: Readonly<Record<string, number>> = {
  'admit-candidate.ts:provenanceSourceFor': 1, // Pass-through entity tag, not a quantity verdict.
  'admit-constraint.ts:canonicalProvenance': 1, // Pass-through constraint tag.
  'admit-model.ts:framedObservedState': 3, // Required receipt/human verdict; no default user arm.
  'admit-model.ts:nonlinearIdentityLeaderWithhold': 1, // Structural leader, not a measured level.
  'admit-model.ts:briefGoalObservedState': 1, // Vetted ordinary goal or existing typed goal callbacks.
  'admit-model.ts:admitOnce': 2, // Verified goal receipt and inherited constraint target tag.
  'ceiling-stock.ts:ceilingStockPostimage': 1, // Verified conversion of a held constraint.
  'goal-unit-reading.ts:goalUnitReading': 1, // Existing typed unit-reading authority.
  'runtime/agent-capabilities.ts:valueOpAuthor': 2, // Pass-through authored operation classifier.
  'runtime/agent-capabilities.ts:createAgentCapabilities/applyCompound': 2, // Human-approved operations.
  'runtime/agent-capabilities.ts:createAgentCapabilities/applyLinkStrengthSet': 1, // Direct human strength edit.
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeGoalTarget': 1, // Scoped typed goal quantity.
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeAssumptions': 2, // Typed quantity/human assumption approval.
  'runtime/agent-capabilities.ts:createAgentCapabilities/authoriseChange': 1, // Consumed human approval.
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeLimitChange': 1, // Scoped typed limit quantity.
  'runtime/build-model.ts:withCountInterventionRanges': 1, // Required figureTheUserWroteForSpan.
  'runtime/build-model.ts:prepareProvisionalCandidate': 1, // Required verifiedOptionSetting on the computed total.
  'admit-model.ts:admitStatedGoalChange@briefGoalObservedState': 1,
  'admit-model.ts:admitGoalLevelBesideHeldCeiling@briefGoalObservedState': 1,
  'admit-model.ts:admitOnce@briefGoalObservedState': 1,
  'admit-model.ts:admitOnce@framedObservedState': 3,
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeNewOption@framedObservedState': 1,
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeNewFactor@framedObservedState': 1,
  '../../orchestrator/tools/encode-option-interventions.ts:buildInterventionV3': 1, // Exact approved cell verdict.
  '../../orchestrator/tools/encode-option-interventions.ts:encodeOptionInterventionsForEdit': 1, // Exact approved canonical cell, no legacy upgrade.
  '../normalise-option-interventions.ts:freshInterventionV3': 1, // Exact caller-approved cell verdict.
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeNewOption@typedOptionLevel': 2, // Existing figureTheUserWroteFor verdict, not omitted-source credit.
  'stated-by-user.ts:holdStatedGoalAttributes': 1, // Required scoped typed goal target.
};
// INPUT census debt, not newly authorised grants. This scoped task cannot claim
// these paths vetted. Keep their exact existing site budgets until their own fix.
const INDEPENDENT_DEBT: Readonly<Record<string, number>> = {
  'runtime/agent-capabilities.ts:createAgentCapabilities/identityProposalFor': 1,
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposePlacedDeadline': 1,
  'admit-model.ts:decisionEntityFor': 1,
  'admit-model.ts:admitStoredProductDeclaration': 1,
  'goal-current-level.ts:statedPercentOfReading': 1,
  'goal-current-level.ts:proposeGoalCurrentLevel': 1,
  'goal-current-level.ts:changeGoalLevel': 1,
  'proposal-object/amend.ts:amendHeldOperations': 1,
  'proposal-object/amend.ts:amendAgentProposal': 3,
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeLinkStrength': 1,
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeLinkEffect': 2,
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeLinkStrengths': 2,
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeOptionStatus': 1,
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeTeamTime': 1,
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeOptionInterventions': 1,
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeNewOption': 1,
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeNewFactor': 1,
  'runtime/agent-capabilities.ts:createAgentCapabilities/proposeNewLimit': 1,
  'runtime/build-model.ts:keepLimitedQuantityAuthor': 1,
};
const CREDIT = new Set(['brief_extraction', 'explicit', 'user_specified', 'user_stated', 'from_brief']);
const FIELDS = new Set(['source', 'provenance', 'extractionType', 'authored_by', 'author', 'magnitude',
  'stated_by', 'threshold_source', 'value_source']);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_PRODUCERS = ['../../orchestrator/tools/encode-option-interventions.ts',
  '../normalise-option-interventions.ts', '../routing/add-option-transaction.ts'] as const;
// The three census defaults W235/W190/W195 are removed, never carried as debt.
const MISSING_SOURCE_DEFAULT_BUDGET = 0;
function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? e.name === '__tests__' ? [] : productionFiles(join(dir, e.name))
    : /\.tsx?$/u.test(e.name) ? [join(dir, e.name)] : []);
}
function enclosingSymbol(n: ts.Node, src: ts.SourceFile): string {
  const names: string[] = [];
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) names.unshift(p.name.text);
    else if (ts.isMethodDeclaration(p)) names.unshift(p.name.getText(src));
    else if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
      const parent = p.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) names.unshift(parent.name.text);
      else if (ts.isPropertyAssignment(parent)) names.unshift(parent.name.getText(src));
    }
  }
  return names.join('/') || '<module>';
}
function creditSites(file: string, text = readFileSync(file, 'utf8')): Record<string, number> {
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const bindings = new Map<string, ts.Expression>();
  const bind = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) bindings.set(n.name.text, n.initializer);
    ts.forEachChild(n, bind);
  };
  bind(src);
  const containsCredit = (n: ts.Expression, seen = new Set<string>()): boolean => {
    if (ts.isStringLiteralLike(n)) return CREDIT.has(n.text);
    if (ts.isIdentifier(n) && !seen.has(n.text) && bindings.has(n.text)) {
      return containsCredit(bindings.get(n.text)!, new Set([...seen, n.text]));
    }
    if (ts.isConditionalExpression(n)) return containsCredit(n.whenTrue, seen) || containsCredit(n.whenFalse, seen);
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n)) return containsCredit(n.expression, seen);
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.AmpersandAmpersandToken].includes(n.operatorToken.kind)) {
      return containsCredit(n.left, seen) || containsCredit(n.right, seen);
    }
    return false;
  };
  const out: Record<string, number> = {};
  const visit = (n: ts.Node): void => {
    let name: string | undefined, value: ts.Expression | undefined;
    if (ts.isPropertyAssignment(n)) {
      name = ts.isComputedPropertyName(n.name) && ts.isStringLiteralLike(n.name.expression)
        ? n.name.expression.text : n.name.getText(src).replace(/^['"]|['"]$/gu, '');
      value = n.initializer;
    } else if (ts.isShorthandPropertyAssignment(n)) { name = n.name.text; value = n.name; }
    else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isPropertyAccessExpression(n.left)) name = n.left.name.text;
      else if (ts.isElementAccessExpression(n.left) && n.left.argumentExpression && ts.isStringLiteralLike(n.left.argumentExpression)) {
        name = n.left.argumentExpression.text;
      }
      value = n.right;
    } else if (ts.isReturnStatement(n) && n.expression && containsCredit(n.expression)) { name = '<return>'; value = n.expression; }
    if (name && value && (FIELDS.has(name) || name === '<return>') && containsCredit(value)) {
      let key = relative(ROOT, file).split(sep).join('/') + ':' + enclosingSymbol(n, src);
      if (key === 'runtime/agent-capabilities.ts:createAgentCapabilities/proposeNewOption' && name === 'source'
        && ts.isConditionalExpression(value) && ['byUser', 'wrote'].includes(value.condition.getText(src))) {
        expect(value.whenTrue.getText(src)).toBe("'user_specified' as const");
        expect(value.whenFalse.getText(src)).toBe("'cee_hypothesis' as const");
        key += '@typedOptionLevel';
      }
      out[key] = (out[key] ?? 0) + 1;
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)
      && ['framedObservedState', 'briefGoalObservedState'].includes(n.expression.text)) {
      const key = relative(ROOT, file).split(sep).join('/') + ':' + enclosingSymbol(n, src) + '@' + n.expression.text;
      out[key] = (out[key] ?? 0) + 1;
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'framedObservedState') {
      expect(n.arguments.length, `${file}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1} missing verdict`).toBeGreaterThanOrEqual(2);
      const key = relative(ROOT, file).split(sep).join('/') + ':' + enclosingSymbol(n, src);
      const humanSites = ['runtime/agent-capabilities.ts:createAgentCapabilities/proposeNewOption',
        'runtime/agent-capabilities.ts:createAgentCapabilities/proposeNewFactor'];
      if (ts.isStringLiteralLike(n.arguments[1]!)) {
        expect(n.arguments[1]!.text).toBe('human_authority');
        expect(humanSites).toContain(key);
      } else {
        expect(key).toBe('admit-model.ts:admitOnce');
        expect(n.arguments[1]!.getText(src)).not.toBe('true');
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}
function unexpectedSites(sites: Record<string, number>): string[] {
  const budget = { ...ALLOWED_SITES, ...INDEPENDENT_DEBT };
  return Object.entries(sites).filter(([key, count]) => count > (budget[key] ?? 0)).map(([key, count]) => `${key} (${count} > ${budget[key] ?? 0})`).sort();
}

describe('agent-lane user-credit ratchet', () => {
  it('RUN25 missing-source credit debt remains zero at the three corrected producers', () => {
    let defaults = 0;
    for (const p of SOURCE_PRODUCERS) {
      const source = readFileSync(join(ROOT, p), 'utf8');
      // A raw source flag or omitted value can never be the human verdict.
      expect(source).not.toMatch(/source:\s*(?:rec|iv)\.source\s*\?\?\s*['"]user_specified['"]/u);
      const sf = ts.createSourceFile(p, source, ts.ScriptTarget.Latest, true);
      function visit(n: ts.Node): void {
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
          && ts.isPropertyAssignment(n.parent) && n.parent.name.getText(sf) === 'source'
          && ts.isStringLiteralLike(n.right) && CREDIT.has(n.right.text)) defaults++;
        if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'source'
          && ts.isStringLiteralLike(n.initializer) && CREDIT.has(n.initializer.text)) {
          // In these producers a literal user stamp must be the true arm of the required human verdict.
          const branch = n.parent.parent;
          if (!ts.isConditionalExpression(branch) || branch.condition.getText(sf) !== 'humanAuthority'
            || branch.whenTrue !== n.parent) defaults++;
        }
        ts.forEachChild(n, visit);
      }
      visit(sf);
    }
    expect(defaults).toBe(MISSING_SOURCE_DEFAULT_BUDGET);
  });
  it('D no unlisted credit sites or growing listed site budgets', () => {
    const sites = Object.assign({}, ...[...productionFiles(ROOT), ...SOURCE_PRODUCERS.map(p => join(ROOT, p))].map(file => creditSites(file)));
    expect(unexpectedSites(sites)).toStrictEqual([]);
    const source = ts.createSourceFile('admit-model.ts', readFileSync(join(ROOT, 'admit-model.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    const formatter = source.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'framedObservedState')!;
    expect(formatter.parameters[1]!.questionToken).toBeUndefined();
    expect(formatter.parameters[1]!.initializer).toBeUndefined();
  });
  it('D lexical aliases, assignments and a new stamp in an allowed function cannot escape the budget', () => {
    expect(unexpectedSites(creditSites(join(ROOT, 'stray.ts'), "const credit = 'brief_extraction'; function stray() { const source = credit; return { value: 2, source }; }")))
      .toStrictEqual(['stray.ts:stray (1 > 0)']);
    expect(unexpectedSites(creditSites(join(ROOT, 'stray.ts'), "function stray() { state.source = 'user_specified'; }")))
      .toStrictEqual(['stray.ts:stray (1 > 0)']);
    const key = 'admit-model.ts:framedObservedState';
    expect(unexpectedSites({ [key]: ALLOWED_SITES[key]! + 1 })).toStrictEqual([`${key} (4 > 3)`]);
  });
});
