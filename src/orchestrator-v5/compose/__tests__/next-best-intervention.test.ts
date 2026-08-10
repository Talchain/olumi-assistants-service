/**
 * ROADMAP 2.692 / 2.1024 — the NEXT-BEST-INTERVENTION selection architecture.
 *
 * Driven over the two COMMITTED LIVE CAPTURES
 * (`fixtures/dsk-walk/*.enrichment.json`) — the whole in-repo evidence base for
 * this seam. A fixture written from this lane's own head is not evidence about
 * the wire (CLAUDE.md trap 16-inverse), so every fixture below is a capture or a
 * NAMED single-field mutation of one, and the mutation is always to a field a
 * PRODUCER owns (an endpoint label, a row status), never to a shape this lane
 * invented.
 *
 * What is asserted, and why each assertion exists:
 *   §1 the ranked candidate list is EXPOSED (the selector no longer discards it)
 *   §2 tier order is the ONE ordering authority, and it is order-DRIVEN (mutating
 *      the constant changes the outcome — a tier table nothing reads is a mirror)
 *   §3 COMPOSABILITY is a selector-side eligibility predicate (row 2.1024): an
 *      offer that cannot be composed never becomes eligible, so the slot passes
 *      on instead of the whole turn going silent
 *   §4 the new `resolve_uncertainty` tier fires on ISL's noise-floor-GATED
 *      `p_win_sensitivity`, and stays silent when no row resolves
 *   §5 one derivation: `selectLens` IS `rankInterventions(...).chosen`
 *   §6 may-recommend-nothing survives, and is now OBSERVABLE
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  ALL_LENS_IDS,
  INTERVENTION_TIER_ORDER,
  tierForCandidate,
  type InterventionTier,
} from '../../coaching/intervention-tiers.js';
import { selectFragileEdge } from '../../coaching/select-fragile-edge.js';
import { selectUncertaintyPriority } from '../../coaching/uncertainty-priority.js';
import { rankInterventions, selectLens, type LensId } from '../lens-selector.js';
import { buildLensSurface, type BlockBuildCtx } from '../phase3-blocks.js';
import { setTestSink, TelemetryEvents } from '../../../utils/telemetry.js';

type Enrichment = Record<string, unknown>;

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

function makeFact(enrichment: Enrichment): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-2692',
      leading_option_id: 'opt_leader',
      summary: 'Ran analysis.',
      graph_hash_at_run: 'gh_2692000000000001',
      computed_at: '2026-08-10T00:00:00.000Z',
      constraint_verdict: { may_name_leading_option: true },
      enrichment,
    },
  } as unknown as RunAnalysisHandlerFact;
}

const CTX: BlockBuildCtx = {
  created_at: '2026-08-10T12:00:00.000Z',
  graph_hash_at_generation: 'gh_2692000000000001',
};

// DERIVED from the compile-exhaustive tier map (2.692 slice 2) — this was a
// hand-typed list of the seven then-existing lenses, i.e. exactly the mirror
// the census's own comment warns about: a new LensId would have silently
// shrunk "all previousAnalysisLens states" without a red anywhere.
const ALL_PREV: (LensId | null)[] = [null, ...ALL_LENS_IDS];

let sink: { event: string; data: Record<string, unknown> }[] = [];
beforeEach(() => {
  sink = [];
  setTestSink((event, data) => {
    sink.push({ event, data });
  });
});
afterEach(() => {
  setTestSink(null);
});

// ============================================================================
// §1 — the ranked list is EXPOSED, not discarded
// ============================================================================

describe('§1 rankInterventions exposes the whole ranked candidate list', () => {
  it('returns every eligible candidate in tier order, not just the head', () => {
    const ranking = rankInterventions(makeFact(clone(SESSION_A)));
    // Session-a is measured to fire at least sensitivity + consider_opposite +
    // fragile_edge_resolution, so a single-element list would mean the ranking
    // is still collapsing to a head.
    expect(ranking.candidates.length).toBeGreaterThan(1);
    // Producer-of-the-order assertion: the emitted order is the tier order.
    const tiers = ranking.candidates.map((c) => c.tier);
    const rank = (t: InterventionTier): number => INTERVENTION_TIER_ORDER.indexOf(t);
    for (let i = 1; i < tiers.length; i += 1) {
      expect(rank(tiers[i]!)).toBeGreaterThanOrEqual(rank(tiers[i - 1]!));
    }
  });

  it('records WHY each non-selected candidate lost, by identity', () => {
    const ranking = rankInterventions(makeFact(clone(SESSION_A)));
    expect(ranking.chosen).not.toBeNull();
    const chosen = ranking.chosen!.lens;
    for (const c of ranking.candidates) {
      if (c.lens === chosen) continue;
      // A closed reason, never a free string, and never absent.
      expect(['outranked', 'displaced_head', 'yielded']).toContain(c.notSelectedReason);
    }
  });

  it('records every INELIGIBLE candidate with a closed reason (a skip is an outcome)', () => {
    // what_if_counterfactual has a non-intrinsic executor; with availability not
    // injected it is ineligible, and that must be observable rather than absent.
    const ranking = rankInterventions(makeFact(clone(SESSION_B2)), {
      executorAvailable: { what_if_counterfactual: false },
    });
    const whatIf = ranking.ineligible.find((c) => c.lens === 'what_if_counterfactual');
    expect(whatIf?.reason).toBe('executor_unavailable');
  });
});

// ============================================================================
// §2 — the tier table is the ordering authority AND is order-DRIVEN
// ============================================================================

describe('§2 tier order is the single ordering authority', () => {
  it('assigns every LensId a tier that is a member of the declared order', () => {
    const lenses: LensId[] = [
      'sensitivity_flip_risk',
      'pre_mortem',
      'evpi_evidence_priority',
      'fragile_edge_resolution',
      'consider_opposite',
      'devils_advocacy',
      'what_if_counterfactual',
    ];
    for (const lens of lenses) {
      expect(INTERVENTION_TIER_ORDER).toContain(tierForCandidate(lens));
    }
  });

  it('⛔ resolve_uncertainty is MEMBERLESS BY RULING, and stays that way', () => {
    // Someone WILL try to populate this tier — an empty slot reads as an
    // oversight. It is not: a lens for it was built, measured, and removed
    // before merge because ISL's user-facing-language ban is LIVE and its
    // gating condition ("pending doctrine") is unmet — the shipped constant at
    // ISL `staging` 28fe0c95 is still `provisional_doctrine_v0`. Populating it
    // without clearing that gate ships user-facing scientific copy past a live
    // ban. Read `coaching/uncertainty-priority.ts` first; the gate and the
    // re-add checklist are in its header.
    const lenses: LensId[] = [
      'sensitivity_flip_risk',
      'pre_mortem',
      'evpi_evidence_priority',
      'consider_opposite',
      'devils_advocacy',
      'fragile_edge_resolution',
      'what_if_counterfactual',
    ];
    expect(lenses.filter((l) => tierForCandidate(l) === 'resolve_uncertainty')).toStrictEqual([]);
    // The tier is DECLARED, not deleted — the extension point is real, and the
    // band it holds (below the locked core three, above the DSK pair) is the one
    // 2.690 §B.3 / 2.692 §2.2 ratified, so a re-add lands where it was measured.
    const rank = (t: InterventionTier): number => INTERVENTION_TIER_ORDER.indexOf(t);
    expect(INTERVENTION_TIER_ORDER).toContain('resolve_uncertainty');
    for (const core of ['sensitivity_flip_risk', 'pre_mortem', 'evpi_evidence_priority'] as const) {
      expect(rank(tierForCandidate(core))).toBeLessThan(rank('resolve_uncertainty'));
    }
    for (const below of ['consider_opposite', 'devils_advocacy'] as const) {
      expect(rank('resolve_uncertainty')).toBeLessThan(rank(tierForCandidate(below)));
    }
  });

  it('is BYTE-IDENTICAL to the locked ladder when restricted to the seven pre-existing lenses', () => {
    // The load-bearing safety property of the shipped permutation: this tier
    // order REORDERS NOTHING. Every 2.211 / 2.211-① / 2.490 pin therefore holds
    // by construction rather than by luck, and the census below shows the cost.
    const ladder: LensId[] = [
      'sensitivity_flip_risk',
      'pre_mortem',
      'evpi_evidence_priority',
      'consider_opposite',
      'devils_advocacy',
      'fragile_edge_resolution',
      'what_if_counterfactual',
    ];
    const byTier = [...ladder].sort(
      (a, b) =>
        INTERVENTION_TIER_ORDER.indexOf(tierForCandidate(a)) -
        INTERVENTION_TIER_ORDER.indexOf(tierForCandidate(b)),
    );
    expect(byTier).toStrictEqual(ladder);
  });
});

// ============================================================================
// §2b — THE REACHABILITY CENSUS, RECORDED RATHER THAN ASSERTED AWAY
// ============================================================================

describe('§2b reachability census over the whole in-repo evidence base', () => {
  /**
   * ⚠ THIS TEST RECORDS A DARK CAPABILITY. It is not a pass mark.
   *
   * At the RATIFIED band the new tier wins ZERO cells: `sensitivity_flip_risk`
   * heads session-b2 on an ISOLATED door (which 2.211-① says never yields) and
   * the one displacement cell is claimed by 2.490's sequence rule. Shipping it
   * higher was MEASURED and starves `pre_mortem`, `devils_advocacy` and
   * `fragile_edge_resolution` on the same capture — 2.490's starvation swap.
   *
   * The number is pinned so that (a) it cannot be forgotten, and (b) any
   * permutation of INTERVENTION_TIER_ORDER RE-MEASURES it instead of being
   * argued about. A structurally-dark outcome is an escalation with a corrected
   * premise, never a silent ship.
   */
  it('records how many cells each lens wins (the escalation, in numbers)', () => {
    const wins = new Map<string, number>();
    let cells = 0;
    for (const capture of [SESSION_A, SESSION_B2]) {
      for (const prev of ALL_PREV) {
        cells += 1;
        const sel = selectLens(makeFact(clone(capture)), { previousAnalysisLens: prev });
        const key = sel?.lens ?? 'NONE';
        wins.set(key, (wins.get(key) ?? 0) + 1);
      }
    }
    // 2 captures x 8 previousAnalysisLens states (the seven LensIds + null).
    // DERIVED, not a hand-typed constant: it must track ALL_PREV, so removing a
    // lens moves it and a stale number goes RED instead of quietly shrinking the
    // census — the "a new spec collecting zero is invisible to every aggregate"
    // failure, one level down.
    expect(cells).toBe(2 * ALL_PREV.length);
    // The derivation is STILL LIVE on session-b2 — it is the CONSUMER that was
    // removed, not the signal. Pinned so the re-add has a measured starting
    // point and so "there was nothing to show anyway" cannot be claimed later.
    expect(selectUncertaintyPriority(clone(SESSION_B2)).selected?.factorId).toBe('fac_energy');
    // And the pins the safe permutation protects: both DSK exercises and the
    // fragile-edge offer remain reachable, exactly as before this change.
    expect(wins.get('consider_opposite') ?? 0).toBeGreaterThan(0);
    expect(wins.get('devils_advocacy') ?? 0).toBeGreaterThan(0);
    expect(wins.get('fragile_edge_resolution') ?? 0).toBeGreaterThan(0);
  });
});

