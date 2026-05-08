/**
 * V5 G7/G8 — proposed-change emit helper.
 *
 * `emitProposedChange` is the only sanctioned site for materialising an
 * `apply_proposed_change` proposal. It produces the public chip and the
 * matching server-side pending action together so the atomic-emit
 * contract holds: both go into the same `CommitMetadata.pending_actions`
 * payload and the same `append_turn_atomic` call.
 *
 * Public proposal handle (Option B):
 *   - Wire chip uses an existing `boundary.ActionType` literal —
 *     `add_constraint`, `set_factor_value`, or `adjust_edge_strength`.
 *   - Chip `id` is a stable `prop_<sha256-12hex>` derived from
 *     `(scenario_id, intent, params, graph_hash)`.
 *   - The chip's `id` is the public `proposal_ref` carried inside the
 *     pending action's `inline_patch.proposal_ref` mirror plus the
 *     pending action's top-level `proposal_ref` field. The exact-match
 *     between chip.id and pending.proposal_ref is the bridge the short-
 *     confirm resumer relies on.
 *
 * Safety:
 *   - User-facing `label` and `message` are validated against
 *     SAFETY_FORBIDDEN_TOKENS at emit time. Any forbidden token returns
 *     `unsafe_copy` rather than emitting the proposal.
 *   - `intent` is checked against the live handler registry. If no
 *     handler is registered, returns `unknown_intent` and emits
 *     nothing — fails closed rather than producing a chip the resumer
 *     cannot honour.
 */

import { createHash, randomUUID } from 'node:crypto';

import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import {
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
  type PendingAction,
} from '../session/pending-action.js';
import { resolveHandler } from '../tools/registry.js';
import type {
  ProposedChange,
  ProposedChangeContext,
  ProposedChangeEmitResult,
  ProposedChangeIntent,
} from '../types/proposed-change.js';
import { intentToActionType } from '../types/proposed-change.js';
import type { SuggestedAction } from './types.js';

/** Length of the sha256-derived suffix on the proposal id. */
const PROPOSAL_ID_HEX_LENGTH = 12;

/**
 * Stable id prefix for proposed-change chips. Verified collision-free
 * against the existing `chip_*` chip-id family at plan time.
 */
const PROPOSAL_ID_PREFIX = 'prop_';

/**
 * Forbidden tokens in user-facing copy. Case-insensitive substring
 * match; mirrors the safety filter applied in tests so production
 * emit refuses to surface internal vocabulary regardless of the
 * caller's casing. Categories:
 *   - internal pending-action / proposal vocabulary
 *   - V5 handler ids (must never appear in chips or messages)
 *   - schema/validation jargon
 *   - obvious raw-id patterns (e.g. UUIDs, prop_ / chip_ prefixes
 *     used for internal handles)
 *   - typographic constraints (em dash)
 */
const SAFETY_FORBIDDEN_TOKENS: readonly string[] = [
  // pending-action / proposal vocabulary
  'apply_proposed_change',
  'pending_actions',
  'proposal_ref',
  'chip_metadata',
  // V5 handler ids — bare identifiers must never appear in user copy
  'add_constraint',
  'set_factor_value',
  'adjust_edge_strength',
  'run_analysis',
  'what_would_flip',
  'explain_from_structure',
  'explain_results',
  'explain_result',
  'compare_options',
  'edit_graph_add_risk',
  // schema / validation jargon
  'zod',
  'structural_validation_failed',
  'entity_kind_mismatch',
  'precondition_unmet',
  // raw id patterns the chip layer must not leak
  'prop_',
  'chip_',
  // typographic
  '—', // em dash
];

/**
 * Case-insensitive substring match. Returns the matched token (in
 * lower case) or null when nothing forbidden appears.
 */
function findForbiddenToken(value: string): string | null {
  const haystack = value.toLowerCase();
  for (const token of SAFETY_FORBIDDEN_TOKENS) {
    const needle = token.toLowerCase();
    if (haystack.includes(needle)) return token;
  }
  return null;
}

/**
 * Inputs the proposal id is computed from. Single source of truth so
 * the emit path and tests share the exact set of canonicalised fields.
 * Adding a new field here is a deliberate change that should ship
 * alongside a collision-proof test.
 */
