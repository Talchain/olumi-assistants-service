/**
 * ⭐ AN OPERAND AN OPTION CREATES IS 0 TODAY — NEVER "WHAT IS IT TODAY?" (Science d5 #87 6007736377; DL 6 Oct).
 *
 * Served (Acceptance rehearsal 14, CEE 6ce136c, full wire): the T1b Run returned "I need ‘Starter-tier subscribers’: what is it
 * today?" for a tier the brief says has not launched (the launch would win about 150, between 80 and 250). Creation evidence
 * only: a stored typed 0, or a creation verb in the option's label; an option that merely targets the operand ("Offer a 10%
 * discount") is still asked about today. Bound by node id and Science's exact words.
 */
import { describe, it, expect } from 'vitest';
import { composeIdentityAskForNode, composeIdentityNotEvaluatedAsk } from '../identity-not-evaluated-ask.js';

type Rec = Record<string, any>;
const FORMULA = '“Starter-tier subscribers” × “Starter monthly price”';
const critique = (reason: string): Rec[] => [{ code: 'IDENTITY_NOT_EVALUATED',
  identity: { node_id: 'starter_mrr', participants: ['starter_subscribers', 'starter_price'], withheld_reason: reason } }];
const t1b = (option: string, sets: Rec | null): Rec => ({
  nodes: [
    { id: 'starter_mrr', kind: 'outcome', label: 'Starter-tier MRR', observed_state: { value: 0, unit: 'GBP per month' },
      nonlinear_identity: { operation: 'product', factor_ids: ['starter_subscribers', 'starter_price'] } },
    { id: 'starter_subscribers', kind: 'factor', label: 'Starter-tier subscribers' },
    { id: 'starter_price', kind: 'factor', label: 'Starter monthly price', observed_state: { value: 49, unit: 'GBP per month' } },
    { id: 'keep', kind: 'option', label: 'Keep pricing as it is', is_baseline: true },
    { id: 'opt', kind: 'option', label: option, ...(sets === null ? {} : { interventions: { starter_subscribers: sets } }) },
  ],
  edges: [
    { from: 'opt', to: 'starter_subscribers' }, { from: 'keep', to: 'starter_price' },
    { from: 'starter_subscribers', to: 'starter_mrr' }, { from: 'starter_price', to: 'starter_mrr' },
  ],
});
const LEVEL = { value: 0.3, raw_value: 150, unit: 'subscribers', source: 'brief_extraction' };

describe('identity_operand_missing: an operand the option CREATES', () => {
  it('RED (rehearsal 14): "Launch starter tier" with its level stated → 0 today, said once, and NO "what is it today?"', () => {
    const a = composeIdentityNotEvaluatedAsk(critique('identity_operand_missing'), t1b('Launch starter tier', LEVEL))!;
    expect(a.assistant_text).toBe(`To work out “Starter-tier MRR” as ${FORMULA}: ‘Starter-tier subscribers’ is 0 today, since ‘Launch starter tier’ would start it.`);
    expect(a.assistant_text).not.toMatch(/today\?/);
    expect(a).toMatchObject({ reason: 'identity_operand_missing', node_id: 'starter_mrr', chip_label: 'Use 0 today',
      chip_message: 'Set ‘Starter-tier subscribers’ to 0 today: ‘Launch starter tier’ would start it.' });
  });

  it('RED: the option\'s own level missing → Science\'s ONE question ("How many … would … lead to?"), never "win"', () => {
    const a = composeIdentityNotEvaluatedAsk(critique('identity_operand_missing'), t1b('Introduce a Starter tier', null))!;
    expect(a.assistant_text).toBe(`To work out “Starter-tier MRR” as ${FORMULA}: ‘Starter-tier subscribers’ is 0 today, since ‘Introduce a Starter tier’ would start it. `
      + 'How many ‘Starter-tier subscribers’ would ‘Introduce a Starter tier’ lead to? A best guess and a range is fine.');
    expect(a.assistant_text).not.toMatch(/\bwin\b|today\?/);
    expect(a.chip_message).toBe('How many ‘Starter-tier subscribers’ would ‘Introduce a Starter tier’ lead to? A best guess and a range is fine. Ask me for it.');
  });

  it('"How much" for money', () => {
    const g = t1b('Start a referral scheme', null);
    g.nodes[1].observed_state = { unit: 'GBP per month' };
    expect(composeIdentityNotEvaluatedAsk(critique('identity_operand_missing'), g)!.assistant_text)
      .toContain('How much ‘Starter-tier subscribers’ would ‘Start a referral scheme’ lead to?');
  });

  it('CONTROL (Science mutant): an option that only TARGETS it ("Offer a 10% discount") is no creation — today is still asked', () => {
    const a = composeIdentityNotEvaluatedAsk(critique('identity_operand_missing'), t1b('Offer a 10% discount', LEVEL))!;
    expect(a.assistant_text).toBe(`To work out “Starter-tier MRR” as ${FORMULA}, I need “Starter-tier subscribers”: what is it today?`);
    expect(a.assistant_text).not.toContain('is 0 today');
  });

  it('CONTROL: the status quo never creates it, whatever its label says', () => {
    const g = t1b('Raise prices 10%', null);
    g.nodes[3].label = 'Start nothing new'; g.edges.push({ from: 'keep', to: 'starter_subscribers' });
    expect(composeIdentityNotEvaluatedAsk(critique('identity_operand_missing'), g)!.assistant_text).toContain('what is it today?');
  });
});

