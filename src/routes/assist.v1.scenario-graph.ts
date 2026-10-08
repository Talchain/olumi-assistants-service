/** Scenario graph and analysis read.
 * Identity and owner/viewer-member admission run in plugins/scenario-ownership.ts.
 * A verified viewer member reads this route only, without the owner's conversation.
 * Reads never create scenarios; unknown/non-owner ids share the same 404 envelope.
 * The handler retains payload validation, persisted-graph fidelity and analysis projection. */

import { goalScopeClaimInput } from '../orchestrator-v5/compose/goal-scope-claim-input.js';
import { claimPermissionsFrom } from '../orchestrator-v5/agent-lane/first-analysis.js';


import type { FastifyInstance } from "fastify";

import { parseRequestExtensions } from "../orchestrator-v5/boundary/request-extensions.js";
import type { GraphStateIngress } from "../orchestrator-v5/boundary/request-extensions.js";
import { deriveNotModelledManifest } from "../cee/context-integrity/not-modelled-manifest.js";
import { computeGraphIdentityHash } from "../orchestrator-v5/context/graph-identity.js";
import { computeAnalysisAffectingGraphHash } from "../orchestrator-v5/context/graph-hash.js";
import { proposalRecord, proposalFieldsWire, issuedTurnIdsForProposalRecords, proposalIssuances, type ProposalIssuingRow } from "../orchestrator-v5/agent-lane/proposal-object/record.js";
import { getSessionStore } from "../orchestrator-v5/session/index.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { buildErrorV1 } from "../utils/errors.js";
import { getRequestId } from "../utils/request-id.js";
import { log } from "../utils/telemetry.js";
// ROADMAP 2.1271 — the additive analysis payload. All composition lives in the
// helper; this route contributes the security ladder and the graph it read.
import { readScenarioAnalysis } from "./scenario-graph-analysis-read.js";
import { withEstimateGoalPointsAtEgress } from "../orchestrator-v5/agent-lane/goal-chance-estimate-egress.js";
import { projectAnalysisAdmission } from './analysis-admission-projection.js';
import { readExecutableHeldProposalOffers, type HeldProposalOfferRead } from '../orchestrator-v5/agent-lane/held-approval-offers.js';
import type { PendingAction } from '../orchestrator-v5/session/pending-action.js';
import { isAgentAnswerRow } from "../orchestrator-v5/session/conversation-as-seen.js";
import type { AnswerOffersRead } from '../orchestrator-v5/session/store.js';
import type { SuggestedAction } from '../orchestrator-v5/compose/types.js';
import { answerOffersForReload } from '../orchestrator-v5/agent-lane/answer-offers-reload.js';
import { executableWaitingProposal } from '../orchestrator-v5/agent-lane/held-approval-offers.js';
import { actionFactsOf } from '../orchestrator-v5/agent-lane/actions/state.js';
import { actionBarOf, type ActionBarV1 } from '../orchestrator-v5/agent-lane/actions/rank.js';
import { readEvaluatedIdentityNodeIds } from '../orchestrator-v5/agent-lane/admit-model.js';
import type { GuidanceState } from '../orchestrator-v5/agent-lane/guidance/index.js';
import { readChangedSinceRun } from '../orchestrator-v5/context/changed-since-run.js';
import { deriveDecisionContextGraphHash } from '../orchestrator-v5/build-turn-context.js';

/** Wire schema discriminator. Frozen — the UI lane builds against this. */
export const SCENARIO_GRAPH_SCHEMA = "scenario_graph.v1" as const;

/**
 * `scenarios.id` is a UUID column, so a non-UUID id cannot name an existing
 * row. Same pattern and same rationale as turn-stop.ts.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keys that would mean canvas LAYOUT had been persisted into `scenarios.graph`.
 *
 * ⚠ THIS IS A HAND-WRITTEN LIST, AND IT KNOWS IT (trap 12d). Deriving
 * `layout_present` from a list proves the consumers agree with the list; it can
 * never prove the list is complete. So the list is deliberately INCLUSIVE — the
 * asymmetry runs one way: a false TRUE is a harmless over-report the UI can
 * ignore, a false FALSE is a promise of "no layout" made over bytes that carry
 * it. Paired with a positive control in the spec that proves the derivation
 * fires at all, rather than passing by never firing.
 */
const LAYOUT_KEYS = new Set(["position", "positions", "layout", "x", "y"]);

