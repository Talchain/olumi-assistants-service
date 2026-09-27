/**
 * ⭐ C5 — THE AGENT'S PROVISIONAL VIEW (Paul's ruling, DL #70 5855324470, 11:12Z; Paul in session: "Yes, labelled
 * provisional"). When the analysis cannot put an option forward, the Agent MAY give its own reading — clearly labelled
 * as its provisional view, with its reasoning, never presented as the analysis result — plus ONE step that would let the
 * analysis confirm it. The leader-claim gate is UNCHANGED for anything presented as the analysis's result.
 *
 * WHY TYPED: the wire gate drops every sentence that ranks an option on a withheld turn, so a view written in the
 * model's prose is (and must stay) stripped. The view travels as a typed tool call; the ROUTE renders it AFTER the gate.
 *
 * The standing (withheld or not) is the corpus's own served `57f903c` pricing state — the fixture the route's gate test
 * uses — never a hand-written verdict.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  PROVISIONAL_VIEW_LABEL,
  checkProvisionalView,
  leaderStandingOf,
  provisionalViewHeading,
  provisionalViewSidecar,
  provisionalViewOfTurn,
  type LeaderStanding,
  readRunInterpretation,
} from '../provisional-view.js';
import { AGENT_TOOLS, MUTATION_TOOLS, dispatchTool, toolsFor, type AgentToolContext } from '../runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import {
  agentNoLeaderSentence,
  enforceAgentLaneLeaderClaimsAtWire,
  rankingLabelContext,
  sentenceRanksOptions,
} from '../withheld-leader-fail-closed.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';

const FX = JSON.parse(readFileSync(new URL('../../compose/__tests__/fixtures/leader-gate-real-replies.json', import.meta.url), 'utf8')) as {
  state: { draft_graph: unknown; analysis_state: { leader_claim: Record<string, unknown> } & Record<string, unknown>; analysis_ready: unknown };
};
const WITHHELD_STATE = FX.state.analysis_state;
const PERMITTED_STATE = { ...WITHHELD_STATE, leader_claim: { permitted: true, separation: 'separated' } };
const NEVER_RUN_STATE = { ...WITHHELD_STATE, run_state: { kind: 'never_run' } };
const READY = FX.state.analysis_ready;

/** A view that ranks — exactly what the gate must strip from prose, and what the typed block must carry. */
const VIEW = {
  view: 'I would raise Pro to £59 at release: on this model it is the strongest path to your MRR goal.',
  reasoning: 'You said most Pro subscribers asked for the release, and the model holds churn at 4% either way. The price rise carries MRR further than holding at £49 does.',
  confirm_step: 'Tell me the churn you actually expect at £59, and I can propose it so the analysis can check the limit.',
};

const ctx: AgentToolContext = { scenario_id: '5e3d2c1b-6f7a-4b8c-9d0e-1f2a3b4c5d6e', authenticated_user_id: null, request_id: 'req-c5' };
const noDispatch: InternalDispatch = async () => { throw new Error('the provisional view reads nothing of its own: its standing is injected'); };
const capsWith = (standing: LeaderStanding | null | (() => never) | undefined) => createAgentCapabilities(
  noDispatch, new ProposalStore(), undefined, 'full', undefined,
  standing === undefined ? {} : { readLeaderStanding: async () => (typeof standing === 'function' ? standing() : standing) },
);
const withheldStanding = (): LeaderStanding => leaderStandingOf({ analysisState: WITHHELD_STATE, analysisReady: READY });

describe('give_provisional_view is a READ-ONLY tool the Agent is offered', () => {
  it('RED: declared, with the three typed fields, and never a mutation tool', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'give_provisional_view');
    expect(tool, 'declared').toBeDefined();
    expect((tool!.parameters as { required?: unknown }).required).toEqual(['view', 'reasoning', 'confirm_step']);
    expect(MUTATION_TOOLS).not.toContain('give_provisional_view');
    expect(toolsFor('full').map((t) => t.name)).toContain('give_provisional_view');
  });
});

