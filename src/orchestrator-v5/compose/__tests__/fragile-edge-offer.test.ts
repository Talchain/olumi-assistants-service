/**
 * ROADMAP 2.989 — the fragile-edge OFFER: the block that reaches the wire, the
 * routing gates its acceptance text must clear, and the telemetry that measures
 * both arms.
 *
 * Driven over the two LIVE CAPTURES (`fixtures/dsk-walk/*.enrichment.json`), not
 * over shapes this lane invented — a fixture you wrote yourself is not evidence
 * about the wire.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  EDIT_GRAPH_NEGATIVE_REGEX,
  EDIT_GRAPH_POSITIVE_REGEX,
} from '../../../orchestrator/routing/edit-graph-intent-regex.js';
import { createRegistry } from '../../tools/registry.js';
import { selectLens } from '../lens-selector.js';
import { selectFragileEdge } from '../../coaching/select-fragile-edge.js';
import { fragileEdgeOfferSignals } from '../guidance-signals.js';
import { setTestSink, TelemetryEvents, VALID_EVENT_NAMES } from '../../../utils/telemetry.js';
import {
  buildLensSurface,
  composeFragileEdgeActionPrompt,
  composeFragileEdgeNaming,
  FRAGILE_EDGE_ACTION_LABEL,
  type BlockBuildCtx,
} from '../phase3-blocks.js';

type Enrichment = Record<string, unknown>;
type Row = Record<string, unknown>;

function loadCapture(file: string): Enrichment {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/dsk-walk/${file}`, import.meta.url), 'utf8'),
  ) as Enrichment;
}
const SESSION_A = loadCapture('session-a.enrichment.json');
const SESSION_B2 = loadCapture('session-b2.enrichment.json');

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function makeFact(enrichment: Enrichment, overrides: Row = {}): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-2989',
      leading_option_id: 'opt_leader',
      summary: 'Ran analysis.',
      graph_hash_at_run: 'gh_a1b2c3d4e5f60001',
      computed_at: '2026-08-05T00:00:00.000Z',
      // The ONE persisted verdict `mayNameLeadingOptionForFact` reads (schemas
      // 0.25.0 typed field). Present-and-permitting by default; the withheld
      // fixtures below override it. Absent ⇒ the reader FAILS CLOSED, so a
      // fixture without it would make every "did not fire" assertion here pass
      // for the wrong reason.
      constraint_verdict: { may_name_leading_option: true },
      enrichment,
      ...overrides,
    },
  } as unknown as RunAnalysisHandlerFact;
}

const GRAPH_HASH = 'gh_a1b2c3d4e5f60001';
const CTX: BlockBuildCtx = {
  created_at: '2026-08-09T12:00:00.000Z',
  graph_hash_at_generation: GRAPH_HASH,
};

interface SinkEvent {
  readonly event: string;
  readonly data: Record<string, unknown>;
}
let sink: SinkEvent[] = [];
beforeEach(() => {
  sink = [];
  setTestSink((event, data) => {
    sink.push({ event, data });
  });
});
afterEach(() => {
  setTestSink(null);
});
const eventsNamed = (name: string): SinkEvent[] => sink.filter((e) => e.event === name);

/**
 * THE TURN ON WHICH THE FRAGILE-EDGE LENS TAKES THE SLOT, derived rather than
 * assumed: the lens sits at the foot of the ladder, so it is selected when the
 * lenses above it are ineligible or displaced. On session-a that is the
 * `previousAnalysisLens: 'consider_opposite'` turn (the no-repeat alternate).
 */
const WINNING_PREV = 'consider_opposite' as const;

// ============================================================================
// 0. TELEMETRY NAME VALIDATION — load-bearing. The CI telemetry workflow only
//    inspects string-literal emit calls (a quoted name passed directly), so an
//    emit through
//    `TelemetryEvents.X` is guarded ONLY by this assertion.
// ============================================================================

describe('2.989 telemetry names are in the frozen registry', () => {
  it.each([
    ['V5FragileEdgeSelection', 'v5.capability.fragile_edge_selection'],
    ['V5FragileEdgeOfferEmitted', 'v5.capability.fragile_edge_offer_emitted'],
  ])('%s resolves to %s and is a VALID event name', (key, name) => {
    expect(TelemetryEvents[key as keyof typeof TelemetryEvents]).toBe(name);
    expect(VALID_EVENT_NAMES.has(name)).toBe(true);
  });
});

