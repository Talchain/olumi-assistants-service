/**
 * Conversation memory — the epistemic-state guarantees.
 *
 * Each case is bound to a failure MEASURED on 20 Sep 2026, named in the test
 * title, so a later reader can tell which real defect a guard is holding shut.
 */

import { describe, expect, it } from 'vitest';

import {
  EMPTY_CONVERSATION_MEMORY,
  EpistemicStateError,
  liveItems,
  liveItemsOfKind,
  recordItem,
  renderItemsForContext,
  unsubstantiatedChangeClaims,
  withdrawItem,
  type ConversationMemory,
} from '../conversation-memory.js';

const AT = '2026-09-20T12:00:00.000Z';

function seed(): ConversationMemory {
  return recordItem(EMPTY_CONVERSATION_MEMORY, {
    id: 'i1',
    kind: 'user_fact',
    text: 'Our advertising budget is £50,000 and the last campaign lifted enquiries 8%.',
    source_turn_id: 't1',
    recorded_at: AT,
  });
}

describe('conversation memory — what the user established survives', () => {
  it('retains a user fact as its own record, not as transcript text', () => {
    const m = seed();
    const facts = liveItemsOfKind(m, 'user_fact');
    expect(facts).toHaveLength(1);
    expect(facts[0]?.text).toContain('£50,000');
    expect(facts[0]?.source_turn_id).toBe('t1');
  });

  it('is append-only: a correction supersedes and both records remain', () => {
    const m = recordItem(seed(), {
      id: 'i2',
      kind: 'user_fact',
      text: 'Correction: the budget is £40,000.',
      source_turn_id: 't4',
      recorded_at: AT,
      supersedes: 'i1',
    });
    expect(m.items).toHaveLength(2);
    expect(liveItems(m)).toHaveLength(1);
    expect(liveItems(m)[0]?.id).toBe('i2');
    const old = m.items.find((i) => i.id === 'i1');
    expect(old?.status).toBe('superseded');
    expect(old?.superseded_by).toBe('i2');
  });

  it('refuses to supersede an item that does not exist — a dangling supersede leaves the stale claim live', () => {
    expect(() =>
      recordItem(seed(), {
        id: 'i9',
        kind: 'user_fact',
        text: 'x',
        source_turn_id: 't9',
        recorded_at: AT,
        supersedes: 'nope',
      }),
    ).toThrow(EpistemicStateError);
  });

  it('refuses a record with no provenance — an unreconcilable claim is the defect this module exists for', () => {
    expect(() =>
      recordItem(EMPTY_CONVERSATION_MEMORY, {
        id: 'i1',
        kind: 'user_fact',
        text: 'something',
        source_turn_id: '   ',
        recorded_at: AT,
      }),
    ).toThrow(/provenance/);
  });
});

describe('conversation memory — kinds cannot collapse', () => {
  it('refuses to let an ai_suggestion supersede a user_fact (the assistant cannot overwrite the user)', () => {
    expect(() =>
      recordItem(seed(), {
        id: 'i2',
        kind: 'ai_suggestion',
        text: 'Actually the budget is £10,000.',
        source_turn_id: 't2',
        recorded_at: AT,
        supersedes: 'i1',
      }),
    ).toThrow(/same kind/);
  });

  it('renders every item under its kind, and a suggestion is visibly not a fact', () => {
    let m = seed();
    m = recordItem(m, {
      id: 'i2',
      kind: 'ai_suggestion',
      text: 'Set the new-customer price effect to full parity.',
      source_turn_id: 't2',
      recorded_at: AT,
    });
    const rendered = renderItemsForContext(m) ?? '';
    expect(rendered).toContain('THE USER STATED AS FACT');
    expect(rendered).toContain('YOU SUGGESTED (not agreed, not applied)');
    // The decisive assertion: the suggestion's text never appears without a
    // qualifying label ahead of it. This is the "the AI proposed X" → "X"
    // fabrication route, closed.
    const suggestionIdx = rendered.indexOf('Set the new-customer price effect');
    const labelIdx = rendered.indexOf('YOU SUGGESTED');
    expect(labelIdx).toBeGreaterThanOrEqual(0);
    expect(labelIdx).toBeLessThan(suggestionIdx);
  });

  it('orders the strongest claims first so a skimmed section is not misleading', () => {
    let m = recordItem(EMPTY_CONVERSATION_MEMORY, {
      id: 'a', kind: 'ai_suggestion', text: 'suggestion text', source_turn_id: 't1', recorded_at: AT,
    });
    m = recordItem(m, {
      id: 'b', kind: 'user_fact', text: 'fact text', source_turn_id: 't2', recorded_at: AT,
    });
    const rendered = renderItemsForContext(m) ?? '';
    expect(rendered.indexOf('fact text')).toBeLessThan(rendered.indexOf('suggestion text'));
  });

  it('returns null rather than an empty section — "nothing established" is a claim we must not make', () => {
    expect(renderItemsForContext(EMPTY_CONVERSATION_MEMORY)).toBeNull();
  });
});

