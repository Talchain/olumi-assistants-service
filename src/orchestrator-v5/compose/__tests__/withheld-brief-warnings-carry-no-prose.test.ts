/**
 * F2 §licence — A WITHHELD LEADER'S IDENTITY NEVER ENTERS A TEXT PATH, AND PLoT'S BRIEF WARNINGS WERE ONE.
 *
 * SERVED (Paul's 1 Oct manual test, scenario 96c6f5f4, Run 09:48:47Z on CEE 8943c320; the fixture is that Run's
 * `analysis_result` block, trimmed): `analysis_state.leader_claim` is `{ permitted: false, withheld_reason:
 * 'constraint_verdict_withheld' }`, yet `decision_brief.warnings[0].message` — PLoT's `CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN`
 * prose — says "…(option ai_reporting_sprint: 0.3784 of draws outside the level domain)… More than 0.05 of the leading
 * option's draws…". The wire projection kept `warnings[]` verbatim on the assumption (#711) that it "carries no
 * comparative claim"; the egress alarm saw it on all 4 later Runs and only logged (`enforced:false`); and the Agent's
 * `run_analysis` result (`analysisResultForAgent`) handed the same text to the LLM.
 *
 * THE RULE (the UI's own V14.3 rule, applied to CEE): on a withheld turn a brief warning crosses as its TYPED parts —
 * `code` and `severity` — never as the producer's prose. The UI renders the brief's warnings nowhere
 * (`DECISION_BRIEF_DECLARED_DARK.warnings`, DGAI 4a48dab4) and the warning strip renders by `code`, so no user-visible
 * copy is lost; what is lost is the identity the LLM could read.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectTransportEnrichmentForWithheldClaim } from '../withheld-claim-projection.js';
import { enforceLeadingOptionClaimsAtWire } from '../leading-option-wire-enforcement.js';
import { analysisResultForAgent } from '../../agent-lane/decision-sensitivity.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';

type Warning = { code: string; message?: string; severity: string };
const FX = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'served-withheld-leader-brief-warning-0948Z.json'), 'utf8')) as {
  analysis_state: { leader_claim: { permitted: boolean; withheld_reason: string } };
  block: { type: string; enrichment: { decision_brief: { warnings: Warning[] } } & Record<string, unknown> } & Record<string, unknown>;
};
const SERVED_WARNINGS = FX.block.enrichment.decision_brief.warnings;
/** The leaked sentence, by identity: the served option id with its served share, and PLoT's own "leading option" words. */
const LEAK = 'ai_reporting_sprint: 0.3784 of draws';
const LEADER_WORDS = "the leading option's draws";

const briefWarningsOf = (enrichment: unknown): Warning[] | undefined =>
  (enrichment as { decision_brief?: { warnings?: Warning[] } } | undefined)?.decision_brief?.warnings;

describe('F2 §licence — a brief warning crosses a withheld turn as code + severity, never prose', () => {
  it('the served precondition: the leader is withheld and warnings[0] carries the leader in prose', () => {
    expect(FX.analysis_state.leader_claim.permitted).toBe(false);
    expect(SERVED_WARNINGS[0]!.code).toBe('CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN');
    expect(SERVED_WARNINGS[0]!.message).toContain(LEAK);
    expect(SERVED_WARNINGS[0]!.message).toContain(LEADER_WORDS);
  });

  it('the transport projection drops every warning’s prose and keeps each code and severity, in order', () => {
    const projected = projectTransportEnrichmentForWithheldClaim(FX.block.enrichment);
    const warnings = briefWarningsOf(projected);
    expect(warnings).toEqual(SERVED_WARNINGS.map((w) => ({ code: w.code, severity: w.severity })));
    expect(JSON.stringify(projected)).not.toContain(LEAK);
    expect(JSON.stringify(projected)).not.toContain(LEADER_WORDS);
  });

  it('the wire enforcer on the served block ships no warning prose (the path the egress alarm flagged ×4)', () => {
    const input = {
      response_version: 2,
      assistant_text: 'This rerun is current, but unchecked limits prevent putting an option forward.',
      blocks: [FX.block],
      suggested_actions: [],
      insights: [],
      stage_indicator: 'analyse',
    } as unknown as OlumiResponse;
    const { response } = enforceLeadingOptionClaimsAtWire(input, {
      requestId: 'req-f2-brief-warnings', exitPath: 'chip_click', graph: null, mayNameLeadingOption: false,
      analysisReady: undefined, leaderClaimWithheldReason: FX.analysis_state.leader_claim.withheld_reason,
    } as Parameters<typeof enforceLeadingOptionClaimsAtWire>[1]);
    const block = (response.blocks as unknown as Array<{ enrichment?: unknown }>)[0]!;
    expect(briefWarningsOf(block.enrichment)?.map((w) => w.code)).toEqual(SERVED_WARNINGS.map((w) => w.code));
    expect(JSON.stringify(response)).not.toContain(LEAK);
    // …and so the Agent, which reads the run's block after this gate, never reads it either.
    expect(JSON.stringify(analysisResultForAgent(block))).not.toContain(LEADER_WORDS);
  });

  it('control: the code family is untouched on a turn whose leader MAY be named — the rule is the licence, not the code', () => {
    const input = {
      response_version: 2, assistant_text: 'x', blocks: [FX.block], suggested_actions: [], insights: [], stage_indicator: 'analyse',
    } as unknown as OlumiResponse;
    const { response } = enforceLeadingOptionClaimsAtWire(input, {
      requestId: 'req-f2-brief-warnings-ctl', exitPath: 'chip_click', graph: null, mayNameLeadingOption: true,
      analysisReady: { admission: { mode: 'comparative_leader' } },
    } as unknown as Parameters<typeof enforceLeadingOptionClaimsAtWire>[1]);
    expect(JSON.stringify(response)).toContain(LEAK);
  });
});
