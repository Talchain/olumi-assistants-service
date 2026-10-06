/** Agent-only factor review. The existing Run fact owns storage; this leaf writes no rows. */
import { currentProviderPolicy } from '../../adapters/llm/provider-policy.js';
import { enrichFactors } from '../../services/review/enrichFactors.js';
import { FactorEnrichment, FactorSensitivityInput, type FactorEnrichmentT, type FactorSensitivityInputT } from '../../schemas/enrichment.js';
import type { GraphT } from '../../schemas/graph.js';

// Structured construction uses unregistered Responses-only budget ids (gpt-5.6-terra), not an extraction
// assignment resolver. Use the registered OpenAI extraction model without changing the legacy env default.
export const AGENT_LANE_ENRICH_MODEL = 'gpt-4.1-2025-04-14';
export const AGENT_FACTOR_REVIEW_TIMEOUT_MS = 5_000;

/** Preserve upstream ranks; when absent, use the legacy enricher's deterministic elasticity ordering. */
export function factorReviewSensitivity(value: unknown): FactorSensitivityInputT[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const rows = value.filter((v): v is Record<string, unknown> => v !== null && typeof v === 'object')
    .filter((v) => typeof v.factor_id === 'string' && typeof v.elasticity === 'number' && Number.isFinite(v.elasticity));
  const rankOf = (r: Record<string, unknown>): unknown => r.importance_rank ?? r.rank;
  const ranked = rows.every((r) => Number.isInteger(rankOf(r)) && Number(rankOf(r)) >= 1);
  const sorted = ranked ? rows : [...rows].sort((a, b) => Number(b.elasticity) - Number(a.elasticity)
    || String(a.factor_id).localeCompare(String(b.factor_id)));
  return sorted.flatMap((r, i) => {
    const parsed = FactorSensitivityInput.safeParse({ factor_id: r.factor_id, elasticity: r.elasticity,
      rank: ranked ? rankOf(r) : i + 1 });
    return parsed.success ? [parsed.data] : [];
  });
}

/** One reader for the persisted member; corrupt or absent data never becomes prose. */
export function readFactorEnrichments(value: unknown): FactorEnrichmentT[] | undefined {
  const parsed = FactorEnrichment.array().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Runs inside the Agent turn's policy and ledger. A failed enrichment leaves the completed Run intact. */
export async function agentFactorEnrichments(graph: unknown, sensitivity: unknown, requestId: string): Promise<FactorEnrichmentT[] | undefined> {
  if (currentProviderPolicy()?.route !== 'agent_v1_turn') return undefined;
  const rows = factorReviewSensitivity(sensitivity);
  if (rows.length === 0) return undefined;
  try {
    const result = await enrichFactors(graph as GraphT, rows, { requestId,
      modelOverride: AGENT_LANE_ENRICH_MODEL, timeoutMs: AGENT_FACTOR_REVIEW_TIMEOUT_MS });
    if (!result.success) return undefined;
    // The engine owns rank and identity, never the model's response.
    const enrichments = result.enrichments.filter((e) => rows.some((r) => r.factor_id === e.factor_id && r.rank === e.sensitivity_rank));
    return enrichments.length === 0 ? undefined : enrichments;
  } catch {
    return undefined;
  }
}
