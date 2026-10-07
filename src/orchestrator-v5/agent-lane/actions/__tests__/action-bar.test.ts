import { legacyDoorGraph } from '../../__tests__/licence-test-graphs.js';
/**
 * ⭐ S-B — the registry, the ranker and the press dispatcher, pure (lane ACTION-BAR-CEE; ACTION-SYSTEM-DRAFT §C/§D/§E;
 * github-a2 contract amendments 1–11 + v1.1). The route rows (every press typed, reload === live, stale offers, double
 * presses, captured fixtures) are in `action-bar-route.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import served from '../../__tests__/fixtures/m1-s1-served-graphs.json';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { eligibleGuidanceRows, selectGuidance } from '../../guidance/index.js';
import { ACTION_IDS, ACTION_REGISTRY, STANDARD_ACTIONS, actionOfPress, isUnknownActionPress, type ActionId } from '../registry.js';
import { actionFactsOf, type ActionRead } from '../state.js';
import { actionBarOf, currentOfferFor, offerKeyOf, sayDate, type ActionBarV1 } from '../rank.js';
import { HANDLERS, decidePress } from '../handlers.js';

const D1 = served.cases.find((c) => c.id === 'D1-sprint-run')!;
const D3 = served.cases.find((c) => c.id === 'D3-cost-run')!;
// Science 393023 LICENCE (a)/(b), 7 Oct: std 0.125 → 0.1 on a clone keeps the independent nothing-in-scope controls.
const legacyD3 = () => legacyDoorGraph(D3.graph);
const SCENARIO = '7d2e3f40-5b6c-4d7e-8f90-a1b2c3d4e5f6';
const AT = '2026-10-07T12:00:00.000Z';
const PARTICIPATION = [{ option_id: 'split_sprint_capacity', state: 'excluded_olumi_proposed' }];
type G = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
const hashOf = (g: unknown) => computeAnalysisAffectingGraphHash(g as never)!;

/** A bound current Run on this graph: the Explain control's own binding holds. */
function ran(graph: unknown, claim: Record<string, unknown>): ActionRead {
  const h = hashOf(graph);
  return {
    scenarioId: SCENARIO, graph, graphHash: h,
    analysisState: { run_state: { kind: 'complete_current', computed_at: AT }, usable_for_chips: true, leader_claim: claim },
    analysisReady: { status: 'ready', may_run: true },
    analysisResult: { type: 'analysis_result', computed_against_hash: h, data: {} },
    optionParticipation: PARTICIPATION,
  };
}
const preRun = (graph: unknown): ActionRead => ({ scenarioId: SCENARIO, graph, graphHash: hashOf(graph), analysisReady: { status: 'ready', may_run: true } });
const WITHHELD = { permitted: false, withheld_reason: 'goal_path_unsized' };
const bar = (read: ActionRead) => actionBarOf(actionFactsOf(read));
const offers = (b: ActionBarV1) => [...b.priority, ...b.standard, ...b.more];
const ids = (list: readonly { action_id: string }[]) => list.map((o) => o.action_id);

