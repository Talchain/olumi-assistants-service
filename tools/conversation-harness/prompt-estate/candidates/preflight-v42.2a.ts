/**
 * Static preflight for v42.2a: the candidate's TAUGHT phrasings must pass the
 * production guards; the phrasings it BANS must trip them (guards-work sanity).
 * Zero LLM calls. Run: <repo>/node_modules/.bin/tsx preflight-v42.2a.ts
 */
import { findForbiddenPhraseHit, findSuccessClaimHit } from '../scoring/forbidden-user-facing-phrases';
import { containsMutationLanguage, containsStructuralSuccessClaim } from '../scoring/mutation-language';

type Case = { label: string; text: string; expectHit: boolean };

const TAUGHT_GOOD: Case[] = [
  { label: 'earlier-run phrasing A', text: 'From the latest available run, Hire One Tech Lead comes out ahead in 87% of simulations.', expectHit: false },
  { label: 'earlier-run phrasing B', text: 'Before the recent model changes, the margin between your options was wider.', expectHit: false },
  { label: 'unverified-change phrasing', text: 'I can see the value you set for Team Execution Capacity; the fastest check is to open the factor and confirm it reads 8.', expectHit: false },
  { label: 'structural advice as property', text: 'Delivery Risk would work better as a constraint, because it caps the outcome rather than driving it.', expectHit: false },
  { label: 'mediator advice as property', text: 'A mediator between Team Technical Maturity and Development Throughput would capture the delay you described.', expectHit: false },
  { label: 'thin-context scoping', text: 'The view available to me here does not include per-factor influence; rerunning the analysis would surface it.', expectHit: false },
  { label: 'confirmation challenge', text: 'Your model gives Hire Two Mid-Level Developers the lead in only 10% of simulations, so the numbers do not yet back that choice. The one check that would settle it: validate the throughput gain you expect from a tech lead.', expectHit: false },
  { label: 'target-not-scored phrasing', text: 'Your 15% target has not been scored yet; rerunning the analysis with the goal threshold in place would measure each option against it.', expectHit: false },
];

const TAUGHT_BANNED: Case[] = [
  { label: 'previous analysis (egress ban)', text: 'In the previous analysis this option led.', expectHit: true },
  { label: 'nothing changed (denial family)', text: 'Nothing changed in your model.', expectHit: true },
  { label: 'tool call (internal term)', text: 'I made a tool call to update it.', expectHit: true },
  { label: 'I\'d suggest adding (mutation)', text: "I'd suggest adding a mediator between them.", expectHit: true },
  { label: 'gerund mutation advice', text: 'Adding a mediator between them would capture the delay.', expectHit: true },
];

let fail = 0;
function run(cases: Case[], scope: string) {
  for (const c of cases) {
    const egress = findForbiddenPhraseHit(c.text);
    const success = findSuccessClaimHit(c.text);
    const mut = containsMutationLanguage(c.text);
    const struct = containsStructuralSuccessClaim(c.text);
    const hit = Boolean(egress || success || mut || struct);
    const ok = hit === c.expectHit;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${c.label} -> egress=${egress ?? '-'} success=${success ?? '-'} mutation=${mut} structural=${struct}`);
  }
}
run(TAUGHT_GOOD, 'taught-good');
run(TAUGHT_BANNED, 'taught-banned');
console.log(fail === 0 ? 'PREFLIGHT CLEAN' : `PREFLIGHT FAILURES: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
