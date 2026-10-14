/**
 * THE ONE TRANSLATION EDGE between the canonical turn stage (`Stage` /
 * `StageType`, `@talchain/schemas/boundary`: frame | analyse | decide | review)
 * and the DSK bundle's `DecisionStage` (`./types.ts`).
 *
 * Moved verbatim from `orchestrator-v5/handlers/edit-graph-dispatch.ts`, which
 * still calls it, so a pure consumer (the agent-lane science context,
 * `orchestrator-v5/agent-lane/science/method-science-context.ts`) can read the
 * edge without importing a 5,900-line handler. It is still exactly ONE edge:
 * `stage-vocabulary-convergence.test.ts` pins this file as the only translator.
 *
 * Unmapped values fall back to 'frame'. That is safe for edit_graph, a
 * structural operation that doesn't branch on stage. A consumer that must not
 * guess (a DSK citation) passes only a canonical stage it actually read, and
 * passes nothing when it read none.
 */
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import type { DecisionStage } from './types.js';

export function mapStageToDecisionStage(stage: MessageTurnPayload['stage']): DecisionStage {
  switch (stage) {
    case 'frame':
      return 'frame';
    case 'analyse':
      return 'evaluate';
    case 'decide':
      return 'decide';
    case 'review':
      return 'optimise';
    default:
      return 'frame';
  }
}
