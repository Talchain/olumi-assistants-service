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

import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import * as gate from '../run-comparison-gate.js';
import {
  tryRunComparisonGate,
  WITHHELD_CURRENT_LEADER_COMPARISON_TEXT,
  WITHHELD_NOTHING_ELSE_CHANGED_TEXT,
  WITHHELD_PRIOR_LEADER_COMPARISON_TEXT,
} from '../run-comparison-gate.js';
import { classifyAnalyticalIntent, hasMutationSignal } from '../analytical-intent.js';
import { selectTwoNewestRunAnalysisFacts } from '../../coaching/compare-runs.js';
import { findLeaderClaims } from '../../compose/leading-option-egress-guard.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';

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
const ENV_B = envelope([{ id: 'b', label: 'Onshore', win: 0.55 }, { id: 'a', label: 'Offshore', win: 0.45 }], 'high');

/** Newest-first, per the loader convention the pair selector relies on. */
function pair(current: HandlerFact, prior: HandlerFact): readonly HandlerFact[] {
  return [current, prior];
}

/** Rows 1/2/4 of the acceptance table: run H; run H (identical results). */
const SAME_INPUTS_IDENTICAL = pair(runFact(ENV_A, 'H', T_CURRENT), runFact(ENV_A, 'H', T_PRIOR));
/** Row 3: run A; apply A→H; run H. */
const DISTINCT_IDENTICAL = pair(runFact(ENV_A, 'h-current', T_CURRENT), runFact(ENV_A, 'h-prior', T_PRIOR));
/** Equal hashes, results moved (sampling-variation shape). */
const SAME_INPUTS_CHANGED = pair(runFact(ENV_B, 'H', T_CURRENT), runFact(ENV_A, 'H', T_PRIOR));
const DISTINCT_CHANGED = pair(runFact(ENV_B, 'h-current', T_CURRENT), runFact(ENV_A, 'h-prior', T_PRIOR));

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
const ROW1_REFUSED_EDIT_AFTER_TWO_RUNS = SAME_INPUTS_IDENTICAL;
const ROW2_EDIT_APPLIED_BEFORE_BOTH_RUNS = SAME_INPUTS_IDENTICAL;
const ROW3_EDIT_APPLIED_BETWEEN_RUNS = DISTINCT_IDENTICAL;
const ROW4_EXPLICIT_TWO_RERUN_COMPARISON = SAME_INPUTS_IDENTICAL;

const ask = (
  priorFacts: readonly HandlerFact[],
  message = FOUNDER_MESSAGE,
  mayNameLeadingOption = true,
  freshness: gate.RunComparisonFreshness = 'fresh',
) => tryRunComparisonGate({ message, priorFacts, freshness, mayNameLeadingOption });

function textOf(out: ReturnType<typeof tryRunComparisonGate>): string {
  expect(out.matched).toBe(true);
  if (!out.matched) throw new Error('unreachable: gate declined');
  return out.assistant_text;
}

// The compared-mode invitation, which the same-inputs offer REPLACES.
const COMPARED_FOLLOW_UP = 'If you want to test this further, ask what would change the result.';

/** The scoped two-run comparison, taken from the `compared` twin's text. */
function comparedBody(priorFacts: readonly HandlerFact[]): string {
  const out = ask(priorFacts);
  expect(out.matched && out.mode).toBe('compared');
  const text = textOf(out);
  expect(text.endsWith(' ' + COMPARED_FOLLOW_UP)).toBe(true);
  return text.slice(0, -(COMPARED_FOLLOW_UP.length + 1));
}

// The design ban (Codex CCC-DIALOGUE-038): no "not applied" / "not reached" class.
const DENIAL_CLASS = /\bnot\s+(?:been\s+)?(?:applied|reached|saved|made|tested)\b|\bnever\s+(?:applied|reached|saved|made|tested)\b|\bhas\s+not\s+(?:changed|reached)\b|\bno\s+(?:update|change|edit)s?\s+(?:was|were)\b/i;

