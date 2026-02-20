/**
 * @archived — NOT runnable from this location.
 *
 * Preserved as reference for Pipeline B lineage. Relative imports are
 * intentionally stale; the live call-site now imports runDraftGraphPipeline
 * directly in src/cee/validation/pipeline.ts.
 */

import type { DraftGraphInputT } from "../schemas/assist.js";
import { runDraftGraphPipeline, type PipelineOpts } from "../routes/assist.draft-graph.js";

/**
 * Thin adapter to decouple CEE validation from the legacy draft route module.
 * This keeps the canonical draft pipeline implementation in one place while
 * allowing CEE code to depend only on the CEE namespace.
 */
export type DraftPipelineInput = DraftGraphInputT;
export type { PipelineOpts };

export async function runCeeDraftPipeline(
  input: DraftGraphInputT,
  rawBody: unknown,
  requestId: string,
  pipelineOpts?: PipelineOpts,
) {
  return runDraftGraphPipeline(input, rawBody, requestId, pipelineOpts);
}
