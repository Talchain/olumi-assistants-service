/**
 * The acyclic first model — arms pinned from the adversarial verify of ecc7d9eb.
 *
 * Each row here was a PROBE that the verifier ran against HEAD while a mutant survived
 * construction-acyclic.test.ts (M10, M11, M12, M14, M18), plus the one BLOCKING shape
 * (P-B1M): an OVERSIZED first draft with a mechanism issue AND the served loop, drafted by
 * a model that complies with every issue it is given. Before the fix, that retry was asked
 * to break the loop, did, lost the option's signed path through the loop link, failed the
 * risk-retention gate, and the oversized first draft left the user `model_too_large` with no
 * model at all. Base staging registered it.
 *
 * Drafter faked; /graph/register captured and GraphV3-parsed; no provider is reached.
 */
import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, prepareProvisionalCandidate, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { validateGraphStructure } from '../../../orchestrator/graph-structure-validator.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Edge = { from: string; to: string; provenance?: { source?: string }; effect_direction?: string };
type Node = { id: string; kind: string; label: string };
type Graph = { nodes: Node[]; edges: Edge[] };
const SERVED = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'served-pricing-loop-20260925.json'), 'utf8')) as { brief: string };

type Link = { from: string; to: string; direction: 'positive' | 'negative' | 'unknown'; provenance: 'explicit' | 'inferred' | 'ai_proposed' };
const L = (from: string, to: string, direction: Link['direction'], provenance: Link['provenance'] = 'inferred'): Link => ({ from, to, direction, provenance });

function servedCandidate(links: readonly Link[], extra: { factors?: string[]; risks?: string[] } = {}): CandidateModel {
  const est = (label: string, role: 'controllable' | 'observable', value: number, unit: string, plausible_max: number) =>
    ({ label, role, baseline_known: false, baseline_value: value, unit, provenance: 'inferred', plausible_max });
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP/month', horizon_months: 12,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit',
    },
    constraints: [{ metric: 'Monthly churn', operator: '<=', value: 10, unit: '%', provenance: 'explicit' }],
    options: [
      { label: 'Keep £49 Price', provenance: 'inferred', changes: [], interventions: [], is_status_quo: true },
      { label: 'Raise to £59', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP/month', provenance: 'explicit' },
        { factor_label: 'AI feature availability', value: 1, value_kind: 'absolute', unit: 'release index', provenance: 'ai_proposed' },
      ] },
      { label: 'Phased £54 Price', provenance: 'ai_proposed', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Pro plan price', value: 54, value_kind: 'absolute', unit: 'GBP/month', provenance: 'ai_proposed' },
        { factor_label: 'AI feature availability', value: 1, value_kind: 'absolute', unit: 'release index', provenance: 'ai_proposed' },
      ] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP/month', provenance: 'explicit', plausible_max: 200 },
      est('AI feature availability', 'controllable', 0, 'release index', 2),
      est('Pro subscribers', 'observable', 250, 'subscribers', 2000),
      est('New Pro conversions', 'observable', 25, 'subscribers/month', 500),
      est('Monthly churn', 'observable', 7, '%', 100),
      est('Non-Pro MRR', 'observable', 5000, 'GBP/month', 50000),
      ...(extra.factors ?? []).map((l) => est(l, 'observable', 10, 'index', 100)),
    ],
    risks: [{ label: 'Price sensitivity', provenance: 'inferred' }, { label: 'AI release delay', provenance: 'inferred' },
      ...(extra.risks ?? []).map((label) => ({ label, provenance: 'inferred' }))],
    outcomes: [{ label: 'Pro MRR', provenance: 'inferred' }],
    links: links as CandidateModel['links'],
    unknowns: [],
  } as unknown as CandidateModel;
}
const AVAIL_TO_DELAY = L('AI feature availability', 'AI release delay', 'negative');
const DELAY_TO_AVAIL = L('AI release delay', 'AI feature availability', 'negative');
const SERVED_LINKS: readonly Link[] = [
  L('Pro plan price', 'Pro MRR', 'positive'),
  L('Pro plan price', 'Price sensitivity', 'positive'),
  L('AI feature availability', 'New Pro conversions', 'positive'),
  AVAIL_TO_DELAY,
  L('AI feature availability', 'Pro MRR', 'positive'),
  L('Pro subscribers', 'Pro MRR', 'positive'),
  L('New Pro conversions', 'Pro subscribers', 'positive'),
  L('Monthly churn', 'Pro subscribers', 'negative'),
  L('Price sensitivity', 'Monthly churn', 'positive'),
  DELAY_TO_AVAIL,
  L('Pro MRR', 'MRR', 'positive'),
  L('Non-Pro MRR', 'MRR', 'positive'),
];

