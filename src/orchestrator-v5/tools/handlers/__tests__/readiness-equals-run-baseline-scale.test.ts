/**
 * ⭐ S10/S7 (DL 15 Oct, from an unseen brief): readiness said READY with no blockers while every Run refused at preparation —
 * "recorded as a bare amount with no range" (`baseline_scale_unresolved`) — and the reply said no control could repair it.
 * ONE predicate: readiness now carries the Run's own baseline gate (`findScaleIncoherentBaselineFactorIds`, over the options the
 * Run submits, through the Run's own chain), and asks for that factor's level in its unit or with a range. The mixed-scale half
 * of the Run's verdict follows separately (DL 15 Oct, option 2).
 *
 * Property (readiness ≡ Run), on two briefs that Run today (marketing run-08, hiring r4), each with a bare baseline and two
 * contrasts the Run accepts (the level stored with its scale; a stated range): readiness READY ⇔ the REAL Run handler (loader
 * as served, PLoT faked) reaches PLoT; readiness blocked by FACTOR_LEVEL_SCALE_UNRESOLVED ⇔ the Run refuses, naming that factor.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { assessCanonicalAnalysisReadiness, mergeInterventionSourceObjects } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import type { HandlerInvocation } from '../../registry.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import minimalFixture from '../../../../../tests/fixtures/plot/v2-run-golden-minimal.json';
import { createAgentCapabilities, type InternalDispatch } from '../../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../../agent-lane/proposal.js';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { applyFactorValueEdit } from '../../../system-events/factor-value-edit.js';
import { recoverScaleFrame } from '../d1-shared/scale-frame.js';
import { committedValueWrite } from '../../../agent-lane/__tests__/fixtures/served-value-write.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

// The drafter-raw recorder writes its own table; it is a recorder, not logic.
vi.mock('../../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));

type Rec = Record<string, any>;
const MARKETING = (): Rec => JSON.parse(readFileSync('tests/fixtures/marketing-withheld-once/run-08.json', 'utf8')).graph as Rec;
const HIRING = (): Rec => JSON.parse(readFileSync('src/orchestrator-v5/statement-door/__tests__/fixtures/hiring-negative-r4-turn09.json', 'utf8')).graph as Rec;
const SID = 'e7f95dc6-0000-4000-8000-000000005c10';
const CODE = 'FACTOR_LEVEL_SCALE_UNRESOLVED';

/** A factor with a level whose option values (if any) all sit on the unit interval: none of them frames a raw baseline. */
function unsetFactor(g: Rec): Rec {
  const raw = new Set<string>();
  for (const n of g.nodes as Rec[]) {
    if (n.kind !== 'option') continue;
    for (const [k, x] of Object.entries(mergeInterventionSourceObjects(n))) {
      const v = typeof x === 'number' ? x : (x as Rec | null)?.value;
      if (!(typeof v === 'number' && v >= 0 && v <= 1)) raw.add(k);
    }
  }
  const f = (g.nodes as Rec[]).find((n) => n.kind === 'factor' && !raw.has(n.id) && n.observed_state && typeof n.observed_state === 'object');
  if (!f) throw new Error('no factor whose options leave its scale unframed');
  return f;
}
type Variant = 'bare' | 'scaled_pair' | 'stated_range';
function variant(g0: Rec, v: Variant): { g: Rec; id: string } {
  const g = structuredClone(g0);
  const f = unsetFactor(g);
  const unit = f.observed_state.unit;
  // The R4 shape on this brief: a level recorded as an amount with no scale the Run can read.
  f.observed_state = v === 'bare' ? { value: 250, ...(unit ? { unit } : {}), source: 'user_override' }
    : v === 'scaled_pair' ? { value: 0.25, raw_value: 250, ...(unit ? { unit } : {}), source: 'user_override' }
      : { value: 250, cap: 1000, ...(unit ? { unit } : {}), source: 'user_override' };
  return { g, id: f.id };
}

