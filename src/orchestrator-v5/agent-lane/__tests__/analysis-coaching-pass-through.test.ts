import assert from 'node:assert/strict';
import { test } from 'vitest';
import { currentAnalysisCoaching, runTurnCoaching } from '../analysis-coaching-pass-through.js';
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
]) test(name,()=>assert.deepEqual(currentAnalysisCoaching({...capture,...change},final),[]));
for (const [name, change] of [
 ['changed graph',{graphHash:'fedcba9876543210'}],
 ['newer same-graph run',{analysisState:{...state,run_state:{kind:'complete_current',computed_at:'2026-09-24T10:01:00.000Z'}}}],
 ['changed permission',{analysisState:{...state,leader_claim:{permitted:true}}}],
 ['same tuple but conflicting leader designation',{analysisResult:{...result,leading_option_id:'another-option'}}],
 ['no canonical result',{analysisResult:undefined}],
]) test(name,()=>assert.deepEqual(currentAnalysisCoaching(capture,{...final,...change}),[]));
test('missing action prompt stays absent',()=>{const plain={...card,action_prompt:undefined};assert.equal(currentAnalysisCoaching({...capture,blocks:[result,plain]},final)[0].action_prompt,undefined)});
test('no analysis result or approval action forwarded',()=>assert.deepEqual(currentAnalysisCoaching({...capture,blocks:[result,card,{type:'approval',id:'wrong-action'}]},final).map(b=>b.type),['coaching']));

// ── run-turn-coaching/v1 (fragile-link challenge) — added beside Track B's controls ──
// strengthen is leader-premised and its fragile-edge action has no agent executor on this lane.
test('strengthen upstream card is not forwarded',()=>assert.deepEqual(currentAnalysisCoaching({...capture,blocks:[result,{...card,coaching_kind:'strengthen'}]},final),[]));
test('strengthen dropped, non-strengthen sibling kept',()=>{const other={...card,block_id:'00000000-0000-4000-8000-000000000002',coaching_kind:'strengthen'};assert.deepEqual(currentAnalysisCoaching({...capture,blocks:[result,other,card]},final),[card])});
test('runTurnCoaching without a trigger forwards upstream coaching and makes no card',()=>assert.deepEqual(runTurnCoaching(capture,final),{blocks:[card],eligibility:{eligible:false,reason:'no_run_this_turn'}}));
test('runTurnCoaching with a trigger but no fragile edges keeps upstream and says why',()=>assert.deepEqual(runTurnCoaching({...capture,trigger:'explicit_run'},final),{blocks:[card],eligibility:{eligible:false,reason:'no_groundable_fragile_edge'}}));
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