// ============================================================================
// 1. THE LENS IS REACHABLE — non-vacuity for everything below (trap 13)
// ============================================================================

describe('2.989 positive control — the harness can observe the lens winning the slot', () => {
  it('session-a selects fragile_edge_resolution on the no-repeat alternate turn', () => {
    const selection = selectLens(makeFact(SESSION_A), { previousAnalysisLens: WINNING_PREV });
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('fragile_edge_resolution');
    expect(selection!.rationaleCode).toBe('FRAGILE_EDGE_RESOLVABLE');
    expect(selection!.groundingField).toBe('robustness');
  });

  it('the selection carries the SAME edge the pure selector chose, by id', () => {
    const expected = selectFragileEdge(SESSION_A).selected!;
    const selection = selectLens(makeFact(SESSION_A), { previousAnalysisLens: WINNING_PREV })!;
    expect(selection.fragileEdge).toStrictEqual(expected);
  });

  it('no OTHER lens ever carries a fragileEdge payload (absence is the assertion)', () => {
    for (const prev of [null, 'sensitivity_flip_risk', 'pre_mortem'] as const) {
      for (const enrichment of [SESSION_A, SESSION_B2]) {
        const selection = selectLens(makeFact(enrichment), { previousAnalysisLens: prev });
        if (selection === null || selection.lens === 'fragile_edge_resolution') continue;
        expect(selection.fragileEdge).toBeUndefined();
      }
    }
  });

  it('threading the decision and letting the selector compute it agree exactly', () => {
    // The purity claim, pinned: `lens-history.ts`'s replay and
    // `ui-directive.ts` call `selectLens` WITHOUT the threaded decision.
    for (const enrichment of [SESSION_A, SESSION_B2]) {
      const fact = makeFact(enrichment);
      const threaded = selectLens(fact, {
        previousAnalysisLens: WINNING_PREV,
        fragileEdge: selectFragileEdge(enrichment),
      });
      const computed = selectLens(fact, { previousAnalysisLens: WINNING_PREV });
      expect(threaded).toStrictEqual(computed);
    }
  });

  it('an empty fragile_edges array ⇒ the lens never fires (honest empty, §9.2)', () => {
    const none = clone(SESSION_A);
    (none.robustness as Row).fragile_edges = [];
    const selection = selectLens(makeFact(none), { previousAnalysisLens: WINNING_PREV });
    // Some other lens may take the slot, or none may — what must NOT happen is
    // an offer about a relationship the run did not identify.
    expect(selection?.lens).not.toBe('fragile_edge_resolution');
  });
});

// ============================================================================
// 2. A1-T9 — THE ACCEPTANCE TEXT PASSES ROUTING. The discrimination is the point.
// ============================================================================

describe('A1-T9 the acceptance turn routes to edit_graph', () => {
  const prompt = composeFragileEdgeActionPrompt(
    'Partner Channel Investment',
    'Net New ARR Generated',
  );

  it('matches EDIT_GRAPH_POSITIVE_REGEX', () => {
    expect(EDIT_GRAPH_POSITIVE_REGEX.test(prompt)).toBe(true);
  });

  it('clears EDIT_GRAPH_NEGATIVE_REGEX', () => {
    expect(EDIT_GRAPH_NEGATIVE_REGEX.test(prompt)).toBe(false);
  });

  it('NEGATIVE CONTROL — a reliability QUESTION does not match the positive regex', () => {
    // The UI's existing fragile-edge CTA (`fragileDiscussDraft`) is a question
    // and must never mutate. If this ever starts matching, the discrimination
    // between "discuss" and "accept" has collapsed and the offer proves nothing.
    const question = 'Is the relationship between Partner Channel Investment and Net New ARR Generated reliable?';
    expect(EDIT_GRAPH_POSITIVE_REGEX.test(question)).toBe(false);
  });

  it('NEGATIVE CONTROL — the veto really does bite the tempting phrasings', () => {
    // Proves the negative gate is not vacuous: the obvious ways to write this
    // offer are exactly the ones it kills.
    for (const vetoed of [
      'Adjust the strength of the link that could flip the result.',
      'Adjust the strength of this link and tell me the new value.',
      'Adjust the strength of this link — explain what changes.',
    ]) {
      expect(EDIT_GRAPH_POSITIVE_REGEX.test(vetoed)).toBe(true);
      expect(EDIT_GRAPH_NEGATIVE_REGEX.test(vetoed)).toBe(true);
    }
  });

  it('the SHIPPED prompt is the one asserted — not a re-spelling of it', () => {
    const surface = buildLensSurface(makeFact(SESSION_A), CTX, WINNING_PREV)!;
    const edge = selectFragileEdge(SESSION_A).selected!;
    expect(surface.suggestion.action_prompt).toBe(
      composeFragileEdgeActionPrompt(edge.fromLabel, edge.toLabel),
    );
    expect(EDIT_GRAPH_POSITIVE_REGEX.test(surface.suggestion.action_prompt!)).toBe(true);
    expect(EDIT_GRAPH_NEGATIVE_REGEX.test(surface.suggestion.action_prompt!)).toBe(false);
  });
});

