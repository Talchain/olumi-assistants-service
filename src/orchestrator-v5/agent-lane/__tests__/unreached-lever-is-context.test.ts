/**
 * ⛔ A lever no option pulls is context, not a lever (demoteUnreachedLevers).
 *
 * Fixture: the REAL graph construction registered on served `c4a6cce` for the canonical
 * pricing brief (sprint witness, scenario B, 23 Sep 11:1xZ) — read back from the wire,
 * not written for this test. On it the readiness authority's SOLE blocker was
 * "Factor \"Pro feature release readiness\" is not connected to any option", so the
 * comparison stayed refused after the user adopted every starting value.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { demoteUnreachedLevers } from '../admit-model.js';
import { narrateWriteOutcome } from '../write-outcome.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-pricing-graph-c4a6cce.json', import.meta.url), 'utf8')) as { nodes: { id: string; kind: string; label: string; category?: string }[]; edges: { from: string; to: string }[] };
const UNCONNECTED = /is not connected to any option/;
const blockerMessages = (g: unknown) => ((assessCanonicalAnalysisReadiness(g as never).analysisReady as { blockers?: { message?: string }[] } | undefined)?.blockers ?? []).map((b) => String(b.message ?? ''));

describe('a factor no option changes is held as context', () => {
  it('vacuity: on the served graph the readiness authority blocks on the unconnected controllable factor', () => {
    expect(blockerMessages(SERVED).filter((m) => UNCONNECTED.test(m))).toEqual(['Factor "Pro feature release readiness" is not connected to any option']);
  });

  it('RED: after demotion that blocker is gone, and only that factor was reclassified', () => {
    const { nodes, demoted } = demoteUnreachedLevers(SERVED.nodes, SERVED.edges);
    expect(demoted).toEqual(['Pro feature release readiness']);
    expect(nodes.find((n) => n.id === 'pro_feature_release_readiness')?.category).toBe('external');
    expect(blockerMessages({ ...SERVED, nodes }).filter((m) => UNCONNECTED.test(m))).toEqual([]);
  });

  it('CONTRAST: factors an option reaches, and context factors, keep their category', () => {
    const { nodes } = demoteUnreachedLevers(SERVED.nodes, SERVED.edges);
    const cat = (id: string) => nodes.find((n) => n.id === id)?.category;
    expect(cat('pro_plan_price')).toBe('controllable');
    expect(cat('price_change_timing')).toBe('controllable');
    expect(cat('monthly_churn_rate')).toBe('observable');
  });

  it('RED: the server says so, and offers to connect it', () => {
    const n = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [{ ok: true, mutated: true, model_version: { version_number: 1 }, treated_as_context: ['Pro feature release readiness'] }]);
    expect(n.status).toBe('The model was saved as version 1. No option changes Pro feature release readiness, so I held it as fixed context rather than a lever — tell me if one of the options should change it.');
  });

  it('RED (wiring): construction itself demotes and REPORTS it — through buildModelFromBrief', async () => {
    const candidate = {
      goal: { metric: 'Monthly recurring revenue', operator: '>=', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit' },
      constraints: [], risks: [], outcomes: [], unknowns: [],
      options: [
        { label: 'Raise to £59', provenance: 'explicit', changes: ['Pro plan price'], interventions: [{ factor_label: 'Pro plan price', value: 59, unit: 'GBP', provenance: 'explicit' }] },
        { label: 'Hold £49', provenance: 'explicit', changes: ['Pro plan price'], interventions: [{ factor_label: 'Pro plan price', value: 49, unit: 'GBP', provenance: 'explicit' }] },
      ],
      factors: [
        { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', plausible_max: 200, provenance: 'explicit' },
        { label: 'Release readiness', role: 'controllable', baseline_known: false, baseline_value: null, unit: 'points', plausible_max: 100, provenance: 'ai_proposed' },
      ],
      links: [
        { from: 'Pro plan price', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred' },
        { from: 'Release readiness', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred' },
      ],
    };
    const call = (async () => ({ text: JSON.stringify(candidate) })) as unknown as CallStructuredModel;
    const d: InternalDispatch = async (path) => (path.endsWith('/graph/register')
      ? { status: 200, json: { model_version: { version_number: 1 } } }
      : { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } });
    const out = await buildModelFromBrief('33333333-3333-4333-8333-333333333333', 'Should we raise the Pro plan price from £49 to £59?', d, call) as Record<string, unknown>;
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.treated_as_context).toEqual(['Release readiness']);
  });

  it('CONTRAST: nothing demoted → no sentence', () => {
    const n = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [{ ok: true, mutated: true, model_version: { version_number: 1 } }]);
    expect(n.status).toBe('The model was saved as version 1.');
  });
});
