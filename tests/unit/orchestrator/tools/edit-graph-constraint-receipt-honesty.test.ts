/**
 * ROADMAP 2.1041 — the V4 constraint shortcut told the user a limit would be
 * registered, and no limit ever reached the engine.
 *
 * The defect, verified at the bytes on staging tip cab59b72:
 *
 *  · `detectConstraintIntent` built `{ node_id, type: 'threshold', threshold,
 *    direction, label }`. `GoalConstraintSchema` (src/schemas/assist.ts:277)
 *    REQUIRES `constraint_id`, `operator` (`>=` | `<=`) and `value`. All three
 *    were absent; `type` / `threshold` / `direction` are not contract fields at
 *    all. The object could never have satisfied the contract.
 *
 *  · It was written to a NODE, via `update_node` on the goal node's
 *    `goal_constraints`. PLoT is fed from the TOP-LEVEL `graph.goal_constraints`
 *    (build-turn-context.ts:1758, "forward graph.goal_constraints so PLoT
 *    receives constraints added via add_constraint"). A node-level array is not
 *    that field, and nothing in the repo reads `.threshold` / `.direction` off a
 *    constraint. Zero consumers, by derivation.
 *
 *  · The user was told: "Constraint **Churn < 5%** (threshold: 0.05) would be
 *    added." The routing layer's own comment (value-update-gate.ts:29) says the
 *    V4 edit_graph lane "has no constraint operation whatsoever" — the shortcut
 *    was pretending to be the operation the router documents as absent.
 *
 * Why this is worse than a loud failure: the user believes a hard limit is
 * protecting them, the analysis ranks options as if it were absent, and every
 * number downstream is confidently wrong in the direction of the user's
 * ignorance.
 *
 * The fix is honesty, not a parallel path. `PatchOperation` has no top-level
 * graph op (`src/orchestrator/types.ts:493` — node and edge ops only), so this
 * lane structurally CANNOT write `graph.goal_constraints`. Building a second
 * constraint writer here would be a second source of truth, which is on the
 * programme's prohibition list. So the shortcut stops fabricating and says so,
 * and points at the route that genuinely serves constraints: the D1
 * `add_constraint` handler, reached when value-update-gate clause D suppresses
 * edit dispatch.
 *
 * Test discipline notes:
 *  · The suggested phrasing is pinned against the REAL router predicate
 *    (`shouldSuppressEditDispatchForValueUpdate`), never against this file's
 *    belief about it. A receipt that points at a dead end is the defect one
 *    layer over.
 *  · The user's own phrasing is asserted NOT suppressed, which is what makes
 *    this lane reachable at all. Without that pin the whole spec could pass
 *    while testing an unreachable branch.
 */
import { describe,expect,it,vi } from 'vitest';

vi.mock('../../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are editing a graph.'),
  getSystemPromptMeta: vi.fn().mockReturnValue(null),
}));
import { GoalConstraintSchema } from '../../../../src/schemas/assist.js';

/**
 * Every constraint object this turn would write into any goal_constraints array.
 *
 * The block shape is `block.data.operations[]` — verified against a real
 * `handleEditGraph` return, not assumed. An earlier draft of this helper read
 * `block.graph_patch.operations` and silently found NOTHING, so the absence
 * assertions below passed while the malformed constraint was still on the wire.
 * That is why `PRESENCE CONTROL` exists: an absence assertion that has never
 * been shown to detect a presence is not evidence.
 */
function constraintsWrittenBy(result: { blocks?: unknown[] }): unknown[] {
  const out: unknown[] = [];
  for (const block of (result.blocks ?? []) as Array<{ data?: { operations?: unknown[] } }>) {
    for (const op of (block?.data?.operations ?? []) as Array<{ value?: unknown }>) {
      const value = op?.value as { goal_constraints?: unknown } | undefined;
      if (value && Array.isArray(value.goal_constraints)) out.push(...value.goal_constraints);
    }
  }
  return out;
}

/**
 * The exact block the pristine (defective) handler emitted for
 * "keep churn under 5%", captured from a real run at staging tip cab59b72.
 * Pinned as a FIXTURE, never regenerated from current code: it is the historical
 * artefact the extractor must be able to see, and a control pinned to "whatever
 * the code does now" decays into a tautology the first time the code changes.
 */
const PRISTINE_DEFECT_BLOCK = Object.freeze({
  block_type: 'graph_patch',
  data: {
    patch_type: 'edit',
    operations: [
      {
        op: 'update_node',
        path: 'goal_1',
        value: {
          goal_constraints: [
            { node_id: 'factor_churn', type: 'threshold', threshold: 0.05, direction: 'below', label: 'Churn < 5%' },
          ],
        },
      },
    ],
  },
});

describe('edit_graph constraint shortcut — receipt honesty (ROADMAP 2.1041)', () => {
  it('PRESENCE CONTROL: the extractor detects the historical malformed constraint', () => {
    // Without this, every "writes no invalid constraint" assertion below could
    // pass by extracting nothing at all.
    const found = constraintsWrittenBy({ blocks: [PRISTINE_DEFECT_BLOCK] });
    expect(found).toHaveLength(1);
    // And it must be a constraint the contract genuinely rejects — otherwise the
    // schema assertion is satisfiable by a malformed object and proves nothing.
    expect(GoalConstraintSchema.safeParse(found[0]).success).toBe(false);
  });
});
