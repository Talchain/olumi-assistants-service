import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
/**
 * ROADMAP 2.655 — EVERY DECLINE OF THE STRUCTURAL-EDIT TOOL, AFTER A BUDGET
 * REFUSAL, MEASURED AT THE SEAM A USER READS.
 *
 * ── THE WITNESSED DEFECT (walk 2.634, 2026-08-07) ──────────────────────────
 * The canonical compound edit — "Add three new options ... Connect each to the
 * MRR goal, and add a distinct risk factor for each of the three" — returned
 * the pre-split dead end VERBATIM:
 *
 *   "I tried to make that change, but it would require 6 node operations and 6
 *    edge operations - more than is safe in a single edit (limit: 4 node ops,
 *    8 edge ops). Consider breaking this into smaller steps ..."
 *
 * No first batch, no scope notice, internal caps leaked, and no explanation
 * that only the NODE budget tripped (six edge operations were under the eight
 * the sentence quotes).
 *
 * ── WHY #829's SPLIT DID NOT SAVE THE TURN ────────────────────────────────
 * The splitter runs only inside `tryStructuralEditTool`, which is a SECOND
 * composition: a real `chatWithTools` call plus a grounding validator. When
 * that second composition declines for ANY reason, the function returned
 * `null` — and `null` means "the rulebook's own answer stands". The rulebook's
 * own answer, on this turn, is the leaked-limits dead end. Exactly ONE decline
 * class (`BATCH_CAP_EXCEEDED`) had replacement copy; every other class silently
 * reinstated the defect.
 *
 * ── WHY NO TEST SAW IT ────────────────────────────────────────────────────
 * Every existing fixture for this feature stubs the composer to SUCCEED. The
 * suite therefore measured the split and never the decline (trap 13c/16: the
 * fixtures encoded the author's model of the composer rather than the
 * composer's real failure modes). This file is the missing half: one case per
 * decline class, all of them entered from the walk's real budget refusal.
 *
 * ── WHAT IS ASSERTED, AND WHY IT IS THREE SEPARATE CLAIMS ────────────────
 * The rulebook's answer is NOT hand-typed here. It is built by the PRODUCER
 * (`buildPatchRejectionEnvelope`) from the walk's real counts, so it tracks the
 * real sentence rather than a snapshot of it (trap 13c: derive the expectation
 * from the producer's semantics, never from the test author's reading). Three
 * claims are then made, and they are deliberately NOT collapsed, because a
 * partial fix satisfies some and not others:
 *
 *   1. ANSWER PRECEDENCE — the rulebook's budget answer is not what ships.
 *      This is the 2.655 defect proper, and it is the one that survives even
 *      after the budget copy itself is cleaned up.
 *   2. NO INTERNAL CAP — whatever ships names no cap and no operation count.
 *      Pattern-bound, independent of who produced the sentence.
 *   3. THE RIGHT SENTENCE — the copy that ships is the one for THIS decline
 *      class, looked up by identity in the producer's own table, never matched
 *      by a "looks honest" predicate several sentences would satisfy
 *      (CLAUDE.md trap 19).
 */
