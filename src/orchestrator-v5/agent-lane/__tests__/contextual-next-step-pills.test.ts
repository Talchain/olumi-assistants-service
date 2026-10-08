import { it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SuggestedAction } from '../../compose/types.js';
import { leaderLicenceFromState } from '../../compose/leader-licence.js';
import { isDurableAnswerOffer, METHOD_PRESS_IDS, NEXT_STEP_CHIPS, offersNextSteps, withheldToolsOf, CHIP_TURN_WITHHELD_TOOLS } from '../../../routes/agent-v1-turn.js';
import { nextStepOffersForTurn, nextStepsFromGuidance, SUGGEST_RISKS_CHIP } from '../next-steps-from-guidance.js';
import { widenOffered, nextStepsWithWiden } from '../method-turn/widen-turn.js';
import { answerOffersForReload } from '../answer-offers-reload.js';
import { strengthenCardFor } from '../strengthen-press.js';
import { RUN_EXPLANATION_PREFIX, runExplanationChip } from '../run-explanation.js';
import type { TurnGuidanceInputs } from '../turn-context/guidance-wire.js';

interface Capture {
  assistant_text: string;
  draft_graph: unknown;
  analysis_state: unknown;
  analysis_ready: unknown;
  blocks: Array<{ type: string; [key: string]: unknown }>;
  graph_hash: string;
  option_participation?: unknown;
  suggested_actions: SuggestedAction[];
  narration?: { run_key: string };
  _diagnostic_trace: { fast_path?: string };
  guidance?: { slot1?: { policy_id: string; variant?: string; item?: string; primary_action: { label: string } } };
}
const fixture = (name: string): Capture => JSON.parse(readFileSync(new URL(`./fixtures/contextual-pills/${name}`, import.meta.url), 'utf8')) as Capture;
const sse = JSON.parse(readFileSync(new URL('./fixtures/contextual-pills/sse-bodies.json', import.meta.url), 'utf8')) as Array<{ body: string }>;
const draft = sse.flatMap(capture => capture.body.split('\n').filter(line => line.startsWith('data: '))
  .map(line => JSON.parse(line.slice(6)) as { stage: string; payload?: Capture }))
  .find(event => event.stage === 'COMPLETE')!.payload!;
const example = fixture('turn-002-S4-run1-1791330383007.json');
const strengthen = fixture('turn-003-S6-run1-1791330258897.json');
const nearTie = fixture('turn-003-S1-run1-1791329872317.json');
const proposal = fixture('turn-005-W1-third-1791329935342.json');
const run = fixture('turn-002-P2-run1-1791329859108.json');

// Science 393023 LICENCE (a)/(b), 7 Oct: captured mean-projected links now select S1; captured bytes stay unchanged.
function inputs(capture: Capture, specific: readonly SuggestedAction[] = []): TurnGuidanceInputs {
  return {
    request: capture._diagnostic_trace.fast_path === 'run' ? 'run_result'
      : capture._diagnostic_trace.fast_path === 'explain' ? 'narration' : 'turn',
    offeredSpecific: specific, assistantText: capture.assistant_text,
    licence: leaderLicenceFromState(capture.analysis_state, capture.analysis_ready), guidance: {},
    ...(capture.narration?.run_key !== undefined ? { runKey: capture.narration.run_key } : {}),
    state: { graph: capture.draft_graph, analysisState: capture.analysis_state,
      analysisResult: capture.blocks.find(block => block.type === 'analysis_result'), optionParticipation: capture.option_participation },
  };
}
function compose(capture: Capture, specific: readonly SuggestedAction[] = [], over: Partial<TurnGuidanceInputs> = {}) {
  const i = { ...inputs(capture, specific), ...over };
  const eligible = specific.length === 0 && i.offeredSpecific.length === 0 && offersNextSteps(capture.analysis_state);
  return nextStepOffersForTurn(NEXT_STEP_CHIPS, i, eligible,
    widenOffered({ ...i.state, analysisReady: capture.analysis_ready }), specific);
}

