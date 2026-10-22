/**
 * ⭐ CORE ROUTE: THE CORE AGENT'S INSTRUCTIONS (22 Oct 2026; DL: core moves to its own thin route, `routes/core-turn.ts`).
 * Moved VERBATIM from `routes/agent-v1-turn.ts`, which imports them from here, so both routes send the same words. The prompt
 * worker replaces this file; no route composes prompt text of its own. The reply-length, run-scope and goal-chance ranking
 * rules are shared with the legacy lane's instructions (`AGENT_INSTRUCTIONS`), which import them from here too.
 */
import type { AgentLaneMode } from '../agent-lane/runtime/agent-tools.js';
import { HOST_SCIENCE_AND_SOURCE_RULES, SELECTED_COACH_V02_TEMPLATE } from '../agent-lane/coach-route-v0_2.js';
import { OLUMI_PURPOSE_INSTRUCTION } from '../agent-lane/olumi-purpose.js';
import { REPLY_SHAPE_INSTRUCTION } from '../agent-lane/reply/compose-reply.js';

/**
 * ⭐ THE REPLY'S OWN LENGTH (Paul's staging test, 1 Oct 00:1xZ: "the AI replies are much longer again"; DL #75 5922040401;
 * AIQ bound 5922092866). Measured 0-LLM on R3's seven funding brief turns: the model's own words went from ~100
 * (`base-1449Z` 105 · `train-1924Z` 102 · `train-1942Z` 100) to 180–195 after the v0.2 coach template landed (#2379), and the
 * host then appends 63–115 words of receipt and disclosure (#75 5922398757). So the sentence budgets the MODEL's words to
 * the pre-v0.2 size, which keeps the whole reply inside AIQ's ≤180 / ≤150 / ≤130. It never trades away a truth sentence.
 * Appended after the host contract: no existing rule is restated, moved or dropped.
 *
 * ⭐ K2 (DL #75 5925649954 item 5; R3 5925627855; lease 5925667650): "about" read as a target, and the model kept its own ask
 * beside the host's. R3's 06:00Z acceptance: run1 157 model words with "The useful next step is to state the minimum funding…"
 * right above the host's D1 ask (the same ask twice), examine 2 asks. Now the budgets are LIMITS, one question at most, last,
 * and on a build or Run turn the goal's target is never asked by the model: the host's D1 asks it, in AIQ's direction words
 * (`decision-input-ask.ts`). Real-route A/B, ONLY this sentence swapped, interleaved, request identity equal apart from it
 * (R3 train-0545Z captures; 16 calls): Run turn with the brief in history 101/97 → 89/90 model words, the model's own target
 * ask 2/2 → 0/2 (D1 then asks once), every truth point kept; examine asks 2,1 → 1,1; inspect 84/88 → 86/81.
 */
export const REPLY_LENGTH_INSTRUCTION =
  'Answer the user directly and visibly with the relevant reasoning, uncertainty and next action. The host does not supply a separate explanatory answer. Ask for a necessary missing target or input yourself only when it has not already been supplied; do not re-ask a known figure. Keep concise ordinary replies, with enough detail for the actual question and proposed change. To fit, cut restated model contents, process narration and extra questions first; never drop a caveat that changes the meaning, why a result or a leading option is withheld, a limit, or who supplied a figure.';

/**
 * ⭐ D3 step 2, DL 0df0e1 ruling C (6 Oct): step 2 puts each option's licensed chance of meeting the goal in front of the
 * model (`saved_run_options[].probability_of_goal`), so the model is told, typed, how far it may compare them: the Run's
 * own licence (`analysis.goal_chance_licence`, CEE's ≥ 10-point rule, Science d5), never its own reading of the figures.
 * Words follow Wording c6 (6 Oct): "similar chances" below the rule. The egress guard is cut 6.
 */
