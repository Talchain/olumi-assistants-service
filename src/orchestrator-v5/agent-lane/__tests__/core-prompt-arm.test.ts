import { describe, expect, it } from 'vitest';
import { CORE_ALIGNED_INSTRUCTIONS, CORE_REPLY_INSTRUCTION, NOTE_ON_ITEM_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION, instructionsForMode, MODEL_RELATIVE_NAMING_INSTRUCTION,
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
    // 7b6145d4… until 21 Oct; arm C's adoption changed only the closing core reply rule (see its row), then 56625e00…. NO WIN
    // SHARE (Paul 21 Oct): the host's permitted-share sentence removed only: 26,484 → 26,263 bytes (−221), base sha reproduced.
    expect(createHash('sha256').update(b.replace(`${NOTE_ON_ITEM_INSTRUCTION}\n\n`, ''), 'utf8').digest('hex')).toBe('3327f79dceedc89f945de463e8bf48a613bb1117315fe13cded3bd474f0e2599');
  });

  it('arm A is untouched except the NO WIN SHARE removal (Paul 21 Oct): the legacy host contract less its permitted-share sentence', () => {
    expect(createHash('sha256').update(HOST_TOOL_CONTRACT, 'utf8').digest('hex')).toBe('e76fbc212841006beec0210858fece6df6a14b0d76e9bf960e63533013850576');
  });

  it('canvas coaching: every core call carries the note_on_item sentence once, on both arms; no other mode gets it', () => {
    for (const arm of [CORE_ALIGNED_INSTRUCTIONS, 'legacy arm A text']) {
      const sent = instructionsForMode('core', arm);
      expect(sent.split(NOTE_ON_ITEM_INSTRUCTION)).toHaveLength(2);
      expect(sent.endsWith(CORE_REPLY_INSTRUCTION)).toBe(true);
    }
    expect(instructionsForMode('full', 'legacy arm A text')).not.toContain('note_on_item');
  });

  it('the arm is B only on a core turn that asks for it; every other turn keeps the default', () => {
    expect(promptArmOf('core', 'B')).toBe('B');
    // Arm C was adopted as the core reply rule (21 Oct), so its header no longer selects anything.
    for (const header of [undefined, 'A', 'C', 'b', 'c', ['B'], ['C']]) expect(promptArmOf('core', header)).toBe('A');
    expect(promptArmOf('full', 'B')).toBe('A');
  });

  it('arm C ADOPTED (Paul 21 Oct, long replies narrating the tools; R2 100 % at 90 words median): the core reply rule speaks in the user\u2019s terms with a length bound', () => {
    expect(CORE_REPLY_INSTRUCTION).not.toContain('from this turn\u2019s tool results');
    expect(CORE_REPLY_INSTRUCTION).toContain('never your tools or what a tool response did or did not contain');
    expect(CORE_REPLY_INSTRUCTION).toContain('usually under 100 words');
    // The licences, attribution and Run-coaching rules are kept.
    for (const rule of ['never call a win share a chance', 'never call an option best, a winner or recommended',
      'approving a reading adopts it but does not make the user its author', 'A Run that did not complete leaves a saved change saved'])
      expect(CORE_REPLY_INSTRUCTION, rule).toContain(rule);
    const sent = instructionsForMode('core', 'legacy arm A text');
    expect(sent.endsWith(CORE_REPLY_INSTRUCTION)).toBe(true);
    expect(sent.split(NOTE_ON_ITEM_INSTRUCTION)).toHaveLength(2);
    expect(instructionsForMode('full', 'legacy arm A text')).toBe('legacy arm A text');
  });

  it('the builder\u2019s effort arm is lowered only on a core turn that asks for it; the default stays the banked high', () => {
    expect(coreEffortArmOf('core', 'medium')).toBe('medium');
    expect(coreEffortArmOf('core', 'low')).toBe('low');
    for (const header of [undefined, 'high', 'Medium', ['medium']]) expect(coreEffortArmOf('core', header)).toBeUndefined();
    expect(coreEffortArmOf('full', 'medium')).toBeUndefined();
    expect(coreBudget().reasoning_effort).toBe('high');
    expect(coreBudget('medium')).toEqual({ ...coreBudget(), reasoning_effort: 'medium' });
  });
});
