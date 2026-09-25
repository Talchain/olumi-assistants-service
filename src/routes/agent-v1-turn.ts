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

import { withRunStateFreshness } from '../orchestrator-v5/agent-lane/analysis-ready-freshness.js';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/index.js';
import { OPENAI_ONLY, assertProviderAllowed, providerLedgerTruncated, recordProviderUsage, recordedProviderCalls, runWithProviderPolicy } from '../adapters/llm/provider-policy.js';
import { TURN_RESPONSE_HEADROOM_MS } from '../config/timeouts.js';
import { getSessionStore } from '../orchestrator-v5/session/index.js';
import type { CommittedTurnRecord } from '../orchestrator-v5/session/store.js';
import { appendCheckedGraphWrite } from '../orchestrator-v5/persist-graph-write.js';
import { scenarioAccessDecision } from '../orchestrator-v5/agent-lane/scenario-access.js';
import { collectTurnReceipts } from '../orchestrator-v5/agent-lane/turn-receipts.js';
import { withCurrentGraphHash } from '../orchestrator-v5/agent-lane/analysis-freshness-stamp.js';
import { BOARD_EDIT_PREFIX, HistoryStore, historyFromDurableTurns, needsDurableSeed } from '../orchestrator-v5/agent-lane/history-store.js';
import { internalHeaders } from '../orchestrator-v5/agent-lane/internal-headers.js';
import { resolveUserIdentity } from '../orchestrator/user-identity.js';
import { log } from '../utils/telemetry.js';
import { composeDirectAnswerResponse } from '../orchestrator-v5/compose.js';
import { finaliseV5Response } from '../orchestrator-v5/response-finaliser.js';
import { runAgentTurn, WITHHELD_ON_CHIP_TURN, type AgentTurnResult, type CallModel } from '../orchestrator-v5/agent-lane/runtime/agent-loop.js';
import type { AgentLaneMode } from '../orchestrator-v5/agent-lane/runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import type { CallStructuredModel } from '../orchestrator-v5/agent-lane/runtime/build-model.js';
import { onceMoreOnTransportFailure } from '../orchestrator-v5/agent-lane/runtime/transport-retry.js';
import { ProposalStore } from '../orchestrator-v5/agent-lane/proposal.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../orchestrator/tools/analysis-ready-helper.js';
import { SessionBindingRegistry } from '../orchestrator-v5/agent-lane/session-binding.js';
import { budgetFor } from '../orchestrator-v5/agent-lane/model-budgets.js';
import { narrateWriteOutcome, notAdoptedLine, withWriteOutcome } from '../orchestrator-v5/agent-lane/write-outcome.js';
import { disclosuresFor, valueChangeDisclosures, withDisclosures } from '../orchestrator-v5/agent-lane/disclosure.js';
import { collectTurnStateFacts } from '../orchestrator-v5/agent-lane/turn-state-facts.js';
import { withoutProposalIds } from '../orchestrator-v5/agent-lane/display-ids.js';
import { AMEND_CHIP, approvalChipsFor, typedApprovalOf } from '../orchestrator-v5/agent-lane/approval-chips.js';
import { CarriedProposals, carrierForAnswerRow, offeredApproveChipOnRow, rehydrateProposals } from '../orchestrator-v5/agent-lane/durable-proposal.js';
import type { SuggestedAction } from '../orchestrator-v5/compose/types.js';
import { derivePendingActionsFromFinalizedChips } from '../orchestrator-v5/compose/derive-pending-actions.js';
import { isPendingActionExpired } from '../orchestrator-v5/session/pending-action.js';
import { dispatchTool } from '../orchestrator-v5/agent-lane/runtime/agent-tools.js';
import { buildAppliedGraphWireField } from '../orchestrator-v5/compose/applied-graph-emit.js';
import { enforceAgentLaneLeaderClaimsAtWire } from '../orchestrator-v5/agent-lane/withheld-leader-fail-closed.js';
import { sanitiseOlumiResponseForEgress } from '../orchestrator-v5/compose/output-safety.js';
import { runTurnCoaching, type CapturedAnalysis } from '../orchestrator-v5/agent-lane/analysis-coaching-pass-through.js';
import {
  bindRunBlocksToReadback,
  firstAnalysisDeadline,
  firstAnalysisSentence,
  runFirstAnalysisAfterConstruction,
  type FirstAnalysisOutcome,
} from '../orchestrator-v5/agent-lane/first-analysis.js';
import { GraphV3, type GraphV3T } from '../schemas/cee-v3.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';

