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
});
