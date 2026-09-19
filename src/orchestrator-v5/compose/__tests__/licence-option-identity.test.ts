import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { enforceLeadingOptionClaimsAtWire } from '../leading-option-wire-enforcement.js';
import { textAssertsLeadingOption } from '../leading-option-egress-guard.js';
function run(text: string, optionLabel?: string, licensed = false) {
  const body = JSON.parse(
    readFileSync(
      new URL('./fixtures/c2-context-response-20260907T203538Z.json', import.meta.url),
      'utf8',
    ),
  );
  body.assistant_text = text;
  if (optionLabel) body.analysis_ready.options[2].label = optionLabel;
  if (licensed)
    body.analysis_ready.analysis_admission.permitted_analysis_mode = 'comparative_leader';
  return enforceLeadingOptionClaimsAtWire(body as OlumiResponse, {
    requestId: 'independent-1d4c83e-recheck',
    exitPath: 'turn_executor',
    mayNameLeadingOption: true,
    analysisReady: body.analysis_ready,
    graph: undefined,
  }).response.assistant_text;
}
describe('Independent 1d4c83e bounded semantic counterparts, synthetic not live', () => {
  it.each([
    'We should check whether Hire a Tech Lead leads before drawing a conclusion.',
    'Hire a Tech Lead is not currently the leading option.',
  ])('preserves a non-asserting counterpart: %s', (text) => {
    expect(run(text)).toBe(text);
  });
  it('the retained goal-framed producer assertion is recognised when May is in the option label', () => {
    const text = 'Launch in May scored highest on the latest result.';
    expect(run(text, 'Launch in May')).not.toContain(text);
    expect(textAssertsLeadingOption(text)).toBe(true);
  });
  it.each([
    'Launch in May',
    'May',
    'Never',
    'If Needed',
    'No New Hire',
    'Not Currently',
    'Whether to Launch',
    'Best Option',
    'May (Phase 2)',
  ])('label contents do not change asserted or genuinely qualified meaning: %s', (label) => {
    for (const predicate of [
      'leads now.',
      'scored highest on the latest result.',
      'is the leading option.',
    ]) {
      const assertion = `${label} ${predicate}`;
      expect(run(assertion, label)).not.toBe(assertion);
      expect(run(assertion, label, true)).toBe(assertion);
    }
    for (const qualification of [
      `${label} may be the leading option.`,
      `${label} is not currently the leading option.`,
      `We should check whether ${label} leads before drawing a conclusion.`,
      `If ${label} leads after validation, test the deadline next.`,
    ]) {
      expect(run(qualification, label)).toBe(qualification);
      expect(run(qualification, label, true)).toBe(qualification);
    }
  });
  it('a label word reused as a modal stays distinct from a second actual subject', () => {
    expect(run('May may be the leading option.', 'May')).toBe('May may be the leading option.');
    const assertion = 'May leads now and May scored highest on the latest result.';
    expect(run(assertion, 'May')).not.toContain('scored highest');
    expect(run(assertion, 'May', true)).toBe(assertion);
  });
  it('ordinary name-bearing explanation is not turned into a claim by label vocabulary', () => {
    const text = 'Best Option changes onboarding assumptions, not the launch deadline.';
    expect(run(text, 'Best Option')).toBe(text);
  });
  it('context-free consumers retain their original reader; grammar requires an explicit roster', () => {
    const context = { optionLabels: ['Hire a Tech Lead', 'Launch in May'] };
    for (const text of [
      'If Hire a Tech Lead leads after validation, test the deadline next.',
      'We should check whether Hire a Tech Lead leads before drawing a conclusion.',
      'Hire a Tech Lead is not currently the leading option.',
    ]) {
      expect(textAssertsLeadingOption(text)).toBe(true);
      expect(textAssertsLeadingOption(text, context)).toBe(false);
    }
    const assertion = 'Launch in May scored highest on the latest result.';
    expect(textAssertsLeadingOption(assertion)).toBe(true);
    expect(textAssertsLeadingOption(assertion, context)).toBe(true);
  });
});