for (const [name, capture] of [['1 W6 T1b draft', draft], ['2 W6 example after Run', example]] as const) {
  it(name + ': the real selection supplies its contextual first offer', () => {
    const { selection, offered } = compose(capture);
    // Science 393023 LICENCE (a)/(b), 7 Oct: draft Suggest risks/W6 → Strengthen/S1; the example stays W6.
    assert.equal(selection?.slot1?.policy_id, capture === draft ? 'RC-STRENGTHEN-ITEM' : 'RC-WIDEN');
    assert.equal(selection?.slot1?.variant, capture === draft ? 'S1' : 'W6');
    assert.equal(selection?.slot1?.target, capture === draft ? undefined : 'risks');
    assert.deepEqual(offered[0], capture === draft ? { ...NEXT_STEP_CHIPS[2], label: 'Give your estimate' } : SUGGEST_RISKS_CHIP);
    assert.equal(offered[0]!.label, selection?.slot1?.primary_action.label);
    assert.equal('action_type' in offered[0]!, false);
    assert.equal(offered.length, 3);
    assert.equal(new Set(offered.map(chip => chip.id)).size, 3);
    assert.deepEqual(withheldToolsOf({ kind: 'message', message: offered[0]!.message, source: 'chip', chip: { id: offered[0]!.id } }), CHIP_TURN_WITHHELD_TOOLS);
  });
}
it('3 served S6 now offers the S1 card and Give your estimate', () => {
  const { selection, offered } = compose(strengthen);
  // Science 393023 LICENCE (a)/(b), 7 Oct: S3L/no card → S1/card on annual advisory service revenue → annual revenue.
  assert.equal(selection?.slot1?.variant, 'S1');
  assert.equal(selection?.slot1?.item, 'annual_advisory_service_revenue->annual_revenue');
  assert.deepEqual(selection?.slot1?.item_ref, { kind: 'link', from_id: 'annual_advisory_service_revenue', to_id: 'annual_revenue' });
  assert.equal(offered[0]!.id, 'agent-next-strengthen');
  assert.ok(strengthenCardFor(inputs(strengthen).state));
  assert.equal(selection?.slot1?.primary_action.label, 'Give your estimate');
  assert.deepEqual(offered[0], { ...NEXT_STEP_CHIPS[2], label: 'Give your estimate' });
  assert.equal(offered[0]!.message, NEXT_STEP_CHIPS[2].message);
  assert.equal(offered.filter(chip => chip.id === 'agent-next-strengthen').length, 1);
});
it('4 W5: the witnessed pills, with the guidance press (Suggest options) leading; once each (DL 7 Oct re-pin)', () => {
  const { selection, offered } = compose(nearTie);
  assert.equal(selection?.slot1?.variant, 'W5');
  // Captured served order was [pre-mortem, Suggest options, strengthen]; cut 7 R3 FAIL 6/6 ruled the press leads.
  assert.deepEqual(offered.map(chip => chip.id), ['agent-next-widen', 'agent-next-pre-mortem', 'agent-next-strengthen']);
  assert.deepEqual([...offered].sort((a, b) => a.id.localeCompare(b.id)),
    [...(nearTie.suggested_actions as typeof offered)].sort((a, b) => a.id.localeCompare(b.id)));
  assert.equal(offered.filter(chip => chip.id === 'agent-next-widen').length, 1);
});
it('5 every composed id survives durable filtering and same-Run reload; stale and waiting suppress', () => {
  assert.equal(isDurableAnswerOffer(SUGGEST_RISKS_CHIP), true);
  for (const capture of [draft, example, strengthen, nearTie]) {
    const offered = compose(capture).offered;
    for (const chip of offered) assert.equal(isDurableAnswerOffer(chip), true, chip.id);
    const i = inputs(capture);
    const scenarioId = 'captured-pill-reload';
    const now = { graphHash: capture.graph_hash, analysisState: capture.analysis_state, analysisResult: i.state.analysisResult,
      analysisReady: capture.analysis_ready, modelExists: true, outstandingProposalIds: new Set<string>() };
    const bound = runExplanationChip(scenarioId, now);
    assert.ok(bound, 'capture must bind to a current canonical Run');
    const stored = { turn_id: 'captured-answer', run_key: bound.id.slice(RUN_EXPLANATION_PREFIX.length), suggested_actions: offered.filter(isDurableAnswerOffer) };
    assert.deepEqual(answerOffersForReload(stored, scenarioId, now), offered);
    assert.deepEqual(answerOffersForReload(stored, scenarioId, { ...now, analysisState: { run_state: { kind: 'stale' } } }), []);
    assert.deepEqual(answerOffersForReload(stored, scenarioId, { ...now, outstandingProposalIds: new Set(['waiting-proposal']) }), []);
  }
});
it('6 lifecycle controls: proposal exactly approve + amend; Run exactly Explain this result', () => {
  for (const capture of [proposal, run]) {
    const actual = compose(capture, capture.suggested_actions);
    assert.equal(actual.selection, undefined);
    assert.deepEqual(actual.offered, capture.suggested_actions);
  }
  assert.equal(proposal.suggested_actions.length, 2);
  assert.match(proposal.suggested_actions[0]!.id, /^agent-approve-proposal:/);
  assert.equal(proposal.suggested_actions[1]!.id, 'agent-amend-proposal');
  assert.deepEqual(run.suggested_actions.map(chip => chip.label), ['Explain this result']);
});
it('7 no guidance: exact base pool, including the independent widen swap', () => {
  assert.deepEqual(compose(example, [], { guidance: null }).offered, NEXT_STEP_CHIPS);
  assert.equal(widenOffered({ ...inputs(nearTie).state, analysisReady: nearTie.analysis_ready }), true);
  assert.deepEqual(compose(nearTie, [], { guidance: null }).offered, nextStepsWithWiden(NEXT_STEP_CHIPS, true));
});
it('waiting card suppresses pills without advertising a synthetic id-only control', () => {
  assert.deepEqual(compose(example, [], { offeredSpecific: [{ id: 'agent-approve-proposal:waiting' }] }).offered, []);
});
it('other existing method actions lead with their existing label and message, preserving Suggest options', () => {
  const row = compose(strengthen).selection!.slot1!;
  for (const [policy_id, id] of [['RC-PREMORTEM', 'agent-next-pre-mortem'], ['RC-WHAT-CHANGES', 'agent-next-what-would-change']] as const) {
    for (const widen of [false, true]) {
      const offered = nextStepsFromGuidance(NEXT_STEP_CHIPS, { slot1: { ...row, policy_id } }, widen);
      assert.deepEqual(offered[0], NEXT_STEP_CHIPS.find(chip => chip.id === id));
      assert.equal(offered.filter(chip => chip.id === id).length, 1);
      assert.equal(offered.some(chip => chip.id === 'agent-next-widen'), widen);
    }
  }
});
it('product copy and source wiring: one selection boundary before offeredNow, same selection on wire', () => {
  for (const capture of [draft, example, strengthen, nearTie]) {
    for (const chip of compose(capture).offered) assert.doesNotMatch(chip.label, /\b(best|winner|recommend)\b/i);
  }
  assert.ok(METHOD_PRESS_IDS.has(SUGGEST_RISKS_CHIP.id));
  const source = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
  assert.equal(source.match(/nextStepOffersForTurn\(/g)?.length, 1);
  assert.ok(source.indexOf('const nextStepOffers = nextStepOffersForTurn(') < source.indexOf('const offeredNow:'));
  // S-D (#2743): a held proposal's own card (approve, change, not now) goes BESIDE the one selection, never instead of it.
  assert.ok(source.includes('const offeredNow: OfferedAction[] = firstOfEachId([...heldCardOffer, ...nextStepOffers.offered]);'));
  assert.ok(source.includes('const guidance = nextStepOffers.selection;'));
  assert.ok(source.indexOf('let guidanceHistory:') < source.indexOf('const nextStepOffers = nextStepOffersForTurn('));
  assert.equal(source.includes('turnGuidanceFor('), false);
});

it('RC-WIDEN options W1–W5: Suggest options leads when offered; not offered → the base pool byte-for-byte', () => {
  const row = compose(nearTie).selection!.slot1!;
  for (const variant of ['W1', 'W2', 'W3', 'W4', 'W5'] as const) {
    assert.deepEqual(nextStepsFromGuidance(NEXT_STEP_CHIPS, { slot1: { ...row, variant } }, false),
      nextStepsWithWiden(NEXT_STEP_CHIPS, false));
    const pool = nextStepsWithWiden(NEXT_STEP_CHIPS, true);
    const widened = pool.find(chip => chip.id === 'agent-next-widen')!;
    assert.deepEqual(nextStepsFromGuidance(NEXT_STEP_CHIPS, { slot1: { ...row, variant } }, true),
      [widened, ...pool.filter(chip => chip.id !== 'agent-next-widen')].slice(0, 3));
  }
});
it('a new risks press reserves Suggest options and drops the last fixed chip', () => {
  // The unchanged example's W6 risks row pins this mapping independently of the draft's new S1 selection.
  const selection = compose(example).selection;
  assert.deepEqual(nextStepsFromGuidance(NEXT_STEP_CHIPS, selection, true),
    [SUGGEST_RISKS_CHIP, ...nextStepsWithWiden(NEXT_STEP_CHIPS, true).slice(0, 2)]);
});
it('Give your estimate is used only for the actual S1 card target; a different item keeps the plain label', () => {
  const served = JSON.parse(readFileSync(new URL('./fixtures/m1-s1-served-graphs.json', import.meta.url), 'utf8')) as { cases: Array<{ id: string; graph: unknown }> };
  const state = { graph: served.cases.find(c => c.id === 'D1-sprint-run')!.graph,
    analysisState: { run_state: { kind: 'complete_current' } },
    optionParticipation: [{ option_id: 'split_sprint_capacity', state: 'excluded_olumi_proposed' }] };
  const card = strengthenCardFor(state);
  assert.ok(card);
  const actual = nextStepOffersForTurn(NEXT_STEP_CHIPS, { ...inputs(example), state, request: 'turn', licence: 'withheld' }, true, false);
  const row = actual.selection!.slot1!;
  assert.equal(row.variant, 'S1');
  assert.equal(row.item, `${card.target.from_id}->${card.target.to_id}`);
  assert.deepEqual(actual.offered[0], { ...NEXT_STEP_CHIPS[2], label: 'Give your estimate' });
  assert.deepEqual(nextStepsFromGuidance(NEXT_STEP_CHIPS, { slot1: { ...row, item: 'different->link' } }, false, state)[0], NEXT_STEP_CHIPS[2]);
});

it('Science 393023: as-served draft W6 and S3L → S1 Strengthen, before the previous offer', () => {
  for (const capture of [draft, strengthen]) {
    const base = inputs(capture);
    const current = compose(capture, [], { state: { ...base.state, graph: structuredClone(capture.draft_graph) } });
    assert.equal(current.selection?.slot1?.policy_id, 'RC-STRENGTHEN-ITEM');
    assert.equal(current.selection?.slot1?.variant, 'S1');
    assert.equal(current.offered[0]?.id, 'agent-next-strengthen');
  }
});
