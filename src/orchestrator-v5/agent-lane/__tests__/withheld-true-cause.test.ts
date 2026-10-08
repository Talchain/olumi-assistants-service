/**
 * ⭐ MC D1 — THE REPLY NAMES THE TRUE CAUSE AND A REAL ASK, NEVER "RUN IT AGAIN" (DL 0df0e1, 6 Oct; Science d5 #87 6007736377).
 *
 * Served T1b (Acceptance, cut 5):
 *   - rehearsal 9 (CEE 1c88f3c): a Run that produced NO result (it returned the identity question) was labelled
 *     `constraint_verdict_withheld` — a limit verdict on a brief with no limit;
 *   - rehearsals 8 / 13 (1c88f3c / d40fd7b): PLoT withheld the goal figures (#422 the user's size cut to fit; #416 "‘Starter-tier
 *     MRR’ depends on … × …, but this run couldn't calculate it that way"), the claim read `separation_unavailable`, and the
 *     reply's closing was "ask me to run the analysis and I will measure it" — the same model gives the same withhold.
 * Bound by code identity and exact words.
 */
import { describe, it, expect } from 'vitest';
import {
  composeLeaderClaim, LEADER_CLAIM_REASON_KINDS, WITHHELD_CONSTRAINT_VERDICT, WITHHELD_LEADER_CAUSE_UNRECORDED, WITHHELD_NO_RESULT,
  WITHHELD_SEPARATION_UNAVAILABLE,
} from '../../compose/analysis-state-v1.js';
import { readMayNameLeadingOptionVerdictForFact } from '../../context/claim-safety-read.js';
import { goalFiguresLeaderWithheldWithoutConstraintCause } from '../unsized-path-cause.js';
import { agentNoLeaderSentence, enforceAgentLaneLeaderClaimsAtWire, goalFigureCoHoldOf } from '../withheld-leader-fail-closed.js';
import { goalChanceLineOwed, goalChanceWithheldForAgent, identityAskLineFor, identityAskLineOwed } from '../goal-chance-withheld.js';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

type Rec = Record<string, any>;
const W416 = { code: 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', severity: 'warning', node_ids: ['starter_mrr'],
  message: 'Not shown. \'Starter-tier MRR\' depends on Starter-tier subscribers × Starter monthly price, but this run couldn\'t calculate it that way, so the figures for each option would be wrong.' };
// PLoT #422's own words (as pinned in goal-chance-clamp-reason.test.ts).
const W422 = { code: 'GOAL_FIGURES_USER_EFFECT_CLAMPED', severity: 'warning', node_ids: ['starter_price', 'starter_mrr'],
  message: 'Not shown. Your size for how ‘Starter monthly price’ moves ‘Starter-tier MRR’ is bigger than this model\'s scale can hold, so the run couldn\'t use it at full size, and the figures that depend on it would be wrong.' };
const TARGET_ONLY = { code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE', severity: 'warning', node_ids: ['mrr'], withheld_claims: ['goal_probability'],
  message: 'Not shown. The target cannot be tested yet.' };
const fact = (warnings: Rec[]): Rec => ({ fact_type: 'run_analysis', result: {
  constraint_verdict: { may_name_leading_option: true }, enrichment: { inference_warnings: warnings } } });
const blocks = (warnings: Rec[]): Rec[] => [{ type: 'analysis_result', enrichment: { inference_warnings: warnings } }];
const T1B = { nodes: [
  { id: 'mrr', kind: 'goal', label: 'Monthly recurring revenue' },
  { id: 'starter_mrr', kind: 'outcome', label: 'Starter-tier MRR', nonlinear_identity: { operation: 'product', factor_ids: ['starter_subscribers', 'starter_price'] } },
  // A FACTOR: a level a control can save (DL's P1 rule, `LEVEL_WRITER_KINDS`); the OUTCOME case asks nothing (below).
  { id: 'starter_subscribers', kind: 'factor', label: 'Starter-tier subscribers' },
  { id: 'starter_price', kind: 'factor', label: 'Starter monthly price', observed_state: { value: 49, unit: 'GBP per month' } },
  { id: 'keep', kind: 'option', label: 'Keep pricing as it is', is_baseline: true },
  { id: 'launch', kind: 'option', label: 'Launch starter tier' },
], edges: [
  { from: 'launch', to: 'starter_subscribers' }, { from: 'starter_subscribers', to: 'starter_mrr' }, { from: 'starter_price', to: 'starter_mrr' },
  { from: 'starter_mrr', to: 'mrr' },
] };