/** The egress sanitiser resolves labels against a PARSED graph; an unparseable read gives it none. */
function parsedGraphOrNull(raw: unknown): GraphV3T | null {
  if (raw === undefined || raw === null) return null;
  const parsed = GraphV3.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

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
/** The approval carrier each scenario and subject's latest answer row persisted — see `carrierForAnswerRow`. */
const carriedProposals = new CarriedProposals();

type OfferedAction = SuggestedAction;
/**
 * ⛔ A REPLAY RE-OFFERS THE ORIGINAL TYPED ACTIONS, RE-VALIDATED ON TODAY'S STATE (independent
 * review of #1792, 5806213240). The durable row keeps the words only, so a retry of the same
 * `turn_id` after a lost response answered with no Run and no approve control — at exactly the
 * moment a replay matters. What a turn offered is remembered here, per scenario and turn, and a
 * replay offers only what is STILL true: an approve chip whose proposal is still outstanding, and
 * the Run offer only when today's canonical readiness admits a run and no current analysis exists.
 * Nothing is inferred from the words.
 *
 * ⚠ TWO CARRIERS, BECAUSE THE TWO CHIPS HAVE DIFFERENT LIFETIMES (Codex 5806428423). An approve
 * chip names a proposal that lives in THIS process (`ProposalStore`), so it is remembered here and
 * fails closed after a restart. The Run offer does not depend on any proposal once the approval has
 * landed, so it is ALSO persisted durably, as the same `run_analysis` pending action a conventional
 * Run chip persists, atomically with the answer row, and re-read from that exact row on replay
 * (bounded by the pending action's own 10-minute lifetime). Neither is ever reconstructed from
 * present readiness alone: a Run is re-offered only if the ORIGINAL turn offered it.
 */
const OFFERED_ACTIONS_MAX = 500;
const offeredActions = new Map<string, readonly OfferedAction[]>();
function rememberOffered(key: string, actions: readonly OfferedAction[]): void {
  offeredActions.delete(key);
  if (offeredActions.size >= OFFERED_ACTIONS_MAX) {
    const oldest = offeredActions.keys().next().value;
    if (oldest !== undefined) offeredActions.delete(oldest);
  }
  offeredActions.set(key, actions);
}

/**
 * ⛔ PRESSING RUN MUST NOT DELETE THE WAY TO APPROVE WHAT IS STILL WAITING (Technical Architecture, #63
 * 5808759682, served `4fd2703`): a fresh brief offered approve AND Run; the Run turn's chips were derived
 * from its own tool calls, `run_analysis` carries no proposal, so the approve chip vanished beside a
 * provisional answer it would have grounded. The approve chip last offered per scenario and subject is
 * remembered here, and a Run turn carries it forward only while the store would still execute it.
 */
const LAST_APPROVE_MAX = 500;
const lastApproveOffer = new Map<string, OfferedAction>();
function rememberApprove(key: string, offered: readonly OfferedAction[]): void {
  const approve = offered.find((a) => typedApprovalOf({ chip: { id: a.id } }) !== undefined);
  if (approve === undefined) return;
  lastApproveOffer.delete(key);
  if (lastApproveOffer.size >= LAST_APPROVE_MAX) {
    const oldest = lastApproveOffer.keys().next().value;
    if (oldest !== undefined) lastApproveOffer.delete(oldest);
  }
  lastApproveOffer.set(key, approve);
}

/**
 * THE ONE PREDICATE for "may an approve chip be shown now": the ONE proposal still awaiting a yes for this
 * subject, when the store would EXECUTE it on the revision read back this turn — else nothing (a missing
 * readback fails closed). Used by the fresh Run carry AND by every replay (Codex #1807 5810816841: a
 * replay checked only id membership, so after the model moved a retried Run showed a chip that could not
 * commit).
 */
function executableWaitingProposal(scenarioId: string, userId: string | null, graphHash: string | undefined): string | undefined {
  if (graphHash === undefined) return undefined;
  const waiting = proposals.outstanding(scenarioId, userId);
  if (waiting.length !== 1) return undefined;
  const id = waiting[0]!.proposal_id;
  const decision = proposals.authorise({ proposal_id: id, scenario_id: scenarioId, authenticated_user_id: userId, current_graph_identity_hash: graphHash });
  return decision.status === 'execute' ? id : undefined;
}

/** The originally offered actions that are still valid on the CURRENT state, in their original order. */
export function stillValidOffers(
  offered: readonly OfferedAction[],
  now: { outstandingProposalIds: ReadonlySet<string>; analysisReady: unknown; analysisState: unknown; modelExists: boolean },
): OfferedAction[] {
  const approvals = offered.filter((a) => {
    const id = typedApprovalOf({ chip: { id: a.id } });
    return id !== undefined && now.outstandingProposalIds.has(id);
  });
  const runKind = (now.analysisState as { run_state?: { kind?: unknown } } | undefined)?.run_state?.kind;
  const run = offered.some((a) => a.id === RUN_OFFER_CHIP.id)
    && admitsRunOffer(now.analysisReady) && runKind !== 'complete_current';
  // The next step after a blocked Run stays offered while the model is KNOWN not to run (process-local,
  // like the approve chip: after a restart the replay carries the words only). A replay whose state read
  // failed is unknown, and an unknown state is never re-advertised as a refusal (#1885 pre-review 5827131835).
  const nextStep = offered.some((a) => a.id === NEXT_STEP_AFTER_BLOCKED_RUN_CHIP.id) && knownNotRunnable(now.analysisReady);
  // A rebuild stays offered only while there is still no model to build over.
  const rebuild = offered.some((a) => a.id === REBUILD_AFTER_TOO_LARGE_CHIP.id) && !now.modelExists;
  return [...approvals, ...(approvals.length > 0 ? [AMEND_CHIP] : []), ...(run ? [RUN_OFFER_CHIP] : []), ...(nextStep ? [NEXT_STEP_AFTER_BLOCKED_RUN_CHIP] : []), ...(rebuild ? [REBUILD_AFTER_TOO_LARGE_CHIP] : [])];
}
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

/** Marks a board edit in the Agent's history — defined beside `needsDurableSeed`, which must recognise it. */
export { BOARD_EDIT_PREFIX } from '../orchestrator-v5/agent-lane/history-store.js';

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
  'Olumi states beneath your reply whether authorise_change saved, refused or had already applied a change, and which version it became, so do not restate that yourself. If it returns `already_applied`, do not offer to apply it again; if it refused, say only what you will do next.',
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
   * ⭐ OLUMI RUNS THE FIRST ANALYSIS ITSELF, ONCE (Paul, 5812069638). This replaced "After
   * build_model_from_brief, do NOT call run_analysis on the same turn", measured at 99.9 s for a
   * first turn that built AND analysed through a second tool hop. The run now happens inside the
   * build call, in-process, only when the admission would run the new model, and only if the turn
   * still has time for it — so the Agent narrates it on the SAME hop, with no extra model call. The
   * Agent never runs it itself: the build result's `first_analysis` says what happened.
   */
  'After build_model_from_brief, never call run_analysis on the same turn: Olumi runs the first analysis itself when the new model can be analysed, and the build result\u2019s `first_analysis` says what happened. Follow its `note`: when it ran, or already exists, describe it as a provisional first pass that nobody has validated yet \u2014 something to argue with, not an answer \u2014 and when you mention a figure, say from its provenance whether it comes from the user or is Olumi\u2019s estimate, or that its source is not recorded; never call a figure the user gave, or a measured one, an estimate. When it did not run, describe no result: Olumi tells the user why beneath your reply, so describe the model and what it still needs.',
  /*
   * ⭐ ONE APPROVAL TO A FIRST COMPARISON. Measured on Paul's 22 Sep journey
   * and its replay: the model was built, then took five further turns of
   * piecemeal proposals — and two proposals offered together could never both
   * be applied from one "yes". The build turn now ends with ONE exact starting
   * point the user can adopt in a single approval.
   */
  'In that same reply, if any factor has no value or any option sets nothing, call propose_starting_point ONCE with a reasoned starting value for each such factor and the level each option sets, in the user\u2019s own units. An option in `status_quo_held` does not count: it is held at its starting values and is never given levels. Show every figure and what it rests on, say they are your assumptions to adopt or correct, and ask for one approval.',
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
   * ⛔ APPROVALS NEVER AUTO-RUN (Paul, 5812069638). This used to read "After authorise_change
   * applies values or option levels, call run_analysis in the SAME turn", which spent a compute
   * run the user never asked for and contradicted the revision rule below. A change and a Run are
   * two decisions, and the user makes both; the typed approval (fast path 2) already runs nothing.
   */
  'After authorise_change applies a change, do NOT call run_analysis in the same turn and do not promise a run: say briefly what the model still needs, if anything. Olumi states what was saved beneath your reply, and offers the Run itself when one is possible. Run the analysis only when the user asks for it.',
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
  'get_canonical_state also reports `options_that_change_nothing`. An option in that list sets no factor, so it cannot be compared and it blocks the whole analysis. Raise it when you describe the model \u2014 do not wait for the analysis to refuse \u2014 ask what that option would actually change, and record the answer with propose_option_interventions, with user_stated: true on each level the user gave. An option in `status_quo_held` is not in that list and is never given levels: say, in one short clause, that carrying on as now holds today\u2019s values, and that the user can say what would change if that is wrong. If they do, record exactly what they said with propose_option_interventions and user_stated: true on that level.',
  /*
   * ⛔ ANALYSIS IS MODEL-RELATIVE, NEVER A RECOMMENDATION (Paul, 23 Sep: "Olumi is a
   * reasoning-enhancement system, not an answer or decision engine"). Measured on
   * served replies: all 20 analysis replies carried a caveat, but 8 of 20 still
   * framed the result in "winner" / "best option" terms — often to deny one, yet
   * the vocabulary itself casts the finding as picking an answer. The useful move is the one the science supports: point at what the
   * ordering is sensitive to, and let the user change it and see how much it matters.
   */
  'When you report an analysis, describe what the CURRENT model implies given its assumptions \u2014 a finding to reason with, never a recommendation. Never call an option the winner, the best option or the recommended one. Name a leading option ONLY when the result you are reporting carries `claim_permissions.leader_may_be_named: true`; an earlier analysis read from get_canonical_state carries no such permission, so never name a leader from it. Otherwise do not name, rank or hint at one, and do not quote win percentages as a ranking, whatever else the result contains \u2014 say in plain words why no option can be put forward yet. When `leader_may_be_named` is false, the finding you lead with is why no option can be put forward \u2014 not which option the comparison favours. Do not say, even hedged or \u201con current assumptions\u201d, that any option leads, is favoured, scores or comes out highest, strongest or best, is ahead, or wins in any share of runs; describe robustness and sensitivity without saying which option they favour. When the result reports sensitivity, name the one assumption the ordering is most sensitive to, say whether it comes from the user or is Olumi\u2019s estimate (or that its source is not recorded), and offer to change it. When the result is fragile or a near tie, say that this uncertainty is itself the finding.',
  'When the user picks one of the options you suggested, or asks for one to be added, call propose_new_option with their label, the factors it would change and which way it pushes each — then authorise_change once they confirm. It adds the option and its links ONLY: say plainly that it cannot be compared until it states what it does to each factor, and offer propose_option_interventions for that. Never invent the direction; if you are not sure which way it pushes a factor, ask.',
  /*
   * \u26d4 NO AUTOMATIC RUN AFTER A REVISION (Codex 5810763729, 24 Sep). This
   * instruction used to end "after it applies, run_analysis in the same turn and
   * say what moved", which spends a compute run the user never asked for. A
   * revision and a Run are two decisions; the user makes both.
   */
  'When the user asks to change an assumption after an analysis \u2014 which is the whole point of naming the ones the ordering turns on \u2014 call propose_assumptions with `revise: true` on that factor and the number THEY gave, then authorise_change once they confirm. Show them the current value and the new one. Never set `revise` to push a figure of your own over theirs. After it applies, say, in a sentence of its own, that the earlier analysis now describes the previous model (Olumi states what was saved beneath your reply) \u2014 then STOP: do NOT call run_analysis in the same turn. Offer to re-run it and wait for them to ask.',
  /*
   * \u26d4 NEVER ASSERT AN ARTEFACT THAT NO TOOL RETURNED (RC 5811851733; measured on
   * served b53f098). On the suggest-starting-point chip the model answered "The model
   * still needs starting values for three factors. THE PENDING PROPOSAL COVERS THEM",
   * and on a second scenario "Here is the complete pending...", while `suggested_actions`
   * was EMPTY and the only tool call in the turn was `get_canonical_state`. 5 of 6 turns.
   * The user is told to approve something that was never created and has no control to do
   * it with \u2014 a remedy in copy that is not a reachable control.
   *
   * \u26a0 This is NOT claimed as the sentence that caused the missing call, and a 5/6
   * repeat is an observed failure rather than proof of determinism. It bounds the DAMAGE:
   * when the model does not call the tool, it must say so instead of inventing the result.
   */
  'NEVER say a proposal, a saved change or a pending action exists unless a tool call in THIS turn returned it. If you did not call a proposing tool, do not describe a proposal, do not say one is pending or ready, and do not ask the user to approve or confirm anything \u2014 say what the model still needs and offer to propose it. If a tool refused, say what it refused and what you will do next. Your own intention is not a result: only a tool result is.',
  'History entries that begin \u201c(Board edit\u201d are changes the user made directly on the canvas. When the user asks about \u201cmy change\u201d, start from the most recent board edit, and read the current state before explaining what it did.',
  'British English. Lead with one short sentence, then up to three short bullets when they help. Keep replies to up to about 90 words by default; go longer when the user asks (for example for ideas), or when approval figures and what they rest on, a material uncertainty, an exclusion or a failure need it. Keep any caveat that changes what the result means. Name one next move only when a tool result or the model state supports it, and ask at most one question, only when its answer would change the model. Do not repeat the model, internal calculations or a list of open questions, and do not mention a button or control unless a tool result said it exists.',
].join(' ');

/**
 * Read the persisted state back for the response: `graph_hash`, readiness and
 * the `draft_graph` the canvas draws. Shared by a live turn and a replay, so a
 * replayed answer is shown against the SAME current state a fresh one would be.
 */
/** @internal Exported for testing. */
/**
 * A message that can be a brief: typed into the composer (no product chip), and long
 * enough to describe a decision. The EMPTY-MODEL test that makes it the brief is done
 * against the persisted graph, never guessed from the words.
 */
/**
 * ⭐ THE EXPLICIT RUN, OFFERED AFTER A CHANGE THE MODEL CAN NOW ANALYSE (RC #63; Codex
 * 5805970015: "served Agent approval calls approvalChipsFor after authorise_change and that
 * helper returns no chips"). The approval fast path applies the user's values and — by design
 * — runs nothing; without this the user had no Run to press on the Agent route. The same
 * shape as the product's own Run chip (`edit-graph-dispatch.ts` RUN_ANALYSIS_CHIP), so the UI
 * echoes `{ id, action_type }` and the click takes fast path 3.
 */
/**
 * ⭐ A BLOCKED RUN OFFERS THE NEXT STEP (finding 5807064442). A typed Run keeps its turn, and its one
 * interpreting call may not call tools — so a Run pressed before the model is ready ended on Olumi's
 * reason with no action at all. This plain chip (no `action_type`: never another Run) makes the next
 * step one click: an ordinary Agent turn that proposes what the model still needs, for approval.
 */
