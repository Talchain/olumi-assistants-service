import assert from 'node:assert/strict';
import { test } from 'vitest';
import { CoachingBlockSchema } from '@talchain/schemas/boundary';
import { currentAnalysisCoaching, runTurnCoaching, type CapturedAnalysis, type RunTurnCoachingFinal } from '../analysis-coaching-pass-through.js';
import { RUN_TURN_COACHING_REASONS } from '../../coaching/fragile-link-challenge.js';
import { runTurnCase } from '../../coaching/__tests__/fragile-link-challenge-fixtures.js';
import { buildConstraintDisclosureFromState } from '../../coaching/constraint-gap-disclosure.js';
import { readFileSync } from 'node:fs';
import { fixtureUrl } from '../../coaching/__tests__/fragile-link-challenge-fixtures.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { statedThreshold } from '../../coaching/bound-graph.js';
import { extractCompoundGoals, normaliseConstraintUnits, toGoalConstraints } from '../../../cee/compound-goal/extractor.js';
import { GoalConstraintSchema } from '../../../schemas/assist.js';
const hash = '0123456789abcdef';
const time = '2026-09-24T10:00:00.000Z';
const state = {run_state: {kind: 'complete_current', computed_at: time}, leader_claim: {permitted: false, withheld_reason: 'constraint_verdict_withheld'}};
const result = {type: 'analysis_result', computed_against_hash: hash, summary: 'A provisional comparison.', leading_option_id: null};
const card = {type:'coaching', coaching_kind:'assumption_check', block_id:'00000000-0000-4000-8000-000000000001', signal_id:'coach:example', created_at:time, source_handler:'run_analysis', graph_hash_at_generation:hash, freshness:'fresh', title:'Check this assumption', body:'What evidence supports the stated value?', source:'deterministic_signal', target_refs:[], priority_rank:15, action_label:'Check the evidence', action_prompt:'Help me examine the evidence for this assumption.', dsk_claim_provenance:{claim_id:'DSK-T-001',claim_title:'Synthetic fixture provenance',evidence_strength:'medium'}};
const capture = {scenario_id:'scenario-a', status:200, analysis_state:state, blocks:[result,card]};
const final = {scenarioId:'scenario-a', graphHash:hash, analysisState:state, analysisResult:result};
test('same result forwards exact producer card and action/provenance',()=>assert.strictEqual(currentAnalysisCoaching(capture,final)[0],card));
test('duplicate block identity emits one card',()=>assert.equal(currentAnalysisCoaching({...capture,blocks:[result,card,card]},final).length,1));
for (const [name, change] of [
 ['foreign scenario',{scenario_id:'other'}], ['failed response',{status:500}],
 ['missing state',{analysis_state:undefined}], ['missing calculation time',{analysis_state:{...state,run_state:{kind:'complete_current'}}}],
 ['no producer card',{blocks:[result]}], ['no result',{blocks:[card]}], ['multiple results',{blocks:[result,result,card]}],
 ['stale card',{blocks:[result,{...card,freshness:'stale'}]}], ['unbound card',{blocks:[result,{...card,graph_hash_at_generation:undefined}]}],
 ['legacy review source',{blocks:[result,{...card,source:'decision_review'}]}], ['invalid schema',{blocks:[result,{...card,title:''}]}],
 ['no claim authority',{analysis_state:{...state,leader_claim:{}}}],
] as [string, Partial<CapturedAnalysis>][]) test(name,()=>assert.deepEqual(currentAnalysisCoaching({...capture,...change},final),[]));
for (const [name, change] of [
 ['changed graph',{graphHash:'fedcba9876543210'}],
 ['newer same-graph run',{analysisState:{...state,run_state:{kind:'complete_current',computed_at:'2026-09-24T10:01:00.000Z'}}}],
 ['changed permission',{analysisState:{...state,leader_claim:{permitted:true}}}],
 ['same tuple but conflicting leader designation',{analysisResult:{...result,leading_option_id:'another-option'}}],
 ['no canonical result',{analysisResult:undefined}],
] as [string, Partial<RunTurnCoachingFinal>][]) test(name,()=>assert.deepEqual(currentAnalysisCoaching(capture,{...final,...change}),[]));
test('missing action prompt stays absent',()=>{const plain={...card,action_prompt:undefined};assert.equal(currentAnalysisCoaching({...capture,blocks:[result,plain]},final)[0].action_prompt,undefined)});
test('no analysis result or approval action forwarded',()=>assert.deepEqual(currentAnalysisCoaching({...capture,blocks:[result,card,{type:'approval',id:'wrong-action'}]},final).map(b=>b.type),['coaching']));

// ── run-turn-coaching/v1 (fragile-link challenge) — added beside Track B's controls ──
// strengthen is leader-premised and its fragile-edge action has no agent executor on this lane.
test('strengthen upstream card is not forwarded',()=>assert.deepEqual(currentAnalysisCoaching({...capture,blocks:[result,{...card,coaching_kind:'strengthen'}]},final),[]));
test('strengthen dropped, non-strengthen sibling kept',()=>{const other={...card,block_id:'00000000-0000-4000-8000-000000000002',coaching_kind:'strengthen'};assert.deepEqual(currentAnalysisCoaching({...capture,blocks:[result,other,card]},final),[card])});
test('runTurnCoaching without a trigger forwards upstream coaching and makes no card',()=>assert.deepEqual(runTurnCoaching(capture,final),{blocks:[card],eligibility:{eligible:false,reason:'no_run_this_turn'}}));
// No robustness at all: neither run-turn card, and the reason is that the per-link test is not evidenced.
// The synthetic `state` above withholds the leader FOR A LIMIT (constraint_verdict_withheld). Tests about the LINK
// cards use a near-tie claim, so the limit-first rule (#70) does not decide them.
const nearTieState = {...state, leader_claim: {permitted:false, withheld_reason:'options_do_not_separate', separation:'near_tie'}};
const nearTie = {capture:{...capture, analysis_state:nearTieState}, final:{...final, analysisState:nearTieState}};
test('runTurnCoaching with a trigger but no robustness keeps upstream and says why (leader not withheld for a limit)',()=>assert.deepEqual(runTurnCoaching({...nearTie.capture,trigger:'explicit_run'},nearTie.final),{blocks:[card],eligibility:{eligible:false,reason:'edge_sensitivity_not_evidenced'}}));
test('runTurnCoaching with a trigger and a leader withheld FOR A LIMIT keeps upstream and adds the one limit card, robustness or not',()=>{
 const out=runTurnCoaching({...capture,trigger:'explicit_run'},final);
 assert.deepEqual(out.eligibility,{eligible:true});
 assert.equal(out.blocks.length,2);
 assert.strictEqual(out.blocks[0],card);
 assert.ok(out.blocks[1]!.signal_id.startsWith('coach:limit_unchecked:'));
});
test('runTurnCoaching on a foreign graph forwards nothing and says identity_mismatch',()=>assert.deepEqual(runTurnCoaching({...capture,trigger:'explicit_run'},{...final,graphHash:'fedcba9876543210'}),{blocks:[],eligibility:{eligible:false,reason:'identity_mismatch'}}));
test('currentAnalysisCoaching is runTurnCoaching(...).blocks',()=>{for(const c of [capture,{...capture,trigger:'auto_first_pass' as const}]) assert.deepEqual(currentAnalysisCoaching(c,final),runTurnCoaching(c,final).blocks)});
test('the fragile-link card and an upstream copy of it are emitted once',()=>{
 const fragile={...result,enrichment:{robustness:{fragile_edges:[{from_id:'price',to_id:'demand',from_label:'Price',to_label:'Demand',switch_probability:0.4}]}}};
 const first=runTurnCoaching({...nearTie.capture,blocks:[fragile],trigger:'explicit_run'},{...nearTie.final,analysisResult:fragile});
 assert.equal(first.blocks.length,1);
 assert.ok(first.blocks[0]!.signal_id.startsWith('coach:fragile_link:'));
 const again=runTurnCoaching({...nearTie.capture,blocks:[fragile,first.blocks[0]],trigger:'explicit_run'},{...nearTie.final,analysisResult:fragile});
 assert.deepEqual(again.blocks.map(b=>b.block_id),[first.blocks[0]!.block_id]);
});
test('a readback result computed against another graph forwards nothing, even a card stamped with the final hash',()=>{
 const other='fedcba9876543210';
 assert.deepEqual(runTurnCoaching({...capture,blocks:[result,{...card,graph_hash_at_generation:other}],trigger:'explicit_run'},{...final,graphHash:other}),{blocks:[],eligibility:{eligible:false,reason:'identity_mismatch'}});
});

