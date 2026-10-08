import { describe, expect, it } from 'vitest';
import { parsePendingAction } from '../../session/pending-action.js';
import {
  LINK_EFFECT_TOOL, linkEffectAnswerFirstCall, linkEffectClarificationOnRefusal,
  linkEffectClarificationsForAnswerRow, liveLinkEffectClarifications,
  type LinkEffectClarificationPending,
} from '../link-effect-clarification.js';

const SCENARIO = 'pricing';
const QUOTE = 'We predict churn will at least increase 1% with this price increase.';
const graph = {
  nodes: [{ id: 'price', label: 'Pro plan price' }, { id: 'churn', label: 'Monthly churn rate' }],
  edges: [{ from: 'price', to: 'churn', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } }],
};
const state = { ok: true, entities: graph.nodes, links: [{ from: 'price', to: 'churn', sizing: 'placeholder' }] };
const make = (nowMs = Date.now(), quote = QUOTE): LinkEffectClarificationPending => linkEffectClarificationOnRefusal({
  action: { from_id: 'price', to_id: 'churn', from_label: 'Pro plan price', to_label: 'Monthly churn rate', quote,
    question: 'Does this mean one percentage point or a relative increase?', refusal: 'unit_mismatch' },
  scenarioId: SCENARIO, graph, message: quote, emittedAtIso: new Date(nowMs).toISOString(),
})!;
const carry = (prior: LinkEffectClarificationPending[], extra: Partial<Parameters<typeof linkEffectClarificationsForAnswerRow>[0]> = {}) =>
  linkEffectClarificationsForAnswerRow({ prior, next: [], consumedLinks: [], graph, graphHash: 'after-run',
    nowMs: Date.now(), typedByUser: false, ...extra });

