/**
 * Context/Memory V5 — defect 3: the whole-pack context ceiling is REPORTED
 * and never ENFORCED.
 *
 * At the base commit `CONTEXT_POLICY.coach_converse.total_char_budget`
 * (55,000 chars) was a pure measurement target: `computeOverBudget` reported
 * a `'total'` overrun on the `v5.context_budget` stream and NOTHING acted on
 * it. The only cut machinery (`orchestrator/context/budget.ts`, wired at
 * `applyContextBudgetToAssemblyInputs`) allocates the graph 25% of a 120,000
 * TOKEN budget — it cannot fire below ~120,000 chars — and it is explicitly
 * forbidden from touching the conversation window. `conversation` is the
 * largest section a routing pack carries (8 turns x 2 messages x the 2,000-
 * char persistence cap ~= 33.8k measured) and had NO cut at any level.
 *
 * RED-first contract (all four behavioural signatures fail at pristine):
 *   1. an over-budget pack is returned over budget, at the full window;
 *   2. the trim is OLDEST-first and the survivors are the newest turns
 *      (bound BY IDENTITY — `turn_id` — never by count, trap #19);
 *   3. `window.shown` + the in-band `notice` reconcile with what survived;
 *   4. a `v5.context_truncation` event names the cut.
 *
 * Two things this suite deliberately does NOT do:
 *   - it never re-captures the under-budget golden (that assertion lives in
 *     `context-budget-enforcement.test.ts`, extended in the same commit with
 *     the subtraction idiom already established there);
 *   - it never asserts a retained COUNT where an identity is available.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import * as telemetry from '../../../utils/telemetry.js';
import { TelemetryEvents } from '../../../utils/telemetry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import {
  assembleContextPack,
  CONTEXT_PACK_RECENT_TURNS_CAP,
  PERSISTED_MESSAGE_CAP,
} from '../context-pack-assembler.js';
import {
  CONTEXT_PACK_CEILING_CUT_ORDER,
  CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS,
  CONTEXT_POLICY,
} from '../context-policy.js';
import { analysisSummaryFixture, priorTurnsFixture } from './context-budget-fixtures.js';
import type { CompactEdge, CompactNode, GraphV3Compact } from '../../../orchestrator/context/graph-compact.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

const BASE_PAYLOAD = Object.freeze(makeMessagePayload());

/** The ONE budget under test — consumed from the policy, never re-typed. */
const TOTAL_BUDGET = CONTEXT_POLICY.coach_converse.total_char_budget;

/**
 * Prior turns at the persistence cap — the realistic worst case for the
 * conversation section (`commit.capConversationText` caps a persisted message
 * at {@link PERSISTED_MESSAGE_CAP}, so no real turn can exceed this).
 * `turn_id` is `t-prev-<i>` and index 0 is the MOST RECENT (the store reads
 * `created_at DESC`), so the OLDEST retained turn is the LAST element.
 */
function fatTurns(count: number): SessionTurnWithContent[] {
  return priorTurnsFixture(count).map((turn, i) => ({
    ...turn,
    user_message: `U${i} ${'a'.repeat(PERSISTED_MESSAGE_CAP - 4)}`,
    assistant_message: `A${i} ${'b'.repeat(PERSISTED_MESSAGE_CAP - 4)}`,
  }));
}

/**
 * A compact graph sized in CHARS, well under the old valve's ~120,000-char
 * graph allocation (so `applyContextBudgetToAssemblyInputs` provably does not
 * fire and every trim observed here is the ceiling pass's own).
 */
