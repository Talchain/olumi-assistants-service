/**
 * ⛔ R3-3 (recovery Batch R3, S7): "GIVE YOUR ESTIMATE" SENT A GENERIC QUESTION.
 *
 * Served CEE aadcf897, score run 2 (`live/runs/2026-10-12T144844Z`, hiring and marketing `turns/02.json`): the S1
 * strengthen press was relabelled with the guidance row's action, but kept the generic words, so the chip offered was
 *   { id: 'agent-next-strengthen', label: 'Give your estimate', message: 'What would most strengthen this model?' }
 * A chip that says "Give your estimate" must ask for THAT estimate: the link the S1 card names, by its labels, in the
 * product's existing size ask ("How strongly does ‘A’ affect ‘B’?", the `agent-size-link:` press). Where no card target
 * is known, the press keeps its own plain label and words (never "Give your estimate" with a generic message).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SuggestedAction } from '../../compose/types.js';
import { leaderLicenceFromState } from '../../compose/leader-licence.js';
import { NEXT_STEP_CHIPS, offersNextSteps } from '../../../routes/agent-v1-turn.js';
import { nextStepOffersForTurn, nextStepsFromGuidance } from '../next-steps-from-guidance.js';
import { widenOffered } from '../method-turn/widen-turn.js';
import { strengthenCardFor } from '../strengthen-press.js';
import type { TurnGuidanceInputs } from '../turn-context/guidance-wire.js';

interface Served {
  assistant_text: string; draft_graph: { nodes: Array<{ id: string; label: string }> }; analysis_state: unknown;
  analysis_ready: unknown; blocks: Array<{ type: string }>; option_participation?: unknown;
  suggested_actions: SuggestedAction[]; guidance: { slot1: { item: string; primary_action: { label: string } } };
  _diagnostic_trace: { fast_path: string | null };
}
const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/r3-give-your-estimate-run2.json', import.meta.url), 'utf8')) as
  { cases: Record<string, Served> }).cases;
const GENERIC = 'What would most strengthen this model?';
const STRENGTHEN = NEXT_STEP_CHIPS.find(c => c.id === 'agent-next-strengthen')!;

function offer(capture: Served, over: Partial<TurnGuidanceInputs['state']> = {}) {
  const i: TurnGuidanceInputs = {
    request: 'turn', offeredSpecific: [], assistantText: capture.assistant_text,
    licence: leaderLicenceFromState(capture.analysis_state, capture.analysis_ready), guidance: {},
    state: { graph: capture.draft_graph, analysisState: capture.analysis_state,
      analysisResult: capture.blocks.find(b => b.type === 'analysis_result'), optionParticipation: capture.option_participation, ...over },
  };
  return nextStepOffersForTurn(NEXT_STEP_CHIPS, i, offersNextSteps(capture.analysis_state),
    widenOffered({ ...i.state, analysisReady: capture.analysis_ready }));
}
const labelOf = (capture: Served, id: string) => capture.draft_graph.nodes.find(n => n.id === id)!.label;

describe('R3-3: "Give your estimate" asks for the estimate it sits beside', () => {
  it.each([
    ['hiring-02', 'Code quality degradation', 'Launch completion'],
    ['marketing-02', 'Campaign readiness', 'Product feature launch campaign'],
  ])('%s: the served chip, recomposed, asks "How strongly does ‘%s’ affect ‘%s’?"', (name, from, to) => {
    const capture = SERVED[name]!;
    // The fixture is the served turn: its offer led with the relabelled strengthen press.
    expect(capture.suggested_actions[0]).toEqual({ id: 'agent-next-strengthen', label: 'Give your estimate', message: GENERIC });
    const card = strengthenCardFor({ graph: capture.draft_graph, analysisState: capture.analysis_state,
      analysisResult: capture.blocks.find(b => b.type === 'analysis_result'), optionParticipation: capture.option_participation });
    expect(card).not.toBeNull();
    expect(`${card!.target.from_id}->${card!.target.to_id}`).toBe(capture.guidance.slot1.item);
    const [fromId, toId] = capture.guidance.slot1.item.split('->') as [string, string];
    expect([labelOf(capture, fromId), labelOf(capture, toId)]).toEqual([from, to]);

    const { selection, offered } = offer(capture);
    expect(selection?.slot1?.item).toBe(capture.guidance.slot1.item);
    expect(offered[0]).toEqual({ id: 'agent-next-strengthen', label: 'Give your estimate', message: `How strongly does ‘${from}’ affect ‘${to}’?` });
    expect(offered.filter(chip => chip.id === 'agent-next-strengthen')).toHaveLength(1);
  });

  it('PROPERTY: no offered chip is labelled "Give your estimate" while sending the generic question', () => {
    let seen = 0;
    for (const capture of Object.values(SERVED)) {
      const { selection } = offer(capture);
      const current = { graph: capture.draft_graph, analysisState: capture.analysis_state,
        analysisResult: capture.blocks.find(b => b.type === 'analysis_result'), optionParticipation: capture.option_participation };
      for (const state of [current, { ...current, analysisState: { run_state: { kind: 'complete_stale' } } }]) {
        for (const widen of [false, true]) {
          for (const chip of nextStepsFromGuidance(NEXT_STEP_CHIPS, selection, widen, state)) {
            seen += 1;
            if (chip.label === 'Give your estimate') expect(chip.message, JSON.stringify(chip)).not.toBe(GENERIC);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('CONTRAST: with no S1 card (the Run is no longer current) the press keeps its own label and words', () => {
    for (const capture of Object.values(SERVED)) {
      const { selection } = offer(capture);
      const stale = { graph: capture.draft_graph, analysisState: { run_state: { kind: 'complete_stale' } } };
      expect(strengthenCardFor(stale)).toBeNull();
      expect(nextStepsFromGuidance(NEXT_STEP_CHIPS, selection, false, stale)[0]).toEqual(STRENGTHEN);
    }
  });

  it('CONTRAST: a row on a different item than the card keeps the plain press', () => {
    const capture = SERVED['hiring-02']!;
    const { selection } = offer(capture);
    const state = { graph: capture.draft_graph, analysisState: capture.analysis_state,
      analysisResult: capture.blocks.find(b => b.type === 'analysis_result'), optionParticipation: capture.option_participation };
    expect(nextStepsFromGuidance(NEXT_STEP_CHIPS, { slot1: { ...selection!.slot1!, item: 'different->link' } }, false, state)[0]).toEqual(STRENGTHEN);
  });
});