// ── the no-flagged-link card (coaching/no-flagged-link-card.ts) — the second run-turn card ──
test('RUN_TURN_COACHING_REASONS is the seven-reason gate order',()=>assert.deepEqual([...RUN_TURN_COACHING_REASONS],['no_run_this_turn','identity_mismatch','limit_repair_pending','no_groundable_fragile_edge','edge_sensitivity_not_evidenced','claim_not_usable','copy_gate']));
test('a served run with no fragile link (c10) adds exactly one no-flagged-link card after the forwarded upstream card',()=>{
 const c=runTurnCase('c10','t5','explicit_run');
 const upstream={...card,block_id:'00000000-0000-4000-8000-0000000000c1',graph_hash_at_generation:c.turn.graph_hash,created_at:c.turn.analysis_state.run_state.computed_at};
 const out=runTurnCoaching({...c.captured,blocks:[...c.captured.blocks!,upstream]},c.final);
 assert.deepEqual(out.eligibility,{eligible:true});
 assert.equal(out.blocks.length,2);
 assert.strictEqual(out.blocks[0],upstream);
 assert.ok(out.blocks[1]!.signal_id.startsWith('coach:no_flagged_link:'));
 assert.deepEqual(out.blocks.filter(b=>b.signal_id.startsWith('coach:no_flagged_link:')||b.signal_id.startsWith('coach:fragile_link:')).length,1);
 // Upstream forwarding is unchanged by the new card: without a trigger the same upstream card is forwarded alone.
 const {trigger:_t,...untriggered}=c.captured;
 assert.deepEqual(runTurnCoaching({...untriggered,blocks:[...c.captured.blocks!,upstream]},c.final),{blocks:[upstream],eligibility:{eligible:false,reason:'no_run_this_turn'}});
});

// ── a WITHHELD claim: the run response is gated, the graph read is not (served 25 Sep, CEE 7f9a16d) ──
// On an entitled near tie the v2 send-point gate nulls the run response's `leading_option_id`
// (leading-option-wire-enforcement.ts:659-670), while the graph read keeps the fact's id
// (compose.ts:1275,1348). ONE run then reads null vs "<id>", and the served hiring Run got no
// run-turn card (`identity_mismatch`) although it is exactly the no-flagged-link card's case.
const NEAR_TIE_CLAIM = {permitted:false, withheld_reason:'options_do_not_separate', separation:'near_tie'};
const withClaim = (c: ReturnType<typeof runTurnCase>, claim: unknown, capturedLeader: unknown, readbackLeader: unknown) => {
 const capturedResult = {...(c.captured.blocks![0] as Record<string, unknown>), leading_option_id: capturedLeader};
 return {
  captured: {...c.captured, analysis_state: {...(c.captured.analysis_state as object), leader_claim: claim}, blocks: [capturedResult]} as CapturedAnalysis,
  final: {...c.final, analysisState: {...(c.final.analysisState as object), leader_claim: claim}, analysisResult: {...(c.final.analysisResult as object), leading_option_id: readbackLeader}} as RunTurnCoachingFinal,
 };
};
test('NEAR-TIE: a gated capture (leader null) binds to the ungated readback of the SAME run → the no-flagged-link card ships',()=>{
 const {captured,final}=withClaim(runTurnCase('c10','t5','explicit_run'),NEAR_TIE_CLAIM,null,'opt_leader');
 const out=runTurnCoaching(captured,final);
 assert.deepEqual(out.eligibility,{eligible:true});
 assert.equal(out.blocks.filter(b=>b.signal_id.startsWith('coach:no_flagged_link:')).length,1);
});
test('NEAR-TIE: a near tie WITH a fragile link (c19-C) ships the fragile-link card, unbadged',()=>{
 const {captured,final}=withClaim(runTurnCase('C','A2r','explicit_run'),NEAR_TIE_CLAIM,null,'opt_leader');
 const out=runTurnCoaching(captured,final);
 assert.deepEqual(out.eligibility,{eligible:true});
 const cards=out.blocks.filter(b=>b.signal_id.startsWith('coach:fragile_link:'));
 assert.equal(cards.length,1);
 assert.equal(Object.hasOwn(cards[0]!,'dsk_claim_provenance'),false);
});
test('WITHHELD: the builders see the designation as the gate leaves it — a clear winner under a withheld claim ships WITHOUT the badge',()=>{
 // c16 earns the DSK-P-003 badge when the leader is permitted (BADGE-2). Under a withheld claim the
 // user is not shown a leader, so the badge (which asserts "a clear winner") must not ride on the
 // ungated readback id. The near-tie reason is what licenses the bind; the badge must still read
 // the designation as the gate leaves it (null), whatever the robustness block says.
 const {captured,final}=withClaim(runTurnCase('c16','t5','explicit_run'),NEAR_TIE_CLAIM,null,'opt_leader');
 const out=runTurnCoaching(captured,final);
 assert.deepEqual(out.eligibility,{eligible:true});
 const cards=out.blocks.filter(b=>b.signal_id.startsWith('coach:fragile_link:'));
 assert.equal(cards.length,1);
 assert.equal(Object.hasOwn(cards[0]!,'dsk_claim_provenance'),false);
});
test('CONTROL (present): the same c16 run with a permitted claim and equal designations keeps its badge',()=>{
 const c=runTurnCase('c16','t5','explicit_run');
 const out=runTurnCoaching(c.captured,c.final);
 const cards=out.blocks.filter(b=>b.signal_id.startsWith('coach:fragile_link:'));
 assert.equal(cards.length,1);
 assert.equal(Object.hasOwn(cards[0]!,'dsk_claim_provenance'),true);
});
for (const [name, claim, capturedLeader, readbackLeader] of [
 ['withheld claim, two different designations', NEAR_TIE_CLAIM, 'opt_a', 'opt_b'],
 ['PERMITTED claim, capture null vs readback id (the gate does not null a permitted leader)', {permitted:true, separation:'separated'}, null, 'opt_a'],
 ['withheld claim, capture names a leader the readback does not (not the gate\'s edit)', NEAR_TIE_CLAIM, 'opt_a', null],
 ['separation NOT EVALUATED (separation_unavailable) — no verdict, so no relaxation', {permitted:false, withheld_reason:'separation_unavailable'}, null, 'opt_a'],
 ['constraint-withheld — no entitlement, the graph read nulls too, so an id there is a conflict', {permitted:false, withheld_reason:'constraint_verdict_withheld'}, null, 'opt_a'],
] as [string, unknown, unknown, unknown][]) test(`CONTROL still refuses: ${name}`,()=>{
 const {captured,final}=withClaim(runTurnCase('c10','t5','explicit_run'),claim,capturedLeader,readbackLeader);
 assert.deepEqual(runTurnCoaching(captured,final),{blocks:[],eligibility:{eligible:false,reason:'identity_mismatch'}});
});