// Row 4's "never invent a failed edit": an edit/update/change noun followed,
// within the sentence, by a failure verb.
const INVENTED_FAILED_EDIT = /\b(?:edit|update|change)s?\b[^.]*\b(?:failed|refused|rejected|blocked)\b/i;

// Copy rules shared with the sibling gate suite.
const FORBIDDEN = /\b(node|edge|graph|winner|sensitivity|robustness|_meta|option_id|node_id)\b/i;
const RAW_DECIMAL = /\d\.\d/;

// ── 1. the RED case: rows 1 and 2 (same hashes, fresh) ──────────────────────

describe('run-comparison: a fresh pair with EQUAL graph hashes (same analysis inputs)', () => {
  it('answers in the new `same_inputs` mode', () => {
    const out = ask(SAME_INPUTS_IDENTICAL);
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.mode).toBe('same_inputs');
    // No chip: re-running the same inputs produces the same pair again.
    expect(out.suggested_actions).toHaveLength(0);
  });

  it('LEADS with the attribution limit, then the scoped comparison, then the offer', () => {
    const text = textOf(ask(SAME_INPUTS_IDENTICAL));
    expect(text.startsWith(gate.SAME_INPUTS_LEAD_TEXT + ' ')).toBe(true);
    expect(text.endsWith(' ' + gate.SAME_INPUTS_OFFER_TEXT)).toBe(true);
    // The scoped comparison is byte-identical to the `compared` twin's body.
    expect(text).toBe(
      `${gate.SAME_INPUTS_LEAD_TEXT} ${comparedBody(DISTINCT_IDENTICAL)} ${gate.SAME_INPUTS_OFFER_TEXT}`,
    );
    // …and that body is the scoped "still leads" answer row 4 requires.
    expect(text).toContain('Offshore still leads.');
    // The compared-mode invitation is replaced, not appended.
    expect(text).not.toContain(COMPARED_FOLLOW_UP);
  });

  it('the same shape when the results MOVED between the two same-input runs', () => {
    const out = ask(SAME_INPUTS_CHANGED);
    expect(out.matched && out.mode).toBe('same_inputs');
    expect(textOf(out)).toBe(
      `${gate.SAME_INPUTS_LEAD_TEXT} ${comparedBody(DISTINCT_CHANGED)} ${gate.SAME_INPUTS_OFFER_TEXT}`,
    );
  });

  it('never denies an applied edit (row 2): no "not applied" / "not reached" class anywhere', () => {
    const text = textOf(ask(SAME_INPUTS_IDENTICAL));
    expect(text).not.toMatch(DENIAL_CLASS);
    expect(gate.SAME_INPUTS_LEAD_TEXT).not.toMatch(DENIAL_CLASS);
    expect(gate.SAME_INPUTS_OFFER_TEXT).not.toMatch(DENIAL_CLASS);
  });

  it('POSITIVE CONTROL: the denial-class pin sees the banned sentences', () => {
    expect('That update has not reached the model.').toMatch(DENIAL_CLASS);
    expect('The change you asked for was not applied.').toMatch(DENIAL_CLASS);
    expect('No update was applied.').toMatch(DENIAL_CLASS);
  });

  it('is MESSAGE-INDEPENDENT: the founder sentence, bare "what changed?" and an explicit two-run comparison get the same bytes', () => {
    const founder = ask(SAME_INPUTS_IDENTICAL, FOUNDER_MESSAGE);
    const bare = ask(SAME_INPUTS_IDENTICAL, 'What changed?');
    const explicit = ask(SAME_INPUTS_IDENTICAL, 'What changed between the last two runs?');
    expect(founder.matched && founder.mode).toBe('same_inputs');
    expect(bare).toEqual(founder);
    expect(explicit).toEqual(founder);
  });

  it('forwards the factual delta to telemetry exactly as `compared` does', () => {
    const out = ask(SAME_INPUTS_IDENTICAL);
    expect(out.matched).toBe(true);
    if (!out.matched) return;
    expect(out.leading_option_changed).toBe(false);
    expect(out.leader_identity_basis).toBe('option_id');
  });
});