// ============================================================================
// 2b. CEE #883 — THE GATES ARE ENFORCED ON PRODUCER DATA, NOT JUST ASSERTED ON
//     THIS LANE'S OWN FIXTURE LABELS.
//
//     The assertions ABOVE are all bound to labels this lane chose, and every
//     one of them dispatches. That is precisely the shape trap 22 warns about:
//     a corpus from the author's head cannot see the class the author did not
//     imagine. The gates are evaluated by `route-v2.ts` over the WHOLE message,
//     and the message CONTAINS PRODUCER-AUTHORED ENDPOINT LABELS — so the veto
//     set (`flip`, `why`, `compare`, `describe`, `explain`, `show me`,
//     `tell me`, `set up`, `how does`) is reachable through ORDINARY STRATEGIC
//     VOCABULARY in a node label. Without a runtime check the block ships, the
//     lens wins, `scanProse` passes, the user accepts "Adjust this
//     relationship" — and the model does not change. An inert chip (2.770).
// ============================================================================

/**
 * Rewrite the SELECTED edge's labels on a clone, and return the mutated
 * capture. Bound BY IDENTITY (`from_id`/`to_id` of the edge the pure selector
 * actually chose), never by a value predicate another row could satisfy.
 */
function withSelectedEdgeLabels(from: string, to: string): Enrichment {
  const mutated = clone(SESSION_A);
  const chosen = selectFragileEdge(SESSION_A).selected!;
  const rows = (mutated.robustness as Row).fragile_edges as Row[];
  const target = rows.find((r) => r.from_id === chosen.fromId && r.to_id === chosen.toId)!;
  target.from_label = from;
  target.to_label = to;
  return mutated;
}