// ============================================================================
// §3 — ROW 2.1024: composability is an ELIGIBILITY predicate
// ============================================================================

/**
 * The capture, with ONE producer-owned field changed: the selected fragile
 * edge's `to_label`. "Why Customers Churn" is an ordinary strategic label and
 * it contains `why`, which is in `EDIT_GRAPH_NEGATIVE_REGEX` — so the composed
 * acceptance turn would be VETOED at `route-v2` and the chip would be inert.
 * The label is not this lane's invention of a defect: it is the exact class
 * `buildFragileEdgeOffer`'s own third fail-closed was written for.
 */
function sessionAWithEdgeLabel(toLabel: string): Enrichment {
  const e = clone(SESSION_A);
  // Locate the row the SELECTOR actually picked, never a hard-coded index: the
  // producer's first fragile edge is NOT the selected one on this capture
  // (index 2 is), and an index would silently stop mutating the object under
  // test the moment the producer's order moved — a fixture that has quietly
  // stopped reproducing its target still passes every assertion (trap 13b).
  const before = selectFragileEdge(e);
  const target = before.selected;
  if (target === null) throw new Error('fixture precondition: session-a must select a fragile edge');
  const rows = (e.robustness as Record<string, unknown>)
    .fragile_edges as Record<string, unknown>[];
  const row = rows.find(
    (r) => r.from_label === target.fromLabel && r.to_label === target.toLabel,
  );
  if (row === undefined) throw new Error('fixture precondition: selected edge row not found');
  row.to_label = toLabel;
  // PIN THE PRECONDITION IN-TEST: the mutation must still yield a SELECTED edge
  // carrying the new label, or the assertions below would be measuring a
  // refusal rather than a composability failure.
  const after = selectFragileEdge(e);
  if (after.selected?.toLabel !== toLabel) {
    throw new Error('fixture precondition: mutated label did not reach the selection');
  }
  return e;
}

