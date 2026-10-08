/**
 * ⛔ B1 BLOCKER (Paul's golden brief, scenario 828d87ac, 8 Oct): the card "Olumi reads ‘MRR’ as ‘Pro plan price’ ×
 * ‘Pro paying subscribers’" was offered while ‘Pro paying subscribers’ had no level; the Yes recorded it and both Runs
 * refused `identity_operand_missing`. The fix: the sole writer refuses a Yes over a part with no level, and every door
 * that offers the card asks the same predicate, so the card is never offered where its Yes would be refused.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { proposeProductIdentity } from '../../agent-lane/identity-proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import {
  applyIdentityConfirmEdit, identityCardOfferable, identityConfirmReadingToken, identityPartLevelAsk, identityPartsWithoutLevel,
} from '../identity-confirm-edit.js';

type Rec = Record<string, any>;
const stored = JSON.parse(readFileSync(resolve(process.cwd(), 'src/orchestrator-v5/system-events/__tests__/fixtures/b1-828d87ac-stored-graph.json'), 'utf8')) as Rec;
/** The graph as it stood when the card was offered: Olumi's reading, not yet the user's (the only change the Yes made). */
const beforeYes = (g: Rec = stored): Rec => ({ ...g, nodes: g.nodes.map((n: Rec) => (n.id === 'mrr'
  ? { ...n, nonlinear_identity: { ...n.nonlinear_identity, stated_in_brief: false } } : n)) });
/** 9f32a4b4 (B1, another draw): the count is a FACTOR with an Olumi-inferred level (250), Olumi's reading still unconfirmed. */
const inferred = JSON.parse(readFileSync(resolve(process.cwd(), 'src/orchestrator-v5/system-events/__tests__/fixtures/b1-9f32a4b4-stored-graph.json'), 'utf8')) as Rec;

const pressYes = (g: Rec) => {
  const card = proposeProductIdentity(g);
  expect(card, 'the stored reading is the card the user saw').not.toBeNull();
  return applyIdentityConfirmEdit({ persistedGraph: g, outcome_id: card!.outcome_id, factor_ids: card!.factor_ids, words: card!.words,
    expected_graph_hash: computeAnalysisAffectingGraphHash(g as never), reading_token: identityConfirmReadingToken(card!) });
};

describe('no Yes over a part with no level (stored 828d87ac)', () => {
  it('⭐ RED: the Yes is refused, saying why, and nothing is written', () => {
    const r = pressYes(beforeYes());
    expect(r.kind).toBe('refused');
    expect(r.kind === 'refused' && r.reason).toBe('operand_level_missing');
    // An OUTCOME has no level writer (`LEVEL_WRITER_KINDS`), so the user is never invited to give a figure Olumi can't save.
    expect(r.kind === 'refused' && r.detail).toBe('Olumi can’t work out ‘MRR’ as ‘Pro plan price’ × ‘Pro paying subscribers’ yet: '
      + '‘Pro paying subscribers’ has no figure in the model, and Olumi can’t record one for it yet, so there is nothing for you to confirm.');
  });

  it('⭐ RED: no door offers the card (the Run hint and the re-offer read the same predicate)', () => {
    expect(identityPartsWithoutLevel(beforeYes(), ['pro_plan_price', 'pro_paying_subscribers']).map((p) => p.label)).toEqual(['Pro paying subscribers']);
    expect(identityCardOfferable(beforeYes())).toBe(false);
  });

  it('⭐ RED (stored 9f32a4b4): Olumi\'s basis-less 250 is MISSING: no card, the Yes is refused, and the count is asked blank', () => {
    expect(identityCardOfferable(inferred)).toBe(false);
    const r = pressYes(inferred);
    expect(r.kind === 'refused' && r.reason).toBe('operand_level_missing');
    // A FACTOR's level can be saved, so it is asked; the 250 is never offered as the answer.
    expect(r.kind === 'refused' && r.detail)
      .toBe('To work out ‘MRR’ as ‘Pro monthly price’ × ‘Pro paying subscribers’, I need ‘Pro paying subscribers’: what is it today?');
    expect(r.kind === 'refused' && r.detail).not.toMatch(/250/);
  });

  it('CONTRAST: the same count as the USER\'s figure is a level: the card is offered, the Yes writes, and their figure is untouched', () => {
    const users = { ...inferred, nodes: inferred.nodes.map((n: Rec) => (n.id === 'pro_paying_subscribers'
      ? { ...n, observed_state: { unit: 'subscribers', value: 0.15, raw_value: 300, source: 'user_override' } } : n)) };
    expect(identityCardOfferable(users)).toBe(true);
    const r = pressYes(users);
    expect(r.kind).toBe('mutated');
    expect((r as { mutatedGraph: Rec }).mutatedGraph.nodes.find((n: Rec) => n.id === 'pro_paying_subscribers').observed_state)
      .toEqual(users.nodes.find((n: Rec) => n.id === 'pro_paying_subscribers').observed_state);
  });

  it('a FACTOR part with no level is asked for, since its answer can be saved', () => {
    expect(identityPartLevelAsk('MRR', ['Pro plan price', 'Paying subscribers'], [{ label: 'Paying subscribers', kind: 'factor' }]))
      .toBe('To work out ‘MRR’ as ‘Pro plan price’ × ‘Paying subscribers’, I need ‘Paying subscribers’: what is it today?');
  });
});
