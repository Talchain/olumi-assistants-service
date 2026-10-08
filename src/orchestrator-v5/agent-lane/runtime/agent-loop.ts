/**
 * Agent lane — the server-side Managed Agent loop.
 *
 * The Agent owns conversation, reasoning, context and tool choice. This module
 * owns none of those: it carries messages, executes the tools the Agent chooses
 * inside the request's authenticated context, and returns the text the Agent
 * produced, or the caller's composed reply. If narration fails after a hold,
 * it answers from that known held result so the user can still review it.
 *
 * ⭐ MEASURED PROTOCOL FACTS, not assumptions:
 *   · A reasoning model's `function_call` must be replayed WITH its preceding
 *     `reasoning` item, or the API refuses: "Item 'fc_…' was provided without
 *     its required 'reasoning' item". So the whole `output` array is echoed back
 *     before the tool result is appended.
 *   · Agents *sessions* were unavailable when this was built (every session
 *     created stalled at `in_progress`), so the transport is `/v1/responses`.
 *     That is a seam: the same tools and the same in-context execution move to
 *     sessions unchanged if they recover.
 */

import { randomUUID } from 'node:crypto';
import { toolsFor, dispatchTool, MUTATION_TOOLS, type AgentCapabilities, type AgentToolContext, type AgentLaneMode, type ToolResult } from './agent-tools.js';
import { modelFacingToolResult } from '../licensed-run-view.js';
import { composeHeldResultReply } from '../proposal-reply.js';
import { isProposingTool, proposalsAwaitingApproval, NOT_ON_NARRATION, ONE_CHANGE_PER_APPROVAL, ONE_CHANGE_PER_APPROVAL_DETAIL, WITHDRAW_PROPOSAL, NOT_PROPOSED_THIS_TURN } from '../approval-chips.js';
import { config } from '../../../config/index.js';
import { log } from '../../../utils/telemetry.js';
import {
  eligibleTools,
  type CanonicalContextPacket,
  type ContextExpectation,
} from './request-assembly.js';

export interface ModelCallRequest {
  readonly instructions: string;
  readonly input: readonly unknown[];
  readonly tools: readonly unknown[];
  readonly max_output_tokens: number;
  /** The ONE tool this call must make (`AgentTurnInput.firstCallTool`), sent only on the turn's first call. */
  readonly tool_choice?: { readonly type: 'function'; readonly name: string };
  /** A caller-set deadline: the call aborts at it and is never retried (`withTransportRetry`). */
  readonly deadline_ms?: number;
  /** T1 (b): the ledger's purpose for a cache prewarm (`PREWARM_OUTPUT_TOKENS`); never sent to the provider. */
  readonly purpose?: 'prewarm';
  /**
   * P44 S1: this call only states a proposal the previous hop already held (`hopOnlyHeldProposals`), so the route may
   * send it at the model's banked `narrate` effort (`narrateEffortFor`), with `NARRATE_LABEL_LINE` last in its input. Never sent to
   * the provider; absent ⇒ as before.
   */
  readonly reasoning_role?: 'narrate';
}

export interface ModelCallResponse {
  readonly output: readonly Record<string, unknown>[];
  readonly usage?: Record<string, unknown>;
  /**
   * The Responses envelope's own completion status (`completed`, `incomplete`, …) and, when incomplete, why
   * (`max_output_tokens`, `content_filter`). A 200 can carry a PARTIAL answer (AIX-001, #70 5847339874).
   */
  readonly status?: string;
  readonly incomplete_reason?: string;
}

/**
 * ⛔ AN UNFINISHED ANSWER IS NOT AN ANSWER (AIX-001): the envelope, or any message in it, says `incomplete` — the
 * visible text may stop before its closing caveat. Absent status is read as finished, as the API did before it had one.
 */
export function answerIsIncomplete(resp: ModelCallResponse): boolean {
  if (resp.status === 'incomplete') return true;
  return (resp.output ?? []).some((o) => o['type'] === 'message' && o['status'] === 'incomplete');
}

export type CallModel = (req: ModelCallRequest) => Promise<ModelCallResponse>;