describe('CEE #883 — a label that vetoes dispatch produces NO offer', () => {
  // Each row names the VETO TOKEN it exercises, so this is not three spellings
  // of one case. All are plausible strategic node labels.
  it.each([
    ['flip', 'Partner Channel Investment', 'Flip Risk Threshold'],
    ['why', 'Why Customers Churn', 'Net New ARR Generated'],
    ['compare', 'Partner Channel Investment', 'Compare Group Uptake'],
    ['describe', 'Describe Brand Position', 'Net New ARR Generated'],
    ['show me', 'Show Me Dashboard Usage', 'Net New ARR Generated'],
    ['set up', 'Set Up Costs', 'Operating Margin'],
  ])(
    'veto token %s — the offer is withheld rather than shipped inert',
    (_token, fromLabel, toLabel) => {
      // ⭐ PRECONDITION PINNED IN-TEST (trap 13b). Without these two assertions
      // this case would pass identically if the fixture silently stopped
      // reproducing the condition — a guard agreeing with itself.
      const mutated = withSelectedEdgeLabels(fromLabel, toLabel);
      const chosen = selectFragileEdge(mutated).selected!;
      // (a) the mutation landed on the edge the selector actually picks
      expect([chosen.fromLabel, chosen.toLabel]).toStrictEqual([fromLabel, toLabel]);
      // (b) the prompt these labels compose really would be vetoed at route-v2
      const wouldShip = composeFragileEdgeActionPrompt(fromLabel, toLabel);
      expect(EDIT_GRAPH_POSITIVE_REGEX.test(wouldShip)).toBe(true);
      expect(EDIT_GRAPH_NEGATIVE_REGEX.test(wouldShip)).toBe(true);

      // THE ASSERTION. The lens exists only to carry the offer, so a withheld
      // offer drops the whole surface — never a card with an inert chip.
      expect(buildLensSurface(makeFact(mutated), CTX, WINNING_PREV)).toBeNull();
    },
  );

  it('POSITIVE CONTROL — a benign label still ships the offer', () => {
    // Discriminates "the check withholds on a veto" from "the check withholds".
    // Without this row, deleting the offer entirely would score a clean sweep.
    const from = 'Channel Partner Momentum';
    const to = 'Quarterly Retention Rate';
    const mutated = withSelectedEdgeLabels(from, to);
    const chosen = selectFragileEdge(mutated).selected!;
    expect([chosen.fromLabel, chosen.toLabel]).toStrictEqual([from, to]);

    const surface = buildLensSurface(makeFact(mutated), CTX, WINNING_PREV);
    expect(surface).not.toBeNull();
    expect(surface!.selection.lens).toBe('fragile_edge_resolution');
    expect(surface!.suggestion.action_prompt).toBe(composeFragileEdgeActionPrompt(from, to));
    expect(surface!.suggestion.action_label).toBe(FRAGILE_EDGE_ACTION_LABEL);
  });

  it('EVERY real label pair in BOTH committed captures dispatches (derived)', () => {
    // The reason the defect shipped: on real producer data the gate is
    // currently always satisfied, so nothing in the captures could reveal it.
    // Recorded as a DERIVED census rather than a hand-listed expectation — if a
    // future capture carries a veto-word label this goes RED and the withheld
    // path becomes observable on real data instead of only on a mutation.
    const pairs: string[] = [];
    for (const capture of [SESSION_A, SESSION_B2]) {
      const rows = ((capture.robustness as Row)?.fragile_edges as Row[]) ?? [];
      for (const r of rows) {
        pairs.push(composeFragileEdgeActionPrompt(String(r.from_label), String(r.to_label)));
      }
    }
    expect(pairs.length).toBe(18);
    for (const p of pairs) {
      expect(EDIT_GRAPH_POSITIVE_REGEX.test(p)).toBe(true);
      expect(EDIT_GRAPH_NEGATIVE_REGEX.test(p)).toBe(false);
    }
  });

  it('WHY THE POSITIVE CONJUNCT SURVIVES MUTATION — demonstrated, not asserted', () => {
    // ⚠ HONEST DISCLOSURE, measured (CEE #883): deleting the POSITIVE conjunct
    // from `buildFragileEdgeOffer` leaves this whole file GREEN (42/42), while
    // deleting the NEGATIVE conjunct turns 6 cases RED. That survivor is a claim
    // either way, so it is DEMONSTRATED here rather than left unexplained.
    //
    // THE CAUSE: the positive verb "Adjust" comes from the TEMPLATE, not from
    // producer data — so NO endpoint label can defeat the positive gate, and no
    // label-driven fixture can reach that branch. The conjunct is a
    // TEMPLATE-DRIFT guard (reword the sentence without an edit verb and it
    // bites), not a label guard. Keeping it is the fail-closed reading of the
    // dispatch condition `route-v2.ts` actually evaluates; pretending a label
    // test covers it would be the vacuity this file exists to avoid.
    expect(EDIT_GRAPH_POSITIVE_REGEX.test(composeFragileEdgeActionPrompt('', ''))).toBe(true);
    // …and the labels contribute nothing to that verdict:
    expect(EDIT_GRAPH_POSITIVE_REGEX.test('Partner Channel Investment')).toBe(false);
    expect(EDIT_GRAPH_POSITIVE_REGEX.test('Net New ARR Generated')).toBe(false);
  });

  it('THE CHECKED STRING IS THE SHIPPED STRING — no truncation can re-cut it', () => {
    // The runtime check runs on the COMPOSED prompt; the block ships
    // `truncate(prompt, ACTION_PROMPT_MAX)`. Those are the same string only
    // because the naming guard (BODY_MAX) bounds the labels first. Pinned
    // behaviourally at the boundary, because raising BODY_MAX or lowering
    // ACTION_PROMPT_MAX would silently break it — and a truncation can re-cut a
    // word into a veto token ("Flipper" → "Flip").
    const half = 'A'.repeat(112);
    const other = 'B'.repeat(112);
    const naming = composeFragileEdgeNaming(half, other);
    expect(naming.length).toBe(300); // exactly BODY_MAX — the widest pair allowed
    const surface = buildLensSurface(makeFact(withSelectedEdgeLabels(half, other)), CTX, WINNING_PREV);
    expect(surface).not.toBeNull();
    expect(surface!.suggestion.action_prompt).toBe(composeFragileEdgeActionPrompt(half, other));
    expect(surface!.suggestion.action_prompt).not.toContain('…');
  });
});