// ── 1b. Codex's four minimal histories, one case per row ────────────────────

describe("run-comparison: Codex's four minimal histories, one per row", () => {
  it("the lead and the offer are the brief's bytes (interim response shape, CCC-DIALOGUE-038)", () => {
    expect(gate.SAME_INPUTS_LEAD_TEXT).toBe(
      "These two analyses used the same analytical inputs. I can't use this pair to show the effect of an update to the model.",
    );
    expect(gate.SAME_INPUTS_OFFER_TEXT).toBe(
      'If you were expecting an update to show here, check that it was saved to the model. '
      + 'To show what an update changed, I need one analysis from before it and one from after it.',
    );
  });

  it('row 1 — run H; run H; a requested edit REFUSED: the attribution limit comes before any "still leads", and the next step closes it', () => {
    const out = ask(ROW1_REFUSED_EDIT_AFTER_TWO_RUNS, FOUNDER_MESSAGE);
    expect(out.matched && out.mode).toBe('same_inputs');
    const text = textOf(out);
    expect(text.startsWith(gate.SAME_INPUTS_LEAD_TEXT + ' ')).toBe(true);
    expect(text.indexOf(gate.SAME_INPUTS_LEAD_TEXT)).toBeLessThan(text.indexOf('still leads'));
    expect(text.endsWith(' ' + gate.SAME_INPUTS_OFFER_TEXT)).toBe(true);
    // The next step is the offer, not a re-run chip.
    expect(out.matched && out.suggested_actions).toHaveLength(0);
  });

  it('row 2 — apply A→H; run H; run H: the SAME reply as row 1, and it denies nothing', () => {
    const row1 = ask(ROW1_REFUSED_EDIT_AFTER_TWO_RUNS, FOUNDER_MESSAGE);
    const row2 = ask(ROW2_EDIT_APPLIED_BEFORE_BOTH_RUNS, FOUNDER_MESSAGE);
    expect(row2).toEqual(row1);
    expect(textOf(row2)).not.toMatch(DENIAL_CLASS);
  });

  it("row 3 — run A; apply A→H; run H: today's `compared` answer, byte-identical", () => {
    const out = ask(ROW3_EDIT_APPLIED_BETWEEN_RUNS, FOUNDER_MESSAGE);
    expect(out.matched && out.mode).toBe('compared');
    expect(textOf(out)).toBe(
      `Offshore still leads. The size of its lead is essentially unchanged. ${COMPARED_FOLLOW_UP}`,
    );
  });

  it('row 4 — an explicit comparison of two unchanged-model reruns: the scoped comparison is given, and no failed edit is invented', () => {
    const out = ask(ROW4_EXPLICIT_TWO_RERUN_COMPARISON, 'What changed between the last two runs?');
    expect(out.matched && out.mode).toBe('same_inputs');
    const text = textOf(out);
    expect(text).toContain('Offshore still leads.');
    expect(text).not.toMatch(DENIAL_CLASS);
    expect(text).not.toMatch(INVENTED_FAILED_EDIT);
  });

  it('POSITIVE CONTROL: the invented-failed-edit pin sees an invented failed edit', () => {
    expect('Your edit was refused, so the runs match.').toMatch(INVENTED_FAILED_EDIT);
    expect('The update failed to save.').toMatch(INVENTED_FAILED_EDIT);
  });
});

// ── 2. the egress guards read this copy ─────────────────────────────────────

