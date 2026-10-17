import { describe, it, expect } from 'vitest';
import { withoutUnsizedLinkInvitation, unsizedLinkSentence, UNSIZED_PATH_LEADER_CAUSE_KEY } from '../unsized-path-cause.js';
import { withoutDisclosure, disclosuresFor, withDisclosures, PLACEHOLDER_STRENGTH_DISCLOSURE } from '../disclosure.js';

describe('Olumi discloses a placeholder, not the Agent', () => {
  it('discloses when a write used a placeholder strength', () => {
    const owed = disclosuresFor([{ mutated: true, placeholder_strength: true }]);
    expect(owed).toEqual([PLACEHOLDER_STRENGTH_DISCLOSURE]);
    expect(owed[0]).toMatch(/not yours/);
    expect(owed[0]).toMatch(/should not be read as a measurement/);
  });

  it('says NOTHING when the write carried a stated strength', () => {
    expect(disclosuresFor([{ mutated: true, placeholder_strength: false }])).toEqual([]);
  });

  it('says NOTHING when nothing was written, even if a proposal used a placeholder', () => {
    expect(disclosuresFor([{ mutated: false, placeholder_strength: true }])).toEqual([]);
  });

  it('says NOTHING on a read-only turn — a disclosure on every turn is noise', () => {
    expect(disclosuresFor([{ mutated: false }, { mutated: false }])).toEqual([]);
  });

  it('appends without rewriting the Agent’s own words', () => {
    const agentText = 'Added the link between policy and churn.';
    const out = withDisclosures(agentText, [PLACEHOLDER_STRENGTH_DISCLOSURE]);
    expect(out.startsWith(agentText)).toBe(true);
    expect(out).toContain(PLACEHOLDER_STRENGTH_DISCLOSURE);
  });

  it('stands alone when the Agent said nothing', () => {
    expect(withDisclosures('', [PLACEHOLDER_STRENGTH_DISCLOSURE])).toBe(PLACEHOLDER_STRENGTH_DISCLOSURE);
  });

  it('returns the text untouched when nothing is owed', () => {
    expect(withDisclosures('hello', [])).toBe('hello');
  });
});


describe('AIE-04: missing Run disclosures are repaired without repeated prose', () => {
  const scope = 'Static model; not a forecast to a date.';
  const risk = 'The chance leaves out hiring delay.';
  it('repairs a composite disclosure one missing sentence at a time', () => {
    const answer = `A current finding. **${scope}** A useful next step.`;
    expect(withDisclosures(answer, [`${scope} ${risk}`], { missingSentencesOnly: true }))
      .toBe(`${answer}\n\n${risk}`);
  });
  it.each([
    `It is not true that ${scope}`, `If ${scope}`, 'Static model; a forecast to a date.',
  ])('a negation, condition or changed negative cannot discharge the scope obligation: %s', answer => {
    expect(withDisclosures(answer, [scope], { missingSentencesOnly: true })).toBe(`${answer}\n\n${scope}`);
  });
});


describe('AIE-04: the recorded cause separates qualification from its stock task', () => {
  const cause = { from: 'f', to: 'g', from_label: 'Ramp-up shortfall', to_label: 'Weekly support capacity' };
  const full = unsizedLinkSentence([cause]);
  const run = { enrichment: { [UNSIZED_PATH_LEADER_CAUSE_KEY]: cause } };
  it('retains the exact cause and its negative, removing only the stock invitation', () => {
    const step = 'Compare this assumption with the latest customer evidence.';
    expect(withoutUnsizedLinkInvitation(`${full} ${step}`, run))
      .toBe(`${full.replace(' Set it to see how much it matters.', '')} ${step}`);
  });
  it('missing recorded cause cannot authorise removing a task or condition', () => {
    expect(withoutUnsizedLinkInvitation(full, {})).toBe(full);
    const conditional = `Unless you set it, the link remains unsized. ${full}`;
    expect(withoutUnsizedLinkInvitation(conditional, {})).toBe(conditional);
  });
});


describe('owned disclosure removal retains reasoning and removes only emptied formatting', () => {
  const note = 'Static model; not a forecast to a date.';
  it('removes only a label whose owned list was emptied; an independent negative keeps its section', () => {
    expect(withoutDisclosure(`The implication stays.\n\n**Conditions:**\n- ${note}\n\nA useful move.`, note, { keep: 0 }))
      .toBe('The implication stays.\nA useful move.');
    const negative = 'Do not treat this as a forecast.';
    expect(withoutDisclosure(`Conditions:\n- ${note}\n- ${negative}`, note, { keep: 0 }))
      .toBe(`Conditions:\n- ${negative}`);
  });
  it('removes its empty bullet, leaving independent reasoning and negatives verbatim', () => {
    const text = `A conditional finding.\n- ${note}\n- Do not treat this as measured evidence.\n- \nA separate thought.`;
    expect(withoutDisclosure(text, note, { keep: 0 })).toBe('A conditional finding.\n- Do not treat this as measured evidence.\n- \nA separate thought.');
  });
  it('only a supplied current option label may leave with its emptied disclosure', () => {
    const text = `- **Carry on:** ${note}\n- **Other condition:** ${note}`;
    const result = withoutDisclosure(text, note, { keep: 0, emptyLabels: ['Carry on'] });
    expect(result).not.toContain('Carry on');
    expect(result).toContain('Other condition');
  });
  it('a quoted user sentence remains intact even when its surrounding format matches', () => {
    const source = `- **Carry on:** ${note}`;
    expect(withoutDisclosure(source, note, { keep: 0, emptyLabels: ['Carry on'], protectedTexts: [source] })).toBe(source);
  });
});
