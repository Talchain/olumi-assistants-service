/**
 * ⭐⭐⭐ THE NUMBERS A USER IS ABOUT TO APPROVE MUST BE ON THE TURN THAT OFFERS
 * THE CHIP.
 *
 * THE DEFECT, derived at the bytes on `lane/readiness-value-batch-2026-09-04`
 * head `07c6eec8`: the readiness turn offered `Apply all N estimates`, which
 * writes N model-authored values into the user's model in one click, and the
 * user saw NONE of them first.
 *
 *   - `route-v2.ts` read `valueBatchOffer.kind` and `.offer`. `.proposal` was
 *     read by nothing on the way out.
 *   - the readiness response was composed 63 lines BEFORE the estimator ran.
 *   - the chip carried no `detail`; `inline_patch.params` was `{}`.
 *   - `OlumiResponseSchema` is `.strict()` and declares no pending /
 *     inline_patch key, so NO CLIENT COULD HAVE RENDERED the proposal however
 *     it was written.
 *
 * And three separate sites told the user they HAD reviewed them: the module's
 * own safety comment, the apply receipt ("an AI estimate you reviewed") and the
 * estimator's system prompt.
 *
 * ⭐ THIS SUITE IS AT THE ROUTE ON PURPOSE. Every module below the seam is
 * already green — the defect lived entirely in what the WIRE BODY carried. So
 * every assertion here reads `res.body`: the bytes a browser receives.
 *
 * ⭐ AND IT BINDS BY IDENTITY (trap 19). Each expected line is built from ONE
 * NAMED CELL's `option_id`/`factor_id`, and each cell is given a DISTINCT
 * estimate, so "a line somewhere containing 21%" cannot satisfy an assertion
 * about the cell that was estimated 21%. The discrimination case below proves
 * it: every other cell's number is asserted ABSENT from the named cell's line.
 *
 * ⚠ The expected strings are written BY HAND here, never by calling the
 * renderer the route calls. A test that formats its expectation with the
 * production formatter agrees with itself about the format (trap 13b).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

type Dict = Record<string, unknown>;

// ---------------------------------------------------------------------------
// The fixture: a DATED CAPTURE with every option effect value cleared, which is
// the witnessed arm (ten open cells, ten round-trips). A hand-written graph
// would encode my model of the readiness producer rather than the producer.
// ---------------------------------------------------------------------------

const CAPTURE = JSON.parse(
  readFileSync(
    new URL(
      '../../../src/orchestrator-v5/__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { draft_graph: { nodes: Dict[]; edges: Dict[] } };

function zeroConfiguredGraph(): { nodes: Dict[]; edges: Dict[] } {
  const graph = structuredClone(CAPTURE.draft_graph);
  for (const node of graph.nodes) if (node.kind === 'option') node.interventions = {};
  return graph;
}

const BATCH_GRAPH = zeroConfiguredGraph();

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const dispatchDraftGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

const persistedGraphHolder: { graph: unknown } = { graph: null };
const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore } = await import('../../utils/mock-session-store.js');
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        append: appendMock,
        loadGraphAndBriefText: async () => ({
          graph: persistedGraphHolder.graph,
          briefText: null,
        }),
      }),
    resetSessionStoreForTests: () => {},
  };
});

/**
 * ⭐ THE ESTIMATE SET IS DERIVED FROM THE PRODUCER, NOT HAND-LISTED.
 *
 * The membership comes from `selectValueBatchMembership` — the same derivation
 * the route uses — so this fixture cannot silently answer a cell set the
 * product does not actually have (trap 16-inverse: a fixture you wrote yourself
 * is not evidence about the wire).
 *
 * Every cell gets a DISTINCT value, and cell 0 DECLINES with a reason, so the
 * suite exercises both populations the module separates and the identity
 * assertions below have something to discriminate against.
 */
const DECLINE_REASON = 'The brief says nothing about this pairing.';
function estimateValueFor(index: number): number {
  // Distinct, inside [0, 1], and NOT round — so a formatter that silently
  // rounded would change the rendered string and RED the assertion.
  return Number(((index + 1) * 0.07).toFixed(4));
}

