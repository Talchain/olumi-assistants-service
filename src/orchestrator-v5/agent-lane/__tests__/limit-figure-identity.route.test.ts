/**
 * ⛔ A LIMIT'S FIGURE IS ONLY EVER THE ONE THE USER WROTE FOR THAT LIMIT: Codex's independent probes on #3433 @29957133, adopted
 * verbatim as rows (their 9 failures reproduce on staging 92604238 without P05: wrong writes, not P05 regressions).
 *  · nested names: "the oven capacity constraint" is "Oven capacity", never "Annual oven capacity" (×4 limit words);
 *  · unit-only names: "the ovens constraint … 2 ovens" is "Ovens", never "Shelf capacity" (×4);
 *  · a turned-down figure: "at least 85%, not 90%" never gives a 90% card; an unwritten 84 neither;
 *  · and the P05 positive, the shelf negatives, shared-name negatives, own-unit control and an unrelated value.
 * THE PATH: the REAL route → the REAL Agent loop → the REAL `propose_limit_change` → press → the REAL limit door → the store.
 * Scripted Agent outputs only. 0 provider calls. SYNTHETIC wording and models.
 */
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in the limit-alias replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the limit-alias replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { authorised, call, chipFor, closeApps, idOf, route, say, world as worldOver, type Rec } from './fixtures/approval-world.js';

const world = () => worldOver(live);
afterEach(closeApps);

const OVENS = { constraint_id: 'gc-ovens-1', node_id: 'oven_capacity', operator: '<=', value: 3, unit: 'ovens', value_frame: 'level',
  label: 'Oven capacity', provenance: 'explicit' };
const SHELF_NODE = { id: 'shelf_capacity', ref: 'F3', kind: 'factor', label: 'Shelf capacity', category: 'external', provenance: 'ai_inferred',
  observed_state: { unit: 'ovens', raw_value: 1, value: 0.25 } };
const SHELVES = { ...OVENS, constraint_id: 'gc-shelves-1', node_id: 'shelf_capacity', label: 'Shelf capacity' };
const limitRows = (g: Rec): Rec[] => (g.goal_constraints ?? []) as Rec[];



const REMOTE = { id: 'remote_service', ref: 'F4', kind: 'factor', label: 'Remote requests served within 30 days', category: 'external', provenance: 'ai_inferred',
  scale_frame: 100, observed_state: { unit: '%', raw_value: 50, value: 0.5 } };
const VILLAGE = { ...REMOTE, id: 'village_service', ref: 'F5', label: 'Villages with two-day repair service' };
const remoteSetup = (g: Rec) => { g.nodes.push(structuredClone(REMOTE), structuredClone(VILLAGE));
  g.goal_constraints = [{constraint_id:'gc-remote',node_id:REMOTE.id,label:REMOTE.label,operator:'>=',value:90,unit:'%',value_frame:'level',provenance:'explicit'}]; };
