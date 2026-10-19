/**
 * ⭐ L2 (DL brief "BRIEF-L2-declared-sum-identity", 12 Oct; AIE #94 6134029017 Q1) — A SUM THE DRAFTER DECLARES IS CARRIED
 * ON ITS TOTAL THROUGH R3-2's EXISTING CARRIER, CHECKED WHOLE.
 * ⛔ USER-DECLARED EXACT SUMS: A CAPABILITY STILL OWED, TEMPORARILY FAIL-CLOSED (Codex #3440 R3; DL-3, PL 11:05). A sum read from a
 * sentence of the brief is never taken, as the user's or as Olumi's: the links stay as drafted and the reason is said once.
 *
 * Run 5 (served CEE 551258bb, capacity brief): "Total weekly support capacity is defined as the existing 80 tickets per week
 * plus the additional specialist capacity" reached the engine as two uncertain links (exists 0.8, ±0.5), and the reply
 * called the user's definition Olumi's assumption (`recovery/run5-diag/CAPACITY-FRAME.md`).
 *
 * THE ROW IS THE REAL PATH: the SERVED drafter response for this brief text (`cee_drafter_raw_responses` row 470fa988,
 * hash pinned in `capacity-level-chance-frames.test.ts`; its brief is byte-identical, trimmed, to run 5's `brief.txt`)
 * → construction (`buildModelFromBrief`, one scripted drafter call) → the registered graph → the production snapshot
 * loader → the real Run handler, whose probe captures the exact PLoT request body. 0 LLM calls; PLoT is never called.
 *
 * ⚠ WHAT IS SELF-AUTHORED, SAID PLAINLY: the recorded served draft predates sum support. The AIE-approved text is now
 * wired, but no provider call has been made with it here. Declaration rows below add ONE
 * declaration to the served draft, shaped as the approved text asks: the total, the parts, the defining sentence, and
 * each part as a quantity with its level today. The GREEN row also types the goal's 80 `explicit`, as run 5's stored goal
 * held it (`reads/02-04`: `brief_extraction`, raw 80). These rows prove ADMISSION → PAYLOAD; they prove nothing about what
 * the drafter will emit. Expectations are written by hand, never read back from the code. No chance is asserted.
 */
import { Ajv } from 'ajv';
import { readFileSync } from 'node:fs';
import type { StatementStance } from '../construction-source-map.js';
import { withDeclaredStance } from './helpers/declared-stance.js';
import { describe, expect, it, vi } from 'vitest';

