import { readFileSync } from 'node:fs';
import { candidateToGraph } from '../src/orchestrator-v5/path-b/tools/candidate-to-graph.js';
import { approvedGraphHeld } from '../src/orchestrator-v5/agent-lane/runtime/draft-replacement.js';
import { normaliseGraphForIdentity } from '../src/orchestrator-v5/context/graph-identity.js';
const p='/Users/paulslee/olumi-work/recovery/live/runs/2026-10-20T091850Z-marketing-full-core-8d44ed05-00a60452/marketing/';
const raw=JSON.parse(readFileSync(p+'drafter-raw-rows.json','utf8'))[0];
const turn=JSON.parse(readFileSync(p+'turns/01.json','utf8'));
const read=JSON.parse(readFileSync(p+'reads/01-03-before.json','utf8')).body;
const draft=candidateToGraph(JSON.parse(raw.calls[0].raw_text),{words:turn.request_body.message,recorded_at:read.graph.nodes.find((n:any)=>n.user_statements)?.user_statements[0].recorded_at});
if ('refused' in draft) throw Error(draft.refused);
console.log('held',approvedGraphHeld(draft.graph,read.graph));
function diff(a:any,b:any,p='') {if(Array.isArray(a)){if(!Array.isArray(b)){console.log(p,'array missing');return;}if(a.length!==b.length)console.log(p,'LENGTH',a.length,b.length);a.forEach((v,i)=>diff(v,b.find((x:any)=>v?.id ? x.id===v.id : v?.from ? x.from===v.from&&x.to===v.to : false)??b[i],p+`[${v?.id??i}]`));}else if(a&&typeof a==='object'){for(const k of Object.keys(a))diff(a[k],b?.[k],p+'.'+k);}else if(a!==b)console.log(p,JSON.stringify(a),JSON.stringify(b));}
diff(normaliseGraphForIdentity(draft.graph as never)?.graph,normaliseGraphForIdentity(read.graph)?.graph);

import { config } from "../src/config/index.js";
import { buildAtomicCommittedModelVersion } from "../src/orchestrator-v5/commit.js";
config.cee.modelVersionsEnabled = true;
console.log("version", buildAtomicCommittedModelVersion(read.graph,{scenario_id:raw.scenario_id,turn_id:"test",baseGraphForInvariants:null}));
