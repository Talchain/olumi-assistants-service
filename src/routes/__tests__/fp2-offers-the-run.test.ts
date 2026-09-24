/**
 * ⭐ FP2 REMOVED THE IMPLICIT ANALYSIS — SO SOMETHING MUST OFFER THE EXPLICIT ONE.
 *
 * ⛔ THE DEFECT, read from served code at `3f412be1`, not inferred:
 * `approvalChipsFor` (`approval-chips.ts:18`) opens with
 *   `if (toolCalls.some((c) => c.name === 'authorise_change')) return []`
 * and FP2's deterministic approval calls exactly that. So after an approval the
 * OpenAI route emitted ZERO suggested actions — not a missing Run chip, none at all.
 * The user approves their values, FP2 rightly declines to run an analysis nobody
 * asked for, and then nothing tells them they can.
 *
 * ⚠ #1739 does NOT reach this path: it fixes the post-apply chip builders in
 * `turn-executor.ts`, and FP2 composes its own response. RC said so directly.
 */

import { describe, it, expect } from 'vitest';
import { approvalChipsFor } from '../../orchestrator-v5/agent-lane/approval-chips.js';
import { isRunAffordanceAdmitted } from '../../orchestrator-v5/admission/run-affordance-gate.js';

describe('the gap this closes, pinned at its source', () => {
  it('⛔ approvalChipsFor returns NOTHING once a change was authorised — the dead end', () => {
    const chips = approvalChipsFor([
      { name: 'authorise_change', ok: true, proposal_id: 'p1' },
    ]);
    expect(chips).toEqual([]);
  });

  it('CONTROL: before authorisation it DOES offer the approve chip — so the emptiness is specific', () => {
    const chips = approvalChipsFor([
      { name: 'propose_starting_point', ok: true, proposal_id: 'p1' },
    ]);
    expect(chips.map((c) => c.id)).toEqual(['agent-approve-proposal', 'agent-amend-proposal']);
  });
});

describe('the admission gate the Run offer is bound to', () => {
  it('⭐ admits an admissible-but-not-ready model — the 20.77% case', () => {
    expect(isRunAffordanceAdmitted({ status: 'needs_user_mapping', may_run: true } as never)).toBe(true);
  });

  it('⭐ admits a ready model even when may_run is false — the UI renders it, so CEE must', () => {
    expect(isRunAffordanceAdmitted({ status: 'ready', may_run: false } as never)).toBe(true);
  });

  it('⛔ WITHHOLDS when neither term admits — never offer a Run CEE would refuse', () => {
    expect(isRunAffordanceAdmitted({ status: 'needs_user_input', may_run: false } as never)).toBe(false);
  });

  it('⛔ absence is not consent: no readiness at all is never an invitation', () => {
    expect(isRunAffordanceAdmitted(undefined as never)).toBe(false);
  });
});
