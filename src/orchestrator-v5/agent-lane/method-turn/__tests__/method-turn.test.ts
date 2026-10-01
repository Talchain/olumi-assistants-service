/**
 * T3 method turn (DL 5937411688 / 5937503623): an asked pre-mortem → RC's selector → SCIENCE/DSK's context → a checked
 * reply or RC's fallback, plus the ONE card target. The corpus is OUTSIDE this author's head: R3's served F5 captures
 * (#2465's `rc-served-signal-cases.json`, each sha-pinned to its capture) and RC's acceptance contract (its cases and its
 * method-turn reply fixtures, vendored from programme-docs @a00cb9c8).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { POLICY } from '../../guidance/policy.js';
import { methodPlanOf, type GuidanceSignals as SelectorSignals } from '../../guidance/index.js';
import type { SuppliedItem } from '../../science/method-science-context.js';
import type { GuidanceSignalInputs, GuidanceSignals as TurnSignals } from '../../turn-context/guidance-signals.js';
import { AGENT_TOOLS } from '../../runtime/agent-tools.js';
import { edgeBandFromMagnitude } from '../../../format/edge-strength-bands.js';
import {
  FALLBACK_TEMPLATE,
  PLAN_PICK_PREFIX,
  PREMORTEM_PRESS_ID,
  TALK_IT_THROUGH_CHIP,
  canonicalStageOf,
  cardCallFor,
  methodDirective,
  methodPressOf,
  methodTurnFromSignals,
  planMethodTurn,
  planPickChipId,
  settleMethodTurn,
  type RunMethodTurn,
} from '../method-turn.js';

type ServedCase = { id: string; capture_sha_matches_case: boolean; body: Record<string, any>; expected_state: Record<string, unknown> };
const SERVED = JSON.parse(readFileSync(new URL('../../turn-context/__tests__/fixtures/rc-served-signal-cases.json', import.meta.url), 'utf8')) as { cases: ServedCase[] };
const served = (id: string): ServedCase => SERVED.cases.find((c) => c.id === id)!;

type RcCase = { id: string; state: Record<string, unknown>; expect: { runs_method?: string; mode?: string | null; choices?: string[] } };
type RcReply = { id: string; policy_id: string; inputs: { plan_label: string; current_option_labels: string[]; supplied_items: SuppliedItem[] }; reply: string; expect: 'pass' | 'fail'; expect_targets: (string | null)[]; failing_checks?: string[] };
const RC = JSON.parse(readFileSync(new URL('../../__tests__/fixtures/reasoning-coach-acceptance.json', import.meta.url), 'utf8')) as { cases: RcCase[]; method_turn_fixtures: RcReply[] | Record<string, RcReply> };
const rcCase = (id: string): RcCase => RC.cases.find((c) => c.id === id)!;
const RC_REPLIES: RcReply[] = (Array.isArray(RC.method_turn_fixtures) ? RC.method_turn_fixtures : Object.values(RC.method_turn_fixtures))
  .filter((f) => f.policy_id === 'RC-PREMORTEM');

/** A served Agent response as the wiring will read it: the readback graph, state, result and participation. */
const inputsOf = (c: ServedCase): Omit<GuidanceSignalInputs, 'request' | 'explicitRequest'> => ({
  offeredSpecific: [],
  graph: c.body.draft_graph,
  analysisState: c.body.analysis_state,
  analysisResult: c.body.analysis_result,
  optionParticipation: c.body.option_participation,
  leaderLicensed: c.body.analysis_state?.leader_claim?.permitted === true,
});
const turnFor = (c: ServedCase, chipId: unknown) => planMethodTurn({ chipId, signalInputs: inputsOf(c) });
const labelsOf = (c: ServedCase) => c.expected_state['model.option_labels'] as Record<string, string>;
const q = (s: string) => `‘${s}’`;

/** RC's acceptance state as a METHOD press would carry it: the pick comes from the press, never from the state. */
const methodState = (state: Record<string, unknown>): TurnSignals => {
  const { 'user.selected_option_id': _pick, ...rest } = state;
  return { ...rest, 'turn.request': 'method', 'open.decision_point': false, 'user.explicit_request': 'RC-PREMORTEM' } as unknown as TurnSignals;
};

