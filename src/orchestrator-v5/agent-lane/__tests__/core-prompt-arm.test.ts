import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CORE_ALIGNED_INSTRUCTIONS, CORE_NEXT_STEP, CORE_REPLY_INSTRUCTION, NOTE_ON_ITEM_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION, instructionsForMode, MODEL_RELATIVE_NAMING_INSTRUCTION,
  promptArmOf, coreEffortArmOf } from '../../../routes/agent-v1-turn.js';
import { coreBudget } from '../model-budgets.js';
import { OLUMI_PURPOSE_INSTRUCTION } from '../olumi-purpose.js';
import { HOST_SCIENCE_AND_SOURCE_RULES, HOST_TOOL_CONTRACT } from '../coach-route-v0_2.js';
import { createHash } from 'node:crypto';

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
    expect(createHash('sha256').update(b.replace(`${NOTE_ON_ITEM_INSTRUCTION}\n\n`, ''), 'utf8').digest('hex')).toBe('6dedb15310f121c6e73b8d138c559b300bdb84d05aae5cca5c06e5bcd70107e8'); // 21 Oct: + Olumi's labelled estimate on another's item (estimate_by); + CORE_NEXT_STEP decisive question (Track 3 Q2 v2 + buddy AMEND, 21 Oct; was a605c43f…)
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