describe('context-only link-effect clarification and lifetime', () => {
  it('round-trips context and resolved reading; malformed context is refused', () => {
    const ask = make();
    expect(parsePendingAction(JSON.parse(JSON.stringify(ask)))).toEqual(ask);
    for (const key of ['from_id', 'to_id', 'from_label', 'to_label', 'quote', 'question', 'refusal']) {
      expect(parsePendingAction({ ...ask, action: { ...ask.action, [key]: '' } })).toBeNull();
    }
    expect(parsePendingAction({ ...ask, action: { ...ask.action, value_text: {} } })).toBeNull();
    for (const resolved_reading of ['points', 'relative'] as const) {
      const resolved = { ...ask, action: { ...ask.action, resolved_reading } };
      expect(parsePendingAction(JSON.parse(JSON.stringify(resolved)))).toEqual(resolved);
    }
    expect(parsePendingAction({ ...ask, action: { ...ask.action, resolved_reading: 'absolute-ish' } })).toBeNull();
    expect(linkEffectClarificationOnRefusal({ action: ask.action, message: 'I did not say those words.',
      scenarioId: SCENARIO, graph, emittedAtIso: ask.emitted_at_iso })).toBeNull();
  });

  it('Runs preserve the six-typed-turn budget and the 24-hour wall expiry', () => {
    const initial = make();
    const run = carry([initial]);
    expect(run).toEqual([initial]);
    expect(carry(run)).toEqual([initial]);
    let pending = [initial];
    for (let i = 1; i <= 5; i++) {
      pending = carry(pending, { typedByUser: true });
      expect(pending[0]?.expires_at_turn_count).toBe(6 - i);
      expect(pending[0]?.expires_at_iso).toBe(initial.expires_at_iso);
    }
    expect(carry(pending, { typedByUser: true })).toEqual([]);
    expect(carry([initial], { nowMs: Date.parse(initial.expires_at_iso) + 1 })).toEqual([]);
  });

  it('the same refused statement changes its question without renewing its lifetime', () => {
    const original = make();
    const prior = { ...original, expires_at_turn_count: 3 };
    const refreshed = { ...make(Date.parse(original.emitted_at_iso) + 1), action: { ...original.action, question: 'You said at least one point. What bound do you mean?' } };
    const result = carry([prior], { next: [refreshed], typedByUser: true });
    expect(result).toEqual([{ ...prior, action: refreshed.action, expires_at_turn_count: 2 }]);
    expect(carry([{ ...prior, expires_at_turn_count: 1 }], { next: [refreshed], typedByUser: true })).toEqual([]);
  });

  it('a newer statement supersedes only its own link, and a proposed card consumes the ask', () => {
    const original = make(Date.now() - 10);
    const replacement = make(Date.now(), 'We expect churn to rise by one percentage point for a £1 price rise.');
    expect(liveLinkEffectClarifications([original, replacement], SCENARIO, graph)).toEqual([replacement]);
    expect(carry([original], { next: [replacement], typedByUser: true })).toEqual([replacement]);
    expect(carry([replacement], { consumedLinks: [{ from_id: 'price', to_id: 'churn' }] })).toEqual([]);
  });

  it('a removed link or a user-sized link expires the context carrier', () => {
    const ask = make();
    expect(liveLinkEffectClarifications([ask], 'another-scenario', graph)).toEqual([]);
    expect(carry([ask], { graph: { ...graph, edges: [] } })).toEqual([]);
    const confounder = { ...graph.edges[0], edge_type: 'bidirected' };
    expect(carry([ask], { graph: { ...graph, edges: [graph.edges[0], confounder] } })).toEqual([ask]);
    expect(carry([ask], { graph: { ...graph, edges: [confounder] } })).toEqual([]);
    expect(carry([ask], { graph: { ...graph, edges: [graph.edges[0], graph.edges[0]] } })).toEqual([]);
    for (const provenance of [{ source: 'user_specified' }, { magnitude: 'user_stated' }]) {
      expect(carry([ask], { graph: { ...graph, edges: [{ ...graph.edges[0], provenance }] } })).toEqual([]);
    }
  });

  it('a failed graph read preserves bounded context and selects no tool answer', () => {
    const ask = make();
    for (const unknownGraph of [undefined, null, {}, { nodes: graph.nodes }, { edges: graph.edges }]) {
      expect(carry([ask], { graph: unknownGraph })).toEqual([ask]);
      expect(carry([ask], { graph: unknownGraph, typedByUser: true })).toEqual([{ ...ask, expires_at_turn_count: 5 }]);
      expect(liveLinkEffectClarifications([ask], SCENARIO, unknownGraph)).toEqual([]);
    }
    expect(carry([ask], { graph: undefined, nowMs: Date.parse(ask.expires_at_iso) + 1 })).toEqual([]);
    expect(carry([{ ...ask, expires_at_turn_count: 1 }], { graph: undefined, typedByUser: true })).toEqual([]);
    expect(linkEffectAnswerFirstCall(undefined, [ask], 'relative', false)).toBeUndefined();
  });

  it.each([
    'I reject this claim: Raising Pro plan price by £1 will increase Monthly churn rate by 5%',
    'Our supplier says raising Pro plan price by £1 will increase Monthly churn rate by 5 points.',
    'As I said, raising Pro plan price by £1 will increase Monthly churn rate by 5 points.',
  ])('any refusal of a named-link statement arms neutral context (%s)', quote => {
    const ask = make(Date.now(), quote);
    expect(ask.action.quote).toBe(quote);
    expect(liveLinkEffectClarifications([ask], SCENARIO, graph)).toEqual([ask]);
    expect(linkEffectAnswerFirstCall(state, [ask], 'points', false)).toBe(LINK_EFFECT_TOOL);
  });

  it('legacy classifications do not license figures or prevent a context-only reading reply', () => {
    const ask = make();
    const legacy = { ...ask, action: { ...ask.action, statement_classification: undefined, source_text: undefined } };
    expect(linkEffectAnswerFirstCall(state, [legacy], 'percentage points', false)).toBe(LINK_EFFECT_TOOL);
    expect(linkEffectAnswerFirstCall(state, [legacy], 'relative', false)).toBe(LINK_EFFECT_TOOL);
  });

  it('an older arriving statement never replaces newer context for the same exact link', () => {
    const older = make(Date.now() - 20, 'We expect Monthly churn rate to rise by 5 points for a £1 rise in Pro plan price.');
    const newer = make(Date.now() - 10, 'We expect Monthly churn rate to rise by 10 points for a £1 rise in Pro plan price.');
    expect(liveLinkEffectClarifications([newer, older], SCENARIO, graph)).toEqual([newer]);
    expect(carry([newer], { next: [older], typedByUser: true }))
      .toEqual([{ ...newer, expires_at_turn_count: newer.expires_at_turn_count - 1 }]);
  });

  it('selects the existing tool only for a definite reply to one unchanged canonical link', () => {
    const ask = make();
    expect(linkEffectAnswerFirstCall(state, [ask], 'points', false)).toBe(LINK_EFFECT_TOOL);
    expect(linkEffectAnswerFirstCall(state, [ask], 'one percentage point', false)).toBe(LINK_EFFECT_TOOL);
    expect(linkEffectAnswerFirstCall(state, [ask], 'relative', false)).toBe(LINK_EFFECT_TOOL);
    for (const message of ['perhaps relative', 'Is it relative?', 'Yes', 'I increased the price']) {
      expect(linkEffectAnswerFirstCall(state, [ask], message, false)).toBeUndefined();
    }
    expect(linkEffectAnswerFirstCall(state, [ask], 'relative', true)).toBeUndefined();
    expect(linkEffectAnswerFirstCall(state, [ask, ask], 'relative', false)).toBeUndefined();
    expect(linkEffectAnswerFirstCall(state, [ask, { ...ask, expires_at_turn_count: 0 }], 'relative', false)).toBe(LINK_EFFECT_TOOL);
    expect(linkEffectAnswerFirstCall(state, [ask, { ...ask, action: { ...ask.action, to_id: 'deleted' } }], 'relative', false)).toBe(LINK_EFFECT_TOOL);
    expect(linkEffectAnswerFirstCall({ ...state, links: [] }, [ask], 'relative', false)).toBeUndefined();
    expect(linkEffectAnswerFirstCall({ ...state, links: [{ ...state.links[0], sizing: 'user' }] }, [ask], 'relative', false)).toBeUndefined();
    expect(linkEffectAnswerFirstCall({ ...state, entities: [{ ...graph.nodes[0], label: 'Different price' }, graph.nodes[1]] },
      [ask], 'relative', false)).toBeUndefined();
  });
});
