import { tryStateQueryGuard } from './src/orchestrator-v5/routing/state-query-guard.js';
import { findSuccessClaimHit, findForbiddenPhraseHit } from './src/orchestrator-v5/compose/forbidden-user-facing-phrases.js';

console.log('=== does the estate\'s existing success-claim authority catch the M5 mutant string? ===');
for (const t of [
  'Updated: Updated Enterprise sales headcount and spend.',
  'Updated Enterprise sales headcount and spend.',
  'Earlier in this session: Updated Enterprise sales headcount and spend.',
]) console.log(JSON.stringify(t), '-> successClaim=', JSON.stringify(findSuccessClaimHit(t)), 'forbidden=', JSON.stringify(findForbiddenPhraseHit(t)));

const GRAPH = { nodes: [
  { id:'939d4630', kind:'option', label:'Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)', provenance:'ai_inferred' },
  { id:'e405d56a', kind:'option', label:'Status Quo: Hold current strategy', provenance:'ai_inferred' },
  { id:'p1', kind:'option', label:'Enterprise partnerships', provenance:'ai_inferred' },
  { id:'3a75cabd', kind:'factor', label:'Enterprise sales headcount and spend', provenance:'ai_inferred' },
], edges: [] };
const mk=(t:string,s:string)=>({action:'graph_edited' as const,summary:s,target_label:t});

console.log('\n=== C4: match is NOT the head ===');
console.log(JSON.stringify(tryStateQueryGuard({
  message:'Why did you add the Hybrid Phased Approach?',
  contextPack:{recent_changes:[mk('Total cost','Updated Total cost from 1 to 2.'),mk('Hybrid Phased Approach (Pilot Self-Serve, Maintain Enterprise)','Updated Hybrid Phased Approach')]},
  briefAudit:{briefText:null,graph:GRAPH}}),null,1));

console.log('\n=== C2: single incidental token overlap ("Enterprise") ===');
console.log(JSON.stringify(tryStateQueryGuard({
  message:'Why did you add Enterprise partnerships?',
  contextPack:{recent_changes:[mk('Enterprise sales headcount and spend','Updated Enterprise sales headcount and spend')]},
  briefAudit:{briefText:null,graph:GRAPH}}),null,1));