describe('the corpus', () => {
  it('served cases are byte-identical to their captures; RC carries 4 pre-mortem method cases and 7 reply fixtures', () => {
    expect(SERVED.cases.every((c) => c.capture_sha_matches_case)).toBe(true);
    const method = RC.cases.filter((c) => c.id.startsWith('A-PREMORTEM') && c.state['turn.request'] === 'method');
    expect(method.map((c) => c.id).sort()).toEqual([
      'A-PREMORTEM-ASKED-CHOOSE-PLAN-D1', 'A-PREMORTEM-GENERIC-PRESS-SINGLE-OPTION-ASKS',
      'A-PREMORTEM-PLAN-CHOSEN-D1', 'A-PREMORTEM-ROW-PRESS-SINGLE-OPTION-RUNS',
    ]);
    expect(RC_REPLIES.map((f) => f.id).sort()).toEqual([
      'MT-PREMORTEM-BAD-BLINDSPOT-AS-STORY', 'MT-PREMORTEM-BAD-BLINDSPOT-ASSERTED', 'MT-PREMORTEM-BAD-PREDICTION',
      'MT-PREMORTEM-BAD-UNGROUNDED', 'MT-PREMORTEM-D1-OWN-LABEL-BAD-CLAIM', 'MT-PREMORTEM-D1-OWN-LABEL-GOOD', 'MT-PREMORTEM-GOOD',
    ]);
  });

  it('the generic press IS the served next-step chip, and RC\'s fallback is quoted verbatim', async () => {
    const { NEXT_STEP_CHIPS } = await import('../../../../routes/agent-v1-turn.js');
    expect(NEXT_STEP_CHIPS.map((c) => c.id)).toContain(PREMORTEM_PRESS_ID);
    expect(/'(Imagine [^']+)'/u.exec(POLICY.method_turns['RC-PREMORTEM'].fallback)?.[1]).toBe(FALLBACK_TEMPLATE);
  });
});

