/**
 * Run-comparison gate — the SAME-INPUTS pair (turn 7 of the 5 Sep founder
 * journey, CEE 1af54f6c).
 *
 * THE DEFECT. The user asked "How has the update changed the analysis?" after an
 * edit that was never applied. The gate compared the two newest successful runs
 * — both of which predated the edit attempt — and answered "X still leads. The
 * size of its lead is essentially unchanged." Every sentence was true of those
 * two runs; nothing in the reply said the pair could not show the effect of the
 * update the user was asking about.
 *
 * WHAT IS DERIVABLE. Each run fact carries `result.graph_hash_at_run` (the hash
 * of the ANALYSIS-AFFECTING graph fields, `context/freshness.ts`). Under a
 * confirmed-`fresh` verdict, equal hashes on the two compared runs mean the two
 * analyses ran on the same analysis inputs — so this pair cannot attribute any
 * movement, or its absence, to an update.
 *
 * WHAT IS NOT. Equal hashes do NOT establish that a requested change never
 * reached the model: apply A→H, run H twice, and the hashes are equal while the
 * edit succeeded (Codex CCC-DIALOGUE-038). So the reply may only LIMIT
 * ATTRIBUTION — "this pair cannot show the effect of an update" — and must never
 * say "not applied" / "has not reached the model". Pinned below, with a
 * positive control on the pin's own regex.
 *
 * The lead sentence is MESSAGE-INDEPENDENT: the gate does not try to read
 * whether the user presupposed an update. The scoped two-run comparison is kept
 * after it (so an explicit "what changed between the last two runs?" is still
 * answered), and the follow-up offer replaces the compared-mode invitation.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { describe,expect,it } from 'vitest';



import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { selectTwoNewestRunAnalysisFacts } from '../../coaching/compare-runs.js';
import { classifyAnalyticalIntent,hasMutationSignal } from '../analytical-intent.js';

// ── fixtures (self-contained; mirrors run-comparison-gate.test.ts) ──────────

function envelope(
  options: Array<{ id: string; label: string; win: number }>,
  band: string,
): V2RunResponseEnvelope {
  return {
    analysis_status: 'completed',
    results: options.map((o) => ({
      option_id: o.id,
      option_label: o.label,
      win_probability: o.win,
      outcome: { n_samples: 10_000 },
    })),
    robustness_synthesis: { overall_assessment: band },
  } as unknown as V2RunResponseEnvelope;
}

/**
 * `hash` is EXPLICIT on every fixture: the hash pair is the axis under test.
 * `mayName` is the run's OWN persisted verdict (the per-run authority the
 * gate conjoins with the turn's), permitted unless a case says otherwise.
 */
function runFact(
  env: V2RunResponseEnvelope,
  hash: string | null | undefined,
  computedAt: string,
  mayName = true,
): HandlerFact {
  return {
    fact_type: 'run_analysis',
    noop: false,
    result: {
      enrichment: env,
      computed_at: computedAt,
      ...(hash === undefined ? {} : { graph_hash_at_run: hash }),
      constraint_verdict: {
        may_name_leading_option: mayName,
        constraint_verdict_state: mayName ? ('evaluated_feasible' as const) : ('evaluated_infeasible' as const),
      },
    },
  } as unknown as HandlerFact;
}

const T_CURRENT = '2026-09-05T16:53:40.273Z';
const T_PRIOR = '2026-09-05T16:53:23.158Z';

const ENV_A = envelope([{ id: 'a', label: 'Offshore', win: 0.62 }, { id: 'b', label: 'Onshore', win: 0.38 }], 'low');


/** Newest-first, per the loader convention the pair selector relies on. */
function pair(current: HandlerFact, prior: HandlerFact): readonly HandlerFact[] {
  return [current, prior];
}

/** Rows 1/2/4 of the acceptance table: run H; run H (identical results). */

/** Row 3: run A; apply A→H; run H. */
const DISTINCT_IDENTICAL = pair(runFact(ENV_A, 'h-current', T_CURRENT), runFact(ENV_A, 'h-prior', T_PRIOR));
/** Equal hashes, results moved (sampling-variation shape). */



const FOUNDER_MESSAGE = 'How has the update changed the analysis?';

