/**
 * §2.1 ROW 7 — THE DISCUSSED-ENTITY TAIL. "The workspace follows the
 * conversation."
 *
 * The six shipped rows are each keyed to a handler SIDE EFFECT (an applied
 * mutation, a completed analysis, a flip query, an answered explain). So the
 * assistant can point at what it just CHANGED or COMPUTED, and never at what it
 * is merely TALKING ABOUT. Row 7 closes that: when this turn's composed cards
 * name a graph entity and no side-effect row fired, bring THAT entity into view.
 *
 * ENTITY RESOLUTION ROUTE (the design decision): the directive reuses an entity
 * reference the composed cards ALREADY carry — the first DISPATCHABLE ref in
 * block order, NOT `target_refs[0]` as this header claimed until 10 Aug 2026 —
 * a `TargetRef` CEE resolved against the graph node lookup and which has
 * already passed the block's own strict parse. NO prose is parsed here, NO
 * second resolution is performed, and the target therefore CANNOT disagree with
 * the card the user is reading (one derivation, two read points — the same rule
 * ROADMAP 2.211 applies to `selectLens`).
 *
 * WHICH of the card's refs it lands on is therefore decided by the order the
 * producing builder emitted them in. For the two prose-matched builders that
 * order is now FIRST MENTION IN THE PROSE (ROADMAP 2.1023); it used to be graph
 * lookup order, which could point the viewport at an incidental aside.
 *
 * Row 7 is a strict TAIL: it is reached only when the N=1 latch is still unset,
 * so it can never displace a side-effect gesture.
 *
 * Positive control (trap-13): every absence assertion below is preceded by
 * proving the emitter CAN see a presence on the same fixture family.
 * Identity binding (trap-19): every target assertion names the id AND the
 * label, never a value predicate another node could satisfy.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { UiDirectiveBlockSchema } from '@talchain/schemas/boundary';

import { composeToolCallResponse } from '../../compose.js';
import { buildDiscussedEntityUiDirective } from '../ui-directive.js';
import { setTestSink } from '../../../utils/telemetry.js';

/**
 * ⚠ WHY ATTRIBUTION IS TELEMETRY-BASED AND NOT BYTE-BASED.
 * Row 2 (lens focus) emits `focus @ <factor>` — BYTE-IDENTICAL to what row 7
 * emits. So an assertion on the block alone CANNOT tell which row authored it,
 * and the first draft of this file proved it the hard way: the row-7 test
 * PASSED at pristine because the fixture accidentally fired the
 * `evpi_evidence_priority` lens and row 2 produced the very bytes row 7 was
 * supposed to produce. The emit telemetry carries the authoring row's
 * `fact_type` tag, so it is the only available discriminator.
 */
const DISCUSSED_ENTITY_TAG = 'discussed_entity';

let sink: Array<{ event: string; data: Record<string, unknown> }> = [];
beforeEach(() => {
  sink = [];
  setTestSink((event, data) => sink.push({ event, data: data as Record<string, unknown> }));
});
afterEach(() => setTestSink(null));

function emittedBy(tag: string) {
  return sink.filter(
    (e) => e.event === 'v5.ui_directive.emitted' && e.data.fact_type === tag,
  );
}

function suppressions() {
  return sink.filter((e) => e.event === 'v5.ui_directive.suppressed');
}

const BASE_INPUT = {
  answerKind: 'functional' as const,
  orientation: 'Here is what the analysis says.',
  confirmation: '',
  coaching: null as string | null,
  stage: 'analyse' as const,
};

const GRAPH_HASH = 'gh_discussed_0001';

/**
 * Two factors, two options, one edge. `fac_margin` is the entity the evidence
 * card will discuss; `fac_team` exists so an assertion that binds to
 * `fac_margin` cannot pass on a different factor (the discriminating sibling).
 */
