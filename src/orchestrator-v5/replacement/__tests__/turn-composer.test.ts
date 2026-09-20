/**
 * Turn composition — the four rules, each pinned against the failure it came
 * from. Pure; no clock, no randomness, no model.
 */

import { describe, expect, it } from 'vitest';

import type { AgentLoopResult } from '../agent-loop.js';
import { EMPTY_CONVERSATION_MEMORY, liveItemsOfKind } from '../conversation-memory.js';
import {
  EMPTY_PROPOSAL_STORE,
  authoriseProposal,
  beginApply,
  openProposal,
  openProposals,
} from '../proposal-store.js';
import { composeTurn, describePendingProposal, reconciliationNotice } from '../turn-composer.js';

const NOW = '2026-09-20T12:00:00.000Z';
const REV = 'rev-1';
const TURN = 'turn-7';
const idFor = (purpose: string, i: number): string => `${purpose}-${i}`;

function loop(over: Partial<AgentLoopResult> = {}): AgentLoopResult {
  return {
    text: 'Here is what I think.',
    proposed: [],
    toolsCalled: [],
    iterations: 1,
    haltedAtCeiling: false,
    ...over,
  };
}

const base = {
  memory: EMPTY_CONVERSATION_MEMORY,
  proposals: EMPTY_PROPOSAL_STORE,
  modelRevision: REV,
  turnId: TURN,
  now: NOW,
  idFor: idFor as (p: 'proposal' | 'suggestion', i: number) => string,
};

describe('rule 1 — an unresolved save silences every claim about it', () => {
  function withInFlight() {
    let s = openProposal(EMPTY_PROPOSAL_STORE, {
      id: 'p1',
      operations: [{ kind: 'set_factor_value', summary: 'Set Monthly Churn Rate to 0.03' }],
      model_revision: REV, proposed_at: NOW, proposed_in_turn: 't1',
    });
    s = authoriseProposal(s, 'p1', { authorised_in_turn: 't2', authorised_at: NOW, current_model_revision: REV });
    return beginApply(s, 'p1', { idempotency_key: 'k1', apply_started_at: NOW, current_model_revision: REV });
  }

  it('replaces the turn with a notice that refuses to guess in either direction', () => {
    const r = composeTurn({ ...base, proposals: withInFlight(), loopResult: loop({ text: 'I have updated it.' }) });
    expect(r.mustReconcile).toHaveLength(1);
    expect(r.text).not.toContain('I have updated it.');
    expect(r.text).toContain('not come back confirmed');
    expect(r.text).toContain('Monthly Churn Rate');
    // Neither story is told.
    expect(r.text).toMatch(/will not tell you it landed or it didn't/);
  });

  it('stages nothing new while a save is outstanding — that is how a double-apply is built', () => {
    const r = composeTurn({
      ...base,
      proposals: withInFlight(),
      loopResult: loop({ proposed: [{ tool: 'set_option_effect', summary: 'Set X on Y to 1', operations: [{ op: 'u' }] }] }),
    });
    expect(r.openedProposalIds).toEqual([]);
    expect(openProposals(r.proposals)).toHaveLength(0);
    expect(liveItemsOfKind(r.memory, 'ai_suggestion')).toHaveLength(0);
  });

  it('the notice names what is outstanding rather than describing it abstractly', () => {
    const text = reconciliationNotice(withInFlight().proposals);
    expect(text).toContain('Set Monthly Churn Rate to 0.03');
  });
});

describe('rule 2 — what the assistant proposes is recorded as a suggestion, never a fact', () => {
  it('writes each staged change into memory as ai_suggestion', () => {
    const r = composeTurn({
      ...base,
      loopResult: loop({ proposed: [{ tool: 'set_option_effect', summary: 'Set X on Y to 1', operations: [{ op: 'u' }] }] }),
    });
    const suggestions = liveItemsOfKind(r.memory, 'ai_suggestion');
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.text).toBe('Set X on Y to 1');
    expect(suggestions[0]?.source_turn_id).toBe(TURN);
    // and NOT as anything with more standing
    expect(liveItemsOfKind(r.memory, 'user_fact')).toHaveLength(0);
    expect(liveItemsOfKind(r.memory, 'authorised_change')).toHaveLength(0);
  });
});