/** A call's `proposal_id` argument, or undefined when its arguments do not parse or carry none. Never throws. */
const proposalIdArg = (raw: unknown): string | undefined => {
  try {
    const id = (JSON.parse(String(raw ?? '{}')) as { proposal_id?: unknown } | null)?.proposal_id;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
};

export interface AgentTurnInput {
  readonly ctx: AgentToolContext;
  /** Prior turns, already in Responses-API item shape. Olumi owns this record. */
  readonly history: readonly unknown[];
  readonly message: string;
  readonly instructions: string;
  readonly maxOutputTokens: number;
  /** Hard ceiling on tool round trips within one user turn. */
  readonly maxHops?: number;
  /**
   * 'preview' hands the model a READ-ONLY tool surface. Defaulting to 'full'
   * keeps existing callers unchanged; the preview deployment opts in.
   */
  readonly mode?: AgentLaneMode;
  /**
   * Canonical state the server ALREADY holds, plus what it believes is true, so
   * the loop can stop offering a tool whose answer it is carrying.
   *
   * Measured: 18.58s / 7 provider calls / $0.0231 with the redundant read,
   * 12.32s / 4 / $0.0132 without it (~34% faster, ~43% cheaper).
   *
   * ⛔ OPTIONAL, AND ABSENCE IS SAFE IN THE DIRECTION IT FAILS. With no packet
   * the loop offers the full set for the mode, exactly as before — absence of
   * context can only ever give the model MORE read tools, never more authority.
   * The packet is VERIFIED here (HMAC, subject, revision, turn); a forged or
   * stale one simply keeps the read tool.
   */
  readonly canonicalContext?: {
    readonly packet: CanonicalContextPacket | null;
    readonly expectation: ContextExpectation;
  };
  /**
   * Tools this turn carries no authority for. They are removed from what the
   * model is offered AND refused at dispatch if it names one anyway, before
   * any capability is reached. Can only REMOVE: absent means the mode's set.
   */
  readonly withheldTools?: readonly string[];
  /**
   * ⭐ PJ-C1 LATENCY (#70 5859918872; words AIC 5859933281): given the turn's ONLY tool call and its result, the reply
   * composed from that result (`composeProposalReply`), or `null` to keep the narrating call. Asked only when a hop made
   * exactly one call and it is the turn's first; a composed reply ends the turn with no further model call.
   */
  readonly composeReply?: (tool: string, args: unknown, result: ToolResult) => string | null;
  /** Injected for deterministic tests; defaults to the wall clock. */
  readonly now?: () => number;
  /**
   * ⭐ A CHIP THE USER PRESSED NAMES THE TOOL ITS FIRST CALL MAKES (P-CORE #78 5911687135; DL 5912622789 item 5): "Suggest
   * starting assumptions" → `propose_starting_point`. The prompt stated the rule and neither prompt fired it reliably
   * (P0 2/4, P1a 0/2, P1b 0/2); the press is the user's request, so the first call is required to make it. Applied only
   * when that tool is offered on this turn (a withheld or ineligible tool is never forced); every later call is free.
   * Absent ⇒ exactly as before.
   */
  readonly firstCallTool?: string;
  /**
   * ⭐ T1 (a): THE HOST MAKES THE FIRST CALL ITSELF (DL 5942371176). On a first brief the first model call only ever decided
   * to call `build_model_from_brief` with the user's words: a whole call (13.6–14k input tokens, ~4 s served) to name a
   * tool the host already knows. When set, hop 0 makes NO model call: this call is put in the conversation exactly as a
   * model-made call would be and goes through the SAME dispatch (withheld check, one-change rule, bookkeeping, licensed
   * output), then the next hop's call answers from its result. Applied only when that tool is offered on this turn;
   * otherwise hop 0 calls the model as before. Absent ⇒ exactly as before.
   */
  readonly hostFirstCall?: { readonly name: string; readonly args: Readonly<Record<string, unknown>> };
  /**
   * ⭐ RT-1: WHAT THE USER HAD SELECTED ON THE CANVAS, as one developer note for THIS turn (`selection-context.ts`).
   * Placed after the model state it is resolved against, and like that state never handed on into the history: the
   * next turn carries its own selection. Context only: it adds no tool and no authority. Absent ⇒ exactly as before.
   */
  readonly selectionNote?: string;
}

/**
 * ⭐ T1 (b): THE CALL THE HOST REPLACED STILL WARMS THE CACHE. When the host makes the first call (`hostFirstCall`), the
 * model call it replaces is still SENT, capped and never awaited: its prompt (instructions + tools + this turn's items)
 * is the exact prefix of the next hop's call, so that call reads it from the provider's cache as it did when the model
 * made the first call (~14k cached tokens served). No `prompt_cache_key`: the static prefix is already shared ACROSS
 * scenarios by prefix routing (served 2 Oct: a new scenario's first call read 14,116 cached tokens another scenario
 * wrote), and a per-scenario key would route each scenario apart. Nothing reads its output; a failure costs nothing. It is a real
 * provider call, so it is on the turn's ledger under its own purpose (`prewarm`) and counts in `llm_calls_used` (DL).
 */
export const PREWARM_OUTPUT_TOKENS = 16;
export const PREWARM_DEADLINE_MS = 15_000;

/** The prefix of the call id a host-made first call carries in the conversation (never a model's id; unique per turn). */
export const HOST_FIRST_CALL_ID = 'host_first_call';

/**
 * Where a turn's wall time actually went.
 *
 * ⭐ MEASURED REASON THIS EXISTS. On the live estate over 3 days, turns with ONE
 * provider call average 37.6s (p50 47.4s, p95 73.9s) while turns with TWO
 * average 12.2s — so wall time tracks the DURATION of a call, not the NUMBER of
 * them, and construction writes are 0.58s average (~0.8% of the turn). That
 * points at model generation rather than request overhead, but the turn record
 * stores only `duration_ms` and `llm_calls_used` and cannot prove it.
 *
 * ⛔ `overhead_ms` IS A RESIDUAL, DELIBERATELY: total minus provider minus tool.
 * Anything not attributed lands in it and shows up as unexplained, so the
 * measurement cannot quietly under-report the part nobody thought to time.
 */
export interface TurnTiming {
  readonly total_ms: number;
  readonly provider_ms: number;
  readonly tool_ms: number;
  /** total - provider - tool, floored at 0. Never negative. */
  readonly overhead_ms: number;
  /**
   * Provider time spent INSIDE a tool, already counted in `provider_ms` and
   * already removed from `tool_ms`. Surfaced separately because it is the
   * difference between "the model is slow" and "our own tool is slow", and
   * those lead a reader somewhere different.
   */
  readonly tool_provider_ms: number;
  readonly provider_calls: number;
  readonly tool_calls: number;
  readonly hops: number;
}

export interface AgentTurnResult {
  readonly assistant_text: string;
  /** The full item list, for Olumi to persist as the conversation of record. */
  readonly items: readonly unknown[];
  /**
   * ⭐ THE IDENTITY FIELDS ARE PART OF THE RECORD, NOT DECORATION. Without
   * `proposal_id` here, a witness cannot tell an authorisation that applied the
   * offered proposal from one that regenerated a fresh mutation after the user
   * said yes — which is the exact failure the proposal contract exists to stop.
   * The prose matching is circumstantial; this is the binding.
   */
  readonly tool_calls: readonly {
    name: string; ok: boolean; mutated: boolean;
    proposal_id?: string; outcome?: string; refusal?: string;
    /** A refused call's conflict fields — which parts of what the model sent fired (names only, never the figure). */
    conflict_fields?: readonly string[];
    /** A refused switch level's entries AS SENT — option, factor, value, unit, estimate; bounded (`rejectedLevelsOf`). */
    rejected_levels?: readonly RejectedLevel[];
    /** Why a construction ended without an answer (`max_output_tokens`, `construction_timeout`) — for exports. */
    incomplete_reason?: string;
  }[];
  /** Full results, so Olumi can decide what it owes the user this turn. */
  readonly tool_results: readonly ToolResult[];
  /** True when any tool actually changed the model. */
  readonly mutated: boolean;
  readonly hops: number;
  readonly stopped_reason: 'answered' | 'hop_limit' | 'incomplete';
  /** Where this turn's wall time went. Always present. */
  readonly timing: TurnTiming;
}

const DEFAULT_MAX_HOPS = 6;

/**
 * ⭐ P44 S1 — THE CALL AFTER A HELD PROPOSAL ONLY SAYS WHAT THE RESULT HOLDS (DL 58e392 GO, 7 Oct). True when every call of
 * the hop just made was a proposing tool that held its change (`ok`, not `mutated`, with a `proposal_id`). The next call
 * then states it and asks for the yes; its decision was the hop before. Measured on the served narration bytes
 * (prompt 8c743f05, tools ae038f5f), 2 cases × 2 reps per arm: Sol high median 6.7 s vs low 3.1 s, truth rows 8/8 both
 * (not claimed added, what it threatens, drivers, placeholder, asks, no id; the double-count warning kept 2/2 at low).
 */
/**
 * The one line a narrating call adds at the END of its input (after the cached prefix), never handed on into history.
 * Without it, low and medium effort named the held risk by paraphrase ("the onboarding-delay risk") 0/2 each; with it, the
 * exact quoted label 4/4 at low, every other truth row held (DL 58e392 ruling: the user's model labels are quoted exactly).
 */
export const NARRATE_LABEL_LINE = 'Name the change you proposed by its exact label, in quotes.';
const NARRATE_ITEM = { role: 'developer', content: [{ type: 'input_text', text: NARRATE_LABEL_LINE }] } as const;

/**
 * The refusal an approval gets on a narrating call (Codex buddy r1 P1 / r2 P2 on #2781; DL 58e392 ruling B). The lowered
 * call keeps its tools (same cached prefix) so it can still withdraw and correct what it just held (measured at low: the
 * wrong "very strong" withdrawn 2/2, and the next hop, at the budget's own effort, re-proposed "strong" 2/2). It may not
 * approve: an approval is the user's, and is never decided at the lowered effort.
 */
export { NOT_ON_NARRATION };
const AUTHORISE_TOOL = 'authorise_change';

export function hopOnlyHeldProposals(calls: readonly { name: string }[], results: readonly ToolResult[]): boolean {
  return calls.length > 0 && calls.length === results.length && calls.every((c, i) => {
    const r = results[i] as { ok?: unknown; mutated?: unknown; proposal_id?: unknown } | undefined;
    return isProposingTool(c.name) && r?.ok === true && r.mutated === false && typeof r.proposal_id === 'string' && r.proposal_id !== '';
  });
}

// Diagnostic content is deliberately narrower than the tool schema: never
// copy basis, rationale, quotes, messages, credentials or arbitrary properties.
const REFUSAL_SCALARS = [
  'value', 'unit', 'label', 'goal_label', 'factor_label', 'option_label',
  'from_label', 'to_label', 'goal_id', 'factor_id', 'option_id', 'proposal_id',
  'direction', 'strength', 'goal_is', 'user_stated', 'estimate', 'revise', 'keep',
] as const;

const credentialLike = /(?:\b(?:bearer|password|secret|credential|authorization|token|api[_ -]?key|private[_ -]?key)\b|\bsk-[\w-]+|\bAKIA[\w]+|[A-Za-z0-9_+/=-]{32,}|https?:\/\/\S+|[^\s@]+@[^\s@]+)/i;
const quotedSpans = /"[^"]*"|“[^”]*”|‘[^’]*’|'[^']*'|`[^`]*`/g;