const GRAPH = {
  nodes: [
    { id: 'goal_g', label: 'Launch success', kind: 'goal' },
    { id: 'fac_margin', label: 'Gross margin floor', kind: 'factor' },
    { id: 'fac_team', label: 'Team ramp time', kind: 'factor' },
    { id: 'fac_churn', label: 'Customer churn rate', kind: 'factor' },
    { id: 'opt_x', label: 'Hire locally', kind: 'option' },
    { id: 'opt_y', label: 'Outsource delivery', kind: 'option' },
  ],
  edges: [
    { id: 'edge_mg', from: 'fac_margin', to: 'goal_g', label: 'Gross margin floor → Launch success' },
  ],
};

/**
 * A `decision_review.evidence_enhancements` entry produces an EvidenceBlock
 * whose `target_refs` is resolved STRUCTURALLY (factor id → lookup), not from
 * prose — so this fixture pins row 7 against a structurally-derived ref.
 */
function evidenceEnhancementFor(factorId: string): Record<string, unknown> {
  return {
    evidence_enhancements: {
      [factorId]: {
        specific_action: 'Benchmark against three comparable launches',
        rationale: 'The current estimate rests on a single internal forecast.',
        decision_hygiene: 'A tighter band here changes which option leads.',
        evidence_type: 'benchmark',
      },
    },
  };
}

/**
 * A run_analysis fact. `leadingOptionId: null` drives the ladder to row 3's
 * `no_recommendation` suppression, which is what leaves the N=1 latch unset and
 * lets row 7 be reached. Factor influences are deliberately BALANCED so no lens
 * fires and row 2 cannot claim the turn.
 */
function analysisFact(
  overrides: {
    leadingOptionId?: string | null;
    mayNameLeadingOption?: boolean;
    evidenceFactorId?: string | null;
  } = {},
): HandlerFact {
  const evidenceFactorId =
    overrides.evidenceFactorId === undefined ? 'fac_margin' : overrides.evidenceFactorId;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-discussed',
      leading_option_id:
        overrides.leadingOptionId === undefined ? null : overrides.leadingOptionId,
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        graph: GRAPH,
        confidence_tier: 'strong',
        __cee_claim_safety: {
          may_name_leading_option: overrides.mayNameLeadingOption ?? true,
          constraint_verdict_state: 'evaluated_feasible',
        },
        // Three balanced factors, all HIGH confidence — no single one exceeds
        // the dominance share and nothing looks shaky, so NO lens fires. This
        // exact shape is the repo's proven no-lens fixture
        // (ui-directive-focus.test.ts::healthyFact). ⚠ The confidences are
        // load-bearing: an earlier draft of this fixture used 0.2 on
        // fac_margin, which FIRED A LENS and made row 2 emit
        // `focus @ fac_margin` — byte-identical to what row 7 emits, so the
        // row-7 assertion passed at pristine while measuring row 2. The
        // no-lens precondition is pinned explicitly below.
        factor_sensitivity: [
          { factor_id: 'fac_margin', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_team', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
          { factor_id: 'fac_churn', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.51 }, { win_probability: 0.49 }],
        ...(evidenceFactorId === null ? {} : { decision_review: evidenceEnhancementFor(evidenceFactorId) }),
      },
    },
  } as unknown as HandlerFact;
}

function compose(fact: HandlerFact) {
  return composeToolCallResponse({
    ...BASE_INPUT,
    handlerFacts: [fact],
    persistedGraph: GRAPH,
    persistedGraphHash: GRAPH_HASH,
  });
}

function directives(env: ReturnType<typeof composeToolCallResponse>) {
  return env.blocks.filter((b) => b.type === 'ui_directive') as ReadonlyArray<
    Extract<(typeof env.blocks)[number], { type: 'ui_directive' }>
  >;
}

function blocksWithRefs(env: ReturnType<typeof composeToolCallResponse>) {
  return env.blocks.filter(
    (b) => Array.isArray((b as { target_refs?: unknown }).target_refs) &&
      ((b as { target_refs: unknown[] }).target_refs.length > 0),
  );
}

/**
 * A `decision_review.key_assumptions` entry composes an `assumption_check`
 * coaching card whose `target_refs` come from `resolveProseEntityRefs` — the
 * PROSE-matched path, as opposed to the structurally-resolved evidence card.
 * `evidenceFactorId: null` keeps the evidence card out of the turn so the
 * coaching card is the leading block carrying a dispatchable ref, which is what
 * makes row 7 land on it.
 */