describe('(a) a Run that produced no result is never called a limit verdict', () => {
  it.each(['never_run', 'running', 'refused', 'blocked'])('RED (rehearsal 9): run_state %s → analysis_no_result', (kind) => {
    const claim = composeLeaderClaim({ canonical: null, rawRobustness: null } as never, { kind } as never, false);
    expect(claim).toMatchObject({ permitted: false, withheld_reason: WITHHELD_NO_RESULT });
    expect(claim.withheld_reason).not.toBe(WITHHELD_CONSTRAINT_VERDICT);
  });

  it('CONTROL: a COMPLETE run that is not entitled keeps the existing chain (the constraint default)', () => {
    const claim = composeLeaderClaim({ canonical: null, rawRobustness: null } as never, { kind: 'complete_current' } as never, false);
    expect(claim.withheld_reason).toBe(WITHHELD_CONSTRAINT_VERDICT);
  });

  it('the code is classified: nothing was checked, so not_evaluated', () => {
    expect(LEADER_CLAIM_REASON_KINDS[WITHHELD_NO_RESULT]).toBe('not_evaluated');
    expect(agentNoLeaderSentence(WITHHELD_NO_RESULT, undefined)).toBe(
      'No single option can be put forward yet, because no analysis has produced a result for this model yet; ask me to run it.');
  });
});

describe('(b) a goal-figure withhold that took the shares withholds the leader, as the licence does', () => {
  it.each([['#416', W416], ['#422', W422]])('RED (rehearsals 13/8): PLoT %s → the leader may not be named, and the constraint is not the cause', (_n, w) => {
    expect(readMayNameLeadingOptionVerdictForFact(fact([w]) as never).may_name_leading_option).toBe(false);
    expect(goalFiguresLeaderWithheldWithoutConstraintCause(fact([w]).result)).toBe(true);
  });

  it('CONTROL: a target-only withhold that KEPT the shares withholds no leader (RT-10 B′ R2)', () => {
    expect(readMayNameLeadingOptionVerdictForFact(fact([TARGET_ONLY]) as never).may_name_leading_option).toBe(true);
    expect(goalFiguresLeaderWithheldWithoutConstraintCause(fact([TARGET_ONLY]).result)).toBe(false);
  });
});

describe('(b)+(c) the reply names the warning\'s own cause and its ask — never "run the analysis" again', () => {
  it('RED (rehearsal 13): #416 → PLoT\'s cause, then the ONE ask that would let the identity be worked out (Science\'s words)', () => {
    const hold = goalFigureCoHoldOf(blocks([W416]), T1B)!;
    const words = 'No single option can be put forward yet, because \'Starter-tier MRR\' depends on Starter-tier subscribers × Starter monthly price, '
      + 'but this run couldn\'t calculate it that way, so the figures for each option would be wrong. '
      + 'To work out “Starter-tier MRR” as “Starter-tier subscribers” × “Starter monthly price”: ‘Starter-tier subscribers’ is 0 today, since '
      + '‘Launch starter tier’ would start it. How many ‘Starter-tier subscribers’ would ‘Launch starter tier’ lead to? A best guess and a range is fine.';
    expect(hold.say).toBe(words);
    for (const claim of [WITHHELD_SEPARATION_UNAVAILABLE, WITHHELD_LEADER_CAUSE_UNRECORDED]) {
      expect(agentNoLeaderSentence(claim, undefined, [], undefined, undefined, undefined, hold)).toBe(words);
    }
    expect(words).not.toMatch(/run the analysis|run it again|what is it today/i);
  });

  it('⛔ P1: the same #416 over an OUTCOME part (no control can give it a level) → PLoT\'s cause only, NO ask', () => {
    const outcome = structuredClone(T1B) as Rec;
    outcome.nodes.find((n: Rec) => n.id === 'starter_subscribers').kind = 'outcome';
    const hold = goalFigureCoHoldOf(blocks([W416]), outcome)!;
    expect(hold.ask).toBeUndefined();
    const words = agentNoLeaderSentence(WITHHELD_LEADER_CAUSE_UNRECORDED, undefined, [], undefined, undefined, undefined, hold);
    expect(words).toContain('because \'Starter-tier MRR\' depends on Starter-tier subscribers × Starter monthly price, '
      + 'but this run couldn\'t calculate it that way');
    expect(words).not.toMatch(/is 0 today|How many|what is it today|Use 0 today/);
  });

  it('RED (rehearsal 8): #422 → its own cause, with no "run the analysis"', () => {
    const hold = goalFigureCoHoldOf(blocks([W422]), T1B)!;
    expect(agentNoLeaderSentence(WITHHELD_LEADER_CAUSE_UNRECORDED, undefined, [], undefined, undefined, undefined, hold)).toBe(
      'No single option can be put forward yet, because your size for how ‘Starter monthly price’ moves ‘Starter-tier MRR’ is bigger than this model\'s scale can hold, so the run couldn\'t use it at full size, and the figures that depend on it would be wrong.');
  });

  it('CONTROL: no goal-figure warning → no co-hold, so the existing separation clause stands', () => {
    expect(goalFigureCoHoldOf(blocks([]), T1B)).toBeUndefined();
    expect(agentNoLeaderSentence(WITHHELD_SEPARATION_UNAVAILABLE, undefined)).toContain('ask me to run the analysis');
  });
});

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-416-draw6-b501eda4.json', import.meta.url), 'utf8')) as Rec;
const SERVED_ASK = 'To work out “Monthly starter support cost” as “Starter subscribers” × “Starter support cost per subscriber”: '
  + '‘Starter subscribers’ is 0 today, since ‘Launch starter tier’ would start it. '
  + 'How many ‘Starter subscribers’ would ‘Launch starter tier’ lead to? A best guess and a range is fine.';

