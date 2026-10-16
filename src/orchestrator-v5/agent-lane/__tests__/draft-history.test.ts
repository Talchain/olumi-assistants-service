import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { draftHistory, humanItemsAfterTheDraft, laterWritesThan, messagesBesidesTheBrief } from '../runtime/draft-replacement.js';
import { constructionOperationId } from '../runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import type { CommittedTurnLedger } from '../../session/store.js';

const capture = JSON.parse(readFileSync(new URL('./fixtures/funding-16d51e1b-turn2-brief.json', import.meta.url), 'utf8')) as {
  scenario_id: string; brief_text: string; graph: Record<string, unknown>; messages: { turn_id: string; user_message: string }[];
};
const construction = registrationTurnId(capture.scenario_id, constructionOperationId(capture.scenario_id, capture.brief_text));
const ledger = (): CommittedTurnLedger => ({
  complete: true, write_turn_ids: [construction], first_user_message: capture.messages[0]!.user_message.trim(),
  user_message_turn_ids: capture.messages.map(m => m.turn_id),
  later_user_messages: capture.messages.slice(1).map(m => ({ turn_id: m.turn_id, text: m.user_message })),
});
const check = (l = ledger()) => draftHistory(l, capture.scenario_id, capture.brief_text, 'correction-turn');

describe('captured turn-2 construction: history meaning versus unreadable authority', () => {
  it('replays the exact legacy G3 refusal independently of the uncaptured construction ledger', () => {
    const l = ledger();
    expect(humanItemsAfterTheDraft(capture.graph).filter(i => i.carry === undefined)).toEqual([]);
    expect(l.first_user_message).not.toBe(capture.brief_text);
    expect(messagesBesidesTheBrief(l, capture.brief_text, capture.messages.slice(1).map(m => m.turn_id), 'correction-turn'))
      .toEqual(['no saved record that your first message is this brief']);
    // The capture did not return mutation ids: both explicit contrasts still have the same G3 reason above.
    expect(laterWritesThan(l, capture.scenario_id, capture.brief_text)).toBe(0);
    expect(laterWritesThan({ ...l, write_turn_ids: [] }, capture.scenario_id, capture.brief_text))
      .toBe('no saved record that this draft is the one built from your brief');
    expect(check().found).toEqual([]);
    expect(check().warnings.join(' ')).toContain('saved brief does not match your first message');
    expect(check().messages).toEqual([capture.messages[1]!.user_message]);
  });

  it('a missing construction record and later saved changes warn instead of inventing an author or refusing', () => {
    expect(check({ ...ledger(), write_turn_ids: [] }).warnings.join(' ')).toContain('does not confirm the original construction');
    expect(check({ ...ledger(), write_turn_ids: [construction, 'later-write'] }).warnings.join(' ')).toContain('saved changes after the draft');
    expect(check({ ...ledger(), write_turn_ids: [construction, 'later-write'] }).found).toEqual([]);
  });

  it('an incomplete census and missing conversation text remain hard refusals', () => {
    expect(check({ ...ledger(), complete: false }).found).toEqual(['the saved history is incomplete, so Olumi cannot check all earlier work']);
    expect(check({ ...ledger(), later_user_messages: [] }).found).toEqual(['some earlier conversation could not be read']);
  });

  it('approval excludes its own correction row but still rejects any new message despite the first-message mismatch', () => {
    const l = ledger();
    const bound = l.user_message_turn_ids.slice(1);
    const committed = { ...l, user_message_turn_ids: [...l.user_message_turn_ids, 'correction-turn'],
      later_user_messages: [...l.later_user_messages!, { turn_id: 'correction-turn', text: 'The correction' }] };
    const approved = draftHistory(committed, capture.scenario_id, capture.brief_text, 'press', { bound, goalTurnId: 'correction-turn' });
    expect(approved.found).toEqual([]);
    expect(approved.context).toEqual(check().context);
    const changed = { ...committed, user_message_turn_ids: [...committed.user_message_turn_ids, 'new-message'],
      later_user_messages: [...committed.later_user_messages, { turn_id: 'new-message', text: 'An additional constraint' }] };
    expect(draftHistory(changed, capture.scenario_id, capture.brief_text, 'press', { bound, goalTurnId: 'correction-turn' }).found)
      .toEqual(['the conversation changed after this card was offered; ask for an updated card']);
  });
});