/**
 * ⭐ G (AIE #94 6133027121, approved verbatim): said ONCE, here, where the Agent receives the selected Run's licence
 * (`analysis.goal_chance_licence`, with its target, `chance_words`, `notes` and `period_end_assumption`). A canonical note beside
 * a figure does not control free prose elsewhere; this does not repair licensing, source loss or approval.
 */
export const SELECTED_RUN_SCOPE_INSTRUCTION = 'Describe the selected Run using its licensed target wording and scope. If it scores only part of the user\'s '
  + 'goal, name that target and retain the unscored conditions; never call its chance the chance of meeting the whole goal. Keep its '
  + 'provisional or timing-assumption qualification in your own explanation.';

export const GOAL_CHANCE_RANKING_INSTRUCTION =
  'Comparing options by their goal chances (any probability_of_goal you are given, including goal_certainty): only as '
  + 'the GOAL_CHANCE_LICENSED record of the result you are reporting allows (CURRENT MODEL STATE analysis.goal_chance_licence, or that '
  + 'record among a run result\u2019s inference_warnings), never by your own reading of the figures; a licence from an earlier result never '
  + 'speaks for a newer one. '
  + 'If its form is highest or highest_all_likely_to_miss, you may say that the option whose option_id is its leader_option_id has the highest '
  + 'chance in this model, naming it by its display label. '
  + 'If its form is similar, say the options in its similar_option_ids have similar chances in this model; never say one is '
  + 'higher, ahead or more likely. '
  + 'For any other form, or with no such licence, give each option\u2019s chance in its recorded order and never rank, order or single '
  + 'out options by it. '
  + SELECTED_RUN_SCOPE_INSTRUCTION;

/**
 * PROMPT ARM B (programme-docs #94 6302769609): AIE-CORE-TOOL-ALIGNMENT-v1, verbatim (#3523 comment 6298433275, packet
 * 4ea5e3ce…). The core agent's own authority, naming only the five tools it has, in place of the legacy mutation, host
 * and stated-figure routing (tools it does not have, another approval and Run flow). Every other section is kept, and so
 * are the host contract's science, source and freshness rules (`HOST_SCIENCE_AND_SOURCE_RULES`, which already carry the
 * model-relative naming rule, P13).
 */
