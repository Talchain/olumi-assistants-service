import { describe, expect, it } from 'vitest';
import { CORE_ALIGNED_INSTRUCTIONS, CORE_REPLY_RULES, NOTE_ON_ITEM_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION, instructionsForMode, MODEL_RELATIVE_NAMING_INSTRUCTION,
  promptArmOf, coreEffortArmOf } from '../../../routes/agent-v1-turn.js';
import { coreBudget } from '../model-budgets.js';
import { OLUMI_PURPOSE_INSTRUCTION } from '../olumi-purpose.js';
import { HOST_SCIENCE_AND_SOURCE_RULES, HOST_TOOL_CONTRACT, SELECTED_COACH_V02_TEMPLATE } from '../coach-route-v0_2.js';
import { createHash } from 'node:crypto';
import * as drafting from '../../path-b/drafting-guidance.js';
import * as coreInstructions from '../../core-route/instructions.js';

const { CORE_DRAFTER_RULES } = drafting;

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

  it('keeps the shared reasoning, science and reply rules, each once, and the core reply rules last', () => {
    for (const h of ['\nTRUTH\n', '\nREASONING\n', '\nAUTHORSHIP\n', '\nIDEATION\n', 'POLYMATH COACHING', 'CALCULATION BOUNDARY']) expect(b, h).toContain(h);
    for (const part of [OLUMI_PURPOSE_INSTRUCTION, GOAL_CHANCE_RANKING_INSTRUCTION, MODEL_RELATIVE_NAMING_INSTRUCTION, CORE_REPLY_RULES,
      HOST_SCIENCE_AND_SOURCE_RULES]) expect(count(b, part)).toBe(1);
    // The host contract's science, source and freshness rules ride along byte for byte (AIE 22:17Z), naming no tool.
    for (const rule of ['Never express the chance as a percentage of model runs.', 'Earlier assistant replies can describe a Run that was current then',
      'that separation rests on Olumi\'s own starting estimates', "The goal\u2019s `target` is the figure the user stated"]) expect(b, rule).toContain(rule);
    expect(b.endsWith(CORE_REPLY_RULES)).toBe(true);
  });

  it('arm B is the AIE\'s assembled reference, byte for byte (programme-docs #94 6303242136, static text sha256 7b6145d4…), plus the canvas-coaching sentence', () => {
    expect(b.split(NOTE_ON_ITEM_INSTRUCTION)).toHaveLength(2);
    // 7b6145d4… until 21 Oct; arm C's adoption changed only the closing core reply rule (see its row), now 56625e00….
    expect(createHash('sha256').update(b.replace(`${NOTE_ON_ITEM_INSTRUCTION}\n\n`, ''), 'utf8').digest('hex')).toBe('da2f3bc0015655b71dc21bbe40c1ec8e0397b9f7eba685b7cdf6b64223da7ede'); // 23 Oct (DL 93d79c3e, C2 (d)): "typical" values no longer forbidden on core. 22 Oct: one exact blocking-input question; retire the coach's duplicate ask.
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
    expect(createHash('sha256').update(CORE_REPLY_RULES, 'utf8').digest('hex')).toBe('6f5f00c581ac4be2f1f590973e4bcf58c6eba498e5216bc3a8a21a189be5f3d6');
    expect(createHash('sha256').update(CORE_DRAFTER_RULES, 'utf8').digest('hex')).toBe('34520d85d31ec5ade23c6ec4ce6c8199ae186c07c35402783c1de284c76b1f16'); // 23 Oct (DL 93d79c3e, C2): mechanism first; leanest and stated-only retired. 22 Oct: every stated goal saved in their words, never approximated (Claude r1 on #3670); + a calendar date is Olumi's labelled reading
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
    // The coach's own rules: the chance as the headline where supported, never a recommendation, figures only with their author.
    for (const rule of ['Lead with one plain-language headline naming the insight. Then at most three short bullets',
      "give each option's chance of meeting the aim in this model and its stated uncertainty",
      'Never recommend, call an option best or a winner, say \u201cyou should choose\u201d or \u201cgo with\u201d, or choose for the team',
      "use only figures that are in the model with their author, or that the supplied result computed; never invent one. Say when a figure is Olumi's starting estimate.",
      'If calculations use untested Olumi assumptions, say \u201cIllustrative calculation \u2014 uses untested Olumi assumptions.\u201d'])
      expect(CORE_REPLY_RULES.split(rule), rule).toHaveLength(2);
    // Kept from the old reply rule, each once: what the reply must report of the tools, saves and approvals.
    for (const kept of ['In this mode Olumi adds nothing to your reply and rewrites none of it: the user reads exactly your words.',
      'never your tools or what a tool response did or did not contain', 'Keep every must_say disclosure and the licences in run_facts.',
      'approving a reading adopts it but does not make the user its author', 'Where run_comparison is given, follow its note.',
      'or the analysis apply_change returns after a saved change), give that Run\u2019s results first, then coach on that same Run.',
      'A Run that did not complete leaves a saved change saved: say both.', "Keep a clearly separate situation out of the current scenario's Living Model.",
      'do not claim it was created or put its facts into this model instead'])
      expect(b.split(kept), kept).toHaveLength(2);
  });

  it('the drafter saves every stated goal in their words and never approximates it, with the rule present once', () => {
    const rule = "Save every goal the person states, in their words (what they want to reach, never an option): keep what fits the schema, and leave the rest null (or use = or a range, which Olumi asks about). Never approximate a comparator, figure or window, and never leave a stated goal unsaved.";
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
      "parts that add or net off are a defined_as sum (subtracted ids in subtract).",
      'Conditions are short, written for the person, one point each; keep working notes out of the model.',
      'A deadline is the window of the aim it belongs to, never an aim of its own: keep its words in by_when and, when it counts from today, its window in period_months (weeks \u00f7 4.35); '
        + 'for a calendar date ("by the end of September"), leave period_months null, set period_by olumi and read the date it fixes into period_deadline (YYYY-MM-DD, from today\'s date); Olumi records the day and works out its window.'])
      expect(CORE_DRAFTER_RULES.split(rule), rule).toHaveLength(2);
    expect(CORE_DRAFTER_RULES).not.toContain('When the aim has a deadline, record its window');
    // Codex r2 on #3660: never a fixed +1/\u22121 across different scales (\u00a3 thousands into \u00a3 is 1,000 per unit).
    expect(CORE_DRAFTER_RULES).not.toContain("in the whole's unit per the part's unit;");
    expect(CORE_DRAFTER_RULES).not.toContain("add at most one as Olumi's when it materially changes the reasoning");
  });

  it('the drafter modelling contract is sent once, with the blocking-input question on later turns too', () => {
    const draftRules = [
      "A qualitative worry or uncertainty is a risk, or a condition when it cannot reasonably be quantified, never an unmeasured factor.",
      "Every factor has a stated unit and a current value or Olumi's labelled estimate; only schema-defined on/off steps use unit null and a 0-or-1 level (a risk-mitigation step is 0 today and 1 under the option that takes it).",
      "Other mechanisms are items and links, never condition text alone.",
      "Use conditions only for what cannot be quantified, at most 5 in a first model.",
      "Name the risks the brief implies: include at least one risk when the brief implies any, linked to what it would hit.",
      "For a risk's chance and window, use supplied figures or the estimate rule; if none is reasonable, keep it unknown and say what is missing.",
      "An option acts through settings on what it changes; a person's option naming none gets Olumi's setting, estimate_by olumi.",
    ];
    const question = "Whenever a missing input leaves the Run blocked, end every reply with exactly ONE question asking for the specific input the Run needs next (today's level, a measure, a target or a time window), in plain words; use the current state and tool outcome, never re-ask a supplied input.";
    const firstTurn = `${b}\n\n${CORE_DRAFTER_RULES}`;
    for (const rule of [...draftRules, question]) expect(count(firstTurn, rule), rule).toBe(1);
    expect(count(b, question), 'the question survives after the first model').toBe(1);
    for (const rule of draftRules) expect(b, 'draft-only modelling rules are not repeated in standing instructions').not.toContain(rule);
    for (const old of ['A possible event is a risk; an existing condition is a factor.',
      'Otherwise explain the missing capability or ask only for the necessary input.',
      'and ask for the decisive missing input;']) expect(firstTurn, old).not.toContain(old);
    // Unrelated quantities and adoption cannot lend a figure or authorship to another item.
    expect(firstTurn).toContain('never change or mix with a figure they gave');
    expect(firstTurn).toContain('user/party requires verbatim words stating that very item');
    expect(firstTurn).toContain('Adoption does not transfer authorship.');
  });

  it('DL 93d79c3e (C2): the drafter builds the mechanism first, in the engine\'s own forms; "leanest" and "only when stated" are retired', () => {
    expect(CORE_DRAFTER_RULES).toContain("Work silently: the goal's identity first, then mechanisms, extraction, widening, audit.");
    expect(CORE_DRAFTER_RULES).toContain("MECHANISM FIRST: where an option or stated driver acts on the goal's quantity, or it is a standard business quantity, first define it by its parts, stated or not: "
      + "a level built up over the window is an accumulation on its own factor (stock_today, loss_rate_per_month, inflow_per_month: factor ids; horizon_months)");
    expect(CORE_DRAFTER_RULES).toContain('a rate times a count is a defined_as product; parts that add or net off are a defined_as sum (subtracted ids in subtract). Only these forms;');
    expect(CORE_DRAFTER_RULES).toContain("Options set levers on its parts or their drivers, never a link straight to an aim.");
    expect(CORE_DRAFTER_RULES).toContain('A qualitative aim remains intact and takes no identity:');
    expect(CORE_DRAFTER_RULES).toContain('a cap or minimum belongs in limit, on the identity part it bounds.');
    expect(CORE_DRAFTER_RULES).toContain('(what they want to reach, never an option)');
    for (const retired of ['leanest', 'for a stated sum/product', 'A stated sum/product is defined_as', 'option-to-item links', 'without adding an artificial factor',
      'to stay small', 'Definitions must not double-count causal effects.']) expect(CORE_DRAFTER_RULES, retired).not.toContain(retired);
    // Token-neutral or lower (DL (a)): the rules were 6,951 characters (string length) on staging 6f10ccd4 before this change.
    expect(CORE_DRAFTER_RULES.length).toBeLessThanOrEqual(6951);
  });

  it('DL 93d79c3e (C2 (d)): the core\'s standing instructions no longer forbid "typical" values, which its estimate rule asks for; the legacy coach is unchanged', () => {
    expect(CORE_ALIGNED_INSTRUCTIONS).not.toContain('\u201ctypical\u201d values');
    expect(CORE_ALIGNED_INSTRUCTIONS).toContain('Do not manufacture numerical precision or arbitrary thresholds.');
    expect(SELECTED_COACH_V02_TEMPLATE, 'control: the legacy template keeps its words').toContain('Do not manufacture numerical precision, \u201ctypical\u201d values or arbitrary thresholds.');
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
