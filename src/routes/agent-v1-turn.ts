import { STATIC_MODEL_SCOPE_NOTE } from '../orchestrator-v5/goal-target/static-run-evidence.js';
import { readRecordedRun, restoreRunOperation, runOperationTurnId, type RecoveredRun } from '../orchestrator-v5/agent-lane/run-operation.js';
import { withoutUnsizedLinkInvitation } from '../orchestrator-v5/agent-lane/unsized-path-cause.js';
import { RUN_FACTS_USE } from '../orchestrator-v5/agent-lane/run-facts.js';
import { buildBaselineHoldSuffix } from '../orchestrator-v5/coaching/scaffold-disclosure.js';
import { figuresIn } from '../orchestrator-v5/agent-lane/licensed-chance-lines.js';
import { postResponses } from '../adapters/llm/openai.js';
import { APIError } from 'openai';
import { type DeadlineTurnStart } from '../orchestrator-v5/agent-lane/deadline-card.js';
import { projectStatedObjections, STATED_OBJECTIONS_CAP } from '../orchestrator-v5/context/stated-objections.js';
/** Hard cap on dissent facts read per turn; paging stops earlier once STATED_OBJECTIONS_CAP different findings are covered. */
const STATED_OBJECTION_FACT_ROWS_READ = 200;
import { steadyHorizonCard } from '../orchestrator-v5/agent-lane/steady-horizon-card.js';
import { refreshScopePending } from '../orchestrator-v5/agent-lane/goal-scope.js';
import { parsePendingAction } from '../orchestrator-v5/session/pending-action.js';
import { CURRENT_LEVEL_TOOL, currentLevelAnswerFirstCall, currentLevelAskOnAnswer, latestCurrentLevelAsk } from '../orchestrator-v5/agent-lane/current-level-answer.js';
import { pairProviderInput } from '../orchestrator-v5/agent-lane/provider-input-pairing.js';
import { currentLevelAskForAnswerRow } from '../orchestrator-v5/agent-lane/current-level-ask-carry.js';
import { parseAnswerOffers, storedOfferId } from '../orchestrator-v5/agent-lane/answer-offers-envelope.js';
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

import { runFencedInProcessWrite } from '../orchestrator/turn-fence-prehandler.js';
import { turnContextItems, runFactsContext } from '../orchestrator-v5/agent-lane/turn-context.js';
import { isRunExplanationChip, runExplanationKeyForRecord, runExplanationChip, runExplanationMatches, RUN_EXPLANATION_PREFIX, RUN_EXPLANATION_MESSAGE, RUN_RESULT_READY_TEXT, RUN_EXPLANATION_UNAVAILABLE_TEXT, RUN_EXPLANATION_LEGACY_UNAVAILABLE_TEXT } from '../orchestrator-v5/agent-lane/run-explanation.js';
import { tippingPointCoachingFor, settleTippingPointCoaching, TIPPING_POINT_PRESS_ID, type TippingPointCoaching } from '../orchestrator-v5/agent-lane/tipping-point-coaching.js';
import { checkRerunExplanation, rerunExplanationPlan, rerunViewFailures } from '../orchestrator-v5/agent-lane/rerun-explanation.js';
import { rerunPairReadForRunDelta } from '../orchestrator-v5/agent-lane/rerun-within-band.js';

/** B8: a fence infrastructure refusal is the door's typed refusal — nothing was written (CODEX CR 5934133792). */
const fenceRefused = (verdict: 'unclaimed' | 'unavailable') => ({ status: 'refused' as const, reason: `turn_fence_${verdict}` });
import { withRunStateFreshness } from '../orchestrator-v5/agent-lane/analysis-ready-freshness.js';
import { readStoredGoalCertainty, type StoredGoalCertainty } from '../orchestrator-v5/tools/handlers/run-goal-certainty.js';
import { readStoredOptionParticipation, type RecordedRunOptionSet, type StoredOptionParticipation } from '../orchestrator-v5/tools/handlers/option-participation.js';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/index.js';
import { OPENAI_ONLY, providerCallsMade, providerLedgerTruncated, recordProviderUsage, recordProviderRetry, recordedProviderCalls, runWithProviderPolicy, type ProviderCallHandle } from '../adapters/llm/provider-policy.js';
import { RESEARCH_CHIP_PREFIX, RESEARCH_NOT_ON_OFFER_TEXT, RESEARCH_ONLY_SHOWN_TEXT, RESEARCH_WORDING_REASON_TEXT, approvedQueryOf, readResearchResponse, researchChipFor, researchReplyText, researchRequestBody, withResearchControlTruth, type ResearchOutcome } from '../orchestrator-v5/agent-lane/runtime/public-research.js';
import { agentRequestIdentity, conversationPromptAlias } from '../orchestrator-v5/agent-lane/runtime/prompt-identity.js';
import { composeHeldResultReply, composeProposalReply } from '../orchestrator-v5/agent-lane/proposal-reply.js';
import { firstAnalysisResultReply } from '../orchestrator-v5/agent-lane/first-analysis-result-reply.js';
import { TURN_RESPONSE_HEADROOM_MS } from '../config/timeouts.js';
import { CONSTRUCTION_TAIL_RESERVE_MS } from '../orchestrator-v5/agent-lane/runtime/construction-deadline.js';
export { CONSTRUCTION_TAIL_RESERVE_MS } from '../orchestrator-v5/agent-lane/runtime/construction-deadline.js';
import { getSessionStore } from '../orchestrator-v5/session/index.js';
import { answerRunNarrationOf, type CommittedTurnRecord, type OpenAiPausedRun } from '../orchestrator-v5/session/store.js';
import { ModelReadFailedError, isRevisionConflict, promoteRevisionConflictResponse } from '../orchestrator-v5/graph-revision-conflict.js';
import { toErrorV1 } from '../utils/errors.js';
import { appendCheckedGraphWrite } from '../orchestrator-v5/persist-graph-write.js';
import { ModelWriteOwnershipRefused, MODEL_WRITE_OWNERSHIP_REFUSAL_BODY, readSuccessfulDoorEntries, readUnsavableEffects, recordUnsavableEffect, recordReleasedTurnClaim } from '../orchestrator-v5/ownership/door-ownership.js';
import { runAsAgentSubturn } from '../orchestrator-v5/session/agent-subturn-context.js';
import { collectTurnReceipts } from '../orchestrator-v5/agent-lane/turn-receipts.js';
import { withCurrentGraphHash } from '../orchestrator-v5/agent-lane/analysis-freshness-stamp.js';
import { BOARD_EDIT_PREFIX, DURABLE_SEED_ROWS_READ, HistoryStore, dropSupersededPairs, historyFromDurableTurns, historyWithSentText, needsDurableSeed, pruneSupersededToolOutputs } from '../orchestrator-v5/agent-lane/history-store.js';
import { contextBindingSecret, issueContextPacket } from '../orchestrator-v5/agent-lane/runtime/request-assembly.js';
import { internalHeaders } from '../orchestrator-v5/agent-lane/internal-headers.js';
import { log } from '../utils/telemetry.js';
import { asVerdictState, readLimitVerdicts, type StoredLimitVerdicts } from '../orchestrator/context/constraint-feasibility.js';
import { composeDirectAnswerResponse } from '../orchestrator-v5/compose.js';
import { finaliseV5Response } from '../orchestrator-v5/response-finaliser.js';
import { runOmittedRisks, type RunOmittedRisk } from '../orchestrator-v5/agent-lane/unsized-risk.js';
import { drawnLinkPress, isDrawnLinkPress } from '../orchestrator-v5/agent-lane/drawn-link-press.js';
import { answerIsIncomplete, heldChangeSentence, runAgentTurn, WITHHELD_ON_CHIP_TURN, type AgentTurnResult, type CallModel } from '../orchestrator-v5/agent-lane/runtime/agent-loop.js';
import { acquireCoreTurnSlot, CoreStateUnavailableError, runCoreTurn, type CoreTurnSdk } from '../orchestrator-v5/agent-lane/core/sdk-turn.js';
import { pathBTools } from '../orchestrator-v5/path-b/tools/index.js';
import { APPLY_CHANGE, isChangeProposal } from '../orchestrator-v5/path-b/tools/change-tools.js';
import { livingViewOf } from '../orchestrator-v5/path-b/living-model/view.js';
import { parseSelectedElements } from '../orchestrator-v5/boundary/request-extensions.js';
import { agentSelectionContext, type AgentSelectionContext } from '../orchestrator-v5/agent-lane/selection-context.js';
import type { AgentLaneMode, AgentToolContext, ToolResult } from '../orchestrator-v5/agent-lane/runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { runExplanationCurrentness } from '../orchestrator-v5/agent-lane/run-currentness.js';
import { turnReadCache, FRESH_READ } from '../orchestrator-v5/agent-lane/turn-read-cache.js';
import { armedRecoveryFault, interruptIfArmed, RecoveryFaultInterrupt } from '../orchestrator-v5/agent-lane/recovery-fault-seam.js';
import { withAnalysisReadDeadline } from '../orchestrator-v5/session/analysis-read-deadline.js';
import { computeAnalysisAffectingGraphHash } from '../orchestrator-v5/context/graph-hash.js';
import { compareAnalysisRunFactIdentity } from '../orchestrator-v5/context/analysis-interpretation-identity.js';
import { notModelledOfRead, notModelledTurnCarrier } from '../orchestrator-v5/agent-lane/not-modelled-carrier.js';
import type { NotModelledManifest } from '../cee/context-integrity/not-modelled-manifest.js';
import { commitLimitAddInProcess, commitLimitEditInProcess, commitOptionLevelsInProcess, type CommitOptionLevelsInput, type CommitOptionLevelsResult, commitOptionRenameInProcess, commitOptionStatusInProcess, commitStructuralDeleteInProcess, holdAddFactorInProcess, holdAddRiskInProcess } from '../orchestrator-v5/system-events/dispatch.js';
import { declinedProposalOf, declineChipIdFor, displayedProposalsOf, shownAsHeldNow, heldChangeName, heldChangeLabel, isHeldProposal, heldProposalId, proposalRecord, agentProposalOf, proposalFieldsWire, heldRecordAppliesAt, heldRecordsApplyAt, issuedTurnIdsForProposalRecords, proposalIssuances, type ProposalRecord } from '../orchestrator-v5/agent-lane/proposal-object/record.js';
import { amendAgentProposal, parseProposalEdits, proposalEditsDigest, readUserEdits } from '../orchestrator-v5/agent-lane/proposal-object/amend.js';
import { refreshedHold, reconcileHeldProposals } from '../orchestrator-v5/agent-lane/proposal-object/lifecycle.js';
import { heldCardStillApplies, heldCardSubjectMoved, heldCardUnderReview } from '../orchestrator-v5/agent-lane/proposal-object/still-applies.js';
import { editsRefusedSentence, heldDeclineSentence, heldLapseSentence, heldReviewSentence, reviewChipFor, reviewedProposalOf, userEditsReceipt, PLAIN_APPROVAL_SUPERSEDED } from '../orchestrator-v5/agent-lane/proposal-object/reply.js';
import { CONVERSATION_ROWS_READ } from './assist.v1.scenario-graph.js';
import { commitOlumiOptionAdoptionInProcess } from '../orchestrator-v5/system-events/olumi-option-adoption.js';
import { readinessSentence, readinessSentenceOnce, readinessViewOf, stillNeededLine } from '../orchestrator-v5/agent-lane/readiness-view.js';
import { treatedAsZeroReplyLine } from '../orchestrator-v5/agent-lane/root-line.js';
import { strictForTheDrafter, type CallStructuredModel, type ConstructionTrace } from '../orchestrator-v5/agent-lane/runtime/build-model.js';
import { widenedLine, widenedRiskNote, widenedRiskMarker, type WidenCounts } from '../orchestrator-v5/agent-lane/runtime/widen-draft.js';
import { providerFailureOf, onceMoreOnTransportFailure } from '../orchestrator-v5/agent-lane/runtime/transport-retry.js';
import { agentProposals as proposals, executableWaitingProposal, identityProposalOfferable, stillValidApprovalOffers } from '../orchestrator-v5/agent-lane/held-approval-offers.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../orchestrator/tools/analysis-ready-helper.js';
import { SessionBindingRegistry } from '../orchestrator-v5/agent-lane/session-binding.js';
import { budgetFor, callEffortFor, conversationBudgetFor, coreBudget, coreReplyBudget, type CallBudget, INTERPRET_DEADLINE, interpretBudget } from '../orchestrator-v5/agent-lane/model-budgets.js';
import { HOST_SCIENCE_AND_SOURCE_RULES, HOST_TOOL_CONTRACT, SELECTED_COACH_V02_TEMPLATE } from '../orchestrator-v5/agent-lane/coach-route-v0_2.js';
import { agentFactorEnrichments } from '../orchestrator-v5/agent-lane/factor-review.js';
import { OLUMI_PURPOSE_INSTRUCTION } from '../orchestrator-v5/agent-lane/olumi-purpose.js';
import { APPROVAL_REQUIRED_WORDS, approvalChoiceWords, narrateWriteOutcome, TYPED_APPROVAL_READ_BY_OLUMI, notAdoptedLine, openQuestionsForReply, staleOnlyByRangeReading, staleResultLine, withoutAgentDirections, withWriteOutcome } from '../orchestrator-v5/agent-lane/write-outcome.js';
import { decisionInputLines, isDecisionInputAsk, risksSaidLeftOutOfTheChance, untestedHorizonLine, untestedHorizonLineForCells, CHANCE_FREE_HORIZON_PREFIX, UNTESTED_HORIZON_PREFIXES, openQuestionsSegment, textAtRest, withB3LinesAtRest, withDecisionInputAskDisplay, withA7AfterGate, type DecisionInputAskContext } from '../orchestrator-v5/agent-lane/decision-input-ask.js';
import { whatChangesFaceLine } from '../orchestrator-v5/goal-target/goal-chance-range-agent.js';
import { conditionalInputBasis, analysedOptionIds } from '../orchestrator-v5/agent-lane/conditional-input-basis.js';
import { isAgentAnswerRow } from '../orchestrator-v5/session/conversation-as-seen.js';
import { linkSizeAsk } from '../orchestrator-v5/agent-lane/link-size-ask.js';
import { noDirectLinkFigureReply } from '../orchestrator-v5/agent-lane/no-direct-link.js';
import { linkSentenceFirstCall } from '../orchestrator-v5/agent-lane/link-sentence-route.js';
import { typedByUser, userWordsOf } from '../orchestrator-v5/agent-lane/stated-by-user.js';
import { disclosuresFor, eventRiskDisclosuresFor, valueChangeDisclosures, withDisclosures, withoutDisclosure } from '../orchestrator-v5/agent-lane/disclosure.js';
import { indexGoalWeightsMessages } from '../orchestrator-v5/goal-target/index-goal-weights-note.js';
import { goalChanceLineOwed, goalChanceSayFromThisTurn, goalChanceSayPromisedThisTurn, goalChanceWithheldOptionsFromThisTurn, goalChanceWithheldForAgent, identityAskLineFor, identityAskLineOwed, targetVerdictWithoutGuidedLinks, withoutAskedQuestion, withRunsSayShownPromise } from '../orchestrator-v5/agent-lane/goal-chance-withheld.js';
import { bindGuidedSizing, guidedSizingActions, guidedSizingForRun, guidedSizingProgress, guidedSizingReplyText, guidedSizingWireAction, guidedSizingOnWire, parseGuidedSizingPress, type GuidedSizingDraft, type GuidedSizingHistory } from '../orchestrator-v5/agent-lane/guided-sizing.js';
import { notTargetTestableSentence, targetTestabilityOf } from '../orchestrator-v5/admission/target-testability.js';
import type { CanonicalAnalysisCell, CanonicalGoalChanceDetail } from './canonical-analysis-view.js';
import { chanceShownFor, type OptionChanceCell } from '../orchestrator-v5/agent-lane/chance-shown.js';
import { goalChanceNotesForAgent, goalChanceScreenLinesForAgent } from '../orchestrator-v5/agent-lane/goal-chance-screen-lines.js';
import { withEstimateGoalPointsAtEgress } from '../orchestrator-v5/agent-lane/goal-chance-estimate-egress.js';
import { collectTurnStateFacts } from '../orchestrator-v5/agent-lane/turn-state-facts.js';
import { withoutProposalIds } from '../orchestrator-v5/agent-lane/display-ids.js';
import { AMEND_CHIP, approvalChipIdFor, approvalChipsFor, linkStrengthCardFor, proposalsAwaitingApproval, typedApprovalOf, WITHDRAW_PROPOSAL, withdrawnThisTurn } from '../orchestrator-v5/agent-lane/approval-chips.js';
import { identityAutoIssueAllowed, identityCardToIssue, identityCardToReoffer, identityIssuedText, identityPartFiguresToIssue, identityReadingOf } from '../orchestrator-v5/agent-lane/identity-card.js';
import { heldFigureAskToConfirm, heldFigureConfirmArgs } from '../orchestrator-v5/agent-lane/held-figure-confirm.js';
import { precedingAssistantText } from '../orchestrator-v5/statement-door/ask.js';
import { doorIssueArgs } from '../orchestrator-v5/statement-door/door.js';
import { identityCardOfferable } from '../orchestrator-v5/system-events/identity-confirm-edit.js';
import { CarriedProposals, withApprovalOfferedOnRow, proposalPendingAction, offeredApproveChipOnRow, rehydrateProposals } from '../orchestrator-v5/agent-lane/durable-proposal.js';
import type { SuggestedAction } from '../orchestrator-v5/compose/types.js';
import { derivePendingActionsFromFinalizedChips } from '../orchestrator-v5/compose/derive-pending-actions.js';
import { isPendingActionExpired, PENDING_ACTIONS_PER_TURN_CAP, type PendingAction } from '../orchestrator-v5/session/pending-action.js';
import { computeSurvivingPriorPendingsDetailed } from '../orchestrator-v5/commit.js';
import { GM_HELD_HANDLER_ID } from '../orchestrator-v5/handlers/edit-graph-referee-gate.js';
import { dispatchTool, laneModeFor, toolsFor } from '../orchestrator-v5/agent-lane/runtime/agent-tools.js';
import { getRuntimeEnv } from '../config/env-resolver.js';
import { buildAppliedGraphWireField } from '../orchestrator-v5/compose/applied-graph-emit.js';
import { currentStageEmitter, graphPreviewEmitted } from '../cee/unified-pipeline/stage-stream-context.js';
import { readBrief, readingWithin, BRIEF_READING_TIMEOUT_MS, BRIEF_ROUTE_WAIT_MS, type CallBriefReading } from '../orchestrator-v5/agent-lane/brief-reading.js';
import { AGENT_NO_LEADER_SENTENCES, enforceAgentLaneLeaderClaimsAtWire, goalFigureCoHoldOf, noLeaderBecauseSentences } from '../orchestrator-v5/agent-lane/withheld-leader-fail-closed.js';
import { ZERO_SPREAD_NEEDS_MONTHLY_CHANGES } from '../orchestrator-v5/goal-target/zero-spread-horizon-line.js';
import { goalHorizonNextStep, goalHorizonReplyLead } from '../orchestrator-v5/goal-target/goal-horizon-detail.js';
import { composeReplyShape, REPLY_SHAPE_INSTRUCTION, sentencesOf, shapeFromDerivedAnswerText, type FaceObligation, type ReplyProfile, withShapeOnlyIfItDerives } from '../orchestrator-v5/agent-lane/reply/compose-reply.js';
import { controlSurvivesLeaderGate, enforceLeaderLicenceAtFinalEgress, leaderGateInputsOf } from '../orchestrator-v5/agent-lane/leader-final-egress.js';
import { withoutDriverAbsenceClaimsAtEgress } from '../orchestrator-v5/agent-lane/goal-chance-driver-egress.js';
import { withLeftOutOptionCorrectionAtEgress } from '../orchestrator-v5/agent-lane/left-out-option-egress.js';
import { AI_WRITES_RUN_TURN } from '../orchestrator-v5/agent-lane/ai-writes-run-turn.js';
import { runToolOutputLicensesLeader } from '../orchestrator-v5/agent-lane/licensed-run-view.js';
import { NOT_ROBUST_NO_FLIP_SENTENCE, NOT_ROBUST_SENTENCE, robustnessHonestySentence } from '../orchestrator-v5/coaching/analysis-result-headline.js';
import { isRawFragile } from '../orchestrator-v5/coaching/robustness-honesty.js';
import { readRawRobustnessSignals } from '../orchestrator-v5/coaching/pick-raw-robustness.js';
import { collectFactorIdsSetByEveryOption } from '../orchestrator-v5/context/intervention-controlled-drivers.js';
import { leaderLicenceFromState } from '../orchestrator-v5/compose/leader-licence.js';
import { firstAnalysisRunReceipt, GUIDANCE_WRAPPER_REFUSAL, runDeliveryFactFor, turnRunReceipts, type RunDeliveryOutcome } from '../orchestrator-v5/agent-lane/run-delivery-fact.js';
import { GUIDANCE_ENTRY_REFUSALS } from '../orchestrator-v5/agent-lane/guidance/held-keys.js';
import { composeLeaderClaim, composeAnalysisStateV1, NO_ANALYSIS_CONTEXT_DERIVATION, WITHHELD_GOAL_SCOPE_UNRESOLVED, WITHHELD_GOAL_PATH_UNSIZED, WITHHELD_SEPARATION_UNAVAILABLE, WITHHELD_LEADER_CAUSE_UNRECORDED } from '../orchestrator-v5/compose/analysis-state-v1.js';
import { canonicalStateFromFreshness } from '../orchestrator-v5/context/canonical-analysis-state.js';
import { readScenarioAnalysis } from './scenario-graph-analysis-read.js';
import { goalScopeClaimInput } from '../orchestrator-v5/compose/goal-scope-claim-input.js';
import { AnalysisStateV1Schema, type AnalysisStateV1 } from '@talchain/schemas/boundary';
import { cardCallFor, isMethodPress, methodTurnForReadback, methodTurnItems, settleMethodTurn, TALK_IT_THROUGH_CHIP, type MethodTurn } from '../orchestrator-v5/agent-lane/method-turn/method-turn.js';
import { premortemProducerDirective, readPremortemProduction, premortemWorksheetDiagnosticsFor, methodReplySurvives } from '../orchestrator-v5/agent-lane/runtime/reasoning-artefacts/premortem.js';
import {
  CANVAS_OPTIONS_PRESS_ID, CANVAS_RISKS_PRESS_ID, isWidenAddPressId, keptProposalOf, modelGapOf, RISK_ADD_REFUSED_REPLY, riskHeldReply, risksTurnForReadback,
  constructionRegistrationTurnId, settleRisksTurn, settleWidenTurn, SUGGEST_RISKS_CHIP as RISKS_PRESS, thinDraftOffer, widenAddCallOf, widenGate, widenNotAdded, widenOffered,
  widenPassingArgs, widenTargetOf, WIDEN_GATE_REFUSAL, WIDEN_PRESS_ID, WIDEN_TOOL, type RunRisksWidenTurn,
  type WidenGateResult, type WidenTurn, type WidenUnavailableTurn,
} from '../orchestrator-v5/agent-lane/method-turn/widen-turn.js';
import { widenTurnForReadback } from '../orchestrator-v5/agent-lane/method-turn/guidance-widen-turn.js';
import { isWhatChangesPress, whatChangesTurnFor, type WhatChangesTurn } from '../orchestrator-v5/agent-lane/method-turn/what-changes-turn.js';
import { dispatchDecisionFlip } from '../orchestrator-v5/handlers/decision-flip-dispatch.js';
import { dispatchStructuralChallenge, readStructuralChallengeReceipt } from '../orchestrator-v5/handlers/structural-challenge-dispatch.js';
import { STRUCTURAL_CHALLENGE_PRESS_PREFIX, parseStructuralChallengePress, structuralChallengePressId, structuralChallengeRefusal, structuralChallengeReplay, structuralChallengeTurnFor, structuralChallengeTurnUnderLicence, type StructuralChallengePressResolution, type StructuralChallengeTurn } from '../orchestrator-v5/agent-lane/method-turn/structural-challenge-turn.js';
import { methodResultForEgress, testLinkMethodResult, whatChangesMethodResult, type MethodResultV1 } from '../orchestrator-v5/agent-lane/actions/method-result.js';
import { readStructuralChallengeEdge } from '../orchestrator-v5/coaching/structural-challenge-eligibility.js';
import { STRENGTHEN_PRESS_CHIP_ID, strengthenCardFor } from '../orchestrator-v5/agent-lane/strengthen-press.js';
import { decisionReviewFor, DECISION_REVIEW_PRESS_ID, type DecisionReviewTurn, type DecisionReviewRead } from '../orchestrator-v5/agent-lane/decision-review-press.js';
import { eligibleInterventionFor, ELIGIBLE_INTERVENTION_INSTRUCTION, selectTurnGuidance, selectTurnGuidanceShown, guidanceRequestOf, type EligibleIntervention, type GuidanceWire, type TurnGuidanceSelection } from '../orchestrator-v5/agent-lane/turn-context/guidance-wire.js';
import { nextStepOffersForTurn, SUGGEST_RISKS_CHIP } from '../orchestrator-v5/agent-lane/next-steps-from-guidance.js';
import { guidanceOnAnswer, thinDraftShownWire, type HandledGuidancePress } from '../orchestrator-v5/agent-lane/turn-context/guidance-history.js';
import { actionFactsOf, type ActionFacts } from '../orchestrator-v5/agent-lane/actions/state.js';
import type { GuidanceState } from '../orchestrator-v5/agent-lane/guidance/index.js';
import { actionBarOf } from '../orchestrator-v5/agent-lane/actions/rank.js';
import { actionPressOf, actionReceiptOf, decidePress, declinedReply, type ActionExit, type ActionPress, type ActionTypedReply } from '../orchestrator-v5/agent-lane/actions/handlers.js';
import { previewBesideItsChip, proposalPreviewFor, type ProposalPreview } from '../orchestrator-v5/agent-lane/turn-context/proposal-preview.js';
import { optionNameAliases } from '../orchestrator-v5/agent-lane/option-name-truth.js';
import { limitAskIdsOf } from '../orchestrator-v5/agent-lane/limit-checks.js';
import type { RunOutcome } from '../orchestrator-v5/agent-lane/run-outcome.js';
import { sanitiseOlumiResponseForEgress } from '../orchestrator-v5/compose/output-safety.js';
import { runDeltaBoundToReadback, runTurnNextMove, withRunDelta, type CapturedAnalysis } from '../orchestrator-v5/agent-lane/analysis-coaching-pass-through.js';
import { breakEvenFor, breakEvenLine, goalNotCheckedLine, cardSaysMissingLevel, thresholdReasonLine, THRESHOLD_REST_STANDS, withBreakEvenAnswer } from '../orchestrator-v5/agent-lane/break-even.js';
import { carriedEffectsTiming } from '../orchestrator-v5/goal-target/carried-effects-timing.js';
import { readEvaluatedIdentityNodeIds } from '../orchestrator-v5/agent-lane/admit-model.js';
import {
  leaderStandingOf,
  provisionalViewOfTurn,
  provisionalViewSidecar,
  readRunInterpretation,
  RUN_INTERPRETATION_FORMAT,
  sanitiseProvisionalView,
  RUN_INTERPRETATION_VIEW_INSTRUCTION,
  type ProvisionalView,
} from '../orchestrator-v5/agent-lane/provisional-view.js';
import {
  bindRunBlocksToReadback,
  claimPermissionsFrom,
  firstAnalysisDeadline,
  firstAnalysisSentence,
  runFirstAnalysisAfterConstruction,
  type FirstAnalysisOutcome,
} from '../orchestrator-v5/agent-lane/first-analysis.js';
import { GraphV3, type GraphV3T } from '../schemas/cee-v3.js';
import { withoutSentenceCopies, withSentenceSaidOnce } from '../orchestrator-v5/routing/answer-shape.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { bindHeldApprovalWriter, commitHeldProposalInProcess } from '../orchestrator-v5/handlers/approve-held-proposal.js';

/**
 * C6-1b: the revision a turn-state packet is bound to when the read found NO graph. Never a hash (a real revision
 * is 64 hex), so it cannot match a populated model; the packet never leaves this process, and its own expectation
 * is built from the same value in the same turn.
 */
const EMPTY_MODEL_REVISION = 'empty-model';

/** The egress sanitiser resolves labels against a PARSED graph; an unparseable read gives it none. */
function parsedGraphOrNull(raw: unknown): GraphV3T | null {
  if (raw === undefined || raw === null) return null;
  const parsed = GraphV3.safeParse(raw);
  return parsed.success ? parsed.data : null;
}


/**
 * T1 (b) — THE INSTRUCTIONS CARRY AN EXPLICIT CACHE BREAKPOINT (OpenAI prompt-caching guide, GPT-5.6+: routing is automatic,
 * the TTL is 30m by default, and a breakpoint may sit only on an `input_text` block — never on top-level `instructions`).
 * The implicit breakpoint ends at the latest message, so two scenarios share no cache entry before their first differing
 * byte; an explicit one at the end of the static Agent instructions lets every converse call read them. Converse only: the
 * interpret call's instructions carry a per-Run line, so a breakpoint there writes an entry nothing reads. The TEXT is
 * unchanged (the ledger's `prompt_sha256` is still of these instructions); only its carrier moves. A provider that refuses
 * the field gets today's request (top-level `instructions`) once and from then on — never a failed turn.
 */
let instructionsBreakpointRefused = false;
function withInstructionsBreakpoint(body: Record<string, unknown>): Record<string, unknown> {
  const { instructions, input } = body;
  if (typeof instructions !== 'string' || instructions.length === 0 || !Array.isArray(input)) return body;
  const developer = { role: 'developer', content: [{ type: 'input_text', text: instructions, prompt_cache_breakpoint: { mode: 'explicit' } }] };
  // Field order kept (the request bytes are pinned): `instructions` leaves, `input` stays where it was.
  return Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'instructions')
    .map(([k, v]) => [k, k === 'input' ? [developer, ...input] : v]));
}
/** The provider's own 400 names the refused parameter (`error.param`); only the breakpoint counts. */
function refusesInstructionsBreakpoint(status: number, text: string): boolean {
  if (status !== 400) return false;
  try {
    const param = (JSON.parse(text) as { error?: { param?: unknown } }).error?.param;
    return typeof param === 'string' && param.includes('prompt_cache_breakpoint');
  } catch { return false; }
}

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

/**
 * ⛔ THE CONSTRUCTION CALL ENDS BY ITS OWN DEADLINE, AND A TIMEOUT OF IT IS NEVER RETRIED
 * (DL CHANGES_REQUIRED on #2113 @ 6aa4f3c2).
 *
 * Its only bound was the global undici Agent (`HTTP_CLIENT_TIMEOUT_MS`, 110 s headers timeout), and
 * `onceMoreOnTransportFailure` retried that timeout. At the 12000 ceiling and the measured 76–87
 * output tok/s, a call needing more than ~8.4–9.6k tokens timed out at 110 s, a SECOND paid call
 * started, the browser proxy answered 504 at 125 s, and the server could register a model at ~220 s —
 * after the user had been told the turn failed.
 *
 * The arithmetic, from this request's start (the origin `firstAnalysisDeadline` uses):
 *     browserProxyTimeoutMs          125 000   the browser gives up here
 *   − TURN_RESPONSE_HEADROOM_MS       10 000   the turn's response tail (the V5 turn budget's, as above)
 *   − CONSTRUCTION_TAIL_RESERVE_MS    15 000   what must follow a build inside the turn: registration and
 *                                              the Agent's one narrating hop (~10–15 s — the same hop
 *                                              `FIRST_ANALYSIS_RESERVE_MS` reserves)
 *   = the construction call must have ENDED by start + 100 s.
 * Its abort budget is what remains of that when it starts (a conversation hop comes first), so it is
 * always below 100 s and below the 110 s undici bound. A first analysis cannot start past its own,
 * earlier deadline and says so (`first-analysis.ts`), so it needs no reserve here.
 */
/** When the construction call must have ended, in a turn that began at `turnStartedAt`. */
export function constructionDeadline(
  turnStartedAt: number,
  proxyTimeoutMs: number = config.proxy.browserProxyTimeoutMs,
): number {
  return turnStartedAt + proxyTimeoutMs - TURN_RESPONSE_HEADROOM_MS - CONSTRUCTION_TAIL_RESERVE_MS;
}
/** The typed reason a construction that ran out of turn budget carries — the truncation label's path. */
export const CONSTRUCTION_TIMEOUT_REASON = 'construction_timeout';
/** Our own abort (`AbortSignal.timeout`) and undici's own timeouts — the failures that must not be retried. */
function isConstructionTimeout(err: unknown): boolean {
  const e = err as { name?: unknown; cause?: { code?: unknown } } | null | undefined;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return true;
  return e?.cause?.code === 'UND_ERR_HEADERS_TIMEOUT' || e?.cause?.code === 'UND_ERR_BODY_TIMEOUT';
}

/** The conversation of record stays Olumi's; this is a per-process cache. */
const histories = new HistoryStore();
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
type ReplayNarration = { status: 'pending' | 'ready' | 'unavailable' | 'stale'; run_key: string };
interface RememberedTurnControls {
  readonly actions: readonly OfferedAction[];
  readonly narration?: ReplayNarration;
  readonly runControlKey?: string;
  readonly sizingRunKey?: string;
}
const offeredActions = new Map<string, RememberedTurnControls>();
/**
 * ⭐ S-D: a held proposal set aside by the persistence floor (a concurrent arrival filled the row AFTER the reply was
 * composed) is said at the start of the scenario's NEXT reply: the composer is the one last writer (#2748). In-process
 * and bounded; a restart in between loses only that one sentence (the proposal itself is already gone from the row).
 */
const owedHeldLapses = new Map<string, string[]>();
const OWED_HELD_LAPSES_MAX = 500;
function oweHeldLapses(scenarioId: string, said: readonly string[]): void {
  if (said.length === 0) return;
  // (deliberately not named after the route's disclosure list, which a source scanner finds by its declaration)
  const lines = [...(owedHeldLapses.get(scenarioId) ?? []), ...said];
  owedHeldLapses.delete(scenarioId);
  if (owedHeldLapses.size >= OWED_HELD_LAPSES_MAX) {
    const oldest = owedHeldLapses.keys().next().value;
    if (oldest !== undefined) owedHeldLapses.delete(oldest);
  }
  owedHeldLapses.set(scenarioId, lines);
}
function takeOwedHeldLapses(scenarioId: string): string[] {
  const lines = owedHeldLapses.get(scenarioId) ?? [];
  owedHeldLapses.delete(scenarioId);
  return lines;
}

function rememberOffered(key: string, controls: RememberedTurnControls): void {
  offeredActions.delete(key);
  if (offeredActions.size >= OFFERED_ACTIONS_MAX) {
    const oldest = offeredActions.keys().next().value;
    if (oldest !== undefined) offeredActions.delete(oldest);
  }
  offeredActions.set(key, controls);
}

/**
 * ⭐ "WHAT WOULD CHANGE THE RESULT?" HAS ONE OWNER, LIVE AND ON REPLAY (Codex P1 #2542). SCI-CHANGE (#2522,
 * `method-turn/what-changes-turn.ts`) and SCI-HERO (#2536, `tipping-point-coaching.ts`) answer the same chip; this
 * selector is the only place that chooses between them. The measured answer is used only while the Run it was measured
 * for is the Run the Explain control binds NOW (`runExplanationMatches`) AND today's leader licence still permits naming
 * a leader (`leaderLicenceFromState`, caveated permission included): its sentences name options, so a revoked claim or an
 * absent / malformed / refused / exploratory admission on the SAME Run withholds them (Codex round 2 P1). Otherwise, and with the kill switch
 * CEE_WHAT_CHANGES_MEASURED_ENABLED=false, the answer is that Run's own tipping-point coaching. A replay never measures
 * again (up to the 70 s ISL cap): it reuses the measured answer this process gave THAT turn, re-checked against today's
 * Run, as the words the user received (`sentText`: the stored reply, so the leader wire gate's caveat stays with it);
 * after a restart, or once the Run has moved, it is today's coaching, as a coaching replay always was.
 */
/**
 * The ONE recorded operation a measured answer is ever given under: the what-changes chip with no `action_type` (as
 * `NEXT_STEP_CHIPS` offers it). A replay recognises its turn from that recorded typed identity, durably: the press resent
 * with its chip, or the UI's chipless retry (`source: 'retry'`) whose stored hash is exactly this operation's (Codex
 * delta P1: a chipless retry skipped the selector and resent the measured words under a withheld licence, warm or cold).
 * A press carrying any other `action_type` is never measured, so its recorded answer is coaching, which names no option.
 */
const WHAT_CHANGES_CHIP_OPERATION = chipOperationOf({ chip: { id: TIPPING_POINT_PRESS_ID } });
const MEASURED_WHAT_CHANGES_MAX = 500;
type MeasuredWhatChanges = { readonly runKey: string; readonly turn: WhatChangesTurn };
const measuredWhatChanges = new Map<string, MeasuredWhatChanges>();
function rememberMeasuredWhatChanges(key: string, measured: MeasuredWhatChanges): void {
  measuredWhatChanges.delete(key);
  if (measuredWhatChanges.size >= MEASURED_WHAT_CHANGES_MAX) {
    const oldest = measuredWhatChanges.keys().next().value;
    if (oldest !== undefined) measuredWhatChanges.delete(oldest);
  }
  measuredWhatChanges.set(key, measured);
}
/** SCI-DEEP binds the remembered typed presentation to today's Run; identical re-presentation permits stored words. */
const PRESENTED_STRUCTURAL_CHALLENGES_MAX = 500;
const presentedStructuralChallenges = new Map<string, StructuralChallengeTurn>();
function rememberStructuralChallenge(key: string, turn: StructuralChallengeTurn): void {
  presentedStructuralChallenges.delete(key);
  if (presentedStructuralChallenges.size >= PRESENTED_STRUCTURAL_CHALLENGES_MAX) {
    const oldest = presentedStructuralChallenges.keys().next().value;
    if (oldest !== undefined) presentedStructuralChallenges.delete(oldest);
  }
  presentedStructuralChallenges.set(key, turn);
}
function whatWouldChangeAnswer(scenarioId: string, read: Parameters<typeof tippingPointCoachingFor>[1] & { readonly analysisReady?: unknown },
  measured: MeasuredWhatChanges | null, sentText?: string | null,
  /** ⭐ Codex P1 #2569: the licence of the read the RESPONSE is composed from (same Run), never an earlier snapshot's. */
  licence: { readonly analysisState?: unknown; readonly analysisReady?: unknown } = read): {
  readonly text: string; readonly tippingTurn: TippingPointCoaching | null; readonly measured: MeasuredWhatChanges | null;
} {
  if (measured !== null && config.features.whatChangesMeasuredEnabled && runExplanationMatches(measured.runKey, scenarioId, read)
    && leaderLicenceFromState(licence.analysisState, licence.analysisReady) !== 'withheld') {
    return { text: sentText ?? measured.turn.reply, tippingTurn: null, measured };
  }
  const tippingTurn = tippingPointCoachingFor(scenarioId, read, licence);
  return { text: tippingTurn.kind === 'found' ? settleTippingPointCoaching(tippingTurn, tippingTurn.reply).reply : tippingTurn.reply,
    tippingTurn, measured: null };
}

/**
 * ⛔ A SEARCH IS BOUGHT ONLY FROM A CONTROL THIS SCENARIO AND SUBJECT WAS SHOWN, ONCE (AI Conversation, #2042 N1). The chip
 * id is a public hash of its query, so a direct request could otherwise send any query and spend a paid search. The ids
 * offered are remembered per scenario and subject, and a press uses its id up. After a restart nothing is remembered: the
 * press then reaches the Agent as words, which never search, and the Agent can offer the search again.
 */
const RESEARCH_OFFERS_MAX = 500;
const researchOffers = new Map<string, Set<string>>();
function rememberResearchOffers(key: string, delivered: unknown): void {
  const ids = (Array.isArray(delivered) ? delivered : []).map((a) => (a as { id?: unknown } | null | undefined)?.id)
    .filter((id): id is string => typeof id === 'string' && id.startsWith(RESEARCH_CHIP_PREFIX));
  if (ids.length === 0) return;
  const held = researchOffers.get(key) ?? new Set<string>();
  researchOffers.delete(key);
  if (researchOffers.size >= RESEARCH_OFFERS_MAX) {
    const oldest = researchOffers.keys().next().value;
    if (oldest !== undefined) researchOffers.delete(oldest);
  }
  for (const id of ids) held.add(id);
  researchOffers.set(key, held);
}
function takeResearchOffer(key: string, id: unknown): boolean {
  return typeof id === 'string' && researchOffers.get(key)?.delete(id) === true;
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
/**
 * ⭐ S-B (github-a2 amendment 6): the typed card an action press prepared (an Agent `prop_` proposal or a product `gmh_`
 * hold) and the chips offered with it, by `${scenario}:${offer_key}`, so the same offer pressed twice (a double click, a
 * retry under a new turn id) re-offers that card while it still waits, never a second one.
 * Process-local and bounded, like `lastApproveOffer`; a restart loses only the re-offer (the card itself stays durable).
 */
const ACTION_OFFER_PROPOSALS_MAX = 500;
const actionOfferProposals = new Map<string, { readonly proposalId: string; readonly chips: readonly OfferedAction[] }>();
function rememberActionOfferProposal(key: string, entry: { readonly proposalId: string; readonly chips: readonly OfferedAction[] }): void {
  actionOfferProposals.delete(key);
  actionOfferProposals.set(key, entry);
  while (actionOfferProposals.size > ACTION_OFFER_PROPOSALS_MAX) actionOfferProposals.delete(actionOfferProposals.keys().next().value as string);
}
/** A typed "can't yet" reply's exits as chips: an offer's own press, the Run, or the existing "what it still needs" turn. */
function actionExitChips(exits: readonly ActionExit[]): OfferedAction[] {
  return exits.map((exit): OfferedAction => exit.kind === 'run' ? { ...RUN_OFFER_CHIP }
    : exit.kind === 'what_it_needs' ? { ...NEXT_STEP_AFTER_BLOCKED_RUN_CHIP }
      : { id: exit.offer.press_id, label: exit.offer.label, message: exit.offer.user_line });
}
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
 * EVERY proposal still waiting for its yes that would execute on this graph, however many (`executableWaitingProposal`
 * wants exactly one, for the chip it re-offers). Any of them makes the turn a decision point for guidance (T2).
 */
function executableWaitingProposalIds(scenarioId: string, userId: string | null, graphHash: string | undefined, graph?: unknown): string[] {
  if (graphHash === undefined) return [];
  return proposals.outstanding(scenarioId, userId).map((p) => p.proposal_id).filter((id) => proposals.authorise({
    proposal_id: id, scenario_id: scenarioId, authenticated_user_id: userId, current_graph_identity_hash: graphHash,
    // The press's own field-scoped rule (#3024): a waiting card whose subject is unchanged still makes this a decision point.
    ...(graph !== undefined ? { scoped_precondition_holds: (p) => heldCardStillApplies(p, graph) } : {}),
    ...(proposals.get(id)?.operations.some(op => op.op === 'attest_goal_steady') ? { typed_approval_of: id } : {}),
  }).status === 'execute' && identityProposalOfferable(proposals.get(id), graph)
    // The rule's other half: a subject moved on an unmoved hash (a renamed goal) is not a decision point.
    && !(graph !== undefined && heldCardSubjectMoved(proposals.get(id)!, graph)));
}

/** The steady-state card is a Run-reply answer, not a held change: it never counts as an approval awaiting a yes. */
function isSteadyCardProposal(id: string | undefined): boolean {
  return id !== undefined && proposals.get(id)?.operations.some(op => op.op === 'attest_goal_steady') === true;
}

/** The offered actions with each id once, the FIRST kept, in order (R3 5910885689: the same card offered twice). */
export function firstOfEachId<T extends { readonly id: string }>(offered: readonly T[]): T[] {
  const seen = new Set<string>();
  return offered.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}

/** The originally offered actions that are still valid on the CURRENT state, in their original order. */
export function stillValidOffers(
  offered: readonly OfferedAction[],
  now: { outstandingProposalIds: ReadonlySet<string>; analysisReady: unknown; analysisState: unknown; modelExists: boolean },
): OfferedAction[] {
  const approvals = stillValidApprovalOffers(offered, now.outstandingProposalIds);
  const declines = offered.filter(a => {
    const id = declinedProposalOf(a.id);
    return id !== undefined && now.outstandingProposalIds.has(id)
      && approvals.some(c => typedApprovalOf({ chip: { id: c.id } }) === id);
  });
  const runKind = (now.analysisState as { run_state?: { kind?: unknown } } | undefined)?.run_state?.kind;
  const run = offered.some((a) => a.id === RUN_OFFER_CHIP.id)
    && admitsRunOffer(now.analysisReady) && runKind !== 'complete_current';
  // The next step after a blocked Run stays offered while the model is KNOWN not to run (process-local,
  // like the approve chip: after a restart the replay carries the words only). A replay whose state read
  // failed is unknown, and an unknown state is never re-advertised as a refusal (#1885 pre-review 5827131835).
  const nextStep = offered.some((a) => a.id === NEXT_STEP_AFTER_BLOCKED_RUN_CHIP.id) && knownNotRunnable(now.analysisReady)
    && !onlyUserCanUnblock(now.analysisReady);
  // Offered only on a refused run (`offersStartingAssumptions`): it stays while the run is KNOWN refused, as the next step does.
  const startingAssumptions = offered.some((a) => a.id === SUGGEST_STARTING_ASSUMPTIONS_CHIP.id) && knownNotRunnable(now.analysisReady);
  // A rebuild stays offered only while there is still no model to build over.
  const rebuild = offered.some((a) => a.id === REBUILD_AFTER_TOO_LARGE_CHIP.id) && !now.modelExists;
  // The next steps stay while the result is still current and no approval is waiting (process-local, like the
  // next step after a blocked Run: after a restart the replay carries the words only).
  const nextSteps = offersNextSteps(now.analysisState) && now.outstandingProposalIds.size === 0
    ? offered.filter((a) => METHOD_PRESS_IDS.has(a.id) || isWidenAddPressId(a.id) || isMethodPress(a.id)) : [];  // Widen sits in a next step's place (DL P2 on #2512)
  return [...approvals, ...declines, ...(run ? [RUN_OFFER_CHIP] : []), ...(nextStep ? [NEXT_STEP_AFTER_BLOCKED_RUN_CHIP] : []), ...(startingAssumptions ? [SUGGEST_STARTING_ASSUMPTIONS_CHIP] : []), ...(rebuild ? [REBUILD_AFTER_TOO_LARGE_CHIP] : []), ...nextSteps];
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
    : 'To change the model you must first call a proposing tool \u2014 propose_model_change for a link (with the strength band the user named, or \u2014 when they described it in their own words \u2014 your reading of them, with their exact phrase as `from_words`; ask how strong first only when their words fit two bands equally or name no strength at all), propose_assumptions to give value-less factors a starting number, propose_option_interventions to record the level an option sets, propose_starting_point for both at once, propose_goal_target for the goal\u2019s success target the user has just stated (their figure, and whether they said at least or at most), propose_new_risk to add a risk the user asked for, propose_new_factor for new factors whose figures the user just stated, propose_new_limit for a budget ceiling the user stated in this message on an existing cost quantity (Explain the returned proposal or revised draft in your own words. Keep its actual quantities, units, timing, source and scope, including what it would replace or leave out. The existing card contains the complete change for approval; your explanation must not change the proposal, imply approval, or claim that it has already been saved.), propose_limit_change for a new figure the user has just stated for a limit the model already holds \u2014 show the user exactly what it returned (in words: never print a proposal_id or any other internal id \u2014 the user approves by simply saying yes), and call authorise_change with that proposal_id ONLY after they have explicitly approved it.';

/**
 * How many recent answers the target ask reads to see whether it is already open (`decision-input-ask.ts`, PANEL 5944136475).
 * A suppressed ask is not in its own row, so the window must reach back to the LAST ask actually said: R3's journey-12
 * (guest 4b218a76) spans 14 turns from the first Run to the last, and at 6 the ask came back mid-journey. 20 covers one
 * session's journey; beyond it, saying the open ask once more is a reminder, not a repeat.
 */
const RECENT_REPLIES_READ = 20;

type RecentRowsReader = { readonly readRecent?: (scenarioId: string, limit?: number) => Promise<readonly { readonly request_hash?: string | null; readonly turn_id?: string | null; readonly assistant_message?: string | null; readonly user_message?: string | null }[]> };
type RecentTextRows = Awaited<ReturnType<NonNullable<RecentRowsReader['readRecent']>>>;

/** Reuse history this turn already read. Missing history leaves only known typed words protected, with no I/O at egress. */
function userTextsForEgress(typed: readonly string[], knownRows?: RecentTextRows): string[] {
  return [...typed, ...(knownRows ?? []).filter(isAgentAnswerRow).flatMap(row => typeof row.user_message === 'string' ? [row.user_message] : [])];
}

/**
 * D1's at-rest lines with the target ask said ONCE (PANEL 5944136475): only when the lines would ask, the Agent's own recent
 * answers are read, and an ask already among them is still open and not said again. ⛔ Only the Agent route's answer rows
 * (`isAgentAnswerRow`): each Run also commits in-process sub-turn rows the user never read, so the cap counts AFTER the drop,
 * over the raw window the Agent's memory reads (`DURABLE_SEED_ROWS_READ`). `exceptTurnId` leaves out the row being replayed:
 * a lost response the user never saw has not said the ask (Codex P2). A failed read asks, as before.
 */
async function decisionLinesAskedOnce(
  graph: unknown, ctx: DecisionInputAskContext, store: RecentRowsReader, scenarioId: string, exceptTurnId: string | undefined,
): Promise<string[]> {
  const lines = decisionInputLines(graph, ctx);
  if (!lines.some(isDecisionInputAsk) || typeof store.readRecent !== 'function') return lines;
  try {
    const recentReplies = await recentAgentReplies(store, scenarioId, exceptTurnId);
    return recentReplies.length > 0 ? decisionInputLines(graph, { ...ctx, recentReplies }) : lines;
  } catch (err) {
    log.warn({ err: String(err), scenario_id: scenarioId }, 'agent-lane: recent answers could not be read — the target ask is said');
    return lines;
  }
}

/**
 * The Agent's own recent answers the user read (`isAgentAnswerRow`), newest first, at most `RECENT_REPLIES_READ`, the same
 * window as the target ask's. `exceptTurnId` leaves out the row being replayed. Throws when the read fails; [] with no reader.
 */
async function recentAgentReplies(store: RecentRowsReader, scenarioId: string, exceptTurnId: string | undefined): Promise<string[]> {
  if (typeof store.readRecent !== 'function') return [];
  return (await store.readRecent(scenarioId, DURABLE_SEED_ROWS_READ))
    .filter((t) => isAgentAnswerRow(t) && (exceptTurnId === undefined || t.turn_id !== exceptTurnId))
    .slice(0, RECENT_REPLIES_READ)
    .map((t) => t.assistant_message)
    .filter((m): m is string => typeof m === 'string');
}

/**
 * ⭐ A7 SAID LAST TURN → MORE DETAIL (DL 58e392 follow-up after RC6; Paul's test 8 Oct: "This model doesn't yet say whether any
 * option gets there within 12 months." on the face of EVERY Run/Explain reply). When the graph owes A7 and the latest answer
 * the user read already said it word for word, this reply types it `detail`: still said, under More detail, never removed.
 * `null` when A7 is not owed, the latest answer did not say it, or the read fails (then it stays where it is).
 */
export { withholdDisclosureForCells as withholdDisclosureFor } from '../orchestrator-v5/agent-lane/reply/compose-reply.js';

/** Normalize only the exact horizon producer identities; the cells select their single replacement form. */
function withCellHorizon(text: string, graph: unknown, cells: readonly CanonicalAnalysisCell[]): string {
  const line = untestedHorizonLineForCells(graph, cells);
  const variants = [untestedHorizonLine(graph, { normalizationOnly: true }), untestedHorizonLine(graph, { besideChance: true, normalizationOnly: true }),
    untestedHorizonLine(graph, { besideChance: true, plural: true, normalizationOnly: true }), untestedHorizonLineForCells(graph, [], true)];
  for (const variant of new Set(variants)) if (variant !== null && variant !== line) text = text.replaceAll(variant, line ?? '');
  // Narration and the host can each carry a different exact producer form. Once the cells unify them, keep ONE copy
  // in its first place; only this typed horizon identity is deduplicated, never arbitrary repeated reasoning.
  const first = line === null ? -1 : text.indexOf(line);
  if (line !== null && first >= 0) text = text.slice(0, first + line.length) + text.slice(first + line.length).replaceAll(line, '');
  return text;
}

/**
 * BYPASS1: the goal-chance detail lines the Run's card says from this view (DGAI `goalChanceDetailLines`): the joint's
 * withheld line and bound, each target on its own (matched by its words; the card names options by the canvas), the status
 * quo by assumption, and the notes. `null` when the view carries no goal-chance detail.
 */
function cardDetailLinesOf(view: unknown): { has(line: string): boolean; disclosures: readonly string[] } | null {
  const card = view as { goal_chance?: CanonicalGoalChanceDetail;
    question?: { scope?: { status?: unknown; note?: unknown } };
    options?: readonly { cell?: { kind?: unknown; face?: unknown } }[] } | null | undefined;
  const detail = card?.goal_chance;
  const staticOnCard = card?.question?.scope?.status === 'supported_static'
    && card.question.scope.note === STATIC_MODEL_SCOPE_NOTE
    && card.options?.some(({ cell }) => (cell?.kind === 'figure' || cell?.kind === 'range')
      && typeof cell.face === 'string' && cell.face.includes(STATIC_MODEL_SCOPE_NOTE)) === true;
  if ((detail === undefined || detail === null) && !staticOnCard) return null;
  const joint = detail?.targets?.joint;
  const exact = new Set([
    ...(joint?.status === 'withheld' ? [joint.line, ...(joint.frechet_line !== undefined ? [joint.frechet_line] : [])] : []),
    ...(detail?.status_quo !== undefined ? [detail.status_quo.line] : []), ...(detail?.notes ?? []),
    ...(staticOnCard ? [STATIC_MODEL_SCOPE_NOTE] : []),
  ]);
  const targetLeads = (detail?.targets?.per_target ?? []).map(t => `On its own, the chance of ${t.words}, in this model: `);
  const findings = new Set((card?.options ?? []).flatMap(({ cell }) => typeof cell?.face === 'string' ? [cell.face] : []));
  return { disclosures: [...exact], has: line => exact.has(line) || findings.has(line) || targetLeads.some(lead => line.startsWith(lead)) };
}

type RunCard = { run?: { run_id?: unknown; graph_hash_at_run?: unknown; computed_at?: unknown };
  staleness?: { stale?: unknown }; options: readonly { option_id: string; cell: CanonicalAnalysisCell }[] };

/** The interpreter and final reply use the same current-card identity test; a value match is never a binding. */
function boundRunCard(view: unknown, scenarioId: string, runIdentity: unknown, analysisResult: unknown): RunCard | undefined {
  if (!validCanonicalAnalysisView(view)) return undefined;
  const card = view as RunCard;
  return card.staleness?.stale === false && typeof card.run?.run_id === 'string' && card.run.run_id !== ''
    && compareAnalysisRunFactIdentity(runIdentity, { scenario_id: scenarioId, graph_hash_at_run: card.run.graph_hash_at_run,
      computed_at: card.run.computed_at }).status === 'match'
    && (analysisResult as { computed_against_hash?: unknown } | null | undefined)?.computed_against_hash === card.run.graph_hash_at_run
    ? card : undefined;
}

/** The latest successful build's typed receipt owns the draft words; narrator prose is never a receipt. */
function widenedCountsOfBuild(result: AgentTurnResult): WidenCounts | null {
  for (let i = result.tool_calls.length - 1; i >= 0; i -= 1) {
    const call = result.tool_calls[i]!;
    if (call.name !== 'build_model_from_brief' || !call.ok || !call.mutated) continue;
    const raw = result.tool_results[i]?.widened;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const counts = raw as Partial<WidenCounts>;
    return typeof counts.options === 'number' && Number.isSafeInteger(counts.options) && counts.options >= 0
      && typeof counts.risks === 'number' && Number.isSafeInteger(counts.risks) && counts.risks >= 0
      ? { options: counts.options, risks: counts.risks } : null;
  }
  return null;
}

/** Persisted draft-widening provenance, not a risk's label or generic AI origin, owns Run disclosures. */
function widenedRunWordsOf(graph: unknown, cells: readonly CanonicalAnalysisCell[], omitted?: readonly RunOmittedRisk[], ownLinesShip = true): { widenedRiskNote?: string; widenedRiskMarker?: string; saidByOwnLines?: true } {
  if (!chanceShownFor(cells)) return {};
  const nodes = (graph as { readonly nodes?: readonly GraphV3T['nodes'][number][] } | null | undefined)?.nodes;
  const addedRisks = Array.isArray(nodes) ? nodes.filter(node => node?.kind === 'risk'
    && node.draft_widening?.provenance === 'ai_suggested_widen') : [];
  // Each added risk's own line already says its option's chance leaves it out: the generic note and its marker would say
  // the same omission again (capacity e2e 57687e86 turn 01, judge row 4). Said once, by the line that names the risk.
  const ownLines = risksSaidLeftOutOfTheChance(graph, cells, omitted);
  if (ownLinesShip && addedRisks.length > 0 && addedRisks.every(risk => ownLines.has(String(risk.id)))) return { saidByOwnLines: true };
  const note = widenedRiskNote({ options: 0, risks: addedRisks.length });
  const marker = widenedRiskMarker(addedRisks);
  return note === null || marker === null ? {} : { widenedRiskNote: note, widenedRiskMarker: marker };
}

/** The final scenario read owns the UI's cells; missing authority never licenses a substitute projection. */
function validCanonicalAnalysisView(value: unknown): value is { options: { option_id: string; cell: CanonicalAnalysisCell }[] } {
  const view = value as { schema?: unknown; source?: unknown; options?: unknown } | null | undefined;
  const options = view?.options;
  const valid = view?.schema === 'canonical_analysis_view.v1' && view.source === 'stored_run_facts'
    && Array.isArray(options) && options.every(row => {
      if (row === null || typeof row !== 'object' || typeof row.option_id !== 'string' || row.option_id.trim() === '') return false;
      const cell = row.cell;
      if (cell === null || typeof cell !== 'object' || Array.isArray(cell)
        || (cell.face !== undefined && typeof cell.face !== 'string')) return false;
      if (cell.kind === 'none') return true;
      if (cell.kind === 'figure') return typeof cell.display === 'string' && cell.display.trim() !== '';
      if (cell.kind === 'range') {
        const detail = cell.detail, depends = detail?.depends_on;
        return typeof cell.display === 'string' && cell.display.trim() !== '' && typeof detail?.range === 'string'
          && depends !== null && typeof depends === 'object'
          && ['link_strength', 'link_existence', 'stated_time'].includes(depends.kind)
          && typeof depends.from_label === 'string' && typeof depends.to_label === 'string'
          && ['all', 'unsized_links'].includes(depends.among)
          && (detail.stated_time === undefined || (typeof detail.stated_time?.estimate === 'string'
            && ['by_date', 'deliverable', 'chance_words', 'slow_time', 'fast_time'].every(key =>
              detail.stated_time[key] === undefined || typeof detail.stated_time[key] === 'string')));
      }
      return cell.kind === 'withheld' && typeof cell.face === 'string' && Array.isArray(cell.reasons) && cell.reasons.length > 0
        && cell.reasons.every((reason: unknown) => reason !== null && typeof reason === 'object'
          && typeof (reason as { code?: unknown }).code === 'string'
          && ((reason as { message?: unknown }).message === null || typeof (reason as { message?: unknown }).message === 'string'));
    });
  return valid;
}

function replyChanceCells(read: Awaited<ReturnType<typeof readBackState>>, scenarioId: string): readonly OptionChanceCell[] {
  const view = read.canonicalAnalysisView;
  if (validCanonicalAnalysisView(view)) return view.options.map(row => ({ ...row.cell, option_id: row.option_id }));
  log.warn({ event: 'agent_lane.canonical_analysis_view_unavailable', scenario_id: scenarioId },
    'agent-lane: final scenario read has no valid canonical analysis cells');
  return [];
}

/** A7 typed `detail` (one role per unit: any other typing of the same line is replaced). Pure; unchanged when `a7` is null. */
export function withA7AsDetail(obligations: readonly FaceObligation[], a7: string | null, text: string, chanceOnFace = false): FaceObligation[] {
  if (chanceOnFace || a7 === null || !text.includes(a7)) return [...obligations];
  return [...obligations.filter((o) => o.text !== a7), { role: 'detail', text: a7 }];
}

async function a7SaidLastTurn(graph: unknown, cells: readonly CanonicalAnalysisCell[], store: RecentRowsReader, scenarioId: string, exceptTurnId: string | undefined): Promise<string | null> {
  const a7 = untestedHorizonLineForCells(graph, cells);
  if (a7 === null) return null;
  try {
    const [latest] = await recentAgentReplies(store, scenarioId, exceptTurnId);
    return typeof latest === 'string' && [...UNTESTED_HORIZON_PREFIXES, CHANCE_FREE_HORIZON_PREFIX].some(prefix => latest.includes(prefix)) && latest.includes(a7) ? a7 : null;
  } catch {
    return null;
  }
}

/**
 * ⭐ NEVER RE-ASK (DL 0df0e1, 6 Oct; Acceptance G1b d4): the recent answers a host line's closing question is checked against
 * (`withoutAskedQuestion`). Read only when one of `lines` asks (`[]` otherwise); a failed read keeps every question, as the
 * target ask does.
 */
async function repliesToCheckAsks(lines: readonly (string | null | undefined)[], store: RecentRowsReader, scenarioId: string,
  exceptTurnId: string | undefined): Promise<string[]> {
  if (!lines.some((l) => typeof l === 'string' && l.trimEnd().endsWith('?'))) return [];
  try {
    return await recentAgentReplies(store, scenarioId, exceptTurnId);
  } catch (err) {
    log.warn({ err: String(err), scenario_id: scenarioId }, 'agent-lane: recent answers could not be read — owed questions are said');
    return [];
  }
}

/** Guided sizing reads the same answer window, retaining recorded edge press identity beside its text. */
async function guidedSizingHistory(store: RecentRowsReader, scenarioId: string, exceptTurnId: string | undefined): Promise<GuidedSizingHistory[]> {
  if (typeof store.readRecent !== 'function') return [];
  try {
    return (await store.readRecent(scenarioId, DURABLE_SEED_ROWS_READ))
      .filter(t => isAgentAnswerRow(t) && (exceptTurnId === undefined || t.turn_id !== exceptTurnId))
      .slice(0, RECENT_REPLIES_READ);
  } catch { return []; }
}

/** `lines` with each already-asked closing question dropped, IN PLACE (a line that was only that question goes). */
function askEachOnce(lines: string[], replies: readonly string[]): void {
  if (replies.length === 0) return;
  lines.splice(0, lines.length, ...lines.map((l) => withoutAskedQuestion(l, replies)).filter((l) => l.trim() !== ''));
}

/** Marks a board edit in the Agent's history — defined beside `needsDurableSeed`, which must recognise it. */
export { BOARD_EDIT_PREFIX } from '../orchestrator-v5/agent-lane/history-store.js';

/**
 * ⭐ THE REPLY'S OWN LENGTH (Paul's staging test, 1 Oct 00:1xZ: "the AI replies are much longer again"; DL #75 5922040401;
 * AIQ bound 5922092866). Measured 0-LLM on R3's seven funding brief turns: the model's own words went from ~100
 * (`base-1449Z` 105 · `train-1924Z` 102 · `train-1942Z` 100) to 180–195 after the v0.2 coach template landed (#2379), and the
 * host then appends 63–115 words of receipt and disclosure (#75 5922398757). So the sentence budgets the MODEL's words to
 * the pre-v0.2 size, which keeps the whole reply inside AIQ's ≤180 / ≤150 / ≤130. It never trades away a truth sentence.
 * Appended after the host contract: no existing rule is restated, moved or dropped.
 *
 * ⭐ K2 (DL #75 5925649954 item 5; R3 5925627855; lease 5925667650): "about" read as a target, and the model kept its own ask
 * beside the host's. R3's 06:00Z acceptance: run1 157 model words with "The useful next step is to state the minimum funding…"
 * right above the host's D1 ask (the same ask twice), examine 2 asks. Now the budgets are LIMITS, one question at most, last,
 * and on a build or Run turn the goal's target is never asked by the model: the host's D1 asks it, in AIQ's direction words
 * (`decision-input-ask.ts`). Real-route A/B, ONLY this sentence swapped, interleaved, request identity equal apart from it
 * (R3 train-0545Z captures; 16 calls): Run turn with the brief in history 101/97 → 89/90 model words, the model's own target
 * ask 2/2 → 0/2 (D1 then asks once), every truth point kept; examine asks 2,1 → 1,1; inspect 84/88 → 86/81.
 */
export const REPLY_LENGTH_INSTRUCTION =
  'Answer the user directly and visibly with the relevant reasoning, uncertainty and next action. The host does not supply a separate explanatory answer. Ask for a necessary missing target or input yourself only when it has not already been supplied; do not re-ask a known figure. Keep concise ordinary replies, with enough detail for the actual question and proposed change. To fit, cut restated model contents, process narration and extra questions first; never drop a caveat that changes the meaning, why a result or a leading option is withheld, a limit, or who supplied a figure.';

/**
 * ⭐ AN OPTION IS NAMED ONLY IN THIS MODEL, AND NEVER "FRAGILE" (WORDING BATCH; DL 0df0e1 lease, 5 Oct ~15:0xZ; Acceptance
 * #87 5996853005 on CEE 0b37e2d). #2588 made Olumi's own Run lines model-relative, but the words the user reads after a Run
 * are this lane's narration, and it said "…scoring highest in about 73% of simulations" and "The finding is fragile…".
 * Host rule #34 itself says "When the result is fragile or a near tie, say that this uncertainty is itself the finding".
 * APPENDED after the reply-length sentence, like it: the v0.2 template and every host rule reach the model unchanged
 * (a swap drops every rule it does not restate, #2379). It reaches both served aliases: `agent.converse` and the Run's
 * `agent.interpret`, whose instructions begin with AGENT_INSTRUCTIONS. It grants nothing: whether a leader may be named
 * is still #34's `claim_permissions.leader_may_be_named`, and the wire gates still drop a ranking on a withheld turn.
 * N is the option's share of runs in which it scored highest, never `probability_of_goal` (#35's "reaches the target").
 * ⛔ POSITIVE MEANING, NO "RECOMMEND" (DL 0df0e1, Acceptance rehearsal 2): the interpret narration glossed N as "…not a
 * recommendation or a 54% chance of meeting your target". The recommend stem is HARD even negated (J1 ruling), so the rule
 * gives N's meaning in positive words and bans the stem outright. Codex r1 #2614: "scored highest" is false for a
 * minimise Run (it came out lowest) and inexact when tied runs split their credit, and the agent cannot rely on knowing
 * the Run's direction, so the rule names an option in Part B's neutral form (DL 6002469285): "N% of runs supported X".
 * Codex r2 #2614: a single option can be named with NO share (run-analysis selectLeadingOptionId accepts a lone row
 * without win_probability), so with no share the rule makes no claim about how runs fell at all.
 */
export const MODEL_RELATIVE_NAMING_INSTRUCTION =
  'Run result replies: lead with the selected Run\'s licensed goal-chance or withholding lines. Retain their target scope, unscored conditions and provisional, timing and source qualifications. Do not state a share of model runs or name a leader from that share in a result reply, even when a comparative leader-naming permission is present. Never substitute a relative ranking for an unavailable goal chance. The separate goal-chance licence governs any comparison of goal chances. In dedicated comparative reasoning only, you may report a permitted share recorded for the selected Run, using the approved credit label and qualifier; never turn it into a recommendation or the chance of the whole goal. Explain the supported implication or useful next action, and what the result rests on, using measured sensitivity and the figure\'s source when available. Never write recommend or recommendation, including negated forms. Never call a result, option or link fragile.';

/**
 * ⭐ D3 step 2, DL 0df0e1 ruling C (6 Oct): step 2 puts each option's licensed chance of meeting the goal in front of the
 * model (`saved_run_options[].probability_of_goal`), so the model is told, typed, how far it may compare them: the Run's
 * own licence (`analysis.goal_chance_licence`, CEE's ≥ 10-point rule, Science d5), never its own reading of the figures.
 * Words follow Wording c6 (6 Oct): "similar chances" below the rule. The egress guard is cut 6.
 */
/**
 * ⭐ G (AIE #94 6133027121, approved verbatim): said ONCE, here, where the Agent receives the selected Run's licence
 * (`analysis.goal_chance_licence`, with its target, `chance_words`, `notes` and `period_end_assumption`). A canonical note beside
 * a figure does not control free prose elsewhere; this does not repair licensing, source loss or approval.
 */
export const SELECTED_RUN_SCOPE_INSTRUCTION = 'Describe the selected Run using its licensed target wording and scope. If it scores only part of the user\'s '
  + 'goal, name that target and retain the unscored conditions; never call its chance the chance of meeting the whole goal. Keep its '
  + 'provisional or timing-assumption qualification in your own explanation.';

export const GOAL_CHANCE_RANKING_INSTRUCTION =
  'Comparing options by their goal chances (any probability_of_goal you are given, including goal_certainty): only as '
  + 'the GOAL_CHANCE_LICENSED record of the result you are reporting allows (CURRENT MODEL STATE analysis.goal_chance_licence, or that '
  + 'record among a run result\u2019s inference_warnings), never by your own reading of the figures; a licence from an earlier result never '
  + 'speaks for a newer one. '
  + 'If its form is highest or highest_all_likely_to_miss, you may say that the option whose option_id is its leader_option_id has the highest '
  + 'chance in this model, naming it by its display label. '
  + 'If its form is similar, say the options in its similar_option_ids have similar chances in this model; never say one is '
  + 'higher, ahead or more likely. '
  + 'For any other form, or with no such licence, give each option\u2019s chance in its recorded order and never rank, order or single '
  + 'out options by it. '
  + SELECTED_RUN_SCOPE_INSTRUCTION;

/**
 * ⭐ HIRING (e) (Paul's funding test 14 Oct: 0 tool calls on a stated capacity effect, per-option staffing and hiring starts).
 * AIE #94 6158232014 (recovery/codex/AIE-Q4-AND-STATED-FIGURE-INSTRUCTIONS-20261014.json), verbatim. Only where tools are
 * offered (`AGENT_TOOL_INSTRUCTIONS`): never on the tool-less Explain, a method, risks or widen call.
 */
export const STATED_FIGURE_INSTRUCTION =
  "When the user supplies a figure that an available proposing tool can faithfully represent, prepare the matching proposal in this turn under that tool's current source and permission contract; do not leave it as acknowledgement in prose. Keep the complete relevant words, speaker, subject, quantity, unit, reference, period, conditions and uncertainty. A question, denial, target, ceiling or forecast is not an observed starting value. Use propose_link_effect for supported magnitudes along an existing matching link; propose_model_change can propose a new link under its own contract, not save its numerical effect. Use propose_option_interventions for an option's supported level, propose_hiring_times for starts after the deadline is held, and propose_assumptions or propose_starting_point for eligible starting values. Use propose_starting_point when starting values and option levels need one compatible approval. Additional hires are distinct from total headcount; a hiring start is distinct from full effectiveness. Never silently change quantity, unit or meaning, invent a missing operand, choose a point from a range or change origin. Show the complete returned card before bound approval; a proposal is not a saved change or Run permission. If the matching quantity, writer or prerequisite is absent, state that actual gap and the supported next step. Retain supplied source for that step rather than asking the user to repeat it after the prerequisite is met.";

// Prompt P13 (AIE one-pass packet 94ad9c8f…): MODEL_RELATIVE_NAMING_INSTRUCTION is now the packet's P13 text, which the
// AIE placed inside HOST_TOOL_CONTRACT's whole replaced entry, so it is sent ONCE there and no longer joined a second time.
const AGENT_INSTRUCTIONS = SELECTED_COACH_V02_TEMPLATE.replace(
  '{{MODE_AND_AUTHORITY}}',
  `${OLUMI_PURPOSE_INSTRUCTION}\n\n${[MUTATION_INSTRUCTION, HOST_TOOL_CONTRACT, REPLY_LENGTH_INSTRUCTION, REPLY_SHAPE_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION].join(' ')}`,
);
/** The Agent's call that offers its proposing tools: the shared instructions, then the stated-figure rule. */
const AGENT_TOOL_INSTRUCTIONS = `${AGENT_INSTRUCTIONS}\n\n${STATED_FIGURE_INSTRUCTION}`;

/**
 * PROMPT ARM B (programme-docs #94 6302769609): AIE-CORE-TOOL-ALIGNMENT-v1, verbatim (#3523 comment 6298433275, packet
 * 4ea5e3ce…). The core agent's own authority, naming only the five tools it has, in place of the legacy mutation, host
 * and stated-figure routing (tools it does not have, another approval and Run flow). Every other section is kept, and so
 * are the host contract's science, source and freshness rules (`HOST_SCIENCE_AND_SOURCE_RULES`, which already carry the
 * model-relative naming rule, P13).
 */
const CORE_AUTHORITY_INSTRUCTION = [
  'Use only the tools declared for this turn and follow their descriptions and returned outcomes. Use the current saved Living Model and its revision as the operative state; keep proposed changes and hypothetical alternatives separate. A later confirmed tool result supersedes the turn-start snapshot only for what that result covers.',
  "For a first model, use build_model_from_brief with the user's actual brief and the complete Living Model. For a requested revision, use propose_change with the complete proposed model. Copy unaffected saved items unchanged, including their ids, wording, sources, party names and quotes; preserve conditions, dissent and required history. Do not preserve an item that the requested correction actually supersedes.",
  "For a prepared revision, apply_change requests commitment and the SDK requires the person's approval of that proposal on its card. Do not treat a typed yes or your own interpretation as the card's approval. Confirm a save only from the operation's own confirmed outcome; a lost or unknown outcome is not proof of either success or failure.",
  "Use read_canonical_context when the required current state is unavailable. Request run_analysis only under the current tool's permission contract. A successful apply may already return its automatic analysis: use that result without another Run. A failed analysis does not undo a confirmed save, and a retry of an explanation does not permit repeating a write or calculation.",
].join('\n\n');
/** The shared coach's starting-input paragraph (legacy proposing tools) and the core copy's replacement (AIE, verbatim). */
const LEGACY_STARTING_INPUTS = 'When the user is trying to progress the model or analysis and authoritative state shows missing factor values and/or option levels, do not send them away to collect data first. Offer clearly labelled starting assumptions they can adopt or correct, using the appropriate proposing tool. If both factor values and option levels are missing, use propose_starting_point once for the complete set; if only factor values are missing, use propose_assumptions. A proposal changes nothing until the user explicitly approves it.';
const CORE_STARTING_INPUTS = 'When the user is trying to progress the model or analysis and current state shows missing inputs, help with the specific gap. Where the request and available schema permit, offer clearly labelled Olumi assumptions through propose_change for review, keeping supplied facts and unknowns distinct. Otherwise explain the missing capability or ask only for the necessary input. A proposal changes nothing until its own approval and confirmed save.';
export const CORE_ALIGNED_INSTRUCTIONS = SELECTED_COACH_V02_TEMPLATE.replace(
  '{{MODE_AND_AUTHORITY}}',
  `${OLUMI_PURPOSE_INSTRUCTION}\n\n${[CORE_AUTHORITY_INSTRUCTION, HOST_SCIENCE_AND_SOURCE_RULES, REPLY_LENGTH_INSTRUCTION, REPLY_SHAPE_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION].join(' ')}`,
).replace(LEGACY_STARTING_INPUTS, CORE_STARTING_INPUTS);
/** The comparison's arm for one request: B only on a core turn that asks for it. Removed, with the losing arm, when it closes. */
export const promptArmOf = (mode: AgentLaneMode, header: unknown): 'A' | 'B' => (mode === 'core' && header === 'B' ? 'B' : 'A');
/** The builder's effort for the configuration comparison (#94): `x-olumi-core-effort` on a core turn, else the banked high. */
export const coreEffortArmOf = (mode: AgentLaneMode, header: unknown): 'low' | 'medium' | undefined =>
  (mode === 'core' && (header === 'medium' || header === 'low') ? header : undefined);

/**
 * ⭐ PATH-B `core` (agent-tools.ts `AgentLaneMode`): Olumi appends and rewrites nothing after the AI's reply, so the reply
 * itself carries what the host would otherwise add, from the typed facts the AI already holds. Sent only in `core`, after
 * the shared instructions, so every other mode's instructions stay byte-identical. ⚠ Prompt text: AIE review owed.
 */
export const CORE_REPLY_INSTRUCTION = 'In this mode Olumi adds nothing to your reply and rewrites none of it: the user reads exactly your words. '
  + 'So say, from this turn\u2019s tool results, what was saved, what was not saved and why, and any proposal that is waiting for the user\u2019s approval on its card. '
  + 'Write one coherent reply in a single voice: give the explanation first, mention what changed since the last Run only when it matters, and weave at most one next step from the current readiness facts into the prose, never as a separate bullet or receipt line and never asking for something the user has already said; ask at most one question per reply. '
  + 'Keep every must_say disclosure and the licences in run_facts: never call a win share a chance, and never call an option best, a winner or recommended. '
  + 'When a calculation rests on Olumi\u2019s own untested assumptions, say \u201cIllustrative calculation \u2014 uses untested Olumi assumptions.\u201d with the material assumptions and exact inputs used; never attribute spread to a stated range the Run did not use. '
  + 'Keep each item\u2019s recorded source: the user\u2019s words stay the user\u2019s, another person\u2019s stay theirs, an unknown source stays unknown, and Olumi\u2019s readings stay Olumi\u2019s; approving a reading adopts it but does not make the user its author. '
  + 'When a tool result carries a Run of the saved model (run_analysis, or the analysis apply_change returns after a saved change), give that Run\u2019s results first, then coach on that same Run: '
  + 'what its result implies for the user\u2019s goal in the current model, what it rests on most, what is still uncertain or missing, and one thing worth checking or testing next, using only the supplied analysis; '
  + 'where run_comparison is given, follow its note. A Run that did not complete leaves a saved change saved: say both. '
  // K3 scope: the AIE's wording, verbatim (19 Oct 19:5xZ; no further ACK). Applied by meaning: no keyword ladder or classifier.
  + "Keep a clearly separate situation out of the current scenario's Living Model. If the relationship to the current scenario is unclear, ask one brief scope question before building or changing the model, while continuing useful discussion. "
  + 'Do not ask again when the person has already made the scope clear. Ordinary expansion and what-ifs within this scenario remain allowed. '
  + 'If the available tools cannot create or work in a separate scenario, say so; do not claim it was created or put its facts into this model instead.';
/** A `core` Run press permits calculation and reading only: every tool but the reader and the Run (`withheldToolsOf`). */
export const CORE_RUN_PRESS_WITHHELD: readonly string[] = ['build_model_from_brief', 'propose_change', 'apply_change'];
/** The instructions for one call in this lane mode: unchanged outside `core`. */
export function instructionsForMode(mode: AgentLaneMode, instructions: string): string {
  return mode === 'core' ? `${instructions}\n\n${CORE_REPLY_INSTRUCTION}` : instructions;
}

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

/**
 * ⭐ A CURRENT RESULT OFFERS THE PRODUCT'S OWN NEXT STEPS (Paul's staging test, 1 Oct 00:1xZ: "the chips are gone
 * (Run, pre-mortem…)"; DL #75 5922040401 + 5922121657). Measured 0-LLM on R3's stored funding trains: every brief and
 * Run turn read back `complete_current` with `usable_for_chips: true` and shipped `suggested_actions: []`, because
 * nothing here offered a step on a result that is already current (the Run chip rightly declines). The earlier "2
 * chips" were the MRR brief's identity approval, never a next step.
 * Plain text (no `action_type`): a press is the user typing it, and on a chip turn the loop withholds
 * `authorise_change` and `run_analysis`, so it approves and runs nothing. Labels are option-neutral under every leader
 * permission, carry no figure and no dash (AIQ 5922131997).
 */
export const NEXT_STEP_CHIPS = [
  { id: 'agent-next-pre-mortem', label: 'Run a pre-mortem', message: 'Run a pre-mortem with me: imagine we went ahead and it went badly. What most plausibly went wrong?' },
  // "this", not "the result": the analysis is a thinking tool, not an oracle (Paul, 10 Sep; the UI's noWinnerVocabulary
  // guard bans "the result" in tab copy, and the tab's own entry reads "What would change this?", DGAI #2479).
  { id: 'agent-next-what-would-change', label: 'What would change this?', message: 'What would most likely change this result?' },
  { id: 'agent-next-strengthen', label: 'Strengthen the model', message: 'What would most strengthen this model?' },
] as const satisfies readonly OfferedAction[];

const NEXT_STEP_CHIP_IDS: ReadonlySet<string> = new Set(NEXT_STEP_CHIPS.map((c) => c.id));

/**
 * ⭐ A4 slice 1: each review item's next step is an EXISTING press, offered as the chip that press already answers: the
 * next steps' own chips (no `action_type`, so What would change keeps its measured operation) and the UI's own
 * "Test without this link" press for the item's link (`TestWithoutLinkButton.tsx`). Nothing new is answerable.
 */
const DECISION_REVIEW_CHIP_OPERATION = chipOperationOf({ chip: { id: DECISION_REVIEW_PRESS_ID } });
function decisionReviewChips(turn: DecisionReviewTurn): OfferedAction[] {
  return turn.steps.flatMap((step): OfferedAction[] => {
    if (step.kind === 'test_without_link') {
      return [{ id: structuralChallengePressId({ from_id: step.from_id, to_id: step.to_id }), label: 'Test without this link', message: 'Test without this link' }];
    }
    const id = step.kind === 'what_would_change' ? TIPPING_POINT_PRESS_ID : STRENGTHEN_PRESS_CHIP_ID;
    return NEXT_STEP_CHIPS.filter((c) => c.id === id).map((c) => ({ ...c }));
  });
}
/** Every press that runs a reasoning method (the selector withholds its rows on one): the next steps and Widen. */
const METHOD_PRESS_IDS: ReadonlySet<string> = new Set([...NEXT_STEP_CHIP_IDS, WIDEN_PRESS_ID, DECISION_REVIEW_PRESS_ID, SUGGEST_RISKS_CHIP.id,
  CANVAS_OPTIONS_PRESS_ID, CANVAS_RISKS_PRESS_ID]);
export { METHOD_PRESS_IDS };

/**
 * Only the plain-text reasoning presses a CURRENT Run offers use the durable offers carrier. The repair chips
 * ("Suggest what it still needs", "Suggest starting assumptions", "Build it again") are not stored: a live turn offers
 * them on a richer predicate than `stillValidOffers` re-checks, so a reload could offer one a turn would not.
 */
export function isDurableAnswerOffer(action: SuggestedAction): boolean {
  return !('action_type' in action) && !('detail' in action)
    && typedApprovalOf({ chip: { id: action.id } }) === undefined
    && action.id !== RUN_OFFER_CHIP.id && !isRunExplanationChip(action.id)
    && (METHOD_PRESS_IDS.has(action.id) || isWidenAddPressId(action.id) || isMethodPress(action.id))
    // ⛔ AIE 6048621134: the answer RPC refuses the WHOLE row on one offer outside the migration's envelope (a widen Add
    // id carries ':'), so the answer was never recorded. An offer the database would refuse stays live and is not stored.
    && parseAnswerOffers([{ id: storedOfferId(action.id), label: action.label, message: action.message }]) !== null;
}

/**
 * The next steps are offered only on a result that is current and that the canonical state lets chips build on
 * (`usable_for_chips`): never on a stale, blocked, absent or unread result, where Run or the repair is the step.
 */
export function offersNextSteps(analysisState: unknown): boolean {
  const s = analysisState as { run_state?: { kind?: unknown }; usable_for_chips?: unknown } | null | undefined;
  return s?.run_state?.kind === 'complete_current' && s.usable_for_chips === true;
}

/**
 * ⭐ "SUGGEST STARTING ASSUMPTIONS" — THE DETERMINISTIC AFFORDANCE (P-CORE #78 5911687135; DL 5912622789 item 5; Paul's
 * test 13:06Z: "always make assumptions about the missing data… alert me"). The state already carried the gaps Olumi may
 * fill (`olumi_can_offer`), and the prompt's rule fired 0–2 times in 4 (P0 2/4, P1a 0/2, P1b 0/2). So the HOST offers the
 * chip when the run is refused and Olumi can offer (`offersStartingAssumptions`), and its press makes the Agent's first
 * call `propose_starting_point` (`firstCallTool`): the user still sees every figure as Olumi's and approves it.
 * Plain text (no `action_type`): the click is an ordinary Agent turn, as `agent-suggest-what-it-needs` is.
 */
export const SUGGEST_STARTING_ASSUMPTIONS_CHIP = {
  id: 'agent-suggest-starting-assumptions',
  label: 'Suggest starting assumptions',
  message: 'Suggest starting assumptions for what this model is missing, so I can review and approve them.',
} as const;

/** The tool a press of {@link SUGGEST_STARTING_ASSUMPTIONS_CHIP} makes first. */
export const STARTING_ASSUMPTIONS_TOOL = 'propose_starting_point';

/** When the chip is offered: the run is KNOWN refused and Olumi can offer something (never on an unchecked verdict). */
export function offersStartingAssumptions(view: { readonly checked: boolean; readonly may_run?: boolean; readonly olumi_can_offer: readonly unknown[] }): boolean {
  return view.checked && view.may_run === false && view.olumi_can_offer.length > 0;
}

/**
 * The chip on the state read back: offered only when it agrees with THIS turn's Run control over the same readback's
 * `analysis_ready` (a KNOWN refusal, as `postWriteReadinessLine`), so it never sits beside a Run button.
 */
export function startingAssumptionsOffered(graph: unknown, analysisReady: unknown): boolean {
  return startingAssumptionsChips(graph, analysisReady).length > 0;
}

/**
 * The chips a known refusal Olumi can help with offers (AIQ 5913289751 follow-up): "Suggest starting assumptions", and
 * ALSO the general next step while the user still owes an input only they can give. Approving Olumi's figures would
 * otherwise meet a refused Run with nothing to press. Empty when the chip is not offered. One readiness view, read once.
 */
export function startingAssumptionsChips(graph: unknown, analysisReady: unknown): OfferedAction[] {
  if (!knownNotRunnable(analysisReady)) return [];
  const view = readinessViewOf(graph);
  if (!offersStartingAssumptions(view)) return [];
  return [SUGGEST_STARTING_ASSUMPTIONS_CHIP, ...(view.needs_from_user.length > 0 ? [NEXT_STEP_AFTER_BLOCKED_RUN_CHIP] : [])];
}

/** The first call's forced tool, only when the request declares a tool of that name. */
export function forcedToolOf(req: unknown): string | undefined {
  const choice = (req as { tool_choice?: unknown } | null | undefined)?.tool_choice as { type?: unknown; name?: unknown } | undefined;
  if (choice === undefined || choice === null || typeof choice !== 'object' || choice.type !== 'function' || typeof choice.name !== 'string') return undefined;
  const tools = (req as { tools?: unknown }).tools;
  const declared = Array.isArray(tools) && tools.some((t) => (t as { name?: unknown } | null)?.name === choice.name);
  return declared ? choice.name : undefined;
}

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
 * R2 T2 (friction audit): every blocker needs the user's own judgement (`human_input_required`), so "Suggest what it
 * still needs" has nothing Olumi could prepare for approval (it produced nothing approvable 4/4); the face already asks.
 */
export function onlyUserCanUnblock(analysisReady: unknown): boolean {
  const issues = (analysisReady as { readiness_issues?: unknown } | null | undefined)?.readiness_issues;
  const blocking = (Array.isArray(issues) ? issues : []).filter((i): i is Record<string, unknown> => i !== null && typeof i === 'object')
    .filter(i => i.obligation !== 'offered' && i.waived_by_exclusion !== true);
  return blocking.length > 0 && blocking.every(i => i.repairability === 'human_input_required');
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
 * ⭐ (B) AFTER A WRITE, ONE SENTENCE SAYS WHETHER THE ANALYSIS CAN RUN NOW (Paul's test, 25 Sep 17:54Z: the
 * model could not run and the reply said "no structural blocker"). Deterministic, from the ONE admission verdict
 * over the graph just read back, in plain words (`readinessSentence`; never a code).
 *
 * ⛔ SAID ONLY WHEN IT AGREES WITH THIS TURN'S RUN CONTROL (`admitsRunOffer` / `knownNotRunnable` over the same
 * readback's `analysis_ready`). A sentence contradicting the button is worse than none, and an unchecked verdict
 * says nothing rather than implying "nothing is blocking".
 *
 * EBD (DL, 12 Oct): with `alreadySaid`, an ask this reply already says is not said again (`readinessSentenceOnce`).
 */
export function postWriteReadinessLine(graph: unknown, analysisReady: unknown, guided?: GuidedSizingDraft,
  alreadySaid?: { readonly text: string; readonly refusalSaid: boolean }): string | null {
  const view = readinessViewOf(graph);
  const say = (v: typeof view): string | null => alreadySaid === undefined ? readinessSentence(v) : readinessSentenceOnce(v, alreadySaid.text, alreadySaid.refusalSaid);
  if (!view.checked) return null;
  if (view.may_run === true && !admitsRunOffer(analysisReady)) return null;
  if (view.may_run === false && !knownNotRunnable(analysisReady)) return null;
  if (guided === undefined) return say(view);
  // The bound presses already ask about these pairs; keep every other target cause in its existing words.
  const filtered = targetVerdictWithoutGuidedLinks(graph, guided.target_verdict ?? targetTestabilityOf(graph), guided);
  const targetWords = filtered === null ? null : notTargetTestableSentence(graph, filtered);
  const { target_not_testable: _sizingAsk, ...withoutTarget } = view;
  return say({ ...withoutTarget, ...(targetWords === null ? {} : { target_not_testable: targetWords }) });
}

/**
 * ⛔ AFTER A WRITE, A LEVEL ONLY THE USER CAN GIVE IS ASKED FOR, EVEN WHEN THE RUN IS ADMITTED (AI Conversation #70
 * 5849012990 U3; DL 5849023213). Said beside "run it again", from the same readback, and only when this turn's Run
 * control admits a run: a refusal already names what it needs (`postWriteReadinessLine`).
 */
export function postWriteAskLine(graph: unknown, analysisReady: unknown): string | null {
  if (!admitsRunOffer(analysisReady)) return null;
  return stillNeededLine(readinessViewOf(graph));
}

/** The approve chip's id prefix, taken from the chip's own producer — never a copy of its string. */
const APPROVE_CHIP_ID_PREFIX = approvalChipIdFor('');

/** Does this response offer an approval: is the approve chip among its `suggested_actions`? */
export function offersApproval(body: { suggested_actions?: unknown }): boolean {
  const actions = body.suggested_actions;
  return Array.isArray(actions) && actions.some((a) => {
    const id = a !== null && typeof a === 'object' ? (a as { id?: unknown }).id : undefined;
    return typeof id === 'string' && id.startsWith(APPROVE_CHIP_ID_PREFIX);
  });
}

/**
 * Did this turn's calls leave a proposal awaiting the user's yes, WHETHER OR NOT a chip names it?
 * `approvalChipsFor` is the rule (a proposing tool that succeeded, after the turn's last model change, not
 * consumed by an authorisation), but it offers a chip only when exactly ONE proposal qualifies: with two
 * pending it offers none and the Agent asks in words. So it is asked about each proposal ALONE — every other
 * proposal's id hidden, every call kept in place so order and mutation still count — and never re-derived.
 */
export function leavesProposalAwaitingApproval(
  calls: readonly { name: string; ok: boolean; mutated: boolean; proposal_id?: string }[],
): boolean {
  // A withdrawal keeps its id too: hiding it would make the change it withdrew look offered.
  return calls.some((c, j) => c.name !== 'authorise_change' && c.name !== WITHDRAW_PROPOSAL && typeof c.proposal_id === 'string'
    && approvalChipsFor(calls.map((d, i) => {
      if (i === j || d.name === 'authorise_change' || d.name === WITHDRAW_PROPOSAL) return d;
      const { proposal_id: _hidden, ...rest } = d;
      return rest;
    })).length > 0);
}

/** Whole-text assembly and its shape-eligibility mirror must place the same sole caveat at rest. */
function placeExplainCaveat(text: string, caveat: string, keepFirst = false): string {
  if (keepFirst) return withB3LinesAtRest(withSentenceSaidOnce(text, caveat, true), [caveat]);
  return withB3LinesAtRest([withoutSentenceCopies(text, caveat).trimEnd(), caveat].filter(Boolean).join(' '), [caveat]);
}

/**
 * Read only the same selected, persisted Run; no transport keep-list or second selection authority.
 * ⭐ SPEED cut 3: a Run no longer stores the factor review, so the LIVE press (`computeIfAbsent`) computes it for that same
 * bound Run, from the Run's own sensitivity, in this turn's provider policy. A replay never calls a model: stored only.
 */
export async function persistedFactorReviewFor(scenarioId: string, read: DecisionReviewRead, requestId: string,
  computeIfAbsent = false): Promise<unknown> {
  const expected = runExplanationChip(scenarioId, read);
  if (expected === null) return undefined;
  try {
    const current = await readScenarioAnalysis({ scenarioId, graph: read.graph, requestId, includeFactorEnrichments: true });
    const actual = runExplanationChip(scenarioId, { graphHash: read.graphHash,
      analysisState: current.analysis_state, analysisResult: current.analysis_result });
    if (actual?.id !== expected.id) return undefined;
    if (current.factor_enrichments !== undefined || !computeIfAbsent) return current.factor_enrichments;
    const sensitivity = ((current.analysis_result as { enrichment?: { factor_sensitivity?: unknown } } | null | undefined)
      ?.enrichment)?.factor_sensitivity;
    // Its own signal, so the extraction's cap (`AGENT_FACTOR_REVIEW_TIMEOUT_MS`) cancels a hung provider call, not only stops waiting.
    return await agentFactorEnrichments(read.graph, sensitivity, requestId, new AbortController().signal);
  } catch {
    return undefined;
  }
}

/** Prefer the identity-bound Run's own deterministic copy; only older summaries need a structural fallback. */
function explainRobustnessSentence(analysisResult: unknown, graph: unknown): string {
  const block = analysisResult as { summary?: unknown; enrichment?: Record<string, unknown> };
  if (typeof block.summary === 'string') {
    for (const sentence of [NOT_ROBUST_NO_FLIP_SENTENCE.trim(), NOT_ROBUST_SENTENCE.trim()]) {
      if (block.summary.includes(sentence)) return sentence;
    }
  }
  const ids = new Set(analysedOptionIds(analysisResult));
  const raw = graph as { nodes?: unknown; options?: unknown } | null | undefined;
  const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const options = Array.isArray(raw?.options) ? raw.options : [];
  const analysedNodes = nodes.filter((n): n is Record<string, unknown> => n !== null && typeof n === 'object'
    && n.kind === 'option' && ids.has(n.id));
  const analysedOptions = options.filter((o): o is Record<string, unknown> => o !== null && typeof o === 'object'
    && ids.has(o.id ?? o.option_id));
  const found = new Set([...analysedNodes.map(n => n.id), ...analysedOptions.map(o => o.id ?? o.option_id)]);
  // No complete analysed roster: omit the vacuity set; only attested_no_flip can select the no-flip sentence.
  const everyOption = ids.size > 0 && [...ids].every(id => found.has(id))
    ? collectFactorIdsSetByEveryOption({ nodes: analysedNodes, options: analysedOptions }) : undefined;
  return robustnessHonestySentence(block.enrichment ?? {}, everyOption);
}

/**
 * ⭐ INTERPRETER v0.2 — THE ARCHITECTURE OWNER'S BANKED TEXT, VERBATIM (RC #63 5803995225:
 * "Interpreter v0.2 is the current prompt candidate"). Source: Talchain/olumi-programme-docs
 * `openai/capability-v01/ANALYSIS_INTERPRETER_PROFILE_v0_2.md` lines 9-33, blob
 * 344896ef92177b7308c1d632699bd98bae10c6b7 (programme-docs main 4961b2d1), with ONE clause changed by S2i (DL P6, 7 Oct):
 * "say investigation priority is not established" → "make no claim about investigation priority beyond the screen's own
 * driver lines; if the screen shows no driver and no range, say it is not established yet" (served B1: "…so investigation
 * priority is not established." beside a range line). PROMPT 28 (AIE packet P17) then replaced that clause's screen-lines
 * deferral with the packet's driver sentence, keeping "make no claim about investigation priority": sha256 begins 272fbbd1fcbe6b2c
 * (pinned by test; d13dd401219ddcb7 with the S2i clause restored, 3d979e8406693be4 with the banked clause). Code only: no prompt store holds this text. APPENDED to the Agent instructions on
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

/** Compatibility export: coaching has one owner, RUN_FACTS_USE. */
export const INTERPRETER_V02_BANKED: string = RUN_FACTS_USE;

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
/** A Run whose own turn failed: nothing ran, nothing changed, and Olumi does not claim to know why. */
export const RUN_FAILED_TEXT = 'I couldn\u2019t run the analysis: something went wrong on Olumi\u2019s side while starting it. Nothing in your model changed, so please try again in a moment.';

/** Request 1 ran, but the readback cannot confirm a current result: Olumi's own line, live and on replay (#2470). */
export const RUN_RESULT_UNVERIFIED_TEXT = 'The analysis finished, but I can’t verify a current result. Check the current results before asking again.';

export function interpretationUnavailableText(ran: { ok?: unknown; ran?: unknown; refusal?: unknown; status?: unknown; what_is_missing?: unknown }, modelChangedThisTurn = false): string {
  if (ran.ran === true) {
    return 'The analysis finished, but I couldn’t explain it this time. You can ask me to explain the result.';
  }
  // The run itself failed (not refused): say only what is true (served 319dde1, 01:42Z — never an invented cause).
  if (ran.refusal === 'run_failed') return `The analysis could not start.${modelChangedThisTurn ? ' Your model was updated this turn.' : ''} Please try again in a moment.`;
  const missing = typeof ran.what_is_missing === 'string' ? ran.what_is_missing.trim() : '';
  if (missing !== '') return `The analysis didn’t run. ${missing}`;
  const code = typeof ran.refusal === 'string' && ran.refusal !== ''
    ? ran.refusal
    : typeof ran.status === 'string' && ran.status !== '' && ran.status !== 'unknown' ? ran.status : '';
  const why = code !== '' ? ` (${code.replace(/_/g, ' ')})` : '';
  return modelChangedThisTurn
    ? `The analysis didn’t run this time${why}. Your model was updated this turn — ask me what changed and what the analysis still needs.`
    : `The analysis didn’t run this time${why}. Ask me what it still needs.`;
}

/**
 * A withheld call consumed no proposal and moved nothing: it is not an authorisation, and counting one (it has no proposal
 * id) would strand the proposal it named without its chip. ONE filter for the chip and for the fallback words that describe
 * it (Codex r1 on #2820: unfiltered, the fallback said "could not settle" beside the chip it offered).
 */
function callsThatCanConsumeProposals<C extends { readonly refusal?: string }>(calls: readonly C[]): C[] {
  return calls.filter((c) => c.refusal !== WITHHELD_ON_CHIP_TURN);
}

/** The turn fields the hop-limit and cut-short answers read (`AgentTurnResult`'s own shape). */
type FallbackTurn = {
  readonly tool_calls: readonly { readonly name: string; readonly ok?: boolean; readonly mutated?: boolean; readonly proposal_id?: string; readonly refusal?: string }[];
  readonly tool_results: readonly unknown[];
  readonly mutated: boolean;
};

/**
 * ⛔ A FALLBACK NEVER CONTRADICTS THE CARD IT SHIPS WITH (DL 58e392, 8 Oct; EDIT-UX served be7a896f, turn 3a5a1258): the
 * hop limit answered "I could not settle that within this turn, and nothing in your model was changed" while the SAME turn
 * offered a held change ("Yes, use those." then saved it). When the turn offers exactly the one card `approvalChipsFor`
 * shows (same predicate, `proposalsAwaitingApproval`), the answer is that held change's own typed reply, else the one
 * held-change sentence. A model change is still said.
 */
function heldCardText(result: FallbackTurn): string | null {
  const offered = proposalsAwaitingApproval(callsThatCanConsumeProposals(result.tool_calls).map((c) => ({ name: c.name, ok: c.ok === true, mutated: c.mutated === true,
    ...(c.proposal_id !== undefined ? { proposal_id: c.proposal_id } : {}), ...(c.refusal !== undefined ? { refusal: c.refusal } : {}) })));
  if (offered.size !== 1) return null;
  const [proposalId, tool] = [...offered.entries()][0]!;
  const held = result.tool_results.find((r) => r !== null && typeof r === 'object' && (r as { proposal_id?: unknown }).proposal_id === proposalId);
  if (held === undefined) return null;
  return composeHeldResultReply(tool, held) ?? heldChangeSentence((held as { public_label?: unknown }).public_label);
}

/**
 * ⛔ WHAT THE USER READS WHEN THE MODEL'S FINAL ANSWER WAS CUT SHORT (AIX-001; R&C #2009 B1/B2): composed from the
 * turn's own outcome, never from the partial text (which is not shown and not kept, so nothing can "continue").
 * After a run: the run's own sentence. A turn that changed the model says so. Otherwise: shorter questions.
 */
export function unfinishedAnswerText(result: FallbackTurn): string {
  for (let i = result.tool_calls.length - 1; i >= 0; i -= 1) {
    if (result.tool_calls[i]!.name === 'run_analysis') {
      // Codex r1 on #2820: a turn that saved something before its run never says "Nothing in the model was changed".
      const ran = interpretationUnavailableText((result.tool_results[i] ?? {}) as Record<string, unknown>, result.mutated);
      const heldAfterRun = heldCardText(result);
      return heldAfterRun === null ? ran : `${ran}\n\n${heldAfterRun}`;
    }
  }
  const held = heldCardText(result);
  if (held !== null) return result.mutated ? `Your model was updated. ${held}` : held;
  return result.mutated
    ? 'Your model was updated, but my reply ran too long and was cut short, so I have not shown it. Ask me what changed.'
    : 'My answer ran too long and was cut short, so I have not shown it. Try asking about one part at a time.';
}

/**
 * ⛔ RT-7 (red team #87 5992627435; re-witnessed on 43e51050, turn 2ff3cc10): WHAT THE USER READS WHEN THE TURN HIT ITS
 * HOP LIMIT. Six in-process refusals used every hop and the user read "Ask me again and I will continue" — false, since
 * asking again replays the same refusals, and the typed reason was thrown away. Composed from the LAST refusal's typed
 * fields only (a refusal's `detail`, `reason` and notes address the Agent, never the user); a changed model says so.
 */
export function hopLimitText(result: FallbackTurn): string {
  const held = heldCardText(result);
  if (held !== null) return result.mutated ? `Your model was updated. ${held}` : held;
  if (result.mutated) return 'Your model was updated, but I could not finish the rest within this turn. Ask me what changed.';
  const last = [...result.tool_results].reverse().find((r): r is Record<string, unknown> =>
    r !== null && typeof r === 'object' && (r as Record<string, unknown>).ok === false);
  if (last !== undefined && typeof last.question === 'string' && last.question.trim() !== '') return last.question.trim();
  const why = last?.refusal === 'nothing_to_set' ? nothingToSetReasons(last) : [];
  return why.length > 0
    ? `Nothing was changed. ${why.join(' ')}`
    : 'I could not settle that within this turn, and nothing in your model was changed. Try asking for one change at a time.';
}

/** `nothing_to_set`'s typed reasons, in the user's terms (RT-7). */
function nothingToSetReasons(r: Record<string, unknown>): string[] {
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? v as Record<string, unknown> : {});
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const sentence = (t: string): string => (/[.!?]$/.test(t) ? t : `${t}.`);
  const out: string[] = [];
  for (const u of list(r.unresolved).map(str)) if (/^(?:option|factor) "/.test(u)) out.push(`I could not find ${u} in your model.`);
  for (const a of list(r.ambiguous_targets).map(rec)) {
    const named = list(a.candidates).map(rec).filter(c => str(c.label) !== '').map(c => {
      const links = list(c.connected_to).map(str).filter(l => l !== '');
      return `“${str(c.label)}”${links.length > 0 ? ` (linked to ${links.join(', ')})` : ''}`;
    });
    if (str(a.requested) !== '' && named.length > 1) {
      out.push(`More than one thing in your model is called “${str(a.requested)}”: ${named.join(' or ')}. Which do you mean?`);
    }
  }
  for (const f of list(r.no_stated_range).map(rec)) {
    const detail = str(f.detail);
    if (detail !== '') out.push(sentence(detail.includes(str(f.factor)) ? detail : `${str(f.factor)}: ${detail}`));
  }
  for (const f of list(r.not_the_users_figure).map(rec)) {
    if (str(f.factor) !== '' && str(f.option) !== '' && (typeof f.value === 'number' || str(f.value) !== '')) {
      out.push(`${String(f.value)} for ${str(f.factor)} in ${str(f.option)} is not a figure you wrote, so it was not recorded as yours.`);
    }
  }
  for (const a of list(r.already_set).map(str)) if (a !== '') out.push(sentence(a));
  return out;
}

export function typedRunOf(body: Record<string, unknown>): boolean {
  const chip = body['chip'] as { action_type?: unknown; id?: unknown } | null | undefined;
  // A "Test without this link" press is terminal SCI-DEEP whatever else the chip carries: never an ordinary Run.
  if (typeof chip?.id === 'string' && chip.id.startsWith(STRUCTURAL_CHALLENGE_PRESS_PREFIX)) return false;
  // ⭐ S-B (Codex r1 P1-2 on #2751): an action press is dispatched by its id whatever else the chip carries: never a Run.
  if (actionPressOf(chip, body['message']) !== null) return false;
  if (typedApprovalOf(body) !== undefined || isRunExplanationChip(chip?.id)
    || (typeof chip?.id === 'string' && (METHOD_PRESS_IDS.has(chip.id)
      || isMethodPress(chip.id) || isWidenAddPressId(chip.id) || isDrawnLinkPress(chip.id)
      || chip.id === SUGGEST_STARTING_ASSUMPTIONS_CHIP.id))) return false;
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
  if (typedApprovalOf(body) !== undefined) return ['run_analysis'];
  // A Run permits calculation and reading only, never a proposal, construction or approval.
  if (typedRunOf(body)) return toolsFor('full').map((t) => t.name)
    .filter((name) => !['get_canonical_state', 'run_analysis', 'give_provisional_view'].includes(name));
  return CHIP_TURN_WITHHELD_TOOLS;
}

/**
 * C6 (measurement before optimisation, #70 5857659587): one internal dispatch, timed. Every call the turn makes goes
 * through the route's single `dispatch`: its readbacks, and each tool's reads and writes. So the ledger says which calls
 * took the non-model seconds (an approve spends 4.3–5.2 s with no model call; ~2.2 s of every turn is outside the loop).
 * The scenario id is masked, and the ledger is capped. Diagnostic only: nothing reads it.
 */
export interface DispatchTiming { readonly path: string; readonly ms: number; readonly status: number }
const DISPATCH_LEDGER_MAX = 40;
export function timedDispatch(inner: InternalDispatch, ledger: DispatchTiming[], scenarioId: string): InternalDispatch {
  const masked = (path: string): string => (scenarioId === '' ? path : path.split(scenarioId).join(':scenario'));
  return async (path, body) => {
    const t0 = Date.now();
    let status = 0;
    try {
      const res = await inner(path, body);
      status = res.status;
      return res;
    } finally {
      if (ledger.length < DISPATCH_LEDGER_MAX) ledger.push({ path: masked(path), ms: Date.now() - t0, status });
    }
  };
}

/** One uncached scenario SELECT checks the cached view's basis; an unavailable check cannot license UI cells. */
async function canonicalViewBasisUnchanged(store: Pick<ReturnType<typeof getSessionStore>, 'readExistingScenario'>, scenarioId: string,
  read: Awaited<ReturnType<typeof readBackState>>): Promise<boolean> {
  if (typeof store.readExistingScenario !== 'function' || read.graphHash === undefined) return false;
  try {
    const current = await withAnalysisReadDeadline(() => store.readExistingScenario!(scenarioId));
    if (current === null || (read.revision !== undefined && current.revision !== read.revision)) return false;
    // The SAME raw analysis hash is the graph read's CAS base, not the selected Run's historical hash.
    const currentHash = computeAnalysisAffectingGraphHash(current.graph as Parameters<typeof computeAnalysisAffectingGraphHash>[0]);
    return currentHash !== null && currentHash === read.graphHash;
  } catch {
    return false;
  }
}

/** Compose additions AND removals through the canonical authority; a prior claim cannot license its own removal. */
async function withRetainedScopeIssues(read: Awaited<ReturnType<typeof readBackState>>, scenarioId: string, pending: readonly PendingAction[], requestId: string): Promise<typeof read> {
  const scopeInput = goalScopeClaimInput(pending.filter(p => p.scenario_id === scenarioId), read.graph);
  const state = read.analysisState as AnalysisStateV1 | undefined;
  if (scopeInput.issues.length === 0) {
    // Preserve ordinary permitted bytes. Only a scope-withheld verdict needs its canonical inputs reread on removal.
    if (state?.leader_claim?.withheld_reason !== WITHHELD_GOAL_SCOPE_UNRESOLVED) return read;
    const current = await readScenarioAnalysis({ scenarioId, graph: read.graph, revision: read.revision, requestId, goalScopeClaimInput: scopeInput });
    // A different selected Run must never license the old readback's result. An unavailable/moved authority stays closed.
    if (current.analysis_state === null || JSON.stringify(current.analysis_state.run_state) !== JSON.stringify(state.run_state)) {
      return { ...read, scopeOpen: false, analysisState: { ...state,
        leader_claim: composeLeaderClaim({ canonical: null, rawRobustness: null, goalScopeClaimInput: scopeInput }, state.run_state, false),
      } };
    }
    // Restore the verdict and its projected result from this SAME identity-bound canonical read.
    return { ...read, canonicalAnalysisView: current.canonical_analysis_view, scopeOpen: false, analysisState: current.analysis_state, analysisResult: current.analysis_result ?? undefined };
  }
  const authorityAvailable = AnalysisStateV1Schema.safeParse(state).success;
  const base = authorityAvailable ? state! : composeAnalysisStateV1({ canonical: canonicalStateFromFreshness(NO_ANALYSIS_CONTEXT_DERIVATION), rawRobustness: null })!;
  return { ...read, scopeOpen: true, scopeAuthorityUnavailable: !authorityAvailable, analysisState: { ...base,
    leader_claim: composeLeaderClaim({ goalScopeClaimInput: scopeInput, canonical: null, rawRobustness: null },
      base.run_state, base.contradictions?.includes('fact_status_success_but_degraded_newer') === true),
  } };
}

/**
 * ⭐ WOULD A SEARCH CONTROL FOR THIS QUERY BE SHOWN, ON THE STATE AS IT IS NOW? The early check behind
 * `offer_public_research`: the gate's own rule (`controlSurvivesLeaderGate`) on this route's readback. An unsuccessful
 * read licenses nothing (`readBackState` answers a failed read with missing authority, which reads as "no restriction").
 * It is NOT the last word: a Run later in the same turn can change the licence, so the reply's final read decides again.
 */
export async function researchControlShowableNow(dispatch: InternalDispatch, scenarioId: string, query: string): Promise<boolean> {
  const chip = researchChipFor(query);
  if (chip === null) return false;
  let readOk = false;
  const read = await readBackState(async (path, body) => {
    const res = await dispatch(path, body);
    if (res.status === 200) readOk = true;
    return res;
  }, scenarioId);
  return readOk && controlSurvivesLeaderGate(chip, leaderGateInputsOf(read));
}

/**
 * 0.79 SD-1 Slice R (DL #87 option A): the scenario read's selected Run, ONLY when `current_read` says it is
 * `complete_current` and names it (CEE #2654): its `run_id`, the graph it ran against and when it was computed. The
 * run_delivery writer records the turn's delivery against this Run only when it IS the Run this turn made.
 */
export interface ReadbackCurrentRun {
  readonly runId: string;
  readonly graphHashAtRun: string;
  readonly computedAt: string;
}

export function readbackCurrentRun(raw: unknown): ReadbackCurrentRun | undefined {
  const read = raw as { run_state?: { kind?: unknown; computed_at?: unknown } | null; run_id?: unknown; computed_against_hash?: unknown } | null | undefined;
  if (read?.run_state?.kind !== 'complete_current') return undefined;
  const { run_id: runId, computed_against_hash: graphHashAtRun } = read;
  const computedAt = read.run_state.computed_at;
  if (typeof runId !== 'string' || runId === '' || typeof graphHashAtRun !== 'string' || graphHashAtRun === ''
    || typeof computedAt !== 'string' || computedAt === '') return undefined;
  return { runId, graphHashAtRun, computedAt };
}

export async function readBackState(dispatch: InternalDispatch, scenarioId: string): Promise<{ currentRun?: ReadbackCurrentRun; canonicalAnalysisView?: unknown; revision?: number; graphHash?: string; analysisReady?: unknown; draftGraph?: unknown; analysisState?: unknown; analysisResult?: unknown; graph?: unknown; constraintVerdictState?: string | null; leaderLimitRisks?: readonly unknown[] | null; notModelled?: NotModelledManifest; limitVerdicts?: StoredLimitVerdicts; identityEvaluated?: ReadonlySet<string>; goalCertainty?: StoredGoalCertainty; optionParticipation?: StoredOptionParticipation; runOptionSet?: RecordedRunOptionSet; scopeOpen?: boolean; scopeAuthorityUnavailable?: boolean }> {
  let canonicalAnalysisView: unknown;
  let revision: number | undefined;
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
  /** The selected run's constraint verdict state, carried with `analysisResult` (same fact); `null` = not recorded. */
  let constraintVerdictState: string | null | undefined;
  let leaderLimitRisks: readonly unknown[] | null | undefined;
  /** A7: the read's own `not_modelled`, as read — derived by the read route over this same graph, never here. */
  let notModelled: NotModelledManifest | undefined;
  /** B5: the selected run's per-limit rows (`analysis_limit_verdicts`), same fact and gates as `analysisResult`. */
  let limitVerdicts: StoredLimitVerdicts | undefined;
  /** 0.63.0: the selected run's STORED goal certainty (`analysis_goal_certainty`), same fact and gates as `analysisResult`. */
  let goalCertainty: StoredGoalCertainty | undefined;
  /** 52f8cd: the selected run's `analysis_option_participation`, same fact and gates as `analysisResult`. */
  let optionParticipation: StoredOptionParticipation | undefined;
  /** Q6: the SAME selected fact's complete snapshot/participation projection, produced by the graph reader. */
  let runOptionSet: RecordedRunOptionSet | undefined;
  /**
   * C46 × R3-4 (Canonical criterion 1): the carriers the selected run's engine evaluated
   * (`analysis_identity_evaluated_node_ids`), same fact and gates as `analysisResult`. `undefined` = not attested.
   */
  let identityEvaluated: ReadonlySet<string> | undefined;
  let scopeOpen = false;
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
  /** 0.79 SD-1 Slice R: the read's selected Run, when it is current and identified (the run_delivery writer binds to it). */
  let currentRun: ReadbackCurrentRun | undefined;
  /** The persisted graph as read — the leader wire gate reads its option ROSTER, never a verdict. */
  let graph: unknown;
  try {
    const after = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph`, {});
    if (after.status === 200) {
      graph = after.json.graph;
      currentRun = readbackCurrentRun(after.json.current_read);
      canonicalAnalysisView = after.json.canonical_analysis_view;
      // The graph reader stamps the revision from its SAME scenario snapshot on this view.
      const readRevision = (canonicalAnalysisView as { staleness?: { revision?: unknown } } | null | undefined)?.staleness?.revision;
      revision = typeof readRevision === 'number' && Number.isSafeInteger(readRevision) && readRevision >= 0 ? readRevision : undefined;
      scopeOpen = Array.isArray(after.json.goal_scope_reconciliation) && after.json.goal_scope_reconciliation.length > 0;
      graphHash = typeof after.json.graph_hash === 'string' ? after.json.graph_hash : undefined;
      analysisReady = after.json.analysis_ready;
      // Cold reload and live turns carry the same canonical readiness. The
      // legacy root carrier still wins; the local builder below is fail-soft.
      if (analysisReady === undefined && typeof after.json.current_read === 'object' && after.json.current_read !== null) {
        analysisReady = (after.json.current_read as { analysis_ready?: unknown }).analysis_ready;
      }
      if (typeof after.json.analysis_state === 'object' && after.json.analysis_state !== null) analysisState = after.json.analysis_state;
      if (typeof after.json.analysis_result === 'object' && after.json.analysis_result !== null) {
        // /graph has already gated this stored Run against the graph from the same read.
        analysisResult = after.json.analysis_result;
      }
      // The selected run's own constraint verdict state, bound to the SAME fact as
      // `analysis_result` by the graph read (R&C #70 5842182272). `null` = not recorded.
      // Narrowed through the contract's own enum: a string that is not a state is not carried.
      const cvs = after.json.analysis_constraint_verdict_state;
      if (cvs === null) constraintVerdictState = null;
      else if (asVerdictState(cvs) !== null) constraintVerdictState = asVerdictState(cvs);
      // The selected run's leader-limit risks, from the SAME graph read and fact (Canonical 5843920234:
      // `analysis_leader_limit_risks`). Only `null` or an array is carried; the card checks every element.
      const llr = after.json.analysis_leader_limit_risks;
      if (llr === null || Array.isArray(llr)) leaderLimitRisks = llr;
      notModelled = notModelledOfRead(after.json.not_modelled);
      // Only a pair the 0.60 contract accepts, with at least one row, is carried: absent = not attested.
      limitVerdicts = readLimitVerdicts(after.json.analysis_limit_verdicts) ?? undefined;
      // 0.63.0: only an array the published contract accepts is carried (`[]` included): absent = not recorded.
      goalCertainty = readStoredGoalCertainty(after.json.analysis_goal_certainty);
      // 52f8cd: only an array the published contract accepts is carried (`[]` included): absent = not recorded.
      optionParticipation = readStoredOptionParticipation(after.json.analysis_option_participation);
      runOptionSet = after.json.analysis_run_option_set as RecordedRunOptionSet | undefined;
      // A product the run's engine evaluated is not one it "adds up": the Agent's view reads it from the SAME read.
      identityEvaluated = readEvaluatedIdentityNodeIds(after.json.analysis_identity_evaluated_node_ids);
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
       * `/assist/v1/scenarios/:id/graph` keeps readiness in `current_read`,
       * rather than at the root. That canonical payload now wins above; this
       * fallback still supplies readiness when the additive analysis read
       * could not answer or an older reader has no whole readiness carrier.
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
      // A brand-new scenario reads back `graph: null` (no model yet): that is no model, never a crash (S1, RCA 14 Oct 16:17Z).
      if (analysisReady === undefined && after.json.graph !== undefined && after.json.graph !== null) {
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
      const g = after.json.graph as GraphV3T | null | undefined;
      if (g !== undefined && g !== null && Array.isArray(g.nodes) && g.nodes.length > 0) {
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

  return { graphHash, analysisReady, draftGraph, canonicalAnalysisView, revision, analysisState, analysisResult, graph, constraintVerdictState, leaderLimitRisks, notModelled, limitVerdicts, identityEvaluated, goalCertainty, optionParticipation, runOptionSet, scopeOpen, currentRun };
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

/**
 * ⛔ THE CHIP IS PART OF WHAT WAS ASKED, TOO (DL P2 on #2481; the class, not the one chip). The same words do different
 * things with and without a chip, and with different chips: every chip turn withholds `authorise_change` and
 * `run_analysis` (`withheldToolsOf`), and the Run, research, Strengthen and starting-assumptions chips each take their
 * own path. So a reused turn_id carrying the same words with another chip, or none, is another request: it meets
 * `TURN_ID_REUSED`, never the other's recorded answer. The approve and explanation chips keep their own operations
 * (`approve:<id>`, the explanation id) inside the digest, unchanged.
 *
 * The chip rides as a SUFFIX (`#chip:<digest>`), not inside the digest, because the UI's own retry resends a turn's words
 * under its turn_id WITHOUT the chip (DGAI `buildPayload.ts`: `chip` only on chip sources; `retryLast` sends
 * `source: 'retry'`). `sameAgentTurnRequest` lets exactly that retry replay the recorded press (Codex pre-review P1).
 */
const CHIP_HASH_SEP = '#chip:';
/**
 * Restart continuity (DL 17:18Z, 14 Oct): a durable answer row's words were TYPED when its stored hash is this subject's
 * PLAIN hash of them: no `#chip:` suffix and no operation in the digest, the same rule as `typedByUser`. The reseed holds
 * proven rows as typed words (`HistoryStore.seed`); every other row stays source-unknown.
 */
export function typedRowProof(scenarioId: string, userId: string | null):
  (row: { request_hash?: string | null; user_message?: string | null; created_at?: string | null }) => boolean {
  return (row) => typeof row.user_message === 'string' && writtenSinceTypedOriginCutoff(row.created_at)
    && row.request_hash === agentTurnRequestHash(scenarioId, userId, row.user_message);
}
/**
 * ⛔ THE CUTOFF (DL, 14 Oct): before DGAI c3a20ea9 (#2792 + #2793 + #2794) the UI sent some of Olumi's own text without a
 * chip (GuidanceStrip discuss and exercise, confirm, OptionsComparison, OptionPreview, DraftNotes, FactorNode, …), so an
 * older row's plain hash does not prove its words were typed. Only rows written once that UI was served are proven:
 * staging's version.json showed c3a20ea9 at 21:03Z (built 20:24:48Z), so the cutoff is that observation, never earlier.
 * An older row, or one with no readable time, stays source-unknown.
 */
export const TYPED_ORIGIN_PROOF_FROM = '2026-10-14T21:03:00Z';
function writtenSinceTypedOriginCutoff(createdAt: string | null | undefined): boolean {
  const at = typeof createdAt === 'string' ? Date.parse(createdAt) : Number.NaN;
  return Number.isFinite(at) && at >= Date.parse(TYPED_ORIGIN_PROOF_FROM);
}
/** A durable typed discriminator lets the UI's chipless retry recognise SCI-DEEP without reversing the digest. */
export const STRUCTURAL_CHALLENGE_HASH_TAG = 'sci-deep:';
export function chipOperationOf(body: Record<string, unknown>): string | undefined {
  const chip = body['chip'];
  if (chip === null || typeof chip !== 'object') return undefined;
  const { id, action_type: actionType } = chip as { id?: unknown; action_type?: unknown };
  return `chip:${JSON.stringify([typeof id === 'string' ? id : null, typeof actionType === 'string' ? actionType : null])}`;
}
/** The turn's request hash with its chip bound, when it has one (see `chipOperationOf`). */
export function withChipOperation(requestHash: string, chipOperation: string | undefined, tag = ''): string {
  return chipOperation === undefined ? requestHash
    : `${requestHash}${CHIP_HASH_SEP}${tag}${createHash('sha256').update(chipOperation).digest('hex').slice(0, 32)}`;
}
/** A UI retry: `source: 'retry'` and no chip (the UI drops it on a retry). */
export function isChiplessRetry(body: Record<string, unknown>): boolean {
  return body['source'] === 'retry' && (body['chip'] === undefined || body['chip'] === null);
}
/**
 * Whether a recorded turn (`stored`) is this request. Exact, except that a chipless UI retry of the same words is the
 * same request as the recorded chip press of those words: it is that press, resent without its chip.
 */
export function sameAgentTurnRequest(stored: string, requested: string, chiplessRetry: boolean): boolean {
  if (stored === requested) return true;
  return chiplessRetry && !requested.includes(CHIP_HASH_SEP) && stored.startsWith(`${requested}${CHIP_HASH_SEP}`);
}

/** Only the AI narrates a core turn. Run data stays intact; the stored Run retains its original summary. */
function turnAnalysisData<T extends { blocks?: unknown }>(response: T, mode: AgentLaneMode): T {
  return mode !== 'core' || !Array.isArray(response.blocks) ? response : { ...response,
    blocks: response.blocks.map(block => block?.type === 'analysis_result' ? { ...block, summary: '' } : block) };
}

export async function agentV1TurnRoute(app: FastifyInstance): Promise<void> {
  // Active requests only: no result/model cache. The existing durable answer floor still decides the one stored reply.
  const activeRunTurns = new Set<string>();
  if (config.proxy.agentLaneEnabled !== true) return;

  /**
   * READ-ONLY preview. Resolved ONCE at registration, not per request, so no
   * request header or body can select the writable surface. A request may only
   * narrow a full lane to `core` (`laneModeFor`, per request below), never widen a preview.
   */
  const baseMode: AgentLaneMode = config.proxy.agentLanePreview === true ? 'preview' : 'full';

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
  const dispatchFor = (authorization: string | undefined, extraHeaders?: Record<string, string>): InternalDispatch =>
    async (path, body) => {
      const res = await app.inject({
        method: 'POST',
        url: path,
        headers: { ...internalHeaders(config.auth.assistApiKey ?? config.auth.assistApiKeys?.[0] ?? '', authorization), ...extraHeaders },
        payload: body as Record<string, unknown>,
      });
      let json: Record<string, unknown> = {};
      try { json = res.json() as Record<string, unknown>; } catch { json = {}; }
      return { status: res.statusCode, json };
    };


  /**
   * ⛔ A CALLER-SET DEADLINE IS THE CALL'S WHOLE BUDGET (CODEX_CLI_OVERFLOW P2 on #2470): such a call is made ONCE. The
   * transport retry re-runs a `fetch failed` with a FRESH deadline, so a deadlined call could take two. Every other call
   * keeps its one transport retry.
   */
  const withTransportRetry = <T>(req: unknown, call: () => Promise<T>): Promise<T> => {
    const deadline = (req as { deadline_ms?: unknown } | null | undefined)?.deadline_ms;
    return typeof deadline === 'number' && deadline > 0 ? call() : onceMoreOnTransportFailure('conversation', call);
  };
  // Use OpenAI's native typed error carrier at the first HTTP error producer; keep the legacy diagnostic bytes.
  const providerHttpError = (response: Response, text = ''): APIError => {
    let body: object | undefined;
    try { body = JSON.parse(text) as object; } catch { /* An unclassified response stays unknown. */ }
    const error = APIError.generate(response.status, body, text, response.headers);
    error.message = `openai_${response.status}${text === '' ? '' : `: ${text.slice(0, 300)}`}`;
    return error;
  };
  const callModelFor = (budget: CallBudget): CallModel => async (req) => {
    let transportAttempt = 0;
    let lastHandle: ProviderCallHandle;
    return withTransportRetry(req, async () => {
      transportAttempt += 1;
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
      /**
       * ⭐ WHICH PROMPT, NOT ONLY WHICH SITE (AIQ identity map @30c0e79c; `prompt-identity.ts`). The Run fast path's one
       * interpreting call (`tool_choice: 'none'`) is `agent.interpret`; every other conversation call is
       * `agent.converse`. The sha is of `req.instructions` — the SAME string the body below sends, so C5b's view line or
       * the interpret-only constraint changes it.
       */
      // Built ONCE: the ledger's identity (PTL row 4) is read from the very object that is sent.
      const alias = conversationPromptAlias((req as { tool_choice?: unknown }).tool_choice);
      const plainBody: Record<string, unknown> = {
        model: budget.model,
        instructions: req.instructions,
        input: pairProviderInput(req.input),
        tools: req.tools,
        // Fast path 3 answers over a run Olumi already made: it may interpret, never act.
        ...((req as { tool_choice?: unknown }).tool_choice === 'none' ? { tool_choice: 'none' } : {}),
        // A pressed chip that names its tool (`firstCallTool`, the loop's first call only): sent only when that tool is
        // among the tools this call declares, so a forced call can never name a tool the turn does not carry.
        ...(forcedToolOf(req) !== undefined ? { tool_choice: { type: 'function', name: forcedToolOf(req) } } : {}),
        // C5b: on a withheld run that one call answers in a typed shape (`RUN_INTERPRETATION_FORMAT`).
        ...((req as { text?: unknown }).text !== undefined ? { text: (req as { text?: unknown }).text } : {}),
        // PJ-C1 (batch 5): the conversation budget's own effort, as construction already sends its budget's (L~1222).
        // P44 S1: a call that only states a held proposal takes the model's banked `narrate` effort (`narrateEffortFor`).
        ...(callEffortFor(budget, req) !== undefined ? { reasoning: { effort: callEffortFor(budget, req) } } : {}),
        max_output_tokens: req.max_output_tokens,
      };
      const deadlineMs = (req as { deadline_ms?: unknown }).deadline_ms;
      const post = (sentBody: Record<string, unknown>, carrier: 'developer_breakpoint' | 'instructions', retryOfHandle?: ProviderCallHandle) => postResponses(sentBody, {
        detail: {
          model: budget.model,
          purpose: req.purpose === 'prewarm' ? 'prewarm' : 'conversation',
          ...agentRequestIdentity(alias, plainBody),
          instructions_carrier: carrier,
        },
        ...(typeof deadlineMs === 'number' && deadlineMs > 0 ? { signal: AbortSignal.timeout(deadlineMs) } : {}),
        onProviderHandle: h => { lastHandle = h; },
        ...(retryOfHandle !== undefined ? { retryOfHandle } : {}),
      });
      const breakpoint = alias === 'agent.converse' && !instructionsBreakpointRefused;
      const retryOfHandle = transportAttempt > 1 ? lastHandle : undefined;
      let { r, usageHandle } = breakpoint
        ? await post(withInstructionsBreakpoint(plainBody), 'developer_breakpoint', retryOfHandle)
        : await post(plainBody, 'instructions', retryOfHandle);
      if (!r.ok) {
        const text = await r.text();
        const refused = breakpoint && refusesInstructionsBreakpoint(r.status, text);
        if (refused && !instructionsBreakpointRefused) {
          instructionsBreakpointRefused = true;
          log.error({ site: 'agent-v1-turn.callModel', status: r.status, detail: text.slice(0, 300) }, 'agent-lane: provider refused the instructions cache breakpoint; sending top-level instructions from now on');
        }
        // ⛔ A PREWARM IS NEVER RESENT (Codex r1 P1 on T1 b): it is unawaited, so a resend could be made after the turn's
        // ledger and `llm_calls_used` are written — a call the turn never counts. The latch alone is its job.
        // ⛔ NOR IS A DEADLINED CALL: its deadline is its whole budget, made once (`withTransportRetry`; CODEX CEE BUDDY pre-read).
        const deadlined = typeof deadlineMs === 'number' && deadlineMs > 0;
        if (!refused || req.purpose === 'prewarm' || deadlined) throw providerHttpError(r, text);
        recordProviderRetry(usageHandle, 'instructions_carrier_fallback');
        ({ r, usageHandle } = await post(plainBody, 'instructions'));
        if (!r.ok) {
          const retryText = await r.text();
          throw providerHttpError(r, retryText);
        }
      }
      const j = (await r.json()) as { output: Record<string, unknown>[]; usage?: unknown; status?: unknown; incomplete_details?: { reason?: unknown } | null };
      // Never throws, and records nothing for a malformed payload, so a successful call
      // cannot be turned into a failed one by the measurement of it.
      recordProviderUsage(usageHandle, j.usage);
      // The usage sidecar is read above and is not part of the transport contract. Completion status IS (AIX-001):
      // an `incomplete` 200 can carry a partial answer.
      return {
        output: j.output,
        ...(typeof j.status === 'string' ? { status: j.status } : {}),
        ...(typeof j.incomplete_details?.reason === 'string' ? { incomplete_reason: j.incomplete_details.reason } : {}),
      };
    });
  };

  /**
   * ⭐ THE ONE PUBLIC RESEARCH REQUEST (R1, `public-research.ts`): the approved query only, native web search required
   * and bounded. Same provider policy and usage ledger as every Agent call; no retry — a failed search is said, and a
   * second paid call is never started on the user's behalf. Returns the native response for the reader.
   */
  const callResearch = async (query: string): Promise<unknown> => {
    const model = budgetFor('gpt-6.1-sol', 'conversation').model;
    // Built once, so the ledger's sha is of the instructions this exact body sends (`RESEARCH_INSTRUCTIONS` today).
    const researchBody = researchRequestBody(query, model);
    const { r, usageHandle } = await postResponses(researchBody, {
      site: 'agent-v1-turn.callResearch',
      detail: { model, purpose: 'public_research', ...agentRequestIdentity('agent.research', researchBody) },
      preserveResponseErrors: true,
      // Bounded (#2042 N2): the captured search took 15 s; a hung one is said as unfinished, never waited on.
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const text = await r.text();
      throw providerHttpError(r, text);
    }
    const j = (await r.json()) as { usage?: unknown };
    recordProviderUsage(usageHandle, j.usage);
    return j;
  };

  /**
   * Structured construction call. Separate from `callModel` because it is a
   * different contract: strict `json_schema` output and its own measured budget
   * (see BANKED_BUDGETS role 'whole'), not the conversation budget.
   *
   * `deadlineAt` is this turn's `constructionDeadline` — every attempt, the transport retry's too, gets
   * only what remains of it. A timeout RETURNS a typed `construction_timeout` instead of throwing, so the
   * retry (kept for a connection-level failure, e.g. a 196 ms `fetch failed`) never repeats it, and with
   * no answer there is nothing to register.
   */
  const callStructured = async (
    reqBody: Parameters<CallStructuredModel>[0],
    deadlineAt: number,
  ): ReturnType<CallStructuredModel> => {
    let transportAttempt = 0;
    let lastHandle: ProviderCallHandle;
    return onceMoreOnTransportFailure('construction', async () => {
      transportAttempt += 1;
      const timedOut = (budgetMs: number, err?: unknown) => {
        log.warn({ site: 'agent-v1-turn.callStructured', purpose: 'construction', budget_ms: budgetMs, ...(err !== undefined ? { err: String(err).slice(0, 200) } : {}) },
          'agent-lane: construction call out of turn budget; not retried, nothing registered');
        return { text: '', status: 'incomplete', incomplete_reason: CONSTRUCTION_TIMEOUT_REASON };
      };
      const budgetMs = deadlineAt - Date.now();
      // Past the deadline no call starts: it could not end before the browser gives up.
      if (budgetMs <= 0) return timedOut(budgetMs);
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
      // `agent.construct` covers BUILD_INSTRUCTIONS and its retry/size/compaction suffixes; the sha tells them apart.
      // Built ONCE: the ledger's identity (PTL row 4) is read from the very object that is sent.
      const sentBody: Record<string, unknown> = {
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
            schema: strictForTheDrafter(reqBody.schema),
          },
        },
      };
      let usageHandle: number | undefined;
      let j: {
        output?: { type?: string; content?: { type?: string; text?: string }[] }[];
        usage?: Record<string, unknown>;
        status?: unknown;
        incomplete_details?: { reason?: unknown } | null;
      };
      try {
        const response = await postResponses(sentBody, {
          site: 'agent-v1-turn.callStructured',
          detail: { model: reqBody.model, purpose: 'construction', ...agentRequestIdentity('agent.construct', sentBody) },
          preserveResponseErrors: true,
          onProviderHandle: h => { lastHandle = h; },
          ...(transportAttempt > 1 ? { retryOfHandle: lastHandle } : {}),
          // The call's OWN bound (see `constructionDeadline`), below the global 110 s undici one.
          signal: AbortSignal.timeout(budgetMs),
        });
        const { r } = response;
        usageHandle = response.usageHandle;
        if (!r.ok) {
          const text = await r.text();
          throw providerHttpError(r, text);
        }
        j = (await r.json()) as typeof j;
      } catch (err) {
        if (isConstructionTimeout(err)) return timedOut(budgetMs, err);
        throw err;
      }
      let text = '';
      for (const item of j.output ?? []) {
        if (item.type !== 'message') continue;
        for (const c of item.content ?? []) if (c.type === 'output_text') text += c.text ?? '';
      }
      // Same contract as the conversation path: never throws, and records nothing for a
      // malformed payload, so measuring a call cannot turn a successful one into a failure.
      recordProviderUsage(usageHandle, j.usage);
      // ⛔ COMPLETION STATUS IS PART OF THE CONTRACT HERE TOO (AIX-001, as `callModel`). It was dropped, so an answer the
      // output cap cut off (served 770a477: output_tokens 6000 exactly, 2/14 first briefs) read as a parse error.
      const incompleteReason = typeof j.incomplete_details?.reason === 'string' ? j.incomplete_details.reason : undefined;
      if (j.status === 'incomplete') {
        log.warn({ site: 'agent-v1-turn.callStructured', purpose: 'construction', incomplete_reason: incompleteReason ?? null, max_output_tokens: reqBody.max_output_tokens }, 'agent-lane: construction answer incomplete');
      }
      return {
        text,
        usage: j.usage,
        ...(typeof j.status === 'string' ? { status: j.status } : {}),
        ...(incompleteReason !== undefined ? { incomplete_reason: incompleteReason } : {}),
      };
    }, (call, err) => log.warn({ err, call }, 'agent-lane transport failure, retrying once'));
  };

  /**
   * ⭐ C6-2: the ONE brief-reading call (`agent-lane/brief-reading.ts`). Same provider policy and usage ledger as every
   * Agent call, its own alias, strict JSON, temperature 0, and a hard abort: a reading that is late is no reading.
   * No retry. It is optional display work, so a failure only means nothing is shown.
   */
  const callBriefReading: CallBriefReading = async (reqBody) => {
    const sentBody: Record<string, unknown> = {
      model: reqBody.model,
      instructions: reqBody.instructions,
      input: reqBody.input,
      temperature: 0,
      max_output_tokens: 600,
      text: { format: { type: 'json_schema', name: 'brief_spans', strict: true, schema: reqBody.schema } },
    };
    const { r, usageHandle } = await postResponses(sentBody, {
      site: 'agent-v1-turn.callBriefReading',
      detail: { model: reqBody.model, purpose: 'brief_reading', ...agentRequestIdentity('agent.read_brief', sentBody) },
      preserveResponseErrors: true,
      readHttpErrorBody: false,
      signal: AbortSignal.timeout(BRIEF_READING_TIMEOUT_MS),
    });
    if (!r.ok) throw providerHttpError(r);
    const j = (await r.json()) as { output?: { type?: string; content?: { type?: string; text?: string }[] }[]; usage?: unknown };
    recordProviderUsage(usageHandle, j.usage);
    let text = '';
    for (const item of j.output ?? []) {
      if (item.type !== 'message') continue;
      for (const c of item.content ?? []) if (c.type === 'output_text') text += c.text ?? '';
    }
    return text;
  };

  /*
   * ⛔ EVERY AGENT TURN IS OPENAI-ONLY (Paul, 23 Sep: zero Anthropic calls on the
   * OpenAI journey). Any Anthropic attempt beneath this turn — including internal
   * dispatch to the conventional handlers — is refused before network I/O and logged
   * (`adapters/llm/provider-policy.ts`).
   */
  const agentTurnHandler = async (req: FastifyRequest, reply: FastifyReply, takeActiveRun: (key: string) => boolean) => {
    const startedAt = Date.now();
    // PATH-B: this request's lane mode. `core` = the AI's own reply, with no Olumi prose added or rewritten (agent-tools.ts).
    const mode: AgentLaneMode = laneModeFor(baseMode, req.headers['x-olumi-ai-mode'], getRuntimeEnv());
    let body = (req.body ?? {}) as Record<string, unknown>;
    const scenarioId = typeof body.scenario_id === 'string' ? body.scenario_id : '';
    // ⭐ Lane A recovery seam (`recovery-fault-seam.ts`): staging-only, off by default, armed by THIS request for its own scenario.
    const recoveryFault = armedRecoveryFault(body, scenarioId);
    if (recoveryFault !== undefined) log.warn({ event: 'v5.recovery_fault.armed', request_id: String(req.id), scenario_id: scenarioId, point: recoveryFault }, 'agent-lane: recovery fault seam armed for this turn');
    const message = typeof body.message === 'string' ? body.message : '';
    /** RT-1: what the user had selected on the canvas (`selection-context.ts`); resolved below against the turn's state. */
    const guidedPress = parseGuidedSizingPress(body['chip']);
    // Ingress edge_id has no authority: the chip's explicit pair enters the canonical selection reader separately.
    const selectedElements = guidedPress === null ? parseSelectedElements(body['selected_elements'])
      : null;
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
       * own authorization — and the response crosses the shared goal-point egress boundary.
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
          ...withEstimateGoalPointsAtEgress(finaliseV5Response(composedRefusal, { scenarioId, runDeltaBoundByCaller: true }), {
            analysisResult: null, graph: null, current: false,
          }),
          _agent: { session_id: sessionId, mode, tool_calls: [], mutated: false, hops: 0, stopped_reason: 'read_only_preview' },
          _provider_calls: recordedProviderCalls(),
        ...(providerLedgerTruncated() ? { _provider_calls_truncated: true } : {}),
        });
      }

      // THIN CORE: the core lane's gestures are checked for a core scenario, whose living model they change.
      const forwarded = await dispatchFor(
        typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
        mode === 'core' ? { 'x-olumi-ai-mode': 'core' } : undefined,
      )('/orchestrate/v2/turn', body);
      // Forwarded board replies use the same current Run boundary before both history and user-visible egress.
      const forwardedState = forwarded.status === 200 && typeof forwarded.json.assistant_text === 'string'
        ? await readBackState(dispatchFor(typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined), scenarioId)
        : undefined;
      const forwardedBody = withEstimateGoalPointsAtEgress(forwarded.json, {
        analysisResult: forwardedState?.analysisResult, graph: forwardedState?.graph,
        current: (forwardedState?.analysisState as { run_state?: { kind?: unknown } } | undefined)?.run_state?.kind === 'complete_current',
        userAuthoredTexts: userTextsForEgress(
          [...histories.typedWords(sessionId), ...(typedByUser(body) ? [message] : [])]),
      });
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
      const narration = typeof forwardedBody.assistant_text === 'string' ? forwardedBody.assistant_text.trim() : '';
      if (forwarded.status === 200 && kind === 'system_event' && narration.length > 0) {
        histories.set(sessionId, [
          ...histories.get(sessionId),
          { role: 'user', content: [{ type: 'input_text', text: `${BOARD_EDIT_PREFIX} ${narration}` }] },
        ]);
        recordUnsavableEffect();
      }
      return reply.code(forwarded.status).send({
        ...forwardedBody,
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

    // Verified identity came from the ownership hook.
    const userId = req.scenarioAccess?.callerUserId ?? null;

    // A session is a correlation token: bound once, verified every time.
    const refusal = sessions.check(sessionId, userId, scenarioId);
    if (refusal !== null && refusal !== 'unknown_session') {
      return reply.code(404).send({ error: 'NOT_FOUND', detail: 'No readable conversation for that scenario.' });
    }
    // A refused session must not provision a scenario or acquire a new binding.
    if (req.scenarioAccess?.provisionIfMissing && !await req.scenarioAccess.provisionIfMissing()) return;
    if (refusal === 'unknown_session') sessions.bind(sessionId, userId, scenarioId);

    const store = getSessionStore();
    let recentRowsForEgress: RecentTextRows | undefined;
    // Existing readers keep their own fail-open contracts and windows. Egress only consumes rows they already obtained.
    const historyReader: RecentRowsReader = typeof store.readRecent === 'function' ? {
      readRecent: async (sid, limit) => {
        const rows = await store.readRecent(sid, limit);
        recentRowsForEgress = rows;
        return rows;
      },
    } : {};
    const dispatchLedger: DispatchTiming[] = [];
    // Every in-process call the Agent makes for this turn is a SUB-TURN: a turn row it commits keeps no conversation
    // text, because the user never saw it (`agent-subturn-context.ts`, #75 5910983526). This route's own claim and
    // answer rows are written outside it, and the board-edit forward above uses its own, unmarked dispatch.
    const internal = dispatchFor(
      typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    );
    const dispatch = timedDispatch(
      (path, body) => runAsAgentSubturn(scenarioId, () => internal(path, body)),
      dispatchLedger, scenarioId);
    /**
     * ⭐ PJ-C1 LATENCY (#72 5861769155): the turn's read cache is made HERE, and its first graph read starts at once,
     * so that ~1 s read runs beside the pending/committed-turn reads and the turn claim below instead of after them
     * (served 84440ff A13: ~560 ms of those, then a 1,011 ms read). The claim row writes no graph
     * (`writesGraph: false`), so the read returns what a read started after it would. See `turnReadCache`.
     */
    const readCache = turnReadCache(dispatch, `/assist/v1/scenarios/${scenarioId}/graph`, [`/assist/v1/scenarios/${scenarioId}/versions`]);
    // Run consumes no graph before its dispatch ends this epoch. Its post-run readers still read fresh.
    // An approval wins over Run and retains its verification reads.
    if (!typedRunOf(body) || typedApprovalOf(body) !== undefined) readCache.prefetch();

    // `let`: R2 T1 binds a composer message that is exactly the ONE waiting card's own button words, below.
    let approvedProposal = typedApprovalOf(body);
    /**
     * ⭐ S-D: the values the user set in the change's panel, sent with that card's press (`proposal_edits`). `undefined`
     * = none sent (a plain approve); `null` = sent but unusable (nothing is applied). Their digest is part of this
     * request's identity, so the same press with other values is a different request (never a replay of the first).
     */
    const proposalEdits = approvedProposal !== undefined ? parseProposalEdits(body['proposal_edits']) : undefined;
    const editsForThisCard = proposalEdits !== undefined && proposalEdits !== null && proposalEdits.proposal_id === approvedProposal
      ? proposalEdits : undefined;
    const explanationId = (body['chip'] as { id?: unknown } | null | undefined)?.id;
    const ownOperation = approvedProposal !== undefined
      ? `approve:${approvedProposal}${editsForThisCard !== undefined ? `:${proposalEditsDigest(editsForThisCard)}` : ''}`
      : isRunExplanationChip(explanationId) ? explanationId : undefined;
    const pressedChipIsStructural = typeof explanationId === 'string' && explanationId.startsWith(STRUCTURAL_CHALLENGE_PRESS_PREFIX);
    let requestHash = withChipOperation(agentTurnRequestHash(scenarioId, userId, message, ownOperation),
      ownOperation === undefined ? chipOperationOf(body) : undefined, pressedChipIsStructural ? STRUCTURAL_CHALLENGE_HASH_TAG : '');
    const chiplessRetry = isChiplessRetry(body);
    /** Live turns and replays resolve issuance exactly as reload does, from one bounded recent window. */
    const proposalIssuers = async (records: readonly ProposalRecord[], pending: readonly PendingAction[]): Promise<ReadonlyMap<string, string>> => {
      if (records.length === 0) return new Map();
      try {
        const rows = await store.readRecent(scenarioId, CONVERSATION_ROWS_READ);
        recentRowsForEgress = rows;
        return await issuedTurnIdsForProposalRecords(proposalIssuances(records, pending), rows, CONVERSATION_ROWS_READ, typeof store.readCommittedTurn === 'function'
          ? id => store.readCommittedTurn!(scenarioId, id) : undefined);
      }
      catch (err) {
        log.warn({ scenario_id: scenarioId, err: String(err) }, 'agent-lane: proposal issuing window unreadable');
        return new Map();
      }
    };
    /** A replay returns the bound presentation on today's state, with no model call. */
    /** The `gmh_` handles of the product's held add-options still live on the latest answer row (C52). A failed read is none. */
    const liveHeldRefs = async (sid: string): Promise<string[]> => {
      if (typeof store.readMostRecentPendingActions !== 'function') return [];
      try {
        return (await store.readMostRecentPendingActions(sid))
          .filter((pa) => pa.action.kind === 'apply_proposed_change'
            && (pa.action as { inline_patch?: { handler_id?: unknown } }).inline_patch?.handler_id === GM_HELD_HANDLER_ID
            && !isPendingActionExpired(pa, Date.now()))
          .map((pa) => pa.chip_id);
      } catch {
        return [];
      }
    };
    const replayed = async (prior: CommittedTurnRecord, scopeIssues: readonly PendingAction[] = []) => {
      const read = await readBackState(dispatch, scenarioId);
      // Failed readback cannot erase today's pending authority; never recover issues from the old answer row.
      const currentPending = typeof store.readMostRecentPendingActions === 'function'
        ? await store.readMostRecentPendingActions(scenarioId, { validation: 'strict' }) : [];
      const currentScope = currentPending.filter(p => p.action.kind === 'reconcile_goal_scope');
      const priorRecords = (prior.pending_actions ?? []).flatMap(p => {
        // Rendering keeps the exact original card even when its old lifetime elapsed; current live membership and
        // the current graph pin below still decide whether this target may be offered at all.
        const emittedAt = Date.parse(p.emitted_at_iso);
        const r = proposalRecord(p, read.graph, Number.isFinite(emittedAt) ? emittedAt : Date.now());
        return r && heldRecordAppliesAt(p, r, read.graph, read.graphHash) ? [r] : [];
      });
      const replayRecords = currentPending.flatMap(p => { const r = proposalRecord(p, read.graph); return r && heldRecordAppliesAt(p, r, read.graph, read.graphHash) ? [r] : []; })
        .sort((a, b) => Date.parse(currentPending.find(p => p.id === a.revision)!.emitted_at_iso) - Date.parse(currentPending.find(p => p.id === b.revision)!.emitted_at_iso))
        // A target-keyed handle may now hold a newer value. Replay binds the old displayed card to its own record, with its
        // LIVE review disposition from the current carrier (Codex BLOCK on #3424 @db2376d0: the old record dropped it).
        .map(r => { const old = priorRecords.find(o => o.proposal_id === r.proposal_id);
          return old === undefined ? r : r.review_action !== undefined ? { ...old, review_action: r.review_action } : old; });
      const replayIssuers = await proposalIssuers(replayRecords, [...currentPending, ...(prior.pending_actions ?? [])]);
      const replayFields = proposalFieldsWire(replayRecords, read.graphHash, replayIssuers,
        heldRecordsApplyAt([...currentPending, ...(prior.pending_actions ?? [])], read.graph, read.graphHash));
      const state = await withRetainedScopeIssues(read, scenarioId, [...currentScope, ...scopeIssues], String(req.id));
      const replayChanceCells = replyChanceCells(state, scenarioId);
      const replayScopedDraftForRun = guidedSizingForRun(state.analysisResult, state.graph);
      const replayGuidedText = guidedSizingReplyText(replayScopedDraftForRun).guided;
      /**
       * ⭐ RESULT-FIRST REPLAY (#2470; CODEX_CLI_OVERFLOW P1 + P2 5936280278). A retried turn of the two-request Run is
       * rebuilt from the canonical readback, never from what the first attempt had in memory:
       * - request 2 (the explanation) returns its stored words ONLY while its bound key still names the CURRENT Run.
       *   Explain Run A, complete Run B, retry A's turn: `stale` with the honest line, never A's words beside B;
       * - request 1 (the Run) whose response was lost returns the CURRENT result, its narration metadata and the bound
       *   Explain control, so the retry is the same Run experience, across a restart too. Its words are Olumi's fixed
       *   line plus what the CURRENT readback says at rest, never the stored answer: that answer's appended paragraphs
       *   (break-even arithmetic, the provisional view) were built from THAT turn's readback, and a newer Run B would sit
       *   beside Run A's figures (overflow P1, b30759b2).
       * Which request it was is read from the request itself (the typed chips), and whether the Run made a result from
       * the stored reply being Olumi's own fixed line, never from the user's words.
       */
      const replayChip = runExplanationChip(scenarioId, state);
      // What this exact answer was sent with: this process's memory of its controls, else the narration stored WITH its row.
      const rememberedControls = turnId !== undefined ? offeredActions.get(`${scenarioId}:${turnId}`) : undefined;
      const durableNarration = prior.run_narration ?? undefined;
      // Set when a result-first Run receipt is not KNOWN to be the current Run's: its own Run since moved (its key), or the
      // Run it was sent with is unknown ('': a row written before migration 20261013230000). Answered below as that
      // historical receipt, never on today's Run.
      let historicalReceiptKey: string | undefined;
      const unavailableExplanation = new Set([interpretationUnavailableText({ ok: true, ran: true }), RUN_EXPLANATION_UNAVAILABLE_TEXT, RUN_EXPLANATION_LEGACY_UNAVAILABLE_TEXT]);
      let replayText = prior.assistant_message ?? 'That request was already completed.';
      // Legacy host receipts retain the existing current-state reconstruction below. This is
      // determined from the stored receipt, before reconstruction can replace its words.
      const legacyRunReceipt = replayText.includes(RUN_RESULT_READY_TEXT);
      let replayNarration: ReplayNarration | undefined;
      // ⭐ 2b-0 (DL: reload = same): the replayed Run reply passes the SAME pure composer with the SAME typed roles as the
      // live uninterpreted Run (the ready text and break-even as host parts, the withheld goal chance's sentence as its
      // reason, asks as asks, the root line and basis as evidence), so the bytes and `_answer_shape` come out equal.
      let replayObligations: FaceObligation[] | undefined;
      /** Accel P24 / SCI-10: remembered typed rows, re-licensed on today's shown Run (below). */
      let replayMethodResult: MethodResultV1 | null = null;
      const boundControl: OfferedAction[] = [];
      const whatChangesReplay = approvedProposal === undefined && (explanationId === TIPPING_POINT_PRESS_ID
        || (chiplessRetry && prior.request_hash === withChipOperation(requestHash, WHAT_CHANGES_CHIP_OPERATION)));
      // The review is ONE operation, live and replayed: the id-only press (Codex #2581 r2 P2). Any other chip carrying its
      // id (an action_type) is not the review, so a retry of it never recomposes one.
      const decisionReviewReplay = approvedProposal === undefined && (chipOperationOf(body) === DECISION_REVIEW_CHIP_OPERATION
        || (chiplessRetry && prior.request_hash === withChipOperation(requestHash, DECISION_REVIEW_CHIP_OPERATION)));
      if (decisionReviewReplay) {
        // Deterministic on the readback: today's bound Run gives the same review; a Run that moved gives today's (or the
        // unavailable reply). The SAME owner as the live turn, never a model call.
        const review = decisionReviewFor(scenarioId, { ...state,
          factorEnrichments: await persistedFactorReviewFor(scenarioId, state, String(req.id)), recentReplies: await repliesToCheckAsks(
          [goalChanceWithheldForAgent(state.analysisResult, state.graph, replayScopedDraftForRun, replayGuidedText)?.say], historyReader, scenarioId, turnId) });
        // S-B (Codex r1 P2-3 on #2751): an unbound review replays the live press's typed "can't yet" and its working exit.
        const pressed = review.bound ? null : decidePress({ id: DECISION_REVIEW_PRESS_ID }, actionFactsOf({ scenarioId, graph: state.graph,
          graphHash: state.graphHash, analysisState: state.analysisState, analysisReady: state.analysisReady, analysisResult: state.analysisResult,
          optionParticipation: state.optionParticipation, identityEvaluated: state.identityEvaluated }));
        if (pressed?.kind === 'reply') {
          replayText = pressed.reply.text;
          boundControl.push(...actionExitChips(pressed.reply.exits));
        } else {
          replayText = review.reply;
          boundControl.push(...decisionReviewChips(review));
        }
      } else if (whatChangesReplay) {
        // This unbound question asks about today's result: retry/cold read reconstructs today's answer, never Run A's
        // words. The SAME owner as the live turn (`whatWouldChangeAnswer`): this turn's measured answer while its Run is
        // still the bound one, else today's coaching. Never measured again here.
        const remembered = turnId !== undefined ? measuredWhatChanges.get(`${scenarioId}:${turnId}`) ?? null : null;
        const answer = whatWouldChangeAnswer(scenarioId, state, remembered, prior.assistant_message);
        replayText = answer.text;
        if (answer.measured !== null && turnId !== undefined) {
          replayMethodResult = whatChangesMethodResult(answer.measured.turn, {
            scenarioId, turnId, run: null, analysisResult: state.analysisResult,
          });
        }
        boundControl.push(TALK_IT_THROUGH_CHIP);
      } else if (approvedProposal === undefined && (pressedChipIsStructural
        || (chiplessRetry && prior.request_hash.startsWith(`${requestHash}#chip:${STRUCTURAL_CHALLENGE_HASH_TAG}`)))) {
        /** The durable tag recognises the method after a restart; only a remembered typed turn can carry conclusions. */
        const remembered = turnId !== undefined ? presentedStructuralChallenges.get(`${scenarioId}:${turnId}`) : undefined;
        const receipt = remembered === undefined ? undefined : await readStructuralChallengeReceipt({
          scenarioId, graph: state.graph ?? null, requestId: String(req.id),
          goalScopeClaimInput: goalScopeClaimInput([...currentScope, ...scopeIssues].filter(p => p.scenario_id === scenarioId), state.graph),
        });
        const presented = structuralChallengeReplay(remembered, receipt);
        // Replay the stored words (including live egress tails) only while today's fresh receipt re-presents the
        // identical typed answer. Compare only the two deterministic composer outputs, never stored wording.
        replayText = remembered !== undefined && presented.reply === remembered.reply
          ? prior.assistant_message ?? presented.reply : presented.reply;
        if (remembered !== undefined && presented.reply === remembered.reply && turnId !== undefined) {
          replayMethodResult = testLinkMethodResult(presented, { scenarioId, turnId });
        }
        boundControl.push(...presented.actions);
      } else if (approvedProposal === undefined && isRunExplanationChip(explanationId)) {
        const runKey = explanationId.slice(RUN_EXPLANATION_PREFIX.length);
        if (!runExplanationMatches(explanationId, scenarioId, state)) {
          replayText = RUN_EXPLANATION_UNAVAILABLE_TEXT;
          replayNarration = { status: 'stale', run_key: runKey };
        } else if (unavailableExplanation.has(replayText)) {
          if (replayText === RUN_EXPLANATION_LEGACY_UNAVAILABLE_TEXT) replayText = RUN_EXPLANATION_UNAVAILABLE_TEXT;
          replayNarration = { status: 'unavailable', run_key: runKey };
          if (replayChip !== null) boundControl.push(replayChip);
        } else {
          replayNarration = { status: 'ready', run_key: runKey };
        }
      } else if (approvedProposal === undefined && typedRunOf(body) && replayText.includes(RUN_RESULT_READY_TEXT)) {
        // B15: the atomic ready part may follow the typed chance headline in the stored derivation.
        // A receipt is re-answered on the current Run only when it is KNOWN to be that Run's (this process's memory, else
        // the narration stored with its row). Its own Run since moved, or unknown (a legacy row), it is replayed below as
        // that historical receipt (PL #94 6135017311 item 4; DL rulings 14 Oct, superseding #2470's "built on the CURRENT
        // result"): never on today's Run.
        const sentRunKey = (rememberedControls?.narration ?? durableNarration)?.run_key ?? '';
        if (replayChip !== null && replayChip.id !== `${RUN_EXPLANATION_PREFIX}${sentRunKey}`) {
          historicalReceiptKey = sentRunKey;
        } else if (replayChip !== null) {
          // Olumi's fixed line, then what the CURRENT readback owes, in the live Run turn's order and by its helpers: the
          // withheld goal chance's sentence, the at-rest asks (D1 + A7, `decision-input-ask.ts`), the break-even arithmetic
          // while the leader is withheld, A7's fold. On the same state this is the words the user first saw.
          const waitingId = executableWaitingProposal(scenarioId, userId, state.graphHash, state.graph);
          const atRest = { awaitingApproval: waitingId !== undefined && !isSteadyCardProposal(waitingId), builtOrRan: true,
            chanceCells: replayChanceCells, omittedRisks: runOmittedRisks(state.analysisResult) };
          const askNow = identityAskLineFor(state.analysisResult, state.graph);
          let say = goalChanceLineOwed([{ ok: true, ran: true,
            goal_chance: goalChanceWithheldForAgent(state.analysisResult, state.graph, replayScopedDraftForRun, replayGuidedText),
            ...(askNow === null ? {} : { identity_ask_say: askNow }),
          }], RUN_RESULT_READY_TEXT, { graph: state.graph });
          // The live Run turn's methods note (`disclosuresFor`, a Run on this turn) comes first in its owed lines.
          const indexNow = indexGoalWeightsMessages(state.analysisResult);
          const owedNow = [...indexNow, ...(typeof say === 'string' && say.trim() !== '' ? [say] : [])];
          // MC D1 (c): the same #416 ask the live Run turn said, from the same readback.
          if (askNow !== null) owedNow.push(askNow);
          // ⭐ NEVER RE-ASK (G1b d4): the live Run turn's own rule, on the answers before the turn being replayed, at the live
          // turn's own stage: before the root line and the basis, which the live turn adds after it (Codex r1 on #2664 P2).
          const recentAskReplies = await repliesToCheckAsks(owedNow, historyReader, scenarioId, turnId);
          askEachOnce(owedNow, recentAskReplies);
          // Rebuild and type the same effective say. Appending the original would restore an already-open question
          // and duplicate the reason that askEachOnce kept above.
          if (say !== null) say = withoutAskedQuestion(say, recentAskReplies);
          // Gate 2 consumer: the live Run turn's unvalued-root sentence, in its place (after the goal chance, before the basis).
          const reasonNow = thresholdReasonLine(state.graph, state.analysisResult);
          if (reasonNow !== null) owedNow.push(reasonNow);
          const rootNow = treatedAsZeroReplyLine(state.graph, state.analysisReady, state.analysisResult);
          if (rootNow !== null) owedNow.push(rootNow);
          if (claimPermissionsFrom(state.analysisState, state.analysisReady, { requested: true }).leader_may_be_named) {
            const basis = conditionalInputBasis({ graph: state.graph,
              admission: (state.analysisReady as { analysis_admission?: unknown } | undefined)?.analysis_admission,
              analysedOptionIds: analysedOptionIds(state.analysisResult) });
            if (basis !== null) owedNow.push(basis);
          }
          const withoutAsks = withDisclosures(RUN_RESULT_READY_TEXT, owedNow);
          const lines = await decisionLinesAskedOnce(state.graph, { ...atRest, restingText: textAtRest(withoutAsks), questionsToggle: textAtRest(withoutAsks) !== withoutAsks }, historyReader, scenarioId, turnId);
          // The live post-gate goal-chance producer appends its say after the ordinary decision lines.
          let rebuilt = withDisclosures(RUN_RESULT_READY_TEXT, [...owedNow.filter(line => line !== say), ...lines,
            ...(typeof say === 'string' && say.trim() !== '' ? [say] : [])]);
          const breakEvenNow = (state.analysisState as { leader_claim?: { permitted?: unknown } } | undefined)?.leader_claim?.permitted !== true
            ? (state.scopeOpen ? null : breakEvenFor(state.graph, state.identityEvaluated)) : null;
          if (breakEvenNow !== null) rebuilt = withBreakEvenAnswer(rebuilt, breakEvenNow, { afterIdentityAsk: false });
          // B15: the live Run turn's screen chance lines, at the live turn's stage (after break-even, before A7), by its
          // helpers on the same readback: without them the replay loses the typed chance headline the user first saw.
          const screenNow = goalChanceScreenLinesForAgent(state.analysisResult, state.graph,
            (state.analysisState as { run_state?: { kind?: unknown } } | undefined)?.run_state?.kind === 'complete_current');
          replayText = withA7AfterGate(rebuilt, state.graph, atRest, null);
          const guidedReplayFinding = replayGuidedText !== null && replayText.includes(replayGuidedText) ? replayGuidedText : null;
          replayObligations = [
            ...(guidedReplayFinding === null ? [] : [{ role: 'host' as const, text: guidedReplayFinding,
              lead: true as const, ownsNextStep: true as const }]),
            { role: 'host', text: RUN_RESULT_READY_TEXT },
            ...(reasonNow === null ? [] : [{ role: 'host' as const, text: reasonNow }]),
            ...(typeof say === 'string' && say.trim() !== '' ? [say, ...sentencesOf(say)].map((text): FaceObligation => ({ role: 'withheld_reason', text })) : []),
            // Mirror live typing: a combined goal-chance say may carry the level ask beside guided sizing.
            ...[askNow, rootNow, ...lines, say].filter((l): l is string => typeof l === 'string' && l.includes('?')).map((text): FaceObligation => ({ role: 'ask', text })),
            ...indexNow.map((text): FaceObligation => ({ role: 'host', text })),
            ...[rootNow, owedNow.find((l) => l !== say && l !== askNow && l !== rootNow && !indexNow.includes(l) && !l.includes('?'))]
              .filter((l): l is string => typeof l === 'string' && l.trim() !== '').map((text): FaceObligation => ({ role: 'evidence', text })),
            // The live turn types its decision lines and break-even arithmetic as host parts (a line that asks is the ask).
            ...lines.filter((l) => !l.includes('?')).flatMap(sentencesOf).map((text): FaceObligation => ({ role: 'host', text })),
            ...(breakEvenNow !== null ? [{ role: 'host' as const, text: breakEvenLine(breakEvenNow, { afterIdentityAsk: false }) }] : []),
            // The live turn's typing of the same lines (one finding = chance + depends; lead: true).
            ...screenNow.flatMap((l): FaceObligation[] => [
              ...(l.depends === '' ? [] : [{ role: 'evidence' as const, text: `${l.chance} ${l.depends}`, lead: true as const, subjects: [l.option_id] }]),
              { role: 'evidence', text: l.chance, lead: true, subjects: [l.option_id] },
              ...(l.depends === '' ? [] : [{ role: 'evidence' as const, text: l.depends, subjects: [l.option_id], companionOf: l.option_id }]),
              ...[l.spread_note, l.shortfall_note].filter((note): note is string => note !== undefined)
                .map((text): FaceObligation => ({ role: 'evidence', text, subjects: [l.option_id], companionOf: l.option_id })),
            ]),
          ];
          replayNarration = { status: 'pending', run_key: replayChip.id.slice(RUN_EXPLANATION_PREFIX.length) };
          boundControl.push(replayChip);
        } else {
          replayText = RUN_RESULT_UNVERIFIED_TEXT;
        }
      }
      const remembered = rememberedControls?.actions ?? [];
      // AI-written loop answers need their ORIGINAL bound identity. Legacy host receipts
      // are regenerated from current state; receipts saying nothing ran are not analysis answers.
      const replayLoopRun = approvedProposal === undefined && typedRunOf(body)
        && !legacyRunReceipt
        && replayText !== RUN_FAILED_TEXT
        && replayText !== 'The analysis did not run. Press Run to try again.';
      // Original bound controls only: never borrow today's key to identify yesterday's answer. After a restart, the
      // narration persisted WITH this exact row names its Run, never the latest row's; a row without it leaves the Run
      // unknown.
      const replayLoopRunKey = remembered.find(action => isRunExplanationChip(action.id))?.id.slice(RUN_EXPLANATION_PREFIX.length)
        || rememberedControls?.runControlKey || rememberedControls?.sizingRunKey
        || durableNarration?.run_key || undefined;
      // Currentness is a separate fact: an answer is re-sent as current only with the narration it was sent with (this
      // process's memory, else its row's). A key alone names the original Run on the historical receipt.
      const replayLoopRunCurrent = replayLoopRun && (rememberedControls !== undefined || durableNarration !== undefined)
        && typeof replayLoopRunKey === 'string' && replayChip?.id === `${RUN_EXPLANATION_PREFIX}${replayLoopRunKey}`;
      const historicalLoopReplay = (replayLoopRun && !replayLoopRunCurrent) || historicalReceiptKey !== undefined;
      if (replayLoopRunCurrent) {
        replayNarration = rememberedControls?.narration ?? durableNarration;
      }
      if (historicalLoopReplay) {
        replayText = prior.assistant_message ?? '';
        // Empty means unknown original identity, never the current Run's identity.
        replayNarration = { status: 'stale', run_key: historicalReceiptKey ?? replayLoopRunKey
          ?? (isRunExplanationChip(explanationId) ? explanationId.slice(RUN_EXPLANATION_PREFIX.length) : '') };
        boundControl.length = 0;
        // A warm answer with no original bound analysis controls must not gain a Run
        // control just from being resent. Cold/moved bound answers keep the historical exit.
        if (historicalReceiptKey !== undefined || rememberedControls === undefined || replayLoopRunKey !== undefined
          || remembered.some(action => action.id === RUN_OFFER_CHIP.id)) boundControl.push(RUN_OFFER_CHIP);
      }
      const resultFirstReplay = !historicalLoopReplay && (replayNarration !== undefined || replayLoopRunCurrent);
      // The durable carrier: this exact row's persisted Run offer, still within its lifetime.
      const durableRun = (prior.pending_actions ?? []).some((pa) =>
        pa.chip_id === RUN_OFFER_CHIP.id && pa.action.kind === 'run_analysis' && !isPendingActionExpired(pa, Date.now()));
      // ⛔ And this exact row's approve chip, from the carrier persisted WITH it (Codex #1823 5819308426: a
      // lost proposing response retried on a restarted process replayed the proposal with no way to approve
      // it). Only its words come from the row; `stillValidOffers` below decides whether it is still offered,
      // against the store the rehydration above has already refilled from the latest answer row.
      const durableApproveWords = remembered.some((a) => typedApprovalOf({ chip: { id: a.id } }) !== undefined)
        ? undefined
        : offeredApproveChipOnRow(prior.pending_actions, { scenario_id: scenarioId, user_id: userId });
      // The row carries the chip as offered, its card (`detail`) included (`APPROVE_DETAIL`, #2480 P2-2). A row written
      // before the card was stored: a link-strength card is re-derived from the SAME stored proposal, rehydrated above.
      const durableCard = durableApproveWords === undefined ? undefined : durableApproveWords.detail
        ?? ((id) => linkStrengthCardFor(id, proposals.get(id)))(typedApprovalOf({ chip: { id: durableApproveWords.id } }) as string);
      const durableApprove = durableApproveWords === undefined ? undefined
        : { ...durableApproveWords, ...(durableCard !== undefined ? { detail: durableCard } : {}) };
      const offered = [
        ...(durableApprove !== undefined ? [durableApprove] : []),
        ...remembered,
        ...(durableRun && !remembered.some((a) => a.id === RUN_OFFER_CHIP.id) ? [RUN_OFFER_CHIP] : []),
      ];
      // A review replay offers ONLY its recomposed presses (Codex #2581 P2): a remembered offer from another Run is not one.
      const stillValid = decisionReviewReplay ? [] : stillValidOffers(offered, {
          outstandingProposalIds: new Set([
            ...replayRecords.map(r => r.proposal_id),
            ...executableWaitingProposalIds(scenarioId, userId, state.graphHash, state.graph),
            ...(await liveHeldRefs(scenarioId)),
          ]),
          analysisReady: state.analysisReady,
          analysisState: state.analysisState,
          // `draft_graph` is read back only when the graph has content.
          modelExists: state.draftGraph !== undefined,
        });
      const replayCard = replayRecords[0];
      // Currentness of analysis does not decide whether a held human decision is still valid.
      const historicalDecisions = stillValid.filter(action => typedApprovalOf({ chip: { id: action.id } }) !== undefined
        || action.id === AMEND_CHIP.id || declinedProposalOf(action.id) !== undefined);
      const replayActions = firstOfEachId([...(historicalLoopReplay ? historicalDecisions : stillValid), ...boundControl]);
      // PATH-B core (#3487's rule, PL 00:18): a replayed core turn carries no host sizing chips or panel either.
      const replayGuidedDraft = mode !== 'core' && (replayNarration?.status === 'pending' || replayNarration?.status === 'ready' || replayLoopRunCurrent)
        ? replayScopedDraftForRun : undefined;
      const replayGuidedActions = guidedSizingActions(replayGuidedDraft, state.graph,
        await guidedSizingHistory(historyReader, scenarioId, turnId));
      replayActions.push(...replayGuidedActions);
      const replayGuided = bindGuidedSizing(replayGuidedDraft, replayGuidedActions, {
        graph_hash: state.graphHash ?? '', run_key: replayNarration?.run_key ?? (replayLoopRunCurrent ? replayLoopRunKey : '') ?? '',
      });
      const methodTerminalReplay = approvedProposal === undefined && (whatChangesReplay || isMethodPress(explanationId)
        || widenTargetOf(explanationId, message) !== null || isWidenAddPressId(explanationId) || pressedChipIsStructural
        || actionPressOf(body['chip']) !== null
        || (chiplessRetry && (prior.request_hash.startsWith(`${requestHash}#chip:${STRUCTURAL_CHALLENGE_HASH_TAG}`)
          || [...METHOD_PRESS_IDS].some(id => prior.request_hash === withChipOperation(requestHash, chipOperationOf({ chip: { id } }))))));
      if (!decisionReviewReplay && !methodTerminalReplay && replayCard !== undefined && !replayActions.some(a => typedApprovalOf({ chip: { id: a.id } }) !== undefined)) replayActions.unshift(replayCard.approve_action as OfferedAction, AMEND_CHIP, replayCard.decline_action as OfferedAction);
      for (const r of replayRecords) if (replayActions.some(a => a.id === r.approve_action.id)) replayActions.push(AMEND_CHIP, r.decline_action as OfferedAction);
      // ⭐ PR-2 (Codex BLOCK on #3424 @db2376d0): a card kept for review is offered for review on a replay too, never to approve.
      const replayReview = new Map(replayRecords.flatMap(r => r.review_action !== undefined ? [[r.proposal_id, r.review_action as OfferedAction] as const] : []));
      if (replayLoopRunCurrent) {
        // Preserve the sent controls and their order. Revalidate human approval independently,
        // but never manufacture Explain, sizing, or proposal controls on a verified warm resend.
        // After a restart only this row's durable controls are known: those still valid, nothing else.
        const validDecisionIds = new Set(historicalDecisions.map(action => action.id));
        replayActions.splice(0, replayActions.length, ...(rememberedControls === undefined ? stillValid : remembered.filter(action =>
          (typedApprovalOf({ chip: { id: action.id } }) === undefined
            && action.id !== AMEND_CHIP.id && declinedProposalOf(action.id) === undefined)
          || validDecisionIds.has(action.id))));
      }
      if (replayReview.size > 0) {
        const asReview = replayActions.map(a => { const id = typedApprovalOf({ chip: { id: a.id } }); return (id === undefined ? undefined : replayReview.get(id)) ?? a; });
        const approvable = asReview.some(a => typedApprovalOf({ chip: { id: a.id } }) !== undefined);
        replayActions.splice(0, replayActions.length, ...firstOfEachId(asReview.filter(a => approvable || a.id !== AMEND_CHIP.id)));
      }
      // The ordinary replay shape still requires parity with the stored answer. A withheld Run's current typed finding
      // owns the new face-first contract even when a newer Run replaced that answer; its rebuilt sentences stay intact.
      // The live turn's A7 rule, read the same way (the answer before the replayed one), so the parity check can hold.
      const replayA7 = replayObligations === undefined ? null : await a7SaidLastTurn(state.graph, replayChanceCells, historyReader, scenarioId, turnId);
      const replayEstimates = replayObligations === undefined ? null : actionFactsOf({ scenarioId, graph: state.graph,
        graphHash: state.graphHash, analysisState: state.analysisState, analysisReady: state.analysisReady,
        analysisResult: state.analysisResult, optionParticipation: state.optionParticipation, identityEvaluated: state.identityEvaluated }).olumiEstimates;
      const replayControlQuestions = replayActions
        .filter(action => {
          const id = typedApprovalOf({ chip: { id: action.id } });
          return !isSteadyCardProposal(id);
        })
        .flatMap((action) => typeof action.detail === 'string' && action.detail.includes('?') ? [action.detail] : []);
      const replayHorizon = replayObligations === undefined || !replayChanceCells.some(cell => cell.kind === 'figure' || cell.kind === 'range')
        ? null : untestedHorizonLineForCells(state.graph, replayChanceCells);
      const replayWhatChanges = replayObligations === undefined
        || (state.analysisState as { run_state?: { kind?: unknown } } | undefined)?.run_state?.kind !== 'complete_current'
        ? null : whatChangesFaceLine(state.analysisResult, state.graph);
      const replayComposeText = withCellHorizon(withoutProposalIds(replayText), state.graph, replayChanceCells);
      const composedCandidate = replayObligations === undefined ? null
        : composeReplyShape({ text: replayComposeText, chanceCells: replayChanceCells, obligations: withA7AsDetail(replayObligations, replayA7, withoutProposalIds(replayText), replayChanceCells.some(cell => cell.kind === 'figure' || cell.kind === 'range')), graph: state.graph ?? null, profile: 'coaching', typedControlQuestions: replayControlQuestions,
          faceContract: 'run',
          ...widenedRunWordsOf(state.graph, replayChanceCells, runOmittedRisks(state.analysisResult)),
          ...(replayHorizon === null ? {} : { horizonLine: replayHorizon }),
          ...(replayWhatChanges === null ? {} : { whatChanges: replayWhatChanges }),
          ...(replayEstimates !== null && replayEstimates.count > 0 ? { estimatesLine: `Olumi's estimates: ${replayEstimates.count}, see Check estimates.` } : {}),
          analysisResult: state.analysisResult });
      const parityReplayComposed = composedCandidate !== null && composedCandidate.shape !== null
        && composedCandidate.text === prior.assistant_message ? composedCandidate : null;
      // Ordinary replay is the durable answer, including its canonical presentation grammar. No cache is needed.
      // Current/stale result-first replays above retain their state-bound recomposition rather than an old shape.
      // §(ad) amended (AIE #94 6178106849): where the card carries the horizon marker, the reply led with the goal's own lead.
      const horizonCell = replayChanceCells.find((cell): cell is Extract<OptionChanceCell, { kind: 'withheld' }> => cell.kind === 'withheld'
        && cell.reasons.some(reason => reason.code === 'GOAL_FIGURES_HORIZON_NOT_TESTED'));
      // S7 B2: a reply composed since then leads with the lead AND its one next step (`goalHorizonNextStep`); an older one, the lead.
      const horizonFace = ((lead, step) => lead === null ? undefined : step !== null && replayText.split('\n\n')[0] === `${lead} ${step}` ? `${lead} ${step}` : lead)(
        goalHorizonReplyLead(state.graph), goalHorizonNextStep(state.graph));
      const durableShape = replayText === prior.assistant_message ? shapeFromDerivedAnswerText(replayText,
        horizonCell?.face === ZERO_SPREAD_NEEDS_MONTHLY_CHANGES ? horizonFace : horizonCell?.face) : null;
      const replayComposed = parityReplayComposed ?? (durableShape === null ? null : { text: replayText, shape: durableShape }) ?? (composedCandidate !== null && composedCandidate.shape !== null
        && replayChanceCells.some(cell => cell.kind === 'withheld')
        ? composedCandidate : null);
      const composedReplay = composeDirectAnswerResponse({
        assistant_text: replayComposed !== null ? replayComposed.text : withoutProposalIds(replayText),
        stage: 'frame',
        answerKind: 'substantive',
        // The bound Explain control is re-derived from the canonical readback above, so it is valid by construction.
        suggested_actions: firstOfEachId(replayActions).map(guidedSizingWireAction),
      });
      const replayBody = {
        ...finaliseV5Response(composedReplay, { scenarioId, runDeltaBoundByCaller: true }),
        ...(guidedSizingOnWire(replayGuided, state.graphHash) !== undefined
          ? { guided_sizing: guidedSizingOnWire(replayGuided, state.graphHash) } : {}),
        ...(replayFields !== undefined ? { _proposal_fields: replayFields } : {}),
        ...(replayNarration !== undefined ? { narration: replayNarration } : {}),
        ...(replayComposed?.shape != null ? { _answer_shape: replayComposed.shape } : {}),
        // The CURRENT result as the live turn carries it: the readback's bound block and its sidecars, same fact.
        ...(resultFirstReplay && state.analysisResult !== undefined ? { blocks: [state.analysisResult] } : {}),
        ...(resultFirstReplay && state.limitVerdicts !== undefined ? { limit_verdicts: state.limitVerdicts } : {}),
        ...(resultFirstReplay && state.goalCertainty !== undefined ? { goal_certainty: state.goalCertainty } : {}),
        ...(resultFirstReplay && state.optionParticipation !== undefined ? { option_participation: state.optionParticipation } : {}),
        ...(state.graphHash !== undefined ? { graph_hash: state.graphHash } : {}),
        ...(mode !== 'core' && state.analysisReady !== undefined ? { analysis_ready: state.analysisReady } : {}),
        ...(state.analysisState !== undefined ? { analysis_state: state.analysisState } : {}),
        ...(state.draftGraph !== undefined ? { draft_graph: state.draftGraph } : {}),
        _diagnostic_trace: { exit_path: 'agent_lane_v1', agent_mode: mode, hops: 0, stopped_reason: 'replayed', tools_called: [], replayed: true },
        _agent: { session_id: sessionId, mode, tool_calls: [], mutated: false, hops: 0, stopped_reason: 'replayed', replayed: true, turn_id: turnId },
        _provider_calls: recordedProviderCalls(),
        ...(providerLedgerTruncated() ? { _provider_calls_truncated: true } : {}),
      };
      // ⛔ A replay is an exit too (AI HARNESS PR-L1): the stored words are re-checked against TODAY's licence.
      const replayClaim = (state.analysisState as { leader_claim?: { permitted?: unknown; separation?: unknown; withheld_reason?: unknown } } | undefined)?.leader_claim;
      // ⭐ PR-S2 r5: a replayed reply never denies the driver the screen shows (`goal-chance-driver-egress.ts`).
      const driverGatedReplay = withoutDriverAbsenceClaimsAtEgress(enforceLeaderLicenceAtFinalEgress(replayBody, {
        requestId: String(req.id),
        exitPath: 'agent_lane_v1_replay',
        scopeAuthorityUnavailable: state.scopeAuthorityUnavailable,
        licence: leaderLicenceFromState(state.analysisState, state.analysisReady),
        mayNameLeadingOption: replayClaim?.permitted === true,
        separationEstablished: replayClaim?.separation === 'separated',
        ...(typeof replayClaim?.withheld_reason === 'string' ? { leaderClaimWithheldReason: replayClaim.withheld_reason } : {}),
        graph: state.graph ?? null,
        analysisReady: state.analysisReady,
      }).response, {
        analysisResult: state.analysisResult, graph: state.graph ?? null, requestId: String(req.id), exitPath: 'agent_lane_v1_replay',
        ...(turnId !== undefined ? { turnId } : {}),
      });
      const optionGatedReplay = withLeftOutOptionCorrectionAtEgress(driverGatedReplay, {
        runOptionSet: state.runOptionSet, optionParticipation: state.optionParticipation, graph: state.graph ?? null,
        requestId: String(req.id), exitPath: 'agent_lane_v1_replay', ...(turnId !== undefined ? { turnId } : {}),
      });
      const gatedReplay = withEstimateGoalPointsAtEgress(optionGatedReplay, {
        analysisResult: state.analysisResult, graph: state.graph ?? null,
        current: !replayLoopRun && historicalReceiptKey === undefined && (state.analysisState as { run_state?: { kind?: unknown } } | undefined)?.run_state?.kind === 'complete_current',
        userAuthoredTexts: userTextsForEgress(
          [...histories.typedWords(sessionId), ...(typedByUser(body) ? [prior.user_message ?? message] : [])], recentRowsForEgress),
      });
      // K2: committed loop prose already crossed the live gates. Preserve those exact bytes;
      // currentness belongs to typed controls/narration, not a new sentence in the saved answer.
      // PATH-B `core`: the stored reply is the AI's own words; its replay returns those exact bytes too.
      if (replayLoopRun || historicalReceiptKey !== undefined || mode === 'core') gatedReplay.assistant_text = prior.assistant_message ?? '';
      // Accel P24 / SCI-10: the typed rows go on AFTER every replay guard (a structured scrub must never reach them), and only
      // when each row and figure is in the reply those guards left. withShapeOnlyIfItDerives below never changes
      // assistant_text and keeps every other key (it can only drop `_answer_shape`), so this is the text that ships.
      const replayMethod = methodResultForEgress(replayMethodResult, String(gatedReplay.assistant_text ?? ''));
      if (replayMethod !== null) Object.assign(gatedReplay, { _method_result: replayMethod });
      // ⛔ The shape rides only while it still derives the words that ship, AFTER the final gates (Codex r2 on #2783: the
      // leader egress can edit `_answer_shape` alone). Otherwise the replay ships its text whole.
      return withShapeOnlyIfItDerives(turnAnalysisData(gatedReplay, mode));
    };
    /**
     * ⛔ A RESTART MUST NOT FORGET WHAT THE USER IS ABOUT TO APPROVE (#63 5811981438: three redeploys inside
     * Paul's session, his "yes" met `unknown_proposal`). The latest answer row carries the proposal it
     * offered; put it back when this process does not hold it. Read BEFORE this turn's own claim row is
     * written, or the latest row would be that claim, which carries nothing. A failed read degrades to today's behaviour.
     */
    const approveKey = `${scenarioId}:${userId ?? ''}`;
    const declinedProposal = declinedProposalOf((body['chip'] as { id?: unknown } | undefined)?.id);
    if ((approvedProposal !== undefined && proposals.get(approvedProposal) === undefined)
      || (declinedProposal !== undefined && proposals.get(declinedProposal) === undefined)
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
    let recoveredRun: RecoveredRun | undefined;
    let claimHash: string | undefined;
    let claimAppendSucceeded = false;
    let claimReleaseRecorded = false;
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
        if (!sameAgentTurnRequest(prior.request_hash, requestHash, chiplessRetry)) {
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
        claimAppendSucceeded = true;
        owner = await store.readCommittedTurn(scenarioId, claimTurnId);
      } catch (err) {
        if (err instanceof ModelWriteOwnershipRefused) {
          if (readSuccessfulDoorEntries() > 0 || readUnsavableEffects() > 0) return reply.code(403).send({ error: err.code });
          const refusalBody = MODEL_WRITE_OWNERSHIP_REFUSAL_BODY[err.reason];
          return reply.code(403).send({ error: refusalBody.error, message: refusalBody.message });
        }
        log.warn({ err: String(err), scenario_id: scenarioId, turn_id: turnId }, 'agent-lane: turn claim failed — refusing rather than running unclaimed');
        return reply.code(503).send({ error: 'TURN_STATE_UNVERIFIABLE', detail: 'Could not reserve this turn. Nothing was run — please try again.' });
      }
      if (owner === null) {
        return reply.code(503).send({ error: 'TURN_STATE_UNVERIFIABLE', detail: 'Could not confirm this turn was reserved. Nothing was run — please try again.' });
      }
      const claim = {
        won: owner.request_hash === claimHash,
        sameRequest: sameAgentTurnRequest(requestHashOfClaim(owner.request_hash), requestHash, chiplessRetry),
      };
      if (!claim.won && !claim.sameRequest) {
        return reply.code(409).send({ error: 'TURN_ID_REUSED', detail: 'That turn id was already used for a different message. Nothing was run or changed.' });
      }
      const runKey = `${scenarioId}:${turnId}`;
      if (claim.won && typedRunOf(body)) takeActiveRun(runKey);
      if (!claim.won) {
        const deadline = Date.now() + AGENT_TURN_CLAIM_WAIT.totalMs;
        let recoveryAttempted = false;
        for (;;) {
          let answer: CommittedTurnRecord | null = null;
          try { answer = await readAnswer(); } catch { answer = null; }
          if (answer !== null) {
            if (!sameAgentTurnRequest(answer.request_hash, requestHash, chiplessRetry)) {
              return reply.code(409).send({ error: 'TURN_ID_REUSED', detail: 'That turn id was already used for a different message. Nothing was run or changed.' });
            }
            return reply.code(200).send(await replayed(answer));
          }
          // A concurrent original/recovery request finishes its reply first. No duplicate interpreting call here.
          if (mode !== 'preview' && !recoveryAttempted && !activeRunTurns.has(runKey) && (typedRunOf(body) || chiplessRetry)) {
            const recorded = await readRecordedRun(store, scenarioId, turnId, () => readBackState(
              (path, body) => readCache.dispatch(path, { ...(body as Record<string, unknown>), ...FRESH_READ }), scenarioId));
            if (recorded !== undefined && takeActiveRun(runKey)) {
              // The builder we raced may have stored its answer while the fact/readback checks were in flight.
              let recordedAnswer: CommittedTurnRecord | null;
              try { recordedAnswer = await readAnswer(); } catch {
                return reply.code(503).send({ error: 'TURN_STATE_UNVERIFIABLE', detail: 'Could not confirm whether the reply was recorded. Nothing was run again — please try again.' });
              }
              if (recordedAnswer !== null) {
                if (!sameAgentTurnRequest(recordedAnswer.request_hash, requestHash, chiplessRetry)) {
                  return reply.code(409).send({ error: 'TURN_ID_REUSED', detail: 'That turn id was already used for a different message. Nothing was run or changed.' });
                }
                return reply.code(200).send(await replayed(recordedAnswer));
              }
              recoveredRun = recorded;
              // Keep original chip authorship and Run-only permissions on a chipless UI retry.
              requestHash = requestHashOfClaim(owner.request_hash);
              if (chiplessRetry) body = { ...body, chip: { action_type: 'run_analysis' } };
              break;
            }
            // A concurrent builder may have won while the durable proof was read. Wait for it; don't re-read a rejected Run.
            recoveryAttempted = !activeRunTurns.has(runKey);
          }
          if (Date.now() >= deadline) break;
          await new Promise((r) => setTimeout(r, AGENT_TURN_CLAIM_WAIT.everyMs));
        }
        if (recoveredRun === undefined) {
          log.warn({ scenario_id: scenarioId, turn_id: turnId }, 'agent-lane: turn claimed but no answer recorded — outcome unknown, not re-run');
          return reply.code(409).send({
            error: 'TURN_OUTCOME_UNKNOWN',
            detail: 'This message is already being handled, or an earlier attempt ran and its reply was not recorded. Nothing was run again — reload to see the current model.',
          });
        }
      }
      // A new claim may run; a recovered claim can only reuse its proven Run.
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
    // Counts every call that could WRITE. Only a single-append door's known
    // revision refusal proves it wrote nothing; earlier writes and unknown
    // outcomes must keep the claim.
    let writesDispatched = 0;
    let verifiedSave = false;
    const undoRefusedWrite = async <T>(write: () => Promise<T>): Promise<T> => {
      try { return await write(); }
      catch (err) {
        // Undo only this refused attempt; an earlier step may already have written.
        if (isRevisionConflict(err)) writesDispatched -= 1;
        throw err;
      }
    };
    const releaseUnwrittenTurnClaim = async (): Promise<boolean> => {
      if (turnId === undefined || claimHash === undefined || writesDispatched !== 0 || typeof store.releaseTurnClaim !== 'function') return false;
      try {
        await store.releaseTurnClaim(scenarioId, claimTurnIdOf(turnId), claimHash);
        if (claimAppendSucceeded && !claimReleaseRecorded) {
          recordReleasedTurnClaim();
          claimReleaseRecorded = true;
        }
        return true;
      }
      catch (err) { log.warn({ err: String(err), scenario_id: scenarioId, turn_id: turnId }, 'agent-lane: claim release failed'); return false; }
    };
    /**
     * ⭐ ONE READ OF THE MODEL PER WRITE EPOCH (C6; widens slice C1c, which reused a read only before the first
     * write). See `turnReadCache`: a graph read is reused while nothing else has been dispatched or written since
     * it was taken: the epoch advances when any other dispatch or in-process writer (`readCache.around`) finishes, and a
     * kept read carries the epoch it STARTED in. So a read after a write always sees it. Served: 22 reads at ~1.1 s in one
     * journey; an approve made 4.
     */
    const readingDispatch: typeof dispatch = readCache.dispatch;
    const countingDispatch: typeof dispatch = async (path, body) => {
      const send = async () => promoteRevisionConflictResponse(await readingDispatch(path, body));
      if (path.endsWith('/graph/register')) {
        writesDispatched += 1;
        return undoRefusedWrite(send);
      }
      // A v2 turn can commit through several subdoors before a later refusal.
      // Its revision 409 cannot prove that the whole dispatched turn wrote nothing.
      if (path === '/orchestrate/v2/turn') {
        writesDispatched += 1;
        return send();
      }
      return readingDispatch(path, body);
    };
    /**
     * ⭐ THE AUTOMATIC FIRST ANALYSIS (Paul, 5812069638), handed to the build capability. The route
     * owns three things about it: the DEADLINE (the build and the run share one browser-proxy
     * budget, measured from this request's start), the WRITE accounting (a run commits a turn, so a
     * failed turn must never release its claim after one), and the witness record below.
     */
    const firstAnalysisDeadlineAt = firstAnalysisDeadline(startedAt);
    /** The construction call's own end, from the same request start (see `constructionDeadline`). */
    const constructionDeadlineAt = constructionDeadline(startedAt);
    let firstAnalysis: { outcome: FirstAnalysisOutcome; ms: number; constructionTurnId: string; revision: string } | undefined;
    const runFirstAnalysis = async (input: Parameters<typeof runFirstAnalysisAfterConstruction>[0]): Promise<FirstAnalysisOutcome> => {
      const t0 = Date.now();
      const outcome = await readCache.around(() => runFirstAnalysisAfterConstruction({ ...input, onDispatch: () => { writesDispatched += 1; } }));
      firstAnalysis = { outcome, ms: Date.now() - t0, constructionTurnId: input.constructionTurnId, revision: input.revisionHash };
      return outcome;
    };
    /**
     * The LAST analysis this turn ran (first analysis, the Agent's own run, or the typed Run), as
     * handed over. Carried to the user ONLY when bound to the final readback — see
     * `bindRunBlocksToReadback` and `runTurnCoaching`. No trigger ⇒ the user asked for the run.
     */
    let lastRun: CapturedAnalysis | undefined;
    /** X5: set only when this turn ran a construction — see `ConstructionTrace`. */
    let constructionTrace: ConstructionTrace | undefined;
    /** The streamed GRAPH_READY frame for a model graph (nothing outside a streamed turn); through COMPLETE's own projection. */
    const emitGraphReady = (raw: Record<string, unknown>): void => {
      const emitStage = currentStageEmitter();
      if (emitStage === undefined || !Array.isArray(raw.nodes) || raw.nodes.length === 0) return;
      // The same single cast COMPLETE's readback makes (`after.json.graph`).
      const g = raw as GraphV3T;
      emitStage({
        kind: 'GRAPH_READY',
        graph: buildAppliedGraphWireField({ ...g, edges: Array.isArray(g.edges) ? g.edges : [] }),
        schema_version: 'v3',
        elapsed_ms: Date.now() - startedAt,
      });
    };
    // The objects the capabilities run on, named once so PATH-B's typed adapters (`pathBTools`) run on the SAME ones.
    const capDispatch = bindHeldApprovalWriter(countingDispatch, (input) => {
      writesDispatched += 1;
      return undoRefusedWrite(() => readCache.around(async () => promoteRevisionConflictResponse(await commitHeldProposalInProcess(input, String(req.id)))));
    });
    const capCallStructured: CallStructuredModel = (reqBody, deadlineAt) => callStructured(reqBody, deadlineAt ?? constructionDeadlineAt);
    const onCapAnalysis: NonNullable<Parameters<typeof createAgentCapabilities>[4]> = (payload) => { lastRun = { ...payload, trigger: payload.trigger ?? 'explicit_run' }; };
    // ⭐ Whole-request atomicity (ChatGPT #70 5847200462): N option levels and their links as ONE commit, in-process.
    // S2b team_time uses this same fenced batch door and cached read-back.
    const commitOptionLevelsDoor = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
      // F1b B8: the in-process graph write takes its place in the scenario's turn fence.
      writesDispatched += 1;
      return undoRefusedWrite(() => {
        return readCache.around(() => runFencedInProcessWrite(input.scenario_id, input.turn_id, () => commitOptionLevelsInProcess(input, String(req.id)), () => ({ status: 'stale' as const }), fenceRefused));
      });
    };
    /**
     * ⭐ ONE RESTORE = ONE Run (PATH-B gap 4; Codex R1 on #3469). On `core`, a Run press while the saved head is a restore
     * (the canvas's Run after an Undo, DGAI #2767) is that restore's Run operation (`restoreRunOperation`), not the request's:
     * a re-press with another turn id recovers the Run the restore already has (`readRecordedRun`, the existing reader) and
     * never runs the engine again. A press on any other head keeps its own operation, so a deliberate Run still runs. A head
     * that cannot be read (Codex R2) is NO Run: the press's Run answers the existing unavailable outcome, never a fresh operation.
     */
    const restoreRun = mode === 'core' && approvedProposal === undefined && typedRunOf(body) ? await restoreRunOperation(scenarioId) : null;
    if (typeof restoreRun === 'string' && recoveredRun === undefined) {
      recoveredRun = await readRecordedRun(store, scenarioId, restoreRun, () => readBackState(
        (path, b) => readCache.dispatch(path, { ...(b as Record<string, unknown>), ...FRESH_READ }), scenarioId));
    }
    const runOperationKey = restoreRun === null ? turnId : restoreRun;
    const capabilities = createAgentCapabilities(
      capDispatch, proposals, capCallStructured, mode, onCapAnalysis,
      {
        turnAuthority: true,
        ...(recoveredRun !== undefined ? { recoveredRun } : {}),
        ...(typedRunOf(body) && runOperationKey !== undefined ? { runOperationId: runOperationTurnId(scenarioId, runOperationKey) } : {}),
        deadlineAt: constructionDeadlineAt,
        firstAnalysis: (input) => runFirstAnalysis({ ...input, deadlineAt: firstAnalysisDeadlineAt }),
        /**
         * ⭐ C6-1: THE CANVAS DRAWS THE FIRST MODEL WHEN IT IS REGISTERED, NOT AT THE END OF THE TURN.
         *
         * Measured (DL C6, 25 served first briefs): ~15 s of a 79 s median first brief comes after the model is
         * saved — reads, the first analysis, the Agent's closing calls — and the browser saw none of it until
         * COMPLETE, because the only `GRAPH_READY` producer was the v2 engine's draft tool. The UI already draws
         * this frame on arrival (`consumeStreamedDraftTurn`), without autosave, and checks it against COMPLETE.
         *
         * The committed graph as read back, through the SAME projection COMPLETE's `draft_graph` uses below, so
         * the ids cannot drift. Structure only: at this line no analysis, leader or claim exists for this model.
         * `currentStageEmitter()` is set only inside `/proxy/v5/turn/stream` and `/orchestrate/v2/turn/stream`;
         * every buffered turn reads `undefined` and emits nothing, so its body is untouched by construction.
         */
        // X5 (DESIGN Q3): the construction retry's reason and outcome, for the trace only.
        onConstructionTrace: (t) => { constructionTrace = t; },
        onModelRegistered: (raw) => emitGraphReady(raw),
        // S3 (DL 15 Oct): the admitted draft, before the widening calls start, so the canvas draws it without waiting for
        // them. The UI draws the first GRAPH_READY on arrival; COMPLETE then applies the saved model, Olumi's additions included.
        onDraftAdmitted: (raw) => emitGraphReady(raw as Record<string, unknown>),
        // S8 durable human reasoning: the scenario-wide `finding_dissent` read (NOT a conversation-history read, no turn
        // window: a dissent older than the window still reaches the model) + the existing projector. A store WITHOUT the
        // read cannot say whether the user stated an objection: that is UNKNOWN, not a successful empty read, so it takes
        // the same path as a failed read (the capability raises `stated_objections_unreadable`; the turn never fails).
        readStatedObjections: async (sid: string) => {
          if (typeof store.readStatedObjectionFactsFor !== 'function') throw new Error('stated_objections_reader_unavailable');
          return projectStatedObjections(await store.readStatedObjectionFactsFor(sid, STATED_OBJECTION_FACT_ROWS_READ, STATED_OBJECTIONS_CAP));
        },
        // Read at rebuild time, after this request's durable history reseed below.
        readTurnHistory: () => histories.get(sessionId),
        // B restated goal: the committed turn ledger, read only to offer or apply a revised draft (`draft-replacement.ts`).
        // A store without the read leaves it absent, which the gate treats as unknown: no revised draft is offered.
        ...(typeof store.readCommittedTurnLedger === 'function'
          ? { readCommittedTurnLedger: (sid: string) => store.readCommittedTurnLedger!(sid) }
          : {}),
        // The held add-option (C52) is confirmed against the store's LATEST answer row — the row route-v2 reads.
        ...(typeof store.readMostRecentPendingActions === 'function'
          ? { readPendingActions: (sid: string) => store.readMostRecentPendingActions!(sid, { validation: 'strict' }) }
          : {}),
        commitOptionLevels: commitOptionLevelsDoor,
        // ⭐ C5: the provisional view is accepted only while the analysis withholds its leader — read from THIS route's
        // readback through the wire gate's own predicate, so the capability and the gate below cannot disagree.
        readLeaderStanding: async (sid: string) => leaderStandingOf(await readBackState(readingDispatch, sid)),
        // ⭐ The EARLY answer to "would this search control be shown", so a refusal reaches the model while it can still
        // ask a neutral question. The turn's final read decides again, below (`withResearchControlTruth`).
        researchControlShowable: (sid: string, query: string) => researchControlShowableNow(readingDispatch, sid, query),
        // ⭐ SLICE C2 (Canonical #70 5855234599): the product's add-risk door (ONE held change) and limit door (ONE commit),
        // in-process. Each commits a turn row, so each counts as a write.
        holdAddRisk: async (input) => {
          writesDispatched += 1;
          return undoRefusedWrite(() => {
            return readCache.around(() => holdAddRiskInProcess(input, String(req.id)));
          });
        },
        // ⭐ PJ-E-FIG (DL #72 5866036457): the add-factor door — ONE held change carrying the user's figures, in-process.
        holdAddFactor: async (input) => {
          writesDispatched += 1;
          return undoRefusedWrite(() => {
            return readCache.around(() => holdAddFactorInProcess(input, String(req.id)));
          });
        },
        commitLimitAdd: async (input) => {
          const fenceRefused = () => ({ status: 'refused' as const, reason: 'turn_fence_refused' });
          writesDispatched += 1;
          return undoRefusedWrite(() => {
            return readCache.around(() => runFencedInProcessWrite(input.scenario_id, input.turn_id, () => commitLimitAddInProcess(input, String(req.id)), () => ({ status: 'stale' as const }), fenceRefused));
          });
        },
        commitLimitEdit: async (input) => {
          writesDispatched += 1;
          return undoRefusedWrite(() => {
            return readCache.around(() => runFencedInProcessWrite(input.scenario_id, input.turn_id, () => commitLimitEditInProcess(input, String(req.id)), () => ({ status: 'stale' as const }), fenceRefused));
          });
        },
        commitOlumiOptionAdoption: async (input) => {
          writesDispatched += 1;
          return undoRefusedWrite(() => {
            return readCache.around(() => runFencedInProcessWrite(input.scenario_id, input.turn_id, () => commitOlumiOptionAdoptionInProcess(input, String(req.id)), () => ({ status: 'stale' as const }), fenceRefused));
          });
        },
        // ⭐ MG F1 T6 (#2471): an option's status, in-process, so "applied" rests on the writer's own typed outcome. It runs
        // as an Agent SUB-TURN, exactly as the HTTP dispatch it replaces did (:1499): the writer's narration is not the
        // conversation, so its row keeps no conversation text (#2352 class; DL CR on #2471 P2).
        // ⭐ S5: the rename card's press, in-process, through the ONE label writer; fenced and run as a sub-turn like the status door.
        commitOptionRename: async (input) => {
          writesDispatched += 1;
          return undoRefusedWrite(() => {
            return readCache.around(() => runAsAgentSubturn(input.scenario_id, () => runFencedInProcessWrite(input.scenario_id, input.turn_id, () => commitOptionRenameInProcess(input, String(req.id)), () => ({ status: 'stale' as const }), fenceRefused)));
          });
        },
        // ⭐ S5: the removal card's press, in-process, through the ONE removal writer; fenced and run as a sub-turn like the status door.
        commitStructuralDelete: async (input) => {
          writesDispatched += 1;
          return undoRefusedWrite(() => {
            return readCache.around(() => runAsAgentSubturn(input.scenario_id, () => runFencedInProcessWrite(input.scenario_id, input.turn_id, () => commitStructuralDeleteInProcess(input, String(req.id)), () => ({ status: 'stale' as const }), fenceRefused)));
          });
        },
        commitOptionStatus: async (input) => {
          writesDispatched += 1;
          return undoRefusedWrite(() => {
            return readCache.around(() => runAsAgentSubturn(input.scenario_id, () => runFencedInProcessWrite(input.scenario_id, input.turn_id, () => commitOptionStatusInProcess(input, String(req.id)), () => ({ status: 'stale' as const }), fenceRefused)));
          });
        },
      },
    );
    // A session whose in-process history holds no user message (a restart, a
    // deploy, an eviction — or only a board-edit note appended since) is seeded
    // from the durable conversation, ahead of whatever is already held — see
    // `historyFromDurableTurns`. A failed read degrades to no history; it never
    // fails the turn.
    const held = histories.get(sessionId);
    /** T1 (a): this conversation's earlier words are KNOWN — held in-process, or read durably. A failed or absent read leaves them unknown. */
    let earlierWordsKnown = !needsDurableSeed(held);
    if (needsDurableSeed(held) && typeof store.readRecent === 'function') {
      try {
        // Egress reuses the conversation seed; it never widens or repeats the producer's read.
        const durableSeedRows = await store.readRecent(scenarioId, DURABLE_SEED_ROWS_READ);
        recentRowsForEgress = durableSeedRows;
        const durable = historyFromDurableTurns(durableSeedRows);
        if (durable.length > 0) {
          // Seeding reuses already-saved rows and held history; it is not an effect of this turn.
          // Restart continuity: a row whose stored hash is this subject's PLAIN hash of its own words was typed (no chip, no
          // operation); `HistoryStore.seed` holds those words as typed again. Any other row stays source-unknown.
          histories.seed(sessionId, durable, held, durableSeedRows, typedRowProof(scenarioId, userId));
        }
        earlierWordsKnown = true;
      } catch (err) {
        log.warn({ err: String(err), scenario_id: scenarioId }, 'agent-lane: durable conversation could not be read — continuing without it');
      }
    }
    const history = histories.get(sessionId);
    // Olumi's previous reply, from this session's own items: what binds an answer to its question about one risk's chance.
    const precedingAsk = precedingAssistantText(history);
    let budget = conversationBudgetFor(false);
    /** Every tool runs as THIS request: its scenario, its user, and the user's own words (`stated-by-user.ts`). */
    const typedNow = typedByUser(body) ? message : null;
    // The typed approve chip this request pressed — bound here, never from model output. ⛔ Its words (as the product
    // sends them: DGAI `sendChip` → `chip.message`) bind only when a card for THIS proposal is on offer to this subject
    // (this process's last offer, or the durable carrier after a restart); `applyLinkEffect` then requires them to be
    // exactly that card's reading. PR Review on #2275 @ fe509477: a right-looking id + reading for a proposal whose card
    // is not on offer carries no words, so it writes nothing.
    // Snapshot before any inner tool row: the outer answer carries/decrements this ask once,
    // even when Run or Explain bypasses the Agent loop. Claim rows are excluded by the store.
    /**
     * ⭐ S-D (lane EDIT-PANEL; design §5): the held proposals as this turn FOUND them, read before any inner row, so the
     * answer row can carry each one until it is approved or declined — an inner row this turn writes (a new hold, a
     * confirm) never drops another hold silently (D-08). An unreadable latest row is unknown authority, not no holds.
     */
    let deadlineTurnStart: DeadlineTurnStart | undefined;
    let heldAtStart: readonly PendingAction[] = [];
    let pendingReadFailed = false;
    if (typeof store.readMostRecentPendingActions === 'function') {
      try {
        let latestRowId: string | null = null;
        const latestPending = await store.readMostRecentPendingActions(scenarioId, { validation: 'strict', onLatestRowId: id => { latestRowId = id; } });
        if (!Array.isArray(latestPending) || latestPending.some(p => parsePendingAction(p) === null || p.scenario_id !== scenarioId)) {
          throw new Error('pending_actions_unreadable');
        }
        heldAtStart = latestPending.filter(isHeldProposal);
        if (latestRowId !== null) deadlineTurnStart = { rowId: latestRowId, rows: await store.readRecent(scenarioId, CONVERSATION_ROWS_READ),
          // A closed offer is silent to the user, so every UNKNOWN read of the build turn's committed offers says why (staging observability).
          committedPending: async (turnId: string) => {
            const closed = (reason: string, err?: unknown): void => log.warn({ event: 'agent_lane.deadline_offer_closed_unknown', reason, scenario_id: scenarioId,
              turn_id: turnId, ...(err !== undefined ? { err: String(err) } : {}) }, 'agent-lane: the deadline offer is closed — the build turn\'s committed offers could not be read');
            if (typeof store.readCommittedTurn !== 'function') { closed('no_committed_reader'); return undefined; }
            try {
              const pending = (await store.readCommittedTurn(scenarioId, turnId))?.pending_actions;
              if (!Array.isArray(pending)) closed('committed_row_missing_or_malformed');
              else if (pending.some(entry => entry === null || typeof entry !== 'object' || Array.isArray(entry))) closed('committed_entry_malformed');
              return pending;
            } catch (err) { closed('committed_read_failed', err); throw err; }
          } };
      } catch (err) {
        pendingReadFailed = true;
        log.warn({ err: String(err), scenario_id: scenarioId }, 'agent-lane: pending authority unreadable — no tool or replacement answer row');
      }
    }
    if (pendingReadFailed) {
      // Before any tool: preserve the unknown latest row and leave a named request retryable without borrowing approval.
      await releaseUnwrittenTurnClaim();
      const unavailable = composeDirectAnswerResponse({
        assistant_text: 'I couldn’t verify the pending changes for this scenario. I haven’t applied any changes or run analysis in this request. Please try again.',
        stage: 'frame', answerKind: 'substantive',
      });
      return reply.code(200).send({
        ...withEstimateGoalPointsAtEgress(finaliseV5Response(unavailable, { scenarioId, runDeltaBoundByCaller: true }), {
          analysisResult: null, graph: null, current: false,
        }),
        _agent: { session_id: sessionId, mode, tool_calls: [], mutated: false, hops: 0,
          stopped_reason: 'pending_actions_unreadable', durability: 'not_recorded', ...(turnId !== undefined ? { turn_id: turnId } : {}) },
        _provider_calls: recordedProviderCalls(),
        ...(providerLedgerTruncated() ? { _provider_calls_truncated: true } : {}),
      });
    }
    const offeredCard = approvedProposal === undefined ? undefined : [lastApproveOffer.get(approveKey), carriedProposals.get(approveKey)?.chip,
      ...heldAtStart.map(h => proposalRecord(h, undefined)?.approve_action)]
      .find((c) => c !== undefined && typedApprovalOf({ chip: { id: c.id } }) === approvedProposal);
    // A product hold is its own durable card; confirmHeld checks these words against that exact live hold.
    let pressedApproval: Partial<AgentToolContext> = approvedProposal !== undefined
      ? { typed_approval_of: approvedProposal,
        ...(offeredCard !== undefined || approvedProposal.startsWith('gmh_') ? { typed_approval_words: message } : {}),
        ...(editsForThisCard !== undefined ? { proposal_edits: editsForThisCard } : {}) } : {};
    /**
     * ⭐ AN APPROVAL IS ONE ACTION (DL-3 18 Oct; Codex co-design §2; assessment K5 L2: "Yes, I approve the proposed 10%" was
     * refused while its card waited). The cards held at turn start, in both dialects, joined with this process's outstanding
     * proposals: a durable union, never one remembered chip.
     *  · ONLY A CARD THE USER IS SHOWN (Codex BLOCK 18 Oct, P1): the client sends the cards it displays at the revisions it
     *    rendered (`displayed_proposals`). A card it does not show, or shows at another revision (a replacement whose reply
     *    was lost), binds nothing, and its own button is offered; so does a turn that sends no displayed set.
     *  · Words EXACTLY equal to the ONE waiting card's button words ARE its press (R2 T1: the UI's chip sends those words).
     *  · Otherwise, with exactly ONE card waiting, the user's typed words reach the Agent bound to that card, as its press would
     *    be: the host picks the card (its id and the button words every per-family gate checks), and the Agent's own reading of
     *    the words decides — approve (the approve tool on THAT id), amend, decline or discuss. Nothing is written unless it calls
     *    the approve tool on it, and no other id is bound. A card made during this turn is never in this set.
     *  · Either way the write keeps the user's exact typed words as its consent (`typed_assent`), quoted in the receipt.
     *  · Two or more waiting: the host binds none — never the newest or the oldest. An EXPLICIT selection is honoured (PL
     *    amendment): the card the Agent names binds only if the client shows it (`typed_assent_cards`). An ambiguous yes
     *    binds nothing; the reply offers every card with its own button, the one the words seemed to mean first.
     */
    // A card kept for review is never bound by typed words (it cannot be applied as it stands), nor by a stale press of the
    // approve button it had before the model changed — not even once the model is back where it was (the review stands).
    const reviewIdsAtStart = new Set(heldAtStart.filter(heldCardUnderReview).map((h) => heldProposalId(h)));
    const staleReviewPress = approvedProposal !== undefined && reviewIdsAtStart.has(approvedProposal) ? approvedProposal : undefined;
    if (staleReviewPress !== undefined) { approvedProposal = undefined; pressedApproval = {}; }
    const heldCardIds = [...new Map(heldAtStart.filter((h) => !heldCardUnderReview(h)).flatMap((h) => {
      const card = proposalRecord(h, undefined)?.approve_action;
      const id = card === undefined ? undefined : typedApprovalOf({ chip: { id: card.id } });
      return card === undefined || id === undefined ? [] : [[id, card] as const];
    })).entries()];
    const waitingIds = new Set([...heldCardIds.map(([id]) => id), ...proposals.outstanding(scenarioId, userId).map((p) => p.proposal_id)
      .filter((id) => !reviewIdsAtStart.has(id))]);
    const soleId = waitingIds.size === 1 ? [...waitingIds][0]! : undefined;
    // Its card as the user was shown it: the durable carrier, or this subject's last offer (the store may hold no carrier).
    const soleCard = soleId === undefined ? undefined : [heldCardIds.find(([id]) => id === soleId)?.[1], lastApproveOffer.get(approveKey),
      carriedProposals.get(approveKey)?.chip].find((c) => c !== undefined && typedApprovalOf({ chip: { id: c.id } }) === soleId);
    const shown = displayedProposalsOf(body['displayed_proposals']);
    const revisionAtStart = new Map(heldAtStart.flatMap((h) => { const r = proposalRecord(h, undefined); return r === undefined ? [] : [[r.proposal_id, r.revision] as const]; }));
    if (approvedProposal === undefined && typedNow !== null && soleId !== undefined && soleCard !== undefined
      && shownAsHeldNow(shown, soleId, revisionAtStart.get(soleId))) {
      if (soleCard.message === typedNow) approvedProposal = soleId;
      pressedApproval = { typed_approval_of: soleId, typed_approval_words: soleCard.message, typed_assent: typedNow };
    } else if (approvedProposal === undefined && typedNow !== null && waitingIds.size > 1) {
      // ⭐ Several cards waiting (PL amendment, 18 Oct): an explicit selection is honoured. Nothing is bound now; the card the
      // Agent names when it approves binds only if it is one the client SHOWS at the revision held now (`typed_assent_cards`).
      // An ambiguous yes is the Agent's to ask about, and the reply re-offers every card.
      const shownCards = heldCardIds.filter(([id]) => shownAsHeldNow(shown, id, revisionAtStart.get(id)));
      if (shownCards.length > 0) pressedApproval = { typed_assent: typedNow, typed_assent_cards: Object.fromEntries(shownCards.map(([id, card]) => [id, card.message])) };
    }
    // Client turn_id controls durable replay when supplied. Every request also has a host
    // identity for the writer, including valid approvals from clients that omit turn_id.
    const authorshipWords = histories.authorshipWords(sessionId);
    const toolCtx: AgentToolContext = { ...pressedApproval, scenario_id: scenarioId, authenticated_user_id: userId, request_id: req.id, turn_id: turnId ?? String(req.id), user_turn_text: typedNow ?? '', user_text: userWordsOf(authorshipWords.verified, typedNow), verified_user_messages: [...authorshipWords.verified, ...(typedNow === null ? [] : [typedNow])], unverified_user_text: authorshipWords.unknown.join("\n"), user_text_complete: refusal !== 'unknown_session' && earlierWordsKnown && authorshipWords.complete, ...(precedingAsk === undefined ? {} : { preceding_assistant_text: precedingAsk }) };
    // The existing K2-bound press authorises one calculation on this turn, not model writes.
    const runPress = approvedProposal === undefined && typedRunOf(body);
    let runPressConsumed = false;
    let runPressResult: Awaited<ReturnType<typeof capabilities.runAnalysis>> | undefined;
    let runPressToolMs = 0;
    const loopCapabilities = !runPress ? capabilities : {
      ...capabilities,
      runAnalysis: async (ctx: AgentToolContext, args: Parameters<typeof capabilities.runAnalysis>[1]) => {
        if (runPressConsumed) return { ok: false, mutated: false, ran: false, refusal: 'run_press_consumed',
          detail: 'This Run press has already been used. No second analysis ran.' };
        runPressConsumed = true;
        // N1: only this agent call supplies timing. Never merge request or chip parameters here.
        const started = Date.now();
        try {
          runPressResult = await capabilities.runAnalysis(ctx, { reason: args.reason, effects_timing: args.effects_timing });
          return runPressResult;
        } finally {
          runPressToolMs += Date.now() - started;
        }
      },
    };
    /**
     * ⭐ ANALYSE AFTER EVERY COMMITTED CHANGE (Paul, #94 6166259456: "run analysis and science-based AI coaching after every
     * implemented change"; supersedes the explicit-Run-only rule for this flow). A change this turn COMMITTED runs the
     * EXISTING Run path once, on the saved revision, when that revision's readiness admits a Run. ONE per request: on `core`
     * the committing tool asks for it (its outcome rides that tool's result, so the AI that writes the reply has it: PATH-B
     * gap 4), and the turn's end below gets the same answer, never a second Run.
     */
    let committedAnalysis: Promise<{ readonly run?: Awaited<ReturnType<typeof capabilities.runAnalysis>>; readonly ready?: unknown }> | undefined;
    let analysisToCore = false;
    const analyseCommittedChange = () => committedAnalysis ??= (async () => {
      const savedRead = await readBackState(readingDispatch, scenarioId);
      if (!admitsRunOffer(savedRead.analysisReady)) return { ready: savedRead.analysisReady };
      // The AI's timing reading, carried from the Run current when the turn began while this change left its subject as it was.
      const turnStart = (await readCache.turnStartRead())?.json as { graph?: unknown; analysis_result?: unknown } | undefined;
      return { run: await capabilities.runAnalysis(toolCtx, { reason: 'Analyse the model as just saved.',
        effects_timing: carriedEffectsTiming(turnStart, savedRead.graph) }, { afterCommittedChange: true }) };
    })();
    if (typedNow !== null) histories.recordTyped(sessionId, typedNow, toolCtx.user_text_complete);
    // Publishing typed words to in-memory session history is not a durable save, but "Nothing was saved" can't cover it.
    if (typedNow !== null) recordUnsavableEffect();

    let levelAsk: ReturnType<typeof latestCurrentLevelAsk> = null;
    // Olumi's own current-level and deadline asks (and the cards they force) are host asks: `full` only, never `core`.
    if (mode === 'full' && typeof store.readMostRecentPendingActions === 'function') {
      try {
        levelAsk = latestCurrentLevelAsk(await store.readMostRecentPendingActions(scenarioId, { validation: 'strict' }), scenarioId, userId);
      } catch (err) {
        log.warn({ err: String(err), scenario_id: scenarioId }, 'agent-lane: current-level ask unreadable — ordinary routing');
      }
    }

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
    let fastPath: 'approve' | 'run' | 'explain' | 'research' | 'strengthen' | 'method' | undefined;
    let guidanceHistory: Awaited<ReturnType<NonNullable<typeof store.readGuidanceHistory>>> | null = null;
    let guidanceHistoryRead = false;
    const readTurnGuidanceHistory = async (): Promise<void> => {
      if (guidanceHistoryRead) return;
      guidanceHistoryRead = true;
      if (typeof store.readGuidanceHistory === 'function') {
        try { guidanceHistory = await store.readGuidanceHistory(scenarioId); }
        catch (err) { log.warn({ scenario_id: scenarioId, err: String(err) }, 'agent-lane: guidance history unreadable'); }
      }
    };
    let preReplySelection: TurnGuidanceSelection | undefined;
    let eligibleIntervention: EligibleIntervention | undefined;
    // Converse and Explain carry the same selection from the same canonical read.
    const interventionForModel = async (read: Awaited<ReturnType<typeof readBackState>>, request: ReturnType<typeof guidanceRequestOf>) => {
      await readTurnGuidanceHistory();
      preReplySelection = selectTurnGuidanceShown({
        request,
        offeredSpecific: executableWaitingProposalIds(scenarioId, userId, read.graphHash, read.graph).map(id => ({ id: approvalChipIdFor(id) })),
        licence: leaderLicenceFromState(read.analysisState, read.analysisReady), guidance: guidanceHistory,
        runKey: runExplanationChip(scenarioId, read)?.id.slice(RUN_EXPLANATION_PREFIX.length),
        state: read,
      });
      eligibleIntervention = eligibleInterventionFor(preReplySelection.wire);
      return eligibleIntervention === undefined ? {} : { eligible_intervention: eligibleIntervention };
    };

    let handledGuidancePress: HandledGuidancePress | undefined;
    /** Whether the Run fast path made its one interpreting model call (a failed run makes none). */
    let runInterpreted = false;
    let firstAnalysisResultFirst = false;
    let narrationStatus: 'pending' | 'unavailable' | 'ready' | 'stale' | undefined;
    /** C5b: the view the Run button's one interpreting call gave as a typed field — never composed for it. */
    let fastPathView: ProvisionalView | null = null;
    let explanationRead: Awaited<ReturnType<typeof readBackState>> | undefined;
    /**
     * The NARRATOR's own words on this turn, exactly as the model wrote them (the explanation's raw answer, or the Agent
     * loop's reply), or null when the reply is Olumi's own text. Read for the Explain robustness caveat; the reply's shape
     * is the composer's (`reply/compose-reply.ts`), over the final text.
     */
    let narratorWords: string | null = null;
    let explainRobustnessCaveat: string | null = null;
    let explainFallbackText: string | undefined;
    let explanationBriefText: string | null = null;
    /** A Run with no result: its typed outcome's own chips (the identity ask's "Check the figures", a retry), `run-outcome.ts`. */
    let runOutcomeChips: OfferedAction[] = [];
    let runOutcomeSaid = false;
    /** Which typed outcome this turn's Run was said as (`run-outcome.ts`), on either path; `undefined` when none. */
    let runOutcomeKind: RunOutcome['kind'] | undefined;
    /** CEE's own words for a Run that did not run (the Run button), a typed host part for the composer. */
    let runOutcomeText: string | undefined;
    let result: AgentTurnResult | undefined;
    /** PATH-B: the SDK runtime and trace of a `core` turn the Agents SDK ran (`_agent.sdk`); undefined on every other turn. */
    let coreSdk: CoreTurnSdk | undefined;
    if (isDrawnLinkPress((body['chip'] as { id?: unknown } | undefined)?.id)) {
      result = await drawnLinkPress(
        (body['chip'] as { id: string }).id, { ctx: toolCtx, history, message, instructions: AGENT_INSTRUCTIONS, maxOutputTokens: budget.max_output_tokens, mode },
        (await readBackState(readingDispatch, scenarioId)).graph, capabilities, callModelFor(budget));
      fastPath = 'method';
    }
    /** S-D: this turn's approve-with-edits applied nothing (its own sentence says so; no generic "Not saved" line). */
    let editsRefusedThisTurn = false;
    const keptProposal = keptProposalOf((body['chip'] as { id?: unknown } | undefined)?.id);
    if (keptProposal !== undefined) {
      const started = Date.now();
      const withdrawn = await dispatchTool(WITHDRAW_PROPOSAL, JSON.stringify({ proposal_id: keptProposal }), toolCtx, capabilities, mode);
      const said = withdrawn.ok === true ? 'Your options stay as they are. The suggested change has been withdrawn.'
        : 'Your options stay as they are. That suggested change could not be withdrawn.';
      const ms = Date.now() - started;
      result = {
        assistant_text: said,
        items: [...(history ?? []), { role: 'user', content: [{ type: 'input_text', text: message }] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: said }] }],
        tool_calls: [{ name: WITHDRAW_PROPOSAL, ok: withdrawn.ok === true, mutated: false, proposal_id: keptProposal }],
        tool_results: [withdrawn], mutated: false, hops: 0, stopped_reason: 'answered',
        timing: { total_ms: ms, provider_ms: 0, tool_ms: ms, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 1, hops: 0 },
      };
    }
    /**
     * ⭐ S-D: the typed decline of a held proposal ("Not now" on its card or panel). Words alone never set one aside;
     * this exact press does, through the same withdraw the Agent uses, and Olumi says so.
     */
    const declinedHold = declinedProposalOf((body['chip'] as { id?: unknown } | undefined)?.id);
    /**
     * ⭐ PATH-B: in `core`, a press on the card of the scenario's paused SDK run answers THAT run: the SDK resumes its saved
     * state, and the tool's own approval path (authorise, write, readback) runs under it. Every other press keeps its path.
     */
    const corePaused = mode === 'core' && result === undefined && (approvedProposal !== undefined || declinedHold !== undefined)
      ? await store.readOpenAiPausedRun?.(scenarioId).catch(() => undefined) : undefined;
    /**
     * ⛔ ONE consent check for a paused core change, whether pressed on its card or typed (Codex #3461 R1/R2). An approval of it
     * resumes it only when its words are THE offered card's own button words (a chip sends them; typed words equal to them are
     * the press, #3013) and it carries no edits (the paused tool takes none). With edits it is refused, and nothing resumes;
     * other words are not a press: they go to the AI as a message, which declines the paused call. The legacy path never acts.
     */
    /**
     * A core change shown on its card WITHOUT a paused run (the AI prepared it with propose_change and said so; VERIFIER K7):
     * its press approves that same change through the SDK's own apply_change (the run's first call; the press approves the
     * interruption it raises), never the full lane's writer, under this same ONE consent check.
     */
    const coreCardOnly = mode === 'core' && result === undefined && corePaused == null && approvedProposal !== undefined
      && isChangeProposal(proposals.get(approvedProposal));
    const coreOwns = coreCardOnly || (corePaused != null && result === undefined
      && ((approvedProposal !== undefined && approvedProposal === corePaused.proposal_id) || (declinedHold !== undefined && declinedHold === corePaused.proposal_id)));
    const sentEdits = coreOwns && approvedProposal !== undefined ? parseProposalEdits(body['proposal_edits']) : undefined;
    /**
     * P0 (served efa5c543: K5-LOOP turn 3, browser K5 21:40Z): the UI's ordinary press carries the issued card's own envelope
     * with NO fields. That is the UNEDITED press of THIS card (its id, revision and digest exactly as issued on this model), so
     * it is the press, never an edit. A non-empty, malformed, foreign or no-longer-matching envelope is still refused below.
     */
    let uneditedPress = false;
    if (sentEdits != null && sentEdits.fields.length === 0 && sentEdits.proposal_id === approvedProposal) {
      const issued = heldAtStart.find((h) => heldProposalId(h) === approvedProposal);
      const record = issued === undefined ? undefined : proposalRecord(issued, (await readBackState(dispatch, scenarioId)).graph);
      uneditedPress = record !== undefined && record.revision === sentEdits.revision && record.digest === sentEdits.digest;
    }
    if (coreOwns && sentEdits !== undefined && !uneditedPress) {
      const said = editsRefusedSentence(sentEdits === null ? 'malformed' : 'refused');
      result = {
        assistant_text: said,
        items: [...(history ?? []), { role: 'user', content: [{ type: 'input_text', text: message }] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: said }] }],
        tool_calls: [], tool_results: [], mutated: false, hops: 0, stopped_reason: 'answered',
        timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 0, hops: 0 },
      };
    }
    const coreCard = coreOwns && approvedProposal !== undefined
      ? [offeredCard, soleCard].find((c) => c !== undefined && typedApprovalOf({ chip: { id: c.id } }) === approvedProposal) : undefined;
    const corePress = !coreOwns || result !== undefined ? undefined
      : approvedProposal !== undefined ? (coreCard !== undefined && coreCard.message === message ? { decision: 'approve' as const, proposal_id: approvedProposal } : undefined)
      : { decision: 'decline' as const, proposal_id: declinedHold! };
    if (declinedHold !== undefined && result === undefined && !coreOwns) {
      const started = Date.now();
      const named = heldAtStart.find((p) => heldProposalId(p) === declinedHold);
      const withdrawn = await dispatchTool(WITHDRAW_PROPOSAL, JSON.stringify({ proposal_id: declinedHold }), toolCtx, capabilities, mode);
      const said = withdrawn.ok === true ? heldDeclineSentence(named !== undefined ? heldChangeLabel(named) : undefined)
        : 'That change is no longer waiting, so there was nothing to set aside. Nothing in the model changed.';
      const ms = Date.now() - started;
      result = {
        assistant_text: said,
        items: [...(history ?? []), { role: 'user', content: [{ type: 'input_text', text: message }] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: said }] }],
        tool_calls: [{ name: WITHDRAW_PROPOSAL, ok: withdrawn.ok === true, mutated: false, proposal_id: declinedHold }],
        tool_results: [withdrawn], mutated: false, hops: 0, stopped_reason: 'answered',
        timing: { total_ms: ms, provider_ms: 0, tool_ms: ms, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 1, hops: 0 },
      };
    }
    /**
     * ⭐ S-D APPROVE-WITH-EDITS (design §6): edits that cannot bind to THIS card (malformed, another proposal, or a
     * proposal that takes none in slice 1) apply nothing: the proposal stays held, and the reply says why. Valid edits
     * ride the SAME approval below (the tool context's `proposal_edits`) to the existing door, which applies them in one commit.
     */
    if (approvedProposal !== undefined && result === undefined && !coreOwns && proposalEdits !== undefined && editsForThisCard === undefined) {
      const said = editsRefusedSentence('malformed');
      result = {
        assistant_text: said,
        items: [...(history ?? []), { role: 'user', content: [{ type: 'input_text', text: message }] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: said }] }],
        tool_calls: [], tool_results: [], mutated: false, hops: 0, stopped_reason: 'answered',
        timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 0, hops: 0 },
      };
    }
    if (approvedProposal !== undefined && result === undefined && !coreOwns) {
      const fastStartedAt = Date.now();
      let edited: ReturnType<typeof amendAgentProposal> | undefined;
      let editsFailure: 'stale' | 'not_held' | 'refused' | undefined;
      const originalCarrier = heldAtStart.find(h => heldProposalId(h) === approvedProposal);
      const original = originalCarrier !== undefined ? agentProposalOf(originalCarrier) : undefined;
      // A settled card has no held carrier; the store still owns its idempotent already-applied result.
      if (approvedProposal.startsWith('prop_') && original === undefined && !proposals.isApplied(approvedProposal)
        && typeof store.readMostRecentPendingActions === 'function') editsFailure = 'not_held';
      if (editsForThisCard !== undefined && approvedProposal.startsWith('prop_')) {
        const current = await readBackState(dispatch, scenarioId);
        const record = originalCarrier !== undefined ? proposalRecord(originalCarrier, current.graph) : undefined;
        const settled = proposals.get(approvedProposal);
        // A plain re-press of an APPLIED card has no edits to bind and nothing held to bind them to: its carrier was consumed
        // by its own commit. The capability answers it, as it answers the same press without a binding: its original
        // receipts and no write (an applied deadline also needs its committed operation and a native read-back). REC-WRITE
        // (served 390a1dbe): refused here as not held, the user read "That card is out of date" for a change that was saved.
        const recoveringApplied = editsForThisCard.fields.length === 0 && proposals.isApplied(approvedProposal) && settled !== undefined;
        if (!recoveringApplied) {
          if (!record || !original) editsFailure = 'not_held';
          // Bound to the model the card was SHOWN on (the current one, or its own base) and still applying NOW by the one rule
          // the turn showed it by (#3031 buddy: a card shown after an unrelated approval was refused here by its base hash).
          else if (record.revision !== editsForThisCard.revision || record.digest !== editsForThisCard.digest
            || (editsForThisCard.graph_hash !== current.graphHash && editsForThisCard.graph_hash !== record.base_graph_hash)
            || originalCarrier === undefined || !heldRecordAppliesAt(originalCarrier, record, current.graph, current.graphHash)) editsFailure = 'stale';
          else if (record.approve_action.id !== (body['chip'] as { id?: unknown })?.id || record.approve_action.message !== message) editsFailure = 'refused';
          else {
            if (editsForThisCard.fields.length > 0) {
              edited = amendAgentProposal(record, original, editsForThisCard.fields);
              if (!edited.ok) editsFailure = 'refused';
              else if (edited.proposal.proposal_id !== approvedProposal) { proposals.put(edited.proposal); proposals.discard(approvedProposal); }
              else edited = undefined;
            }
          }
        }
      }
      const target = edited?.ok ? edited.proposal.proposal_id : approvedProposal;
      if (editsFailure === undefined) interruptIfArmed(recoveryFault, 'before_write');
      const applied = editsFailure !== undefined
        ? { ok: false, mutated: false, refusal: editsFailure === 'stale' ? 'edits_superseded' : editsFailure === 'not_held' ? 'unknown_proposal' : 'edits_refused' }
        : await dispatchTool('authorise_change', JSON.stringify({ proposal_id: target }),
          edited?.ok ? { ...toolCtx, typed_approval_of: target, proposal_edits: undefined } : toolCtx, capabilities, mode);
      if (edited?.ok) {
        if (applied.ok === true && applied.mutated === true) { proposals.discard(approvedProposal); Object.assign(applied, { user_edits: edited.userEdits }); }
        else { proposals.discard(target); if (original !== undefined && applied.mutated !== true) proposals.put(original); }
      }
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
         *
         * ⛔ AND NEVER AN INSTRUCTION MEANT FOR THE AGENT (served f2, CEE `af719a1`, scenario `bdba963b`): the
         * link-strength follow-up reached the user as "… Offer to run the analysis again so they can see what it
         * changes." Every follow-up passes the same boundary (`withoutAgentDirections`), so a capability that puts
         * Agent guidance in the wrong field drops that sentence here, and the drop is logged — not shown.
         */
        const guarded = withoutAgentDirections(typeof applied.follow_up === 'string' ? applied.follow_up : '');
        if (guarded.dropped.length > 0) {
          log.warn({ scenario_id: scenarioId, dropped: guarded.dropped }, 'agent-lane: a follow-up addressed to the Agent was withheld from the user');
        }
        // ⭐ S-D: what the user set vs what Olumi held, server-authored from the hold's own record, only once it landed.
        const editsApplied = applied.ok === true && applied.mutated === true ? readUserEdits(applied.user_edits) : undefined;
        const refusedBinding = editsForThisCard?.fields.length === 0
          && (applied.refusal === 'edits_superseded' || applied.refusal === 'superseded' || applied.refusal === 'unknown_proposal');
        /**
         * ⭐ E-TAIL (a) (run 4 deadline turns 7 and 14; §7.3, receipts are accurate): the card's plain "Yes" arrives with
         * `fields: []`. When the CAPABILITY refused it (not a binding refusal of the press), no value was edited, so "Those
         * values could not be applied" was false: the narrator's status and the capability's own reason are said instead,
         * the reason through the same Agent-direction boundary as every follow-up.
         */
        const plainRefusedByCapability = editsForThisCard?.fields.length === 0 && applied.ok !== true && applied.mutated !== true
          && !refusedBinding && applied.refusal !== 'edits_refused';
        editsRefusedThisTurn = editsForThisCard !== undefined && applied.ok !== true && applied.mutated !== true && !plainRefusedByCapability;
        const ownReason = plainRefusedByCapability && guarded.text.trim() === '' && typeof applied.detail === 'string'
          ? withoutAgentDirections(applied.detail).text.trim() : '';
        const editedLinks = editsApplied !== undefined && original !== undefined && original.operations.length > 0 && original.operations.every(o => o.op === 'set_link_strength');
        const followUp = [editedLinks ? '' : guarded.text.trim(), ownReason, editsApplied !== undefined ? userEditsReceipt(editsApplied) : '',
          editsRefusedThisTurn ? refusedBinding ? PLAIN_APPROVAL_SUPERSEDED
            : editsRefusedSentence(applied.refusal === 'edits_superseded' ? 'stale' : applied.refusal === 'unknown_proposal' ? 'not_held' : 'refused') : '']
          .filter((x) => x !== '').join(' ');
        // Refused edits are said in Olumi's own sentence above; the generic "Not saved" narrator line would say it twice.
        const said = [editsRefusedThisTurn ? '' : narrateWriteOutcome('', [call], [applied], { versioned: userId !== null }).status ?? '', followUp].filter((x, i, all) => x !== '' && all.indexOf(x) === i).join(' ');
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
     * THE ONE INTERPRETING CALL over the Run the canonical read selects: the Explain press (request 2 below) and the automatic
     * Run after a committed change (#3038; Paul, #94 6166259456: "run analysis and science-based AI coaching after every
     * implemented change"). The same canonical assembly, asked-once handling, rerun plan from the selected delta (the
     * comparison #3036 gives the model) and tool-less call; `admit` false spends no call.
     */
    let interpretedCardIdentity: unknown;
    const interpretSelectedRun = async (st: Awaited<ReturnType<typeof readBackState>>, runDelta: unknown,
      conversation: readonly unknown[], admit: boolean, briefText: unknown, freshRunIdentity?: unknown) => {
      let admitted = admit;
      // The same completed canonical assembly the ordinary Agent reads: no stored result/enrichment packet.
      const canonicalAfterRun: Awaited<ReturnType<typeof capabilities.getCanonicalState>> = { ...await capabilities.getCanonicalState(toolCtx, { section: 'run_explanation' }),
        ...await interventionForModel(st, 'narration') };
      // A refused canonical read follows the same early refusal as an unmatched Explain control.
      if (canonicalAfterRun.ok !== true) admitted = false;
      const selectedRun = canonicalAfterRun.analysis as Record<string, unknown> | undefined;
      // ⭐ NEVER RE-ASK (G1b d4): retain the Explain path's asked-once handling on the canonical finding.
      const goalChanceRead = selectedRun?.goal_chance as { say: string } | undefined;
      const goalChanceAskedOnce = goalChanceRead === undefined ? ''
        : withoutAskedQuestion(goalChanceRead.say, await repliesToCheckAsks([goalChanceRead.say], historyReader, scenarioId, undefined));
      const goalChanceAsked = goalChanceRead === undefined || goalChanceAskedOnce === '' ? goalChanceRead : { ...goalChanceRead, say: goalChanceAskedOnce };
      // SAY-SHOWN: the Run this call interprets promised its `say` is shown, and the route keeps that promise; so is this call.
      const goalChanceNow = goalChanceAsked === undefined ? undefined : withRunsSayShownPromise(goalChanceAsked, result?.tool_results ?? []);
      // ⭐ NEVER RE-ASK: the scoped section's question-bearing text is asked once too; its finding stays.
      const section = canonicalAfterRun.run_explanation as Record<string, unknown> | undefined;
      const target = section?.target_testability as Record<string, unknown> | undefined;
      const sensitivity = section?.decision_sensitivity as Record<string, unknown> | undefined;
      const sectionReplies = await repliesToCheckAsks([target?.say, sensitivity?.say]
        .filter((l): l is string => typeof l === 'string'), historyReader, scenarioId, undefined);
      const askedOnce = (carrier: Record<string, unknown>, key: string): Record<string, unknown> => {
        const kept = withoutAskedQuestion(carrier[key] as string, sectionReplies);
        const { [key]: _asked, ...rest } = carrier;
        return kept.trim() === '' ? rest : { ...carrier, [key]: kept };
      };
      const sectionNow = section === undefined || sectionReplies.length === 0 ? section : {
        ...section,
        ...(typeof target?.say === 'string' ? { target_testability: askedOnce(target, 'say') } : {}),
        ...(typeof sensitivity?.say === 'string' ? { decision_sensitivity: askedOnce(sensitivity, 'say') } : {}),
      };
      const canonicalFacts = runFactsContext(canonicalAfterRun).facts;
      const interpreterFacts = canonicalFacts.run_facts as Record<string, unknown> | undefined;
      // Only a fresh Run can deliver a card in THIS response. Explain and historical/stale/foreign cards own nothing here.
      const shownCard = admitted && interpreterFacts?.current === true
        && (st.analysisState as { run_state?: { kind?: unknown } } | undefined)?.run_state?.kind === 'complete_current'
        ? boundRunCard(st.canonicalAnalysisView, scenarioId, freshRunIdentity, st.analysisResult) : undefined;
      const shown = shownCard === undefined ? undefined : { run_id: shownCard.run!.run_id,
        findings: shownCard.options.flatMap(({ option_id, cell }) => cell.kind !== 'none' && typeof cell.face === 'string' && cell.face !== ''
          ? [{ option_id, text: cell.face }] : []),
        disclosures: cardDetailLinesOf(shownCard)?.disclosures ?? [] };
      if (shown !== undefined) interpretedCardIdentity = freshRunIdentity;
      const runForInterpreter = {
        ...canonicalFacts,
        ...(shown === undefined || interpreterFacts === undefined ? {} : {
          run_facts: { ...interpreterFacts, shown_on_card: shown } }),
        ...(goalChanceNow === undefined ? {} : { analysis: { ...selectedRun, goal_chance: goalChanceNow } }),
        ...(sectionNow === undefined ? {} : { run_explanation: sectionNow }),
      };
      const explanationInput = turnContextItems({ now: new Date(), briefText, conversation,
        verifiedUserMessages: toolCtx.verified_user_messages, unknownUserText: toolCtx.unverified_user_text,
        canonicalState: runForInterpreter, request: RUN_EXPLANATION_MESSAGE, currentRequestOrigin: typedNow === null ? 'product control' : 'typed' });
      const standingAfterRun = leaderStandingOf(st);
      const askView = standingAfterRun !== null && standingAfterRun.analysis_on_record && standingAfterRun.withheld;
      // ⭐ M2 RERUN-EXPLANATION (MG; RC contract; DL ruling 5940472067): what changed between the two Runs is Olumi's own
      // CODE LINE from the selected delta's TYPED rows; the model only says why, and its sentences pass RC's checker beside
      // that line. `null` (no delta: a first Run) leaves this path exactly as it was.
      const graphNodes = Array.isArray((st.graph as { nodes?: unknown } | null)?.nodes) ? (st.graph as { nodes: { id?: unknown; kind?: unknown; label?: unknown }[] }).nodes : [];
      // SD-1 interim: a link restated inside its band, and (cut 6) the links the user wrote between the two Runs, both read
      // from the pair's own persisted Run facts (never on the wire).
      const pairRead = await rerunPairReadForRunDelta(scenarioId, String(req.id), runDelta);
      const rerunPlan = rerunExplanationPlan(runDelta,
        (id) => { const n = graphNodes.find((x) => x.id === id); return typeof n?.label === 'string' ? n.label : undefined; },
        [...new Set([...graphNodes.filter((n) => n.kind === 'option' && typeof n.label === 'string').map((n) => n.label as string),
          ...[...optionNameAliases(st.graph).values()].map((a) => a.display)])],
        runToolOutputLicensesLeader(selectedRun),
        graphNodes.map((n) => n.label).filter((l): l is string => typeof l === 'string' && l.trim() !== ''),
        pairRead.withinBand, pairRead.userWrittenLinks, pairRead.frameRefitLinks);
      const providerStartedAt = Date.now();
      let interpreted: { answer: string; messages: Record<string, unknown>[] } | undefined;
      let explanationReady = false;
      let words: string | null = null;
      if (admitted) try {
        // 2a: the interpret role's measured budget (Sol, effort low) and a deadline; the Run stands whatever happens here.
        const interpret = interpretBudget();
        const resp = await callModelFor(interpret)({
          // Standing unit/authorship/calculation safeguards remain; RUN_FACTS_USE is the one Run coaching instruction.
          instructions: instructionsForMode(mode, `${AGENT_INSTRUCTIONS}\n\n${eligibleIntervention === undefined ? '' : `${ELIGIBLE_INTERVENTION_INSTRUCTION}\n\n`}${askView ? `${RUN_INTERPRETATION_VIEW_INSTRUCTION}\n\n` : ''}${INTERPRET_ONLY_CONSTRAINT}\n\n${RUN_FACTS_USE}`),
          input: explanationInput,
          // No tools at all: acting is structurally impossible on this call (and no schema tokens
          // are spent on tools it may not use). Measured against the live API: accepted with the
          // server-recorded run pair in history.
          tools: [],
          max_output_tokens: interpret.max_output_tokens,
          tool_choice: 'none',
          deadline_ms: INTERPRET_DEADLINE.ms,
          ...(askView ? { text: { format: RUN_INTERPRETATION_FORMAT } } : {}),
        } as never);
        const out = (resp.output ?? []) as { type?: string; content?: { type?: string; text?: string }[] }[];
        const rawAnswer = out.filter((o) => o.type === 'message').flatMap((o) => o.content ?? [])
          .filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('');
        // C5b: the typed answer, when asked for and given. A plain-text interpretation stays the reply; JSON that is
        // not the typed answer is never shown to the user (it is treated as no interpretation).
        const typed = askView ? readRunInterpretation(rawAnswer) : null;
        const answer = typed !== null ? typed.answer : askView && rawAnswer.trim().startsWith('{') ? '' : rawAnswer;
        if (typed !== null) {
          // M2: the typed view is the model's words too (Codex pre-review e1c7c788 P1) — not shown when it fails RC's bans.
          const viewFailed = rerunPlan !== null && typed.view !== null ? rerunViewFailures(typed.view, rerunPlan) : [];
          if (viewFailed.length > 0) log.info({ scenario_id: scenarioId, failed: viewFailed }, 'agent-lane: rerun provisional view failed RC checks — not shown');
          fastPathView = viewFailed.length > 0 ? null : typed.view;
        }
        // ⛔ THE REASONING ITEM TRAVELS WITH ITS MESSAGE (served `f828a61`, witness c9: every turn after a
        // Run was refused "Item 'msg_…' of type 'message' was provided without its required 'reasoning'
        // item", HTTP 502). Kept in output order, exactly as the Agent loop keeps its whole output.
        if (answerIsIncomplete(resp as never)) log.warn({ scenario_id: scenarioId, incomplete_reason: (resp as { incomplete_reason?: unknown }).incomplete_reason ?? null }, 'agent-lane: fast-path interpretation incomplete — answering from the run itself');
        else if (answer.trim().length > 0) {
          const checked = rerunPlan === null ? answer : checkRerunExplanation(answer, rerunPlan).text;
          explanationReady = true;
          words = checked;
          interpreted = typed !== null
            ? { answer: checked, messages: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: checked }] }] }
            : { answer: checked, messages: out.filter((o) => o.type === 'reasoning' || o.type === 'message') as Record<string, unknown>[] };
        }
        else log.warn({ scenario_id: scenarioId }, 'agent-lane: fast-path interpretation was empty — answering from the run itself');
      } catch (err) {
        log.warn({ err: String(err), scenario_id: scenarioId }, 'agent-lane: fast-path interpretation failed — answering from the run itself');
      }
      return { admitted, interpreted, explanationReady, rerunPlan, words, providerMs: admitted ? Date.now() - providerStartedAt : 0 };
    };
    // Request 1 returns the existing canonical result without waiting for narration.
    // Request 2 is a typed read-only follow-up; it cannot fall through to the tool-enabled Agent.
    if (result === undefined && approvedProposal === undefined && isRunExplanationChip(explanationId)) {
      const fastStartedAt = Date.now();
      const st = await readBackState(readingDispatch, scenarioId);
      explanationRead = st;
      // This is the same cached canonical read, carrying the producer's selected-Run delta.
      // Never recover a delta from an earlier tool output or calculate one in the narration layer.
      const selectedRead = await readingDispatch(`/assist/v1/scenarios/${scenarioId}/graph`, {});
      explanationBriefText = typeof selectedRead.json.brief_text === 'string' ? selectedRead.json.brief_text : null;
      const currentRead = selectedRead.status === 200
        ? selectedRead.json.current_read as { run_delta?: unknown } | undefined : undefined;
      const admit = message === RUN_EXPLANATION_MESSAGE && !typedRunOf(body)
        && (body['chip'] as { action_type?: unknown } | undefined)?.action_type !== 'run_analysis'
        && runExplanationMatches(explanationId, scenarioId, st);
      const priorAndRun = [
        ...(history ?? []),
        { role: 'user', content: [{ type: 'input_text', text: RUN_EXPLANATION_MESSAGE }] },
      ];
      const { admitted: matches, interpreted, explanationReady, rerunPlan, words, providerMs: interpretMs } =
        await interpretSelectedRun(st, currentRead?.run_delta, history ?? [], admit,
          explanationBriefText);
      runInterpreted = matches;
      if (words !== null) narratorWords = words;
      narrationStatus = matches ? explanationReady ? 'ready' : 'unavailable' : 'stale';
      fastPath = 'explain';
      const ms = Date.now() - fastStartedAt;
      const providerMs = runInterpreted ? Math.min(interpretMs, ms) : 0;
      // M2: with no interpretation, a rerun still says Olumi's code line rather than nothing about what changed.
      const text = interpreted?.answer ?? (matches
        ? (rerunPlan?.fallback ?? interpretationUnavailableText({ ok: true, ran: true })) : RUN_EXPLANATION_UNAVAILABLE_TEXT);
      explainFallbackText = rerunPlan?.fallback;
      result = {
        assistant_text: text,
        items: [...priorAndRun, ...(interpreted?.messages ?? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }])],
        tool_calls: [], tool_results: [], mutated: false, hops: 0, stopped_reason: 'answered',
        timing: { total_ms: ms, provider_ms: providerMs, tool_ms: 0, overhead_ms: Math.max(0, ms - providerMs), tool_provider_ms: 0, provider_calls: runInterpreted ? 1 : 0, tool_calls: 0, hops: 0 },
      };
    }
    /**
     * ⭐ PUBLIC RESEARCH, ON THE USER'S CLICK ONLY (R1). The chip showed the exact query and its id is bound to it
     * (`approvedQueryOf`), so the click IS the disclosure decision: that query, and nothing else, goes to ONE native
     * web search. No model is changed and no tool can act. The reply is Olumi's own text over the reader's outcome:
     * the finding with the sources the search consulted, or a plain failure that describes no finding.
     */
    const researchChipId = (body['chip'] as { id?: unknown } | null | undefined)?.id;
    const researchQuery = result === undefined && approvedProposal === undefined
      && approvedQueryOf(researchChipId, message) !== null && takeResearchOffer(approveKey, researchChipId)
      ? approvedQueryOf(researchChipId, message) : null;
    if (researchQuery !== null) {
      const fastStartedAt = Date.now();
      let outcome: ResearchOutcome;
      let providerCalls = 0;
      try {
        providerCalls = 1;
        outcome = readResearchResponse(await callResearch(researchQuery));
      } catch (err) {
        log.warn({ err: String(err), scenario_id: scenarioId }, 'agent-lane: public research call failed — nothing is shown as found');
        outcome = { status: 'response_not_complete' };
      }
      fastPath = 'research';
      const text = researchReplyText(researchQuery, outcome);
      const ms = Date.now() - fastStartedAt;
      result = {
        assistant_text: text,
        items: [...(history ?? []), { role: 'user', content: [{ type: 'input_text', text: message }] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
        tool_calls: [{ name: 'public_research', ok: outcome.status === 'cited_finding', mutated: false }],
        tool_results: [{ ok: outcome.status === 'cited_finding', mutated: false, status: outcome.status,
          ...(outcome.status === 'cited_finding' ? { sources: outcome.sources } : {}) }],
        mutated: false,
        hops: 0,
        stopped_reason: 'answered',
        timing: { total_ms: ms, provider_ms: ms, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: providerCalls, tool_calls: 1, hops: 0 },
      };
    }
    /**
     * ⭐ S-B — AN ACTION PRESS IS DISPATCHED BY THE REGISTRY, ON THE CURRENT STATE (`agent-lane/actions/`; ACTION-SYSTEM
     * §C4/§D5/§E; github-a2 contract amendment 6). The press is re-derived on this turn's read, never trusted from the bar it
     * came from: a press whose offer still holds runs its EXISTING typed path below; one whose precondition fails (or an
     * `act:` id the registry does not hold) gets a typed "can't yet because X" and a working exit, with NO model call. A
     * typed card already waiting for the same offer is re-offered, never prepared twice (offer_key = idempotency).
     */
    let actionPress: ActionPress | null = null;
    let actionReply: ActionTypedReply | null = null;
    let actionReplyChips: OfferedAction[] = [];
    let actionFactsAtPress: ActionFacts | undefined;
    if (result === undefined && approvedProposal === undefined) {
      const decided = await (async () => {
        const chip = body['chip'];
        if (actionPressOf(chip, body['message']) === null) return null;
        const rb = await readBackState(readingDispatch, scenarioId);
        const facts = actionFactsOf({ scenarioId, graph: rb.graph, graphHash: rb.graphHash, analysisState: rb.analysisState,
          analysisReady: rb.analysisReady, analysisResult: rb.analysisResult, optionParticipation: rb.optionParticipation,
          identityEvaluated: rb.identityEvaluated });
        return { facts, decision: decidePress(chip, facts, undefined, body['message']), graphHash: rb.graphHash, graph: rb.graph };
      })();
      if (decided !== null && decided.decision.kind !== 'not_an_action') {
        actionPress = decided.decision.press;
        actionFactsAtPress = decided.facts;
        const remembered = actionPress.offer_key === null ? undefined : actionOfferProposals.get(`${scenarioId}:${actionPress.offer_key}`);
        // Still waiting = the store would execute the Agent proposal on this revision, or the product hold survives in the
        // latest carrier under the product's own survival rule (Codex r1 P1-1 on #2751: widen's card is a `gmh_` hold).
        let stillWaiting = false;
        if (remembered !== undefined && remembered.proposalId.startsWith('prop_')) {
          stillWaiting = executableWaitingProposal(scenarioId, userId, decided.graphHash, decided.graph) === remembered.proposalId;
        } else if (remembered !== undefined && typeof store.readMostRecentPendingActions === 'function') {
          try {
            // A product hold's pending carries its own id as `chip_id` (the approve chip is built from it).
            const holds = (await store.readMostRecentPendingActions(scenarioId, { validation: 'strict' }))
              .filter((pa) => pa.chip_id === remembered.proposalId || pa.chip_id === approvalChipIdFor(remembered.proposalId));
            stillWaiting = computeSurvivingPriorPendingsDetailed(holds, [], [], decided.graphHash, Date.now()).survivors.length > 0;
          } catch { stillWaiting = false; }
        }
        if (remembered !== undefined && stillWaiting) {
          actionReply = { text: 'That suggestion is already waiting for your yes. Approve it, or change something first.', reason: 'already_waiting', outcome: 'ran', exits: [] };
          actionReplyChips = [...remembered.chips];
        } else if (decided.decision.kind === 'reply') {
          actionReply = decided.decision.reply;
          actionReplyChips = actionExitChips(actionReply.exits);
        } else if (decided.decision.handler.route === 'propose_identity') {
          // GOAL-REACH: the bar opens the existing held card; its Yes keeps the sole identity_confirm writer.
          const issued = await dispatchTool('propose_identity', '{}', toolCtx, capabilities, mode);
          if (issued.ok === true && typeof issued.proposal_id === 'string') {
            fastPath = 'method';
            const text = identityIssuedText(issued);
            result = {
              assistant_text: text, items: [],
              tool_calls: [{ name: 'propose_identity', ok: true, mutated: false, proposal_id: issued.proposal_id }],
              tool_results: [issued], mutated: false, hops: 0, stopped_reason: 'answered',
              timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0,
                provider_calls: 0, tool_calls: 1, hops: 0 },
            };
          } else {
            actionReply = { text: typeof issued.detail === 'string' && issued.detail.trim() !== '' ? issued.detail : 'This reading cannot be confirmed now. Nothing changed.',
              reason: 'nothing_in_scope', exits: [] };
          }
        }
        if (actionReply !== null) {
          fastPath = 'method';
          const text = actionReply.text;
          result = { assistant_text: text, items: [], tool_calls: [], tool_results: [], mutated: false, hops: 0, stopped_reason: 'answered',
            timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 0, hops: 0 } };
        }
        log.info({ event: 'agent_lane.action_press', scenario_id: scenarioId, action_id: actionPress.action, has_offer_key: actionPress.offer_key !== null,
          decision: actionReply !== null ? 'typed_reply' : 'route', reason: actionReply?.reason ?? null }, 'agent-lane: action press dispatched');
      }
    }
    /**
     * ⭐ M1 — "STRENGTHEN THE MODEL" OPENS ONE CARD, WITH NO MODEL CALL (strengthen-press.ts; PTL 5938801653 #1). On a
     * current Run: ONE held `propose_link_strengths` for the S1 link at its current band (Olumi's estimate), and RC's
     * fixed copy. Its approve / amend chips come from this call, as for any proposal. No current Run, no S1 link or a
     * refused proposal keeps today's answer.
     */
    if (result === undefined && approvedProposal === undefined
      && (body['chip'] as { id?: unknown } | null | undefined)?.id === STRENGTHEN_PRESS_CHIP_ID) {
      const fastStartedAt = Date.now();
      const card = strengthenCardFor(await readBackState(readingDispatch, scenarioId));
      // Science 393023 LICENCE ruling 3: a placeholder S1 target is ASKED for its size; no proposal records its prior.
      if (card !== null && card.ask_only === true) {
        fastPath = 'strengthen';
        handledGuidancePress = { policy_id: 'RC-STRENGTHEN-ITEM', item: `${card.target.from_id}->${card.target.to_id}` };
        const text = card.text; const ms = Date.now() - fastStartedAt;
        result = {
          assistant_text: text,
          items: [...(history ?? []), { role: 'user', content: [{ type: 'input_text', text: message }] },
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
          tool_calls: [], tool_results: [], mutated: false, hops: 0, stopped_reason: 'answered',
          timing: { total_ms: ms, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 0, hops: 0 },
        };
      }
      const issued = card === null || result !== undefined ? undefined
        : await dispatchTool('propose_link_strengths', JSON.stringify(card.args), toolCtx, capabilities, mode);
      if (card !== null && issued !== undefined && issued.ok === true && typeof issued.proposal_id === 'string') {
        fastPath = 'strengthen';
        handledGuidancePress = { policy_id: 'RC-STRENGTHEN-ITEM', item: `${card.target.from_id}->${card.target.to_id}` };
        const text = card.text;
        const ms = Date.now() - fastStartedAt;
        result = {
          assistant_text: text,
          items: [...(history ?? []), { role: 'user', content: [{ type: 'input_text', text: message }] },
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
          tool_calls: [{ name: 'propose_link_strengths', ok: true, mutated: false, proposal_id: issued.proposal_id }],
          tool_results: [issued],
          mutated: false,
          hops: 0,
          stopped_reason: 'answered',
          timing: { total_ms: ms, provider_ms: 0, tool_ms: ms, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 1, hops: 0 },
        };
      } else {
        log.info({ scenario_id: scenarioId, s1_target: card !== null, refusal: issued?.refusal ?? null },
          'agent-lane: strengthen press found no S1 card; today\'s answer');
      }
    }
    /**
     * ⭐ T3 — AN ASKED PRE-MORTEM RUNS THE REASONING COACH'S METHOD (DL 5937411688 / 5937503623; RC `method_turns`
     * RC-PREMORTEM; `agent-lane/method-turn`). A recognised press ALWAYS gets the method's own answer, never ordinary
     * generation (CODEX_CLI_OVERFLOW P1 on #2480; DL 5939415083 (1)): the choose_plan buttons, ONE "can't run the
     * pre-mortem because …" reply, or the method turn itself — ONE model call with NO tool (below), its draft checked
     * BEFORE it is sent.
     */
    let methodTurn: MethodTurn | null = null;
    let tippingTurn: TippingPointCoaching | null = null;
    let methodGraph: unknown;
    let premortemInitialRead: Awaited<ReturnType<typeof readBackState>> | undefined;
    let premortemCandidates: unknown;
    let premortemPassed = false;
    let premortemReply: string | undefined;
    const pressedChipId = (body['chip'] as { id?: unknown } | null | undefined)?.id;
    /**
     * ⭐ "WHAT WOULD CHANGE THIS?" — ONE CHIP, TWO GROUNDED ANSWERS, MEASURED FIRST, ONE OWNER (`whatWouldChangeAnswer`,
     * shared with the replay). The measured link tipping points answer only when ISL measured them for the Run the
     * Explain control binds (`runExplanationChip`): no measurement is asked for a Run it cannot bind, a block measured for
     * any other Run is refused (`whatChangesTurnFor`), and the fresh final read re-checks the bound Run, as it does for
     * the coaching. #2522's own digest disagreeing with a canonically current Run (`stale`) never says "your model has
     * changed". Every other outcome (no Run, nothing measurable, stale, a timeout, an error, kill switch
     * CEE_WHAT_CHANGES_MEASURED_ENABLED=false) is the Run's own tipping-point coaching, exactly as before. Terminal and
     * with NO model call either way; the measured fetch persists nothing.
     */
    let whatChangesTurn: WhatChangesTurn | null = null;
    let measuredRunKey: string | null = null;
    let whatChangesRead: Awaited<ReturnType<typeof readBackState>> | undefined;
    let measuredCandidate: MeasuredWhatChanges | null = null;
    // ⭐ A4 slice 1: "Review this decision" — typed facts on the bound Run, no model call (`decision-review-press.ts`).
    let decisionReviewRequested = false;
    let decisionReviewTurn: DecisionReviewTurn | null = null;
    if (result === undefined && approvedProposal === undefined && pressedChipId === TIPPING_POINT_PRESS_ID) {
      const rb = await readBackState(readingDispatch, scenarioId);
      whatChangesRead = rb;
      const boundRun = runExplanationChip(scenarioId, rb);
      if (boundRun !== null && config.features.whatChangesMeasuredEnabled && isWhatChangesPress(pressedChipId)
        && chipOperationOf(body) === WHAT_CHANGES_CHIP_OPERATION) {
        const turn = await whatChangesTurnFor(pressedChipId, rb, (candidateLinks) => dispatchDecisionFlip({
          payload: {
            kind: 'message', scenario_id: scenarioId, turn_id: randomUUID(), stage: 'analyse', turn_class: 'decide',
            source: 'chip_click', message,
          },
          requestId: `${String(req.id)}:decision-flip`,
          candidateLinks,
        }));
        if (turn?.outcome === 'measured') measuredCandidate = { runKey: boundRun.id, turn };
        log.info({ scenario_id: scenarioId, what_changes: turn?.outcome ?? null, answered: measuredCandidate !== null }, 'agent-lane: what-would-change measured attempt');
      }
      // Selection and cache insertion wait for the final pending read and canonical scope composition below.
      measuredRunKey = measuredCandidate?.runKey ?? null;
      fastPath = 'method';
      result = { assistant_text: '', items: [], tool_calls: [], tool_results: [], mutated: false,
        hops: 0, stopped_reason: 'answered',
        timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 0, hops: 0 } };
    }
    if (result === undefined && approvedProposal === undefined && chipOperationOf(body) === DECISION_REVIEW_CHIP_OPERATION) {
      // Composed at assembly from the final, scope-composed read below (the one the response is built from).
      decisionReviewRequested = true;
      fastPath = 'method';
      result = { assistant_text: '', items: [], tool_calls: [], tool_results: [], mutated: false,
        hops: 0, stopped_reason: 'answered',
        timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 0, hops: 0 } };
    }
    if (result === undefined && approvedProposal === undefined && isMethodPress(pressedChipId)) {
      const rb = await readBackState(readingDispatch, scenarioId);
      methodGraph = rb.graph;
      premortemInitialRead = rb;
      methodTurn = methodTurnForReadback(pressedChipId, rb);
      // ⭐ A RECOGNISED METHOD TURN IS TERMINAL (DL round 3 on #2480, 5940698000): what the method returns — the checked
      // text and its own cards — is the answer. Every downstream composer below (the identity re-offer, write narration,
      // disclosures, other proposals and chips, coaching blocks) reads `fastPath === 'method'` and stays out.
      if (methodTurn !== null) fastPath = 'method';
      if (methodTurn !== null && methodTurn.kind !== 'run') {
        const text = methodTurn.reply;
        result = {
          assistant_text: text,
          // Never read: a method turn's history is written ONCE, from the final wire text (below, after the last gate).
          items: [],
          tool_calls: [],
          tool_results: [],
          mutated: false,
          hops: 0,
          stopped_reason: 'answered',
          timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 0, hops: 0 },
        };
        log.info({ scenario_id: scenarioId, method_turn: methodTurn.kind, ...(methodTurn.kind === 'unavailable' ? { reason: methodTurn.reason } : {}) },
          'agent-lane: method turn answered without a model call');
      }
    }
    /**
     * ⭐ WIDEN THE OPTIONS (PTL 5947349533; DL 5947426886; RC `method_turns.RC-WIDEN`; `method-turn/widen-turn.ts`). A
     * recognised press is TERMINAL like the pre-mortem's: ONE model call whose only tool is the add-option door, gated
     * by RC's structured checks BEFORE the door stores anything (`widenGate`), so it ends in ONE consent card or in RC's
     * deterministic fallback with no card. Unavailable (no goal, unread model) answers with no model call.
     */
    let widenTurn: WidenTurn | RunRisksWidenTurn | null = null;
    let widenGateResult: WidenGateResult | undefined;
    // ⭐ S-C: ONE door, a target per press (`widenTargetOf`, by identity): options (its one-card door) or risks.
    const widenTarget = widenTargetOf(pressedChipId, message);
    if (result === undefined && approvedProposal === undefined && methodTurn === null && widenTarget !== null) {
      const rb = await readBackState(readingDispatch, scenarioId);
      if (widenTarget === 'risks') {
        widenTurn = risksTurnForReadback(rb, toolCtx.user_text ?? '');
      } else {
        await readTurnGuidanceHistory();
        widenTurn = widenTurnForReadback(pressedChipId, rb, guidanceHistory);
      }
      if (widenTurn !== null) fastPath = 'method';
      if (widenTurn !== null && widenTurn.kind === 'unavailable') {
        result = {
          assistant_text: widenTurn.reply,
          items: [],
          tool_calls: [],
          tool_results: [],
          mutated: false,
          hops: 0,
          stopped_reason: 'answered',
          timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 0, hops: 0 },
        };
        log.info({ scenario_id: scenarioId, widen_turn: 'unavailable', reason: widenTurn.reason }, 'agent-lane: widen turn answered without a model call');
      }
    }
    const widenRun = widenTurn?.kind === 'run' ? widenTurn : undefined;
    const risksRun = widenTurn?.kind === 'run_risks' ? widenTurn : undefined;
    /**
     * ⭐ S-C ADD: the per-item press a widening turn offered. NO model call: the exact message the press was minted with
     * names the risk and its refs (`widenAddCallOf`), and the EXISTING door holds ONE card for the existing approve chip.
     */
    let widenAdd: { readonly actions: readonly OfferedAction[] } | null = null;
    // An Add press is TERMINAL whatever it carries (Codex r1 P1 on #2744): a stale or edited one is refused in words, with
    // no model call — it never falls through to ordinary generation with every door open.
    if (result === undefined && approvedProposal === undefined && methodTurn === null && widenTurn === null && isWidenAddPressId(pressedChipId)) {
      const rb = await readBackState(readingDispatch, scenarioId);
      const call = widenAddCallOf(pressedChipId, message, rb);
      const issued = call === null ? undefined : await dispatchTool(call.tool, JSON.stringify(call.args),
        call.relies_on === undefined ? toolCtx : { ...toolCtx, widen_relies_on: { option_id: call.relies_on.option_id } }, capabilities, mode);
      const held = issued?.ok === true && typeof issued.proposal_id === 'string';
      // A held card is NEVER worded as a refusal: the door's own reply, else what is held (served sc-plus-1 defect).
      const text = held ? composeProposalReply(call!.tool, call!.args, issued, message) ?? riskHeldReply(call!) : RISK_ADD_REFUSED_REPLY;
      fastPath = 'method';
      widenAdd = { actions: held ? [] : [RISKS_PRESS] };
      result = {
        assistant_text: text, items: [],
        tool_calls: call === null || issued === undefined ? [] : [{ name: call.tool, ok: held, mutated: false,
          ...(held ? { proposal_id: issued.proposal_id as string } : {}), ...(typeof issued.refusal === 'string' ? { refusal: issued.refusal } : {}) }],
        tool_results: issued === undefined ? [] : [issued], mutated: false, hops: 0, stopped_reason: 'answered',
        timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: issued === undefined ? 0 : 1, hops: 0 },
      };
      log.info({ scenario_id: scenarioId, widen_add: call?.tool ?? 'refused_stale_or_edited', held, refusal: issued?.refusal ?? null },
        'agent-lane: widen add press answered without a model call');
    }
    /** SCI-DEEP: terminal, deterministic "Test without this link" press. */
    let structuralChallengeTurn: StructuralChallengeTurn | null = null;
    if (result === undefined && approvedProposal === undefined && methodTurn === null && widenTurn === null
      && typeof pressedChipId === 'string' && pressedChipId.startsWith(STRUCTURAL_CHALLENGE_PRESS_PREFIX)) {
      // A failure here is still an ANSWERED turn: its typed reply is recorded under turn_id, so the claim is kept
      // (releasing it would let a chipless same-turn_id retry win a fresh claim and run the ordinary model turn).
      try {
        const press = parseStructuralChallengePress(pressedChipId);
        const resolution: StructuralChallengePressResolution = { press };
        const rb = press === null ? undefined : await readBackState(readingDispatch, scenarioId);
        let selected: StructuralChallengePressResolution = resolution;
        // Read-back resolution belongs only to legacy grammar. Canonical identities retain every dispatcher outcome.
        if (press !== null && 'legacyCandidates' in press) {
          if (rb?.graph == null) selected = { press, refusal: 'graph_unavailable' };
          else {
            const graph = rb.graph as { edges?: unknown };
            const links = Array.isArray(graph.edges) ? graph.edges.map(readStructuralChallengeEdge) : [];
            const matches = press.legacyCandidates.filter((candidate) => links.some((link) => link !== null
              && link.from_id === candidate.from_id && link.to_id === candidate.to_id));
            selected = matches.length === 1 ? { press, resolvedLink: matches[0] }
              : { press, refusal: matches.length > 1 ? 'ambiguous' : 'not_found' };
          }
        }
        const permissions = claimPermissionsFrom(rb?.analysisState, rb?.analysisReady, { requested: true });
        structuralChallengeTurn = await structuralChallengeTurnFor(pressedChipId, async (link) => {
          const dispatched = await dispatchStructuralChallenge({
            payload: {
              kind: 'message', scenario_id: scenarioId, turn_id: randomUUID(), stage: 'analyse', turn_class: 'decide',
              source: 'chip_click', message,
            },
            requestId: `${String(req.id)}:structural-challenge`, link, origin: 'user_selected',
            turnMayNameLeader: permissions.leader_may_be_named,
            exploratoryWorkAllowed: permissions.permitted_analysis_mode !== null,
          });
          return dispatched;
        }, selected);
      } catch (err) {
        structuralChallengeTurn = structuralChallengeRefusal('failed');
        log.warn({ err: String(err), scenario_id: scenarioId }, 'agent-lane: structural challenge failed without a model call');
      }
      if (structuralChallengeTurn !== null) {
        fastPath = 'method';
        result = { assistant_text: structuralChallengeTurn.reply, items: [], tool_calls: [], tool_results: [], mutated: false,
          hops: 0, stopped_reason: 'answered',
          timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 0, hops: 0 } };
        log.info({ scenario_id: scenarioId, structural_challenge: structuralChallengeTurn.outcome }, 'agent-lane: structural challenge answered without a model call');
      }
    }
    /**
     * ⭐ C6-2: open while the Agent turn runs, closed in the `finally` below — BEFORE this handler returns, so the
     * reading can never write a frame after the turn's terminal frame. See the start point after the state read.
     */
    let briefReadingOpen = false;
    let levelAnswerTool: typeof CURRENT_LEVEL_TOOL | undefined;
    /**
     * ⭐ S-B (§D5): A RECOGNISED PRESS NEVER BECOMES AN ORDINARY AGENT TURN. Every typed path above has had its turn; a press
     * none of them took (a chip with an unexpected `action_type`, a handler that declined) is answered here, typed.
     */
    if (actionPress !== null && result === undefined && fastPath === undefined && actionFactsAtPress !== undefined) {
      actionReply = declinedReply(actionPress, actionFactsAtPress);
      actionReplyChips = actionExitChips(actionReply.exits);
      fastPath = 'method';
      result = { assistant_text: actionReply.text, items: [], tool_calls: [], tool_results: [], mutated: false, hops: 0, stopped_reason: 'answered',
        timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0, provider_calls: 0, tool_calls: 0, hops: 0 } };
      log.warn({ event: 'agent_lane.action_press', scenario_id: scenarioId, action_id: actionPress.action, decision: 'declined', reason: actionReply.reason },
        'agent-lane: an action press no typed path took was answered typed');
    }
    /** RT-1: set only on the path that runs the Agent with the selection; absent ⇒ no `_grounded_selection`. */
    let selectionContext: AgentSelectionContext | null | undefined;
    await readTurnGuidanceHistory();
    const loopStartedAt = Date.now();
    let runPressProviderMs = 0;
    let runPressProviderCalls = 0;
    if (result === undefined && mode === 'full' && recoveredRun !== undefined && runPress) {
      // The operation already ran. Reuse its proven capability result directly; only its existing interpreter calls AI.
      const started = Date.now();
      const recorded = await loopCapabilities.runAnalysis(toolCtx, { reason: message, effects_timing: null });
      const ms = Date.now() - started;
      fastPath = 'run';
      result = { assistant_text: RUN_RESULT_READY_TEXT,
        items: [...(history ?? []), { role: 'user', content: [{ type: 'input_text', text: message }] }],
        tool_calls: [{ name: 'run_analysis', ok: recorded.ok === true, mutated: false }], tool_results: [recorded],
        mutated: false, hops: 1, stopped_reason: 'answered', reply_author: 'host',
        timing: { total_ms: ms, provider_ms: 0, tool_ms: ms, overhead_ms: 0, tool_provider_ms: 0,
          provider_calls: 0, tool_calls: 1, hops: 1 } };
    }
    // A core turn waits for the scenario's earlier core turn BEFORE it reads the model (`acquireCoreTurnSlot`). That turn
    // may have saved, so a turn that waited ends its read epoch: the model read on arrival is never its starting state.
    let releaseCoreSlot: (() => void) | undefined;
    if (result === undefined) try {
      if (mode === 'core') {
        const slot = await acquireCoreTurnSlot(scenarioId);
        releaseCoreSlot = slot.release;
        if (slot.waited) await readCache.around(async () => undefined);
      }
      /**
       * ⭐ THE SERVER READS THE MODEL ONCE AND GIVES IT (slice C1). The same `get_canonical_state` result the Agent
       * would ask for, read in-process before the first model call and minted into a packet only this server can
       * verify; the loop then carries it as input and withholds the read tool (`agent-loop.ts`). A failed read gives
       * no packet: the tool stays offered, exactly as before.
       */
      let canonicalContext: Parameters<typeof runAgentTurn>[0]['canonicalContext'];
      let hostFirstCall: Parameters<typeof runAgentTurn>[0]['hostFirstCall'];
      let linkSentenceTool: string | undefined;
      // RT-1: a failed state read leaves the selection unchecked (`could_not_check`), never silently dropped.
      selectionContext = agentSelectionContext(selectedElements, undefined, guidedPress ?? undefined);
      try {
        const st = await capabilities.getCanonicalState(toolCtx);
        selectionContext = agentSelectionContext(selectedElements, st, guidedPress ?? undefined);
        // Select once from the initial host read; registration later in this turn cannot switch the model.
        budget = conversationBudgetFor(st.ok === true && (st as { empty?: unknown }).empty === true);
        const revision = (st as { graph_revision?: unknown }).graph_revision;
        /**
         * ⭐ C6-1b: AN EMPTY MODEL IS A KNOWN STATE, NOT AN UNKNOWN ONE. The graph read answers an empty scenario with
         * `graph_hash: null` ("nothing to write against"), so the revision reads `''` — and every first brief (25/25
         * served, DL C6) then spent a whole model call (median 1.9 s) fetching the empty model it could have been given.
         * A read that SUCCEEDED and found no graph is bound to a typed empty revision instead. Still no packet for a
         * failed read, or for a POPULATED graph that came back without a revision: that stays unknown, and the tool
         * stays offered.
         */
        const packetRevision = st.ok === true && typeof revision === 'string'
          ? (revision !== '' ? revision : (st as { empty?: unknown }).empty === true ? EMPTY_MODEL_REVISION : undefined)
          : undefined;
        if (packetRevision !== undefined) {
          const secret = contextBindingSecret();
          const subject = { scenario_id: scenarioId, authenticated_user_id: userId ?? '', graph_revision: packetRevision };
          // The existing epoch cache supplies the same raw inputs as the post-reply wire, without another read.
          const read = await readBackState(readingDispatch, scenarioId);
          const intervention = await interventionForModel(read, guidanceRequestOf(fastPath, explanationId, METHOD_PRESS_IDS));
          canonicalContext = {
            packet: issueContextPacket({ ...subject, captured_at_turn: 0, state: { ...st, ...intervention } }, secret),
            expectation: { ...subject, current_turn: 0, binding_secret: secret },
          };
        }
        /**
         * ⭐ C6-2 — "READING YOUR DECISION" (X5; AIQ ruling #70 5858767026). The model is KNOWN empty (the same read
         * the packet above binds), so this turn is a first brief: a 75–110 s wait on served CEE. In parallel with the
         * Agent, ONE fast call copies the user's own goal and options out of THEIR message (never the Agent's
         * restatement); each span must be an exact substring of it or it is dropped (`gateBriefReading`).
         *   · Streamed turns only: a buffered turn has no stage emitter, so nothing starts and its body is untouched.
         *   · Never awaited for the frame: a failure is simply no frame. Only T1 (a)'s routing waits for it, capped (below).
         *   · Emitted only while the Agent turn is open AND before GRAPH_READY: the model supersedes the reading.
         * Display-only: nothing is persisted, and nothing reaches the Agent or the COMPLETE body.
         */
        const emitStage = currentStageEmitter();
        const knownEmpty = st.ok === true && (st as { empty?: unknown }).empty === true;
        /**
         * ⭐ T1 (a) — A FIRST BRIEF GOES STRAIGHT TO THE CONSTRUCTOR (DL 5942371176; served map 5942431674). On a known-empty
         * model, on the conversation's PROVABLY first user message, typed (no chip, no retry), no method press, the first model call only ever
         * decided to call `build_model_from_brief` with the user's words (13.6–14k input tokens, ~4 s). The SAME brief
         * reading the stream shows decides it instead, from typed spans of the user's own message (`gateBriefReading`:
         * exact substrings, never a wording rule) plus its typed `build` judgement (false when the user asks to hold off):
         * `build` and a goal or at least one option → the host makes that call
         * (`hostFirstCall`) with the message verbatim, and one call answers from its result. No reading within
         * `BRIEF_ROUTE_WAIT_MS`, or neither → the Agent decides, exactly as before. A brief spread over earlier messages
         * is never routed, nor one whose earlier words could not be read (Codex pre-review): only the Agent combines them.
         * ⛔ STREAMED TURNS ONLY (DL CR on #2496): routing REUSES the display reading the stream already makes, so it adds no
         * provider call anywhere. A buffered turn starts no reading and is exactly today's path. (This block runs only for
         * the request that WON the turn claim: a losing, refused or replayed request has already returned above.)
         */
        const mayRouteBrief = emitStage !== undefined && knownEmpty && earlierWordsKnown && needsDurableSeed(history) && typedNow !== null && methodTurn === null && widenTurn === null;
        const reading = emitStage !== undefined && knownEmpty ? readBrief(message, callBriefReading) : undefined;
        if (reading !== undefined && emitStage !== undefined) {
          briefReadingOpen = true;
          void reading.then((r) => {
            if (!briefReadingOpen || r === null || graphPreviewEmitted()) return;
            try {
              emitStage({ kind: 'BRIEF_READ', goal: r.goal, options: r.options, limits: r.limits, elapsed_ms: Date.now() - startedAt });
            } catch { /* display work never costs the turn */ }
          });
        }
        if (mayRouteBrief && reading !== undefined) {
          const r = await readingWithin(reading, BRIEF_ROUTE_WAIT_MS);
          if (r !== null && r.build === true && (r.goal !== null || r.options.length > 0)) hostFirstCall = { name: 'build_model_from_brief', args: { brief: message } };
        }
        // Only the LAST row's typed ask may claim this answer; failed reads preserve ordinary routing.
        if (mode === 'full' && typedNow !== null && typeof store.readMostRecentPendingActions === 'function') {
          try {
            levelAnswerTool = currentLevelAnswerFirstCall(st, levelAsk, typedNow,
              hostFirstCall !== undefined || methodTurn !== null || widenTurn !== null || withheldToolsOf(body).includes(CURRENT_LEVEL_TOOL));
          } catch (err) {
            log.warn({ err: String(err), scenario_id: scenarioId }, 'agent-lane: current-level ask unreadable — ordinary routing');
          }
        }
        // AI Harness: a TYPED sentence saying how strong ONE existing link is forces that link's door first (link-sentence-route.ts).
        linkSentenceTool = linkSentenceFirstCall(st, typedNow, hostFirstCall !== undefined || methodTurn !== null || widenTurn !== null || levelAnswerTool !== undefined);
      } catch (err) {
        log.warn({ err: String(err), scenario_id: scenarioId }, 'agent-lane: turn state could not be read — the Agent will read it itself');
      }
      // ⏱ M3 latency (RC T1 map item 5; SCIENCE/DSK #85 5942859063): a method turn is tool-less and checked BEFORE it is
      // sent, so it is an interpret-shaped call — the banked interpret budget (Sol, effort low; `model-budgets.ts`), not
      // the coach's conversation budget (Sol, effort high: 716 reasoning tokens, 25.5 s for ONE served call, R3 j7 @ecce374d).
      if (methodTurn?.kind === 'run' || risksRun !== undefined) budget = interpretBudget();
      const chipPairChecked = guidedPress === null || (selectionContext?.grounded.unresolved === 'none'
        && selectionContext.links?.length === 1 && selectionContext.links[0]!.from === guidedPress.from
        && selectionContext.links[0]!.to === guidedPress.to);
      if (!chipPairChecked) {
        // An unresolved sizing chip is terminal: never let label resolution choose another link.
        fastPath = 'method';
        result = { assistant_text: 'That sizing could not be checked against the current model. Nothing was changed.',
          items: [], tool_calls: [], tool_results: [], mutated: false, hops: 0, stopped_reason: 'answered',
          timing: { total_ms: 0, provider_ms: 0, tool_ms: 0, overhead_ms: 0, tool_provider_ms: 0,
            provider_calls: 0, tool_calls: 0, hops: 0 } };
      } else if (mode === 'core' && (corePress !== undefined || coreOwns || runPress || (methodTurn === null && widenRun === undefined
        && risksRun === undefined && (body['chip'] === undefined || body['chip'] === null)))) {
        // ⭐ PATH-B: an ordinary typed `core` turn runs on the OpenAI Agents SDK (`core/sdk-turn.ts`): its runner, its session
        // memory and its trace, with Olumi's capabilities as the tools. So does the Run press (the canvas's Run after an edit
        // or Undo): its first call spends the press's ONE Run on `run_analysis` and the same run narrates it (gap 4). Other
        // presses and method turns keep their existing paths.
        // The SDK turn's tools are the typed adapters, on the SAME verified typed-words carrier and the same primitives the
        // capabilities above run on (dispatch, proposals, the drafter call, the fenced levels door and both observers).
        const coreCtx = { ...toolCtx, ...(selectionContext != null ? { grounded_selection: selectionContext.grounded,
          ...(selectionContext.links !== undefined ? { grounded_links: selectionContext.links } : {}) } : {}) };
        // THIN CORE: one read gives the brief and, for a core scenario, the living model the turn starts from.
        const coreSaved = await readingDispatch(`/assist/v1/scenarios/${scenarioId}/graph`, {})
          .then((read) => read.status === 200 ? read.json : undefined).catch(() => undefined);
        const livingView = livingViewOf(coreSaved?.graph);
        // A scenario with no model yet, or whose meaning is its living model, changes through the living model only.
        const coreScenario = coreSaved !== undefined && (coreSaved.graph == null || livingView !== undefined);
        const core = await runCoreTurn({
          ctx: coreCtx, message, budget: coreBudget(coreEffortArmOf(mode, req.headers['x-olumi-core-effort'])), replyBudget: coreReplyBudget(), userId,
          tools: (onCall) => pathBTools({ dispatch: capDispatch, proposals,
            proposeLinkStrengths: (c, a) => dispatchTool('propose_link_strengths', JSON.stringify(a), { ...coreCtx, ...c }, capabilities, mode),
            commitOptionLevels: commitOptionLevelsDoor, onModelRegistered: (raw) => emitGraphReady(raw),
            runAnalysis: (args) => restoreRun === undefined ? Promise.resolve({ ok: false, mutated: false, ran: false, refusal: 'run_failed' })
              : loopCapabilities.runAnalysis(toolCtx, args),
            analyseAfterCommit: () => { analysisToCore = true; return analyseCommittedChange(); } }, coreCtx, mode,
            (row, result) => {
              // Only the adapter's own receipt AND successful postimage readback establish a saved change.
              if (result.ok && result.mutated && (result.receipts?.length ?? 0) > 0) verifiedSave = true;
              onCall(row, { ...result });
            }, coreScenario ? 'core' : 'legacy'),
          instructions: instructionsForMode(mode, `${promptArmOf(mode, req.headers['x-olumi-prompt-arm']) === 'B' ? CORE_ALIGNED_INSTRUCTIONS : AGENT_TOOL_INSTRUCTIONS}${eligibleIntervention === undefined ? '' : `\n\n${ELIGIBLE_INTERVENTION_INSTRUCTION}`}`),
          briefText: coreSaved?.brief_text,
          canonicalState: livingView === undefined ? canonicalContext?.packet?.state
            : { ...(canonicalContext?.packet?.state as Record<string, unknown> | undefined), ...livingView },
          // A Run press permits calculation and reading only (`withheldToolsOf`), on this lane's own tool names.
          withheldTools: runPress ? CORE_RUN_PRESS_WITHHELD : withheldToolsOf(body),
          ...(runPress ? { firstTool: 'run_analysis' } : coreCardOnly && corePress !== undefined ? { firstTool: APPLY_CHANGE } : {}),
          ...(corePress !== undefined ? { press: corePress } : {}),
          ...(canonicalContext?.packet?.graph_revision !== undefined ? { traceMeta: { revision: canonicalContext.packet.graph_revision } } : {}),
          // A run paused for the person's approval is saved on the scenario, so the press (any later request) resumes it.
          ...(typeof store.readOpenAiPausedRun === 'function' && typeof store.saveOpenAiPausedRun === 'function'
            && typeof store.takeOpenAiPausedRun === 'function' ? {
            pausedRunStore: {
              read: (sid: string) => store.readOpenAiPausedRun!(sid),
              save: (sid: string, run: OpenAiPausedRun) => store.saveOpenAiPausedRun!(sid, run),
              take: (sid: string, id: string) => store.takeOpenAiPausedRun!(sid, id),
            } } : {}),
          // The scenario's ONE OpenAI Conversation id is saved on the scenario, so a reopen continues it. A store without it
          // stops the turn (CoreStateUnavailableError → 503 below): never a Conversation the next turn could not find.
          ...(typeof store.readOpenAiConversationId === 'function' && typeof store.claimOpenAiConversationId === 'function' ? {
            conversationStore: {
              read: (sid: string) => store.readOpenAiConversationId!(sid),
              claim: (sid: string, id: string) => store.claimOpenAiConversationId!(sid, id),
            } } : {}),
        });
        coreSdk = core.sdk;
        result = core;
      } else {
        result = await runAgentTurn(
          {
            ctx: runPress ? toolCtx : { ...toolCtx,
              // A qualified confirmation retains the user's ORIGINAL figure quote after a restart; never Olumi's restatement.
              ...(levelAnswerTool !== undefined && levelAsk?.action.figure_quote !== undefined
                ? { user_text: userWordsOf([...histories.typedWords(sessionId), levelAsk.action.figure_quote], typedNow) } : {}),
              ...(selectionContext != null ? { grounded_selection: selectionContext.grounded,
              ...(selectionContext.links !== undefined ? { grounded_links: selectionContext.links } : {}) } : {}) },
            history,
            // The same epoch-cached graph read; an unavailable brief stays unknown on the degraded path.
            briefText: await readingDispatch(`/assist/v1/scenarios/${scenarioId}/graph`, {})
              .then(read => read.status === 200 ? read.json.brief_text : undefined).catch(() => undefined),
            message,
            instructions: instructionsForMode(mode, methodTurn?.kind === 'run' ? `${AGENT_INSTRUCTIONS}\n\n${methodTurn.directive}\n\n${premortemProducerDirective(methodTurn, methodGraph)}`
              : widenRun !== undefined ? `${AGENT_INSTRUCTIONS}\n\n${widenRun.directive}`
              : risksRun !== undefined ? `${AGENT_INSTRUCTIONS}\n\n${risksRun.directive}`
              : eligibleIntervention === undefined ? AGENT_TOOL_INSTRUCTIONS : `${AGENT_TOOL_INSTRUCTIONS}\n\n${ELIGIBLE_INTERVENTION_INSTRUCTION}`),
            maxOutputTokens: budget.max_output_tokens,
            mode,
            // T3: a method turn is structurally ONE model call with NO tool (DL 5939415083 (2)): every tool withheld, one hop.
            withheldTools: methodTurn?.kind === 'run' || risksRun !== undefined ? toolsFor(mode).map((t) => t.name)
              // Widen: ONE call, and its ONLY tool is the add-option door (forced below), so the turn ends in one card or none.
              : widenRun !== undefined ? toolsFor(mode).map((t) => t.name).filter((n) => n !== WIDEN_TOOL) : withheldToolsOf(body),
            ...(methodTurn?.kind === 'run' || widenRun !== undefined || risksRun !== undefined ? { maxHops: 1 } : {}),
            // Before the widen and chip forcings below, which win if both were ever set.
            ...(runPress ? { firstCallTool: 'run_analysis', stopAfterSuccessfulRun: () => {
              fastPath = 'run';
              return RUN_RESULT_READY_TEXT;
            } } : {}),
            ...(linkSentenceTool !== undefined ? { firstCallTool: linkSentenceTool } : {}),
            ...(levelAnswerTool !== undefined ? { firstCallTool: levelAnswerTool } : {}),
            ...(widenRun !== undefined ? { firstCallTool: WIDEN_TOOL } : {}),
            ...(canonicalContext !== undefined ? { canonicalContext } : {}),
            ...(hostFirstCall !== undefined ? { hostFirstCall } : {}),
            ...(selectionContext !== null && selectionContext !== undefined ? { selectionNote: selectionContext.note } : {}),
            // PJ-C1 latency: a lone proposal is answered from its own result, with no narrating call (proposal-reply.ts).
            // PATH-B `core`: no host-composed reply; the AI narrates every tool result itself (one more call).
            ...(mode === 'core' ? {} : { composeReply: (tool: string, args: unknown, toolResult: ToolResult) => {
              const firstResult = tool === 'build_model_from_brief'
                ? firstAnalysisResultReply(args, toolResult, firstAnalysis?.outcome.ran === true) : null;
              if (firstResult !== null) { firstAnalysisResultFirst = true; return firstResult; }
              return composeProposalReply(tool, args, toolResult, message);
            } }),
            // The "Suggest starting assumptions" press: its first call IS the proposal (`SUGGEST_STARTING_ASSUMPTIONS_CHIP`).
            ...((body['chip'] as { id?: unknown } | null | undefined)?.id === SUGGEST_STARTING_ASSUMPTIONS_CHIP.id
              ? { firstCallTool: STARTING_ASSUMPTIONS_TOOL } : {}),
          },
          // Widen: RC's structured checks run INSIDE the door, before it stores anything; a refusal stores nothing.
          widenRun === undefined ? loopCapabilities : {
            ...capabilities,
            proposeNewOption: async (gateCtx, gateArgs) => {
              // ONE card or none: only the press's FIRST door call is gated and may reach the door (HARNESS P2 on #2512;
              // the loop's ONE_CHANGE_PER_APPROVAL refuses a second proposal too, and this holds without it).
              if (widenGateResult !== undefined) {
                return { ok: false, mutated: false, refusal: WIDEN_GATE_REFUSAL,
                  detail: 'Only one set of suggestions per press (WD-COUNT). Nothing was changed.' };
              }
              widenGateResult = widenGate(widenRun, gateArgs);
              // ⛔ SERVER-OWNED ORIGIN (DL P1 on #2512): a Widen press carries no user-written figure, so every level it
              // proposes is Olumi's ESTIMATE. The session's earlier words ("Price was £45") must never make it "yours".
              return widenGateResult.ok
                ? widenNotAdded(await capabilities.proposeNewOption({ ...gateCtx, user_text: '' }, widenPassingArgs(widenGateResult, gateArgs)), widenGateResult, gateArgs)
                : { ok: false, mutated: false, refusal: WIDEN_GATE_REFUSAL,
                    detail: `These suggestions did not pass Olumi’s checks (${widenGateResult.failed.join(', ')}). Nothing was changed.` };
            },
          },
          !runPress ? callModelFor(budget) : async (request) => {
            const started = Date.now();
            runPressProviderCalls += 1;
            try { return await callModelFor(budget)(request); }
            finally { runPressProviderMs += Date.now() - started; }
          },
        );
      }
    } catch (err) {
      log.error({ err: String(err), scenario_id: scenarioId }, 'agent-lane turn failed');
      // A completed Run survives a failed explanation. Keep its identity and commit the ordinary
      // result-first reply, so resending this press replays it instead of leaving an unknown outcome.
      if (runPress && runPressResult !== undefined
        && !(err instanceof ModelReadFailedError) && !isRevisionConflict(err)) {
        const ms = Date.now() - loopStartedAt;
        result = { assistant_text: '', items: [],
          tool_calls: [{ name: 'run_analysis', ok: runPressResult.ok === true, mutated: false }],
          tool_results: [runPressResult], mutated: false, hops: 1, stopped_reason: 'incomplete',
          timing: { total_ms: ms, provider_ms: runPressProviderMs, tool_ms: runPressToolMs,
            overhead_ms: Math.max(0, ms - runPressProviderMs - runPressToolMs), tool_provider_ms: 0,
            provider_calls: runPressProviderCalls, tool_calls: 1, hops: 1 } };
      } else {
        // No possible writes remain: release the claim, so a retry of the SAME
        // turn_id can run. Earlier writes or unknown outcomes keep the claim.
        const released = await releaseUnwrittenTurnClaim();
        // A possible save keeps its claim. Record the failed continuation as an ordinary answer so a resend
        // reads current state immediately; the persistence floor carries the latest held cards, including concurrent offers.
        if (mode === 'core' && !released && writesDispatched > 0 && claimAppendSucceeded && turnId !== undefined) {
          try {
            await appendCheckedGraphWrite({
              store, writesGraph: false, source: 'agent_turn',
              heldProposals: { isHeld: isHeldProposal, seenByThisRequest: new Set<string>() },
              write: {
                scenario_id: scenarioId, turn_id: turnId, turn_class: 'direct_answer', handler_id: null,
                request_hash: requestHash, response_emitted: false,
                llm_calls_used: providerCallsMade() ?? 0, duration_ms: Date.now() - startedAt, handler_facts: [],
                userMessage: message,
                assistantMessage: verifiedSave ? 'The saved change is kept, but the reply didn’t arrive. Send a new message to continue.'
                  : 'The reply didn’t arrive. Any changes already saved are kept. Send a new message to continue.',
              },
            });
          } catch (recordErr) {
            log.warn({ err: String(recordErr), scenario_id: scenarioId, turn_id: turnId }, 'agent-lane: failed continuation answer could not be recorded');
          }
        }
        if (err instanceof ModelReadFailedError) {
          const refusal = { error: toErrorV1(err, req) };
          return reply.code(503).send(refusal.error);
        }
        if (isRevisionConflict(err)) {
          const refusal = { error: {
            ...toErrorV1(err, req),
            ...(turnId !== undefined ? { retry_safe: released } : {}),
          } };
          return reply.code(409).send(refusal.error);
        }
        // PATH-B: a `core` turn whose Conversation id cannot be kept on the scenario stops before any model call and says so.
        if (err instanceof CoreStateUnavailableError) {
          return reply.code(503).send({ error: err.code, detail: err.reason, _agent: { mode },
            _provider_calls: recordedProviderCalls(), ...(turnId !== undefined ? { retry_safe: released } : {}) });
        }
        // A dispatched write is a possible effect, never positive readback proof; provider retryability is separate.
        return reply.code(502).send({
          ...(mode === 'core' ? {
            ...providerFailureOf(err), nothing_saved: writesDispatched === 0,
            save_outcome: verifiedSave ? 'VERIFIED_SAVED' : writesDispatched === 0 ? 'VERIFIED_NO_WRITE' : 'UNKNOWN',
          } : { error: 'UPSTREAM_ERROR' }),
          detail: String(err).slice(0, 300),
          _provider_calls: recordedProviderCalls(),
          ...(providerLedgerTruncated() ? { _provider_calls_truncated: true } : {}),
          ...(turnId !== undefined ? { retry_safe: released } : {}),
        });
      }
    } finally {
      briefReadingOpen = false;
      releaseCoreSlot?.();
    }

    /**
     * ⭐ THE AUTOMATIC RUN AFTER A COMMITTED CHANGE (`analyseCommittedChange`, above). A change this turn COMMITTED (a tool
     * result `ok && mutated`: an approval, an edit) gets it here unless the committing tool already asked for it (`core`).
     * Its blocks and coaching ride this same response through `lastRun`, bound to the final read below like any Run. Never
     * on a draft or a held proposal (nothing committed), a refusal, or a failed or unconfirmed save (`ok` false); never
     * twice (a Run press, the Agent's own Run or the first analysis already ran). The construction keeps its own first
     * analysis. A Run that fails says so (`interpretationUnavailableText`; on `core` the AI, from its tool's outcome) and borrows no older result:
     * the final read binds only a Run current for its graph.
     */
    let autoRun: Awaited<ReturnType<typeof capabilities.runAnalysis>> | undefined;
    const committedChange = result.tool_calls.some((c, i) => c.name !== 'build_model_from_brief'
      && result!.tool_results[i]?.ok === true && result!.tool_results[i]?.mutated === true);
    if (committedChange) interruptIfArmed(recoveryFault, 'after_write');
    const analysedThisTurn = runPress || result.tool_results.some((r) => r?.ran === true)
      || result.tool_calls.some((c) => c.name === 'run_analysis' && c.refusal !== 'run_not_requested')
      || firstAnalysis?.outcome.ran === true || firstAnalysis?.outcome.reason === 'already_ran_for_construction';
    if (committedChange && (analysisToCore || !analysedThisTurn)) {
      autoRun = (await analyseCommittedChange()).run;
      // ⭐ THE AUTOMATIC RUN IS THIS TURN'S RUN (principle review C.md, after #3038): recorded as the Agent's own Run is, so
      // every reader of "this turn ran an analysis" (the chance lines, what it rests on, break-even, the bound card, the
      // Run's outcome chips) reads it. A Run that did not complete is not recorded: its own sentence below says so, and the Run chip stays.
      if (autoRun?.ran === true) {
        result = { ...result, tool_calls: [...result.tool_calls, { name: 'run_analysis', ok: autoRun.ok === true, mutated: false, ran: true }],
          tool_results: [...result.tool_results, autoRun] };
      }
    }
    const runPressFailed = runPress && runPressResult?.refusal === 'run_failed';
    // Preserve the existing typed engine refusal/failure on a Run press, even if the model invents another cause.
    if (runPress && mode !== 'core' && !result.tool_results.some(r => r.ran === true)) {
      const outcome = result.tool_results.map(r => (r as { run_outcome?: RunOutcome }).run_outcome)
        .find((value): value is RunOutcome => value !== undefined);
      if (outcome !== undefined) { runOutcomeText = outcome.text; runOutcomeSaid = true; runOutcomeKind = outcome.kind; }
      else if (runPressFailed) { runOutcomeText = interpretationUnavailableText(runPressResult!); runOutcomeSaid = true; }
    }
    // A hop limit is never returned as an empty answer.
    const runPressSkipped = runPress && !runPressConsumed;
    let text = runPressSkipped ? 'The analysis did not run. Press Run to try again.' : runOutcomeText ?? (result.stopped_reason === 'incomplete'
      ? unfinishedAnswerText(result)
      : result.stopped_reason === 'hop_limit' && result.assistant_text.length === 0
        ? hopLimitText(result)
        : result.assistant_text);
    // The automatic Run that did not complete says so, in the existing words for a turn that changed the model: the change
    // itself stays saved (`RUN_FAILED_TEXT`'s "Nothing in your model changed" would be false here).
    if (autoRun !== undefined && autoRun.ran !== true) {
      text = `${text}\n\n${interpretationUnavailableText({ ran: false, ...(autoRun.refusal !== 'run_failed' ? { refusal: autoRun.refusal } : {}),
        what_is_missing: (autoRun as { what_is_missing?: unknown }).what_is_missing }, true)}`;
    }
    /**
     * ⭐ THE AUTOMATIC RUN IS INTERPRETED IN ITS OWN TURN (DL, after #3038): it ran after the Agent answered, so the Agent
     * never read it. ONE interpreting call, the Explain press's own (`interpretSelectedRun`): the coaching on the NEW result,
     * and what changed since the preceding Run (the selected delta, #3036's comparison). Only when the canonical read selects
     * THIS Run (its identity); with no interpretation, the Explain press's own fallback words.
     */
    // On `core` the SDK run that wrote the reply had this Run in its own tool result: no second, interpreting call.
    const autoRunIdentity = autoRun?.ran === true && !analysisToCore ? (autoRun as { run_identity?: unknown }).run_identity : undefined;
    // ⭐ THE SAME FOR A RUN PRESS AFTER A CHANGE (DL 14 Oct, joined-flow witness): the canvas's own automatic Run after an
    // edit or Undo (DGAI #2767) reaches CEE as a Run press, which answered only "Your results are ready", so its coaching
    // never came. Each eligible completed selected Run gets this same one call, including the first Run.
    // A preceding Run is required only for comparison. This interprets the existing Run; it never starts another one.
    const pressedRunIdentity = fastPath === 'run' && runPressResult?.ran === true
      ? (runPressResult as { run_identity?: unknown }).run_identity : undefined;
    const interpretRunIdentity = autoRunIdentity ?? pressedRunIdentity;
    // A Run with no identity to bind is never interpreted, and costs no read.
    if (interpretRunIdentity !== undefined) {
      const autoRead = await readBackState(readingDispatch, scenarioId);
      const readRun = { scenario_id: scenarioId,
        graph_hash_at_run: (autoRead.analysisResult as { computed_against_hash?: unknown } | undefined)?.computed_against_hash,
        computed_at: (autoRead.analysisState as { run_state?: { computed_at?: unknown } } | undefined)?.run_state?.computed_at };
      // The read selects another Run: nothing more is read or called for this one.
      const selected = compareAnalysisRunFactIdentity(interpretRunIdentity, readRun).status === 'match';
      // The same kept read (no write since), carrying the producer's selected-Run delta, as on the Explain press.
      const selectedRead = selected ? await readingDispatch(`/assist/v1/scenarios/${scenarioId}/graph`, {}) : undefined;
      const currentRead = selectedRead?.status === 200
        ? selectedRead.json.current_read as { run_delta?: unknown } | undefined : undefined;
      const pressedForInterpretation = autoRunIdentity === undefined && selected;
      const interpretedRun = !selected ? undefined
        : await interpretSelectedRun(autoRead, currentRead?.run_delta, result.items, true,
          selectedRead?.status === 200 ? selectedRead.json.brief_text : undefined, interpretRunIdentity);
      if (interpretedRun?.admitted === true) {
        const said = interpretedRun.interpreted?.answer
          ?? interpretedRun.rerunPlan?.fallback ?? interpretationUnavailableText({ ok: true, ran: true });
        // A pressed Run's coaching replaces its ready line ("…or ask me to explain them"), which it now answers.
        // As on the Explain press, the AI's words are the narrator's. ⛔ The Run's narration stays request 1's own status
        // (pending/unavailable): DGAI takes the latest Run's key only from those, and drops the WHOLE message of a "ready"
        // narration whose key is not the latest (narrationTurn.ts `namesALatestRun`/`isForeignExplanation`), so "ready"
        // here hid this Run's reply.
        if (pressedForInterpretation) {
          // Admission is not delivered coaching: an empty/failed interpretation keeps the existing
          // uninterpreted-Run fallback, including its factual qualification and one-copy composition.
          runInterpreted = interpretedRun.interpreted !== undefined; text = said;
        }
        else text = [text, said].filter((x) => x.trim() !== '').join('\n\n');
        // The automatic post-save interpretation is AI narration too; its receipt stays in text.
        if (interpretedRun.words !== null) narratorWords = interpretedRun.words;
        result = { ...result,
          // The next turn sees the interpretation: an id-less assistant message, which needs no reasoning item.
          items: [...result.items, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: said }] }],
          timing: { ...result.timing, provider_ms: result.timing.provider_ms + interpretedRun.providerMs,
            provider_calls: result.timing.provider_calls + 1 } };
      }
    }
    // The AIE conflict copy is a source-owned limitation, not a narration to paraphrase.
    const hiringConflicts = result.tool_results.filter(r => r.refusal === 'hiring_bound_conflict' && typeof r.detail === 'string');
    if (hiringConflicts.length > 0) text = hiringConflicts.map(r => r.detail).join(' ');
    // BYPASS1: a host-composed exit of the loop (`reply_author: 'host'`) is not the narrator's words.
    if (fastPath === undefined && result.stopped_reason === 'answered' && result.reply_author === 'ai') narratorWords = result.assistant_text;

    // ⭐ T3: the method turn's draft is checked BEFORE it is sent; a failed check sends RC's deterministic fallback
    // (never a repair, never a second call). Then ONE card on the story's target, through the existing door, exactly as
    // the identity card is issued below: `approvalChipsFor` offers its approve chip.
    if (methodTurn?.kind === 'run') {
      const production = readPremortemProduction(text);
      text = production.reply;
      premortemCandidates = production.candidates;
      const settled = settleMethodTurn(methodTurn, result.stopped_reason === 'answered' ? text : '');
      premortemPassed = settled.passed;
      premortemReply = settled.reply;
      text = settled.reply;
      // Nothing the call produced survives: its record is rebuilt ONCE at its explicit boundary from the final wire text
      // (below), and an earlier turn is never touched (CODEX_CLI_OVERFLOW P1 #3).
      result = { ...result, assistant_text: text, items: [], tool_calls: [], tool_results: [] };
      const card = cardCallFor(settled.target, methodGraph);
      const issued = card === null ? undefined : await dispatchTool(card.tool, JSON.stringify(card.args), toolCtx, capabilities, mode);
      if (card !== null && issued !== undefined) {
        result = {
          ...result,
          tool_calls: [...result.tool_calls, { name: card.tool, ok: issued.ok === true, mutated: false,
            ...(typeof issued.proposal_id === 'string' ? { proposal_id: issued.proposal_id } : {}) }],
          tool_results: [...result.tool_results, issued],
        };
      }
      log.info({
        scenario_id: scenarioId, dsk_protocol_id: methodTurn.context.dsk?.protocol_id ?? null,
        dsk_not_cited: methodTurn.context.not_cited, plan_basis: methodTurn.context.plan?.basis ?? null,
        passed: settled.passed, failed: settled.failed, target_kind: settled.target.kind,
        card: card?.tool ?? null, card_ok: issued?.ok === true, card_refusal: issued?.refusal,
      }, 'agent-lane: method turn settled');
    }
    // Widen: the door's ONE passed card and its own reply, else RC's deterministic fallback (a refused call stored nothing).
    let widenActions: readonly OfferedAction[] = [];
    // S-C risks: the server writes the reply from the gate's typed items; nothing the call produced is sent or stored.
    if (risksRun !== undefined) {
      const settled = settleRisksTurn(risksRun, result.stopped_reason === 'answered' ? text : '');
      text = settled.reply;
      widenActions = settled.actions;
      result = { ...result, assistant_text: text, items: [], tool_calls: [], tool_results: [] };
      log.info({
        scenario_id: scenarioId, widen_target: 'risks', offered: settled.offered, gap: risksRun.gap?.kind ?? null,
        gate_dropped: settled.gate.dropped,
      }, 'agent-lane: widen turn settled');
    }
    if (widenRun !== undefined) {
      const settled = settleWidenTurn(widenRun, { assistant_text: result.stopped_reason === 'answered' ? text : '', tool_calls: result.tool_calls, tool_results: result.tool_results });
      text = settled.reply;
      widenActions = settled.actions;
      // The record is rebuilt ONCE from the final wire text (below); the call's own items never survive.
      result = { ...result, assistant_text: text, items: [] };
      log.info({
        scenario_id: scenarioId, widen_variant: widenRun.variant, carded: settled.carded,
        gate_failed: widenGateResult !== undefined && !widenGateResult.ok ? widenGateResult.failed : [],
        gate_options: widenGateResult?.per_option ?? [],
        tool_calls: result.tool_calls.map((c) => `${c.name}:${c.ok ? 'ok' : (c.refusal ?? 'refused')}`),
      }, 'agent-lane: widen turn settled');
    }

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
     * ⭐ A FIRST ANALYSIS THAT DID NOT RUN IS NEVER A SILENT SKIP (Paul). A host-written reply says this one
     * deterministic sentence naming what is missing, or that the turn ran out of time; the control beside it (next
     * step, or Run) is added to the chips below. PR 4: an AI-written reply does not restate it — the AI holds the
     * build result's `first_analysis` (its reason and next step) and is told to explain it (`owedHeldByAi`).
     */
    const firstAnalysisSaid = firstAnalysis !== undefined ? firstAnalysisSentence(firstAnalysis.outcome) : null;
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
    const runCheckStarted = Date.now();
    const runStillCurrent = fastPath === 'explain'
      ? await runExplanationCurrentness(store, scenarioId, userId, explanationId, { graph: explanationRead?.graph, briefText: explanationBriefText }) : undefined;
    if (runStillCurrent !== undefined) dispatchLedger.push({ path: 'store:run-currentness', ms: Date.now() - runCheckStarted, status: runStillCurrent ? 200 : 409 });
    /** A successful bound narration check reuses its read; recomputed methods must see other writers after the wait. */
    const finalRead = runStillCurrent === true && explanationRead !== undefined ? explanationRead
      : await readBackState(fastPath === 'explain' || whatChangesRead !== undefined || structuralChallengeTurn !== null || decisionReviewRequested || premortemInitialRead !== undefined
        ? (path, payload) => readingDispatch(path, { ...payload as Record<string, unknown>, fresh: true }) : readingDispatch, scenarioId);
    const freshScopeIssues = [...new Map(result.tool_results.flatMap(r => { const p = parsePendingAction(r.pending_action); return p?.scenario_id === scenarioId && p.action.kind === 'reconcile_goal_scope' ? [[p.chip_id, p] as const] : []; })).values()];
    const { graphHash, analysisReady, draftGraph, graph: readbackGraph, constraintVerdictState, leaderLimitRisks, notModelled, limitVerdicts, identityEvaluated, goalCertainty, optionParticipation, runOptionSet } = finalRead;
    let liveHolds: readonly PendingAction[] = [];
    let heldLapseLines: string[] = [];
    let heldRecords: ProposalRecord[] = [];
    /** What the persistence floor reconciled into the answer row: the held actions `heldRecords` was rebuilt from. */
    let reconciledPending: readonly PendingAction[] = [];
    /** Every held proposal this turn read (at its start and at its end): the floor never re-adds one it settled itself. */
    const heldSeenThisTurn = new Set<string>(heldAtStart.map((h) => h.chip_id));
    let liveScopeIssues: readonly PendingAction[] = [];
    if (typeof store.readMostRecentPendingActions === 'function') {
      try {
        const priorPendings = await store.readMostRecentPendingActions(scenarioId, { validation: 'strict' });
        for (const p of priorPendings) if (isHeldProposal(p)) heldSeenThisTurn.add(p.chip_id);
        /*
         * ⭐ S-D: A HELD PROPOSAL IS HELD UNTIL IT IS APPROVED OR DECLINED (lane EDIT-PANEL; Paul 7 Oct; D-08). Supersedes
         * Canonical #70 5841421182 condition 2 ("the turn count runs down once per answer row"): that rule counted ROWS,
         * so one turn with an inner hold row spent two of the hold's turns, and its lapse was never said. Every hold this
         * turn found or left is reconciled ONCE here (`lifecycle.ts`): approved or declined → gone; already in the model →
         * gone; same model → carried with a fresh lifetime; moved model → re-refereed and re-pinned, or lapsed; a lapse
         * is SAID below, never silent. A hold the Agent withdrew this turn is declined (`WITHDRAW_PROPOSAL`).
         */
        // Declined this turn: the Agent's withdraws, the typed decline, and a hold a door minted that was not the change
        // asked for (`withdrawn_hold`, never shown).
        const withdrawn = new Set([...withdrawnThisTurn(result.tool_calls), ...result.tool_results
          .map((r) => (r as { withdrawn_hold?: unknown } | undefined)?.withdrawn_hold).filter((x): x is string => typeof x === 'string')]);
        const approvedHolds = new Set(result.tool_calls.filter((c) => c.name === 'authorise_change' && (c.ok || c.mutated)
          && typeof c.proposal_id === 'string').map((c) => c.proposal_id as string));
        liveScopeIssues = computeSurvivingPriorPendingsDetailed(priorPendings.filter(p => p.action.kind === 'reconcile_goal_scope'), freshScopeIssues, [], graphHash, Date.now()).survivors;
        const reconciled = reconcileHeldProposals({ atStart: heldAtStart, latest: priorPendings, approved: approvedHolds,
          isApplied: (id) => proposals.isApplied(id),
          declined: withdrawn, graph: readbackGraph, graphHash, scenarioId, requestId: String(req.id), nowMs: Date.now(),
          // A card whose own subject is unchanged survives a model move, by the rule its press reads (hiring witness 35a66525).
          stillApplies: (hold) => { const p = agentProposalOf(hold); return p !== undefined && heldCardStillApplies(p, readbackGraph); },
          subjectMoved: (hold) => { const p = agentProposalOf(hold); return p !== undefined && heldCardSubjectMoved(p, readbackGraph); } });
        liveHolds = reconciled.carried;
        for (const l of reconciled.lapsed) if (agentProposalOf(l.hold) !== undefined) proposals.discard(heldProposalId(l.hold));
        // A stale press of a card under review is answered with its review line again (nothing was applied).
        const pressedForReview = staleReviewPress === undefined || reconciled.review.some((h) => heldProposalId(h) === staleReviewPress) ? []
          : reconciled.carried.filter((h) => heldProposalId(h) === staleReviewPress && heldCardUnderReview(h));
        heldLapseLines = [...takeOwedHeldLapses(scenarioId), ...reconciled.lapsed.map((l) => heldLapseSentence(heldChangeName(l.hold), l.reason)),
          ...[...reconciled.review, ...pressedForReview].map((h) => heldReviewSentence(heldChangeName(h)))];
        // An earlier turn's held proposal the Agent set aside on the user's typed decline is SAID (the press says its own).
        if (declinedHold === undefined) {
          const setAside = heldAtStart.filter((h) => withdrawn.has(heldProposalId(h)));
          heldLapseLines = [...setAside.map((h) => heldDeclineSentence(heldChangeLabel(h))), ...heldLapseLines];
        }
        heldRecords = liveHolds.flatMap((h) => { const r = proposalRecord(h, readbackGraph); return r === undefined ? [] : [r]; });
      } catch (err) {
        log.warn({ scenario_id: scenarioId, err: String(err) }, 'agent-lane: refusing to erase unresolved scope or approval on a failed pending read');
        throw err;
      }
    }
    const scopeWithdrawals = new Set(result.tool_results.filter(r => r.withdrawn === true).map(r => r.proposal_id));
    const retainedScopeIssues = [...freshScopeIssues, ...liveScopeIssues].flatMap(p => { const refreshed = refreshScopePending(p, readbackGraph); return refreshed && !scopeWithdrawals.has(p.chip_id) ? [refreshed] : []; });
    const composedRead = await withRetainedScopeIssues(finalRead, scenarioId, retainedScopeIssues, String(req.id));
    const { analysisState, analysisResult } = composedRead;
    const chanceCells = replyChanceCells(composedRead, scenarioId);
    const resultFirstRunCompleted = firstAnalysisResultFirst || (runPress && result.tool_results.some((r) => r.ran === true));
    // One final scoped draft supplies the words, the offered presses and the hook on this bound Run.
    const guidedDraftForRun = ((resultFirstRunCompleted && runExplanationChip(scenarioId, { graphHash, analysisState, analysisResult }) !== null)
      || (fastPath === 'explain' && narrationStatus === 'ready'))
      ? guidedSizingForRun(analysisResult, readbackGraph) : undefined;
    const sizingCommit = result.tool_results.find(r => r.guided_sizing_commit === true);
    const sizingProgress = sizingCommit !== undefined ? guidedSizingProgress(readbackGraph, analysisResult ?? sizingCommit.guided_sizing_run_result) : undefined;
    const guidedReplyText = guidedSizingReplyText(guidedDraftForRun, sizingProgress);
    const finalGoalChance = (resultFirstRunCompleted || (fastPath === 'explain' && narrationStatus === 'ready'))
      && runExplanationChip(scenarioId, { graphHash, analysisState, analysisResult }) !== null
      ? goalChanceWithheldForAgent(analysisResult, readbackGraph, guidedDraftForRun, guidedReplyText.guided) : undefined;
    const goalChanceResults = finalGoalChance === undefined ? result.tool_results : [{ goal_chance: finalGoalChance }];
    // ONE set of leader-gate inputs from this turn's final read: the search controls offered below, the reply's words
    // about them and the final egress all read this same object, so they cannot disagree.
    const leaderGate = leaderGateInputsOf({ analysisState, analysisReady, graph: readbackGraph, scopeAuthorityUnavailable: composedRead.scopeAuthorityUnavailable });
    /** Produced after the leader gate, whose actual typed reason decides duplicate ownership. */
    let goalChanceOwed: string | null = null;
    const owed = stateFacts.current_state_unknown === true
      ? [...valueChangeDisclosures(stateFacts)]
      : [
        ...disclosuresFor(result.tool_results, text),
        ...valueChangeDisclosures(stateFacts),
        ...(firstAnalysisSaid !== null ? [firstAnalysisSaid] : []),
        // The typed identity ask owns the unconfirmed reading; no second goal-chance explanation is produced.
        ...[identityAskLineOwed(result.tool_results, text)].filter((x): x is string => x !== null),
      ];
    // BYPASS1: the owed lines the AI holds as typed facts (rescaled/ranges/resized values, `identity_ask_say`), and (PR 4)
    // the first analysis that did not run, when this turn's build result handed the AI its `first_analysis`.
    const firstAnalysisHeldByAi = firstAnalysisSaid !== null
      && result.tool_results.some((r) => (r as { first_analysis?: unknown } | undefined)?.first_analysis !== undefined);
    const owedHeldByAi = new Set([...valueChangeDisclosures(stateFacts),
      ...[identityAskLineOwed(result.tool_results, text)].filter((x): x is string => x !== null),
      ...(firstAnalysisHeldByAi ? [firstAnalysisSaid] : [])]);
    // ⭐ NEVER RE-ASK (DL 0df0e1, 6 Oct; G1b d4): an owed line's closing question already among the Agent's recent answers is
    // not asked again; its reason is still said (the D1 target ask's rule, PANEL 5944136475, for every owed line).
    askEachOnce(owed, await repliesToCheckAsks(owed, historyReader, scenarioId, undefined));
    // The search control for each query the Agent offered THIS turn (each query once).
    const researchOffered = [...new Map(result.tool_results.flatMap((r) => {
      const chip = researchChipFor(String((r as { offered_query?: unknown } | undefined)?.offered_query ?? ''));
      return chip === null ? [] : [[chip.id, chip] as const];
    })).values()];
    if (whatChangesRead !== undefined) {
      const answer = whatWouldChangeAnswer(scenarioId,
        await withRetainedScopeIssues(whatChangesRead, scenarioId, retainedScopeIssues, String(req.id)), measuredCandidate,
        undefined, composedRead);
      text = answer.text;
      result = { ...result, assistant_text: text };
      tippingTurn = answer.tippingTurn;
      whatChangesTurn = answer.measured?.turn ?? null;
      measuredRunKey = answer.measured?.runKey ?? null;
      if (answer.measured !== null && turnId !== undefined) rememberMeasuredWhatChanges(`${scenarioId}:${turnId}`, answer.measured);
    }
    if (decisionReviewRequested) {
      decisionReviewTurn = decisionReviewFor(scenarioId, { ...composedRead,
        factorEnrichments: await persistedFactorReviewFor(scenarioId, composedRead, String(req.id), true), recentReplies: await repliesToCheckAsks(
        [goalChanceWithheldForAgent(composedRead.analysisResult, composedRead.graph)?.say], historyReader, scenarioId, undefined) });
      text = decisionReviewTurn.reply;
      result = { ...result, assistant_text: text };
    }
    /** The final pending read may narrow dispatch's licence: presentation uses this graph and retained scope afresh. */
    if (structuralChallengeTurn !== null) {
      const receipt = await readStructuralChallengeReceipt({ scenarioId, graph: readbackGraph ?? null, requestId: String(req.id),
        goalScopeClaimInput: goalScopeClaimInput(retainedScopeIssues.filter(p => p.scenario_id === scenarioId), readbackGraph) });
      structuralChallengeTurn = structuralChallengeTurnUnderLicence(structuralChallengeTurn, receipt);
      if (turnId !== undefined) rememberStructuralChallenge(`${scenarioId}:${turnId}`, structuralChallengeTurn);
      text = structuralChallengeTurn.reply;
      result = { ...result, assistant_text: text };
    }
    // Every bound coaching answer, a "no threshold" one included, is about ITS Run: re-checked on the fresh read (Codex P1 #2542).
    if ((tippingTurn?.kind === 'found' || tippingTurn?.kind === 'no_signal') && !runExplanationMatches(tippingTurn.run_key, scenarioId, composedRead)) {
      text = RUN_EXPLANATION_UNAVAILABLE_TEXT;
    }
    // The measured answer waited on ISL (up to the 70 s cap): the same re-check, so an edit meanwhile is never answered.
    if (measuredRunKey !== null && !runExplanationMatches(measuredRunKey, scenarioId, composedRead)) {
      text = RUN_EXPLANATION_UNAVAILABLE_TEXT;
    }
    if (resultFirstRunCompleted
      && runExplanationChip(scenarioId, { graphHash, analysisState, analysisResult }) === null) {
      text = RUN_RESULT_UNVERIFIED_TEXT;
    }
    if (fastPath === 'explain' && (runStillCurrent === false || !runExplanationMatches(explanationId, scenarioId, { graphHash, analysisState, analysisResult }))) {
      result = { ...result, assistant_text: RUN_EXPLANATION_UNAVAILABLE_TEXT,
        items: [...(history ?? []), { role: 'user', content: [{ type: 'input_text', text: RUN_EXPLANATION_MESSAGE }] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: RUN_EXPLANATION_UNAVAILABLE_TEXT }] }] };
      fastPathView = null;
      text = RUN_EXPLANATION_UNAVAILABLE_TEXT;
      narrationStatus = 'stale';
    }
    /**
     * ⭐ BYPASS1 (DL, 14 Oct; recovery/codex/BYPASS1.md): the reply is the AI's own words: a model wrote it (`narratorWords`, set
     * only where one did) and no host swap above replaced it. Only then does the host stop restating, in prose, facts the AI
     * holds as typed facts: the readiness sentence (`readiness_after`), the D1
     * target/objective/deadline ask, the value changes and the identity ask, the first analysis that did not run
     * (`first_analysis`, PR 4), and (on an ordinary turn) the withheld goal-chance line; the code stays, dormant. A
     * host-written reply keeps every host line. Server truth stays on both: receipts and refusals, what a proposal left
     * out, the post-write ask (a root treated as zero), open questions, the methods note, the gate's
     * reason for a sentence it cut, the science Why? line, the link ask (never said beside another ask), and the chance and
     * draft faces on every Run/Explain/Draft reply. Every authority check (ranking redaction, the count guard, the final
     * leader egress, the estimate-% binding, the completion-claim stripper, currentness) runs on both.
     */
    const aiWroteReply = narratorWords !== null && hiringConflicts.length === 0
      && text !== RUN_RESULT_UNVERIFIED_TEXT && text !== RUN_EXPLANATION_UNAVAILABLE_TEXT;

    // ⛔ This turn's approval results go with it ONLY on the approve chip's fast path: it puts no authorise_change in
    // the history (only its words and Olumi's status), so they are the only record of which proposal it applied
    // (PJ-C1). On every other turn an approval is already in `items` at its TRUE position; passing it again would
    // place it after everything and could stub a same-id proposal made later in the turn (adversarial review F2).
    // ⭐ The confirm card is issued here when this turn's Run says one is waiting and the Agent proposed none
    // (`identityCardToIssue`): the SAME tool, once; it writes nothing, and `approvalChipsFor` offers its button.
    // …and RE-OFFERED on a turn that asks for the reading but proposed nothing (R3 5910559613: a typed "Run the analysis."
    // before confirming got the question and no button, `identityCardToReoffer`), read off the STORED model.
    let automaticDeadlineLabel: string | undefined;
    const deadlineIssuer = mode === 'full' && retainedScopeIssues.length === 0 ? await capabilities.deadlineCardFromDraft(toolCtx, {
      start: deadlineTurnStart, typedNow, toolCalls: result.tool_calls, mutated: result.mutated, fastPath,
      proposalOffered: proposalsAwaitingApproval(result.tool_calls).size > 0, pending: liveHolds,
    }) : undefined;
    if (deadlineIssuer !== undefined) {
      const issued = await dispatchTool('propose_goal_deadline', JSON.stringify({ deadline_words: deadlineIssuer.words, rationale: '' }),
        toolCtx, { ...capabilities, proposeGoalDeadline: deadlineIssuer.issue }, mode);
      if (issued.ok === true && typeof issued.public_label === 'string') automaticDeadlineLabel = issued.public_label;
      result = { ...result,
        tool_calls: [...result.tool_calls, { name: 'propose_goal_deadline', ok: issued.ok === true, mutated: false,
          ...(typeof issued.proposal_id === 'string' ? { proposal_id: issued.proposal_id } : {}) }],
        tool_results: [...result.tool_results, issued] };
    }
    const identityOfferRead = readbackGraph == null ? undefined
      : await readingDispatch(`/assist/v1/scenarios/${scenarioId}/graph`, {}).catch(() => undefined);
    const identityOfferBrief = typeof identityOfferRead?.json.brief_text === 'string' ? identityOfferRead.json.brief_text : null;
    let ceilingAnswerSettled = false;
    // Only the new ceiling branch needs this historical check; preserve the legacy re-offer's predicate. It runs only
    // on a turn that could issue the card (nothing held or proposed, not the approve press), bounded in time, and
    // fails closed: a slow or unreadable history never authorises another question (buddy r3 P2 3).
    if (readbackGraph != null && liveHolds.length === 0 && fastPath !== 'approve'
      && proposalsAwaitingApproval(result.tool_calls).size === 0
      && !identityCardOfferable(readbackGraph)
      && identityCardOfferable(readbackGraph, undefined, undefined, identityOfferBrief)) {
      const history = async (): Promise<boolean> => {
        const rows = await store.readRecent(scenarioId, CONVERSATION_ROWS_READ);
        for (let i = 0; i < rows.length; i++) {
          const committed = await store.readCommittedTurn?.(scenarioId, rows[i]!.turn_id);
          for (const held of committed?.pending_actions ?? []) {
            const parsed = parsePendingAction(held), proposal = parsed === null ? undefined : agentProposalOf(parsed);
            const reading = proposal === undefined ? undefined : identityReadingOf(proposal);
            if (proposal?.scenario_id !== scenarioId || proposal.user_id !== userId || reading?.ceiling_stock === undefined
              || !identityCardOfferable(readbackGraph, undefined, reading, identityOfferBrief)) continue;
            const declineSuffix = withChipOperation('', chipOperationOf({ chip: { id: declineChipIdFor(proposal.proposal_id) } }));
            if (rows.slice(0, i).some(row => row.request_hash.endsWith(declineSuffix))) return true;
          }
        }
        return false;
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        ceilingAnswerSettled = await Promise.race([history(),
          new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), 2_000); })]);
      } catch { ceilingAnswerSettled = true; } finally { if (timer !== undefined) clearTimeout(timer); }
    }
    const reoffer = identityCardToReoffer({
      toolCalls: result.tool_calls, mutated: result.mutated, fastPath,
      proposalOffered: proposalsAwaitingApproval(result.tool_calls).size > 0,
      readingWaiting: !ceilingAnswerSettled && readbackGraph != null && identityCardOfferable(readbackGraph, undefined, undefined, identityOfferBrief),
    });
    let automaticIdentityProposalId: string | undefined;
    const partFigures = identityPartFiguresToIssue({ graph: readbackGraph, userText: typedNow,
      toolCalls: result.tool_calls, mutated: result.mutated,
      proposalOffered: proposalsAwaitingApproval(result.tool_calls).size > 0, pending: liveHolds });
    // PATH-B `core`: the route issues no card of its own (here, the confirm card and the statement card below); the AI proposes.
    if (mode !== 'core' && (partFigures !== undefined || identityAutoIssueAllowed({ issue: !ceilingAnswerSettled && identityCardToIssue(result.tool_calls, result.tool_results), reoffer, heldWaiting: liveHolds.length > 0 }))) {
      const issued = await dispatchTool('propose_identity', JSON.stringify(partFigures ?? {}), toolCtx, capabilities, mode);
      if (issued.ok === true && typeof issued.proposal_id === 'string') automaticIdentityProposalId = issued.proposal_id;
      result = {
        ...result,
        tool_calls: [...result.tool_calls, { name: 'propose_identity', ok: issued.ok === true, mutated: false,
          ...(typeof issued.proposal_id === 'string' ? { proposal_id: issued.proposal_id } : {}) }],
        tool_results: [...result.tool_results, issued],
      };
      log.info({ scenario_id: scenarioId, ok: issued.ok === true, refusal: issued.refusal, reoffer, part_figures: partFigures !== undefined }, partFigures !== undefined
        ? 'agent-lane: identity card issued by the route from this typed answer’s part figures'
        : reoffer
        ? 'agent-lane: identity card re-offered by the route (the reading is unconfirmed, nothing else was proposed)'
        : 'agent-lane: identity card issued by the route after the Run');
    }
    // ⭐ S2 CONFIRM, ONE PRESS (DL 20:09Z 14 Oct; served 2a35ff31 pricing turn 02): when this turn's Run asked to confirm a
    // figure the user wrote ("Is your £49 … today's ‘Pro plan price’?") and nothing was proposed, the route issues #3113's
    // confirm card itself, quoting the brief's one sentence that states it: the SAME tool, once, writing nothing.
    const heldAsk = fastPath === 'approve' || mode === 'core' ? undefined : heldFigureAskToConfirm({ toolCalls: result.tool_calls, toolResults: result.tool_results,
      mutated: result.mutated, proposalOffered: proposalsAwaitingApproval(result.tool_calls).size > 0, heldWaiting: liveHolds.length > 0 });
    const heldConfirm = heldAsk === undefined || readbackGraph == null ? undefined : heldFigureConfirmArgs(readbackGraph, identityOfferBrief, heldAsk);
    if (heldConfirm !== undefined) {
      const issued = await dispatchTool('propose_assumptions', JSON.stringify(heldConfirm), toolCtx, capabilities, mode);
      result = { ...result,
        tool_calls: [...result.tool_calls, { name: 'propose_assumptions', ok: issued.ok === true, mutated: false,
          ...(typeof issued.proposal_id === 'string' ? { proposal_id: issued.proposal_id } : {}) }],
        tool_results: [...result.tool_results, issued] };
      log.info({ scenario_id: scenarioId, ok: issued.ok === true, refusal: issued.refusal }, 'agent-lane: confirm card for the user\'s own figure issued by the route after the Run');
    }
    /**
     * ⭐ SYSTEM 1: THE ONE ROUTE ISSUER (the harness contract: its card's button is "Record what you said", quoting the turn).
     * When the Agent offered nothing, a statement THIS turn's typed words give (a risk's chance, bound and verified), else the
     * brief's own sentence the model holds for a risk (`already_true_quote`), gets its door card: the SAME tool, once, writing
     * nothing; the door re-verifies it and only the press records it.
     */
    const doorArgs = fastPath === 'approve' || mode === 'core' || readbackGraph == null ? undefined : doorIssueArgs(readbackGraph, typedNow,
      { ...(selectionContext?.grounded !== undefined ? { selection: selectionContext.grounded } : {}),
        ...(precedingAsk === undefined ? {} : { preceding_ask: precedingAsk }) },
      { toolCalls: result.tool_calls, mutated: result.mutated, proposalOffered: proposalsAwaitingApproval(result.tool_calls).size > 0,
        heldWaiting: liveHolds.length > 0 });
    if (doorArgs !== undefined) {
      const issued = await dispatchTool('propose_statement', JSON.stringify({ subject: doorArgs.subject,
        statements: doorArgs.quotes.map((q) => (typeof q === 'string' ? { quote: q } : q)) }), toolCtx, capabilities, mode);
      result = { ...result,
        tool_calls: [...result.tool_calls, { name: 'propose_statement', ok: issued.ok === true, mutated: false,
          ...(typeof issued.proposal_id === 'string' ? { proposal_id: issued.proposal_id } : {}) }],
        tool_results: [...result.tool_results, issued] };
      log.info({ scenario_id: scenarioId, ok: issued.ok === true, refusal: issued.refusal, field: doorArgs.subject.field },
        'agent-lane: statement door card issued by the route');
    }
    const results = result.tool_results;
    const chipApprovals = fastPath === 'approve'
      ? result.tool_calls.flatMap((c, k) => (c.name === 'authorise_change' && k < results.length ? [results[k]] : []))
      : [];
    const fa = firstAnalysis?.outcome;
    // An analysis of THIS revision exists because this turn's construction ran it (or already had).
    const firstAnalysisExists = fa !== undefined && (fa.ran || fa.reason === 'already_ran_for_construction');
    // Offered only after a change, only when that change was not already analysed this turn
    // (by the Agent's run, or by the first analysis), and only when the canonical readiness in
    // THIS response admits a run. A first analysis stopped only by the turn's time was admitted on
    // this same revision, so the same readiness offers Run beside Olumi's sentence.
    const offerRun = (runPress && !runPressConsumed) || runPressFailed || (result.mutated && autoRun?.ran !== true
      // A Run the server refused because this request's approval applied a change analysed nothing:
      // it must not suppress the Run the refusal tells the user to press.
      && !result.tool_calls.some((c) => c.name === 'run_analysis' && c.refusal !== 'run_not_requested')
      && !firstAnalysisExists
      && admitsRunOffer(analysisReady));

    // A typed Run that answered but did not complete (blocked) offers the next step instead.
    const runBlocked = runPress && result.tool_calls.some((call, i) => call.name === 'run_analysis'
      && result.tool_results[i]?.ok === true && result.tool_results[i]?.ran !== true);
    // The turn's LAST build was refused as too large and nothing was saved: offer the rebuild the reply names.
    const lastBuild = result.tool_calls.filter((c) => c.name === 'build_model_from_brief').at(-1);
    const offerRebuild = lastBuild?.refusal === 'model_too_large' && !result.mutated;
    // A Run changes no graph: the ONE proposal still awaiting a yes keeps its chip if the store would still
    // execute it on this revision (never on a guess — two outstanding, or a moved model, carry nothing).
    // ⛔ On a FRESH worker the process-local `lastApproveOffer` is empty (Codex #1823 5819308426: "if Run lands
    // on a fresh worker, the process-local carry can be absent"), so the chip also comes from the carrier the
    // rehydration above restored from the latest answer row — the exact words the offer used.
    // ⛔ A link's stated effect the Agent tried to approve from the user's words is recorded only from its card
    // (`approve_on_the_card`, PR Review's fifth CR on #2275): the reply points to that card, so the card is offered again.
    const toTheCard = result.tool_results.flatMap((r) => {
      const x = r as { reason?: unknown; proposal_id?: unknown } | undefined;
      return x?.reason === 'approve_on_the_card' && typeof x.proposal_id === 'string' ? [x.proposal_id] : [];
    });
    const carriedApproval = ((): OfferedAction[] => {
      // Not when this turn prepared a proposal of its own: that one's card is the offer.
      const preparedNow = result.tool_calls.some((c) => c.name !== 'authorise_change' && c.ok && typeof c.proposal_id === 'string');
      if (!runPress && fastPath !== 'explain' && (toTheCard.length === 0 || preparedNow)) return [];
      const id = executableWaitingProposal(scenarioId, userId, graphHash, readbackGraph);
      if (id === undefined || (!runPress && fastPath !== 'explain' && !toTheCard.includes(id))) return [];
      // A card kept for review is never carried as approvable (PR-2), even when the store would execute it again.
      if (reviewIdsAtStart.has(id) || liveHolds.some((h) => heldProposalId(h) === id && heldCardUnderReview(h))) return [];
      const chip = [lastApproveOffer.get(approveKey), carriedProposals.get(approveKey)?.chip]
        .find((c) => c !== undefined && typedApprovalOf({ chip: { id: c.id } }) === id);
      return chip !== undefined ? [chip, AMEND_CHIP] : [];
    })();
    const approvalCalls = callsThatCanConsumeProposals(result.tool_calls);
    // The chip's words come from the STORED proposal it approves and its proposer's own result, never the Agent's prose.
    const approvals = approvalChipsFor(
      approvalCalls,
      (id) => ({ proposal: proposals.get(id), result: result.tool_results.find((r) => r.proposal_id === id) }),
    );
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
    /**
     * ⛔ THE AGENT'S OWN RUN OFFERS ITS OUTCOME'S CHIPS TOO (DL #2233 follow-up 2). Only the Run button's path offered
     * them, so an identity ask the Agent reached by calling `run_analysis` itself lost its "Check the figures".
     */
    if (fastPath !== 'run') {
      const loopOutcomes = result.tool_results
        .map((r) => (r as { run_outcome?: RunOutcome } | undefined)?.run_outcome)
        .filter((o): o is RunOutcome => o !== undefined);
      if (loopOutcomes.length > 0) {
        runOutcomeChips = [...new Map(loopOutcomes.flatMap((o) => o.chips).map((c) => [c.id, { ...c }] as const)).values()];
        runOutcomeKind = loopOutcomes[loopOutcomes.length - 1]!.kind;
      }
    }
    // ⭐ "Suggest starting assumptions" (P-CORE 5911687135; DL item 5): on the state read back THIS turn, never while an
    // approval is waiting (that card is the next step) and never on an unchecked verdict.
    const startingAssumptions = approvals.length === 0 && carriedApproval.length === 0
      ? startingAssumptionsChips(readbackGraph, analysisReady) : [];
    /**
     * ⭐ PATH-B `core` (DL-3 22:5xZ; Paul: out of the box, the AI is the ONE voice; both judges' criterion 5 on 548f886f): beside the
     * AI's reply only the cards of a change waiting for a yes (approve, change, not now, review), the AI's own research offers,
     * the protocol controls that make the engine or the AI act (Run, Explain, rebuild), receipts and blocks. No host-composed
     * next step, guidance card, sizing chip, gap signal, Run-outcome chip, action bar or host-issued proposal:
     * a host card asked "Give your estimate" on the link the AI's reply had just said could not hold it. Every other lane: unchanged.
     */
    const hostCards = mode !== 'core';
    const runCompletedThisTurn = resultFirstRunCompleted
      || result.tool_calls.some((c, i) => c.name === 'run_analysis' && result.tool_results[i]?.ran === true);
    const steadyCard = !hostCards ? null : steadyHorizonCard({ graph: readbackGraph, graphHash, scenarioId, userId, brief: identityOfferBrief,
      runReply: runCompletedThisTurn,
      runResult: analysisResult,
      approvalHeld: approvals.length + carriedApproval.length + liveHolds.length + proposals.outstanding(scenarioId, userId).length > 0 });
    if (steadyCard !== null) proposals.put(steadyCard.proposal);
    // ⛔ One button per id: a card issued THIS turn and the same card carried from the last (its id is its content) were
    // both offered, so the Run button's reply showed "Yes, calculate it that way" and "Change something first" TWICE
    // (R3 5910885689, served e9fba88; the UI does not de-duplicate).
    const offeredSpecific: OfferedAction[] = fastPath === 'method' && actionReply !== null
      // S-B, terminal: a typed "can't yet" offers its working exits (or the waiting card it re-offers), nothing else.
      ? firstOfEachId(actionReplyChips)
      : fastPath === 'method' && tippingTurn !== null
      ? [TALK_IT_THROUGH_CHIP]
      : fastPath === 'method' && methodTurn !== null
      // T3, terminal: the method's ONE card (its approval) and the method's own follow-ups (RC method_turn_rule), nothing else.
      ? firstOfEachId([...approvals, ...(methodTurn.kind === 'run' ? [TALK_IT_THROUGH_CHIP] : methodTurn.actions)])
      // Widen, terminal: the door's ONE card (its approval) and RC's follow-up, or the unavailable reply's own follow-up.
      : fastPath === 'method' && widenTurn !== null
      ? firstOfEachId([...approvals, ...(widenTurn.kind === 'unavailable' ? (widenTurn as WidenUnavailableTurn).actions : widenActions)])
      // S-C Add, terminal: the door's ONE card (its approval), or the way back when the door refused.
      : fastPath === 'method' && widenAdd !== null
      ? firstOfEachId([...approvals, ...widenAdd.actions])
      // What would change, terminal: the turn's own follow-up only.
      : fastPath === 'method' && whatChangesTurn !== null
      ? firstOfEachId([...approvals, ...whatChangesTurn.actions])
      : fastPath === 'method' && structuralChallengeTurn !== null
      ? firstOfEachId([...approvals, ...structuralChallengeTurn.actions])
      // Review this decision, terminal: each item's existing press, nothing else.
      : fastPath === 'method' && decisionReviewTurn !== null
      ? firstOfEachId(decisionReviewChips(decisionReviewTurn))
      : firstOfEachId([
      ...approvals,
      ...carriedApproval,
      ...(steadyCard === null ? [] : [steadyCard.chip]),
      ...(offerRun ? [RUN_OFFER_CHIP] : []),
      // A Run the engine answered without a result offers ITS outcome's chips, never "what it still needs" (not a model gap).
      ...(hostCards ? runOutcomeChips : []),
      ...(resultFirstRunCompleted
        ? (() => { const chip = runExplanationChip(scenarioId, { graphHash, analysisState, analysisResult }); return chip === null ? [] : [chip]; })() : []),
      // The explanation failed on a Run that is still current: the SAME bound control is offered again (the fallback;
      // CODEX_CLI_OVERFLOW P2 on #2470). A stale Run offers none.
      ...(fastPath === 'explain' && narrationStatus === 'unavailable' && runExplanationMatches(explanationId, scenarioId, { graphHash, analysisState, analysisResult })
        ? (() => { const chip = runExplanationChip(scenarioId, { graphHash, analysisState, analysisResult }); return chip === null ? [] : [chip]; })() : []),
      // The run is refused and Olumi can fill the gap: the one specific next step replaces the general one.
      ...(!hostCards ? [] : startingAssumptions.length > 0 ? startingAssumptions
        : ((runBlocked && !runOutcomeSaid) || firstAnalysisBlocked || approvalLeftBlocked) && !onlyUserCanUnblock(analysisReady) ? [NEXT_STEP_AFTER_BLOCKED_RUN_CHIP] : []),
      ...(offerRebuild ? [REBUILD_AFTER_TOO_LARGE_CHIP] : []),
      // The research control for each query the Agent offered THIS turn: the only way a query is ever sent. Only a
      // control the final egress would ship is offered, and so remembered as pressable.
      ...researchOffered.filter((chip) => controlSurvivesLeaderGate(chip, leaderGate)),
    ]);
    // Select once from the same readback, before fixing the pills. Specific controls and waiting cards win.
    const guidanceWaitingIds = executableWaitingProposalIds(scenarioId, userId, graphHash, readbackGraph);
    const guidanceWaiting = guidanceWaitingIds.map((id) => ({ id: approvalChipIdFor(id) }));
    const guidanceRunKey = fastPath === 'explain' && typeof explanationId === 'string'
      ? explanationId.slice(RUN_EXPLANATION_PREFIX.length)
      : runExplanationChip(scenarioId, { graphHash, analysisState, analysisResult })?.id.slice(RUN_EXPLANATION_PREFIX.length);
    const nextStepOffers = nextStepOffersForTurn(NEXT_STEP_CHIPS, {
      request: guidanceRequestOf(fastPath, (body['chip'] as { id?: unknown } | null | undefined)?.id, METHOD_PRESS_IDS),
      offeredSpecific: firstOfEachId([...offeredSpecific, ...guidanceWaiting]),
      assistantText: text,
      ...(preReplySelection === undefined ? {} : { preReplySelection }),
      licence: leaderLicenceFromState(analysisState, analysisReady),
      guidance: guidanceHistory,
      ...(guidanceRunKey !== undefined ? { runKey: guidanceRunKey } : {}),
      state: { graph: readbackGraph, analysisState, analysisResult, optionParticipation, identityEvaluated },
      // S-B typed replies own their exits, including an intentional empty list (Science's estimate questions).
    }, hostCards && !aiWroteReply && actionReply === null && offeredSpecific.length === 0 && !decisionReviewRequested && offersNextSteps(analysisState)
      && executableWaitingProposal(scenarioId, userId, graphHash, readbackGraph) === undefined,
      widenOffered({ graph: readbackGraph, analysisState, analysisReady, analysisResult, optionParticipation, identityEvaluated }), offeredSpecific);
    /**
     * ⭐ S-D CARD CONTINUITY: a held proposal is approvable only by its card, so while one is held and this turn offers no
     * other approval, the oldest one's card (approve, change, not now) is offered again — its own words, exactly what the door checks — BESIDE the
     * turn's own next steps (a proposal held until decided must not take the user's other actions away while it waits).
     * Never on a method's terminal turn, whose controls are the method's own.
     */
    // ⭐ ONE APPROVAL ACTION: EVERY held card is offered with its own buttons (assessment K5 L2: the reply re-offered only the
    // oldest, so the user was told to press a button that was not there). The card pressed, or the one the Agent took the
    // user's words to mean while several waited (its approval refused, never bound), comes first; then oldest first.
    const meantId = approvedProposal ?? result.tool_calls.find((c) => c.name === 'authorise_change' && c.refusal === 'approval_required'
      && heldRecords.some((r) => r.proposal_id === c.proposal_id))?.proposal_id;
    const heldCards = [...heldRecords].sort((a, b) => Number(b.proposal_id === meantId) - Number(a.proposal_id === meantId));
    // ⭐ PR-2: a card kept for review offers "Review this change" (the Agent prepares it again) and "Not now", never approve.
    const underReview = new Set(liveHolds.filter(heldCardUnderReview).map((h) => heldProposalId(h)));
    // With several cards in one row, each button shows the change it applies (its card's own words), so the user can tell them apart.
    const approveWithItsChange = (r: (typeof heldRecords)[number]): OfferedAction => {
      const hold = heldRecords.length > 1 && r.approve_action.detail === undefined ? liveHolds.find((h) => heldProposalId(h) === r.proposal_id) : undefined;
      const change = hold === undefined ? undefined : heldChangeLabel(hold);
      return (change === undefined ? r.approve_action : { ...r.approve_action, detail: change }) as OfferedAction;
    };
    const heldCardOffer: OfferedAction[] = approvals.length === 0 && heldRecords.length > 0
      && fastPath !== 'method' && !decisionReviewRequested
      && (fastPath !== 'approve' || result.tool_calls.some(c => c.name === 'authorise_change' && (c.ok || c.mutated))
        || heldRecords.some(r => r.proposal_id === approvedProposal))
      // Its "Not now" too: words alone never set a held proposal aside (Codex r1 P1), so the press must be on offer.
      ? [...heldCards.filter((r) => !underReview.has(r.proposal_id)).map((r) => approveWithItsChange(r)),
        ...heldCards.filter((r) => underReview.has(r.proposal_id)).map((r) => {
          const hold = liveHolds.find((h) => heldProposalId(h) === r.proposal_id);
          return reviewChipFor(r.proposal_id, hold === undefined ? undefined : heldChangeLabel(hold)) as OfferedAction;
        }),
        ...(heldCards.some((r) => !underReview.has(r.proposal_id)) ? [AMEND_CHIP] : []),
        ...heldCards.map((r) => r.decline_action as OfferedAction)] : [];
    const meantHold = waitingIds.size > 1 && meantId !== undefined ? heldAtStart.find((h) => heldProposalId(h) === meantId) : undefined;
    const approvalWords = waitingIds.size > 1
      ? approvalChoiceWords(waitingIds.size, meantHold === undefined ? undefined : heldChangeLabel(meantHold)) : APPROVAL_REQUIRED_WORDS;
    // A resolved construction card, whatever it confirms. The complete stored window must attest both the first
    // public user answer and its exact-brief construction registration; neither a later card nor unknown history qualifies.
    const constructionConfirmResolved = await (async (): Promise<boolean> => {
      const resolved = heldAtStart.flatMap(h => {
        const record = proposalRecord(h, undefined);
        return record !== undefined && result.tool_calls.some(c => c.ok === true && c.proposal_id === record.proposal_id
          && (c.name === 'authorise_change' || (c.name === WITHDRAW_PROPOSAL && c.proposal_id === declinedHold))) ? [record] : [];
      });
      if (resolved.length === 0) return false;
      try {
        const rows = await store.readRecent(scenarioId, CONVERSATION_ROWS_READ);
        if (rows.length >= CONVERSATION_ROWS_READ) return false;
        const construction = [...rows].reverse().find(r => !r.turn_id.endsWith(':claim')
          && r.response_emitted === true && r.request_hash.startsWith('agent_turn:')
          && typeof r.user_message === 'string' && r.user_message.trim().length > 0);
        if (construction === undefined) return false;
        const constructedAt = Date.parse(construction.created_at);
        const registrationId = constructionRegistrationTurnId(scenarioId, construction.user_message!);
        if (!Number.isFinite(constructedAt) || !rows.some(r => r.response_emitted === false
          && r.turn_id === registrationId && r.request_hash.startsWith('graph_registration:')
          && Date.parse(r.created_at) < constructedAt)) return false;
        const issuers = await proposalIssuers(resolved, heldAtStart);
        return resolved.some(r => issuers.get(r.revision) === construction.turn_id);
      } catch (err) {
        log.warn({ scenario_id: scenarioId, err: String(err) }, 'agent-lane: construction issuing window unreadable');
        return false;
      }
    })();
    const thin = thinDraftOffer(readbackGraph, constructionConfirmResolved
      || result.tool_calls.some(c => c.name === 'build_model_from_brief' && c.mutated === true));
    let thinShownGuidance: GuidanceWire | undefined;
    if (hostCards && thin !== null && heldCardOffer.length === 0 && approvals.length === 0 && carriedApproval.length === 0
      && fastPath !== 'method' && (fastPath !== 'approve' || constructionConfirmResolved)) {
      nextStepOffers.offered.splice(0, nextStepOffers.offered.length, ...firstOfEachId([
        ...nextStepOffers.offered.filter(c => c.id === RUN_OFFER_CHIP.id), thin.press, ...nextStepOffers.offered,
      ]).slice(0, 3));
      // E6: the thin offer IS RC-WIDEN's risks suggestion; record it as shown so the next reply does not say it again.
      thinShownGuidance = thinDraftShownWire(selectTurnGuidance({ request: 'turn', offeredSpecific: [],
        licence: leaderLicenceFromState(analysisState, analysisReady), guidance: guidanceHistory,
        state: { graph: readbackGraph, analysisState, analysisResult, optionParticipation, identityEvaluated } }));
    }
    const offeredNow: OfferedAction[] = firstOfEachId([...heldCardOffer, ...nextStepOffers.offered]);
    // The same selected Run as the words; the warning owns N. Re-check present sizing and never-reask before offering.
    // Reconcile the commit receipt's words to the FINAL stored read, including a concurrent second sizing.
    if (sizingCommit !== undefined) {
      text = text.replace(/\s*\d+ more to go(?:; with 1 left, Olumi can show a range)?\./gu, '').trim();
      if (guidedReplyText.progress !== null) text = `${text} ${guidedReplyText.progress}`;
    }
    const guidedDraft = !hostCards ? undefined : sizingProgress?.draft ?? guidedDraftForRun;
    const guidedActions = guidedSizingActions(guidedDraft, readbackGraph,
      guidedDraft === undefined ? [] : await guidedSizingHistory(historyReader, scenarioId, undefined));
    offeredNow.push(...guidedActions);
    const guidedSizing = bindGuidedSizing(guidedDraft, guidedActions, {
      graph_hash: graphHash ?? '',
      run_key: runExplanationKeyForRecord(scenarioId, analysisState, analysisResult)
        ?? (typeof sizingCommit?.guided_sizing_run_key === 'string' ? sizingCommit.guided_sizing_run_key : ''),
    }, sizingProgress);
    // What this answer row persists: the Run offer, and the exact proposal behind the approve chip it offers
    // — or, on a turn that offers none, the one still outstanding (a question between the offer and the "yes"
    // must not drop what a restart needs to find it).
    const offeredApprove = offeredNow.find((a) => typedApprovalOf({ chip: { id: a.id } }) !== undefined);
    const offeredProposal = offeredApprove !== undefined ? proposals.get(typedApprovalOf({ chip: { id: offeredApprove.id } }) as string) : undefined;
    const emittedAtIso = new Date().toISOString();
    // S-D: preserve a stored carrier's revision. Each proposal has its own pending item.
    const existingApprovalCarrier = offeredProposal !== undefined
      ? liveHolds.find(h => heldProposalId(h) === offeredProposal.proposal_id) : undefined;
    const approvalCarrier = offeredApprove !== undefined && offeredProposal !== undefined
      ? existingApprovalCarrier
        ?? refreshedHold(proposalPendingAction(offeredProposal, offeredApprove, { scenario_id: scenarioId, emitted_at_iso: emittedAtIso }), Date.now()) : undefined;
    if (approvalCarrier !== undefined && !liveHolds.some(h => h.chip_id === approvalCarrier.chip_id)) {
      liveHolds = [...liveHolds, approvalCarrier];
      const r = proposalRecord(approvalCarrier, readbackGraph);
      if (r !== undefined) heldRecords.push(r);
    }
    /**
     * ⛔ A NEWER AGENT OFFER FOR THE SAME THING REPLACES THE OLDER ONE (PR Review @ fe509477, `link-effect-card-route`): an
     * older held Agent proposal whose every target this answer's offer also sets is not held beside it. Its press would
     * write the figure the user has just corrected, and the newer card on screen is that same change, restated. Only
     * OLDER holds are replaced, so re-offering an old card never drops a newer one.
     */
    const offeredAgent = approvalCarrier !== undefined ? agentProposalOf(approvalCarrier) : undefined;
    if (offeredAgent !== undefined && approvalCarrier !== undefined) {
      const targets = new Set(offeredAgent.operations.map((o) => o.path));
      const replaced = liveHolds.filter((h) => {
        const older = agentProposalOf(h);
        return h.chip_id !== approvalCarrier.chip_id && older !== undefined && older.operations.length > 0
          && h.emitted_at_iso < approvalCarrier.emitted_at_iso && older.operations.every((o) => targets.has(o.path));
      });
      for (const h of replaced) proposals.discard(heldProposalId(h));
      // DL 7 Oct: recorded as superseded (log + the saved answer's words), never silently dropped.
      if (replaced.length > 0) {
        log.info({ event: 'agent_lane.held_superseded', scenario_id: scenarioId, superseded: replaced.map((h) => heldProposalId(h)), by: approvalCarrier.chip_id },
          'agent-lane: a newer offer for the same targets replaced older held proposals');
        heldLapseLines = [...heldLapseLines, ...replaced.map((h) => heldLapseSentence(heldChangeName(h), 'superseded'))];
      }
      liveHolds = liveHolds.filter((h) => !replaced.includes(h));
      heldRecords = heldRecords.filter((r) => !replaced.some((h) => heldProposalId(h) === r.proposal_id));
    }
    const offeredRecord = heldRecords.find(r => r.approve_action.id === offeredApprove?.id);
    // ⭐ S-D (DL 7 Oct, Canvas's served capture #2614): the PROPOSING turn offers "Not now" too, so a held proposal can be
    // declined from the first moment, not only from the next reply (the record's own `decline_action`).
    // One decline per card: a door that already offers its own decline for this proposal (#2776's drawn-link "Decline",
    // a withdraw the lifecycle counts as declined) keeps it, and "Not now" is not added beside it.
    if (offeredRecord !== undefined && !offeredNow.some(a => a.id === offeredRecord.decline_action.id
      || (a.id.startsWith('agent-decline-') && a.id.endsWith(`:${offeredRecord.proposal_id}`)))) {
      const amendIndex = offeredNow.findIndex(a => a.id === AMEND_CHIP.id);
      offeredNow.splice(amendIndex >= 0 ? amendIndex + 1 : offeredNow.length, 0, offeredRecord.decline_action as OfferedAction);
    }
    // ⭐ SEVERAL CARDS THIS TURN (a field-scoped limit card beside another, verifier F1 18 Oct): each further card is held on
    // this row as its own card, with its record and its own "Not now", exactly as a carried card is (`heldCardOffer`).
    for (const further of offeredNow.filter((a) => a.id !== offeredApprove?.id && typedApprovalOf({ chip: { id: a.id } }) !== undefined)) {
      const p = proposals.get(typedApprovalOf({ chip: { id: further.id } }) as string);
      if (p === undefined || liveHolds.some((h) => heldProposalId(h) === p.proposal_id)) continue;
      const hold = refreshedHold(proposalPendingAction(p, further, { scenario_id: scenarioId, emitted_at_iso: emittedAtIso }), Date.now());
      liveHolds = [...liveHolds, hold];
      const r = proposalRecord(hold, readbackGraph);
      if (r === undefined) continue;
      heldRecords.push(r);
      const lastDecline = offeredNow.map((x) => x.id.startsWith('agent-decline-proposal:') || x.id === AMEND_CHIP.id).lastIndexOf(true);
      if (!offeredNow.some((x) => x.id === r.decline_action.id)) offeredNow.splice(lastDecline + 1, 0, r.decline_action as OfferedAction);
    }

    /**
     * ⛔ THIS ROW MUST CARRY THE PRODUCT'S HELD ADD-OPTION FORWARD (C52). Pending actions are read from the
     * LATEST answer row only (`supabase-store.ts` readMostRecentPendingActions: `.limit(1)`), and this row is
     * written AFTER route-v2's row that minted the hold — so a row that carries only the Agent's own items drops
     * the hold, and the user's approval then finds nothing to confirm. Read at the END of the turn, after every
     * inner write: a hold this turn confirmed is already consumed and is not carried. Holds go first; the row
     * holds at most PENDING_ACTIONS_PER_TURN_CAP (a DB CHECK). A failed read carries none, loudly.
     */
    /*
     * ⭐ S-D: the row holds at most PENDING_ACTIONS_PER_TURN_CAP (a DB CHECK). Scope issues go first, then the approval
     * this answer offers or carries (the card the user is looking at; Codex r1 P1 on #2743), then the held proposals,
     * oldest first. A held proposal that does not fit is SAID as set aside, never dropped in silence, and its card and
     * fields are withdrawn from this answer with it.
     */
    {
      const holdRoom = Math.max(0, PENDING_ACTIONS_PER_TURN_CAP - retainedScopeIssues.length - (approvalCarrier !== undefined ? 1 : 0));
      const otherHolds = liveHolds.filter(h => h.chip_id !== approvalCarrier?.chip_id);
      if (otherHolds.length > holdRoom) {
        for (const h of otherHolds.slice(holdRoom)) if (agentProposalOf(h) !== undefined) proposals.discard(heldProposalId(h));
        heldLapseLines = [...heldLapseLines, ...otherHolds.slice(holdRoom).map((h) => heldLapseSentence(heldChangeName(h), 'over_cap'))];
        liveHolds = liveHolds.filter(h => h.chip_id === approvalCarrier?.chip_id || otherHolds.slice(0, holdRoom).includes(h));
        heldRecords = heldRecords.filter((r) => liveHolds.some((h) => heldProposalId(h) === r.proposal_id));
        // A re-offered card whose hold did not fit goes with it (its approve and its "Not now").
        const gone = new Set(heldCards.filter((r) => !heldRecords.some((k) => k.proposal_id === r.proposal_id))
          .flatMap((r) => [r.approve_action.id, r.decline_action.id]));
        for (let i = offeredNow.length - 1; i >= 0; i -= 1) if (gone.has(offeredNow[i]!.id)) offeredNow.splice(i, 1);
      }
    }
    // Remembered only once the row's capacity is settled, so a card withdrawn above is never remembered as offered.
    rememberApprove(approveKey, offeredNow);
    // S-B (amendment 6): the card an offered action prepared, with the chips offered beside it, is remembered by its offer,
    // so the same offer pressed again re-offers it (an Agent proposal or a product hold alike). An S-D card re-offered for
    // an EARLIER held proposal is never taken for the card this press prepared.
    if (actionPress?.offer_key != null && actionReply === null) {
      const reoffered = new Set(heldCardOffer.map((c) => c.id));
      const prepared = offeredNow.filter((a) => !reoffered.has(a.id)).map((a) => typedApprovalOf({ chip: { id: a.id } })).find((id): id is string => id !== undefined);
      if (prepared !== undefined) rememberActionOfferProposal(`${scenarioId}:${actionPress.offer_key}`, { proposalId: prepared, chips: offeredNow.map((a) => ({ ...a })) });
    }
    const pendingCandidates = [
      ...retainedScopeIssues,
      ...[...liveHolds].sort((a, b) => a.emitted_at_iso.localeCompare(b.emitted_at_iso)),
      ...(offerRun ? derivePendingActionsFromFinalizedChips([RUN_OFFER_CHIP], { scenario_id: scenarioId, emitted_at_iso: emittedAtIso, ...(graphHash !== undefined ? { graph_hash: graphHash } : {}) }) : []),
    ];
    // The row holds at most PENDING_ACTIONS_PER_TURN_CAP (a DB CHECK): scope issues, the offered approval, the held proposals
    // (sized above so none is cut here), then the Run offer. What still does not fit is logged.
    if (pendingCandidates.length > PENDING_ACTIONS_PER_TURN_CAP) {
      log.warn({ scenario_id: scenarioId, dropped: pendingCandidates.slice(PENDING_ACTIONS_PER_TURN_CAP).map((pa) => pa.action.kind) },
        'agent-lane: pending actions over the per-row cap — the lowest-priority items are not carried');
    }
    const durablePending = pendingCandidates.slice(0, PENDING_ACTIONS_PER_TURN_CAP)
      .map(p => withApprovalOfferedOnRow(p, offeredNow.some(a => a.id === p.chip_id)));

    const lastRunBlocks = Array.isArray(lastRun?.blocks) ? lastRun.blocks : [];
    const runBound = bindRunBlocksToReadback(lastRunBlocks, { graphHash, analysisState, analysisResult, analysisReady });
    // Data blocks stay bound to the current readback. The AI's reply owns the coaching move.
    const runCoaching = runTurnNextMove(lastRun, { scenarioId, graphHash, analysisState, analysisResult, graph: readbackGraph, constraintVerdictState, leaderLimitRisks, limitVerdicts });
    const coachingBound = [...runBound, ...runCoaching.blocks.filter(b => !lastRunBlocks.includes(b))]
      .filter(block => !aiWroteReply || !['coaching', 'exercise'].includes(String((block as { type?: unknown })?.type)));
    // What changed since the last run: the run turn's own block and refusal reason, only beside that same run.
    const runDelta = runDeltaBoundToReadback(lastRun, { scenarioId, graphHash, analysisState, analysisResult });
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
    // ⭐ F3 (DL #70 5851710093): on the build turn, the user's goal is named even when it could not be scored — unless the
    // arithmetic below already states the target. Pure reads of this turn's readback; the same inputs AX1 uses.
    const targetStatedByArithmetic = (analysisState as { leader_claim?: { permitted?: unknown } } | undefined)?.leader_claim?.permitted !== true
      && retainedScopeIssues.length === 0 && breakEvenFor(readbackGraph, identityEvaluated)?.target !== undefined;
    // GOAL-REACH 3b: the arithmetic dedupe is for the legacy copy only; a carried reason (Science §(g)) is always said.
    const goalLine = fa?.ran === true && fastPath !== 'run'
      && (!targetStatedByArithmetic || thresholdReasonLine(readbackGraph, analysisResult) !== null) ? goalNotCheckedLine(readbackGraph, analysisResult) : null;
    // ⭐ EBD (DL, 12 Oct): EACH ASK ONCE PER REPLY. What the reply says before the status line (the Agent's words, then the owed
    // lines: the first analysis's blocked line is readiness's own ask). The build line and the readiness line below never
    // restate a question in it, and the questions toggle list leaves it out. Paul's first reply said the deadline ask three times.
    const saidBeforeStatus = [text, ...owed].join('\n');
    // ⭐ S5t-W (e7 #87 6011176086): an approval's text is the capability's OWN receipt (server-authored, already through
    // `withoutAgentDirections` above), never model prose, so the completion-claim stripper — which exists for the model's
    // words — never runs over it. It dropped "Recorded your figure … as you confirmed: "…" Olumi rescaled ‘…’ so your
    // figure fits." whole (the quote ends `."`, so it was one sentence). The narrator still states what was saved.
    // ⭐ ONE APPROVAL ACTION: an approval the Agent applied from the user's typed words says the same receipt as its button
    // (the capability's own follow-up, through the same Agent-direction boundary as the press path above).
    const withApprovalReceipts = <N extends { status: string | null }>(n: N): N => {
      const receipts = result.tool_calls.flatMap((c, i) => {
        const r = result.tool_results[i];
        return c.name === 'authorise_change' && r?.ok === true && r.mutated === true && typeof r.follow_up === 'string'
          ? [withoutAgentDirections(r.follow_up).text] : [];
      }).filter((x) => x.trim() !== '');
      return receipts.length === 0 ? n : { ...n, status: [n.status, ...receipts].filter((x): x is string => typeof x === 'string' && x !== '').join(' ') };
    };
    const narrated = fastPath === 'run' || fastPath === 'explain' || fastPath === 'research' || fastPath === 'strengthen' || fastPath === 'method'
      ? { text, status: null as string | null, stripped: [] as string[] }
      : fastPath === 'approve'
        ? (editsRefusedThisTurn ? { text, status: null as string | null, stripped: [] as string[] }
          : { ...narrateWriteOutcome('', result.tool_calls, result.tool_results, { versioned: userId !== null }, approvalWords),
              // A specific partial follow-up is already the narrator's authoritative status.
              text: result.tool_results.some(r => r.mutated === true && r.applied === false
                && typeof r.outcome === 'string' && r.follow_up === text) ? '' : text })
        : withApprovalReceipts(narrateWriteOutcome(text, result.tool_calls, result.tool_results, { versioned: userId !== null, alreadySaid: saidBeforeStatus, aiAsks: aiWroteReply }, approvalWords));
    // The goal line leads the server's own lines (it outranks the save line), so it rides the status it precedes.
    const narration = goalLine === null ? narrated : { ...narrated, status: [goalLine, narrated.status].filter((x): x is string => typeof x === 'string' && x !== '').join(' ') };
    // (B) A write landed on this turn → say whether the model can run now, from the readback's one verdict.
    const wroteThisTurn = fastPath !== 'run'
      && result.tool_results.some((r) => (r as { mutated?: unknown; applied?: unknown } | undefined)?.mutated === true || (r as { applied?: unknown } | undefined)?.applied === true);
    // An authorised revision says what it did to the result on screen, from this turn's typed readback (R&C 5842738466).
    const staleLine = wroteThisTurn ? staleResultLine(analysisState, analysisReady, staleOnlyByRangeReading(readbackGraph, analysisResult)) : null;
    // EBD: when the first analysis's blocked line already said the analysis could not run, an all-said readiness line is dropped.
    const firstAnalysisRefusalSaid = fa !== undefined && !fa.ran && (fa.reason === 'not_admissible' || fa.reason === 'refused')
      && firstAnalysisSaid !== null && owed.includes(firstAnalysisSaid);
    const postWriteReadiness = wroteThisTurn ? postWriteReadinessLine(readbackGraph, analysisReady,
      guidedActions.length > 0 ? guidedDraft : undefined, { text: saidBeforeStatus, refusalSaid: firstAnalysisRefusalSaid }) : null;
    const askLine = wroteThisTurn ? postWriteAskLine(readbackGraph, analysisReady) : null;
    // "Run it again" already says a run is permitted; the readiness sentence would repeat it. And on the build turn whose
    // automatic first pass already RAN, "The analysis can run now" sits beside that result with no Run chip (the route
    // offers none over the run that just happened): an instruction nobody can follow (MG sweep #70 5851155478). Only
    // the "can run" sentence goes; a "can't run yet" reason is always said.
    const firstPassRan = fa?.ran === true;
    const readinessLine = (staleLine !== null || firstPassRan) && (analysisReady as { may_run?: unknown } | undefined)?.may_run === true ? null : postWriteReadiness;
    // ⭐ D1 + A7 (DL #75 5923918068; AIQ words 5923963470): on the brief and Run turns, at rest — the deadline the model holds
    // but cannot answer, said as a fact; and, while the goal has no stated target, ONE ask for it (`decision-input-ask.ts`).
    const hostStatusText = [narration.status, notAdoptedLine(result.tool_calls, result.tool_results), staleLine, readinessLine, askLine, ...heldLapseLines].filter((x): x is string => x !== null && x !== '').join(' ') || null;
    // BYPASS1: the AI holds `readiness_after` (an approval) and the build result's `readiness` (a build), so the readiness
    // sentence goes, after a refused first analysis too (PR 4: the AI holds that refusal's `first_analysis` as well). The save
    // or refusal receipt (with any claim the stripper removed), what a proposal left out, goal-not-checked, stale, the post-write
    // ask (gate 2: a root treated as zero is always said) and held lapses stay: server truth "whatever the model said"
    // (write-outcome, starting-point-omission, real-writer, one-reply-build rows).
    const aiStatusText = [narration.status, notAdoptedLine(result.tool_calls, result.tool_results), staleLine,
      ...heldLapseLines].filter((x): x is string => x !== null && x !== '').join(' ') || null;
    // The retained fresh scope question is this turn's existing step, even if the
    // narrator parked it behind the questions toggle. Count it before another ask.
    const freshScopeAsk = freshScopeIssues.find(p => p.action.kind === 'reconcile_goal_scope' && p.action.expected !== 'approval' && retainedScopeIssues.some(held => held.chip_id === p.chip_id));
    const rawScopeQuestion = freshScopeAsk?.action.kind === 'reconcile_goal_scope' ? freshScopeAsk.action.question : null;
    const freshScopeQuestion = rawScopeQuestion === null ? null : withoutProposalIds(rawScopeQuestion);
    // Keep the pending authority verbatim. Normalise exact narrator copies before
    // the whole-reply scrub, so other IDs cannot give this display question a
    // different replacement name and defeat final deduplication.
    const scopedNarrationRaw = rawScopeQuestion === null || freshScopeQuestion === null ? narration.text : narration.text.split(rawScopeQuestion).join(freshScopeQuestion);
    // Decide only at assembly, against the final scope-composed, identity-bound authority used by egress.
    const explainEnrichment = (analysisResult as { enrichment?: Record<string, unknown> } | null | undefined)?.enrichment;
    const explainRobustness = explainEnrichment == null ? null : readRawRobustnessSignals(explainEnrichment.robustness);
    const explainOwned = fastPath === 'explain' && narrationStatus === 'ready' && narratorWords !== null
      && text !== RUN_EXPLANATION_UNAVAILABLE_TEXT && text !== RUN_EXPLANATION_LEGACY_UNAVAILABLE_TEXT
      && text !== interpretationUnavailableText({ ok: true, ran: true }) && text !== explainFallbackText
      && runExplanationMatches(explanationId, scenarioId, { graphHash, analysisState, analysisResult })
      && leaderLicenceFromState(analysisState, composedRead.analysisReady) !== 'withheld';
    if (explainOwned && isRawFragile(explainRobustness)) {
      explainRobustnessCaveat = explainRobustnessSentence(analysisResult, composedRead.graph);
    }
    // The same Run's fact the other way (Codex #3409 r1 P1; DL-3 ruling A): a Run that is neither fragile nor a near tie
    // owes no not-robust caveat, so Olumi's own two fixed sentences are removed if the AI repeated them. Dedupe of
    // Olumi's exact words, never a matcher on the AI's.
    const explainRobustRun = explainOwned && explainRobustness !== null && !isRawFragile(explainRobustness)
      && !explainRobustness.near_tie_is_tie;
    // Whole-text exits keep the caveat after the narrator's at-rest prose, before any folded questions.
    // Display first, while the raw ask is intact. With no IDs the replacement is identical;
    // otherwise the id-free form cannot recreate the raw ask. The caveat cannot contain it,
    // so the scanner-pinned second display call is a no-op after dedupe and placement.
    // ⭐ RT-19 (DL ruling (A), #87 6009566552): a figure for two ends with NO direct link, and no link-effect door this turn →
    // the door's own fixed words, never the Agent's improvised offer (a band for a new link the model would double-count).
    // They stand in for the narration before the display call, so every owed line below composes with them unchanged.
    const awaitingApproval = offeredNow.some((a) => typedApprovalOf({ chip: { id: a.id } }) !== undefined)
      || executableWaitingProposal(scenarioId, userId, graphHash, readbackGraph) !== undefined;
    const noDirectLink = fastPath === undefined ? noDirectLinkFigureReply(readbackGraph, message, {
      tools: result.tool_calls.map((c) => c.name), awaitingApproval, scopeQuestionOwed: rawScopeQuestion !== null }) : null;
    // ⭐ S7 PoC: the AI wrote this reply, so the host adds no Run-turn prose below (`ai-writes-run-turn.ts`); checks still run.
    const aiRunTurn = AI_WRITES_RUN_TURN && aiWroteReply && noDirectLink === null
      && (fastPath === 'run' || fastPath === 'explain' || result.tool_calls.some(c => c.name === 'run_analysis'));
    // Olumi's two fixed variants: the Run's fact selects at most one (Codex #3409 r2: a fragile Run kept both). Every
    // other copy of Olumi's own words goes; the AI's other narration stays.
    const ownedNarration = [NOT_ROBUST_SENTENCE, NOT_ROBUST_NO_FLIP_SENTENCE].map((x) => x.trim())
      .filter((x) => (explainRobustnessCaveat !== null ? x !== explainRobustnessCaveat.trim() : explainRobustRun))
      .reduce((t, x) => withoutSentenceCopies(t, x), scopedNarrationRaw);
    const scopedNarration = noDirectLink ?? (explainRobustnessCaveat === null ? ownedNarration
      : placeExplainCaveat(withDecisionInputAskDisplay(ownedNarration, readbackGraph), explainRobustnessCaveat, aiRunTurn));
    const narrationText = withDecisionInputAskDisplay(scopedNarration, readbackGraph);
    // BYPASS1: host prose stays on a host-written reply, including the no-direct-link figure reply that replaces the AI's.
    const hostProse = !aiWroteReply || noDirectLink !== null;
    const statusText = hostProse ? hostStatusText : aiStatusText;
    let basis = fastPath !== 'method'
      && runExplanationChip(scenarioId, { graphHash, analysisState, analysisResult }) !== null
      && claimPermissionsFrom(analysisState, analysisReady, { requested: fastPath === 'run' }).leader_may_be_named
      ? conditionalInputBasis({ graph: readbackGraph,
        admission: (analysisReady as { analysis_admission?: unknown } | undefined)?.analysis_admission,
        analysedOptionIds: analysedOptionIds(analysisResult) }) : null;
    // ⭐ GATE 2 CONSUMER (DL 0df0e1; Science #2571; Acceptance #87 5987804248): a Run that RAN on a model with an unvalued
    // non-factor root says it was treated as zero and asks for its figure — the post-write ask's own sentence. The replay
    // above says the same, from the same readback, in the same place.
    // ⛔ Only about the result on screen (Codex #2577 P1): when the readback no longer binds to this Run (an edit landed
    // before the readback, a stale or missing result), the readback's roots are not the ones this Run treated as zero.
    const rootLine = runPress && resultFirstRunCompleted
      && runExplanationChip(scenarioId, { graphHash, analysisState, analysisResult }) !== null
      ? treatedAsZeroReplyLine(readbackGraph, analysisReady, analysisResult) : null;
    // GOAL-REACH 3b (DL CHANGES_REQUIRED #2816): an explicit Run says why the goal chance was refused (§(g)), on the same
    // binding as the root line; its replay says the same in the same place.
    const reasonLine = runPress && resultFirstRunCompleted
      && runExplanationChip(scenarioId, { graphHash, analysisState, analysisResult }) !== null
      ? thresholdReasonLine(readbackGraph, analysisResult) : null;
    if (reasonLine !== null && !narrationText.includes(reasonLine)) owed.push(reasonLine);
    if (rootLine !== null && !narrationText.includes(rootLine)) owed.push(rootLine);
    if (basis !== null && !narrationText.includes(basis)) owed.push(basis);
    // BYPASS1: on the AI's reply only the value changes, the identity ask and (PR 4) the first analysis that did not run, which
    // it holds as typed facts, are not restated. Every other owed line (receipts, what was left out, open questions, the
    // methods note, the Run lines) is server truth and stays, and so does every line when the current state is unknown (the
    // no-present-claim rule).
    // An interpreting call cannot issue the figure-confirm tool. Its existing card survives, and the exact
    // confirmation question remains owed if the AI omitted it; the asked-once pass above still owns repeats.
    const identityAskStillOwed = aiRunTurn ? identityAskLineOwed(result.tool_results, narrationText) : null;
    const owedShown = hostProse || stateFacts.current_state_unknown === true ? owed
      : owed.filter((line) => !owedHeldByAi.has(line) || line === identityAskStillOwed);
    const composedWithout = withB3LinesAtRest(withWriteOutcome(withDisclosures(narrationText, owedShown, { missingSentencesOnly: aiRunTurn }), statusText), [basis, freshScopeQuestion]);
    const decisionTurn = {
      // #3167 fix-forward: the risks the Run on screen recorded leaving out, never today's predicate.
      omittedRisks: runOmittedRisks(analysisResult),
      // A steady-state answer must not hide an unrelated missing objective/target ask on this Run.
      // Otherwise exactly the turn's rule: an offered approve chip, or the ONE executable waiting proposal.
      awaitingApproval: offeredNow.some(a => { const id = typedApprovalOf({ chip: { id: a.id } }); return id !== undefined && !isSteadyCardProposal(id); })
        || (() => { const id = executableWaitingProposal(scenarioId, userId, graphHash, readbackGraph); return id !== undefined && !isSteadyCardProposal(id); })(),
      chanceCells,
      // A build that saved, or an analysis that RAN: a blocked or failed Run already names what it needs, so asks nothing more.
      builtOrRan: (fastPath === 'run' && (result.tool_results[0] as { ran?: unknown } | undefined)?.ran === true)
        || result.tool_calls.some((c, i) => (c.name === 'build_model_from_brief' && c.mutated === true)
          || (c.name === 'run_analysis' && (result.tool_results[i] as { ran?: unknown } | undefined)?.ran === true)),
    };
    const decisionCtx = {
      ...decisionTurn,
      restingText: textAtRest(composedWithout),
      questionsToggle: textAtRest(composedWithout) !== composedWithout,
    };
    // ⭐ ASKED ONCE (PANEL 5944136475): an ask already among the Agent's recent answers stays open and is not repeated.
    // BYPASS1: the AI asks for a missing target, objective or deadline itself (R:784); the host keeps K3 and A7's facts.
    const decisionLines = hostProse
      ? await decisionLinesAskedOnce(readbackGraph, decisionCtx, historyReader, scenarioId, undefined)
      : decisionInputLines(readbackGraph, decisionCtx, { onlyRiskKind: 'inert' });
    // ⭐ L1 (DL #75 5925649954 item 5; AIQ words 5925678816): the user asks about ONE link Olumi has not sized → the host asks
    // for its size, at rest, unless this turn already asks (D1 above, the model, the host status) or a card awaits a yes.
    // BYPASS1 keeps it: it is never said when the reply at rest already asks (the AI's own ask included), so it cannot double.
    // ⭐ S6 (Paul ≤¼, 15 Oct): on the AI's reply the AI decides what to ask (from the user's words and canonical_state); the
    // host adds no ask of its own: no link-size ask, no post-write ask, no build questions line or list. Host prose keeps them.
    const linkAsk = !hostProse || decisionLines.some(isDecisionInputAsk) ? null : linkSizeAsk(readbackGraph, {
      message, restingText: textAtRest(composedWithout), awaitingApproval: decisionTurn.awaitingApproval,
    });
    if (linkAsk !== null) decisionLines.push(linkAsk);
    const composed = composeDirectAnswerResponse({
      // ⛔ A proposal id is a binding for authorise_change, never text a user reads or
      // types (display-ids.ts). Applied here, before the answer row is written, so a
      // replay returns exactly what the user first saw.
      // Olumi's own status, plus what any proposal this turn LEFT OUT — both deterministic (#1800).
      // T3, terminal: exactly the checked text — no disclosure, status, ask or write line rides on a method turn.
      assistant_text: fastPath === 'method' ? narration.text
        : withoutProposalIds(withB3LinesAtRest(withWriteOutcome(withDisclosures(narrationText, [...owedShown, ...decisionLines], { missingSentencesOnly: aiRunTurn }), statusText),
          [basis, ...decisionLines.filter((line) => line.endsWith('What should this model help you explore?'))])),
      stage: 'frame',
      answerKind: 'substantive',
      // One click approves the ONE proposal just offered — the same words as typing "yes".
      suggested_actions: offeredNow,
      // The run's coaching, ONLY when bound to this readback, through the same egress sanitiser the
      // conventional exit uses — built INTO the finalised response, never appended raw.
      blocks: (fastPath === 'method' ? [] : coachingBlocks) as OlumiResponse['blocks'],
    });
    const finalised = finaliseV5Response(composed, { scenarioId, runDeltaBoundByCaller: true });

    const existingBlocks = Array.isArray((finalised as { blocks?: unknown[] }).blocks)
      ? (finalised as { blocks: unknown[] }).blocks
      : [];

    /**
     * ⭐ THE RESPONSE AS IT WILL SHIP — assembled BEFORE the answer row is written, so the leader gate
     * below edits the text a replay returns, not only the text this request returns.
     */
    const explanationChip = runExplanationChip(scenarioId, { graphHash, analysisState, analysisResult });
    if (fastPath === 'run' || firstAnalysisResultFirst) narrationStatus = explanationChip !== null
      && resultFirstRunCompleted ? 'pending' : 'unavailable';
    if (runPress && fastPath !== 'run' && resultFirstRunCompleted) narrationStatus = explanationChip !== null
      && result.stopped_reason === 'answered' && result.assistant_text.trim() !== '' ? 'ready' : 'unavailable';
    const narrationKey = fastPath === 'explain' && typeof explanationId === 'string'
      ? explanationId.slice(RUN_EXPLANATION_PREFIX.length) : explanationChip?.id.slice(RUN_EXPLANATION_PREFIX.length);
    // The turn cache sees this turn's writes only. Recheck other writers before licensing the additive UI view.
    const canonicalViewBasisCurrent = (validCanonicalAnalysisView(composedRead.canonicalAnalysisView) || interpretedCardIdentity !== undefined)
      && await canonicalViewBasisUnchanged(store, scenarioId, composedRead);
    const canonicalViewMayShip = validCanonicalAnalysisView(composedRead.canonicalAnalysisView) && canonicalViewBasisCurrent;
    let wireBody = {
      ...finalised,
      ...(narrationStatus !== undefined && narrationKey !== undefined
        ? { narration: { status: narrationStatus, run_key: narrationKey } } : {}),
      // The FINAL readback's bound result block — never the tool run's own blocks. See
      // `analysisResult` in readBackState. The Agent's text still reports what its run
      // found and, if the model has since changed, that it has.
      ...(analysisResult !== undefined && (mode !== 'core' || runCompletedThisTurn || fa?.ran === true) ? { blocks: [analysisResult, ...existingBlocks] } : {}),
      ...(graphHash !== undefined ? { graph_hash: graphHash } : {}),
      // Readiness of the graph this response returns — the final readback's only.
      ...(mode !== 'core' && analysisReady !== undefined ? { analysis_ready: analysisReady } : {}),
      // The scenario-bound verdict from the FINAL readback governs; otherwise the
      // finaliser's own honest no-context verdict stays (present, never deleted).
      ...(analysisState !== undefined ? { analysis_state: analysisState } : {}),
      // UI-only sidecar from this SAME composed read; never put it in history, Run deltas or model context.
      ...(canonicalViewMayShip
        ? { canonical_analysis_view: composedRead.canonicalAnalysisView } : {}),
      ...(draftGraph !== undefined ? { draft_graph: draftGraph } : {}),
    } as OlumiResponse & Record<string, unknown>;
    // What changed since the last run — the run turn's own block, or why it has none — only beside that same run.
    if (fastPath !== 'method') wireBody = withRunDelta(wireBody, runDelta);
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
    /** The paragraph the leader gate appended: typed finding/disclosure identity for the reply composer. */
    let leaderGateClosing: string | null = null;
    if (analysisBearing) {
      const claim = (analysisState as { leader_claim?: { permitted?: unknown; separation?: unknown; withheld_reason?: unknown } } | undefined)?.leader_claim;
      const enforced = enforceAgentLaneLeaderClaimsAtWire(wireBody, {
        requestId: String(req.id),
        exitPath: 'agent_lane_v1',
        userText: typedNow ?? undefined,
        mayNameLeadingOption: claim?.permitted === true,
        separationEstablished: claim?.separation === 'separated',
        ...(typeof claim?.withheld_reason === 'string' ? { leaderClaimWithheldReason: claim.withheld_reason } : {}),
        graph: readbackGraph ?? null,
        analysisReady,
        // Only the Run tool's typed sentence matching this final readback may survive ranking redaction.
        protectedGoalChanceSay: goalChanceSayFromThisTurn(result.tool_results),
        // The host's own typed line from this readback (gate 2): a node label can hold ". " and a ranking word, and a
        // fragment of the sentence must never be dropped or left behind (Codex #2577 P2).
        protectedHostLines: [...(rootLine !== null ? [rootLine] : []), ...(decisionReviewTurn?.lines ?? [])],
        // AX2: the build turn's automatic first pass was not asked to rank anything — drop a ranking, add no "why".
        // Nor was a research answer (served `5668902`: a public source's ranking was dropped, and the closing about the
        // user's model followed a reply about public evidence).
        // BYPASS1 keeps it: the gate appends its reason only when it cut a sentence, so the reply accounts for the cut.
        // SAY-SHOWN: where the AI was told `say` is shown, `say` gives the reason; the gate's own "why" would repeat it.
        sayWhyWithheld: fastPath !== 'research' && !(fa !== undefined && fastPath !== 'run' && !result.tool_calls.some((c) => c.name === 'run_analysis'))
          && !goalChanceSayPromisedThisTurn(result.tool_results),
        // The run's per-limit rows from the SAME readback: an estimate-only limit is said to have been checked.
        ...(limitVerdicts !== undefined ? { limitVerdicts, limitAskIds: limitAskIdsOf(readbackGraph) } : {}),
      });
      if (enforced.changed) {
        leaderClaimEnforced = true;
        const beforeGate = typeof wireBody.assistant_text === 'string' ? wireBody.assistant_text : '';
        // A shape sidecar describes the text it was built from; it goes with an edit to that text.
        const { _answer_shape: _dropped, ...withoutShape } = enforced.response as OlumiResponse & { _answer_shape?: unknown };
        wireBody = (enforced.editedFields.includes('assistant_text') ? withoutShape : enforced.response) as OlumiResponse & Record<string, unknown>;
        // The gate appends its closing as the last paragraph (`withheld-leader-fail-closed.ts`): by identity, the
        // paragraph the gated text ends with that the text before the gate did not hold.
        const afterGate = typeof wireBody.assistant_text === 'string' ? wireBody.assistant_text : '';
        const cut = afterGate.lastIndexOf('\n\n');
        const closing = (cut === -1 ? afterGate : afterGate.slice(cut + 2)).trim();
        if (closing !== '' && !beforeGate.includes(closing)) leaderGateClosing = closing;
      }
    }
    // The gate owns a duplicate concept only when its typed reason is actually present. A clean, non-ranking
    // narrator does not cause the gate to append a closing; availability alone must never silence the owed producer.
    const gateGoalChance = goalFigureCoHoldOf((wireBody as { blocks?: unknown }).blocks, readbackGraph ?? null, typedNow ?? undefined);
    // ⭐ SAY-SHOWN: the latest Run told the AI its `say` is shown (`say_shown`), so the host shows it: once, an AI copy counting
    // as that once, and no other owner silences it. Only an unknown current state still wins (DL 14 Oct): the withheld reason
    // may itself be stale.
    const sayPromised = goalChanceSayPromisedThisTurn(result.tool_results);
    const gateOwnsGoalChance = !sayPromised && gateGoalChance !== undefined && typeof wireBody.assistant_text === 'string'
      && wireBody.assistant_text.includes(gateGoalChance.why);
    const identityAskOwnedByCard = !sayPromised && ((wireBody.suggested_actions ?? []) as readonly OfferedAction[]).some((action) => {
      const id = typedApprovalOf({ chip: { id: action.id } });
      const proposal = id === undefined ? undefined : proposals.get(id);
      const reading = proposal === undefined ? undefined : identityReadingOf(proposal);
      return reading !== undefined && action.detail === reading.words;
    });
    const ranAnalysisThisTurn = fastPath === 'run' || fa !== undefined || result.tool_calls.some((c) => c.name === 'run_analysis');
    // ⛔ Bound by IDENTITY, never an equal value (DL lesson 08:08Z; Codex r1 on #3027). The card is this turn's Run only
    // when the shipped view names a Run (a non-empty run id, which DGAI's card binding needs: `mapV5Blocks`,
    // `matchesCanonicalRun` 'card') whose run-fact identity (`compareAnalysisRunFactIdentity`: scenario, graph hash,
    // `computed_at`) is the Run THIS turn executed, from that Run's own output: the Run press or the Agent's
    // `run_analysis` (`run_identity`), else the first pass (its own block and stamp, as goal certainty binds it). That
    // output carries no run id; an earlier Run of the same graph has another `computed_at`. And current, not stale.
    const thisTurnRun = ((): unknown => {
      for (let i = result.tool_calls.length - 1; i >= 0; i -= 1) {
        if (result.tool_calls[i]!.name !== 'run_analysis') continue;
        const out = result.tool_results[i] as { ran?: unknown; run_identity?: unknown } | undefined;
        if (out?.ran === true) return out.run_identity;
      }
      // The first pass binds by the ONE first-analysis receipt the run_delivery writer reads: its committed identity (the
      // in-process response carries no `analysis_state`; capacity e2e c0998b2e row 8), else its block and state.
      const own = firstAnalysisRunReceipt(fa)?.run_identity;
      return own === undefined ? undefined : { scenario_id: scenarioId, ...(own as Record<string, unknown>) };
    })();
    const cardView = ranAnalysisThisTurn && analysisResult !== undefined && canonicalViewMayShip
      ? boundRunCard(composedRead.canonicalAnalysisView, scenarioId, thisTurnRun, analysisResult) : undefined;
    const cardBound = cardView !== undefined;
    const selectedRunCurrent = (analysisState as { run_state?: { kind?: unknown } } | undefined)?.run_state?.kind === 'complete_current';
    // A disclosure is retired only when THIS turn's bound, shown chance already owns it.
    const cardDetail = cardBound ? cardDetailLinesOf(composedRead.canonicalAnalysisView) : null;
    if (cardBound && Array.isArray(wireBody.blocks)) {
      // The result block remains a complete fallback unless this SAME response's bound card owns the exact fact.
      // Keep distinct qualifications (for example, excluded model parts); never retire a summary merely because AI replied.
      const detail = (composedRead.canonicalAnalysisView as { goal_chance?: CanonicalGoalChanceDetail }).goal_chance;
      const noChange = detail?.status_quo;
      const nodes = (readbackGraph as { nodes?: { id?: unknown; label?: unknown }[] } | undefined)?.nodes;
      const held = Array.isArray(nodes) ? nodes.find(node => node.id === noChange?.option_id) : undefined;
      const baselineSuffix = noChange !== undefined && held !== undefined && typeof held.label === 'string'
        ? buildBaselineHoldSuffix([{ option_id: noChange.option_id, label: held.label }]).trim() : null;
      const owned = [...cardView.options.flatMap(({ cell }) => cell.kind !== 'none' && typeof cell.face === 'string' ? [cell.face] : []),
        ...(cardDetail?.disclosures ?? []), ...(baselineSuffix === null ? [] : [baselineSuffix])];
      wireBody = { ...wireBody, blocks: wireBody.blocks.map((block, index) => {
        // Only index0 is this route's selected final-read result (installed above); other blocks carry no card binding.
        if (index !== 0 || block.type !== 'analysis_result' || typeof block.summary !== 'string') return block;
        let summary = block.summary;
        for (const line of owned) if (line !== '') summary = withoutDisclosure(summary, line, { keep: 0 });
        return summary === block.summary ? block : { ...block, summary: summary.trim() };
      }) };
    }
    const estimatesOnCard = cardBound && goalChanceScreenLinesForAgent(analysisResult, readbackGraph ?? null, selectedRunCurrent)
      .some(line => line.olumi_estimate_link_count !== undefined);
    if (estimatesOnCard && basis !== null) {
      wireBody = { ...wireBody, assistant_text: withoutDisclosure(String(wireBody.assistant_text ?? ''), basis) };
      basis = null;
    }
    const horizonOwed = !hostProse && (decisionTurn.builtOrRan || (fastPath === 'explain' && narrationStatus !== 'stale'))
      ? untestedHorizonLineForCells(readbackGraph, chanceCells) : null;
    if (horizonOwed !== null && cardDetail?.has(horizonOwed) !== true && cardDetail?.has(STATIC_MODEL_SCOPE_NOTE) !== true) {
      wireBody = { ...wireBody, assistant_text: withDisclosures(String(wireBody.assistant_text ?? ''), [horizonOwed]) };
    }
    // ⭐ SAID ONCE (DL 14 Oct, marketing e2e 25d14238; the #3034 rule): this turn's bound card shows the §(g) cause itself,
    // so the GOAL-REACH 3b sentence is not said again (`cardSaysMissingLevel`; its next step stays on the action bar).
    if (reasonLine !== null && cardBound && cardSaysMissingLevel(analysisResult, cardView!.options)
      && typeof wireBody.assistant_text === 'string') {
      wireBody = { ...wireBody, assistant_text: withoutDisclosure(wireBody.assistant_text, reasonLine) };
    }
    // ⭐ THE CARD SAYS IT (Paul via DL, 14 Oct: no host line that repeats what the card already shows). When this turn's
    // bound current card shows a withheld cell for every option the withheld line covers, each cell carries its own reason
    // ("Not shown. …", from the same Run's warnings), so the host does not say it again. The AI holds the same
    // `goal_chance.say` in this turn's own tool output. A `say_shown` promise keeps the line: the AI was told it is shown.
    const withheldOptions = goalChanceWithheldOptionsFromThisTurn(result.tool_results);
    const cardShowsWithheld = cardBound && withheldOptions !== undefined && ((): boolean => {
      const cells = new Map(cardView!.options.map(({ option_id, cell }) => [option_id, cell] as const));
      const covered = withheldOptions === 'all' ? [...cells.keys()] : withheldOptions;
      return covered.length > 0 && covered.every((id) => cells.get(id)?.kind === 'withheld');
    })();
    // BYPASS1: on an ordinary AI reply the AI explains the withholding from `goal_chance.say`; a turn that ran an analysis
    // or explains the current Run keeps the line with the rest of the chance face (never-reask, one-reply-build rows).
    const chanceFaceTurn = fastPath === 'run' || fa !== undefined || result.tool_calls.some((c) => c.name === 'run_analysis')
      || (fastPath === 'explain' && narrationStatus !== 'stale');
    goalChanceOwed = stateFacts.current_state_unknown === true || (!sayPromised && !hostProse && !chanceFaceTurn)
      || (!sayPromised && cardShowsWithheld) ? null
      : goalChanceLineOwed(goalChanceResults, String(wireBody.assistant_text ?? ''), { gateReasonOwed: gateOwnsGoalChance,
        identityAskOwed: identityAskOwnedByCard || identityAskLineOwed(result.tool_results, '') !== null, graph: readbackGraph });
    if (goalChanceOwed !== null && typeof wireBody.assistant_text === 'string') {
      const goalLines = [goalChanceOwed];
      askEachOnce(goalLines, await repliesToCheckAsks(goalLines, historyReader, scenarioId, undefined));
      owed.push(...goalLines);
      wireBody = { ...wireBody, assistant_text: withDisclosures(wireBody.assistant_text, goalLines, { missingSentencesOnly: aiRunTurn }) };
    }
    /**
     * ⭐ AX1 — WHEN THE ANALYSIS CANNOT RANK A PRICE × VOLUME GOAL, THE ARITHMETIC STILL ANSWERS (DL #70 5850280205;
     * `break-even.ts`). Served (DL's joined run F8): every Run led with "No option can be put forward…" and gave the user
     * nothing they could act on, though the model holds every figure the answer needs. AFTER the leader gate on purpose:
     * this is conditional arithmetic on the model's own figures, never a ranking, and the gate drops any sentence that
     * compares options. Only on a turn that RAN an analysis (the Run, the Agent's own run, the first pass — never every
     * later turn whose readback still carries the result) and whose readback withholds the leader, and only when C46's
     * own product finding holds (`breakEvenFor` returns null otherwise) — and never for a product this readback's run
     * EVALUATED (`identityEvaluated`, C46 × R3-4, Canonical criterion 1): the engine computed it, so nothing is "added up".
     */
    const breakEven = ranAnalysisThisTurn && !aiRunTurn
      && (analysisState as { leader_claim?: { permitted?: unknown } } | undefined)?.leader_claim?.permitted !== true
      && retainedScopeIssues.length === 0 ? breakEvenFor(readbackGraph, identityEvaluated) : null;
    let breakEvenSaid: string | null = null;
    if (breakEven !== null && typeof wireBody.assistant_text === 'string') {
      breakEvenSaid = breakEvenLine(breakEven, { afterIdentityAsk: runOutcomeKind === 'identity_ask' });
      // After "The figures don't add up … Which is right?", the arithmetic is one side of the conflict: it opens on its
      // condition, "If MRR is …", with no lead-in that reads as an answer (AIQ #72 5868909577).
      wireBody = { ...wireBody, assistant_text: withBreakEvenAnswer(wireBody.assistant_text, breakEven, { afterIdentityAsk: runOutcomeKind === 'identity_ask' }) };
    }
    /**
     * ⭐ S4c (Wave B4/B5, 7 Oct): THE SCREEN'S CHANCE LINES ARE SAID BY OLUMI. On a turn that ran an analysis, each option's
     * chance line (a range; a point on the `each` licence) in the screen's own words, unless the reply already gives that
     * option's figure. AFTER the leader gate on purpose (as break-even): a per-option chance line is not a ranking, and the
     * gate's classifier codes it as one (B5 T1b: it deleted all three). From the final readback, only while its Run is
     * complete and current. Logged by code, never the prose.
     * S4d (Wave B6): ALSO on the Explain turn that narrates that current Run — B5's X1 ("…on current information:" with
     * nothing under it) was the Explain turn, which "ran an analysis" never covered. Never on a stale explanation.
     */
    const explainsCurrentRun = fastPath === 'explain' && narrationStatus !== 'stale';
    /** The screen's chance lines this turn owes (required evidence: the reply composer keeps them on the face). */
    let screenLines: ReturnType<typeof goalChanceScreenLinesForAgent> = [];
    if ((ranAnalysisThisTurn || explainsCurrentRun) && typeof wireBody.assistant_text === 'string') {
      screenLines = goalChanceScreenLinesForAgent(analysisResult, readbackGraph ?? null, selectedRunCurrent);
      // Recovery Batch C: the run-wide disclosures and each target's own chance, said once after the lines.
      // BYPASS1 keeps the chance face on every Run/Explain reply (the screen's lines are the headline, K-pinned).
      // ⭐ BYPASS1 (capacity witness on 351eeda0, turn 01 and the Run): on a turn that ran an analysis, the Run's card under
      // this reply says the goal-chance detail from this response's `canonical_analysis_view.goal_chance`, in these same
      // words (DGAI `goalChanceDetailLines`): "Doing nothing: … by assumption." was said twice. The reply does not repeat
      // what the card says; a line the card does not say (the range census note) stays, and an Explain (no card) keeps all.
      const cardDetail = cardBound ? cardDetailLinesOf(composedRead.canonicalAnalysisView) : null;
      if (cardDetail !== null) {
        const recordNotes = goalChanceNotesForAgent(analysisResult, readbackGraph ?? null, selectedRunCurrent);
        let text = wireBody.assistant_text;
        const cardIds = new Set(cardView!.options.map(option => option.option_id));
        const readNodes = (readbackGraph as { nodes?: unknown } | undefined)?.nodes;
        const emptyLabels = (Array.isArray(readNodes) ? readNodes : [])
          .filter((node): node is Record<string, unknown> => node !== null && typeof node === 'object' && !Array.isArray(node))
          .filter(node => node.kind === 'option' && typeof node.id === 'string' && cardIds.has(node.id))
          .flatMap(node => typeof node.label === 'string' ? [node.label] : []);
        const protectedTexts = userTextsForEgress(
          [...histories.typedWords(sessionId), ...(typedNow !== null ? [typedNow] : [])], recentRowsForEgress);
        const figureInChat = figuresIn(text).length > 0;
        const statusQuoLine = (composedRead.canonicalAnalysisView as { goal_chance?: CanonicalGoalChanceDetail }).goal_chance?.status_quo?.line;
        for (const line of new Set([...decisionLines, ...recordNotes])) {
          // A repeated figure still owes its qualifications in chat. The status-quo row is a separate card-owned finding.
          if (cardDetail.has(line) && (!figureInChat || line === statusQuoLine)) {
            text = withoutDisclosure(text, line, { keep: 0, emptyLabels, protectedTexts });
          }
        }
        wireBody = { ...wireBody, assistant_text: text };
      }

    }
    if (aiWroteReply && noDirectLink === null && fastPath !== 'method') {
      // A card promised to the interpreter can be withdrawn by the final read. If the SAME Run is still current,
      // its complete existing screen words return to chat. A stale/different Run never borrows those earlier figures.
      if (!cardBound && canonicalViewBasisCurrent && interpretedCardIdentity !== undefined && selectedRunCurrent
        && compareAnalysisRunFactIdentity(interpretedCardIdentity, { scenario_id: scenarioId,
          graph_hash_at_run: (analysisResult as { computed_against_hash?: unknown } | undefined)?.computed_against_hash,
          computed_at: (analysisState as { run_state?: { computed_at?: unknown } } | undefined)?.run_state?.computed_at }).status === 'match') {
        wireBody = { ...wireBody, assistant_text: withDisclosures(String(wireBody.assistant_text ?? ''), [
          ...screenLines.flatMap(line => [line.chance, line.depends]),
          ...goalChanceNotesForAgent(analysisResult, readbackGraph ?? null, true), ...decisionLines,
        ], { missingSentencesOnly: true }) };
      }
    }
    /**
     * ⭐ C5 — THE AGENT'S PROVISIONAL VIEW (Paul, DL #70 5855324470: "Yes, labelled provisional"). AFTER the leader gate
     * on purpose: a view ranks an option, and the gate — unchanged, the truth boundary for anything presented as the
     * analysis's result — would strip it. So it never rides in the model's prose: the Agent gives it through the typed
     * `give_provisional_view` tool, and it is appended here as ONE server-owned paragraph that opens on its label and on
     * why the analysis cannot confirm it (`provisional-view.ts`). Only when the Agent gave one this turn (never composed
     * for it) AND this FINAL readback still withholds the leader on a completed analysis, by the gate's own predicate.
     * Never in `blocks`, the analysis card or any leader field.
     */
    // C5b: on the Run button the view is the one interpreting call's typed field (`fastPathView`) — the SAME checks follow.
    const rawView = provisionalViewOfTurn(result.tool_calls, result.tool_results) ?? fastPathView;
    // The Agent's own words pass the user-facing scrub first (`sanitiseProvisionalView`); a code left refuses the view.
    const givenView = rawView === null ? null : sanitiseProvisionalView(rawView, parsedGraphOrNull(readbackGraph));
    if (rawView !== null && givenView === null) log.warn({ scenario_id: scenarioId }, 'agent-lane: a provisional view carried an internal code after the scrub — it is not shown');
    const standing = givenView === null ? null : leaderStandingOf({ analysisState, analysisReady, analysisResult, limitVerdicts, limitAskIds: limitAskIdsOf(readbackGraph) });
    // Typed only (never appended to `assistant_text`): see `provisionalViewSidecar`.
    const provisionalView = givenView !== null && standing !== null && standing.analysis_on_record && standing.withheld
      ? provisionalViewSidecar(givenView, standing.because)
      : null;
    if (provisionalView === null && givenView !== null) {
      log.warn({ scenario_id: scenarioId, analysis_on_record: standing?.analysis_on_record ?? null, withheld: standing?.withheld ?? null },
        'agent-lane: a provisional view was given but the final readback does not withhold the leader — it is not shown');
    }
    // ⭐ Wave B3 (7 Oct, CEE 7addf05): the final egress below (`withoutDriverAbsenceClaimsAtEgress`) runs BEFORE `_agent` and
    // its provisional view are attached, so the view never reached it: "…investigation priority is not established"
    // shipped beside a range line. The SAME function and gate clean the view here, where it is built.
    const provisionalViewShown = provisionalView === null ? null : ((): typeof provisionalView => {
      const viewBody: { assistant_text?: unknown; _agent: { provisional_view: typeof provisionalView } } = { _agent: { provisional_view: provisionalView } };
      const driverEditedView = withoutDriverAbsenceClaimsAtEgress(viewBody, {
        analysisResult, graph: readbackGraph ?? null, requestId: String(req.id), exitPath: 'agent_lane_v1_provisional_view',
        ...(turnId !== undefined ? { turnId } : {}),
      });
      return withLeftOutOptionCorrectionAtEgress(driverEditedView, {
        runOptionSet, optionParticipation, graph: readbackGraph ?? null,
        requestId: String(req.id), exitPath: 'agent_lane_v1_provisional_view', ...(turnId !== undefined ? { turnId } : {}),
      })._agent.provisional_view;
    })();
    // ⭐ A7's fold, measured on the reply the user sees (`withA7AfterGate`; CODEX class 5924813281): HERE, after the leader gate
    // (which may drop a ranking sentence) and after every later prose rewrite (the break-even arithmetic), so the count
    // cannot go stale; before the shape, which is built from this prose, and before the answer row, so a replay is the same.
    if (!aiWroteReply && fastPath !== 'method' && typeof wireBody.assistant_text === 'string') {
      const withA7 = withA7AfterGate(wireBody.assistant_text, readbackGraph, decisionTurn, statusText);
      if (withA7 !== wireBody.assistant_text) wireBody = { ...wireBody, assistant_text: withA7 };

    }
    let pendingPreview: ProposalPreview | undefined;
    /**
     * ⭐ T2 — THE GUIDANCE ROW (M1; `turn-context/guidance-wire.ts`): at most one coaching row (+ one edits row) from this
     * same final readback, as root `guidance: {slot1?, slot2?}` with `item_ref` by id (PANEL `readGuidanceRow`). Added
     * BEFORE final egress so the fail-closed walk covers it. Only content-free events from the surviving row are
     * committed with the answer; a replay still carries no live row (PANEL restores from its transcript).
     */
    if (fastPath === 'method') {
      if (pressedChipId === WIDEN_PRESS_ID || widenTarget === 'risks') handledGuidancePress = { policy_id: 'RC-WIDEN' };
      else if (isWhatChangesPress(pressedChipId)) handledGuidancePress = { policy_id: 'RC-WHAT-CHANGES' };
      else if (pressedChipId === 'agent-next-pre-mortem') handledGuidancePress = { policy_id: 'RC-PREMORTEM' };
    }
    {
      // Any proposal that would still execute waits for its yes: that card is the step, re-offered or not (`offeredNow`).
      const waitingIds = executableWaitingProposalIds(scenarioId, userId, graphHash, readbackGraph);
      const guidance = hostCards ? nextStepOffers.selection : undefined;
      if (guidance !== undefined) wireBody = { ...wireBody, guidance };
      // ⭐ S-C/S-E STANDING GAP SIGNAL (DL ruling 7 Oct): typed and deterministic, from this same final readback, on every
      // turn; S-B renders it (T0 tier, suppressed once dismissed). Only the widen reply also says it in words.
      const gap = hostCards ? modelGapOf(readbackGraph, toolCtx.user_text ?? '') : null;
      if (gap !== null) wireBody = { ...wireBody, model_gap: gap };
      // ⭐ THE SUGGESTION PREVIEW (DL 5941839936; `turn-context/proposal-preview.ts`): what a Yes on THIS turn's consent
      // chip would do, from the STORED proposal the chip names, only while it would still execute. Attached below, AFTER
      // the final egress and only beside its surviving chip (`previewBesideItsChip`); never on the answer row.
      const offeredId = offeredApprove !== undefined ? typedApprovalOf({ chip: { id: offeredApprove.id } }) : undefined;
      pendingPreview = offeredId !== undefined && waitingIds.includes(offeredId)
        && !heldCardOffer.some(a => a.id === offeredApprove?.id)
        ? proposalPreviewFor(offeredId, proposals.get(offeredId), readbackGraph) : undefined;
    }
    /**
     * ⛔ THE FAIL-CLOSED FINAL EGRESS (AI HARNESS PR-L1, `leader-final-egress.ts`): on EVERY turn, on the body exactly as
     * it ships — after the leader gate, break-even, A7 and the answer shape, before the answer row so a replay is the
     * same. One licence (`leaderLicenceFromState`) from this same final readback; a permitted turn is untouched.
     */
    let leaderFreeEnvelope = false;
    {
      const claim = (analysisState as { leader_claim?: { permitted?: unknown; separation?: unknown } } | undefined)?.leader_claim;
      const finalEgress = enforceLeaderLicenceAtFinalEgress(wireBody, {
        requestId: String(req.id),
        exitPath: 'agent_lane_v1_final',
        ...leaderGate,
        mayNameLeadingOption: claim?.permitted === true,
        separationEstablished: claim?.separation === 'separated',
      });
      leaderFreeEnvelope = finalEgress.leaderFreeEnvelope === true;
      if (finalEgress.response !== wireBody) {
        const { _answer_shape: _stale, ...withoutShape } = finalEgress.response as OlumiResponse & { _answer_shape?: unknown };
        wireBody = {
          ...(finalEgress.proseEdited ? withoutShape : finalEgress.response),
          // The producer licenses this view (including leader_licence); turn egress must match the scenario-graph read.
          ...(canonicalViewMayShip
            ? { canonical_analysis_view: composedRead.canonicalAnalysisView } : {}),
        } as OlumiResponse & Record<string, unknown>;
      }
    }
    /**
     * ⭐ PR-S2 r5 (prod cut-6 smoke 7 Oct, DL #87): while the Run's screen names what a chance rests on most, the reply
     * never says no assumption is established or most worth investigating; only that clause goes, logged by code.
     */
    {
      const driverEdited = withoutDriverAbsenceClaimsAtEgress(wireBody, {
        analysisResult, graph: readbackGraph ?? null, requestId: String(req.id), exitPath: 'agent_lane_v1_final',
        ...(turnId !== undefined ? { turnId } : {}),
      });
      const edited = withLeftOutOptionCorrectionAtEgress(driverEdited, {
        runOptionSet, optionParticipation, graph: readbackGraph ?? null,
        requestId: String(req.id), exitPath: 'agent_lane_v1_final', ...(turnId !== undefined ? { turnId } : {}),
      });
      if (edited !== wireBody) {
        const { _answer_shape: _stale, ...withoutShape } = edited as OlumiResponse & { _answer_shape?: unknown };
        wireBody = withoutShape as OlumiResponse & Record<string, unknown>;
      }
    }
    {
      const preview = previewBesideItsChip(pendingPreview, approvalChipIdFor, wireBody.suggested_actions);
      if (preview !== undefined) wireBody = { ...wireBody, proposal_preview: preview };
    }
    // ⭐ AFTER EVERY GATE THAT EDITS THE REPLY (buddy r2 on #2746): the reply's words follow the search controls it carries.
    // A search the Agent offered with no control on THIS body is said so in fixed words, at rest (never behind the
    // questions toggle, which the scope question below also drops). The gate's own envelope promises nothing, so it is
    // left as it is. ⛔ Only a control that is DELIVERED is remembered as pressable: the envelope ships none.
    if (!leaderFreeEnvelope) {
      wireBody = withResearchControlTruth(wireBody, researchOffered, (chip) => controlSurvivesLeaderGate(chip, leaderGate),
        (replyText, sentence) => withB3LinesAtRest(replyText, [sentence]));
    }
    rememberResearchOffers(approveKey, wireBody.suggested_actions);
    // Bind the question that is actually delivered after every prose gate.
    if (freshScopeQuestion !== null && !leaderFreeEnvelope) {
      const resting = textAtRest(String(wireBody.assistant_text ?? ''));
      wireBody = { ...wireBody, assistant_text: resting.includes(freshScopeQuestion) ? resting : `${resting} ${freshScopeQuestion}`.trim() };
    }
    /**
     * ⭐⭐ S-A REPLY SHAPE v1 — THE ONE LAST WRITER OF THE REPLY'S SHAPE (lane COPY-SHAPE, DL 0fd71f, 7 Oct; Paul: "It was a
     * better length before with the three bullets as a construct"; `agent-lane/reply/compose-reply.ts`). HERE, after every
     * prose gate and the scope question, before history, the durable row and the response, so what is stored, replayed and
     * shown is one text: the bounded face and the rest under "More detail" (`_answer_shape`, rendered by
     * DGAI `AnswerBody`). It replaces `withAnalysisAnswerShape` (Run replies only): every Agent-lane reply passes here.
     * Sentences are moved, never removed or cut; the composer's own invariant ships the text whole on any difference.
     * TYPED RESPONSE PROFILES by turn kind: coaching (80 face words, with counted protected overflow),
     * method_step (one structured prompt, never reshaped: R3, the worksheet is the chat verbatim), proposal (typed card +
     * this reply as its disclosure, never reshaped: R2, consent before brevity). Must-face on coaching, by identity: the
     * selected finding, screen chance lines and their own typed notes, optional RC4 estimates line, and one next step.
     * A surviving typed control owns its question. Other host/narrator words move verbatim to detail; a disclosure only
     * stays beside a face figure when its typed subjects match. The 80-word demotion order belongs to this one composer.
     * Whole profiles/envelopes retain their existing behavior; an uninterpreted Run uses coaching.
     * ⛔ THE ONE LAST WRITER: nothing below this block writes `assistant_text` (pinned by `reply-composer-last-writer.test.ts`).
     *
     * ⭐ PATH-B `core` (agent-tools.ts `AgentLaneMode`): the reply is the AI's own words, exactly. Every host line, ask, face,
     * disclosure and prose rewrite above is dropped here, once; the AI held the same facts as typed context (tool results,
     * canonical state, readiness, run_facts and the leader and goal-chance licences). Only the display boundary stays: a
     * proposal id is never text a user reads (display-ids.ts). Cards, blocks, the licensed result view, receipts on the wire,
     * the durable row and replay are unchanged. A host-written reply (no AI words, or a host truth swap) keeps today's path.
     */
    if (mode === 'core' && aiWroteReply) {
      const { _answer_shape: _hostShape, ...unshaped } = wireBody as OlumiResponse & Record<string, unknown> & { _answer_shape?: unknown };
      // A replacement by the AI's own words (nothing appended): every host line above is dropped, not added to.
      const aiOwnWords = withoutProposalIds(narratorWords ?? text);
      wireBody = { ...unshaped, assistant_text: aiOwnWords } as OlumiResponse & Record<string, unknown>;
    } else if (aiWroteReply && noDirectLink === null && fastPath !== 'method') {
      const checked = withEstimateGoalPointsAtEgress(wireBody, {
        analysisResult, graph: readbackGraph ?? null, current: selectedRunCurrent,
        narrator: 'olumi',
        disclosureOnCard: cardBound ? cardDetailLinesOf(composedRead.canonicalAnalysisView) : null,
        userAuthoredTexts: userTextsForEgress(
          [...histories.typedWords(sessionId), ...(typedNow !== null ? [typedNow] : [])], recentRowsForEgress),
      });
      const { _answer_shape: _priorShape, ...unshaped } = checked;
      wireBody = unshaped as OlumiResponse & Record<string, unknown>;
    } else {
      // The existing factual fallback still serves a turn with no usable AI answer.
      const uninterpretedRun = fastPath === 'run' && !runInterpreted && actionReply === null && !leaderFreeEnvelope;
      // A route-issued deadline card says its own question (the door's public_label, nothing added) AFTER the AI's answer to
      // this turn's message, never instead of it (hiring post3007 turn 02: "Is this a UI or a data issue?" got only the card,
      // and the next turn's AI said its question had gone unanswered). Both enter the ONE composer and the egress gate like
      // every other reply, so nothing below writes them again.
      // An answer that already says the card's whole question (exactly, not a word match) is not given it twice (Codex #3009).
      const agentAnswer = typeof wireBody.assistant_text === 'string' ? wireBody.assistant_text : '';
      const cardOwed = automaticDeadlineLabel !== undefined && !agentAnswer.includes(automaticDeadlineLabel) ? [automaticDeadlineLabel] : [];
      let reply = withCellHorizon(withDisclosures(agentAnswer, cardOwed), readbackGraph, chanceCells);
      const asks = [...decisionLines, hostProse ? askLine : null, freshScopeQuestion, ...owed].filter((l): l is string => typeof l === 'string' && l.includes('?'));
      // The withheld reason by its TYPED source, whether or not the gate had to insert it this turn (Codex r1 P1, #2748:
      // a reply that already carried the closing verbatim lost its obligation): the gate's own co-hold words, read from
      // this same final body, plus the paragraph the gate appended and every fixed no-leader sentence present.
      const coHold = goalFigureCoHoldOf((wireBody as { blocks?: unknown }).blocks, readbackGraph ?? null, typedNow ?? undefined);
      const faceContract = result.tool_calls.some(c => c.name === 'build_model_from_brief' && c.mutated === true)
        ? 'draft' as const : runPress || fastPath === 'explain' || screenLines.length > 0 || goalChanceOwed !== null || coHold !== undefined
          ? 'run' as const : undefined;
      // R2 N1 (friction audit): only a Run/Explain turn leads with the chance status; a draft, Run or Explain shows estimates.
      const runOrExplainTurn = ranAnalysisThisTurn || fastPath === 'explain';
      const widenCounts = widenedCountsOfBuild(result);
      const widenReceipt = widenCounts === null ? null : widenedLine(widenCounts);
      const runWidenWords = faceContract === 'run' || firstAnalysisExists || chanceShownFor(chanceCells)
        ? widenedRunWordsOf(readbackGraph, chanceCells, runOmittedRisks(analysisResult), hostProse) : {};
      const widenNote = chanceShownFor(chanceCells) && runWidenWords.saidByOwnLines !== true
        ? runWidenWords.widenedRiskNote ?? (widenCounts === null ? null : widenedRiskNote(widenCounts)) : null;
      // The build keeps its Draft receipt after H even when it also ran. Bind that Run's marker beside its chance.
      const firstRunRiskMarker = faceContract === 'draft' && screenLines.length > 0
        ? runWidenWords.widenedRiskMarker : undefined;
      if (firstRunRiskMarker !== undefined && !reply.includes(firstRunRiskMarker)) reply = withDisclosures(reply, [firstRunRiskMarker]);
      // A skipped Run has no result to narrate. Its host receipt crosses the same qualification and composer as every reply.
      if (runPressSkipped) {
        reply = 'The analysis did not run. Press Run to try again.';
        wireBody = { ...wireBody, suggested_actions: firstOfEachId([RUN_OFFER_CHIP, ...(wireBody.suggested_actions ?? [])]) };
      }
      if (aiRunTurn) reply = withoutUnsizedLinkInvitation(reply, analysisResult);
      // Every prose writer, including cell-owned horizons and the build's Run risk marker, crosses the ONE chokepoint
      // before shaping, history and storage. The unchanged-body branch below retains this same gated carrier.
      wireBody = withEstimateGoalPointsAtEgress({ ...wireBody, assistant_text: reply }, {
        analysisResult, graph: readbackGraph ?? null,
        current: selectedRunCurrent,
        userAuthoredTexts: userTextsForEgress(
          [...histories.typedWords(sessionId), ...(typedNow !== null ? [typedNow] : [])], recentRowsForEgress),
      });
      reply = String(wireBody.assistant_text ?? '');
      const horizonLine = faceContract === 'run' && chanceCells.some(cell => cell.kind === 'figure' || cell.kind === 'range')
        ? untestedHorizonLineForCells(readbackGraph, chanceCells) : null;
      const whatChanges = faceContract === 'run' && selectedRunCurrent && (fastPath !== 'explain' || explainsCurrentRun)
        ? whatChangesFaceLine(analysisResult, readbackGraph ?? null) : null;
      // The gate's typed cause precedence: a different claim reason does not name the co-held links.
      const closingReason = claimPermissionsFrom(analysisState, analysisReady).withheld_reason;
      const closingSubjects = closingReason === undefined || closingReason === WITHHELD_GOAL_PATH_UNSIZED
        || closingReason === WITHHELD_SEPARATION_UNAVAILABLE || closingReason === WITHHELD_LEADER_CAUSE_UNRECORDED
        ? coHold?.subjects : undefined;
      // The scoped guided producer is both the withheld finding and the next step; its presses own that step.
      const guidedRunFinding = faceContract === 'run' && guidedReplyText.guided !== null && reply.includes(guidedReplyText.guided)
        ? guidedReplyText.guided : undefined;
      const obligations: FaceObligation[] = [
        ...(firstRunRiskMarker === undefined ? [] : [{ role: 'caveat' as const, text: firstRunRiskMarker,
          subjects: screenLines.map(line => line.option_id) }]),
        ...(guidedRunFinding === undefined ? [] : [{ role: 'host' as const, text: guidedRunFinding, lead: true as const,
          ownsNextStep: true as const }]),
        ...[...asks, coHold?.ask].filter((l): l is string => typeof l === 'string').map((text) => ({ role: 'ask' as const, text })),
        ...(leaderGateClosing !== null ? [{ role: 'withheld_reason' as const, text: leaderGateClosing, subjects: closingSubjects }] : []),
        ...[coHold?.say, coHold?.why].filter((l): l is string => typeof l === 'string')
          .map((text) => ({ role: 'withheld_reason' as const, text, subjects: coHold?.subjects })),
        // RC6: the gate's own "No single option … because <why>." when the reply already carries it (the gate then adds no
        // closing, so `leaderGateClosing` is null): typed by identity, so the bare reason is said once inside it.
        ...(coHold === undefined ? [] : noLeaderBecauseSentences(coHold)).filter((l) => reply.includes(l))
          .map((text) => ({ role: 'withheld_reason' as const, text, subjects: coHold?.subjects })),
        ...AGENT_NO_LEADER_SENTENCES.filter((text) => reply.includes(text))
          .map((text) => ({ role: 'withheld_reason' as const, text })),
        // The fixed research-control disclosures remain typed caveats; the composer places them by face subject.
        ...[RESEARCH_NOT_ON_OFFER_TEXT, RESEARCH_ONLY_SHOWN_TEXT, RESEARCH_WORDING_REASON_TEXT].filter((text) => reply.includes(text))
          .map((text) => ({ role: 'caveat' as const, text })),
        // #2565: a licensed Explain of a fragile Run names a finding; its robustness caveat qualifies it, on the face.
        ...(explainRobustnessCaveat !== null ? [{ role: 'caveat' as const, text: explainRobustnessCaveat, disclosure: { kind: 'robustness' as const } }] : []),
        // Typed screen evidence: chance lines stay with their own notes; comparison basis/root lines go to detail.
        // A chance and what it depends on are ONE finding: the joined line (as
        // shown by the screen) binds as one unit when present, else each sentence binds where it stands.
        ...screenLines.flatMap((l): FaceObligation[] => [
          ...(l.depends === '' ? [] : [{ role: 'evidence' as const, text: `${l.chance} ${l.depends}`, lead: true as const, subjects: [l.option_id] }]),
          { role: 'evidence', text: l.chance, lead: true, subjects: [l.option_id] },
          ...(l.depends === '' ? [] : [{ role: 'evidence' as const, text: l.depends, subjects: [l.option_id], companionOf: l.option_id }]),
          ...[l.spread_note, l.shortfall_note].filter((note): note is string => note !== undefined)
            .map((text): FaceObligation => ({ role: 'evidence', text, subjects: [l.option_id], companionOf: l.option_id })),

        ]),
        ...[basis, rootLine].filter((l): l is string => typeof l === 'string' && l.trim() !== '')
          .map((text) => ({ role: 'evidence' as const, text })),
        // The withheld goal chance's reason (S-E GOALS #2742: the chance-goal sentence speaks alone) is a withheld reason:
        // the whole owed line when it stands, else each of its sentences where it stands (a re-ask may have dropped one).
        ...(goalChanceOwed !== null ? [goalChanceOwed, ...sentencesOf(goalChanceOwed)] : [])
          .map((text) => ({ role: 'withheld_reason' as const, text })),
        // Every other host line is ONE typed part, never split (S-A: host lines inserted by identity): the owed
        // disclosures and value changes, the status/receipt, CEE's own run words, and the arithmetic. A line that asks is
        // the ask; the rest may sit under More detail (R1).
        // A host line that carries the open-questions segment is typed up to it: the segment has its own place (detail,
        // DGAI's questions toggle), and a part spanning it could not be located as one unit.
        // The first automatic result uses the same server-authored ready line as an explicit uninterpreted Run.
        // Keep each named risk, while the existing composer states their identical exclusion sentence once.
        ...[...(uninterpretedRun || firstAnalysisResultFirst ? [RUN_RESULT_READY_TEXT,
          ...decisionLines.flatMap(line => line.includes('?') ? [line] : sentencesOf(line))] : []), ...owed.filter((l) => l !== goalChanceOwed), guidedReplyText.progress, narration.status, staleLine, readinessLine, runOutcomeText, breakEvenSaid]
          .map((l) => (typeof l === 'string' ? (openQuestionsSegment(l)?.lead ?? l).trim() : l))
          .filter((l): l is string => typeof l === 'string' && l !== '')
          .map((text) => ({ role: text.includes('?') ? 'ask' as const : 'host' as const, text })),
      ];
      // THE TYPED RESPONSE PROFILE, by the turn's kind (DL, AIE line review 6037446159 item 5): a method press is one
      // structured prompt; a substantive proposal keeps its whole disclosure. The route's automatic identity card
      // owns its confirmation question while the build/Run answer remains coaching. Never chosen by reading words.
      const madeProposal = approvalCalls.some((c) => c.ok && typeof c.proposal_id === 'string'
        && c.proposal_id !== automaticIdentityProposalId && c.name !== 'authorise_change' && c.name !== WITHDRAW_PROPOSAL);
      // S-C (#2759): the widen Add press is a method press whose ONLY output is its held card's own reply — the `proposal`
      // profile (by identity: `widenAdd` and a made proposal), so the door's words ship whole, never reshaped.
      const profile: ReplyProfile = widenAdd !== null && madeProposal ? 'proposal'
        : fastPath === 'method' ? 'method_step' : madeProposal ? 'proposal' : 'coaching';
      // No model wrote words this turn (a card press, an uninterpreted Explain, the action bar's typed reply: S-B #2751's
      // can't-yet / already-waiting words): every line is the host's, shipped as composed. The bar's sidecars (`_action`)
      // are attached after this block and never pass the composer.
      const narratorModel = runPressSkipped || actionReply !== null || fastPath === 'approve' || fastPath === 'strengthen' ? null
        : fastPath === 'run' || fastPath === 'explain' ? (narratorWords !== null ? interpretBudget().model : null) : budget.model;
      const a7Repeat = await a7SaidLastTurn(readbackGraph, chanceCells, historyReader, scenarioId, turnId);
      const estimates = actionFactsOf({ scenarioId, graph: readbackGraph, graphHash, analysisState, analysisReady,
        analysisResult, optionParticipation, identityEvaluated, guidance: guidanceHistory, pending: durablePending }).olumiEstimates;
      const controlsOnReply = (wireBody.suggested_actions ?? []) as readonly OfferedAction[];
      const typedControlQuestions = controlsOnReply.filter((action) => {
        const id = typedApprovalOf({ chip: { id: action.id } });
        // This question lives in its card detail; it does not reshape the Run's existing prose.
        return id !== undefined && !isSteadyCardProposal(id);
      })
        .flatMap((action) => typeof action.detail === 'string' && action.detail.includes('?') ? [action.detail] : []);
      for (const pending of durablePending) {
        const question = (pending.action as { question?: unknown }).question;
        if (typeof question === 'string' && controlsOnReply.some((action) => action.id === pending.chip_id)) typedControlQuestions.push(question);
      }
      // A refused build Run still owes the final read's withheld-goal explanations.
      // The root refusal does not establish that the rest of that Run remains usable.
      const blockedBuildGoalDetails = faceContract === 'draft' && firstAnalysisRefusalSaid
        && chanceCells.length > 0 && chanceCells.every(cell => cell.kind === 'withheld')
        ? [thresholdReasonLine(readbackGraph, analysisResult)?.replace(THRESHOLD_REST_STANDS, ''),
          goalChanceWithheldForAgent(analysisResult, readbackGraph)?.say]
          .filter((line): line is string => typeof line === 'string' && line.trim() !== '')
        : [];
      const composedReply = composeReplyShape({
        analysisResult,
        text: reply,
        // A host-only answer did not consume the carrier and keeps its existing bytes.
        // BYPASS1: on the AI's reply the Why? line is not added (the AI has `eligible_intervention.why`). The chance and
        // draft faces (lines, markers, horizon, what would change, estimates, widened receipt) stay: they are the headline.
        ...(eligibleIntervention === undefined || !(result.timing.provider_calls > 0) ? {} : { eligibleIntervention, interventionActionLabel: preReplySelection?.wire?.slot1?.primary_action.label,
          interventionWhySaid: preReplySelection?.whySaid === true }),
        chanceCells,
        ...(faceContract === undefined ? {} : { faceContract }),
        ...(widenReceipt === null ? {} : { widenedLine: widenReceipt }),
        ...(widenNote === null ? {} : { widenedRiskNote: widenNote }),
        ...(runWidenWords.widenedRiskMarker === undefined ? {} : { widenedRiskMarker: runWidenWords.widenedRiskMarker }),
        ...(horizonLine === null ? {} : { horizonLine }),
        ...(whatChanges === null ? {} : { whatChanges }),
        ...(faceContract !== undefined && !runOrExplainTurn ? { notRunOrExplain: true as const } : {}),
        ...((faceContract === 'draft' || runOrExplainTurn) && profile === 'coaching' && estimates !== null && estimates.count > 0
          ? { estimatesLine: `Olumi's estimates: ${estimates.count}, see Check estimates.` } : {}),
        typedControlQuestions,
        detailLines: stateFacts.current_state_unknown === true ? []
          : [...eventRiskDisclosuresFor(result.tool_results), ...blockedBuildGoalDetails],
        obligations: withA7AsDetail(obligations, a7Repeat, reply, chanceCells.some(cell => cell.kind === 'figure' || cell.kind === 'range')),
        graph: readbackGraph,
        profile,
        // AI-first N1: on an ordinary model-written turn the AI's answer is the reply. A Draft build keeps its receipt face and
        // a Run/Explain its chance face (the horizon marker stays beside a chance).
        ...(leaderFreeEnvelope ? { keepWhole: 'leader_free_envelope' as const }
          // A Draft build keeps its receipt face (S4's estimates/widened receipt); a Run/Explain reply is the AI's answer.
          : aiRunTurn && faceContract !== 'draft' ? { keepWhole: 'ai_run_answer' as const }
          : narratorModel === null && !uninterpretedRun ? { keepWhole: 'host_composed' as const }
            : profile === 'coaching' && !runOrExplainTurn && faceContract !== 'draft' ? { keepWhole: 'ai_answer' as const } : {}),
      });
      const { _answer_shape: _priorShape, ...unshaped } = wireBody as OlumiResponse & Record<string, unknown> & { _answer_shape?: unknown };
      // Written only when the composer shaped the reply or placed owed detail lines: an unshaped, unchanged reply (or a
      // body with no `assistant_text` at all) ships byte-identical, as before.
      wireBody = (composedReply.shape !== null || composedReply.text !== reply
        ? { ...unshaped, assistant_text: composedReply.text,
          ...(composedReply.shape !== null ? { _answer_shape: composedReply.shape } : {}) }
        : unshaped) as OlumiResponse & Record<string, unknown>;
      log.info({
        event: 'agent_lane.reply_shaped', request_id: String(req.id), ...(turnId !== undefined ? { turn_id: turnId } : {}),
        outcome: composedReply.outcome, ...(composedReply.reason !== undefined ? { reason: composedReply.reason } : {}),
        fast_path: fastPath ?? 'agent', profile,
        narrator_model: narratorModel,
        obligations: obligations.length,
        ...(composedReply.measure ?? {}),
      }, 'agent-lane: the reply passed the one composer');
    }
    wireBody = turnAnalysisData(wireBody, mode);
    // History and the durable answer row below remember the same FINAL SENT text, after every gate.
    // Ordinary turns keep their reasoning and tool pairs; only their trailing assistant messages are replaced.
    // Every retained Run output becomes a neutral marker; superseded pairs leave with their reasoning as before.
    const sentText = String(wireBody.assistant_text ?? text);
    // Persist the producer's exact delivered question or its qualified clarification, after every egress gate.
    const levelAskAnswered = levelAnswerTool !== undefined || result.tool_calls.some(call => call.name === CURRENT_LEVEL_TOOL);
    // GOAL-REACH 3b (COPY-SHAPE patch): the bar's set_current_level press is a typed reply ('method'), and its words ARE
    // the current-level ask, so it is persisted like the producer's own (otherwise the answer could not force the card).
    // Never while a held change waits for its yes (Codex r1 P1-3 on #2816): that change is answered first.
    const levelPress = actionPress?.action === 'set_current_level' && liveHolds.length === 0;
    const deliveredLevelAsk = mode === 'full' && (fastPath !== 'method' || levelPress) ? currentLevelAskOnAnswer({
      graph: readbackGraph, analysisResult, sentText, scenarioId, userId, emittedAtIso,
      prior: levelAsk, answered: levelAskAnswered, message,
      awaitingApproval: approvals.length > 0 || carriedApproval.length > 0 || leavesProposalAwaitingApproval(approvalCalls),
    }) : null;
    const nextLevelAsk = mode === 'full' ? currentLevelAskForAnswerRow({
      prior: levelAsk, next: deliveredLevelAsk, answered: levelAskAnswered,
      graph: readbackGraph, graphHash, nowMs: Date.parse(emittedAtIso),
      typedByUser: typedByUser(body),
    }) : null;
    if (nextLevelAsk !== null) {
      // The question precedes lower-priority Run offers; never displace an approval or a live hold.
      const at = durablePending.findIndex((pa) => pa.action.kind === 'run_analysis');
      if (durablePending.length < PENDING_ACTIONS_PER_TURN_CAP) durablePending.splice(at < 0 ? durablePending.length : at, 0, nextLevelAsk);
      else if (at >= 0) durablePending.splice(at, 1, nextLevelAsk);
      else log.warn({ scenario_id: scenarioId }, 'agent-lane: current-level ask could not fit beside live holds');
    }
    const displayedQuestion = automaticDeadlineLabel !== undefined
      && wireBody.suggested_actions.some(action => action.detail === automaticDeadlineLabel)
      && !sentText.includes(automaticDeadlineLabel) ? automaticDeadlineLabel : undefined;
    const historyReply = displayedQuestion === undefined ? sentText
      : `${sentText}\n\n[Card displayed beside this reply; reference data]\n${displayedQuestion}`;
    const sentItems = fastPath === 'method'
      ? methodTurnItems(history, message, historyReply)
      : historyWithSentText(result.items, historyReply);
    histories.set(sessionId, dropSupersededPairs(pruneSupersededToolOutputs(sentItems, chipApprovals)));
    // Published to in-memory session history, not a durable save; no-save copy is now false.
    recordUnsavableEffect();

    /**
     * ⭐ PERSIST THE TURN BEFORE ANSWERING — the row a lost-response retry is
     * replayed from. No graph rides on it (the Agent's writes carry their own
     * identities), so it takes no fence and no CAS. Stored text is the FINAL
     * text returned, disclosures included, so a replay is word-for-word.
     */
    let durability: 'recorded' | 'not_recorded' | 'no_turn_id' = 'no_turn_id';
    /**
     * ⛔ AN OFFER IS DURABLE EVEN WHEN THE CLIENT NAMED NO TURN (Canonical State's deploy-survival witness,
     * #69 5833516415 / 5833557327): its turns sent no `turn_id`, so the answer row that carries the offer was
     * never written, and after a real CEE deploy "Use as starting assumptions" met `unknown_proposal`. The
     * UI always names its turns (DecisionGuideAI `buildPayload.ts:202`); an API caller need not. So a turn
     * with no id that has an offer to carry writes its answer row under an id minted HERE, at the end —
     * no claim, no replay, no fence, exactly as before for everything else about an unnamed turn.
     */
    const answerGuidance = guidanceOnAnswer((wireBody.guidance as GuidanceWire | undefined) ?? thinShownGuidance, guidanceHistory, handledGuidancePress);
    const answerOffers = ((wireBody.suggested_actions ?? []) as readonly SuggestedAction[])
      // The migration's cap is 8 offers per row; a ninth would refuse the whole row, so it stays live only.
      .filter(isDurableAnswerOffer).slice(0, 8).map(({ id, label, message }) => ({ id: storedOfferId(id), label, message }));
    const answerOffersRunKey = runExplanationChip(scenarioId, { graphHash, analysisState, analysisResult })
      ?.id.slice(RUN_EXPLANATION_PREFIX.length) ?? null;
    const answerNarration = answerRunNarrationOf(wireBody.narration);
    /**
     * ⭐ 0.79 SD-1 Slice R — THE run_delivery WRITER (DL #87 option A; rebuilt from #2657 on DL 13:07Z 14 Oct, prod CEE on
     * schemas 0.81): what this Run's turn DELIVERED, recorded on this answer row as an append-only `run_delivery` fact, so a
     * reload or a second device shows the same "Olumi model review" cards (CEE #2654 serves it as `current_read.delivered_record`;
     * DGAI adopts it). Its Phase 3 blocks are `wireBody`'s here: the persistence floor below changes only its offers. Bound to the
     * Run THIS turn made (its `run_identity` = the read's current Run), and only within the read's licence; any doubt omits it,
     * and the row is written exactly as before. A guidance answer records it too (the wrapper admits ONE, 20261006070522).
     */
    const runDelivery: RunDeliveryOutcome = runDeliveryFactFor({
      sentBody: wireBody as Record<string, unknown>,
      // The automatic first analysis is this turn's Run too; a later Run in the turn wins.
      toolResults: turnRunReceipts(fa, result.tool_results),
      // The final read as it came: the Run it selected and the graph the reader checks, from one read.
      read: finalRead,
      licence: leaderLicenceFromState(analysisState, analysisReady),
      analysisReady,
    });
    if (runDelivery.kind === 'recorded' || runDelivery.reason !== 'no_run_this_turn') {
      log.info({
        event: 'v5.run_delivery', request_id: String(req.id), scenario_id: scenarioId,
        ...(runDelivery.kind === 'recorded'
          ? { outcome: 'recorded', block_count: runDelivery.record.phase3_blocks.length }
          : { outcome: 'omitted', reason: runDelivery.reason }),
      }, 'agent-lane: run_delivery');
    }
    if (turnRunReceipts(fa, result.tool_results).some((r) => (r as { ran?: unknown } | null)?.ran === true)) interruptIfArmed(recoveryFault, 'after_run');
    // A recorded delivery is durable too: the same minted id as an offer, so an unnamed turn never drops the record.
    const rowTurnId = turnId ?? (durablePending.length > 0 || answerGuidance !== undefined || runDelivery.kind === 'recorded' ? randomUUID() : undefined);
    if (rowTurnId !== undefined) {
      try {
        // Through the SHARED persistence floor, like every turn row: the one
        // `store.append` stays inside it (C8). No graph rides on this row.
        // S-D x S-D.1b: the floor may reconcile more than once (it re-reads when the latest row moved). Every attempt starts
        // from the reply as composed BEFORE the floor, and a proposal that did not fit is set aside only after the append.
        const wireBeforeFloor = wireBody;
        let overCapAtAppend: readonly PendingAction[] = [];
        let overCapSaid: readonly string[] = [];
        const appendAnswer = (handlerFacts: readonly HandlerFact[], withGuidance = true) => appendCheckedGraphWrite({
          store,
          writesGraph: false,
          source: 'agent_turn',
          baseGraphForInvariants: readbackGraph,
          withdrawnGoalScopeChipIds: [...scopeWithdrawals].filter((id): id is string => typeof id === 'string'),
          // ⭐ S-D: held proposals are reconciled again against the latest row just before the append: one another request
          // declined meanwhile is never resurrected, and one another request minted meanwhile is never erased.
          heldProposals: { isHeld: isHeldProposal, seenByThisRequest: heldSeenThisTurn,
            offeredChipIds: new Set(offeredNow.filter(a => typedApprovalOf({ chip: { id: a.id } }) !== undefined).map(a => a.id)),
            onReconciled: (write, overCap) => {
              reconciledPending = write.pending_actions ?? [];
              heldRecords = (write.pending_actions ?? []).flatMap(p => {
                const r = proposalRecord(p, readbackGraph); return r && heldRecordAppliesAt(p, r, readbackGraph, graphHash) ? [r] : [];
              });
              overCapAtAppend = overCap;
              // ⛔ The reply composer is the ONE last writer of the reply (#2748): a lapse found HERE, after composing, is
              // said at the start of this scenario's next reply (`owedHeldLapses`), never appended to this one.
              overCapSaid = overCap.map(h => heldLapseSentence(heldChangeName(h), 'over_cap'));
              // A card kept for review is held but not applicable: its "Review this change" and "Not now" stay while it is held,
              // and it is never offered as approvable — not even when the model is back where it was (`approvable`).
              const underReviewNow = new Set((write.pending_actions ?? []).filter(heldCardUnderReview).map((p) => heldProposalId(p)));
              const approvable = heldRecords.filter(r => !underReviewNow.has(r.proposal_id));
              const actions = (wireBeforeFloor.suggested_actions as OfferedAction[] | undefined ?? []).filter(a => {
                const approved = typedApprovalOf({ chip: { id: a.id } }); const declined = declinedProposalOf(a.id); const reviewed = reviewedProposalOf(a.id);
                return approved !== undefined ? approvable.some(r => r.proposal_id === approved)
                  : declined !== undefined ? heldRecords.some(r => r.proposal_id === declined) || underReviewNow.has(declined)
                    : reviewed !== undefined ? underReviewNow.has(reviewed)
                      : a.id !== AMEND_CHIP.id || approvable.length > 0;
              });
              const oldest = approvable.find(r => r.proposal_id === approvedProposal) ?? approvable[0];
              if (oldest !== undefined && !actions.some(a => typedApprovalOf({ chip: { id: a.id } }) !== undefined)
                && !offeredNow.some(a => a.id === oldest.approve_action.id)
                && fastPath !== 'method' && !decisionReviewRequested
                && (fastPath !== 'approve' || result.tool_calls.some(c => c.name === 'authorise_change' && (c.ok || c.mutated))
                  || heldRecords.some(r => r.proposal_id === approvedProposal))) actions.unshift(oldest.approve_action as OfferedAction, AMEND_CHIP, oldest.decline_action as OfferedAction);
              wireBody = { ...wireBeforeFloor, suggested_actions: firstOfEachId(actions) };
              return { ...write,
                pending_actions: (write.pending_actions ?? []).map(p => withApprovalOfferedOnRow(p, actions.some(a => a.id === p.chip_id))),
                suggested_actions: firstOfEachId(actions).filter(isDurableAnswerOffer).map(({ id, label, message }) => ({ id: storedOfferId(id), label, message })) };
            } },
          write: {
          scenario_id: scenarioId,
          // The ANSWER row, under the client's own turn_id (the claim `<turn_id>:claim` was taken before
          // the run), or under the id minted above for an unnamed turn that carries an offer.
          turn_id: rowTurnId,
          // DB CHECK: (turn_class = 'handler') = (handler_id IS NOT NULL) —
          // the graph-register precedent for a turn with no handler.
          turn_class: 'direct_answer',
          handler_id: null,
          request_hash: requestHash,
          response_emitted: true,
          // The calls this turn MADE, from the request's provider ledger (every choke point, a method press's 0 included;
          // DL follow-up on #2480). The per-path estimate only where the ledger cannot say (no policy, or truncated).
          llm_calls_used: providerCallsMade()
            ?? (fastPath === 'approve' || fastPath === 'strengthen' ? 0 : fastPath === 'run' || fastPath === 'explain' ? (runInterpreted ? 1 : 0) : result.hops + 1),
          duration_ms: Date.now() - startedAt,
          handler_facts: handlerFacts,
          userMessage: message,
          assistantMessage: String(wireBody.assistant_text ?? text),
          ...(withGuidance && answerGuidance !== undefined ? { agent_guidance: answerGuidance } : {}),
          ...(answerOffers.length > 0 ? {
            suggested_actions: answerOffers,
            suggested_actions_run_key: answerOffersRunKey,
          } : {}),
          // The narration this answer is sent with, stored WITH its row so a replay after a restart names its Run.
          ...(answerNarration !== null ? { run_narration: answerNarration } : {}),
          // The Run offer AND the offered approval, durably, with THIS answer row — so a replay, or an
          // approval that reaches a restarted process, can still find them.
          ...(durablePending.length > 0 ? { pending_actions: durablePending } : {}),
          },
        });
        let outcome: Awaited<ReturnType<typeof appendAnswer>>;
        try {
          outcome = await appendAnswer(runDelivery.kind === 'recorded' ? [runDelivery.fact] : []);
        } catch (err) {
          // ⛔ The DELIVERY never costs the ANSWER: a guidance wrapper without 20261006070522 (rolled back) refuses the whole
          // row, and the RPC rolled it back. That one refusal retries once without the fact: the answer and its offers stay
          // durable, and only the delivery record is lost (and logged).
          // ⛔ Lane A A3(a): nor does the GUIDANCE cost the answer. The store refuses an entry it cannot hold before any write
          // (held-keys.ts), so that definite refusal alone retries once without the guidance. Nothing else is retried here:
          // no model write, Run or delivery is repeated, and an unknown outcome stays `not_recorded`.
          const guidanceRefused = answerGuidance !== undefined && GUIDANCE_ENTRY_REFUSALS.some(m => String(err).includes(m));
          if (guidanceRefused) {
            log.warn({ event: 'v5.answer_guidance', request_id: String(req.id), scenario_id: scenarioId, outcome: 'omitted', reason: 'guidance_entry_refused', err: String(err) },
              'agent-lane: the store refused this answer\'s guidance metadata before writing: answer written without it');
            outcome = await appendAnswer(runDelivery.kind === 'recorded' ? [runDelivery.fact] : [], false);
          } else {
            if (runDelivery.kind !== 'recorded' || !String(err).includes(GUIDANCE_WRAPPER_REFUSAL)) throw err;
            log.warn({ event: 'v5.run_delivery', request_id: String(req.id), scenario_id: scenarioId, outcome: 'omitted', reason: 'guidance_wrapper_refused' },
              'agent-lane: run_delivery refused by the guidance wrapper (migration 20261006070522 rolled back?): answer written without it');
            outcome = await appendAnswer([]);
          }
        }
        for (const h of overCapAtAppend) if (agentProposalOf(h) !== undefined) proposals.discard(heldProposalId(h));
        oweHeldLapses(scenarioId, overCapSaid);
        if (outcome.priorTurnConflict === true) {
          // A concurrent request with the SAME id and a DIFFERENT message won the
          // row. This answer is not the recorded one; say so rather than return it.
          log.warn({ scenario_id: scenarioId, turn_id: rowTurnId }, 'agent-lane: turn id taken by a different concurrent message');
          return reply.code(409).send({ error: 'TURN_ID_REUSED', detail: 'That turn id was already used for a different message. This reply was not recorded.' });
        }
        if (outcome.replayedPriorTurn === true && turnId !== undefined && typeof store.readCommittedTurn === 'function') {
          // An identical concurrent request committed first: ITS answer is the
          // record, so it is the one returned.
          const first = await store.readCommittedTurn(scenarioId, turnId);
          if (first !== null) return reply.code(200).send(await replayed(first, retainedScopeIssues.filter(p => freshScopeIssues.some(f => f.chip_id === p.chip_id))));
        }
        durability = 'recorded';
        // Only a row that was written moves the slot: the next answer row carries what THIS one did.
        carriedProposals.persisted(approveKey, approvalCarrier);
      } catch (err) {
        if (err instanceof ModelWriteOwnershipRefused) {
          const released = await releaseUnwrittenTurnClaim();
          // A released claim is discounted for this request and its parents. Other durable
          // entries survive, and in-memory history publication is a separate effect.
          const successfulDoorEntries = readSuccessfulDoorEntries();
          if (successfulDoorEntries === 0 && readUnsavableEffects() === 0 && (!claimAppendSucceeded || released)) {
            const refusalBody = MODEL_WRITE_OWNERSHIP_REFUSAL_BODY[err.reason];
            return reply.code(403).send({ error: refusalBody.error, message: refusalBody.message });
          }
          if (successfulDoorEntries > 0) {
            log.warn({ event: 'model_write.ownership_refused_after_commit', reason: err.reason,
              request_id: String(req.id), successful_door_entries: successfulDoorEntries },
            'Model write ownership refused after an earlier successful door entry');
          }
          return reply.code(403).send({ error: err.code });
        }
        // The answer is real and the writes already happened; hiding it would be
        // worse. It is returned, flagged as not durable, and logged loudly.
        log.error({ err: String(err), scenario_id: scenarioId, turn_id: rowTurnId }, 'agent-lane: answer could not be recorded — the claim stands, so a retry reports an unknown outcome and never re-runs');
        durability = 'not_recorded';
      }
    }

    /**
     * ⭐ S-B: THE ACTION BAR THIS ANSWER CARRIES (`action_bar` v1; github-a2 contract amendments 1–11 + v1.1), on EVERY turn,
     * from the SAME final readback and the guidance history the reload GET will read: when this answer row wrote guidance
     * events, that history is re-read AFTER the row is written (the reload reads the newest rows, so overlaying this row's
     * events on the start-of-turn history drifts once the window rolls over; Codex r1 P2-4 on #2751); otherwise the
     * start-of-turn history is already the reload's. The reload GET derives the bar with the same function from the same
     * persisted state (amendment 9), so an unchanged state reloads it byte for byte. Never stored: the answer row's SQL
     * envelopes carry no bar (the recorded missing contract).
     */
    const actionBar = !hostCards ? undefined : await (async () => {
      try {
        let history: GuidanceState | null = guidanceHistory;
        if (answerGuidance !== undefined) {
          history = { ...(guidanceHistory ?? {}), ...answerGuidance.entries };
          if (durability === 'recorded' && typeof store.readGuidanceHistory === 'function') {
            try { history = await store.readGuidanceHistory(scenarioId); } catch { /* keep the overlay: the read failed, not the bar */ }
          }
        }
        // The approval carrier the reload reads: the latest PERSISTED pending row, after the persistence floor's held-proposal
        // reconcile (Codex r1 P1-1 on #2766). This turn's own carrier only when that read is unavailable.
        let pending: readonly PendingAction[] = durablePending;
        if (typeof store.readMostRecentPendingActions === 'function') {
          try { pending = await store.readMostRecentPendingActions(scenarioId, { validation: 'strict' }); } catch { /* keep this turn's carrier */ }
        }
        return actionBarOf(actionFactsOf({ scenarioId, graph: readbackGraph, graphHash, analysisState, analysisReady, analysisResult,
          optionParticipation, identityEvaluated, guidance: history, pending }));
      } catch (err) {
        log.warn({ scenario_id: scenarioId, err: String(err) }, 'agent-lane: action bar could not be ranked; the turn carries none');
        return undefined;
      }
    })();
    // A7: what of the brief the model does not carry — the final readback's own manifest, bound to its graph_hash.
    const notModelledCarrier = notModelledTurnCarrier(notModelled, graphHash);
    // Local carrier, AFTER finalisation and licence egress. If egress changed the prose, the worksheet is withheld.
    const premortemDiagnostics = premortemWorksheetDiagnosticsFor({
      scenarioId, turnId, turn: methodTurn?.kind === 'run' ? methodTurn : null,
      // Egress may add whole paragraphs around the method reply, never edit it (P02, jw-j1): rows parse that reply.
      passed: premortemPassed && premortemReply !== undefined && methodReplySurvives(premortemReply, String(wireBody.assistant_text ?? '')),
      reply: premortemReply ?? '', candidates: premortemCandidates,
      initial: premortemInitialRead, final: composedRead,
    });
    const premortemWorksheet = premortemDiagnostics.worksheet;
    if (methodTurn?.kind === 'run' && (premortemWorksheet === undefined || premortemDiagnostics.dropped.length > 0)) {
      log.info({ event: 'PREMORTEM_WORKSHEET_WITHHELD', request_id: String(req.id), turn_id: turnId,
        exit: premortemDiagnostics.exit, stories: premortemDiagnostics.stories,
        rows: premortemDiagnostics.rows, dropped: premortemDiagnostics.dropped.map(({ story_index, reason }) => ({ story_index, reason })) },
      'PREMORTEM_WORKSHEET_WITHHELD');
    }
    const issuedTurnIds = await proposalIssuers(heldRecords, [...reconciledPending, ...durablePending, ...liveHolds]);
    // Remember only the controls actually sent, after egress and held-proposal reconciliation.
    // This bounded in-process cache changes no persistence; a cold replay has only the narration persisted with its row.
    if (turnId !== undefined) rememberOffered(`${scenarioId}:${turnId}`, {
      actions: wireBody.suggested_actions,
      ...(wireBody.narration !== undefined ? { narration: wireBody.narration as ReplayNarration } : {}),
      ...(wireBody.suggested_actions.some(action => action.id === RUN_OFFER_CHIP.id) && narrationKey !== undefined
        ? { runControlKey: narrationKey } : {}),
      sizingRunKey: guidedSizingOnWire(guidedSizing, wireBody.graph_hash)?.run_key,
    });
    // ⭐ Accel P24 / SCI-10: the probe's typed rows (`_method_result` v:1), from the turn AS PRESENTED, sent only when every
    // row and figure is in the final reply (the worksheet's egress rule above). This follows finaliseV5Response, both
    // leader gates, driver-absence egress, Run-unavailable replacement and reply shaping. Only additive response fields
    // follow: nothing below rewrites assistant_text or passes the sidecar through a scrub. Absent for every other turn.
    const methodResult = methodResultForEgress(
      structuralChallengeTurn !== null && turnId !== undefined ? testLinkMethodResult(structuralChallengeTurn, { scenarioId, turnId })
        : whatChangesTurn !== null && turnId !== undefined
          ? whatChangesMethodResult(whatChangesTurn, { scenarioId, turnId, run: null, analysisResult: composedRead.analysisResult })
          : null,
      String(wireBody.assistant_text ?? ''));
    return reply.code(200).send({
      ...wireBody,
      suggested_actions: wireBody.suggested_actions.map(guidedSizingWireAction),
      ...(guidedSizingOnWire(guidedSizing, wireBody.graph_hash) !== undefined
        ? { guided_sizing: guidedSizingOnWire(guidedSizing, wireBody.graph_hash) } : {}),
      ...(premortemWorksheet !== undefined ? { _premortem_worksheet: premortemWorksheet } : {}),
      ...(methodResult !== null ? { _method_result: methodResult } : {}),
      /**
       * ⭐ S-B: the action bar (a root key DGAI keeps in `__additive__`, as it does `guidance`), and on an action press its
       * receipt `_action`: which action, on which revision, and whether it ran or answered "can't yet" (contract v1.1 item 5).
       */
      ...(actionBar !== undefined ? { action_bar: actionBar } : {}),
      ...(actionPress !== null && actionFactsAtPress !== undefined ? { _action: actionReceiptOf(actionPress, actionFactsAtPress.revision,
        actionReply === null || actionReply.outcome === 'ran' ? 'ran' : 'cant_yet', actionReply?.reason, actionReply?.science) } : {}),
      /**
       * ⭐ A7 (DL #70 5855437928; Canonical 5855435365): the graph read's `not_modelled`, exactly as read, beside the
       * `graph_hash` of that same read. Derived by the read route, never here; never on the answer row; absent when the
       * read had none. A sidecar, like `_agent` below: `OlumiResponseSchema` is `.strict()`, and the UI parser
       * (DGAI `src/v5/responseParser.ts`) moves an undeclared root key into `__additive__` — no schemas release.
       */
      ...(notModelledCarrier !== undefined ? { _not_modelled: notModelledCarrier } : {}),
      /**
       * ⭐ S-D (lane EDIT-PANEL; design §4): every proposal this answer row holds, with what it assumes — each editable
       * field and whose its value is — what data it is missing, and its exact card. A sidecar like `_not_modelled`
       * (`OlumiResponseSchema` is `.strict()`; the UI parser moves an undeclared root key into `__additive__`), bound to
       * this response's `graph_hash`. Absent when nothing is held.
       */
      ...((): Record<string, unknown> => { const w = proposalFieldsWire(heldRecords, graphHash, issuedTurnIds,
        heldRecordsApplyAt([...reconciledPending, ...liveHolds], readbackGraph, graphHash)); return w !== undefined ? { _proposal_fields: w } : {}; })(),
      /**
       * ⭐ RT-1: which selected elements this answer was given, route-v2's `_grounded_selection` shape (DGAI
       * `GroundedOnNotice` reads it). A sidecar like `_not_modelled`; absent when nothing was selected or the turn never
       * reached the Agent with it.
       */
      ...(selectionContext !== null && selectionContext !== undefined ? { _grounded_selection: selectionContext.grounded } : {}),
      /**
       * ⭐ B5 (DL 5859845823): the run's per-limit verdicts, `{per_limit, joint}`, as a SIDECAR root key, the A7 pattern
       * above: spread after the finalised body, undeclared in 0.60, moved into `__additive__` by the UI parser (DGAI
       * #2212 reads `__additive__.limit_verdicts`). Bound to the run it describes: the graph read takes it off the SAME
       * fact, under the SAME gates, as the `analysis_result` this turn carries. Absent = not attested.
       */
      ...(limitVerdicts !== undefined ? { limit_verdicts: limitVerdicts } : {}),
      /**
       * ⭐ 0.63.0 (DL 5883197828; Canvas 5887080467): the run's STORED goal certainty as a SIDECAR root key, the B5
       * pattern above. A user-clicked Run reaches the UI on this TURN (the cold read applies only at boot/reload), so the
       * turn carries the SAME array the cold read's `analysis_goal_certainty` does: the graph read takes it off the SAME
       * fact, under the SAME gates, as this turn's `analysis_result`. Never recomputed here. Absent = not recorded.
       */
      ...(goalCertainty !== undefined ? { goal_certainty: goalCertainty } : {}),
      /**
       * ⭐ 52f8cd (DL 5924731600; PANEL 5924723004): the Olumi options the Run left out of the comparison, and why, as a
       * SIDECAR root key (the `goal_certainty` pattern; DGAI `storedOptionParticipation.ts` reads it). Without it the UI
       * said "The analysis returned no result for this option" over an option CEE left out on purpose. `[]` = recorded,
       * nothing left out; absent = not recorded.
       */
      ...(optionParticipation !== undefined ? { option_participation: optionParticipation } : {}),
      /**
       * ⭐ IDENTITY-EXACT (DGAI #2774): the identities this Run's engine evaluated, the final read's
       * `analysis_identity_evaluated_node_ids` (same fact, same gates as `analysis_result`), as a SIDECAR root key (the
       * `option_participation` pattern). A Run press reaches the UI on this turn, so an evaluated identity's operand links
       * read "Exact: …" at once, not only after a reload. `[]` = recorded, none evaluated; absent = not attested.
       */
      ...(identityEvaluated !== undefined ? { identity_evaluated_node_ids: [...identityEvaluated] } : {}),
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
        // BYPASS1: who wrote the reply as the route read it ('ai' → host prose for facts the AI has stopped); the served
        // witness counts host-deleted sentences, double asks and reply length by it.
        reply_author: hostProse ? 'host' as const : 'ai' as const,
        /**
         * C6 (ChatGPT #70 5857276235 item 4: measurement on served turns before any optimisation). The loop's own split
         * (model, tools, model time inside tools, residual overhead) plus the whole route, so a served turn says where its
         * time went. Diagnostic only: nothing reads it.
         */
        timing: {
          ...result.timing,
          route_total_ms: Date.now() - startedAt,
          dispatches: dispatchLedger,
          dispatch_ms: dispatchLedger.reduce((a, d) => a + d.ms, 0),
        },
        /** X5 (DESIGN Q3): why the one construction retry ran (issue classes) and what became of it. Diagnostic only. */
        ...(constructionTrace !== undefined ? { construction: constructionTrace } : {}),
        write_claims_removed: narration.stripped.length,
        ...(leaderClaimEnforced ? { leader_claim_enforced: true } : {}),
        /** The run-turn coaching card: shown, or the typed reason it is not (for staging witnesses). */
        coaching: runCoaching.eligibility,
        /** C4: the run-turn card's typed move, and the limit caveats said once instead of shown (signal ids). */
        ...(runCoaching.scienceBrief !== null
          ? { coaching_next_move: runCoaching.nextMove?.kind ?? null, coaching_caveats: runCoaching.caveats.map((c) => c.block.signal_id) }
          : {}),
        /**
         * ⭐ WHAT THE AUTOMATIC FIRST ANALYSIS DID, for witnesses: ran, or why not, how long it took,
         * and the (construction, revision) identity it was bound to. Absent when no construction
         * committed on this turn.
         */
        ...(firstAnalysis !== undefined
          ? {
            first_analysis: {
              ran: firstAnalysis.outcome.ran,
              narrator_skipped: firstAnalysisResultFirst,
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
        ...(coreSdk !== undefined ? { sdk: coreSdk } : {}),
        tool_calls: result.tool_calls,
        mutated: result.mutated,
        hops: result.hops,
        stopped_reason: result.stopped_reason,
        // An unnamed turn that carried an offer reports its durability too; its minted id is no retry key, so it is not echoed.
        ...(turnId !== undefined ? { turn_id: turnId, durability } : rowTurnId !== undefined ? { durability } : {}),
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
        // ⭐ CONSENT PROVENANCE (DL-3 ruling A): each write made on the user's typed approval, read by Olumi, with their words.
        ...((): Record<string, unknown> => {
          const typed = result.tool_calls.flatMap((c, i) => {
            const a = (result.tool_results[i] as { approval?: { kind?: unknown; words?: unknown } } | undefined)?.approval;
            return c.name === 'authorise_change' && c.mutated && a?.kind === TYPED_APPROVAL_READ_BY_OLUMI && typeof a.words === 'string'
              ? [{ proposal_id: c.proposal_id ?? null, approval: TYPED_APPROVAL_READ_BY_OLUMI, words: a.words }] : [];
          });
          return typed.length > 0 ? { typed_approvals: typed } : {};
        })(),
        // ⭐ AX2: the reply shows two of the build's open questions; the whole list, in the producer's order, is here.
        ...(() => {
          const at = result.tool_calls.findIndex((c) => c.name === 'build_model_from_brief');
          // EBD (DL, 12 Oct): a question the reply already said before its status line is not restated in the toggle list.
          // S6: on the AI's reply the AI decides what to ask, so no host questions list rides beside it.
          const qs = (at >= 0 && hostProse ? openQuestionsForReply(result.tool_results[at] as Parameters<typeof openQuestionsForReply>[0]) : [])
            .filter((q) => !saidBeforeStatus.includes(q));
          return qs.length > 0 ? { open_questions: qs } : {};
        })(),
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
          || (stateFacts.links_resized ?? []).length > 0
          || stateFacts.current_state_unknown === true
          ? { state_facts: stateFacts }
          : {}),
        // ⭐ AX1 (DL #70 5850280205: "a typed `break_even` state fact"): the arithmetic the paragraph above says, as
        // data — every figure, whose it is, and the target line — so a surface or a rewording never re-derives it.
        ...(breakEven !== null ? { break_even: breakEven } : {}),
        // ⭐ C5: the Agent's provisional view — ONLY here, typed, with its heading; never in `assistant_text` (see above).
        ...(provisionalViewShown !== null ? { provisional_view: provisionalViewShown } : {}),
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
  const agentTurnWithActiveRun = async (req: FastifyRequest, reply: FastifyReply) => {
    let activeKey: string | undefined;
    try {
      return await agentTurnHandler(req, reply, key => {
        if (activeRunTurns.has(key)) return false;
        activeRunTurns.add(key); activeKey = key;
        return true;
      });
    } finally {
      // Includes a thrown/aborted reply: a later retry can read durable proof and recover again.
      if (activeKey !== undefined) activeRunTurns.delete(activeKey);
    }
  };
  app.post('/agent/v1/turn', { config: { scenarioId: { from: 'body', key: 'scenario_id' } } }, (req: FastifyRequest, reply: FastifyReply) =>
    runWithProviderPolicy({ ...OPENAI_ONLY('agent_v1_turn'), request_id: String(req.id),
      scenario_id: (req.body as { scenario_id?: string })?.scenario_id, turn_id: (req.body as { turn_id?: string })?.turn_id }, () => agentTurnWithActiveRun(req, reply))
      // The recovery seam's interruption ends the turn like a crash: no answer row, nothing retried here.
      .catch((err: unknown) => {
        if (!(err instanceof RecoveryFaultInterrupt)) throw err;
        log.warn({ event: 'v5.recovery_fault.interrupted', request_id: String(req.id), point: err.point }, 'agent-lane: turn interrupted by the recovery fault seam');
        return reply.code(503).send({ error: 'RECOVERY_FAULT_INJECTED', point: err.point });
      }));

  log.info({ event: 'agent_lane.route_mounted' }, 'POST /agent/v1/turn mounted');
}
