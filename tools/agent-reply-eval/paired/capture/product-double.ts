/**
 * The product double for the in-process capture: answers the INTERNAL routes the real
 * `agentV1TurnRoute` dispatches to (`app.inject`, never the network).
 *
 * Two modes, per scenario:
 *   · `served` — answers from the SERVED 57f903c captures (post-approve graph, analysis
 *     state/result, readiness). Used for the fast-path-3 explicit-Run captures.
 *   · `store`  — an in-memory scenarios row. Registration applies the SAME pure steps the
 *     real register route applies (node-kind normalisation, GraphStateIngress parse,
 *     `projectGraphForPersistence`, invariant check) and the read returns the stored graph
 *     with the real `computeAnalysisAffectingGraphHash` / `computeGraphIdentityHash`.
 *     Used for the live construction captures.
 *
 * Every internal call is logged (path, body, status) so the fidelity of what the tools saw
 * is inspectable next to the OpenAI requests.
 */
import type { FastifyInstance } from 'fastify';

export interface DoubleDeps {
  normaliseGraphNodeKindField: (g: unknown) => { ok: boolean; graph?: unknown; changedNodeCount?: number; reason?: string };
  GraphStateIngressSchema: { safeParse: (g: unknown) => { success: boolean; data?: unknown; error?: { issues: unknown[] } } };
  projectGraphForPersistence: <T>(g: T, ctx?: Record<string, unknown>) => T;
  computeGraphIdentityHash: (g: never) => unknown;
  computeAnalysisAffectingGraphHash: (g: never) => string | null;
  computeExpectedGraphCasHashes: (g: unknown) => { expectedGraphAnalysisHash: string | null };
  assertNoIntroducedGraphViolations: (p: Record<string, unknown>) => void;
}

export interface ServedScenario {
  mode: 'served';
  graph: Record<string, unknown>;
  graph_hash: string;
  analysis_state: unknown;
  analysis_result: unknown | null;
  /** Present only in the `served-verbatim` fallback; the real read route never sends it. */
  analysis_ready?: unknown;
  /** What the internal conventional Run answers (`/orchestrate/v2/turn`, chip run_analysis). */
  run_response: Record<string, unknown>;
}

export interface StoreScenario {
  mode: 'store';
  graph: Record<string, unknown> | null;
  brief_text: string | null;
  /** The generic never_run state the served read returned right after a build (identical across cases). */
  never_run_analysis_state: unknown;
}

export type DispatchLogEntry = { at: string; path: string; body: unknown; status: number; note?: string };

export class ProductDouble {
  readonly scenarios = new Map<string, ServedScenario | StoreScenario>();
  log: DispatchLogEntry[] = [];
  readonly unexpected: DispatchLogEntry[] = [];

  constructor(private readonly deps: DoubleDeps) {}

  drainLog(): DispatchLogEntry[] { const l = this.log; this.log = []; return l; }

  private record(path: string, body: unknown, status: number, note?: string): void {
    const e = { at: new Date().toISOString(), path, body, status, ...(note ? { note } : {}) };
    this.log.push(e);
    if (note?.startsWith('UNEXPECTED')) this.unexpected.push(e);
  }

  readFor(scenarioId: string): { status: number; json: Record<string, unknown> } {
    const s = this.scenarios.get(scenarioId);
    if (s === undefined) return { status: 404, json: { error: 'NOT_FOUND' } };
    if (s.mode === 'served') {
      return {
        status: 200,
        json: {
          schema: 'scenario_graph.v1',
          scenario_id: scenarioId,
          graph: s.graph,
          graph_present: true,
          graph_identity_hash: this.deps.computeGraphIdentityHash(s.graph as never),
          graph_hash: s.graph_hash,
          analysis_state: s.analysis_state,
          analysis_result: s.analysis_result,
          ...(s.analysis_ready !== undefined ? { analysis_ready: s.analysis_ready } : {}),
        },
      };
    }
    const present = s.graph !== null;
    return {
      status: 200,
      json: {
        schema: 'scenario_graph.v1',
        scenario_id: scenarioId,
        graph: present ? s.graph : null,
        graph_present: present,
        brief_text: s.brief_text,
        graph_identity_hash: present ? this.deps.computeGraphIdentityHash(s.graph as never) : null,
        graph_hash: present ? this.deps.computeAnalysisAffectingGraphHash(s.graph as never) : null,
        // readScenarioAnalysis answers NOT_ANSWERED (nulls) when there is no graph.
        analysis_state: present ? s.never_run_analysis_state : null,
        analysis_result: null,
      },
    };
  }

