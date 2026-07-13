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
 *   - #7 source_handler is the canonical `'decision_review_enricher'`
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
  type BlockBuildCtx,
} from '../phase3-blocks.js';

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
  it('maps confidence boundaries: >=0.7 → high, >=0.3 → medium, <0.3 → low', () => {
    const lookup = buildFactorConfidenceLookup(makeFact({
      factorSensitivity: [
        { factor_id: 'fac_high', confidence: 0.85 },
        { factor_id: 'fac_high_boundary', confidence: 0.7 },
        { factor_id: 'fac_medium', confidence: 0.5 },
        { factor_id: 'fac_medium_boundary', confidence: 0.3 },
        { factor_id: 'fac_low', confidence: 0.1 },
        { factor_id: 'fac_low_boundary', confidence: 0.299 },
      ],
    }));
    expect(lookup.get('fac_high')).toBe('high');
    expect(lookup.get('fac_high_boundary')).toBe('high');
    expect(lookup.get('fac_medium')).toBe('medium');
    expect(lookup.get('fac_medium_boundary')).toBe('medium');
    expect(lookup.get('fac_low')).toBe('low');
    expect(lookup.get('fac_low_boundary')).toBe('low');
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
  it('emits one card for the first evidence_enhancements entry resolvable via lookup', () => {
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
          },
        },
        graphNodes: STANDARD_GRAPH_NODES,
      }),
      buildGraphNodeLookup(makeFact({ graphNodes: STANDARD_GRAPH_NODES })),
      CTX,
    );
    const e = blocks.find((b) => b.card_kind === 'evidence_priority');
    expect(e).toBeDefined();
    expect(e?.target_refs).toHaveLength(1);
    expect(e?.target_refs[0].id).toBe('fac_delivery_risk');
    expect(e?.action_intent).toBe('gather_evidence');
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
    });
  }

  it('emits one block per evidence_enhancement; ranks by emission order', () => {
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

  it('applies severity scheme: low + top-1 → critical; low + other → warning; else info', () => {
    const fact = evidenceFact();
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
    );
    expect(blocks[0].severity).toBe('critical'); // low + rank 1
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

describe('banned-copy and raw-ID drift guard (Codex correction #6)', () => {
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
  it('stamps source_handler = "decision_review_enricher" on every block (Codex correction #7)', () => {
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

  it('pre_mortem: emits with empty target_refs when grounded_in is absent (no claim, no harm)', () => {
    const fact = makeFact({
      decisionReview: {
        pre_mortem: {
          failure_scenario: 'A canonical pre-mortem narrative.',
        },
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
    const pm = blocks.find((b) => b.card_kind === 'pre_mortem');
    expect(pm).toBeDefined();
    expect(pm?.target_refs).toEqual([]);
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

  it('narrative card drops when narrative_summary contains banned recommendation language', () => {
    const fact = makeFact({
      decisionReview: {
        narrative_summary: 'Our recommendation is to launch immediately.',
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildReviewCardBlocks(fact, cleanLookup, CTX);
    expect(blocks.filter((b) => b.card_kind === 'narrative')).toHaveLength(0);
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

  it('bias card drops when description contains banned "winning option" language', () => {
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
    expect(blocks.filter((b) => b.card_kind === 'bias')).toHaveLength(0);
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

  it('flip_threshold card drops when narrative contains banned recommendation language', () => {
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
    expect(blocks.filter((b) => b.card_kind === 'flip_threshold')).toHaveLength(0);
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

  it('scenario_context card drops when trigger/consequence prose contains a banned phrase', () => {
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
    expect(blocks.filter((b) => b.card_kind === 'scenario_context')).toHaveLength(0);
  });

  it('coaching assumption_check drops when assumption text contains banned recommendation language', () => {
    const fact = makeFact({
      decisionReview: {
        key_assumptions: ['Our recommendation assumes market growth continues.'],
      },
      graphNodes: STANDARD_GRAPH_NODES,
    });
    const blocks = buildCoachingBlocks(fact, cleanLookup, CTX);
    expect(blocks.filter((b) => b.coaching_kind === 'assumption_check')).toHaveLength(0);
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

  it('evidence block drops when rationale contains banned "the winner" prescriptive phrasing', () => {
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
    expect(blocks).toHaveLength(0);
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
    const fact = makeFact({
      decisionReview: {
        narrative_summary: 'Our recommendation is to launch.',
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
      /recommendation/i,
    );
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

  it('evidence_priority card skips a lever top entry and promotes the next non-lever gap', () => {
    const fact = evidenceFactWithLever();
    const levers = new Set(['fac_delivery_risk']);
    const blocks = buildReviewCardBlocks(
      fact,
      buildGraphNodeLookup(fact),
      CTX,
      levers,
    );
    const ep = blocks.find((b) => b.card_kind === 'evidence_priority');
    expect(ep).toBeDefined();
    expect(ep?.target_refs[0].id).toBe('fac_cost_overrun');
    // The lever must never be NAMED as the highest-leverage evidence gap.
    expect(ep?.title).not.toContain('Delivery risk');
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
