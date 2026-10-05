import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import frozen from './fixtures/grammar-vcurrent.strict.json';
import { sealedRecords, BRIEF } from './sealed-fixture.js';
import { sealedRecordsVNext } from './sealed-fixture-vnext.js';
import { buildDraftRecordsSchema, buildVNextDraftRecordsSchema, measureDraftRecordsSchemaBudget, type DraftRecordSet } from '../../grammar.js';
import { projectDraftRecords, findGrammarFieldsDroppedBySeam } from '../../seam.js';
import { buildStrictDraftRecordsSchema, omitOptionalRecordNulls, buildModelFromRecords } from '../../../../../orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import { V_NEXT_DRAFT_RECORDS_INSTRUCTION } from '../../instruction-vnext.js';
import { projectionFingerprint } from '../../projector.js';
import { sameUnit } from '../../../../../orchestrator-v5/agent-lane/same-unit.js';
import { sizeLink } from '../../../../magnitude/link-effect.js';
import { targetTestabilityOf } from '../../../../../orchestrator-v5/admission/target-testability.js';
import { holdsByDefinition, nodeUnitOf } from '../../../../../orchestrator/context/placeholder-parts.js';
import { resolveAnalysisAdmission } from '../../../../../orchestrator-v5/admission/analysis-admission.js';
import { projectGraphForPersistence } from '../../../../../orchestrator-v5/persisted-graph-projection.js';
import { assignEntityRefs } from '../../../../../orchestrator-v5/graph/entity-refs.js';
import { buildFactorScaleMap, projectRequestInterventionsToWireScale } from '../../../../../orchestrator-v5/tools/plot-intervention-scale.js';
import { defaultFrameFor, framedObservedState } from '../../../../../orchestrator-v5/agent-lane/admit-model.js';

function project(records: DraftRecordSet, brief = BRIEF) {
  const r = projectDraftRecords(records, brief); expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.detail); return r.projection;
}
/** Typed read of an option's per-lever binding receipts (the projector types `data` as an open record). */
function details(node: { data?: Record<string, unknown> } | undefined): Record<string, any> | undefined {
  return node?.data?.intervention_details as Record<string, any> | undefined;
}
function edgeFor(p: ReturnType<typeof project>, index: number, records: DraftRecordSet) {
  return p.graph.edges.find(e => e.provenance?.source_quote === records.stated_items[index]!.source_quote);
}
function materialise(value: any, node: any): any {
  const s = node.anyOf?.find((x: any) => x.type !== 'null') ?? node;
  if (Array.isArray(value)) return value.map(x => materialise(x, s.items));
  if (!s.properties || value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(s.properties).map(([k,v]) => [k,k in value && value[k] !== undefined ? materialise(value[k],v) : null]));
}
async function registered(records = sealedRecordsVNext()) {
  let body: any;
  const result = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', BRIEF,
    async (path, b) => { if (path.endsWith('/register')) { body=b; return {status:200,json:{model_version:1}}; } return {status:200,json:{graph:{nodes:[],edges:[]}}}; },
    async () => ({text:JSON.stringify(records),status:'completed'}));
  expect(result.ok).toBe(true); return body;
}
// EXTRACTION-UNPROVEN: authored delivery-vans evidence proves compilation only.
const VANS = 'We have 8 vans. We make 640 deliveries every month. Lease 5 vans. Adding 5 vans changes deliveries by 18 to 36 every month. Repainting 5 vans will not change deliveries. Goal: at least 900 deliveries every month within 7 months.';
function vans(): DraftRecordSet { return { stated_items: [
  {kind:'figure',source_quote:'We have 8 vans.',quantity:0,value:8,value_literal:'8',unit:'vans',unit_literals:['vans'],role:'baseline'},
  {kind:'figure',source_quote:'We make 640 deliveries every month.',quantity:1,value:640,value_literal:'640',unit:'deliveries/month',unit_literals:['deliveries','every month'],role:'baseline'},
  {kind:'option',source_quote:'Lease 5 vans.',quantity:0,value:5,value_literal:'5',is_baseline:false},
  {kind:'goal',source_quote:'Goal: at least 900 deliveries every month within 7 months.',quantity:1,role:'target',value:900,value_literal:'900',direction:'floor',direction_literal:'at least',baseline_ref:1,horizon_ref:4,horizon_months:7},
  {kind:'figure',source_quote:'within 7 months',value:7,value_literal:'7',unit:'months',unit_literals:['months']},
  {kind:'cause',source_quote:'Adding 5 vans changes deliveries by 18 to 36 every month.',relationship:{from_quantity:0,to_quantity:1,per_source_change:5,per_source_literal:'5',range:{low:18,high:36,low_literal:'18',high_literal:'36'}}},
 ], claims:[{claim_kind:'factor',label:'Vans',quantity:0,value:8},{claim_kind:'causal_link',label:'lease setting',from_stated:2,to_claim:0,effect:'positive'}] }; }

// P5 also requires a nonempty sized path. The independent route path stays present when the van effect is withheld.
const VANS_WITH_ROUTES=VANS+' We have 17 routes. Add 11 routes. Each extra route increases deliveries by 55 every month.';
function vansWithRoutes(){const r=vans();r.stated_items.push(
  {kind:'figure',source_quote:'We have 17 routes.',quantity:6,value:17,value_literal:'17',unit:'routes',unit_literals:['routes'],role:'baseline'},
  {kind:'option',source_quote:'Add 11 routes.',quantity:6,value:11,value_literal:'11'},
  {kind:'cause',source_quote:'Each extra route increases deliveries by 55 every month.',relationship:{from_quantity:6,to_quantity:1,amount:55,amount_literal:'55',per_source_change:1,per_source_literal:'Each'}});
  r.claims.push({claim_kind:'factor',label:'Routes',quantity:6,value:17});return r;}