async function targetTurn(words:string, setup:(g:Rec)=>void, label:string, value:number, operator='<=' ,unit='ovens') {
 const w=world(); const turn=await route(w); w.edit(setup); const before=JSON.stringify(w.read());
 const r=await turn({message:words,source:'composer'},[call('propose_limit_change',{limit_label:label,operator,new_value:value,unit,rationale:words}),say('Here is that change for you to approve.')]);
 const made=(r._agent.tool_calls as Rec[]).find(c=>c.name==='propose_limit_change');
 expect(made,'actual propose_limit_change reached').toBeDefined();
 return {w,turn,r,made,before};
}
async function refuse(p: ReturnType<typeof targetTurn>) {
 const {w,made,before,r}=await p;
 expect(made,JSON.stringify(made)).toEqual(expect.objectContaining({ok:false,refusal:'figure_not_stated'}));
 expect(JSON.stringify(w.read())).toBe(before);
 expect((r.suggested_actions??[]).filter((a:Rec)=>String(a.id).startsWith('agent-approve-proposal:'))).toEqual([]);
}
async function press(p: ReturnType<typeof targetTurn>, values:number[]) {
 const {w,turn,r,made}=await p;
 expect(made,JSON.stringify(made)).toEqual(expect.objectContaining({ok:true}));
 const chip=chipFor(r,idOf(r,'propose_limit_change'));
 const pressed=await turn({message:chip.message,source:'chip_click',chip:{id:chip.id},agent_session_id:r._agent.session_id});
 expect(authorised(pressed)).toEqual([expect.objectContaining({ok:true,mutated:true})]);
 expect(limitRows(w.read()).map(c=>c.value)).toEqual(values);
}
const standard=(g:Rec)=>{g.nodes.push(structuredClone(SHELF_NODE));g.goal_constraints=[structuredClone(OVENS),structuredClone(SHELVES)];};
describe('independent quantity binding',()=>{
 it('a: exact P05 words, one remote limit, press saves 85%',async()=>{
   await press(targetTurn('The remote-village constraint should be at least 85%, not 90%',remoteSetup,REMOTE.label,85,'>=','%'),[85]);
 });
 it.each([90,84])('c: rejected or unwritten %s is never the remote card',async(value)=>{
   await refuse(targetTurn('The remote-village constraint should be at least 85%, not 90%',g=>{remoteSetup(g);g.goal_constraints[0].value=95;},REMOTE.label,value,'>=','%'));
 });
 it.each(['constraint','floor','ceiling','limit'])('b: no shelf limit, named shelf %s cannot write oven',async(alias)=>{
  await refuse(targetTurn(`The shelf capacity ${alias} should be at most 2 ovens, not 3.`,g=>{standard(g);g.goal_constraints=[structuredClone(OVENS)];},'Oven capacity',2));
 });
 it.each(['constraint','floor','ceiling','limit'])('b: shared names, Annual oven capacity %s cannot write Monthly oven capacity',async(alias)=>{
  await refuse(targetTurn(`The annual oven capacity ${alias} should be at most 2 ovens, not 3.`,g=>{
   g.nodes.find((n:Rec)=>n.id==='oven_capacity').label='Monthly oven capacity';
   g.nodes.push({...structuredClone(SHELF_NODE),label:'Annual oven capacity'});
   g.goal_constraints=[{...OVENS,label:'Monthly oven capacity'},{...SHELVES,label:'Annual oven capacity'}];
  },'Monthly oven capacity',2));
 });
 it.each(['constraint','floor','ceiling','limit'])('b: nested shared names, Oven capacity %s cannot write Annual oven capacity',async(alias)=>{
  await refuse(targetTurn(`The oven capacity ${alias} should be at most 2 ovens, not 3.`,g=>{
   g.nodes.find((n:Rec)=>n.id==='oven_capacity').label='Annual oven capacity';
   g.nodes.push({...structuredClone(SHELF_NODE),label:'Oven capacity'});
   g.goal_constraints=[{...OVENS,label:'Annual oven capacity'},{...SHELVES,label:'Oven capacity'}];
  },'Annual oven capacity',2));
 });
 it.each(['constraint','floor','ceiling','limit'])('b: unit-only rival Ovens %s cannot write shelf',async(alias)=>{
  await refuse(targetTurn(`The ovens ${alias} should be at most 2 ovens, not 3.`,g=>{
   g.nodes.find((n:Rec)=>n.id==='oven_capacity').label='Ovens'; g.nodes.push(structuredClone(SHELF_NODE));
   g.goal_constraints=[{...OVENS,label:'Ovens'},structuredClone(SHELVES)];
  },'Shelf capacity',2));
 });
 it('unit-only limit positive control: Ovens can receive and save its own figure',async()=>{
  await press(targetTurn('The ovens limit should be at most 2 ovens, not 3.',g=>{
   g.nodes.find((n:Rec)=>n.id==='oven_capacity').label='Ovens';g.goal_constraints=[{...OVENS,label:'Ovens'}];
  },'Ovens',2),[2]);
 });
 it.each(['constraint','floor','ceiling','limit'])('b: rival-naming phrase shelf %s ... for the oven cannot transfer figure',async(alias)=>{
  await refuse(targetTurn(`For the oven, the shelf capacity ${alias} should be at most 2 ovens, not 3.`,standard,'Oven capacity',2));
 });
 it('b: unrelated value does not become the limit figure',async()=>{
  await refuse(targetTurn('Shelf capacity is 2 ovens; the oven capacity limit stays at 3 ovens.',standard,'Oven capacity',2));
 });
});

