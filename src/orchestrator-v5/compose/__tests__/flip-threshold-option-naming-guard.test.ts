/**
 * ROADMAP 2.267 (defect D-2), part 2 — the flip card must never name an option
 * this run does not attest.
 *
 * THE DEFECT THESE TESTS PIN, observed on the live wire on 2026-08-01
 * (`PHASE0-EVIDENCE-2026-07-28/witness-2265-targeted-flip.md` §4, §13):
 *
 *   enrichment.flip_thresholds[3].alternative_winner_label  "Expand Existing Bristol Site"
 *   review_card[flip_threshold].body                        "…the leading option changes
 *                                                            between Leeds and the Status Quo."
 *
 * `opt_status_quo` cannot take over on that factor at any value — its slope is
 * zero and its intercept sits below the leader's. The card was not imprecise;
 * it was false about the single fact it exists to convey, and the Analysis tab
 * rendered the CORRECT winner from the same field on the same turn.
 *
 * `buildFlipThresholdCards` already fail-closes on an LLM-invented FACTOR
 * (`phase3-blocks.ts`, the `lookup.get(factorId)` gate). This is the same
 * pattern applied to the entity it was never applied to.
 *
 * RED-FIRST: the D-2 case below fails against the pre-2.267 builder — the card
 * ships the LLM's sentence verbatim, "Status Quo" and all.
 *
 * FIXTURE PROVENANCE: every narrative, option label, flip row and
 * `leading_option_id` below is read from
 * `tests/fixtures/cross-service/witness-2265-runA.flip-threshold-winner.json`,
 * which carries them BYTE-VERBATIM from three live turn captures (CEE build
 * 76e6bc7, 2026-08-01). Runs B and C are the NEGATIVE CONTROLS: their cards
 * named no option, so the guard must leave them byte-identical — without them
 * a guard that suppressed everything would pass.
 */
import { describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildGraphNodeLookup,
  buildReviewCardBlocks,
  type BlockBuildCtx,
} from '../phase3-blocks.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

interface Run {
  readonly leading_option_id: string;
  readonly flip_thresholds: readonly Record<string, unknown>[];
  readonly decision_review_flip_thresholds: readonly Record<string, unknown>[];
  readonly options: readonly { readonly option_id: string; readonly option_label: string }[];
}
interface WitnessFixture extends Run {
  readonly controls: { readonly runB: Run; readonly runC: Run };
}

const WITNESS: WitnessFixture = JSON.parse(
  readFileSync(
    join(REPO_ROOT, 'tests/fixtures/cross-service/witness-2265-runA.flip-threshold-winner.json'),
    'utf8',
  ),
) as WitnessFixture;

const GRAPH_HASH = 'gh_c23213d8c15befa8';
const CTX: BlockBuildCtx = {
  created_at: '2026-08-01T14:29:35.190Z',
  graph_hash_at_generation: GRAPH_HASH,
};

/**
 * Build the fact + lookup a run's capture implies. The graph nodes are derived
 * from the capture's own option and factor labels, so the canonical labels the
 * guard scans against are the ones that were live.
 */
