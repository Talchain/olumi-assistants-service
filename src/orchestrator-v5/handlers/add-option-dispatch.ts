/**
 * S3 §5 / Lane C3 — add-option compound transaction dispatch (PURE assembly).
 *
 * The confirm-side counterpart of the free-text edit hold, reached by TYPE
 * instead of by the edit_graph LLM. Given a typed `add_option` intent
 * (`chip.intent='add_option'`) whose `chip.parameters` carry the pre-resolved
 * spec, this module:
 *   1. builds the atomic option batch (option node + parent edge + factor edges
 *      + effect VALUES) via {@link buildAddOptionTransaction};
 *   2. runs it through the SAME referee gate the free-text edit uses
 *      (`evaluateEditGraphMutations`) so a structural batch is HELD
 *      (`STRUCTURAL_APPLY_HELD`) with the executable ops embedded in a
 *      `graph_management_held_v1` `pending_actions` inline_patch;
 *   3. composes the held response (assistant copy + `held_proposal` block +
 *      confirm chip) with a proposal-time completeness disclosure.
 *
 * The confirm turn is UNCHANGED: the persisted pending is resumed by the
 * already-wired `executeGmHeldResume` (turn-executor), which re-referees and
 * applies the WHOLE batch atomically (P1b) — the option node AND its
 * interventions land together, closing the interventions=null poison gap
 * (debit a). This module writes no state and makes zero LLM calls; PURE with
 * respect to storage and total (never throws) — the caller (route-v2) owns the
 * frame load, the commit of the returned pending, and the wire send.
 *
 * WHY NOT `dispatchEditGraph`: that is the LLM edit lane (route-v2 branch,
 * gated on the message-text `editIntentDetected`) with no pre-built-operations
 * entry. Reaching it would re-parse the chip copy through Sonnet — the exact
 * "typed chip re-inferred from text" class S2 exists to kill. This module
 * reuses the two transactional seams (`evaluateEditGraphMutations` hold-side,
 * `executeGmHeldResume` confirm-side) directly.
 */
import type { OlumiResponse, HeldProposalBlock } from '@talchain/schemas/boundary';

import { GraphV3 } from '../../schemas/cee-v3.js';
import {
  evaluateEditGraphMutations,
  type EditGmChip,
  type EditGmGoverningVerdict,
} from './edit-graph-referee-gate.js';
import type { FrameFreshness } from '../graph-management/types.js';
import type { PendingAction } from '../session/pending-action.js';
import {
  buildAddOptionTransaction,
  type AddOptionGraphView,
  type AddOptionSkipReason,
} from '../routing/add-option-transaction.js';

type StageIndicator = OlumiResponse['stage_indicator'];
type BoundaryAction = OlumiResponse['suggested_actions'][number];

export interface AddOptionTransactionInput {
  /** The typed add_option chip's `parameters` bag (untyped `z.record` on wire). */
  readonly parameters: unknown;
  /** Frame-authority PRE-edit graph (strict persisted base) — validation + referee. */
  readonly currentGraph: unknown;
  /** Hash of `currentGraph`, resolved by the caller (never re-derived here). */
  readonly currentGraphHash: string | null;
  /** PRE-edit freshness verdict for the frame gate. */
  readonly freshness: FrameFreshness;
  /** Resolved `CEE_GRAPH_MANAGEMENT_MODE` — the transaction only holds under 'live'. */
  readonly mode: 'off' | 'shadow' | 'live';
  readonly scenarioId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly stage: StageIndicator;
}

export type AddOptionTransactionOutcome =
  | {
      readonly kind: 'skip';
      readonly reason:
        | AddOptionSkipReason
        | 'gm_not_live'
        | 'no_graph_hash'
        | 'unreadable_graph'
        | 'not_held';
      /** Present when the referee ran but did not hold (diagnostics only). */
      readonly governing?: EditGmGoverningVerdict;
    }
  | {
      readonly kind: 'held';
      readonly response: OlumiResponse;
      /** The held pending (with the GM_HELD_HANDLER_ID inline_patch) to commit. */
      readonly pendingActions: readonly PendingAction[];
      readonly optionId: string;
      /** True when the option lands with effect values (analysable on commit). */
      readonly configured: boolean;
    };

/** Positive completeness disclosure — the option lands analysable. */
function buildConfiguredNotice(label: string): string {
  return (
    `'${label}' comes with its effect values, so once you apply this it is ` +
    `configured and the analysis can run.`
  );
}

/**
 * Map an `EditGmChip` to the boundary `Action` shape, PRESERVING its id (the
 * `gmh_…` proposal ref) so the confirm chip is identifiable — unlike the
 * free-text edit lane's positional `edit_graph_action_<n>` ids.
 */
function chipToBoundaryAction(chip: EditGmChip): BoundaryAction {
  const action: BoundaryAction = {
    id: chip.id,
    label: chip.label,
    message: chip.message,
  };
  if (chip.action_type !== undefined) action.action_type = chip.action_type;
  if (chip.detail !== undefined) action.detail = chip.detail;
  return action;
}

