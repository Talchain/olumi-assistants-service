/**
 * ⭐ S10/S7 (DL 15 Oct, from an unseen brief): readiness said READY with no blockers while every Run refused at preparation —
 * "recorded as a bare amount with no range" (`baseline_scale_unresolved`) — and the reply said no control could repair it.
 * ONE predicate: readiness now carries the Run's own baseline gate (`findScaleIncoherentBaselineFactorIds`, over the options the
 * Run would send), and asks for that factor's level in its unit or with a range.
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
      it(`${brief} · ${v}: readiness blocks for that factor ⇔ the Run refuses it; readiness clear ⇔ the Run never refuses it`, async () => {
        const { g, id } = variant(load(), v);
        const r = assessCanonicalAnalysisReadiness(g);
        const asked = r.blockingIssues.filter((i) => i.code === CODE);
        const out = await run(g);
        if (v === 'bare') {
          expect(asked.map((i) => i.factor_id)).toEqual([id]);
          expect(asked[0]!.repairability).toBe('human_input_required');
          expect(asked[0]!.message).toMatch(/in its own unit .*A range is fine if you are not sure\.$/);
          expect(out.ran).toBe(false);
          // The Run refuses with READINESS's ask (one gate), never a second sentence saying no control can repair it.
          expect(out.refusal ?? '').toContain(asked[0]!.factor_label!);
        } else {
          expect(asked).toEqual([]);
          expect(out.refusal ?? '').not.toContain('baseline_scale_unresolved');
        }
      });
    }
  }
});