describe('v-next inert flip ladder', () => {
  it('G0 Anthropic serialized bytes are pinned to staging 890923c9', () => {
    expect(createHash('sha256').update(JSON.stringify(buildDraftRecordsSchema())).digest('hex')).toBe('9509011c6d6a00b848fba53bf666adce0b0f0193f081d82be97195625449ea8b');
  });
  it('G0 strict conformance and seam completeness at each attach site', () => {
    // Frozen spike strict bytes (S1 contract, rebased base 9e0750dd); never regenerated for v-next.
    expect(createHash('sha256').update(JSON.stringify(frozen)).digest('hex')).toBe('73091f05aaddc4b11e94ead4786e538b8963efa8e41fdc15e60522ad2c2b23da');
    const schema=buildStrictDraftRecordsSchema();
    const walk=(n:any)=>{if(!n || typeof n!=='object')return; if(n.type==='object'){expect(n.required).toEqual(Object.keys(n.properties));expect(n.additionalProperties).toBe(false);} Object.values(n).forEach(walk);}; walk(schema);
    const wire=materialise(sealedRecordsVNext(),schema); const validate=new Ajv({strict:false}).compile(schema);
    expect(validate(wire),JSON.stringify(validate.errors)).toBe(true); expect(omitOptionalRecordNulls(wire)).toEqual(JSON.parse(JSON.stringify(sealedRecordsVNext())));
    expect(new Ajv({strict:false}).compile(frozen)(wire)).toBe(false);
    expect(findGrammarFieldsDroppedBySeam()).toEqual({claims:[],statedItems:[]});
    // Budget reason: nullable strict parameters are OpenAI inputs, not Anthropic optional parameters.
    // P2-A1 re-pin (reason): +1 optional `setting` enum on v-next stated items (4967→5064 strict bytes; 3180→3239 and
    // 44→45 optional on the unstrict builder). Anthropic bytes are unchanged and pinned by the G0 row above.
    // P2-FRAME re-pin (reason): +1 optional `plausible_max` number on v-next stated items (5064→5142 strict bytes;
    // 3239→3273 and 45→46 optional on the unstrict builder). Anthropic bytes unchanged (G0 row above).
    expect(measureDraftRecordsSchemaBudget(schema)).toMatchObject({serializedBytes:5142,optionalParams:0,objectSchemas:7});
    expect(measureDraftRecordsSchemaBudget(buildVNextDraftRecordsSchema())).toMatchObject({serializedBytes:3273,optionalParams:46,objectSchemas:7});
  });
  it('B5 literal offsets are stored by relationship identity', () => {
    const r=sealedRecords();const i=r.stated_items[10]!;const a=i.relationship!;delete a.amount_span;delete a.source_span; a.amount_literal='£300';a.per_source_literal='Each';
    const e=edgeFor(project(r),10,r); const start=i.source_quote.indexOf('£300');
    expect(e?.provenance).toMatchObject({magnitude:'user_stated',stated_relationship:{from_quantity:9,to_quantity:0,amount_span:{start,end:start+4}}});
  });
  it('B5 negative ambiguous literal is refused on its stated index',()=>{const r=sealedRecords();const a=r.stated_items[8]!.relationship!;delete a.source_span;a.per_source_literal='1';const p=project(r);expect(p.dropped).toContainEqual(expect.objectContaining({stated_index:8,reason:'literal_ambiguous'}));expect(edgeFor(p,8,r)?.provenance?.natural_effect).toBeUndefined();});
  it('B3 baseline and unit are carried by quantity identity',()=>{const r=sealedRecordsVNext();const p=project(r);const g=p.graph.nodes.find(n=>n.kind==='goal')!;expect(g.goal_baseline_raw).toBe(120000);expect(g.goal_threshold_unit).toBe('£/month');expect(g.observed_state?.unit).toBe('£/month');});
  it('B3 negative restated unit conflicts without overwriting declaration',()=>{const r=sealedRecordsVNext();r.stated_items[6]!.unit='£';const p=project(r);expect(p.graph.nodes.find(n=>n.kind==='goal')?.goal_threshold_unit).toBe('£/month');expect(p.dropped).toContainEqual(expect.objectContaining({stated_index:6,reason:'unit_restated_conflict'}));});
  it('B3 EXTRACTION-UNPROVEN count-with-period differs from a count',()=>{expect(sameUnit('deliveries/month','deliveries')).toBe(false);expect(sameUnit('deliveries per month','delivery/month')).toBe(true);const p=project(vans(),VANS);expect(p.graph.nodes.find(n=>n.kind==='goal')?.goal_baseline_raw).toBe(640);});
  it('B4 relationship alone builds the exact endpoint pair and bundle',()=>{const r=sealedRecordsVNext();expect(edgeFor(project(r),10,r)?.provenance).toMatchObject({natural_effect:{amount:-300,amount_unit:'£/month',per_source_change:1,per_source_change_unit:'customers'}});});
  it('B4 negative duplicate quantity carriers refuse, never select',()=>{const r=sealedRecordsVNext();r.claims.push({claim_kind:'outcome',label:'Other revenue carrier',quantity:0});expect(project(r).dropped).toContainEqual(expect.objectContaining({stated_index:10,reason:'relationship_endpoint_ambiguous'}));});
  it('B2 option value is bound to its own lever',()=>{const r=sealedRecordsVNext();r.stated_items[3]!.value=10;delete r.stated_items[3]!.value_scale;/* Isolate B2 from B7: undeclared percent convention is literal points. */for(const i of r.stated_items)if(i.relationship?.from_quantity===3)i.relationship.per_source_change=1;const p=project(r);const o=p.graph.nodes.find(n=>n.provenance?.source_quote===r.stated_items[3]!.source_quote)!;const lever=p.graph.nodes.find(n=>n.kind==='factor'&&n.quantity_ref===3)!;expect(details(o)![lever.id]).toMatchObject({raw_value:10,unit:'%',source:'brief_extraction',stated_index:3});expect(details(o)![lever.id]!.reasoning).toContain('stated_items[3]');});
  it('B7 option unit_interval keeps the literal convention',()=>{const r=sealedRecordsVNext();const p=project(r);const o=p.graph.nodes.find(n=>n.provenance?.source_quote===r.stated_items[3]!.source_quote)!;const lever=p.graph.nodes.find(n=>n.kind==='factor'&&n.quantity_ref===3)!;expect((o.data!.raw_interventions as Record<string, unknown>)[lever.id]).toBe(10);expect(details(o)![lever.id]).toMatchObject({raw_value:10,unit:'%',source:'brief_extraction',stated_index:3});expect(details(o)![lever.id]!.reasoning).toContain('stated_items[3]');});
  it('B1a stated point and asymmetric 90% spread size the stored edge',()=>{const r=sealedRecordsVNext();const e=edgeFor(project(r),9,r)!;const ne=e.provenance!.natural_effect!;expect(ne?.amount).toBe(2);expect(e.strength_std).toBeCloseTo(Math.abs(e.strength_mean!)* (2/2)/1.645,5);expect(ne).not.toHaveProperty('stated_range');});
  it('B1a EXTRACTION-UNPROVEN range-only stores midpoint and spread',()=>{const r=vans();const e=edgeFor(project(r,VANS),5,r)!;expect(e?.provenance?.natural_effect?.amount).toBe(27);expect(e?.strength_std).toBeCloseTo(Math.abs(e.strength_mean!)/3/1.645,5);});
  it('B1a point outside range is refused',()=>{const r=sealedRecordsVNext();const item=r.stated_items[9]!;item.source_quote=item.source_quote.replace('about 2','about 5');item.value=5;item.value_literal='about 5';item.relationship!.amount=5;item.relationship!.amount_literal='about 5';const p=project(r,BRIEF+' '+item.source_quote);expect(p.dropped).toContainEqual(expect.objectContaining({stated_index:9,reason:'range_excludes_point'}));expect(p.stated_dispositions?.find(d=>d.stated_index===9)).toMatchObject({disposition:'rejected',reason:'range_excludes_point'});expect(edgeFor(p,9,r)?.provenance?.natural_effect).toBeUndefined();});
  it('B1a sigma from about 2 between 1 and 4 feeds domainBand',()=>{
    const source={label:'Vans',unit:'vans',scale_frame:1,observed_state:{value:0,baseline:0},option_levels:[1]};
    const target={label:'Delivery funding',unit:'£/month',scale_frame:10,observed_state:{value:0.03,baseline:0.03,source:'brief_extraction'},option_levels:[]};
    const point={direction:'positive' as const,effect_amount:2,effect_per_source_change:1,user_stated:true};
    expect(sizeLink(point,source,target).problem).toBeUndefined();
    const sized=sizeLink({...point,amount_range:{low:1,high:4}},source,target);
    expect(sized.std*10).toBeCloseTo(1.216,3);expect(sized.problem).toBe('out_of_domain');
  });
  it('B1a range wording does not fire the unchanged A4 floor sentence',()=>{
    const source={label:'Vans',unit:'vans',scale_frame:10,option_levels:[1]};
    const target={label:'Delivery goal',kind:'goal',unit:'deliveries',scale_frame:100,option_levels:[]};
    const point={direction:'positive' as const,effect_amount:2,effect_per_source_change:1,user_stated:true};
    const relationship=sizeLink({...point,amount_range:{low:1,high:4}},source,target);
    expect(relationship.range_words).toBeUndefined();expect(relationship.natural_effect).not.toHaveProperty('stated_range');
    const legacy=sizeLink({...point,stated_range:{low:2,high:5,text:'2 to 5',end:'low'}},source,target);
    expect(legacy.range_words).toBe('2 deliveries per van on "Vans" → "Delivery goal" is the low end of your "2 to 5" range, so any figure that runs through this link is a floor: at least that much.');
  });
  it('B6(1) change_of writes the Science definitional carrier',async()=>{const r=sealedRecordsVNext();/* The option reaches q9→q10→goal: this proves P5, not the unreached contrast. */r.stated_items[10]!.quantity=10;r.stated_items[10]!.unit='£/month';r.stated_items[10]!.unit_literals=['a month'];r.stated_items[10]!.horizon_ref=7;r.stated_items[10]!.relationship!.to_quantity=10;r.stated_items[10]!.relationship!.amount=300;r.claims[4]={claim_kind:'risk',label:'Revenue lost over the goal horizon',quantity:10,value:0,change_of:0};r.claims.push({claim_kind:'causal_link',label:'loss into goal',from_claim:4,to_stated:6,effect:'negative'});const b=await registered(r);const n=b.graph.nodes.find((n:any)=>n.label==='Revenue lost over the goal horizon');const e=b.graph.edges.find((e:any)=>e.from===n?.id);expect(e?.provenance?.definitional).toBe(true);expect(e?.provenance?.natural_effect).toMatchObject({amount:-1,amount_unit:'£/month',per_source_change:1,per_source_change_unit:'£/month'});expect(holdsByDefinition(e,nodeUnitOf(b.graph.nodes))).toBe(true);expect(targetTestabilityOf(b.graph).kind).toBe('testable');const goal=b.graph.nodes.find((n:any)=>n.kind==='goal');expect(goal.goal_threshold_unit).toBe(goal.observed_state.unit);});
  it('B6(1) negative rate cannot become an own-horizon identity',async()=>{const r=sealedRecordsVNext();r.claims[4]={claim_kind:'risk',label:'Rate of revenue loss',unit:'£/month/month',change_of:0};r.claims.push({claim_kind:'causal_link',label:'loss into goal',from_claim:4,to_stated:6,effect:'negative'},{claim_kind:'causal_link',label:'price reaches rate risk',from_claim:0,to_claim:4,effect:'positive'});expect(project(r).dropped).toContainEqual(expect.objectContaining({reason:'change_of_unit_mismatch'}));const b=await registered(r);expect(targetTestabilityOf(b.graph)).toMatchObject({kind:'not_testable',failures:[expect.objectContaining({code:'goal_path_unsized'})]});});
  it('B6(2) EXTRACTION-UNPROVEN stated no-effect is withheld with an A1 receipt',()=>{const r=vansWithRoutes();r.stated_items[5]={kind:'cause',source_quote:'Repainting 5 vans will not change deliveries.',relationship:{from_quantity:0,to_quantity:1,no_effect_literal:'will not change'}};r.claims.push({claim_kind:'causal_link',label:'repainting effect',from_claim:0,to_stated:3,effect:'positive'});const p=project(r,VANS_WITH_ROUTES);expect(p.stated_dispositions).toContainEqual(expect.objectContaining({stated_index:5,disposition:'rejected',reason:'user_stated_no_effect'}));expect(p.graph.edges.filter(e=>e.from===p.graph.nodes.find(n=>n.label==='Vans')?.id&&e.to===p.graph.nodes.find(n=>n.kind==='goal')!.id)).toHaveLength(0);expect(p.graph.edges.some(e=>e.provenance?.natural_effect?.amount===0)).toBe(false);expect(targetTestabilityOf(p.graph).kind,JSON.stringify(targetTestabilityOf(p.graph))).toBe('testable');expect(p.stated_dispositions?.find(d=>d.stated_index===5)?.stated_item.source_quote).toBe('Repainting 5 vans will not change deliveries.');});
  it('B1a EXTRACTION-UNPROVEN silence never means zero and blocks P5 (B6 contrast)',()=>{const r=vansWithRoutes();r.stated_items[5]={kind:'cause',source_quote:'Repainting 5 vans will not change deliveries.',relationship:{from_quantity:0,to_quantity:1}};r.claims.push({claim_kind:'causal_link',label:'unmeasured effect',from_claim:0,to_stated:3,effect:'positive'});const p=project(r,VANS_WITH_ROUTES);expect(p.dropped).toContainEqual(expect.objectContaining({stated_index:5,reason:'relationship_unsized'}));expect(targetTestabilityOf(p.graph)).toMatchObject({kind:'not_testable',failures:[expect.objectContaining({code:'goal_path_unsized'})]});});
  it('B6(3) CONTRAST passes today for an unreached unsized link',()=>{const p=project(sealedRecords());const graph:any={...p.graph,nodes:[...p.graph.nodes,{id:'unreached',kind:'risk',label:'Unreached risk'}],edges:[...p.graph.edges,{from:'unreached',to:p.graph.nodes.find(n=>n.kind==='goal')!.id,strength_mean:0.5,strength_std:0.125}]};expect(targetTestabilityOf(graph).kind).toBe('testable');});
  it('B7 A1 receipt retains the stored literal-convention intervention by identity',()=>{const r=sealedRecordsVNext();const p=project(r);const option=p.graph.nodes.find(n=>n.provenance?.source_quote===r.stated_items[3]!.source_quote)!;const lever=p.graph.nodes.find(n=>n.kind==='factor'&&n.quantity_ref===3)!;expect(p.stated_dispositions?.find(d=>d.stated_index===3)).toMatchObject({disposition:'carried',stored_value:10,location:{kind:'node',node_id:option.id,path:['data','intervention_details',lever.id,'raw_value']}});});
  it('B1a strict zero straddle refuses while a zero bound sizes',()=>{const r=vans();r.stated_items[5]!.source_quote='Adding 5 vans changes deliveries by -18 to 36 every month.';r.stated_items[5]!.relationship!.range={low:-18,high:36,low_literal:'-18',high_literal:'36'};let p=project(r,VANS+' '+r.stated_items[5]!.source_quote);expect(p.dropped).toContainEqual(expect.objectContaining({stated_index:5,reason:'range_straddles_zero'}));expect(edgeFor(p,5,r)?.provenance?.natural_effect).toBeUndefined();r.stated_items[5]!.source_quote='Adding 5 vans changes deliveries by 0 to 36 every month.';r.stated_items[5]!.relationship!.range={low:0,high:36,low_literal:'0',high_literal:'36'};p=project(r,VANS+' '+r.stated_items[5]!.source_quote);expect(edgeFor(p,5,r)?.provenance?.natural_effect?.amount).toBe(18);expect(p.dropped.some(d=>d.reason==='range_straddles_zero')).toBe(false);});
  it('B5 both old spans and new literals refuse an option value',()=>{const r=vans();r.stated_items[2]!.value_span={start:6,end:7};const p=project(r,VANS);expect(p.dropped).toContainEqual(expect.objectContaining({stated_index:2,reason:'span_and_literal_both'}));expect(p.graph.nodes.find(n=>n.provenance?.source_quote===r.stated_items[2]!.source_quote)?.data?.intervention_details).toBeUndefined();});
  it('B1a EXTRACTION-UNPROVEN decimal bounds keep one relationship clause',()=>{const r=vans();const item=r.stated_items[5]!;item.source_quote='Adding 5 vans changes deliveries by 18.5 to 36.5 every month.';item.relationship!.per_source_literal='5 vans';item.relationship!.range={low:18.5,high:36.5,low_literal:'18.5',high_literal:'36.5'};expect(edgeFor(project(r,VANS+' '+item.source_quote),5,r)?.provenance?.natural_effect?.amount).toBe(27.5);});
  it('B1a EXTRACTION-UNPROVEN currency bounds contradict a count quantity',()=>{const r=vans();const item=r.stated_items[5]!;item.source_quote='Adding 5 vans changes deliveries by £18 to £36 every month.';item.relationship!.per_source_literal='5 vans';item.relationship!.range={low:18,high:36,low_literal:'£18',high_literal:'£36'};const p=project(r,VANS+' '+item.source_quote);expect(p.dropped).toContainEqual(expect.objectContaining({stated_index:5,reason:'unit_literal_contradicts_unit'}));expect(edgeFor(p,5,r)?.provenance?.natural_effect).toBeUndefined();});
  it('B4 EXTRACTION-UNPROVEN a calendar determiner cannot stand for a van',()=>{const r=vans();const item=r.stated_items[5]!;delete item.relationship!.range;Object.assign(item.relationship!,{amount:18,amount_literal:'18',per_source_change:1,per_source_literal:'every month'});const p=project(r,VANS);expect(p.dropped).toContainEqual(expect.objectContaining({stated_index:5,reason:'unit_literal_contradicts_unit'}));expect(edgeFor(p,5,r)?.provenance?.natural_effect).toBeUndefined();});
  // P2-A1 re-pin (reason): the v-next option `setting` rule; was fe150807…ab3e. P2-FRAME re-pin: the `plausible_max`
  // rule; was 2b2f88fa…930c. v25 is pinned in instruction-pin.
  it('instruction new generic v-next hash is pinned without moving v25',()=>{expect(createHash('sha256').update(V_NEXT_DRAFT_RECORDS_INSTRUCTION).digest('hex')).toBe('5535ce16fdea8896f4a9b0a6a18cd9c9a189f7bc36b45d8970a570fecfe83831');expect(V_NEXT_DRAFT_RECORDS_INSTRUCTION).not.toContain('effect_detail');expect(V_NEXT_DRAFT_RECORDS_INSTRUCTION).not.toContain('value_span');});
  it('determinism is byte identical',async()=>{expect(JSON.stringify(await registered())).toBe(JSON.stringify(await registered()));expect(projectionFingerprint(project(sealedRecordsVNext()))).toBe(projectionFingerprint(project(sealedRecordsVNext())));});
});

