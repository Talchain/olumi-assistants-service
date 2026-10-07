/**
 * ⭐ S-B — THE TOTAL HANDLER MAP AND THE PRESS DISPATCHER (ACTION-SYSTEM-DRAFT §C4/§D5; github-a2 amendment 6).
 *
 * `HANDLERS` is a `Record<ActionId, …>`: adding an id to the registry without its handler fails `tsc`. Each entry names
 * the EXISTING typed route path that answers the press and who checks the precondition:
 *  · `own`   — the typed path answers every state itself, in its own typed words (RC's method turn and widen turn,
 *              SCI-CHANGE, SCI-DEEP). Kept exactly as it is.
 *  · `offer` — the press runs only when the CURRENT offer for (action, target) is enabled; otherwise a typed
 *              "can't yet because X" with a working exit (review: its unbound reply offered nothing to press;
 *              strengthen: its S1 card was the only typed answer, and a press without one fell to the free LLM).
 *
 * A stale `offer_key` never refuses on its own (amendment 6): the offer is re-derived on the CURRENT state, and the
 * press runs on that state when it still holds. A recognised press, or ANY `act:` press, never becomes an ordinary
 * Agent turn (§D5): the route's last step before the Agent loop answers any press no typed path took (`declinedReply`).
 */
import { ACTION_PRESS_PREFIX, ACTION_REGISTRY, actionOfPress, isUnknownActionPress, type ActionId } from './registry.js';
import { actionBarOf, currentOfferFor, DISABLED, type ActionBarV1, type ActionOffer, type ItemRef } from './rank.js';
import type { ActionFacts, ActionRevision } from './state.js';
import { parseStructuralChallengePress } from '../method-turn/structural-challenge-turn.js';

export type ActionRoute = 'decision_review' | 'what_changes' | 'strengthen_s1' | 'method_turn' | 'widen_turn' | 'structural_challenge';
export interface ActionHandler {
  /** The existing typed route path that answers this press. */
  readonly route: ActionRoute;
  readonly gate: 'own' | 'offer';
}

export const HANDLERS: Readonly<Record<ActionId, ActionHandler>> = {
  review: { route: 'decision_review', gate: 'offer' },
  what_changes: { route: 'what_changes', gate: 'own' },
  strengthen: { route: 'strengthen_s1', gate: 'offer' },
  pre_mortem: { route: 'method_turn', gate: 'own' },
  more_options: { route: 'widen_turn', gate: 'own' },
  test_link: { route: 'structural_challenge', gate: 'own' },
};

/** A working way on from a "can't yet": another current offer, the Run, or the existing "what it still needs" turn. */
export type ActionExit = { readonly kind: 'offer'; readonly offer: ActionOffer } | { readonly kind: 'run' } | { readonly kind: 'what_it_needs' };
export type CantYetReason = 'needs_current_analysis' | 'needs_goal' | 'needs_option' | 'nothing_in_scope' | 'unknown_action' | 'not_taken' | 'already_waiting';
export interface ActionTypedReply {
  readonly text: string;
  readonly reason: CantYetReason;
  readonly exits: readonly ActionExit[];
  /** `ran` only for a re-offered card (the press did its job without a second write); every other typed reply is `cant_yet`. */
  readonly outcome?: 'ran';
}

export interface ActionPress {
  readonly action: ActionId | null;
  readonly press_id: string;
  /** The offer key the press carried, when well formed (16 hex); null for a chip pressed without one. */
  readonly offer_key: string | null;
  readonly target?: ItemRef;
}

export type PressDecision =
  | { readonly kind: 'not_an_action' }
  | { readonly kind: 'route'; readonly press: ActionPress; readonly handler: ActionHandler; readonly offer: ActionOffer | undefined }
  | { readonly kind: 'reply'; readonly press: ActionPress; readonly reply: ActionTypedReply };

const OFFER_KEY = /^[0-9a-f]{16}$/;
const rec = (v: unknown): Record<string, unknown> | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined);

/** The action a chip presses, its target (a per-link press names its link) and the offer key it carried. */
export function actionPressOf(chip: unknown): ActionPress | null {
  const c = rec(chip);
  const id = c?.id;
  if (typeof id !== 'string') return null;
  const action = actionOfPress(id);
  if (action === undefined && !isUnknownActionPress(id)) return null;
  const key = rec(c?.parameters)?.offer_key;
  const parsed = action === 'test_link' ? parseStructuralChallengePress(id) : null;
  const target: ItemRef | undefined = parsed !== null && 'from_id' in parsed ? { kind: 'link', from_id: parsed.from_id, to_id: parsed.to_id } : undefined;
  return { action: action ?? null, press_id: id, offer_key: typeof key === 'string' && OFFER_KEY.test(key) ? key : null, ...(target !== undefined ? { target } : {}) };
}

/** Exits for "needs a current analysis": the Run when it may run now, else the existing "what it still needs" turn. */
function runExits(f: ActionFacts): ActionExit[] {
  return [f.runAdmissible ? { kind: 'run' } : { kind: 'what_it_needs' }];
}