async function build(...drafts: CandidateModel[]) {
  let body: unknown = null;
  const inputs: string[] = [];
  const call = (async (req: { input: string }) => {
    inputs.push(req.input);
    return { text: JSON.stringify(drafts[Math.min(inputs.length - 1, drafts.length - 1)]) };
  }) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) {
      body = structuredClone((b as { graph: unknown }).graph);
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', SERVED.brief, d, call) as Record<string, unknown>;
  return { out, graph: body === null ? null : (GraphV3.parse(body) as unknown as Graph), calls: inputs.length, inputs };
}
const cycleFree = (g: Graph) => !validateGraphStructure(GraphV3.parse(g)).violations.some((v) => v.code === 'CYCLE_DETECTED');
const blockers = (g: Graph) => resolveRunAdmission(g).assessment.blockingIssues.map((i) => i.code).sort();
const loopWithheld = (out: Record<string, unknown>) =>
  ((out.withheld as { from: string; to: string; reason: string }[]) ?? []).filter((w) => w.reason === 'loop_closing_link').map((w) => `${w.from}->${w.to}`);
const loopSaid = (out: Record<string, unknown>) => ((out.not_represented as string[]) ?? []).filter((s) => /loop/i.test(s));

describe('acyclic: arms a surviving mutant could not see (verifier rows)', () => {
  it('P-M10: a user-only kept loop plus an unconnected Olumi risk — the kept loop is said ONCE', async () => {
    const links = SERVED_LINKS.map((l) => (l === AVAIL_TO_DELAY || l === DELAY_TO_AVAIL ? { ...l, provenance: 'explicit' as const } : l));
    const c = servedCandidate(links, { risks: ['Orphan risk'] });
    const r = await build(c);
    const kept = loopSaid(r.out).filter((s) => s.includes('AI feature availability') && s.includes('AI release delay'));
    expect(r.graph!.edges.some((e) => e.from === 'orphan_risk' && e.to === 'mrr')).toBe(true);
    expect(kept).toHaveLength(1);
  });

  it('P-M11: a link FROM the goal onto an unconnected risk — the model registers and is acyclic even when a risk repair closes a loop', async () => {
    const c = servedCandidate([...SERVED_LINKS, L('MRR', 'Goal risk', 'negative')], { risks: ['Goal risk'] });
    const a = admitCandidateModel(prepareProvisionalCandidate(c).candidate, {});
    const fromGoal = a.edges.filter((e) => e.from === 'mrr');
    const r = await build(c);
    expect(r.out.ok).toBe(true);
    expect(r.graph).not.toBeNull();
    expect(cycleFree(r.graph!)).toBe(true);
  });

  it('P-M12: kept loop — the user states A->B, Olumi restates A->B FIRST, the user states B->A: said as the user\'s, never "what that option sets"', async () => {
    const links = [
      ...SERVED_LINKS.filter((l) => l !== AVAIL_TO_DELAY && l !== DELAY_TO_AVAIL),
      L('AI feature availability', 'AI release delay', 'negative', 'inferred'),
      L('AI feature availability', 'AI release delay', 'negative', 'explicit'),
      L('AI release delay', 'AI feature availability', 'negative', 'explicit'),
    ];
    const r = await build(servedCandidate(links));
    const said = loopSaid(r.out);
    expect(loopWithheld(r.out)).toEqual([]);
    expect(said.some((s) => /what that option sets|how the decision holds/.test(s))).toBe(false);
  });

  it('P-M14: a within-limit looped draft; the retry clears the loop by DELETING Olumi’s risk — not adopted, first draft kept (backstop)', async () => {
    const noRisk = servedCandidate(SERVED_LINKS.filter((l) => l !== AVAIL_TO_DELAY && l !== DELAY_TO_AVAIL));
    (noRisk as unknown as { risks: unknown[] }).risks = [{ label: 'Price sensitivity', provenance: 'inferred' }];
    const r = await build(servedCandidate(SERVED_LINKS), noRisk);
    expect(r.graph!.nodes.some((n) => n.id === 'ai_release_delay')).toBe(true);
  });

  it('P-M18: Olumi states the back link TWICE — one withheld entry, one sentence, both instances gone', async () => {
    const r = await build(servedCandidate([...SERVED_LINKS, AVAIL_TO_DELAY]));
    expect(loopWithheld(r.out)).toEqual(['ai_feature_availability->ai_release_delay']);
    expect(loopSaid(r.out)).toHaveLength(1);
    expect(cycleFree(r.graph!)).toBe(true);
  });
});