const refusalDetail = (detail: unknown): string | undefined => {
  if (typeof detail !== 'string') return undefined;
  // Test the entire detail BEFORE truncating: a key prefix beyond the bound
  // must not make an earlier part of a credential visible.
  if (credentialLike.test(detail)) return '[redacted]';
  return detail.replace(quotedSpans, '[redacted]').replace(/[\r\n\t]/g, ' ').slice(0, 300);
};

const proposedScalars = (raw: unknown): Record<string, string | number | boolean> => {
  const summary: Record<string, string | number | boolean> = {};
  if (typeof raw !== 'string') return summary;
  let args: unknown;
  try { args = JSON.parse(raw); } catch { return summary; }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return summary;
  for (const key of REFUSAL_SCALARS) {
    const value = (args as Record<string, unknown>)[key];
    if (typeof value === 'number' ? !Number.isFinite(value)
      : typeof value === 'string' ? value.length > 80 || credentialLike.test(value)
        || /["“”‘’`\r\n\t]/.test(value) || /(?:^|\s)'|'(?:\s|$)/.test(value)
      : typeof value !== 'boolean') continue;
    const next = { ...summary, [key]: value };
    if (JSON.stringify(next).length <= 600) summary[key] = value as string | number | boolean;
  }
  return summary;
};

const textOf = (items: readonly Record<string, unknown>[]): string => {
  let t = '';
  for (const i of items) {
    if (i.type !== 'message') continue;
    for (const c of (i.content as Record<string, unknown>[] | undefined) ?? []) {
      if (c.type === 'output_text' && typeof c.text === 'string') t += c.text;
    }
  }
  return t;
};

/** The refusal a withheld tool returns. It consumed nothing and moved nothing. */
export const WITHHELD_ON_CHIP_TURN = 'withheld_on_chip_turn';

/** One refused switch-level entry as the model sent it: labels and the level's own scalars, each bounded. */
export interface RejectedLevel {
  readonly option: string;
  readonly factor: string;
  readonly value: unknown;
  readonly unit?: unknown;
  readonly estimate?: unknown;
}

/** A scalar as sent, bounded: numbers, booleans and null kept; a string cut to 40 characters; anything else its type. */
const scalarAsSent = (v: unknown): unknown =>
  typeof v === 'string' ? v.slice(0, 40) : typeof v === 'number' || typeof v === 'boolean' || v === null ? v : typeof v;

/**
 * ⭐ WHAT A REFUSED SWITCH LEVEL WAS, NOT ONLY WHICH FIELD FIRED (DL #72 5862693164). The `switch_level_not_on` loop grew
 * run to run (1 → 2 → 7 → 10 refusals, `conflict_fields: ["unit","estimate"]`) while the served record kept no arguments,
 * so every fix was built on inference. The refused entries — option and factor labels, and the level's value, unit and
 * estimate — are kept: at most 4 entries, labels cut to 80 characters, scalars bounded (`scalarAsSent`). Never the basis
 * or any other text the model wrote.
 */
const rejectedLevelsOf = (result: ToolResult): { rejected_levels?: readonly RejectedLevel[] } => {
  const conflicts = (result as { switch_level_conflicts?: unknown }).switch_level_conflicts;
  if (result.ok !== false || result.refusal !== 'switch_level_not_on' || !Array.isArray(conflicts)) return {};
  const levels = conflicts
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && !Array.isArray(c))
    .slice(0, 4)
    .map((c) => ({
      option: String(c.option ?? '').slice(0, 80),
      factor: String(c.factor ?? '').slice(0, 80),
      value: scalarAsSent(c.value),
      ...('unit' in c ? { unit: scalarAsSent(c.unit) } : {}),
      ...('estimate' in c ? { estimate: scalarAsSent(c.estimate) } : {}),
    }));
  return levels.length > 0 ? { rejected_levels: levels } : {};
};

