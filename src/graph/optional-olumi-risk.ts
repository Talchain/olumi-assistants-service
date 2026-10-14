/**
 * ⭐ T4i P1 — AN OLUMI-ADDED RISK THE USER HAS NOT ADOPTED, WITH NO LEVEL, IS AN OPTIONAL PROPOSAL OUTSIDE THE OPERATIVE
 * MODEL (DL 14 Oct; PL #94 6135017311: "it must not silently become an operative approved root or an implicit new user
 * obligation"). THE ONE DEFINITION, read by the participation guard (`run-analysis-participation-guard.ts`, the one place
 * the Run's sent graph is built) and by readiness (`analysis-ready-helper.ts`, which judges the graph the Run sends).
 *
 * In the set: a RISK node that
 *   · is POSITIVELY stamped `proposed_by: 'olumi'` (the option precedent's origin mark: `olumi-proposed-option.ts`). A
 *     legacy `ai_inferred` display tag, a verifier miss or an unknown origin is never proof of Olumi's addition, so such a
 *     root keeps T4 (withhold, and ask for its level);
 *   · is NOT adopted and not otherwise decided: no `analysis_participation` at all (adoption writes `'included'` and keeps
 *     the origin; a `'retained_excluded'` node, such as a draft-widening suggestion, is already out by the literal rule);
 *   · holds NO level the engine would read: no finite `observed_state.value`, no finite V1 `data.value`, no sampled
 *     uniform prior, no event-risk occurrence block (readiness's own level rule, `goalRootsWithoutStatusQuoLevel`). Any
 *     doubt keeps the node operative, which is today's behaviour.
 * Until the drafter stamps risks, nothing is in the set, so this changes no Run.
 */
type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value);

/** Readiness's level rule, read on the node as stored (`observed_state`, the V1 `data`, the prior, the event block). */
function holdsALevel(node: Rec): boolean {
  if (finite(isRec(node.observed_state) ? node.observed_state.value : undefined)) return true;
  if (finite(isRec(node.data) ? node.data.value : undefined)) return true;
  const prior = isRec(node.prior) ? node.prior : undefined;
  if (prior !== undefined && prior.distribution === 'uniform' && finite(prior.range_min) && finite(prior.range_max)
    && prior.range_min !== prior.range_max) return true;
  return node.event_risk !== undefined && node.event_risk !== null;
}

export function isOptionalOlumiRisk(node: unknown): boolean {
  return isRec(node) && node.kind === 'risk' && node.proposed_by === 'olumi' && node.analysis_participation === undefined
    && typeof node.id === 'string' && node.id !== '' && !holdsALevel(node);
}