/**
 * Codex R2 on #3433 @1aacff18, held-out rows adopted verbatim. Four were wrong writes on 1aacff18: symbol labels ("%", "£")
 * could not be named; a fragment two limits share ("oven capacity") was read as one; and "90 requests … not 90%" took its source
 * from one occurrence and its quantity from another.
 */
const twoNamed=(a:string,b:string,unit='ovens',held=3)=>(g:Rec)=>{
 g.nodes.find((n:Rec)=>n.id==='oven_capacity').label=a;
 g.nodes.push({...structuredClone(SHELF_NODE),label:b});
 g.goal_constraints=[{...OVENS,label:a,unit,value:held,operator:unit==='%'?'>=':'<='},{...SHELVES,label:b,unit,value:held,operator:unit==='%'?'>=':'<='}];
};
describe('delta held-out quantity and affirmative-source contract',()=>{
 it.each(['not','rather than','instead of'])('reject %s DIGITS',async(neg)=>{
  await refuse(targetTurn(`The remote-village constraint should be at least 85%, ${neg} 90%.`,g=>{remoteSetup(g);g.goal_constraints[0].value=95},REMOTE.label,90,'>=','%'));
 });
 it.each(['not','rather than','instead of'])('reject %s WORDS',async(neg)=>{
  await refuse(targetTurn(`The remote-village constraint should be at least eighty-five percent, ${neg} ninety percent.`,g=>{remoteSetup(g);g.goal_constraints[0].value=95},REMOTE.label,90,'>=','%'));
 });
 it.each(['not','rather than','instead of'])('reject %s count WORDS',async(neg)=>{
  await refuse(targetTurn(`The oven capacity limit should be at most two ovens, ${neg} three ovens.`,twoNamed('Oven capacity','Shelf capacity','ovens',4),'Oven capacity',3));
 });
 it.each([
 ['Annual oven capacity','Oven capacity','The oven capacity constraint should be at most 2 ovens.'],
 ['Oven capacity','Annual oven capacity','The annual oven capacity constraint should be at most 2 ovens.'],
 ['Upper oven capacity','Lower oven capacity','The lower oven capacity constraint should be at most 2 ovens.'],
 ['Ovens','Shelf capacity','The shelf capacity limit should be at most 2 ovens.'],
 ['Shelf capacity','Ovens','The ovens limit should be at most 2 ovens.'],
 ['Shelf capacity','ovens','The ovens limit should be at most 2 ovens.'],
 ])('refuse target %s when user names %s',async(a,b,text)=>{
  await refuse(targetTurn(text,twoNamed(a,b),a,2));
 });
 it.each([
 ['Shelf completion','%','The % limit should be at least 85%.','%'],
 ['Budget','£','The £ limit should be at most £2.','GBP'],
 ['Duration','days','The days limit should be at most 2 days.','days'],
 ])('unit-only rival: %s cannot take %s figure',async(a,b,text,unit)=>{
  await refuse(targetTurn(text,twoNamed(a,b,unit,95),a,unit==='%'?85:2,unit==='%'?'>=':'<=',unit));
 });
 it.each([
 ['Oven capacity','Shelf capacity','The oven capacity limit should be at most 2 ovens.',[2,3]],
 ['Ovens','Shelf capacity','The ovens limit should be at most 2 ovens.',[2,3]],
 ['Annual oven capacity','Oven capacity','The oven capacity limit should be at most 2 ovens.',[3,2]],
 ])('correct card and save: %s / %s',async(a,b,text,values)=>{
  const target=values[0]===2?a:b;
  await press(targetTurn(text,twoNamed(a,b),target,2),values);
 });
 it('symbol-only positive: % can receive its own named value',async()=>{
  await press(targetTurn('The % limit should be at least 85%.',twoNamed('%','Shelf completion','%',95),'%',85,'>=','%'),[85,95]);
 });
 it('ambiguous shared word cannot select one sibling',async()=>{
  await refuse(targetTurn('The oven capacity limit should be at most 2 ovens.',twoNamed('Annual oven capacity','Monthly oven capacity'),'Annual oven capacity',2));
 });
 it('rejected figure stays rejected when same number occurs as unrelated historical quantity',async()=>{
  await refuse(targetTurn('Ninety requests arrived yesterday. The remote-village constraint should be at least 85%, not 90%.',g=>{remoteSetup(g);g.goal_constraints[0].value=95},REMOTE.label,90,'>=','%'));
 });
 it('rejected figure stays rejected with digit count elsewhere',async()=>{
  await refuse(targetTurn('90 requests arrived yesterday. The remote-village constraint should be at least 85%, not 90%.',g=>{remoteSetup(g);g.goal_constraints[0].value=95},REMOTE.label,90,'>=','%'));
 });
});

