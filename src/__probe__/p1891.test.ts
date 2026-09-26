// AIQ review probe for CEE #1891 @ d544fbe3 — deleted after the run. Writes to the scratchpad only.
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, retrySchemaPinningGoal } from '../orchestrator-v5/agent-lane/runtime/build-model.js';
import { assessCanonicalAnalysisReadiness } from '../orchestrator/tools/analysis-ready-helper.js';
import { classifyValueSource } from '../cee/graph-readiness/obligation-provenance.js';
import { GraphV3 } from '../schemas/cee-v3.js';

const OUT = '/private/tmp/claude-502/-Users-paulslee-Documents-GitHub/fd7267a5-1029-4463-9dc0-7ec60b586d00/scratchpad/1891-probe.out';
const lines: string[] = [];
const log = (...a: unknown[]) => lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

async function run(label: string, brief: string, drafts: Any[]) {
  drafts.forEach((d, i) => {
    const s = i === 0 ? strict : new Ajv({ strict: false }).compile(retrySchemaPinningGoal(drafts[0].goal));
    if (!s(d)) log(label, 'SCHEMA-FAIL draft', i, (s.errors ?? []).slice(0, 3));
  });
  let graph: Any;
  const inputs: string[] = [];
  const dispatch: Any = async (path: string, body: Any) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out: Any = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', brief, dispatch, (async (req: Any) => {
    inputs.push(String(req.input));
    return { text: JSON.stringify(drafts[Math.min(inputs.length - 1, drafts.length - 1)]) };
  }) as Any);
  const g: Any = graph === undefined ? undefined : GraphV3.parse(graph);
  log(`\n=== ${label}: ok=${out.ok} refusal=${out.refusal ?? '-'} calls=${inputs.length} nodes=${out.nodes} registered=${g !== undefined}`);
  if (g === undefined) return { out, g };
  const byId = new Map(g.nodes.map((n: Any) => [n.id, n]));
  for (const n of g.nodes.filter((x: Any) => x.kind === 'factor')) {
    log(`  factor ${n.id}: observed_state=${JSON.stringify(n.observed_state ?? null)} scale_frame=${n.scale_frame ?? '-'} class=${classifyValueSource(n.observed_state?.source)}`);
  }
  for (const o of g.nodes.filter((x: Any) => x.kind === 'option')) {
    const iv = o.interventions ?? {};
    log(`  option ${o.id} is_baseline=${o.is_baseline ?? '-'} provenance=${JSON.stringify(o.provenance)}`);
    for (const [fid, lv] of Object.entries(iv) as [string, Any][]) {
      const f: Any = byId.get(fid);
      const frame = f?.observed_state?.cap ?? f?.scale_frame ?? (f?.observed_state?.raw_value !== undefined && f.observed_state.value !== 0 ? f.observed_state.raw_value / f.observed_state.value : undefined);
      const inUnit = lv.value >= 0 && lv.value <= 1;
      log(`    ${o.id} x ${fid}: value=${lv.value} source=${lv.source} class=${classifyValueSource(lv.source)} frame=${frame ?? 'none'} raw≈${frame !== undefined ? +(lv.value * frame).toFixed(6) : lv.value} in[0,1]=${inUnit}`);
    }
  }
  const r = assessCanonicalAnalysisReadiness(g);
  log('  readiness blocking:', r.blockingIssues.map((i: Any) => `${i.code}: ${i.message}`));
  log('  options_withheld:', out.options_withheld ?? [], 'provenance_demoted:', out.provenance_demoted ?? [], 'additions_without_total:', out.additions_without_total ?? []);
  log('  not_represented(level/said):', (out.not_represented ?? []).filter((s: string) => /treated your|working figure|level/.test(s)));
  return { out, g };
}

