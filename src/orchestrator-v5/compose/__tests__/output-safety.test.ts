import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  sanitiseUserFacingText,
  sanitiseCoachingProse,
  sanitiseOlumiResponseForEgress,
} from '../output-safety.js';
import { log } from '../../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
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
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
    );
    expect(out.assistant_text).toBe('See Delivery Cost for details.');
  });

  // ── No-dead-end invariant, asserted AT THE CHOKEPOINT ──────────────────
  // These pin the WIRING, not the guard's logic (that is unit-tested in
  // looping-chip-guard.test.ts). Without them, the guard could be deleted
  // from the chokepoint and every other test would still pass — the
  // guarantee-theatre failure mode.
  describe('looping-chip guard is wired into the chokepoint', () => {
    it('drops a chip that would re-submit the user message verbatim', () => {
      const out = sanitiseOlumiResponseForEgress(
        emptyResponse({
          assistant_text: 'Did you mean Key Talent Attrition?',
          suggested_actions: [
            {
              id: 'chip_clarify_factor_0',
              label: 'Key Talent Attrition',
              message: 'Set Key Talent Attrition to 0.8.',
            },
          ],
        }),
        {
          graph: makeGraph(),
          requestId: 'req-1',
          exitPath: 'test',
          userMessage: 'Set Key Talent Attrition to 0.8.',
          mayNameLeadingOption: true,
        },
      );
      expect(out.suggested_actions).toEqual([]);
    });

    it('leaves a non-looping chip untouched', () => {
      const out = sanitiseOlumiResponseForEgress(
        emptyResponse({
          suggested_actions: [
            {
              id: 'chip_prompt_0',
              label: 'Office Rent',
              message: 'Set Office Rent to 0.8.',
            },
          ],
        }),
        {
          graph: makeGraph(),
          requestId: 'req-1',
          exitPath: 'test',
          userMessage: 'Set Key Talent Attrition to 0.8.',
          mayNameLeadingOption: true,
        },
      );
      expect(out.suggested_actions).toHaveLength(1);
    });

    it('is idempotent across the chokepoint re-entering it (route-v2 calls it up to 4x)', () => {
      const opts = {
        graph: makeGraph(),
        requestId: 'req-1',
        exitPath: 'test',
        userMessage: 'Set Key Talent Attrition to 0.8.',
        mayNameLeadingOption: true,
      };
      const once = sanitiseOlumiResponseForEgress(
        emptyResponse({
          suggested_actions: [
            {
              id: 'chip_clarify_factor_0',
              label: 'Key Talent Attrition',
              message: 'Set Key Talent Attrition to 0.8.',
            },
            { id: 'chip_prompt_0', label: 'Office Rent', message: 'Set Office Rent to 0.8.' },
          ],
        }),
        opts,
      );
      const twice = sanitiseOlumiResponseForEgress(once, opts);
      expect(twice.suggested_actions).toEqual(once.suggested_actions);
      expect(twice.suggested_actions).toHaveLength(1);
    });
  });

  it('scrubs text block content', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [{ type: 'text', content: 'See fac_delivery_cost.' }],
      }),
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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
      { graph: makeGraph(), requestId: 'req-1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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
    sanitiseOlumiResponseForEgress(input, { graph: makeGraph(), requestId: 'req-1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true });
    expect(input).toEqual(inputCopy);
  });

  it('emits v5.egress_id_leak telemetry with prefix and exit_path only (no raw ID)', () => {
    sanitiseOlumiResponseForEgress(
      emptyResponse({ assistant_text: 'See fac_delivery_cost.' }),
      { graph: makeGraph(), requestId: 'req-egress-1', exitPath: 'edit_graph', userMessage: null, mayNameLeadingOption: true },
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
      mayNameLeadingOption: true,
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
      mayNameLeadingOption: true,
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
      { graph: null, requestId: 'req-null-graph', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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
      { graph: makeGraph(), requestId: 'req-regression', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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
      { graph: makeGraph(), requestId: 'req-r1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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
      { graph: makeGraph(), requestId: 'req-c1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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

  it('Phase 3 — coaching scrubs action_prompt (it is submitted AS the user’s turn)', () => {
    // ROADMAP 2.225. `action_prompt` is user-facing twice: rendered on the
    // card, then dispatched VERBATIM as the user's next message. An
    // unscrubbed entity id here is not merely displayed — it is echoed back
    // into the conversation as something the user appears to have written.
    // Without the explicit arm in `output-safety.ts` the field rides through
    // on the object spread untouched, and this assertion is what catches it.
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
            action_prompt: 'Help me pressure-test fac_delivery_cost before I rely on it.',
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-c2', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
    );
    const block = out.blocks[0]!;
    if (block.type === 'coaching') {
      expect(block.action_prompt).toBe(
        'Help me pressure-test Delivery Cost before I rely on it.',
      );
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
      { graph: makeGraph(), requestId: 'req-e1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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
      { graph: makeGraph(), requestId: 'req-x1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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
      { graph: makeGraph(), requestId: 'req-x2', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
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

  // 0.15.0 wave — exhaustive-switch coverage for the two new block kinds
  // (held_proposal per ROADMAP 1.43, ui_directive per seamlessness R4).
  // Fail-closed policy (adjudicated): every human-readable prose/copy field
  // is scrubbed; typed id / ref / enum / numeric fields stay untouched.
  // Neither kind is emitted by CEE yet — these cases are dormant-but-armed
  // for the upcoming emitter lanes.

  it('0.15.0 — held_proposal scrubs summary; leaves proposal_id / mutation_class / reason_code / action refs untouched', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [
          {
            type: 'held_proposal',
            proposal_id: 'gmh_a1b2c3d4e5f6',
            summary: 'Holding the change to fac_delivery_cost for confirmation.',
            mutation_class: 'structural',
            reason_code: 'STRUCTURAL_APPLY_HELD',
            confirm_action_id: 'gmh_a1b2c3d4e5f6',
            decline_action_id: 'gmh_ffeeddccbbaa',
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-hp1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
    );
    const block = out.blocks[0]!;
    expect(block.type).toBe('held_proposal');
    if (block.type === 'held_proposal') {
      // Prose scrubbed — entity ID resolved to its graph label.
      expect(block.summary).toBe('Holding the change to Delivery Cost for confirmation.');
      expect(block.summary).not.toContain('fac_delivery_cost');
      // Typed machine fields untouched.
      expect(block.proposal_id).toBe('gmh_a1b2c3d4e5f6');
      expect(block.mutation_class).toBe('structural');
      expect(block.reason_code).toBe('STRUCTURAL_APPLY_HELD');
      expect(block.confirm_action_id).toBe('gmh_a1b2c3d4e5f6');
      expect(block.decline_action_id).toBe('gmh_ffeeddccbbaa');
    }
  });

  it('0.15.0 — held_proposal absent-graph path produces readable generic fallback in summary', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [
          {
            type: 'held_proposal',
            proposal_id: 'gmh_a1b2c3d4e5f6',
            summary: 'Holding the change to fac_delivery_cost for confirmation.',
            mutation_class: 'tunable',
            reason_code: 'TUNABLE_APPLY_HELD',
            confirm_action_id: 'gmh_a1b2c3d4e5f6',
          },
        ],
      }),
      { graph: null, requestId: 'req-hp2', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
    );
    const block = out.blocks[0]!;
    expect(block.type).toBe('held_proposal');
    if (block.type === 'held_proposal') {
      expect(block.summary).toBe('Holding the change to the relevant factor for confirmation.');
      // Optional decline_action_id stays absent — no spurious keys.
      expect(block.decline_action_id).toBeUndefined();
    }
  });

  it('0.15.0 — ui_directive scrubs note; leaves verb / targets[] ids / duration_ms untouched', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [
          {
            type: 'ui_directive',
            verb: 'highlight',
            targets: [{ id: 'fac_delivery_cost', label: 'Delivery Cost', kind: 'factor' }],
            duration_ms: 3000,
            note: 'Look at fac_delivery_cost first.',
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-ud1', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
    );
    const block = out.blocks[0]!;
    expect(block.type).toBe('ui_directive');
    if (block.type === 'ui_directive') {
      // Copy scrubbed — entity ID resolved to its graph label.
      expect(block.note).toBe('Look at Delivery Cost first.');
      expect(block.note).not.toContain('fac_delivery_cost');
      // Typed machine fields untouched — targets[].id is intentional
      // targeting (same treatment as target_refs on Phase-3 blocks).
      expect(block.verb).toBe('highlight');
      expect(block.targets[0]!.id).toBe('fac_delivery_cost');
      expect(block.duration_ms).toBe(3000);
    }
  });

  it('0.15.0 — ui_directive leaves undefined optional fields undefined (no spurious empty strings)', () => {
    const out = sanitiseOlumiResponseForEgress(
      emptyResponse({
        blocks: [
          {
            type: 'ui_directive',
            verb: 'open_inspector',
            targets: [{ id: 'opt_premium', label: 'Premium Tier', kind: 'option' }],
          },
        ],
      }),
      { graph: makeGraph(), requestId: 'req-ud2', exitPath: 'test', userMessage: null, mayNameLeadingOption: true },
    );
    const block = out.blocks[0]!;
    expect(block.type).toBe('ui_directive');
    if (block.type === 'ui_directive') {
      // A `note: ''` here would also violate the strict boundary schema
      // (note has .min(1)) — absence must be preserved exactly.
      expect(block.note).toBeUndefined();
      expect(block.duration_ms).toBeUndefined();
      expect(block.verb).toBe('open_inspector');
      expect(block.targets[0]!.id).toBe('opt_premium');
    }
  });
});

// ----------------------------------------------------------------------------
// sanitiseCoachingProse — narrow-guard coaching-context scrub
//
// Covers the three rules described in
// `src/orchestrator/shared/output-safety.ts`:
//   - Rule 1: exact graph-ID hit → label (or PREFIX_GENERIC when label is
//     missing / equals id).
//   - Rule 2: orphan with high-confidence shape (digit, fac/opt prefix, or
//     multi-segment ≥4-char first segment) → PREFIX_GENERIC.
//   - Rule 3: ambiguous orphan (single-segment risky-prefix, no digit) →
//     preserved verbatim. The intentional trade-off: broken copy is worse
//     than a residual leak on a genuinely ambiguous token.
// ----------------------------------------------------------------------------

function coachingGraph(
  nodes: Array<{ id: string; label?: string; kind?: string }>,
): GraphV3T {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: (n.kind ?? 'factor') as 'factor',
      // `label === id` placeholder for the "no usable label" projection
      // behaviour in `projectGraphForCoachingScrub` (package.ts).
      label: n.label ?? n.id,
    })),
    edges: [],
  } as unknown as GraphV3T;
}

describe('sanitiseCoachingProse', () => {
  describe('rule 1 — exact graph-ID hit', () => {
    it('replaces token with the node label when the label is usable', () => {
      const g = coachingGraph([{ id: 'fac_pricing', label: 'Pricing' }]);
      const r = sanitiseCoachingProse(
        'Strengthen fac_pricing analysis to improve confidence.',
        g,
      );
      expect(r.text).toBe('Strengthen Pricing analysis to improve confidence.');
      expect(r.text).not.toContain('fac_pricing');
      expect(r.matches).toEqual([{ prefix: 'fac', resolved: 'label' }]);
    });

    it('falls back to PREFIX_GENERIC when the graph node has label === id', () => {
      // The motivating leak: `risk_churn` is a real node id but the LLM
      // emitted no human label. The existing `sanitiseUserFacingText`
      // gate misses this because (a) the projection drops the node and
      // (b) the slug-shape gate classifies single-segment risky-prefix
      // orphans as English compounds. `sanitiseCoachingProse` closes the
      // gap by keying off `idSet`, not `resolveLabel`.
      const g = coachingGraph([{ id: 'risk_churn', label: 'risk_churn' }]);
      const r = sanitiseCoachingProse('Watch risk_churn carefully.', g);
      expect(r.text).toBe('Watch the relevant risk carefully.');
      expect(r.text).not.toContain('risk_churn');
      expect(r.matches).toEqual([{ prefix: 'risk', resolved: 'generic' }]);
    });

    it('falls back to PREFIX_GENERIC for a real-graph dec_main with no usable label', () => {
      const g = coachingGraph([{ id: 'dec_main', label: 'dec_main' }]);
      const r = sanitiseCoachingProse('Commit dec_main before quarter-end.', g);
      expect(r.text).toBe('Commit the relevant decision before quarter-end.');
      expect(r.matches[0]).toEqual({ prefix: 'dec', resolved: 'generic' });
    });
  });

  describe('rule 2 — orphan high-confidence', () => {
    it('replaces orphan with a digit (risk_5)', () => {
      const r = sanitiseCoachingProse('See risk_5 last quarter.', coachingGraph([]));
      expect(r.text).toBe('See the relevant risk last quarter.');
      expect(r.matches[0]).toEqual({ prefix: 'risk', resolved: 'generic' });
    });

    it('replaces orphan with multi-segment ≥4-char first segment (risk_churn_rate)', () => {
      const r = sanitiseCoachingProse(
        'Bound risk_churn_rate against historical baseline.',
        coachingGraph([]),
      );
      expect(r.text).toBe('Bound the relevant risk against historical baseline.');
      expect(r.matches[0]).toEqual({ prefix: 'risk', resolved: 'generic' });
    });

    it('replaces orphan with UNAMBIGUOUS `fac_` prefix even single-segment', () => {
      const r = sanitiseCoachingProse('Strengthen fac_anything.', coachingGraph([]));
      expect(r.text).toBe('Strengthen the relevant factor.');
      expect(r.matches[0]).toEqual({ prefix: 'fac', resolved: 'generic' });
    });

    it('replaces orphan with UNAMBIGUOUS `opt_` prefix even single-segment', () => {
      const r = sanitiseCoachingProse('Compare opt_x to baseline.', coachingGraph([]));
      expect(r.text).toBe('Compare the relevant option to baseline.');
      expect(r.matches[0]).toEqual({ prefix: 'opt', resolved: 'generic' });
    });

    it('uses "the relevant element" for `node_` orphan with digit', () => {
      const r = sanitiseCoachingProse('Resolve node_42 reference.', coachingGraph([]));
      expect(r.text).toBe('Resolve the relevant element reference.');
      expect(r.matches[0]).toEqual({ prefix: 'node', resolved: 'generic' });
    });
  });

  describe('rule 3 — ambiguous preservation', () => {
    it('preserves `risk_adjusted` (single-segment risky-prefix orphan)', () => {
      const text = 'Use risk_adjusted analysis to compare options.';
      const r = sanitiseCoachingProse(text, coachingGraph([]));
      expect(r.text).toBe(text);
      expect(r.matches).toEqual([]);
    });

    it('preserves `risk_adjusted return on capital` without mangling adjacent words', () => {
      // The regex matches only `risk_adjusted`; the word boundary stops
      // before the space, so ` return on capital` is outside the match
      // and rule 3 leaves the matched token alone.
      const text = 'Use a risk_adjusted return on capital framework.';
      const r = sanitiseCoachingProse(text, coachingGraph([]));
      expect(r.text).toBe(text);
      expect(r.matches).toEqual([]);
    });

    it('preserves `goal_setting`', () => {
      const text = 'Apply goal_setting principles to the team.';
      const r = sanitiseCoachingProse(text, coachingGraph([]));
      expect(r.text).toBe(text);
      expect(r.matches).toEqual([]);
    });

    it('preserves `out_of_scope` (short connector first segment)', () => {
      const text = 'Treating that as out_of_scope is reasonable.';
      const r = sanitiseCoachingProse(text, coachingGraph([]));
      expect(r.text).toBe(text);
      expect(r.matches).toEqual([]);
    });

    it('preserves an ambiguous orphan like `risk_phantom` (accepted trade-off)', () => {
      // Documented trade-off: producing "the relevant risk" in place of
      // every single-segment risky-prefix orphan would mangle English
      // compounds like `risk_adjusted`. The narrow guard preserves;
      // residual leaks on hallucinated single-segment IDs are accepted.
      const text = 'Track risk_phantom carefully.';
      const r = sanitiseCoachingProse(text, coachingGraph([]));
      expect(r.text).toBe(text);
      expect(r.matches).toEqual([]);
    });
  });

  describe('regex non-match cases (preserved by construction)', () => {
    it('preserves `go_to_market` (non-tracked prefix `go_`)', () => {
      const text = 'Compare go_to_market against status_quo.';
      const r = sanitiseCoachingProse(text, coachingGraph([]));
      expect(r.text).toBe(text);
      expect(r.matches).toEqual([]);
    });

    it('preserves `decision_making` (no `_` immediately after `dec`)', () => {
      // `dec_` prefix requires an underscore as the third character;
      // `decision_making` is `dec` + `i...`, no match.
      const text = 'Sharpen decision_making and outcome_based reasoning.';
      const r = sanitiseCoachingProse(text, coachingGraph([]));
      expect(r.text).toBe(text);
      expect(r.matches).toEqual([]);
    });
  });

  describe('content-shape behaviours', () => {
    it('passes clean coaching prose through unchanged', () => {
      const text = 'Add a baseline option to anchor your comparison.';
      const r = sanitiseCoachingProse(text, coachingGraph([]));
      expect(r.text).toBe(text);
      expect(r.matches).toEqual([]);
    });

    it('rewrites multiple IDs in one string', () => {
      const g = coachingGraph([
        { id: 'opt_a', label: 'Option A' },
        { id: 'opt_b', label: 'Option B' },
        { id: 'fac_cost', label: 'Cost' },
      ]);
      const r = sanitiseCoachingProse(
        'Compare opt_a and opt_b on fac_cost dimensions.',
        g,
      );
      expect(r.text).toBe('Compare Option A and Option B on Cost dimensions.');
      expect(r.text).not.toMatch(/\b(?:fac|opt|out|risk|goal|dec|node)_[a-z0-9_]+\b/i);
      expect(r.matches).toHaveLength(3);
      expect(r.matches.every((m) => m.resolved === 'label')).toBe(true);
    });

    it('is a no-op fast path on empty / whitespace-only input', () => {
      expect(sanitiseCoachingProse('', null)).toEqual({ text: '', matches: [] });
      expect(sanitiseCoachingProse('   \n\t  ', null)).toEqual({
        text: '   \n\t  ',
        matches: [],
      });
    });

    it('returns SanitiseResult shape matching sanitiseUserFacingText for telemetry parity', () => {
      const g = coachingGraph([
        { id: 'fac_pricing', label: 'Pricing' },
        { id: 'risk_churn', label: 'risk_churn' },
      ]);
      const r = sanitiseCoachingProse(
        'See fac_pricing, watch risk_churn, ignore risk_adjusted, replace risk_5.',
        g,
      );
      // Three replacements:
      //   - fac_pricing → 'Pricing' (rule 1 label)
      //   - risk_churn → 'the relevant risk' (rule 1 generic, label===id)
      //   - risk_5 → 'the relevant risk' (rule 2 digit)
      //   - risk_adjusted preserved (rule 3 ambiguous)
      expect(r.matches).toEqual([
        { prefix: 'fac', resolved: 'label' },
        { prefix: 'risk', resolved: 'generic' },
        { prefix: 'risk', resolved: 'generic' },
      ]);
      expect(r.text).toContain('Pricing');
      expect(r.text).toContain('risk_adjusted');
      expect(r.text).not.toContain('fac_pricing');
      expect(r.text).not.toContain('risk_churn');
      expect(r.text).not.toContain('risk_5');
    });
  });

  describe('idempotency', () => {
    it('rule 1 (label hit) reaches a fixed point on the second pass', () => {
      const g = coachingGraph([{ id: 'fac_pricing', label: 'Pricing' }]);
      const once = sanitiseCoachingProse('See fac_pricing.', g);
      const twice = sanitiseCoachingProse(once.text, g);
      expect(twice.text).toBe(once.text);
      expect(twice.matches).toEqual([]);
    });

    it('rule 1 (generic via label===id) reaches a fixed point on the second pass', () => {
      const g = coachingGraph([{ id: 'risk_churn', label: 'risk_churn' }]);
      const once = sanitiseCoachingProse('Track risk_churn closely.', g);
      const twice = sanitiseCoachingProse(once.text, g);
      expect(twice.text).toBe(once.text);
      expect(twice.matches).toEqual([]);
    });

    it('rule 2 (high-confidence orphan) reaches a fixed point on the second pass', () => {
      const once = sanitiseCoachingProse(
        'Strengthen fac_anything and bound risk_churn_rate.',
        coachingGraph([]),
      );
      const twice = sanitiseCoachingProse(once.text, coachingGraph([]));
      expect(twice.text).toBe(once.text);
      expect(twice.matches).toEqual([]);
    });

    it('rule 3 (preserved) is trivially idempotent', () => {
      const text = 'Use risk_adjusted analysis and apply goal_setting.';
      const once = sanitiseCoachingProse(text, coachingGraph([]));
      const twice = sanitiseCoachingProse(once.text, coachingGraph([]));
      expect(once.text).toBe(text);
      expect(twice.text).toBe(text);
    });

    it('clean input is trivially idempotent', () => {
      const text = 'Add a baseline option.';
      const once = sanitiseCoachingProse(text, coachingGraph([]));
      const twice = sanitiseCoachingProse(once.text, coachingGraph([]));
      expect(once.text).toBe(text);
      expect(twice.text).toBe(text);
    });
  });
});

// ----------------------------------------------------------------------------
// ROADMAP 1.192 leg κ(a) — top-level `graph_hash` on the egress envelope.
// Stamped at the single V5 egress chokepoint from opts.graph (= the
// authoritative per-turn graph, incl. the just-adopted first-touch graph).
// Trap-13: the positive control (graph present → hash emitted) runs before the
// fail-closed absence assertion (null graph → omitted).
// ----------------------------------------------------------------------------

describe('leg κ(a) — top-level graph_hash on egress', () => {
  it('POSITIVE CONTROL: a graph-bearing turn stamps graph_hash == computeAnalysisAffectingGraphHash(graph)', () => {
    const graph = makeGraph();
    const out = sanitiseOlumiResponseForEgress(emptyResponse({ assistant_text: 'hi' }), {
      graph,
      requestId: 'req-kappa-a',
      exitPath: 'test',
      userMessage: null,
      mayNameLeadingOption: true,
    });
    const expected = computeAnalysisAffectingGraphHash(
      graph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
    );
    expect(expected).not.toBeNull();
    expect((out as { graph_hash?: string }).graph_hash).toBe(expected);
  });

  it('FAIL-CLOSED: a graph-free turn OMITS graph_hash (never an empty string)', () => {
    const out = sanitiseOlumiResponseForEgress(emptyResponse({ assistant_text: 'hi' }), {
      graph: null,
      requestId: 'req-kappa-a-null',
      exitPath: 'test',
      userMessage: null,
      mayNameLeadingOption: true,
    });
    expect((out as { graph_hash?: string }).graph_hash).toBeUndefined();
  });

  it('IDEMPOTENT: re-running the chokepoint keeps the same graph_hash (the 4x re-entry contract)', () => {
    const graph = makeGraph();
    const opts = { graph, requestId: 'req-kappa-a-idem', exitPath: 'test', userMessage: null, mayNameLeadingOption: true };
    const once = sanitiseOlumiResponseForEgress(emptyResponse({ assistant_text: 'hi' }), opts);
    const twice = sanitiseOlumiResponseForEgress(once, opts);
    expect((twice as { graph_hash?: string }).graph_hash).toBe(
      (once as { graph_hash?: string }).graph_hash,
    );
  });
});