/** The graph as the store holds it: the same persistence projection the bridge row reads. */
function stored(graph: any) {
  return assignEntityRefs(projectGraphForPersistence(graph, { scenarioId: '11111111-1111-4111-8111-111111111111', turnClass: 'direct_answer', source: 'graph_registration' }), null).graph;
}
// EXTRACTION-UNPROVEN: generic vans limit/risk shapes; they prove the projector's prune rule only.
const VANS_LIMIT = VANS + ' Keep fuel spend under £5,000 a month.';
function vansWithFuelLimit(): DraftRecordSet {
  const r = vans();
  r.stated_items.push({ kind: 'constraint', source_quote: 'Keep fuel spend under £5,000 a month.', value: 5000, value_literal: '£5,000', unit: '£/month', unit_literals: ['a month'], direction: 'ceiling', direction_literal: 'under', role: 'constraint', applies_to_claim: 2 });
  r.claims.push({ claim_kind: 'outcome', label: 'Fuel spend', unit: '£/month', value: 3000 }, { claim_kind: 'causal_link', label: 'more vans burn more fuel', from_claim: 0, to_claim: 2, effect: 'positive' });
  return r;
}
function vansWithRisk(actedOnByOption: boolean): DraftRecordSet {
  const r = vans();
  r.claims.push({ claim_kind: 'risk', label: 'Van breakdowns' }, actedOnByOption
    ? { claim_kind: 'causal_link', label: 'leasing adds breakdown exposure', from_stated: 2, to_claim: 2, effect: 'positive' }
    : { claim_kind: 'causal_link', label: 'more vans more breakdowns', from_claim: 0, to_claim: 2, effect: 'positive' });
  return r;
}