describe('run-comparison: same-inputs copy vs the egress guards', () => {
  it('the full emitted answer trips neither the denial-phrase guard nor the success-claim guard', () => {
    for (const facts of [SAME_INPUTS_IDENTICAL, SAME_INPUTS_CHANGED]) {
      for (const mayName of [true, false]) {
        const text = textOf(ask(facts, FOUNDER_MESSAGE, mayName));
        expect(findForbiddenPhraseHit(text), text).toBeNull();
        expect(findSuccessClaimHit(text), text).toBeNull();
        expect(text).not.toMatch(FORBIDDEN);
        expect(text).not.toMatch(RAW_DECIMAL);
      }
    }
  });

  it('POSITIVE CONTROL: both guards DO see a banned sentence joined to this copy', () => {
    // Without these, the two null assertions above would pass identically
    // against a guard that cannot read a string of this shape.
    expect(findForbiddenPhraseHit(`Nothing changed. ${gate.SAME_INPUTS_LEAD_TEXT}`)).toBe('Nothing changed');
    expect(findForbiddenPhraseHit(`${gate.SAME_INPUTS_LEAD_TEXT} No changes were applied.`)).toBe('No changes were applied');
    expect(findSuccessClaimHit(`I have applied the update. ${gate.SAME_INPUTS_OFFER_TEXT}`)).toBe('I have applied');
  });

  it('the two new constants are invisible to the leader alarm (they ship on withheld turns too)', () => {
    expect(findLeaderClaims({ assistant_text: gate.SAME_INPUTS_LEAD_TEXT } as never)).toHaveLength(0);
    expect(findLeaderClaims({ assistant_text: gate.SAME_INPUTS_OFFER_TEXT } as never)).toHaveLength(0);
  });
});

// ── 3. leader authority still withholds in the new mode (twin) ──────────────

describe('run-comparison: same-inputs mode under a WITHHELD verdict', () => {
  it('withholds both leaders and says so, inside the same lead/offer frame', () => {
    const out = ask(SAME_INPUTS_IDENTICAL, FOUNDER_MESSAGE, false);
    expect(out.matched && out.mode).toBe('same_inputs');
    const text = textOf(out);
    expect(text).toBe(
      `${gate.SAME_INPUTS_LEAD_TEXT} ${WITHHELD_NOTHING_ELSE_CHANGED_TEXT} ${gate.SAME_INPUTS_OFFER_TEXT}`,
    );
    expect(text).not.toContain('Offshore');
    expect(text).not.toContain('Onshore');
    expect(findLeaderClaims({ assistant_text: text } as never)).toHaveLength(0);
    // The denial-class ban holds on THIS arm's bytes too. The withheld text is
    // composed from its own constant, which the permitted-arm pins in section 1
    // never read — so a denial injected there would otherwise ship unseen
    // (#1364 review, F1: proven by injecting "That update has not reached the
    // model." into WITHHELD_NOTHING_ELSE_CHANGED_TEXT — 33/33 green without this).
    expect(text).not.toMatch(DENIAL_CLASS);
    expect(WITHHELD_NOTHING_ELSE_CHANGED_TEXT).not.toMatch(DENIAL_CLASS);
  });

  it('POSITIVE CONTROL: the permitted arm IS visible to the alarm', () => {
    const text = textOf(ask(SAME_INPUTS_IDENTICAL, FOUNDER_MESSAGE, true));
    expect(findLeaderClaims({ assistant_text: text } as never).length).toBeGreaterThan(0);
  });

  it('POSITIVE CONTROL: the denial-class pin sees a denial spliced into the withheld frame', () => {
    expect(
      `${gate.SAME_INPUTS_LEAD_TEXT} ${WITHHELD_NOTHING_ELSE_CHANGED_TEXT} That update has not reached the model. ${gate.SAME_INPUTS_OFFER_TEXT}`,
    ).toMatch(DENIAL_CLASS);
  });
});

// ── 3b. per-run authority (the MIXED verdicts) in the new mode ──────────────

