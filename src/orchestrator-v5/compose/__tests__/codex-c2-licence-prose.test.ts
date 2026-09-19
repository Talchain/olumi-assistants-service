import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { OlumiResponseWithDebugFields } from '../../../orchestrator/debug-fields.js';
import {
  enforceLeadingOptionClaimsAtWire,
  optionRosterFromAnalysisReady,
  textNamesAnOption,
} from '../leading-option-wire-enforcement.js';
import { textAssertsLeadingOption } from '../leading-option-egress-guard.js';
import { analysisReadyPermitsLeaderNaming } from '../../admission/analysis-admission.js';

function capture(): any {
  return JSON.parse(
    readFileSync(
      new URL('./fixtures/c2-context-response-20260907T203538Z.json', import.meta.url),
      'utf8',
    ),
  );
}
function run(body: any) {
  return enforceLeadingOptionClaimsAtWire(body as OlumiResponse, {
    requestId: 'codex-c2-recovered-patch',
    exitPath: 'turn_executor',
    mayNameLeadingOption: true,
    analysisReady: body.analysis_ready,
    graph: undefined,
  });
}
describe('Codex independent C2 recovered licence patch assessment', () => {
  it('pins the native state and proves the missing exact-name condition', () => {
    const body = capture();
    expect(body._diagnostic_trace.claim_safety).toMatchObject({
      may_name_leading_option: true,
      verdict_provenance: 'scenario_fact',
    });
    expect(body.analysis_state.leader_claim.permitted).toBe(false);
    expect(body.analysis_ready.analysis_admission.permitted_analysis_mode).toBe(
      'quantified_provisional',
    );
    expect(analysisReadyPermitsLeaderNaming(body.analysis_ready)).toBe(false);
    expect(textAssertsLeadingOption(body.assistant_text)).toBe(true);
    const roster = optionRosterFromAnalysisReady(body.analysis_ready);
    expect(roster).toEqual(['Status Quo (No New Hire)', 'Two Developers', 'Hire a Tech Lead']);
    expect(textNamesAnOption(body.assistant_text, roster)).toBe(false);
  });
  it.each([
    'The analysis shows which option leads',
    "The lead's current advantage rests on Tech Lead Capacity",
    "the leading option's edge is described as sensitive",
  ])('C2 repair requirement: does not retain %s', (claim) => {
    const result = run(capture());
    expect(result.response.assistant_text).not.toContain(claim);
  });
  it('C2 useful context remains available', () => {
    const result = run(capture());
    expect(result.response.assistant_text).toContain(
      "Your model doesn't yet capture technical debt or a launch deadline",
    );
    expect(result.response.assistant_text).toContain("Technical debt isn't named as a factor");
  });
  it('projects both native surfaces without conflating the distinct permission authorities', () => {
    const body = capture();
    const result = run(body);
    expect(result.blocksProjected).toBe(true);
    expect(result.editedFields).toEqual(['assistant_text']);
    expect(result.response.assistant_text).not.toBe(body.assistant_text);
    expect(result.response.analysis_state).toBe(body.analysis_state);
    expect(
      (result.response as OlumiResponseWithDebugFields)._diagnostic_trace,
    ).toBe(body._diagnostic_trace);
  });
  it.each([
    [
      'conditional mechanism',
      'If Hire a Tech Lead reduces technical debt, delivery could improve; that is an assumption to test, not an established advantage.',
    ],
    [
      'tie or insufficient separation',
      'Hire a Tech Lead and Two Developers are not meaningfully separated, so neither can be put forward.',
    ],
    [
      'ordinary explanation',
      'Hire a Tech Lead changes the capacity and onboarding assumptions; the model does not yet represent technical debt.',
    ],
    [
      'ordinary causal language',
      'Higher capacity leads to faster delivery, but the missing deadline remains a separate question.',
    ],
    [
      'explicit conditional comparative statement, synthetic control',
      'If Hire a Tech Lead leads after its assumptions are validated, we should then test the launch deadline.',
    ],
    [
      'explicit negated tie statement, synthetic control',
      'Neither Hire a Tech Lead nor Two Developers leads reliably; their outcomes overlap.',
    ],
    [
      'implicit hypothetical',
      "If the leading option's edge survives validation, test its onboarding cost next.",
    ],
    [
      'negated implicit result',
      'The analysis does not show which option leads; the outcomes overlap.',
    ],
    [
      'modal hypothetical',
      'Hire a Tech Lead could be the leading option after assumptions are validated.',
    ],
    ['generic discussion prompt', 'Explore the leading option and the factors shaping it.'],
  ])('preserves useful %s unchanged', (_label, prose) => {
    const body = capture();
    body.assistant_text = prose;
    expect(run(body).response.assistant_text).toBe(prose);
  });
  it.each([
    'If costs fall, test the deadline. The analysis shows which option leads.',
    'Neither option is proven, but the analysis shows which option leads.',
    'There is no doubt that Hire a Tech Lead leads on the current model.',
    'Hire a Tech Lead leads, but this is not stable.',
    'Hire a Tech Lead scored highest against your goal.',
  ])('does not let a separate qualification hide an assertion: %s', (prose) => {
    const body = capture();
    body.assistant_text = prose;
    expect(run(body).response.assistant_text).not.toBe(prose);
  });
  it('the identical native response remains by-reference when actually licensed', () => {
    const body = capture();
    body.analysis_ready.analysis_admission.permitted_analysis_mode = 'comparative_leader';
    expect(run(body).response).toBe(body);
  });
  it('preserves the full useful debt reasoning and the explicit next question', () => {
    const body = capture();
    const text = run(body).response.assistant_text;
    expect(text).toContain(
      'a hands-on lead tackling debt is a different mechanism than one adding raw capacity',
    );
    expect(text).toContain("Your team's self-management changes the mechanism this model assumes");
    expect(text).toContain(
      "Would it help to talk through how to represent 'paying down technical debt' as its own factor, or to set a launch deadline as the target first?",
    );
  });
});