describe('(c) on the chip Run turn itself (served witness, CEE b501eda4, draw 6: the reply said #416 and asked nothing)', () => {
  it('⛔ P1 (DL 6 Oct, G1 draft 11): the served part is an OUTCOME no control can give a level, and the brief already sized the launch (150) — NOTHING is asked', () => {
    expect(SERVED.graph.nodes.find((n: Rec) => n.id === 'starter_subscribers')).toMatchObject({ kind: 'outcome' });
    expect(identityAskLineFor(SERVED.analysis_result, SERVED.graph)).toBeNull();
  });

  it('RED: the same Run with the part a FACTOR (a control can save it) → the ask, in Science\'s words (the launch\'s 150 never asked again)', () => {
    const g = structuredClone(SERVED.graph) as Rec;
    g.nodes.find((n: Rec) => n.id === 'starter_subscribers').kind = 'factor';
    expect(identityAskLineFor(SERVED.analysis_result, g)).toBe('To work out “Monthly starter support cost” as “Starter subscribers” × '
      + '“Starter support cost per subscriber”: ‘Starter subscribers’ is 0 today, since ‘Launch starter tier’ would start it.');
  });

  it('RED (after construction holds the created part at 0): the stored model gives #416 no ask to infer — 0 is an ordinary level there', () => {
    const g = structuredClone(SERVED.graph) as Rec;
    g.nodes.find((n: Rec) => n.id === 'starter_subscribers').observed_state = { value: 0, source: 'cee_inference', extractionType: 'inferred' };
    expect(identityAskLineFor(SERVED.analysis_result, g)).toBeNull();
  });

  it('the route owes it once: absent from the reply → owed; already said → not again; a later Run without it clears it', () => {
    expect(identityAskLineOwed([{ ran: true, identity_ask_say: SERVED_ASK }], 'Your results are ready.')).toBe(SERVED_ASK);
    expect(identityAskLineOwed([{ ran: true, identity_ask_say: SERVED_ASK }], `Ready. ${SERVED_ASK}`)).toBeNull();
    expect(identityAskLineOwed([{ ran: true, identity_ask_say: SERVED_ASK }, { ran: true }], 'Ready.')).toBeNull();
  });

  it('CONTROL: a Run with no #416 owes no identity ask', () => {
    expect(identityAskLineFor(blocks([W422])[0], SERVED.graph)).toBeNull();
  });
});

