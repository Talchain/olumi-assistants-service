/** Host-owned choice over ONE retained ordinary risk hold; never a second proposal or approval authority. */
import type { SuggestedAction } from '../compose/types.js';
import type { PendingAction } from '../session/pending-action.js';
import { chatRiskPreconditionOptionsFor } from '../routing/chat-risk-precondition.js';
import { riskAddPressFor, type WidenAddCall } from './method-turn/widen-turn.js';
import { proposalRecord, type ProposalRecord } from './proposal-object/record.js';

export const RISK_PRECONDITION_CHOICE_KEY = 'chat_risk_precondition_choice_v1';
export const RISK_MRR_CHOICE_PREFIX = 'agent-risk-mrr-choice:';
export const RISK_OPTIONS_UNAVAILABLE_LINE = "The options couldn't be listed. Choose the held change's claim below, or leave it waiting.";
export const RISK_PRECONDITION_CHOICE_REFUSED_REPLY = 'Nothing changed: the model changed since these choices were offered. Try again.';
type Choice = { revision: string; digest: string; actions: SuggestedAction[]; line: string; turn_id?: string; offered_turn_id?: string };
const inlineOf = (hold: PendingAction): Record<string, unknown> | undefined =>
  hold.action.kind === 'apply_proposed_change' ? hold.action.inline_patch as Record<string, unknown> | undefined : undefined;
const choiceOf = (hold: PendingAction): Choice | undefined => {
  const raw = inlineOf(hold)?.[RISK_PRECONDITION_CHOICE_KEY];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const c = raw as Choice;
  return typeof c.revision === 'string' && typeof c.digest === 'string' && typeof c.line === 'string' && Array.isArray(c.actions)
    && c.actions.every(a => a !== null && typeof a === 'object' && typeof a.id === 'string'
      && typeof a.label === 'string' && typeof a.message === 'string') ? c : undefined;
};
/** Presence fails closed even if a corrupted carrier no longer has readable choices. */
export const hasRiskPreconditionChoice = (hold: PendingAction): boolean => inlineOf(hold)?.[RISK_PRECONDITION_CHOICE_KEY] !== undefined;
export const riskPreconditionChoiceTurnId = (hold: PendingAction): string | undefined => choiceOf(hold)?.turn_id;
export const riskPreconditionChoiceOfferedTurnId = (hold: PendingAction): string | undefined =>
  choiceOf(hold)?.offered_turn_id ?? choiceOf(hold)?.turn_id;
/** Prior issuance is only a refusal discriminator, never authority to apply an old press. */
export const riskPreconditionChoiceHasPress = (hold: PendingAction, id: unknown, message: string): boolean =>
  choiceOf(hold)?.actions.some(a => a.id === id && a.message === message) === true;
export const riskPreconditionChoiceLine = (hold: PendingAction): string => choiceOf(hold)?.line
  ?? 'Nothing changed. Choose what this risk means before approving the held change.';
export const isRiskMrrChoicePress = (id: unknown): boolean => typeof id === 'string' && id.startsWith(RISK_MRR_CHOICE_PREFIX);
const riskOf = (record: ProposalRecord) => record.operations.find(o => o.op === 'add_node'
  && (o.value as { kind?: unknown } | undefined)?.kind === 'risk')?.value as { id?: string; label?: string } | undefined;
const declineWords = (record: ProposalRecord): string => {
  const risk = riskOf(record);
  const claims = record.fields.flatMap(f => f.kind === 'link_strength' && f.from_id === risk?.id
    ? [`${f.direction === 'negative' ? 'lowers' : 'raises'} ‘${f.to_label}’`] : []);
  return claims.length > 0 ? `It ${[...new Set(claims)].join(' and ')} for every option` : 'Use the held change as shown';
};
const declineId = (record: ProposalRecord): string => `${RISK_MRR_CHOICE_PREFIX}${record.proposal_id}:${record.revision}:${record.digest}`;
const optionPressesFor = (record: ProposalRecord, graph: unknown): SuggestedAction[] => {
  const label = riskOf(record)?.label;
  if (typeof label !== 'string') return [];
  return chatRiskPreconditionOptionsFor(graph).map(option => riskAddPressFor({ label, mechanism: 'relies_on',
    hits: { id: option.option_id, label: option.option_label, kind: 'option' } }, record)).filter(a => a.message.length <= 600);
};