describe('the registry: ONE dispatch table, total', () => {
  it('every action has its handler (tsc enforces the Record; this row pins the names)', () => {
    expect(Object.keys(HANDLERS).sort()).toEqual([...ACTION_IDS].sort());
  });
  it('slice 1 is exactly the §E.4 set: review, what_changes, strengthen (S1), pre_mortem, more_options, test_link', () => {
    expect([...ACTION_IDS]).toEqual(['review', 'what_changes', 'strengthen', 'pre_mortem', 'more_options', 'test_link']);
    for (const held of ['frame_brief', 'set_target', 'check_estimates', 'more_risks', 'outside_view', 'trade_offs', 'bias_check', 'anchoring']) {
      expect((ACTION_IDS as readonly string[]).includes(held), held).toBe(false);
    }
  });
  it('every fixed press id maps back to its own action, by identity; the existing ids are kept', () => {
    const fixed = Object.fromEntries(ACTION_IDS.flatMap((id) => {
      const p = ACTION_REGISTRY[id].press;
      return p.kind === 'fixed' ? [[id, p.id]] : [];
    }));
    expect(fixed).toEqual({ review: 'agent-next-review-decision', what_changes: 'agent-next-what-would-change', strengthen: 'agent-next-strengthen',
      pre_mortem: 'agent-next-pre-mortem', more_options: 'agent-next-widen' });
    for (const [id, press] of Object.entries(fixed)) expect(actionOfPress(press)).toBe(id);
    expect(actionOfPress('agent-test-without-link:["a","b"]')).toBe('test_link');
  });
  it('an act: id the registry does not hold is an action press (never a free turn); ask:*, approvals and plain ids are not', () => {
    expect(isUnknownActionPress('act:frame_brief')).toBe(true);
    expect(actionOfPress('act:frame_brief')).toBeUndefined();
    // S-C WIDEN #2744's own presses (risks door, canvas asks, per-item Add) never collide with a registry press id.
    for (const other of ['ask:method-reframe', 'agent-approve-proposal:prop_1', 'agent-run-analysis', 'agent-next-suggest-risks', 'ask:risks', 'ask:widen',
      'agent-widen-add:0123456789abcdef', 'agent-widen-something-else', undefined, 7]) {
      expect(actionOfPress(other), String(other)).toBeUndefined();
      expect(isUnknownActionPress(other), String(other)).toBe(false);
    }
  });
  it('labels ≤24 chars and ≤2 words; user lines ≤200; no default year anywhere (contract v1.1 item 4)', () => {
    for (const id of ACTION_IDS) {
      const e = ACTION_REGISTRY[id];
      expect(e.label.length, id).toBeLessThanOrEqual(24);
      expect(e.label.split(/\s+/).length, id).toBeLessThanOrEqual(2);
      expect(e.user_line.length, id).toBeLessThanOrEqual(200);
      expect(e.user_line, id).not.toMatch(/\byear\b/i);
    }
  });
});

describe('the ranker: same read → byte-identical bar; a changed revision → a different state_key', () => {
  const reads: [string, ActionRead][] = [
    ['pre-run D1', preRun(D1.graph)], ['withheld D1', ran(D1.graph, WITHHELD)], ['licensed D3', ran(legacyD3(), { permitted: true, separation: 'separated' })],
    ['unreadable', { scenarioId: SCENARIO, graph: { nodes: 'x' } }],
  ];
  it.each(reads)('%s: two derivations from independent copies are byte-identical', (_name, read) => {
    const a = JSON.stringify(bar(structuredClone({ ...read, identityEvaluated: undefined })));
    const b = JSON.stringify(bar(structuredClone({ ...read, identityEvaluated: undefined })));
    expect(a).toBe(b);
    expect(JSON.parse(a).v).toBe(1);
  });
  it('the state_key moves with the graph and with the Run, and with nothing else', () => {
    const base = bar(ran(D1.graph, WITHHELD));
    const edited = structuredClone(D1.graph) as G;
    edited.edges[0]!.strength = { mean: 0.91, std: 0.05 };
    expect(hashOf(edited), 'precondition: an analysis-affecting edit').not.toBe(hashOf(D1.graph));
    expect(bar(ran(edited, WITHHELD)).state_key).not.toBe(base.state_key);
    expect(bar(preRun(D1.graph)).state_key, 'no Run → another revision').not.toBe(base.state_key);
    expect(bar({ ...ran(D1.graph, WITHHELD), guidance: { 'RC-PREMORTEM': { status: 'pressed', state_key_hash: '000000000000' } } }).state_key,
      'history is not the revision').toBe(base.state_key);
    expect(base.revision).toEqual({ graph_hash: hashOf(D1.graph), run_key: expect.stringMatching(/^[0-9a-f]{16}$/) });
  });
  it('RED (Codex r1 P2-5): a change of the goal\'s date alone (outside graph_hash) moves state_key and the pre-mortem offer_key', () => {
    const at = (deadline: string) => {
      const g = structuredClone(D1.graph) as G;
      (g.nodes.find((n) => n.kind === 'goal') as Record<string, unknown>).goal_horizon = { deadline };
      return bar(preRun(g));
    };
    const april = at('2027-04-07'); const may = at('2027-05-07');
    expect(april.revision.graph_hash, 'precondition: the date is outside graph_hash').toBe(may.revision.graph_hash);
    expect(may.state_key).not.toBe(april.state_key);
    const key = (b: ActionBarV1) => offers(b).find((o) => o.action_id === 'pre_mortem')!.offer_key;
    expect(key(may)).not.toBe(key(april));
  });
  it('an offer key binds the Run only for a Run-dependent action (§E.1)', () => {
    const before = actionFactsOf(ran(D1.graph, WITHHELD));
    const later = actionFactsOf({ ...ran(D1.graph, WITHHELD), analysisState: { run_state: { kind: 'complete_current', computed_at: '2026-10-07T13:00:00.000Z' }, leader_claim: WITHHELD } });
    expect(later.revision.run_key).not.toBe(before.revision.run_key);
    expect(offerKeyOf(later, 'pre_mortem')).toBe(offerKeyOf(before, 'pre_mortem'));
    expect(offerKeyOf(later, 'more_options')).toBe(offerKeyOf(before, 'more_options'));
    expect(offerKeyOf(later, 'review')).not.toBe(offerKeyOf(before, 'review'));
  });
});

