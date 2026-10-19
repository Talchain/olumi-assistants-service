/**
 * ⛔ THE VALUE DOOR ASKS THE ONE QUANTITY-IDENTITY RULE, AND ITS VERDICT GOVERNS THE WRITE (DL-3, from step 8b's finding on
 * staging: "70 customers per week; the existing team capacity is unchanged" saved 70 as the team's capacity; Codex R3 on #3433
 * @d3bcc80e: a "field binding unverified" label on that card still wrote it). The user wrote 70, but about customers, and said
 * the team is unchanged: the team's capacity is never written with it, labelled or not. Nothing is proposed for it and the Agent
 * asks which figure they mean. The user's own clause naming the factor, in its own unit, still binds and saves.
 *
 * THE PATH: the REAL route → the REAL Agent loop → the REAL `propose_assumptions` → the card → the press → the level writer → the
 * store. Scripted: only the Agent's outputs. 0 provider calls. SYNTHETIC wording and model.
 */
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in the value-identity replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the value-identity replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { authorised, call, chipFor, closeApps, edge, idOf, node, route, say, world as worldOver, type Rec } from './fixtures/approval-world.js';

const world = () => worldOver(live);
afterEach(closeApps);

/** Codex R3's held-out value rows, adopted verbatim: nine wrote a quantity the user's words never gave the figure to. */
async function valueTurn(text:string,label='Existing team capacity',unit='tickets per week',rival='Additional specialist capacity',rivalUnit=unit,value=70){
 const w=world();const turn=await route(w);
 w.edit(g=>{g.nodes.push(
  {id:'team_capacity',ref:'F3',kind:'factor',label,category:'external',provenance:'ai_inferred',scale_frame:500,observed_state:{unit,raw_value:80,value:0.16,source:'cee_inference'}},
  {id:'specialist_capacity',ref:'F4',kind:'factor',label:rival,category:'external',provenance:'ai_inferred',scale_frame:500,observed_state:{unit:rivalUnit,raw_value:90,value:0.18,source:'cee_inference'}});
  g.edges.push(edge('team_capacity','orders_on_time',0.4),edge('specialist_capacity','orders_on_time',0.2));
  // A stored graph's ref counter covers its refs (every writer raises it: `assignEntityRefs`). F3 and F4 above F:2 made the
  // commit raise it, so the readback (F:4) never equalled the plan (F:2): the receipt's not_confirmed was this fixture's.
  g.ref_high_water={...g.ref_high_water,F:4};
  if(label==='Current coverage')g.goal_constraints=[{constraint_id:'gc-goal',node_id:'orders_on_time',label:'Orders delivered on time',operator:'>=',value:95,unit:'%',value_frame:'level',provenance:'explicit'}];
 });
 const r=await turn({message:text,source:'composer'},[call('propose_assumptions',{assumptions:[{factor_label:label,value,unit,user_stated:true,revise:true,basis:'User correction'}]}),say('Here is a card to review.')]);
 const made=(r._agent.tool_calls as Rec[]).find(c=>c.name==='propose_assumptions');expect(made).toBeDefined();
 const before=node(w.read(),'team_capacity').observed_state;
 let chip:Rec|undefined,pressed:Rec|undefined;
 if(made?.ok===true){chip=chipFor(r,idOf(r,'propose_assumptions'));pressed=await turn({message:chip.message,source:'chip_click',chip:{id:chip.id},agent_session_id:r._agent.session_id});}
 const saved=node(w.read(),'team_capacity').observed_state;
  return {before,saved,chip,made,pressed};
}
describe('R3 independent value-door exact-write contract',()=>{
 it.each(['70','seventy'])('customers %s never changes unchanged team capacity',async(fig)=>{
  const {saved}=await valueTurn(`We now have ${fig} customers per week; the existing team capacity is unchanged.`);
  expect(saved.raw_value).toBe(80);
 });
 it('shared fragment cannot select Annual from Monthly',async()=>{
  const {saved}=await valueTurn('Support capacity is 70 tickets per week.','Annual support capacity','tickets per week','Monthly support capacity');
  expect(saved.raw_value).toBe(80);
 });
 it.each([
 ['Completion','%','The % is 70%.','%'],
 ['Budget','£','The £ is £70.','GBP'],
 ])('symbol named rival never changes %s',async(label,rival,text,unit)=>{
  const {saved}=await valueTurn(text,label,unit,rival);expect(saved.raw_value).toBe(80);
 });
 it('cross-occurrence rejected team70 and affirmed specialist70 never changes team',async()=>{
  const {saved}=await valueTurn('The existing team capacity remains 80 tickets per week, not 70 tickets per week; additional specialist capacity is 70 tickets per week.');
  expect(saved.raw_value).toBe(80);
 });
 it('cross-occurrence affirmed team70 and rejected specialist70 still saves',async()=>{
  const {saved,pressed}=await valueTurn('Additional specialist capacity remains 90 tickets per week, not 70 tickets per week; existing team capacity is 70 tickets per week.');
  expect(saved.raw_value).toBe(70);expect(authorised(pressed!)).toEqual([expect.objectContaining({ok:true,mutated:true})]);expect(saved.user_material_unverified).toBeUndefined();
 });
 it('goal row figure never changes separate factor',async()=>{
  const {saved}=await valueTurn('Orders delivered on time target is 70%; current coverage is unchanged.','Current coverage','%','Other coverage');
  expect(saved.raw_value).toBe(80);
 });
 it.each([
 ['tickets per week','The existing team capacity is 70 specialists.'],
 ['specialists','The existing team capacity is 70 specialists per week.'],
 ['specialists per week','The existing team capacity is 70 specialists.'],
 ])('headcount/rate does not cross %s <- %s',async(unit,text)=>{
  const {saved}=await valueTurn(text,'Existing team capacity',unit,'Additional specialists','specialists');expect(saved.raw_value).toBe(80);
 });
 it('the figure is written in the team\'s unit but about the specialists: nothing proposed for the team, no card, the team unchanged', async () => {
  const { made, chip, saved } = await valueTurn('Additional specialist capacity is 70 tickets per week; the existing team stays as before.');
  expect(made, JSON.stringify(made)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'nothing_to_adopt' }));
  expect(chip).toBeUndefined();
  expect(saved.raw_value).toBe(80);
 });
 it('own quantity positive saves exactly70 and stays bound',async()=>{
  const {saved,pressed,chip}=await valueTurn('Correction: existing team capacity is 70 tickets per week, not 80.');
  expect(saved.raw_value).toBe(70);expect(saved.unit).toBe('tickets per week');expect(saved.user_material_unverified).toBeUndefined();
  expect(authorised(pressed!)).toEqual([expect.objectContaining({ok:true,mutated:true})]);expect(chip?.detail).not.toContain('field binding unverified');
 });
});