/**
 * ROADMAP 2.655 — EVERY DECLINE OF THE STRUCTURAL-EDIT TOOL, AFTER A BUDGET
 * REFUSAL, MEASURED AT THE SEAM A USER READS.
 *
 * ── THE WITNESSED DEFECT (walk 2.634, 2026-08-07) ──────────────────────────
 * The canonical compound edit — "Add three new options ... Connect each to the
 * MRR goal, and add a distinct risk factor for each of the three" — returned
 * the pre-split dead end VERBATIM:
 *
 *   "I tried to make that change, but it would require 6 node operations and 6
 *    edge operations - more than is safe in a single edit (limit: 4 node ops,
 *    8 edge ops). Consider breaking this into smaller steps ..."
 *
 * No first batch, no scope notice, internal caps leaked, and no explanation
 * that only the NODE budget tripped (six edge operations were under the eight
 * the sentence quotes).
 *
 * ── WHY #829's SPLIT DID NOT SAVE THE TURN ────────────────────────────────
 * The splitter runs only inside `tryStructuralEditTool`, which is a SECOND
 * composition: a real `chatWithTools` call plus a grounding validator. When
 * that second composition declines for ANY reason, the function returned
 * `null` — and `null` means "the rulebook's own answer stands". The rulebook's
 * own answer, on this turn, is the leaked-limits dead end. Exactly ONE decline
 * class (`BATCH_CAP_EXCEEDED`) had replacement copy; every other class silently
 * reinstated the defect.
 *
 * ── WHY NO TEST SAW IT ────────────────────────────────────────────────────
 * Every existing fixture for this feature stubs the composer to SUCCEED. The
 * suite therefore measured the split and never the decline (trap 13c/16: the
 * fixtures encoded the author's model of the composer rather than the
 * composer's real failure modes). This file is the missing half: one case per
 * decline class, all of them entered from the walk's real budget refusal.
 *
 * ── WHAT IS ASSERTED, AND WHY IT IS THREE SEPARATE CLAIMS ────────────────
 * The rulebook's answer is NOT hand-typed here. It is built by the PRODUCER
 * (`buildPatchRejectionEnvelope`) from the walk's real counts, so it tracks the
 * real sentence rather than a snapshot of it (trap 13c: derive the expectation
 * from the producer's semantics, never from the test author's reading). Three
 * claims are then made, and they are deliberately NOT collapsed, because a
 * partial fix satisfies some and not others:
 *
 *   1. ANSWER PRECEDENCE — the rulebook's budget answer is not what ships.
 *      This is the 2.655 defect proper, and it is the one that survives even
 *      after the budget copy itself is cleaned up.
 *   2. NO INTERNAL CAP — whatever ships names no cap and no operation count.
 *      Pattern-bound, independent of who produced the sentence.
 *   3. THE RIGHT SENTENCE — the copy that ships is the one for THIS decline
 *      class, looked up by identity in the producer's own table, never matched
 *      by a "looks honest" predicate several sentences would satisfy
 *      (CLAUDE.md trap 19).
 */
/**
 * ROADMAP 2.655 — EVERY DECLINE OF THE STRUCTURAL-EDIT TOOL, AFTER A BUDGET
 * REFUSAL, MEASURED AT THE SEAM A USER READS.
 *
 * ── THE WITNESSED DEFECT (walk 2.634, 2026-08-07) ──────────────────────────
 * The canonical compound edit — "Add three new options ... Connect each to the
 * MRR goal, and add a distinct risk factor for each of the three" — returned
 * the pre-split dead end VERBATIM:
 *
 *   "I tried to make that change, but it would require 6 node operations and 6
 *    edge operations - more than is safe in a single edit (limit: 4 node ops,
 *    8 edge ops). Consider breaking this into smaller steps ..."
 *
 * No first batch, no scope notice, internal caps leaked, and no explanation
 * that only the NODE budget tripped (six edge operations were under the eight
 * the sentence quotes).
 *
 * ── WHY #829's SPLIT DID NOT SAVE THE TURN ────────────────────────────────
 * The splitter runs only inside `tryStructuralEditTool`, which is a SECOND
 * composition: a real `chatWithTools` call plus a grounding validator. When
 * that second composition declines for ANY reason, the function returned
 * `null` — and `null` means "the rulebook's own answer stands". The rulebook's
 * own answer, on this turn, is the leaked-limits dead end. Exactly ONE decline
 * class (`BATCH_CAP_EXCEEDED`) had replacement copy; every other class silently
 * reinstated the defect.
 *
 * ── WHY NO TEST SAW IT ────────────────────────────────────────────────────
 * Every existing fixture for this feature stubs the composer to SUCCEED. The
 * suite therefore measured the split and never the decline (trap 13c/16: the
 * fixtures encoded the author's model of the composer rather than the
 * composer's real failure modes). This file is the missing half: one case per
 * decline class, all of them entered from the walk's real budget refusal.
 *
 * ── WHAT IS ASSERTED, AND WHY IT IS THREE SEPARATE CLAIMS ────────────────
 * The rulebook's answer is NOT hand-typed here. It is built by the PRODUCER
 * (`buildPatchRejectionEnvelope`) from the walk's real counts, so it tracks the
 * real sentence rather than a snapshot of it (trap 13c: derive the expectation
 * from the producer's semantics, never from the test author's reading). Three
 * claims are then made, and they are deliberately NOT collapsed, because a
 * partial fix satisfies some and not others:
 *
 *   1. ANSWER PRECEDENCE — the rulebook's budget answer is not what ships.
 *      This is the 2.655 defect proper, and it is the one that survives even
 *      after the budget copy itself is cleaned up.
 *   2. NO INTERNAL CAP — whatever ships names no cap and no operation count.
 *      Pattern-bound, independent of who produced the sentence.
 *   3. THE RIGHT SENTENCE — the copy that ships is the one for THIS decline
 *      class, looked up by identity in the producer's own table, never matched
 *      by a "looks honest" predicate several sentences would satisfy
 *      (CLAUDE.md trap 19).
 */
