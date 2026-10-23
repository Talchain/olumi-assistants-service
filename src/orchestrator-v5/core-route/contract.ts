/**
 * ⭐ CORE ROUTE: THE TURN CONTRACT (v1.5; DL 22 Oct, from Lenses' UI field inventory and absence audit). ONE typed builder for
 * every body `routes/core-turn.ts` sends, final JSON or the stream's COMPLETE payload, so the shape lives in one place:
 *  · `assistant_text`: the SDK's final output, byte for byte; nothing is composed around it;
 *  · `model`: `revision` (the CAS `graph_hash` a writer sends back as `base_graph_hash`), `scenario_revision` (identity.v1, the
 *    graph read's `graph_identity_hash.value`, also served there as `content_hash`: the UI's read-after-write check) and
 *    `graph`, in the same wire projection, so its ids equal the turn's streamed GRAPH_READY frame's;
 *  · `cards`: each held proposal, as `_proposal_fields` builds it today; `notes`: note_on_item's one note;
 *  · `run`: the selected Run's identity (`run_id`, as the graph read serves it) and freshness; `analysis_result` on a Run
 *    turn only;
 *    `analysis_state`: the graph read's own, whole;
 *  · `receipts`, each with who authorised it; `paused`; `error`, with honest `retry_safe` and `nothing_saved`.
 * Never the legacy envelope (response_version, blocks, suggested_actions, insights, stage_indicator): the UI parses this with
 * its own schema. Underscore keys are diagnostics for the witness scripts, never read by the UI.
 */
import type { ProposalFieldsWire } from '../agent-lane/proposal-object/record.js';
import type { TurnReceipt } from '../agent-lane/turn-receipts.js';

/** One held proposal's card: the `_proposal_fields` record the UI already reads (`proposalFieldsWire`), its own type. */
export type CoreTurnCard = ProposalFieldsWire['proposals'][number];

export interface CoreTurnNote { readonly element_id: string; readonly text: string }

export interface CoreTurnRun {
  /** The selected Run's identity as the graph read serves it (`canonical_analysis_view.run.run_id`; v1.6). */
  readonly run_id: string | null;
  /** The same identity, under the name contract v1 gave it. */
  readonly run_key: string | null;
  /** The graph hash the Run was computed against. */
  readonly computed_against: string | null;
  readonly state: { readonly kind: string; readonly computed_at: string | null };
}

/** Who authorised a saved version: the person (a card approval or their own canvas edit) or Olumi (its drafted first model). */
export type AuthorisedBy = 'person' | 'olumi';
export type CoreTurnReceipt = TurnReceipt & { readonly authorised_by: AuthorisedBy };

export interface CoreTurnError {
  readonly code: string;
  readonly message: string;
  /** Sending the same turn again runs it again (its claim is released and nothing was written). */
  readonly retry_safe: boolean;
  /** Known: nothing in the scenario was saved by this turn. False when a save happened OR may have happened. */
  readonly nothing_saved: boolean;
}

/**
 * `recorded`: the answer row is written (a resend of the turn id replays it); `replayed`: this body IS that replay;
 * `not_recorded`: the reply could not be recorded (a resend says its outcome is unknown, never runs again);
 * `unknown`: the turn's outcome is not known to this response (a stream that ended first).
 */
export type CoreTurnDurability = 'recorded' | 'replayed' | 'not_recorded' | 'unknown';

export interface CoreTurnContract {
  readonly turn_id: string | null;
  readonly durability: CoreTurnDurability;
  readonly assistant_text: string;
  readonly model: { readonly revision: string | null; readonly scenario_revision: string | null; readonly graph?: unknown };
  readonly cards: readonly CoreTurnCard[];
  readonly notes: readonly CoreTurnNote[];
  readonly run: CoreTurnRun | null;
  readonly analysis_state: unknown;
  readonly analysis_result?: unknown;
  /** SPIKE S3 (wip/spike-s3-integrate only): the model-program turn's view and its compile, chances, asks and readback. */
  readonly canonical_analysis_view?: unknown;
  readonly model_program?: unknown;
  readonly receipts: readonly CoreTurnReceipt[];
  readonly paused: { readonly proposal_id: string | null } | null;
  readonly error: CoreTurnError | null;
  /** The panel's action bar (`action-bar.ts`), ranked from the turn's own final read; null when it offers nothing. */
  readonly action_bar: unknown;
  readonly _agent?: Readonly<Record<string, unknown>>;
  readonly _provider_calls?: unknown;
}

