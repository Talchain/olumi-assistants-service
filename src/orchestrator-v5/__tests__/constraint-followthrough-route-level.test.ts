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
import { runCompoundGoals } from '../../cee/unified-pipeline/stages/repair/compound-goals.js';
import {
  renderDirectionClarifications,
  type DirectionUnresolvedItem,
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
const UNBINDABLE_NODES = [
  { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
  { id: 'f-quality', kind: 'factor', label: 'Product quality' },
  { id: 'o-response-time', kind: 'outcome', label: 'First response time' },
];

/**
 * Two limits, two metrics, ONE number. Neither binds to a node above, so both
 * reach the ask channel — where the dedupe is keyed on the value alone.
 */
/**
 * ⚠ THE SECOND METRIC IS IN THE EXTRACTOR'S OWN VOCABULARY, AND THAT IS NOT
 * COSMETIC. My first choice was "refund rate", and the positive control
 * returned `[]` for it on its own — so the combined result could not be read.
 * `CONSTRAINT_ALIASES` (extractor.ts:1568) is a hand-maintained list of
 * TWENTY-EIGHT metric names, and every existing test of this producer uses one
 * of them ("budget", "churn"). `costs` is on the list; "refund rate" is not.
 *
 * ⚠⚠ WHETHER AN OFF-VOCABULARY METRIC IS SILENTLY DROPPED IS A SEPARATE AND
 * LARGER QUESTION THAN THIS FILE'S. The alias map is consumed at step 4 of
 * `remapConstraintTargets` (BINDING), not at extraction, so the `[]` above is
 * NOT yet explained — it could be non-extraction, a junk rejection, or a null
 * value. It is recorded, not concluded, and it is not tested here.
 */
const SECOND_LIMIT_SENTENCE = 'Keep costs under 4%.';
/** Carries a NEGATION ("must not"), so the negated-bound detector is in play. */
const THIRD_LIMIT_SENTENCE = 'Refund rate must not exceed 4%.';
const TWO_LIMITS_ONE_NUMBER = `${BRIEF_LIMIT_SENTENCE} ${SECOND_LIMIT_SENTENCE}`;

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
   * ⚠⚠ THIS DRIVES THE REAL PIPELINE, AND MY FIRST VERSION DID NOT — which is
   * why its result did not describe production.
   *
   * I hand-assembled `extractCompoundGoals` -> `remapConstraintTargets` ->
   * `renderDirectionClarifications(unbindable.map(targetUnmatchedItem))`. That
   * skips a step production performs: `compound-goals.ts:678-684` dedupes the
   * unbindable rows into asks **by VALUE** (`alreadyAsked: Set<number>`) BEFORE
   * any rendering. `renderDirectionClarifications` then dedupes again by
   * (metric, amount) — a DIFFERENT key. Reconstructing the chain measured a
   * path no user takes (CLAUDE.md trap 16: a fixture you assembled yourself is
   * not evidence about the wire).
   *
   * `runCompoundGoals(ctx)` is the production entry point, driven here exactly
   * as `constraint-target-unmatched-ask.test.ts` drives it.
   */
  function runPipeline(brief: string): {
    readonly wire: ReadonlyArray<Record<string, unknown>>;
    readonly asks: readonly DirectionUnresolvedItem[];
  } {
    const ctx = {
      requestId: 'req-constraint-followthrough',
      effectiveBrief: brief,
      graph: { nodes: UNBINDABLE_NODES.map((n) => ({ ...n })), edges: [] },
      llmGoalConstraints: undefined,
      goalConstraints: undefined,
      directionUnresolved: undefined,
    } as unknown as Parameters<typeof runCompoundGoals>[0];
    runCompoundGoals(ctx);
    const c = ctx as unknown as {
      goalConstraints?: ReadonlyArray<Record<string, unknown>>;
      directionUnresolved?: readonly DirectionUnresolvedItem[];
    };
    return { wire: c.goalConstraints ?? [], asks: c.directionUnresolved ?? [] };
  }

  it('PRECONDITION — the limit reaches NO wire row, and DOES reach the ask channel', () => {
    const { wire, asks } = runPipeline(BRIEF_LIMIT_SENTENCE);
    // It reached neither `goal_constraints[]` nor, therefore, the analysis.
    expect(wire).toHaveLength(0);
    // And it is asked about rather than dropped in silence. Bound by REASON
    // identity, never by copy another card could also carry (trap 19).
    const unmatched = asks.filter((a) => a.reason === 'target_unmatched');
    expect(unmatched.length).toBeGreaterThan(0);
    expect(unmatched.some((a) => /churn/i.test(a.metric_text))).toBe(true);
  });

  it('⭐ THE FIRST HALF OF THE JOIN — the rendered card carries `action_type: add_constraint`', () => {
    const { asks } = runPipeline(BRIEF_LIMIT_SENTENCE);
    const item = asks.find(
      (a) => a.reason === 'target_unmatched' && /churn/i.test(a.metric_text),
    );
    expect(item, 'fixture precondition: the churn ask must exist').toBeDefined();

    const cards = renderDirectionClarifications([item!]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.action_type).toBe('add_constraint');
    // ⚠⚠ NEITHER OF THE TWO OBVIOUS ASSERTIONS DISCRIMINATES HERE, AND A MUTANT
    // PROVED IT AFTER I HAD CLAIMED OTHERWISE IN WRITING.
    //
    //   · `action_type` is a single-member literal type
    //     (`DirectionStrengthenItem.action_type: 'add_constraint'`), so no
    //     type-safe mutation can fail it. I knew that and said so.
    //   · `detail` containing "not being enforced" is ALSO shared. I called
    //     this "the one that DISCRIMINATES" and was wrong: the direction branch
    //     reads "...so it is not being enforced yet. Add it as a constraint to
    //     make it binding." Inverting the branch discriminator left BOTH
    //     assertions green while five other suites REDded.
    //
    // ⭐ THE LABEL IS THE ONLY THING THAT SEPARATES THE TWO BRANCHES in copy a
    // user sees: the sixth reason asks WHICH PART OF THE MODEL a limit applies
    // to; the five direction reasons ask which DIRECTION it points. Asserting
    // the label is what makes this test bind to the `target_unmatched` branch
    // rather than to "some clarification card was rendered".
    expect(cards[0]!.label).toContain('Say which part of the model');
    expect(cards[0]!.label).not.toContain('Confirm the direction');
    // Kept, now honestly labelled as a shared-copy assertion rather than a
    // discriminating one: it pins that the card tells the user the limit is NOT
    // in force, which both branches must do and neither may quietly drop.
    expect(cards[0]!.detail).toContain('not being enforced');
  });

  /**
   * ⭐⭐ THE ASK DEDUPE IS KEYED ON THE NUMBER ALONE, AND NOTHING PINNED THAT.
   *
   * `compound-goals.ts:678-684` skips an unbindable row when `alreadyAsked`
   * already holds its VALUE — a `Set<number>` with no metric component, shared
   * with `coveredValues` and the detector findings. So two DIFFERENT limits the
   * user stated, on different metrics, that happen to share a number, collapse
   * to ONE question.
   *
   * That is not the clarification wall; it is its inverse — a stated limit
   * silently receiving no question at all. This case pins the observed set by
   * `metric_text` rather than a count, so it REDs whether the set grows or
   * shrinks (CLAUDE.md 22f) and a later reader can see WHICH limits were asked
   * about rather than how many.
   */
  /**
   * ⚠⚠ EVERY ASK, WITH ITS REASON — NEVER FILTERED TO ONE REASON.
   *
   * The first version of this helper filtered to `reason === 'target_unmatched'`
   * and I read its empty result as "the user is asked nothing". It is not: it is
   * "no ask OF THAT REASON". `ctx.directionUnresolved` is assembled from THREE
   * sources, and a question from either of the others is invisible to a
   * single-reason filter — so a suppressed-by-design ask and an absent one look
   * identical. Two separate seats made that exact mistake today, by different
   * routes, and both reported designed behaviour as silence.
   *
   * The dedup this file probes is DELIBERATE and its rationale is written above
   * it (`compound-goals.ts:628-666`): the filter runs against everything that
   * has already spoken for the quantity, and the ask fires only on the residue —
   * because (a) the extractor emits several overlapping rows per sentence, and
   * (b) an unproven direction is a LIE RISK where an unbound limit is a GAP, and
   * "a lie outranks a gap". A residue count is therefore NOT a count of the
   * questions a user sees.
   */
  function allAsks(brief: string): readonly string[] {
    return runPipeline(brief)
      .asks.map((a) => `${a.reason}|${a.metric_text.toLowerCase()}`)
      .sort();
  }

  /**
   * ⚠⚠ THE POSITIVE CONTROL IS WHAT MAKES THE NEXT CASE READABLE AT ALL.
   *
   * Without it, a combined-brief result of `['monthly churn']` is consistent
   * with BOTH readings — the dedupe swallowed the refund limit, OR the
   * extractor never produced one from that sentence. A control that cannot
   * distinguish the two answers is non-discriminating on precisely the question
   * it exists to answer (trap 13). Asking each sentence ON ITS OWN separates
   * them: if the refund limit asks alone and vanishes in company, the dedupe is
   * the only thing that changed.
   *
   * The refund sentence is deliberately an IN-DISTRIBUTION shape for this
   * extractor — `Churn must not exceed 4%.` is in its own corpus verbatim — so
   * a null result cannot be blamed on a phrasing this producer never handles.
   */
  /**
   * ⚠ AN EMPTY WIRE IS CORRECT BEHAVIOUR HERE, NOT A DEFECT, and it is asserted
   * as a PRECONDITION rather than as a finding. The row genuinely matches no
   * node in this fixture, so it SHOULD NOT reach the graph — `rejected_no_match`
   * is the honest outcome. Its only job is to remove the alternative reading of
   * an absent ask ("it bound and needed none"). Folding it together with an ask
   * assertion under one name would record a correct behaviour and a questionable
   * one as a single fact, and would go green for the wrong reason if only one
   * of them changed.
   */
  it('PRECONDITION — each limit, alone, binds to nothing (so an absent ask is not a bind)', () => {
    expect(runPipeline(BRIEF_LIMIT_SENTENCE).wire).toHaveLength(0);
    expect(runPipeline(SECOND_LIMIT_SENTENCE).wire).toHaveLength(0);
    expect(runPipeline(THIRD_LIMIT_SENTENCE).wire).toHaveLength(0);
  });

  /**
   * ⭐ THE THIRD ROW IS THE ONE THAT REFUTED MY OWN "NO QUESTION" CLAIM, and it
   * is the rationale at `compound-goals.ts:628-666` working exactly as written.
   *
   * `Refund rate must not exceed 4%.` carries a negation, so the negated-bound
   * detector speaks for that quantity first and the referent ask is skipped as
   * residue — "an unproven direction is a LIE RISK where an unbound limit is a
   * GAP, and a lie outranks a gap". **The user IS asked; they are asked the
   * MORE IMPORTANT question.** An earlier version of this file filtered to
   * `target_unmatched` and reported that as silence.
   */
  it('OBSERVED — every ask each limit produces on its own, with its reason', () => {
    expect(allAsks(BRIEF_LIMIT_SENTENCE)).toEqual(['target_unmatched|monthly churn']);
    expect(allAsks(SECOND_LIMIT_SENTENCE)).toEqual(['target_unmatched|costs']);
    expect(allAsks(THIRD_LIMIT_SENTENCE)).toEqual([
      'unspent_negation|refund rate must not',
    ]);
  });

  /**
   * ⭐⭐ MEASURED ACROSS ALL REASONS: THE SECOND METRIC RECEIVES NO QUESTION.
   *
   * `costs` asks on its own (row above, same node set). In company with a limit
   * sharing its number it produces NOTHING — not a different question, not a
   * suppressed-in-favour-of-a-better-one: **nothing from any channel.** This is
   * the unfiltered measurement, so it is not the artefact that made me withdraw
   * an earlier version of this claim.
   *
   * ⚠ I PREDICTED THE OPPOSITE, IN WRITING, BEFORE MEASURING — that the second
   * metric would turn out to be spoken for and this would close as designed
   * behaviour. It did not. Recorded because a registered wrong call is worth
   * more than a quiet correction.
   *
   * ⛔ AND IT REMAINS A RECORD, NOT A PRESCRIPTION. The dedup's written
   * rationale is sound and covers two cases — overlapping rows from the SAME
   * sentence, and a direction question outranking a referent one. It does not
   * claim to cover this one. **Widening the key to (value, metric) would break
   * case (a): one limit emits THREE rows with different names, so it would ask
   * three times about one limit.** Gap traded for noise. The honest root is the
   * extractor over-match upstream, and that needs its owner.
   *
   * The dedup key is value-only (`alreadyAsked: Set<number>`,
   * `compound-goals.ts:678-684`) — a fact about the code, not a verdict on it.
   * Its written rationale covers TWO cases: overlapping rows from the SAME
   * sentence, and a direction question outranking a referent question. **Neither
   * covers two DISTINCT metrics, in two sentences, sharing one number.**
   *
   * ⚠ WHETHER THAT IS A GAP IS NOT ESTABLISHED HERE AND THIS CASE DOES NOT SAY.
   * It records the full ask set, with reasons, so a reader can see whether the
   * second metric is spoken for by ANY channel. An earlier version of this file
   * asserted a single-reason subset and read its emptiness as silence; that was
   * wrong, and it is why the assertion below is unfiltered.
   *
   * Pinned as an exact set (CLAUDE.md 22f) so it REDs if the set grows OR
   * shrinks, and is green only for the right reason.
   */
  it('KNOWN-DROPPED — two distinct metrics sharing one number: the second gets NO ask, of any reason', () => {
    expect(allAsks(TWO_LIMITS_ONE_NUMBER)).toEqual(['target_unmatched|monthly churn']);
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
