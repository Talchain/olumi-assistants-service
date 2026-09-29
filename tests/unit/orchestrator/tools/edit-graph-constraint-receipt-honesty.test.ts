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
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are editing a graph.'),
  getSystemPromptMeta: vi.fn().mockReturnValue(null),
}));

import { handleEditGraph } from '../../../../src/orchestrator/tools/edit-graph.js';
import type { ConversationContext } from '../../../../src/orchestrator/types.js';
import type { LLMAdapter } from '../../../../src/adapters/llm/types.js';
import { GoalConstraintSchema } from '../../../../src/schemas/assist.js';
import { shouldSuppressEditDispatchForValueUpdate } from '../../../../src/orchestrator/routing/value-update-gate.js';
import { findSuccessClaimHit } from '../../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js';

/** The user's utterance from the defect report. */
const CONSTRAINT_UTTERANCE = 'keep churn under 5%';

function makeContext(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Revenue' },
        { id: 'factor_churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.08, std: 0.02 } },
      ],
      edges: [
        {
          from: 'factor_churn',
          to: 'goal_1',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 1,
          effect_direction: 'negative',
        },
      ],
    },
    messages: [{ role: 'user', content: CONSTRAINT_UTTERANCE }],
    scenario_id: '11111111-2222-3333-4444-555555555555',
    framing: { stage: 'evaluate' },
    analysis_response: null,
  } as unknown as ConversationContext;
}

