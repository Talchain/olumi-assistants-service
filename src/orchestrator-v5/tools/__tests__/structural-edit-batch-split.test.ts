/**
 * ROADMAP 2.624 — THE PATCH-BUDGET ENFORCER CAN SAY NO, AND NAMES THE NODE CAP.
 *
 * ⚠ 21 Oct 2026 — the structural-edit batch splitter
 * (`structural-edit-batch-split.ts`) and the composer that called it were
 * retired with the coach's structural-edit tool (superseded by the core
 * `propose_change`). Every row about partitioning went with them. The one row
 * that asserted only the LIVE enforcer — `checkPatchBudget`, the function
 * `handleEditGraph` calls — is kept: it is the only place `breachedLimit: 'node'`
 * is pinned. The enforcer's other breaches are pinned in
 * `tests/unit/orchestrator/patch-budget.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { MAX_NODE_OPS } from '../../../orchestrator/tools/patch-budget-limits.js';
import { checkPatchBudget } from '../../../orchestrator/tools/edit-graph.js';

describe('the patch-budget enforcer (2.624)', () => {
  it('⭐ the enforcer really can say NO to a node-heavy batch, and names the node cap', () => {
    const overByOne = Array.from({ length: MAX_NODE_OPS + 1 }, (_, i) => ({
      op: 'add_node',
      path: `f-control-${i}`,
      value: { kind: 'factor', label: `Control ${i}` },
    }));
    const budget = checkPatchBudget(overByOne as unknown as Parameters<typeof checkPatchBudget>[0]);
    expect(budget.allowed).toBe(false);
    expect(budget.breachedLimit).toBe('node');
  });
});
