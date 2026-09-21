/**
 * THE RUNNER — wires the rubric to the product's own validator, and nothing
 * else.
 *
 * The rubric is a pure function so it can be tested without booting anything;
 * this module is the only place that reaches into the product, and it reaches
 * for exactly one thing: `validateGraph`, the verdict the enforcement gate
 * reads. The rubric never restates a validator predicate, so it cannot disagree
 * with the gate the product actually enforces.
 */
import { validateGraph } from "../../src/validators/graph-validator.js";
import { normaliseDraftResponse } from "../../src/adapters/llm/normalisation.js";
import { runDeterministicSweep } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";
import { runConnectivity } from "../../src/cee/unified-pipeline/stages/repair/connectivity.js";
import { scoreDraft, type DraftQualityScore, type ValidatorVerdict } from "./rubric.js";

/**
 * ⭐ THE TWO STAGES, AND WHY BOTH ARE REPORTED.
 *
 * `projected` — the graph the projector emits. This is the purest signal about
 *   the INSTRUCTION: nothing downstream has had a chance to cover for it.
 * `postRepair` — the same graph after normalisation and the two deterministic
 *   repair substeps the pipeline runs next. This is much closer to what the
 *   USER receives.
 *
 * They disagree in a way that matters, so reporting one alone would mislead: on
 * a brief that never states an objective, `projected` has NO goal, and the
 * sweep then mints one labelled `DEFAULT_GOAL_LABEL`. "No goal" and "a goal"
 * are both true, at different stages, and only the pair shows that the product
 * covers the gap with a platitude rather than closing it.
 *
 * The steps and their order are the ones `src/cee/draft/records/replay.ts`
 * runs (its steps 2, 4 and 5), taken through the pipeline's own entry points —
 * not re-implemented here, which would make this a second, drifting copy of
 * `runStageRepair`.
 */
export type DraftStage = "projected" | "post-repair";

export async function applyDeterministicRepair(graph: unknown, requestId = "dqe"): Promise<unknown> {
  const normalised = normaliseDraftResponse(JSON.parse(JSON.stringify(graph)) as unknown);
  const ctx = {
    graph: normalised,
    requestId,
    repairTrace: {},
    deterministicRepairs: [] as { code: string; path: string; action: string }[],
    input: { brief: "", context: {} },
    request: { headers: {} },
  };
  // `as any` and not a double cast: the double cast is this repo's ratcheted
  // marker for a silently-drifting wire seam. This is a measurement harness
  // supplying the minimal context these two substeps read — the same convention
  // the repo's own sweep tests and `replay.ts` use.
  await runDeterministicSweep(ctx as any);
  runConnectivity(ctx as any);
  return ctx.graph;
}

/**
 * Run the product's validator over a projected draft.
 *
 * `phase: "post_sweep_authoritative"` is the phase the replay harness uses for
 * its final read (`src/cee/draft/records/replay.ts`), chosen there because a
 * measurement harness has no business widening the production `ValidatorPhase`
 * union to name itself. Same reason here.
 */
export function validateForRubric(graph: unknown, requestId = "draft-quality-eval"): ValidatorVerdict {
  const verdict = validateGraph({
    graph: graph as Parameters<typeof validateGraph>[0]["graph"],
    requestId,
    phase: "post_sweep_authoritative",
  });
  return {
    errors: verdict.errors.map((e) => ({ code: e.code, path: e.path })),
    warnings: (verdict.warnings ?? []).map((w) => ({ code: w.code, path: w.path })),
  };
}

export interface EvaluateInput {
  readonly briefId: string;
  readonly graph: unknown;
  readonly briefText?: string;
  readonly expectStatusQuo?: boolean;
}

export function evaluateDraft(input: EvaluateInput): DraftQualityScore {
  return scoreDraft({
    briefId: input.briefId,
    graph: input.graph,
    briefText: input.briefText,
    expectStatusQuo: input.expectStatusQuo,
    verdict: validateForRubric(input.graph, `dqe-${input.briefId}`),
  });
}

/** `evaluateDraft` at the post-repair stage. */
export async function evaluateDraftPostRepair(input: EvaluateInput): Promise<DraftQualityScore> {
  const repaired = await applyDeterministicRepair(input.graph, `dqe-${input.briefId}`);
  return evaluateDraft({ ...input, graph: repaired });
}
