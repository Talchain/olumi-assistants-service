/**
 * THE GOAL TARGET THE USER STATED MUST SURVIVE THE DRAFT — on the ANTHROPIC
 * path, where CEE mints it — WHILE a MODEL-AUTHORED one is still refused on the
 * OPENAI path, where CEE does not.
 *
 * ── THE USER HARM ──────────────────────────────────────────────────────────
 * A founder's goal node reads "Reach £30k MRR Within 18 Months" and the canvas
 * beneath it says "No target set". The product extracted the target correctly
 * and then deleted it.
 *
 * ── WHY, AND WHY IT IS CALL-SITE-SCOPED ────────────────────────────────────
 * `stripModelAuthoredGoalThreshold` deletes `CEE_MINTED_GOAL_FIELDS` from every
 * node by KEY PRESENCE ALONE — no provenance, no origin, no node-id set. Its
 * stated premise is that "at this seam no legitimate, attested threshold can
 * exist yet: anything present was written by the model" (normalisation.ts).
 *
 * That premise is TRUE on `openai.ts`, whose `rawJson` is the model's own JSON.
 * It is FALSE on `anthropic.ts`, which since the records cutover runs
 *
 *     projectDraftRecords(rawJson, brief)      ← CEE mints the target here
 *   → rawJson = { ...activeProjection.graph }
 *   → stripModelAuthoredGoalThreshold(rawJson) ← …and deletes it here
 *
 * so the strip's input on that path is EXCLUSIVELY projector output. A
 * model-authored threshold cannot even reach it: a graph-shaped response is
 * REFUSED by the seam (`seam.ok === false` throws), and a record-shaped one is
 * rebuilt field-by-field in `records/seam.ts` from a grammar that declares no
 * `goal_*` field at all. So on the Anthropic draft path the strip removed 100%
 * CEE-minted values and 0% model-authored ones.
 *
 * ── WHAT THIS FILE PINS: A DISCRIMINATING PAIR ─────────────────────────────
 * Neither arm alone shows the binding is right. Arm (a) alone would also pass if
 * the strip were deleted outright; arm (b) is what proves it was not.
 *
 *   (a) ANTHROPIC — a CEE-minted goal target SURVIVES the draft.
 *   (b) OPENAI    — a MODEL-authored goal threshold is STILL STRIPPED.
 *
 * Both drive the REAL adapter entry point with the SDK mocked, so what is
 * asserted is the graph a caller receives — not a helper called in isolation
 * (trap 16: a unit probe proves the function, never the wire).
 */
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  anthropicBodies: [] as Array<Record<string, unknown>>,
  anthropicPayload: { text: '' },
  openaiPayload: { text: '' },
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: (body: Record<string, unknown>) => {
        h.anthropicBodies.push(body);
        const payload = h.anthropicPayload.text;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: payload } };
          },
          async finalMessage() {
            return {
              content: [{ type: 'text', text: payload }],
              usage: { input_tokens: 100, output_tokens: 50 },
              stop_reason: 'end_turn',
            };
          },
        };
      },
    };
  }
  return { default: MockAnthropic };
});

vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: async () => ({
          choices: [{ message: { content: h.openaiPayload.text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          model: 'gpt-4o-mini',
        }),
      },
    };
  }
  return { default: MockOpenAI };
});

/**
 * THE BRIEF AND THE RECORD SET THE HARM WAS REPORTED ON — the stated target is
 * £30,000, quoted in the goal's own words, so the projector's `role: 'target'`
 * branch mints from a number the USER supplied and nothing is inferred.
 *
 * The label carries digits deliberately: Stage 4b's `threshold-sweep` deletes an
 * UNATTESTED threshold whose raw value is round AND whose label has no digits,
 * and this file's claim is about the ADAPTER seam only. See the non-coverage
 * note on the digit-free class in the PR body.
 */
const GOAL_QUOTE = 'Reach £30k MRR Within 18 Months';
const BRIEF = 'We need to reach £30k MRR within 18 months. Option: hire two AEs. Option: launch self-serve.';

