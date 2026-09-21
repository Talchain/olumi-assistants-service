/**
 * ADDITIVE-WIRE CONTROL — capture the finaliser's output for a fixed
 * healthy-turn input, as JSON, with the one non-deterministic field
 * (`analysis_ready.computed_at`, stamped from `Date.now()` when the
 * freshness derivation carries no fact timestamp) normalised.
 *
 * WHY THIS EXISTS. `analysis_state` (schemas 0.46.0) is added to the turn
 * envelope beside `analysis_ready`. The claim the PR must prove is not "the
 * new key parses" but "a consumer that ignores the new key sees BYTE-IDENTICAL
 * behaviour". A claim of that shape needs a control taken on the OTHER tree:
 * run this at the PR base (staging tip, schemas 0.44.0), run it at the PR head,
 * delete `analysis_state` from the head capture, and diff. Anything other than
 * an empty diff refutes the additive claim.
 *
 * It is deliberately a script and not a test: a test comparing head against a
 * checked-in fixture proves only that the fixture and the head agree, and the
 * fixture is written by the same lane that writes the code. The control has to
 * be MEASURED on a tree that does not contain the change.
 *
 *   pnpm exec tsx scripts/capture-finalised-healthy-turn.ts > capture.json
 */

import { finaliseV5Response } from '../src/orchestrator-v5/response-finaliser.js';
import type { AnalysisReadyPayload } from '../src/orchestrator-v5/compose/analysis-ready-emit.js';
import type { FreshnessDerivation } from '../src/orchestrator-v5/context/freshness.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';

const readiness: AnalysisReadyPayload = {
  status: 'ready',
  goal_node_id: 'goal_productivity',
  options: [
    {
      option_id: 'opt_status_quo',
      label: 'Make No New Hire (Status Quo)',
      status: 'ready',
      interventions: { fac_role_type: 0, fac_headcount: 0 },
      is_baseline: true,
    },
    {
      option_id: 'opt_tech_lead',
      label: 'Hire a Tech Lead',
      status: 'ready',
      interventions: { fac_role_type: 1, fac_headcount: 0.2 },
    },
  ],
};

const freshness: FreshnessDerivation = {
  freshness: 'fresh',
  reason: 'graph_hash_match',
  selected_fact_index: 0,
  graph_hash_at_run: 'abc123',
  current_graph_hash: 'abc123',
  computed_at: '2026-08-16T12:00:00.000Z',
};

const response = {
  response_version: 2,
  assistant_text: 'Hiring a tech lead scores highest on the modelled goal.',
  stage_indicator: 'analyse',
  blocks: [
    {
      // The WIRE block shape, so the capture is a body that could actually
      // ship (`type`, not the CEE-internal `block_type`).
      type: 'analysis_result',
      summary: 'Comparison complete',
      leading_option_id: 'opt_tech_lead',
      enrichment: {
        robustness: {
          level: 'high',
          near_tie: { is_tie: false, gap: 0.19 },
        },
      },
    },
  ],
  suggested_actions: [],
  insights: [],
} as unknown as OlumiResponse;

const finalised = finaliseV5Response(response, {
  analysisReady: readiness,
  freshness,
  // Fields below are ignored by a base-tree finaliser (it does not declare
  // them) and consumed by the head-tree finaliser. Passing them in BOTH runs
  // is what makes the diff a statement about the emission, not about the
  // inputs.
  mayNameLeadingOption: true,
} as Parameters<typeof finaliseV5Response>[1]);

const asRecord = JSON.parse(JSON.stringify(finalised)) as Record<string, unknown>;
const ready = asRecord.analysis_ready as Record<string, unknown> | undefined;
if (ready && typeof ready.computed_at === 'string') {
  ready.computed_at = '<normalised>';
}

process.stdout.write(`${JSON.stringify(asRecord, null, 2)}\n`);