/** Fails the test if the shortcut ever reaches the composition LLM. */
function makeForbiddenAdapter(): LLMAdapter {
  const chat = vi.fn().mockImplementation(() => {
    throw new Error('constraint shortcut must not call the composition adapter');
  });
  return { name: 'mock', model: 'mock', chat, chatWithTools: vi.fn() } as unknown as LLMAdapter;
}

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

  it('PRECONDITION: the utterance is NOT suppressed by the real router, so this lane is reachable', () => {
    // Clause D suppresses `add|apply|put|place` + the literal noun
    // "constraint". "keep churn under 5%" carries neither, so route-v2 sends it
    // here rather than to the D1 add_constraint handler. If this ever flips,
    // every assertion below is about a dead branch and must be re-derived.
    expect(shouldSuppressEditDispatchForValueUpdate(CONSTRAINT_UTTERANCE)).toBe(false);
  });

  it('writes no constraint that the contract would reject', async () => {
    const result = await handleEditGraph(
      makeContext(),
      CONSTRAINT_UTTERANCE,
      makeForbiddenAdapter(),
      'req-constraint-honesty',
      'turn-constraint-honesty',
    );

    // Bind by identity: every constraint this turn would persist must satisfy
    // the SAME schema the sanctioned add_constraint handler validates against.
    // A malformed constraint is not a lesser constraint — it is a lie.
    for (const constraint of constraintsWrittenBy(result)) {
      const parsed = GoalConstraintSchema.safeParse(constraint);
      expect(
        parsed.success,
        `constraint written by edit_graph fails GoalConstraintSchema: ${JSON.stringify(constraint)}`,
      ).toBe(true);
    }
  });

  it('does not tell the user the limit would be registered', async () => {
    const result = await handleEditGraph(
      makeContext(),
      CONSTRAINT_UTTERANCE,
      makeForbiddenAdapter(),
      'req-constraint-honesty',
      'turn-constraint-honesty',
    );

    // The precise false claim from the defect: "…would be added."
    expect(result.assistantText).not.toMatch(/would be added/i);
    // And no perfective/committed phrasing either.
    expect(result.assistantText).not.toMatch(/\b(has been added|I['’]ve added|successfully added)\b/i);
  });

  it('tells the user plainly that the limit was not applied', async () => {
    const result = await handleEditGraph(
      makeContext(),
      CONSTRAINT_UTTERANCE,
      makeForbiddenAdapter(),
      'req-constraint-honesty',
      'turn-constraint-honesty',
    );

    expect(result.assistantText).toMatch(/couldn['’]t|could not|not applied|wasn['’]t applied/i);
    // The analysis consequence must be stated — a bare apology leaves the user
    // believing the number is protected anyway.
    expect(result.assistantText).toMatch(/analysis|scored?\b|score against/i);
  });

  it('offers a phrasing the REAL router sends to the sanctioned constraint handler', async () => {
    const result = await handleEditGraph(
      makeContext(),
      CONSTRAINT_UTTERANCE,
      makeForbiddenAdapter(),
      'req-constraint-honesty',
      'turn-constraint-honesty',
    );

    // A silent turn is its own failure mode: the user asked for a limit and
    // must be told something. `assistantText` is `string | null`, so pin it.
    expect(typeof result.assistantText).toBe('string');
    const assistantText = result.assistantText as string;

    // Pull the quoted example out of the copy and hand it to the real gate.
    // This is the anti-dead-end pin: a receipt may only recommend a phrasing
    // that route-v2 actually suppresses into the D1 add_constraint lane.
    const quoted = assistantText.match(/["“]([^"”]+)["”]/);
    expect(quoted, `honest receipt must quote a suggested phrasing: ${assistantText}`).not.toBeNull();

    const suggestion = quoted![1];
    expect(
      shouldSuppressEditDispatchForValueUpdate(suggestion),
      `suggested phrasing "${suggestion}" is NOT routed to the add_constraint handler — the receipt points at a dead end`,
    ).toBe(true);
  });

  it('the honest copy carries no success-claim language, per the real guard', async () => {
    const result = await handleEditGraph(
      makeContext(),
      CONSTRAINT_UTTERANCE,
      makeForbiddenAdapter(),
      'req-constraint-honesty',
      'turn-constraint-honesty',
    );

    // Swept against the dispatcher's OWN detector rather than a local regex, so
    // the copy cannot drift into commit-claim wording that the V5 H5 invariant
    // would silently rewrite on the wire.
    expect(typeof result.assistantText).toBe('string');
    expect(findSuccessClaimHit(result.assistantText as string)).toBeNull();
  });

  it('never emits an inverted operator for a floor phrased with "below"', async () => {
    // From the frozen brief B1, verbatim shape: a FLOOR expressed with the word
    // "below". The old detector read the bare word and stamped direction
    // 'below', i.e. a ceiling — which, if enforced, penalises exactly the
    // options that honour the floor. Ruling: suppress rather than invert.
    const context = makeContext();
    const utterance = 'we must keep gross margin from dropping below 78%';
    (context.graph as { nodes: Array<Record<string, unknown>> }).nodes.push({
      id: 'factor_margin',
      kind: 'factor',
      label: 'Gross margin',
      observed_state: { value: 0.8, std: 0.02 },
    });

    const result = await handleEditGraph(
      context,
      utterance,
      makeForbiddenAdapter(),
      'req-constraint-inversion',
      'turn-constraint-inversion',
    );

    // Checked in BOTH vocabularies on purpose. The pristine code encoded
    // direction as `{ direction, threshold }`; the contract encodes it as
    // `{ operator, value }`. An assertion written only against the contract
    // vocabulary passes vacuously on the legacy shape — which is exactly how
    // this test read GREEN on the defective code in its first draft.
    for (const constraint of constraintsWrittenBy(result)) {
      const c = constraint as { operator?: string; value?: number; direction?: string; threshold?: number };
      expect(
        c.operator === '<=' && c.value === 0.78,
        `emitted an INVERTED floor (<= 0.78) for "${utterance}"`,
      ).toBe(false);
      expect(
        c.direction === 'below' && c.threshold === 0.78,
        `emitted an INVERTED floor (direction 'below' @ 0.78) for "${utterance}"`,
      ).toBe(false);
    }

    // The ruling is suppress-rather-than-invert: when the direction cannot be
    // determined confidently, emit nothing and say so.
    expect(constraintsWrittenBy(result)).toHaveLength(0);
    expect(result.assistantText).not.toMatch(/would be added/i);
  });
});