  mount(app: FastifyInstance): void {
    app.post('/assist/v1/scenarios/:id/graph', async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const r = this.readFor(id);
      this.record(`/assist/v1/scenarios/${id}/graph`, req.body, r.status);
      return reply.code(r.status).send(r.json);
    });

    app.post('/assist/v1/scenarios/:id/versions', async (req, reply) => {
      const id = (req.params as { id: string }).id;
      // A guest scenario has no versions (served construction receipts were []), so the
      // construction-replay lookup finds nothing — exactly the "not found" arm.
      this.record(`/assist/v1/scenarios/${id}/versions`, req.body, 200);
      return reply.code(200).send({ versions: [], next_cursor: null });
    });

    app.post('/assist/v1/scenarios/:id/graph/register', async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const s = this.scenarios.get(id);
      const body = (req.body ?? {}) as { graph?: unknown; brief_text?: unknown; operation_id?: unknown };
      if (s === undefined || s.mode !== 'store') {
        this.record(`/assist/v1/scenarios/${id}/graph/register`, body, 503, 'UNEXPECTED register on a served scenario');
        return reply.code(503).send({ code: 'INTERNAL', message: 'double: register not supported here' });
      }
      const normalised = this.deps.normaliseGraphNodeKindField(body.graph);
      if (!normalised.ok) {
        this.record(`/assist/v1/scenarios/${id}/graph/register`, body, 422, `node kind: ${normalised.reason}`);
        return reply.code(422).send({ code: 'BAD_INPUT', details: { code: 'GRAPH_NODE_KIND_INVALID' } });
      }
      const parsed = this.deps.GraphStateIngressSchema.safeParse(normalised.graph);
      if (!parsed.success) {
        this.record(`/assist/v1/scenarios/${id}/graph/register`, body, 422, 'GRAPH_CONTRACT_INVALID');
        return reply.code(422).send({ code: 'BAD_INPUT', message: 'This model does not match the graph contract.', details: { code: 'GRAPH_CONTRACT_INVALID', issues: parsed.error?.issues.slice(0, 10) } });
      }
      const graphForStore = this.deps.projectGraphForPersistence(parsed.data, { scenarioId: id, turnClass: 'direct_answer', source: 'graph_registration' });
      try {
        this.deps.assertNoIntroducedGraphViolations({
          graph: graphForStore,
          identity: { scenario_id: id, turn_id: 'double-registration', turn_class: 'direct_answer' },
          writesGraph: true,
          baseGraphForInvariants: s.graph,
          source: 'graph_registration',
        });
      } catch (err) {
        this.record(`/assist/v1/scenarios/${id}/graph/register`, body, 422, `GRAPH_INVARIANT_VIOLATION ${String(err).slice(0, 200)}`);
        return reply.code(422).send({ code: 'BAD_INPUT', message: 'This model has a structural problem and was not imported.', details: { code: 'GRAPH_INVARIANT_VIOLATION' } });
      }
      // A JSON round trip, as the jsonb column would do.
      s.graph = JSON.parse(JSON.stringify(graphForStore)) as Record<string, unknown>;
      if (typeof body.brief_text === 'string') s.brief_text = body.brief_text;
      const nodes = (s.graph['nodes'] as unknown[]) ?? [];
      const edges = (s.graph['edges'] as unknown[]) ?? [];
      this.record(`/assist/v1/scenarios/${id}/graph/register`, body, 200);
      // No `model_version`: a guest registration writes none (served construction receipts: []).
      return reply.code(200).send({
        schema: 'scenario_graph_registration.v1',
        scenario_id: id,
        registered: true,
        graph_identity_hash: this.deps.computeGraphIdentityHash(s.graph as never),
        graph_hash: this.deps.computeExpectedGraphCasHashes(s.graph).expectedGraphAnalysisHash,
        node_count: nodes.length,
        edge_count: edges.length,
        kind_fields_normalised: normalised.changedNodeCount ?? 0,
      });
    });

    app.post('/orchestrate/v2/turn', async (req, reply) => {
      const body = (req.body ?? {}) as { scenario_id?: string; chip?: { action_type?: string } };
      const id = String(body.scenario_id ?? '');
      const s = this.scenarios.get(id);
      if (s !== undefined && s.mode === 'served' && body.chip?.action_type === 'run_analysis') {
        this.record('/orchestrate/v2/turn', body, 200, 'served conventional run (approximated from the served readback)');
        return reply.code(200).send(s.run_response);
      }
      // Nothing on the captured paths should reach a write or a run on a store scenario.
      this.record('/orchestrate/v2/turn', body, 503, 'UNEXPECTED internal turn — the double does not implement it');
      return reply.code(503).send({ code: 'INTERNAL', message: 'double: internal turn not implemented' });
    });
  }
}