const LEADS_WITH_MARGIN =
  'Gross margin floor is doing most of the work here, though Team ramp time matters a little too.';
const LEADS_WITH_TEAM =
  'Team ramp time is doing most of the work here, though Gross margin floor matters a little too.';

function assumptionFact(
  assumption: string,
  overrides: { leadingOptionId?: string | null; mayNameLeadingOption?: boolean } = {},
): HandlerFact {
  const fact = analysisFact({ ...overrides, evidenceFactorId: null }) as unknown as {
    result: { enrichment: Record<string, unknown> };
  };
  fact.result.enrichment.decision_review = { key_assumptions: [assumption] };
  return fact as unknown as HandlerFact;
}

/** The prose-matched coaching card's refs, read back for the precondition pin. */
function proseCardRefs(env: ReturnType<typeof composeToolCallResponse>) {
  const card = env.blocks.find(
    (b) => (b as { coaching_kind?: string }).coaching_kind === 'assumption_check',
  );
  expect(card).toBeDefined();
  return (card as unknown as { target_refs: Array<{ id: string; label: string; kind: string }> })
    .target_refs;
}

describe('row 7 — the workspace follows the conversation', () => {
  it('PRECONDITION PIN: the six side-effect rows all decline this turn, so row 7 is the only possible author', () => {
    // Pins the precondition IN-TEST rather than assuming it (trap 13b's third
    // face): if a future change makes a side-effect row claim this fixture, the
    // row-7 assertions below must fail LOUDLY instead of silently measuring the
    // other row's gesture.
    const env = compose(analysisFact());
    expect(emittedBy('run_analysis')).toHaveLength(0);
    expect(directives(env)).toHaveLength(1);
    expect(emittedBy(DISCUSSED_ENTITY_TAG)).toHaveLength(1);
  });

  it('POSITIVE CONTROL: the suppressed-ladder fixture really does compose a card that names fac_margin', () => {
    // Without this, every row-7 assertion below could pass or fail for reasons
    // that have nothing to do with the directive ladder.
    const env = compose(analysisFact());
    const withRefs = blocksWithRefs(env);
    expect(withRefs.length).toBeGreaterThan(0);
    const allRefs = withRefs.flatMap(
      (b) => (b as unknown as { target_refs: Array<{ id: string; label: string }> }).target_refs,
    );
    expect(allRefs).toContainEqual({
      id: 'fac_margin',
      label: 'Gross margin floor',
      kind: 'factor',
    });
  });

  it('emits focus @ the entity the card discusses when no side-effect row fired', () => {
    const env = compose(analysisFact());
    const ds = directives(env);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({
      type: 'ui_directive',
      verb: 'focus',
      // Bound by IDENTITY (id + label), not by a value predicate fac_team
      // or fac_churn could also satisfy.
      targets: [{ id: 'fac_margin', label: 'Gross margin floor', kind: 'factor' }],
    });
    expect(UiDirectiveBlockSchema.safeParse(ds[0]).success).toBe(true);
    // Attribution — these bytes were authored by row 7, not by row 2.
    expect(emittedBy(DISCUSSED_ENTITY_TAG)).toHaveLength(1);
  });

  it('stamps source=ladder so a capture can tell a deterministic gesture from an LLM-proposed one', () => {
    const env = compose(analysisFact());
    expect(directives(env)[0]).toMatchObject({ source: 'ladder' });
  });

  it('N=1 — a side-effect gesture still wins; row 7 never displaces it', () => {
    // Same fixture, but a real leading option: row 3's highlight fires and the
    // latch closes BEFORE row 7 is reached.
    const env = compose(analysisFact({ leadingOptionId: 'opt_x' }));
    const ds = directives(env);
    expect(ds).toHaveLength(1);
    // The side-effect row authored it, and row 7 emitted NOTHING — the latch
    // held. This is the no-double-emit guarantee, asserted by authorship rather
    // than by count alone (a count of 1 is also consistent with row 7 having
    // displaced the side-effect row, which is the failure this pins).
    expect(emittedBy('run_analysis')).toHaveLength(1);
    expect(emittedBy(DISCUSSED_ENTITY_TAG)).toHaveLength(0);
  });

  it('the withheld-claim gate still bites — row 7 SUPPRESSES rather than pointing at an option the turn may not name', () => {
    // Withheld verdict AND the only discussable entity is an OPTION.
    //
    // ⚠ TITLE HONESTY (review fold, 10 Aug 2026), and the repair was BIGGER
    // than the report. This test used to assert ONLY
    // `for (const d of ds) …expect(t.kind).not.toBe('option')`, and `ds` is
    // empty here — so the loop body never ran and the test asserted NOTHING
    // while its title claimed the gate bit.
    //
    // Adding `expect(ds).toHaveLength(0)` would have made it non-vacuous and
    // STILL not true to its title: the ORIGINAL fixture carried no
    // decision_review at all, so no card carried ANY dispatchable ref and row 7
    // suppressed with `no_discussed_entity` — it never reached the withheld
    // branch. Measured, not assumed: asserting the withheld reason against the
    // old fixture fails with `expected 'no_discussed_entity'`.
    //
    // So the fixture is repaired rather than the title: a prose-matched card
    // naming ONLY options, which is the sole shape that reaches the gate. (The
    // property was never uncovered — the unit tests below pin it directly; this
    // makes the INTEGRATION path prove it too.)
    const env = compose(
      assumptionFact('Hire locally looks stronger than Outsource delivery here.', {
        leadingOptionId: 'opt_x',
        mayNameLeadingOption: false,
      }),
    );
    // Precondition pinned in-test: the card really does carry option refs, and
    // NO factor/edge ref — otherwise the suppression would prove nothing.
    const refKinds = proseCardRefs(env).map((r) => r.kind);
    expect(refKinds.length).toBeGreaterThan(0);
    expect(new Set(refKinds)).toEqual(new Set(['option']));
    const ds = directives(env);
    expect(ds).toHaveLength(0);
    expect(emittedBy(DISCUSSED_ENTITY_TAG)).toHaveLength(0);
    // Bind to the REASON, not just to the absence — an absence is also
    // consistent with the ladder never reaching row 7 at all.
    const dropped = suppressions().filter((e) => e.data.fact_type === DISCUSSED_ENTITY_TAG);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.data.reason).toBe('leading_option_claim_withheld');
    // Kept as a total guard: were a future change to make row 7 emit here, an
    // option target must still be impossible.
    for (const d of ds) {
      for (const t of d.targets) {
        expect(t.kind).not.toBe('option');
      }
    }
  });

  // ── ROADMAP 2.1023: row 7 follows the SENTENCE, not the node array ────────
  //
  // The two coaching builders in phase3-blocks.ts populate `target_refs` via
  // `resolveProseEntityRefs`. Row 7 takes the first DISPATCHABLE ref, so on a
  // turn whose leading eligible card is one of those, the viewport lands on
  // whichever entity that resolver put first. It used to put them in GRAPH
  // LOOKUP order, so the workspace could jump to an incidental aside while the
  // user reads about the main subject — worse than not moving at all, because
  // it teaches the user to distrust the gesture.
  //
  // ⚠ WHICH OF THE PAIR IS THE DISCRIMINATOR — measured, not assumed. `GRAPH`
  // lists `fac_margin` BEFORE `fac_team`, so on the first case below lookup
  // order and prose order AGREE: it is the CONTROL, and it survives a mutant
  // that deletes the ordering entirely. The second case (prose leading with
  // `fac_team`) is where the two orders DISAGREE, and it is the one that bites.
  // Stated because an earlier draft of this comment had the node order
  // backwards and would have sold the control as the proof.
  it('row 7 focuses the entity the sentence LEADS with, not the one the graph happens to list first', () => {
    const env = compose(assumptionFact(LEADS_WITH_MARGIN));

    // Precondition pinned IN-TEST (trap 13b): the card really does resolve BOTH
    // factors, so a pass cannot come from the aside having failed to resolve.
    const refs = proseCardRefs(env);
    expect(refs.map((r) => r.id)).toEqual(['fac_margin', 'fac_team']);

    const ds = directives(env);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({
      verb: 'focus',
      targets: [{ id: 'fac_margin', label: 'Gross margin floor', kind: 'factor' }],
    });
    // Attribution: row 2 emits byte-identical `focus @ <factor>`, so only the
    // telemetry tag can prove row 7 authored this.
    expect(emittedBy(DISCUSSED_ENTITY_TAG)).toHaveLength(1);
    expect(emittedBy('run_analysis')).toHaveLength(0);
  });

  it('DISCRIMINATOR: reversing the mentions in the SAME graph moves the viewport to the other factor', () => {
    // Without this, the test above is also satisfied by any rule that happens
    // to prefer fac_margin (its id, its label, a hardcoded reversal of lookup
    // order). Only a pair that flips with the PROSE proves the binding.
    const env = compose(assumptionFact(LEADS_WITH_TEAM));
    expect(proseCardRefs(env).map((r) => r.id)).toEqual(['fac_team', 'fac_margin']);
    const ds = directives(env);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({
      targets: [{ id: 'fac_team', label: 'Team ramp time', kind: 'factor' }],
    });
    expect(emittedBy(DISCUSSED_ENTITY_TAG)).toHaveLength(1);
  });

  it('suppresses rather than pointing at nothing when no card names an entity — with a closed reason tag', () => {
    const env = compose(analysisFact({ evidenceFactorId: null }));
    expect(directives(env)).toHaveLength(0);
    // A directive that silently does not fire is the broken-alarm class. The
    // drop must be observable and reason-tagged.
    const dropped = suppressions().filter((e) => e.data.fact_type === DISCUSSED_ENTITY_TAG);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].data.reason).toBe('no_discussed_entity');
  });
});

