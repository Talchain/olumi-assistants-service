/**
 * ⛔ A WITHHELD GOAL CHANCE'S REASON IS SAID AS WRITTEN (AIQ 5887805333 (3); `goalChanceLineOwed`).
 *
 * Served #2285 witness (Runtime, 29 Sep, CEE `0497e52e`): the run withheld the goal's chance and the Agent paraphrased the
 * typed `say` as "…adds those effects instead of multiplying them" — true for a PRODUCT identity, false for a SUM. #416
 * fires for ANY unevaluated declared identity, so the typed sentence is pinned as the reply's own line.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { goalChanceLineOwed, goalChanceWithheldForAgent, GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED } from '../goal-chance-withheld.js';

type Json = Record<string, any>;
// PLoT #416's own words for a SUM identity (goalIdentityWithheldMessage: sum → " + ").
const SUM_WORDS = "Not shown. 'Total cost' depends on Staff cost + Cloud cost, but this run couldn't calculate it that way, "
  + 'so the figures for each option would be wrong.';
const block = (message: string): Json => ({ type: 'analysis_result', enrichment: { option_comparison: [],
  inference_warnings: [{ code: GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED, message, node_ids: ['total_cost'] }] } });
const SAY = goalChanceWithheldForAgent(block(SUM_WORDS))!.say;
const runWithheld: Json = { ok: true, ran: true, goal_chance: goalChanceWithheldForAgent(block(SUM_WORDS)) };
const runShown: Json = { ok: true, ran: true };
// The served paraphrase's shape, applied to the SUM: false (a sum IS "adding those effects").
const PARAPHRASE = 'The run could not use the formula for Total cost, so it adds those effects instead of multiplying them.';

describe('goalChanceLineOwed', () => {
  it('RED (served shape): a paraphrase of the reason → the typed sentence is owed, verbatim', () => {
    expect(SAY).toMatch(/^This run doesn’t show how often each option reaches the goal’s target\. 'Total cost' depends on Staff cost \+ Cloud cost/);
    expect(goalChanceLineOwed([runWithheld], PARAPHRASE)).toBe(SAY);
  });

  it('a reply that already says it verbatim owes nothing (never said twice)', () => {
    expect(goalChanceLineOwed([runWithheld], `Here is the run.\n\n${SAY}`)).toBeNull();
  });

  it('the first pass inside a build owes it too', () => {
    const build: Json = { ok: true, mutated: true, first_analysis: { ran: true, goal_chance: runWithheld.goal_chance } };
    expect(goalChanceLineOwed([build], PARAPHRASE)).toBe(SAY);
  });

  it('the LATEST run decides: a later run that did not withhold owes nothing; a later withheld run owes its own', () => {
    expect(goalChanceLineOwed([runWithheld, runShown], PARAPHRASE)).toBeNull();
    expect(goalChanceLineOwed([runShown, runWithheld], PARAPHRASE)).toBe(SAY);
  });

  it('no run this turn, or a run that did not withhold → nothing owed', () => {
    expect(goalChanceLineOwed([], PARAPHRASE)).toBeNull();
    expect(goalChanceLineOwed([{ ok: true, mutated: false, proposal_id: 'p' }], PARAPHRASE)).toBeNull();
    expect(goalChanceLineOwed([runShown], PARAPHRASE)).toBeNull();
  });

  it('SERVED 2397c7a (2/2): the Agent already said it with restyled quotes (**X**, “X”) → owed NOTHING (it was said twice)', () => {
    const FX = JSON.parse(readFileSync(new URL('./fixtures/served-2301-pinned-say-twice.json', import.meta.url), 'utf8')) as
      { warning_message: string; replies: { agent_text: string; served_reply: string }[] };
    const said = goalChanceWithheldForAgent(block(FX.warning_message))!;
    const run: Json = { ok: true, ran: true, goal_chance: said };
    for (const r of FX.replies) {
      expect(r.agent_text.includes(said.say), 'precondition: not a byte match (the served defect)').toBe(false);
      expect(r.served_reply.endsWith(said.say), 'precondition: served appended it').toBe(true);
      expect(goalChanceLineOwed([run], r.agent_text), r.agent_text.slice(0, 60)).toBeNull();
    }
  });

  it('only quotes, emphasis and spacing are forgiven: a changed operator or word is not the sentence, so it is still owed', () => {
    const plus = SAY.replace(' + ', ' × ');
    expect(plus).not.toBe(SAY);
    expect(goalChanceLineOwed([runWithheld], plus)).toBe(SAY);
    expect(goalChanceLineOwed([runWithheld], SAY.replace('would be wrong', 'may be off'))).toBe(SAY);
    expect(goalChanceLineOwed([runWithheld], `• ${SAY.replace(/'/g, '**').replace(/\s+/g, '  ')}`)).toBeNull();
  });

  it('WIRING: the route appends it with the owed disclosures, checked against the Agent\'s own text', () => {
    const src = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    // MC D1 (c): the Run's #416 ask is owed right after the goal-chance line, in the same list.
    // Class (i): the amendment-A scoped owner supplies the final Run sentence; raw tool output is the fallback.
    expect(src).toContain('const goalChanceResults = finalGoalChance === undefined ? result.tool_results : [{ goal_chance: finalGoalChance }];');
    expect(src).toContain('...[goalChanceLineOwed(goalChanceResults, text)].filter((x): x is string => x !== null),\n'
      + '        // MC D1 (c): the Run\'s #416 ask, after its reason (never a bare "couldn\'t calculate it" with nothing to answer).\n'
      + '        ...[identityAskLineOwed(result.tool_results, text)].filter((x): x is string => x !== null),\n      ];');
    // Exact host-copy display normalisation preserves the narrator and the same owed lines.
    expect(src).toContain('const narrationText = withDecisionInputAskDisplay(scopedNarration, readbackGraph);');
    expect(src).toContain('withDisclosures(narrationText, owed)');
    expect(src).toContain('withDisclosures(narrationText, [...owed, ...decisionLines])');
  });
  it('R13 MUTANT: a raw-tool-only owed line loses the final scoped owner', () => {
    const src = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    const pin = '...[goalChanceLineOwed(goalChanceResults, text)].filter((x): x is string => x !== null),';
    expect(src.includes(pin)).toBe(true);
    expect(src.replace(pin, pin.replace('goalChanceResults', 'result.tool_results')).includes(pin)).toBe(false);
    // A later Run still clears an earlier withhold when no scoped final sentence exists.
    expect(goalChanceLineOwed([runWithheld, runShown], PARAPHRASE)).toBeNull();
  });
});
