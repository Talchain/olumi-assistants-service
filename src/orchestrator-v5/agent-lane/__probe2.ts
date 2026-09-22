import { readFileSync } from 'node:fs';
import { admitCandidateModel } from './admit-model.js';
const base = new URL('./__tests__/fixtures/', import.meta.url);
const faithful = JSON.parse(readFileSync(new URL('faithful.json', base),'utf8'));
const widened = JSON.parse(readFileSync(new URL('widened.json', base),'utf8'));
const m = admitCandidateModel(faithful as any, widened as any);
const blob = JSON.stringify(m);
for (const k of ['why_material','fidelity_warnings','excluded','unknowns','reasoning']) {
  console.log(`admitted output contains "${k}":`, blob.includes(k));
}
// CONTRAST CONTROL: a string we KNOW is carried through.
for (const k of ['Monthly churn rate','brief_extraction','defaulted']) {
  console.log(`CONTROL admitted output contains "${k}":`, blob.includes(k));
}
console.log('loss n=', m.loss.length, 'codes', JSON.stringify([...new Set(m.loss.map(l=>l.code))]));
console.log('withheld n=', m.withheld.length, 'reasons', JSON.stringify([...new Set(m.withheld.map(w=>w.reason))]));
console.log('edges with provenance.reasoning:', m.edges.filter(e=>e.provenance && (e.provenance as any).reasoning !== undefined).length, 'of', m.edges.length);
// Does any loss entry mention a fidelity warning text or an excluded candidate?
const exCand = (widened.excluded||[]).map((e:any)=>e.candidate);
console.log('excluded candidates:', JSON.stringify(exCand));
console.log('any loss/withheld entry mentioning an excluded candidate:', exCand.some((c:string)=>blob.includes(c)));
const fw = (widened.fidelity_warnings||[]);
console.log('fidelity_warnings sample:', JSON.stringify(fw.slice(0,2)));
console.log('any fidelity_warning text present in admitted output:', fw.some((w:any)=>blob.includes(typeof w==='string'?w:JSON.stringify(w).slice(1,40))));
console.log('unknowns present in admitted output:', (faithful.unknowns||[]).some((u:string)=>blob.includes(u)));
