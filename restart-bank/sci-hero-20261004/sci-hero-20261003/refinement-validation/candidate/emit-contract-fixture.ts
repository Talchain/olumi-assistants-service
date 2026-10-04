import { readFileSync, writeFileSync } from 'node:fs';
import { tippingPointCoachingFor, tippingPointRefinementFor } from './src/orchestrator-v5/agent-lane/tipping-point-coaching.js';
import { parseRequestExtensions } from './src/orchestrator-v5/boundary/request-extensions.js';
import { buildGraphLookup } from './src/orchestrator-v5/routing/graph-lookup-adapter.js';
import { extractQuantities } from './src/orchestrator-v5/context/cqe/extract-quantities.js';
import { tryDeterministicValueUpdate } from './src/orchestrator-v5/routing/deterministic-value-update.js';
import { typedApprovalOf } from './src/orchestrator-v5/agent-lane/approval-chips.js';
import type { RunExplanationRead } from './src/orchestrator-v5/agent-lane/run-explanation.js';

const positive = JSON.parse(readFileSync(new URL('./tests/fixtures/cross-service/b5-per-limit/0e19bb82.served-turn.json', import.meta.url), 'utf8'));
const scenarioId = 'sci-tipping-interaction-contract';
const read: RunExplanationRead = { graphHash: positive.graph_hash,
  analysisResult: { type: 'analysis_result', computed_against_hash: positive.graph_hash, enrichment: positive.enrichment },
  analysisState: { run_state: { kind: 'complete_current', computed_at: '2026-10-03T00:00:00.000Z' },
    leader_claim: { permitted: false, withheld_reason: 'goal_scope_unresolved' } } };
const entry = tippingPointRefinementFor(scenarioId, read);
if (!entry) throw new Error('Missing real science fixture');
const request = { graph_state: positive.graph,
  selected_elements: [{ id: entry.factor_id, kind: 'node' }] };
const parsed = parseRequestExtensions(request, 'sci-integrator-fixture');
if (!parsed.ok) throw new Error('Native parser refused');
const lookup = buildGraphLookup(parsed.value.graphState);
if (lookup.kind !== 'ok') throw new Error('Native graph adapter refused');
const userMessage = 'Set Pro plan price to 56 GBP/month';
const dispatch = tryDeterministicValueUpdate(userMessage, extractQuantities(userMessage), lookup.lookup,
  parsed.value.selectedElements!.node_ids,
  new Set(positive.graph.nodes.filter((n: { kind: string }) => n.kind === 'factor').map((n: { id: string }) => n.id)));
writeFileSync(new URL('../INTEGRATOR-CONTRACT-FIXTURE.json', import.meta.url), JSON.stringify({
  evidence: 'OFFLINE CONTRACT; synthetic Run metadata around inherited served science, no served interaction',
  base_head: '11e8fe24ff289fbbb68e074bba22c89055e9661a', scenario_id: scenarioId,
  canonical_read: read, coaching: tippingPointCoachingFor(scenarioId, read), refinement: entry,
  native_selection_request: request, user_supplied_edit_message: userMessage,
  native_dispatch: dispatch, refinement_decodes_as_approval: typedApprovalOf({ chip: entry.action }) ?? null,
  consumer_limit: 'V5 helpers exercised; agent-v1-turn.ts has no selected_elements consumer. Do not expose the chip until the route owner connects an existing factor-ID path.',
}, null, 2) + '\n');
