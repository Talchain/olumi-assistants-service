/**
 * CONVERGENT-DRIVER COACHING — one grounded next move on the turn where the
 * product currently ships a constant.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS PINS, AND WHY IT IS NOT A COPY CHANGE.
 *
 * `buildPostDraftNarrative` fills its "assumption" slot from a five-rung
 * priority chain whose terminal rung is `FIXED_GENERIC_ASSUMPTION`, a constant
 * that inspects nothing:
 *
 *   "One assumption worth checking is whether the model's key inputs reflect
 *    your real delivery constraints."
 *
 * ⚠ AND ON A NON-READY DRAFT THE CHAIN IS NOT RUN AT ALL. `post-draft-
 * narrative.ts` computes `mayServeFreeformCoaching = analysisReady?.status ===
 * 'ready'` and, when false, assigns that constant DIRECTLY — every LLM
 * coaching byte the pipeline produced is discarded unread. The file's own
 * measured note records 9 of 13 live draft turns on staging build `3427aea`
 * as non-ready, so the constant is the MAJORITY path, not an edge case.
 *
 * That gate is correct and is deliberately NOT touched here: it exists to keep
 * FREEFORM LLM PROSE off non-ready turns. The precedent for what may cross it
 * is already in the file — the direction-clarification bullets, which cross
 * because their copy "is composed deterministically ... from a fixed template"
 * and every candidate still passes `gateCoachingCardBody`. This rung is built
 * to exactly that standard: a fixed template over labels the model itself
 * carries, no LLM bytes read.
 *
 * ⭐ THE CLAIM IS BOUNDED BY WHAT THE EDGES ESTABLISH. The sentence is served
 * only when two DISTINCT non-option drivers have DIRECT edges into the same
 * factor with OPPOSITE settled signs. That is a property the drafted model
 * literally contains — the same standard `findOpposingFactorPair` was rebuilt
 * to meet after it asserted a trade-off between two costs that pushed the goal
 * the same way. Where the model does not settle it, this rung stays silent and
 * the existing chain is untouched.
 */
import { describe, it, expect } from 'vitest';
import { buildPostDraftNarrative } from '../post-draft-narrative.js';
import type { GraphV3T } from '../../../orchestrator/types.js';

const FIXED_GENERIC =
  "One assumption worth checking is whether the model's key inputs reflect your real delivery constraints.";
/** The bullet form the renderer produces from the constant above. */
const FIXED_GENERIC_BULLET =
  "Assumption to check: whether the model's key inputs reflect your real delivery constraints";

// ── The product owner's own decision, in the shape the drafter emits ────────
const GOAL = { id: 'g1', kind: 'goal' as const, label: 'Reach 20k MRR within 12 months' };
const OPT_RAISE = { id: 'o1', kind: 'option' as const, label: 'Raise the Pro plan price' };
const OPT_HOLD = { id: 'o2', kind: 'option' as const, label: 'Hold price, no feature push' };
const F_CHURN = { id: 'f1', kind: 'factor' as const, label: 'Pro Plan Churn Rate' };
const F_PRICE_RISK = { id: 'f2', kind: 'factor' as const, label: 'Price Risk' };
const F_FEATURE = { id: 'f3', kind: 'factor' as const, label: 'Feature Quality' };

function edge(
  from: string,
  to: string,
  effect: 'positive' | 'negative',
  existsProbability = 0.9,
) {
  return {
    from,
    to,
    strength: { mean: effect === 'positive' ? 0.5 : -0.5, std: 0.1 },
    exists_probability: existsProbability,
    effect_direction: effect,
  };
}

function graphOf(nodes: unknown[], edges: unknown[]): GraphV3T {
  return { nodes, edges } as unknown as GraphV3T;
}

/**
 * Churn is driven by Price Risk (up) and Feature Quality (down) — the
 * convergent, opposed pair. Options attach to Price Risk so the option layer
 * is present and realistic without being a driver of the contested factor.
 */
const CONVERGENT_GRAPH = graphOf(
  [GOAL, OPT_RAISE, OPT_HOLD, F_CHURN, F_PRICE_RISK, F_FEATURE],
  [
    edge('o1', 'f2', 'positive'),
    edge('o2', 'f2', 'negative'),
    edge('f2', 'f1', 'positive'),
    edge('f3', 'f1', 'negative'),
    edge('f1', 'g1', 'negative'),
  ],
);

/** A non-ready payload with a typed blocker, i.e. the owner's own turn. */
const NON_READY = {
  status: 'needs_user_input',
  blockers: [{ kind: 'option_effect_unset', option_id: 'o1' }],
} as const;

const READY = { status: 'ready' } as const;

