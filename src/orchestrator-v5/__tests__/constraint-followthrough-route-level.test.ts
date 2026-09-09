/**
 * THE JOIN BETWEEN THE TWO STEPS A DROPPED LIMIT TAKES — and the boundary the
 * card's own copy walks up to.
 *
 * ⚠⚠ WHAT THIS FILE IS FOR, AND WHAT IT DELIBERATELY DOES NOT RE-TEST.
 * `baseline-elicitation-route-level.test.ts` already pins EMIT ("an
 * add_constraint turn on the mintable-and-baseline-less cell persists the
 * pending question in the same commit as its receipt") and RESUME. Neither of
 * those is repeated here. **The uncovered thing is the JOIN**: that the card
 * produced when a stated limit cannot be bound points at `add_constraint`, and
 * that the cell a user names in answering it is one that arms the baseline ask.
 *
 * THE SEQUENCE THIS PINS, derived at the bytes on 2026-09-09:
 *   1. A limit the user stated in the brief cannot be matched to a node, so
 *      `remapConstraintTargets` STEP 6 drops it — it reaches neither
 *      `goal_constraints[]` nor the analysis — and keeps it in `unbindable`.
 *   2. `renderDirectionClarifications` turns that row into a card whose
 *      `action_type` is **`add_constraint`**: "add it as a constraint on the
 *      right factor to make it binding."
 *   3. The user's answer arrives and dispatches `add_constraint` on a named
 *      node. If that cell is mintable and carries no baseline, the handler's
 *      `__elicit_baseline` channel arms the pending question "Roughly what
 *      percentage is X at right now?" in the same commit as the receipt.
 *
 * ⚠ STEP 3's ANSWER IS NOT A CHIP, AND THAT IS THE WEAK LINK THIS FILE
 * EXERCISES ON PURPOSE. `direction-gate.ts` records that the V5 turn ships no
 * structured `strengthen_items`, so the card reaches the user as PROSE — the
 * answer therefore arrives as an ORDINARY LLM-ROUTED `add_constraint`, not a
 * deterministic typed-chip replay. The EMIT pin above drives the chip route for
 * determinism; driving the adapter route here is the point, not an oversight.
 *
 * ⭐ THE PRECONDITION IS PINNED IN-TEST (trap 13b: a control whose
 * discrimination rests on an unpinned fixture stops discriminating silently).
 * Every case asserts that the constraint GENUINELY COMMITTED on the named
 * target before it asserts anything about the question — so a green result is
 * provably the sequence working and never a fixture that failed to reach the
 * branch at all.
 *
 * ⭐⭐ AND THE DISCRIMINATING TWIN IS THE VALUE OF THIS FILE, not an extra.
 * `mintEligible` (`tools/handlers/add-constraint.ts:770-780`) admits
 * `kind: 'outcome' | 'risk'` and EXCLUDES `factor`, on a measured ground the
 * handler states: "factors get a PLoT ParameterUncertainty
 * (translator-v3.ts:674) and ISL then refuses the conversion — a baseline
 * there is inert (2.877 measured arm H)". So the sequence completes on a risk
 * and STOPS on a factor — while the card's own copy says "add it as a
 * constraint on the right **factor**". The pair binds by node KIND (an
 * identity), never by a value predicate another row could satisfy (trap 19),
 * and the two cases assert on DIFFERENT properties so neither can pass by
 * agreeing with the other.
 *
 * ⚠ THIS FILE MAKES NO CLAIM THAT THE FACTOR ARM IS A DEFECT. The exclusion is
 * documented and measured. What is recorded here is only that the two-step
 * sequence completes for one kind and not the other, so a later reader cannot
 * re-derive "the follow-up always arms" from the risk case alone.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import type { PendingAction } from '../session/pending-action.js';
import {
  extractCompoundGoals,
  remapConstraintTargets,
  type ExtractedGoalConstraint,
} from '../../cee/compound-goal/index.js';
import {
  renderDirectionClarifications,
  targetUnmatchedItem,
} from '../../cee/compound-goal/direction-gate.js';

const appendCalls: Array<Record<string, unknown>> = [];
let mockedPendingActions: ReadonlyArray<PendingAction> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => mockedPendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** The user's own sentence, in the shape the regex extractor reads. */
const BRIEF_LIMIT_SENTENCE = 'We need to keep monthly churn under 4%.';

/**
 * A graph carrying NO node the phrase "monthly churn" can bind to — the state
 * that sends the row off `remapConstraintTargets` step 6. The labels are
 * deliberately unrelated rather than near-misses: this file pins what happens
 * AFTER the drop, and a fixture that bound would skip the whole sequence.
 */
const UNBINDABLE_NODE_IDS = ['g-revenue', 'f-quality', 'o-response-time'];
const UNBINDABLE_NODE_LABELS = new Map<string, string>([
  ['g-revenue', 'Revenue'],
  ['f-quality', 'Product quality'],
  ['o-response-time', 'First response time'],
]);