describe('the capability — validates, and refuses whenever the analysis may speak for itself', () => {
  it('RED: a withheld leader on a completed analysis → the view is accepted, typed, and nothing is changed', async () => {
    const r = await dispatchTool('give_provisional_view', JSON.stringify(VIEW), ctx, capsWith(withheldStanding()));
    expect(r).toMatchObject({ ok: true, mutated: false, provisional_view: VIEW });
  });

  it('RED (mutant: allow when permitted): a leader that MAY be named → refused `not_withheld`, nothing returned to show', async () => {
    const permitted = leaderStandingOf({ analysisState: PERMITTED_STATE, analysisReady: READY });
    expect(permitted, 'control: the fixture state permits the leader').toMatchObject({ withheld: false, analysis_on_record: true });
    const r = await dispatchTool('give_provisional_view', JSON.stringify(VIEW), ctx, capsWith(permitted));
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'not_withheld' });
    expect(Object.hasOwn(r, 'provisional_view')).toBe(false);
  });

  it('RED: no completed analysis on record → refused `no_analysis` (its reason words would be false)', async () => {
    const neverRun = leaderStandingOf({ analysisState: NEVER_RUN_STATE, analysisReady: READY });
    expect(neverRun.analysis_on_record).toBe(false);
    const r = await dispatchTool('give_provisional_view', JSON.stringify(VIEW), ctx, capsWith(neverRun));
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'no_analysis' });
  });

  it('RED: FAIL CLOSED — no standing reader, a null standing, or a throwing one → refused, never shown', async () => {
    for (const caps of [capsWith(undefined), capsWith(null), capsWith(() => { throw new Error('read failed'); })]) {
      const r = await dispatchTool('give_provisional_view', JSON.stringify(VIEW), ctx, caps);
      expect(r.ok).toBe(false);
      expect(r.mutated).toBe(false);
      expect(Object.hasOwn(r, 'provisional_view')).toBe(false);
    }
  });

  it.each([
    ['view', { ...VIEW, view: '   ' }, 'missing'],
    ['reasoning', { ...VIEW, reasoning: undefined }, 'missing'],
    ['view', { ...VIEW, view: 'One. Two. Three.' }, 'too_many_sentences'],
    ['reasoning', { ...VIEW, reasoning: 'One. Two. Three. Four.' }, 'too_many_sentences'],
    ['confirm_step', { ...VIEW, confirm_step: 'Tell me churn. Then run it.' }, 'too_many_sentences'],
    ['view', { ...VIEW, view: `I would raise it ${'x'.repeat(500)}.` }, 'too_long'],
  ])('RED: refuses a %s that is %s', async (field, args, problem) => {
    const r = await dispatchTool('give_provisional_view', JSON.stringify(args), ctx, capsWith(withheldStanding()));
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'invalid_provisional_view', field, problem });
  });

  it('checkProvisionalView: one line each, sentence-final (a newline or list marker cannot break the block)', () => {
    const c = checkProvisionalView({ ...VIEW, view: 'I would raise Pro\n\n- to £59', confirm_step: 'Tell me the churn at £59' });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.view.view).toBe('I would raise Pro - to £59.');
    expect(c.view.confirm_step).toBe('Tell me the churn at £59.');
  });
});

const labels = rankingLabelContext(FX.state.draft_graph, READY);
/** The route's gate, fed exactly as the route feeds it. */
const gate = (text: string, state: typeof WITHHELD_STATE) => {
  const claim = state.leader_claim as { permitted?: unknown; separation?: unknown; withheld_reason?: unknown };
  return enforceAgentLaneLeaderClaimsAtWire({ assistant_text: text, analysis_state: state } as unknown as OlumiResponse, {
    requestId: 'req-c5', exitPath: 'agent_lane_v1', mayNameLeadingOption: claim.permitted === true,
    separationEstablished: claim.separation === 'separated',
    ...(typeof claim.withheld_reason === 'string' ? { leaderClaimWithheldReason: claim.withheld_reason } : {}),
    graph: FX.state.draft_graph, analysisReady: READY,
  } as never);
};