import { AIE_APPROVED_DECLARED_SUM, BUILD_INSTRUCTIONS, buildCandidateSchema, strictForTheDrafter, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { linkEffectQuoteContextMiss } from '../stated-by-user.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';

type Rec = Record<string, any>;

const FX = JSON.parse(readFileSync(new URL('./fixtures/capacity-c85817f2-construction.json', import.meta.url), 'utf8')) as {
  source: Rec; brief: string; raw_text: string;
};
const SCENARIO = 'cd3d9c25-0000-4000-8000-0000000012a1';
const SENTENCE = 'Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity.';
const GOAL = 'weekly_support_capacity';
const EXISTING = 'existing_team_capacity';
const PART = 'additional_specialist_capacity';
const OPERANDS = [`${EXISTING}→${GOAL}`, `${PART}→${GOAL}`];
const SUM = { operation: 'sum', factor_ids: [EXISTING, PART] };
const STRUCTURAL = new Set(['option', 'decision']);
/**
 * ⭐ THE SERVED SYSTEM 2 DRAFT FOR THIS VERY BRIEF (cfa31dfb, drafter raw 5d0a23b7): it declares the user's sum with its quote AND
 * states the relation (`field: 'relation'`) on the defining sentence, with its levels, settings, effect and target as statements.
 * The genuine affirmative: while the capability is owed, even it is not taken (the links stay as drafted).
 */
const SYS2 = JSON.parse(readFileSync(new URL('../../../routes/__tests__/fixtures/capacity-cfa31dfb-first-draft.json', import.meta.url), 'utf8')) as {
  source: string; brief: string; raw_text: string;
};
const EXISTING2 = 'existing_team_support_capacity';
const OPERANDS2 = [`${EXISTING2}→${GOAL}`, `${PART}→${GOAL}`];
/**
 * INPUT CHANGE (stance, AIE 543db8bb): each statement's stance as the drafter now declares it, by meaning. The team's 80 is a
 * current assertion; the options' settings are what-ifs; the specialist's "about 20, between 10 and 30" an estimate; the goal a
 * target. The defining sentence is a current assertion only as the affirmative; a supposition, question or denial put in its place
 * asserts no current relation (a relation statement earns no credit either way: only a level does).
 */
const stanceIn = (st: Rec, sentence: string): StatementStance => {
  if (st.field === 'target') return 'target';
  if ((st.subject as Rec).kind === 'option') return 'hypothetical';
  if (st.form === 'range') return 'estimate';
  if (st.field === 'relation') return sentence === SENTENCE ? 'stated_current' : 'hypothetical';
  return 'stated_current';
};
/** That draft with the defining sentence replaced in the brief and wherever the drafter quoted it (its relation statement too). */
const sys2 = (sentence = SENTENCE, o: { declared?: boolean; relation?: boolean } = {}): { raw: Rec; brief: string } => {
  const raw = withDeclaredStance(JSON.parse(SYS2.raw_text.split(SENTENCE).join(sentence)) as Rec, (st) => stanceIn(st, sentence));
  if (o.declared === false) raw.identities = raw.identities.filter((i: Rec) => i.operation !== 'sum');
  if (o.relation === false) raw.statements = raw.statements.filter((x: Rec) => x.field !== 'relation');
  return { raw, brief: SYS2.brief.split(SENTENCE).join(sentence) };
};
/** The one reason a quoted (user-declared) sum is not taken while that capability is owed. */
const OWED = 'Olumi can’t yet take a sum from your own words';
const refused2 = (why: string): string => 'Olumi read "Weekly support capacity" as "Existing team support capacity" and "Additional specialist capacity" '
  + `added together, but ${why}, so that was not used and nothing about it is assumed.`;

/** The words a refused declaration is said in (admission's ledger, read back through `not_represented`). */
const refused = (why: string): string => 'Olumi read "Weekly support capacity" as "Existing team capacity" and "Additional specialist capacity" '
  + `added together, but ${why}, so that was not used and nothing about it is assumed.`;
const PRODUCT_REFUSED = 'Olumi read "Additional specialist capacity" as "Additional specialists" and "Tickets per specialist per week" '
  + 'multiplied together, but "Additional specialists" is 0 today, so that was not used and nothing about it is assumed.';

// ── The served draft, and the one declaration each row adds ───────────────────────────────────────────────────────────
const served = (): Rec => JSON.parse(FX.raw_text);
const declare = (c: Rec, evidence?: Rec | null): Rec => ({ ...c, identities: [...c.identities, {
  outcome: 'Weekly support capacity', operation: 'sum', factors: ['Existing team capacity', 'Additional specialist capacity'],
  provenance: 'explicit', reading: null, ...(evidence === undefined ? {} : { evidence }) }] });
/** One drafter statement, as the SYSTEM 2 drafter writes it. */
const said = (quote: string, subject: Rec, field: string, form: string, value: number | null, unit: string | null): Rec => ({ quote,
  subject: { to_label: null, factor_label: null, ...subject }, field, form, value, low: null, high: null, unit, qualifier: null, conditions: null,
  stance: 'stated_current' });
/**
 * The goal's level today stated in its own sentence, apart from any sum, with the drafter's statement of it: the sum is then
 * judged at its own quote, past "has no figure today" (a level is no longer derived from a quoted sum: Codex #3440 R3).
 */
const TODAY = 'Weekly support capacity today is 80 tickets per week.';
const withLevel = ({ raw, brief }: { raw: Rec; brief: string }): { raw: Rec; brief: string } => ({ brief: `${brief} ${TODAY}`,
  raw: { ...raw, statements: [...raw.statements, said(TODAY, { kind: 'goal', label: 'Weekly support capacity' }, 'level', 'point', 80, 'tickets per week')] } });
/** Run 5 held the brief's 80 as the goal's level (`brief_extraction`); the served c85817f2 draft typed it "inferred". */
const goalLevelAsRun5 = (c: Rec): Rec => ({ ...c, goal: { ...c.goal, baseline_provenance: 'explicit' } });
/** The approved text's part: a quantity with its level today (0: no specialist is added today), in the total's unit. */
const partWithLevel = (c: Rec, value = 0, unit = 'tickets per week'): Rec => ({ ...c,
  outcomes: c.outcomes.filter((o: Rec) => o.label !== 'Additional specialist capacity'),
  factors: [...c.factors, { label: 'Additional specialist capacity', role: 'observable', baseline_known: false, baseline_evidence: null,
    baseline_value: value, unit, provenance: 'inferred', plausible_max: 300 }] });
const run5Shape = (): Rec => partWithLevel(goalLevelAsRun5(served()));

// ── Construction and the Run request, on the production path ──────────────────────────────────────────────────────────
async function construct(raw: Rec, brief = FX.brief): Promise<{ graph: Rec; result: Rec; retainedBrief: string }> {
  let registered: unknown;
  let retainedBrief = '';
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      retainedBrief = (body as { brief_text: string }).brief_text;
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const call = (async () => ({ text: JSON.stringify(raw) })) as unknown as CallStructuredModel;
  const result = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 400)).toBe(true);
  return { graph: GraphV3.parse(registered) as unknown as Rec, result, retainedBrief };
}

