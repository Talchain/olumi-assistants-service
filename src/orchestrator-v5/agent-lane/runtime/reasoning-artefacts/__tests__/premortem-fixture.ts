import { readFileSync } from 'node:fs';
import { computeAnalysisAffectingGraphHash } from '../../../../context/graph-hash.js';
import { methodTurnForReadback, planPickChipId, type RunMethodTurn } from '../../../method-turn/method-turn.js';
import { premortemWorksheetFor, type PremortemRead } from '../premortem.js';

export const captures = JSON.parse(readFileSync(new URL('../../../method-turn/__tests__/fixtures/scout-premortem-paths.json', import.meta.url), 'utf8')) as Record<'draw1' | 'draw2', {
  graph: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[]; goal_constraints?: unknown };
  analysisState: Record<string, unknown>; analysisResult: Record<string, unknown>; analysisReady: unknown; optionParticipation: unknown;
}>;
export const OPTION = 'raise_prices_by_10';
export const LINK = 'price_rise_mrr_uplift->monthly_recurring_revenue';
export const FAILURE = 'Price-rise MRR uplift stalled and monthly recurring revenue fell.';
export const WARNING = 'New subscriptions slowed.';
export const MITIGATION = 'Ask customers about renewal concerns.';
export const ONE_STORY_REPLY = `Imagine the plan went badly.\n1. ${FAILURE} Watch for: ${WARNING} Mitigate: ${MITIGATION}\nOutside the model: what could blindside this work?`;
export const REPLY = `Imagine the plan went badly.\n1. ${FAILURE} Watch for: ${WARNING} Mitigate: ${MITIGATION}\n2. Price-rise MRR uplift faded and monthly recurring revenue fell. Watch for: Renewals slowed. Mitigate: Speak to customers.\nOutside the model: what could blindside this work?`;
export function fixture() {
  const c = structuredClone(captures.draw1);
  c.graph.nodes.find(n => n.id === OPTION)!.label = 'Raise prices';
  const graphHash = computeAnalysisAffectingGraphHash(c.graph as never)!;
  c.analysisResult = { ...c.analysisResult, type: 'analysis_result', computed_against_hash: graphHash };
  const read: PremortemRead = { ...c, graphHash };
  const turn = methodTurnForReadback(planPickChipId(OPTION), read);
  if (turn?.kind !== 'run') throw new Error('fixture must run');
  return { read, turn: turn as RunMethodTurn };
}
export const candidate = () => ({
  option_id: OPTION, story_index: 1, failure_way: FAILURE, early_warning: WARNING, mitigation: MITIGATION,
  grounding: { kind: 'link', ids: [LINK] },
  risk: { label: 'Price-rise MRR uplift stalled', affected_node_id: 'monthly_recurring_revenue', direction: 'negative' },
});
export const secondCandidate = () => ({
  ...candidate(), story_index: 2,
  failure_way: 'Price-rise MRR uplift faded and monthly recurring revenue fell.', early_warning: 'Renewals slowed.', mitigation: 'Speak to customers.',
  risk: { ...candidate().risk, label: 'Price-rise MRR uplift faded' },
});
export const outside = () => ({
  option_id: OPTION, story_index: null, failure_way: 'An external supplier stopped operating.', early_warning: 'Service updates stopped.',
  grounding: { kind: 'not_in_model' },
  risk: { label: 'external supplier stopped operating', affected_node_id: 'monthly_recurring_revenue', direction: 'negative' },
});
export function worksheet(overrides: Partial<Parameters<typeof premortemWorksheetFor>[0]> = {}) {
  const { read, turn } = fixture();
  return premortemWorksheetFor({ scenarioId: '7a1e2d3c-4b5a-4e6d-9c7b-8a9f0e1d2c01', turnId: 'turn-a2', turn, passed: true, reply: ONE_STORY_REPLY,
    candidates: [candidate()], initial: read, final: read, ...overrides });
}
