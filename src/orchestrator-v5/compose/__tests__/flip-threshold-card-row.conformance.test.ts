/**
 * CONFORMANCE: the flip-threshold card's row predicate and body function are
 * the SAME ones the ContextPack display licence consults.
 *
 * WHY THIS FILE EXISTS. The licence in `context/analysis-signals.ts` says
 * "these digits are on the user's screen" and justifies it by reasoning about
 * what `buildReviewCardBlocks` emits. The first cut asserted that relationship
 * in prose and re-implemented the predicate — the reviewer reproduced two live
 * shapes (D1/D2) where the pack carried digits and zero cards shipped.
 *
 * The predicate now lives in ONE module both sides call, so drift is impossible
 * by construction.
 *
 * ⚠ WHAT THIS FILE DOES NOT DO, stated because an earlier draft of this header
 * claimed it did. It is NOT pinning a mirror between
 * `FLIP_THRESHOLD_CARD_BODY_MAX` and phase3-blocks' private `BODY_MAX`: there is
 * no such mirror, because the card builder calls `flipThresholdCardBody`, so
 * both sides read the same constant. Mutating that constant turns nothing red
 * here, and that is CORRECT — a shared value moving is not drift.
 *
 * What this file DOES pin is the reachable regression: that the emitted card and
 * the licence agree, asserted BEHAVIOURALLY against the real block. If anyone
 * reverts `buildFlipThresholdCards` to its own `truncate(narrative, BODY_MAX)`
 * and that limit then drifts, these assertions RED (mutant-checked).
 *
 * A control is included: if the shared body function stopped agreeing with the
 * emitted body, the boundary assertion must be able to SEE it (trap 13).
 */

import { describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  buildGraphNodeLookup,
  buildReviewCardBlocks,
  type BlockBuildCtx,
} from '../phase3-blocks.js';
import {
  FLIP_THRESHOLD_CARD_BODY_MAX,
  flipThresholdCardBody,
  readFlipThresholdCardRow,
  truncateCardProse,
} from '../flip-threshold-card-row.js';

const GRAPH_HASH = 'a'.repeat(64);
const CTX: BlockBuildCtx = {
  created_at: '2026-07-31T15:00:00.000Z',
  graph_hash_at_generation: GRAPH_HASH,
};

const FACTOR = { id: 'fac_marketing_budget', label: 'Marketing budget', kind: 'factor' };

function makeFact(flipRows: ReadonlyArray<Record<string, unknown>>): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-test',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        graph: { nodes: [FACTOR] },
        decision_review: { flip_thresholds: flipRows },
      },
      computed_at: '2026-07-31T14:59:00.000Z',
    },
  } as unknown as RunAnalysisHandlerFact;
}

function flipCards(rows: ReadonlyArray<Record<string, unknown>>) {
  const fact = makeFact(rows);
  return buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX).filter(
    (b) => b.card_kind === 'flip_threshold',
  );
}

const BASE_ROW = {
  factor_id: 'fac_marketing_budget',
  factor_label: 'Marketing budget',
  current_display: '40000 GBP',
  flip_display: '34500 GBP',
  narrative: 'If Marketing budget moves from 40000 GBP to 34500 GBP, the result changes.',
};

describe('the emitted card BODY is exactly what the licence checks', () => {
  it('short narrative: emitted body === flipThresholdCardBody(narrative)', () => {
    const cards = flipCards([BASE_ROW]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.body).toBe(flipThresholdCardBody(BASE_ROW.narrative));
  });

  it('OVER-LENGTH narrative: emitted body is still exactly the shared function', () => {
    const long = `${'Context sentence here. '.repeat(30)}Flips at 34500 GBP.`;
    expect(long.length).toBeGreaterThan(FLIP_THRESHOLD_CARD_BODY_MAX);
    const cards = flipCards([{ ...BASE_ROW, narrative: long }]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.body).toBe(flipThresholdCardBody(long));
    // The control for this whole file: the truncation must actually BITE here,
    // otherwise both sides agree only because neither cut anything.
    expect(cards[0]!.body).not.toBe(long);
    expect(cards[0]!.body.length).toBeLessThanOrEqual(FLIP_THRESHOLD_CARD_BODY_MAX);
    expect(cards[0]!.body.endsWith('…')).toBe(true);
    // And the digits the licence would look for are genuinely GONE.
    expect(cards[0]!.body).not.toContain('34500 GBP');
  });

  it('the boundary is exact: max-length passes through, max+1 truncates', () => {
    const exact = 'x'.repeat(FLIP_THRESHOLD_CARD_BODY_MAX);
    expect(truncateCardProse(exact, FLIP_THRESHOLD_CARD_BODY_MAX)).toBe(exact);
    const over = 'x'.repeat(FLIP_THRESHOLD_CARD_BODY_MAX + 1);
    expect(truncateCardProse(over, FLIP_THRESHOLD_CARD_BODY_MAX)).toHaveLength(
      FLIP_THRESHOLD_CARD_BODY_MAX,
    );
  });
});

describe('the row predicate IS the card predicate — every exit-1 shape agrees', () => {
  const cases: ReadonlyArray<{ name: string; row: Record<string, unknown> }> = [
    { name: 'well-formed', row: { ...BASE_ROW } },
    { name: 'factor_id missing', row: { ...BASE_ROW, factor_id: undefined } },
    { name: 'factor_id empty', row: { ...BASE_ROW, factor_id: '' } },
    { name: 'factor_id non-string', row: { ...BASE_ROW, factor_id: 42 } },
    // D1 — the exact drift the first cut shipped.
    { name: 'node_id instead of factor_id', row: { ...BASE_ROW, factor_id: undefined, node_id: 'fac_marketing_budget' } },
    { name: 'id instead of factor_id', row: { ...BASE_ROW, factor_id: undefined, id: 'fac_marketing_budget' } },
    // D2 — the other drift.
    { name: 'factor_label blank', row: { ...BASE_ROW, factor_label: '   ' } },
    { name: 'factor_label missing', row: { ...BASE_ROW, factor_label: undefined } },
    { name: 'narrative blank', row: { ...BASE_ROW, narrative: '  ' } },
    { name: 'narrative missing', row: { ...BASE_ROW, narrative: undefined } },
  ];

  it.each(cases)('$name: predicate verdict === card emitted?', ({ row }) => {
    const predicateSaysCard = readFlipThresholdCardRow(row) !== null;
    const cardsEmitted = flipCards([row]).length > 0;
    expect(predicateSaysCard).toBe(cardsEmitted);
  });

  it('the case set is discriminating — it contains both verdicts', () => {
    const verdicts = new Set(cases.map((c) => readFlipThresholdCardRow(c.row) !== null));
    expect(verdicts).toEqual(new Set([true, false]));
  });
});