async function runRequest(graph: Rec): Promise<Rec> {
  const bytes = JSON.stringify(GraphV3.parse(graph));
  const port = {
    loadGraphAndBriefText: vi.fn(async () => ({ graph: JSON.parse(bytes), briefText: FX.brief, revision: 2 })),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-l2', port as never);
  let payload: Rec | undefined;
  const handler = createRunAnalysisHandler({
    plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    scenarioReader: async () => snapshot,
    probe: async (sent) => { payload = sent.plotPayload as Rec; },
  });
  await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-l2', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-l2', scenario_id: SCENARIO, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-l2', signal: new AbortController().signal, orientationText: '',
  } as never);
  expect(payload, 'the Run handler built a PLoT request').toBeDefined();
  return payload!;
}

// ── Readers written here from the contract, never the code under test ────────────────────────────────────────────────
const node = (g: Rec, id: string): Rec => (g.nodes as Rec[]).find((n) => n.id === id)!;
const edge = (g: Rec, from: string, to: string): Rec => (g.edges as Rec[]).find((e) => e.from === from && e.to === to)!;
function frameHere(n: Rec | undefined): number | undefined {
  if (n === undefined || STRUCTURAL.has(n.kind)) return undefined;
  const os = n.observed_state ?? {};
  if (n.scale_frame > 1) return n.scale_frame;
  if (os.cap > 1) return os.cap;
  if (n.kind === 'goal' && n.goal_threshold_cap > 1) return n.goal_threshold_cap;
  if (typeof os.raw_value === 'number' && typeof os.value === 'number' && os.value !== 0) return os.raw_value / os.value;
  return 1;
}
/** Every causal link in NATURAL units (β·F_to/F_from), with its existence and who drew and sized it. */
function naturalLinks(g: Rec): Map<string, Rec> {
  const byId = new Map((g.nodes as Rec[]).map((n) => [n.id, n]));
  const out = new Map<string, Rec>();
  for (const e of g.edges as Rec[]) {
    const [s, t] = [frameHere(byId.get(e.from)), frameHere(byId.get(e.to))];
    if (s === undefined || t === undefined) continue;
    out.set(`${e.from}→${e.to}`, { mean: Number(((e.strength.mean * t) / s).toPrecision(10)), std: Number(((e.strength.std * t) / s).toPrecision(10)),
      exists: e.exists_probability, source: e.provenance?.source, magnitude: e.provenance?.magnitude });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('PRECONDITIONS: the served draft, and the approved text now sent', () => {
  it('the brief is the run-5 capacity brief text; the served draft declares only a product, never a sum', () => {
    expect(FX.source.drafter_raw.row_id).toBe('470fa988-8f8c-461f-b410-908f123124f3');
    expect(FX.brief).toContain(SENTENCE);
    expect(served().identities.map((i: Rec) => i.operation)).toEqual(['product']);
  });

  it('the AIE-approved schema and instruction are wired, with evidence required only at the provider boundary', () => {
    const items = ((buildCandidateSchema().properties as Rec).identities as Rec).items as Rec;
    expect(items.properties.operation.enum).toEqual(['product', 'sum', 'accumulation']);
    expect(items.properties.evidence).toEqual(AIE_APPROVED_DECLARED_SUM.evidence);
    expect(items.properties.outcome.description).toBe('The EXACT label of the quantity defined by the product or sum, or the stock at the deadline.');
    expect(BUILD_INSTRUCTIONS).toContain(AIE_APPROVED_DECLARED_SUM.instruction);
    for (const providerBoundary of [false, true]) {
      const schema = strictForTheDrafter(buildCandidateSchema(), { providerBoundary }) as Rec;
      expect(schema.properties.identities.items.required.includes('evidence')).toBe(providerBoundary);
    }
  });

  it('the drafter schema accepts a sum with a quote; a product identity is unchanged', () => {
    const schema = strictForTheDrafter(buildCandidateSchema()) as Rec;
    const validate = new Ajv({ strict: false }).compile(schema.properties.identities.items);
    const sum = { outcome: 'Weekly support capacity', operation: 'sum',
      factors: ['Existing team capacity', 'Additional specialist capacity'], provenance: 'explicit', reading: null,
      evidence: { quote: SENTENCE } };
    expect(validate(sum), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...sum, evidence: {} })).toBe(false);
    expect(validate({ ...sum, evidence: { quote: 80 } })).toBe(false);
    expect(validate({ ...sum, evidence: { quote: SENTENCE, stated: true } })).toBe(false);
    const product = served().identities[0];
    const before = JSON.stringify(product);
    const candidate = new Ajv({ strict: false }).compile((buildCandidateSchema() as Rec).properties.identities.items);
    expect(candidate(product), JSON.stringify(candidate.errors)).toBe(true);
    expect(validate({ ...product, reading: product.reading ?? null, evidence: null }), JSON.stringify(validate.errors)).toBe(true);
    expect(JSON.stringify(product)).toBe(before);
  });
});

