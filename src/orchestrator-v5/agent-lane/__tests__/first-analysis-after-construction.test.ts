/**
 * ⭐ A RETRIED CONSTRUCTION GIVES EXACTLY ONE FIRST ANALYSIS (PR-B, test 1).
 *
 * The whole Agent tool (`build_model_from_brief`), the REAL builder and the REAL first-analysis
 * runner, on ONE stateful product double that honours the registration route's contract through
 * the SAME identity functions the route uses (the `construction-retry.test.ts` double, extended).
 * Only the run orchestration is stubbed: each call to it is one PLoT call, and it persists the
 * fact the real dispatcher would — stamped from the trigger the runner actually handed it.
 *
 * The gate under test: the first analysis fires only when the construction COMMITTED IN THIS
 * REQUEST (`built.mutated === true && built.replayed !== true`), with the (construction turn K,
 * revision H) prior fact as defence in depth. Every retry shape must fail that gate.
 */
import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { constructionOperationId, type CallStructuredModel } from '../runtime/build-model.js';
import { registrationRequestHash, registrationTurnId } from '../../graph-registration/registration-identity.js';
import { runFirstAnalysisAfterConstruction } from '../first-analysis.js';
import { RUN_PROVENANCE_ENRICHMENT_KEY } from '../../context/run-initiator.js';
import { READY_GRAPH } from './fixtures/first-analysis-graphs.js';

const SCENARIO = '21111111-1111-4111-8111-111111111111';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'req-1' };
const BRIEF = 'Should we hire a tech lead or two developers to lift delivery reliability?';
/** The construction identity, derived exactly as production derives it — never typed. */
const K = registrationTurnId(SCENARIO, constructionOperationId(SCENARIO, BRIEF));

const candidate = (optionLabel: string) => ({
  goal: { metric: 'Delivery reliability', operator: '>=', value: 90, unit: '%', horizon_months: 6, provenance: 'explicit' },
  constraints: [],
  options: [{ label: optionLabel, provenance: 'explicit', interventions: [] }],
  factors: [{ label: 'Team capacity', role: 'controllable', baseline_known: true, baseline_value: 5, unit: 'people', provenance: 'explicit' }],
  risks: [], outcomes: [{ label: 'Delivery reliability', provenance: 'inferred' }],
  links: [{ from: 'Team capacity', to: 'Delivery reliability', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
});

/**
 * One stateful product: graph, versions, the durable (scenario, turn_id) key, and the run facts.
 * After a construction commits, the persisted model READ BACK is the admissible fixture — the gate
 * under test is the retry gate, so the model must be one the admission would run.
 */
function product(opts: { reportReplay?: boolean; guest?: boolean } = {}) {
  const reportReplay = opts.reportReplay ?? true;
  let registered = false;
  const versions: { version_id: string; sequence: number; creation: { kind: string; mutation_id: string; source_turn_id: string } }[] = [];
  const committed = new Map<string, string>(); // turn_id -> request_hash
  const facts: HandlerFact[] = [];
  const runs: { autoRun: unknown; chipId: unknown }[] = [];
  let revision = 0;
  const hash = () => `rev-${revision}`;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      const turnId = registrationTurnId(SCENARIO, b.operation_id as string | undefined);
      const h = registrationRequestHash(b.graph, typeof b.brief_text === 'string' ? b.brief_text : undefined);
      const priorHash = committed.get(turnId);
      if (priorHash !== undefined) {
        if (priorHash !== h) return { status: 409, json: { details: { code: 'OPERATION_ID_REUSED' } } };
        const v = versions.find((x) => x.creation.source_turn_id === turnId)!;
        registered = true;
        return { status: 200, json: { registered: true, ...(reportReplay ? { replayed: true } : {}), graph_hash: hash(), model_version: { version_id: v.version_id, version_number: v.sequence } } };
      }
      registered = true;
      revision += 1;
      const seq = versions.length + 1;
      const v = { version_id: `00000000-0000-4000-8000-00000000000${seq}`, sequence: seq, creation: { kind: 'initial', mutation_id: `m-${seq}`, source_turn_id: turnId } };
      versions.push(v);
      committed.set(turnId, h);
      return { status: 200, json: { registered: true, graph_hash: hash(), model_version: { version_id: v.version_id, version_number: seq } } };
    }
    if (path.endsWith('/versions')) {
      if (opts.guest === true) return { status: 404, json: {} };
      return { status: 200, json: { versions: [...versions].reverse(), next_cursor: null } };
    }
    if (path === '/orchestrate/v2/turn') {
      // The Agent's own run_analysis goes through the product's turn route: one PLoT call.
      runs.push({ autoRun: undefined, chipId: (b.chip as { id?: unknown } | undefined)?.id });
      return { status: 200, json: { assistant_text: 'Ran.', blocks: [{ type: 'analysis_result', summary: 'x' }], analysis_ready: { status: 'ready' } } };
    }
    const ran = facts.some((f) => (f.result as { graph_hash_at_run?: unknown }).graph_hash_at_run === hash());
    return {
      status: 200,
      json: registered
        ? {
          graph: READY_GRAPH, graph_hash: hash(),
          analysis_state: ran ? { run_state: { kind: 'complete_current', computed_at: '2026-09-24T18:00:00.000Z' }, leader_claim: { permitted: false, withheld_reason: 'auto_initiated' } } : { run_state: { kind: 'never_run' }, leader_claim: { permitted: false } },
          ...(ran ? { analysis_result: { type: 'analysis_result', summary: 'A provisional first pass.' } } : {}),
          analysis_admission: { admitted: true, permitted_analysis_mode: 'quantified_provisional' },
        }
        : { graph: { nodes: [], edges: [] }, graph_hash: 'empty' },
    };
  };
  /** The ONE run orchestration, stubbed: persists the fact the real dispatcher would, from the trigger it was given. */
  const dispatchRunAnalysis = async (args: { payload: { chip?: { id?: string } }; autoRun?: { draftTurnId: string } }) => {
    runs.push({ autoRun: args.autoRun, chipId: args.payload.chip?.id });
    facts.push({
      fact_type: 'run_analysis', fact_id: `f${facts.length}`, fact_version: 1, noop: false,
      result: {
        scenario_id: SCENARIO, graph_hash_at_run: hash(), summary: 'x',
        enrichment: args.autoRun !== undefined ? { [RUN_PROVENANCE_ENRICHMENT_KEY]: { initiated_by: 'auto_post_draft', provisional: true, draft_turn_id: args.autoRun.draftTurnId } } : {},
      },
    } as unknown as HandlerFact);
    return { outcome: 'ok', response: { assistant_text: 'Ran.', blocks: [{ type: 'analysis_result', summary: 'x' }] }, commitPerformed: true, analysisReady: { status: 'ready' }, graph: null, mayNameLeadingOption: false } as never;
  };
  const readPriorFacts = async () => ({ status: 'ok' as const, facts: [...facts] });
  /** Clear the model, keeping its history (a user starting again on the same scenario). */
  const clearModel = () => { registered = false; };
  return { d, versions, runs, facts, dispatchRunAnalysis, readPriorFacts, clearModel };
}