describe('who names the plan: never Olumi for the user (RC choose_plan; PTL 5933036532 #5)', () => {
  for (const id of ['A-PREMORTEM-ASKED-CHOOSE-PLAN-D1', 'A-PREMORTEM-GENERIC-PRESS-SINGLE-OPTION-ASKS', 'A-PREMORTEM-PLAN-CHOSEN-D1', 'A-PREMORTEM-ROW-PRESS-SINGLE-OPTION-RUNS']) {
    it(`ROW M1 RC PARITY ${id}: the press decides as RC expects`, () => {
      const c = rcCase(id);
      const pick = c.state['user.selected_option_id'];
      const out = methodTurnFromSignals(typeof pick === 'string' ? planPickChipId(pick) : PREMORTEM_PRESS_ID, methodState(c.state), undefined);
      if (c.expect.mode === 'choose_plan') {
        expect(out?.kind).toBe('choose_plan');
        if (out?.kind !== 'choose_plan') return;
        expect(out.reply).toBe('Which option do you want to stress-test?');
        expect(out.actions.map((a) => a.id)).toEqual([...(c.expect.choices ?? []).map(planPickChipId), TALK_IT_THROUGH_CHIP.id]);
      } else {
        expect(out?.kind).toBe('run');
        if (out?.kind !== 'run') return;
        expect(out.context.plan.option_id).toBe(methodPlanOf(c.state as SelectorSignals));
        expect(out.context.plan.basis).toBe('user_selected');
      }
    });
  }

  it('ROW M2 SERVED D1 (2 own options, leader withheld): the generic press asks, one curly-quoted button per own option + Talk it through', () => {
    const c = served('A-STRENGTHEN-PLACEHOLDER-P1');
    const out = turnFor(c, PREMORTEM_PRESS_ID);
    expect(out?.kind).toBe('choose_plan');
    if (out?.kind !== 'choose_plan') return;
    const own = c.expected_state['model.non_sq_option_ids'] as string[];
    expect(own).toEqual(rcCase('A-PREMORTEM-ASKED-CHOOSE-PLAN-D1').expect.choices);
    expect(out.actions).toEqual([
      ...own.map((id) => ({ id: planPickChipId(id), label: q(labelsOf(c)[id]), message: `Run a pre-mortem on ${q(labelsOf(c)[id])}.` })),
      TALK_IT_THROUGH_CHIP,
    ]);
    // The button id never carries the user's words: a 12-hex hash after the prefix.
    for (const a of out.actions.slice(0, -1)) expect(a.id).toMatch(new RegExp(`^${PLAN_PICK_PREFIX}[0-9a-f]{12}$`));
  });

  it('ROW M3 PAIR (served D1): pressing a button runs on THAT option, user-selected, with no DSK badge (a pick is not a winner)', () => {
    const c = served('A-STRENGTHEN-PLACEHOLDER-P1');
    for (const id of c.expected_state['model.non_sq_option_ids'] as string[]) {
      const out = turnFor(c, planPickChipId(id));
      expect(out?.kind).toBe('run');
      if (out?.kind !== 'run') return;
      expect(out.context.plan).toEqual({ option_id: id, label: labelsOf(c)[id], basis: 'user_selected' });
      expect(out.context.dsk).toBeNull();
      expect(out.context.not_cited).toBe('no_identified_plan');
      expect(out.context.supplied_items.length).toBeGreaterThan(0);
    }
  });

  it('ROW M4 PAIR (served D2): a press naming the STATUS QUO or an unknown id is no pick: the user is asked; their own option runs', () => {
    const c = served('A-D2-RUN2-WIDEN-P1');
    const sq = c.expected_state['model.status_quo_option_id'] as string;
    const own = (c.expected_state['model.non_sq_option_ids'] as string[])[0];
    for (const chip of [planPickChipId(sq), planPickChipId('not_an_option'), `${PLAN_PICK_PREFIX}zzz`]) {
      expect(turnFor(c, chip)?.kind, chip).toBe('choose_plan');
    }
    const ran = turnFor(c, planPickChipId(own));
    expect(ran?.kind).toBe('run');
    expect(ran?.kind === 'run' && ran.context.plan.option_id).toBe(own);
  });

  it('ROW M5 SERVED D3 (leader LICENSED): the generic press runs on the licensed leader, asks nothing; one own option → no P-001', () => {
    const c = served('A-WHAT-CHANGES-NONE-MEASURABLE-SILENT');
    const out = turnFor(c, PREMORTEM_PRESS_ID);
    expect(out?.kind).toBe('run');
    if (out?.kind !== 'run') return;
    expect(out.context.plan.basis).toBe('licensed_leader');
    expect(out.context.plan.option_id).toBe(c.body.analysis_result?.leading_option_id ?? c.body.analysis_result?.data?.leading_option_id);
    expect(out.context.not_cited).toBe('single_option');
  });

  it('ROW M6 CONTROL: no other chip, and no chip at all, is a method turn', () => {
    const c = served('A-STRENGTHEN-PLACEHOLDER-P1');
    for (const chip of [undefined, null, '', 'agent-next-strengthen', 'agent-next-what-would-change', 'agent-approve-proposal:x', 42]) {
      expect(turnFor(c, chip), String(chip)).toBeNull();
      expect(methodPressOf(chip, ['a'])).toBeNull();
    }
  });
});

describe('the ONE canonical stage (no stage → no citation)', () => {
  it('ROW M7 SERVED: a current Run on a 2+ option graph is `decide`; a stale one is not; an unread run state is no stage', () => {
    const current = served('A-STRENGTHEN-PLACEHOLDER-P1').body;
    const stale = served('A-STALE-SILENT').body;
    expect(current.analysis_state.run_state.kind).toBe('complete_current');
    expect(canonicalStageOf('complete_current', current.draft_graph)).toBe('decide');
    expect(stale.analysis_state.run_state.kind).toBe('complete_stale');
    expect(canonicalStageOf('complete_stale', stale.draft_graph)).toBe('frame');
    expect(canonicalStageOf(null, current.draft_graph)).toBeNull();
    expect(canonicalStageOf('never_run', current.draft_graph)).toBe('frame');
  });

  it('ROW M8 PAIR (RC licensed state, 2 own options, on the served D3 graph): `decide` cites P-001 + the blind-spot step; the same press with no run state cites nothing', () => {
    const graph = served('A-STALE-SILENT').body.draft_graph;
    const state = methodState({ ...rcCase('A-PREMORTEM-LICENSED').state, 'model.non_sq_option_ids': ['phased_gcp_migration', 'switch_to_gcp'] });
    const cited = methodTurnFromSignals(PREMORTEM_PRESS_ID, state, graph);
    expect(cited?.kind).toBe('run');
    if (cited?.kind !== 'run') return;
    expect(cited.context.dsk?.protocol_id).toBe('DSK-P-001');
    expect(cited.directive).toContain(cited.context.dsk!.protocol_directive);
    expect(cited.directive).toContain(cited.context.dsk!.blind_spot_step!);
    const unread = methodTurnFromSignals(PREMORTEM_PRESS_ID, { ...state, 'run.kind': null }, graph);
    expect(unread?.kind === 'run' && unread.context.dsk).toBeNull();
    expect(unread?.kind === 'run' && unread.context.not_cited).toBe('no_canonical_stage');
  });
});

