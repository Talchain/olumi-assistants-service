/**
 * ⭐ COACH, FOLDED INTO BYPASS1 (DL, 14 Oct; recovery/codex/BYPASS1.md): the ONE typed blocker for this read, handed to the AI
 * as a FACT (`next_step_blocker` in CURRENT MODEL STATE). The AIE's Q4 instruction tells the AI to end its reply with that
 * step, in its own words. Not a composer: no host line is written from it.
 *
 * Each producer types its own case from its own facts (`press-next-step.ts`); `oneNextStep` picks the ONE. A cause no
 * producer can type yields nothing. Not yet typed here: the unread rate × count goal (its reading card is the AI's own
 * `propose_identity` step, and its writable-card unlock is `actions/state.ts`'s to share).
 */
import { targetBlockerOf, targetTestabilityOf, untestableTargetParts, type TargetTestability } from '../admission/target-testability.js';
import { goalChanceLicenceForAgent } from '../goal-target/goal-chance-licence.js';
import { chanceGoalBlockerOf, draftedTeamPartOf, eventByDateRefusalOf } from '../goal-target/event-by-date-model.js';
import { launchWindowOf } from '../goal-target/goal-target-basis.js';
import { jointBlockerOf, olumiBaseTargetsOf } from '../goal-target/goal-targets-joint.js';
import { goalTargetMissingBlockerOf, isChanceGoalModel } from './decision-input-ask.js';
import { oneNextStep, type PressBlocker } from './press-next-step.js';
import { riskOccurrenceSubject } from './risk-occurrence.js';
import { staleBlockerOf, staleOnlyByRangeReading } from './write-outcome.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export interface NextStepRead {
  readonly raw: unknown;
  readonly analysis_state: unknown;
  readonly analysis_ready?: unknown;
  readonly analysis_result?: unknown;
}

/**
 * ⭐ THE RUN ITSELF IS WITHHELD FOR A MISSING FIGURE (DL 14 Oct; served marketing e2e 0dac5dcc: the Run stayed disabled on the
 * unvalued risk "Limited marketing experience" while later replies asked "What's today's level of conversion rate?" or offered
 * "Suggest options"). Readiness's own blocker owns the step, in readiness's own words, ahead of every later-stage ask: no
 * other answer lets the Run start. Where Olumi's starting-assumption card can exist for it (#3013, `riskOccurrenceSubject`
 * eligible), the proposing tool is named, so one approval admits the Run.
 */
export function runWithheldBlockerOf(raw: unknown, analysisReady: unknown): PressBlocker | null {
  if (!isRec(analysisReady) || analysisReady.status !== 'needs_user_input' || !Array.isArray(analysisReady.blockers)) return null;
  const gap = analysisReady.blockers.filter(isRec).find((b) => b.blocker_type === 'missing_value'
    && typeof b.factor_id === 'string' && typeof b.message === 'string' && b.message.trim() !== '');
  if (gap === undefined) return null;
  const card = riskOccurrenceSubject(raw, gap.factor_id as string);
  if (card.kind === 'eligible') return { kind: 'missing_input', ask: gap.message as string,
    proposable_by: { tool: 'propose_assumptions', node_id: gap.factor_id as string, field: 'occurrence_range', window_months: card.window_months } };
  // ⭐ S2 (DL 14 Oct; SCIENCE's marketing capture; PL 18:41Z): a FACTOR with no level can take Olumi's own labelled starting
  // estimate (press-only), with the user's words about it quoted on the card, so the step is that card, never the question
  // again. The event model's team part is excluded: its level comes only from the team's time (`propose_team_time`).
  const node = isRec(raw) && Array.isArray(raw.nodes) ? raw.nodes.filter(isRec).find((n) => n.id === gap.factor_id) : undefined;
  const factorGap = node?.kind === 'factor' && draftedTeamPartOf(raw)?.team.id !== gap.factor_id;
  return { kind: 'missing_input', ask: gap.message as string,
    ...(factorGap ? { proposable_by: { tool: 'propose_assumptions', node_id: gap.factor_id as string, field: 'starting_value' } } : {}) };
}

/**
 * ⭐ RE-RULED (DL-3, 19 Oct; PROMPT-INT underdefined-coaching trace, 3 of 8 drafts on 390a1dbe, served B2 on cae490f4): the
 * target lacks the goal's OWN level today (P1 (a)). "Down by a third from today" has no figure without it, as a goal with no
 * target has none, so its ask leads the Run's missing figure (which #3088 ranked ahead of every later-stage ask). A goal
 * counted from launch has no level today (`launchWindowOf`): its (a) is a forecast or cohort question and keeps #3088's order.
 */
function goalLevelTodayMissing(raw: unknown, verdict: TargetTestability): boolean {
  if (verdict.kind !== 'not_testable' || !verdict.failures.some((f) => f.code === 'missing_goal_baseline')) return false;
  const goal = isRec(raw) && Array.isArray(raw.nodes) ? raw.nodes.find((n) => isRec(n) && n.id === verdict.goal_id) : undefined;
  return launchWindowOf(goal) === undefined;
}

export function nextStepBlockerForAgent(read: NextStepRead): PressBlocker | null {
  const result = isRec(read.analysis_result) ? read.analysis_result : undefined;
  const current = isRec(read.analysis_state) && isRec(read.analysis_state.run_state)
    && read.analysis_state.run_state.kind === 'complete_current';
  // THIS Run's identity evaluations, as every target reader takes them (`goal-chance-range.ts`, `run-analysis.ts`).
  const evaluations = Array.isArray(result?.identity_evaluations) ? result.identity_evaluations : undefined;
  // A goal met by an event by a date has no level target: its step is the event's own (`chanceGoalBlockerOf`), never
  // "today's level" of its share (Paul's hiring test: no "% today" question on any surface).
  const verdict = targetTestabilityOf(read.raw, evaluations);
  const parts = isChanceGoalModel(read.raw) ? null : untestableTargetParts(read.raw, verdict);
  const target = parts === null ? null : targetBlockerOf(parts);
  // The joint is the selected CURRENT Run's own record; a stale Run's is said by the stale step.
  const targets = current ? goalChanceLicenceForAgent(read.analysis_result)?.targets : undefined;
  const joint = targets?.joint.status === 'withheld' ? targets.joint : undefined;
  const named = (targets?.conditions ?? []).filter((c) => c.role === 'target');
  // ⭐ A3 D1 (DL-3 ruling 3; Codex #3407 r1): a saved model whose event is held (`event_goal_unadmitted`, the hold the build
  // registers and the Run's admission reads) has ONE step, the event's missing piece: the release is what meets its goal.
  const eventHold = eventByDateRefusalOf(read.raw);
  return oneNextStep([
    eventHold !== null ? { kind: 'missing_input', ask: eventHold } : goalTargetMissingBlockerOf(read.raw),
    goalLevelTodayMissing(read.raw, verdict) ? target : null,
    // Ahead of every later-stage ask (the first producer of a kind wins): only this figure lets the Run start.
    runWithheldBlockerOf(read.raw, read.analysis_ready),
    staleBlockerOf(read.analysis_state, read.analysis_ready, staleOnlyByRangeReading(read.raw, read.analysis_result)),
    target,
    joint === undefined ? null : jointBlockerOf(Math.max(named.length + (targets?.unsupported_targets?.length ?? 0), 2),
      joint.reason, targets?.unsupported_targets ?? [], olumiBaseTargetsOf(read.raw, named)),
    chanceGoalBlockerOf(read.raw),
  ]);
}