/**
 * Does the graph we are about to return carry any layout/position data?
 *
 * MEASURED, NOT ASSERTED. A hardcoded `false` would be a hand-maintained mirror
 * of a schema fact (trap 12) that keeps answering "no layout" for exactly as
 * long as nobody re-checks it. Today this returns false for every real
 * `scenarios.graph`; the day it returns true, the UI gets a signal instead of a
 * stale promise.
 */
function detectLayout(graph: unknown): boolean {
  if (graph === null || typeof graph !== "object") return false;
  const g = graph as Record<string, unknown>;

  for (const key of Object.keys(g)) {
    if (LAYOUT_KEYS.has(key.toLowerCase())) return true;
  }

  for (const collection of ["nodes", "edges", "options"] as const) {
    const entries = g[collection];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry === null || typeof entry !== "object") continue;
      for (const key of Object.keys(entry as Record<string, unknown>)) {
        if (LAYOUT_KEYS.has(key.toLowerCase())) return true;
      }
    }
  }

  return false;
}

/** Most turns a reload restores; the oldest beyond it are left out (the Agent's own window is 20). */
export const CONVERSATION_TURNS_CAP = 50;
/** The raw rows read so that {@link CONVERSATION_TURNS_CAP} answer rows survive the drop (each Agent turn also writes a
 *  claim row and its sub-turns). */
export const CONVERSATION_ROWS_READ = CONVERSATION_TURNS_CAP * 4;

/** One restored turn: stored text, with the same current-Run estimate attribution gate as live replies. */
export interface ConversationTurnRead {
  readonly turn_id: string;
  readonly created_at: string;
  readonly user_message: string | null;
  readonly assistant_message: string | null;
  readonly suggested_actions?: readonly SuggestedAction[];
}

function wantsConversationTurns(body: unknown): boolean {
  return body !== null && typeof body === "object" && !Array.isArray(body)
    && (body as Record<string, unknown>).include_conversation_turns === true;
}

/**
 * ⛔ ONLY WHAT THE USER SAW (Canvas #75 5910906799; root cause MG 5910983526; DL 5911089211; AIQ 5911161828).
 *
 * `v5_conversation_turns` holds more than the conversation. The Agent's tools reach the product through in-process
 * turns (`/orchestrate/v2/turn`), and each commits its own row: served MRR `3b6369b0` 01:44:03 stored the MODEL's tool
 * reason as `user_message` ("The user asked to run the analysis after confirming how MRR is calculated.") and the
 * HANDLER's text as `assistant_message` ("… scored highest in 100% of runs"). The user saw neither: they typed "Run the
 * analysis" and read the Agent's answer, which the Agent route writes as its OWN row. Restoring every row put words in
 * the user's mouth and showed text they never read.
 *
 * The rows the user saw are the Agent route's answer rows, and every one of them carries the route's own request
 * hash: `agent_turn:` (`agentTurnRequestHash`, `agent-v1-turn.ts`). The turn executor's rows carry `sha256:`, a
 * registration `graph_registration:`. So the restore keeps `agent_turn:` rows only. That is a marker already stored
 * on every row, so rows written before this change are dropped too. A board edit forwarded from the canvas is left
 * out as well: its narration was shown when it happened, and a restore omits it rather than risk text the user never
 * saw.
 */
export { AGENT_ANSWER_REQUEST_HASH_PREFIX } from "../orchestrator-v5/session/conversation-as-seen.js";

/**
 * The scenario's turns, OLDEST first, from the last {@link CONVERSATION_TURNS_CAP} rows, each reduced to its id, time
 * and the two stored texts. `readRecent` answers newest first; only the Agent's answer rows are kept (above), and a turn
 * with no text on either side (the Agent's claim row) is not a message and is left out. Never throws: a failed read is
 * `null` and the graph read stands.
 */