describe('run-comparison: same-inputs mode under MIXED per-run verdicts', () => {
  // Equal hashes; one run's OWN persisted verdict withholds, the other's
  // permits. The distinct-hash twins give the `compared` bytes to compare with.
  const PRIOR_WITHHELD = pair(runFact(ENV_B, 'H', T_CURRENT, true), runFact(ENV_A, 'H', T_PRIOR, false));
  const PRIOR_WITHHELD_DISTINCT = pair(runFact(ENV_B, 'h-current', T_CURRENT, true), runFact(ENV_A, 'h-prior', T_PRIOR, false));
  const CURRENT_WITHHELD = pair(runFact(ENV_B, 'H', T_CURRENT, false), runFact(ENV_A, 'H', T_PRIOR, true));
  const CURRENT_WITHHELD_DISTINCT = pair(runFact(ENV_B, 'h-current', T_CURRENT, false), runFact(ENV_A, 'h-prior', T_PRIOR, true));

  it('PRECONDITION: the two mixed fixtures reach the mixed branches (the both-permitted twin names a leader change; they do not)', () => {
    expect(textOf(ask(SAME_INPUTS_CHANGED))).toContain('The option most likely to serve your goal has changed.');
    expect(textOf(ask(PRIOR_WITHHELD))).not.toContain('The option most likely to serve your goal has changed.');
    expect(textOf(ask(CURRENT_WITHHELD))).not.toContain('The option most likely to serve your goal has changed.');
  });

  it('prior withheld / current permitted: the withheld run stays withheld inside the same-inputs frame', () => {
    const out = ask(PRIOR_WITHHELD);
    expect(out.matched && out.mode).toBe('same_inputs');
    const text = textOf(out);
    expect(text).toBe(
      `${gate.SAME_INPUTS_LEAD_TEXT} ${comparedBody(PRIOR_WITHHELD_DISTINCT)} ${gate.SAME_INPUTS_OFFER_TEXT}`,
    );
    expect(text).toContain('Onshore scored highest on the latest result.');
    expect(text).toContain(WITHHELD_PRIOR_LEADER_COMPARISON_TEXT);
    expect(text).not.toContain('Offshore');
    // Denial-class ban on the mixed arm's bytes (see section 3).
    expect(text).not.toMatch(DENIAL_CLASS);
    expect(WITHHELD_PRIOR_LEADER_COMPARISON_TEXT).not.toMatch(DENIAL_CLASS);
  });

  it('current withheld / prior permitted (the mirror): likewise', () => {
    const out = ask(CURRENT_WITHHELD);
    expect(out.matched && out.mode).toBe('same_inputs');
    const text = textOf(out);
    expect(text).toBe(
      `${gate.SAME_INPUTS_LEAD_TEXT} ${comparedBody(CURRENT_WITHHELD_DISTINCT)} ${gate.SAME_INPUTS_OFFER_TEXT}`,
    );
    expect(text).toContain('Offshore scored highest in the earlier run.');
    expect(text).toContain(WITHHELD_CURRENT_LEADER_COMPARISON_TEXT);
    expect(text).not.toContain('Onshore');
    // Denial-class ban on the mirror arm's bytes (see section 3).
    expect(text).not.toMatch(DENIAL_CLASS);
    expect(WITHHELD_CURRENT_LEADER_COMPARISON_TEXT).not.toMatch(DENIAL_CLASS);
  });

  it('POSITIVE CONTROL: the denial-class pin sees a denial spliced into a mixed frame', () => {
    expect(
      `${gate.SAME_INPUTS_LEAD_TEXT} Onshore scored highest on the latest result. ${WITHHELD_PRIOR_LEADER_COMPARISON_TEXT} That update has not reached the model. ${gate.SAME_INPUTS_OFFER_TEXT}`,
    ).toMatch(DENIAL_CLASS);
  });
});

// ── 4. twins: every other state is byte-identical to today ──────────────────