// ── ONE next action (AI Conversation #69 5834275139, served OpenAI Run "C2 run" c673223) ──
// When the run's OWN summary asks the user to repair a limit, that step IS the turn's next action:
// no run-turn card (fragile-link or no-flagged-link) competes with it. Upstream forwarding is unchanged.
// The summaries below are PRODUCER-GENERATED by coaching/constraint-gap-disclosure.ts, not typed here.
const PA = {constraint_id:'agent-lane:annual_pa_salary:<=', label:'PA Salary < 40000£/year'};
const DEADLINE_ROW = {constraint_id:'agent-lane:hire_by:<=', label:'Hire by March'};
const withSummary = (c: ReturnType<typeof runTurnCase>, summary: string) => ({
 captured: {...c.captured, blocks: c.captured.blocks!.map((b) => (b as {type?: string})?.type === 'analysis_result' ? {...(b as object), summary} : b)} as CapturedAnalysis,
 final: {...c.final, analysisResult: {...(c.final.analysisResult as object), summary}} as RunTurnCoachingFinal,
});
const runCards = (blocks: readonly {signal_id: string}[]) => blocks.filter((b) => b.signal_id.startsWith('coach:fragile_link:') || b.signal_id.startsWith('coach:no_flagged_link:'));
test('ONE next action: a summary asking the user to restate an unresolved limit (singular) withholds the fragile-link card (c16)',()=>{
 const c=runTurnCase('c16','t5','explicit_run');
 const step=buildConstraintDisclosureFromState('identity_unresolved',[PA]);
 assert.match(step,/run the analysis again/);
 const {captured,final}=withSummary(c,'Ran analysis on your current scenario.'+step);
 const out=runTurnCoaching(captured,final);
 assert.deepEqual(out.eligibility,{eligible:false,reason:'limit_repair_pending'});
 assert.equal(runCards(out.blocks).length,0);
});
test('ONE next action: the plural restate step withholds the no-flagged-link card too (c10)',()=>{
 const c=runTurnCase('c10','t5','explicit_run');
 const {captured,final}=withSummary(c,'Ran analysis on your current scenario.'+buildConstraintDisclosureFromState('identity_unresolved',[PA,DEADLINE_ROW]));
 const out=runTurnCoaching(captured,final);
 assert.deepEqual(out.eligibility,{eligible:false,reason:'limit_repair_pending'});
 assert.equal(runCards(out.blocks).length,0);
});
test('ONE next action: a read-back fact persisted BEFORE #1912 (legacy restate promise, base c74a4327 :303) also withholds the card',()=>{
 const c=runTurnCase('c16','t5','explicit_run');
 const legacy=' One limit on your model could not be checked: “PA Salary < 40000£/year”. We could not line it up with anything this analysis measures, so it was not part of the comparison. Tell me the limit you meant in your own words and I will record it; this one stays on the model. Then run the analysis again.';
 const out=runTurnCoaching(...Object.values(withSummary(c,'Ran analysis on your current scenario.'+legacy)) as [CapturedAnalysis,RunTurnCoachingFinal]);
 assert.deepEqual(out.eligibility,{eligible:false,reason:'limit_repair_pending'});
});
// ⚠ CORRECTED (#70, R&C): this #1922 control splices a "could not be checked" disclosure onto a PERMITTED claim
// (c16 t5). That pairing cannot occur on the wire — an unevaluated limit withholds the claim
// (constraint-feasibility.ts MAY_NAME_LEADING_OPTION.unevaluated === false). It now pins the OTHER half of the
// limit-first rule: prose alone never decides — only the typed claim routes to the limit card (the served pairing
// is the LIMIT FIRST pricing test above).
test('CONTROL (Paul\'s PA case, served 7b42d63+): limit PROSE on a permitted claim does not route to the limit card — the typed claim decides',()=>{
 const c=runTurnCase('c16','t5','explicit_run');
 const noStep=buildConstraintDisclosureFromState('unevaluated',[PA]);
 assert.match(noStep,/could not be checked/);
 assert.doesNotMatch(noStep,/run the analysis again/);
 const out=runTurnCoaching(...Object.values(withSummary(c,'Ran analysis on your current scenario.'+noStep)) as [CapturedAnalysis,RunTurnCoachingFinal]);
 assert.deepEqual(out.eligibility,{eligible:true});
 assert.equal(runCards(out.blocks).length,1);
});
test('CONTROL: a summary with no limit sentence keeps the card (c10 no-flagged-link)',()=>{
 const c=runTurnCase('c10','t5','explicit_run');
 const out=runTurnCoaching(...Object.values(withSummary(c,'Ran analysis on your current scenario.')) as [CapturedAnalysis,RunTurnCoachingFinal]);
 assert.deepEqual(out.eligibility,{eligible:true});
 assert.equal(runCards(out.blocks).length,1);
});

// ── LIMIT FIRST (Paul's manual test 1a298d6d, #69 5837270934; #70 R&C lane) ──
// A run whose leader is withheld for a LIMIT — the readback's typed `leader_claim.withheld_reason` is
// `constraint_verdict_withheld`, i.e. at least one limit on the model was not checked or not met — offers ONE
// next action: the limit card. No link card (fragile-link or no-flagged-link) competes with it. It is read from
// the READBACK's typed claim, never from prose: the automatic first pass replaces the prose summary
// (compose/unrequested-analysis-confinement.ts), so a prose gate is blind exactly where Paul met the card.
// Every input below is a SERVED wire turn (coaching/__tests__/fixtures/*.run-turns.trimmed.json).
const LIMIT_CARD = 'coach:limit_unchecked:';
const runTurnCards = <T extends {signal_id: string}>(blocks: readonly T[]): T[] =>
 blocks.filter((b) => /^coach:(fragile_link|no_flagged_link|limit_unchecked|near_tie):/.test(b.signal_id));
