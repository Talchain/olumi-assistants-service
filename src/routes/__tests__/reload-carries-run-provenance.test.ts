/**
 * THE PROVISIONAL MARKER REACHES THE BROWSER ON THE RELOAD READ.
 *
 * `enrichment.run_provenance` is stamped on the persisted fact of a run the
 * SERVER started (context/run-initiator.ts). Until schemas 0.58.0 the transport
 * keep-list stripped it, so an automatic first analysis over machine-authored
 * estimates reached the browser looking exactly like a run the user asked for.
 *
 * This reads through `readScenarioAnalysis` — the leg the `/assist/v1`
 * scenario-graph route serves, and the leg the Agent turn's final readback
 * dispatches to (agent-v1-turn.ts: the response's `analysis_result` IS the
 * graph read's), so one producer serves both paths.
 *
 * Bound by IDENTITY: the stamp comes from the production builder, the
 * construction turn id is derived as the construction derives it, and each
 * presence claim has its absence twin (a user-initiated run carries no key).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnalysisStateV1Schema,
  EnrichmentRunProvenanceSchema,
  OlumiResponseSchema,
} from '@talchain/schemas/boundary';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';

const readRecent = vi.fn();
const readFactsFor = vi.fn();
const readAnalysisInvalidatedAt = vi.fn();
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({ readRecent, readFactsFor, readAnalysisInvalidatedAt }),
}));
vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { readScenarioAnalysis } from '../scenario-graph-analysis-read.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import {
  buildAutoRunProvenance,
  buildConstructionAutoRunProvenance,
  RUN_PROVENANCE_ENRICHMENT_KEY,
} from '../../orchestrator-v5/context/run-initiator.js';
import { P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP } from '../../orchestrator-v5/compose.js';
import { registrationTurnId } from '../../orchestrator-v5/graph-registration/registration-identity.js';
import { constructionOperationId } from '../../orchestrator-v5/agent-lane/runtime/build-model.js';
import type { GraphStateIngress } from '../../orchestrator-v5/boundary/request-extensions.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRIEF = 'Should we raise prices by 10% this quarter or hold them?';
const CONSTRUCTION_TURN_ID = registrationTurnId(SCENARIO, constructionOperationId(SCENARIO, BRIEF));
const GRAPH: GraphStateIngress = {
  nodes: [{ id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.7 }],
  edges: [],
};
const HASH = computeAnalysisAffectingGraphHash(GRAPH)!;
const COMPUTED_AT = '2026-09-24T10:00:03.871Z';

function fact(provenance: object | null) {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO, computed_at: COMPUTED_AT, graph_hash_at_run: HASH,
      leading_option_id: 'option-a', summary: 'Option A leads on the current model.',
      win_probabilities: { 'option-a': 0.65, 'option-b': 0.35 },
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      enrichment: {
        analysis_status: 'completed',
        robustness: {
          level: 'strong',
          near_tie: { is_tie: false, top_option_id: 'option-a', second_option_id: 'option-b', tied_option_ids: [], gap: 0.3, threshold: 0.05 },
        },
        ...(provenance === null ? {} : { [RUN_PROVENANCE_ENRICHMENT_KEY]: provenance }),
      },
    },
  });
}

async function read() {
  const result = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'run-provenance-reload' });
  // Control: the verdict is a real current one, so a served block is a claim about THIS fact.
  expect(AnalysisStateV1Schema.safeParse(result.analysis_state).success).toBe(true);
  expect(result.analysis_state?.run_state).toEqual({ kind: 'complete_current', computed_at: COMPUTED_AT });
  expect(result.analysis_result).not.toBeNull();
  // The whole body parses at the vendored contract, block included.
  expect(OlumiResponseSchema.safeParse({
    response_version: 2, assistant_text: '', stage_indicator: 'analyse',
    blocks: [result.analysis_result], suggested_actions: [], insights: [],
    analysis_state: result.analysis_state,
  }).success).toBe(true);
  return result.analysis_result as { enrichment?: Record<string, unknown>; win_probabilities?: unknown; leading_option_id: string | null };
}

beforeEach(() => {
  vi.clearAllMocks();
  readRecent.mockResolvedValue([{ id: 'turn-row' }]);
  readAnalysisInvalidatedAt.mockResolvedValue(null);
});

describe('reload read: the provisional marker reaches analysis_result.enrichment', () => {
  it('a construction auto-run carries run_provenance {auto_post_construction, provisional, construction_turn_id}', async () => {
    readFactsFor.mockResolvedValue([fact(buildConstructionAutoRunProvenance(CONSTRUCTION_TURN_ID))]);
    const block = await read();
    expect(block.enrichment?.run_provenance).toEqual({
      initiated_by: 'auto_post_construction',
      provisional: true,
      construction_turn_id: CONSTRUCTION_TURN_ID,
    });
    // …and a consumer reads it TYPED, at the MEMBER. ⚠ Not via the whole
    // envelope: on this very block `AnalysisEnrichmentSchema.safeParse` FAILS,
    // because the unrequested-run confinement strips `robustness.near_tie`'s
    // option identity (`top_option_id`, `second_option_id`, `tied_option_ids`),
    // which EnrichmentNearTieSchema requires. A whole-envelope reader would
    // therefore never see the marker on exactly the blocks that carry it.
    const member = EnrichmentRunProvenanceSchema.safeParse(block.enrichment?.run_provenance);
    expect(member.success && member.data.provisional).toBe(true);
    expect(member.success && member.data.construction_turn_id).toBe(CONSTRUCTION_TURN_ID);
  });

  it('and it is still CONFINED: no ranking, no leader — the marker labels a run the confinement already treats as unrequested', async () => {
    readFactsFor.mockResolvedValue([fact(buildConstructionAutoRunProvenance(CONSTRUCTION_TURN_ID))]);
    const block = await read();
    expect(block.leading_option_id).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(block, 'win_probabilities')).toBe(false);
  });

  it('a post-draft auto-run carries its own marker the same way', async () => {
    readFactsFor.mockResolvedValue([fact(buildAutoRunProvenance('draft-turn-abc'))]);
    const block = await read();
    expect(block.enrichment?.run_provenance).toEqual({
      initiated_by: 'auto_post_draft',
      provisional: true,
      draft_turn_id: 'draft-turn-abc',
    });
  });

  it('CONTRAST: a user-initiated run carries NO run_provenance key — and keeps its ranking and leader', async () => {
    readFactsFor.mockResolvedValue([fact(null)]);
    const block = await read();
    expect(block.enrichment).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(block.enrichment, 'run_provenance')).toBe(false);
    expect(block.leading_option_id).toBe('option-a');
    expect(block.win_probabilities).toEqual({ 'option-a': 0.65, 'option-b': 0.35 });
  });

  it('the key rides the transport keep-list — the ONE line whose removal makes this file red', () => {
    expect(P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP).toContain('run_provenance');
  });
});