describe('row 7 — never fires on a turn the user did not initiate', () => {
  // ⚠ MEASURED, NOT ASSUMED — and the first version of this comment was WRONG.
  // It claimed two INDEPENDENT mechanisms (`facts.length > 0` and ORDERING),
  // each needing its own pin. A mutant settled it: deleting the `facts.length`
  // gate left every spec GREEN. It is not independently load-bearing for the
  // DIRECTIVE outcome, because with the ordering correct there are no blocks to
  // scan yet on a rebuild-only turn — row 7 finds nothing either way.
  //
  // What is actually true:
  //   (a) ORDERING is the load-bearing mechanism — row 7 runs BEFORE the
  //       lifecycle rebuild pushes its blocks. Pinned by THIS test (a turn that
  //       HAS a current-turn fact AND triggers a rebuild); the restored
  //       zero-directive test in graph-lookup-fallback.test.ts is structurally
  //       BLIND to it, because its `facts` is empty.
  //   (b) `facts.length > 0` is defence-in-depth whose only observable effect
  //       is suppressing a SPURIOUS suppression-telemetry event on a turn that
  //       was never a candidate. Pinned by the telemetry-silence test below —
  //       an unpinned redundant guard is a guard agreeing with itself.
  it('a current-turn fact + a FRESH lifecycle rebuild: row 7 never points at a REBUILT card', () => {
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      // Row 1 suppresses: this target does not exist in the graph, so the
      // current-turn facts contribute NO card carrying a dispatchable ref.
      handlerFacts: [
        {
          fact_type: 'set_factor_value',
          fact_version: 1,
          noop: false,
          result: { target_id: 'fac_does_not_exist', status: 'applied', before: {}, after: {} },
        } as unknown as HandlerFact,
      ],
      persistedGraph: GRAPH,
      lifecycle: {
        priorFacts: [analysisFact({ leadingOptionId: 'opt_x' })],
        freshness: {
          freshness: 'fresh',
          selected_fact_index: 0,
          graph_hash_at_run: GRAPH_HASH,
          current_graph_hash: GRAPH_HASH,
          reason: 'graph_hash_match',
          computed_at: '2026-08-10T09:00:00.000Z',
        },
        requestId: 'req-row7-ordering',
        scenarioId: 'scen-discussed',
      } as unknown as Parameters<typeof composeToolCallResponse>[0]['lifecycle'],
    });

    // POSITIVE CONTROL: the rebuild really did happen and really did compose
    // cards naming entities — otherwise this test would pass by testing nothing.
    const rebuilt = blocksWithRefs(env);
    expect(rebuilt.length).toBeGreaterThan(0);

    // …and yet NO directive was emitted from them.
    expect(directives(env)).toHaveLength(0);
    expect(emittedBy(DISCUSSED_ENTITY_TAG)).toHaveLength(0);
  });

  it('a rebuild-only turn emits NO row-7 telemetry at all — not even a suppression', () => {
    // This is the pin on the `facts.length > 0` gate, which the mutant above
    // showed has no effect on the DIRECTIVE outcome. Its real job is here: a
    // turn that was never a candidate must not emit a suppression event either.
    // A spurious `no_discussed_entity` on every rehydration would be exactly
    // the broken-alarm noise the reason tags exist to avoid — a drop that
    // "fires" constantly stops carrying information.
    const env = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [],
      persistedGraph: GRAPH,
      lifecycle: {
        priorFacts: [analysisFact({ leadingOptionId: 'opt_x' })],
        freshness: {
          freshness: 'fresh',
          selected_fact_index: 0,
          graph_hash_at_run: GRAPH_HASH,
          current_graph_hash: GRAPH_HASH,
          reason: 'graph_hash_match',
          computed_at: '2026-08-10T09:00:00.000Z',
        },
        requestId: 'req-row7-silence',
        scenarioId: 'scen-discussed',
      } as unknown as Parameters<typeof composeToolCallResponse>[0]['lifecycle'],
    });
    // POSITIVE CONTROL: the rebuild really did compose cards naming entities.
    expect(blocksWithRefs(env).length).toBeGreaterThan(0);
    expect(directives(env)).toHaveLength(0);
    expect(emittedBy(DISCUSSED_ENTITY_TAG)).toHaveLength(0);
    expect(suppressions().filter((e) => e.data.fact_type === DISCUSSED_ENTITY_TAG)).toHaveLength(0);
  });
});

