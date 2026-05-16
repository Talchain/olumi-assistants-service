import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  sanitiseUserFacingText,
  sanitiseOlumiResponseForEgress,
} from '../output-safety.js';
import { log } from '../../../utils/telemetry.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { GraphV3T } from '../../../orchestrator/types.js';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function makeGraph(extraNodes: Array<{ id: string; label: string; kind?: string }> = []): GraphV3T {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'fac_delivery_cost', kind: 'factor', label: 'Delivery Cost' },
      { id: 'fac_churn', kind: 'factor', label: 'Customer Churn' },
      { id: 'opt_offshore_partner', kind: 'option', label: 'Offshore Partner' },
      { id: 'opt_premium', kind: 'option', label: 'Premium Tier' },
      ...extraNodes,
    ],
    edges: [],
  } as unknown as GraphV3T;
}

function emptyResponse(overrides: Partial<OlumiResponse> = {}): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: '',
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'frame',
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// sanitiseUserFacingText — string-level scrub
// ----------------------------------------------------------------------------

describe('sanitiseUserFacingText', () => {
  describe('label resolution from graph', () => {
    it('replaces `fac_delivery_cost` with "Delivery Cost" when graph has matching node', () => {
      const r = sanitiseUserFacingText(
        'Movement on fac_delivery_cost would shift the result.',
        makeGraph(),
      );
      expect(r.text).toBe('Movement on Delivery Cost would shift the result.');
      expect(r.matches).toEqual([{ prefix: 'fac', resolved: 'label' }]);
    });

    it('replaces `opt_offshore_partner` with "Offshore Partner"', () => {
      const r = sanitiseUserFacingText(
        'opt_offshore_partner is the runner-up.',
        makeGraph(),
      );
      expect(r.text).toBe('Offshore Partner is the runner-up.');
      expect(r.matches[0]?.resolved).toBe('label');
    });

    it('replaces multiple IDs in one sentence with their respective labels', () => {
      const r = sanitiseUserFacingText(
        'The relationship between fac_churn and opt_premium is strong.',
        makeGraph(),
      );
      expect(r.text).toBe('The relationship between Customer Churn and Premium Tier is strong.');
      expect(r.matches.length).toBe(2);
    });
  });

  describe('prefix-aware generic fallback', () => {
    it('uses "the relevant factor" when the fac_ ID is not in the graph', () => {
      const r = sanitiseUserFacingText(
        'Movement on fac_unknown_thing would shift the result.',
        makeGraph(),
      );
      expect(r.text).toBe('Movement on the relevant factor would shift the result.');
      expect(r.matches).toEqual([{ prefix: 'fac', resolved: 'generic' }]);
    });

    it('uses prefix-aware fallback when graph is null', () => {
      const r = sanitiseUserFacingText(
        'Movement on fac_delivery_cost would shift the result.',
        null,
      );
      expect(r.text).toBe('Movement on the relevant factor would shift the result.');
      expect(r.matches).toEqual([{ prefix: 'fac', resolved: 'generic' }]);
    });

    it('produces readable fallbacks for all seven prefix mappings', () => {
      const cases: Array<[string, string]> = [
        ['fac_x_1', 'the relevant factor'],
        ['factor_x_1', 'the relevant factor'],
        ['opt_x_1', 'the relevant option'],
        ['option_x_1', 'the relevant option'],
        ['goal_x_1', 'the relevant goal'],
        ['dec_x_1', 'the relevant decision'],
        ['decision_x_1', 'the relevant decision'],
        ['out_x_1', 'the relevant outcome'],
        ['outcome_x_1', 'the relevant outcome'],
        ['risk_x_1', 'the relevant risk'],
        ['con_x_1', 'the relevant constraint'],
        ['constraint_x_1', 'the relevant constraint'],
      ];
      for (const [id, expected] of cases) {
        const r = sanitiseUserFacingText(`See ${id} for details.`, null);
        expect(r.text).toBe(`See ${expected} for details.`);
      }
    });
  });

  describe('English false positives — must NOT be caught', () => {
    const ENGLISH_COMPOUNDS = [
      'factor_analysis',
      'option_value',
      'risk_adjusted',
      'goal_alignment',
      'decision_making',
      'outcome_based',
      'out_of_scope',
      'constraint_based',
      'goal_setting',
      'decision_support',
    ];

    for (const word of ENGLISH_COMPOUNDS) {
      it(`leaves "${word}" untouched`, () => {
        const sentence = `We will run a ${word} pass to confirm.`;
        const r = sanitiseUserFacingText(sentence, makeGraph());
        expect(r.text).toBe(sentence);
        expect(r.matches).toEqual([]);
      });
    }

    it('treats multi-segment slug suffixes as IDs (positive control)', () => {
      // factor_team_morale has a 2-segment suffix → confirmed ID via heuristic
      const r = sanitiseUserFacingText(
        'Adjust factor_team_morale before proceeding.',
        null,
      );
      expect(r.text).toBe('Adjust the relevant factor before proceeding.');
      expect(r.matches[0]?.resolved).toBe('generic');
    });

    it('treats numbered IDs as IDs (positive control)', () => {
      const r = sanitiseUserFacingText('See fac_42 for details.', null);
      expect(r.text).toBe('See the relevant factor for details.');
    });

    it('unambiguous short prefixes (fac/opt) are caught even with single-token suffix and null graph', () => {
      // `fac` and `opt` have NO English-word collisions, so a leaked
      // `fac_churn` is treated as a confirmed ID at the central backstop
      // even when label resolution is unavailable. Other short prefixes
      // (goal/dec/out/risk/con) DO have English collisions and keep the
      // slug-shape gate (see brief-mandated false positives).
      const cases: Array<[string, string]> = [
        ['fac_churn', 'the relevant factor'],
        ['opt_premium', 'the relevant option'],
      ];
      for (const [id, expected] of cases) {
        const r = sanitiseUserFacingText(`See ${id} for details.`, null);
        expect(r.text).toBe(`See ${expected} for details.`);
        expect(r.matches[0]?.resolved).toBe('generic');
      }
    });

    it('resolves unambiguous short-prefix IDs to labels when graph IS available', () => {
      const r = sanitiseUserFacingText('See fac_churn for details.', makeGraph());
      expect(r.text).toBe('See Customer Churn for details.');
      expect(r.matches[0]?.resolved).toBe('label');
    });

    it('risky short prefixes (out/risk/con) keep the slug-shape gate to protect English', () => {
      // The brief explicitly mandates these as protected false-positives.
      // They must NOT be caught even with null graph.
      const r1 = sanitiseUserFacingText('We will run a risk_adjusted pass.', null);
      expect(r1.text).toBe('We will run a risk_adjusted pass.');
      const r2 = sanitiseUserFacingText('That is out_of_scope here.', null);
      expect(r2.text).toBe('That is out_of_scope here.');
      const r3 = sanitiseUserFacingText('A constraint_based view shows…', null);
      expect(r3.text).toBe('A constraint_based view shows…');
    });
  });

  describe('fast path / boundary inputs', () => {
    it('returns empty string unchanged with no telemetry', () => {
      const r = sanitiseUserFacingText('', makeGraph());
      expect(r.text).toBe('');
      expect(r.matches).toEqual([]);
    });

    it('returns whitespace-only string unchanged', () => {
      const r = sanitiseUserFacingText('   \n\t  ', makeGraph());
      expect(r.text).toBe('   \n\t  ');
      expect(r.matches).toEqual([]);
    });

    it('returns clean text unchanged with no matches', () => {
      const r = sanitiseUserFacingText(
        'The leading option performs best with high confidence.',
        makeGraph(),
      );
      expect(r.text).toBe('The leading option performs best with high confidence.');
      expect(r.matches).toEqual([]);
    });
  });
});

