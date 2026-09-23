/**
 * "HELD BOTH BEFORE AND AFTER" NEEDS AN AFTER — the re-run sentence may not
 * attribute a result to a change the analysis never saw.
 *
 * ## The defect (Paul's manual test, 23 Sep 2026, scenario `58af9704`)
 *
 * Paul's option edits never wrote the option's `interventions`, so both runs
 * were computed on the SAME analysis inputs (identical PLoT fingerprint, seed
 * and win percentages). The re-run sentence still said *"…the conclusion held
 * both before and after those changes"* — a robustness-shaped observation about
 * a change that was never part of either run. Routed to AI Coaching on #63
 * 5794675550; named a READY_FOR_PAUL blocker by Release Control (5794727734).
 *
 * ## Why the existing gates miss it
 *
 * `interveningEditIsInert` covers ONE `factor_value_updated` edit on a factor
 * every option overrides. It cannot see a change that did not land at all, nor
 * any other change kind. The run-comparison ROUTING gate already answers this
 * exact question for the user-asked comparison (`run-comparison-gate.ts`, mode
 * `same_inputs`: two NON-NULL equal `graph_hash_at_run` ⇒ "cannot use this pair
 * to show the effect of an update"). The coaching re-run sentence never asked it.
 *
 * ## The rule pinned here
 *
 * Two NON-NULL equal `graph_hash_at_run` on the compared pair ⇒ no attribution
 * clause, no "held both before and after", and the SAME framing sentences the
 * routing gate uses — so the two re-run surfaces cannot drift. A null hash on
 * either side proves nothing (legacy fact), exactly as in the gate.
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { SuccessfulHandlerOutcome } from '../../tools/handler-outcome.js';
import {
  SAME_INPUTS_LEAD_TEXT,
  SAME_INPUTS_OFFER_TEXT,
} from '../../routing/run-comparison-gate.js';
import { detectCoachingSignal } from '../coaching-signals.js';

const N = 10_000;

function runEnvelope(options: Array<{ id: string; label: string; win: number }>): Record<string, unknown> {
  return {
    analysis_status: 'completed',
    results: options.map((o) => ({
      option_id: o.id,
      option_label: o.label,
      win_probability: o.win,
      factor_sensitivity: [],
      outcome: { n_samples: N },
    })),
  };
}

const OFFSHORE_LEADS = runEnvelope([
  { id: 'a', label: 'Offshore', win: 0.62 },
  { id: 'b', label: 'Onshore', win: 0.38 },
]);
const OFFSHORE_LEADS_WIDER = runEnvelope([
  { id: 'a', label: 'Offshore', win: 0.72 },
  { id: 'b', label: 'Onshore', win: 0.28 },
]);

function currentRunOutcome(env: Record<string, unknown>, hash: string | null): SuccessfulHandlerOutcome {
  return {
    assistant_text: 'done',
    llm_calls_used: 0,
    handler_facts: [
      {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: 'scen-a',
          leading_option_id: 'opt-1',
          summary: 'Ran analysis',
          enrichment: env,
          ...(hash === null ? {} : { graph_hash_at_run: hash }),
          computed_at: '2026-07-02T00:00:00.000Z',
        },
      } as unknown as HandlerFact,
    ],
  };
}

function priorRunFact(env: Record<string, unknown>, hash: string | null): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-1',
      summary: 'prior',
      enrichment: env,
      ...(hash === null ? {} : { graph_hash_at_run: hash }),
      computed_at: '2026-07-01T00:00:00.000Z',
    },
  } as unknown as HandlerFact;
}

/** An edge edit — NOT a factor value, so `interveningEditIsInert` cannot fire. */
function edgeEditFact(): HandlerFact {
  return {
    fact_type: 'adjust_edge_strength',
    fact_version: 1,
    noop: false,
    result: {
      target_id: 'node-a→node-b',
      status: 'applied',
      before: { from: 'node-a', to: 'node-b', strength: { mean: 0.25, std: 0.1 } },
      after: { from: 'node-a', to: 'node-b', strength: { mean: 0.15, std: 0.1 } },
    },
  } as unknown as HandlerFact;
}

function factorEditFact(label: string): HandlerFact {
  return {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: false,
    result: {
      target_id: 'factor-churn',
      status: 'applied',
      before: { value: 1, raw_value: 1, label },
      after: { value: 2, raw_value: 2, label },
    },
  } as unknown as HandlerFact;
}

