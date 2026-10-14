/**
 * ⭐ COACH, FOLDED INTO BYPASS1 (DL, 14 Oct; recovery/codex/BYPASS1.md): the ONE typed blocker for this read, handed to the AI
 * as a FACT (`next_step_blocker` in CURRENT MODEL STATE). The AIE's Q4 instruction tells the AI to end its reply with that
 * step, in its own words. Not a composer: no host line is written from it.
 *
 * Each producer types its own case from its own facts (`press-next-step.ts`); `oneNextStep` picks the ONE. A cause no
 * producer can type yields nothing. Not yet typed here: the unread rate × count goal (its reading card is the AI's own
 * `propose_identity` step, and its writable-card unlock is `actions/state.ts`'s to share).
 */
import { targetBlockerOf, targetTestabilityOf, untestableTargetParts } from '../admission/target-testability.js';
import { goalChanceLicenceForAgent } from '../goal-target/goal-chance-licence.js';
import { chanceGoalBlockerOf } from '../goal-target/event-by-date-model.js';
import { jointBlockerOf, olumiBaseTargetsOf } from '../goal-target/goal-targets-joint.js';
import { goalTargetMissingBlockerOf, isChanceGoalModel } from './decision-input-ask.js';
import { oneNextStep, type PressBlocker } from './press-next-step.js';
import { staleBlockerOf } from './write-outcome.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export interface NextStepRead {
  readonly raw: unknown;
  readonly analysis_state: unknown;
  readonly analysis_ready?: unknown;
  readonly analysis_result?: unknown;
}

export function nextStepBlockerForAgent(read: NextStepRead): PressBlocker | null {
  const result = isRec(read.analysis_result) ? read.analysis_result : undefined;
  const current = isRec(read.analysis_state) && isRec(read.analysis_state.run_state)
    && read.analysis_state.run_state.kind === 'complete_current';
  // THIS Run's identity evaluations, as every target reader takes them (`goal-chance-range.ts`, `run-analysis.ts`).
  const evaluations = Array.isArray(result?.identity_evaluations) ? result.identity_evaluations : undefined;
  // A goal met by an event by a date has no level target: its step is the event's own (`chanceGoalBlockerOf`), never
  // "today's level" of its share (Paul's hiring test: no "% today" question on any surface).
  const parts = isChanceGoalModel(read.raw) ? null : untestableTargetParts(read.raw, targetTestabilityOf(read.raw, evaluations));
  // The joint is the selected CURRENT Run's own record; a stale Run's is said by the stale step.
  const targets = current ? goalChanceLicenceForAgent(read.analysis_result)?.targets : undefined;
  const joint = targets?.joint.status === 'withheld' ? targets.joint : undefined;
  const named = (targets?.conditions ?? []).filter((c) => c.role === 'target');
  return oneNextStep([
    goalTargetMissingBlockerOf(read.raw),
    staleBlockerOf(read.analysis_state, read.analysis_ready),
    parts === null ? null : targetBlockerOf(parts),
    joint === undefined ? null : jointBlockerOf(Math.max(named.length + (targets?.unsupported_targets?.length ?? 0), 2),
      joint.reason, targets?.unsupported_targets ?? [], olumiBaseTargetsOf(read.raw, named)),
    chanceGoalBlockerOf(read.raw),
  ]);
}