/**
 * The answer-turn graph. `r-churn` satisfies every `mintEligible` conjunct
 * EXCEPT the stated level: non-goal kind, no `goal_threshold_cap`, an inbound
 * edge, and no `observed_state.baseline`. `f-churn-factor` is byte-identical
 * apart from `kind`, which is the whole discrimination.
 */
function answerTurnGraph(churnKind: 'risk' | 'factor'): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      { id: 'f-quality', kind: 'factor', label: 'Product quality' },
      { id: 'n-churn', kind: churnKind, label: 'Monthly churn' },
    ],
    edges: [
      {
        from: 'f-quality',
        to: 'n-churn',
        strength: { mean: -0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      },
    ],
    goal_constraints: [],
  } as unknown as GraphV3T;
}

/**
 * The ORDINARY route the prose answer actually takes: the router's own
 * `add_constraint` tool call naming the node the user picked.
 */
function addConstraintToolCallAdapter() {
  const chatWithTools = vi
    .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
    .mockImplementation(async () => ({
      content: [
        {
          type: 'tool_use',
          id: 'tu-followthrough',
          name: OLUMI_ACTION_TOOL_NAME,
          input: {
            intent_class: 'execute',
            action: {
              handler_id: 'add_constraint',
              entity: {
                id: 'n-churn',
                kind: 'node',
                resolution_status: 'resolved',
                resolution_method: 'id_match',
              },
              parameters: [
                { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
                { name: 'value', value: 4, source: 'user_explicit' },
                { name: 'unit', value: '%', source: 'user_explicit' },
              ],
              cited_context_fields: ['graph.nodes'],
            },
          } as Record<string, unknown>,
        },
      ] as unknown as ChatWithToolsResult['content'],
      stop_reason: 'tool_use' as const,
      usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
      model: 'mock',
      latencyMs: 0,
    }));
  return { adapter: { chatWithTools }, chatWithTools };
}

/**
 * The user's answer to the card, in the form the card itself asks for.
 *
 * ⚠⚠ THE NUMBER IS LOAD-BEARING AND MUST NOT BE "SIMPLIFIED" OUT. `mintEligible`
 * requires `effectiveRowFrame === 'level'`, and for a first registration there
 * is no existing row to inherit a frame from — so the frame can only come from
 * `deriveStatedConstraintFrame` reading THIS message, which answers only when
 * the number it parses IS the number about to be persisted. A bare "apply it to
 * monthly churn" carries no number, resolves no frame, and would make BOTH
 * cases below report "no baseline question" for a fixture reason rather than a
 * product one — the silent non-discrimination trap 13b describes.
 *
 * It states a LIMIT and never a current level, so
 * `deriveStatedTargetBaselinePercent` finds nothing to mint and the elicitation
 * cell is the one that fires. That is the same shape the EMIT pin uses.
 */
const ANSWER_MESSAGE = 'That limit is on monthly churn. Keep monthly churn under 4%.';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message,
  });
}

/** The committed graph's constraint rows, or `[]` when nothing committed. */
function committedConstraints(): ReadonlyArray<Record<string, unknown>> {
  const graph = appendCalls[0]?.['graph'] as { goal_constraints?: unknown[] } | undefined;
  return (graph?.goal_constraints ?? []) as ReadonlyArray<Record<string, unknown>>;
}

function committedPendings(): ReadonlyArray<PendingAction> {
  return (appendCalls[0]?.['pending_actions'] ?? []) as ReadonlyArray<PendingAction>;
}

