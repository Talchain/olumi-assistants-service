/**
 * Envelope-level integration test for the central egress sanitiser.
 *
 * Verifies that responses produced by the V5 failure-response path AND the
 * full happy-path composition shape can flow through
 * `sanitiseOlumiResponseForEgress` (the central scan wired into
 * `sendFinalised200` in route-v2.ts) and emerge clean across `assistant_text`,
 * `blocks[]`, and `suggested_actions[]`.
 *
 * The route-level Mechanism A (typed `V5RouteReply`) + Mechanism B
 * (preSerialization hook) safeguards already prevent any 200-OK from
 * bypassing `sendFinalised200`. The sanitiser is wired at the single
 * chokepoint inside that function. Spinning up Fastify for this test
 * would only re-verify a wiring that the type system already guarantees;
 * the value here is asserting that real failure-response and happy-path
 * envelopes — with leaked IDs injected at the dispatcher boundary — come
 * out clean across every user-visible field.
 */

import { describe, it, expect } from 'vitest';
import { sanitiseOlumiResponseForEgress } from '../compose/output-safety.js';
import { buildFailureResponse } from '../failure-response.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { GraphV3T } from '../../orchestrator/types.js';

function makeGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'fac_delivery_cost', kind: 'factor', label: 'Delivery Cost' },
      { id: 'opt_offshore_partner', kind: 'option', label: 'Offshore Partner' },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

describe('Egress sanitiser — envelope-level integration', () => {
  it('failure-response envelope with leaked IDs in error.details emerges clean (details opaque, assistant_text scrubbed)', () => {
    // buildFailureResponse stamps assistant_text from the recovery helper,
    // not from arbitrary user data — but a future code path could wire LLM
    // output into details. Inject a leak there to confirm the egress scan
    // leaves the structured `details` (machine-readable) untouched but
    // catches any leaks that escape into prose.
    const failure: OlumiResponse = buildFailureResponse(
      'UNHANDLED',
      'frame',
      { failure_reason: 'fac_delivery_cost rejection' },
      {
        cause: undefined,
        previousUserMessage: 'Increase fac_delivery_cost to 0.8',
        scenarioId: 'sc-1',
        turnId: 't-1',
        isRetry: false,
        handlerId: null,
      },
    );

    // Manually inject a leak into assistant_text to simulate the case where
    // a future composition path might surface a raw ID in user-facing prose.
    const polluted: OlumiResponse = {
      ...failure,
      assistant_text: `${failure.assistant_text} (related to fac_delivery_cost)`,
    };

    const sanitised = sanitiseOlumiResponseForEgress(polluted, {
      graph: makeGraph(),
      requestId: 'req-failure-1',
      exitPath: 'turn_executor', userMessage: null, mayNameLeadingOption: true,
    });

    // assistant_text scrubbed.
    expect(sanitised.assistant_text).not.toContain('fac_delivery_cost');
    expect(sanitised.assistant_text).toContain('Delivery Cost');

    // error.details left untouched (structured, machine-readable).
    const block = sanitised.blocks[0]!;
    expect(block.type).toBe('error');
    if (block.type === 'error') {
      expect(block.details?.failure_reason).toBe('fac_delivery_cost rejection');
    }
  });

  it('happy-path envelope (analysis_result + chips + insights) emerges clean across every visible field', () => {
    const polluted: OlumiResponse = {
      response_version: 2,
      assistant_text:
        'fac_delivery_cost dominates and opt_offshore_partner is the runner-up.',
      blocks: [
        {
          type: 'analysis_result',
          summary: 'fac_delivery_cost has the largest sensitivity.',
          leading_option_id: 'opt_offshore_partner',
          win_probabilities: { opt_offshore_partner: 0.6 },
        },
        {
          type: 'explanation',
          narrative: 'fac_delivery_cost drives opt_offshore_partner to win.',
          referenced_option_ids: ['opt_offshore_partner'],
        },
      ],
      suggested_actions: [
        {
          id: 'chip_run_analysis',
          label: 'Re-run with higher fac_delivery_cost',
          message: 'Re-run with fac_delivery_cost = 0.8',
          action_type: 'run_analysis',
        },
      ],
      insights: [{ id: 'insight_1', text: 'fac_delivery_cost is fragile.' }],
      stage_indicator: 'analyse',
    };

    const sanitised = sanitiseOlumiResponseForEgress(polluted, {
      graph: makeGraph(),
      requestId: 'req-happy-1',
      exitPath: 'turn_executor', userMessage: null, mayNameLeadingOption: true,
    });

    // Top-level prose
    expect(sanitised.assistant_text).toBe(
      'Delivery Cost dominates and Offshore Partner is the runner-up.',
    );

    // Block prose
    const ar = sanitised.blocks[0]!;
    expect(ar.type).toBe('analysis_result');
    if (ar.type === 'analysis_result') {
      expect(ar.summary).toBe('Delivery Cost has the largest sensitivity.');
      // Machine fields untouched.
      expect(ar.leading_option_id).toBe('opt_offshore_partner');
    }
    const ex = sanitised.blocks[1]!;
    expect(ex.type).toBe('explanation');
    if (ex.type === 'explanation') {
      expect(ex.narrative).toBe('Delivery Cost drives Offshore Partner to win.');
      expect(ex.referenced_option_ids).toEqual(['opt_offshore_partner']);
    }

    // Chip label/message scrubbed; id/action_type machine-protected.
    expect(sanitised.suggested_actions[0]).toEqual({
      id: 'chip_run_analysis',
      label: 'Re-run with higher Delivery Cost',
      message: 'Re-run with Delivery Cost = 0.8',
      action_type: 'run_analysis',
    });

    // Insight text scrubbed; id machine-protected.
    expect(sanitised.insights[0]).toEqual({
      id: 'insight_1',
      text: 'Delivery Cost is fragile.',
    });

    // Final wire body must be free of any raw entity IDs anywhere in the
    // user-visible fields. Stringify for a coarse but unambiguous check
    // (machine-only fields like leading_option_id are deliberately exempted
    // and left in their raw form — still present in the JSON).
    expect(sanitised.assistant_text).not.toContain('fac_');
    expect(sanitised.assistant_text).not.toContain('opt_');
    if (ar.type === 'analysis_result') expect(ar.summary).not.toContain('fac_');
    if (ex.type === 'explanation') expect(ex.narrative).not.toContain('fac_');
    expect(sanitised.suggested_actions[0]?.label).not.toContain('fac_');
    expect(sanitised.suggested_actions[0]?.message).not.toContain('fac_');
    expect(sanitised.insights[0]?.text).not.toContain('fac_');
  });
});
