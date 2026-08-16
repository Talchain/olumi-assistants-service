/**
 * Phase 3A composer-extraction tests. Pure-function tests against the
 * v11 `decision_review` LLM output shape (per `src/prompts/defaults.ts`
 * OUTPUT_SCHEMA lines 1490-1518). Verifies field mapping, drop-on-miss,
 * banned-copy invariants, the v1.3 §1.3 EvidenceBlock consistency rule,
 * and the Codex correction rules:
 *
 *   - #1 confidence path uses real `enrichment.factor_sensitivity[]`
 *   - #2 suggested_technique uses colon (not em dash), drop if no
 *        specific_action
 *   - #3 graph hash comes from `fact.result.graph_hash_at_run`
 *   - #4 freshness is always 'fresh' (PR 2 fresh-only)
 *   - #5 every block is schema-validated; failures DROP the block
 *   - #6 no raw IDs / decimals / recommendation / recommended / winner /
 *        winning in user-facing prose
 *   - #7 Decision-Review-authored blocks stamp `'decision_review_enricher'`;
 *        the deterministic factor-EVPPI fallback stamps its own authority
 *   - #8 target_refs come from canonical labels; drop on resolution
 *        miss (no `id`-as-label fallback)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { log } from '../../../utils/telemetry.js';
import {
  buildCoachingBlocks,
  buildEvidenceBlocks,
  buildFactorConfidenceLookup,
  buildGraphNodeLookup,
  buildReviewCardBlocks,
  buildStaleRerunCoachingBlock,
  type BlockBuildCtx,
} from '../phase3-blocks.js';
import {
  GUIDANCE_SIGNAL_CODES,
  PRIORITY_BY_CATEGORY,
  evidenceSignals,
  guidanceSignalsForCoachingKind,
  guidanceSignalsForSeverity,
  reviewCardSignals,
} from '../guidance-signals.js';

// ============================================================================
// Fixtures
// ============================================================================

const GRAPH_HASH = 'gh_a1b2c3d4e5f60001';

const CTX: BlockBuildCtx = {
  created_at: '2026-05-16T15:00:00.000Z',
  graph_hash_at_generation: GRAPH_HASH,
};

const SOURCE_HANDLER = 'decision_review_enricher';

const BANNED_PROSE_PATTERNS = [
  /\brecommendations?\b/i,
  /\brecommended\b/i,
  /\bthe\s+winners?\b/i,
  /\bwinning\s+(option|probability|side|choice|outcome)\b/i,
];

const ID_LIKE_PATTERN = /\b(?:fac|opt|edge|node)_[a-z0-9_]+\b/i;

// Raw internal decimals like 0.482666 should not appear in prose. Allows
// "1.3" (contract version) by checking for at-least-3-digit decimals OR
// 0.X-shaped values that look like sensitivities.
const RAW_DECIMAL_PATTERN = /\b\d*\.\d{3,}\b|\b0\.\d{2,}\b/;

function assertNoBannedProse(s: string | undefined): void {
  if (!s) return;
  for (const re of BANNED_PROSE_PATTERNS) {
    expect(s).not.toMatch(re);
  }
  expect(s).not.toMatch(ID_LIKE_PATTERN);
  expect(s).not.toMatch(RAW_DECIMAL_PATTERN);
}

interface FactInput {
  readonly graphHash?: string | null;
  readonly decisionReview?: Record<string, unknown>;
  readonly graphNodes?: ReadonlyArray<Record<string, unknown>>;
  readonly factorSensitivity?: ReadonlyArray<Record<string, unknown>>;
  readonly factorEvppi?: ReadonlyArray<Record<string, unknown>>;
  readonly inferenceWarnings?: ReadonlyArray<Record<string, unknown>>;
}

function makeFact(input: FactInput = {}): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (input.decisionReview !== undefined) {
    enrichment.decision_review = input.decisionReview;
  }
  if (input.graphNodes !== undefined) {
    enrichment.graph = { nodes: input.graphNodes };
  }
  if (input.factorSensitivity !== undefined) {
    enrichment.factor_sensitivity = input.factorSensitivity;
  }
  if (input.factorEvppi !== undefined) {
    enrichment.factor_evppi = input.factorEvppi;
  }
  if (input.inferenceWarnings !== undefined) {
    enrichment.inference_warnings = input.inferenceWarnings;
  }
  const result: Record<string, unknown> = {
    scenario_id: 'scen-test',
    leading_option_id: 'opt_a',
    summary: 'Ran analysis on your current scenario.',
    enrichment,
    computed_at: '2026-05-16T14:59:00.000Z',
  };
  if (input.graphHash !== null) {
    result.graph_hash_at_run = input.graphHash ?? GRAPH_HASH;
  }
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result,
  } as unknown as RunAnalysisHandlerFact;
}

const FACTOR_DELIVERY = {
  id: 'fac_delivery_risk',
  label: 'Delivery risk',
  kind: 'factor',
};
const FACTOR_COST = {
  id: 'fac_cost_overrun',
  label: 'Cost overrun risk',
  kind: 'factor',
};
const EDGE_DELIVERY_GOAL = {
  id: 'edge_delivery_goal',
  label: 'Delivery risk → Launch success',
  kind: 'edge',
};

const STANDARD_GRAPH_NODES = [FACTOR_DELIVERY, FACTOR_COST, EDGE_DELIVERY_GOAL];

// ============================================================================
// buildGraphNodeLookup
// ============================================================================

describe('buildGraphNodeLookup', () => {
  it('returns an empty map when enrichment is absent', () => {
    const lookup = buildGraphNodeLookup({
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: { scenario_id: 's', leading_option_id: null, summary: '' },
    } as unknown as RunAnalysisHandlerFact);
    expect(lookup.size).toBe(0);
  });

  it('builds a lookup from valid graph nodes', () => {
    const lookup = buildGraphNodeLookup(makeFact({ graphNodes: STANDARD_GRAPH_NODES }));
    expect(lookup.size).toBe(3);
    expect(lookup.get('fac_delivery_risk')?.label).toBe('Delivery risk');
    expect(lookup.get('fac_delivery_risk')?.kind).toBe('factor');
  });

  it('skips nodes with kinds outside the v1.3 TargetRefKind union', () => {
    const lookup = buildGraphNodeLookup(makeFact({
      graphNodes: [
        FACTOR_DELIVERY,
        { id: 'gn_x', label: 'X', kind: 'parameter' }, // not in union
      ],
    }));
    expect(lookup.has('fac_delivery_risk')).toBe(true);
    expect(lookup.has('gn_x')).toBe(false);
  });
});

// ============================================================================
// buildFactorConfidenceLookup
// ============================================================================

describe('buildFactorConfidenceLookup (Codex correction #1)', () => {
  // ⚠ ROADMAP 2.681 moved the medium floor 0.3 → 0.4 to match the band PLoT
  // already shows the user (`src/review-pass/evidence-priority.ts`). The two
  // boundary fixtures below were NAMED for the old floor and are re-pointed at
  // the new one here rather than absorbed — `0.3` is now a `low` row, and it is
  // kept in the table under its true name because it is where live traffic
  // actually sits. The cross-service parity guard is
  // `confidence-bands.plot-parity.test.ts`.
  it('maps confidence boundaries: >=0.7 → high, >=0.4 → medium, <0.4 → low', () => {
    const lookup = buildFactorConfidenceLookup(makeFact({
      factorSensitivity: [
        { factor_id: 'fac_high', confidence: 0.85 },
        { factor_id: 'fac_high_boundary', confidence: 0.7 },
        { factor_id: 'fac_medium', confidence: 0.5 },
        { factor_id: 'fac_medium_boundary', confidence: 0.4 },
        { factor_id: 'fac_low', confidence: 0.1 },
        { factor_id: 'fac_low_boundary', confidence: 0.399 },
        // The live floor: ISL `negligible` → PLoT 0.5*0.1+0.25. 212 of 404
        // captured rows sat on exactly this value and were banded 'medium'.
        { factor_id: 'fac_live_floor', confidence: 0.3 },
      ],
    }));
    expect(lookup.get('fac_high')).toBe('high');
    expect(lookup.get('fac_high_boundary')).toBe('high');
    expect(lookup.get('fac_medium')).toBe('medium');
    expect(lookup.get('fac_medium_boundary')).toBe('medium');
    expect(lookup.get('fac_low')).toBe('low');
    expect(lookup.get('fac_low_boundary')).toBe('low');
    expect(lookup.get('fac_live_floor')).toBe('low');
  });

  it('OMITS entries with missing / null / non-finite confidence (round-2 fail-closed correction)', () => {
    // Round-2 review correction: the contract test at
    // `decision-review-enricher.contract.test.ts:321` proves
    // `factor_sensitivity[].confidence` is OPTIONAL in real PLoT
    // envelopes. Silently defaulting absent values to 'low' would
    // mislabel every such EvidenceBlock with severity critical/warning
    // based on a fabricated band. The lookup omits them; the
    // EvidenceBlock builder DROPS the entry.
    const lookup = buildFactorConfidenceLookup(makeFact({
      factorSensitivity: [
        { factor_id: 'fac_null', confidence: null },
        { factor_id: 'fac_missing' }, // no confidence key at all
        { factor_id: 'fac_nan', confidence: NaN },
        { factor_id: 'fac_string', confidence: '0.5' }, // wrong type
        { factor_id: 'fac_valid', confidence: 0.5 },
      ],
    }));
    expect(lookup.has('fac_null')).toBe(false);
    expect(lookup.has('fac_missing')).toBe(false);
    expect(lookup.has('fac_nan')).toBe(false);
    expect(lookup.has('fac_string')).toBe(false);
    expect(lookup.get('fac_valid')).toBe('medium');
  });

  it('returns an empty map when factor_sensitivity is absent', () => {
    expect(buildFactorConfidenceLookup(makeFact()).size).toBe(0);
  });

  it('keys a node_id-only entry (PLoT keys by node_id) so its EvidenceBlock is not dropped', () => {
    const lookup = buildFactorConfidenceLookup(makeFact({
      factorSensitivity: [{ node_id: 'fac_node_only', confidence: 0.85 }],
    }));
    expect(lookup.get('fac_node_only')).toBe('high');
  });
});

// ============================================================================
// buildReviewCardBlocks — happy paths per card_kind
// ============================================================================

describe('buildReviewCardBlocks — narrative card_kind', () => {
  it('emits a narrative card when narrative_summary is present', () => {
    const blocks = buildReviewCardBlocks(
      makeFact({
        decisionReview: {
          narrative_summary: 'Hire two senior engineers locally is currently ahead by a narrow lead.',
        },
        graphNodes: STANDARD_GRAPH_NODES,
      }),
      buildGraphNodeLookup(makeFact({ graphNodes: STANDARD_GRAPH_NODES })),
      CTX,
    );
    const narrative = blocks.find((b) => b.card_kind === 'narrative');
    expect(narrative).toBeDefined();
    expect(narrative?.title).toBe('How the analysis reads');
    expect(narrative?.severity).toBe('info');
    expect(narrative?.priority_rank).toBe(10);
    expect(narrative?.target_refs).toEqual([]);
    expect(narrative?.source_handler).toBe(SOURCE_HANDLER);
    expect(narrative?.graph_hash_at_generation).toBe(GRAPH_HASH);
    expect(narrative?.freshness).toBe('fresh');
    assertNoBannedProse(narrative?.title);
    assertNoBannedProse(narrative?.body);
  });

  it('skips narrative when narrative_summary is empty or missing', () => {
    expect(
      buildReviewCardBlocks(
        makeFact({ decisionReview: {} }),
        new Map(),
        CTX,
      ).find((b) => b.card_kind === 'narrative'),
    ).toBeUndefined();
    expect(
      buildReviewCardBlocks(
        makeFact({ decisionReview: { narrative_summary: '   ' } }),
        new Map(),
        CTX,
      ).find((b) => b.card_kind === 'narrative'),
    ).toBeUndefined();
  });
});

describe('buildReviewCardBlocks — pre_mortem card_kind', () => {
  it('emits a pre_mortem card with resolved target_refs from grounded_in', () => {
    const blocks = buildReviewCardBlocks(
      makeFact({
        decisionReview: {
          pre_mortem: {
            failure_scenario: 'Team underestimated the integration risk.',
            warning_signs: ['Velocity drops'],
            mitigation: 'Weekly review with the lead.',
            grounded_in: ['fac_delivery_risk', 'fac_unknown_ignored'],
          },
        },
        graphNodes: STANDARD_GRAPH_NODES,
      }),
      buildGraphNodeLookup(makeFact({ graphNodes: STANDARD_GRAPH_NODES })),
      CTX,
    );
    const pm = blocks.find((b) => b.card_kind === 'pre_mortem');
    expect(pm).toBeDefined();
    expect(pm?.severity).toBe('warning');
    expect(pm?.action_intent).toBe('run_pre_mortem');
    expect(pm?.target_refs).toHaveLength(1);
    expect(pm?.target_refs[0].id).toBe('fac_delivery_risk');
    expect(pm?.target_refs[0].label).toBe('Delivery risk');
    assertNoBannedProse(pm?.body);
  });
});

describe('buildReviewCardBlocks — flip_threshold card_kind', () => {
  it('emits one card per flip_threshold entry with factor_label from the LLM', () => {
    const blocks = buildReviewCardBlocks(
      makeFact({
        decisionReview: {
          flip_thresholds: [
            {
              factor_id: 'fac_delivery_risk',
              factor_label: 'Delivery risk',
              current_display: '0.3',
              flip_display: '0.7',
              narrative: 'A move from low to high delivery risk would flip the result.',
            },
            {
              factor_id: 'fac_cost_overrun',
              factor_label: 'Cost overrun risk',
              current_display: '10000 GBP',
              flip_display: '50000 GBP',
              narrative: 'A jump in cost overrun beyond fifty thousand pounds flips the leader.',
            },
          ],
        },
        graphNodes: STANDARD_GRAPH_NODES,
      }),
      buildGraphNodeLookup(makeFact({ graphNodes: STANDARD_GRAPH_NODES })),
      CTX,
    );
    const flips = blocks.filter((b) => b.card_kind === 'flip_threshold');
    expect(flips).toHaveLength(2);
    expect(flips[0].action_intent).toBe('what_would_flip');
    expect(flips[0].severity).toBe('warning');
    expect(flips[0].priority_rank).toBeLessThan(flips[1].priority_rank);
    for (const f of flips) {
      assertNoBannedProse(f.title);
      assertNoBannedProse(f.body);
    }
  });

  it('skips flip entries with missing factor_label or narrative', () => {
    const blocks = buildReviewCardBlocks(
      makeFact({
        decisionReview: {
          flip_thresholds: [
            { factor_id: 'fac_x', factor_label: '', narrative: 'x' },
            { factor_id: 'fac_y', factor_label: 'Y', narrative: '' },
          ],
        },
        graphNodes: STANDARD_GRAPH_NODES,
      }),
      buildGraphNodeLookup(makeFact({ graphNodes: STANDARD_GRAPH_NODES })),
      CTX,
    );
    expect(blocks.filter((b) => b.card_kind === 'flip_threshold')).toHaveLength(0);
  });
});

describe('buildReviewCardBlocks — bias card_kind', () => {
  it('emits one card per bias_findings entry; drops affected_elements that fail lookup', () => {
    const blocks = buildReviewCardBlocks(
      makeFact({
        decisionReview: {
          bias_findings: [
            {
              type: 'ANCHORING',
              source: 'structural',
              description: 'The model edges cluster on a single strength band — calibration risk.',
              affected_elements: ['fac_delivery_risk', 'fac_unknown'],
              suggested_action: 'Check estimates against base rates.',
              linked_critique_code: 'STRENGTH_CLUSTERING',
            },
          ],
        },
        graphNodes: STANDARD_GRAPH_NODES,
      }),
      buildGraphNodeLookup(makeFact({ graphNodes: STANDARD_GRAPH_NODES })),
      CTX,
    );
    const bias = blocks.find((b) => b.card_kind === 'bias');
    expect(bias).toBeDefined();
    expect(bias?.severity).toBe('warning');
    expect(bias?.title.toLowerCase()).toContain('anchoring');
    expect(bias?.target_refs).toHaveLength(1);
    expect(bias?.target_refs[0].id).toBe('fac_delivery_risk');
    expect(bias?.action_intent).toBe('gather_evidence');
    assertNoBannedProse(bias?.title);
    assertNoBannedProse(bias?.body);
  });
});

describe('buildReviewCardBlocks — robustness card_kind', () => {
  it('escalates severity to warning when primary_risk is present', () => {
    const blocks = buildReviewCardBlocks(
      makeFact({
        decisionReview: {
          robustness_explanation: {
            summary: 'The result holds across most plausible scenarios.',
            primary_risk: 'Delivery risk volatility could flip the analysis.',
            stability_factors: [],
            fragility_factors: [],
          },
        },
      }),
      new Map(),
      CTX,
    );
    const r = blocks.find((b) => b.card_kind === 'robustness');
    expect(r?.severity).toBe('warning');
  });

  it('keeps severity at info when primary_risk is absent', () => {
    const blocks = buildReviewCardBlocks(
      makeFact({
        decisionReview: {
          robustness_explanation: {
            summary: 'The result holds across most plausible scenarios.',
            primary_risk: '',
            stability_factors: [],
            fragility_factors: [],
          },
        },
      }),
      new Map(),
      CTX,
    );
    const r = blocks.find((b) => b.card_kind === 'robustness');
    expect(r?.severity).toBe('info');
  });
});

describe('buildReviewCardBlocks — evidence_priority card_kind', () => {
  it('emits one card for the exact producer-ranked resolved EVPPI factor', () => {
    const blocks = buildReviewCardBlocks(
      makeFact({
        decisionReview: {
          evidence_enhancements: {
            fac_delivery_risk: {
              specific_action: 'Pull on-time delivery rate from the last two releases.',
              rationale: 'Delivery rate is the largest variance driver here.',
              evidence_type: 'internal_data',
              decision_hygiene: 'Estimate first, then look at data.',
            },
            fac_cost_overrun: {
              specific_action: 'Audit the last three project budgets.',
              rationale: 'Cost evidence is incomplete.',
              evidence_type: 'internal_data',
              decision_hygiene: 'Write down the expected overrun first.',
            },
          },
        },
        graphNodes: STANDARD_GRAPH_NODES,
        factorEvppi: [
          { factor_id: 'fac_cost_overrun', evppi: 0.4, status: 'resolved' },
          { factor_id: 'fac_delivery_risk', evppi: 0.2, status: 'resolved' },
        ],
      }),
      buildGraphNodeLookup(makeFact({ graphNodes: STANDARD_GRAPH_NODES })),
      CTX,
    );
    const e = blocks.find((b) => b.card_kind === 'evidence_priority');
    expect(e).toBeDefined();
    expect(e?.target_refs).toHaveLength(1);
    expect(e?.target_refs[0].id).toBe('fac_cost_overrun');
    expect(e?.action_intent).toBe('gather_evidence');
    expect(e?.title).toBe('Evidence to strengthen first: Cost overrun risk');
    expect(e?.body).toBe('Audit the last three project budgets.');
    expect(JSON.stringify(e)).not.toContain('0.4');
  });

  it('uses deterministic evidence guidance when the EVPPI priority has no review action', () => {
    const fact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: 'Pull on-time delivery data.',
            rationale: 'Delivery evidence is incomplete.',
            evidence_type: 'internal_data',
            decision_hygiene: 'Estimate first.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      factorEvppi: [
        { factor_id: 'fac_cost_overrun', evppi: 0.4, status: 'resolved' },
        { factor_id: 'fac_delivery_risk', evppi: 0.2, status: 'resolved' },
      ],
    });

    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    const priority = blocks.find((block) => block.card_kind === 'evidence_priority');
    expect(priority?.target_refs[0]?.id).toBe('fac_cost_overrun');
    expect(priority?.body).toContain(
      'Review the evidence behind the current estimate or range for Cost overrun risk',
    );
    expect(priority?.body).not.toContain('Pull on-time delivery data');
  });

  it('emits deterministic producer-ranked guidance with decision review absent', () => {
    const fact = makeFact({
      graphNodes: STANDARD_GRAPH_NODES,
      factorEvppi: [
        { factor_id: 'fac_delivery_risk', evppi: 0, status: 'resolved' },
      ],
    });

    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    const priority = blocks.find((block) => block.card_kind === 'evidence_priority');
    expect(priority?.title).toBe('Evidence to strengthen first: Delivery risk');
    expect(priority?.body).toContain('gather relevant data or expert judgement');
    expect(priority?.source_handler).toBe('run_analysis');
    expect(`${priority?.title} ${priority?.body} ${priority?.action_label}`).not.toMatch(
      /\b0(?:\.\d+)?\b|evppi/i,
    );
  });

  it('does not crown LLM order when every EVPPI row is below resolution', () => {
    const fact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: 'Pull on-time delivery data.',
            rationale: 'Delivery evidence is incomplete.',
            evidence_type: 'internal_data',
            decision_hygiene: 'Estimate first.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      factorEvppi: [
        { factor_id: 'fac_delivery_risk', evppi: 0, status: 'below_resolution' },
      ],
    });

    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    expect(blocks.find((block) => block.card_kind === 'evidence_priority')).toBeUndefined();
  });

  it('does not crown a surviving row when the EVPPI producer reports partial assessment', () => {
    const fact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: 'Pull on-time delivery data.',
            rationale: 'Delivery evidence is incomplete.',
            evidence_type: 'internal_data',
            decision_hygiene: 'Estimate first.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      factorEvppi: [
        { factor_id: 'fac_delivery_risk', evppi: 0.4, status: 'resolved' },
      ],
      inferenceWarnings: [
        { code: 'FACTOR_EVPPI_PARTIAL', field: 'factor_evppi' },
      ],
    });

    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    expect(blocks.find((block) => block.card_kind === 'evidence_priority')).toBeUndefined();
  });

  it('drops the evidence_priority card when the factor_id is not in the graph lookup (Codex correction #8)', () => {
    const blocks = buildReviewCardBlocks(
      makeFact({
        decisionReview: {
          evidence_enhancements: {
            fac_unknown: {
              specific_action: 'Check unknown factor data.',
              rationale: 'Why this matters.',
              evidence_type: 'internal_data',
              decision_hygiene: 'Estimate first.',
            },
          },
        },
        graphNodes: STANDARD_GRAPH_NODES,
        factorEvppi: [
          { factor_id: 'fac_unknown', evppi: 0.4, status: 'resolved' },
        ],
      }),
      buildGraphNodeLookup(makeFact({ graphNodes: STANDARD_GRAPH_NODES })),
      CTX,
    );
    expect(blocks.find((b) => b.card_kind === 'evidence_priority')).toBeUndefined();
  });
});

describe('buildReviewCardBlocks — assumption + scenario_context', () => {
  it('emits one assumption card per key_assumptions string', () => {
    const blocks = buildReviewCardBlocks(
      makeFact({
        decisionReview: {
          key_assumptions: [
            'Edge strengths assume current market conditions persist.',
            'The brief assumes the competitor timeline is predictable.',
          ],
        },
      }),
      new Map(),
      CTX,
    );
    expect(blocks.filter((b) => b.card_kind === 'assumption')).toHaveLength(2);
  });

  it('emits scenario_context cards composed from trigger + consequence', () => {
    const blocks = buildReviewCardBlocks(
      makeFact({
        decisionReview: {
          scenario_contexts: {
            edge_delivery_goal: {
              trigger_description: 'If delivery risk spikes during launch month',
              consequence: 'then Hire one engineer overseas overtakes Hire two engineers locally.',
            },
          },
        },
        graphNodes: STANDARD_GRAPH_NODES,
      }),
      buildGraphNodeLookup(makeFact({ graphNodes: STANDARD_GRAPH_NODES })),
      CTX,
    );
    const sc = blocks.find((b) => b.card_kind === 'scenario_context');
    expect(sc).toBeDefined();
    expect(sc?.body).toContain('If delivery risk spikes');
    expect(sc?.body).toContain('overtakes');
    expect(sc?.target_refs).toHaveLength(1);
    expect(sc?.target_refs[0].kind).toBe('edge');
  });
});

// ============================================================================
// buildCoachingBlocks
// ============================================================================

describe('buildCoachingBlocks', () => {
  it('emits assumption_check blocks from key_assumptions', () => {
    const blocks = buildCoachingBlocks(
      makeFact({
        decisionReview: {
          key_assumptions: [
            'Edge strengths assume current market conditions persist.',
          ],
        },
      }),
      new Map(),
      CTX,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].coaching_kind).toBe('assumption_check');
    expect(blocks[0].source).toBe('decision_review');
    expect(blocks[0].action_intent).toBe('confirm_factor');
    expect(blocks[0].target_refs).toEqual([]);
  });

  it('emits calibration_prompt blocks from decision_quality_prompts', () => {
    const blocks = buildCoachingBlocks(
      makeFact({
        decisionReview: {
          decision_quality_prompts: [
            {
              question: 'What would change your mind about delivery risk?',
              principle: 'Disconfirmation',
              applies_because: 'Win probability is high.',
            },
          ],
        },
      }),
      new Map(),
      CTX,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].coaching_kind).toBe('calibration_prompt');
    expect(blocks[0].action_intent).toBe('start_guided_chat');
    expect(blocks[0].body).toContain('What would change your mind');
  });

  it('drops calibration prompts with empty question', () => {
    const blocks = buildCoachingBlocks(
      makeFact({
        decisionReview: {
          decision_quality_prompts: [
            { question: '   ', principle: 'X', applies_because: 'y' },
          ],
        },
      }),
      new Map(),
      CTX,
    );
    expect(blocks).toHaveLength(0);
  });
});

// ============================================================================
// buildEvidenceBlocks (Codex corrections #1, #2, #8)
// ============================================================================

describe('buildEvidenceBlocks', () => {
  function evidenceFact(): RunAnalysisHandlerFact {
    return makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: 'Pull on-time delivery rate from the last two releases.',
            rationale: 'Delivery rate is the largest variance driver here.',
            evidence_type: 'internal_data',
            decision_hygiene: 'Estimate first, then look at data.',
          },
          fac_cost_overrun: {
            specific_action: 'Talk to the finance team about historical overruns.',
            rationale: 'Cost variance is the second-largest driver.',
            evidence_type: 'expert_input',
            decision_hygiene: 'Assign someone to argue the cost will not overrun.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      factorSensitivity: [
        { factor_id: 'fac_delivery_risk', confidence: 0.2 }, // low
        { factor_id: 'fac_cost_overrun', confidence: 0.6 }, // medium
      ],
      factorEvppi: [
        { factor_id: 'fac_delivery_risk', evppi: 0.4, status: 'resolved' },
        { factor_id: 'fac_cost_overrun', evppi: 0.2, status: 'resolved' },
      ],
    });
  }

  it('puts the exact producer-ranked EVPPI factor first', () => {
    const fact = evidenceFact();
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].factor_ref.id).toBe('fac_delivery_risk');
    expect(blocks[0].priority_rank).toBe(1);
    expect(blocks[1].factor_ref.id).toBe('fac_cost_overrun');
    expect(blocks[1].priority_rank).toBe(2);
  });

  it('reorders LLM enhancement emission to the producer priority without exposing EVPPI', () => {
    const fact = evidenceFact();
    const enrichment = fact.result.enrichment as Record<string, unknown>;
    enrichment.factor_evppi = [
      { factor_id: 'fac_cost_overrun', evppi: 0.01, status: 'resolved' },
      { factor_id: 'fac_delivery_risk', evppi: 0.9, status: 'resolved' },
    ];
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );

    expect(blocks.map((block) => block.factor_ref.id)).toEqual([
      'fac_cost_overrun',
      'fac_delivery_risk',
    ]);
    expect(JSON.stringify(blocks)).not.toMatch(/0\.01|0\.9|evppi/);
  });

  it('treats LLM emission order as presentation-only when EVPPI has no selection', () => {
    const fact = evidenceFact();
    const enrichment = fact.result.enrichment as Record<string, unknown>;
    enrichment.factor_evppi = [
      { factor_id: 'fac_delivery_risk', evppi: 0, status: 'below_resolution' },
    ];
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );

    expect(blocks[0].factor_ref.id).toBe('fac_delivery_risk');
    expect(blocks[0].current_confidence).toBe('low');
    expect(blocks[0].severity).toBe('warning');
  });

  it('does not promote a surviving EVPPI row when the producer reports a partial assessment', () => {
    const fact = evidenceFact();
    const enrichment = fact.result.enrichment as Record<string, unknown>;
    enrichment.factor_evppi = [
      { factor_id: 'fac_cost_overrun', evppi: 0.8, status: 'resolved' },
      { factor_id: 'fac_delivery_risk', evppi: 0.4, status: 'resolved' },
    ];
    enrichment.inference_warnings = [
      { code: 'FACTOR_EVPPI_PARTIAL', field: 'factor_evppi' },
    ];

    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );

    // Without a complete producer ranking, the LLM object's original order is
    // only a stable presentation order and cannot earn critical severity.
    expect(blocks.map((block) => block.factor_ref.id)).toEqual([
      'fac_delivery_risk',
      'fac_cost_overrun',
    ]);
    expect(blocks[0].severity).toBe('warning');
  });

  it('derives current_confidence from factor_sensitivity (Codex correction #1)', () => {
    const fact = evidenceFact();
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );
    expect(blocks[0].current_confidence).toBe('low');
    expect(blocks[1].current_confidence).toBe('medium');
  });

  it('escalates low confidence only for the exact producer-ranked EVPPI factor', () => {
    const fact = evidenceFact();
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );
    expect(blocks[0].severity).toBe('critical'); // low + exact EVPPI priority
    expect(blocks[1].severity).toBe('info'); // medium
  });

  it('drops evidence entry when factor_id is not in graph lookup (Codex correction #8)', () => {
    const fact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_unknown: {
            specific_action: 'Some action.',
            rationale: 'Why.',
            evidence_type: 'internal_data',
            decision_hygiene: 'How.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );
    expect(blocks).toHaveLength(0);
  });

  it('drops evidence entry when PLoT confidence is missing for that factor (round-2 fail-closed)', () => {
    // factor_sensitivity has the factor but with null confidence →
    // the lookup omits the entry → the builder drops the block.
    // Documents the round-2 review correction: NEVER silently
    // mislabel by defaulting unknown confidence to 'low'.
    const fact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: 'Pull on-time delivery data.',
            rationale: 'Why this matters.',
            evidence_type: 'internal_data',
            decision_hygiene: 'How to think.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      factorSensitivity: [
        { factor_id: 'fac_delivery_risk', confidence: null },
      ],
    });
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );
    expect(blocks).toHaveLength(0);
  });

  it('drops evidence entry when factor is absent from factor_sensitivity entirely (round-2 fail-closed)', () => {
    const fact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: 'Pull on-time delivery data.',
            rationale: 'Why this matters.',
            evidence_type: 'internal_data',
            decision_hygiene: 'How to think.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      factorSensitivity: [
        // No entry for fac_delivery_risk — completely absent.
        { factor_id: 'fac_other', confidence: 0.5 },
      ],
    });
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );
    expect(blocks).toHaveLength(0);
  });

  it('drops evidence entry when factor_sensitivity is entirely absent from the envelope', () => {
    const fact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: 'Pull on-time delivery data.',
            rationale: 'Why this matters.',
            evidence_type: 'internal_data',
            decision_hygiene: 'How to think.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      // factorSensitivity intentionally omitted.
    });
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );
    expect(blocks).toHaveLength(0);
  });

  it('drops evidence entry when specific_action is missing (Codex correction #2)', () => {
    const fact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: '',
            rationale: 'Why this matters.',
            evidence_type: 'internal_data',
            decision_hygiene: 'How to think.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );
    expect(blocks).toHaveLength(0);
  });

  it('factor_ref matches the primary target_refs factor entry (§1.3 consistency rule)', () => {
    const fact = evidenceFact();
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );
    for (const b of blocks) {
      expect(b.target_refs[0].id).toBe(b.factor_ref.id);
      expect(b.target_refs[0].label).toBe(b.factor_ref.label);
      expect(b.target_refs[0].kind).toBe('factor');
    }
  });
});

// ============================================================================
// suggested_technique formatting (Codex correction #2)
// ============================================================================

describe('suggested_technique formatting (Codex correction #2)', () => {
  function makeEvidenceWithTechnique(evidenceType: string, specificAction: string) {
    const fact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: specificAction,
            rationale: 'Why this matters.',
            evidence_type: evidenceType,
            decision_hygiene: 'How to think.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      factorSensitivity: [{ factor_id: 'fac_delivery_risk', confidence: 0.5 }],
    });
    return buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );
  }

  it('formats as "<EvidenceTypeLabel>: <specific_action>" when evidence_type is recognised', () => {
    const blocks = makeEvidenceWithTechnique(
      'expert_input',
      'talk to the hiring manager about retention rates',
    );
    expect(blocks[0].suggested_technique).toBe(
      'Expert input: Talk to the hiring manager about retention rates',
    );
  });

  it('uses specific_action only when evidence_type is empty', () => {
    const blocks = makeEvidenceWithTechnique(
      '',
      'pull retention numbers from the HR dashboard',
    );
    expect(blocks[0].suggested_technique).toBe(
      'Pull retention numbers from the HR dashboard',
    );
  });

  it('falls back to action-only when evidence_type is unrecognised', () => {
    const blocks = makeEvidenceWithTechnique(
      'mystery_method',
      'investigate the factor further',
    );
    expect(blocks[0].suggested_technique).toBe(
      'Investigate the factor further',
    );
  });

  it('never contains an em dash separator', () => {
    const blocks = makeEvidenceWithTechnique(
      'expert_input',
      'something the LLM emitted',
    );
    expect(blocks[0].suggested_technique).not.toContain(' — ');
    expect(blocks[0].suggested_technique).not.toContain('—');
  });

  it.each([
    ['internal_data', 'Internal data'],
    ['market_research', 'Market research'],
    ['expert_input', 'Expert input'],
    ['customer_research', 'Customer research'],
  ])('humanises evidence_type %s → "%s"', (input, expected) => {
    const blocks = makeEvidenceWithTechnique(input, 'do the thing');
    expect(blocks[0].suggested_technique.startsWith(`${expected}:`)).toBe(true);
  });
});

// ============================================================================
// Banned-copy and raw-ID drift guard (Codex correction #6) across every block
// ============================================================================

// Rich decision_review producing a block of every kind — shared by the
// banned-copy drift guard and the wave-2 guidance-signal pins below.
const RICH_DR = {
    narrative_summary: 'Hire two senior engineers locally is currently ahead by a narrow lead.',
    story_headlines: { opt_a: 'A wins because…', opt_b: 'B would lead if…' },
    robustness_explanation: {
      summary: 'The result holds across most plausible scenarios.',
      primary_risk: 'Delivery risk volatility could flip the analysis.',
      stability_factors: [],
      fragility_factors: [],
    },
    readiness_rationale: 'Model is ready.',
    evidence_enhancements: {
      fac_delivery_risk: {
        specific_action: 'pull on-time delivery rate from the last two releases',
        rationale: 'delivery rate is the largest variance driver',
        evidence_type: 'internal_data',
        decision_hygiene: 'estimate first, then look at the data',
      },
    },
    scenario_contexts: {
      edge_delivery_goal: {
        trigger_description: 'If delivery risk spikes during launch month',
        consequence: 'then Hire one engineer overseas overtakes Hire two engineers locally.',
      },
    },
    flip_thresholds: [
      {
        factor_id: 'fac_delivery_risk',
        factor_label: 'Delivery risk',
        current_display: '0.3',
        flip_display: '0.7',
        narrative: 'A move from low to high delivery risk would flip the result.',
      },
    ],
    bias_findings: [
      {
        type: 'ANCHORING',
        source: 'structural',
        description: 'The model edges cluster on a single strength band.',
        affected_elements: ['fac_delivery_risk'],
        suggested_action: 'Check estimates against base rates.',
        linked_critique_code: 'STRENGTH_CLUSTERING',
      },
    ],
    key_assumptions: ['Market conditions persist.'],
    decision_quality_prompts: [
      {
        question: 'What would change your mind about delivery risk?',
        principle: 'Disconfirmation',
        applies_because: 'Win probability is high.',
      },
    ],
    pre_mortem: {
      failure_scenario: 'Team underestimated integration risk.',
      warning_signs: ['Velocity drops'],
      mitigation: 'Weekly review with the lead.',
      grounded_in: ['fac_delivery_risk'],
    },
  };

describe('banned-copy and raw-ID drift guard (Codex correction #6)', () => {
  const fact = makeFact({
    decisionReview: RICH_DR,
    graphNodes: STANDARD_GRAPH_NODES,
    factorSensitivity: [{ factor_id: 'fac_delivery_risk', confidence: 0.2 }],
  });
  const lookup = buildGraphNodeLookup(fact);
  const conf = buildFactorConfidenceLookup(fact);

  const review = buildReviewCardBlocks(fact, lookup, CTX);
  const coaching = buildCoachingBlocks(fact, lookup, CTX);
  const evidence = buildEvidenceBlocks(fact, lookup, conf, CTX);

  it('every ReviewCard prose field passes the banned-copy + raw-ID guard', () => {
    expect(review.length).toBeGreaterThan(0);
    for (const b of review) {
      assertNoBannedProse(b.title);
      assertNoBannedProse(b.body);
      assertNoBannedProse(b.action_label);
    }
  });

  it('every CoachingBlock prose field passes the banned-copy + raw-ID guard', () => {
    expect(coaching.length).toBeGreaterThan(0);
    for (const b of coaching) {
      assertNoBannedProse(b.title);
      assertNoBannedProse(b.body);
      assertNoBannedProse(b.action_label);
    }
  });

  it('every EvidenceBlock prose field passes the banned-copy + raw-ID guard', () => {
    expect(evidence.length).toBeGreaterThan(0);
    for (const b of evidence) {
      assertNoBannedProse(b.factor_label);
      assertNoBannedProse(b.evidence_gap);
      assertNoBannedProse(b.suggested_technique);
      assertNoBannedProse(b.impact_if_gathered);
      assertNoBannedProse(b.action_label);
    }
  });
});

// ============================================================================
// Common-metadata stamping (Codex corrections #3, #4, #7)
// ============================================================================

describe('common metadata stamping (Codex corrections #3, #4, #7)', () => {
  it('stamps source_handler = "decision_review_enricher" on every Decision-Review-authored block', () => {
    const fact = makeFact({
      decisionReview: {
        narrative_summary: 'A is currently ahead.',
        key_assumptions: ['x'],
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: 'do the thing',
            rationale: 'why',
            evidence_type: 'internal_data',
            decision_hygiene: 'how',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      factorSensitivity: [{ factor_id: 'fac_delivery_risk', confidence: 0.5 }],
    });
    const lookup = buildGraphNodeLookup(fact);
    const conf = buildFactorConfidenceLookup(fact);
    const allBlocks = [
      ...buildReviewCardBlocks(fact, lookup, CTX),
      ...buildCoachingBlocks(fact, lookup, CTX),
      ...buildEvidenceBlocks(fact, lookup, conf, CTX),
    ];
    expect(allBlocks.length).toBeGreaterThan(0);
    for (const b of allBlocks) {
      expect(b.source_handler).toBe(SOURCE_HANDLER);
    }
  });

  it('uses graph_hash_at_run as graph_hash_at_generation (Codex correction #3)', () => {
    const fact = makeFact({
      decisionReview: { narrative_summary: 'A is ahead.' },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    for (const b of blocks) {
      expect(b.graph_hash_at_generation).toBe(GRAPH_HASH);
    }
  });

  it('stamps freshness = "fresh" on every block (Codex correction #4 — PR 2 fresh-only)', () => {
    const fact = makeFact({
      decisionReview: { narrative_summary: 'A is ahead.', key_assumptions: ['x'] },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const lookup = buildGraphNodeLookup(fact);
    const all = [
      ...buildReviewCardBlocks(fact, lookup, CTX),
      ...buildCoachingBlocks(fact, lookup, CTX),
    ];
    for (const b of all) {
      expect(b.freshness).toBe('fresh');
    }
  });

  it('stamps block_id as a UUID v5 (deterministic from signal_id) and created_at as ISO 8601 with offset', () => {
    const fact = makeFact({
      decisionReview: { narrative_summary: 'A is ahead.' },
    });
    const blocks = buildReviewCardBlocks(fact, new Map(), CTX);
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      // PR 3 — UUID v5 shape: version nibble = 5, variant nibble in [89ab].
      // Deterministic per (signal_id, V5_PHASE3_BLOCK_ID_NAMESPACE) so the
      // UI can dedupe across stale/fresh re-emissions of the same logical
      // block. Still passes z.string().uuid() at the boundary.
      expect(b.block_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      // ISO 8601 with offset — Z (UTC) or ±HH:MM.
      expect(b.created_at).toMatch(/T.*(Z|[+-]\d{2}:?\d{2})$/);
    }
  });

  it('stable signal_id AND stable block_id across reruns at same hash (PR 3 contract)', () => {
    const fact = makeFact({
      decisionReview: { narrative_summary: 'A is ahead.' },
    });
    const blocks1 = buildReviewCardBlocks(fact, new Map(), CTX);
    const blocks2 = buildReviewCardBlocks(fact, new Map(), CTX);
    // Same graph_hash → same signal_id (existing contract).
    expect(blocks1[0].signal_id).toBe(blocks2[0].signal_id);
    // PR 3 contract change: block_id is ALSO stable (deterministic
    // UUID v5 of the same signal_id). This is what lets the UI dedupe
    // the same logical block across stale-rebuild and fresh-rebuild
    // emissions on consecutive turns.
    expect(blocks1[0].block_id).toBe(blocks2[0].block_id);
  });
});

// ============================================================================
// Empty inputs / no decision_review
// ============================================================================

describe('empty inputs', () => {
  it('returns [] from every builder when enrichment.decision_review is absent', () => {
    const fact = makeFact();
    expect(buildReviewCardBlocks(fact, new Map(), CTX)).toEqual([]);
    expect(buildCoachingBlocks(fact, new Map(), CTX)).toEqual([]);
    expect(buildEvidenceBlocks(fact, new Map(), new Map(), CTX)).toEqual([]);
  });

  it('returns [] when decision_review is present but every field is missing', () => {
    const fact = makeFact({ decisionReview: {} });
    expect(buildReviewCardBlocks(fact, new Map(), CTX)).toEqual([]);
    expect(buildCoachingBlocks(fact, new Map(), CTX)).toEqual([]);
    expect(buildEvidenceBlocks(fact, new Map(), new Map(), CTX)).toEqual([]);
  });
});

// ============================================================================
// Round-3 review: fail-closed lookup-miss invariant tightening
// (P1.1 flip_threshold, P1.2 pre_mortem, P1.3 scenario_context)
// ============================================================================

describe('Round-3 fail-closed lookup-miss invariants', () => {
  it('flip_threshold: drops the card entirely when factor_id is not in the graph lookup (P1.1)', () => {
    const fact = makeFact({
      decisionReview: {
        flip_thresholds: [
          {
            factor_id: 'fac_not_in_graph',
            factor_label: 'Phantom factor',
            current_display: 'low',
            flip_display: 'high',
            narrative: 'A canonical-sounding narrative about the missing factor.',
          },
        ],
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    expect(blocks.filter((b) => b.card_kind === 'flip_threshold')).toHaveLength(0);
  });

  it('flip_threshold: title uses canonical graph label (not LLM-supplied factor_label) when lookup hits', () => {
    const fact = makeFact({
      decisionReview: {
        flip_thresholds: [
          {
            factor_id: 'fac_delivery_risk',
            // LLM-supplied label intentionally diverges from canonical label.
            factor_label: 'Different LLM Label',
            current_display: 'low',
            flip_display: 'high',
            narrative: 'A move from low to high would flip the result.',
          },
        ],
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    const flip = blocks.find((b) => b.card_kind === 'flip_threshold');
    expect(flip).toBeDefined();
    // Canonical label wins; LLM-supplied label is not propagated.
    expect(flip?.title).toContain('Delivery risk');
    expect(flip?.title).not.toContain('Different LLM Label');
  });

  // DGAI #342(1): REPLACES the former "no claim, no harm" pin. The harm was
  // real — downstream surfaces re-render this body verbatim (the Decision-
  // overview framing-question slot), so an unanchored canned narrative reads
  // as a statement about the user's decision with no model context. Fully
  // context-free ⇒ dropped; prose that names a graph node still emits with
  // honest empty target_refs (the LLM made no grounding claim).
  it('pre_mortem: DROPS when grounded_in is absent and the prose names no graph node (context_unanchored, DGAI #342)', () => {
    const fact = makeFact({
      decisionReview: {
        pre_mortem: {
          failure_scenario: 'A canonical pre-mortem narrative.',
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    expect(blocks.filter((b) => b.card_kind === 'pre_mortem')).toHaveLength(0);
  });

  it('pre_mortem: emits with empty target_refs when grounded_in is absent but the prose names a graph node', () => {
    const fact = makeFact({
      decisionReview: {
        pre_mortem: {
          failure_scenario: 'Cost overrun risk was underestimated from the start.',
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    const pm = blocks.find((b) => b.card_kind === 'pre_mortem');
    expect(pm).toBeDefined();
    expect(pm?.target_refs).toEqual([]);
    // DGAI #342(1) BIND rule: the body stands alone as a hypothetical.
    expect(pm?.body).toBe(
      'Imagine this decision has failed: Cost overrun risk was underestimated from the start.',
    );
  });

  it('pre_mortem: drops the card when grounded_in was provided but EVERY entry misses lookup (P1.2)', () => {
    const fact = makeFact({
      decisionReview: {
        pre_mortem: {
          failure_scenario: 'A canonical pre-mortem narrative.',
          grounded_in: ['fac_ghost_a', 'fac_ghost_b'],
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    expect(blocks.filter((b) => b.card_kind === 'pre_mortem')).toHaveLength(0);
  });

  it('pre_mortem: emits with the resolvable subset when grounded_in is partially valid', () => {
    const fact = makeFact({
      decisionReview: {
        pre_mortem: {
          failure_scenario: 'A canonical pre-mortem narrative.',
          grounded_in: ['fac_delivery_risk', 'fac_ghost'],
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    const pm = blocks.find((b) => b.card_kind === 'pre_mortem');
    expect(pm).toBeDefined();
    expect(pm?.target_refs.map((r) => r.id)).toEqual(['fac_delivery_risk']);
  });

  it('scenario_context: drops the card when the keyed edge_id is not in the graph lookup (P1.3)', () => {
    const fact = makeFact({
      decisionReview: {
        scenario_contexts: {
          edge_ghost: {
            trigger_description: 'A canonical-sounding trigger',
            consequence: 'A canonical-sounding consequence.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    expect(blocks.filter((b) => b.card_kind === 'scenario_context')).toHaveLength(0);
  });
});

// ============================================================================
// Round-3 review: adversarial prose-guard tests (P1.4)
// Each builder is tested against an LLM emission containing forbidden
// phrases, raw decimals, or entity-id-shaped tokens. The block must DROP
// rather than reach the wire.
// ============================================================================

describe('Round-3 adversarial prose-guard (P1.4)', () => {
  // Pre-condition for adversarial assertions: clean baselines emit blocks.
  // Each adversarial case mutates ONLY the prose field under test so the
  // delta proves the prose guard is what dropped the block — not a
  // structural issue.

  const cleanLookup = buildGraphNodeLookup(
    makeFact({ graphNodes: STANDARD_GRAPH_NODES }),
  );
  const cleanConf = new Map<string, 'high' | 'medium' | 'low'>([
    ['fac_delivery_risk', 'low'],
  ]);

  // RC4 (2026-07-15 session RCA): banned RECOMMENDATION/WINNER language is a
  // REWRITABLE lexicon offence — the proportionate remedy is a deterministic
  // terminology substitution (prompt TERMINOLOGY map), not a block drop. The
  // previous versions of these tests pinned the drop remedy; they now pin the
  // rewrite. Non-rewritable offences (raw decimals, raw ids) keep the drop.
  it('narrative card survives with banned recommendation language rewritten', () => {
    const fact = makeFact({
      decisionReview: {
        narrative_summary: 'Our recommendation is to launch immediately.',
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, cleanLookup, CTX);
    const narrative = blocks.filter((b) => b.card_kind === 'narrative');
    expect(narrative).toHaveLength(1);
    expect(narrative[0]!.body).toBe('Our leading option is to launch immediately.');
  });

  it('narrative card drops when narrative_summary contains a raw decimal probability', () => {
    const fact = makeFact({
      decisionReview: {
        narrative_summary: 'Plan A leads with win probability 0.73 over Plan B.',
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, cleanLookup, CTX);
    expect(blocks.filter((b) => b.card_kind === 'narrative')).toHaveLength(0);
  });

  it('narrative card drops when narrative_summary contains an entity-id-shaped token', () => {
    const fact = makeFact({
      decisionReview: {
        narrative_summary: 'The leading option is option_a1b2c3d4 by a wide margin.',
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, cleanLookup, CTX);
    expect(blocks.filter((b) => b.card_kind === 'narrative')).toHaveLength(0);
  });

  it('bias card survives with banned "winning option" language rewritten', () => {
    const fact = makeFact({
      decisionReview: {
        bias_findings: [
          {
            type: 'CONFIRMATION_BIAS',
            source: 'structural',
            description: 'The model favours the winning option without sufficient evidence.',
            affected_elements: ['fac_delivery_risk'],
          },
        ],
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, cleanLookup, CTX);
    const bias = blocks.filter((b) => b.card_kind === 'bias');
    expect(bias).toHaveLength(1);
    expect(bias[0]!.body).toBe(
      'The model favours the leading option without sufficient evidence.',
    );
  });

  it('robustness card drops when summary contains a raw decimal sensitivity value', () => {
    const fact = makeFact({
      decisionReview: {
        robustness_explanation: {
          summary: 'The result is sensitive at the 0.42 threshold.',
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, cleanLookup, CTX);
    expect(blocks.filter((b) => b.card_kind === 'robustness')).toHaveLength(0);
  });

  it('flip_threshold card survives with banned recommendation language rewritten', () => {
    const fact = makeFact({
      decisionReview: {
        flip_thresholds: [
          {
            factor_id: 'fac_delivery_risk',
            factor_label: 'Delivery risk',
            current_display: 'low',
            flip_display: 'high',
            narrative: 'The recommendation hinges on delivery risk staying low.',
          },
        ],
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, cleanLookup, CTX);
    const flips = blocks.filter((b) => b.card_kind === 'flip_threshold');
    expect(flips).toHaveLength(1);
    expect(flips[0]!.body).toBe('The leading option hinges on delivery risk staying low.');
  });

  it('assumption card drops when key_assumption text contains an entity-id-shaped token', () => {
    const fact = makeFact({
      decisionReview: {
        key_assumptions: ['factor_xy12abcd remains stable across the window.'],
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, cleanLookup, CTX);
    expect(blocks.filter((b) => b.card_kind === 'assumption')).toHaveLength(0);
  });

  it('scenario_context card survives with a banned (rewritable) phrase rewritten', () => {
    const fact = makeFact({
      decisionReview: {
        scenario_contexts: {
          edge_delivery_goal: {
            trigger_description: 'If delivery risk spikes',
            consequence: 'the recommendation flips to overseas.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, cleanLookup, CTX);
    const scenarios = blocks.filter((b) => b.card_kind === 'scenario_context');
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]!.body).toBe(
      'If delivery risk spikes. the leading option flips to overseas.',
    );
  });

  it('coaching assumption_check survives with banned recommendation language rewritten', () => {
    const fact = makeFact({
      decisionReview: {
        key_assumptions: ['Our recommendation assumes market growth continues.'],
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildCoachingBlocks(fact, cleanLookup, CTX);
    const checks = blocks.filter((b) => b.coaching_kind === 'assumption_check');
    expect(checks).toHaveLength(1);
    expect(checks[0]!.body).toContain('Our leading option assumes market growth continues');
  });

  it('coaching calibration_prompt drops when question prose contains a raw decimal', () => {
    const fact = makeFact({
      decisionReview: {
        decision_quality_prompts: [
          {
            question: 'What would change your mind if win probability dropped to 0.4?',
            principle: 'Disconfirmation',
          },
        ],
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildCoachingBlocks(fact, cleanLookup, CTX);
    expect(blocks.filter((b) => b.coaching_kind === 'calibration_prompt')).toHaveLength(0);
  });

  it('evidence block survives with banned "the winner" prescriptive phrasing rewritten (RC4)', () => {
    const fact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: 'pull retention numbers',
            rationale: 'This evidence picks the winner cleanly.',
            evidence_type: 'internal_data',
            decision_hygiene: 'estimate first',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      factorSensitivity: [{ factor_id: 'fac_delivery_risk', confidence: 0.2 }],
    });
    const blocks = buildEvidenceBlocks(fact, cleanLookup, cleanConf, CTX);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.evidence_gap).toBe('This evidence picks the leading option cleanly.');
    expect(blocks[0]!.evidence_gap).not.toMatch(/\bthe\s+winners?\b/i);
  });

  it('evidence block drops when impact_if_gathered contains a raw decimal sensitivity value', () => {
    const fact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: 'pull retention numbers',
            rationale: 'delivery rate is the variance driver',
            evidence_type: 'internal_data',
            decision_hygiene: 'Reduces variance by 0.18 in our estimate.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      factorSensitivity: [{ factor_id: 'fac_delivery_risk', confidence: 0.2 }],
    });
    const blocks = buildEvidenceBlocks(fact, cleanLookup, cleanConf, CTX);
    expect(blocks).toHaveLength(0);
  });
});

// ============================================================================
// Round-4 review: short-prefix entity-ID coverage + telemetry redaction
// (P1.1 ENTITY_ID_LEAK_RE reuse, P1.2 raw-ID sample redaction)
// ============================================================================

describe('Round-4 short-prefix entity-ID prose guard', () => {
  // Adversarial cases for the four short prefixes the round-3 regex missed:
  // `fac_`, `opt_`, `con_`, `out_`. Each should DROP via the shared
  // ENTITY_ID_LEAK_RE + isSlugShapedEntityId gate.
  const lookup = buildGraphNodeLookup(
    makeFact({ graphNodes: STANDARD_GRAPH_NODES }),
  );

  it.each([
    ['fac_delivery_risk', 'narrative_summary'],
    ['opt_hire_local', 'narrative_summary'],
    ['con_budget_cap', 'narrative_summary'],
    ['out_revenue_q3', 'narrative_summary'],
  ])('drops narrative card when prose contains short-prefix ID %s', (rawId) => {
    const fact = makeFact({
      decisionReview: {
        narrative_summary: `Plan A leads when ${rawId} stays low.`,
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, lookup, CTX);
    expect(blocks.filter((b) => b.card_kind === 'narrative')).toHaveLength(0);
  });

  it('drops EvidenceBlock when rationale contains a short-prefix ID', () => {
    const fact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: 'pull retention numbers',
            rationale: 'Strengthens evidence on opt_hire_local materially.',
            evidence_type: 'internal_data',
            decision_hygiene: 'estimate first',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      factorSensitivity: [{ factor_id: 'fac_delivery_risk', confidence: 0.2 }],
    });
    const blocks = buildEvidenceBlocks(
      fact,
      lookup,
      new Map([['fac_delivery_risk', 'low']]),
      CTX,
    );
    expect(blocks).toHaveLength(0);
  });
});

describe('Round-4 raw-ID telemetry redaction (P1.2)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => log);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('logs only the prefix suffix-form for raw_id drops; never the full token', () => {
    const fact = makeFact({
      decisionReview: {
        narrative_summary: 'Plan A leads when fac_delivery_risk stays low.',
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);

    // Exactly one warn fired and its payload omits the raw token suffix.
    const calls = warnSpy.mock.calls.filter(
      ([payload]) =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as Record<string, unknown>).event === 'v5.phase3.block_dropped',
    );
    expect(calls.length).toBeGreaterThan(0);
    const idDropCall = calls.find(
      ([payload]) =>
        (payload as Record<string, unknown>).drop_reason ===
        'prose_guard_raw_id',
    );
    expect(idDropCall).toBeDefined();
    const payload = idDropCall![0] as Record<string, unknown>;
    // The sample must be prefix-only (e.g. "fac_*"), NOT the raw token.
    expect(payload.sample).toBe('fac_*');
    // Defensive: the entire serialised payload must not contain the
    // raw suffix tokens. Catches any future field that accidentally
    // re-introduces the leak.
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain('delivery_risk');
    expect(serialised).not.toContain('fac_delivery_risk');
  });

  it('logs full-token matched substring for forbidden-phrase drops (safe — generic vocabulary)', () => {
    // RC4: the fixture must be a NON-rewritable (fatal-class) phrase —
    // rewritable lexicon offences ("recommendation") no longer drop; they
    // are rewritten in place and logged via v5.phase3.block_rewritten.
    const fact = makeFact({
      decisionReview: {
        narrative_summary: 'Our validator confirms the launch plan holds.',
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    const call = warnSpy.mock.calls.find(
      ([payload]) =>
        (payload as Record<string, unknown>).drop_reason ===
        'prose_guard_forbidden_phrase',
    );
    expect(call).toBeDefined();
    // Forbidden-phrase samples are generic banned vocabulary; logging
    // them is the operator signal for what to chase.
    expect((call![0] as Record<string, unknown>).sample).toMatch(
      /validator/i,
    );
  });

  it('RC4: a rewritable lexicon hit is VISIBLE via v5.phase3.block_rewritten telemetry, not a drop', () => {
    const infoSpy = vi.spyOn(log, 'info').mockImplementation(() => log);
    try {
      const fact = makeFact({
        decisionReview: {
          narrative_summary: 'Our recommendation is to launch.',
        },
        graphNodes: STANDARD_GRAPH_NODES,
      });
      buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
      // No drop fired for this block… (`call` not destructured — the spy's
      // calls are `any[]`, and a destructured binding would add a TS7031 to
      // the typecheck-drift census.)
      const dropCall = warnSpy.mock.calls.find(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>).drop_reason ===
          'prose_guard_forbidden_phrase',
      );
      expect(dropCall).toBeUndefined();
      // …and the rewrite is visible with gate id + term.
      const rewriteCall = infoSpy.mock.calls.find(
        ([payload]) =>
          typeof payload === 'object' &&
          payload !== null &&
          (payload as Record<string, unknown>).event ===
            'v5.phase3.block_rewritten',
      );
      expect(rewriteCall).toBeDefined();
      const payload = rewriteCall![0] as Record<string, unknown>;
      expect(payload.block_type).toBe('review_card');
      expect(JSON.stringify(payload.terms)).toMatch(/recommendation/i);
    } finally {
      infoSpy.mockRestore();
    }
  });
});

// ============================================================================
// Round-4 review: realistic graph shape — edges live under graph.edges
// (non-blocking follow-up; restores scenario_context emission in production)
// ============================================================================

describe('Round-4 realistic graph shape — edges under graph.edges', () => {
  // Build a fact that mirrors what the live enricher emits: edges live in
  // `enrichment.graph.edges[]`, NOT as `kind: 'edge'` entries in
  // `graph.nodes[]`. Without round-4's edge pass in `buildGraphNodeLookup`,
  // every scenario_context card would drop in production.
  function makeFactWithRealisticEdges(opts: {
    decisionReview: Record<string, unknown>;
    nodes: ReadonlyArray<Record<string, unknown>>;
    edges: ReadonlyArray<Record<string, unknown>>;
  }): RunAnalysisHandlerFact {
    return {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: 'scen-test',
        leading_option_id: 'opt_a',
        summary: 'Ran analysis.',
        enrichment: {
          decision_review: opts.decisionReview,
          graph: { nodes: opts.nodes, edges: opts.edges },
        },
        computed_at: '2026-05-16T14:59:00.000Z',
        graph_hash_at_run: GRAPH_HASH,
      },
    } as unknown as RunAnalysisHandlerFact;
  }

  it('emits a scenario_context card when the edge is in graph.edges with an explicit label', () => {
    const fact = makeFactWithRealisticEdges({
      decisionReview: {
        scenario_contexts: {
          edge_delivery_goal: {
            trigger_description: 'If delivery risk spikes during launch month',
            consequence: 'the alternative plan overtakes the leader.',
          },
        },
      },
      nodes: [FACTOR_DELIVERY, FACTOR_COST],
      edges: [
        {
          id: 'edge_delivery_goal',
          from_node_id: 'fac_delivery_risk',
          to_node_id: 'fac_cost_overrun',
          label: 'Delivery risk impacts cost overrun',
        },
      ],
    });
    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    const sc = blocks.find((b) => b.card_kind === 'scenario_context');
    expect(sc).toBeDefined();
    expect(sc?.target_refs[0]?.id).toBe('edge_delivery_goal');
    expect(sc?.target_refs[0]?.kind).toBe('edge');
    expect(sc?.target_refs[0]?.label).toBe('Delivery risk impacts cost overrun');
  });

  it('derives "from → to" label from endpoint nodes when edge has no explicit label', () => {
    const fact = makeFactWithRealisticEdges({
      decisionReview: {
        scenario_contexts: {
          edge_delivery_goal: {
            trigger_description: 'If delivery risk spikes',
            consequence: 'cost overrun follows.',
          },
        },
      },
      nodes: [FACTOR_DELIVERY, FACTOR_COST],
      edges: [
        {
          id: 'edge_delivery_goal',
          from_node_id: 'fac_delivery_risk',
          to_node_id: 'fac_cost_overrun',
          // No `label` — must be derived from endpoints.
        },
      ],
    });
    const lookup = buildGraphNodeLookup(fact);
    expect(lookup.get('edge_delivery_goal')?.label).toBe(
      'Delivery risk → Cost overrun risk',
    );
    const blocks = buildReviewCardBlocks(fact, lookup, CTX);
    const sc = blocks.find((b) => b.card_kind === 'scenario_context');
    expect(sc).toBeDefined();
    expect(sc?.target_refs[0]?.label).toBe('Delivery risk → Cost overrun risk');
  });

  it('still drops scenario_context when the edge ID is not in graph.edges either (true lookup miss)', () => {
    const fact = makeFactWithRealisticEdges({
      decisionReview: {
        scenario_contexts: {
          edge_ghost: {
            trigger_description: 'A trigger',
            consequence: 'A consequence.',
          },
        },
      },
      nodes: [FACTOR_DELIVERY, FACTOR_COST],
      edges: [
        {
          id: 'edge_delivery_goal',
          from_node_id: 'fac_delivery_risk',
          to_node_id: 'fac_cost_overrun',
        },
      ],
    });
    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    expect(blocks.filter((b) => b.card_kind === 'scenario_context')).toHaveLength(0);
  });

  it('skips an edge whose endpoints miss the node lookup (graph drift) — scenario_context drops downstream', () => {
    const fact = makeFactWithRealisticEdges({
      decisionReview: {
        scenario_contexts: {
          edge_drift: {
            trigger_description: 'A trigger',
            consequence: 'A consequence.',
          },
        },
      },
      nodes: [FACTOR_DELIVERY], // fac_cost_overrun absent → endpoint resolves to undefined
      edges: [
        {
          id: 'edge_drift',
          from_node_id: 'fac_delivery_risk',
          to_node_id: 'fac_cost_overrun', // not in nodes[]
          // No explicit label, so derivation requires both endpoints.
        },
      ],
    });
    const lookup = buildGraphNodeLookup(fact);
    expect(lookup.has('edge_drift')).toBe(false);
    const blocks = buildReviewCardBlocks(fact, lookup, CTX);
    expect(blocks.filter((b) => b.card_kind === 'scenario_context')).toHaveLength(0);
  });
});

// ============================================================================
// Doctrine D-U F2 (ROADMAP): critique/coaching must NOT name an option-set
// LEVER as a thing to "investigate / gather evidence on". A factor that a
// decision option intervenes on is a decision variable being SET, not an
// uncertain external factor to strengthen evidence about. The intervention-
// controlled (union-lever) set is threaded into the evidence surfaces so a
// lever-identity factor is dropped from the "investigate this" naming — the
// critique CHANNEL stays open (non-lever gaps still ship). Suppression is
// display-only: no producer number is read or changed.
// ============================================================================
describe('D-U F2 lever-identity filter on evidence "investigate this" surfaces', () => {
  function evidenceFactWithLever(): RunAnalysisHandlerFact {
    return makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: 'Pull on-time delivery rate from the last two releases.',
            rationale: 'Delivery rate is the largest variance driver here.',
            evidence_type: 'internal_data',
            decision_hygiene: 'Estimate first, then look at data.',
          },
          fac_cost_overrun: {
            specific_action: 'Talk to the finance team about historical overruns.',
            rationale: 'Cost variance is the second-largest driver.',
            evidence_type: 'expert_input',
            decision_hygiene: 'Assign someone to argue the cost will not overrun.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      factorSensitivity: [
        { factor_id: 'fac_delivery_risk', confidence: 0.2 },
        { factor_id: 'fac_cost_overrun', confidence: 0.6 },
      ],
      factorEvppi: [
        { factor_id: 'fac_delivery_risk', evppi: 0.4, status: 'resolved' },
        { factor_id: 'fac_cost_overrun', evppi: 0.2, status: 'resolved' },
      ],
    });
  }

  it('buildEvidenceBlocks drops the lever-named block, keeps the non-lever block', () => {
    const fact = evidenceFactWithLever();
    // fac_delivery_risk is a lever (an option intervenes on it).
    const levers = new Set(['fac_delivery_risk']);
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
      levers,
    );
    expect(blocks.map((b) => b.factor_ref.id)).toEqual(['fac_cost_overrun']);
    // channel preserved: the surviving non-lever block re-ranks to priority 1.
    expect(blocks[0].priority_rank).toBe(1);
  });

  it('buildEvidenceBlocks without a lever set is unchanged (both named)', () => {
    const fact = evidenceFactWithLever();
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );
    expect(blocks.map((b) => b.factor_ref.id)).toEqual([
      'fac_delivery_risk',
      'fac_cost_overrun',
    ]);
  });

  it('evidence_priority card refuses a producer priority that contradicts the lever authority', () => {
    const fact = evidenceFactWithLever();
    const levers = new Set(['fac_delivery_risk']);
    const blocks = buildReviewCardBlocks(
      fact,
      buildGraphNodeLookup(fact),
      CTX,
      levers,
    );
    const ep = blocks.find((b) => b.card_kind === 'evidence_priority');
    expect(ep).toBeUndefined();
    // Never promote row two into a rank the producer did not give it.
    expect(blocks.some((b) => b.title.includes('Cost overrun'))).toBe(false);
  });

  it('evidence_priority card is dropped when the only gap is a lever (channel stays honest)', () => {
    const fact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_delivery_risk: {
            specific_action: 'Pull on-time delivery rate.',
            rationale: 'Delivery rate is the largest variance driver here.',
            evidence_type: 'internal_data',
            decision_hygiene: 'Estimate first, then look at data.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
      factorSensitivity: [{ factor_id: 'fac_delivery_risk', confidence: 0.2 }],
      factorEvppi: [
        { factor_id: 'fac_delivery_risk', evppi: 0.4, status: 'resolved' },
      ],
    });
    const blocks = buildReviewCardBlocks(
      fact,
      buildGraphNodeLookup(fact),
      CTX,
      new Set(['fac_delivery_risk']),
    );
    expect(blocks.find((b) => b.card_kind === 'evidence_priority')).toBeUndefined();
  });
});

// ============================================================================
// Doctrine D-U F2 (assumption surface, PR #444 residual): the SAME ruling one
// surface further. `key_assumptions` prose is emitted as FREE TEXT with no
// factor_id, yet it still NAMES option-set levers — e.g. "Equity Offered to CTO
// has a direct relationship with their decision to accept" (action=confirm_
// factor) on live staging. A lever is a decision variable being SET, not a
// load-bearing UNCERTAINTY to confirm, so it must not be named as an assumption
// to check. Membership stays STRUCTURAL (factor_id in the union set, resolved
// to its label via the same lookup); the label is used ONLY to detect the
// naming in the free text. Whole-phrase boundary match — a shared bare token
// (the live "CTO" collision) must NOT over-suppress a non-lever assumption.
// Channel stays open (non-lever assumptions still ship); empty set ⇒ unchanged.
// ============================================================================
describe('D-U F2 lever-identity filter on assumption "confirm this" surfaces', () => {
  // fac_delivery_risk (label "Delivery risk") is the lever; fac_cost_overrun
  // (label "Cost overrun risk") is a NON-lever factor — it must still ship.
  const ASSUMPTIONS = [
    'Delivery risk is understood and controlled by the chosen option.', // lever → drop
    'Cost overrun risk is accurately estimated.', // non-lever factor → ship
    'Delivery timelines stay predictable through the launch window.', // token-only "Delivery", NOT the whole lever phrase → ship
    'Market conditions persist through the launch window.', // no factor named → ship
  ] as const;

  function assumptionFact(): RunAnalysisHandlerFact {
    return makeFact({
      decisionReview: { key_assumptions: [...ASSUMPTIONS] },
      graphNodes: STANDARD_GRAPH_NODES,
    });
  }

  it('buildReviewCardBlocks drops the lever-named assumption card, keeps every non-lever assumption', () => {
    const fact = assumptionFact();
    const blocks = buildReviewCardBlocks(
      fact,
      buildGraphNodeLookup(fact),
      CTX,
      new Set(['fac_delivery_risk']),
    );
    const bodies = blocks
      .filter((b) => b.card_kind === 'assumption')
      .map((b) => b.body);
    expect(bodies).toEqual([
      'Cost overrun risk is accurately estimated.',
      'Delivery timelines stay predictable through the launch window.',
      'Market conditions persist through the launch window.',
    ]);
  });

  it('buildCoachingBlocks drops the lever-named assumption_check, keeps every non-lever one', () => {
    const fact = assumptionFact();
    const blocks = buildCoachingBlocks(
      fact,
      buildGraphNodeLookup(fact),
      CTX,
      new Set(['fac_delivery_risk']),
    );
    const bodies = blocks
      .filter((b) => b.coaching_kind === 'assumption_check')
      .map((b) => b.body);
    expect(bodies).toEqual([
      'Cost overrun risk is accurately estimated.',
      'Delivery timelines stay predictable through the launch window.',
      'Market conditions persist through the launch window.',
    ]);
  });

  it('without a lever set both surfaces are byte-identical (every assumption ships)', () => {
    const fact = assumptionFact();
    const lookup = buildGraphNodeLookup(fact);
    const review = buildReviewCardBlocks(fact, lookup, CTX)
      .filter((b) => b.card_kind === 'assumption')
      .map((b) => b.body);
    const coaching = buildCoachingBlocks(fact, lookup, CTX)
      .filter((b) => b.coaching_kind === 'assumption_check')
      .map((b) => b.body);
    expect(review).toEqual([...ASSUMPTIONS]);
    expect(coaching).toEqual([...ASSUMPTIONS]);
  });
});

// ============================================================================
// Finding 5 (Codex): the free-text lever matcher UNDER- and OVER-suppresses.
//   (a) UNDER: "Time-to-market" (hyphenated lever label) fails to match the
//       spaced prose "Time to market" because punctuation was not normalised.
//   (b) OVER: the generic single-word label "Cost" suppresses a NON-lever
//       assumption ("Implementation cost estimates are uncertain") that merely
//       uses the word — a bare generic token must require stronger identity.
// Structural factor_id suppression is unaffected; only the free-text NAME scan
// is corrected. Fail-closed: err toward keeping an honest surface.
// ============================================================================
describe('Finding 5 — free-text lever matcher normalisation', () => {
  const TTM_FACTOR = { id: 'fac_ttm', label: 'Time-to-market', kind: 'factor' };
  const COST_FACTOR = { id: 'fac_cost', label: 'Cost', kind: 'factor' };

  it('UNDER-suppress fix: hyphenated lever label "Time-to-market" matches spaced prose "Time to market"', () => {
    const fact = makeFact({
      decisionReview: {
        key_assumptions: [
          'Time to market is correctly estimated.', // names the lever (punctuation differs) → drop
          'Market conditions persist through the launch window.', // non-lever → ship
        ],
      },
      graphNodes: [TTM_FACTOR],
    });
    const bodies = buildReviewCardBlocks(
      fact,
      buildGraphNodeLookup(fact),
      CTX,
      new Set(['fac_ttm']),
    )
      .filter((b) => b.card_kind === 'assumption')
      .map((b) => b.body);
    expect(bodies).toEqual(['Market conditions persist through the launch window.']);
  });

  it('OVER-suppress fix: generic single-word lever "Cost" does NOT drop a non-lever assumption using the word', () => {
    const fact = makeFact({
      decisionReview: {
        key_assumptions: ['Implementation cost estimates are uncertain.'],
      },
      graphNodes: [COST_FACTOR],
    });
    const bodies = buildReviewCardBlocks(
      fact,
      buildGraphNodeLookup(fact),
      CTX,
      new Set(['fac_cost']),
    )
      .filter((b) => b.card_kind === 'assumption')
      .map((b) => b.body);
    expect(bodies).toEqual(['Implementation cost estimates are uncertain.']);
  });

  it('a distinctive single-word lever label still suppresses (generic guard is narrow)', () => {
    const KUBERNETES = { id: 'fac_k8s', label: 'Kubernetes', kind: 'factor' };
    const fact = makeFact({
      decisionReview: {
        key_assumptions: ['Kubernetes is the right platform for this workload.'],
      },
      graphNodes: [KUBERNETES],
    });
    const bodies = buildReviewCardBlocks(
      fact,
      buildGraphNodeLookup(fact),
      CTX,
      new Set(['fac_k8s']),
    )
      .filter((b) => b.card_kind === 'assumption')
      .map((b) => b.body);
    expect(bodies).toEqual([]); // distinctive token → suppressed
  });
});

// ============================================================================
// Finding 1 (Codex): the D-U lever-naming guard must cover EVERY free-text
// decision-review surface — narrative, pre-mortem, scenario, and calibration
// question — not just the evidence + assumption surfaces (#444/#445). A lever
// named as an uncertainty on any of these leaks the same D-U integrity defect.
// Display/suppression only: no producer number is read; a suppressed item is
// ABSENT, and non-lever items on the same channel still ship.
// ============================================================================
describe('Finding 1 — lever-naming guard on all free-text surfaces', () => {
  const LEVERS = new Set(['fac_delivery_risk']); // label "Delivery risk"

  it('narrative naming the lever is dropped; a non-lever narrative ships', () => {
    const named = makeFact({
      decisionReview: {
        narrative_summary: 'The outcome hinges on Delivery risk, which stays deeply uncertain.',
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    expect(
      buildReviewCardBlocks(named, buildGraphNodeLookup(named), CTX, LEVERS)
        .find((b) => b.card_kind === 'narrative'),
    ).toBeUndefined();

    const clean = makeFact({
      decisionReview: {
        narrative_summary: 'The outcome hinges on market timing, which stays uncertain.',
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    expect(
      buildReviewCardBlocks(clean, buildGraphNodeLookup(clean), CTX, LEVERS)
        .find((b) => b.card_kind === 'narrative'),
    ).toBeDefined();
  });

  // ⚠ INVERTED BY RULING (2026-07-31). This test used to assert the pre_mortem
  // card was DROPPED when its failure prose named a lever, and it was correct
  // for the doctrine as then scoped. The guard was then MEASURED against the
  // walk's real captured bytes (fix-2211-lens-emission.md §1.1-1.4) and found
  // to be eating 2 of the 4 turns where the producer emitted anything — a 50%
  // loss rate on this card from a guard written for a different surface.
  //
  // RULING: a pre-mortem names the lever as a failure WATCH-POINT ("imagine the
  // option you chose did not pay off"), which is coaching, not steering. The
  // ban is scoped out of THIS surface only; every sibling assertion in this
  // describe block is unchanged and still passing, which is what keeps the
  // ruling narrow. Full scope pins live in `pre-mortem-lever-ruling.test.ts`.
  it('pre_mortem whose failure prose names the lever now SHIPS (lever ban scoped out of this surface)', () => {
    const fact = makeFact({
      decisionReview: {
        pre_mortem: { failure_scenario: 'The project fails because Delivery risk was mismanaged.' },
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const card = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS)
      .find((b) => b.card_kind === 'pre_mortem');
    expect(card).toBeDefined();
    expect(card?.body).toContain('Delivery risk');
  });

  it('scenario_context whose trigger/consequence names the lever is skipped', () => {
    const fact = makeFact({
      decisionReview: {
        scenario_contexts: {
          edge_delivery_goal: {
            trigger_description: 'If Delivery risk spikes',
            consequence: 'the launch slips badly.',
          },
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    expect(
      buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS)
        .find((b) => b.card_kind === 'scenario_context'),
    ).toBeUndefined();
  });

  it('calibration_prompt question naming the lever is dropped; non-lever prompts ship', () => {
    const fact = makeFact({
      decisionReview: {
        decision_quality_prompts: [
          { question: 'How confident are you about Delivery risk?', principle: 'Calibration' },
          { question: 'Have you considered the base rate?', principle: 'Base rates' },
        ],
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const bodies = buildCoachingBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS)
      .filter((b) => b.coaching_kind === 'calibration_prompt')
      .map((b) => b.body);
    expect(bodies).toEqual(['Have you considered the base rate?']);
  });

  it('without a lever set every free-text surface ships (byte-identical)', () => {
    const fact = makeFact({
      decisionReview: {
        narrative_summary: 'The outcome hinges on Delivery risk, which stays deeply uncertain.',
        pre_mortem: { failure_scenario: 'The project fails because Delivery risk was mismanaged.' },
        scenario_contexts: {
          edge_delivery_goal: {
            trigger_description: 'If Delivery risk spikes',
            consequence: 'the launch slips badly.',
          },
        },
        decision_quality_prompts: [
          { question: 'How confident are you about Delivery risk?', principle: 'Calibration' },
        ],
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const lookup = buildGraphNodeLookup(fact);
    const cards = buildReviewCardBlocks(fact, lookup, CTX); // no lever set
    expect(cards.find((b) => b.card_kind === 'narrative')).toBeDefined();
    expect(cards.find((b) => b.card_kind === 'pre_mortem')).toBeDefined();
    expect(cards.find((b) => b.card_kind === 'scenario_context')).toBeDefined();
    const cal = buildCoachingBlocks(fact, lookup, CTX)
      .filter((b) => b.coaching_kind === 'calibration_prompt');
    expect(cal).toHaveLength(1);
  });
});

// ============================================================================
// RC4 proportionate remedies — REWRITE-DON'T-DROP for the prescriptive
// lexicon. Live evidence (2026-07-15 session RCA): the robustness review
// card was DROPPED at egress for containing the word "recommendation"
// (`prose_guard_forbidden_phrase`, sample "recommendation") on every review
// emission — generated coaching destroyed by its own guard. The remedy for
// a REWRITABLE lexicon offence is now a deterministic terminology
// substitution (prompt TERMINOLOGY map: "recommendation" → "leading
// option"); the block SURVIVES with the term rewritten. Fatal classes
// (denial phrases, raw decimals, raw ids, lever-naming, lookup misses)
// keep their drop remedy — pinned below.
// ============================================================================

describe('RC4 rewrite-don\'t-drop — rewritable lexicon offences survive rewritten', () => {
  const cleanLookup = buildGraphNodeLookup(
    makeFact({ graphNodes: STANDARD_GRAPH_NODES }),
  );

  it('robustness card SURVIVES with "recommendation" rewritten to "leading option" (tonight\'s live kill)', () => {
    const fact = makeFact({
      decisionReview: {
        robustness_explanation: {
          summary:
            'The recommendation is robust: it holds across most plausible scenarios, and only a large shift in delivery risk would overturn it.',
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, cleanLookup, CTX);
    const robustness = blocks.filter((b) => b.card_kind === 'robustness');
    expect(robustness).toHaveLength(1);
    expect(robustness[0]!.body).toBe(
      'The leading option is robust: it holds across most plausible scenarios, and only a large shift in delivery risk would overturn it.',
    );
    expect(robustness[0]!.body).not.toMatch(/\brecommendations?\b/i);
  });

  // ── FATAL classes keep the drop remedy — do NOT weaken. ──────────────────

  it('still DROPS when a denial phrase (fatal class) accompanies a rewritable term', () => {
    const fact = makeFact({
      decisionReview: {
        narrative_summary:
          'Nothing changed on the model, so the recommendation stands as before.',
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, cleanLookup, CTX);
    expect(blocks.filter((b) => b.card_kind === 'narrative')).toHaveLength(0);
  });

  it('still DROPS on a raw decimal even when a rewritable term is also present', () => {
    const fact = makeFact({
      decisionReview: {
        robustness_explanation: {
          summary: 'The recommendation is sensitive at the 0.42 threshold.',
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, cleanLookup, CTX);
    expect(blocks.filter((b) => b.card_kind === 'robustness')).toHaveLength(0);
  });

  it('still DROPS on an internal-jargon phrase with no safe rewrite', () => {
    const fact = makeFact({
      decisionReview: {
        narrative_summary: 'The validator confirmed the launch plan is coherent.',
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, cleanLookup, CTX);
    expect(blocks.filter((b) => b.card_kind === 'narrative')).toHaveLength(0);
  });
});

// ============================================================================
// Wave-2 ask 1 (UI-SEM-085, 0.19.0): producer-owned category + priority on
// EVERY guidance block CEE emits. Before this, the UI invented both on 10/10
// live blocks. The pins below run the REAL builders over the rich fixture and
// assert (a) presence on every block, (b) coherence with the single
// guidance-signals source — a build site that hand-rolls its own values, or a
// new site that forgets the fields, goes red here.
// ============================================================================

describe('wave-2 guidance signals — every emitted block carries coherent category + priority', () => {
  const fact = makeFact({
    decisionReview: RICH_DR,
    graphNodes: STANDARD_GRAPH_NODES,
    factorSensitivity: [{ factor_id: 'fac_delivery_risk', confidence: 0.2 }],
  });
  const lookup = buildGraphNodeLookup(fact);
  const conf = buildFactorConfidenceLookup(fact);

  const review = buildReviewCardBlocks(fact, lookup, CTX);
  const coaching = buildCoachingBlocks(fact, lookup, CTX);
  const evidence = buildEvidenceBlocks(fact, lookup, conf, CTX);
  const stale = buildStaleRerunCoachingBlock(CTX);

  it('positive control: the fixture produces blocks of every family', () => {
    expect(review.length).toBeGreaterThan(0);
    expect(coaching.length).toBeGreaterThan(0);
    expect(evidence.length).toBeGreaterThan(0);
    expect(stale).not.toBeNull();
  });

  it('every ReviewCard carries category+priority derived from ITS severity', () => {
    for (const b of review) {
      const expected = guidanceSignalsForSeverity(b.severity);
      expect(b.category, `${b.card_kind} category`).toBe(expected.category);
      expect(b.priority, `${b.card_kind} priority`).toBe(expected.priority);
    }
  });

  it('every EvidenceBlock carries category+priority derived from ITS severity', () => {
    for (const b of evidence) {
      const expected = guidanceSignalsForSeverity(b.severity);
      expect(b.category).toBe(expected.category);
      expect(b.priority).toBe(expected.priority);
    }
  });

  it('every CoachingBlock carries category+priority derived from ITS coaching_kind', () => {
    for (const b of [...coaching, stale!]) {
      const expected = guidanceSignalsForCoachingKind(b.coaching_kind);
      expect(b.category, `${b.coaching_kind} category`).toBe(expected.category);
      expect(b.priority, `${b.coaching_kind} priority`).toBe(expected.priority);
    }
  });

  it('the stale-rerun nudge is should_fix — the UI can filter housekeeping out of the framing slot', () => {
    expect(stale!.coaching_kind).toBe('orientation');
    expect(stale!.category).toBe('should_fix');
  });

  it('priority is ALWAYS the 1:1 category derivation (the stated 0.19.0 contract)', () => {
    for (const b of [...review, ...coaching, ...evidence, stale!]) {
      expect(b.category).toBeDefined();
      expect(b.priority).toBe(PRIORITY_BY_CATEGORY[b.category!]);
    }
  });
});

// ============================================================================
// ROADMAP 1.120 residual (UI-SEM-085, @talchain/schemas 0.20.0/0.21.0):
// producer-owned `signal_code` (+ `signal` where deterministic) on EVERY
// guidance block. Before this, the UI INVENTED signal_code from `block.type`
// on 10/10 live blocks — matching no real detector code. The pins below run
// the REAL builders over the rich fixture and assert (a) presence on every
// block, (b) the code is derived from the block's OWN kind via the single
// guidance-signals source, (c) the exact vocabulary values (the mutation
// target — flipping a code in the map turns these red), and (d) the negative
// control: no block ever re-invents its code from its `type`.
// ============================================================================

describe('1.120 signal provenance — every emitted block carries a coherent signal_code', () => {
  const fact = makeFact({
    decisionReview: RICH_DR,
    graphNodes: STANDARD_GRAPH_NODES,
    factorSensitivity: [{ factor_id: 'fac_delivery_risk', confidence: 0.2 }],
  });
  const lookup = buildGraphNodeLookup(fact);
  const conf = buildFactorConfidenceLookup(fact);

  const review = buildReviewCardBlocks(fact, lookup, CTX);
  const coaching = buildCoachingBlocks(fact, lookup, CTX);
  const evidence = buildEvidenceBlocks(fact, lookup, conf, CTX);
  const stale = buildStaleRerunCoachingBlock(CTX);
  const all = [...review, ...coaching, ...evidence, stale!];

  // Positive control: the absence/negative assertions below are only
  // meaningful if the fixture actually produces blocks to inspect.
  it('positive control: the fixture produces review, coaching and evidence blocks', () => {
    expect(review.length).toBeGreaterThan(0);
    expect(coaching.length).toBeGreaterThan(0);
    expect(evidence.length).toBeGreaterThan(0);
    expect(stale).not.toBeNull();
  });

  it('every emitted block carries a non-empty signal_code', () => {
    for (const b of all) {
      expect(b.signal_code, `${b.type} signal_code present`).toBeDefined();
      expect(typeof b.signal_code).toBe('string');
      expect((b.signal_code ?? '').length).toBeGreaterThan(0);
    }
  });

  it('every ReviewCard signal_code is derived from ITS card_kind (single source)', () => {
    for (const b of review) {
      const expected = reviewCardSignals(b.card_kind, b.severity).signal_code;
      expect(b.signal_code, `${b.card_kind} signal_code`).toBe(expected);
    }
  });

  it('every CoachingBlock signal_code is derived from ITS coaching_kind (single source)', () => {
    for (const b of [...coaching, stale!]) {
      const expected = guidanceSignalsForCoachingKind(b.coaching_kind).signal_code;
      expect(b.signal_code, `${b.coaching_kind} signal_code`).toBe(expected);
    }
  });

  it('every EvidenceBlock signal_code is derived from the evidence detector (single source)', () => {
    for (const b of evidence) {
      expect(b.signal_code).toBe(evidenceSignals(b.severity).signal_code);
    }
  });

  // The vocabulary pin — the mutation target. Flipping any entry in the
  // guidance-signals code maps turns exactly this test red.
  it('pins the exact signal_code vocabulary per card_kind', () => {
    const expectedByCardKind: Record<string, string> = {
      narrative: GUIDANCE_SIGNAL_CODES.ANALYSIS_NARRATIVE,
      pre_mortem: GUIDANCE_SIGNAL_CODES.PRE_MORTEM,
      flip_threshold: GUIDANCE_SIGNAL_CODES.FLIP_THRESHOLD,
      bias: GUIDANCE_SIGNAL_CODES.COGNITIVE_BIAS,
      robustness: GUIDANCE_SIGNAL_CODES.FRAGILE_RESULT,
      evidence_priority: GUIDANCE_SIGNAL_CODES.EVIDENCE_GAP,
      assumption: GUIDANCE_SIGNAL_CODES.ASSUMPTION_CHECK,
      scenario_context: GUIDANCE_SIGNAL_CODES.SCENARIO_CONTEXT,
    };
    for (const b of review) {
      expect(b.signal_code, `${b.card_kind} → code`).toBe(expectedByCardKind[b.card_kind]);
    }
  });

  it('pins the exact signal_code vocabulary per coaching_kind + the evidence code', () => {
    const expectedByCoachingKind: Record<string, string> = {
      orientation: GUIDANCE_SIGNAL_CODES.STALE_ANALYSIS,
      bias_signal: GUIDANCE_SIGNAL_CODES.COGNITIVE_BIAS,
      assumption_check: GUIDANCE_SIGNAL_CODES.ASSUMPTION_CHECK,
      calibration_prompt: GUIDANCE_SIGNAL_CODES.CALIBRATION_PROMPT,
    };
    for (const b of [...coaching, stale!]) {
      expect(b.signal_code, `${b.coaching_kind} → code`).toBe(
        expectedByCoachingKind[b.coaching_kind],
      );
    }
    for (const b of evidence) {
      expect(b.signal_code).toBe(GUIDANCE_SIGNAL_CODES.EVIDENCE_GAP);
    }
  });

  // The card `assumption` and the coaching `assumption_check` read the SAME
  // decision_review source (key_assumptions), so they MUST share one code — a
  // deliberate unification (never two names for one meaning).
  it('unifies the two assumption surfaces under one code', () => {
    const cardAssumption = review.find((b) => b.card_kind === 'assumption');
    const coachAssumption = coaching.find((b) => b.coaching_kind === 'assumption_check');
    expect(cardAssumption).toBeDefined();
    expect(coachAssumption).toBeDefined();
    expect(cardAssumption!.signal_code).toBe(GUIDANCE_SIGNAL_CODES.ASSUMPTION_CHECK);
    expect(coachAssumption!.signal_code).toBe(cardAssumption!.signal_code);
  });

  // Negative control: the ORIGINAL defect was signal_code invented from
  // block.type ('review_card' / 'coaching' / 'evidence'). Prove no block
  // reproduces that, and that every code is a known registry member.
  it('never re-invents signal_code from block.type, and every code is a known registry member', () => {
    const known = new Set<string>(Object.values(GUIDANCE_SIGNAL_CODES));
    for (const b of all) {
      expect(b.signal_code).not.toBe(b.type);
      expect(known.has(b.signal_code as string), `${b.signal_code} is a registry code`).toBe(true);
    }
  });

  // `signal` (display line) is emitted only where deterministic: the
  // stale-rerun nudge. Everything else is code-only (NEVER fabricate).
  it('emits the deterministic signal line on the stale-rerun nudge, code-only elsewhere', () => {
    expect(stale!.signal_code).toBe(GUIDANCE_SIGNAL_CODES.STALE_ANALYSIS);
    expect(stale!.signal).toBe('Graph changed since the last analysis');
    for (const b of [...review, ...coaching, ...evidence]) {
      expect(b.signal, `${b.type} is code-only`).toBeUndefined();
    }
  });

  // Any emitted signal line respects the 140-char wire bound and is non-empty.
  it('every emitted signal line is within the wire bound', () => {
    for (const b of all) {
      if (b.signal !== undefined) {
        expect(b.signal.length).toBeGreaterThan(0);
        expect(b.signal.length).toBeLessThanOrEqual(140);
      }
    }
  });
});