export interface CoreTurnContractInput {
  readonly turnId: string | null;
  readonly durability: CoreTurnDurability;
  readonly assistantText?: string;
  readonly revision?: string | null;
  readonly scenarioRevision?: string | null;
  /** The saved graph in the canvas's wire projection (`appliedGraphWire`): the same ids the turn's GRAPH_READY frame carried. */
  readonly graph?: unknown;
  readonly cards?: readonly CoreTurnCard[];
  readonly notes?: readonly CoreTurnNote[];
  readonly run?: CoreTurnRun | null;
  readonly analysisState?: unknown;
  /** Only on a turn that ran (or replayed) a Run. */
  readonly analysisResult?: unknown;
  /** SPIKE S3: a model-program turn's payload blocks. */
  readonly modelProgram?: { readonly canonical_analysis_view: unknown; readonly model_program: unknown };
  readonly receipts?: readonly CoreTurnReceipt[];
  readonly paused?: { readonly proposal_id: string | null } | null;
  readonly error?: CoreTurnError | null;
  readonly actionBar?: unknown;
  readonly agent?: Readonly<Record<string, unknown>>;
  readonly providerCalls?: unknown;
}

/** The ONE builder: every key always present (an absent field is never left for the UI to guess), in one order. */
export function coreTurnContract(i: CoreTurnContractInput): CoreTurnContract {
  return {
    turn_id: i.turnId,
    durability: i.durability,
    assistant_text: i.assistantText ?? '',
    model: { revision: i.revision ?? null, scenario_revision: i.scenarioRevision ?? null, ...(i.graph !== undefined ? { graph: i.graph } : {}) },
    cards: i.cards ?? [],
    notes: i.notes ?? [],
    run: i.run ?? null,
    analysis_state: i.analysisState ?? null,
    ...(i.analysisResult !== undefined && i.analysisResult !== null ? { analysis_result: i.analysisResult } : {}),
    ...(i.modelProgram !== undefined ? { canonical_analysis_view: i.modelProgram.canonical_analysis_view, model_program: i.modelProgram.model_program } : {}),
    receipts: i.receipts ?? [],
    paused: i.paused ?? null,
    error: i.error ?? null,
    action_bar: i.actionBar ?? null,
    ...(i.agent !== undefined ? { _agent: i.agent } : {}),
    ...(i.providerCalls !== undefined ? { _provider_calls: i.providerCalls } : {}),
  };
}

/** A body that carries only an error: a refusal before or around the turn, with nothing else known about the scenario. */
export function coreTurnFailure(turnId: string | null, error: CoreTurnError,
  durability: CoreTurnDurability = 'not_recorded', extra: Pick<CoreTurnContractInput, 'agent' | 'providerCalls'> = {}): CoreTurnContract {
  return coreTurnContract({ turnId, durability, error, ...extra });
}

/**
 * The stream ended before the turn did (`streamed-turn-sse.ts`'s budget). The turn keeps running and may still save; its
 * answer row is the record, so the same turn id later replays it and never runs it again. Nothing here is known.
 */
export function coreTurnStreamTimeout(turnId: string | null): CoreTurnContract {
  return coreTurnFailure(turnId, { code: 'TURN_STILL_RUNNING',
    message: 'The reply did not arrive in time. Olumi may still be finishing this turn; reload to see the current model before sending it again.',
    retry_safe: false, nothing_saved: false }, 'unknown');
}