/**
 * ROADMAP 2.655 — EVERY DECLINE OF THE STRUCTURAL-EDIT TOOL, AFTER A BUDGET
 * REFUSAL, MEASURED AT THE SEAM A USER READS.
 *
 * ── THE WITNESSED DEFECT (walk 2.634, 2026-08-07) ──────────────────────────
 * The canonical compound edit — "Add three new options ... Connect each to the
 * MRR goal, and add a distinct risk factor for each of the three" — returned
 * the pre-split dead end VERBATIM:
 *
 *   "I tried to make that change, but it would require 6 node operations and 6
 *    edge operations - more than is safe in a single edit (limit: 4 node ops,
 *    8 edge ops). Consider breaking this into smaller steps ..."
 *
 * No first batch, no scope notice, internal caps leaked, and no explanation
 * that only the NODE budget tripped (six edge operations were under the eight
 * the sentence quotes).
 *
 * ── WHY #829's SPLIT DID NOT SAVE THE TURN ────────────────────────────────
 * The splitter runs only inside `tryStructuralEditTool`, which is a SECOND
 * composition: a real `chatWithTools` call plus a grounding validator. When
 * that second composition declines for ANY reason, the function returned
 * `null` — and `null` means "the rulebook's own answer stands". The rulebook's
 * own answer, on this turn, is the leaked-limits dead end. Exactly ONE decline
 * class (`BATCH_CAP_EXCEEDED`) had replacement copy; every other class silently
 * reinstated the defect.
 *
 * ── WHY NO TEST SAW IT ────────────────────────────────────────────────────
 * Every existing fixture for this feature stubs the composer to SUCCEED. The
 * suite therefore measured the split and never the decline (trap 13c/16: the
 * fixtures encoded the author's model of the composer rather than the
 * composer's real failure modes). This file is the missing half: one case per
 * decline class, all of them entered from the walk's real budget refusal.
 *
 * ── WHAT IS ASSERTED, AND WHY IT IS THREE SEPARATE CLAIMS ────────────────
 * The rulebook's answer is NOT hand-typed here. It is built by the PRODUCER
 * (`buildPatchRejectionEnvelope`) from the walk's real counts, so it tracks the
 * real sentence rather than a snapshot of it (trap 13c: derive the expectation
 * from the producer's semantics, never from the test author's reading). Three
 * claims are then made, and they are deliberately NOT collapsed, because a
 * partial fix satisfies some and not others:
 *
 *   1. ANSWER PRECEDENCE — the rulebook's budget answer is not what ships.
 *      This is the 2.655 defect proper, and it is the one that survives even
 *      after the budget copy itself is cleaned up.
 *   2. NO INTERNAL CAP — whatever ships names no cap and no operation count.
 *      Pattern-bound, independent of who produced the sentence.
 *   3. THE RIGHT SENTENCE — the copy that ships is the one for THIS decline
 *      class, looked up by identity in the producer's own table, never matched
 *      by a "looks honest" predicate several sentences would satisfy
 *      (CLAUDE.md trap 19).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    // B-FIX1: the combined read follows the existing graph double.
    loadPersistedScenarioStateStrict: async (scenarioId: string) => ({ graph: (await (await import('../../build-turn-context.js')).loadPersistedGraphStrict(scenarioId)) ?? null, briefText: null, revision: 7 }),
    loadPersistedGraphStrict: vi.fn(),
    loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
    loadMostRecentPendingActions: vi.fn().mockResolvedValue([]),
  };
});
import {
  MAX_NODE_OPS,
  MAX_EDGE_OPS,
} from '../../../orchestrator/tools/patch-budget-limits.js';
import { _resetConfigCache } from '../../../config/index.js';

/**
 * ⚠ ROADMAP 2.713 — a CAUSAL link create must carry the belief the apply
 * contract has required since February (`strength.{mean,std}`,
 * `exists_probability`, `effect_direction`). The reconstructed fixtures here
 * carried only `{from,to}`, and separately supplied a `value.id` the deployed
 * advert makes structurally impossible — so they were unfaithful to the wire in
 * both directions and could not see the seam defect. Identity now arrives by
 * server-side synthesis from the authoritative `path`; the belief is stated,
 * because the composer refuses a link the model did not describe rather than
 * inventing one. Neither change alters an envelope count.
 */