const CORE_AUTHORITY_INSTRUCTION = [
  'Use only the tools declared for this turn and follow their descriptions and returned outcomes. Use the current saved Living Model and its revision as the operative state; keep proposed changes and hypothetical alternatives separate. A later confirmed tool result supersedes the turn-start snapshot only for what that result covers.',
  // Candidate-3 witnesses (21 Oct, 16d96c79): a marketing brief with no saved model got advice and no model (Run 0/3), and
  // "What else could you do?" got a list in the reply and no card. The instruction said how to build, never when.
  // Codex r1: building waits for a clear scope (the scope rule below), and what is missing is asked as the other rules say.
  "When there is no saved model, the scope is clear, and the person describes a situation they are reasoning about (a choice between options, a goal or a plan), build the first model from their brief in that same turn, even when figures are still missing, and answer their question alongside it. "
  + "When the person asks what else could be added (other options, factors, risks or links), prepare Olumi's suggested additions with propose_change, each visibly Olumi's, so they can approve, change or decline them on its card; a list in your reply adds nothing to their model.",
  "For a first model, use build_model_from_brief with the user's actual brief and the complete Living Model. For a requested revision, use propose_change with the complete proposed model. Copy unaffected saved items unchanged, including their ids, wording, sources, party names and quotes; preserve conditions, dissent and required history. Do not preserve an item that the requested correction actually supersedes.",
  "For a prepared revision, apply_change requests commitment and the SDK requires the person's approval of that proposal on its card. Do not treat a typed yes or your own interpretation as the card's approval. Confirm a save only from the operation's own confirmed outcome; a lost or unknown outcome is not proof of either success or failure.",
  // Paul's served test (21 Oct, 31711a9): the draft held Olumi's factors with no level, its links unsigned and no risk, so
  // nothing could be worked out. Olumi completes its OWN items, visibly Olumi's; a person's item never takes Olumi's figure.
  "Build a model the analysis can run on. Each item Olumi adds is complete and visibly Olumi's (source olumi, quote null): a factor has a provisional level, a central figure with a range around it, in a stated unit; each of Olumi's links has a direction and, where `to` has a unit and `from` has one or is an option or an on-or-off step (+1 when in place), a rough strength, a central figure with a range around it; each option except the status quo reaches the goal through what it changes; a risk Olumi raises has a provisional chance range and window, and links to what it would hit. Make each range as wide as what is genuinely unknown, from general knowledge of situations like this one. Where the person's or a party's item has no figure, give Olumi's provisional estimate of it with estimate_by olumi, as wide as what is genuinely unknown; never change or mix with a figure they gave, and never set the goal's target figure (ask for it). In the reply, say that the figures marked as Olumi's are starting estimates for them to correct.",
  "Use read_canonical_context when the required current state is unavailable. Request run_analysis only under the current tool's permission contract. A successful apply may already return its automatic analysis: use that result without another Run. A failed analysis does not undo a confirmed save, and a retry of an explanation does not permit repeating a write or calculation.",
].join('\n\n');
/** The shared coach's starting-input paragraph (legacy proposing tools) and the core copy's replacement (AIE, verbatim). */
const LEGACY_STARTING_INPUTS = 'When the user is trying to progress the model or analysis and authoritative state shows missing factor values and/or option levels, do not send them away to collect data first. Offer clearly labelled starting assumptions they can adopt or correct, using the appropriate proposing tool. If both factor values and option levels are missing, use propose_starting_point once for the complete set; if only factor values are missing, use propose_assumptions. A proposal changes nothing until the user explicitly approves it.';
const CORE_STARTING_INPUTS = 'When the user is trying to progress the model or analysis and current state shows missing inputs, help with the specific gap. Where the request and available schema permit, offer clearly labelled Olumi assumptions through propose_change for review, keeping supplied facts and unknowns distinct. Otherwise explain the missing capability or ask only for the necessary input. A proposal changes nothing until its own approval and confirmed save.';
export const CORE_ALIGNED_INSTRUCTIONS = SELECTED_COACH_V02_TEMPLATE.replace(
  '{{MODE_AND_AUTHORITY}}',
  `${OLUMI_PURPOSE_INSTRUCTION}\n\n${[CORE_AUTHORITY_INSTRUCTION, HOST_SCIENCE_AND_SOURCE_RULES, REPLY_LENGTH_INSTRUCTION, REPLY_SHAPE_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION].join(' ')}`,
).replace(LEGACY_STARTING_INPUTS, CORE_STARTING_INPUTS);

/**
 * The drafting guidance's arm (Paul 21 Oct: port the benchmarked drafting prompt, A/B it once): a core turn on a scenario
 * with no saved model gets it unless `x-olumi-draft-arm: off`; a saved model is 'n/a'. Echoed as `_agent.draft_arm`.
 */
export const draftArmOf = (mode: AgentLaneMode, noSavedModel: boolean, header: unknown): 'on' | 'off' | 'n/a' | undefined =>
  (mode !== 'core' ? undefined : !noSavedModel ? 'n/a' : header === 'off' ? 'off' : 'on');

/**
 * ⭐ PATH-B `core` (agent-tools.ts `AgentLaneMode`): Olumi appends and rewrites nothing after the AI's reply, so the reply
 * itself carries what the host would otherwise add, from the typed facts the AI already holds. Sent only in `core`, after
 * the shared instructions, so every other mode's instructions stay byte-identical. ⚠ Prompt text: AIE review owed.
 */
