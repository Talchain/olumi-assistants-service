/**
 * ⛔ THE AGENT NEVER STATES A CHANCE OF REACHING THE GOAL THAT THE RUN WITHHELD (MG's PLoT #416; AIQ 5884802000,
 * words 5885033487, ACK 5886183999; DL 5885276225: "Runtime consumes that decision in the reply").
 *
 * When a declared identity on the goal's own path was not evaluated, the run's goal figures come from the additive walk,
 * so PLoT withholds `probability_of_goal` on EVERY option and says why in ONE typed warning
 * (`GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED`, its `message` in AIQ's words, its `node_ids`). The model already receives
 * the run's `enrichment`, but nothing told it what to say: a missing figure is not a rule. This reads the typed code — never
 * the words — and hands the Agent `goal_chance` with the sentence to say and the rule to follow.
 *
 * AIQ 5886183999: the goal's per-option estimates come from the same wrong walk, so they are the same unsupported class.
 */

import {
  GOAL_FIGURES_PLACEHOLDER_PATH,
  GOAL_FIGURES_PRODUCT_NOT_READ,
  GOAL_FIGURES_USER_EFFECT_CLAMPED,
  GOAL_FIGURES_WITHHELD_CODES,
  GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED,
} from '../../orchestrator/context/option-result-source.js';

export { GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED };

/** What the Agent is told when the run withheld the goal's chance. */
export interface GoalChanceWithheld {
  readonly withheld: true;
  readonly say: string;
  readonly node_ids: readonly string[];
  readonly note: string;
  /** (S) only: the options whose chance was withheld. Absent = every option (#416 / #422). */
  readonly option_ids?: readonly string[];
}

// AIQ 5887096626: the one register ("reaches the target in N% of model runs", 5885116642).
const OPENING = 'This run doesn’t show how often each option reaches the goal’s target.';
/** PLoT's words open "Not shown." — right beside a missing figure, not in a reply; the reason after it is kept verbatim. */
const UI_OPENING = /^Not shown\.\s*/;

export const GOAL_CHANCE_WITHHELD_NOTE =
  'This run withheld the chance of reaching the goal for EVERY option. Never state, estimate, rank or compare a chance, probability '
  + 'or percentage of reaching the goal for any option, never say an option is more or less likely to reach it, and never quote an '
  + 'option’s estimated value for the goal itself as a result: those come from the same calculation. Say `say` once, as written, '
  + 'when you describe the run. Other results of this run may be described as they are.';

/**
 * ⛔ (S) (DL #75 5902570568): the chance is withheld only for the options a placeholder path moves (the status quo keeps
 * its earned figure), and the share of runs each option did best is withheld for every option.
 */
export const PLACEHOLDER_PATH_NOTE =
  'This run withheld the chance of reaching the goal for the options in `option_ids`, and for EVERY option the share of runs '
  + 'in which it did best: they move with a link Olumi has not sized. Never state, estimate, rank or compare those figures, never '
  + 'quote those options’ estimated value for the goal itself, and never name a leading option. Say `say` once, as written, when '
  + 'you describe the run: it names the link, and asks for its size only where it does. Never ask the user to size a link `say` '
  + 'calls a guess. Other results of this run may be described as they are.';

/**
 * ⛔ GATE 5 (DL #75 5904272507): the user's own figures make the goal a product this run did not calculate, so EVERY
 * option's goal figures and the leader are withheld. No promise of the reading: the card that offers it is its own door.
 */
export const PRODUCT_NOT_READ_NOTE =
  'This run withheld, for EVERY option, the chance of reaching the goal, the option’s estimated value for the goal itself, and '
  + 'the share of runs in which it did best: the user’s own figures make the goal the product `say` names, and this run did not '
  + 'calculate it that way. Never state, estimate, rank or compare those figures, never name a leading option, and never say '
  + 'Olumi will calculate it that way. Say `say` once, as written, when you describe the run. Other results of this run may be '
  + 'described as they are.';

const recordOf = (v: unknown): Record<string, unknown> | undefined =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined);

/**
 * `goal_chance` for a run's `analysis_result` block, or `undefined` when the run did not withhold it. The warning is read
 * where the run carries it (`enrichment.inference_warnings`) or where a kept, withheld run moved it (`inference_warnings`).
 * The typed code decides; a warning with no usable words is still withheld, with the opening alone (fail closed).
 */
