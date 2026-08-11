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
import type { SuccessfulHandlerOutcome } from '../../tools/handler-outcome.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';
import { applyTerminologyRewrite } from '../../compose/terminology-rewrite.js';
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
/**
 * ONE recommendable option ⇒ `margin` is null (`analysis-compact.ts:836` needs
 * >= 2) ⇒ `deriveMargin` returns `'unavailable'` (`compare-runs.ts:272`). The
 * leader is still identified, so `leader_identity_basis` stays `'option_id'`
 * and this reaches the `unavailable` arm rather than the abstention arm.
 * Module-level because three suites need it, including the egress pin.
 */
const MARGIN_UNAVAILABLE = runEnvelope([{ id: 'a', label: 'Offshore', win: 0.62 }]);
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
    contextPack: null,
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
  it('UNCHANGED reads as a FINDING, not an apology (the null arm is the scientific one)', () => {
    const facts = [edgeEditFact(), priorRunFact(OFFSHORE_LEADS)];
    const text = rerunText({ priorFacts: facts, currentEnv: OFFSHORE_LEADS });
    // ⭐ OBSERVATIONAL, NOT A ROBUSTNESS CLAIM. "does not hinge on that change"
    // asserted causal INDEPENDENCE, which C2_unpaired cannot license. "held both
    // before and after" states only what was observed at the two time points.
    expect(text).toBe(
      'Since you adjusted a link in the decision model, the picture has stayed the '
      + 'same: Offshore still leads. That is a result in itself: the conclusion held '
      + 'both before and after that change.',
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

  it('SEVERAL × unchanged agrees with its own plural opener, BYTE-EXACTLY', () => {
    // ⚠ ROUND 1 ASSERTED ONLY THE OPENER PREFIX AND TWO not.toContains, SO THE
    // SECOND SENTENCE WAS NEVER READ — and it shipped "…does not hinge on THAT
    // CHANGE" under a plural opener that deliberately names no antecedent: a
    // dangling referent, and non-dependence asserted about an unidentified
    // single change when several occurred (the mirror of this module's own
    // several ⇒ name-none rule). Binding the WHOLE sentence is the fix.
    const facts = [factorEditFact('Customer churn'), edgeEditFact(), priorRunFact(OFFSHORE_LEADS)];
    const text = rerunText({ priorFacts: facts, currentEnv: OFFSHORE_LEADS });
    expect(text).toBe(
      'Since your recent changes, the picture has stayed the same: Offshore still '
      + 'leads. That is a result in itself: the conclusion held both before and '
      + 'after those changes.',
    );
    expect(text).not.toContain('a link in the decision model');
    expect(text).not.toContain('Customer churn');
  });

  it('UNAVAILABLE margins get their own arm and never the null-arm sentence', () => {
    // A single recommendable option ⇒ `margin` is null (analysis-compact.ts:836
    // needs >= 2) ⇒ `deriveMargin` returns 'unavailable' (compare-runs.ts:272).
    // ⚠ ROUND 1 HAD NO 'unavailable' BRANCH, so this FELL THROUGH to the
    // unchanged arm and asserted a robustness finding about a pair whose margin
    // could not even be computed. The leader identity IS comparable here, so the
    // honest form states that and names the limit — the abstention arm's shape.
    const text = rerunText({
      priorFacts: [edgeEditFact(), priorRunFact(MARGIN_UNAVAILABLE)],
      currentEnv: MARGIN_UNAVAILABLE,
    });
    expect(text).toBe(
      'Since you adjusted a link in the decision model, Offshore still leads after '
      + 'this re-run. I could not compare the size of its lead between the two runs.',
    );
    expect(text).not.toContain('the picture has stayed the same');
    expect(text).not.toContain('held both before and after');
  });

  it('UNATTRIBUTED unavailable margins get the same arm — the half of the fix nothing was pinning', () => {
    // ⚠⚠ TRAP 11, CAUGHT BY REVIEW ON THIS PR'S OWN BONUS FIX. Round 2 claimed
    // to correct the PRE-EXISTING over-claim on the unattributed path (staging's
    // `composeRerunText` has no 'unavailable' handling at all, so a
    // never-compared pair fell through to "The result is unchanged"). But every
    // unavailable case in the suite carried an intervening change, so gating the
    // new branch as `'unavailable' && attributed` — reverting exactly the
    // unattributed half — left the suite 23/23 GREEN. A fix whose tests pass
    // with the defect re-introduced is theatre, and the PR body advertised this
    // half as a deliverable. THIS is the assertion that makes that mutant bite.
    //
    // No intervening change ⇒ no attribution clause, but the arm is unchanged:
    // the margin was still never compared, so "The result is unchanged" would be
    // just as false here as it is on the attributed path.
    const text = rerunText({
      priorFacts: [priorRunFact(MARGIN_UNAVAILABLE)],
      currentEnv: MARGIN_UNAVAILABLE,
    });
    expect(text).toBe(
      'Offshore still leads after this re-run. I could not compare the size of '
      + 'its lead between the two runs.',
    );
    expect(text).not.toContain('The result is unchanged');
    expect(text).not.toContain('Since');
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

  it('NO-HARM: with no intervening change the four COMPARABLE branches are BYTE-IDENTICAL to the pre-attribution copy (the unavailable branch is a deliberate exception)', () => {
    // ⚠ Each case below carries a LICENSED delta that attribution COULD have
    // corrupted — a no-harm case that cannot trigger the transformation
    // asserts nothing (CLAUDE.md trap 13d).
    //
    // ⚠ THE TITLE NAMES ITS EXCEPTION RATHER THAN CLAIMING A UNIVERSAL. Round 2
    // deliberately changed the UNATTRIBUTED `unavailable` sentence too (staging
    // fell through to "The result is unchanged" on a pair whose margin was never
    // compared), so "every branch" became false the moment that arm landed. The
    // exception is pinned byte-exactly by "UNATTRIBUTED unavailable margins get
    // the same arm" above — an exception a test asserts is honest; an exception
    // a title hides is the drift this file keeps guarding against.
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
  // ⭐⭐ BOTH DIRECTIONS. Round 1 policed only POSITIVE connectives — the same
  // asymmetry as the defect it was guarding against (CLAUDE.md trap 13d: an
  // invariant written with the code's asymmetry is a guard agreeing with
  // itself). Asserting the ABSENCE of a causal link needs the same evidence
  // class as asserting its presence, and `C2_unpaired` licenses NEITHER: with
  // the seed unpinned, "no observed movement" cannot be separated from "a real
  // effect cancelled by sampling noise" — a true −18pp effect masked to −0.4pp
  // by an unlucky pair lands in the unchanged arm (`MARGIN_EPSILON_PP = 0.5`,
  // compare-runs.ts:266). The invariant is written against the SPEC — no causal
  // claim in EITHER direction under C2 — not against the failure mode in hand.
  const CAUSAL = [
    // positive
    /\bbecause\b/i, /\bcaused?\b/i, /\bis why\b/i, /\bas a result of\b/i,
    /\bdue to\b/i, /\bled to\b/i, /\bresulted in\b/i, /\btherefore\b/i,
    // negative — causal INDEPENDENCE / robustness claims
    /\bhinges? on\b/i, /\bdepends? on\b/i, /\brel(?:y|ies|ied) on\b/i,
    /\bdriven by\b/i, /\bunaffected by\b/i, /\brobust to\b/i,
    /\bno effect\b/i, /\b(?:in)?sensitive to\b/i, /\bindependent of\b/i,
    /\bmakes? no difference\b/i, /\bnothing to do with\b/i,
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

describe('PR2 L2 — the composed sentence clears the REAL egress guard', () => {
  // ⭐ THIS SUITE EXISTS BECAUSE THE DESIGN'S OWN COPY FAILED IT.
  //
  // `composeRerunText` is a deterministic in-repo producer of leader sentences,
  // and it had NO producer-side egress coverage: the estate's
  // `leader-vocabulary-producer-control.test.ts` drives
  // `composeExplainResultsFallback` / `composeWhatWouldFlipFallback` /
  // `composeComparison` but never this composer. The gap let the design's
  // proposed wording ("the recommendation does not hinge on that value") reach
  // implementation, where `recommendation` is a FORBIDDEN user-facing phrase:
  // the egress guard's terminology rewrite silently replaced it with "the
  // leading option", so the shipped bytes differed from the copy deck AND our
  // own safety pass manufactured the banned leader vocabulary.
  //
  // Asserting on the COMPOSED OUTPUT against the PRODUCTION predicate (not a
  // paraphrase of it) is the only form that catches the next such wording.
  const ALL_ARMS: string[] = (() => {
    const out: string[] = [];
    for (const priorFacts of [
      [edgeEditFact(), priorRunFact(OFFSHORE_LEADS)],
      [factorEditFact('Customer churn'), priorRunFact(OFFSHORE_LEADS)],
      [editGraphFact('CRM adoption'), priorRunFact(OFFSHORE_LEADS)],
      [factorEditFact('Customer churn'), edgeEditFact(), priorRunFact(OFFSHORE_LEADS)],
      [priorRunFact(OFFSHORE_LEADS)], // unattributed arms too
    ]) {
      for (const env of [
        OFFSHORE_LEADS, ONSHORE_LEADS, OFFSHORE_LEADS_WIDER, OFFSHORE_LEADS_NARROWER,
        // ⚠ ADDED ROUND 3. The `unavailable` arm shipped in round 2 and its five
        // compositions (4 attributed + 1 unattributed) were OUTSIDE this pin —
        // in the very suite built so that no composed arm escapes the production
        // guard. A new arm must join the corpus in the same commit that adds it,
        // or the suite's completeness claim quietly stops being true.
        MARGIN_UNAVAILABLE,
      ]) {
        out.push(rerunText({ priorFacts, currentEnv: env }));
      }
    }
    return out;
  })();

  it('no composed arm trips FORBIDDEN_USER_FACING_PHRASES', () => {
    // 5 prior sets × 5 envs. The count is asserted so a corpus that silently
    // stops covering an arm REDs rather than passing over fewer strings.
    expect(ALL_ARMS).toHaveLength(25);
    for (const text of ALL_ARMS) {
      expect({ text, hit: findForbiddenPhraseHit(text) }).toEqual({ text, hit: null });
    }
  });

  it('no composed arm is silently rewritten on its way to the user', () => {
    // A rewrite means the bytes the user reads are not the bytes this file
    // declares. That is the defect class, independent of which phrase caused it.
    for (const text of ALL_ARMS) {
      expect({ text, rewritten: applyTerminologyRewrite(text).text }).toEqual({ text, rewritten: text });
    }
  });

  it('POSITIVE CONTROL: the guard and the rewriter are live on this input class', () => {
    // Without this, both assertions above pass if the predicates silently stop
    // discriminating (CLAUDE.md trap 13 — an absence probe needs a presence).
    // The control is the DESIGN'S OWN REJECTED SENTENCE, so it also pins the
    // reason this suite exists.
    const rejected =
      'Since you adjusted a link in the decision model, the picture is the same: '
      + 'Offshore still leads. That is a result in itself: the recommendation does '
      + 'not hinge on that change.';
    expect(findForbiddenPhraseHit(rejected)).toBe('recommendation');
    const rw = applyTerminologyRewrite(rejected);
    expect(rw.text).not.toBe(rejected);
    expect(rw.text).toContain('the leading option');
  });
});