const RECORD_SET_WITH_STATED_TARGET = JSON.stringify({
  stated_items: [
    { kind: 'goal', source_quote: GOAL_QUOTE, value: 30000, unit: '£', role: 'target' },
    { kind: 'option', source_quote: 'hire two AEs' },
    { kind: 'option', source_quote: 'launch self-serve' },
  ],
  claims: [
    { claim_kind: 'factor', label: 'Sales capacity', basis: [0], category: 'controllable' },
    { claim_kind: 'causal_link', label: 'more AEs lift capacity', basis: [0], from_stated: 1, to_claim: 0, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'capacity drives MRR', basis: [0], from_claim: 0, to_stated: 0, effect: 'positive' },
  ],
});

/**
 * A GRAPH-shaped draft carrying a threshold the MODEL wrote — the 2026-08-01
 * live defect (ROADMAP 2.281). This is the shape the OpenAI adapter receives,
 * because that path sends no records grammar and has no projection seam.
 */
const OPENAI_GRAPH_WITH_MODEL_AUTHORED_THRESHOLD = JSON.stringify({
  nodes: [
    { id: 'dec_growth', kind: 'decision', label: 'How should we grow revenue?' },
    { id: 'opt_aes', kind: 'option', label: 'Hire two AEs' },
    { id: 'opt_selfserve', kind: 'option', label: 'Launch self-serve' },
    { id: 'fac_capacity', kind: 'factor', label: 'Sales capacity', data: { value: 0.5 } },
    {
      id: 'goal_revenue',
      kind: 'goal',
      label: 'Reach £30k MRR Within 18 Months',
      // Every field the model must not author.
      goal_threshold: 0.8,
      goal_threshold_raw: 30000,
      goal_threshold_unit: '£',
      goal_threshold_cap: 37500,
      goal_threshold_frame: 'level',
      goal_baseline: 0.21,
      goal_baseline_raw: 8000,
    },
  ],
  edges: [
    { from: 'dec_growth', to: 'opt_aes', strength: { mean: 0.5, std: 0.1 } },
    { from: 'dec_growth', to: 'opt_selfserve', strength: { mean: 0.5, std: 0.1 } },
    { from: 'opt_aes', to: 'fac_capacity', strength: { mean: 0.6, std: 0.1 } },
    { from: 'fac_capacity', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 } },
  ],
});

const CEE_MINTED = [
  'goal_threshold',
  'goal_threshold_raw',
  'goal_threshold_unit',
  'goal_threshold_cap',
  'goal_threshold_frame',
  'goal_baseline',
  'goal_baseline_raw',
] as const;

type AnyNode = Record<string, any>;

let draftGraphWithAnthropic: typeof import('../anthropic.js').draftGraphWithAnthropic;
let OpenAIAdapter: typeof import('../openai.js').OpenAIAdapter;
const prior: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CEE_ANTHROPIC_STRUCTURED_OUTPUTS']) {
    prior[k] = process.env[k];
  }
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-goal-target';
  process.env.OPENAI_API_KEY = 'sk-test-goal-target';
  process.env.CEE_ANTHROPIC_STRUCTURED_OUTPUTS = 'true';
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
  ({ draftGraphWithAnthropic } = await import('../anthropic.js'));
  ({ OpenAIAdapter } = await import('../openai.js'));
});

