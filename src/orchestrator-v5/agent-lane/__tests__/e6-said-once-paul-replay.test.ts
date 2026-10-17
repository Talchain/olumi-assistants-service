/**
 * E6 (S7 coaching; DL 12 Oct from Paul's manual test, recovery/paul-test-20261012 rows e, f1, f2).
 *
 * Served (staging c85817f2, scenario 4184e877; `fixtures/paul-hiring-4184e877.json`, read SELECT-only):
 *   - RC-WIDEN W6 was recorded `offered` with ONE state key (c39931bcb63d) on 8 replies in a row. Each carried the same
 *     "Why?" and the "Suggest risks" chip, because only a press, dismiss or complete started the cooldown.
 *   - Olumi's draft-time risk "Developer onboarding burdens team" was added to the model OUT of the Run
 *     (`retained_excluded`), and the reply then had to say the Run leaves it out.
 * Now:
 *   (1) a row and its Why? are said once per state; a shown item cools only itself, so the next item may follow
 *       (Batch R round 2: E6's whole-policy item rule was removed after the independent check, CHECK-R P1);
 *   (2) the same holds for the chip: the build reply's thin-draft risks offer counts as RC-WIDEN's risks row shown;
 *   (3) E6 parked the draft-time risk; it is RESTORED (Paul #94 6166259456). Beside a widened risk the thin-draft offer is
 *       not made: Paul's served graph held ONE risk, Olumi's own, and the offer read "Olumi found one risk in your brief".
 *
 * The replay drives the real selector, wire, Why? and chip functions over Paul's own stored graph and turn sequence;
 * the per-turn glue mirrors the route (`agent-v1-turn.ts` guidance + thin-offer lines). No new strings.
 */
import { describe, expect, it, vi } from 'vitest';
import paul from './fixtures/paul-hiring-4184e877.json';
import { selectTurnGuidance, eligibleInterventionFor, type GuidanceWire } from '../turn-context/guidance-wire.js';
import { guidanceHistoryOf, guidanceOnAnswer, thinDraftShownWire, type AnswerGuidance } from '../turn-context/guidance-history.js';
import { nextStepsFromGuidance } from '../next-steps-from-guidance.js';
import { thinDraftOffer, SUGGEST_RISKS_CHIP } from '../method-turn/widen-turn.js';
import { diagnoseDraft, widenDraft } from '../runtime/widen-draft.js';
import type { AdmittedModel } from '../admit-model.js';
import type { CallStructuredModel } from '../runtime/build-model.js';
import { NEXT_STEP_CHIPS } from '../../../routes/agent-v1-turn.js';

type Node = Record<string, unknown> & { id: string; kind: string };
type Graph = { nodes: Node[]; edges: Record<string, unknown>[] };
const SERVED = paul.graph as unknown as Graph;
/** E6's own draft: the same build, without the draft-time risk E6 no longer adds. */
const E6_DRAFT: Graph = { ...SERVED, nodes: SERVED.nodes.filter(n => n.kind !== 'risk') };
const KINDS = paul.served_answers.map(a => a.kind);

type Reply = { turn: number; kind: string; row?: string; why?: string; risksChip: boolean };
const select = (graph: Graph, history: AnswerGuidance[]): GuidanceWire | undefined =>
  selectTurnGuidance({ request: 'turn', offeredSpecific: [], licence: 'withheld', guidance: guidanceHistoryOf(history), state: { graph } });

/** Paul's 13 replies, in order: construction, ordinary turns, the deadline approval and the "Suggest risks" press. */
function replay(graphAt: (turn: number) => Graph, history: AnswerGuidance[] = []): Reply[] {
  return KINDS.map((kind, i) => {
    const graph = graphAt(i + 1);
    const state = guidanceHistoryOf(history);
    let wire: GuidanceWire | undefined; let chips: string[] = []; let answer: AnswerGuidance | undefined;
    if (kind === 'construction') {
      const thin = thinDraftOffer(graph, true);
      chips = thin === null ? [] : [thin.press.id];
      answer = guidanceOnAnswer(thin === null ? undefined : thinDraftShownWire(select(graph, history)), state);
    } else if (kind === 'turn') {
      wire = select(graph, history);
      chips = nextStepsFromGuidance(NEXT_STEP_CHIPS, wire, false).map(c => c.id);
      answer = guidanceOnAnswer(wire, state);
    } else if (kind === 'press_suggest_risks') {
      answer = guidanceOnAnswer(undefined, state, { policy_id: 'RC-WIDEN' });
    }
    if (answer !== undefined) history.unshift(answer);
    const row = wire?.slot1;
    return { turn: i + 1, kind, risksChip: chips.includes(SUGGEST_RISKS_CHIP.id),
      ...(row ? { row: `${row.policy_id}/${row.variant ?? ''}/${row.item ?? ''}/${row.state_key_hash}` } : {}),
      ...(eligibleInterventionFor(wire)?.why !== undefined ? { why: eligibleInterventionFor(wire)!.why } : {}) };
  });
}