beforeEach(() => {
  appendCalls.length = 0;
  mockedPendingActions = [];
  // Sink installed so telemetry never escapes the suite. Nothing here asserts
  // on events, so it deliberately keeps no buffer — an unread array is the
  // unused-binding shape that has failed this repo's lint step before tests
  // ever ran (CLAUDE.md trap 22e).
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('STEP 1 — the drop produces a card that points at add_constraint', () => {
  /**
   * Run through the REAL producers rather than a hand-built item: the whole
   * claim is about what the shipped chain emits, and a self-authored item would
   * encode this author's model of the producer instead of the producer
   * (trap 16-inverse).
   */
  function unbindableRow() {
    const extracted = extractCompoundGoals(BRIEF_LIMIT_SENTENCE);
    const remap = remapConstraintTargets(
      extracted.constraints,
      UNBINDABLE_NODE_IDS,
      UNBINDABLE_NODE_LABELS,
      'req-followthrough-step1',
    );
    return { extracted, remap };
  }

  /**
   * The churn row, selected by IDENTITY rather than by index.
   *
   * ⚠ MEASURED, NOT ASSUMED: this sentence yields THREE unbindable rows, not
   * one. My first version asserted `toHaveLength(1)` and CI returned 3 — the
   * precondition doing exactly its job, refusing to let the rest of the file
   * proceed on a guess about the producer. Binding by `targetName` + `value`
   * is the house pattern for this producer
   * (`constraint-target-unmatched-ask.test.ts` asserts
   * `unbindable.map(c => c.targetName)`), and it is trap 19: an index could
   * silently select a different row than the one this file is about.
   */
  function churnRow(remap: { readonly unbindable: readonly ExtractedGoalConstraint[] }) {
    return remap.unbindable.find(
      (c) => /churn/i.test(String(c.targetName ?? '')) && c.value === 4,
    );
  }

  it('PRECONDITION — the limit is extracted, and step 6 drops the churn row into `unbindable`', () => {
    const { extracted, remap } = unbindableRow();
    // Pinned so a later extractor change cannot make the rest of this file
    // pass by producing nothing to drop.
    expect(extracted.constraints.length).toBeGreaterThan(0);
    const row = churnRow(remap);
    expect(row, 'the churn limit must be among the step-6 drops').toBeDefined();
    expect(row!.operator).toBe('<=');
    // It reached neither the bound set nor, therefore, `goal_constraints[]`.
    expect(remap.constraints).toHaveLength(0);
  });

  it('the user is asked ONCE, however many rows the extractor produced', () => {
    const { remap } = unbindableRow();
    // Production maps EVERY unbindable row to an ask
    // (`unified-pipeline/stages/repair/compound-goals.ts`), so render the whole
    // set rather than one row: this is what the user would actually receive.
    // `renderDirectionClarifications` dedupes by (metric, amount), and that
    // dedupe is the only thing standing between one stated limit and a wall of
    // identical questions.
    const cards = renderDirectionClarifications(remap.unbindable.map(targetUnmatchedItem));
    expect(remap.unbindable.length).toBeGreaterThan(0);
    expect(cards).toHaveLength(1);
  });

  it('⭐ THE FIRST HALF OF THE JOIN — the rendered card carries `action_type: add_constraint`', () => {
    const { remap } = unbindableRow();
    const row = churnRow(remap);
    expect(row, 'fixture precondition: the churn row must exist').toBeDefined();
    const item = targetUnmatchedItem(row!);
    // Bind by the REASON's identity, not by copy text a sibling card could
    // also satisfy.
    expect(item.reason).toBe('target_unmatched');

    const cards = renderDirectionClarifications([item]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.action_type).toBe('add_constraint');
    // The card tells the user the limit is NOT in force — the true statement,
    // and the reason answering it is worth the user's time.
    expect(cards[0]!.detail).toContain('not being enforced');
  });
});

describe('STEP 3 — answering it dispatches add_constraint, and the cell decides the follow-up', () => {
  it('⭐ RISK TARGET — the constraint commits AND the baseline question is armed in the same commit', async () => {
    const { adapter, chatWithTools } = addConstraintToolCallAdapter();
    const { response, telemetry } = await runTurnExecutor(
      payload(ANSWER_MESSAGE),
      'req-followthrough-risk',
      { routingAdapter: adapter, graphState: answerTurnGraph('risk') },
    );

    expect(telemetry.failure_type).toBeNull();
    // The prose answer really did take the LLM route — this is the weak link
    // the file exists to exercise, so assert it was the one used.
    expect(chatWithTools).toHaveBeenCalled();

    // ⭐ PRECONDITION, ASSERTED BEFORE ANY CLAIM ABOUT THE QUESTION: the
    // constraint genuinely minted on the named target. Without this a green
    // "no pending" would be indistinguishable from a fixture that never
    // reached the handler at all.
    expect(appendCalls).toHaveLength(1);
    const rows = committedConstraints();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ node_id: 'n-churn', operator: '<=', value: 4, unit: '%' });

    // The join: the same commit carries the armed baseline question.
    const elicit = committedPendings().filter(
      (p) => p.action.kind === 'elicit_target_baseline',
    );
    expect(elicit).toHaveLength(1);
    expect(elicit[0]!.action).toMatchObject({
      kind: 'elicit_target_baseline',
      target_id: 'n-churn',
      target_label: 'Monthly churn',
    });
    // And the user is actually asked, in the receipt.
    expect(response.assistant_text).toContain(
      'Roughly what percentage is Monthly churn at right now?',
    );
  });

  it('⭐ FACTOR TARGET — the constraint still commits, and NO baseline question is armed', async () => {
    const { adapter } = addConstraintToolCallAdapter();
    const { telemetry } = await runTurnExecutor(
      payload(ANSWER_MESSAGE),
      'req-followthrough-factor',
      { routingAdapter: adapter, graphState: answerTurnGraph('factor') },
    );

    expect(telemetry.failure_type).toBeNull();

    // ⭐ THE SAME PRECONDITION, AND IT IS WHAT MAKES THIS CASE MEAN ANYTHING.
    // The write happened; only the follow-up differs. A fixture that failed to
    // commit would satisfy the "no pending" assertion for the wrong reason.
    expect(appendCalls).toHaveLength(1);
    const rows = committedConstraints();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ node_id: 'n-churn', operator: '<=', value: 4, unit: '%' });

    // `mintEligible` excludes `factor` deliberately: a baseline there is inert
    // because ISL refuses the conversion. So the sequence stops here.
    expect(
      committedPendings().filter((p) => p.action.kind === 'elicit_target_baseline'),
    ).toHaveLength(0);
  });
});