// ===========================================================================
// UNIT COVERAGE for the selection rule + the two gates.
//
// ⚠ WHY THESE EXIST, stated plainly because it is the honest reason: the
// integration fixture above CANNOT REACH these branches. It composes exactly
// one dispatchable ref, and that ref is always a FACTOR — so the withheld-claim
// gate, the dispatchable-kind filter and the composition-order rule were all
// GREEN THROUGH THEIR OWN MUTANTS (measured: defanging the withheld gate,
// removing the kind filter, and reversing the scan order each left the suite
// fully green). That is trap 16-inverse — the producer in that fixture cannot
// emit the shapes those branches exist for, so a passing suite said nothing
// about them. These unit tests drive the builder directly with the shapes a
// real turn can carry.
// ===========================================================================

/** A minimal block carrying `target_refs`. `readTargetRefs` reads the field
 *  defensively, so this stands in for any card that names entities. */
function cardWithRefs(refs: ReadonlyArray<{ id: string; label: string; kind: string }>) {
  return { type: 'coaching', target_refs: refs } as unknown as Parameters<
    typeof buildDiscussedEntityUiDirective
  >[0][number];
}

const FACTOR_REF = { id: 'fac_margin', label: 'Gross margin floor', kind: 'factor' };
const OTHER_FACTOR_REF = { id: 'fac_team', label: 'Team ramp time', kind: 'factor' };
const OPTION_REF = { id: 'opt_x', label: 'Hire locally', kind: 'option' };
const GOAL_REF = { id: 'goal_g', label: 'Launch success', kind: 'goal' };
const CONSTRAINT_REF = { id: 'con_budget', label: 'Budget ceiling', kind: 'constraint' };

