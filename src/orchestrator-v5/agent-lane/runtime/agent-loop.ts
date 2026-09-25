/**
 * Agent lane — the server-side Managed Agent loop.
 *
 * The Agent owns conversation, reasoning, context and tool choice. This module
 * owns none of those: it carries messages, executes the tools the Agent chooses
 * inside the request's authenticated context, and returns the text the Agent
 * produced. It never composes an answer of its own.
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

import { toolsFor, dispatchTool, type AgentCapabilities, type AgentToolContext, type AgentLaneMode, type ToolResult } from './agent-tools.js';
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
}

export interface ModelCallResponse {
  readonly output: readonly Record<string, unknown>[];
  readonly usage?: Record<string, unknown>;
}

export type CallModel = (req: ModelCallRequest) => Promise<ModelCallResponse>;

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
  /** Injected for deterministic tests; defaults to the wall clock. */
  readonly now?: () => number;
}

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
  }[];
  /** Full results, so Olumi can decide what it owes the user this turn. */
  readonly tool_results: readonly ToolResult[];
  /** True when any tool actually changed the model. */
  readonly mutated: boolean;
  readonly hops: number;
  readonly stopped_reason: 'answered' | 'hop_limit';
  /** Where this turn's wall time went. Always present. */
  readonly timing: TurnTiming;
}

const DEFAULT_MAX_HOPS = 6;

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

export async function runAgentTurn(
  input: AgentTurnInput,
  caps: AgentCapabilities,
  callModel: CallModel,
): Promise<AgentTurnResult> {
  const mode: AgentLaneMode = input.mode ?? 'full';
  const maxHops = input.maxHops ?? DEFAULT_MAX_HOPS;
  const withheld = new Set(input.withheldTools ?? []);
  const items: unknown[] = [
    ...input.history,
    { role: 'user', content: [{ type: 'input_text', text: input.message }] },
  ];
  const toolCalls: { name: string; ok: boolean; mutated: boolean; proposal_id?: string; outcome?: string; refusal?: string }[] = [];
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

  for (let hop = 0; hop < maxHops; hop++) {
    const providerStartedAt = now();
    providerCalls += 1;
    const resp = await callModel({
      instructions: input.instructions,
      input: items,
      // Eligibility, not the raw catalogue. `eligibleTools` starts from
      // `toolsFor(mode)` and can only REMOVE, so the mode remains the authority
      // and a context packet can never widen the surface.
      tools: (input.canonicalContext === undefined
        ? toolsFor(input.mode ?? 'full')
        : eligibleTools({
            mode: input.mode ?? 'full',
            context: input.canonicalContext.packet,
            expectation: input.canonicalContext.expectation,
          }).tools).filter((t) => !withheld.has(t.name)) as readonly unknown[],
      max_output_tokens: input.maxOutputTokens,
    });
    providerMs += Math.max(0, now() - providerStartedAt);
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
      items.push(...out);
      return {
        assistant_text: textOf(out),
        items,
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
    for (const call of calls) {
      const toolStartedAt = now();
      toolCallCount += 1;
      // Second layer for a withheld tool: a model can name a tool it was not offered.
      const result: ToolResult = withheld.has(String(call.name))
        ? {
            ok: false, mutated: false, refusal: WITHHELD_ON_CHIP_TURN,
            detail: 'Not from a suggestion button: approving a change and running the analysis each have their own control. Nothing was changed.',
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
      toolCalls.push({
        name: String(call.name),
        ok: result.ok,
        mutated: result.mutated,
        // Identity only — never the tool's payload.
        ...(typeof result.proposal_id === 'string' ? { proposal_id: result.proposal_id } : {}),
        ...(typeof result.outcome === 'string' ? { outcome: result.outcome } : {}),
        ...(typeof result.refusal === 'string' ? { refusal: result.refusal } : {}),
      });
      toolResults.push(result);
      items.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }
  }

  // ⛔ A hop limit is reported, never disguised as an answer. Silently returning
  // empty text here would read to the user as the Agent having nothing to say.
  return {
    assistant_text: '',
    items,
    tool_calls: toolCalls,
    tool_results: toolResults,
    mutated,
    hops: maxHops,
    stopped_reason: 'hop_limit',
    timing: ((t) => { emitTiming(t); return t; })(timingAt(maxHops)),
  };
}
