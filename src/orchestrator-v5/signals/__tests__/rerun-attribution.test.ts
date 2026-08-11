/**
 * PR2 L2 — ATTRIBUTION on the rerun consequence sentence.
 *
 * The loop's terminal: after a model change followed by a re-run, the sentence
 * says what the user changed AND what the answer did, grounded in the two
 * computed runs and the fact log, never invented.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CORPUS DELIBERATELY EXCLUDES (CLAUDE.md trap 13d(c) — check what a
 * corpus omits, not only what it covers):
 *
 *   - **Edge ENDPOINT labels.** There is no case asserting "the link from A to
 *     B", because no edit fact carries node labels. `GraphEditResultBaseSchema`
 *     is `.strict()` at `{target_id, status, before, after}` and an edge's
 *     before/after snapshots hold node IDS; `edit_graph`'s
 *     `affected_entities` is `.strict()` at `{kind, label}` with NO id. The
 *     design premise that both are available is REFUTED, and a test asserting
 *     endpoint labels would be asserting a fabrication.
 *   - **`add_constraint` at the FACT level.** Its verb is covered at the copy
 *     seam below; its fact→label extraction is owned and conformance-tested by
 *     `context/recent-changes.ts`, which this module single-sources from
 *     rather than re-deriving.
 *   - **Multi-run windows deeper than one intervening run.** The precondition
 *     test covers one; the guard is `some(...)`, so depth does not vary it.
 *
 * The causal-connective corpus (I-9) is drawn from the CONTRACT's own
 * vocabulary (`run-delta.d.ts`'s `attribution_case`), not from the author's
 * head, and includes an adversarial USER-AUTHORED label carrying a causal word
 * — the class an author writing neutral fixtures would never imagine.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  deriveInterveningChange,
  type InterveningChange,
} from '../../coaching/intervening-change.js';
import type { ContextPack } from '../../context/context-pack-assembler.js';
import type { SuccessfulHandlerOutcome } from '../../tools/handler-outcome.js';
import { COACHING_TEXT, detectCoachingSignal } from '../coaching-signals.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures. Envelope shape mirrors `compare-runs.test.ts` / the sibling
// coaching-signals spec, so the projection under test is the real one.
// ─────────────────────────────────────────────────────────────────────────────

function runEnvelope(
  options: Array<{ id: string; label: string; win: number }>,
): Record<string, unknown> {
  return {
    analysis_status: 'completed',
    results: options.map((o) => ({
      option_id: o.id,
      option_label: o.label,
      win_probability: o.win,
      factor_sensitivity: [],
    })),
  };
}

/** Same options, but with NO `option_id` — forces `leader_identity_basis` off
 *  `option_id`, i.e. the honest-abstention arm. */
function unidentifiedEnvelope(
  options: Array<{ label: string; win: number }>,
): Record<string, unknown> {
  return {
    analysis_status: 'completed',
    results: options.map((o) => ({
      option_label: o.label,
      win_probability: o.win,
      factor_sensitivity: [],
    })),
  };
}

function currentRunOutcome(env: Record<string, unknown>): SuccessfulHandlerOutcome {
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
        },
      } as unknown as HandlerFact,
    ],
  };
}

function priorRunFact(env: Record<string, unknown>): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-1',
      summary: 'prior',
      enrichment: env,
      graph_hash_at_run: 'hash-prior',
      computed_at: '2026-07-01T00:00:00.000Z',
    },
  } as unknown as HandlerFact;
}

function factorEditFact(label: string, noop = false): HandlerFact {
  return {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop,
    result: {
      target_id: 'factor-churn',
      status: noop ? 'noop' : 'applied',
      before: { value: 1, raw_value: 1, label },
      after: { value: 2, raw_value: 2, label },
    },
  } as unknown as HandlerFact;
}

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

