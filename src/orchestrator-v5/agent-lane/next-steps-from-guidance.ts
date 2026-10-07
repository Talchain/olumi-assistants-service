import type { SuggestedAction } from '../compose/types.js';
import { nextStepsWithWiden, SUGGEST_RISKS_CHIP, WIDEN_CHIP } from './method-turn/widen-turn.js';
import { turnGuidanceFor, type GuidanceWire, type TurnGuidanceInputs } from './turn-context/guidance-wire.js';
import { strengthenCardFor, type StrengthenPressState } from './strengthen-press.js';

/** The W6 press: S-C's ONE widening door, target risks (`widen-turn.ts` `widenTargetOf`); re-exported for its readers. */
export { SUGGEST_RISKS_CHIP };

/** Slot one's press first in the base pool; preserve every options swap and existing press wording. */
export function nextStepsFromGuidance(
  steps: readonly SuggestedAction[], selection: GuidanceWire | undefined, widen: boolean,
  state: StrengthenPressState = {},
): SuggestedAction[] {
  const row = selection?.slot1;
  const pool = nextStepsWithWiden(steps, widen);
  if (row === undefined) return pool;
  let primary: SuggestedAction | undefined;
  if (row.policy_id === 'RC-WIDEN' && row.target === 'options') {
    // DL 7 Oct (cut 7 R3 pills FAIL 6/6): the guidance's own press leads, as every other policy's does. Not offered → base pool.
    if (!widen) return pool;
    primary = pool.find(step => step.id === WIDEN_CHIP.id);
  } else if (row.policy_id === 'RC-WIDEN') {
    if (row.target === 'risks') primary = SUGGEST_RISKS_CHIP;
  } else {
    const id = row.policy_id === 'RC-PREMORTEM' ? 'agent-next-pre-mortem'
      : row.policy_id === 'RC-WHAT-CHANGES' ? 'agent-next-what-would-change'
      : row.policy_id === 'RC-STRENGTHEN-ITEM' ? 'agent-next-strengthen' : undefined;
    const press = steps.find(step => step.id === id);
    primary = press;
    if (press !== undefined && row.policy_id === 'RC-STRENGTHEN-ITEM') {
      // The press chooses its own S1 card. An estimate label is truthful only for that same item.
      const card = strengthenCardFor(state);
      if (card !== null && row.item === `${card.target.from_id}->${card.target.to_id}`) {
        primary = { ...press, label: row.primary_action.label };
      }
    }
  }
  if (primary === undefined) return pool;
  const offered = [...new Map([primary, ...pool.filter(step => step.id !== primary.id)]
    .map(step => [step.id, step])).values()].slice(0, 3);
  const options = pool.find(step => step.id === WIDEN_CHIP.id);
  if (widen && options !== undefined && !offered.some(step => step.id === options.id)) {
    offered[offered.length - 1] = options;
  }
  return offered;
}

/** The route and captured-state checks share this selection-before-offers boundary. Select exactly once. */
export function nextStepOffersForTurn(
  steps: readonly SuggestedAction[], inputs: TurnGuidanceInputs, eligible: boolean, widen: boolean, specific: readonly SuggestedAction[] = [],
): { readonly selection: GuidanceWire | undefined; readonly offered: SuggestedAction[] } {
  const selection = turnGuidanceFor(inputs);
  const offered = eligible ? nextStepsFromGuidance(steps, selection, widen, inputs.state) : [...specific];
  return { selection, offered };
}