describe('the directive: RC\'s method, grounded items, no other option', () => {
  it('ROW M9 (served D1 pick): names the plan and every supplied item by its words, never another option, and states the checker\'s rules', () => {
    const c = served('A-STRENGTHEN-PLACEHOLDER-P1');
    const [plan, other] = c.expected_state['model.non_sq_option_ids'] as string[];
    const out = turnFor(c, planPickChipId(plan));
    if (out?.kind !== 'run') throw new Error('expected a run');
    const d = out.directive;
    expect(d).toContain(`The plan to stress-test is ${q(labelsOf(c)[plan])}.`);
    expect(d).not.toContain(labelsOf(c)[other]);
    for (const item of out.context.supplied_items) for (const label of item.labels) expect(d).toContain(q(label));
    expect(d).toContain(POLICY.method_turns['RC-PREMORTEM'].format);
    expect(d).toContain('Outside the model');
    expect(d).not.toContain('%');
    expect(d).not.toMatch(/\b[a-z0-9_]+->[a-z0-9_]+\b/u); // never an internal id
  });
});

describe('settle: the draft is checked BEFORE it is sent (RC method_turns.shared.runtime)', () => {
  const turnOf = (f: RcReply): RunMethodTurn => {
    const context = {
      method: 'pre_mortem' as const, dsk: null, not_cited: 'no_identified_plan' as const,
      plan: { option_id: 'plan', label: f.inputs.plan_label, basis: 'user_selected' as const },
      goal_label: null, current_option_labels: f.inputs.current_option_labels,
      supplied_items: f.inputs.supplied_items, supplied_figures: [],
    };
    return {
      kind: 'run', context, directive: methodDirective(context),
      check_inputs: { plan_label: f.inputs.plan_label, current_option_labels: f.inputs.current_option_labels, supplied_items: f.inputs.supplied_items.map(({ id, labels }) => ({ id, labels })) },
    };
  };

  for (const f of RC_REPLIES) {
    it(`ROW M10 RC REPLY ${f.id}: ${f.expect === 'pass' ? 'sent as drafted; the card acts on the lowest-index story target' : 'replaced by RC\'s fallback; the card acts on the first item'}`, () => {
      const turn = turnOf(f);
      const out = settleMethodTurn(turn, f.reply);
      const items = f.inputs.supplied_items;
      if (f.expect === 'pass') {
        expect(out.passed).toBe(true);
        expect(out.reply).toBe(f.reply);
        const lowest = Math.min(...f.expect_targets.map((t) => items.findIndex((i) => i.id === t)));
        expect(out.target).toEqual(items[lowest]);
      } else {
        expect(out.passed).toBe(false);
        for (const id of f.failing_checks ?? []) expect(out.failed).toContain(id);
        expect(out.reply).not.toBe(f.reply);
        expect(out.reply).toBe(`Imagine ${q(f.inputs.plan_label)} has gone badly. Start with how ${q(items[0].labels[0])} affects ${q(items[0].labels[1])}: how would you notice it early, and what would you do?`);
        expect(out.target).toEqual(items[0]);
      }
    });
  }

  it('ROW M11 PAIR: the card acts on the LOWEST-index story target, wherever that story sits (swap the two stories → same card)', () => {
    const good = RC_REPLIES.find((f) => f.id === 'MT-PREMORTEM-GOOD')!;
    const items = good.inputs.supplied_items;
    const indices = good.expect_targets.map((t) => items.findIndex((i) => i.id === t));
    expect(indices[0]).toBeLessThan(indices[1]);
    const lines = good.reply.split('\n');
    const n1 = lines.findIndex((l) => l.startsWith('1. '));
    const n2 = lines.findIndex((l) => l.startsWith('2. '));
    const swapped = [...lines];
    swapped[n1] = `1. ${lines[n2].slice(3)}`;
    swapped[n2] = `2. ${lines[n1].slice(3)}`;
    const before = settleMethodTurn(turnOf(good), good.reply);
    const after = settleMethodTurn(turnOf(good), swapped.join('\n'));
    expect(before.passed && after.passed).toBe(true);
    expect(after.reply).not.toBe(before.reply);
    expect(after.target).toEqual(items[indices[0]]);
    expect(before.target).toEqual(items[indices[0]]);
  });

  it('ROW M13 SERVED D1 (RC label masking, 5938455358): a story naming the user\'s own "…likelihood" factor is grounding, not a probability; Olumi\'s own "likely" still fails', () => {
    const out = turnFor(served('A-Q-D1-BUILD'), planPickChipId('ai_reporting_module_sprint'));
    if (out?.kind !== 'run') throw new Error('expected a run');
    const [i0, , i2] = out.context.supplied_items;
    expect(i0.labels.join(' ')).toMatch(/likelihood/iu);
    const reply = (extra: string) => ['Two ways this could go wrong.',
      `1. ${i2.labels[0]} stayed thin, so ${i2.labels[1]} slipped${extra}. Watch for: a missed demo. Mitigate: protect the sprint.`,
      `2. ${i0.labels[0]} came late and ${i0.labels[1]} never moved. Watch for: prospects asking for dates. Mitigate: share a roadmap early.`,
      'Outside the model: what could blindside this that none of these figures covers?'].join('\n');
    const grounded = settleMethodTurn(out, reply(''));
    expect(grounded.failed).toEqual([]);
    expect(grounded.target.id).toBe(i0.id);
    const claimed = settleMethodTurn(out, reply(', which was likely'));
    expect(claimed.failed).toContain('PM-NO-PROB');
  });

  it('ROW M12: an empty or garbled draft is never sent', () => {
    const turn = turnOf(RC_REPLIES.find((f) => f.id === 'MT-PREMORTEM-GOOD')!);
    for (const draft of ['', '   ', 'Sure! Here is a pre-mortem.']) {
      const out = settleMethodTurn(turn, draft);
      expect(out.passed).toBe(false);
      expect(out.reply.startsWith('Imagine ')).toBe(true);
    }
  });
});