describe('the standing reads the wire gate\'s OWN predicate and reason — never a second derivation', () => {

  it('control: the view sentence RANKS an option (the classifier sees it)', () => {
    expect(sentenceRanksOptions(VIEW.view, labels)).toBe(true);
  });

  it('withheld ⇔ the gate edits a ranking reply (withheld state yes; permitted state no)', () => {
    expect(withheldStanding().withheld).toBe(true);
    expect(gate(VIEW.view, WITHHELD_STATE).changed).toBe(true);
    expect(leaderStandingOf({ analysisState: PERMITTED_STATE, analysisReady: READY }).withheld).toBe(false);
    expect(gate(VIEW.view, PERMITTED_STATE).changed).toBe(false);
  });

  it('`because` is the gate\'s own reason — the no-leader sentence\'s clause, before its next action', () => {
    const s = withheldStanding();
    expect(s.because.startsWith('because ')).toBe(true);
    expect(agentNoLeaderSentence('constraint_verdict_withheld', READY)).toContain(`, ${s.because};`);
  });
});

describe('the ROUTE\'s renderer — typed and labelled, never prose (AIC 5855633777; thin-UI ruling 5855577789)', () => {
  const because = withheldStanding().because;

  it('RED (mutant: remove the label): the heading is the exact label sentence with the typed reason', () => {
    expect(PROVISIONAL_VIEW_LABEL).toBe('Provisional view');
    expect(provisionalViewHeading()).toBe(`Provisional view \u2014 the analysis can't confirm this yet.`);
    // AIC 27 Sep (served 770a477): the reason is said once — typed as `because`, which the chat shows in its why —
    // never again in a four-line bold heading beside the reply that already states it.
    expect(provisionalViewHeading()).not.toContain(because.replace(/^because /, ''));
  });

  it('the sidecar carries the heading, the three parts and the reason — the chat composes nothing', () => {
    expect(provisionalViewSidecar(VIEW, because)).toEqual({ heading: provisionalViewHeading(), ...VIEW, because });
  });

  it('CONTRAST (why it is typed): the gate strips the SAME view written as prose', () => {
    const gated = gate(`Here is where things stand. ${VIEW.view}`, WITHHELD_STATE).response.assistant_text;
    expect(gated).not.toContain(VIEW.view);
  });

  it('never fabricated: no call, a refused call, or a malformed result → nothing to render', () => {
    expect(provisionalViewOfTurn([], [])).toBeNull();
    expect(provisionalViewOfTurn([{ name: 'run_analysis', ok: true, mutated: false }], [{ ok: true, mutated: false }])).toBeNull();
    expect(provisionalViewOfTurn(
      [{ name: 'give_provisional_view', ok: false, mutated: false, refusal: 'not_withheld' }],
      [{ ok: false, mutated: false, refusal: 'not_withheld' }],
    )).toBeNull();
    expect(provisionalViewOfTurn(
      [{ name: 'give_provisional_view', ok: true, mutated: false }],
      [{ ok: true, mutated: false, provisional_view: { view: 'x' } }],
    )).toBeNull();
    expect(provisionalViewOfTurn(
      [{ name: 'run_analysis', ok: true, mutated: false }, { name: 'give_provisional_view', ok: true, mutated: false }],
      [{ ok: true, mutated: false }, { ok: true, mutated: false, provisional_view: VIEW }],
    )).toEqual(VIEW);
  });
});

describe('C5b — readRunInterpretation: the Run button\'s one call, typed', () => {
  const V = { view: 'I would hold at £49 this quarter.', reasoning: 'Churn is the risk you named first.', confirm_step: 'Tell me the churn you expect at £59.' };
  it('the typed answer and a valid view', () => {
    expect(readRunInterpretation(JSON.stringify({ answer: 'No option can be put forward yet.', provisional_view: V }))).toEqual({ answer: 'No option can be put forward yet.', view: V });
  });
  it('a null view → the answer, no view', () => {
    expect(readRunInterpretation(JSON.stringify({ answer: 'A.', provisional_view: null }))).toEqual({ answer: 'A.', view: null });
  });
  it('a view that breaks its limits is refused, never repaired', () => {
    expect(readRunInterpretation(JSON.stringify({ answer: 'A.', provisional_view: { ...V, confirm_step: 'One. Two.' } }))).toEqual({ answer: 'A.', view: null });
  });
  it('not the typed answer → null (plain text, empty answer, wrong shape)', () => {
    expect(readRunInterpretation('In the current model, the result turns on churn.')).toBeNull();
    expect(readRunInterpretation(JSON.stringify({ answer: '  ', provisional_view: V }))).toBeNull();
    expect(readRunInterpretation(JSON.stringify({ reply: 'A.' }))).toBeNull();
    expect(readRunInterpretation('null')).toBeNull();
  });
});