/** Codex R4 on #3433 @20a65841 (held-out, adopted verbatim, minus its console capture): a denominator's MODIFIER is not its head ("per customer ACCOUNT" counts accounts), a unit stating two periods is no unstated unit, and the unclear path keeps its labelled card. */
describe('R4 independent full-unit class',()=>{
 it.each([
 ['tickets per customer','Correction: existing team capacity is 70 tickets per customer account.'],
 ['tickets per engineer','Correction: existing team capacity is 70 tickets per engineer team.'],
 ['tickets per week','Correction: existing team capacity is 70 tickets per week per month.'],
 ['tickets per week','We now have 70 customers per week; the existing team capacity is unchanged.'],
 ])('no wrong value %s <- %s',async(unit,text)=>{
  const {saved}=await valueTurn(text,'Existing team capacity',unit,'Additional specialist capacity',unit);
  expect(saved.raw_value).toBe(80);
 });
 it.each([
 ['tickets per engineer','Correction: existing team capacity is 70 tickets per senior engineer.'],
 ['tickets per week','Correction: existing team capacity is 70 support tickets per week.'],
 ])('own head noun %s <- %s saves',async(unit,text)=>{
  const {saved,pressed}=await valueTurn(text,'Existing team capacity',unit,'Additional specialist capacity',unit);
  expect(saved.raw_value).toBe(70);expect(saved.unit).toBe(unit);
  expect(authorised(pressed!)).toEqual([expect.objectContaining({ok:true,mutated:true})]);
 });
 it('unclear has a labelled card, press and human-unverified save',async()=>{
  const {saved,chip,pressed}=await valueTurn('The figure is 70 tickets per week.');
  expect(chip?.detail).toContain('field binding unverified');expect(saved.raw_value).toBe(70);
  expect(saved.user_material_unverified).toBe(true);expect(authorised(pressed!)).toEqual([expect.objectContaining({ok:true,mutated:true})]);
 });
 it('REAL-path positive on unedited canonical graph returns a true receipt and exact saved figure',async()=>{
  const w=world(),turn=await route(w);
  const r=await turn({message:'Correction: oven capacity is 2 ovens, not 1.',source:'composer'},[call('propose_assumptions',{assumptions:[{factor_label:'Oven capacity',value:2,unit:'ovens',user_stated:true,revise:true,basis:'User correction'}]}),say('Review the change.')]);
  const chip=chipFor(r,idOf(r,'propose_assumptions'));
  const pressed=await turn({message:chip.message,source:'chip_click',chip:{id:chip.id},agent_session_id:r._agent.session_id});
  expect(authorised(pressed)).toEqual([expect.objectContaining({ok:true,mutated:true})]);
  expect(node(w.read(),'oven_capacity').observed_state).toMatchObject({raw_value:2,unit:'ovens',source:'user_override'});
 });
});

