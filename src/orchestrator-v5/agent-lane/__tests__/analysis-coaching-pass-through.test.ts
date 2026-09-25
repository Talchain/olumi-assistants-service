import assert from 'node:assert/strict';
import { test } from 'vitest';
import { currentAnalysisCoaching, runTurnCoaching, type CapturedAnalysis, type RunTurnCoachingFinal } from '../analysis-coaching-pass-through.js';
import { RUN_TURN_COACHING_REASONS } from '../../coaching/fragile-link-challenge.js';
import { runTurnCase } from '../../coaching/__tests__/fragile-link-challenge-fixtures.js';
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
test('runTurnCoaching with a trigger but no robustness keeps upstream and says why',()=>assert.deepEqual(runTurnCoaching({...capture,trigger:'explicit_run'},final),{blocks:[card],eligibility:{eligible:false,reason:'edge_sensitivity_not_evidenced'}}));
test('runTurnCoaching on a foreign graph forwards nothing and says identity_mismatch',()=>assert.deepEqual(runTurnCoaching({...capture,trigger:'explicit_run'},{...final,graphHash:'fedcba9876543210'}),{blocks:[],eligibility:{eligible:false,reason:'identity_mismatch'}}));
test('currentAnalysisCoaching is runTurnCoaching(...).blocks',()=>{for(const c of [capture,{...capture,trigger:'auto_first_pass' as const}]) assert.deepEqual(currentAnalysisCoaching(c,final),runTurnCoaching(c,final).blocks)});
test('the fragile-link card and an upstream copy of it are emitted once',()=>{
 const fragile={...result,enrichment:{robustness:{fragile_edges:[{from_id:'price',to_id:'demand',from_label:'Price',to_label:'Demand',switch_probability:0.4}]}}};
 const first=runTurnCoaching({...capture,blocks:[fragile],trigger:'explicit_run'},{...final,analysisResult:fragile});
 assert.equal(first.blocks.length,1);
 const again=runTurnCoaching({...capture,blocks:[fragile,first.blocks[0]],trigger:'explicit_run'},{...final,analysisResult:fragile});
 assert.deepEqual(again.blocks.map(b=>b.block_id),[first.blocks[0]!.block_id]);
});
test('a readback result computed against another graph forwards nothing, even a card stamped with the final hash',()=>{
 const other='fedcba9876543210';
 assert.deepEqual(runTurnCoaching({...capture,blocks:[result,{...card,graph_hash_at_generation:other}],trigger:'explicit_run'},{...final,graphHash:other}),{blocks:[],eligibility:{eligible:false,reason:'identity_mismatch'}});
});

// ── the no-flagged-link card (coaching/no-flagged-link-card.ts) — the second run-turn card ──
test('RUN_TURN_COACHING_REASONS is the six-reason gate order',()=>assert.deepEqual([...RUN_TURN_COACHING_REASONS],['no_run_this_turn','identity_mismatch','no_groundable_fragile_edge','edge_sensitivity_not_evidenced','claim_not_usable','copy_gate']));
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