/** Enabled offers a user can press instead, most important first (priority, then the standard actions). */
function otherOffers(bar: ActionBarV1, not: ActionId | null, max: number): ActionExit[] {
  return [...bar.priority, ...bar.standard].filter((o) => o.enabled && o.action_id !== not).slice(0, max)
    .map((offer) => ({ kind: 'offer' as const, offer }));
}

const CANT_YET: Record<ActionId, string> = {
  review: 'I can’t review this decision yet',
  what_changes: 'I can’t say what would change this yet',
  strengthen: 'I can’t strengthen the model yet',
  pre_mortem: 'I can’t run a pre-mortem yet',
  more_options: 'I can’t suggest options yet',
  test_link: 'I can’t test that link yet',
};
const BECAUSE: Record<keyof typeof DISABLED, string> = {
  needs_current_analysis: 'it needs a current analysis first.',
  needs_goal: 'the model needs a goal first.',
  needs_option: 'the model needs at least one option first.',
};

function cantYet(action: ActionId, offer: ActionOffer | undefined, f: ActionFacts, bar: ActionBarV1): ActionTypedReply {
  const reasonKey = (Object.keys(DISABLED) as (keyof typeof DISABLED)[]).find((k) => DISABLED[k] === offer?.disabled_reason);
  if (reasonKey !== undefined) {
    const exits = reasonKey === 'needs_current_analysis' ? runExits(f) : otherOffers(bar, action, 2);
    return { text: `${CANT_YET[action]}: ${BECAUSE[reasonKey]}`, reason: reasonKey, exits: exits.length > 0 ? exits : runExits(f) };
  }
  // Not offered at all on this state: its typed contract has nothing in scope here.
  return action === 'strengthen'
    ? { text: 'There is nothing to strengthen in this step: every link on your goal’s path already has a size.', reason: 'nothing_in_scope',
      exits: otherOffers(bar, action, 2).length > 0 ? otherOffers(bar, action, 2) : runExits(f) }
    : { text: `${CANT_YET[action]}: it has nothing to act on in this model.`, reason: 'nothing_in_scope',
      exits: otherOffers(bar, action, 2).length > 0 ? otherOffers(bar, action, 2) : runExits(f) };
}

/**
 * THE DISPATCH DECISION for one press, on the CURRENT state (re-derived, never the bar the press came from). The
 * route runs `route` presses through their existing typed path, and answers `reply` presses with the typed reply.
 */
export function decidePress(chip: unknown, f: ActionFacts, bar: ActionBarV1 = actionBarOf(f)): PressDecision {
  const press = actionPressOf(chip);
  if (press === null) return { kind: 'not_an_action' };
  if (press.action === null) {
    const exits = otherOffers(bar, null, 2);
    return { kind: 'reply', press, reply: { text: 'That action isn’t available in this version of Olumi.', reason: 'unknown_action',
      exits: exits.length > 0 ? exits : runExits(f) } };
  }
  const handler = HANDLERS[press.action];
  const offer = currentOfferFor(bar, press.action, press.target);
  if (handler.gate === 'own' || offer?.enabled === true) return { kind: 'route', press, handler, offer };
  return { kind: 'reply', press, reply: cantYet(press.action, offer, f, bar) };
}

/**
 * The last step before the Agent loop: a recognised press that no typed path answered (a chip with an unexpected
 * `action_type`, a handler that declined) still gets a typed reply, never the free model.
 */
export function declinedReply(press: ActionPress, f: ActionFacts, bar: ActionBarV1 = actionBarOf(f)): ActionTypedReply {
  if (press.action === null) return { text: 'That action isn’t available in this version of Olumi.', reason: 'unknown_action', exits: otherOffers(bar, null, 2) };
  const offer = currentOfferFor(bar, press.action, press.target);
  const reply = cantYet(press.action, offer?.enabled === true ? undefined : offer, f, bar);
  return offer?.enabled === true
    ? { text: `${CANT_YET[press.action]}: it found nothing it could act on in this model.`, reason: 'not_taken', exits: reply.exits }
    : reply;
}

/** The receipt sidecar every action turn carries (contract v1.1 item 5). */
export interface ActionReceipt {
  readonly v: 1;
  readonly action_id: string;
  readonly press_id: string;
  readonly offer_key: string | null;
  readonly target?: ItemRef;
  readonly revision: ActionRevision;
  readonly outcome: 'ran' | 'cant_yet';
  readonly reason?: CantYetReason;
}

export function actionReceiptOf(press: ActionPress, revision: ActionRevision, outcome: ActionReceipt['outcome'], reason?: CantYetReason): ActionReceipt {
  const suffix = press.press_id.startsWith(ACTION_PRESS_PREFIX) ? press.press_id.slice(ACTION_PRESS_PREFIX.length) : '';
  return {
    v: 1,
    action_id: press.action ?? (/^[a-z_]{1,40}$/.test(suffix) ? suffix : 'unknown'),
    press_id: press.press_id.length <= 4096 ? press.press_id : press.press_id.slice(0, 4096),
    offer_key: press.offer_key,
    ...(press.target !== undefined ? { target: press.target } : {}),
    revision,
    outcome,
    ...(reason !== undefined ? { reason } : {}),
  };
}

/** The visible user line of an action, for an exit chip's `message` (display only; nothing routes on it). */
export const userLineOf = (action: ActionId): string => ACTION_REGISTRY[action].user_line;
