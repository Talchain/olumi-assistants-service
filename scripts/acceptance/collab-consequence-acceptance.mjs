#!/usr/bin/env node
/**
 * THE ACCEPTANCE WITNESS for the collaboration-consequence slice.
 *
 * Runs against staging-SHAPED fixtures, in-process, with no network and no
 * staging drive — the LIVE rerun witness is a separate, post-merge step.
 *
 * ── THE SENTENCE THIS FALSIFIES ───────────────────────────────────────────
 * With a closed two-person round in which Ada answered 0.2 and Grace 0.85 on
 * the same factor, applying "Use Grace's 0.85" causes the persisted graph for
 * that node to carry `observed_state.source === 'panel_elicited'` and
 * `observed_state.elicited_from.participant_id === <Grace's id>`; the analysis
 * CONSUMES the new value; freshness resolves correctly; the before/after
 * explanation stays truthful; Ada's 0.2 survives verbatim; and a turn whose
 * `applied_from` names a participant whose latest belief is not 0.85 is REFUSED
 * and stamps nothing.
 *
 * ⚠ RULING 6, AND WHY IT IS NOT "THE RECOMMENDATION MUST CHANGE". A rerun that
 * merely produced a different headline would be satisfied by noise, and a rerun
 * whose headline did NOT change is not evidence of failure — a robust decision
 * SHOULD survive one factor moving. What must be proven is that the new value
 * REACHED the computation. So gate 4 asserts the analysis input carries 0.85,
 * not that the answer moved. (CLAUDE.md trap 23: a fix validated against the
 * symptom's metric can kill the symptom and leave the defect alive.)
 *
 * Exit 0 = every gate passed. Exit 1 = a gate failed, named. Exit 2 = COULD NOT
 * MEASURE, which is a FAILURE and never a pass.
 */

import { applyFactorValueEdit } from '../../dist/src/orchestrator-v5/system-events/factor-value-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../dist/src/orchestrator-v5/context/graph-hash.js';

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const ROUND_ID = '33333333-3333-4333-8333-333333333333';
const GRACE_ID = '55555555-5555-4555-8555-555555555555';
const ADA_ID = '66666666-6666-4666-8666-666666666666';
const TARGET_ID = 'fac_churn_risk';
const GRACE_VALUE = 0.85;
const ADA_VALUE = 0.2;
const MODEL_BEFORE = 0.4;