describe('E6 replay of Paul\'s served session: each suggestion and its Why? are said once', () => {
  it('IDENTITY: the replay\'s rows ARE the served rows (W6 c39931bcb63d; S3L entry deb43dafd281, key d44e7cf3e76d)', () => {
    const served = paul.served_answers.flatMap(a => Object.entries(a.agent_guidance ?? {}).map(([k, v]) => `${k}=${v.state_key_hash}`));
    expect(new Set(served)).toEqual(new Set(['RC-WIDEN=c39931bcb63d', 'RC-STRENGTHEN-ITEM:deb43dafd281=d44e7cf3e76d']));
    expect(served.filter(s => s === 'RC-WIDEN=c39931bcb63d'), 'served: W6 offered 8 times, then pressed').toHaveLength(9);
    const history: AnswerGuidance[] = [];
    const first = replay(() => SERVED, history);
    // The served graph's only risk is Olumi's widened one, so construction makes no thin offer (it would call it the brief's);
    // W6 is still shown once, by the selector, under the same served key.
    expect(first[0]!.risksChip, 'no thin offer beside Olumi\'s widened risk').toBe(false);
    const recorded = history.flatMap(h => Object.entries(h.entries).map(([k, v]) => `${k}=${v.state_key_hash}`));
    expect(recorded).toContain('RC-WIDEN=c39931bcb63d');
    expect(recorded).toContain('RC-STRENGTHEN-ITEM:deb43dafd281=d44e7cf3e76d');
  });

  for (const [name, graph] of [['served build (with Olumi\'s draft-time risk)', SERVED], ['E6 build (no draft-time risk)', E6_DRAFT]] as const) {
    it(`${name}: the risks suggestion is shown in ONE reply, and no row (with its Why?) repeats across 13 replies`, () => {
      const replies = replay(() => graph);
      const offered = replies.filter(r => r.risksChip).map(r => r.turn);
      expect(offered, 'the "Suggest risks" offer, once').toHaveLength(1);
      // Construction offers it only where no widened risk is on the draft (the served graph's one risk is Olumi's).
      if (graph === E6_DRAFT) expect(offered).toEqual([1]);
      else expect(offered).not.toContain(1);
      const rows = replies.flatMap(r => r.row === undefined ? [] : [r.row]);
      expect(new Set(rows).size, `each row once: ${JSON.stringify(rows)}`).toBe(rows.length);
      // Batch R round 2 (independent check P1): the whole-policy item rule is removed. Items cool per item and fall through,
      // so two different Strengthen items may each carry the policy's one Why? text once; a row never repeats.
    });
  }

  it('RE-ARMS only on a relevant change: a new option changes W6\'s key, so its row returns once (and only once)', () => {
    const history: AnswerGuidance[] = [];
    replay(() => E6_DRAFT, history);
    const option = { id: 'event_option_4', kind: 'option', label: 'Use contractors', provenance: 'from_brief',
      interventions: { event_capacity_1: { value: 0 }, event_capacity_2: { value: 1 } } };
    const changed: Graph = { ...E6_DRAFT, nodes: [...E6_DRAFT.nodes, option] };
    const again = select(changed, history);
    expect(again?.slot1?.policy_id).toBe('RC-WIDEN');
    history.unshift(guidanceOnAnswer(again, guidanceHistoryOf(history))!);
    expect(select(changed, history)?.slot1?.policy_id, 'said once for the new state too').not.toBe('RC-WIDEN');
  });
});

describe('E6 (3): with the risks arm unset, nothing is added; the thin-draft offer suggests it (the served build now sets both arms)', () => {
  it('Paul\'s draft is risk-deficient; with no arm set, widening adds no risk and makes no call; the thin-draft offer suggests it', async () => {
    expect(diagnoseDraft(E6_DRAFT).risks, 'POSITIVE CONTROL: the deficiency the served build widened on').not.toBeNull();
    const provider = vi.fn<CallStructuredModel>();
    const admit = vi.fn(() => { throw new Error('no re-admission expected'); });
    const out = await widenDraft({ admitted: { nodes: E6_DRAFT.nodes, edges: E6_DRAFT.edges, goal_constraints: [] } as unknown as AdmittedModel,
      candidate: {} as never, brief: 'We need to decide whether to hire a Tech lead or two developers.',
      constructionInput: 'We need to decide whether to hire a Tech lead or two developers.', callStructured: provider,
      deadlineAt: Date.now() + 60_000, admit });
    expect(out).toBeNull();
    expect(provider).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
    const thin = thinDraftOffer(E6_DRAFT, true);
    expect(thin?.press.id).toBe(SUGGEST_RISKS_CHIP.id);
    expect(thin?.face).toBe('Olumi found no risks in your brief.');
  });
});