export interface ProposalIdInputs {
  readonly scenario_id: string;
  readonly intent: ProposedChangeIntent;
  readonly params: Readonly<Record<string, unknown>>;
  readonly graph_hash: string;
  /**
   * Target entity ids (sorted at compute time so order is irrelevant
   * to the resulting id). Two proposals identical in scenario, intent,
   * params and graph_hash but different in targets MUST get distinct
   * ids — without this field they would silently collide.
   */
  readonly target_entity_ids: readonly string[];
}

/**
 * Compute the stable proposal id. Inputs are canonicalised via
 * `stableStringify` so param key ordering does not change the hash;
 * `target_entity_ids` is sorted before serialisation for the same
 * order-independence reason.
 */
export function computeProposalId(inputs: ProposalIdInputs): string {
  const sortedTargets = [...inputs.target_entity_ids].sort();
  const canonical = stableStringify({
    scenario_id: inputs.scenario_id,
    intent: inputs.intent,
    params: inputs.params,
    graph_hash: inputs.graph_hash,
    target_entity_ids: sortedTargets,
  });
  const digest = createHash('sha256')
    .update(canonical, 'utf8')
    .digest('hex')
    .slice(0, PROPOSAL_ID_HEX_LENGTH);
  return `${PROPOSAL_ID_PREFIX}${digest}`;
}

export function emitProposedChange(
  proposal: ProposedChange,
  ctx: ProposedChangeContext,
): ProposedChangeEmitResult {
  // Safety-string filter on user-facing copy. Refuse to emit rather
  // than leaking internal vocabulary into a chip we will persist.
  const labelForbidden = findForbiddenToken(proposal.label);
  if (labelForbidden !== null) {
    return { status: 'unsafe_copy', field: 'label', forbidden_token: labelForbidden };
  }
  const messageForbidden = findForbiddenToken(proposal.message);
  if (messageForbidden !== null) {
    return { status: 'unsafe_copy', field: 'message', forbidden_token: messageForbidden };
  }

  // Handler resolution gate. If no handler is registered for this
  // intent, refuse — the resumer would be unable to honour a "yes"
  // even if the chip persisted.
  const actionType = intentToActionType(proposal.intent);
  if (resolveHandler(ctx.registry, actionType) === null) {
    return { status: 'unknown_intent', intent: proposal.intent };
  }

  // Stable proposal id. Same inputs always produce the same id, so a
  // duplicate emit reuses the same chip id (and therefore the same
  // proposal_ref) — the resumer treats it as one offer, not two.
  // Targets are part of the id so two proposals that differ only in
  // their target node produce distinct ids and never collide.
  const proposalId = computeProposalId({
    scenario_id: ctx.scenario_id,
    intent: proposal.intent,
    params: proposal.params,
    graph_hash: ctx.graph_hash,
    target_entity_ids: proposal.target_entity_ids ?? [],
  });

  const chip: SuggestedAction = {
    id: proposalId,
    label: proposal.label,
    message: proposal.message,
    action_type: actionType,
  };

  const wallMs = ctx.wall_ttl_ms ?? PENDING_ACTION_DEFAULT_WALL_TTL_MS;
  const turnTtl = ctx.turn_ttl ?? PENDING_ACTION_DEFAULT_TURN_TTL;
  const expiresAtIso = new Date(Date.parse(ctx.emitted_at_iso) + wallMs).toISOString();

  const pending: PendingAction = {
    id: randomUUID(),
    scenario_id: ctx.scenario_id,
    chip_id: proposalId,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: proposalId,
      inline_patch: {
        handler_id: actionType,
        params: proposal.params,
        target_entity_ids: proposal.target_entity_ids ?? [],
      },
      // Persist the user-facing label and message so the ambiguous-
      // clarification path can render numbered options with the
      // proposal's actual labels (P1-1). Both are validated against
      // the safety filter at the top of this function, so the
      // resumer can re-render without re-validating.
      public_label: proposal.label,
      public_message: proposal.message,
    },
    preconditions: {
      graph_hash: ctx.graph_hash,
      target_entity_ids: proposal.target_entity_ids,
    },
    expires_at_turn_count: turnTtl,
    expires_at_iso: expiresAtIso,
    emitted_at_iso: ctx.emitted_at_iso,
  };

  return { status: 'success', chip, pending };
}

/**
 * Re-export the safety token list so tests can assert the same filter
 * the production emit applies — single source of truth.
 */
export { SAFETY_FORBIDDEN_TOKENS };