/** A refused result's `conflict_fields` (short field names), or nothing: never the tool's payload. */
const conflictFieldsOf = (result: ToolResult): { conflict_fields?: readonly string[] } => {
  const f = (result as { conflict_fields?: unknown }).conflict_fields;
  if (result.ok !== false || !Array.isArray(f)) return {};
  const names = f.filter((x): x is string => typeof x === 'string' && /^[a-z_]{1,32}$/.test(x)).slice(0, 8);
  return names.length > 0 ? { conflict_fields: names } : {};
};

/**
 * Opens the state item a fresh packet puts into a turn's input (and marks it, so history never keeps one).
 *
 * \u26d4 IT IS THE MODEL AS THE TURN BEGAN, NOT AS IT STANDS AFTER THIS TURN'S TOOLS (C1 follow-up, CEE #2112 review,
 * 27 Sep). The item stays in the input for EVERY hop \u2014 moving or dropping it mid-turn would change the request prefix
 * and defeat prompt caching \u2014 while `get_canonical_state` stays withheld. It used to end "Describe the model from it",
 * so on a first brief (#2112 gives the EMPTY model, `{empty:true, entities:[]}`) hop 2 read that instruction above an
 * empty model straight after `build_model_from_brief` had returned the new entities and graph_revision: the Agent
 * could say "the model is empty" about the model it had just built. The wording now says a later result supersedes
 * it. Pinned: `turn-state-given-not-fetched.test.ts` (C1 follow-up row). Keep `CURRENT MODEL STATE` first (tests and
 * the route prompt match the leading words) and keep `{` out of it (a test parses the state from the first `{`).
 */
