import { describe, expect, it } from 'vitest';
import { CORE_ALIGNED_INSTRUCTIONS, CORE_REPLY_RULES, NOTE_ON_ITEM_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION, instructionsForMode, MODEL_RELATIVE_NAMING_INSTRUCTION,
  promptArmOf, coreEffortArmOf } from '../../../routes/agent-v1-turn.js';
import { coreBudget } from '../model-budgets.js';
import { OLUMI_PURPOSE_INSTRUCTION } from '../olumi-purpose.js';
import { HOST_SCIENCE_AND_SOURCE_RULES, HOST_TOOL_CONTRACT } from '../coach-route-v0_2.js';
import { createHash } from 'node:crypto';
import * as drafting from '../../path-b/drafting-guidance.js';
import * as coreInstructions from '../../core-route/instructions.js';
import { CANONICAL_JSON_SCHEMA, DRAFTING_INSTRUCTIONS, UPDATE_JSON_SCHEMA, UPDATE_PREFIX, UPDATE_REPAIR_PREFIX } from '../../model-program-turn/prompt.js';
import * as programDraft from '../../model-program-turn/draft.js';
import { PROGRAM_TURN_FACTS_PREFIX, programTurnFacts } from '../../model-program-turn/program-tools.js';
import { APPROXIMATE_FIGURE } from '../../model-program/canonical.js';

const { CORE_DRAFTER_RULES } = drafting;

/** Tools the core agent does not have, named by the legacy routing arm B removes (AIE #3523 6298433275). */
const LEGACY_TOOLS = ['propose_starting_point', 'propose_assumptions', 'authorise_change', 'get_canonical_state', 'propose_link_effect',
  'propose_model_change', 'propose_option_interventions', 'propose_hiring_times'];
const CORE_TOOLS = ['read_canonical_context', 'build_model_from_brief', 'propose_change', 'apply_change', 'run_analysis'];
const count = (text: string, part: string): number => text.split(part).length - 1;

