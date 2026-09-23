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
 * ## ⚠ ROUND 2 (Codex CHANGES_REQUIRED 5796590960): NO STRONGER THAN THE HASH
 *
 * Round 1 framed this with the routing gate's "These two analyses used the same
 * analytical inputs". Equal `graph_hash_at_run` does not prove that: labels are
 * outside the hash, yet `run-analysis.ts` derives PLoT's `goal_direction` from
 * the goal LABEL, so a goal rename can change what the engine is asked while the
 * hash stays equal. The sentence now says only that the recorded structure and
 * values matched, so the pair cannot show what the change did — and it no
 * longer suggests the edit went unsaved.
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
import { SAME_INPUTS_LEAD_TEXT } from '../../routing/run-comparison-gate.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';
import { applyTerminologyRewrite } from '../../compose/terminology-rewrite.js';
import { detectCoachingSignal, RERUN_SAME_RECORDED_MODEL_TEXT } from '../coaching-signals.js';

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
    // The narrow framing, by IDENTITY — and NOT the gate's stronger claim.
    expect(text.startsWith(RERUN_SAME_RECORDED_MODEL_TEXT)).toBe(true);
    expect(text).not.toContain(SAME_INPUTS_LEAD_TEXT);
    expect(text).not.toMatch(/same analytical inputs|saved/i);
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
    expect(text.startsWith(RERUN_SAME_RECORDED_MODEL_TEXT)).toBe(true);
  });

  it('RED-FIRST — a moved margin on equal hashes is not attributed to the change', () => {
    const text = rerunText({
      priorFacts: [edgeEditFact(), priorRunFact(OFFSHORE_LEADS, 'hash-same')],
      currentEnv: OFFSHORE_LEADS_WIDER,
      currentHash: 'hash-same',
    });
    expect(text).not.toContain('Since you');
    expect(text.startsWith(RERUN_SAME_RECORDED_MODEL_TEXT)).toBe(true);
  });

  /**
   * ⭐ CODEX'S COUNTEREXAMPLE, THROUGH THE REAL PRODUCER. A goal rename is an
   * `edit_graph` fact; the goal LABEL is outside `graph_hash_at_run`, so the two
   * hashes stay equal while the goal direction PLoT receives can change. The
   * sentence must neither claim identical analytical inputs nor attribute the
   * result to (or deny the effect of) the rename.
   */
  it('RED-FIRST — a goal rename on equal hashes: no "same analytical inputs", no attribution', () => {
    const goalRename = {
      fact_type: 'edit_graph',
      fact_version: 1,
      noop: false,
      result: {
        edit_kind: 'rename',
        status: 'applied',
        operations_count: 1,
        affected_entities: [{ kind: 'goal', label: 'Reduce customer churn' }],
        graph_hash_before: 'hash-same',
        graph_hash_after: 'hash-same',
        safe_summary: 'Renamed the goal.',
      },
    } as unknown as HandlerFact;
    const text = rerunText({
      priorFacts: [goalRename, priorRunFact(OFFSHORE_LEADS, 'hash-same')],
      currentEnv: OFFSHORE_LEADS,
      currentHash: 'hash-same',
    });
    expect(text).not.toMatch(/same analytical inputs/i);
    expect(text).not.toContain('held both before and after');
    expect(text).not.toContain('Since you');
    expect(text).not.toContain('Reduce customer churn');
    expect(text.startsWith(RERUN_SAME_RECORDED_MODEL_TEXT)).toBe(true);
  });

  it('the new sentence survives the real terminology guard unchanged and carries no forbidden phrase', () => {
    const rewritten = applyTerminologyRewrite(RERUN_SAME_RECORDED_MODEL_TEXT);
    expect(rewritten.text).toBe(RERUN_SAME_RECORDED_MODEL_TEXT);
    expect(rewritten.applied).toEqual([]);
    expect(findForbiddenPhraseHit(RERUN_SAME_RECORDED_MODEL_TEXT)).toBeNull();
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