describe('pass 2 P2-0: the connectivity prune withdraws every kind readiness would refuse', () => {
  it('P2-0 the sealed v-next stored graph is admitted for analysis with no NO_PATH_TO_GOAL', async () => {
    const graph = stored((await registered()).graph);
    const admission = resolveAnalysisAdmission(graph);
    expect(targetTestabilityOf(graph)).toMatchObject({ kind: 'testable' });
    expect(admission.permitted_analysis_mode).not.toBe('none');
    expect(JSON.stringify(admission)).not.toContain('NO_PATH_TO_GOAL');
  });
  it('P2-0 the support-cost clause is withdrawn with its stated magnitude and an A1 rejected receipt', () => {
    const r = sealedRecordsVNext(); const p = project(r);
    const supportQuantity = r.stated_items[13]!.relationship!.to_quantity;
    expect(p.graph.nodes.some(n => n.quantity_ref === supportQuantity)).toBe(false);
    expect(p.graph.edges.some(e => e.provenance?.source_quote === r.stated_items[13]!.source_quote)).toBe(false);
    expect(p.dropped).toContainEqual(expect.objectContaining({ stated_index: 13, label: r.stated_items[13]!.source_quote, reason: 'unconnected_to_goal', value: 6, unit: '£/month' }));
    expect(p.dropped).toContainEqual(expect.objectContaining({ label: r.claims.find(c => c.quantity === supportQuantity)!.label, reason: 'unconnected_to_goal', claim_kind: 'claim' }));
    expect(p.stated_dispositions?.find(d => d.stated_index === 13)).toMatchObject({ disposition: 'rejected', reason: 'unconnected_to_goal' });
  });
  it('P2-0 a risk an option moves that cannot reach the goal is withdrawn and disclosed', () => {
    const p = project(vansWithRisk(true), VANS);
    expect(p.graph.nodes.some(n => n.label === 'Van breakdowns')).toBe(false);
    expect(p.dropped).toContainEqual(expect.objectContaining({ label: 'Van breakdowns', reason: 'unconnected_to_goal' }));
  });
  it('P2-0 CONTRAST a K3 inert risk keeps its node and its cause', () => {
    const p = project(vansWithRisk(false), VANS);
    const risk = p.graph.nodes.find(n => n.label === 'Van breakdowns');
    expect(risk?.kind).toBe('risk');
    expect(p.graph.edges.some(e => e.to === risk!.id)).toBe(true);
    expect(p.dropped.some(d => d.node_id === risk!.id)).toBe(false);
  });
  it('P2-0 CONTRAST a limit-sink branch outcome is not withdrawn', () => {
    const p = project(vansWithFuelLimit(), VANS_LIMIT);
    const fuel = p.graph.nodes.find(n => n.label === 'Fuel spend');
    expect(fuel?.kind).toBe('outcome');
    expect(p.goalConstraints.map(c => c.node_id)).toContain(fuel!.id);
    expect(p.dropped.some(d => d.node_id === fuel!.id)).toBe(false);
  });
});