/**
 * Read a minimal `{nodes, edges}` view for the transaction builder from the
 * persisted frame graph. Returns null when the graph is unreadable (→ skip),
 * so a corrupt frame never synthesises a doomed proposal.
 */
function toGraphView(currentGraph: unknown): AddOptionGraphView | null {
  const parsed = GraphV3.safeParse(currentGraph);
  if (!parsed.success) return null;
  return {
    nodes: parsed.data.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label })),
    edges: parsed.data.edges.map((e) => ({ from: e.from, to: e.to })),
  };
}

/**
 * Assemble the held add-option transaction, or a classified skip the caller
 * falls through on (to the existing free-text/LLM edit path). Total; never
 * throws.
 */
export function dispatchAddOptionTransaction(
  input: AddOptionTransactionInput,
): AddOptionTransactionOutcome {
  // The hold machinery only exists under GM 'live' (R-7: config-dependent on
  // staging, not a repo default). Shadow/off cannot carry a held pending, so
  // the typed path defers to the existing edit lane.
  if (input.mode !== 'live') return { kind: 'skip', reason: 'gm_not_live' };
  // A held pending's precondition needs a readable frame hash.
  if (input.currentGraphHash === null) return { kind: 'skip', reason: 'no_graph_hash' };

  const graphView = toGraphView(input.currentGraph);
  if (graphView === null) return { kind: 'skip', reason: 'unreadable_graph' };

  const built = buildAddOptionTransaction(input.parameters, graphView);
  if (!built.matched) return { kind: 'skip', reason: built.reason };
  const { operations, optionId, optionLabel, configured } = built.proposal;

  // Referee the batch through the SAME gate the free-text edit uses. The ops
  // were built against `currentGraph`, so `baseGraphHash === currentGraphHash`
  // (base_hash_match=true). `dispatchPath: 'edit_graph'` mints the typed
  // held_proposal block (the confirm re-referee uses 'gm_held_resume').
  const decision = evaluateEditGraphMutations({
    mode: 'live',
    operations,
    currentGraph: input.currentGraph,
    currentGraphHash: input.currentGraphHash,
    baseGraphHash: input.currentGraphHash,
    freshness: input.freshness,
    scenarioId: input.scenarioId,
    turnId: input.turnId,
    requestId: input.requestId,
    dispatchPath: 'edit_graph',
    // No userMessage: the F-3 protection-scope demotion keys on free-text
    // ("do not touch X") which a typed add_option turn does not carry, and a
    // structural add targets only the NEW option, never a protected entity.
  });

  // A structural batch against a fresh/none frame holds STRUCTURAL_APPLY_HELD.
  // Any other verdict (stale analysis, an integrity reject the pre-validation
  // did not catch, or proceed under a relaxed mode) is deferred to the
  // existing edit lane rather than invented here.
  if (
    decision.governing !== 'held' ||
    decision.pendingActions === null ||
    decision.pendingActions.length === 0
  ) {
    return { kind: 'skip', reason: 'not_held', governing: decision.governing };
  }

  // Proposal-time completeness disclosure (ROADMAP 2.11 doctrine, at PROPOSAL
  // time). The CONFIGURED case gets an explicit "ready to analyse" affirmation
  // the referee gate's held copy does not carry. The UNCONFIGURED case is
  // DELIBERATELY not re-disclosed here (C4): the gate's held copy already emits
  // the 2.11 needs-encoding notice for a factor-linkless option add
  // ("...has no effect values yet. Tell me what it changes and I'll write in
  // the real numbers." — prediction-free per 2.117 round 2), so appending
  // `buildUnconfiguredOptionsNotice` too would state it TWICE. The
  // gate's structural heads-up fires exactly when there are no factor links,
  // which is precisely `configured === false` here (one factor edge per value),
  // so relying on it never drops the disclosure.
  const disclosure = configured ? buildConfiguredNotice(optionLabel) : null;
  const baseText = decision.assistantText ?? '';
  const assistantText =
    disclosure === null || disclosure.length === 0
      ? baseText
      : baseText.length === 0
        ? disclosure
        : `${baseText} ${disclosure}`;

  const blocks: OlumiResponse['blocks'] =
    decision.heldProposalBlock != null
      ? [decision.heldProposalBlock as HeldProposalBlock]
      : [];
  const suggestedActions = (decision.suggestedActions ?? []).map(chipToBoundaryAction);

  const response: OlumiResponse = {
    response_version: 2,
    assistant_text: assistantText,
    blocks,
    suggested_actions: suggestedActions,
    insights: [],
    stage_indicator: input.stage,
  } as OlumiResponse;

  return {
    kind: 'held',
    response,
    pendingActions: decision.pendingActions,
    optionId,
    configured,
  };
}
