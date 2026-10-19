/**
 * ⭐ STEP 8's ROW (replay for DL-3, 19 Oct; RED on staging d2cb10ef and 743d67d2, GREEN with the binder's own-rate rule).
 * The served SYSTEM 2 draft cfa31dfb for the capacity brief:
 * "Each additional specialist resolves about 20 tickets per week, between 10 and 30." The user's rate must reach the Run's PLoT
 * request as THEIRS: +1 specialist moves "Additional specialist capacity" by 20 tickets per week (their 10–30 kept), on whichever
 * carrier admission keeps (the direct link, or the product evaluated with the rate). Before, the link was an `olumi_placeholder`
 * (0.5 on frames 20 → 500: natural 12.5) and the product is refused ("Additional specialists" is 0 today). Real path:
 * construction → saved bytes → cold snapshot → Run request.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../../../routes/__tests__/fixtures/capacity-cfa31dfb-first-draft.json', import.meta.url), 'utf8')) as { brief: string; raw_text: string };
const SC = 'cd3d9c25-0000-4000-8000-0000000012c2';
const FROM = 'additional_specialists';
const TO = 'additional_specialist_capacity';
const RATE = 'tickets_resolved_per_additional_specialist';

async function runRequestGraph(): Promise<Rec> {
  let saved: Rec | undefined;
  const out = await buildModelFromBrief(SC, FX.brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { saved = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  }) as never, (async () => ({ text: FX.raw_text })) as never) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  const bytes = JSON.stringify(saved);
  const port = { loadGraphAndBriefText: vi.fn(async () => ({ graph: JSON.parse(bytes), briefText: FX.brief, revision: 2 })), readMostRecentPendingActions: vi.fn(async () => []) };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SC, 'req-rate', port as never);
  let payload: Rec | undefined;
  const handler = createRunAnalysisHandler({ plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never, scenarioReader: async () => snapshot,
    probe: async (s) => { payload = s.plotPayload as Rec; } });
  await handler({ context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: SC,
    request_id: 'req-rate', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-rate', scenario_id: SC, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-rate', signal: new AbortController().signal, orientationText: '' } as never);
  expect(payload, 'the Run handler built a PLoT request').toBeDefined();
  return payload!.graph as Rec;
}
/** A node's frame as the request carries it (cap, else scale_frame, else 1). */
const frame = (n: Rec | undefined): number => (n?.observed_state?.cap > 1 ? n.observed_state.cap : n?.scale_frame > 1 ? n.scale_frame : 1);

describe('the user\'s per-specialist rate reaches the Run as theirs (served draft cfa31dfb)', () => {
  it('+1 specialist moves the capacity by the user\'s 20 tickets per week, sized by the user, never Olumi\'s placeholder', async () => {
    const g = await runRequestGraph();
    const node = (id: string): Rec | undefined => (g.nodes as Rec[]).find((n) => n.id === id);
    const link = (g.edges as Rec[]).find((e) => e.from === FROM && e.to === TO);
    const product = node(TO)?.nonlinear_identity;
    const viaProduct = product?.operation === 'product' && [FROM, RATE].every((id) => product.factor_ids?.includes(id))
      && node(RATE)?.observed_state?.raw_value === 20;
    const viaLink = link !== undefined && link.provenance?.magnitude === 'user_stated'
      && Math.abs((link.strength.mean * frame(node(TO))) / frame(node(FROM)) - 20) < 1e-9;
    expect({ viaProduct, viaLink, link: link && { mean: link.strength.mean, magnitude: link.provenance?.magnitude, natural: (link.strength.mean * frame(node(TO))) / frame(node(FROM)) } })
      .toMatchObject(viaProduct ? { viaProduct: true } : { viaLink: true });
  });
});