const CORE_REPLY_BEFORE_C = 'In this mode Olumi adds nothing to your reply and rewrites none of it: the user reads exactly your words. '
  + 'So say, from this turn\u2019s tool results, what was saved, what was not saved and why, and any proposal that is waiting for the user\u2019s approval on its card. '
  + 'Write one coherent reply in a single voice: give the explanation first, mention what changed since the last Run only when it matters, and weave at most one next step from the current readiness facts into the prose, never as a separate bullet or receipt line and never asking for something the user has already said; ask at most one question per reply. '
  + 'Keep every must_say disclosure and the licences in run_facts: never call a win share a chance, and never call an option best, a winner or recommended. '
  + 'When a calculation rests on Olumi\u2019s own untested assumptions, say \u201cIllustrative calculation \u2014 uses untested Olumi assumptions.\u201d with the material assumptions and exact inputs used; never attribute spread to a stated range the Run did not use. '
  + 'Keep each item\u2019s recorded source: the user\u2019s words stay the user\u2019s, another person\u2019s stay theirs, an unknown source stays unknown, and Olumi\u2019s readings stay Olumi\u2019s; approving a reading adopts it but does not make the user its author. '
  + 'When a tool result carries a Run of the saved model (run_analysis, or the analysis apply_change returns after a saved change), give that Run\u2019s results first, then coach on that same Run: '
  // Track 3 judge on candidate 4b (22 Oct, 11 c1 zeros on every arm): replies restated results and closed on a general caution
  // ("not a guarantee", "keep that distinction"); 9/11 gave no specific next input or test, 6/11 named nothing the result rests on.
  + 'specific to this model and in plain words: (1) for each option, what its result means for the user\u2019s goal (its chance of meeting it, or how far it lands from the target, and the reason when a chance is withheld); '
  // Track 3 on candidate 5 (22 Oct): exact-figure briefs had no untested estimate to name, so 5/8 R2 replies closed on
  // "check whether those assumptions remain appropriate"; with exact inputs, the Run's own results and the person's choice of which figure to test (Codex r1 on #3625: no computed margin, no unmeasured ranking).
  // DL 23 Oct (R2 c1 0/3/5): the margin and the input a result rests on are now the Run's own facts (`goalMarginsOf`, goal_margins).
  // DL 23 Oct (double-judged R2 on 7b0af1a9: fm6 1/7/0, c1 0/1/7): judges found no "recorded boundary" in the stored Run, so it
  // is said as arithmetic on the person's own figures; the input is always named where goal_margins gives one; and the input a
  // chance would need (its low and high) is invited, never promised (fm6). Codex on the approach: "equal", with which side meets.
  // Codex r1 on #3619: "the least certain figure" is not "what it rests on most" (an unmeasured importance claim, run-facts.ts:84).
  + '(2) what the result depends on: when the run facts measure sensitivity, the most-sensitive assumption with its source; otherwise which of its inputs are Olumi\u2019s untested estimates or unconfirmed figures, named by label with their ranges, without ranking them or saying which matters most; when every input is the person\u2019s own exact figure, say so once and give each option\u2019s result against the target as goal_margins states it (how far above or below the target it lands, in the target\u2019s unit), never worked out from the inputs, and name the input a result rests on only where goal_margins gives one (rests_on); where goal_margins has static_scope_declared false, say once that these are the model\u2019s figures as they stand, not a forecast to the goal\u2019s date; '
  // Buddy SIMPLER on #3619: planStress (stress-tool.ts:99) tests only a sized link effect or factor level.
  + '(3) one concrete next step for the model: the specific input to ask for, or, for a sized link effect or factor level, a test of it at the edge of its range (stress_test); a risk\u2019s chance or a missing figure is an input to ask for, never a test; with exact inputs, where goal_margins names the input a result rests on, always name that input and its boundary, said as what it is: from this Run\u2019s own figures, <input> at <boundary> is where <option>\u2019s level would equal the target (an \u201cat least\u201d or \u201cat most\u201d target is met at that point, an \u201cabove\u201d or \u201cbelow\u201d one is not), never as a recorded or measured threshold, and offer one stress_test of that link at it, said as a test the person can run, never as a claim about what will happen; in the same next step, invite them, if that figure could in fact vary, to give its lowest and highest likely values, without promising that a chance will then be shown and without suggesting the values; never say no further input is needed; without one, ask which of their own stated figures they are least sure of and offer to test it at a value they name (stress_test); say what result would change how the options compare. '
  + 'Never close on a general caution (such as \u201cnot a guarantee\u201d, \u201ckeep that distinction\u201d or \u201ccheck whether those assumptions remain appropriate\u201d) in place of these. Use only the supplied analysis; '
  + 'where run_comparison is given, follow its note. A Run that did not complete leaves a saved change saved: say both. '
  // K3 scope: the AIE's wording, verbatim (19 Oct 19:5xZ; no further ACK). Applied by meaning: no keyword ladder or classifier.
  + "Keep a clearly separate situation out of the current scenario's Living Model. If the relationship to the current scenario is unclear, ask one brief scope question before building or changing the model, while continuing useful discussion. "
  + 'Do not ask again when the person has already made the scope clear. Ordinary expansion and what-ifs within this scenario remain allowed. '
  + 'If the available tools cannot create or work in a separate scenario, say so; do not claim it was created or put its facts into this model instead.';

