/**
 * ⭐ A status quo exposed to an uncontrolled RISK is a real forecast, never "the reference moved" (DL lease, 22 Oct 2026).
 *
 * Served F2 (Track 2 witness, CEE 7249a567, captured in `tests/fixtures/track2-f2/`): "our key supplier has a 5–15% chance
 * of failing in the next 12 months, losing £8k a month; dual-sourcing cuts that by 70%". PLoT scored carrying on at
 * P(gross profit ≥ £12k) = 0.9135: at today's level (p50 = p90 = 0.8) except in the draws where the supplier fails. The
 * licence read that as a paired status quo whose row "moved" (`statusQuoReadingOf`: a paired chance strictly between 0 and
 * 1) and withheld it as `reference_moved`, so the person saw "Chance not shown yet" for carrying on while the engine had
 * the number.
 *
 * The same-draw reference cancels every link's spread for the status quo, but not a risk EVENT drawn on its own: a goal a
 * risk node reaches is not paired, so carrying on's chance is the Run's, shown like any option's. Genuinely paired goals
 * (no risk on the path) keep the D2 exact-equality check and `reference_moved` (`batch-d-status-quo-frame.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceLicenceOf } from '../goal-chance-licence.js';

type Rec = Record<string, unknown>;
const FX = JSON.parse(readFileSync('tests/fixtures/track2-f2/served-f2-supplier-risk-20261021T222244Z.json', 'utf8')) as {
  envelope: Rec; graph: Rec; served_view: Rec };
const GOAL = 'gross_profit_floor';
const SQ = 'carry_on';
const DUAL = 'dual_source';

/** The envelope as the licence reads it, before transport: the served licence (this code's output) removed. */
const runEnvelope = (): Rec => {
  const env = structuredClone(FX.envelope);
  env.inference_warnings = (env.inference_warnings as Rec[]).filter((w) => w.code !== 'GOAL_CHANCE_LICENSED');
  return env;
};
const licence = (graph: Rec = FX.graph) => goalChanceLicenceOf(runEnvelope(), graph, GOAL, () => false, undefined, graph, {});
const reasonOf = (l: ReturnType<typeof licence>): Rec | undefined =>
  (l?.withheld_reason_by_option as Record<string, Rec> | undefined)?.[SQ];

describe('F2 (served): a status quo a supplier-failure risk reaches is a forecast, not a moved reference', () => {
  it('precondition: the engine scored both options; the served view withheld carrying on as reference_moved', () => {
    const rows = FX.envelope.option_comparison as Rec[];
    expect(rows.find((r) => r.option_id === SQ)).toMatchObject({ status: 'computed', probability_of_goal: 0.9135 });
    expect(rows.find((r) => r.option_id === DUAL)).toMatchObject({ status: 'computed', probability_of_goal: 0.9731 });
    const sq = (FX.served_view.options as Rec[]).find((o) => o.option_id === SQ)!;
    expect(sq.cell).toMatchObject({ kind: 'withheld', reasons: [{ code: 'reference_moved' }] });
    // The risk reaches the goal, and no option sets the risk itself.
    const nodes = FX.graph.nodes as Rec[];
    expect(nodes.find((n) => n.id === 'supplier_failure')).toMatchObject({ kind: 'risk' });
    expect((FX.graph.edges as Rec[]).some((e) => e.from === 'supplier_failure' && e.to === GOAL)).toBe(true);
  });

  it('RED → GREEN: carrying on gets its chance (about 91%), never withheld as reference_moved, never "by assumption"', () => {
    const l = licence();
    expect(l).not.toBeNull();
    expect(reasonOf(l)?.reason).not.toBe('reference_moved');
    // Nothing is withheld: the licence carries no withheld list at all, and both chances are present.
    expect(l!.withheld_option_ids ?? []).not.toContain(SQ);
    expect(l!.withheld_reason_by_option).toBeUndefined();
    expect(l!.pct_by_option[SQ]).toBe(91);
    // No "unchanged from today" claim for a status quo that faces a risk.
    expect(l!.status_quo).toBeUndefined();
    // The other option is untouched.
    expect(l!.pct_by_option[DUAL]).toBe(97);
  });

  it('contrast: the same Run with the risk taken off the goal path reads as paired again (the D2 check still applies)', () => {
    const graph = structuredClone(FX.graph);
    graph.edges = (graph.edges as Rec[]).filter((e) => e.from !== 'supplier_failure');
    graph.nodes = (graph.nodes as Rec[]).filter((n) => n.id !== 'supplier_failure');
    const l = licence(graph);
    // A paired status quo whose recorded chance is strictly between 0 and 1 is a reference that moved: withheld, not shown.
    expect(reasonOf(l)?.reason).toBe('reference_moved');
    expect(l!.withheld_option_ids).toContain(SQ);
  });
});