describe('the layout contract (github-a2 amendments 3–4; §E.2)', () => {
  const states: [string, ActionRead][] = [
    ['pre-run D1', preRun(D1.graph)], ['withheld D1 (S1 card)', ran(D1.graph, WITHHELD)], ['licensed D3 (no S1 link)', ran(legacyD3(), { permitted: true, separation: 'separated' })],
    ['no graph', { scenarioId: SCENARIO, graph: null }],
  ];
  it.each(states)('%s: priority holds no standard id; (action, target) is unique; every offer is complete', (_n, read) => {
    const b = bar(read);
    expect(b.priority.length).toBeLessThanOrEqual(2);
    for (const o of b.priority) expect((STANDARD_ACTIONS as readonly string[]).includes(o.action_id), o.action_id).toBe(false);
    expect(ids(b.standard)).toEqual(STANDARD_ACTIONS.filter((id) => b.standard.some((o) => o.action_id === id)));
    const keys = offers(b).map((o) => JSON.stringify([o.action_id, o.target ?? null]));
    expect(new Set(keys).size).toBe(keys.length);
    for (const o of offers(b)) {
      if (o.enabled) { expect(o.why_now, o.action_id).toBeTruthy(); expect(o.why_now!.length).toBeLessThanOrEqual(90); expect(o.disabled_reason).toBeUndefined(); }
      else { expect(o.disabled_reason, o.action_id).toBeTruthy(); expect(o.why_now).toBeUndefined(); }
      expect(o.offer_key).toMatch(/^[0-9a-f]{16}$/);
      expect(o.press_id).toBe(o.action_id === 'test_link' ? expect.stringMatching(/^agent-test-without-link:/) : (ACTION_REGISTRY[o.action_id].press as { id: string }).id);
    }
  });
  it('before a Run: Review / What changes / Strengthen say "Needs a current analysis."; Pre-mortem and More options run', () => {
    const b = bar(preRun(D1.graph));
    const by = (id: ActionId) => offers(b).find((o) => o.action_id === id)!;
    for (const id of ['review', 'what_changes', 'strengthen'] as const) expect([by(id).enabled, by(id).disabled_reason]).toEqual([false, 'Needs a current analysis.']);
    expect(by('pre_mortem').enabled).toBe(true);
    expect(by('more_options').enabled).toBe(true);
    expect(offers(b).some((o) => o.action_id === 'test_link'), 'no Run, no link to test').toBe(false);
  });
  it('Strengthen is S1 only: enabled with the S1 card (D1); NOT offered on a bound Run with no unsized link (D3)', () => {
    expect(offers(bar(ran(D1.graph, WITHHELD))).find((o) => o.action_id === 'strengthen')?.enabled).toBe(true);
    expect(offers(bar(ran(legacyD3(), { permitted: true, separation: 'separated' }))).some((o) => o.action_id === 'strengthen')).toBe(false);
  });
  it('no goal → Pre-mortem and More options are disabled with a reason the user can act on', () => {
    const g = structuredClone(D3.graph) as G;
    g.nodes = g.nodes.filter((n) => n.kind !== 'goal');
    const b = bar(preRun(g));
    expect(offers(b).find((o) => o.action_id === 'pre_mortem')).toMatchObject({ enabled: false, disabled_reason: 'Needs a goal in the model first.' });
    expect(offers(b).find((o) => o.action_id === 'more_options')).toMatchObject({ enabled: false, disabled_reason: 'Needs a goal in the model first.' });
  });
});

