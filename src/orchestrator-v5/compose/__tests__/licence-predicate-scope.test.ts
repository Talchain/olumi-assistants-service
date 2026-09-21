import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { enforceLeadingOptionClaimsAtWire } from '../leading-option-wire-enforcement.js';
import {
  textAssertsLeadingOption,
  textNamesLeadingOption,
} from '../leading-option-egress-guard.js';

function run(text: string, licensed = false) {
  const body = JSON.parse(
    readFileSync(
      new URL('./fixtures/c2-context-response-20260907T203538Z.json', import.meta.url),
      'utf8',
    ),
  );
  body.assistant_text = text;
  if (licensed)
    body.analysis_ready.analysis_admission.permitted_analysis_mode = 'comparative_leader';
  return enforceLeadingOptionClaimsAtWire(body as OlumiResponse, {
    requestId: 'independent-41dd19a-review',
    exitPath: 'turn_executor',
    mayNameLeadingOption: true,
    analysisReady: body.analysis_ready,
    graph: undefined,
  }).response.assistant_text;
}
describe('Independent 41dd19a mixed-clause controls, synthetic not live', () => {
  it.each([
    [
      'modal belongs to deadline',
      'The deadline may slip and the analysis shows which option leads.',
      'the analysis shows which option leads',
    ],
    [
      'negation belongs to target',
      'We have no launch target and Hire a Tech Lead leads now.',
      'Hire a Tech Lead leads now',
    ],
    [
      'postfix condition belongs to next investigation',
      'Hire a Tech Lead leads now and we should check if onboarding takes longer.',
      'Hire a Tech Lead leads now',
    ],
    [
      'No is part of the actual C2 option label',
      'Status Quo (No New Hire) leads now.',
      'Status Quo (No New Hire) leads now',
    ],
    [
      'No in option label also blocks retained 1389 vocabulary',
      'Status Quo (No New Hire) scored highest on the latest result.',
      'Status Quo (No New Hire) scored highest',
    ],
  ])('does not license an asserted comparison because %s', (_case, text, claim) => {
    expect(run(text)).not.toContain(claim);
  });
  it.each([
    'Is Hire a Tech Lead the leading option?',
    'Which option leads, Hire a Tech Lead or Two Developers?',
  ])('preserves an actual question without asserting its answer: %s', (text) => {
    expect(run(text)).toBe(text);
  });
  it('retains useful option explanation beside the implicit C2 claim', () => {
    const explanation = 'Hire a Tech Lead changes onboarding assumptions, not the launch deadline.';
    const claim = "The leading option's current advantage rests on Tech Lead Capacity.";
    const result = run(explanation + ' ' + claim);
    expect(result).not.toContain(claim);
    expect(result).toContain(explanation);
  });
  it('preserves an unambiguous conditional counterpart', () => {
    const text = 'If Hire a Tech Lead leads after validation, test the deadline next.';
    expect(run(text)).toBe(text);
  });
  it('removes an unambiguous current assertion counterpart', () => {
    expect(run('Hire a Tech Lead leads now.')).not.toContain('Hire a Tech Lead leads now');
  });
  it('instrument: alarm and assertion reader both catch exact-name claims', () => {
    for (const text of [
      'We have no launch target and Hire a Tech Lead leads now.',
      'Hire a Tech Lead leads now and we should check if onboarding takes longer.',
      'Status Quo (No New Hire) leads now.',
    ]) {
      expect(textNamesLeadingOption(text)).toBe(true);
      expect(textAssertsLeadingOption(text)).toBe(true);
    }
  });
  it.each([
    'The deadline may slip and the analysis shows which option leads.',
    'We have no launch target and Hire a Tech Lead leads now.',
    'Hire a Tech Lead leads now and we should check if onboarding takes longer.',
    'Status Quo (No New Hire) leads now.',
    'Status Quo (No New Hire) scored highest on the latest result.',
    'Is Hire a Tech Lead the leading option?',
    'Which option leads, Hire a Tech Lead or Two Developers?',
  ])('licensed counterpart is byte-identical: %s', (text) => {
    expect(run(text, true)).toBe(text);
  });
  it('overlapping vocabulary is one implicit predicate, not a reason to remove an explanation', () => {
    const explanation = 'Hire a Tech Lead changes onboarding assumptions, not the launch deadline.';
    const claim = 'The analysis shows which option leads.';
    const result = run(explanation + ' ' + claim);
    expect(result).toContain(explanation);
    expect(result).not.toContain(claim);
  });
  it('an implicit claim does not disarm existing escalation for a separate distributed claim', () => {
    const text =
      "Hire a Tech Lead is strong. It leads at 72%. The leading option's current advantage rests on capacity.";
    const result = run(text);
    expect(result).not.toContain('Hire a Tech Lead is strong');
    expect(result).not.toContain('leads at 72%');
    expect(result).not.toContain("leading option's current advantage");
    expect(run(text, true)).toBe(text);
  });
  it('a direct question remains intact beside a separately asserted implicit claim', () => {
    const question = 'Is Hire a Tech Lead the leading option?';
    const claim = "The leading option's current advantage rests on capacity.";
    const result = run(question + ' ' + claim);
    expect(result).toContain(question);
    expect(result).not.toContain(claim);
  });
  it('a question containing a relative assertion still loses that assertion', () => {
    const text = 'Should we choose Hire a Tech Lead, which leads at 72%?';
    expect(run(text)).not.toContain('leads at 72%');
  });
});