/** Coaching on the canvas (Lenses, #3535 `note_on_item`): one question or challenge beside the item that most deserves attention. */
export const NOTE_ON_ITEM_INSTRUCTION = "When one item in the model most deserves the person's attention (an untested assumption a result rests on, a missing cost or risk, or a link nobody has sized), use note_on_item once to put one short question or challenge beside it, in your own words; ask, do not answer or choose for them.";
/**
 * Arm C, ADOPTED (#94; R2 window 21 Oct 04:29Z on served a4e6efaa, arms verified in the provider ledger): Paul's 21 Oct
 * session found core replies long and narrating the tools ("the save response gave no reason"). The same reply rule, with
 * its save sentence in the user's terms and a length bound; every other word is byte-identical. On R2 it kept every quality
 * rate at 100 % (facts 34/34, corrections 8/8 cold, 0/66 misattributions, outcome 18/18) with replies of 90 words median
 * (p90 111) against arm A's 127 (p90 202).
 */
const CORE_REPLY_SAVE_SENTENCE = 'So say, from this turn\u2019s tool results, what was saved, what was not saved and why, and any proposal that is waiting for the user\u2019s approval on its card. ';
/**
 * BULLETS FIRST, DETAIL ON REQUEST (Paul, 21 Oct, standing: "concise, action-oriented bullets as the first response, and then any
 * additional context or guidance that is valuable under progressive disclosure"). The core reply takes Olumi's approved reply
 * discipline VERBATIM from the served routing prompt (`Prompts/canonical/routing.txt`, <RESPONSE_DISCIPLINE>; pinned equal by
 * core-prompt-arm.test.ts), in place of the prose-only sentence it replaces: a headline, at most three bold-led insight bullets,
 * at most one question, about 130 words, and more detail offered in one clause, never unloaded unasked.
 */