/** Called INSIDE the durable hold commit. Re-mint every action against this exact revision, never trust supplied ids. */
export function withRiskPreconditionChoice(hold: PendingAction, graph: unknown, _actions: SuggestedAction[], line: string, turnId?: string): PendingAction {
  if (hold.action.kind !== 'apply_proposed_change') return hold;
  const record = proposalRecord(hold, graph);
  const actions = record === undefined ? [] : optionPressesFor(record, graph);
  const claim = record === undefined ? undefined : declineWords(record);
  const decline = record === undefined ? [] : [{ id: declineId(record), label: claim!, message: claim! }];
  return { ...hold, action: { ...hold.action, inline_patch: { ...hold.action.inline_patch,
    [RISK_PRECONDITION_CHOICE_KEY]: { revision: hold.id, digest: record?.digest ?? '', actions: [...actions, ...decline],
      line: actions.length === 0 ? `${line}\n${RISK_OPTIONS_UNAVAILABLE_LINE}` : line,
      ...(turnId !== undefined ? { turn_id: turnId } : {}) } } } };
}

export function withoutRiskPreconditionChoice(hold: PendingAction): PendingAction {
  if (!hasRiskPreconditionChoice(hold) || hold.action.kind !== 'apply_proposed_change') return hold;
  const inline = { ...hold.action.inline_patch };
  delete inline[RISK_PRECONDITION_CHOICE_KEY];
  return { ...hold, action: { ...hold.action, inline_patch: inline } };
}

/** A refusal renews the offer, preserving the trigger identity used by current-revision replay. */
export function withRiskPreconditionChoiceOffer(hold: PendingAction, graph: unknown, turnId: string): PendingAction {
  const refreshed = withRiskPreconditionChoice(hold, graph, [], riskPreconditionChoiceLine(hold), riskPreconditionChoiceTurnId(hold));
  if (refreshed.action.kind !== 'apply_proposed_change') return refreshed;
  return { ...refreshed, action: { ...refreshed.action, inline_patch: { ...refreshed.action.inline_patch,
    [RISK_PRECONDITION_CHOICE_KEY]: { ...choiceOf(refreshed), offered_turn_id: turnId } } } };
}

/** Reconstruct only this hold's originally offered choices, on today's identities and displayed revision + digest. */
export function riskPreconditionChoiceActions(hold: PendingAction, graph: unknown): SuggestedAction[] {
  const choice = choiceOf(hold);
  const record = proposalRecord(hold, graph);
  if (choice === undefined || record === undefined || record.revision !== choice.revision || record.digest !== choice.digest) return [];
  const offered = [...optionPressesFor(record, graph), { id: declineId(record), label: declineWords(record), message: declineWords(record) }];
  return choice.actions.filter(a => offered.some(p => p.id === a.id && p.label === a.label && p.message === a.message));
}

export function riskMrrChoiceHoldFor(id: unknown, message: string, holds: readonly PendingAction[], graph: unknown): PendingAction | undefined {
  if (!isRiskMrrChoicePress(id)) return undefined;
  return holds.find(hold => riskPreconditionChoiceActions(hold, graph).some(a => a.id === id && a.message === message));
}

/** The option press names the full held risk, not text parsed from a label. Retired revisions cannot mint it. */
export function riskPreconditionOptionCallFor(id: unknown, message: string, holds: readonly PendingAction[], graph: unknown): WidenAddCall | null {
  for (const hold of holds) {
    if (!riskPreconditionChoiceActions(hold, graph).some(a => a.id === id && a.message === message)) continue;
    const record = proposalRecord(hold, graph);
    const label = record === undefined ? undefined : riskOf(record)?.label;
    if (record === undefined || typeof label !== 'string') continue;
    for (const option of chatRiskPreconditionOptionsFor(graph)) {
      const action = riskAddPressFor({ label, mechanism: 'relies_on', hits: { id: option.option_id, label: option.option_label, kind: 'option' } }, record);
      if (action.id !== id || action.message !== message) continue;
      return { tool: 'propose_new_risk', relies_on: option, choice_binding: { proposal_id: record.proposal_id, revision: record.revision, digest: record.digest },
        args: { label, affects: [], caused_by: [], rationale: 'The user chose this option precondition from the timing ambiguity in the stored context.', whole_request: true } };
    }
  }
  return null;
}
