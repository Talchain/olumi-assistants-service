import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { deriveDecisionContextGraphHash } from '../build-turn-context.js';
import { deriveAnalysisFreshness } from '../context/freshness.js';
import type { SessionStore } from '../session/store.js';
import { scenarioAccessDecision } from './scenario-access.js';
import { runExplanationIdentityMatches } from './run-explanation.js';

/** A bounded check, never an analysis projection. Legacy stores keep the full fresh read. */
export async function runExplanationCurrentness(
  store: SessionStore, scenarioId: string, caller: string | null, chip: unknown,
  initial: { readonly graph: unknown; readonly briefText: string | null },
): Promise<boolean | 'wire_changed' | undefined> {
  if (typeof store.readRunCurrentness !== 'function') return undefined;
  try {
    const read = await store.readRunCurrentness(scenarioId);
    if (read === null || scenarioAccessDecision(read.userId, caller) !== 'allow') return false;
    const freshness = deriveAnalysisFreshness([read.fact], deriveDecisionContextGraphHash(read.graph), undefined, {
      priorFactsReadOk: true, analysisInvalidatedAt: read.analysisInvalidatedAt, currentGraph: read.graph,
    });
    if (freshness.freshness !== 'fresh' || !runExplanationIdentityMatches(chip, {
      scenario_id: scenarioId, graph_hash_at_run: freshness.graph_hash_at_run, computed_at: freshness.computed_at,
    })) return false;
    // Analysis hashing deliberately excludes display/provenance fields. A current Run
    // alone cannot license reusing the initial model, brief and derived wire carriers.
    return stableStringify({ graph: read.graph, briefText: read.briefText }) === stableStringify(initial)
      ? true : 'wire_changed';
  } catch {
    return false;
  }
}