// ============================================================================
// 3. A1-T8 — THE OFFER IS DERIVED FROM REAL CAPABILITY (2.770)
// ============================================================================

describe('A1-T8 the offer points at a REGISTERED executor', () => {
  it('adjust_edge_strength is present in the live handler registry (derived, not listed)', () => {
    const registry = createRegistry({ counterfactualClient: null });
    // Derived from the registry itself — a hand-listed expectation here would be
    // the mirror this assertion exists to prevent.
    expect([...registry.keys()]).toContain('adjust_edge_strength');
    expect(registry.get('adjust_edge_strength')).toBeTypeOf('function');
  });

  it('the offer carries a label and a dispatching prompt, and NO action_intent', () => {
    const surface = buildLensSurface(makeFact(SESSION_A), CTX, WINNING_PREV)!;
    expect(surface.suggestion.action_label).toBe(FRAGILE_EDGE_ACTION_LABEL);
    expect(surface.suggestion.action_prompt).toBeTruthy();
    // Derived ruling: `ActionIntentLiteral` has no edge-mutation member, and the
    // deployed UI never dispatches the field. Stating `edit_factor` about an
    // EDGE would be a wrong object on a producer-owned field.
    expect(surface.suggestion.action_intent).toBeUndefined();
  });

  it('MUTANT — a lens with no offer emits neither action field', () => {
    // Discriminates "the block always carries an action" from "the OFFER does".
    const surface = buildLensSurface(makeFact(SESSION_B2), CTX, null)!;
    expect(surface.selection.lens).not.toBe('fragile_edge_resolution');
    expect(surface.suggestion.action_label).toBeUndefined();
    expect(surface.suggestion.action_prompt).toBeUndefined();
    expect(surface.suggestion.target_refs).toStrictEqual([]);
  });
});

// ============================================================================
// 4. THE BLOCK — identity-bound target_refs, signal_code, prose safety
// ============================================================================