type Product = ReturnType<typeof product>;
/** One Agent request: fresh capabilities, the route's own wiring shape. */
const capsFor = (p: Product, call: CallStructuredModel) => createAgentCapabilities(p.d, new ProposalStore(), call, 'full', undefined, {
  firstAnalysis: (input) => runFirstAnalysisAfterConstruction({
    ...input, deadlineAt: Date.now() + 60_000,
    dispatchRunAnalysis: p.dispatchRunAnalysis as never, readPriorFacts: p.readPriorFacts,
  }),
});
const build = (caps: ReturnType<typeof capsFor>) =>
  dispatchTool('build_model_from_brief', JSON.stringify({ brief: BRIEF }), ctx, caps) as Promise<Record<string, unknown>>;
const autoRuns = (p: Product) => p.runs.filter((r) => r.autoRun !== undefined);

describe('RED: a retried construction turn gives exactly ONE first analysis', () => {
  it('RED: a fresh construction runs the first analysis once, on the Agent chip, and tells the Agent what it found', async () => {
    const p = product();
    const call: CallStructuredModel = async () => ({ text: JSON.stringify(candidate('Hire a tech lead')) });
    const r = await build(capsFor(p, call));
    expect(r.ok, JSON.stringify(r).slice(0, 300)).toBe(true);
    expect(autoRuns(p)).toHaveLength(1);
    expect(autoRuns(p)[0]!.chipId).toBe('agent-run-analysis');
    // Bound to THIS construction's identity (derived above, never typed).
    expect(autoRuns(p)[0]!.autoRun).toEqual({ draftTurnId: K });
    const fa = r.first_analysis as Record<string, unknown>;
    expect(fa).toMatchObject({ ran: true, provisional: true, summary: 'A provisional first pass.' });
    expect(fa.claim_permissions).toEqual({ leader_may_be_named: false, withheld_reason: 'auto_initiated', permitted_analysis_mode: 'quantified_provisional' });
  });

  it('RED: a retry with a NEW turn id and the same brief recovers the construction and runs nothing more', async () => {
    const p = product();
    let generations = 0;
    const call: CallStructuredModel = async () => { generations += 1; return { text: JSON.stringify(candidate('Hire a tech lead')) }; };
    await build(capsFor(p, call));
    const retry = await build(capsFor(p, call));
    expect(retry.replayed, 'the real replay arm (findConstructionVersion)').toBe(true);
    expect(generations).toBe(1);
    expect(autoRuns(p), 'one construction, one first analysis').toHaveLength(1);
    expect(retry.first_analysis, 'a replayed construction carries no first-analysis claim').toBeUndefined();
  });

  it('RED: a concurrent twin generating DIFFERENT bytes (OPERATION_ID_REUSED) runs nothing', async () => {
    const p = product();
    let arrived = 0;
    let release!: () => void;
    const bothIn = new Promise<void>((r) => { release = r; });
    const labels = ['Hire a tech lead', 'Hire one tech lead'];
    const call: CallStructuredModel = async () => {
      const mine = labels[arrived]!;
      arrived += 1;
      if (arrived === 2) release();
      await bothIn;
      return { text: JSON.stringify(candidate(mine)) };
    };
    const [a, b] = await Promise.all([build(capsFor(p, call)), build(capsFor(p, call))]);
    expect(p.versions).toHaveLength(1);
    expect([a.replayed === true, b.replayed === true].filter(Boolean), 'exactly one is the recovery').toHaveLength(1);
    expect(autoRuns(p)).toHaveLength(1);
  });

  it('RED: a concurrent twin generating the SAME bytes gets the registration replay arm (mutated AND replayed) and runs nothing', async () => {
    const p = product();
    let arrived = 0;
    let release!: () => void;
    const bothIn = new Promise<void>((r) => { release = r; });
    const call: CallStructuredModel = async () => {
      arrived += 1;
      if (arrived === 2) release();
      await bothIn;
      return { text: JSON.stringify(candidate('Hire a tech lead')) };
    };
    const [a, b] = await Promise.all([build(capsFor(p, call)), build(capsFor(p, call))]);
    const loser = a.replayed === true ? a : b;
    // Vacuity guard: this IS the arm where `mutated` alone would have let it through.
    expect(loser).toMatchObject({ ok: true, mutated: true, replayed: true });
    expect(autoRuns(p)).toHaveLength(1);
  });

  it('RED: defence in depth — a registration that fails to REPORT its replay is caught by the (K, H) fact', async () => {
    const p = product({ reportReplay: false, guest: true });
    const call: CallStructuredModel = async () => ({ text: JSON.stringify(candidate('Hire a tech lead')) });
    await build(capsFor(p, call));
    expect(autoRuns(p)).toHaveLength(1);
    // The same brief is built again on the same (cleared) scenario: the SAME bytes, the SAME K, the SAME revision.
    p.clearModel();
    const again = await build(capsFor(p, call));
    expect(again).toMatchObject({ ok: true, mutated: true });
    expect(again.replayed, 'vacuity: the route did not flag this replay').toBeUndefined();
    expect(autoRuns(p), 'the prior fact for (K, H) stopped a second run').toHaveLength(1);
    expect((again.first_analysis as { reason?: unknown }).reason).toBe('already_ran_for_construction');
  });
});

describe('the first analysis is not repeated by the model in the same request', () => {
  it('RED: a model-initiated run_analysis on the build turn returns the first analysis, with no second PLoT call', async () => {
    const p = product();
    const call: CallStructuredModel = async () => ({ text: JSON.stringify(candidate('Hire a tech lead')) });
    const caps = capsFor(p, call);
    await build(caps);
    const ran = await dispatchTool('run_analysis', JSON.stringify({ reason: 'compare' }), ctx, caps) as Record<string, unknown>;
    expect(p.runs, 'one run in total').toHaveLength(1);
    expect(ran.ran).toBe(true);
  });

  it('CONTRAST: a LATER request (an explicit Run) runs again — it never consults the construction', async () => {
    const p = product();
    const call: CallStructuredModel = async () => ({ text: JSON.stringify(candidate('Hire a tech lead')) });
    await build(capsFor(p, call));
    await dispatchTool('run_analysis', JSON.stringify({ reason: 'the user pressed Run' }), ctx, capsFor(p, call));
    expect(p.runs).toHaveLength(2);
    expect(p.runs[1]!.autoRun, 'the explicit Run carries no provenance').toBeUndefined();
  });
});
