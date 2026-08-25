/**
 * Hermetic discrimination for the authenticated, three-scenario live wire.
 * Injected HTTP proves the exact public response contract, ownership A/B,
 * canonical preconditions, post-read immutability and worst-scenario scoring.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  loadCanonicalPrecedenceCase,
  type CanonicalConflictCase,
} from '../scorer/canonical-state-precedence.js';
import {
  AUTHENTICATED_WIRE_ENV,
  loadAuthenticatedWireFixture,
  runAuthenticatedCanonicalPrecedenceWire,
  scoreAuthenticatedWireResponse,
  stripSanctionedResponseSidecars,
} from '../scorer/authenticated-canonical-precedence-wire.js';

const NOW = 1_800_000_000;
const USER_ID = '11111111-1111-4111-8111-111111111111';
const SCENARIO_IDS = [
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
] as const;
const GRAPH_HASH = 'a'.repeat(64);
const SERVICE_BUILD = 'abc1234';

const KASE = loadCanonicalPrecedenceCase(
  'canonical-precedence-case.json',
) as CanonicalConflictCase;

const GRAPH: Readonly<Record<string, unknown>> = {
  nodes: [
    {
      id: 'goal_envelope',
      kind: 'goal',
      label: 'Keep the Northern Hub programme within the approved envelope',
      goal_threshold: 180000,
      goal_threshold_raw: 180000,
      goal_threshold_unit: '£',
    },
    { id: 'opt_phased', kind: 'option', label: 'Phased launch' },
    { id: 'opt_full', kind: 'option', label: 'Full launch' },
    { id: 'opt_defer', kind: 'option', label: 'Defer launch' },
    {
      id: 'factor_delivery_team',
      kind: 'factor',
      label: 'Delivery team size',
      observed_state: { value: 40, raw_value: 40, unit: 'people' },
    },
    {
      id: 'risk_regulatory_confirmation',
      kind: 'risk',
      label: 'Regulatory confirmation timing',
    },
  ],
  edges: [],
  goal_constraints: [
    {
      constraint_id: 'constraint_budget',
      node_id: 'goal_envelope',
      operator: '<=',
      value: 180000,
      label: 'Budget must not exceed £180,000',
      source_quote: 'The board approved a maximum Northern Hub programme envelope of £180,000 on 12 August.',
    },
    {
      constraint_id: 'constraint_regulatory',
      node_id: 'risk_regulatory_confirmation',
      operator: '<=',
      value: 1,
      label: 'Regulatory confirmation required by 15 March',
      source_quote: 'Do not begin the launch before written regulatory confirmation is received by 15 March.',
    },
  ],
};

const ANALYSIS_STATE: Readonly<Record<string, unknown>> = {
  run_state: {
    kind: 'complete_stale',
    computed_at: '2026-08-25T08:00:00.000Z',
    cause: 'graph_changed',
  },
  readiness: {
    status: 'needs_user_input',
    blockers: [
      {
        code: 'REGULATORY_CONFIRMATION_REQUIRED',
        category: 'missing_input',
        message: 'Validate the written regulatory confirmation by 15 March',
        repairability: 'user_input',
        factor_id: 'risk_regulatory_confirmation',
        factor_label: 'Regulatory confirmation timing',
      },
    ],
  },
  leader_claim: { permitted: false, withheld_reason: 'analysis_stale' },
  robustness: {},
  usable_for_prose: true,
  usable_for_chips: false,
  usable_for_followup: false,
  requires_rerun: true,
  blocked_unusable: false,
  contradictions: [],
};

const CORRECT_ANSWER = [
  'Saved target: 180000 £',
  'Saved constraints: Budget must not exceed £180,000; Regulatory confirmation required by 15 March',
  'Accepted change: Updated Delivery team size from 25 people to 40 people.',
  'Unresolved: Validate the written regulatory confirmation by 15 March',
  'Evidence basis: The board approved a maximum Northern Hub programme envelope of £180,000 on 12 August.',
  'Analysis status: stale',
  'Standing constraint: Bluebird remains valid through 17 September.',
  'Not current: £350,000; 30 June; Harbour East selected; supplier assurance complete; Harbour East leads',
].join('\n');

function jwt(payload: Readonly<Record<string, unknown>> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    sub: USER_ID,
    role: 'authenticated',
    exp: NOW + 3600,
    ...payload,
  })).toString('base64url');
  return `${header}.${claims}.unverified-test-signature`;
}

function env(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    ORCHESTRATOR_EVAL_LIVE_CANDIDATES: '1',
    [AUTHENTICATED_WIRE_ENV.baseUrl]: 'https://cee.example.test',
    [AUTHENTICATED_WIRE_ENV.assistKey]: 'test-assist-key',
    [AUTHENTICATED_WIRE_ENV.userJwt]: jwt(),
    [AUTHENTICATED_WIRE_ENV.scenarioIds]: SCENARIO_IDS.join(','),
    [AUTHENTICATED_WIRE_ENV.expectedGraphIdentity]: GRAPH_HASH,
    ...overrides,
  };
}

function graphEnvelope(
  scenarioId: string,
  graph: unknown = GRAPH,
  analysisState: unknown = ANALYSIS_STATE,
): Readonly<Record<string, unknown>> {
  return {
    schema: 'scenario_graph.v1',
    scenario_id: scenarioId,
    graph,
    graph_present: true,
    graph_identity_hash: {
      kind: 'graph_identity_hash',
      value: GRAPH_HASH,
      algorithm: 'sha256',
      projection_version: 'identity.v1',
      graph_schema_version: 'graph_v3',
      normaliser_version: '1',
    },
    analysis_state: analysisState,
    analysis_result: null,
  };
}

function wire(
  assistantText = CORRECT_ANSWER,
  additions: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'analyse',
    ...additions,
  };
}

function response(body: unknown, status = 200, serviceBuild = SERVICE_BUILD): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'x-olumi-service': 'cee',
      'x-olumi-service-build': serviceBuild,
    },
  });
}

interface FetchOptions {
  readonly anonymousStatus?: 401 | 404;
  readonly bearerRefusalScenario?: string;
  readonly preEnvelope?: (scenarioId: string) => Readonly<Record<string, unknown>>;
  readonly postEnvelope?: (scenarioId: string) => Readonly<Record<string, unknown>>;
  readonly turnBody?: (scenarioId: string) => Readonly<Record<string, unknown>>;
  readonly serviceBuild?: (call: number) => string;
}

function makeFetch(options: FetchOptions = {}) {
  const bearerReads = new Map<string, number>();
  let modelTurns = 0;
  let call = 0;
  const fetchImpl = vi.fn(async (
    input: string | URL,
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> => {
    call += 1;
    const url = new URL(input);
    const headers = init?.headers as Readonly<Record<string, string>> | undefined;
    const bearer = headers?.Authorization;
    const build = options.serviceBuild?.(call) ?? SERVICE_BUILD;
    if (url.pathname.endsWith('/graph')) {
      const scenarioId = url.pathname.split('/')[4]!;
      if (bearer === undefined) {
        const status = options.anonymousStatus ?? 404;
        return response({ error: status === 404 ? 'NOT_FOUND' : 'UNAUTHENTICATED' }, status, build);
      }
      if (scenarioId === options.bearerRefusalScenario) {
        return response({ error: 'NOT_FOUND' }, 404, build);
      }
      const read = (bearerReads.get(scenarioId) ?? 0) + 1;
      bearerReads.set(scenarioId, read);
      const body = read === 1
        ? options.preEnvelope?.(scenarioId) ?? graphEnvelope(scenarioId)
        : options.postEnvelope?.(scenarioId) ?? graphEnvelope(scenarioId);
      return response(body, 200, build);
    }
    if (url.pathname === '/orchestrate/v2/turn') {
      modelTurns += 1;
      const body = JSON.parse(String(init?.body)) as { scenario_id: string };
      return response(options.turnBody?.(body.scenario_id) ?? wire(), 200, build);
    }
    return response({ error: 'unexpected path' }, 404, build);
  });
  return { fetchImpl, modelTurns: () => modelTurns };
}

function mutateGraph(
  mutate: (graph: Record<string, unknown>) => void,
): Readonly<Record<string, unknown>> {
  const graph = structuredClone(GRAPH) as Record<string, unknown>;
  mutate(graph);
  return graph;
}

function mutateAnalysis(
  mutate: (analysis: Record<string, unknown>) => void,
): Readonly<Record<string, unknown>> {
  const analysis = structuredClone(ANALYSIS_STATE) as Record<string, unknown>;
  mutate(analysis);
  return analysis;
}

describe('published response and visible-answer boundary', () => {
  it('parses the real minimal six-field direct-answer shape and only strips sanctioned sidecars', () => {
    const delivered = wire(CORRECT_ANSWER, {
      _timings: { total_ms: 1 },
      _diagnostic_trace: { route: 'test' },
      _context_summary: { graph_present: true },
      _reasoning: 'diagnostic-only',
      _answer_shape: { kind: 'text' },
      _grounded_selection: [],
    });
    expect(Object.keys(stripSanctionedResponseSidecars(delivered)).sort()).toEqual([
      'assistant_text',
      'blocks',
      'insights',
      'response_version',
      'stage_indicator',
      'suggested_actions',
    ]);
    expect(scoreAuthenticatedWireResponse(KASE, delivered)).toMatchObject({
      pass: true,
      answer_kind: 'text_only',
    });
  });

  it('rejects published error/mutation carriers and mutation bytes hidden in a stripped sidecar', () => {
    const mutants = [
      wire(CORRECT_ANSWER, {
        blocks: [{ type: 'error', error_code: 'UPSTREAM_TIMEOUT', severity: 'error' }],
      }),
      wire(CORRECT_ANSWER, {
        blocks: [{
          type: 'graph_patch',
          status: 'applied',
          operation: 'set_factor_value',
          target_id: 'factor_delivery_team',
          before: { value: 25 },
          after: { value: 40 },
        }],
      }),
      wire(CORRECT_ANSWER, { _diagnostic_trace: { graph_patch: { status: 'applied' } } }),
    ];
    for (const mutant of mutants) {
      expect(scoreAuthenticatedWireResponse(KASE, mutant).pass).toBe(false);
    }
  });
});

describe('fail-closed plan and authenticated ownership', () => {
  it('makes no request when opt-ins, scenario independence, cap, fixture or anti-priming fail', async () => {
    const primed = structuredClone(KASE);
    primed.question = `${primed.question} 180000`;
    const cases = [
      { argv: [] as string[], liveEnv: env() },
      {
        argv: ['--live'],
        liveEnv: env({
          [AUTHENTICATED_WIRE_ENV.scenarioIds]: [SCENARIO_IDS[0], SCENARIO_IDS[0], SCENARIO_IDS[2]].join(','),
        }),
      },
      { argv: ['--live', '--max-turns', '11'], liveEnv: env() },
      {
        argv: ['--live'],
        liveEnv: env(),
        fixture: { ...loadAuthenticatedWireFixture(), user_id: USER_ID },
      },
      { argv: ['--live'], liveEnv: env(), kase: primed },
    ];
    for (const kase of cases) {
      const fetchImpl = vi.fn(async () => response({}));
      await expect(runAuthenticatedCanonicalPrecedenceWire({
        argv: kase.argv,
        env: kase.liveEnv,
        fixture: kase.fixture,
        kase: kase.kase,
        fetchImpl,
        nowSeconds: NOW,
      })).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it('proves three owner A/B pairs, one turn each, no user_id and exact report binding', async () => {
    const { fetchImpl, modelTurns } = makeFetch();
    const report = await runAuthenticatedCanonicalPrecedenceWire({
      argv: ['--live'],
      env: env(),
      fetchImpl,
      nowSeconds: NOW,
      randomId: () => '55555555-5555-4555-8555-555555555555',
    });
    expect(report).toMatchObject({
      status: 'PASS',
      aggregation: 'worst_scenario_any_failure',
      n: 3,
      scenario_ids: SCENARIO_IDS,
      scenario_independence: 'three_distinct_preprovisioned_scenarios',
      ownership_preflight: 'anonymous_404_then_same_scenario_bearer_200',
      canonical_preflight: 'all_three_graph_and_analysis_anchors_exact',
      question_self_priming: 'none_of_scored_canaries_present',
      served_cee_build: SERVICE_BUILD,
      graph_unchanged: true,
      planned_model_turns: 3,
      planned_provider_attempt_ceiling: 12,
    });
    expect(report.observations.map((row) => row.scenario_id)).toEqual(SCENARIO_IDS);
    expect(report.observations.every((row) => row.anonymous_status === 404)).toBe(true);
    expect(modelTurns()).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(12);

    for (const call of fetchImpl.mock.calls) {
      const init = call[1];
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).not.toHaveProperty('user_id');
      expect(JSON.stringify(body)).not.toContain('user_id');
    }
    for (const index of [0, 2, 4]) {
      const headers = fetchImpl.mock.calls[index]![1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    }
    for (const index of [1, 3, 5, 6, 7, 8, 9, 10, 11]) {
      const headers = fetchImpl.mock.calls[index]![1]?.headers as Record<string, string>;
      expect(headers.Authorization).toMatch(/^Bearer /u);
    }
  });

  it('rejects guest-compatible anonymous 401 and a forged claim when the bearer route refuses it', async () => {
    const guestCompatible = makeFetch({ anonymousStatus: 401 });
    await expect(runAuthenticatedCanonicalPrecedenceWire({
      argv: ['--live'],
      env: env(),
      fetchImpl: guestCompatible.fetchImpl,
      nowSeconds: NOW,
    })).rejects.toThrow(
      /anonymous scenario-graph ownership preflight returned HTTP 401; expected 404/u,
    );
    expect(guestCompatible.fetchImpl).toHaveBeenCalledTimes(1);
    expect(guestCompatible.modelTurns()).toBe(0);

    const { fetchImpl, modelTurns } = makeFetch({ bearerRefusalScenario: SCENARIO_IDS[0] });
    await expect(runAuthenticatedCanonicalPrecedenceWire({
      argv: ['--live'],
      env: env(),
      fetchImpl,
      nowSeconds: NOW,
    })).rejects.toThrow(/authenticated scenario-graph read returned HTTP 404/u);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(modelTurns()).toBe(0);
  });
});

const PRE_MODEL_ANCHOR_MUTANTS: ReadonlyArray<readonly [
  string,
  (scenarioId: string) => Readonly<Record<string, unknown>>,
]> = [
  [
    'goal target',
    (scenarioId) => graphEnvelope(scenarioId, mutateGraph((graph) => {
      const goal = (graph.nodes as Array<Record<string, unknown>>)[0]!;
      delete goal.goal_threshold;
      delete goal.goal_threshold_raw;
      delete goal.goal_threshold_unit;
    })),
  ],
  [
    'option identity and label',
    (scenarioId) => graphEnvelope(scenarioId, mutateGraph((graph) => {
      (graph.nodes as Array<Record<string, unknown>>)[1]!.label = 'Stale phased label';
    })),
  ],
  [
    'constraint identity, label and source quote',
    (scenarioId) => graphEnvelope(scenarioId, mutateGraph((graph) => {
      (graph.goal_constraints as Array<Record<string, unknown>>)[0]!.source_quote = 'stale quote';
    })),
  ],
  [
    'accepted-change current factor value',
    (scenarioId) => graphEnvelope(scenarioId, mutateGraph((graph) => {
      (graph.nodes as Array<Record<string, unknown>>)[4]!.observed_state = {
        value: 41,
        // `readFactorValueView` defines observed `value` as authoritative. A
        // stale compact/raw mirror must not make this preflight pass.
        raw_value: 40,
        unit: 'people',
      };
    })),
  ],
  [
    'complete-stale run state',
    (scenarioId) => graphEnvelope(scenarioId, GRAPH, mutateAnalysis((analysis) => {
      analysis.run_state = { kind: 'complete_current', computed_at: '2026-08-25T08:00:00.000Z' };
      analysis.requires_rerun = false;
    })),
  ],
  [
    'readiness status',
    (scenarioId) => graphEnvelope(scenarioId, GRAPH, mutateAnalysis((analysis) => {
      (analysis.readiness as Record<string, unknown>).status = 'ready';
    })),
  ],
  [
    'unresolved blocker message',
    (scenarioId) => graphEnvelope(scenarioId, GRAPH, mutateAnalysis((analysis) => {
      const readiness = analysis.readiness as { blockers: Array<Record<string, unknown>> };
      readiness.blockers[0]!.message = 'Stale blocker';
    })),
  ],
];

describe('canonical non-vacuity before any model call', () => {
  it.each(PRE_MODEL_ANCHOR_MUTANTS)('rejects a wrong %s', async (_name, mutant) => {
    const { fetchImpl, modelTurns } = makeFetch({
      preEnvelope: (scenarioId) => scenarioId === SCENARIO_IDS[0]
        ? mutant(scenarioId)
        : graphEnvelope(scenarioId),
    });
    await expect(runAuthenticatedCanonicalPrecedenceWire({
      argv: ['--live'],
      env: env(),
      fetchImpl,
      nowSeconds: NOW,
    })).rejects.toThrow();
    expect(modelTurns()).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects non-identical provisioned graphs even when scored anchors and hashes match', async () => {
    const { fetchImpl, modelTurns } = makeFetch({
      preEnvelope: (scenarioId) => graphEnvelope(
        scenarioId,
        scenarioId === SCENARIO_IDS[1]
          ? mutateGraph((graph) => { graph.presentation = { zoom: 1 }; })
          : GRAPH,
      ),
    });
    await expect(runAuthenticatedCanonicalPrecedenceWire({
      argv: ['--live'],
      env: env(),
      fetchImpl,
      nowSeconds: NOW,
    })).rejects.toThrow(/do not share identical canonical anchors/u);
    expect(modelTurns()).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});

describe('worst-scenario and post-read invariants', () => {
  it('a stale-conversation answer reverses precedence and fails the report', async () => {
    const stale = CORRECT_ANSWER.replace('Saved target: 180000 £', 'Saved target: 350000 £');
    const { fetchImpl } = makeFetch({
      turnBody: (scenarioId) => wire(scenarioId === SCENARIO_IDS[1] ? stale : CORRECT_ANSWER),
    });
    const report = await runAuthenticatedCanonicalPrecedenceWire({
      argv: ['--live'],
      env: env(),
      fetchImpl,
      nowSeconds: NOW,
    });
    expect(report.status).toBe('FAIL');
    expect(report.observations.map((row) => row.score.pass)).toEqual([true, false, true]);
  });

  it('fails on post-turn graph drift and independently on a served-build change', async () => {
    const graphDrift = makeFetch({
      postEnvelope: (scenarioId) => graphEnvelope(
        scenarioId,
        scenarioId === SCENARIO_IDS[0]
          ? mutateGraph((graph) => { graph.presentation = { zoom: 2 }; })
          : GRAPH,
      ),
    });
    await expect(runAuthenticatedCanonicalPrecedenceWire({
      argv: ['--live'],
      env: env(),
      fetchImpl: graphDrift.fetchImpl,
      nowSeconds: NOW,
    })).rejects.toThrow(/canonical graph or analysis anchors changed/u);

    const buildDrift = makeFetch({ serviceBuild: (call) => call === 7 ? 'def5678' : SERVICE_BUILD });
    await expect(runAuthenticatedCanonicalPrecedenceWire({
      argv: ['--live'],
      env: env(),
      fetchImpl: buildDrift.fetchImpl,
      nowSeconds: NOW,
    })).rejects.toThrow(/service build identity changed/u);
  });
});