describe('2.989 the emitted coaching block', () => {
  const surface = buildLensSurface(makeFact(SESSION_A), CTX, WINNING_PREV)!;
  const edge = selectFragileEdge(SESSION_A).selected!;

  it('carries the EDGE identity as a target_ref, bound by id', () => {
    expect(surface.suggestion.target_refs).toHaveLength(1);
    const ref = surface.suggestion.target_refs[0]!;
    expect(ref.kind).toBe('edge');
    expect(ref.id).toBe(`${edge.fromId}→${edge.toId}`);
    expect(ref.label).toBe(`${edge.fromLabel} → ${edge.toLabel}`);
  });

  it('A1-T10 the target_ref id is the composite the edge handler parses', () => {
    const ref = surface.suggestion.target_refs[0]!;
    // `parseEdgeId` accepts `→` or `->` and REJECTS `::`. Asserted against the
    // shape rather than by importing the handler (Lane B owns that file).
    expect(ref.id).toContain('→');
    expect(ref.id).not.toContain('::');
    expect(ref.id.split('→')).toStrictEqual([edge.fromId, edge.toId]);
  });

  it('names BOTH endpoint labels in the body, and names them BEFORE the generic tail', () => {
    expect(surface.suggestion.body).toContain(edge.fromLabel);
    expect(surface.suggestion.body).toContain(edge.toLabel);
    // Ordering is load-bearing: the body is truncated at BODY_MAX, so a naming
    // sentence placed last is the first thing truncation eats. Measured — the
    // naming-last draft silently dropped the second label on this very capture.
    expect(surface.suggestion.body.indexOf(edge.toLabel)).toBeLessThan(
      surface.suggestion.body.indexOf('highest-value'),
    );
  });

  it('FAIL-CLOSED — endpoint labels too long to name in full produce NO offer', () => {
    const longLabels = clone(SESSION_A);
    const rows = (longLabels.robustness as Row).fragile_edges as Row[];
    const target = rows.find((r) => r.from_id === edge.fromId && r.to_id === edge.toId)!;
    target.from_label = 'A'.repeat(200);
    target.to_label = 'B'.repeat(200);
    const surfaceLong = buildLensSurface(makeFact(longLabels), CTX, WINNING_PREV);
    // Either no surface at all, or a surface for some OTHER lens — what must
    // never happen is a truncated card that names half a relationship and still
    // carries an action chip.
    expect(surfaceLong?.selection.lens).not.toBe('fragile_edge_resolution');
  });

  it('carries FRAGILE_RESULT as its signal_code, not the generic strengthen code', () => {
    expect(surface.suggestion.signal_code).toBe('FRAGILE_RESULT');
    expect(surface.suggestion.signal_code).toBe(fragileEdgeOfferSignals().signal_code);
    // The category/priority still derive from the coaching kind.
    expect(surface.suggestion.coaching_kind).toBe('strengthen');
    expect(surface.suggestion.category).toBe('could_fix');
  });

  it('SHIPS NO NUMBER — the ruling, pinned across every prose field', () => {
    for (const field of [
      surface.suggestion.title,
      surface.suggestion.body,
      surface.suggestion.action_label,
      surface.suggestion.action_prompt,
    ]) {
      expect(field).toBeTruthy();
      expect(field!).not.toMatch(/\d/);
    }
  });

  it('names no raw entity id in prose (ids ride target_refs only)', () => {
    for (const field of [surface.suggestion.body, surface.suggestion.action_prompt]) {
      expect(field!).not.toContain(edge.fromId);
      expect(field!).not.toContain(edge.toId);
    }
  });

  it('FAIL-CLOSED — a label that trips the prose guard drops the whole block', () => {
    // Not a hypothetical: labels are producer data and are not sanitised here.
    // A half-honest block (offer shipped, leak inside) is the outcome this
    // prevents; NO block is the honest degradation.
    const leaky = clone(SESSION_A);
    const edges = (leaky.robustness as Row).fragile_edges as Row[];
    const target = edges.find((r) => r.from_id === edge.fromId && r.to_id === edge.toId)!;
    target.from_label = 'Conversion rate of 0.42';
    const surfaceLeaky = buildLensSurface(makeFact(leaky), CTX, WINNING_PREV);
    expect(surfaceLeaky).toBeNull();
  });
});

// ============================================================================
// 5. A1-T12 — THE WITHHELD ARM. Position, not a predicate.
// ============================================================================