async function registeredWith(records: DraftRecordSet, brief: string) {
  let body: any;
  const result = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', brief,
    async (path, b) => { if (path.endsWith('/register')) { body = b; return { status: 200, json: { model_version: 1 } }; } return { status: 200, json: { graph: { nodes: [], edges: [] } } }; },
    async () => ({ text: JSON.stringify(records), status: 'completed' }));
  expect(result.ok, JSON.stringify(result)).toBe(true); return stored(body.graph);
}
// EXTRACTION-UNPROVEN: "Lease 5 vans." typed by hand as a CHANGE of the van count (a994c38a class, Science 5 Oct).
function vansDelta(): DraftRecordSet { const r = vans(); r.stated_items[2]!.setting = 'change_by'; return r; }
/** The Run assembly's own egress projection: option intervention objects → the numbers PLoT receives. */
function wireLevel(graph: any, optionQuote: string, factorId: string): number | undefined {
  const option = graph.nodes.find((n: any) => n.kind === 'option' && n.source_quote === optionQuote);
  return projectRequestInterventionsToWireScale([option.interventions], buildFactorScaleMap(graph.nodes)).perOption[0]![factorId];
}

describe('pass 2 P2-A1: a delta option is a change_by resolved at Run assembly', () => {
  it('P2-A1 a delta option compiles as change_by on its own lever, from its own literal and value', async () => {
    const r = vansDelta(); const p = project(r, VANS);
    const option = p.graph.nodes.find(n => n.provenance?.source_quote === r.stated_items[2]!.source_quote)!;
    const lever = p.graph.nodes.find(n => n.kind === 'factor' && n.quantity_ref === 0)!;
    expect(details(option)?.[lever.id]).toMatchObject({ stated_index: 2, change_by: 5, raw_value: 13 });
    const graph = await registeredWith(r, VANS);
    const storedLever = graph.nodes.find((n: any) => n.kind === 'factor' && n.label === lever.label)!;
    const storedOption = graph.nodes.find((n: any) => n.kind === 'option' && n.source_quote === r.stated_items[2]!.source_quote)!;
    expect(storedOption.interventions?.[storedLever.id]).toMatchObject({ change_by: 5, raw_value: 13 });
  });
  it('P2-A1 a baseline edit leaves a change_by option still different from the status quo', async () => {
    const r = vansDelta(); const graph: any = await registeredWith(r, VANS);
    const lever = graph.nodes.find((n: any) => n.kind === 'factor' && n.label === 'Vans')!;
    expect(wireLevel(graph, r.stated_items[2]!.source_quote, lever.id)).toBe(13);
    lever.observed_state = { ...lever.observed_state, raw_value: 10, value: 10 };
    const resolved = wireLevel(graph, r.stated_items[2]!.source_quote, lever.id);
    expect(resolved).toBe(15);
    expect(resolved).not.toBe(lever.observed_state.raw_value);
  });
  it('P2-A1 CONTRAST an absolute option keeps sets_to across a baseline edit', async () => {
    const r = vans(); const p = project(r, VANS);
    const option = p.graph.nodes.find(n => n.provenance?.source_quote === r.stated_items[2]!.source_quote)!;
    const leverId = p.graph.nodes.find(n => n.kind === 'factor' && n.quantity_ref === 0)!.id;
    expect(details(option)?.[leverId]).toMatchObject({ stated_index: 2, raw_value: 5 });
    expect(details(option)?.[leverId]).not.toHaveProperty('change_by');
    const graph: any = await registeredWith(r, VANS);
    const lever = graph.nodes.find((n: any) => n.kind === 'factor' && n.label === 'Vans')!;
    lever.observed_state = { ...lever.observed_state, raw_value: 10, value: 10 };
    expect(wireLevel(graph, r.stated_items[2]!.source_quote, lever.id)).toBe(5);
  });
  it('P2-A1 a change_by option with no stated baseline is refused, never resolved from zero', () => {
    const r = vansDelta(); r.stated_items[0] = { ...r.stated_items[0]!, value: undefined, value_literal: undefined } as any;
    delete (r.stated_items[0] as any).value; delete (r.stated_items[0] as any).value_literal; delete (r.stated_items[0] as any).role;
    const p = project(r, VANS);
    expect(p.dropped).toContainEqual(expect.objectContaining({ stated_index: 2, reason: 'option_change_by_baseline_unknown' }));
    const option = p.graph.nodes.find(n => n.provenance?.source_quote === r.stated_items[2]!.source_quote);
    expect(Object.values(option?.data?.intervention_details ?? {}).some((d: any) => d?.stated_index === 2)).toBe(false);
  });
});