async function readConversationTurns(
  store: { readRecent(scenarioId: string, limit?: number): Promise<readonly (ProposalIssuingRow & { readonly created_at: string })[]>; readCommittedTurn?: (scenarioId: string, turnId: string) => Promise<{ pending_actions?: readonly unknown[] } | null>; readLatestAnswerOffers?: (scenarioId: string) => Promise<AnswerOffersRead | null> },
  scenarioId: string,
  requestId: string,
  authority: { userId: string | null; graphHash: string | undefined; latest: readonly PendingAction[];
    analysisState: unknown; analysisResult: unknown; analysisReady: unknown; graph: unknown; modelExists: boolean },
): Promise<{ turns: ConversationTurnRead[]; heldOffers: HeldProposalOfferRead[]; proposalRows: readonly ProposalIssuingRow[] } | null> {
  try {
    const rows = await store.readRecent(scenarioId, CONVERSATION_ROWS_READ);
    const answers = rows.filter(isAgentAnswerRow)
      .filter(r => typeof r.user_message === "string" || typeof r.assistant_message === "string").slice(0, CONVERSATION_TURNS_CAP);
    const current = (authority.analysisState as { run_state?: { kind?: unknown } } | null)?.run_state?.kind === "complete_current";
    const turns: ConversationTurnRead[] = [...answers].reverse()
      .map((r) => ({
        turn_id: r.turn_id,
        created_at: r.created_at,
        user_message: typeof r.user_message === "string" ? r.user_message : null,
        assistant_message: typeof r.assistant_message === "string"
          ? withEstimateGoalPointsAtEgress({ assistant_text: r.assistant_message }, {
            analysisResult: authority.analysisResult, graph: authority.graph, current,
            userAuthoredTexts: answers.flatMap(answer => typeof answer.user_message === 'string' ? [answer.user_message] : []),
          }).assistant_text : null,
      }))
      .filter((t) => t.user_message !== null || t.assistant_message !== null)
      .slice(-CONVERSATION_TURNS_CAP); // the cap counts AFTER the drop (CURRENT-READ-v1 row 5)
    const heldOffers = await readExecutableHeldProposalOffers({ scenarioId, ...authority, rows: answers, store });
    if (typeof store.readLatestAnswerOffers === 'function') {
      // This optional leg must never change the graph, held cards or text if it fails.
      try {
        const stored = await store.readLatestAnswerOffers(scenarioId);
        const last = turns[turns.length - 1];
        if (stored !== null && last !== undefined && last.turn_id === stored.turn_id) {
          const outstandingProposalIds = new Set(heldOffers.map(offer => offer.proposal_id));
          const waiting = executableWaitingProposal(scenarioId, authority.userId, authority.graphHash, authority.graph);
          if (waiting !== undefined) outstandingProposalIds.add(waiting);
          const actions = answerOffersForReload(stored, scenarioId, { ...authority, latestPending: authority.latest, outstandingProposalIds });
          if (actions.length > 0) turns[turns.length - 1] = { ...last, suggested_actions: actions };
        }
      } catch { /* Offers unavailable: retain the existing response. */ }
    }
    return { turns, heldOffers, proposalRows: rows };
  } catch (err) {
    log.warn(
      {
        event: "v5.scenario_graph.conversation_turns_read_failed",
        request_id: requestId,
        scenario_id: scenarioId,
        err: err instanceof Error ? err.message : String(err),
      },
      "Scenario graph read — conversation turns read failed; answering null, the graph stands",
    );
    return null;
  }
}

