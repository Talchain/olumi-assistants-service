/**
 * ⭐ AN OPERAND AN OPTION CREATES IS 0 TODAY — NEVER "WHAT IS IT TODAY?" (Science d5 #87 6007736377; DL 6 Oct).
 *
 * Served (Acceptance rehearsal 14, CEE 6ce136c, full wire): the T1b Run returned "I need ‘Starter-tier subscribers’: what is it
 * today?" for a tier the brief says has not launched (the launch would win about 150, between 80 and 250). Creation evidence
 * only: a stored typed 0, or a creation verb in the option's label; an option that merely targets the operand ("Offer a 10%
 * discount") is still asked about today. Bound by node id and Science's exact words.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { composeIdentityAskForNode, composeIdentityNotEvaluatedAsk, LEVEL_WRITER_KINDS } from '../identity-not-evaluated-ask.js';
import { SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS } from '../../tools/handlers/set-factor-value.js';

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

/**
 * ⛔ NEVER ASK A LEVEL NO CONTROL CAN SAVE (DL 6 Oct, P1). Served: Acceptance G1 draft 11 (scenario fa05dd14, CEE 231affbe,
 * full wire): the brief's "£6 a month in support" per starter subscriber was declared the user's product, over an OUTCOME
 * ‘Starter subscribers’ with no level. Every Run was refused and asked "I need ‘Starter subscribers’: what is it today?";
 * "None today… about 150 if it launches" got "The available controls cannot save today's count for that outcome", then the
 * same ask after every Run ×3.
 */
describe('draft 11: no level is asked that no control can save', () => {
  const served = (): Rec => structuredClone(JSON.parse(readFileSync(new URL('./fixtures/served-g1-draft11-231affbe.json', import.meta.url), 'utf8')).draft_graph);
  const missing: Rec[] = [{ code: 'IDENTITY_NOT_EVALUATED',
    identity: { node_id: 'starter_tier_support_cost', participants: ['starter_subscribers', 'support_cost_per_starter_subscriber'], withheld_reason: 'identity_operand_missing' } }];

  it('PRECONDITION (served): the part is an OUTCOME with no level, the product is stated, and Launch reaches it', () => {
    const g = served();
    const part = g.nodes.find((n: Rec) => n.id === 'starter_subscribers');
    expect(part).toMatchObject({ kind: 'outcome', label: 'Starter subscribers' });
    expect(part.observed_state).toBeUndefined();
    expect(g.nodes.find((n: Rec) => n.id === 'starter_tier_support_cost').nonlinear_identity).toMatchObject({ operation: 'product', stated_in_brief: true });
  });

  it('RED (served draft 11): the refused Run asks NOTHING about ‘Starter subscribers’ — no "what is it today?", no chip that cannot save', () => {
    expect(composeIdentityNotEvaluatedAsk(missing, served())).toBeNull();
  });

  it('CONTROL: the same part as a FACTOR (a writer can save it) is still asked — "0 today, since Launch would start it"', () => {
    const g = served();
    g.nodes.find((n: Rec) => n.id === 'starter_subscribers').kind = 'factor';
    const a = composeIdentityNotEvaluatedAsk(missing, g)!;
    expect(a.assistant_text).toContain('‘Starter subscribers’ is 0 today, since ‘Launch starter tier’ would start it.');
    // The brief already sized what the launch brings (‘Starter tier launched’ → ‘Starter subscribers’, 150): never asked again.
    expect(a.assistant_text).not.toMatch(/How many|today\?/);
    expect(a.chip_label).toBe('Use 0 today');
  });

  it('CONTROL: with that link unsized, the factor part is asked Science\'s ONE question', () => {
    const g = served();
    g.nodes.find((n: Rec) => n.id === 'starter_subscribers').kind = 'factor';
    const e = g.edges.find((x: Rec) => x.from === 'starter_tier_launched' && x.to === 'starter_subscribers');
    delete e.provenance.natural_effect;
    expect(composeIdentityNotEvaluatedAsk(missing, g)!.assistant_text)
      .toContain('How many ‘Starter subscribers’ would ‘Launch starter tier’ lead to? A best guess and a range is fine.');
  });

  it('RED (after construction holds it at 0): #416 on the stored model asks nothing — with no stated level on the product, 0 is an ordinary level (ISL rule 3)', () => {
    const g = served();
    g.nodes.find((n: Rec) => n.id === 'starter_subscribers').observed_state = { value: 0, source: 'cee_inference', extractionType: 'inferred' };
    expect(composeIdentityAskForNode('starter_tier_support_cost', g)).toBeNull();
  });

  it('RED: a FACTOR part at Olumi\'s 0 under a product with NO stated level → #416 infers nothing (0 is an ordinary level there)', () => {
    const g = served();
    g.nodes.find((n: Rec) => n.id === 'starter_subscribers').kind = 'factor';
    g.nodes.find((n: Rec) => n.id === 'starter_subscribers').observed_state = { value: 0, source: 'cee_inference' };
    expect(composeIdentityAskForNode('starter_tier_support_cost', g)).toBeNull();
  });

  it('CONTROL: a product WITH a stated level still asks about a zero part (ISL withholds that one)', () => {
    const g = served();
    g.nodes.find((n: Rec) => n.id === 'starter_subscribers').kind = 'factor';
    g.nodes.find((n: Rec) => n.id === 'starter_subscribers').observed_state = { value: 0, source: 'cee_inference' };
    g.nodes.find((n: Rec) => n.id === 'starter_tier_support_cost').observed_state = { value: 0.036, raw_value: 900, unit: '£/month', source: 'brief_extraction' };
    expect(composeIdentityAskForNode('starter_tier_support_cost', g)).toMatchObject({ reason: 'identity_zero_level' });
  });

  it('RED: ISL\'s zero-level refusal over an OUTCOME part → no "Is 0 right?" (no control can correct that 0)', () => {
    const g = served();
    g.nodes.find((n: Rec) => n.id === 'starter_subscribers').observed_state = { value: 0, source: 'cee_inference' };
    g.nodes.find((n: Rec) => n.id === 'starter_tier_support_cost').observed_state = { value: 0.036, raw_value: 900, unit: '£/month', source: 'brief_extraction' };
    const zero: Rec[] = [{ code: 'IDENTITY_NOT_EVALUATED',
      identity: { node_id: 'starter_tier_support_cost', participants: ['starter_subscribers', 'support_cost_per_starter_subscriber'], withheld_reason: 'identity_zero_level' } }];
    expect(composeIdentityNotEvaluatedAsk(zero, g)).toBeNull();
    g.nodes.find((n: Rec) => n.id === 'starter_subscribers').kind = 'factor';
    expect(composeIdentityNotEvaluatedAsk(zero, g)).toMatchObject({ reason: 'identity_zero_level' });
  });

  it('PARITY: the kinds a level is asked of are exactly the kinds set_factor_value can save', () => {
    expect([...LEVEL_WRITER_KINDS]).toEqual([...SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS]);
  });
});