describe('⛔ OWED (temporarily fail-closed) — the served SYSTEM 2 draft (cfa31dfb): the user\'s declared and stated sum is not taken', () => {
  it('PRECONDITION: the same brief; the draft declares the sum with the defining sentence and states that relation on it', () => {
    expect(SYS2.brief).toBe(FX.brief);
    const raw = JSON.parse(SYS2.raw_text) as Rec;
    expect(raw.identities.find((i: Rec) => i.operation === 'sum')).toMatchObject({ outcome: 'Weekly support capacity', provenance: 'explicit', evidence: { quote: SENTENCE } });
    expect(raw.statements.filter((x: Rec) => x.field === 'relation')).toEqual([expect.objectContaining({ quote: SENTENCE, form: 'describes',
      subject: expect.objectContaining({ kind: 'goal', label: 'Weekly support capacity' }) })]);
  });

  it('the genuine affirmative is not taken while the capability is owed: no identity, the links exactly as drafted, the reason said once', async () => {
    const { graph, result } = await construct(withLevel(sys2()).raw, withLevel(sys2()).brief);
    const { graph: drafted } = await construct(withLevel(sys2(SENTENCE, { declared: false })).raw, withLevel(sys2()).brief);
    expect(node(graph, GOAL).observed_state, 'the goal\'s own stated level stays the user\'s').toMatchObject({ raw_value: 80, source: 'brief_extraction' });
    expect(node(graph, GOAL).nonlinear_identity).toBeUndefined();
    expect(naturalLinks(graph)).toEqual(naturalLinks(drafted));
    for (const k of OPERANDS2) expect(naturalLinks(graph).get(k)?.magnitude, k).not.toBe('user_stated');
    expect((result.not_represented as string[]).filter((x) => x.includes('added together'))).toEqual([refused2(OWED)]);
    expect((result.open_questions ?? []).join(' ')).not.toContain('the definition your brief gives');
  });

  it('the goal\'s level today is not derived from the quoted sum: no level, readiness asks for it, and the sum is refused on that', async () => {
    const { graph, result } = await construct(sys2().raw, sys2().brief);
    expect(node(graph, GOAL).observed_state ?? null).toBeNull();
    expect(JSON.stringify(targetTestabilityOf(graph))).toContain('missing_goal_baseline');
    expect((result.not_represented as string[]).filter((x) => x.includes('added together'))).toEqual([refused2('"Weekly support capacity" has no figure today')]);
  });

  it('the Run request carries no sum: every link is sent exactly as the same draft with no sum declared', async () => {
    const { graph: stored } = await construct(sys2().raw, sys2().brief);
    const declared = (await runRequest(stored)).graph as Rec;
    const plain = (await runRequest((await construct(sys2(SENTENCE, { declared: false }).raw, SYS2.brief)).graph)).graph as Rec;
    expect(node(declared, GOAL).nonlinear_identity).toBeUndefined();
    expect(naturalLinks(declared)).toEqual(naturalLinks(plain));
    // The user's 10–30 stays held, verbatim, on the stored model (the wire copy drops level ranges: `withoutStatedLevelRanges`).
    expect(node(stored, 'tickets_resolved_per_additional_specialist').observed_state.range).toMatchObject({ low: 10, high: 30, meaning: 'min_max',
      source_quote: 'Each additional specialist resolves about 20 tickets per week, between 10 and 30.' });
  });
});