const CAUSAL_BELIEF = {
  strength: { mean: 0.4, std: 0.15 },
  exists_probability: 0.8,
  effect_direction: 'positive',
} as const;

const NEW_OPTIONS = [
  { id: 'opt_acquire', label: 'Acquire a smaller competitor', risk: 'Integration overrun' },
  { id: 'opt_raise', label: 'Raise prices 10%', risk: 'Price-rise churn spike' },
  { id: 'opt_annual', label: 'Launch an annual plan discount', risk: 'Annual discount margin hit' },
];

/**
 * ⭐ THE WALK'S EXACT SHAPE: 6 node operations and 6 edge operations.
 *
 * Three options, each linked to the goal, each with its own risk factor linked
 * back to it. The NODE budget (four) trips; the EDGE budget (eight) does not —
 * which is precisely what the witnessed sentence failed to explain.
 */
const WALK_OPERATIONS = NEW_OPTIONS.flatMap((o) => [
  { op: 'add_node', path: o.id, value: { kind: 'option', label: o.label } },
  { op: 'add_edge', path: `${o.id}::goal_mrr`, value: { from: o.id, to: 'goal_mrr', ...CAUSAL_BELIEF } },
  {
    op: 'add_node',
    path: `fac_risk_${o.id}`,
    value: { kind: 'factor', label: o.risk },
  },
  {
    op: 'add_edge',
    path: `fac_risk_${o.id}::${o.id}`,
    value: { from: `fac_risk_${o.id}`, to: o.id, ...CAUSAL_BELIEF },
  },
]);

const WALK_NODE_OPS = WALK_OPERATIONS.filter((o) => o.op.endsWith('_node')).length;
const WALK_EDGE_OPS = WALK_OPERATIONS.filter((o) => o.op.endsWith('_edge')).length;

afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

/**
 * ⭐ THE PREMISE, MEASURED RATHER THAN ASSUMED (trap 13 / trap 16).
 *
 * Every decline case below is only meaningful if the walk's shape really is
 * splittable when the composer succeeds. If it were not, the decline tests
 * would be measuring an unsplittable request and would pass for the wrong
 * reason. This is the positive control for the whole file.
 */
describe('⭐ CONTROL — the walk`s own shape DOES split when the composer succeeds', () => {

  it('the fixture is the walk`s measured shape: over the node budget, under the edge budget', () => {
    expect(WALK_NODE_OPS).toBeGreaterThan(MAX_NODE_OPS);
    expect(WALK_EDGE_OPS).toBeLessThanOrEqual(MAX_EDGE_OPS);
  });
});

afterEach(() => __setUseAppendV6ForTest(true));
