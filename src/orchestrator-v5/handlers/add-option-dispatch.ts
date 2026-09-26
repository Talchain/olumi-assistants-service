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
  buildNeedsEncodingAddNotice,
  evaluateEditGraphMutations,
  GM_HELD_OPERATIONS_MAX_JSON_CHARS,
  type EditGmChip,
  type EditGmGoverningVerdict,
} from './edit-graph-referee-gate.js';
import { TYPED_TRANSACTION_ENVELOPE_CAP, type FrameFreshness } from '../graph-management/types.js';
import type { PendingAction } from '../session/pending-action.js';
import {
  buildAddOptionsTransaction,
  MAX_OPTIONS_PER_TRANSACTION,
  type AddOptionGraphView,
  type AddOptionsSkipReason,
} from '../routing/add-option-transaction.js';
import { log } from '../../utils/telemetry.js';

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
        // Every builder refusal except `too_many_options`, which is REFUSED with a sentence, not skipped —
        // including the new-factor reasons (ruling #70 5843972346).
        | Exclude<AddOptionsSkipReason, 'too_many_options'>
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
      readonly optionLabel: string;
      /** True when the option lands with effect values (analysable on commit). */
      readonly configured: boolean;
      /** Factors linked with NO value — the explicit unknowns this hold discloses. */
      readonly linkedUnvaluedFactorIds: readonly string[];
      /**
       * (A) — every option this ONE hold adds, in request order. The single
       * fields above describe the FIRST, so single-option callers are unchanged.
       */
      readonly options: readonly AddOptionHeldEntry[];
    }
  | {
      /**
       * (A) — a batch the hold cannot carry, refused at PROPOSE with a sentence
       * and no pending: never a hold whose "yes" would silently decline.
       */
      readonly kind: 'refused';
      readonly reason: 'too_many_options' | 'too_many_changes' | 'payload_too_large';
      readonly response: OlumiResponse;
    };

export interface AddOptionHeldEntry {
  readonly optionId: string;
  readonly optionLabel: string;
  readonly configured: boolean;
  readonly linkedUnvaluedFactorIds: readonly string[];
}

function refusedResponse(text: string, stage: StageIndicator): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: text,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: stage,
  } as OlumiResponse;
}