/** The REAL Run: the served loader over the stored bytes, then the handler; PLoT answers every option it is sent. */
async function run(stored: Rec): Promise<{ ran: boolean; refusal?: string }> {
  const plotRun = vi.fn(async (payload: Rec) => ({ ...structuredClone(minimalFixture), inference_warnings: [],
    results: payload.options.map((o: Rec) => ({ option_id: o.id ?? o.option_id, option_label: o.label, win_probability: 1 / payload.options.length })),
    option_comparison: payload.options.map((o: Rec, i: number) => ({ option_id: o.id ?? o.option_id, option_label: o.label,
      win_probability: 1 / payload.options.length, probability_of_goal: 0.4,
      outcome: { p10: 0, p50: 1 + i, p90: 3, mean: 1 + i, std: 1, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1, percentiles_source: 'samples' } })),
  }) as unknown as V2RunResponseEnvelope);
  // The served wiring: the handler's own reader calls the loader, so a loader refusal is mapped as the user would get it.
  const handler = createRunAnalysisHandler({ plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: () => loadScenarioSnapshotForRunAnalysis(SID, 'req-load', {
      readMostRecentPendingActions: async () => [], loadGraphAndBriefText: async () => ({ graph: structuredClone(stored), briefText: null }),
      loadGraph: async () => structuredClone(stored),
    } as never) });
  try {
    await handler({ payload: { kind: 'message', scenario_id: SID, turn_id: 't-run' }, requestId: 'req-run',
      signal: new AbortController().signal, context: {}, orientationText: '' } as unknown as HandlerInvocation);
    return { ran: plotRun.mock.calls.length === 1 };
  } catch (err) {
    return { ran: false, refusal: JSON.stringify({ message: (err as Error).message, details: (err as { details?: unknown }).details ?? null }) };
  }
}

/**
 * The Run's OWN verdict on `variant`, readiness bypassed explicitly: the snapshot is loaded from `control` (which readiness
 * clears), then its graph bytes are the variant's. Only the factor's recorded level differs, so the options the loader built are
 * the variant's options too; every gate after the loader (scaffold, filters, scale projection, baseline gate) runs as served.
 */
async function runOwn(control: Rec, variant: Rec): Promise<{ ran: boolean; refusal?: string }> {
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'req-load', {
    readMostRecentPendingActions: async () => [], loadGraphAndBriefText: async () => ({ graph: structuredClone(control), briefText: null }),
    loadGraph: async () => structuredClone(control),
  } as never) as Rec;
  const swapped = { ...snapshot, graph: GraphV3.parse(structuredClone(variant)), rawPersistedGraph: structuredClone(variant) };
  const plotRun = vi.fn(async (payload: Rec) => ({ ...structuredClone(minimalFixture), inference_warnings: [],
    results: payload.options.map((o: Rec) => ({ option_id: o.id ?? o.option_id, option_label: o.label, win_probability: 1 / payload.options.length })),
    option_comparison: payload.options.map((o: Rec) => ({ option_id: o.id ?? o.option_id, option_label: o.label, win_probability: 1 / payload.options.length,
      probability_of_goal: 0.4, outcome: { p10: 0, p50: 1, p90: 3, mean: 1, std: 1, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1, percentiles_source: 'samples' } })),
  }) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({ plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => swapped as never });
  try {
    await handler({ payload: { kind: 'message', scenario_id: SID, turn_id: 't-run' }, requestId: 'req-run',
      signal: new AbortController().signal, context: {}, orientationText: '' } as unknown as HandlerInvocation);
    return { ran: plotRun.mock.calls.length === 1 };
  } catch (err) {
    return { ran: false, refusal: JSON.stringify({ message: (err as Error).message, details: (err as { details?: unknown }).details ?? null }) };
  }
}

