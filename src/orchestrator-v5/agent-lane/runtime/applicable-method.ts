/**
 * ⭐ WHICH REASONING METHOD DOES THIS MODEL'S LATEST ANALYSIS CALL FOR — AND WHY?
 *
 * Release Control's coaching release test (#63 5792626729): "identify consequential
 * reasoning weakness → select appropriate science-grounded method → explain why it
 * applies", with DETERMINISTIC applicability gates. Measured before this module: the
 * Agent had NO access to the method layer (0 references across agent-lane), while the
 * conventional route already selects a method from the analysis through
 * `rankInterventions`.
 *
 * ⛔ THIS MODULE DECIDES NOTHING. It reads the scenario's persisted `run_analysis`
 * facts — the Agent's own `run_analysis` goes through the conventional handler, which
 * persists it (measured: `v5_handler_facts`, served scenario d99f3ca9) — through the
 * store's NON-deprecated scenario-scoped reader (`readScenarioRunAnalysisFactsFor`,
 * the one production turn construction uses). The newest fact is the analysis; the
 * rest are its history. Both go to the SAME gate the conventional route uses, with
 * the SAME inputs it derives them from:
 *   - executor availability: `liveLensExecutorAvailability()`;
 *   - `previousAnalysisLens`: `derivePreviousAnalysisLens(<prior facts>, <that
 *     availability>)` — the exact derivation at `compose.ts` (`buildBlocksFromFacts`).
 *     That is the input the DSK "do not run immediately after" contraindication reads
 *     (`lens-selector.ts`, `isContraindicatedAfter`). Omitting it (#1731 review B1)
 *     let this tool hand the user DSK-P-003 straight after a pre-mortem, the one
 *     sequence the protocol's own contraindication forbids.
 *
 * ⚠ NOT THREADED, AND STATED RATHER THAN IMPLIED (review non-blocking 1): the
 * conventional call also passes `judgementSignals` (user override, contested edge,
 * stated dissent) and a precomputed `fragileEdge`. `fragileEdge` is recomputed by the
 * selector from the same enrichment when absent (pure, so the two agree).
 * `judgementSignals` is not available here, so this tool can never choose the
 * judgement tier — the documented fail-safe direction: it can only miss a method,
 * never invent one.
 *
 * The method's title and reason are the gate's own copy. A DSK protocol's published
 * questions are attached ONLY where the gate's lens carries DSK provenance
 * (`LENS_DSK_PROVENANCE`) — a lens whose rules predate the bundle is never given a
 * protocol label it does not have. They are returned as `closing_questions`, never
 * as the opening: `literalProtocolSteps` drops every step that would name the leader,
 * and for both DSK protocols what survives is the protocol's LAST step (#1731 review
 * B3). Opening with it asks the user to endorse a verdict instead of doing the
 * exercise.
 *
 * "No method" is a first-class answer (the gate's own "may recommend nothing"): the
 * Agent must not invent a technique the gate did not select.
 *
 * ⛔ AN OPTIONAL READ NEVER BREAKS THE TURN (#1731 review B2). The store throws on a
 * DB error or a row that fails its strict schema; uncaught, that rejected the whole
 * Agent turn (502) — including one whose `run_analysis` had already written. Any
 * failure here is logged and returned as the tool's own refusal.
 */
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { rankInterventions, LENS_DSK_PROVENANCE } from '../../compose/lens-selector.js';
import { derivePreviousAnalysisLens } from '../../compose/lens-history.js';
import { liveLensExecutorAvailability } from '../../compose/phase3-blocks.js';
import { resolveDskProtocolProvenance } from '../../compose/dsk-protocol-record.js';
import { loadVerifiedDskBundle } from '../../compose/dsk-bundle-record.js';
import { literalProtocolSteps } from '../../coaching/typed-intent-directive.js';
import { SCENARIO_ANALYSIS_FACT_CAP } from '../../context/reconcile-scenario-analysis-facts.js';
import type { IdentifiedHandlerFact } from '../../types/handler-fact.js';
import type { DSKProtocol } from '../../../dsk/types.js';
import { log } from '../../../utils/telemetry.js';
import type { ToolResult } from './agent-tools.js';

/** The store's `ScenarioRunAnalysisFactPage`, structurally (session/store.ts is not importable here). */
export interface RunAnalysisFactPage {
  readonly facts: readonly IdentifiedHandlerFact[];
  readonly total_count: number;
}
/** `SessionStore.readScenarioRunAnalysisFactsFor`: newest-first (`created_at DESC, id DESC`). */
export type ReadScenarioRunAnalysisFacts = (scenarioId: string, limit: number) => Promise<RunAnalysisFactPage>;

