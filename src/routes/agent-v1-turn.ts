/**
 * POST /agent/v1/turn — the OpenAI Agent mounted in the real PoC.
 *
 * The Agent owns conversation, reasoning, context and tool choice. Olumi keeps
 * canonical truth, admissibility, authorisation, CAS, idempotency, persistence
 * and analysis: every tool this route exposes delegates to an existing Olumi
 * path, and writes and analysis go through the SAME `/orchestrate/v2/turn` the
 * product uses, dispatched internally. The Agent therefore cannot reach a
 * shortcut the UI does not have.
 *
 * ⭐ IDENTITY IS BOUND FROM THE REQUEST, NEVER FROM MODEL OUTPUT. The scenario
 * comes from the body and the subject from the request's own auth context;
 * neither is ever taken from what the Agent says. `agent_session_id` is a
 * correlation token only, verified on every call against that same subject and
 * scenario — knowing someone else's session id must not expose their model.
 *
 * ⚠ Gated by `AGENT_LANE_ENABLED`. The route 404s when unset, so deploying it
 * changes nothing until it is switched on, and switching it off is the rollback.
 *
 * ⚠ Transport is `/v1/responses`, not Agents sessions: every Agents session
 * created on 22 Sep stalled at `in_progress` with zero turns. The tools and the
 * in-context execution are unchanged if sessions recover — the transport is a
 * seam, deliberately.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/index.js';
import { log } from '../utils/telemetry.js';
import { composeDirectAnswerResponse } from '../orchestrator-v5/compose.js';
import { finaliseV5Response } from '../orchestrator-v5/response-finaliser.js';
import { runAgentTurn, type CallModel } from '../orchestrator-v5/agent-lane/runtime/agent-loop.js';
import { createAgentCapabilities, type InternalDispatch } from '../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../orchestrator-v5/agent-lane/proposal.js';
import { SessionBindingRegistry } from '../orchestrator-v5/agent-lane/session-binding.js';
import { budgetFor } from '../orchestrator-v5/agent-lane/model-budgets.js';
import { disclosuresFor, withDisclosures } from '../orchestrator-v5/agent-lane/disclosure.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/** The conversation of record stays Olumi's; this is a per-process cache. */
const histories = new Map<string, unknown[]>();
const proposals = new ProposalStore();
const sessions = new SessionBindingRegistry();

const AGENT_INSTRUCTIONS = [
  'You are Olumi, a strategic reasoning layer. Improve human strategic judgement rather than deciding for the user.',
  'Answer the user’s actual question directly and naturally.',
  'Never invent canonical facts. Before describing what the model contains, call get_canonical_state.',
  'Distinguish user facts and evidence from machine-authored estimates and from unknowns. An absent value is unknown, never zero.',
  'To change the model you must call propose_model_change, show the user exactly what you propose, and call authorise_change ONLY after they have explicitly approved it.',
  'Never claim a change happened unless the tool result says it was applied. If a tool reports a refusal, tell the user what it said.',
  'Discussion, ideation and research are not mutation requests.',
  'When a tool tells you something was not represented, say so.',
  'British English. Concise but substantive.',
].join(' ');

export async function agentV1TurnRoute(app: FastifyInstance): Promise<void> {
  if (config.features?.agentLaneEnabled !== true) return;

  const dispatch: InternalDispatch = async (path, body) => {
    const res = await app.inject({
      method: 'POST',
      url: path,
      headers: {
        'content-type': 'application/json',
        'x-olumi-assist-key': config.auth.assistApiKey ?? config.auth.assistApiKeys?.[0] ?? '',
      },
      payload: body as Record<string, unknown>,
    });
    let json: Record<string, unknown> = {};
    try { json = res.json() as Record<string, unknown>; } catch { json = {}; }
    return { status: res.statusCode, json };
  };

  const callModel: CallModel = async (req) => {
    const budget = budgetFor('gpt-5.6-terra', 'conversation');
    const r = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.llm.openaiApiKey ?? ''}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: budget.model,
        instructions: req.instructions,
        input: req.input,
        tools: req.tools,
        max_output_tokens: req.max_output_tokens,
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`openai_${r.status}: ${text.slice(0, 300)}`);
    }
    return (await r.json()) as { output: Record<string, unknown>[] };
  };

  app.post('/agent/v1/turn', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scenarioId = typeof body.scenario_id === 'string' ? body.scenario_id : '';
    const message = typeof body.message === 'string' ? body.message : '';
    const sessionId = typeof body.agent_session_id === 'string' && body.agent_session_id.length > 0
      ? body.agent_session_id
      : `sess_${scenarioId}`;
    if (scenarioId.length === 0 || message.length === 0) {
      return reply.code(422).send({ error: 'BAD_INPUT', detail: 'scenario_id and message are required' });
    }

    // Bound from the request, never from the Agent.
    const userId = typeof (req as { effectiveUserId?: string }).effectiveUserId === 'string'
      ? (req as { effectiveUserId?: string }).effectiveUserId ?? null
      : null;

    // A session is a correlation token: bound once, verified every time.
    const refusal = sessions.check(sessionId, userId, scenarioId);
    if (refusal === 'unknown_session') sessions.bind(sessionId, userId, scenarioId);
    else if (refusal !== null) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: 'No readable conversation for that scenario.' });
    }

    const capabilities = createAgentCapabilities(dispatch, proposals);
    const history = histories.get(sessionId) ?? [];
    const budget = budgetFor('gpt-5.6-terra', 'conversation');

    let result;
    try {
      result = await runAgentTurn(
        {
          ctx: { scenario_id: scenarioId, authenticated_user_id: userId, request_id: req.id },
          history,
          message,
          instructions: AGENT_INSTRUCTIONS,
          maxOutputTokens: budget.max_output_tokens,
        },
        capabilities,
        callModel,
      );
    } catch (err) {
      log.error({ err: String(err), scenario_id: scenarioId }, 'agent-lane turn failed');
      return reply.code(502).send({ error: 'UPSTREAM_ERROR', detail: String(err).slice(0, 300) });
    }

    histories.set(sessionId, [...result.items]);

    // A hop limit is never returned as an empty answer.
    const text = result.stopped_reason === 'hop_limit' && result.assistant_text.length === 0
      ? 'I was not able to finish that within this turn. Ask me again and I will continue.'
      : result.assistant_text;

    // ⭐ `answerKind` is REQUIRED and load-bearing: route egress synthesises
    // `_answer_shape` only for 'substantive'. An Agent's conversational reply
    // is substantive by construction — it is the answer, not a confirmation of
    // a mechanical action.
    // ⭐ OLUMI OWES THE DISCLOSURE, NOT THE AGENT. When a write had to carry a
    // placeholder strength the user never gave, the user is told — whether or
    // not the model chose to mention it.
    const owed = disclosuresFor(result.tool_results);
    const composed = composeDirectAnswerResponse({
      assistant_text: withDisclosures(text, owed),
      stage: 'frame',
      answerKind: 'substantive',
    });
    const finalised = finaliseV5Response(composed, { scenarioId });
    return reply.code(200).send({
      ...finalised,
      _agent: {
        session_id: sessionId,
        tool_calls: result.tool_calls,
        mutated: result.mutated,
        hops: result.hops,
        stopped_reason: result.stopped_reason,
      },
    });
  });

  log.info({ event: 'agent_lane.route_mounted' }, 'POST /agent/v1/turn mounted');
}
