import { describe, expect, it } from 'vitest';
import { CORE_ALIGNED_INSTRUCTIONS, CORE_REPLY_RULES, NOTE_ON_ITEM_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION, instructionsForMode, MODEL_RELATIVE_NAMING_INSTRUCTION,
  promptArmOf, coreEffortArmOf } from '../../../routes/agent-v1-turn.js';
import { coreBudget } from '../model-budgets.js';
import { OLUMI_PURPOSE_INSTRUCTION } from '../olumi-purpose.js';
import { HOST_SCIENCE_AND_SOURCE_RULES, HOST_TOOL_CONTRACT } from '../coach-route-v0_2.js';
import { createHash } from 'node:crypto';
import * as drafting from '../../path-b/drafting-guidance.js';
import * as coreInstructions from '../../core-route/instructions.js';
import { CANONICAL_JSON_SCHEMA, DRAFTING_INSTRUCTIONS, UPDATE_PREFIX } from '../../model-program-turn/prompt.js';
import * as programDraft from '../../model-program-turn/draft.js';
import { PROGRAM_TURN_GUIDANCE } from '../../model-program-turn/program-tools.js';

const { CORE_DRAFTER_RULES } = drafting;

/** Tools the core agent does not have, named by the legacy routing arm B removes (AIE #3523 6298433275). */
const LEGACY_TOOLS = ['propose_starting_point', 'propose_assumptions', 'authorise_change', 'get_canonical_state', 'propose_link_effect',
  'propose_model_change', 'propose_option_interventions', 'propose_hiring_times'];
const CORE_TOOLS = ['read_canonical_context', 'build_model_from_brief', 'propose_change', 'apply_change', 'run_analysis'];
const count = (text: string, part: string): number => text.split(part).length - 1;

