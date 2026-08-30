import {requiredFactorInputs,comparisonFactorRequirements,selectQuantificationGaps} from './cee/src/cee/factor-quantification/select.ts';
import {adoptFactorEstimates} from './cee/src/cee/factor-quantification/adopt.ts';
import {parseFactorEstimates} from './cee/src/cee/factor-quantification/estimate-response.ts';
import {gateAnalysableOptions} from './cee/src/orchestrator-v5/tools/handlers/analysable-option-gate.ts';
const edge=(from:string,to:string)=>({from,to,strength:{mean:.4,std:.1},exists_probability:.9,effect_direction:'positive'});
for (const kind of ['factor','risk','outcome','action','decision','goal']) {
 const graph:any={nodes:[{id:'parent',kind,label:'Parent',observed_state:{value:.7,source:'user_override'}},{id:'factor',kind:'factor',label:'Intermediate'},{id:'goal',kind:'goal',label:'Goal'}],edges:[edge('parent','factor'),edge('factor','goal')]};
 console.log(JSON.stringify({case:'parent-causal-kind',parentKind:kind,requirements:requiredFactorInputs(graph,[{id:'a',interventions:{}}],'goal')}));
}
const baselineGraph:any={nodes:[{id:'goal',kind:'goal',label:'Goal'},{id:'baseline',kind:'option',label:'Keep current',is_baseline:true},{id:'candidate',kind:'option',label:'Change input',interventions:{factor:.8}},{id:'factor',kind:'factor',label:'Current input',category:'controllable'}],edges:[edge('baseline','factor'),edge('candidate','factor'),edge('factor','goal')]};
const options=baselineGraph.nodes.filter((n:any)=>n.kind==='option');
console.log(JSON.stringify({case:'baseline-gate-gap',gate:gateAnalysableOptions({graph:baselineGraph,rawPersistedGraph:baselineGraph,options,scaleNetEnabled:true}),requirements:comparisonFactorRequirements(baselineGraph,options,'goal')}));
for (const declared_scale of ['unit_interval','ratio','raw_count']) {
 const graph:any={nodes:[{id:'goal',kind:'goal',label:'Goal'},{id:'factor',kind:'factor',label:'Input',observed_state:{value:.5,source:'cee_repair',value_tier:'fallback_default',unit:'agents',cap:100,declared_scale}}],edges:[edge('factor','goal')]};
 const gaps=selectQuantificationGaps(graph,requiredFactorInputs(graph,[{id:'a',interventions:{}}],'goal')).gaps;
 for(const value of [-1,75]) {
  const parsed=parseFactorEstimates({estimates:[{factor_id:'factor',estimate_type:'estimated',value,std:.05,reasoning:'Controlled fixture probe',basis:['b']}]},['factor']);
  if(!parsed.ok)throw new Error(parsed.error);
  const result=adoptFactorEstimates(graph,gaps,parsed.estimates,[{id:'b',text:'Control',kind:'model_context',factor_ids:['factor']}]);
  console.log(JSON.stringify({case:'declared-scale',declared_scale,value,estimated:result.estimated,rejected:result.rejected,observed:result.graph.nodes.find(n=>n.id==='factor')?.observed_state}));
 }
}