describe('A1-T12 withheld runs + the two telemetry arms', () => {
  it('SELECTION telemetry fires with the SELECTED arm on a run that has an offer', () => {
    buildLensSurface(makeFact(SESSION_A), CTX, WINNING_PREV);
    const events = eventsNamed(TelemetryEvents.V5FragileEdgeSelection);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({
      rationale_code: 'FRAGILE_EDGE_RESOLVABLE',
      e_value_joined: true,
      stability_band: 'usable',
      refusal_reason: null,
    });
  });

  it('SELECTION telemetry fires with the REFUSED arm too — a refusal is an outcome', () => {
    // Keep only the degenerate head row: the decision refuses, and the reason
    // must be reported rather than the event simply not firing (a silent
    // non-event makes the refusal rate unmeasurable).
    const degenerateOnly = clone(SESSION_A);
    const robustness = degenerateOnly.robustness as Row;
    robustness.fragile_edges = [(robustness.fragile_edges as Row[])[0]!];
    buildLensSurface(makeFact(degenerateOnly), CTX, WINNING_PREV);
    const events = eventsNamed(TelemetryEvents.V5FragileEdgeSelection);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({
      refusal_reason: 'degenerate_stability_band',
      stability_band: 'degenerate',
      e_value_joined: true,
    });
  });

  it('SELECTION telemetry fires even when ANOTHER lens takes the slot', () => {
    // The decision is a property of the RUN, not of the lens race. Gating it on
    // the win would blind the refusal rate on exactly the turns another lens won.
    buildLensSurface(makeFact(SESSION_B2), CTX, null);
    expect(eventsNamed(TelemetryEvents.V5FragileEdgeSelection)).toHaveLength(1);
  });

  it('OFFER-EMITTED fires once on a PERMITTED turn, with a content-free payload', () => {
    buildLensSurface(makeFact(SESSION_A), CTX, WINNING_PREV);
    const events = eventsNamed(TelemetryEvents.V5FragileEdgeOfferEmitted);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toStrictEqual({
      action_intent: 'edit_graph',
      signal_code: fragileEdgeOfferSignals().signal_code,
      graph_hash_at_generation: GRAPH_HASH,
    });
    // NO user text, NO labels, NO ids — the payload discipline, asserted.
    const edge = selectFragileEdge(SESSION_A).selected!;
    const serialised = JSON.stringify(events[0]!.data);
    for (const leak of [edge.fromId, edge.toId, edge.fromLabel, edge.toLabel]) {
      expect(serialised).not.toContain(leak);
    }
    expect(serialised).not.toContain(String(edge.flipMean));
  });

  it('OFFER-EMITTED does NOT fire when NO offer was made (another lens took the slot)', () => {
    buildLensSurface(makeFact(SESSION_B2), CTX, null);
    expect(eventsNamed(TelemetryEvents.V5FragileEdgeOfferEmitted)).toHaveLength(0);
  });

  it('the offer rides `strengthen`, the kind compose drops wholesale on a withheld turn', () => {
    // The block is dropped by `compose.ts`'s `presumesLeadingOption`, which keys
    // on exactly this kind — so asserting the kind IS asserting the drop.
    const surface = buildLensSurface(makeFact(SESSION_A), CTX, WINNING_PREV)!;
    expect(surface.suggestion.coaching_kind).toBe('strengthen');
  });

  it('⭐ OFFER-EMITTED does NOT fire on a WITHHELD fact — no construction-vs-wire skew', () => {
    // The suggestion event over-reports by exactly the withheld rate (documented
    // skew). This one must not, or acceptance-vs-offer is silently wrong.
    const withheld = makeFact(SESSION_A, {
      leading_option_id: null,
      constraint_verdict: { may_name_leading_option: false },
    });
    buildLensSurface(withheld, CTX, WINNING_PREV);
    expect(eventsNamed(TelemetryEvents.V5FragileEdgeOfferEmitted)).toHaveLength(0);
    // POSITIVE CONTROL, in the same shape: the decision event still fired, so
    // the assertion above is about the GATE and not about a dead harness.
    expect(eventsNamed(TelemetryEvents.V5FragileEdgeSelection)).toHaveLength(1);
  });

  it('POSITIVE CONTROL for the withheld pair — the permitted twin DOES fire it', () => {
    buildLensSurface(makeFact(SESSION_A), CTX, WINNING_PREV);
    expect(eventsNamed(TelemetryEvents.V5FragileEdgeOfferEmitted)).toHaveLength(1);
  });
});

// ============================================================================
// 6. A1-T11 — ≤ ONE suggestion, and the ladder above is untouched
// ============================================================================

describe('A1-T11 frequency cap and locked order', () => {
  it('exactly ONE suggestion block per turn on every prev-lens state', () => {
    for (const enrichment of [SESSION_A, SESSION_B2]) {
      for (const prev of [
        null,
        'sensitivity_flip_risk',
        'pre_mortem',
        'evpi_evidence_priority',
        'consider_opposite',
        'devils_advocacy',
      ] as const) {
        const surface = buildLensSurface(makeFact(enrichment), CTX, prev);
        // A surface is one block or nothing — never two.
        expect(surface === null || typeof surface.suggestion.block_id === 'string').toBe(true);
      }
    }
  });

  it('the three LOCKED CORE lenses still head their own shapes', () => {
    // session-b2's isolated flip hit does not yield, so the core head stands
    // exactly as before this lens existed.
    expect(selectLens(makeFact(SESSION_B2), { previousAnalysisLens: null })!.lens).toBe(
      'sensitivity_flip_risk',
    );
    // session-a's decisive leader still goes to the disconfirmation exercise on
    // the head turn — the 2.490 partition is intact.
    expect(selectLens(makeFact(SESSION_A), { previousAnalysisLens: null })!.lens).toBe(
      'consider_opposite',
    );
  });
});