describe('§3 an uncomposable offer never becomes eligible (row 2.1024)', () => {
  // PRESENCE CONTROL FIRST (trap 13): prove the cell we are about to test is a
  // cell where the fragile-edge lens genuinely wins on the UNMUTATED capture.
  it('CONTROL: on the unmutated capture this cell selects fragile_edge_resolution', () => {
    const sel = selectLens(makeFact(clone(SESSION_A)), {
      previousAnalysisLens: 'consider_opposite',
    });
    expect(sel?.lens).toBe('fragile_edge_resolution');
  });

  it('passes the slot to another intervention instead of dropping the whole card', () => {
    const fact = makeFact(sessionAWithEdgeLabel('Why Customers Churn'));
    const surface = buildLensSurface(fact, CTX, 'consider_opposite');
    // Pristine behaviour: `buildFragileEdgeOffer` returns null and
    // `buildLensSurface` drops the ENTIRE coaching card — the turn goes silent.
    expect(surface).not.toBeNull();
    expect(surface!.selection.lens).not.toBe('fragile_edge_resolution');
  });

  it('marks the uncomposable candidate INELIGIBLE with its own closed reason', () => {
    const ranking = rankInterventions(makeFact(sessionAWithEdgeLabel('Why Customers Churn')), {
      previousAnalysisLens: 'consider_opposite',
    });
    const fe = ranking.ineligible.find((c) => c.lens === 'fragile_edge_resolution');
    expect(fe?.reason).toBe('offer_not_composable');
    expect(ranking.candidates.some((c) => c.lens === 'fragile_edge_resolution')).toBe(false);
  });

  it('DISCRIMINATING PAIR: a label that trips no gate stays eligible', () => {
    // Break-for-a-DIFFERENT-object control (trap 19): the same mutation site,
    // a label that does NOT contain a veto token, must leave the candidate
    // eligible — so the predicate is bound to the GATE, not to "any mutation".
    const e = sessionAWithEdgeLabel('Customer Retention Rate');
    const ranking = rankInterventions(makeFact(e), {
      previousAnalysisLens: 'consider_opposite',
    });
    expect(ranking.candidates.some((c) => c.lens === 'fragile_edge_resolution')).toBe(true);
  });
});