/** Seeded fuzz: the user's links are never withheld, never said as Olumi's, and every non-kept loop is broken. */

describe('acyclic: an oversized draft with a mechanism issue AND a loop keeps a model (BLOCKING, P-B1M)', () => {
  const spec = Array.from({ length: 5 }, (_, j) => `Speculative factor ${j}`);
  const first = servedCandidate([
    ...SERVED_LINKS,
    L('Raise to £59', 'Competitor reaction', 'positive'),
    L('Competitor reaction', 'MRR', 'negative'),
    ...spec.map((l) => L(l, 'MRR', 'positive', 'ai_proposed')),
  ], { factors: spec, risks: ['Competitor reaction'] });
  const repairedLinks = [...SERVED_LINKS, L('Pro plan price', 'Competitor reaction', 'positive'), L('Competitor reaction', 'MRR', 'negative')];
  const keepLoop = servedCandidate(repairedLinks, { risks: ['Competitor reaction'] });
  // Complies with a loop issue exactly as worded: removes the link pointing back — the very link
  // admission's backstop withholds on this model (availability -> delay).
  const comply = servedCandidate(repairedLinks.filter((l) => l !== AVAIL_TO_DELAY), { risks: ['Competitor reaction'] });

  it('PRECONDITION: the first draft is oversized, has a mechanism issue, and carries the served loop', async () => {
    expect(prepareProvisionalCandidate(first).mechanism_issues.length).toBeGreaterThan(0);
    const a = admitCandidateModel(prepareProvisionalCandidate(first).candidate, {});
    expect(a.withheld.some((w) => w.reason === 'loop_closing_link')).toBe(true);
  });

  it('a drafter that complies with every issue it is ASKED: the model registers, acyclic, the loop link withheld and said', async () => {
    let body: unknown = null;
    const inputs: string[] = [];
    const call = (async (req: { input: string }) => {
      inputs.push(req.input);
      const d = inputs.length === 1 ? first : (/is a loop/.test(req.input) ? comply : keepLoop);
      return { text: JSON.stringify(d) };
    }) as unknown as CallStructuredModel;
    const disp: InternalDispatch = async (path, b) => {
      if (path.endsWith('/graph/register')) { body = structuredClone((b as { graph: unknown }).graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
    };
    const out = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', SERVED.brief, disp, call) as Record<string, unknown>;
    expect(inputs).toHaveLength(2);
    // On the size route the loop is never asked: only the mechanism issue is.
    expect(/is a loop/.test(inputs[1])).toBe(false);
    expect(inputs[1]).toContain('Construction issues:');
    expect(out.ok).toBe(true);
    expect(out.size_retried).toBe(true);
    expect(body).not.toBeNull();
    const g = GraphV3.parse(body) as unknown as Graph;
    expect(cycleFree(g)).toBe(true);
    expect(g.nodes.some((n) => n.id.startsWith('speculative_factor'))).toBe(false);
    expect(loopWithheld(out)).toEqual(['ai_feature_availability->ai_release_delay']);
    expect(loopSaid(out)).toHaveLength(1);
  }, 60_000);
});
