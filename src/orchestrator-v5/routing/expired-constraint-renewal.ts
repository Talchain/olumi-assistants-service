import { emitProposedChange, resolveProposalRenderCopy } from '../compose/proposed-change.js';
import { buildWarrantDemotion, type PersistedConstraintRow } from '../compose/warrant-demotion.js';
import { isPendingActionExpired, type PendingAction } from '../session/pending-action.js';
import { ALLOWED_TARGET_KINDS } from '../tools/handlers/add-constraint.js';
import type { HandlerRegistry } from '../tools/registry.js';
import type { HandlerFactWithTurn } from '../types/handler-fact.js';
import type { ProposedChange, ProposedChangeEmitResult } from '../types/proposed-change.js';
import { PROPOSAL_CONFIRM_PATTERN, SHORT_CONFIRM_PATTERN } from './deterministic-short-confirm.js';
import { findExactProposalCopyMatchIndexes } from './proposal-ordinal-select.js';
import {
  buildApplyProposedChangeProposal,
  decideProposedChangeSynthesis,
  readConfirmedConstraintValueFrame,
} from './proposed-change-synthesis.js';
import { HANDLER_VALIDATION_REGISTRY } from './validation-registry.js';
import { validateToolCall } from './validator.js';

export interface ExpiredConstraintRenewalInput {
  readonly message: string;
  readonly pendingActions: readonly PendingAction[];
  readonly scenarioId: string;
  /** Hash and nodes must come from the same current persisted graph. */
  readonly currentGraphHash: string | null | undefined;
  readonly graphNodes: readonly { readonly id: string; readonly kind: string; readonly label?: string | null }[];
  readonly existingConstraints: readonly PersistedConstraintRow[];
  readonly priorFactsWithTurn: readonly HandlerFactWithTurn[];
  readonly emittedAtIso: string;
  readonly registry: HandlerRegistry;
}

export type ExpiredConstraintRenewalResult =
  | {
      readonly status: 'renewed';
      readonly chip: Extract<ProposedChangeEmitResult, { status: 'success' }>['chip'];
      readonly pending: PendingAction;
      readonly previousPendingId: string;
      readonly changeDescription: string;
      readonly residualDisclosure: string | null;
      readonly constraintValueFrame?: ProposedChange['constraint_value_frame'];
    }
  | { readonly status: 'not_renewed'; readonly matchedExpiredConstraint: boolean; readonly reason:
      'no_unique_offer' | 'not_expired' | 'invalid_offer' | 'superseded' |
      'already_applied' | 'target_missing' | 'emit_refused' };

/**
 * Prepare a fresh offer, never an execution of expired consent. The caller
 * must atomically commit the returned chip and pending, explicitly request
 * fresh confirmation, and carry prior pendings through normal supersession.
 */
export function buildExpiredConstraintRenewal(
  input: ExpiredConstraintRenewalInput,
): ExpiredConstraintRenewalResult {
  let matchedExpiredConstraint = false;
  const decline = (reason: Extract<ExpiredConstraintRenewalResult, { status: 'not_renewed' }>['reason']): ExpiredConstraintRenewalResult =>
    ({ status: 'not_renewed', reason, matchedExpiredConstraint });
  const nowMs = Date.parse(input.emittedAtIso);
  if (!Number.isFinite(nowMs)) return decline('invalid_offer');

  const proposals = input.pendingActions.filter((pa) => pa.action.kind === 'apply_proposed_change');
  const matches = findExactProposalCopyMatchIndexes(
    input.message, proposals.map((pa) => resolveProposalRenderCopy(pa.action)),
  );
  let pending: PendingAction | undefined;
  if (matches.length === 1) {
    pending = proposals[matches[0]!];
  } else if (matches.length === 0 && input.pendingActions.length === 1 &&
      (SHORT_CONFIRM_PATTERN.test(input.message) || PROPOSAL_CONFIRM_PATTERN.test(input.message))) {
    pending = proposals[0];
  }
  if (!pending) return decline('no_unique_offer');
  if (!isPendingActionExpired(pending, nowMs)) return decline('not_expired');
  matchedExpiredConstraint = pending.action.kind === 'apply_proposed_change' &&
    pending.action.inline_patch?.handler_id === 'add_constraint';
  if (pending.scenario_id !== input.scenarioId ||
      !Number.isFinite(Date.parse(pending.expires_at_iso)) ||
      !Number.isFinite(Date.parse(pending.emitted_at_iso)) ||
      Date.parse(pending.emitted_at_iso) > nowMs ||
      pending.action.kind !== 'apply_proposed_change') return decline('invalid_offer');
  const inline = pending.action.inline_patch;
  if (!inline || inline.handler_id !== 'add_constraint' ||
      !Array.isArray(inline.target_entity_ids) || inline.target_entity_ids.length !== 1 ||
      typeof inline.target_entity_ids[0] !== 'string' ||
      !Array.isArray(pending.preconditions.target_entity_ids) ||
      pending.preconditions.target_entity_ids.length !== 1 ||
      pending.preconditions.target_entity_ids[0] !== inline.target_entity_ids[0]) {
    return decline('invalid_offer');
  }
  const decision = decideProposedChangeSynthesis({
    pending, currentGraphHash: input.currentGraphHash, priorFactsWithTurn: input.priorFactsWithTurn,
  });
  if (decision.status === 'superseded' || decision.status === 'already_applied') return decline(decision.status);
  if (decision.status !== 'execute') return decline('invalid_offer');
  const targetId = inline.target_entity_ids[0];
  const targets = input.graphNodes.filter((node) => node.id === targetId);
  if (targets.length !== 1) return decline('target_missing');
  const target = targets[0]!;
  if (!ALLOWED_TARGET_KINDS.includes(target.kind) || !target.label?.trim()) return decline('invalid_offer');
  const entity = { id: target.id, kind: target.kind === 'goal' ? 'goal' as const : 'node' as const, label: target.label };
  const action = buildApplyProposedChangeProposal(pending, entity, (id) => id === target.id ? entity : null);
  const schemas = HANDLER_VALIDATION_REGISTRY.add_constraint!.parameter_schemas!;
  if (action.parameters.some((parameter) => !Object.hasOwn(schemas, parameter.name)) ||
      !validateToolCall(action, undefined, HANDLER_VALIDATION_REGISTRY).valid) return decline('invalid_offer');
  const demotion = buildWarrantDemotion(action, input.existingConstraints);
  if (!demotion.ok) return decline('invalid_offer');
  const frame = readConfirmedConstraintValueFrame(pending, action);
  if (inline.constraint_value_frame !== undefined && frame === undefined) return decline('invalid_offer');
  const emitted = emitProposedChange({
    ...demotion.proposal,
    ...(frame !== undefined ? { constraint_value_frame: frame } : {}),
  }, {
    scenario_id: input.scenarioId,
    graph_hash: input.currentGraphHash!,
    emitted_at_iso: input.emittedAtIso,
    registry: input.registry,
  });
  if (emitted.status !== 'success') return decline('emit_refused');
  return {
    status: 'renewed', chip: emitted.chip, pending: emitted.pending,
    previousPendingId: pending.id,
    changeDescription: demotion.changeDescription,
    residualDisclosure: demotion.residualDisclosure,
    ...(frame !== undefined ? { constraintValueFrame: frame } : {}),
  };
}