/**
 * Codex R3 on #3433 @d3bcc80e, held-out limit rows adopted verbatim: three were wrong writes there (a headcount written into a
 * rate limit, a rate into a headcount limit, specialists into a tickets-a-week limit); the written unit is now read whole.
 */
const pair=(a:string,b:string,unit='ovens',held=3)=>(g:Rec)=>{
 g.nodes.find((n:Rec)=>n.id==='oven_capacity').label=a;
 g.nodes.push({...structuredClone(SHELF_NODE),label:b});
 g.goal_constraints=[{...OVENS,label:a,unit,value:held,operator:unit==='%'?'>=':'<='},{...SHELVES,label:b,unit,value:held,operator:unit==='%'?'>=':'<='}];
};
const singleRate=(unit:string)=>(g:Rec)=>{
 const n=g.nodes.find((n:Rec)=>n.id==='oven_capacity');n.label='Team capacity';n.observed_state.unit=unit;
 g.goal_constraints=[{...OVENS,label:'Team capacity',unit}];
};
describe('R3 independent limit-door heldout',()=>{
 it('shared fragment cannot select Weekly from Monthly',async()=>{
  await refuse(targetTurn('The engineer capacity limit should be at most 2 engineers per week.',pair('Weekly engineer capacity','Monthly engineer capacity','engineers per week'),'Weekly engineer capacity',2,'<=','engineers per week'));
 });
 it.each([
 ['Annual £ ceiling','£ ceiling','The £ ceiling should be at most £2.','GBP',2,'<='],
 ['Annual % allowance','% allowance','The % allowance should be at least 85%.','%',85,'>='],
 ])('whole symbol label %s cannot steal %s',async(a,b,text,unit,value,op)=>{
  await refuse(targetTurn(text,pair(a,b,unit,95),a,Number(value),op,unit));
 });
 it('cross-occurrence rejected own and affirmed rival cannot transfer',async()=>{
  await refuse(targetTurn('The oven capacity limit stays at 3 ovens, not 2 ovens; shelf capacity is 2 ovens.',pair('Oven capacity','Shelf capacity'),'Oven capacity',2));
 });
 it('cross-occurrence affirmed own remains valid despite rival rejection',async()=>{
  await press(targetTurn('The shelf capacity limit stays at 3 ovens, not 2 ovens; the oven capacity limit is at most 2 ovens.',pair('Oven capacity','Shelf capacity'),'Oven capacity',2),[2,3]);
 });
 it('goal row figure cannot become separate limit row',async()=>{
  await refuse(targetTurn('Orders delivered on time target is at least 85%; support coverage limit is unchanged.',g=>{
   g.nodes.find((n:Rec)=>n.id==='oven_capacity').label='Support coverage';
   g.goal_constraints=[{...OVENS,label:'Support coverage',unit:'%',operator:'>=',value:95},{...OVENS,constraint_id:'gc-goal',node_id:'orders_on_time',label:'Orders delivered on time',unit:'%',operator:'>=',value:90}];
  },'Support coverage',85,'>=','%'));
 });
 it('goal row does not prevent own limit positive',async()=>{
  await press(targetTurn('The support coverage limit is at least 85%; orders delivered on time target is unchanged.',g=>{
   g.nodes.find((n:Rec)=>n.id==='oven_capacity').label='Support coverage';
   g.goal_constraints=[{...OVENS,label:'Support coverage',unit:'%',operator:'>=',value:95},{...OVENS,constraint_id:'gc-goal',node_id:'orders_on_time',label:'Orders delivered on time',unit:'%',operator:'>=',value:90}];
  },'Support coverage',85,'>=','%'),[85,90]);
 });
 it.each([
 ['engineers per week','The team capacity limit should be at most 2 engineers.'],
 ['engineers','The team capacity limit should be at most 2 engineers per week.'],
 ['tickets per week','The team capacity limit should be at most 2 specialists.'],
 ])('headcount/rate must not cross %s <- %s',async(unit,text)=>{
  await refuse(targetTurn(text,singleRate(unit),'Team capacity',2,'<=',unit));
 });
 it('own rate positive saves',async()=>{
  await press(targetTurn('The team capacity limit should be at most 2 engineers per week.',singleRate('engineers per week'),'Team capacity',2,'<=','engineers per week'),[2]);
 });
 it('disclosed oven-mixer pairing words count ovens: own card press saves',async()=>{
  await press(targetTurn('The oven-mixer pairing should be at most 2 ovens now, not 3.',g=>{g.goal_constraints=[structuredClone(OVENS)]},'Oven capacity',2),[2]);
 });
});