const statelessCapture = (c: CapturedAnalysis): CapturedAnalysis => { const {analysis_state: _s, ...rest} = c; return rest; };
const claimOf = (f: RunTurnCoachingFinal) => (f.analysisState as {leader_claim?: {withheld_reason?: string}}).leader_claim;

test('LIMIT FIRST — Paul 1a298d6d (served bdd43f4, automatic first pass): the served link card becomes ONE limit card',()=>{
 const c=runTurnCase('paul','t1','auto_first_pass');
 // Present controls from the SAME wire turn: the served build emitted a link card, and the claim is limit-withheld.
 assert.ok(c.turn.served_run_turn_cards?.[0]?.startsWith('coach:fragile_link:pro_plan_price→mrr:449b882e043ae3e3:'));
 assert.equal(claimOf(c.final)?.withheld_reason,'constraint_verdict_withheld');
 // The automatic pass hands over a capture with NO analysis_state (the stateless bind); the stateful shape binds too.
 for (const captured of [statelessCapture(c.captured), c.captured]) {
  const out=runTurnCoaching(captured,c.final);
  assert.deepEqual(out.eligibility,{eligible:true});
  const cards=runTurnCards(out.blocks);
  assert.equal(cards.length,1);
  assert.equal(cards[0]!.signal_id,`${LIMIT_CARD}449b882e043ae3e3:2026-09-25T17:27:54.315Z:auto_first_pass`);
 }
});
for (const [turn, trigger] of [['t1','auto_first_pass'],['t2','explicit_run']] as const) test(`LIMIT FIRST — pricing (served 06325c6), ${trigger}: ONE limit card, no link card`,()=>{
 const c=runTurnCase('pricing',turn,trigger);
 assert.ok(c.turn.served_run_turn_cards?.[0]?.startsWith('coach:fragile_link:'));
 assert.equal(claimOf(c.final)?.withheld_reason,'constraint_verdict_withheld');
 const out=runTurnCoaching(trigger==='auto_first_pass'?statelessCapture(c.captured):c.captured,c.final);
 assert.deepEqual(out.eligibility,{eligible:true});
 const cards=runTurnCards(out.blocks);
 assert.equal(cards.length,1);
 assert.ok(cards[0]!.signal_id.startsWith(`${LIMIT_CARD}c247337beab725ed:${c.turn.analysis_state.run_state.computed_at}:`));
 assert.ok(cards[0]!.signal_id.endsWith(`:${trigger}`));
});
for (const [turn, trigger, why] of [['t1','auto_first_pass','withheld only because nobody asked'],['t2','explicit_run','a near tie']] as const) test(`CONTROL — hiring (served 4809203), ${why}: no limit problem, so its ONE link card stays`,()=>{
 const c=runTurnCase('hiring',turn,trigger);
 assert.notEqual(claimOf(c.final)?.withheld_reason,'constraint_verdict_withheld');
 const out=runTurnCoaching(trigger==='auto_first_pass'?statelessCapture(c.captured):c.captured,c.final);
 assert.deepEqual(out.eligibility,{eligible:true});
 const cards=runTurnCards(out.blocks);
 assert.equal(cards.length,1);
 assert.ok(cards[0]!.signal_id.startsWith('coach:fragile_link:effective_delivery_capacity→development_velocity:d06fe842d1150682:'));
});
test('LIMIT FIRST — the limit card is a well-formed run-turn card: bound, leader-free, number-free, no badge, no write intent',()=>{
 const c=runTurnCase('paul','t1','auto_first_pass');
 const card=runTurnCards(runTurnCoaching(statelessCapture(c.captured),c.final).blocks)[0]!;
 assert.ok(card.signal_id.startsWith(LIMIT_CARD));
 assert.equal(card.type,'coaching');
 assert.equal(card.coaching_kind,'assumption_check');
 assert.equal(card.source,'deterministic_signal');
 assert.equal(card.source_handler,'run_analysis');
 assert.equal(card.freshness,'fresh');
 assert.equal(card.graph_hash_at_generation,'449b882e043ae3e3');
 assert.equal(card.created_at,'2026-09-25T17:27:54.315Z');
 assert.deepEqual(card.target_refs,[]);
 assert.equal(Object.hasOwn(card,'dsk_claim_provenance'),false);
 assert.equal(Object.hasOwn(card,'action_intent'),false);
 for (const text of [card.title,card.body,card.action_label??'',card.action_prompt??'']) {
  assert.doesNotMatch(text,/option in front|winner|recommend|best option|leading option/i);
  assert.doesNotMatch(text,/\d/);
 }
 // It must not promise a write the Agent cannot make, nor ask for a number the engine may not be able to use.
 assert.match(card.action_prompt??'',/Don't change the model or re-run anything/);
 // Deterministic: the same run gives the same card, and an upstream copy of it is emitted once.
 const again=runTurnCoaching({...c.captured,blocks:[...c.captured.blocks!,card]},c.final);
 assert.deepEqual(runTurnCards(again.blocks).map(b=>b.block_id),[card.block_id]);
});
test('LIMIT FIRST — the prose repair step still wins: a summary asking the user to restate a limit gives limit_repair_pending and NO card',()=>{
 const c=runTurnCase('pricing','t2','explicit_run');
 const {captured,final}=withSummary(c,'Ran analysis on your current scenario.'+buildConstraintDisclosureFromState('identity_unresolved',[PA]));
 const out=runTurnCoaching(captured,final);
 assert.deepEqual(out.eligibility,{eligible:false,reason:'limit_repair_pending'});
 assert.equal(runTurnCards(out.blocks).length,0);
});

// ── NAMED LIMIT (PR-2a): the limit card names THE limit, from the readback graph bound by hash ──
// The route hands `final.graph` (the readback's own graph, agent-v1-turn.ts:1628). The card uses it ONLY when
// computeAnalysisAffectingGraphHash(graph) === final.graphHash, and names a limit ONLY when exactly one limit
// node is on the model — joined by `goal_constraints[].node_id` → that NODE's label, never by free text.
// Otherwise the PR-1 generic words ship. Both graphs below are the WHOLE served draft graphs, byte-identical.
const graphFixture = (name: string) => (JSON.parse(readFileSync(fixtureUrl(name), 'utf8')) as {graph: Record<string, unknown>}).graph;
const PAUL_GRAPH = graphFixture('cbd15f83-bdd43f4-paul.draft-graph.json');
const PRICING_T2_GRAPH = graphFixture('pricing-7212945c-06325c6.t2.draft-graph.json');
test('NAMED LIMIT — Paul 1a298d6d: with its own hash-bound graph the one card names "Monthly churn" (card and prompt)',()=>{
 const c=runTurnCase('paul','t1','auto_first_pass');
 // Present control: the graph's one limit row joins to the node "Monthly churn".
 assert.deepEqual((PAUL_GRAPH.goal_constraints as {node_id: string}[]).map(r=>r.node_id),['monthly_churn']);
 const out=runTurnCoaching(statelessCapture(c.captured),{...c.final,graph:PAUL_GRAPH});
 assert.deepEqual(out.eligibility,{eligible:true});
 const cards=runTurnCards(out.blocks);
 assert.equal(cards.length,1);
 assert.equal(cards[0]!.signal_id,`${LIMIT_CARD}449b882e043ae3e3:2026-09-25T17:27:54.315Z:auto_first_pass:named`);
 // The user's own stated threshold (row: explicit, <=, 10, 'percent per month'), joined by node_id, said back.
 assert.match(cards[0]!.body,/your limit on “Monthly churn” \(10 percent per month\): it was not checked or not met\./);
 assert.match(cards[0]!.action_prompt??'',/my limit on “Monthly churn” \(10 percent per month\)/);
 // Olumi adds no figure of its own: the only digits are the user's stated threshold.
 assert.doesNotMatch((cards[0]!.body+(cards[0]!.action_prompt??'')).split('(10 percent per month)').join(''),/\d/);
});
test('NAMED LIMIT — the second brief (pricing explicit Run, served 06325c6) names its limit too',()=>{
 const c=runTurnCase('pricing','t2','explicit_run');
 const cards=runTurnCards(runTurnCoaching(c.captured,{...c.final,graph:PRICING_T2_GRAPH}).blocks);
 assert.equal(cards.length,1);
 assert.ok(cards[0]!.signal_id.endsWith(':explicit_run:named'));
 assert.match(cards[0]!.body,/^This analysis could not confirm that the options stay within your limit on “Monthly churn”/);
});
test('NAMED LIMIT — no graph, ANOTHER turn\'s graph, or an unbindable graph → the generic words, never a guessed name',()=>{
 const c=runTurnCase('paul','t1','auto_first_pass');
 const generic=runTurnCards(runTurnCoaching(statelessCapture(c.captured),c.final).blocks)[0]!;
 assert.ok(generic.signal_id.endsWith(':auto_first_pass'));
 for (const [why, graph] of [['another turn\'s graph (pricing, hash c247337beab725ed)',PRICING_T2_GRAPH],['not a graph',{nodes:'x'}],['empty',{}]] as [string, unknown][]) {
  const cards=runTurnCards(runTurnCoaching(statelessCapture(c.captured),{...c.final,graph}).blocks);
  assert.equal(cards.length,1,why);
  assert.equal(cards[0]!.signal_id,generic.signal_id,why);
  assert.equal(cards[0]!.body,generic.body,why);
 }
});
test('NAMED LIMITS — two limit nodes → the card names BOTH, never one of them (no typed per-limit verdict says which)',()=>{
 const c=runTurnCase('paul','t1','auto_first_pass');
 const two=structuredClone(PAUL_GRAPH) as Record<string, any>;
 // A DERIVED mutation of the served graph (labelled): a second limit on another node. The hash no longer
 // matches, so the test re-points the readback hash at the mutated graph through the real hash function.
 two.goal_constraints=[...two.goal_constraints,{...two.goal_constraints[0],constraint_id:'agent-lane:mrr:>=',node_id:'mrr',operator:'>=',label:'MRR'}];
 const hash=computeAnalysisAffectingGraphHash(two as never)!;
 const result={...(c.final.analysisResult as object),computed_against_hash:hash};
 const cards=runTurnCards(runTurnCoaching({...statelessCapture(c.captured),blocks:[result]},{...c.final,graphHash:hash,analysisResult:result,graph:two}).blocks);
 assert.equal(cards.length,1);
 assert.ok(cards[0]!.signal_id.endsWith(':auto_first_pass:named'));
 assert.equal(cards[0]!.title,'Check your limits before relying on this');
 // Both rows are the agent lane's own (explicit, user units), so each name carries the user's stated figure.
 assert.match(cards[0]!.body,/your limits on “Monthly churn” \(10 percent per month\) and “MRR” \(10 percent per month\): at least one was not checked or not met\./);
 assert.match(cards[0]!.action_prompt??'',/my limits on “Monthly churn” \(10 percent per month\) and “MRR” \(10 percent per month\): at least one was not checked or was not met/);
 assert.equal(cards[0]!.action_label,'What this means for my limits');
});
// DERIVED mutations of the served graph (labelled), re-hashed through the real hash function so the bind holds.
const rebind = (c: ReturnType<typeof runTurnCase>, graph: Record<string, unknown>) => {
 const hash=computeAnalysisAffectingGraphHash(graph as never)!;
 const result={...(c.final.analysisResult as object),computed_against_hash:hash};
 return {captured:{...statelessCapture(c.captured),blocks:[result]} as CapturedAnalysis, final:{...c.final,graphHash:hash,analysisResult:result,graph}};
};
// ── STATED THRESHOLD (Delivery Lead 5841804719: F3 deterministic) — the user's own limit, said back by identity ──
test('STATED THRESHOLD — said back only when the user stated it, in a level frame, at a scale the ROW proves',()=>{
 // A user-units writer's row (the agent lane mints `agent-lane:…`, add_constraint `gc-…`).
 const row={constraint_id:'agent-lane:n:<=',node_id:'n',operator:'<=',value:10,unit:'% per month',provenance:'explicit'};
 assert.equal(statedThreshold(row),'10% per month');
 assert.equal(statedThreshold({...row,constraint_id:'gc-1f2e',unit:'%',value:5}),'5%');
 assert.equal(statedThreshold({...row,operator:'>=',value:400000,unit:'£'}),'£400,000');
 assert.equal(statedThreshold({...row,unit:'hours'}),'10 hours');
 assert.equal(statedThreshold({...row,unit:undefined}),'10');
 assert.equal(statedThreshold({...row,value_frame:'level'}),'10% per month');
 // An audit trail naming the user's original proves the scale, whoever wrote the row.
 assert.equal(statedThreshold({...row,constraint_id:'constraint_n_max',value:0.1,unit:'fraction',provenance_unit_normalised:{rule:'percent_to_fraction',original_value:10,original_unit:'%'}}),'10%');
 // Non-percent units are unambiguous from any writer.
 assert.equal(statedThreshold({...row,constraint_id:'constraint_n_min',operator:'>=',value:400000,unit:'£'}),'£400,000');
 // Refused: not the user's statement, a change frame, a bare fraction, a bad operator/value, and a PERCENT whose
 // scale the row does not prove (the compound-goal extractor stores 200% as `2` under '%': never say "2%").
 for (const [why,bad] of [['inferred',{...row,provenance:'inferred'}],['proxy',{...row,provenance:'proxy'}],['no provenance',{...row,provenance:undefined}],['delta frame',{...row,value_frame:'delta'}],['bare fraction',{...row,value:0.1,unit:'fraction'}],['operator',{...row,operator:'=='}],['NaN',{...row,value:Number.NaN}],['string value',{...row,value:'10'}],['extractor percent',{...row,constraint_id:'constraint_n_min',operator:'>=',value:2,unit:'%'}],['percent, no id',{...row,constraint_id:undefined}],['percent word',{...row,constraint_id:'constraint_n_max',unit:'percent per month'}],['basis points',{...row,constraint_id:'constraint_n_max',unit:'bps'}]] as [string,Record<string,unknown>][]) assert.equal(statedThreshold(bad),null,why);
});
test('STATED THRESHOLD — fed from the PRODUCTION compound-goal extractor: "at least 200%" is never said back as "2%" (#1948 review)',()=>{
 for (const [brief,forbidden] of [['Revenue growth must be at least 200%.',/\b2%/],['Utilisation must stay under 100%.',/\b1%/],['ROI must be at least 150%. Keep monthly churn under 10%.',/\b1\.5%/]] as [string,RegExp][]) {
  const rows=toGoalConstraints(normaliseConstraintUnits(extractCompoundGoals(brief).constraints)).map((r)=>GoalConstraintSchema.parse(r));
  // Present control: the extractor DID produce a percent-scale row (otherwise the check below is vacuous).
  assert.ok(rows.some((r)=>typeof r.unit==='string'&&/%|fraction/.test(r.unit)),brief);
  for (const r of rows) {
   const said=statedThreshold(r as unknown as Record<string, unknown>);
   assert.ok(said===null||!forbidden.test(said),`${brief} → ${said}`);
   if (r.unit==='%'||r.unit==='fraction') assert.equal(said,null,`${brief}: an extractor percent row proves no scale`);
  }
 }
});
test('STATED THRESHOLD — two rows on one node: the node is named, no threshold said (which one would it be?)',()=>{
 const c=runTurnCase('paul','t1','auto_first_pass');
 const g=structuredClone(PAUL_GRAPH) as Record<string, any>;
 g.goal_constraints=[g.goal_constraints[0],{...g.goal_constraints[0],constraint_id:'agent-lane:monthly_churn:>=',operator:'>=',value:1}];
 const {captured,final}=rebind(c,g);
 const card=runTurnCards(runTurnCoaching(captured,final).blocks)[0]!;
 assert.match(card.body,/your limit on “Monthly churn”: it was not checked or not met\./);
 assert.doesNotMatch(card.body,/\d/);
});
test('STATED THRESHOLD — a threshold the copy gates refuse (a raw decimal) falls back to the NAME, never to the generic words',()=>{
 const c=runTurnCase('paul','t1','auto_first_pass');
 const g=structuredClone(PAUL_GRAPH) as Record<string, any>;
 g.goal_constraints=[{...g.goal_constraints[0],value:0.5,unit:''}];
 const {captured,final}=rebind(c,g);
 const card=runTurnCards(runTurnCoaching(captured,final).blocks)[0]!;
 // Present control: the stated form exists and is refused by the gates.
 assert.equal(statedThreshold(g.goal_constraints[0]),'0.5');
 assert.ok(card.signal_id.endsWith(':named'));
 assert.match(card.body,/your limit on “Monthly churn”: it was not checked or not met\./);
});
const withLimitsOn = (nodeIds: string[]) => {
 const g=structuredClone(PAUL_GRAPH) as Record<string, any>;
 const row=g.goal_constraints[0];
 g.goal_constraints=nodeIds.map((id,i)=>({...row,constraint_id:`agent-lane:${id}:${i}`,node_id:id}));
 return g;
};
test('NAMED LIMITS — three limit nodes are all named, in the rows\' order; four → the generic words',()=>{
 const c=runTurnCase('paul','t1','auto_first_pass');
 const three=runTurnCards(runTurnCoaching(rebind(c,withLimitsOn(['monthly_churn','pro_subscribers','mrr'])).captured,rebind(c,withLimitsOn(['monthly_churn','pro_subscribers','mrr'])).final).blocks)[0]!;
 assert.match(three.body,/your limits on “Monthly churn”, “Pro subscribers” and “MRR”: at least one was not checked or not met\. That is one reason/);
 // The long prompt would exceed the 300-char bound here, so the short form ships: every name, and the no-write ask.
 assert.match(three.action_prompt??'',/my limits on “Monthly churn”, “Pro subscribers” and “MRR”: at least one was not checked or was not met\. Explain/);
 assert.match(three.action_prompt??'',/Don't change the model or re-run anything yet\.$/);
 assert.ok(three.signal_id.endsWith(':named'));
 const four=rebind(c,withLimitsOn(['monthly_churn','pro_subscribers','mrr','pro_plan_price']));
 const generic=runTurnCards(runTurnCoaching(four.captured,four.final).blocks)[0]!;
 assert.ok(generic.signal_id.endsWith(':auto_first_pass'));
 assert.doesNotMatch(generic.body,/“/);
});
test('NAMED LIMITS — two rows on ONE node name it once (singular); two nodes sharing a label → the generic words',()=>{
 const c=runTurnCase('paul','t1','auto_first_pass');
 const same=rebind(c,withLimitsOn(['monthly_churn','monthly_churn']));
 const one=runTurnCards(runTurnCoaching(same.captured,same.final).blocks)[0]!;
 assert.match(one.body,/your limit on “Monthly churn”: it was not checked or not met\./);
 const g=withLimitsOn(['monthly_churn','pro_subscribers']);
 (g.nodes as {id: string; label: string}[]).find(n=>n.id==='pro_subscribers')!.label='Monthly churn';
 const dup=rebind(c,g);
 const card=runTurnCards(runTurnCoaching(dup.captured,dup.final).blocks)[0]!;
 assert.ok(card.signal_id.endsWith(':auto_first_pass'));
 assert.doesNotMatch(card.body,/“/);
});
test('NAMED LIMIT — the name is the NODE\'s label (joined by node_id), never the limit row\'s free text',()=>{
 const c=runTurnCase('paul','t1','auto_first_pass');
 const g=structuredClone(PAUL_GRAPH) as Record<string, any>;
 g.goal_constraints=[{...g.goal_constraints[0],label:'Churn ceiling I typed'}];
 const {captured,final}=rebind(c,g);
 const card=runTurnCards(runTurnCoaching(captured,final).blocks)[0]!;
 assert.match(card.body,/“Monthly churn”/);
 assert.doesNotMatch(card.body,/Churn ceiling I typed/);
});
test('NAMED LIMIT — a user\'s own figure in the label ("Churn ≤ 4%") is quoted verbatim; the card adds no figure of its own',()=>{
 const c=runTurnCase('paul','t1','auto_first_pass');
 const g=structuredClone(PAUL_GRAPH) as Record<string, any>;
 const node=g.nodes.find((n: {id: string})=>n.id==='monthly_churn'); node.label='Churn ≤ 4%';
 const {captured,final}=rebind(c,g);
 const card=runTurnCards(runTurnCoaching(captured,final).blocks)[0]!;
 assert.ok(card.signal_id.endsWith(':auto_first_pass:named'));
 for (const words of [card.body, card.action_prompt??'']) {
  assert.match(words,/“Churn ≤ 4%” \(10 percent per month\)/);
  // Every digit sits inside the user's quoted label or the user's own stated threshold.
  assert.doesNotMatch(words.split('“Churn ≤ 4%” (10 percent per month)').join(''),/\d/);
 }
});
test('NAMED LIMIT — a node label the copy gates refuse (a raw decimal) ships the generic words, still ONE limit card',()=>{
 const c=runTurnCase('paul','t1','auto_first_pass');
 const g=structuredClone(PAUL_GRAPH) as Record<string, any>;
 const node=g.nodes.find((n: {id: string})=>n.id==='monthly_churn'); node.label='Churn at 0.5 per month';
 const {captured,final}=rebind(c,g);
 const out=runTurnCoaching(captured,final);
 assert.deepEqual(out.eligibility,{eligible:true});
 const cards=runTurnCards(out.blocks);
 assert.equal(cards.length,1);
 assert.ok(cards[0]!.signal_id.endsWith(':auto_first_pass'));
 assert.doesNotMatch(cards[0]!.body,/“/);
});

// ── ASSUMED LINK (PR-3): a link card on a link whose numbers are Olumi's says so ──
// Construction stamps a link `defaulted: true` when any of its numbers were projected, with provenance
// `cee_hypothesis` (Olumi proposed the link) or `brief_extraction` (the brief stated the link; its numbers were
// projected) — agent-lane/admit-candidate.ts. On such a link the card says "some of its numbers are Olumi's starting
// assumptions" and asks what the user believes, instead of pressure-testing "the estimate" as if it were theirs.
// Any other or unknown source keeps the neutral card: unknown provenance never becomes an asserted origin.
const HIRING_GRAPH = graphFixture('hiring-fc9312a3-4809203.draft-graph.json');
// Only the assumed card's words (body: "some of its numbers are [Olumi's ]starting assumptions"; prompt names Olumi).
const ASSUMED = /starting assumptions/;
for (const [turn, trigger] of [['t1','auto_first_pass'],['t2','explicit_run']] as const) test(`ASSUMED LINK — hiring (served 4809203), ${trigger}: the link card on an Olumi-assumed link says so, with no science badge`,()=>{
 const c=runTurnCase('hiring',turn,trigger);
 // Present control from the SAME graph: the grounded link is defaulted and Olumi-proposed.
 const edge=(HIRING_GRAPH.edges as {from: string; to: string; defaulted?: boolean; provenance?: {source?: string}}[]).find(e=>e.from==='effective_delivery_capacity'&&e.to==='development_velocity')!;
 assert.equal(edge.defaulted,true); assert.equal(edge.provenance?.source,'cee_hypothesis');
 const out=runTurnCoaching(trigger==='auto_first_pass'?statelessCapture(c.captured):c.captured,{...c.final,graph:HIRING_GRAPH});
 assert.deepEqual(out.eligibility,{eligible:true});
 const cards=runTurnCards(out.blocks);
 assert.equal(cards.length,1);
 assert.ok(cards[0]!.signal_id.startsWith('coach:fragile_link:effective_delivery_capacity→development_velocity:d06fe842d1150682:'));
 assert.ok(cards[0]!.signal_id.endsWith(`:${trigger}:assumed`));
 assert.match(cards[0]!.body,ASSUMED);
 assert.match(cards[0]!.action_prompt??'',ASSUMED);
 assert.equal(Object.hasOwn(cards[0]!,'dsk_claim_provenance'),false);
 for (const text of [cards[0]!.title,cards[0]!.body,cards[0]!.action_label??'',cards[0]!.action_prompt??'']) {
  assert.doesNotMatch(text,/option in front|winner|recommend|best option|leading option/i);
  assert.doesNotMatch(text,/options compare|could change|could shift|which option|modest|small change|slight|likely|overturn|flip|swap|switch|reverse|tip/i);
 }
});
test('ASSUMED LINK — no graph, or ANOTHER turn\'s graph → the neutral link card (unchanged)',()=>{
 const c=runTurnCase('hiring','t1','auto_first_pass');
 const neutral=runTurnCards(runTurnCoaching(statelessCapture(c.captured),c.final).blocks)[0]!;
 assert.ok(neutral.signal_id.endsWith(':auto_first_pass'));
 assert.doesNotMatch(neutral.body,ASSUMED);
 const other=runTurnCards(runTurnCoaching(statelessCapture(c.captured),{...c.final,graph:PAUL_GRAPH}).blocks)[0]!;
 assert.equal(other.signal_id,neutral.signal_id);
 assert.equal(other.body,neutral.body);
});
// DERIVED mutations of the served hiring graph (labelled), re-hashed through the real hash function.
const hiringWith = (mutateEdge: (e: Record<string, any>) => void, extra: (g: Record<string, any>) => void = () => {}) => {
 const c=runTurnCase('hiring','t1','auto_first_pass');
 const g=structuredClone(HIRING_GRAPH) as Record<string, any>;
 mutateEdge(g.edges.find((e: any)=>e.from==='effective_delivery_capacity'&&e.to==='development_velocity'));
 extra(g);
 const {captured,final}=rebind(c,g);
 return runTurnCards(runTurnCoaching(captured,final).blocks);
};
for (const [why, mutate, assumed] of [
 ['a link the user set (user_specified), even still stamped defaulted', (e: any)=>{ e.provenance={source:'user_specified'}; }, false],
 ['a user override', (e: any)=>{ e.provenance={source:'user_override'}; }, false],
 ['an UNKNOWN source (never asserted as Olumi\'s)', (e: any)=>{ e.provenance={source:'composer'}; }, false],
 ['no provenance at all', (e: any)=>{ delete e.provenance; }, false],
 ['not defaulted (every number stated)', (e: any)=>{ delete e.defaulted; }, false],
 ['defaulted:false', (e: any)=>{ e.defaulted=false; }, false],
 ['a brief-stated link whose numbers Olumi projected (brief_extraction + defaulted)', (e: any)=>{ e.provenance={source:'brief_extraction'}; }, true],
] as [string, (e: any)=>void, boolean][]) test(`ASSUMED LINK — ${why} → ${assumed?'the assumed card':'the neutral card'}`,()=>{
 const cards=hiringWith(mutate);
 assert.equal(cards.length,1);
 assert.equal(cards[0]!.signal_id.endsWith(':assumed'),assumed);
 assert.equal(ASSUMED.test(cards[0]!.body),assumed);
});
test('ASSUMED LINK — two graph links with the same endpoints → the neutral card (join by identity, exactly one)',()=>{
 const cards=hiringWith(()=>{},(g)=>{ const e=g.edges.find((x: any)=>x.from==='effective_delivery_capacity'&&x.to==='development_velocity'); g.edges.push({...structuredClone(e),id:'dup-edge'}); });
 assert.equal(cards.length,1);
 assert.equal(cards[0]!.signal_id.endsWith(':assumed'),false);
});
test('ASSUMED LINK — a graph that is NOT the run\'s (an extra link, hash differs) is never read: the neutral card',()=>{
 const c=runTurnCase('hiring','t1','auto_first_pass');
 const g=structuredClone(HIRING_GRAPH) as Record<string, any>;
 g.edges.push({...structuredClone(g.edges[0]),id:'extra-edge',from:'effective_delivery_capacity',to:g.edges[0].from});
 // Present control: the changed graph really has a different analysis-affecting hash, and still carries the assumed link.
 assert.notEqual(computeAnalysisAffectingGraphHash(g as never),c.final.graphHash);
 const cards=runTurnCards(runTurnCoaching(statelessCapture(c.captured),{...c.final,graph:g}).blocks);
 assert.equal(cards.length,1);
 assert.equal(cards[0]!.signal_id.endsWith(':assumed'),false);
});

// ── NEAR TIE (R&C PR-6; AI Quality 5841805590's five conditions) — the first pass's one move on a close call ──
// Served 26 Sep (CEE 3829c96, hiring): automatic first pass, near_tie.is_tie with ZERO fragile rows → NO card.
const TIE_CARD = 'coach:near_tie:';
const tieCase = () => { const c=runTurnCase('hiring_tie','t1','auto_first_pass'); return {c, captured: statelessCapture(c.captured), final: c.final}; };
const tieResult = (f: RunTurnCoachingFinal) => f.analysisResult as {computed_against_hash: string; enrichment: Record<string, any>};
const retie = (mutate: (r: {computed_against_hash: string; enrichment: Record<string, any>}, state: Record<string, any>) => void, trigger: 'auto_first_pass'|'explicit_run' = 'auto_first_pass') => {
 const {c}=tieCase();
 const result=structuredClone(c.final.analysisResult) as {computed_against_hash: string; enrichment: Record<string, any>};
 const state=structuredClone(c.final.analysisState) as Record<string, any>;
 mutate(result,state);
 const captured={...statelessCapture(c.captured),blocks:[result],trigger} as CapturedAnalysis;
 return runTurnCoaching(captured,{...c.final,analysisResult:result,analysisState:state});
};
test('NEAR TIE — served hiring 3829c96 first pass (near tie, 0 fragile links, NO card served) → ONE card asking which difference matters most',()=>{
 const {c,captured,final}=tieCase();
 // Present controls, from the SAME served turn: the typed tie, zero fragile rows, a computed comparison, and no card served.
 const rb=tieResult(final).enrichment.robustness;
 assert.equal(rb.near_tie.is_tie,true); assert.deepEqual(rb.fragile_edges,[]); assert.ok(rb.robust_edges.length>0);
 assert.equal(tieResult(final).enrichment.option_comparison_status,'computed');
 assert.deepEqual((c.fixture as any).turns.t1.served_run_turn_cards,[]);
 const out=runTurnCoaching(captured,final);
 assert.deepEqual(out.eligibility,{eligible:true});
 const cards=runTurnCards(out.blocks);
 assert.equal(cards.length,1);
 const card=cards[0]!;
 assert.equal(CoachingBlockSchema.safeParse(card).success,true);
 assert.equal(card.signal_id,`${TIE_CARD}${final.graphHash}:${(final.analysisState as any).run_state.computed_at}:auto_first_pass`);
 assert.equal(card.coaching_kind,'widening');
 assert.deepEqual(card.target_refs,[]);
 // Condition 2: three options and a TOP-TWO gap → "the strongest options", never "the options"; no option named.
 assert.equal(card.body,"On Olumi's estimates the strongest options come out close, so this first pass cannot separate them. Worth saying which difference between them matters most to you.");
 assert.equal(card.action_label,'Say what matters most to me');
 for (const text of [card.title,card.body,card.action_label??'',card.action_prompt??'']) {
  for (const o of (c.turn.analysis_ready as any).options as {label: string}[]) assert.ok(!text.includes(o.label),o.label);
  assert.doesNotMatch(text,/\d|%|equally|no difference|same|option in front|winner|recommend|best option|leading option/i);
  // Condition 5: the ask is the user's criterion, never "add data and we'll separate them".
  assert.doesNotMatch(text,/re-?run to|add (more )?data|we('|’)ll separate|will separate/i);
 }
 assert.match(card.action_prompt??'',/Ask me which difference between them matters most to me, and why\. Don't change the model or re-run anything yet\.$/);
});
test('NEAR TIE — conditions 1 and 4: no tie, a flagged link, a missing or partial comparison, or an unproven identity sign → no near-tie card',()=>{
 const cases: [string,(r: any, s: any)=>void][] = [
  ['not a tie',(r)=>{r.enrichment.robustness.near_tie.is_tie=false;}],
  ['is_tie not a boolean',(r)=>{r.enrichment.robustness.near_tie.is_tie='true';}],
  ['fragile rows unobservable',(r)=>{delete r.enrichment.robustness.fragile_edges;}],
  ['comparison partial',(r)=>{r.enrichment.option_comparison_status='partial';}],
  ['comparison absent',(r)=>{delete r.enrichment.option_comparison_status;}],
  ['identity sign unproven (C46)',(_r,s)=>{s.leader_claim.withheld_reason='nonlinear_identity_sign_unproven';}],
  ['a VISIBLE normaliser error (a fragile row may be missing)',(r)=>{r.enrichment.robustness.normalization_errors=[{edge_type:'fragile',error:'bad row'}];}],
  ['normalization_errors not a list',(r)=>{r.enrichment.robustness.normalization_errors='bad';}],
 ];
 for (const [why,m] of cases) {
  const out=retie(m);
  assert.equal(runTurnCards(out.blocks).filter(b=>b.signal_id.startsWith(TIE_CARD)).length,0,why);
  assert.equal(out.eligibility.eligible,false,why);
 }
 // Present control: the unmutated turn does fire (the loop above is not vacuous).
 assert.equal(runTurnCards(retie(()=>{}).blocks).filter(b=>b.signal_id.startsWith(TIE_CARD)).length,1);
});
test('NEAR TIE — a flagged link on the same tie keeps the LINK card; a limit keeps the LIMIT card (the tie never outranks them)',()=>{
 const {c}=tieCase();
 const robust=tieResult(c.final).enrichment.robustness.robust_edges[0];
 const withLink=retie((r)=>{r.enrichment.robustness.fragile_edges=[{...robust,alternative_winner_id:null,alternative_winner_label:null}];});
 assert.equal(runTurnCards(withLink.blocks).filter(b=>b.signal_id.startsWith(TIE_CARD)).length,0);
 const withLimit=retie((_r,s)=>{s.leader_claim={permitted:false,withheld_reason:'constraint_verdict_withheld'};});
 const cards=runTurnCards(withLimit.blocks);
 assert.equal(cards.length,1);
 assert.ok(cards[0]!.signal_id.startsWith(LIMIT_CARD));
});
test('NEAR TIE — an EXPLICIT Run on the same tie gets no near-tie card (the permission covers the automatic first pass)',()=>{
 const out=retie((r)=>{delete r.enrichment.run_provenance;},'explicit_run');
 assert.equal(runTurnCards(out.blocks).filter(b=>b.signal_id.startsWith(TIE_CARD)).length,0);
});
test('NEAR TIE — with exactly two options the card says "the two options"',()=>{
 const {c,final}=tieCase();
 const ready=structuredClone(c.captured.analysis_ready) as any; ready.options=ready.options.slice(0,2);
 const out=runTurnCoaching({...statelessCapture(c.captured),analysis_ready:ready},final);
 assert.match(runTurnCards(out.blocks)[0]!.body,/^On Olumi's estimates the two options come out close/);
});
