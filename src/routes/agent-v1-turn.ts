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

import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/index.js';
import { TURN_RESPONSE_HEADROOM_MS } from '../config/timeouts.js';
import { getSessionStore } from '../orchestrator-v5/session/index.js';
import type { CommittedTurnRecord } from '../orchestrator-v5/session/store.js';
import { appendCheckedGraphWrite } from '../orchestrator-v5/persist-graph-write.js';
import { scenarioAccessDecision } from '../orchestrator-v5/agent-lane/scenario-access.js';
import { collectTurnReceipts } from '../orchestrator-v5/agent-lane/turn-receipts.js';
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
import { assessCanonicalAnalysisReadiness } from '../orchestrator/tools/analysis-ready-helper.js';
import { SessionBindingRegistry } from '../orchestrator-v5/agent-lane/session-binding.js';
import { budgetFor } from '../orchestrator-v5/agent-lane/model-budgets.js';
import { disclosuresFor, withDisclosures } from '../orchestrator-v5/agent-lane/disclosure.js';
import { narrateWriteOutcome, withWriteOutcome } from '../orchestrator-v5/agent-lane/write-outcome.js';
import { withoutProposalIds } from '../orchestrator-v5/agent-lane/display-ids.js';
import { approvalChipsFor } from '../orchestrator-v5/agent-lane/approval-chips.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/**
 * ⛔ A TURN'S IDENTITY IS CLAIMED BEFORE IT RUNS — independent review of #1720
 * at f616bc2a (CHANGES_REQUIRED): a preflight READ of "has this turn
 * committed?" let two concurrent identical requests both see "no row" and both
 * call the provider and the tools; and a turn whose final row failed to persist
 * was re-run by its retry. So the identity is now CLAIMED in the durable turn
 * table (unique on (scenario_id, turn_id)) before any provider or tool call:
 *   · the CLAIM row carries `<turn_id>:claim` and no messages (history readers
 *     exclude it before their LIMIT — see `SupabaseSessionStore.readRecent`);
 *   · the ANSWER row carries the client's `turn_id` with the user and final text.
 * Only the request that CREATED the claim runs. Any other sees the claim, never
 * runs, and waits for the answer (replaying it) or says the outcome is unknown.
 * A claim without an answer is never read as permission to run again.
 */
export const claimTurnIdOf = (turnId: string): string => `${turnId}:claim`;
/**
 * ⛔ THE CLAIM MUST DECIDE OWNERSHIP ON THE PRODUCTION STORE — independent review
 * of #1720 at cb4e9d35: a non-graph write goes to `append_turn_atomic_v2`, which
 * does `ON CONFLICT DO NOTHING` and returns the EXISTING id with no error, so the
 * store never reports "someone else created this" for a claim. The claim row
 * therefore carries a per-request NONCE in its hash; the row is written once by
 * whichever insert wins and never updated, so reading it back says, exactly,
 * whether THIS request created it.
 */
const CLAIM_NONCE = '#claim:';
const claimHashFor = (requestHash: string, nonce: string): string => `${requestHash}${CLAIM_NONCE}${nonce}`;
const requestHashOfClaim = (claimHash: string): string => claimHash.split(CLAIM_NONCE)[0] ?? '';
/**
 * How long a request that did not win the claim waits for the winner's answer.
 *
 * ⛔ IT MUST END BEFORE THE BROWSER PROXY GIVES UP (Panel, #1720 APPROVE 5792014826,
 * non-blocking #1). At 150 s it outlasted the proxy's 125 s inject timeout, so a
 * same-id duplicate in the browser got a proxy timeout instead of the replay or the
 * 409 it was designed to return. Derived from the served proxy timeout, less the
 * same response headroom the V5 turn budget reserves, so the loser always answers.
 */
