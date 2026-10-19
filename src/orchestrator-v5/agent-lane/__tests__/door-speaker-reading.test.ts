/**
 * ⭐ WHOSE CLAIM: THE AI'S SPEAKER READING AT THE DOOR (DL-3 decision outbox/DL-DECISION-QUOTE-SPEAKER-20261019 on Codex #3436 R3; AIE
 * `speaker_answer`, prompt/AIE-SPEAKER-CARRIER-AND-UNCERTAINTY-SUPPORT-20261019-v1.json). An instruction verb in front of a quote is no
 * proof of who made the claim, so no prefix rule decides it: the door passes the AI's existing `QUOTE_SPEAKER` reading, and the one
 * reader verifies the figure itself. `other` and `unknown` are never the user's; `user` opens ONLY a quotation that is exactly the
 * bound entity's name; no reading keeps the one speaker rule. Generated: currency × quote style × lead × speaker. SYNTHETIC wording.
 */
import { describe, expect, it } from 'vitest';
import { figureOnlyInQuotation, figureTheUserWroteFor, figureTheUserWroteForSpan } from '../stated-by-user.js';
import { AGENT_TOOLS, DOOR_SPEAKER_WORDS } from '../runtime/agent-tools.js';
import { QUOTE_SPEAKER_WORDS } from '../user-statements.js';

const PRICES: [string, string, number][] = [['£', 'GBP per month', 59], ['$', 'USD per month', 49], ['€', 'EUR per month', 120]];
const QUOTES: [string, string][] = [['"', '"'], ['“', '”'], ["'", "'"], ['‘', '’']];
// Leads of every kind: the user's own instruction, a party's report, an adoption of a party's or Olumi's figure. The verdict never
// depends on the lead: only on the AI's speaker reading (and the reader's own checks).
const LEADS = ['Let’s add the grandfathering of existing customers: ', 'Add the option ', 'Please add ', 'Our CFO said: ',
  'Add it, as the CFO said: ', 'Add our CFO’s figure: ', 'Olumi suggested: '];
const SPEAKERS = ['user', 'other', 'unknown', undefined] as const;

describe('the reader: the AI\'s speaker reading decides whose claim a quoted entity name\'s figure is', () => {
  it('user opens the exact bound name; other, unknown and no reading never credit it', () => {
    let rows = 0;
    for (const [sym, unit, v] of PRICES) for (const [open, close] of QUOTES) for (const lead of LEADS) for (const speaker of SPEAKERS) {
      const name = `${sym}${v} for new Pro customers; grandfather existing customers`;
      const scope = { target: ['New Pro customer price', name], others: ['Pro plan price', 'MRR', 'Monthly churn'], ...(speaker === undefined ? {} : { speaker }) };
      const said = (inner: string): string => `${lead}${open}${inner}${close}.`;
      expect(figureTheUserWroteFor(v, unit, said(name), scope), `${speaker} | ${said(name)}`).toBe(speaker === 'user' && !lead.startsWith('Olumi'));
      // Never a longer quotation, nor another entity's name, whatever the reading.
      expect(figureTheUserWroteFor(v, unit, said(`${name} is what we should do`), scope), 'longer after').toBe(false);
      expect(figureTheUserWroteFor(v, unit, said(`we think ${name}`), scope), 'longer before').toBe(false);
      expect(figureTheUserWroteFor(v, unit, said(name), { ...scope, target: ['New Pro customer price'] }), 'not the bound name').toBe(false);
      rows += 1;
    }
    expect(rows).toBe(PRICES.length * QUOTES.length * LEADS.length * SPEAKERS.length);
  });

  it('other and unknown are never the user\'s, even for the user\'s own unquoted words', () => {
    const scope = { target: ['Night shift hours'], others: ['Day shift hours'] };
    const text = 'Night shift hours are 45 hours per week.';
    expect(figureTheUserWroteFor(45, 'hours per week', text, scope), 'no reading').toBe(true);
    expect(figureTheUserWroteFor(45, 'hours per week', text, { ...scope, speaker: 'user' })).toBe(true);
    for (const speaker of ['other', 'unknown'] as const) expect(figureTheUserWroteFor(45, 'hours per week', text, { ...scope, speaker }), speaker).toBe(false);
  });

  it('user binds the figure INSIDE the quoted name, never a party\'s earlier quotation of the same price', () => {
    const name = '£59 for new Pro customers; grandfather existing customers';
    const text = `Our CFO said: "£59 for new Pro customers is too much". Add the option "${name}".`;
    expect(figureTheUserWroteForSpan(59, 'GBP per month', text, { target: ['New Pro customer price', name], others: ['MRR'], speaker: 'user' })?.start)
      .toBe(text.lastIndexOf('£59'));
  });

  it('the ask names the quotation: a figure the message holds only inside quoted words', () => {
    expect(figureOnlyInQuotation(59, 'GBP per month', 'Our CFO said: "£59 for new Pro customers".')).toContain('£59');
    expect(figureOnlyInQuotation(59, 'GBP per month', 'We charge £59 for new Pro customers.')).toBeNull();
  });
});

describe('the tool schemas: the existing QUOTE_SPEAKER field and the AIE\'s exact door words at every option-level and limit door', () => {
  const tool = (name: string) => AGENT_TOOLS.find((t) => t.name === name) as { parameters: Record<string, any> } | undefined;
  const DOOR = `${QUOTE_SPEAKER_WORDS} ${DOOR_SPEAKER_WORDS}`;
  it.each([
    ['propose_new_option', (p: Record<string, any>) => p.properties.acts_on.items.properties.level.properties.speaker],
    ['propose_new_option (options)', (p: Record<string, any>) => p.properties.options.items.properties.acts_on.items.properties.level.properties.speaker],
    ['propose_option_interventions', (p: Record<string, any>) => p.properties.interventions.items.properties.speaker],
    ['propose_starting_point', (p: Record<string, any>) => p.properties.option_levels.items.properties.speaker],
    ['propose_new_limit', (p: Record<string, any>) => p.properties.speaker],
    ['propose_limit_change', (p: Record<string, any>) => p.properties.speaker],
  ])('%s carries speaker with the existing enum and the exact words', (name, at) => {
    const speaker = at(tool(name.split(' ')[0]!)!.parameters);
    expect(speaker).toEqual({ type: 'string', enum: ['user', 'other', 'unknown'], description: DOOR });
  });
  it('the AIE\'s door words are byte for byte the packet\'s', () => {
    expect(DOOR_SPEAKER_WORDS).toBe('Use the shared speaker reading for the particular figure’s original claim, with its complete source, subject, unit, reference, period and conditions. Asking to add or adopt another person’s figure does not change who originally asserted it. Approval records the user’s authorised setting or limit; it does not verify the underlying claim or transfer its authorship. An estimate flag or user-stated flag alone is not source evidence. Never turn a reported or unknown-origin figure into a new Olumi estimate merely to fit a flag. If the existing door cannot retain both the authorised choice and its original source truthfully, retain the source and return the actual limitation or clarification instead of recording false authorship.');
  });
});