// ---------- c22 (hiring) ----------
const factor = (label: string, baseline_value: number | null, plausible_max: number, unit: string) => ({
  label, role: 'controllable', baseline_known: false, baseline_value, unit, provenance: 'ai_proposed', plausible_max,
});
const est = (factor_label: string, value: number, unit: string, provenance = 'ai_proposed') => ({ factor_label, value, value_kind: 'absolute', unit, provenance });
const GOAL = 'Delivery velocity';
function c22(): Any {
  return {
    goal: { metric: GOAL, operator: '>=', target_stated: false, value: null, unit: 'points per sprint', horizon_months: null, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Hire Two Developers', provenance: 'explicit', is_status_quo: null, changes: ['Engineering delivery capacity', 'Hiring cost'], interventions: [] },
      { label: 'Hire a Tech Lead', provenance: 'explicit', is_status_quo: null, changes: ['Technical leadership capacity', 'Hiring cost'], interventions: [] },
      { label: 'Hire Both', provenance: 'ai_proposed', is_status_quo: null, changes: ['Engineering delivery capacity', 'Technical leadership capacity', 'Hiring cost'], interventions: [] },
      { label: 'Continue Current Staffing', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [
      factor('Engineering delivery capacity', null, 100, 'story points'),
      factor('Technical leadership capacity', null, 5, 'FTE'),
      factor('Hiring cost', 0, 500000, 'GBP'),
      factor('Team morale', 6, 10, 'score'),
      factor('Onboarding load', 1, 10, 'score'),
    ],
    risks: [], outcomes: [],
    links: [
      { from: 'Engineering delivery capacity', to: GOAL, direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Technical leadership capacity', to: GOAL, direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Team morale', to: GOAL, direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Onboarding load', to: GOAL, direction: 'negative', provenance: 'ai_proposed' },
    ],
    identities: [], unknowns: [],
  };
}
function covered(): Any {
  const c = c22();
  c.factors[0] = factor('Engineering delivery capacity', 40, 100, 'story points');
  c.factors[1] = factor('Technical leadership capacity', 0.5, 5, 'FTE');
  c.options[0] = { ...c.options[0], changes: [], interventions: [est('Engineering delivery capacity', 52, 'story points'), est('Hiring cost', 140000, 'GBP')] };
  c.options[1] = { ...c.options[1], changes: [], interventions: [est('Technical leadership capacity', 1.5, 'FTE'), est('Hiring cost', 110000, 'GBP')] };
  c.options[2] = { ...c.options[2], changes: [], interventions: [est('Engineering delivery capacity', 55, 'story points'), est('Technical leadership capacity', 1.5, 'FTE'), est('Hiring cost', 250000, 'GBP')] };
  return c;
}
const SPEC = Array.from({ length: 9 }, (_, i) => `Speculative factor ${i}`);
function oversized(d: Any): Any {
  d.factors.push(...SPEC.map((l) => factor(l, 5, 10, 'score')));
  d.links.push(...SPEC.map((l) => ({ from: l, to: GOAL, direction: 'positive', provenance: 'ai_proposed' })));
  return d;
}
const HIRING = 'Should we hire two developers or a tech lead to lift delivery velocity?';

// ---------- pricing (Paul's served brief, draft reconstructed from served-option-identity f-20260926T020217Z) ----------
const PRICING = 'Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 10%, should we increase the Pro plan price from £49 to £59 per month with the next AI feature release?';
function pricing(): Any {
  return {
    goal: { metric: 'MRR', operator: '>=', target_stated: true, value: 20000, unit: '£', horizon_months: 12, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null },
    constraints: [{ metric: 'Monthly churn', operator: '<', value: 10, unit: '%', provenance: 'explicit' }],
    options: [
      { label: 'Keep current pricing', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [] },
      { label: '£59 with AI release', provenance: 'explicit', is_status_quo: null, changes: ['AI feature availability'], interventions: [est('Pro plan price', 59, '£ per month', 'explicit')] },
      { label: '£54 with AI release', provenance: 'ai_proposed', is_status_quo: null, changes: ['AI feature availability'], interventions: [est('Pro plan price', 54, '£ per month')] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: '£ per month', provenance: 'explicit', plausible_max: 200 },
      { label: 'AI feature availability', role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance: 'ai_proposed', plausible_max: 1 },
      { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: null, unit: '%', provenance: 'explicit', plausible_max: 100 },
      { label: 'Pro plan subscribers', role: 'observable', baseline_known: false, baseline_value: 250, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
    ],
    risks: [], outcomes: [],
    links: [
      { from: 'Pro plan price', to: 'Pro plan subscribers', direction: 'negative', provenance: 'ai_proposed' },
      { from: 'AI feature availability', to: 'Pro plan subscribers', direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Monthly churn', to: 'Pro plan subscribers', direction: 'negative', provenance: 'ai_proposed' },
      { from: 'Pro plan subscribers', to: 'MRR', direction: 'positive', provenance: 'ai_proposed' },
      { from: 'Pro plan price', to: 'MRR', direction: 'positive', provenance: 'ai_proposed' },
    ],
    identities: [], unknowns: [],
  };
}
const withOpt = (d: Any, label: string, patch: Any) => ({ ...d, options: d.options.map((o: Any) => (o.label === label ? { ...o, ...patch } : o)) });
const withFactor = (d: Any, label: string, patch: Any) => ({ ...d, factors: d.factors.map((f: Any) => (f.label === label ? { ...f, ...patch } : f)) });

it('probe #1891 numeric/provenance domain', async () => {
  // P1: c22 → covered retry. Frames and stamps of every constructed level and baseline.
  await run('P1 c22 -> covered', HIRING, [c22(), covered()]);
  // P1w: a level ABOVE the stated plausible_max (Hiring cost 600000 on cap 500000): frame widened?
  const wide = covered(); wide.options[2].interventions[2] = est('Hiring cost', 600000, 'GBP');
  await run('P1w c22 -> covered, Hire Both cost 600000 > cap 500000', HIRING, [c22(), wide]);

  // P2: pricing. First draft: the served gaps (£59/£54 -> AI availability; AI availability baseline null, cap 1).
  await run('P2-first pricing first draft echoed (no progress)', PRICING, [pricing(), pricing()]);
  const lev = (d: Any, v59: number, v54: number, prov = 'ai_proposed') => withOpt(withOpt(d, '£59 with AI release', { changes: [], interventions: [est('Pro plan price', 59, '£ per month', 'explicit'), est('AI feature availability', v59, '', prov)] }),
    '£54 with AI release', { changes: [], interventions: [est('Pro plan price', 54, '£ per month'), est('AI feature availability', v54, '', prov)] });
  // P2a: binary availability 0/1 on a plausible_max-1 frame, baseline estimated 0.
  await run('P2a retry: AI availability levels 1/1 (cap 1), baseline est 0', PRICING, [pricing(), withFactor(lev(pricing(), 1, 1), 'AI feature availability', { baseline_value: 0 })]);
  // P2b: same on a 0..100 frame (percent availability).
  await run('P2b retry: AI availability as % (cap 100) levels 100/100, baseline est 0', PRICING, [pricing(), withFactor(lev(pricing(), 100, 100), 'AI feature availability', { baseline_value: 0, plausible_max: 100, unit: '%' })]);
  // P2c: a FIRST draft that is gap-free by the drafter's words, with a cap-1 estimated baseline: counted no gap, but registers?
  await run('P2c first draft only: levels 1/1, AI baseline est 0 on cap 1 (no retry expected)', PRICING, [withFactor(lev(pricing(), 1, 1), 'AI feature availability', { baseline_value: 0 })]);

  // P3: provenance. P3a: a retry answers £54's PRICE gap with an invented 57 stamped explicit, on a KNOWN user baseline (49).
  const p3first = withOpt(pricing(), '£54 with AI release', { changes: ['Pro plan price', 'AI feature availability'], interventions: [] });
  const p3retry = withFactor(withOpt(lev(pricing(), 1, 1), '£54 with AI release', { changes: [], interventions: [est('Pro plan price', 57, '£ per month', 'explicit'), est('AI feature availability', 1, '')] }), 'AI feature availability', { baseline_value: 0, plausible_max: 100 });
  await run('P3a retry fills £54 price gap with invented 57 stamped explicit (known baseline 49)', PRICING, [p3first, p3retry]);
  // P3b: a retry answers the AI gaps with levels stamped explicit on an UNKNOWN baseline (demoted, and said as "your").
  await run('P3b retry fills AI gaps with 100 stamped explicit on unknown baseline', PRICING, [pricing(), withFactor(lev(pricing(), 100, 100, 'explicit'), 'AI feature availability', { baseline_value: 0, plausible_max: 100, unit: '%' })]);

  // P4: a no-op level. An Olumi option acting on price + AI answers both gaps AT the status quo's levels (49, 0).
  const p4first = { ...pricing(), options: [...pricing().options, { label: 'Hold price, delay release', provenance: 'ai_proposed', is_status_quo: null, changes: ['Pro plan price', 'AI feature availability'], interventions: [] }] };
  const p4retry0 = withFactor(lev(pricing(), 100, 100), 'AI feature availability', { baseline_value: 0, plausible_max: 100, unit: '%' });
  const p4retry = { ...p4retry0, options: [...p4retry0.options, { label: 'Hold price, delay release', provenance: 'ai_proposed', is_status_quo: null, changes: [], interventions: [est('Pro plan price', 49, '£ per month'), est('AI feature availability', 0, '%')] }] };
  await run('P4 retry levels an Olumi option exactly at today\'s levels (49, 0)', PRICING, [p4first, p4retry]);

  // P5: B1' (CR 5845793528) re-run. Oversized first draft; Olumi "Hire Both" reuses the user's 52 stamped explicit on a KNOWN user baseline.
  const b1 = (hireBothProv: string) => {
    const c = covered();
    c.factors[0] = { ...c.factors[0], baseline_known: true, baseline_value: 40, provenance: 'explicit' };
    c.options[0].interventions[0] = est('Engineering delivery capacity', 52, 'story points', 'explicit');
    c.options[2].interventions[0] = est('Engineering delivery capacity', 52, 'story points', hireBothProv);
    return c;
  };
  const shed = (d: Any) => ({ ...d, options: d.options.filter((o: Any) => o.label !== 'Hire Both') });
  await run('P5 B1\' size-only: oversized, Hire Both carries explicit 52; retry sheds Hire Both + speculative', HIRING, [oversized(b1('explicit')), shed(b1('explicit'))]);
  await run('P5-ctrl same with Hire Both 52 ai_proposed', HIRING, [oversized(b1('ai_proposed')), shed(b1('ai_proposed'))]);
  const b1gap = oversized(b1('explicit')); b1gap.options[1] = { ...b1gap.options[1], changes: ['Technical leadership capacity'], interventions: [est('Hiring cost', 110000, 'GBP')] };
  await run('P5-combined: same, first draft has 1 level gap (Tech Lead -> TLC)', HIRING, [b1gap, shed(b1('explicit'))]);

  writeFileSync(OUT, lines.join('\n') + '\n');
}, 120000);