describe('prompt arm B (programme-docs #94 6302769609): the core agent is told only about the tools it has', () => {
  const b = coreInstructions.programInstructions();

  it('ALPHA (DL 93d79c3e, 23 Oct): names no legacy tool and no drafting or edit tool (each tool\u2019s own description says how); the card-approval rule is apply_change\u2019s own (round 3)', () => {
    for (const t of LEGACY_TOOLS) expect(b, t).not.toContain(t);
    for (const t of CORE_TOOLS) expect(b, t).not.toContain(t);
    // Round 3 (27 Oct, Paul approved): the approval, uncertain-outcome and Run-permission sentences are the tools' own descriptions, said once.
    expect(b).not.toContain("Do not treat a typed yes or your own interpretation as the card's approval.");
    // prompts-v2 (29 Oct): in tool-descriptions.txt's words.
    expect(count(coreInstructions.PROGRAM_TOOL_DESCRIPTIONS.apply_change, 'Typed agreement is not card approval.')).toBe(1);
    expect(count(coreInstructions.PROGRAM_TOOL_DESCRIPTIONS.apply_change, 'A refused operation was not saved. An unknown outcome does not establish whether it saved.')).toBe(1);
    expect(b).not.toContain('{{MODE_AND_AUTHORITY}}');
  });

  it('ALPHA + prompts-v2 (29 Oct): the model-program prompt is agent-coaching.txt alone, each section once; the purpose block, the reply rules, the coach template and the Living Model host rules are gone', () => {
    for (const h of ['STATE AND ACTION', 'ESTIMATES', 'RUN-GROUNDED COACHING', 'CALCULATION BOUNDARY', 'REPLY']) expect(count(b, `\n\n${h}\n`), h).toBe(1);
    // prompts-v2: the one instruction contract; the old normative blocks are no longer appended on the program path.
    for (const part of [OLUMI_PURPOSE_INSTRUCTION, CORE_REPLY_RULES, CORE_ALIGNED_INSTRUCTIONS]) expect(b, part.slice(0, 60)).not.toContain(part);
    expect(b).toBe(coreInstructions.PROGRAM_AGENT_INSTRUCTIONS);
    // T1 (27 Oct): a caveat is said once in a conversation, and a later reply gives only what changed. Round 2 (27 Oct, consolidation):
    // the RESULTS paragraph says it in one sentence, with no extra disclaimer; the earlier wording is gone.
    // Round 3 (27 Oct): "Say each thing once" is the purpose instruction's; RESULTS keeps only the later-turn delta.
    // prompts-v2 (29 Oct): the REPLY section says it, and a continuation refreshes against current state.
    expect(count(b, 'On continuations refresh against current state and ask at most one useful question;')).toBe(1);
    expect(count(b, 'say each thing once.')).toBe(1);
    for (const old of ['say what a chance rests on and each caveat once, the first time you report it', 'add no disclaimer such as “not a recommendation”',
      'State each figure and caveat once', 'report findings in this model without advice'])
      expect(b, old).not.toContain(old);
    for (const gone of [HOST_SCIENCE_AND_SOURCE_RULES, GOAL_CHANCE_RANKING_INSTRUCTION, MODEL_RELATIVE_NAMING_INSTRUCTION, '\nTRUTH\n', '\nREASONING\n',
      'POLYMATH COACHING', 'saved_run_options', 'goal_chance_licence', 'decision_sensitivity', 'run_facts']) expect(b, gone.slice(0, 60)).not.toContain(gone);
    // Under half the 29,512 characters it replaces (staging 646d374e).
    expect(b.length).toBeLessThan(29_512 / 2);
  });

  it('the sent program instructions, byte for byte, with no canvas-coaching sentence: the program tools offer no note_on_item (alpha G5; the route row in core-turn.route.test.ts pins the same bytes as the SDK receives them)', () => {
    expect(b).not.toContain(NOTE_ON_ITEM_INSTRUCTION);
    expect(b).not.toContain(CORE_REPLY_RULES);
    // 23 Oct (ALPHA): the model-program prompt replaces arm B's assembled reference (055841368f…, 29,512 characters sent).
    expect(createHash('sha256').update(b, 'utf8').digest('hex')).toBe('d312182a6485eff690ed9cf089daa9ff46737a0f212770ea9692c8186227e467'); // 29 Oct: prompts-v2 agent-coaching.txt with the DL's C1, the program's one contract; before it 95c5eb7c. · 29 Oct 03:2xZ: assessor AR0300 boundaries; before it d29e9d87. · 29 Oct: J2, when asked Olumi proposes labelled ranged estimates (ANSWERS AND CHANGES); before it 36cfc7fd. · 28 Oct: Box 3 rerun, factors and what the result waits on also by their names; before it 232ae815…. 28 Oct: Box 3 naming (each option, aim and limit by the name the model shows); before it d2bc1608…. C1 (Paul approved 16:0xZ): the no-chance comparison in words (K1's sentence, the PL's 16:20 wording) keeping any consequence the model works out; K1-K3 REJECTED, so no other K line; before it c545b8a1…. 27 Oct: round 3 (Paul approved): first-model questions are coaching_questions in drafted order (the cap is the schema's); the approval/Run sentences are the tools' own; a non-current Run said in RESULTS; before it 1c0f7685…. 27 Oct: round 2, the consolidation (DL): RESULTS is the single Run-reporting owner, the first-model questions take coaching_questions then item questions in order, the reply rules shortened; before it e1e01c5e…. 27 Oct: round 1, the first-model questions lead with the premise that could change the comparison (DL). 27 Oct: T1, each caveat once per conversation and no "not a recommendation" disclaimer. 26 Oct: integrated review words#7, the "on Olumi’s reading of …" basis. 25 Oct: alpha G10, no threshold sentences. 25 Oct: alpha G5, no note_on_item sentence on the program path. 24 Oct: issue 30, synthetic examples only; before it, remodel coaching (after 23 Oct P1/P4: at most three questions, each once, never what their words state).
    // Candidate-3 witness kept (21 Oct): WHEN to build. Text only, not behaviour. prompts-v2 (29 Oct): the host builds it.
    expect(b).toContain('The host prepares the first model and its automatic Run before the coaching reply.');
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
    expect(createHash('sha256').update(CORE_REPLY_RULES, 'utf8').digest('hex')).toBe('2b0ac1a67213de26e9693c19e9bced1491eb4531bb6dfde77f5aa274d7097344'); // 27 Oct: round 2 (DL), the three reply rules shortened (summary length, no host words, authors unchanged); question selection is FIRST MODEL's; before it 267a3289…. 23 Oct (ALPHA): the reply rules for the model program; P1: at most three questions a reply, each once.
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
    // T3 (27 Oct): the three rules by problem type, by their own words. Round 2 (27 Oct, consolidation): in the shortened steps;
    // a coefficient's own bound is the schema's floor description, as sent.
    expect(count(DRAFTING_INSTRUCTIONS, 'Count a one-off payment once, through a total or stock start; model lasting assets through their capacity and ongoing activity through spending over a bounded window.')).toBe(1);
    // Round 3 (27 Oct): the release-bar sentence is the goal measure's own description, as sent.
    expect(count(DRAFTING_INSTRUCTIONS, 'Suggest a measure only when it tracks that aim, with exclusions for what it misses.')).toBe(1);
    expect(DRAFTING_INSTRUCTIONS).not.toContain('release bar');
    expect(count(JSON.stringify(CANONICAL_JSON_SCHEMA), 'A proposed release bar or other standard is an assumption or condition, never a substitute measure.')).toBe(1);
    expect(count(JSON.stringify(CANONICAL_JSON_SCHEMA), 'A coefficient\'s bound follows its own meaning, never other terms.')).toBe(1);
    // Round 1 (27 Oct, the PL's candidate wording, adopted by the DL): the Mechanisms and Faithful bullets are replaced. A record
    // of theirs never gains a unit, period or reference point they did not give (it is asked); an estimate needs a supported
    // scale. The candidate drops the two-sided-range sentence; the replaced wording is gone.
    // Round 2 (27 Oct): step 5 of the shortened steps; the estimate rule is the schema's kind description, as sent.
    expect(count(DRAFTING_INSTRUCTIONS, 'never invent a unit, period or reference, turn a stated amount into an unsupported rate, or assume carry-on leaves a reference unchanged.')).toBe(1);
    // r10 (Paul 28 Oct, superseding the supported-scale rule: "Olumi can make assumptions and even make educated guesses on data …
    // clearly visible if Olumi has produced the assumption or data, and … the level of uncertainty"): the estimate rule is the
    // status description, an 8-in-10 range as the engine reads it (range-law.ts rule 1); the old rule is gone. Changed knowingly.
    expect(count(JSON.stringify(CANONICAL_JSON_SCHEMA), 'estimated: Olumi\'s estimate of a figure they did not give (a fact or a coefficient), author olumi, with plausible low/high the true figure falls inside about 8 times in 10.')).toBe(1);
    expect(JSON.stringify(CANONICAL_JSON_SCHEMA)).not.toContain('estimate only when a stated relation or established mechanism supports numerical scale');
    for (const old of ['reaching no effect or the opposite sign where that is plausible, never only the direction that favours one option', 'A record of theirs holds only what they said'])
      expect(DRAFTING_INSTRUCTIONS, old).not.toContain(old);
    expect(DRAFTING_INSTRUCTIONS).not.toContain('sets ad_spend to its own value 1000');
    // 27 Oct (Paul, approved): a short title for the situation and for each goal, limit and risk card, their words staying in its
    // quote; at most three coaching questions that test the reasoning, never a request for a figure. Round 2 (27 Oct, consolidation): the
    // titles are the schema's labels (pinned below, as sent); coaching questions are chosen with the item questions by one priority
    // (step 6), and the schema's description gives their form. The two bullets are gone.
    expect(count(DRAFTING_INSTRUCTIONS, 'Put each missing input\'s question on its item; order item arrays and select coaching_questions by this priority, leading with the unknown that most separates the options or fixes the reference point, before peripheral detail.')).toBe(1);
    for (const old of ['- Titles:', '- Coaching questions:']) expect(DRAFTING_INSTRUCTIONS, old).not.toContain(old);
    expect(createHash('sha256').update(DRAFTING_INSTRUCTIONS, 'utf8').digest('hex')).toBe('9baa031a700b8105566aad204af2ef9b2dbbf4fb3a5111010dc0643fa1aebea8'); // 29 Oct: stated time and decide-by (TIME-AND-DECIDE-BY design) on GAP 1's drafter; before it c2f026ef (GAP 1), d179ac9d. · 29 Oct 03:2xZ: assessor AR0300 boundaries; before it 037e7483. · 29 Oct 03:0xZ: an unstated start is Olumi's only where an aim has a deadline or window (J1 capacity). Before: 767a1e6b, r11 (r10 stop-early: timing asked, figures re-authored; PL 00:37: no tuning-brief cues, no stopping-risk rule); before it 8fbbb786…. 28 Oct: r10 (Paul 28 Oct: Olumi's labelled, ranged estimates; arithmetic to the aim; estimates-example.test.ts proves the example calculates); before it f5c109cb…. 28 Oct: r9 (r8c2 stop-early calculable 0/3; the overseer 22:06): the oven example's stated effect is a setting (added_capacity to extra_capacity), never only an influence; before it 4f1630c0…. r8c (fresh3 calculable 0/6; C1; PL 21:31 wording verbatim): a stated numerical effect of an option, a reported claim included, is represented numerically where supported, a range only where defensible; before it 18126d21…. r7d (stop-early faithful 6/9; R7G faithfulness taxonomy: Olumi additions inside a person record; PL 20:07 replacement verbatim) their record keeps only reasoning and qualifications they stated; before it 9c293350…. r7b (PL 19:18 BLOCK applied verbatim: an explicitly raised tentative option kept with its qualifier; supported causal paths followed through, gaps kept). r7 (Q3 G FAIL taxonomy, general classes A-F: paths followed through to an aim, decisive drivers in structure, first questions on the separating unknown, meaning and authorship kept, concrete alternatives, whole horizon, short labels); before it fa860cf8…. 28 Oct: Box 1b r6b (PL 17:54 BLOCK applied: typed unsized links and risks kept even when they withhold; a target binds a measure only where supported; unit "1" only for dimensionless). Before it 23e90409…: Box 1b r6 (Q3 dev on fcb885fa, traced: H04's balance left unknown though figured, H05's stated target with no measure; their reasoning stays theirs, names never strengthen, a unitless figure takes "1", a stated target is its measure, a figured measure is defined numerically with links in words kept off it and unsized forces stated as assumptions, links only between allowed kinds; the SPEC §3.0 withholding contract is unchanged); before it aa502237…. 28 Oct: Box 1b (Paul Q1: links in words by default, numbers only where real; PL 16:11/16:18 and Codex r3 corrections); before it 0caeb57f…. 27 Oct: round 3 (Paul approved): a stated loss to avoid is an aim; missing numbers stay on the causal path; questions by what could change feasibility or the comparison; the one-statement line is the schema's; before it bac3de97…. 27 Oct: round 2, the consolidation (DL): ten entries (the workflow, enrichment, temporal choices and question selection); field definitions are the schema's; before it 209824f6…. 27 Oct: round 1, the PL's candidate wording (DL): step 5 removed, the approximate-figure mark for rough figures, missing periods asked, the deciding driver on the path, benefits and harms apart, a share a fact, questions by what could change the comparison. 27 Oct: titles and coaching questions (Paul approved). 27 Oct: W1 + PL AMEND (no quota on Olumi's options; a risk in the structure only with a defensible mechanism; an unsizable chance stays unknown), think before writing (extract, widen, select, frame; ported from the benchmarked v202 prompt), carry on as now always an option, a risk's chance an estimate unless only they can know it (prompt test 27 Oct: carry-on 2/9 -> 8/8, Olumi options 7 -> 15). 27 Oct: W2, no "history is []" (history is the host's, never in the first draft's schema). 27 Oct: T3, a relative change's floor is −100 % (science on Paul's hiring Run), an estimated range is two-sided where plausible, a one-off amount happens once (a stock's start, never a per-period driver), a measure tracks the aim, a record of theirs holds only their words; the example's ads are a weekly spend into a 'spent' stock. // 25 Oct: alpha G21, the reach rule is the compiler's (at least one goal or limit, only when every goal has a measure)
    // 24 Oct (DL, DoD-G classes 12 and 4): an update returns only the records it changes or adds; the host merges them by id.
    // Round 2 (27 Oct): the quote sentence is gone; who asserted a record and its quote are the schema's (author, quote).
    // 28 Oct (Paul, blocking: "an update must never delete a figure you supplied"; the PL's sentence from db73db4f, alone):
    // a simplifying update keeps their figures, units, periods, quotes and origin; a deliberate retraction is still followed.
    // 28 Oct, Box 2 (Paul Q1/Q2, 28 Oct; DL contract 17:42, PL corrections 17:46): what a simplifying update keeps and may fold,
    // and Olumi's questions returned only when this change makes the saved ones out of date; each said once, in this order,
    // before the new-id sentence. Changed knowingly from 5cfd9f88… (the 28 Oct figures-kept sentence).
    // r10 (Paul 28 Oct, R1): a simplify never turns a calculation that reaches an aim or limit into words (that withholds its chance);
    // it drops only scaffolding the calculation does not use. Changed knowingly from the Box 2 "into links in words" clause.
    const BOX2 = ['When asked to simplify, keep every figure, aim, limit, quote, link in words and risk they gave, each measure of an aim or limit of theirs, and every relation their figures size; fold Olumi\'s own items that add nothing to understanding or challenge, re-express the records listed to remove in fewer records that keep all their consequential meaning, and drop switches, zeros or intermediate totals the calculation does not use; never turn a calculation that reaches an aim or limit into a link in words.',
      'Preserve supported numerical calculations and every consequential cause, condition, risk, uncertainty, disagreement and attribution, including Olumi\'s useful provisional reasoning; re-express rather than erase it.',
      // Box 3 rerun (28 Oct): Paul's "10 or fewer nodes" was met by cutting a figure-sized calculation and Olumi's pilot (simplify-noloss FAIL)
      'A size they ask for never outranks this: simplify as far as you can without losing any of it.',
      // 29 Oct 05:1xZ (J2 streamline on 4e1a9e3e: remove was [], so the update ADDED a summary claim beside everything): never.
      'When simplifying, re-expressing means fewer records carrying the same meaning, never a summary, overview or restatement added beside them; if nothing can go without losing any of it, change nothing.',
      'Return coaching_questions only when this change makes the saved ones out of date.'];
    for (const line of BOX2) expect(count(UPDATE_PREFIX, line), line).toBe(1);
    expect(UPDATE_PREFIX).toContain(`without losing their meaning or history. ${BOX2.join(' ')} A new item gets a new id.`);
    expect(UPDATE_PREFIX).not.toContain('where no real figure sizes it');
    expect(createHash('sha256').update(UPDATE_PREFIX, 'utf8').digest('hex')).toBe('c74d9e2e2bb1e5a5561d99142db8c5bb20c6f5b3a3a351c1a283f43d5212cb74'); // 29 Oct 06:0xZ: a simplify re-expresses the listed records in fewer (independent read 9dc669e1: fold-only forbade the merge remove now permits); 05:1xZ: never adds a summary (scoped to simplifying, PL 05:22); before it e5c48dfa. · 28 Oct: r10, a simplify never turns a calculation reaching an aim into words, and "I don't know" or "estimate it" takes Olumi's labelled estimate; before it f1230a2a…. 28 Oct: Box 3 rerun 2 (PL 20:52), a simplify keeps every aim they gave too; before it ec7f26c3…. 28 Oct: Box 3 rerun, a size they ask for never outranks keeping what they gave; before it ef207a98…. 28 Oct: Box 3 european-simplify (PL 19:24): a simplify keeps each measure of theirs and every relation their figures size; before it 9dbe0cf0….
    // Box 2: the update's strict output, as sent, carries Olumi's questions (null, or the whole new list); its identity, recorded.
    expect(createHash('sha256').update(JSON.stringify(UPDATE_JSON_SCHEMA), 'utf8').digest('hex')).toBe('d0842e13ced47671978ea3f0a9bf117d00656951b3af00ec4126b1d336442a0d'); // 29 Oct (PL 14:12Z): stated_time.said_on; before it 762f3dfb. · 29 Oct: stated time and decide-by (TIME-AND-DECIDE-BY design); before it ac3c1e46. · 28 Oct: r10, the quantity kind/status/basis descriptions (Olumi's labelled estimates); before it 8dfd7180…. 28 Oct: r9, option.sets description (a stated effect is a setting); before it 4a39183b…. // before Box 2: f84a5631…
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
    // ALPHA (the brief's five behaviours), each said once in what is sent. prompts-v2 (29 Oct): in agent-coaching.txt's words.
    for (const rule of [
      // 1. after a draft: what came from the brief, what Olumi added and what is left out; then the drafted questions, in order.
      'On a first model, briefly distinguish what came from the brief, what Olumi added, and what the calculation leaves out and why, when any material is excluded.',
      'Ask up to three useful unresolved coaching_questions in their saved order, using their exact wording and a brief purpose without claiming measured sensitivity.',
      'Use one plain headline and up to three short bullets, normally about 130 words; a first model may add its list of up to three questions. A requested script, email or draft is given in full, outside that length.',
      // 2. a chance as the Run records it, what it rests on, and one useful next step.
      "When chances are recorded and relevant to their question, lead with each option's chance of meeting the specified aim in this model; when none are, say once what withholds them, then answer their actual request.",
      'If current or engine_current is false, describe it as historical; do not claim a current comparison.',
      'Explain the premise the finding rests on and what could change it.',
      'Call an input quantitatively most influential only when that finding is supplied for the stated scope.',
      'Tie it to the named card, explain why it matters and end with a concrete evidence step or focused question.',
      // 3. edits in chat, only what they ask; a what-if is not an edit; labelled, ranged estimates when asked; no added overview.
      'An answer or explicit request to correct, add, remove or simplify authorizes a reviewed proposal for that change.',
      'Discussion, requests for ideas and hypothetical what-ifs authorize discussion; add ideas only when asked to add them.',
      'Bind answers to existing item ids; ask which item only if genuinely unclear.',
      'When asked to estimate or fill missing inputs, propose visibly Olumi, provisional estimates for needed situation figures, mechanisms, risk chances or severities where a reasonable basis and range exist.',
      "Never estimate the person's target, limit, budget, deadline or choice, or replace a supplied figure with your estimate.",
      'Never offer an added overview as the reduction.',
      "Use a saved change's returned Run without requesting another.",
      // 4. nothing calculable: what is missing, then the options compared in words from the saved model, with no invented result.
      "If chances are withheld, identify the missing premise or unsupported dependency, then compare each option's supporting and opposing paths from the saved model, including risks, disagreement and unknowns.",
      'Retain independently supported numerical findings.',
      'Say when figures alone cannot resolve the limitation; invent no result, evidence or ranking.',
      // 5. the product rules: never a recommendation; the most likely option only where the current Run licenses it.
      'Never say \u201crecommend\u201d, \u201cbest\u201d, \u201cwinner\u201d, \u201cyou should choose\u201d or \u201cgo with\u201d.',
    ]) expect(count(b, rule), rule.slice(0, 60)).toBe(1);
    // Round 1 (DL 27 Oct): the arithmetic-unblocking order is gone from the first-model questions.
    for (const old of ['the one that unblocks the most first', 'Only the questions that block a goal or a limit', 'the blocking ones first']) expect(b, old).not.toContain(old);
    // Kept from the old reply rule, each once: what the reply must report of saves and approvals, and the AIE's scope rule (K3).
    // prompts-v2 (29 Oct): in agent-coaching.txt's words.
    for (const kept of ['The person reads your words directly, so state material pending work and limitations plainly.',
      'Report saved, already saved, pending approval, refused, superseded and unknown from the actual outcome.', 'approving an addition does not change its author.',
      'If a save succeeded and later analysis failed, say both.', 'Keep a clearly separate situation out of this model.',
      'do not create one or replace this model automatically.'])
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
    // Round 2 (27 Oct, consolidation): the program instructions are the single Run-reporting owner; no tool description repeats
    // the Run rule or names its paths. prompts-v2 (29 Oct): RUN-GROUNDED COACHING, in agent-coaching.txt's words, each once.
    const RESULTS = "When chances are recorded and relevant to their question, lead with each option's chance of meeting the specified aim in this model; when none are, say once what withholds them, then answer their actual request. Keep the Run's target, horizon, conditions, exclusions, limits and unchecked limits where they change the meaning.";
    expect(count(b, RESULTS)).toBe(1);
    for (const path of ['current or engine_current', 'precision_95', 'coaching_questions']) expect(count(b, path), path).toBe(1);
    for (const [name, text] of Object.entries(d)) {
      expect(text, name).not.toContain('Report results only from the Run');
      for (const path of PATHS) expect(count(text, path), `${name}: ${path}`).toBe(0);
      // The paths S3 no longer emits (14:2xZ): no description names them.
      for (const gone of ['run.targets', 'run.notes', 'run.thresholds', 'thresholds[]', 'run.limits', 'run.unchecked_limits']) expect(text, `${name}: ${gone}`).not.toContain(gone);
      for (const banned of ['recommend', 'best', 'winner', 'you should', '18 to 22']) expect(text.toLowerCase(), `${name}: ${banned}`).not.toContain(banned);
    }
    // read_canonical_context returns the model (as authored), earlier_versions, blockers or open_questions and coaching, and run.
    // prompts-v2 (29 Oct): in tool-descriptions.txt's words; each blocker code says what the person supplies, a recount quoting
    // its reason without inventing a bound (Codex B1), an unknown never asked for its number.
    for (const field of ['Read the current saved model and revision, authorship, open inputs, stored Run with current/engine_current, and applicable cards awaiting approval.',
      'earlier_versions is a count, not the historical records.', "Use the returned model's ids for edits and its labels when speaking.",
      'A blocker names what prevents the affected result: asked needs its item answer; range_kind needs firm-versus-rough range meaning;',
      "recount needs clarification of the stated figure or Olumi's domain reading, quoting its reason without inventing a missing bound;",
      'unknown needs evidence or an activity that could size it, not another request for an unavailable number;',
      'measure, deadline and no_goal need the missing measure, horizon or aim.', 'Older Runs may return open_questions and coaching instead.',
      'Read only; nothing changes.']) expect(count(d.read_canonical_context, field), field).toBe(1);
    // Round 3 (27 Oct): a non-current Run is said in RESULTS, once; the read description no longer repeats it.
    expect(d.read_canonical_context).not.toContain('A Run that is not current describes an earlier model');
    // Targeted answers (DL 24 Oct): an answer in answers on its item's id; anything else in words, with the ids to remove, which
    // Olumi's drafter writes; no op set.
    for (const gone of ['set_quantity', 'set_range_kind', 'set_goal_target', 'add_option', 'rename_option', 'define_goal_measure', 'ops']) expect(d.propose_change, gone).not.toMatch(new RegExp(`\\b${gone}\\b`));
    // Strip (Paul 26 Oct; B5 removed): a figure answer in answers, a worded answer in request. prompts-v2 (29 Oct): in
    // tool-descriptions.txt's words: a settled figure in answers; dates, spans, measures, definitions and structure in request.
    for (const rule of ['Put numerical answers whose meaning is settled on existing figures in answers; put dates, spans, measures, definitions, unresolved ranges, new records and other structural edits in request.',
      'Route an answer needing a unit, time-field or relation change through request as well.', "Keep the person's exact source words distinct from Olumi's instruction.",
      'Supported Olumi estimates may be proposed when requested, with a basis and range; never estimate their target, limit, budget, deadline or choice.',
      'List every proposed removal in remove under its rules.', 'After a card exists, do not propose another this turn.',
      'If refused before any card exists, one corrected call may use the returned reason; never retry an unchanged request.',
      'It returns a card and its prospective Run; it saves nothing.']) expect(count(d.propose_change, rule), rule).toBe(1);
    // Round 2 (27 Oct, consolidation): the line repeating the attribution rule (the schema's) and the Run rule (RESULTS) is deleted,
    // its would_show sentence with it.
    expect(d.propose_change).not.toContain('never put an Olumi estimate in as theirs');
    expect(d.apply_change).toContain('Typed agreement is not card approval.');
    expect(d.apply_change).toContain('A successful outcome reports its receipt and saved Run; already_saved identifies the same prior save.');
    expect(d.run_analysis).toContain('Only on an explicit request to run: return the stored Run if it is current for the model and engine, otherwise calculate and store a new Run.');
    expect(d.run_analysis).toContain('A saved change already returns its Run.');
    // The descriptions ride the tool list, not the standing instructions (whose sent bytes the sha row above pins).
    expect(b).not.toContain(words);
  });

  it('the model-program drafter (DL 24 Oct): only their facts wait, link sizes stay Olumi\u2019s estimates, quotes are copied exactly, and an update keeps every option reaching every goal', () => {
    // Round 2 (27 Oct, consolidation): field definitions are the schema's (sent as the structured output), the workflow is the
    // prompt's ten entries. Each rule below is pinned where it now lives, once.
    const schemaText = JSON.stringify(CANONICAL_JSON_SCHEMA);
    for (const rule of [
      // r10 (Paul 28 Oct): a fact they did not give may be Olumi's labelled estimate; their target, limit or choice stays asked.
      'fact: a figure about their situation, including observed shares, mixes and allocations. coefficient: a causal response per unit of driver, still a coefficient when derived.',
      'Who named the measure: person, or olumi for a suggested measure; this does not change the aim\'s author.',
      'Null when the aim has no measure yet. A proposed release bar or other standard is an assumption or condition, never a substitute measure.',
      // Round 3 (27 Oct): events or tasks are context (the goal's own description); one statement, one record (the model's own).
      'never simultaneously a limit or preference. Events or tasks alone are context.',
      'One statement, one record across all families; never paraphrase it into another. Evidence and assumptions get separate records only for distinct statements.',
      'The input quantities this option changes and what it sets each to. Where the brief states the option\'s effect as a figure (staff or capacity it adds, a price, a cost), that effect is a setting here on the input it changes. [] only when no figure sizes what it changes, which then stays an influence link.',
      'What matters but is not in the calculation.',
      'The clarification or representable measure that would let this into the calculation, as one question; null when none would.',
      'A disagreement worth keeping visible. Never resolved by dropping it.',
      'The quantity giving the stock\'s level at period 0 (now), in the stock\'s unit.',
    ]) expect(count(schemaText, rule), rule).toBe(1);
    for (const rule of [
      // DL 24 Oct (blind score of 1510a008, mrr structure): an identity is a definition; a missing figure is asked on its item.
      // AIE 6386018855 §5 (DL 24 Oct): the capture-only clauses replaced, each permission once, attributed and grounded.
      // Candidate A: the update's own goal-or-limit rule is said once, in UPDATE_PREFIX (pinned below), which every update sends.
      // Box 1b (Q1, Paul 28 Oct): the model is their situation as a small influence diagram; the first-draft-only scope stays.
      'Draft ONE canonical model: their situation as a small influence diagram they could explain in a minute',
      'The steps below apply only to a first draft.',
      // Paul 26 Oct (1): no aim stated -> one provisional working aim of Olumi's, its target asked, never invented.
      'With no stated aim, offer ONE Olumi working aim supported by the brief for confirmation or change.',
      '2. Aim: retain every stated aim, including avoiding a stated loss.',
      // Paul 26 Oct (2) and (3): short neutral names, their words the quote; Olumi's lower-commitment options where they name none, one or only opposites.
      // Box 1b: carrying on as now is the declared carry_on option (Box 1a), never read from empty settings.
      // Box 1b r6 (dev H04: "cut the opening hours" named "Close"): an option's name never changes or strengthens what it does.
      '3. Options: retain every named option, named shortly in their terms without changing or strengthening what it does, and carrying on as now (carry_on true; false on every other option).',
      'With none, one, only two opposites, or an open request, add one or two materially different options, lower-commitment where useful, each a concrete course with its own commitment or mechanism, as an Olumi option, never left in prose or only a variant of carrying on; for allocations, offer feasible divisions.', // r7 (28 Oct): concrete alternatives (G taxonomy class E)
      // Box 1b: the example's Olumi option changes what it changes in words, with no invented spend (PL 16:11/16:18).
      // r10 (Paul 28 Oct, reversing the line above for the example): Olumi's option acts through Olumi's labelled, ranged estimate
      // of what it adds, so it is compared; the staff doubt is a prerequisite beside it (a link in words from it would withhold it).
      'option "Longer baking hours", olumi (lower-commitment): sets [added_capacity to hours_capacity], with a condition, olumi, prerequisite "only if staff can cover the longer hours"',
      // AMEND (DL 24 Oct, blind score of #3735): a lever only the options set, and a whole, are structure; a stated limit stays a limit.
      // Codex buddy AMEND (26 Oct): one statement, one record. Round 3 (27 Oct): said once, in the sent schema (pinned above).
      // DL 24 Oct: the one worked example shows the proposing half once (an aim with no measure, Olumi's suggested measure).
      'goal "to grow the bakery", measure_by olumi (a suggested measure): sales change_abs from base_sales >= grow_target, end, window null,',
      // Codex BLOCK on #3735: the exclusion is Olumi's reading, marked as canonical.ts attribution requires.
      'exclusions: left_out "growth beyond loaf sales, such as new lines", why "not in this model", author olumi, quote null',
      // DL 24 Oct (P7 hiring blind score, classes 2 and 4): a stated threshold is theirs; a goal against today is relative to today.
      // Buddy 24 Oct 08:48Z (accepted): the frame follows their words, as canonical.ts GOAL_FRAMES and compile.lowerChange do.
      // DL 24 Oct (milestone blind score, effects-not-estimated): a range is defensible when its order of magnitude is knowable.
      // Buddy 24 Oct 08:17Z (accepted): capacity is not output.
      // DL 24 Oct (with S3's issue 39): an unsized link's direction goes in direction; one with no direction anyone can give is a note.
      // Box 1b: no switch in the example; the second oven's effect and its budget fit are links in words (PL 16:18, Codex r3).
      // r10 (Paul 28 Oct, reversing the line above for the example): the budget fit is arithmetic on Olumi's estimated oven price
      // (spend, set by the option), so the limit's chance is worked out; the reading of the £5,000 is Olumi's applied assumption.
      'limit "without going over budget": spend <= budget, end, window null; assumption, olumi, applied: "the £5,000 is for the oven alone"',
      'oven_price GBP fact estimated 4000 (2000–9000), olumi, basis "typical for a small deck oven, used to new"',
    ]) expect(count(DRAFTING_INSTRUCTIONS, rule), rule).toBe(1);
    // Round 1 (27 Oct, the PL's candidate wording, adopted by the DL): seven bullets replaced and step 5 removed. Each successor
    // rule is sent once, and every replaced sentence above is gone. Two earlier rulings are REVERSED by the candidate, not kept:
    // an option-only setting's starting level and a current share are now asked, never 0 by default (DL AMEND 24 Oct); and a
    // relative goal with no figure for today no longer assumes today is 1 with carrying on keeping it there (buddy 24 Oct).
    // Round 2 (27 Oct, consolidation): the successor rules, where each now lives (the schema, as sent, or the shortened steps).
    for (const rule of [
      'Olumi\'s proposed option settings are olumi, even when to names the person\'s figure.',
      // E2 (28 Oct, dq-round4 dev gate PASS 136/169, 23/27, 9/9; Paul 01:07Z: authorship at the producer): a structural author
      // only for a necessary exact constant; who introduced the content is said once, shared with every record.
      'structure only for necessary exact mathematical constants, with one known figure and no range.',
      'A condition the plan must not break. A person-stated limit has author person and their quote on this record; an added reading of its measure or timing belongs in separately attributed supporting records, never changing who introduced the limit.',
      'Zero may encode no additional activity, never an unstated current level or share.',
      'coefficient: a causal response per unit of driver, still a coefficient when derived.', // r10: its estimate rule moved to the status description
      `For a person's approximate single figure, exactly: \\"${APPROXIMATE_FIGURE}\\".`,
      'required for an approximate point, whose basis an inline setting cannot hold.',
    ]) expect(count(schemaText, rule), rule).toBe(1);
    // Who asserted a record and its quote: one attribution, shared by every record schema (a goal's and a claim's, as sent).
    const attr = CANONICAL_JSON_SCHEMA as { properties: Record<string, { items: { properties: Record<string, { description?: string }> } }> };
    for (const family of ['goals', 'claims']) {
      expect(attr.properties[family]!.items.properties['author']!.description, family).toBe('Who introduced this content: person for their quoted words, including uncertainty or a question; olumi for Olumi additions or readings. Keep added interpretation separate. Status alone never determines origin; party names a reported speaker.');
      expect(attr.properties[family]!.items.properties['quote']!.description, family).toBe('One unbroken verbatim span supporting the person\'s content, including their stated uncertainty or question. Null for Olumi\'s content.');
    }
    expect(schemaText).toContain('An approximate single figure is known with its stated value, low/high/range_kind null and the approximate basis; never manufacture endpoints from about, roughly or ~.');
    for (const rule of [
      'turn a stated amount into an unsupported rate',
      // Box 1b (Q1, Paul 28 Oct): questions are step 7; the causal-path step is now links in words from cause to effect.
      '7. Unknowns and questions: confirm an ambiguous or suggested aim, measure or reference;',
      // r10 (Paul 28 Oct, negate bias): a question about Olumi's estimate never quotes it, so it does not anchor their answer.
      'Ask for evidence, not invented effects or probabilities; a question about an Olumi estimate asks for their figure without quoting Olumi\'s, so it does not anchor them; never re-ask supplied information.',
      'Ask for a range when a supplied approximate point feeds a goal or limit.',
      // r10 (Paul 28 Oct, R1): arithmetic to the aim first; a link in words only where no figure could sensibly size the effect.
      'A link in words (an influence, with a direction, how sure it is and its basis in plain words) only where no figure could sensibly size the effect, such as reputation, morale or a relationship',
      'write it with definitions or stocks all the way to the quantity each aim or limit measures, every input theirs, Olumi\'s estimate or asked, so its chance can be worked out;',
      'Link each live option to the aims or limits it plausibly affects; never add a link merely to connect.',
      'omit only what does not, or an unrepresentable mechanism or measure, saying why and what would enable it.',
      // r11 (r10 stop-early: a stated date and every option start were asked, so no chance appeared; PL 00:11: an option or risk
      // start may be ranged, a window needs one whole count; PL 00:37: no tuning-brief cue in the prompt, and a season's calendar
      // convention is Olumi's, to confirm). Changed knowingly from "Ask missing durations wherever representable".
      // 29 Oct: stated time and decide-by (TIME-AND-DECIDE-BY design); before it "A date they state is Olumi's reading of it in whole periods from now: known, author olumi, …".
      'A date or length of time they state goes in its counting quantity\'s stated_time exactly as you read it (a date as YYYY-MM-DD, a span in its own unit); Olumi counts it in periods, so never compute periods from a date. For a season or holiday, name the calendar convention you read in its basis, with a question asking them to confirm. Never ask for a length their date already gives. A date they give for when they must decide goes in decide_by. A start time they do not give is Olumi\'s estimate, a range where uncertain, only where a supported deadline, window or time-dependent mechanism needs it. For an actually static level with no deadline, compare options conditional on their changes being in effect (0 is this comparison frame, not a physical start); preserve stated or model-supported delayed and dynamic effects, and name a missing horizon when they require one. A deadline they never gave stays asked.',
      // 29 Oct 03:2xZ (assessor AR0300 1; PL 03:22 exact wording): only an actually static level is compared with changes in effect.
      // 29 Oct (J1 capacity on 4e1a9e3e: an unstated start became Olumi's 4-week estimate, so a level goal they said has no
      // deadline became timed and its chance was withheld): an unstated start is Olumi's only where an aim has a deadline or
      // window; with no deadline the options are compared in effect (compile.ts measureChecks: a static level is read at
      // period 0 with every option's change in effect). Changed knowingly.
      // r11 (r10: a rough figure of theirs was re-authored as Olumi's estimate): their figure stays theirs, with its qualifier.
      'A figure they gave, even a rough figure, a share or a range, stays theirs as they gave it, with its qualifier; Olumi\'s estimate is only for a figure they did not give.',
    ]) expect(count(DRAFTING_INSTRUCTIONS, rule), rule).toBe(1);
    // r11 (PL 00:37): no cue copied from a tuning brief, and no universal stopping-risk rule, is sent.
    for (const cue of ['£1.1m', '£6,500', 'probably a third', 'by Easter', 'by the summer', 'a refused permission']) expect(DRAFTING_INSTRUCTIONS, cue).not.toContain(cue);
    for (const old of [
      'its quote is their words copied exactly, one unbroken stretch, never reworded or joined.',
      'Never ask them for a link\'s size or an option\'s effect.',
      'Mechanism: each option reaches, through relations from what it sets, at least one measured goal or limit it plausibly affects, never a link added only to connect it; a quantity that is by definition a product or sum of others is a definition, never an effect; each other link is sized by their coefficient or Olumi\'s estimate.',
      'What Olumi adds is author "olumi", quote null, never presented as theirs.',
      'Model the main reason each option could succeed and the main reason it could fail.',
      'Every driver, constraint and current state they mention feeds the calculation or the record that fits it.',
      'Where the brief leaves out a driver, countereffect, side effect or risk that is plausible and could change the result, add it as Olumi\'s hypothesis (author olumi, with a basis and its direction); plausibility alone never justifies a figure, so size it like any other link.',
      'Only what is materially useful: no quota, nothing merely conceivable.',
      'So are the starting level of a setting only the options change, when they gave none (0, an Olumi division\'s share included), and a whole such as 100 %: never asked.',
      'the reply asks at most three, and every other missing fact stays asked on its item.',
      'Every figure a goal or limit rests on stays in, and a threshold they state is theirs, never Olumi\'s unknown ("no worse" is today\'s level).',
      'A goal\'s frame follows their words: a change stated as a percentage or share ("8 % more") is change_rel from now, and where they give no figure for today, today is 1, carrying on keeps it there (an assumption) and each effect is a proportional change, so today\'s level is not asked;',
      'a change stated in units ("12 more parcels a day than now") is change_abs in those units; a target stated as a level stays a level.',
      'A level the result does need is their fact, asked as a recent measured figure ("last month\'s"), saying how they could measure it.',
      'A link or effect (an option\'s added effect included) is theirs or, by default, Olumi\'s provisional estimate with a defensible range in natural units and a plain basis.',
      'A range is defensible when general knowledge of how such things work gives its order of magnitude, however wide the span (a second matched, staffed van roughly doubles available vehicle capacity, give or take; completed deliveries also depend on demand and other bottlenecks).',
      'Only an effect with no knowable scale keeps its size unknown, its direction in direction (raises or lowers) and what would size it in its basis; an effect whose direction no one can say is a note, not a link. Never force a number to get a chance.',
      '5. Check, before writing each record of theirs', 'a rough figure stays a range', 'A figure they give as approximate is a plausible range around it',
      // Round 3 (27 Oct): the replaced wording; a missing fact's status and its one question are the schema's (fact, asked, question).
      'code calculates results', 'events or tasks remain context', 'within binding constraints', 'even when unsized, rather than prose or an aggregate effect',
      'add only mechanisms that could change the comparison', 'using the schema\'s forms and uncertainty rules', 'first settle an ambiguous aim', 'ahead of arithmetic-only inputs',
      'Ask for observable evidence', 'Keep every missing fact open', 'Keep one statement in one record',
    ]) expect(DRAFTING_INSTRUCTIONS, old).not.toContain(old);
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
      // DL 24 Oct (class 12): an answer is entered on the item it answers; a figure read from words says so in its basis.
      'Each answer goes on the item whose question it answers (a question about one option, on that option\'s item);',
      'words that settle a figure (yes, no, all, none) are that figure, quoting them, its basis saying how they were read.',
      'Never keep an answer unassigned and ask it again.',
      // DL 24 Oct (class 12 remainder): "I don't know" is an answer; the item stays open with a new question.
      // r10 (Paul 28 Oct): with no figure from them, Olumi's labelled estimate takes its place where a reasonable range exists.
      '"I don\'t know" is an answer too: give Olumi\'s estimate in its place by the first draft\'s rules where a reasonable range exists, otherwise the item stays open, its question changed to ask for what would size it.',
      'When they ask Olumi to estimate, give Olumi\'s estimates by those rules, never as theirs.',
      // 28 Oct (Paul, European test: "drastically streamline" turned his 400 customers and 3 % churn into notes): kept, said once.
      'Keep supplied figures, units, periods, quotes and origin, including when simplifying; follow deliberate corrections, retractions or approved representation changes without losing their meaning or history.']) expect(count(UPDATE_PREFIX, rule), rule).toBe(1);
    // Round 2 (27 Oct, consolidation): the update's quote sentence is gone; who asserted a record and its quote are the schema's.
    expect(UPDATE_PREFIX).not.toContain('A figure of theirs quotes their words copied exactly');
    // The whole-model update is gone: from the update's text and from its repair turn.
    for (const old of ['WHOLE model', 'Keep every record, with its id, exactly as it is', 'Leave out only the ids listed', 'Keep the history as it is.', 'a goal this change adds included', 'Every option reaches every measured goal'])
      expect(`${UPDATE_PREFIX}${UPDATE_REPAIR_PREFIX}`, old).not.toContain(old);
    expect(count(UPDATE_REPAIR_PREFIX, 'Return all your changes again with them fixed, by the same rules: only the records you change or add, each in full with its id, and the removals.')).toBe(1);
    // prompts-v2 (29 Oct, INTEGRATION §5): the program turn's guidance is facts only (pinned as sent in core-turn.route); where
    // an answer goes is propose_change's own description (above), and an "I don't know" is an answer's unknown status.
    expect(programTurnFacts('continuation', { awaiting_approval: [{ proposal_id: 'p1' }] }, { challenge: true }))
      .toBe(`${PROGRAM_TURN_FACTS_PREFIX}{"trigger":"continuation","reading_card":false,"held_proposals":["p1"],"requested_challenge":true}`);
    expect(programTurnFacts('run_press', undefined)).toBe(`${PROGRAM_TURN_FACTS_PREFIX}{"trigger":"run_press","reading_card":false,"held_proposals":null}`);
    for (const instruction of ['propose_change', 'answers', 'Reply', 'once']) expect(programTurnFacts('first_model', { awaiting_approval: [] }, { readingCard: true })).not.toContain(instruction);
    for (const old of ['If only its direction can be defended', 'uncertainty alone is not a reason to withhold', 'what they expect without the options included', 'roughly doubles daily deliveries',
      'A goal or limit stated against today is relative to today']) expect(DRAFTING_INSTRUCTIONS, old).not.toContain(old);
    // Buddy 08:48Z: a level target and a change in units are never turned into a ratio. Round 1 (27 Oct): the prompt's frame
    // clauses are gone with the old Questions bullet (the schema's frame descriptions say level, change_abs and change_rel), so
    // no sentence of the prompt sets today to 1 or makes effects proportional, for any frame.
    for (const ratio of ['today is 1', 'proportional', 'relative to today']) expect(DRAFTING_INSTRUCTIONS, ratio).not.toContain(ratio);
    const sentFrame = (CANONICAL_JSON_SCHEMA as { properties: { goals: { items: { properties: { measure: { anyOf: { properties?: { frame?: { description: string } } }[] } } } } } })
      .properties.goals.items.properties.measure.anyOf.find((s) => s.properties?.frame)!.properties!.frame!.description;
    for (const frame of ['level: the quantity itself reaches the target', 'change_abs: its change from the reference, in its own unit', 'change_rel: its change from the reference as a fraction of the reference'])
      expect(count(sentFrame, frame), frame).toBe(1);
    expect(Object.keys(programDraft)).not.toContain('UPDATE_PREFIX');
    // The schema is prompt text too (sent on every drafting call): `unknown` only where nothing rests on it (served funding dead end).
    const sentSchema = JSON.stringify(CANONICAL_JSON_SCHEMA);
    // Round 2 (27 Oct, consolidation): the status meanings in one sentence each.
    // r10 (Paul 28 Oct): unknown only when no reasonable range exists even from what is typical (Olumi's estimate otherwise).
    expect(count(sentSchema, 'unknown: no reasonable range yet, even from what is typical, every figure null.')).toBe(1);
    expect(sentSchema).not.toContain('unknown: no defensible numerical range yet');
    expect(sentSchema).not.toContain('unknown: it matters, but no defensible range can be given yet');
    // Issue 39 (DL 24 Oct): an unsized link's direction has its own field, said once as sent.
    expect(count(sentSchema, 'For a link\'s size (a coefficient), used only when no figure is given (no most likely figure, and no range or one that spans zero): raises when more of the driver means more of what it moves, lowers when it means less; null when no one can say which. Null for every other quantity.')).toBe(1);
    // Neither the old open-ended text nor a rule that forces an estimate (buddy science BLOCK, 24 Oct) is sent.
    // Nor an open-ended unknown, a rule that forces an estimate, or one that makes unknown a link's default (1510a008: 50 links unknown).
    // r5 (buddy, accepted): never numerical bounds demanded where only a direction is defensible (r4's "order of magnitude").
    // AIE §5: the schema says the same as the prompt: a suggested measure where one can track the aim. Round 2 (27 Oct, consolidation):
    // the four array descriptions (goals, limits, preferences, options) are gone; their procedures are the prompt's steps 2 and 3
    // (pinned above) and each record schema keeps its own definition.
    for (const rule of ['Null when the aim has no measure yet. A proposed release bar or other standard is an assumption or condition, never a substitute measure.', 'or olumi for a suggested measure; this does not change the aim\'s author.',
      // The sent schema is JSON text, so its double quotes arrive escaped: pin the clause after the example name.
      'A short neutral name (\\"Second oven\\").'])
      expect(count(sentSchema, rule), rule).toBe(1);
    // Round 3 (27 Oct): who quotes is the shared quote field's (pinned above, per family); the per-field repeats are gone.
    for (const old of ['own words stay in quote', 'keeps their own words in quote', 'olumi, quote null', 'VALID, reported as not covered', 'the question stays the one plain sentence', 'valid and excluded from the chance'])
      expect(sentSchema, old).not.toContain(old);
    for (const old of ['Never invent a measure', 'An aim with no measure is valid; never invent one']) expect(sentSchema, old).not.toContain(old);
    // 27 Oct (Paul, approved): the sent schema names a short title for the situation and for each goal, limit and risk card (their
    // words stay in quote), and Olumi's coaching questions, at most three; a goal's or limit's label is no longer their own words.
    // Round 2 (27 Oct, consolidation): the coaching questions are the ordered first-screen questions, which may use an item's question.
    const sent = CANONICAL_JSON_SCHEMA as { properties: Record<string, { description?: string; items?: { properties: Record<string, { description: string }> } }> };
    expect(Object.keys(sent.properties)).toEqual(expect.arrayContaining(['title', 'coaching_questions']));
    expect(sent.properties['title']!.description).toContain('A short title of a few words for the situation');
    expect(sent.properties['coaching_questions']!.description).toBe('Ordered first-screen questions, up to three, each plain, non-leading, open and asking one thing; a selected item question uses its exact wording. [] when none would help.');
    for (const f of ['goals', 'limits', 'preferences', 'options']) expect(sent.properties[f]!.description, f).toBeUndefined();
    expect(['goals', 'limits', 'risks'].map((f) => sent.properties[f]!.items!.properties['label']!.description.startsWith('A short title of a few words for '))).toEqual([true, true, true]);
    for (const old of ['The aim in the person\'s own words', 'The condition in the person\'s own words']) expect(sentSchema, old).not.toContain(old);
    // Contrast: an option's name is a short neutral name; their words are in the shared quote field (round 3).
    expect(sent.properties['options']!.items!.properties['label']!.description).toBe('A short neutral name ("Second oven").');
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
    // Round 2 (27 Oct, consolidation): the still-open questions are asked in the same order on later turns. prompts-v2 (29 Oct):
    // a continuation refreshes against current state, one useful question at most, never re-asking what they supplied.
    const question = 'On continuations refresh against current state and ask at most one useful question; never re-ask supplied information, including a span implied by a stated date.';
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