// ── Codex's four minimal histories (BRIEF-BUILD-TURN7, acceptance table) ────
//
// Rows 1, 2 and 4 are ONE gate-visible state: two successful runs on hash H
// under a fresh verdict. What differs between them happened AROUND the runs —
// an edit refused after both, an edit applied before both, or nothing but an
// explicit request to compare two reruns — and none of it is persisted (the V5
// edit path writes no fact when nothing is applied), so the gate cannot tell
// the three apart. One reply has to be true in all three, which is why it may
// only limit attribution and never deny an edit.









// The compared-mode invitation, which the same-inputs offer REPLACES.


/** The scoped two-run comparison, taken from the `compared` twin's text. */


// The design ban (Codex CCC-DIALOGUE-038): no "not applied" / "not reached" class.
const DENIAL_CLASS = /\bnot\s+(?:been\s+)?(?:applied|reached|saved|made|tested)\b|\bnever\s+(?:applied|reached|saved|made|tested)\b|\bhas\s+not\s+(?:changed|reached)\b|\bno\s+(?:update|change|edit)s?\s+(?:was|were)\b/i;

// Row 4's "never invent a failed edit": an edit/update/change noun followed,
// within the sentence, by a failure verb.
const INVENTED_FAILED_EDIT = /\b(?:edit|update|change)s?\b[^.]*\b(?:failed|refused|rejected|blocked)\b/i;

// Copy rules shared with the sibling gate suite.



// ── 1. the RED case: rows 1 and 2 (same hashes, fresh) ──────────────────────

describe('run-comparison: a fresh pair with EQUAL graph hashes (same analysis inputs)', () => {








  it('POSITIVE CONTROL: the denial-class pin sees the banned sentences', () => {
    expect('That update has not reached the model.').toMatch(DENIAL_CLASS);
    expect('The change you asked for was not applied.').toMatch(DENIAL_CLASS);
    expect('No update was applied.').toMatch(DENIAL_CLASS);
  });




});

// ── 1b. Codex's four minimal histories, one case per row ────────────────────

describe("run-comparison: Codex's four minimal histories, one per row", () => {










  it('POSITIVE CONTROL: the invented-failed-edit pin sees an invented failed edit', () => {
    expect('Your edit was refused, so the runs match.').toMatch(INVENTED_FAILED_EDIT);
    expect('The update failed to save.').toMatch(INVENTED_FAILED_EDIT);
  });
});

// ── 2. the egress guards read this copy ─────────────────────────────────────



// ── 3. leader authority still withholds in the new mode (twin) ──────────────



// ── 3b. per-run authority (the MIXED verdicts) in the new mode ──────────────



// ── 4. twins: every other state is byte-identical to today ──────────────────



// ── 5. the pair carries the hashes through the EXISTING reader ──────────────

describe('selectTwoNewestRunAnalysisFacts: the pair exposes each run\'s graph_hash_at_run', () => {
  it('reads the string hashes off the same views the selection is sliced from', () => {
    const p = selectTwoNewestRunAnalysisFacts(DISTINCT_IDENTICAL);
    expect(p).not.toBeNull();
    expect(p!.current_graph_hash_at_run).toBe('h-current');
    expect(p!.prior_graph_hash_at_run).toBe('h-prior');
  });

  it('a missing, null, or EMPTY hash reads as null (an empty string is no hash)', () => {
    const p = selectTwoNewestRunAnalysisFacts(
      pair(runFact(ENV_A, '', T_CURRENT), runFact(ENV_A, undefined, T_PRIOR)),
    );
    expect(p!.current_graph_hash_at_run).toBeNull();
    expect(p!.prior_graph_hash_at_run).toBeNull();
    const q = selectTwoNewestRunAnalysisFacts(pair(runFact(ENV_A, null, T_CURRENT), runFact(ENV_A, 'H', T_PRIOR)));
    expect(q!.current_graph_hash_at_run).toBeNull();
    expect(q!.prior_graph_hash_at_run).toBe('H');
  });
});

// ── 6. the founder's verbatim sentence reaches this gate ────────────────────

describe('the turn-7 message reaches the gate (positive control on the route in)', () => {
  it('"How has the update changed the analysis?" carries no mutation signal and classifies what_changed', () => {
    expect(hasMutationSignal(FOUNDER_MESSAGE)).toBe(false);
    expect(classifyAnalyticalIntent(FOUNDER_MESSAGE)).toBe('what_changed');
  });


});