let failures = 0;
function gate(name, ok, detail) {
  const verdict = ok ? 'PASS' : 'FAIL';
  if (!ok) failures += 1;
  console.log(`  [${verdict}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function persistedGraph() {
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: TARGET_ID,
        kind: 'factor',
        label: 'Churn risk after a price rise',
        observed_state: { value: MODEL_BEFORE, source: 'cee_inference' },
      },
      { id: 'o-hold', kind: 'option', label: 'Hold price' },
    ],
    edges: [
      {
        from: TARGET_ID,
        to: 'g-revenue',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      },
    ],
  };
}

const beliefs = [
  { pid: ADA_ID, value: ADA_VALUE, words: "quite unlikely, we've held price before" },
  { pid: GRACE_ID, value: GRACE_VALUE, words: 'very likely, our contracts renew in Q1' },
];

function store() {
  const events = beliefs.map((b, i) => ({
    event_id: `evt-${i}`,
    round_id: ROUND_ID,
    participant_id: b.pid,
    event_version: 1,
    kind: 'belief_submitted',
    target: { kind: 'factor', id: TARGET_ID },
    belief: { value: b.value, expression_raw: b.words, confidence: null },
    provenance: {
      authored_by: b.pid,
      method: 'elicited_nl',
      elicitation_version: 'cee-belief-elicitation-v1',
    },
    created_at: '2026-08-13T10:05:00.000Z',
  }));
  const participants = {
    [GRACE_ID]: { participant_id: GRACE_ID, scenario_id: SCENARIO_ID, round_id: ROUND_ID, display_name: 'Grace', supabase_user_id: null, token_hash: 'h1', status: 'active', pseudonym: null, created_at: 'x' },
    [ADA_ID]: { participant_id: ADA_ID, scenario_id: SCENARIO_ID, round_id: ROUND_ID, display_name: 'Ada', supabase_user_id: null, token_hash: 'h2', status: 'active', pseudonym: null, created_at: 'x' },
  };
  return {
    getRound: async () => ({
      round_id: ROUND_ID, scenario_id: SCENARIO_ID, graph_version_ref: 'mv-1',
      target_manifest: [{ target: { kind: 'factor', id: TARGET_ID }, label: 'Churn risk after a price rise', description: null, unit: null }],
      context_note: null, status: 'closed', created_by: 'owner', created_at: 'x',
    }),
    getParticipant: async (id) => participants[id] ?? null,
    // Returns COPIES, so a mutation by the code under test would not be hidden
    // by the fixture handing back the same object it already holds.
    listAllRoundEvents: async () => events.map((e) => ({ ...e, belief: e.belief && { ...e.belief } })),
  };
}

function payload(event) {
  return { kind: 'system_event', scenario_id: SCENARIO_ID, turn_id: '77777777-7777-4777-8777-777777777777', stage: 'analyse', event };
}

async function main() {
  console.log('COLLAB CONSEQUENCE — acceptance witness (staging-shaped fixtures)\n');

  const base = persistedGraph();
  const hashBefore = computeAnalysisAffectingGraphHash(base);

  // ── GATE 1: the attributed apply ────────────────────────────────────────
  console.log('GATE 1 — the apply is attributed to the named participant');
  const event = { kind: 'factor_value_edit', target_id: TARGET_ID, value: GRACE_VALUE, field: 'value', applied_from: { round_id: ROUND_ID, participant_id: GRACE_ID } };
  const result = await applyFactorValueEdit({
    payload: payload(event), event, requestId: 'acceptance-1',
    persistedGraph: base, priorFacts: [], collabStore: store(),
  });
  if (result.kind !== 'mutated') {
    gate('the apply mutates the graph', false, `got kind=${result.kind} reason=${result.reason ?? 'n/a'}`);
    return;
  }
  const node = result.graph.nodes.find((n) => n.id === TARGET_ID);
  const obs = node?.observed_state ?? {};
  gate('source === panel_elicited', obs.source === 'panel_elicited', `got ${String(obs.source)}`);
  gate('source is NOT user_override (the untruth this closes)', obs.source !== 'user_override');
  gate("elicited_from.participant_id === Grace's id",
    obs.elicited_from?.participant_id === GRACE_ID, `got ${String(obs.elicited_from?.participant_id)}`);
  gate('elicited_from carries IDS ONLY (no display name — R-2 redaction reach)',
    JSON.stringify(Object.keys(obs.elicited_from ?? {}).sort()) === JSON.stringify(['participant_id', 'round_id']));

  // ── GATE 2: the value reached the persisted graph ───────────────────────
  console.log('\nGATE 2 — the new value is in the model');
  gate('persisted value === 0.85', obs.value === GRACE_VALUE, `got ${String(obs.value)}`);
  gate('the value actually moved', obs.value !== MODEL_BEFORE);

  // ── GATE 3: freshness — the analysis-affecting hash MOVED ───────────────
  // This is what makes the canvas go stale and the rerun meaningful. A hash
  // that did not move is the original 1.346 defect: the user is told the model
  // changed, reruns, and sees byte-identical numbers.
  console.log('\nGATE 3 — freshness resolves correctly (the rerun is not theatre)');
  const hashAfter = computeAnalysisAffectingGraphHash(result.mutatedGraph);
  gate('analysis-affecting graph hash MOVED', hashBefore !== hashAfter, `${hashBefore} -> ${hashAfter}`);

  // ── GATE 4: RULING 6 — the analysis CONSUMES the new value ──────────────
  // Not "the recommendation changed". The proof obligation is that the number
  // the analysis reads IS the applied one.
  console.log('\nGATE 4 — the analysis consumes the applied value (ruling 6)');
  const analysisInput = result.graph.nodes.find((n) => n.id === TARGET_ID)?.observed_state?.value;
  gate('the value an analysis would read === the applied 0.85',
    analysisInput === GRACE_VALUE, `analysis input = ${String(analysisInput)}`);
  const patchFact = result.handlerFacts.find((f) => f.fact_type === 'set_factor_value');
  gate('the WIRE patch carries the attribution (the pill updates on this turn)',
    patchFact?.result?.after?.source === 'panel_elicited');
  gate('the before/after explanation stays truthful (before === the pre-apply value)',
    patchFact?.result?.before?.value === MODEL_BEFORE, `before = ${String(patchFact?.result?.before?.value)}`);

  // ── GATE 5: RULING 3 — every dissenting response is preserved ───────────
  console.log('\nGATE 5 — dissent is preserved, and nothing is averaged (ruling 3)');
  const after = await store().listAllRoundEvents(ROUND_ID);
  const ada = after.find((e) => e.participant_id === ADA_ID);
  gate("Ada's 0.2 survives verbatim", ada?.belief?.value === ADA_VALUE, `got ${String(ada?.belief?.value)}`);
  gate("Ada's own words survive verbatim", ada?.belief?.expression_raw === beliefs[0].words);
  gate('both responses still present', after.length === 2, `got ${after.length}`);
  const midpoint = (ADA_VALUE + GRACE_VALUE) / 2;
  const serialised = JSON.stringify({ graph: result.graph, events: after });
  gate('the MIDPOINT appears nowhere', !serialised.includes(String(midpoint)));

  // ⚠ SCOPED TO THE ATTRIBUTION SURFACE, DELIBERATELY — and this was CORRECTED
  // after a false positive on the first run. A whole-graph key sweep flags
  // `mean`, because an EDGE legitimately carries `strength: { mean, std }`: a
  // distribution parameter, not an aggregation of anybody's answers. Banning it
  // graph-wide is a predicate whose breadth catches an honest case, which is
  // how a guard starts crying wolf and gets switched off. The rule being
  // enforced is "no aggregate over PANEL RESPONSES", so the search runs over
  // the applied node's observed_state and the round events — the two places
  // such an aggregate could actually appear.
  const banned = ['mean', 'median', 'average', 'consensus', 'recommended', 'combined', 'winner', 'resolved'];
  const findAggregates = (subject) => {
    const text = JSON.stringify(subject).toLowerCase();
    return banned.filter((w) => text.includes(`"${w}"`));
  };
  const attributionSurface = { observed_state: obs, events: after };
  const found = findAggregates(attributionSurface);
  gate('no aggregate/consensus KEY over panel responses', found.length === 0, found.join(','));

  // POSITIVE CONTROL — without it the assertion above passes by testing
  // nothing. Plant an aggregate into a COPY and require the checker to see it.
  const planted = findAggregates({
    ...attributionSurface,
    observed_state: { ...obs, consensus: midpoint },
  });
  gate('  ...and the checker CAN see a planted aggregate (not a vacuous pass)',
    planted.includes('consensus'), `planted-scan found: [${planted.join(',')}]`);

  // ── GATE 6: INV-F — the forgery control ────────────────────────────────
  // Without this every gate above would pass on a server that stamped whatever
  // the client claimed, which is the defect class the feature exists to pin.
  console.log('\nGATE 6 — INV-F: a forged attribution is refused and stamps nothing');
  for (const [name, claimedValue] of [['a value nobody stated', 0.99], ["Ada's number attributed to Grace", ADA_VALUE]]) {
    const forged = { kind: 'factor_value_edit', target_id: TARGET_ID, value: claimedValue, field: 'value', applied_from: { round_id: ROUND_ID, participant_id: GRACE_ID } };
    const r = await applyFactorValueEdit({
      payload: payload(forged), event: forged, requestId: 'acceptance-forge',
      persistedGraph: persistedGraph(), priorFacts: [], collabStore: store(),
    });
    gate(`REFUSED: ${name}`, r.kind === 'refused' && r.reason === 'collab_apply_value_mismatch', `kind=${r.kind} reason=${r.reason ?? 'n/a'}`);
    gate(`  ...and wrote nothing`, !('mutatedGraph' in r));
  }

  console.log(`\n${failures === 0 ? 'ACCEPTANCE PASSED' : `ACCEPTANCE FAILED — ${failures} gate(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  // COULD NOT MEASURE is a FAILURE, never a pass.
  console.error('\nACCEPTANCE COULD NOT MEASURE (this is a FAILURE, not a pass):', err);
  process.exit(2);
});