function editGraphFact(label: string): HandlerFact {
  return {
    fact_type: 'edit_graph',
    fact_version: 1,
    noop: false,
    result: {
      edit_kind: 'value_update',
      status: 'applied',
      operations_count: 1,
      affected_entities: [{ kind: 'edge', label }],
      graph_hash_before: 'h0',
      graph_hash_after: 'h1',
      safe_summary: `Updated ${label}.`,
    },
  } as unknown as HandlerFact;
}

const OFFSHORE_LEADS = runEnvelope([
  { id: 'a', label: 'Offshore', win: 0.62 },
  { id: 'b', label: 'Onshore', win: 0.38 },
]);
const OFFSHORE_LEADS_WIDER = runEnvelope([
  { id: 'a', label: 'Offshore', win: 0.72 },
  { id: 'b', label: 'Onshore', win: 0.28 },
]);
const OFFSHORE_LEADS_NARROWER = runEnvelope([
  { id: 'a', label: 'Offshore', win: 0.53 },
  { id: 'b', label: 'Onshore', win: 0.47 },
]);
const ONSHORE_LEADS = runEnvelope([
  { id: 'b', label: 'Onshore', win: 0.55 },
  { id: 'a', label: 'Offshore', win: 0.45 },
]);

function minimalContextPack(): ContextPack {
  return {
    version: '2.0',
    stage: 'analyse',
    graph: {
      nodes: [], edges: [], options: [], goals: [], constraints: [],
      counts: { nodes: 0, edges: 0, options: 0, goals: 0, constraints: 0 },
    },
    analysis: null,
    conversation: {
      recent_turns: [], turn_count: 1, last_tool_used: null, pending_confirmation: false,
    },
    coaching: { draft_coaching: null, decision_review: null, last_coaching_signal: null },
    compound_detected: false,
    compound_pattern_matched: null,
    parsed_quantities: [],
    system_event: null,
  };
}