export const NEXT_STEP_AFTER_BLOCKED_RUN_CHIP = {
  id: 'agent-suggest-what-it-needs',
  label: 'Suggest what it still needs',
  message: 'Suggest what this model still needs before the analysis can run, so I can approve it.',
} as const;

/**
 * ⭐ A FIRST BUILD REFUSED AS TOO LARGE OFFERS THE REBUILD ITS OWN REPLY NAMES (witness `g6` on served
 * `6dfb56f`: 40 links against the 30-link first-model limit; the reply said "ask me to build it again"
 * with no chip, and the same brief built 13 nodes at the first attempt on a fresh scenario). Plain text
 * (no `action_type`): the click is an ordinary Agent turn that builds from the brief again.
 */
export const REBUILD_AFTER_TOO_LARGE_CHIP = {
  id: 'agent-rebuild-model',
  label: 'Build it again',
  message: 'Build the model again from my brief.',
} as const;

export const RUN_OFFER_CHIP = {
  id: 'agent-run-analysis',
  label: 'Run analysis',
  message: 'Run analysis.',
  action_type: 'run_analysis',
} as const;

/**
 * Whether the canonical readiness in THIS response admits a run. `may_run` is the admission
 * verdict (`resolveRunAdmission(...).willProceed`) and wins whenever it is present — a `ready`
 * status with `may_run: false` is not offered. Only when it is absent does the stricter
 * `status === 'ready'` decide, as the UI's own affordance does. Nothing else is inferred.
 */
export function admitsRunOffer(analysisReady: unknown): boolean {
  const ar = (analysisReady ?? {}) as { may_run?: unknown; status?: unknown };
  return typeof ar.may_run === 'boolean' ? ar.may_run : ar.status === 'ready';
}

/**
 * A KNOWN refusal to run: the readiness was read and says no (`may_run: false`, or, when `may_run` is absent,
 * a stated status other than `ready`). NOT the negation of {@link admitsRunOffer}: a failed or empty readback is
 * unknown, and an unknown state is never presented as a refusal (#1885 pre-review, #69 5826878223).
 */
export function knownNotRunnable(analysisReady: unknown): boolean {
  if (analysisReady === null || typeof analysisReady !== 'object') return false;
  const ar = analysisReady as { may_run?: unknown; status?: unknown };
  return typeof ar.may_run === 'boolean' ? ar.may_run === false : typeof ar.status === 'string' && ar.status !== 'ready';
}

/**
 * ⭐ INTERPRETER v0.2 — THE ARCHITECTURE OWNER'S BANKED TEXT, VERBATIM (RC #63 5803995225:
 * "Interpreter v0.2 is the current prompt candidate"). Source: Talchain/olumi-programme-docs
 * `openai/capability-v01/ANALYSIS_INTERPRETER_PROFILE_v0_2.md` lines 9-33, blob
 * 344896ef92177b7308c1d632699bd98bae10c6b7 (programme-docs main 4961b2d1); sha256 of this
 * string begins 3d979e8406693be4 (pinned by test). APPENDED to the Agent instructions on
 * fast path 3's single interpreting call, as the profile specifies ("appended only for the
 * existing Agent final-response path when explaining canonical analysis. No extra model
 * call."). Prompt text is owned by Paul + ChatGPT; this file only carries it. When CEE #1787
 * (the packaged profile) lands, this constant is replaced by its import.
 */
/**
 * ⛔ THE INTERPRETING CALL CAN ONLY EXPLAIN (finding 8 on #1786, 5807230197). It receives the whole
 * Agent instruction block — which tells the Agent to call tools and make proposals — on a call that
 * may not act, so it could promise a proposal it cannot make. This route-authored line, placed
 * BEFORE the banked Interpreter v0.2 text (which stays last and byte-identical), says so plainly.
 */
export const INTERPRET_ONLY_CONSTRAINT =
  'IN THIS REPLY you are explaining a result only. You cannot call tools, change the model or create a proposal, '
  + 'so never promise one or describe one as made. If the analysis did not run, say in plain words what it still '
  + 'needs; the user can ask you to suggest it.';

export const INTERPRETER_V02_BANKED: string = "Explain the current **model-relative** analysis. Do not make the user's decision.\n\n**Finding first.** State the most useful conclusion supported by the supplied analysis, then briefly: why it appears, what is not settled, and at most one next reasoning step when justified.\n\n### Hard grounding rules\n\n- Use only supplied canonical analysis, provenance, currentness and claim permissions. Unknown stays unknown.\n- Keep comparison/outcomes, sensitivity, robustness, constraint satisfaction, before/after deltas and evidence provenance as different meanings. Never substitute one for another.\n- Never call an option objectively best, the winner, the right decision or Olumi's recommendation merely because it leads in the model.\n- Never convert a point result into a probability or invert a local switch/perturbation probability into overall stability.\n- Never claim an edit was tested unless the analysed revision/inputs include it.\n- Identical analytical inputs producing the same result show repeatability under those settings, **not** new validation or increased confidence.\n- A changed input may produce no material output change. Report that without inventing an effect.\n- For before/after comparisons, use only **precomputed supplied deltas**. Do not calculate new differences, ratios, annualisations, margins or unit conversions in prose.\n- Attribute a delta to one edit only when the supplied comparison is explicitly compatible and the relevant units, option identities, analysis/projection semantics and engine settings are held constant. Otherwise say the isolated effect is not established.\n- Preserve exact constraint operators and units. Equality does not satisfy a strict `<` or `>` condition.\n- If only a subset of options was analysed, keep conclusions inside that subset and name exclusions.\n- If the result is stale, present it only as historical. If rerun/action eligibility is unknown, do not imply a current control is available; say a current analysis would be needed.\n- If sensitivity or a flip threshold was not computed, do not invent it.\n- **A first-tested assumption that flips an ordering establishes only that this tested change can flip that ordering. It does NOT establish validation priority, importance, largest effect or best next investigation. Never say \"validate X first\" or equivalent on that basis alone.** If comparable effect size, uncertainty and evidence cost/value are absent, say investigation priority is not established.\n- One edge's perturbation/switch metric is not aggregate stability or factor sensitivity.\n- If a method is declined or applicability is unknown, answer the user's question without starting or completing the method.\n- Do not invent exercise horizons, required counts, missing business dimensions, benchmarks, operating assumptions or retrospective rationales.\n\nKeep the response compact: finding first, then 1–3 grounded points/caveats. Do not force a next step.\n";

/** The UI's Run control: a typed `run_analysis` chip. Words alone never take fast path 3. */
/**
 * What the user reads when the run was ATTEMPTED but its one interpreting call failed or said
 * nothing: composed from the run's own DOMAIN outcome, never from a model.
 *
 * ⛔ `ok` is the HTTP status of the attempt, NOT a completed analysis (independent review of
 * #1786, 5805649773): a blocked Run answers HTTP 200 with no `analysis_result`, so `ok:true`
 * would have told that user "the analysis ran". `ran` is the presence of a result; when it
 * is absent, Olumi's own explanation (`what_is_missing`) is passed through, not re-worded.
 * No visibility claim is made about results the reply does not carry. Copy: Experience Design
 * (#63 5806021014).
 */
export function interpretationUnavailableText(ran: { ok?: unknown; ran?: unknown; refusal?: unknown; status?: unknown; what_is_missing?: unknown }): string {
  if (ran.ran === true) {
    return 'The analysis finished, but I couldn’t explain it this time. You can ask me to explain the result.';
  }
  const missing = typeof ran.what_is_missing === 'string' ? ran.what_is_missing.trim() : '';
  if (missing !== '') return `The analysis didn’t run. ${missing}`;
  const code = typeof ran.refusal === 'string' && ran.refusal !== ''
    ? ran.refusal
    : typeof ran.status === 'string' && ran.status !== '' && ran.status !== 'unknown' ? ran.status : '';
  const why = code !== '' ? ` (${code.replace(/_/g, ' ')})` : '';
  return `The analysis didn’t run this time${why}. Nothing in the model was changed — ask me what it still needs.`;
}

export function typedRunOf(body: Record<string, unknown>): boolean {
  const chip = body['chip'] as { action_type?: unknown; id?: unknown } | null | undefined;
  // The Agent's own Run offer is recognised by its id too, in case a client echoes only the id.
  return (body['kind'] === undefined || body['kind'] === 'message') && (chip?.action_type === 'run_analysis' || chip?.id === RUN_OFFER_CHIP.id);
}

/**
 * ⛔ A SUGGESTION-BUTTON CLICK CARRIES NO CONSENT TO WRITE OR TO RUN (RC #63 5819467504 §2).
 * A chip-initiated message whose chip is neither the typed approval nor the typed Run (a coaching
 * card's action, a next-step chip) reaches the Agent loop without `authorise_change` or
 * `run_analysis`: an approval has its own chip, and a Run has its own control. Measured before this
 * guard (#63 5819380376): a surprise Run, a same-turn propose-and-authorise, and an earlier turn's
 * proposal authorised, each on one click. Composer messages are untouched.
 */
export const CHIP_TURN_WITHHELD_TOOLS: readonly string[] = ['authorise_change', 'run_analysis'];
export function withheldToolsOf(body: Record<string, unknown>): readonly string[] {
  const chip = body['chip'];
  if (chip === null || typeof chip !== 'object') return [];
  return typedApprovalOf(body) === undefined && !typedRunOf(body) ? CHIP_TURN_WITHHELD_TOOLS : [];
}