export default async function route(app: FastifyInstance) {
  // Tier `read`, DERIVED from RATE_BUCKET_REGISTRY (the single place the
  // route→tier assignment lives; its drift test enforces both directions).
  const RATE_LIMIT_MAX = resolveCeeRateLimit("CEE_SCENARIO_GRAPH_RATE_LIMIT_RPM");

  app.post<{ Params: { scenario_id: string } }>(
    "/assist/v1/scenarios/:scenario_id/graph",
    {
      // THE REPO'S OWN LIMITER, applied per-route — the `proxy-v5-turn.ts`
      // stop-rung pattern. `@fastify/rate-limit` is registered `global: true`
      // in server.ts and this config overrides its max for exactly this route.
      //
      // ⚠ THIS REPLACED A HAND-ROLLED IN-HANDLER LIMITER, and the reason is
      //   worth keeping. The custom version enforced correctly (its specs and
      //   mutants proved it), but CodeQL kept raising `js/missing-rate-limiting`
      //   HIGH against this handler: the query models RECOGNISED middleware, and
      //   a bespoke `tryConsume()` call inside a handler is invisible to it. A
      //   control that a scanner cannot see is a control every future reviewer
      //   has to re-derive by hand. Expressing the same limit through the
      //   sanctioned plugin is strictly better on every axis — it is
      //   Redis-backed in production rather than per-instance memory, it yields
      //   the app-standard `error.v1 RATE_LIMITED` body via server.ts's
      //   `errorResponseBuilder` instead of a second bespoke 429 shape, and it
      //   deletes code rather than adding a 15th copy of the `pruneBuckets` /
      //   `checkRateLimit` pair that 17 route files already carry (trap 12).
      //
      // ⚠ THE BUCKET IS PER CLIENT, and that falls out of the plugin's DEFAULT
      //   keyGenerator (`req.ip`) rather than being configured here. It is the
      //   behaviour this route needs and it is pinned by a spec, because it is
      //   a default someone could change: through the `/bff/cee/*` edge every
      //   visitor arrives carrying the SAME injected assist key, so any
      //   key-derived bucket would be one product-wide shared-fate throttle in
      //   which a single busy tab 429s everybody. `req.ip` resolves from
      //   `x-forwarded-for` in production (`trustProxy: nodeEnv === "production"`),
      //   so it is per-visitor — which is also the granularity that bounds the
      //   real threat here: one host walking scenario ids.
      config: { scenarioId: { from: 'params', key: 'scenario_id', viewerMemberRead: true },
        rateLimit: {
          max: RATE_LIMIT_MAX,
          timeWindow: "1 minute",
        },
      },
    },
    async (req, reply) => {
      const requestId = getRequestId(req);
      const scenarioId = req.params.scenario_id;

      /**
       * THE ONE REFUSAL. Absent scenario, someone else's scenario, malformed
       * id, ownership oracle down — all answer these exact bytes. See the
       * header: a refusal that named its reason would be an enumeration oracle
       * over other people's decisions.
       */
      const refuse = () =>
        reply
          .code(404)
          .send(
            buildErrorV1(
              "NOT_FOUND",
              "No readable graph for that scenario.",
              {},
              requestId,
            ),
          );

      /**
       * A read that could not complete is an UNKNOWN, never an absence and
       * never an empty graph. Answering 404 or `graph: null` on a DB blip
       * would tell the UI the user's decision does not exist / is empty, and
       * the UI would render that as an empty canvas over live data.
       */
      const unavailable = () =>
        reply
          .code(503)
          .send(
            buildErrorV1(
              "INTERNAL",
              "The graph could not be read right now.",
              {},
              requestId,
            ),
          );

      // The rate limit runs BEFORE this handler — it is the plugin's
      // onRequest hook, driven by the `config.rateLimit` above.

      // ── 1. Syntax: a non-UUID cannot name a row. No round trip. ─────────
      if (!UUID_PATTERN.test(scenarioId)) {
        return refuse();
      }

      const store = getSessionStore();
      const extensions = parseRequestExtensions(req.body, requestId);
      if (!extensions.ok) return refuse();

      // Production reads one existing row: absence stays distinct from a guest owner,
      // and this read has no create-on-read path. Legacy stores retain their original ladder.
      let snapshot = req.scenarioAccess?.snapshot;
      const memberRead = req.scenarioAccess?.memberRead ?? false;
      if (typeof store.readExistingScenario === "function") {
        if (snapshot === undefined) {
          try { snapshot = await store.readExistingScenario(scenarioId); } catch { return unavailable(); }
        }
        if (snapshot === null) return refuse();
      } else {
        // ── 2. EXISTENCE — before ownership, so the read cannot CREATE ──────
        // Error discipline is the INVERSE of turn-stop's fail-open: a Stop
        // fails open because a DB blip must not cost a user their Stop, and the
        // worst case is a spurious tombstone. Here the worst case is serving or
        // fabricating someone's decision graph, so a thrown read fails CLOSED
        // and says 503 — it never degrades into 404 or into an empty graph.
        //
        // ⚠ A MISSING `scenarioExists` FAILS CLOSED, and this is the one place
        //   this route deliberately diverges from turn-stop.ts's structural
        //   probe. `scenarioExists` is OPTIONAL on the SessionStore interface.
        //   turn-stop can skip it when absent, because skipping only costs it a
        //   hardening check. Skipping it HERE would fall straight through to the
        //   ownership pre-flight — the call that UPSERTS — so "I could not check
        //   whether this scenario exists" would become "create it and read it".
        //   Defaulting to `true` (assume it exists) is exactly the dangerous
        //   direction, and it would make the invariant this route advertises
        //   ("a read never creates the row it reads") conditional on a store
        //   shape rather than structural. An unverifiable precondition is
        //   refused, not assumed.
        let exists: boolean;
        try {
          if (typeof store.scenarioExists !== "function") {
            log.error(
              {
                event: "v5.scenario_graph.existence_check_unavailable",
                request_id: requestId,
              },
              "Scenario graph read — store cannot check scenario existence; refusing rather than risking a create-on-read",
            );
            return unavailable();
          }
          exists = await store.scenarioExists(scenarioId);
        } catch (err) {
          log.warn(
            {
              event: "v5.scenario_graph.existence_read_failed",
              request_id: requestId,
              scenario_id: scenarioId,
              err: err instanceof Error ? err.message : String(err),
            },
            "Scenario graph read — existence read failed; failing closed",
          );
          return unavailable();
        }
        if (!exists) {
          return refuse();
        }


      }

      // ── 4. The read ─────────────────────────────────────────────────────
      let graph: unknown;
      let briefText: string | null;
      let revision: number | undefined;
      try {
        const loaded = snapshot ?? await store.loadGraphAndBriefText(scenarioId);
        graph = loaded.graph;
        briefText = loaded.briefText;
        revision = loaded.revision;
      } catch (err) {
        log.warn(
          {
            event: "v5.scenario_graph.read_failed",
            request_id: requestId,
            scenario_id: scenarioId,
            err: err instanceof Error ? err.message : String(err),
          },
          "Scenario graph read — graph read failed; failing closed",
        );
        return unavailable();
      }

      if (typeof store.readMostRecentPendingActions !== 'function') return unavailable();
      let scopeInput: ReturnType<typeof goalScopeClaimInput>;
      let latestPending: readonly PendingAction[];
      try {
        latestPending = await store.readMostRecentPendingActions(scenarioId, { validation: 'strict' });
        scopeInput = goalScopeClaimInput(latestPending, graph);
      } catch { return unavailable(); }
      const scopeIssues = scopeInput.issues;

      // An EMPTY graph is a valid answer, not an error: every scenario starts
      // there, and 404-ing it would make "no graph yet" indistinguishable from
      // "not yours" — collapsing the very distinction the UI needs.
      const graphPresent = graph !== null && graph !== undefined;

      // ── 5. THE ADDITIVE ANALYSIS PAYLOAD (ROADMAP 2.1271) ───────────────
      //
      // ADDITIVE BY CONSTRUCTION. Two new keys, both nullable; not one existing
      // key is rewritten, reordered or conditioned on them. A client that has
      // never heard of them sees a byte-identical body — asserted against a
      // capture taken on the PR BASE, not against a fixture this lane wrote
      // (`__tests__/scenario-graph-analysis-additive.test.ts`).
      //
      // WHY IT BELONGS ON THIS ROUTE RATHER THAN A NEW ONE. The security ladder
      // above — identity → UUID → existence-before-ownership → ownership
      // pre-flight → per-IP limiter — is 120 lines of hard-won reasoning, and a
      // dedicated `/assist/v1/scenarios/:id/analysis` would need every line of
      // it a second time. Same route, same ownership check, same limiter, same
      // scenario's own data: the caller entitled to read this graph is exactly
      // the caller entitled to read the analysis OF that graph.
      //
      // It reads the SAME graph object this response returns, so the freshness
      // verdict cannot describe a different model than the one being delivered.
      // Never throws; on any failure both keys are `null` and the graph stands.
      const analysis = await readScenarioAnalysis({
        scenarioId,
        graph: graphPresent ? graph : null,
        requestId,
        goalScopeClaimInput: scopeInput,
        revision,
        ...(snapshot !== undefined && snapshot !== null ? { analysisInvalidatedAt: snapshot.analysisInvalidatedAt } : {}),
      });
      // The selected block already has one public carrier, `analysis_result`.
      // The current-read sidecar exposes its bounded identity and typed figures
      // without a second copy of raw enrichment/probability fields.
      const { result: _selectedBlock, ...currentReadWire } = analysis.current_read;
      // Compatibility projection reads the common canonical claim, never the
      // issue count. The pending actions remain explanatory data only.
      const scopePermissions = claimPermissionsFrom(analysis.analysis_state, undefined);

      // ── 6. THE CONVERSATION, OPT-IN (DL lease #75 5907582591; Canvas 5907308286) ──
      //
      // "The chat survives a reload": CEE stores every turn's text in
      // `v5_conversation_turns` but served no read of it, so a fresh browser or a
      // second device opened on an empty chat. It rides THIS route for the reason
      // §5 gives: the caller entitled to read the graph is exactly the caller
      // entitled to read its conversation, and the ladder above is not written twice.
      //
      // OPT-IN, because the Agent reads this route internally on every turn
      // (`turnReadCache`): without `include_conversation_turns: true` the body is
      // byte-identical and no extra query runs. The stored `assistant_message` is the
      // POST-WIRE text the user saw (AIQ 5907360564). Its narration passes the
      // same current-Run estimate attribution gate as live replies and retries;
      // other stored bytes remain intact. `null` = this leg did not answer, never "no conversation".
      //
      // ⚠ A VIEWER MEMBER GETS THE MODEL AND THE RUN, NEVER THE OWNER'S CONVERSATION. The premise above ("the caller
      // entitled to read the graph is exactly the caller entitled to read its conversation") holds for the owner and
      // a guest row. A colleague the owner shared the decision with was given the decision, not the owner's chat
      // with Olumi. So a member read leaves the field out, exactly as if it had not been asked for.
      const conversationRequested = wantsConversationTurns(req.body) && !memberRead;
      const conversationRead = conversationRequested
        ? await readConversationTurns(store, scenarioId, requestId, {
          userId: req.scenarioAccess?.callerUserId ?? null,
          // EXACTLY the graph_hash the Agent turn reads from this route, not identity.v1's different projection.
          graphHash: (graphPresent ? computeAnalysisAffectingGraphHash(graph as GraphStateIngress) : null) ?? undefined,
          latest: latestPending,
          analysisState: analysis.analysis_state,
          analysisResult: analysis.analysis_result,
          analysisReady: analysis.current_read.analysis_ready,
          graph: graphPresent ? graph : null,
          modelExists: graphPresent && typeof graph === 'object'
            && ['nodes', 'edges'].some(key => Array.isArray((graph as Record<string, unknown>)[key])
              && ((graph as Record<string, unknown>)[key] as unknown[]).length > 0),
        }) : undefined;
      const conversationTurns = conversationRead === undefined ? undefined : conversationRead?.turns ?? null;
      const heldOffers = conversationRead?.heldOffers;
      /**
       * ⭐ S-B: THE ACTION BAR ON RELOAD (github-a2 contract amendment 9: reload by re-derivation). The same pure function the
       * live turn uses (`actionBarOf(actionFactsOf(…))`), over this read's own fields and the persisted guidance history, so
       * an unchanged state reloads the bar the last answer carried, byte for byte, and a changed state reloads the bar it
       * now earns. Only on the reload that restores the conversation (a viewer member's read carries none). A failed
       * history read ranks with no cooldown; a failed ranking carries no bar and never costs the read.
       */
      let actionBar: ActionBarV1 | undefined;
      if (conversationRequested) {
        let guidance: GuidanceState | null = null;
        try { guidance = typeof store.readGuidanceHistory === 'function' ? await store.readGuidanceHistory(scenarioId) : null; } catch { guidance = null; }
        try {
          const evaluated = readEvaluatedIdentityNodeIds(analysis.analysis_identity_evaluated_node_ids);
          actionBar = actionBarOf(actionFactsOf({
            scenarioId, graph: graphPresent ? graph : null,
            ...(graphPresent ? { graphHash: computeAnalysisAffectingGraphHash(graph as GraphStateIngress) ?? undefined } : {}),
            analysisState: analysis.analysis_state, analysisReady: analysis.current_read.analysis_ready, analysisResult: analysis.analysis_result,
            optionParticipation: analysis.analysis_option_participation, ...(evaluated !== undefined ? { identityEvaluated: evaluated } : {}), guidance, pending: latestPending,
          }));
        } catch { actionBar = undefined; }
      }
      /**
       * ⭐ S-D RELOAD (lane EDIT-PANEL; design §4): the proposals still held, with what each assumes and its exact card,
       * so a reload keeps them editable and approvable. The SAME projection the Agent turn sends (`_proposal_fields`),
       * from the latest row's holds read above, pinned to THIS graph's hash. Opt-in with the conversation, so the
       * Agent's own internal reads stay byte-identical.
       */
      const heldProposalRecords = conversationRequested && graphPresent
        ? latestPending.flatMap((pa) => { const r = proposalRecord(pa, graph); return r === undefined ? [] : [r]; }) : [];
      const proposalRows = conversationRead?.proposalRows ?? [];
      const issuedTurnIds = await issuedTurnIdsForProposalRecords(proposalIssuances(heldProposalRecords, latestPending), proposalRows, CONVERSATION_ROWS_READ,
        typeof store.readCommittedTurn === 'function' ? turnId => store.readCommittedTurn!(scenarioId, turnId) : undefined);
      const proposalFields = conversationRequested && graphPresent
        ? proposalFieldsWire(heldProposalRecords, computeAnalysisAffectingGraphHash(graph as GraphStateIngress) ?? undefined, issuedTurnIds)
        : undefined;

      /**
       * ⭐ P48 (audit #27): what changed in the model since the last Run, by id, so the canvas marks it until the next
       * Run and a reload keeps the marks. Recomputed from the durable receipts (`context/changed-since-run.ts`). Opt-in
       * with the conversation, so the Agent's own internal reads stay byte-identical; absent = could not answer.
       */
      const changedSinceRun = conversationRequested && graphPresent ? await readChangedSinceRun(store, scenarioId,
        // The Run's own projection (CS-AN-2): the raw-bytes hash never equals `graph_hash_at_run` on a promoted graph.
        deriveDecisionContextGraphHash(graph)) : undefined;

      return reply.code(200).send({
        schema: SCENARIO_GRAPH_SCHEMA,
        ...(heldOffers !== undefined && heldOffers.length > 0 ? { held_proposal_offers: heldOffers } : {}),
        ...(proposalFields !== undefined ? { proposal_fields: proposalFields } : {}),
        ...(changedSinceRun !== undefined ? { changed_since_run: changedSinceRun } : {}),
        scenario_id: scenarioId,
        graph: graphPresent ? graph : null,
        graph_present: graphPresent,
        brief_text: briefText,
        // identity.v1, from the single normaliser authority. Null when the
        // graph is absent or identity-empty — there is no identity to anchor
        // to, and a hash of nothing would be a false anchor.
        graph_identity_hash: graphPresent
          ? computeGraphIdentityHash(graph as GraphStateIngress)
          : null,
        // ⭐⭐ THE WRITE PRECONDITION FOR THE GRAPH THIS RESPONSE CARRIES.
        //
        // A manual edit is a compare-and-set: `option_intervention_edit` (and its
        // siblings) send a base hash, and the writer refuses unless
        // `computeAnalysisAffectingGraphHash(persistedGraph)` equals it. Until
        // now that base reached a client ONLY on a turn response, so a RELOAD —
        // which restores the graph without any turn — left the client with no
        // base and every first edit refused as `needs_fresh_base`. Root hit
        // exactly that natively: a restored scenario, a mounted editor, and a
        // Save that honestly sent nothing. The refusal was correct; the missing
        // precondition was the defect.
        //
        // ⚠⚠ IT IS NOT `graph_identity_hash`, AND THE TWO MUST NEVER BE
        // SUBSTITUTED. identity.v1 answers "is this the same graph object?" over
        // a normalised projection; this answers "may a write be applied to the
        // graph as the analysis sees it?". They differ in projection, in width
        // and in purpose — and on an UNCHANGED graph a wrong choice still
        // matches, so the mistake would surface only once someone edited.
        //
        // ⚠ DERIVED HERE, FROM THE VERY BYTES THIS RESPONSE CARRIES — the same
        // discipline `graph_identity_hash`, `layout_present` and `not_modelled`
        // already follow, and for the same reason: a value taken from anywhere
        // else is a hand-maintained mirror that starts lying the moment the
        // graph moves. It is deliberately NOT threaded out of
        // `readScenarioAnalysis`, and that helper does NOT compute this hash:
        // its freshness comparison uses the CANONICAL analysis hash
        // (`deriveDecisionContextGraphHash` — the projection a run stamps
        // `graph_hash_at_run` over), while this wire `graph_hash` stays the RAW
        // hash of the bytes returned here, the compare-and-set base the writers
        // derive from the persisted graph. The two agree on a graph already in
        // canonical shape and differ only on repaired-shape graphs (CS-AN-2).
        // The helper also answers "not answered" for a graph with no analysis
        // and swallows its own failures, so the write base would inherit an
        // unrelated precondition and vanish exactly when a never-analysed
        // scenario is the one being edited.
        //
        // ⚠ THE SAME KEY THE TURN RESPONSE USES, deliberately. `applyV5State`
        // already stamps `store.lastServerGraphHash` from a turn's top-level
        // `graph_hash`; one concept keeps one name across both carriers, and the
        // client adopts it by the same rule rather than learning a second one.
        //
        // `null` when the graph is absent — there is nothing to write against,
        // and a hash of nothing would be a base that matches nothing.
        graph_hash: graphPresent
          ? computeAnalysisAffectingGraphHash(graph as GraphStateIngress)
          : null,
        layout_present: detectLayout(graphPresent ? graph : null),
        // ROADMAP 2.973 — what of the brief did NOT reach the model.
        //
        // DERIVED HERE, from the very bytes this response carries, for the same
        // reason `layout_present` is: a snapshot taken at draft time is a
        // hand-maintained mirror that starts lying the moment the user edits the
        // graph, whereas a re-derivation cannot disagree with what it was
        // computed from. It is a pure function of (brief_text, graph) — no I/O,
        // no clock — so it costs one pass over bytes already in memory.
        //
        // ⚠ WHEN IT CANNOT LOOK IT SAYS SO. Absent brief or absent graph yields
        // `status: "unavailable"` with `quantities: null`, never a zero tally:
        // on a scenario we know nothing about, "0 dropped" would be a new lie
        // carrying the authority of a measurement.
        not_modelled: deriveNotModelledManifest(
          briefText,
          graphPresent ? graph : null,
        ),
        // ROADMAP 2.1271 — see §5 above. `null` on either means "this leg did
        // not answer", never a state: a consumer must leave what it already
        // believed standing, and in particular must NOT read a null or a
        // `never_run` here as evidence against an in-flight run the DRAFT TURN
        // told it about (the H4 seam — the two authorities answer different
        // questions).
        analysis_state: analysis.analysis_state,
        ...(scopeIssues.length > 0 ? { goal_scope_reconciliation: scopeIssues } : {}),
        ...(scopePermissions.total_goal_claims_allowed === false ? {
          goal_scope_claim_permissions: { total_goal_claims_allowed: false, exploratory_work_allowed: true },
        } : {}),
        analysis_result: analysis.analysis_result,
        canonical_analysis_view: analysis.canonical_analysis_view,
        ...(analysis.run_recording === undefined ? {} : { run_recording: analysis.run_recording }),
        // CURRENT-READ-v1: one selected Run's canonical freshness and typed
        // figures. The raw graph_hash above remains the edit/CAS token; the
        // projection's hashes are the analysis selector's separate domain.
        current_read: currentReadWire,
        // The selected fact's own constraint verdict state — present exactly when
        // `analysis_result` is (same fact, same gate). See `ScenarioAnalysisRead`.
        ...(analysis.analysis_constraint_verdict_state !== undefined
          ? { analysis_constraint_verdict_state: analysis.analysis_constraint_verdict_state }
          : {}),
        // The selected fact's leader-limit risks — same fact, same gates as the state above.
        ...(analysis.analysis_leader_limit_risks !== undefined
          ? { analysis_leader_limit_risks: analysis.analysis_leader_limit_risks }
          : {}),
        // B5: the selected fact's per-limit rows — same fact, same gates; absent when it attests none.
        ...(analysis.analysis_limit_verdicts !== undefined
          ? { analysis_limit_verdicts: analysis.analysis_limit_verdicts }
          : {}),
        // 0.63.0: the selected fact's own goal certainty — same fact, same gates; absent = not recorded.
        ...(analysis.analysis_goal_certainty !== undefined
          ? { analysis_goal_certainty: analysis.analysis_goal_certainty }
          : {}),
        // 52f8cd: the Olumi options the selected Run left out of the comparison, and why — same fact, same gates.
        ...(analysis.analysis_option_participation !== undefined
          ? { analysis_option_participation: analysis.analysis_option_participation }
          : {}),
        ...(analysis.analysis_run_option_set !== undefined
          ? { analysis_run_option_set: analysis.analysis_run_option_set }
          : {}),
        // C46 × R3-4: the carriers the selected fact's engine evaluated — same fact, same gates; absent when it records none.
        ...(analysis.analysis_identity_evaluated_node_ids !== undefined
          ? { analysis_identity_evaluated_node_ids: analysis.analysis_identity_evaluated_node_ids }
          : {}),
        // R3-9 (#2248): the last successful Run's use of each declared identity — the link writer's own input, not gated.
        ...(analysis.analysis_identity_run_use !== undefined
          ? { analysis_identity_run_use: analysis.analysis_identity_run_use }
          : {}),
        /**
         * ⭐ MAY A RUN BE ADMITTED RIGHT NOW — the question `analysis_state`
         * does not answer. It reports whether a FACT HAS LANDED for this graph;
         * this reports whether one COULD BE STARTED, and what stands in the way.
         * Without it a reload can only learn admissibility by taking a turn.
         *
         * Machine codes only — every user-facing string is dropped in the
         * projection, because this route ships no enforceable prose. `null` when
         * there is no graph to judge: "this leg did not answer", never a state.
         */
        analysis_admission: projectAnalysisAdmission(graph, graphPresent),
        ...(conversationTurns !== undefined ? { conversation_turns: conversationTurns } : {}),
        ...(actionBar !== undefined ? { action_bar: actionBar } : {}),
        request_id: requestId,
      });
    },
  );
}