describe('prompt arm B (programme-docs #94 6302769609): the core agent is told only about the tools it has', () => {
  const b = instructionsForMode('core', CORE_ALIGNED_INSTRUCTIONS);

  it('ALPHA (DL 93d79c3e, 23 Oct): names no legacy tool and no drafting or edit tool (each tool\u2019s own description says how), and keeps the card-approval rule', () => {
    for (const t of LEGACY_TOOLS) expect(b, t).not.toContain(t);
    for (const t of CORE_TOOLS) expect(b, t).not.toContain(t);
    expect(b).toContain("Do not treat a typed yes or your own interpretation as the card's approval.");
    expect(b).not.toContain('{{MODE_AND_AUTHORITY}}');
  });

  it('ALPHA: the model-program prompt, each section once, the purpose once and the reply rules last; the coach template and the Living Model host rules are gone', () => {
    for (const h of ['HOW THE MODEL WORKS', 'FIRST MODEL', 'ANSWERS AND CHANGES', 'RESULTS', 'CALCULATION BOUNDARY', 'WHEN NOTHING CAN BE CALCULATED YET', 'WORDS',
      'EXAMPLE (a first model; synthetic)']) expect(count(b, `\n\n${h}\n`), h).toBe(1);
    for (const part of [OLUMI_PURPOSE_INSTRUCTION, CORE_REPLY_RULES]) expect(count(b, part)).toBe(1);
    expect(b.endsWith(CORE_REPLY_RULES)).toBe(true);
    for (const gone of [HOST_SCIENCE_AND_SOURCE_RULES, GOAL_CHANCE_RANKING_INSTRUCTION, MODEL_RELATIVE_NAMING_INSTRUCTION, '\nTRUTH\n', '\nREASONING\n',
      'POLYMATH COACHING', 'saved_run_options', 'goal_chance_licence', 'decision_sensitivity', 'run_facts']) expect(b, gone.slice(0, 60)).not.toContain(gone);
    // Under half the 29,512 characters it replaces (staging 646d374e).
    expect(b.length).toBeLessThan(29_512 / 2);
  });

  it('the sent core instructions, byte for byte, plus the canvas-coaching sentence once (the route row in core-turn.route.test.ts pins the same bytes as the SDK receives them)', () => {
    expect(b.split(NOTE_ON_ITEM_INSTRUCTION)).toHaveLength(2);
    // 23 Oct (ALPHA): the model-program prompt replaces arm B's assembled reference (055841368f…, 29,512 characters sent).
    expect(createHash('sha256').update(b, 'utf8').digest('hex')).toBe('fee42c2fbd8f73fa578992b049157ad90b0d7d876795d4d83e9fe0afdb42cb21'); // 24 Oct: issue 30, synthetic examples only; before it, remodel coaching (after 23 Oct P1/P4: at most three questions, each once, never what their words state).
    // Candidate-3 witness kept (21 Oct): WHEN to build. Text only, not behaviour.
    expect(b).toContain('draft the first model from their brief in that same turn, even when figures are missing');
  });

  it('arm A is untouched: the legacy host contract is byte-identical to staging b76bc42c', () => {
    expect(createHash('sha256').update(HOST_TOOL_CONTRACT, 'utf8').digest('hex')).toBe('a118a398d9e214017df46195c40ece2105d70d8343577ed14521b10736edf64d');
  });

  it('canvas coaching: every core call carries the note_on_item sentence once, on both arms; no other mode gets it', () => {
    for (const arm of [CORE_ALIGNED_INSTRUCTIONS, 'legacy arm A text']) {
      const sent = instructionsForMode('core', arm);
      expect(sent.split(NOTE_ON_ITEM_INSTRUCTION)).toHaveLength(2);
      expect(sent.endsWith(CORE_REPLY_RULES)).toBe(true);
    }
    expect(instructionsForMode('full', 'legacy arm A text')).not.toContain('note_on_item');
  });

  it('every core turn takes arm B, whatever the header; every other mode keeps arm A', () => {
    // Buddy SIMPLER on #3571 (21 Oct): arm B, which names only the tools core has, is every core turn's authority; no header
    // selects anything. Every other mode keeps arm A.
    for (const header of [undefined, 'A', 'B', 'C', 'b', ['B']]) expect(promptArmOf('core', header)).toBe('B');
    expect(promptArmOf('full', 'B')).toBe('A');
  });

  it('THE PROMPTS (DL 22 Oct, priority change): the coach\u2019s reply rules and the drafter\u2019s rules, adapted as ruled; the old constants are gone', () => {
    expect(createHash('sha256').update(CORE_REPLY_RULES, 'utf8').digest('hex')).toBe('9607f2b0d95df9e7be7e040c975cd13a12ba7f60120d39c8c5fab6d2016d87dc'); // 23 Oct (ALPHA): the reply rules for the model program; P1: at most three questions a reply, each once.
    // The model-program drafter's text (23 Oct, P1–P5: three questions at most, every option reaches
    // every measured goal, a deadline is its goal's window, options named in full). Prompt text changes only with this pin.
    // 24 Oct (DL, combined measure + funding dead end + science rulings r3-r5): their fact asked; a link Olumi's estimate by
    // default, a direction-only one kept in words with its size unknown; never a forced number; quotes copied exactly; the
    // update's own text lives here with the draft's goal rule; periods counted as starts_after_periods (#3713).
    // 24 Oct (AIE 6386018855 §5, accepted by the DL): Olumi may propose a measure, options and missing drivers, at first drafting only.
    // 24 Oct (AIE 6386895900 + Codex BLOCK on #3735): structural zero narrowed, relevant-goal links only, measure only where it
    // meaningfully tracks the aim, and the example's exclusion marked Olumi's.
    expect(createHash('sha256').update(DRAFTING_INSTRUCTIONS, 'utf8').digest('hex')).toBe('15dce79dab24e0bd5bc72a87fa39cb2a896335822f355d24e1d97821f4c423ef');
    expect(createHash('sha256').update(UPDATE_PREFIX, 'utf8').digest('hex')).toBe('37d6c47d47731c62b48bec586b33803d10d1b14760d9590f610b7741c966491a');
    expect(createHash('sha256').update(CORE_DRAFTER_RULES, 'utf8').digest('hex')).toBe('bed04fc58a01dbd02d8f5c8aa6ef171731a356c1cde47a85e0cd64be35416653'); // 23 Oct (DL 93d79c3e, C2 double prime): a definition's parts are factors with levels, never another definition; a STATED per-unit effect is a sized link. 22 Oct: every stated goal saved in their words, never approximated (Claude r1 on #3670); + a calendar date is Olumi's labelled reading
    // The retired constants are gone from both modules: no route can send the accreted text again.
    for (const name of ['CORE_REPLY_INSTRUCTION', 'CORE_RESPONSE_DISCIPLINE', 'CORE_NEXT_STEP']) expect(Object.keys(coreInstructions), name).not.toContain(name);
    expect(Object.keys(drafting)).toEqual(['CORE_DRAFTER_RULES']);
    for (const old of ['<RESPONSE_DISCIPLINE>', 'DRAFTING THE FIRST MODEL', 'goal_margins', 'risk_window_not_goal_window', 'COACHING SHAPE'])
      expect(`${b}${CORE_DRAFTER_RULES}`, old).not.toContain(old);
    // The candidates' output lines and the benchmark override do not go in (DL): the agent replies natively, with its tools.
    // Codex r1 / buddy on #3656: no sentence against Olumi's labelled estimates, and a supported goal chance may lead the headline.
    for (const line of ['Return only', 'NO INVENTED FIGURES', 'this sprint', 'never invent a number, range, threshold',
      'Only use numbers the supplied result actually computed', 'without raw numbers'])
      expect(`${CORE_REPLY_RULES}${CORE_DRAFTER_RULES}`, line).not.toContain(line);
    // ALPHA (the brief's five behaviours), each said once in what is sent.
    for (const rule of [
      // 1. after a draft: what Olumi understood, then only the blocking questions, grouped, the most consequential first, never re-asked
      "1. What Olumi understood, in two to four short lines: the question, the goals and limits, the options and the main figures. Keep their figures in their words, say which figures are Olumi's starting estimates, and say what was left out of the calculation and why.",
      '2. Only the questions that block a goal or a limit, at most three, as one numbered list they can answer in one reply: the one that unblocks the most first, each asking one thing, with a few words on why it matters.',
      'If a question asks for something their words already state or answer, do not ask it: put it in with the edit tools, quoting them, and say so.',
      'Ask at most three questions in a reply, each once, the blocking ones first;',
      // 2. a chance as the code words it, what it rests on, the limit lines, and ONE next step
      'report each option\u2019s chance as the result words it: the figure, the goal, target and horizon it answers, and what it rests on, "on your figures" or "if" with Olumi\'s assumptions (name them briefly; never drop the "if" or turn it into a forecast).',
      'Never work out, round, combine or rank a chance yourself.',
      'Then give ONE next step: replace an Olumi estimate the chance rests on with their own figure, find the input a threshold names, or test the assumption the result rests on. Call an input the one that matters most only when the result measured that.',
      // 3. edits in chat, never a figure invented for them; a loose figure is theirs with Olumi's labelled range
      'never invent a figure for them, and never change the model because of discussion alone.',
      // Codex r1 BLOCK on #3707: never a range Olumi invents around their loose figure; ask for theirs.
      'A loose figure ("about 35") goes in exactly as they said it: their figure, 35, with their words quoted so the "about" stays visible. Never add a range or bounds they did not give. If that figure feeds a goal or a limit, ask what range they would put on it.',
      'A what-if question is not a change: answer from the current result, and offer to change the figure if they want it worked out.',
      'Run a new calculation only when they ask for one; a saved change may already bring its result: use that.',
      // 4. nothing calculable: what is missing in one sentence, and a science-grounded activity
      'say what is missing in one sentence. Unless it waits only on questions you have just asked, offer one science-grounded activity that helps meanwhile: a pre-mortem (imagine it has failed and list why), a reference-class check (how similar efforts usually turn out), or naming the evidence that would change their mind.',
      // the product rules: never a recommendation; the most likely option only where the result names one
      'Never recommend or choose an option for the user, and never call one "best", the "winner" or the one to "go with".',
      'Name an option as the most likely to meet the goal only when the result itself names one, as a finding in this model, never as what they should choose;',
    ]) expect(count(b, rule), rule.slice(0, 60)).toBe(1);
    // Kept from the old reply rule, each once: what the reply must report of saves and approvals, and the AIE's scope rule (K3).
    for (const kept of ['In this mode Olumi adds nothing to your reply and rewrites none of it: the user reads exactly your words.',
      'never your tools or what a tool returned', 'approving an estimate adopts it but does not make them its author',
      'A calculation that fails after a save leaves the change saved: say both.', "Keep a clearly separate situation out of the current scenario's Living Model.",
      'do not claim it was created or put its facts into this model instead'])
      expect(b.split(kept), kept).toHaveLength(2);
    // Gone with the Living Model Run path: its disclosures, comparison note and apply-then-Run reporting.
    for (const gone of ['Keep every must_say disclosure', 'Where run_comparison is given', 'Illustrative calculation', 'Lead with one plain-language headline'])
      expect(b, gone).not.toContain(gone);
  });

  it('ALPHA (S3 contract as emitted at 2b419138, DL-3.md 15:0xZ): the program tools\u2019 descriptions, which S3 imports: results only in the Run\u2019s recorded words at their actual paths, per option, per goal and joint; every edit op described', () => {
    const { PROGRAM_TOOL_DESCRIPTIONS: d } = coreInstructions;
    expect(Object.keys(d)).toEqual(['read_canonical_context', 'propose_change', 'apply_change', 'run_analysis']);
    // Spelled out, not imported: the PL's per-goal + joint permission at the emitted paths, and never a figure of the agent's own.
    const words = 'Report results only in the Run\u2019s recorded words: each option\u2019s words (run.options[].words; where shown is false, they say why no chance is shown); '
      + 'each goal\u2019s own words with each option\u2019s display for it (run.goal_chance.targets.per_target[].words and its options[].display); '
      + 'for meeting every goal together, run.goal_chance.targets.joint.words, or its line saying why that waits (run.goal_chance.targets.joint.line); '
      + 'and run.goal_chance.notes, thresholds[].words, limits[].words with each option\u2019s display, and unchecked_limits[].words. '
      + 'Quote them; never a figure, chance, rounding, combination or ranking of your own.';
    // The run block as S3 emits it: { run_id, options[{ option_id, shown, words }], goal_chance: the Run's own block }.
    const PATHS = ['run.options[].words', 'run.goal_chance.targets.per_target[].words', 'run.goal_chance.targets.joint.words',
      'run.goal_chance.targets.joint.line', 'run.goal_chance.notes, thresholds[].words, limits[].words with', 'and unchecked_limits[].words'];
    for (const [name, text] of Object.entries(d)) {
      expect(text.split(words), name).toHaveLength(2);
      for (const path of PATHS) expect(count(text, path), `${name}: ${path}`).toBe(1);
      // The paths S3 no longer emits (14:2xZ): no description names them.
      for (const gone of ['run.targets', 'run.notes', 'run.thresholds', 'run.limits', 'run.unchecked_limits']) expect(text, `${name}: ${gone}`).not.toContain(gone);
      for (const banned of ['recommend', 'best', 'winner', 'you should', '18 to 22']) expect(text.toLowerCase(), `${name}: ${banned}`).not.toContain(banned);
    }
    // read_canonical_context returns model (as authored), earlier_versions, open_questions, coaching and run.
    for (const field of ['its revision; model, the canonical model exactly as authored (', 'earlier_versions, how many earlier versions it has;',
      // S1 (A4): what the Run waits on is typed; the AI asks in its own words, and each code says what the person supplies.
      'blockers, what the stored Run waits on, in the model\'s order, each with its id, code and scope (what it holds up). No question is written for you:',
      'asked, the figure', 'range_kind, whether the ends of their range are firm or a rough estimate;', 'recount, the count again',
      'unknown, a figure no one can give or responsibly estimate yet: say why (its basis) and what evidence, question or activity would size it; never ask them for the number;',
      'measure, how the aim or guardrail is measured;', 'deadline, by when;', 'no_goal, the result they want.',
      'and run, the stored Run, with current and engine_current.']) expect(d.read_canonical_context, field).toContain(field);
    // Targeted answers (DL 24 Oct): an answer in answers on its item's id; anything else in words, with the ids to remove, which
    // Olumi's drafter writes; no op set.
    for (const gone of ['set_quantity', 'set_range_kind', 'set_goal_target', 'add_option', 'rename_option', 'define_goal_measure', 'ops']) expect(d.propose_change, gone).not.toMatch(new RegExp(`\\b${gone}\\b`));
    expect(d.propose_change).toContain('An answer to a listed question (a blocker, or an asked item\'s question) goes in answers, on that existing item\'s id from read_canonical_context, saying whose it is: '
      + 'author person, status known, with their figure and their exact words this turn as quote;');
    expect(d.propose_change).toContain('author olumi, status estimated, for Olumi\'s estimate of a size, with low, high, range_kind and basis and no quote.');
    expect(d.propose_change).toContain('A range gives range_kind bounds or plausible only when their words say firm or rough, null otherwise;');
    expect(d.propose_change).toContain('Anything else (a new item or link, a rename, a removal) goes in request, in plain words with their exact words for every figure of theirs, with remove the ids of anything they asked to remove ([] for none); Olumi\u2019s drafter writes it.');
    expect(d.propose_change).toContain('The card shows every change, before and after.');
    expect(d.propose_change).toContain('The result shows what the card would show (would_show).');
    expect(d.apply_change).toContain('The approval is the card\u2019s, never a typed yes.');
    expect(d.apply_change).toContain('saved: the receipt, the new revision and run, the Run. already_saved: this same proposal was saved before; never save it again.');
    expect(d.run_analysis).toContain('Show the Run of the saved model as run: the stored Run when it is current for this model (stored true), otherwise a new Run, worked out and stored (stored false).');
    expect(d.run_analysis).toContain('Use it only when the person asks; a saved change already brings its Run.');
    // The descriptions ride the tool list, not the standing instructions (whose sent bytes the sha row above pins).
    expect(b).not.toContain(words);
  });

  it('the model-program drafter (DL 24 Oct): only their facts wait, link sizes stay Olumi\u2019s estimates, quotes are copied exactly, and an update links a changed setting only to the goals or limits it affects', () => {
    for (const rule of [
      'its quote is their words copied exactly, one unbroken stretch, never reworded or joined.',
      'what they know or decide: current levels, prices, costs, budgets and how they split them, headcount, dates, durations, targets.',
      'Never ask them for a link\'s size or an option\'s effect.',
      // DL 24 Oct (blind score of 1510a008, mrr structure): an identity is a definition; a missing figure is asked on its item.
      // AIE 6386895900 §2: an option links only to the goals and limits it supportably affects, never to every goal.
      'Mechanism: Represent the supported effects of each option on the relevant goals and limits; never add a causal link merely to connect an option to every goal. Preserve a genuinely absent effect and keep an unresolved relationship explicit. A quantity that is by definition a product or sum of others is a definition, never an effect; each other link is sized by their coefficient or Olumi\'s estimate.',
      // AIE 6386018855 §5 (DL 24 Oct): the capture-only clauses replaced, each permission once, attributed and grounded.
      'Olumi\'s own additions (a suggested measure, options, drivers, risks) are made when the model is first drafted; a repair or an update changes only what it asks.',
      'Check the main plausible benefit and countereffect of each option; include only mechanisms with a defensible rationale, keeping unresolved ones explicit.',
      'Every driver, constraint and current state they mention feeds the calculation or the record that fits it.',
      'Where the brief leaves out a driver, countereffect or risk that is plausible and could change the result, add it as Olumi\'s hypothesis (author olumi, with a basis and its direction); plausibility alone never justifies a figure, so size it like any other link.',
      // AIE 6386895900 §3: a measure only where it meaningfully tracks the aim; null and a question where readings differ.
      'An aim they state without a measure stays theirs; a suggested measure (measure_by "olumi": "more regulars" as repeat customers a week) is never their definition of success.',
      'Suggest a measure only where it meaningfully tracks the stated aim; do not substitute an activity count merely because it is measurable. Mark the measure as Olumi\'s, record its rationale in a linked assumption and what it misses in exclusions. If materially different interpretations would change the model, keep measure null and use its question to offer the plausible interpretations and clarify the intended meaning. Never infer an unstated target.',
      'An aim no measure can responsibly track, and a guardrail without one, keep measure null and a question.',
      'Where they named none, or the question is how to divide something (money, staff, hours), propose a small set of feasible, distinct options of Olumi\'s (author olumi, short plain names; a proposed division is a design, not a fact about today) within their stated budgets, exclusions and scope,',
      'left_out holds only what matters to the result but cannot be calculated, with the reason;',
      // AMEND (DL 24 Oct, blind score of #3735): a lever only the options set, and a whole, are structure; a stated limit stays a limit.
      // AIE 6386895900 §1 (with buddy 6386822278): structural zero only for an off/on control or a none-added increment.
      'Zero is structural only for a genuine off/on control or an explicitly incremental quantity meaning none added; never for a missing real-world starting level, share or stock. An exact whole such as 100 % is structural as a unit or whole identity, never as an invented success target.',
      'what another record can hold goes there: a condition the plan must not break → limits, a statement about the situation → claims,',
      // DL 24 Oct: the one worked example shows the proposing half once (an aim with no measure, Olumi's suggested measure).
      'goal "to grow the bakery", measure_by olumi (a suggested measure): sales change_abs from now >= grow_target, end, window null,',
      // Codex BLOCK on #3735: the exclusion is Olumi's reading, marked as canonical.ts attribution requires.
      'exclusions: left_out "growth beyond loaf sales, such as new lines", why "not in this model", author olumi, quote null',
      'the reply asks at most three, and every other missing fact stays asked on its item.',
      // DL 24 Oct (P7 hiring blind score, classes 2 and 4): a stated threshold is theirs; a goal against today is relative to today.
      'Every figure a goal or limit rests on stays in, and a threshold they state is theirs, never Olumi\'s unknown ("no worse" is today\'s level).',
      // Buddy 24 Oct 08:48Z (accepted): the frame follows their words, as canonical.ts GOAL_FRAMES and compile.lowerChange do.
      'A goal\'s frame follows their words: a change stated as a percentage or share ("8 % more") is change_rel from now, and where they give no figure for today, today is 1, carrying on keeps it there (an assumption) and each effect is a proportional change, so today\'s level is not asked;',
      'a change stated in units ("12 more parcels a day than now") is change_abs in those units; a target stated as a level stays a level.',
      'A level the result does need is their fact, asked as a recent measured figure ("last month\'s"), saying how they could measure it.',
      // DL 24 Oct (milestone blind score, effects-not-estimated): a range is defensible when its order of magnitude is knowable.
      'A link or effect (an option\'s added effect included) is theirs or, by default, Olumi\'s provisional estimate with a defensible range in natural units and a plain basis.',
      // Buddy 24 Oct 08:17Z (accepted): capacity is not output.
      'A range is defensible when general knowledge of how such things work gives its order of magnitude, however wide the span (a second matched, staffed van roughly doubles available vehicle capacity, give or take; completed deliveries also depend on demand and other bottlenecks).',
      // DL 24 Oct (with S3's issue 39): an unsized link's direction goes in direction; one with no direction anyone can give is a note.
      'Only an effect with no knowable scale keeps its size unknown, its direction in direction (raises or lowers) and what would size it in its basis; an effect whose direction no one can say is a note, not a link. Never force a number to get a chance.',
      'A stock\'s level after n periods is its start plus n periods of its flows.',
      'sets ovens_added to one_oven, starts_after_periods 0;',
    ]) expect(count(DRAFTING_INSTRUCTIONS, rule), rule).toBe(1);
    // What over-applied the estimate rule, and the old period numbering, are gone.
    for (const old of ['never invent a measure', 'its direction in words', 'Important but uncalculable', 'from what the brief names', 'goes in left_out with the reason', 'a link you cannot size goes in left_out', 'Every other figure it needs stays null', 'Only coefficients are Olumi', 'never "unknown" with no question', 'flows of periods 1 to n', 'from period 0'])
      expect(DRAFTING_INSTRUCTIONS, old).not.toContain(old);
    // The update's text is prompt text: here, once, with the draft's goal rule and the quote rule; draft.ts no longer holds a copy.
    for (const rule of ['return the WHOLE model, by the same rules.',
      // AIE 6386895900 §2: an update connects a changed setting only where it genuinely acts.
      'Preserve supported paths; connect a new or changed setting only to the goals or limits it genuinely affects. Do not change unrelated links to complete a path.',
      'A figure of theirs quotes their words copied exactly, never reworded or joined;',
      // DL 24 Oct (class 12): an answer is entered on the item it answers; a figure read from words says so in its basis.
      'Each answer goes on the item whose question it answers (a question about one option, on that option\'s item);',
      'words that settle a figure (yes, no, all, none) are that figure, quoting them, its basis saying how they were read.',
      'Never keep an answer unassigned and ask it again.',
      // DL 24 Oct (class 12 remainder): "I don't know" is an answer; the item stays open with a new question.
      '"I don\'t know" is an answer too: the item stays open, its question changed to ask for what would size it.']) expect(count(UPDATE_PREFIX, rule), rule).toBe(1);
    // The program turn's guidance is prompt text: answers in order answer the questions in order, and none is asked again in the same words.
    // Targeted answers (DL 24 Oct): an answer goes in answers on its item's id, anything else in request (pinned as sent in core-turn.route).
    expect(createHash('sha256').update(PROGRAM_TURN_GUIDANCE, 'utf8').digest('hex')).toBe('4ccd4a5913bfb242ca4f771b3349ed8a2872b6fc18b7632b8d38c15c92448542');
    expect(count(PROGRAM_TURN_GUIDANCE, 'Answers in the order of your questions answer them in that order, and "I don\'t know" is an answer: put each on the item of the question it answers, and never ask one again in the same words.')).toBe(1);
    expect(count(PROGRAM_TURN_GUIDANCE, 'call propose_change ONCE: an answer to a listed question goes in answers, on that item\'s id; any other change goes in request,')).toBe(1);
    for (const old of ['If only its direction can be defended', 'uncertainty alone is not a reason to withhold', 'what they expect without the options included', 'roughly doubles daily deliveries',
      'A goal or limit stated against today is relative to today']) expect(DRAFTING_INSTRUCTIONS, old).not.toContain(old);
    // Buddy 08:48Z: a level target and a change in units are never turned into a ratio. Only the change_rel clause sets today
    // to 1 or makes effects proportional; the change_abs and level clauses carry neither.
    const frames = DRAFTING_INSTRUCTIONS.slice(DRAFTING_INSTRUCTIONS.indexOf('A goal\'s frame follows their words:'));
    const [relClause, absClause, levelClause] = frames.slice(0, frames.indexOf(' A level the result does need')).split('; ');
    expect(relClause).toContain('is change_rel from now'); expect(relClause).toContain('today is 1'); expect(relClause).toContain('each effect is a proportional change');
    expect(absClause).toContain('is change_abs in those units'); expect(levelClause).toBe('a target stated as a level stays a level.');
    for (const clause of [absClause, levelClause]) for (const ratio of ['today is 1', 'proportional', 'change_rel', 'relative to today']) expect(clause, ratio).not.toContain(ratio);
    expect(count(DRAFTING_INSTRUCTIONS, 'today is 1')).toBe(1);
    expect(Object.keys(programDraft)).not.toContain('UPDATE_PREFIX');
    // The schema is prompt text too (sent on every drafting call): `unknown` only where nothing rests on it (served funding dead end).
    const sentSchema = JSON.stringify(CANONICAL_JSON_SCHEMA);
    expect(count(sentSchema, 'unknown: it matters, but no defensible range can be given yet (at most its direction, in direction): every figure null; basis says why and what would size it.')).toBe(1);
    // Issue 39 (DL 24 Oct): an unsized link's direction has its own field, said once as sent.
    expect(count(sentSchema, 'For a link\'s size (a coefficient), used only when no figure is given (no most likely figure, and no range or one that spans zero): raises when more of the driver means more of what it moves, lowers when it means less; null when no one can say which. Null for every other quantity.')).toBe(1);
    // Neither the old open-ended text nor a rule that forces an estimate (buddy science BLOCK, 24 Oct) is sent.
    // Nor an open-ended unknown, a rule that forces an estimate, or one that makes unknown a link's default (1510a008: 50 links unknown).
    // r5 (buddy, accepted): never numerical bounds demanded where only a direction is defensible (r4's "order of magnitude").
    // AIE §5: the schema says the same as the prompt: a suggested measure where one can track the aim; Olumi's options where structure is missing.
    for (const rule of ['Olumi suggests one instead (measure_by olumi) only where it meaningfully tracks the stated aim, never an activity count merely because it is measurable; it stays null when materially different interpretations would change the model.', 'the measure is a suggestion, never their definition of success;',
      'each with its own measure (theirs, Olumi\'s suggestion, or null with a question), target and window. Never an aim they did not state.',
      'and, where they named none or the question is how to divide something, a small set of Olumi\'s own (author olumi) within their stated budgets and scope.'])
      expect(count(sentSchema, rule), rule).toBe(1);
    for (const old of ['Never invent a measure', 'An aim with no measure is valid; never invent one']) expect(sentSchema, old).not.toContain(old);
    for (const old of ['nobody can give or responsibly estimate it yet', 'is never unknown', 'basis says why. ', 'whenever one is supportable', 'order of magnitude']) expect(sentSchema, old).not.toContain(old);
    for (const old of ['when one is supportable, else', 'not even its direction or order of magnitude', 'a wide range is supportable', 'At most three questions asked now']) expect(DRAFTING_INSTRUCTIONS, old).not.toContain(old);
  });

  it('the drafter saves every stated goal in their words and never approximates it, with the rule present once', () => {
    const rule = "Save every goal the person states, in their words: keep what fits the schema, and leave the rest null (or use = or a range, which Olumi asks about). Never approximate a comparator, figure or window, and never leave a stated goal unsaved.";
    expect(CORE_DRAFTER_RULES.split(rule)).toHaveLength(2);
  });

  it('the figure rule (Paul\u2019s 21 Oct served test; DL ruling 22 Oct) is said once, verbatim, in the drafter\u2019s rules, and the drafter keeps no rule against it', () => {
    const rule = "Build a model the analysis can run on. Each item Olumi adds is complete and visibly Olumi's (source olumi, quote null)";
    expect(CORE_DRAFTER_RULES.split(rule)).toHaveLength(2);
    expect(b, 'not repeated in the agent instructions').not.toContain(rule);
    for (const part of ["give Olumi's provisional estimate of it with estimate_by olumi, as wide as what is genuinely unknown; never change or mix with a figure they gave, and never set the goal's target figure (ask for it)",
      "In the reply, say that the figures marked as Olumi's are starting estimates for them to correct.", 'with unstated figures following the estimate rule',
      'no parallel links, duplicates, unlabelled figures, or a figure attributed to the wrong author.'])
      expect(CORE_DRAFTER_RULES, part).toContain(part);
    expect(CORE_DRAFTER_RULES).not.toContain('all unstated figures null');
    expect(CORE_DRAFTER_RULES).not.toContain('estimate_by and horizon_by stay null');
    // The drafter's own structure rules: authorship per item, one link per pair, no decorative links, no item quotas.
    expect(CORE_DRAFTER_RULES).toContain('user/party requires verbatim words stating that very item');
    expect(CORE_DRAFTER_RULES).toContain('At most one link between any two items: opposing mechanisms need distinct real intermediate paths.');
    expect(CORE_DRAFTER_RULES).toContain('Never add an arbitrary link just for connectivity');
    for (const quota of ['5 to 8 items', '8 to 14', 'up to about 16']) expect(CORE_DRAFTER_RULES).not.toContain(quota);
    // Paul's approved structure items (DL 22 Oct, his 12:00Z test): each said once; "at least one" different route replaces "at most one".
    for (const rule of ['Find what most limits reaching the aim (its binding constraint or critical path, e.g. time to close, approval, capacity) and model that mechanism explicitly.',
      "Offer at least one option that is structurally different (a different route, not a different split of the same levers), labelled Olumi's.",
      'Every item either lies on a path to the aim or is a condition on one; no stand-alone items.',
      "A stated sum, difference (subtracted ids in subtract) or two-part product is defined_as, not causal links from its parts, with their sign, units and attribution;",
      'Conditions are short, written for the person, one point each; keep working notes out of the model.',
      'A deadline is the window of the aim it belongs to, never an aim of its own: keep its words in by_when and, when it counts from today, its window in period_months (weeks \u00f7 4.35); '
        + 'for a calendar date ("by the end of September"), leave period_months null, set period_by olumi and read the date it fixes into period_deadline (YYYY-MM-DD, from today\'s date); Olumi records the day and works out its window.'])
      expect(CORE_DRAFTER_RULES.split(rule), rule).toHaveLength(2);
    expect(CORE_DRAFTER_RULES).not.toContain('When the aim has a deadline, record its window');
    // Codex r2 on #3660: never a fixed +1/\u22121 across different scales (\u00a3 thousands into \u00a3 is 1,000 per unit).
    expect(CORE_DRAFTER_RULES).not.toContain("in the whole's unit per the part's unit;");
    expect(CORE_DRAFTER_RULES).not.toContain("add at most one as Olumi's when it materially changes the reasoning");
  });

  it('the drafter modelling contract is sent once, and the blocking questions are asked on later turns too', () => {
    const draftRules = [
      "A qualitative worry or uncertainty is a risk, or a condition when it cannot reasonably be quantified, never an unmeasured factor.",
      "Every factor has a stated unit and a current value or a labelled Olumi estimate under the estimate rule; only schema-defined on/off steps use unit null and a 0-or-1 level (a risk-mitigation step is 0 today and 1 under the option that takes it).",
      "Represent mechanisms and dependencies with items and links (or defined_as for a stated sum/product), not only in condition or assumption text.",
      "Use conditions only for what cannot be quantified; aim for at most 5 conditions in a first model, retaining material context and dissent.",
      "Name the risks the brief implies: include at least one risk when the brief implies any, linked to what it would hit.",
      "For a risk's chance and window, use supplied figures or, where reasonable, a labelled Olumi estimate under the estimate rule; if no reasonable estimate is possible, keep it unknown and say what is missing.",
      "An option acts through settings on factors or sized option-to-item links; retain either valid form without adding an artificial factor.",
    ];
    const question = 'On later turns, ask the blocking questions still open in the same way, never one they have answered, even with "I don\'t know".';
    const firstTurn = `${b}\n\n${CORE_DRAFTER_RULES}`;
    for (const rule of [...draftRules, question]) expect(count(firstTurn, rule), rule).toBe(1);
    expect(count(b, question), 'the questions survive after the first model').toBe(1);
    // ALPHA: the one-question-per-reply rule it replaces is gone (the blocking questions are one numbered list).
    expect(b).not.toContain('end every reply with exactly ONE question');
    // P1 (23 Oct): the AI's own questions are capped at three a reply; the unlimited blocking list it replaces is gone.
    expect(b).not.toContain('Apart from the questions that block a goal, ask at most one question');
    for (const rule of draftRules) expect(b, 'draft-only modelling rules are not repeated in standing instructions').not.toContain(rule);
    for (const old of ['A possible event is a risk; an existing condition is a factor.',
      'Otherwise explain the missing capability or ask only for the necessary input.',
      'and ask for the decisive missing input;']) expect(firstTurn, old).not.toContain(old);
    // Unrelated quantities and adoption cannot lend a figure or authorship to another item.
    expect(firstTurn).toContain('never change or mix with a figure they gave');
    expect(firstTurn).toContain('user/party requires verbatim words stating that very item');
    expect(firstTurn).toContain('Adoption does not transfer authorship.');
  });

  it('DL 93d79c3e (C2 double prime, after the C2 revert #3700): a definition never nests another; only a stated per-unit effect becomes a sized link', () => {
    // The host holds a defined part (identity_part_unknown, factor_level_unknown), so a nested identity leaves the goal with no path.
    expect(CORE_DRAFTER_RULES.split("each part is a factor with its own level, never another definition.")).toHaveLength(2);
    // Buddy BLOCK + DL ruling: a stated definition is never turned into an estimated causal law to be admitted.
    expect(CORE_DRAFTER_RULES).toContain("is a sized link in its own unit, with their figure and range; never turn a stated definition into an estimated link.");
    for (const gone of ['a part made of others is a sized link', 'MECHANISM FIRST']) expect(CORE_DRAFTER_RULES, gone).not.toContain(gone);
  });

  it('keeps the entire estimate rule verbatim, rather than weakening figure or author protections', () => {
    expect(CORE_DRAFTER_RULES.split('\n\n').find((p) => p.startsWith('ESTIMATE RULE:'))).toBe("ESTIMATE RULE: Build a model the analysis can run on. Each item Olumi adds is complete and visibly Olumi's (source olumi, quote null): a factor has a provisional level, a central figure with a range around it, in a stated unit; each of Olumi's links has a direction and, where `to` has a unit and `from` has one or is an option or an on-or-off step (+1 when in place), a rough strength, a central figure with a range around it; each option except the status quo reaches the goal through what it changes; a risk Olumi raises has a provisional chance range and window, and links to what it would hit. Make each range as wide as what is genuinely unknown, from general knowledge of situations like this one. Where the person's or a party's item has no figure, give Olumi's provisional estimate of it with estimate_by olumi, as wide as what is genuinely unknown; never change or mix with a figure they gave, and never set the goal's target figure (ask for it). In the reply, say that the figures marked as Olumi's are starting estimates for them to correct.");
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

/** The Living Model text for scenarios whose saved model is not a program (Codex BLOCK 4 on #3709): staging 646d374e's, unchanged. */
describe('the Living Model core text, kept for old scenarios byte for byte (CORE_INSTRUCTIONS_LIVING_MODEL + CORE_REPLY_RULES_LIVING_MODEL)', () => {
  const { CORE_INSTRUCTIONS_LIVING_MODEL, CORE_REPLY_RULES_LIVING_MODEL } = coreInstructions;
  const old = instructionsForMode('core', CORE_INSTRUCTIONS_LIVING_MODEL, CORE_REPLY_RULES_LIVING_MODEL);

  it('is the text staging 646d374e sent on every core call, byte for byte (captured from that build: 29,512 characters)', () => {
    expect(old.length).toBe(29_512);
    expect(createHash('sha256').update(old, 'utf8').digest('hex')).toBe('7a1bced23a44dccc478a00d075b28bbe2dda487a4b6da868ae3a477698097e44');
    // and it is not the program text
    expect(old).not.toBe(instructionsForMode('core', CORE_ALIGNED_INSTRUCTIONS));
  });

  it('names none of the legacy tools and every core tool, with the AIE authority and starting-input wording', () => {
    for (const t of LEGACY_TOOLS) expect(old, t).not.toContain(t);
    for (const t of CORE_TOOLS) expect(old, t).toContain(t);
    expect(old).toContain("Do not treat a typed yes or your own interpretation as the card's approval.");
    expect(old).toContain('offer clearly labelled Olumi assumptions through propose_change for review');
    expect(old).not.toContain('{{MODE_AND_AUTHORITY}}');
  });

  it('keeps the shared reasoning, science and reply rules, each once, and the core reply rules last', () => {
    for (const h of ['\nTRUTH\n', '\nREASONING\n', '\nAUTHORSHIP\n', '\nIDEATION\n', 'POLYMATH COACHING', 'CALCULATION BOUNDARY']) expect(old, h).toContain(h);
    for (const part of [OLUMI_PURPOSE_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION, MODEL_RELATIVE_NAMING_INSTRUCTION, CORE_REPLY_RULES_LIVING_MODEL,
      HOST_SCIENCE_AND_SOURCE_RULES]) expect(count(old, part)).toBe(1);
    for (const rule of ['Never express the chance as a percentage of model runs.', 'Earlier assistant replies can describe a Run that was current then',
      'that separation rests on Olumi\'s own starting estimates', "The goal’s `target` is the figure the user stated"]) expect(old, rule).toContain(rule);
    expect(old.endsWith(CORE_REPLY_RULES_LIVING_MODEL)).toBe(true);
  });

  it('arm B is the AIE\'s assembled reference, byte for byte, plus the canvas-coaching sentence', () => {
    expect(old.split(NOTE_ON_ITEM_INSTRUCTION)).toHaveLength(2);
    expect(createHash('sha256').update(old.replace(`${NOTE_ON_ITEM_INSTRUCTION}\n\n`, ''), 'utf8').digest('hex')).toBe('055841368f958fd07a9e729b8f459e83d1793e98acbbd0b6bcefa8aba9ddf41a'); // 22 Oct: one exact blocking-input question; retire the coach's duplicate ask.
    expect(old).toContain('build the first model from their brief in that same turn');
    expect(old).toContain('a list in your reply adds nothing to their model');
  });

  it('its reply rules: the coach’s rules and the kept tool-reporting rules, each once', () => {
    expect(createHash('sha256').update(CORE_REPLY_RULES_LIVING_MODEL, 'utf8').digest('hex')).toBe('6f5f00c581ac4be2f1f590973e4bcf58c6eba498e5216bc3a8a21a189be5f3d6');
    for (const rule of ['Lead with one plain-language headline naming the insight. Then at most three short bullets',
      "give each option's chance of meeting the aim in this model and its stated uncertainty",
      'Never recommend, call an option best or a winner, say “you should choose” or “go with”, or choose for the team',
      "use only figures that are in the model with their author, or that the supplied result computed; never invent one. Say when a figure is Olumi's starting estimate.",
      'If calculations use untested Olumi assumptions, say “Illustrative calculation — uses untested Olumi assumptions.”'])
      expect(CORE_REPLY_RULES_LIVING_MODEL.split(rule), rule).toHaveLength(2);
    for (const kept of ['In this mode Olumi adds nothing to your reply and rewrites none of it: the user reads exactly your words.',
      'never your tools or what a tool response did or did not contain', 'Keep every must_say disclosure and the licences in run_facts.',
      'approving a reading adopts it but does not make the user its author', 'Where run_comparison is given, follow its note.',
      'or the analysis apply_change returns after a saved change), give that Run’s results first, then coach on that same Run.',
      'A Run that did not complete leaves a saved change saved: say both.', "Keep a clearly separate situation out of the current scenario's Living Model.",
      'do not claim it was created or put its facts into this model instead'])
      expect(old.split(kept), kept).toHaveLength(2);
  });

  it('keeps the one blocking-input question, once, and none of the drafter’s modelling rules', () => {
    const question = "Whenever a missing input leaves the Run blocked, end every reply with exactly ONE question asking for the specific input the Run needs next (today's level, a measure, a target or a time window), in plain words; use the current state and tool outcome, never re-ask a supplied input.";
    expect(count(old, question)).toBe(1);
    expect(old).not.toContain("A qualitative worry or uncertainty is a risk, or a condition when it cannot reasonably be quantified, never an unmeasured factor.");
  });
});