/** Drive the real detector on a re-run turn. */
function rerunText(args: {
  priorFacts: readonly HandlerFact[];
  currentEnv: Record<string, unknown>;
  mayNameLeadingOption?: boolean;
}): string {
  const detection = detectCoachingSignal({
    proposedHandlerId: 'run_analysis',
    mayNameLeadingOption: args.mayNameLeadingOption ?? true,
    outcome: currentRunOutcome(args.currentEnv),
    contextPack: minimalContextPack(),
    priorFacts: args.priorFacts,
  });
  expect(detection?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
  return detection!.coaching_text;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('PR2 L2 — deriveInterveningChange (the fact-log join)', () => {
  it('names the single authored change that landed after the compared run', () => {
    const facts = [factorEditFact('Customer churn'), priorRunFact(OFFSHORE_LEADS)];
    const change = deriveInterveningChange(facts, 1);
    // Bound by IDENTITY of the action discriminator + the producer's own
    // target_label, not by a substring another fact could satisfy.
    expect(change).toEqual({
      kind: 'single',
      action: 'factor_value_updated',
      target_label: 'Customer churn',
    });
  });

  it('an EDGE edit resolves to the generic link descriptor, because the fact carries no node labels', () => {
    // Producer semantics (trap 13c): `recent-changes.ts` returns this exact
    // target_label for `adjust_edge_strength` precisely BECAUSE the fact holds
    // ids only. Asserting endpoint labels here would assert a fabrication.
    const change = deriveInterveningChange(
      [edgeEditFact(), priorRunFact(OFFSHORE_LEADS)],
      1,
    );
    expect(change).toEqual({
      kind: 'single',
      action: 'link_strength_updated',
      target_label: 'a link in the decision model',
    });
  });

  it('an edit_graph edit takes its label from affected_entities[0]', () => {
    const change = deriveInterveningChange(
      [editGraphFact('CRM adoption to sales productivity'), priorRunFact(OFFSHORE_LEADS)],
      1,
    );
    expect(change).toEqual({
      kind: 'single',
      action: 'graph_edited',
      target_label: 'CRM adoption to sales productivity',
    });
  });

  it('SEVERAL changes name NONE of them (a sole-cause claim by omission is still a causal claim)', () => {
    const change = deriveInterveningChange(
      [factorEditFact('Customer churn'), edgeEditFact(), priorRunFact(OFFSHORE_LEADS)],
      2,
    );
    expect(change).toEqual({ kind: 'several' });
  });

  it('a NO-OP edit is not an authored change and yields no attribution', () => {
    const change = deriveInterveningChange(
      [factorEditFact('Customer churn', true), priorRunFact(OFFSHORE_LEADS)],
      1,
    );
    expect(change).toBeNull();
  });

  it('PRECONDITION: another run_analysis inside the window FAILS CLOSED', () => {
    // The edit is separated from the compared run by a whole other analysis, so
    // "since you changed X" would be a false temporal claim about this pair.
    const facts = [
      factorEditFact('Customer churn'),
      priorRunFact(OFFSHORE_LEADS),
      priorRunFact(OFFSHORE_LEADS),
    ];
    expect(deriveInterveningChange(facts, 2)).toBeNull();
  });

  it('no facts before the compared run ⇒ null (nothing intervened)', () => {
    expect(deriveInterveningChange([priorRunFact(OFFSHORE_LEADS)], 0)).toBeNull();
  });
});

describe('PR2 L2 — the attributed consequence sentence', () => {
  const CHANGE: InterveningChange = {
    kind: 'single',
    action: 'link_strength_updated',
    target_label: 'a link in the decision model',
  };

  it('UNCHANGED reads as a FINDING, not an apology (the null arm is the scientific one)', () => {
    const facts = [edgeEditFact(), priorRunFact(OFFSHORE_LEADS)];
    const text = rerunText({ priorFacts: facts, currentEnv: OFFSHORE_LEADS });
    expect(text).toBe(
      'Since you adjusted a link in the decision model, the picture is the same: '
      + 'Offshore still leads. That is a result in itself: the recommendation does '
      + 'not hinge on that change.',
    );
  });

  it('LEADER CHANGED is attributed and still names both options', () => {
    const facts = [edgeEditFact(), priorRunFact(OFFSHORE_LEADS)];
    const text = rerunText({ priorFacts: facts, currentEnv: ONSHORE_LEADS });
    expect(text).toBe(
      'Since you adjusted a link in the decision model, the result has changed: '
      + 'Offshore led before, and Onshore now leads. Ask what changed if you want the detail.',
    );
  });

  it('WIDENED keeps the computed magnitude, read from the two runs', () => {
    const facts = [edgeEditFact(), priorRunFact(OFFSHORE_LEADS)];
    const text = rerunText({ priorFacts: facts, currentEnv: OFFSHORE_LEADS_WIDER });
    expect(text).toBe(
      'Since you adjusted a link in the decision model, Offshore still leads after '
      + 'this re-run, and its lead has widened by about 20 percentage points.',
    );
  });

  it('NARROWED keeps the computed magnitude, read from the two runs', () => {
    const facts = [edgeEditFact(), priorRunFact(OFFSHORE_LEADS)];
    const text = rerunText({ priorFacts: facts, currentEnv: OFFSHORE_LEADS_NARROWER });
    expect(text).toBe(
      'Since you adjusted a link in the decision model, Offshore still leads after '
      + 'this re-run, though its lead has narrowed by about 18 percentage points.',
    );
  });

  it('SEVERAL changes produce the unnamed opener', () => {
    const facts = [factorEditFact('Customer churn'), edgeEditFact(), priorRunFact(OFFSHORE_LEADS)];
    const text = rerunText({ priorFacts: facts, currentEnv: OFFSHORE_LEADS });
    expect(text.startsWith('Since your recent changes, ')).toBe(true);
    expect(text).not.toContain('a link in the decision model');
    expect(text).not.toContain('Customer churn');
  });

  it('every action has a verb that is true of the fact it covers', () => {
    const cases: Array<[InterveningChange, string]> = [
      [{ kind: 'single', action: 'factor_value_updated', target_label: 'Customer churn' },
        'Since you changed Customer churn, '],
      [{ kind: 'single', action: 'constraint_added', target_label: 'Total cost' },
        'Since you set a limit on Total cost, '],
      [{ kind: 'single', action: 'link_strength_updated', target_label: 'a link in the decision model' },
        'Since you adjusted a link in the decision model, '],
      [{ kind: 'single', action: 'graph_edited', target_label: 'the decision model' },
        'Since you changed the decision model, '],
    ];
    for (const [change, opener] of cases) {
      const text = COACHING_TEXT.RERUN_ANALYSIS_COMPLETE({
        runDelta: {
          comparable: true,
          leading_option_changed: false,
          leader_identity_basis: 'option_id',
          prior_leading_label: 'Offshore',
          current_leading_label: 'Offshore',
          margin_direction: 'unchanged',
          margin_shift_pp: 0,
          driver_rank_changes: [],
          robustness_changed: false,
          prior_band: 'moderate',
          current_band: 'moderate',
        },
        interveningChange: change,
      });
      expect(text.startsWith(opener)).toBe(true);
    }
  });
});

describe('PR2 L2 — where attribution must NOT appear', () => {
  it('ABSTENTION: never attributed, because no comparison was made', () => {
    // Prior run carries no option ids ⇒ leader_identity_basis !== 'option_id'.
    const facts = [
      edgeEditFact(),
      priorRunFact(unidentifiedEnvelope([
        { label: 'Offshore', win: 0.62 },
        { label: 'Onshore', win: 0.38 },
      ])),
    ];
    const text = rerunText({ priorFacts: facts, currentEnv: OFFSHORE_LEADS });
    expect(text).toBe(
      'Offshore leads after this re-run. I cannot line up the earlier result with '
      + 'this one, so I have not compared the two.',
    );
    expect(text).not.toContain('Since you');
  });

  it('WITHHELD LEADER: attribution cannot outlive its host sentence', () => {
    const facts = [edgeEditFact(), priorRunFact(OFFSHORE_LEADS)];
    const text = rerunText({
      priorFacts: facts,
      currentEnv: OFFSHORE_LEADS,
      mayNameLeadingOption: false,
    });
    expect(text).toBe('This was a re-run. It replaces the earlier result as the current analysis.');
    expect(text).not.toContain('Since');
  });

  it('NO-HARM: with no intervening change every branch is BYTE-IDENTICAL to the pre-attribution copy', () => {
    // ⚠ Each case below carries a LICENSED delta that attribution COULD have
    // corrupted — a no-harm case that cannot trigger the transformation
    // asserts nothing (CLAUDE.md trap 13d).
    const prior = [priorRunFact(OFFSHORE_LEADS)];
    expect(rerunText({ priorFacts: prior, currentEnv: OFFSHORE_LEADS }))
      .toBe('The result is unchanged: Offshore still leads.');
    expect(rerunText({ priorFacts: prior, currentEnv: ONSHORE_LEADS }))
      .toBe('This re-run changed the outcome: Offshore led before, and Onshore now '
        + 'leads. Ask what changed if you want the detail.');
    expect(rerunText({ priorFacts: prior, currentEnv: OFFSHORE_LEADS_WIDER }))
      .toBe('Offshore still leads after this re-run, and its lead has widened by '
        + 'about 20 percentage points.');
    expect(rerunText({ priorFacts: prior, currentEnv: OFFSHORE_LEADS_NARROWER }))
      .toBe('Offshore still leads after this re-run, though its lead has narrowed by '
        + 'about 18 percentage points.');
  });
});

describe('PR2 L2 — the sentence is TEMPORAL, never CAUSAL', () => {
  // Vocabulary taken from the CONTRACT's attribution model, not invented here:
  // `C1_attributable` is the only case that would license causation, and it
  // requires `pair_provenance.seed_equal`, which the live path does not pin.
  const CAUSAL = [
    /\bbecause\b/i, /\bcaused?\b/i, /\bis why\b/i, /\bas a result of\b/i,
    /\bdue to\b/i, /\bled to\b/i, /\bresulted in\b/i, /\btherefore\b/i,
  ];

  const PRIOR_SETS: Array<readonly HandlerFact[]> = [
    [edgeEditFact(), priorRunFact(OFFSHORE_LEADS)],
    [factorEditFact('Customer churn'), priorRunFact(OFFSHORE_LEADS)],
    [editGraphFact('CRM adoption'), priorRunFact(OFFSHORE_LEADS)],
    [factorEditFact('Customer churn'), edgeEditFact(), priorRunFact(OFFSHORE_LEADS)],
  ];
  const ENVS = [
    OFFSHORE_LEADS, ONSHORE_LEADS, OFFSHORE_LEADS_WIDER, OFFSHORE_LEADS_NARROWER,
  ];

  /** The same delta with NOTHING intervening — i.e. the pre-attribution copy. */
  function unattributed(currentEnv: Record<string, unknown>): string {
    return rerunText({ priorFacts: [priorRunFact(OFFSHORE_LEADS)], currentEnv });
  }

  // ⚠ THESE TWO TESTS ANSWER DIFFERENT QUESTIONS AND ARE DELIBERATELY SEPARATE
  // (CLAUDE.md trap 21). The first asks "does the product assert causation?";
  // the second asks "is the opener the temporal word we chose?". Folded into
  // one test they were indistinguishable: a mutant swapping "Since"→"After"
  // REDded the causal test via its positive control, so the causal assertion
  // appeared to bite when it had not. Split, the discriminating pair is legible
  // — "Since"→"Because" REDs BOTH, "Since"→"After" REDs only the second.
  it('no branch of the attributed copy contains a causal connective', () => {
    let composed = 0;
    for (const priorFacts of PRIOR_SETS) {
      for (const currentEnv of ENVS) {
        const text = rerunText({ priorFacts, currentEnv });
        for (const pattern of CAUSAL) expect(text).not.toMatch(pattern);
        // Non-vacuity, bound to the PROPERTY rather than to a word: attribution
        // demonstrably changed this sentence, so the loop cannot pass by
        // composing nothing attributable. Robust to a wording change, which the
        // literal-token control was not.
        expect(text).not.toBe(unattributed(currentEnv));
        composed += 1;
      }
    }
    expect(composed).toBe(16);
  });

  it('the attributed opener is the TEMPORAL connective "Since"', () => {
    for (const priorFacts of PRIOR_SETS) {
      for (const currentEnv of ENVS) {
        expect(rerunText({ priorFacts, currentEnv }).startsWith('Since ')).toBe(true);
      }
    }
  });

  it('a USER-AUTHORED label carrying a causal word is echoed verbatim and is not the product asserting causation', () => {
    // The class a neutral-fixture author never imagines. The guard governs the
    // product's OWN connectives; a label is user data and is passed through
    // rather than rewritten (rewriting it would misname the thing changed).
    const text = rerunText({
      priorFacts: [factorEditFact('Because-rate assumption'), priorRunFact(OFFSHORE_LEADS)],
      currentEnv: OFFSHORE_LEADS,
    });
    expect(text.startsWith('Since you changed Because-rate assumption, ')).toBe(true);
    // The product's own template contributes no causal connective: strip the
    // user's label and nothing causal remains.
    const withoutLabel = text.replace('Because-rate assumption', 'X');
    for (const pattern of CAUSAL) expect(withoutLabel).not.toMatch(pattern);
  });
});
