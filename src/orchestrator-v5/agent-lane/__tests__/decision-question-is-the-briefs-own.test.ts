/**
 * ⭐ THE QUESTION CARD ASKS THE BRIEF'S OWN QUESTION, NOT "Decision: <goal metric>".
 *
 * SERVED (Paul, 27 Sep, export olumi-debug-17d1cd3a): the brief asked "…should we increase the Pro plan price from £49
 * to £59 per month with the next Pro feature release?" and the Question card read "Decision: MRR" — the admitted
 * decision node's label is minted from the goal metric (`admit-model.ts`), and the UI shows that label verbatim
 * (DGAI `DecisionNode.tsx`: "Title (the question, the data label verbatim)").
 *
 * The drafter now COPIES the question (`decision_question`), and admission accepts it only as TYPED GROUNDING: a
 * verbatim substring of the brief (whitespace collapsed), 8 to 240 characters. No word list, no parsing of English.
 * Anything else — null, an older candidate without the key, a paraphrase, an over-long span — keeps exactly
 * "Decision: <metric>". Every row drives the REAL `buildModelFromBrief` with the model call faked (nothing live) and
 * reads what it registers, by kind.
 *
 * ⚠ THE LABEL BUDGET STILL APPLIES. Admission shortens EVERY label over 33 characters at a word boundary and keeps the
 * full text on `description` (`shortLabel`, `label-budget.test.ts`): a structural edit composes two labels into an
 * 80-character summary. So the question's full text is the node's `description` and its identity
 * (`construction-size-gate.ts` `nodeIdentity`), and its `label` is the budgeted form of it.
 */
import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { shortLabel, type CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, retrySchemaPinningGoal, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { transformResponseToV3, type V1DraftGraphResponse } from '../../../cee/transforms/index.js';

/** Paul's brief, verbatim from the export's `payloads.cee_request.message`. */
const BRIEF =
  'Given our goal of reaching £100k MRR within 12 months [Currently 75k] while keeping monthly churn under 4%, ' +
  'should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';
const QUESTION = 'should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';
const TITLE = 'Should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';
const FALLBACK = 'Decision: MRR';

/** A 300-character question that IS in its brief, so only the length bound can refuse it. */
const LONG_QUESTION =
  'should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release, while moving ' +
  'every annual subscriber onto the new price at renewal, extending the free trial from fourteen to thirty days for ' +
  'new sign-ups, and offering a loyalty discount to buyers who joined in 2023?';
const LONG_BRIEF = `Given our goal of reaching £100k MRR within 12 months [Currently 75k], ${LONG_QUESTION}`;

const link = (from: string, to: string, direction: 'positive' | 'negative') =>
  ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });

/** Paul's pricing decision, in the strict wire shape. `question` undefined = a candidate from before the key. */
function pricing(question: string | null | undefined, optionLabels: [string, string] = ['Keep Pro at £49', 'Raise Pro to £59']): Record<string, unknown> {
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 100000, unit: 'GBP', horizon_months: 12, provenance: 'explicit',
      baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [],
    options: [
      { label: optionLabels[0], provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      { label: optionLabels[1], provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
      { label: 'Pro subscribers', role: 'observable', baseline_known: false, baseline_value: 300, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
    ],
    risks: [], outcomes: [],
    links: [link('Pro plan price', 'Pro subscribers', 'negative'), link('Pro plan price', 'MRR', 'positive'), link('Pro subscribers', 'MRR', 'positive')],
    identities: [],
    unknowns: [],
    ...(question === undefined ? {} : { decision_question: question }),
  };
}

/** PJ-A2's mid-market brief (Paul export olumi-debug-73d5c152-20260919), its first two sentences and goal, verbatim. */
const MIDMARKET_BRIEF =
  "We're a 50-person B2B SaaS company doing £3M ARR. We need to decide how to expand our product into the mid-market " +
  'segment within 12 months.\nGoal: Reach 200 mid-market customers with a net revenue retention rate above 110%.';
const MIDMARKET_QUESTION = 'how to expand our product into the mid-market segment within 12 months';

/** The mid-market decision, in the strict wire shape. */
function midmarket(question: string | null): Record<string, unknown> {
  const options = ['Build a dedicated mid-market tier', 'Partner with system integrators', 'Acquire a smaller competitor'];
  return {
    goal: {
      metric: 'Mid-market customers', operator: '>=', target_stated: true, value: 200, unit: 'customers', horizon_months: 12,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [],
    options: options.map((label, i) => ({ label, provenance: 'explicit', is_status_quo: null, changes: [],
      interventions: [{ factor_label: 'Engineering capacity', value: 20 + i, value_kind: 'absolute', unit: 'engineers', provenance: 'explicit' }] })),
    factors: [{ label: 'Engineering capacity', role: 'controllable', baseline_known: true, baseline_value: 20, unit: 'engineers', provenance: 'explicit', plausible_max: 100 }],
    risks: [], outcomes: [],
    links: [link('Engineering capacity', 'Mid-market customers', 'positive')],
    identities: [],
    unknowns: [],
    decision_question: question,
  };
}

type Node = { id: string; kind: string; label: string; description?: string; provenance?: string };

/** The decision node the REAL build registers for this brief and wire candidate. */
async function registeredDecision(wire: Record<string, unknown>, brief = BRIEF): Promise<{ decision: Node; nodes: Node[] }> {
  let registered: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('31313131-3131-4131-8131-313131313131', brief, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  const nodes = (GraphV3.parse(registered) as unknown as { nodes: Node[] }).nodes;
  const decisions = nodes.filter((n) => n.kind === 'decision');
  expect(decisions, 'exactly one decision node').toHaveLength(1);
  return { decision: decisions[0]!, nodes };
}

/** The fallback, byte for byte as before: the metric framing, Olumi's inference, no description. */
function expectFallback(decision: Node): void {
  expect(decision.label).toBe(FALLBACK);
  expect(decision.id).toBe('decision_mrr');
  expect(decision.description).toBeUndefined();
  expect(decision.provenance).toBe('ai_inferred');
}

describe('the decision node carries the brief\'s own question', () => {
  it('RED: Paul\'s brief + the question copied verbatim -> the registered decision node IS that question', async () => {
    const { decision } = await registeredDecision(pricing(QUESTION));
    // The full question, first letter upper-cased and nothing else changed, is the node's text and identity.
    expect(decision.description).toBe(TITLE);
    // The label is that text under the estate's 33-character label budget.
    expect(decision.label).toBe(shortLabel(TITLE));
    expect(decision.label).toBe('Should we increase the Pro plan…');
    expect(decision.label).not.toBe(FALLBACK);
    // Provenance by the estate's rule (row 2.1205): a value-free decision whose words are the user's is from_brief.
    expect(decision.provenance).toBe('from_brief');
  });

  it('RED (PJ-A2 row 5): a verbatim span that is not a question sentence is taken the same way (the mid-market brief)', async () => {
    const { decision } = await registeredDecision(midmarket(MIDMARKET_QUESTION), MIDMARKET_BRIEF);
    expect(decision.description).toBe('How to expand our product into the mid-market segment within 12 months');
    expect(decision.provenance).toBe('from_brief');
  });

  it('CONTRAST (mid-market): the same words reworded are not in the brief -> "Decision: Mid-market customers"', async () => {
    const reworded = 'how to grow into the mid-market segment within 12 months';
    expect(MIDMARKET_BRIEF.includes(reworded)).toBe(false);
    const { decision } = await registeredDecision(midmarket(reworded), MIDMARKET_BRIEF);
    expect(decision.label).toBe('Decision: Mid-market customers');
    expect(decision.provenance).toBe('ai_inferred');
  });

  it('CONTRAST: a paraphrase that is not in the brief -> "Decision: MRR"', async () => {
    const paraphrase = 'Should we raise the Pro price to £59 when the next feature ships?';
    expect(BRIEF.includes(paraphrase)).toBe(false);
    expect(paraphrase.length).toBeGreaterThanOrEqual(8);
    expect(paraphrase.length).toBeLessThanOrEqual(240);
    expectFallback((await registeredDecision(pricing(paraphrase))).decision);
  });

  it('CONTRAST: null (the brief asks no question) -> "Decision: MRR"', async () => {
    expectFallback((await registeredDecision(pricing(null))).decision);
  });

  it('CONTRAST: a candidate from before the key (absent) -> "Decision: MRR"', async () => {
    expectFallback((await registeredDecision(pricing(undefined))).decision);
  });

  it('CONTRAST: a 300-character span that IS in the brief -> "Decision: MRR" (only the length bound refuses it)', async () => {
    expect(LONG_QUESTION).toHaveLength(300);
    expect(LONG_BRIEF.includes(LONG_QUESTION)).toBe(true);
    expectFallback((await registeredDecision(pricing(LONG_QUESTION), LONG_BRIEF)).decision);
  });

  it('CONTRAST: a span under 8 characters that IS in the brief -> "Decision: MRR"', async () => {
    expect(BRIEF.includes('Pro plan')).toBe(true);
    expectFallback((await registeredDecision(pricing('Pro'))).decision);
  });

  it('CONTRAST: extra internal whitespace in the copied span still matches, and is collapsed', async () => {
    const spaced = 'should we  increase the Pro plan price\nfrom £49 to £59   per month with the next Pro feature release?';
    expect(BRIEF.includes(spaced)).toBe(false);
    const { decision } = await registeredDecision(pricing(spaced));
    expect(decision.description).toBe(TITLE);
    expect(decision.label).toBe(shortLabel(TITLE));
    expect(decision.provenance).toBe('from_brief');
  });

  it('CONTRAST: extra whitespace in the BRIEF still matches a single-spaced copy', async () => {
    const { decision } = await registeredDecision(pricing(QUESTION), BRIEF.replace('the Pro plan price', 'the  Pro plan\n price'));
    expect(decision.description).toBe(TITLE);
  });

  it('CONTRAST: verbatim means verbatim — a copy whose case differs from the brief\'s -> "Decision: MRR"', async () => {
    expectFallback((await registeredDecision(pricing(QUESTION.replace('Pro plan', 'pro plan')))).decision);
  });

  it('PROVENANCE follows the estate\'s ≥2-word floor: a one-word question in the brief is kept as the label, but Olumi\'s', async () => {
    const brief = `${BRIEF} Expansion?`;
    const { decision } = await registeredDecision(pricing('Expansion?'), brief);
    expect(decision.label).toBe('Expansion?');
    expect(decision.provenance).toBe('ai_inferred');
  });

  it('SAFETY: a question spelled like another node never merges into it -> "Decision: MRR", both nodes kept', async () => {
    const { decision, nodes } = await registeredDecision(pricing(QUESTION, ['Keep Pro at £49', TITLE]));
    expectFallback(decision);
    expect(nodes.filter((n) => n.kind === 'option').map((n) => n.description ?? n.label)).toContain(TITLE);
  });
});

describe('the strict contract carries decision_question', () => {
  const schema = buildCandidateSchema() as { required: string[]; properties: Record<string, { anyOf?: { type: string }[]; description?: string }> };

  it('is REQUIRED with null allowed (strict output must say "no question" rather than omit it)', () => {
    expect(schema.required).toContain('decision_question');
    expect(schema.properties.decision_question?.anyOf?.map((s) => s.type).sort()).toEqual(['null', 'string']);
    expect(schema.properties.decision_question?.description).toMatch(/VERBATIM/);
  });

  it('every wire candidate in this file passes the REAL strict schema (string and null)', () => {
    const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
    for (const q of [QUESTION, null]) expect(strict(pricing(q)), JSON.stringify(strict.errors)).toBe(true);
    expect(strict(pricing(undefined)), 'an absent key is refused by the strict schema').toBe(false);
  });

  it('the compaction retry PINS the first draft\'s question (a compaction may not re-choose it)', () => {
    const goal = pricing(QUESTION).goal as CandidateModel['goal'];
    const pinned = retrySchemaPinningGoal(goal, QUESTION) as { required: string[]; properties: Record<string, unknown> };
    expect(pinned.required).toContain('decision_question');
    expect(pinned.properties.decision_question).toEqual({ type: 'string', enum: [QUESTION] });
    const none = retrySchemaPinningGoal(goal, null) as { properties: Record<string, unknown> };
    expect(none.properties.decision_question).toEqual({ type: 'null' });
    const older = retrySchemaPinningGoal(goal) as { properties: Record<string, unknown> };
    expect(older.properties.decision_question).toEqual({ type: 'null' });
  });
});

/**
 * ⭐ THE PROVENANCE IS THE ESTATE'S RULE, NOT A NEW ONE — proved on the estate's own authority.
 * `transformResponseToV3` badges a value-free node of a LABEL_BOUND kind whose label is the user's words
 * (`node-provenance-kind-coverage.replay.test.ts`, row 2.1205). This pins that the rule reaches kind `decision`
 * (positive) and that the metric framing is not the user's words (contrast), so the admission stamp mirrors it.
 */
describe('row 2.1205 reaches the decision kind', () => {
  const replay = (label: string): V1DraftGraphResponse => ({
    graph: {
      nodes: [
        { id: 'dec', kind: 'decision', label },
        { id: 'opt_a', kind: 'option', label: 'Keep Pro at £49' },
        { id: 'opt_b', kind: 'option', label: 'Raise Pro to £59' },
        { id: 'fac', kind: 'factor', label: 'Pro plan price', category: 'controllable' },
        { id: 'goal', kind: 'goal', label: 'MRR' },
      ],
      edges: [
        { from: 'dec', to: 'opt_a', weight: 1, belief: 1 },
        { from: 'dec', to: 'opt_b', weight: 1, belief: 1 },
        { from: 'opt_a', to: 'fac', weight: 1, belief: 1 },
        { from: 'opt_b', to: 'fac', weight: 1, belief: 1 },
        { from: 'fac', to: 'goal', weight: 0.8, belief: 0.9 },
      ],
      meta: { roots: ['dec'], leaves: ['goal'], source: 'assistant' },
    },
    quality: { overall: 8, structure: 8, coverage: 8, structural_proxy: 8 },
    trace: { request_id: 'replay-decision-question', correlation_id: 'replay' },
  } as unknown as V1DraftGraphResponse);
  const decisionProvenance = (label: string): unknown =>
    (transformResponseToV3(replay(label), { brief: BRIEF }).nodes as unknown as { kind: string; provenance?: unknown }[])
      .find((n) => n.kind === 'decision')?.provenance;

  it('a decision labelled with the brief\'s own question is from_brief', () => {
    expect(decisionProvenance(TITLE)).toBe('from_brief');
  });

  it('CONTRAST: the metric framing is not the user\'s words, and stays ai_inferred', () => {
    expect(decisionProvenance(FALLBACK)).toBe('ai_inferred');
  });
});