describe('the ONE change card, through the existing door (RC action_target; HARNESS 5937421801)', () => {
  const D3 = served('A-Q-D3-BUILD');
  const run = () => {
    const out = turnFor(D3, planPickChipId('switch_to_gcp'));
    if (out?.kind !== 'run') throw new Error('expected a run');
    return out;
  };
  const toolSchema = (name: string) => (AGENT_TOOLS.find((t) => (t as { name?: string }).name === name) as unknown as { parameters: any }).parameters;
  const nodeLabel = (id: unknown) => (D3.body.draft_graph.nodes as { id: string; label: string }[]).find((n) => n.id === id)!.label;

  it('ROW C1 SERVED D3: every link item becomes ONE propose_link_strengths link at the band the WRITER reads as current, labels by the graph', () => {
    const links = run().context.supplied_items.filter((i) => i.kind === 'link');
    expect(links.length).toBeGreaterThan(0);
    const bandEnum = toolSchema('propose_link_strengths').properties.links.items.properties.strength.enum as string[];
    for (const item of links) {
      const edge = (D3.body.draft_graph.edges as { from: string; to: string; strength: { mean: number } }[]).find((e) => `${e.from}->${e.to}` === item.id)!;
      const card = cardCallFor(item, D3.body.draft_graph, 'Run a pre-mortem');
      expect(card?.tool).toBe('propose_link_strengths');
      if (card?.tool !== 'propose_link_strengths') return;
      expect(card.args.links).toEqual([{ from_label: nodeLabel(edge.from), to_label: nodeLabel(edge.to), strength: edgeBandFromMagnitude(Math.abs(edge.strength.mean)) }]);
      expect([nodeLabel(edge.from), nodeLabel(edge.to)]).toEqual(item.labels);
      expect(bandEnum).toContain(card.args.links[0].strength);
      expect(Object.keys(card.args.links[0])).not.toContain('from_words');
      expect(card.args.rationale).toBe('Run a pre-mortem');
    }
  });

  it('ROW C2 PAIR (served sign): a NEGATIVE link is offered at the band of its size, never of its sign', () => {
    const item = run().context.supplied_items.find((i) => i.id === 'monthly_cloud_savings->monthly_spend')!;
    const card = cardCallFor(item, D3.body.draft_graph, 'x');
    expect(card?.tool === 'propose_link_strengths' && card.args.links[0].strength).toBe('moderate');
    expect(edgeBandFromMagnitude(-0.3555555555555555)).toBe('weak'); // the sign would have said 'weak'
  });

  it('ROW C3 SERVED D1 + D3: each factor item becomes ONE propose_assumptions keep of Olumi\'s STORED `value` (never `raw_value`), valid against the tool schema', () => {
    const required = toolSchema('propose_assumptions').properties.assumptions.items.required as string[];
    let contrast = 0;
    for (const [c, pick] of [[D3, 'switch_to_gcp'], [served('A-Q-D1-BUILD'), 'ai_reporting_module_sprint']] as const) {
      const out = turnFor(c, planPickChipId(pick));
      if (out?.kind !== 'run') throw new Error('expected a run');
      for (const item of out.context.supplied_items.filter((i) => i.kind === 'factor')) {
        const node = (c.body.draft_graph.nodes as { id: string; label: string; observed_state: { value: number; unit: string; raw_value?: number } }[]).find((n) => n.id === item.id)!;
        const card = cardCallFor(item, c.body.draft_graph, 'x');
        expect(card, item.id).toEqual({ tool: 'propose_assumptions', args: { assumptions: [{
          factor_label: node.label, value: node.observed_state.value, unit: node.observed_state.unit, basis: 'Olumi\u2019s current estimate', keep: true }] } });
        if (card?.tool === 'propose_assumptions') for (const key of required) expect(card.args.assumptions[0]).toHaveProperty(key);
        if (node.observed_state.raw_value !== undefined && node.observed_state.raw_value !== node.observed_state.value) contrast += 1;
      }
    }
    expect(contrast).toBeGreaterThan(0); // D1's signing likelihood: value 0.1, raw_value 10
  });

  it('ROW C4 SERVED D2: a risk and a limit get NO card in v1 (their label would be model text); the turn offers Talk it through only', () => {
    const out = turnFor(served('A-D2-RUN2-WIDEN-P1'), planPickChipId('angel_investor_outreach'));
    if (out?.kind !== 'run') throw new Error('expected a run');
    const kinds = out.context.supplied_items.map((i) => i.kind);
    expect(kinds).toContain('risk');
    expect(kinds).toContain('limit');
    for (const item of out.context.supplied_items.filter((i) => i.kind === 'risk' || i.kind === 'limit')) {
      expect(cardCallFor(item, served('A-D2-RUN2-WIDEN-P1').body.draft_graph, 'x'), item.id).toBeNull();
    }
  });

  it('ROW C5 FAIL-CLOSED PAIR: a link the graph no longer holds, or a factor with no stored figure, gets no card', () => {
    const items = run().context.supplied_items;
    const link = items.find((i) => i.kind === 'link')!;
    const factor = items.find((i) => i.kind === 'factor')!;
    const g = D3.body.draft_graph;
    expect(cardCallFor(link, g, 'x')).not.toBeNull();
    expect(cardCallFor(link, { ...g, edges: g.edges.filter((e: { from: string; to: string }) => `${e.from}->${e.to}` !== link.id) }, 'x')).toBeNull();
    expect(cardCallFor(factor, g, 'x')).not.toBeNull();
    const blank = { ...g, nodes: g.nodes.map((n: { id: string }) => (n.id === factor.id ? { ...n, observed_state: { unit: 'person-weeks' } } : n)) };
    expect(cardCallFor(factor, blank, 'x')).toBeNull();
    expect(cardCallFor(link, null, 'x')).toBeNull();
  });
});