/** "'A'", "'A' and 'B'", "'A', 'B' and 'C'". */
function joinQuoted(labels: readonly string[]): string {
  const q = labels.map((l) => `'${l}'`);
  return q.length <= 1 ? (q[0] ?? '') : `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
}

/** Positive completeness disclosure — the option lands analysable. */
function buildConfiguredNotice(label: string): string {
  return (
    `'${label}' comes with its effect values, so once you apply this it is ` +
    `configured and the analysis can run.`
  );
}

/**
 * The linked-but-unvalued disclosure: name the factors this option was linked
 * to, and say plainly that the SIZE of each effect is not known.
 *
 * It exists because the gate's generic notice ("… has no effect values yet.
 * Tell me what it changes and I'll write in the real numbers.") is correct for
 * a bare option and slightly wrong here — the model HAS said what it changes;
 * what is missing is only the magnitude. The caller REMOVES the generic
 * sentence (derived from the gate's own builder, never re-typed) and puts this
 * in its place, so the user is asked one question rather than two overlapping
 * ones.
 */
export function buildLinkedUnvaluedNotice(label: string, factorLabels: readonly string[]): string {
  const named =
    factorLabels.length === 1
      ? `'${factorLabels[0]}'`
      : `${factorLabels.slice(0, -1).map((l) => `'${l}'`).join(', ')} and '${factorLabels[factorLabels.length - 1]}'`;
  // ⚠ "either" MEANS ONE OF TWO. This read `length === 1 ? 'it' : 'either'`,
  // so three and four factors — the ordinary text-leg case — were told
  // "without a size of effect on EITHER". Flagged twice, pinned by no test,
  // carried past twelve heads. Three arms, not two.
  const them =
    factorLabels.length === 1 ? 'it' : factorLabels.length === 2 ? 'either' : 'any of them';
  return (
    `I've linked '${label}' to ${named}, without a size of effect on ` +
    `${them} — I don't have those numbers. ` +
    `Tell me what ${factorLabels.length === 1 ? 'it' : 'each'} changes by and I'll write them in.`
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
    nodes: parsed.data.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      ...(typeof (n as { category?: unknown }).category === 'string' ? { category: (n as { category: string }).category } : {}),
    })),
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

  const built = buildAddOptionsTransaction(input.parameters, graphView);
  if (!built.matched) {
    if (built.reason === 'too_many_options') {
      return {
        kind: 'refused',
        reason: 'too_many_options',
        response: refusedResponse(
          `I can add up to ${MAX_OPTIONS_PER_TRANSACTION} options in one go, so I haven't ` +
            `changed anything. Tell me the first ${MAX_OPTIONS_PER_TRANSACTION} and I'll add the rest after.`,
          input.stage,
        ),
      };
    }
    return { kind: 'skip', reason: built.reason };
  }
  const { operations, proposals } = built;
  const first = proposals[0]!;
  const { optionId, optionLabel, linkedUnvaluedFactorIds } = first;
  const configured = proposals.every((p) => p.configured);

  // (A) — the hold carries its operations in the pending's JSONB, capped at
  // GM_HELD_OPERATIONS_MAX_JSON_CHARS. Past it, the gate would mint a hold in
  // the DECLINE posture, and the user's "yes" would apply nothing. Refuse HERE,
  // before any hold exists, and say so.
  // (A) — past the typed envelope cap, the referee would reject the batch and
  // the route would fall through to the free-text edit lane (review 5841737272
  // N1: 4 options × 7 factors = 36 ops). Refuse HERE with a sentence instead.
  if (operations.length > TYPED_TRANSACTION_ENVELOPE_CAP) {
    return {
      kind: 'refused',
      reason: 'too_many_changes',
      response: refusedResponse(
        proposals.length === 1
          ? `That option changes more than I can hold for one approval, so I haven't changed ` +
              `anything. Give me its main effects first and I'll add the rest after.`
          : `That is more changes than I can hold for one approval, so I haven't changed ` +
              `anything. Add fewer options, or fewer effects per option, and I'll put them in.`,
        input.stage,
      ),
    };
  }

  const payloadChars = JSON.stringify(operations).length;
  if (payloadChars > GM_HELD_OPERATIONS_MAX_JSON_CHARS) {
    log.warn(
      {
        event: 'v5.add_option.payload_too_large',
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        options: proposals.length,
        operations: operations.length,
        payload_chars: payloadChars,
      },
      'add-option — the batch is past the hold payload cap; refusing at propose',
    );
    return {
      kind: 'refused',
      reason: 'payload_too_large',
      response: refusedResponse(
        // Review 5841737272 N2: one option is not "groups".
        proposals.length === 1
          ? `That option carries more than I can hold for one approval, so I haven't changed ` +
              `anything. Give me its main effects first and I'll add the rest after.`
          : `That is too much to hold for one approval, so I haven't changed anything. ` +
              `Add the options in smaller groups and I'll put each group in.`,
        input.stage,
      ),
    };
  }

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
    // (A) — a CEE-built typed transaction: its size is bounded by the builder
    // (`MAX_OPTIONS_PER_TRANSACTION`), so the referee judges it under the typed
    // ceiling, and the hold records that cap for the confirm.
    envelopeCap: TYPED_TRANSACTION_ENVELOPE_CAP,
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
  const multi = proposals.length > 1;
  const configuredLabels = proposals.filter((p) => p.configured).map((p) => p.optionLabel);
  const disclosure = !multi
    ? configured
      ? buildConfiguredNotice(optionLabel)
      : null
    : configuredLabels.length > 0
      ? `${joinQuoted(configuredLabels)} ${configuredLabels.length === 1 ? 'comes' : 'come'} with ` +
        `effect values, so once you apply this ${configuredLabels.length === 1 ? 'it is' : 'they are'} ` +
        `configured and the analysis can run.`
      : null;
  let baseText = decision.assistantText ?? '';

  // ⭐ THE LINKED-BUT-UNVALUED CASE (text leg). The option lands with factor
  // edges and no magnitudes, so the honest ask is "how big?", not "what does
  // it change?". Swap the gate's generic sentence for the specific one, and
  // DERIVE the sentence to remove by calling the gate's OWN builder rather
  // than re-typing it here — if that copy changes, this keeps matching
  // (trap 12: the dominant defect is the hand-maintained mirror). If it ever
  // stops matching, the worst case is both sentences shipping, never a
  // silently dropped disclosure.
  const linkedNotices: string[] = [];
  // A factor this batch ADDS is not in the pre-edit graph: name it from the batch (contract 5843960061).
  const labelOf = (id: string): string =>
    built.newFactors.find((f) => f.id === id)?.label ??
    graphView.nodes.find((n) => n.id === id)?.label ??
    id;
  for (const p of proposals) {
    if (p.linkedUnvaluedFactorIds.length === 0) continue;
    linkedNotices.push(
      buildLinkedUnvaluedNotice(p.optionLabel, p.linkedUnvaluedFactorIds.map(labelOf)),
    );
  }
  if (linkedNotices.length > 0) {
    const generic = buildNeedsEncodingAddNotice(operations, input.currentGraph);
    if (generic !== null && baseText.includes(generic)) {
      baseText = baseText.replace(generic, '').replace(/\s{2,}/g, ' ').trim();
    }
  }

  const trailing = [disclosure, ...linkedNotices].filter(
    (t): t is string => t !== null && t.length > 0,
  );
  const assistantText = [baseText, ...trailing]
    .filter((t) => t.length > 0)
    .join(' ');

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
    optionLabel,
    configured,
    linkedUnvaluedFactorIds,
    options: proposals.map((p) => ({
      optionId: p.optionId,
      optionLabel: p.optionLabel,
      configured: p.configured,
      linkedUnvaluedFactorIds: p.linkedUnvaluedFactorIds,
    })),
  };
}