function rerunText(args: {
  priorFacts: readonly HandlerFact[];
  currentEnv: Record<string, unknown>;
  currentHash: string | null;
}): string {
  const detection = detectCoachingSignal({
    proposedHandlerId: 'run_analysis',
    mayNameLeadingOption: true,
    outcome: currentRunOutcome(args.currentEnv, args.currentHash),
    contextPack: null,
    priorFacts: args.priorFacts,
  });
  expect(detection?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
  return detection!.coaching_text;
}

describe('a re-run on the SAME analysis inputs attributes nothing to the change', () => {
  it('RED-FIRST — unchanged leader + an attributed change + equal hashes: no "held both before and after"', () => {
    const text = rerunText({
      priorFacts: [edgeEditFact(), priorRunFact(OFFSHORE_LEADS, 'hash-same')],
      currentEnv: OFFSHORE_LEADS,
      currentHash: 'hash-same',
    });
    expect(text).not.toContain('held both before and after');
    expect(text).not.toContain('Since you');
    // The routing gate's own framing, by IDENTITY — not a paraphrase.
    expect(text.startsWith(SAME_INPUTS_LEAD_TEXT)).toBe(true);
    expect(text.endsWith(SAME_INPUTS_OFFER_TEXT)).toBe(true);
    // The observation itself survives: the leader is still reported.
    expect(text).toContain('Offshore still leads');
  });

  it('RED-FIRST — several changes + equal hashes: no plural attribution either', () => {
    const text = rerunText({
      priorFacts: [factorEditFact('Customer churn'), edgeEditFact(), priorRunFact(OFFSHORE_LEADS, 'hash-same')],
      currentEnv: OFFSHORE_LEADS,
      currentHash: 'hash-same',
    });
    expect(text).not.toContain('Since your recent changes');
    expect(text).not.toContain('held both before and after');
    expect(text.startsWith(SAME_INPUTS_LEAD_TEXT)).toBe(true);
  });

  it('RED-FIRST — a moved margin on equal hashes is not attributed to the change', () => {
    const text = rerunText({
      priorFacts: [edgeEditFact(), priorRunFact(OFFSHORE_LEADS, 'hash-same')],
      currentEnv: OFFSHORE_LEADS_WIDER,
      currentHash: 'hash-same',
    });
    expect(text).not.toContain('Since you');
    expect(text.startsWith(SAME_INPUTS_LEAD_TEXT)).toBe(true);
  });
});

describe('contrast — the attributed sentence is unchanged where the inputs DID change or are unknown', () => {
  const ATTRIBUTED_UNCHANGED =
    'Since you adjusted a link in the decision model, the picture has stayed the '
    + 'same: Offshore still leads. That is a result in itself: the conclusion held '
    + 'both before and after that change.';

  it('different hashes: byte-identical to the shipped attributed sentence', () => {
    const text = rerunText({
      priorFacts: [edgeEditFact(), priorRunFact(OFFSHORE_LEADS, 'hash-before')],
      currentEnv: OFFSHORE_LEADS,
      currentHash: 'hash-after',
    });
    expect(text).toBe(ATTRIBUTED_UNCHANGED);
  });

  it('a null hash on either side proves nothing (legacy fact): unchanged behaviour', () => {
    expect(rerunText({
      priorFacts: [edgeEditFact(), priorRunFact(OFFSHORE_LEADS, 'hash-same')],
      currentEnv: OFFSHORE_LEADS,
      currentHash: null,
    })).toBe(ATTRIBUTED_UNCHANGED);
    expect(rerunText({
      priorFacts: [edgeEditFact(), priorRunFact(OFFSHORE_LEADS, null)],
      currentEnv: OFFSHORE_LEADS,
      currentHash: 'hash-same',
    })).toBe(ATTRIBUTED_UNCHANGED);
  });

  it('equal hashes but NO intervening change: the plain unattributed sentence, no framing', () => {
    // Nothing was attributed, so there is nothing to withdraw; a pure repeat run
    // keeps its existing copy byte-identically.
    const text = rerunText({
      priorFacts: [priorRunFact(OFFSHORE_LEADS, 'hash-same')],
      currentEnv: OFFSHORE_LEADS,
      currentHash: 'hash-same',
    });
    expect(text).toBe('The result is unchanged: Offshore still leads.');
  });
});
