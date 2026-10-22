import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CORE_ALIGNED_INSTRUCTIONS, CORE_NEXT_STEP, CORE_REPLY_INSTRUCTION, NOTE_ON_ITEM_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION, instructionsForMode, MODEL_RELATIVE_NAMING_INSTRUCTION,
  promptArmOf, coreEffortArmOf } from '../../../routes/agent-v1-turn.js';
import { coreBudget } from '../model-budgets.js';
import { OLUMI_PURPOSE_INSTRUCTION } from '../olumi-purpose.js';
import { HOST_SCIENCE_AND_SOURCE_RULES, HOST_TOOL_CONTRACT } from '../coach-route-v0_2.js';
import { createHash } from 'node:crypto';
import { CORE_DRAFTING_GUIDANCE } from '../../path-b/drafting-guidance.js';

/** Tools the core agent does not have, named by the legacy routing arm B removes (AIE #3523 6298433275). */
const LEGACY_TOOLS = ['propose_starting_point', 'propose_assumptions', 'authorise_change', 'get_canonical_state', 'propose_link_effect',
  'propose_model_change', 'propose_option_interventions', 'propose_hiring_times'];
const CORE_TOOLS = ['read_canonical_context', 'build_model_from_brief', 'propose_change', 'apply_change', 'run_analysis'];
const count = (text: string, part: string): number => text.split(part).length - 1;

