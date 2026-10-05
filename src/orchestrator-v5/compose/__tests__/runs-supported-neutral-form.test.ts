/**
 * ⭐ THE DIRECTION-NEUTRAL LEADER FORM IS A LEADER CLAIM TO EVERY GUARD (DL 0df0e1 #87 6002469285, Part B).
 *
 * Paul (20:2xZ): never "best / ahead / winner / recommend". Where a composer cannot see the Run's sent direction, it names
 * an option as "{N}% of runs supported {X}", "{X} would be the first to be supported by the most runs if …", "the option the most runs
 * supported" or "{X} was supported by … runs". "The most runs" is a PLURALITY: an unchanged ordering (.40/.35/.25) is not
 * a majority, so no composer says "most runs" bare (Codex r1 #2609).
 *
 * A new leader verb the guards cannot read would switch redaction off for it (`scored_highest`'s note), so the shared
 * vocabulary (`LEADER_CLAIM_PATTERNS` → `textNamesLeadingOption`) and the Agent lane's fail-closed classifier
 * (`RANKING_PATTERNS`) learn it in the same change. Each guard is pinned on its OWN code, so deleting `runs_supported` from
 * either list alone turns its rows RED (the Agent classifier also consults the shared vocabulary, so a boolean row there
 * could not tell the two apart).
 */
import { describe, it, expect } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { textNamesLeadingOption } from '../leading-option-egress-guard.js';
import { enforceAgentLaneLeaderClaimsAtWire, rankingCodesIn, rankingLabelContext } from '../../agent-lane/withheld-leader-fail-closed.js';
import { LINK_COPY, renderLinkTippingPoints, IN_THIS_MODEL } from '../../agent-lane/method-turn/what-changes-turn.js';
import { TARGET_FIT_DEFINITION } from '../../format/format-analysis-for-context.js';
import { SYSTEM_PROMPT_DOCTRINE } from '../../replacement/system-prompt.js';

const graph = { nodes: [{ id: 'keep', kind: 'option', label: 'Keep Pro at £49' }, { id: 'raise', kind: 'option', label: 'Raise Pro to £59 at release' }, { id: 'price', kind: 'factor', label: 'Price' }, { id: 'churn', kind: 'factor', label: 'Monthly churn' }] };
const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } };
const labels = rankingLabelContext(graph, analysisReady);

/** Every form a composer in this PR emits (label-first where it names one). */
const FORMS = {
  whatIfQuoted: '‘Raise Pro to £59 at release’ would be the first to be supported by the most runs if price’s effect on monthly churn fell below about a quarter of what it is now.',
  whatIfStill: '‘Keep Pro at £49’ would still be supported by the most runs even if price’s average effect on monthly churn fell to zero.',
  riskCard: 'On Olumi’s estimates, the option the most runs supported is more likely than not to break your churn limit.',
  headlineDisambig: '‘Keep Pro at £49’ is the option this analysis names, though ‘Raise Pro to £59 at release’ was supported by marginally more runs of this model.',
  headlineTie: '‘Keep Pro at £49’ was supported by only fractionally more runs of this model, so the options are effectively tied.',
  closeCall: 'This is a close call: in this model, ‘Keep Pro at £49’ was supported by about 3 percentage points more of the runs than ‘Raise Pro to £59 at release’.',
  lens: 'One option was supported by the most runs, but by fewer than 70% of them.',
  share: 'In this model, 62% of runs supported ‘Raise Pro to £59 at release’ for MRR.',
} as const;
const PLAIN = 'Monthly churn is currently assumed at 3%, against your limit of 4%.';

describe('the shared vocabulary (LEADER_CLAIM_PATTERNS → textNamesLeadingOption) reads every neutral form', () => {
  it.each(Object.entries(FORMS))('RED: %s names a leading option', (_k, s) => { expect(textNamesLeadingOption(s)).toBe(true); });
  it('CONTROL: a sentence about a figure names none', () => { expect(textNamesLeadingOption(PLAIN)).toBe(false); });
});