describe('readiness ≡ Run on a level recorded with no scale (the Run\'s baseline gate is part of the ONE readiness authority)', () => {
  for (const [brief, load] of [['marketing run-08', MARKETING], ['hiring r4', HIRING]] as const) {
    it(`${brief}: CONTROL — as stored, readiness is ready and the Run reaches PLoT`, async () => {
      const g = load();
      const r = assessCanonicalAnalysisReadiness(g);
      expect(r.blockingIssues.map((i) => i.code), JSON.stringify(r.blockingIssues).slice(0, 600)).not.toContain(CODE);
      const out = await run(g);
      expect(out.refusal ?? '').not.toContain('baseline_scale_unresolved');
    });

    for (const v of ['bare', 'scaled_pair', 'stated_range'] as const) {
      it(`${brief} · ${v}: readiness asks for a scale ⇔ the Run's OWN baseline gate refuses; served, the Run refuses with readiness's ask`, async () => {
        const { g, id } = variant(load(), v);
        const asked = assessCanonicalAnalysisReadiness(g).blockingIssues.filter((i) => i.code === CODE);
        const own = await runOwn(load(), g);
        // The WHOLE scale verdict, both halves: readiness asks ⇔ the Run's own gates refuse for scale, naming the same factors.
        const ownScale = /(?:baseline|mixed)_scale_unresolved/.test(own.refusal ?? '');
        expect(asked.length > 0, `readiness ${JSON.stringify(asked.map((i) => i.factor_id))} vs Run ${own.refusal ?? 'ran'}`).toBe(ownScale);
        for (const i of asked) expect(own.refusal ?? '').toContain(i.factor_label!);
        if (v === 'bare') expect(asked.map((i) => i.factor_id)).toContain(id);
        // Said as it is held. The bare level has no scale: it is asked for its range in its own unit (or a unit and range). The
        // stated range HAS one, so it is never told it lacks one; only its options' levels on another scale are asked about.
        const unit = (g.nodes as Rec[]).find((n) => n.id === id)?.observed_state?.unit as string | undefined;
        for (const i of asked.filter((x) => x.factor_id === id)) {
          if (v === 'stated_range') {
            expect(i.message).toMatch(/^What unit are .* and the levels your options set for it in\?/);
            expect(i.message).not.toMatch(/no range|no unit/);
          } else if (v === 'bare') {
            expect(i.message).toContain(unit ? `It is recorded as 250 ${unit} with no range` : 'It is recorded as 250 with no unit or range');
          }
        }
        if (asked.length > 0) {
          expect(asked.every((i) => i.repairability === 'human_input_required')).toBe(true);
          const served = await run(g);
          expect(served.ran).toBe(false);
          expect(served.refusal ?? '').toContain(asked[0]!.factor_label!);
        }
      });
    }
  }
});

describe('the ask says what is actually missing', () => {
  it('a level held WITH a unit but no range is asked for its range in that unit, never told it has no unit (D1 \u2018Headcount\u2019 12 people)', () => {
    const asked = assessCanonicalAnalysisReadiness(buildD1Fixture()).blockingIssues.filter((i) => i.code === CODE);
    expect(asked.map((i) => i.factor_id)).toEqual(['f-uncapped']);
    expect(asked[0]!.message).toBe('What range could "Headcount" be in, in people? It is recorded as 12 people with no range, so the '
      + 'analysis cannot use it yet. A rough upper end is fine if you are not sure.');
  });
});

/**
 * DL condition (15 Oct, no FACTOR_LEVEL door row): the user's typed answer to readiness's ask lands as THEIR figure, with its
 * unit and a scale the Run can read, through the existing path (`propose_assumptions` revise → the card → `authorise_change`), and the Run then
 * proceeds. The store is the register route's compare-and-set, in memory.
 */