export const CURRENT_MODEL_STATE_PREFIX = 'CURRENT MODEL STATE \u2014 exactly what get_canonical_state returns, read by Olumi at the START of this turn. '
  + 'If a tool result later in this turn APPLIED a change (mutated: true, the new entities, a new graph_revision, readiness_after), that result is '
  + 'newer and supersedes this for what it covers: describe the model from the latest applied result. A proposal\u2019s '
  + 'readiness_if_approved describes the model only IF the user approves, and never supersedes this. As the turn began: ';

export async function runAgentTurn(
  input: AgentTurnInput,
  caps: AgentCapabilities,
  callModel: CallModel,
): Promise<AgentTurnResult> {
  const mode: AgentLaneMode = input.mode ?? 'full';
  const maxHops = input.maxHops ?? DEFAULT_MAX_HOPS;
  const withheld = new Set(input.withheldTools ?? []);
  /**
   * ⭐ THE STATE THE SERVER ALREADY HOLDS IS GIVEN, NOT FETCHED (slice C1; P3A replay of Paul's transcript, 27 Sep).
   * Every ordinary turn spent a whole model call (~3 s) asking for `get_canonical_state`, and every answer then sat
   * in the history for 24 turns: 7.4k input tokens at turn 0, 62.7k by turn 19. When the packet is fresh and
   * addressable, `eligibleTools` withholds that tool; the SAME state goes in as this turn's input instead. The two
   * move together — the model has the state and no tool, or the tool and no state — and the item is never handed
   * on into the history: the next turn gets its own, fresh.
   */
  const eligibility = input.canonicalContext === undefined ? undefined : eligibleTools({
    mode,
    context: input.canonicalContext.packet,
    expectation: input.canonicalContext.expectation,
  });
  const stateItem = eligibility !== undefined && input.canonicalContext?.packet != null
    && eligibility.omitted.some((o) => o.name === 'get_canonical_state')
    ? { role: 'developer', content: [{ type: 'input_text', text: `${CURRENT_MODEL_STATE_PREFIX}${JSON.stringify(input.canonicalContext.packet.state)}` }] }
    : undefined;
  const selectionItem = input.selectionNote !== undefined && input.selectionNote !== ''
    ? { role: 'developer', content: [{ type: 'input_text', text: input.selectionNote }] }
    : undefined;
  const items: unknown[] = [
    ...input.history,
    ...(stateItem !== undefined ? [stateItem] : []),
    ...(selectionItem !== undefined ? [selectionItem] : []),
    { role: 'user', content: [{ type: 'input_text', text: input.message }] },
  ];
  /** What this turn hands on as history: everything but the state and the selection it was given. */
  const handedOn = (): unknown[] => (stateItem === undefined && selectionItem === undefined
    ? items : items.filter((i) => i !== stateItem && i !== selectionItem));
  const toolCalls: { name: string; ok: boolean; mutated: boolean; proposal_id?: string; outcome?: string; refusal?: string; conflict_fields?: readonly string[]; rejected_levels?: readonly RejectedLevel[]; incomplete_reason?: string }[] = [];
  const toolResults: ToolResult[] = [];
  let mutated = false;
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  let providerMs = 0;
  let toolMs = 0;
  let toolProviderMs = 0;
  let providerCalls = 0;
  let toolCallCount = 0;
  /**
   * ⛔ A MEASUREMENT NOBODY CAN SEE IS NOT A MEASUREMENT.
   *
   * `TurnTiming` was returned on the result and read by nobody — a repo-wide
   * sweep found 23 `.timing` hits, all of them the estate's pre-existing
   * `timingDebugEnabled` system, and zero reading `result.timing`. Same inert
   * failure as a helper no caller reaches. Contrast control: the sibling
   * `.tool_calls` has 6 non-test readers, so the probe was not blind.
   *
   * The natural consumer is the route, which is inside another lane's lease, so
   * the loop logs it here instead — gated on the estate's OWN timing flags, so
   * it is default-OFF and consistent with every other timing surface
   * (`cee.unified_pipeline.stage_timings`, `v5.run_analysis.timings`).
   *
   * `log.info` rather than `emit()` deliberately: `emit()` literals are frozen
   * against the `TelemetryEvents` enum by the telemetry-validation workflow and
   * this needs no new enum member. The estate already logs
   * `agent_lane.route_mounted` exactly this way.
   */
  const emitTiming = (t: TurnTiming): void => {
    if (!config.cee.timingDebugEnabled && !config.features.diagnosticTraceEnabled) return;
    log.info(
      {
        event: 'agent_lane.turn_timings',
        scenario_id: input.ctx.scenario_id,
        request_id: input.ctx.request_id,
        ...t,
      },
      'Agent lane — where this turn spent its wall time',
    );
  };

  const timingAt = (hopsTaken: number): TurnTiming => {
    const total = Math.max(0, now() - startedAt);
    return {
      total_ms: total,
      provider_ms: providerMs,
      tool_ms: toolMs,
      tool_provider_ms: toolProviderMs,
      overhead_ms: Math.max(0, total - providerMs - toolMs),
      provider_calls: providerCalls,
      tool_calls: toolCallCount,
      hops: hopsTaken,
    };
  };

  let narrateNext = false;
  let lastHeldCall: { name: string; args: unknown; result: ToolResult } | undefined;
  /**
   * ⛔ A NARRATION FAILURE NEVER LOSES A HELD CHANGE (Codex #2781 r3 / DL 6049608420, P1).
   * The previous hop already prepared it: recover from its LAST held call and exact result, never from partial
   * provider output. Keep the tool record intact so the normal reply still offers that proposal's approve card.
   */
  const recoverNarration = (err: unknown, hopsTaken: number): AgentTurnResult => {
    const held = lastHeldCall!; // `narrateNext` is true only after a hop whose every call held a proposal.
    const composed = input.composeReply?.(held.name, held.args, held.result);
    // ⛔ P44 (a) / Codex #2781 r5: failed conversational gates must not hide the held result's disclosures.
    const recoveredReply = typeof composed === 'string' && composed.trim() !== '' ? composed
      : composeHeldResultReply(held.name, held.result);
    const label = held.result.public_label;
    const text = typeof recoveredReply === 'string' && recoveredReply.trim() !== '' ? recoveredReply
      : typeof label === 'string' && label.trim() !== ''
        ? `I have prepared this change: ${label}. Nothing is changed until you approve it.`
        : 'I have prepared a change for you to review. Nothing is changed until you approve it.';
    items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
    log.warn({ hop: hopsTaken, err: String(err) }, 'agent-lane: narration failed — answering from the held proposal');
    return {
      assistant_text: text,
      items: handedOn(),
      tool_calls: toolCalls,
      tool_results: toolResults,
      mutated,
      hops: hopsTaken,
      stopped_reason: 'answered',
      timing: ((t) => { emitTiming(t); return t; })(timingAt(hopsTaken)),
    };
  };
  for (let hop = 0; hop < maxHops; hop++) {
    const providerStartedAt = now();
    // Eligibility, not the raw catalogue. `eligibleTools` starts from
    // `toolsFor(mode)` and can only REMOVE, so the mode remains the authority
    // and a context packet can never widen the surface.
    const narrateHop = narrateNext;
    const offered = (eligibility === undefined ? toolsFor(input.mode ?? 'full') : eligibility.tools)
      .filter((t) => !withheld.has(t.name));
    const hostCall = hop === 0 && input.hostFirstCall !== undefined && offered.some((t) => t.name === input.hostFirstCall!.name)
      ? input.hostFirstCall : undefined;
    const forced = hop === 0 && hostCall === undefined && input.firstCallTool !== undefined && offered.some((t) => t.name === input.firstCallTool)
      ? input.firstCallTool : undefined;
    const request: ModelCallRequest = {
      instructions: input.instructions,
      input: narrateNext ? [...items, NARRATE_ITEM] : items,
      tools: offered as readonly unknown[],
      max_output_tokens: input.maxOutputTokens,
      ...(forced !== undefined ? { tool_choice: { type: 'function' as const, name: forced } } : {}),
      ...(narrateNext ? { reasoning_role: 'narrate' as const } : {}),
    };
    if (hostCall !== undefined) {
      void callModel({ ...request, input: [...items], max_output_tokens: PREWARM_OUTPUT_TOKENS, deadline_ms: PREWARM_DEADLINE_MS, purpose: 'prewarm' })
        .catch((err: unknown) => { log.debug({ err: String(err) }, 'agent-lane: cache prewarm failed (nothing reads it)'); });
    } else {
      providerCalls += 1;
    }
    let resp: ModelCallResponse;
    try {
      resp = hostCall !== undefined
        ? { output: [{ type: 'function_call', call_id: `${HOST_FIRST_CALL_ID}_${randomUUID()}`, name: hostCall.name, arguments: JSON.stringify(hostCall.args) }] }
        : await callModel(request);
    } catch (err: unknown) {
      if (!narrateHop) throw err;
      providerMs += Math.max(0, now() - providerStartedAt);
      return recoverNarration(err, hop);
    }
    if (hostCall === undefined) providerMs += Math.max(0, now() - providerStartedAt);
    if (narrateHop && answerIsIncomplete(resp)) {
      return recoverNarration(new Error(`narration incomplete: ${resp.incomplete_reason ?? 'unknown'}`), hop);
    }
    const out = resp.output ?? [];
    /**
     * ⛔ EVERY CALL IN THE OUTPUT, NOT THE FIRST ONE.
     *
     * This was `out.find(...)` while the line below pushed the WHOLE output
     * array into the conversation. When the model emitted two calls in one
     * turn — which it does, unprompted — the second entered history with no
     * `function_call_output` beside it, and the Responses API refused the NEXT
     * request outright:
     *
     *   Error: openai_400: "No tool output found for function call call_NFIf…"
     *   POST /agent/v1/turn status=502 duration_ms=27505
     *
     * So the session was poisoned PERMANENTLY: turn 1 answered, every turn
     * after it 502'd. Read from the deployed service's own logs, and it is
     * exactly what the estate's live-journey gate had been measuring — turn 1
     * HTTP 200 in 92.7 s, turn 2 HTTP 502 in 27.7 s, on 4 of 5 samples.
     *
     * The invariant this now keeps is the API's, not the bug's: the items this
     * turn hands on must be valid INPUT for the next request, which means one
     * output per call, always — including at the hop limit.
     */
    const calls = out.filter((i) => i.type === 'function_call');

    if (calls.length === 0) {
      // ⛔ An unfinished final answer is never returned as the answer, and never enters the history as one: the
      // route answers from the turn's own outcome instead (a run's result, or "ask me again").
      if (answerIsIncomplete(resp)) {
        log.warn({ hop, incomplete_reason: resp.incomplete_reason ?? null }, 'agent-lane: final answer incomplete — not returned as an answer');
        return {
          assistant_text: '',
          items: handedOn(),
          tool_calls: toolCalls,
          tool_results: toolResults,
          mutated,
          hops: hop,
          stopped_reason: 'incomplete',
          timing: ((t) => { emitTiming(t); return t; })(timingAt(hop)),
        };
      }
      items.push(...out);
      return {
        assistant_text: textOf(out),
        items: handedOn(),
        tool_calls: toolCalls,
        tool_results: toolResults,
        mutated,
        hops: hop,
        stopped_reason: 'answered',
        timing: ((t) => { emitTiming(t); return t; })(timingAt(hop)),
      };
    }

    // The whole output array first — the reasoning item must accompany the
    // calls — then one output per call, in the order they were made.
    items.push(...out);
    const hopResultsFrom = toolResults.length;
    for (const call of calls) {
      const toolStartedAt = now();
      toolCallCount += 1;
      // Second layer for a withheld tool: a model can name a tool it was not offered.
      const result: ToolResult = withheld.has(String(call.name))
        ? {
            ok: false, mutated: false, refusal: WITHHELD_ON_CHIP_TURN,
            detail: 'Not from a suggestion button: approving a change and running the analysis each have their own control. Nothing was changed.',
          }
        // ⛔ The narrating call may not approve the change THIS turn just held for the user's yes (Codex #2781 r1 P1; DL
        // ruling B). One an earlier turn showed and the user approved stays approvable on any hop.
        : narrateHop && String(call.name) === AUTHORISE_TOOL
          && proposalsAwaitingApproval(toolCalls).has(proposalIdArg(call.arguments) ?? '')
        ? {
            ok: false, mutated: false, refusal: NOT_ON_NARRATION,
            detail: 'The change you just prepared is waiting for the user’s yes. Show it and ask; nothing was approved or changed.',
          }
        // ⛔ One approval carries one change: a second proposal while this turn's first awaits the user's yes is
        // refused before it is stored, so the turn always ends with its one control (`ONE_CHANGE_PER_APPROVAL`).
        : isProposingTool(String(call.name)) && proposalsAwaitingApproval(toolCalls).size > 0
          ? { ok: false, mutated: false, refusal: ONE_CHANGE_PER_APPROVAL, detail: ONE_CHANGE_PER_APPROVAL_DETAIL }
          // ⛔ Only a change THIS turn proposed and still offers can be withdrawn: one an earlier turn showed the user
          // stays theirs to approve or decline (`WITHDRAW_PROPOSAL`).
          : String(call.name) === WITHDRAW_PROPOSAL && !(proposalIdArg(call.arguments) ?? '').startsWith('goal-scope:')
            && !proposalsAwaitingApproval(toolCalls).has(proposalIdArg(call.arguments) ?? '')
            ? {
                ok: false, mutated: false, refusal: NOT_PROPOSED_THIS_TURN,
                detail: 'Only a change you proposed in this turn, and have not had approved, can be withdrawn. Nothing was withdrawn: '
                  + 'a change the user has already seen stays theirs to approve or decline.',
              }
            : await dispatchTool(String(call.name), String(call.arguments ?? '{}'), input.ctx, caps, mode);
      // ⛔ A TOOL'S OWN PROVIDER CALL IS NOT OVERHEAD.
      //
      // `build_model_from_brief` is dispatched as a tool and makes its own
      // `callStructured` call inside — the most expensive call in the product
      // (banked evidence: "in 838 / out 3404 incl. 2070 reasoning, 54.4 s").
      // Counted naively, that ~54s landed in `tool_ms` and was reported as
      // in-process overhead, which is exactly the misattribution this split
      // exists to prevent: it would send a reader after our own code when the
      // time is the model's.
      //
      // A tool may report `provider_ms` (and optionally `provider_calls`) on
      // its result. Absent the field nothing changes, so no other lane has to
      // move for this to become correct once they opt in.
      const toolWallMs = Math.max(0, now() - toolStartedAt);
      const claimed = (result as { provider_ms?: unknown }).provider_ms;
      // ⚠ CLAMPED TO THE TOOL'S ACTUAL WALL TIME. A buggy or hostile tool
      // reporting more than it took must not drive `tool_ms` negative nor
      // inflate `provider_ms` past the clock. Non-numeric is ignored, never
      // coerced — a string would otherwise become NaN and poison every figure.
      const attributed =
        typeof claimed === 'number' && Number.isFinite(claimed) && claimed > 0
          ? Math.min(claimed, toolWallMs)
          : 0;
      toolProviderMs += attributed;
      providerMs += attributed;
      toolMs += toolWallMs - attributed;
      const claimedCalls = (result as { provider_calls?: unknown }).provider_calls;
      if (typeof claimedCalls === 'number' && Number.isFinite(claimedCalls) && claimedCalls > 0) {
        providerCalls += Math.floor(claimedCalls);
      }
      if (result.mutated) mutated = true;
      if (result.ok === false && MUTATION_TOOLS.includes(String(call.name))) {
        log.info({
          event: 'v5.agent.tool_refused',
          request_id: input.ctx.request_id,
          tool: String(call.name),
          refusal: result.refusal,
          detail: refusalDetail(result.detail),
          proposed: proposedScalars(call.arguments),
        }, 'Agent mutation tool refused');
      }
      toolCalls.push({
        name: String(call.name),
        ok: result.ok,
        mutated: result.mutated,
        // Identity only — never the tool's payload.
        ...(typeof result.proposal_id === 'string' ? { proposal_id: result.proposal_id } : {}),
        ...(typeof result.outcome === 'string' ? { outcome: result.outcome } : {}),
        ...(typeof result.refusal === 'string' ? { refusal: result.refusal } : {}),
        // ⭐ What a REFUSED call sent, by field name (OpenAI Runtime #70 5859406197 item 3: the served artefacts keep no
        // tool arguments, so which part of a refused level fired could not be told). Names only, bounded.
        ...conflictFieldsOf(result),
        ...rejectedLevelsOf(result),
        ...(typeof result.incomplete_reason === 'string' ? { incomplete_reason: result.incomplete_reason } : {}),
      });
      toolResults.push(result);
      items.push({
        type: 'function_call_output',
        call_id: call.call_id,
        // ⭐ The model reads the LICENSED run (`licensed-run-view.ts`): on a turn it may not name a leader, no leader
        // identity and no producer prose reach it. The route keeps the raw result in `toolResults`.
        output: JSON.stringify(modelFacingToolResult(String(call.name), result)),
      });
    }
    narrateNext = hopOnlyHeldProposals(calls.map((c) => ({ name: String(c.name) })), toolResults.slice(hopResultsFrom));
    lastHeldCall = undefined;
    if (narrateNext) {
      const call = calls.at(-1)!;
      let args: unknown;
      try { args = JSON.parse(String(call.arguments ?? '{}')); } catch { args = undefined; }
      lastHeldCall = { name: String(call.name), args, result: toolResults.at(-1)! };
    }
    // ⭐ ONE CALL, NOT TWO: the turn's only call, answered from its own result (`composeReply`) — no narrating call.
    if (input.composeReply !== undefined && calls.length === 1 && toolCalls.length === 1) {
      let args: unknown;
      try { args = JSON.parse(String(calls[0]!.arguments ?? '{}')); } catch { args = undefined; }
      const text = input.composeReply(String(calls[0]!.name), args, toolResults[0]!);
      if (text !== null && text.trim() !== '') {
        items.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
        return {
          assistant_text: text,
          items: handedOn(),
          tool_calls: toolCalls,
          tool_results: toolResults,
          mutated,
          hops: hop + 1,
          stopped_reason: 'answered',
          timing: ((t) => { emitTiming(t); return t; })(timingAt(hop + 1)),
        };
      }
    }
  }

  // ⛔ A hop limit is reported, never disguised as an answer. Silently returning
  // empty text here would read to the user as the Agent having nothing to say.
  return {
    assistant_text: '',
    items: handedOn(),
    tool_calls: toolCalls,
    tool_results: toolResults,
    mutated,
    hops: maxHops,
    stopped_reason: 'hop_limit',
    timing: ((t) => { emitTiming(t); return t; })(timingAt(maxHops)),
  };
}