/**
 * THE ASK, AS THE AGENT RECEIVES IT (DL-3 condition on the converted rows; Codex R4 on #3433: "the candidate-naming ask is
 * unproved"). Scripted Agent prose proves nothing, so these rows read the Agent's NEXT model input (the request the route sends
 * after `propose_assumptions` ran) and find, by identity, the tool result it reads: the factor, the user's figure, the quantity
 * their words gave it to, and the instruction to ask naming both and quoting them. The words the Agent then writes are the
 * model's; what it is given to write them from is proved here. 0 provider calls.
 */
describe('the ask the Agent is given names both quantities',()=>{
 const NOTE='Nothing was proposed for these: the user wrote the figure, but their words give it to another quantity (named in written_for), '
  +'write it in another unit, or turn it down for this one. Never record it as this factor’s value. Ask the user which they '
  +'mean, naming this factor and, when written_for names one, that quantity too, and quote their words; never just refuse.';
 /** The propose_assumptions result as the Agent's next request carried it. */
 const resultTheAgentRead=():Rec=>{
  const sent=vi.mocked(fetch).mock.calls.map(([,init])=>JSON.parse(String((init as {body?:string}|undefined)?.body??'{}')) as Rec);
  const outputs=sent.flatMap(req=>((req.input??[]) as Rec[]).filter(i=>i.type==='function_call_output').map(i=>JSON.parse(String(i.output)) as Rec));
  const read=outputs.filter(o=>'not_this_factors_figure' in o);
  expect(read,JSON.stringify(outputs).slice(0,3000)).toHaveLength(1);
  return read[0]!;
 };
 it('a figure the user gave to another quantity: the Agent reads that quantity\'s name and the instruction to ask about both',async()=>{
  await valueTurn('Additional specialist capacity is 70 tickets per week; the existing team stays as before.');
  const read=resultTheAgentRead();
  expect(read.not_this_factors_figure).toEqual([{label:'Existing team capacity',value:70,written_for:['Additional specialist capacity']}]);
  expect(read.not_this_factors_figure_note).toBe(NOTE);
 });
 it('a figure written in another unit: the Agent reads the quantity that unit fits',async()=>{
  await valueTurn('Correction: existing team capacity is 70 tickets per month.','Existing team capacity','tickets per week','Additional specialist capacity','tickets per month');
  expect(resultTheAgentRead().not_this_factors_figure).toEqual([{label:'Existing team capacity',value:70,written_for:['Additional specialist capacity']}]);
 });
 it('a unit no quantity holds: the Agent reads this factor alone, still to be asked about, never refused',async()=>{
  await valueTurn('Correction: existing team capacity is 70 tickets per week per month.');
  const read=resultTheAgentRead();
  expect(read.not_this_factors_figure).toEqual([{label:'Existing team capacity',value:70,written_for:[]}]);
  expect(read.not_this_factors_figure_note).toBe(NOTE);
 });
 it('CONTROL: the user\'s own clause, in its own unit, carries no ask',async()=>{
  await valueTurn('Correction: existing team capacity is 70 tickets per week, not 80.');
  const sent=vi.mocked(fetch).mock.calls.map(([,init])=>String((init as {body?:string}|undefined)?.body??''));
  expect(sent.some(b=>b.includes('not_this_factors_figure'))).toBe(false);
  expect(sent.some(b=>b.includes('function_call_output'))).toBe(true);
 });
});

