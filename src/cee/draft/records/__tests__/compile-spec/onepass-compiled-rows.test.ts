import { buildModelFromRecords } from '../../../../../orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import { projectGraphForPersistence } from '../../../../../orchestrator-v5/persisted-graph-projection.js';
import { assignEntityRefs } from '../../../../../orchestrator-v5/graph/entity-refs.js';
import { withRegisteredStatedDispositions } from '../../../../../routes/assist.v1.scenario-graph-register.js';
import { describe, expect, it } from 'vitest';
import { projectDraftRecords } from '../../seam.js';
import { sealedRecordsVNextLinked, BRIEF } from './sealed-fixture-vnext.js';
import { assessStatedRules } from '../../stated-dispositions.js';
import { transformGraphToV3 } from '../../../../transforms/schema-v3.js';
import { GraphV3 } from '../../../../../schemas/cee-v3.js';
import { olumiGuessedGoalLink } from '../../../../../orchestrator/context/placeholder-parts.js';
import { resolveAnalysisAdmission } from '../../../../../orchestrator-v5/admission/analysis-admission.js';
import { statedDispositionsBindingHash } from '../../../../../orchestrator-v5/graph/stated-dispositions-binding.js';
function compile(incoming:number,outgoing:number,per=1,ambiguous=false) {
  const r=sealedRecordsVNextLinked();
  const increment=r.stated_items[9]!;
  const q=r.stated_items.length;
  r.stated_items.push({kind:'change_quantity',source_quote:increment.source_quote,quantity:q,quantity_label:incoming<0?'Customers':'Lost customers',unit:'customers',unit_literals:['customers']});
  increment.quantity=q;
  increment.relationship!.to_quantity=q;
  r.stated_items[10]!.relationship!.from_quantity=q;
  for(const c of r.claims) if(c.quantity===9)c.quantity=q;
  const a=increment.relationship!;a.amount=incoming;a.range={...a.range!,low:incoming<0?-4:1,high:incoming<0?-1:4,
    low_literal:incoming<0?'4':'between 1',high_literal:incoming<0?'between 1':'4'};
  r.stated_items[10]!.relationship!.amount=outgoing;r.stated_items[10]!.relationship!.per_source_change=per;
  r.stated_items[10]!.relationship!.per_source_literal='Each';
  if(ambiguous){a.per_source_literal='1';}
  const result=projectDraftRecords(r,BRIEF);expect(result.ok).toBe(true);if(!result.ok)throw Error(result.detail);
  return { ...result.projection, records:r };
}
/** Independent raw-unit path sum, over the compiler's executable graph, using IDs throughout. */
function values(p:ReturnType<typeof compile>) {
  const byId=new Map(p.graph.nodes.map(n=>[n.id,n]));
  const goal=p.graph.nodes.find(n=>n.kind==='goal')!;
  const next=new Map<string,{to:string;rate:number}[]>();
  for(const e of p.graph.edges){const ne=e.provenance?.natural_effect;if(!ne)continue;const xs=next.get(e.from)??[];xs.push({to:e.to,rate:ne.amount/ne.per_source_change});next.set(e.from,xs);}
  function contribution(id:string,delta:number,seen=new Set<string>()):number {
    if(id===goal.id)return delta;if(seen.has(id))throw Error('cycle');const visited=new Set(seen).add(id);
    return (next.get(id)??[]).reduce((sum,e)=>sum+contribution(e.to,delta*e.rate,visited),0);
  }
  const out=new Map<string,number>();
  for(const o of p.graph.nodes.filter(n=>n.kind==='option')){
    let v=goal.goal_baseline_raw!;
    for(const [fid,raw] of Object.entries((o.data?.intervention_details??{}) as Record<string,any>)){
      const baseline=byId.get(fid)?.observed_state?.raw_value as number|undefined;
      const delta=raw.change_by??(raw.raw_value-(baseline??0));v+=contribution(fid,delta);
    }
    out.set(o.id,v);
  }
  return {out,raise:p.graph.nodes.find(n=>n.kind==='option'&&n.provenance?.source_quote==='raise prices by 10%')!.id,
    starter:p.graph.nodes.find(n=>n.kind==='option'&&n.provenance?.source_quote==='launch a starter tier at £49 a month')!.id};
}
describe('Science compiled SIGN / DROP rows, typed increment with no providers',()=>{
  it('d1 retains the wrong arithmetic but flags sign and withholds the placeholder licence after V3 read',async()=>{
    const p=compile(-2,-300);const got=assessStatedRules(p.stated_dispositions!);
    let registered:any;
    const built=await buildModelFromRecords('11111111-1111-4111-8111-111111111111',BRIEF,async(path,body)=>{
      if(path.endsWith('/graph/register')){registered=body;return {status:200,json:{model_version:1}};}
      if(path.endsWith('/graph'))return {status:200,json:{graph:{nodes:[],edges:[]}}};
      throw Error(path);
    },async()=>({text:JSON.stringify(p.records),status:'completed'}));
    expect(built.ok).toBe(true);
    const stored=withRegisteredStatedDispositions(assignEntityRefs(projectGraphForPersistence(registered.graph),null).graph,registered.stated_dispositions);
    const runtime=resolveAnalysisAdmission(JSON.parse(JSON.stringify(stored)));
    {const v=values(p);console.log('SIGN-WITNESS',JSON.stringify({winner:[...v.out].sort((a,b)=>b[1]-a[1])[0],raise_id:v.raise,starter_id:v.starter,blocked:got.block_leader,mode:runtime.permitted_analysis_mode,admitted:runtime.structurally_analysable}));}
    expect(got.sign_unconfirmed).toHaveLength(1);
    expect(runtime.structurally_analysable).toBe(true);expect(runtime.permitted_analysis_mode).not.toBe('comparative_leader');
    const row=p.stated_dispositions!.find(r=>r.stated_index===10)!;expect(row.disposition).toBe('carried');
    expect(values(p).out.get(values(p).raise)).toBe(138000);
    const raw=transformGraphToV3(p.graph as never).graph;const saved=GraphV3.parse(JSON.parse(JSON.stringify(raw)));
    const e=saved.edges.find(e=>e.provenance?.sign_unconfirmed===true)!;expect(e).toBeDefined();
    expect(olumiGuessedGoalLink(e as never,()=>undefined)).toBe(true);
    const bound={...saved,stated_dispositions:{reconciled_against:statedDispositionsBindingHash(saved),rows:p.stated_dispositions}};
    expect(resolveAnalysisAdmission(bound).permitted_analysis_mode).not.toBe('comparative_leader');
  });
  it.each([[-2,300],[2,-300]])('N1/N2 %s,%s: Raise 126000; Starter leads by id', (a,b)=>{
    const p=compile(a,b);expect(assessStatedRules(p.stated_dispositions!).sign_unconfirmed).toEqual([]);
    const v=values(p);expect(v.out.get(v.raise)).toBe(126000);expect(v.out.get(v.starter)).toBe(127350);
    expect([...v.out].sort((a,b)=>b[1]-a[1])[0]![0]).toBe(v.starter);
  });
  it('(+,+) gains have no flag',()=>expect(assessStatedRules(compile(2,300).stated_dispositions!).sign_unconfirmed).toEqual([]));
  it('mirror determiner remains flagged after compile',()=>expect(assessStatedRules(compile(2,-300,-1).stated_dispositions!).sign_unconfirmed).toHaveLength(1));
  it('ambiguous literal drops a stated relationship; unique literal carries it',()=>{
    const p=compile(2,-300,1,true),good=compile(2,-300);
    expect(assessStatedRules(p.stated_dispositions!).block_leader).toBe(true);
    expect(assessStatedRules(p.stated_dispositions!).dropped).toContainEqual(expect.objectContaining({stated_index:9,code:'literal_ambiguous'}));
    expect(good.stated_dispositions!.find(r=>r.stated_index===9)!.disposition).toBe('carried');
    const v=values(good);expect([...v.out].sort((a,b)=>b[1]-a[1])[0]![0]).toBe(v.starter);
  });
});