afterAll(async () => {
  for (const [k, v] of Object.entries(prior)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
});

afterEach(() => {
  h.anthropicBodies = [];
});

async function anthropicDraft(responseText: string) {
  h.anthropicPayload.text = responseText;
  const graph = await draftGraphWithAnthropic(
    { brief: BRIEF, docs: [], seed: 1, model: 'claude-sonnet-4-6' },
    { timeoutMs: 120_000, forceDefault: true },
  );
  expect(h.anthropicBodies.length, 'no Anthropic request body captured — the mock never ran').toBeGreaterThanOrEqual(1);
  return (graph as { graph: { nodes: AnyNode[]; edges: unknown[] } }).graph;
}

async function openaiDraft(responseText: string) {
  h.openaiPayload.text = responseText;
  const result = await new OpenAIAdapter('gpt-4o-mini').draftGraph(
    { brief: BRIEF, docs: [], seed: 1 },
    { timeoutMs: 120_000, forceDefault: true },
  );
  return (result as { graph: { nodes: AnyNode[]; edges: unknown[] } }).graph;
}

const goalOf = (graph: { nodes: AnyNode[] }) => graph.nodes.find((n) => n.kind === 'goal');

// ─────────────────────────────────────────────────────────────────────────
// (a) ANTHROPIC — the CEE-minted target survives
// ─────────────────────────────────────────────────────────────────────────

describe('(a) anthropic draft: the projector-minted goal target reaches the caller', () => {
  it('carries the stated £30,000 target — raw, unit, cap, normalised and frame, together', async () => {
    const graph = await anthropicDraft(RECORD_SET_WITH_STATED_TARGET);
    const goal = goalOf(graph);

    // Bound by IDENTITY, not by a value predicate another node could satisfy
    // (trap 19): this is the goal node carrying the user's own words.
    expect(goal, 'the projection produced no goal node').toBeTruthy();
    expect(goal!.label).toContain('30k MRR');

    // ⭐ THE ASSERTION THE USER FEELS. `GoalNode.tsx` gates its "No target set"
    // line on `goal_threshold_raw`, so this field's presence IS the fix.
    expect(
      goal!.goal_threshold_raw,
      'the stated target was extracted and then deleted before the caller saw it',
    ).toBe(30000);

    // The five travel together or not at all — the projector mints them from ONE
    // derivation, and a threshold scored against a different denominator than
    // its baseline returns a confident WRONG probability downstream.
    expect(goal!.goal_threshold_unit).toBe('£');
    expect(goal!.goal_threshold_cap).toBe(37500);
    expect(goal!.goal_threshold).toBeCloseTo(30000 / 37500, 10);
    expect(goal!.goal_threshold_frame).toBe('level');
  });

  it('PRECONDITION PINNED IN-TEST: the projector really is what minted it', async () => {
    // Without this, arm (a) could pass because a *model* wrote the threshold and
    // the strip stopped running — a green test about the wrong mechanism
    // (trap 13b: a guard whose discrimination depends on an unpinned fixture).
    // The record set below carries NO `value`/`role` on the goal, so the
    // projector has nothing to mint FROM; the same draft must then yield a goal
    // with no threshold at all.
    const graph = await anthropicDraft(JSON.stringify({
      stated_items: [
        { kind: 'goal', source_quote: 'Grow the business' },
        { kind: 'option', source_quote: 'hire two AEs' },
        { kind: 'option', source_quote: 'launch self-serve' },
      ],
      claims: [
        { claim_kind: 'factor', label: 'Sales capacity', basis: [0], category: 'controllable' },
        { claim_kind: 'causal_link', label: 'more AEs lift capacity', basis: [0], from_stated: 1, to_claim: 0, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'capacity drives the goal', basis: [0], from_claim: 0, to_stated: 0, effect: 'positive' },
      ],
    }));
    const goal = goalOf(graph);
    expect(goal, 'the projection produced no goal node').toBeTruthy();
    expect(goal!.goal_threshold_raw).toBeUndefined();
    expect(goal!.goal_threshold).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (b) OPENAI — a model-authored threshold is still refused
// ─────────────────────────────────────────────────────────────────────────

describe('(b) openai draft: a MODEL-authored goal threshold is still stripped', () => {
  it('removes every CEE-minted goal field the model wrote', async () => {
    const graph = await openaiDraft(OPENAI_GRAPH_WITH_MODEL_AUTHORED_THRESHOLD);
    const goal = goalOf(graph);

    expect(goal, 'the OpenAI draft produced no goal node').toBeTruthy();
    expect(goal!.label).toContain('30k MRR');
    for (const field of CEE_MINTED) {
      expect(goal, `${field} was model-authored and must not survive the OpenAI draft ingress`)
        .not.toHaveProperty(field);
    }
  });

  it('touches nothing else on the same graph', async () => {
    // The strip is scoped to the goal contract. If arm (b) ever goes green
    // because the whole draft collapsed, this REDs.
    const graph = await openaiDraft(OPENAI_GRAPH_WITH_MODEL_AUTHORED_THRESHOLD);
    expect(graph.nodes.find((n) => n.id === 'dec_growth')).toBeTruthy();
    expect(graph.nodes.find((n) => n.id === 'fac_capacity')?.data?.value).toBe(0.5);
    expect(graph.nodes.filter((n) => n.kind === 'option').length).toBe(2);
  });
});