describe('RC is the ranking authority; interaction history is part of the state', () => {
  // One own option besides doing nothing: RC-WIDEN W2 (P1) → More options is the priority pill.
  const oneOption = (() => {
    const g = structuredClone(D3.graph) as G;
    const keep = new Set(['switch_to_gcp', 'stay_on_aws']);
    g.nodes = g.nodes.filter((n) => n.kind !== 'option' || keep.has(n.id as string));
    g.edges = g.edges.filter((e) => g.nodes.some((n) => n.id === e.from) && g.nodes.some((n) => n.id === e.to));
    return g;
  })();
  it('the extension agrees with the selector: its first row is the selector\'s slot1 on an ordinary turn', () => {
    const facts = actionFactsOf(preRun(oneOption));
    expect(facts.rcRows.length).toBeGreaterThan(0);
    expect(facts.rcRows[0]!.policy_id).toBe('RC-WIDEN');
  });
  it('RED→ a widen row P1/P3 puts More options in priority[0] with RC\'s variant reason', () => {
    const b = bar(preRun(oneOption));
    expect(b.priority[0]?.action_id).toBe('more_options');
    expect(b.priority[0]?.why_now).toBe('There is only one option besides doing nothing.');
  });
  it('once pressed at the same state (RC history), it leaves the pills and stays in the menu; a changed state brings it back', () => {
    const facts = actionFactsOf(preRun(oneOption));
    const row = facts.rcRows.find((r) => r.policy_id === 'RC-WIDEN')!;
    const pressed = bar({ ...preRun(oneOption), guidance: { 'RC-WIDEN': { status: 'pressed', state_key_hash: row.state_key_hash } } });
    expect(ids(pressed.priority)).not.toContain('more_options');
    expect(ids(pressed.more)).toContain('more_options');
    const other = bar({ ...preRun(oneOption), guidance: { 'RC-WIDEN': { status: 'pressed', state_key_hash: 'ffffffffffff' } } });
    expect(other.priority[0]?.action_id, 'pressed at ANOTHER state: not cooled').toBe('more_options');
  });
  it('CONTROL: `selectGuidance` itself is unchanged (budget one) on the same signals', () => {
    expect(typeof selectGuidance).toBe('function');
    expect(typeof eligibleGuidanceRows).toBe('function');
  });
});

describe('the pre-mortem line names the horizon the model holds (contract v1.1 item 4)', () => {
  it('a goal with a deadline: "imagine it is 7 April 2027"; none: the registry line, no year', () => {
    const g = structuredClone(D3.graph) as G;
    (g.nodes.find((n) => n.kind === 'goal') as Record<string, unknown>).goal_horizon = { deadline: '2027-04-07' };
    const withDate = offers(bar(preRun(g))).find((o) => o.action_id === 'pre_mortem')!;
    expect(withDate.user_line).toBe('Run a pre-mortem with me: imagine it is 7 April 2027 and this decision went badly. What most plausibly went wrong?');
    expect(offers(bar(preRun(D3.graph))).find((o) => o.action_id === 'pre_mortem')!.user_line).toBe(ACTION_REGISTRY.pre_mortem.user_line);
    expect(sayDate('2026-12-01')).toBe('1 December 2026');
    expect(sayDate('not a date')).toBeNull();
  });
});

