/** Agent-only factor review. The existing Run fact owns storage; this leaf writes no rows. */
import { currentProviderPolicy } from '../../adapters/llm/provider-policy.js';
import { enrichFactors } from '../../services/review/enrichFactors.js';
import { FactorEnrichment, FactorSensitivityInput, type FactorEnrichmentT, type FactorSensitivityInputT } from '../../schemas/enrichment.js';
import type { GraphT } from '../../schemas/graph.js';
import { readDriverInfluenceScore } from '../../orchestrator/context/driver-influence.js';

// Structured construction uses unregistered Responses-only budget ids (gpt-5.6-terra), not an extraction
// assignment resolver. Use the registered OpenAI extraction model without changing the legacy env default.
export const AGENT_LANE_ENRICH_MODEL = 'gpt-4.1-2025-04-14';
export const AGENT_FACTOR_REVIEW_TIMEOUT_MS = 5_000;

/** Rank through the shared authoritative influence-score rule; elasticity never ranks drivers. */
export function factorReviewSensitivity(value: unknown): FactorSensitivityInputT[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const rows = value.filter((v): v is Record<string, unknown> => v !== null && typeof v === 'object')
    .filter((v) => typeof v.factor_id === 'string' && typeof v.elasticity === 'number' && Number.isFinite(v.elasticity));
  const sorted = rows.flatMap((row) => {
    const score = readDriverInfluenceScore(row);
    return score === null ? [] : [{ row, score }];
  }).sort((a, b) => b.score - a.score || String(a.row.factor_id).localeCompare(String(b.row.factor_id)));
  return sorted.flatMap(({ row }, i) => {
    const parsed = FactorSensitivityInput.safeParse({ factor_id: row.factor_id, elasticity: row.elasticity,
      rank: i + 1 });
    return parsed.success ? [parsed.data] : [];
  });
}

/** One reader for the persisted member; corrupt or absent data never becomes prose. */
export function readFactorEnrichments(value: unknown): FactorEnrichmentT[] | undefined {
  const parsed = FactorEnrichment.array().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Runs inside the Agent turn's policy and ledger. A failed enrichment leaves the completed Run intact. */
export async function agentFactorEnrichments(graph: unknown, sensitivity: unknown, requestId: string,
  signal: AbortSignal | undefined): Promise<FactorEnrichmentT[] | undefined> {
  // The caller's signal fires at the existing outer deadline, including time already spent awaiting PLoT.
  if (signal?.aborted || currentProviderPolicy()?.route !== 'agent_v1_turn') return undefined;
  const rows = factorReviewSensitivity(sensitivity);
  if (rows.length === 0) return undefined;
  try {
    const result = await enrichFactors(graph as GraphT, rows, { requestId, signal,
      modelOverride: AGENT_LANE_ENRICH_MODEL, timeoutMs: AGENT_FACTOR_REVIEW_TIMEOUT_MS });
    if (signal?.aborted || !result.success) return undefined;
    // The engine owns rank and identity, never the model's response.
    const enrichments = result.enrichments.filter((e) => rows.some((r) => r.factor_id === e.factor_id && r.rank === e.sensitivity_rank));
    return enrichments.length === 0 ? undefined : enrichments;
  } catch {
    return undefined;
  }
}