vi.mock('../../../src/adapters/llm/anthropic.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/adapters/llm/anthropic.js')>();
  return {
    ...original,
    chatWithAnthropic: async () => {
      const { assessCanonicalAnalysisReadiness } = await import(
        '../../../src/orchestrator/tools/analysis-ready-helper.js'
      );
      const { selectValueBatchMembership } = await import(
        '../../../src/orchestrator-v5/handlers/readiness-value-batch.js'
      );
      const cells = selectValueBatchMembership(
        assessCanonicalAnalysisReadiness(BATCH_GRAPH),
      ).cells;
      return {
        content: JSON.stringify({
          estimates: cells.map((cell, index) =>
            index === 0
              ? {
                  option_id: cell.option_id,
                  factor_id: cell.factor_id,
                  value: null,
                  declined_reason: DECLINE_REASON,
                }
              : {
                  option_id: cell.option_id,
                  factor_id: cell.factor_id,
                  value: estimateValueFor(index),
                  reasoning: `Basis for ${cell.option_id} on ${cell.factor_id}.`,
                  confidence: 'medium' as const,
                },
          ),
        }),
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
  };
});

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'short reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'text-only fallthrough response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'short reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'text-only fallthrough response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
    resolution: {
      task: 'narrate',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');
const { assessCanonicalAnalysisReadiness } = await import(
  '../../../src/orchestrator/tools/analysis-ready-helper.js'
);
const { selectValueBatchMembership, READINESS_VALUE_BATCH_HANDLER_ID } = await import(
  '../../../src/orchestrator-v5/handlers/readiness-value-batch.js'
);

const CELLS = selectValueBatchMembership(assessCanonicalAnalysisReadiness(BATCH_GRAPH)).cells;

// PRECONDITIONS PINNED IN-TEST (trap 13b): without these, every assertion below
// could pass vacuously against a fixture that produced no batch at all.
if (CELLS.length < 3) {
  throw new Error(`fixture must carry at least three settable cells, got ${CELLS.length}`);
}
for (const cell of CELLS) {
  if (!cell.option_label || !cell.factor_label) {
    throw new Error(`fixture cell ${cell.option_id}/${cell.factor_id} must carry both labels`);
  }
}

/** The line the user must be able to read, written BY HAND, per named cell. */
function expectedLineFor(index: number): string {
  const cell = CELLS[index]!;
  const percent = Number((estimateValueFor(index) * 100).toPrecision(12));
  return `"${cell.option_label}" on "${cell.factor_label}": ${percent}% of the top.`;
}

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';
let turnCounter = 0;
function nextTurnId(): string {
  turnCounter += 1;
  return `88888888-8888-4888-8888-${String(turnCounter).padStart(12, '0')}`;
}

describe('POST /orchestrate/v2/turn — the value batch shows its numbers before it asks for approval', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    dispatchDraftGraphMock.mockReset();
    appendMock.mockClear();
    persistedGraphHolder.graph = BATCH_GRAPH;
  });

  async function readinessTurn() {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: nextTurnId(),
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'am i ready to run this?',
        turn_class: 'frame',
        source: 'chip_click',
        chip: { action_type: 'analysis_readiness' },
      },
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as {
      assistant_text: string;
      blocks: Dict[];
      suggested_actions: Array<{ id?: string; label?: string; message?: string }>;
    };
  }

  /**
   * ⭐ THE PRECONDITION THAT MAKES EVERY OTHER ASSERTION MEAN SOMETHING.
   *
   * If this turn does not offer the one-click apply, then "the values are not
   * visible" is not a defect — there is nothing to approve. Pinned first and by
   * name so a fixture drift that silences the batch REDs here rather than
   * turning the visibility cases into tautologies.
   */
  it('PRECONDITION: this turn offers the one-click apply control', async () => {
    const body = await readinessTurn();
    const apply = body.suggested_actions.find((a) => /^Apply (the estimate|all \d+ estimates)$/.test(a.label ?? ''));
    expect(apply, `expected a value-batch apply chip, got ${JSON.stringify(body.suggested_actions)}`)
      .toBeDefined();
  });

  it('⭐ EVERY proposed value reaches the user, bound to ITS OWN option and factor', async () => {
    const body = await readinessTurn();
    // index 0 declines; every other cell is a written value the chip would apply.
    for (let index = 1; index < CELLS.length; index += 1) {
      expect(
        body.assistant_text,
        `cell ${CELLS[index]!.option_id}/${CELLS[index]!.factor_id} must be shown before approval`,
      ).toContain(expectedLineFor(index));
    }
  });

  it('⭐ the DISCRIMINATION: a cell carries its OWN number, not another cell\'s', async () => {
    const body = await readinessTurn();
    // The line for cell 1, isolated from the rest of the message.
    const line = body.assistant_text
      .split('\n')
      .find((candidate) => candidate.startsWith(`"${CELLS[1]!.option_label}" on "${CELLS[1]!.factor_label}":`));
    expect(line, 'cell 1 must have its own line').toBeDefined();
    expect(line!).toContain(`${Number((estimateValueFor(1) * 100).toPrecision(12))}% of the top.`);
    // ...and carries NO other cell's number. A value predicate ("some line says
    // 21%") is satisfiable by the wrong object; this is what rules that out.
    for (let other = 2; other < CELLS.length; other += 1) {
      const otherPercent = Number((estimateValueFor(other) * 100).toPrecision(12));
      expect(
        line!,
        `cell 1's line must not carry cell ${other}'s number`,
      ).not.toContain(`${otherPercent}% of the top.`);
    }
  });

  it('the DECLINED cell is named with the reason the producer gave, never silently dropped', async () => {
    const body = await readinessTurn();
    const declined = CELLS[0]!;
    expect(body.assistant_text).toContain(
      `"${declined.option_label}" on "${declined.factor_label}": not estimated. Why not: ${DECLINE_REASON}`,
    );
  });

  it('the copy says the numbers are the PRODUCT\'S, not the user\'s', async () => {
    const body = await readinessTurn();
    expect(body.assistant_text).toContain('I chose them, you did not');
    expect(body.assistant_text).toContain('Nothing is written until you approve');
  });

  /**
   * The typed, machine-readable mark. Verified to reach the UI at the bytes
   * against `Talchain/DecisionGuideAI` `staging` c4c6f508: `coaching` is in
   * `PHASE3_TOLERATED_BLOCK_TYPES` (`responseParser.ts:161`) → lifted at `:460`
   * → sidecar at `:842` → `extractPhase3FromV5Response.ts:613` →
   * `useConversation.ts:5158` → `adaptTypedCoachingBlock` → `InlineBlocks.tsx:805`
   * → `V5CoachingBlock.tsx:353` renders `body`, `:422` renders `target_refs`.
   */
  it('⭐ a typed COACHING block marks the estimates machine-authored and binds every entity by ID', async () => {
    const body = await readinessTurn();
    const block = body.blocks.find(
      (b) => b.type === 'coaching' && b.source_handler === READINESS_VALUE_BATCH_HANDLER_ID,
    ) as (Dict & { target_refs: Array<{ id: string; kind: string }> }) | undefined;
    expect(block, `expected a value-batch coaching block, got ${JSON.stringify(body.blocks.map((b) => b.type))}`)
      .toBeDefined();
    expect(block!.body).toContain('Every number here is mine, not yours');
    expect(block!.body).toContain('Nothing is written to your model until you approve');

    // IDENTITY, from the structured field the egress scrub leaves untouched.
    const refIds = new Set(block!.target_refs.map((r) => r.id));
    for (const cell of CELLS) {
      expect(refIds, `option ${cell.option_id} must be named by id`).toContain(cell.option_id);
      expect(refIds, `factor ${cell.factor_id} must be named by id`).toContain(cell.factor_id);
    }
    for (const ref of block!.target_refs) {
      expect(['option', 'factor']).toContain(ref.kind);
    }
  });

  /**
   * ⭐ THE GUARD THAT WOULD DELETE THIS CARD, RUN AGAINST THE CARD.
   *
   * `scanProse` in `compose/phase3-blocks.ts` DROPS a Phase-3 block whose prose
   * carries a leading-decimal probability. A correction worth inheriting: the
   * obvious claim "a 0-1 value rendered as a percentage can never trip it" is
   * FALSE — fuzzed over 300,000 values in [0, 1] with this same regex, 2,958
   * hit, every one a value under 0.01 rendering `0.001%`. So the safety here is
   * NOT that the formatter is safe; it is that the block body carries no value
   * at all, only integer counts. This pins that, and REDs the day a value is
   * moved into the body.
   *
   * The regex is IMPORTED, never restated — a copy would drift from the guard
   * it claims to reproduce (trap 12).
   */
  it('⭐ the coaching body carries NO raw decimal — the guard that would drop it, run against it', async () => {
    const { RAW_DECIMAL_RE } = await import(
      '../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js'
    );
    // POSITIVE CONTROL FIRST: an absence assertion whose instrument is blind
    // passes by testing nothing (trap 13).
    expect(RAW_DECIMAL_RE.test('the value is 0.4 of the top')).toBe(true);

    const body = await readinessTurn();
    const block = body.blocks.find(
      (b) => b.type === 'coaching' && b.source_handler === READINESS_VALUE_BATCH_HANDLER_ID,
    ) as (Dict & { body: string; title: string }) | undefined;
    expect(block, 'precondition: the block must exist for this absence to mean anything').toBeDefined();
    expect(RAW_DECIMAL_RE.test(block!.body)).toBe(false);
    expect(RAW_DECIMAL_RE.test(block!.title)).toBe(false);
  });
});
