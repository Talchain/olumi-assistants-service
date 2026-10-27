import { describe, expect, it } from 'vitest';
import { CORE_ALIGNED_INSTRUCTIONS, CORE_REPLY_RULES, NOTE_ON_ITEM_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION, instructionsForMode, MODEL_RELATIVE_NAMING_INSTRUCTION,
  promptArmOf, coreEffortArmOf } from '../../../routes/agent-v1-turn.js';
import { coreBudget } from '../model-budgets.js';
import { OLUMI_PURPOSE_INSTRUCTION } from '../olumi-purpose.js';
import { HOST_SCIENCE_AND_SOURCE_RULES, HOST_TOOL_CONTRACT } from '../coach-route-v0_2.js';
import { createHash } from 'node:crypto';
import * as drafting from '../../path-b/drafting-guidance.js';
import * as coreInstructions from '../../core-route/instructions.js';
import { CANONICAL_JSON_SCHEMA, DRAFTING_INSTRUCTIONS, UPDATE_PREFIX, UPDATE_REPAIR_PREFIX } from '../../model-program-turn/prompt.js';
import * as programDraft from '../../model-program-turn/draft.js';
import { PROGRAM_TURN_GUIDANCE } from '../../model-program-turn/program-tools.js';

const { CORE_DRAFTER_RULES } = drafting;

/** Tools the core agent does not have, named by the legacy routing arm B removes (AIE #3523 6298433275). */
const LEGACY_TOOLS = ['propose_starting_point', 'propose_assumptions', 'authorise_change', 'get_canonical_state', 'propose_link_effect',
  'propose_model_change', 'propose_option_interventions', 'propose_hiring_times'];
const CORE_TOOLS = ['read_canonical_context', 'build_model_from_brief', 'propose_change', 'apply_change', 'run_analysis'];
const count = (text: string, part: string): number => text.split(part).length - 1;

