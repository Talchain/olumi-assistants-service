/**
 * Served 500 on 8 Oct (CEE 1c834a0c, request 27dfd9e5): an Olumi draft-time widened risk (#2854) is a precondition
 * member with `draft_widening.hits` and NO `relies_on`, and `leftOutLines` read `relies_on.option_id` blind on the
 * build turn's writing path. The fixture is the served B1 graph exactly as the witness read it back.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { decisionInputLines } from '../decision-input-ask.js';
import { preconditionRiskIds } from '../../../graph/inert-risk.js';

type Rec = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-b1-widened-20261008.json', import.meta.url), 'utf8')) as Rec;
const ctx = { restingText: '', questionsToggle: false, recentReplies: [], awaitingApproval: false, builtOrRan: true } as never;
const limits = (g: Rec): string[] => (g.goal_constraints ?? []).map((c: Rec) => c.node_id).filter((x: unknown) => typeof x === 'string');

describe('a widened risk on the served writing path', () => {
  it('the served B1 graph: its 3 widened risks are precondition members and decisionInputLines names each against the option it hits', () => {
    const widened = SERVED.nodes.filter((n: Rec) => n.draft_widening?.provenance === 'ai_suggested_widen');
    expect(widened.map((n: Rec) => n.id)).toEqual(['feature_release_slips', 'value_message_misses_buyers', 'test_delays_pricing_decision']);
    const members = preconditionRiskIds(SERVED.nodes, SERVED.edges, limits(SERVED));
    for (const n of widened) expect(members.has(n.id), n.id).toBe(true);
    expect(widened.every((n: Rec) => n.relies_on === undefined)).toBe(true);
    const lines = decisionInputLines(SERVED, ctx);
    for (const n of widened) {
      const option = SERVED.nodes.find((o: Rec) => o.id === n.draft_widening.hits.id);
      expect(option?.kind, n.id).toBe('option');
      expect(lines.some((l) => l.includes(n.label) && l.includes(option.label)), `${n.label} named against ${option.label}`).toBe(true);
    }
  });

  it('CONTRAST: a relies_on-stamped precondition risk keeps its line; a widened risk whose hit names no option falls to the generic left-out line, never a throw', () => {
    const stamped = structuredClone(SERVED);
    const r = stamped.nodes.find((n: Rec) => n.id === 'feature_release_slips');
    const optionId = r.draft_widening.hits.id;
    delete r.draft_widening; r.relies_on = { option_id: optionId };
    const option = stamped.nodes.find((o: Rec) => o.id === optionId);
    expect(decisionInputLines(stamped, ctx).some((l) => l.includes(r.label) && l.includes(option.label))).toBe(true);
    const dangling = structuredClone(SERVED);
    dangling.nodes.find((n: Rec) => n.id === 'value_message_misses_buyers').draft_widening.hits.id = 'no_such_option';
    expect(() => decisionInputLines(dangling, ctx)).not.toThrow();
  });
});