/** The scenario-history wall the model-facing analysis authority already uses. */
export const APPLICABLE_METHOD_FACT_WINDOW = SCENARIO_ANALYSIS_FACT_CAP;

const unavailable = (): ToolResult => ({ ok: false, mutated: false, refusal: 'method_gate_unavailable' });

/**
 * How the Agent opens the exercise. Static and method-independent: it points at the
 * gate's own `why`, so it adds no applicability judgement of its own.
 */
export const METHOD_OPENING_GUIDANCE =
  'Open with ONE question of your own for the user, drawn from the exercise described in why and naming what it points at in this model, then let them answer. '
  + 'Use closing_questions only at the end, once the user has worked through the exercise. Never ask the user to endorse an option or a verdict.';

function protocolRecord(protocolId: string): DSKProtocol | null {
  const bundle = loadVerifiedDskBundle();
  if (bundle === null) return null;
  const record = (bundle.objects ?? []).find(
    (o): o is DSKProtocol => o.type === 'protocol' && o.id === protocolId,
  ) ?? null;
  return record === null || record.deprecated === true ? null : record;
}

/** Which analysis this answer is about, so the Agent can tell whether it still describes the model. */
function analysisIdentity(fact: RunAnalysisHandlerFact): { graph_hash_at_run: string | null; computed_at: string | null } {
  const r = fact.result as { graph_hash_at_run?: unknown; computed_at?: unknown };
  return {
    graph_hash_at_run: typeof r.graph_hash_at_run === 'string' ? r.graph_hash_at_run : null,
    computed_at: typeof r.computed_at === 'string' ? r.computed_at : null,
  };
}

export async function applicableMethod(read: ReadScenarioRunAnalysisFacts | undefined, scenarioId: string): Promise<ToolResult> {
  if (read === undefined) return unavailable();
  try {
    const page = await read(scenarioId, APPLICABLE_METHOD_FACT_WINDOW);
    const [newest, ...prior] = page.facts;
    const fact = newest?.fact;
    if (fact === undefined || fact.fact_type !== 'run_analysis') {
      return {
        ok: true, mutated: false, method: null,
        why_none: 'No analysis has run on this model yet, so no method has been selected. A method is chosen from what the analysis shows.',
      };
    }
    const analysisFact = fact as RunAnalysisHandlerFact;
    const availability = liveLensExecutorAvailability();
    const ranking = rankInterventions(analysisFact, {
      ...availability,
      previousAnalysisLens: derivePreviousAnalysisLens(prior.map((p) => p.fact), availability),
    });
    const analysis = analysisIdentity(analysisFact);
    const chosen = ranking.chosen;
    if (chosen === null) {
      return {
        ok: true, mutated: false, method: null, analysis,
        why_none: 'The latest analysis gives no signal that a structured method would change the picture right now. Do not propose one.',
        not_applicable: ranking.ineligible.map((i) => ({ method: i.lens, reason: i.reason })),
      };
    }
    const dsk = LENS_DSK_PROVENANCE[chosen.lens];
    const provenance = dsk === undefined ? null : resolveDskProtocolProvenance(dsk.protocolId);
    const protocol = dsk === undefined ? null : protocolRecord(dsk.protocolId);
    const expectedOutputs = (protocol?.expected_outputs ?? []).filter((o) => typeof o === 'string' && o.length > 0);
    return {
      ok: true, mutated: false, analysis,
      method: {
        id: chosen.lens,
        title: chosen.title,
        why: chosen.body,
        how_to_open: METHOD_OPENING_GUIDANCE,
        ...(chosen.subjectRef !== undefined ? { subject_factor_id: chosen.subjectRef.id } : {}),
        science: provenance !== null && protocol !== null
          ? {
              ...provenance,
              ...(expectedOutputs.length > 0 ? { expected_outputs: expectedOutputs } : {}),
              closing_questions: literalProtocolSteps(protocol),
            }
          : null,
      },
      also_eligible: ranking.candidates.filter((c) => c.lens !== chosen.lens).map((c) => c.lens),
    };
  } catch (err) {
    log.warn(
      {
        event: 'agent_lane.applicable_method_unavailable',
        scenario_id: scenarioId,
        error_code: (err as { code?: unknown } | null)?.code ?? null,
        err: String(err),
      },
      'agent-lane: method gate read failed — returning a refusal, not failing the turn',
    );
    return unavailable();
  }
}