export function goalChanceWithheldForAgent(result: unknown): GoalChanceWithheld | undefined {
  const block = recordOf(result);
  if (block === undefined) return undefined;
  const warnings = [recordOf(block.enrichment)?.inference_warnings, block.inference_warnings]
    .flatMap((w) => (Array.isArray(w) ? w : []))
    .map(recordOf)
    .filter((w): w is Record<string, unknown> => w !== undefined && typeof w.code === 'string' && GOAL_FIGURES_WITHHELD_CODES.has(w.code));
  if (warnings.length === 0) return undefined;
  // (S) speaks alone: CEE writes it only on a run PLoT did not already withhold (`run-analysis.ts`).
  if (warnings.every((w) => w.code === GOAL_FIGURES_PLACEHOLDER_PATH)) {
    const w = warnings[0]!;
    const words = typeof w.message === 'string' ? w.message.replace(UI_OPENING, '').trim() : '';
    const ids = (key: string): string[] => (Array.isArray(w[key]) ? (w[key] as unknown[]).filter((id): id is string => typeof id === 'string') : []);
    return { withheld: true, say: words === '' ? OPENING : words, node_ids: ids('node_ids'), note: PLACEHOLDER_PATH_NOTE, option_ids: ids('option_ids') };
  }
  // Gate 5 speaks alone too: CEE writes it only on a run nothing else withheld (`run-analysis.ts`).
  if (warnings.every((w) => w.code === GOAL_FIGURES_PRODUCT_NOT_READ)) {
    const w = warnings[0]!;
    const words = typeof w.message === 'string' ? w.message.replace(UI_OPENING, '').trim() : '';
    const ids = (key: string): string[] => (Array.isArray(w[key]) ? (w[key] as unknown[]).filter((id): id is string => typeof id === 'string') : []);
    return { withheld: true, say: words === '' ? OPENING : words, node_ids: ids('node_ids'), note: PRODUCT_NOT_READ_NOTE, option_ids: ids('option_ids') };
  }
  // One reason per cause, identity first (unchanged when it is alone), then PLoT #422's cut link — each in PLoT's words.
  const reasonFor = (code: string): string => {
    const words = warnings.filter((w) => w.code === code)
      .map((w) => (typeof w.message === 'string' ? w.message.trim() : '')).find((m) => m !== '');
    return words === undefined ? '' : words.replace(UI_OPENING, '').trim();
  };
  const reason = [reasonFor(GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED), reasonFor(GOAL_FIGURES_USER_EFFECT_CLAMPED)]
    .filter((r) => r !== '').join(' ');
  const nodeIds = [...new Set(warnings.flatMap((w) => (Array.isArray(w.node_ids) ? w.node_ids : [])).filter((id): id is string => typeof id === 'string'))];
  return { withheld: true, say: reason === '' ? OPENING : `${OPENING} ${reason}`, node_ids: nodeIds, note: GOAL_CHANCE_WITHHELD_NOTE };
}

/**
 * ⛔ THE REASON IS SAID AS WRITTEN — the reply's own line (AIQ 5887805333 (3); Runtime's served #2285 finding).
 *
 * Served on `0497e52e`: the Agent paraphrased `say` ("…adds those effects instead of multiplying them"). That is true for
 * a PRODUCT identity only; #416 fires for ANY unevaluated declared identity, so for a SUM it is false. The typed `say` is
 * always true, so it is pinned: when a run THIS turn withheld the goal's chance and the reply does not already carry that
 * sentence verbatim, it is owed as its own line (`withDisclosures`). The latest run decides — an explicit Run, or the first
 * pass inside a build — and a later run that did not withhold owes nothing.
 */
export function goalChanceLineOwed(toolResults: readonly unknown[], replyText: string): string | null {
  const say = goalChanceSayFromThisTurn(toolResults);
  return say !== null && !sameWordsIn(replyText, say) ? say : null;
}

/** The latest Run this turn's typed sentence; a later Run without a warning clears an earlier one. */
export function goalChanceSayFromThisTurn(toolResults: readonly unknown[]): string | null {
  let say: string | undefined;
  for (const r of toolResults) {
    const rec = recordOf(r);
    const firstPass = recordOf(rec?.first_analysis);
    const chance = recordOf(rec?.goal_chance) ?? recordOf(firstPass?.goal_chance);
    if (chance?.withheld === true && typeof chance.say === 'string' && chance.say.trim() !== '') say = chance.say;
    else if (rec?.ran === true || firstPass?.ran === true) say = undefined;
  }
  return say ?? null;
}

/**
 * Whether `text` already says `sentence`, as a reader sees it (served `2397c7a`, 2/2 replies): the Agent restyles the typed
 * sentence's quotes — bold `**X**` for 'X', or “X” — so a byte match missed it and the line was said twice. Compared with
 * every quote mark and markdown emphasis mark removed and whitespace collapsed; any other change (a word, a figure, the
 * operator) is not the sentence, so it is still owed.
 */
function sameWordsIn(text: string, sentence: string): boolean {
  const plain = (t: string): string => t.replace(/[\u0027\u0022\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u2032\u2033`]|\*\*|__|(?<![\w])[*_]|[*_](?![\w])/g, '')
    .replace(/\s+/g, ' ').trim();
  return plain(text).includes(plain(sentence));
}