describe('pass 2 P2-A6: each factor carries its driver role from the compile', () => {
  it('P2-A6 the price-rise lever is controllable; customers lost and MRR are not', async () => {
    const r = sealedRecordsVNext(); const graph: any = stored((await registered(r)).graph);
    const labelOf = (q: number) => r.claims.find(c => c.quantity === q && c.claim_kind !== 'causal_link')!.label!;
    const node = (label: string) => graph.nodes.find((n: any) => n.label === label)!;
    expect(node(labelOf(3))).toMatchObject({ kind: 'factor', category: 'controllable' });
    expect(node(labelOf(9))).toMatchObject({ kind: 'factor' });
    expect(['observable', 'external']).toContain(node(labelOf(9)).category);
    expect(node(labelOf(0)).kind).toBe('outcome');
    expect(node(labelOf(0)).category).not.toBe('controllable');
    // Every stored factor is typed: none is left for a reader to guess.
    expect(graph.nodes.filter((n: any) => n.kind === 'factor' && n.category === undefined)).toEqual([]);
  });
});

// EXTRACTION-UNPROVEN (a994c38a lesson, generic vans text): unknowns are asks, never zeros or defaults.
const VANS_DEADLINE = 'We have 8 vans. Lease 5 vans. Goal: open the new depot within 7 months.';
function vansDeadline(): DraftRecordSet { return { stated_items: [
  { kind: 'figure', source_quote: 'We have 8 vans.', quantity: 0, value: 8, value_literal: '8', unit: 'vans', unit_literals: ['vans'], role: 'baseline' },
  { kind: 'option', source_quote: 'Lease 5 vans.', quantity: 0, value: 5, value_literal: '5', is_baseline: false },
  { kind: 'goal', source_quote: 'Goal: open the new depot within 7 months.', role: 'target', horizon_ref: 3, horizon_months: 7 },
  { kind: 'figure', source_quote: 'within 7 months', value: 7, value_literal: '7', unit: 'months', unit_literals: ['months'] },
], claims: [{ claim_kind: 'factor', label: 'Vans', quantity: 0, value: 8 }, { claim_kind: 'causal_link', label: 'lease setting', from_stated: 1, to_claim: 0, effect: 'positive' },
  { claim_kind: 'causal_link', label: 'more vans open the depot sooner', from_claim: 0, to_stated: 2, effect: 'positive' }] }; }

