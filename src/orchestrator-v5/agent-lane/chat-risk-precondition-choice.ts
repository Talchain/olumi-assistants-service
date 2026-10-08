/** Host-owned choice over ONE retained ordinary risk hold; never a second proposal or approval authority. */
import type { SuggestedAction } from '../compose/types.js';
import type { PendingAction } from '../session/pending-action.js';
import { chatRiskPreconditionOptionsFor } from '../routing/chat-risk-precondition.js';
import { riskAddPressFor } from './method-turn/widen-turn.js';
import { proposalRecord } from './proposal-object/record.js';

export const RISK_PRECONDITION_CHOICE_KEY = 'chat_risk_precondition_choice_v1';
export const RISK_MRR_CHOICE_PREFIX = 'agent-risk-mrr-choice:';
export const RISK_MRR_CHOICE_WORDS = 'It lowers MRR for every option';
type Choice = { digest: string; actions: SuggestedAction[]; line: string; turn_id?: string };
const inlineOf = (hold: PendingAction): Record<string, unknown> | undefined =>
  hold.action.kind === 'apply_proposed_change' ? hold.action.inline_patch as Record<string, unknown> | undefined : undefined;
const choiceOf = (hold: PendingAction): Choice | undefined => {
  const raw = inlineOf(hold)?.[RISK_PRECONDITION_CHOICE_KEY];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const c = raw as Choice;
  return typeof c.digest === 'string' && typeof c.line === 'string' && Array.isArray(c.actions)
    && c.actions.every(a => a !== null && typeof a === 'object' && typeof a.id === 'string'
      && typeof a.label === 'string' && typeof a.message === 'string') ? c : undefined;
};
/** Presence fails closed even if a corrupted carrier no longer has readable choices. */
export const hasRiskPreconditionChoice = (hold: PendingAction): boolean => inlineOf(hold)?.[RISK_PRECONDITION_CHOICE_KEY] !== undefined;
export const riskPreconditionChoiceTurnId = (hold: PendingAction): string | undefined => choiceOf(hold)?.turn_id;
export const isRiskMrrChoicePress = (id: unknown): boolean => typeof id === 'string' && id.startsWith(RISK_MRR_CHOICE_PREFIX);

export function withRiskPreconditionChoice(hold: PendingAction, graph: unknown, actions: SuggestedAction[], line: string, turnId?: string): PendingAction {
  const record = proposalRecord(hold, graph);
  if (record === undefined || hold.action.kind !== 'apply_proposed_change') return hold;
  const decline = { id: `${RISK_MRR_CHOICE_PREFIX}${record.proposal_id}:${record.digest}`,
    label: RISK_MRR_CHOICE_WORDS, message: RISK_MRR_CHOICE_WORDS };
  return { ...hold, action: { ...hold.action, inline_patch: { ...hold.action.inline_patch,
    [RISK_PRECONDITION_CHOICE_KEY]: { digest: record.digest, actions: [...actions, decline], line,
      ...(turnId !== undefined ? { turn_id: turnId } : {}) } } } };
}

export function withoutRiskPreconditionChoice(hold: PendingAction): PendingAction {
  if (!hasRiskPreconditionChoice(hold) || hold.action.kind !== 'apply_proposed_change') return hold;
  const inline = { ...hold.action.inline_patch };
  delete inline[RISK_PRECONDITION_CHOICE_KEY];
  return { ...hold, action: { ...hold.action, inline_patch: inline } };
}

/** Reconstruct only this hold's originally offered choices, on today's identities and displayed digest. */
export function riskPreconditionChoiceActions(hold: PendingAction, graph: unknown): SuggestedAction[] {
  const choice = choiceOf(hold);
  const record = proposalRecord(hold, graph);
  if (choice === undefined || record === undefined || record.digest !== choice.digest) return [];
  const riskOp = record.operations.find(o => o.op === 'add_node' && (o.value as { kind?: unknown } | undefined)?.kind === 'risk');
  const label = (riskOp?.value as { label?: unknown } | undefined)?.label;
  if (typeof label !== 'string') return [];
  const optionPresses = chatRiskPreconditionOptionsFor(graph).map(option => riskAddPressFor({ label, mechanism: 'relies_on',
    hits: { id: option.option_id, label: option.option_label, kind: 'option' } }));
  const declineId = `${RISK_MRR_CHOICE_PREFIX}${record.proposal_id}:${record.digest}`;
  return choice.actions.filter(a => a.id === declineId && a.label === RISK_MRR_CHOICE_WORDS && a.message === RISK_MRR_CHOICE_WORDS
    || optionPresses.some(p => p.id === a.id && p.label === a.label && p.message === a.message));
}

export function riskMrrChoiceHoldFor(id: unknown, message: string, holds: readonly PendingAction[], graph: unknown): PendingAction | undefined {
  if (!isRiskMrrChoicePress(id)) return undefined;
  return holds.find(hold => riskPreconditionChoiceActions(hold, graph).some(a => a.id === id && a.message === message));
}
