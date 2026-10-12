/**
 * ⛔ R3-1 (recovery Batch R3, S7): THE "WHY?" DISCLOSURE REACHED THE USER AS RAW HTML.
 *
 * Served CEE aadcf897, score run 2 (`live/runs/2026-10-12T144844Z`, hiring step 10, `turns/10.json`), the reply ended:
 *   "<details>\n<summary>Why?</summary>\n\nAssumption-based planning: name the load-bearing assumption, …\n\n</details>"
 * The UI's markdown renderer escapes HTML by design, so the user read the tags (8 replies in run 2: hiring 10, 11, 12,
 * 14; marketing 2, 4, 5, 6). Science's disclosure must still reach the user once, as text the chat renders: the same
 * label and the same words, byte for byte, as a plain final paragraph. The guidance row on the wire is not the composer's.
 */
import { describe, it, expect } from 'vitest';
import { composeReplyShape } from '../compose-reply.js';
import { eligibleInterventionFor, guidanceWireFor, type GuidanceWire } from '../../turn-context/guidance-wire.js';
import policy from '../../guidance/reasoning-interventions.json';

// The served guidance row, verbatim from hiring `turns/10.json` `.response_body.guidance.slot1`.
const SERVED_SLOT1 = {
  policy_id: 'RC-STRENGTHEN-ITEM', priority: 'P5', variant: 'S3L', item: 'leadership_coverage->productivity_change',
  primary_action: { label: 'Give your estimate', action_kind: 'edit_inline', target: 'leadership_coverage->productivity_change' },
  state_key_hash: '3c128c7df8dc',
  copy: { title: "The effect of leadership coverage is Olumi's guess.", why: 'It sits on the path to your goal.',
    question: 'Does leadership coverage really move productivity change as much as Olumi assumed?' },
  item_ref: { kind: 'link', from_id: 'leadership_coverage', to_id: 'productivity_change' },
};
// The served reply's own words, before the appended disclosure (hiring `turns/10.json` `.response_body.assistant_text`).
const SERVED_TEXT = 'Your 20–30% gives us a useful time-allocation baseline, but not yet a measure of productivity.\n\n'
  + '- Separate development time from completed, quality-checked work.\n- Distinguish necessary coordination from avoidable overhead.\n\n'
  + 'Some meetings may prevent rework, so we shouldn’t assume all non-development time is recoverable—or that more coding time '
  + 'automatically means more output.\n\nShould your 10% improvement target mean more time available for development, or more '
  + 'completed work at unchanged quality?';
const SERVED_SUFFIX = "\n\n<details>\n<summary>Why?</summary>\n\nAssumption-based planning: name the load-bearing assumption, test it, "
  + "and replace a guessed number with the decision-maker's own judgement where the choice depends on it.\n\n</details>";
const WHY = policy.rows.find(r => r.policy_id === 'RC-STRENGTHEN-ITEM')!.science_basis.summary;

const wire = (): GuidanceWire => ({ slot1: structuredClone(SERVED_SLOT1) } as unknown as GuidanceWire);
const occurrences = (text: string, part: string) => text.split(part).length - 1;

describe('R3-1: the Why? disclosure ships as text the chat renders, never as HTML', () => {
  it('the served suffix carries exactly this policy\'s science words (the fixture is the served row)', () => {
    expect(SERVED_SUFFIX).toContain(WHY);
    expect(eligibleInterventionFor(wire())?.why).toBe(WHY);
  });

  it.each([
    ['coaching reply (hiring step 10)', {}],
    ['coaching reply with the row\'s action', { interventionActionLabel: 'Give your estimate' }],
    ['Run face', { faceContract: 'run' as const }],
    ['Draft face', { faceContract: 'draft' as const }],
  ])('%s: no "<details"/"<summary"; the science words ride the guidance row, never the reply (technique (c))', (_name, extra) => {
    const carried = composeReplyShape({ text: SERVED_TEXT, profile: 'coaching', eligibleIntervention: eligibleInterventionFor(wire())!, ...extra });
    expect(carried.text).not.toContain('<details');
    expect(carried.text).not.toContain('<summary');
    expect(carried.text).not.toContain('</');
    // Technique (c) (AIE 6130197656 §3, DL 12 Oct; re-pinned from "Why? once, as the last paragraph"): the reply never
    // carries the method's Why?; the served row carries it as its own detail, the same words byte for byte.
    expect(occurrences(carried.text, WHY)).toBe(0);
    expect(carried.text).not.toContain('Why?');
    const { item_ref: _ref, ...row } = structuredClone(SERVED_SLOT1);
    expect((guidanceWireFor({ slot1: row } as never, null)!.slot1 as { science?: string }).science).toBe(WHY);
    expect(carried.text).toContain('Should your 10% improvement target mean more time available for development');
  });

  it('CONTRAST: with no eligible method the reply is byte-identical and carries no Why?', () => {
    const plain = composeReplyShape({ text: SERVED_TEXT, profile: 'coaching' });
    expect(plain.text).not.toContain('Why?');
    expect(plain.text).not.toContain(WHY);
  });

  it('CONTRAST: a whole proposal still ships unshaped, with no Why (R2 N2r kept)', () => {
    const input = { text: SERVED_TEXT, profile: 'proposal' as const };
    expect(composeReplyShape({ ...input, eligibleIntervention: eligibleInterventionFor(wire())! })).toEqual(composeReplyShape(input));
  });

  it('CONTRAST: the guidance wire row is not the composer\'s: composing leaves the served row byte-identical', () => {
    const row = wire();
    const before = JSON.stringify(row);
    composeReplyShape({ text: SERVED_TEXT, profile: 'coaching', eligibleIntervention: eligibleInterventionFor(row)!,
      interventionActionLabel: SERVED_SLOT1.primary_action.label });
    expect(JSON.stringify(row)).toBe(before);
    expect((row.slot1 as unknown as typeof SERVED_SLOT1).copy.why).toBe('It sits on the path to your goal.');
  });
});
