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
import { getSessionStore } from '../orchestrator-v5/session/index.js';
import { scenarioAccessDecision } from '../orchestrator-v5/agent-lane/scenario-access.js';
import { HistoryStore } from '../orchestrator-v5/agent-lane/history-store.js';
import { internalHeaders } from '../orchestrator-v5/agent-lane/internal-headers.js';
import { resolveUserIdentity } from '../orchestrator/user-identity.js';
import { log } from '../utils/telemetry.js';
import { composeDirectAnswerResponse } from '../orchestrator-v5/compose.js';
import { finaliseV5Response } from '../orchestrator-v5/response-finaliser.js';
import { runAgentTurn, type CallModel } from '../orchestrator-v5/agent-lane/runtime/agent-loop.js';
import type { AgentLaneMode } from '../orchestrator-v5/agent-lane/runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import type { CallStructuredModel } from '../orchestrator-v5/agent-lane/runtime/build-model.js';
import { onceMoreOnTransportFailure } from '../orchestrator-v5/agent-lane/runtime/transport-retry.js';
import { ProposalStore } from '../orchestrator-v5/agent-lane/proposal.js';
import { SessionBindingRegistry } from '../orchestrator-v5/agent-lane/session-binding.js';
import { budgetFor } from '../orchestrator-v5/agent-lane/model-budgets.js';
import { disclosuresFor, withDisclosures } from '../orchestrator-v5/agent-lane/disclosure.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/** The conversation of record stays Olumi's; this is a per-process cache. */
const histories = new HistoryStore();
const proposals = new ProposalStore();
const sessions = new SessionBindingRegistry();

/**
 * The one instruction that differs by mode.
 *
 * ⚠ This is HONESTY, not the boundary. The boundary is that the tools are not
 * declared, dispatch refuses the names, and the capabilities refuse. This line
 * only stops the preview offering to do something it cannot do.
 */
const MUTATION_INSTRUCTION =
  config.proxy.agentLanePreview === true
    ? 'This is a read-only preview: you CANNOT change the model, and there is no tool that would let you. If the user asks for a change, say plainly that this preview cannot make it and describe what you would propose instead.'
    : 'To change the model you must first call a proposing tool \u2014 propose_model_change for a link, propose_assumptions to give value-less factors a starting number \u2014 show the user exactly what it returned, and call authorise_change with that proposal_id ONLY after they have explicitly approved it.';

const AGENT_INSTRUCTIONS = [
  'You are Olumi, a strategic reasoning layer. Improve human strategic judgement rather than deciding for the user.',
  'Answer the user’s actual question directly and naturally.',
  'Never invent canonical facts. Before describing what the model contains, call get_canonical_state.',
  'Distinguish user facts and evidence from machine-authored estimates and from unknowns. An absent value is unknown, never zero.',
  MUTATION_INSTRUCTION,
  'Never claim a change happened unless the tool result says it was applied. If a tool reports a refusal, tell the user what it said.',
  'If get_canonical_state reports the model is empty, call build_model_from_brief with the user\u2019s own words before answering about the model.',
  'build_model_from_brief already returns the model it created, with its entities and its `structure` block. Do NOT call get_canonical_state again afterwards \u2014 answer from what it returned.',
  /*
   * ⛔ DO NOT RUN THE ANALYSIS ON THE TURN THAT BUILDS THE MODEL. Measured on
   * a real session: 99.9 s for a first turn that built AND analysed, against a
   * construction cost of 38-110 s on its own. The analysis on a just-built
   * model is ALWAYS blocked — nothing has values yet — so the user waits
   * ~20 extra seconds to be told what the build already knows. Report the gaps
   * from the build's own `structure` block and let them ask.
   */
  'After build_model_from_brief, do NOT call run_analysis on the same turn. A newly built model has no values yet, so the analysis can only report what the build already told you \u2014 and it costs the user another twenty seconds. Describe the model and what it still needs, then stop.',
  'Discussion, ideation and research are not mutation requests.',
  'get_canonical_state returns a `structure` block computed from the persisted model: which options reach the goal, which cannot, what is unconnected, and how many FACTORS have no value (only factors can hold one). These are facts, not estimates \u2014 use them, and say them plainly when they explain why an analysis cannot run.',
  'When a tool tells you something was not represented, say so.',
  /*
   * ⭐ COACHING, AND THE ONE PLACE RIGOUR WAS WORKING AGAINST THE PRODUCT.
   * Measured head-to-head against current CEE on the same model. Asked "I
   * honestly don't know any of those numbers, what should I do next?", CEE
   * said "you don't need to know all twelve — most are things you can
   * ESTIMATE, not facts you must already know" and the user could carry on.
   * This Agent said "Don't guess them" and prescribed a three-step evidence
   * sprint. CEE gave the better answer.
   *
   * ⛔ This does NOT relax the honesty contract, and the distinction is the
   * whole point: a figure the USER chooses is their assumption, to be labelled
   * and tested. A figure the MODEL supplies unasked is a fabricated user fact,
   * which is the defect this lane exists to prevent. Offer, never enter.
   */
  'When the model lacks values, do not send the user away to collect data before they can proceed. Offer a reasoned starting estimate they could adopt, say what it is based on, and invite them to correct it \u2014 a decision model tests assumptions, it does not require certainty up front.',
  'Say plainly that any such figure is an assumption to test, never a measurement. NEVER record one yourself: the user chooses it, or it does not enter the model.',
  /*
   * ⭐ THE OFFER HAS TO BE ACTIONABLE, OR IT IS THE SAME DEAD END.
   * Measured 22 Sep: the Agent offered good starting assumptions in prose, the
   * user said "these look like a good set of assumptions, can you update the
   * model with them?", and the turn ended `mutated: false` having called only
   * get_canonical_state. The offer was honest and the model stayed empty.
   */
  'When you offer starting estimates, offer them THROUGH propose_assumptions so the user can adopt the exact set you showed them in one step. If the user asks you to put your suggested assumptions into the model, that is a request to propose them \u2014 call propose_assumptions with the figures you just gave, then authorise_change once they confirm.',
  'propose_assumptions changes nothing on its own and leaves any factor that already holds a value alone. After authorise_change, report every value the model stored differently from the one approved.',
  'British English. Concise but substantive.',
].join(' ');

