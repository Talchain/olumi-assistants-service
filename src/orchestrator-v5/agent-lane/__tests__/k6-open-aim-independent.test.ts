/**
 * Codex R1/R2 on #3426 (@a36d8e6b, @9cad55e7): independent probes, adopted verbatim. R2 found four wrong drafts on 9cad55e7:
 * a fractional money figure in words ("half a million pounds") was no figure; a manager's quoted digits ("5 cafés", '12 cafés')
 * counted as the user's; and a cycle repair made a third provider call. (The probe file's own header follows.)
 * The fraction row ("half a million pounds") is the ONE located-amount reader's (stated-by-user.ts, step 8b's lease): it lands
 * there with its reader rows, and returns here when it has.
 */
/**
 * ⭐ K6 (PL amendment 2; DL ack 18 Oct): a one-line "should we do X?" brief states no aim, so the drafter takes the ACTION as
 * an event goal, which #3026 rightly never saves as the goal. The draft is kept as a labelled provisional model: the event
 * becomes an option and the aim an open question.
 * ⭐ RE-RULED (signed change 6, DL-3 19 Oct): for EVERY brief. The word/speaker contrasts below pinned the retired no-figure
 * condition; they now pin that no figure, in any form or from any speaker, withholds the draft or makes a third call.
 *
 * Construction replayed for real (`buildModelFromBrief`). Scripted: the drafter. SYNTHETIC wording (a café). 0 provider calls.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, OPEN_AIM_GOAL_LABEL } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const BRIEF = 'Should we open a second café in Bristol next spring?';
const EVENT = 'Open a second café';
/** The drafter's answer for a one-line brief: the action as an event goal (the K6 shape), two options, a short chain. */
const cafeDraft = (): Rec => ({
  goal: { kind: 'event_by_date', deliverable: 'second café', metric: EVENT, operator: '>=', target_stated: false, value: null, unit: '',
    horizon_months: 6, provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred',
    scope: null, quantity_frame: 'level', basis: null, source_quote: 'open a second café in Bristol' },
  constraints: [],
  options: [
    { label: 'Open in Bristol next spring', provenance: 'ai_proposed', changes: [], interventions: [
      { factor_label: 'Number of cafés', value: 2, value_kind: 'absolute', unit: 'cafés', provenance: 'ai_proposed', stated_evidence: null }] },
    { label: 'Keep one café', provenance: 'ai_proposed', changes: [], interventions: [
      { factor_label: 'Number of cafés', value: 1, value_kind: 'absolute', unit: 'cafés', provenance: 'ai_proposed', stated_evidence: null }] },
  ],
  factors: [
    { label: 'Number of cafés', role: 'controllable', baseline_known: false, baseline_evidence: null, baseline_value: 1, unit: 'cafés', provenance: 'ai_proposed', plausible_max: 5 },
    { label: 'Monthly customers', role: 'external', baseline_known: false, baseline_evidence: null, baseline_value: 3000, unit: 'customers', provenance: 'ai_proposed', plausible_max: 20000 },
  ],
  risks: [], outcomes: [],
  links: [
    { from: 'Number of cafés', to: 'Monthly customers', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
    { from: 'Monthly customers', to: EVENT, direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
  ],
  identities: [], unknowns: [], decision_question: BRIEF, unknown_concerns: [],
});

async function construct(answers: readonly string[], brief: string, widen = false, writeMode = "confirmed"): Promise<{ graph: Rec | undefined; result: Rec; calls: number }> {
  let graph: Rec | undefined; let calls = 0;
  const dispatch = async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) {
      if(writeMode==='failed') return {status:500,json:{message:'failed'}};
      if(writeMode==='conflict') return {status:409,json:{message:'conflict',details:{code:'GRAPH_STALE'}}};
      graph = structuredClone((body as { graph: Rec }).graph);
      return { status: 200, json: { ...(writeMode==='duplicate'?{replayed:true}:{}), model_version: { version_id: 'v1', version_number: 1 }, graph, graph_hash: 'h1' } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  };
  const drafter = async () => { calls += 1; return { text: answers[Math.min(calls, answers.length) - 1]!, status: 'completed' }; };
  const result = await buildModelFromBrief('00000000-0000-4000-8000-0000000000k6', brief, dispatch as never, drafter as never,
    undefined, undefined, widen ? drafter as never : undefined) as Rec;
  return { graph, result, calls };
}


const phrasings = [
 ['own-five','We currently have five cafés. Should we open another in Bristol next spring?', true],
 ['own-twelve','We employ twelve baristas. Should we open another café in Bristol next spring?', true],
 ['own-twenty-five','We serve twenty-five customers daily. Should we open another café in Bristol next spring?', true],
 ['own-fifty-percent','We have fifty percent occupancy. Should we open another café in Bristol next spring?', true],
 ['own-seven-point-five','We have seven point five months of runway. Should we open another café in Bristol next spring?', true],
 ['own-digits-half','We have 500000 pounds available. Should we open another café in Bristol next spring?', true],
 ['one-of','Opening in Bristol is one of the options. Should we open a second café there next spring?', true],
 ['quote-words','My manager said "we currently have five cafés." Should we open another café in Bristol next spring?', true],
 ['quote-digits','My manager said "we currently have 5 cafés." Should we open another café in Bristol next spring?', true],
 ['quoted-single-words',"My manager said 'we currently have twelve cafés.' Should we open another café in Bristol next spring?", true],
 ['quoted-single-digits',"My manager said 'we currently have 12 cafés.' Should we open another café in Bristol next spring?", true],
];
describe('Independent K6 word/speaker contrasts',()=>{
 it.each(phrasings)('%s', async (name, brief, open)=>{
  const r = await construct([JSON.stringify(cafeDraft()),JSON.stringify(cafeDraft())], brief as string, true);
  console.log('PROBE',name,JSON.stringify({ok:r.result.ok,open:r.result.open_aim,calls:r.calls,saved:!!r.graph}));
  expect(r.calls).toBe(2);
  expect(r.result.open_aim===true).toBe(open);
 });
});

describe('Independent K6 additional call-budget paths',()=>{
 it.each(['cycle','missing-intervention'])('%s',async kind=>{
  const bad=cafeDraft();
  if(kind==='cycle') bad.links.push({...bad.links[0],from:'Monthly customers',to:'Number of cafés'});
  else bad.options[0].interventions=[];
  const good=cafeDraft(); good.goal={...good.goal, metric:OPEN_AIM_GOAL_LABEL,unit:'',kind:null,value:null,target_stated:false,deliverable:null,provenance:'ai_inferred',basis:null};
  good.links=good.links.map((l:Rec)=>({...l,to:l.to===EVENT?OPEN_AIM_GOAL_LABEL:l.to}));
  const r=await construct([JSON.stringify(bad),JSON.stringify(bad),JSON.stringify(good)],BRIEF,true);
  console.log('BUDGET',kind,JSON.stringify({ok:r.result.ok,open:r.result.open_aim,calls:r.calls,saved:!!r.graph,refusal:r.result.refusal}));
  expect(r.calls).toBe(2);
 });
});

import {narrateWriteOutcome,OPEN_AIM_SAVED_LINE} from '../write-outcome.js';
describe('Independent confirmed-write truth',()=>{
 it.each(['confirmed','failed','conflict','duplicate'])('%s',async mode=>{
  const r=await construct([JSON.stringify(cafeDraft()),JSON.stringify(cafeDraft())],BRIEF,true,mode);
  const n=narrateWriteOutcome('',[{name:'build_model_from_brief'}],[r.result as never]);
  expect((n.status||'').includes(OPEN_AIM_SAVED_LINE)).toBe(mode==='confirmed');
 });
 it('unreadable or refused results cannot say the saved line',()=>{
  for(const refusal of ['model_read_failed','registration_refused','construction_needs_redraft']){
   const n=narrateWriteOutcome('',[{name:'build_model_from_brief'}],[{ok:false,mutated:false,open_aim:true,refusal}]);
   expect((n.status||'').includes(OPEN_AIM_SAVED_LINE)).toBe(false);
  }
 });
});