/** Codex R4 on #3433 @20a65841 (held-out, adopted verbatim): a denominator's MODIFIER is not its head, and a unit that states two periods is no unstated unit. */
describe('R4 independent limit denominator class',()=>{
 it.each([
 ['tickets per customer','The team capacity limit should be at most 2 tickets per customer account.'],
 ['tickets per engineer','The team capacity limit should be at most 2 tickets per engineer team.'],
 ['tickets per week','The team capacity limit should be at most 2 tickets per week per month.'],
 ])('no wrong limit %s <- %s',async(unit,text)=>{
  await refuse(targetTurn(text,singleRate(unit),'Team capacity',2,'<=',unit));
 });
 it.each([
 ['tickets per engineer','The team capacity limit should be at most 2 tickets per senior engineer.'],
 ['tickets per week','The team capacity limit should be at most 2 support tickets per week.'],
 ])('own head noun %s <- %s saves',async(unit,text)=>{
  await press(targetTurn(text,singleRate(unit),'Team capacity',2,'<=',unit),[2]);
 });
});

/** Codex R5 on #3433 @ab82694d (held-out, adopted verbatim, minus its console capture): the same full-unit rows at the limit door. */
describe("R5 independent limit full-unit writes",()=>{
 it.each([["tickets per account", "2 tickets per customer account", true], ["tickets per customer", "2 tickets per customer account", false], ["tickets per engineer", "2 tickets per engineer team", false], ["tickets", "2 ticket buyers", false], ["tickets", "2 support tickets", true], ["engineers", "2 engineer teams", false], ["engineers", "2 tickets", false], ["hires", "2 tickets", false], ["hires", "2 developers", true], ["engineers per week", "2 tickets per week", false], ["hires per week", "2 developers per week", true], ["hires per week", "2 developers", false], ["hires", "2 developers per week", false], ["tickets per week", "2 tickets per week per month", false], ["tickets per week", "2 tickets per month per week", false], ["tickets per engineer", "2 tickets per engineer per customer", false], ["tickets per week", "2 support tickets per week per month", false], ["tickets per week", "2 tickets per week", true]]) ("%s <- %s; expected write %s",async(unit,tail,write)=>{
 const {w,turn,r,made}=await targetTurn("The team capacity limit should be at most "+tail+".",singleRate(unit),"Team capacity",2,"<=",unit);
 let pressed:Rec|undefined;
 if(made?.ok===true){const chip=chipFor(r,idOf(r,"propose_limit_change"));pressed=await turn({message:chip.message,source:"chip_click",chip:{id:chip.id},agent_session_id:r._agent.session_id});}
 expect(limitRows(w.read()).map(c=>c.value)).toEqual([write?2:3]);
 if(write)expect(authorised(pressed!)).toEqual([expect.objectContaining({ok:true,mutated:true})]);
 });
});

