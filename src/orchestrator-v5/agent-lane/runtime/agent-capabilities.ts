import { goalLevelReadingWords } from '../../goal-target/goal-level-reading.js';
import { verbatimSourceLine } from '../quote-confirmation.js';
import { runOmittedRisks } from '../unsized-risk.js';
import { compareAnalysisRunFactIdentity } from '../../context/analysis-interpretation-identity.js';
import { nextStepBlockerForAgent } from '../next-step-blocker.js';
import { plainWords } from '../../goal-target/hiring-times.js';
import { readGoalRecord } from '../../goal-target/goal-record.js';
import { statementOrigin, UNKNOWN_ORIGIN_DETAIL } from './statement-origin.js';
import { linkBandSource, quoteIsNotTheUsersClaim } from '../../goal-target/input-claim-context.js';
import { buildTurnAlreadyOfferedDeadline, deadlineCardToIssue, firstAgentTurnAfterDraft, moreThanOneAnswerSinceDraft, sentenceHolding, type DeadlineIssueInput, type DeadlineTurnStart } from '../deadline-card.js';
import { ZERO_SPREAD_NEEDS_MONTHLY_CHANGES } from '../../goal-target/zero-spread-horizon-line.js';
import { heldGoalHorizonMonths } from '../../goal-target/goal-horizon-verdict.js';
import { isCalendarDate, applyGoalHorizonEdit, goalHorizonPostimageIsScoped, goalHorizonLandedWriteIsScoped } from '../../goal-target/goal-horizon-write.js';
import { runFactsOf } from '../run-facts.js';
import { userStatementsOn } from '../../statement-door/statements.js';
import { recordedMeasureOf } from '../../statement-door/fields/measure.js';
import { answeredBasisOf, applyGoalReadingEdit, goalReadingProjectionOf, goalReadingRecordedWords, goalReadingWords } from '../../goal-target/goal-reading-write.js';
import { applyRiskOccurrenceEdit, olumiOccurrenceBlock, riskOccurrenceCardWords, riskOccurrenceGoalHolds,
  riskOccurrenceRecordedWords, riskOccurrenceSubject, SET_RISK_OCCURRENCE_OP,
  riskOccurrencePostimageNode, type ApprovedRiskOccurrence } from '../risk-occurrence.js';
import { asMemberOp, doorAsks, doorCardOf, doorOperation, doorRowOf, typedDoorStatement, type DoorCard } from '../../statement-door/door.js';
import { optionCapacityRecordedWords } from '../../statement-door/fields/option-capacity.js';
import { readStatement, type DoorContext } from '../../statement-door/read.js';
import { doorRowFor } from '../../statement-door/role-table.js';
import { resolveSubject } from '../../statement-door/subject.js';
import { DOOR_PROPOSED_NOTE, doorCardWords } from '../../statement-door/card.js';
import { RECORD_STATEMENT_OP } from '../../statement-door/write.js';
/** What binds a user's statement to one subject beside their words: their canvas selection, Olumi's preceding question, its asks. */
const doorContextOf = (ctx: AgentToolContext, graph?: unknown): DoorContext => ({ ...(ctx.grounded_selection !== undefined ? { selection: ctx.grounded_selection } : {}),
  ...(ctx.preceding_assistant_text !== undefined ? { preceding_ask: ctx.preceding_assistant_text } : {}),
  ...(graph !== undefined ? { asks: doorAsks(graph) } : {}) });
/** A user's own statement about a risk goes through the ONE statement door, never `propose_assumptions` (SYSTEM 1 M1). */
const doorStatementDetail = (label: string): string => `The user made their own statement about the risk ‘${label.trim()}’. Record it with `
  + `propose_statement (subject: kind risk, label ‘${label.trim()}’, field occurrence for a chance of it happening with the time span they gave, `
  + 'or holds_now for a condition they say is already true now), quoting their complete words. Nothing was prepared.';
import { userStatementOf, verifyStatements } from '../user-statements.js';
import { optionStatedLinkEffect } from '../link-effect-option-statement.js';
import { findLinkEffectAmounts } from '../link-effect-figures.js';
/**
 * The binder's misses the option reading answers (served hiring negative r3): the clause split at a colon, an article that
 * counts the option's noun rather than the label's, a source change the clause counts as one. Every other miss (which link,
 * an unclear or level figure, a figure of another quantity) stands.
 */
const OPTION_READS_PAST: ReadonlySet<string> = new Set(['not_one_statement', 'figure_counts_another_unit', 'figures_not_in_statement']);
/** ⛔ Wrong author (served hiring 14 Oct): Olumi's claim, reported, framed, disputed or disowned, is never the user's figure. */
const NOT_THE_USERS_CLAIM = 'Nothing was prepared: these words report, dispute or disown Olumi\u2019s estimate, so they are not the user\u2019s own figure. '
  + 'Ask the user for their own figure, in their words.';
import type { EventRiskV1T } from '../../../schemas/event-risk.js';
import { CONFIRM_GOAL_READING_OP, heldChangeTargetAnswer, savedGoalMeaningOf } from '../../goal-target/held-change-target.js';
import { heldTeamTimeStatements, quotedTeamTime, readTeamTime, teamTimeArgumentsMatch, teamTimeFromStatements, teamTimeCard, teamTimeConfirmationCard, teamTimeIsHeld, teamTimeReadDigest, teamSharePostimageIsScoped, withAssumedTeamRange, type ApprovedTeamTime } from '../../goal-target/team-share-write.js';
import { deliverableWrittenIn, draftedTeamPartOf, eventModelAsk, isEventShareForecast } from '../../goal-target/event-by-date-model.js';
import { capacityPartsOf, heldStatementsOf, hiringTimesCard, hiringTimesHeld, hiringTimesStillApply, hiringTimesSummaryOf, HIRING_TIMES_USE, olumiEstimateOf,
  planStarts, quoteStatedFor, withHiringTimes, type ApprovedHiringTimes, type PlannedOption } from '../../goal-target/hiring-times.js';
import { optionCapacityChangeHeld, optionCapacityChangeStillApplies, withOptionCapacityChange, SET_OPTION_CAPACITY_CHANGE_OP,
  type ApprovedOptionCapacityChange } from '../../goal-target/option-capacity-change.js';
import { goalOutOfReachFact, outOfReachWhyOf } from '../out-of-reach-why.js';
import { readNewLimit, limitFigure, hasLimitQuantity, hasPercentageCrossing, limitApprovalWords, NO_LIMIT_QUANTITY, type NewLimitValue } from '../stated-limit.js';
import { readUnitParts } from '../same-unit.js';
/**
 * Agent lane — the capabilities, each delegating to an existing Olumi path.
 *
 * ⭐ NOTHING HERE OWNS A RULE. Canonical truth, admissibility, authorisation,
 * CAS, idempotency, persistence and analysis all stay where they already live;
 * these functions carry a request to them and report what came back. Writes and
 * analysis go through the SAME `/orchestrate/v2/turn` the product uses, via an
 * internal dispatch, so the Agent cannot reach a shortcut the UI does not have.
 *
 * ⛔ A MUTATION IS CONFIRMED FROM STATE, NEVER FROM A STATUS CODE. Observed on
 * 22 Sep: a tool that returned success on HTTP 200 made the Agent tell the user
 * "Added: …" while CEE had honestly refused with "I couldn't record that
 * properly, so I haven't changed the model." Every mutating capability below
 * re-reads the model afterwards and reports what the model actually shows.
 */

import { useAppendV6 } from '../../append-v6-flag.js';
import { withDrawnLinkAdoption } from '../drawn-link-adoption-context.js';
import { HELD_RISK_CAUSE_NOTE, HELD_RISK_WINDOW_NOTE } from '../held-risk-notes.js';
import { parseDrawnLinkPress } from '../drawn-link-press.js';
import { isFactorNamedByUser, readStatedEventRisk, readStatedLikelihoodWithoutWindow, GM_HELD_USER_EVENT_RISK_KEY } from '../../routing/stated-event-risk.js';
import { chatRiskPreconditionFor } from '../../routing/chat-risk-precondition.js';
import { endsOfGraph, heldLinkOf } from '../../goal-target/held-user-links.js';
import { goalChanceWithheldForAgent, identityAskLineFor, SAY_SHOWN_NOTE, type GoalChanceWithheld } from '../goal-chance-withheld.js';
import { guidedSizingProgressLine } from '../guided-sizing.js';
import { runExplanationKeyForRecord } from '../run-explanation.js';
import { hasGoalCertaintyCandidates, goalCertaintyForAgent, type GoalCertaintyRead } from '../goal-certainty-for-agent.js';
import { readStoredGoalCertainty } from '../../tools/handlers/run-goal-certainty.js';
import { runOptionSetForCopy, readStoredOptionParticipation, type RecordedRunOptionSet, type StoredOptionParticipation } from '../../tools/handlers/option-participation.js';
import { addedFactorsReceipt, type AddedFactorPart } from '../added-factors-receipt.js';
import { reframedNodeIds } from '../refit-frames.js';
import { acceptedOlumiEstimateSentence, rerunRecordForModel } from '../rerun-explanation.js';
import { rerunPairReadForRunDelta } from '../rerun-within-band.js';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseUnmodelledMechanisms, parseOptionGapsOfLevelOps, optionGapsHeld, optionGapOperands, optionGapOperandsAreEmpty, optionGapApprovalWords, applyOptionGapDeclarations } from '../unmodelled-mechanisms.js';
import { SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS } from '../../tools/handlers/set-factor-value.js';
import { AGENT_ADD_OPTION_CHIP_ID, AGENT_RUN_ANALYSIS_CHIP_ID } from '../../handlers/agent-chip-ids.js';
import { runWithUserNamedOptions, type StatedTodayLevel } from '../../handlers/add-option-authorship-context.js';
import {
  buildAddOptionsTransaction,
  GM_HELD_GRADED_TODAY_KEY,
  GM_HELD_SWITCH_FACTORS_KEY,
  MAX_OPTIONS_PER_TRANSACTION,
  NEW_SWITCH_TODAY,
  readGradedTodayMember,
} from '../../routing/add-option-transaction.js';
import { GM_HELD_HANDLER_ID, GM_HELD_OPERATIONS_MAX_JSON_CHARS, gmHeldProposalRef } from '../../handlers/edit-graph-referee-gate.js';
import { TYPED_TRANSACTION_ENVELOPE_CAP } from '../../graph-management/types.js';
import { resolveProposalRenderCopy } from '../../compose/proposed-change.js';
import { definitionalLinkInUse, definitionalLinkRefusalText, type IdentityRunUse } from '../../compose/definitional-links.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectEndUnits, linkEffectReadingToken, statedInOneOf, linkEffectTargetOf, POINTS_STATED, withLabelCountUnits, withLinkEffectUnitReadings, linkEffectMediatorReadings, linkEffectGaugeStatement, type LinkEffectLabelReading, type LinkEffectMediatorReading, type LinkEffectRefusal, type LinkEffectReversal } from '../../system-events/link-effect-edit.js';
import { mediatorReadings } from '../mediator-reading.js';
import { prepareLinkEffectUnitReadings, withPointsAtZero, type LinkEffectUnitReading } from '../../system-events/link-effect-unit-reading.js';
import { applyIdentityConfirmEdit, identityConfirmReadingToken, identityPartLevelAsk, identityPartsWithoutLevel } from '../../system-events/identity-confirm-edit.js';
import { identityConfirmBaseIsWritable } from '../../system-events/editable-graph.js';
import { goalStockAccumulationOf } from '../../goal-target/goal-horizon-detail.js';
import { ceilingStockRecorded } from '../ceiling-stock.js';
import { identityReadingWithinTimeClass } from '../identity-reading.js';
import { timeClassOf } from '../../goal-target/time-class.js';
import { identityReceiptWords, proposeProductIdentity, type IdentityPartLevel, type IdentityProposal } from '../identity-proposal.js';
import { CONFIRM_IDENTITY_OP, heldChangeBlocksIdentity, identityCardHintFor, identityReadingOf, identityRefusalWords, readingOfIdentityApproval } from '../identity-card.js';
import { canonicaliseUnitForDisplay, ratePeriodOf, ratePeriodWord, unitComparisonKey } from '../../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import { buildFactorScaleMap, resolveRawInterventionValue } from '../../tools/plot-intervention-scale.js';
import { mergeInterventionSourceObjects } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { isPendingActionExpired, type PendingAction } from '../../session/pending-action.js';
import type { StatedObjection } from '../../context/stated-objections.js';

/**
 * The durable operation identity for authorising a proposal.
 *
 * ⛔ IT MUST BE A v4-SHAPED UUID. Measured against the real
 * `SystemEventTurnPayloadSchema`: `turn_id` is regex-constrained, and a
 * readable key like `agent_authorise:<proposal_id>` is refused at ingress with
 * `INGRESS_CONTRACT_VIOLATION` before any handler runs. My first version used
 * exactly that readable form; the unit tests passed because the mock dispatch
 * does not validate the payload, and only posting it at the real boundary
 * showed all four calls refused.
 *
 * So this is a NAME-BASED uuid wearing a v4 costume: SHA-256 of the proposal
 * id with the version and variant nibbles forced. It is deterministic — the
 * same proposal always yields the same key, which is the whole point — and it
 * satisfies the wire. The trade is legibility in the turn log for a stable
 * idempotency key, and the stable key is what the replay arm needs.
 */

/** A value whose unit is another kind than its factor's (a price as churn): left out, and the Agent says why. */
const UNIT_MISMATCH_NOTE =
  'Left out because the figure is in a different kind of unit from the factor (for example a price given for a rate). '
  + 'Never record a figure the user gave for something else as this factor\u2019s value; ask for its own figure if needed.';

/** A "%" figure of 1 or less for a 0–1 share factor: 0.5% or 50%? Nothing proposed; the user is asked (`relative-figure.ts`). */
const SCALE_AMBIGUOUS_NOTE =
  'Nothing was proposed for these: the figure was given in percent for a factor measured as a share from 0 to 1, and a figure '
  + 'of 1 or less could mean either reading (0.5% is 0.005; 0.5 as a share is 50%). Ask the user which they mean, quoting both.';

/** A figure compared the other way from what the factor measures (`relative-figure.ts`, AIQ 5907227964 B). */
const DIRECTION_CONFLICT_NOTE =
  'Nothing was proposed for these: the user compared the figure the other way from what the factor measures (for example '
  + '"AWS costs 25% more" against a GCP saving, which would be 20%, not 25%), or against the factor\u2019s own subject. Ask the '
  + 'user which figure they mean for the factor; never convert it yourself, and never record the written figure as it.';

/** What the Agent says about a level it marked as the user's that the user never wrote (`stated-by-user.ts`). */
const NOT_THE_USERS_FIGURE_NOTE =
  'The user did not write these figures, so they are proposed as Olumi\u2019s estimates, not as the user\u2019s own. '
  + 'Say so plainly; never call a figure the user\u2019s unless they wrote it.';

/** A level in a different unit is left out before its authorship is read. */
export const UNIT_DIFFERS_FROM_DECLARED_DETAIL = (option: string, declaredUnit: string, sentUnit: string): string =>
  `Send ${option}'s figure exactly as the user wrote it, in ${declaredUnit} (the factor's unit); it was sent in ${sentUnit}. Nothing was changed.`;

/** Compare only units the existing readers recognise; descriptive model units keep the base behaviour. */
function recognisedLevelUnitKey(unit: string | undefined): string | undefined {
  const display = canonicaliseUnitForDisplay(unit);
  if (display === undefined) return undefined;
  // The closed period table owns both recognition and singular/plural equality.
  if (ratePeriodWord(display) !== null) return unitComparisonKey(display);
  const reading = readUnit(display);
  if (reading.kind !== 'plain') {
    // The amount reader owns currency scale and percent aliases; never convert the figure.
    return JSON.stringify({ kind: reading.kind, code: reading.currencyCode, scale: reading.multiplier });
  }
  if (unitPhraseTail(display) === '' && unitPhraseFamily(display) !== null) return unitComparisonKey(display);
  const period = ratePeriodOf(display);
  const head = unitPhraseHead(display);
  // A recognised numerator and a closed period, with no descriptive words left over.
  if (period !== null && head !== null && unitComparisonKey(display) === `${unitComparisonKey(head)}/${period}`) {
    const numerator = recognisedLevelUnitKey(head);
    return numerator === undefined ? undefined : `${numerator}/${period}`;
  }
  return undefined;
}

/** What the Agent says about a keep proposal (52f8cd, lease #75 5925744661): the figure is unchanged and stays Olumi's. */
const KEEP_NOTE =
  'This keeps Olumi\u2019s current figure exactly as it is and, once the user approves, records that they accepted it. It stays '
  + 'Olumi\u2019s estimate: never call it the user\u2019s own figure or a measurement, and never say it changed. Show the figure '
  + 'and ask them to approve; until they do, nothing is recorded.';

/** Why a figure was not offered for keeping: only Olumi's own estimate can be accepted (`heldFigureOwner`). */
const NOT_KEEPABLE_NOTE =
  'These were not offered for keeping. `yours`: it is already the user\u2019s own figure. `brief`: it came from the user\u2019s '
  + 'brief. `already_accepted`: the user has already accepted Olumi\u2019s estimate. `no_figure`: the factor holds no figure '
  + 'to keep. `not_exact`: Olumi could not record it without changing the figure, so it was left as it is. Say which applies '
  + 'in plain words; never offer a card for them.';

/** Why a level the user never wrote is left unset (`stated-by-user.ts`). */
const notWrittenReason = (value: number, factor: string): string =>
  `${value} is not a figure the user gave for ${factor}, so this change leaves that level unset. Say plainly it has no level yet, `
  + `and ask for ${factor}\u2019s figure only if the user wants to set it. Never send 0 or any placeholder to mean "not set": leave level out.`;

/** What the Agent is told to say about a named input that cannot hold a value. */
/** AIE packet 6e52e896 `event_risk.risk_occurrence_note`, byte for byte: a risk root that can take Olumi's range, named without one. */
const RISK_OCCURRENCE_NEEDED_NOTE = 'These risks have no held occurrence likelihood. If the event and listed window are clear and supported, propose one through the available propose_assumptions tool with that risk alone, user_stated false, a grounded basis, and occurrence_range: the low and high chance, in percent, that it happens at least once within within_months. Nothing was proposed for these risks in this call. If event meaning or window is unresolved, preserve its source and clarify only that missing part.';
/** AIE packet 6e52e896 `event_risk.card_note`, byte for byte: what the Agent is told beside the card. */
/** AIE 6179240850 item 5, exact: Olumi's range is never offered for a risk whose chance the user has just given in their own words. */
const RISK_OCCURRENCE_USERS_OWN_DETAIL = 'The user has supplied a risk estimate, so no replacement Olumi estimate was prepared. Reuse their complete verified statement with its actual point or range form, event binding, qualifiers, reference, window and conditions through the existing statement/card path. Do not reduce a range to a point or ask them to repeat retained information. If the binding or current writer is unsupported, explain that exact gap and preserve the original estimate; no numeric write or new chance has been licensed.';
const RISK_OCCURRENCE_PROPOSED_NOTE = 'Show the card exactly as public_label. It proposes Olumi’s estimated occurrence likelihood within the stated window, not a human figure or a measurement. It stays Olumi’s after approval. Occurrence, the effect relationship’s existence, and its effect size remain distinct; its effect size is still Olumi’s placeholder. Only the bound approval button applies the shown change; it does not Run the model.';
/** AIE packet 6e52e896 `event_risk.mixed_refusal`, byte for byte. */
const RISK_OCCURRENCE_ALONE_DETAIL = 'Olumi’s starting assumption for a risk needs its own approval. Nothing was proposed: propose the risk alone in one call, and any other values in another.';
/** AIE packet 6e52e896 `event_risk.unknown_save`, byte for byte: the unknown outcome (no recorded / not-recorded inference). */
const RISK_OCCURRENCE_UNKNOWN_SAVE = 'The save could not be confirmed. Check the current model before retrying.';

const NOT_A_FACTOR_NOTE =
  'These were named but are not factors (for example a risk), so no starting value can be set on them and they are ' +
  'NOT in this proposal. Tell the user plainly, before they approve, that each was left out and why; describe its ' +
  'effect through the factors it acts on instead. Never present the starting point as complete while any is listed here.';

/** E5: the hiring-times op (its union member and `record.ts` entry are EBD's one-writer edits to `proposal.ts`; DL, 12 Oct). */
const SET_HIRING_TIMES: StructuredProposal['operations'][number]['op'] = 'set_hiring_times';
const SET_OPTION_CAPACITY_CHANGE: StructuredProposal['operations'][number]['op'] = SET_OPTION_CAPACITY_CHANGE_OP;
/**
 * E5: the applied hiring-times card's follow-up. ⛔ `follow_up` IS WHAT THE USER READS (reply-face P1, as #3153): the user's
 * sentence only. The direction for the Agent is `HIRING_TIMES_NOTE`. A committed change runs the analysis itself: never ask for a Run.
 */
const HIRING_TIMES_APPLIED = "These hiring assumptions are saved, with your inputs and Olumi's estimates distinguished.";
/** For the Agent only, on a committed change (the automatic Run then follows when readiness admits it). */
const HIRING_TIMES_NOTE = 'The analysis runs on the saved model; speak only to its result, and state no chance before it returns.';

/** The approval-facing disclosure of what was left out (empty when nothing was). */
function leftOutClause(notAFactor: readonly { label: string; kind: string }[]): string {
  if (notAFactor.length === 0) return '';
  return ` (left out, not a factor so it cannot hold a value: ${notAFactor.map((n) => `${n.label} — a ${n.kind}`).join('; ')})`;
}

export function authorisationTurnId(proposalId: string): string {
  const h = createHash('sha256').update(`agent_authorise:${proposalId}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/**
 * ⭐ THE RECEIPT A WRITE PRODUCED, read with the estate's own parser.
 *
 * ⛔ MEASURED GAP: the agent lane read `model_version_receipt` in 0 non-test
 * files, against 6 elsewhere in the estate. So even when a signed-in authorise
 * minted a version, `authorise_change` dropped the receipt — the Agent could not
 * say "saved as version 7", and a retry could not hand back what the first
 * authorisation produced.
 *
 * Returns the compact summary only. The receipt also carries the entire
 * committed `graph`, which must never ride into a tool result that is
 * stringified back into the model's context.
 *
 * A receipt that is PRESENT but fails the strict schema is reported, not
 * swallowed and not thrown: the write happened, the user's turn must not
 * crash, and nobody should read "no receipt" when one arrived malformed.
 */
export function receiptSummaryOf(json: unknown): { summary: ReceiptSummary | null; unreadable: boolean } {
  try {
    const r = modelVersionMutationReceiptFromResponse(json);
    if (r === null) return { summary: null, unreadable: false };
    return {
      summary: { version: r.sequence, version_id: r.version_id, mutation_id: r.mutation_id, source_turn_id: r.source_turn_id },
      unreadable: false,
    };
  } catch {
    return { summary: null, unreadable: true };
  }
}

import { OLUMI_SUGGESTION_NOT_ADOPTABLE, planNewFactors, planNewOption, type NewFactorRequest } from '../propose-new-option.js';
import { createProposal, computeProposalId, ProposalStore, type ProposalInterpretation, type ProposalOperation, type ReceiptSummary, type StructuredProposal } from '../proposal.js';
import { modelVersionMutationReceiptFromResponse } from '../../model-management/mutation-receipt.js';
import type { CommitLimitAddInput, CommitLimitEditInput, CommitLimitEditResult, CommitOptionLevelsInput, CommitOptionLevelsResult, CommitOptionStatusInput, CommitOptionStatusResult, HoldAddFactorInput, HoldAddFactorResult, HoldAddRiskInput, HoldAddRiskResult } from '../../system-events/dispatch.js';
import { buildAddRiskTransaction } from '../../routing/add-risk-transaction.js';
import { readReliesOnRisk, reliesOnRefereeOperations, reliesOnRiskLine } from '../../routing/relies-on-risk.js';
import type { PatchOperation } from '../../../orchestrator/types.js';
import { preconditionRiskIds } from '../../../graph/inert-risk.js';
import { buildAddFactorTransaction, GM_HELD_USER_TODAY_KEY, isNewFactorTarget, isStatedLevelRange, isUserStatedRange, levelRangePointBasis, MAX_FACTORS_PER_ADD, readUserTodayMember, USER_TODAY_QUOTE_MAX, USER_TODAY_SOURCE, type UserTodayBasis } from '../../routing/add-factor-transaction.js';
import { findStatedAmounts, readUnit, readCurrencyUnitWithQualifiers } from '../../../cee/provenance/stated-amounts.js';
import { confirmEdgeWrite, describeOutcome } from '../confirm-write.js';
import { statusQuoOptionId, structuralFacts } from '../structural-facts.js';
import { readinessViewOf, withoutCantRunOpening } from '../readiness-view.js';
import { pickGoalThresholdTrio } from '../../../utils/goal-threshold-trio.js';
import { type InfluenceBand } from '../../format/influence-bands.js';
import { CANVAS_BAND_WORD, edgeBandFromMagnitude, edgeBandStd, EDGE_STRENGTH_MIDPOINTS } from '../../format/edge-strength-bands.js';
import { edgeStrengthWords } from '../../format/edge-strength-words.js';
import { runWithApprovedAdoption } from '../approved-adoption-context.js';
import { runWithStatedLinkBand } from '../stated-link-band-context.js';
import { isRepairAuthoredOptionFactorEdge } from '../../../graph/repair-authored-edge.js';
import { factorUnitOf, unitPhraseFamily, unitPhraseHead, unitPhraseTail, unitsConflict } from '../unit-conflict.js';
import { inShareFrame, isShareFactor, relativeFigureAgainst } from '../relative-figure.js';
import { newFactorScopeIn } from '../figure-scope.js';
import { classifyUnitScaleClass } from '../../../cee/draft/records/unit-scale-class.js';
import { unitFamilyOf } from '../../routing/value-unit-resolution.js';
import { isCurrencyUnit } from '../../../utils/currency-alphabet.js';
import { countedNoun } from '../counted-nouns.js';
import { analysisResultForAgent } from '../decision-sensitivity.js';
import { runExplanationContextFacts, savedRunContextFacts, type SavedRunContextFactsRead } from '../saved-run-context-facts.js';
import { selectedRunDeltaForModel, SELECTED_RUN_DELTA_DEADLINE_MS } from '../selected-run-delta-for-model.js';
import type { RunDelta } from '@talchain/schemas/boundary';
import { optionNameAliases } from '../option-name-truth.js';
import { deadlineCardSubjectOf, deadlineSubjectHolds, heldCardStillApplies } from '../proposal-object/still-applies.js';
import { bandTheUserWrote, comparatorTheUserWrote, comparatorTheUserWroteFor, contradictsItsName, directionTheWordsSay, factorTheUserNamed, figuresWrittenIn, figureTheUserWrote, figureTheUserWroteFor, figureTheUserWroteForSpan, holdsABandWord, linkEffectFigureNotAChange, linkEffectQuoteContextMiss, linkEffectTheUserStated, ownUnitsOf, quoteOfFigure, quoteSpansIn, sameWord, saysNoChange, statingSentenceOf, wordsOf, wordsTheUserWrote, type EntityScope } from '../stated-by-user.js';
import { derivedSplitOf, partUnit, statedTotalsOf } from '../derived-split.js';
import { KEEP_PROPOSAL_BASIS, isKeepProposal, figureInUserUnits, linkEffectReadingOf, linkEffectReadingsOf, readingOfLinkEffectApproval } from '../approval-chips.js';
import { formatEdgeStrengthConfirmed, formatValueWithUnit } from '../../tools/handlers/d1-shared/format-confirmation.js';
import { ADD_CONSTRAINT_USER_GUIDANCE, SUCCESS_TARGET_POSITIVE_USER_GUIDANCE } from '../../tools/handlers/d1-shared/user-guidance.js';

import { proposedFrameForLevels, levelOnFinalFrame, preserveSiblingQuantities, SIBLING_LEVEL_UNRESOLVABLE, SIBLING_LEVEL_UNRESOLVABLE_SENTENCE, type ReencodedSibling } from '../level-batch-frame.js';
import { defaultFrameFor, framedObservedState, nonlinearIdentityForAgent, readEvaluatedIdentityNodeIds } from '../admit-model.js';
import { LIMIT_OPERATOR_WORDS, statedOperatorOf } from '../admit-constraint.js';
import { meetsLimit } from '../limit-operator-words.js';
import { levelLimitNodeDecision, thresholdOnNodeLevel } from '../../tools/handlers/level-limit-baseline.js';
import { isRetainedExcluded } from '../../tools/handlers/run-analysis-participation-guard.js';
import { runWithStatedGoalOperator } from '../stated-goal-operator-context.js';
import { chanceGoalDeadlineAsk, goalDeadlineFromRecord, goalKindOf } from '../../goal-target/goal-kind.js';
import { lastWeekdayNamedIn, readStatedDeadline, readStatedWeekdayDate, sayDate, sayDeadlineFromToday, todayInLondon, weekdayDatedIn, type Weekday, type StatedDeadline } from '../../goal-target/deadline-date.js';
import { draftReferenceDate } from '../../goal-target/draft-reference.js';
import { readHeldGoalComparator } from '../../goal-target/goal-direction.js';
import { goalChancePointForAgent, nearestFiveGoalChancesForAgent } from '../../goal-target/goal-chance-licence.js';
import { goalChanceFactsForAgent, goalChanceNeedsGraphLabels, runHasGoalChanceLicenceRecord } from '../../goal-target/goal-chance-range-agent.js';
import { groupedGoalPathLinks } from '../../compose/grouped-link-sizing.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN } from '../../compose/analysis-state-v1.js';
import { RISK_LINKS_RULE, type AgentCapabilities, type AgentToolContext, type ToolResult } from './agent-tools.js';
import { isRevisionConflict } from '../../graph-revision-conflict.js';
import { buildModelFromBrief, constructionOperationId, REVISED_DRAFT_MORE_LINKS, findConstructionVersion, type CallStructuredModel, type ConstructionContext, type ConstructionTrace } from './build-model.js';
import { goalTargetBasisOf, launchWindowOf, periodWords } from '../../goal-target/goal-target-basis.js';
import { applyCohortForecastEdit, applyStatementRecordEdit, approvedCohortForecastOf, approvedStatementRecordOf, cohortForecastRecordedWords,
  SET_COHORT_FORECAST_OP, SET_STATEMENT_RECORD_OP, storedTargetRowsOf, type ApprovedCohortForecast } from '../../goal-target/cohort-forecast-write.js';
import { runPreparingDraftReplacement } from './draft-replacement-context.js';
import { canonicalLabel } from '../model-primitives.js';
import { approvedGraphHeld, carryHumanItems, humanItemsAfterTheDraft, laterWritesThan, limitsKeptBy, messagesBesidesTheBrief, revisedDraftBrief, targetsHeldBy, type HumanItem } from './draft-replacement.js';
import type { CommittedTurnLedger } from '../../session/store.js';
import { buildWithDrafterRawRecord } from '../../drafter-raw/index.js';
import { claimPermissionsFrom, describeFirstAnalysisForAgent, type FirstAnalysisInput, type FirstAnalysisOutcome } from '../first-analysis.js';
import { limitChecksForAgent, LIMIT_CHECKS_NOTE } from '../limit-checks.js';
import { readLimitVerdicts, type StoredLimitVerdicts } from '../../../orchestrator/context/constraint-feasibility.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { howStronglyWords } from '../strength-authorship-words.js';
import { productHoldRecord } from '../proposal-object/record.js';
import { amendHeldOperations, proposalEditsDigest, type UserEdit } from '../proposal-object/amend.js';
import { PLAIN_APPROVAL_SUPERSEDED } from '../proposal-object/reply.js';
import { holdsByDefinition, nodeUnitOf } from '../../../orchestrator/context/placeholder-parts.js';
import { isUnadoptedOlumiSuggestion, optionStatusConfirmationText, optionStatusHolds, PARTICIPATION_FOR_STATUS } from '../../system-events/option-status-edit.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { linkedFactorsOf } from '../../routing/option-effect-write.js';
import { applyGoalCurrentLevel, isGoalCurrentLevelProposal, proposeGoalCurrentLevel, statedGoalLevelInUsersWords, writtenIn } from '../goal-current-level.js';
import { keptFigureFor } from '../kept-figure.js';
import { sayFigureExactly, sayFigureRead, sayFigureWithoutRounding } from '../say-figure.js';
import { authorshipOf, heldFigureOwnerOf, isHumanStatementSource, linkDrawnByOf, provenanceOf, settingDisplayOf, settingProvenanceOf, whoseOf } from '../../../cee/provenance/provenance-of.js';
import { isPercentScaledUnit } from '../../../cee/draft/records/projector.js';
import { DRAWN_LINK_ESTIMATE_CONFLICT_MESSAGE, PARTIAL_WRITE_MESSAGES, partialRangeLevelsWarning, quoteLabelForUser, type NotSavedValue } from '../write-outcome.js';
import { isChangeFrame, sayGoalChange, sayLimitInFrame } from '../limit-frame.js';
import { runOutcomeOf } from '../run-outcome.js';
import { checkProvisionalView, type LeaderStanding } from '../provisional-view.js';
import type { KnownObservedStateSourceLiteral } from '@talchain/schemas';
import { groupResizedLinks, type ResizedLinksGroup } from '../../../cee/magnitude/frame-defaulted-links.js';
import { approvalSizes, isAcceptedOlumiSize, linkSizing, sizedByApproval, type LinkSizing } from '../../../cee/magnitude/link-sizing.js';
import { mentionsLabel, REPLACE_KEEPS_DIRECTION_TEXT, replaceClauseOf, userFigureHeld, userFigureHeldRefusalText, userFigureReplacedReceipt } from '../../../cee/magnitude/user-figure-held.js';
import { notModelledContext, notModelledOfRead } from '../not-modelled-carrier.js';
import type { NotModelledManifest } from '../../../cee/context-integrity/not-modelled-manifest.js';
import { FRACTION_SPELLED_UNIT } from '../../coaching/bound-graph.js';
import { edgeReviewedByUser } from '../../../cee/graph-readiness/obligation-provenance.js';

/**
 * Whose figure: the labels it is FOR, and every other QUANTITY's label (`figureTheUserWroteFor`). Options and the
 * decision are not quantities a figure measures, and their names reuse the factors' nouns.
 */
/** The node ids the graph's limits name (`goal_constraints[].node_id`), for `structuralFacts`' limit-branch sink. */
function limitNodeIdsOf(raw: unknown): string[] {
  const rows = (raw as { goal_constraints?: unknown } | null | undefined)?.goal_constraints;
  return (Array.isArray(rows) ? rows : []).flatMap((c) => {
    const id = (c as { node_id?: unknown } | null)?.node_id;
    return typeof id === 'string' ? [id] : [];
  });
}

/**
 * ⭐ E1 (AIQ words #75 5924376899, opener 5924492553): the user's own level figure, left out of the target card because it could not be bound
 * to the goal. DGAI's producer opener ("Not included in this proposal: "), the user's verbatim span, and the rivals the
 * strict door found — the other labels holding the goal's words that sit in the figure's own sentence (≤3, most shared
 * first). No question (the card is the turn's one step), and never "recorded" of the level.
 */
function levelNotIncludedLine(
  g: { readonly nodes: readonly { readonly label?: unknown; readonly kind?: unknown }[] },
  goalLabel: string,
  inWords: { readonly raw: number; readonly quote: string | null },
  sameStatement: boolean,
  userText: string | null | undefined,
): string {
  const span = writtenIn(userText ?? '', inWords.raw)?.written ?? String(inWords.raw);
  // The pure negation (AIQ 5924492553): never "the level you gave" — the Agent may have read the wrong amount (£180k in the bank).
  const opener = `Not included in this proposal: "${span}" as today's level of "${goalLabel}".`;
  const close = 'so it isn’t recorded. Approving sets only the target.';
  // Written apart from the target, and about the goal: not a rival question (PROMPT STRIKE words, for AIQ to rule).
  if (!sameStatement) return `${opener} It isn’t written in the same sentence as the target, ${close}`;
  const inClause = wordsOf(inWords.quote ?? '');
  const goalWords = wordsOf(goalLabel).filter((w) => inClause.some((c) => sameWord(c, w)));
  const shared = (label: string): number => wordsOf(label).filter((w) => goalWords.some((t) => sameWord(t, w))).length;
  const rivals = scopeIn(g, goalLabel).others.filter((l) => shared(l) > 0).sort((a, b) => shared(b) - shared(a)).slice(0, 3);
  return `${opener} It could belong to more than one figure in this model${rivals.length > 0 ? ` (${rivals.map((r) => `"${r}"`).join(', ')})` : ''}, ${close}`;
}

/**
 * ⭐ A STRENGTH IS SAID AS ITS BAND WORD, NEVER AS OLUMI'S INTERNAL NUMBER (AIQ #75 5923931082; DL 5923941128 — served
 * `train-0258Z/05-adopt-propose`: "Moderate (0.3)", "down from strong (0.5)", "Numbers are internal 0–1 strengths").
 * A model-scale number means nothing to the user and invites "0.3 = 30%". The link-strength cards, results and notes
 * carry the band only; the stored number is the writer's business. A tool note is prompt, so the note says so.
 */
const BAND_WORDS_ONLY = 'Say each strength as its band word only (such as "moderate"), never a number or a scale.';
/** An empty proposal is the Agent's own call: the user is told what the model holds, never about the call (AIQ 5923931082). */
const EMPTY_PROPOSAL_WORDS = ' Never tell the user about this call or that it was refused; say plainly what the model already holds.';

function scopeIn(g: { readonly nodes: readonly { readonly label?: unknown; readonly kind?: unknown }[] }, ...target: string[]): EntityScope {
  const others = g.nodes
    .filter((n) => n.kind !== 'option' && n.kind !== 'decision')
    .map((n) => (typeof n.label === 'string' ? n.label : ''))
    .filter((l) => l !== '' && !target.includes(l));
  return { target, others };
}

// `newFactorScopeIn` moved to `../figure-scope.ts` (one predicate for the Agent's doors and the chat writers, AIQ 5882852814).
export { newFactorScopeIn };
/** Exported for the no-dead-end rows only: the words a refused link-effect card gives the Agent. */
export { linkEffectRefusalWords, linkEffectConsent, linkEffectNoSuchLinkWords };

/**
 * The LIMIT door's scope (DL #2195 CHANGES_REQUIRED 5863720934, served journey-C budget limits): the user calls a limit
 * a "limit" ("change the budget limit to £30,000"), so that word is the limit's own; and a RISK is no quantity a limit's
 * figure measures, so its label ("Budget overrun risk") makes no claim on the figure. Every other quantity still does:
 * "300 Pro paying subscribers" is never a £300 limit on the price.
 */
export function limitScopeIn(g: { readonly nodes: readonly { readonly label?: unknown; readonly kind?: unknown }[] }, limitLabel: string): EntityScope {
  const risks = new Set(g.nodes.filter((n) => n.kind === 'risk').map((n) => (typeof n.label === 'string' ? n.label : '')));
  const { target, others } = scopeIn(g, limitLabel);
  return { target: [...target, 'limit'], others: others.filter((l) => !risks.has(l)) };
}

/** `goal_chance` beside a run's result when the run withheld the goal's chance (PLoT #416); nothing otherwise. */
/** The confirm card's hint, when a Run's stored model holds one not yet offered on this revision (`../identity-card.ts`). */
function withIdentityCard(hint: { readonly available: true; readonly note: string } | undefined): { identity_card?: { readonly available: true; readonly note: string } } {
  return hint === undefined ? {} : { identity_card: hint };
}

/**
 * `sayShown`: only the build's first pass and a Run, whose reply the host ends with `say` (SAY-SHOWN, `SAY_SHOWN_NOTE`), and
 * never where the identity ask owns that cause (`identity_ask_say` or the confirm card: the route then says the ask instead).
 * Nor for a `say` that asks (Codex #3018 r1, served d4): the reply's one composer makes its question the ask (on the face)
 * and its reason detail, and the never-re-ask egress drops a question already asked, so it is never shown as one line.
 * The AIE's rule: the note goes only where the same bound line survives final egress (packet 6e52e896).
 */
function withGoalChance(result: unknown, graph?: unknown, sayShown = false): { goal_chance?: GoalChanceWithheld } {
  const withheld = goalChanceWithheldForAgent(result, graph);
  if (withheld === undefined) return {};
  return { goal_chance: sayShown && !withheld.say.includes('?') ? { ...withheld, say_shown: SAY_SHOWN_NOTE } : withheld };
}

/** A raw graph-read body as the goal-certainty rule reads it: the same fields `readGraph` keeps. */
function certaintyReadOf(json: Record<string, unknown>): GoalCertaintyRead {
  const stored = readStoredGoalCertainty(json.analysis_goal_certainty);
  return {
    raw: json.graph,
    analysis_state: json.analysis_state,
    analysis_result: json.analysis_result,
    ...(stored !== undefined ? { goal_certainty: stored } : {}),
  };
}

/**
 * ⛔ C46 (d) — THE AGENT IS TOLD WHEN THE LEADER RESTS ON A PRODUCT THE ANALYSIS ONLY ADDS UP.
 *
 * `claim_permissions` is the Agent's only view of the leader permission. A C46 reason the wire carries
 * (`nonlinear_identity_sign_unproven`) must not reach it as an unknown code, and — AI Quality option (i),
 * #70 5842615260 — while a limit or the unrequested first pass holds the `withheld_reason` field, the
 * product cause is still TRUE and still said: it rides beside that reason as `nonlinear_identity`, with
 * its plain-English sentence (goal and factors named; no direction, no figure, no option).
 *
 * REMOVE-ONLY: it can set `leader_may_be_named` false, never true, and it leaves `withheld_reason` as the
 * wire published it, so the limit card's cause and this one both stand. Schema-free: `claim_permissions`
 * is the Agent's internal view, never a wire member.
 *
 * `evaluated` (C46 × R3-4, Canonical criterion 1): the carriers the run's engine evaluated, from the SAME graph read
 * the permission was read beside (`analysis_identity_evaluated_node_ids`). A product the engine computed is not one it
 * "adds up", so the sentence is not said of it. Omitted ⇒ today's reading. It removes a cause, never the withhold.
 */
export function withNonlinearIdentity(permissions: unknown, graph: unknown, evaluated?: ReadonlySet<string>): unknown {
  const p = (permissions ?? {}) as { withheld_reason?: unknown };
  const finding = nonlinearIdentityForAgent(graph, p.withheld_reason === WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN, evaluated);
  if (finding === null) return permissions;
  return {
    ...(permissions as Record<string, unknown>),
    leader_may_be_named: false,
    nonlinear_identity: {
      reason: WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN,
      say: finding.sentence,
      note: 'Say this sentence to the user as a reason no option is put forward on this model yet, beside any other '
        + 'reason given here. Do not name a leading option, a direction or a win percentage for this goal.',
    },
  };
}

/**
 * ⭐ DID *THIS* `factor_value_edit` COMMIT A WRITE? Read from its OWN response only.
 *
 * What the served `/orchestrate/v2/turn` system-event response carries, derived at
 * `route-v2.ts` (the `ingress.kind === 'system_event'` branch) and
 * `system-events/dispatch.ts` (`dispatchFactorValueEdit`):
 *
 *   · COMMITTED → HTTP 200, `blocks: [{ type: 'graph_patch', status: 'applied',
 *     operation: 'set_factor_value', target_id, before, after }]`, `graph_hash` (the
 *     commit's own persisted hash), `draft_graph`, and a `model_version_receipt` only
 *     when a version was minted. A guest never gets one (`append_turn_atomic_v5`:
 *     `v_should_create := v_user_id IS NOT NULL AND …`, else `'model_version_receipt',
 *     NULL`); it is also flag-dependent and the one `DEGRADABLE_EGRESS_FIELD`.
 *   · REFUSED → ALSO HTTP 200. The refusal is committed as a turn with no graph
 *     (`commitPerformed: true, graph: null`), so the body is `blocks: []`, no
 *     `graph_hash`, no receipt, and copy such as "…so I haven't changed anything."
 *   · COMMIT FAILED → 500 (`system_event_commit_failed`).
 *   · REPLAY / REUSED ID → 200, but `commit.ts` rewrites the patch to `status: 'noop'`
 *     ("nothing was written") and strips the receipt on a reused id.
 *   · VALUE ALREADY HELD → 200, the handler's own fact says `status: 'noop'`.
 *
 * So the one per-operation proof a guest's write carries is the `graph_patch` block
 * with `status: 'applied'` for THIS target. It is built from this request's own
 * handler fact and returned only on this request's response, so ANOTHER writer cannot
 * produce it: their commits move the graph and its hash, which is exactly why neither
 * the hash nor a read-back of the target is evidence of anything we did.
 */
function valueWriteCommittedByThisRequest(
  res: { status: number; json: Record<string, unknown> },
  targetId: string,
): boolean {
  if (res.status !== 200) return false;
  const blocks: unknown[] = Array.isArray(res.json.blocks) ? res.json.blocks : [];
  return blocks.some((b) => {
    if (b === null || typeof b !== 'object') return false;
    const p = b as { type?: unknown; operation?: unknown; target_id?: unknown; status?: unknown };
    return p.type === 'graph_patch' && p.operation === 'set_factor_value' && p.target_id === targetId && p.status === 'applied';
  });
}

/**
 * The native figure THIS request's own committed write stored for `targetId` — from its own
 * `graph_patch.after` (the handler fact of this request; another writer cannot produce it).
 * `undefined` when the response carries no usable snapshot.
 */
function ownCommittedNative(res: { status: number; json: Record<string, unknown> }, targetId: string): number | undefined {
  if (!valueWriteCommittedByThisRequest(res, targetId)) return undefined;
  const blocks: unknown[] = Array.isArray(res.json.blocks) ? res.json.blocks : [];
  const patch = blocks.find((b) => {
    const p = (b ?? {}) as { type?: unknown; target_id?: unknown; status?: unknown };
    return p.type === 'graph_patch' && p.target_id === targetId && p.status === 'applied';
  }) as { after?: unknown } | undefined;
  const a = (patch?.after ?? {}) as { value?: unknown; raw_value?: unknown; cap?: unknown };
  if (typeof a.raw_value === 'number') return a.raw_value;
  if (typeof a.value === 'number') return typeof a.cap === 'number' && a.cap > 0 ? a.value * a.cap : a.value;
  return undefined;
}

/**
 * The level THIS request's own committed `option_intervention_edit` stored for (option, factor), from
 * the committed post-state its OWN response carries (`draft_graph`; `system-events/dispatch.ts`), or
 * `undefined` when the response carries none.
 */
/**
 * ⛔ "THE SAME FIGURE" IS DECIDED EXACTLY WHEREVER NO ARITHMETIC SEPARATES THE TWO (pre-reviews of #1881, 5828080522 and
 * 5828293137). Any tolerance proportional to magnitude has a £1 boundary somewhere: 1e-6 hid £1,001 on £1.2bn, 1e-9 hid
 * £1 there, and 1e-12 hides £1 on £1.2tn. So two STORED figures — our committed level and the level read back in the
 * same range, or two native values — are compared with `===`. Only across a range change, where the product itself
 * multiplied and divided, is float noise allowed, and then only a few units in the last place of the larger figure
 * (~£0.002 at £1.2tn): the real rounding of those few steps, never a band a person's entry could fall inside.
 */
function sameAfterScaling(a: number, b: number): boolean {
  return a === b || Math.abs(a - b) <= 8 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
}
/** A figure for the Agent to quote: float noise removed (54.00000000000001 → 54); 15 significant digits is every digit a double carries. */
function quotable(x: number): number {
  return Number(x.toPrecision(15));
}

/**
 * ⛔ THIS WRITE COMMITTED, THEN THE MODEL MOVED ON — "COULD NOT BE CONFIRMED", NEVER "NOT SAVED" (round-2 review of
 * fix/agent-never-shows-instructions-or-codes, blocker 2's class). Called only once the read-back does NOT hold the
 * change. Proof that THIS write committed comes only from its own response: its committed post-state (`draft_graph`,
 * which a refused edit omits) holds the change, or it reports a revision other than the approved one AND the model has
 * since moved past that revision. A refusal answers 200 with the revision it found, unmoved, and no post-state — so it
 * stays "Not saved". Used by every `authoriseChange` branch that decides landed-ness from the read-back.
 */
function committedThenMoved(
  res: { status: number; json: Record<string, unknown> },
  approvedRevision: string,
  after: { graph_hash: string } | null,
  committedPostStateHolds: (draft: { edges?: unknown }) => boolean,
): boolean {
  if (res.status !== 200 || after === null) return false;
  const draft = res.json.draft_graph;
  if (draft !== null && typeof draft === 'object' && committedPostStateHolds(draft as { edges?: unknown })) return true;
  const reported = typeof res.json.graph_hash === 'string' ? res.json.graph_hash : '';
  return reported !== '' && approvedRevision !== '' && reported !== approvedRevision && after.graph_hash !== '' && after.graph_hash !== reported;
}

/**
 * A link band as the user reads it: the canvas's lowest pill says "Slight", never the enum's `weak`. Served joined run
 * (Canvas #70, UI cd6a82e4 + CEE 5f941f2): the receipt the user read was "Recorded … as weak (0.1 …)" beside a Slight pill.
 * Every preview, public label (and so the "Recorded" receipt) and note that names a link's band uses this word.
 */
// ONE authority for the word (R&C #2023 review): the shared map beside the band table, never a second copy here.
const linkBandWord = (band: InfluenceBand): string => CANVAS_BAND_WORD[band];

/** Marks a compound starting point, so a newer one can replace it before approval. */
const STARTING_POINT_BASIS = 'a starting point \u2014 values and what each option sets \u2014 for the user to adopt or correct in one approval';

/**
 * What the Agent says about a new SWITCH before approval (Canonical #70 5854919806 item 1; AIQ 5854838919): off today is
 * Olumi's reading of the option, recorded and shown as Olumi's estimate, and the user can correct it — so it is said,
 * never asked as if unknown, and never presented as the user's.
 */
const NEW_SWITCH_NOTE = 'This change also ADDS these factors as switches the option turns on. Say so: what each changes and which way, '
  + 'that how strongly is Olumi\u2019s estimate, and that Olumi takes each as OFF today (not in place yet) and ON under the option. '
  + 'Say that off-today is Olumi\u2019s reading, for the user to correct if it is already partly in place; do not ask for its value today.';

/**
 * Which parts of a refused new-switch level were not a bare 1 — names only, never the figure — so a served run shows
 * what the model sent (`_agent.tool_calls[].conflict_fields`; OpenAI Runtime #70 5859406197 item 3).
 */
type SwitchConflictField = 'unit' | 'non_number' | 'not_one' | 'estimate' | 'not_object';

/**
 * ⛔ A SWITCH HAS NO LEVEL OF ITS OWN (independent verification of A1, round 2). The option's level on a new switch is
 * exactly 1 — ON — and nothing else, so the only level the Agent may give it is one that MEANS on (below). Anything else
 * carries a figure the switch cannot keep: a unit on a 1 (£1/month, 1%, 1 hire — a 1 in a unit is an amount, never
 * "on"), a number other than 1 (as the user's figure or as Olumi's estimate), a value that is not a number ("0.5",
 * "50%"), an estimate with no figure, or a level that is not an object at all. Taken as on, the figure would be dropped
 * without a word and today-0 written as Olumi's, so each is a conflict: refused, nothing sent. No level (absent, null, or
 * one that carries nothing) is on.
 *
 * ⭐ `{ value: 1, estimate: true }` IS ON (OpenAI Runtime #70 5859406197): refusing it left journey A's add-two-options
 * NOT DONE in 3/3 served runs — refused, retried with a level, refused again. The option turns the switch on whoever's
 * word the 1 is, and the switch's today-0 stays Olumi's own stamp (`stampNewSwitchFactors`), so nothing is dropped.
 *
 * ⭐ A LEVEL THAT MEANS ON IS ON (MG; served DL run pj-20260927T233309Z on e09b8c2, A05 "grandfather existing
 * customers": SIX refusals, then hop_limit). `switchFigureMeansOn`: a bare 1, `true`, or EXACTLY 100 in a percent-class
 * unit (all of them — `classifyUnitScaleClass`, never a word list). None drops a figure: each says the one thing a switch
 * can be. {1, '%'} stays refused — it is a user's 1% (VERIFIER-S1) — as does every other share, amount or rate.
 * Returns the conflict's parts to show and the fields that fired, or `null` when the level is on.
 */
function newSwitchLevelConflict(level: unknown): { value: unknown; unit?: unknown; estimate?: unknown; fields: SwitchConflictField[] } | null {
  if (level === undefined || level === null) return null;
  if (typeof level !== 'object' || Array.isArray(level)) return { value: level, fields: ['not_object'] };
  const { value, unit, estimate } = level as { value?: unknown; unit?: unknown; estimate?: unknown };
  const hasValue = value !== undefined && value !== null;
  const hasUnit = unit !== undefined && unit !== null && !(typeof unit === 'string' && unit.trim() === '');
  const hasEstimate = estimate !== undefined && estimate !== null && estimate !== false;
  // No figure (and no unit), or a figure that means on.
  const on = hasValue ? switchFigureMeansOn(value, unit) : !hasUnit;
  // On, as the user's word or as Olumi's estimate (`estimate: true`) of a figure that means on.
  if (on && (!hasEstimate || (estimate === true && hasValue))) return null;
  const fields: SwitchConflictField[] = [
    ...(hasUnit && !on ? ['unit' as const] : []),
    ...(hasValue && typeof value !== 'number' && value !== true ? ['non_number' as const] : []),
    ...(typeof value === 'number' && value !== 1 && !on ? ['not_one' as const] : []),
    ...(hasEstimate ? ['estimate' as const] : []),
  ];
  return { value, ...(hasUnit ? { unit } : {}), ...(hasEstimate ? { estimate } : {}), fields };
}

/**
 * ⭐ A 1 IN A UNIT THAT IS NO QUANTITY IS ON (MG, switch-loop step 2; #2194's `rejected_levels`, served `a8cffcf`, OpenAI):
 * the grandfather switch was refused at `{1, unit: "enabled", estimate: true}` (MG pj-20260928T040509Z A05) and at
 * `{1, unit: "binary"}` (DL pj-20260928T040536Z A07) — two runs, two different ON words, so no word list: the test is
 * inverted (DL #72 5863189058). A unit is a QUANTITY — and a 1 in it an amount the switch cannot keep, refused as before
 * (1%, £1, 1 hire, 1 per month: VERIFIER-S1) — when anything in it reads as one: a percent-class unit
 * (`classifyUnitScaleClass`), a digit or a currency/percent sign, or any token the estate's unit classifier knows
 * (`unitFamilyOf`: currency, percent, time, metric, count) or names as a currency (`isCurrencyUnit`). Anything else
 * ("enabled", "binary", "on", "boolean") names the switch's STATE, not an amount: its 1 is on, its 0 is off.
 */
function unitReadsAsQuantity(unit: string): boolean {
  if (classifyUnitScaleClass(unit) !== 'unknown') return true;
  const read = withoutStateGlossary(unit);
  if (/[\d%£$€¥₹]/u.test(read)) return true;
  return read.split(/[\s/,;:()[\]{}"'-]+/u).some((t) => t !== '' && tokenReadsAsQuantity(t));
}
const tokenReadsAsQuantity = (t: string): boolean => unitFamilyOf(t) !== null || isCurrencyUnit(t) || countedNoun(t);

/**
 * ⭐ A UNIT'S OWN STATE GLOSSARY IS NO AMOUNT (MG, switch-loop step 4; DL #72 5864154474, served pj-20260928T053022Z A06
 * on a94fcb9): `{1, unit: "binary (0=no, 1=yes)", estimate: true}` was refused ×4 — the digit test above read the
 * glossary's own 0 and 1 as a figure — and the reply then gave the option up. A 0 or a 1 bound to a word by "=" or ":"
 * ("0=no", "1 = on", "yes=1") names a STATE, when that word itself reads as no quantity (`tokenReadsAsQuantity`, the
 * same inverted test): each such pair is set aside before the unit is read. Any other digit still reads as a figure
 * ("1 hire (0=no, 1=yes)", "GBP (1=£1)", a code 2), and so does a pair whose word is a count ("1=customer").
 */
const STATE_GLOSSARY_PAIR = /(?<![\p{L}\p{N}.])(?:[01]\s*[=:]\s*(\p{L}+)|(\p{L}+)\s*[=:]\s*[01])(?![\p{L}\p{N}.])/gu;
/**
 * ⭐ A UNIT THAT NAMES ITS TWO STATES AS A PAIR IS NO AMOUNT (MG, switch-loop step 6; OpenAI Runtime #72 5867407187,
 * served g2224 run 2 A07–A08 on 9096610): `{1, unit: "enabled (0/1)", estimate: true}` was refused ×8 — the digit test
 * read the pair's own 0 and 1 as a figure. A 0 and a 1 standing together, joined by "/", "-", "–", "|", "..", "or" or
 * "to" (either order), are the switch's two states: set aside like a glossary pair. Every other digit still reads as a
 * figure ("0/12", "10/1", "0.5/1", "0/2"), and what is left is read by the same tests ("hires (0/1)", "GBP (0/1)").
 */
const STATE_RANGE_PAIR = /(?<![\p{L}\p{N}.,])(?:0\s*(?:\/|-|–|\||\.\.|or|to)\s*1|1\s*(?:\/|-|–|\||\.\.|or|to)\s*0)(?![\p{L}\p{N}.,])/gu;
function withoutStateGlossary(unit: string): string {
  return unit.replace(STATE_GLOSSARY_PAIR, (pair: string, after?: string, before?: string) =>
    (tokenReadsAsQuantity(after ?? before ?? '') ? pair : ' ')).replace(STATE_RANGE_PAIR, ' ');
}


/**
 * A switch figure that says ON: a bare 1 or `true` with no unit; a 1 or `true` in a unit that reads as no quantity
 * (`unitReadsAsQuantity`); or exactly 100 in a percent-class unit.
 */
function switchFigureMeansOn(value: unknown, unit: unknown): boolean {
  const hasUnit = unit !== undefined && unit !== null && !(typeof unit === 'string' && unit.trim() === '');
  if (!hasUnit) return value === 1 || value === true;
  if (typeof unit !== 'string') return false;
  if ((value === 1 || value === true) && !unitReadsAsQuantity(unit)) return true;
  return value === 100 && classifyUnitScaleClass(unit) === 'percent';
}

/**
 * ⭐ A NEW SWITCH LISTED AT EXACTLY 0 UNDER AN OPTION SAYS THAT OPTION LEAVES IT OFF (MG; served DL run
 * pj-20260928T011147Z on CEE 84440ff, journey A step A03 "add two options to compare": FIVE `propose_new_option` calls,
 * every one refused `switch_level_not_on` with `not_one`, ~23 s, then a 13 s clarification turn). One change carried two
 * options and ONE new switch; the Agent also listed the switch at 0 under the option that does NOT turn it on (inferred
 * from the served trace: the reply said the switch's "level must be omitted rather than set to zero" — the arguments are
 * not kept). A bare 0, or 0 in a percent-class unit (`classifyUnitScaleClass`, as `switchFigureMeansOn`), as the user's
 * word or Olumi's (`estimate: true`), and nothing else: 0 in any other unit, a string, or a malformed level stays a
 * conflict. The switch is off today (Olumi's today-0, `cee_inference`), so an option that leaves it at 0 does not act
 * on it at all: the entry is dropped — never linked, never set — but ONLY when another option in the same change turns
 * it on (`dropSwitchOffEntries`).
 */
function switchLevelMeansOff(level: unknown): boolean {
  if (level === null || typeof level !== 'object' || Array.isArray(level)) return false;
  const { value, unit, estimate } = level as { value?: unknown; unit?: unknown; estimate?: unknown };
  if (value !== 0) return false;
  if (estimate !== undefined && estimate !== null && typeof estimate !== 'boolean') return false;
  const hasUnit = unit !== undefined && unit !== null && !(typeof unit === 'string' && unit.trim() === '');
  // A 0 in a unit that names the switch's state ("binary", "enabled") is off, as its 1 is on (`unitReadsAsQuantity`).
  return !hasUnit || (typeof unit === 'string' && (classifyUnitScaleClass(unit) === 'percent' || !unitReadsAsQuantity(unit)));
}

/**
 * Drop each acts_on entry that lists a NEW switch at exactly 0 (`switchLevelMeansOff`) under an option, when ANOTHER option
 * in the same change turns that switch on (a level that means on, or none: `newSwitchLevelConflict` is null). PURE. Each
 * entry is resolved exactly as `planNewOption` resolves it — a factor the model has first, then a factor this change adds
 * — so a 0 on a factor the model already has is never touched. Only an option's ONE entry for the switch is dropped: an
 * option that also names it another way is two answers, refused as before. Where no option turns the switch on, nothing
 * is dropped: the 0 stays a `switch_level_not_on` conflict, and its refusal says to list it under the option that turns it on.
 */
type SwitchSpec = { readonly label: string; readonly acts_on: readonly { readonly factor_label?: unknown; readonly level?: unknown }[] };
type SwitchNodes = readonly { readonly kind?: string; readonly label?: string; readonly description?: string }[];
type SwitchNewFactors = readonly { readonly key: string; readonly label: string; readonly kind?: 'switch' }[];

/**
 * The NEW switch an acts_on label names, resolved exactly as `planNewOption` resolves it — a factor the model has first,
 * then a factor this change adds — so a label the model already has is never a new switch.
 */
function newSwitchNamer(nodes: SwitchNodes, newFactors: SwitchNewFactors): (label: unknown) => { key: string; label: string } | undefined {
  const n = (v: unknown): string => String(v ?? '').trim().toLowerCase();
  return (label) => {
    const wanted = n(label);
    if (wanted === '' || nodes.some((x) => x.kind === 'factor' && (n(x.label) === wanted || n(x.description) === wanted))) return undefined;
    return newFactors.find((f) => f.kind === 'switch' && n(f.label) === wanted);
  };
}

function dropSwitchOffEntries<S extends SwitchSpec>(
  specs: readonly S[],
  nodes: SwitchNodes,
  newFactors: SwitchNewFactors,
): { specs: S[]; dropped: { option: string; factor: string }[] } {
  const newSwitchNamed = newSwitchNamer(nodes, newFactors);
  const turnsOn = (spec: S, key: string): boolean =>
    spec.acts_on.some((a) => newSwitchNamed(a.factor_label)?.key === key && newSwitchLevelConflict(a.level) === null);
  const dropped: { option: string; factor: string }[] = [];
  const out = specs.map((spec, i) => ({
    ...spec,
    acts_on: spec.acts_on.filter((a) => {
      const sw = newSwitchNamed(a.factor_label);
      if (sw === undefined || !switchLevelMeansOff(a.level)) return true;
      // Only the option's ONE entry for the switch: two entries in one option are two answers (`duplicate_acts_on`, VERIFIER-S1).
      if (spec.acts_on.filter((x) => newSwitchNamed(x.factor_label)?.key === sw.key).length > 1) return true;
      if (!specs.some((other, j) => j !== i && turnsOn(other, sw.key))) return true;
      dropped.push({ option: spec.label.trim(), factor: sw.label });
      return false;
    }),
  }));
  return { specs: out, dropped };
}

/**
 * A level that says NOTHING but 0: `value` exactly 0, and `unit`, `estimate` and `basis` absent or empty (`estimate`
 * false) — every field its empty default, and no other key. Any unit, `estimate: true` or basis makes it a reading.
 */
function placeholderSwitchZero(level: unknown): boolean {
  if (level === null || typeof level !== 'object' || Array.isArray(level)) return false;
  const l = level as Record<string, unknown>;
  const blank = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  return l.value === 0 && Object.keys(l).every((k) => k === 'value' || k === 'unit' || k === 'estimate' || k === 'basis')
    && blank(l.unit) && (blank(l.estimate) || l.estimate === false) && blank(l.basis);
}

/**
 * ⭐ A PLACEHOLDER 0 ON THE ONE ENTRY THAT NAMES A NEW SWITCH IS NO LEVEL, WHERE "OFF" WOULD MAKE THE CHANGE MEAN NOTHING
 * (MG, switch-loop step 5; OpenAI Runtime #72 5865857191 / 5865861134). After step 3, 41 served journey-A turns on 16
 * builds still refused `switch_level_not_on` (`not_one`): 98 refusals, 25 turns proposing nothing, the model re-sending
 * byte-identical arguments whose level was `{value: 0, unit: "", estimate: false, basis: ""}`. MG's own gate on c35f1c7
 * (`rejected_levels`, 4 turns, 12 refusals): every one a bare 0 on the ONLY entry naming the switch, under the option that
 * turns it on — the grandfather switch in the one-option A07/A08, the retention switch under "Retention intervention for
 * at-risk accounts" (its only entry) in A03 — and the replies said it is "on under the option". The tool's own words
 * forbid the placeholder ("never 0 or any placeholder to mean 'not set'"), and a bare entry turns a switch on.
 *
 * So that 0 (`placeholderSwitchZero`) is read as NO level — on — only where "off" would be incoherent: the change adds ONE
 * option (off, the switch is added for nothing), or the switch is that option's ONLY entry (off, the option acts on
 * nothing). Said in the result (`switch_placeholder_levels_read_as_on`), and the approval shows the option turning it on.
 * Unchanged: a 0 that says more (a unit, `estimate: true`, a basis); a switch two entries name; and a 0 under an option
 * that also acts on something else in a change of several options, where "this option leaves it off" is a reading
 * (`dropSwitchOffEntries` drops it when another option turns the switch on; otherwise it is refused, as before). Runs
 * AFTER `dropSwitchOffEntries`, so a 0 another option answers is still dropped as off. PURE.
 */
function readPlaceholderSwitchZerosAsOn<S extends SwitchSpec>(
  specs: readonly S[],
  nodes: SwitchNodes,
  newFactors: SwitchNewFactors,
): { specs: S[]; read: { option: string; factor: string }[] } {
  const newSwitchNamed = newSwitchNamer(nodes, newFactors);
  const namings = (key: string): number =>
    specs.reduce((sum, spec) => sum + spec.acts_on.filter((a) => newSwitchNamed(a.factor_label)?.key === key).length, 0);
  const read: { option: string; factor: string }[] = [];
  const out = specs.map((spec) => ({
    ...spec,
    acts_on: spec.acts_on.map((a) => {
      const sw = newSwitchNamed(a.factor_label);
      if (sw === undefined || !placeholderSwitchZero(a.level) || namings(sw.key) !== 1) return a;
      if (specs.length !== 1 && spec.acts_on.length !== 1) return a;
      read.push({ option: spec.label.trim(), factor: sw.label });
      const { level: _placeholder, ...entry } = a;
      return entry as typeof a;
    }),
  }));
  return { specs: out, read };
}

/**
 * ⛔ A REFUSED SWITCH LEVEL IS FIXED IN ONE HOP (served A05, pj-20260927T233309Z: six refusals, hop_limit, ~20 s). The
 * detail names the exact next call — the same arguments with `level` removed from each refused acts_on entry (or, where
 * the switch is named more than once in an option, ONE entry with no level, so the next call is not refused as a
 * duplicate) — for EVERY refused entry at once. A figure that reads as a share or an amount (a number, not 0, that does
 * not mean on) may be what the user meant: then it also names the graded factor instead.
 *
 * ⛔ A 0 IS FIXED BY REMOVING THE ENTRY, NEVER ITS LEVEL (served A03, pj-20260928T011147Z: five refusals). A bare entry
 * for a switch means ON, so "remove level" from a 0 asks the Agent to turn on what it meant to leave off — it would not,
 * and looped. For a conflicting value of 0 the next call removes that option's WHOLE entry; and where no option in the
 * change turns the switch on (`turnedOnInChange`), it says so and names the one fix: list it under the option that turns
 * it on, and leave it out of the others.
 */
function switchLevelRefusalDetail(
  conflicts: readonly { option: string; factor: string; value: unknown; unit?: unknown; estimate?: unknown }[],
  entriesNaming: (option: string, factor: string) => number,
  turnedOnInChange: (factor: string) => boolean = () => true,
  /** How many options the change adds: the exact single-lister edit is named only for a ONE-option change. */
  optionCount?: number,
): string {
  const zero = (c: { value: unknown }): boolean => c.value === 0;
  const onNowhere = (c: { factor: string; value: unknown }): boolean => zero(c) && !turnedOnInChange(c.factor);
  const given = conflicts.map((c) => (zero(c)
    ? `"${c.option}" lists the new switch "${c.factor}" at ${shownSwitchLevel(c)}.`
    : `"${c.factor}" was added as a switch that "${c.option}" turns on, but it was given a level: ${shownSwitchLevel(c)}.`));
  const pairs = conflicts.filter((c, i) => conflicts.findIndex((d) => d.option === c.option && d.factor === c.factor) === i);
  /**
   * ⭐ ONE OPTION LISTS THE SWITCH, AT 0, AND NONE TURNS IT ON (served 137d3a5, MG pj-20260928T042134Z A07/A08: `{0}` four
   * times on the grandfather switch in the ONLY option, each reply saying it "must be recorded as on under this option").
   * "List it under the option that turns it on" read, in a one-option change, as the option it was already under, so
   * the same call came back. Here the next call is named exactly: that entry with NO "level" key — not 0. Only in a
   * ONE-option change: with two, a 0 under one of them may mean the OTHER turns it on, which the text above says.
   */
  const singleLister = (c: { option: string; factor: string; value: unknown }): boolean =>
    optionCount === 1 && onNowhere(c) && pairs.filter((d) => d.factor === c.factor).length === 1 && entriesNaming(c.option, c.factor) === 1;
  const edits = pairs.filter((c) => !onNowhere(c) || singleLister(c)).map((c) => (singleLister(c)
    ? `send the acts_on entry for "${c.factor}" in "${c.option}" with NO "level" key at all \u2014 not 0: 0 says off, and an entry with no level turns the switch on under that option (if "${c.option}" does not turn it on, remove that entry and "${c.factor}" from new_factors instead)`
    : entriesNaming(c.option, c.factor) > 1
    ? `keep ONE acts_on entry for "${c.factor}" in "${c.option}", with no "level"`
    : zero(c)
      ? `remove the whole acts_on entry for "${c.factor}" from "${c.option}" (not only its "level": a bare entry turns the switch on)`
      : `remove "level" from the acts_on entry for "${c.factor}" in "${c.option}"`));
  const unswitched = conflicts.filter((c) => onNowhere(c) && !singleLister(c)).map((c) => c.factor).filter((f, i, all) => all.indexOf(f) === i);
  const quantities = conflicts.filter((c) => typeof c.value === 'number' && Number.isFinite(c.value) && c.value !== 0 && !switchFigureMeansOn(c.value, c.unit));
  const graded = quantities.filter((c, i) => quantities.findIndex((d) => d.factor === c.factor) === i).map((c) =>
    ` If ${shownSwitchLevel({ value: c.value, unit: c.unit })} is the figure the user meant for "${c.factor}" (a share of the customers or an amount), `
    + `it is not a switch: declare "${c.factor}" as a graded factor instead \u2014 the same call with kind left out of its new_factors entry \u2014 `
    + 'and its level is set once it is added.');
  const why = conflicts.some((c) => !zero(c))
    ? ' A switch has no level of its own \u2014 it is off today and on under this option (a bare 1 or exactly 100% says the same) \u2014 '
      + 'so that figure would be dropped, and it is not taken as on.'
    : '';
  const off = conflicts.some(zero)
    ? ' A new switch is off today, and an option that lists it turns it on, so an option that leaves it off does not list it at all.'
    : '';
  const nowhere = unswitched.map((f) => ` No option in this change turns "${f}" on; list it under the option that turns it on, with no "level", `
    + `and leave it out of the others. If no option the user asked for turns it on, leave "${f}" out of new_factors too.`);
  // With no 0 among the conflicts, the words are exactly #2172's.
  const tell = conflicts.some(zero) ? 'Then tell the user it is on under the option that turns it on.' : 'Then tell the user it is on under this option.';
  const next = edits.length > 0
    ? ` NEXT CALL: call propose_new_option again with exactly the same arguments, except ${edits.join('; and ')}`
      + `${unswitched.length > 0 ? '; and list each switch no option turns on as said above' : ''}. ${tell}`
    : ` NEXT CALL: call propose_new_option again with exactly the same arguments, except each switch listed as said above. ${tell}`;
  return `${given.join(' ')}${why}${off}${nowhere.join('')} Nothing was prepared.${next}${graded.join('')}`;
}

/** A switch conflict's figure as the user would read it: `1 £/month`, `1%`, `"0.5"`, `2 (as Olumi's estimate)`. */
function shownSwitchLevel(c: { value: unknown; unit?: unknown; estimate?: unknown }): string {
  const figure = typeof c.value === 'number' ? String(c.value)
    : c.value === undefined || c.value === null ? 'no figure' : JSON.stringify(c.value) ?? String(c.value);
  const unit = c.unit === undefined ? '' : String(c.unit).trim() === '%' ? '%' : ` ${String(c.unit).trim()}`;
  return `${figure}${unit}${c.estimate !== undefined ? ' (as Olumi\u2019s estimate)' : ''}`;
}

/**
 * The `observed_state.source` an adopted Olumi assumption is stored with. Typed
 * against the shared contract's vocabulary, so it cannot drift to a literal the
 * product does not know. See `applyCompound` for why it exists.
 */
const ADOPTED_ASSUMPTION_SOURCE: KnownObservedStateSourceLiteral = 'user_assumption';

/**
 * ⛔ WHO AUTHORED THIS ONE VALUE — never inferred from the proposal as a whole (Codex
 * pre-review of #1851, 5825286731). One `propose_assumptions` proposal can hold a revision the
 * USER named (`revise:true`, their figure) beside a figure OLUMI suggested, and its proposal-wide
 * `authored_by` is `model_proposed` whenever any figure is Olumi's — so stamping from that one
 * field recorded the user's own number as an Olumi assumption. Each value op now records its own
 * author (inside the proposal's integrity hash, `computeProposalId`, so it cannot be edited
 * undetected). A USER-authored proposal is the user's in every value (only a proposal made
 * entirely of their figures claims `user_stated`), so an op can only move an Olumi proposal's
 * value TO the user, never the reverse. An op without the field — a carrier persisted before it
 * existed — takes the proposal's author.
 */
/**
 * ⛔ A VALUE THAT WAS NOT SAVED SAYS WHAT STILL STANDS (AIQ 5924015300; 52f8cd 5923996794, served `7686dc0` guest
 * `61a8c07c`). "Record your figure" → "Not saved: the starting value." left Paul believing his 3 a month was in the
 * model while the analysis still used Olumi's 5. Per value: the figure not saved and whose it is, and the figure the
 * model still holds with ITS owner, read from the stored node (the refused write changed nothing). The words are
 * `write-outcome.ts`'s.
 */
/**
 * WHOSE IS THE FIGURE THE MODEL HOLDS for this node — ONE rule for every sentence and gate that names an owner (the
 * not-saved words, and the `keep` door that only Olumi's own figure may pass). `undefined` when the node holds no figure.
 * Whose figure it is (AIQ 5924240860 (1)): a source that DEFERS (`brief_extraction`, `cee_inference`) is decided by its
 * `extractionType`, so a figure read from the user's brief is never said as Olumi's.
 */
export function heldFigureOwner(node: { observed_state?: unknown; extractionType?: unknown } | undefined): NonNullable<NotSavedValue['still']>['owner'] | undefined {
  // ⭐ ONE PROVENANCE AUTHORITY: the owner is `provenanceOf`'s (the extraction type on the figure itself decides for the
  // stamps that defer to it; an unestablished origin, or a human figure whose role is unverified, is `unverified_brief`).
  return heldFigureOwnerOf(node?.observed_state ?? undefined);
}

/** The receipt's words for whose an option's level is — `provenanceOf`'s answer for the cell (and the node it sets). */
export function optionLevelSourceWords(level: unknown, target: unknown): string {
  // A structural switch cell is not an estimate and has no recorded author (its words are unchanged).
  if (settingProvenanceOf(level, target).structural) return 'source not recorded';
  const display = settingDisplayOf(level, target);
  return display === 'ai_inferred' ? "Olumi's suggested estimate" : display === 'user_set' ? 'set by you'
    : display === 'from_brief' ? 'from your original brief' : 'source not recorded';
}

function valuesNotSaved(
  valueOps: readonly ProposalOperation[], parent: StructuredProposal, read: GraphRead | null, labelOf: (id: string) => string,
): NotSavedValue[] {
  return valueOps.map((o) => {
    const v = (o.value ?? {}) as { value?: unknown; unit?: unknown };
    const proposedUnit = typeof v.unit === 'string' ? v.unit : '';
    // The model could not be read after the refusal: the figure not saved is still named; what stands is NOT inferred.
    if (read === null) {
      return { label: labelOf(o.path), value: Number(v.value), unit: proposedUnit, yours: valueOpAuthor(o, parent) === 'user_stated', unconfirmed: true as const };
    }
    const node = read.nodes.find((n) => n.id === o.path);
    const os = (node?.observed_state ?? undefined) as Record<string, unknown> | undefined;
    const unit = typeof os?.unit === 'string' ? os.unit : '';
    // The figure the model holds, in the user's units (AIQ 5924240860 (2)): `nativeStartingValue` (raw, else value × cap);
    // a bare 0–1 share of a % factor with neither raw nor cap is said as a percentage (the one scale authority).
    const native = nativeStartingValue(os);
    const held = native !== undefined && typeof os?.raw_value !== 'number' && !(typeof os?.cap === 'number' && os.cap > 0)
      && isPercentScaledUnit(unit) && Math.abs(native) <= 1 ? native * 100 : native;
    const owner = heldFigureOwner(node);
    return {
      label: node?.label ?? labelOf(o.path), value: Number(v.value), unit: proposedUnit,
      yours: valueOpAuthor(o, parent) === 'user_stated',
      ...(held !== undefined && owner !== undefined ? { still: { value: held, unit, owner } } : {}),
    };
  });
}

/** S-D: snapshot the existing declared domain on the typed op, never invent a scale at Submit. */
function storedFactorDomain(raw: unknown): { cap?: number; declared_scale?: unknown } {
  if (!raw || typeof raw !== 'object') return {};
  const os = raw as { cap?: unknown; declared_scale?: unknown };
  return { ...(typeof os.cap === 'number' ? { cap: os.cap } : {}), ...(os.declared_scale !== undefined ? { declared_scale: os.declared_scale } : {}) };
}
function valueOpAuthor(op: ProposalOperation, proposal: StructuredProposal): 'model_proposed' | 'user_stated' {
  const own = ((op.value ?? {}) as { authored_by?: unknown }).authored_by;
  // ⭐ S-D slice 2: an approve-with-edits proposal (`basis: 'edited_from:<id>'`, `amend.ts`) keeps EACH value's own
  // author: only the values the user edited are theirs; every value they left stays Olumi's estimate. Every other
  // proposal keeps the original precedence unchanged (a proposal the user authored whole claims all its values).
  if ((proposal.provenance.basis ?? '').startsWith('edited_from:') && (own === 'user_stated' || own === 'model_proposed')) return own;
  if (proposal.provenance.authored_by === 'user_stated') return 'user_stated';
  return own === 'user_stated' ? 'user_stated' : 'model_proposed';
}

/**
 * ⛔ WHO AUTHORED THIS ONE LEVEL (RC #69 5830255884) — the same rule as `valueOpAuthor`, for an
 * option level. MEASURED on served `c1ddb50`: every level an approval wrote was stamped
 * `user_specified`, so Olumi's proposed levels read "Set by you". A level is the user's only
 * when the user gave it (`user_stated` on the proposal) or the whole proposal is theirs; an op
 * without the field (a carrier stored before it existed) is Olumi's — the narrower claim.
 */
function levelOpAuthor(op: ProposalOperation, proposal: StructuredProposal): 'model_proposed' | 'user_stated' {
  return valueOpAuthor(op, proposal);
}

/**
 * ⭐ THE FIGURE A LEVEL WAS READ FROM, KEPT ON ITS CELL (AI Conversation #70 5848429576; the door, #2024). A level on a
 * NEW factor with no range was stored as a bare 0.1: the user's "£10 per month" and the range it was read against were
 * gone. Carry every known native point to the final-frame seam, including capless figures and figures whose
 * proposal coordinate frame differs from the range this approval settles. The transaction re-encodes them together.
 */
/** A likely-range bound said in the level's own unit, exactly as the level itself is said. */
/**
 * ⭐ C2 (AIE 6180618773 row 2, DL ruling A): the user's range AS STATED, then the quartile fit as Olumi's disclosed assumption,
 * never as the user's own "middle half". The press adopts it ("Use this reading", AIE 6181498097).
 */
export const statedRangeAssumptionWords = (low: string, high: string): string =>
  `. Your range: ${low} to ${high}. Olumi's assumption: Olumi reads that range as about one chance in four below ${low} and one in four `
  + `above ${high}, so the analysis can use it. You did not say that; if you meant the lowest and highest possible, say so`;

function likelyBound(n: number, unit: string): string {
  return sayFigureExactly(n, unit) ?? `${n}${unit !== '' ? ' ' + unit : ''}`;
}

function levelFigureOf(op: ProposalOperation): { raw_value?: number; cap?: number; unit?: string; likely_range?: { low: number; high: number } } {
  const v = (op.value ?? {}) as { normalised?: unknown; raw?: unknown; cap?: unknown; derived_frame?: unknown; unit?: unknown; likely_range?: { low?: unknown; high?: unknown } };
  // TEMPORAL: the user's likely range rides with their figure (proposed only beside a level they gave).
  const r = v.likely_range;
  const likely = r !== undefined && typeof r.low === 'number' && typeof r.high === 'number' ? { low: r.low, high: r.high } : undefined;
  if (typeof v.normalised !== 'number' || typeof v.raw !== 'number' || !Number.isFinite(v.raw)) return {};
  const cap = v.cap ?? v.derived_frame;
  // A bare model-scale approval has no native figure to send to the writer.
  if (cap == null && v.raw === v.normalised && v.unit === undefined && likely === undefined) return {};
  return { raw_value: v.raw,
    ...(typeof cap === 'number' && Number.isFinite(cap) && cap > 0 ? { cap } : {}),
    ...(typeof v.unit === 'string' && v.unit.trim() !== '' ? { unit: v.unit.trim() } : {}),
    ...(likely !== undefined ? { likely_range: likely } : {}) };
}

/**
 * ⛔ WHAT THE APPROVAL STORED, SAID PER VALUE (Codex pre-review of #1851, 5825446207): the explanation
 * the Agent repeats must match the stamps `valueOpAuthor` decided. A mixed approval stores the user's
 * revision as theirs and Olumi's figure as the user's assumption; one sentence calling every value
 * "the user's adopted assumptions" collapsed the two authors the model now records.
 */
function valueAuthorshipNote(ops: readonly ProposalOperation[], proposal: StructuredProposal, labelOf: (id: string) => string): string {
  const values = ops.filter((o) => o.op === 'set_factor_value');
  const theirs = values.filter((o) => valueOpAuthor(o, proposal) === 'user_stated').map((o) => labelOf(o.path));
  const olumis = values.filter((o) => valueOpAuthor(o, proposal) === 'model_proposed').map((o) => labelOf(o.path));
  const one = (xs: readonly string[], singular: string, plural: string): string => (xs.length === 1 ? singular : plural);
  const own = theirs.length === 0 ? '' :
    `${theirs.join(', ')} ${one(theirs, 'is', 'are')} the user\u2019s own ${one(theirs, 'figure', 'figures')}, stored as theirs.`;
  const adopted = olumis.length === 0 ? '' :
    `${olumis.join(', ')} ${one(olumis, 'is Olumi\u2019s figure', 'are Olumi\u2019s figures')} that the user adopted as ` +
    `${one(olumis, 'an assumption', 'assumptions')}, not ${one(olumis, 'a measurement', 'measurements')}, stored as the user\u2019s ` +
    `${one(olumis, 'assumption', 'assumptions')}.`;
  return [own, adopted].filter((x) => x !== '').join(' ');
}

/** One internal dispatch, so every path is the product's own. */
import { reconcileGoalScope } from '../reconcile-goal-scope.js';
import { noSuchLinkUserWords } from '../no-direct-link.js';
import { goalScopeCheck, scopeIssueBlocks, scopeOf, scopeReconciliationKey, scopeWithdrawalWords } from '../goal-scope.js';
import type { GoalScopeReconciliation } from '../../../schemas/goal-scope.js';
export type InternalDispatch = (path: string, body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>;

const deadlineRefusalDetail = {
  reference_missing: `${ZERO_SPREAD_NEEDS_MONTHLY_CHANGES}. The recorded reference date is missing.`,
  reference_not_stated: `${ZERO_SPREAD_NEEDS_MONTHLY_CHANGES}. State the reference date as “as of” and confirm it on the deadline card.`,
  horizon_not_modelled: `${ZERO_SPREAD_NEEDS_MONTHLY_CHANGES}. No full month completes between the reference date and deadline.`,
} as const;

/**
 * ⭐ COACH (BYPASS1 fold-in): the ONE typed next step of a read (`next-step-blocker.ts`), for every result that hands the
 * AI the model's state: `get_canonical_state`, the build's post-build state and an approval's `readiness_after`. The host
 * no longer says the step on a reply the AI wrote, so the AI must hold it wherever it reads the model.
 */
function nextStepFactOf(read: { readonly raw: unknown; readonly analysis_state?: unknown; readonly analysis_ready?: unknown;
  readonly analysis_result?: unknown } | null | undefined): { next_step_blocker?: NonNullable<ReturnType<typeof nextStepBlockerForAgent>> } {
  if (read === null || read === undefined) return {};
  const step = nextStepBlockerForAgent({ raw: read.raw, analysis_state: read.analysis_state, analysis_ready: read.analysis_ready,
    analysis_result: read.analysis_result });
  return step === null ? {} : { next_step_blocker: step };
}

interface GraphRead {
  readonly scenario_revision?: number;
  readonly run_revision?: number | null;
  readonly run_revision_source?: 'recorded' | 'legacy_unknown';
  readonly graph_hash: string;
  /** Stored user brief from the SAME canonical graph read, never model arguments or conversation guesses. */
  readonly brief_text?: string | null;
  /** Server creation timestamp from the same existing-scenario snapshot. */
  readonly scenario_created_at?: string | null;
  /**
   * ⭐ THE IDENTITY-SPACE HASH OF THE SAME READ — "is this the same graph
   * object?" — kept so a write can assert the identity it actually read.
   *
   * ⛔ NOT INTERCHANGEABLE WITH `graph_hash`, which is the ANALYSIS projection
   * and excludes labels. That exclusion is the whole defect: a rename landing
   * between our read and our write passes an analysis-space comparison and is
   * then overwritten by our stale copy of the node. `''` when the read did not
   * supply one — an expectation is then simply not sent, never fabricated.
   */
  readonly graph_identity_hash: string;
  /**
   * Declared, not cast. `readGraph` passes the persisted node through verbatim,
   * so these are the carriers the stored graph really holds — counted across
   * every stored graph on 22 Sep 2026: `provenance` 209,115, `display_value`
   * 34,107, `scale_frame` 5,803. Naming them here is what lets the projection
   * read them without an `as` that would hide a later rename.
   */
  readonly nodes: {
    id: string;
    kind: string;
    label: string;
    description?: string;
    display_value?: unknown;
    scale_frame?: unknown;
    provenance?: unknown;
    /** Canonical authorship mark for an unadopted option Olumi proposed. */
    proposed_by?: unknown;
    /** A user-approved participation decision; origin remains `proposed_by: 'olumi'`. */
    analysis_participation?: unknown;
    /** MG F1 T6: the user's own word for an option (`option_status_edit`); absent = feasible. */
    option_status?: unknown;
    /** RC3: persisted server-authored option precondition. Inclusion is resolved over the whole graph. */
    relies_on?: unknown;
    goal_scope?: unknown;
    observed_state?: Record<string, unknown>;
    interventions?: Record<string, unknown>;
    changes?: unknown;
    /** The drafter's status-quo declaration, read only through `readIsBaseline` (`statusQuoOptionId`). */
    is_baseline?: unknown;
    data?: unknown;
    /** Read by the add-factor door's target rule (`isNewFactorTarget`): a lever the options set is never a target. */
    category?: unknown;
  }[];
  /** `origin` is read only to recognise a repair-authored edge (`isRepairAuthoredOptionFactorEdge`). */
  readonly edges: {
    id?: unknown;
    from: string;
    to: string;
    origin?: unknown;
    edge_type?: unknown;
    /** Whose link it is and how strong: read by the model context (C33) and the link-strength proposal and its write check. */
    provenance?: unknown;
    strength?: unknown;
    exists_probability?: unknown;
    effect_direction?: unknown;
    defaulted?: unknown;
  }[];
  readonly analysis_state: unknown;
  /** Existing cold-read freshness text, projected to AI context without a second derivation. */
  readonly analysis_ready?: unknown;
  /**
   * The read's own `analysis_admission` (top level on the graph read, whose admission remains separate from freshness): its
   * `permitted_analysis_mode` is the mode half of the selected Run's leader permission (`claimPermissionsFrom`).
   */
  readonly analysis_admission?: unknown;
  /** Requested Explain permission reads the selected Run's existing admission carrier. */
  readonly run_explanation_admission?: unknown;
  /** Refreshed issues from the same canonical read; explanatory data, never a second permission gate. */
  readonly goal_scope_reconciliation?: readonly GoalScopeReconciliation[];
  /** The persisted graph exactly as read — every top-level carrier, not only nodes/edges. */
  readonly raw: Record<string, unknown>;
  /** A7: the read's own `not_modelled` (derived by the read route over this graph); absent when the read had none. */
  readonly not_modelled?: NotModelledManifest;
  /** C46 × R3-4: the read's `analysis_identity_evaluated_node_ids` (same fact and gates as its result); absent = not attested. */
  readonly identity_evaluated?: ReadonlySet<string>;
  /**
   * R3-9: the read's `analysis_identity_run_use` — Canonical's `identityRunUseFromFacts` over the facts the link writer
   * reads on approval, never freshness-gated. `null` = no successful Run, or the read did not say (fail closed: a
   * definitional link is then refused, as the writer refuses it with no Run).
   */
  readonly identity_run_use?: IdentityRunUse | null;
  /** The selected run's per-limit rows (`analysis_limit_verdicts`), read off the SAME graph read (`limit-checks.ts`). */
  readonly limit_verdicts?: StoredLimitVerdicts;
  /** Selected canonical sidecars; narrowed by the existing verdict reader in savedRunContextFacts. */
  readonly constraint_verdict_state?: unknown;
  readonly leader_limit_risks?: readonly unknown[] | null;
  /** The read's `analysis_result` block — the selected Run, present only when the route delivers it (`goal-certainty-for-agent.ts`). */
  readonly analysis_result?: unknown;
  /** Full UI wire data stays internal until the model-facing context projection. */
  readonly run_delta?: RunDelta;
  /** The read's `analysis_goal_certainty` via #2280's ONE reader (`readStoredGoalCertainty`); absent = not recorded. */
  readonly goal_certainty?: readonly unknown[];
  /** The selected Run's recorded participation via the canonical reader; absent = not recorded. */
  readonly option_participation?: StoredOptionParticipation;
  /** SAME selected stored-fact projection; analysis_result does not transport input_snapshot. */
  readonly run_option_set?: RecordedRunOptionSet;
}

// An edited graph can still carry an earlier Run. Its old result must not be
// given a display name derived from the new intervention level.
/**
 * ⭐ THE COMPARISON WITH THE PRECEDING RUN, for the model (Paul #94 6166259456; DL 14 Oct). ONE reader for both the state
 * read (`get_canonical_state`) and a Run's own output: the delta the model may be shown (`selectedRunDeltaForModel`) and,
 * where none is licensed or its C1 was checked down, Olumi's own leader-free record of what changed (`rerunRecordForModel`).
 * Both undefined for a first Run.
 */
async function runComparisonFacts(scenarioId: string, requestId: string, g: GraphRead): Promise<{ delta: Awaited<ReturnType<typeof selectedRunDeltaForModel>>; rerunRecord: ReturnType<typeof rerunRecordForModel> }> {
  const evidenceDeadlineAt = Date.now() + SELECTED_RUN_DELTA_DEADLINE_MS;
  const delta = await selectedRunDeltaForModel(scenarioId, g, g.run_delta);
  const optionNames = optionNameAliasesForCurrentRun(g);
  // S7 (D4 lease #87 6005636960): a pair the model is NOT shown as licensed still gets Olumi's own leader-free record of
  // what changed, so a typed "what changed since the last run?" is answered from the record. `undefined` for a licensed
  // model delta (context byte-unchanged) and for a first Run.
  // SD-1 (rehearsal12): a licensed delta whose C1 the projection checked down (several changes, or partial coverage)
  // gets Olumi's record too, so the model can say every change and that nothing proves one caused it.
  const modelCaseCheckedDown = delta !== undefined && (g.run_delta as { attribution_case?: unknown } | undefined)?.attribution_case === 'C1_attributable'
    && (delta as { attribution_case?: unknown }).attribution_case !== 'C1_attributable';
  // SD-1 interim: a link restated inside its band, and (cut 6) the links the user wrote between the two Runs, both read
  // from the pair's own persisted Run facts (never on the wire). No read for a model delta shown as licensed.
  // This fallback shares the selected-delta budget; incomplete coverage must not start a second deadline.
  const pairRead = delta !== undefined && !modelCaseCheckedDown ? undefined
    : await rerunPairReadForRunDelta(scenarioId, requestId, g.run_delta, Math.max(0, evidenceDeadlineAt - Date.now()));
  const rerunRecord = rerunRecordForModel(g.run_delta, delta !== undefined && !modelCaseCheckedDown, g.nodes,
    [...optionNames.values()].map((a) => a.display), pairRead?.withinBand ?? [], pairRead?.userWrittenLinks,
    pairRead?.frameRefitLinks);
  return { delta, rerunRecord };
}

/** What a Run's output tells the model to do with its comparison facts (Paul #94 6166259456). */
// Principle review C (DL 14 Oct): the clause invited a verdict ("goal and decision") and had no science focus.
export const RUN_COMPARISON_NOTE = 'This Run has a preceding Run of this model. In your reply, explain what this Run\u2019s new result '
  + 'implies for the user\u2019s goal in the current model; never recommend or pick an option. Say what the result rests on most, what '
  + 'is still uncertain or missing, and one thing worth checking or testing next, using only the supplied analysis. Then '
  + 'compare it with the preceding Run: what changed in the model between the two Runs (from rerun_record or run_delta) and how each '
  + 'option\u2019s result moved, using only the figures given here. Where these facts cannot support a quantity (a figure withheld, a '
  + 'change not recorded, or a movement no change is shown to cause), say so plainly instead of estimating. Never present the '
  + 'preceding Run\u2019s result as the current one.';

function optionNameAliasesForCurrentRun(g: Omit<GraphRead, 'run_delta'>): ReturnType<typeof optionNameAliases> {
  const kind = (g.analysis_state as { run_state?: { kind?: unknown } } | undefined)?.run_state?.kind;
  // The graph read has already checked the Run against the canonical analysis
  // projection. Its graph_hash is the raw edit/CAS base, which can differ on a
  // repaired-shape graph. Only the read's current verdict plus selected result
  // licenses an alias; stale and unreadable reads never name an old Run's level.
  return kind === 'complete_current' && g.analysis_result !== undefined ? optionNameAliases(g.raw) : new Map();
}

const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/…$/, '').trim();

/**
 * ⛔ A HELD STATUS QUO GETS NO LEVELS (Paul's ruling; admission, MG #1838).
 *
 * An option that carries on as now is connected to the factors the other options
 * act on by repair edges with NO level: each factor stays at its starting value.
 * Readiness already excludes those edges from its level mapping. A level written
 * there is harmful, not harmless (RC): a later correction to the factor's starting
 * value would leave the status quo at the OLD figure, so "Maintain current
 * staffing" would silently model cutting staff.
 *
 * Returns `${optionId}::${factorId}` for every pair whose option→factor edges are
 * ALL repair-authored — the same test readiness applies (a pair with any ordinary
 * edge is mapped), through the ONE authority, never a copy of it.
 */
function heldStatusQuoPairs(g: Pick<GraphRead, 'nodes' | 'edges'>): ReadonlySet<string> {
  // WHICH option is the status quo is decided per option, by the ONE authority
  // `statusQuoOptionId` (the declared option first, else exactly one idiom label —
  // admission's own minting order; review of #1849, blocker 2, for why repair alone
  // is not enough). ⛔ It was label-only here, so a DECLARED "Keep £49 Pro Price" was
  // never held and one approval wrote £49 and 0 onto it (served d5d5839, #69 5832119174).
  // The REPAIR test is per PAIR, the granularity readiness uses (`analysis-ready.ts:780`
  // skips each repair edge on its own): a status quo the user has since linked to one
  // more factor keeps its other pairs held (review of #1849 at 1a32b120 — all-or-nothing
  // re-opened RC's harm).
  const id = statusQuoOptionId(g.nodes, g.edges);
  if (id === null) return new Set();
  const kinds = new Map(g.nodes.map((n) => [n.id, n.kind] as const));
  const repaired = new Set<string>();
  const ordinary = new Set<string>();
  for (const e of g.edges) {
    if (e.from !== id || kinds.get(e.to) !== 'factor') continue;
    (isRepairAuthoredOptionFactorEdge(e, kinds) ? repaired : ordinary).add(`${e.from}::${e.to}`);
  }
  return new Set([...repaired].filter((k) => !ordinary.has(k)));
}

/**
 * A factor's starting value in the user's own units (Codex 5810763729 item 1): `raw_value`
 * when the frame recorded one, else the model value multiplied back up by the cap, else the
 * value itself (an unframed factor stores native already). `undefined` when it holds none.
 */
function nativeStartingValue(os: { value?: unknown; raw_value?: unknown; cap?: unknown } | undefined): number | undefined {
  const model = typeof os?.value === 'number' ? os.value : undefined;
  const cap = typeof os?.cap === 'number' && os.cap > 0 ? os.cap : undefined;
  return typeof os?.raw_value === 'number' ? os.raw_value : model !== undefined && cap !== undefined ? model * cap : model;
}

/**
 * The range an option level on this factor is stored against — THE rule the level writer
 * divides by (`proposeOptionInterventions`): `observed_state.cap` when positive, else the
 * factor's stored `scale_frame` when above 1, else none (a level in 0..1 is stored as given).
 * One function, so the projection that reads a level back can never use a different range
 * from the write that stored it.
 */
export function levelFrameOf(factor: { observed_state?: Record<string, unknown>; scale_frame?: unknown } | undefined): number | null {
  const cap = (factor?.observed_state ?? {}).cap;
  if (typeof cap === 'number' && Number.isFinite(cap) && cap > 0) return cap;
  const frame = factor?.scale_frame;
  return typeof frame === 'number' && Number.isFinite(frame) && frame > 1 ? frame : null;
}

/**
 * ⛔ THE ADD-OPTION DOOR'S OWN PER-LEVEL RULE, EXPORTED (DL on CEE #2512, 5950820450): `propose_new_option` stores or
 * leaves unset each option level through exactly these stages, and the Widen gate (`method-turn/widen-turn.ts`) judges
 * a proposal by calling them, never by a copy that drifts (four review rounds of the same class).
 * - `doorLevelOf`: the level as the door reads one `acts_on` entry: a finite value, its unit trimmed when given.
 * - `factorUnitConflict`: a figure in another kind of unit is never this factor's level (`unit-conflict.ts`: a price
 *   as churn). The factor's unit is its own, else a limit's on it in the RAW graph.
 * - `placeLevel`: the name rule (Olumi's figure only), then the writer's range (`levelFrameOf`) → the stored cell.
 * - `estimateLevelPersists`: both, in the door's order, for a level that is Olumi's estimate.
 */
export interface DoorLevel { readonly value: number; readonly unit?: string }
type LevelFactor = { readonly id?: unknown; observed_state?: Record<string, unknown>; scale_frame?: unknown } | undefined;

export function doorLevelOf(level: unknown): DoorLevel | undefined {
  const l = level as { value?: unknown; unit?: unknown } | null | undefined;
  const v = l?.value;
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return { value: v, ...(typeof l?.unit === 'string' && l.unit.trim() !== '' ? { unit: l.unit.trim() } : {}) };
}

export function factorUnitConflict(lvl: DoorLevel, factor: LevelFactor, rawGraph: unknown): { readonly factorUnit: string | undefined; readonly conflict: boolean } {
  const factorUnit = factorUnitOf(rawGraph, factor);
  return { factorUnit, conflict: unitsConflict(lvl.unit, factorUnit) !== null };
}

export type LevelPlacement =
  | { readonly kind: 'contradicts_name' }
  | { readonly kind: 'out_of_range'; readonly range: number }
  | { readonly kind: 'no_range' }
  | { readonly kind: 'set'; readonly value: number; readonly raw_value?: number; readonly unit?: string };

export function placeLevel(lvl: DoorLevel, factor: LevelFactor, factorUnit: string | undefined, optionLabel: string, nameRule: boolean): LevelPlacement {
  if (nameRule && contradictsItsName(lvl.value, lvl.unit ?? factorUnit, optionLabel)) return { kind: 'contradicts_name' };
  const frame = levelFrameOf(factor);
  if (frame !== null) {
    const v = lvl.value / frame;
    if (!(v >= 0 && v <= 1)) return { kind: 'out_of_range', range: frame };
    const os = (factor?.observed_state ?? {}) as { unit?: unknown };
    const unit = lvl.unit ?? (typeof os.unit === 'string' && os.unit !== '' ? os.unit : undefined);
    return { kind: 'set', value: v, raw_value: lvl.value, ...(unit !== undefined ? { unit } : {}) };
  }
  if (lvl.value >= 0 && lvl.value <= 1) return { kind: 'set', value: lvl.value };
  return { kind: 'no_range' };
}

export function estimateLevelPersists(lvl: DoorLevel, factor: LevelFactor, rawGraph: unknown, optionLabel: string):
  { readonly ok: true; readonly value: number } | { readonly ok: false; readonly kind: 'unit_mismatch' | 'contradicts_name' | 'out_of_range' | 'no_range' } {
  const { factorUnit, conflict } = factorUnitConflict(lvl, factor, rawGraph);
  if (conflict) return { ok: false, kind: 'unit_mismatch' };
  const placed = placeLevel(lvl, factor, factorUnit, optionLabel, true);
  return placed.kind === 'set' ? { ok: true, value: placed.value } : { ok: false, kind: placed.kind };
}

/**
 * ⭐ WHAT EACH OPTION SETS, AS STORED (Canonical State RCA D1, #69 5833317225). `projectEntity`
 * showed values, units and ranges but no option levels, so `get_canonical_state` never told the
 * Agent what an option already sets: it quoted its own tool arguments and re-proposed levels
 * blind, and Paul's chat said £38k where the canvas held £39k. Each stored cell is returned in
 * the user's units by the writer's own range (`levelFrameOf`), with who set it. A cell with no
 * numeric value is left out, never shown as a zero.
 */
const byIdCache = new WeakMap<object, ReadonlyMap<string, GraphRead['nodes'][number]>>();
function byIdOf(g: Pick<GraphRead, 'nodes'>): ReadonlyMap<string, GraphRead['nodes'][number]> {
  let m = byIdCache.get(g);
  if (m === undefined) { m = new Map(g.nodes.map((n) => [n.id, n])); byIdCache.set(g, m); }
  return m;
}

export function projectOptionLevels(
  option: GraphRead['nodes'][number],
  factorsById: ReadonlyMap<string, GraphRead['nodes'][number]>,
): Record<string, unknown>[] {
  if (option.kind !== 'option' || option.interventions === null || typeof option.interventions !== 'object') return [];
  const out: Record<string, unknown>[] = [];
  for (const [factorId, raw] of Object.entries(option.interventions)) {
    const cell = (raw ?? {}) as { value?: unknown; source?: unknown };
    if (typeof cell.value !== 'number' || !Number.isFinite(cell.value)) continue;
    const factor = factorsById.get(factorId);
    const frame = levelFrameOf(factor);
    const unit = (factor?.observed_state ?? {}).unit;
    out.push({
      factor_id: factorId,
      ...(typeof factor?.label === 'string' && factor.label !== '' ? { factor: factor.label } : {}),
      level: frame === null ? cell.value : cell.value * frame,
      ...(typeof unit === 'string' && unit !== '' ? { unit } : {}),
      // ONE PROVENANCE AUTHORITY: who set it, in the authority's words — never the raw stamp for the Agent to interpret.
      // A cell with no stamp carries no `set_by`, as before.
      ...(typeof cell.source === 'string' && cell.source !== '' ? { set_by: settingDisplayOf(raw, factor) } : {}),
    });
  }
  return out;
}

/**
 * ⭐ ONE PROJECTION of a persisted node into what the Agent is shown — used by
 * EVERY tool that hands the Agent entities.
 *
 * ⛔ It used to live inline in `get_canonical_state` while `build_model_from_brief`
 * kept its own `{label, kind, value}` list. An independent review ran both on the
 * same stored node — `{value: 0.45, raw_value: 9, unit: 'months', cap: 20}` — and
 * only one carried the figure. The route tells the Agent to answer from the BUILD
 * result, so the first reply every user sees quoted a normalised 0.45 and said the
 * unit was unknown. Two field lists will always drift; one cannot.
 */
export function projectEntity(n: GraphRead['nodes'][number]): Record<string, unknown> {
          // The carriers the persisted graph already holds. Reading them is not
          // enrichment — every one is a field the estate stores, and withholding
          // them made the Agent reconstruct from the prompt what canonical state
          // already knew.
          const os = (n.observed_state ?? {}) as Record<string, unknown>;
          const precondition = n.kind === 'risk' ? readReliesOnRisk(n.relies_on) : undefined;
          const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
          const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
          // Value provenance is a DIFFERENT fact from entity provenance: who put
          // this NUMBER here, versus where the entity came from. Collapsing them
          // is how a system-read figure inherits a user's authority.
          // ⭐ S10 FIX 1 (DL 15 Oct): ONLY the authority's answer (`whose`, `heldFigureOwnerOf`), never the raw stamps beside
          // it. Served: an approved Olumi estimate is STORED as `user_assumption` with `reviewed_by_user`, corrected only on read;
          // given both, the Agent told Paul "proposed values become yours when you approve them". The user's review of the
          // figure is in the answer (`olumi_accepted`), so a cold session still knows it (52f8cd, #75 5921124922).
          // PL 15 Oct (#3177): a known human source whose binding to THIS item is unverified (the served "80") stays the user's
          // source with an unverified role, said as typed facts from the same authority, never "unknown origin".
          const whose = num(os.value) || num(os.raw_value) ? heldFigureOwnerOf(os) : undefined;
          const author = whose === undefined ? undefined : provenanceOf({ value: os });
          const valueProvenance = whose === undefined || author === undefined ? {} : { whose,
            origin: author.origin === 'human' ? 'user' : author.origin === 'ai' ? 'olumi' : 'unknown',
            ...(author.role === 'unverified' ? { role: 'unverified' } : {}) };
          return {
            // ⭐ THE ID. Without it the only way to act on an entity was a fuzzy
            // label match, which collides and cannot address two entities that
            // read alike.
            id: n.id,
            label: n.label,
            ...(n.description !== undefined ? { full_label: n.description } : {}),
            kind: n.kind,
            ...(precondition === undefined ? {} : { relies_on: precondition }),
            // A value only when one is actually stored. Absence is reported as
            // unknown rather than as a zero.
            value: num(os.value) ? os.value : null,
            // ⚠ EVERY FIELD BELOW IS OMITTED WHEN ABSENT, never nulled. A null
            // here reads to a model as a stated fact ("there is no unit") rather
            // than as silence, and the Agent would repeat it.
            ...(num(os.raw_value) ? { raw_value: os.raw_value } : {}),
            ...(str(n.display_value) ? { display_value: n.display_value } : {}),
            ...(str(os.unit) ? { unit: os.unit } : {}),
            // The scale carriers. A bare amount with none of these is not just
            // under-described, it is unanalysable downstream — the Agent needs to
            // see that to explain it.
            ...(num(os.cap) ? { cap: os.cap } : {}),
            ...(str(os.declared_scale) ? { declared_scale: os.declared_scale } : {}),
            // ⛔ A goal's frame is a choice of UNITS for sizing its links, never a level or a target (R3 F1; AIQ 5922456694 (1)):
            // handed to the Agent as a bare number beside a goal with no target, it would be quoted as "your goal".
            ...(n.scale_frame === undefined || n.kind === 'goal' ? {} : { scale_frame: n.scale_frame }),
            ...(Object.keys(valueProvenance).length === 0
              ? {}
              : { value_provenance: valueProvenance }),            // ⭐ SYSTEM 2 (AIE 6181498097): how the goal's level today was reached, in the one reader's words
            // (`goalLevelReadingWords`), so the Agent says "derived from your figures" and never calls it a measured total.
            ...((): Record<string, unknown> => {
              const words = n.kind === 'goal' ? goalLevelReadingWords({ nodes: [n] }, n.id) : null;
              return words === null ? {} : { level_today_reading: words };
            })(),

            // ⭐ Recovery Batch B, Row5 (DL 12 Oct): the range stated for this level, as stored (`observed_state.range`), with
            // its author, so the Agent can say "you gave 10–30" or "a supplier's 10–30 (unverified)". The user's own range
            // sits beside their figure; a third party's is quoted, role unverified. `point` says which figure sits beside it:
            // the user's own, or Olumi's midpoint of that range (`levelRangePointBasis`), never the user's figure.
            ...((): Record<string, unknown> => {
              const r = os.range as { low?: unknown; high?: unknown; source?: unknown; source_quote?: unknown } | undefined;
              // The author, asked of the one provenance authority (C): the user's own range (L6) is attested; a type-less brief
              // stamp is the person's by its stamp alone, a third party's figure the brief quotes (Row5); anything else, none.
              const author = r === undefined ? undefined : provenanceOf({ value: r });
              if (r === undefined || !num(r.low) || !num(r.high) || author?.origin !== 'human') return {};
              const users = author.stampOnly !== true;
              const point = levelRangePointBasis(os);
              return { stated_range: { low: r.low, high: r.high, stated_by: users ? 'user' : 'third_party_unverified',
                ...(!users && str(r.source_quote) ? { quote: r.source_quote } : {}),
                ...(point === 'stated_figure' ? { point: 'user_figure' } : point === 'midpoint' ? { point: 'olumi_midpoint' } : {}) } };
            })(),
            // S10 fix 1: who added the entity, as the ONE authority answers it (`authorshipOf`), never the raw node tag.
            ...(n.provenance === undefined ? {} : { added_by: whoseOf(authorshipOf({ nodeTag: n.provenance })) }),
            // Any kind (T4i, DL 14 Oct): an excluded factor, risk or outcome reaches the Agent with its exclusion mark, as an
            // option does, so it is never described as part of the Run.
            ...(n.proposed_by === 'olumi' ? { proposed_by: 'olumi' } : {}),
            ...(n.analysis_participation === 'included' || n.analysis_participation === 'retained_excluded'
              ? { analysis_participation: n.analysis_participation } : {}),
            // MG F1 T6: the user's own word for the option (absent = feasible): "removed" / "infeasible" is out of the comparison.
            ...(n.kind === 'option' && (n.option_status === 'removed' || n.option_status === 'infeasible') ? { option_status: n.option_status } : {}),
          };
        }

/**
 * ⭐ (B) WHAT THE AGENT NEEDS TO EXPLAIN THE MODEL HONESTLY — the goal as the user stated it, the limits they
 * set, whose each link is, and the ONE readiness verdict (C33 5838970895; ChatGPT 5839692762 B).
 *
 * Figures are stored carriers passed through: the goal target through the ONE trio
 * reader (`pickGoalThresholdTrio`, raw figure only — never the normalised `goal_threshold`, which is the
 * constant 0.8 on every headroom-derived cap), limits from `goal_constraints` as stored, link strength and
 * provenance as stored. Today's limit fact uses the same predicate and proven frame as analysis.
 * Readiness is `readinessViewOf` — the route's own admission verdict, in plain words.
 */
/** How the model uses `stated_objections` (AIE-ACKed wording; carried beside the data, as `left_out[].use` is). */
const STATED_OBJECTIONS_USE = "These are the user's own stated disagreements with findings, verbatim and newest first. They do not by themselves change the model or existing analysis. Engage with the reasons in their words; never present them as Olumi's findings, as agreement or as resolved.";

export function projectModelContext(g: Pick<GraphRead, 'nodes' | 'edges' | 'raw' | 'analysis_state' | 'analysis_ready'>): Record<string, unknown> {
  const str = (v: unknown): v is string => typeof v === 'string' && v !== '';
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const labelOf = new Map(g.nodes.map((n) => [n.id, n.label] as const));
  const preconditions = preconditionRiskIds(g.nodes, g.edges, limitNodeIdsOf(g.raw));
  const leftOut = g.nodes.filter((n) => preconditions.has(n.id)).flatMap((risk) => {
    const stamp = readReliesOnRisk(risk.relies_on);
    if (stamp === undefined) return [];
    return [{ id: risk.id, label: risk.label, relies_on: stamp,
      reason: reliesOnRiskLine(risk.label, labelOf.get(stamp.option_id)!),
      use: "Kept for discussion. Never a driver, sensitivity or worth-checking row, and never cite it as a reason for a goal chance: the Run leaves it out." }];
  });
  const goals = g.nodes.filter((n) => n.kind === 'goal').map((n) => {
    const trio = pickGoalThresholdTrio(n as never) as { goal_threshold_raw?: number; goal_threshold_unit?: string };
    const frame = (n as { goal_threshold_frame?: unknown }).goal_threshold_frame;
    // Row 5 (#72 5881225605): the comparator the user stated for the target, as construction held it
    // (`goal_direction`). Absent ⇒ unattested, so absent here too — never defaulted, never read off the label.
    const comparator = readHeldGoalComparator(g.raw, n.id);
    // ⭐ S-E GOALS (C6): the deadline the goal holds, in British words, and a goal measured as a chance said as such, so the
    // Agent never re-asks a recorded deadline and never treats the chance as a quantity.
    const deadline = goalDeadlineFromRecord(g.raw, n.id);
    return {
      id: n.id,
      label: n.label,
      ...(isEventShareForecast(g.raw) ? { measured_as: 'the forecast share finished by the deadline; give the current team’s time range, never a level today or a chance' }
        : goalKindOf(n) === 'chance_of_event' ? { measured_as: 'a chance of an event, which Olumi works out: never a quantity, a level or a target' } : {}),
      ...(deadline === undefined ? {} : { deadline: sayDate(deadline) }),
      // ⭐ M3a (AIE 6180193788 §1): the user's recorded statements about the goal, verbatim, and the measure one of them defines,
      // so THIS working input and a cold reopen hold the user's definition apart from Olumi's reading.
      ...((): Record<string, unknown> => {
        const node = (Array.isArray(g.raw.nodes) ? g.raw.nodes as unknown[] : []).find((x) => isPlainRecord(x) && x.id === n.id);
        const said = userStatementsOn(node);
        const measure = recordedMeasureOf(node);
        return said.length === 0 ? {} : { user_statements: said.map((r) => ({ field: r.field, said: r.statements.map((x) => x.quote), speaker: 'user' })),
          ...(measure === undefined ? {} : { measured_in: measure }) };
      })(),
      ...(scopeOf(n.goal_scope) ? { scope: n.goal_scope, conditional_derivations: goalScopeCheck(g.raw, n.id, scopeOf(n.goal_scope)!).derivations } : {}),
      ...(trio.goal_threshold_raw === undefined ? {} : {
        target: {
          value: trio.goal_threshold_raw,
          ...(trio.goal_threshold_unit === undefined ? {} : { unit: trio.goal_threshold_unit }),
          ...(str(frame) ? { frame } : {}),
          ...(comparator === null ? {} : { comparator, comparator_in_words: LIMIT_OPERATOR_WORDS[comparator] }),
          // R1 S4-core: a target stated as a change from today says so in words ("down 15% from today"), so the Agent never
          // reads the stored fraction as a level of the goal's unit (`sayGoalChange`). A level carries no `in_words`, as before.
          ...((): Record<string, string> => {
            const said = sayGoalChange(frame, trio.goal_threshold_raw!, trio.goal_threshold_unit, (v, u) => targetFigure(v, u ?? ''), (n as { goal_direction?: unknown }).goal_direction);
            return said === undefined ? {} : { in_words: said };
          })(),
        },
      }),
    };
  });
  const limits = (Array.isArray(g.raw.goal_constraints) ? g.raw.goal_constraints : [])
    .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
    .filter((c) => str(c.operator) && num(c.value))
    .map((c) => {
      // ⭐ A2: the limit as the user STATED it ("less than 4%"), from `operator_as_stated` beside the held `operator`
      // (`statedOperatorOf`: only its strict twin, never a contradicting stamp). `operator` stays the held one: it is
      // the key `propose_limit_change` names the row by. Strict ties are read by the shared predicate below.
      const stated = statedOperatorOf(c);
      const unit = str(c.unit) ? (c.unit.startsWith('%') ? c.unit : ` ${c.unit}`) : '';
      const node = g.nodes.find((n) => n.id === c.node_id);
      const decision = node === undefined ? undefined : levelLimitNodeDecision(g.raw, c, node as Record<string, unknown>,
        str(g.raw.goal_node_id) ? g.raw.goal_node_id : undefined);
      const today = node?.observed_state?.stated_role === 'constraint' || isRetainedExcluded(node) ? undefined : decision?.engineReadLevel;
      const threshold = c.value_frame === 'level' && node !== undefined
        ? thresholdOnNodeLevel(g.raw, c, node as Record<string, unknown>, c.value as number) : undefined;
      return {
        ...(str(c.node_id) ? { node_id: c.node_id } : {}),
        ...(str(c.constraint_id) ? { constraint_id: c.constraint_id } : {}),
        // Named as the run-turn limit card names it (#1935): the node the limit sits on, joined by id; the row's
        // own label only when that node is absent — so the card and the Agent say the same words for one limit.
        on: (str(c.node_id) ? labelOf.get(c.node_id) : undefined) ?? (str(c.label) ? c.label : 'the goal'),
        operator: c.operator,
        ...(stated !== undefined && stated !== c.operator ? { operator_as_stated: stated } : {}),
        value: c.value,
        ...(str(c.unit) ? { unit: c.unit } : {}),
        // R1 S4-core: a change from today says so, beside its stored value (a fraction for `change_rel`), so the Agent
        // never reads "0.1" as a level. A level's words are byte-identical (`sayLimitInFrame`).
        ...(str(c.value_frame) ? { frame: c.value_frame } : {}),
        ...(stated !== undefined ? { in_words: sayLimitInFrame({
          // `c.value` is a finite number: the `.filter(... num(c.value))` above.
          operator: stated, value: c.value as number, unit: str(c.unit) ? c.unit : undefined, frame: c.value_frame,
          words: LIMIT_OPERATOR_WORDS, figure: (v) => `${String(v)}${unit}`,
        }) } : {}),
        ...(str(c.provenance) ? { stated_by: c.provenance } : {}),
        ...(stated === undefined || !num(today) || threshold === undefined ? {} : {
          today_within_limit: meetsLimit(today, stated, threshold),
          today_within_limit_instruction: 'Quote this computed fact about today in this model; do no arithmetic. true means today meets the limit; false means it does not; at_threshold means today is at the strict threshold and does not meet the limit.',
        }),
      };
    });
  /**
   * ⭐ PJ-C1 TOKENS, LEVER 2 (DL #72 5866036457): a STRUCTURAL link — from the decision to an option, or from an option
   * to a factor it sets — is said by its ends only. Measured on served A09 (`c35f1c7`): 13 of the 26 links, all
   * `{mean: 1, std: 0.01}`, "very strong", present for certain; 2,838 of the links' 5,533 characters, re-sent on every
   * model call. Those figures are the engine's structure, not a strength anyone judged, and nothing the Agent says or
   * proposes reads them. A link from an option that carries any other strength or existence keeps its full form.
   */
  const structuralFrom = new Set(g.nodes.filter((n) => n.kind === 'decision' || n.kind === 'option').map((n) => n.id));
  const kindOf = new Map(g.nodes.map((n) => [n.id, n.kind] as const));
  const unitOfNode = nodeUnitOf(g.nodes);
  // Science 393023 rule R (route-once), DESIGN science-mechanism-doubt-DESIGN.md §2/§6.
  const endsOf = endsOfGraph(g.raw);
  const links = g.edges.map((e) => {
    const countedOnce = heldLinkOf(e, endsOf(e))?.reason === 'route_once';
    const st = (e.strength !== null && typeof e.strength === 'object') ? e.strength as { mean?: unknown; std?: unknown } : undefined;
    const fixed = (st === undefined || (st.mean === 1 && (st.std === undefined || st.std === 0.01)))
      && (e.exists_probability === undefined || e.exists_probability === 1) && e.effect_direction !== 'negative';
    const identity = str(e.id) ? { id: e.id } : {};
    if (structuralFrom.has(e.from) && fixed) return { ...identity, from: e.from, to: e.to };
    return {
      ...identity,
      from: e.from,
      to: e.to,
      // ⛔ A link that HOLDS BY DEFINITION (checked: `holdsByDefinition`) is arithmetic, not "an assumption Olumi made":
      // its source is said as `by_definition`, never `cee_hypothesis` (DL #2445 condition 1; MG sweep C5).
      // ⭐ S10 fix 1: whose link it is, as the ONE authority answers who drew it (`linkDrawnByOf`: an unrecognised stamp is unknown), never
      // the raw drawing stamp; how strong, and who sized it, stays `sizing`.
      ...(holdsByDefinition(e as Record<string, unknown>, unitOfNode) ? { holds_by_definition: true }
        : { whose: whoseOf(linkDrawnByOf(e, { fromKind: kindOf.get(e.from) })) }),
      // R11: the user confirmed Olumi's strength for this link — still Olumi's figure, but not one to ask about again.
      ...(edgeReviewedByUser(e) ? { confirmed_by_user: true } : {}),
      ...(str(e.effect_direction) ? { direction: e.effect_direction } : {}),
      // D1 ECHO GUARD (DL ruling 12 Oct, Batch D): a placeholder's stored figure is nobody's size, so it is not projected,
      // as its band is not (below): read, the Agent echoed the 0.5 default's band back as its own estimate.
      ...(linkSizing(e) !== 'placeholder' && st !== undefined && num(st.mean) ? { strength: { mean: st.mean, ...(num(st.std) ? { std: st.std } : {}) } } : {}),
      // ⭐ The band, in the canvas's own WORD (`format/edge-strength-bands.ts`, #2003): without it the Agent named
      // bands from its own priors — served e13eda8 called a 0.5 link (the canvas's "Strong") "moderate". The lowest is
      // "slight" as on the pill, never the enum's `weak` (the model relays what it reads; tool calls still pass `weak`, #2017).
      // Science 393023 LICENCE ruling 3: a placeholder has no current band, so none is projected for the Agent to name.
      ...(linkSizing(e) !== 'placeholder' && st !== undefined && num(st.mean) ? { band: edgeStrengthWords(e) } : {}),
      ...(countedOnce ? { exists_probability: 1, counted_once: true }
        : num(e.exists_probability) ? { exists_probability: e.exists_probability } : {}),
      /**
       * ⭐ WHO SIZED IT, by F1b's ONE rule (`linkSizing`; AI HARNESS, DL 5936996041 on R3 DEFECT 2 5936673643). `defaulted`
       * is NOT a sizing mark: construction sets it on Olumi's estimates too (a projected spread or existence), and the
       * Agent read it as "no one has estimated its strength yet", so "fix them all" re-sized two estimates and left the
       * two real placeholders. It is no longer projected; a link that holds by definition is arithmetic and carries none.
       */
      ...(holdsByDefinition(e as Record<string, unknown>, unitOfNode) ? {} : { sizing: linkSizing(e) }),
      ...(str(e.origin) ? { origin: e.origin } : {}),
    };
  });
  // ⭐ E5: each option's start times and pace as the model holds them, with whose each figure is (`hiring-times.ts`).
  const hiringTimes = goals.length === 1 && isEventShareForecast(g.raw) ? hiringTimesSummaryOf(g.raw, goals[0]!.id) : [];
  return {
    ...(goals.length === 1 ? { goal: goals[0] } : goals.length > 1 ? { goals } : {}),
    ...(limits.length > 0 ? { limits } : {}),
    ...(hiringTimes.length === 0 ? {} : { hiring_times: { use: HIRING_TIMES_USE, options: hiringTimes } }),
    links,
    ...(leftOut.length === 0 ? {} : { left_out_of_run: leftOut }),
    readiness: readinessViewOf(g.raw),
    ...(earlierAnalysisOf(g.analysis_state, g.analysis_ready) ?? {}),
  };
}

/**
 * What `propose_assumptions` tells the Agent to say, by who wrote the values: a figure the user gave (`your_figure`)
 * is theirs and is never called an assumption; every other value is an assumption to adopt or correct.
 */
function proposalNoteFor(usersCount: number, total: number): string {
  const ask = 'and call authorise_change with this proposal_id only once they agree.';
  if (usersCount === 0) {
    return 'Nothing has changed. Show the user each value and what it rests on, say plainly that these are ' +
      `assumptions to adopt or correct and NOT measurements, ${ask}`;
  }
  if (usersCount === total) {
    return 'Nothing has changed. Show the user each value as the figure the user gave: it will be saved as the ' +
      "user's own figure, so never call it Olumi's estimate or an assumption, or say it is not a measurement (an " +
      `"about" in their words does not make it Olumi's), ${ask}`;
  }
  return 'Nothing has changed. Show the user each value and what it rests on. A value marked your_figure is the ' +
    "user's own figure and will be saved as theirs: never call it Olumi's estimate or an assumption. Say plainly that the other values " +
    `are assumptions to adopt or correct and NOT measurements, ${ask}`;
}

/** How many entries of a starting point are the user's own figures, read off the halves' typed markers. */
function usersFiguresIn(assumptions: unknown, levels: unknown): number {
  const marked = (xs: unknown, key: string, want: unknown): number =>
    (Array.isArray(xs) ? xs : []).filter((x) => x !== null && typeof x === 'object' && (x as Record<string, unknown>)[key] === want).length;
  return marked(assumptions, 'your_figure', true) + marked(levels, 'stated_by', 'user');
}

/** What `propose_starting_point` tells the Agent to say (the `proposalNoteFor` rule, for values AND levels). */
function startingPointNoteFor(usersCount: number): string {
  const tail = 'and that ONE approval applies all of them. Then call authorise_change with this proposal_id once they agree.';
  if (usersCount === 0) {
    return 'Nothing has changed. Show the user every value and level and what each rests on, say plainly they are ' +
      `assumptions to adopt or correct, NOT measurements, ${tail}`;
  }
  return 'Nothing has changed. Show the user every value and level and what each rests on. A value marked your_figure ' +
    "or a level with stated_by 'user' is the user's own figure and will be saved as theirs: never call it an assumption. " +
    `Say plainly that the others are assumptions to adopt or correct, NOT measurements, ${tail}`;
}

/** Request-grounded identity is the alternative to naming both ends in this sentence. */
function linkSelectedByRequest(ctx: AgentToolContext, from: string, to: string): boolean {
  const selection = ctx.grounded_selection;
  return selection !== undefined && selection.unresolved === 'none'
    && (selection.element_ids.includes(from) && selection.element_ids.includes(to)
      || (ctx.grounded_links ?? []).some(link => link.from === from && link.to === to));
}
function linkEffectConsent(raw: unknown, from: string, to: string, effect: { amount: number; per_source_change: number }): { reversal?: LinkEffectReversal } {
  const found = linkEffectTargetOf(raw, from, to);
  if (found.kind !== 'one') return {};
  const edge = found.edge;
  const mean = isPlainRecord(edge.strength) ? edge.strength.mean : undefined;
  const stored = edge.effect_direction === 'positive' || edge.effect_direction === 'negative' ? edge.effect_direction
    : typeof mean === 'number' && mean !== 0 ? (mean < 0 ? 'negative' : 'positive') : undefined;
  // No-dead-end (B): through a gauge the stored link is lever→M, sized E × g — the writer's ONE statement rule.
  const sized = linkEffectGaugeStatement(raw, from, to, effect);
  const wanted = Math.sign(sized.amount) * Math.sign(sized.per_source_change) < 0 ? 'negative' as const : 'positive' as const;
  return stored !== undefined && stored !== wanted ? { reversal: { from: stored, to: wanted } } : {};
}
function linkEffectStatementAsk(miss: string, from: string, to: string, figureAsk?: string): string {
  // A figure written as a level, or counting another unit: ask about THAT figure (PR Review's CRs, restored as one question).
  if (figureAsk !== undefined && (miss === 'source_figure_a_level' || miss === 'target_figure_a_level' || miss === 'figure_counts_another_unit' || miss === 'figure_of_another_quantity')) return figureAsk;
  if (miss === 'end_not_named') return `Which link do you mean: “${from}” → “${to}”?`;
  if (miss === 'unclear_figure') return `What single change in “${to}” do you mean, rather than a range?`;
  if (miss === 'figures_not_in_statement') return `How much does “${from}” move “${to}”, in figures?`;
  return `How much does “${from}” move “${to}”, using the figures you wrote?`;
}

/** Canonical's link-effect refusal, said to the Agent in words it can relay truthfully (never a code). */
/**
 * The approved readings that a fresh read of THIS graph still makes (Codex r1 on the RT-6 row-1 fix). A reading the graph
 * has since contradicted (an end now reads GBP, the hash unchanged) is what the writer just refused, so the refusal's
 * words must never put it back and say the end "is measured in %".
 */
function stillReadUnitReadings(graph: unknown, item: { readonly from: string; readonly to: string;
  readonly effect: { readonly amount: number; readonly amount_unit: string; readonly per_source_change: number; readonly per_source_change_unit: string };
  readonly quote: string; readonly unit_readings?: readonly LinkEffectUnitReading[]; readonly link_selected?: true }): readonly LinkEffectUnitReading[] | undefined {
  if (item.unit_readings === undefined || item.unit_readings.length === 0) return undefined;
  const fresh = prepareLinkEffectUnitReadings(graph, item.from, item.to, item.effect, item.quote, { link_selected: item.link_selected === true }).unit_readings;
  return item.unit_readings.filter((r) => fresh.some((f) => f.node_id === r.node_id && f.unit_reading.unit === r.unit_reading.unit
    && f.unit_reading.source_quote === r.unit_reading.source_quote));
}

/**
 * ⭐ S5t: the receipt's one sentence for a refit (Science d5 #87 6009444385, verbatim; DL adopted; c6 checks the guards).
 * A frame is a choice of units, so every other link means the same; a band word read off β may not (cut-7 follow-up).
 */
export function frameRefitReceipt(nodes: readonly string[]): string {
  const named = nodes.map((n) => `‘${n}’`);
  const list = named.length <= 1 ? named.join('') : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return `Olumi rescaled ${list} so your figure fits. Your other links mean the same as before, though some strength words may read differently.`;
}

/**
 * ⭐ RT-18 (DL 0df0e1, cut 5): the words for a link the model does NOT hold. Never a click route to that link (the canvas
 * does not show it); always a next step the user can take. If the source reaches the target through other links, the
 * FIRST of them is named with its own canvas route (a link the canvas shows). Otherwise Olumi offers to add the link for
 * approval (`propose_model_change`, add_edge), after which the figure can size it.
 */
function linkEffectNoSuchLinkWords(raw: unknown, from: { id: string; label: string }, to: { id: string; label: string }): string {
  return `Nothing was prepared. Tell the user exactly this: "${noSuchLinkUserWords(raw, from, to)}"`;
}

function linkEffectRefusalWords(reason: LinkEffectRefusal, raw: unknown, from: { id: string; label: string }, to: { id: string; label: string },
  /** RT-6: the stated effect, when known, so a unit refusal names the END that failed. */
  effect?: { readonly amount_unit: string; readonly per_source_change_unit: string },
  /**
   * The card's disclosed unit readings, when the sentence stated an end's unit: the words read the SAME view the writer
   * refused on (red team #87 6004429045 — off the stored graph, an end whose unit the user had just written was called
   * "no unit or scale").
   */
  unitReadings?: readonly LinkEffectUnitReading[]): string {
  const view = withLinkEffectUnitReadings(raw, unitReadings);
  const unitOfNode = (id: string): string => {
    const n = ((view as { nodes?: unknown[] } | null)?.nodes ?? []).find((x) => (x as { id?: unknown })?.id === id) as
      { observed_state?: { unit?: unknown }; unit_reading?: { unit?: unknown } } | undefined;
    const goalUnit = readGoalRecord(view, id)?.target?.unit;
    // No-dead-end (C)/(B): a level-less mediator is measured in its derived unit, as the writer reads it (a gauge only as
    // the target of the answer), so the Agent can ask for the figure in it. Every other end reads exactly as before.
    const mediated = mediatorReadings(view).get(id);
    const derived = mediated === undefined || (mediated.via === 'gauge' && id !== to.id) ? undefined : mediated.unit;
    return typeof n?.observed_state?.unit === 'string' ? n.observed_state.unit
      : typeof n?.unit_reading?.unit === 'string' ? n.unit_reading.unit
      // A goal's unit is its target's (hiring served 14 Oct: "Productivity is measured in its own unit" left the Agent
      // nothing to retry with; the writer accepts "%", `linkEffectEndUnits`).
      : typeof goalUnit === 'string' && goalUnit.trim() !== '' ? goalUnit
      : derived ?? 'its own unit';
  };
  switch (reason) {
    case 'unit_mismatch': {
      // RT-6: an end with no unit (and no size already said for this link) has nothing to state a figure in. Say THAT,
      // never "in its own unit": the user cannot answer in a unit the model does not have.
      const ends = linkEffectEndUnits(view, from.id, to.id);
      const fails = (stated: string | undefined, u: { own: readonly string[]; adopted?: string }): boolean =>
        stated === undefined || !statedInOneOf(stated, [...u.own, u.adopted]);
      const sourceFails = ends !== null && fails(effect?.per_source_change_unit, ends.source);
      const targetFails = ends !== null && fails(effect?.amount_unit, ends.target);
      const unitless = ends === null ? [] : ([[from, ends.source, sourceFails], [to, ends.target, targetFails]] as const)
        .filter(([, u, failed]) => failed && u.own.length === 0 && u.adopted === undefined).map(([end]) => end);
      if (unitless.length > 0) {
        // RT-6 step 1 (DL ruling on red-team #87 5996558645; words: Science #87 check): never a dead end, and never the Agent's own paraphrase ("with
        // the available tools"). One fixed sentence names the route that works today — the link panel's own control by
        // its visible label (inspectorStrings `strengthQuestion`, StrengthBandButtons) — by both ends of THIS link.
        const names = unitless.map((end) => `\u201c${end.label}\u201d`).join(' and ');
        return 'Nothing was prepared. Tell the user exactly this: '
          + `"${names} ${unitless.length > 1 ? 'have' : 'has'} no unit or scale in this model yet, so I can\u2019t record your figure from `
          + 'chat, and nothing was recorded. You can set how strong this link is now: on the canvas, click the link from '
          + `\u201c${from.label}\u201d to \u201c${to.label}\u201d, and under \u201cHow strong is this effect?\u201d choose Slight, Moderate, Strong `
          + 'or Very strong. That records how strong you judge the link, not your figure."';
      }
      // A % LEVEL target takes its change in points only: say THAT (Science 5993238492), never "measured in %".
      if (ends !== null && effect !== undefined && targetFails && !sourceFails && ends.target.own.length > 0 && ends.target.own.every(u => statedInOneOf(u, POINTS_STATED))) {
        return `Nothing was prepared: a change in "${to.label}" is recorded in percentage points. Ask the user whether they mean `
          + 'points (62% → 60% is 2 points) and for their figure in points; never convert a relative % yourself.';
      }
      return `Nothing was prepared: "${to.label}" is measured in ${unitOfNode(to.id)} and "${from.label}" in ${unitOfNode(from.id)}. `
        + 'Ask the user for their figure in those units; never convert it yourself.';
    }
    case 'sign_conflict':
      return `Nothing was prepared: the user's figure says "${from.label}" moves "${to.label}" the OTHER way from the link Olumi has. `
        + 'Tell them so plainly, and offer to reverse the link\u2019s direction with propose_link_strength (their words on one link).';
    case 'superseded':
      return 'Nothing was prepared: the model changed while this was being read. Read the state again and propose once more.';
    case 'target_ambiguous':
      return `Nothing was prepared: the model holds more than one link from "${from.label}" to "${to.label}", or more than one entity under `
        + 'one of their ids, so there is no ONE link the user\u2019s figure is for. Tell the user plainly; never pick one of them.';
    // The sizer's own terms and questions (`link-effect.ts` D7). At the answer door the writer refuses and asks (Canonical
    // 5883568580): nothing is stored, the user's figure stays in the reply, and never shrunk to fit.
    // AIQ 5883669977: the user's stated figure never yields first. No typed field says whose a cap is (Canonical
    // 5883707376), so the words claim neither owner, and offer no range change until a reframe door exists.
    case 'not_representable': {
      const rangeOf = (id: string): string => {
        const os = (((raw as { nodes?: unknown[] } | null)?.nodes ?? []).find((x) => (x as { id?: unknown })?.id === id) as
          { observed_state?: { cap?: unknown; unit?: unknown } } | undefined)?.observed_state;
        return typeof os?.cap === 'number' && Number.isFinite(os.cap) ? ` (up to ${os.cap}${typeof os.unit === 'string' ? ` ${os.unit}` : ''})` : '';
      };
      return `Nothing was prepared: the user's figure is more than the analysis can represent on the range the model uses for "${from.label}"`
        + `${rangeOf(from.id)} and "${to.label}"${rangeOf(to.id)}, so it would be cut short. Repeat their figure in their own words, and say `
        + 'plainly that it is that range, not their figure, that stops it being used here. Never ask them to change their figure first, '
        + 'and never shrink it yourself. Nothing was recorded. Then give them the one route that works today (S5t: never a refusal '
        + 'with no way forward), in exactly these words: "You can set how strong this link is now: on the canvas, click the link from '
        + `\u201c${from.label}\u201d to \u201c${to.label}\u201d, and under \u201cHow strong is this effect?\u201d choose Slight, Moderate, Strong or Very strong. `
        + 'That records how strong you judge the link, not your figure."';
    }
    case 'out_of_domain':
      return `Nothing was prepared: across the options, the user's figure would take "${to.label}" outside the range it can hold. Repeat `
        + `their figure in their own words, tell them so plainly and ask whether the size of that effect should change, or today's level `
        + `of "${to.label}". Never adjust their figure yourself.`;
    default:
      return `Nothing was prepared: this effect cannot be recorded with this model yet (${String(reason).replace(/_/g, ' ')}). Tell the user plainly.`;
  }
}

/**
 * RT-6 step 2 (Science U3): ONE question first, then the canvas control as the alternative, in one quoted sentence.
 * Nothing is recorded until the user answers, so it never says the figure "can't" be recorded from chat.
 */
function linkEffectUnitAskWords(ask: string, from: { label: string }, to: { label: string }): string {
  return 'Nothing was prepared. Tell the user exactly this: "'
    + `${ask} Nothing is recorded until you answer. If you\u2019d rather not answer, you can set how strong this link is `
    + `on the canvas: click the link from \u201c${from.label}\u201d to \u201c${to.label}\u201d, and under \u201cHow strong is this effect?\u201d `
    + 'choose Slight, Moderate, Strong or Very strong. That records how strong you judge the link, not your figure."';
}

/**
 * ⭐ FU-1 (DL 0df0e1, "never re-ask what the user has closed"): a DENIAL that says the link does not change at all ("It
 * doesn't change.", `saysNoChange`) ends the ask. Nothing is recorded and nothing is asked: the restatement ask itself
 * promised "If “T” does not change, the link stays as it is", so asking again for "the figures you wrote" breaks that
 * promise. Any other denial (a corrected size or direction, a denied figure) still gets its ask (Codex r1 + r2 on #2664).
 */
function linkEffectDeniedWords(from: { label: string }, to: { label: string }): string {
  return 'Nothing was prepared. Tell the user exactly this: "'
    + `Nothing is recorded: the link from \u201c${from.label}\u201d to \u201c${to.label}\u201d stays as it is."`;
}

/** A stored card can carry only the strict, bounded NodeV3 unit reading of one of its own ends. */
function isLinkEffectUnitReadings(value: unknown, from: string, to: string): value is readonly LinkEffectUnitReading[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 2) return false;
  const seen = new Set<string>();
  return value.every((entry) => {
    if (!isPlainRecord(entry) || Object.keys(entry).length !== 2 || typeof entry.node_id !== 'string'
      || (entry.node_id !== from && entry.node_id !== to) || seen.has(entry.node_id) || !isPlainRecord(entry.unit_reading)) return false;
    const reading = entry.unit_reading;
    if (Object.keys(reading).length !== 3 || typeof reading.unit !== 'string' || reading.unit.length < 1 || reading.unit.length > 40
      || reading.source !== 'user_stated' || typeof reading.source_quote !== 'string' || reading.source_quote.length < 1 || reading.source_quote.length > 500) return false;
    seen.add(entry.node_id);
    return true;
  });
}

const isPlainRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const pickKeys = (o: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/**
 * ⛔ AN EARLIER ANALYSIS IS NOT PERMISSION TO RUN. The read route's `analysis_state.readiness` is a
 * PLACEHOLDER (`{status:'unknown', blockers:[]}`; an empty list the composer treats as "nothing blocking"),
 * so it is dropped here: whether a run may happen now is `readiness`, only. What the stored RESULT is — an
 * earlier run, current or stale — stays, named `earlier_analysis` so it is never read as admission.
 */
/**
 * ⭐ THE SAVED RUN'S OWN GOAL CERTAINTY, BESIDE THE EARLIER ANALYSIS (P0 builder #72 5889970136). A follow-up turn, or a
 * reloaded conversation, is given this state with no Run in its own history: it had only "an earlier analysis exists",
 * and filled in the rest (browser `d51ed683`: "all three goal chances withheld because the churn limit…", over £49's
 * EARNED 0 and £54/£59's unearned 0 with their `say`). The Run the read SELECTED, bound to its own result by run identity
 * (`goalCertaintyForAgent`, the one reader): its recorded decisions and each `say`, or `unchecked` when it cannot be bound
 * (a stale Run, nothing recorded, a refused record). No second truth, nothing recomputed.
 */
function withSavedRunCertainty(context: Record<string, unknown>, scenarioId: string, g: Omit<GraphRead, 'run_delta'> & Pick<SavedRunContextFactsRead, 'run_delta'>): Record<string, unknown> {
  const analysis = context.analysis as Record<string, unknown> | undefined;
  if (analysis === undefined) return context;
  const certainty = goalCertaintyForAgent(g.analysis_result, { scenario_id: scenarioId, analysis_state: g.analysis_state }, g);
  // The graph read selects ONE current Run. Carry only its recorded per-option outcomes, in record order; a withheld
  // comparative leader does not erase ranges (AI Quality #72 5890704395). The raw P(goal), win share and ranking
  // fields never come across this projection. A missing outcome stays missing, never a numeric zero.
  const rec = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const current = rec(rec(g.analysis_state)?.run_state)?.kind === 'complete_current';
  const goalChance = current ? withGoalChance(g.analysis_result, g.raw).goal_chance : undefined;
  // Leader permission governs comparison only. Each current option reads its own stored goal-chance entitlement.
  const permissions = claimPermissionsFrom(g.analysis_state, { analysis_admission: g.analysis_admission }, { requested: true });
  const selectedPermissions = current && g.analysis_result !== undefined && permissions.leader_may_be_named !== true
    ? withNonlinearIdentity(permissions, g.raw, g.identity_evaluated) : permissions;
  const goalFacts = goalChanceFactsForAgent(g.analysis_result, g.raw, current);
  const goalChanceDisplay = goalFacts.goal_chance_display;
  const legacyRun = !runHasGoalChanceLicenceRecord(g.analysis_result);
  // ⭐ (9) chat and panel quote the same figure: a chance the licence displays at the nearest 5 is handed over as displayed.
  const shownChance = nearestFiveGoalChancesForAgent(g.analysis_result);
  const compared = rec(rec(g.analysis_result)?.enrichment)?.option_comparison;
  const optionNames = optionNameAliasesForCurrentRun(g);
  const decisions = Array.isArray(certainty?.options) ? certainty.options : [];
  const byId = new Map(decisions.flatMap((value) => {
    const row = rec(value);
    return typeof row?.option_id === 'string' ? [[row.option_id, row] as const] : [];
  }));
  const savedRunOptions = current && Array.isArray(compared) ? compared.flatMap((value) => {
    const row = rec(value);
    const id = row?.option_id ?? row?.id;
    if (typeof id !== 'string') return [];
    const label = row?.option_label ?? row?.label;
    const decision = byId.get(id);
    // A Run with no GOAL_CHANCE_LICENSED record (served before #2625) keeps W3's rule: a leader that may be named carries
    // each recorded chance (Science 393023, S2 CI: saved-run-chance.shared-data 520aab46). A licensed Run reads its licence.
    const chancePermitted = legacyRun
      ? current && goalChance === undefined && permissions.leader_may_be_named === true
      : goalChanceDisplay !== undefined && Object.hasOwn(goalChanceDisplay, id);
    const projectedChance = chancePermitted && typeof row?.probability_of_goal === 'number'
      ? goalChancePointForAgent(row.probability_of_goal, goalChanceDisplay?.[id], shownChance.get(id)) : undefined;
    return [{ option_id: id,
      ...(typeof label === 'string' ? { option_label: label } : {}),
      // A contract-valid row may carry neither alias nor label: undefined === undefined must not dereference a missing alias.
      ...((alias => alias !== undefined && alias.raw === label ? { display_label: alias.display } : {})(optionNames.get(id))),
      ...(goalChance === undefined && rec(row?.outcome) !== undefined ? { outcome: row!.outcome } : {}),
      ...(projectedChance !== undefined && typeof row?.probability_of_goal === 'number' && row.probability_of_goal > 0 && row.probability_of_goal < 1
        ? { probability_of_goal: projectedChance } : {}),
      ...(decision !== undefined && !Object.hasOwn(goalFacts.goal_chance_range_display ?? {}, id) ? { goal_certainty: decision } : {}),
    }];
  }) : [];
  // Participation belongs to the same selected, delivered current Run. Only labels come from this read's graph;
  // today's option authorship, adoption and status never reinterpret the Run's recorded reason.
  const labels = new Map(g.nodes.filter((n) => n.kind === 'option').map((n) => [n.id, n.label]));
  const labelledOption = (id: string): { option_id: string; label?: string } => ({
    option_id: id, ...(labels.has(id) ? { label: labels.get(id)! } : {}),
  });
  const participation = current && g.analysis_result !== undefined && g.option_participation !== undefined
    ? g.option_participation
      .map((entry) => ({ ...entry, ...labelledOption(entry.option_id),
        ...(entry.unanalysable_user_option_ids === undefined ? {} : {
          unanalysable_user_options: entry.unanalysable_user_option_ids.map(labelledOption),
        }),
      }))
    : undefined;
  return { ...context, analysis: { ...analysis,
    claim_permissions: selectedPermissions,
    ...savedRunContextFacts(scenarioId, g, selectedPermissions),
    ...(certainty !== undefined ? { goal_certainty: certainty } : {}),
    ...(goalChance !== undefined ? { goal_chance: goalChance } : {}),
    ...(savedRunOptions.length > 0 ? { saved_run_options: savedRunOptions } : {}),
    // ⭐ DL 0df0e1 ruling C (6 Oct): where each option's chance reaches the Agent, so does the Run's licence to compare them.
    ...goalFacts,
    ...(participation !== undefined ? { option_participation: participation } : {}),
    // #3167 fix-forward (AIE 6180618773 T9): the risks THIS selected Run recorded leaving out, and the narrower scope its chances
    // cover. A typed fact of the Run, never today's model's set; a Run that recorded none carries nothing.
    ...((omitted) => (current && omitted !== undefined ? { omitted_from_calculation: { scope: 'modelled_effects_only', risks: omitted } } : {}))(
      runOmittedRisks(g.analysis_result)),
    // ⭐ GOAL-REACH (#2838 rebuilt, DL 14 Oct): every licensed option below the floor → the model's own reason and the one
    // question, as a fact of this same current Run, for the AI to word (`out-of-reach-why.ts`).
    ...((why) => (why !== null ? { goal_out_of_reach: goalOutOfReachFact(why) } : {}))(current ? outOfReachWhyOf(g.analysis_result, g.raw) : null),
  } };
}

function earlierAnalysisOf(state: unknown, analysisReady?: unknown): { analysis: Record<string, unknown> } | undefined {
  if (state === null || typeof state !== 'object') return undefined;
  const { readiness: _placeholder, ...stateRest } = state as Record<string, unknown>;
  const ready = analysisReady !== null && typeof analysisReady === 'object'
    ? analysisReady as Record<string, unknown> : null;
  const rest: Record<string, unknown> = { ...stateRest, ...(ready?.freshness === 'stale' && typeof ready.freshness_reason === 'string'
    ? { freshness_reason: ready.freshness_reason } : {}) };
  // The read retains the older successful Run's lifecycle when a newer
  // degraded Run supersedes it. Do not echo `complete_current` to the Agent:
  // the old result is absent and the canonical verdict requires a rerun.
  if (Array.isArray(rest.contradictions)
    && rest.contradictions.includes('fact_status_success_but_degraded_newer')) {
    const { run_state: _olderRun, ...withoutOlderRun } = rest;
    return { analysis: { earlier_analysis: 'superseded_by_newer_degraded_run', ...withoutOlderRun } };
  }
  const kind = (rest.run_state as { kind?: unknown } | undefined)?.kind;
  return { analysis: { ...(typeof kind === 'string' ? { earlier_analysis: kind } : {}), ...rest } };
}

/**
 * ⭐ A STRENGTH WORD IS A BAND ON THE ONE EDGE-STRENGTH TABLE (`format/edge-strength-bands.ts`, the canvas's own cuts
 * and pill midpoints). When a link must be SET to a band the user named, it is set to that band's midpoint — the
 * number the canvas's own pill for that band writes — so the band the user said is the band the canvas draws, and the
 * preview says the figure before the user approves it. (It read `INFLUENCE_BAND_THRESHOLDS`, a SENSITIVITY table:
 * "strong" stored 0.825, which the canvas drew "Very strong" — R&C #70 5846846471.)
 */
const bandMidpoint = (band: InfluenceBand): number => EDGE_STRENGTH_MIDPOINTS[band];
/** The most links one set carries: Paul's served set was eight; twelve covers a whole starting model's causal links. */
const MAX_LINK_SET = 12;

/** What the Agent tells the user about a reading: whose words, which band, and that approving it approves the reading. */
const readingNote = (i: ProposalInterpretation): string =>
  `This is your reading of the user\u2019s own words "${i.from_words}" as ${linkBandWord(i.reading as InfluenceBand)}: say so plainly `
  + `("I\u2019ve read your \u201c${i.from_words}\u201d as ${linkBandWord(i.reading as InfluenceBand)}"), so that approving it approves that reading. `;

/**
 * ⭐ HOW A LINK'S BAND IS GROUNDED IN THE USER'S WORDS (slice C3; ruling ChatGPT 5854968869 P3B). Measured on Paul's
 * served transcript (27 Sep): "price sensitivity is very high" was refused `strength_not_stated` twice, and recording
 * "very strong" took four turns for one action.
 *
 * - `literal`: the user named the band itself this turn (`bandTheUserWrote`) — today's path, unchanged.
 * - `reading`: the user described it in their own words, and the Agent gave that phrase as `from_words`. Admitted only
 *   when the phrase is written, as whole words, in THIS turn's typed message, said rather than asked or denied
 *   (`wordsTheUserWrote`), and holds no band word (a band word is the literal matcher's alone). The Agent's reading is
 *   carried as an `interpretation` the user sees on the approve button and approves.
 * - `null`: neither — refused exactly as before. The Agent cannot invent the user's words.
 */
function bandGrounding(band: InfluenceBand, fromWords: unknown, turnText: string | undefined):
  { readonly kind: 'literal' } | { readonly kind: 'reading'; readonly interpretation: ProposalInterpretation } | null {
  if (bandTheUserWrote(band, turnText)) return { kind: 'literal' };
  if (typeof fromWords !== 'string' || holdsABandWord(fromWords) || !wordsTheUserWrote(fromWords, turnText)) return null;
  const phrase = fromWords.trim();
  return { kind: 'reading', interpretation: { field: 'band', from_words: phrase, reading: band, shown_as: `Record as ${linkBandWord(band)} (your "${phrase}")` } };
}
const isInfluenceBand = (v: unknown): v is InfluenceBand => typeof v === 'string' && Object.hasOwn(EDGE_STRENGTH_MIDPOINTS, v);

/**
 * ⛔ A NAME SHARED BY TWO ACCEPTABLE TARGETS NAMES NEITHER.
 *
 * Every proposer resolved the Agent's label with a first match — `pool.find(writable)
 * ?? pool[0]` for values, `nodes.find(...)` for levels and links — so when two
 * factors share a label, the one that happens to come first in the stored node list
 * got the user's number, and the approval they were shown named only the label.
 * Nothing about the user's words chose it; array order did.
 *
 * The tool schemas carry labels only (`agent-tools.ts`: `factor_label`,
 * `option_label`, `from_label`, `to_label`; `additionalProperties: false`), but
 * `get_canonical_state` shows every entity's `id` (see `projectEntity`). So:
 *
 *   1. A string that IS a node id makes that node a candidate — the one way to
 *      address two entities that read alike (ids are unique; labels are not).
 *   2. An exact visible LABEL wins over a description match (unchanged).
 *   3. Among all candidates, exactly one acceptable node → it. MORE THAN ONE (two
 *      same-label factors, or an id that is also another factor's label) →
 *      `ambiguous`, with every candidate, and the caller proposes NOTHING for it.
 *   4. None acceptable → `other` (named, but e.g. a risk), or `none`.
 *
 * A label shared by a factor and a risk still resolves to the factor: only ONE of
 * them is acceptable, so nothing is guessed.
 */
type Resolution =
  | { readonly kind: 'one'; readonly node: GraphRead['nodes'][number] }
  | { readonly kind: 'ambiguous'; readonly candidates: GraphRead['nodes'] }
  | { readonly kind: 'other'; readonly node: GraphRead['nodes'][number] }
  | { readonly kind: 'none' };

/**
 * DL ruling 12 Oct (Paul's test: never a dead end) and AIE 6128697025 (row 10): the canvas step, the canvas edit of the goal to
 * the targets the user gave, is said ONLY when every target's quantity is already on the canvas. Otherwise this route cannot
 * add the missing quantities or conditions without replacing the saved work: the AIE's words, verbatim, then what is missing,
 * named from the actual request. The revised-draft card is not offered in its place: it could not truthfully say the user's
 * work survives (its edits are not carried, and a guest has no earlier version to go back to).
 */
export function draftGateDetail(found: readonly string[], stage: 'offered' | 'replaced',
  targets: readonly { readonly words: string; readonly onCanvas: boolean }[]): string {
  if (targets.length > 0 && targets.every((t) => t.onCanvas)) {
    return `Olumi found ${found.join('; ')}, so a revised draft was not ${stage}: replacing the draft could discard your work, `
      + 'and nothing was changed. Tell the user that plainly, that their goal is not yet in the model, and give the one step that '
      + `works today: edit the goal on the canvas to ${targets.map((t) => t.words).join(' and ')}. Never rebuild part of it.`;
  }
  const missing = targets.filter((t) => !t.onCanvas).map((t) => t.words);
  return 'This goal change was not applied. The model needs quantities or conditions it does not yet hold, and this route cannot '
    + `add them without replacing your saved work.${missing.length > 0 ? ` Missing: ${missing.join(' and ')}.` : ''}`;
}

function resolveNamed(
  g: Pick<GraphRead, 'nodes'>,
  requested: string,
  accept: (n: GraphRead['nodes'][number]) => boolean,
): Resolution {
  const byLabel = g.nodes.filter((n) => norm(n.label) === norm(requested));
  const pool = byLabel.length > 0 ? byLabel : g.nodes.filter((n) => norm(n.description) === norm(requested));
  const idHit = g.nodes.find((n) => n.id === requested);
  const candidates = idHit === undefined ? pool : [idHit, ...pool.filter((n) => n.id !== idHit.id)];
  const acceptable = candidates.filter(accept);
  if (acceptable.length > 1) return { kind: 'ambiguous', candidates: acceptable };
  if (acceptable.length === 1) return { kind: 'one', node: acceptable[0] };
  return candidates.length > 0 ? { kind: 'other', node: candidates[0] } : { kind: 'none' };
}

/** A canonical request-selected directed edge disambiguates its ends; labels are only display/statement data. */
function resolveLinkEffectEnds(g: GraphRead, ctx: AgentToolContext, fromName: string, toName: string): readonly [Resolution, Resolution] {
  const matches = ctx.grounded_selection?.unresolved === 'none' ? (ctx.grounded_links ?? []).flatMap(link => {
    const from = g.nodes.find(n => n.id === link.from);
    const to = g.nodes.find(n => n.id === link.to);
    const names = (node: GraphRead['nodes'][number], requested: string): boolean => node.id === requested || norm(node.label) === norm(requested);
    return from !== undefined && to !== undefined && names(from, fromName) && names(to, toName)
      && linkEffectTargetOf(g.raw, from.id, to.id).kind === 'one' ? [{ from, to }] : [];
  }) : [];
  if (matches.length === 1) return [{ kind: 'one', node: matches[0]!.from }, { kind: 'one', node: matches[0]!.to }];
  return [resolveNamed(g, fromName, () => true), resolveNamed(g, toName, () => true)];
}

/** One name that matched more than one acceptable entity, with every candidate. */
type AmbiguousTarget = { readonly requested: string; readonly candidates: readonly Record<string, unknown>[] };

/** One ambiguous request, with what tells its candidates apart — the SAME projection as every other tool. */
/**
 * Recovery Batch B (SYS3 TRACE L6): the ONE sentence of the user's own words that states BOTH ends of a range ("currently
 * they spend between 20% and 30% of their time on non-development tasks …"), whole and trimmed, or `null`. Sentences end
 * where `quoteOfFigure`'s do (. ! ? before a space, or a new line); each end must be a figure `quoteOfFigure` finds in
 * that sentence, in the figure's unit. Longer than a hold quote may be: `null` (asked, never cut).
 */
function sentenceStatingBoth(low: number, high: number, unit: string, userText: string): string | null {
  for (const raw of userText.split(/(?<=[.!?])(?=\s)|\n/)) {
    const sentence = raw.trim();
    if (sentence === '' || sentence.length > USER_TODAY_QUOTE_MAX) continue;
    if (quoteOfFigure(low, unit, sentence) !== null && quoteOfFigure(high, unit, sentence) !== null) return sentence;
  }
  return null;
}

function describeAmbiguity(g: Pick<GraphRead, 'nodes' | 'edges'>, requested: string, candidates: GraphRead['nodes']): AmbiguousTarget {
  const labelOf = new Map(g.nodes.map((n) => [n.id, n.label]));
  return {
    requested,
    candidates: candidates.map((n) => ({
      ...projectEntity(n),
      connected_to: [...new Set(g.edges.flatMap((e) =>
        e.from === n.id ? [labelOf.get(e.to)] : e.to === n.id ? [labelOf.get(e.from)] : []))]
        .filter((l): l is string => typeof l === 'string' && l !== '')
        .sort(),
    })),
  };
}

/**
 * ⛔ CONSENT NAMES AN IDENTITY, UNIQUE ACROSS THE WHOLE GRAPH (P1-4; DL #2561 round 2). A label no other node carries is
 * kept verbatim. A shared label takes the read's distinguishing context: its description, else what it is linked to. That
 * name is kept only when NO node's literal label, no other name, and no other shared-label node's id name reads the same
 * (a `Price` described "Pilot" never reads as a node literally labelled "Price (Pilot)"). Otherwise it falls back to its
 * id, and an id name that is itself taken gains a counter, so no two entities ever read the same on a card.
 */
function cardNamesOf(g: Pick<GraphRead, 'nodes' | 'edges'>): ReadonlyMap<string, string> {
  // What a reader cannot tell apart on a card: case, surrounding and repeated spaces, and a trailing ellipsis (with any
  // spaces around it). Coarser than `norm` on purpose (Codex round 3: "Price (Pilot)… " read as "Price (Pilot)").
  const key = (s: unknown): string => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/\s*(?:…|\.\.\.)+$/, '').trim();
  const names = new Map<string, string>();
  const groups = new Map<string, GraphRead['nodes'][number][]>();
  for (const n of g.nodes) groups.set(key(n.label), [...(groups.get(key(n.label)) ?? []), n]);
  const shared: { id: string; label: string; name: string }[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) { names.set(group[0]!.id, group[0]!.label); continue; }
    // Reuse the ambiguity response's deduplicated, sorted connected_to labels, comparing the rendered words.
    const connections = describeAmbiguity(g, group[0]!.label, group).candidates.map((n) => ({
      id: n.id, words: (n.connected_to as string[]).join(', '),
    }));
    for (const n of group) {
      const description = n.description?.trim();
      const connected = connections.find((c) => c.id === n.id)!.words;
      const suffix = description && group.every((r) => r.id === n.id || key(r.description) !== key(description))
        ? description
        : connected !== '' && connections.every((c) => c.id === n.id || c.words !== connected)
          ? `linked to ${connected}` : n.id;
      shared.push({ id: n.id, label: n.label, name: `${n.label} (${suffix})` });
    }
  }
  const taken = new Set(g.nodes.map((n) => key(n.label)));
  const idName = (n: { id: string; label: string }): string => `${n.label} (${n.id})`;
  const fallback: typeof shared = [];
  for (const n of shared) {
    const clash = taken.has(key(n.name))
      || shared.some((o) => o.id !== n.id && (key(o.name) === key(n.name) || key(idName(o)) === key(n.name)));
    if (clash) fallback.push(n);
    else names.set(n.id, n.name);
  }
  for (const name of names.values()) taken.add(key(name));
  for (const n of [...fallback].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    let name = idName(n);
    for (let k = 2; taken.has(key(name)); k += 1) name = `${n.label} (${n.id}, ${k})`;
    names.set(n.id, name);
    taken.add(key(name));
  }
  return names;
}

/** The one card name of a node (`cardNamesOf`); an id the read does not hold is said as itself. */
function cardNameOf(g: Pick<GraphRead, 'nodes' | 'edges'>, nodeId: string): string {
  return cardNamesOf(g).get(nodeId) ?? nodeId;
}

/** What the Agent is told to do about a name that matched more than one entity. */
const AMBIGUOUS_NOTE =
  'More than one entity in the model carries each name in ambiguous_targets, so NOTHING was proposed for it and no ' +
  'guess was made. Ask the user which one they mean, describing each candidate by what tells it apart (its full ' +
  'label, current value, what it is connected to), never by its id. Then propose again, passing that entity’s ' +
  '`id` exactly as given here in place of its label.';

/**
 * Why a new risk reaches nothing (Canonical 5856206675: "the refusal must name the missing link type so the Agent can
 * propose it"). What it would hurt does not lead to the goal, so it cannot change the comparison. The one link the
 * Agent CAN propose is risk → goal (an `affects` entry naming the goal); a link from that outcome to the goal is not
 * an Agent move, so it is named as the canvas's, never offered.
 */
function riskUnreachableWhy(g: Pick<GraphRead, 'nodes'>, risk: string, links: readonly { to_id?: string }[]): string {
  const goal = g.nodes.find((n) => n.kind === 'goal');
  const hurt = [...new Set(links.flatMap((l) => {
    const n = l.to_id !== undefined ? g.nodes.find((x) => x.id === l.to_id) : undefined;
    return n !== undefined ? [`"${n.label}"`] : [];
  }))].join(' and ');
  const goalName = goal !== undefined ? `"${goal.label}"` : 'the goal';
  return ` The missing link is risk → goal: in the model, ${hurt || 'what it would hurt'} does not lead to ${goalName}, so "${risk}" could not `
    + `change the comparison. Ask the user whether "${risk}" would also hurt ${goalName} directly; if they say so, propose it again with ${goalName} in affects. `
    + `A link from ${hurt || 'that outcome'} to ${goalName} is added on the canvas, not here — never offer to add it.`;
}

/** How strongly a new factor's one link acts, as the add-factor door says it: Olumi's placeholder, never an estimate. */
const FACTOR_PLACEHOLDER_STRENGTH = 'not known yet: Olumi uses a placeholder strength for the link, not an estimate';

/** A goal target's direction, in words (the product's own receipt says "at least" / "at most"). */
const DIRECTION_WORDS = { at_least: 'at least', at_most: 'at most', below: 'below', above: 'above' } as const;
type TargetDirection = keyof typeof DIRECTION_WORDS;
const TARGET_OPERATOR = { at_least: '>=', at_most: '<=', below: '<', above: '>' } as const;
const inclusiveTargetDirection = (type: TargetDirection): 'at_least' | 'at_most' =>
  type === 'below' || type === 'at_most' ? 'at_most' : 'at_least';
/**
 * A goal target's or a limit's figure as the user writes it ("£20,000 over 6 months", "£100,000 per month", "5%"): the
 * lane's one figure formatter (DL #72 5866282787: "20000 £ over 6 months" reached a consent subject). A figure it cannot
 * say exactly keeps the approve chip's own formatter, else the target writer's receipt formatter.
 */
const targetFigure = (value: number, unit: string): string =>
  sayFigureExactly(value, unit) ?? figureInUserUnits(value, unit) ?? formatValueWithUnit(value, unit);

/**
 * ⛔ A GOAL TARGET IS CONFIRMED WHERE THE PRODUCT'S WRITER PUTS IT, never from a status code. `add_constraint` (behind
 * `goal_target_edit`) upserts the goal's `goal_constraints` row keyed by (node_id, operator) with `value` = the raw
 * figure, for both directions; for at least it also stamps the goal's own `goal_threshold_raw` (what the Agent's
 * `target` and the UI read). Both must hold exactly what was approved.
 */
function goalTargetHolds(raw: Record<string, unknown>, goalId: string, v: { constraint_type: TargetDirection; raw_value: number }): boolean {
  const type = inclusiveTargetDirection(v.constraint_type);
  const operator = type === 'at_least' ? '>=' : '<=';
  const rows = (Array.isArray(raw.goal_constraints) ? raw.goal_constraints : [])
    .filter((c): c is { node_id?: unknown; operator?: unknown; value?: unknown } => c !== null && typeof c === 'object')
    .filter((c) => c.node_id === goalId && c.operator === operator);
  if (rows.length !== 1 || rows[0]!.value !== v.raw_value || statedOperatorOf(rows[0]!) !== TARGET_OPERATOR[v.constraint_type]) return false;
  if (type === 'at_most') return true;
  const goal = (Array.isArray(raw.nodes) ? raw.nodes : []).find((n) => (n as { id?: unknown } | null)?.id === goalId) as { goal_threshold_raw?: unknown } | undefined;
  return goal?.goal_threshold_raw === v.raw_value;
}

/** The approval-facing disclosure of a name left out as ambiguous (empty when none was). */
function ambiguousClause(ambiguous: readonly AmbiguousTarget[]): string {
  if (ambiguous.length === 0) return '';
  return ` (left out, more than one entity is called this, so the user must say which: ${ambiguous.map((a) => `"${a.requested}"`).join('; ')})`;
}

/** A later refusal cannot erase an earlier committed save or its receipts. */
function partialWriteOutcome(proposalId: string, receipts: readonly ReceiptSummary[], outcome: string, siblings: readonly ReencodedSibling[] = []): ToolResult {
  return { ok: false, mutated: true, applied: false, refusal: 'not_confirmed',
    proposal_id: proposalId, receipts: [...receipts], outcome, detail: PARTIAL_WRITE_MESSAGES[outcome],
    ...(siblings.length > 0 ? { reencoded_siblings: siblings, follow_up: [PARTIAL_WRITE_MESSAGES[outcome], ...siblings.map(c => c.detail)].join(' ') } : {}) };
}

function laterSaveConflict(error: unknown): boolean {
  if (isRevisionConflict(error)) return true;
  if (error === null || typeof error !== 'object') return false;
  const response = error as { status?: unknown; json?: { code?: unknown; details?: { code?: unknown } } };
  return response.status === 409 && ['revision_conflict', 'GRAPH_STALE'].includes(String(response.json?.code ?? response.json?.details?.code));
}

/**
 * ⭐ ONE COUNT FOR A MIXED LINK SET, PREVIEW AND RECEIPT ALIKE (Batch A live (b) BLOCKING; AIE text contract #94
 * 6115788987): strengths sized, changes to links that stay unsized, and reviews are counted apart, never "these 6 link
 * strengths" when two of the six were reviews. The preview counts the outcome the writer is predicted to store; the
 * receipt counts the outcome it stored.
 */
function mixedLinkSetHeading(strengths: number, unsizedChanges: number, reviews: number): string {
  const counted = [
    ...(strengths > 0 ? [`${strengths} ${strengths === 1 ? 'link strength' : 'link strengths'}`] : []),
    ...(unsizedChanges > 0 ? [`${unsizedChanges} ${unsizedChanges === 1 ? 'change to an unsized link' : 'changes to unsized links'}`] : []),
    ...(reviews > 0 ? [`${reviews} ${reviews === 1 ? 'review' : 'reviews'}`] : []),
  ];
  return counted.length === 1 ? counted[0]! : `${counted.slice(0, -1).join(', ')} and ${counted.at(-1)!}`;
}

/** D1 (AIE AMEND, 12 Oct), verbatim: the pending offer's words for Olumi's first estimate of a link nobody had sized. */
export const D1_PENDING_FIRST_ESTIMATE = 'an estimate from Olumi that has not yet been applied';
/**
 * ⭐ #3002 (DL; Codex CHECK-3002-783a55b8 item 3 and its buddy review): the HOST names, on the card itself, EVERY link the set
 * leaves out and why, by the model's own labels for its ids, so the user never relies on the Agent saying it. The receipt
 * repeats these sentences from the stored card, only once the write is read back whole (`applyLinkStrengthSet`).
 * The unknown-origin and third-party sentences are the AIE's exact texts (packet 2b19ae59, #94 6163353417); the definitional
 * and held-figure ones keep their reasons in the same frame, AIE_TEXT_PENDING.
 */
const LEFT_OUT_CARD_LEAD = 'Left out of this change set: ';
/** A link left out, by the model's labels; a third party's carries the source it is attributed to, whole. */
export interface LeftOutLink { readonly pair: string; readonly source?: string }
const attributed = (x: LeftOutLink): string => `${x.pair}, attributed to "${x.source ?? ''}"`;
const LEFT_OUT_CARD = {
  unknown_origin: (xs: readonly LeftOutLink[]) => xs.length === 1
    ? `Left out of this change set: ${xs[0]!.pair}, because Olumi could not confirm who gave the proposed strength. Its current relationship and source are kept.`
    : `Left out of this change set: ${xs.map((x) => x.pair).join('; ')}, because Olumi could not confirm who gave the proposed strengths. Their current relationships and sources are kept.`,
  third_party: (xs: readonly LeftOutLink[]) => xs.length === 1
    ? `Left out of this change set: ${xs[0]!.pair}. The proposed strength comes from "${xs[0]!.source}"; it is not presented as your judgement or a new Olumi estimate. Its current relationship and source are kept.`
    : `Left out of this change set: ${xs.map(attributed).join('; ')}. These strengths are not presented as your judgement or new Olumi estimates. Their current relationships and sources are kept.`,
  definitional: (xs: readonly LeftOutLink[]) => `${LEFT_OUT_CARD_LEAD}${xs.map((x) => x.pair).join('; ')}, because the model defines ${
    xs.length === 1 ? 'it by a calculation. Its current relationship is kept.' : 'them by a calculation. Their current relationships are kept.'}`,
  user_figure: (xs: readonly LeftOutLink[]) => `${LEFT_OUT_CARD_LEAD}${xs.map((x) => x.pair).join('; ')}, because ${
    xs.length === 1 ? 'it holds your own figure. Its current relationship is kept.' : 'they hold your own figure. Their current relationships are kept.'}`,
} as const;
export const leftOutCard = (reason: keyof typeof LEFT_OUT_CARD, xs: readonly LeftOutLink[]): string => xs.length === 0 ? '' : LEFT_OUT_CARD[reason](xs);
/** The Agent's notes for a card that leaves links out: the AIE's exact texts (packet 2b19ae59). */
const LINK_SET_APPROVAL_SCOPE_NOTE = 'Nothing has changed yet. One approval applies only the changes listed as included on the current card, together or none; it does not apply any link listed as left out.';
const LINK_SET_UNKNOWN_AGENT_NOTE = 'Some proposed links were left out because the source of their bands could not be verified (`left_out_unknown_origin`). Name those directed relationships as the current card does. Their existing values and sources are kept; do not call the proposed bands the user\'s or Olumi\'s. Do not re-ask source already retained: explain the actual missing or conflicting binding, and use a focused clarification or useful evidence review where supported.';
const LINK_SET_THIRD_PARTY_AGENT_NOTE = 'Some proposed links were left out as attributed third-party bands (`left_out_third_party`). Name the directed relationships and their cited sources as the current card does; preserve the complete claims and their verification state. Say that this proposal does not change those links, not that the bands are absent from the model or have never been recorded. Do not ask the user to claim the source\'s view as their own. If the user independently supplies a new judgement, retain that new statement separately and use only an actually supported bound proposal; agreement or approval does not rewrite the original source.';
/** The user's line when a link set's save cannot be confirmed: the AIE's exact text (packet 2b19ae59, `card_receipt`). */
export const LINK_SET_SAVE_NOT_CONFIRMED = 'The save could not be confirmed. Check the current model before retrying.';

/**
 * A revised-draft card that withholds a result for a carried limit says the full reason itself; the reply points to it once,
 * and this turn's AI keeps its facts. The AIE's exact text (#94 6178720067, AMEND of #3132).
 */
export const CARD_OWNS_WITHHELD_NOTE = 'This revised-draft card contains the full withheld-result reason for its carried limit. When presenting this same complete card in this turn, point to that reason once instead of repeating it in the reply. Keep the card’s actual result, limit, source, scope and reason in your reasoning. Preserve other distinct blockers and unresolved questions; do not claim approval, a save or an available result.'

export function createAgentCapabilities(
  dispatch: InternalDispatch,
  proposals: ProposalStore,
  /**
   * Construction needs a structured model call. It is injected rather than
   * imported so this module still has no provider of its own — and when it is
   * absent the tool REFUSES rather than pretending the model could not be built
   * for some modelling reason.
   */
  callStructured?: CallStructuredModel,
  /**
   * 'preview' is READ-ONLY. This is the innermost of three layers: the tools
   * are not declared, `dispatchTool` refuses the names, and these refuse too.
   * Defence in depth, because a single prompt sentence is not a boundary.
   */
  mode: 'full' | 'preview' = 'full',
  /**
   * ⭐ THE UI RENDERS THE ANALYSIS FROM `blocks` AND `analysis_ready`, NOT FROM
   * THE PROSE. Measured on the real browser transport at `2fd8cbba`: the turn
   * came back 200 with a correct verdict in `assistant_text` and
   * `blocks=none`, `analysis_ready.options=0` — so a user reading the page saw
   * the sentence and an empty results panel.
   *
   * The raw payload is handed to the ROUTE through this callback rather than
   * returned in the ToolResult, because the ToolResult is JSON-stringified
   * straight back into the model's context: a full analysis payload there
   * would cost thousands of tokens per hop and tell the model nothing its own
   * summary does not already say.
   *
   * `scenario_id`, `status` and `trigger` are what the run-turn coaching
   * contract (`runTurnCoaching`, CEE #1855) binds the run by: without them it
   * cannot tell that a run happened this turn, or that it was the automatic
   * first pass. No `trigger` ⇒ the user asked for the run.
   */
  onAnalysis?:(payload: { scenario_id: string; status: number; analysis_state?: unknown; analysis_ready?: unknown; blocks?: unknown[]; trigger?: 'auto_first_pass'; run_delta?: unknown }) => void,
  /**
   * ⭐ THE AUTOMATIC FIRST ANALYSIS (Paul, 5812069638), injected by the route so the run, its turn
   * deadline and its write accounting stay the route's. Absent → no automatic run (a unit test, or a
   * caller that does not want one). See `../first-analysis.ts` for the rules it enforces.
   */
  opts: {
    /** Absolute end of this turn's drafter call, shared with optional draft widening. */
    /** Ordinary agent-turn authority cut; legacy callers remain inventoried separately. */
    readonly turnAuthority?: boolean;
    readonly deadlineAt?: number;
    readonly firstAnalysis?: (input: FirstAnalysisInput) => Promise<FirstAnalysisOutcome>;
    /**
     * ⭐ C6-1: told ONCE, the moment a construction THIS request committed is confirmed from state — before the
     * first analysis and before the Agent's reply — with the graph exactly as read back. The route turns it into
     * the streamed `GRAPH_READY` frame (nothing at all outside a streamed turn), so the canvas draws the model
     * ~15 s before COMPLETE. The same committing-path gate as the first analysis: never on a refusal or a replay.
     * An observer only — a throw here is swallowed and never costs the build. Absent ⇒ nothing is told.
     */
    readonly onModelRegistered?: (graph: Record<string, unknown>) => void;
    /** X5 (DESIGN Q3): why the one construction retry ran and its outcome — for `_diagnostic_trace`, never the model. */
    readonly onConstructionTrace?: (t: ConstructionTrace) => void;
    /**
     * The pending actions on the scenario's LATEST answer row, as the session store returns them. The held
     * add-option proposal lives there (route-v2 minted it), so a `gmh_` approval is confirmed against what the
     * store actually holds — never against a copy this process remembered. Absent ⇒ a held approval refuses.
     */
    readonly readPendingActions?: (scenarioId: string) => Promise<readonly PendingAction[]>;
    /**
     * ⭐ S8 DURABLE HUMAN REASONING: the user's standing objections ("I disagree with this finding, because…"), read by
     * the ROUTE from the existing turn-window facts through the existing projector (`projectStatedObjections`: newest per
     * finding wins, at most 3, verbatim). Absent or throwing ⇒ none; the canonical state is then byte-identical to before.
     */
    readonly readStatedObjections?: (scenarioId: string, requestId: string) => Promise<readonly StatedObjection[]>;
    /** B restated goal: the scenario's committed turn ledger (`SessionStore.readCommittedTurnLedger`), read only to offer or apply a revised draft. */
    readonly readCommittedTurnLedger?: (scenarioId: string) => Promise<CommittedTurnLedger>;
    /**
     * ⭐ ONE approved batch of option levels — each with the option → factor link it needs — as ONE atomic commit
     * (ChatGPT #70 5847200462): the product's own level writer, reached in-process (`commitOptionLevelsInProcess`).
     * All or nothing; answers like a system-event write (409 · 422 with `refusal.index` · 500 · 200 with `graph_hash`
     * and `model_version_receipt`). Absent ⇒ unavailable.
     */
    readonly commitOptionLevels?: (input: CommitOptionLevelsInput) => Promise<CommitOptionLevelsResult>;
    /** The narrow CAS writer for a pressed adoption of an existing Olumi suggestion. */
    readonly commitOlumiOptionAdoption?: (input: {
      scenario_id: string; turn_id: string; base_graph_hash: string; expected_graph_identity_hash: string;
      option_id: string; expected_label: string; expected_interventions: Record<string, unknown>;
    }) => Promise<{ status: 'committed' | 'stale' | 'refused' | 'unconfirmed'; model_version_receipt?: unknown; reason?: string }>;
    /**
     * ⭐ C5: whether the scenario's current analysis withholds its leader, read by the ROUTE from its own readback
     * through the wire gate's own predicate (`leaderStandingOf`) — so this capability and the gate cannot disagree.
     * Absent, `null` or throwing ⇒ the provisional view is refused (fail closed).
     */
    readonly readLeaderStanding?: (scenarioId: string) => Promise<LeaderStanding | null>;
    /**
     * Whether a search control quoting this query would survive the final egress gate, read by the ROUTE from its own
     * readback through the gate's own chip rule (`controlSurvivesLeaderGate`). Absent ⇒ every sendable query is accepted.
     * Throwing ⇒ the dispatcher refuses the offer (fail closed): a control that may not arrive is never promised.
     */
    readonly researchControlShowable?: (scenarioId: string, query: string) => Promise<boolean>;
    /**
     * ⭐ SLICE C2 (Canonical #70 5855234599): the product's add-risk door, reached in-process (`holdAddRiskInProcess`):
     * ONE `gmh_` hold pinned to the base hash, confirmed by the product's own held resume. Absent ⇒ unavailable.
     */
    readonly holdAddRisk?: (input: HoldAddRiskInput) => Promise<HoldAddRiskResult>;
    /**
     * ⭐ PJ-E-FIG (DL #72 5866036457): the product's add-factor door, reached in-process (`holdAddFactorInProcess`): ONE
     * `gmh_` hold carrying the user's figures, pinned to the base hash, confirmed by the product's own held resume.
     * Absent ⇒ unavailable.
     */
    readonly holdAddFactor?: (input: HoldAddFactorInput) => Promise<HoldAddFactorResult>;
    /**
     * ⭐ SLICE C2: the product's limit door (`commitLimitEditInProcess`): a new figure for an EXISTING limit row, its unit
     * and frame kept, stamped as the user's, ONE CAS commit with the base-hash gate. Absent ⇒ unavailable.
     */
    readonly commitLimitAdd?: (input: CommitLimitAddInput) => Promise<CommitLimitEditResult>;
    readonly commitLimitEdit?: (input: CommitLimitEditInput) => Promise<CommitLimitEditResult>;
    /**
     * ⭐ MG F1 T6 (#2471): the option-status door, in-process (`commitOptionStatusInProcess`), fenced like the limit door.
     * It returns the WRITER's own typed outcome, the only evidence "applied" may rest on. Absent ⇒ never "applied".
     */
    readonly commitOptionStatus?: (input: CommitOptionStatusInput) => Promise<CommitOptionStatusResult>;
    /** The clock a deadline is counted from (S-E GOALS; `deadline-date.ts` reads Europe/London's day of it). Absent ⇒ now. */
    readonly now?: () => Date;
  } = {},
): AgentCapabilities & {
  deadlineCardFromDraft(ctx: AgentToolContext, input: Omit<DeadlineIssueInput, 'graph' | 'storedBrief' | 'reference' | 'priorOffer'> & { start: DeadlineTurnStart | undefined }): Promise<{ words: string; issue: NonNullable<AgentCapabilities['proposeGoalDeadline']> } | undefined>;
} {
  const readOnly = mode === 'preview';
  const refuseReadOnly = (): ToolResult => ({
    ok: false, mutated: false, refusal: 'read_only_preview',
    detail: 'This preview cannot change the model. Nothing has been altered.',
  });
  /**
   * The first analysis THIS request ran, and the revision it ran on. Capabilities are created per
   * request, so this never outlives the build turn: a later explicit Run never sees it.
   */
  let firstAnalysisThisRequest: { readonly revisionHash: string; readonly result: ToolResult } | undefined;
  /**
   * ⛔ AN APPROVAL RUNS NOTHING — held here, by the server, not by the prompt.
   *
   * Paul's ruling (#63 5812069638): later edits and approvals never re-run unless
   * the user asks. Witnessed on served 8428207 (c19w, 5818452655): an approval in
   * words became `authorise_change` then `run_analysis` in ONE turn, and the reply
   * named a leader the typed claim withheld. Removing the prompt instruction was
   * not enough (re-gate of #1854: a reworded regression survived every test).
   *
   * Set when an approval in THIS request applied (or recovered) a change; read by
   * `runAnalysis`. Per request, like `firstAnalysisThisRequest`, so the NEXT
   * turn's explicit Run is never suppressed. ⚠ Known cost, priced: a user who
   * says "apply it and run it" in one message gets the approval plus a Run to
   * press, never an unrequested run — deciding "did they ask?" from their words
   * is a natural-language predicate this guard deliberately does not make.
   */
  let approvalAppliedThisRequest = false;
  /**
   * ⛔ ONE HELD OPTION PER APPROVAL — until the product's typed add-option carries several options in ONE hold
   * (Canonical #70 5841241418). Two holds offered together get NO approve button (an approval names exactly one
   * proposal), which is the "add all five → nothing to press" dead end of Paul's test. So the first option is
   * prepared and offered; a second in the same turn is refused in plain words, to be added once the first is approved.
   */
  let heldOptionThisRequest: string | undefined;
  /**
   * Normalise the read route's `graph_identity_hash` to the 64-hex value the
   * register route compares. `''` means "no identity to anchor to" — the route
   * returns `null` for an absent, unparseable or identity-empty graph — and
   * every caller below treats `''` as "send no expectation".
   *
   * A bare string is tolerated so this keeps working if the wire is ever
   * flattened; nothing is invented either way, because the envelope's `.value`
   * IS the comparison space.
   */
  const identityHashOf = (raw: unknown): string => {
    if (typeof raw === 'string') return raw;
    if (raw !== null && typeof raw === 'object') {
      const v = (raw as { value?: unknown }).value;
      if (typeof v === 'string') return v;
    }
    return '';
  };

  const readGraph = async (scenarioId: string, section?: 'run_explanation'): Promise<GraphRead | null> => {
    const r = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph`, {});
    if (r.status !== 200) return null;
    const g = (r.json.graph ?? {}) as Record<string, unknown>;
    const view = isPlainRecord(r.json.canonical_analysis_view) ? r.json.canonical_analysis_view : undefined;
    const staleness = isPlainRecord(view?.staleness) ? view.staleness : undefined;
    const notModelled = notModelledOfRead(r.json.not_modelled);
    const identityEvaluated = readEvaluatedIdentityNodeIds(r.json.analysis_identity_evaluated_node_ids);
    const limitVerdicts = readLimitVerdicts(r.json.analysis_limit_verdicts);
    const runUse = r.json.analysis_identity_run_use as { withdrawn_node_ids?: unknown } | null | undefined;
    const withdrawn = runUse !== null && typeof runUse === 'object' && Array.isArray(runUse.withdrawn_node_ids)
      && runUse.withdrawn_node_ids.every((x) => typeof x === 'string') ? runUse.withdrawn_node_ids as string[] : null;
    return {
      identity_run_use: withdrawn === null ? null : { withdrawn: new Set(withdrawn) },
      graph_hash: String(r.json.graph_hash ?? ''),
      brief_text: typeof r.json.brief_text === 'string' ? r.json.brief_text : null,
      scenario_created_at: typeof r.json.scenario_created_at === 'string' ? r.json.scenario_created_at : null,
      // ⛔⛔ IT IS AN ENVELOPE OBJECT, NOT A STRING. The read route emits the
      // producer's own return value — `computeGraphIdentityHash(graph)`, type
      // `GraphIdentityHash | null` = `{kind, value, algorithm, ...}` — so the
      // `String(...)` this line used to do produced the literal
      // `"[object Object]"`, and once the register route enforced the field
      // EVERY frame write below would have been refused 409 and the user told a
      // competing writer had moved their model when none had. That is the exact
      // fabricated-concurrency claim this PR exists to remove, so it is fixed
      // here rather than tolerated. The register route compares the 64-hex
      // `.value` (`context/graph-cas-conflict.ts` extracts it), and accepts
      // either spelling; we send the value.
      graph_identity_hash: identityHashOf(r.json.graph_identity_hash),
      nodes: (g.nodes as GraphRead['nodes']) ?? [],
      edges: (g.edges as GraphRead['edges']) ?? [],
      analysis_state: r.json.analysis_state,
      ...(typeof staleness?.revision === 'number' && Number.isSafeInteger(staleness.revision) && staleness.revision >= 0
        ? { scenario_revision: staleness.revision } : {}),
      ...(() => {
        if (staleness === undefined) return {};
        const value = staleness.run_revision;
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
          && staleness.run_revision_source === 'recorded') {
          return { run_revision: value, run_revision_source: 'recorded' as const };
        }
        if (value === null && staleness.run_revision_source === 'legacy_unknown') {
          return { run_revision: null, run_revision_source: 'legacy_unknown' as const };
        }
        return {};
      })(),
      ...(section === 'run_explanation' ? { run_explanation_admission:
        (r.json.analysis_ready as { analysis_admission?: unknown } | undefined)?.analysis_admission } : {}),
      ...(() => {
        const readiness = (r.json.current_read as { analysis_ready?: unknown } | undefined)?.analysis_ready;
        return readiness === undefined ? {} : { analysis_ready: readiness };
      })(),
      ...(() => {
        const delta = (r.json.current_read as { run_delta?: RunDelta } | undefined)?.run_delta;
        return delta === undefined ? {} : { run_delta: delta };
      })(),
      ...(r.json.analysis_admission !== undefined && r.json.analysis_admission !== null ? { analysis_admission: r.json.analysis_admission } : {}),
      ...(Array.isArray(r.json.goal_scope_reconciliation) ? { goal_scope_reconciliation: r.json.goal_scope_reconciliation as GoalScopeReconciliation[] } : {}),
      raw: g,
      ...(notModelled !== undefined ? { not_modelled: notModelled } : {}),
      ...(identityEvaluated !== undefined ? { identity_evaluated: identityEvaluated } : {}),
      ...(limitVerdicts !== null ? { limit_verdicts: limitVerdicts } : {}),
      ...(r.json.analysis_constraint_verdict_state !== undefined
        ? { constraint_verdict_state: r.json.analysis_constraint_verdict_state } : {}),
      ...(() => { const risks = r.json.analysis_leader_limit_risks;
        return risks === null || Array.isArray(risks) ? { leader_limit_risks: risks } : {}; })(),
      // /graph is the canonical storage read; JSON decoding must not gate its safe projection again.
      ...(r.json.analysis_result !== undefined && r.json.analysis_result !== null ? { analysis_result: r.json.analysis_result } : {}),
      ...(() => { const stored = readStoredGoalCertainty(r.json.analysis_goal_certainty); return stored !== undefined ? { goal_certainty: stored } : {}; })(),
      ...(() => { const stored = readStoredOptionParticipation(r.json.analysis_option_participation); return stored !== undefined ? { option_participation: stored } : {}; })(),
      ...(r.json.analysis_run_option_set !== undefined
        ? { run_option_set: r.json.analysis_run_option_set as RecordedRunOptionSet } : {}),
    };
  };

  /**
   * ⭐ THE HELD ADD-OPTION (C52). The Agent adds an option through the product's own typed add-option
   * transaction: route-v2 builds option + decision→option edge + option→factor edges (+ the user's levels) as
   * ONE referee-checked batch and HOLDS it as a `graph_management_held_v1` pending under a deterministic
   * `gmh_` handle. Approval sends the UI's own confirm for that handle, and route-v2 commits the batch in ONE
   * write. So the Agent can no longer leave an option unlinked from the decision (Paul's test, 25 Sep).
   *
   * The hold is read from the session store's LATEST answer row — the same read route-v2's confirm makes —
   * so a `gmh_` approval is checked against what the store will actually confirm, never a remembered copy.
   */
  const liveHeldHold = async (scenarioId: string, ref: string): Promise<PendingAction | undefined> => {
    if (opts.readPendingActions === undefined) return undefined;
    const pendings = await opts.readPendingActions(scenarioId);
    return pendings.find((p) => p.chip_id === ref
      && p.action.kind === 'apply_proposed_change'
      && (p.action as { inline_patch?: { handler_id?: unknown } }).inline_patch?.handler_id === GM_HELD_HANDLER_ID
      && !isPendingActionExpired(p, Date.now()));
  };
  const heldOpsOf = (hold: PendingAction): readonly { op: string; path: string; value?: unknown }[] => {
    const ops = (hold.action as { inline_patch?: { operations?: unknown } }).inline_patch?.operations;
    return Array.isArray(ops) ? ops.filter((o): o is { op: string; path: string; value?: unknown } =>
      o !== null && typeof o === 'object' && typeof (o as { op?: unknown }).op === 'string' && typeof (o as { path?: unknown }).path === 'string') : [];
  };
  /** The held (`gmh_`) changes this turn withdrew (`withdrawProposal`): never listed as awaiting, never confirmed. */
  const withdrawnHolds = new Set<string>();
  /** Every live held add-option, as the approval it awaits. A failed read lists none — never a guess. */
  const liveHeldAwaiting = async (scenarioId: string): Promise<{ proposal_id: string; public_label: string }[]> => {
    if (opts.readPendingActions === undefined) return [];
    let pendings: readonly PendingAction[];
    try { pendings = await opts.readPendingActions(scenarioId); } catch { return []; }
    return pendings
      .filter((p) => typeof p.chip_id === 'string' && /^gmh_[0-9a-f]{12}$/.test(p.chip_id)
        && p.action.kind === 'apply_proposed_change'
        && (p.action as { inline_patch?: { handler_id?: unknown } }).inline_patch?.handler_id === GM_HELD_HANDLER_ID
        && !isPendingActionExpired(p, Date.now()) && !withdrawnHolds.has(p.chip_id))
      .map((p) => ({ proposal_id: p.chip_id as string, public_label: resolveProposalRenderCopy(p.action as { kind: string; public_label?: string }).label }));
  };
  /** A level is set when the option's intervention for that factor carries a number (either stored shape). */
  const hasLevel = (node: { interventions?: unknown } | undefined, factorId: string): boolean => {
    const iv = (node?.interventions as Record<string, unknown> | undefined)?.[factorId];
    return typeof iv === 'number' || (iv !== null && typeof iv === 'object' && typeof (iv as { value?: unknown }).value === 'number');
  };
  /**
   * Confirm a held add-option exactly as the UI would: the hold's own chip id and its own public message,
   * verbatim, on the non-composer chip path (the route gate matches the exact copy; a paraphrase or a bare
   * "yes" would reach the edit model instead). Applied ONLY when THIS confirm's own response shows it AND the
   * store agrees: the response carries the applied model (`draft_graph`, which a refused hold omits) holding
   * every option the hold adds with its decision link, the model now stored is that one, the hold is consumed,
   * and the options are in the model with their decision links.
   *
   * ⛔ BOUND TO THIS RESPONSE, NOT TO WHAT THE MODEL NOW HOLDS (Canonical, #70 5841421182, condition 3). A writer
   * racing the confirm can land an option with the same deterministic id while route-v2 refuses the stale hold:
   * the model moved, the hold is gone and the id is present — and none of it is this write.
   */
  const confirmHeld = async (ctx: AgentToolContext, ref: string): Promise<ToolResult> => {
    // The server-bound card identity is consent, never the model's interpretation of user text.
    // This applies to EVERY product hold (options, risks and factors), including carried holds.
    if (ctx.typed_approval_of !== ref) {
      return { ok: false, mutated: false, refusal: 'approval_required', proposal_id: ref,
        detail: 'Nothing changed. Press the approval card for this waiting change before it can be applied.' };
    }
    let hold: PendingAction | undefined;
    try {
      hold = await liveHeldHold(ctx.scenario_id, ref);
    } catch {
      return { ok: false, mutated: false, refusal: 'not_found', proposal_id: ref,
        detail: 'The waiting change could not be read, so nothing was applied. Tell the user plainly and offer to try again.' };
    }
    if (hold === undefined) {
      return { ok: false, mutated: false, refusal: 'unknown_proposal', proposal_id: ref,
        detail: 'That change is no longer waiting (it expired, or the model changed since it was offered), so nothing was applied. Offer to prepare it again.' };
    }
    const copy = resolveProposalRenderCopy(hold.action as { kind: string; public_label?: string; public_message?: string });
    if (ctx.proposal_edits === undefined && ctx.typed_approval_words !== copy.message) {
      return { ok: false, mutated: false, refusal: 'approval_required', proposal_id: ref,
        detail: 'Nothing changed. Approval must use the displayed card for this exact waiting change.' };
    }
    const before = await readGraph(ctx.scenario_id);
    if (before === null) return { ok: false, mutated: false, refusal: 'not_found', proposal_id: ref };
    /**
     * ⭐ S-D APPROVE-WITH-EDITS (lane EDIT-PANEL): the values the user set in the panel, bound by the route to THIS card.
     * Checked here against the revision and model the panel showed (nothing written on a mismatch), then carried to the
     * door with the confirm, which applies them to the stored hold in the same execution. What Olumi held for each field
     * is returned for the reply ("You set … ; Olumi had …"); the door's own amendment is the one that lands.
     */
    const edits = ctx.proposal_edits;
    let userEdits: readonly UserEdit[] | undefined;
    if (edits !== undefined) {
      if (edits.proposal_id !== ref || edits.revision !== hold.id || edits.graph_hash !== hold.preconditions.graph_hash
        || edits.graph_hash !== before.graph_hash) {
        return { ok: false, mutated: false, refusal: 'edits_superseded', proposal_id: ref,
          detail: edits.fields.length === 0 ? PLAIN_APPROVAL_SUPERSEDED
            : 'Nothing changed. These values were set on an earlier version of this change or of the model.' };
      }
      const record = productHoldRecord(hold, before);
      if (record !== undefined && record.digest !== edits.digest) {
        return { ok: false, mutated: false, refusal: 'edits_superseded', proposal_id: ref,
          detail: edits.fields.length === 0 ? PLAIN_APPROVAL_SUPERSEDED
            : 'Nothing changed. What this change shows has changed since these values were set.' };
      }
      if (record === undefined) {
        return { ok: false, mutated: false, refusal: 'edits_refused', proposal_id: ref,
          detail: 'Nothing changed. Those values do not belong to this waiting change.' };
      }
      // Check the card binding before its words: a replaced card can also have a newer approval message.
      if (ctx.typed_approval_words !== copy.message) {
        return { ok: false, mutated: false, refusal: 'approval_required', proposal_id: ref,
          detail: 'Nothing changed. Approval must use the displayed card for this exact waiting change.' };
      }
      // Empty fields bind the displayed card only; they generate no amendments or edit receipts.
      if (edits.fields.length > 0) {
        const amended = amendHeldOperations(record, edits.fields);
        if (!amended.ok) {
          return { ok: false, mutated: false, refusal: 'edits_refused', proposal_id: ref,
            detail: 'Nothing changed. Those values do not belong to this waiting change.' };
        }
        userEdits = amended.userEdits;
      }
    }
    const r = await dispatch('/orchestrate/v2/turn', {
      kind: 'message',
      // The edits are part of the confirm's identity: the same card pressed with other values is another request.
      turn_id: authorisationTurnId(`agent_confirm_held:${hold.id}${edits !== undefined ? `:${proposalEditsDigest(edits)}` : ''}`),
      scenario_id: ctx.scenario_id,
      stage: 'frame', turn_class: 'frame', source: 'chip', message: copy.message,
      chip: { id: ref, ...(edits !== undefined ? { parameters: { proposal_edits: edits } } : {}) },
    });
    const after = await readGraph(ctx.scenario_id);
    let stillHeld = true;
    try { stillHeld = (await liveHeldHold(ctx.scenario_id, ref)) !== undefined; } catch { stillHeld = true; }
    const heldOps = heldOpsOf(hold);
    // ⛔ A held batch may also ADD a factor (`new_factors`), or be a new RISK (SLICE C2): only an option node is an option.
    const addedKind = (o: { op: string; value?: unknown }): unknown => (o.op === 'add_node' ? (o.value as { kind?: unknown } | undefined)?.kind : undefined);
    const isFactorAdd = (o: { op: string; value?: unknown }): boolean => addedKind(o) === 'factor';
    const isRiskAdd = (o: { op: string; value?: unknown }): boolean => addedKind(o) === 'risk';
    const optionIds = heldOps.filter((o) => o.op === 'add_node' && !isFactorAdd(o) && !isRiskAdd(o)).map((o) => o.path);
    const addedFactorIds = heldOps.filter(isFactorAdd).map((o) => o.path);
    const addedRiskIds = heldOps.filter(isRiskAdd).map((o) => o.path);
    // The decision link of each option, from the held batch itself (`decision::option`).
    const decisionLinks = heldOps.filter((o) => o.op === 'add_edge' && optionIds.some((id) => o.path.endsWith(`::${id}`)))
      .map((o) => o.path.split('::') as [string, string]);
    /**
     * ⭐ EVERY HELD NODE AND EVERY HELD LINK, not only "options + decision links" (SLICE C2): a held risk has no option and
     * no decision link, and what the approval landed is the whole batch. An add-option hold is judged exactly as before
     * (each option WITH its decision link) and, in addition, on the rest of its own batch.
     */
    const heldNodeIds = heldOps.filter((o) => o.op === 'add_node').map((o) => o.path);
    const heldLinks = heldOps.filter((o) => o.op === 'add_edge').map((o) => o.path.split('::') as [string, string]);
    const holdsAll = (g: { nodes?: unknown; edges?: unknown } | null | undefined): boolean => {
      const nodes = Array.isArray(g?.nodes) ? g.nodes as { id?: unknown }[] : [];
      const edges = Array.isArray(g?.edges) ? g.edges as { from?: unknown; to?: unknown }[] : [];
      const optionsLinked = optionIds.length === 0 || (decisionLinks.length >= optionIds.length
        && optionIds.every((id) => nodes.some((x) => x?.id === id))
        && decisionLinks.every(([from, to]) => edges.some((e) => e?.from === from && e?.to === to)));
      return heldNodeIds.length > 0 && optionsLinked
        && heldNodeIds.every((id) => nodes.some((x) => x?.id === id))
        && heldLinks.every(([from, to]) => edges.some((e) => e?.from === from && e?.to === to));
    };
    const applied = r.status === 200 && r.json.draft_graph !== null && typeof r.json.draft_graph === 'object'
      && holdsAll(r.json.draft_graph as { nodes?: unknown; edges?: unknown });
    const verified = applied && after !== null && typeof r.json.graph_hash === 'string' && r.json.graph_hash === after.graph_hash
      && after.graph_hash !== before.graph_hash && !stillHeld && holdsAll(after);
    if (!verified) {
      if (!applied && edits?.fields.length === 0 && r.json.assistant_text === PLAIN_APPROVAL_SUPERSEDED) {
        return { ok: false, mutated: false, refusal: 'edits_superseded', proposal_id: ref, detail: PLAIN_APPROVAL_SUPERSEDED };
      }
      return applied
        ? { ok: false, mutated: true, refusal: 'not_verified', proposal_id: ref,
          detail: 'The change was saved, but the model changed again straight afterwards, so what it now holds could not be confirmed. Read the model again before saying what it holds.' }
        : { ok: false, mutated: false, refusal: 'not_applied', proposal_id: ref,
          detail: 'The change was not saved (the model may have changed since it was offered). Tell the user plainly; do not describe it as added, and offer to prepare it again.' };
    }
    approvalAppliedThisRequest = true;
    const { summary, unreadable } = receiptSummaryOf(r.json);
    /**
     * ⛔ EVERY LABEL IS QUOTED (round-2 review of fix/agent-never-shows-instructions-or-codes, blocker 3). This follow-up
     * is shown verbatim on the one-click path, through the boundary that withholds anything addressed to the Agent
     * (`withoutAgentDirections`). A label is the user's data: quoted, it can never read as an instruction or a code —
     * unquoted, "Size of the user base", `cost_per_hire` or the id fallback below dropped both sentences.
     */
    const quoted = (label: string): string => `"${label}"`;
    const sentences = optionIds.map((id) => {
      const node = after!.nodes.find((x) => x.id === id) as { label?: unknown; interventions?: unknown } | undefined;
      const factorIds = after!.edges.filter((e) => e.from === id).map((e) => e.to)
        .filter((to) => after!.nodes.some((x) => x.id === to && x.kind === 'factor'));
      const labelOf = (fid: string): string => quoted(String(after!.nodes.find((x) => x.id === fid)?.label ?? fid));
      const unlevelled = factorIds.filter((fid) => !hasLevel(node, fid)).map(labelOf);
      // Whose each level is, from what was COMMITTED: Olumi's estimates are said as that (C2), never as the user's.
      const estimated = factorIds.filter((fid) => {
        const p = settingProvenanceOf(((node?.interventions ?? {}) as Record<string, unknown>)[fid], after!.nodes.find((x) => x.id === fid));
        return p.origin === 'ai' && !p.structural;
      }).map(labelOf);
      return `Added "${String(node?.label ?? id)}", linked from the question and acting on ${factorIds.map(labelOf).join(', ')}.`
        + (estimated.length > 0 ? ` Its level for ${estimated.join(', ')} is Olumi's estimate, for you to correct.` : '')
        + (unlevelled.length > 0 ? ` It does not yet set a level for ${unlevelled.join(', ')}; tell me the figure for each and I'll set it.` : '');
    });
    // The new switches the hold named (`GM_HELD_SWITCH_FACTORS_KEY`): their today-0 was committed with them, as Olumi's.
    const heldSwitches = (hold.action as { inline_patch?: Record<string, unknown> }).inline_patch?.[GM_HELD_SWITCH_FACTORS_KEY];
    const switchIds = new Set(Array.isArray(heldSwitches) ? heldSwitches.filter((x): x is string => typeof x === 'string') : []);
    // ⭐ PJ-A1 £49: the new graded factors whose stated today level the hold named (`GM_HELD_GRADED_TODAY_KEY`).
    const todayIds = new Set((readGradedTodayMember((hold.action as { inline_patch?: Record<string, unknown> }).inline_patch?.[GM_HELD_GRADED_TODAY_KEY]) ?? [])
      .map((l) => l.factor_id));
    // SLICE C2: a new risk, said from what was COMMITTED — what it threatens, what drives it, and who sized each link.
    for (const rid of addedRiskIds) {
      const risk = after!.nodes.find((x) => x.id === rid);
      if (risk === undefined) continue;
      const labelOf = (id: string): string => quoted(String(after!.nodes.find((x) => x.id === id)?.label ?? id));
      const out = after!.edges.filter((e) => e.from === rid);
      const into = after!.edges.filter((e) => e.to === rid);
      // Opens `Added "<label>"` exactly as the option sentence does: an unquoted "Added the …" is a model-style completion
      // claim the write narrator strips (`write-outcome.ts` CLAIM_OPENER), which dropped this whole sentence (measured).
      // Only the ties it HAS are said (DL 58e392, 8 Oct; Paul's try-guide step 12 read "affecting ;" for a precondition
      // risk with no out-link): no empty list, and no "how strongly" with no link to size.
      const ties = [out.length > 0 ? `affecting ${out.map((e) => labelOf(e.to)).join(', ')}` : '',
        into.length > 0 ? `driven by ${into.map((e) => labelOf(e.from)).join(', ')}` : ''].filter((t) => t !== '');
      sentences.push(`Added "${String(risk.label ?? rid)}" as a risk${ties.length > 0 ? `, ${ties.join(' and ')}` : ''}`
        + (out.length + into.length > 0 ? `; ${howStronglyWords([...out, ...into])}` : '.'));
    }
    // ⭐ PJ-E-FIG: the factors the add-factor door added, each with the user's figure (`GM_HELD_USER_TODAY_KEY`).
    const userTodayMember = readUserTodayMember((hold.action as { inline_patch?: Record<string, unknown> }).inline_patch?.[GM_HELD_USER_TODAY_KEY]) ?? [];
    const userTodayIds = new Set(userTodayMember.map((l) => l.factor_id));
    // A pairing the user confirmed on the card (DL ruling on #2235) is said as that: they approved Olumi's reading of their words.
    const confirmedIds = new Set(userTodayMember.filter((l) => l.basis === 'confirmed_by_approval').map((l) => l.factor_id));
    /** The range Olumi chose for each such figure, said ONCE — here, on the turn that writes it (`ranges_added_for_analysis`). */
    const rangesAdded: { factor: string; value: number; range: number }[] = [];
    const factorParts: AddedFactorPart[] = [];
    for (const fid of addedFactorIds) {
      const f = after!.nodes.find((x) => x.id === fid);
      if (f === undefined) continue;
      const outgoing = after!.edges.filter((e) => e.from === fid);
      const changes = outgoing.map((e) => quoted(String(after!.nodes.find((x) => x.id === e.to)?.label ?? e.to)));
      // Whose today is said from what was COMMITTED: a switch's off-today is Olumi's reading, never the user's.
      const os = (f as { observed_state?: { value?: unknown; source?: unknown } }).observed_state;
      const committedOff = switchIds.has(fid) && os?.value === 0 && os?.source === NEW_SWITCH_TODAY.observed_state.source;
      // Who sized each committed link decides the words (audit MAG-2): a flat default is a placeholder, never "Olumi's estimate".
      // A1 × #2103: a committed switch already HAS its today (0, Olumi's), so it is said as that and is never in the
      // one ask for today's values; every other added factor goes to that single ask (`added-factors-receipt.ts`).
      if (committedOff) {
        sentences.push(`Also added the factor "${String(f.label ?? fid)}", which changes ${changes.join(', ')}; ${howStronglyWords(outgoing)} `
          + 'Olumi takes it as off today and the option switches it on; that it is off today is Olumi\'s estimate, for you to correct.');
        continue;
      }
      // ⭐ PJ-A1 £49: a new graded factor committed WITH the today level the user stated is said as that, never asked again.
      const statedRaw = (os as { raw_value?: unknown } | undefined)?.raw_value ?? os?.value;
      // ⭐ PJ-E-FIG: a factor the add-factor door committed WITH the user's figure — said as theirs, never asked again; its
      // range (Olumi's) is disclosed once below, never re-framed later (`levelFrameOf` reads the stored cap).
      if (userTodayIds.has(fid) && (os?.source === USER_TODAY_SOURCE || provenanceOf({ value: os }).origin === 'ai') && typeof statedRaw === 'number') {
        const u = (os as { unit?: unknown }).unit;
        const cap = (os as { cap?: unknown }).cap;
        sentences.push(`Added "${String(f.label ?? fid)}" as a factor, affecting ${changes.join(', ')}; ${howStronglyWords(outgoing)} `
          + `Its value today is ${statedRaw}${typeof u === 'string' && u !== '' ? ` ${u}` : ''}, ${provenanceOf({ value: os }).origin === 'ai' ? 'Olumi’s estimate' : confirmedIds.has(fid) ? 'as you confirmed' : 'as you said'}.`);
        // ⭐ Recovery Batch E (run 4 hiring step 13, B5/U5): a factor that holds the range the user stated is never said to
        // have a range "not yours" (`isUserStatedRange`).
        if (typeof cap === 'number' && Number.isFinite(cap) && cap > 1 && !isUserStatedRange((os as { range?: unknown }).range)) {
          rangesAdded.push({ factor: String(f.label ?? fid), value: statedRaw, range: cap });
        }
        continue;
      }
      if (todayIds.has(fid) && heldFigureOwnerOf(os) === 'brief' && typeof statedRaw === 'number') {
        const u = (os as { unit?: unknown }).unit;
        sentences.push(`Also added the factor "${String(f.label ?? fid)}", which changes ${changes.join(', ')}; ${howStronglyWords(outgoing)} `
          + `Its value today is ${statedRaw}${typeof u === 'string' && u !== '' ? ` ${u}` : ''}, as you said.`);
        continue;
      }
      factorParts.push({ label: String(f.label ?? fid), changes, strength: howStronglyWords(outgoing) });
    }
    // One ask for today's values, naming every added factor (`added-factors-receipt.ts`).
    sentences.push(...addedFactorsReceipt(factorParts));
    return {
      ok: true, mutated: true, applied: true, outcome: 'applied', proposal_id: ref,
      receipts: summary !== null ? [summary] : [],
      ...(unreadable ? { receipt_unreadable: true } : {}),
      follow_up: sentences.join(' '),
      ...(rangesAdded.length > 0 ? { ranges_added_for_analysis: rangesAdded } : {}),
      ...(userEdits !== undefined ? { user_edits: userEdits } : {}),
    };
  };

  /**
   * ⛔ ONE APPROVAL MUST BE ABLE TO APPLY A WHOLE STARTING POINT — AND ONLY ONTO
   * THE MODEL THE USER APPROVED.
   *
   * Every proposal is bound to the model revision it was made against, so two
   * proposals offered together (starting values AND option levels) could never
   * both be applied from one "yes": applying the first superseded the second.
   * A compound proposal fixes that — and the first version of it (#1712 @
   * 3674539 / ecb45282) re-read the graph before each part and re-bound the
   * part to whatever it found. Independent review measured the consequence: an
   * UNRELATED edit between the approval and a write was absorbed, the approved
   * levels landed on a model the user never saw (a level shown as 7 FTE stored
   * as 70 after a re-frame), and the result said "applied".
   *
   * So the expected revision is CARRIED, never re-read-and-adopted:
   *   1. It starts at the parent-approved base — the exact read `authoriseChange`
   *      just authorised against, handed in here, not a second read.
   *   2. VALUES are applied IN MEMORY with the product's own
   *      `applyFactorValueEdit` (the inspector path's validator + handler +
   *      merge, unchanged), then written as ONE registration carrying
   *      `expected_graph_hash` = that base. `factor_value_edit` has no base on
   *      the wire (0.55, `.strict()`), so this is what makes the value write
   *      CONDITIONAL: the route refuses a moved model with nothing written, and
   *      the atomic RPC's CAS closes its own read→write window.
   *   3. The revision advances ONLY to the hash that registration reports for
   *      the bytes IT stored, and then to each CAS-gated
   *      `option_intervention_edit`'s own reported hash.
   *   4. Anything else stops the compound truthfully: `not_applied` with zero
   *      writes, or `partially_applied` naming exactly what landed.
   * The approved operations are applied verbatim. Nothing is regenerated.
   */
  const COMPOUND_ORDER = ['set_factor_value', 'set_option_intervention'] as const;
  const frameOf = (n: GraphRead['nodes'][number] | undefined): number | null => {
    const os = (n?.observed_state ?? {}) as { cap?: unknown };
    if (typeof os.cap === 'number' && os.cap > 0) return os.cap;
    if (typeof n?.scale_frame === 'number' && n.scale_frame > 0) return n.scale_frame;
    return null;
  };
  const applyCompound = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0],
    parent: StructuredProposal,
    approvedRead: GraphRead,
  ): Promise<ToolResult> => {
    const isLevelLink = (o: ProposalOperation): boolean => o.op === 'add_edge' && (o.value as { link_for_level?: unknown } | undefined)?.link_for_level === true;
    const unsupported = parent.operations.filter((o) => !(COMPOUND_ORDER as readonly string[]).includes(o.op) && !isLevelLink(o));
    if (unsupported.length > 0) {
      return { ok: false, mutated: false, refusal: 'unsupported_compound', detail: `This proposal mixes changes that cannot be applied together: ${[...new Set(unsupported.map((o) => o.op))].join(', ')}.` };
    }
    const notApplied = (reason: string, detail: string, extra: Record<string, unknown> = {}): ToolResult => ({
      ok: false, mutated: false, applied: false, proposal_id: parent.proposal_id,
      refusal: 'not_applied', reason, detail, parts: [], receipts: [], ...extra,
    });
    // (1) The carried revision starts at what the user approved.
    if (approvedRead.graph_hash !== parent.base_graph_identity_hash) {
      return notApplied('model_changed_since_approval', 'The model changed after this was approved, so nothing was written. Read it again and propose afresh.');
    }
    const valueOps = parent.operations.filter((o) => o.op === 'set_factor_value');
    const levelOps = parent.operations.filter((o) => o.op === 'set_option_intervention');
    const gapInput = parseOptionGapsOfLevelOps(levelOps);
    if (gapInput.kind === 'invalid') return notApplied(gapInput.reason, 'The gap statement could not be read from this proposal. Nothing was written.');
    const optionGaps = gapInput.declarations;
    for (const gap of optionGaps) {
      const op = levelOps.find(o => o.path.split('::')[0] === gap.optionId && Object.hasOwn((o.value ?? {}) as object, 'unmodelled_mechanisms'));
      const operands = (op?.value as { gap_operands?: unknown } | undefined)?.gap_operands;
      if (operands === undefined || !isDeepStrictEqual(operands, optionGapOperands(approvedRead.raw, gap.optionId))) {
        return notApplied('gap_statement_changed_since_approval', 'The named gaps or questions changed after this was proposed. Nothing was written; prepare a new statement.');
      }
    }
    const linkOps = parent.operations.filter(isLevelLink);
    const pairOf = (path: string): { option_id: string; factor_id: string } => {
      const [option_id, factor_id] = path.split('::');
      return { option_id: option_id ?? '', factor_id: factor_id ?? '' };
    };
    const levelInputs = levelOps.map((o) => ({
      ...pairOf(o.path),
      value: ((o.value ?? {}) as { normalised?: unknown }).normalised,
      author: levelOpAuthor(o, parent) === 'user_stated' ? 'user_specified' as const : 'model_proposed' as const,
      ...levelFigureOf(o),
    }));
    // ⛔ THE LINKS AND LEVELS ARE ONE COMMIT OR NONE — so what would stop them is checked BEFORE anything is written.
    if (levelOps.length + linkOps.length + valueOps.length > 0) {
      if (opts.commitOptionLevels === undefined) {
        return notApplied('levels_writer_unavailable', 'This change could not be written as one, so nothing was written.');
      }
      const unstored = levelInputs.find((l) => typeof l.value !== 'number');
      if (unstored !== undefined) {
        return notApplied('no_level_on_proposal', `No level was stored on the proposal for ${unstored.option_id}::${unstored.factor_id}. Nothing was written.`);
      }
    }

    // (2) Values, in memory, through the product's own inspector path.
    let working: unknown = approvedRead.raw;
    for (let i = 0; i < valueOps.length; i += 1) {
      const o = valueOps[i];
      const v = (o.value ?? {}) as { value?: number; unit?: string };
      if (typeof v.value !== 'number') return notApplied('no_value_on_proposal', `No value was stored on the proposal for ${o.path}. Nothing was written.`);
      /**
       * ⛔ `raw_value` WAS DROPPED HERE (Codex 5810763729 items 3 and 5). The proposal
       * carries the user's NATIVE figure, so on a framed factor (`cap: 100`) the event
       * arrived as a bare `value: 50` and `factor-value-edit` — which inverts a bare
       * value with the factor's own stored cap — read it as 50 × 100.
       *
       * ⚠ ONLY WHEN THE FACTOR ALREADY HAS A CAP. An uncapped input is passed through
       * untouched: dividing or clamping it here would invent a frame the canonical
       * scale writer owns, and the block below is what gives an unframed amount its
       * range. This turns no relative change into an absolute set — `v.value` is
       * already the absolute figure the user approved.
       */
      const targetOs = ((((working as { nodes?: GraphRead['nodes'] }).nodes ?? [])
        .find((n) => n.id === o.path)?.observed_state) ?? {}) as { cap?: unknown };
      const targetCap = typeof targetOs.cap === 'number' && targetOs.cap > 0 ? targetOs.cap : undefined;
      const event = {
        kind: 'factor_value_edit' as const,
        target_id: o.path,
        // A figure the user approved is authorship even when it equals Olumi's (schemas 0.62.0; AIQ 5881494849).
        intent: 'set' as const,
        ...(targetCap !== undefined
          ? { value: v.value / targetCap, raw_value: v.value }
          : { value: v.value }),
        ...(v.unit !== undefined && v.unit !== '' ? { unit: v.unit } : {}),
      };
      const res = await applyFactorValueEdit({
        payload: {
          kind: 'system_event',
          turn_id: authorisationTurnId(`${parent.proposal_id}#value${i}`),
          scenario_id: ctx.scenario_id,
          stage: 'frame',
          event,
        } as never,
        event: event as never,
        requestId: ctx.request_id,
        persistedGraph: working,
        priorFacts: [],
      });
      if (res.kind !== 'mutated') {
        const label = approvedRead.nodes.find((n) => n.id === o.path)?.label ?? o.path;
        return notApplied('value_refused', `The value for ${label} could not be recorded (${res.reason}), so nothing was written.`, { refused_factor: label });
      }
      working = res.mutatedGraph;
    }
    let workingNodes = ((working as { nodes?: GraphRead['nodes'] }).nodes ?? []).map((n) => ({ ...n }));
    // A value that landed as a bare amount above 1 gets a range from its own
    // figure — the same step the single-kind path takes after its write, done
    // here BEFORE the one write so it is part of what is conditional.
    const framed: { factor: string; value: number; range: number }[] = [];
    /** The range each framed factor is given — sent to the writer as a typed frame, never as graph bytes. */
    const frameCaps = new Map<string, number>();
    workingNodes = workingNodes.map((n) => {
      if (!valueOps.some((o) => o.path === n.id)) return n;
      if (typeof n.scale_frame === 'number' && n.scale_frame > 1) return n;
      const os = (n.observed_state ?? {}) as { value?: unknown; raw_value?: unknown; cap?: unknown };
      if (!(typeof os.value === 'number' && Math.abs(os.value) > 1 && typeof os.cap !== 'number')) return n;
      const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
      const range = defaultFrameFor(raw);
      if (range <= 1) return n;
      framed.push({ factor: n.label, value: raw, range });
      frameCaps.set(n.id, range);
      return { ...n, observed_state: { ...os, value: raw / range, raw_value: raw, cap: range, declared_scale: 'unit_interval' } };
    });
    // ⛔ A LEVEL IS A NUMBER ON ITS FACTOR'S FRAME. If this approval's own
    // values would give a level's factor a DIFFERENT frame from the one the
    // level was normalised against, the level would silently mean something
    // else (1.0 of 0-10 is 10, not the 1 the user was shown). Refuse first.
    const byIdAfterValues = new Map(workingNodes.map((n) => [n.id, n]));
    for (const o of levelOps) {
      const factorId = o.path.split('::')[1];
      const lv = (o.value ?? {}) as { cap?: number | null; derived_frame?: number | null };
      const levelFrame = typeof lv.cap === 'number' && lv.cap > 0 ? lv.cap : null;
      const factorFrame = frameOf(byIdAfterValues.get(factorId));
      if (factorFrame !== null && levelFrame !== null && factorFrame !== levelFrame) {
        return notApplied('level_frame_changed_by_values', `A level for ${byIdAfterValues.get(factorId)?.label ?? factorId} was proposed on a range this approval's own values would change. Nothing was written — propose again.`);
      }
      if (factorFrame !== null && levelFrame === null) {
        return notApplied('level_frame_changed_by_values', `A level for ${byIdAfterValues.get(factorId)?.label ?? factorId} was proposed before it had a range that this approval would give it. Nothing was written — propose again.`);
      }
    }
    // Derived level frames on factors that hold a value and still have no
    // range — the same attachment the single-kind level path makes.
    workingNodes = workingNodes.map((n) => {
      const cohort = levelOps.filter(o => o.path.split('::')[1] === n.id);
      if (!cohort.some(o => typeof ((o.value ?? {}) as { derived_frame?: unknown }).derived_frame === 'number') || frameOf(n) !== null) return n;
      const range = proposedFrameForLevels(cohort.map(levelFigureOf));
      if (range === null) return n;
      const os = (n.observed_state ?? {}) as { value?: number; raw_value?: number };
      const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
      if (typeof raw !== 'number' || range <= 1) return n;
      framed.push({ factor: n.label, value: raw, range });
      frameCaps.set(n.id, range);
      return { ...n, observed_state: { ...os, value: raw / range, raw_value: raw, cap: range, declared_scale: 'unit_interval' } };
    });
    /**
     * ⛔ AN ADOPTED ASSUMPTION IS STORED AS AN ASSUMPTION, NOT AS THE USER'S OWN
     * FIGURE (panel #63 5811761386 item 6). `applyFactorValueEdit` stamps
     * `USER_EDIT_SOURCE` (the user's-own-figure stamp) because the inspector it was built for
     * is where the user TYPES the number. Registered as-is, one "yes" to Olumi's
     * proposed values stored them as the user's own: "User edited" in the UI,
     * `user_stated` to the readiness authority — and a single such parameter
     * licenses a comparative-leader claim (`analysis-admission.ts`).
     *
     * `user_assumption` is the contract's own literal for it (0.55
     * `OBSERVED_STATE_SOURCE_LITERALS`; CEE's `ObservedStateV3` accepts it; the UI
     * labels it "Your assumption"; `obligation-provenance.ts` classifies it
     * `user_ratified` — a human act, not authorship). Nothing is invented and no
     * measurement is claimed. This path can stamp it because THIS capability
     * composes the registered bytes. A USER-authored proposal keeps the writer's
     * stamp — decided PER VALUE (`valueOpAuthor`). The single-kind `set_factor_value` path
     * reaches the same stamp at the writer, through the approved-adoption context.
     */
    workingNodes = workingNodes.map((n) => {
      if (!valueOps.some((o) => o.path === n.id && valueOpAuthor(o, parent) === 'model_proposed')) return n;
      const os = n.observed_state;
      if (os === undefined || typeof os.value !== 'number') return n;
      return { ...n, observed_state: { ...os, source: ADOPTED_ASSUMPTION_SOURCE } };
    });

    /**
     * ⭐ THE WHOLE APPROVAL IS ONE COMMIT (Canonical #70 5849037691; the door, CEE #2031). The values were written
     * through `/graph/register` — their own commit and receipt — and THEN the links and levels through the door, so a
     * refused level left the values written (`partially_applied`, two receipts). The values (in the user's units) and
     * the ranges they need now ride the SAME port call as the links and levels: one commit and one receipt, or none.
     * The in-memory pass above stays: it refuses before anything is sent, and the read-back checks against it.
     */
    const receipts: ReceiptSummary[] = [];
    const reencodedSiblings: ReencodedSibling[] = [];
    let valuesLanded = false;
    let carried = parent.base_graph_identity_hash;
    const values = valueOps.map((o) => {
      const v = (o.value ?? {}) as { value?: number; unit?: string };
      return {
        factor_id: o.path, value: v.value as number,
        ...(typeof v.unit === 'string' && v.unit !== '' ? { unit: v.unit } : {}),
        author: valueOpAuthor(o, parent) === 'user_stated' ? 'user_specified' as const : 'model_proposed' as const,
      };
    });
    const frames = [...frameCaps].map(([factor_id, cap]) => ({ factor_id, cap }));
    const expectedValueOf = new Map(workingNodes.filter((n) => valueOps.some((o) => o.path === n.id))
      .map((n) => [n.id, (n.observed_state as { value?: unknown } | undefined)?.value]));

    // (3) ⭐ THE LINKS AND LEVELS AS ONE COMMIT (Canonical #70 5847348206): the product's N-ary level writer commits the
    // whole approved scope on the revision our values write produced (or the approved one) — any pair refused means
    // none committed. The link a level needs is written first INSIDE that commit, so no level lands on an unlinked factor.
    let levelsRecorded = 0;
    let levelStop: string | null = null;
    let stopReason: string | undefined;
    const linksAdded: string[] = [];
    let linksResized: ResizedLinksGroup[] = [];
    const labelOf = (id: string): string => approvedRead.nodes.find((n) => n.id === id)?.label ?? id;
    const pairWords = (p: { option_id: string; factor_id: string }): string => `${labelOf(p.option_id)} \u2192 ${labelOf(p.factor_id)}`;
    if (levelInputs.length + linkOps.length + values.length + frames.length > 0) {
      const links = linkOps.map((o) => pairOf(o.path));
      const levels = levelInputs.map(l => levelOnFinalFrame({ ...l, value: l.value as number }, frameOf(workingNodes.find(n => n.id === l.factor_id))));
      const res = await opts.commitOptionLevels!({
        scenario_id: ctx.scenario_id,
        base_graph_hash: carried,
        turn_id: authorisationTurnId(`${parent.proposal_id}#levels`),
        links,
        levels,
        ...(optionGaps.length > 0 ? { option_gaps: optionGaps.map(d => ({ option_id: d.optionId, mechanisms: d.mechanisms, operands: optionGapOperands(approvedRead.raw, d.optionId)! })) } : {}),
        ...(values.length > 0 ? { values } : {}),
        ...(frames.length > 0 ? { frames } : {}),
      });
      if (res.status === 'unconfirmed') {
        // ⛔ The commit was attempted and could not be read back: neither saved nor refused (#1995's `not_confirmed`).
        return {
          ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id,
          refusal: 'not_confirmed', receipts,
          detail: 'This change was sent as one, but Olumi could not read the model back to confirm it. Say exactly that; never say they were saved or not saved.',
        };
      } else if (res.status === 'stale') {
        levelStop = 'the model changed after this was approved, so nothing in this change was written';
      } else if (res.status === 'refused') {
        if (res.reason === SIBLING_LEVEL_UNRESOLVABLE) return { ok: false, mutated: false, applied: false,
          proposal_id: parent.proposal_id, refusal: res.reason, reason: res.reason, detail: SIBLING_LEVEL_UNRESOLVABLE_SENTENCE, follow_up: SIBLING_LEVEL_UNRESOLVABLE_SENTENCE, receipts };
        const what = res.pair !== undefined ? `the level for ${pairWords(res.pair)}`
          : res.value !== undefined ? `the value for ${labelOf(res.value.factor_id)}`
            : res.frame !== undefined ? `the range for ${labelOf(res.frame.factor_id)}` : 'part of this change';
        levelStop = `${what} was refused, so nothing in this change was written`;
        stopReason = res.reason;
      } else {
        reencodedSiblings.push(...(res.reencoded_siblings ?? []));
        if (res.receipt !== null) receipts.push({ ...res.receipt, source_turn_id: res.receipt.source_turn_id ?? '',
          ...(reencodedSiblings.length > 0 ? { reencoded_siblings: reencodedSiblings } : {}) });
        carried = res.graph_hash;
        // ⛔ LANDED = WHAT THE MODEL HOLDS (#1995): every approved link and level, read back — never the revision alone.
        const check = await readGraph(ctx.scenario_id);
        const holds = check !== null
          && optionGapsHeld(check.raw, optionGaps)
          && levels.every((l) => {
            const committed = res.committed_levels.find(c => c.option_id === l.option_id && c.factor_id === l.factor_id);
            const node = check.nodes.find(n => n.id === l.option_id);
            // Value-only ports retain the sent coordinate contract; only a complete
            // committed native point supersedes the proposal's range.
            if (committed?.raw_value === undefined || committed.cap === undefined) {
              const held = mergeInterventionSourceObjects(node ?? {})[l.factor_id];
              return (typeof held === 'number' ? held : (held as { value?: unknown } | undefined)?.value) === l.value;
            }
            const current = resolveRawInterventionValue(mergeInterventionSourceObjects(node ?? {})[l.factor_id], buildFactorScaleMap(check.nodes).get(l.factor_id));
            const saved = committed.raw_value;
            return current.value !== null && sameAfterScaling(current.value, saved);
          })
          && links.every((k) => check.edges.some((e) => e.from === k.option_id && e.to === k.factor_id))
          && [...expectedValueOf].every(([id, v]) => (check.nodes.find((n) => n.id === id)?.observed_state as { value?: unknown } | undefined)?.value === v);
        if (!holds) {
          return {
            ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id,
            refusal: check === null ? 'not_confirmed' : 'not_verified', receipts,
            ...(reencodedSiblings.length > 0 ? { reencoded_siblings: reencodedSiblings, follow_up: reencodedSiblings.map(c => c.detail).join(' ') } : {}),
            detail: 'This change was sent as one, but reading the model back did not show all of it. Say exactly that; never say it was saved or not saved.',
          };
        }
        levelsRecorded = levels.length;
        linksAdded.push(...links.map(pairWords));
        valuesLanded = values.length > 0;
        // ⭐ P1-a: Olumi's own links the commit re-sized to fit a new level, read from the door's result (never a graph
        // diff) and grouped by the same function the door's receipt uses — so the server can say it (`state_facts`).
        linksResized = groupResizedLinks(res.links_resized ?? [], [...new Set([...values.map((v) => v.factor_id), ...frameCaps.keys()])], labelOf);
      }
    }

    const all = levelStop === null && levelsRecorded === levelOps.length;
    // ⛔ WHAT STILL STANDS IS READ AFTER THE REFUSAL, never from the pre-attempt snapshot (CODEX CEE BUDDY 5924253824): a
    // stale refusal means the model moved, so the approved read can name a figure that is no longer there. `null` = the
    // read failed, and the words then say the current figure could not be confirmed.
    const readAfterRefusal = valueOps.length > 0 && !valuesLanded ? await readGraph(ctx.scenario_id) : null;
    if (all) proposals.markApplied(parent.proposal_id, receipts);
    const parts = [
      // A keep (its stored basis) records the user's acceptance of Olumi's unchanged figure: the receipt says that, never
      // "starting values" (served 5a2290c, guest 02440e60: "Saved 1 of 1 starting values.").
      ...(valueOps.length > 0 ? [{ part: 'values', ok: valuesLanded, recorded_count: valuesLanded ? valueOps.length : 0, requested_count: valueOps.length,
        ...(isKeepProposal(parent) ? { kept: true } : {}),
        ...(valuesLanded ? {} : { ...(stopReason !== undefined ? { reason: stopReason } : {}), not_saved: valuesNotSaved(valueOps, parent, readAfterRefusal, labelOf) }) }] : []),
      ...(linkOps.length > 0 ? [{ part: 'links', ok: linksAdded.length === linkOps.length, recorded_count: linksAdded.length, requested_count: linkOps.length }] : []),
      ...(levelOps.length > 0 ? [{ part: 'option_levels', ok: levelStop === null, recorded_count: levelsRecorded, requested_count: levelOps.length }] : []),
    ];
    return {
      ok: all,
      mutated: valuesLanded || linksAdded.length > 0 || levelsRecorded > 0,
      applied: all,
      ...(optionGaps.length > 0 ? { public_label: parent.public_label } : {}),
      proposal_id: parent.proposal_id,
      parts,
      receipts,
      ...(reencodedSiblings.length > 0 ? { reencoded_siblings: reencodedSiblings, detail: reencodedSiblings.map(c => c.detail).join(' '), follow_up: reencodedSiblings.map(c => c.detail).join(' ') } : {}),
      revision_before: parent.base_graph_identity_hash,
      revision_after: carried,
      ...(framed.length > 0 ? { ranges_added_for_analysis: framed } : {}),
      ...(all && linksResized.length > 0 ? { links_resized: linksResized } : {}),
      ...(all
        ? {
            not_represented:
              `${valueAuthorshipNote(valueOps, parent, (id) => approvedRead.nodes.find((n) => n.id === id)?.label ?? id)} ` +
              (parent.provenance.authored_by === 'model_proposed'
                ? 'The option levels are the user\u2019s adopted assumptions too, not measurements, but carry no such mark \u2014 '
                : 'The option levels are the user\u2019s own figures too \u2014 ') +
              'say so when you describe what changed.',
          }
        : {
            refusal: valuesLanded || linksAdded.length > 0 || levelsRecorded > 0 ? 'partially_applied' : 'not_applied',
            detail:
              `${levelStop ?? 'Not every change was recorded'}.` +
              (linksAdded.length > 0 ? ` These links WERE added and stay in the model: ${linksAdded.join('; ')}.` : '') +
              ' Tell the user exactly which part was recorded and which was not.',
          }),
    };
  };
  /**
   * ⭐ A SET OF LINK STRENGTHS AS ONE COMMIT (seam Canonical #72 5871633483; DL 5871661097): the level door
   * (`commitOptionLevels`) with `link_strengths` alone. The writer checks every link BEFORE any write — a link that moved
   * since the proposal, or a definitional link the last Run used, refuses the whole set and writes nothing. Landed is
   * what the model holds, read back: each link at exactly its approved strength, stamped as the approval said (the
   * user's band as theirs; Olumi's band as `olumi_estimate`, never the user's).
   */
  /**
   * ⭐ THE USER'S STATED LINK EFFECT, WRITTEN (DL 5882763151; Canonical #2274's door, 5883082976). ONE effect per approval
   * through the level door's `link_effect`: the writer re-checks the revision AND the link's bytes (`edge_token`) and the
   * sign against the STORED link, then ONE append. "Recorded" is said only when a read-back shows the link as the user's.
   */
  const applyLinkEffect = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0],
    parent: StructuredProposal,
    approvedRead: GraphRead,
  ): Promise<ToolResult> => {
    const notApplied = (reason: string, detail: string): ToolResult => ({
      ok: false, mutated: false, applied: false, proposal_id: parent.proposal_id, refusal: 'not_applied', reason, detail, receipts: [],
    });
    const effectValues = parent.operations.map((operation) => operation.op === 'set_link_effect' ? operation.value as {
      from?: unknown; to?: unknown; effect?: Record<string, unknown>; quote?: unknown; edge_token?: unknown; unit_readings?: readonly LinkEffectUnitReading[]; reversal?: { from: 'positive' | 'negative'; to: 'positive' | 'negative' }; link_selected?: true;
    } : undefined);
    const validEffect = (v: typeof effectValues[number]): v is NonNullable<typeof v> => v !== undefined
      && typeof v.from === 'string' && typeof v.to === 'string' && typeof v.quote === 'string'
      && typeof v.edge_token === 'string' && typeof v.effect?.amount === 'number' && typeof v.effect?.per_source_change === 'number'
      && typeof v.effect?.amount_unit === 'string' && typeof v.effect?.per_source_change_unit === 'string'
      && isLinkEffectUnitReadings(v.unit_readings, v.from, v.to);
    if (effectValues.length === 0 || effectValues.some((v) => !validEffect(v))) {
      return notApplied('unreadable_proposal', 'This link\u2019s size could not be read from the stored proposal, so nothing was recorded. Offer to prepare it again.');
    }
    const values = effectValues as NonNullable<typeof effectValues[number]>[];
    // ⛔ ONLY FROM THE CARD (PR Review's fifth CR): the user's figure is recorded only when they press the button that shows
    // the exact reading it records (`approvalChipsFor`), never from their words to the model.
    if (ctx.typed_approval_of !== parent.proposal_id) {
      return notApplied('approve_on_the_card', 'Nothing was recorded: the user\u2019s own figure for a link is recorded only when they press the '
        + 'button that shows exactly what will be recorded. Point them to that button; never record it from their words.');
    }
    // ⛔ …and only when that button carried the EXACT reading this approval records (AIQ 5885290014): recomputed here from
    // the stored proposal and the labels on the read, never taken from the request.
    const labelOf = (id: string): string => cardNameOf(approvedRead, id);
    const reading = values.length === 1
      ? linkEffectReadingOf(parent, { from: labelOf(values[0]!.from as string), to: labelOf(values[0]!.to as string) })
      : linkEffectReadingsOf(parent, values.map((v) => ({ from: labelOf(v.from as string), to: labelOf(v.to as string) })));
    if (reading === undefined || readingOfLinkEffectApproval(ctx.typed_approval_words) !== reading) {
      return notApplied('reading_not_confirmed', 'Nothing was recorded: the button pressed did not carry the exact reading that would be '
        + 'recorded, so the user has not confirmed it. Show them the reading again and let them confirm it on its button; never record it without that.');
    }
    if (approvedRead.graph_hash !== parent.base_graph_identity_hash) {
      return notApplied('model_changed_since_approval', 'The model changed after this was prepared, so nothing was recorded. Read it again and propose afresh.');
    }
    if (opts.commitOptionLevels === undefined) {
      return notApplied('link_effect_writer_unavailable', 'This link\u2019s size could not be recorded here, so nothing was recorded.');
    }
    let working: unknown = approvedRead.raw;
    /**
     * ⛔ THE READ-BACK LOOKS FOR THE WRITER'S OWN POSTIMAGE (DL #2561 round 2, P1): the dry run below IS the canonical writer
     * on the same base, so its natural effect is exactly what the door stores. Never the stated words re-keyed: the sizer
     * stores a % source's change as "%" when the user said "percentage points", and a words check then reported an applied
     * write as not_verified, never marking the proposal applied.
     */
    const postimages: { from: string; to: string; edge_token: string | null; natural_effect: Record<string, unknown> | undefined }[] = [];
    const approvedEffects = values.map((v) => ({ from: v.from as string, to: v.to as string,
      effect: { amount: v.effect!.amount as number, amount_unit: v.effect!.amount_unit as string,
        per_source_change: v.effect!.per_source_change as number, per_source_change_unit: v.effect!.per_source_change_unit as string },
      edge_token: v.edge_token as string, quote: v.quote as string,
      ...(v.unit_readings !== undefined ? { unit_readings: v.unit_readings } : {}),
      ...(v.reversal !== undefined ? { reversal: v.reversal } : {}), ...(v.link_selected ? { link_selected: true as const } : {}),
      reading_token: linkEffectReadingToken({ from: v.from as string, to: v.to as string,
        effect: { amount: v.effect!.amount as number, amount_unit: v.effect!.amount_unit as string,
          per_source_change: v.effect!.per_source_change as number, per_source_change_unit: v.effect!.per_source_change_unit as string }, quote: v.quote as string,
        ...(v.unit_readings !== undefined ? { unit_readings: v.unit_readings } : {}),
        ...(v.reversal !== undefined ? { reversal: v.reversal } : {}), ...(v.link_selected ? { link_selected: true } : {}) }) }));
    for (const item of approvedEffects) {
      const currentEdgeToken = linkEffectEdgeToken(working, item.from, item.to);
      if (currentEdgeToken !== item.edge_token) {
        const from = { id: item.from, label: approvedRead.nodes.find((n) => n.id === item.from)?.label ?? item.from };
        const to = { id: item.to, label: approvedRead.nodes.find((n) => n.id === item.to)?.label ?? item.to };
        return notApplied('link_effect_refused', linkEffectRefusalWords('superseded', working, from, to));
      }
      const expectedHash = computeAnalysisAffectingGraphHash(working as never);
      if (expectedHash === null) return notApplied('model_changed_since_approval', 'The model could not be read in the form this approval was prepared against, so nothing was recorded. Read it again and propose afresh.');
      const dry = applyLinkEffectEdit({ persistedGraph: working, from: item.from, to: item.to, effect: item.effect,
        expected: { graph_hash: expectedHash, edge_token: item.edge_token }, quote: item.quote, reading_token: item.reading_token,
        ...(item.unit_readings !== undefined ? { unit_readings: item.unit_readings } : {}),
        ...(item.reversal !== undefined ? { reversal: item.reversal } : {}), ...(item.link_selected ? { link_selected: true } : {}),
        // S5t: a frame refit only where the door admits one — ONE approved link goes to the `link_effect` door (below).
        ...(approvedEffects.length === 1 ? { frameRefit: true as const } : {}),
        lastRunIdentityUse: approvedRead.identity_run_use ?? null });
      if (dry.kind === 'refused') {
        const from = { id: item.from, label: approvedRead.nodes.find((n) => n.id === item.from)?.label ?? item.from };
        const to = { id: item.to, label: approvedRead.nodes.find((n) => n.id === item.to)?.label ?? item.to };
        return notApplied('link_effect_refused', linkEffectRefusalWords(dry.reason, working, from, to, item.effect, stillReadUnitReadings(working, item)));
      }
      working = dry.mutatedGraph;
      const written = linkEffectTargetOf(working, item.from, item.to);
      const writtenProvenance = written.kind === 'one' && isPlainRecord(written.edge.provenance) ? written.edge.provenance : undefined;
      postimages.push({ from: item.from, to: item.to, edge_token: linkEffectEdgeToken(working, item.from, item.to),
        natural_effect: isPlainRecord(writtenProvenance?.natural_effect) ? writtenProvenance.natural_effect : undefined });
    }
    const res = await opts.commitOptionLevels({
      scenario_id: ctx.scenario_id,
      base_graph_hash: parent.base_graph_identity_hash,
      turn_id: authorisationTurnId(`${parent.proposal_id}#effect`),
      links: [],
      levels: [],
      // Canonical #2283: the token of the reading the pressed card SHOWED (checked above), recomputed from the stored proposal.
      ...(approvedEffects.length === 1 ? { link_effect: approvedEffects[0] } : { link_effects: approvedEffects }),
    });
    if (res.status === 'unconfirmed') {
      return { ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id, refusal: 'not_confirmed', receipts: [],
        detail: 'These link sizes were sent, but Olumi could not read the model back to confirm them. Say exactly that; never say they were recorded or not recorded.' };
    }
    if (res.status === 'stale') {
      return notApplied('model_changed_since_approval', 'The model changed after this was approved, so nothing was recorded. Read it again and propose afresh.');
    }
    if (res.status === 'refused') {
      const reason = String(res.reason ?? '').replace(/^link_/, '') as LinkEffectRefusal;
      const failed = res.link ?? approvedEffects[0]!;
      const from = { id: failed.from, label: approvedRead.nodes.find((n) => n.id === failed.from)?.label ?? failed.from };
      const to = { id: failed.to, label: approvedRead.nodes.find((n) => n.id === failed.to)?.label ?? failed.to };
      const approved = approvedEffects.find((e) => e.from === failed.from && e.to === failed.to);
      // Codex r2: the canonical writer refused on the graph IT re-read at commit, which may differ from approval's read
      // (a reading changed in between; the analysis hash unchanged). The words read that current graph and keep only the
      // readings it still makes. If it cannot be re-read, no reading is put back.
      const now = await readGraph(ctx.scenario_id);
      return notApplied('link_effect_refused', linkEffectRefusalWords(reason, now?.raw ?? approvedRead.raw, from, to, approved?.effect,
        approved === undefined || now === null ? undefined : stillReadUnitReadings(now.raw, approved)));
    }
    const receipts: ReceiptSummary[] = res.receipt !== null ? [{ ...res.receipt, source_turn_id: res.receipt.source_turn_id ?? '' }] : [];
    const check = await readGraph(ctx.scenario_id);
    // PR Review on #2275: the read-back proves THIS figure — the user's source, both numbers, and both units — on the ONE
    // stored link of each pair, against the writer's own postimage of it (above), never against the stated words.
    const holds = check !== null && postimages.every((post) => {
      // The ONE stored link the writer resolves (directed, exactly one per pair): a confounder beside it is not read back.
      const stored = linkEffectTargetOf(check.raw, post.from, post.to);
      const prov = (stored.kind === 'one' && isPlainRecord(stored.edge.provenance) ? stored.edge.provenance : {}) as { source?: unknown; magnitude?: unknown; reading?: unknown; source_quote?: unknown;
        natural_effect?: { amount?: unknown; amount_unit?: unknown; per_source_change?: unknown; per_source_change_unit?: unknown } };
      const want = post.natural_effect;
      const unitKey = (u: unknown): string | undefined => (typeof u === 'string' ? unitComparisonKey(u) : undefined);
      const sameUnit = (storedUnit: unknown, written: unknown): boolean => unitKey(storedUnit) !== undefined && unitKey(storedUnit) === unitKey(written);
      return stored.kind === 'one' && post.edge_token !== null && linkEffectEdgeToken(check.raw, post.from, post.to) === post.edge_token
        && want !== undefined && prov.source === 'user_specified' && prov.magnitude === 'user_stated'
        && prov.reading === 'agent_proposed_user_confirmed' && prov.source_quote === values.find(v => v.from === post.from && v.to === post.to)?.quote
        && typeof want.amount === 'number' && prov.natural_effect?.amount === want.amount
        && typeof want.per_source_change === 'number' && prov.natural_effect?.per_source_change === want.per_source_change
        && sameUnit(prov.natural_effect?.amount_unit, want.amount_unit) && sameUnit(prov.natural_effect?.per_source_change_unit, want.per_source_change_unit);
    }) && approvedEffects.every((item) => (item.unit_readings ?? []).every((adoption) => {
      const nodes = isPlainRecord(check.raw) && Array.isArray(check.raw.nodes)
        ? check.raw.nodes.filter((node): node is Record<string, unknown> => isPlainRecord(node) && node.id === adoption.node_id) : [];
      return nodes.length === 1 && isDeepStrictEqual(nodes[0]!.unit_reading, adoption.unit_reading);
    }));
    if (!holds) {
      return { ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id, refusal: check === null ? 'not_confirmed' : 'not_verified', receipts,
        detail: 'These link sizes were sent, but reading the model back did not show all of them as recorded. Say exactly that; never say they were recorded or not recorded.' };
    }
    proposals.markApplied(parent.proposal_id, receipts);
    // ⭐ S5t (Science d5 #87 6009444385, DL adopted): a frame the refit widened is said ONCE, in Science's words — read off
    // the model before approval and the read-back above, never the writer's own account. Only the one-link door refits.
    const reframed = approvedEffects.length === 1 ? reframedNodeIds(approvedRead.raw, check?.raw) : [];
    const progress = guidedSizingProgressLine(check!.raw, approvedRead.analysis_result);
    const receipt = approvedEffects.length === 1
      ? `Recorded your figure for how "${labelOf(approvedEffects[0]!.from)}" moves "${labelOf(approvedEffects[0]!.to)}", from your words, as you confirmed: "${approvedEffects[0]!.quote}"${/[.!?]$/.test(approvedEffects[0]!.quote) ? '' : '.'}${reframed.length > 0 ? ` ${frameRefitReceipt(reframed.map(labelOf))}` : ''} Any earlier result is now out of date.`
      : `Recorded your figures for ${approvedEffects.length} links, from your words, as you confirmed. Any earlier result is now out of date.`;
    return {
      ok: true, mutated: true, applied: true, proposal_id: parent.proposal_id, receipts,
      guided_sizing_commit: true,
      guided_sizing_run_key: runExplanationKeyForRecord(ctx.scenario_id, approvedRead.analysis_state, approvedRead.analysis_result),
      guided_sizing_run_result: approvedRead.analysis_result,
      revision_before: parent.base_graph_identity_hash, revision_after: res.graph_hash,
      follow_up: progress === null ? receipt : `${receipt} ${progress}`,
    };
  };

  /**
   * ⭐ THE CONFIRM CARD'S PROPOSAL (`../identity-card.ts`): R3's reading verbatim, on the revision it was read from. Its id
   * is its content, so the same card on the same revision is the same proposal — which is how it is offered once.
   */
  const identityProposalFor = (ctx: { scenario_id: string; authenticated_user_id: string | null }, graphHash: string, card: IdentityProposal): StructuredProposal =>
    createProposal({
      scenario_id: ctx.scenario_id,
      user_id: ctx.authenticated_user_id,
      base_graph_identity_hash: graphHash,
      operations: [{ op: CONFIRM_IDENTITY_OP, path: card.outcome_id,
        value: { outcome_id: card.outcome_id, operation: card.operation, factor_ids: [...card.factor_ids], words: card.words,
          ...(card.ceiling_stock !== undefined ? { ceiling_stock: card.ceiling_stock } : {}),
          ...(card.one_off_words !== undefined ? { one_off_words: card.one_off_words } : {}),
          ...(card.part_levels !== undefined ? { part_levels: card.part_levels } : {}) } }],
      provenance: { authored_by: 'user_stated', basis: card.words },
      validation: { admitted: true, loss_count: 0, refusals: [] },
      public_label: card.words,
    });
  /**
   * The card's hint for a Run on this stored model: offered on EVERY Run while the reading is unconfirmed (R3 served witness
   * 57997d1, run k: the draft's card was never shown, "once per revision" then hid it from the Run, and the user was left with
   * "hasn't been confirmed" and no button). The same revision and words give the same proposal id (`put` is idempotent).
   */
  const identityCardFor = (_ctx: { scenario_id: string; authenticated_user_id: string | null },
    read: { readonly raw: unknown; readonly graph_hash: unknown; readonly brief_text?: string | null } | null | undefined) => {
    if (read === null || read === undefined || typeof read.graph_hash !== 'string' || read.graph_hash === '') return undefined;
    const card = identityReadingWithinTimeClass(read.raw, read.brief_text);
    // An unwritable base (the writer's own check) offers no card: its Yes could not be recorded (DL 5897757819). Nor does a
    // part with no level (B1 828d87ac): the writer refuses that Yes, and the level is asked first (`identityLevelAskFor`).
    return identityCardHintFor(card !== null && identityConfirmBaseIsWritable(read.raw)
      && (card.ceiling_stock !== undefined || identityPartsWithoutLevel(read.raw, card.factor_ids).length === 0) ? card : null, false);
  };
  /** The words said instead of the card when the stored reading has a part with no level; null otherwise. */
  const identityLevelAskFor = (raw: unknown, brief?: string | null): string | null => {
    // A brief outside the time class is offered no reading (`identityReadingWithinTimeClass`), so no level is asked for one either.
    const card = timeClassOf(brief).supported ? proposeProductIdentity(raw) : null;
    if (card === null) return null;
    const missing = identityPartsWithoutLevel(raw, card.factor_ids);
    if (missing.length === 0) return null;
    const nodes = (raw as { nodes?: { id?: unknown; label?: unknown }[] } | null)?.nodes ?? [];
    const labelOf = (id: string): string => { const l = nodes.find((n) => n?.id === id)?.label; return typeof l === 'string' && l.trim() !== '' ? l.trim() : id; };
    return identityPartLevelAsk(labelOf(card.outcome_id), card.factor_ids.map(labelOf), missing);
  };

  /**
   * ⭐ "YES" ON THE CONFIRM CARD (DL 5888399097 / 5888631168; Canonical #2292's door): the goal's product recorded as the
   * user's own, ONE append, alone — only from the button showing EXACTLY the words the proposal stores, on the revision it
   * was offered on. It runs nothing (Paul's ruling, #63 5812069638): the reply offers the Run.
   */
  const applyIdentityConfirm = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0],
    parent: StructuredProposal,
    approvedRead: GraphRead,
  ): Promise<ToolResult> => {
    const notApplied = (reason: string, detail: string): ToolResult => ({
      ok: false, mutated: false, applied: false, proposal_id: parent.proposal_id, refusal: 'not_applied', reason, detail, receipts: [],
    });
    const reading = identityReadingOf(parent);
    if (reading === undefined) {
      return notApplied('unreadable_proposal', 'This reading could not be read from the stored proposal, so nothing was recorded. Offer it again only if it still applies.');
    }
    const labelOf = (id: string): string => { const l = approvedRead.nodes.find((n) => n.id === id)?.label; return typeof l === 'string' && l !== '' ? l : id; };
    const goalLabel = labelOf(reading.outcome_id);
    if (ctx.typed_approval_of !== parent.proposal_id) {
      return notApplied('approve_on_the_card', 'Nothing was recorded: a reading of the goal is recorded only when the user presses the button '
        + 'that shows it. Point them to that button; never record it from their words.');
    }
    if (readingOfIdentityApproval(ctx.typed_approval_words) !== reading.words) {
      return notApplied('reading_not_confirmed', identityRefusalWords('reading_not_confirmed', goalLabel));
    }
    if (approvedRead.graph_hash !== parent.base_graph_identity_hash) {
      return notApplied('model_changed_since_approval', 'The model changed after this was offered, so nothing was recorded. Read it again; offer the reading afresh only if it still applies.');
    }
    if ((await opts.readPendingActions?.(ctx.scenario_id) ?? []).some(p => scopeIssueBlocks(p.action))) return notApplied('goal_scope_unresolved', 'Resolve the retained scope question before confirming this identity. Nothing was written.');
    if (opts.commitOptionLevels === undefined) {
      return notApplied('identity_writer_unavailable', 'This reading could not be recorded here, so nothing was recorded.');
    }
    const choice = typeof ctx.typed_approval_words === 'string' && ctx.typed_approval_words.startsWith('No — ') ? 'one_off' as const : undefined;
    const res = await opts.commitOptionLevels({
      scenario_id: ctx.scenario_id,
      base_graph_hash: parent.base_graph_identity_hash,
      turn_id: authorisationTurnId(`${parent.proposal_id}#identity${choice === undefined ? '' : '-one-off'}`),
      links: [],
      levels: [],
      // Canonical 5888513620: the token of the words the pressed card SHOWED (checked above), recomputed from the stored proposal.
      identity_confirm: { outcome_id: reading.outcome_id, factor_ids: [...reading.factor_ids], words: reading.words,
        ...(reading.ceiling_stock !== undefined ? { ceiling_stock: reading.ceiling_stock } : {}),
        ...(reading.part_levels !== undefined ? { part_levels: reading.part_levels } : {}),
        choice, reading_token: identityConfirmReadingToken({ ...reading, choice }) },
    });
    if (res.status === 'unconfirmed') {
      return { ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id, refusal: 'not_confirmed', receipts: [],
        detail: 'This reading was sent, but Olumi could not read the model back to confirm it. Say exactly that; never say it was recorded or not recorded.' };
    }
    if (res.status === 'stale') {
      return notApplied('model_changed_since_approval', 'The model changed after this was approved, so nothing was recorded. Read it again; offer the reading afresh only if it still applies.');
    }
    if (res.status === 'refused') {
      const code = String(res.reason ?? '').replace(/^identity_/, '');
      return notApplied(`identity_${code}`, identityRefusalWords(code, goalLabel));
    }
    const receipts: ReceiptSummary[] = res.receipt !== null ? [{ ...res.receipt, source_turn_id: res.receipt.source_turn_id ?? '' }] : [];
    // The read-back proves THIS reading: the goal carries the user's product of exactly these two figures.
    const check = await readGraph(ctx.scenario_id);
    const held = (check?.raw as { nodes?: Array<{ id?: unknown; nonlinear_identity?: unknown }> } | undefined)?.nodes
      ?.find((n) => n.id === reading.outcome_id)?.nonlinear_identity as { operation?: unknown; factor_ids?: unknown; stated_in_brief?: unknown } | undefined;
    const oneOff = (check?.raw as { nodes?: Array<{ id?: unknown; goal_stock_reading?: unknown; nonlinear_identity?: unknown }> } | undefined)?.nodes
      ?.find(n => n.id === reading.outcome_id);
    if (choice === 'one_off') {
      if (oneOff?.goal_stock_reading !== 'one_off' || oneOff.nonlinear_identity != null || goalStockAccumulationOf(check?.raw) !== null) return { ok: false, mutated: true, applied: false, refusal: 'not_verified' };
      proposals.markApplied(parent.proposal_id, receipts);
      return { ok: true, mutated: true, applied: true, proposal_id: parent.proposal_id, receipts, follow_up: 'Recorded the one-off reading.' };
    }
    const holds = held?.operation === reading.operation && held.stated_in_brief === true && Array.isArray(held.factor_ids)
      && held.factor_ids.length === reading.factor_ids.length && reading.factor_ids.every((id) => (held.factor_ids as unknown[]).includes(id));
    const holdsFigure = (reading.part_levels ?? []).every(part => {
      const saved = (check?.raw as { nodes?: Array<{ id?: unknown; observed_state?: { raw_value?: unknown; unit?: unknown; source?: unknown } }> } | undefined)?.nodes
        ?.find(n => n.id === part.part_id)?.observed_state;
      return saved?.raw_value === part.raw_value && saved.unit === part.unit && saved.source === 'user_override';
    });
    const stock = reading.operation === 'sum' ? goalStockAccumulationOf(check?.raw) : null;
    const holdsZero = reading.operation !== 'sum' || (stock !== null
      && (stock.netZero === null || (stock.netZero.observed_state as Record<string, unknown>).source === 'user_confirmed'));
    if (!holds || !holdsFigure || !holdsZero || (reading.ceiling_stock !== undefined && !ceilingStockRecorded(check?.raw, reading.ceiling_stock))) {
      return { ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id, refusal: check === null ? 'not_confirmed' : 'not_verified', receipts,
        detail: 'This reading was sent, but reading the model back did not show it as recorded. Say exactly that; never say it was recorded or not recorded.' };
    }
    proposals.markApplied(parent.proposal_id, receipts);
    const [rate, count] = [labelOf(reading.factor_ids[0]), labelOf(reading.factor_ids[1] ?? '')];
    return {
      ok: true, mutated: true, applied: true, proposal_id: parent.proposal_id, receipts,
      revision_before: parent.base_graph_identity_hash, revision_after: res.graph_hash,
      follow_up: identityReceiptWords(goalLabel, rate, count, check?.raw),
    };
  };

  /** The approved current-team duration goes through the single atomic team-time writer. */
  const applyTeamTime = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0], parent: StructuredProposal, approvedRead: GraphRead,
  ): Promise<ToolResult> => {
    const op = parent.operations[0]!, a = op.value as ApprovedTeamTime;
    if (op.path !== a.team_id || opts.commitOptionLevels === undefined) return { ok: false, mutated: false, applied: false, refusal: 'unavailable' };
    const part = draftedTeamPartOf(approvedRead.raw);
    if (part === null || part.team.id !== a.team_id || part.goal.id !== a.goal_id || goalDeadlineFromRecord(approvedRead.raw, part.goal.id) !== a.deadline) {
      return { ok: false, mutated: false, applied: false, refusal: 'superseded' };
    }
    const res = await opts.commitOptionLevels({ scenario_id: ctx.scenario_id, base_graph_hash: approvedRead.graph_hash,
      turn_id: authorisationTurnId(`${parent.proposal_id}#team-time`), links: [], levels: [], team_time: a });
    if (res.status === 'unconfirmed') {
      const reread = await readGraph(ctx.scenario_id), held = draftedTeamPartOf(reread?.raw);
      if (reread !== null && held !== null
        && teamTimeIsHeld(held.team, a, String(part.goal.goal_threshold_unit), reread.raw)
        && teamSharePostimageIsScoped(approvedRead.raw, reread.raw, a.team_id)) {
        proposals.markPartial(parent.proposal_id, { revision: reread.graph_hash, landed: [a.team_id], receipts: [] });
      }
      return { ok: false, mutated: true, applied: false, refusal: 'not_confirmed' };
    }
    if (res.status !== 'committed') return { ok: false, mutated: false, applied: false, refusal: res.status };
    const check = await readGraph(ctx.scenario_id);
    const held = draftedTeamPartOf(check?.raw);
    if (held === null || !teamTimeIsHeld(held.team, a, String(part.goal.goal_threshold_unit), check?.raw)) {
      return { ok: false, mutated: true, applied: false, refusal: 'not_verified' };
    }
    const receipts: ReceiptSummary[] = res.receipt !== null ? [{ ...res.receipt, source_turn_id: res.receipt.source_turn_id ?? '' }] : [];
    proposals.markApplied(parent.proposal_id, receipts);
    return { ok: true, mutated: !res.already_applied, applied: true, proposal_id: parent.proposal_id, receipts,
      observed_state: held.team.observed_state,
      ...(a.low_months === a.high_months ? { follow_up: 'Roughly how long could it take at the soonest, and at the latest, with the team you have now?' } : {}) };
  };

  /**
   * ⭐ E5: the pressed hiring-times card. It stands while its own fields do (`hiringTimesStillApply`: the parts it was
   * offered against, unchanged, under the same deadline); the postimage is built from THIS read and registered whole with
   * compare-and-set on both of this read's hashes, under an operation id of that base and this card (a retry replays; a
   * conflict writes nothing). Set only when the stored model holds every planned start, figure and link strength.
   */
  const applyHiringTimes = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0], parent: StructuredProposal, before: GraphRead,
  ): Promise<ToolResult> => {
    const pid = parent.proposal_id, a = parent.operations[0]!.value as ApprovedHiringTimes;
    const notApplied = (refusal: string, detail: string): ToolResult => ({ ok: false, mutated: false, applied: false, proposal_id: pid, refusal, detail });
    if (ctx.typed_approval_of !== pid) return notApplied('not_applied', 'These hiring timings are set only by pressing their own card, so nothing was changed.');
    if (hiringTimesHeld(before.raw, a)) {
      proposals.markApplied(pid, []);
      return { ok: true, mutated: false, applied: true, already_applied: true, proposal_id: pid, receipts: [], follow_up: HIRING_TIMES_APPLIED };
    }
    if (!hiringTimesStillApply(a, before.raw)) {
      return notApplied('superseded', 'The hiring timings in the model changed after this card was offered, so nothing was set. Offer it again only if it still applies.');
    }
    const postimage = withHiringTimes(before.raw, a) as Record<string, unknown>;
    const operationId = constructionOperationId(ctx.scenario_id, `hiring_times:${before.graph_identity_hash}:${pid}`);
    const reg = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
      graph: { ...postimage },
      expected_graph_hash: before.graph_hash, expected_graph_identity_hash: before.graph_identity_hash, operation_id: operationId,
    });
    const code = reg.status === 200 ? '' : String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
    if (/STALE/.test(code)) {
      return notApplied('superseded', 'The model changed just before the hiring timings were written, so nothing was set. Offer it again only if it still applies.');
    }
    // ⛔ CONFIRMED FROM STATE — also after an ambiguous failure, which does NOT prove no save (AIE 6122431786 §4): every option
    // holds exactly its planned starts, figures and recomputed link strengths, or the outcome is unknown, never "not set".
    const after = await readGraph(ctx.scenario_id);
    if (after === null || !hiringTimesHeld(after.raw, a)) {
      return { ok: false, mutated: true, applied: false, proposal_id: pid, refusal: 'not_confirmed',
        detail: 'The hiring timings were sent, but what the model now holds could not be confirmed. Tell the user plainly that it could not be confirmed, '
          + 'offer to check the model again, and never say they were set or that they were not.' };
    }
    const mv = reg.json.model_version as { version_number?: unknown; version_id?: unknown; mutation_id?: unknown } | undefined;
    const receipts: ReceiptSummary[] = mv !== undefined && mv !== null && typeof mv.version_id === 'string'
      ? [{ version: Number(mv.version_number), version_id: mv.version_id, mutation_id: typeof mv.mutation_id === 'string' ? mv.mutation_id : '',
        source_turn_id: registrationTurnId(ctx.scenario_id, operationId) }]
      : [];
    proposals.markApplied(pid, receipts);
    return { ok: true, mutated: true, applied: true, proposal_id: pid, receipts, follow_up: HIRING_TIMES_APPLIED, note: HIRING_TIMES_NOTE };
  };

  /**
   * ⭐ THE COACHING LOOP (DL 14 Oct; the `set_hiring_times` precedent): the pressed option-capacity card. It stands while what it
   * was offered against does (`optionCapacityChangeStillApplies`); the postimage is built from THIS read and registered whole
   * with compare-and-set on both of this read's hashes, under an operation id of that base and this card (a retry replays; a
   * conflict writes nothing). "Set" is said only once the stored model holds the carrier, the user's figure and every switch.
   */
  const applyOptionCapacityChange = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0], parent: StructuredProposal, before: GraphRead,
  ): Promise<ToolResult> => {
    const pid = parent.proposal_id, a = parent.operations[0]!.value as ApprovedOptionCapacityChange;
    const notApplied = (refusal: string, detail: string): ToolResult => ({ ok: false, mutated: false, applied: false, proposal_id: pid, refusal, detail });
    // ⛔ `follow_up` IS WHAT THE USER READS (served 7f5659fd, legacy capture 22:50Z: the agent-facing sentence was shown verbatim,
    // and the user's sentence, which named "the user's figure", was dropped as agent-addressed). The user's sentence is addressed
    // to them; the direction for the Agent stays in `note`. The successful commit runs the analysis itself: never ask for a Run.
    // AIE 6182987896 (exact receipt): it promises no admitted chance.
    const done = optionCapacityRecordedWords(a);
    const note = 'The analysis runs on the saved model; speak only to its result, and state no chance before it returns.';
    if (ctx.typed_approval_of !== pid) return notApplied('not_applied', 'This change is made only by pressing its own card, so nothing was changed.');
    if (optionCapacityChangeHeld(before.raw, a)) {
      proposals.markApplied(pid, []);
      return { ok: true, mutated: false, applied: true, already_applied: true, proposal_id: pid, receipts: [], follow_up: done, note };
    }
    if (!optionCapacityChangeStillApplies(a, before.raw)) {
      return notApplied('superseded', `The model changed after this card was offered, so nothing was set for ‘${a.option_label}’. Offer it again only if it still applies.`);
    }
    const postimage = withOptionCapacityChange(before.raw, a);
    const operationId = constructionOperationId(ctx.scenario_id, `option_capacity:${before.graph_identity_hash}:${pid}`);
    const reg = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
      graph: { ...postimage },
      expected_graph_hash: before.graph_hash, expected_graph_identity_hash: before.graph_identity_hash, operation_id: operationId,
    });
    const code = reg.status === 200 ? '' : String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
    if (/STALE/.test(code)) {
      return notApplied('superseded', `The model changed just before this was written, so nothing was set for ‘${a.option_label}’. Offer it again only if it still applies.`);
    }
    // Confirmed from state, also after an ambiguous failure (which does not prove no save): held exactly, or unknown.
    const after = await readGraph(ctx.scenario_id);
    if (after === null || !optionCapacityChangeHeld(after.raw, a)) {
      return { ok: false, mutated: true, applied: false, proposal_id: pid, refusal: 'not_confirmed',
        detail: 'The change was sent, but what the model now holds could not be confirmed. Tell the user plainly that it could not be confirmed, '
          + 'offer to check the model again, and never say it was set or that it was not.' };
    }
    const mv = reg.json.model_version as { version_number?: unknown; version_id?: unknown; mutation_id?: unknown } | undefined;
    const receipts: ReceiptSummary[] = mv !== undefined && mv !== null && typeof mv.version_id === 'string'
      ? [{ version: Number(mv.version_number), version_id: mv.version_id, mutation_id: typeof mv.mutation_id === 'string' ? mv.mutation_id : '',
        source_turn_id: registrationTurnId(ctx.scenario_id, operationId) }]
      : [];
    proposals.markApplied(pid, receipts);
    return { ok: true, mutated: true, applied: true, proposal_id: pid, receipts, follow_up: done, note };
  };

  /**
   * ⭐ B RESTATED GOAL (`draft-replacement.ts`; DL ruling (B), PL 6116779075, AIE 0244): the three gates over ONE read, at
   * the offer and again at the approval. `found` = what still refuses, in plain words; empty = a draft the revision may
   * replace. A record that cannot be read is listed too: unknown authority never permits replacement.
   *
   * ⭐ CURRENT-MODEL CALLER (PL #94 07:32Z, DL-ACKed): later human work no longer refuses by itself; it is KEPT.
   *   · G1: each human-stamped item is carried by identity onto the revised draft (`carryHumanItems`); an unknown author,
   *     a target for the goal and the steady-horizon judgement still refuse.
   *   · G2: later saved changes are in the saved model, which the revision reads as context; an incomplete ledger, or no
   *     record that the draft is the one built from the brief, still refuses.
   *   · G3: at the OFFER (`'offer'`) every later message is bound to it and read as context, never as the user's verified
   *     words; at the APPROVAL, `allowed` = the turns the offer bound plus the typed goal's, and any other message refuses.
   *   · Objections the user recorded are context; objections that cannot be read still refuse.
   * `later` says whether the draft holds any later material at all (an unedited draft is prepared exactly as before).
   */
  type DraftGate = { readonly found: string[]; readonly items: readonly HumanItem[]; readonly bound: readonly string[];
    readonly messages: readonly string[]; readonly objections: readonly string[]; readonly later: boolean };
  const unreviewedDraftGate = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0], g: GraphRead, allowed: readonly string[] | 'offer',
  ): Promise<DraftGate> => {
    const brief = typeof g.brief_text === 'string' ? g.brief_text.trim() : '';
    if (brief === '') return { found: ['no saved brief that this draft was built from'], items: [], bound: [], messages: [], objections: [], later: false };
    const items = humanItemsAfterTheDraft(g.raw);
    const found = items.filter((i) => i.carry === undefined).map((i) => i.words);
    let bound: string[] = [];
    let messages: string[] = [];
    let objections: string[] = [];
    let laterWrites = false;
    try {
      if (opts.readCommittedTurnLedger === undefined) throw new Error('turn_ledger_unavailable');
      const ledger = await opts.readCommittedTurnLedger(ctx.scenario_id);
      const writes = laterWritesThan(ledger, ctx.scenario_id, brief);
      if (typeof writes === 'string') found.push(writes);
      else laterWrites = writes > 0;
      const later = (ledger.later_user_messages ?? []).filter((m) => m.turn_id !== ctx.turn_id);
      if (allowed === 'offer') {
        bound = later.map((m) => m.turn_id);
        messages = later.map((m) => m.text);
      }
      found.push(...messagesBesidesTheBrief(ledger, brief, allowed === 'offer' ? bound : allowed, ctx.turn_id));
    } catch {
      found.push('a saved history that could not be read');
    }
    try {
      if (opts.readStatedObjections === undefined) throw new Error('stated_objections_reader_unavailable');
      objections = (await opts.readStatedObjections(ctx.scenario_id, ctx.request_id)).map((o) => o.statement);
    } catch {
      found.push('recorded objections that could not be read');
    }
    return { found, items, bound, messages, objections, later: items.length > 0 || laterWrites || messages.length > 0 || objections.length > 0 };
  };
  const DRAFT_GATE_REFUSAL = 'draft_holds_your_work';
  const TARGET_COMPARATOR_WORDS: Readonly<Record<string, string>> = { '>': 'above', '>=': 'at least', '<': 'below', '<=': 'at most' };
  /** The targets in the user's terms: ‘Quantity’ at least 20 (one target, or several joined by "and"). */
  const targetsInWords = (raw: unknown, targets: readonly { node_id: string; comparator: string; value: number; unit: string }[]): string =>
    targets.map((t) => {
      const n = ((raw as { nodes?: unknown }).nodes as Array<Record<string, unknown>> | undefined ?? []).find((x) => x?.id === t.node_id);
      return `\u2018${typeof n?.label === 'string' ? n.label : t.node_id}\u2019 ${TARGET_COMPARATOR_WORDS[t.comparator] ?? t.comparator} ${targetFigure(t.value, t.unit)}`;
    }).join(' and ');

  /** One revised draft per turn and base: the other target's call, or a retried call, reuses it; nothing is prepared twice. */
  type RevisedDraft = { readonly proposal: StructuredProposal; readonly held: ReturnType<typeof targetsHeldBy>; /** The deadline goal's deliverable, when the draft holds one. */ readonly event: string | null;
    /** The card's own sentence on a result withheld for a carried limit (`limitsKeptBy`), when it has one. */ readonly withheld?: string }
    | { readonly refused: ToolResult; /** The draft gate's findings: each target call names its own canvas step. */ readonly found?: readonly string[] };
  const revisedDrafts = new Map<string, Promise<RevisedDraft>>();
  /** Proposals this turn's `withdraw_proposal` withdrew: a recorded withdrawal, never inferred from the store's absence. */
  const withdrawnProposals = new Set<string>();
  /** How many times this turn's draft (by its cache key) was re-issued after a withdrawal: each re-issue's id is fresh. */
  const reissuedDrafts = new Map<string, number>();

  /**
   * Prepare the revised draft with C's own construction from the stored brief and THIS turn's typed goal
   * (`runPreparingDraftReplacement`: nothing is written), check it keeps every limit the draft holds, and offer it as
   * ONE card whose words are the candidate's own: what replaces the goal, what is kept, and what is not carried.
   */
  /** The revised draft does not hold the deliverable the user asked about (GEN #5, by identity): nothing is offered. */
  const noDeliverableDetail = (deliverable: string): string => `The revised draft does not hold \u2018${deliverable}\u2019 by its deadline, `
    + 'so nothing was offered and the model is unchanged. Tell the user plainly that this goal is not yet in the model.';
  const prepareRevisedDraft = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0], g: GraphRead, goal: GraphRead['nodes'][number],
    /** GEN #5: the user's deliverable, verified verbatim in this message; attests the event and binds it by identity. */
    deliverable?: string,
  ): Promise<RevisedDraft> => {
    const notOffered = (refusal: string, detail: string): RevisedDraft => ({ refused: { ok: false, mutated: false, refusal, detail } });
    const gate = await unreviewedDraftGate(ctx, g, 'offer');
    if (gate.found.length > 0) return { refused: { ok: false, mutated: false, refusal: DRAFT_GATE_REFUSAL, detail: '' }, found: gate.found };
    const typedGoal = (ctx.user_turn_text ?? '').trim();
    if (callStructured === undefined || ctx.turn_id === undefined || g.graph_identity_hash === '' || typedGoal === '') {
      return notOffered('revised_draft_unavailable', 'A revised draft cannot be prepared here, so nothing was offered and the model is unchanged. Tell the user plainly that their goal is not yet in the model.');
    }
    const sid = ctx.scenario_id;
    const input = revisedDraftBrief(g.brief_text as string, typedGoal);
    let out: ToolResult;
    try {
      // The current saved model (the agent's own view of it), the later messages and the objections, as CONTEXT only; an
      // unedited draft is prepared exactly as before, byte for byte (its current model is the draft itself).
      const context: ConstructionContext | undefined = gate.later ? { current_model: projectModelContext(g),
        ...(gate.messages.length > 0 ? { messages: gate.messages } : {}), ...(gate.objections.length > 0 ? { objections: gate.objections } : {}) } : undefined;
      out = await runPreparingDraftReplacement(sid, () => buildWithDrafterRawRecord(ctx, input, constructionOperationId(sid, input), callStructured,
        // No widening for a revised draft (prepare-only card): it stays exactly as served before the arms were restored.
        (drafter) => buildModelFromBrief(sid, input, dispatch, drafter, undefined, opts.deadlineAt, undefined, undefined, context, deliverable, true)));
    } catch {
      out = { ok: false, mutated: false };
    }
    const candidate = (out as { prepared_graph?: unknown }).prepared_graph as Record<string, unknown> | undefined;
    if (out.ok !== true || out.mutated !== false || candidate === undefined || candidate === null || typeof candidate !== 'object') {
      return notOffered('revised_draft_not_prepared', 'Olumi could not prepare a revised draft, so nothing was offered and the model is unchanged. Tell the user plainly that their goal is not yet in the model.');
    }
    const labelIn = (raw: unknown, id: string): string => {
      const n = ((raw as { nodes?: unknown }).nodes as Array<Record<string, unknown>> | undefined ?? []).find((x) => x?.id === id);
      return typeof n?.label === 'string' ? n.label : id;
    };
    const limits = limitsKeptBy(g.raw, candidate, targetFigure);
    const sayRow = (raw: unknown, r: { node_id: string; operator: string; value: number; unit: string }): string =>
      `\u2018${labelIn(raw, r.node_id)}\u2019 ${TARGET_COMPARATOR_WORDS[r.operator] ?? r.operator} ${targetFigure(r.value, r.unit)}`;
    if (limits.conflict) {
      return notOffered('revised_draft_not_prepared', 'An earlier limit could not be carried forward unchanged because its saved identity conflicts with the revised draft. Nothing was offered or changed.');
    }
    Object.assign(candidate, limits.replacement);
    // What the user set is carried by identity, with its own stamp; a node it needs that the revision lacks → nothing offered.
    const kept = carryHumanItems(candidate, gate.items, (n) => levelFrameOf(n as never));
    if (kept.missing.length > 0) {
      return notOffered('revised_draft_not_prepared', `The revised draft does not hold ${kept.missing.join('; ')}, so nothing was offered and the model is unchanged. `
        + 'Tell the user plainly which of their changes a revised draft would lose.');
    }
    Object.assign(candidate, kept.replacement);
    // The drafter's targets are its reading of the user's goal: `limitsKeptBy` stores them `inferred`, never `explicit`.
    const held = targetsHeldBy(candidate);
    // ⭐ GEN #5 (Paul's funding test, 13 Oct): a deliverable done by its deadline (the event-by-date model) is a goal the user
    // stated, as a figure target is; it holds no target row, so it is recognised by its own definition.
    // ⛔ BY IDENTITY (Codex FAIL 3023 r1): the drafted event counts only when it IS the deliverable the user asked about — its own
    // deliverable holds those words verbatim. "The agency's website" never answers a request for the MVP; a figure target's
    // call holds no deliverable, so an event alone never answers it either.
    const drafted = draftedTeamPartOf(candidate);
    const event = drafted !== null && deliverableWrittenIn(drafted.deliverable, deliverable) ? drafted : null;
    if (held.length === 0 && event === null) {
      return notOffered('revised_draft_has_no_target', deliverable !== undefined ? noDeliverableDetail(deliverable)
        : 'The revised draft holds no target for the goal the user stated, so it was not offered and the model is unchanged. Tell the user plainly.');
    }
    const nodesOf = (raw: unknown) => ((raw as { nodes?: unknown }).nodes as Array<Record<string, unknown>> | undefined ?? []);
    const basis = goalTargetBasisOf(nodesOf(candidate).find((n) => n?.kind === 'goal'));
    const period = basis === undefined ? '' : basis.period_kind === 'over_period'
      ? ` over the first ${basis.period_months} month${basis.period_months === 1 ? '' : 's'}${basis.reference === 'launch' ? ' after launch' : ''}`
      : ` at month ${basis.period_months}${basis.reference === 'launch' ? ' after launch' : ''}`;
    const options = nodesOf(candidate).filter((n) => n?.kind === 'option' && typeof n.label === 'string').map((n) => `\u2018${n.label as string}\u2019`);
    /**
     * ⭐ AGAINST THE CURRENT SAVED MODEL (PL #94 07:32Z Q2): after later work, the card names what the user set that is kept,
     * and every part the revision ADDS (a part the user removed and the drafter brought back included) or OMITS, by kind and
     * label, before an explicit approval. The goal and the decision are named by the card's own goal clause.
     */
    const partKey = (n: Record<string, unknown>): string | null => (typeof n?.label === 'string' && n.kind !== 'goal' && n.kind !== 'decision'
      ? `${String(n.kind)}:${canonicalLabel(n.label)}` : null);
    const partsOf = (raw: unknown): Map<string, string> => new Map(nodesOf(raw).flatMap((n) => {
      const k = partKey(n);
      return k === null ? [] : [[k, `\u2018${n.label as string}\u2019`] as const];
    }));
    const now = partsOf(g.raw);
    const next = partsOf(candidate);
    const added = [...next].filter(([k]) => !now.has(k)).map(([, w]) => w);
    const omitted = [...now].filter(([k]) => !next.has(k)).map(([, w]) => w);
    const againstCurrent = !gate.later ? ''
      : (kept.carried.length > 0 ? `Kept as you set them: ${kept.carried.join('; ')}. ` : '')
        + (added.length > 0 ? `Would add: ${added.join(', ')}. ` : '')
        + (omitted.length > 0 ? `Would remove from the current model: ${omitted.join(', ')}. ` : '');
    // The AIE's card clause (packet B card_without_date, 14 Oct), with construction's own deliverable, never the tool's short
    // trigger. A construction never holds a deadline date (only an approved deadline write does: `goal-horizon-write.ts`,
    // `hiring-times.ts`), so the date is always still to be confirmed, and this card never implies it saves one.
    const card = (held.length > 0
      ? `Replace the early draft with a revised one built from your brief and the goal you just gave: `
        + `${held.map((t) => sayRow(candidate, { ...t, operator: t.comparator })).join(' and ')}${period} (the draft modelled \u2018${goal.label}\u2019). `
      : `Replace the early draft with a revised one built from your brief and the goal you just gave (the draft modelled \u2018${goal.label}\u2019): `
        + `\u2018${event!.deliverable}\u2019, with the deadline date still to be confirmed. `)
      + (limits.limits.length > 0 ? `Limits in the revised draft: ${limits.limits.map((r) => sayRow(candidate, r)).join('; ')}. ` : '')
      + limits.carried.map((r) => `Carried forward unchanged because the draft omitted it: ${sayRow(g.raw, r)}. `).join('')
      + (limits.uncertain.length > 0 ? limits.uncertain.map(({ previous, proposed }) =>
        `Previous: ${sayRow(g.raw, previous)}; proposed: ${proposed.map((r) => sayRow(candidate, r)).join('; ')}. `).join('')
        + 'Do these describe the same limit? Both are retained unless you explicitly ask to remove one. ' : '')
      + (limits.withheld === undefined ? '' : `${limits.withheld} `)
      + (options.length > 0 ? `Options: ${options.join(', ')}. ` : '')
      + (limits.dropped.length > 0 ? 'Earlier nodes needed by carried limits are kept; other estimates and links from Olumi are drafted afresh. '
        : 'Not carried: Olumi\u2019s earlier estimates and links, which are drafted afresh. ')
      + againstCurrent
      // Said once: a revised draft admitted over the link limit (build-model.ts `revisedDraftOverLinksOnly`).
      + ((out as { admitted_over_limit_because?: unknown }).admitted_over_limit_because === REVISED_DRAFT_MORE_LINKS ? `${REVISED_DRAFT_MORE_LINKS} ` : '')
      + 'Check the targets, limits and options on this card before choosing.';
    const candidateHash = createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
    const proposal = createProposal({
      scenario_id: sid,
      user_id: ctx.authenticated_user_id,
      base_graph_identity_hash: g.graph_hash,
      operations: [{ op: 'replace_draft', path: sid, value: {
        candidate, candidate_hash: candidateHash, base_identity: g.graph_identity_hash, brief_text: g.brief_text,
        goal_turn_id: ctx.turn_id, typed_goal: typedGoal, bound_turn_ids: gate.bound,
        operation_id: constructionOperationId(sid, `replace_draft:${g.graph_identity_hash}:${candidateHash}`),
      } }],
      provenance: { authored_by: 'model_proposed', basis: 'A revised draft prepared from the stored brief and the goal the user typed; only its own card replaces the draft.' },
      validation: { admitted: true, loss_count: 0, refusals: [] },
      public_label: card,
    });
    proposals.put(proposal);
    return { proposal, held, event: event?.deliverable ?? null, ...(limits.withheld === undefined ? {} : { withheld: limits.withheld }) };
  };

  /** This target (or deadline goal) call's answer from the turn's one revised draft: the same card, or why it is not in it. */
  const offerRevisedDraft = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0], g: GraphRead, goal: GraphRead['nodes'][number],
    target: { measures: string; value: number; unit: string; comparator: string } | { deliverable: string },
  ): Promise<ToolResult> => {
    const deliverable = 'deliverable' in target ? target.deliverable : undefined;
    const key = `${ctx.scenario_id}\u0000${g.graph_identity_hash}\u0000${ctx.turn_id ?? ''}\u0000${deliverable ?? ''}`;
    let pending = revisedDrafts.get(key);
    if (pending === undefined) {
      pending = prepareRevisedDraft(ctx, g, goal, deliverable);
      revisedDrafts.set(key, pending);
    }
    let draft = await pending;
    if ('refused' in draft) {
      return draft.found === undefined ? draft.refused : { ...draft.refused, detail: draftGateDetail(draft.found, 'offered', ['deliverable' in target
        ? { words: `\u2018${target.deliverable}\u2019 by its deadline`, onCanvas: false }
        : { words: `\u2018${target.measures}\u2019 ${TARGET_COMPARATOR_WORDS[target.comparator] ?? target.comparator} ${targetFigure(target.value, target.unit)}`,
          onCanvas: resolveNamed(g, target.measures, () => true).kind !== 'none' }]) };
    }
    // (c) No card unless the revised draft holds THIS deliverable by its deadline (identity, `prepareRevisedDraft`).
    if ('deliverable' in target && draft.event === null) {
      return { ok: false, mutated: false, refusal: 'revised_draft_has_no_target', detail: noDeliverableDetail(target.deliverable) };
    }
    const offered = 'Nothing has changed yet. Offer this revised-draft card and briefly explain that it replaces the early draft. The card shows its '
      + 'targets, limits, options and what is redrafted; never show its id. Explain the returned proposal or revised draft in your own words. Keep its actual quantities, units, timing, source and scope, including what it would replace or leave out. The existing card contains the complete change for approval; your explanation must not change the proposal, imply approval, or claim that it has already been saved. '
      + 'Only the user pressing that card replaces the draft: never call authorise_change for it yourself.'
      // ⛔ SAID ONCE (SCIENCE's marketing capture, judge row 2, 14 Oct): the card states the withheld result for a carried
      // limit, and the reply restated the same cause in its own words. The card owns it; the reply points to it.
      // Only when that reason is on the complete current card (a reissued card keeps its words); the card itself, with the
      // reason, reaches this turn's AI as `public_label`, so the facts stay in its working input (AIE #94 6178720067).
      + (draft.withheld !== undefined && draft.proposal.public_label.includes(draft.withheld) ? ` ${CARD_OWNS_WITHHELD_NOTE}` : '');
    /**
     * ⭐ A WITHDRAWN CARD IS RE-ISSUED FRESH, NEVER RETURNED DEAD (served marketing turn 02 on 00a51f7d; Codex
     * CHECK-3020-45e7c1e3 item 1; DL r2): the turn's one draft is reused, so a target call after `withdraw_proposal` returned
     * the withdrawn id as offered, and the reply described a card the user never saw. Refusing it (r1) left NO card after
     * propose → withdraw → propose → withdraw → propose. So the next call issues the SAME prepared card under a FRESH id, bound
     * to the current revision; the withdrawn id stays consumed by its own `withdraw_proposal` call, so ONE live card ends the
     * turn. Only a recorded withdrawal re-issues: a card merely gone from the store (evicted) is offered again under its id.
     */
    if (withdrawnProposals.has(draft.proposal.proposal_id)) {
      const { proposal_id: _withdrawn, ...content } = draft.proposal;
      const reissues = (reissuedDrafts.get(key) ?? 0) + 1;
      reissuedDrafts.set(key, reissues);
      draft = { proposal: createProposal({ ...content, base_graph_identity_hash: g.graph_hash,
        provenance: { ...content.provenance, basis: `${content.provenance.basis ?? ''} Offered again after a withdrawal this turn (${reissues}).` } }),
        held: draft.held, event: draft.event, ...(draft.withheld === undefined ? {} : { withheld: draft.withheld }) };
      revisedDrafts.set(key, Promise.resolve(draft));
    }
    if (proposals.get(draft.proposal.proposal_id) === undefined) proposals.put(draft.proposal);
    if ('deliverable' in target) {
      return {
        ok: true, mutated: false,
        proposal_id: draft.proposal.proposal_id,
        public_label: draft.proposal.public_label,
        base_revision: g.graph_hash,
        revised_draft: { replaces_goal: goal.label, holds_deadline_goal: true },
        note: offered,
      };
    }
    /**
     * Bound to the quantity the call names (AIE 0452 AMEND 2): the same figure on another quantity is never "held". Held only
     * by the exact label. A card target that carries this figure, comparator and unit under another label is UNKNOWN, never
     * "not in the draft" (served marketing turn 02 on 00a51f7d: "new customers" read NOT on ‘New customers in first 3 months’,
     * so the AI withdrew the card and nothing reached Paul). NOT held only when no card target carries the figure at all.
     */
    const sameFigure = draft.held.filter((t) => t.value === target.value && t.comparator === target.comparator
      && unitsConflict(target.unit, t.unit) === null);
    const holds: boolean | 'unknown' = sameFigure.some((t) => t.quantity === canonicalLabel(target.measures)) ? true
      : sameFigure.length > 0 ? 'unknown' : false;
    return {
      ok: true, mutated: false,
      proposal_id: draft.proposal.proposal_id,
      public_label: draft.proposal.public_label,
      base_revision: g.graph_hash,
      revised_draft: { replaces_goal: goal.label, holds_this_target: holds },
      note: offered
        // The AIE's exact texts (packet 281e8b3d, #94 6162120876): the 'unknown' note, and the residual for a figure no card
        // target carries (no value/comparator/unit miss is proof the target is absent from the complete model).
        + (holds === true ? '' : holds === 'unknown'
          ? ' The requested target could not be verified against the card\u2019s complete meaning. Do not say it is included or excluded. If this reply actually offers the current card, explain the uncertainty and ask the user to check the goal, target, reference, period and conditions before approving.'
          : ` The host did not find a matching target entry for ${targetFigure(target.value, target.unit)} in this card. Do not claim that the requested target is absent from the complete model unless its full meaning was checked. Explain the limitation and what the current card actually contains.`),
    };
  };

  /**
   * Apply the pressed revised-draft card: the same three gates again, then the candidate's exact bytes through
   * `/graph/register` with compare-and-set on the identity it was prepared against, under an operation id of that base
   * and those bytes (a retry replays; a conflict writes nothing). Confirmed from state, never from the write's return.
   */
  const applyReplaceDraft = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0], parent: StructuredProposal, before: GraphRead,
  ): Promise<ToolResult> => {
    const pid = parent.proposal_id;
    const v = (parent.operations[0]!.value ?? {}) as { candidate?: unknown; base_identity?: unknown; brief_text?: unknown;
      goal_turn_id?: unknown; operation_id?: unknown; bound_turn_ids?: unknown };
    const notApplied = (refusal: string, detail: string): ToolResult => ({ ok: false, mutated: false, applied: false, proposal_id: pid, refusal, detail });
    if (ctx.typed_approval_of !== pid || v.candidate === null || typeof v.candidate !== 'object' || typeof v.base_identity !== 'string'
      || typeof v.goal_turn_id !== 'string' || typeof v.operation_id !== 'string' || v.brief_text !== before.brief_text) {
      return notApplied('not_applied', 'This revised draft is replaced only by pressing its own card, so nothing was changed.');
    }
    if (before.graph_identity_hash !== v.base_identity) {
      return notApplied('superseded', 'The model changed after this revised draft was offered, so nothing was replaced. Offer it again only if it still applies.');
    }
    // The messages the offer bound (read as its context), then the typed goal's turn; any other message refuses.
    const bound = Array.isArray(v.bound_turn_ids) ? v.bound_turn_ids.filter((t): t is string => typeof t === 'string') : [];
    const { found } = await unreviewedDraftGate(ctx, before, [...bound, v.goal_turn_id]);
    if (found.length > 0) {
      const label = (id: string): string => String((((v.candidate as { nodes?: unknown }).nodes as Array<Record<string, unknown>> | undefined) ?? [])
        .find((n) => n?.id === id)?.label ?? id);
      return notApplied(DRAFT_GATE_REFUSAL, draftGateDetail(found, 'replaced', targetsHeldBy(v.candidate).map((t) => ({
        words: targetsInWords(v.candidate, [t]), onCanvas: resolveNamed(before, label(t.node_id), () => true).kind !== 'none' }))));
    }
    // The WHOLE approved graph (every top-level member the candidate carries: options, goal_constraints and all), CAS-gated
    // on both of the base's hashes, like the sibling registers (`frame-write-is-cas-gated.test.ts`).
    const reg = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
      graph: { ...(v.candidate as Record<string, unknown>) },
      expected_graph_hash: before.graph_hash,
      expected_graph_identity_hash: v.base_identity,
      operation_id: v.operation_id,
    });
    /**
     * ⛔ A DEFINITE REFUSAL WROTE NOTHING (DL 14 Oct, Codex 3023 r2: a 409 with zero writes was receipted `mutated:true`). Every
     * 409 the register route returns is refused before any write (`assist.v1.scenario-graph-register.ts`: GRAPH_STALE,
     * OPERATION_ID_REUSED, SHARE_BY_DATE_SERVER_OWNED …, each "nothing written"), so it is said as not replaced, exactly as
     * the hiring-times apply above says its STALE. Only an AMBIGUOUS failure reads the model back (AIE 6122431786 §4).
     */
    if (reg.status === 409) {
      const code = String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
      return /STALE/.test(code)
        ? notApplied('superseded', 'The model changed just before the revised draft was written, so nothing was replaced. Offer it again only if it still applies.')
        : notApplied('not_applied', 'The revised draft was refused before anything was written, so nothing was replaced and the model is unchanged.');
    }
    /**
     * ⛔ CONFIRMED FROM STATE, THE WHOLE GRAPH (AIE 0452 AMEND 3): the read-back's canonical identity must be the identity the
     * registration acknowledged for the bytes it stored from this exact candidate (`graph_identity_hash`, "the server has the
     * graph, and this token names it"). Any other postimage (another writer's change to a link, a value, an option) is
     * UNCONFIRMED: no replacement receipt. Then the targets and every limit the draft held, by quantity.
     */
    const acknowledged = identityHashOf(reg.json.graph_identity_hash);
    const after = await readGraph(ctx.scenario_id);
    const heldTargets = targetsHeldBy(after?.raw);
    // …and the acknowledged graph IS the approved candidate, whole (AIE B34): every component it carries held unchanged.
    const landed = after !== null && acknowledged !== '' && after.graph_identity_hash === acknowledged
      && approvedGraphHeld(v.candidate, after.raw)
      && targetsHeldBy(v.candidate).every((t) => heldTargets.some((h) => h.node_id === t.node_id && h.comparator === t.comparator && h.value === t.value && h.unit === t.unit));
    if (!landed) {
      return { ok: false, mutated: true, applied: false, proposal_id: pid, refusal: 'not_confirmed',
        detail: 'The revised draft was sent, but what the model now holds could not be confirmed. Tell the user plainly that it could not be confirmed, '
          + 'offer to check the model again, and never say it was replaced or that it was not.' };
    }
    // The receipt as the construction's and the goal level's registrations read it (guests get none: no versions).
    const mv = reg.json.model_version as { version_number?: unknown; version_id?: unknown; mutation_id?: unknown } | undefined;
    const receipts: ReceiptSummary[] = mv !== undefined && mv !== null && typeof mv.version_id === 'string'
      ? [{ version: Number(mv.version_number), version_id: mv.version_id, mutation_id: typeof mv.mutation_id === 'string' ? mv.mutation_id : '',
        source_turn_id: registrationTurnId(ctx.scenario_id, v.operation_id) }]
      : [];
    proposals.markApplied(pid, receipts);
    // A deadline goal is analysed only once its date and the team's time are held: the model's own next step, not a Run. A
    // deadline the user already typed goes on its own card, never asked for again.
    const eventPart = draftedTeamPartOf(after.raw);
    const eventAsk = eventModelAsk(after.raw);
    // The AIE's committed fact (packet B), only here: after the writer and the matching whole-postimage read-back above.
    const committed = 'The approved revised draft was committed and matches the readback. The earlier analysis belongs to the earlier draft.';
    return { ok: true, mutated: true, applied: true, proposal_id: pid, receipts,
      follow_up: eventPart === null || eventAsk === null
        ? 'Your model is now the revised draft, with the targets and limits shown on the card you approved.'
        : `${committed} No resolved deadline date is held for this deliverable. Where the user's deadline wording is retained, call `
          + `propose_goal_deadline with those exact words; only when that wording is genuinely absent, ask: ${eventAsk} Do not run the analysis.` };
  };

  /** Consume the exact held card through the approved batch, then read back through the door's verdict on its committed bytes. */
  const applyGoalSteady = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0], parent: StructuredProposal, before: GraphRead,
  ): Promise<ToolResult> => {
    const op = parent.operations[0]!;
    const months = (op.value as { months?: unknown } | undefined)?.months;
    if (ctx.typed_approval_of !== parent.proposal_id || typeof months !== 'number' || !Number.isInteger(months)
      || months <= 0 || heldGoalHorizonMonths(before.nodes.find(n => n.id === op.path && n.kind === 'goal')) !== months
      || opts.commitOptionLevels === undefined) {
      return { ok: false, mutated: false, applied: false, proposal_id: parent.proposal_id, refusal: 'not_applied' };
    }
    const res = await opts.commitOptionLevels({ scenario_id: ctx.scenario_id, base_graph_hash: before.graph_hash,
      turn_id: authorisationTurnId(parent.proposal_id), links: [], levels: [], goal_steady: { goal_id: op.path, months } });
    if (res.status === 'stale' || res.status === 'refused') {
      return { ok: false, mutated: false, applied: false, proposal_id: parent.proposal_id, refusal: res.status };
    }
    if (res.status === 'unconfirmed') {
      return { ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id, refusal: 'not_confirmed',
        detail: 'Your answer was sent but could not be confirmed in the saved model.' };
    }
    // The read strips the basis proof (S5 2b), so the attestation is read back from the door's own committed bytes.
    const check = await readGraph(ctx.scenario_id);
    if (check === null || res.goal_steady_attested !== true
      || heldGoalHorizonMonths(check.nodes.find(n => n.id === op.path && n.kind === 'goal')) !== months) {
      return { ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id, refusal: 'not_confirmed',
        detail: 'Your answer was sent but could not be confirmed in the saved model.' };
    }
    const receipts = res.receipt === null ? [] : [res.receipt];
    proposals.markApplied(parent.proposal_id, receipts);
    return { ok: true, mutated: !res.already_applied, applied: true, proposal_id: parent.proposal_id, receipts,
      follow_up: 'Recorded as your judgement.' };
  };

  /**
   * ⭐ G: the approved answer to the goal's open question, through the atomic level door's `goal_reading` member (ONE commit,
   * alone). The writer's gate is the stored reading the card showed; applied only on the door's committed outcome AND a
   * read-back holding that reading without its question, every other member unchanged.
   */
  const applyGoalReading = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0], parent: StructuredProposal, before: GraphRead,
  ): Promise<ToolResult> => {
    const op = parent.operations[0]!;
    const pid = parent.proposal_id;
    const v = (op.value ?? {}) as { expected_basis?: unknown; answer_words?: unknown; expected_goal?: unknown };
    const expected = v.expected_basis;
    const answer = typeof v.answer_words === 'string' ? v.answer_words : undefined;
    if (!isPlainRecord(expected) || !isPlainRecord(v.expected_goal) || opts.commitOptionLevels === undefined) {
      return { ok: false, mutated: false, applied: false, proposal_id: pid, refusal: 'not_applied' };
    }
    const approved = { goal_id: op.path, expected_basis: expected, ...(answer !== undefined ? { answer_words: answer } : {}),
      expected_goal: v.expected_goal };
    const res = await opts.commitOptionLevels({ scenario_id: ctx.scenario_id, base_graph_hash: before.graph_hash,
      turn_id: authorisationTurnId(pid), links: [], levels: [], goal_reading: approved });
    // A write that LANDED keeps this proposal's expected bytes, so a retry recovers through the writer's verified no-op instead
    // of reading its own landed write as another writer's change. Only a landed one: committed, or an unconfirmed commit whose
    // re-read holds exactly that postimage. An unconfirmed write that did not land leaves the base as it was, so a plain retry
    // goes through again (Codex buddy r2).
    if (res.status === 'committed' || res.status === 'unconfirmed') {
      const written = applyGoalReadingEdit(before.raw, approved);
      const postimage = written.kind === 'mutated' ? written.mutatedGraph : written.kind === 'unchanged' ? before.raw : undefined;
      const landed = postimage !== undefined && (res.status === 'committed'
        || isDeepStrictEqual((await readGraph(ctx.scenario_id).catch(() => null))?.raw, postimage));
      if (landed) proposals.markPartial(pid, { revision: computeAnalysisAffectingGraphHash(postimage as never)!,
        landed: [op.path], receipts: [], expected_postimage: postimage });
    }
    if (res.status === 'stale' || res.status === 'refused') {
      return { ok: false, mutated: false, applied: false, proposal_id: pid, refusal: res.status, ...(res.status === 'refused' ? { reason: res.reason } : {}) };
    }
    const notConfirmed: ToolResult = { ok: false, mutated: true, applied: false, proposal_id: pid, refusal: 'not_confirmed',
      detail: 'Your answer was sent but could not be confirmed in the saved model.' };
    if (res.status === 'unconfirmed') return notConfirmed;
    const check = await readGraph(ctx.scenario_id);
    const goal = check?.nodes.find((n) => n.id === op.path && n.kind === 'goal') as Record<string, unknown> | undefined;
    const basis = goalTargetBasisOf(goal);
    // The receipt says the card's reading, so the read-back holds the card's WHOLE projection (label, target, horizon, period
    // and reading): any member moved after the commit is never "confirmed" under the new words (Codex check r2 on #2995).
    const projection = check === null ? undefined : goalReadingProjectionOf(check.raw, op.path);
    if (check === null || goal === undefined || basis === undefined || basis.open_question !== undefined
      || !isDeepStrictEqual(goal.goal_target_basis, answeredBasisOf(expected))
      || !isDeepStrictEqual(projection, v.expected_goal)) return notConfirmed;
    const receipts = res.receipt === null ? [] : [res.receipt];
    proposals.markApplied(pid, receipts);
    const reading = goalReadingWords(projection) ?? `the target for ‘${String(goal.label)}’ as the model states it`;
    return { ok: true, mutated: !res.already_applied, applied: true, proposal_id: pid, receipts,
      follow_up: goalReadingRecordedWords(reading, answer) };
  };

  /**
   * ⭐ HIRING PATH (a) (DL 14 Oct): Olumi's occurrence range for an unvalued risk ROOT, as its own card (`risk-occurrence.ts`).
   * The card is the proposal's whole content: Olumi's range over the goal's period, its basis, and the node as stored (the
   * writer's stale gate). Card-only; nothing is written here.
   */
  const proposeRiskOccurrence = async (ctx: AgentToolContext, g: GraphRead,
    risk: { id: string; label: string; node: Record<string, unknown>; block: EventRiskV1T; basis: string; goal_id: string;
      goal: Record<string, unknown> }): Promise<ToolResult> => {
    const operations: ProposalOperation[] = [{ op: SET_RISK_OCCURRENCE_OP, path: risk.id,
      value: { event_risk: risk.block, expected_node: structuredClone(risk.node), goal_id: risk.goal_id, expected_goal: structuredClone(risk.goal) } }];
    const proposal = createProposal({
      scenario_id: ctx.scenario_id,
      user_id: ctx.authenticated_user_id,
      base_graph_identity_hash: g.graph_hash,
      operations,
      provenance: { authored_by: 'model_proposed', basis: 'a starting assumption for a risk, offered for the user to adopt or correct' },
      validation: { admitted: true, loss_count: 0, refusals: [] },
      // AIE 6141593167: the complete basis belongs on the bound card, beside its figure.
      public_label: `${riskOccurrenceCardWords(risk.label, risk.block)}\nWhy Olumi suggests this (not checked against a source unless one is shown): \u201c${risk.basis}\u201d`,
    });
    proposals.put(proposal);
    const preview = await readinessIfApplied(ctx, operations);
    return {
      ok: true, mutated: false,
      proposal_id: proposal.proposal_id,
      public_label: proposal.public_label,
      base_revision: g.graph_hash,
      risk_assumption: { risk: risk.label, chance_low_percent: Number((risk.block.occurrence.p_low * 100).toFixed(6)),
        chance_high_percent: Number((risk.block.occurrence.p_high * 100).toFixed(6)), within_months: risk.block.horizon.months,
        basis: risk.basis, olumis_estimate: true },
      note: RISK_OCCURRENCE_PROPOSED_NOTE + stillBlockedNote(preview),
    };
  };

  /**
   * The press on that card: ONE commit through the atomic level door's `risk_occurrence` member, alone, then a read-back
   * holding exactly the card's node with its block. Receipt only on that; the range stays Olumi's (`basis: 'olumi'`).
   */
  const applyRiskOccurrence = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0], parent: StructuredProposal, before: GraphRead,
  ): Promise<ToolResult> => {
    const op = parent.operations[0]!;
    const pid = parent.proposal_id;
    const v = (op.value ?? {}) as { event_risk?: unknown; expected_node?: unknown; goal_id?: unknown; expected_goal?: unknown; holds_now?: unknown;
      stated_occurrence?: unknown; recorded_at?: unknown };
    if (!isPlainRecord(v.event_risk) || !isPlainRecord(v.expected_node) || typeof v.goal_id !== 'string' || !isPlainRecord(v.expected_goal)
      || opts.commitOptionLevels === undefined) {
      return { ok: false, mutated: false, applied: false, proposal_id: pid, refusal: 'not_applied' };
    }
    // A retry continues only from THIS proposal's own landed write (its partial progress, or its own commit in the ledger).
    const ownCommitInLedger = async (): Promise<boolean> => opts.readCommittedTurnLedger !== undefined
      && await opts.readCommittedTurnLedger(ctx.scenario_id).then((l) => l.write_turn_ids.includes(authorisationTurnId(pid)), () => false);
    const ownWriteLanded = proposals.partialProgressOf(pid) !== undefined || await ownCommitInLedger();
    const approved: ApprovedRiskOccurrence = { risk_id: op.path, event_risk: v.event_risk as EventRiskV1T, expected_node: v.expected_node,
      goal_id: v.goal_id, expected_goal: v.expected_goal, own_write_landed: ownWriteLanded,
      ...(userStatementOf(v.holds_now) !== undefined ? { holds_now: userStatementOf(v.holds_now)! } : {}),
      ...(userStatementOf(v.stated_occurrence) !== undefined ? { stated_occurrence: userStatementOf(v.stated_occurrence)! } : {}),
      ...(typeof v.recorded_at === 'string' ? { recorded_at: v.recorded_at } : {}) };
    // The card's goal as bound (its dates, period and reading), by the rule the writer and the read-back also read: a goal
    // that moved since the card was made writes nothing, whatever the analysis hash says (Codex r1 on #3013).
    if (!riskOccurrenceGoalHolds(approved, before.raw)) {
      return { ok: false, mutated: false, applied: false, proposal_id: pid, refusal: 'not_applied', reason: 'model_changed_since_approval',
        detail: 'The model changed after this was approved, so nothing was written. Read it again and propose afresh.', receipts: [] };
    }
    const res = await opts.commitOptionLevels({ scenario_id: ctx.scenario_id, base_graph_hash: before.graph_hash,
      turn_id: authorisationTurnId(pid), links: [], levels: [], risk_occurrence: approved });
    // A write that LANDED keeps this proposal's expected bytes, so a retry recovers through the writer's verified no-op. Landed
    // means THIS proposal's own write: committed by the door, or an unconfirmed commit whose own turn the ledger holds. An equal
    // re-read is never that identity: nothing written beside another writer's equal block reads the same (buddy on #3013 r3).
    if (res.status === 'committed' || res.status === 'unconfirmed') {
      const written = applyRiskOccurrenceEdit(before.raw, approved);
      const postimage = written.kind === 'mutated' ? written.mutatedGraph : written.kind === 'unchanged' ? before.raw : undefined;
      const landed = postimage !== undefined && (res.status === 'committed' || await ownCommitInLedger());
      if (landed) proposals.markPartial(pid, { revision: computeAnalysisAffectingGraphHash(postimage as never)!,
        landed: [op.path], receipts: [], expected_postimage: postimage });
    }
    if (res.status === 'stale' || res.status === 'refused') {
      return { ok: false, mutated: false, applied: false, proposal_id: pid, refusal: res.status, ...(res.status === 'refused' ? { reason: res.reason } : {}) };
    }
    // Not confirmed: no receipt, and no readiness from the stored graph (`may_run` follows only a verified read-back).
    const notConfirmed: ToolResult = { ok: false, mutated: true, applied: false, proposal_id: pid, refusal: 'not_confirmed',
      detail: RISK_OCCURRENCE_UNKNOWN_SAVE, readiness_after: readinessViewOf(undefined) };
    if (res.status === 'unconfirmed') return notConfirmed;
    // The read-back verifies the WHOLE bound postimage: the risk holds exactly the card's range, and the goal its window is
    // stated over is still exactly as bound (Codex r1: a concurrent 3 → 6 month change still said the 3-month receipt).
    const check = await readGraph(ctx.scenario_id);
    const held = (check?.raw as { nodes?: unknown[] } | undefined)?.nodes?.find((n) => isPlainRecord(n) && n.id === op.path);
    if (check === null || !isDeepStrictEqual(held, riskOccurrencePostimageNode(approved))
      || !riskOccurrenceGoalHolds(approved, check.raw)) return notConfirmed;
    const receipts = res.receipt === null ? [] : [res.receipt];
    proposals.markApplied(pid, receipts);
    // The user's own statement's receipt is its door row's (`applyStatement`); this one is Olumi's range's.
    return { ok: true, mutated: !res.already_applied, applied: true, proposal_id: pid, receipts,
      ...(approved.holds_now === undefined && approved.stated_occurrence === undefined
        ? { follow_up: riskOccurrenceRecordedWords(String(approved.expected_node.label), approved.event_risk) } : {}) };
  };

  /**
   * ⭐ SYSTEM 1: the press on a door card. Its write is its row's carrier, the EXISTING level door member, so the press is that
   * member's own (`asMemberOp`): ONE commit, its read-back by identity, its retry recovery. The receipt is the row's words, said
   * only after that member's verified read-back.
   */
  const applyStatement = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0], parent: StructuredProposal, before: GraphRead,
  ): Promise<ToolResult> => {
    const card = doorCardOf(parent.operations[0]!);
    const memberOp = asMemberOp(parent.operations[0]!);
    const row = card === undefined ? undefined : doorRowOf(card);
    if (card === undefined || memberOp === undefined || row === undefined) {
      return { ok: false, mutated: false, applied: false, proposal_id: parent.proposal_id, refusal: 'not_applied' };
    }
    const asMember = { ...parent, operations: [memberOp] };
    // M5: an option's new share of time is the option-capacity member's own registered revision (its read-back, its retry replay).
    const res = memberOp.op === SET_RISK_OCCURRENCE_OP ? await applyRiskOccurrence(ctx, asMember, before)
      : memberOp.op === SET_COHORT_FORECAST_OP ? await applyCohortForecast(ctx, asMember, before)
      : memberOp.op === SET_STATEMENT_RECORD_OP ? await applyStatementRecord(ctx, asMember, before)
      : memberOp.op === SET_OPTION_CAPACITY_CHANGE ? await applyOptionCapacityChange(ctx, asMember, before)
      : { ok: false, mutated: false, applied: false, proposal_id: parent.proposal_id, refusal: 'not_applied' } satisfies ToolResult;
    if (res.ok !== true) return res;
    const after = await readGraph(ctx.scenario_id);
    return { ...res, follow_up: row.recordedWords(card.statements, card.subject, card.label, after?.raw ?? before.raw) };
  };

  /**
   * ⭐ SCIENCE PR-4b: the press on the user's cohort forecast card. ONE commit through the atomic level door's `cohort_forecast`
   * member, alone, then a read-back holding exactly the card's option with its forecast and the two targets as the card read
   * them. Receipt only on that; the figures stay the user's (`author: 'user'`), as their verified words state them.
   */
  const applyCohortForecast = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0], parent: StructuredProposal, before: GraphRead,
  ): Promise<ToolResult> => {
    const op = parent.operations[0]!;
    const pid = parent.proposal_id;
    const card = approvedCohortForecastOf(op);
    if (card === undefined || opts.commitOptionLevels === undefined) {
      return { ok: false, mutated: false, applied: false, proposal_id: pid, refusal: 'not_applied' };
    }
    const ownCommitInLedger = async (): Promise<boolean> => opts.readCommittedTurnLedger !== undefined
      && await opts.readCommittedTurnLedger(ctx.scenario_id).then((l) => l.write_turn_ids.includes(authorisationTurnId(pid)), () => false);
    const approved: ApprovedCohortForecast = { ...card,
      own_write_landed: proposals.partialProgressOf(pid) !== undefined || await ownCommitInLedger() };
    const res = await opts.commitOptionLevels({ scenario_id: ctx.scenario_id, base_graph_hash: before.graph_hash,
      turn_id: authorisationTurnId(pid), links: [], levels: [], cohort_forecast: approved });
    if (res.status === 'committed' || res.status === 'unconfirmed') {
      const written = applyCohortForecastEdit(before.raw, approved);
      const postimage = written.kind === 'mutated' ? written.mutatedGraph : written.kind === 'unchanged' ? before.raw : undefined;
      const landed = postimage !== undefined && (res.status === 'committed' || await ownCommitInLedger());
      if (landed) proposals.markPartial(pid, { revision: computeAnalysisAffectingGraphHash(postimage as never)!,
        landed: [op.path], receipts: [], expected_postimage: postimage });
    }
    if (res.status === 'stale' || res.status === 'refused') {
      return { ok: false, mutated: false, applied: false, proposal_id: pid, refusal: res.status, ...(res.status === 'refused' ? { reason: res.reason } : {}) };
    }
    const notConfirmed: ToolResult = { ok: false, mutated: true, applied: false, proposal_id: pid, refusal: 'not_confirmed',
      detail: RISK_OCCURRENCE_UNKNOWN_SAVE, readiness_after: readinessViewOf(undefined) };
    if (res.status === 'unconfirmed') return notConfirmed;
    const check = await readGraph(ctx.scenario_id);
    const held = (check?.raw as { nodes?: unknown[] } | undefined)?.nodes?.find((n) => isPlainRecord(n) && n.id === op.path);
    // The option exactly as the writer leaves it: the card's forecast, and the door's record of the words when the press carries one.
    const written = applyCohortForecastEdit(before.raw, { ...approved, own_write_landed: false });
    const expectedHeld = written.kind === 'mutated' ? (written.mutatedGraph.nodes as unknown[]).find((n) => isPlainRecord(n) && n.id === op.path)
      : { ...approved.expected_node, cohort_forecast: approved.cohort_forecast };
    if (check === null || !isDeepStrictEqual(held, expectedHeld)
      || !isDeepStrictEqual(storedTargetRowsOf(check.raw), approved.expected_targets)) return notConfirmed;
    const receipts = res.receipt === null ? [] : [res.receipt];
    proposals.markApplied(pid, receipts);
    const label = typeof approved.expected_node.label === 'string' ? approved.expected_node.label : op.path;
    return { ok: true, mutated: !res.already_applied, applied: true, proposal_id: pid, receipts,
      follow_up: cohortForecastRecordedWords(label, approved.cohort_forecast) };
  };

  /**
   * ⭐ M4-cohort (T8): the press on the goal's same-people card. ONE commit through the level door's `statement_record` member, alone,
   * then a read-back holding exactly the user's words on the goal (`user_statements`). The receipt is the door row's.
   */
  const applyStatementRecord = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0], parent: StructuredProposal, before: GraphRead,
  ): Promise<ToolResult> => {
    const op = parent.operations[0]!;
    const pid = parent.proposal_id;
    const approved = approvedStatementRecordOf(op);
    if (approved === undefined || opts.commitOptionLevels === undefined) {
      return { ok: false, mutated: false, applied: false, proposal_id: pid, refusal: 'not_applied' };
    }
    const res = await opts.commitOptionLevels({ scenario_id: ctx.scenario_id, base_graph_hash: before.graph_hash,
      turn_id: authorisationTurnId(pid), links: [], levels: [], statement_record: approved });
    if (res.status === 'stale' || res.status === 'refused') {
      return { ok: false, mutated: false, applied: false, proposal_id: pid, refusal: res.status, ...(res.status === 'refused' ? { reason: res.reason } : {}) };
    }
    const notConfirmed: ToolResult = { ok: false, mutated: true, applied: false, proposal_id: pid, refusal: 'not_confirmed',
      detail: RISK_OCCURRENCE_UNKNOWN_SAVE, readiness_after: readinessViewOf(undefined) };
    if (res.status === 'unconfirmed') return notConfirmed;
    const check = await readGraph(ctx.scenario_id);
    if (check === null || applyStatementRecordEdit(check.raw, approved).kind !== 'unchanged') return notConfirmed;
    const receipts = res.receipt === null ? [] : [res.receipt];
    proposals.markApplied(pid, receipts);
    return { ok: true, mutated: !res.already_applied, applied: true, proposal_id: pid, receipts };
  };

  /**
   * ⭐ S-E GOALS: the approved deadline card writes ONLY the goal's `goal_horizon.deadline`, through the atomic level door's
   * `goal_horizon` member (ONE commit, alone). The date is outside the analysis hash, so the stale gate is the date the goal
   * held when the card was made (`expected_deadline`), plus the analysis revision read at approval (no write in between).
   * Applied only on the writer's committed outcome AND a read-back holding exactly that date.
   */
  const applyGoalDeadline = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0],
    parent: StructuredProposal,
    approvedRead: GraphRead,
  ): Promise<ToolResult> => {
    const op = parent.operations[0]!;
    const v = op.value as { deadline?: unknown; expected_deadline?: unknown; words?: unknown };
    const notApplied = (reason: string, detail: string): ToolResult => ({
      ok: false, mutated: false, applied: false, proposal_id: parent.proposal_id, refusal: 'not_applied', reason, detail, receipts: [],
    });
    if (typeof v.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.deadline) || (v.expected_deadline !== null && typeof v.expected_deadline !== 'string')) {
      return notApplied('unreadable_proposal', 'This deadline could not be read from the stored proposal, so nothing was recorded. Offer it again only if it still applies.');
    }
    const goal = approvedRead.nodes.find((n) => n.id === op.path && n.kind === 'goal');
    if (goal === undefined) {
      return notApplied('goal_not_found', 'The goal this deadline was for is no longer in the model, so nothing was recorded. Tell the user plainly.');
    }
    // The date the goal holds NOW must still be the one the card was made against: another write moved it otherwise. A goal
    // that already holds THIS card's date is a retry of a write that landed (Codex buddy r2 on #2742: an "unconfirmed" first
    // approval): it goes on to the writer, whose verified no-op and the read-back below confirm it.
    const heldNow = goalDeadlineFromRecord(approvedRead.raw, op.path) ?? null;
    if (heldNow !== v.expected_deadline && heldNow !== v.deadline) {
      return notApplied('model_changed_since_approval', 'The goal\u2019s deadline changed after this was offered, so nothing was recorded. Read it again; offer the date afresh only if it still applies.');
    }
    // The card's recorded subject (its goal's complete projection) is the press's and the lapse's rule too: any change to the
    // goal since the card was made (a renamed goal, a new target, period or reading) writes nothing. A card made before its
    // subject was recorded keeps the date gate above.
    // A retry is continued only from THIS proposal's own landed write (Codex r1 on #3024): its partial progress, or its own
    // deadline commit in the scenario's ledger (durable across a restart). An equal date set by anyone else is not that.
    const ownWriteLanded = proposals.partialProgressOf(parent.proposal_id) !== undefined || (opts.readCommittedTurnLedger !== undefined
      && await opts.readCommittedTurnLedger(ctx.scenario_id).then((l) => l.write_turn_ids.includes(authorisationTurnId(`${parent.proposal_id}#deadline`)), () => false));
    if (!ownWriteLanded && deadlineSubjectHolds(op, approvedRead.raw) === false) {
      return notApplied('model_changed_since_approval', 'The model changed after this was approved, so nothing was recorded. Read it again; offer the date afresh only if it still applies.');
    }
    if (opts.commitOptionLevels === undefined) {
      return notApplied('deadline_writer_unavailable', 'This deadline could not be recorded here, so nothing was recorded.');
    }
    const date = sayDate(v.deadline);
    const res = await opts.commitOptionLevels({
      scenario_id: ctx.scenario_id,
      base_graph_hash: approvedRead.graph_hash,
      turn_id: authorisationTurnId(`${parent.proposal_id}#deadline`),
      links: [],
      levels: [],
      goal_horizon: { goal_id: op.path, deadline: v.deadline, expected_deadline: v.expected_deadline as string | null,
        reference_date: (op.value as { reference?: string }).reference,
        stated_months: (op.value as { stated_months?: number }).stated_months },
      // The store-reading writer reads the same rule on the base it writes (Codex r1 on #3024).
      ...((op.value as { expected_goal?: unknown }).expected_goal !== undefined
        ? { deadline_card: { expected_goal: (op.value as { expected_goal?: unknown }).expected_goal, own_write_landed: ownWriteLanded } } : {}),
    });
    // Retain the proposal's expected bytes BEFORE attempting a read that may fail after the write landed.
    if ((res.status === 'committed' || res.status === 'unconfirmed') ) {
      const expected = applyGoalHorizonEdit(approvedRead.raw, { goal_id: op.path, deadline: v.deadline,
        expected_deadline: v.expected_deadline as string | null, reference_date: (op.value as { reference?: string }).reference, stated_months: (op.value as { stated_months?: number }).stated_months });
      const postimage = expected.kind === 'mutated' ? expected.mutatedGraph : expected.kind === 'unchanged' ? approvedRead.raw : undefined;
      if (postimage !== undefined) proposals.markPartial(parent.proposal_id, {
        revision: computeAnalysisAffectingGraphHash(postimage as never)!, landed: [op.path], receipts: [], expected_postimage: postimage,
      });
    }
    if (res.status === 'unconfirmed') {
      const reread = await readGraph(ctx.scenario_id);
      if (reread !== null && goalDeadlineFromRecord(reread.raw, op.path) === v.deadline
        && goalHorizonPostimageIsScoped(approvedRead.raw, reread.raw, op.path, (op.value as { reference?: string }).reference ?? null, (op.value as { stated_months?: number }).stated_months)) {
        proposals.markPartial(parent.proposal_id, { revision: reread.graph_hash, landed: [op.path], receipts: [], ...(draftedTeamPartOf(approvedRead.raw) !== null ? { expected_postimage: reread.raw } : {}) });
      }
      return { ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id, refusal: 'not_confirmed', receipts: [],
        detail: 'This deadline was sent, but Olumi could not read the model back to confirm it. Say exactly that; never say it was recorded or not recorded.' };
    }
    if (res.status === 'stale') {
      return notApplied('model_changed_since_approval', 'The model changed after this was approved, so nothing was recorded. Read it again; offer the date afresh only if it still applies.');
    }
    if (res.status === 'refused') {
      const code = String(res.reason ?? 'refused').replace(/^deadline_/, '');
      return notApplied(`deadline_${code}`, code === 'reference_missing' || code === 'horizon_not_modelled'
        ? deadlineRefusalDetail[code]
        : 'The deadline was not recorded, and nothing on the model changed. Tell the user plainly.');
    }
    const receipts: ReceiptSummary[] = res.receipt !== null ? [{ ...res.receipt, source_turn_id: res.receipt.source_turn_id ?? '' }] : [];
    const check = await readGraph(ctx.scenario_id);
    const expected = applyGoalHorizonEdit(approvedRead.raw, { goal_id: op.path, deadline: v.deadline, expected_deadline: v.expected_deadline as string | null,
      reference_date: (op.value as { reference?: string }).reference, stated_months: (op.value as { stated_months?: number }).stated_months });
    const expectedGraph = expected.kind === 'mutated' ? expected.mutatedGraph : expected.kind === 'unchanged' ? approvedRead.raw : null;
    const holds = expectedGraph !== null && check !== null && isDeepStrictEqual(check.raw, expectedGraph);
    if (!holds) {
      return { ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id, refusal: check === null ? 'not_confirmed' : 'not_verified', receipts,
        detail: 'This deadline was sent, but reading the model back did not show it as recorded. Say exactly that; never say it was recorded or not recorded.' };
    }
    proposals.markApplied(parent.proposal_id, receipts);
    return {
      ok: true, mutated: !res.already_applied, applied: true, proposal_id: parent.proposal_id, receipts,
      follow_up: `Your deadline for "${String(check?.nodes.find(n => n.id === op.path)?.label ?? goal.label)}" is now ${date}.`,
    };
  };

  const applyLinkStrengthSet = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0],
    parent: StructuredProposal,
    approvedRead: GraphRead,
  ): Promise<ToolResult> => {
    const notApplied = (reason: string, detail: string, extra: Record<string, unknown> = {}): ToolResult => ({
      ok: false, mutated: false, applied: false, proposal_id: parent.proposal_id, refusal: 'not_applied', reason, detail, receipts: [], ...extra,
    });
    if (approvedRead.graph_hash !== parent.base_graph_identity_hash) {
      return notApplied('model_changed_since_approval', 'The model changed after these links were prepared, so none of them was recorded. Read it again and propose afresh.');
    }
    if (opts.commitOptionLevels === undefined) {
      return notApplied('links_writer_unavailable', 'These links could not be recorded as one change, so none of them was recorded.');
    }
    const labelOf = (id: string): string => approvedRead.nodes.find((n) => n.id === id)?.label ?? id;
    const links = parent.operations.map((o) => {
      const [from, to] = o.path.split('::');
      const v = (o.value ?? {}) as { magnitude?: unknown; intent?: unknown; expected?: { mean?: unknown; effect_direction?: unknown; reviewed_at?: unknown };
        band?: unknown; author?: unknown; sizing_after_approval?: unknown };
      return { from: from ?? '', to: to ?? '', magnitude: v.magnitude, intent: v.intent, expected: v.expected, band: v.band,
        author: v.author, sizingAfterApproval: v.sizing_after_approval };
    });
    const readable = links.every((l) => l.from !== '' && l.to !== '' && typeof l.magnitude === 'number' && (l.intent === 'set' || l.intent === 'confirm_current')
      && isInfluenceBand(l.band) && typeof l.expected?.mean === 'number' && (l.expected.effect_direction === 'positive' || l.expected.effect_direction === 'negative')
      && (l.author === 'user_stated' || l.author === 'model_proposed'));
    if (!readable) return notApplied('unreadable_proposal', 'These links could not be read from the stored proposal, so none of them was recorded. Offer to prepare them again.');
    const sent = links.map((l) => ({
      from: l.from, to: l.to, magnitude: l.magnitude as number, intent: l.intent as 'set' | 'confirm_current',
      expected: { mean: l.expected!.mean as number, effect_direction: l.expected!.effect_direction as 'positive' | 'negative',
        reviewed_at: typeof l.expected!.reviewed_at === 'string' ? l.expected!.reviewed_at : null },
      band: l.band as InfluenceBand, author: l.author === 'user_stated' ? 'user_specified' as const : 'model_proposed' as const,
    }));
    const res = await opts.commitOptionLevels({
      scenario_id: ctx.scenario_id,
      base_graph_hash: parent.base_graph_identity_hash,
      turn_id: authorisationTurnId(`${parent.proposal_id}#links`),
      links: [],
      levels: [],
      link_strengths: sent,
    });
    if (res.status === 'unconfirmed') {
      return { ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id, refusal: 'not_confirmed', receipts: [],
        follow_up: LINK_SET_SAVE_NOT_CONFIRMED,
        detail: 'These links were sent as one change, but Olumi could not read the model back to confirm them. Say exactly that; never say they were recorded or not recorded.' };
    }
    if (res.status === 'stale') {
      return notApplied('model_changed_since_approval', 'The model changed after these links were approved, so none of them was recorded. Read it again and propose afresh.');
    }
    if (res.status === 'refused') {
      const which = res.link !== undefined ? `"${labelOf(res.link.from)}" \u2192 "${labelOf(res.link.to)}"` : 'One of the links';
      const why = res.reason === 'link_definitional_link'
        ? 'is defined by a calculation the model declares, so its strength is not an estimate anyone sets'
        : res.reason === 'link_expected_mismatch' ? 'changed after this was prepared'
          : res.reason === 'link_became_users_own' ? 'became the user\u2019s own strength after this was prepared, so Olumi\u2019s estimate was not written over it'
            : res.reason === 'link_reviewed_since' ? 'was reviewed by the user after this was prepared, so it was not changed'
              : 'could not be recorded';
      return notApplied('link_refused', `${which} ${why}, so none of these links was recorded and the model is exactly as it was. Say so, and offer the set again without it.`,
        { refused_link: which });
    }
    const receipts: ReceiptSummary[] = res.receipt !== null ? [{ ...res.receipt, source_turn_id: res.receipt.source_turn_id ?? '' }] : [];
    const check = await readGraph(ctx.scenario_id);
    const holds = check !== null && sent.every((l, index) => {
      const e = check.edges.find((x) => x.from === l.from && x.to === l.to) as { strength?: unknown; provenance?: unknown } | undefined;
      const mean = e?.strength !== null && typeof e?.strength === 'object' ? (e.strength as { mean?: unknown }).mean : undefined;
      const want = l.expected.effect_direction === 'negative' ? -l.magnitude : l.magnitude;
      const prov = (e?.provenance ?? {}) as { source?: unknown; magnitude?: unknown };
      // Whose, as approved: a band the user named that MOVED the link is theirs; a band they named that it already sat in,
      // and Olumi's band they agreed to, are REVIEW (`reviewed_by_user`, R11) — never the user's stamp on Olumi's figure.
      const usersOwn = linkSizing(e) === 'user';
      const reviewed = (prov as { reviewed_by_user?: { intent?: unknown } }).reviewed_by_user?.intent === 'confirm';
      const stamped = l.author === 'user_specified' && l.intent === 'set' ? usersOwn
        : l.author === 'user_specified' ? reviewed : reviewed && !usersOwn;
      const approvedPlaceholderMove = l.author === 'model_proposed' && l.intent === 'set'
        && links[index]?.sizingAfterApproval === 'placeholder' && linkSizing(e) === 'placeholder';
      return typeof mean === 'number' && Math.abs(mean - want) < 1e-9 && stamped
        // B1: confirm_current records a review of the stored mean, even when nobody has sized it yet.
        // A user set must read back as sized. A model move predicted by the canonical adoption writer to remain a
        // placeholder proves only its changed prior and review; review never earns sizing or authorship by itself.
        && (l.intent === 'confirm_current' || approvedPlaceholderMove || !approvalSizes(e));
    });
    /**
     * ⭐ #3002 card_receipt (AIE packet 2b19ae59): the receipt, the card's left-out links included, is said only once the WHOLE
     * postimage reads back, otherwise the save is unconfirmed, in the AIE's words, and nothing says it was recorded or left
     * unchanged. Whole means all three (buddy r1 on 0bbc66bc: an approved link's spread or source could move unseen):
     *  · every approved link as approved (`holds`);
     *  · the graph the analysis reads is the one the writer committed (`res.graph_hash`): every size and spread, each link's
     *    direction and its source and sizing marks, and every figure that decides a Run;
     *  · everything but the approved links byte-equal to the approved read, so each left-out link (its review stamp and
     *    display included) and everything else are as they were when approved.
     * (Not via the link writer's own scope rule: this module never names the internal option writer, the consent manifest's
     * one-consumer rule.)
     */
    const approvedKeys = new Set(sent.map((l) => `${l.from}::${l.to}`));
    const allButApproved = (raw: unknown): unknown => {
      const g = isPlainRecord(raw) ? raw : {};
      return { ...g, edges: (Array.isArray(g.edges) ? g.edges : []).filter((e) => !(isPlainRecord(e) && approvedKeys.has(`${String(e.from)}::${String(e.to)}`))) };
    };
    const retained = check !== null && check.graph_hash === res.graph_hash
      && isDeepStrictEqual(allButApproved(check.raw), allButApproved(approvedRead.raw));
    if (!holds || !retained) {
      return { ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id, refusal: check === null ? 'not_confirmed' : 'not_verified', receipts,
        follow_up: LINK_SET_SAVE_NOT_CONFIRMED,
        detail: 'These links were sent as one change, but reading the model back did not show all of them as approved, with everything else as it was. Say exactly that; never say they were recorded or not recorded.' };
    }
    proposals.markApplied(parent.proposal_id, receipts);
    /**
     * ⭐ M1 ACCEPT RECEIPT (DL 5942097719; Codex pre-review 2 P1): whose figure each link holds is read off the STORED link
     * after the write (`linkSizing`), never off the card. Every link stored `olumi_accepted` says RC's accept sentence (the
     * one the system-event receipt and the M2 rerun line say); only a link stored as the user's is "your estimate"; any
     * other claims nobody. Labels are quoted: this is shown through `withoutAgentDirections`, where an unquoted
     * "Size of the user base" or `cost_per_hire` would drop the sentence.
     */
    const storedSizing = (l: { from: string; to: string }) => linkSizing(check!.edges.find((x) => x.from === l.from && x.to === l.to));
    const quotedLabel = (id: string): string => quoteLabelForUser(labelOf(id));
    const parts = sent.map((l) => storedSizing(l) === 'placeholder'
      ? `${quotedLabel(l.from)} \u2192 ${quotedLabel(l.to)} ${l.intent === 'confirm_current'
        ? 'reviewed, kept as it is' : 'changed; it isn\u2019t sized in the model yet'}`
      : `${quotedLabel(l.from)} \u2192 ${quotedLabel(l.to)} as ${linkBandWord(l.band)}${storedSizing(l) === 'user' ? ', your estimate' : ''}`);
    const accepted = sent.filter((l) => storedSizing(l) === 'olumi_accepted').map((l) => acceptedOlumiEstimateSentence(quotedLabel(l.from), quotedLabel(l.to)));
    // Olumi's estimates as STORED (Codex pre-review 3 P1): a model-proposed link the sizer never marked (`unmarked`) is no one's.
    const olumisStored = sent.filter((l) => l.author === 'model_proposed' && ['olumi_accepted', 'olumi_estimate'].includes(storedSizing(l))).length;
    const placeholderChangesOnly = sent.every((l) => l.intent === 'set' && storedSizing(l) === 'placeholder');
    /**
     * ⭐ A SET IS COUNTED FROM THE STORED OUTCOME, AND EVERY REVIEW-ONLY LINK SAYS SO (Batch A live (b) FAIL, PL 6115623359;
     * AIE text contract #94 6115788987; A′ check round 1). "Recorded these 6 link strengths" when two of the six were only
     * reviews of links nobody has sized, and "Recorded your review of this link" with no word that it is still unsized.
     * Strengths sized, changes to links still unsized, and reviews are counted apart, each from the link as STORED; each
     * review-only link, in ANY set (one review, all reviews, with changes, with strengths), says it is still unsized with
     * its own values unchanged (never the model's: other links may have been sized), then the next action once.
     */
    const reviewedUnsizedAt = (l: (typeof sent)[number]): boolean => l.intent === 'confirm_current' && storedSizing(l) === 'placeholder';
    const changedUnsized = sent.filter((l) => l.intent === 'set' && storedSizing(l) === 'placeholder').length;
    const reviewedUnsized = sent.filter(reviewedUnsizedAt);
    const counted = reviewedUnsized.length > 0 || (!placeholderChangesOnly && changedUnsized > 0);
    const listed = parts.filter((_, i) => !reviewedUnsizedAt(sent[i]!));
    const countedTail = reviewedUnsized.map((l) => ` ${quotedLabel(l.from)} \u2192 ${quotedLabel(l.to)}: Review recorded; this link is still unsized. Its values are unchanged.`).join('')
      + ' Give a figure, or ask Olumi to estimate it.';
    const accepts = (accepted.length > 0 ? ` ${accepted.join(' ')}` : '')
      + (olumisStored > 0 ? ' Olumi\u2019s estimates stay marked as Olumi\u2019s, not yours: your approval applied them, it did not make them your judgement.' : '');
    // #3002: the links the card left out, said again in the card's own stored words (the host's, by id → label; a restored
    // proposal carries the same card), so the receipt never reads as if the whole set was recorded.
    const omitted = parent.public_label.split(LEFT_OUT_CARD_LEAD).slice(1).map((x) => ` ${LEFT_OUT_CARD_LEAD}${x.trim().replace(/\.$/, '')}.`).join('');
    return {
      ok: true, mutated: true, applied: true, proposal_id: parent.proposal_id, receipts,
      revision_before: parent.base_graph_identity_hash, revision_after: res.graph_hash,
      // What the user reads (typed-approval fast path); the Agent's next step stays in `note`.
      follow_up: counted
        ? `Recorded ${mixedLinkSetHeading(sent.length - changedUnsized - reviewedUnsized.length, changedUnsized, reviewedUnsized.length)}.`
          + `${listed.length > 0 ? ` ${listed.join('; ')}.` : ''}${accepts}${omitted}${countedTail}`
        : `Recorded ${placeholderChangesOnly ? (sent.length === 1 ? 'the change to this link' : `the changes to these ${sent.length} links`)
        : sent.length === 1 ? 'this link strength' : `these ${sent.length} link strengths`}: ${parts.join('; ')}.${accepts}${omitted}`,
      note: 'Recorded as one change. Offer to run the analysis again so they can see what these links change.',
    };
  };
  /**
   * ⛔ A STARTING POINT MUST COVER EVERY FACTOR EACH OPTION ACTS ON.
   *
   * MEASURED on served 63cf4dcf (journey witness, direct transport): the
   * starting point gave "Stage Hiring After Review" ONE level, but the option is
   * wired to three factors; readiness blocks the comparison on every unset
   * (option, linked factor) pair (`missing_value`), so "one approval -> first
   * comparison" needed a second approval. Across six served journeys only two
   * were fully analysable after one approval.
   *
   * Deterministic, from the SAME reader the write and the proposer use
   * (`linkedFactorsOf`): the pairs still lacking a level after this proposal
   * would apply. The values themselves are never invented here — the Agent is
   * told which pairs to propose before it shows the user anything.
   */
  const missingPairs = async (ctx: AgentToolContext, levelPaths: ReadonlySet<string>): Promise<{ option: string; factor: string }[] | null> => {
    const g = await readGraph(ctx.scenario_id);
    if (g === null) return null;
    const held = heldStatusQuoPairs(g);
    const missing: { option: string; factor: string }[] = [];
    for (const o of g.nodes.filter((n) => n.kind === 'option')) {
      const has = (o.interventions ?? {}) as Record<string, unknown>;
      for (const f of linkedFactorsOf(g as never, o.id)) {
        if (has[f.id] !== undefined || levelPaths.has(`${o.id}::${f.id}`)) continue;
        // A held status quo is complete with no level (`heldStatusQuoPairs`).
        if (held.has(`${o.id}::${f.id}`)) continue;
        missing.push({ option: o.label, factor: String(f.label ?? f.id) });
      }
    }
    return missing;
  };
  /**
   * ⭐ WHAT THE ONE VERDICT WOULD SAY IF THIS WERE APPROVED (served ef99a97 / cb1778b: a starting point that filled
   * every level but made two options identical — the user's one approval led straight to "nothing to compare").
   * The stored graph with the proposal's levels (and value presence) applied, read by the SAME `readinessViewOf`.
   * A preview for the Agent's words only; nothing here is written.
   */
  const readinessIfApplied = async (ctx: AgentToolContext, ops: readonly ProposalOperation[]): Promise<ReturnType<typeof readinessViewOf>> => {
    const g = await readGraph(ctx.scenario_id);
    if (g === null) return readinessViewOf(undefined);
    const raw = JSON.parse(JSON.stringify(g.raw)) as { nodes?: { id?: unknown; interventions?: unknown; observed_state?: Record<string, unknown> }[] };
    const byId = new Map((raw.nodes ?? []).map((n) => [String(n.id), n] as const));
    for (const given of ops) {
      const o = given.op === RECORD_STATEMENT_OP ? asMemberOp(given) ?? given : given;
      if (o.op === 'set_option_intervention') {
        const [optionId, factorId] = o.path.split('::') as [string, string];
        const v = (o.value as { normalised?: unknown } | undefined)?.normalised;
        const n = byId.get(optionId);
        if (n !== undefined && typeof v === 'number') n.interventions = { ...((n.interventions ?? {}) as Record<string, unknown>), [factorId]: { value: v } };
      } else if (o.op === SET_RISK_OCCURRENCE_OP) {
        // The risk's occurrence as the card would write it: the verdict reads the level's presence only.
        const n = byId.get(o.path) as Record<string, unknown> | undefined;
        const block = (o.value as { event_risk?: unknown } | undefined)?.event_risk;
        if (n !== undefined && block !== undefined) n.event_risk = block;
      } else if (o.op === 'set_factor_value') {
        const n = byId.get(o.path);
        const v = (o.value as { value?: unknown } | undefined)?.value;
        const cap = n?.observed_state?.cap;
        if (n !== undefined && typeof v === 'number') {
          // Stored against the factor's range when it has one; the verdict reads presence and range, never this figure's meaning.
          const stored = typeof cap === 'number' && cap > 0 ? v / cap : v <= 1 ? v : 1;
          n.observed_state = { ...(n.observed_state ?? {}), value: stored };
        }
      }
    }
    const gaps = parseOptionGapsOfLevelOps(ops);
    if (gaps.kind === 'invalid') return readinessViewOf(undefined);
    if (gaps.declarations.length > 0) {
      const prepared = applyOptionGapDeclarations(raw, gaps.declarations);
      return readinessViewOf(prepared.kind === 'prepared' ? prepared.graph : undefined);
    }
    return readinessViewOf(raw);
  };
  /**
   * What the Agent must say BEFORE the approval when the preview still blocks: the verdict's own words — the
   * user's demands, else the refusal's `reason` (the run path's `blockedNextStep`) — never an example that may not
   * fit this model (#1957 review: a one-option model was told to ask about "identical options").
   */
  const stillBlockedNote = (v: ReturnType<typeof readinessViewOf>): string => {
    if (!v.checked || v.may_run !== false) return '';
    const why = [...v.needs_from_user.map((i) => i.message), ...(v.needs_from_user.length === 0 && v.reason !== undefined ? [withoutCantRunOpening(v.reason)] : [])]
      .map((m) => m.trim().replace(/\.+$/, ''))
      .filter((m) => m !== '');
    return ` Even after this approval the analysis could still not run: ${why.length > 0 ? why.join('. ') : 'the model would still be blocked'}. `
      + 'Say so plainly BEFORE asking for approval, and ask the user for what this cannot settle — never invent a difference or a figure.';
  };
  const levelPathsOf = (ps: readonly StructuredProposal[]): Set<string> =>
    new Set(ps.flatMap((p) => p.operations).filter((o) => o.op === 'set_option_intervention').map((o) => o.path));
  /**
   * ⛔ COMPLETENESS IS AN ADMISSION RULE, NOT A NOTE — independent review of
   * #1719 at d00727aa: reporting the missing pairs AFTER storing an approvable
   * proposal let a model that ignored the note ask the user to approve an
   * incomplete set, and the user still needed a second approval. So an
   * incomplete starting point leaves NOTHING approvable.
   */
  const incompleteStartingPoint = (missing: { option: string; factor: string }[], extra: Record<string, unknown>): ToolResult => ({
    ok: false, mutated: false, refusal: 'incomplete_starting_point',
    options_missing_levels: missing,
    ...extra,
    detail:
      'Nothing is awaiting approval. A starting point must give a level for EVERY factor each option acts on, and the pairs in ' +
      'options_missing_levels have none. Call propose_starting_point again with the same values and levels PLUS a level for each ' +
      'pair (in the factor\u2019s own units, as an assumption to correct), then show the user that one proposal.' +
      (Array.isArray(extra.levels_not_accepted) && extra.levels_not_accepted.length > 0
        ? ' Some levels you DID give were not accepted: levels_not_accepted says which and why. Correct each one as its reason ' +
          'says. Re-sending the same value will be refused again.'
        : ''),
  });

  /**
   * A newer starting point REPLACES the caller's earlier unapproved one, so
   * "if exactly one is awaiting approval, authorise THAT" always names the
   * latest set the user was shown. Only starting points are replaced; an
   * ordinary single proposal is never discarded here.
   */
  const replaceEarlierStartingPoints = (ctx: AgentToolContext): void => {
    for (const o of proposals.outstanding(ctx.scenario_id, ctx.authenticated_user_id)) {
      const p = proposals.get(o.proposal_id);
      if (p !== undefined && p.provenance.basis === STARTING_POINT_BASIS) proposals.discard(o.proposal_id);
    }
  };

  /** How many date or duration phrases one message holds: every word start, read by the one reader over the words after
   * it (`readStatedDeadline`, lead words only, as `eventDateSpans` does); overlapping readings are one phrase. ⛔ DLf5 r2
   * (Codex on 3e43cebc: "thirteen weeks" was missed): FAIL SAFE, any time-unit word or month name the reader's spans do
   * not cover ("thirteen weeks", "a fortnight", "in 180 days", "this year") is a phrase of its own. An "as of D" is not one. */
  const datePhrasesIn = (text: string): number => {
    const plain = text.replace(/(?:^|[^\p{L}\p{N}])as of\s+\d{4}-\d{2}-\d{2}(?=$|[^\p{L}\p{N}])/gu, ' ');
    const spans: (readonly [number, number])[] = [];
    for (const start of plain.matchAll(/\S+/gu)) {
      const tail = plain.slice(start.index);
      for (const word of tail.matchAll(/\S+/gu)) {
        const end = word.index + word[0].length;
        if (end > 80) break;
        if (readStatedDeadline(tail.slice(0, end), '1900-01-01', { leadWordsOnly: true }) !== null) spans.push([start.index, start.index + end]);
      }
    }
    const read = [...spans];
    // "may" is a month only beside a number ("1 May", "May 2027"); every other unit word or month name always counts.
    for (const m of plain.matchAll(/(?<![\p{L}\p{N}])(?:days?|weeks?|fortnights?|months?|quarters?|years?|january|february|march|april|june|july|august|september|october|november|december|(?<=\d\s{0,2})may|may(?=\s{0,2}\d))(?![\p{L}\p{N}])/gu)) {
      if (!read.some(([from, to]) => m.index >= from && m.index < to)) spans.push([m.index, m.index + m[0].length]);
    }
    let phrases = 0;
    let reach = -1;
    for (const [from, to] of spans.sort((a, b) => a[0] - b[0])) {
      if (from >= reach) phrases += 1;
      reach = Math.max(reach, to);
    }
    return phrases;
  };

  const proposePlacedDeadline = async (ctx: AgentToolContext, args: { rationale?: unknown; deadline_date?: unknown }, g: GraphRead, words: string, reference: string | undefined,
    dating?: { readonly turnText: string; readonly required?: Weekday }, userWords = true, userReading = true,
    /** The sentence the words were read from, quoted on the card (the route's card, ruling A). */
    readFrom?: string,
    /** The user's own sentence holding the words (this turn or a verified message), quoted on a card their words set. */
    userSentence?: string): Promise<ToolResult> => {
      // Missing R restores the HEAD date-only door; the clock places D but cannot attest H.
      const today = reference ?? todayInLondon((opts.now ?? (() => new Date()))());
      // ⭐ Recovery Batch B: "Last Friday was the 9th of October." — the user's own dating of the phrase's "last <weekday>",
      // accepted only when that date IS that weekday. With no recorded reference day, "last <weekday>" is never counted back.
      const datedWeekday = dating === undefined ? null : readStatedWeekdayDate(dating.turnText, today);
      const named = lastWeekdayNamedIn(words);
      const parsed = dating?.required !== undefined && datedWeekday?.weekday !== dating.required ? null
        : readStatedDeadline(words, today, { ...(datedWeekday !== null ? { lastWeekday: datedWeekday } : {}), relativeWeekdays: reference !== undefined });
      // ⛔ DLf5 (served ffe10d51 deadline journey, 12 refusals): the model's OPTIONAL date is a fallback only. A blank one
      // (`""`, whitespace, null) is absent, and it is checked only when the user's own phrase did not resolve: "in six
      // months time" places 2027-04-13 whatever the model put beside it.
      const modelDate = typeof args.deadline_date === 'string' && args.deadline_date.trim() !== '' ? args.deadline_date : undefined;
      if (parsed === null && modelDate !== undefined && (!isCalendarDate(modelDate) || modelDate <= today)) {
        return { ok: false, mutated: false, refusal: 'unreadable_deadline', detail: 'The proposed deadline must be a valid future ISO calendar date.' };
      }
      // A resolved source owns both its date and stated count; a model date is only an interpretation fallback.
      const stated: StatedDeadline | null = parsed ?? (modelDate === undefined ? null
        : { words, form: 'date' as const, date: modelDate, reference: today });
      // `userReading` false: the user's words, but WHICH of their phrases is the deadline is Olumi's reading (DLf5 Codex check).
      const authoredBy = userWords && userReading && parsed !== null && parsed.date === stated?.date ? 'user_stated' : 'model_proposed';
      if (stated === null) {
        const deadlineAsk = chanceGoalDeadlineAsk(draftedTeamPartOf(g.raw)?.deliverable
          ?? (g.nodes.filter((n) => n.kind === 'goal').length === 1 ? g.nodes.find((n) => n.kind === 'goal')!.label : 'your goal'));
        return { ok: false, mutated: false, refusal: 'deadline_not_placed',
          ...(named !== null ? {} : { deadline_ask: deadlineAsk }),
          detail: named !== null
            ? `Olumi cannot tell which date "last ${named}" in "${words}" is without guessing, so nothing was prepared. `
              + 'Ask which date the user means. Once they explicitly date that weekday, call propose_goal_deadline with the original deadline_words. '
              + 'Never invent or offer a start date.'
            // EBD E3 (Paul, 12 Oct: refused twice, then "Can you not work that out?"; AIE 6122738619, verbatim): re-read what the
            // user said first, then at most the ONE question in `deadline_ask`, never a restatement of a date already held.
            : 'No deadline change was prepared because the quoted words do not resolve to a calendar date against the recorded reference date. '
              + "Re-read the user's deadline words and recorded reference first. If they still do not identify a date, ask the one question in deadline_ask, "
              + 'then call propose_goal_deadline with their answer. Do not ask them to restate a date already resolved and held.' };
      }
      const goals = g.nodes.filter((n) => n.kind === 'goal');
      if (goals.length !== 1) {
        return { ok: false, mutated: false, refusal: 'goal_not_resolved',
          detail: goals.length === 0
            ? 'The model has no goal to set a deadline on, so nothing was prepared. Tell the user plainly.'
            : `The model has more than one goal (${goals.map((x) => `"${x.label}"`).join(', ')}), so nothing was prepared: it is not clear which one this deadline is for. Ask the user which goal they mean.` };
      }
      const goal = goals[0]!;
      const held = goalDeadlineFromRecord(g.raw, goal.id);
      const date = sayDate(stated.date);
      if (held === stated.date) {
        return { ok: false, mutated: false, refusal: 'already_held',
          detail: `The goal "${goal.label}" already holds ${date} as its deadline, so nothing was prepared. Tell the user it is already recorded.` };
      }
      const approved = { goal_id: goal.id, deadline: stated.date, expected_deadline: held ?? null, reference_date: reference,
        ...(reference !== undefined && stated.stated_count?.unit === 'months' ? { stated_months: stated.stated_count.value } : {}) };
      const dry = applyGoalHorizonEdit(g.raw, approved);
      if (dry.kind === 'refused') return { ok: false, mutated: false, refusal: dry.reason,
        detail: deadlineRefusalDetail.horizon_not_modelled };
      const fromToday = reference === undefined ? sayDeadlineFromToday(stated)
        : sayDeadlineFromToday(stated).replace('from today', `from ${sayDate(reference)}`);
      const question = `Is your deadline ${date} (${fromToday})?`;
      const rationale = typeof args.rationale === 'string' ? args.rationale : '';
      // ⛔ ONE TRUE THING (DL 14 Oct; served hiring e2e 8f52bfd5 turn 01: "Is your deadline 14 January 2027 (3 months from
      // 14 October 2026)? … Basis supplied for this interpretation: … No calendar reference date was supplied, so this retains
      // the relative three-month timing rather than converting it to a date."). The AI's rationale is the basis of an
      // INTERPRETATION, so the card shows it only when the card is Olumi's interpretation (`model_proposed`). When the user's
      // own words resolve to this date against the shown reference, the card quotes the user's own sentence instead, verbatim,
      // so its conditions stay in view (A2: "…within ten months, provided the evidence supports it; this is not a firm
      // commitment…"); the rationale stays in provenance.
      const sourceDetail = authoredBy !== 'model_proposed' || rationale.trim() === '' ? '' : ` Basis supplied for this interpretation: ${rationale}`;
      const replaces = held === undefined ? '' : ` This replaces ${sayDate(held)}.`;
      const from = readFrom ?? (authoredBy === 'user_stated' ? userSentence : undefined);
      const quoted = from === undefined || from.trim() === stated.words.trim() ? '' : ` in “${from.trim().replace(/[.!?]+$/, '')}”`;
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations: [{ op: 'set_goal_deadline', path: goal.id,
          value: { deadline: stated.date, expected_deadline: held ?? null, words: stated.words,
            // The card's SUBJECT (DL 14 Oct): the goal's complete projection as it stands now. One rule reads it at press, at
            // lapse and at the writer (`still-applies.ts`), so an unrelated change never lapses the card and any goal change does.
            ...(deadlineCardSubjectOf(g.raw, goal.id) !== undefined ? { expected_goal: deadlineCardSubjectOf(g.raw, goal.id) } : {}),
            ...(reference !== undefined ? { reference } : {}),
            ...(reference !== undefined && stated.stated_count?.unit === 'months' ? { stated_months: stated.stated_count.value } : {}) } }],
        provenance: { authored_by: authoredBy, basis: String(args.rationale ?? '') },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: `${question}${replaces} ${userWords ? "Your words" : "Olumi’s wording"}: “${stated.words}”${quoted}.${authoredBy === 'model_proposed' ? " Olumi’s interpretation; check the date and reference before approving." : ''}${sourceDetail}`,
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        deadline: { goal: goal.label, date, words: stated.words, from_today: fromToday },
        note: `Nothing has changed yet. Show the complete approval card: "${proposal.public_label}" — never the id. `
          + 'Keep its date, reference and source visible, and call authorise_change with this proposal_id once they agree. If they give another date, '
          + 'call propose_goal_deadline again with their new words.',
      };
  };

  const caps: AgentCapabilities = {
    async getCanonicalState(ctx: AgentToolContext, options?: { section: 'run_explanation' }): Promise<ToolResult> {
      const g = await readGraph(ctx.scenario_id, options?.section);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const { delta, rerunRecord } = await runComparisonFacts(ctx.scenario_id, ctx.request_id, g);
      // S8: what the user has said they do not accept, in their words. An unreadable list never fails the turn, but it is
      // UNKNOWN, never "none": the model is told the list could not be read (the `receipt_unreadable` convention).
      let statedObjectionsUnreadable = false;
      const statedObjections = opts.readStatedObjections === undefined ? []
        : await opts.readStatedObjections(ctx.scenario_id, ctx.request_id).catch(() => {
          statedObjectionsUnreadable = true;
          return [] as readonly StatedObjection[];
        });
      const { run_delta: _wireDelta, ...readWithoutDelta } = g;
      const modelRead = { ...readWithoutDelta, ...(delta === undefined ? {} : { run_delta: delta }) };
      const scopeIssues = g.goal_scope_reconciliation ?? [];
      const permissions = claimPermissionsFrom(g.analysis_state, { analysis_admission: g.analysis_admission });
      const optionNames = optionNameAliasesForCurrentRun(g);
      const modelContext = withSavedRunCertainty(projectModelContext(g), ctx.scenario_id, modelRead);
      // Opt-in interpreter section. The default state remains the ordinary Agent's assembly.
      let explanationSection: Record<string, unknown> | undefined;
      if (options?.section === 'run_explanation') {
        const explanationRead = { ...modelRead, analysis_admission: g.analysis_admission ?? g.run_explanation_admission };
        const completed = withSavedRunCertainty(projectModelContext(g), ctx.scenario_id, explanationRead);
        explanationSection = runExplanationContextFacts(ctx.scenario_id, explanationRead,
          completed.analysis as Record<string, unknown> | undefined);
      }
      return {
        ok: true,
        mutated: false,
        ...(explanationSection === undefined ? {} : { run_explanation: explanationSection }),
        ...(permissions.total_goal_claims_allowed === false ? { claim_permissions: permissions } : {}),
        ...(scopeIssues.length > 0 ? { goal_scope_reconciliation: scopeIssues } : {}),
        graph_revision: g.graph_hash,
        ...(g.scenario_revision === undefined ? {} : { scenario_revision: g.scenario_revision }),
        empty: g.nodes.length === 0,
        entities: g.nodes.map((n) => {
          // What each option already sets, as stored (RCA D1): quote these, never your own earlier arguments.
          const levels = projectOptionLevels(n, byIdOf(g));
          const alias = optionNames.get(n.id);
          const entity = { ...projectEntity(n), ...(alias === undefined ? {} : { display_label: alias.display }) };
          return levels.length > 0 ? { ...entity, levels } : entity;
        }),
        // ⛔ No `existing_links`: it was `links[].from -> to` again, 1.4–1.6k chars of every given state (PJ-C1, #70 5859578339).
        // Derived by traversal of the persisted graph — facts, not estimates,
        // and the Agent may state them to the user as facts. Without these it
        // has to infer topology from an edge list, and measurably does it worse
        // than the product it is being compared against.
        structure: structuralFacts(g.nodes, g.edges, limitNodeIdsOf(g.raw)),
        ...(groupedGoalPathLinks(g.raw).length > 0 ? { unsized_goal_path_links: groupedGoalPathLinks(g.raw).map((l) => ({
          from: l.from, to: l.to, from_label: l.source_label, to_label: l.target_label,
          question: l.question, source_unit: l.source_unit, target_unit: l.target_unit,
          ...(l.estimate === undefined ? {} : { estimate: l.estimate }),
        })) } : {}),
        // (B) goal target, limits, links, the ONE readiness verdict, and the earlier analysis kept apart from it — with the
        // saved Run's own goal certainty (`withSavedRunCertainty`).
        ...modelContext,
        // ⭐ S7 step 1: the ONE Run-facts packet every AI call after a Run reads (`run-facts.ts`), with the comparison with the
        // preceding Run exactly as this state gates it (the licensed `analysis.run_delta`, Olumi's `rerun_record`).
        ...(g.analysis_result === undefined || g.analysis_result === null ? {} : { run_facts: runFactsOf(g.analysis_result, g.raw,
          isPlainRecord(g.analysis_state) && isPlainRecord(g.analysis_state.run_state) && g.analysis_state.run_state.kind === 'complete_current',
          { analysisState: g.analysis_state, analysisReady: g.analysis_ready, comparison: {
            prior_run_id: g.run_delta?.endpoints?.prior.run_id,
            run_delta: isPlainRecord(modelContext.analysis) ? modelContext.analysis.run_delta : undefined, rerun_record: rerunRecord } }) }),
        // ⭐ COACH (BYPASS1 fold-in): the ONE typed blocker this read has, if any (`next-step-blocker.ts`). The Q4 rule in the
        // host contract tells the AI to end its reply with that step; no host line says it.
        ...nextStepFactOf(g),
        ...(rerunRecord === undefined ? {} : { rerun_record: rerunRecord }),
        // A7: what of the brief the model does NOT carry — the read's own manifest, projected; none when the read had none.
        ...(g.not_modelled !== undefined ? { not_modelled: notModelledContext(g.not_modelled) } : {}),
        // Every proposal this user has been shown and not yet approved, newest
        // first — including a held add-option, which lives in the session store,
        // not in memory. An approval with nothing to bind to is an approval that
        // silently does nothing.
        awaiting_your_approval: [...await liveHeldAwaiting(ctx.scenario_id), ...proposals.outstanding(ctx.scenario_id, ctx.authenticated_user_id)],
        // S8: durable human reasoning. Present only when the user has stated an objection (default bytes unchanged).
        ...(statedObjections.length > 0 ? { stated_objections: statedObjections, stated_objections_use: STATED_OBJECTIONS_USE } : {}),
        // Present ONLY when the read failed: the user may have stated objections that could not be read this turn.
        ...(statedObjectionsUnreadable ? { stated_objections_unreadable: true } : {}),
      };
    },

    /**
     * ⭐ CHALLENGE → AUTHORISED REVISION. The user says how strong an existing link is; ONE change records it as
     * theirs, through the product's own link writer (`edge_strength_edit`) on approval. Served (F) row F8 on
     * `319dde1`: without this the Agent answered "I could not record 'strong' separately".
     */
    async proposeLinkStrength(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      if (!isInfluenceBand(args?.strength)) {
        return { ok: false, mutated: false, refusal: 'unreadable_strength',
          detail: 'The strength must be one of the tool\u2019s values: weak (the canvas\u2019s Slight), moderate, strong, very strong. Nothing was prepared; '
            + 'ask the user which, in the canvas\u2019s words: slight, moderate, strong or very strong.' };
      }
      const band = args.strength;
      // ⛔ Recorded as the user's only when the user named the band, or approves Olumi's reading of their own words
      // (`bandGrounding`); the writer stamps it as theirs.
      const grounding = bandGrounding(band, args.from_words, ctx.user_turn_text);
      if (grounding === null) {
        return { ok: false, mutated: false, refusal: 'strength_not_stated',
          detail: `The user has not called this link ${linkBandWord(band)} in this message, in their own words, so nothing was prepared: it would be recorded as their estimate. `
            + 'Ask them how strong they think it is \u2014 slight, moderate, strong or very strong \u2014 and never offer a band as theirs.' };
      }
      const interpretation = grounding.kind === 'reading' ? grounding.interpretation : undefined;
      const yourWords = interpretation === undefined ? '' : `, Olumi\u2019s reading of your "${interpretation.from_words}"`;
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const fromRes = resolveNamed(g, String(args.from_label ?? ''), () => true);
      const toRes = resolveNamed(g, String(args.to_label ?? ''), () => true);
      const ambiguousEnds = [
        ...(fromRes.kind === 'ambiguous' ? [describeAmbiguity(g, String(args.from_label ?? ''), fromRes.candidates)] : []),
        ...(toRes.kind === 'ambiguous' ? [describeAmbiguity(g, String(args.to_label ?? ''), toRes.candidates)] : []),
      ];
      if (ambiguousEnds.length > 0) {
        return { ok: false, mutated: false, refusal: 'ambiguous_entity', ambiguous_targets: ambiguousEnds, ambiguous_note: AMBIGUOUS_NOTE,
          detail: 'Nothing was proposed: more than one entity carries that name.' };
      }
      const from = fromRes.kind === 'one' ? fromRes.node : undefined;
      const to = toRes.kind === 'one' ? toRes.node : undefined;
      if (from === undefined || to === undefined) {
        return { ok: false, mutated: false, refusal: 'unresolved_entity',
          detail: `No entity is labelled "${from === undefined ? args.from_label : args.to_label}". Read the state again and use a label exactly as it appears.` };
      }
      const edge = g.edges.find((e) => e.from === from.id && e.to === to.id);
      if (edge === undefined) {
        return { ok: false, mutated: false, refusal: 'no_such_link',
          detail: `The model has no link from "${from.label}" to "${to.label}", so there is no strength to record. Nothing was prepared. `
            // PJ-C3 (DL GO #72 5861666870, kept from the reverted #2183): an "offer" is a second ask; the add IS the one change.
            + 'If the user has just sized that link, propose it now with propose_model_change, with the same strength and from_words: '
            + 'one change for them to approve, not a question first. Otherwise, offer to add it.' };
      }
      /**
       * ⛔ R3-9 (DL #72 5866746362; Canonical #2229; AIQ 5867435409): a link a declared identity DEFINES (MRR = price ×
       * subscribers) is not a belief WHILE THE IDENTITY IS IN USE. Its strength is never read, so a change would be
       * stored and silently ignored. Refused by the one predicate (`definitionalLinkInUse`), in its own words, for a
       * strength and a reversal alike. The last Run is the WRITER'S OWN input (DL CHANGES_REQUIRED on #2248): the read's
       * `analysis_identity_run_use`, Canonical's `identityRunUseFromFacts` over the same facts `edge_strength_edit` decides
       * from on approval, passed straight through — no second rule. So this door refuses exactly where the writer would:
       * no Run → refused; the last successful Run kept the identity → refused, however stale the graph; that Run
       * withdrew it → prepared, the strength was used.
       */
      const definition = definitionalLinkInUse(g.raw, from.id, to.id, g.identity_run_use ?? null);
      if (definition !== null) {
        return { ok: false, mutated: false, refusal: 'definitional_link',
          detail: `${definitionalLinkRefusalText(g.raw, definition)} Tell the user exactly this. Never offer to change this link's strength or direction.` };
      }
      const mean = (edge.strength !== null && typeof edge.strength === 'object') ? (edge.strength as { mean?: unknown }).mean : undefined;
      if (typeof mean !== 'number' || !Number.isFinite(mean)) {
        return { ok: false, mutated: false, refusal: 'unreadable_link', detail: 'That link carries no readable strength, so nothing was prepared. Tell the user plainly.' };
      }
      const current: 'positive' | 'negative' = edge.effect_direction === 'negative' || edge.effect_direction === 'positive'
        ? edge.effect_direction : (mean < 0 ? 'negative' : 'positive');
      const wanted = args.direction === 'positive' || args.direction === 'negative' ? args.direction : current;
      /**
       * ⛔ A REVERSAL IS THE USER'S WORDS, NEVER THE MODEL'S GUESS (DL #72 5863691992; served pj-20260928T044420Z A16: "Get on
       * and update it to very strong" — the Agent sent `direction: 'positive'` and the risk that lowers MRR was prepared
       * "pushing up", disclosed only as a trailing ", pushing up"; the harness approved it and the Run reported the
       * reversal as a modelling error). The band was grounded (`bandGrounding`); the direction was not. A direction
       * other than the link's own is taken ONLY with the user's phrase for it in THIS turn (`direction_from_words`,
       * `wordsTheUserWrote` — the Agent cannot invent it), and the preview then says plainly that it REVERSES the link.
       * Otherwise nothing is prepared, and the next call is named: the same arguments without `direction`.
       */
      const reverses = wanted !== current;
      const directionWords = typeof args.direction_from_words === 'string' ? args.direction_from_words.trim() : '';
      // …and those words must themselves SAY which way (DL #2203 residual): A16's own "update it to very strong" is
      // written and said, yet says no direction. A movement must agree with `wanted`; "the other way" agrees with any.
      const says = reverses ? directionTheWordsSay(directionWords) : null;
      if (reverses && (!wordsTheUserWrote(directionWords, ctx.user_turn_text) || says === null || (says !== 'reverse' && says !== wanted))) {
        const way = (d: 'positive' | 'negative'): string => (d === 'positive' ? 'raises' : 'lowers');
        return { ok: false, mutated: false, refusal: 'direction_not_stated',
          detail: `"${from.label}" \u2192 "${to.label}" ${way(current)} "${to.label}" in the model; this call would reverse it so that it ${way(wanted)} it, `
            + 'and the user has not said in this message, in their own words, that it runs the other way. Nothing was prepared. '
            + `NEXT CALL: call propose_link_strength again with exactly the same arguments, except leave out "direction": the link keeps its direction and only its strength is recorded. `
            + 'Give "direction" only when the user said it runs the other way, with their exact words in "direction_from_words": words that themselves say which way it runs.' };
      }
      const currentBand = edgeBandFromMagnitude(Math.abs(mean));
      // Already in the band the user named, pushing the same way: KEEP the figure. A confirm is REVIEW, never authorship
      // (R11): the writer keeps who sized the link, so only a link the user ALREADY sized may be called theirs (M1 Accept
      // receipt, R3 5942069984; DL 5942097719 — on Olumi's estimate it lands `olumi_accepted`, Olumi's figure).
      /**
       * ⭐ F1 (#87 6006627551; DL lease c6; d5 6006667946): a band that MOVES a link holding the user's own figure would
       * drop that figure. Nothing is prepared, and the user hears their figure quoted — unless THIS turn's own words ask
       * to replace it, which the approval then carries to the writer in-process. A confirm keeps the figure (review), so
       * it is never refused.
       * The ask binds to ONE link and ONE band (buddy r1 #3, r2 #1): its clause (`replaceClauseOf`, un-negated, #2)
       * states this band and names no other node — only this link's ends, or none: the bare "replace my figure with
       * slight" the refusal invites. Decided BEFORE confirm: a replace in the band the link already sits in is still a replace (#4).
       * A replace keeps the sign (d5; #5): one that would also reverse the link is refused.
       */
      const heldNow = userFigureHeld(edge);
      const replaceClause = heldNow === null ? null : replaceClauseOf(ctx.user_turn_text);
      const otherLabels = g.nodes.map((n) => String(n.label ?? '')).filter((l) => l !== from.label && l !== to.label);
      // Bound to THIS link (buddy r2 #1): the clause names no other node — the bare ask, or only this link's own ends. A
      // shared end never binds it to a link it does not name ("Replace my figure on Pro plan price to MRR" names Pro plan
      // price, so it is not Cost overrun risk → MRR's). A node whose label sits inside one of this link's ends ("Price"
      // in "Pro plan price") is that end, not another node.
      const ownEnds = [from.label, to.label];
      const namesAnotherNode = replaceClause !== null && otherLabels.some((l) => mentionsLabel(replaceClause, l)
        && !ownEnds.some((end) => mentionsLabel(replaceClause, end) && mentionsLabel(end, l)));
      const replacesFigure = replaceClause !== null && bandTheUserWrote(band, replaceClause) && !namesAnotherNode;
      if (replacesFigure && reverses) {
        return { ok: false, mutated: false, refusal: 'replace_keeps_direction',
          detail: `Nothing was prepared. Tell the user exactly this: "${REPLACE_KEEPS_DIRECTION_TEXT}"` };
      }
      // ⭐ D1 (DL ruling 12 Oct, recovery Batch D; the class closed for this door too): a placeholder has no current band,
      // so the band the user names for it SIZES it at the band's midpoint, as theirs; never "kept as it is". It stays a review
      // only where that write could not size it: the default already IS the midpoint.
      const placeholderMoves = linkSizing(edge) === 'placeholder' && Math.abs(mean) !== bandMidpoint(band);
      const confirm = !replacesFigure && currentBand === band && wanted === current && !placeholderMoves;
      const keptIsTheirs = linkSizing(edge) === 'user';
      const heldFigure = confirm ? null : heldNow;
      if (heldFigure !== null && !replacesFigure) {
        return { ok: false, mutated: false, refusal: 'user_figure_held',
          detail: `Nothing was prepared. Tell the user exactly this: "${userFigureHeldRefusalText(heldFigure, linkBandWord(band))}" `
            + 'Never offer a band as their estimate for this link unless they ask to replace their figure in their own words.' };
      }
      const magnitude = confirm ? Math.abs(mean) : bandMidpoint(band);
      const value = {
        magnitude,
        intent: confirm ? 'confirm_current' : 'set',
        direction_intent: confirm || args.direction === undefined ? 'preserve' : wanted,
        expected: { mean, effect_direction: current },
        // ⭐ A6e — the band the USER named, kept on the approved proposal (content-hashed with it) and carried to the
        // writer in-process on approval, never on the wire: a named band stores the band's own spread as the link's
        // std (`edgeBandStd`), which the `edge_strength_edit` event cannot tell apart from an exact figure.
        band,
        // ⭐ F1: the user's explicit replace, with the figure it replaces (for the receipt), held the same way.
        ...(replacesFigure && heldFigure !== null ? { replaces_user_figure: { quote: heldFigure.quote } } : {}),
      };
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations: [{ op: 'update_edge', path: `${from.id}::${to.id}`, value }],
        provenance: { authored_by: 'user_stated', basis: String(args.rationale ?? '') },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: replacesFigure && heldFigure !== null
          ? `Replace your figure (\u2018${heldFigure.quote}\u2019) on "${from.label}" \u2192 "${to.label}" with ${linkBandWord(band)}, as your own estimate`
          : confirm
          ? `Record "${from.label}" \u2192 "${to.label}" as ${linkBandWord(band)}${yourWords}${keptIsTheirs ? ', as your own estimate' : ''} (its strength stays as it is)`
          : `Record "${from.label}" \u2192 "${to.label}" as ${linkBandWord(band)}${yourWords}, as your own estimate${reverses ? `, and REVERSE its direction so that it ${wanted === 'positive' ? 'raises' : 'lowers'} "${to.label}" (your "${directionWords}")` : ''}`,
        ...(interpretation === undefined ? {} : { interpretation }),
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        link: { from: from.label, to: to.label, was: { ...(linkSizing(edge) === 'placeholder' ? {} : { band: edgeStrengthWords(edge) }), direction: current },
          becomes: { band: linkBandWord(band), direction: wanted }, keeps_current_strength: confirm },
        ...(interpretation === undefined ? {} : { interpretation }),
        note: (interpretation === undefined ? '' : readingNote(interpretation)) + (confirm
          ? (keptIsTheirs
            ? `Nothing has changed yet. The link already sits in that band, so its strength is kept and only recorded as the user\u2019s own. Say so, never the id, and call authorise_change with this proposal_id once they agree. ${BAND_WORDS_ONLY}`
            : `Nothing has changed yet. ${linkSizing(edge) === 'placeholder' ? 'Its numbers are kept exactly as they are' : 'The link already sits in that band, so its strength is kept exactly as it is'} and only the user\u2019s review of it is recorded: ${linkSizing(edge) === 'placeholder'
              ? 'nobody had sized this link; approving records review, never the user\u2019s authorship'
              : 'the figure stays whoever\u2019s it was (Olumi\u2019s estimate stays Olumi\u2019s), never the user\u2019s own'}. Say so, never the id, and call authorise_change with this proposal_id once they agree. ${BAND_WORDS_ONLY}`)
          : `Nothing has changed yet. Tell the user it will be recorded as ${linkBandWord(band)}, as their own estimate — never the id — and call authorise_change with this proposal_id once they agree. ${BAND_WORDS_ONLY}`),
      };
    },

    /**
     * ⭐ THE USER'S STATED EFFECT ON ONE LINK, ONE APPROVAL (DL 5882763151; Canonical's writer, 5882965890 / 5882989451).
     * Both figures must be ones the user WROTE this turn, and `quote` their words verbatim. The change is DRY-RUN through
     * Canonical's pure writer (`applyLinkEffectEdit`) on the read it is proposed from, so every refusal is the writer's own
     * and is said now, never at approval; the proposal carries the analysis revision AND the link's `edge_token`.
     */
    async proposeLinkEffect(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const text = typeof ctx.user_turn_text === 'string' ? ctx.user_turn_text : typeof ctx.user_text === 'string' ? ctx.user_text : '';
      const grouped = Array.isArray(args?.links) && args.links.length > 0 ? args.links : undefined;
      if (grouped !== undefined) {
        const g = await readGraph(ctx.scenario_id);
        if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
        let working: unknown = g.raw;
        const prepared: { from: string; to: string; effect: { amount: number; amount_unit: string; per_source_change: number; per_source_change_unit: string };
          quote: string; edge_token: string; said: string; from_label: string; to_label: string; unit_readings?: readonly LinkEffectUnitReading[]; label_readings?: readonly LinkEffectLabelReading[]; mediator_readings?: readonly LinkEffectMediatorReading[]; reversal?: { from: 'positive' | 'negative'; to: 'positive' | 'negative' }; link_selected?: true }[] = [];
        const notPrepared: { from_label: string; to_label: string; refusal: string; detail: string }[] = [];
        for (const entry of grouped) {
          const fromLabel = String(entry.from_label ?? '');
          const toLabel = String(entry.to_label ?? '');
          const fail = (refusal: string, detail: string): void => { notPrepared.push({ from_label: fromLabel, to_label: toLabel, refusal, detail }); };
          const entryQuote = typeof entry.quote === 'string' ? entry.quote.trim() : '';
          if (quoteSpansIn(text, entryQuote).length === 0) {
            fail('quote_not_verbatim', 'Nothing was prepared: this link\u2019s `quote` must be the user\u2019s own words from THIS message, copied exactly.');
            continue;
          }
          const entryAmount = Number(entry.amount);
          const entryPer = Number(entry.per_source_change);
          const entryAmountUnit = typeof entry.amount_unit === 'string' ? entry.amount_unit.trim() : '';
          const entryPerUnit = typeof entry.per_source_change_unit === 'string' ? entry.per_source_change_unit.trim() : '';
          if (!Number.isFinite(entryAmount) || !Number.isFinite(entryPer) || entryPer === 0 || entryAmountUnit === '' || entryPerUnit === '') {
            fail('unreadable_effect', 'Nothing was prepared: this effect needs the change in the target and the change in the source it is per, each with its unit.');
            continue;
          }
          const [fromRes, toRes] = resolveLinkEffectEnds(g, ctx, fromLabel, toLabel);
          const ambiguousEnds = [
            ...(fromRes.kind === 'ambiguous' ? [describeAmbiguity(g, fromLabel, fromRes.candidates)] : []),
            ...(toRes.kind === 'ambiguous' ? [describeAmbiguity(g, toLabel, toRes.candidates)] : []),
          ];
          if (ambiguousEnds.length > 0) { fail('ambiguous_entity', 'Nothing was prepared: more than one entity carries one of these names.'); continue; }
          const from = fromRes.kind === 'one' ? fromRes.node : undefined;
          const to = toRes.kind === 'one' ? toRes.node : undefined;
          if (from === undefined || to === undefined) {
            fail('unresolved_entity', `No entity is labelled "${from === undefined ? fromLabel : toLabel}". Read the state again and use a label exactly as it appears.`);
            continue;
          }
          const labelsOf = (keep: (kind: unknown) => boolean): string[] => g.nodes.filter((n) => keep((n as { kind?: unknown }).kind))
            .map((n) => String(n.label ?? '')).filter((l) => l !== '');
          const stated = { amount: entryAmount, amount_unit: entryAmountUnit, per_source_change: entryPer, per_source_change_unit: entryPerUnit };
          // ONE scope for admission, the figure question and the recorded sentence, so they cannot read different units.
          const endUnits = linkEffectEndUnits(working, from.id, to.id);
          const statedScope = { quantities: labelsOf((k) => k !== 'option' && k !== 'decision'), link_selected: linkSelectedByRequest(ctx, from.id, to.id), target_units: ownUnitsOf(to),
            target_unitless: endUnits?.target.own.length === 0 && endUnits.target.adopted === undefined,
            source_unitless: endUnits?.source.own.length === 0 && endUnits.source.adopted === undefined };
          // RT-18 (DL 0df0e1): a link the model does not hold is said FIRST. Every figure question below ends with the canvas
          // route "click the link from A to B", which must never name a link the canvas does not show.
          const held = linkEffectTargetOf(working, from.id, to.id);
          if (held.kind === 'refused') {
            // Codex r1 on #2641: EVERY refused lookup is said before a figure question (its words carry a click route).
            if (held.reason === 'edge_not_found') fail('no_such_link', linkEffectNoSuchLinkWords(working, from, to));
            else fail('target_ambiguous', linkEffectRefusalWords('target_ambiguous', working, from, to));
            continue;
          }
          const contextMiss = linkEffectQuoteContextMiss(entryQuote, text);
          if (contextMiss === null && quoteIsNotTheUsersClaim(text, entryQuote)) { fail('not_the_users_statement', NOT_THE_USERS_CLAIM); continue; }
          const binderMiss = contextMiss ?? linkEffectTheUserStated(entryQuote, stated, { source: from.label, target: to.label }, statedScope);
          // S2: the statement read through the option that sets the source (`optionStatedLinkEffect`): it binds what the binder
          // cannot read, and counts one of what the option adds in the source's own unit.
          const viaOption = contextMiss !== null || (binderMiss !== null && !OPTION_READS_PAST.has(binderMiss)) ? null
            : optionStatedLinkEffect(working, { from: from.id, to: to.id }, entryQuote, stated, { now: ctx.user_turn_text });
          const miss = viaOption !== null ? null : binderMiss;
          if (miss === 'figures_not_in_statement') {
            // Never an improvised wording the recorder may refuse again (DL 0df0e1 ruling on Acceptance 6001583510): ONE fixed
            // question, said exactly, with the canvas route that always works.
            fail('not_the_users_figure', linkEffectUnitAskWords(linkEffectStatementAsk(miss, from.label, to.label), from, to));
            continue;
          }
          if (miss === 'denied' && saysNoChange(entryQuote, text)) {
            fail('not_the_users_statement', linkEffectDeniedWords(from, to));
            continue;
          }
          if (miss !== null) {
            fail('not_the_users_statement', linkEffectUnitAskWords(linkEffectStatementAsk(miss, from.label, to.label,
              linkEffectFigureNotAChange(entryQuote, stated, { source: from.label, target: to.label }, statedScope.target_units)?.question), from, to));
            continue;
          }
          const said = (binderMiss === null ? statingSentenceOf(entryQuote, stated, { source: from.label, target: to.label }, statedScope) : null)
            ?? viaOption?.statement.quote ?? entryQuote;
          if (viaOption?.per_source_change_unit !== undefined) stated.per_source_change_unit = viaOption.per_source_change_unit;
          const endpoints = linkEffectTargetOf(working, from.id, to.id);
          if (endpoints.kind === 'refused' && endpoints.reason === 'target_ambiguous') {
            fail('target_ambiguous', linkEffectRefusalWords('target_ambiguous', working, from, to));
            continue;
          }
          const edgeToken = linkEffectEdgeToken(working, from.id, to.id);
          if (edgeToken === null) {
            fail('no_such_link', `The model has no link from "${from.label}" to "${to.label}", so there is no effect to record. Nothing was prepared.`);
            continue;
          }
          const expectedHash = computeAnalysisAffectingGraphHash(working as never);
          if (expectedHash === null) {
            fail('unreadable_model', 'Nothing was prepared: the model could not be read in the form needed to size this link. Read the state again and try once more.');
            continue;
          }
          // RT-6 row 1b (Science #87 6005615422): an end stated by its node's own LABEL is read as that node's unit, a
          // reading the card shows for approval (never a silent credit).
          const labelled = withLabelCountUnits(working, from.id, to.id, stated, said);
          const labelReadings = labelled.label_readings.length > 0 ? { label_readings: labelled.label_readings } : {};
          const selected = linkSelectedByRequest(ctx, from.id, to.id) ? { link_selected: true as const } : {};
          const unitReading = prepareLinkEffectUnitReadings(working, from.id, to.id, labelled.effect, said, selected);
          const unitAsk = unitReading.ask ?? (unitReading.unit_readings.length > 0 && said.length > 400
            ? `Could you say how much \u201c${from.label}\u201d moves \u201c${to.label}\u201d in one shorter sentence, with each unit beside its figure?` : undefined);
          if (unitAsk !== undefined) {
            fail('unit_mismatch', linkEffectUnitAskWords(unitAsk, from, to));
            continue;
          }
          const unitView = withLinkEffectUnitReadings(working, unitReading.unit_readings);
          const consent = { ...linkEffectConsent(unitView, from.id, to.id, labelled.effect), ...selected };
          const effect = withPointsAtZero(labelled.effect, unitReading.points_at_zero, from.id, to.id);
          const unitReadings = unitReading.unit_readings.length > 0 ? { unit_readings: unitReading.unit_readings } : {};
          const dry = applyLinkEffectEdit({ persistedGraph: working, from: from.id, to: to.id, effect,
            expected: { graph_hash: expectedHash, edge_token: edgeToken }, quote: said,
            ...unitReadings, ...consent,
            reading_token: linkEffectReadingToken({ from: from.id, to: to.id, effect, quote: said, ...unitReadings, ...consent }), lastRunIdentityUse: g.identity_run_use ?? null,
            // S5t: a group of ONE is approved through the one-link door, the only door that admits a frame refit.
            ...(grouped.length === 1 ? { frameRefit: true as const } : {}) });
          if (dry.kind === 'refused') {
            const definition = dry.reason === 'definitional_link' ? definitionalLinkInUse(working, from.id, to.id, g.identity_run_use ?? null) : null;
            fail(dry.reason, definition !== null ? `${definitionalLinkRefusalText(working, definition)} Tell the user exactly this.`
              : linkEffectRefusalWords(dry.reason, working, from, to, effect, unitReading.unit_readings));
            continue;
          }
          // No-dead-end (B)/(C): a level-less mediator's reading is said on the card, for approval.
          const mediated = linkEffectMediatorReadings(unitView, from.id, to.id);
          prepared.push({ from: from.id, to: to.id, effect, quote: said, edge_token: edgeToken, said,
            ...unitReadings, ...labelReadings, ...(mediated.length > 0 ? { mediator_readings: mediated } : {}), ...consent,
            from_label: cardNameOf(g, from.id), to_label: cardNameOf(g, to.id) });
          working = dry.mutatedGraph;
        }
        if (prepared.length === 0) {
          const first = notPrepared[0];
          return first === undefined
            ? { ok: false, mutated: false, refusal: 'unreadable_effect', detail: 'Nothing was prepared: no link carried a readable effect.' }
            : { ok: false, mutated: false, refusal: first.refusal, detail: first.detail, not_prepared: notPrepared };
        }
        const operations = prepared.map((item) => ({ op: 'set_link_effect' as const, path: `${item.from}::${item.to}`,
          value: { from: item.from, to: item.to, effect: item.effect, quote: item.said, edge_token: item.edge_token,
            ...(item.reversal !== undefined ? { reversal: item.reversal } : {}), ...(item.link_selected ? { link_selected: true } : {}),
            ...(item.unit_readings !== undefined ? { unit_readings: item.unit_readings } : {}),
            ...(item.label_readings !== undefined ? { label_readings: item.label_readings } : {}),
            ...(item.mediator_readings !== undefined ? { mediator_readings: item.mediator_readings } : {}) } }));
        const proposal = createProposal({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id, base_graph_identity_hash: g.graph_hash,
          operations, provenance: { authored_by: 'user_stated', basis: prepared.map((item) => item.said).join('\n') },
          validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: `Record your figures for ${prepared.length} links` });
        proposals.put(proposal);
        return { ok: true, mutated: false, proposal_id: proposal.proposal_id, public_label: proposal.public_label, base_revision: g.graph_hash,
          links: prepared.map((item) => ({ from: item.from_label, to: item.to_label, effect: item.effect, your_words: item.said })),
          ...(notPrepared.length > 0 ? { not_prepared: notPrepared } : {}),
          note: 'Nothing has changed yet. Tell the user these figures will be recorded as THEIR figures for the listed links, in their words, and call authorise_change with this proposal_id once they agree.' };
      }
      const quote = typeof args?.quote === 'string' ? args.quote.trim() : '';
      if (quoteSpansIn(text, quote).length === 0) {
        return { ok: false, mutated: false, refusal: 'quote_not_verbatim',
          detail: 'Nothing was prepared: `quote` must be the user\u2019s own words from THIS message, copied exactly. Quote them and propose again.' };
      }
      const amount = Number(args?.amount);
      const per = Number(args?.per_source_change);
      const amountUnit = typeof args?.amount_unit === 'string' ? args.amount_unit.trim() : '';
      const perUnit = typeof args?.per_source_change_unit === 'string' ? args.per_source_change_unit.trim() : '';
      if (!Number.isFinite(amount) || !Number.isFinite(per) || per === 0 || amountUnit === '' || perUnit === '') {
        return { ok: false, mutated: false, refusal: 'unreadable_effect',
          detail: 'Nothing was prepared: the effect needs the change in the target and the change in the source it is per, each with its unit.' };
      }
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const [fromRes, toRes] = resolveLinkEffectEnds(g, ctx, String(args.from_label ?? ''), String(args.to_label ?? ''));
      const ambiguousEnds = [
        ...(fromRes.kind === 'ambiguous' ? [describeAmbiguity(g, String(args.from_label ?? ''), fromRes.candidates)] : []),
        ...(toRes.kind === 'ambiguous' ? [describeAmbiguity(g, String(args.to_label ?? ''), toRes.candidates)] : []),
      ];
      if (ambiguousEnds.length > 0) {
        return { ok: false, mutated: false, refusal: 'ambiguous_entity', ambiguous_targets: ambiguousEnds, ambiguous_note: AMBIGUOUS_NOTE,
          detail: 'Nothing was proposed: more than one entity carries that name.' };
      }
      const from = fromRes.kind === 'one' ? fromRes.node : undefined;
      const to = toRes.kind === 'one' ? toRes.node : undefined;
      if (from === undefined || to === undefined) {
        return { ok: false, mutated: false, refusal: 'unresolved_entity',
          detail: `No entity is labelled "${from === undefined ? args.from_label : args.to_label}". Read the state again and use a label exactly as it appears.` };
      }
      // RT-6: the binder checks numbers and link identity; the card asks consent to the Agent's reading.
      const labelsOf = (keep: (kind: unknown) => boolean): string[] => g.nodes.filter((n) => keep((n as { kind?: unknown }).kind))
        .map((n) => String(n.label ?? '')).filter((l) => l !== '');
      const statedEffect = { amount, amount_unit: amountUnit, per_source_change: per, per_source_change_unit: perUnit };
      const statedEnds = { source: from.label, target: to.label };
      const endUnits = linkEffectEndUnits(g.raw, from.id, to.id);
      const statedScope = { quantities: labelsOf((k) => k !== 'option' && k !== 'decision'), link_selected: linkSelectedByRequest(ctx, from.id, to.id), target_units: ownUnitsOf(to),
        target_unitless: endUnits?.target.own.length === 0 && endUnits.target.adopted === undefined,
        source_unitless: endUnits?.source.own.length === 0 && endUnits.source.adopted === undefined };
      // RT-18 (DL 0df0e1): a link the model does not hold is said FIRST. Every figure question below ends with the canvas
      // route "click the link from A to B", which must never name a link the canvas does not show.
      const held = linkEffectTargetOf(g.raw, from.id, to.id);
      if (held.kind === 'refused') {
        // Codex r1 on #2641: EVERY refused lookup is said before a figure question (its words carry a click route).
        return held.reason === 'edge_not_found'
          ? { ok: false, mutated: false, refusal: 'no_such_link', detail: linkEffectNoSuchLinkWords(g.raw, from, to) }
          : { ok: false, mutated: false, refusal: 'target_ambiguous', detail: linkEffectRefusalWords('target_ambiguous', g.raw, from, to) };
      }
      const contextMiss = linkEffectQuoteContextMiss(quote, text);
      if (contextMiss === null && quoteIsNotTheUsersClaim(text, quote)) {
        return { ok: false, mutated: false, refusal: 'not_the_users_statement', why: 'not_the_users_claim', detail: NOT_THE_USERS_CLAIM };
      }
      const binderMiss = contextMiss ?? linkEffectTheUserStated(quote, statedEffect, statedEnds, statedScope);
      // S2: the statement read through the option that sets the source (`optionStatedLinkEffect`): it binds what the binder
      // cannot read, and counts one of what the option adds in the source's own unit.
      const viaOption = contextMiss !== null || (binderMiss !== null && !OPTION_READS_PAST.has(binderMiss)) ? null
        : optionStatedLinkEffect(g.raw, { from: from.id, to: to.id }, quote, statedEffect, { now: ctx.user_turn_text });
      const miss = viaOption !== null ? null : binderMiss;
      if (miss === 'figures_not_in_statement') {
        // Never an improvised wording the recorder may refuse again (DL 0df0e1 ruling on Acceptance 6001583510, where Olumi's
        // own suggested sentence was refused 3/3): ONE fixed question, said exactly, with the canvas route that always works.
        const ask = linkEffectStatementAsk(miss, from.label, to.label);
        return { ok: false, mutated: false, refusal: 'not_the_users_figure', question: ask, detail: linkEffectUnitAskWords(ask, from, to) };
      }
      if (miss === 'denied' && saysNoChange(quote, text)) {
        return { ok: false, mutated: false, refusal: 'not_the_users_statement', why: miss, detail: linkEffectDeniedWords(from, to) };
      }
      if (miss !== null) {
        const ask = linkEffectStatementAsk(miss, from.label, to.label, linkEffectFigureNotAChange(quote, statedEffect, statedEnds, statedScope.target_units)?.question);
        return { ok: false, mutated: false, refusal: 'not_the_users_statement', why: miss, question: ask,
          detail: linkEffectUnitAskWords(ask, from, to) };
      }
      // AIQ 5884881500 ("proposer, not stamper"): the ONE sentence the rule read is what is stored and shown for approval.
      const said = (binderMiss === null ? statingSentenceOf(quote, statedEffect, statedEnds, statedScope) : null) ?? viaOption?.statement.quote ?? quote;
      if (viaOption?.per_source_change_unit !== undefined) statedEffect.per_source_change_unit = viaOption.per_source_change_unit;
      const endpoints = linkEffectTargetOf(g.raw, from.id, to.id);
      if (endpoints.kind === 'refused' && endpoints.reason === 'target_ambiguous') {
        return { ok: false, mutated: false, refusal: 'target_ambiguous', detail: linkEffectRefusalWords('target_ambiguous', g.raw, from, to) };
      }
      const edgeToken = linkEffectEdgeToken(g.raw, from.id, to.id);
      if (edgeToken === null) {
        return { ok: false, mutated: false, refusal: 'no_such_link',
          detail: `The model has no link from "${from.label}" to "${to.label}", so there is no effect to record. Nothing was prepared.` };
      }
      // RT-6 row 1b (Science #87 6005615422): an end stated by its node's own LABEL is read as that node's unit, a reading
      // the card shows for approval (never a silent credit).
      const labelled = withLabelCountUnits(g.raw, from.id, to.id, statedEffect, said);
      const stated = labelled.effect;
      const labelReadings = labelled.label_readings.length > 0 ? { label_readings: labelled.label_readings } : {};
      const selected = linkSelectedByRequest(ctx, from.id, to.id) ? { link_selected: true as const } : {};
      const unitReading = prepareLinkEffectUnitReadings(g.raw, from.id, to.id, stated, said, selected);
      const unitAsk = unitReading.ask ?? (unitReading.unit_readings.length > 0 && said.length > 400
        ? `Could you say how much \u201c${from.label}\u201d moves \u201c${to.label}\u201d in one shorter sentence, with each unit beside its figure?` : undefined);
      if (unitAsk !== undefined) {
        return { ok: false, mutated: false, refusal: 'unit_mismatch', question: unitAsk, detail: linkEffectUnitAskWords(unitAsk, from, to) };
      }
      const unitView = withLinkEffectUnitReadings(g.raw, unitReading.unit_readings);
      const consent = { ...linkEffectConsent(unitView, from.id, to.id, stated), ...selected };
      // Science F1: a % at the user's own 0 is points; the card shows, and the writer stores, that reading.
      const effect = withPointsAtZero(stated, unitReading.points_at_zero, from.id, to.id);
      const unitReadings = unitReading.unit_readings.length > 0 ? { unit_readings: unitReading.unit_readings } : {};
      const dry = applyLinkEffectEdit({ persistedGraph: g.raw, from: from.id, to: to.id, effect,
        expected: { graph_hash: g.graph_hash, edge_token: edgeToken }, quote: said,
        ...unitReadings, ...consent,
        // A dry run of the reading the card will show: its own token, so every refusal it returns is about the write.
        reading_token: linkEffectReadingToken({ from: from.id, to: to.id, effect, quote: said, ...unitReadings, ...consent }), lastRunIdentityUse: g.identity_run_use ?? null,
        frameRefit: true });
      if (dry.kind === 'refused') {
        const definition = dry.reason === 'definitional_link' ? definitionalLinkInUse(g.raw, from.id, to.id, g.identity_run_use ?? null) : null;
        return { ok: false, mutated: false, refusal: dry.reason,
          detail: definition !== null ? `${definitionalLinkRefusalText(g.raw, definition)} Tell the user exactly this.` : linkEffectRefusalWords(dry.reason, g.raw, from, to, effect, unitReading.unit_readings) };
      }
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations: [{ op: 'set_link_effect', path: `${from.id}::${to.id}`,
          value: { from: from.id, to: to.id, effect, quote: said, edge_token: edgeToken, ...unitReadings, ...labelReadings,
            // No-dead-end (B)/(C): a level-less mediator's reading is said on the card, for approval.
            ...((m) => m.length > 0 ? { mediator_readings: m } : {})(linkEffectMediatorReadings(unitView, from.id, to.id)), ...consent } }],
        provenance: { authored_by: 'user_stated', basis: said },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: `Record your figure for how "${cardNameOf(g, from.id)}" moves "${cardNameOf(g, to.id)}": "${said}"`,
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        link: { from: cardNameOf(g, from.id), to: cardNameOf(g, to.id), effect, your_words: said },
        note: 'Nothing has changed yet. Tell the user it will be recorded as THEIR figure for this link, in their words, never the id, '
          + 'and call authorise_change with this proposal_id once they agree.',
      };
    },

    /**
     * ⭐ THE CONFIRM CARD (DL 5888399097; `../identity-card.ts`): R3's reading of the goal as a product of two of the user's
     * figures, read from the STORED model (`proposeProductIdentity`), held as ONE proposal whose button shows exactly its
     * words. Dry-run through the door first: a card the door would refuse is never offered. Nothing is written here.
     */
    async proposeIdentity(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) {
        return { ok: false, mutated: false, refusal: 'unreadable_model', detail: 'The model could not be read, so no reading was offered. Nothing was changed.' };
      }
      const pendingNow = await opts.readPendingActions?.(ctx.scenario_id) ?? [];
      if (pendingNow.some(p => scopeIssueBlocks(p.action))) return { ok: false, mutated: false, refusal: 'goal_scope_unresolved', detail: 'Resolve the retained goal-scope question before confirming a product identity.' };
      // ⛔ ONE held-change predicate at ISSUANCE, for every door (the Agent's tool call, a Run's hint, the re-offer and the bar
      // press): an identity card is never issued while another held change waits for its yes (GOAL-REACH, DL #2802 P1:
      // path-only supersession would discard it before either is decided). The identity card itself does not block its re-offer.
      if (heldChangeBlocksIdentity(pendingNow)) {
        return { ok: false, mutated: false, refusal: 'held_change_waiting',
          detail: 'A suggested change is waiting for your yes. Approve it, or change something first. Nothing was offered.' };
      }
      let card = identityReadingWithinTimeClass(g.raw, g.brief_text);
      if (card === null) {
        return { ok: false, mutated: false, refusal: 'no_reading_to_confirm',
          detail: 'The model holds no reading of the goal for the user to confirm. Nothing was offered; say nothing about one.' };
      }
      // A short answer belongs only to a missing part of this reading, and only in THIS typed turn.
      // `user_text` includes earlier turns; `user_turn_text` comes from the route's typedNow.
      if (args !== undefined && Object.keys(args).length > 0) {
        const missing = identityPartsWithoutLevel(g.raw, card.factor_ids);
        const refuseFigure = (partLabel: string): ToolResult => ({ ok: false, mutated: false, refusal: 'identity_part_figure_not_stated',
          detail: `Nothing was offered. Ask once, in plain words: ‘What's the number for ‘${partLabel || missing[0]?.label || 'this part'}’ today?’ Never guess, round or invent it.` });
        if (!Array.isArray(args.parts) || args.parts.length === 0) return refuseFigure('');
        const partLevels: IdentityPartLevel[] = [];
        const figureSpans = new Set<number>();
        for (const entry of args.parts) {
          const partLabel = typeof entry?.part_label === 'string' ? entry.part_label : '';
          const resolved = resolveNamed(g, partLabel, () => true);
          const part = resolved.kind === 'one' ? resolved.node : undefined;
          const span = part === undefined ? null : figureTheUserWroteForSpan(entry.value, entry.unit, ctx.user_turn_text, {
            ...scopeIn(g, part.label), exactFigure: true,
          });
          if (part === undefined || !missing.some(p => p.id === part.id) || partLevels.some(p => p.part_id === part.id)
            || typeof entry.value !== 'number' || !Number.isFinite(entry.value) || entry.value <= 0
            || typeof entry.unit !== 'string' || entry.unit.trim() === ''
            || span === null || figureSpans.has(span.start)) {
            return refuseFigure(partLabel);
          }
          figureSpans.add(span.start);
          partLevels.push({ part_id: part.id, raw_value: entry.value, unit: entry.unit });
        }
        const labelOf = (id: string): string => { const l = g.nodes.find(n => n.id === id)?.label; return typeof l === 'string' && l.trim() !== '' ? l.trim() : id; };
        const named = card.factor_ids.map(id => {
          const level = partLevels.find(p => p.part_id === id);
          const figure = level === undefined ? ''
            : sayFigureWithoutRounding(level.raw_value, readUnitParts(level.unit)?.kind === 'count' ? '' : level.unit);
          return `‘${labelOf(id)}’${level === undefined ? '' : ` (${figure}, your figure)`}`;
        });
        card = { ...card, words: `Olumi reads ‘${labelOf(card.outcome_id)}’ as ${named.join(' × ')}. Is that how you work it out?`,
          part_levels: partLevels };
      }
      if (!identityConfirmBaseIsWritable(g.raw)) {
        return { ok: false, mutated: false, refusal: 'identity_not_writable',
          detail: 'This model holds a size Olumi cannot record changes on yet (a link larger than the model\u2019s scale), so this reading '
            + 'cannot be confirmed now and nothing was offered. Say that plainly; never offer a card or ask the user to confirm it.' };
      }
      const dry = applyIdentityConfirmEdit({ persistedGraph: g.raw, outcome_id: card.outcome_id, factor_ids: card.factor_ids, words: card.words,
        ceiling_stock: card.ceiling_stock, brief_text: g.brief_text,
        part_levels: card.part_levels,
        expected_graph_hash: g.graph_hash, reading_token: identityConfirmReadingToken(card) });
      if (dry.kind === 'refused') {
        const label = g.nodes.find((n) => n.id === card.outcome_id)?.label;
        return { ok: false, mutated: false, refusal: `identity_${dry.reason}`,
          detail: dry.reason === 'operand_level_missing' && dry.detail !== undefined
            ? `Nothing was offered. Say exactly this, and never guess the figure or offer a confirmation: ${dry.detail}`
            : identityRefusalWords(dry.reason, typeof label === 'string' && label !== '' ? label : card.outcome_id) };
      }
      const proposal = proposals.put(identityProposalFor(ctx, g.graph_hash, card));
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        card: { words: card.words, ...(card.one_off_words !== undefined ? { one_off_words: card.one_off_words } : {}) },
        note: 'Nothing has changed yet. Explain the returned proposal or revised draft in your own words. Keep its actual quantities, units, timing, source and scope, including what it would replace or leave out. The existing card contains the complete change for approval; your explanation must not change the proposal, imply approval, or claim that it has already been saved. Tell them to confirm on the button. '
          + (card.one_off_words !== undefined ? 'The second button records the one-off reading shown on this card. ' : 'If they say no, nothing is recorded: carry on without it. ')
          + 'Never run the analysis again yourself.',
      };
    },

    /**
     * ⭐ A SET OF LINK STRENGTHS, ONE APPROVAL (DL #72 5871594233; seam Canonical 5871633483, DL 5871661097). Paul's
     * production test (`64c5eccc`): he asked Olumi for "educated guesses", said "I'm aligned with these. Please make these
     * updates", then named the bands himself for eight links; four permissions recorded ONE link, because
     * `propose_link_strength` holds one link and refuses a band the user did not type.
     *
     * Each link here is the user's estimate only when the Agent quotes the user's complete statement for it as `from_words`
     * and the host verifies that quote (`linkBandSource`, T2A5): verbatim in a verified message, this one or earlier, whole,
     * bound to this directed link by its own words, agreed by its message and not superseded. Copied or unknown material
     * (the conversation reads this band for this link, unverified) keeps an unknown origin: nothing is prepared.
     * Otherwise it is OLUMI'S ESTIMATE: the approval adopts it and the writer stamps it as Olumi's size
     * (`olumi_estimate`), never as the user's. A strength that is already the user's own is never replaced by an
     * estimate. Directions are kept (a reversal is one link, in the user's words). One proposal, one chip, one commit.
     */
    async proposeLinkStrengths(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const asked: readonly Record<string, unknown>[] = Array.isArray(args?.links) ? args.links as Record<string, unknown>[] : [];
      if (asked.length < 1 || asked.length > MAX_LINK_SET) {
        return { ok: false, mutated: false, refusal: 'unreadable_links', detail: `Give between 1 and ${MAX_LINK_SET} links. Nothing was prepared.` };
      }
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      type Shown = { from: string; to: string; band: InfluenceBand; magnitude: number; yours: boolean; keeps: boolean;
        wasEdge: unknown; sizedBefore: LinkSizing; sizedAfterApproval: LinkSizing };
      const ops: ProposalOperation[] = [];
      const shown: Shown[] = [];
      const already: string[] = [];
      const definitional: string[] = [];
      /** Links whose band's origin stays UNKNOWN: left out and named on the card, the rest of the set still offered. */
      const unknownOrigin: string[] = [];
      /** Links whose band the Agent declared a third party's: never written, left out and named with the source it cites. */
      const thirdParty: LeftOutLink[] = [];
      // ⭐ F1: links left out because they hold the user's own figure, each in the refusal's own words.
      const heldFigures: string[] = [];
      /** The same links as `definitional` and `heldFigures`, by the model's labels, for the card's own naming (#3002). */
      const definitionalPairs: string[] = [];
      const heldFigurePairs: string[] = [];
      const seen = new Set<string>();
      for (const l of asked) {
        const name = `"${String(l?.from_label ?? '')}" \u2192 "${String(l?.to_label ?? '')}"`;
        // ⛔ THE SET IS WHOLE OR NOT AT ALL: one unpreparable link prepares none, and names itself.
        const refuseSet = (refusal: string, detail: string, extra: Record<string, unknown> = {}): ToolResult => ({
          ok: false, mutated: false, refusal, link: name, ...extra,
          detail: `${detail} Nothing was prepared for any of the links.` });
        if (!isInfluenceBand(l?.strength)) {
          return refuseSet('unreadable_strength', `The strength for ${name} must be one of weak (the canvas\u2019s Slight), moderate, strong or very strong.`);
        }
        const band = l.strength;
        const fromRes = resolveNamed(g, String(l.from_label ?? ''), () => true);
        const toRes = resolveNamed(g, String(l.to_label ?? ''), () => true);
        const ambiguousEnds = [
          ...(fromRes.kind === 'ambiguous' ? [describeAmbiguity(g, String(l.from_label ?? ''), fromRes.candidates)] : []),
          ...(toRes.kind === 'ambiguous' ? [describeAmbiguity(g, String(l.to_label ?? ''), toRes.candidates)] : []),
        ];
        if (ambiguousEnds.length > 0) {
          return refuseSet('ambiguous_entity', `More than one entity carries a name in ${name}.`, { ambiguous_targets: ambiguousEnds, ambiguous_note: AMBIGUOUS_NOTE });
        }
        if (fromRes.kind !== 'one' || toRes.kind !== 'one') {
          return refuseSet('unresolved_entity', `No entity is labelled as in ${name}. Read the state again and use each label exactly as it appears.`);
        }
        const from = fromRes.node;
        const to = toRes.node;
        const key = `${from.id}::${to.id}`;
        if (seen.has(key)) return refuseSet('duplicate_link', `${name} is listed twice.`);
        seen.add(key);
        const edge = g.edges.find((e) => e.from === from.id && e.to === to.id);
        if (edge === undefined) {
          return refuseSet('no_such_link', `The model has no link from "${from.label}" to "${to.label}". Leave it out of the set, or offer to add it.`);
        }
        /**
         * ⛔ R3-9 × R12 (served 13acc577, 28 Sep: Paul's set held "Pro plan price" → "Pro MRR", an operand of the declared
         * MRR = price × subscribers): a link a declared identity DEFINES is not a belief while the identity is in use, and
         * the writer refuses the WHOLE set on it at approval ("Not saved: none of it was applied."). Left out HERE, by the
         * one predicate the writer decides with (`definitionalLinkInUse` over the read's `identity_run_use`, as
         * `proposeLinkStrength` does), and said — so the approval the user gives is one the writer can honour.
         */
        const definition = definitionalLinkInUse(g.raw, from.id, to.id, g.identity_run_use ?? null);
        if (definition !== null) {
          definitional.push(definitionalLinkRefusalText(g.raw, definition));
          definitionalPairs.push(`"${from.label}" \u2192 "${to.label}"`);
          continue;
        }
        const mean = (edge.strength !== null && typeof edge.strength === 'object') ? (edge.strength as { mean?: unknown }).mean : undefined;
        if (typeof mean !== 'number' || !Number.isFinite(mean)) {
          return refuseSet('unreadable_link', `"${from.label}" \u2192 "${to.label}" carries no readable strength.`);
        }
        const direction: 'positive' | 'negative' = edge.effect_direction === 'negative' || edge.effect_direction === 'positive'
          ? edge.effect_direction : (mean < 0 ? 'negative' : 'positive');
        const currentBand = edgeBandFromMagnitude(Math.abs(mean));
        const pair = `"${from.label}" \u2192 "${to.label}"`;
        // The link's review stamp as proposed (#2257's `reviewed_by_user`): the writer refuses the set if it moved since.
        const review = (edge.provenance as { reviewed_by_user?: { intent?: unknown; at?: unknown } } | undefined)?.reviewed_by_user;
        const reviewedAt = review?.intent === 'confirm' && typeof review.at === 'string' ? review.at : null;
        // B1: preview the canonical review writer, then read it with THE predicate. Some contradictory projected
        // records must remain unsized after review; their card must not promise an estimate that review cannot store.
        const provenance = isPlainRecord(edge.provenance) ? edge.provenance : {};
        const sizedBy = (newMean: number | undefined): LinkSizing => linkSizing({ ...edge, provenance: sizedByApproval({ ...provenance,
          reviewed_by_user: { intent: 'confirm' } }, edge, newMean) });
        /**
         * ⭐ D1: A PLACEHOLDER HAS NO CURRENT BAND (DL ruling 12 Oct, recovery Batch D, amending Batch A ruling 1/5 · L4 (c)
         * for this case only; Science 393023 LICENCE ruling 3). Its default always sits in some band (0.5 reads "strong"),
         * so a band proposed for it, the user's or Olumi's, was "kept as it is": a review, and run 3's decisive link
         * ("Tech leads hired" → "Leadership capacity") stayed unsized. A proposed band now SIZES a placeholder at that
         * band's midpoint, so the default is never what gets stamped. It stays a review only where that write cannot size
         * it: the default already IS the midpoint, or (Olumi's) the adoption writer keeps the link unsized.
         */
        const midpoint = (direction === 'negative' ? -1 : 1) * bandMidpoint(band);
        const placeholderMoves = linkSizing(edge) === 'placeholder' && Math.abs(mean) !== bandMidpoint(band);
        const keepsUsers = currentBand === band && !placeholderMoves;
        const keepsOlumis = currentBand === band && !(placeholderMoves && sizedBy(midpoint) !== 'placeholder');
        const sizedAfterApproval = sizedBy(keepsOlumis ? undefined : midpoint);
        /**
         * ⭐ F1 (#87 6006627551; DL lease c6): a band that MOVES a link holding the user's own figure would drop it — for
         * the user's band and Olumi's estimate alike (a brief figure is `brief_extraction` + `user_stated`, so the
         * `usersOwn` test below never saw it). The writer refuses the whole set at approval, so it is left out HERE and
         * said, as a definitional link is. A replace goes through `propose_link_strength`, one link, in the user's words.
         */
        const heldFigure = currentBand === band ? null : userFigureHeld(edge);
        if (heldFigure !== null) {
          heldFigures.push(userFigureHeldRefusalText(heldFigure, linkBandWord(band)));
          heldFigurePairs.push(pair);
          continue;
        }
        // The selection binds exactly ONE directed link only when nothing else is selected. The model's `user_stated` is not
        // source authority (PL 22:07Z): attributed or questioned words fail.
        const selection = ctx.grounded_selection;
        const bound = selection?.unresolved === 'none' && selection.element_ids.length === 0 ? ctx.grounded_links ?? [] : [];
        // ⭐ T2A5 (AIE rulings on 6157593360): the Agent reads whose words they are and quotes the user's complete statement
        // as `from_words`; the host verifies it (`linkBandSource`): verbatim in a verified message, this one or earlier, whole,
        // bound to this directed link by its own words, agreed by its message and not superseded. Unverified, while the
        // conversation reads this band for this link, is copied or unknown material: its origin stays unknown and nothing is
        // prepared, never relabelled Olumi's estimate. Anything else is Olumi's own new estimate, shown as such on the card.
        const said = ctx.verified_user_messages !== undefined && ctx.verified_user_messages.join('\n') === ctx.user_text
          ? ctx.verified_user_messages : (ctx.user_text ?? '').split('\n').filter((m) => m.trim() !== '');
        const typed = ctx.user_turn_text ?? '';
        const source = linkBandSource(l.from_words, band, { messages: typed.trim() !== '' && said[said.length - 1] !== typed ? [...said, typed] : said,
          ...(typed.trim() !== '' ? { thisMessage: typed } : {}), ...(ctx.unverified_user_text !== undefined ? { unverified: ctx.unverified_user_text } : {}) },
          g.nodes, from.id, to.id, bound);
        /**
         * ⭐ KNOWN-ORIGIN TRANSPORT (#3002, DL 14 Oct after Codex CHECK-3002-783a55b8): the Agent DECLARES whose band it is
         * (`origin`), the host verifies it mechanically, and only a verified origin is written.
         *  · USER: `origin` user and a quote that verifies (`linkBandSource`) in a message the user TYPED in this process. Restored
         *    and reseeded rows (chip text is stored as a user message) are never verified (`authorshipWords`), so a match there is
         *    not a receipt. `user_text_complete` is not read here: it is false on every route turn from the first.
         *  · OLUMI: `origin` olumi, NO quote, Olumi's own `basis`, and the conversation does not read this band for this link.
         *  · Anything else stays UNKNOWN and is never written: a third party's band (`origin` third_party, named with the
         *    `source` it cites), an absent origin, and a quote or a claim that does not verify. The card names each link left out.
         */
        const nonBlank = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';
        const declared = l.origin;
        /**
         *  · STORED (the host's own pre-mortem / Strengthen card, `linkStrengthsCardArgs`; not in the AI's schema): the card offers
         *    the band the link already holds, so its STORED origin is carried by identity, never a new act (AIE packet 2b19ae59,
         *    producer AMEND: not-user is not Olumi's). A stored Olumi estimate stays Olumi's and the card reviews it; the user's
         *    stays the user's ("already", below); any other stored band is unknown, left out and named.
         */
        const storedOlumis = declared === 'stored' && !nonBlank(l.from_words) && currentBand === band
          && (linkSizing(edge) === 'olumi_estimate' || linkSizing(edge) === 'olumi_accepted');
        const origin = declared === 'user'
          ? (nonBlank(l.from_words) && source.verified ? 'human' : 'unknown')
          : declared === 'olumi' && !nonBlank(l.from_words) && nonBlank(l.basis)
            ? statementOrigin(false, source.copied, ctx.user_text_complete !== false, true)
            : storedOlumis ? 'ai' : 'unknown';
        // An UNKNOWN band is left out and named, never written; the links whose origin IS known are still offered (Paul's
        // served set: his named links are his, "all other listed effects to moderate" names no link, so those stay unknown).
        // A band the user's OWN strength already sits in changes nothing whoever names it: it goes on to "already" below.
        if (origin === 'unknown' && !(keepsUsers && linkSizing(edge) === 'user')) {
          // A third party's band is named with the source it is attributed to, whole (never cut); without a source it is unknown.
          if (declared === 'third_party' && nonBlank(l.source)) thirdParty.push({ pair, source: l.source.replace(/\s+/g, ' ').trim() });
          else unknownOrigin.push(pair);
          continue;
        }
        const stated = origin === 'human' ? [band] : null;
        if (stated?.includes(band) === true) {
          // ⛔ B1 (DL CR on #2255; AIQ R11 rows): naming the band a link already sits in changes no value, so it is a
          // REVIEW, never authorship: a confirm, which the link writer records as `reviewed_by_user` with the band (#2257)
          // and never credits. Only a band that MOVES the link is theirs, and a placeholder has no band to sit in (D1).
          const keeps = keepsUsers;
          // #2473 CR (CODEX_CLI_OVERFLOW 5937437431): the user's OWN strength, named in the band it already sits in, is
          // "already" — nothing to approve. Any other kept link is a review whose figure the writer holds byte-equal.
          if (keeps && linkSizing(edge) === 'user') {
            already.push(`${pair} is already ${linkBandWord(band)}, as the user set it`);
            continue;
          }
          const magnitude = keeps ? Math.abs(mean) : bandMidpoint(band);
          ops.push({ op: 'set_link_strength', path: key, value: { magnitude, intent: keeps ? 'confirm_current' : 'set',
            expected: { mean, effect_direction: direction, reviewed_at: reviewedAt }, band, author: 'user_stated' } });
          shown.push({ from: from.label, to: to.label, band, magnitude, yours: true, keeps, wasEdge: edge,
            sizedBefore: linkSizing(edge), sizedAfterApproval });
          continue;
        }
        // Olumi's estimate. A strength the user set is theirs: an estimate never replaces it.
        const usersOwn = linkSizing(edge) === 'user';
        if (usersOwn) {
          if (currentBand === band) { already.push(`${pair} is already ${linkBandWord(band)}, as the user set it`); continue; }
          return refuseSet('users_own_strength', `The strength of ${pair} is the user\u2019s own (${edgeStrengthWords(edge)}), and an estimate never replaces it. `
            + 'NEXT CALL: the same links without this one \u2014 unless the user names its band in their own words.');
        }
        // ⛔ R3 DEFECT 1 (5936673643, served dcd72dc3; DL GO 1 Oct): approving the band a link ALREADY SITS IN keeps its
        // figure. Matching only the band's midpoint re-set a sized estimate μ 0.6 → 0.55 (σ 0.3 → 0.275, its sizing note
        // dropped) and Paul's placeholders 0.5 → 0.55 on a no-change approval, staling the Run. Kept, it is a REVIEW
        // (`confirm_current`); a placeholder confirmation is refused by the canonical writer because no estimate exists.
        // An estimate already accepted in that band is "already". Only a band that MOVES the link sets its midpoint, and a
        // placeholder has no band to sit in (D1): Olumi's band sizes it, as Olumi's estimate the user accepts.
        const keeps = keepsOlumis;
        const magnitude = keeps ? Math.abs(mean) : bandMidpoint(band);
        if (keeps && !approvalSizes(edge) && isAcceptedOlumiSize(edge)) { already.push(`${pair} already sits at ${linkBandWord(band)}`); continue; }
        // Kept at its value it is a REVIEW of Olumi's band (`confirm_current`): the writer refuses a `set` that changes nothing.
        ops.push({ op: 'set_link_strength', path: key, value: { magnitude, intent: keeps ? 'confirm_current' : 'set',
          expected: { mean, effect_direction: direction, reviewed_at: reviewedAt }, band, author: 'model_proposed',
          sizing_after_approval: sizedAfterApproval } });
        shown.push({ from: from.label, to: to.label, band, magnitude, yours: false, keeps, wasEdge: edge,
          sizedBefore: linkSizing(edge), sizedAfterApproval });
      }
      const unknownLeftOut = { ...(unknownOrigin.length > 0 ? { left_out_unknown_origin: unknownOrigin } : {}),
        ...(thirdParty.length > 0 ? { left_out_third_party: thirdParty.map(attributed) } : {}) };
      if (ops.length === 0 && unknownOrigin.length + thirdParty.length > 0 && heldFigures.length === 0 && definitional.length === 0) {
        return { ok: false, mutated: false, refusal: 'origin_unknown', link: unknownOrigin[0] ?? thirdParty[0]?.pair, ...unknownLeftOut, ...(already.length > 0 ? { already } : {}),
          detail: `${UNKNOWN_ORIGIN_DETAIL} Nothing was prepared for any of the links.` };
      }
      if (ops.length === 0) {
        if (heldFigures.length > 0 && definitional.length === 0) {
          return { ok: false, mutated: false, refusal: 'user_figure_held', left_out_user_figures: heldFigures, ...unknownLeftOut, ...(already.length > 0 ? { already } : {}),
            detail: 'Nothing was prepared: every link left holds the user\u2019s own figure. Tell the user exactly what `left_out_user_figures` says, and never offer a band as their estimate for those links.' };
        }
        if (definitional.length > 0) {
          return { ok: false, mutated: false, refusal: 'definitional_link', definitional, ...unknownLeftOut, ...(already.length > 0 ? { already } : {}),
            ...(heldFigures.length > 0 ? { left_out_user_figures: heldFigures } : {}),
            detail: 'Nothing was prepared: every link left is defined by a calculation the model declares. Tell the user exactly what `definitional` says. Never offer to change those links.' };
        }
        return { ok: false, mutated: false, refusal: 'nothing_to_change', already,
          detail: 'Every link already holds what was asked, so nothing was prepared. Say so plainly.' };
      }
      const remainsPlaceholder = (x: Shown): boolean => (x.keeps || !x.yours) && x.sizedAfterApproval === 'placeholder';
      const reviewKeepsPlaceholder = (x: Shown): boolean => x.keeps && remainsPlaceholder(x);
      const sourceRemainsUnmarked = (x: Shown): boolean => (x.keeps || !x.yours) && x.sizedAfterApproval === 'unmarked';
      const reviewOnlyWhose = 'review only; nobody has sized this link';
      const placeholderChangeWhose = 'placeholder prior changed; nobody has sized this link';
      const whose = (x: Shown): string => sourceRemainsUnmarked(x) ? 'source of its size not recorded'
        : reviewKeepsPlaceholder(x) ? reviewOnlyWhose : x.yours
        ? (x.keeps ? 'reviewed by you, kept as it is' : 'your estimate')
        : (x.sizedBefore === 'placeholder' ? 'Olumi\u2019s first estimate for a link nobody had sized' : 'Olumi\u2019s estimate');
      /**
       * Whose figure each link holds AFTER the approval (M1 Accept receipt, Codex pre-review P2): naming the band a link
       * already sits in is review (R11), never authorship — the writer keeps who sized it, so a kept link is the user's
       * only if they had ALREADY sized it (`sizedBefore`, F1b's `linkSizing`). Its literals are a typed contract
       * (`proposal-reply.ts` `LINK_WHOSE`, fail-closed on any other).
       */
      const whoseFigure = (x: Shown): 'yours' | 'Olumi\u2019s estimate' | 'Olumi\u2019s first estimate for a link nobody had sized'
        | typeof reviewOnlyWhose | typeof placeholderChangeWhose | undefined =>
        sourceRemainsUnmarked(x) ? undefined : remainsPlaceholder(x) ? (x.keeps ? reviewOnlyWhose : placeholderChangeWhose)
          : x.yours && (!x.keeps || x.sizedBefore === 'user') ? 'yours'
          : (x.sizedBefore === 'placeholder' ? 'Olumi\u2019s first estimate for a link nobody had sized' : 'Olumi\u2019s estimate');
      const keptNotTheirsAll = shown.filter((x) => x.yours && x.keeps && x.sizedBefore !== 'user' && !reviewKeepsPlaceholder(x));
      // P53x (Codex #2819 r4 P2): a kept PLACEHOLDER has no band to 'sit in'; it gets its own honest sentence.
      const keptPlaceholders = keptNotTheirsAll.filter((x) => x.sizedBefore === 'placeholder').length;
      const keptNotTheirs = keptNotTheirsAll.length - keptPlaceholders;
      const reviewOnlyLinks = shown.filter(reviewKeepsPlaceholder);
      const unsizedChanges = shown.filter(x => !x.keeps && remainsPlaceholder(x));
      const asLinks = (pairs: readonly string[]): LeftOutLink[] => pairs.map((pair) => ({ pair }));
      const leftOutSentences = [leftOutCard('unknown_origin', asLinks(unknownOrigin)), leftOutCard('third_party', thirdParty),
        leftOutCard('definitional', asLinks(definitionalPairs)), leftOutCard('user_figure', asLinks(heldFigurePairs))].filter((x) => x !== '');
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations: ops,
        provenance: { authored_by: shown.every((x) => x.yours) ? 'user_stated' : 'model_proposed', basis: String(args?.rationale ?? '') },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: `${unsizedChanges.length === shown.length ? `Change ${shown.length === 1 ? 'this link' : `these ${shown.length} links`}`
          // Any set holding a review, or a change beside strengths, is counted as the receipt will count it
          // (`mixedLinkSetHeading`), never as N link strengths.
          : unsizedChanges.length + reviewOnlyLinks.length > 0
            ? `Record ${mixedLinkSetHeading(shown.length - unsizedChanges.length - reviewOnlyLinks.length, unsizedChanges.length, reviewOnlyLinks.length)}`
          : `Record ${shown.length === 1 ? 'this link strength' : `these ${shown.length} link strengths`}`}: `
          + shown.map((x) => reviewKeepsPlaceholder(x)
            ? `"${x.from}" \u2192 "${x.to}", whose strength nobody has set yet (kept as it is)`
            : remainsPlaceholder(x) ? `"${x.from}" \u2192 "${x.to}", whose strength nobody has set yet`
            // ⭐ D1 (AIE AMEND, 12 Oct): on the OFFER, Olumi's first estimate for a link nobody had sized is said as "an estimate
            // from Olumi that has not yet been applied"; the typed `whose` stays the contract, and no receipt after a confirmed
            // write says it (the approval's words are the narrator's own).
            : `"${x.from}" \u2192 "${x.to}" as ${linkBandWord(x.band)}, ${whose(x) === 'Olumi\u2019s first estimate for a link nobody had sized'
              ? D1_PENDING_FIRST_ESTIMATE : whose(x)}`).join('; ')
          + (leftOutSentences.length > 0 ? `. ${leftOutSentences.join(' ')}` : ''),
      });
      proposals.put(proposal);
      const olumis = shown.filter((x) => !x.yours && (x.sizedBefore === 'olumi_estimate' || x.sizedBefore === 'olumi_accepted')).length;
      const firstEstimates = shown.filter((x) => whoseFigure(x) === 'Olumi\u2019s first estimate for a link nobody had sized');
      // A link Olumi had ALREADY estimated is re-sized, not sized: the Agent says so, never "your placeholders" (R3 DEFECT 2).
      const reEstimated = shown.filter((x) => !x.yours && !x.keeps && (x.sizedBefore === 'olumi_estimate' || x.sizedBefore === 'olumi_accepted'));
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        links: shown.map((x) => ({ from: x.from, to: x.to, was: { ...(x.sizedBefore === 'placeholder' ? {} : { band: edgeStrengthWords(x.wasEdge) }), sizing: x.sizedBefore },
          becomes: remainsPlaceholder(x) ? { sizing: 'placeholder' } : { band: linkBandWord(x.band) },
          whose: whoseFigure(x), keeps_current_strength: x.keeps,
          ...(x.keeps || !x.yours ? { sizing_after_approval: x.sizedAfterApproval } : {}) })),
        ...(already.length > 0 ? { already } : {}),
        ...(definitional.length > 0 ? { left_out_definitional: definitional } : {}),
        ...(heldFigures.length > 0 ? { left_out_user_figures: heldFigures } : {}),
        ...unknownLeftOut,
        // A card that leaves links out says what one approval applies (the AIE's texts, packet 2b19ae59); a whole set, as before.
        note: (leftOutSentences.length > 0 ? `${LINK_SET_APPROVAL_SCOPE_NOTE} ` : 'Nothing has changed yet. ONE approval records every link in this set, all together or none. ')
          + (unknownOrigin.length > 0 ? `${LINK_SET_UNKNOWN_AGENT_NOTE} ` : '')
          + (thirdParty.length > 0 ? `${LINK_SET_THIRD_PARTY_AGENT_NOTE} ` : '')
          + (definitional.length > 0 ? 'Some links were left out because a calculation the model declares defines them (`left_out_definitional`): say so in those words, and never offer to change them. ' : '')
          + (heldFigures.length > 0 ? 'Some links were left out because they hold the user\u2019s own figure (`left_out_user_figures`): say exactly those words for them. ' : '')
          + (olumis > 0
            ? `${olumis === shown.length ? 'Every strength here is' : `${olumis} of these strengths are`} Olumi\u2019s estimate, not the user\u2019s: say so, and that approving applies them while they stay marked as Olumi\u2019s, never as theirs. `
            : '')
          + (firstEstimates.length > 0
            ? 'For links nobody had sized, this offers Olumi\u2019s first estimate: approving records it as Olumi\u2019s, never as the user\u2019s own. '
              + (firstEstimates.some((x) => x.keeps) ? 'Where the strength is kept as it is, approving records only the user\u2019s review, never authorship. ' : '')
            : '')
          + (reviewOnlyLinks.length > 0
            ? 'These links aren\u2019t sized in the model yet: approving records only the user\u2019s review and keeps their stored strength. Never call their strengths the user\u2019s own or Olumi\u2019s estimates. '
            : '')
          + (unsizedChanges.length > 0
            ? 'These changes move the stored placeholder strength, but the links still aren\u2019t sized in the model yet. Say that explicitly: approving changes the stored figure and records review, never an estimate or the user\u2019s authorship. '
            : '')
          + (shown.some(sourceRemainsUnmarked)
            ? 'For links whose sizing stays unmarked, who set the strength is not recorded. Never call that strength the user\u2019s own, a placeholder or Olumi\u2019s estimate. '
            : '')
          + (keptNotTheirs > 0
            ? `${keptNotTheirs === shown.length ? 'Every link here' : `${keptNotTheirs} of these links`} already sits in the band the user named, so approving records only their review: its strength is kept exactly as it is and is never the user\u2019s own (\`whose\`). `
            : '')
          + (keptPlaceholders > 0
            ? `${keptPlaceholders === shown.length ? 'No link here had a size yet' : `${keptPlaceholders} of these links had no size yet`}: their numbers are kept exactly as they are, and approving records only the user\u2019s review, never their authorship (\`whose\`). `
            : '')
          + (reEstimated.length > 0
            ? `${reEstimated.length === shown.length ? 'Every link here' : `${reEstimated.length} of these links`} already held Olumi\u2019s estimate (\`was.sizing\`), so this REPLACES an earlier estimate; it does not size a placeholder: never call ${reEstimated.length === 1 ? 'it a placeholder' : 'them placeholders'}. The links nobody has sized are the ones whose \`sizing\` is \`placeholder\` in the model state. `
            : '')
          + `Tell the user what each link will hold, never the id, and call authorise_change with this proposal_id once they agree. ${BAND_WORDS_ONLY}`,
      };
    },

    /**
     * ⭐ THE USER STATES THEIR SUCCESS TARGET; ONE APPROVAL WRITES IT through the product's own typed target writer
     * (`goal_target_edit` → `add_constraint`, the Canvas control's handler). Before this the Agent had no way to set a
     * goal's target at all. Nothing is recorded as the user's that the user did not say: the figure must be in their
     * own words (`figureTheUserWrote`) and the direction in THIS turn's (`comparatorTheUserWrote`); every miss asks.
     */
    /**
     * ⭐ ONE OPTION OUT OF THE COMPARISON, OR BACK IN (MG F1 T6; spec §3 O1/O2; F5 I1.3) — the SAME writer as the UI's
     * option control (`option_status_edit`), carrying the proposal's base hash. Paul, 1 Oct: "I can't remove it with the
     * available tools" — the baseline included. The option stays in the model; only whether it is compared changes.
     * Resolved by the ONE label resolver; an ambiguous or unknown name prepares nothing and asks.
     */
    async proposeOptionStatus(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const status = args?.status;
      const requested = typeof args?.option_label === 'string' ? args.option_label.trim() : '';
      if ((status !== 'removed' && status !== 'infeasible' && status !== 'feasible') || requested === '') {
        return { ok: false, mutated: false, refusal: 'unreadable_option_status',
          detail: 'Say which option, and whether to take it out, mark it not feasible, or put it back. Nothing was prepared.' };
      }
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const res = resolveNamed(g, requested, (n) => n.kind === 'option');
      if (res.kind === 'ambiguous') {
        return { ok: false, mutated: false, refusal: 'ambiguous_option', ambiguous_targets: [describeAmbiguity(g, requested, res.candidates)],
          detail: AMBIGUOUS_NOTE };
      }
      if (res.kind !== 'one') {
        return { ok: false, mutated: false, refusal: 'option_not_found',
          detail: `No option in the model is called "${requested}", so nothing was prepared. Use the option's name exactly as get_canonical_state gives it, or ask the user which option they mean.` };
      }
      const option = res.node as GraphRead['nodes'][number] & { option_status?: unknown; analysis_participation?: unknown; proposed_by?: unknown };
      if (isUnadoptedOlumiSuggestion(option as Record<string, unknown>)) {
        return { ok: false, mutated: false, refusal: 'olumi_suggestion_not_adopted',
          detail: `"${option.label}" is Olumi's suggestion, which the user has not added to their options; putting it into the comparison is adding it, which is a different change. Nothing was prepared.` };
      }
      if ((option.option_status ?? 'feasible') === status && (option.analysis_participation ?? 'included') === PARTICIPATION_FOR_STATUS[status]) {
        return { ok: false, mutated: false, refusal: 'no_effect',
          detail: `"${option.label}" is already ${status === 'feasible' ? 'in the comparison' : status === 'removed' ? 'taken out' : 'marked not feasible'}, so nothing was prepared. Tell the user plainly.` };
      }
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        // The writer's stale gate is the ANALYSIS hash (`analysis_participation` is projected): the base this card was read on.
        base_graph_identity_hash: g.graph_hash,
        // `expected_status` is what THIS card was read on (absent = feasible): the writer refuses if it has moved since.
        operations: [{ op: 'set_option_status', path: option.id, value: { status, expected_status: option.option_status ?? 'feasible' } }],
        provenance: { authored_by: 'user_stated', basis: String(args.rationale ?? '') },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: status === 'feasible' ? `Put "${option.label}" back into the comparison`
          : status === 'removed' ? `Take "${option.label}" out of the comparison (it stays in your model)`
          : `Mark "${option.label}" as not feasible and take it out of the comparison (it stays in your model)`,
      });
      proposals.put(proposal);
      return { ok: true, mutated: false, proposal_id: proposal.proposal_id, public_label: proposal.public_label, base_revision: g.graph_hash,
        note: 'Show the user exactly this change, never the id, and call authorise_change with this proposal_id once they agree.' };
    },

    async proposeGoalTarget(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const typed = args?.constraint_type;
      const value = args?.value;
      const unit = typeof args?.unit === 'string' ? args.unit.trim() : '';
      if ((typed !== 'at_least' && typed !== 'at_most') || typeof value !== 'number' || !Number.isFinite(value) || unit === '') {
        return { ok: false, mutated: false, refusal: 'unreadable_target',
          detail: 'A target needs the figure, its unit, and whether the goal must be at least or at most that figure. Nothing was prepared; ask the user for whichever is missing.' };
      }
      const figure = targetFigure(value, unit);
      const targetNotStated: ToolResult = { ok: false, mutated: false, refusal: 'target_not_stated',
        detail: `${figure} is not a figure the user wrote, so nothing was prepared: it would be recorded as their target. `
          + 'Ask them what figure the goal must reach, in their own words, and never offer a figure of your own as theirs.' };
      /**
       * ⛔ The figure is recorded as the user's target, so it must be one the user wrote — or, TYPED by the Agent, one
       * derived from a figure they wrote (`derived_from {base, multiplier}`: "double that" after "£100,000"; F5 D1, DL
       * 380e54 on #2447). Code checks the base with the same door as any figure (and, below, its scope), and the value is
       * exactly base × multiplier. No word list reads the user's wording (DL: a free-text door is banned).
       */
      const derivedArg = (args as { derived_from?: { base?: unknown; multiplier?: unknown } }).derived_from;
      /**
       * ⛔ AN EMPTY OR IDENTITY DERIVATION IS NO DERIVATION (marketing L20, served 11 Oct 22:29Z and A′: 4 of 4 calls
       * refused `unreadable_derivation`; DL, 12 Oct). `{}`, a null base and multiplier, or a multiple of 1 derives nothing,
       * so the figure itself must be one the user wrote (the check below). Any other derivation keeps every check.
       */
      const noDerivation = derivedArg === undefined || derivedArg === null
        || (typeof derivedArg === 'object' && !Array.isArray(derivedArg)
          && (((derivedArg.base ?? null) === null && (derivedArg.multiplier ?? null) === null) || derivedArg.multiplier === 1));
      const derived = noDerivation ? null
        : typeof derivedArg.base === 'number' && Number.isFinite(derivedArg.base) && typeof derivedArg.multiplier === 'number'
          && Number.isFinite(derivedArg.multiplier) && derivedArg.multiplier > 0 && derivedArg.multiplier !== 1
          ? { base: derivedArg.base, multiplier: derivedArg.multiplier } : undefined;
      if (derived === undefined) {
        return { ok: false, mutated: false, refusal: 'unreadable_derivation',
          detail: 'derived_from needs the figure the user gave (base) and the multiple they asked for (multiplier, e.g. 2 for "double"). Nothing was prepared.' };
      }
      if (derived !== null) {
        if (Math.abs(derived.base * derived.multiplier - value) > Math.abs(value) * Number.EPSILON * 4) {
          return { ok: false, mutated: false, refusal: 'derivation_mismatch',
            detail: `${figure} is not ${derived.multiplier} × ${targetFigure(derived.base, unit)}, so nothing was prepared. Recompute it, or ask the user.` };
        }
        if (!figureTheUserWrote(derived.base, unit, ctx.user_text)) return { ...targetNotStated,
          detail: `${targetFigure(derived.base, unit)} is not a figure the user wrote, so nothing was prepared: a target derived from it would be recorded as theirs. Ask them for the figure.` };
      } else if (!figureTheUserWrote(value, unit, ctx.user_text)) return targetNotStated;
      /**
       * ⭐ WHICH WAY IT BINDS (DL 380e54 on #2447, the product ruling 5930770727 kept; follow-up 5931593767): NO REFUSAL ON
       * DIRECTION. The Agent's typed `constraint_type` is its READING; the user's own literal comparator words, when they
       * read one way, are THEIRS. When the two agree, the card is the user's. Otherwise the card is a DECISION: the literal
       * reading primary when there is one ("cut costs to £34k over the next year" reads `over`), the Agent's reading
       * primary when the words are silent, asked, denied or both ways ("double that", "our target is £200k"); the other
       * direction is the alternative button, and the user's click is the authorship. No word list over the user's wording.
       */
      // The comparator the user wrote FOR THIS figure (`comparatorTheUserWroteFor`): with two targets in one turn ("over 15%
      // and secure 20 new customers"), the whole turn's "over" is not 20's. The whole turn is read only when it holds at
      // most one figure, where its comparator can belong to no other (a target derived from one figure: "double that").
      const said = comparatorTheUserWroteFor(ctx.user_turn_text, derived?.base ?? value)
        ?? (figuresWrittenIn(ctx.user_turn_text) <= 1 ? comparatorTheUserWrote(ctx.user_turn_text) : null);
      const type: TargetDirection = said ?? typed;
      const inclusiveType = inclusiveTargetDirection(type);
      const directionIsADecision = said === null || inclusiveType !== typed;
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      // Exactly ONE goal: the event is id-addressed, and choosing between two goals would be a guess.
      const goals = g.nodes.filter((n) => n.kind === 'goal');
      if (goals.length !== 1) {
        return { ok: false, mutated: false, refusal: 'goal_not_resolved',
          detail: goals.length === 0
            ? 'The model has no goal to set a target on, so nothing was prepared. Tell the user plainly.'
            : `The model has more than one goal (${goals.map((x) => `"${x.label}"`).join(', ')}), so nothing was prepared: it is not clear which one this target is for. Ask the user which goal they mean.` };
      }
      const goal = goals[0]!;
      /**
       * ⭐ B RESTATED GOAL (DL ruling (B); PL 6116779075; AIE 0244): a target for a quantity the draft does not contain
       * (`measures` names no entity and is not the goal) cannot land as a row: Paul's marketing L20, "conversion rate of over
       * 15% and secure 20 new customers", on a draft of "launch % complete". With the goal typed in THIS message, the answer
       * is ONE revised-draft card when the draft is still unreviewed, else the gates' refusal; nothing changes either way.
       */
      const measures = typeof args.measures === 'string' ? args.measures.trim() : '';
      if (measures !== '' && norm(measures) !== norm(goal.label) && resolveNamed(g, measures, () => true).kind === 'none'
        && norm(ctx.user_turn_text).includes(norm(measures)) && figureTheUserWrote(derived?.base ?? value, unit, ctx.user_turn_text)) {
        return offerRevisedDraft(ctx, g, goal, { measures, value, unit, comparator: TARGET_OPERATOR[type] });
      }
      // ⛔ S-E GOALS (Science ruling 7 Oct §2): a goal measured as a CHANCE of an event never takes a target figure: that
      // chance is what Olumi works out ("reach or stay under" a likelihood was Paul's turn 7).
      if (isEventShareForecast(g.raw)) {
        return { ok: false, mutated: false, refusal: 'goal_measures_a_forecast',
          detail: 'This goal measures the forecast share finished by its deadline. Its full-deliverable target stays held. Type the soonest and latest times with your current team, for example "6–10 months".' };
      }
      if (goalKindOf(goal) === 'chance_of_event') {
        return { ok: false, mutated: false, refusal: 'goal_measures_a_chance',
          detail: `The goal "${goal.label}" is measured as a chance of an event, which Olumi works out, so it takes no target figure. Nothing was prepared. `
            + 'If the user stated a deadline, call propose_goal_deadline with their words; otherwise tell them plainly, and never ask them for that chance.' };
      }
      // ⛔ R1 S4-core: a target stated as a CHANGE from today ("cut the bill by 15%": `goal_threshold_frame` `change_rel`,
      // a fraction). This path writes a LEVEL target, so it would silently turn the user's change into a level. Refused by
      // name until a change can be edited as a change; the goal doors refuse it too (`add-constraint.ts`, `goal-target-edit.ts`).
      if (isChangeFrame((goal as { goal_threshold_frame?: unknown }).goal_threshold_frame)) {
        const held = heldChangeTargetAnswer({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id, user_text: ctx.user_text, user_turn_text: ctx.user_turn_text, graph: g, goal_id: goal.id, requested: { operator: TARGET_OPERATOR[type], value, unit }, rationale: args.rationale, proposals });
        if (held !== undefined) return held;
        return { ok: false, mutated: false, refusal: 'goal_is_a_change', saved_goal: savedGoalMeaningOf(g.raw, goal.id),
          detail: `The goal "${goal.label}" is stated as a change from today, and this path cannot yet change a target stated that way, so nothing was prepared. `
            + 'Tell the user plainly, and never offer a level target in its place.' };
      }
      // The target writer's own bounds: an at-least target must be a positive number (`add-constraint.ts`), said in its words.
      if (inclusiveType === 'at_least' && !(value > 0)) {
        return { ok: false, mutated: false, refusal: 'target_not_positive',
          detail: `Nothing was prepared. Olumi says: "${SUCCESS_TARGET_POSITIVE_USER_GUIDANCE}" Explain the supplied current target or approval facts in ordinary words. Keep exact quantitative values, units, scope and human-versus-Olumi provenance. A proposed modelling interpretation or approval now does not prove the original quote’s subject or authorship.` };
      }
      // ⛔ A figure in another kind of unit is never this goal's target (the lane's one family check, `unit-conflict.ts`).
      // The writer would not refuse it: it re-denominates the goal and re-derives its scale, silently.
      const trio = pickGoalThresholdTrio(goal as never) as { goal_threshold_raw?: number; goal_threshold_unit?: string };
      const goalUnit = (goal as { goal_threshold_unit?: unknown }).goal_threshold_unit ?? factorUnitOf(g.raw, goal);
      if (unitsConflict(unit, goalUnit) !== null) {
        return { ok: false, mutated: false, refusal: 'target_unit_mismatch',
          detail: `The goal "${goal.label}" is measured in ${String(goalUnit)}, and ${figure} is a different kind of figure, so nothing was prepared. `
            + 'Ask the user for the target in the goal’s own units, and never record a figure given for something else as this goal’s target.' };
      }
      // ⛔ …and written ABOUT this goal (DL #72 5862394804): "300 Pro paying subscribers" is never a £300 MRR target.
      if (!figureTheUserWroteFor(derived?.base ?? value, unit, ctx.user_text, scopeIn(g, goal.label))) return targetNotStated;
      /**
       * ⭐ THE GOAL'S LEVEL TODAY, WHEN THE USER STATED IT BESIDE THE TARGET — on THIS card, written on THIS approval
       * (AIQ #75 5913873948 row G6, 5913897396, 5913952911; DL 5913935708). R3's run: "We have secured £0 so far and need
       * at least £1m" gave a card for the target only and the reply "I'll then record the current £0 level", which
       * nothing ever recorded. A stated level (0 included) is the user's figure: the level door's own words rule
       * (`statedGoalLevelInUsersWords`), against the unit the target is written in. It is framed against the target
       * only once the target is written (the apply branch), by the level door itself. The sentence it was written in
       * travels with it: the approval arrives on a later turn, whose own text does not hold it.
       */
      const levelArg = (args as { current_level?: unknown }).current_level;
      let currentLevel: { value: number; unit: string; quote: string } | undefined;
      /**
       * ⭐ E1 — A LEVEL THAT CANNOT RIDE THE CARD IS LEFT OUT, NEVER A REASON TO OFFER NO CARD (R3 #75 5924332644; DL
       * 5924354666). Served `train-0341Z`: the strict scope rightly refused Paul's "£0" (the A4f draft's sibling outcomes
       * "Investment-firm funding secured" / "Angel funding secured" make "secured £0 so far" ambiguous), the refusal said
       * "offer the target on its own", and the Agent resent the level 6× → hop limit → no card, nothing written. The target
       * passed its own doors above, so the card holds it alone, and the level is never written unbound or unread.
       */
      let levelLeftOut: { refusal: string; reason: string; host_line?: string } | undefined;
      const firstSentence = (t: string): string => (/^.*?[.?!](?=\s|$)/.exec(t)?.[0] ?? t).trim();
      if (levelArg !== undefined && levelArg !== null) {
        const lv = (levelArg as { value?: unknown }).value;
        const lu = (levelArg as { unit?: unknown }).unit;
        const inWords = typeof lv !== 'number' || !Number.isFinite(lv) || typeof lu !== 'string' || lu.trim() === ''
          ? undefined
          : statedGoalLevelInUsersWords(lv, lu, { label: goal.label, unit }, ctx.user_text);
        if (inWords === undefined) {
          levelLeftOut = { refusal: 'unreadable_current_level', reason: 'Today’s level needs the figure and its unit, as the user wrote them.' };
        } else if (!inWords.ok) {
          levelLeftOut = { refusal: inWords.refusal, reason: firstSentence(inWords.detail) };
        } else {
        /**
         * ⛔ BOUND TO THE GOAL, IN THE TARGET'S OWN STATEMENT (AIQ CHANGES_REQUIRED on #2373; the #2275 authorship-door
         * class). Paul's answer holds three £ amounts — "about £180k in the bank … roughly £45k a month … secured £0 so far
         * and need at least £1m" — and each passed the words rule, so only the model's choice kept cash in the bank
         * from being stored as his funding secured. The level must be written (a) in the SAME sentence as the target
         * figure, and (b) about this goal, strictly (`figureTheUserWroteFor`, the target's own scope). Every miss refuses
         * the card: the Agent offers the target alone, with no promise.
         */
        const sameStatement = inWords.quote !== null && figureTheUserWrote(value, unit, inWords.quote);
        const aboutTheGoal = figureTheUserWroteFor(inWords.raw, unit, ctx.user_text, { ...scopeIn(g, goal.label), strict: true });
        if (!sameStatement || !aboutTheGoal) {
          // The figure IS the user's (it passed the words rule); only its binding to this goal failed, so Olumi says it was
          // not included (`disclosuresFor`; AIQ's words 5924376899) — never dropped silently, never "recorded".
          levelLeftOut = { refusal: 'current_level_not_bound', host_line: levelNotIncludedLine(g, goal.label, inWords, sameStatement, ctx.user_text),
            reason: `${targetFigure(inWords.raw, unit)} is not written as today's level of "${goal.label}" in the same statement as its target.` };
        } else {
          currentLevel = { value: inWords.raw, unit, quote: inWords.quote! };
        }
        }
      }
      const today = currentLevel !== undefined ? targetFigure(currentLevel.value, currentLevel.unit) : undefined;
      // ⭐ D3 step 1 (Science #87 6006079049 (1)): ONE target per goal — approving retires the goal's other own target row
      // (`add-constraint.ts`), so the card names what it replaces, in the row's own words and units.
      const chosenOperator = inclusiveType === 'at_most' ? '<=' : '>=';
      const replaced = ((g.raw as { goal_constraints?: unknown }).goal_constraints as Array<Record<string, unknown>> | undefined ?? [])
        .filter((c) => c !== null && typeof c === 'object' && c.node_id === goal.id && (c.deadline_metadata === undefined || c.deadline_metadata === null)
          && (c.value_frame === undefined || c.value_frame === 'level')
          && (c.operator === '<=' || c.operator === '>=') && c.operator !== chosenOperator && typeof c.value === 'number' && Number.isFinite(c.value))
        .map((c) => `${c.operator_as_stated === '<' ? 'below' : c.operator_as_stated === '>' ? 'above' : c.operator === '<=' ? 'at most' : 'at least'} `
          + targetFigure(c.value as number, typeof c.unit === 'string' && c.unit.trim() !== '' ? c.unit : unit));
      const replaces = replaced.length === 0 ? '' : ` This replaces your earlier target for "${goal.label}" (${replaced.join(' and ')}). Approve, or correct.`;
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations: [{ op: 'set_goal_target', path: goal.id, value: { constraint_type: type, raw_value: value, unit, ...(currentLevel !== undefined ? { current_level: currentLevel } : {}) } }],
        provenance: { authored_by: 'user_stated', basis: String(args.rationale ?? '') },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        // AIQ's words for the one card (5913952911): both figures, the user's own.
        public_label: (today === undefined
          ? `Set the goal "${goal.label}" to ${DIRECTION_WORDS[type]} ${figure}${derived === null ? '' : ` (${derived.multiplier} × your ${targetFigure(derived.base, unit)})`}`
          : `Set the goal "${goal.label}" · Your target: ${DIRECTION_WORDS[type]} ${figure} · Today: ${today}`) + replaces,
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        goal: {
          label: goal.label,
          current_target: trio.goal_threshold_raw === undefined ? null : targetFigure(trio.goal_threshold_raw, trio.goal_threshold_unit ?? ''),
          becomes: `${DIRECTION_WORDS[type]} ${figure}`,
          ...(today !== undefined ? { today } : {}),
        },
        ...(levelLeftOut !== undefined ? { current_level_left_out: levelLeftOut } : {}),
        // ⭐ DL 380e54 (#2447): the user's words were silent on the direction, so the card is a DECISION — the Agent's
        // reading is the primary button, the other the alternative (`approval-chips.ts`); the user's click is the authorship.
        ...(directionIsADecision ? { direction_choice: { chosen: type, alternative: inclusiveType === 'at_least' ? 'at_most' : 'at_least' } } : {}),
        note: `Nothing has changed yet. Tell the user it will set the goal "${goal.label}" to ${DIRECTION_WORDS[type]} ${figure}, as their own target`
          + (today !== undefined ? `, and record ${today} as its level today, their own figure, on the same approval` : '')
          + ' — never the id — and call authorise_change with this proposal_id once they agree.'
          + (levelLeftOut !== undefined ? ` Today’s level was left out of this card: ${levelLeftOut.reason} Never say it is or will be recorded`
            + (levelLeftOut.host_line !== undefined ? '. Explain any actual exclusion or unsupported part recorded by the tool, and its effect on the proposed change or analysis. Keep the original reasoning and source available; do not imply the complete goal or condition was included when it was not.' : '.') : ''),
      };
    },

    /**
     * ⭐ SYSTEM 1: THE ONE STATEMENT DOOR (M1). The user's own statement about ONE subject: its field's row reads it, it is bound
     * to that subject (its words, the selection, or the ask it answers; never by elimination) and verified as their whole words
     * (`readStatement`), and the row's writer prepares its carrier's write. ONE card in the door's template; nothing is written.
     */
    async proposeStatement(ctx, args): Promise<ToolResult> {
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'model_unavailable', detail: 'The model could not be read, so nothing was prepared.' };
      // Whose words they are is the verifier's ONE check (a whole statement of this turn's or a verified earlier message).
      const resolved = resolveSubject(g.raw, isPlainRecord(args?.subject) ? args.subject : {});
      if (resolved.kind === 'unresolved') {
        return { ok: false, mutated: false, refusal: 'subject_not_found', detail: resolved.reason === 'ambiguous'
          ? 'More than one part of the model has that label, so nothing was prepared. Ask which one the user means.'
          : 'No part of the model matches that kind, exact label and field, so nothing was prepared. Use the label get_canonical_state returned.' };
      }
      const quotes = (Array.isArray(args?.statements) ? args.statements : []).flatMap((x) => (isPlainRecord(x) && typeof x.quote === 'string'
        ? [{ quote: x.quote, ...(typeof x.answering === 'string' ? { answering: x.answering } : {}),
          ...(typeof x.reading_words === 'string' ? { reading_words: x.reading_words } : {}) }] : []));
      const texts = { now: ctx.user_turn_text, conversation: ctx.user_text,
        unverified: [ctx.unverified_user_text, g.brief_text].filter((t): t is string => typeof t === 'string').join('\n') };
      const v = readStatement(g.raw, resolved.subject, resolved.label, quotes, texts, doorContextOf(ctx, g.raw));
      if (v.kind === 'refused') return { ok: false, mutated: false, refusal: v.refusal, detail: v.refusal === 'origin_unknown' ? UNKNOWN_ORIGIN_DETAIL : v.detail };
      const row = doorRowFor(resolved.subject, g.raw);
      const write = row?.writer.approve(v.reading, g.raw);
      if (row === undefined || write === undefined || 'refused' in write) {
        return { ok: false, mutated: false, refusal: 'not_recordable', detail: write !== undefined && 'refused' in write ? write.refused : 'Nothing was prepared.' };
      }
      const card: DoorCard = { subject: resolved.subject, label: resolved.label, field: row.field, carrier: row.carrier,
        statements: v.reading.statements, member: write.member, payload: write.payload, ...(write.expected !== undefined ? { expected: write.expected } : {}),
        ...(row.derives === true ? { derives: true } : {}) };
      const operations: ProposalOperation[] = [doorOperation(card)];
      const proposal = createProposal({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id, base_graph_identity_hash: g.graph_hash,
        operations, provenance: { authored_by: 'model_proposed', basis: v.reading.statements[0]!.source },
        validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: doorCardWords(v.reading) });
      proposals.put(proposal);
      const memberOp = asMemberOp(operations[0]!);
      const preview = await readinessIfApplied(ctx, memberOp === undefined ? [] : [memberOp]);
      return { ok: true, mutated: false, proposal_id: proposal.proposal_id, public_label: proposal.public_label, base_revision: g.graph_hash,
        statement: { subject: resolved.label, field: row.field, quotes: v.reading.statements.map((x) => x.quote), your_words: true },
        note: DOOR_PROPOSED_NOTE + stillBlockedNote(preview) };
    },

    /** Propose the current-team duration from the Agent's reading of the user's words; a single time carries Olumi's assumed range. */
    async proposeTeamTime(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      // S2: the user's statements, from any of their messages, through the one shared contract (`teamTimeFromStatements`).
      // PL #94 6135017311: an end already recorded combines with what the user says now (`heldTeamTimeStatements`), unrepeated.
      const early = Array.isArray(args?.statements) ? await readGraph(ctx.scenario_id) : undefined;
      const fromStatements = Array.isArray(args?.statements)
        ? teamTimeFromStatements({ now: ctx.user_turn_text, conversation: ctx.user_text, unverified: ctx.unverified_user_text }, args.statements,
          early === null || early === undefined ? [] : heldTeamTimeStatements(early.raw)) : undefined;
      if (fromStatements?.kind === 'refused') {
        return { ok: false, mutated: false, refusal: fromStatements.refusal, detail: fromStatements.refusal === 'origin_unknown' ? UNKNOWN_ORIGIN_DETAIL : fromStatements.detail };
      }
      const typed = fromStatements !== undefined ? null : readTeamTime(ctx.user_turn_text);
      // A single typed time carries Olumi's assumed range (`withAssumedTeamRange`), so its approval opens the Run.
      const typedNow = typed !== null && teamTimeArgumentsMatch(ctx.user_turn_text, { low_months: Number(args?.low_months), high_months: Number(args?.high_months) }, typed)
        ? withAssumedTeamRange(typed, String(ctx.user_turn_text).trim(), String(ctx.user_turn_text)) : null;
      /**
       * ⭐ B2-c CONFIRMATION (DL re-scope, 12 Oct; PL #94 6131809231; AIE #94 6132054663), AI-first Lane 1 (DL 12 Oct, PL
       * 6134071898): a duration the user did not type as this whole answer is the Agent's reading, offered ONLY as a confirmation
       * card and never refused by a reader of their words. The card quotes their complete source line where the quote stands
       * verbatim in their typed words (`quotedTeamTime`, never whose it is), and only its press records the figure as their
       * selected forecast (`hasCardOnlyOperations`).
       */
      const quoted = fromStatements !== undefined ? fromStatements
        : typedNow === null ? quotedTeamTime({ now: ctx.user_turn_text, conversation: ctx.user_text }, args as never) : undefined;
      if (quoted?.kind === 'refused') return { ok: false, mutated: false, refusal: 'team_time_not_stated', detail: quoted.detail };
      const stated = typedNow ?? (quoted as Extract<NonNullable<typeof quoted>, { kind: 'found' }>).time;
      const confirmation = quoted?.kind === 'found' ? quoted.confirmation : undefined;
      const g = early ?? await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const part = draftedTeamPartOf(g.raw), deadline = part === null ? undefined : goalDeadlineFromRecord(g.raw, part.goal.id);
      if (part === null || deadline === undefined) return { ok: false, mutated: false, refusal: 'deadline_not_held',
        detail: 'First type and confirm the deadline, for example "7 April 2027".' };
      const read = teamTimeReadDigest(g.raw), today = todayInLondon((opts.now ?? (() => new Date()))());
      const a: ApprovedTeamTime = { goal_id: String(part.goal.id), team_id: String(part.team.id), ...stated, deadline,
        // S2: each statement is about THIS team part's time from today.
        ...(stated.statements !== undefined ? { statements: stated.statements.map((s) => ({ ...s, subject: { ...s.subject, node_id: String(part.team.id) }, reference: today })) } : {}),
        reference_date: today, ...(read !== null ? { read_digest: read } : {}),
        ...(confirmation !== undefined ? { confirmation } : {}) };
      if (a.reference_date >= deadline) return { ok: false, mutated: false, refusal: 'deadline_passed',
        detail: 'That deadline has passed. Type a future deadline and confirm it.' };
      if (teamTimeIsHeld(part.team, a, String(part.goal.goal_threshold_unit), g.raw)) {
        return { ok: false, mutated: false, refusal: 'already_held',
          detail: a.low_months === a.high_months ? 'Your most likely time is already held. Type the soonest and latest times with your current team, for example "6–10 months".'
            : 'That team-time range is already held. To change it, type the new soonest and latest times, for example "6–9 months".' };
      }
      const proposal = createProposal({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash, operations: [{ op: 'set_team_time', path: a.team_id, value: a }],
        // B2-c: Olumi's interpretation of the user's words until their press; the source line is its basis.
        provenance: confirmation !== undefined ? { authored_by: 'model_proposed', basis: confirmation.source !== '' ? confirmation.source : confirmation.quote }
          : { authored_by: 'user_stated', basis: ctx.user_turn_text ?? '' },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: confirmation !== undefined ? teamTimeConfirmationCard(a, part.deliverable)
          : teamTimeCard(a, String(part.goal.goal_threshold_unit), part.deliverable) });
      for (const pending of proposals.outstanding(ctx.scenario_id, ctx.authenticated_user_id)) {
        if (proposals.get(pending.proposal_id)?.operations.some(o => o.op === 'set_team_time')) proposals.discard(pending.proposal_id);
      }
      proposals.put(proposal);
      return { ok: true, mutated: false, proposal_id: proposal.proposal_id, public_label: proposal.public_label,
        base_revision: g.graph_hash, team_time: a };
    },

    /** THE USER approves the interpreted deadline and its actual source.
     * A chance goal holds a date, never a target percentage; approval binds the date and recorded reference. */
    async proposeGoalDeadline(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const words = typeof args?.deadline_words === 'string' ? args.deadline_words.trim() : '';
      if (words === '' || words.length > 80) {
        return { ok: false, mutated: false, refusal: 'unreadable_deadline',
          detail: 'A deadline needs a non-empty phrase of at most 80 characters to interpret. Nothing was prepared.' };
      }
      // Whole-word matching establishes authorship, not admission: "6 months" inside "16 months" is Olumi's
      // interpretation, never the user's stated duration. The approval card keeps that distinction visible.
      const plainOf = (t: string): string => t.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
      const phrase = plainOf(words).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const typed = typeof ctx.user_turn_text === 'string' ? plainOf(ctx.user_turn_text) : '';
      const writes = (text: string): boolean => text !== '' && new RegExp(`(?:^|[^\\p{L}\\p{N}])${phrase}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text);
      const named = lastWeekdayNamedIn(words);
      const datedNow = named !== null && weekdayDatedIn(typed) === named;
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      // ⭐ SCIENCE (AIE MA3; marketing e2e 0dac5dcc turn 04, "6 months to launch … that's when the 3-month sales cycle starts"):
      // a goal measured over the window from launch is judged over that window, so the launch date OPENS it. It is never the
      // goal's deadline (a wrong horizon), and it is not a new deliverable to redraft around (`revised_draft_has_no_target`).
      // The model has no carrier for a launch date yet (`goal_target_basis` is strict on the shared DB: reader-first, with
      // the window forecasts), so nothing is prepared and the AI says so plainly.
      const launchGoals = g.nodes.filter((n) => n.kind === 'goal');
      const launch = launchGoals.length === 1 ? launchWindowOf(launchGoals[0]) : undefined;
      if (launch !== undefined) {
        const label = String(launchGoals[0]!.label ?? 'the goal');
        return { ok: false, mutated: false, refusal: 'launch_opens_window',
          detail: `‘${label}’ is measured ${periodWords(launch)}, so the launch date the user gave (“${words}”) is when that window `
            + 'starts, not the goal\'s deadline. Olumi cannot hold a launch date in the model yet, so nothing was prepared. Tell the user '
            + `plainly, in one sentence: their targets stay measured ${periodWords(launch)}, and their launch timing is noted in this `
            + 'conversation but does not change the calculation yet. Do not ask them to restate the date, and do not offer a deadline card.' };
      }
      const heldHumanWords = proposals.outstanding(ctx.scenario_id, ctx.authenticated_user_id).some(held => {
        const proposal = proposals.get(held.proposal_id);
        return proposal?.provenance.authored_by === 'user_stated' && proposal.operations.some(op =>
          op.op === 'set_goal_deadline' && writes(plainOf(String((op.value as { words?: unknown })?.words ?? ''))));
      });
      const origin = statementOrigin(writes(typed) || writes(plainOf(ctx.user_text ?? '')) || heldHumanWords,
        writes(plainOf(ctx.unverified_user_text ?? '')) || writes(plainOf(g.brief_text ?? '')), ctx.user_text_complete);
      if (origin === 'unknown') return { ok: false, mutated: false, refusal: 'origin_unknown', detail: UNKNOWN_ORIGIN_DETAIL };
      /**
       * ⭐ GEN #5 (Paul's funding test, 13 Oct: "how these options change our ability to deliver a high-quality MVP within 6
       * months" on a draft of "Development speed"): a deadline for a deliverable that is not the model's goal cannot land on that
       * goal. With the deadline typed in THIS message, the answer is the same revised-draft card a stated figure opens, built by
       * C's construction from the brief and this message; the gates still apply, and only the user's press replaces the draft.
       */
      const deliverable = typeof args?.deliverable === 'string' ? args.deliverable.trim() : '';
      const goals = g.nodes.filter((n) => n.kind === 'goal');
      // (a) The AI's deliverable is the user's only where its words stand VERBATIM in this message (no verb list, no word match).
      if (deliverable !== '' && deliverableWrittenIn(ctx.user_turn_text, deliverable) && writes(typed) && goals.length === 1
        && draftedTeamPartOf(g.raw) === null && !isEventShareForecast(g.raw)) {
        return offerRevisedDraft(ctx, g, goals[0]!, { deliverable });
      }
      const draft = g.brief_text ? await findConstructionVersion(dispatch, ctx.scenario_id, g.brief_text) : null;
      const asOfPattern = /(?:^|[^\p{L}\p{N}])as of\s+(\d{4}-\d{2}-\d{2})(?=$|[^\p{L}\p{N}])/gu;
      const typedAsOfDates = [...typed.matchAll(asOfPattern)].map(match => match[1]);
      // ⛔ DLf5 Codex check (blocking 1) + buddy r2/r3: a typed "as of D" dates the deadline ONLY as part of the deadline's
      // own phrase: right after its words ("<words>, as of D"), or opening it with nothing between but the reader's own lead
      // words ("As of D, our deadline is <words>", read by `readStatedDeadline`, lead words only). "Revenue was 2m as of D,
      // and/whereas/plus our launch deadline is …" keeps the host reference, and the card becomes Olumi's reading to check.
      const beside = (date: string): boolean =>
        new RegExp(`(?:^|[^\\p{L}\\p{N}])${phrase}\\s*,?\\s*as of\\s+${date}(?=\\s*(?:$|[.;!?]))`, 'u').test(typed)
        || typed.split(/[.;!?\n]/).some(sentence => {
          const open = new RegExp(`^as of\\s+${date}\\s*,?\\s*(.*?)(?:^|[^\\p{L}\\p{N}])${phrase}(?=$|[^\\p{L}\\p{N}])`, 'u').exec(sentence.trim());
          return open !== null && (open[1]!.trim() === '' || readStatedDeadline(`${open[1]!.trim()} ${plainOf(words)}`, '1900-01-01', { leadWordsOnly: true }) !== null);
        });
      const asOf = typedAsOfDates.find(date => date === args.reference_date && beside(date));
      const echoedAsOfSetAside = asOf === undefined && typedAsOfDates.some(date => date === args.reference_date);
      // The ONE resolver (`draft-reference.ts`), shared with the route's automatic offer.
      const reference = draftReferenceDate({ ...(isCalendarDate(asOf) ? { asOf } : {}), versionCreatedAt: draft?.created_at, scenarioCreatedAt: g.scenario_created_at });
      if (args.reference_date !== undefined && args.reference_date !== asOf) {
        // Trace only: keep the ignored model argument out of the card, saved tuple and model-context projection.
        const { log } = await import('../../../utils/telemetry.js');
        log.info({ event: 'v5.agent.deadline_reference_ignored', request_id: ctx.request_id, reference_date: reference, ignored_reference_date: args.reference_date },
          'Ignored model deadline reference without verified current-turn user dating');
      }
      if (asOf !== undefined && !isCalendarDate(asOf)) return { ok: false, mutated: false, refusal: 'reference_invalid',
        detail: 'The reference must be a valid ISO calendar date. Nothing was prepared.' };
      // ⛔ DLf5 Codex check (blocking 2): "Our office lease expires in six months, and our launch deadline is in nine months"
      // with the quote "in six months" credited the lease. A message holding MORE THAN ONE date or duration phrase (read by
      // the one reader, as `eventDateSpans` does; an "as of D" reference is not one) offers the card as Olumi's reading.
      // The message the words came from (verified messages, newest first); words from no message are counted alone.
      const source = writes(typed) ? typed : [...(ctx.verified_user_messages ?? (ctx.user_text ?? '').split('\n'))].reverse().map(plainOf)
        .find(writes) ?? plainOf(words);
      // The user's own sentence holding the words, verbatim (this turn first, then their verified messages, newest first).
      const ownMessage = writes(typed) ? ctx.user_turn_text ?? '' : [...(ctx.verified_user_messages ?? (ctx.user_text ?? '').split('\n'))].reverse()
        .find((m) => writes(plainOf(m)));
      const userSentence = origin === 'human' && ownMessage !== undefined ? sentenceHolding(words, ownMessage) : undefined;
      const placed = await proposePlacedDeadline(ctx, args, g, words, reference,
        // A message that dates the weekday is held to its dating: a date that is not that weekday is asked about, never set aside.
        datedNow ? { turnText: ctx.user_turn_text ?? '', required: named! } : undefined,
        origin === 'human', !echoedAsOfSetAside && datePhrasesIn(source) <= 1, undefined, userSentence);
      // ⛔ Served hiring r3 (14 Oct 18:45Z, request 73434864): the AI passed reference_date 2026-02-17, the card counted from the
      // recorded 14 October 2026, and the AI withdrew its own card as "an inconsistent reference date". The set-aside reference
      // was only logged, so the AI could not tell a deliberate replacement from a fault. It is told, here, in the result.
      const setAside = typeof args.reference_date === 'string' && args.reference_date.trim() !== '' && args.reference_date !== asOf
        ? args.reference_date.trim() : undefined;
      if (placed.ok !== true || setAside === undefined || reference === undefined || setAside === reference) return placed;
      return { ...placed, reference_used: reference, reference_set_aside: setAside,
        // AIE #94 6178720067 item 2, exact text: the dates from the returned tuple; a genuine conflict still takes the existing path.
        note: `${String(placed.note ?? '')} The reference_date you passed (${setAside}) was not used. This proposal uses ${sayDate(reference)}, `
          + 'shown on the card. Explain the returned card using that reference; this difference alone is not a reason to withdraw it. '
          + 'If the returned deadline or reference conflicts with the user\u2019s actual applicable words or the current supported date/source, '
          + 'surface that specific conflict and use the existing clarification or correction path.' };
    },

    /**
     * ⭐ E5 (Paul's manual test, 12 Oct): the hiring timings the user states, per option, on ONE card. Each start is the
     * user's quote, from this message or an earlier one (E2's source-bound path), in a sentence naming that option; the months
     * are read from the quote (`hiring-times.ts`), never from the model's arguments, and every figure keeps its role and
     * origin. r2 (DL CUT): one refusal for every form Olumi cannot model as quoted. Nothing is written here.
     */
    async proposeHiringTimes(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const texts = { now: ctx.user_turn_text, conversation: ctx.user_text };
      const refuse = (refusal: string, detail: string): ToolResult => ({ ok: false, mutated: false, refusal, detail });
      const unusable = (): ToolResult => refuse('hiring_timings_unusable', 'Olumi could not use these hiring timings as quoted, so nothing was prepared. '
        + 'Re-read the user\'s own words and quote each start exactly, in the order they happen. If Olumi still cannot use them, say plainly that '
        + 'Olumi’s own hiring estimates stay in the model, labelled as Olumi’s, and ask once for each start as a number of months.');
      const asked = Array.isArray(args?.options) ? args.options : [];
      if (asked.length === 0) return unusable();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const part = draftedTeamPartOf(g.raw), deadline = part === null ? undefined : goalDeadlineFromRecord(g.raw, part.goal.id);
      const reference = todayInLondon((opts.now ?? (() => new Date()))());
      if (part === null || deadline === undefined || reference >= deadline) {
        return refuse('deadline_not_held', 'The deadline must be confirmed before these timings can be applied. Keep the supplied timings and prepare them once the deadline is confirmed.');
      }
      const goalId = String(part.goal.id), planned: PlannedOption[] = [];
      for (const o of asked) {
        const id = typeof o?.option_id === 'string' ? o.option_id : '';
        const option = g.nodes.find(n => n.id === id && n.kind === 'option');
        if (option === undefined) return refuse('unknown_option', `"${id}" is not an option in this model. Nothing was prepared.`);
        const label = String(option.label);
        if (planned.some(p => p.option_id === id)) return unusable();
        const held = capacityPartsOf(g.raw, id, goalId), estimate = olumiEstimateOf(held);
        if (held.length === 0 || estimate === null) return refuse('adds_no_people', `‘${label}’ adds no people in this model, so it has no start time. Nothing was prepared.`);
        const quotes = (Array.isArray(o.starts) ? o.starts : []).map((st: { quote?: unknown }) => typeof st?.quote === 'string' ? st.quote.trim() : '');
        const heldQuotes = heldStatementsOf(held);
        const starts = o.starts as readonly { months?: unknown }[];
        const pairings = quotes.map(quote => {
          const source = verbatimSourceLine(texts, quote);
          if (source !== undefined && quoteStatedFor(texts, quote, label) === 'not_for_option') {
            return { original_source: { text: source, authored_by: 'user_stated' as const },
              pairing: { option_id: id, authored_by: 'model_proposed' as const } };
          }
          const retained = heldQuotes.includes(quote)
            ? held.find(n => n.observed_state.extra_share_by_date.statement?.quote === quote)?.observed_state.extra_share_by_date.statement
            : undefined;
          return retained?.original_source?.authored_by === 'user_stated' && retained?.pairing?.option_id === id
            && retained.pairing.authored_by === 'model_proposed'
            ? { original_source: retained.original_source, pairing: retained.pairing } : undefined;
        });
        const origins = quotes.map((quote, i) => {
          const retained = heldQuotes.includes(quote)
            ? held.find(n => n.observed_state.extra_share_by_date.statement?.quote === quote)?.observed_state.extra_share_by_date.statement
            : undefined;
          const heldOlumi = retained?.source === 'model_proposed' || retained?.pairing?.authored_by === 'model_proposed';
          return statementOrigin(pairings[i] !== undefined || quoteStatedFor(texts, quote, label) === 'ok' || (retained !== undefined && !heldOlumi),
            !heldOlumi && (quoteSpansIn(plainWords(ctx.unverified_user_text ?? ''), plainWords(quote)).length > 0
              || quoteSpansIn(plainWords(g.brief_text ?? ''), plainWords(quote)).length > 0), ctx.user_text_complete,
            heldOlumi || (quote === '' && typeof starts[i]?.months === 'number'));
        });
        if (origins.includes('unknown')) return refuse('origin_unknown', UNKNOWN_ORIGIN_DETAIL);
        // An empty source plus explicit months is a NEW Olumi estimate, never an old quote relabelled.
        quotes.forEach((quote, i) => { if (quote === '' && origins[i] === 'ai' && typeof starts[i]?.months === 'number') quotes[i] = `in ${starts[i]!.months} months`; });
        const plan = planStarts(quotes, estimate, held.length, quotes.map((quote, i) => {
          const prior = starts[i]?.months === undefined && heldQuotes.includes(quote)
            ? held.find(n => n.observed_state.extra_share_by_date.statement?.quote === quote)?.observed_state.extra_share_by_date
            : undefined;
          return { months: starts[i]?.months, stated: origins[i] === 'human' && pairings[i] === undefined,
            ...pairings[i],
            ...(prior?.figures ? { held: { statement: prior.statement,
              lead_low: prior.figures.lead_low, lead_high: prior.figures.lead_high } } : {}) };
        }));
        if (!('parts' in plan)) {
          if (plan.refusal === 'hiring_bound_conflict') {
            const completeSource = verbatimSourceLine(texts, plan.quote) ?? plan.quote;
            return { ok: false, mutated: false, refusal: plan.refusal, calculation_supported: false,
              statement: { quote: completeSource, source: plan.source, bound: plan.bound, value: plan.value },
              detail: `${isHumanStatementSource(plan) ? 'You gave' : 'Olumi proposed'} ‘${completeSource}’. That gives a ${plan.bound} bound on the start, not an exact start. Olumi's previous timing range is incompatible with that bound. We need a compatible modelling estimate before using this timing in the calculation.` };
          }
          if (plan.refusal === 'too_many_starts') return refuse('too_many_starts', `Olumi can use at most two start times for ‘${label}’ yet, so nothing was prepared. Say so plainly, and ask once which two starts to use; until then Olumi’s own hiring estimate for ‘${label}’ stays in the model, labelled as Olumi’s.`);
          if (plan.refusal === 'fewer_starts_than_held') {
            return refuse('fewer_starts_than_held', heldQuotes.length === held.length
              ? `This card replaces all ${held.length} hiring timings for ‘${label}’ together, so nothing was prepared. Retain the unchanged timings and their sources and prepare the complete card for the requested change. If a held timing cannot be verified, ask only about that missing input.`
              : `This card replaces all ${held.length} hiring timings for ‘${label}’ together, and Olumi cannot yet keep a timing it estimated while another changes, so nothing was prepared. Say so plainly, and ask once for every start of ‘${label}’ together.`);
          }
          if (plan.refusal === 'relative_to_range') return refuse('relative_to_range', `"${plan.quote}" for ‘${label}’ ties this start to an earlier one given as a range, which Olumi cannot model yet, so nothing was prepared. Say so plainly, and ask once for that start's own time in months (for example “about 5 months”); until then Olumi’s own hiring estimate for ‘${label}’ stays in the model, labelled as Olumi’s.`);
          return unusable();
        }
        planned.push({ option_id: id, label, part_ids: held.map(n => String(n.id)), expected: held.map(n => n.observed_state.extra_share_by_date),
          olumi_estimate: estimate, parts: plan.parts, quotes });
      }
      const a: ApprovedHiringTimes = { goal_id: goalId, deadline, reference_date: reference, options: planned };
      if (hiringTimesHeld(g.raw, a)) return refuse('already_held', 'Those hiring times are already in the model. Nothing was changed.');
      // The postimage must hold exactly what the card says before it is offered, never only after the press.
      if (!hiringTimesHeld(withHiringTimes(g.raw, a), a)) return unusable();
      const proposal = createProposal({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash, operations: [{ op: SET_HIRING_TIMES, path: goalId, value: a }],
        provenance: { authored_by: planned.some(o => o.parts.some(p => p.statement.source === 'model_proposed' || p.statement.pairing?.authored_by === 'model_proposed')) ? 'model_proposed' : 'user_stated', basis: planned.flatMap(p => p.quotes).join(' | ') },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: hiringTimesCard(a, part.deliverable) });
      for (const pending of proposals.outstanding(ctx.scenario_id, ctx.authenticated_user_id)) {
        if (proposals.get(pending.proposal_id)?.operations.some(o => o.op === SET_HIRING_TIMES)) proposals.discard(pending.proposal_id);
      }
      proposals.put(proposal);
      return { ok: true, mutated: false, proposal_id: proposal.proposal_id, public_label: proposal.public_label, base_revision: g.graph_hash,
        note: 'Nothing has changed yet. The hiring times are ready for review on ONE card. Tell the user what the card says, in its words; never the ids. '
          + 'Call authorise_change only for the approval bound to this card; a typed ‘yes’ alone is not that approval.' };
    },

    /**
     * ⭐ THE COACHING LOOP (DL 14 Oct; `option-capacity-change.ts`): the user's new figure for a share of time an option the
     * deadline forecast holds unresolved already changes. The figure is an S2 statement of the user's own words; the option
     * and the share are set from graph identity; Olumi's freed-time reading and "from now" are said on the card as Olumi's.
     * Nothing is written here.
     */
    async proposeModelChange(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      // ⛔ Two entities answering to one name: nothing is proposed, and the Agent asks
      // (`resolveNamed`). An id is identity; a label beats a description.
      const fromRes = resolveNamed(g, String(args.from_label ?? ''), () => true);
      const toRes = resolveNamed(g, String(args.to_label ?? ''), () => true);
      const ambiguousEnds = [
        ...(fromRes.kind === 'ambiguous' ? [describeAmbiguity(g, String(args.from_label ?? ''), fromRes.candidates)] : []),
        ...(toRes.kind === 'ambiguous' ? [describeAmbiguity(g, String(args.to_label ?? ''), toRes.candidates)] : []),
      ];
      if (ambiguousEnds.length > 0) {
        return {
          ok: false, mutated: false, refusal: 'ambiguous_entity',
          ambiguous_targets: ambiguousEnds, ambiguous_note: AMBIGUOUS_NOTE,
          detail: 'Nothing was proposed: more than one entity carries that name.',
        };
      }
      const from = fromRes.kind === 'one' ? fromRes.node : undefined;
      const to = toRes.kind === 'one' ? toRes.node : undefined;
      if (from === undefined || to === undefined) {
        return {
          ok: false, mutated: false, refusal: 'unresolved_entity',
          detail: `No entity is labelled "${from === undefined ? args.from_label : args.to_label}". Read the state again and use a label exactly as it appears.`,
        };
      }
      if (g.edges.some((e) => e.from === from.id && e.to === to.id)) {
        return { ok: false, mutated: false, refusal: 'already_present', detail: 'That link is already in the model.' };
      }
      const bound = ctx.drawn_link;
      const parsed = parseDrawnLinkPress(bound?.press_id);
      const drawn = bound !== undefined && parsed !== null && parsed.from === bound.from && parsed.to === bound.to
        && bound.from === from.id && bound.to === to.id;
      if (bound !== undefined && !drawn) return { ok: false, mutated: false, refusal: 'drawn_pair_mismatch' };
      const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
      if ((drawn || args.reason !== undefined) && (reason.length === 0 || reason.length > 140 || /[\p{N}\r\n<>*_`{}\u005b\u005d\u2014]/u.test(args.reason ?? ''))) {
        return { ok: false, mutated: false, refusal: 'invalid_reason' };
      }
      if (args.direction !== 'positive' && args.direction !== 'negative') return { ok: false, mutated: false, refusal: 'invalid_direction' };
      /**
       * ⛔ A NEW LINK CARRIES ONLY THE BAND THE USER TYPED THIS TURN (Delivery Lead #70 5845493088, agreed by Canonical
       * 5845487856: "The Agent proposes a link only with the band the user typed THIS turn … With no band it asks 'how
       * strong…?'. The user_specified stamp is then TRUE."). The link writer stamps every link it adds `user_specified`
       * (`structural-add-edge.ts`), so the strength sent with it is recorded as the user's own estimate. Before this, an
       * approval sent a fixed 0.5 and Olumi's placeholder read as the user's figure.
       *
       * The band must be named in THIS turn's typed words by the one matcher `propose_link_strength` uses
       * (`bandTheUserWrote` — the same band words, negations and question rules, never a second copy), and it is sent as
       * that band's midpoint (`bandMidpoint`). Checked after the refusals above, so the user is never asked how strong a
       * link that cannot be added is.
       */
      const band = isInfluenceBand(args?.strength) ? args.strength : undefined;
      // …or the user described it in their own words, and approves Olumi's reading of them (`bandGrounding`, slice C3).
      const grounding = band === undefined ? null : bandGrounding(band, args?.from_words, ctx.user_turn_text);
      // The host-bound drawn pair is the sole exception: Olumi's band is approved as its own estimate,
      // then authored model_proposed through the level door. Every ordinary turn still needs the user's words.
      if (band === undefined || (!drawn && grounding === null)) {
        const ask = 'ask them "how strong is that effect: slight, moderate, strong or very strong?" and never offer a band as theirs.';
        return { ok: false, mutated: false, refusal: 'strength_not_stated',
          detail: band === undefined
            ? `${args?.strength === undefined ? 'No strength was given' : 'The strength given is not one of weak (the canvas\u2019s Slight), moderate, strong or very strong'}, so nothing was prepared. `
              + `If the user named one of those bands for this link in this message, call again with it as strength; otherwise ${ask}`
            : `The user has not called the link from "${from.label}" to "${to.label}" ${linkBandWord(band)} in this message, in their own words, so nothing was prepared: `
              + `it would be recorded as their estimate. Instead, ${ask}` };
      }
      const magnitude = bandMidpoint(band);
      const interpretation = !drawn && grounding?.kind === 'reading' ? grounding.interpretation : undefined;
      const operations: ProposalOperation[] = [
        { op: 'add_edge', path: `${from.id}::${to.id}`, value: { effect_direction: args.direction, magnitude, ...(drawn ? { band, author: 'model_proposed', reason, press_id: bound!.press_id } : {}) } },
      ];
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations,
        provenance: { authored_by: 'model_proposed', basis: args.rationale },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: drawn ? `Olumi’s estimate: ‘${from.label}’ ${args.direction === 'positive' ? 'helps' : 'hurts'} ‘${to.label}’, ${CANVAS_BAND_WORD[band]}. ${reason}` : `Connect "${from.label}" to "${to.label}" (${args.direction}) as ${linkBandWord(band)}${interpretation === undefined ? '' : `, Olumi\u2019s reading of your "${interpretation.from_words}"`}, your own estimate`,
        ...(interpretation === undefined ? {} : { interpretation }),
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        link: { from: from.label, to: to.label, direction: args.direction, band },
        ...(interpretation === undefined ? {} : { interpretation }),
        note: drawn ? 'Nothing has changed. Show the estimate and its reason, then ask the user to approve, change or decline it.' : `${interpretation === undefined ? '' : readingNote(interpretation)}Nothing has changed. Tell the user the link will be recorded as ${linkBandWord(band)}, as their own estimate — never the id — and ask them to approve it before calling authorise_change. ${BAND_WORDS_ONLY}`,
      };
    },

    /**
     * ⭐ ADOPTING ASSUMPTIONS IS A PROPOSAL, NOT A WRITE.
     *
     * The gap, measured on Paul's session of 22 Sep: 17 of 20 factors held no
     * value, the Agent listed sensible starting assumptions in prose, the user
     * replied "these look like a good set of assumptions, can you update the
     * model with them?" — and the turn came back `mutated: false` with
     * `[get_canonical_state]` as its only tool call. Honest, and inert.
     *
     * The dishonest fix is the one the incumbent already ships: invent the
     * numbers during construction and attribute them to the system. The honest
     * one is this — the model SUGGESTS, the user ADOPTS, and the adoption goes
     * through the same stored-proposal/authorise boundary as any other change,
     * so what gets written is exactly what was shown.
     *
     * ⛔ It will not overwrite a value that is already there. A factor that
     * already carries a number was set by somebody; replacing it with a guess
     * under cover of "adopting assumptions" is the failure this refuses.
     */
    async proposeAssumptions(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const input = Array.isArray(args?.assumptions) ? args.assumptions : [];
      if (input.length === 0) {
        return { ok: false, mutated: false, refusal: 'empty_proposal', detail: `No assumptions were given.${EMPTY_PROPOSAL_WORDS}` };
      }
      /**
       * ⛔ NO YES THAT CANNOT BE WRITTEN (DL 5924061304; the identity card's precedent above). The value door refuses
       * EVERY write on a base that fails the writer's own check (`executeOptionInterventionBatch` →
       * `canonical_graph_unavailable`): served `61a8c07c` stored a link at mean 1.67, offered "Record your figure", and the
       * press read "Not saved". The SAME predicate the door applies, so the card is withheld exactly when the write
       * would be refused, and offered on every base it would accept.
       */
      if (!identityConfirmBaseIsWritable(g.raw)) {
        return { ok: false, mutated: false, refusal: 'values_not_writable',
          detail: 'This model holds a size Olumi cannot record changes on yet (a link larger than the model\u2019s scale), so no '
            + 'figure can be saved on it now and nothing was proposed. Say that plainly and name the figure the model still uses; '
            + 'never offer a card, and never say a figure was recorded or will be.' };
      }

      /**
       * ⛔ ONLY A NODE THE VALUE WRITER ACCEPTS CAN BE PROPOSED A VALUE — the writer's own rule,
       * imported (`SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS`), never a copy. Served `778f1fd`
       * (witness c7a, 24 Sep 03:05Z): a value proposed for a RISK node matched by label was
       * refused at write (`entity_kind_mismatch_at_execute`) and the whole approval landed
       * nothing. A label shared by a factor and another node resolves to the factor.
       */
      const writable = (n: { kind?: unknown }) => SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS.includes(String(n.kind));
      // An exact visible LABEL wins over a description match (a factor's description must never
      // take a value the user named for a risk); among equal matches, the ONE writable kind wins —
      // and two writable matches are AMBIGUOUS, never "the first" (see `resolveNamed`).
      const unresolved: string[] = [];
      const notAFactor: { label: string; kind: string }[] = [];
      const ambiguous: AmbiguousTarget[] = [];
      const occupied: { label: string; current_value: number }[] = [];
      const unitMismatch: { label: string; value: unknown; unit: string; factor_unit: string }[] = [];
      const scaleAmbiguous: { label: string; value: number; as_percent: number; as_share: number }[] = [];
      const directionConflict: { label: string }[] = [];
      const seen = new Set<string>();
      const adopted: { id: string; label: string; value: number; unit: string; basis: string; replaces?: number; userWrote: boolean; quote?: string; asPercent?: true; kept?: true;
        confirmed?: { source: string; quote: string }; described?: { source: string; quote: string } }[] = [];
      const notKeepable: { label: string; why: 'no_figure' | 'not_exact' | 'yours' | 'brief' | 'unverified_brief' | 'already_accepted' }[] = [];
      // ⭐ Hiring path (a): an unvalued risk ROOT takes Olumi's occurrence range on its own card (`risk-occurrence.ts`).
      const riskRanges: { id: string; label: string; node: Record<string, unknown>; block: EventRiskV1T; basis: string;
        goal_id: string; goal: Record<string, unknown> }[] = [];
      const riskRangeNeeded: { label: string; within_months: number }[] = [];

      for (const given of input) {
        let a = given;
        // AIE #94 6140145484: incomplete source never supplies a missing authorship declaration.
        // Keep retains the recorded Olumi estimate; it cannot claim a new human origin.
        if (ctx.user_text_complete === false && (typeof a?.user_stated !== 'boolean'
          || (a.keep === true && a.user_stated !== false))) {
          return { ok: false, mutated: false, refusal: 'origin_unknown', detail: UNKNOWN_ORIGIN_DETAIL };
        }
        const requested = String(a?.factor_label ?? '');
        const identified = a?.factor_id !== undefined ? g.nodes.find(n => n.id === a.factor_id) : undefined;
        const res = a?.factor_id === undefined ? resolveNamed(g, requested, writable)
          : identified === undefined ? { kind: 'none' as const }
            : { kind: writable(identified) ? 'one' as const : 'other' as const, node: identified };
        if (res.kind === 'none') { unresolved.push(requested); continue; }
        // ⛔ Two writable factors answer to this name: no op for it, and the Agent asks.
        if (res.kind === 'ambiguous') {
          if (!ambiguous.some((x) => x.requested === requested)) ambiguous.push(describeAmbiguity(g, requested, res.candidates));
          continue;
        }
        if (res.kind === 'other') {
          const subject = res.node.kind === 'risk' ? riskOccurrenceSubject(g.raw, res.node.id) : undefined;
          /**
           * ⭐ SYSTEM 1 M1: a user's OWN statement about a risk (its chance, or a condition they say holds now) is recorded only
           * through the ONE statement door (`propose_statement`), never here: this tool carries Olumi's estimates only.
           */
          if (res.node.kind === 'risk' && (isPlainRecord(a?.holds_now) || (a?.user_stated === true && Array.isArray(a?.statements)))) {
            return { ok: false, mutated: false, refusal: 'use_propose_statement', detail: doorStatementDetail(res.node.label) };
          }
          if (subject?.kind === 'eligible' && a?.user_stated === false && a?.keep !== true && a?.revise !== true) {
            // The user's own chance for this risk, in THIS turn's typed words, is theirs: never offered back as Olumi's estimate.
            if (typedDoorStatement(g.raw, ctx.user_turn_text, doorContextOf(ctx))?.subject.id === res.node.id) {
              return { ok: false, mutated: false, refusal: 'occurrence_is_the_users', detail: RISK_OCCURRENCE_USERS_OWN_DETAIL };
            }
            const range = isPlainRecord(a?.occurrence_range) ? a.occurrence_range : undefined;
            const block = range === undefined ? undefined : olumiOccurrenceBlock(range.low_percent, range.high_percent, subject.window_months);
            if (block === undefined) riskRangeNeeded.push({ label: res.node.label, within_months: subject.window_months });
            else if (!riskRanges.some((r) => r.id === res.node.id)) {
              riskRanges.push({ id: res.node.id, label: res.node.label, node: subject.node, block, basis: String(a?.basis ?? ''),
                goal_id: subject.goal_id, goal: subject.goal });
            }
            continue;
          }
          notAFactor.push({ label: res.node.label, kind: String(res.node.kind) });
          continue;
        }
        const node = res.node;
        /**
         * ⭐ KEEP OLUMI'S ESTIMATE (52f8cd, lease #75 5925744661). Served `b47db0b5`, guest `9390a1b4`: Examine → "4 hours a
         * week is about right for me. Keep it." → "no change is needed", no card, nothing recorded; on a model the draft
         * filled, nothing else could record it either (adoption fills only blanks). `keep` is that act. The figure is the
         * one STORED, never the model's argument; it stays Olumi's, and the approval records the user's acceptance with the
         * adoption marker the writer already stamps (`user_assumption` + `reviewed_by_user`). Only Olumi's OWN figure may
         * pass (`heldFigureOwner`): the user's, the brief's, or one already accepted is not Olumi's to accept.
         */
        /**
         * ⭐ S2 — CONFIRM, NEVER RE-ASK (DL 14 Oct; pricing r2 judge finding 5): a figure the user WROTE that the model holds with
         * its role unverified (`unverified_brief`: Paul's "increase the Pro plan price from £49 to £59 per month") is confirmed
         * from their own complete statement through the one shared contract (`verifyStatements`), and recorded as theirs only
         * by the press. The figure is the one STORED, never the Agent's; any other figure is not this act.
         */
        if (a?.user_stated === true && Array.isArray(a?.statements) && heldFigureOwner(node) === 'unverified_brief') {
          const os = (node.observed_state ?? undefined) as Record<string, unknown> | undefined;
          const heldUnit = typeof os?.unit === 'string' ? os.unit : String(factorUnitOf(g.raw, node) ?? '');
          const held = keptFigureFor(node as never, heldUnit);
          const v = verifyStatements(a.statements, { now: ctx.user_turn_text, conversation: ctx.user_text,
            unverified: [ctx.unverified_user_text, g.brief_text].filter((t) => typeof t === 'string').join('\n') },
          { subject: { quantity: 'level_today', node_id: node.id }, unit: heldUnit, forms: ['point'],
            figuresIn: (q) => findLinkEffectAmounts(q).map((n) => ({ low: n.magnitude, high: n.magnitude })) });
          if (v.kind === 'refused') {
            return { ok: false, mutated: false, refusal: v.refusal === 'origin_unknown' ? 'origin_unknown' : 'level_not_stated',
              detail: v.refusal === 'origin_unknown' ? UNKNOWN_ORIGIN_DETAIL : v.detail };
          }
          if (typeof held !== 'number' || v.statements.length !== 1 || v.statements[0]!.low !== held) {
            return { ok: false, mutated: false, refusal: 'not_the_held_figure',
              detail: `‘${node.label}’ holds ${typeof held === 'number' ? sayFigureRead(held, heldUnit) : 'no figure'}; this confirms only that figure, from the `
                + 'user\'s own statement of it. Nothing was prepared. To change the figure, propose the new one they gave.' };
          }
          if (seen.has(node.id)) continue;
          seen.add(node.id);
          adopted.push({ id: node.id, label: node.label, value: held, unit: heldUnit, basis: '', userWrote: true,
            confirmed: { source: v.statements[0]!.source, quote: v.statements[0]!.quote } });
          continue;
        }
        if (a?.keep === true) {
          const os = (node.observed_state ?? undefined) as Record<string, unknown> | undefined;
          const keptUnit = typeof os?.unit === 'string' ? os.unit : String(factorUnitOf(g.raw, node) ?? '');
          const held = keptFigureFor(node as never, keptUnit);
          const owner = heldFigureOwner(node);
          if (typeof held !== 'number' || owner !== 'olumi') {
            const holdsValue = typeof os?.value === 'number';
            notKeepable.push({ label: node.label, why: owner === undefined || !holdsValue ? 'no_figure'
              : owner === 'olumi_accepted' ? 'already_accepted' : owner === 'olumi' ? 'not_exact' : owner });
            continue;
          }
          if (seen.has(node.id)) continue;
          seen.add(node.id);
          adopted.push({ id: node.id, label: node.label, value: held, unit: keptUnit,
            basis: String(a?.basis ?? ''), userWrote: false, kept: true });
          continue;
        }
        // ⛔ A figure in another kind of unit is never this factor's value (`unit-conflict.ts`): left out, and said.
        const nodeUnit = factorUnitOf(g.raw, node);
        if (unitsConflict(a?.unit, nodeUnit) !== null) {
          unitMismatch.push({ label: node.label, value: a?.value, unit: String(a?.unit), factor_unit: String(nodeUnit) });
          continue;
        }
        /**
         * ⛔ A CORRECTION LANDS FIRST TIME (`relative-figure.ts`; DL lease 5907111773, AIQ 5907128716 + 5907227964). Served
         * share build `2366977` (R3 `ccalt` r1): "25%" came as `{25, "%"}` for a 0–1 `proportion` factor, the card read
         * "0.2% → 25%" and the press was refused at write. A percentage there is read in the factor's frame (25% → 0.25); a
         * "%" figure of 1 or less is ambiguous (0.5% or 50%?) and asked; a figure the user compared the OTHER way from what
         * the factor measures ("AWS costs 25% more" against a GCP saving) is no figure for it by any author, and asked.
         */
        const shareFactor = isShareFactor(nodeUnit, node.observed_state);
        const frame = inShareFrame(Number(a?.value), a?.unit, nodeUnit, node.observed_state);
        if (frame.kind === 'ambiguous') {
          scaleAmbiguous.push({ label: node.label, value: Number(a?.value), as_percent: frame.asPercent, as_share: frame.asShare });
          continue;
        }
        if (frame.kind === 'converted') a = { ...a, value: frame.value, unit: frame.unit };
        // The proposed figure read at ITS OWN place first (P0 PARTNER CR 5907476130): "25% cheaper …, though support would be
        // 10% more expensive" is the user's 25%; only a figure not written the factor's way ("25% more", or a 20% worked out
        // from it) falls to the whole-message check.
        if (shareFactor && relativeFigureAgainst(node.label, ctx.user_text, Number(a.value) * 100) !== 'same'
          && relativeFigureAgainst(node.label, ctx.user_text) === 'opposite') {
          directionConflict.push({ label: node.label });
          continue;
        }
        /**
         * ⛔ THE APPROVAL MUST SHOW THE USER'S OWN NUMBER, NOT THE MODEL'S DIVISOR
         * (Codex 5810763729 item 1). `observed_state.value` is the number read against
         * the factor's frame — on a `cap: 100` factor the user's 70 is stored as 0.7.
         * Carried straight into `replaces`, the approval chip read "0.7 → 50", which is
         * not a sentence about anything the user said. The native figure is `raw_value`
         * when the frame recorded one, else the model value multiplied back up by the
         * cap, else the value itself (an unframed factor stores native already).
         */
        const existing = nativeStartingValue(node.observed_state as never);
        /**
         * ⭐ THE ONE CASE THE BLANKET REFUSAL WAS NEVER MEANT TO CATCH.
         *
         * The refusal above this exists to stop the MODEL replacing somebody's
         * number with a guess "under cover of adopting assumptions". That is
         * still refused and the wording of that rule has not moved.
         *
         * But the product's whole sensitivity loop asks the user to do exactly
         * the opposite act: the analysis names the assumption the ordering turns
         * on and invites them to change it and see how much it matters. An
         * assumption the ordering is sensitive to ALWAYS already holds a value —
         * otherwise it could not drive an ordering — so every such request landed
         * on the blanket refusal and the invitation could never be honoured.
         *
         * `revise` is opt-in PER FACTOR and the tool tells the model it may set
         * it only when the user has just asked for that factor to be changed and
         * named the number. The old value is carried into `replaces` so the
         * approval the user is shown says what it is replacing: consent stays
         * informed, and the write still goes through authorise_change like any
         * other. Nothing here writes.
         */
        const userNamedThisChange = a?.revise === true;
        if (typeof existing === 'number' && !userNamedThisChange) {
          occupied.push({ label: node.label, current_value: existing });  // native, per item 1
          continue;
        }
        if (!Number.isFinite(Number(a?.value))) { unresolved.push(node.label); continue; }
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        // ⛔ A revision is the user's only when they WROTE the figure (`stated-by-user.ts`); else it is Olumi's. Its owner is
        // read the add-factor door's way (`newFactorScopeIn`: rivals + strict): under the plain reading, served journey E's
        // "Senior engineers cost £120k a year each and juniors £65k a year each" was Olumi's for both salaries (5d73351, 2/2).
        const ownerScope = newFactorScopeIn(g, node.label, String(a?.unit ?? nodeUnit ?? ''), []);
        // A comparison whose direction or concept cannot be read credits nobody: Olumi's, and said (AIQ 5907227964).
        const readable = !shareFactor || relativeFigureAgainst(node.label, ctx.user_text, Number(a.value) * 100) !== 'unknown';
        const writtenAbout = readable && figureTheUserWroteFor(Number(a.value), a?.unit ?? nodeUnit, ctx.user_text, ownerScope);
        // ⛔ HUMAN CONTROL IS THE PROVENANCE GATE, here too (the DL's ruling on #2235 for the add-factor door; AIQ #75
        // 5902528686). Served cut-costs (DL alt-B r0/r1, CEE 1f9d769): "Our team's quote shows GCP would be about 25% cheaper
        // than AWS for our workload." revised the discount factor to 0.25, the user's exact figure, and stored it as
        // `user_assumption` ("Olumi's suggestion the user accepted"), replied "recorded as Olumi's assumption": word proximity
        // read "AWS … workload" after the comparative as another quantity's. A revision the user asked for, whose figure is
        // the ONE written in this message, is theirs when the approval shows the pairing with their own sentence, verbatim:
        // their Yes makes it theirs (AIQ 5902884139). A figure Olumi worked out from it (£112.50 per point) is not written,
        // so it stays Olumi's.
        // ONE figure written and ONE value proposed: no swap among the user's figures is possible, and the card shows the
        // one pairing. With two figures or more the strict matcher decides, as before (journey E's salaries: a swap is
        // never theirs, `revise-door-same-matcher`).
        // ⛔ "ONE WRITTEN IN THIS MESSAGE" MEANS THIS MESSAGE (MG SUCCESSOR #75 5911974162; served #2359 row on 660befa4):
        // counted over the session's typed words, the brief's own figures (£45k, 20%, 2 weeks) made every later revision
        // Olumi's, and so did the user's "Yes, use 25%." (their 25% written twice). The route binds THIS turn's typed
        // message (`user_turn_text`, never a chip's text); with none, the session's words are read exactly as before.
        const turnWords = ctx.user_turn_text ?? ctx.user_text;
        const soleFigure = input.length === 1 && figuresWrittenIn(turnWords) === 1;
        // And nothing BESIDE the figure names another quantity (`nearOnly`): "Keep salary spend under £400k" is the limit's,
        // "our MRR is £12,000" is MRR's, never a revised salary or price, card or not.
        const quote = readable && !writtenAbout && soleFigure && typeof existing === 'number'
          && figureTheUserWroteFor(Number(a.value), a?.unit ?? nodeUnit, turnWords, { ...ownerScope, nearOnly: true })
          ? quoteOfFigure(Number(a.value), a?.unit ?? nodeUnit, turnWords) : null;
        if (statementOrigin(writtenAbout || quote !== null,
          figureTheUserWrote(Number(a.value), a?.unit ?? nodeUnit, ctx.unverified_user_text)
          || figureTheUserWrote(Number(a.value), a?.unit ?? nodeUnit, g.brief_text), ctx.user_text_complete, a.user_stated === false && a.revise !== true) === 'unknown') {
          return { ok: false, mutated: false, refusal: 'origin_unknown', detail: UNKNOWN_ORIGIN_DETAIL };
        }
        /**
         * ⭐ S2 (DL 14 Oct, SCIENCE's marketing capture; PL 18:41Z): words the user said ABOUT this factor ("I'm not that
         * experienced with marketing") are kept, quoted, as theirs. They are never turned into a number of theirs: the figure
         * is Olumi's own estimate from them, labelled and press-only, verified by the one shared contract.
         */
        let described: { source: string; quote: string } | undefined;
        if (a?.user_stated === false && Array.isArray(a?.statements)) {
          const v = verifyStatements(a.statements, { now: ctx.user_turn_text, conversation: ctx.user_text,
            unverified: [ctx.unverified_user_text, g.brief_text].filter((t) => typeof t === 'string').join('\n') },
          { subject: { quantity: 'level_today', node_id: node.id }, unit: '', forms: ['describes'], figuresIn: () => [] });
          if (v.kind === 'refused') {
            return { ok: false, mutated: false, refusal: v.refusal === 'origin_unknown' ? 'origin_unknown' : 'description_not_stated',
              detail: v.refusal === 'origin_unknown' ? UNKNOWN_ORIGIN_DETAIL : v.detail };
          }
          described = { source: v.statements[0]!.source, quote: v.statements[0]!.quote };
        }
        adopted.push({
          id: node.id, label: node.label,
          ...(described !== undefined ? { described } : {}),
          value: Number(a.value), unit: String(a?.unit ?? ''), basis: String(a?.basis ?? ''),
          ...(typeof existing === 'number' ? { replaces: existing } : {}),
          userWrote: writtenAbout || quote !== null,
          ...(quote !== null ? { quote } : {}),
          // A 0–1 share the user wrote as a percentage ("25%" for 0.25) is shown in their units: "15% → 25%" (AIQ 5902884139).
          ...(quote !== null && Math.abs(Number(a.value)) <= 1 && figureTheUserWrote(Number(a.value) * 100, '%', turnWords) ? { asPercent: true as const } : {}),
        });
      }

      if (riskRanges.length > 0) {
        if (adopted.length > 0 || riskRanges.length > 1) {
          return { ok: false, mutated: false, refusal: 'risk_occurrence_with_other_changes', detail: RISK_OCCURRENCE_ALONE_DETAIL };
        }
        return proposeRiskOccurrence(ctx, g, riskRanges[0]!);
      }
      // ⛔ A keep is its own approval: "accept Olumi's estimate" and "change this figure" are different acts, and one card
      // saying both would let one Yes stand for either. The Agent proposes them in separate calls.
      if (adopted.some((x) => x.kept) && adopted.some((x) => !x.kept)) {
        return { ok: false, mutated: false, refusal: 'keep_with_other_changes',
          detail: 'Keeping Olumi\u2019s estimate is its own approval. Nothing was proposed: propose the figures to keep in one call '
            + 'and any other values in another.' };
      }
      if (adopted.length === 0) {
        return {
          ok: false, mutated: false, refusal: 'nothing_to_adopt',
          ...(notKeepable.length > 0 ? { not_keepable: notKeepable, not_keepable_note: NOT_KEEPABLE_NOTE } : {}),
          unresolved_labels: unresolved, already_valued: occupied,
          ...(notAFactor.length > 0 ? { not_a_factor: notAFactor } : {}),
          ...(riskRangeNeeded.length > 0 ? { risk_occurrence_needed: riskRangeNeeded, risk_occurrence_note: RISK_OCCURRENCE_NEEDED_NOTE } : {}),
          ...(ambiguous.length > 0 ? { ambiguous_targets: ambiguous, ambiguous_note: AMBIGUOUS_NOTE } : {}),
          ...(unitMismatch.length > 0 ? { unit_mismatch: unitMismatch, unit_mismatch_note: UNIT_MISMATCH_NOTE } : {}),
          ...(scaleAmbiguous.length > 0 ? { scale_ambiguous: scaleAmbiguous, scale_ambiguous_note: SCALE_AMBIGUOUS_NOTE } : {}),
          ...(directionConflict.length > 0 ? { direction_conflict: directionConflict, direction_conflict_note: DIRECTION_CONFLICT_NOTE } : {}),
          detail:
            'None of those could be adopted. Read the state again and use the labels exactly as they appear; ' +
            'factors that already hold a value are left alone.',
        };
      }

      // Sorted by node id so an identical set proposed in a different order is
      // the SAME proposal, not a second one.
      const ordered = [...adopted].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
      // A figure the user WROTE is theirs, a revision or a first value alike (DL ruling, X8: what the user stated is the
      // user's; crediting only revisions stored a typed first figure as Olumi's assumption, a false attribution). Anything
      // else is Olumi's (`valueOpAuthor`). ONE predicate for what is stored, what the card heads it as and what the Agent
      // is told to say, so the words cannot drift from the authorship.
      const usersOwn = (a: { userWrote: boolean }): boolean => a.userWrote;
      const operations: ProposalOperation[] = ordered.map((a) => ({
        op: 'set_factor_value',
        path: a.id,
        value: { value: a.value, unit: a.unit, basis: a.basis, authored_by: usersOwn(a) ? 'user_stated' : 'model_proposed',
          // S2: the user's own statement this figure is confirmed from (the card quotes it; the press makes it theirs), or the
          // words Olumi's estimate is read from (quoted; the figure stays Olumi's).
          ...(a.confirmed !== undefined ? { confirmed_from: a.confirmed } : {}),
          ...(a.described !== undefined ? { described_by: a.described } : {}),
          ...storedFactorDomain(g.nodes.find(n => n.id === a.id)?.observed_state) },
      }));
      /**
       * ⛔ THE APPROVAL MUST SAY WHAT IT REPLACES.
       *
       * A revision and an adoption are different acts and the user is agreeing to
       * a different thing in each case. "Churn = 6%" hides that a number was
       * already there; "Churn: 4% to 6%" does not. The receipt quotes this label,
       * so what was consented to stays legible after the fact.
       */
      const revisions = ordered.filter((a) => typeof a.replaces === 'number');
      const fresh = ordered.filter((a) => typeof a.replaces !== 'number');
      const notWritten = revisions.filter((a) => !a.userWrote);
      const said = (value: number, unit: string) => sayFigureExactly(value, unit) ?? `${value}${unit !== '' ? ' ' + unit : ''}`;
      const withUnit = (a: { value: number; unit: string }) => said(a.value, a.unit);
      const pct = (v: number): string => `${Number((v * 100).toPrecision(6))}%`;
      const describe = (a: { label: string; value: number; unit: string; replaces?: number; quote?: string; asPercent?: true; kept?: true;
        confirmed?: { source: string; quote: string } }) =>
        a.confirmed !== undefined ? `${a.label} = ${sayFigureRead(a.value, a.unit)} today, as you wrote it: “${a.confirmed.source}”`
        : a.kept ? `${a.label} = ${sayFigureRead(a.value, a.unit)}`
        : typeof a.replaces === 'number'
          // The replaced figure is not written: an inexact one is said "about", rounded (DL #2227 follow-up A). A pairing the
          // approval confirms is shown with the user's own sentence (above), in the units they wrote.
          ? a.quote !== undefined
            ? `${a.label}: ${a.asPercent ? `${pct(a.replaces)} \u2192 ${pct(a.value)}` : `${sayFigureRead(a.replaces, a.unit)} \u2192 ${withUnit(a)}`} (your figure, in your words: "${a.quote}")`
            : `${a.label}: ${sayFigureRead(a.replaces, a.unit)} \u2192 ${withUnit(a)}`
          : `${a.label} = ${withUnit(a)}`;
      const kept = ordered.filter((a) => a.kept);
      // A first value the user wrote is RECORDED as theirs, never offered as a starting assumption (`usersOwn`).
      const freshYours = fresh.filter(usersOwn);
      const freshOlumis = fresh.filter((a) => !usersOwn(a));
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
      const acts = [
        ...(revisions.length > 0 ? [`revise ${plural(revisions.length, 'value')}${fresh.length === 0 ? ' you asked to change' : ''}`] : []),
        ...(freshYours.length > 0 ? [`record ${plural(freshYours.length, 'figure')} you gave`] : []),
        ...(freshOlumis.length > 0 ? [`adopt ${plural(freshOlumis.length, 'starting assumption')}`] : []),
      ];
      const actsSaid = acts.length <= 1 ? (acts[0] ?? '') : `${acts.slice(0, -1).join(', ')} and ${acts[acts.length - 1]}`;
      const heading =
        kept.length > 0
          // The figure is unchanged and stays Olumi's; what the Yes records is the user's acceptance (AIQ words).
          ? `Accept Olumi\u2019s estimate${kept.length === 1 ? '' : 's'}, unchanged: `
          : `${actsSaid.charAt(0).toUpperCase()}${actsSaid.slice(1)}: `;
      const allYours = kept.length === 0 && ordered.every(usersOwn);
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations,
        provenance: {
          // Figures the user wrote are theirs, not the model's. Only a proposal made entirely of those may claim it.
          authored_by: allYours ? 'user_stated' : 'model_proposed',
          basis:
            kept.length > 0
              ? KEEP_PROPOSAL_BASIS
              : allYours && fresh.length === 0
              ? 'values the user asked to change, at the figures they gave'
              : allYours
              ? 'figures the user gave, recorded as theirs'
              : 'starting assumptions offered for the user to adopt or correct',
        },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        // The heading distinguishes a revision the user asked for from an assumption
        // offered to them; `leftOutClause` is staging’s disclosure of the labels that
        // were not factors. Both are required — the heading alone drops the disclosure,
        // and staging’s label alone calls a revision an adoption.
        public_label: heading + ordered.map(a => {
          const figure = describe(a);
          // AIE 6141593167: the complete basis belongs on the bound card, beside its figure.
          // Keeping a canonical estimate is retention, not a newly authored estimate.
          return usersOwn(a) || a.kept ? figure
            : `${figure}${a.described !== undefined ? `\nFrom your words: “${a.described.source}” Olumi’s figure from them is its own estimate, not yours.` : ''}`
              + `\nWhy Olumi suggests this (not checked against a source unless one is shown): “${a.basis}”`;
        }).join('; ') + leftOutClause(notAFactor) + ambiguousClause(ambiguous),
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        assumptions: ordered.map((a) => ({
          factor: a.label, value: a.value, unit: a.unit, basis: a.basis,
          ...(typeof a.replaces === 'number' ? { replaces: a.replaces } : {}),
          ...(usersOwn(a) ? { your_figure: true } : {}),
          ...(a.confirmed !== undefined ? { confirms_your_figure: true, from_your_words: a.confirmed.source } : {}),
          ...(a.kept ? { keeps_olumis_estimate: true } : {}),
        })),
        ...(notKeepable.length > 0 ? { not_keepable: notKeepable, not_keepable_note: NOT_KEEPABLE_NOTE } : {}),
        ...(unresolved.length > 0 ? { unresolved_labels: unresolved } : {}),
        ...(occupied.length > 0 ? { left_alone_already_valued: occupied } : {}),
        // Named, but not something a value can be set on (a risk, an outcome, an option): left out,
        // so the user is never asked to approve a value that cannot be saved.
        ...(notAFactor.length > 0 ? { not_a_factor: notAFactor, not_a_factor_note: NOT_A_FACTOR_NOTE } : {}),
        ...(riskRangeNeeded.length > 0 ? { risk_occurrence_needed: riskRangeNeeded, risk_occurrence_note: RISK_OCCURRENCE_NEEDED_NOTE } : {}),
        ...(ambiguous.length > 0 ? { ambiguous_targets: ambiguous, ambiguous_note: AMBIGUOUS_NOTE } : {}),
        ...(unitMismatch.length > 0 ? { unit_mismatch: unitMismatch, unit_mismatch_note: UNIT_MISMATCH_NOTE } : {}),
        ...(scaleAmbiguous.length > 0 ? { scale_ambiguous: scaleAmbiguous, scale_ambiguous_note: SCALE_AMBIGUOUS_NOTE } : {}),
        ...(directionConflict.length > 0 ? { direction_conflict: directionConflict, direction_conflict_note: DIRECTION_CONFLICT_NOTE } : {}),
        ...(notWritten.length > 0 ? {
          not_the_users_figure: notWritten.map((a) => ({ factor: a.label, value: a.value })),
          not_the_users_figure_note: NOT_THE_USERS_FIGURE_NOTE,
        } : {}),
        // ⛔ Served e25d0aa (29 Sep): one note for every value made the Agent call the user's own "3.7%" churn "a model
        // assumption … not a measurement", though it is stored as theirs. The words follow `usersOwn`, value by value.
        note: kept.length > 0 ? KEEP_NOTE : proposalNoteFor(ordered.filter(usersOwn).length, ordered.length),
      };
    },

    /**
     * ⭐ WHAT AN OPTION DOES — the last structural blocker on the journey.
     *
     * ⛔ THE CONSTRAINT THAT DECIDES THIS DESIGN. `option_intervention_edit` is
     * `.strict()` and its `value` is `z.number().min(0).max(1)`, described as
     * "the effect value on the MODEL scale … no unit, no currency and no
     * percentage: the client converts nothing, and the server licenses no
     * raw-unit conversion on this path." A first version of this capability
     * took the user's "£54" and was WITHDRAWN unshipped, because turning it
     * into a number in [0, 1] meant choosing a scale at the moment of writing,
     * which is the fabrication this lane exists to prevent.
     *
     * ⭐ IT IS HONEST NOW ONLY BECAUSE THE FACTOR CARRIES A DECLARED FRAME.
     * Construction publishes `observed_state.cap`, so `raw / cap` READS the
     * user's own number against a range the model already stated and disclosed
     * — a different act from inventing one here. Both numbers are reported.
     *
     * ⛔ AND WITHOUT A FRAME IT REFUSES. A factor with no cap whose value is
     * outside [0, 1] cannot be expressed on this wire at all; saying so is the
     * correct outcome, not picking a denominator.
     */
    /**
     * ⭐ A STARTING POINT IS ONE PROPOSAL, SO ONE "YES" APPLIES ALL OF IT.
     * Composed from the two existing proposers — their validation, frames and
     * refusals are unchanged — then merged into one exact proposal on the SAME
     * base, and the two halves discarded so only the object the user is shown
     * is awaiting approval. See `applyCompound` for how it is applied.
     */
    async proposeStartingPoint(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const assumptions = Array.isArray(args?.assumptions) ? args.assumptions : [];
      const levels = Array.isArray(args?.option_levels) ? args.option_levels : [];
      if (assumptions.length === 0 && levels.length === 0) {
        return { ok: false, mutated: false, refusal: 'empty_proposal', detail: `Nothing was proposed.${EMPTY_PROPOSAL_WORDS}` };
      }
      for (const level of levels) {
        const declaration = parseUnmodelledMechanisms(level?.unmodelled_mechanisms, level != null && Object.hasOwn(level, 'unmodelled_mechanisms'));
        if (declaration.kind === 'invalid') return { ok: false, mutated: false, refusal: declaration.reason, detail: 'Nothing was proposed: every gap declaration must be valid.' };
      }
      // ⛔ A keep is its own approval (`keep_with_other_changes`, CODEX CEE BUDDY 5925846990): never folded into a starting
      // point's one Yes, whose card would call Olumi's kept figure a starting assumption.
      if (assumptions.some((x) => (x as { keep?: unknown } | null)?.keep === true)) {
        return { ok: false, mutated: false, refusal: 'keep_with_other_changes',
          detail: 'Keeping Olumi\u2019s estimate is its own approval. Nothing was proposed: use propose_assumptions with keep for it, '
            + 'and propose the starting point without it.' };
      }
      if (levels.some(level => level != null && Object.hasOwn(level, 'unmodelled_mechanisms'))) {
        const read = await readGraph(ctx.scenario_id);
        if (read === null) return { ok: false, mutated: false, refusal: 'not_found' };
        const optionNodes = { nodes: read.nodes.filter(n => n.kind === 'option') };
        const factorNodes = { nodes: read.nodes.filter(n => n.kind === 'factor') };
        const declarations = levels.flatMap(level => {
          const parsed = parseUnmodelledMechanisms(level?.unmodelled_mechanisms, level != null && Object.hasOwn(level, 'unmodelled_mechanisms'));
          const option = resolveNamed(optionNodes, String(level?.option_label ?? ''), () => true);
          const factor = resolveNamed(factorNodes, String(level?.factor_label ?? ''), () => true);
          return parsed.kind === 'valid' && option.kind === 'one' && factor.kind === 'one'
            ? [{ op: 'set_option_intervention', path: `${option.node.id}::${factor.node.id}`, value: { unmodelled_mechanisms: parsed.mechanisms } }] : [];
        });
        const parsed = parseOptionGapsOfLevelOps(declarations);
        if (parsed.kind === 'invalid') return { ok: false, mutated: false, refusal: parsed.reason, detail: 'Nothing was proposed: repeated option gap declarations must agree.' };
      }
      const a = assumptions.length > 0 ? await caps.proposeAssumptions(ctx, { assumptions }) : null;
      // What THIS starting point would make each factor's starting value — read off the stored
      // value half, never the Agent's arguments — so a held level that only restates it is caught.
      const valueHalf = a !== null && a.ok === true && typeof a.proposal_id === 'string' ? proposals.get(a.proposal_id) : undefined;
      const startingValues = new Map<string, number>();
      for (const o of valueHalf?.operations ?? []) {
        const v = (o.value ?? {}) as { value?: unknown };
        if (o.op === 'set_factor_value' && typeof v.value === 'number') startingValues.set(o.path, v.value);
      }
      const b = levels.length > 0 ? await caps.proposeOptionInterventions(ctx, { interventions: levels }, { startingValues }) : null;
      if (b?.refusal === 'conflicting_option_gap_declarations') {
        if (valueHalf !== undefined) proposals.discard(valueHalf.proposal_id);
        return b;
      }
      const refused = {
        ...(a !== null && a.ok !== true ? { assumptions_refused: a } : {}),
        ...(b !== null && b.ok !== true ? { option_levels_refused: b } : {}),
      };
      const made = [a, b].filter((r): r is ToolResult => r !== null && r.ok === true && typeof r.proposal_id === 'string');
      if (made.length === 0) return { ok: false, mutated: false, refusal: 'nothing_to_propose', ...refused };
      // ⛔ A name that matched two entities travels to the joined result from EITHER half,
      // so the starting point never looks complete at the moment of consent.
      const ambiguousTargets = [a, b].flatMap((r) => (r !== null && Array.isArray(r.ambiguous_targets) ? r.ambiguous_targets : []));
      const ambiguity = ambiguousTargets.length > 0 ? { ambiguous_targets: ambiguousTargets, ambiguous_note: AMBIGUOUS_NOTE } : {};
      // Only one half could be proposed: it is an ordinary proposal already.
      if (made.length === 1) {
        const only = proposals.get(made[0].proposal_id as string);
        const missing = await missingPairs(ctx, levelPathsOf(only !== undefined ? [only] : []));
        if (missing === null || missing.length > 0) {
          if (only !== undefined) proposals.discard(only.proposal_id);
          if (missing === null) return { ok: false, mutated: false, refusal: 'not_found' };
          return incompleteStartingPoint(missing, {
            assumptions: a?.assumptions ?? [], option_levels: b?.interventions ?? [],
            ...(b !== null && Array.isArray(b.not_linked) ? { not_linked: b.not_linked } : {}),
            ...(b !== null && Array.isArray(b.levels_not_accepted) ? { levels_not_accepted: b.levels_not_accepted } : {}),
            ...(a !== null && Array.isArray(a.not_a_factor) ? { not_a_factor: a.not_a_factor } : {}), ...ambiguity, ...refused,
          });
        }
        const ifApproved = await readinessIfApplied(ctx, only?.operations ?? []);
        return { ...made[0], ...ambiguity, ...refused, readiness_if_approved: ifApproved,
          ...(stillBlockedNote(ifApproved) !== '' ? { note: `${String(made[0].note ?? '')}${stillBlockedNote(ifApproved)}` } : {}) };
      }
      const halves = made.map((r) => proposals.get(r.proposal_id as string)).filter((p): p is StructuredProposal => p !== undefined);
      if (halves.length !== 2 || halves[0].base_graph_identity_hash !== halves[1].base_graph_identity_hash) {
        for (const h of halves) proposals.discard(h.proposal_id);
        return { ok: false, mutated: false, refusal: 'model_changed_while_proposing', detail: 'The model changed while this was being put together. Read the state again and propose once more.' };
      }
      const missing = await missingPairs(ctx, levelPathsOf(halves));
      if (missing === null || missing.length > 0) {
        for (const h of halves) proposals.discard(h.proposal_id);
        if (missing === null) return { ok: false, mutated: false, refusal: 'not_found' };
        return incompleteStartingPoint(missing, {
          assumptions: a?.assumptions ?? [], option_levels: b?.interventions ?? [],
          ...(b !== null && Array.isArray(b.not_linked) ? { not_linked: b.not_linked } : {}),
          ...(b !== null && Array.isArray(b.levels_not_accepted) ? { levels_not_accepted: b.levels_not_accepted } : {}),
          ...(a !== null && Array.isArray(a.not_a_factor) ? { not_a_factor: a.not_a_factor } : {}), ...ambiguity, ...refused,
        });
      }
      const compound = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: halves[0].base_graph_identity_hash,
        operations: [...halves[0].operations, ...halves[1].operations],
        provenance: { authored_by: 'model_proposed', basis: STARTING_POINT_BASIS },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: `${halves[0].public_label}; ${halves[1].public_label}`,
      });
      replaceEarlierStartingPoints(ctx);
      proposals.put(compound);
      for (const h of halves) proposals.discard(h.proposal_id);
      const ifApproved = await readinessIfApplied(ctx, compound.operations);
      return {
        readiness_if_approved: ifApproved,
        ok: true, mutated: false,
        proposal_id: compound.proposal_id,
        public_label: compound.public_label,
        base_revision: compound.base_graph_identity_hash,
        assumptions: a?.assumptions ?? [],
        option_levels: b?.interventions ?? [],
        // Joined proposals keep the child level handler's optional-field disclosures in the model's result.
        ...(b !== null && Array.isArray(b.ranges_not_recorded) ? {
          ...(Array.isArray(b.ranges_not_recorded) ? { ranges_not_recorded: b.ranges_not_recorded } : {}),
          detail: b.detail,
        } : {}),
        // Levels the proposer LEFT OUT because the option is not wired to that
        // factor — the Agent must say so and offer a level it CAN record.
        ...(b !== null && Array.isArray(b.not_linked) ? { not_linked: b.not_linked, not_linked_note: b.not_linked_note } : {}),
        ...(b !== null && Array.isArray(b.levels_not_accepted) ? { levels_not_accepted: b.levels_not_accepted } : {}),
        ...(b !== null && Array.isArray(b.not_the_users_figure) ? { not_the_users_figure: b.not_the_users_figure, not_the_users_figure_note: NOT_THE_USERS_FIGURE_NOTE } : {}),
        // ⛔ What the user NAMED but this proposal leaves out, carried to the joined result (independent
        // review of #1800, 5806926323): when both halves succeed, the value half's omission otherwise
        // never reached the Agent, and the starting point looked complete at the moment of consent.
        ...(a !== null && Array.isArray(a.not_a_factor) ? { not_a_factor: a.not_a_factor, not_a_factor_note: NOT_A_FACTOR_NOTE } : {}),
        ...ambiguity,
        ...refused,
        // The same rule as `propose_assumptions`: a level the user gave (`stated_by: 'user'`) or a value marked
        // `your_figure` is said as theirs; the rest are assumptions. With none of the user's, the note is unchanged.
        note: startingPointNoteFor(usersFiguresIn(a?.assumptions, b?.interventions)) + stillBlockedNote(ifApproved),
      };
    },

    async proposeOptionInterventions(ctx, args, internal): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const input = Array.isArray(args?.interventions) ? args.interventions : [];
      if (input.length === 0) {
        return { ok: false, mutated: false, refusal: 'empty_proposal', detail: `No interventions were given.${EMPTY_PROPOSAL_WORDS}` };
      }
      const declarations = input.map(i => parseUnmodelledMechanisms(i?.unmodelled_mechanisms, i != null && Object.hasOwn(i, 'unmodelled_mechanisms')));
      const invalid = declarations.find(d => d.kind === 'invalid');
      if (invalid?.kind === 'invalid') return { ok: false, mutated: false, refusal: invalid.reason, detail: 'Nothing was proposed: every gap declaration must be valid.' };
      const declaredOps: ProposalOperation[] = [];
      // Resolved within the kind first (a label on a node of another kind never shadows the
      // right one), then by `resolveNamed`: an id is identity, a label beats a description,
      // and two nodes of the kind answering to one name are AMBIGUOUS, never "the first".
      const optionNodes = { nodes: g.nodes.filter((n) => n.kind === 'option') };
      const factorNodes = { nodes: g.nodes.filter((n) => n.kind === 'factor') };
      const ambiguous: AmbiguousTarget[] = [];
      const ambiguousSeen = new Set<string>();
      const held = heldStatusQuoPairs(g);

      const unresolved: string[] = [];
      const unframed: { factor: string; detail: string }[] = [];
      const unchanged: string[] = [];
      /**
       * ⛔ EVERY SUPPLIED LEVEL THAT IS NOT ACCEPTED, WITH ITS OPTION AND WHY.
       * MEASURED on served d1829c5 (journey J1): the starting point was refused
       * `incomplete_starting_point` three times in one turn because a level the
       * Agent DID supply was dropped here, and the refusal named only the pair
       * still missing — so the Agent re-sent the same value. The reason travels
       * with the pair, so the next attempt can correct it.
       */
      const notAccepted: { option: string; factor: string; value: unknown; reason: string }[] = [];
      /** Levels the Agent marked `user_stated` that the user never wrote: recorded as Olumi's, never as theirs. */
      const notWrittenByUser: { option: string; factor: string; value: unknown }[] = [];
      const unitDiffers: { option: string; factor: string; value: unknown; declared_unit: string; sent_unit: string; detail: string }[] = [];
      const rangesNotRecorded: { option: string; factor: string; reason: string }[] = [];
      const seen = new Set<string>();
      const set: {
        option: { id: string; label: string }; factor: { id: string; label: string };
        raw: number; normalised: number; cap: number | null; unit: string; basis: string;
        derivedFrame: number | null;
        /** The user GAVE this level (`user_stated`); otherwise it is Olumi's proposal. */
        userStated: boolean;
        // The option is not yet linked to this factor: the link is added in the same change, before the level.
        needsLink: boolean;
        /** The user's likely range for this level, raw units (TEMPORAL). */
        likelyRange?: { low: number; high: number };
        mechanisms?: readonly string[];
        gapOperands?: Record<string, unknown>;
      }[] = [];

      for (const [index, i] of input.entries()) {
        let declaration = declarations[index]!;
        const asGiven = { option: String(i?.option_label ?? ''), factor: String(i?.factor_label ?? ''), value: i?.value };
        const optionRes = resolveNamed(optionNodes, asGiven.option, () => true);
        const factorRes = resolveNamed(factorNodes, asGiven.factor, () => true);
        if (optionRes.kind === 'ambiguous' || factorRes.kind === 'ambiguous') {
          // ⛔ No level for this pair, and no guess at which entity was meant.
          const which: string[] = [];
          for (const [kind, requested, res] of [['option', asGiven.option, optionRes], ['factor', asGiven.factor, factorRes]] as const) {
            if (res.kind !== 'ambiguous') continue;
            which.push(`${kind} "${requested}"`);
            if (!ambiguousSeen.has(`${kind}\u0000${requested}`)) {
              ambiguousSeen.add(`${kind}\u0000${requested}`);
              ambiguous.push(describeAmbiguity(g, requested, res.candidates));
            }
          }
          notAccepted.push({
            ...asGiven,
            reason: `More than one ${which.join(' and more than one ')} is in the model, so this level was left out. Ask the user which one they mean, then propose it again passing that entity\u2019s id in place of its label.`,
          });
          continue;
        }
        const option = optionRes.kind === 'one' ? optionRes.node : undefined;
        const factor = factorRes.kind === 'one' ? factorRes.node : undefined;
        if (option === undefined) {
          unresolved.push(`option "${asGiven.option}"`);
          notAccepted.push({ ...asGiven, reason: `No option in the model is labelled "${asGiven.option}". Use an option label exactly as get_canonical_state gives it.` });
          continue;
        }
        if (factor === undefined) {
          unresolved.push(`factor "${asGiven.factor}"`);
          notAccepted.push({ ...asGiven, option: option.label, reason: `No factor in the model is labelled "${asGiven.factor}". Use a factor label exactly as get_canonical_state gives it.` });
          continue;
        }
        /**
         * ⛔ A LEVEL CAN ONLY BE SET ON A FACTOR THE OPTION IS WIRED TO — the
         * write's own rule, applied at PROPOSAL time. MEASURED on served
         * 0f2f3b87 (journey witness, scenario 1e7649c2): the Agent proposed
         * "Internal Lead Trial -> Tech lead headcount", an option with no link
         * to that factor. This proposer accepted it, `option_intervention_edit`
         * then refused it (`unresolved_effect_relationship`, same reader:
         * `linkedFactorsOf`), and because a compound's level chain stops at its
         * first refusal, NONE of that approval's levels landed — the user
         * approved a set that could never be written. Excluded here, with the
         * factors the option DOES act on, so the Agent corrects it before the
         * user is asked to approve anything.
         */
        /**
         * ⭐ A LEVEL BRINGS ITS LINK (DL #70 5846924842, served BF5 on 1f8327c). Dropping this pair made the Agent propose
         * the link alone and promise the level ("once it is approved, I can record £54") — a promise no proposal kept,
         * and the options stayed level-less. The level goes in the SAME proposal as the option → factor link it needs;
         * on approval the link is written first and the level on the revision that write reported (`applyCompound`).
         */
        const needsLink = !linkedFactorsOf(g as never, option.id).some((f) => f.id === factor.id);
        const gapOperands = declaration.kind === 'valid' ? optionGapOperands(g.raw, option.id) : undefined;
        if (declaration.kind === 'valid') {
          if (gapOperands == null) return { ok: false, mutated: false, refusal: 'gap_operands_unavailable' };
          // [] still clears existing gaps; against empty carriers it declares no change.
          if (declaration.mechanisms.length === 0 && optionGapOperandsAreEmpty(gapOperands)) declaration = { kind: 'absent' };
        }
        if (declaration.kind === 'valid') {
          declaredOps.push({ op: 'set_option_intervention', path: `${option.id}::${factor.id}`, value: { unmodelled_mechanisms: declaration.mechanisms } });
        }
        // ⛔ A held status quo takes no level the AGENT supplies (`heldStatusQuoPairs`):
        // not accepted, never an operation. ⭐ The USER's own correction is the
        // exception (independent review of #1849, 5820560331): the Agent is told to
        // say the user can correct the held reading, so what they say must be
        // recordable. `user_stated` is opt-in per level, on the same terms as
        // `revise` — only when the user said it and gave the level — and it still
        // reaches the user as a proposal to approve, never a write.
        /**
         * ⛔ `user_stated` is the Agent's claim; it stands only when the user WROTE the figure (`stated-by-user.ts`).
         * Unwritten, the level is Olumi's estimate (recorded as such, and said), and on a held pair it is not a level.
         */
        const claimedByUser = i?.user_stated === true;
        // The unit the user wrote the figure in (a NEW factor declares none) is STORED with the level, never used to
        // ground it: a model-supplied unit ("% monthly churn rate") would name away the entity the guard reads
        // (Canonical #2025 B1). Grounding reads only the factor's DECLARED unit; the rate after the figure is skipped anyway.
        const statedUnit = typeof i?.unit === 'string' && i.unit.trim() !== '' ? i.unit.trim() : undefined;
        const declaredUnit = factorUnitOf(g.raw, factor);
        const sentUnitKey = recognisedLevelUnitKey(statedUnit);
        const declaredUnitKey = recognisedLevelUnitKey(declaredUnit);
        if (statedUnit !== undefined && declaredUnit !== undefined
          && sentUnitKey !== undefined && declaredUnitKey !== undefined && sentUnitKey !== declaredUnitKey) {
          unitDiffers.push({ option: option.label, factor: factor.label, value: i?.value,
            declared_unit: declaredUnit, sent_unit: statedUnit,
            detail: UNIT_DIFFERS_FROM_DECLARED_DETAIL(option.label, declaredUnit, statedUnit) });
          continue;
        }
        const raw = Number(i?.value);
        /**
         * TEMPORAL (B6's ask, #2384; R3 #75 5914230653): the user's LIKELY RANGE for this level, decided from the TYPED
         * arguments only (Codex CR 5963331228 P1: no parsing of the user's words). Both ends; the reading the Agent took
         * (`range_meaning`: only `likely_range` is recorded, so a 95% interval, a min–max or a bound is never stored as
         * one); that the USER gave it (`range_user_stated`); beside a level they gave; the level inside it. The user then
         * sees the range as they stated it and, separately, Olumi's assumption that about one in four falls below it and one in
         * four above (C2, AIE 6180618773 row 2): the quartile fit is Olumi's disclosed approximation, adopted by the press, never
         * the user's quartiles, and approval adopts it without making it theirs. An invalid optional range is left out and
         * disclosed; its level follows ordinary grounding.
         */
        const hasLow = i?.likely_low !== undefined;
        const hasHigh = i?.likely_high !== undefined;
        const noRangeDeclared = i?.range_user_stated !== true
          && ((!hasLow && !hasHigh) || (i?.likely_low === 0 && i?.likely_high === 0));
        let likelyRange: { low: number; high: number } | undefined;
        if (!noRangeDeclared && (hasLow || hasHigh || i?.range_meaning !== undefined || i?.range_user_stated === true)) {
          const low = Number(i?.likely_low);
          const high = Number(i?.likely_high);
          const why = !hasLow || !hasHigh ? 'a likely range needs both its low and its high end'
            : !(Number.isFinite(low) && Number.isFinite(high) && low > 0 && high > low) ? 'a likely range needs a positive low end below its high end'
            : i?.range_user_stated !== true ? 'a range is recorded only when the user gave it (range_user_stated), never one Olumi proposed'
            : i?.range_meaning !== 'likely_range'
              ? `Olumi records only a plain likely range; a range read as ${typeof i?.range_meaning === 'string' ? `"${i.range_meaning}"` : 'nothing stated'} is a different statement and is not stored as one`
            : !claimedByUser ? 'a likely range is recorded only beside a level the user gave (user_stated)'
            : raw < low || raw > high ? `${raw} lies outside the likely range ${low}–${high} it was given with`
            : null;
          if (why !== null) {
            rangesNotRecorded.push({ option: option.label, factor: factor.label,
              reason: `No likely range was recorded: ${why}.`
                + (i?.range_user_stated === true ? ' Ask the user to restate their likely range in their own words, then propose it again.' : '') });
          } else {
            likelyRange = { low, high };
          }
        }

        // A rejected range has no bearing on the ordinary level or its authorship.
        const userWrote = claimedByUser && (likelyRange !== undefined
          || figureTheUserWroteFor(raw, factorUnitOf(g.raw, factor), ctx.user_text, scopeIn(g, factor.label, option.label)));
        if (statementOrigin(userWrote, figureTheUserWrote(raw, factorUnitOf(g.raw, factor), ctx.unverified_user_text)
          || figureTheUserWrote(raw, factorUnitOf(g.raw, factor), g.brief_text), ctx.user_text_complete, i.user_stated === false) === 'unknown') {
          return { ok: false, mutated: false, refusal: 'origin_unknown', detail: UNKNOWN_ORIGIN_DETAIL };
        }
        if (claimedByUser && !userWrote) notWrittenByUser.push({ option: option.label, factor: factor.label, value: i?.value });
        if (held.has(`${option.id}::${factor.id}`) && !userWrote) {
          notAccepted.push({
            option: option.label, factor: factor.label, value: i?.value,
            reason: claimedByUser
              ? `${option.label} is held at its starting values, and ${String(i?.value)} is not a figure the user wrote, so no level is recorded for ${factor.label}. Leave it out; never send a figure as the user's unless they wrote it.`
              : `${option.label} is held at its starting values — carrying on as now sets no level, so none is recorded for ${factor.label}. Leave it out, unless the user themselves said carrying on changes ${factor.label} and gave the level: then send it with user_stated: true.`,
          });
          continue;
        }
        if (!Number.isFinite(raw)) {
          unresolved.push(`${option.label} -> ${factor.label} (no value)`);
          notAccepted.push({ option: option.label, factor: factor.label, value: i?.value, reason: 'No numeric value was given.' });
          continue;
        }

        const os = (factor.observed_state ?? {}) as { cap?: unknown; unit?: unknown };
        /**
         * ⭐ THE STORED RANGE WINS OVER ONE DERIVED FROM THIS FIGURE. A factor
         * built with no baseline carries its range as `scale_frame` (the
         * declared carrier; see `admit-model.ts`), and the option levels
         * already on it were divided by that range. Reading `observed_state`
         * alone missed it, so this derived a second range from the user's
         * number and the two levels on one factor sat on two scales. Measured
         * in the replay of Paul's session (repro/FINDINGS.md, turns 3-4).
         */
        const cap = levelFrameOf(factor);
        let normalised: number;
        let derivedFrame: number | null = null;
        if (cap !== null) {
          normalised = raw / cap;
          if (normalised < 0 || normalised > 1) {
            unframed.push({ factor: factor.label, detail: `${raw} is outside the model's range for this factor (0 to ${cap})` });
            notAccepted.push({
              option: option.label, factor: factor.label, value: raw,
              reason: `${raw} is outside the model's range for this factor (0 to ${cap}). Propose a level within that range, in the same units, as an assumption for the user to correct.`,
            });
            continue;
          }
        } else if (raw >= 0 && raw <= 1) {
          normalised = raw;
        } else if (raw > 1) {
          /**
           * ⭐ DERIVE THE FRAME RATHER THAN REFUSE, and say so.
           *
           * ⛔ MEASURED on the deployed build: this branch USED to refuse, and
           * the refusal was correct in isolation and a dead end in practice.
           * A factor with no VALUE cannot carry a range at construction —
           * `ObservedStateSchema` requires `value`, and a node-level `cap` is
           * stripped by `NodeV3Schema` — so "Feature release availability" and
           * "Price rollout exposure" could never be set by any option, and the
           * comparison could never run. The Agent's advice became "a rebuild is
           * required", which is not something to ask a user for.
           *
           * The frame is taken from the user's own figure and ATTACHED to the
           * factor on authorisation, exactly as the adopted-assumption path
           * already does. Reported below as `ranges_added_for_analysis`.
           */
          derivedFrame = defaultFrameFor(raw);
          normalised = raw / derivedFrame;
        } else {
          const detail =
            `"${factor.label}" has no stated range, and ${raw} cannot be read against one. ` +
            'Nothing here will pick a range on your behalf for a figure like that.';
          unframed.push({ factor: factor.label, detail });
          notAccepted.push({ option: option.label, factor: factor.label, value: raw, reason: detail });
          continue;
        }

        /**
         * ⛔ A HELD STATUS QUO'S STARTING VALUE IS NOT A LEVEL ANYONE STATED (RC #69 5830102377,
         * pre-review 5830132268). Only a `user_stated` level reaches here on a held pair, and that
         * flag is the Agent's. MEASURED on served builds: one "Use as starting assumptions" wrote
         * the held status quo's levels as COPIES of the starting values — hiring c27a `0303ef5`
         * (0.1333 and 0, the values the same starting point proposed), pricing c26 `7f9a16d` (the
         * brief's £49) — and the level writer stamped each `user_specified`: Olumi's figure, or
         * the brief's, recorded as a level the user set. A copy changes nothing today and freezes
         * the figure, so a later correction to the starting value would leave "carrying on as
         * now" behind (`heldStatusQuoPairs`). A DIFFERENT figure is still the user's correction.
         * The starting value is the one this starting point proposes, else the factor's own.
         */
        if (held.has(`${option.id}::${factor.id}`)) {
          const proposed = internal?.startingValues?.get(factor.id);
          const start = proposed ?? nativeStartingValue(os as never);
          const modelStart = proposed === undefined && typeof (os as { value?: unknown }).value === 'number' ? (os as { value: number }).value : undefined;
          if (start !== undefined && (raw === start || (modelStart !== undefined && normalised === modelStart))) {
            notAccepted.push({
              option: option.label, factor: factor.label, value: i?.value,
              reason: `${option.label} already keeps ${factor.label} at its starting value, ${quotable(start)}. Recording that as a level changes nothing today, and would stop carrying on as now from following a later correction to the starting value, so none is recorded. Leave it out.`,
            });
            continue;
          }
        }

        const key = `${option.id}::${factor.id}`;
        if (seen.has(key)) {
          const prior = set.find(level => `${level.option.id}::${level.factor.id}` === key)!;
          const unit = typeof os.unit === 'string' && os.unit !== '' ? os.unit : (statedUnit ?? '');
          if (prior.raw !== raw || prior.normalised !== normalised || prior.cap !== (cap ?? derivedFrame)
            || prior.unit !== unit || prior.userStated !== userWrote || prior.needsLink !== needsLink
            || !isDeepStrictEqual(prior.likelyRange, likelyRange)
            || (declaration.kind === 'valid' && prior.mechanisms !== undefined
              && !isDeepStrictEqual(prior.mechanisms, declaration.mechanisms))) {
            return { ok: false, mutated: false, refusal: 'conflicting_option_gap_declarations',
              detail: 'Nothing was proposed: repeated option levels and their gap statements must agree.' };
          }
          if (declaration.kind === 'valid' && gapOperands != null) {
            prior.mechanisms = declaration.mechanisms; prior.gapOperands = gapOperands;
          }
          continue;
        }
        seen.add(key);
        set.push({
          option: { id: option.id, label: option.label },
          factor: { id: factor.id, label: factor.label },
          raw, normalised, cap: cap ?? derivedFrame, unit: typeof os.unit === 'string' && os.unit !== '' ? os.unit : (statedUnit ?? ''),
          basis: String(i?.basis ?? ''), derivedFrame, userStated: userWrote, needsLink,
          ...(likelyRange !== undefined ? { likelyRange } : {}),
          ...(declaration.kind === 'valid' && gapOperands != null ? { mechanisms: declaration.mechanisms, gapOperands } : {}),
        });
      }

      const declaredGaps = parseOptionGapsOfLevelOps(declaredOps);
      if (declaredGaps.kind === 'invalid') return { ok: false, mutated: false, refusal: declaredGaps.reason, detail: 'Nothing was proposed: repeated option gap declarations must agree.' };

      // Validate the whole resolved cohort before dropping unchanged, undeclared levels.
      const changed = set.filter(level => {
        const option = optionNodes.nodes.find(node => node.id === level.option.id)!;
        const current = (option.interventions ?? {})[level.factor.id] as { value?: unknown; range?: Record<string, unknown> } | number | undefined;
        const currentValue = typeof current === 'number' ? current : current?.value;
        const currentRange = typeof current === 'object' ? current?.range : undefined;
        const rangeMoves = level.likelyRange !== undefined && !(currentRange?.low === level.likelyRange.low
          && currentRange?.high === level.likelyRange.high && currentRange?.meaning === 'likely_range'
          && currentRange?.source === 'user_specified');
        if ((currentValue === level.normalised || currentValue === level.raw) && !rangeMoves && level.mechanisms === undefined) {
          unchanged.push(`${level.option.label} already sets ${level.factor.label} to ${String(currentValue)}`);
          return false;
        }
        return true;
      });
      if (changed.length === 0) {
        return {
          ok: false, mutated: false, refusal: unitDiffers.length > 0 ? 'unit_differs_from_declared' : 'nothing_to_set',
          ...(unitDiffers.length > 0 ? { unit_differs: unitDiffers } : {}),
          ...(unresolved.length > 0 ? { unresolved } : {}),
          ...(unframed.length > 0 ? { no_stated_range: unframed } : {}),
          ...(unchanged.length > 0 ? { already_set: unchanged } : {}),
          ...(notAccepted.length > 0 ? { levels_not_accepted: notAccepted } : {}),
          ...(notWrittenByUser.length > 0 ? { not_the_users_figure: notWrittenByUser, not_the_users_figure_note: NOT_THE_USERS_FIGURE_NOTE } : {}),
          ...(ambiguous.length > 0 ? { ambiguous_targets: ambiguous, ambiguous_note: AMBIGUOUS_NOTE } : {}),
          ...(rangesNotRecorded.length > 0 ? { ranges_not_recorded: rangesNotRecorded } : {}),
          detail: (unitDiffers.length > 0 ? unitDiffers.map(r => r.detail).join(' ')
            : 'Nothing could be recorded. Tell the user exactly which of these it was and why.')
            + rangesNotRecorded.map(r => ` ${r.option} / ${r.factor}: ${r.reason}`).join(''),
        };
      }

      const ordered = [...changed].sort((x, y) =>
        `${x.option.id}::${x.factor.id}` < `${y.option.id}::${y.factor.id}` ? -1 : 1);
      // The links the levels need come first; each is written before any level (`applyCompound` step 2b).
      const linkOps: ProposalOperation[] = ordered.filter((i) => i.needsLink)
        .map((i) => ({ op: 'add_edge', path: `${i.option.id}::${i.factor.id}`, value: { link_for_level: true } }));
      const operations: ProposalOperation[] = [...linkOps, ...ordered.map((i): ProposalOperation => ({
        op: 'set_option_intervention',
        path: `${i.option.id}::${i.factor.id}`,
        value: {
          normalised: i.normalised, raw: i.raw, cap: i.cap, basis: i.basis, derived_frame: i.derivedFrame,
          ...(i.unit !== '' ? { unit: i.unit } : {}),
          ...(i.likelyRange !== undefined ? { likely_range: i.likelyRange } : {}),
          // Per level, like `valueOpAuthor`: whose level this is travels to the writer (`levelOpAuthor`).
          authored_by: i.userStated ? 'user_stated' : 'model_proposed',
          ...(i.mechanisms !== undefined ? { unmodelled_mechanisms: i.mechanisms, gap_operands: i.gapOperands } : {}),
        },
      }))];
      const gaps = parseOptionGapsOfLevelOps(operations);
      if (gaps.kind === 'invalid') return { ok: false, mutated: false, refusal: gaps.reason };
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations,
        provenance: { authored_by: 'model_proposed', basis: 'what each option does, for the user to confirm or correct' },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label:
          ordered.map((i) => `${i.option.label} ${i.needsLink ? `acts on ${i.factor.label} (a new link) and sets it` : `sets ${i.factor.label}`} to ${sayFigureExactly(i.raw, i.unit) ?? `${i.raw}${i.unit !== '' ? ' ' + i.unit : ''}`}`
            // TEMPORAL (AIQ 5909998288 / 5914439702): the reading is part of what the user approves, in their units.
            + (i.likelyRange !== undefined ? statedRangeAssumptionWords(likelyBound(i.likelyRange.low, i.unit), likelyBound(i.likelyRange.high, i.unit)) : '')).join('; ') +
          ambiguousClause(ambiguous) +
          gaps.declarations.map(d => `; ${optionGapApprovalWords(optionNodes.nodes.find(n => n.id === d.optionId)!.label, d.mechanisms, optionGapOperands(g.raw, d.optionId)!)}`).join(''),
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        interventions: ordered.map((i) => ({
          option: i.option.label, factor: i.factor.label,
          value: i.raw, unit: i.unit,
          // Both numbers, always. The user approves the one they said.
          recorded_on_model_scale: i.normalised,
          model_range: i.cap,
          ...(i.derivedFrame !== null ? { range_taken_from_your_figure: i.derivedFrame } : {}),
          ...(i.needsLink ? { adds_the_link: true } : {}),
          ...(i.likelyRange !== undefined ? { likely_range: i.likelyRange } : {}),
          basis: i.basis,
          // Whose level this is, typed — the same flag the writer stamps (`authored_by` above). The one-call reply reads it.
          stated_by: i.userStated ? 'user' : 'olumi_estimate',
        })),
        ...(unresolved.length > 0 ? { unresolved } : {}),
        ...(linkOps.length > 0 ? {
          adds_links_note: 'Some levels are on a factor the option was not yet linked to: this ONE change also adds that link (marked adds_the_link), '
            + 'and the level is recorded right after it. Say so plainly. Never tell the user a level will be recorded later: it is in this change.',
        } : {}),
        ...(unframed.length > 0 ? { no_stated_range: unframed } : {}),
        ...(unchanged.length > 0 ? { already_set: unchanged } : {}),
        ...(notAccepted.length > 0 ? { levels_not_accepted: notAccepted } : {}),
        ...(notWrittenByUser.length > 0 ? { not_the_users_figure: notWrittenByUser, not_the_users_figure_note: NOT_THE_USERS_FIGURE_NOTE } : {}),
        ...(ambiguous.length > 0 ? { ambiguous_targets: ambiguous, ambiguous_note: AMBIGUOUS_NOTE } : {}),
        ...(rangesNotRecorded.length > 0 ? {
          ranges_not_recorded: rangesNotRecorded,
          detail: rangesNotRecorded.map(r => `${r.option} / ${r.factor}: ${r.reason}`).join(' '),
        } : {}),
        ...(unitDiffers.length > 0 ? {
          unit_differs: unitDiffers,
          detail: [...unitDiffers.map(r => r.detail), ...rangesNotRecorded.map(r => `${r.option} / ${r.factor}: ${r.reason}`)].join(' '),
        } : {}),
        note:
          'Nothing has changed. Show the user the value in THEIR units and what it rests on, then call ' +
          'authorise_change with this proposal_id once they agree.',
      };
    },

    /**
     * ⛔ A CHANGE THE AGENT DISOWNS IS NEVER LEFT OFFERED (`approval-chips.ts` WITHDRAW_PROPOSAL). The loop admits only
     * a change THIS turn proposed and still offers. A stored proposal is removed, so it is neither listed as awaiting
     * approval nor carried; a held one (`gmh_`) lives on the product's row, and the route leaves it off this turn's
     * answer row by the same tool call, so the next turn finds nothing to confirm.
     */
    async withdrawProposal(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const id = typeof args?.proposal_id === 'string' ? args.proposal_id : '';
      const notFound = { ok: false, mutated: false, refusal: 'not_proposed_this_turn', detail: 'No change with that id is awaiting approval. Nothing was withdrawn.' };
      if (id.startsWith('goal-scope:')) {
        const issue = (await opts.readPendingActions?.(ctx.scenario_id) ?? []).find(p => p.action.kind === 'reconcile_goal_scope' && p.chip_id === id);
        if (issue?.action.kind !== 'reconcile_goal_scope') return notFound;
        const words = scopeWithdrawalWords(issue.action.goal_id);
        if ((ctx.user_turn_text ?? ctx.user_text ?? '').trim() !== words) return { ok: false, mutated: false, refusal: 'withdrawal_not_approved', approval_words: words,
          detail: 'This unresolved reading belongs to the user. It is retained until they explicitly withdraw it with the displayed words.' };
        withdrawnHolds.add(id);
      } else if (/^gmh_[0-9a-f]{12}$/.test(id)) {
        // Only a hold this scenario is actually offering can be withdrawn: a spoofed, stale or other-scenario id is not found.
        const held = (await opts.readPendingActions?.(ctx.scenario_id) ?? [])
          .find(p => p.chip_id === id && !isPendingActionExpired(p, Date.now()));
        if (held === undefined) return notFound;
        withdrawnHolds.add(id);
      } else {
        const p = proposals.get(id);
        if (p === undefined || p.scenario_id !== ctx.scenario_id || p.user_id !== ctx.authenticated_user_id) return notFound;
        proposals.discard(id);
        withdrawnProposals.add(id);
      }
      return {
        ok: true, mutated: false, proposal_id: id, withdrawn: true,
        detail: 'Withdrawn: it will not be applied, and the user is offered no button for it. Tell them plainly what you '
          + 'withdrew and why; propose the corrected change only if their words support it.',
      };
    },

    async authoriseChange(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      // A held add-option (C52) is confirmed on the product's own seam, never through the proposal store.
      if (typeof args?.proposal_id === 'string' && /^gmh_[0-9a-f]{12}$/.test(args.proposal_id)) {
        if (withdrawnHolds.has(args.proposal_id)) return { ok: false, mutated: false, refusal: 'withdrawn', detail: 'That change was withdrawn this turn. Nothing was changed.' };
        return confirmHeld(ctx, args.proposal_id);
      }
      // An adoption changes whose comparison includes an existing Olumi option. A model's interpretation
      // of typed "yes" is never that approval: the currently offered card must have been pressed verbatim.
      const pendingAdoption = proposals.get(args.proposal_id);
      const adoptionOperation = pendingAdoption?.operations.length === 1 && pendingAdoption.operations[0]?.op === 'adopt_olumi_option'
        ? pendingAdoption.operations[0] : undefined;
      if (adoptionOperation !== undefined) {
        const v = adoptionOperation.value as { approval_message?: unknown } | undefined;
        if (ctx.typed_approval_of !== args.proposal_id || ctx.typed_approval_words !== v?.approval_message) {
          return { ok: false, mutated: false, refusal: 'approve_on_card', proposal_id: args.proposal_id,
            detail: 'Nothing changed. Press the displayed adoption card to include this Olumi suggestion in your comparison.' };
        }
        if (opts.commitOlumiOptionAdoption === undefined) {
          return { ok: false, mutated: false, refusal: 'unavailable', proposal_id: args.proposal_id,
            detail: 'Adoption is unavailable here, so nothing changed.' };
        }
      }
      const before = await readGraph(ctx.scenario_id);
      if (before === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const recovery = proposals.partialProgressOf(args.proposal_id);
      const recoveryDeadline = proposals.get(args.proposal_id)?.operations.find(op => op.op === 'set_goal_deadline');
      if (recovery?.expected_postimage !== undefined && !(recoveryDeadline !== undefined
        ? goalHorizonLandedWriteIsScoped(recovery.expected_postimage, before.raw, recoveryDeadline.path)
        : isDeepStrictEqual(recovery.expected_postimage, before.raw))) {
        return { ok: false, mutated: false, applied: false, refusal: 'superseded', proposal_id: args.proposal_id };
      }
      const decision = proposals.authorise({
        proposal_id: args.proposal_id,
        scenario_id: ctx.scenario_id,
        authenticated_user_id: ctx.authenticated_user_id,
        current_graph_identity_hash: before.graph_hash,
        typed_approval_of: ctx.typed_approval_of,
        // EBD: a team-time card is stale only when what it read changed (hiring times landing never stale it).
        // E5: likewise a hiring-times card, while its own parts, carriers and deadline stand (the team time landing never stales it).
        // A deadline card, while its goal holds the date it was made against (hiring witness 35a66525: link strengths moved the
        // model). The same rule decides its lapse (`heldCardStillApplies`, `lifecycle.ts`).
        scoped_precondition_holds: (p) => heldCardStillApplies(p, before.raw),
      });
      if (decision.status === 'already_applied') {
        // ⭐ A retry RECOVERS the first result. It carries the proposal id, so
        // the retry is bound to the same proposal by identity, and the ORIGINAL
        // receipts, so the Agent can say which version it already became.
        return {
          ok: true, mutated: false, applied: true, already_applied: true,
          proposal_id: decision.proposal.proposal_id,
          receipts: decision.receipts,
          detail:
            decision.receipts.length > 0
              ? `That proposal was already applied and saved as version ${Math.max(...decision.receipts.map((x) => x.version))}. Nothing was applied twice.`
              : 'That proposal was already applied. No saved version was recorded for it. Nothing was applied twice.',
        };
      }
      if (decision.status !== 'execute') {
        return { ok: false, mutated: false, refusal: decision.status, ...(decision.status === 'superseded' ? { expected: decision.expected, actual: decision.actual } : {}) };
      }

      const scopeRevision = pendingAdoption?.operations.find(op => op.op === 'update_node')?.value as { reconciliation_key?: string } | undefined;
      if (scopeRevision?.reconciliation_key) {
        const issues = await opts.readPendingActions?.(ctx.scenario_id) ?? [];
        if (!issues.some(p => p.action.kind === 'reconcile_goal_scope' && scopeReconciliationKey(p.action) === scopeRevision.reconciliation_key)) {
          return { ok: false, mutated: false, applied: false, refusal: 'superseded', detail: 'The retained scope reading changed or was withdrawn after this card was offered. Nothing was written; ask for a fresh card.' };
        }
      }
      // The STORED operations are applied. Nothing is regenerated here.
      const ops = decision.proposal.operations;

      if (ops.length === 1 && ops[0]!.op === 'adopt_olumi_option') {
        const op = ops[0]!;
        const v = op.value as { label?: unknown; expected_interventions?: unknown; approval_message?: unknown } | undefined;
        const expected = v?.expected_interventions;
        const existing = before.nodes.find((n) => n.id === op.path);
        if (typeof v?.label !== 'string' || expected === null || typeof expected !== 'object' || Array.isArray(expected)
          || existing?.kind !== 'option' || existing.label !== v.label || existing.proposed_by !== 'olumi'
          || existing.analysis_participation === 'included'
          || !isDeepStrictEqual(existing.interventions ?? {}, expected)
          || before.graph_identity_hash === '') {
          return { ok: false, mutated: false, applied: false, refusal: 'superseded', proposal_id: decision.proposal.proposal_id,
            detail: 'The suggested option no longer matches the card you approved, so nothing changed. Read it again before proposing adoption.' };
        }
        const res = await opts.commitOlumiOptionAdoption!({
          scenario_id: ctx.scenario_id,
          turn_id: authorisationTurnId(decision.proposal.proposal_id),
          base_graph_hash: before.graph_hash,
          expected_graph_identity_hash: before.graph_identity_hash,
          option_id: op.path,
          expected_label: v.label,
          expected_interventions: expected as Record<string, unknown>,
        });
        if (res.status === 'unconfirmed') {
          return { ok: false, mutated: true, applied: false, refusal: 'not_confirmed', proposal_id: decision.proposal.proposal_id,
            detail: 'The adoption may have been saved, but I could not confirm the current model. Read the comparison before trying again or saying what it includes.' };
        }
        if (res.status !== 'committed') {
          return { ok: false, mutated: false, applied: false, refusal: res.status === 'stale' ? 'superseded' : 'not_applied',
            proposal_id: decision.proposal.proposal_id,
            detail: res.status === 'stale'
              ? 'The model changed before this adoption was saved, so nothing changed. Read the suggestion again and offer a fresh card.'
              : 'The suggestion could not be adopted. Nothing was changed; read the model before offering it again.' };
        }
        const after = await readGraph(ctx.scenario_id);
        const adopted = after?.nodes.find((n) => n.id === op.path);
        if (after === null || adopted?.kind !== 'option' || adopted.proposed_by !== 'olumi'
          || adopted.analysis_participation !== 'included' || adopted.label !== v.label
          || !isDeepStrictEqual(adopted.interventions ?? {}, expected) || after.graph_hash === before.graph_hash) {
          return { ok: false, mutated: true, applied: false, refusal: 'not_verified', proposal_id: decision.proposal.proposal_id,
            detail: 'The adoption was sent, but the saved comparison could not be confirmed. Read the model before saying what it includes.' };
        }
        const receipt = receiptSummaryOf({ model_version_receipt: res.model_version_receipt });
        const receipts = receipt.summary !== null ? [receipt.summary] : [];
        proposals.markApplied(decision.proposal.proposal_id, receipts);
        return { ok: true, mutated: true, applied: true, proposal_id: decision.proposal.proposal_id,
          receipts, ...(receipt.unreadable ? { receipt_unreadable: true } : {}),
          follow_up: `Included "${adopted.label}" in your comparison. Its Olumi origin and each level's recorded source remain unchanged.`,
        };
      }

      /**
       * ⛔ AN OLD-SHAPE ADD-OPTION IS NEVER APPLIED (C52). It wrote the option and its links as separate system
       * events and never linked it from the decision, so the model it produced could not run (Paul's test,
       * 25 Sep). New option proposals are held on the product's own seam (`gmh_…`, `confirmHeld`); one
       * restored from before this change is refused honestly rather than written incompletely.
       */
      if (ops[0]?.op === 'add_node' && ops.slice(1).every((o) => o.op === 'add_edge')) {
        return {
          ok: false, mutated: false, refusal: 'superseded', proposal_id: decision.proposal.proposal_id,
          detail: 'That offer to add an option was prepared before an update and can no longer be applied. Nothing was changed. Offer to prepare it again.',
        };
      }

      // Preserve the existing validation/card refusals before the ordinary-turn consent fence.
      // These card writers check the same host-bound identity before any write of their own.
      if (opts.turnAuthority === true && ctx.typed_approval_of !== args.proposal_id) {
        if (ops.some(o => o.op === 'set_link_effect')) return applyLinkEffect(ctx, decision.proposal, before);
        if (ops.some(o => o.op === CONFIRM_IDENTITY_OP)) return applyIdentityConfirm(ctx, decision.proposal, before);
        return { ok: false, mutated: false, refusal: 'approval_required' };
      }

      /**
       * ⭐ A LINK'S STRENGTH, AS THE USER STATED IT — ONE typed `edge_strength_edit`, the product's own link writer
       * (the inspector's canonical D1 path, with its expected-before tuple). Reported as applied ONLY when this
       * response succeeded AND the stored link now holds exactly what was approved, stamped as the user's.
       */
      if (ops.length === 1 && ops[0]!.op === 'update_edge') {
        const op = ops[0]!;
        const [fromId, toId] = op.path.split('::') as [string, string];
        const v = op.value as { magnitude: number; intent: 'set' | 'confirm_current'; direction_intent: 'preserve' | 'positive' | 'negative'; expected: { mean: number; effect_direction: 'positive' | 'negative' }; band?: unknown; replaces_user_figure?: { quote?: unknown } };
        const operationId = authorisationTurnId(decision.proposal.proposal_id);
        const send = () => dispatch('/orchestrate/v2/turn', {
          kind: 'system_event', turn_id: operationId, scenario_id: ctx.scenario_id, stage: 'frame',
          event: { kind: 'edge_strength_edit', from: fromId, to: toId, intent: v.intent, direction_intent: v.direction_intent, magnitude: v.magnitude, expected: v.expected },
        });
        // ⭐ A6e — THE BAND THE USER NAMED rides this verified approval in-process (`stated-link-band-context.ts`), the
        // way an approved adoption does: only a proposal the user authored (`user_stated`) that stored a band. One
        // restored from before the band was stored sends none, and the writer keeps the link's spread (a figure).
        const statedBand = decision.proposal.provenance.authored_by === 'user_stated' && isInfluenceBand(v.band) ? v.band : undefined;
        // ⭐ F1: the user's explicit replace rides the same verified, in-process context — only on a user-authored proposal
        // that stored it. One prepared before F1 carries none, and the writer refuses to drop the figure.
        const replacedQuote = statedBand !== undefined && typeof v.replaces_user_figure?.quote === 'string' ? v.replaces_user_figure.quote : undefined;
        const res = statedBand !== undefined
          ? await runWithStatedLinkBand(
            { scenarioId: ctx.scenario_id, proposalId: decision.proposal.proposal_id, from: fromId, to: toId, band: statedBand,
              ...(replacedQuote !== undefined ? { replacesUserFigure: true as const } : {}) },
            send,
          )
          : await send();
        const after = await readGraph(ctx.scenario_id);
        const dir = v.direction_intent === 'preserve' ? v.expected.effect_direction : v.direction_intent;
        const want = dir === 'negative' ? -v.magnitude : v.magnitude;
        /**
         * The link as it was approved: exactly this strength, recorded as the user's act — in whichever graph holds it.
         * ⭐ R11 (AIQ #72 5872082179): a `set` that changed the strength is stamped as the user's (`user_specified`); a
         * `confirm_current` is REVIEW, not authorship, so the writer keeps who authored the link and records the review
         * (`provenance.reviewed_by_user`, intent `confirm`) — that record is what this confirm landed as.
         */
        const holdsApproved = (edges: unknown): boolean => {
          const x = (Array.isArray(edges) ? edges as { from?: unknown; to?: unknown; strength?: unknown; provenance?: unknown }[] : [])
            .find((y) => y?.from === fromId && y?.to === toId);
          const mean = x?.strength !== null && typeof x?.strength === 'object' ? (x.strength as { mean?: unknown }).mean : undefined;
          const p = x?.provenance !== null && typeof x?.provenance === 'object' ? x.provenance as { source?: unknown; reviewed_by_user?: unknown } : undefined;
          const review = p?.reviewed_by_user !== null && typeof p?.reviewed_by_user === 'object' ? p.reviewed_by_user as { intent?: unknown } : undefined;
          const recorded = v.intent === 'confirm_current' ? review?.intent === 'confirm' : linkSizing(x) === 'user';
          return typeof mean === 'number' && Math.abs(mean - want) < 1e-9 && recorded
            // B1: a same-band confirm reviews the unchanged mean; it may still be an unsized placeholder.
            && (v.intent === 'confirm_current' || !approvalSizes(x));
        };
        /**
         * ⛔ LANDED IS WHAT THE MODEL HOLDS, NOT WHETHER TWO REVISIONS ARE EQUAL (round-2 review of
         * fix/agent-never-shows-instructions-or-codes, blocker 2 — probed through this capability). `landed` also demanded
         * that this response's revision EQUAL the read-back's, so a link write that landed and was followed by any other
         * write before the read-back came back `not_applied`, `mutated: false` — "Not saved: none of it was applied." —
         * while the link held exactly the approved 0.825 stamped as the user's, and the approval was left unapplied.
         * The read-back holding exactly what was approved is landed; a commit the model no longer shows is "could not be
         * confirmed" (`committedThenMoved`); only a response that shows nothing committed is "Not saved".
         */
        const landed = res.status === 200 && after !== null && holdsApproved(after.edges);
        if (after === null && res.status === 200) {
          // The write may have landed; the read-back failed. Never "as it was" when Olumi cannot see (review of #1950).
          return { ok: false, mutated: false, applied: false, refusal: 'not_confirmed', proposal_id: decision.proposal.proposal_id,
            detail: 'Olumi could not read the model back to confirm whether the link was recorded. Tell the user plainly that it could not be confirmed, and offer to check again.' };
        }
        if (!landed && committedThenMoved(res, before.graph_hash, after, (draft) => holdsApproved(draft.edges))) {
          return { ok: false, mutated: true, applied: false, refusal: 'not_verified', proposal_id: decision.proposal.proposal_id,
            detail: 'The link was saved, but the model changed again straight afterwards and no longer shows it as approved, so what it now holds could not be confirmed. Read the model again before saying what it holds; do not describe the link as recorded.' };
        }
        if (!landed) {
          return { ok: false, mutated: false, applied: false, refusal: 'not_applied', proposal_id: decision.proposal.proposal_id,
            detail: String(res.json.assistant_text ?? '').trim() !== ''
              ? `The link was not recorded. Olumi said: "${String(res.json.assistant_text).trim()}" Tell the user plainly; nothing else changed.`
              : 'The link was not recorded, so the model is as it was. Tell the user plainly.' };
        }
        const receipt = receiptSummaryOf(res.json);
        const receipts = receipt.summary !== null ? [receipt.summary] : [];
        proposals.markApplied(decision.proposal.proposal_id, receipts);
        /**
         * ⛔ `follow_up` IS WHAT THE USER READS; `note` IS WHAT THE AGENT READS (served f2, CEE `af719a1`, scenario
         * `bdba963b`): one click on "Record this link" showed this `follow_up` verbatim — "Recorded as the user's own
         * estimate: … Offer to run the analysis again so they can see what it changes." The typed-approval fast path
         * shows `follow_up` to the user and no model reads the result there; on the loop path the Agent reads both.
         * So the sentence the user reads is addressed to them, and the next step for the Agent stays in `note`, where
         * only the Agent reads it.
         */
        /**
         * ⭐ M1 ACCEPT RECEIPT (R3 5942069984; DL 5942097719): WHOSE FIGURE IS READ OFF THE STORED LINK after the write
         * (`linkSizing`, F1b's one predicate), never off the card. A confirm is review (R11), so on Olumi's estimate it
         * lands `olumi_accepted` and says RC's accept sentence — the one the system-event receipt and the M2 rerun line
         * say (`formatEdgeStrengthConfirmed`). Only a link the user sized is "your own estimate"; any other claims nobody.
         */
        const storedEdge = after.edges.find((e) => e.from === fromId && e.to === toId);
        const sizing = storedEdge === undefined ? undefined : linkSizing(storedEdge);
        const fromLabel = after.nodes.find((n) => n.id === fromId)?.label;
        const toLabel = after.nodes.find((n) => n.id === toId)?.label;
        const followUp = sizing === 'user' && replacedQuote !== undefined && statedBand !== undefined
          // ⭐ F1 (d5 6006667946): the receipt names exactly what was replaced, and with what.
          ? userFigureReplacedReceipt({ quote: replacedQuote }, linkBandWord(statedBand))
          : sizing === 'user'
          ? `${decision.proposal.public_label.replace(/^Record /, 'Recorded ')}.`
          : typeof fromLabel === 'string' && typeof toLabel === 'string'
            // Quoted: shown through `withoutAgentDirections`, where an unquoted label can drop the sentence (Codex P2).
            ? formatEdgeStrengthConfirmed({ fromLabel: quoteLabelForUser(fromLabel), toLabel: quoteLabelForUser(toLabel), sizing })
            // A′ round 2 (DL): a placeholder has no strength to "stay"; it says the contract, as the labelled receipt does.
            : sizing === 'placeholder'
              ? 'Review recorded; this link is still unsized. Its values are unchanged. Give a figure, or ask Olumi to estimate it.'
              : 'Recorded your review of this link; its strength stays as it was.';
        const whoseNote = sizing === 'user'
          ? 'Recorded as the user’s own estimate.'
          : sizing === 'olumi_accepted'
            ? 'Recorded as the user’s review: the strength stays Olumi’s estimate, which they accepted. Never call it their own.'
            : 'Recorded as the user’s review: the strength stays exactly as it was, and who sized it did not change. Never call it their own.';
        return {
          ok: true, mutated: true, applied: true, proposal_id: decision.proposal.proposal_id, operation_id: operationId, receipts,
          ...(receipt.unreadable ? { receipt_unreadable: true } : {}),
          follow_up: followUp,
          note: `${whoseNote} Offer to run the analysis again so they can see what it changes.`,
        };
      }

      /**
       * ⭐ THE GOAL'S SUCCESS TARGET, AS THE USER STATED IT — ONE typed `goal_target_edit`, the product's own target
       * writer, carrying the proposal's base hash (its stale gate). Applied ONLY when this response succeeded AND the
       * stored target holds exactly what was approved (`goalTargetHolds`); a write that answered 200 but cannot be read
       * back is "could not be confirmed", never "not saved".
       */
      /**
       * ⭐ MG F1 T6: ONE option's status through the ONE writer (`option_status_edit`), carrying the proposal's base hash.
       * "Done" only when the model HOLDS the status and its participation (`optionStatusHolds`, the writer's own read-back).
       */
      if (ops.length === 1 && ops[0]!.op === 'set_option_status') {
        const op = ops[0]!;
        const { status, expected_status } = op.value as { status: 'feasible' | 'infeasible' | 'removed'; expected_status: 'feasible' | 'infeasible' | 'removed' };
        const pid = decision.proposal.proposal_id;
        if (opts.commitOptionStatus === undefined) {
          return { ok: false, mutated: false, applied: false, refusal: 'not_applied', proposal_id: pid,
            detail: 'The option cannot be changed here, so nothing was written. Tell the user plainly.' };
        }
        const operationId = authorisationTurnId(pid);
        const res = await opts.commitOptionStatus({
          scenario_id: ctx.scenario_id, turn_id: operationId, option_node_id: op.path, expected_status, status,
          base_graph_hash: decision.proposal.base_graph_identity_hash,
        });
        // The CAS / expected-status conflict, or the turn fence's superseded/stopped verdict: nothing written.
        if (res.status === 'stale') {
          return { ok: false, mutated: false, applied: false, refusal: 'superseded', proposal_id: pid,
            detail: 'The model changed just before this was written, so nothing was changed. Offer to prepare it again.' };
        }
        // The turn fence refused before any write.
        if (res.status === 'refused') {
          return { ok: false, mutated: false, applied: false, refusal: 'not_applied', proposal_id: pid,
            detail: 'The option was not changed, and nothing on the model changed. Tell the user plainly and ask what they would like instead.' };
        }
        /**
         * ⛔ APPLIED ONLY ON THE WRITER'S OWN TYPED OUTCOME (CODEX overflow #2471 5937013605 + DL). Served b213138f said
         * "could not be confirmed" on 4 of 4 presses that landed, because a guest's write mints no version and #2467
         * required a receipt (R3 5936732295). Display bytes cannot stand in (a no-write replay carries them too). So:
         * the writer says THIS attempt wrote (`written`), a minted version's receipt names THIS turn, and the model read
         * back holds the status. Anything less is UNCONFIRMED — never "did not change" (CODEX delta P2-1).
         */
        const receipt = res.status === 'written' ? receiptSummaryOf({ model_version_receipt: res.model_version_receipt }) : null;
        const receiptBindsThisTurn = res.status === 'written' && receipt !== null && !receipt.unreadable
          && (res.version_minted ? receipt.summary !== null && receipt.summary.source_turn_id === operationId : receipt.summary === null);
        const after = await readGraph(ctx.scenario_id);
        const landed = receiptBindsThisTurn && after !== null && optionStatusHolds(after.raw, op.path, status);
        if (!landed) {
          return { ok: false, mutated: true, applied: false, refusal: 'not_confirmed', proposal_id: pid,
            detail: 'The change was sent but could not be confirmed in the saved model. Tell the user it could not be confirmed (never that it was saved, never that it failed) and offer to check.' };
        }
        // The exact proposal is APPLIED (CODEX P2): it is no longer offered, and a retry reads "already applied", never "superseded".
        const receipts = receipt!.summary !== null ? [receipt!.summary] : [];
        proposals.markApplied(pid, receipts);
        return { ok: true, mutated: true, applied: true, proposal_id: pid, operation_id: operationId, receipts,
          // The writer's own sentence, about the option the model now holds (one wording for the UI and the Agent).
          follow_up: optionStatusConfirmationText(String(after!.nodes.find((n) => n.id === op.path)?.label ?? ''), status),
          note: 'The last analysis no longer reflects the options compared. Offer to run the analysis again.' };
      }

      if (ops.length === 1 && ops[0]!.op === 'set_goal_target') {
        const op = ops[0]!;
        const v = op.value as { constraint_type: TargetDirection; raw_value: number; unit: string };
        const operationId = authorisationTurnId(decision.proposal.proposal_id);
        const write = () => dispatch('/orchestrate/v2/turn', {
          kind: 'system_event', turn_id: operationId, scenario_id: ctx.scenario_id, stage: 'frame',
          event: { kind: 'goal_target_edit', goal_node_id: op.path, constraint_type: inclusiveTargetDirection(v.constraint_type), raw_value: v.raw_value, unit: v.unit, base_graph_hash: decision.proposal.base_graph_identity_hash },
        });
        // The approved card's strict comparator rides only this exact in-process write, never a wire field.
        const res = await runWithStatedGoalOperator({ scenario_id: ctx.scenario_id, goal_node_id: op.path,
          turn_id: operationId, operator: TARGET_OPERATOR[v.constraint_type] }, write);
        // The writer's stale-base gate: the model moved between this approval's read and the write. Nothing written.
        if (res.status === 409) {
          return { ok: false, mutated: false, applied: false, refusal: 'superseded', proposal_id: decision.proposal.proposal_id,
            detail: 'The model changed just before this target was written, so nothing was changed. Offer to prepare it again.' };
        }
        // Refused with nothing written (422: `refused_no_write`, which carries no reason on the wire). The writer's own
        // words for a target it cannot take are its canonical sentence; relayed as that, never as a code.
        if (res.status >= 400 && res.status < 500) {
          return { ok: false, mutated: false, applied: false, refusal: 'not_applied', proposal_id: decision.proposal.proposal_id,
            follow_up: `${ADD_CONSTRAINT_USER_GUIDANCE} Nothing on your model changed.`,
            detail: `The target was not set, and nothing on the model changed. Olumi said: "${ADD_CONSTRAINT_USER_GUIDANCE}" Explain the supplied current target or approval facts in ordinary words. Keep exact quantitative values, units, scope and human-versus-Olumi provenance. A proposed modelling interpretation or approval now does not prove the original quote’s subject or authorship. Ask what target they would like instead.` };
        }
        const after = await readGraph(ctx.scenario_id);
        // Landed is what the model HOLDS (the rule #1995 sets for every writer): another writer moving the revision afterwards
        // does not unsay a target the model holds exactly as approved.
        const landed = res.status === 200 && after !== null && goalTargetHolds(after.raw, op.path, v);
        if (!landed) {
          // It may have been stored (a 200, or a failure the writer itself cannot vouch for): say what is known.
          return { ok: false, mutated: true, applied: false, refusal: 'not_confirmed', proposal_id: decision.proposal.proposal_id,
            detail: 'The target was sent, but what the model now holds could not be confirmed. Tell the user plainly that it could not be confirmed, '
              + 'offer to check the model again, and never say it was set or that it was not.' };
        }
        const receipt = receiptSummaryOf(res.json);
        const receipts = receipt.summary !== null ? [receipt.summary] : [];
        const goalLabel = String(after!.nodes.find((x) => x.id === op.path)?.label ?? 'the goal');
        const targetSaid = `The goal "${goalLabel}" now has the target ${DIRECTION_WORDS[v.constraint_type]} ${targetFigure(v.raw_value, v.unit)}, as you stated it.`;
        const applied = {
          ok: true, mutated: true, applied: true, proposal_id: decision.proposal.proposal_id, operation_id: operationId, receipts,
          ...(receipt.unreadable ? { receipt_unreadable: true } : {}),
          follow_up: targetSaid,
        };
        /**
         * ⭐ TODAY'S LEVEL, ON THE SAME APPROVAL (AIQ #75 5913952911): prepared by the level door against the target just
         * written — the door's own words rule, unit rule and `admitStatedGoalLevel` — then written by its own CAS-gated
         * writer, on the revision read back above. The goal's cap and its provenance are left exactly as the target
         * writer set them. Either write failing is said by name: the target stays set, the level is not recorded.
         */
        const level = (op.value as { current_level?: { value: number; unit: string; quote: string } }).current_level;
        if (level === undefined) {
          proposals.markApplied(decision.proposal.proposal_id, receipts);
          return applied;
        }
        const todaySaid = targetFigure(level.value, level.unit);
        const notRecorded = (why: unknown): ToolResult => {
          // A known refusal already has the target and today's exact figure; keep that specific report.
          if (!(why instanceof Error) && why !== 'not_confirmed' && why !== 'not_verified') {
            const detail = `${targetSaid} Its level today (${todaySaid}) was not recorded. What is its level today?`;
            return { ok: false, mutated: true, applied: false, refusal: 'partially_applied',
              proposal_id: decision.proposal.proposal_id, receipts: [...receipts],
              outcome: 'target_saved_level_refused', level_not_recorded: true, detail, follow_up: detail,
              note: `The target is set. Today's level was NOT recorded (${String(why ?? 'refused')}). Say both plainly, and never say today's level was saved.`,
            };
          }
          return {
            ...partialWriteOutcome(decision.proposal.proposal_id, receipts,
              laterSaveConflict(why) ? 'target_saved_level_not_saved' : 'target_saved_level_unconfirmed'),
            level_not_recorded: true,
          };
        };
        const levelCtx = { ...ctx, user_text: level.quote, user_turn_text: level.quote };
        let prepared: ToolResult;
        try {
          prepared = await proposeGoalCurrentLevel({ readGraph: async () => after, proposals }, levelCtx, {
            goal_label: goalLabel, value: level.value, unit: level.unit, goal_is: v.constraint_type, user_stated: true,
          });
        } catch (error) { return notRecorded(error); }
        const levelProposal = prepared.ok && typeof prepared.proposal_id === 'string' ? proposals.get(prepared.proposal_id) : undefined;
        if (levelProposal === undefined) return notRecorded(prepared.refusal);
        let written: ToolResult;
        try {
          written = await applyGoalCurrentLevel({ dispatch, readGraph, proposals, operationId: authorisationTurnId }, ctx, levelProposal, after!);
        } catch (error) {
          proposals.discard(levelProposal.proposal_id);
          return notRecorded(error);
        }
        if (written.ok !== true || written.applied !== true) {
          // ⛔ P0 PARTNER CR on #2373 (5914335527): the level proposal this branch made internally was never shown as a
          // card, so it must not stay outstanding — the next "yes" would record what this reply says was not recorded.
          proposals.discard(levelProposal.proposal_id);
          return { ...notRecorded(written.refusal),
            receipts: [...receipts, ...((written.receipts as ReceiptSummary[] | undefined) ?? [])] };
        }
        proposals.markApplied(decision.proposal.proposal_id, receipts);
        return {
          ...applied,
          receipts: [...receipts, ...((written.receipts as ReceiptSummary[] | undefined) ?? [])],
          follow_up: `${targetSaid} Its level today is recorded as ${todaySaid}, your figure.`,
        };
      }

      /**
       * ⭐ SLICE C2 — A NEW FIGURE FOR A LIMIT THE MODEL ALREADY HOLDS, through the product's limit door
       * (`commitLimitEditInProcess`): the proposal's base hash is its stale gate, the row keeps its unit and frame, the
       * figure is stamped as the user's, ONE CAS commit. Applied ONLY when the door committed AND the model read back holds
       * that very row (same constraint_id) at exactly the approved figure, in its own unit.
       */
      if (ops.length === 1 && ops[0]!.op === 'add_limit') {
        const op = ops[0]!;
        const v = op.value as NewLimitValue;
        const pid = decision.proposal.proposal_id;
        const words = limitApprovalWords(ctx.typed_approval_words ?? ctx.user_turn_text ?? '');
        const useReserve = v.reserve !== undefined
          && (words === limitApprovalWords(v.reserve.message) || words === limitApprovalWords(v.reserve.label));
        // A forged chip/message cannot substitute another figure for this stored card.
        if (!['yes', 'yes, record that limit'].includes(words) && !useReserve) {
          return { ok: false, mutated: false, refusal: 'approval_words_mismatch' };
        }
        if (opts.commitLimitAdd === undefined) return { ok: false, mutated: false, refusal: 'unavailable' };
        const approvedValue = useReserve ? v.reserve!.alternative : v.raw_value;
        const res = await opts.commitLimitAdd({ scenario_id: ctx.scenario_id, turn_id: authorisationTurnId(pid),
          base_graph_hash: decision.proposal.base_graph_identity_hash, node_id: op.path, operator: '<=', raw_value: approvedValue,
          unit: v.unit, source_quote: v.source_quote, ...(v.value_frame !== undefined ? { value_frame: v.value_frame } : {}) });
        if (res.status === 'stale') return { ok: false, mutated: false, refusal: 'superseded', proposal_id: pid };
        if (res.status === 'refused') return { ok: false, mutated: false, refusal: 'not_applied', proposal_id: pid,
          follow_up: 'The limit was not recorded. Nothing on your model changed.' };
        if (res.status === 'unconfirmed') return { ok: false, mutated: true, applied: false, refusal: 'not_confirmed', proposal_id: pid,
          detail: 'The limit was sent, but the saved model could not be confirmed.' };
        const after = await readGraph(ctx.scenario_id);
        const rows = (Array.isArray(after?.raw.goal_constraints) ? after!.raw.goal_constraints as Record<string, unknown>[] : [])
          .filter(c => c.node_id === op.path);
        const beforeRows = Array.isArray(before.raw.goal_constraints) ? before.raw.goal_constraints : [];
        const allAfter = Array.isArray(after?.raw.goal_constraints) ? after!.raw.goal_constraints : [];
        const row = rows[0];
        if (rows.length !== 1 || allAfter.length !== beforeRows.length + 1 || row?.constraint_id !== res.row.constraint_id
          || row?.operator !== '<=' || row.value !== approvedValue || row.unit !== v.unit || row.source_quote !== v.source_quote
          || row.value_frame !== v.value_frame || row.provenance !== 'explicit') {
          return { ok: false, mutated: true, applied: false, refusal: 'not_confirmed', proposal_id: pid,
            detail: 'The limit was sent, but the saved model could not be confirmed.' };
        }
        const receipt = receiptSummaryOf({ model_version_receipt: res.model_version_receipt });
        const receipts = receipt.summary !== null ? [receipt.summary] : [];
        proposals.markApplied(pid, receipts);
        return { ok: true, mutated: true, applied: true, proposal_id: pid, receipts,
          follow_up: `The limit on “${before.nodes.find(n => n.id === op.path)?.label}” is recorded as at most ${limitFigure(approvedValue, v.unit)}.` };
      }

      if (ops.length === 1 && ops[0]!.op === 'set_limit') {
        const op = ops[0]!;
        const v = op.value as { operator: '<=' | '>='; raw_value: number; unit: string | null; constraint_id: string; before: number;
          /** A2 follow-up: the comparator the user stated when proposing it, if they stated one (`proposeLimitChange`). */
          stated_operator?: '<' | '<=' | '>' | '>='; source_quote?: string; reserve?: NewLimitValue['reserve'];
          /** B (3): the row is one of the goal's targets: the target's words, and the read-back must keep its role. */
          role?: 'goal_target' };
        const isTarget = v.role === 'goal_target';
        // The approved one-target card's own words (`set_goal_target` above) for a target row; a limit's are unchanged.
        const TARGET_UNCONFIRMED = 'The target was sent, but what the model now holds could not be confirmed. Tell the user plainly that it could not be confirmed, '
          + 'offer to check the model again, and never say it was set or that it was not.';
        const pid = decision.proposal.proposal_id;
        const approval = limitApprovalWords(ctx.typed_approval_words ?? ctx.user_turn_text ?? '');
        const useReserve = v.reserve !== undefined
          && (approval === limitApprovalWords(v.reserve.message) || approval === limitApprovalWords(v.reserve.label));
        if (v.reserve !== undefined && !['yes', 'yes, change that limit', ...(v.role === 'goal_target' ? ['yes, set that target'] : [])].includes(approval) && !useReserve) {
          return { ok: false, mutated: false, refusal: 'approval_words_mismatch' };
        }
        const approvedValue = useReserve ? v.reserve!.alternative : v.raw_value;
        if (opts.commitLimitEdit === undefined) {
          return { ok: false, mutated: false, applied: false, refusal: 'not_applied', proposal_id: pid,
            detail: 'This limit cannot be changed here, so nothing was written. Tell the user plainly.' };
        }
        const operationId = authorisationTurnId(pid);
        const res = await opts.commitLimitEdit({
          scenario_id: ctx.scenario_id, turn_id: operationId, base_graph_hash: decision.proposal.base_graph_identity_hash,
          node_id: op.path, operator: v.operator, raw_value: approvedValue,
          ...(v.stated_operator !== undefined ? { stated_operator: v.stated_operator } : {}),
          ...(v.source_quote !== undefined ? { source_quote: v.source_quote } : {}),
        });
        const label = String(before.nodes.find((x) => x.id === op.path)?.label ?? 'that limit');
        const figure = (x: number): string => v.unit === null ? String(x)
          : readUnitParts(v.unit)?.kind === 'percent' ? limitFigure(x, v.unit) : targetFigure(x, v.unit);
        if (res.status === 'stale') {
          return { ok: false, mutated: false, applied: false, refusal: 'superseded', proposal_id: pid,
            detail: isTarget ? 'The model changed just before this target was written, so nothing was changed. Offer to prepare it again.'
              : 'The model changed just before this limit was written, so nothing was changed. Offer to prepare it again.' };
        }
        if (res.status === 'refused' && isTarget) {
          return { ok: false, mutated: false, applied: false, refusal: 'not_applied', proposal_id: pid,
            follow_up: `${ADD_CONSTRAINT_USER_GUIDANCE} Nothing on your model changed.`,
            detail: `The target was not set, and nothing on the model changed. Olumi said: "${ADD_CONSTRAINT_USER_GUIDANCE}" Explain the supplied current target or approval facts in ordinary words. Keep exact quantitative values, units, scope and human-versus-Olumi provenance. A proposed modelling interpretation or approval now does not prove the original quote’s subject or authorship. Ask what target they would like instead.` };
        }
        if (res.status === 'refused') {
          return { ok: false, mutated: false, applied: false, refusal: 'not_applied', proposal_id: pid,
            follow_up: `The limit on "${label}" was not changed. Nothing on your model changed.`,
            detail: `The limit was not changed, and nothing on the model changed. Tell the user plainly, and ask what they would like instead.` };
        }
        if (res.status === 'unconfirmed') {
          if (isTarget) return { ok: false, mutated: true, applied: false, refusal: 'not_confirmed', proposal_id: pid, detail: TARGET_UNCONFIRMED };
          return { ok: false, mutated: true, applied: false, refusal: 'not_confirmed', proposal_id: pid,
            detail: 'The limit was sent, but what the model now holds could not be confirmed. Tell the user plainly that it could not be confirmed, '
              + 'offer to check the model again, and never say it was changed or that it was not.' };
        }
        // Landed is what the model HOLDS: that very row, at exactly the approved figure, in its own unit.
        const beforeRow = (Array.isArray(before.raw.goal_constraints) ? before.raw.goal_constraints as Record<string, unknown>[] : [])
          .find((c) => c !== null && typeof c === 'object' && c['constraint_id'] === v.constraint_id);
        const after = await readGraph(ctx.scenario_id);
        const heldRows = (Array.isArray(after?.raw.goal_constraints) ? after!.raw.goal_constraints as Record<string, unknown>[] : [])
          .filter((c) => c !== null && typeof c === 'object' && c['node_id'] === op.path && c['operator'] === v.operator);
        const landed = heldRows.length === 1 && heldRows[0]!['constraint_id'] === v.constraint_id && heldRows[0]!['value'] === approvedValue
          && (heldRows[0]!['unit'] ?? null) === v.unit
          && (v.source_quote === undefined || heldRows[0]!['source_quote'] === v.source_quote)
          && (v.stated_operator === undefined || statedOperatorOf(heldRows[0]!) === v.stated_operator)
          // A target row is landed only if it is still one of the goal's targets (else the joint is withheld for a false reason),
          // on THIS approval's committed postimage (the read-back is the door's committed graph, not equal figures after another
          // writer), with its frame and label as they were (AIE 0836 / PL 6120477801: every applicable coordinate).
          && (!isTarget || (heldRows[0]!['role'] === 'goal_target' && after!.graph_hash === res.graph_hash
            && ['value_frame', 'label', 'deadline_metadata'].every((k) => isDeepStrictEqual(heldRows[0]![k], beforeRow?.[k]))));
        if (!landed && isTarget) return { ok: false, mutated: true, applied: false, refusal: 'not_confirmed', proposal_id: pid, detail: TARGET_UNCONFIRMED };
        if (!landed) {
          return { ok: false, mutated: true, applied: false, refusal: 'not_confirmed', proposal_id: pid,
            detail: 'The limit was written, but what the model now holds could not be confirmed. Tell the user plainly that it could not be confirmed, '
              + 'offer to check the model again, and never say it was changed or that it was not.' };
        }
        const receipt = receiptSummaryOf({ model_version_receipt: res.model_version_receipt });
        const receipts = receipt.summary !== null ? [receipt.summary] : [];
        proposals.markApplied(pid, receipts);
        // A2: said as the model now HOLDS it ("less than 5%" for a strict limit), from the row read back above.
        const words = LIMIT_OPERATOR_WORDS[statedOperatorOf(heldRows[0]!) ?? v.operator];
        if (isTarget) {
          const held = statedOperatorOf(heldRows[0]!) ?? v.operator;
          const direction = DIRECTION_WORDS[held === '<' ? 'below' : held === '>' ? 'above' : held === '<=' ? 'at_most' : 'at_least'];
          return {
            ok: true, mutated: true, applied: true, proposal_id: pid, operation_id: operationId, receipts,
            ...(receipt.unreadable ? { receipt_unreadable: true } : {}),
            // AIE-B-multi-target-text-AMEND-0836 S7 (one): "using your figure" — a comparator kept from the row is not newly stated.
            follow_up: `The target for ‘${label}’ is now ${direction} ${figure(approvedValue)}, using your figure.`,
          };
        }
        return {
          ok: true, mutated: true, applied: true, proposal_id: pid, operation_id: operationId, receipts,
          ...(receipt.unreadable ? { receipt_unreadable: true } : {}),
          follow_up: `The limit on "${label}" is now ${words} ${figure(approvedValue)} (it was ${figure(v.before)}), as you stated it.`,
        };
      }

      // ⭐ A set of link strengths: ONE commit through the level door's link half (seam Canonical #72 5871633483).
      // The user's stated link effect writes ONLY through the level door's `link_effects` (Canonical 5882965890); until that
      // door is wired here, nothing is written and the Agent says so — never a strength-only or register fallback.
      if (ops.some((o) => o.op === 'set_link_effect')) return applyLinkEffect(ctx, decision.proposal, before);
      if (ops.some((o) => o.op === CONFIRM_IDENTITY_OP)) return applyIdentityConfirm(ctx, decision.proposal, before);
      if (ops.length === 1 && ops[0]!.op === 'set_team_time') return applyTeamTime(ctx, decision.proposal, before);
      if (ops.length === 1 && ops[0]!.op === SET_HIRING_TIMES) return applyHiringTimes(ctx, decision.proposal, before);
      if (ops.length === 1 && ops[0]!.op === SET_OPTION_CAPACITY_CHANGE) return applyOptionCapacityChange(ctx, decision.proposal, before);
      if (ops.length === 1 && ops[0]!.op === 'attest_goal_steady') return applyGoalSteady(ctx, decision.proposal, before);
      if (ops.length === 1 && ops[0]!.op === CONFIRM_GOAL_READING_OP) return applyGoalReading(ctx, decision.proposal, before);
      if (ops.length === 1 && ops[0]!.op === SET_RISK_OCCURRENCE_OP) return applyRiskOccurrence(ctx, decision.proposal, before);
      if (ops.length === 1 && ops[0]!.op === RECORD_STATEMENT_OP) return applyStatement(ctx, decision.proposal, before);
      if (ops.length === 1 && ops[0]!.op === SET_COHORT_FORECAST_OP) return applyCohortForecast(ctx, decision.proposal, before);
      if (ops.length === 1 && ops[0]!.op === 'replace_draft') return applyReplaceDraft(ctx, decision.proposal, before);
      if (ops.length === 1 && ops[0]!.op === 'set_goal_deadline') return applyGoalDeadline(ctx, decision.proposal, before);
      if (ops.length > 0 && ops.every((o) => o.op === 'set_link_strength')) return applyLinkStrengthSet(ctx, decision.proposal, before);

      if (ops.some(o => o.op === 'set_option_intervention' && Object.hasOwn((o.value ?? {}) as object, 'unmodelled_mechanisms'))) return applyCompound(ctx, decision.proposal, before);

      // A starting point mixes kinds; each single-kind path below handles one.
      if (new Set(ops.map((o) => o.op)).size > 1) return applyCompound(ctx, decision.proposal, before);
      /**
       * ⛔ A VALUES-ONLY APPROVAL IS ONE COMMIT TOO (Canonical #70 5850018984; DL GO 5850026671; ChatGPT 5850029446). Olumi's
       * starting point with no levels is single-kind, so it fell to the per-value path below: DL's joined run F1s approved
       * three figures and the model gained THREE versions, each value its own `factor_value_edit` commit — a refusal
       * part-way left some written. Through the door it is ONE port call: every value and the range it needs, or none.
       * The per-value path stays only where no door is wired (never in the route, which always wires it).
       */
      if (opts.commitOptionLevels !== undefined && ops.length > 0 && ops.every((o) => o.op === 'set_factor_value')) {
        return applyCompound(ctx, decision.proposal, before);
      }

      // The goal's current level, as the user stated it (`../goal-current-level.ts`): one CAS-gated write.
      if (isGoalCurrentLevelProposal(decision.proposal)) {
        return applyGoalCurrentLevel({ dispatch, readGraph, proposals, operationId: authorisationTurnId }, ctx, decision.proposal, before);
      }

      if (ops[0]?.op === 'set_option_intervention') {
        /**
         * ⚠ THIS EVENT IS CAS-GATED AND `factor_value_edit` IS NOT — it carries
         * a REQUIRED `base_graph_hash`. Each applied edit moves the hash, so the
         * next edit carries the revision our OWN preceding write reported (never a
         * re-read, which would adopt another writer's edit); sending the proposal's
         * base for all of them refuses every edit after the first with a divergence
         * that is really our own preceding write.
         */
        const applied: { option: string; factor: string; requested: number; recorded: number | null }[] = [];
        const failures: { path: string; detail: string }[] = [];
        const receipts: ReceiptSummary[] = [];
        // ⛔ EVERY LEVEL IS ONE COMMIT OR NONE (Canonical #70 5847348206), so what would stop it is checked BEFORE any write.
        const levelInputs = ops.map((o) => {
          const [option_id, factor_id] = o.path.split('::');
          return {
            path: o.path, option_id: option_id ?? '', factor_id: factor_id ?? '',
            value: ((o.value ?? {}) as { normalised?: unknown }).normalised,
            author: levelOpAuthor(o, decision.proposal) === 'user_stated' ? 'user_specified' as const : 'model_proposed' as const,
            figure: levelFigureOf(o),
          };
        });
        if (opts.commitOptionLevels === undefined || levelInputs.some((l) => typeof l.value !== 'number')) {
          return {
            ok: false, mutated: false, applied: false, proposal_id: decision.proposal.proposal_id, refusal: 'not_applied',
            detail: opts.commitOptionLevels === undefined
              ? 'The option levels could not be written as one change, so nothing was written.'
              : 'A level was missing from the stored proposal, so nothing was written.',
          };
        }
        /**
         * ⭐ ATTACH ANY DERIVED FRAME FIRST, in one write, before the levels.
         * The factor must carry its range before a level is recorded against
         * it, or the level is a number the model cannot interpret. Same
         * mechanism as the adopted-assumption path, and the same disclosure.
         */
        const reencodedSiblings: ReencodedSibling[] = [];
        const framedHere: { factor: string; range: number }[] = [];
        const frames = new Map<string, number>();
        for (const factorId of new Set(ops.map(o => o.path.split('::')[1]))) {
          const cohort = ops.filter(o => o.path.split('::')[1] === factorId);
          if (!cohort.some(o => typeof ((o.value ?? {}) as { derived_frame?: unknown }).derived_frame === 'number')) continue;
          const range = proposedFrameForLevels(cohort.map(levelFigureOf));
          if (range !== null && range > 1) frames.set(factorId, range);
        }
        if (frames.size > 0) {
          /**
           * ⭐⭐ PATCH THE MODEL AS IT IS NOW, NOT AS IT WAS WHEN WE READ IT.
           *
           * ⛔ THE COUNTEREXAMPLE THIS CLOSES (owner note 5799139118, limb 1):
           * this write sends a WHOLE graph built from an earlier read. The
           * route's expectation is compared in ANALYSIS space, which EXCLUDES
           * labels — so a rename landing between our read and this write passes
           * the comparison and is then overwritten by our stale copy of the node.
           *
           * ⚠ I previously reported limb 1 as wholly uncloseable caller-side and
           * left it to the atomic-writer lease. That was too broad. A caller
           * cannot express an IDENTITY-space expectation — that part is true and
           * still belongs at the write boundary — but it CAN stop replaying stale
           * bytes, which is the other half the owner note named: *"a targeted
           * atomic patch … can avoid replaying the whole stale graph."*
           *
           * So: re-read, patch the FRESH nodes, and send those. An intervening
           * edit is preserved BY CONSTRUCTION rather than by a comparison that
           * cannot see it. The residual window shrinks from "user think-time plus
           * a model call" to the milliseconds between this read and the route's
           * own — and the route's CAS already covers its own read-to-write gap.
           *
           * ⛔ AND IT NEVER CLOBBERS A RANGE SOMEONE ELSE SUPPLIED: a factor that
           * already carries a usable frame in the fresh read is left alone. If
           * that leaves nothing to do, no write is attempted at all.
           *
           * A failed re-read falls back to the earlier read: degrading to
           * today's behaviour is right, because refusing the whole authorisation
           * because a READ failed would lose work the user already approved.
           */
          const nowRead = await readGraph(ctx.scenario_id);
          const base = nowRead ?? before;
          const stillNeeds = new Map<string, number>();
          for (const [id, range] of frames) {
            const node = base.nodes.find((n) => n.id === id);
            if (node !== undefined && frameOf(node) !== null) continue;
            stillNeeds.set(id, range);
          }
          const patched = base.nodes.map((n) => {
            const range = stillNeeds.get(n.id);
            if (range === undefined) return n;
            const os = (n.observed_state ?? {}) as { value?: number; raw_value?: number };
            const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
            /**
             * ⛔ A FACTOR WITH NO VALUE IS LEFT WITHOUT ONE. `ObservedStateSchema`
             * requires `value`, so attaching a range here would mean inventing a
             * baseline — and a zero baseline is the exact fabrication this lane
             * refuses ("an absent value is unknown, never zero"). It is also
             * unnecessary: the baseline gate skips a factor with no value
             * outright (`if (baseline === undefined) continue`), so an unvalued
             * factor was never what blocked the analysis. Only a factor that
             * ALREADY carries a bare amount gets the range.
             */
            if (typeof raw !== 'number') { frames.delete(n.id); return n; }
            framedHere.push({ factor: n.label, range });
            return { ...n, observed_state: { ...os, value: raw / range, raw_value: raw, cap: range, declared_scale: 'unit_interval' } };
          });
          if (framedHere.length > 0) {
            const framedGraph = preserveSiblingQuantities(base.raw, { ...base.raw, nodes: patched, edges: base.edges },
              levelInputs.filter(l => l.figure.raw_value !== undefined || (mergeInterventionSourceObjects(base.nodes.find(n => n.id === l.option_id) ?? {})[l.factor_id] as { value?: unknown } | undefined)?.value !== l.value
                || l.figure.likely_range !== undefined).map(l => ({ optionId: l.option_id, factorId: l.factor_id })));
            if (framedGraph.kind === 'refused') return {
              ok: false, mutated: false, applied: false, proposal_id: decision.proposal.proposal_id,
              refusal: framedGraph.reason, reason: framedGraph.reason,
              ...(framedGraph.reason === SIBLING_LEVEL_UNRESOLVABLE ? { detail: SIBLING_LEVEL_UNRESOLVABLE_SENTENCE, follow_up: SIBLING_LEVEL_UNRESOLVABLE_SENTENCE } : {}), receipts,
            };
            /**
             * ⛔⛔ CAS-GATED, AND IT WAS NOT. This write asserts
             * `edges: before.edges` — the WHOLE edge set as it was at the read
             * on entry to this capability — so without an expected hash it does
             * not merely lose a node change: any edge written in between is
             * silently restored to its old value, the user is told nothing, and
             * the Agent reports the frame as attached.
             *
             * ⚠ THE PROPOSAL CHECK IS NOT THE WRITE CHECK, and it is tempting to
             * think it covers this. `proposals.authorise` is bound to
             * `before.graph_hash`, but that is an in-memory comparison against a
             * hash THIS process read; the register call is the only thing that
             * can refuse ATOMICALLY at the row. Between them another writer can
             * land.
             *
             * The values write below already does this (`expected_graph_hash:
             * carried`), which is what made the omission a gap rather than a
             * design. Same shape, same honest refusal.
             *
             * ⚠ SENT ONLY WHEN NON-EMPTY: the route rejects an empty string
             * outright (`EXPECTED_GRAPH_HASH_INVALID`), and `readGraph` coerces
             * a missing hash to `''`. Omitting it there preserves today's
             * behaviour rather than turning a degraded read into a hard failure.
             */
            /**
             * ⛔ NO WRITE AT ALL WHEN THE RE-READ LEFT NOTHING TO DO — the docblock
             * above promised exactly this and it was false.
             *
             * ⚠ Accepted from independent review of #1743. The gate was
             * `frameById.size`, computed BEFORE the re-read. When a competing writer
             * had already framed every factor, `stillNeeds` was empty, `patched`
             * equalled `base.nodes`, and a byte-identical WHOLE-GRAPH register still
             * went out — minting a model version the user did not cause and taking
             * the overwrite risk this block exists to remove, for nothing.
             *
             * Skipping is honest rather than synthetic: no HTTP call is made and
             * nothing downstream claims a write, because none was made.
             */
            const reg: { status: number; json: Record<string, unknown> } = stillNeeds.size === 0
              ? { status: 200, json: {} }
              : await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
              // ⛔⛔ SPREAD THE WHOLE GRAPH. This sent only `{ nodes, edges }`, so
              // every other top-level key was DELETED by a write whose purpose is
              // to stop the model being overwritten. They are not cosmetic:
              // `computeAnalysisAffectingGraphHashSha256` (`context/graph-hash.ts:149-162`)
              // hashes `options`, `goal_node_id` and `goal_constraints` too, so the
              // frame write destroyed analysis-affecting content. The value-batch
              // write at `:367` had it right all along — same spread, same reason.
              graph: { ...base.raw, ...framedGraph.graph },
              ...(base.graph_hash !== '' ? { expected_graph_hash: base.graph_hash } : {}),
              /**
               * ⭐ AND THE IDENTITY EXPECTATION, from the SAME read these bytes
               * come from. Patching fresh nodes preserves an intervening rename;
               * this REFUSES outright if one lands in the window between that
               * read and the route's own — which the analysis-space hash cannot
               * see, because its projection excludes labels.
               *
               * ⚠ The route enforces this only once CEE #1810 lands. Until then
               * it is an unknown top-level field and is ignored (the register
               * route has no body schema), so sending it early is safe and makes
               * the two land in either order.
               */
              ...(base.graph_identity_hash !== ''
                ? { expected_graph_identity_hash: base.graph_identity_hash }
                : {}),
            });
            if (reg.status !== 200) {
              const code = String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
              failures.push({
                path: 'scale_frame',
                detail: code === 'GRAPH_STALE'
                  ? 'the model changed while this was being prepared, so no range was attached and nothing was written — read it again and propose afresh'
                  : `could not attach a range: http ${reg.status}`,
              });
              framedHere.length = 0;
            } else {
              reencodedSiblings.push(...framedGraph.reencoded);
              for (const cell of framedGraph.reencoded) {
                const level = levelInputs.find(l => l.option_id === cell.option_id && l.factor_id === cell.factor_id);
                const cap = frames.get(cell.factor_id);
                if (level !== undefined && cap !== undefined) level.value = cell.quantity / cap;
              }
              /**
               * ⛔ THE RANGE WRITE IS A COMMIT OF ITS OWN, SO ITS RECEIPT IS THIS APPROVAL'S TOO (writer audit
               * 27 Sep, finding 8). It was never collected: a signed-in approval minted a version here and the
               * result named only the levels' — or, when the levels did not land, none at all. The register
               * route's `model_version` block (`assist.v1.scenario-graph-register.ts`), mapped to the same shape
               * the levels receipt takes below. Absent for a guest (no version is written) and for the skipped
               * write above: nothing is invented. The route reports no turn id for a write sent without an
               * `operation_id`, so `source_turn_id` is the levels path's own "not reported" value.
               */
              const mv = reg.json.model_version as { version_number?: unknown; version_id?: unknown; mutation_id?: unknown } | undefined;
              if (mv !== undefined && mv !== null && typeof mv.version_id === 'string' && mv.version_id !== ''
                && typeof mv.version_number === 'number' && Number.isFinite(mv.version_number)) {
                receipts.push({
                  version: mv.version_number, version_id: mv.version_id,
                  mutation_id: typeof mv.mutation_id === 'string' ? mv.mutation_id : '', source_turn_id: '',
                  ...(framedGraph.reencoded.length > 0 ? { reencoded_siblings: framedGraph.reencoded } : {}),
                });
              }
            }
          }
        }
        let rebased: GraphRead | null;
        try { rebased = framedHere.length > 0 ? await readGraph(ctx.scenario_id) : null; }
        catch (error) {
          if (framedHere.length === 0) throw error;
          return partialWriteOutcome(decision.proposal.proposal_id, receipts,
            laterSaveConflict(error) ? 'range_saved_levels_not_saved' : 'range_saved_levels_unconfirmed', reencodedSiblings);
        }
        // Keep sent coordinates for truthful readback; the proposal's native point remains unchanged.
        for (const l of levelInputs) {
          const encoded = levelOnFinalFrame({ value: l.value as number, ...l.figure },
            frameOf((rebased ?? before).nodes.find(n => n.id === l.factor_id)));
          l.value = encoded.value;
          l.figure = { ...l.figure, ...(encoded.cap !== undefined ? { cap: encoded.cap } : {}) };
        }
        let baseHash = rebased?.graph_hash ?? before.graph_hash;
        /** The levels THIS approval's own writes committed — see the read-back below. */
        const ownLevelWrite = new Set<string>();
        /** The level each own write committed: from its OWN response's committed post-state when present, else what it sent. */
        const ownLevel = new Map<string, number>();
        const ownCoordinate = new Map<string, { value: number; raw_value?: number; cap?: number; unit?: string }>();
        /** Levels whose COMMITTED value is known exactly (the write's own `draft_graph`), not just the value sent. */
        const ownLevelExact = new Set<string>();
        /**
         * ⭐ EVERY LEVEL OF THE APPROVAL AS ONE COMMIT (Canonical #70 5847348206): the product's N-ary level writer, CAS'd
         * on the approved revision (or the one our range write produced) — any pair refused means none committed. Its one
         * committed revision is OUR revision for every level; the read-back below still decides what the model holds.
         */
        let res: CommitOptionLevelsResult;
        try {
          res = await opts.commitOptionLevels({
          scenario_id: ctx.scenario_id,
          base_graph_hash: baseHash,
          turn_id: authorisationTurnId(`${decision.proposal.proposal_id}#levels`),
          links: [],
          levels: levelInputs.map(l => ({ option_id: l.option_id, factor_id: l.factor_id, value: l.value as number, author: l.author, ...l.figure })),
        });
        } catch (error) {
          if (framedHere.length === 0) throw error;
          return partialWriteOutcome(decision.proposal.proposal_id, receipts,
            laterSaveConflict(error) ? 'range_saved_levels_not_saved' : 'range_saved_levels_unconfirmed', reencodedSiblings);
        }
        if (res.status === 'refused' && res.reason === SIBLING_LEVEL_UNRESOLVABLE && framedHere.length === 0) return {
          ok: false, mutated: false, applied: false, proposal_id: decision.proposal.proposal_id,
          refusal: res.reason, reason: res.reason, detail: SIBLING_LEVEL_UNRESOLVABLE_SENTENCE, follow_up: SIBLING_LEVEL_UNRESOLVABLE_SENTENCE, receipts,
        };
        if (res.status === 'unconfirmed') {
          if (framedHere.length > 0) return partialWriteOutcome(decision.proposal.proposal_id, receipts, 'range_saved_levels_unconfirmed', reencodedSiblings);
          return {
            ok: false, mutated: true, applied: false, proposal_id: decision.proposal.proposal_id, refusal: 'not_confirmed', receipts,
            detail: 'The option levels were sent as one change, but Olumi could not read the model back to confirm them. Say exactly that; never say they were saved or not saved.',
          };
        }
        if (res.status === 'committed') {
          reencodedSiblings.push(...(res.reencoded_siblings ?? []));
          baseHash = res.graph_hash;
          for (const l of levelInputs) {
            ownLevelWrite.add(l.path);
            // The level the commit stored, when the writer reports it — else what was sent, and never called exact.
            // Each level exactly as the verified read-back of the commit holds it (#2007 `committed_levels`).
            const stored = res.committed_levels.find((c) => c.option_id === l.option_id && c.factor_id === l.factor_id);
            ownLevel.set(l.path, stored?.value ?? (l.value as number));
            if (stored !== undefined) {
              ownLevelExact.add(l.path);
              if (stored.raw_value !== undefined && stored.cap !== undefined) ownCoordinate.set(l.path, stored);
            }
          }
          if (res.receipt !== null) receipts.push({ ...res.receipt, source_turn_id: res.receipt.source_turn_id ?? '',
            ...((res.reencoded_siblings?.length ?? 0) > 0 ? { reencoded_siblings: res.reencoded_siblings } : {}) });
        } else {
          const labelIn = (id: string): string => before.nodes.find((n) => n.id === id)?.label ?? id;
          const why = res.status === 'stale'
            ? 'the model changed after this was approved, so none of the levels was written'
            : `${res.pair !== undefined ? `the level for ${labelIn(res.pair.option_id)} on ${labelIn(res.pair.factor_id)} was refused` : 'the levels were refused'}, so none of them was written`;
          for (const l of levelInputs) failures.push({ path: l.path, detail: why });
        }

        const afterSet = await readGraph(ctx.scenario_id);
        const byId = new Map((afterSet?.nodes ?? []).map((n) => [n.id, n]));
        /**
         * ⛔ SAVED BY US, THEN CHANGED BY SOMEONE ELSE (Codex challenge on #1851, 5825938003): another writer
         * committed the SAME pair after our write and before this read, so the read shows THEIR level. Detected
         * only when the model moved past OUR last committed revision (`baseHash`), so the handler's own
         * normalisation is never mistaken for another writer.
         */
        // An empty hash is a read that cannot say which revision it saw: never "moved", never "ours" (review 5826841372).
        const hashKnown = afterSet !== null && typeof afterSet.graph_hash === 'string' && afterSet.graph_hash !== '';
        const movedPastUs = hashKnown && afterSet!.graph_hash !== baseHash;
        /** In the USER's scale and unit (review of #1881, 5826400426): the Agent quotes these, never 0.27 for £54. */
        const levelsChangedSince: { option: string; factor: string; saved: number; now: number | null; unit?: string }[] = [];
        let levelsUnread = false;
        const beforeNodeById = new Map((before.nodes ?? []).map((n) => [n.id, n]));
        for (const o of ops) {
          const [optionId, factorId] = o.path.split('::');
          const option = byId.get(optionId);
          const iv = (option?.interventions ?? {})[factorId] as { value?: unknown } | number | undefined;
          const recorded = typeof iv === 'number' ? iv : (iv as { value?: unknown } | undefined)?.value;
          const stored = ((o.value ?? {}) as { raw?: number }).raw;
          applied.push({
            // A node another writer deleted is named from the approved read, never by its id (review 5826841372).
            option: option?.label ?? beforeNodeById.get(optionId)?.label ?? optionId,
            factor: byId.get(factorId)?.label ?? beforeNodeById.get(factorId)?.label ?? factorId,
            requested: typeof stored === 'number' ? stored : Number.NaN,
            // ⛔ ONLY A LEVEL THIS APPROVAL'S OWN WRITE COMMITTED. The read-back alone
            // counted a REFUSED op as recorded whenever the pair already held a level
            // (the old one, or another writer's) — the same false "saved" as the value
            // path. `option_intervention_edit` refuses with 409/422/500 and commits with
            // its own `graph_hash`, so `ownLevelWrite` is decided from our own response.
            recorded: ownLevelWrite.has(o.path) && typeof recorded === 'number' ? recorded : null,
          });
          const mine = ownLevel.get(o.path);
          const row = applied[applied.length - 1]!;
          /**
           * ⛔ A LEVEL THIS APPROVAL COMMITTED IS NEVER "NOT RECORDED" (review of #1881 5826400426; Codex
           * 5826386917). Our own 200 + committed hash is the proof; the read-back only says what the model
           * holds NOW. So an own-written row keeps OUR level, and the present state is reported beside it:
           * changed by someone else (numeric), removed by someone else (absent), or unknown (read failed).
           */
          if (ownLevelWrite.has(o.path) && mine !== undefined) {
            // The op's `cap` is the range the level was divided by (stated, or derived from the figure); none ⇒ already 0–1.
            const opv = (o.value ?? {}) as { cap?: unknown; normalised?: unknown };
            const sent = levelInputs.find(l => l.path === o.path);
            const committed = ownCoordinate.get(o.path);
            const cap = committed !== undefined ? committed.cap
              : sent?.figure.cap ?? (typeof opv.cap === 'number' && opv.cap > 0 ? opv.cap : undefined);
            /**
             * ⛔ COMPARE UN-ROUNDED; ROUND ONLY WHAT IS REPORTED (review of #1881 at 6868825f, 5827673705). A 6-figure round
             * (6 significant figures) applied before the comparison made a precise figure — £1,234,567 — never equal
             * to itself, so ANY unrelated write that moved the graph read as "someone else changed your level".
             */
            const toAbs = (x: number): number => (cap !== undefined ? x * cap : x);
            // What we saved, as the user said it: their own figure when the write committed exactly what was sent.
            const savedAsSent = mine === sent?.value && Number.isFinite(row.requested);
            // Compared against the EXACT committed level in its range, so the only difference left is scale-step noise.
            const savedAbs = committed?.raw_value ?? toAbs(mine);
            const savedUser = savedAsSent ? row.requested : quotable(savedAbs);
            const unitRaw = ((byId.get(factorId) ?? beforeNodeById.get(factorId))?.observed_state as { unit?: unknown } | undefined)?.unit;
            const unit = typeof unitRaw === 'string' && unitRaw.trim() !== '' ? unitRaw.trim() : undefined;
            const current = typeof recorded === 'number' ? recorded : null;
            /**
             * ⛔ WHAT THE MODEL HOLDS NOW, IN ITS OWN FRAME (review 5826841372; Codex 5826779118). Another writer's
             * consented range change renormalises every option level on the factor to KEEP its absolute value
             * (`renormaliseOptionInterventionsForCapChange`): 0.27 of 200 becomes 0.135 of 400, still £54. Read with
             * the proposal's old range that was "someone cut it to £27". So the current level is converted with the
             * FRESH factor's range, cross-checked against the absolute the renormaliser stamps (`raw_value`); a frame
             * that cannot be established, or the two disagreeing, is unknown — never an invented amount.
             */
            const freshOs = (byId.get(factorId)?.observed_state ?? {}) as { cap?: unknown };
            const freshFrameRaw = byId.get(factorId)?.scale_frame;
            const freshCap = typeof freshOs.cap === 'number' && Number.isFinite(freshOs.cap) && freshOs.cap > 0 ? freshOs.cap
              : typeof freshFrameRaw === 'number' && Number.isFinite(freshFrameRaw) && freshFrameRaw > 1 ? freshFrameRaw : undefined;
            const ivRawValue = (iv as { raw_value?: unknown } | undefined)?.raw_value;
            const stampedAbs = typeof ivRawValue === 'number' && Number.isFinite(ivRawValue) ? ivRawValue : undefined;
            const currentAbs = ((): number | undefined => {
              if (current === null) return undefined;
              if (freshCap !== undefined) {
                const fromFrame = current * freshCap;
                return stampedAbs === undefined || sameAfterScaling(stampedAbs, fromFrame) ? fromFrame : undefined;
              }
              if (stampedAbs !== undefined) return stampedAbs;
              // A level on a factor that had no range then and has none now is already on the user's 0–1 scale.
              return cap === undefined ? current : undefined;
            })();
            const unknown = (): void => { row.recorded = mine; levelsUnread = true; };
            const changed = (nowUser: number | null): void => {
              row.recorded = mine;
              levelsChangedSince.push({ option: row.option, factor: row.factor, saved: savedUser, now: nowUser, ...(unit !== undefined ? { unit } : {}) });
            };
            if (current === null) {
              // Absent now, or the read failed. Only a model read as moved past OUR commit can say someone else
              // removed it; otherwise what it holds now is unknown — never an invented writer, never "not recorded".
              if (movedPastUs) changed(null);
              else unknown();
            } else if (!hashKnown) {
              if (current !== mine) unknown();
            } else if (movedPastUs) {
              row.recorded = mine;
              // Same range: the stored level either IS ours or is not — no arithmetic, no tolerance.
              const sameRange = freshCap === cap;
              // Known only as SENT (no committed post-state): a mismatch may be the product's own normalisation — unknown, never another writer.
              if (sameRange) { if (current !== mine) { if (ownLevelExact.has(o.path)) changed(quotable(toAbs(current))); else unknown(); } }
              else if (currentAbs === undefined) unknown();
              else if (!sameAfterScaling(currentAbs, savedAbs)) changed(quotable(currentAbs));
            }
          }
        }
        const landed = applied.filter((a) => a.recorded !== null);
        if (landed.length === 0 && framedHere.length > 0) {
          /**
           * ⛔⛔ "LEFT THE MODEL UNCHANGED" WAS FALSE HERE (writer audit 27 Sep, finding 8). The range write above
           * had already COMMITTED — the model moved, and a signed-in user got a version — before the levels were
           * refused or found stale. So the approval DID change the model: say so, with the range write's receipt
           * and the factors it framed, and the revision the model is now at. Not `applied` and never
           * `markApplied`: the levels the user approved did not land. `partially_applied`, as `applyCompound`
           * names a refusal after part of an approval landed — "not_applied" beside `mutated: true` would read
           * "Partly saved: none of it was applied".
           */
          return {
            ok: false, mutated: true, applied: false, refusal: 'partially_applied',
            proposal_id: decision.proposal.proposal_id,
            receipts,
            ...(reencodedSiblings.length > 0 ? { reencoded_siblings: reencodedSiblings, follow_up: [partialRangeLevelsWarning(framedHere), ...reencodedSiblings.map(c => c.detail)].join(' ') } : {}),
            detail:
              'This approval attached a range where the analysis needed one, so the model did change: ' +
              framedHere.map((f) => `${f.factor} 0 to ${f.range}`).join(', ') +
              ' (taken from the figure itself, a unit of measurement, not a forecast). But none of the levels were ' +
              'recorded. Read the model again before describing it: someone else may have changed it meanwhile.',
            failures, interventions: applied,
            ranges_added_for_analysis: framedHere,
            ...(res.status !== 'committed' ? { outcome: res.status === 'stale' ? 'range_saved_levels_not_saved' : 'range_saved_levels_refused' } : {}),
            revision_before: before.graph_hash,
            revision_after: afterSet?.graph_hash ?? baseHash,
          };
        }
        if (landed.length === 0) {
          return {
            ok: false, mutated: false, applied: false, refusal: 'not_applied',
            detail:
              'None of the levels were recorded, so this approval left the model unchanged. Read the model again ' +
              'before describing it: someone else may have changed it meanwhile.',
            failures, interventions: applied,
          };
        }
        if (landed.length === applied.length) proposals.markApplied(decision.proposal.proposal_id, receipts);
        return {
          ok: true, mutated: true, applied: true,
          proposal_id: decision.proposal.proposal_id,
          receipts,
          ...(reencodedSiblings.length > 0 ? { reencoded_siblings: reencodedSiblings, detail: reencodedSiblings.map(c => c.detail).join(' '), follow_up: reencodedSiblings.map(c => c.detail).join(' ') } : {}),
          recorded_count: landed.length,
          requested_count: applied.length,
          interventions: applied,
          revision_before: before.graph_hash,
          // A failed read is not a model that never moved: our last committed revision is the one we can prove.
          revision_after: afterSet?.graph_hash ?? baseHash,
          ...(failures.length > 0 ? { failures } : {}),
          ...(levelsChangedSince.length > 0 ? { changed_since_by_another_writer: levelsChangedSince } : {}),
          ...(levelsUnread ? { current_state_unknown: true } : {}),
          ...(framedHere.length > 0 ? { ranges_added_for_analysis: framedHere } : {}),
          not_represented:
            (landed.length < applied.length
              ? `Only some levels were recorded by this approval; ${applied.filter((a) => a.recorded === null).map((a) => `${a.option} \u2192 ${a.factor}`).join(', ')} ${applied.length - landed.length === 1 ? 'was' : 'were'} NOT. `
              : '') +
            (levelsChangedSince.length > 0
              ? levelsChangedSince.map((x) =>
                `${x.option} \u2192 ${x.factor} was saved by this approval, but someone else has since ` +
                (x.now === null ? 'removed it' : 'changed it')).join('; ') +
                ' \u2014 say so, and describe it from the model as it now stands, not as this approval\u2019s level ' +
                '(changed_since_by_another_writer has the figures in the user\u2019s units). '
              : '') +
            (levelsUnread ? 'These levels were saved, but a read afterwards could not confirm what the model holds now, so do not describe its current levels. ' : '') +
            (landed.length < applied.length ? 'The levels that were recorded are' : 'What each option does is now recorded') +
            ' from what the user said, not measured. The model ' +
            'stores each level against the factor\u2019s stated range, so quote the user\u2019s own number back ' +
            'to them, not the normalised one.' +
            (framedHere.length > 0
              ? ' Some factors had no range at all, which would have stopped the analysis running, so one was ' +
                'taken from the figure itself: ' + framedHere.map((f) => `${f.factor} 0 to ${f.range}`).join(', ') +
                '. Say so, and invite a correction \u2014 a range is a unit of measurement, not a forecast.'
              : ''),
        };
      }

      if (ops[0]?.op === 'set_factor_value') {
        /**
         * ⭐ APPLY EACH ADOPTED ASSUMPTION AS ITS OWN `factor_value_edit`, WITH
         * ITS OWN DERIVED IDENTITY. The wire has no batch form, and each event
         * needs a distinct `turn_id` because `(scenario_id, turn_id)` is unique
         * — so the key is derived from the proposal id AND the operation index,
         * which keeps a retry of the same authorisation idempotent per value
         * instead of minting a fresh id every attempt.
         *
         * ⚠ REPRESENTATION LOSS, RECORDED. `FactorValueEditEvent` is `.strict()`
         * and carries `{kind, target_id, value, raw_value?, unit?, field?,
         * applied_from?}` — there is NO provenance field on it, and the handler
         * stamps `observed_state.source` with `USER_EDIT_SOURCE`
         * (`canonicalise-value-ops.ts`) because it was built for the inspector.
         * (`user_explicit` is only the source of the proposal PARAMETER
         * `factor-value-edit.ts` builds, not the stored stamp.) That stamp is
         * right about WHO set the value (the user authorised this exact set)
         * and silent about WHAT IT RESTS ON. The
         * basis therefore survives only in the proposal and in what the Agent
         * says, so the result below tells it to say it.
         *
         * ✅ CLOSED AT THE WRITER (review of #1851, B2; RC #63 5825007295): an adopted Olumi
         * value that arrives WITHOUT levels is stamped `user_assumption` by the writer
         * itself, from a server-internal approved-adoption context (below;
         * `approved-adoption-context.ts`) — the same verified-identity idea as
         * `appliedProvenance`, carried in-process instead of on the wire. Routing it through
         * the compound path was tried first and rejected: it changes this path's per-value
         * identity, partial-outcome and disclosure behaviour.
         */
        const applied: { factor: string; requested: number; recorded: number | null }[] = [];
        const failures: { factor: string; detail: string }[] = [];
        type CommittedValueFact = { operation: number; target: string; native?: number; receipt?: ReceiptSummary };
        type CommittedRangeFact = { ranges: { id: string; range: number; value: number }[]; receipt?: ReceiptSummary };
        const committed: (CommittedValueFact | CommittedRangeFact)[] = [];
        let finalState: GraphRead | null = null;
        // Guest commits have facts but no version receipt. Never manufacture a receipt for them.
        const receiptsOf = (facts: typeof committed): ReceiptSummary[] => facts.flatMap(f => f.receipt ? [f.receipt] : []);
        const readValueChain = async (): Promise<GraphRead | null> => {
          finalState = null;
          const state = await readGraph(ctx.scenario_id);
          if (state === null || !Array.isArray(state.raw.nodes) || state.nodes.length === 0 || !Array.isArray(state.raw.edges)) return null;
          finalState = state;
          return state;
        };
        const finishValueChain = (committed: (CommittedValueFact | CommittedRangeFact)[], outcome: ToolResult | string): ToolResult => {
          const receipts = receiptsOf(committed);
          const result = typeof outcome === 'string'
            ? partialWriteOutcome(decision.proposal.proposal_id, receipts, outcome) : outcome;
          if (committed.length === 0) return result;
          const valueFacts = committed.filter((f): f is CommittedValueFact => 'operation' in f);
          const allValuesRead = finalState !== null && ops.every((o, i) => {
            if (!valueFacts.some(f => f.operation === i)) return false;
            const last = valueFacts.filter(f => f.target === o.path).at(-1)!;
            const node = finalState!.nodes.find(n => n.id === o.path);
            const os = node?.observed_state;
            const native = typeof os?.raw_value === 'number' ? os.raw_value
              : typeof os?.value === 'number' && typeof os.cap === 'number' ? os.value * os.cap : os?.value;
            return typeof native === 'number' && Number.isFinite(native) && (last.native === undefined || native === last.native);
          });
          const allRangesRead = finalState !== null && committed.every(f => !('ranges' in f) || f.ranges.every(range => {
            const os = finalState!.nodes.find(n => n.id === range.id)?.observed_state;
            return os?.cap === range.range && os.raw_value === range.value && os.value === range.value / range.range;
          }));
          const unconfirmed = finalState === null || ((result.ok === true || result.applied === true) && (!allValuesRead || !allRangesRead));
          const finished: ToolResult = unconfirmed && (typeof outcome !== 'string' || outcome === 'values_saved_read_unconfirmed')
            ? { ...result, ...partialWriteOutcome(decision.proposal.proposal_id, receipts, 'values_saved_read_unconfirmed'), current_state_unknown: true }
            : { ...result, mutated: true, receipts };
          // A historical commit can never leave through the no-write branch.
          if (finished.refusal === 'not_applied') {
            return { ...finished, ...partialWriteOutcome(decision.proposal.proposal_id, receipts,
              finalState === null ? 'values_saved_read_unconfirmed' : 'values_saved_remaining_values_refused') };
          }
          if (finished.ok === true && finished.applied === true && allValuesRead && allRangesRead && result.partially_applied !== true) {
            proposals.markApplied(decision.proposal.proposal_id, receipts);
          }
          return finished;
        };
        /**
         * Did THIS approval's own write for that factor actually land? Decided per
         * operation by `valueWriteCommittedByThisRequest` — see its docblock for what the
         * served response carries and why nothing else can satisfy it.
         *
         * ⛔⛔ IT USED TO BE `r.status === 200 && (receipt || graph_hash moved)`, and that
         * reported refused writes as saved. A refused `factor_value_edit` answers HTTP 200
         * (the refusal is committed as a turn), a guest gets no receipt, and the graph hash
         * moves for ANY writer — so an unrelated edit landing in the same window turned a
         * refusal into "Saved", and the old value read back became the "recorded" figure.
         */
        /** The frame the factor already carries, read from the pre-write state. */
        const beforeById = new Map((before.nodes ?? []).map((n) => [n.id, n]));
        const capOf = (id: string): number | undefined => {
          const c = ((beforeById.get(id)?.observed_state ?? {}) as { cap?: unknown }).cap;
          return typeof c === 'number' && c > 0 ? c : undefined;
        };
        for (let i = 0; i < ops.length; i += 1) {
          const o = ops[i];
          const v = (o.value ?? {}) as { value?: number; unit?: string };
          if (typeof v.value !== 'number') { failures.push({ factor: o.path, detail: 'no value stored on the proposal' }); continue; }
          const approvedValue = v.value;
          const send = () => dispatch('/orchestrate/v2/turn', {
            kind: 'system_event',
            turn_id: authorisationTurnId(`${decision.proposal.proposal_id}#${i}`),
            scenario_id: ctx.scenario_id,
            stage: 'frame',
            event: {
              kind: 'factor_value_edit',
              target_id: o.path,
              // Same coherent {model, native} pair as the compound path — see the note
              // there. Only when the factor already carries a cap.
              ...(capOf(o.path) !== undefined
                ? { value: approvedValue / (capOf(o.path) as number), raw_value: approvedValue }
                : { value: approvedValue }),
              ...(v.unit !== undefined && v.unit !== '' ? { unit: v.unit } : {}),
              // S2: a figure the user wrote, confirmed from their statement, is their authorship even though it is unchanged
              // (schemas 0.62.0 `intent: 'set'`); without it the writer reads an unchanged value as a review.
              ...((v as { confirmed_from?: unknown }).confirmed_from !== undefined && valueOpAuthor(o, decision.proposal) === 'user_stated'
                ? { intent: 'set' as const } : {}),
            },
          });
          // ⭐ OLUMI'S FIGURE, ADOPTED, IS STORED AS AN ASSUMPTION (review of #1851, B2; RC #63
          // 5825007295). This proposal was verified by `proposals.authorise` above (scenario,
          // user, base revision), so its identity rides the in-process dispatch as a
          // server-internal context — never a wire field — and the writer stamps
          // `user_assumption` for exactly this target and value. A value the USER authored
          // (a revision they named, even inside a proposal that also holds Olumi's figures —
          // `valueOpAuthor`) sends no context: the writer's own stamp is the truth.
          let r: Awaited<ReturnType<InternalDispatch>>;
          finalState = null;
          try {
            r = valueOpAuthor(o, decision.proposal) === 'model_proposed'
              ? await runWithApprovedAdoption(
                { scenarioId: ctx.scenario_id, proposalId: decision.proposal.proposal_id, targetId: o.path, rawValue: approvedValue }, send)
              : await send();
            r = { ...r, json: r.json ?? {} };
          } catch (error) {
            if (committed.length === 0) throw error;
            return finishValueChain(committed,
              laterSaveConflict(error) ? 'values_saved_remaining_values_not_saved' : 'values_saved_remaining_values_unconfirmed');
          }
          // ⛔ OWN-WRITE EVIDENCE, PER OP, FROM THIS REQUEST'S OWN RESPONSE (Codex
          // 5810763729 item 4). A later read cannot tell "my write landed" from "the old
          // number was already there" or "someone else wrote it".
          const own = valueWriteCommittedByThisRequest(r, o.path);
          if (r.status !== 200) failures.push({ factor: o.path, detail: `http ${r.status}` });
          else if (!own) {
            // A 200 that is not this op's committed write: a refusal (committed as a turn,
            // nothing written) or a no-op. Olumi's own words say which, so they travel.
            const said = typeof r.json.assistant_text === 'string' ? r.json.assistant_text.trim() : '';
            failures.push({ factor: o.path, detail: said !== '' ? said : 'not recorded by this approval' });
          }
          const rc = receiptSummaryOf(r.json);
          // A receipt is reported only alongside this op's own committed write, so the
          // result can never pair "not recorded" with "saved as version N".
          if (own) committed.push({ operation: i, target: o.path, native: ownCommittedNative(r, o.path),
            ...(rc.summary !== null ? { receipt: rc.summary } : {}) });
          if (rc.unreadable) failures.push({ factor: o.path, detail: 'a receipt arrived but could not be read' });
        }

        // ⛔ CONFIRMED FROM STATE. The handler may rescale what it was sent
        // (unit caps, percent-vs-fraction), so the recorded number is read back
        // and reported EVEN WHEN it differs from the one the user approved —
        // that difference is exactly the thing a user must not discover later.
        const valueSaveCommitted = committed.length > 0;
        let afterSet: GraphRead | null;
        try { afterSet = await readValueChain(); }
        catch (error) {
          if (!valueSaveCommitted) throw error;
          return finishValueChain(committed, 'values_saved_read_unconfirmed');
        }
        if (afterSet === null && valueSaveCommitted) {
          return finishValueChain(committed, 'values_saved_read_unconfirmed');
        }
        const byId = new Map((afterSet?.nodes ?? []).map((n) => [n.id, n]));
        const superseded: { id: string; factor: string; saved: number; now: number }[] = [];
        for (const [i, o] of ops.entries()) {
          const own = committed.some(f => 'operation' in f && f.operation === i);
          const node = byId.get(o.path);
          const sos = (node?.observed_state ?? {}) as { value?: unknown; raw_value?: unknown; cap?: unknown };
          const sCap = typeof sos.cap === 'number' && sos.cap > 0 ? sos.cap : undefined;
          /**
           * ⛔ READ BACK THE NATIVE FIGURE, AND ONLY CALL IT SAVED IF THIS WRITE PUT IT
           * THERE (Codex 5810763729 item 4).
           *
           * The old line was `recorded: typeof stored === 'number' ? stored : null` over
           * `observed_state.value`, and `landed` was every row whose `recorded` was not
           * null. Both halves were wrong in the same direction: a factor that ALREADY
           * held 0.7 still reads a number back after a refused write, so the refusal was
           * reported as "Saved", and the number shown was the model's divisor rather than
           * the user's own. So: read the native figure (`raw_value`, else the model value
           * scaled back up by the cap), and require THIS operation's own committed write
           * (`committed`, from its own response — never a receipt-or-hash guess).
           *
           * ⚠ A RESCALE IS STILL REPORTED, NOT SUPPRESSED. When the handler stores a
           * different number from the one approved, `recorded` carries what is actually
           * in the model and the caller names the difference — that behaviour is the
           * point of reading state back and it is deliberately unchanged. What is new is
           * that a row with NO write behind it can no longer count as landed.
           */
          const storedNative =
            typeof sos.raw_value === 'number'
              ? sos.raw_value
              : typeof sos.value === 'number' && sCap !== undefined
                ? sos.value * sCap
                : typeof sos.value === 'number'
                  ? sos.value
                  : undefined;
          const req = ((o.value ?? {}) as { value?: number }).value;
          applied.push({
            factor: node?.label ?? o.path,
            requested: typeof req === 'number' ? req : Number.NaN,
            // ⛔ NO EXTRA KEY ON THIS ROW. An earlier version added `no_write_recorded: true`
            // to rows with no own-write evidence, and `adopt-assumptions.test.ts` — a
            // DIFFERENT file, whose reader set I had not derived — asserts this row's exact
            // shape: "expected [{…(3)},{…(4)}] to deeply equal [{…(3)},{…(3)}]". `recorded:
            // null` already carries the whole meaning, so the diagnostic key is dropped
            // rather than the contract widened.
            recorded: own && storedNative !== undefined ? storedNative : null,
          });
          /**
           * ⛔ SAVED BY US, THEN CHANGED BY SOMEONE ELSE (Codex pre-review of #1851, 5825735512).
           * Our write committed, but the fresh read holds a different figure from the one OUR
           * commit stored: another writer changed the same target in between. The row then keeps
           * what THIS approval saved (the historical fact) — never the other writer's figure as a
           * "rescale" — and the present state is reported separately. Nothing after this point
           * frames, re-reads or describes that target as this approval's.
           */
          const mine = committed.filter((f): f is CommittedValueFact => 'operation' in f && f.target === o.path).at(-1)?.native;
          const last = applied[applied.length - 1]!;
          if (own && mine !== undefined && storedNative !== undefined && storedNative !== mine) {
            last.recorded = mine;
            superseded.push({ id: o.path, factor: last.factor, saved: mine, now: storedNative });
          }
        }
        const landed = applied.filter((a) => a.recorded !== null);
        /**
         * ⛔ EVERYTHING AFTER THE VALUE WRITES FOLLOWS WHAT THIS APPROVAL COMMITTED, NOT WHAT IT
         * PROPOSED (Codex pre-review of #1851, 5825603926). With one value landed and another
         * refused, the range framing below selected every PROPOSAL op, so it could rescale and
         * register the refused target — a write to a factor whose own write was just refused — and
         * the note said the refused value was "stored". Aligned with `applied` by index.
         */
        const supersededIds = new Set(superseded.map((x) => x.id));
        const landedOps = ops.filter((o, i) => applied[i] !== undefined && applied[i]!.recorded !== null && !supersededIds.has(o.path));
        const notLandedLabels = ops
          .filter((_, i) => applied[i] === undefined || applied[i]!.recorded === null)
          .map((o) => beforeById.get(o.path)?.label ?? o.path);
        if (landed.length === 0) {
          return finishValueChain(committed, {
            ok: false, mutated: false, applied: false, refusal: 'not_applied',
            // ⛔ NOT "the model is unchanged": a refusal proves only that THIS approval
            // wrote nothing. Another writer may have changed the model in the same window.
            detail:
              'None of the values were recorded, so this approval left the model unchanged. Read the model again ' +
              'before describing it: someone else may have changed it meanwhile.',
            failures, values: applied,
          });
        }

        /**
         * ⭐ ATTACH A SCALE FRAME TO ANYTHING THAT LANDED AS A BARE AMOUNT.
         *
         * ⛔ WHY THIS SECOND WRITE EXISTS, measured end to end. A factor above
         * 1 with no `cap` is refused by `run_analysis`
         * (`baseline_scale_unresolved`) and the refusal is permanent:
         * `factor_value_edit` is `.strict()` with no cap field, and posting a
         * `{value, raw_value}` pair is accepted with HTTP 200 then normalised
         * back to `raw === value`. Construction publishes the frame inside
         * `observed_state`, which survives because `ObservedStateSchema` is
         * `.passthrough()` — but a factor with NO baseline at construction has
         * no `observed_state` to carry one (`value` is required), and a
         * node-level `cap` is stripped by `NodeV3Schema`. So a factor that
         * gets its first value HERE, by adoption, would be unanalysable for
         * the life of the model.
         *
         * Measured on the deployed build: with the frame attached this way,
         * `analysis_ready` went `blocked` -> `ready`, blockers 0, and the run
         * produced win probabilities over 10,000 samples per option. Without
         * it, the same model refused.
         *
         * ⚠ The frame is DERIVED from the user's own number, `raw_value` keeps
         * that number untouched, and it is reported so the Agent says it.
         */
        const needsFrame = (afterSet?.nodes ?? []).filter((n) => {
          if (!landedOps.some((o) => o.path === n.id)) return false;
          const os = (n.observed_state ?? {}) as { value?: unknown; cap?: unknown };
          // ⛔ A factor that already carries a stored range was written ON it
          // by the value handler. A level above 1 there is the honest truth
          // about an over-range figure; deriving a new range for it would
          // rescale the baseline away from every option level on that factor.
          if (typeof n.scale_frame === 'number' && n.scale_frame > 1) return false;
          return typeof os.value === 'number' && Math.abs(os.value) > 1 && typeof os.cap !== 'number';
        });
        /**
         * ⛔⛔ CARRIES THE STABLE NODE ID, and the id is the load-bearing part.
         *
         * ⚠ CHANGES_REQUIRED from independent review of #1743, accepted. This list
         * held only the visible `label`, and the post-refusal readback joined the
         * fresh canonical nodes by `Map<label, node>` — where the LAST duplicate
         * label wins. Production-shaped counterexample: factors A and B both
         * display "Revenue"; A's frame is still absent after GRAPH_STALE, B is
         * framed by another writer and appears later in the fresh list. The map
         * resolved A's "Revenue" to B, dropped A, and told the user every factor
         * now has a range — while A still blocked the analysis. A label is a value
         * another object can satisfy; binding a claim to one is the estate's own
         * named trap, and I walked into it while fixing the rename case.
         *
         * ⭐ An id join also subsumes the rename case for free: the node is found,
         * and its CURRENT label is what the user is shown.
         *
         * `id` is internal only — it is stripped before the wire (`toWire` below)
         * so the emitted payload shape is unchanged, byte for byte.
         */
        type IntendedFrame = { id: string; factor: string; value: number; range: number };
        const toWire = (f: IntendedFrame) => ({ factor: f.factor, value: f.value, range: f.range });
        const framed: IntendedFrame[] = [];
        /** The ranges this turn INTENDED to attach but could not — kept so a
         *  failure can name which factors still have no range, instead of the
         *  reply implying nothing was written at all. */
        let rangesNotAttached: IntendedFrame[] = [];
        /**
         * ⛔ THE FIELD NAME MUST CARRY ITS OWN GUARANTEE. A consumer cannot tell a
         * verified absence from an intended one, so `ranges_not_attached` is
         * emitted ONLY when a post-refusal readback confirmed the factor still has
         * no range. When the readback fails this is set instead, and the consumer
         * says the present state is unknown rather than advising.
         *
         * CHANGES_REQUIRED on #1751 `f028650d`: the deterministic consumer turned
         * that event field into a present-state claim ("unchanged", "still needs a
         * range", "do not re-enter") with no readback between the refusal and the
         * sentence. Fixing only the consumer would leave the next consumer free to
         * make the same mistake; the contract is fixed here.
         */
        let currentStateUnknown = false;
        let partialOutcome: string | undefined;
        if (needsFrame.length > 0 && afterSet !== null) {
          const frameById = new Map<string, number>();
          for (const n of needsFrame) {
            const os = n.observed_state as { value: number; raw_value?: number };
            const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
            const range = defaultFrameFor(raw);
            if (range <= 1) continue;
            frameById.set(n.id, range);
            // ⛔ `framed` is NOT built here. It is the list reported back to the
            // user as `ranges_added_for_analysis`, and it must describe what the
            // write ACTUALLY DID — which is only knowable after the re-read
            // below decides which factors still need a frame. Building it here
            // meant a 200 reported ranges added for factors the code had
            // deliberately skipped because a competing writer already framed them.
          }
          if (frameById.size > 0) {
          /**
             * ⭐⭐ PATCH THE MODEL AS IT IS NOW, NOT AS IT WAS WHEN WE READ IT.
             *
             * ⛔ THE COUNTEREXAMPLE THIS CLOSES (owner note 5799139118, limb 1):
             * this write sends a WHOLE graph built from an earlier read. The
             * route's expectation is compared in ANALYSIS space, which EXCLUDES
             * labels — so a rename landing between our read and this write passes
             * the comparison and is then overwritten by our stale copy of the node.
             *
             * ⚠ I previously reported limb 1 as wholly uncloseable caller-side and
             * left it to the atomic-writer lease. That was too broad. A caller
             * cannot express an IDENTITY-space expectation — that part is true and
             * still belongs at the write boundary — but it CAN stop replaying stale
             * bytes, which is the other half the owner note named: *"a targeted
             * atomic patch … can avoid replaying the whole stale graph."*
             *
             * So: re-read, patch the FRESH nodes, and send those. An intervening
             * edit is preserved BY CONSTRUCTION rather than by a comparison that
             * cannot see it. The residual window shrinks from "user think-time plus
             * a model call" to the milliseconds between this read and the route's
             * own — and the route's CAS already covers its own read-to-write gap.
             *
             * ⛔ AND IT NEVER CLOBBERS A RANGE SOMEONE ELSE SUPPLIED: a factor that
             * already carries a usable frame in the fresh read is left alone. If
             * that leaves nothing to do, no write is attempted at all.
             *
             * A failed re-read exits with the historical commits; stale bytes cannot
             * establish the current model or authorise the next whole-graph write.
             */
            let nowRead: GraphRead | null;
            try { nowRead = await readValueChain(); }
            catch { return finishValueChain(committed, 'values_saved_read_unconfirmed'); }
            if (nowRead === null) return finishValueChain(committed, 'values_saved_read_unconfirmed');
            const base = nowRead;
            const stillNeeds = new Map<string, number>();
            for (const [id, range] of frameById) {
              const node = base.nodes.find((n) => n.id === id);
              if (node !== undefined && frameOf(node) !== null) continue;
              /**
               * ⛔ AND IT MUST STILL HAVE A VALUE IN THE FRESH BYTES. `needsFrame`
               * validated `typeof os.value === 'number'` against the EARLIER read;
               * `patched` maps over the fresh one. A competing writer that cleared
               * a value therefore yielded `raw === undefined` and put `value: NaN`
               * on the wire — a number the selection filter never validated, on
               * bytes it never saw. The first site has this guard; this one did not.
               * A factor with no value is left without one rather than framed.
               */
              const freshOs = (node?.observed_state ?? {}) as { value?: unknown; raw_value?: unknown };
              const freshRaw = typeof freshOs.raw_value === 'number' ? freshOs.raw_value : freshOs.value;
              if (node === undefined || typeof freshRaw !== 'number' || !Number.isFinite(freshRaw)) continue;
              stillNeeds.set(id, range);
              // ⭐ Reported only now, from the FRESH node, so the sentence the user
              // reads and the bytes that were written are the same fact.
              framed.push({ id: node.id, factor: node.label, value: freshRaw, range });
            }
            const patched = base.nodes.map((n) => {
              const range = stillNeeds.get(n.id);
              if (range === undefined) return n;
              const os = (n.observed_state ?? {}) as { value: number; raw_value?: number };
              const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
              return { ...n, observed_state: { ...os, value: raw / range, raw_value: raw, cap: range, declared_scale: 'unit_interval' } };
            });
            /**
             * ⛔ THE SIBLING OF THE FRAME WRITE ABOVE, and it carried the same
             * omission. `afterSet` is a re-read, so it is fresher — but a read
             * is still a read, and this asserts `edges: afterSet.edges`, the
             * whole edge set as it was at that moment. Without an expected hash
             * a write landing in between is silently restored to its old value.
             *
             * ⚠ I CLAIMED THIS WAS FIXED ONCE AND IT WAS NOT. The claim went
             * into a commit message and a PR body while only the first site had
             * changed. Fixed now, and the guard below counts BOTH.
             */
            /**
             * ⛔ NO WRITE AT ALL WHEN THE RE-READ LEFT NOTHING TO DO — the docblock
             * above promised exactly this and it was false at BOTH sites.
             *
             * ⚠ Accepted from independent review of #1743. The gate was
             * `frameById.size`, computed BEFORE the re-read. When a competing writer
             * had already framed every factor, `stillNeeds` was empty, `patched`
             * equalled `base.nodes`, and a byte-identical WHOLE-GRAPH register still
             * went out — minting a model version the user did not cause and taking
             * the overwrite risk this block exists to remove, for nothing.
             *
             * Skipping is honest rather than synthetic: `framed` is now built inside
             * the `stillNeeds` loop, so it is empty here and
             * `ranges_added_for_analysis` is omitted. No claim, because no write.
             */
            let reg: { status: number; json: Record<string, unknown> };
            try {
              if (stillNeeds.size > 0) finalState = null;
              reg = stillNeeds.size === 0
              ? { status: 200, json: {} }
              : await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
              // ⛔⛔ SPREAD THE WHOLE GRAPH. This sent only `{ nodes, edges }`, so
              // every other top-level key was DELETED by a write whose purpose is
              // to stop the model being overwritten. They are not cosmetic:
              // `computeAnalysisAffectingGraphHashSha256` (`context/graph-hash.ts:149-162`)
              // hashes `options`, `goal_node_id` and `goal_constraints` too, so the
              // frame write destroyed analysis-affecting content. The value-batch
              // write at `:367` had it right all along — same spread, same reason.
              graph: { ...base.raw, nodes: patched, edges: base.edges },
              ...(base.graph_hash !== '' ? { expected_graph_hash: base.graph_hash } : {}),
              /**
               * ⭐ AND THE IDENTITY EXPECTATION, from the SAME read these bytes
               * come from. Patching fresh nodes preserves an intervening rename;
               * this REFUSES outright if one lands in the window between that
               * read and the route's own — which the analysis-space hash cannot
               * see, because its projection excludes labels.
               *
               * ⚠ The route enforces this only once CEE #1810 lands. Until then
               * it is an unknown top-level field and is ignored (the register
               * route has no body schema), so sending it early is safe and makes
               * the two land in either order.
               */
              ...(base.graph_identity_hash !== ''
                ? { expected_graph_identity_hash: base.graph_identity_hash }
                : {}),
            });
              reg = { ...reg, json: reg.json ?? {} };
            } catch (error) {
              return finishValueChain(committed,
                laterSaveConflict(error) ? 'values_saved_range_not_saved' : 'values_saved_range_unconfirmed');
            }
            if (reg.status !== 200) {
              partialOutcome = laterSaveConflict(reg) ? 'values_saved_range_not_saved' : 'values_saved_range_refused';
              const code = String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
              /**
               * ⛔⛔ "NOTHING WAS WRITTEN" WAS UNTRUE HERE, AND IT IS THE WORST
               * KIND OF UNTRUE: the values were already saved, in their own
               * registration, BEFORE this frame write was attempted. Telling the
               * user nothing landed invites them to redo a write that succeeded.
               *
               * The two outcomes are now reported SEPARATELY — what was saved,
               * and what was not attached — because they are separately true.
               * The unattached list is captured before `framed` is cleared;
               * clearing it was itself losing the only record of which factors
               * still have no range.
               */
              rangesNotAttached = [...framed];
              const savedSomething = landed.length > 0;
              if (code === 'GRAPH_STALE' || laterSaveConflict(reg)) {
                /**
                 * ⛔⛔ THE REFUSAL ESTABLISHES ONE THING ONLY: *THIS* FRAME WRITE
                 * DID NOT LAND. It establishes nothing about the current model.
                 *
                 * ⚠ CHANGES_REQUIRED on a6dc18be, accepted in full. My previous
                 * wording asserted that the approved values were "unchanged",
                 * that "only the range" was missing, and that the analysis was
                 * "still blocked" — then told the user not to re-enter anything.
                 * But GRAPH_STALE means a COMPETING WRITER moved the canonical
                 * graph after the `afterSet` read. That writer may have changed a
                 * value, attached a range, or removed the factor. Every one of
                 * those sentences was authority the stale read cannot support,
                 * and the last one is advice that could lose the user's work.
                 *
                 * So: RE-READ, and describe only what the fresh read shows. When
                 * the read is unavailable, report the HISTORICAL EVENT and say
                 * the current state is unknown — never advise on a state we could
                 * not observe.
                 */
                const fresh = await readValueChain().catch(() => null);
                if (fresh === null) {
                  // Nothing here is verified, so nothing is claimed: the list is
                  // dropped and the unknown marker travels in its place.
                  rangesNotAttached = [];
                  currentStateUnknown = true;
                  failures.push({
                    factor: 'scale_frame',
                    detail: savedSomething
                      ? /**
                       * ⚠ THE HISTORICAL FACT IS BOUND TO ITS OWN TENSE. I asked
                       * the reviewer whether to withhold it entirely; on
                       * reflection that is my call, and withholding it is worse —
                       * it is the one thing that stops a user redoing a write
                       * that was accepted. What matters is that it cannot be
                       * READ as a current-state claim, so the sentence says the
                       * writes were accepted AT THE TIME and that whether those
                       * values are still in the model is unknown, rather than
                       * stating a fact and an UNKNOWN side by side.
                       */
                      'the model changed while the range was being attached, and it could not be read back afterwards. This turn\u2019s value writes were accepted AT THE TIME, and its range write was refused. Whether those values are still in the model, whether they now carry a range, and whether the analysis can run are ALL UNKNOWN, because the model could not be read. Read it again before describing or advising anything \u2014 and do not tell the user their figures are safe.'
                      : 'the model changed while this was being prepared and could not be read back. No range was attached by this turn; the current state is unknown — read it again and propose afresh.',
                  });
                } else {
                  // Derived from the FRESH read, never from what we intended:
                  // a competing writer may already have supplied a range.
                  /**
                   * ⭐⭐ KEYED ON `id`, WHICH IS THE ONLY KEY THAT CANNOT COLLIDE.
                   *
                   * A label join silently resolved one factor to a DIFFERENT factor
                   * sharing its label (see the `IntendedFrame` note above), and it
                   * could not find a renamed one at all. An id join answers both:
                   * present-and-framed, present-and-still-unranged, or absent.
                   *
                   * ⚠ And the message is built from the FRESH node's label, not the
                   * one this turn remembered — after a rename the user is shown the
                   * name the model now uses, not a name that no longer exists.
                   */
                  const byId = new Map<string, GraphRead['nodes'][number]>();
                  for (const n of fresh.nodes) {
                    const id = String((n as { id?: unknown }).id ?? '');
                    if (id !== '') byId.set(id, n);
                  }
                  /**
                   * ⛔⛔ AND A LABEL THAT IS NOT IN THE FRESH READ PROVES NOTHING.
                   * The join is on `label`, so a factor a competing writer RENAMED
                   * — the exact case GRAPH_STALE fires for — is simply absent from
                   * `byLabel`. `frameOf(undefined)` is null, so it survived the
                   * filter and was then printed BY ITS OLD LABEL as "still has no
                   * range": a present-state claim about a name the model no longer
                   * uses, from a read that never saw it. That is the same
                   * fabrication as the refusal copy this block was written to fix.
                   *
                   * So the three cases are separated. Found and unranged → named.
                   * Found and framed → dropped, someone supplied one. NOT FOUND →
                   * dropped from the named list and disclosed as unaccounted for,
                   * without asserting anything about it.
                   */
                  const unaccounted = rangesNotAttached.filter((f) => byId.get(f.id) === undefined);
                  const stillUnranged = rangesNotAttached
                    .filter((f) => byId.get(f.id) !== undefined && frameOf(byId.get(f.id)) === null)
                    // ⭐ The CURRENT label, from the fresh read. A factor renamed by
                    // a competing writer is named as the model now names it.
                    .map((f) => ({ ...f, factor: String((byId.get(f.id) as { label?: unknown }).label ?? f.factor) }));
                  rangesNotAttached = stillUnranged;
                  failures.push({
                    factor: 'scale_frame',
                    detail: savedSomething
                      ? 'the model changed while the range was being attached, so this turn attached none. Read back afterwards, ' +
                        (stillUnranged.length > 0
                          ? `these still have no range: ${stillUnranged.map((f) => f.factor).join(', ')}. Describe the values from that read, not from what was approved — someone else may have changed them.`
                          : 'every factor that could be found now has a range, so someone else supplied one. Describe the model from that read before advising anything.')
                        + (unaccounted.length > 0
                          ? ` ⚠ ${unaccounted.length} factor(s) this turn tried to frame could not be found in that read at all — they may have been renamed or removed, so nothing is claimed about them; read the model as it now stands.`
                          : '')
                      : 'the model changed while this was being prepared, so this turn attached no range. Read the model as it now stands before proposing again.',
                  });
                }
              } else {
                const fresh = await readValueChain().catch(() => null);
                if (fresh === null) currentStateUnknown = true;
                failures.push({
                  factor: 'scale_frame',
                  detail: `could not attach a range: http ${reg.status}`,
                });
              }
              framed.length = 0;
            }
            if (reg.status === 200 && stillNeeds.size > 0) {
              const mv = reg.json.model_version as { version_number?: unknown; version_id?: unknown; mutation_id?: unknown } | undefined;
              committed.push({ ranges: framed.map(f => ({ id: f.id, range: f.range, value: f.value })),
                ...(typeof mv?.version_id === 'string' && typeof mv.version_number === 'number'
                  ? { receipt: { version: mv.version_number, version_id: mv.version_id,
                    mutation_id: typeof mv.mutation_id === 'string' ? mv.mutation_id : '', source_turn_id: '' } } : {}) });
            }

          }
        }
        /**
         * ⛔⛔ RE-DERIVE THE SUBSTITUTION FROM THE FINAL WRITE, NOT THE FIRST ONE.
         *
         * ⚠ CHANGES_REQUIRED at `4c2d40b6`, accepted in full, and it is the same
         * shape as the disclosure defect one layer down: the READER was innocent
         * and the PRODUCER was wrong.
         *
         * `applied` is built from `afterSet` — the read taken BEFORE the scale
         * frame is attached. So for an approved bare amount of 40 with no prior
         * range: the frame write below registers `{value: 0.4, raw_value: 40,
         * cap: 100}`, but `rescaled` was computed from the earlier row (40 → 40)
         * and came out EMPTY. The model then computes with 0.4 while the reply
         * said the approved figures were "stored unchanged".
         *
         * That is the authorship failure this lane exists to prevent: the person
         * approved 40, the analysis uses 0.4, and the translation was invisible.
         * No consumer could recover it, because the fact was never emitted.
         *
         * So the recorded side is re-read from the bytes that actually landed. A
         * failed re-read exits through the same door with the committed facts and
         * the ACKed read-unconfirmed outcome.
         */
        let recordedUnread = false;
        if (framed.length > 0) {
          const finalRead = await readValueChain().catch(() => null);
          if (finalRead === null) return finishValueChain(committed, 'values_saved_read_unconfirmed');
          const finalById = new Map((finalRead?.nodes ?? []).map((n) => [n.id, n]));
          const framedRangeByLabel = new Map(framed.map((f) => [f.factor, f.range]));
          for (let i = 0; i < ops.length; i += 1) {
            const row = applied[i];
            if (row === undefined || row.recorded === null || supersededIds.has(ops[i].path)) continue;
            const node = finalById.get(ops[i].path);
            const finalValue = node?.observed_state?.value;
            if (typeof finalValue === 'number') {
              row.recorded = finalValue;
              continue;
            }
            // Fresh read unusable for this node: derive from what we sent.
            const range = framedRangeByLabel.get(row.factor);
            if (typeof range === 'number' && range > 1 && typeof row.requested === 'number') {
              row.recorded = row.requested / range;
              recordedUnread = true;
            }
          }
        }
        const rescaled = landed.filter((a) => a.recorded !== a.requested);
        const incomplete = partialOutcome !== undefined || landed.length < applied.length;
        return finishValueChain(committed, {
          ok: !incomplete || !useAppendV6(), mutated: true, applied: !incomplete || !useAppendV6(),
          ...(incomplete && useAppendV6() ? { refusal: 'partially_applied', partially_applied: true,
            outcome: partialOutcome ?? 'values_saved_remaining_values_refused',
            detail: PARTIAL_WRITE_MESSAGES[partialOutcome ?? 'values_saved_remaining_values_refused'] } : {}),
          proposal_id: decision.proposal.proposal_id,
          adopted_count: landed.length,
          requested_count: applied.length,
          values: applied,
          revision_before: before.graph_hash,
          revision_after: afterSet?.graph_hash ?? before.graph_hash,
          ...(failures.length > 0 ? { failures } : {}),
          ...(superseded.length > 0 ? { changed_since_by_another_writer: superseded.map(({ factor, saved, now }) => ({ factor, saved, now })) } : {}),
          ...(rescaled.length > 0
            ? { rescaled_by_the_model: rescaled, must_disclose_rescaling: true }
            : {}),
          ...(framed.length > 0 ? { ranges_added_for_analysis: framed.map(toWire) } : {}),
          /**
           * ⭐ THE PARTIAL OUTCOME, STATED RATHER THAN IMPLIED. A value write and
           * a frame write are two registrations; the first can land and the
           * second refuse. Reporting only aggregate success let the reply claim
           * "applied" while the analysis was still blocked.
           *
           * `partially_applied` is this file's existing word for it (`:395`,
           * `:463`). Present only when it is true, so its presence is the signal.
           */
          // ⚠ PRESENT-STATE UNKNOWN, stated rather than implied by an absence.
          // Travels even when `ranges_not_attached` is empty, which is exactly
          // when a consumer must not advise.
          ...(currentStateUnknown ? { partially_applied: true, current_state_unknown: true } : {}),
          ...(rangesNotAttached.length > 0
            ? {
              partially_applied: true,
              ranges_not_attached: rangesNotAttached.map(toWire),
              // A factor whose amount has no range cannot be read against
              // anything, so the analysis stays blocked for it whatever else
              // landed. Named, so the Agent cannot report a clean success.
              // ⚠ DERIVED FROM THE FRESH READ, not from what this turn intended.
              // On GRAPH_STALE `rangesNotAttached` has already been filtered to
              // the factors a re-read shows STILL have no range; when the read
              // failed it is the unfiltered intent and the detail above says the
              // current state is unknown, so nothing here claims otherwise.
              analysis_still_blocked_for: rangesNotAttached.map((f) => f.factor),
            }
            : {}),
          // Per value, whoever authored the proposal (Codex 5825564214: a user-only revision was still told
          // "adopted assumptions … no mark", though it is stored as the user's own figure).
          not_represented:
            `${valueAuthorshipNote(landedOps, decision.proposal, (id) => beforeById.get(id)?.label ?? id)}` +
            (notLandedLabels.length > 0
              ? ` ${notLandedLabels.join(', ')} ${notLandedLabels.length === 1 ? 'was' : 'were'} NOT recorded by this approval.`
              : '') +
            (superseded.length > 0
              ? ' ' + superseded.map((x) => `${x.factor} was saved by this approval as ${x.saved}, but someone else has since changed it to ${x.now}`).join('; ') +
                ' — describe it from the model as it now stands, not as this approval\u2019s figure.'
              : '') +
            ' Say so when you describe what changed' +
            (rescaled.length > 0 ? ', and state every value the model stored differently from the one approved.' : '.') +
            (rangesNotAttached.length > 0
              ? ' \u26a0 This turn could not attach a range to ' +
                rangesNotAttached.map((f) => f.factor).join(', ') +
                ' because the model changed underneath it. Describe those factors from the model as it now stands — ' +
                'another person may have changed a value or supplied a range — and do not tell the user their figures ' +
                'are safe or unchanged unless the current model shows it.'
              : '') +
            (framed.length > 0
              ? ' Some of them had no range to be read against, which would have stopped the analysis running ' +
                'at all, so a range was taken from the figure itself: ' +
                framed.map((f) => `${f.factor} 0 to ${f.range}`).join(', ') +
                '. That is a unit of measurement rather than a forecast or a limit. ' +
                // ⛔ "the approved figures are stored unchanged" WAS FALSE, and it was the
                // sentence that hid the whole translation. The user's figure is preserved
                // as the raw value, but the number the analysis computes with is that
                // figure divided by the range — 40 on a 0-to-100 range is 0.4. Both
                // representations must be named, because only then is the authorship
                // legible: the person authored 40, and 0.4 is the product's encoding of it.
                'The figure each person approved is kept exactly as they gave it, and the ' +
                'number the analysis computes with is that figure measured against its range ' +
                '— state BOTH when you describe what changed, never only one. ' +
                (recordedUnread
                  ? 'One or more of those computed figures could not be read back and was derived ' +
                    'from the range instead, so describe it as derived rather than as observed. '
                  : '') +
                'The user should be told and invited to correct any range that is wrong.'
              : ''),
        });
      }

      const op = ops[0];
      const [fromId, toId] = op.path.split('::');
      const { effect_direction: direction, magnitude: storedMagnitude } = op.value as { effect_direction: 'positive' | 'negative'; magnitude?: unknown };
      /**
       * ⭐ THE STRENGTH SENT IS THE USER'S BAND (#70 5845493088): `proposeModelChange` stores the midpoint of the band the
       * user typed, and the writer stamps it `user_specified` — now true. ⚠ A proposal restored from the durable carrier
       * that was made BEFORE that rule carries no magnitude: it keeps the projection default 0.5 and its disclosure
       * (`placeholder_strength`), so nothing restored breaks.
       */
      const usersStrength = typeof storedMagnitude === 'number' && Number.isFinite(storedMagnitude) && storedMagnitude > 0 && storedMagnitude <= 1
        ? storedMagnitude : undefined;
      /**
       * ⭐ THE OPERATION IDENTITY IS DERIVED, NOT MINTED.
       *
       * This was `randomUUID()`. A fresh id per authorisation means a retry of
       * the SAME authorisation is a different operation to every layer beneath
       * it, so `(scenario_id, turn_id)` can never match and the deployed
       * `append_turn_atomic_v5` replay arm is unreachable by construction.
       *
       * The proposal id is already the stable client/operation identity: it is
       * hashed over the scenario, the user, the base revision and the exact
       * operations, so the same authorisation of the same proposal yields the
       * same key, and a different mutation yields a different one.
       *
       * ⚠ This does NOT by itself deliver durable replay. At the served SHA,
       * `structural-add-edge.ts` computes the current hash and refuses
       * `BASE_HASH_DIVERGED` BEFORE `payload.turn_id` is read, so the app-level
       * gate answers first and the DB's replay-before-CAS arm is still not
       * reached. What this change does is make that boundary MEASURABLE rather
       * than masked by an identity that never repeats.
       */
      const drawnValue = op.value as { band?: unknown; author?: unknown; press_id?: unknown };
      const drawnBand = drawnValue.author === 'model_proposed' && isInfluenceBand(drawnValue.band)
        && parseDrawnLinkPress(drawnValue.press_id)?.from === fromId && parseDrawnLinkPress(drawnValue.press_id)?.to === toId ? drawnValue.band : undefined;
      if (drawnBand !== undefined && opts.commitOptionLevels === undefined) return { ok: false, mutated: false, applied: false, refusal: 'not_applied', detail: 'Olumi could not record the accepted estimate. Nothing changed.' };
      const operationId = authorisationTurnId(decision.proposal.proposal_id);
      const res = await dispatch('/orchestrate/v2/turn', {
        kind: 'system_event',
        turn_id: operationId,
        scenario_id: ctx.scenario_id,
        stage: 'frame',
        event: {
          kind: 'structural_add_edge',
          from: fromId,
          to: toId,
          // The midpoint of the band the user typed (`proposeModelChange`). ⚠ A proposal
          // restored from before that rule has none, and the wire REQUIRES a magnitude and
          // forbids `unknown`: it sends the projection default, not the user's claim, and
          // the result says so below.
          magnitude: usersStrength ?? 0.5,
          effect_direction: direction,
          base_graph_hash: decision.proposal.base_graph_identity_hash,
        },
      });

      const after = await readGraph(ctx.scenario_id);
      const confirmation = confirmEdgeWrite({
        revision_before: before.graph_hash,
        revision_after: after?.graph_hash ?? before.graph_hash,
        edgeExistsAfter: (after?.edges ?? []).some((e) => e.from === fromId && e.to === toId),
        system_message: String(res.json.assistant_text ?? ''),
      });
      /**
       * ⛔ A LINK THIS WRITE ADDED IS NEVER "NOT SAVED" FOR WHAT HAPPENED AFTER IT (round-2 review of
       * fix/agent-never-shows-instructions-or-codes, blocker 2's class). Landed-ness here is the read-back alone, so a
       * failed read-back, or a link another writer removed straight after this write committed it, read "Not saved: none
       * of it was applied." Same rule as the link-strength branch.
       */
      if (!confirmation.applied && after === null && res.status === 200) {
        return {
          ok: false, mutated: false, applied: false, refusal: 'not_confirmed', proposal_id: decision.proposal.proposal_id,
          detail: 'Olumi could not read the model back to confirm whether the link was added. Tell the user plainly that it could not be confirmed, and offer to check again.',
          http: res.status, operation_id: operationId,
        };
      }
      const hasTheLink = (edges: unknown): boolean => Array.isArray(edges)
        && (edges as { from?: unknown; to?: unknown }[]).some((e) => e?.from === fromId && e?.to === toId);
      if (!confirmation.applied && committedThenMoved(res, before.graph_hash, after, (draft) => hasTheLink(draft.edges))) {
        return {
          ok: false, mutated: true, applied: false, refusal: 'not_verified', proposal_id: decision.proposal.proposal_id,
          detail: 'The link was added, but the model changed again straight afterwards and no longer shows it, so what it now holds could not be confirmed. Read the model again before saying what it holds; do not describe the link as added.',
          http: res.status, operation_id: operationId,
        };
      }
      if (!confirmation.applied) {
        return {
          ok: false, mutated: false, applied: false, refusal: 'not_applied',
          detail: describeOutcome(confirmation), http: res.status, operation_id: operationId,
        };
      }
      const edgeReceipt = receiptSummaryOf(res.json);
      const edgeReceipts = edgeReceipt.summary !== null ? [edgeReceipt.summary] : [];
      if (drawnBand !== undefined) {
        const added = after!.edges.find(e => e.from === fromId && e.to === toId);
        let estimate: CommitOptionLevelsResult;
        try {
          estimate = await withDrawnLinkAdoption({ scenarioId: ctx.scenario_id, from: fromId!, to: toId!,
            magnitude: usersStrength!, band: drawnBand, edge: added }, () => opts.commitOptionLevels!({
            scenario_id: ctx.scenario_id, base_graph_hash: after!.graph_hash,
            turn_id: authorisationTurnId(`${decision.proposal.proposal_id}#drawn-strength`), links: [], levels: [],
            link_strengths: [{ from: fromId!, to: toId!, magnitude: usersStrength!, intent: 'set',
              expected: { mean: direction === 'negative' ? -usersStrength! : usersStrength!, effect_direction: direction, reviewed_at: null },
              band: drawnBand, author: 'model_proposed' }],
          }));
        } catch (err) {
          if (isRevisionConflict(err)) {
            return { ok: false, mutated: true, applied: false, refusal: 'not_confirmed',
              proposal_id: decision.proposal.proposal_id, operation_id: operationId, receipts: edgeReceipts,
              outcome: 'link_saved_estimate_not_saved', detail: DRAWN_LINK_ESTIMATE_CONFLICT_MESSAGE };
          }
          return { ok: false, mutated: true, applied: false, refusal: 'not_confirmed', proposal_id: decision.proposal.proposal_id, receipts: edgeReceipts,
            detail: 'The link was added, but recording its accepted Olumi estimate could not be confirmed. Check the saved model before continuing.' };
        }
        const checked = await readGraph(ctx.scenario_id);
        const edge = checked?.edges.find(e => e.from === fromId && e.to === toId);
        const strength = edge?.strength as { mean?: unknown; std?: unknown } | undefined;
        const provenance = edge?.provenance as { source?: unknown; magnitude?: unknown; reviewed_by_user?: { intent?: unknown; band?: unknown; at?: unknown } } | undefined;
        const verified = estimate.status === 'committed' && strength?.mean === (direction === 'negative' ? -usersStrength! : usersStrength)
          && strength?.std === edgeBandStd(drawnBand) && edge?.effect_direction === direction
          && provenance?.source === 'cee_hypothesis' && provenance.magnitude === 'olumi_estimate'
          && provenance.reviewed_by_user?.intent === 'confirm' && provenance.reviewed_by_user.band === drawnBand
          && typeof provenance.reviewed_by_user.at === 'string' && Number.isFinite(Date.parse(provenance.reviewed_by_user.at));
        if (!verified) return { ok: false, mutated: true, applied: false, refusal: checked === null ? 'not_confirmed' : 'not_verified',
          proposal_id: decision.proposal.proposal_id, receipts: edgeReceipts,
          ...(estimate.status === 'stale' || estimate.status === 'refused' ? {
            outcome: estimate.status === 'stale' ? 'link_saved_estimate_not_saved' : 'link_saved_estimate_refused',
          } : {}),
          detail: 'The link was added, but Olumi could not confirm its strength as the accepted Olumi estimate. Check the saved model before continuing.'
            + (estimate.status === 'stale' || estimate.status === 'refused'
              ? ` ${PARTIAL_WRITE_MESSAGES[estimate.status === 'stale' ? 'link_saved_estimate_not_saved' : 'link_saved_estimate_refused']}` : '') };
        if (estimate.status === 'committed' && estimate.receipt !== null) edgeReceipts.push({ ...estimate.receipt, source_turn_id: estimate.receipt.source_turn_id ?? '' });
        proposals.markApplied(decision.proposal.proposal_id, edgeReceipts);
        return { ok: true, mutated: true, applied: true, proposal_id: decision.proposal.proposal_id, receipts: edgeReceipts,
          revision_before: before.graph_hash, revision_after: checked!.graph_hash,
          follow_up: `${decision.proposal.public_label} Recorded as Olumi’s estimate, accepted.` };
      }
      proposals.markApplied(decision.proposal.proposal_id, edgeReceipts);
      return {
        ok: true, mutated: true, applied: true,
        receipts: edgeReceipts,
        ...(edgeReceipt.unreadable ? { receipt_unreadable: true } : {}),
        proposal_id: decision.proposal.proposal_id,
        operation_id: operationId,
        revision_before: confirmation.revision_before,
        revision_after: confirmation.revision_after,
        ...(usersStrength !== undefined
          ? { detail: `Recorded with the strength the user stated, as their own estimate: ${decision.proposal.public_label}.` }
          : {
            // Olumi discloses this to the user deterministically; see disclosure.ts.
            placeholder_strength: true,
            not_represented:
              'The direction was recorded. No strength was stated by the user, so the model carries a ' +
              'placeholder strength that is not a measurement — say so if you describe the change.',
          }),
      };
    },

    async buildModelFromBrief(ctx, args): Promise<ToolResult> {
      if (callStructured === undefined) {
        return { ok: false, mutated: false, refusal: 'construction_unavailable' };
      }
      const brief = typeof args?.brief === 'string' ? args.brief.trim() : '';
      if (brief.length === 0) return { ok: false, mutated: false, refusal: 'empty_brief' };

      /**
       * ⭐ FIRST ASK WHETHER THIS CONSTRUCTION ALREADY COMMITTED — before the
       * populated-graph guard, and before any model call.
       *
       * ⛔ Independent review of #1691 at 84dadabb: after a build commits and its
       * response is lost, a retry hit the guard below first and answered
       * `model_already_exists`, so the derived operation id never reached the
       * registration replay arm. The model was saved; the Agent said it was not.
       *
       * If the version this brief's construction produced exists, recover its
       * receipt — no second model generation, no second version — and let the
       * SAME confirm-from-state block below report the model as it now stands.
       * A populated graph with no matching operation is a genuinely different
       * model, and keeps the refusal.
       */
      const prior = await findConstructionVersion(dispatch, ctx.scenario_id, brief);
      let built: ToolResult;
      if (prior !== null) {
        built = {
          ok: true, mutated: false, replayed: true, model_version: prior,
          detail: `This model was already built from this brief and saved as version ${prior.version_number}. Nothing was built twice.`,
        };
      } else {
        // ⛔ NEVER BUILD OVER A MODEL THAT ALREADY EXISTS. Registration replaces
        // the whole graph, so running this on a populated scenario would discard
        // work the user has already authorised.
        const before = await readGraph(ctx.scenario_id);
        if (before === null) return { ok: false, mutated: false, refusal: 'not_found' };
        if (before.nodes.length > 0) {
          return {
            ok: false, mutated: false, refusal: 'model_already_exists',
            detail: 'The model already has entities. Propose a change instead of rebuilding it.',
          };
        }
        built = await buildWithDrafterRawRecord(ctx, brief, constructionOperationId(ctx.scenario_id, brief), callStructured, (drafter) => buildModelFromBrief(ctx.scenario_id, brief, dispatch, drafter, opts.onConstructionTrace, opts.deadlineAt, callStructured));
        if (built.ok !== true) return built;
      }

      // Confirmed from state, never from the write's own return value.
      const after = await readGraph(ctx.scenario_id);
      if (after === null || after.nodes.length === 0) {
        return { ok: false, mutated: false, refusal: 'model_not_readable_after_write' };
      }
      /**
       * ⭐ C6-1: THE MODEL EXISTS NOW — say so before the first analysis and the reply (~15 s of the first brief).
       * Only the request whose construction COMMITTED (the first analysis's own gate, below): a recovered version
       * (`replayed: true`) was already shown by the turn that built it, and a refusal returned above.
       */
      if (built.mutated === true && built.replayed !== true) {
        try { opts.onModelRegistered?.(after.raw); } catch { /* an observer never costs the build */ }
      }
      /**
       * ⭐ THE FIRST ANALYSIS, RUN BY OLUMI, ONCE (Paul, 5812069638) — ONLY when this request is the one
       * whose construction COMMITTED. Every retry shape fails this gate: a new turn id recovers the
       * version (`mutated: false, replayed: true`), a concurrent twin gets OPERATION_ID_REUSED (the
       * same), and the registration replay arm answers `mutated: true, replayed: true` — which is why
       * `replayed !== true` is required and `mutated` alone is not. The runner then checks admission,
       * the turn deadline and the (K, H) prior fact before the one dispatch.
       */
      let firstAnalysis: Record<string, unknown> | undefined;
      /** The read after the first pass, when one ran: the next step is that Run's (its joint, its targets). */
      let postRunState: { raw: unknown; analysis_state: unknown; analysis_ready: unknown; analysis_result: unknown } | undefined;
      if (built.mutated === true && built.replayed !== true && opts.firstAnalysis !== undefined) {
        const outcome = await opts.firstAnalysis({
          scenarioId: ctx.scenario_id,
          constructionTurnId: registrationTurnId(ctx.scenario_id, constructionOperationId(ctx.scenario_id, brief)),
          revisionGraph: after.raw,
          revisionHash: after.graph_hash,
          requestId: ctx.request_id,
        });
        if (outcome.ran) onAnalysis?.({ scenario_id: ctx.scenario_id, status: 200, analysis_ready: outcome.analysisReady, blocks: [...outcome.blocks], trigger: 'auto_first_pass' });
        // What the Agent narrates from: the READBACK after the run — its confined summary and the
        // typed leader permission — never the run's own receipt. A failed read describes nothing.
        const postRun = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph`, {}).catch(() => null);
        const read = postRun !== null && postRun.status === 200 ? postRun.json : {};
        if (postRun !== null && postRun.status === 200) postRunState = { raw: read.graph, analysis_state: read.analysis_state,
          analysis_ready: read.analysis_ready, analysis_result: read.analysis_result };
        firstAnalysis = describeFirstAnalysisForAgent(outcome, {
          analysisState: read.analysis_state,
          analysisResult: read.analysis_result,
          analysisAdmission: read.analysis_admission,
        });
        // ⛔ C46 (d): the first pass withholds its leader as unrequested (policy), so the product cause is
        // carried beside that reason, read from the model just built — only where an analysis exists. C46 × R3-4: not of a
        // product the run's engine evaluated, read from the SAME post-run read as the permission.
        if (firstAnalysis.ran === true || firstAnalysis.reason === 'already_ran_for_construction') {
          // ⛔ GOAL CERTAINTY (PR Review CR @ ed62f91b): bound to the Run THIS request EXECUTED — its own block and the run turn's
          // own stamp — never the read's Run matched to itself (another Run may finish before the read). No Run executed here
          // (an earlier request's) → nothing to bind to → unchecked when it claims a certainty.
          const executed = outcome.ran ? outcome.blocks.find((b) => (b as { type?: unknown } | null)?.type === 'analysis_result') : undefined;
          const certainty = goalCertaintyForAgent(executed ?? read.analysis_result,
            { scenario_id: ctx.scenario_id, analysis_state: outcome.ran ? outcome.analysisState : undefined }, certaintyReadOf(read));
          // The read route's own model and revision (the same read as the permission): `graph` / `graph_hash`.
          const card = identityCardFor(ctx, { raw: read.graph, graph_hash: read.graph_hash, brief_text: typeof read.brief_text === 'string' ? read.brief_text : null });
          firstAnalysis = { ...firstAnalysis, claim_permissions: withNonlinearIdentity(firstAnalysis.claim_permissions, after.raw,
            readEvaluatedIdentityNodeIds(read.analysis_identity_evaluated_node_ids)), ...withGoalChance(read.analysis_result, read.graph, card === undefined),
          ...(certainty !== undefined ? { goal_certainty: certainty } : {}),
          ...withIdentityCard(card) };
        }
        if (outcome.ran) {
          firstAnalysisThisRequest = {
            revisionHash: after.graph_hash,
            result: {
              ok: true, mutated: false, ran: true, already_run_this_turn: true,
              ...(firstAnalysis.summary !== undefined ? { summary: firstAnalysis.summary } : {}),
              claim_permissions: firstAnalysis.claim_permissions,
              ...(firstAnalysis.goal_chance !== undefined ? { goal_chance: firstAnalysis.goal_chance } : {}),
              ...(firstAnalysis.goal_certainty !== undefined ? { goal_certainty: firstAnalysis.goal_certainty } : {}),
              note: 'Olumi already ran the first analysis of this model on this turn, so it was not run again.',
            },
          };
        }
      }
      /**
       * ⭐ RETURN THE POST-BUILD STATE, so the Agent does not have to go and
       * fetch it. Measured on the preview path: the first turn called
       * `get_canonical_state`, then `build_model_from_brief`, then
       * `get_canonical_state` AGAIN, then `run_analysis` — four tool calls and
       * four model round trips, 85 s on the slowest sample against a 125 s
       * browser-proxy budget. The second read asks for something this call
       * already has in hand.
       */
      return {
        ...built,
        confirmed_entities: after.nodes.length,
        graph_revision: after.graph_hash,
        // The SAME projection get_canonical_state uses — see projectEntity.
        entities: after.nodes.map(projectEntity),
        structure: structuralFacts(after.nodes, after.edges, limitNodeIdsOf(after.raw)),
        // (B) The goal as stated, the limits, and the ONE readiness verdict — the same projection as
        // get_canonical_state, so the first reply never contradicts the Run control.
        ...pickKeys(projectModelContext(after), ['goal', 'goals', 'limits', 'readiness']),
        // BYPASS1: the ONE next step of the model just built (of its first pass when one ran), as get_canonical_state gives it.
        ...nextStepFactOf(postRunState ?? after),
        ...(firstAnalysis !== undefined ? { first_analysis: firstAnalysis } : {}),
      };
    },

    /**
     * ⭐ ADD AN OPTION THE USER PICKED — the act RC named as missing.
     *
     * Proposal only, exactly like every other write on this lane: nothing changes
     * until `authorise_change`. The plan is computed by `planNewOption`, a pure
     * function, so the refusals are testable without a graph round trip.
     */
    async proposeNewOption(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      if (heldOptionThisRequest !== undefined) {
        return {
          ok: false, mutated: false, refusal: 'one_option_per_approval',
          detail: `${heldOptionThisRequest} is already prepared and waiting for the user's approval. Every option the user asked for `
            + 'goes into ONE propose_new_option call (`options`, up to 4): a second proposal in the same reply would have no button of '
            + 'its own. Offer the one that is prepared, and say plainly which you will add after the user approves it.',
        };
      }
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();
      type Asked = { factor_label?: unknown; direction?: unknown; level?: { value?: unknown; unit?: unknown; estimate?: unknown; basis?: unknown } | null };
      const askedOf = (xs: unknown): Asked[] => (Array.isArray(xs) ? xs.map((x) => (x ?? {}) as Asked) : []);
      /**
       * ⭐ SEVERAL OPTIONS, ONE CHANGE (F4; Canonical's typed transaction #1940, contract #70 5841655730). "Add A
       * and B" is ONE proposal the user approves once: every option is built into ONE held batch, and it lands
       * whole or not at all. A single option may still be sent without `options`.
       */
      const askedSpecs = Array.isArray(args?.options) && args.options.length > 0
        ? (args.options as unknown[]).map((o) => ({ label: String((o as { label?: unknown } | null)?.label ?? ''), acts_on: askedOf((o as { acts_on?: unknown } | null)?.acts_on) }))
        : [{ label: String(args?.label ?? ''), acts_on: askedOf(args?.acts_on) }];
      // A named Olumi suggestion already has an identity, links and levels. The user's request adopts its
      // participation in place; treating it as a new option would either clash or duplicate it. This branch
      // prepares a stored proposal only. The clicked card is checked again at authorisation.
      if (askedSpecs.length === 1) {
        const wanted = askedSpecs[0]!;
        const matches = g.nodes.filter((n) => n.kind === 'option' && norm(n.label) === norm(wanted.label));
        const suggested = matches.length === 1 && matches[0]!.proposed_by === 'olumi' ? matches[0]! : undefined;
        if (suggested !== undefined) {
          const namedByExactLabel = wordsTheUserWrote(suggested.label, ctx.user_turn_text);
          const namedByUniqueFigure = (() => {
            const words = ctx.user_turn_text;
            if (typeof words !== 'string' || g.nodes.filter((n) => n.kind === 'option' && n.proposed_by === 'olumi'
              && n.analysis_participation !== 'included').length !== 1) return false;
            if (!/\b(?:your|olumi(?:['\u2019]s)?)\b/i.test(words)
              || !wordsTheUserWrote('suggestion', words)
              || !['add', 'include', 'use'].some((verb) => wordsTheUserWrote(verb, words))) return false;
            return Object.values(suggested.interventions ?? {}).some((raw) => {
              if (raw === null || typeof raw !== 'object') return false;
              const level = raw as { raw_value?: unknown; unit?: unknown };
              return typeof level.raw_value === 'number' && figureTheUserWrote(level.raw_value, level.unit, words);
            });
          })();
          if (!namedByExactLabel && !namedByUniqueFigure) {
            return { ok: false, mutated: false, refusal: 'option_not_requested',
              detail: `"${suggested.label}" is Olumi's suggestion, but this turn did not name it as an option to add. Nothing was prepared.` };
          }
          if (suggested.analysis_participation === 'included') {
            return { ok: false, mutated: false, refusal: 'already_participating',
              detail: `"${suggested.label}" already participates in your comparison. Nothing was changed.` };
          }
          if (suggested.analysis_participation === 'retained_excluded') {
            return { ok: false, mutated: false, refusal: 'excluded_option',
              detail: `"${suggested.label}" is currently excluded from analysis. Nothing was prepared; review that exclusion before adding it to a comparison.` };
          }
          if (wanted.acts_on.length > 0 || (Array.isArray(args?.new_factors) && args.new_factors.length > 0)) {
            return { ok: false, mutated: false, refusal: 'adoption_with_edits',
              detail: `"${suggested.label}" is already Olumi's suggestion. Adoption keeps its existing links and levels; nothing was prepared with additional edits. Propose its participation alone, then edit its effects separately.` };
          }
          const expectedInterventions = structuredClone(suggested.interventions ?? {});
          const egressScaleByFactor = buildFactorScaleMap(g.nodes);
          // This narrow card speaks numeric levels. A category or switch is
          // stored in `raw_value` with a numeric encoding for analysis; showing
          // that encoding as the user's reading would approve a different idea.
          if (Object.entries(expectedInterventions).some(([factorId, cell]) => cell !== null && typeof cell === 'object'
            && ((Object.hasOwn(cell, 'raw_value')
              && (typeof (cell as { raw_value?: unknown }).raw_value !== 'number'
                || !Number.isFinite((cell as { raw_value: number }).raw_value)))
              || resolveRawInterventionValue(cell, egressScaleByFactor.get(factorId)).codeNotMagnitude === true))) {
            return { ok: false, mutated: false, refusal: 'non_numeric_stored_level',
              detail: `"${suggested.label}" has a category or switch that this approval card cannot show accurately. Nothing was prepared; review that option before including it.` };
          }
          // A cap alone does not prove that a raw-less value is normalized.
          // Use the Run's own egress classifier before showing a multiplied
          // consent figure; it may correctly pass an ambiguous value through.
          const unprovenDisplayLevel = Object.entries(expectedInterventions).some(([factorId, cell]) => {
            if (cell === null || typeof cell !== 'object' || Object.hasOwn(cell, 'raw_value')) return false;
            const level = cell as { value?: unknown };
            if (typeof level.value !== 'number' || !Number.isFinite(level.value)) return false;
            const factor = g.nodes.find((n) => n.id === factorId);
            const frame = levelFrameOf(factor);
            if (frame === null) return false;
            const egress = resolveRawInterventionValue(cell, egressScaleByFactor.get(factorId));
            const displayed = level.value * frame;
            return egress.value === null || egress.codeNotMagnitude === true
              || Math.abs(egress.value - displayed) > Math.max(1e-9, Math.abs(displayed) * 1e-6);
          });
          if (unprovenDisplayLevel) {
            return { ok: false, mutated: false, refusal: 'unproven_display_level',
              detail: `The level shown for "${suggested.label}" is not proven to be the level its comparison would use. Nothing was prepared; check that option's level before including it.` };
          }
          // The Run and canonical Agent reader use the normalized value in the
          // factor's frame. A stale raw display value cannot be the consent
          // reading for a different figure the Run would actually compare.
          const conflictingLevels = Object.entries(expectedInterventions).filter(([factorId, cell]) => {
            if (cell === null || typeof cell !== 'object') return false;
            const level = cell as { value?: unknown; raw_value?: unknown };
            if (typeof level.raw_value !== 'number' || !Number.isFinite(level.raw_value)) return false;
            if (typeof level.value !== 'number' || !Number.isFinite(level.value)) return true;
            const factor = g.nodes.find((n) => n.id === factorId);
            const frame = levelFrameOf(factor);
            const canonical = frame === null ? level.value : level.value * frame;
            return Math.abs(level.raw_value - canonical) > Math.max(1e-9, Math.abs(canonical) * 1e-6);
          });
          if (conflictingLevels.length > 0) {
            return { ok: false, mutated: false, refusal: 'inconsistent_stored_level',
              detail: `The stored display level for "${suggested.label}" disagrees with the level its comparison would use. Nothing was prepared; check that option's level before including it.` };
          }
          const levelWords = Object.entries(expectedInterventions).map(([factorId, raw]) => {
            const factor = g.nodes.find((n) => n.id === factorId);
            const level = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : { value: raw };
            const frame = levelFrameOf(factor);
            const storedRaw = typeof level.raw_value === 'number' && Number.isFinite(level.raw_value) ? level.raw_value : null;
            const normalized = typeof level.value === 'number' && Number.isFinite(level.value) ? level.value : null;
            const figure = normalized !== null && frame !== null ? Number((normalized * frame).toPrecision(12)) : normalized;
            const unitValue = typeof level.unit === 'string' && level.unit.trim() !== ''
              ? level.unit.trim() : factor?.observed_state?.unit;
            const unit = (storedRaw !== null || frame !== null) && typeof unitValue === 'string' && unitValue !== ''
              ? unitValue.replace(/(\bper\s+\w+)\s+per\s+(month|year|week|day)$/i, '$1 / $2') : '';
            const scaleNote = storedRaw === null && frame === null && normalized !== null ? ' (normalized scale; no user-facing unit verified)' : '';
            const source = optionLevelSourceWords(level, factor);
            const saidFigure = typeof figure === 'number'
              ? (sayFigureExactly(figure, unit) ?? `${figure}${unit !== '' ? ` ${unit}` : ''}`) + scaleNote
              : 'no level set';
            return `${String(factor?.label ?? factorId)}: ${saidFigure} (${source})`;
          });
          const reading = `Add Olumi's suggestion "${suggested.label}" to your comparison with its existing levels: ${levelWords.length > 0 ? levelWords.join('; ') : 'none set'}.`;
          const approvalMessage = `Yes, add Olumi's suggestion "${suggested.label}" to my comparison with the levels shown.`;
          const proposal = createProposal({
            scenario_id: ctx.scenario_id,
            user_id: ctx.authenticated_user_id,
            base_graph_identity_hash: g.graph_hash,
            operations: [{ op: 'adopt_olumi_option', path: suggested.id, value: {
              label: suggested.label, expected_interventions: expectedInterventions,
              approval_message: approvalMessage,
            } }],
            // The user requested participation; the option and its levels remain Olumi-authored.
            provenance: { authored_by: 'model_proposed', basis: String(args?.rationale ?? '') },
            validation: { admitted: true, loss_count: 0, refusals: [] },
            public_label: reading,
          });
          proposals.put(proposal);
          return { ok: true, mutated: false, proposal_id: proposal.proposal_id, public_label: reading,
            base_revision: g.graph_hash, adoption_reading: reading,
            option: { label: suggested.label },
            note: `Nothing has changed yet. Show this exact reading and its approval card. Pressing it includes the option in the user's comparison; its Olumi origin and each level's recorded source remain unchanged.`,
          };
        }
      }
      if (askedSpecs.length > MAX_OPTIONS_PER_TRANSACTION) {
        return {
          ok: false, mutated: false, refusal: 'too_many_options',
          detail: `One change can add at most ${MAX_OPTIONS_PER_TRANSACTION} options; this asks for ${askedSpecs.length}. Nothing was prepared. `
            + `Offer the first ${MAX_OPTIONS_PER_TRANSACTION} as one change, and add the rest after the user approves it.`,
        };
      }
      /**
       * ⛔ AN OPTION IS LINKED FROM THE DECISION IT ANSWERS — and only when that decision is unambiguous. With
       * none, or more than one, nothing is prepared and the user is asked: a guessed parent is a wrong model.
       */
      const decisions = g.nodes.filter((x) => x.kind === 'decision');
      if (decisions.length !== 1) {
        return {
          ok: false, mutated: false, refusal: 'no_single_decision',
          detail: decisions.length === 0
            ? 'The model has no decision to add an option to, so nothing was prepared. Tell the user plainly.'
            : 'The model has more than one decision, so it is not clear which one this option answers. Nothing was prepared; ask the user which decision it is for.',
        };
      }
      const decision = decisions[0]!;
      // ⭐ A factor the model lacks is added IN THIS SAME CHANGE (`planNewFactors`; Canonical 5843972346/5843988693).
      const planned = planNewFactors(g.nodes as never, Array.isArray(args?.new_factors) ? args.new_factors as readonly NewFactorRequest[] : []);
      if (!planned.ok) return { ok: false, mutated: false, refusal: planned.refusal, detail: planned.detail };
      const newFactors = planned.factors;
      /**
       * ⭐ A NEW SWITCH AT 0 UNDER AN OPTION THAT LEAVES IT OFF IS NOT AN ENTRY (served A03, pj-20260928T011147Z: five
       * `switch_level_not_on` refusals, ~23 s). When another option in this change turns it on, that 0 says only that
       * this option does not act on it: dropped before planning (no link, no level), and said (`switch_off_entries_dropped`).
       */
      const { specs: afterOffDrop, dropped: switchOffDropped } = dropSwitchOffEntries(askedSpecs, g.nodes, newFactors);
      /**
       * ⭐ A PLACEHOLDER 0 ON THE ONE ENTRY NAMING A NEW SWITCH IS NO LEVEL where "off" would mean nothing (switch-loop step
       * 5, Runtime 5865857191: 98 refusals on byte-identical re-sends). Read as on, and said (`switch_placeholder_levels_read_as_on`).
       */
      const { specs, read: switchPlaceholderRead } = readPlaceholderSwitchZerosAsOn(afterOffDrop, g.nodes, newFactors);
      // Each option is planned against the model PLUS the options before it: distinct ids, and no two options by one name.
      const plans: { spec: (typeof specs)[number]; plan: Extract<ReturnType<typeof planNewOption>, { ok: true }> }[] = [];
      for (const spec of specs) {
        const view = [...g.nodes, ...plans.map((x) => ({ id: x.plan.optionId, kind: 'option', label: x.plan.label }))];
        const plan = planNewOption(view as never, {
          label: spec.label,
          acts_on: spec.acts_on.map((a) => ({ factor_label: String(a.factor_label ?? ''), direction: a.direction === 'negative' ? 'negative' as const : 'positive' as const })),
          rationale: String(args?.rationale ?? ''),
          newFactors,
        });
        if (!plan.ok) {
          return { ok: false, mutated: false, refusal: plan.refusal,
            detail: `${specs.length > 1 ? `"${spec.label}": ` : ''}${plan.detail}${specs.length > 1 ? ' Nothing was prepared for any of the options: they are one change.' : ''}`,
            ...(plan.unresolved_labels ? { unresolved_labels: plan.unresolved_labels } : {}) };
        }
        plans.push({ spec, plan });
      }
      // A factor added for no option changes nothing the comparison can use: refused, never added on its own.
      const unused = newFactors.filter((f) => !plans.some((x) => x.plan.newActsOn.some((a) => a.key === f.key)));
      if (unused.length > 0) {
        return { ok: false, mutated: false, refusal: 'new_factor_unused',
          detail: `No option acts on ${unused.map((f) => `"${f.label}"`).join(', ')}. Nothing was prepared. Add a factor only for an option that changes it, and name it in that option\u2019s acts_on.` };
      }
      /**
       * ⛔ ONE CHANGE HAS A SIZE LIMIT, checked BEFORE anything is sent. A typed transaction CEE builds holds at
       * most TYPED_TRANSACTION_ENVELOPE_CAP changes; each option costs one, its decision link one, and one per
       * factor it acts on. Over the limit the product would refuse the batch — so it is refused here, in plain
       * words, with nothing sent.
       */
      // Each new factor costs one change for itself and one per thing it affects; the option's link to it is its acts_on.
      const envelopes = plans.reduce((n, x) => n + 2 + x.plan.actsOn.length + x.plan.newActsOn.length, 0)
        + newFactors.reduce((n, f) => n + 1 + f.affects.length, 0);
      if (envelopes > TYPED_TRANSACTION_ENVELOPE_CAP) {
        return {
          ok: false, mutated: false, refusal: 'too_many_links',
          detail: `That is ${envelopes} changes in one, and one change can carry at most ${TYPED_TRANSACTION_ENVELOPE_CAP} (each option, its link from the decision, and one per factor it acts on). `
            + 'Nothing was prepared. Suggest adding the options with the factors they change most, then linking the rest.',
        };
      }
      /**
       * ⭐ A LEVEL IS WRITTEN ONLY WHEN THE USER STATED IT — never invented to make the model runnable — and
       * ONLY ON THE RANGE THE LANE'S LEVEL WRITER USES (`levelFrameOf`: the declared cap, else the declared
       * `scale_frame`; independent review of #1933, 00:16Z). A figure on that range is stored as figure ÷ range,
       * with the figure kept. A figure outside it is refused with nothing sent (`proposeOptionInterventions`
       * refuses it too). A figure above 1 on a factor with NO range is left unset and said so: the lane's
       * writer derives a range and attaches it to the factor, which this one-change transaction cannot do, and
       * a bare figure beside levels stored as fractions would put one factor on two scales.
       */
      const rawNodes = ((g.raw as { nodes?: unknown }).nodes as { id: string; kind?: string; label?: string; description?: string }[] | undefined) ?? [];
      const outOfRange: { option: string; factor: string; value: number; range: number }[] = [];
      const unitMismatch: { option: string; factor: string; value: number; unit: string; factor_unit: string }[] = [];
      // `value` is the figure as given: a non-number the Agent sent for a new graded factor's level is said as it came (A1 £59).
      const levelsNotSet: { option: string; factor: string; value: unknown; reason: string }[] = [];
      /** A level the Agent gave for a new SWITCH that does not mean on (`newSwitchLevelConflict`): refused, nothing sent. */
      const switchLevelConflicts: { option: string; factor: string; value: unknown; unit?: unknown; estimate?: unknown }[] = [];
      /** Every field that fired across them, in first-seen order (names only): carried to `_agent.tool_calls`. */
      const switchConflictFields: SwitchConflictField[] = [];
      const isNewSwitch = (key: string): boolean => newFactors.some((f) => f.key === key && f.kind === 'switch');
      /**
       * ⛔ WHOSE LINK (U3, DL 5849023213 (2)). A link with no level is written by Canonical's builder as the user's
       * unless it says otherwise (`add-option-transaction.ts` `structuralEdgeValue(…, iv.source ?? 'user_specified')`).
       * It is the user's only when THIS turn's typed words name its factor (`factorTheUserNamed`); otherwise it is Olumi's.
       */
      const optionNames = [...rawNodes.filter((n) => n.kind === 'option').map((n) => String(n.label ?? '')), ...plans.map((x) => x.plan.label)];
      const quantityNames = [...rawNodes.filter((n) => n.kind !== 'option' && n.kind !== 'decision').map((n) => String(n.label ?? '')), ...newFactors.map((f) => f.label)];
      const linkAuthor = (factorLabel: string): { source?: 'cee_hypothesis' } => (
        factorTheUserNamed(factorLabel, ctx.user_turn_text, { options: optionNames, others: quantityNames.filter((l) => l !== factorLabel) })
          ? {} : { source: 'cee_hypothesis' });
      /**
       * ⭐ A NEW GRADED FACTOR'S TODAY LEVEL, ONLY WHEN THE USER STATED IT (PJ-A1 £49: DL #70 5860365834; AIQ 5860384275,
       * 5860839793). Journey A's "£59 for new Pro customers" minted "New Pro customer price" with no today level: ISL
       * defaulted it to 0 (`GOAL_ANCESTOR_DATA_GAP`), so the status quo was measured from £0. Paul's brief says "from £49".
       *
       * The Agent's `new_factors[].today` is taken ONLY when the user's own typed words in this conversation
       * (`ctx.user_text`, bound by the route — the brief typed as the first message included) write that figure in that
       * kind of unit (`figureTheUserWrote`, the lane's one matcher). Not `brief_text` from the store: on this lane it is the
       * Agent's own `build_model_from_brief` argument, never bound to what the user typed. Then it is framed exactly as
       * admission frames a baseline the brief states (`framedObservedState`, `brief_extraction`), on admission's own
       * defaulted range (`defaultFrameFor` over the largest figure this change carries for the factor — its today level and
       * any level an option here names for it), so the option's own level is read on the SAME range — in this same change
       * (A1 £59, `newGradedLevels` below). Computed here, before the options, because that level needs this frame.
       *
       * Anything else is dropped and SAID (`today_not_set`), and the factor stays valueless and asked — never 0: a figure
       * the user did not write (Olumi's, or a guess), a non-number, a negative level (a 0-to-range frame cannot hold it),
       * or a today level for a SWITCH (its today is Olumi's off, `stampNewSwitchFactors`). It rides the in-process
       * authorship context to the hold, never the wire; the confirm writes it in the same apply as the option.
       */
      const requestedNew = Array.isArray(args?.new_factors) ? args.new_factors as readonly unknown[] : [];
      const statedToday: (StatedTodayLevel & { key: string; value: number; unit?: string })[] = [];
      const todayNotSet: { factor: string; value: unknown; reason: string }[] = [];
      for (const f of newFactors) {
        const req = requestedNew.find((r) => norm((r as { label?: unknown } | null)?.label) === norm(f.label)) as { today?: unknown } | undefined;
        const today = req?.today;
        if (today === undefined || today === null) continue;
        const t = (typeof today === 'object' && !Array.isArray(today) ? today : {}) as { value?: unknown; unit?: unknown };
        const unit = typeof t.unit === 'string' && t.unit.trim() !== '' ? t.unit.trim() : undefined;
        const shown = `${typeof t.value === 'number' ? t.value : JSON.stringify(t.value ?? null)}${unit !== undefined ? ` ${unit}` : ''}`;
        if (f.kind === 'switch') {
          todayNotSet.push({ factor: f.label, value: t.value ?? null,
            reason: `"${f.label}" is a switch: it is off today (Olumi's reading, for the user to correct), so a today level of ${shown} was not taken.` });
          continue;
        }
        if (typeof t.value !== 'number' || !Number.isFinite(t.value) || t.value < 0) {
          todayNotSet.push({ factor: f.label, value: t.value ?? null,
            reason: `${shown} is not a level "${f.label}" can hold today, so its value today is not set. Ask the user what it is today.` });
          continue;
        }
        // Not bound to the factor (unlike the goal target and limit doors): journey A's accepted A1 row grounds the NEW price
        // factor's today with the brief's "£49", written about the existing "Pro plan price" (#2132; DL #72 5862394804).
        if (!figureTheUserWrote(t.value, unit, ctx.user_text)) {
          todayNotSet.push({ factor: f.label, value: t.value,
            reason: `The user's own words do not state ${shown}, so today's value for "${f.label}" is not set: it is never taken from Olumi's words or a guess. Ask the user what it is today.` });
          continue;
        }
        const named = plans.flatMap(({ spec }) => spec.acts_on.filter((x) => norm(x.factor_label) === norm(f.label))
          .map((x) => x.level?.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)));
        const largest = Math.max(Math.abs(t.value), ...named.map((v) => Math.abs(v)));
        const os = framedObservedState({ baseline_value: t.value, unit: unit ?? null, provenance: 'explicit',
          plausible_max: largest > 1 ? defaultFrameFor(largest) : null });
        statedToday.push({ key: f.key, label: f.label, value: t.value, ...(unit !== undefined ? { unit } : {}), observed_state: os });
      }
      const entries = plans.map(({ spec, plan }) => {
        type Lvl = { value: number; unit?: string; estimate?: string; by?: 'user' | 'olumi' };
        const levelById = new Map<string, Lvl>();
        for (const a of spec.acts_on) {
          const lv = doorLevelOf(a.level);
          if (lv === undefined) continue;
          const f = rawNodes.find((x) => x.kind === 'factor' && (norm(x.label) === norm(a.factor_label) || norm(x.description) === norm(a.factor_label)));
          // Olumi's own suggested figure, with its basis (ChatGPT 5839692762 A: an EXPLICIT hypothesis, never silent).
          const basis = a.level?.estimate === true && typeof a.level?.basis === 'string' && a.level.basis.trim() !== '' ? a.level.basis.trim() : undefined;
          if (f !== undefined) levelById.set(f.id, { ...lv, ...(basis !== undefined ? { estimate: basis } : {}) });
        }
        /**
         * ⛔ THE USER'S OWN SPLIT (AI Quality ruling #70 5859388817; served C08 "Let's spit it 50/50" of the £30,000 limit the
         * user set). Levels the Agent proposed that are exactly the user's typed split of ONE total they stated are set, with
         * the working as their basis (Olumi's reading until the `derived_from` slot lands, below); two totals in scope are
         * asked, never guessed.
         */
        // The ratio must be typed in THIS message (condition 1): `user_turn_text`, never the session's `user_text`.
        const split = derivedSplitOf(ctx.user_turn_text ?? '', statedTotalsOf(g.raw), plan.actsOn.flatMap((f) => {
          const l = levelById.get(f.id);
          return l === undefined ? [] : [{ factor_id: f.id, value: l.value, unit: partUnit(l.unit, factorUnitOf(g.raw, g.nodes.find((x) => x.id === f.id))) }];
        }));
        const set = new Map<string, Lvl>();
        const interventions = plan.actsOn.map((f) => {
          const lvl = levelById.get(f.id);
          if (lvl === undefined) return { factor_id: f.id, value: null, ...linkAuthor(f.label) };
          const factor = g.nodes.find((x) => x.id === f.id);
          // ⛔ A figure in another kind of unit is never this factor's level (`unit-conflict.ts`: a price as churn).
          const { factorUnit, conflict } = factorUnitConflict(lvl, factor, g.raw);
          if (conflict) {
            unitMismatch.push({ option: plan.label, factor: f.label, value: lvl.value, unit: String(lvl.unit), factor_unit: String(factorUnit) });
            return { factor_id: f.id, value: null, ...linkAuthor(f.label) };
          }
          /**
           * ⛔ WHOSE LEVEL: the user's only when they wrote the figure (`stated-by-user.ts`: a 0 sent to mean "not set"
           * was stored as the user's 0% churn). Otherwise it is Olumi's ESTIMATE only when the Agent said so, with a
           * basis, and it is recorded and shown as that (`cee_hypothesis`, C2). Anything else is left unset and said.
           */
          const wrote = figureTheUserWroteFor(lvl.value, lvl.unit ?? factorUnit, ctx.user_text, scopeIn(g, f.label, plan.label));
          if (statementOrigin(wrote, figureTheUserWrote(lvl.value, lvl.unit ?? factorUnit, ctx.unverified_user_text)
            || figureTheUserWrote(lvl.value, lvl.unit ?? factorUnit, g.brief_text), ctx.user_text_complete, lvl.estimate !== undefined) === 'unknown') {
            levelsNotSet.push({ option: plan.label, factor: f.label, value: lvl.value, reason: UNKNOWN_ORIGIN_DETAIL });
            return { factor_id: f.id, value: null, ...linkAuthor(f.label) };
          }
          const derived = !wrote && split.kind === 'derived' && split.factor_ids.includes(f.id) ? split : undefined;
          // A part of the user's split in another period is refused with its own reason, even as Olumi's estimate.
          if (!wrote && split.kind === 'period_mismatch' && split.factor_ids.includes(f.id)) {
            levelsNotSet.push({ option: plan.label, factor: f.label, value: lvl.value,
              reason: `The user's split is of ${split.base.value} ${split.base.unit ?? ''} ("${split.base.label}"), but ${f.label} is measured in ${factorUnit ?? 'another unit'}: `
                + 'a share of that total is not its level, so it is left unset. Ask the user for the figure in its own period; never convert it.' });
            return { factor_id: f.id, value: null, ...linkAuthor(f.label) };
          }
          /**
           * INTERIM (AI Quality 5859798011): until Canonical's `derived_from` slot lands (#70 5859537590), the add-option
           * spec drops the key, so the user's split would persist as theirs with no record of how it was derived. It is
           * recorded as Olumi's reading of their split instead, with the working as its basis; the PR that lands the slot
           * makes it the user's (`user_specified` + `derived_from`).
           */
          if (derived !== undefined) lvl.estimate = `${derived.working}, as Olumi read it`;
          const byUser = wrote;
          if (!byUser && lvl.estimate === undefined) {
            const ask = split.kind === 'ask_which_total' && split.factor_ids.includes(f.id)
              ? `The user's split could be of more than one total they set (${split.candidates.map((t) => `"${t.label}" ${t.value}${t.unit !== undefined ? ` ${t.unit}` : ''}`).join(' or ')}), so ${f.label}'s level is left unset. Ask which total they mean; never pick one.`
              : undefined;
            levelsNotSet.push({ option: plan.label, factor: f.label, value: lvl.value, reason: ask ?? notWrittenReason(lvl.value, f.label) });
            return { factor_id: f.id, value: null, ...linkAuthor(f.label) };
          }
          // The user's split's figure in the name ("50/50") is its RATIO, never a level it contradicts.
          // The name rule, then the writer's range: `placeLevel`, the stage the Widen gate calls too.
          const placed = placeLevel(lvl, factor, factorUnit, plan.label, !byUser && derived === undefined);
          if (placed.kind === 'contradicts_name') {
            levelsNotSet.push({ option: plan.label, factor: f.label, value: lvl.value,
              reason: `Olumi's estimate of ${lvl.value} for ${f.label} does not match the figure in the option's own name ("${plan.label}"), so that level is left unset. Use the figure in the name, or name the option for the figure you mean.` });
            return { factor_id: f.id, value: null, ...linkAuthor(f.label) };
          }
          lvl.by = byUser ? 'user' : 'olumi';
          const stamp = byUser ? {} : { source: 'cee_hypothesis' as const };
          if (placed.kind === 'out_of_range') {
            outOfRange.push({ option: plan.label, factor: f.label, value: lvl.value, range: placed.range });
            return { factor_id: f.id, value: null, ...linkAuthor(f.label) };
          }
          if (placed.kind === 'set') {
            set.set(f.id, lvl);
            return { factor_id: f.id, value: placed.value, ...(placed.raw_value !== undefined ? { raw_value: placed.raw_value } : {}),
              ...(placed.unit !== undefined ? { unit: placed.unit } : {}), ...stamp };
          }
          levelsNotSet.push({ option: plan.label, factor: f.label, value: lvl.value,
            reason: `The model has no range for ${f.label} to read ${lvl.value} against, so this change leaves that level unset. `
              + `Once the option is added, propose that level with propose_option_interventions, which records a range for ${f.label}.` });
          return { factor_id: f.id, value: null, ...linkAuthor(f.label) };
        });
        /**
         * A GRADED new factor with NO accepted today level starts with no level on this option: it has no range yet to read
         * a figure against, and its current value is asked for after it exists (Canonical's OPEN ruling; #2164 asks for
         * today). A level the user gave for it is said, not lost. That case is UNCHANGED by A1 £59 below.
         *
         * ⭐ A1 £59 (DL 5861782245; served CEE 0db4f43, DL run pj-20260928T013016Z A05). With an ACCEPTED today level
         * (`statedToday`) the frame is known in this proposal — `defaultFrameFor` over the largest figure this change
         * carries for the factor, computed ONCE above — so the option's own level on it is written HERE, as its
         * intervention in the SAME held change, on THAT frame (figure ÷ frame, figure kept). One apply, one commit: it
         * rides the option's own `add_node` beside today's level on the hold, and the confirm binds the two to one frame
         * (`stampNewGradedTodayLevels`). Before, "£59 for new Pro customers" landed with no level on the new price, and the
         * final Run was refused MISSING_OPTION_VALUE, asking the user for the £59 they had typed. WHOSE: the user's
         * (`user_specified`, no stamp) only when their own words write it for this factor or option
         * (`figureTheUserWroteFor`, the same matcher an existing factor's level uses); else Olumi's estimate
         * (`cee_hypothesis`, said) only when the Agent says so, with a basis; else not set, and said. A non-number, a unit
         * of another kind than today's, a figure contradicting the option's name, or one outside the frame: not set, said.
         * The frame is built over the largest figure, so a non-negative level cannot fall outside it (no clamp).
         *
         * ⭐ A new SWITCH (`kind: 'switch'`, Canonical #70 5854919806 item 1) is the exception: the option turns it ON, so
         * its level here is exactly 1, in this same change, and its today-0 is Olumi's, written by the same commit. A
         * level the Agent gave for it that does not mean on (`newSwitchLevelConflict`) contradicts
         * "switch" and is refused below, never rounded to on.
         */
        /** A1 £59: this option's level on each new GRADED factor with an accepted today level, by the factor's batch key. */
        const newGradedLevels = new Map<string, { value: number; unit?: string; by: 'user' | 'olumi'; basis?: string;
          iv: { value: number; raw_value?: number; unit?: string; source?: 'cee_hypothesis' } }>();
        for (const a of plan.newActsOn) {
          // ⛔ EVERY entry that names this factor (VERIFIER-S1 on A1 r2): reading only the first let a bare entry followed
          // by `{1, '%'}` through — held, approved, committed with the user's figure dropped — while the reverse was refused.
          const named = spec.acts_on.filter((x) => norm(x.factor_label) === norm(a.label));
          const asked = (named[0]?.level as { value?: unknown } | null | undefined)?.value;
          if (isNewSwitch(a.key)) {
            // Anything that does not mean on (a bare 1, true, exactly 100%) carries a figure the switch cannot keep (a unit, another number, a non-number): refused.
            for (const x of named) {
              const conflict = newSwitchLevelConflict(x.level);
              if (conflict === null) continue;
              const { fields, ...shown } = conflict;
              switchLevelConflicts.push({ option: plan.label, factor: a.label, ...shown });
              for (const f of fields) if (!switchConflictFields.includes(f)) switchConflictFields.push(f);
            }
            continue;
          }
          const today = statedToday.find((t) => t.key === a.key);
          if (today === undefined) {
            // UNCHANGED: no accepted today level, so no frame yet (out of A1 £59's scope; #2164 asks for today).
            if (typeof asked === 'number' && Number.isFinite(asked)) {
              levelsNotSet.push({ option: plan.label, factor: a.label, value: asked,
                reason: `"${a.label}" is new in this change and has no range yet, so its level is not set here. Once it is added, propose that level with propose_option_interventions.` });
            }
            continue;
          }
          const lv = named[0]?.level;
          if (lv === undefined || lv === null) continue;
          const unit = typeof lv.unit === 'string' && lv.unit.trim() !== '' ? lv.unit.trim() : undefined;
          const shown = `${typeof asked === 'number' ? asked : JSON.stringify(asked ?? null)}${unit !== undefined ? ` ${unit}` : ''}`;
          const notSet = (reason: string): void => { levelsNotSet.push({ option: plan.label, factor: a.label, value: asked ?? null, reason }); };
          if (typeof asked !== 'number' || !Number.isFinite(asked)) {
            notSet(`${shown} is not a figure "${a.label}" can hold, so this option's level for it is not set. Say so, and ask the user for that figure only if they want to set it.`);
            continue;
          }
          if (unitsConflict(unit, today.unit) !== null) {
            notSet(`${shown} is not a level for "${a.label}", which is measured in ${today.unit} (its value today), so this option's level for it is not set. `
              + `A figure in another kind of unit is never its level; never convert it. Ask the user for it in ${today.unit} only if they want to set it.`);
            continue;
          }
          const levelUnit = unit ?? today.unit;
          const wrote = figureTheUserWroteFor(asked, levelUnit, ctx.user_text, scopeIn(g, a.label, plan.label));
          if (statementOrigin(wrote, figureTheUserWrote(asked, levelUnit, ctx.unverified_user_text)
            || figureTheUserWrote(asked, levelUnit, g.brief_text), ctx.user_text_complete, lv.estimate === true && typeof lv.basis === 'string' && lv.basis.trim() !== '') === 'unknown') { notSet(UNKNOWN_ORIGIN_DETAIL); continue; }
          const basis = lv.estimate === true && typeof lv.basis === 'string' && lv.basis.trim() !== '' ? lv.basis.trim() : undefined;
          if (!wrote && basis === undefined) { notSet(notWrittenReason(asked, a.label)); continue; }
          if (!wrote && contradictsItsName(asked, levelUnit, plan.label)) {
            notSet(`Olumi's estimate of ${asked} for ${a.label} does not match the figure in the option's own name ("${plan.label}"), so that level is left unset. Use the figure in the name, or name the option for the figure you mean.`);
            continue;
          }
          // The SAME frame as today's level — read off it, never recomputed.
          const cap = (today.observed_state as { cap?: unknown }).cap;
          const framed = typeof cap === 'number' ? asked / cap : asked;
          if (!(framed >= 0 && framed <= 1)) {
            notSet(`${shown} is outside the range "${a.label}" is read on in this change (0 to ${typeof cap === 'number' ? cap : 1}), so this option's level for it is not set. Ask the user for a figure within it.`);
            continue;
          }
          newGradedLevels.set(a.key, {
            value: asked, ...(levelUnit !== undefined ? { unit: levelUnit } : {}), by: wrote ? 'user' : 'olumi', ...(!wrote ? { basis } : {}),
            iv: { value: framed, ...(typeof cap === 'number' ? { raw_value: asked } : {}), ...(levelUnit !== undefined ? { unit: levelUnit } : {}),
              ...(wrote ? {} : { source: 'cee_hypothesis' as const }) },
          });
        }
        /**
         * ⛔ A NEW SWITCH'S ON-LEVEL IS STRUCTURAL, NEVER OLUMI'S ESTIMATE (AIQ condition (c), #70 5859422189; DL on #2132
         * @510bfa00). The option turns the switch on: that 1 is what "switch" means, whoever's word it is — a bare 1, no
         * level, or `{ 1, estimate: true }` alike — so it carries no `source` and is stored as every non-estimate level is
         * (the builder's `user_specified`), exactly as a 1 the user's own words name. `cee_hypothesis` there marked the
         * option as resting on Olumi's figure, which can make results provisional and withhold a leader over a structural
         * 1. Only its today-0 is Olumi's (`cee_inference`, `stampNewSwitchFactors`). A GRADED new factor carries its level
         * only when it was set above (A1 £59, whose link then says whose level it carries, as an existing factor's does);
         * otherwise no level, and its link keeps the link-author rule (`linkAuthor`, U3).
         */
        const added = plan.newActsOn.map((a) => {
          if (isNewSwitch(a.key)) return { factor_key: a.key, value: 1 };
          const l = newGradedLevels.get(a.key);
          return l !== undefined ? { factor_key: a.key, ...l.iv } : { factor_key: a.key, value: null, ...linkAuthor(a.label) };
        });
        return { plan, set, newGradedLevels, entry: { label: plan.label, option_id: plan.optionId, interventions: [...interventions, ...added] } };
      });
      if (switchLevelConflicts.length > 0) {
        const entriesNaming = (option: string, factor: string): number =>
          plans.find((x) => x.plan.label === option)?.spec.acts_on.filter((x) => norm(x.factor_label) === norm(factor)).length ?? 1;
        // Whether any option in this change turns the switch on (a level that means on, or none).
        const turnedOnInChange = (factor: string): boolean => plans.some(({ spec }) =>
          spec.acts_on.some((x) => norm(x.factor_label) === norm(factor) && newSwitchLevelConflict(x.level) === null));
        return {
          ok: false, mutated: false, refusal: 'switch_level_not_on', switch_level_conflicts: switchLevelConflicts,
          conflict_fields: switchConflictFields,
          detail: switchLevelRefusalDetail(switchLevelConflicts, entriesNaming, turnedOnInChange, plans.length),
        };
      }
      /**
       * ⛔ ONE ENTRY PER FACTOR IN ONE OPTION (VERIFIER-S1 on A1 r2). Two acts_on entries for one factor are two answers to
       * one question: `planNewOption` keeps the FIRST entry's direction and the level reader above the LAST entry's figure,
       * so whichever the Agent wrote second decided, silently. Refused with nothing sent, whatever the entries say — even
       * two identical ones: one entry per factor is the only rule that does not hang on their order. Bound by the factor
       * each entry RESOLVES to (as `planNewOption` resolves it), never by its spelling. The same factor in two DIFFERENT
       * options is not this. Checked after the switch conflicts, so a figure a switch cannot keep is named first.
       */
      const duplicateActsOn: { option: string; factor: string; entries: number }[] = [];
      for (const { spec, plan } of plans) {
        const seen = new Map<string, { factor: string; entries: number }>();
        for (const x of spec.acts_on) {
          const wanted = norm(x.factor_label);
          if (wanted === '') continue;
          const f = rawNodes.find((n) => n.kind === 'factor' && (norm(n.label) === wanted || norm(n.description) === wanted));
          const nf = f === undefined ? newFactors.find((n) => norm(n.label) === wanted) : undefined;
          const id = f !== undefined ? `factor:${f.id}` : nf !== undefined ? `new:${nf.key}` : undefined;
          if (id === undefined) continue;
          seen.set(id, { factor: f !== undefined ? String(f.label ?? f.id) : nf!.label, entries: (seen.get(id)?.entries ?? 0) + 1 });
        }
        for (const d of seen.values()) if (d.entries > 1) duplicateActsOn.push({ option: plan.label, ...d });
      }
      if (duplicateActsOn.length > 0) {
        const d = duplicateActsOn[0]!;
        return {
          ok: false, mutated: false, refusal: 'duplicate_acts_on', duplicate_acts_on: duplicateActsOn,
          detail: `"${d.factor}" is named ${d.entries} times in "${d.option}". An option acts on each factor once, with one direction `
            + 'and at most one level, so which entry was meant cannot be told from their order. Nothing was prepared. Call '
            + `propose_new_option again with ONE entry for "${d.factor}" in that option, with the direction and the level the user `
            + 'gave (no level if they gave none). If the user gave two different figures for it, ask which one they mean.',
        };
      }
      if (unitMismatch.length > 0) {
        const m = unitMismatch[0]!;
        return {
          ok: false, mutated: false, refusal: 'level_unit_mismatch', unit_mismatch: unitMismatch,
          detail: `${m.value} ${m.unit} is not a level for ${m.factor}, which the model measures in ${m.factor_unit}. Nothing was prepared. `
            + 'A figure the user gave for something else (a price, say) is never another factor\u2019s level. Call propose_new_option '
            + `once more with that level left out, and ask the user for ${m.factor}\u2019s own figure only if they want to set it.`,
        };
      }
      if (outOfRange.length > 0) {
        const o = outOfRange[0]!;
        return {
          ok: false, mutated: false, refusal: 'level_out_of_range', out_of_range: outOfRange,
          detail: `${o.value} is outside the model's range for ${o.factor} (0 to ${o.range}). Nothing was prepared. `
            + 'Ask the user for a figure within that range, in the same units, or whether that range itself is wrong.',
        };
      }
      /** The new factors a set of options uses: a factor only a left-out option acted on is left out with it. */
      const factorsOf = (es: typeof entries) => newFactors.filter((f) => es.some((e) => e.plan.newActsOn.some((a) => a.key === f.key)));
      const parametersOf = (es: typeof entries) => {
        const nf = factorsOf(es);
        const nfWire = nf.length === 0 ? {} : { new_factors: nf.map((f) => ({
          key: f.key, label: f.label,
          affects: f.affects.map((a) => ({ node_id: a.node_id, effect_direction: a.effect_direction })),
          // Only a switch says so: a graded factor's wire is byte-identical to before.
          ...(f.kind === 'switch' ? { kind: 'switch' as const } : {}),
        })) };
        return es.length === 1
          ? { parent_decision_id: decision.id, ...es[0]!.entry, ...nfWire }
          : { parent_decision_id: decision.id, options: es.map((e) => e.entry), ...nfWire };
      };
      /**
       * ⛔ ONE TWIN NEVER SINKS THE REST (DL #70 5846812818, served F4/F4e). The product refuses a WHOLE batch when one
       * option repeats an existing option's levels, and names that option (`index`, `sameAs`). The valid options are
       * still the user's request: that one is left out, named with its twin (`not_added`), and the rest go as ONE
       * change. A lone option that is a twin is refused as before.
       */
      let kept = entries;
      const notAdded: { option: string; same_levels_as: string; olumi_suggestion?: true }[] = [];
      const markedTwin = (id: string): boolean => g.nodes.some((n) => n.kind === 'option' && n.id === id && n.proposed_by === 'olumi');
      let parameters = parametersOf(kept);
      // The product's own transaction, run here purely: a spec it would not build is never sent.
      let built = buildAddOptionsTransaction(parameters, { nodes: g.nodes as never, edges: g.edges as never });
      while (!built.matched && built.reason === 'same_levels_as_existing_option' && built.sameAs !== undefined
        && kept.length > 1 && typeof built.index === 'number' && built.index >= 0 && built.index < kept.length) {
        const twinIndex = built.index;
        notAdded.push({ option: kept[twinIndex]!.plan.label, same_levels_as: built.sameAs.label,
          ...(markedTwin(built.sameAs.id) ? { olumi_suggestion: true as const } : {}) });
        kept = kept.filter((_, i) => i !== twinIndex);
        parameters = parametersOf(kept);
        built = buildAddOptionsTransaction(parameters, { nodes: g.nodes as never, edges: g.edges as never });
      }
      const keptFactors = factorsOf(kept);
      if (!built.matched || JSON.stringify(built.operations).length > GM_HELD_OPERATIONS_MAX_JSON_CHARS) {
        const reason = !built.matched ? String(built.reason) : '';
        /**
         * ⛔ A TWIN IS NAMED (#1990 review, Runtime follow-up). The product refuses an option whose levels equal an
         * existing option's — the engine cannot tell them apart and the run drops one silently ("Not analysed").
         * The Agent says WHICH option it would repeat, so the user can change a level, never a bare "could not".
         */
        const twin = !built.matched && built.sameAs !== undefined ? built.sameAs.label : undefined;
        const twinMarked = !built.matched && built.sameAs !== undefined && markedTwin(built.sameAs.id);
        const why = reason === 'new_factor_unreachable'
          ? ' Nothing the new factor changes leads to the goal, so it could not affect the comparison: ask the user what it changes.'
          : reason === 'new_factor_exists'
            ? ' The model already has a factor by that name: name it in acts_on instead of adding it.'
            : reason === 'same_levels_as_existing_option'
              ? twinMarked
                ? ` "${twin}" is ${OLUMI_SUGGESTION_NOT_ADOPTABLE} Do not say it was added.`
                : ` It would set exactly the same levels as "${twin ?? 'an option already in the model'}", so the analysis could not tell the two apart: `
                  + 'say so, and ask the user which level this option should change.'
              : '';
        return { ok: false, mutated: false, refusal: 'not_prepared', ...(!built.matched ? { reason: built.reason } : {}),
          ...(twin !== undefined ? { same_levels_as: twin } : {}),
          ...(notAdded.length > 0 ? { not_added: notAdded } : {}),
          detail: `That could not be prepared as one change, so nothing was sent or changed.${why} Tell the user plainly.` };
      }
      const labels = kept.map((x) => x.plan.label);
      const addTurnId = authorisationTurnId(`agent_add_option:${ctx.scenario_id}:${JSON.stringify(parameters)}`);
      const sendAdd = () => dispatch('/orchestrate/v2/turn', {
        kind: 'message', turn_id: addTurnId, scenario_id: ctx.scenario_id,
        stage: 'frame', turn_class: 'frame', source: 'chip', message: `Add ${labels.map((l) => `the option "${l}"`).join(' and ')}.`,
        chip: { id: AGENT_ADD_OPTION_CHIP_ID, intent: 'add_option', parameters },
      });
      /**
       * ⭐ A6b (DL CR on #2131, option (a)) — WHOSE OPTION. It is the user's only when THIS turn's typed words name it
       * (`wordsTheUserWrote`, the lane's one said-not-asked matcher, over `user_turn_text` — never a chip's text).
       * An option Olumi suggested and the user only approves is Olumi's, and keeps Olumi's provenance: the stamp would
       * make "why is X here?" answer "you set it yourself, not because I suggested it". A new factor is never named
       * here: Olumi mints it. The ids ride IN-PROCESS to the hold (`add-option-authorship-context.ts`), never on the wire.
       */
      const userNamedIds = kept.filter((x) => wordsTheUserWrote(x.plan.label, ctx.user_turn_text)).map((x) => x.plan.optionId);
      // ⭐ PJ-A1 £49: a stated today level rides the SAME in-process context — only for a factor this change still adds.
      const keptToday = statedToday.filter((t) => keptFactors.some((f) => f.key === t.key));
      const r = userNamedIds.length === 0 && keptToday.length === 0
        ? await sendAdd()
        : await runWithUserNamedOptions({ scenarioId: ctx.scenario_id, turnId: addTurnId, optionIds: userNamedIds,
          ...(keptToday.length > 0 ? { statedToday: keptToday.map((t) => ({ label: t.label, observed_state: t.observed_state })) } : {}) }, sendAdd);
      /**
       * ⛔ HELD, OR NOT PROPOSED. The only proof is the product's own handle for THIS batch (`gmh_` over the
       * scenario and the FIRST option's id), and, where the store can be read, the held batch itself adding
       * EVERY option WITH its decision link. Anything else is a hard failure: never retried in other words.
       */
      const ref = gmHeldProposalRef(ctx.scenario_id, `node:${kept[0]!.plan.optionId}`);
      const offered = Array.isArray(r.json.suggested_actions) ? r.json.suggested_actions as { id?: unknown; label?: unknown; message?: unknown; detail?: unknown }[] : [];
      const heldChip = r.status === 200 ? offered.find((c) => c?.id === ref) : undefined;
      let heldBatchOk = heldChip !== undefined;
      if (heldBatchOk && opts.readPendingActions !== undefined) {
        try {
          const hold = await liveHeldHold(ctx.scenario_id, ref);
          const ops = hold !== undefined ? heldOpsOf(hold) : [];
          heldBatchOk = kept.every(({ plan }) => ops.some((o) => o.op === 'add_node' && o.path === plan.optionId)
            && ops.some((o) => o.op === 'add_edge' && o.path === `${decision.id}::${plan.optionId}`))
            // Every factor this change adds is in the held batch too, as a factor.
            && keptFactors.every((f) => ops.some((o) => o.op === 'add_node'
              && (o.value as { kind?: unknown } | undefined)?.kind === 'factor'
              && norm((o.value as { label?: unknown } | undefined)?.label) === norm(f.label)))
            // ⭐ PJ-A1 £49: every stated today level is on the hold, for the factor of that label — or it is not said as set.
            && keptToday.every((t) => {
              const id = ops.find((o) => o.op === 'add_node' && (o.value as { kind?: unknown } | undefined)?.kind === 'factor'
                && norm((o.value as { label?: unknown } | undefined)?.label) === norm(t.label))?.path;
              const member = ((hold as { action?: { inline_patch?: Record<string, unknown> } } | undefined)?.action?.inline_patch ?? {})[GM_HELD_GRADED_TODAY_KEY];
              // Key order is not identity: the store gives JSONB back in its own key order.
              const sameLevel = (os: unknown): boolean => {
                const o = (os ?? {}) as Record<string, unknown>;
                const want = t.observed_state as Record<string, unknown>;
                return Object.keys(o).length === Object.keys(want).length && Object.keys(want).every((k) => o[k] === want[k]);
              };
              return id !== undefined && Array.isArray(member)
                && member.some((m) => (m as { factor_id?: unknown } | null)?.factor_id === id
                  && sameLevel((m as { observed_state?: unknown }).observed_state));
            })
            // ⭐ A1 £59: every option level set on a new graded factor is on the hold, in THAT option's add_node, for the factor
            // of that label, exactly as planned — or it is not said as set.
            && kept.every(({ plan, newGradedLevels }) => plan.newActsOn.every((a) => {
              const l = newGradedLevels.get(a.key);
              if (l === undefined) return true;
              const id = ops.find((o) => o.op === 'add_node' && (o.value as { kind?: unknown } | undefined)?.kind === 'factor'
                && norm((o.value as { label?: unknown } | undefined)?.label) === norm(a.label))?.path;
              const option = ops.find((o) => o.op === 'add_node' && o.path === plan.optionId)?.value as { interventions?: Record<string, unknown> } | undefined;
              const iv = (id !== undefined ? option?.interventions?.[id] : undefined) as Record<string, unknown> | undefined;
              return iv !== undefined && iv['value'] === l.iv.value && iv['raw_value'] === l.iv.raw_value && iv['unit'] === l.iv.unit
                && iv['source'] === (l.iv.source ?? 'user_specified');
            }));
        } catch {
          heldBatchOk = false;
        }
      }
      if (!heldBatchOk) {
        // ⭐ S-D: a hold the product minted that is NOT the change asked for is never kept: held proposals now live until
        // approved or declined, so one nobody can be shown is declined here, by this door, before anyone sees it.
        if (heldChip !== undefined) withdrawnHolds.add(ref);
        // A change the product REFUSED with its own sentence (no hold offered) — say that sentence, never a bare "could not".
        const said = heldChip === undefined && r.status === 200 && typeof r.json.assistant_text === 'string' ? r.json.assistant_text.trim() : '';
        return { ok: false, mutated: false, refusal: 'not_prepared', ...(heldChip !== undefined ? { withdrawn_hold: ref } : {}),
          detail: said !== ''
            ? `Olumi did not prepare that change, so nothing was added. Olumi said: "${said}" Tell the user plainly; do not retry it in other words.`
            : 'Olumi could not prepare that as one change, so nothing was added. Tell the user plainly; do not retry it in other words.' };
      }
      heldOptionThisRequest = labels.map((l) => `"${l}"`).join(' and ');
      const described = kept.map(({ plan, set, newGradedLevels }) => ({
        label: plan.label,
        linked_from: String(decision.label ?? ''),
        acts_on: [...plan.actsOn.map((a) => a.label), ...plan.newActsOn.map((a) => a.label)],
        levels: [...plan.actsOn.map((f) => {
          const lvl = set.get(f.id);
          return lvl !== undefined
            ? { factor: f.label, value: lvl.value, ...(lvl.unit !== undefined ? { unit: lvl.unit } : {}),
              ...(lvl.by === 'olumi' ? { stated_by: 'olumi_estimate', basis: lvl.estimate } : { stated_by: 'user' }) }
            : { factor: f.label, value: null, still_needed: true };
        }),
        // A1 £59: a new graded factor's level set in this same change, said exactly as an existing factor's is.
        ...plan.newActsOn.flatMap((a) => {
          const l = newGradedLevels.get(a.key);
          return l === undefined ? [] : [{ factor: a.label, value: l.value, ...(l.unit !== undefined ? { unit: l.unit } : {}),
            ...(l.by === 'olumi' ? { stated_by: 'olumi_estimate', basis: l.basis } : { stated_by: 'user' }) }];
        })],
      }));
      return {
        ok: true, mutated: false,
        proposal_id: ref,
        public_label: typeof heldChip!.label === 'string' && heldChip!.label.trim() !== '' ? heldChip!.label : kept[0]!.plan.publicLabel,
        held_message: typeof heldChip!.message === 'string' ? heldChip!.message : '',
        // The product's full sentence when its chip label was cut to fit (`clampLabel`): the button shows it whole.
        ...(typeof heldChip!.detail === 'string' && heldChip!.detail.trim() !== '' ? { held_detail: heldChip!.detail } : {}),
        base_revision: g.graph_hash,
        ...(described.length === 1
          ? { option: { label: described[0]!.label, linked_from: described[0]!.linked_from, acts_on: described[0]!.acts_on }, levels: described[0]!.levels }
          : { options: described }),
        ...(levelsNotSet.some((l) => labels.includes(l.option)) ? { levels_not_set: levelsNotSet.filter((l) => labels.includes(l.option)) } : {}),
        // A placeholder 0 on the only entry naming a new switch was no level: the option turns the switch on.
        ...(switchPlaceholderRead.some((d) => labels.includes(d.option)) ? {
          switch_placeholder_levels_read_as_on: switchPlaceholderRead.filter((d) => labels.includes(d.option)),
          switch_placeholder_levels_note: 'Each of these options listed a new switch with a level of 0 that said nothing else (no unit, '
            + 'no estimate, no basis): a placeholder, not a figure. It was read as no level, so the option turns the switch on, as the '
            + 'approval shows. The change is otherwise exactly as asked; never send a placeholder level for a switch: leave level out.',
        } : {}),
        // An option that listed a new switch at 0 leaves it off: that entry was dropped, and the option that turns it on sets it.
        ...(switchOffDropped.some((d) => labels.includes(d.option)) ? {
          switch_off_entries_dropped: switchOffDropped.filter((d) => labels.includes(d.option)),
          switch_off_entries_note: 'Each of these options listed a new switch at 0, meaning it leaves the switch off. The switch is off '
            + 'today, so that entry was left out: the option does not act on it (no link, no level), and the option that turns it on '
            + 'is the one that sets it. The change is otherwise exactly as asked; do not list a switch under an option that leaves it off.',
        } : {}),
        ...(notAdded.length > 0 ? {
          not_added: notAdded,
          not_added_note: `${notAdded.map((n) => n.olumi_suggestion
            ? `"${n.option}" is NOT in this change: "${n.same_levels_as}" is ${OLUMI_SUGGESTION_NOT_ADOPTABLE}`
            : `"${n.option}" is NOT in this change: it would set exactly the same levels as "${n.same_levels_as}", so the analysis could not tell the two apart`).join('; ')}. `
            + 'For an ordinary twin, ask what makes it different; a distinct option requires a new proposal and approval. '
            + 'For Olumi\'s marked suggestion, adoption is unavailable. Never promise to add it later.',
        } : {}),
        ...(keptFactors.length > 0 ? {
          new_factors: keptFactors.map((f) => ({
            label: f.label,
            changes: f.affects.map((a) => `${a.label} (${a.effect_direction === 'positive' ? 'raises it' : 'lowers it'})`),
            how_strongly: 'Olumi\u2019s estimate, for the user to correct',
            ...(f.kind === 'switch'
              ? { kind: 'switch', today: 'off \u2014 Olumi\u2019s reading of the option, for the user to correct', under_the_option: 'on' }
              : ((): { current_value: null | { value: number; unit?: string; stated_by: 'user' } } => {
                const t = keptToday.find((x) => x.key === f.key);
                return { current_value: t === undefined ? null : { value: t.value, ...(t.unit !== undefined ? { unit: t.unit } : {}), stated_by: 'user' } };
              })()),
          })),
          new_factors_note: keptFactors.every((f) => f.kind === 'switch')
            ? NEW_SWITCH_NOTE
            : 'This change also ADDS these factors. Say so: what each changes and which way, that how strongly is Olumi\u2019s '
              + 'estimate, and that its current value is not set yet. Ask the user what it is today (for example, whether it is '
              + 'offered at all yet) \u2014 nothing else will ask, and the comparison needs it; never say the analysis will ask for it.'
              + (keptToday.length > 0 ? ' Except a factor whose current_value is set: that is its value today as the user stated it '
                + '(stated_by user), recorded with this change \u2014 say it, and do not ask for it.' : '')
              + (keptFactors.some((f) => f.kind === 'switch') ? ` Except the switches (kind switch): ${NEW_SWITCH_NOTE}` : ''),
        } : {}),
        ...(todayNotSet.some((x) => keptFactors.some((f) => f.label === x.factor)) ? {
          today_not_set: todayNotSet.filter((x) => keptFactors.some((f) => f.label === x.factor)),
          today_not_set_note: 'A today value you gave for a factor this change adds was NOT taken (each with why). Never say it '
            + 'was recorded. Where it says to, ask the user what it is today.',
        } : {}),
        note:
          `Nothing has changed yet. Show the user ${described.length === 1 ? 'the option' : `all ${described.length} options, as ONE change they approve once`}, `
          + 'that each is linked from the decision, what it acts on and each level — saying plainly which have no level yet, and which '
          + 'levels are Olumi\u2019s estimates (stated_by olumi_estimate), with why, for the user to correct — never the id, '
          + 'and call authorise_change with this proposal_id once they agree.',
      };
    },

    /**
     * ⭐ SLICE C2 — A NEW RISK, HELD ON THE PRODUCT'S OWN SEAM (Canonical #70 5855234599). Paul's served test (27 Sep,
     * 90b8f080): the Agent offered a "competitive response" risk, he said "Yes.", and there was nothing it could apply.
     * Labels resolve to ids by the SAME rule every proposer uses (`resolveNamed`); the batch is built purely first
     * (`buildAddRiskTransaction`, the door's own builder: a spec it would refuse is never sent); then the product's
     * add-risk door holds it as ONE `gmh_` pending pinned to the model this read saw. Held, or not proposed: the handle
     * must be the product's for THIS risk and, where the store can be read, the hold must add the risk and every link.
     */
    async proposeNewRisk(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      if (opts.holdAddRisk === undefined) {
        return { ok: false, mutated: false, refusal: 'unavailable', detail: 'A risk cannot be added here. Nothing was changed. Tell the user plainly.' };
      }
      const label = typeof args?.label === 'string' ? args.label.trim() : '';
      if (label === '') {
        return { ok: false, mutated: false, refusal: 'unreadable_risk', detail: 'A new risk needs a name, in the user’s words. Nothing was prepared.' };
      }
      const requestedAffects = Array.isArray(args?.affects) ? args.affects : [];
      const requestedCauses = Array.isArray(args?.caused_by) ? args.caused_by : [];
      const widenPrecondition = ctx.widen_relies_on === undefined ? undefined : readReliesOnRisk(ctx.widen_relies_on);
      if (ctx.widen_relies_on !== undefined && (widenPrecondition === undefined || requestedAffects.length !== 0 || requestedCauses.length !== 0)) {
        return { ok: false, mutated: false, refusal: 'invalid_precondition', detail: 'Nothing was prepared: this option precondition must have no links.' };
      }
      // Preserve the ordinary no-affects refusal without a read. Only a non-empty chat lease needs the canonical read first.
      const chatLease = typeof args?.relies_on_option === 'string' && args.relies_on_option.trim() !== '' ? args.relies_on_option : undefined;
      if (requestedAffects.length === 0 && widenPrecondition === undefined && chatLease === undefined) {
        return { ok: false, mutated: false, refusal: 'no_affects',
          detail: `Nothing was prepared. ${RISK_LINKS_RULE} Ask the user what "${label}" would hurt if it happened.` };
      }
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      // A model label is only a lease: the HOST mints the stamp, through exactly the existing widen hold path.
      // Invalid/unrelated/ambiguous/baseline labels are ignored; their ordinary links are left intact.
      const precondition = widenPrecondition ?? chatRiskPreconditionFor(chatLease, label, g, g.brief_text);
      const affects = precondition === undefined ? requestedAffects : [];
      const causedBy = precondition === undefined ? requestedCauses : [];
      if (affects.length === 0 && precondition === undefined) {
        return { ok: false, mutated: false, refusal: 'no_affects',
          detail: `Nothing was prepared. ${RISK_LINKS_RULE} Ask the user what "${label}" would hurt if it happened.` };
      }
      const preconditionOption = precondition === undefined ? undefined : g.nodes.find((n) => n.id === precondition.option_id && n.kind === 'option');
      if (precondition !== undefined && preconditionOption === undefined) {
        return { ok: false, mutated: false, refusal: 'invalid_precondition', detail: 'The option this risk relies on is no longer in the model. Nothing was prepared.' };
      }
      if (g.nodes.some((n) => norm(n.label) === norm(label))) {
        return { ok: false, mutated: false, refusal: 'risk_exists',
          detail: `The model already has something called "${label}", so nothing was prepared. Describe it from the model instead of adding it again.` };
      }
      const links: { from_id?: string; to_id?: string; effect_direction: 'positive' | 'negative' }[] = [];
      const ambiguous: AmbiguousTarget[] = [];
      const direction = (d: unknown): 'positive' | 'negative' | null => (d === 'positive' || d === 'negative' ? d : null);
      for (const a of affects as { target_label?: unknown; direction?: unknown }[]) {
        const asked = String(a?.target_label ?? '');
        const dir = direction(a?.direction);
        const res = resolveNamed(g, asked, (n) => n.kind === 'goal' || n.kind === 'outcome');
        if (res.kind === 'ambiguous') { ambiguous.push(describeAmbiguity(g, asked, res.candidates)); continue; }
        if (res.kind === 'other' && res.node.kind === 'factor') {
          // ⛔ Never INTO a factor: said in the words the Agent can repeat, and nothing is prepared.
          return { ok: false, mutated: false, refusal: 'risk_affects_factor',
            detail: `Nothing was prepared: a risk affects the goal or an outcome, not a factor directly. "${res.node.label}" is a factor. `
              + 'Say that plainly, and ask which outcome or goal the risk would hurt (a factor that makes the risk more likely goes in caused_by).' };
        }
        if (res.kind !== 'one') {
          return { ok: false, mutated: false, refusal: 'target_not_goal_or_outcome',
            detail: res.kind === 'none'
              ? `The model has nothing called "${asked}", so nothing was prepared. ${RISK_LINKS_RULE}`
              : `"${asked}" is not the goal or an outcome, so nothing was prepared. ${RISK_LINKS_RULE}` };
        }
        if (dir === null) {
          return { ok: false, mutated: false, refusal: 'direction_not_stated',
            detail: `Nothing was prepared: say whether "${label}" would raise or lower "${res.node.label}", from the user’s words; if it is unclear, ask.` };
        }
        links.push({ to_id: res.node.id, effect_direction: dir });
      }
      // Only the user's turn may author the likelihood or name its drivers.
      const userText = ctx.user_turn_text ?? ctx.user_text ?? '';
      // A precondition carries no occurrence: the reader can mistake an impact ("cut MRR by 10% within 6 months") for a likelihood (Codex #2823 r1).
      const stated = precondition === undefined ? readStatedEventRisk(userText) : undefined;
      const driverLabels = stated === undefined ? [] : causedBy.map((c) => {
        const asked = String(c?.factor_label ?? '');
        const resolved = resolveNamed(g, asked, (node) => node.kind === 'factor');
        return resolved.kind === 'one' ? resolved.node.label : asked;
      });
      const droppedDrivers = stated !== undefined && causedBy.length > 0
        && !driverLabels.some((driver) => isFactorNamedByUser(driver, userText)) ? driverLabels : [];
      const riskCauses = droppedDrivers.length > 0 ? [] : causedBy;
      const eventRisk = riskCauses.length === 0 ? stated : undefined;
      for (const c of riskCauses as { factor_label?: unknown; direction?: unknown }[]) {
        const asked = String(c?.factor_label ?? '');
        const dir = direction(c?.direction);
        const res = resolveNamed(g, asked, (n) => n.kind === 'factor');
        if (res.kind === 'ambiguous') { ambiguous.push(describeAmbiguity(g, asked, res.candidates)); continue; }
        if (res.kind !== 'one') {
          return { ok: false, mutated: false, refusal: 'cause_not_a_factor',
            detail: `"${asked}" is not a factor in the model, so nothing was prepared. What drives a risk must be one of the model’s factors; leave caused_by out if none does.` };
        }
        if (dir === null) {
          return { ok: false, mutated: false, refusal: 'direction_not_stated',
            detail: `Nothing was prepared: say whether raising "${res.node.label}" makes "${label}" more or less likely, from the user’s words; if it is unclear, ask.` };
        }
        links.push({ from_id: res.node.id, effect_direction: dir });
      }
      if (ambiguous.length > 0) {
        return { ok: false, mutated: false, refusal: 'ambiguous_target', ambiguous_targets: ambiguous, detail: AMBIGUOUS_NOTE };
      }
      // The door's own builder, run here purely: a spec it would refuse is never sent.
      const built = buildAddRiskTransaction({ risk: { label }, links }, { nodes: g.nodes as never, edges: g.edges as never }, precondition);
      if (!built.matched) {
        const why = built.reason === 'kind_pair_not_allowed'
          ? ` ${RISK_LINKS_RULE}`
          : built.reason === 'risk_unreachable'
            ? riskUnreachableWhy(g, label, links)
            : '';
        return { ok: false, mutated: false, refusal: 'not_prepared', reason: built.reason,
          detail: `That risk could not be prepared as one change, so nothing was sent or changed.${why} Tell the user plainly.` };
      }
      const riskId = built.proposal.riskId;
      const res = await opts.holdAddRisk({
        scenario_id: ctx.scenario_id,
        // A fresh row per offer (see `HoldAddRiskInput.turn_id`): a lapsed hold never blocks offering the same risk again.
        turn_id: randomUUID(),
        base_graph_hash: g.graph_hash,
        risk: { id: riskId, label },
        links,
        ...(precondition === undefined ? {} : { relies_on: precondition }),
        ...(eventRisk !== undefined ? { user_event_risk: eventRisk } : {}),
      });
      if (res.status === 'stale') {
        return { ok: false, mutated: false, refusal: 'model_changed',
          detail: 'The model changed while this was being prepared, so nothing was held. Read it again and propose afresh.' };
      }
      const ref = gmHeldProposalRef(ctx.scenario_id, `node:${riskId}`);
      let heldOk = res.status === 'held' && res.proposal_id === ref && res.risk_id === riskId;
      if (heldOk && opts.readPendingActions !== undefined) {
        try {
          const hold = await liveHeldHold(ctx.scenario_id, ref);
          const ops = hold !== undefined ? heldOpsOf(hold) : [];
          heldOk = (eventRisk === undefined || (hold !== undefined && isDeepStrictEqual((hold.action as { inline_patch?: Record<string, unknown> }).inline_patch?.[GM_HELD_USER_EVENT_RISK_KEY], { risk_id: riskId, ...eventRisk })))
            && ops.some((o) => o.op === 'add_node' && o.path === riskId)
            && (precondition === undefined || (reliesOnRefereeOperations(ops as PatchOperation[], g) !== undefined
              && ops.some((o) => o.op === 'add_node' && o.path === riskId
                && isDeepStrictEqual((o.value as Record<string, unknown>)?.relies_on, precondition))))
            && built.proposal.links.every((l) => ops.some((o) => o.op === 'add_edge' && o.path === `${l.from}::${l.to}`));
        } catch {
          heldOk = false;
        }
      }
      if (!heldOk || res.status !== 'held') {
        return { ok: false, mutated: false, refusal: 'not_prepared', ...(res.status === 'refused' ? { reason: res.reason } : {}),
          detail: res.status === 'refused' && res.reason === 'kind_pair_not_allowed'
            ? `Olumi did not prepare that change, so nothing was added. ${RISK_LINKS_RULE} Tell the user plainly.`
            : 'Olumi could not prepare that as one change, so nothing was added. Tell the user plainly; do not retry it in other words.' };
      }
      const labelOfId = (id: string): string => String(g.nodes.find((n) => n.id === id)?.label ?? id);
      const effect = (d: 'positive' | 'negative'): string => (d === 'positive' ? 'raises it' : 'lowers it');
      return {
        ok: true, mutated: false,
        proposal_id: ref,
        public_label: res.public_label.trim() !== '' ? res.public_label : `Add the risk "${label}"`,
        held_message: res.held_message,
        ...(res.detail !== undefined && res.detail.trim() !== '' ? { held_detail: res.detail } : {}),
        base_revision: g.graph_hash,
        risk: {
          label,
          ...(precondition === undefined ? {} : { relies_on: { option_id: precondition.option_id, option_label: preconditionOption!.label } }),
          ...(precondition !== undefined && (requestedAffects.length > 0 || requestedCauses.length > 0) ? { links_dropped: true } : {}),
          ...(eventRisk !== undefined ? { likelihood: { p_low_pct: eventRisk.event_risk.occurrence.p_low * 100, p_high_pct: eventRisk.event_risk.occurrence.p_high * 100, horizon_months: eventRisk.event_risk.horizon.months, basis: 'user', quote: eventRisk.quote } } : {}),
          threatens: built.proposal.links.filter((l) => l.from === riskId).map((l) => `${labelOfId(l.to)} (${effect(l.effect_direction)})`),
          driven_by: built.proposal.links.filter((l) => l.to === riskId).map((l) => `${labelOfId(l.from)} (${l.effect_direction === 'positive' ? 'more of it makes the risk more likely' : 'more of it makes the risk less likely'})`),
          how_strongly: 'not known yet: Olumi uses a placeholder strength for each link, not an estimate',
        },
        ...(droppedDrivers.length > 0 ? { dropped_drivers: droppedDrivers } : {}),
        note: precondition !== undefined
          ? `Nothing has changed yet. This risk is kept without links because it is a precondition of ‘${preconditionOption!.label}’. `
          + "The Run leaves it out because it cannot yet apply the risk to that option alone; that option's chance does not include it yet. Nothing is added until you approve it."
          : 'Nothing has changed yet. Tell the user it will add the risk, what it threatens and what drives it, and that how strongly '
          + 'is a placeholder for them to correct — never the id — and call authorise_change with this proposal_id once they agree.'
          + (stated !== undefined && riskCauses.length > 0 ? ' ' + HELD_RISK_CAUSE_NOTE : '')
          + (droppedDrivers.length > 0 ? ` I left out ${droppedDrivers.map((driver) => `'${driver}'`).join(' and ')} as ${droppedDrivers.length === 1 ? 'a driver' : 'drivers'}: a risk with a stated likelihood can't have a driver in the model yet. Say if you'd rather keep the driver as an ordinary risk instead.` : '')
          + (stated === undefined && readStatedLikelihoodWithoutWindow(userText) ? ' ' + HELD_RISK_WINDOW_NOTE : ''),
      };
    },

    /**
     * ⭐ PJ-E-FIG — NEW FACTORS CARRYING THE FIGURES THE USER STATED, HELD ON THE PRODUCT'S OWN SEAM (Delivery Lead #72
     * 5866036457, on Canonical 5866021645). Journey E: "Senior engineers cost £120k a year each and juniors £65k a year
     * each." — the Agent had no path to hold those figures. The add-risk door's twin: labels resolve by `resolveNamed`; the
     * batch is built purely first (`buildAddFactorTransaction`); then the product's add-factor door holds it as ONE `gmh_`
     * pending pinned to the model this read saw. ALL OR NOTHING: 1..3 factors, each with the user's figure, in one hold.
     *
     * THE FIGURE is taken ONLY when the user's own words in THIS message write it about THIS factor (`figureTheUserWroteFor`
     * on `newFactorScopeIn`: never the other factor's figure, never the limit's); otherwise the whole call is refused and
     * said (`today_not_set`), nothing held. It is
     * framed by the ONE rule (`framedObservedState` on `defaultFrameFor`, the statedToday block in `proposeNewOption`), then
     * stamped as the user's (`USER_TODAY_SOURCE`). The range is Olumi's: said ONCE, by the confirm that writes it.
     */
    async proposeNewFactor(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      if (opts.holdAddFactor === undefined) {
        return { ok: false, mutated: false, refusal: 'unavailable', detail: 'A factor cannot be added here. Nothing was changed. Tell the user plainly.' };
      }
      const requested = Array.isArray(args?.factors) ? args.factors as readonly unknown[] : [];
      if (requested.length === 0 || requested.length > MAX_FACTORS_PER_ADD) {
        return { ok: false, mutated: false, refusal: 'no_factors',
          detail: `Nothing was prepared: one change adds 1 to ${MAX_FACTORS_PER_ADD} new factors. Tell the user plainly.` };
      }
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const planned: { label: string; unit: string; value: number; to_id: string; direction: 'positive' | 'negative'; observed_state: Record<string, unknown>; basis: UserTodayBasis; quote: string;
        range?: { low: number; high: number; quote: string } }[] = [];
      const todayNotSet: { factor: string; value: unknown; reason: string }[] = [];
      let originUnknown = false;
      const ambiguous: AmbiguousTarget[] = [];
      const recordOf = (x: unknown): Record<string, unknown> => (x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});
      // Every new factor named in THIS call, with its declared unit: each one's figure is never another's (`newFactorScopeIn`).
      const inCall = requested.map((x) => recordOf(x)).map((x) => ({
        label: typeof x.label === 'string' ? x.label.trim() : '',
        unit: typeof x.unit === 'string' ? x.unit.trim() : '',
      }));
      // The route's retained typed-word records exclude chips, assistant text and source-unknown restored rows.
      // Reusing a verified earlier figure does not change its author. Multiple figures still need pairing approval.
      const turnText = ctx.user_turn_text ?? '';
      const sourceMessages = ctx.verified_user_messages ?? [ctx.user_text ?? turnText];
      const confirmPairing = inCall.length >= 2 || figuresWrittenIn(turnText) >= 2;
      // Existing held quantity records retain their independently verified figure/range source across turns.
      const retained = (await opts.readPendingActions?.(ctx.scenario_id) ?? []).flatMap(hold => {
        const patch = (hold.action as { inline_patch?: Record<string, unknown> }).inline_patch;
        const raw = patch?.[GM_HELD_USER_TODAY_KEY];
        const verified = readUserTodayMember(raw);
        return (Array.isArray(raw) ? raw : []).flatMap(entry => {
          const row = recordOf(entry), os = recordOf(row.observed_state);
          const op = heldOpsOf(hold).find(o => o.op === 'add_node' && o.path === row.factor_id);
          const name = recordOf(op?.value).label;
          return typeof name === 'string' ? [{ label: name, os, member: verified?.find(m => m.factor_id === row.factor_id) }] : [];
        });
      });
      for (const raw of requested) {
        const f = recordOf(raw);
        const label = typeof f.label === 'string' ? f.label.trim() : '';
        if (label === '') {
          return { ok: false, mutated: false, refusal: 'unreadable_factor', detail: 'A new factor needs a name, in the user’s words. Nothing was prepared.' };
        }
        if (g.nodes.some((n) => norm(n.label) === norm(label))) {
          return { ok: false, mutated: false, refusal: 'factor_exists',
            detail: `The model already has something called "${label}", so nothing was prepared. A value for a factor the model `
              + 'already has is set with propose_assumptions (revise: true when it already holds one), not added again.' };
        }
        if (planned.some((p) => norm(p.label) === norm(label)) || todayNotSet.some((t) => norm(t.factor) === norm(label))) {
          return { ok: false, mutated: false, refusal: 'duplicate_factor', detail: `"${label}" is named twice in one change, so nothing was prepared.` };
        }
        const unit = typeof f.unit === 'string' && f.unit.trim() !== '' ? f.unit.trim() : '';
        if (unit === '') {
          return { ok: false, mutated: false, refusal: 'unit_not_stated',
            detail: `Nothing was prepared: give the unit of "${label}" as the user gave it (for example GBP/year per engineer).` };
        }
        const asked = String(f.affects ?? '');
        const res = resolveNamed(g, asked, (n) => isNewFactorTarget({ kind: n.kind, ...(typeof n.category === 'string' ? { category: n.category } : {}) }));
        if (res.kind === 'ambiguous') { ambiguous.push(describeAmbiguity(g, asked, res.candidates)); continue; }
        if (res.kind === 'other' && res.node.kind === 'factor') {
          return { ok: false, mutated: false, refusal: 'target_is_a_lever',
            detail: `Nothing was prepared: "${res.node.label}" is set by the options, so nothing else may drive it. Link "${label}" to `
              + 'the goal, the outcome or the non-lever factor (one no option sets) it affects instead, from the user’s words; if it is unclear, ask.' };
        }
        if (res.kind !== 'one') {
          return { ok: false, mutated: false, refusal: res.kind === 'none' ? 'target_not_found' : 'target_not_allowed',
            detail: res.kind === 'none'
              ? `The model has nothing called "${asked}", so nothing was prepared. A new factor drives the goal, an outcome or a non-lever factor (one no option sets).`
              : `"${asked}" is ${res.node.kind === 'option' ? 'an option' : `a ${res.node.kind}`}, so nothing was prepared. A new factor drives the goal, an outcome or a non-lever factor (one no option sets) — never a risk, an option or a decision.` };
        }
        const direction = f.direction === 'positive' || f.direction === 'negative' ? f.direction : null;
        if (direction === null) {
          return { ok: false, mutated: false, refusal: 'direction_not_stated',
            detail: `Nothing was prepared: say whether more "${label}" raises or lowers "${res.node.label}", from the user’s words; if it is unclear, ask.` };
        }
        const t = recordOf(f.today);
        const todayUnit = typeof t.unit === 'string' && t.unit.trim() !== '' ? t.unit.trim() : unit;
        const shown = `${typeof t.value === 'number' ? t.value : JSON.stringify(t.value ?? null)} ${todayUnit}`;
        if (typeof t.value !== 'number' || !Number.isFinite(t.value)) {
          todayNotSet.push({ factor: label, value: t.value ?? null,
            reason: `${shown} is not a level "${label}" can hold, so it was not taken. Ask the user what it is.` });
          continue;
        }
        // ⛔ A figure in another kind of unit is never this factor's value (`unit-conflict.ts`): £120k is not a level for a
        // factor measured in engineers. Refused whole and said (review finding 3), never the declared unit silently dropped.
        if (unitsConflict(todayUnit, unit) !== null) {
          todayNotSet.push({ factor: label, value: t.value,
            reason: `${shown} is not the kind of figure "${label}" holds (it is measured in ${unit}), so it was not taken. Ask the user which they meant.` });
          continue;
        }
        const scaled = readCurrencyUnitWithQualifiers(todayUnit);
        if (scaled.kind === 'currency' && Number.isFinite(scaled.multiplier) && scaled.multiplier > 1) {
          todayNotSet.push({ factor: label, value: t.value,
            reason: `${shown} is in a scaled unit; give the figure in whole units (120000 for £120k) in the user's own unit.` });
          continue;
        }
        // Read each verified message separately: a figure in a different message cannot lend its subject to this one.
        const source = [turnText, ...sourceMessages.slice().reverse()].find(text =>
          quoteOfFigure(t.value as number, todayUnit, text) !== null
          && (confirmPairing || figureTheUserWroteFor(t.value as number, todayUnit, text, newFactorScopeIn(g, label, todayUnit, inCall))));
        const prior = retained.find(r => norm(r.label) === norm(label)
          && (r.os.raw_value ?? r.os.value) === t.value && unitComparisonKey(String(r.os.unit ?? '')) === unitComparisonKey(todayUnit));
        const priorHuman = prior?.member !== undefined && prior.member.basis !== 'olumi_estimate'
          && provenanceOf({ value: prior.os }).origin === 'human';
        const quote = source === undefined ? (priorHuman ? prior!.member!.quote ?? null : null) : quoteOfFigure(t.value, todayUnit, source);
        const origin = statementOrigin(source !== undefined || priorHuman,
          (prior !== undefined && prior.member === undefined)
          || quoteOfFigure(t.value, todayUnit, ctx.unverified_user_text ?? '') !== null
          || quoteOfFigure(t.value, todayUnit, g.brief_text ?? '') !== null, ctx.user_text_complete);
        const ownsIt = origin === 'human';
        if (origin === 'unknown') {
          originUnknown = true;
          todayNotSet.push({ factor: label, value: t.value,
            reason: `The retained source of ${shown} for "${label}" is not verified. Its origin stays unknown; nothing was prepared. Ask for its source rather than relabelling it as Olumi’s estimate.` });
          continue;
        }
        // THE ONE FRAMING RULE (ruling point 3; `proposeNewOption` statedToday): Olumi's default range over the largest
        // figure this change carries. The frame stays Olumi's; the figure keeps its actual source.
        const v = t.value;
        const framed = { ...framedObservedState({ baseline_value: v, unit: todayUnit, provenance: ownsIt ? 'explicit' : 'inferred',
          plausible_max: v > 1 ? defaultFrameFor(Math.abs(v)) : null }), source: ownsIt ? USER_TODAY_SOURCE : 'cee_inference',
          extractionType: ownsIt ? 'explicit' : 'inferred' };
        // ⭐ RECOVERY BATCH B (SYS3 TRACE L6): the RANGE the user gave for this figure ("between 20% and 30%") is stored AS A
        // RANGE beside the figure they chose (`isStatedLevelRange`, add-factor-transaction.ts), only when BOTH ends are in ONE
        // sentence the user wrote in this conversation and the chosen figure lies inside. Never a midpoint: the figure is still
        // attributed independently of the range; an Olumi point is never a user-stated figure.
        const heldRange = prior?.member?.observed_state.range;
        let range: { low: number; high: number; quote: string } | undefined = isStatedLevelRange(heldRange, framed)
          ? { low: (heldRange as { low: number }).low, high: (heldRange as { high: number }).high, quote: (heldRange as { source_quote: string }).source_quote } : undefined;
        if (t.range_low !== undefined || t.range_high !== undefined) {
          const lo = t.range_low, hi = t.range_high;
          const sentence = typeof lo === 'number' && typeof hi === 'number' ? sentenceStatingBoth(lo, hi, todayUnit, ctx.user_text ?? turnText) : null;
          const stored = sentence === null ? undefined
            : { low: lo as number, high: hi as number, meaning: 'min_max' as const, source: USER_TODAY_SOURCE, source_quote: sentence };
          if (!ownsIt || stored === undefined || !isStatedLevelRange(stored, framed)) {
            todayNotSet.push({ factor: label, value: t.value,
              reason: `The range ${String(lo ?? '?')} to ${String(hi ?? '?')} ${todayUnit} for "${label}" is not one the user wrote, both ends in one sentence of theirs, `
                + `with ${shown} inside it, so nothing was prepared. Ask the user; never supply a range, an end or a midpoint of your own.` });
            continue;
          }
          range = { low: stored.low, high: stored.high, quote: sentence! };
        }
        const observed = range === undefined ? framed
          : { ...framed, range: { low: range.low, high: range.high, meaning: 'min_max', source: USER_TODAY_SOURCE, source_quote: range.quote } };
        planned.push({ label, unit: todayUnit, value: v, to_id: res.node.id, direction, observed_state: observed,
          basis: ownsIt ? (source === undefined ? prior!.member!.basis ?? 'written_about' : confirmPairing ? 'confirmed_by_approval' : 'written_about') : 'olumi_estimate', quote: ownsIt ? quote ?? '' : '', ...(range !== undefined ? { range } : {}) });
      }
      if (ambiguous.length > 0) {
        return { ok: false, mutated: false, refusal: 'ambiguous_target', ambiguous_targets: ambiguous, detail: AMBIGUOUS_NOTE };
      }
      if (todayNotSet.length > 0) {
        return { ok: false, mutated: false, refusal: originUnknown ? 'origin_unknown' : 'today_not_set', today_not_set: todayNotSet,
          detail: originUnknown ? UNKNOWN_ORIGIN_DETAIL : 'Nothing was prepared or held: each new factor needs a finite figure in its known unit. '
            + 'Explain the invalid figure or unit from today_not_set; do not substitute zero or invent a unit.' };
      }
      // The door's own builder, run here purely: a spec it would refuse is never sent.
      const factors = planned.map((p) => ({ label: p.label, link: { to_id: p.to_id, effect_direction: p.direction } }));
      const built = buildAddFactorTransaction({ factors }, { nodes: g.nodes as never, edges: g.edges as never });
      if (!built.matched) {
        return { ok: false, mutated: false, refusal: 'not_prepared', reason: built.reason,
          detail: built.reason === 'new_factor_unreachable'
            ? 'Nothing was prepared: what the new factor drives does not lead to the goal, so it could not change the comparison. Ask the user what it affects.'
            : 'Those factors could not be prepared as one change, so nothing was sent or changed. Tell the user plainly.' };
      }
      const ids = built.proposal.factors.map((f) => f.id);
      const res = await opts.holdAddFactor({
        scenario_id: ctx.scenario_id,
        turn_id: randomUUID(),
        base_graph_hash: g.graph_hash,
        factors: planned.map((p, i) => ({ id: ids[i]!, label: p.label, link: { to_id: p.to_id, effect_direction: p.direction }, observed_state: p.observed_state,
          basis: p.basis, ...(p.quote !== '' ? { quote: p.quote } : {}) })),
      });
      if (res.status === 'stale') {
        return { ok: false, mutated: false, refusal: 'model_changed',
          detail: 'The model changed while this was being prepared, so nothing was held. Read it again and propose afresh.' };
      }
      const ref = gmHeldProposalRef(ctx.scenario_id, `node:${ids[0]!}`);
      let heldOk = res.status === 'held' && res.proposal_id === ref && JSON.stringify(res.factor_ids) === JSON.stringify(ids);
      if (heldOk && opts.readPendingActions !== undefined) {
        try {
          const hold = await liveHeldHold(ctx.scenario_id, ref);
          const ops = hold !== undefined ? heldOpsOf(hold) : [];
          // JSONB reorders keys: the figures are compared key-order-insensitively, never by bytes.
          const sorted = (x: unknown): unknown => (Array.isArray(x) ? x.map(sorted) : x !== null && typeof x === 'object'
            ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sorted((x as Record<string, unknown>)[k])])) : x);
          const member = hold !== undefined ? readUserTodayMember((hold.action as { inline_patch?: Record<string, unknown> }).inline_patch?.[GM_HELD_USER_TODAY_KEY]) : undefined;
          heldOk = built.proposal.factors.every((f) => ops.some((o) => o.op === 'add_node' && o.path === f.id)
            && ops.some((o) => o.op === 'add_edge' && o.path === `${f.id}::${f.to}`))
            && member !== undefined && member.length === planned.length
            && planned.every((p, i) => JSON.stringify(sorted(member.find((m) => m.factor_id === ids[i])?.observed_state)) === JSON.stringify(sorted(p.observed_state)))
            // The record of WHY each figure is theirs is on the hold, exactly as prepared.
            && planned.every((p, i) => { const m = member.find((x) => x.factor_id === ids[i]); return m?.basis === p.basis && (m?.quote ?? '') === p.quote; });
        } catch {
          heldOk = false;
        }
      }
      if (!heldOk || res.status !== 'held') {
        return { ok: false, mutated: false, refusal: 'not_prepared', ...(res.status === 'refused' ? { reason: res.reason } : {}),
          detail: res.status === 'refused' && res.reason === 'target_not_allowed'
            ? 'Olumi did not prepare that change, so nothing was added. A new factor drives the goal, an outcome or a non-lever factor (one no option sets). Tell the user plainly.'
            : 'Olumi could not prepare that as one change, so nothing was added. Tell the user plainly; do not retry it in other words.' };
      }
      const labelOfId = (id: string): string => String(g.nodes.find((n) => n.id === id)?.label ?? id);
      return {
        ok: true, mutated: false,
        proposal_id: ref,
        public_label: res.public_label.trim() !== '' ? res.public_label : 'Add these factors',
        held_message: res.held_message,
        ...(res.detail !== undefined && res.detail.trim() !== '' ? { held_detail: res.detail } : {}),
        base_revision: g.graph_hash,
        factors: planned.map((p) => ({
          label: p.label,
          // `user_to_confirm`: the figure is in their words, and the PAIRING is Olumi's until they approve it (the card
          // shows `quote`). `user`: one figure for one factor, written about it.
          current_value: { value: p.value, unit: p.unit, stated_by: p.basis === 'olumi_estimate' ? 'olumi_estimate' : p.basis === 'confirmed_by_approval' ? 'user_to_confirm' : 'user', quote: p.quote,
            ...(p.range !== undefined ? { range: { low: p.range.low, high: p.range.high, quote: p.range.quote } } : {}) },
          affects: `${labelOfId(p.to_id)} (${p.direction === 'positive' ? 'raises it' : 'lowers it'})`,
          how_strongly: FACTOR_PLACEHOLDER_STRENGTH,
        })),
        note: planned.some(p => p.basis === 'olumi_estimate')
          ? 'Nothing has changed yet. Show each figure and unit with its actual source. A figure marked olumi_estimate is Olumi’s estimate, never the user’s words. Only approval of this card records these figures.'
          : confirmPairing
          ? 'Nothing has changed yet. Show the user each factor with its figure and their own words quoted, say that Olumi paired '
            + 'each figure with its factor and they approve only if every pairing is right, say what each affects and that how '
            + 'strongly is a placeholder — never the id — and call authorise_change with this proposal_id once they agree.'
          : 'Nothing has changed yet. Tell the user it will add each factor with the figure they gave, what it affects, and that '
            + 'how strongly is a placeholder for them to correct — never the id — and call authorise_change with this proposal_id once they agree.',
      };
    },

    /** S-E S4: one ceiling from this message, held for approval on an existing quantity. */
    async proposeNewLimit(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const text = typeof ctx.user_turn_text === 'string' ? ctx.user_turn_text : '';
      const value = readNewLimit(g.raw, text, Number(args.value), args.quantity_label);
      if (value === null) {
        const figures = findStatedAmounts(text).filter(a => a.magnitude === Number(args.value));
        const money = figures.length > 0 && figures.every(a => a.kind === 'currency');
        return { ok: false, mutated: false, refusal: 'limit_not_bound',
          ...(money && !hasLimitQuantity(g.raw, args.quantity_label) ? { reply: NO_LIMIT_QUANTITY,
            detail: `Say exactly this one line, with no chip: ${NO_LIMIT_QUANTITY}` } : {}) };
      }
      const existing = (Array.isArray(g.raw.goal_constraints) ? g.raw.goal_constraints as Record<string, unknown>[] : [])
        .filter(c => c.node_id === value.node_id);
      if (existing.length > 0) {
        if (existing.length !== 1 || existing[0]?.operator !== '<=') return { ok: false, mutated: false, refusal: 'limit_ambiguous' };
        return caps.proposeLimitChange!( { ...ctx, user_text: text }, { limit_label: args.quantity_label, operator: '<=',
          new_value: value.raw_value, unit: value.unit, rationale: args.rationale });
      }
      if (opts.commitLimitAdd === undefined) return { ok: false, mutated: false, refusal: 'unavailable',
        detail: 'A limit cannot be recorded here yet. Nothing was prepared.' };
      const label = String(g.nodes.find(n => n.id === value.node_id)!.label).toLowerCase();
      const card = `Keep ${label} ${readUnitParts(value.unit)?.kind === 'percent' ? LIMIT_OPERATOR_WORDS[value.operator] : 'within'} ${limitFigure(value.raw_value, value.unit)}?`;
      const proposal = createProposal({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash, operations: [{ op: 'add_limit', path: value.node_id, value }],
        provenance: { authored_by: 'user_stated', basis: args.rationale }, validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: card });
      proposals.put(proposal);
      return { ok: true, mutated: false, proposal_id: proposal.proposal_id, public_label: card, base_revision: g.graph_hash,
        note: `Show exactly: ${card}${value.reserve === undefined ? '' : ` ${value.reserve.detail}`} Nothing has changed yet; call authorise_change only after approval.` };
    },

    /**
     * ⭐ SLICE C2 — A NEW FIGURE FOR A LIMIT THE MODEL ALREADY HOLDS (Canonical #70 5855234599). Paul's served test (27 Sep,
     * 08bf9a1f): "the budget rose to £30k" → "I can't update that budget constraint". The limit is named as the state
     * names it (its `on` label, `projectModelContext`) with its operator; it must be an EXISTING row on a node that is not
     * an option, a decision or the goal (the goal's target is `propose_goal_target`'s); the figure must be the user's own
     * (`figureTheUserWrote`, the lane's one matcher), in the row's own unit. ONE `prop_` proposal; the approval writes it
     * through the product's limit door.
     */
    async proposeLimitChange(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const value = args?.new_value;
      const operator = args?.operator;
      const asked = typeof args?.limit_label === 'string' ? args.limit_label.trim() : '';
      if (typeof value !== 'number' || !Number.isFinite(value) || (operator !== '<=' && operator !== '>=') || asked === '') {
        return { ok: false, mutated: false, refusal: 'unreadable_limit',
          detail: 'A limit change needs the limit as the model lists it, its operator, and the new figure. Nothing was prepared; ask the user for whichever is missing.' };
      }
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      // S4's crossing cue names the BAD region. Re-derive its complement here too, so the existing
      // change door keeps one row but never keeps an old strict stamp or treats "above" as a floor.
      const bound = readNewLimit(g.raw, ctx.user_turn_text ?? '', value, asked);
      const lossBound = bound !== null && readUnitParts(bound.unit)?.kind === 'percent' ? bound : null;
      // ⭐ A2 follow-up (DL verdict on #2180): the comparator the user STATED in this message, typed, when they stated one.
      // It must be in the limit's own direction (the held `operator` names the row); absent, the limit keeps its own.
      // ⛔ ONLY WHEN THE USER'S OWN WORDS SAY ONE (served 593362a, journey C run 3): for "we have £30,000 to spend" the
      // model sent ">=" against the at-most budget, and the change was refused twice — two turns for a figure given plainly.
      // With no comparator in THIS turn's typed words (`comparatorTheUserWrote`, the goal-target writer's own reader), the
      // model's is not the user's: the limit keeps its own. One the user wrote against the limit's direction still refuses.
      const statedArg: unknown = bound !== null ? bound.operator
        : comparatorTheUserWrote(ctx.user_turn_text) === null ? undefined : args?.stated_operator;
      const stated = statedArg === '<' || statedArg === '<=' || statedArg === '>' || statedArg === '>=' ? statedArg : undefined;
      if (statedArg !== undefined && statedArg !== null
        && (stated === undefined || (stated === '<' || stated === '<=' ? '<=' : '>=') !== operator)) {
        return { ok: false, mutated: false, refusal: 'unreadable_limit',
          detail: `The comparator given is not one this ${operator === '<=' ? 'upper' : 'lower'} limit can take, so nothing was prepared. `
            + 'Ask the user whether the limit is at most / less than (an upper limit) or at least / more than (a lower one).' };
      }
      const rows = (Array.isArray(g.raw.goal_constraints) ? g.raw.goal_constraints : [])
        .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object' && c['operator'] === operator);
      const res = resolveNamed(g, asked, (n) => n.kind !== 'option' && n.kind !== 'decision');
      if (res.kind === 'ambiguous') {
        return { ok: false, mutated: false, refusal: 'ambiguous_target', ambiguous_targets: [describeAmbiguity(g, asked, res.candidates)], detail: AMBIGUOUS_NOTE };
      }
      // The node the limit sits on; a row named only by its own label (its node absent from the model) is found by that label.
      const byRowLabel = rows.filter((c) => norm(c['label']) === norm(asked));
      const node = res.kind === 'one' ? res.node
        : byRowLabel.length === 1 ? g.nodes.find((n) => n.id === byRowLabel[0]!['node_id']) : undefined;
      if (node?.kind === 'goal') {
        return { ok: false, mutated: false, refusal: 'goal_target_not_a_limit',
          detail: `"${node.label}" is the goal: its target is set with propose_goal_target, not as a limit. Nothing was prepared.` };
      }
      if (node === undefined || node.kind === 'option' || node.kind === 'decision') {
        return { ok: false, mutated: false, refusal: 'no_such_limit',
          detail: `The model holds no ${operator === '<=' ? 'at most' : 'at least'} limit called "${asked}", so nothing was prepared. `
            + 'This changes only a limit the model already lists under limits. Tell the user plainly.' };
      }
      const matching = rows.filter((c) => c['node_id'] === node.id);
      if (matching.length !== 1) {
        return { ok: false, mutated: false, refusal: matching.length === 0 ? 'no_such_limit' : 'limit_ambiguous',
          detail: matching.length === 0
            ? `The model holds no ${operator === '<=' ? 'at most' : 'at least'} limit on "${node.label}", so nothing was prepared. This changes only a limit the model already lists under limits. Tell the user plainly.`
            : `More than one limit sits on "${node.label}", so nothing was prepared. Ask the user which one they mean.` };
      }
      const row = matching[0]!;
      // ⛔ R1 S4-core: a limit stated as a CHANGE from today (`change_rel` holds a fraction; `change_abs` a change, not a
      // level). This path writes a new LEVEL figure, so the user's "15%" would land as 15 in a fraction's place. Refused
      // by name until a change can be edited as a change; the door refuses it too (`limit-edit.ts`).
      if (isChangeFrame(row['value_frame'])) {
        return { ok: false, mutated: false, refusal: 'limit_is_a_change',
          detail: `The limit on "${node.label}" is stated as a change from today, and this path cannot yet change a limit stated that way, so nothing was prepared. `
            + 'Tell the user plainly, and never offer a new figure for it here.' };
      }
      const unit = typeof row['unit'] === 'string' && row['unit'] !== '' ? row['unit'] : null;
      // The complete typed reading travels through either door: figure, reserve choice and THIS message's words.
      const interpretation = bound?.node_id === node.id ? bound : null;
      // ⛔ A limit stored as a FRACTION of one (shown as a percent): the user's percent would be written 100× too large.
      // The door refuses it too (`limit-edit.ts`); saying so here means nothing is offered that cannot be approved.
      if (unit !== null && FRACTION_SPELLED_UNIT.test(unit)) {
        return { ok: false, mutated: false, refusal: 'limit_stored_as_fraction',
          detail: `The limit on "${node.label}" is stored as a fraction, and this path cannot yet change a limit stored that way, so nothing was prepared. `
            + 'Tell the user plainly that it can be changed on the canvas, and never offer to change it here.' };
      }
      const figureOf = (x: number): string => unit === null ? String(x)
        : readUnitParts(unit)?.kind === 'percent' ? limitFigure(x, unit) : targetFigure(x, unit);
      if (operator === '<=' && readUnitParts(unit)?.kind === 'percent' && lossBound === null
        && hasPercentageCrossing(ctx.user_turn_text ?? '')) {
        return { ok: false, mutated: false, refusal: 'limit_not_bound',
          detail: 'No inclusive ceiling was read from that percentage crossing. Nothing was prepared; if the loss threshold refers to more than one quantity, ask which one.' };
      }
      if (lossBound !== null && JSON.stringify(readUnitParts(lossBound.unit)) !== JSON.stringify(readUnitParts(unit))) {
        return { ok: false, mutated: false, refusal: 'limit_unit_mismatch',
          detail: 'The loss threshold and the held limit are in different units. Nothing was prepared; ask for the limit in its own units.' };
      }
      if (interpretation !== null && JSON.stringify(readUnitParts(interpretation.unit)) !== JSON.stringify(readUnitParts(unit))) {
        return { ok: false, mutated: false, refusal: 'limit_unit_mismatch',
          detail: 'The stated limit and the held limit are in different units. Nothing was prepared; ask for the limit in its own units.' };
      }
      // ⛔ A figure in another kind of unit is never this limit's (the lane's one family check).
      if (typeof args?.unit === 'string' && args.unit.trim() !== '' && unitsConflict(args.unit.trim(), unit ?? undefined) !== null) {
        return { ok: false, mutated: false, refusal: 'limit_unit_mismatch',
          detail: `The limit on "${node.label}" is in ${String(unit)}, and the figure given is a different kind of figure, so nothing was prepared. Ask the user for the limit in its own units.` };
      }
      // ⛔ Recorded as the user's own figure, so it must be one the user wrote, ABOUT this limit's quantity (DL #72
      // 5862394804): "300 Pro paying subscribers" is never a £300 limit on the price.
      if (interpretation === null && (!figureTheUserWrote(value, unit, ctx.user_text)
        || !figureTheUserWroteFor(value, unit, ctx.user_text, limitScopeIn(g, node.label)))) {
        return { ok: false, mutated: false, refusal: 'figure_not_stated',
          detail: `${figureOf(value)} is not a figure the user wrote, so nothing was prepared: it would be recorded as their limit. `
            + 'Ask them what the new limit is, in their own words, and never offer a figure of your own as theirs.' };
      }
      const before = typeof row['value'] === 'number' ? row['value'] : NaN;
      // A2: the limit as the user stated it NOW ("less than 4%", `statedOperatorOf`), and as it will be: the comparator
      // the user stated in this message, else its own (a new figure alone keeps it: `limit-edit.ts`).
      const nowOp = statedOperatorOf(row) ?? operator;
      const becomesOp = stated ?? nowOp;
      // S4's loss line does not authorise relaxing a tighter held limit. In this same level/unit,
      // the held endpoint meeting the inclusive loss ceiling makes its entire upper range safe,
      // including a strict held endpoint or an equal inclusive limit. Both proposal doors pass here.
      if (lossBound !== null && interpretation !== null && operator === lossBound.operator
        && meetsLimit(before, lossBound.operator, lossBound.raw_value) === true) {
        const label = typeof row['label'] === 'string' && row['label'].trim() !== '' ? row['label'] : node.label;
        // An equal inclusive limit is not tighter: it already sits on the line.
        const same = nowOp !== '<' && before === lossBound.raw_value;
        const reply = `Your limit already keeps ‘${label}’ ${nowOp === '<' ? 'under' : 'at or below'} ${figureOf(before)}, `
          + (same ? `the line where you'd lose money, so I've left it as is.`
            : `which is tighter than the ${limitFigure(lossBound.raw_value, lossBound.unit)} where you'd lose money, so I've left it as is.`);
        return { ok: false, mutated: false, refusal: 'limit_already_tighter', reply,
          detail: `Say exactly this one line, once, with no chip: ${reply}` };
      }
      if (before === value && becomesOp === nowOp) {
        return { ok: false, mutated: false, refusal: 'already_that_figure',
          detail: `The limit on "${node.label}" is already ${figureOf(value)}, so nothing needs to change. Tell the user so.` };
      }
      const now = `${LIMIT_OPERATOR_WORDS[nowOp]} ${figureOf(before)}`;
      const becomes = `${LIMIT_OPERATOR_WORDS[becomesOp]} ${figureOf(value)}`;
      /**
       * ⭐ B (3) (DL lease, 12 Oct): CURRENT MODEL STATE lists every `goal_constraints` row under `limits`, so a later edit
       * of one of the goal's targets (C's `role: 'goal_target'`) arrives here. The limit door writes it and keeps its role
       * (4c4f0e66); only the words were a limit's ("Change the limit on …"). A target row gets the target's card, note,
       * button and receipt; a limit is unchanged, byte for byte.
       */
      const isTarget = row['role'] === 'goal_target';
      const targetBecomes = `${DIRECTION_WORDS[becomesOp === '<' ? 'below' : becomesOp === '>' ? 'above' : becomesOp === '<=' ? 'at_most' : 'at_least']} ${figureOf(value)}`;
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations: [{ op: 'set_limit', path: node.id, value: { ...(interpretation ?? {}),
          operator, raw_value: value, unit, constraint_id: String(row['constraint_id'] ?? ''), before,
          ...(stated !== undefined ? { stated_operator: stated } : {}),
          ...(isTarget ? { role: 'goal_target' } : {}),
        } }],
        provenance: { authored_by: 'user_stated', basis: String(args.rationale ?? '') },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: isTarget ? `Set the target for "${node.label}" to ${targetBecomes}` : `Change the limit on "${node.label}" from ${now} to ${becomes}`,
      });
      proposals.put(proposal);
      if (isTarget) {
        return {
          ok: true, mutated: false,
          proposal_id: proposal.proposal_id,
          public_label: proposal.public_label,
          base_revision: g.graph_hash,
          target: { on: node.label, now, becomes },
          // AIE-B-multi-target-text-AMEND-0836 S6 (6120751692; 6121167535): consent is the card's own button, never a typed yes.
          note: `The target for ‘${node.label}’ is ready for review: ${targetBecomes}. Tell the user they can review it and press ‘Set this target’. `
            + 'Never show the id. Call authorise_change only for the approval bound to this card; a typed ‘yes’ alone is not that approval.'
            + (interpretation?.reserve === undefined ? '' : ` ${interpretation.reserve.detail}`),
        };
      }
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        limit: { on: node.label, now, becomes },
        note: `Nothing has changed yet. Tell the user it will change the limit on "${node.label}" from ${now} to ${becomes}, `
          + 'as their own figure, keeping its units — never the id — and call authorise_change with this proposal_id once they agree.'
          + (interpretation?.reserve === undefined ? '' : ` ${interpretation.reserve.detail}`),
      };
    },

    async reconcileGoalScope(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      return reconcileGoalScope({ readGraph, proposals, readPending: () => opts.readPendingActions ? opts.readPendingActions(ctx.scenario_id) : Promise.resolve([]) }, ctx, args);
    },
    async proposeGoalCurrentLevel(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const issues = await opts.readPendingActions?.(ctx.scenario_id) ?? [];
      if (issues.some(p => scopeIssueBlocks(p.action))) return { ok: false, mutated: false, refusal: 'goal_scope_unresolved', detail: 'Use reconcile_goal_scope to resolve the retained question before preparing the goal baseline. Nothing was prepared.' };
      return proposeGoalCurrentLevel({ readGraph, proposals }, ctx, args);
    },

    /**
     * Whether a search control quoting this query would reach the user: the route's read of the final egress gate's own
     * chip rule. The dispatcher refuses the offer when this throws (`dispatchTool`, fail closed).
     */
    ...(opts.researchControlShowable !== undefined ? {
      researchControlShowable: (ctx: AgentToolContext, query: string): Promise<boolean> => opts.researchControlShowable!(ctx.scenario_id, query),
    } : {}),
    /**
     * ⭐ C5 — THE AGENT'S PROVISIONAL VIEW (Paul, DL #70 5855324470). Read-only, and never a claim about the analysis:
     * it is accepted only while the current analysis WITHHOLDS its leader, and the route renders it after the leader
     * gate, labelled (`../provisional-view.ts`). When a leader may be named there is nothing provisional to add — the
     * analysis speaks, under its own permission.
     */
    async giveProvisionalView(ctx, args): Promise<ToolResult> {
      const checked = checkProvisionalView(args);
      if (!checked.ok) {
        return {
          ok: false, mutated: false, refusal: 'invalid_provisional_view', field: checked.field, problem: checked.problem,
          ...(checked.limit !== undefined ? { limit: checked.limit } : {}),
          detail: 'Nothing was shown. Say what to test or find out, never which option to do or explore first. The view is at most 2 sentences, the reasoning at most 3 and the confirming step ONE; '
            + `\`${checked.field}\` was ${checked.problem.replace(/_/g, ' ')}. Call give_provisional_view again with it fixed.`,
        };
      }
      let standing: LeaderStanding | null = null;
      try { standing = opts.readLeaderStanding === undefined ? null : await opts.readLeaderStanding(ctx.scenario_id); } catch { standing = null; }
      if (standing === null) {
        return {
          ok: false, mutated: false, refusal: 'standing_unreadable',
          detail: 'Olumi could not read whether the analysis may name an option, so no provisional view is shown. Do not give one in your reply text.',
        };
      }
      if (!standing.analysis_on_record) {
        return {
          ok: false, mutated: false, refusal: 'no_analysis',
          detail: 'No analysis of this model has completed, so there is nothing for a provisional view to stand beside. Nothing was '
            + 'shown. Say what the analysis still needs, or offer to run it.',
        };
      }
      if (!standing.withheld) {
        return {
          ok: false, mutated: false, refusal: 'not_withheld',
          detail: 'The current analysis may name a leading option, so there is nothing provisional to add. Nothing was shown: report '
            + 'what the analysis says, under its own permission.',
        };
      }
      return {
        ok: true, mutated: false, provisional_view: checked.view,
        detail: 'Include your provisional interpretation in the reply, labelled as your view of the current model rather than a computed result or a human fact. Preserve the supplied uncertainty, source and unresolved conditions. A provisional view directs investigation in this model. It may name and explain options and their unresolved assumptions only from current supplied facts; preserve scope, source, uncertainty and conditions, and do not favour an option or turn the view into a recommendation.',
      };
    },

    async runAnalysis(ctx, args, opts): Promise<ToolResult> {
      // The Agent never runs an analysis as part of an approval; the route's automatic Run after a committed change does.
      if (approvalAppliedThisRequest && opts?.afterCommittedChange !== true) {
        return {
          ok: false, mutated: false, ran: false, refusal: 'run_not_requested',
          detail:
            // #3038: a committed change is analysed automatically after the reply (when the model is ready).
            'The approved change is saved. When the model is ready, Olumi analyses it automatically after your ' +
            'reply; do not describe a result or ask the user to run one.',
        };
      }
      /**
       * The model asked again on the build turn itself: the first analysis of THIS revision already ran in
       * this request, so it is returned rather than run twice. Verified against a fresh read — if the
       * model moved since, this is a new analysis and it runs.
       */
      if (firstAnalysisThisRequest !== undefined) {
        const now = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph`, {}).catch(() => null);
        if (now !== null && now.status === 200 && now.json.graph_hash === firstAnalysisThisRequest.revisionHash) {
          return firstAnalysisThisRequest.result;
        }
      }
      const r = await dispatch('/orchestrate/v2/turn', {
        kind: 'message',
        // Deliberately NOT derived, unlike the authorised write above: asking
        // for the analysis twice is two operations the user actually made, and
        // collapsing them onto one identity would suppress the second.
        turn_id: randomUUID(),
        scenario_id: ctx.scenario_id,
        stage: 'analyse',
        turn_class: 'decide',
        source: 'chip_click',
        message: args.reason,
        chip: { id: AGENT_RUN_ANALYSIS_CHIP_ID, action_type: 'run_analysis',
          parameters: { effects_timing: args.effects_timing } },
      });
      /**
       * ⛔ A RUN THAT FAILED IS NOT A RUN THAT WAS REFUSED (served 319dde1, 01:42Z). The run turn answered 500
       * (the saved model could not be read), and the Agent explained it from the stale analysis state as "the saved
       * graph has changed" — a cause that was false. Olumi cannot know the reason from here, so the Agent is told
       * exactly what is true: it did not run, nothing changed, try again — and to give no other reason.
       */
      if (r.status !== 200) {
        onAnalysis?.({ scenario_id: ctx.scenario_id, status: r.status, blocks: [] });
        return {
          ok: false, mutated: false, ran: false, refusal: 'run_failed', http: r.status,
          detail: 'The analysis could not be run: something went wrong on Olumi\u2019s side while starting it, so nothing ran and nothing in the '
            + 'model changed. Tell the user exactly that and suggest trying again in a moment; do not give any other reason, and do not '
            + 'describe an earlier result as the current one.',
        };
      }
      const ready = (r.json.analysis_ready ?? {}) as Record<string, unknown>;
      const blocks = (r.json.blocks as { type: string }[] | undefined) ?? [];
      const result = blocks.find((b) => b.type === 'analysis_result');
      // The run turn's own run-over-run block rides with its result; the route shows it only beside this run.
      onAnalysis?.({ scenario_id: ctx.scenario_id, status: r.status, analysis_state: r.json.analysis_state, analysis_ready: r.json.analysis_ready, blocks,
        ...(r.json.run_delta !== undefined ? { run_delta: r.json.run_delta } : {}) });
      const permissions = claimPermissionsFrom(r.json.analysis_state, r.json.analysis_ready, { requested: true });
      // C46's existing read also supplies labels for a licensed range, even when a leader may be named.
      let graphForProduct: unknown;
      // C46 × R3-4: the carriers the run's engine evaluated, from the SAME graph read as the model.
      let evaluatedForProduct: ReadonlySet<string> | undefined;
      // ⛔ How each of the user's limits was checked, from the run's own per-limit rows on the same read (`limit-checks.ts`).
      let limitChecks: ReturnType<typeof limitChecksForAgent>;
      // The post-run graph read, when one was made (the goal-certainty rule reuses it).
      let postRunRead: GraphRead | null | undefined;
      if (result !== undefined && (permissions.leader_may_be_named !== true || goalChanceNeedsGraphLabels(result))) {
        try {
          const read = await readGraph(ctx.scenario_id);
          postRunRead = read;
          graphForProduct = read?.raw;
          evaluatedForProduct = read?.identity_evaluated;
          limitChecks = limitChecksForAgent(read?.raw, read?.limit_verdicts, read?.identity_evaluated,
            new Set((read?.run_option_set ?? runOptionSetForCopy(undefined, read?.option_participation, read?.raw)).leftOut
              .map(o => o.option_id)));
        } catch { postRunRead = null; graphForProduct = undefined; evaluatedForProduct = undefined; limitChecks = undefined; }
      }
      // ⛔ GOAL CERTAINTY (DL 5887593253; MG's producer #2270, stored per Run by #2280): an option at P(goal) exactly 0 or 1 is
      // said as a certainty only when THIS Run's own stored decision earns it — attributed by its run-fact identity.
      // One graph read (the one above when made); a Run that cannot be bound is said as unchecked (`goal-certainty-for-agent.ts`).
      let goalCertainty: Record<string, unknown> | undefined;
      if (hasGoalCertaintyCandidates(result)) {
        if (postRunRead === undefined) {
          try { postRunRead = await readGraph(ctx.scenario_id); } catch { postRunRead = null; }
        }
        // The Run is the one THIS turn returned: its own state carries the stamp the read must match.
        goalCertainty = goalCertaintyForAgent(result, { scenario_id: ctx.scenario_id, analysis_state: r.json.analysis_state }, postRunRead);
      }
      // The confirm card reads the stored model: the post-run read when one was made; a Run whose goal chance #416 withheld
      // (no certainty to check, so no read yet) reads once, because there the card is the way to a figure. No extra read otherwise.
      if (result !== undefined && postRunRead === undefined && withGoalChance(result).goal_chance !== undefined) {
        try { postRunRead = await readGraph(ctx.scenario_id); } catch { postRunRead = null; }
      }
      // History can regard this result as current only when the selected fact matches this Run's full identity.
      // A second Run of the same graph may have the same headline figures and a different computed_at.
      const runHash = (result as { computed_against_hash?: unknown } | undefined)?.computed_against_hash;
      const runAt = (r.json.analysis_state as { run_state?: { computed_at?: unknown } } | undefined)?.run_state?.computed_at;
      const runIdentity = typeof runHash === 'string' && typeof runAt === 'string'
        ? { scenario_id: ctx.scenario_id, graph_hash_at_run: runHash, computed_at: runAt } : undefined;
      // ⛔ A Run with no result says the ENGINE's typed outcome, never a readiness issue it did not stop on (`run-outcome.ts`).
      const runOutcome = result === undefined ? runOutcomeOf(r.json) : undefined;
      // The level a waiting reading's part lacks is asked here too (B1 828d87ac): its card is not offered until it has one.
      const identityAskSay = result !== undefined && postRunRead ? identityAskLineFor(result, postRunRead.raw) ?? identityLevelAskFor(postRunRead.raw, postRunRead.brief_text) : null;
      const identityCard = result !== undefined ? identityCardFor(ctx, postRunRead) : undefined;
      // ⭐ COACH ON THE NEW RESULT, AGAINST THE PRECEDING RUN (Paul #94 6166259456; DL 14 Oct). When the post-run read selected
      // THIS Run (its run-fact identity: scenario, graph hash, computed_at) and holds a preceding Run's delta, the model gets the
      // SAME comparison facts the state read gives (`runComparisonFacts`) with this Run's output, and is told to coach and
      // compare (`RUN_COMPARISON_NOTE`). The model writes it; no host prose. A first Run, or a read of another Run, adds nothing.
      let runComparison: Record<string, unknown> | undefined;
      // Only a Run whose own response carries a run-over-run delta has a preceding Run, so no other Run spends a read on it.
      if (result !== undefined && runIdentity !== undefined && r.json.run_delta !== undefined) {
        if (postRunRead === undefined) {
          try { postRunRead = await readGraph(ctx.scenario_id); } catch { postRunRead = null; }
        }
        const readRun = postRunRead === null || postRunRead === undefined ? undefined : {
          scenario_id: ctx.scenario_id,
          graph_hash_at_run: (postRunRead.analysis_result as { computed_against_hash?: unknown } | undefined)?.computed_against_hash,
          computed_at: (postRunRead.analysis_state as { run_state?: { computed_at?: unknown } } | undefined)?.run_state?.computed_at,
        };
        if (postRunRead && postRunRead.run_delta !== undefined
          && compareAnalysisRunFactIdentity(runIdentity, readRun).status === 'match') {
          const { delta, rerunRecord } = await runComparisonFacts(ctx.scenario_id, ctx.request_id, postRunRead);
          if (delta !== undefined || rerunRecord !== undefined) {
            runComparison = { ...(delta !== undefined ? { run_delta: delta } : {}), ...(rerunRecord !== undefined ? { rerun_record: rerunRecord } : {}),
              note: RUN_COMPARISON_NOTE };
          }
        }
      }
      return {
        ok: r.status === 200,
        mutated: false,
        ran: result !== undefined,
        status: ready.status ?? 'unknown',
        // Olumi's own words about what is missing. Not re-worded here.
        what_is_missing: String(r.json.assistant_text ?? ''),
        ...(runOutcome !== undefined ? {
          run_outcome: runOutcome,
          run_outcome_note: 'The analysis did not produce a result, and what_is_missing is the reason, in Olumi\u2019s own words. '
            + 'Tell the user exactly that. Never give another reason, and never name anything from the model\u2019s readiness as why it did not run.',
        } : {}),
        blockers: ready.blockers ?? [],
        options: ready.options ?? [],
        // ⛔ The Agent reads decision sensitivity from EVPPI only, never PLoT's structural ranking (`../decision-sensitivity.ts`).
        ...(result !== undefined ? { result: analysisResultForAgent(result, graphForProduct ?? postRunRead?.raw,
          (r.json.analysis_state as { run_state?: { kind?: string } } | undefined)?.run_state?.kind === 'complete_current'
            && (postRunRead === undefined || (postRunRead !== null
              && (postRunRead.analysis_state as { run_state?: { kind?: string } } | undefined)?.run_state?.kind === 'complete_current'))) } : {}),
        ...(runIdentity !== undefined ? { run_identity: runIdentity } : {}),
        // The typed leader permission for THIS run, read from its own wire verdict — so the Agent names a
        // leader only when `leader_may_be_named` (see the route's reporting instruction). `requested`: every
        // run_analysis dispatch is one the user asked for (the Agent's own call, or the Run chip's fast path);
        // the automatic first analysis reads its permission in `describeFirstAnalysisForAgent`, not here.
        claim_permissions: graphForProduct === undefined ? permissions : withNonlinearIdentity(permissions, graphForProduct, evaluatedForProduct),
        ...(limitChecks !== undefined ? { limit_checks: { limits: limitChecks, note: LIMIT_CHECKS_NOTE } } : {}),
        // ⛔ PLoT #416: the goal's chance withheld on every option — the sentence to say and the rule (`../goal-chance-withheld.ts`).
        ...withGoalChance(result, graphForProduct ?? postRunRead?.raw, identityAskSay === null && identityCard === undefined),
        // ⭐ MC D1 (c): #416's ONE ask, from the graph this Run analysed (the read above), said after its reason by the route.
        ...(identityAskSay !== null ? { identity_ask_say: identityAskSay } : {}),
        ...(goalCertainty !== undefined ? { goal_certainty: goalCertainty } : {}),
        // ⭐ The confirm card (`../identity-card.ts`), read from the same post-run read; a Run that made none offers none.
        ...withIdentityCard(identityCard),
        ...(runComparison !== undefined ? { run_comparison: runComparison } : {}),
      };
    },
  };
  return {
    ...caps,
    /** Route-only authorship entry: no model argument can select the stored-brief source. */
    async deadlineCardFromDraft(ctx, input) {
      if (readOnly || input.start === undefined || moreThanOneAnswerSinceDraft(input.start)) return undefined;
      try {
        const g = await readGraph(ctx.scenario_id);
        if (!g || !firstAgentTurnAfterDraft(input.start, ctx.scenario_id, g.brief_text ?? '')) return undefined;
        // AIE MA3: a goal measured over the window from launch has no deadline of its own; a launch date opens that window
        // (`proposeGoalDeadline`'s `launch_opens_window`), so no card ever places one as the goal's deadline.
        const goalsHeld = g.nodes.filter((n) => n.kind === 'goal');
        if (goalsHeld.length === 1 && launchWindowOf(goalsHeld[0]) !== undefined) return undefined;
        // The turn that built the draft already offered a deadline card (a committed set_goal_deadline proposal), or its offers are unknown.
        if (await buildTurnAlreadyOfferedDeadline(input.start, ctx.scenario_id, g.brief_text ?? '')) return undefined;
        const draft = g.brief_text ? await findConstructionVersion(dispatch, ctx.scenario_id, g.brief_text) : null;
        // The ONE resolver (`draft-reference.ts`), shared with the model-facing door: a guest has no version, so the scenario's server stamp.
        const reference = draftReferenceDate({ versionCreatedAt: draft?.created_at, scenarioCreatedAt: g.scenario_created_at });
        if (reference === undefined) return undefined;
        const card = deadlineCardToIssue({ ...input, graph: g.raw, storedBrief: g.brief_text, reference, priorOffer: false });
        return card === undefined ? undefined : { words: card.words,
          // A throw in the shared tail never takes the turn down: the same refusal the door already says.
          issue: async (subject, args) => {
            // Ruling A (DL 14 Oct): the words are the user's, quoted with their sentence; that they are THIS goal's deadline is the
            // drafter's reading, so every route card is Olumi's interpretation to check (approval stays approval, never authorship).
            try { return await proposePlacedDeadline(subject, args, g, card.words, card.reference, undefined, true, false, card.quote); } catch {
              return { ok: false, mutated: false, refusal: 'deadline_not_placed', detail: deadlineRefusalDetail.horizon_not_modelled };
            }
          } };
      } catch { return undefined; }
    },
    // The approval guard's writer: every return path of `authoriseChange`, one place.
    async authoriseChange(ctx, args): Promise<ToolResult> {
      // Run existing validation and card-specific refusals unchanged. The inner writer's
      // consent fence refuses an otherwise executable ordinary proposal before any write.
      if (opts.turnAuthority === true && ctx.typed_approval_of !== args.proposal_id) {
        return caps.authoriseChange(ctx, args);
      }
      if (opts.turnAuthority === true && !ctx.turn_id) {
        return { ok: false, mutated: false, refusal: 'turn_identity_required' };
      }
      const p = proposals.get(args.proposal_id);
      if (opts.turnAuthority === true && p !== undefined) {
        if (p.scenario_id !== ctx.scenario_id || p.user_id !== ctx.authenticated_user_id) {
          return { ok: false, mutated: false, refusal: 'not_authorised' };
        }
        if (computeProposalId(p) !== p.proposal_id) {
          return { ok: false, mutated: false, refusal: 'integrity_failed' };
        }
      }
      const reconcile = async (): Promise<ToolResult> => {
        // Only this cut's single structural-link write has a complete one-receipt identity.
        // Other operation families may have several commits: a partial receipt must never imply whole approval.
        if (p?.operations.length === 1 && p.operations[0].op === 'add_edge'
          && (p.operations[0].value as { author?: unknown } | undefined)?.author !== 'model_proposed') {
          const operationId = authorisationTurnId(p.proposal_id);
          let cursor: string | undefined;
          try {
            for (let page = 0; page < 5; page += 1) {
              const found = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/versions`, { limit: 200,
                ...(cursor !== undefined ? { cursor } : {}) });
              if (found.status !== 200 || !Array.isArray(found.json.versions)) break;
              const hit = found.json.versions.find((v: { creation?: { source_turn_id?: unknown; kind?: unknown; mutation_id?: unknown } }) =>
                v.creation?.source_turn_id === operationId && v.creation?.kind === 'committed_mutation');
              if (hit !== undefined && typeof hit.version_id === 'string' && hit.version_id.length > 0
                && Number.isInteger(hit.sequence) && hit.sequence > 0
                && typeof hit.creation.mutation_id === 'string' && hit.creation.mutation_id.length > 0) {
                const receipts = [{ version: hit.sequence, version_id: hit.version_id,
                  mutation_id: hit.creation.mutation_id, source_turn_id: operationId }];
                proposals.markApplied(p.proposal_id, receipts);
                return { ok: true, mutated: false, applied: true, already_applied: true,
                  proposal_id: p.proposal_id, operation_id: operationId, receipts };
              }
              cursor = typeof found.json.next_cursor === 'string' ? found.json.next_cursor : undefined;
              if (cursor === undefined) break;
            }
          } catch { /* an unavailable receipt reader is an unknown outcome */ }
        }
        return { ok: false, mutated: false, refusal: 'not_confirmed', outcome: 'outcome_unknown', proposal_id: args.proposal_id };
      };
      const execute = () => caps.authoriseChange(ctx, args);
      const r = opts.turnAuthority === true && p !== undefined
        ? await proposals.executeApproved(p, ctx.turn_id ?? ctx.request_id, execute,
            result => result.applied === true && proposals.isApplied(p.proposal_id) ? 'applied'
              // A refusal that provably wrote nothing (mutated:false, and not the "could not confirm" outcome) is released.
              : result.mutated === false && result.refusal !== 'not_confirmed' && result.outcome !== 'outcome_unknown' ? 'none' : 'unknown',
            reconcile)
        : await execute();
      if (r.applied === true || r.mutated === true) {
        approvalAppliedThisRequest = true;
        // ⭐ (B) WHAT THE MODEL NEEDS NOW, from the graph as stored after the write — one place for every
        // apply path (the in-turn tool and the typed-approve fast path). A failed read says "not checked".
        let after: GraphRead | null = null;
        try { after = await readGraph(ctx.scenario_id); } catch { after = null; }
        // A result that set its own readiness keeps it (an unconfirmed save says "not checked", never the stored graph's `may_run`).
        return { ...r, readiness_after: 'readiness_after' in r ? r.readiness_after : readinessViewOf(after?.raw), ...nextStepFactOf(after) };
      }
      return r;
    },
  };
}
