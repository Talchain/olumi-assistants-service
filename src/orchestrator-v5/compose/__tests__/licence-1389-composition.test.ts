import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { OlumiResponseWithDebugFields } from '../../../orchestrator/debug-fields.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { tryRunComparisonGate } from '../../routing/run-comparison-gate.js';
import { enforceLeadingOptionClaimsAtWire } from '../leading-option-wire-enforcement.js';

// Composition control, not a new native capture: use #1389's actual comparison
// producer, then C2's actual final projection and captured admission envelope.
function capture(currentLabel: string) {
  const body = JSON.parse(
    readFileSync(
      new URL('./fixtures/c2-context-response-20260907T203538Z.json', import.meta.url),
      'utf8',
    ),
  );
  body.analysis_ready.options[2].label = currentLabel;
  return body;
}

function comparison(body: ReturnType<typeof capture>, permitted: boolean) {
  const fact = (current: boolean): HandlerFact =>
    ({
      fact_type: 'run_analysis',
      noop: false,
      result: {
        enrichment: {
          analysis_status: 'completed',
          results: body.analysis_ready.options.map(
            (option: { option_id: string; label: string }, i: number) => ({
              option_id: option.option_id,
              option_label: option.label,
              win_probability: i === 1 ? 0.1 : (i === 2) === current ? 0.6 : 0.3,
              probability_of_goal: i === 1 ? 0.9 : 0.7,
              outcome: { n_samples: 10_000 },
            }),
          ),
        },
        computed_at: current ? '2026-09-07T20:01:00.000Z' : '2026-09-07T20:00:00.000Z',
        graph_hash_at_run: current ? 'current-inputs' : 'prior-inputs',
        constraint_verdict: {
          may_name_leading_option: permitted,
          constraint_verdict_state: permitted ? 'evaluated_feasible' : 'evaluated_infeasible',
        },
      },
    }) as unknown as HandlerFact;
  const outcome = tryRunComparisonGate({
    message: 'What changed?',
    priorFacts: [fact(true), fact(false)],
    freshness: 'fresh',
    mayNameLeadingOption: permitted,
  });
  expect(outcome.matched).toBe(true);
  if (!outcome.matched) throw new Error('The actual comparison producer did not execute');
  expect(outcome.mode).toBe('compared');
  expect(outcome.leader_identity_basis).toBe('option_id');
  expect(outcome.leading_option_changed).toBe(true);
  return outcome.assistant_text;
}

function project(body: ReturnType<typeof capture>) {
  return enforceLeadingOptionClaimsAtWire(body as OlumiResponse, {
    requestId: 'local-c2-1389-composition',
    exitPath: 'turn_executor',
    mayNameLeadingOption: true,
    analysisReady: body.analysis_ready,
    graph: undefined,
  });
}

describe('approved #1389 producer composed with C2 final licence projection', () => {
  it.each(['Hire a Tech Lead', 'Launch in May', 'May'])(
    'projects the actual score-frequency comparison when admission withholds: %s',
    (label) => {
      const body = capture(label);
      const text = comparison(body, true);
      expect(text).toContain(
        'The option that scored highest most often in the model simulations has changed.',
      );
      expect(text).toContain(`${label} scored highest most often in the latest run`);
      expect(text).not.toContain('most likely to serve your goal');
      body.assistant_text = text;
      expect(body.analysis_ready.analysis_admission.permitted_analysis_mode).toBe(
        'quantified_provisional',
      );
      const result = project(body);
      expect(result.response.assistant_text).not.toMatch(/scored highest|most likely to serve/);
      expect(result.response.assistant_text).not.toContain(label);
      expect(result.response.assistant_text.length).toBeGreaterThan(20);
      expect(result.response.analysis_state).toBe(body.analysis_state);
      expect(
        (result.response as OlumiResponseWithDebugFields)._diagnostic_trace,
      ).toBe(body._diagnostic_trace);
    },
  );

  it.each(['Hire a Tech Lead', 'Launch in May', 'May'])(
    'preserves the identical producer response by reference when licensed: %s',
    (label) => {
      const body = capture(label);
      body.assistant_text = comparison(body, true);
      body.analysis_ready.analysis_admission.permitted_analysis_mode = 'comparative_leader';
      expect(project(body).response).toBe(body);
    },
  );

  it('preserves the useful answer from a comparison that already withheld identities', () => {
    const body = capture('Hire a Tech Lead');
    body.assistant_text = comparison(body, false);
    expect(body.assistant_text.length).toBeGreaterThan(20);
    expect(body.assistant_text).not.toMatch(/scored highest|most likely to serve|Hire a Tech Lead/);
    expect(project(body).response.assistant_text).toBe(body.assistant_text);
  });
});