describe('run-comparison: same-inputs is reached ONLY on two non-empty equal hashes under fresh', () => {
  it('row 3 — DISTINCT hashes stay `compared` with the compared-mode invitation', () => {
    const out = ask(DISTINCT_IDENTICAL);
    expect(out.matched && out.mode).toBe('compared');
    const text = textOf(out);
    expect(text).toBe(`Offshore still leads. The size of its lead is essentially unchanged. ${COMPARED_FOLLOW_UP}`);
    expect(text).not.toContain(gate.SAME_INPUTS_LEAD_TEXT);
  });

  it.each([
    ['both hashes null', pair(runFact(ENV_A, null, T_CURRENT), runFact(ENV_A, null, T_PRIOR))],
    ['both hashes absent', pair(runFact(ENV_A, undefined, T_CURRENT), runFact(ENV_A, undefined, T_PRIOR))],
    ['prior hash null (legacy prior)', pair(runFact(ENV_A, 'H', T_CURRENT), runFact(ENV_A, null, T_PRIOR))],
    ['current hash null', pair(runFact(ENV_A, null, T_CURRENT), runFact(ENV_A, 'H', T_PRIOR))],
    ['both hashes EMPTY strings', pair(runFact(ENV_A, '', T_CURRENT), runFact(ENV_A, '', T_PRIOR))],
  ])('row 5 — %s: `compared`, byte-identical to the distinct-hash twin', (_name, facts) => {
    const out = ask(facts);
    expect(out.matched && out.mode).toBe('compared');
    expect(textOf(out)).toBe(textOf(ask(DISTINCT_IDENTICAL)));
  });

  it('row 5 — stale / unknown / absent authority on an equal-hash pair hold exactly as today', () => {
    for (const freshness of ['stale', 'unknown', null, undefined] as const) {
      // Called directly: `ask`'s default parameter would turn `undefined`
      // into 'fresh', which is the opposite of the absent-authority case.
      const out = tryRunComparisonGate({
        message: FOUNDER_MESSAGE,
        priorFacts: SAME_INPUTS_IDENTICAL,
        freshness,
        mayNameLeadingOption: true,
      });
      expect(out.matched).toBe(true);
      if (!out.matched) continue;
      expect(out.mode).toBe(freshness === 'stale' ? 'stale' : 'unconfirmed');
      expect(out.assistant_text).not.toContain(gate.SAME_INPUTS_LEAD_TEXT);
      expect(out.suggested_actions[0]?.id).toBe('chip_action_rerun_analysis');
    }
  });

  it('row 5 — none / one run / incomparable are untouched', () => {
    const none = ask(SAME_INPUTS_IDENTICAL, FOUNDER_MESSAGE, true, 'none');
    expect(none.matched).toBe(false);
    expect(!none.matched && none.reason).toBe('no_runs');

    const one = ask([SAME_INPUTS_IDENTICAL[0]!]);
    expect(one.matched && one.mode).toBe('insufficient_runs');

    // Two same-hash runs whose enrichment cannot be projected: incomparable
    // precedes the hash check, so the equal hashes never reach it.
    const broken = pair(
      runFact({ analysis_status: 'completed', results: [] } as unknown as V2RunResponseEnvelope, 'H', T_CURRENT),
      runFact({ analysis_status: 'completed', results: [] } as unknown as V2RunResponseEnvelope, 'H', T_PRIOR),
    );
    const incomparable = ask(broken);
    expect(incomparable.matched && incomparable.mode).toBe('incomparable');
  });
});

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

  it('…and is admitted by the gate on the free-text door AND the typed door', () => {
    const free = ask(DISTINCT_CHANGED, FOUNDER_MESSAGE);
    expect(free.matched && free.mode).toBe('compared');
    const typed = tryRunComparisonGate({
      message: FOUNDER_MESSAGE,
      priorFacts: SAME_INPUTS_IDENTICAL,
      freshness: 'fresh',
      mayNameLeadingOption: true,
      forceIntent: true,
    });
    expect(typed.matched && typed.mode).toBe('same_inputs');
  });
});