describe('conversation memory — an authorised change needs a receipt', () => {
  it('refuses authorised_change without a proposal id and a receipt id', () => {
    expect(() =>
      recordItem(EMPTY_CONVERSATION_MEMORY, {
        id: 'c1',
        kind: 'authorised_change',
        text: 'Set Monthly Churn Rate to 0.03',
        source_turn_id: 't1',
        recorded_at: AT,
      }),
    ).toThrow(/proposal_id and receipt_id/);
  });

  it('refuses authorised_change with consent but no receipt — consent without a receipt is a claim, not a change', () => {
    expect(() =>
      recordItem(EMPTY_CONVERSATION_MEMORY, {
        id: 'c1',
        kind: 'authorised_change',
        text: 'Set Monthly Churn Rate to 0.03',
        source_turn_id: 't1',
        recorded_at: AT,
        proposal_id: 'p1',
      }),
    ).toThrow(/receipt_id/);
  });

  it('accepts an authorised change carrying both, and keeps them for later reconciliation', () => {
    const m = recordItem(EMPTY_CONVERSATION_MEMORY, {
      id: 'c1',
      kind: 'authorised_change',
      text: 'Set Monthly Churn Rate to 0.03',
      source_turn_id: 't1',
      recorded_at: AT,
      proposal_id: 'p1',
      receipt_id: 'r1',
    });
    const [item] = liveItemsOfKind(m, 'authorised_change');
    expect(item?.proposal_id).toBe('p1');
    expect(item?.receipt_id).toBe('r1');
  });
});

describe('conversation memory — a claim about what changed is checked against the record', () => {
  it('flags a claimed change with no authorised record — "Updated X" then "I haven\'t changed anything"', () => {
    const m = seed();
    expect(unsubstantiatedChangeClaims(m, ['c1'])).toEqual(['c1']);
  });

  it('passes a claim backed by an authorised change', () => {
    const m = recordItem(EMPTY_CONVERSATION_MEMORY, {
      id: 'c1',
      kind: 'authorised_change',
      text: 'Set Monthly Churn Rate to 0.03',
      source_turn_id: 't1',
      recorded_at: AT,
      proposal_id: 'p1',
      receipt_id: 'r1',
    });
    expect(unsubstantiatedChangeClaims(m, ['c1'])).toEqual([]);
  });

  it('a withdrawn change stops substantiating a claim', () => {
    let m = recordItem(EMPTY_CONVERSATION_MEMORY, {
      id: 'c1',
      kind: 'authorised_change',
      text: 'Set Monthly Churn Rate to 0.03',
      source_turn_id: 't1',
      recorded_at: AT,
      proposal_id: 'p1',
      receipt_id: 'r1',
    });
    m = withdrawItem(m, 'c1');
    expect(unsubstantiatedChangeClaims(m, ['c1'])).toEqual(['c1']);
  });
});

describe('conversation memory — purity', () => {
  it('never mutates the input memory', () => {
    const before = seed();
    const snapshot = JSON.stringify(before);
    recordItem(before, { id: 'i2', kind: 'open_question', text: 'q', source_turn_id: 't2', recorded_at: AT });
    withdrawItem(before, 'i1');
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('refuses a duplicate id rather than silently shadowing an earlier record', () => {
    expect(() =>
      recordItem(seed(), { id: 'i1', kind: 'open_question', text: 'q', source_turn_id: 't2', recorded_at: AT }),
    ).toThrow(/duplicate/);
  });
});