/**
 * THE ASK AT THE LIMIT DOOR, AS THE AGENT RECEIVES IT (Codex R5 on #3433: "limit candidate naming remains unproved at code
 * level"). The rows read the Agent's NEXT model input (the request the route sends after `propose_limit_change` ran) and find,
 * by identity, the refusal it reads: the quantity the user's words gave the figure to (`written_for`) and the instruction to ask
 * naming both, quoting them. The words the Agent then writes are the model's. 0 provider calls.
 */
describe('the ask the Agent is given at the limit door names both quantities',()=>{
 const refusalTheAgentRead=():Rec=>{
  const sent=vi.mocked(fetch).mock.calls.map(([,init])=>JSON.parse(String((init as {body?:string}|undefined)?.body??'{}')) as Rec);
  const outputs=sent.flatMap(req=>((req.input??[]) as Rec[]).filter(i=>i.type==='function_call_output').map(i=>JSON.parse(String(i.output)) as Rec));
  const read=outputs.filter(o=>o.refusal==='figure_not_stated');
  expect(read,JSON.stringify(outputs).slice(0,3000)).toHaveLength(1);
  return read[0]!;
 };
 it('a figure the user gave to another limit: the Agent reads that limit\'s name and the instruction to ask about both',async()=>{
  await refuse(targetTurn('The shelf capacity limit should be at most 2 ovens.',standard,'Oven capacity',2));
  const read=refusalTheAgentRead();
  expect(read.written_for).toEqual(['Shelf capacity']);
  expect(read.detail).toBe('Nothing was prepared: the user wrote this figure, but their words give it to another quantity (named in '
   +'written_for), write it in another unit, or turn it down for the limit on "Oven capacity". Ask the user which they mean, '
   +'naming this limit and, when written_for names one, that quantity too, and quote their words; never just refuse.');
 });
 it('a unit no limit holds: the Agent reads this limit alone, still to be asked about, never refused',async()=>{
  await refuse(targetTurn('The team capacity limit should be at most 2 tickets per week per month.',singleRate('tickets per week'),'Team capacity',2,'<=','tickets per week'));
  const read=refusalTheAgentRead();
  expect(read.written_for).toEqual([]);
  expect(read.detail).toBe('Nothing was prepared: the user wrote this figure, but their words give it to another quantity (named in '
   +'written_for), write it in another unit, or turn it down for the limit on "Team capacity". Ask the user which they mean, '
   +'naming this limit and, when written_for names one, that quantity too, and quote their words; never just refuse.');
 });
 it('a figure whose limit the user\'s words leave open: the Agent reads that the user wrote it, and to ask whether it is this limit',async()=>{
  await refuse(targetTurn('Make it at most 2 ovens.',standard,'Oven capacity',2));
  const read=refusalTheAgentRead();
  expect(read).not.toHaveProperty('written_for');
  expect(read.detail).toBe('Nothing was prepared: the user wrote this figure, but their words do not say it is the limit on "Oven capacity" '
   +'rather than another. Ask whether it is, quoting their words; never offer a figure of your own as theirs.');
 });
});