describe('CONTRASTS', () => {
  const DENIALS = [
    'Weekly support capacity is not Existing team capacity plus Additional specialist capacity.',
    'Total weekly support capacity is not the existing 80 tickets per week plus the additional specialist capacity.',
  ];

  it.each(DENIALS)('denial without a declaration: retained source, no held sum: %s', async (quote) => {
    const brief = FX.brief.replace(SENTENCE, quote);
    const { graph, result, retainedBrief } = await construct(run5Shape(), brief);
    expect(retainedBrief).toBe(brief);
    expect(retainedBrief).toContain(quote);
    expect(node(graph, GOAL).nonlinear_identity).toBeUndefined();
    for (const k of OPERANDS) expect(naturalLinks(graph).get(k), k).toMatchObject({ exists: 0.8, mean: 1, std: 0.5, magnitude: 'olumi_estimate' });
    expect((result.open_questions ?? []).join(' ')).not.toContain('the definition your brief gives');
  });

  /**
   * ⭐ CHANGED, NOT LOOSENED (Codex #3440 BLOCK; AIE L2-RELATION 18bf4f8c): this row pinned the "accepted AI-misreading residual",
   * a declaration read from a DENIAL made operative as the user's sum. The AIE ruled it out: a denied identity gets no licence from
   * a declaration, a co-mention or reconciliation, and it is not relabelled as Olumi's. It now asserts the base: no identity, the
   * links exactly as drafted, the reason said once. Worst case, as Codex scripted it: the drafter ALSO states the relation on the
   * denial, so the polarity is read from the user's whole sentence by the existing context reader. The reconciliation refusal
   * below is unchanged.
   */
  const SYS2_DENIALS = [
    'Weekly support capacity is not Existing team support capacity plus Additional specialist capacity.',
    'Total weekly support capacity is not the existing 80 tickets per week plus the additional specialist capacity.',
  ];
  it.each(SYS2_DENIALS)('a declaration read from a denial is NOT operative, nor relabelled as Olumi\'s: the links stay as drafted, said once: %s', async (quote) => {
    const { raw, brief } = sys2(quote);
    const { graph, result: refusedResult } = await construct(raw, brief);
    const { graph: drafted } = await construct(sys2(quote, { declared: false }).raw, brief);
    expect(node(graph, GOAL).nonlinear_identity).toBeUndefined();
    expect(naturalLinks(graph)).toEqual(naturalLinks(drafted));
    expect(refusedResult.not_represented).toContain(refused2('your brief says that is not so'));
    // The denial is said first and once, whatever else fails: on parts that also do not add up (80 ≠ 80 + 15), in the older shape.
    const denial = DENIALS[SYS2_DENIALS.indexOf(quote)]!;
    const inconsistent = partWithLevel(goalLevelAsRun5(served()), 15);
    const { graph: rejected, result } = await construct(declare(inconsistent, { quote: denial }), FX.brief.replace(SENTENCE, denial));
    const { graph: plain } = await construct(inconsistent, FX.brief.replace(SENTENCE, denial));
    expect(node(rejected, GOAL).nonlinear_identity).toBeUndefined();
    expect(naturalLinks(rejected)).toEqual(naturalLinks(plain));
    expect((result.not_represented as string[]).filter((x) => x.includes('added together'))).toEqual([refused('your brief says that is not so')]);
  });

  it.each(DENIALS)('Olumi\'s reading (no quote) cannot override the brief\'s denial: no sum, the links as drafted, said: %s', async (quote) => {
    const brief = FX.brief.replace(SENTENCE, quote);
    const { graph, result } = await construct(declare(run5Shape(), null), brief);
    const { graph: drafted } = await construct(run5Shape(), brief);
    expect(node(graph, GOAL).nonlinear_identity).toBeUndefined();
    expect(naturalLinks(graph)).toEqual(naturalLinks(drafted));
    expect(result.not_represented).toContain(refused('your brief says that is not so'));
  });

  it('a QUESTION is no statement of the sum, even with the drafter\'s relation statement on it: no sum, the links as drafted, said', async () => {
    const question = 'Is total weekly support capacity the existing 80 tickets per week plus the additional specialist capacity?';
    const { raw, brief } = withLevel(sys2(question));
    const { graph, result } = await construct(raw, brief);
    const { graph: drafted } = await construct(withLevel(sys2(question, { declared: false })).raw, brief);
    expect(node(graph, GOAL).nonlinear_identity).toBeUndefined();
    expect(naturalLinks(graph)).toEqual(naturalLinks(drafted));
    expect(result.not_represented).toContain(refused2(OWED));
  });

  /**
   * ⭐ Codex R2/R3 #3440 BLOCK: a sum the user only SUPPOSES is not stated, and no finite matcher establishes an assertion. Codex's
   * own probes, R3's two witnesses included: the defining sentence a supposition, the drafter's relation statement on it, and the
   * goal's level today stated separately (so no earlier check masks it). Fail-closed, none reaches the Run as anyone's sum.
   */
  const HYPOTHETICALS = [
    'If total weekly support capacity were the existing 80 tickets per week plus the additional specialist capacity, we could compare the options.',
    'Suppose total weekly support capacity is the existing 80 tickets per week plus the additional specialist capacity.',
    'Total weekly support capacity is the existing 80 tickets per week plus the additional specialist capacity, assuming we hire one.',
    'In a world where total weekly support capacity is the existing 80 tickets per week plus the additional specialist capacity, we could compare the options.',
    'Let\'s say total weekly support capacity is the existing 80 tickets per week plus the additional specialist capacity.',
  ];
  it.each(HYPOTHETICALS)('⭐ RED→GREEN: a supposed sum is no one\'s sum, even with the drafter\'s relation statement and the level stated apart: %s', async (hypothetical) => {
    const { raw, brief } = withLevel(sys2(hypothetical));
    const { graph, result } = await construct(raw, brief);
    const { graph: drafted } = await construct(withLevel(sys2(hypothetical, { declared: false })).raw, brief);
    expect(node(graph, GOAL).nonlinear_identity).toBeUndefined();
    expect(naturalLinks(graph)).toEqual(naturalLinks(drafted));
    const wire = (await runRequest(graph)).graph as Rec;
    expect(node(wire, GOAL).nonlinear_identity).toBeUndefined();
    expect(naturalLinks(wire)).toEqual(naturalLinks((await runRequest(drafted)).graph as Rec));
    expect(result.not_represented).toContain(refused2(OWED));
  });
  it('CONTRAST (the shared effect reader, unchanged): a conditional is how a causal EFFECT is stated; a question or denial is not a statement', () => {
    const effect = 'If we add one packer, daily order throughput rises by 15 orders per day.';
    expect(linkEffectQuoteContextMiss(effect, effect)).toBeNull();
    const denial = 'Adding one packer does not raise daily order throughput.';
    expect(linkEffectQuoteContextMiss(denial, denial)).toBe('denied');
    const question = 'Does adding one packer raise daily order throughput?';
    expect(linkEffectQuoteContextMiss(question, question)).toBe('question');
  });

  it('the drafter\'s relation statement grants nothing: with or without it, the quoted sum is not taken, said once', async () => {
    for (const relation of [true, false]) {
      const { raw, brief } = withLevel(sys2(SENTENCE, { relation }));
      const { graph, result } = await construct(raw, brief);
      expect(node(graph, GOAL).nonlinear_identity, `relation=${relation}`).toBeUndefined();
      expect((result.not_represented as string[]).filter((x) => x.includes('added together')), `relation=${relation}`).toEqual([refused2(OWED)]);
    }
  });

  it('Olumi\'s reading: a declared sum with NO brief quote is carried, still Olumi\'s, whatever provenance the drafter typed', async () => {
    const { graph, result } = await construct(declare(run5Shape(), null));
    expect(node(graph, GOAL).nonlinear_identity).toEqual({ ...SUM, stated_in_brief: false });
    for (const [from, to] of [[EXISTING, GOAL], [PART, GOAL]] as const) {
      const e = edge(graph, from, to);
      expect([e.exists_probability, e.provenance.source, e.provenance.magnitude, e.provenance.definitional], `${from}→${to}`)
        .toEqual([1, 'cee_hypothesis', 'olumi_estimate', true]);
      expect(e.provenance.source_quote, `${from}→${to}`).toBeUndefined();
    }
    const sent = (await runRequest(graph)).graph as Rec;
    expect(node(sent, GOAL).nonlinear_identity).toEqual({ ...SUM, stated_in_brief: false });
    expect(JSON.stringify(result.not_represented)).not.toContain('added together');
  });

  it('a quote CEE cannot find in the brief is of unknown origin: nothing is written, the links stay as drafted', async () => {
    const { graph, result } = await construct(declare(run5Shape(), { quote: 'Total weekly support capacity is the existing team plus specialists.' }));
    const { graph: plain } = await construct(run5Shape());
    expect(node(graph, GOAL).nonlinear_identity).toBeUndefined();
    expect(naturalLinks(graph)).toEqual(naturalLinks(plain));
    expect(result.not_represented).toContain(refused('the sentence it was read from is not one Olumi can find in your brief naming each of them'));
  });

  it('inconsistent today values (a part at 15: 80 ≠ 80 + 15): not written, the links stay as drafted, said once', async () => {
    const { graph, result } = await construct(declare(partWithLevel(goalLevelAsRun5(served()), 15), { quote: SENTENCE }));
    const { graph: plain } = await construct(partWithLevel(goalLevelAsRun5(served()), 15));
    expect(node(graph, GOAL).nonlinear_identity).toBeUndefined();
    expect(naturalLinks(graph)).toEqual(naturalLinks(plain));
    expect((result.not_represented as string[]).filter((s) => s.includes('added together')))
      .toEqual([refused('today "Weekly support capacity" is 80 while those parts add up to 95')]);
  });

  it('unit mismatch (a part in tickets per MONTH under a weekly total): not written, the links stay as drafted', async () => {
    const { graph, result } = await construct(declare(partWithLevel(goalLevelAsRun5(served()), 0, 'tickets per month'), { quote: SENTENCE }));
    const { graph: plain } = await construct(partWithLevel(goalLevelAsRun5(served()), 0, 'tickets per month'));
    expect(node(graph, GOAL).nonlinear_identity).toBeUndefined();
    expect(naturalLinks(graph)).toEqual(naturalLinks(plain));
    expect(result.not_represented).toContain(refused('"Additional specialist capacity" is not linked into "Weekly support capacity" one for one in the same unit'));
  });

  it('AS SERVED in run 5 (the part an outcome with no level today): not written, since ISL needs every part\'s level, and said', async () => {
    const { graph, result } = await construct(declare(goalLevelAsRun5(served()), { quote: SENTENCE }));
    const { graph: plain } = await construct(goalLevelAsRun5(served()));
    expect(node(graph, PART).kind).toBe('outcome');
    expect(node(graph, GOAL).nonlinear_identity).toBeUndefined();
    expect(naturalLinks(graph)).toEqual(naturalLinks(plain));
    expect(result.not_represented).toContain(refused('"Additional specialist capacity" has no figure today'));
  });

  it('a PRODUCT identity is unchanged: the served draft\'s product is refused in the same words, beside a declared sum or not', async () => {
    const { graph: withSum, result: r1 } = await construct(declare(run5Shape(), { quote: SENTENCE }));
    const { graph: plain, result: r0 } = await construct(run5Shape());
    for (const r of [r0, r1]) expect((r.not_represented as string[]).filter((s) => s.includes('multiplied together'))).toEqual([PRODUCT_REFUSED]);
    for (const g of [plain, withSum]) expect(node(g, PART).nonlinear_identity).toBeUndefined();
  });
});

