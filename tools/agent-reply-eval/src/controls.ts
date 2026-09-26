/**
 * The controls a reply might tell the user to press, and whether THIS response showed them.
 *
 * DERIVED where the product exports them: the approve/amend chip labels come from
 * `approvalChipsFor` itself (one call per proposer tool), so a renamed chip moves
 * this list with it. The three route-owned chips live in `src/routes/agent-v1-turn.ts`
 * as module constants; importing that route would pull the whole service graph into
 * a scorer, so their labels are listed here and `__tests__/controls-drift.test.ts`
 * reads the route source and fails if any of them stops being defined there.
 */
import { AMEND_CHIP, approvalChipsFor } from '../../../src/orchestrator-v5/agent-lane/approval-chips.js';

const PROPOSER_TOOLS = [
  'propose_starting_point',
  'propose_assumptions',
  'propose_option_interventions',
  'propose_model_change',
  'propose_new_option',
] as const;

/** Route-owned chip labels (agent-v1-turn.ts: NEXT_STEP_AFTER_BLOCKED_RUN_CHIP, REBUILD_AFTER_TOO_LARGE_CHIP, RUN_OFFER_CHIP). */
export const ROUTE_CHIP_LABELS = ['Suggest what it still needs', 'Build it again', 'Run analysis'] as const;

export function knownChipLabels(): string[] {
  const approve = PROPOSER_TOOLS.flatMap((name) =>
    approvalChipsFor([{ name, ok: true, mutated: false, proposal_id: 'prop_000000' }]).map((c) => c.label),
  );
  return [...new Set([...approve, AMEND_CHIP.label, ...ROUTE_CHIP_LABELS])];
}

/**
 * The Run control also exists OUTSIDE the chips (the UI's outputs dock). Whether it
 * was visible and enabled when a reply mentioned it is not in any capture, so a
 * reference to it with no Run chip shown is NOT_DECIDABLE, never PASS or FAIL.
 */
export const PERSISTENT_RUN_CONTROL = /^(?:re-?run|run)(?: (?:the )?analysis)?$/i;