describe('the Agent-lane classifier reads it under its OWN code', () => {
  it.each(Object.entries(FORMS))('RED: %s carries runs_supported', (_k, s) => {
    expect(rankingCodesIn(s, labels)).toContain('runs_supported');
  });
  it('CONTROL: the figure sentence carries no ranking code', () => { expect(rankingCodesIn(PLAIN, labels)).toEqual([]); });
  it('the what-if and tie forms carry no ranking code but runs_supported (and the shared-vocabulary echo of it)', () => {
    // rankingCodesIn adds `shared_leader_vocabulary` whenever the shared list matches (Codex r2): that echo is the
    // shared entry, so outside it the Agent list's own `runs_supported` is the only code that catches these forms.
    for (const s of [FORMS.whatIfQuoted, FORMS.whatIfStill, FORMS.headlineTie]) {
      expect(rankingCodesIn(s, labels).filter((c) => c !== 'shared_leader_vocabulary'), s).toEqual(['runs_supported']);
    }
  });

  const wire = (permitted: boolean, text: string) => enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: text, blocks: [], suggested_actions: [],
      analysis_state: { leader_claim: permitted ? { permitted: true } : { permitted: false, withheld_reason: 'constraint_verdict_withheld' } } } as unknown as OlumiResponse,
    permitted
      ? { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: true, graph, analysisReady }
      : { requestId: 't', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'constraint_verdict_withheld', graph, analysisReady },
  ).response.assistant_text as string;

  it('CATCH TWIN (unlicensed use): on a withheld turn the what-if form is dropped, the figure sentence kept', () => {
    const out = wire(false, `${IN_THIS_MODEL}${FORMS.whatIfQuoted} ${PLAIN}`);
    expect(out).not.toMatch(/be supported by the most runs/);
    expect(out).toContain(PLAIN);
  });
  it('licensed: the same reply passes the gate unchanged', () => {
    const text = `${IN_THIS_MODEL}${FORMS.whatIfQuoted} ${PLAIN}`;
    expect(wire(true, text)).toBe(text);
  });
});

describe('the composers emit only forms the guards read (derived from the real builder)', () => {
  it('every what-changes sentence is a leader claim to both guards, is a plurality, and says no banned word', () => {
    const links = [
      { from_id: 'price', to_id: 'churn', status: 'quoted', threshold: 0.064, current_mean: 0.25, to_option_id: 'raise' },
      { from_id: 'price', to_id: 'churn', status: 'quoted', threshold: 0.02, current_mean: 0.25, to_option_id: 'raise' },
      { from_id: 'churn', to_id: 'price', status: 'no_change', threshold: null, current_mean: 0.2, to_option_id: null },
    ];
    const out = renderLinkTippingPoints(links as never, {
      node: { price: 'Price', churn: 'Monthly churn' }, option: { keep: 'Keep Pro at £49', raise: 'Raise Pro to £59 at release' }, leaderId: 'keep',
    });
    expect(out).toHaveLength(3);
    for (const s of out) {
      expect(textNamesLeadingOption(s), s).toBe(true);
      expect(rankingCodesIn(s, labels), s).toContain('runs_supported');
      expect(s).not.toMatch(/\b(?:ahead|best|lead|leads|winner|wins?)\b/);
      expect(s, 'a plurality, never "most runs" bare').not.toMatch(/(?<!the )\bmost runs\b/i);
    }
    expect(Object.values(LINK_COPY).every((c) => /be supported by the most runs/.test(c))).toBe(true);
    // Codex r2: ISL certifies the NEAREST crossing only, so the quoted forms say "the first".
    expect(LINK_COPY.quoted).toMatch(/would be the first to be supported/);
    expect(LINK_COPY.below_a_tenth).toMatch(/would be the first to be supported/);
  });
});

describe('the model-facing definitions name no winner (Codex r3 #2609)', () => {
  it('the target-fit definition and the replacement doctrine use the runs-supported form', () => {
    expect(TARGET_FIT_DEFINITION).toContain('win_probability only says how often runs supported the option over the alternatives');
    expect(TARGET_FIT_DEFINITION).toContain('an option can be supported by the most runs yet still be unlikely to meet the target');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('far more than which option the most runs supported');
    expect(SYSTEM_PROMPT_DOCTRINE).toContain('would change how the options compare if they are wrong');
    for (const s of [TARGET_FIT_DEFINITION, SYSTEM_PROMPT_DOCTRINE]) {
      expect(s).not.toMatch(/\b(?:wins?|beats?|leaders?|winner)\b/i);
    }
  });
});
