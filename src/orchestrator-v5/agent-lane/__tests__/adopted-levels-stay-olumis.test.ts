/**
 * ⛔ AN OPTION LEVEL IS THE USER'S ONLY WHEN THE USER GAVE IT (RC #69 5830102377 / 5830255884;
 * pre-reviews 5830279122, 5830301003).
 *
 * MEASURED on served CEE `c1ddb50` (RC journey `20260925T093153Z`): every option level one
 * "Use as starting assumptions" wrote came back `source: 'user_specified'` — 5 of 5 hiring
 * cells, 3 of 3 eng-hiring — so the canvas marked Olumi's proposed levels "Set by you"
 * (`valueSourceMark.tsx`). Four seams carried it: the proposal held no per-level author, the
 * authorised event carried only the value, the encoder defaults a cell to `user_specified`,
 * and the writer's scope check demanded that stamp.
 *
 * Pinned here END TO END, by identity: proposal → authorise_change → the REAL
 * `executeOptionInterventionEdit` committing through a serialized store → a cold reread of
 * the durable bytes. Three opposite controls: Olumi's level stays `cee_hypothesis`, a level
 * the user gave is `user_specified`, and the brief's own level keeps `brief_extraction`.
 * Nothing here calls a model or a live service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetConfigCache } from '../../../config/index.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionStore, SessionTurnWrite } from '../../session/store.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { executeOptionInterventionEdit } from '../../system-events/option-intervention-edit.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d';
const USER = 'user-adopt';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'r-adopt' };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const briefLevel = (factorId: string, value: number) => ({
  value, source: 'brief_extraction', target_match: { node_id: factorId, match_type: 'exact_id', confidence: 'high' },
});

/** Hiring, as served: Olumi's baselines, one level the brief stated, two pairs with no level yet. */
function hiring() {
  return projectGraphForPersistence({
    ...GraphV3.parse({
      nodes: [
        { id: 'velocity', kind: 'goal', label: 'Velocity' },
        { id: 'tech_leads_hired', kind: 'factor', label: 'Tech leads hired',
          observed_state: { value: 0, raw_value: 0, cap: 10, unit: 'hires', source: 'cee_inference' } },
        { id: 'developers_hired', kind: 'factor', label: 'Developers hired',
          observed_state: { value: 0.1, raw_value: 2, cap: 20, unit: 'hires', source: 'cee_inference' } },
        { id: 'onboarding_share', kind: 'factor', label: 'Onboarding share',
          observed_state: { value: 0.3, source: 'cee_inference' } },
        { id: 'hire_a_tech_lead', kind: 'option', label: 'Hire a Tech Lead' },
        { id: 'hire_two_developers', kind: 'option', label: 'Hire Two Developers',
          interventions: { developers_hired: briefLevel('developers_hired', 0.2) } },
      ],
      edges: [
        ['hire_a_tech_lead', 'tech_leads_hired'],
        ['hire_two_developers', 'developers_hired'], ['hire_two_developers', 'onboarding_share'],
        ['tech_leads_hired', 'velocity'], ['developers_hired', 'velocity'], ['onboarding_share', 'velocity'],
      ].map(([from, to]) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
    }),
    options: [] as Array<Record<string, unknown>>,
  });
}

/**
 * The product at the dispatch seam, with the REAL level writer behind it. Only serialized bytes
 * survive between calls; `/graph/register` persists through the projection the route applies.
 */
function product(initial: ReturnType<typeof hiring>) {
  let graphJson = JSON.stringify(initial);
  const rows = new Map<string, { id: string; json: string }>();
  const store = (): SessionStore => createMockSessionStore({
    loadGraph: async () => JSON.parse(graphJson),
    readMostRecentPendingActions: async () => [],
    append: async (write: SessionTurnWrite) => {
      const key = `${write.scenario_id}/${write.turn_id}`;
      const prior = rows.get(key);
      if (prior !== undefined) return { id: prior.id };
      const id = `row-${rows.size + 1}`;
      rows.set(key, { id, json: JSON.stringify(write) });
      if (write.graph !== undefined) graphJson = JSON.stringify(write.graph);
      return { id };
    },
    readRecent: async () => [...rows.values()].reverse().map((row) => {
      const w = JSON.parse(row.json) as SessionTurnWrite;
      return makeSessionTurnRow({ id: row.id, scenario_id: w.scenario_id, turn_id: w.turn_id, turn_class: w.turn_class,
        handler_id: w.handler_id, request_hash: w.request_hash, response_emitted: w.response_emitted,
        llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms, assistant_message: w.assistantMessage ?? null });
    }),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap((row) => {
      if (!ids.includes(row.id)) return [];
      return (JSON.parse(row.json) as SessionTurnWrite).handler_facts.map((fact) => ({ turn_id: row.id, fact_created_at: '2026-09-25T00:00:00.000Z', fact }));
    }),
    getScenarioOwner: async () => null,
  });
  const hash = () => computeAnalysisAffectingGraphHash(JSON.parse(graphJson))!;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      if (b.expected_graph_hash !== hash()) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graphJson = JSON.stringify(projectGraphForPersistence((b as { graph: Record<string, unknown> }).graph as never));
      return { status: 200, json: { registered: true, graph_hash: hash() } };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as { kind: string; option_id: string; factor_id: string; value: number; base_graph_hash: string };
      if (ev.kind !== 'option_intervention_edit') return { status: 400, json: {} };
      const out = await executeOptionInterventionEdit({
        optionId: ev.option_id, factorId: ev.factor_id, modelValue: ev.value, expectedGraphHash: ev.base_graph_hash,
        scenarioId: SCENARIO, turnId: String(b.turn_id), requestId: 'r-level', stage: 'frame' as never,
        requestHash: `sha256:${ev.option_id}:${ev.factor_id}:${ev.value}`, freshness: 'none', hasExistingAnalysis: false,
      }, store());
      if (out.kind !== 'committed') return { status: 422, json: { refusal_reason: out.kind === 'unchanged' ? 'unchanged' : out.reason } };
      return { status: 200, json: { assistant_text: 'Recorded.', graph_hash: out.analysisGraphHash } };
    }
    return { status: 200, json: { graph: JSON.parse(graphJson), graph_hash: hash() } };
  };
  /** A COLD reread of the durable bytes — never the candidate a write returned. */
  const cell = (optionId: string, factorId: string) =>
    ((JSON.parse(graphJson) as { nodes: { id: string; interventions?: Record<string, Record<string, unknown>> }[] })
      .nodes.find((n) => n.id === optionId)?.interventions ?? {})[factorId];
  return { d, cell };
}