describe('pass 2 P2-B6x: a missing value is an ask, never a zero or a default', () => {
  it('P2-B6x a factor with no stated or typed level stores no zero and is asked for', async () => {
    const r = vans(); r.claims.push({ claim_kind: 'factor', label: 'Drivers on shift' }, { claim_kind: 'causal_link', label: 'drivers move deliveries', from_claim: 2, to_stated: 3, effect: 'positive' });
    const graph: any = await registeredWith(r, VANS);
    const drivers = graph.nodes.find((n: any) => n.label === 'Drivers on shift')!;
    expect(drivers.observed_state?.value).toBeUndefined();
    expect(drivers.observed_state?.raw_value).toBeUndefined();
    // No node value anywhere is a zero the records did not type.
    expect(graph.nodes.filter((n: any) => n.observed_state?.value === 0 || n.observed_state?.raw_value === 0).map((n: any) => n.label)).toEqual([]);
    const admission = resolveAnalysisAdmission(graph);
    expect(admission.permitted_analysis_mode).toBe('none');
    expect(admission.missing_important_inputs.map(i => i.code)).toContain('MISSING_FACTOR_LEVEL');
  });
  it('P2-B6x a deadline goal with no measurable quantity is a typed goal_quantity_missing ask, never higher-is-better', async () => {
    const r = vansDeadline(); const p = project(r, VANS_DEADLINE);
    expect(p.dropped).toContainEqual(expect.objectContaining({ stated_index: 2, reason: 'goal_quantity_missing' }));
    expect(p.stated_dispositions?.find(d => d.stated_index === 2)).toMatchObject({ disposition: 'asked' });
    const goal = p.graph.nodes.find(n => n.kind === 'goal')!;
    expect(goal.goal_direction).toBeUndefined();
    const graph: any = await registeredWith(r, VANS_DEADLINE);
    expect(graph.nodes.find((n: any) => n.kind === 'goal')?.goal_direction).toBeUndefined();
  });
});