export const CORE_RESPONSE_DISCIPLINE = "<RESPONSE_DISCIPLINE>\nTwo shapes; choose by turn type.\n\nSHARP SHAPE (factual lookup, state query, pre-action orientation): answer or orientation in plain language; the evidence that matters; at most one focused question or concrete next step. Lookups and state queries: 1 to 3 sentences. Pre-action orientation: 2 to 4 sentences.\n\nCOACHING SHAPE (explaining results, including every explanation answer sent alongside a tool call; challenging a choice, handling contradiction, surfacing risk, improving the model; the shape that defines Olumi quality):\n1. HEADLINE: one plain-language sentence naming the key finding. No raw numbers. Lead with the insight.\n2. AT MOST THREE INSIGHT BULLETS, each a single sentence: \"- **Bold lead phrase.** Observation in plain language, then the specific action the user can take.\" Every bullet pairs insight with a concrete, decision-specific action; never a second sentence inside a bullet;\n3. QUESTIONS: zero to three, most turns zero or one. Only what would change the next step, woven where each does its work, never stacked into a list.\n\nCoaching-shape rules: substantive coaching turns use bullets, not prose paragraphs; the whole response stays under about 130 words unless the user asks for depth; very short clarifications or simple answers stay concise. Bold each lead phrase. Plain language only; raw decimals and precise terminology stay out (see TERMINOLOGY_MAP). Possessive framing: \"your model\", \"your estimate\", \"your assumptions\". Pair every risk with what to do about it.\n\nDETAIL BEHIND THE SUMMARY: when materially more sits in view than the shape admits (full driver list, per-option figures, method), end by naming that more detail is available and offer it in one clause; never unload it unasked.\n\nAvoid: long introductions, generic frameworks, repeating the question, stacked or decorative questions, unactionable advice.\n</RESPONSE_DISCIPLINE>";
/** The one question while input is missing: the input that decides between their options, not the readiness list unless asked (Codex #3571). */
export const CORE_NEXT_STEP = 'When input the analysis needs is missing and they have not asked what is missing, ask one focused question: the '
  + 'input that would most change how their options compare on their goal, in their own words; a rough range is fine for a quantity. '
  + 'That is usually the goal\u2019s figure (when they named no measure, suggest one as yours and ask for its figure), today\u2019s level '
  + 'of what it measures, or what an option would deliver or cost; a question about what success means or what evidence would change '
  + 'their view comes first only when it decides more. Say in a few words what their answer would change. When they ask what is still '
  + 'needed, give the complete list. Never ask for a date, figure or name their words already give. '
  // Track 3 on 4b (22 Oct): Olumi's risk chance counts only over the goal's window in months, and a core goal has none, so the
  // mapper holds the risk (`risk_window_not_goal_window`) and the goal's chance is withheld. A chance the person states counts over
  // their own window (riskOccurrenceIsCurrent), so that is the input that brings it in; a deadline alone does not (Track 2 step 0).
  + 'When a risk is held as risk_window_not_goal_window, say once that this risk is not in the calculation yet, so the goal\u2019s chance is '
  + 'not shown, and invite them to give their own estimate of how likely it is and over what time, which then goes in; make that your one '
  + 'question unless another input would change the comparison more. ';
export const CORE_REPLY_INSTRUCTION = CORE_REPLY_BEFORE_C.replace(CORE_REPLY_SAVE_SENTENCE,
  'So say plainly what changed in their model, what was not saved and why, and any proposal that is waiting for the user\u2019s approval on its card, in the user\u2019s terms (their model, its items and its Run), never your tools or what a tool response did or did not contain. ')
  .replace('Write one coherent reply in a single voice: give the explanation first, mention what changed since the last Run only when it matters, and weave at most one next step from the current readiness facts into the prose, never as a separate bullet or receipt line and never asking for something the user has already said; ask at most one question per reply. ', `${CORE_RESPONSE_DISCIPLINE}\nIn this lane, ask at most one question per reply, and never ask for something the user has already said. `)
  // Track 3 E2E, 21 Oct (served dce1b50a, Q2 0/8 decisive): with no Run result, replies read out the readiness list ("today's
  // footfall", "by when?" when the brief gave the date) instead of the input that decides between the options.
  + CORE_NEXT_STEP;
/** The instructions for one call in this lane mode: unchanged outside `core`. */
export function instructionsForMode(mode: AgentLaneMode, instructions: string, reply: string = CORE_REPLY_INSTRUCTION): string {
  return mode === 'core' ? `${instructions}\n\n${NOTE_ON_ITEM_INSTRUCTION}\n\n${reply}` : instructions;
}
