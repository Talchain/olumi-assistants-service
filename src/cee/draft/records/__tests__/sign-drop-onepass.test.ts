import { describe, expect, it } from 'vitest';
import * as rules from '../stated-dispositions.js';
import type { StatedDisposition } from '../stated-dispositions.js';
import { resolveAnalysisAdmission } from '../../../../orchestrator-v5/admission/analysis-admission.js';
import { statedDispositionsBindingHash, currentStatedDispositionRows } from '../../../../orchestrator-v5/graph/stated-dispositions-binding.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { olumiGuessedGoalLink, olumiGuessedLink } from '../../../../orchestrator/context/placeholder-parts.js';
const assess = (...args: unknown[]) => { expect(typeof (rules as any).assessStatedRules).toBe('function'); return (rules as any).assessStatedRules(...args); };
const carry=(stated_index:number, stated_item:any):StatedDisposition => ({stated_index,stated_item,disposition:'carried',location:{kind:'node',node_id:'p',path:[]},stored_value:{id:'p'}});
function rows(si=-2,so=-300,per=1,kind='change_quantity'):StatedDisposition[] { return [
  carry(0,{kind:'goal',source_quote:'Revenue goal',quantity:0}),
  carry(1,{kind:'option',source_quote:'Raise prices',quantity:1,value:10}),
  carry(2,{kind,source_quote:'loses about 2 customers',quantity:2}),
  carry(3,{kind:'cause',source_quote:'loses about 2 customers',relationship:{from_quantity:1,to_quantity:2,amount:si,per_source_change:1}}),
  carry(4,{kind:'cause',source_quote:'each lost customer removes £300',relationship:{from_quantity:2,to_quantity:0,amount:so,per_source_change:per,per_source_literal:'each lost customer'}}),
]; }
describe('SIGN-1 / DROP-1 typed stated-record authority', () => {
  it('d1 double negatives: one ask with Science exact words',()=>{
    const got=assess(rows()); expect(got.sign_unconfirmed).toHaveLength(1); expect(got.block_leader).toBe(true);
    expect(got.sign_unconfirmed[0]).toMatchObject({stated_index:4,reason:'sign_unconfirmed',ask:"I read 'loses about 2 customers' with 'each lost customer removes £300' as raising prices ADDING £6,000. Right, or does it take £6,000 away?"});
  });
  it.each([[-2,300],[2,-300],[2,300]])('N1/N2/gains %s,%s no flag', (a,b)=>expect(assess(rows(a,b)).sign_unconfirmed).toEqual([]));
  it('mirror determiner (+,+) is flagged',()=>expect(assess(rows(2,-300,-1)).sign_unconfirmed).toHaveLength(1));
  it('non-increment double negatives counted, never guarded',()=>{const got=assess(rows(-2,-300,1,'figure'));expect(got.sign_unconfirmed).toEqual([]);expect(got.non_increment_negative_pairs).toHaveLength(1);});
  it('placeholder withholds even definitional or previously accepted sizing',()=>{
    const e={from:'p',to:'g',provenance:{source:'user_specified',magnitude:'user_stated',definitional:true,sign_unconfirmed:true,sign_unconfirmed_stated_index:4}};
    expect(olumiGuessedLink(e,()=> 'GBP')).toBe(true);expect(olumiGuessedGoalLink(e,()=> 'GBP')).toBe(true);
    expect(olumiGuessedGoalLink(e,()=> 'GBP',[{stated_index:4,reading:'agent_proposed_user_confirmed'}])).toBe(false);
  });
  it('never-minted quantity still blocks along stated path; disclosure reason',()=>{
    const r=rows(2,-300);r[3]={stated_index:3,stated_item:r[3]!.stated_item,disposition:'rejected',reason:'literal_ambiguous'};
    const got=assess(r);expect(got.block_leader).toBe(true);expect(got.dropped).toContainEqual(expect.objectContaining({stated_index:3,quote:'loses about 2 customers',reason:'that figure appears twice in your sentence',on_option_path:true,actions:['Add it','Leave it out']}));
  });
  it('silent no-drop is never positive carried',()=>{const r=rows(2,-300);r[3]={stated_index:3,stated_item:r[3]!.stated_item,disposition:'asked'};expect(assess(r).block_leader).toBe(true);});
  it('unique literal positive receipt clears the block',()=>expect(assess(rows(2,-300)).block_leader).toBe(false));
  it('exogenous drop disclosed without block',()=>{const r=rows(2,-300);r.push({stated_index:5,stated_item:{kind:'cause',source_quote:'Support costs',relationship:{from_quantity:88,to_quantity:89}},disposition:'rejected',reason:'relationship_unsized'});const got=assess(r);expect(got.block_leader).toBe(false);expect(got.dropped).toHaveLength(1);});
  it('no effect honour is positive; no block',()=>{const r=rows(2,-300);r[3]={...r[3],disposition:'rejected',reason:'user_stated_no_effect'} as StatedDisposition;expect(assess(r).block_leader).toBe(false);});
  it('both user acts lift by stated_index through the parameter',()=>{
    const r=rows(2,-300);r[3]={stated_index:3,stated_item:r[3]!.stated_item,disposition:'rejected',reason:'literal_ambiguous'};
    expect(assess(r,[{stated_index:3,reading:'user_set_aside'}]).block_leader).toBe(false);
    expect(assess(rows(),[{stated_index:4,reading:'agent_proposed_user_confirmed'}]).block_leader).toBe(false);
  });
  it('a baseline option referenced by its own index needs no numeric setting to have a stated path',()=>{
    const r=rows(2,-300);r.push(carry(7,{kind:'option',source_quote:'Keep',is_baseline:true}));
    r.push({stated_index:8,stated_item:{kind:'cause',source_quote:'Keep adds nothing',relationship:{from_quantity:7,to_quantity:0}},disposition:'rejected',reason:'relationship_unsized'});
    expect(assess(r).dropped).toContainEqual(expect.objectContaining({stated_index:8,on_option_path:true}));expect(assess(r).block_leader).toBe(true);
  });
  it('option_effect is an option path edge; unsized cause blocks too',()=>{
    const r=rows(2,-300);delete r[1]!.stated_item.quantity;
    r.push(carry(5,{kind:'option_effect',source_quote:'Raise loses customers',option_effect:{option:1,quantity:2,change_by:2,value_literal:'2'}}));
    r[4]={...r[4],disposition:'rejected',reason:'relationship_unsized'} as StatedDisposition;delete r[4]!.stated_item.relationship!.amount;
    expect(assess(r).block_leader).toBe(true);
  });
  it('persisted bound receipt caps Run mode and preserves admission/option values',()=>{
    const r=rows(2,-300);r[3]={stated_index:3,stated_item:r[3]!.stated_item,disposition:'rejected',reason:'literal_ambiguous'};
    const graph={nodes:[{id:'d',kind:'decision',label:'Work'},{id:'g',kind:'goal',label:'Revenue'},
      {id:'p',kind:'factor',label:'Price',observed_state:{value:0.1,source:'brief_extraction'}},
      {id:'raise',kind:'option',label:'Raise',interventions:{p:{value:0.2,source:'brief_extraction'}}},
      {id:'starter',kind:'option',label:'Starter',interventions:{p:{value:0.3,source:'brief_extraction'}}}],
      edges:[['d','raise'],['d','starter'],['raise','p'],['starter','p'],['p','g']].map(([from,to])=>({from,to,strength:{mean:0.5,std:0.01},exists_probability:1,effect_direction:'positive',provenance:{source:'user_specified'}}))};
    const base=resolveAnalysisAdmission(graph);expect(base.permitted_analysis_mode).toBe('comparative_leader');
    const canonical=GraphV3.parse(graph);
    const saved={...canonical,stated_dispositions:{reconciled_against:statedDispositionsBindingHash(canonical),rows:r}};
    const reload=GraphV3.parse(JSON.parse(JSON.stringify(saved)));expect(currentStatedDispositionRows(reload)).toEqual(r);
    const got=resolveAnalysisAdmission(reload);expect(got.structurally_analysable).toBe(base.structurally_analysable);expect(got.permitted_analysis_mode).not.toBe('comparative_leader');
    expect(got.reasons).toContainEqual(expect.objectContaining({code:'STATED_CAUSE_DROPPED',stated_rule:expect.objectContaining({stated_index:3})}));
    expect(reload.nodes.filter(n=>n.kind==='option').map(n=>n.interventions)).toEqual(graph.nodes.filter(n=>n.kind==='option').map(n=>n.interventions));
  });
});