describe('row 7 — the withheld-claim gate', () => {
  it('POSITIVE CONTROL: an option IS pointed at when the turn may name a leader', () => {
    // Without this, the suppression below could be caused by anything at all.
    const d = buildDiscussedEntityUiDirective([cardWithRefs([OPTION_REF])], true);
    expect(d).toMatchObject({
      verb: 'focus',
      targets: [{ id: 'opt_x', label: 'Hire locally', kind: 'option' }],
    });
  });

  it('skips an option target when the turn may NOT name a leader, and says so', () => {
    const d = buildDiscussedEntityUiDirective([cardWithRefs([OPTION_REF])], false);
    expect(d).toBeNull();
    const dropped = suppressions().filter((e) => e.data.fact_type === DISCUSSED_ENTITY_TAG);
    expect(dropped).toHaveLength(1);
    // Distinct from `no_discussed_entity` on purpose: there WAS something to
    // point at and we declined, which is a different operational fact.
    expect(dropped[0].data.reason).toBe('leading_option_claim_withheld');
  });

  it('a withheld turn still points at a FACTOR — the gate is scoped to options, not a blanket mute', () => {
    // Over-suppression is the other half of the acceptance criteria: a factor
    // target asserts no leader, so the user keeps their pointer on exactly the
    // turn they most need one.
    const d = buildDiscussedEntityUiDirective(
      [cardWithRefs([OPTION_REF, FACTOR_REF])],
      false,
    );
    expect(d).toMatchObject({
      verb: 'focus',
      targets: [{ id: 'fac_margin', label: 'Gross margin floor', kind: 'factor' }],
    });
  });
});

