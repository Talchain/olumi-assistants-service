/**
 * ⭐⭐ THE GOAL-TARGET ANSWER, RESOLVED INTO THE TUPLE THE CANONICAL WRITER TAKES.
 *
 * Built on the sibling the independent review named: `elicit_target_baseline`
 * (`turn-executor.ts:5948-6045`) is the existing numeric-answer route — typed
 * chip first, then this, then generic factor parsing — with pending
 * parse/liveness/hash and the SAME `add_constraint` lifecycle. This is its
 * target-side twin, kept separate on purpose.
 *
 * ⛔ TWO CORRECTIONS I OWE, BOTH FROM THE REVIEW AND BOTH KEPT HERE:
 *   · my pending-kind census stopped at line 400 of `pending-action.ts` and
 *     missed `clarify_v2_round`, `elicit_target_baseline`,
 *     `elicit_option_effect`, `elicit_effect_target`, `elicit_edit_target` and
 *     `proposed_concept`. A truncated enumeration is not an enumeration, and it
 *     is the second time I have made that exact error;
 *   · `readiness-summary.ts:30` deliberately QUARANTINES
 *     `goal_threshold_missing` and preserves ready-without-threshold. Nothing
 *     here revives it: offering a clarification is not changing admission, and
 *     a targetless draft stays analysable.
 *
 * The percent classifier is deliberately NOT reused — baseline answers are
 * percents, a goal target is in the person's own units (£20k, 5,000 signups,
 * 92%) — so this uses the shared CQE extractor the deterministic value-update
 * route already uses. No second parser, and no writer: the resolved tuple is
 * replayed through the canonical `add_constraint` lifecycle.
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, expect, it } from 'vitest';

import { tryGoalTargetElicitationResume } from '../clarification-resume.js';

const NOW = Date.parse('2026-09-09T08:00:00.000Z');
const GRAPH_HASH = 'hash-goal-answer';
const NODES = [
  { id: 'g-revenue', label: 'Reach £20k MRR within 12 months' },
  { id: 'f-churn', label: 'Pro Plan Churn Rate' },
];

function pending(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pa-goal-1',
    action: {
      kind: 'elicit_goal_target',
      goal_node_id: 'g-revenue',
      question: 'What value counts as success for this goal?',
      ...(overrides.action as Record<string, unknown> | undefined),
    },
    expires_at_turn_count: 3,
    expires_at_iso: new Date(NOW + 600_000).toISOString(),
    preconditions: { graph_hash: GRAPH_HASH },
    ...overrides,
  };
}

function resume(message: string, pendings: readonly unknown[], hash: string | undefined = GRAPH_HASH) {
  return tryGoalTargetElicitationResume({
    message,
    pendingActions: pendings as never,
    nowMs: NOW,
    ...(hash === undefined ? {} : { currentGraphHash: hash }),
    graphNodes: NODES,
  });
}

describe('a goal-target answer resolves to the writer tuple, and nothing else does', () => {
  it('⭐ POSITIVE — "£20k" answers the question and yields goal, value and unit', () => {
    const result = resume('£20k', [pending()]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.goalNodeId).toBe('g-revenue');
    expect(result.value).toBe(20000);
    expect(result.unit).toBe('£');
  });

  it('a bare number answers it too, taking the unit the question established', () => {
    const result = resume('20000', [pending({ action: { unit: '£' } })]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.value).toBe(20000);
    expect(result.unit).toBe('£');
  });

  it('⭐ CEILING — "keep it under 4%" is refused, never stamped as a success minimum', () => {
    // A goal minimum is not a churn maximum. ISL computes P(samples >= t), so
    // recording a ceiling as a >= target would invert the person's meaning.
    const result = resume('keep it under 4%', [pending()]);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('unreadable_answer');
  });

  it('⭐ CURRENT LEVEL — "our current MRR is £12,000" is a report, not a target', () => {
    // One finite non-ceiling currency amount, naming no other node's label.
    // Only POSITIVE eligibility withdraws it: the message is not the amount
    // alone, and it uses no target language.
    const result = resume('Our current MRR is £12,000.', [pending()]);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    if (result.skip_reason !== 'unreadable_answer') {
      throw new Error(`expected unreadable_answer, got ${result.skip_reason}`);
    }
    expect(result.reason).toBe('not_a_target_answer');
  });

  it('⭐ BASELINE REPORT — "our baseline MRR is £12,000" carries no marker and is still refused', () => {
    // The independent review's counterexample against the NEGATIVE list this
    // gate replaced. It carries no present-state marker at all, which is
    // exactly why a marker list could never have caught it: absence of a
    // refusal signal was never evidence of a target answer.
    const result = resume('Our baseline MRR is £12,000.', [pending()]);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    if (result.skip_reason !== 'unreadable_answer') {
      throw new Error(`expected unreadable_answer, got ${result.skip_reason}`);
    }
    expect(result.reason).toBe('not_a_target_answer');
  });

  it('CONTRAST — a STATED TARGET of the same sentence shape still binds', () => {
    // The half that proves the gate discriminates ROLE rather than sentence
    // length or the presence of a copula: same "<subject> is <amount>" shape,
    // target language present.
    const result = resume('The target is £20,000.', [pending()]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.value).toBe(20000);
    expect(result.unit).toBe('£');
  });

  it('CONTRAST — an intent sentence with no target NOUN still binds', () => {
    const result = resume('We need to hit £20,000 by year end.', [pending()]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.value).toBe(20000);
  });

  it("CONTRAST — CQE's own floor reading is enough, with no target vocabulary at all", () => {
    // "at least" names a FLOOR, which is what `goal_threshold` is. It is
    // reachable by BOTH prose routes (CQE's own `comparator: 'at_least'` and
    // the phrase list), so this case is deliberately over-determined: it pins
    // the behaviour without asserting which route carried it.
    const result = resume('at least £20,000 a month', [pending()]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.value).toBe(20000);
  });

  it('⭐ A BARE VERB IS NOT INTENT — "we get £12,000 a month" is a report', () => {
    // Self-caught while writing the vocabulary: `get` was briefly a member, and
    // it makes this present-tense report eligible. The phrase `get to` is an
    // intent; the bare verb is not. Two words apart, opposite roles — which is
    // why the vocabulary carries the phrase and not the verb, and why
    // `benchmark` is absent too (an industry benchmark is someone else's
    // number, not this team's criterion).
    const result = resume('We get £12,000 a month.', [pending()]);
    expect(result.matched).toBe(false);
  });

  it('CONTRAST — "get to £20,000" IS intent and binds', () => {
    const result = resume('We want to get to £20,000.', [pending()]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.value).toBe(20000);
  });

  it('HEDGED BARE ANSWER — "about £20k" is still just the amount', () => {
    // `about` is answer furniture, from `ANSWER_HEDGE_WORDS` (derived from
    // stated-level's closed qualifier list minus its tense members).
    const result = resume('about £20k', [pending()]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.value).toBe(20000);
  });

  it('⭐ OTHER SUBJECT — a price named on another node is not the goal target', () => {
    // The reply carries exactly one amount and is plainly about something else.
    // `f-churn` is labelled 'Pro Plan Churn Rate'; naming it withdraws the
    // bind. The bound is deliberate and stated at the gate: this refuses
    // answers that NAME ANOTHER NODE, it does not try to decide aboutness from
    // prose alone.
    const result = resume('Pro Plan Churn Rate is 4 percent', [pending()]);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    // Narrowed by the discriminant before reading `reason`: only the
    // `unreadable_answer` arm carries one, so a bare `expect` would not
    // typecheck (and would read a field the other arms do not have).
    if (result.skip_reason !== 'unreadable_answer') {
      throw new Error(`expected unreadable_answer, got ${result.skip_reason}`);
    }
    expect(result.reason).toBe('names_other_subject');
  });

  it('CONTRAST — the same claim naming NO other node binds when it names a target', () => {
    // Without this the subject gate above could be refusing on the sentence's
    // length or its verb rather than on the node it names. Target language is
    // present in both, so the ONLY difference is the named subject.
    const result = resume('Our target is 20000', [pending({ action: { unit: '£' } })]);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.value).toBe(20000);
  });

  it('SEVERAL AMOUNTS — the product asks again rather than choosing one', () => {
    const result = resume('somewhere between £20k and £30k', [pending()]);
    expect(result.matched).toBe(false);
  });

  it('NO PENDING — an ordinary quantity turn is untouched', () => {
    // The route is additive: with no live question, every existing lane keeps
    // its behaviour, so a price or an unrelated factor answer is unaffected.
    const result = resume('£59', []);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('no_pending_question');
  });

  it('COMPETING QUESTION — a second number-asking pending blocks the bare answer', () => {
    // Reuses `PENDING_KIND_CLAIMS_BARE_NUMBER`: liveness, then claimants, then
    // identity. A competing ask must not be counted out of existence.
    const competitor = {
      id: 'pa-baseline',
      action: { kind: 'elicit_target_baseline', target_id: 'f-churn' },
      expires_at_turn_count: 3,
      expires_at_iso: new Date(NOW + 600_000).toISOString(),
    };
    const result = resume('20000', [pending(), competitor]);
    expect(result.matched).toBe(false);
  });

  it('GRAPH DIVERGED — a moved model refuses rather than applying a stale answer', () => {
    const result = resume('£20k', [pending()], 'a-different-hash');
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('graph_diverged');
  });

  it('TARGET MISSING — the goal is gone, so nothing is resolved', () => {
    const result = resume('£20k', [pending({ action: { goal_node_id: 'g-deleted' } })]);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('target_missing');
  });
});
