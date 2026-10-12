/**
 * ⭐ THE AGENT ROUTE'S RUN EVIDENCE (the win-share class, `compose/run-share-text.ts`). Two readers, each of ONE typed fact:
 *   · the final exit reads THIS turn's own results: the first analysis ran, the typed Run ran, or the Agent's own run_analysis
 *     call ran (`ran: true` on its result). There is no provider-call input: a model call is never evidence that a Run ran
 *     (the f5689c76 check's blocking finding). Explaining the CURRENT Run is a result surface for removal only;
 *   · the replay exit reads the STORED ROW it replays, never today's turn: the row proves a Run reply by carrying Olumi's own
 *     fixed Run line, and an explanation by its request being the Run-explanation press whose Run is still the current one.
 *     A row with neither (every row written before this rule, unless it proves one) is a reasoning reply and ships unfiltered.
 */
import { REASONING_REPLY, type ReplyRunEvidence } from '../compose/run-share-text.js';
import { RUN_RESULT_READY_TEXT } from './run-explanation.js';

export interface AgentTurnRunFacts {
  readonly fastPath: string | undefined;
  /** The first analysis of this turn's construction RAN (`firstAnalysis.outcome.ran === true`). */
  readonly firstAnalysisRan: boolean;
  readonly toolCalls: readonly { readonly name: string }[];
  readonly toolResults: readonly unknown[];
  /** This turn is the Explain press on a Run that is still current (`fastPath === 'explain'`, narration not stale). */
  readonly explainsCurrentRun: boolean;
}

const ranAt = (results: readonly unknown[], i: number): boolean => (results[i] as { ran?: unknown } | undefined)?.ran === true;

/** The final exit's evidence: from this turn's own results only. */
export function agentReplyRunEvidence(turn: AgentTurnRunFacts): ReplyRunEvidence {
  const ran = turn.firstAnalysisRan
    || (turn.fastPath === 'run' && ranAt(turn.toolResults, 0))
    || turn.toolCalls.some((c, i) => c.name === 'run_analysis' && ranAt(turn.toolResults, i));
  if (ran) return { surface: 'run_result', basis: 'ran_this_turn' };
  if (turn.explainsCurrentRun) return { surface: 'run_explanation', basis: 'explains_current_run' };
  return REASONING_REPLY;
}

/** The replay exit's evidence: from the stored row it replays (`storedText` is that row's `assistant_message`). */
export function replayedRowRunEvidence(row: { readonly storedText: string | null; readonly explainsCurrentRun: boolean }): ReplyRunEvidence {
  if (typeof row.storedText === 'string' && row.storedText.includes(RUN_RESULT_READY_TEXT)) {
    return { surface: 'run_result', basis: 'replayed_row_ran' };
  }
  if (row.explainsCurrentRun) return { surface: 'run_explanation', basis: 'replayed_row_explained' };
  return REASONING_REPLY;
}