export async function agentV1TurnRoute(app: FastifyInstance): Promise<void> {
  if (config.proxy.agentLaneEnabled !== true) return;

  /**
   * READ-ONLY preview. Resolved ONCE at registration, not per request, so no
   * request header or body can select the writable surface.
   */
  const mode: AgentLaneMode = config.proxy.agentLanePreview === true ? 'preview' : 'full';

  /**
   * The internal dispatch, built PER REQUEST so it carries the caller's own
   * identity.
   *
   * ⛔ THE ASSIST KEY ALONE CANNOT READ A SIGNED-IN USER'S SCENARIO, and this
   * is not a theory — measured against deployed staging with a contrast control
   * in the same run:
   *
   *     OWNED scenario, assist key only  -> HTTP 404
   *     GUEST scenario, assist key only  -> HTTP 200
   *
   * A caller presenting only the key resolves to `service_legacy`, so
   * `effectiveUserId` is null and every `/assist/v1/scenarios/*` route answers
   * an indistinguishable 404 on an owned scenario. This dispatch was built once
   * at registration with the key and nothing else, so every tool call on a
   * signed-in user's own model would have come back `not_found` — the read, the
   * build, all of it. All my local testing used guest scenarios, which is
   * exactly why it passed.
   *
   * Forwarding the caller's `authorization` means the internal call resolves as
   * the SAME user the outer request authenticated. It cannot widen authority:
   * it is the caller's own token, and the ownership pre-flight above has
   * already refused anyone who is not entitled to this scenario.
   */
  const dispatchFor = (authorization: string | undefined): InternalDispatch =>
    async (path, body) => {
      const res = await app.inject({
        method: 'POST',
        url: path,
        headers: internalHeaders(
          config.auth.assistApiKey ?? config.auth.assistApiKeys?.[0] ?? '',
          authorization,
        ),
        payload: body as Record<string, unknown>,
      });
      let json: Record<string, unknown> = {};
      try { json = res.json() as Record<string, unknown>; } catch { json = {}; }
      return { status: res.statusCode, json };
    };


  const callModel: CallModel = async (req) => onceMoreOnTransportFailure('conversation', async () => {
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
  });

  /**
   * Structured construction call. Separate from `callModel` because it is a
   * different contract: strict `json_schema` output and its own measured budget
   * (see BANKED_BUDGETS role 'whole'), not the conversation budget.
   */
  const callStructured: CallStructuredModel = async (reqBody) => onceMoreOnTransportFailure('construction', async () => {
    const r = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.llm.openaiApiKey ?? ''}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: reqBody.model,
        instructions: reqBody.instructions,
        input: reqBody.input,
        max_output_tokens: reqBody.max_output_tokens,
        ...(reqBody.reasoning_effort !== undefined
          ? { reasoning: { effort: reqBody.reasoning_effort } }
          : {}),
        text: {
          format: {
            type: 'json_schema',
            name: 'whole_candidate',
            strict: true,
            schema: reqBody.schema,
          },
        },
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`openai_${r.status}: ${text.slice(0, 300)}`);
    }
    const j = (await r.json()) as {
      output?: { type?: string; content?: { type?: string; text?: string }[] }[];
      usage?: Record<string, unknown>;
    };
    let text = '';
    for (const item of j.output ?? []) {
      if (item.type !== 'message') continue;
      for (const c of item.content ?? []) if (c.type === 'output_text') text += c.text ?? '';
    }
    return { text, usage: j.usage };
  }, (call, err) => log.warn({ err, call }, 'agent-lane transport failure, retrying once'));

  app.post('/agent/v1/turn', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scenarioId = typeof body.scenario_id === 'string' ? body.scenario_id : '';
    const message = typeof body.message === 'string' ? body.message : '';
    const sessionId = typeof body.agent_session_id === 'string' && body.agent_session_id.length > 0
      ? body.agent_session_id
      : `sess_${scenarioId}`;
    /**
     * The UI posts more than conversational messages to /proxy/v5/turn:
     * `system_event` carries a canvas mutation, `chip_click` a control. Those
     * have no `message`, so without this they fell through to a raw 422
     * BAD_INPUT and the user saw an error with no explanation.
     *
     * In preview they are refused in the product's own voice, on the normal
     * response shape, so the surface stays coherent. In full mode a kind this
     * route does not implement is still refused rather than half-handled —
     * silently dropping a mutation would be worse than saying no.
     */
    const kind = typeof body.kind === 'string' ? body.kind : 'message';
    if (kind !== 'message') {
      const composedRefusal = composeDirectAnswerResponse({
        assistant_text:
          mode === 'preview'
            ? 'This is a read-only preview, so I can\u2019t change the model from the board. Tell me what you want to change and I\u2019ll talk it through.'
            : 'That kind of change does not come through this conversation route. Nothing has been changed.',
        stage: 'frame',
        answerKind: 'substantive',
      });
      return reply.code(200).send({
        ...finaliseV5Response(composedRefusal, { scenarioId }),
        _agent: { session_id: sessionId, mode, tool_calls: [], mutated: false, hops: 0, stopped_reason: 'unsupported_kind' },
      });
    }

    if (scenarioId.length === 0 || message.length === 0) {
      return reply.code(422).send({ error: 'BAD_INPUT', detail: 'scenario_id and message are required' });
    }

    /**
     * Bound from the request, never from the Agent.
     *
     * ⛔ `req.effectiveUserId` DOES NOT EXIST. It is not a Fastify decorator:
     * it is a local computed inside `route-v2-preflight.ts` by calling
     * `resolveUserIdentity`. Reading it off the request always yielded
     * `undefined`, so every caller looked anonymous — and on a signed-in user's
     * OWN scenario the ownership comparison then refused with 404 before a
     * single tool ran. Measured: 404 in 423 ms with no tool calls, WITH a valid
     * bearer token presented.
     *
     * Every local witness used guest scenarios, where anonymous is the right
     * answer, so nothing failed until an owned scenario was tried.
     */
    const identity = await resolveUserIdentity(req, String(req.id));
    if (identity.mode === 'refused') {
      // A presented-but-unusable token is refused, never downgraded to guest:
      // silently treating a signed-in user as anonymous is how someone else's
      // scenario becomes readable.
      return reply.code(401).send({ error: 'SIGN_IN_REQUIRED', detail: identity.reason });
    }
    const userId = identity.mode === 'verified' ? identity.userId : null;

    // A session is a correlation token: bound once, verified every time.
    const refusal = sessions.check(sessionId, userId, scenarioId);
    if (refusal === 'unknown_session') sessions.bind(sessionId, userId, scenarioId);
    else if (refusal !== null) {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: 'No readable conversation for that scenario.' });
    }

    /**
     * Provision the scenario exactly as the product does.
     *
     * ⛔ WITHOUT THIS, PAUL'S FIRST TURN ON A NEW DECISION FAILS. Measured:
     * posting a turn for a scenario id with no row returns `not_found` from the
     * read AND from the build, and the Agent — correctly — reports that it
     * could not initialise a model. The control settles whose gap it is:
     * CEE's own `/orchestrate/v2/turn` given the same unknown id answers 200
     * and CREATES the row (guest, `user_id: null`). So the product
     * auto-provisions and this route did not.
     *
     * `ensureScenarioExists` is the product's own upsert — `INSERT … ON
     * CONFLICT (id) DO NOTHING`, returning the AUTHORITATIVE owner of the
     * stored row. It is NOT a permission grant: the returned owner is compared
     * below, so an existing row belonging to someone else is refused rather
     * than adopted.
     *
     * ⚠ Fails CLOSED, like the product's pre-flight: if the ownership oracle
     * cannot answer, the turn is refused rather than run against an
     * unverifiable scenario.
     */
    try {
      const store = getSessionStore();
      const owner = await store.ensureScenarioExists(scenarioId, userId);
      if (scenarioAccessDecision(owner.user_id, userId) !== 'allow') {
        return reply.code(404).send({ error: 'NOT_FOUND', detail: 'No readable conversation for that scenario.' });
      }
    } catch (err) {
      log.warn({ err: String(err), scenario_id: scenarioId }, 'agent-lane: ownership oracle unavailable — refusing turn');
      return reply.code(409).send({ error: 'SCENARIO_OWNERSHIP_UNVERIFIABLE', detail: 'Could not verify the scenario. Nothing was changed.' });
    }

    const dispatch = dispatchFor(
      typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    );
    const capabilities = createAgentCapabilities(dispatch, proposals, callStructured, mode);
    const history = histories.get(sessionId);
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
          mode,
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

    /**
     * The minimum the canvas needs to notice the model moved.
     *
     * ⛔ WITHOUT `graph_hash` THE CANVAS SILENTLY STOPS UPDATING. Measured:
     * CEE's own conversational turn returns `graph_hash` and `analysis_ready`
     * and this route returned neither, so after the Agent built a 34-node model
     * the UI had nothing telling it the revision had changed. The reply read
     * fine and the board stayed empty — the worst kind of failure, because
     * nothing errors.
     *
     * Read back from the persisted graph, not from what a tool returned: the
     * hash the client caches must be the hash the product would serve it.
     */
    let graphHash: string | undefined;
    let analysisReady: unknown;
    /**
     * ⛔ THE CANVAS RENDERS FROM `draft_graph`, NOT FROM `graph_hash`.
     *
     * Measured from a real session's debug bundle: the Agent built the model
     * (`build_model_from_brief ok=true mutated=true`, `graph_hash`
     * d22f3fb712f84550), the turn returned 200 with 2,313 characters of good
     * prose — and the board stayed EMPTY. `canvas_node_count: 0`,
     * `full_graph` options/factors/edges all 0, and the envelope's own
     * `analysis_state.run_state.cause` was literally `no_graph_this_turn`.
     *
     * I had added `graph_hash` and `analysis_ready` and stopped there, assuming
     * a revision token was enough to make the client refetch. It is not: on a
     * turn that DRAFTS, CEE returns the graph itself, and the UI draws that.
     * A brand-new scenario has nothing hydrated to fall back on, so the user
     * gets a perfect answer about a model they cannot see — the failure mode
     * where nothing errors and everything looks broken.
     */
    let draftGraph: unknown;
    try {
      const after = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph`, {});
      if (after.status === 200) {
        graphHash = typeof after.json.graph_hash === 'string' ? after.json.graph_hash : undefined;
        analysisReady = after.json.analysis_ready;
        // Only when it actually has content: an empty graph must not overwrite
        // whatever the client already has hydrated.
        /**
         * ⛔ `draft_graph` IS NOT THE GRAPH — it is a summary that CARRIES the
         * graph, and `OlumiResponseSchema` requires ALL FOUR of `node_count`,
         * `edge_count`, `nodes`, `edges`. I first sent `{nodes, edges}` alone.
         * The envelope then failed validation, the UI discarded the WHOLE
         * response, and the user was told "the server did not reply in time"
         * after waiting 93 seconds for an answer that had in fact arrived,
         * complete, with HTTP 200. A shape error here does not degrade the
         * turn; it deletes it.
         */
        const g = after.json.graph as { nodes?: unknown[]; edges?: unknown[] } | undefined;
        if (g !== undefined && Array.isArray(g.nodes) && g.nodes.length > 0) {
          const nodes = g.nodes;
          const edges = Array.isArray(g.edges) ? g.edges : [];
          draftGraph = { node_count: nodes.length, edge_count: edges.length, nodes, edges };
        }
      }
    } catch {
      // A readback failure must not lose the user's answer. The turn still
      // returns; the client simply does not learn the new revision this time.
    }

    return reply.code(200).send({
      ...finalised,
      ...(graphHash !== undefined ? { graph_hash: graphHash } : {}),
      ...(analysisReady !== undefined ? { analysis_ready: analysisReady } : {}),
      ...(draftGraph !== undefined ? { draft_graph: draftGraph } : {}),
      _agent: {
        session_id: sessionId,
        mode,
        tool_calls: result.tool_calls,
        mutated: result.mutated,
        hops: result.hops,
        stopped_reason: result.stopped_reason,
      },
    });
  });

  log.info({ event: 'agent_lane.route_mounted' }, 'POST /agent/v1/turn mounted');
}
