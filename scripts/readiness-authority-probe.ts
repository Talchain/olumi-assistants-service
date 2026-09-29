/**
 * READINESS AUTHORITY PROBE — the obligation census.
 *
 * ⭐ WHY THIS IS IN THE REPO AND NOT IN `/private/tmp`
 *
 * The divergence probe this replaces lived at an ephemeral scratch path and its
 * recorded run PREDATED the two-term admission gate
 * (`canonical-readiness.ts:338`, 2026-08-16). A probe whose output cannot be
 * re-derived at a later tip is a dated claim, not an instrument — and the table
 * it produced was still being quoted after the code moved underneath it.
 *
 * WHAT IT MEASURES, per corpus graph:
 *   - the ONE admission answer (`resolveRunAdmission(...).willProceed`) and the
 *     route's published fields, side by side, so a divergence is visible rather
 *     than inferred;
 *   - `offers_and_refuses` — the panel offering a Run while presenting
 *     unqualified blockers. This is the founder-witnessed screenshot state;
 *   - the OBLIGATION CENSUS: how many of the blockers a graph raises are
 *     mandatory user obligations, split by the PROVENANCE of the structure they
 *     are raised over. This is the number the P6 invariant is about.
 *
 * ⚠ EPISTEMIC SCOPE. These are DRAFT-PIPELINE COLD READS: real captures, but
 * pre-projection and pre-persistence. The probe therefore reports what readiness
 * says about a freshly drafted model, which is exactly the founder's case ("I
 * couldn't run an analysis on the initial graph"). It is NOT a live wire capture
 * and it is not journey-witnessed. It says nothing about a graph a user has
 * since edited.
 *
 * Run: `pnpm tsx scripts/readiness-authority-probe.ts`
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { assessRouteAdmission } from '../src/cee/graph-readiness/canonical-readiness.js';
import { resolveRunAdmission } from '../src/orchestrator-v5/tools/handlers/analysis-ready-core.js';
import {
  classifyIssueObligation,
  structureProvenance,
} from '../src/cee/graph-readiness/obligation-provenance.js';

const FIXTURE_DIR = 'src/cee/context-integrity/__tests__/fixtures';

interface Row {
  readonly fixture: string;
  readonly nodes: number;
  readonly options: number;
  readonly can_run_analysis: boolean;
  readonly will_scaffold_options: boolean;
  readonly will_proceed: boolean;
  readonly blockers: number;
  readonly obligations_required: number;
  readonly obligations_offered: number;
  readonly waived_by_exclusion: number;
  readonly offers_and_refuses: boolean;
  readonly options_ready: number;
  readonly options_total: number;
  readonly codes: string;
  readonly provenance_split: string;
}

function loadFixtures(): Array<{ name: string; graph: unknown }> {
  const out: Array<{ name: string; graph: unknown }> = [];
  for (const file of readdirSync(FIXTURE_DIR).sort()) {
    if (!file.endsWith('.cold-read.json')) continue;
    const parsed = JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as {
      graph?: unknown;
    };
    if (parsed.graph) out.push({ name: file.replace('.cold-read.json', ''), graph: parsed.graph });
  }
  return out;
}

function census(graph: unknown): Row {
  const route = assessRouteAdmission(graph);
  const admission = resolveRunAdmission(graph);
  const blockers = admission.assessment.blockingIssues;

  let required = 0;
  let offered = 0;
  let waived = 0;
  const split = new Map<string, number>();
  for (const issue of blockers) {
    const decision = classifyIssueObligation(issue, graph, admission.waivedOptionIds);
    if (decision.waived_by_exclusion) waived += 1;
    if (decision.obligation === 'required') required += 1;
    else offered += 1;
    split.set(decision.provenance, (split.get(decision.provenance) ?? 0) + 1);
  }

  const nodes = Array.isArray((graph as { nodes?: unknown[] }).nodes)
    ? ((graph as { nodes: unknown[] }).nodes as Array<{ kind?: string }>)
    : [];

  // The DEPLOYED UI gate, reproduced: allowed = can_run_analysis || will_scaffold_options
  const offersRun = route.can_run_analysis || route.scaffold_plan.will_scaffold_options;

  return {
    fixture: '',
    nodes: nodes.length,
    options: nodes.filter((n) => n.kind === 'option').length,
    can_run_analysis: route.can_run_analysis,
    will_scaffold_options: route.scaffold_plan.will_scaffold_options,
    will_proceed: admission.willProceed,
    blockers: blockers.length,
    obligations_required: required,
    obligations_offered: offered,
    waived_by_exclusion: waived,
    // The harm: a Run is offered AND unqualified obligations are presented.
    offers_and_refuses: offersRun && required > 0,
    options_ready: route.options_ready,
    options_total: route.options_total,
    codes: [...new Set(blockers.map((b) => b.code))].join('+') || '-',
    provenance_split: [...split.entries()].map(([k, v]) => `${k}:${v}`).join(' ') || '-',
  };
}

/**
 * SEEDED ARMS — derived from a real capture by REMOVING configuration.
 *
 * ⚠ REQUIRED, not decorative. The four in-tree cold reads are FULLY CONFIGURED,
 * so the corpus contains ZERO instances of the manufactured-obligation harm. A
 * census over the captures alone would report `required=all, offered=0` and prove
 * nothing about the rule. Per P9 a capability this rare needs a SEEDED witness,
 * and these arms are it — declared as seeded, and derived by subtraction from a
 * real capture rather than written from the author's head.
 *
 * `live-4day-week` is the base because it is the only capture inside CEE's own
 * graph limits (see the LIMITS note printed below).
 */
