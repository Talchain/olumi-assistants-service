/**
 * ⭐ #2576 item D (DL; Integrator): THE AGENT ROUTE CARRIES THE CONSTRUCTION'S `model_building_notices`.
 *
 * Route-v2 writes the published `OlumiResponseSchema.model_building_notices` field (`draft-graph-dispatch.ts`); the
 * agent route — the one every `/proxy/v5/turn` takes with `PROXY_V5_TARGET=agent` — wrote none, so a records build's
 * refusals never reached DGAI's notice bubble (`useConversation.ts`, which reads the key off every turn). The records
 * build produces the notices from its own typed rows (`build-model-from-records.ts`, `buildModelBuildingNotices` over
 * `projection.dropped`) and validates them at the producer; this reads them off the turn's construction result,
 * re-validated at the pinned contract, so a malformed carrier is omitted rather than quarantined by the UI parser.
 */
import { ModelBuildingNoticesSchema, type ModelBuildingNotices } from '@talchain/schemas/boundary';

/** The notices of this turn's construction (`build_model_from_brief`), or undefined: none built, none refused, invalid. */
export function constructionNoticesOf(result: {
  readonly tool_calls: readonly { readonly name: string }[];
  readonly tool_results: readonly unknown[];
}): ModelBuildingNotices | undefined {
  const at = result.tool_calls.findIndex((c) => c.name === 'build_model_from_brief');
  if (at < 0) return undefined;
  const raw = (result.tool_results[at] as { model_building_notices?: unknown } | null | undefined)?.model_building_notices;
  if (raw === undefined) return undefined;
  const parsed = ModelBuildingNoticesSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