describe('prompt arm B (programme-docs #94 6302769609): the core agent is told only about the tools it has', () => {
  const b = instructionsForMode('core', CORE_ALIGNED_INSTRUCTIONS);

  it('names none of the legacy tools and every core tool, with the AIE authority and starting-input wording', () => {
    for (const t of LEGACY_TOOLS) expect(b, t).not.toContain(t);
    for (const t of CORE_TOOLS) expect(b, t).toContain(t);
    expect(b).toContain("Do not treat a typed yes or your own interpretation as the card's approval.");
    expect(b).toContain('offer clearly labelled Olumi assumptions through propose_change for review');
    expect(b).not.toContain('{{MODE_AND_AUTHORITY}}');
  });

  it('keeps the shared reasoning, science and reply rules, each once, and the core reply rule last', () => {
    for (const h of ['\nTRUTH\n', '\nREASONING\n', '\nAUTHORSHIP\n', '\nIDEATION\n', 'POLYMATH COACHING', 'CALCULATION BOUNDARY']) expect(b, h).toContain(h);
    for (const part of [OLUMI_PURPOSE_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION, MODEL_RELATIVE_NAMING_INSTRUCTION, CORE_REPLY_INSTRUCTION,
      HOST_SCIENCE_AND_SOURCE_RULES]) expect(count(b, part)).toBe(1);
    // The host contract's science, source and freshness rules ride along byte for byte (AIE 22:17Z), naming no tool.
    for (const rule of ['Never express the chance as a percentage of model runs.', 'Earlier assistant replies can describe a Run that was current then',
      'that separation rests on Olumi\'s own starting estimates', "The goal\u2019s `target` is the figure the user stated"]) expect(b, rule).toContain(rule);
    expect(b.endsWith(CORE_REPLY_INSTRUCTION)).toBe(true);
  });

  it('arm B is the AIE\'s assembled reference, byte for byte (programme-docs #94 6303242136, static text sha256 7b6145d4…), plus the canvas-coaching sentence', () => {
    expect(b.split(NOTE_ON_ITEM_INSTRUCTION)).toHaveLength(2);
    // 7b6145d4… until 21 Oct; arm C's adoption changed only the closing core reply rule (see its row), now 56625e00….
    expect(createHash('sha256').update(b.replace(`${NOTE_ON_ITEM_INSTRUCTION}\n\n`, ''), 'utf8').digest('hex')).toBe('43dadadf9793766dba4ca861e9982f7d2397d89cd158685c92f64d321e1d263f'); // 22 Oct: a quantitative aim's missing target and deadline are prioritised, unless declined or a framing/evidence question decides more (Q2 fm1 7/8 half; Codex r1 #3645; was 1545a0fc…). 23 Oct (b): the boundary said as the person's own arithmetic, the input always named, the low/high invited (DL, double-judged R2; was f9c44c8f…). 23 Oct: exact inputs → each option's margin as goal_margins states it + a stress_test offered at the boundary of the input it rests on (DL brief, R2 c1; was 97d3bea4…). 22 Oct: exact inputs → the Run's own results + the person's choice of figure to test (Track 3 c5; Codex r1 #3625; was 52d3ab03…); stress_test only for a sized link/factor (buddy SIMPLER, was 9a57bae9…); the three-part coaching after a Run (part 2 never ranks unmeasured figures, Codex r1) + the held-risk window ask (Track 3 judge on 4b, 11 c1 zeros; was 6dedb153…). 21 Oct: + Olumi's labelled estimate on another's item (estimate_by); + CORE_NEXT_STEP decisive question (Track 3 Q2 v2 + buddy AMEND, 21 Oct; was a605c43f…)
    // Candidate-3 witnesses (21 Oct): presence checks (text only, not behaviour): WHEN to build, and Olumi's additions on a card.
    expect(b).toContain('build the first model from their brief in that same turn');
    expect(b).toContain('a list in your reply adds nothing to their model');
  });

  it('arm A is untouched: the legacy host contract is byte-identical to staging b76bc42c', () => {
    expect(createHash('sha256').update(HOST_TOOL_CONTRACT, 'utf8').digest('hex')).toBe('a118a398d9e214017df46195c40ece2105d70d8343577ed14521b10736edf64d');
  });

  it('canvas coaching: every core call carries the note_on_item sentence once, on both arms; no other mode gets it', () => {
    for (const arm of [CORE_ALIGNED_INSTRUCTIONS, 'legacy arm A text']) {
      const sent = instructionsForMode('core', arm);
      expect(sent.split(NOTE_ON_ITEM_INSTRUCTION)).toHaveLength(2);
      expect(sent.endsWith(CORE_REPLY_INSTRUCTION)).toBe(true);
    }
    expect(instructionsForMode('full', 'legacy arm A text')).not.toContain('note_on_item');
  });

  it('every core turn takes arm B, whatever the header; every other mode keeps arm A', () => {
    // Buddy SIMPLER on #3571 (21 Oct): arm B, which names only the tools core has, is every core turn's authority; no header
    // selects anything. Every other mode keeps arm A.
    for (const header of [undefined, 'A', 'B', 'C', 'b', ['B']]) expect(promptArmOf('core', header)).toBe('B');
    expect(promptArmOf('full', 'B')).toBe('A');
  });

  it('arm C ADOPTED (Paul 21 Oct, long replies narrating the tools; R2 100 % at 90 words median): the core reply rule speaks in the user\u2019s terms with a length bound', () => {
    expect(CORE_REPLY_INSTRUCTION).not.toContain('from this turn\u2019s tool results');
    expect(CORE_REPLY_INSTRUCTION).toContain('never your tools or what a tool response did or did not contain');
    // Paul, 21 Oct (standing): bullets first, detail on request: the approved discipline from the served routing prompt, verbatim.
    const routing = readFileSync(new URL('../../../../Prompts/canonical/routing.txt', import.meta.url), 'utf8');
    const discipline = routing.slice(routing.indexOf('<RESPONSE_DISCIPLINE>'), routing.indexOf('</RESPONSE_DISCIPLINE>') + '</RESPONSE_DISCIPLINE>'.length);
    expect(discipline.length).toBeGreaterThan(500);
    expect(CORE_REPLY_INSTRUCTION).toContain(discipline);
    expect(CORE_REPLY_INSTRUCTION).not.toContain('weave at most one next step');
    // Track 3 E2E (served dce1b50a, 21 Oct, Q2 0/8 decisive): with no Run result, the one question is the input that decides
    // between the options, never the readiness list, and never a date the brief already gave.
    expect(CORE_REPLY_INSTRUCTION.split(CORE_NEXT_STEP)).toHaveLength(2);
    expect(CORE_REPLY_INSTRUCTION.indexOf(CORE_NEXT_STEP)).toBeGreaterThan(CORE_REPLY_INSTRUCTION.indexOf(discipline));
    expect(CORE_NEXT_STEP).toContain('the input that would most change how their options compare on their goal');
    // Track 3 default Q2 (8177faa9, v2 half 6/6): the one question was secondary while the goal's figure, today's level or an
    // option's effect decided more. Those are named as the usual decisive inputs (a vague goal gets Olumi's suggested measure);
    // buddy AMEND: never a fixed order, since a framing or evidence question comes first when it decides more, and the reply
    // says what the answer would change.
    expect(CORE_NEXT_STEP).toContain('That is usually the goal\u2019s figure (when they named no measure, suggest one as yours and ask for its figure), today\u2019s level of what it measures, or what an option would deliver or cost;');
    expect(CORE_NEXT_STEP).toContain('a question about what success means or what evidence would change their view comes first only when it decides more.');
    // Q2 fm1 (22 Oct, double-judged 7/8 half): an aim with no target figure got a question about something else.
    // Codex r1 #3645: never over a decisive evidence question, never again after they declined to set one.
    expect(CORE_NEXT_STEP).toContain('For a quantitative aim whose chance they want assessed, prioritise its missing target and deadline unless they have declined to set one or a framing or evidence question would change the comparison more.');
    expect(CORE_NEXT_STEP).toContain('Say in a few words what their answer would change.');
    expect(CORE_NEXT_STEP).not.toContain('in this order');
    // Codex #3571 BLOCK: a state query ("what is still needed?") is answered in full.
    expect(CORE_NEXT_STEP).toContain('When they ask what is still needed, give the complete list.');
    // The licences, attribution and Run-coaching rules are kept.
    for (const rule of ['never call a win share a chance', 'never call an option best, a winner or recommended',
      'approving a reading adopts it but does not make the user its author', 'A Run that did not complete leaves a saved change saved'])
      expect(CORE_REPLY_INSTRUCTION, rule).toContain(rule);
    const sent = instructionsForMode('core', 'legacy arm A text');
    expect(sent.endsWith(CORE_REPLY_INSTRUCTION)).toBe(true);
    expect(sent.split(NOTE_ON_ITEM_INSTRUCTION)).toHaveLength(2);
    expect(instructionsForMode('full', 'legacy arm A text')).toBe('legacy arm A text');
  });

  it('candidate 5 (Track 3 judge on 4b, 22 Oct): coaching after a Run names its three specific parts and never closes on a general caution; an inferred item is Olumi\'s', () => {
    expect(CORE_REPLY_INSTRUCTION).toContain('(2) what the result depends on: when the run facts measure sensitivity, the most-sensitive assumption');
    // Codex r1: never an unmeasured importance claim (run-facts.ts:84).
    expect(CORE_REPLY_INSTRUCTION).toContain('without ranking them or saying which matters most');
    // Track 3 on candidate 5: exact-figure briefs get the Run's own results and the person's choice of figure to test, never a generic caution.
    // DL 23 Oct (R2 c1): the margin is now the Run's own fact (goal_margins), said as stated, still never worked out by the AI.
    expect(CORE_REPLY_INSTRUCTION).toContain('when every input is the person\u2019s own exact figure, say so once and give each option\u2019s result against the target as goal_margins states it (how far above or below the target it lands, in the target\u2019s unit), never worked out from the inputs');
    // Codex r1 on #3625: no computed margin and no unmeasured "nearest" ranking.
    expect(CORE_REPLY_INSTRUCTION).not.toContain('nearest the target');
    expect(CORE_REPLY_INSTRUCTION).not.toContain('how far each option lands');
    expect(CORE_REPLY_INSTRUCTION).toContain('without one, ask which of their own stated figures they are least sure of and offer to test it at a value they name (stress_test)');
    // DL 23 Oct (double-judged R2 on 7b0af1a9): (a) the boundary is the person's own arithmetic, never a recorded threshold, with
    // which side of "equal" meets the target (Codex on the approach); (b) the input is always named where goal_margins gives one;
    // (c) fm6: the input a chance would need is invited, never promised or suggested.
    expect(CORE_REPLY_INSTRUCTION).toContain('from this Run\u2019s own figures, <input> at <boundary> is where <option>\u2019s level would equal the target');
    expect(CORE_REPLY_INSTRUCTION).toContain('an \u201cat least\u201d or \u201cat most\u201d target is met at that point, an \u201cabove\u201d or \u201cbelow\u201d one is not');
    expect(CORE_REPLY_INSTRUCTION).toContain('never as a recorded or measured threshold');
    expect(CORE_REPLY_INSTRUCTION).toContain('always name that input and its boundary');
    expect(CORE_REPLY_INSTRUCTION).toContain('never say no further input is needed');
    expect(CORE_REPLY_INSTRUCTION).toContain('give its lowest and highest likely values, without promising that a chance will then be shown and without suggesting the values');
    expect(CORE_REPLY_INSTRUCTION).not.toContain('rests on most: the measured');
    expect(CORE_REPLY_INSTRUCTION).toContain('(3) one concrete next step for the model');
    // planStress tests only a sized link effect or factor level; a risk chance or missing figure is asked for.
    expect(CORE_REPLY_INSTRUCTION).toContain('a risk\u2019s chance or a missing figure is an input to ask for, never a test');
    expect(CORE_REPLY_INSTRUCTION).toContain('Never close on a general caution');
    expect(CORE_DRAFTING_GUIDANCE).toContain("An item is the person's or a party's only when their words state that very item");
    expect(CORE_DRAFTING_GUIDANCE).toContain('estimate_by olumi is only for a missing figure on an item their words do state');
    // A risk held for want of the goal's window (risk_window_not_goal_window) is said once, and the deadline becomes the one question.
    expect(CORE_REPLY_INSTRUCTION).toContain('When a risk is held as risk_window_not_goal_window, say once that this risk is not in the calculation yet');
    // Never promise a deadline unlocks it: on core no window is written, so only their own estimate brings it in (Track 2 step 0).
    expect(CORE_REPLY_INSTRUCTION).not.toContain('until they say by when');
  });

  it('first-model guidance preserves material causal paths before figures, without item-count quotas (DL lease, 22 Oct)', () => {
    // Static text contract only; Track 3 measures the resulting models on the served candidate.
    expect(createHash('sha256').update(CORE_DRAFTING_GUIDANCE, 'utf8').digest('hex')).toBe('2fda3ede8113a368d39a07633a2a6b2c26757b51424b629728c1a4c277a78c18'); // 22 Oct: + at most one link per pair, each way its own path through its real factor, outcome or risk (Q2-06; Codex r1 #3642; was 15c95d1a…)
    // Track 3 c6 Q2 fm3 (22 Oct): an option's outlay that no aim measures was drafted as a factor reaching nothing.
    expect(CORE_DRAFTING_GUIDANCE).toContain('A factor that reaches no aim, carries no limit and defines nothing is decorative');
    expect(CORE_DRAFTING_GUIDANCE).toContain('the reply says it is left out and asks whether it should count, as a limit or within the aim');
    // Q2-06 (22 Oct, 7b0af1a9): two links between the same two items, one per way it moved the other; the engine holds one.
    expect(CORE_DRAFTING_GUIDANCE).toContain('Two items have at most one link between them: when one item moves another in two ways, each way is its own path through its real factor, outcome or risk');
    expect(CORE_DRAFTING_GUIDANCE).toContain('every material causal path the person states or proposes, including each intermediate effect and distinct outcome');
    expect(CORE_DRAFTING_GUIDANCE).toContain('complete paths and distinct outcomes before adding figures');
    expect(CORE_DRAFTING_GUIDANCE).toContain('a missing figure never justifies replacing a material mechanism with a proxy result or a caveat');
    for (const quota of ['5 to 8 items', '8 to 14', 'up to about 16']) expect(CORE_DRAFTING_GUIDANCE).not.toContain(quota);
    // The complete-estimate and human-target rules remain: no return to blank Olumi items.
    expect(CORE_DRAFTING_GUIDANCE).toContain("Then complete Olumi's own items with labelled provisional estimates");
    expect(b).toContain("Each item Olumi adds is complete and visibly Olumi's");
    expect(b).toContain("never set the goal's target figure (ask for it)");
  });

  it('the builder\u2019s effort arm is set only on a core turn that asks for it; the default is the banked medium (A/B/C 22 Oct)', () => {
    expect(coreEffortArmOf('core', 'medium')).toBe('medium');
    expect(coreEffortArmOf('core', 'low')).toBe('low');
    expect(coreEffortArmOf('core', 'high')).toBe('high');
    for (const header of [undefined, 'High', 'Medium', ['medium']]) expect(coreEffortArmOf('core', header)).toBeUndefined();
    expect(coreEffortArmOf('full', 'high')).toBeUndefined();
    expect(coreBudget().reasoning_effort).toBe('medium');
    expect(coreBudget('medium')).toEqual({ ...coreBudget(), reasoning_effort: 'medium' });
  });
});