function seededArms(): Array<{ name: string; graph: unknown }> {
  const base = loadFixtures().find((f) => f.name === 'live-4day-week');
  if (!base) return [];
  const clone = (): { nodes: Array<Record<string, unknown>>; [k: string]: unknown } =>
    JSON.parse(JSON.stringify(base.graph));

  const strip = (ids: readonly string[]) => {
    const graph = clone();
    graph.nodes = graph.nodes.map((n) =>
      n.kind === 'option' && ids.includes(String(n.id)) ? { ...n, interventions: {} } : n,
    );
    if (Array.isArray(graph.options)) {
      graph.options = (graph.options as Array<Record<string, unknown>>).map((o) =>
        ids.includes(String(o.option_id ?? o.id)) ? { ...o, interventions: {} } : o,
      );
    }
    return graph;
  };

  const oneUnconfigured = strip(['opt_phased']);

  const repairEdge = strip(['opt_phased']);
  // The shape `fixStatusQuoConnectivity` emits, replayed from the probe output
  // recorded verbatim at `graph/repair-authored-edge.ts:26-28`.
  (repairEdge.edges as Array<Record<string, unknown>>).push({
    from: 'opt_phased',
    to: 'fac_market_labour',
    provenance: { source: 'cee_hypothesis', reasoning: 'Status-quo option wired to factor' },
    origin: 'repair',
    // ⚠ THE REQUIRED `EdgeV3` KEYS ARE NOT OPTIONAL HERE, and omitting them is not
    // a harmless shortcut: the first version of this arm dropped them, the graph
    // failed `GraphV3.safeParse`, and the whole arm reported `SCHEMA_INVALID` — a
    // uniform refusal that looked like a result. Values copied from a sibling edge
    // in the same capture so the arm differs from it in ORIGIN alone.
    strength: { mean: 0, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive',
    type: 'directed',
  });

  const userStated = strip(['opt_phased']);
  userStated.nodes = userStated.nodes.map((n) => {
    if (n.id === 'opt_phased') {
      return { ...n, interventions: { fac_impl_spend: { value: 0.4, source: 'user_specified' } } };
    }
    if (n.id === 'fac_4day_adoption') {
      return { ...n, observed_state: { value: 0.2, source: 'user_override' } };
    }
    return n;
  });

  const goalLess = clone();
  goalLess.nodes = goalLess.nodes.filter((n) => n.kind !== 'goal');

  return [
    { name: 'SEEDED 1-unconfigured', graph: oneUnconfigured },
    { name: 'SEEDED repair-edge', graph: repairEdge },
    { name: 'SEEDED user-stated gap', graph: userStated },
    { name: 'SEEDED goal-less (D4)', graph: goalLess },
  ];
}

function main(): void {
  const rows: Row[] = [];
  for (const { name, graph } of loadFixtures()) {
    rows.push({ ...census(graph), fixture: name });
  }
  for (const { name, graph } of seededArms()) {
    rows.push({ ...census(graph), fixture: name });
  }

  // A node-provenance census, so a reader can see WHY the obligation split
  // falls where it does rather than taking the split on trust.
  console.log('## NODE PROVENANCE CENSUS (the axis the obligation rule reads)\n');
  for (const { name, graph } of loadFixtures()) {
    const nodes = ((graph as { nodes?: unknown[] }).nodes ?? []) as unknown[];
    const tally = new Map<string, number>();
    for (const node of nodes) {
      const p = structureProvenance(node, graph);
      tally.set(p, (tally.get(p) ?? 0) + 1);
    }
    console.log(`${name.padEnd(20)} ${[...tally.entries()].map(([k, v]) => `${k}:${v}`).join('  ')}`);
  }

  console.log('\n## ADMISSION + OBLIGATION CENSUS\n');
  const header = [
    'fixture',
    'opts',
    'can_run',
    'scaffold',
    'proceed',
    'blockers',
    'REQ',
    'offered',
    'waived',
    'offers&refuses',
    'ready/total',
    'codes',
  ];
  console.log(header.join(' | '));
  for (const r of rows) {
    console.log(
      [
        r.fixture.padEnd(20),
        String(r.options),
        String(r.can_run_analysis),
        String(r.will_scaffold_options),
        String(r.will_proceed),
        String(r.blockers),
        String(r.obligations_required),
        String(r.obligations_offered),
        String(r.waived_by_exclusion),
        String(r.offers_and_refuses),
        `${r.options_ready}/${r.options_total}`,
        r.codes,
      ].join(' | '),
    );
  }

  console.log('\n## PROVENANCE OF EACH GRAPH\'S BLOCKERS\n');
  for (const r of rows) console.log(`${r.fixture.padEnd(20)} ${r.provenance_split}`);

  const totals = rows.reduce(
    (acc, r) => ({
      blockers: acc.blockers + r.blockers,
      required: acc.required + r.obligations_required,
      offered: acc.offered + r.obligations_offered,
      offersAndRefuses: acc.offersAndRefuses + (r.offers_and_refuses ? 1 : 0),
    }),
    { blockers: 0, required: 0, offered: 0, offersAndRefuses: 0 },
  );
  console.log(
    `\nTOTALS  blockers=${totals.blockers}  required=${totals.required}  offered=${totals.offered}  offers_and_refuses_graphs=${totals.offersAndRefuses}/${rows.length}`,
  );
  console.log(
    '\nOBLIGATIONS BEFORE/AFTER: `blockers` is the BEFORE count (every blocker was rendered as a\n' +
      'demand, because nothing distinguished them); `REQ` is the AFTER count. The difference is the\n' +
      'number of times the product would have asked the user to fill in its own inventions.',
  );

  // ⚠ A FINDING THIS PROBE FOUND BY ACCIDENT AND WILL NOT BURY.
  console.log('\n## GRAPH-LIMIT CENSUS (CEE_GRAPH_MAX_NODES=20 / CEE_GRAPH_MAX_EDGES=30 by default)\n');
  for (const { name, graph } of loadFixtures()) {
    const g = graph as { nodes?: unknown[]; edges?: unknown[] };
    const n = g.nodes?.length ?? 0;
    const e = g.edges?.length ?? 0;
    const over = n > 20 || e > 30 ? '  ⚠ OVER LIMIT' : '';
    console.log(`${name.padEnd(20)} nodes=${n} edges=${e}${over}`);
  }
  console.log(
    '\nThree of four REAL captures exceed the assessor\'s own size limits, so readiness refuses them\n' +
      'for SIZE before any value question is reached. That is a separate finding from this lane\'s\n' +
      'scope and is NOT changed here — the limits are a judgement call, not a defect to patch in passing.',
  );
}

main();