// ============================================================================
// §4 — the new statistically-gated uncertainty tier
// ============================================================================

describe('§4 the uncertainty derivation (live, unwired — its lens is ruling-blocked)', () => {
  it('MEASURED: session-b2 carries exactly one resolved p_win_sensitivity row', () => {
    // Pins the fixture's own precondition in-test (trap 13b third face), so the
    // assertions below are provably the code's doing and not the fixture's.
    const rows = SESSION_B2.p_win_sensitivity as { status?: string }[];
    expect(rows.filter((r) => r.status === 'resolved')).toHaveLength(1);
    const aRows = SESSION_A.p_win_sensitivity as { status?: string }[];
    expect(aRows.filter((r) => r.status === 'resolved')).toHaveLength(0);
  });

  it('binds the resolved factor BY IDENTITY, and no lens consumes it', () => {
    // ⛔ The consumer was removed on a science ruling; the DERIVATION is
    // untouched and still correct. Asserted directly against the reader so the
    // work is protected while it waits, and so a re-add starts from a green,
    // identity-bound base rather than from scratch.
    expect(selectUncertaintyPriority(clone(SESSION_B2)).selected?.factorId).toBe('fac_energy');
    const ranking = rankInterventions(makeFact(clone(SESSION_B2)), { previousAnalysisLens: null });
    const all = [...ranking.candidates.map((c) => c.lens), ...ranking.ineligible.map((c) => c.lens)];
    expect(all).not.toContain('uncertainty_reduction_priority' as unknown as LensId);
  });

  it('DISCRIMINATING PAIR: demote only THIS row and it refuses; demote another and it still fires', () => {
    // Break-for-the-named-object → refusal; break-for-a-different-object →
    // unchanged. Neither alone shows binding; the pair does (trap 19).
    const demoteHead = clone(SESSION_B2);
    (demoteHead.p_win_sensitivity as Record<string, unknown>[])[0]!.status = 'below_resolution';
    expect(selectUncertaintyPriority(demoteHead).selected).toBeNull();

    const demoteOther = clone(SESSION_B2);
    (demoteOther.p_win_sensitivity as Record<string, unknown>[])[1]!.status = 'below_resolution';
    expect(selectUncertaintyPriority(demoteOther).selected?.factorId).toBe('fac_energy');
  });

  it('names a SUPPRESSED attribution apart from a quiet run', () => {
    // ISL suppresses this attribution entirely when correlation is active and
    // says so in `correlation_model.suppressed_attributions`. Collapsing that
    // into "nothing to resolve" would report a suppression as a clean run.
    const e = clone(SESSION_B2);
    delete (e as Record<string, unknown>).p_win_sensitivity;
    (e as Record<string, unknown>).correlation_model = {
      suppressed_attributions: ['p_win_sensitivity'],
    };
    expect(selectUncertaintyPriority(e).refusalReason).toBe('suppressed_under_correlation');

    const quiet = clone(SESSION_B2);
    delete (quiet as Record<string, unknown>).p_win_sensitivity;
    expect(selectUncertaintyPriority(quiet).refusalReason).toBe('no_p_win_sensitivity');
  });

  it('stays SILENT on a capture where every row is below resolution', () => {
    const decision = selectUncertaintyPriority(clone(SESSION_A));
    expect(decision.selected).toBeNull();
    expect(decision.refusalReason).toBe('no_resolved_row');
    expect(selectUncertaintyPriority(clone(SESSION_A)).selected).toBeNull();
  });

  it('consumes the PRODUCER order and never re-ranks it', () => {
    // Two resolved rows, producer order preserved: the head is the producer's
    // FIRST resolved row even when a later row carries a larger magnitude.
    const e = clone(SESSION_B2);
    const rows = e.p_win_sensitivity as Record<string, unknown>[];
    rows[1]!.status = 'resolved';
    rows[1]!.p_win_delta_percentage_points = 99;
    const decision = selectUncertaintyPriority(e);
    expect(decision.selected?.factorId).toBe(rows[0]!.factor_id);
  });

  it('carries NO magnitude out of the module (the V7C magnitude ban)', () => {
    const decision = selectUncertaintyPriority(clone(SESSION_B2));
    const json = JSON.stringify(decision.selected);
    expect(json).not.toContain('3.48');
    expect(json).not.toContain('p_win_delta');
  });
});

