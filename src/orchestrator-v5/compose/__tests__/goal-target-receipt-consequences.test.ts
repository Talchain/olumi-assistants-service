/**
 * ⭐ A VERDICT THAT STATES WHAT HONOURING IT REQUIRES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS GUARDS IS A MIGRATION, NOT A BUG.
 *
 * Swapping the text on an unbacked registration claim is the obvious half. The
 * subtle half is that a `swap` must ALSO withhold the graph write and the
 * `applied` receipt fact — committing an `applied / noop:false` fact while the
 * write is withheld grounds the NEXT turn's model on a phantom edit, because
 * `recent_changes` / `prior_facts` readers have no persisted graph to
 * cross-check it against and take it at face value (DL-7).
 *
 * That requirement lived ONLY as two assignments inside a 17,000-line
 * controller (`graphForCommit = undefined`, `handlerFactsForCommit = []`). A
 * consumer holding the verdict alone — a new controller, a different
 * architecture — would swap the text, look correct, and silently reintroduce
 * the phantom receipt.
 *
 * These tests pin the consequences AS PART OF THE CONTRACT, so that a consumer
 * can honour it without reading the controller.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import {
  decideGoalTargetReceipt,
  type GoalTargetReceiptDecision,
} from '../goal-target-receipt-guard.js';

// ⛔ FIXTURES TAKEN FROM THE EXISTING SUITE, NOT INVENTED. My first pass used
// `goal_threshold: 0.8` and a hand-written claim sentence; both were wrong and
// the tests said so. The registering field is `goal_threshold_raw` —
// `goal-target-receipt-guard.test.ts:82` pins `goal_threshold` as explicitly
// NOT registering — and the claim text is a LIVE CAPTURE, because the predicate
// is over natural language and a sentence I compose only confirms my own model
// of it (trap 22).
const BACKED = {
  nodes: [{ id: 'g', kind: 'goal', label: 'G', goal_threshold_raw: 15 }],
};
const UNBACKED = {
  nodes: [{ id: 'g', kind: 'goal', label: 'G' }],
};
/** The captured live false receipt from `goal-target-receipt-guard.test.ts:27`. */
const CLAIM =
  'Success target of 15% cost reduction set on the Reduce Operating Costs ' +
  'goal. Rerun the simulation to evaluate which options meet this threshold.';
const NO_CLAIM = 'The analysis is ready to run.';

function decide(text: string, commit: unknown, persisted: unknown): GoalTargetReceiptDecision {
  return decideGoalTargetReceipt({
    assistantText: text,
    commitGraph: commit,
    persistedGraph: persisted,
  });
}

describe('every decision carries its consequences', () => {
  // ⛔ The contract is only honourable if it is ALWAYS present. A consumer that
  // has to check for undefined will, eventually, forget to.
  it.each([
    ['no claim', NO_CLAIM, null, null],
    ['backed by the commit graph', CLAIM, BACKED, null],
    ['backed by the persisted graph', CLAIM, null, BACKED],
    ['unbacked, graph written', CLAIM, UNBACKED, null],
    ['unbacked, no graph written', CLAIM, null, UNBACKED],
  ])('%s → consequences present', (_n, text, commit, persisted) => {
    const d = decide(text, commit, persisted);
    expect(d.consequences).toBeDefined();
    expect(typeof d.consequences.withholdGraphWrite).toBe('boolean');
    expect(typeof d.consequences.withholdReceiptFacts).toBe('boolean');
  });
});

describe('a swap withholds BOTH the write and the receipt', () => {
  // They travel together deliberately: withholding the write while committing
  // the receipt is the phantom-edit defect; withholding the receipt while
  // committing the write leaves a real edit with no record of it.
  it.each([
    ['graph written this turn', UNBACKED, null],
    ['no graph written this turn', null, UNBACKED],
  ])('%s → swap, both withheld', (_n, commit, persisted) => {
    const d = decide(CLAIM, commit, persisted);
    expect(d.verdict).toBe('swap');
    expect(d.reason).toBe('unbacked_claim');
    expect(d.consequences.withholdGraphWrite).toBe(true);
    expect(d.consequences.withholdReceiptFacts).toBe(true);
  });

  it('the two are never split — no swap withholds only one', () => {
    for (const [commit, persisted] of [[UNBACKED, null], [null, UNBACKED]] as const) {
      const c = decide(CLAIM, commit, persisted).consequences;
      expect(c.withholdGraphWrite).toBe(c.withholdReceiptFacts);
    }
  });
});

describe('a pass costs nothing — the turn proceeds exactly as it would have', () => {
  it.each([
    ['no claim to check', NO_CLAIM, null, null, 'no_claim'],
    ['claim backed by the commit graph', CLAIM, BACKED, null, 'backed_by_commit_graph'],
    ['claim backed by the persisted graph', CLAIM, null, BACKED, 'backed_by_persisted_graph'],
  ])('%s → pass, nothing withheld', (_n, text, commit, persisted, reason) => {
    const d = decide(text, commit, persisted);
    expect(d.verdict).toBe('pass');
    expect(d.reason).toBe(reason);
    expect(d.consequences.withholdGraphWrite).toBe(false);
    expect(d.consequences.withholdReceiptFacts).toBe(false);
  });

  // ⭐ CONTRAST CONTROL. If the fixtures were wrong and nothing ever passed,
  // every assertion above would hold vacuously on an all-swap guard.
  it('CONTROL: the guard genuinely distinguishes backed from unbacked', () => {
    expect(decide(CLAIM, BACKED, null).verdict).toBe('pass');
    expect(decide(CLAIM, UNBACKED, null).verdict).toBe('swap');
  });
});