describe('identity_zero_level: a STORED typed 0 is creation evidence', () => {
  it('RED: a stored 0 an option reaches → 0 today since that option would start it, never "Is 0 right?"', () => {
    const g = t1b('Offer a 10% discount', null);
    g.nodes[1].observed_state = { value: 0, unit: 'subscribers' };
    const a = composeIdentityNotEvaluatedAsk(critique('identity_zero_level'), g)!;
    expect(a.assistant_text).toBe(`To work out “Starter-tier MRR” as ${FORMULA}: ‘Starter-tier subscribers’ is 0 today, since ‘Offer a 10% discount’ would start it. `
      + 'How many ‘Starter-tier subscribers’ would ‘Offer a 10% discount’ lead to? A best guess and a range is fine.');
  });

  it('CONTROL: a stored 0 no option reaches keeps the existing "Is 0 right?" ask', () => {
    const g = t1b('Raise prices 10%', null);
    g.edges = g.edges.filter((e: Rec) => e.from !== 'opt');
    g.nodes[1].observed_state = { value: 0, unit: 'subscribers' };
    expect(composeIdentityNotEvaluatedAsk(critique('identity_zero_level'), g)!.assistant_text).toContain('Is 0 right, or what is it?');
  });
});

describe('Codex buddy r1', () => {
  it('P1: "Keep the new pricing" is no creation — "new" counts only as the option\'s own opening word', () => {
    expect(composeIdentityNotEvaluatedAsk(critique('identity_operand_missing'), t1b('Keep the new pricing', LEVEL))!.assistant_text).toContain('what is it today?');
    expect(composeIdentityNotEvaluatedAsk(critique('identity_operand_missing'), t1b('New starter tier', LEVEL))!.assistant_text).toContain('is 0 today, since ‘New starter tier’ would start it.');
  });

  it('P1: creation is judged PER operand — the created one is 0 today, the other is still asked about today', () => {
    const g = t1b('Launch starter tier', LEVEL);
    delete g.nodes[2].observed_state;
    expect(composeIdentityNotEvaluatedAsk(critique('identity_operand_missing'), g)!.assistant_text).toBe(
      `To work out “Starter-tier MRR” as ${FORMULA}: ‘Starter-tier subscribers’ is 0 today, since ‘Launch starter tier’ would start it. `
      + 'I also need “Starter monthly price”: what is it today?');
  });

  it('P1: two creators, one with its level and one without — the missing level is asked in EITHER node order', () => {
    const g = t1b('Launch starter tier', null);
    g.nodes.push({ id: 'intro', kind: 'option', label: 'Introduce a Starter tier', interventions: { starter_subscribers: LEVEL } });
    g.edges.push({ from: 'intro', to: 'starter_subscribers' });
    const reversed = { ...g, nodes: [...g.nodes].reverse() };
    for (const graph of [g, reversed]) {
      expect(composeIdentityNotEvaluatedAsk(critique('identity_operand_missing'), graph)!.assistant_text)
        .toContain('How many ‘Starter-tier subscribers’ would ‘Launch starter tier’ lead to? A best guess and a range is fine.');
    }
  });

  it('P2: #416 on an identity whose NODE has no unit asks for that unit', () => {
    const g = t1b('Raise prices 10%', null);
    g.nodes[0].observed_state = { value: 0 };
    g.nodes[1].observed_state = { value: 150, unit: 'subscribers' };
    expect(composeIdentityAskForNode('starter_mrr', g)).toMatchObject({ reason: 'identity_frame_missing', chip_label: 'Give its unit' });
  });
});