// ============================================================================
// §5 — one derivation
// ============================================================================

describe('§5 selectLens IS the ranking head', () => {
  for (const [name, capture] of [
    ['session-a', SESSION_A],
    ['session-b2', SESSION_B2],
  ] as const) {
    it(`agrees with rankInterventions on every previousAnalysisLens state (${name})`, () => {
      for (const prev of ALL_PREV) {
        const fact = makeFact(clone(capture));
        const opts = { previousAnalysisLens: prev };
        expect(selectLens(fact, opts)).toStrictEqual(rankInterventions(fact, opts).chosen);
      }
    });
  }
});

// ============================================================================
// §6 — may-recommend-nothing survives, and is observable
// ============================================================================

describe('§6 recommending nothing is still a first-class outcome', () => {
  it('returns null with an empty candidate list on an empty enrichment', () => {
    const ranking = rankInterventions(makeFact({}));
    expect(ranking.chosen).toBeNull();
    expect(ranking.candidates).toStrictEqual([]);
  });

  it('EMITS the race outcome when nothing is recommended (the silent-turn alarm)', () => {
    sink = [];
    expect(buildLensSurface(makeFact({}), CTX, null)).toBeNull();
    const outcome = sink.find((e) => e.event === TelemetryEvents.V5LensRaceOutcome);
    expect(outcome).toBeDefined();
    expect(outcome!.data.outcome).toBe('no_recommendation');
    expect(outcome!.data.eligible_count).toBe(0);
    expect(outcome!.data.graph_hash_at_generation).toBe(CTX.graph_hash_at_generation);
  });

  it('carries the CLOSED reasons that answer "why did nothing surface?"', () => {
    sink = [];
    // A real capture with every trigger present, but the run stripped of the
    // signals each lens needs — so the reasons are the producer's, not invented.
    buildLensSurface(makeFact({ factor_sensitivity: [] }), CTX, null);
    const outcome = sink.find((e) => e.event === TelemetryEvents.V5LensRaceOutcome);
    const reasons = outcome!.data.ineligible_reasons as string[];
    expect(reasons.length).toBeGreaterThan(0);
    for (const r of reasons) {
      expect([
        'trigger_not_fired',
        'executor_unavailable',
        'contraindicated_after_previous',
        'offer_not_composable',
      ]).toContain(r);
    }
    // Content-free: reason TAGS and counts only, never user text or a label.
    expect(JSON.stringify(outcome!.data)).not.toMatch(/[A-Z][a-z]+ [A-Z][a-z]+/);
  });

  it('does NOT fire on a turn that DID recommend something (a race with a winner is not a silent turn)', () => {
    sink = [];
    const surface = buildLensSurface(makeFact(clone(SESSION_A)), CTX, null);
    expect(surface).not.toBeNull();
    expect(sink.find((e) => e.event === TelemetryEvents.V5LensRaceOutcome)).toBeUndefined();
  });

  it('a turn that recommends nothing returns no surface', () => {
    // ⚠ THE OBSERVABILITY HALF OF THIS IS NOT CLOSED, AND IS NOT CLAIMED CLOSED.
    // `buildLensSurface` returning null fires NO lens telemetry, so
    // "this run had nothing honest to recommend" is still unobservable. Closing
    // it needs ONE new name in the frozen telemetry registry
    // (`v5.capability.lens_race_outcome`), which this lane does not own. Row
    // 2.1024's SILENT-TURN half that IS closed here is the uncomposable-offer
    // path (§3) — which no longer drops the card, so the turn is no longer
    // silent for that reason. Stated rather than implied: a test asserting the
    // absence of an event we have not minted would be theatre.
    expect(buildLensSurface(makeFact({}), CTX, null)).toBeNull();
  });
});
