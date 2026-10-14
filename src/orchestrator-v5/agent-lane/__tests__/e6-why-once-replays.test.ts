/**
 * E6 Why-once (S7; DL 12 Oct, after Batch R's independent check). Strengthen items are offered again (Batch R: per-item
 * cooldown with fall-through), but the POLICY's "Why?" block, its science basis, is said once per state; later items
 * carry their action without the same Why?. Display only: no item is hidden, and the wire and the model's context are
 * unchanged.
 *
 * Two served sessions, replayed through the real selector, wire, Why? and reply composer (`composeReplyShape`):
 *   - Paul's hiring session (`fixtures/paul-hiring-4184e877.json`): one model state, 13 replies.
 *   - The marketing live run (`fixtures/marketing-17c98e69.json`): 12 turns over two model states, either side of turn
 *     10's option edit. Served, the same Strengthen Why? rode 7 replies (6 on one item, before E6).
 * "State" is the policy's own state (the keys of the items it has shown), as for every E6 row. The marketing edit changes
 * an option's value, not a goal-path link or factor, so the Strengthen Why? is not said again after it. A change to a
 * shown item re-arms it once (the contrast at the end).
 */
import { describe, expect, it } from 'vitest';
import paul from './fixtures/paul-hiring-4184e877.json';
import marketing from './fixtures/marketing-17c98e69.json';
import { eligibleInterventionFor, selectTurnGuidanceShown } from '../turn-context/guidance-wire.js';
import { guidanceHistoryOf, guidanceOnAnswer, thinDraftShownWire, type AnswerGuidance } from '../turn-context/guidance-history.js';
import { composeReplyShape } from '../reply/compose-reply.js';
import { INTERVENTION_WHY_LABEL } from '../reply/eligible-intervention-reply.js';
import { entryKey } from '../guidance/select.js';
import { thinDraftOffer } from '../method-turn/widen-turn.js';

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
type Kind = 'construction' | 'turn' | 'run' | 'edit' | 'press_strengthen' | string;
type Reply = { turn: number; graph: Graph; policy?: string; variant?: string; item?: string; key?: string; why: number; action: boolean };
const STRENGTHEN = 'RC-STRENGTHEN-ITEM';
const REPLY = 'Here is what the model shows so far.';

/** One reply per turn, as the route builds it: select on the readback, compose the Why? and action, record the answer. */
function replay(turns: readonly { kind: Kind; graph: Graph }[], history: AnswerGuidance[] = []): Reply[] {
  let held: string | undefined;
  return turns.map(({ kind, graph }, i) => {
    const state = guidanceHistoryOf(history);
    const shown = selectTurnGuidanceShown({ request: 'turn', offeredSpecific: [], licence: 'withheld', guidance: state, state: { graph } });
    let answer: AnswerGuidance | undefined;
    let reply: Reply = { turn: i + 1, graph, why: 0, action: false };
    if (kind === 'construction') {
      answer = guidanceOnAnswer(thinDraftOffer(graph, true) === null ? undefined : thinDraftShownWire(shown.wire), state);
    } else if (kind === 'press_suggest_risks') answer = guidanceOnAnswer(undefined, state, { policy_id: 'RC-WIDEN' });
    else if (kind === 'press_strengthen') answer = guidanceOnAnswer(undefined, state, { policy_id: STRENGTHEN, item: held });
    else if (kind === 'turn') {
      const row = shown.wire?.slot1;
      const intervention = eligibleInterventionFor(shown.wire);
      const text = intervention === undefined ? REPLY : composeReplyShape({ text: REPLY, eligibleIntervention: intervention,
        interventionActionLabel: row?.primary_action.label, interventionWhySaid: shown.whySaid }).text;
      if (row?.policy_id === STRENGTHEN) held = row.item;
      reply = { ...reply, policy: row?.policy_id, variant: row?.variant, item: row?.item, key: row?.state_key_hash,
        // R3-1 (staging 9bac9729): the Why? is a plain final paragraph, the label and this intervention's own words, byte for byte.
        why: intervention === undefined ? 0 : text.split(`${INTERVENTION_WHY_LABEL} ${intervention.why}`).length - 1, action: row !== undefined && text.includes(row.primary_action.label) };
      answer = guidanceOnAnswer(shown.wire, state);
    }
    if (answer !== undefined) history.unshift(answer);
    return reply;
  });
}
const strengthen = (replies: readonly Reply[]) => replies.filter(r => r.policy === STRENGTHEN);
const whys = (replies: readonly Reply[]) => strengthen(replies).reduce((n, r) => n + r.why, 0);