export const AGENT_TURN_CLAIM_WAIT = {
  totalMs: Math.min(150_000, config.proxy.browserProxyTimeoutMs - TURN_RESPONSE_HEADROOM_MS),
  everyMs: 1_000,
};

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
    : 'To change the model you must first call a proposing tool \u2014 propose_model_change for a link, propose_assumptions to give value-less factors a starting number, propose_option_interventions to record the level an option sets, propose_starting_point for both at once \u2014 show the user exactly what it returned (in words: never print a proposal_id or any other internal id \u2014 the user approves by simply saying yes), and call authorise_change with that proposal_id ONLY after they have explicitly approved it.';

const AGENT_INSTRUCTIONS = [
  'You are Olumi, a strategic reasoning layer. Improve human strategic judgement rather than deciding for the user.',
  'Answer the user’s actual question directly and naturally.',
  'Never invent canonical facts. Before describing what the model contains, call get_canonical_state.',
  'Distinguish user facts and evidence from machine-authored estimates and from unknowns. An absent value is unknown, never zero.',
  /*
   * ⛔ CARRYING THE FIELD IS NOT SAYING IT. Measured 3/3 on the Agent route: the
   * reply quoted the stored `0.45` and said "the model does not state its unit"
   * while the node held `unit: months, raw_value: 9`. `value` is the model's
   * internal normalised scale — a £49 price is stored as 0.245 — and is never
   * the figure to put in front of a user.
   */
  'An entity\u2019s `value` is on the model\u2019s internal normalised scale and is NOT the figure the user gave. When `raw_value` is present, quote `raw_value` with its `unit` (e.g. \u00a349/month, 9 months); never quote the normalised `value` to the user. Only when there is no `raw_value` may you describe `value`, and then say it is on a normalised scale.',
  MUTATION_INSTRUCTION,
  'Never claim a change happened unless the tool result says it was applied. If a tool reports a refusal, tell the user what it said.',
  /*
   * ⭐ SAY WHAT THE CHANGE BECAME. Measured signed-in on staging 9c16e8cd: the
   * authorised write minted a version and the Agent never mentioned it, and
   * the retry was told only that something had happened once.
   */
  'When authorise_change returns `receipts`, tell the user the change is saved and which version it became. If it returns `already_applied`, the change is ALREADY saved \u2014 say which version, and do not offer to apply it again. If `receipts` is empty, say plainly that no saved version was recorded for it.',
  /*
   * ⛔ THE WORST FAILURE IN THIS LOOP, measured on the deployed build: the user
   * said "Yes, apply it" and the turn called NO tools, replying that the change
   * "has been proposed but not approved or applied". The user believes the
   * model changed; it did not.
   */
  'When the user approves, agrees, or says yes, that is an instruction to call authorise_change. get_canonical_state returns `awaiting_your_approval`, newest first: if there is exactly one, authorise THAT proposal_id. If there is more than one, describe each by what it changes (never by its id) and ask which \u2014 in the same turn. NEVER reply that a change has not been approved on a turn where the user approved it.',
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
  /*
   * ⭐ ONE APPROVAL TO A FIRST COMPARISON. Measured on Paul's 22 Sep journey
   * and its replay: the model was built, then took five further turns of
   * piecemeal proposals — and two proposals offered together could never both
   * be applied from one "yes". The build turn now ends with ONE exact starting
   * point the user can adopt in a single approval.
   */
  'In that same reply, if any factor has no value or any option sets nothing, call propose_starting_point ONCE with a reasoned starting value for each such factor and the level each option sets, in the user\u2019s own units. Show every figure and what it rests on, say they are your assumptions to adopt or correct, and ask for one approval.',
  'If propose_starting_point refuses with incomplete_starting_point, NOTHING is awaiting approval: call it again with a level for every pair in options_missing_levels before you reply. Never ask the user to approve an incomplete starting point.',
  'Discussion, ideation and research are not mutation requests.',
  /*
   * ⭐ IDEATION PUSHES BEYOND THE MODEL, AND SAYS WHAT IT DID NOT DO (Paul, 23 Sep:
   * "generates non-obvious alternatives … surfaces missing factors and perspectives").
   * Measured on 10 served "just ideas" replies: 10–19 listed items each — more than a
   * team can weigh — and only 1 of 10 said nothing had been added to the model.
   */
  'When the user asks for ideas or other options, offer three to five the model does not already hold, preferring non-obvious ones, and give each one line on what it would change or which assumption it would test. Say plainly that none has been added to the model, and offer to add any the user picks.',
  /*
   * ⛔ MEASURED on Paul's 22 Sep session: fourteen values were applied and the
   * analysis was never run again, so nothing the user could see had moved.
   */
  'After authorise_change applies values or option levels, call run_analysis in the SAME turn and report what it now says \u2014 or, if it still refuses, exactly what is left and the fastest way to supply it. The user asked for a model they can compare, not for a write.',
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
  'When you offer starting estimates, offer them THROUGH a proposing tool so the user can adopt the exact set you showed them in one step: propose_starting_point whenever factor values AND option levels are both missing (two separate proposals cannot both be applied from one approval), propose_assumptions when only values are. If the user asks you to put your suggested assumptions into the model, that is a request to propose them \u2014 propose the figures you just gave, then authorise_change once they confirm.',
  'propose_assumptions changes nothing on its own and leaves any factor that already holds a value alone. After authorise_change, report every value the model stored differently from the one approved.',
  /*
   * ⭐ THE LAST STRUCTURAL WALL ON THE JOURNEY, measured at served 59c90069:
   * scale resolved, every factor valued, and the analysis STILL refused —
   * two options named a factor without saying what level they set it to.
   */
  'An option that connects to a factor but states no level for it blocks the comparison for EVERY option, not only itself. run_analysis names each one. Offer a level in the user\u2019s own units with propose_option_interventions, exactly as you would a starting assumption, and say it is an assumption to correct.',
  'Give propose_option_interventions the number the USER would say (54, not 0.27). If it answers `no_stated_range`, that factor has no range to read the number against \u2014 say so plainly and do not invent one.',
  /*
   * ⭐ THE BLOCKER THAT SURVIVES EVERY VALUE BEING FILLED IN.
   * Measured live at served 877ae800: eight assumptions adopted, ZERO factors
   * left without a value — and the analysis still refused, because one option
   * of three carried `interventions: null`. An option that sets nothing cannot
   * be compared with one that does.
   */
  'get_canonical_state also reports `options_that_change_nothing`. An option in that list sets no factor, so it cannot be compared and it blocks the whole analysis. Raise it when you describe the model \u2014 do not wait for the analysis to refuse \u2014 ask what that option would actually change, and record the answer with propose_option_interventions.',
  /*
   * ⛔ ANALYSIS IS MODEL-RELATIVE, NEVER A RECOMMENDATION (Paul, 23 Sep: "Olumi is a
   * reasoning-enhancement system, not an answer or decision engine"). Measured on
   * served replies: all 20 analysis replies carried a caveat, but 8 of 20 still
   * framed the result in "winner" / "best option" terms — often to deny one, yet
   * the vocabulary itself casts the finding as picking an answer. The useful move is the one the science supports: point at what the
   * ordering is sensitive to, and let the user change it and see how much it matters.
   */
  'When you report an analysis, describe what the CURRENT model implies given its assumptions \u2014 a finding to reason with, never a recommendation. Never call an option the winner, the best option or the recommended one; say which option leads in this model and how firmly. Then name the one or two assumptions the ordering is most sensitive to, say whether each came from the user or from you, and invite the user to change one and see how much it matters. When the result is fragile or a near tie, say that this uncertainty is itself the finding.',
  'British English. Concise but substantive.',
].join(' ');