export async function readBackState(dispatch: InternalDispatch, scenarioId: string): Promise<{ graphHash?: string; analysisReady?: unknown; draftGraph?: unknown; analysisState?: unknown; analysisResult?: unknown; graph?: unknown }> {
  let graphHash: string | undefined;
  let analysisReady: unknown;
  /**
   * ⛔ THE SCENARIO'S OWN `analysis_state`, not the finaliser's no-context verdict
   * (preflight UI-contract audit, verified). This route finalises with
   * `{ scenarioId }` only, so the finaliser stamps what is true of a turn with no
   * analysis context — `unknown_degraded` / `no_graph_this_turn`, leader withheld —
   * and the UI treats `analysis_state` as the wire authority: a result that had just
   * run read "Results may be outdated" and its leading option was withheld, on every
   * Agent turn. The graph read carries the scenario-bound verdict; it wins when present.
   */
  let analysisState: unknown;
  /**
   * ⛔ THE RESULT BOUND TO THE GRAPH THIS RESPONSE RETURNS, and nothing else
   * (independent review of #1760, 5797642232 then 5798478999). A turn can run the
   * analysis and THEN the graph can change — and another analysis of the new graph
   * can commit before this readback — so neither the run's own verdict NOR its
   * blocks may be shown: a current verdict for run B must never license run A's
   * result. The graph read's `analysis_result` IS the block for the fact its verdict
   * selected, present ONLY on a fresh graph-hash verdict for the current graph
   * (`readScenarioAnalysis`), so it is emitted as-is, beside that verdict.
   * Unavailable readback → no result: never manufacture currentness.
   */
  let analysisResult: unknown;
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
  /** The persisted graph as read — the leader wire gate reads its option ROSTER, never a verdict. */
  let graph: unknown;
  try {
    const after = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph`, {});
    if (after.status === 200) {
      graph = after.json.graph;
      graphHash = typeof after.json.graph_hash === 'string' ? after.json.graph_hash : undefined;
      analysisReady = after.json.analysis_ready;
      if (typeof after.json.analysis_state === 'object' && after.json.analysis_state !== null) analysisState = after.json.analysis_state;
      if (typeof after.json.analysis_result === 'object' && after.json.analysis_result !== null) analysisResult = after.json.analysis_result;
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
       * The canonical readiness builder is a pure function of the graph — no
       * LLM, no network, no second orchestrator turn — so this costs a function
       * call, not twenty seconds. The graph read's own `analysis_ready`
       * still wins when it has one, because that reflects a real run.
       *
       * ⛔⛔ IT MUST BE THE BUILDER, NOT THE BARE ASSESSMENT — this is the
       * WHOLE readiness payload for this lane.
       *
       * This read `assessCanonicalAnalysisReadiness(...).analysisReady`, which
       * does NOT compute `may_run`; only
       * `canonicalAnalysisReadyFrom(resolveRunAdmission(g), g)` — i.e.
       * `buildCanonicalAnalysisReadyFromGraph` — does. And
       * `/assist/v1/scenarios/:id/graph` never sends `analysis_ready` at all
       * (its 200 carries `graph_hash`, `layout_present`, `not_modelled` …), so
       * the branch above is ALWAYS taken: every readiness payload an Agent-lane
       * user receives came from here.
       *
       * The consequence is not subtle. The client gates the Run affordance on
       * `admitsRunAffordance(status, may_run) = status === 'ready' || may_run
       * === true`. With `may_run` absent it falls back to the stricter `status`
       * term — and measured over the full population of 15,255 persisted models,
       * 3,168 (20.77%) are `may_run: true` under a NON-ready status. (An
       * earlier revision said 27.0% from a 400-row `updated_at DESC` slice;
       * that was recency bias.) Those users can run the
       * analysis and are never offered it, on the very turn this fallback was
       * added to serve: straight after a 60-90 s construction.
       *
       * ⚠ NOT A SECOND ASSESSMENT. `resolveRunAdmission` exposes the assessment
       * it derived from, precisely so a caller needing both does not run the
       * assessor twice.
       */
      if (analysisReady === undefined && after.json.graph !== undefined) {
        try {
          const canonical = buildCanonicalAnalysisReadyFromGraph(after.json.graph);
          if (canonical !== undefined) analysisReady = canonical;
        } catch {
          // Readiness is a disclosure, never a gate on the user's answer.
        }
      }
      // ⭐ State the run's freshness where the UI reads it (#63 5800618648): the
      // read route's `analysis_ready` carries no `freshness`, so a turn that
      // wrote and then ran left the UI saying "Model changed" over its own run.
      // Restates `run_state` from this SAME readback, after the
      // readiness fallback above so an assessed `analysis_ready` is stamped too — see the helper.
      analysisReady = withRunStateFreshness(analysisReady, analysisState, { graphHash, analysisResult });
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
      const g = after.json.graph as GraphV3T | undefined;
      if (g !== undefined && Array.isArray(g.nodes) && g.nodes.length > 0) {
        /**
         * ⛔ AND IT CARRIES `goal_constraints`. Assembled by hand it did not, so a
         * constraint the model holds ("churn under 4%") was cleared from the canvas
         * on the first build (the UI's `applyDraftResult` sets constraints from this
         * field). The canonical wire builder is the one Conventional's applied-edit
         * path uses: the same four fields, plus `goal_constraints` when non-empty.
         */
        draftGraph = buildAppliedGraphWireField({ ...g, edges: Array.isArray(g.edges) ? g.edges : [] });
      }
    }
  } catch (err) {
    /**
     * ⭐⭐ THE FAIL-OPEN IS RIGHT AND IT WAS SILENT — which converted a
     * measurable problem into an unmeasurable one.
     *
     * A readback failure must not lose the user's answer, so returning the turn
     * is correct and unchanged. But when it happens the client does not learn
     * the new revision, and **that has a user-visible consequence nobody could
     * count**: `lastServerGraphHash` in the canvas store is fed by exactly two
     * wire emitters — the top-level `graph_hash` and
     * `analysis_ready.current_graph_hash` — and BOTH are omitted on this path.
     * Null means *"CEE has not stamped one this session"*, and the store's own
     * comment says a delete then **stands down from the wire** rather than
     * asserting a base it does not hold.
     *
     * So the user's delete gesture silently stops applying, and until now there
     * was no log line, no event, and no way to know how often. The estate's own
     * draft-quality doctrine names this exact shape: *"a repair pass whose
     * fail-open is silent converts a measurable problem into an unmeasurable
     * one."*
     *
     * ⛔ NOTHING ABOUT THE BEHAVIOUR CHANGES. This adds one warn on a path that
     * already swallowed. It does not refuse the turn, does not retry, and does
     * not synthesise a revision — a hash this code could not read is one it must
     * not assert.
     */
    log.warn(
      {
        event: 'agent_lane.state_readback_failed',
        scenario_id: scenarioId,
        err: String(err),
        // Which emitters the client will be missing, stated rather than implied,
        // so the consequence is legible without reading the canvas store.
        graph_hash_emitted: graphHash !== undefined,
        analysis_ready_emitted: analysisReady !== undefined,
      },
      'agent-lane: could not read the current model back — the client will not learn this turn\u2019s revision, so a delete gesture stands down',
    );
  }

  // ⭐ ONE AUTHORITATIVE STATE: `graphHash` and `analysisReady` come from the
  // SAME dispatch above, so the stamp cannot describe a different model. See
  // the helper's header for why `graph_hash_at_run` is never set here.
  analysisReady = withCurrentGraphHash(analysisReady, graphHash);

  return { graphHash, analysisReady, draftGraph, analysisState, analysisResult, graph };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What makes two Agent turns "the same request": the scenario, WHO is asking,
 * and the message itself (trimmed). Stored as the turn row's `request_hash`, so
 * an exact retry replays and a reused id carrying a different message refuses.
 */
export function agentTurnRequestHash(scenarioId: string, userId: string | null, message: string, operation?: string): string {
  /**
   * ⛔ A TYPED OPERATION IS PART OF WHAT WAS ASKED (independent review of #1782,
   * 5804375960). Two approval chips carry the SAME words ("Yes, use those.") for
   * DIFFERENT proposals, so a hash of the words alone let a reused turn_id replay
   * approval A's answer for a request to approve B. The operation is bound only when
   * present, so an ordinary message hashes exactly as before and its retries still
   * replay.
   */
  const digest = createHash('sha256')
    .update(JSON.stringify({ v: 1, scenario_id: scenarioId, subject: userId, message: message.trim(), ...(operation !== undefined ? { operation } : {}) }))
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
    /**
     * ⭐ THE HANDLE IS KEPT SO CACHING CAN BE MEASURED AT ALL.
     *
     * This return value was discarded, and with it the only way to answer "is the
     * instruction prefix being cached, and by how much" on a real turn. The prefix is
     * structurally cacheable — `AGENT_INSTRUCTIONS` is a pure constant with zero
     * interpolations and `AGENT_TOOLS` is a module-level readonly array — but
     * "structurally cacheable" is a claim about the SOURCE, not a measurement of the
     * PROVIDER. `normaliseProviderUsage` reads `input_tokens_details.cached_tokens`,
     * the Responses API's own cache field, so this turns an assumption into a number
     * on every turn.
     *
     * ⚠ Bound BY HANDLE, never to "the last call": this route makes 4-6
     * conversation calls per turn, and attributing a cache hit to the wrong one is the
     * quietest possible way to make the measurement wrong.
     */
    const usageHandle = assertProviderAllowed('openai', 'agent-v1-turn.callModel', { model: budget.model, purpose: 'conversation' });
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
        // Fast path 3 answers over a run Olumi already made: it may interpret, never act.
        ...((req as { tool_choice?: unknown }).tool_choice === 'none' ? { tool_choice: 'none' } : {}),
        max_output_tokens: req.max_output_tokens,
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`openai_${r.status}: ${text.slice(0, 300)}`);
    }
    const j = (await r.json()) as { output: Record<string, unknown>[]; usage?: unknown };
    // Never throws, and records nothing for a malformed payload, so a successful call
    // cannot be turned into a failed one by the measurement of it.
    recordProviderUsage(usageHandle, j.usage);
    // The usage sidecar is read above and is not part of the transport contract.
    return { output: j.output };
  });

  /**
   * Structured construction call. Separate from `callModel` because it is a
   * different contract: strict `json_schema` output and its own measured budget
   * (see BANKED_BUDGETS role 'whole'), not the conversation budget.
   */
  const callStructured: CallStructuredModel = async (reqBody) => onceMoreOnTransportFailure('construction', async () => {
    /**
     * ⭐ THE MOST EXPENSIVE CALL IN THE PRODUCT, AND IT WAS THE ONE NOT MEASURED.
     *
     * #1825 wired `callModel` and left this handle discarded, so the caching witness on
     * served `c2ef0b8` read: 4 conversation calls with usage (9,441 of 14,638 input
     * tokens cached, 64.5%) and `call 3 construction: (no usage)`. Construction is
     * banked at ~54s with in 838 / out 3404 incl. 2070 reasoning — by far the largest
     * single call — so leaving it dark meant the aggregate cache figure could never be
     * trusted and the obvious optimisation target could not be ranked.
     *
     * ⚠ `j.usage` was ALREADY parsed and returned by this function; only the ledger
     * write was missing. Nothing new is fetched or computed here.
     */
    const usageHandle = assertProviderAllowed('openai', 'agent-v1-turn.callStructured', { model: reqBody.model, purpose: 'construction' });
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
    // Same contract as the conversation path: never throws, and records nothing for a
    // malformed payload, so measuring a call cannot turn a successful one into a failure.
    recordProviderUsage(usageHandle, j.usage);
    return { text, usage: j.usage };
  }, (call, err) => log.warn({ err, call }, 'agent-lane transport failure, retrying once'));

  /*
   * ⛔ EVERY AGENT TURN IS OPENAI-ONLY (Paul, 23 Sep: zero Anthropic calls on the
   * OpenAI journey). Any Anthropic attempt beneath this turn — including internal
   * dispatch to the conventional handlers — is refused before network I/O and logged
   * (`adapters/llm/provider-policy.ts`).
   */
  const agentTurnHandler = async (req: FastifyRequest, reply: FastifyReply) => {
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
          _provider_calls: recordedProviderCalls(),
        ...(providerLedgerTruncated() ? { _provider_calls_truncated: true } : {}),
        });
      }

      const forwarded = await dispatchFor(
        typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      )('/orchestrate/v2/turn', body);
      /**
       * ⛔ THE AGENT MUST KNOW WHAT THE USER CHANGED ON THE BOARD. Measured on served
       * cc7b26c: after a canvas edit (Tech lead hires 0 → 1), "Re-run the analysis.
       * How much did my change matter?" was answered about the EARLIER approved
       * baseline — the forwarded edit never entered the Agent's history, and it did
       * not re-read state. The product's own narration of the edit (the handler's
       * truthful text, e.g. "Updated Tech lead hires from 0 hires to 1 hire.") is
       * appended to this session's history, marked as a board edit — not as
       * something the user asked the Agent to do.
       */
      const narration = typeof forwarded.json.assistant_text === 'string' ? forwarded.json.assistant_text.trim() : '';
      if (forwarded.status === 200 && kind === 'system_event' && narration.length > 0) {
        histories.set(sessionId, [
          ...histories.get(sessionId),
          { role: 'user', content: [{ type: 'input_text', text: `${BOARD_EDIT_PREFIX} ${narration}` }] },
        ]);
      }
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
        _provider_calls: recordedProviderCalls(),
        ...(providerLedgerTruncated() ? { _provider_calls_truncated: true } : {}),
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

    const approvedProposal = typedApprovalOf(body);
    const requestHash = agentTurnRequestHash(scenarioId, userId, message, approvedProposal !== undefined ? `approve:${approvedProposal}` : undefined);
    /** The response a replay returns: the ORIGINAL words, on today's state, with no model call. */
    const replayed = async (prior: CommittedTurnRecord) => {
      const state = await readBackState(dispatch, scenarioId);
      const remembered = turnId !== undefined ? offeredActions.get(`${scenarioId}:${turnId}`) ?? [] : [];
      // The durable carrier: this exact row's persisted Run offer, still within its lifetime.
      const durableRun = (prior.pending_actions ?? []).some((pa) =>
        pa.chip_id === RUN_OFFER_CHIP.id && pa.action.kind === 'run_analysis' && !isPendingActionExpired(pa, Date.now()));
      // ⛔ And this exact row's approve chip, from the carrier persisted WITH it (Codex #1823 5819308426: a
      // lost proposing response retried on a restarted process replayed the proposal with no way to approve
      // it). Only its words come from the row; `stillValidOffers` below decides whether it is still offered,
      // against the store the rehydration above has already refilled from the latest answer row.
      const durableApprove = remembered.some((a) => typedApprovalOf({ chip: { id: a.id } }) !== undefined)
        ? undefined
        : offeredApproveChipOnRow(prior.pending_actions, { scenario_id: scenarioId, user_id: userId });
      const offered = [
        ...(durableApprove !== undefined ? [durableApprove] : []),
        ...remembered,
        ...(durableRun && !remembered.some((a) => a.id === RUN_OFFER_CHIP.id) ? [RUN_OFFER_CHIP] : []),
      ];
      const composedReplay = composeDirectAnswerResponse({
        assistant_text: prior.assistant_message ?? 'That request was already completed.',
        stage: 'frame',
        answerKind: 'substantive',
        suggested_actions: stillValidOffers(offered, {
          outstandingProposalIds: ((id) => new Set(id !== undefined ? [id] : []))(executableWaitingProposal(scenarioId, userId, state.graphHash)),
          analysisReady: state.analysisReady,
          analysisState: state.analysisState,
          // `draft_graph` is read back only when the graph has content.
          modelExists: state.draftGraph !== undefined,
        }),
      });
      return {
        ...finaliseV5Response(composedReplay, { scenarioId }),
        ...(state.graphHash !== undefined ? { graph_hash: state.graphHash } : {}),
        ...(state.analysisReady !== undefined ? { analysis_ready: state.analysisReady } : {}),
        ...(state.analysisState !== undefined ? { analysis_state: state.analysisState } : {}),
        ...(state.draftGraph !== undefined ? { draft_graph: state.draftGraph } : {}),
        _diagnostic_trace: { exit_path: 'agent_lane_v1', agent_mode: mode, hops: 0, stopped_reason: 'replayed', tools_called: [], replayed: true },
        _agent: { session_id: sessionId, mode, tool_calls: [], mutated: false, hops: 0, stopped_reason: 'replayed', replayed: true, turn_id: turnId },
        _provider_calls: recordedProviderCalls(),
        ...(providerLedgerTruncated() ? { _provider_calls_truncated: true } : {}),
      };
    };
    /**
     * ⛔ A RESTART MUST NOT FORGET WHAT THE USER IS ABOUT TO APPROVE (#63 5811981438: three redeploys inside
     * Paul's session, his "yes" met `unknown_proposal`). The latest answer row carries the proposal it
     * offered; put it back when this process does not hold it. Read BEFORE this turn's own claim row is
     * written, or the latest row would be that claim, which carries nothing. A failed read degrades to today's behaviour.
     */
    const approveKey = `${scenarioId}:${userId ?? ''}`;
    if ((approvedProposal !== undefined && proposals.get(approvedProposal) === undefined)
      || proposals.outstanding(scenarioId, userId).length === 0) {
      if (typeof store.readMostRecentPendingActions === 'function') {
        try {
          // What is restored is also carried forward by this turn's own answer row (`carrierForAnswerRow`).
          rehydrateProposals(await store.readMostRecentPendingActions(scenarioId), proposals, { scenario_id: scenarioId, user_id: userId },
            Date.now(), (carrier) => carriedProposals.remember(approveKey, carrier));
        } catch (err) {
          log.warn({ err: String(err), scenario_id: scenarioId }, 'agent-lane: pending proposals could not be read back — continuing without them');
        }
      }
    }
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
     *
     * The carrier is the FINAL readback's bound result and readiness (see
     * `readBackState`), NOT the tool run's own blocks: a run's blocks can describe a
     * graph the user no longer has (independent review of #1760).
     */
    // Counts every call that could WRITE, so a failed turn knows whether it is
    // safe to release its claim (nothing sent) or must leave it (outcome unknown).
    let writesDispatched = 0;
    const countingDispatch: typeof dispatch = async (path, body) => {
      if (path.endsWith('/graph/register') || path === '/orchestrate/v2/turn') writesDispatched += 1;
      return dispatch(path, body);
    };
    /**
     * ⭐ THE AUTOMATIC FIRST ANALYSIS (Paul, 5812069638), handed to the build capability. The route
     * owns three things about it: the DEADLINE (the build and the run share one browser-proxy
     * budget, measured from this request's start), the WRITE accounting (a run commits a turn, so a
     * failed turn must never release its claim after one), and the witness record below.
     */
    const firstAnalysisDeadlineAt = firstAnalysisDeadline(startedAt);
    let firstAnalysis: { outcome: FirstAnalysisOutcome; ms: number; constructionTurnId: string; revision: string } | undefined;
    const runFirstAnalysis = async (input: Parameters<typeof runFirstAnalysisAfterConstruction>[0]): Promise<FirstAnalysisOutcome> => {
      const t0 = Date.now();
      const outcome = await runFirstAnalysisAfterConstruction({ ...input, onDispatch: () => { writesDispatched += 1; } });
      firstAnalysis = { outcome, ms: Date.now() - t0, constructionTurnId: input.constructionTurnId, revision: input.revisionHash };
      return outcome;
    };
    /**
     * The LAST analysis this turn ran (first analysis, the Agent's own run, or the typed Run), as
     * handed over. Carried to the user ONLY when bound to the final readback — see
     * `bindRunBlocksToReadback` and `runTurnCoaching`. No trigger ⇒ the user asked for the run.
     */
    let lastRun: CapturedAnalysis | undefined;
    const capabilities = createAgentCapabilities(
      countingDispatch, proposals, callStructured, mode,
      (payload) => { lastRun = { ...payload, trigger: payload.trigger ?? 'explicit_run' }; },
      { firstAnalysis: (input) => runFirstAnalysis({ ...input, deadlineAt: firstAnalysisDeadlineAt }) },
    );
    // A session whose in-process history holds no user message (a restart, a
    // deploy, an eviction — or only a board-edit note appended since) is seeded
    // from the durable conversation, ahead of whatever is already held — see
    // `historyFromDurableTurns`. A failed read degrades to no history; it never
    // fails the turn.
    const held = histories.get(sessionId);
    if (needsDurableSeed(held) && typeof store.readRecent === 'function') {
      try {
        const durable = historyFromDurableTurns(await store.readRecent(scenarioId));
        if (durable.length > 0) histories.set(sessionId, [...durable, ...held]);
      } catch (err) {
        log.warn({ err: String(err), scenario_id: scenarioId }, 'agent-lane: durable conversation could not be read — continuing without it');
      }
    }
    const history = histories.get(sessionId);
    const budget = budgetFor('gpt-5.6-terra', 'conversation');

    /**
     * ⭐ FAST PATH 2 — A TYPED APPROVAL IS APPLIED, NOT INTERPRETED (RC #63 5803960423 /
     * 5803995225). Measured in Paul's staging test: "Use as starting assumptions" took
     * ~29 s, 4 provider calls and 3 tool hops, and ran an analysis nobody asked for. The
     * chip names exactly one proposal (`approvalChipsFor`), so there is nothing for a
     * model to decide: the SAME `authorise_change` capability applies THAT proposal, with
     * every ownership, integrity and CAS check the Agent's own call would get, and the
     * status the user reads is composed from the result (`write-outcome`). Zero model
     * calls, no implicit analysis. Words alone never take this path.
     */
    let fastPath: 'approve' | 'run' | undefined;
    let result: AgentTurnResult | undefined;
    if (approvedProposal !== undefined) {
      const fastStartedAt = Date.now();
      const applied = await dispatchTool(
        'authorise_change', JSON.stringify({ proposal_id: approvedProposal }),
        { scenario_id: scenarioId, authenticated_user_id: userId, request_id: req.id }, capabilities, mode,
      );
      /**
       * ⛔ THE TYPED IDENTITY STAYS AUTHORITATIVE, EVEN WHEN THE PROPOSAL IS GONE
       * (independent review of #1782, 5804375960). Handing a click that consented to A
       * to the Agent as its generic words let the Agent authorise whichever proposal was
       * still outstanding (B), and run an analysis. A missing proposal (a deploy, an
       * eviction) is answered honestly here: nothing written, no model call, no
       * analysis; the user can ask for a fresh proposal and approve THAT.
       */
      {
        fastPath = 'approve';
        const call = {
          name: 'authorise_change', ok: applied.ok === true, mutated: applied.mutated === true, proposal_id: approvedProposal,
          ...(typeof applied.outcome === 'string' ? { outcome: applied.outcome } : {}),
          ...(typeof applied.refusal === 'string' ? { refusal: applied.refusal } : {}),
        };
        /**
         * The capability's own next-step sentence rides with the status (#1788's add-option returns
         * one: the option "cannot be compared yet"). Nothing reads the tool result on this path, so
         * without this the user read "Saved" and nothing about what still blocks the comparison.
         * Server-authored text only — never model prose.
         */
        const followUp = typeof applied.follow_up === 'string' ? applied.follow_up.trim() : '';
        const said = [narrateWriteOutcome('', [call], [applied]).status ?? '', followUp].filter((x) => x !== '').join(' ');
        const ms = Date.now() - fastStartedAt;
        result = {
          // The reply the user reads is composed from this text plus Olumi's status line.
          assistant_text: followUp,
          // The Agent's next turn sees the approval and what Olumi said about it.
          items: [
            ...(history ?? []),
            { role: 'user', content: [{ type: 'input_text', text: message }] },
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: said }] },
          ],
          tool_calls: [call],
          tool_results: [applied],
          mutated: applied.mutated === true,
          hops: 0,
          stopped_reason: 'answered',
          timing: { total_ms: ms, provider_ms: 0, tool_ms: ms, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 1, hops: 0 },
        };
      }
    }
    /**
     * ⭐ FAST PATH 3 — AN EXPLICIT RUN IS RUN, THEN INTERPRETED ONCE (RC #63 5803960423 /
     * 5803995225). Measured in Paul's staging test: an explicit analysis took ~18 s, 3
     * provider calls and 2 tool hops — the Agent decided to call the analysis the user had
     * just asked for. The Run control is a TYPED chip (`action_type: 'run_analysis'`), so
     * the SAME `run_analysis` capability runs (deterministic PLoT/ISL, no model), and ONE
     * model call interprets its result with `tool_choice: 'none'` — it can explain, never
     * act. A refused run is explained by that same one call. The pair is kept in history
     * so the Agent's next turn knows the run happened.
     */
    if (result === undefined && approvedProposal === undefined && typedRunOf(body)) {
      const fastStartedAt = Date.now();
      const ran = await dispatchTool('run_analysis', JSON.stringify({ reason: 'the user pressed Run' }),
        { scenario_id: scenarioId, authenticated_user_id: userId, request_id: req.id }, capabilities, mode);
      /**
       * ⛔ THE INTERPRETER IS GIVEN THE CLAIM PERMISSIONS, NOT LEFT TO INFER THEM. v0.2 says
       * "use only supplied … currentness and claim permissions", and the run's own tool result
       * carries no `analysis_state`, so `leader_claim` (and a withheld reason) never reached the
       * call. The canonical state is read back from the persisted graph after the run — the
       * SAME reader the response's final readback uses — and handed over beside the run.
       */
      let canonicalAfterRun: { analysis_state?: unknown; analysis_ready?: unknown } = {};
      try {
        const st = await readBackState(dispatch, scenarioId);
        canonicalAfterRun = { ...(st.analysisState !== undefined ? { analysis_state: st.analysisState } : {}), ...(st.analysisReady !== undefined ? { analysis_ready: st.analysisReady } : {}) };
      } catch { canonicalAfterRun = {}; }
      const runForInterpreter = { ...ran, canonical_state: canonicalAfterRun };
      const callId = `fast_run_${req.id}`.replace(/[^A-Za-z0-9_-]/g, '_');
      const priorAndRun = [
        ...(history ?? []),
        { role: 'user', content: [{ type: 'input_text', text: message }] },
        { type: 'function_call', name: 'run_analysis', call_id: callId, arguments: JSON.stringify({ reason: 'the user pressed Run' }) },
        { type: 'function_call_output', call_id: callId, output: JSON.stringify(runForInterpreter) },
      ];
      /**
       * ⛔ THE RUN IS NEVER HANDED TO THE AGENT AFTER IT HAS HAPPENED (independent review of
       * #1786, 5805279370). A failed or empty interpretation used to fall through to the
       * ordinary tool-enabled turn with the ORIGINAL message and history — dropping the run
       * it had just made, so the Agent could run the analysis a SECOND time, or act. The run
       * stands, and only its explanation is missing: the user is told exactly that, from
       * the run's own result, and nothing else is called.
       */
      const providerStartedAt = Date.now();
      let interpreted: { answer: string; messages: Record<string, unknown>[] } | undefined;
      try {
        const resp = await callModel({
          instructions: `${AGENT_INSTRUCTIONS}\n\n${INTERPRET_ONLY_CONSTRAINT}\n\n${INTERPRETER_V02_BANKED}`,
          input: priorAndRun,
          // No tools at all: acting is structurally impossible on this call (and no schema tokens
          // are spent on tools it may not use). Measured against the live API: accepted with the
          // server-recorded run pair in history.
          tools: [],
          max_output_tokens: budget.max_output_tokens,
          tool_choice: 'none',
        } as never);
        const out = (resp.output ?? []) as { type?: string; content?: { type?: string; text?: string }[] }[];
        const answer = out.filter((o) => o.type === 'message').flatMap((o) => o.content ?? [])
          .filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('');
        // ⛔ THE REASONING ITEM TRAVELS WITH ITS MESSAGE (served `f828a61`, witness c9: every turn after a
        // Run was refused "Item 'msg_…' of type 'message' was provided without its required 'reasoning'
        // item", HTTP 502). Kept in output order, exactly as the Agent loop keeps its whole output.
        if (answer.trim().length > 0) interpreted = { answer, messages: out.filter((o) => o.type === 'reasoning' || o.type === 'message') as Record<string, unknown>[] };
        else log.warn({ scenario_id: scenarioId }, 'agent-lane: fast-path interpretation was empty — answering from the run itself');
      } catch (err) {
        log.warn({ err: String(err), scenario_id: scenarioId }, 'agent-lane: fast-path interpretation failed — answering from the run itself');
      }
      fastPath = 'run';
      const ms = Date.now() - fastStartedAt;
      const providerMs = Math.min(Date.now() - providerStartedAt, ms);
      const text = interpreted?.answer ?? interpretationUnavailableText(ran);
      result = {
        assistant_text: text,
        items: [...priorAndRun, ...(interpreted?.messages ?? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }])],
        tool_calls: [{ name: 'run_analysis', ok: ran.ok === true, mutated: false, ...(typeof ran.refusal === 'string' ? { refusal: ran.refusal } : {}) }],
        tool_results: [ran],
        mutated: false,
        hops: 1,
        stopped_reason: 'answered',
        timing: { total_ms: ms, provider_ms: providerMs, tool_ms: Math.max(0, ms - providerMs), overhead_ms: 0, tool_provider_ms: 0, provider_calls: 1, tool_calls: 1, hops: 1 },
      };
    }
    if (result === undefined) try {
      result = await runAgentTurn(
        {
          ctx: { scenario_id: scenarioId, authenticated_user_id: userId, request_id: req.id },
          history,
          message,
          instructions: AGENT_INSTRUCTIONS,
          maxOutputTokens: budget.max_output_tokens,
          mode,
          withheldTools: withheldToolsOf(body),
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
    /**
     * ⭐ THE SERVER STATES WHAT IT CHANGED, rather than asking the model to.
     *
     * A value the person APPROVED can be stored differently, and a factor's
     * range can be chosen BY THE PRODUCT so the analysis can run at all. Both
     * were told only to the model, carried on `must_disclose_rescaling` — a
     * field that occurs at exactly ONE site in the tree, the one that sets it.
     * Nothing read it and nothing verified it, so whether the person was told
     * depended on the model electing to say so.
     *
     * This does not replace that obligation; the model should still say it in
     * its own words. It removes the DEPENDENCE on it.
     */
    const stateFacts = collectTurnStateFacts(result.tool_results);
    /**
     * ⛔⛔ `current_state_unknown` MUST WIN OVER EVERY PRESENT-STATE CLAIM, AND
     * THE ORDER HERE IS WHAT DECIDES THAT — not the early return inside
     * `valueChangeDisclosures`.
     *
     * ⚠ CHANGES_REQUIRED on 044fe50c, accepted, and it RECURRED one level up:
     * that early return governs only the disclosures the module composes. This
     * route concatenated `disclosuresFor(...)` FIRST, so a single turn could say
     * "the model … is holding a placeholder … Tell me how strong … and I will
     * replace it" and then "What the model now holds … is NOT KNOWN … do not
     * treat any figure as current". The second sentence is the true one; the
     * first is authority a failed readback cannot support.
     *
     * So when the readback failed, the unknown disclosure is the ONLY one owed.
     * `PLACEHOLDER_STRENGTH_DISCLOSURE` describes what the model NOW HOLDS, which
     * is precisely the thing we could not observe.
     */
    /**
     * ⭐ A FIRST ANALYSIS THAT DID NOT RUN IS SAID BY OLUMI, NEVER LEFT TO THE MODEL (Paul: "never a
     * silent skip"). One deterministic sentence naming what is missing, or that the turn ran out of
     * time; the control beside it (next step, or Run) is added to the chips below.
     */
    const firstAnalysisSaid = firstAnalysis !== undefined ? firstAnalysisSentence(firstAnalysis.outcome) : null;
    const owed = stateFacts.current_state_unknown === true
      ? [...valueChangeDisclosures(stateFacts)]
      : [
        ...disclosuresFor(result.tool_results),
        ...valueChangeDisclosures(stateFacts),
        ...(firstAnalysisSaid !== null ? [firstAnalysisSaid] : []),
      ];
    /**
     * ⛔ WHAT WAS SAVED IS STATED BY OLUMI, FROM THE TOOL RESULTS (RC #63
     * 5788648244). A model-authored "Saved…" survived here on a turn that wrote
     * nothing, because this route returned the model's words verbatim. The
     * status line is composed from the authoritative results; an unsupported
     * write claim is removed when nothing landed. See `write-outcome.ts`.
     */
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
     * hash the client caches must be the hash the product would serve it. Read
     * BEFORE the reply is composed, because the Run offer below keys on the
     * readiness this same response carries.
     */
    const { graphHash, analysisReady, draftGraph, analysisState, analysisResult, graph: readbackGraph } = await readBackState(dispatch, scenarioId);
    const fa = firstAnalysis?.outcome;
    // An analysis of THIS revision exists because this turn's construction ran it (or already had).
    const firstAnalysisExists = fa !== undefined && (fa.ran || fa.reason === 'already_ran_for_construction');
    // Offered only after a change, only when that change was not already analysed this turn
    // (by the Agent's run, or by the first analysis), and only when the canonical readiness in
    // THIS response admits a run. A first analysis stopped only by the turn's time was admitted on
    // this same revision, so the same readiness offers Run beside Olumi's sentence.
    const offerRun = result.mutated
      // A Run the server refused because this request's approval applied a change analysed nothing:
      // it must not suppress the Run the refusal tells the user to press.
      && !result.tool_calls.some((c) => c.name === 'run_analysis' && c.refusal !== 'run_not_requested')
      && !firstAnalysisExists
      && admitsRunOffer(analysisReady);

    // A typed Run that answered but did not complete (blocked) offers the next step instead.
    const runBlocked = fastPath === 'run'
      && (result.tool_results[0] as { ok?: unknown; ran?: unknown } | undefined)?.ok === true
      && (result.tool_results[0] as { ran?: unknown } | undefined)?.ran !== true;
    // The turn's LAST build was refused as too large and nothing was saved: offer the rebuild the reply names.
    const lastBuild = result.tool_calls.filter((c) => c.name === 'build_model_from_brief').at(-1);
    const offerRebuild = lastBuild?.refusal === 'model_too_large' && !result.mutated;
    // A Run changes no graph: the ONE proposal still awaiting a yes keeps its chip if the store would still
    // execute it on this revision (never on a guess — two outstanding, or a moved model, carry nothing).
    // ⛔ On a FRESH worker the process-local `lastApproveOffer` is empty (Codex #1823 5819308426: "if Run lands
    // on a fresh worker, the process-local carry can be absent"), so the chip also comes from the carrier the
    // rehydration above restored from the latest answer row — the exact words the offer used.
    const carriedApproval = ((): OfferedAction[] => {
      if (fastPath !== 'run') return [];
      const id = executableWaitingProposal(scenarioId, userId, graphHash);
      if (id === undefined) return [];
      const chip = [lastApproveOffer.get(approveKey), carriedProposals.get(approveKey)?.chip]
        .find((c) => c !== undefined && typedApprovalOf({ chip: { id: c.id } }) === id);
      return chip !== undefined ? [chip, AMEND_CHIP] : [];
    })();
    // A withheld call consumed no proposal and moved nothing: it is not an authorisation, and
    // counting one (it has no proposal id) would strand the proposal it named without its chip.
    const approvals = approvalChipsFor(result.tool_calls.filter((c) => c.refusal !== WITHHELD_ON_CHIP_TURN));
    // A first analysis the model could not run offers its repair: the approve chip when the Agent
    // proposed the missing values this turn, otherwise the next-step chip.
    const firstAnalysisBlocked = fa !== undefined && !fa.ran && (fa.reason === 'not_admissible' || fa.reason === 'refused')
      && approvals.length === 0;
    /**
     * ⛔ AN APPROVAL THAT LEAVES THE MODEL UN-RUNNABLE STILL OFFERS A NEXT STEP (P0, 25 Sep; RC #69 5826744045 §2).
     * Served `21e3b38`, hiring: "Use as starting assumptions" applied (`authorise_change` mutated), the model
     * stayed `blocked` with `blockers: null` and `may_run: false`, and the reply was "Saved." with NO chip: the
     * user had nothing to press. The Run offer above correctly declines, so the next-step chip stands in. The
     * Run turn that followed named the gap and offered this same chip. Not when another approval is waiting,
     * and only on a KNOWN refusal: a failed readback is unknown and offers nothing (see `knownNotRunnable`).
     */
    const approvalLeftBlocked = result.tool_calls.some((c) => c.name === 'authorise_change' && c.mutated === true)
      && knownNotRunnable(analysisReady)
      && approvals.length === 0 && carriedApproval.length === 0;
    const offeredNow: OfferedAction[] = [
      ...approvals,
      ...carriedApproval,
      ...(offerRun ? [RUN_OFFER_CHIP] : []),
      ...(runBlocked || firstAnalysisBlocked || approvalLeftBlocked ? [NEXT_STEP_AFTER_BLOCKED_RUN_CHIP] : []),
      ...(offerRebuild ? [REBUILD_AFTER_TOO_LARGE_CHIP] : []),
    ];
    if (turnId !== undefined) rememberOffered(`${scenarioId}:${turnId}`, offeredNow);
    rememberApprove(approveKey, offeredNow);
    // What this answer row persists: the Run offer, and the exact proposal behind the approve chip it offers
    // — or, on a turn that offers none, the one still outstanding (a question between the offer and the "yes"
    // must not drop what a restart needs to find it).
    const offeredApprove = offeredNow.find((a) => typedApprovalOf({ chip: { id: a.id } }) !== undefined);
    const offeredProposal = offeredApprove !== undefined ? proposals.get(typedApprovalOf({ chip: { id: offeredApprove.id } }) as string) : undefined;
    const emittedAtIso = new Date().toISOString();
    const approvalCarrier = carrierForAnswerRow({
      offered: offeredApprove !== undefined && offeredProposal !== undefined ? { proposal: offeredProposal, chip: offeredApprove } : undefined,
      carried: carriedProposals.get(approveKey),
      store: proposals,
      subject: { scenario_id: scenarioId, user_id: userId },
      currentGraphHash: graphHash,
      emittedAtIso,
    });
    const durablePending = [
      ...(offerRun ? derivePendingActionsFromFinalizedChips([RUN_OFFER_CHIP], { scenario_id: scenarioId, emitted_at_iso: emittedAtIso, ...(graphHash !== undefined ? { graph_hash: graphHash } : {}) }) : []),
      ...(approvalCarrier !== undefined ? [approvalCarrier] : []),
    ];

    const lastRunBlocks = Array.isArray(lastRun?.blocks) ? lastRun.blocks : [];
    const runBound = bindRunBlocksToReadback(lastRunBlocks, { graphHash, analysisState, analysisResult });
    /**
     * ⭐ THE RUN-TURN COACHING CARD (CEE #1855), bound to the SAME readback. On this lane the run's own
     * blocks carry no coaching on the automatic first pass (leader withheld, no decision_review), so
     * without it the first pass is blank. Only the blocks the contract BUILDS are added: the run's own
     * blocks stay under `bindRunBlocksToReadback`'s rule above.
     */
    const runCoaching = runTurnCoaching(lastRun, { scenarioId, graphHash, analysisState, analysisResult });
    const coachingBound = [...runBound, ...runCoaching.blocks.filter((b) => !lastRunBlocks.includes(b))];
    const coachingBlocks: unknown[] = coachingBound.length === 0
      ? []
      : sanitiseOlumiResponseForEgress(
        // A carrier for the blocks only — not an answer, so not a compose site: nothing here speaks.
        { response_version: 2, assistant_text: '', blocks: coachingBound as OlumiResponse['blocks'], suggested_actions: [], insights: [], stage_indicator: 'frame' } as OlumiResponse,
        {
          graph: parsedGraphOrNull(readbackGraph), requestId: String(req.id), exitPath: 'agent_lane_v1', userMessage: null,
          // Vestigial on this function (see its docblock); the readback's own typed verdict, never a literal.
          mayNameLeadingOption: (analysisState as { leader_claim?: { permitted?: unknown } } | undefined)?.leader_claim?.permitted === true,
        },
      ).blocks;

    // A Run writes nothing: its interpretation is never passed through the WRITE narrator, whose
    // completion-claim stripper would delete a sentence and append a false write-status line
    // (finding 3 on #1786, 5807230197).
    const narration = fastPath === 'run'
      ? { text, status: null as string | null, stripped: [] as string[] }
      : narrateWriteOutcome(text, result.tool_calls, result.tool_results);
    const composed = composeDirectAnswerResponse({
      // ⛔ A proposal id is a binding for authorise_change, never text a user reads or
      // types (display-ids.ts). Applied here, before the answer row is written, so a
      // replay returns exactly what the user first saw.
      // Olumi's own status, plus what any proposal this turn LEFT OUT — both deterministic (#1800).
      assistant_text: withoutProposalIds(withWriteOutcome(withDisclosures(narration.text, owed),
        [narration.status, notAdoptedLine(result.tool_calls, result.tool_results)].filter((x): x is string => x !== null && x !== '').join(' ') || null)),
      stage: 'frame',
      answerKind: 'substantive',
      // One click approves the ONE proposal just offered — the same words as typing "yes".
      suggested_actions: offeredNow,
      // The run's coaching, ONLY when bound to this readback, through the same egress sanitiser the
      // conventional exit uses — built INTO the finalised response, never appended raw.
      blocks: coachingBlocks as OlumiResponse['blocks'],
    });
    const finalised = finaliseV5Response(composed, { scenarioId });

    const existingBlocks = Array.isArray((finalised as { blocks?: unknown[] }).blocks)
      ? (finalised as { blocks: unknown[] }).blocks
      : [];

    /**
     * ⭐ THE RESPONSE AS IT WILL SHIP — assembled BEFORE the answer row is written, so the leader gate
     * below edits the text a replay returns, not only the text this request returns.
     */
    let wireBody = {
      ...finalised,
      // The FINAL readback's bound result block — never the tool run's own blocks. See
      // `analysisResult` in readBackState. The Agent's text still reports what its run
      // found and, if the model has since changed, that it has.
      ...(analysisResult !== undefined ? { blocks: [analysisResult, ...existingBlocks] } : {}),
      ...(graphHash !== undefined ? { graph_hash: graphHash } : {}),
      // Readiness of the graph this response returns — the final readback's only.
      ...(analysisReady !== undefined ? { analysis_ready: analysisReady } : {}),
      // The scenario-bound verdict from the FINAL readback governs; otherwise the
      // finaliser's own honest no-context verdict stays (present, never deleted).
      ...(analysisState !== undefined ? { analysis_state: analysisState } : {}),
      ...(draftGraph !== undefined ? { draft_graph: draftGraph } : {}),
    } as OlumiResponse & Record<string, unknown>;
    /**
     * ⛔ THE LEADER FOLLOWS THE TYPED PERMISSION, AT THE WIRE (Paul: "do NOT hard-code no leader").
     * The Agent is told to name a leader only when `leader_may_be_named`; this is the deterministic
     * backstop, the same gate route-v2 runs at its single send point. On any turn that carries an
     * analysis, `leader_claim.permitted` from the SAME readback is the entitlement, conjoined inside
     * the gate with the admission's `permitted_analysis_mode`. PERMIT-WINS: a permitted turn is
     * returned by reference, byte-identical.
     *
     * ⛔ FAIL-CLOSED ON A WITHHELD TURN (AI Quality corpus #63 5823028488; Codex 5823210765): the
     * shared gate needs the EXACT option label and caught 1 of 13 real paraphrased leaks. So on a
     * withheld turn every sentence that ranks options is dropped first, whatever it calls the
     * option, and one deterministic no-leader sentence is appended; then the shared gate runs on
     * what remains. See `agent-lane/withheld-leader-fail-closed.ts`.
     */
    const analysisBearing = analysisResult !== undefined
      || fa !== undefined
      || result.tool_calls.some((c) => c.name === 'run_analysis');
    let leaderClaimEnforced = false;
    if (analysisBearing) {
      const claim = (analysisState as { leader_claim?: { permitted?: unknown; separation?: unknown; withheld_reason?: unknown } } | undefined)?.leader_claim;
      const enforced = enforceAgentLaneLeaderClaimsAtWire(wireBody, {
        requestId: String(req.id),
        exitPath: 'agent_lane_v1',
        mayNameLeadingOption: claim?.permitted === true,
        separationEstablished: claim?.separation === 'separated',
        ...(typeof claim?.withheld_reason === 'string' ? { leaderClaimWithheldReason: claim.withheld_reason } : {}),
        graph: readbackGraph ?? null,
        analysisReady,
      });
      if (enforced.changed) {
        leaderClaimEnforced = true;
        // A shape sidecar describes the text it was built from; it goes with an edit to that text.
        const { _answer_shape: _dropped, ...withoutShape } = enforced.response as OlumiResponse & { _answer_shape?: unknown };
        wireBody = (enforced.editedFields.includes('assistant_text') ? withoutShape : enforced.response) as OlumiResponse & Record<string, unknown>;
      }
    }

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
          llm_calls_used: fastPath === 'approve' ? 0 : fastPath === 'run' ? 1 : result.hops + 1,
          duration_ms: Date.now() - startedAt,
          handler_facts: [],
          userMessage: message,
          assistantMessage: String(wireBody.assistant_text ?? text),
          // The Run offer AND the offered approval, durably, with THIS answer row — so a replay, or an
          // approval that reaches a restarted process, can still find them.
          ...(durablePending.length > 0 ? { pending_actions: durablePending } : {}),
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
        // Only a row that was written moves the slot: the next answer row carries what THIS one did.
        carriedProposals.persisted(approveKey, approvalCarrier);
      } catch (err) {
        // The answer is real and the writes already happened; hiding it would be
        // worse. It is returned, flagged as not durable, and logged loudly.
        log.error({ err: String(err), scenario_id: scenarioId, turn_id: turnId }, 'agent-lane: answer could not be recorded — the claim stands, so a retry reports an unknown outcome and never re-runs');
        durability = 'not_recorded';
      }
    }

    return reply.code(200).send({
      ...wireBody,
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
        ...(fastPath !== undefined ? { fast_path: fastPath } : {}),
        agent_mode: mode,
        hops: result.hops,
        stopped_reason: result.stopped_reason,
        tools_called: result.tool_calls.map((c) => c.name),
        write_claims_removed: narration.stripped.length,
        ...(leaderClaimEnforced ? { leader_claim_enforced: true } : {}),
        /** The run-turn coaching card: shown, or the typed reason it is not (for staging witnesses). */
        coaching: runCoaching.eligibility,
        /**
         * ⭐ WHAT THE AUTOMATIC FIRST ANALYSIS DID, for witnesses: ran, or why not, how long it took,
         * and the (construction, revision) identity it was bound to. Absent when no construction
         * committed on this turn.
         */
        ...(firstAnalysis !== undefined
          ? {
            first_analysis: {
              ran: firstAnalysis.outcome.ran,
              ...(firstAnalysis.outcome.ran ? { run_turn_id: firstAnalysis.outcome.runTurnId } : { reason: firstAnalysis.outcome.reason }),
              ...(!firstAnalysis.outcome.ran && firstAnalysis.outcome.reason === 'failed' ? { dispatch_outcome: firstAnalysis.outcome.dispatchOutcome } : {}),
              construction_turn_id: firstAnalysis.constructionTurnId,
              revision: firstAnalysis.revision,
              ms: firstAnalysis.ms,
              coaching_blocks: coachingBlocks.length,
            },
          }
          : {}),
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
        /**
         * The structured twin of the prose disclosure above. Prose is readable;
         * structure is reliable. Omitted entirely when nothing changed, so its
         * presence is itself the signal.
         */
        // ⛔ THE GATE OMITTED THE TWO FACTS THAT MATTER MOST. On the turn a
        // reconciling surface most needs to read — a frame write refused and the
        // readback failed, nothing rescaled, nothing added — `_agent` carried NO
        // `state_facts` at all, so the channel this module calls "reliable" was
        // silent exactly when the prose was saying the state is unknown. A
        // consumer would read that as "nothing happened".
        ...(stateFacts.rescaled.length > 0
          || stateFacts.ranges_added.length > 0
          || (stateFacts.ranges_not_attached ?? []).length > 0
          || stateFacts.current_state_unknown === true
          ? { state_facts: stateFacts }
          : {}),
      },
      /**
       * ⭐ EVERY GENERATIVE ATTEMPT THIS TURN MADE, off the provider policy's ledger
       * (`adapters/llm/provider-policy.ts`) — including those beneath internal
       * dispatch. The OpenAI-only proof is read from here: any `anthropic` row is a
       * failure even though it was `refused_before_network`.
       */
      _provider_calls: recordedProviderCalls(),
        ...(providerLedgerTruncated() ? { _provider_calls_truncated: true } : {}),
    });
  };
  app.post('/agent/v1/turn', (req: FastifyRequest, reply: FastifyReply) =>
    runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'), () => agentTurnHandler(req, reply)));

  log.info({ event: 'agent_lane.route_mounted' }, 'POST /agent/v1/turn mounted');
}