describe('the press dispatcher: re-derived on the CURRENT state (amendment 6)', () => {
  it('a stale offer_key whose action still holds RUNS on the current state (never refused on the key alone)', () => {
    const old = bar(preRun(D1.graph));
    const key = offers(old).find((o) => o.action_id === 'pre_mortem')!.offer_key;
    const now = actionFactsOf(ran(D1.graph, WITHHELD));
    expect(offerKeyOf(now, 'pre_mortem')).toBe(key);
    const edited = structuredClone(D1.graph) as G;
    edited.edges[0]!.strength = { mean: 0.91, std: 0.05 };
    const moved = actionFactsOf(ran(edited, WITHHELD));
    expect(offerKeyOf(moved, 'pre_mortem')).not.toBe(key);
    expect(decidePress({ id: 'agent-next-pre-mortem', parameters: { offer_key: key } }, moved).kind).toBe('route');
  });
  it('RED→ Strengthen pressed after an edit made the Run stale → typed "can\'t yet" with the Run as its exit', () => {
    const d = decidePress({ id: 'agent-next-strengthen', parameters: { offer_key: '0123456789abcdef' } }, actionFactsOf(preRun(D1.graph)));
    expect(d).toMatchObject({ kind: 'reply', press: { action: 'strengthen', offer_key: '0123456789abcdef' },
      reply: { reason: 'needs_current_analysis', text: 'I can’t strengthen the model yet: it needs a current analysis first.', exits: [{ kind: 'run' }] } });
  });
  it('Strengthen on a bound Run with nothing in S1 scope → typed reply, with other offers as exits', () => {
    const d = decidePress({ id: 'agent-next-strengthen' }, actionFactsOf(ran(legacyD3(), { permitted: true, separation: 'separated' })));
    expect(d.kind).toBe('reply');
    if (d.kind !== 'reply') return;
    expect(d.reply.reason).toBe('nothing_in_scope');
    expect(d.reply.exits.length).toBeGreaterThan(0);
    expect(d.reply.exits.every((e) => e.kind !== 'offer' || e.offer.enabled)).toBe(true);
  });
  it('Review before a Run → typed "can\'t yet"; a not-runnable model offers "what it still needs", never a Run', () => {
    const d = decidePress({ id: 'agent-next-review-decision' }, actionFactsOf({ ...preRun(D1.graph), analysisReady: { status: 'blocked', may_run: false } }));
    expect(d).toMatchObject({ kind: 'reply', reply: { reason: 'needs_current_analysis', exits: [{ kind: 'what_it_needs' }] } });
  });
  it('an unknown act: id → typed reply naming it unavailable, with working exits', () => {
    const d = decidePress({ id: 'act:outside_view' }, actionFactsOf(ran(D1.graph, WITHHELD)));
    expect(d).toMatchObject({ kind: 'reply', press: { action: null }, reply: { reason: 'unknown_action' } });
  });
  it('own-gated typed handlers keep their own precondition (pre-mortem with no option still goes to RC\'s method turn)', () => {
    expect(decidePress({ id: 'agent-next-pre-mortem' }, actionFactsOf({ scenarioId: SCENARIO, graph: null })).kind).toBe('route');
    expect(decidePress({ id: 'agent-test-without-link:["x","y"]' }, actionFactsOf(preRun(D1.graph))).kind).toBe('route');
  });
  it('CONTROL: ask:* and approval chips are not actions', () => {
    expect(decidePress({ id: 'ask:method-reframe' }, actionFactsOf(preRun(D1.graph))).kind).toBe('not_an_action');
    expect(decidePress(undefined, actionFactsOf(preRun(D1.graph))).kind).toBe('not_an_action');
  });
  it('the current offer is found by (action, target) identity, never by a value another offer could satisfy', () => {
    const b = bar(ran(D1.graph, WITHHELD));
    expect(currentOfferFor(b, 'test_link', { kind: 'link', from_id: 'nope', to_id: 'nope' })).toBeUndefined();
  });
});

it('Science 393023: as-served D3 none → Strengthen enabled and its press routes', () => {
  const read = ran(D3.graph, { permitted: true, separation: 'separated' });
  expect(offers(bar(read)).find(o => o.action_id === 'strengthen')?.enabled).toBe(true);
  expect(decidePress({ id: 'agent-next-strengthen' }, actionFactsOf(read)).kind).toBe('route');
});
