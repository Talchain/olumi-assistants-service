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