// ----------------------------------------------------------------------------
// sanitiseOlumiResponseForEgress — envelope-level walk
// ----------------------------------------------------------------------------

describe('sanitiseOlumiResponseForEgress', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => log);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('scrubs assistant_text', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({ assistant_text: 'See fac_delivery_cost for details.' }),
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test' },
    );
    expect(out.assistant_text).toBe('See Delivery Cost for details.');
  });

  it('scrubs text block content', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [{ type: 'text', content: 'See fac_delivery_cost.' }],
      }),
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test' },
    );
    expect(out.blocks[0]).toEqual({ type: 'text', content: 'See Delivery Cost.' });
  });

  it('scrubs analysis_result.summary but leaves enrichment/leading_option_id', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [
          {
            type: 'analysis_result',
            summary: 'fac_delivery_cost dominates.',
            leading_option_id: 'opt_premium',
            win_probabilities: { opt_premium: 0.6 },
            enrichment: { note: 'see fac_churn here' },
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test' },
    );
    const block = out.blocks[0]!;
    expect(block.type).toBe('analysis_result');
    if (block.type === 'analysis_result') {
      expect(block.summary).toBe('Delivery Cost dominates.');
      expect(block.leading_option_id).toBe('opt_premium'); // untouched
      expect(block.win_probabilities).toEqual({ opt_premium: 0.6 }); // untouched
      expect(block.enrichment).toEqual({ note: 'see fac_churn here' }); // untouched
    }
  });

  it('scrubs explanation.narrative but leaves referenced_option_ids[]', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [
          {
            type: 'explanation',
            narrative: 'fac_delivery_cost drives opt_premium.',
            referenced_option_ids: ['opt_premium', 'opt_offshore_partner'],
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test' },
    );
    const block = out.blocks[0]!;
    expect(block.type).toBe('explanation');
    if (block.type === 'explanation') {
      expect(block.narrative).toBe('Delivery Cost drives Premium Tier.');
      // Machine-field protection: IDs in this array are intentional.
      expect(block.referenced_option_ids).toEqual(['opt_premium', 'opt_offshore_partner']);
    }
  });

  it('scrubs comparison.narrative and options[].label, leaves option_id/attributes', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [
          {
            type: 'comparison',
            narrative: 'fac_churn matters here.',
            options: [
              {
                option_id: 'opt_premium',
                label: 'Premium Tier (opt_premium fallback)',
                win_probability: 0.6,
                attributes: { note: 'opt_premium internal' },
              },
            ],
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test' },
    );
    const block = out.blocks[0]!;
    expect(block.type).toBe('comparison');
    if (block.type === 'comparison') {
      expect(block.narrative).toBe('Customer Churn matters here.');
      expect(block.options[0]?.label).toBe('Premium Tier (Premium Tier fallback)');
      // Machine-field protection
      expect(block.options[0]?.option_id).toBe('opt_premium');
      expect(block.options[0]?.attributes).toEqual({ note: 'opt_premium internal' });
    }
  });

  it('scrubs flip_analysis.narrative but leaves flip_scenarios[].factor_id and option ids', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [
          {
            type: 'flip_analysis',
            narrative: 'fac_churn could flip the result.',
            flip_scenarios: [
              {
                factor_id: 'fac_churn',
                current_value: 0.5,
                flip_threshold: 0.7,
                from_option_id: 'opt_premium',
                to_option_id: 'opt_offshore_partner',
                fragile: true,
              },
            ],
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test' },
    );
    const block = out.blocks[0]!;
    expect(block.type).toBe('flip_analysis');
    if (block.type === 'flip_analysis') {
      expect(block.narrative).toBe('Customer Churn could flip the result.');
      // Machine-field protection
      expect(block.flip_scenarios[0]?.factor_id).toBe('fac_churn');
      expect(block.flip_scenarios[0]?.from_option_id).toBe('opt_premium');
      expect(block.flip_scenarios[0]?.to_option_id).toBe('opt_offshore_partner');
    }
  });

  it('leaves error block fields untouched (structured)', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [
          {
            type: 'error',
            error_code: 'INTERNAL_ERROR',
            severity: 'error',
            details: { reason: 'fac_churn failed' }, // opaque passthrough — left alone
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test' },
    );
    expect(out.blocks[0]).toEqual({
      type: 'error',
      error_code: 'INTERNAL_ERROR',
      severity: 'error',
      details: { reason: 'fac_churn failed' },
    });
  });

  it('scrubs suggested_actions.label and message but leaves id/action_type', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        suggested_actions: [
          {
            id: 'chip_run_analysis',
            label: 'Adjust fac_delivery_cost',
            message: 'Update fac_delivery_cost to a higher value.',
            action_type: 'run_analysis',
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test' },
    );
    expect(out.suggested_actions[0]).toEqual({
      id: 'chip_run_analysis', // untouched
      label: 'Adjust Delivery Cost',
      message: 'Update Delivery Cost to a higher value.',
      action_type: 'run_analysis', // untouched
    });
  });

  it('scrubs insights.text but leaves id', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        insights: [{ id: 'insight_fac_churn', text: 'fac_churn rising.' }],
      }),
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test' },
    );
    expect(out.insights[0]).toEqual({
      id: 'insight_fac_churn',
      text: 'Customer Churn rising.',
    });
  });

  it('does not mutate the input response', () => {
    const input = emptyResponse({
      assistant_text: 'See fac_delivery_cost.',
      blocks: [{ type: 'text', content: 'See fac_delivery_cost.' }],
    });
    const inputCopy = JSON.parse(JSON.stringify(input));
    sanitiseOlumiResponseForEgress(input, { graph: makeGraph(), requestId: 'req-1', exitPath: 'test' });
    expect(input).toEqual(inputCopy);
  });

  it('emits v5.egress_id_leak telemetry with prefix and exit_path only (no raw ID)', () => {
    sanitiseOlumiResponseForEgress(
      emptyResponse({ assistant_text: 'See fac_delivery_cost.' }),
      { graph: makeGraph(), requestId: 'req-egress-1', exitPath: 'edit_graph' },
    );
    expect(warnSpy).toHaveBeenCalled();
    const call = warnSpy.mock.calls.find((c) => {
      const payload = c[0] as Record<string, unknown> | undefined;
      return payload?.event === 'v5.egress_id_leak';
    });
    expect(call).toBeDefined();
    const payload = call?.[0] as Record<string, unknown>;
    expect(payload.prefix).toBe('fac');
    expect(payload.resolution).toBe('label');
    expect(payload.request_id).toBe('req-egress-1');
    expect(payload.exit_path).toBe('edit_graph');
    // Critical: raw ID must not appear anywhere in the telemetry payload.
    const allValues = JSON.stringify(payload);
    expect(allValues).not.toContain('fac_delivery_cost');
    expect(allValues).not.toContain('delivery_cost');
  });

  it('clean response → no telemetry, no rewrite', () => {
    const clean = emptyResponse({
      assistant_text: 'The leading option performs best.',
      blocks: [{ type: 'text', content: 'Standard analysis output.' }],
    });
    const out = sanitiseOlumiResponseForEgress(clean, {
      graph: makeGraph(),
      requestId: 'req-clean',
    });
    expect(out.assistant_text).toBe('The leading option performs best.');
    const egressCall = warnSpy.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>)?.event === 'v5.egress_id_leak',
    );
    expect(egressCall).toBeUndefined();
  });

  it('hard-coded clean fallback envelope produces no double-replacement', () => {
    // Mirrors the egress fallback shape from validateEgress fallback path.
    const fallback: OlumiResponse = {
      response_version: 2,
      assistant_text: 'The server produced a response that failed validation.',
      blocks: [
        { type: 'error', error_code: 'EGRESS_CONTRACT_VIOLATION', severity: 'error' },
      ],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'frame',
    };
    const out = sanitiseOlumiResponseForEgress(fallback, {
      graph: null,
      requestId: 'req-fallback',
    });
    expect(out).toEqual(fallback);
    const egressCall = warnSpy.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>)?.event === 'v5.egress_id_leak',
    );
    expect(egressCall).toBeUndefined();
  });

  it('absent-graph path produces readable generic fallback (regression guard)', () => {
    // The brief mandates that with graph=null, sentences must read naturally,
    // not produce "[REDACTED]" or otherwise jagged output.
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        assistant_text: 'Movement on fac_delivery_cost would shift opt_offshore_partner.',
      }),
      { graph: null, requestId: 'req-null-graph', exitPath: 'test' },
    );
    expect(out.assistant_text).toBe(
      'Movement on the relevant factor would shift the relevant option.',
    );
  });

  it('regression: brief example fac_delivery_cost is replaced (matches staging finding)', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        assistant_text:
          'I noticed fac_delivery_cost has a strong negative effect on goal_revenue.',
      }),
      { graph: makeGraph(), requestId: 'req-regression', exitPath: 'test' },
    );
    expect(out.assistant_text).toBe(
      'I noticed Delivery Cost has a strong negative effect on Revenue.',
    );
    expect(out.assistant_text).not.toContain('fac_delivery_cost');
  });

  // V5 Phase 3A — exhaustive-switch coverage for the four new block types
  // per Analysis tab data contract v1.3 (§1.1–§1.4). Each new block type
  // has its own per-field user-facing-prose walk; structured / enum /
  // ID-allowed fields stay untouched.

  it('Phase 3 — review_card scrubs title / body / action_label; leaves target_refs IDs', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [
          {
            block_id: '550e8400-e29b-41d4-a716-446655440001',
            signal_id: 'review:bias:gh',
            created_at: '2026-05-16T15:00:00.000Z',
            source_handler: 'decision_review_enricher',
            graph_hash_at_generation: 'gh_test',
            freshness: 'fresh',
            type: 'review_card',
            card_kind: 'bias',
            title: 'See fac_delivery_cost (anchoring)',
            body: 'The model edges cluster on fac_delivery_cost.',
            severity: 'warning',
            target_refs: [{ id: 'fac_delivery_cost', label: 'Delivery Cost', kind: 'factor' }],
            priority_rank: 41,
            action_intent: 'gather_evidence',
            action_label: 'Investigate fac_delivery_cost',
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-r1', exitPath: 'test' },
    );
    const block = out.blocks[0]!;
    expect(block.type).toBe('review_card');
    if (block.type === 'review_card') {
      expect(block.title).toBe('See Delivery Cost (anchoring)');
      expect(block.body).toBe('The model edges cluster on Delivery Cost.');
      expect(block.action_label).toBe('Investigate Delivery Cost');
      // target_refs IDs are intentional machine fields per §0.1 — untouched.
      expect(block.target_refs[0]!.id).toBe('fac_delivery_cost');
      // Structured metadata untouched.
      expect(block.signal_id).toBe('review:bias:gh');
      expect(block.severity).toBe('warning');
      expect(block.priority_rank).toBe(41);
    }
  });

  it('Phase 3 — coaching scrubs title / body / action_label', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [
          {
            block_id: '550e8400-e29b-41d4-a716-446655440002',
            signal_id: 'coach:assumption:1:gh',
            created_at: '2026-05-16T15:00:00.000Z',
            source_handler: 'decision_review_enricher',
            graph_hash_at_generation: 'gh_test',
            freshness: 'fresh',
            type: 'coaching',
            coaching_kind: 'assumption_check',
            title: 'Check fac_delivery_cost',
            body: 'Verify fac_delivery_cost stays bounded.',
            source: 'decision_review',
            target_refs: [],
            priority_rank: 101,
            action_intent: 'confirm_factor',
            action_label: 'Confirm fac_delivery_cost',
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-c1', exitPath: 'test' },
    );
    const block = out.blocks[0]!;
    expect(block.type).toBe('coaching');
    if (block.type === 'coaching') {
      expect(block.title).toBe('Check Delivery Cost');
      expect(block.body).toBe('Verify Delivery Cost stays bounded.');
      expect(block.action_label).toBe('Confirm Delivery Cost');
      expect(block.coaching_kind).toBe('assumption_check');
      expect(block.source).toBe('decision_review');
    }
  });

  it('Phase 3 — evidence scrubs factor_label / evidence_gap / suggested_technique / impact_if_gathered / action_label; leaves factor_ref + target_refs IDs', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [
          {
            block_id: '550e8400-e29b-41d4-a716-446655440003',
            signal_id: 'evidence:fac_delivery_cost:gh',
            created_at: '2026-05-16T15:00:00.000Z',
            source_handler: 'decision_review_enricher',
            graph_hash_at_generation: 'gh_test',
            freshness: 'fresh',
            type: 'evidence',
            factor_label: 'fac_delivery_cost summary',
            factor_ref: { id: 'fac_delivery_cost', label: 'Delivery Cost', kind: 'factor' },
            target_refs: [{ id: 'fac_delivery_cost', label: 'Delivery Cost', kind: 'factor' }],
            current_confidence: 'low',
            evidence_gap: 'Need data on fac_delivery_cost trends.',
            suggested_technique: 'Internal data: pull fac_delivery_cost dashboards',
            impact_if_gathered: 'Would lift confidence in fac_delivery_cost.',
            priority_rank: 1,
            severity: 'critical',
            action_intent: 'gather_evidence',
            action_label: 'Investigate fac_delivery_cost',
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-e1', exitPath: 'test' },
    );
    const block = out.blocks[0]!;
    expect(block.type).toBe('evidence');
    if (block.type === 'evidence') {
      expect(block.factor_label).toBe('Delivery Cost summary');
      expect(block.evidence_gap).toBe('Need data on Delivery Cost trends.');
      expect(block.suggested_technique).toBe('Internal data: pull Delivery Cost dashboards');
      expect(block.impact_if_gathered).toBe('Would lift confidence in Delivery Cost.');
      expect(block.action_label).toBe('Investigate Delivery Cost');
      // factor_ref + target_refs are structured — IDs intentional, untouched.
      expect(block.factor_ref.id).toBe('fac_delivery_cost');
      expect(block.target_refs[0]!.id).toBe('fac_delivery_cost');
      // Enum / number metadata untouched.
      expect(block.current_confidence).toBe('low');
      expect(block.severity).toBe('critical');
      expect(block.priority_rank).toBe(1);
    }
  });

  it('Phase 3 — exercise scrubs all optional prose fields + each warning_signs entry; leaves target_refs IDs', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [
          {
            block_id: '550e8400-e29b-41d4-a716-446655440004',
            signal_id: 'exercise:pre_mortem:gh',
            created_at: '2026-05-16T15:00:00.000Z',
            source_handler: 'run_exercise',
            freshness: 'fresh',
            type: 'exercise',
            exercise_kind: 'pre_mortem',
            failure_scenario: 'Team underestimated fac_delivery_cost.',
            warning_signs: [
              'Velocity drops on fac_delivery_cost reports',
              'Cost overruns trigger on fac_churn',
            ],
            mitigation: 'Weekly review with fac_delivery_cost owner.',
            reference_class: 'Past launches affected by fac_delivery_cost.',
            target_element_ref: { id: 'fac_delivery_cost', label: 'Delivery Cost', kind: 'factor' },
            counter_case: 'When fac_delivery_cost held steady, the team shipped.',
            review_trigger: 'Reconvene if fac_delivery_cost spikes.',
            target_refs: [{ id: 'fac_delivery_cost', label: 'Delivery Cost', kind: 'factor' }],
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-x1', exitPath: 'test' },
    );
    const block = out.blocks[0]!;
    expect(block.type).toBe('exercise');
    if (block.type === 'exercise') {
      expect(block.failure_scenario).toBe('Team underestimated Delivery Cost.');
      expect(block.mitigation).toBe('Weekly review with Delivery Cost owner.');
      expect(block.reference_class).toBe('Past launches affected by Delivery Cost.');
      expect(block.counter_case).toBe('When Delivery Cost held steady, the team shipped.');
      expect(block.review_trigger).toBe('Reconvene if Delivery Cost spikes.');
      // warning_signs[] each entry scrubbed.
      expect(block.warning_signs).toEqual([
        'Velocity drops on Delivery Cost reports',
        'Cost overruns trigger on Customer Churn',
      ]);
      // Structured fields untouched.
      expect(block.exercise_kind).toBe('pre_mortem');
      expect(block.target_element_ref?.id).toBe('fac_delivery_cost');
      expect(block.target_refs[0]!.id).toBe('fac_delivery_cost');
    }
  });

  it('Phase 3 — exercise leaves undefined optional prose fields undefined (no spurious empty strings)', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [
          {
            block_id: '550e8400-e29b-41d4-a716-446655440005',
            signal_id: 'exercise:consider_opposite:gh',
            created_at: '2026-05-16T15:00:00.000Z',
            source_handler: 'run_exercise',
            freshness: 'fresh',
            type: 'exercise',
            exercise_kind: 'consider_opposite',
            target_refs: [],
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-x2', exitPath: 'test' },
    );
    const block = out.blocks[0]!;
    expect(block.type).toBe('exercise');
    if (block.type === 'exercise') {
      expect(block.failure_scenario).toBeUndefined();
      expect(block.warning_signs).toBeUndefined();
      expect(block.mitigation).toBeUndefined();
      expect(block.reference_class).toBeUndefined();
      expect(block.counter_case).toBeUndefined();
      expect(block.review_trigger).toBeUndefined();
    }
  });
});