describe('the answer to the ask lands as the user\'s level and the Run proceeds (marketing run-08)', () => {
  /** Readiness's ask, answered with `answer` in the factor's own unit, through the user's card and its press; the saved model after. */
  async function answered(answer: number): Promise<{ graph: Rec; id: string; os: Rec; unit: string; factorUnit: unknown }> {
    const { g: bare, id } = variant(MARKETING(), 'bare');
    const factor = (bare.nodes as Rec[]).find((n) => n.id === id)!;
    const unit = typeof factor.observed_state.unit === 'string' && factor.observed_state.unit !== '' ? factor.observed_state.unit : 'units';
    expect(assessCanonicalAnalysisReadiness(bare).blockingIssues.map((i) => i.code)).toContain(CODE);
    let graph: Rec = structuredClone(bare);
    const dispatch: InternalDispatch = async (path, body) => {
      if (path === `/assist/v1/scenarios/${SID}/graph`) {
        return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never), brief_text: 'brief',
          graph_identity_hash: computeGraphIdentityHash(graph as never) } };
      }
      if (path === `/assist/v1/scenarios/${SID}/graph/register`) {
        const b = body as { graph: Rec; expected_graph_hash?: unknown; expected_graph_identity_hash?: unknown };
        if (b.expected_graph_hash !== computeAnalysisAffectingGraphHash(graph as never)
          || b.expected_graph_identity_hash !== computeGraphIdentityHash(graph as never)!.value) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
        graph = GraphV3.parse(b.graph) as Rec;
        return { status: 200, json: { registered: true, graph_identity_hash: computeGraphIdentityHash(graph as never) } };
      }
      // The served route applies a value edit through its ONE writer and answers with the committed patch block.
      if (path === '/orchestrate/v2/turn' && (body as Rec)?.kind === 'system_event' && (body as Rec).event?.kind === 'factor_value_edit') {
        const b = body as Rec;
        const res = await applyFactorValueEdit({ payload: b as never, event: b.event as never, requestId: 'req-write', persistedGraph: structuredClone(graph), priorFacts: [] }) as Rec;
        if (res.kind !== 'mutated') return { status: 200, json: { assistant_text: 'Not recorded.', blocks: [] } };
        graph = GraphV3.parse(res.mutatedGraph) as Rec;
        return { status: 200, json: committedValueWrite(String(b.event.target_id)) };
      }
      return { status: 404, json: {} };
    };
    const proposals = new ProposalStore();
    const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full');
    const said = `${factor.label} is about ${answer} ${unit}.`;
    const ctx = { scenario_id: SID, authenticated_user_id: null, request_id: 'req-answer', turn_id: 'answer-turn-0001', user_turn_text: said, user_text: said };
    const card = await caps.proposeAssumptions(ctx as never, { assumptions: [{ user_stated: true, factor_label: factor.label, value: answer, quote: ctx.user_text, unit,
      basis: 'the user\'s answer to the ask', revise: true }] } as never) as Rec;
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false });
    expect(card.assumptions[0]).toMatchObject({ value: answer, your_figure: true });
    const applied = await caps.authoriseChange!({ ...ctx, request_id: 'req-press', turn_id: 'press-turn-0001', user_turn_text: '',
      typed_approval_of: card.proposal_id } as never, { proposal_id: card.proposal_id } as never) as Rec;
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, mutated: true });
    const os = (graph.nodes as Rec[]).find((n) => n.id === id)!.observed_state as Rec;
    return { graph, id, os, unit, factorUnit: factor.observed_state.unit };
  }

  it('bare level → ask → the user types a figure in its unit → their card, pressed → user origin, unit, a readable scale → readiness clear → the Run reaches PLoT', async () => {
    const { graph, os, unit, factorUnit } = await answered(2);
    // The user's figure, with its unit, and a scale the Run can read; the user's own stamp, never an assumption's.
    expect(os).toMatchObject({ raw_value: 2, source: 'user_override' });
    expect(os.unit).toBe(factorUnit ?? unit);
    expect(recoverScaleFrame({ value: os.value, raw_value: os.raw_value }) !== undefined || typeof os.cap === 'number').toBe(true);
    expect(assessCanonicalAnalysisReadiness(graph).blockingIssues.map((i) => i.code)).not.toContain(CODE);
    const out = await run(graph);
    expect(out.refusal ?? '').not.toContain('scale_unresolved');
    expect(out.ran, out.refusal).toBe(true);
  });

  it('readiness ≡ Run on the OTHER half of the scale verdict: an answer off its factor\'s frame (300 on a 0–3 frame) leaves the options\' levels on another scale — readiness asks it ⇔ the Run refuses mixed_scale_unresolved', async () => {
    const { graph, id } = await answered(300);
    const asked = assessCanonicalAnalysisReadiness(graph).blockingIssues.filter((i) => i.code === CODE);
    const own = await runOwn(MARKETING(), graph);
    expect(own.refusal ?? '', 'the Run\'s own gate refuses').toContain('mixed_scale_unresolved');
    const out = await run(graph);
    expect(out.ran).toBe(false);
    expect(asked.map((i) => i.factor_id)).toContain(id);
    expect(asked.find((i) => i.factor_id === id)!.message).toMatch(/^What unit are .* and the levels your options set for it in\?/);
    expect(out.refusal ?? '').toContain(asked.find((i) => i.factor_id === id)!.factor_label!);
  });
});