function factFor(run: Run, overrides: Partial<Run> = {}): RunAnalysisHandlerFact {
  const flipThresholds = overrides.flip_thresholds ?? run.flip_thresholds;
  const drRows = overrides.decision_review_flip_thresholds ?? run.decision_review_flip_thresholds;
  const leadingOptionId = overrides.leading_option_id ?? run.leading_option_id;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-witness',
      leading_option_id: leadingOptionId,
      summary: 'Ran analysis on your current scenario.',
      computed_at: '2026-08-01T14:29:35.000Z',
      graph_hash_at_run: GRAPH_HASH,
      enrichment: {
        graph: {
          nodes: [
            ...run.options.map((o) => ({ id: o.option_id, kind: 'option', label: o.option_label })),
            ...run.flip_thresholds.map((r) => ({
              id: r.factor_id,
              kind: 'factor',
              label: r.factor_label,
            })),
          ],
          edges: [],
        },
        flip_thresholds: flipThresholds,
        decision_review: { flip_thresholds: drRows },
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

function flipCards(fact: RunAnalysisHandlerFact) {
  const lookup = buildGraphNodeLookup(fact);
  return buildReviewCardBlocks(fact, lookup, CTX).filter((b) => b.card_kind === 'flip_threshold');
}

function onlyFlipCard(fact: RunAnalysisHandlerFact) {
  const cards = flipCards(fact);
  expect(cards).toHaveLength(1);
  return cards[0]!;
}

const RUN_A_NARRATIVE = WITNESS.decision_review_flip_thresholds[0]!.narrative as string;

// ---------------------------------------------------------------------------
// The defect
// ---------------------------------------------------------------------------

describe('2.267 D-2 — the flip card never names an unattested option', () => {
  it('fixture integrity: the live narrative names Status Quo while the row attests opt_bristol', () => {
    expect(RUN_A_NARRATIVE).toContain('the Status Quo');
    const row = WITNESS.flip_thresholds.find((r) => r.factor_id === 'fac_leeds_site')!;
    expect(row.alternative_winner_id).toBe('opt_bristol');
    expect(WITNESS.leading_option_id).toBe('opt_leeds');
  });

  it('RED-FIRST: the shipped body drops the wrong option name', () => {
    const card = onlyFlipCard(factFor(WITNESS));
    expect(card.body).not.toContain('Status Quo');
    expect(card.body).not.toContain('status quo');
  });

  it('RED-FIRST: the card still ships, with the attested factor, direction and BOTH digits', () => {
    const card = onlyFlipCard(factFor(WITNESS));
    // Dropping the card would delete the dock's only flip surface to remove one
    // clause; the honest half of the sentence is attested and stays.
    expect(card.body).toBe(
      'If Leeds Site Activation moves from 0 to 66%, the leading option would change.',
    );
    expect(card.title).toBe('What would flip the result on Leeds Site Activation');
    expect(card.action_intent).toBe('what_would_flip');
  });

  it('the digits survive the swap — the coach display licence stays sound', () => {
    // `deriveFlipDisplayLicences` models the body as the NARRATIVE and cannot see
    // this guard. It stays sound only because the fallback re-emits the row's own
    // display strings. If this assertion ever fails, the licence can grant the
    // coach digits the user never saw.
    const dr = WITNESS.decision_review_flip_thresholds[0]!;
    const card = onlyFlipCard(factFor(WITNESS));
    expect(card.body).toContain(dr.current_display as string);
    expect(card.body).toContain(dr.flip_display as string);
  });
});

// ---------------------------------------------------------------------------
// What the guard must NOT do — the positive controls
// ---------------------------------------------------------------------------

describe('2.267 D-2 — the guard suppresses a NAME, not the surface', () => {
  it('run B: a card that named no option is byte-identical (live negative control)', () => {
    const run = WITNESS.controls.runB;
    const card = onlyFlipCard(factFor(run));
    expect(card.body).toBe(run.decision_review_flip_thresholds[0]!.narrative);
    expect(card.body).toBe(
      'If Operational Readiness Level increases from 50% to 77%, the leading option would change.',
    );
  });

  it('run C: the FACTOR label may be named even when an option label overlaps it', () => {
    // Live shape that a token-level guard would have broken: the narrative names
    // the factor "Vendor Platform Approach" while an option is called "Buy Vendor
    // Platform". The derived-distinctiveness rail must not read that as naming
    // the option.
    const run = WITNESS.controls.runC;
    expect(run.options.map((o) => o.option_label)).toContain('Buy Vendor Platform');
    const card = onlyFlipCard(factFor(run));
    expect(card.body).toBe(run.decision_review_flip_thresholds[0]!.narrative);
    expect(card.body).toContain('Vendor Platform Approach');
  });

  it('naming the ATTESTED winner is permitted, in full', () => {
    const card = onlyFlipCard(
      factFor(WITNESS, {
        decision_review_flip_thresholds: [
          {
            ...WITNESS.decision_review_flip_thresholds[0]!,
            narrative:
              'If Leeds Site Activation increases from 0 to 66%, the leading option becomes Expand Existing Bristol Site.',
          },
        ],
      }),
    );
    expect(card.body).toContain('Expand Existing Bristol Site');
  });

  it('naming the LEADING option is permitted — the run attests it too', () => {
    const card = onlyFlipCard(
      factFor(WITNESS, {
        decision_review_flip_thresholds: [
          {
            ...WITNESS.decision_review_flip_thresholds[0]!,
            narrative:
              'Open Second Warehouse in Leeds leads today, and at 66% that ordering changes.',
          },
        ],
      }),
    );
    expect(card.body).toContain('Open Second Warehouse in Leeds');
  });
});

// ---------------------------------------------------------------------------
// Fail-closed edges
// ---------------------------------------------------------------------------

describe('2.267 D-2 — fail-closed edges', () => {
  it('names ANY option when the row attests none ⇒ withheld', () => {
    const card = onlyFlipCard(
      factFor(WITNESS, {
        flip_thresholds: WITNESS.flip_thresholds.map((r) =>
          r.factor_id === 'fac_leeds_site'
            ? { ...r, alternative_winner_id: null, alternative_winner_label: null }
            : r,
        ),
        decision_review_flip_thresholds: [
          {
            ...WITNESS.decision_review_flip_thresholds[0]!,
            narrative:
              'If Leeds Site Activation increases from 0 to 66%, the leading option becomes Expand Existing Bristol Site.',
          },
        ],
      }),
    );
    expect(card.body).not.toContain('Expand Existing Bristol Site');
    expect(card.body).toBe(
      'If Leeds Site Activation moves from 0 to 66%, the leading option would change.',
    );
  });

  it('the whole-label naming a whole-phrase scan WOULD have caught is still caught', () => {
    const card = onlyFlipCard(
      factFor(WITNESS, {
        decision_review_flip_thresholds: [
          {
            ...WITNESS.decision_review_flip_thresholds[0]!,
            narrative:
              'If Leeds Site Activation increases from 0 to 66%, Continue at Current Capacity (Status Quo) takes the lead.',
          },
        ],
      }),
    );
    expect(card.body).not.toContain('Continue at Current Capacity');
  });

  it('a withheld card with NO usable display strings still ships a non-naming sentence', () => {
    const card = onlyFlipCard(
      factFor(WITNESS, {
        decision_review_flip_thresholds: [
          {
            factor_id: 'fac_leeds_site',
            factor_label: 'Leeds Site Activation',
            narrative: 'The leading option changes to the Status Quo.',
          },
        ],
      }),
    );
    expect(card.body).not.toContain('Status Quo');
    expect(card.body).toBe('If Leeds Site Activation moves far enough, the leading option would change.');
  });

  it('an empty graph lookup drops the card at the factor gate, exactly as before', () => {
    const fact = factFor(WITNESS);
    (fact.result as unknown as Record<string, unknown>).enrichment = {
      flip_thresholds: WITNESS.flip_thresholds,
      decision_review: { flip_thresholds: WITNESS.decision_review_flip_thresholds },
    };
    expect(flipCards(fact)).toHaveLength(0);
  });
});