describe('Codex buddy r1 — the wire says the cause and the ask ONCE, and a no-result Run its own cause', () => {
  const result = blocks([W416])[0]!;
  const SAY = goalChanceWithheldForAgent(result)!.say;
  const ASK = identityAskLineFor(result, T1B)!;
  const wire = (text: string, runKind = 'complete_current', reason = WITHHELD_LEADER_CAUSE_UNRECORDED): string =>
    enforceAgentLaneLeaderClaimsAtWire({ assistant_text: text, blocks: [result], suggested_actions: [],
      analysis_state: { run_state: { kind: runKind }, leader_claim: { permitted: false, withheld_reason: reason } } } as never,
    { requestId: 'd1', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, separationEstablished: false,
      leaderClaimWithheldReason: reason, graph: T1B, analysisReady: undefined, protectedGoalChanceSay: SAY } as never).response.assistant_text as string;

  it('P2: the protected cause is never repeated — only the ask is added after it', () => {
    const out = wire(`${SAY}\n\nLaunch starter tier does best.`);
    expect(out.split('couldn\'t calculate it that way').length - 1).toBe(1);
    expect(out).toContain(ASK);
    expect(out.split(ASK).length - 1).toBe(1);
  });

  it('P1: the ask the route already owed is never said twice', () => {
    const out = wire(`${SAY}\n\n${ASK}\n\nLaunch starter tier does best.`);
    expect(out.split(ASK).length - 1).toBe(1);
  });

  it('P2: a no-result Run says its known cause, never "the reason is not recorded"', () => {
    const out = wire('Launch starter tier does best.', 'never_run', WITHHELD_NO_RESULT);
    expect(out).toBe('No single option can be put forward yet, because no analysis has produced a result for this model yet; ask me to run it.');
  });

  it('P2: a name opening PLoT\'s words keeps its capital ("Olumi"); "Your" does not', () => {
    const named = { ...W422, message: 'Not shown. Olumi could not use the stated size.' };
    expect(goalFigureCoHoldOf(blocks([named]), T1B)!.why).toBe('Olumi could not use the stated size');
    expect(goalFigureCoHoldOf(blocks([W422]), T1B)!.why.startsWith('your size')).toBe(true);
  });
});

describe('(c) the Run tool hands the route its #416 ask (`identity_ask_say`), read from the graph the Run analysed', () => {
  const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400d1', authenticated_user_id: null, request_id: 'r' };
  const caps = (warnings: Rec[]) => {
    const state = { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: WITHHELD_LEADER_CAUSE_UNRECORDED } };
    const d: InternalDispatch = async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: T1B, graph_hash: 'h1', analysis_state: state } };
      if (path === '/orchestrate/v2/turn') {
        return { status: 200, json: { assistant_text: '', analysis_state: state, analysis_ready: { status: 'ready' },
          blocks: [{ type: 'analysis_result', summary: 's', enrichment: { option_comparison: [{ option_id: 'launch', option_label: 'Launch starter tier' }], inference_warnings: warnings } }] } };
      }
      throw new Error(`unexpected dispatch ${path}`);
    };
    return createAgentCapabilities(d, new ProposalStore());
  };

  it('RED: a #416 Run → identity_ask_say, the same words the route owes', async () => {
    const r = await caps([W416]).runAnalysis(ctx, { reason: 'Run it.' }) as Rec;
    expect(r.identity_ask_say).toBe(identityAskLineFor(blocks([W416])[0], T1B));
    expect(r.identity_ask_say).toContain('How many ‘Starter-tier subscribers’ would ‘Launch starter tier’ lead to?');
  });

  it('CONTROL: a #422 Run carries none', async () => {
    expect(await caps([W422]).runAnalysis(ctx, { reason: 'Run it.' })).not.toHaveProperty('identity_ask_say');
  });
});

describe('(c) WIRING: both Run replies owe the ask (the live turn and its replay) — a source pin until the served witness', () => {
  it('the live Run turn\'s owed lines and the replay\'s owed lines each read the ask', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route).toContain('...[identityAskLineOwed(result.tool_results, text)].filter((x): x is string => x !== null),');
    expect(route).toContain('const askNow = identityAskLineFor(state.analysisResult, state.graph);');
    // ONE reply: the typed reason is owed after the gate only if the gate did not already say it.
    expect(route).toContain("goalChanceLineOwed(result.tool_results, String(wireBody.assistant_text ?? ''), { gateReasonOwed: gateOwnsGoalChance, identityAskOwed: identityAskOwnedByCard });");
    expect(route).toContain('assistant_text: withDisclosures(wireBody.assistant_text, goalLines)');
  });
});