/** Codex R6 on #3433 @a3649f14 (held-out, adopted verbatim): an unlisted held head ("nurses") keeps the user's figure out and the Agent is given the quantity-specific ask. */
describe('R6 unknown held head keeps the known figure and asks',()=>{it.each(["seats", "contractors", "tickets", "teams", "accounts", "shifts", "contractor teams", "unknownwidgets"])('nurses <- %s: next input accurately asks about the quantity',async(noun)=>{
 const words='The team capacity limit should be at most 2 '+noun+'.';
 await refuse(targetTurn(words,singleRate('nurses'),'Team capacity',2,'<=','nurses'));
 const sent=vi.mocked(fetch).mock.calls.map(([,init])=>JSON.parse(String((init as {body?:string}|undefined)?.body??'{}')) as Rec);
 const outputs=sent.flatMap(req=>((req.input??[]) as Rec[]).filter(i=>i.type==='function_call_output').map(i=>JSON.parse(String(i.output)) as Rec));
 const asks=outputs.filter(o=>o.refusal==='figure_not_stated');
 expect(asks).toHaveLength(1);
 expect(asks[0].detail).toBe('Nothing was prepared: the user wrote this figure, but their words give it to another quantity (named in written_for), write it in another unit, or turn it down for the limit on "Team capacity". Ask the user which they mean, naming this limit and, when written_for names one, that quantity too, and quote their words; never just refuse.');
 expect(asks[0].written_for).toEqual([]);
 });});
/** Codex R6 on #3433 @a3649f14 (held-out, adopted verbatim, minus its console capture): the person/thing heads at the limit door. */
describe("R6 person and nonperson counted heads",()=>{it.each([["nurses", "nurses", true], ["nurses", "seats", false], ["nurses", "contractors", false], ["nurses", "tickets", false], ["nurses", "teams", false], ["nurses", "accounts", false], ["nurses", "shifts", false], ["nurses", "nurse teams", false], ["nurses", "contractor teams", false], ["nurses", "unknownwidgets", false], ["seats", "nurses", false], ["seats", "seats", true], ["seats", "contractors", true], ["seats", "tickets", false], ["seats", "teams", false], ["seats", "accounts", false], ["seats", "shifts", false], ["seats", "nurse teams", false], ["seats", "contractor teams", false], ["seats", "unknownwidgets", false], ["contractors", "nurses", false], ["contractors", "seats", true], ["contractors", "contractors", true], ["contractors", "tickets", false], ["contractors", "teams", false], ["contractors", "accounts", false], ["contractors", "shifts", false], ["contractors", "nurse teams", false], ["contractors", "contractor teams", false], ["contractors", "unknownwidgets", false], ["hires", "nurses", false], ["hires", "seats", true], ["hires", "contractors", true], ["hires", "tickets", false], ["hires", "teams", false], ["hires", "accounts", false], ["hires", "shifts", false], ["hires", "nurse teams", false], ["hires", "contractor teams", false], ["hires", "unknownwidgets", false], ["hires", "developers", true], ["nurses", "nurses per week", false], ["nurses per week", "nurses", false], ["nurses per week", "nurses per week", true], ["contractors per week", "tickets per week", false], ["hires per week", "contractors per week", true]]) ("%s <- %s; expected write %s",async(unit,noun,write)=>{
 const {w,turn,r,made}=await targetTurn("The team capacity limit should be at most 2 "+noun+".",singleRate(unit),"Team capacity",2,"<=",unit);
 let pressed:Rec|undefined;
 if(made?.ok===true){const chip=chipFor(r,idOf(r,"propose_limit_change"));pressed=await turn({message:chip.message,source:"chip_click",chip:{id:chip.id},agent_session_id:r._agent.session_id});}
 expect(limitRows(w.read()).map(c=>c.value)).toEqual([write?2:3]);
 if(write)expect(authorised(pressed!)).toEqual([expect.objectContaining({ok:true,mutated:true})]);
 else expect(made).toEqual(expect.objectContaining({ok:false,refusal:'figure_not_stated'}));
});});