/**
 * Read the persisted state back for the response: `graph_hash`, readiness and
 * the `draft_graph` the canvas draws. Shared by a live turn and a replay, so a
 * replayed answer is shown against the SAME current state a fresh one would be.
 */
async function readBackState(dispatch: InternalDispatch, scenarioId: string): Promise<{ graphHash?: string; analysisReady?: unknown; draftGraph?: unknown }> {
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
      /**
       * ⭐ READINESS FROM THE MOMENT THE MODEL EXISTS, not from the moment
       * someone runs an analysis.
       *
       * ⛔ MEASURED on the real browser transport: after a 60-90 s
       * construction turn the response carried `draft_graph` and NO
       * `analysis_ready`, so the readiness panel was empty at exactly the
       * point a user has just built a model and wants to know what it still
       * needs. The estate's own live-journey gate asserts the same thing
       * (`turn 1: analysis_ready.options=0, expected >= 2`), which is how
       * the gap surfaced.
       *
       * `assessCanonicalAnalysisReadiness` is the ONE readiness authority
       * named in CLAUDE.md and it is a pure function of the graph — no LLM,
       * no network, no second orchestrator turn — so this costs a function
       * call, not twenty seconds. The graph read's own `analysis_ready`
       * still wins when it has one, because that reflects a real run.
       */
      if (analysisReady === undefined && after.json.graph !== undefined) {
        try {
          const assessed = assessCanonicalAnalysisReadiness(after.json.graph);
          if (assessed.analysisReady !== undefined) analysisReady = assessed.analysisReady;
        } catch {
          // Readiness is a disclosure, never a gate on the user's answer.
        }
      }
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
  return { graphHash, analysisReady, draftGraph };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What makes two Agent turns "the same request": the scenario, WHO is asking,
 * and the message itself (trimmed). Stored as the turn row's `request_hash`, so
 * an exact retry replays and a reused id carrying a different message refuses.
 */
export function agentTurnRequestHash(scenarioId: string, userId: string | null, message: string): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ v: 1, scenario_id: scenarioId, subject: userId, message: message.trim() }))
    .digest('hex');
  return `agent_turn:${digest}`;
}

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
    const startedAt = Date.now();
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
      /**
       * ⭐ DIRECT MANIPULATION IS FORWARDED, NOT REFUSED.
       *
       * ⛔ WHY THIS CHANGED, and it is the most expensive thing I have learned
       * in this lane. This branch used to refuse every non-message kind, on the
       * reasoning that "silently dropping a mutation would be worse than saying
       * no". That was the right choice between those two options and the wrong
       * set of options: the third one is to forward it to the handlers the
       * conversational path ALREADY writes through.
       *
       * Measured consequence of the refusal, on 22 Sep: setting
       * `PROXY_V5_TARGET=agent` pointed the browser proxy here, and **the
       * entire Canvas surface stopped working** — `factor_value_edit`,
       * `structural_rename` and the rest of the direct-manipulation vocabulary
       * all came back "That kind of change does not come through this
       * conversation route", `stopped_reason: unsupported_kind`. Another lane
       * caught it with a wire witness. So the refusal did not protect the
       * model; it made the flag unusable, and with it every browser witness of
       * this lane.
       *
       * The Canvas is NOT conversation. A factor edit is the user's own hand on
       * their own model: there is nothing for an agent to decide, and routing it
       * through one would add a language model to an action that is already
       * unambiguous. So it goes straight to `/orchestrate/v2/turn` — the same
       * boundary every tool in this lane writes through, carrying the caller's
       * own authorization — and the response is returned verbatim.
       *
       * ⛔ PREVIEW STILL REFUSES. That is the hard boundary of this lane: a
       * read-only preview may not mutate, and a forward is a mutation. The
       * refusal is kept exactly as it was, in the product's own voice.
       */
      if (mode === 'preview') {
        const composedRefusal = composeDirectAnswerResponse({
          assistant_text:
            'This is a read-only preview, so I can\u2019t change the model from the board. Tell me what you want to change and I\u2019ll talk it through.',
          stage: 'frame',
          answerKind: 'substantive',
        });
        return reply.code(200).send({
          ...finaliseV5Response(composedRefusal, { scenarioId }),
          _agent: { session_id: sessionId, mode, tool_calls: [], mutated: false, hops: 0, stopped_reason: 'read_only_preview' },
        });
      }

      const forwarded = await dispatchFor(
        typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      )('/orchestrate/v2/turn', body);
      return reply.code(forwarded.status).send({
        ...forwarded.json,
        // Underscore sidecar: egress is `.strict()`. Says plainly that this
        // turn was NOT agent-handled, so a reader cannot mistake a forwarded
        // canvas edit for something the Agent decided.
        _diagnostic_trace: {
          ...(typeof forwarded.json._diagnostic_trace === 'object' && forwarded.json._diagnostic_trace !== null
            ? forwarded.json._diagnostic_trace as Record<string, unknown>
            : {}),
          exit_path: 'agent_lane_forwarded',
          forwarded_kind: kind,
        },
      });
    }

    if (scenarioId.length === 0 || message.length === 0) {
      return reply.code(422).send({ error: 'BAD_INPUT', detail: 'scenario_id and message are required' });
    }

    /**
     * ⛔ THE WHOLE AGENT TURN IS ONE OPERATION, AND ITS IDENTITY IS THE CLIENT'S
     * `turn_id` — Release Control, 23 Sep (#63 5788656586): this route read no
     * `turn_id` at all, ran the model, then advanced the in-process history. An
     * exact lost-response retry was therefore a FRESH execution against a history
     * the first attempt had already moved on — it took a different next action
     * and could write where the first had only proposed. The durable turn table
     * (`v5_conversation_turns`, unique on `(scenario_id, turn_id)`) is the
     * authority used below; there is no in-memory replay map. Absent → exactly
     * today's behaviour.
     */
    const turnId = typeof body.turn_id === 'string' && body.turn_id.length > 0 ? body.turn_id : undefined;
    if (turnId !== undefined && !UUID_PATTERN.test(turnId)) {
      return reply.code(422).send({ error: 'BAD_INPUT', detail: '`turn_id` must be a UUID when supplied.' });
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
    const store = getSessionStore();
    try {
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

    const requestHash = agentTurnRequestHash(scenarioId, userId, message);
    /** The response a replay returns: the ORIGINAL words, on today's state, with no model call. */
    const replayed = async (prior: CommittedTurnRecord) => {
      const composedReplay = composeDirectAnswerResponse({
        assistant_text: prior.assistant_message ?? 'That request was already completed.',
        stage: 'frame',
        answerKind: 'substantive',
      });
      const state = await readBackState(dispatch, scenarioId);
      return {
        ...finaliseV5Response(composedReplay, { scenarioId }),
        ...(state.graphHash !== undefined ? { graph_hash: state.graphHash } : {}),
        ...(state.analysisReady !== undefined ? { analysis_ready: state.analysisReady } : {}),
        ...(state.draftGraph !== undefined ? { draft_graph: state.draftGraph } : {}),
        _diagnostic_trace: { exit_path: 'agent_lane_v1', agent_mode: mode, hops: 0, stopped_reason: 'replayed', tools_called: [], replayed: true },
        _agent: { session_id: sessionId, mode, tool_calls: [], mutated: false, hops: 0, stopped_reason: 'replayed', replayed: true, turn_id: turnId },
      };
    };
    // Set only when THIS request owns the turn — used to release it if nothing ran.
    let claimHash: string | undefined;
    if (turnId !== undefined && typeof store.readCommittedTurn === 'function') {
      const readAnswer = (): Promise<CommittedTurnRecord | null> => store.readCommittedTurn!(scenarioId, turnId);
      let prior: CommittedTurnRecord | null;
      try {
        prior = await readAnswer();
      } catch (err) {
        // Unknown is not absent: running the model now could repeat a turn that
        // already wrote. Nothing is run.
        log.warn({ err: String(err), scenario_id: scenarioId, turn_id: turnId }, 'agent-lane: prior-turn read failed — refusing rather than re-running');
        return reply.code(503).send({ error: 'TURN_STATE_UNVERIFIABLE', detail: 'Could not check whether this turn already ran. Nothing was run — please try again.' });
      }
      if (prior !== null) {
        if (prior.request_hash !== requestHash) {
          return reply.code(409).send({ error: 'TURN_ID_REUSED', detail: 'That turn id was already used for a different message. Nothing was run or changed.' });
        }
        return reply.code(200).send(await replayed(prior));
      }
      // CLAIM the identity before any provider or tool call. No graph rides on
      // it, so it takes no fence and no CAS; it goes through the shared floor
      // like every turn row (C8). Ownership is decided by READING IT BACK.
      const claimTurnId = claimTurnIdOf(turnId);
      claimHash = claimHashFor(requestHash, randomUUID());
      let owner: CommittedTurnRecord | null;
      try {
        await appendCheckedGraphWrite({
          store,
          writesGraph: false,
          source: 'agent_turn_claim',
          write: {
            scenario_id: scenarioId,
            turn_id: claimTurnId,
            turn_class: 'direct_answer',
            handler_id: null,
            request_hash: claimHash,
            response_emitted: false,
            llm_calls_used: 0,
            duration_ms: 0,
            handler_facts: [],
          },
        });
        owner = await store.readCommittedTurn(scenarioId, claimTurnId);
      } catch (err) {
        log.warn({ err: String(err), scenario_id: scenarioId, turn_id: turnId }, 'agent-lane: turn claim failed — refusing rather than running unclaimed');
        return reply.code(503).send({ error: 'TURN_STATE_UNVERIFIABLE', detail: 'Could not reserve this turn. Nothing was run — please try again.' });
      }
      if (owner === null) {
        return reply.code(503).send({ error: 'TURN_STATE_UNVERIFIABLE', detail: 'Could not confirm this turn was reserved. Nothing was run — please try again.' });
      }
      const claim = {
        won: owner.request_hash === claimHash,
        sameRequest: requestHashOfClaim(owner.request_hash) === requestHash,
      };
      if (!claim.won && !claim.sameRequest) {
        return reply.code(409).send({ error: 'TURN_ID_REUSED', detail: 'That turn id was already used for a different message. Nothing was run or changed.' });
      }
      if (!claim.won) {
        // Another request owns this turn: in flight now, or it ran and its answer
        // was never recorded. It is NEVER run again here. Wait for its answer.
        const deadline = Date.now() + AGENT_TURN_CLAIM_WAIT.totalMs;
        for (;;) {
          let answer: CommittedTurnRecord | null = null;
          try { answer = await readAnswer(); } catch { answer = null; }
          if (answer !== null) {
            if (answer.request_hash !== requestHash) {
              return reply.code(409).send({ error: 'TURN_ID_REUSED', detail: 'That turn id was already used for a different message. Nothing was run or changed.' });
            }
            return reply.code(200).send(await replayed(answer));
          }
          if (Date.now() >= deadline) break;
          await new Promise((r) => setTimeout(r, AGENT_TURN_CLAIM_WAIT.everyMs));
        }
        log.warn({ scenario_id: scenarioId, turn_id: turnId }, 'agent-lane: turn claimed but no answer recorded — outcome unknown, not re-run');
        return reply.code(409).send({
          error: 'TURN_OUTCOME_UNKNOWN',
          detail: 'This message is already being handled, or an earlier attempt ran and its reply was not recorded. Nothing was run again — reload to see the current model.',
        });
      }
      // This request created the claim: it alone runs the turn.
    }
    /**
     * ⛔ THE UI RENDERS THE ANALYSIS FROM `blocks` AND `analysis_ready`, NOT
     * FROM THE PROSE. Measured on the real browser transport at `2fd8cbba`:
     * the analysis turn returned 200 with a correct verdict in
     * `assistant_text` and `blocks=none`, `analysis_ready.options=0`. A user
     * reading the page got the sentence and an EMPTY results panel — the
     * numbers existed and never reached the surface that shows them. This is
     * the same defect shape as the `draft_graph` one: the answer was right and
     * the carrier was missing.
     */
    let analysisFromTool: { analysis_ready?: unknown; blocks?: unknown[] } | undefined;
    // Counts every call that could WRITE, so a failed turn knows whether it is
    // safe to release its claim (nothing sent) or must leave it (outcome unknown).
    let writesDispatched = 0;
    const countingDispatch: typeof dispatch = async (path, body) => {
      if (path.endsWith('/graph/register') || path === '/orchestrate/v2/turn') writesDispatched += 1;
      return dispatch(path, body);
    };
    const capabilities = createAgentCapabilities(countingDispatch, proposals, callStructured, mode, (payload) => {
      analysisFromTool = payload;
    });
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
      // Nothing was sent that could write: release the claim, so a retry of the
      // SAME turn_id can run. If anything was sent, the claim stands — the
      // outcome is unknown and the turn is never run twice.
      let released = false;
      if (turnId !== undefined && claimHash !== undefined && writesDispatched === 0 && typeof store.releaseTurnClaim === 'function') {
        try { await store.releaseTurnClaim(scenarioId, claimTurnIdOf(turnId), claimHash); released = true; }
        catch (e) { log.warn({ err: String(e), scenario_id: scenarioId, turn_id: turnId }, 'agent-lane: claim release failed'); }
      }
      return reply.code(502).send({
        error: 'UPSTREAM_ERROR', detail: String(err).slice(0, 300),
        ...(turnId !== undefined ? { retry_safe: released } : {}),
      });
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
    /**
     * ⛔ WHAT WAS SAVED IS STATED BY OLUMI, FROM THE TOOL RESULTS (RC #63
     * 5788648244). A model-authored "Saved…" survived here on a turn that wrote
     * nothing, because this route returned the model's words verbatim. The
     * status line is composed from the authoritative results; an unsupported
     * write claim is removed when nothing landed. See `write-outcome.ts`.
     */
    const narration = narrateWriteOutcome(text, result.tool_calls, result.tool_results);
    const composed = composeDirectAnswerResponse({
      // ⛔ A proposal id is a binding for authorise_change, never text a user reads or
      // types (display-ids.ts). Applied here, before the answer row is written, so a
      // replay returns exactly what the user first saw.
      assistant_text: withoutProposalIds(withWriteOutcome(withDisclosures(narration.text, owed), narration.status)),
      stage: 'frame',
      answerKind: 'substantive',
      // One click approves the ONE proposal just offered — the same words as typing "yes".
      suggested_actions: approvalChipsFor(result.tool_calls),
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
    const { graphHash, analysisReady, draftGraph } = await readBackState(dispatch, scenarioId);

    // The analysis the tool actually ran wins over the graph readback, which
    // carries only the persisted state and never the run's own options.
    const analysisBlocks = Array.isArray(analysisFromTool?.blocks) ? analysisFromTool.blocks : [];
    const existingBlocks = Array.isArray((finalised as { blocks?: unknown[] }).blocks)
      ? (finalised as { blocks: unknown[] }).blocks
      : [];

    /**
     * ⭐ PERSIST THE TURN BEFORE ANSWERING — the row a lost-response retry is
     * replayed from. No graph rides on it (the Agent's writes carry their own
     * identities), so it takes no fence and no CAS. Stored text is the FINAL
     * text returned, disclosures included, so a replay is word-for-word.
     */
    let durability: 'recorded' | 'not_recorded' | 'no_turn_id' = 'no_turn_id';
    if (turnId !== undefined) {
      try {
        // Through the SHARED persistence floor, like every turn row: the one
        // `store.append` stays inside it (C8). No graph rides on this row.
        const outcome = await appendCheckedGraphWrite({
          store,
          writesGraph: false,
          source: 'agent_turn',
          write: {
          scenario_id: scenarioId,
          // The ANSWER row, under the client's own turn_id; the claim
          // (`<turn_id>:claim`) was taken before the run.
          turn_id: turnId,
          // DB CHECK: (turn_class = 'handler') = (handler_id IS NOT NULL) —
          // the graph-register precedent for a turn with no handler.
          turn_class: 'direct_answer',
          handler_id: null,
          request_hash: requestHash,
          response_emitted: true,
          llm_calls_used: result.hops + 1,
          duration_ms: Date.now() - startedAt,
          handler_facts: [],
          userMessage: message,
          assistantMessage: String((finalised as { assistant_text?: unknown }).assistant_text ?? text),
          },
        });
        if (outcome.priorTurnConflict === true) {
          // A concurrent request with the SAME id and a DIFFERENT message won the
          // row. This answer is not the recorded one; say so rather than return it.
          log.warn({ scenario_id: scenarioId, turn_id: turnId }, 'agent-lane: turn id taken by a different concurrent message');
          return reply.code(409).send({ error: 'TURN_ID_REUSED', detail: 'That turn id was already used for a different message. This reply was not recorded.' });
        }
        if (outcome.replayedPriorTurn === true && typeof store.readCommittedTurn === 'function') {
          // An identical concurrent request committed first: ITS answer is the
          // record, so it is the one returned.
          const first = await store.readCommittedTurn(scenarioId, turnId);
          if (first !== null) return reply.code(200).send(await replayed(first));
        }
        durability = 'recorded';
      } catch (err) {
        // The answer is real and the writes already happened; hiding it would be
        // worse. It is returned, flagged as not durable, and logged loudly.
        log.error({ err: String(err), scenario_id: scenarioId, turn_id: turnId }, 'agent-lane: answer could not be recorded — the claim stands, so a retry reports an unknown outcome and never re-runs');
        durability = 'not_recorded';
      }
    }

    return reply.code(200).send({
      ...finalised,
      ...(analysisBlocks.length > 0 ? { blocks: [...existingBlocks, ...analysisBlocks] } : {}),
      ...(graphHash !== undefined ? { graph_hash: graphHash } : {}),
      ...(analysisFromTool?.analysis_ready !== undefined
        ? { analysis_ready: analysisFromTool.analysis_ready }
        : analysisReady !== undefined ? { analysis_ready: analysisReady } : {}),
      ...(draftGraph !== undefined ? { draft_graph: draftGraph } : {}),
      /**
       * ⭐ SAY WHICH PATH SERVED THIS TURN.
       *
       * ⛔ MEASURED: the estate's `Live user journey against deployed staging`
       * gate fails with "turn 1: `_diagnostic_trace.exit_path` missing — cannot
       * tell which path served this turn". With `PROXY_V5_TARGET=agent` every
       * browser turn comes through here, and the orchestrator's trace never
       * runs, so nothing downstream could name the producer. An observer that
       * cannot identify the producer cannot attribute a defect to it.
       *
       * Underscore-prefixed because `OlumiResponseSchema` is `.strict()`: a
       * sidecar is the established way past it, which is why `_agent` already
       * travels this way.
       */
      _diagnostic_trace: {
        exit_path: 'agent_lane_v1',
        agent_mode: mode,
        hops: result.hops,
        stopped_reason: result.stopped_reason,
        tools_called: result.tool_calls.map((c) => c.name),
        write_claims_removed: narration.stripped.length,
      },
      _agent: {
        session_id: sessionId,
        mode,
        tool_calls: result.tool_calls,
        mutated: result.mutated,
        hops: result.hops,
        stopped_reason: result.stopped_reason,
        ...(turnId !== undefined ? { turn_id: turnId, durability } : {}),
        /**
         * ⭐ WHICH VERSION THIS TURN PRODUCED, so a surface can reconcile what it
         * is showing against what was actually saved. `mutated: true` said the
         * model changed and never said what it became.
         *
         * Read back from the tools that performed the writes — `tool_results`
         * already carries the full results — so nothing here is minted, and an
         * empty list is reported honestly rather than filled in.
         */
        receipts: collectTurnReceipts(result.tool_results),
      },
    });
  });

  log.info({ event: 'agent_lane.route_mounted' }, 'POST /agent/v1/turn mounted');
}
