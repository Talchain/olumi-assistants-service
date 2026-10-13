/**
 * ⭐ L2 (DL brief "BRIEF-L2-declared-sum-identity", 12 Oct; AIE #94 6134029017 Q1) — A SUM THE DRAFTER DECLARES IS CARRIED
 * ON ITS TOTAL THROUGH R3-2's EXISTING CARRIER, CHECKED WHOLE. DL L3b: BOUND EXPLICIT SUMS RETAIN USER AUTHORSHIP.
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
import { describe, expect, it, vi } from 'vitest';

import { AIE_APPROVED_DECLARED_SUM, BUILD_INSTRUCTIONS, buildCandidateSchema, strictForTheDrafter, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { currentDefinitionalCarrier } from '../../goal-target/held-user-links.js';
import { LLM_STRENGTH_STD_FLOOR } from '../../../cee/constants.js';

type Rec = Record<string, any>;

const FX = JSON.parse(readFileSync(new URL('./fixtures/capacity-c85817f2-construction.json', import.meta.url), 'utf8')) as {
  source: Rec; brief: string; raw_text: string;
};
const SCENARIO = 'cd3d9c25-0000-4000-8000-0000000012a1';
const SENTENCE = 'Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity.';
const GOAL = 'weekly_support_capacity';
const EXISTING = 'existing_team_capacity';
const PART = 'additional_specialist_capacity';
const RATE_LINK = `additional_specialists→${PART}`;
const OPERANDS = [`${EXISTING}→${GOAL}`, `${PART}→${GOAL}`];
const SUM = { operation: 'sum', factor_ids: [EXISTING, PART] };
const STRUCTURAL = new Set(['option', 'decision']);

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
/** Today's level in the node's own units: baseline (else value) on its frame. */
const rawToday = (g: Rec, id: string): number => {
  const n = node(g, id);
  return (n.observed_state.baseline ?? n.observed_state.value) * frameHere(n)!;
};
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
const without = (m: Map<string, Rec>, keys: readonly string[]): Map<string, Rec> => new Map([...m].filter(([k]) => !keys.includes(k)));

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

describe('GREEN — the run-5 shape: the user\'s declared sum is an identity of its parts on the PLoT request', () => {
  it('construction carries the user\'s sum and shows its bound quote; its part links are the definition, at existence 1 and the floor', async () => {
    const { graph, result } = await construct(declare(run5Shape(), { quote: SENTENCE }));
    expect(result.open_questions[0]).toBe('"Weekly support capacity" is worked out as "Existing team capacity" + "Additional specialist capacity", the definition your brief gives. Brief quote: “' + SENTENCE + '”');
    expect(node(graph, GOAL).nonlinear_identity).toEqual({ ...SUM, stated_in_brief: true });
    for (const [from, to] of [[EXISTING, GOAL], [PART, GOAL]] as const) {
      const e = edge(graph, from, to);
      expect(e.exists_probability, `${from}→${to}`).toBe(1);
      expect(e.defaulted, `${from}→${to}`).toBeUndefined();
      expect(e.strength.std, `${from}→${to}`).toBeLessThanOrEqual(LLM_STRENGTH_STD_FLOOR);
      expect(e.provenance, `${from}→${to}`).toMatchObject({ source: 'brief_extraction', source_quote: SENTENCE, magnitude: 'user_stated', definitional: true,
        natural_effect: { amount: 1, per_source_change: 1, amount_unit: 'tickets per week', per_source_change_unit: 'tickets per week' } });
      // Still a CURRENT definitional carrier after construction's frame fit (the held-link readers read exactly this).
      expect(currentDefinitionalCarrier(e), `${from}→${to}`).toBe('tickets per week');
    }
  });

  it('the Run request: the total is its parts (80 = 80 + 0 today); the specialist-rate uncertainty is KEPT, unchanged in natural units', async () => {
    const { graph: stored } = await construct(declare(run5Shape(), { quote: SENTENCE }));
    const declared = (await runRequest(stored)).graph as Rec;
    const plain = (await runRequest((await construct(run5Shape())).graph)).graph as Rec;
    // The identity rides the goal node to PLoT, over exactly the two parts, as the user's definition.
    expect(node(declared, GOAL).nonlinear_identity).toEqual({ ...SUM, stated_in_brief: true });
    expect(node(plain, GOAL).nonlinear_identity).toBeUndefined();
    // Today's levels in natural units reconcile exactly: the stated 80 is the existing 80 plus no specialist capacity.
    expect([rawToday(declared, GOAL), rawToday(declared, EXISTING), rawToday(declared, PART)].map((x) => Number(x.toPrecision(12)))).toEqual([80, 80, 0]);
    // The two definition links go certain; every other link — the user's 20 ± 10 per specialist above all — is untouched.
    const [d, p] = [naturalLinks(declared), naturalLinks(plain)];
    for (const k of OPERANDS) expect(d.get(k), k).toMatchObject({ exists: 1, mean: 1, source: 'brief_extraction', magnitude: 'user_stated' });
    for (const k of OPERANDS) expect(p.get(k), k).toMatchObject({ mean: 1, std: 0.5, magnitude: 'olumi_estimate' });
    expect(without(d, OPERANDS)).toEqual(without(p, OPERANDS));
    expect(d.get(RATE_LINK)).toEqual({ mean: 20, std: 10, exists: 0.8, source: 'brief_extraction', magnitude: 'user_stated' });
    // The user's 10–30 stays held, verbatim, on the stored model (the wire copy drops level ranges: `withoutStatedLevelRanges`).
    expect(node(stored, 'tickets_per_specialist_per_week').observed_state.range).toMatchObject({ low: 10, high: 30, meaning: 'min_max',
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

  it.each(DENIALS)('L4 row (c): an unverified false declaration from a denial is nonoperative, with AI origin and retained evidence: %s', async (quote) => {
    const brief = FX.brief.replace(SENTENCE, quote);
    const { graph, result: acceptedResult } = await construct(declare(run5Shape(), { quote }), brief);
    // L4 explicitly supersedes the L3b wrong-author expectation. Keep exact assertions RED until the source is fixed.
    expect(node(graph, GOAL).nonlinear_identity).toEqual(undefined);
    for (const from of [EXISTING, PART]) {
      const p = edge(graph, from, GOAL).provenance;
      expect({ source: p.source, magnitude: p.magnitude, source_quote: p.source_quote, definitional: p.definitional })
        .toEqual({ source: 'cee_hypothesis', magnitude: 'olumi_estimate', source_quote: quote, definitional: false });
    }
    expect(acceptedResult.open_questions[0]).toContain(`Brief quote: “${quote}”`);
    expect(node((await runRequest(graph)).graph, GOAL).nonlinear_identity).toEqual(undefined);
    const inconsistent = partWithLevel(goalLevelAsRun5(served()), 15);
    const { graph: rejected, result } = await construct(declare(inconsistent, { quote }), brief);
    const { graph: plain } = await construct(inconsistent, brief);
    expect(node(rejected, GOAL).nonlinear_identity).toBeUndefined();
    expect(naturalLinks(rejected)).toEqual(naturalLinks(plain));
    expect(result.not_represented).toContain(refused('today "Weekly support capacity" is 80 while those parts add up to 95'));
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