describe('rule 3 — a staged change becomes a durable proposal bound to this revision', () => {
  it('"Yes, make that update now" has something to attach to next turn', () => {
    const r = composeTurn({
      ...base,
      loopResult: loop({ proposed: [{ tool: 'set_option_effect', summary: 'Set X on Y to 1', operations: [{ op: 'u' }] }] }),
    });
    const open = openProposals(r.proposals);
    expect(open).toHaveLength(1);
    expect(open[0]?.id).toBe('proposal-0');
    expect(open[0]?.model_revision).toBe(REV);
    expect(open[0]?.proposed_in_turn).toBe(TURN);
    expect(r.openedProposalIds).toEqual(['proposal-0']);
  });

  it('carries the raw operations through so consent applies exactly what was offered', () => {
    const ops = [{ op: 'update_node', path: '/nodes/a/data/interventions/b' }];
    const r = composeTurn({
      ...base,
      loopResult: loop({ proposed: [{ tool: 'set_option_effect', summary: 's', operations: ops }] }),
    });
    expect(openProposals(r.proposals)[0]?.operations[0]?.detail).toEqual({ operations: ops });
  });

  it('opens several staged changes in order, with distinct ids', () => {
    const r = composeTurn({
      ...base,
      loopResult: loop({
        proposed: [
          { tool: 'add_factor', summary: 'first', operations: [{ op: 'a' }] },
          { tool: 'add_edge', summary: 'second', operations: [{ op: 'b' }] },
        ],
      }),
    });
    expect(r.openedProposalIds).toEqual(['proposal-0', 'proposal-1']);
    expect(openProposals(r.proposals).map((p) => p.operations[0]?.summary)).toEqual(['first', 'second']);
    expect(liveItemsOfKind(r.memory, 'ai_suggestion').map((i) => i.text)).toEqual(['first', 'second']);
  });
});

describe('rule 4 — an unfinished turn says so', () => {
  it('appends a notice when the loop hit its ceiling', () => {
    const r = composeTurn({ ...base, loopResult: loop({ haltedAtCeiling: true }) });
    expect(r.incomplete).toBe(true);
    expect(r.text).toContain('Here is what I think.');
    expect(r.text).toContain('unfinished');
  });

  it('a completed turn carries no notice and reads exactly as the model wrote it', () => {
    const r = composeTurn({ ...base, loopResult: loop({ text: 'Complete answer.' }) });
    expect(r.incomplete).toBe(false);
    expect(r.text).toBe('Complete answer.');
  });
});

describe('the model\'s prose is not rewritten', () => {
  it('passes text through untouched — the old path had five egress rewriters and destroyed correct answers', () => {
    const awkward = 'The user asked about churn, so here is the answer with "quotes" and £50,000.';
    const r = composeTurn({ ...base, loopResult: loop({ text: awkward }) });
    expect(r.text).toBe(awkward);
  });

  it('never mutates the inputs', () => {
    const memBefore = JSON.stringify(base.memory);
    const propBefore = JSON.stringify(base.proposals);
    composeTurn({ ...base, loopResult: loop({ proposed: [{ tool: 't', summary: 's', operations: [{ op: 'u' }] }] }) });
    expect(JSON.stringify(base.memory)).toBe(memBefore);
    expect(JSON.stringify(base.proposals)).toBe(propBefore);
  });
});

describe('a pending proposal is described in plain language', () => {
  it('says what it is and what state it is in, with no internal enum', () => {
    const s = openProposal(EMPTY_PROPOSAL_STORE, {
      id: 'p1', operations: [{ kind: 'k', summary: 'Set X on Y to 1' }],
      model_revision: REV, proposed_at: NOW, proposed_in_turn: 't1',
    });
    const line = describePendingProposal(openProposals(s)[0]!);
    expect(line).toContain('Set X on Y to 1');
    expect(line).toContain('waiting for you to say yes');
    expect(line).not.toContain('_');
  });
});