describe('row 7 — the dispatchable-kind filter', () => {
  it('POSITIVE CONTROL: a factor in the same position IS pointed at', () => {
    const d = buildDiscussedEntityUiDirective([cardWithRefs([FACTOR_REF])], true);
    expect(d).toMatchObject({ targets: [{ id: 'fac_margin', kind: 'factor' }] });
  });

  it('skips kinds with no shipped renderer even when they come FIRST', () => {
    // `constraint` is a known dead end (schema comment: ROADMAP 2.457(b)); goal
    // has no shipped precedent. Pointing at either is a gesture that silently
    // does nothing. The factor behind them must win instead.
    const d = buildDiscussedEntityUiDirective(
      [cardWithRefs([GOAL_REF, CONSTRAINT_REF, FACTOR_REF])],
      true,
    );
    expect(d).toMatchObject({
      targets: [{ id: 'fac_margin', label: 'Gross margin floor', kind: 'factor' }],
    });
  });

  it('suppresses when EVERY candidate is a non-dispatchable kind', () => {
    const d = buildDiscussedEntityUiDirective(
      [cardWithRefs([GOAL_REF, CONSTRAINT_REF])],
      true,
    );
    expect(d).toBeNull();
    const dropped = suppressions().filter((e) => e.data.fact_type === DISCUSSED_ENTITY_TAG);
    expect(dropped[0].data.reason).toBe('no_discussed_entity');
  });
});

describe('row 7 — selection order binds to the named entity', () => {
  it('the FIRST dispatchable ref in composition order wins', () => {
    // DISCRIMINATING: fac_team is also a perfectly valid factor, so an
    // assertion that merely checked "kind === factor" would pass on either.
    // This binds by IDENTITY to the one composition order selects.
    const d = buildDiscussedEntityUiDirective(
      [cardWithRefs([FACTOR_REF]), cardWithRefs([OTHER_FACTOR_REF])],
      true,
    );
    expect(d).toMatchObject({
      targets: [{ id: 'fac_margin', label: 'Gross margin floor', kind: 'factor' }],
    });
  });

  it('and the sibling is chosen when IT is the one composition order puts first', () => {
    // The other arm of the pair: proves the assertion above tracks ORDER, not
    // a hardcoded affinity for fac_margin.
    const d = buildDiscussedEntityUiDirective(
      [cardWithRefs([OTHER_FACTOR_REF]), cardWithRefs([FACTOR_REF])],
      true,
    );
    expect(d).toMatchObject({
      targets: [{ id: 'fac_team', label: 'Team ramp time', kind: 'factor' }],
    });
  });

  it('malformed refs are skipped without throwing, and a good ref behind them still wins', () => {
    const d = buildDiscussedEntityUiDirective(
      [
        cardWithRefs([
          { id: '', label: 'blank id', kind: 'factor' },
          { id: 'fac_x', label: '', kind: 'factor' },
          FACTOR_REF,
        ]),
      ],
      true,
    );
    expect(d).toMatchObject({ targets: [{ id: 'fac_margin', kind: 'factor' }] });
  });
});