const HIRING = paul.graph as unknown as Graph;
const hiringTurns = paul.served_answers.map(a => ({ kind: a.kind, graph: HIRING }));
const graphs = marketing.graphs as unknown as Record<string, Graph>;
const marketingTurns = marketing.served_answers.map(a => ({ kind: a.kind, graph: graphs[a.graph_hash]! }));
const [BEFORE_EDIT, AFTER_EDIT] = [...new Set(marketing.served_answers.map(a => a.graph_hash))].map(h => graphs[h]!);

describe('E6 Why-once: Strengthen items are still offered, and the policy\'s Why? is said once per state', () => {
  it('IDENTITY (marketing): the replay\'s first Strengthen row IS served turn 2\'s row; served, the Why? rode 7 replies', () => {
    const served = marketing.served_answers.find(a => a.turn === 2)!.row!;
    const first = strengthen(replay(marketingTurns))[0]!;
    expect([first.policy, first.variant, first.item, first.key]).toEqual([served.policy_id, served.variant, served.item, served.state_key_hash]);
    expect(marketing.served_answers.filter(a => a.row?.policy_id === STRENGTHEN && a.why === 1)).toHaveLength(7);
    expect(new Set(marketing.served_answers.map(a => a.graph_hash)).size, 'two model states').toBe(2);
  });

  it('IDENTITY (hiring): the replay offers the served Strengthen row (entry deb43dafd281, key d44e7cf3e76d)', () => {
    const served = paul.served_answers.flatMap(a => Object.entries(a.agent_guidance ?? {}))
      .filter(([k]) => k.startsWith(STRENGTHEN)).map(([k, v]) => `${k}=${v.state_key_hash}`);
    const replayed = strengthen(replay(hiringTurns)).map(r => `${entryKey(STRENGTHEN, r.item)}=${r.key}`);
    expect(served.length, 'POSITIVE CONTROL: the served session has a Strengthen row').toBeGreaterThan(0);
    for (const s of served) expect(replayed).toContain(s);
  });

  it('hiring (one state): several Strengthen items each carry their action; the Why? is said ONCE, on the first', () => {
    const rows = strengthen(replay(hiringTurns));
    expect(rows.length, `items still offered: ${JSON.stringify(rows.map(r => r.item))}`).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map(r => r.item)).size, 'each item once').toBe(rows.length);
    expect(rows.every(r => r.action), 'every item carries its action').toBe(true);
    expect(rows.map(r => r.why)).toEqual([1, ...rows.slice(1).map(() => 0)]);
  });

  it('marketing, before the edit (one state): several items, each with its action; the Why? ONCE', () => {
    const rows = strengthen(replay(marketingTurns)).filter(r => r.graph === BEFORE_EDIT);
    expect(rows.length, `items still offered: ${JSON.stringify(rows.map(r => r.item))}`).toBeGreaterThanOrEqual(2);
    expect(rows.every(r => r.action)).toBe(true);
    expect(whys(rows)).toBe(1);
    expect(rows[0]!.why).toBe(1);
  });

  it('marketing, after the option edit: items are still offered; the edit is not a change of Strengthen\'s state, so no second Why?', () => {
    const edit = marketing.served_answers.find(a => a.kind === 'edit') as { event?: { kind?: string } } | undefined;
    expect(edit?.event?.kind, 'the served edit').toBe('option_intervention_edit');
    const replies = replay(marketingTurns);
    const after = strengthen(replies).filter(r => r.graph === AFTER_EDIT);
    expect(after.length, 'POSITIVE CONTROL: a Strengthen item is offered after the edit').toBeGreaterThanOrEqual(1);
    expect(after.every(r => r.action)).toBe(true);
    expect(whys(after)).toBe(0);
    expect(whys(replies), 'once across the session').toBe(1);
  });

  it('CONTRAST (re-arms once): a shown item whose value changes is offered again WITH the Why?, then said once', () => {
    const history: AnswerGuidance[] = [];
    const before = strengthen(replay(marketingTurns, history));
    const shownLink = before.find(r => r.item?.includes('->'))!;
    const [from, to] = shownLink.item!.split('->');
    const changed: Graph = { ...AFTER_EDIT, edges: AFTER_EDIT.edges.map(e => e.from === from && e.to === to
      ? { ...e, exists_probability: (typeof e.exists_probability === 'number' ? e.exists_probability : 0.9) - 0.05 } : e) };
    const next = replay([{ kind: 'turn', graph: changed }, { kind: 'turn', graph: changed }], history);
    expect([next[0]!.item, next[0]!.why], 'the changed item again, with its Why?').toEqual([shownLink.item, 1]);
    expect(next[0]!.key).not.toBe(shownLink.key);
    expect(next[1]!.policy, 'POSITIVE CONTROL: another Strengthen item follows').toBe(STRENGTHEN);
    expect(next[1]!.why, 'and only once on the new state').toBe(0);
  });
});
