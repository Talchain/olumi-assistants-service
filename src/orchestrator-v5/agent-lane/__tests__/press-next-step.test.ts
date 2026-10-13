/**
 * ⭐ COACH (DL coaching-on-press): each withheld-Run blocker is typed by its own producer, from that producer's facts. A missing
 * input is asked; a missing implementation is said plainly and never asked; an existing card owns its own step; a stale result
 * says its own line. Real inputs where they exist: the served s4b capture's graph and verdict (unseen-1).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { targetBlockerOf, targetTestabilityOf, untestableTargetParts, type UntestableTargetParts } from '../../admission/target-testability.js';
import { jointBlockerOf, jointWithheldLine, type JointWithholdReason } from '../../goal-target/goal-targets-joint.js';
import { chanceGoalBlockerOf, chanceGoalDeadlineAsk } from '../../goal-target/goal-kind.js';
import { unreadGoalProductBlockerOf, type UnreadGoalProduct } from '../unread-goal-product.js';
import { staleBlockerOf, staleResultLine } from '../write-outcome.js';
import { AIE_TEXT_PENDING_CANNOT_CALCULATE_YET, AIE_TEXT_PENDING_STARTING_VALUE_ASK, oneNextStep, type PressBlocker } from '../press-next-step.js';

type Rec = Record<string, any>;
const read = (name: string): Rec => JSON.parse(readFileSync(new URL(`../../goal-target/__tests__/fixtures/s4b/${name}.json`, import.meta.url), 'utf8'));
const graph = read('unseen-1-read').j.graph;
const envelope = (read('unseen-1-run').blocks as Rec[]).find((b) => b.type === 'analysis_result')!.enrichment as Rec;
const verdict = targetTestabilityOf(graph, envelope.identity_evaluations);
if (verdict.kind !== 'not_testable') throw new Error('the capture must have target failures');
const CASE_B = { precondition: 'P3' as const, case: 'b' as const, code: 'comparator_unscorable' as const };

describe('target: the failing cases type the ONE step', () => {
  it('served capture: the target\'s own question is the step, byte for byte', () => {
    const parts = untestableTargetParts(graph, verdict)!;
    expect(parts.question).not.toBeNull();
    expect(targetBlockerOf(parts)).toEqual({ kind: 'missing_input', ask: parts.question });
  });

  it('case b alone is a capability gap: said plainly, never asked', () => {
    const parts = untestableTargetParts(graph, { ...verdict, failures: [CASE_B] })!;
    expect(parts.question).toBeNull();
    expect(parts.untestableComparator).not.toBeNull();
    const blocker = targetBlockerOf(parts);
    expect(blocker).toEqual({ kind: 'missing_implementation', what: `a chance for a ${parts.untestableComparator} target on ‘${parts.name}’` });
    expect(blocker).not.toHaveProperty('ask');
    expect(AIE_TEXT_PENDING_CANNOT_CALCULATE_YET((blocker as { what: string }).what)).toContain('answering a question won\'t change it');
  });

  it('case b beside an answerable case: the ask keeps the gap beside it, so an answer is never promised to unlock it', () => {
    const parts = untestableTargetParts(graph, { ...verdict, failures: [...verdict.failures, CASE_B] })!;
    expect(parts.question).not.toBeNull();
    expect(targetBlockerOf(parts)).toEqual({ kind: 'missing_input', ask: parts.question,
      also_unbuilt: `a chance for a ${parts.untestableComparator} target on ‘${parts.name}’` });
  });

  it('no question and no comparator: only an offered identity card owns the step; none is invented', () => {
    const parts: UntestableTargetParts = { ...untestableTargetParts(graph, verdict)!, question: null, untestableComparator: null };
    expect(targetBlockerOf(parts)).toBeNull();
    expect(targetBlockerOf(parts, true)).toEqual({ kind: 'confirm', by: 'identity_card' });
  });
});

describe('joint: the same reason the withheld line says types the step', () => {
  const kinds: Record<JointWithholdReason, PressBlocker['kind']> = {
    target_not_supported: 'missing_implementation', strict_not_preserved: 'missing_implementation',
    figure_not_preserved: 'missing_implementation', condition_not_named: 'missing_implementation',
    olumi_base: 'missing_input', no_option: 'missing_input', precision_missing: 'run_again', not_returned: 'run_again',
  };
  it.each(Object.entries(kinds))('%s → %s', (reason, kind) => {
    expect(jointBlockerOf(2, reason as JointWithholdReason, ['Churn'])).toHaveProperty('kind', kind);
  });

  it('a change target that can\'t be combined is named as the gap, never asked', () => {
    const blocker = jointBlockerOf(2, 'target_not_supported', ['Revenue']);
    expect(blocker).toEqual({ kind: 'missing_implementation',
      what: 'the chance of meeting both targets together while ‘Revenue’ is stated as a change' });
    expect(jointWithheldLine(2, 'target_not_supported', ['Revenue'])).toContain('can’t yet be combined');
  });

  it('only the user can give Olumi\'s assumed starting value; a repeated Run is the line\'s own step', () => {
    expect(jointBlockerOf(3, 'olumi_base')).toEqual({ kind: 'missing_input', ask: AIE_TEXT_PENDING_STARTING_VALUE_ASK });
    for (const reason of ['precision_missing', 'not_returned'] as const) {
      expect(jointBlockerOf(2, reason)).toEqual({ kind: 'run_again', why: reason });
      expect(jointWithheldLine(2, reason)).toContain('Run the analysis again');
    }
  });
});

describe('chance goal, unread product and stale', () => {
  it('a chance goal with no date asks the date a writer takes; with the date held nothing is asked', () => {
    expect(chanceGoalBlockerOf('Ship the release', undefined)).toEqual({ kind: 'missing_input', ask: chanceGoalDeadlineAsk('Ship the release') });
    const held = chanceGoalBlockerOf('Ship the release', '9 April 2027');
    expect(held.kind).toBe('missing_implementation');
    expect(held).not.toHaveProperty('ask');
  });

  it('an unread product is confirmed by its reading press when one is on offer; otherwise the gap is said', () => {
    const p = { goal: { id: 'g', label: 'Monthly revenue', level: 50, unit: '£k', typed: true },
      rate: { id: 'r', label: 'Price', level: 50, unit: '£' }, count: { id: 'c', label: 'Customers', level: 1000, unit: 'customers' } } as UnreadGoalProduct;
    expect(unreadGoalProductBlockerOf(p, true)).toEqual({ kind: 'confirm', by: 'confirm_reading' });
    expect(unreadGoalProductBlockerOf(p, false)).toEqual({ kind: 'missing_implementation',
      what: 'how likely any option is to reach ‘Monthly revenue’ read as ‘Price’ × ‘Customers’' });
  });

  it('stale only from run_state, with the stale line\'s own words; an unbound current Run is not stale', () => {
    const stale = { run_state: { kind: 'complete_stale', cause: 'graph_changed' }, requires_rerun: true };
    expect(staleBlockerOf(stale, { may_run: true })).toEqual({ kind: 'stale', say: staleResultLine(stale, { may_run: true }) });
    expect(staleBlockerOf(stale, { may_run: true })).toHaveProperty('say', expect.stringContaining('run it again'));
    expect(staleBlockerOf(stale, { may_run: false })).toHaveProperty('say', expect.not.stringContaining('run it again'));
    expect(staleBlockerOf({ run_state: { kind: 'complete_current' } }, { may_run: true })).toBeNull();
  });
});

describe('ONE step when several stand', () => {
  const input: PressBlocker = { kind: 'missing_input', ask: 'What is today\'s level of churn?' };
  const unbuilt: PressBlocker = { kind: 'missing_implementation', what: 'x' };
  it('stale, then run again, then a card, then an input, then a missing implementation; nothing → none', () => {
    const stale: PressBlocker = { kind: 'stale', say: 's' };
    const card: PressBlocker = { kind: 'confirm', by: 'confirm_reading' };
    expect(oneNextStep([unbuilt, input, card, stale])).toBe(stale);
    expect(oneNextStep([unbuilt, input, card])).toBe(card);
    expect(oneNextStep([unbuilt, null, input])).toBe(input);
    expect(oneNextStep([undefined, unbuilt])).toBe(unbuilt);
    expect(oneNextStep([null, undefined])).toBeNull();
  });
});