/** Codex R5 on #3433 @ab82694d (held-out, adopted verbatim): each unit part by its head, a headcount unit counts only another headcount ("70 tickets" are no hires; "70 engineer teams" no engineers), and two periods are no unstated unit. */
describe("R5 independent value full-unit writes",()=>{
 it.each([["tickets per account", "70 tickets per customer account", true], ["tickets per customer", "70 tickets per customer account", false], ["tickets per engineer", "70 tickets per engineer team", false], ["tickets", "70 ticket buyers", false], ["tickets", "70 support tickets", true], ["engineers", "70 engineer teams", false], ["engineers", "70 tickets", false], ["hires", "70 tickets", false], ["hires", "70 developers", true], ["engineers per week", "70 tickets per week", false], ["hires per week", "70 developers per week", true], ["hires per week", "70 developers", false], ["hires", "70 developers per week", false], ["tickets per week", "70 tickets per week per month", false], ["tickets per week", "70 tickets per month per week", false], ["tickets per engineer", "70 tickets per engineer per customer", false], ["tickets per week", "70 support tickets per week per month", false], ["tickets per week", "70 tickets per week", true]]) ("%s <- %s; expected write %s",async(unit,tail,write)=>{
 const {saved,pressed}=await valueTurn("Correction: existing team capacity is "+tail+".","Existing team capacity",unit,"Additional specialist capacity",unit);
 expect(saved.raw_value).toBe(write?70:80);
 if(write){expect(saved.unit).toBe(unit);expect(authorised(pressed!)).toEqual([expect.objectContaining({ok:true,mutated:true})]);}
 });
});

/** Codex R6 on #3433 @a3649f14 (held-out, adopted verbatim, minus its console capture): a person head is never a thing, a group or another unlisted head, and where the user's figure counts another thing the Agent is given the quantity-specific ask, never the generic refusal. */
describe("R6 person and nonperson counted heads",()=>{it.each([["nurses", "nurses", true], ["nurses", "seats", false], ["nurses", "contractors", false], ["nurses", "tickets", false], ["nurses", "teams", false], ["nurses", "accounts", false], ["nurses", "shifts", false], ["nurses", "nurse teams", false], ["nurses", "contractor teams", false], ["nurses", "unknownwidgets", false], ["seats", "nurses", false], ["seats", "seats", true], ["seats", "contractors", true], ["seats", "tickets", false], ["seats", "teams", false], ["seats", "accounts", false], ["seats", "shifts", false], ["seats", "nurse teams", false], ["seats", "contractor teams", false], ["seats", "unknownwidgets", false], ["contractors", "nurses", false], ["contractors", "seats", true], ["contractors", "contractors", true], ["contractors", "tickets", false], ["contractors", "teams", false], ["contractors", "accounts", false], ["contractors", "shifts", false], ["contractors", "nurse teams", false], ["contractors", "contractor teams", false], ["contractors", "unknownwidgets", false], ["hires", "nurses", false], ["hires", "seats", true], ["hires", "contractors", true], ["hires", "tickets", false], ["hires", "teams", false], ["hires", "accounts", false], ["hires", "shifts", false], ["hires", "nurse teams", false], ["hires", "contractor teams", false], ["hires", "unknownwidgets", false], ["hires", "developers", true], ["nurses", "nurses per week", false], ["nurses per week", "nurses", false], ["nurses per week", "nurses per week", true], ["contractors per week", "tickets per week", false], ["hires per week", "contractors per week", true]]) ("%s <- %s; expected write %s",async(unit,noun,write)=>{
 const {saved,pressed,made}=await valueTurn("Correction: existing team capacity is 70 "+noun+".","Existing team capacity",unit,"Additional specialist capacity",unit);
 expect(saved.raw_value).toBe(write?70:80);
 if(write){expect(saved.unit).toBe(unit);expect(authorised(pressed!)).toEqual([expect.objectContaining({ok:true,mutated:true})]);}
 else {
 expect(saved.unit).toBe(unit);
 const sent=vi.mocked(fetch).mock.calls.map(([,init])=>JSON.parse(String((init as {body?:string}|undefined)?.body??'{}')) as Rec);
 const outputs=sent.flatMap(req=>((req.input??[]) as Rec[]).filter(i=>i.type==='function_call_output').map(i=>JSON.parse(String(i.output)) as Rec));
 const asks=outputs.filter(o=>'not_this_factors_figure' in o);
 expect(asks,JSON.stringify(outputs)).toHaveLength(1);
 expect(asks[0].not_this_factors_figure).toEqual([{label:'Existing team capacity',value:70,written_for:[]}]);
 expect(asks[0].not_this_factors_figure_note).toBe('Nothing was proposed for these: the user wrote the figure, but their words give it to another quantity (named in written_for), write it in another unit, or turn it down for this one. Never record it as this factor’s value. Ask the user which they mean, naming this factor and, when written_for names one, that quantity too, and quote their words; never just refuse.');
 expect(made).toEqual(expect.objectContaining({ok:false,refusal:'nothing_to_adopt'}));
}
});});