function textOf(input: Parameters<typeof buildPostDraftNarrative>[0]): string {
  return buildPostDraftNarrative(input).text;
}

describe('convergent-driver coaching', () => {
  it('names both opposed drivers of the shared factor on a NON-READY draft, where the constant ships today', () => {
    const result = buildPostDraftNarrative({
      graph: CONVERGENT_GRAPH,
      analysisReady: NON_READY,
    });

    // The three labels the model itself carries.
    expect(result.text).toContain('Pro Plan Churn Rate');
    expect(result.text).toContain('Price Risk');
    expect(result.text).toContain('Feature Quality');
    // It states the opposition and asks the question that would change the model.
    expect(result.text).toMatch(/in opposite directions/i);
    expect(result.text).toMatch(/which of them dominates when they conflict\?/i);
    // And it REPLACES the constant rather than sitting beside it.
    expect(result.text).not.toContain(FIXED_GENERIC_BULLET);
    expect(result.telemetry.assumption_source).toBe('convergent_drivers');
  });

  it('stays silent when the two drivers push the shared factor the SAME way', () => {
    const sameWay = graphOf(
      [GOAL, OPT_RAISE, OPT_HOLD, F_CHURN, F_PRICE_RISK, F_FEATURE],
      [
        edge('o1', 'f2', 'positive'),
        edge('f2', 'f1', 'positive'),
        edge('f3', 'f1', 'positive'), // same direction — no tension to report
        edge('f1', 'g1', 'negative'),
      ],
    );
    const result = buildPostDraftNarrative({ graph: sameWay, analysisReady: NON_READY });

    expect(result.text).not.toMatch(/in opposite directions/i);
    expect(result.text).toContain(FIXED_GENERIC_BULLET);
    expect(result.telemetry.assumption_source).toBe('deterministic_fallback');
  });

  it('stays silent when an inbound edge carries exists_probability 0', () => {
    const nonExistent = graphOf(
      [GOAL, OPT_RAISE, OPT_HOLD, F_CHURN, F_PRICE_RISK, F_FEATURE],
      [
        edge('o1', 'f2', 'positive'),
        edge('f2', 'f1', 'positive'),
        edge('f3', 'f1', 'negative', 0), // the model says this link does not exist
        edge('f1', 'g1', 'negative'),
      ],
    );
    const result = buildPostDraftNarrative({ graph: nonExistent, analysisReady: NON_READY });

    expect(result.text).not.toMatch(/in opposite directions/i);
    expect(result.telemetry.assumption_source).toBe('deterministic_fallback');
  });

  it('never treats the OPTIONS as the opposed drivers, so comparing options is not reported as a conflict', () => {
    // Every option set pushes a shared factor both ways by construction. If
    // options counted as drivers this would fire on essentially every model
    // and say nothing.
    const optionsOnly = graphOf(
      [GOAL, OPT_RAISE, OPT_HOLD, F_CHURN],
      [
        edge('o1', 'f1', 'positive'),
        edge('o2', 'f1', 'negative'),
        edge('f1', 'g1', 'negative'),
      ],
    );
    const result = buildPostDraftNarrative({ graph: optionsOnly, analysisReady: NON_READY });

    expect(result.text).not.toMatch(/in opposite directions/i);
    expect(result.text).not.toMatch(/dominates when they conflict/i);
    expect(result.telemetry.assumption_source).toBe('deterministic_fallback');
  });

  it('does not repeat the pair the trade-off bullet already named for the goal', () => {
    // Price Risk and Feature Quality oppose ON THE GOAL directly, so the
    // trade-off bullet names them; the convergence bullet must not say the
    // same two names again one line below.
    const alsoOpposeOnGoal = graphOf(
      [GOAL, OPT_RAISE, OPT_HOLD, F_CHURN, F_PRICE_RISK, F_FEATURE],
      [
        edge('f2', 'f1', 'positive'),
        edge('f3', 'f1', 'negative'),
        edge('f2', 'g1', 'negative'),
        edge('f3', 'g1', 'positive'),
      ],
    );
    const result = buildPostDraftNarrative({ graph: alsoOpposeOnGoal, analysisReady: NON_READY });

    expect(result.text).toMatch(/balanced against/i);
    expect(result.text).not.toMatch(/dominates when they conflict/i);
    expect(result.telemetry.assumption_source).toBe('deterministic_fallback');
  });

  it('serves the convergence line ahead of the constant on a READY turn that produced no coaching', () => {
    const result = buildPostDraftNarrative({
      graph: CONVERGENT_GRAPH,
      analysisReady: READY,
      strengthenItems: [],
      coachingBiasSignals: [],
    });

    expect(result.text).toMatch(/which of them dominates when they conflict\?/i);
    expect(result.telemetry.assumption_source).toBe('convergent_drivers');
  });

  it('still yields to real LLM coaching on a ready turn — the rung sits BELOW the existing four', () => {
    const result = buildPostDraftNarrative({
      graph: CONVERGENT_GRAPH,
      analysisReady: READY,
      strengthenItems: [
        {
          id: 's1',
          label: 'Stress the churn estimate',
          detail: 'the churn estimate sits as a point value and would carry a range more honestly',
          action_type: 'add_constraint',
        },
      ],
    });

    expect(result.telemetry.assumption_source).toBe('strengthen_item_detail');
    expect(result.text).not.toMatch(/dominates when they conflict/i);
  });

  it('keeps the reply inside the word budget and free of shape talk and race framing', () => {
    const text = textOf({ graph: CONVERGENT_GRAPH, analysisReady: NON_READY });

    expect(text.trim().split(/\s+/).length).toBeLessThanOrEqual(140);
    // The copy gate's graph-shape lexicon.
    expect(text).not.toMatch(/\b(?:nodes?|edges?|graphs?)\b/i);
    // No race framing about options, in any of its ruled forms.
    expect(text).not.toMatch(/\b(?:winner|wins?|beats?|leads?|ahead|best option|recommend)\b/i);
    expect(text).not.toMatch(/—/);
  });

  /**
   * ⭐ THE GOAL GUARD IS NOT DEAD CODE, AND THIS FIXTURE IS WHY IT IS HERE.
   *
   * `goalId` is the id of the FIRST node of kind `goal`. A malformed graph can
   * carry a SECOND node with that same id and kind `factor` — and then the
   * target loop's `kind !== 'factor'` filter no longer excludes the goal.
   *
   * Measured with the guard deleted, on exactly this fixture: the reply gained
   *   "Worth resolving: Price Risk and Feature Quality both drive Reach 20k
   *    MRR, in opposite directions..."
   * one line under "Main trade-off: Support Load balanced against Feature
   * Quality" — two different trade-off claims about the same goal, in the same
   * section. The dedup guard does NOT catch it: `factorDirectionOnGoal` refuses
   * Price Risk a sign because an indirect path contradicts its direct edge, so
   * the trade-off bullet names a DIFFERENT pair and the sets do not match.
   *
   * That is the only shape in which this guard is reachable, so it is the only
   * shape that can prove it is doing work.
   */
  it('never makes the goal the target, even when a factor reuses the goal id', () => {
    const duplicateGoalId = graphOf(
      [
        { id: 'g1', kind: 'goal', label: 'Reach 20k MRR' },
        { id: 'g1', kind: 'factor', label: 'Reach 20k MRR' },
        F_PRICE_RISK,
        F_FEATURE,
        { id: 'f5', kind: 'factor', label: 'Support Load' },
        { id: 'f9', kind: 'factor', label: 'Referral Rate' },
      ],
      [
        edge('f2', 'g1', 'positive'),
        edge('f2', 'f9', 'positive'),
        edge('f9', 'g1', 'negative'),
        edge('f3', 'g1', 'negative'),
        edge('f5', 'g1', 'positive'),
      ],
    );
    const result = buildPostDraftNarrative({
      graph: duplicateGoalId,
      analysisReady: NON_READY,
    });

    // The trade-off bullet owns the goal, and keeps owning it alone.
    expect(result.text).toContain('Main trade-off: Support Load balanced against Feature Quality');
    expect(result.text).not.toMatch(/dominates when they conflict/i);
    expect(result.telemetry.assumption_source).toBe('deterministic_fallback');
  });

  it('is silent, not broken, on a graph with no edges at all', () => {
    const bare = graphOf([GOAL, OPT_RAISE, OPT_HOLD, F_CHURN], []);
    const result = buildPostDraftNarrative({ graph: bare, analysisReady: NON_READY });

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.telemetry.assumption_source).toBe('deterministic_fallback');
    expect(result.text).toContain(FIXED_GENERIC_BULLET);
  });
});

/** Guard the constant this rung is displacing is still the one in the file. */
describe('the constant this rung displaces', () => {
  it('is still the wording measured in the owner transcript', () => {
    const noEdges = graphOf([GOAL, OPT_RAISE, OPT_HOLD, F_CHURN], []);
    expect(textOf({ graph: noEdges, analysisReady: NON_READY })).toContain(
      FIXED_GENERIC_BULLET,
    );
    // FIXED_GENERIC_BULLET is the rendered form of FIXED_GENERIC; pin the
    // relationship so a reword of either constant reddens here.
    expect(FIXED_GENERIC).toBe(
      `${FIXED_GENERIC_BULLET.replace('Assumption to check: whether ', 'One assumption worth checking is whether ')}.`,
    );
  });
});