describe('(f) a placeholder path beside an untestable target: the chat discloses the target\'s complete requirement (g1-b501 draft 1)', () => {
  const D1 = JSON.parse(readFileSync(new URL('./fixtures/served-g1b501-draft1-placeholder-target.json', import.meta.url), 'utf8')) as Rec;
  const placeholder = (D1.analysis_result.enrichment.inference_warnings as Rec[]).find((w) => w.code === 'GOAL_FIGURES_PLACEHOLDER_PATH')!;
  // This historical warning predates acceptable_links: today's composition reads that same list carrier.
  placeholder.acceptable_links = placeholder.links;

  it('PRECONDITION: the served Run carried both withholds, and the target one KEPT the shares', () => {
    const codes = (D1.analysis_result.enrichment.inference_warnings as Rec[]).map((w) => w.code);
    expect(codes).toEqual(['GOAL_FIGURES_PLACEHOLDER_PATH', 'GOAL_FIGURES_TARGET_NOT_TESTABLE']);
    expect(placeholder.message).toMatch(/Set (it|them) to see how much (it|they) matters?\.$/);
  });

  it('Science §(i) 4: captured case (c) has no missing level, so its 2-placeholder path speaks alone', () => {
    const say = goalChanceWithheldForAgent(D1.analysis_result)!.say;
    expect(placeholder.links).toHaveLength(2);
    expect(say).toBe("Not shown yet: 2 links on the way to your goal have no size, so any figure would come from Olumi's stand-ins, not your model. Size them to see the chance.");
  });

  it('R2 RED: draw-2 has a missing level → its existing level-only ask FIRST, then the 2-link guided words', () => {
    const draw2 = JSON.parse(readFileSync(new URL('./fixtures/guided-sizing-draw2.json', import.meta.url), 'utf8')) as Rec;
    const warnings = (draw2.analysis_result.enrichment.inference_warnings as Rec[])
      .filter(w => ['GOAL_FIGURES_PLACEHOLDER_PATH', 'GOAL_FIGURES_TARGET_NOT_TESTABLE'].includes(w.code));
    expect(warnings.map(w => w.code)).toEqual(['GOAL_FIGURES_PLACEHOLDER_PATH', 'GOAL_FIGURES_TARGET_NOT_TESTABLE']);
    const target = warnings.find(w => w.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE')!;
    expect(target.say).toContain("What's today's level of MRR?");
    expect(target.say).toContain('from Pro plan price to Monthly churn');
    const say = goalChanceWithheldForAgent({ enrichment: { inference_warnings: warnings } }, draw2.graph)!.say;
    expect(say).toBe("What's today's level of MRR? Not shown yet: 2 links on the way to your goal have no size, so any figure would come from Olumi's stand-ins, not your model. Size them to see the chance.");
    expect(say).not.toContain('a size for the links from');
  });

  it('CONTROL: a target-only withhold that kept the shares keeps its own tail (no placeholder words appear)', () => {
    const target = (D1.analysis_result.enrichment.inference_warnings as Rec[]).filter((w) => w.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE');
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: target } })!.say).not.toContain('sized in the model yet');
  });
});

describe('Codex buddy r2', () => {
  it('P1: a later Run WITHOUT a result clears an earlier identity ask (the operand was set in between)', () => {
    expect(identityAskLineOwed([{ ran: true, identity_ask_say: SERVED_ASK }, { ran: false }], 'Ready.')).toBeNull();
    // Control: the ask stands when no later Run came.
    expect(identityAskLineOwed([{ ran: true, identity_ask_say: SERVED_ASK }, { ok: true, mutated: true }], 'Ready.')).toBe(SERVED_ASK);
  });

  it('W5 DL re-pin: quoting only the placeholder subset still owes the complete target requirement', () => {
    const D1 = JSON.parse(readFileSync(new URL('./fixtures/served-g1b501-draft1-placeholder-target.json', import.meta.url), 'utf8')) as Rec;
    const p = (D1.analysis_result.enrichment.inference_warnings as Rec[]).find(w => w.code === 'GOAL_FIGURES_PLACEHOLDER_PATH')!;
    p.acceptable_links = p.links;
    const chance = goalChanceWithheldForAgent(D1.analysis_result)!;
    const placeholder = (D1.analysis_result.enrichment.inference_warnings as Rec[]).find((w) => w.code === 'GOAL_FIGURES_PLACEHOLDER_PATH')!;
    const run = { ran: true, goal_chance: chance };
    expect(goalChanceLineOwed([run], `Here is the run. ${placeholder.message}`)).toBe(chance.say);
    expect(goalChanceLineOwed([run], `This run doesn’t show how often each option reaches the goal’s target. ${placeholder.message}`)).toBe(chance.say);
    // Control: a reply that says neither owes the whole line.
    expect(goalChanceLineOwed([run], 'Here is the run.')).toBe(chance.say);
  });
});