function bulkyCompactGraph(nodeCount: number, labelChars: number): GraphV3Compact {
  const nodes: CompactNode[] = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`,
    kind: i === 0 ? 'goal' : i === 1 ? 'option' : 'factor',
    label: `Bulky node ${i} ${'x'.repeat(labelChars)}`,
    value: i,
    unit: '%',
  }));
  const edges: CompactEdge[] = Array.from({ length: nodeCount - 1 }, (_, i) => ({
    from: `n${i}`,
    to: `n${i + 1}`,
    strength: 0.5,
  }));
  return { nodes, edges, _node_count: nodes.length, _edge_count: edges.length };
}

const CEILING_SITE = 'context-pack-assembler.enforceContextPackCeiling';

let emitSpy: MockInstance<typeof telemetry.emit>;

beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit');
});

afterEach(() => {
  vi.restoreAllMocks();
});

function ceilingEvents(): Record<string, unknown>[] {
  return emitSpy.mock.calls
    .filter(([event]) => event === TelemetryEvents.V5ContextTruncation)
    .map(([, payload]) => payload as Record<string, unknown>)
    .filter((p) => p.site === CEILING_SITE);
}

/**
 * Assemble a pack whose NON-conversation content is `graphNodes` nodes wide.
 * Everything except the conversation window is identical across the fixtures
 * below, so the never-trimmed comparison is a like-for-like byte comparison.
 */
function assemblePack(args: {
  readonly turns: number;
  readonly graphNodes: number;
  readonly labelChars: number;
  readonly priorTurnsTotal?: number | null;
}) {
  return assembleContextPack({
    payload: BASE_PAYLOAD,
    priorTurns: fatTurns(args.turns),
    priorTurnsTotal: args.priorTurnsTotal ?? 40,
    priorFacts: [],
    brief: 'Should we expand into the EU next year, or consolidate at home?',
    compactedGraph: bulkyCompactGraph(args.graphNodes, args.labelChars),
    compactedConstraints: null,
    analysis: analysisSummaryFixture(),
  });
}

/** Over the ceiling by ~2 turn-pairs' worth of conversation. */
const OVERFLOW = { turns: CONTEXT_PACK_RECENT_TURNS_CAP, graphNodes: 10, labelChars: 700 } as const;
/** Non-conversation content ALONE past the ceiling — the floor case. */
const PATHOLOGICAL = { turns: CONTEXT_PACK_RECENT_TURNS_CAP, graphNodes: 20, labelChars: 700 } as const;

describe('whole-pack context ceiling — overflow determinism (defect 3)', () => {
  it('trims the verbatim conversation OLDEST-first until the pack fits the policy total', () => {
    // Precondition (trap #13b — a guard whose discrimination is unpinned is a
    // tautology): the SAME fixture with a 2-turn window must be UNDER budget,
    // so the overflow is genuinely the conversation's doing and the trim has
    // somewhere to land.
    const small = assemblePack({ ...OVERFLOW, turns: CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS });
    expect(
      JSON.stringify(small).length,
      'precondition: the floor-sized window must fit, else this fixture tests the floor, not the trim',
    ).toBeLessThanOrEqual(TOTAL_BUDGET!);

    const pack = assemblePack(OVERFLOW);
    const shown = pack.conversation.recent_turns.length;

    // Precondition: the UNTRIMMED pack really did overflow. Taken from the
    // pass's own pre-cut measurement rather than re-derived here, so this
    // cannot quietly become a claim about a different quantity.
    expect(
      ceilingEvents()[0]?.pack_total_chars_before as number,
      'precondition: fixture must be over budget at the full window',
    ).toBeGreaterThan(TOTAL_BUDGET!);

    // 1. The pack fits.
    expect(JSON.stringify(pack).length).toBeLessThanOrEqual(TOTAL_BUDGET!);
    // 2. Something was actually cut (never a vacuous pass).
    expect(shown).toBeLessThan(CONTEXT_PACK_RECENT_TURNS_CAP);
    expect(shown).toBeGreaterThanOrEqual(CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS);
    // 3. ⭐ IDENTITY BIND (trap #19): the survivors are the NEWEST turns, in
    //    order — `t-prev-0` is the most recent. A count assertion would pass
    //    on a newest-first trim; this cannot.
    expect(pack.conversation.recent_turns.map((t) => t.turn_id)).toEqual(
      Array.from({ length: shown }, (_, i) => `t-prev-${i}`),
    );
  });

  it('re-stamps window.shown and re-renders the notice from the SAME authority', () => {
    const pack = assemblePack(OVERFLOW);
    const shown = pack.conversation.recent_turns.length;

    expect(pack.conversation.window?.shown).toBe(shown);
    // `available` / `turn_count` describe the CONVERSATION, not the window —
    // a trim must not move them.
    expect(pack.conversation.window?.available).toBe(40);
    expect(pack.conversation.turn_count).toBe(40);

    const notice = pack.conversation.window?.notice;
    expect(notice, 'a trimmed window MUST disclose — a silent drop is the defect class').toBeTypeOf(
      'string',
    );
    // The sentence and the numbers cannot disagree: the notice is rendered by
    // `conversationWindowNotice`, the same builder that owns the untrimmed
    // disclosure, from the re-stamped counts.
    expect(notice).toContain(`the ${shown} most recent`);
    expect(notice).toContain('40 turns are on record');
    expect(notice).toContain(`${40 - shown} earlier`);
  });

  it('emits v5.context_truncation for the cut with strategy window_slice', () => {
    const pack = assemblePack(OVERFLOW);
    const events = ceilingEvents();
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.section).toBe('conversation');
    expect(event.strategy).toBe('window_slice');
    expect(event.disclosed).toBe(true);
    expect(event.original_records).toBe(CONTEXT_PACK_RECENT_TURNS_CAP);
    expect(event.kept_records).toBe(pack.conversation.recent_turns.length);
    expect(event.kept_chars).toBe(JSON.stringify(pack.conversation).length);
    expect(event.original_chars as number).toBeGreaterThan(event.kept_chars as number);
    // The whole-pack accounting that made the cut fire.
    expect(event.pack_total_budget).toBe(TOTAL_BUDGET);
    expect(event.pack_total_chars_before as number).toBeGreaterThan(TOTAL_BUDGET!);
    expect(event.pack_total_chars_after).toBe(JSON.stringify(pack).length);
    // The trim reached the target, so it did not stop at its floor.
    expect(event.floor_reached).toBeUndefined();
  });
});

describe('whole-pack context ceiling — the retention floor', () => {
  it('stops at exactly the floor, stays honestly over budget, and says so', () => {
    // Precondition: non-conversation content ALONE exceeds the ceiling, so no
    // amount of window trimming can fit this pack. Measured with the window at
    // the floor — if this ever fits, the test below is measuring the ordinary
    // trim path and proves nothing about the floor.
    const atFloor = assemblePack({ ...PATHOLOGICAL, turns: CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS });
    expect(
      JSON.stringify(atFloor).length,
      'precondition: this fixture must be un-fittable even at the floor',
    ).toBeGreaterThan(TOTAL_BUDGET!);

    const pack = assemblePack(PATHOLOGICAL);

    // Exactly the floor — never fewer, even though the pack is still over.
    expect(pack.conversation.recent_turns).toHaveLength(CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS);
    expect(pack.conversation.recent_turns.map((t) => t.turn_id)).toEqual(['t-prev-0', 't-prev-1']);
    expect(JSON.stringify(pack).length).toBeGreaterThan(TOTAL_BUDGET!);

    // Telemetry is honest about BOTH facts: a cut happened, and it did not fit.
    const events = ceilingEvents();
    // Exactly one event — a re-entrant/looping pass would emit repeatedly.
    expect(events).toHaveLength(1);
    expect(events[0].floor_reached).toBe(true);
    expect(events[0].kept_records).toBe(CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS);
    expect(events[0].pack_total_chars_after as number).toBeGreaterThan(TOTAL_BUDGET!);
  });

  it('cuts nothing and emits nothing when the window is already at the floor', () => {
    const pack = assemblePack({
      ...PATHOLOGICAL,
      turns: CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS,
    });
    expect(pack.conversation.recent_turns).toHaveLength(CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS);
    // No cut happened, so no cut may be claimed (an event asserting a
    // truncation that did not occur is the fabrication class this estate hunts).
    expect(ceilingEvents()).toHaveLength(0);
  });
});

describe('whole-pack context ceiling — never-trimmed protection', () => {
  it('touches ONLY the conversation window; every other section is byte-equal', () => {
    const trimmed = assemblePack(OVERFLOW);
    // Control: the identical inputs with a window small enough that the
    // ceiling pass never fires. Any difference outside `conversation` is the
    // pass reaching where it must not.
    const control = assemblePack({ ...OVERFLOW, turns: CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS });

    // Precondition: the control genuinely did NOT trim (else this compares
    // two trimmed packs and cannot see a leak).
    expect(control.conversation.recent_turns).toHaveLength(CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS);
    expect(trimmed.conversation.recent_turns.length).toBeGreaterThan(
      CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS,
    );

    for (const section of [
      'graph',
      'display_graph',
      'display_analysis',
      'analysis',
      'brief',
      'recent_changes',
      'coaching',
    ] as const) {
      expect(
        JSON.stringify(trimmed[section]),
        `${section} must be byte-identical across a conversation trim`,
      ).toBe(JSON.stringify(control[section]));
    }
    // The graph arrays flow through BY REFERENCE (the pass rebuilds the pack
    // shallowly) — a stronger claim than byte equality.
    const graph = bulkyCompactGraph(OVERFLOW.graphNodes, OVERFLOW.labelChars);
    const pack = assembleContextPack({
      payload: BASE_PAYLOAD,
      priorTurns: fatTurns(CONTEXT_PACK_RECENT_TURNS_CAP),
      priorTurnsTotal: 40,
      priorFacts: [],
      compactedGraph: graph,
      compactedConstraints: null,
      analysis: analysisSummaryFixture(),
    });
    expect(pack.graph.nodes).toBe(graph.nodes);
    expect(pack.graph.edges).toBe(graph.edges);
    // And the per-turn projections of the SURVIVING turns are untouched.
    expect(pack.conversation.recent_turns[0]).toStrictEqual(control.conversation.recent_turns[0]);
  });

  it('leaves conversation_summary and older_relevant_facts untouched by a trim', () => {
    const common = {
      payload: BASE_PAYLOAD,
      priorTurnsTotal: 40,
      priorFacts: [],
      compactedGraph: bulkyCompactGraph(OVERFLOW.graphNodes, OVERFLOW.labelChars),
      compactedConstraints: null,
      analysis: analysisSummaryFixture(),
      conversationSummary: {
        text: 'FRAME: EU expansion vs consolidation. OPEN: hiring runway.',
        current_to_turn_id: 't-prev-3',
        lag_turns: 1,
        stale: false,
      },
      summarisedTurns: 12,
      olderRelevantFacts: '[2026-03-02] Chose "EU pilot": fastest route to a real signal.',
    };
    const trimmed = assembleContextPack({
      ...common,
      priorTurns: fatTurns(CONTEXT_PACK_RECENT_TURNS_CAP),
    });
    const control = assembleContextPack({
      ...common,
      priorTurns: fatTurns(CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS),
    });
    expect(trimmed.conversation.recent_turns.length).toBeLessThan(CONTEXT_PACK_RECENT_TURNS_CAP);
    expect(trimmed.conversation_summary).toBe(control.conversation_summary);
    expect(JSON.stringify(trimmed.older_relevant_facts)).toBe(
      JSON.stringify(control.older_relevant_facts),
    );
    // `summarised` rides the window object the trim rewrites — it must survive.
    expect(trimmed.conversation.window?.summarised).toBe(12);
  });
});

describe('whole-pack context ceiling — the declared cut order is the EXECUTED one', () => {
  it('declares conversation as a ceiling-cut section', () => {
    expect(CONTEXT_PACK_CEILING_CUT_ORDER).toContain('conversation');
  });

  it('the policy row DERIVES its cut_rank from that same const (no hand-written mirror)', () => {
    const conversation = CONTEXT_POLICY.coach_converse.sections.find((s) => s.name === 'conversation');
    expect(conversation).toBeDefined();
    expect(conversation!.cut_rank).toBe(
      (CONTEXT_PACK_CEILING_CUT_ORDER as readonly string[]).indexOf('conversation'),
    );
  });

  it('every section NOT in the cut order still declares cut_rank null', () => {
    for (const section of CONTEXT_POLICY.coach_converse.sections) {
      if ((CONTEXT_PACK_CEILING_CUT_ORDER as readonly string[]).includes(section.name)) continue;
      expect(section.cut_rank, `${section.name} is not a cut section`).toBeNull();
    }
  });

  it('the conversation row declares the cut it now HAS (no longer telemetry_only)', () => {
    const conversation = CONTEXT_POLICY.coach_converse.sections.find((s) => s.name === 'conversation');
    // The cut is driven by the WHOLE-PACK total, not by this section's own
    // char_budget — `enforced` would be a false guarantee (nothing cuts the
    // conversation at 34,000 chars), `telemetry_only` is now false the other
    // way (there IS a live cut).
    expect(conversation!.enforcement).toBe('enforced_by_total');
    expect(CONTEXT_POLICY.coach_converse.total_char_budget).not.toBeNull();
  });
});