beforeEach(() => { vi.stubEnv('OLUMI_ENV', 'staging'); _resetConfigCache(); });
afterEach(() => { vi.unstubAllEnvs(); _resetConfigCache(); });

describe('an approved option level carries WHOSE level it is, through the real writer', () => {
  it('RED: Olumi’s proposed level, approved, reads back cee_hypothesis — not "Set by you"', async () => {
    const p = product(hiring());
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: 'Hire a Tech Lead', factor_label: 'Tech leads hired', value: 1, basis: 'one hire' }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(p.cell('hire_a_tech_lead', 'tech_leads_hired')).toMatchObject({ value: 0.1, source: 'cee_hypothesis' });
  });

  it('CONTRAST: a level the USER gave (user_stated) reads back user_specified', async () => {
    const p = product(hiring());
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: 'Hire a Tech Lead', factor_label: 'Tech leads hired', value: 1, basis: 'the user: one hire', user_stated: true }],
    });
    expect((await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) })).ok).toBe(true);
    expect(p.cell('hire_a_tech_lead', 'tech_leads_hired')).toMatchObject({ value: 0.1, source: 'user_specified' });
  });

  it('RED: ONE starting-point approval (values + levels) stamps each level by its own author, and leaves the brief’s level alone', async () => {
    const start = hiring();
    const p = product(start);
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const sp = await caps.proposeStartingPoint(ctx, {
      assumptions: [{ factor_label: 'Onboarding share', value: 0.4, unit: '', basis: 'the user: it is 40%', revise: true } as never],
      option_levels: [
        { option_label: 'Hire a Tech Lead', factor_label: 'Tech leads hired', value: 1, basis: 'one hire' },
        { option_label: 'Hire Two Developers', factor_label: 'Onboarding share', value: 0.45, basis: 'the user: two starters', user_stated: true },
      ],
    });
    expect(sp.ok, JSON.stringify(sp)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(sp.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(p.cell('hire_a_tech_lead', 'tech_leads_hired')).toMatchObject({ value: 0.1, source: 'cee_hypothesis' });
    expect(p.cell('hire_two_developers', 'onboarding_share')).toMatchObject({ value: 0.45, source: 'user_specified' });
    expect(p.cell('hire_two_developers', 'developers_hired')).toEqual(clone(briefLevel('developers_hired', 0.2)));
  });
});