describe('pass 2 P2-FRAME: a declared plausible_max frames its quantity by the legacy construct rule', () => {
  const starterFrame = async (plausibleMax: number) => {
    const r = sealedRecordsVNext(); r.stated_items[11]!.plausible_max = plausibleMax;
    const graph: any = stored((await registered(r)).graph);
    const label = r.claims.find(c => c.quantity === 11 && c.claim_kind === 'factor')!.label!;
    return { graph, factor: graph.nodes.find((n: any) => n.label === label)!, option: graph.nodes.find((n: any) => n.kind === 'option' && n.source_quote === r.stated_items[4]!.source_quote)! };
  };
  it('P2-FRAME the stored frame equals the legacy framing of the same plausible_max', async () => {
    const { factor, option } = await starterFrame(300);
    const legacy = framedObservedState({ baseline_value: factor.observed_state.raw_value, unit: factor.observed_state.unit, provenance: 'explicit', plausible_max: 300 }) as { cap?: number };
    expect(legacy.cap).toBe(300);
    expect(factor.scale_frame).toBe(legacy.cap);
    expect(option.interventions[factor.id]).toMatchObject({ raw_value: 150, value: 0.5 });
  });
  it('P2-FRAME a level above the declared range widens it exactly as the legacy construct does', async () => {
    const { factor } = await starterFrame(100);
    expect(factor.scale_frame).toBe(defaultFrameFor(150));
  });
});

describe('pass 2 P2-A3: records-path readiness is read from the stored graph, so an edit moves it', () => {
  // The records compile's own `readiness` is a build-time diagnostic and is not registered; the served readiness is
  // re-derived from the stored graph on every read (resolveAnalysisAdmission / targetTestabilityOf). PIN, not a flip.
  it('P2-A3 a value edit that breaks testability moves admission; restoring it moves it back', async () => {
    const graph: any = stored((await registered()).graph);
    const before = resolveAnalysisAdmission(graph).permitted_analysis_mode;
    expect(targetTestabilityOf(graph)).toMatchObject({ kind: 'testable' });
    expect(before).not.toBe('none');
    const goal = graph.nodes.find((n: any) => n.kind === 'goal')!;
    const held = goal.observed_state;
    delete goal.observed_state;
    expect(targetTestabilityOf(graph)).toMatchObject({ kind: 'not_testable' });
    expect(resolveAnalysisAdmission(graph).permitted_analysis_mode).not.toBe(before);
    goal.observed_state = held;
    expect(resolveAnalysisAdmission(graph).permitted_analysis_mode).toBe(before);
  });
});

// ── PR #2573 Codex round 1 (5d35e906): each row reproduces the reviewer's counterexample. EXTRACTION-UNPROVEN fixtures. ──
function vanEffect(quote: string): DraftRecordSet {
  const r = vans();
  r.stated_items[5] = { kind: 'cause', source_quote: quote, relationship: { from_quantity: 0, to_quantity: 1, amount: 18, amount_literal: '18', per_source_change: 1, per_source_literal: 'Each' } };
  return r;
}
describe('Codex R1 F2: a count-unit contradiction is refused, never user_stated', () => {
  for (const quote of ['Each van adds 18 deliveries per year.', 'Each van we lease adds 18 elephants.', 'Each van adds 18 deliveries every week.']) {
    it(`F2 "${quote}" against deliveries/month is a typed unit refusal`, () => {
      const r = vanEffect(quote); const p = project(r, VANS + ' ' + quote);
      expect(p.dropped).toContainEqual(expect.objectContaining({ stated_index: 5, reason: 'unit_literal_contradicts_unit' }));
      expect(edgeFor(p, 5, r)?.provenance?.natural_effect).toBeUndefined();
      expect(p.graph.edges.some(e => e.provenance?.magnitude === 'user_stated' && e.provenance?.natural_effect?.amount === 18)).toBe(false);
    });
  }
  it('F2 CONTRAST the same noun with the same period, or no local unit word, still earns user_stated', () => {
    for (const quote of ['Each van adds 18 deliveries a month.', 'Each van adds 18 to monthly deliveries.', 'Each van we lease adds 18 deliveries.']) {
      const r = vanEffect(quote); const p = project(r, VANS + ' ' + quote);
      expect(p.dropped.filter(d => d.stated_index === 5 && d.reason !== 'unconnected_to_goal'), quote).toEqual([]);
      expect(edgeFor(p, 5, r)?.provenance).toMatchObject({ magnitude: 'user_stated', natural_effect: { amount: 18, amount_unit: 'deliveries/month' } });
    }
  });
});