describe('prompt arm B (programme-docs #94 6302769609): the core agent is told only about the tools it has', () => {
  const b = coreInstructions.programInstructions();

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
    // T1 (27 Oct): a caveat is said once in a conversation, and a later reply gives only what changed.
    expect(b).toContain('say what a chance rests on and each caveat once, the first time you report it');
    expect(b).toContain('add no disclaimer such as “not a recommendation”');
    for (const gone of [HOST_SCIENCE_AND_SOURCE_RULES, GOAL_CHANCE_RANKING_INSTRUCTION, MODEL_RELATIVE_NAMING_INSTRUCTION, '\nTRUTH\n', '\nREASONING\n',
      'POLYMATH COACHING', 'saved_run_options', 'goal_chance_licence', 'decision_sensitivity', 'run_facts']) expect(b, gone.slice(0, 60)).not.toContain(gone);
    // Under half the 29,512 characters it replaces (staging 646d374e).
    expect(b.length).toBeLessThan(29_512 / 2);
  });

  it('the sent program instructions, byte for byte, with no canvas-coaching sentence: the program tools offer no note_on_item (alpha G5; the route row in core-turn.route.test.ts pins the same bytes as the SDK receives them)', () => {
    expect(b).not.toContain(NOTE_ON_ITEM_INSTRUCTION);
    expect(b.endsWith(CORE_REPLY_RULES)).toBe(true);
    // 23 Oct (ALPHA): the model-program prompt replaces arm B's assembled reference (055841368f…, 29,512 characters sent).
    expect(createHash('sha256').update(b, 'utf8').digest('hex')).toBe('ef5655cb40b60676cea666da0195ccd5a73bd907d330f5a67836facc01300c0f'); // 27 Oct: T1, each caveat once per conversation and no "not a recommendation" disclaimer. 26 Oct: integrated review words#7, the "on Olumi’s reading of …" basis. 25 Oct: alpha G10, no threshold sentences. 25 Oct: alpha G5, no note_on_item sentence on the program path. 24 Oct: issue 30, synthetic examples only; before it, remodel coaching (after 23 Oct P1/P4: at most three questions, each once, never what their words state).
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
    // 24 Oct (DL, marketing "no path"; AIE policy): a goal or limit an update adds comes with the options' relations to it, only
    // where an option plausibly affects it, never added merely to connect.
    // 26 Oct: alpha G2, floor and ceiling are Olumi's reading of what a quantity can physically be (0 for a count or level; null for a change).
    // 26 Oct (drafter candidate A, Paul's rulings + Codex buddy AMENDs): no aim stated -> ONE working aim of Olumi's, its target asked;
    // short neutral option names with their words as the quote; one or two lower-commitment options of Olumi's where they name none,
    // one or only opposites; additions materially useful, never a quota; one statement, one record.
    // T3 (27 Oct): the three rules by problem type, by their own words.
    expect(DRAFTING_INSTRUCTIONS).toContain('A one-off payment (a purchase, an investment, a campaign\'s total) is counted once');
    expect(DRAFTING_INSTRUCTIONS).toContain('A measure tracks the outcome the aim names');
    expect(DRAFTING_INSTRUCTIONS).toContain('never derived from the terms it is combined with; otherwise leave it null');
    expect(DRAFTING_INSTRUCTIONS).toContain('a durable asset or level it adds (an oven\'s capacity, members gained) may drive output every period');
    expect(DRAFTING_INSTRUCTIONS).toContain('reaching no effect or the opposite sign where that is plausible, never only the direction that favours one option');
    expect(DRAFTING_INSTRUCTIONS).toContain('A record of theirs holds only what they said');
    expect(DRAFTING_INSTRUCTIONS).not.toContain('sets ad_spend to its own value 1000');
    // 27 Oct (Paul, approved): a short title for the situation and for each goal, limit and risk card, their words staying in its
    // quote; at most three coaching questions that test the reasoning, never a request for a figure.
    for (const rule of ['- Titles: title is a short title of a few words for the whole situation ("Second oven or wholesale?"); question stays the one plain sentence. Every goal, limit and risk label is a short title of a few words for its card, never a sentence; their words stay in its quote.',
      '- Coaching questions: at most three, each one plain question to the person that tests their reasoning: the aim behind the request, an alternative they have not weighed, the assumption the result leans on most, or a priority, constraint or commitment only they know that could change which option is most likely to achieve the aim (how long they can wait, what they have already promised). Never a request for a figure (that is asked on its own item), never leading, never answerable yes or no.'])
      expect(count(DRAFTING_INSTRUCTIONS, rule), rule).toBe(1);
    expect(createHash('sha256').update(DRAFTING_INSTRUCTIONS, 'utf8').digest('hex')).toBe('d30f8c7f7f5a323b8ed881547aef86c83ecdb92c801c430373b643045b28bc78'); // 27 Oct: titles and coaching questions (Paul approved). 27 Oct: W1 + PL AMEND (no quota on Olumi's options; a risk in the structure only with a defensible mechanism; an unsizable chance stays unknown), think before writing (extract, widen, select, frame; ported from the benchmarked v202 prompt), carry on as now always an option, a risk's chance an estimate unless only they can know it (prompt test 27 Oct: carry-on 2/9 -> 8/8, Olumi options 7 -> 15). 27 Oct: W2, no "history is []" (history is the host's, never in the first draft's schema). 27 Oct: T3, a relative change's floor is −100 % (science on Paul's hiring Run), an estimated range is two-sided where plausible, a one-off amount happens once (a stock's start, never a per-period driver), a measure tracks the aim, a record of theirs holds only their words; the example's ads are a weekly spend into a 'spent' stock. // 25 Oct: alpha G21, the reach rule is the compiler's (at least one goal or limit, only when every goal has a measure)
    // 24 Oct (DL, DoD-G classes 12 and 4): an update returns only the records it changes or adds; the host merges them by id.
    expect(createHash('sha256').update(UPDATE_PREFIX, 'utf8').digest('hex')).toBe('b54257c11969f65208dfead1d0006e17a88c65d20f0e0880588c650b58d8e4c8');
    expect(createHash('sha256').update(UPDATE_REPAIR_PREFIX, 'utf8').digest('hex')).toBe('1b52b62678cfab1b06670bc026504a9e63e186e458fec752c4b56ba9df918daf');
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
      // Integrated review 26 Oct (words#7, adopted): the third basis #3769 serves, quoted as the result words it, never shortened.
      'report each option\u2019s chance as the result words it: the figure, the goal, target and horizon it answers, and what it rests on, "on your figures", "on Olumi\u2019s reading of \u2026" or "if" with Olumi\'s assumptions (name them briefly; quote "on Olumi\u2019s reading of \u2026" as the result words it, with any "(not yet confirmed)", never shortened to "on your figures"; never drop the "if" or turn it into a forecast).',
      'Never work out, round, combine or rank a chance yourself.',
      'Then give ONE next step: replace an Olumi estimate the chance rests on with their own figure, or test the assumption the result rests on. Call an input the one that matters most only when the result measured that.',
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
    // T1 (Paul 26 Oct): the AI writes results from the Run's own facts, each figure exactly as given and said once.
    const words = 'Report results only from the Run\u2019s own facts: each option\u2019s chance as run.options[].chance gives it (with run.options[].precision_95, in %, only if asked how exact it is); '
      + 'what that chance rests on, in a few plain words, or, where shown is false, why none is shown: both are in run.options[].words; the input it is most sensitive to with the chance at that input\u2019s low, middle and high values (run.options[].driver); '
      + 'each goal\u2019s own words with each option\u2019s display for it (run.goal_chance.targets.per_target[].words and its options[].display); '
      + 'for meeting every goal together, run.goal_chance.targets.joint.words, or its line saying why that waits (run.goal_chance.targets.joint.line); '
      + 'and run.goal_chance.notes, limits[].words with each option\u2019s display, and unchecked_limits[].words. '
      + 'Use those figures exactly as given; never a figure, chance, rounding, combination or ranking of your own.';
    // The run block as S3 emits it: { run_id, options[{ option_id, shown, words }], goal_chance: the Run's own block }.
    const PATHS = ['run.options[].words', 'run.options[].chance', 'run.options[].precision_95', 'run.options[].driver', 'run.goal_chance.targets.per_target[].words', 'run.goal_chance.targets.joint.words',
      'run.goal_chance.targets.joint.line', 'run.goal_chance.notes, limits[].words with', 'and unchecked_limits[].words'];
    for (const [name, text] of Object.entries(d)) {
      expect(text.split(words), name).toHaveLength(2);
      for (const path of PATHS) expect(count(text, path), `${name}: ${path}`).toBe(1);
      // The paths S3 no longer emits (14:2xZ): no description names them.
      for (const gone of ['run.targets', 'run.notes', 'run.thresholds', 'thresholds[]', 'run.limits', 'run.unchecked_limits']) expect(text, `${name}: ${gone}`).not.toContain(gone);
      for (const banned of ['recommend', 'best', 'winner', 'you should', '18 to 22']) expect(text.toLowerCase(), `${name}: ${banned}`).not.toContain(banned);
    }
    // read_canonical_context returns model (as authored), earlier_versions, open_questions, coaching and run.
    for (const field of ['its revision; model, the canonical model exactly as authored (', 'earlier_versions, how many earlier versions it has;',
      // S1 (A4): what the Run waits on is typed; the AI asks in its own words, and each code says what the person supplies.
      'blockers, what the stored Run waits on, in the model\'s order, each with its id, code and scope (what it holds up). No question is written for you:',
      'asked, the figure', 'range_kind, whether the ends of their range are firm or a rough estimate;',
      // Integrated review 26 Oct (words#4, adopted): a recount is a figure outside Olumi's floor or ceiling, never "given below 0";
      // its bound is the blocker's reason, and a Run stored before reasons gives none (Codex B1).
      'recount, their figure outside Olumi\'s reading of what it can be (a floor or ceiling): ask again, quoting the blocker\'s reason, which names their figure and Olumi\'s bound, so they can correct either;',
      'a blocker with no reason (a Run stored before it) gives no bound: say only that their figure is outside what Olumi reads it can be, and name none;',
      'unknown, a figure no one can give or responsibly estimate yet: say why (its basis) and what evidence, question or activity would size it; never ask them for the number;',
      'measure, how the aim or guardrail is measured;', 'deadline, by when;', 'no_goal, the result they want.',
      'and run, the stored Run, with current and engine_current.']) expect(d.read_canonical_context, field).toContain(field);
    // Targeted answers (DL 24 Oct): an answer in answers on its item's id; anything else in words, with the ids to remove, which
    // Olumi's drafter writes; no op set.
    for (const gone of ['set_quantity', 'set_range_kind', 'set_goal_target', 'add_option', 'rename_option', 'define_goal_measure', 'ops']) expect(d.propose_change, gone).not.toMatch(new RegExp(`\\b${gone}\\b`));
    // Strip (Paul 26 Oct; B5 removed): a figure answer in answers, a worded answer in request.
    expect(d.propose_change).toContain('An answer to a listed question (a blocker, or an asked item\'s question) that gives a figure, or says they do not know, goes in answers, on that existing figure\'s id from read_canonical_context, saying whose it is: '
      + 'author person, status known, with their figure and their exact words this turn as quote;');
    expect(d.propose_change).toContain('An answer in words with no figure (a measure, a deadline, a date, a definition) goes in request, in their exact words with the id it answers.');
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

  it('the model-program drafter (DL 24 Oct): only their facts wait, link sizes stay Olumi\u2019s estimates, quotes are copied exactly, and an update keeps every option reaching every goal', () => {
    for (const rule of [
      'its quote is their words copied exactly, one unbroken stretch, never reworded or joined.',
      'what they know or decide: current levels, prices, costs, budgets and how they split them, headcount, dates, durations, targets.',
      'Never ask them for a link\'s size or an option\'s effect.',
      // DL 24 Oct (blind score of 1510a008, mrr structure): an identity is a definition; a missing figure is asked on its item.
      'Mechanism: each option reaches, through relations from what it sets, at least one measured goal or limit it plausibly affects, never a link added only to connect it; a quantity that is by definition a product or sum of others is a definition, never an effect; each other link is sized by their coefficient or Olumi\'s estimate.',
      // AIE 6386018855 §5 (DL 24 Oct): the capture-only clauses replaced, each permission once, attributed and grounded.
      // Candidate A: the update's own goal-or-limit rule is said once, in UPDATE_PREFIX (pinned below), which every update sends.
      'Olumi\'s own additions (a working aim, a suggested measure, options, drivers, risks) are made when the model is first drafted; a repair or an update changes only what it asks.',
      'What Olumi adds is author "olumi", quote null, never presented as theirs.',
      'Model the main reason each option could succeed and the main reason it could fail.',
      'Every driver, constraint and current state they mention feeds the calculation or the record that fits it.',
      'Where the brief leaves out a driver, countereffect, side effect or risk that is plausible and could change the result, add it as Olumi\'s hypothesis (author olumi, with a basis and its direction); plausibility alone never justifies a figure, so size it like any other link.',
      'Only what is materially useful: no quota, nothing merely conceivable.',
      // Paul 26 Oct (1): no aim stated -> one provisional working aim of Olumi's, its target asked, never invented.
      'No aim stated: ONE working aim of Olumi\'s (a short plain label), the outcome the brief most plainly points to, measured the same way, its target asked by a question offering the aim to confirm or change',
      'An aim they state without a measure stays theirs: where a measure can responsibly track it, suggest one (measure_by "olumi":',
      'its target asked unless they gave one and its exclusions naming what it misses; a suggested measure is never their definition of success.',
      'An aim no measure can responsibly track, and a guardrail without one, keep measure null and a question.',
      // Paul 26 Oct (2) and (3): short neutral names, their words the quote; Olumi's lower-commitment options where they name none, one or only opposites.
      'and every option they named, each under a short neutral name ("Second oven"), their words as its quote.',
      'Options: carry on as now is always one option (sets [], named "Carry on as now", Olumi\'s unless one of theirs already is it), so each option is compared with not acting;',
      'Where they name none or one, only two opposites (do it or not), or ask what they can do, add one or two materially different options of Olumi\'s, lower-commitment where it fits (staged, partial, reversible or learn-first); where the question is how to divide something (money, staff, hours), a small set of feasible divisions (a design, not a fact about today). Olumi\'s options stay within their stated budgets, exclusions and scope.',
      'option "Weekly local ads", olumi (they named only one; reversible, lower-commitment): sets ad_spend to its own value 50, olumi',
      'left_out holds only what matters to the result but cannot be calculated, with the reason;',
      // AMEND (DL 24 Oct, blind score of #3735): a lever only the options set, and a whole, are structure; a stated limit stays a limit.
      'So are the starting level of a setting only the options change, when they gave none (0, an Olumi division\'s share included), and a whole such as 100 %: never asked.',
      // Codex buddy AMEND (26 Oct): one statement, one record; assertion vs evidence and value vs assumed relationship stay distinct.
      'One statement, one record, never paraphrased into a second; an assertion and its evidence, or a figure and the relationship assumed about it, stay two.',
      'the rest goes in the record that fits: a condition the plan must not break → limits, a disagreement → dissent,',
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
    // Alpha G21: the old universal reach rule, stricter than the compiler's (compile.ts set_reaches_nothing / option_reaches_no_goal), is gone.
    expect(DRAFTING_INSTRUCTIONS).not.toContain('every option reaches every measured goal');
    // Candidate A: the capture-only clauses are gone (no aim -> no goal; options only where none named; exact names; the goal precondition).
    for (const old of ['No aim stated: no goal', 'when the model has a goal', 'by its exact name in full', 'a left_out note with id aim', 'option "A second oven"'])
      expect(DRAFTING_INSTRUCTIONS, old).not.toContain(old);
    // What over-applied the estimate rule, and the old period numbering, are gone.
    for (const old of ['never invent a measure', 'its direction in words', 'Important but uncalculable', 'from what the brief names', 'goes in left_out with the reason', 'a link you cannot size goes in left_out', 'Every other figure it needs stays null', 'Only coefficients are Olumi', 'never "unknown" with no question', 'flows of periods 1 to n', 'from period 0'])
      expect(DRAFTING_INSTRUCTIONS, old).not.toContain(old);
    // The update's text is prompt text: here, once, with the draft's goal rule and the quote rule; draft.ts no longer holds a copy.
    // DL 24 Oct (DoD-G classes 12 and 4): only the records it changes or adds; never one it did not change; removals listed.
    for (const rule of ['return only the records you change or add, with their ids, each in full and as it was but for the change; never return a record you did not change; list removals in remove (only the ids listed to remove).',
      // DL 24 Oct (marketing "no path"; AIE policy): the goals arrive in an update, so it brings the options' relations to
      // them, only where an option plausibly affects them; never merely to connect.
      'A goal or limit this change adds comes with the relations from the options to it, only where an option plausibly affects it; never added merely to connect. Size them as for a first draft, and return those relations too.',
      'A figure of theirs quotes their words copied exactly, never reworded or joined;',
      // DL 24 Oct (class 12): an answer is entered on the item it answers; a figure read from words says so in its basis.
      'Each answer goes on the item whose question it answers (a question about one option, on that option\'s item);',
      'words that settle a figure (yes, no, all, none) are that figure, quoting them, its basis saying how they were read.',
      'Never keep an answer unassigned and ask it again.',
      // DL 24 Oct (class 12 remainder): "I don't know" is an answer; the item stays open with a new question.
      '"I don\'t know" is an answer too: the item stays open, its question changed to ask for what would size it.']) expect(count(UPDATE_PREFIX, rule), rule).toBe(1);
    // The whole-model update is gone: from the update's text and from its repair turn.
    for (const old of ['WHOLE model', 'Keep every record, with its id, exactly as it is', 'Leave out only the ids listed', 'Keep the history as it is.', 'a goal this change adds included', 'Every option reaches every measured goal'])
      expect(`${UPDATE_PREFIX}${UPDATE_REPAIR_PREFIX}`, old).not.toContain(old);
    expect(count(UPDATE_REPAIR_PREFIX, 'Return all your changes again with them fixed, by the same rules: only the records you change or add, each in full with its id, and the removals.')).toBe(1);
    // The program turn's guidance is prompt text: answers in order answer the questions in order, and none is asked again in the same words.
    // Targeted answers (DL 24 Oct): a figure answer goes in answers on its figure's id; a worded answer and anything else in
    // request (strip, Paul 26 Oct, B5; pinned as sent in core-turn.route).
    expect(createHash('sha256').update(PROGRAM_TURN_GUIDANCE, 'utf8').digest('hex')).toBe('38f262c5fc61aff38bb7454774eb4b8e28114f6bdf1a92720ed0e609e7787664');
    expect(count(PROGRAM_TURN_GUIDANCE, 'Answers in the order of your questions answer them in that order, and "I don\'t know" is an answer: put each on the item of the question it answers, and never ask one again in the same words.')).toBe(1);
    expect(count(PROGRAM_TURN_GUIDANCE, 'call propose_change ONCE: an answer to a listed question that gives a figure, or says they do not know, goes in answers, on that figure\'s id; '
      + 'an answer in words with no figure (a measure, a deadline, a date, a definition) and any other change go in request,')).toBe(1);
    expect(PROGRAM_TURN_GUIDANCE).not.toContain('an answer to a listed question goes in answers, on that item\'s id; any other change goes in request,');
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
    for (const rule of ['Where one can, Olumi suggests it instead (measure_by olumi).', 'the measure is a suggestion, never their definition of success;',
      'each with its own measure (theirs, Olumi\'s suggestion, or null with a question), target and window; when they state none, ONE working aim of Olumi\'s (author olumi), its target asked. Never an aim of Olumi\'s beside theirs.',
      'and, where they name none, one or only two opposites, or ask what they can do, one or two materially different ones of Olumi\'s (author olumi), lower-commitment where it fits; for how to divide something, a small set; always within their stated budgets and scope.',
      // The sent schema is JSON text, so its double quotes arrive escaped: pin the clause after the example name.
      '); a person\'s option keeps their own words in quote.'])
      expect(count(sentSchema, rule), rule).toBe(1);
    for (const old of ['Never invent a measure', 'An aim with no measure is valid; never invent one']) expect(sentSchema, old).not.toContain(old);
    // 27 Oct (Paul, approved): the sent schema names a short title for the situation and for each goal, limit and risk card (their
    // words stay in quote), and Olumi's coaching questions, at most three; a goal's or limit's label is no longer their own words.
    const sent = CANONICAL_JSON_SCHEMA as { properties: Record<string, { description?: string; items?: { properties: Record<string, { description: string }> } }> };
    expect(Object.keys(sent.properties)).toEqual(expect.arrayContaining(['title', 'coaching_questions']));
    expect(sent.properties['title']!.description).toContain('A short title of a few words for the situation');
    expect(sent.properties['coaching_questions']!.description).toContain('at most three, each ONE plain question to the person that tests their reasoning');
    expect(sent.properties['coaching_questions']!.description).toContain('Never a request for a figure');
    expect(['goals', 'limits', 'risks'].map((f) => sent.properties[f]!.items!.properties['label']!.description.startsWith('A short title of a few words for '))).toEqual([true, true, true]);
    for (const old of ['The aim in the person\'s own words', 'The condition in the person\'s own words']) expect(sentSchema, old).not.toContain(old);
    // Contrast: an option's name is unchanged, a short neutral name with their words in quote.
    expect(sent.properties['options']!.items!.properties['label']!.description).toBe('A short neutral name ("Second oven"); a person\'s option keeps their own words in quote.');
    for (const old of ['Never an aim they did not state', 'by its exact name', 'exact name as the person wrote it']) expect(sentSchema, old).not.toContain(old);
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