/**
 * ⭐ SERVED AFTER #2981 (DL 13:36Z 14 Oct): on CEE cbcefb47 the drafter, under the sum text, typed the total's 80 `inferred`
 * (drafter row 7b90af18, byte for byte). The goal held no level, its sum was refused, and capacity asked for "today's level of
 * Weekly support capacity". The user's own sum (their sentence, their 80, a zero increment) fixes that level: it is theirs.
 * The rows above typed the goal's 80 `explicit` by hand (`goalLevelAsRun5`); these use the served draft as it is.
 */
describe('⭐ SERVED cbcefb47: the total of the user\'s own sum is the user\'s level today', () => {
  const SERVED13 = JSON.parse(readFileSync(new URL('./fixtures/capacity-cbcefb47-declared-sum-construction.json', import.meta.url), 'utf8')) as { brief: string; raw_text: string };
  const draft13 = (): Rec => JSON.parse(SERVED13.raw_text);
  const part = (c: Rec, label: string): Rec => c.factors.find((f: Rec) => f.label === label);

  it('fixture control: the served draft types the goal\'s 80 inferred, beside the user\'s sum and their stated 80', () => {
    const c = draft13();
    expect(SERVED13.brief).toBe(FX.brief);
    expect(c.goal).toMatchObject({ metric: 'Weekly support capacity', baseline_value: 80, baseline_known: true, baseline_provenance: 'inferred' });
    expect(c.identities).toEqual([expect.objectContaining({ operation: 'sum', outcome: 'Weekly support capacity', evidence: { quote: SENTENCE } })]);
    expect(part(c, 'Existing team capacity')).toMatchObject({ baseline_value: 80, provenance: 'explicit' });
    expect(part(c, 'Additional specialist capacity')).toMatchObject({ baseline_value: 0, provenance: 'inferred', baseline_evidence: null });
  });

  /**
   * ⛔ CHANGED (Codex #3440 R3; DL-3 ruling by measurement): this row held the goal's 80 as the user's, derived from their quoted sum.
   * Measured, Codex's witnesses "In a world where …" and "Let's say …" made it the user's too: the same hole. While user-declared
   * sums are owed, no level is derived from a quoted sum; the goal's level today is withheld and readiness asks for it instead.
   */
  const SUPPOSED = [
    'In a world where total weekly support capacity is the existing 80 tickets per week plus the additional specialist capacity, we could compare the options.',
    'Let\'s say total weekly support capacity is the existing 80 tickets per week plus the additional specialist capacity.',
  ];
  it.each([SENTENCE, ...SUPPOSED])('⭐ no goal level from a quoted sum (the affirmative and Codex\'s witnesses alike): withheld, readiness asks: %s', async (sentence) => {
    const swap = (x: string): string => x.split(SENTENCE).join(sentence);
    const { graph } = await construct(JSON.parse(swap(SERVED13.raw_text)), swap(SERVED13.brief));
    expect(node(graph, GOAL).observed_state ?? null).toBeNull();
    expect(node(graph, GOAL).goal_level_reading).toBeUndefined();
    expect(JSON.stringify(targetTestabilityOf(graph))).toContain('missing_goal_baseline');
  });

  it('ADVERSARIAL: the non-zero part is Olumi\'s (no sentence states it) → the goal\'s level stays Olumi\'s, withheld', async () => {
    const c = draft13();
    Object.assign(part(c, 'Existing team capacity'), { provenance: 'inferred', baseline_evidence: null, baseline_value: 75 });
    c.goal.baseline_value = 75;
    const { graph } = await construct(c, SERVED13.brief);
    expect(node(graph, GOAL).observed_state ?? null).toBeNull();
  });

  it('NEGATIVE: the parts do not add up to the drafter\'s level (90 ≠ 80 + 0) → withheld', async () => {
    const c = draft13();
    c.goal.baseline_value = 90;
    const { graph } = await construct(c, SERVED13.brief);
    expect(node(graph, GOAL).observed_state ?? null).toBeNull();
  });

  it('NEGATIVE: the sum has no sentence of the brief (Olumi\'s reading) → withheld', async () => {
    const c = draft13();
    c.identities[0].evidence = null;
    const { graph } = await construct(c, SERVED13.brief);
    expect(node(graph, GOAL).observed_state ?? null).toBeNull();
  });
});
