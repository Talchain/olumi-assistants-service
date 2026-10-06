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
  GOAL_FIGURES_OPTIONS_IDENTICAL,
  GOAL_FIGURES_PLACEHOLDER_PATH,
  GOAL_FIGURES_PRODUCT_NOT_READ,
  GOAL_FIGURES_TARGET_NOT_TESTABLE,
  GOAL_FIGURES_USER_EFFECT_CLAMPED,
  GOAL_FIGURES_WITHHELD_CODES,
  GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED,
} from '../../orchestrator/context/option-result-source.js';

import { composeIdentityAskForNode } from '../coaching/identity-not-evaluated-ask.js';

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
  + 'that supported it: they move with a link Olumi has not sized. Never state, estimate, rank or compare those figures, never '
  + 'quote those options’ estimated value for the goal itself, and never name a leading option. Say `say` once, as written, when '
  + 'you describe the run: it names the link, and asks for its size only where it does. Never ask the user to size a link `say` '
  + 'calls a guess. Other results of this run may be described as they are.';

/**
 * ⛔ GATE 5 (DL #75 5904272507): the user's own figures make the goal a product this run did not calculate, so EVERY
 * option's goal figures and the leader are withheld. No promise of the reading: the card that offers it is its own door.
 */
export const PRODUCT_NOT_READ_NOTE =
  'This run withheld, for EVERY option, the chance of reaching the goal, the option’s estimated value for the goal itself, and '
  + 'the share of runs that supported it: the user’s own figures make the goal the product `say` names, and this run did not '
  + 'calculate it that way. Never state, estimate, rank or compare those figures, never name a leading option, and never say '
  + 'Olumi will calculate it that way. Say `say` once, as written, when you describe the run. Other results of this run may be '
  + 'described as they are.';

/**
 * ⭐ F1b [R1] (DL 5930827933; condition (1) 5931324913): a target this run can't test, where every option's OUTCOME was
 * kept (`withheld_claims` without `outcome`, P2–P4). The outcomes reach this view, so the note says what may be said of
 * them — one option's own range — and forbids every comparative use: no rank, no leader, no better or worse.
 */
export const OUTCOME_KEPT_NOTE =
  'This run withheld, for EVERY option, the chance of reaching the goal’s target and the share of runs that supported it: '
  + 'the target can’t be tested yet. Each option’s outcome for the goal (its centre and spread) is shown to the user on the '
  + 'results panel; you are not given those figures. Never quote or estimate an option’s outcome, never rank or order the '
  + 'options by their outcomes, never name a leading or best option, and never say one option is better or worse than another. '
  + 'Say `say` once, as written, when you describe the run.';

/**
 * ⭐ RT-10 B′ R2 (Science #87 5999608477; DL e8 CONFIRMED): the untestable target KEPT the ordering. Only the chance of
 * reaching the target (and, unless the failures leave it in the goal's units, the outcome) is withheld; the shares and the
 * leader are this run's findings and may be said as such, in the run's own direction.
 */
export const TARGET_ONLY_NOTE =
  'This run withheld, for EVERY option, the chance of reaching the goal’s target and each option’s outcome for the goal: the '
  + 'target can’t be tested yet. The share of runs that supported each option IS a result of this run: say it, if at all, as a '
  + 'finding of this model in the goal’s own direction (where lower is better, the option that came out lowest), always said as '
  + '‘in this model’, never as a chance of reaching the target and never as a recommendation. Never state, estimate, rank or compare a chance of reaching the '
  + 'target, and never quote or estimate an option’s outcome. Say `say` once, as written, when you describe the run.';
/** The same, where the failures leave each option's outcome in the goal's units (P2/P3/P4 only): the panel shows it. */
export const TARGET_ONLY_OUTCOME_KEPT_NOTE =
  'This run withheld, for EVERY option, the chance of reaching the goal’s target: the target can’t be tested yet. Each option’s '
  + 'outcome for the goal is shown to the user on the results panel; you are not given those figures, so never quote or estimate '
  + 'one, never rank or order the options by those outcomes, and never say one option is better or worse than another (DL #2448 '
  + 'condition (1)). The share of runs that supported each option IS a result of this run: say it, if at all, as a finding of this model '
  + 'in the goal’s own direction (where lower is better, the option that came out lowest), always said as ‘in this model’, never '
  + 'as a chance of reaching the target and never as a recommendation. Say `say` once, as written, when you describe the run.';

/**
 * ⛔ GATE 1 v2 (DL 5 Oct, #2574): options the Run could not tell apart split their wins, so EVERY option's share of runs
 * it did best — and so any leader — is withheld, and the chance of reaching the goal only for the identical options.
 * Every outcome stays, but identical options share one, so they are never compared with each other.
 */
export const OPTIONS_IDENTICAL_NOTE =
  'This run withheld, for EVERY option, the share of runs that supported it, so no option may be called leading or best; '
  + 'and, for the options in `option_ids`, the chance of reaching the goal: those options came out identical in this model, so '
  + 'the run cannot tell them apart. Never state, estimate, rank or compare those figures, never name a leading option, and never '
  + 'say one of the options in `option_ids` is better or worse than another. Say `say` once, as written, when you describe the '
  + 'run. Other results of this run may be described as they are.';

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
  // Gate 1 v2 (Codex #2574 P1): identical options keep their own reason and scope, alone or beside any other withhold.
  const identical = warnings.filter((w) => w.code === GOAL_FIGURES_OPTIONS_IDENTICAL);
  const others = warnings.filter((w) => w.code !== GOAL_FIGURES_OPTIONS_IDENTICAL);
  if (identical.length === 0) return goalChanceFromWarnings(others);
  const words = identical.map((w) => (typeof w.message === 'string' ? w.message.replace(UI_OPENING, '').trim() : ''))
    .find((m) => m !== '') ?? '';
  const ids = [...new Set(identical.flatMap((w) => (Array.isArray(w.option_ids) ? w.option_ids : []))
    .filter((id): id is string => typeof id === 'string'))];
  if (others.length === 0) {
    return { withheld: true, say: words === '' ? OPENING : words, node_ids: [], note: OPTIONS_IDENTICAL_NOTE, option_ids: ids };
  }
  // Mixed: the other cause keeps its own reader, note and words; the identical reason is added, and a scoped withhold
  // widens to the identical options too (an every-option withhold already covers them).
  const base = goalChanceFromWarnings(others);
  return { ...base, say: words === '' ? base.say : `${base.say} ${words}`,
    ...(base.option_ids === undefined ? {} : { option_ids: [...new Set([...base.option_ids, ...ids])] }) };
}

/** The reader for every withhold code but gate 1 v2's; `warnings` is non-empty. */
function goalChanceFromWarnings(warnings: readonly Record<string, unknown>[]): GoalChanceWithheld {
  // (S) speaks alone: CEE writes it only on a run PLoT did not already withhold (`run-analysis.ts`).
  if (warnings.every((w) => w.code === GOAL_FIGURES_PLACEHOLDER_PATH)) {
    const w = warnings[0]!;
    const words = typeof w.message === 'string' ? w.message.replace(UI_OPENING, '').trim() : '';
    const ids = (key: string): string[] => (Array.isArray(w[key]) ? (w[key] as unknown[]).filter((id): id is string => typeof id === 'string') : []);
    return { withheld: true, say: words === '' ? OPENING : words, node_ids: ids('node_ids'), note: PLACEHOLDER_PATH_NOTE, option_ids: ids('option_ids') };
  }
  // Gate 5 covers EVERY option and keeps its existing explanation when a per-option path also withholds.
  const product = warnings.find((w) => w.code === GOAL_FIGURES_PRODUCT_NOT_READ);
  if (product !== undefined) {
    const w = product;
    const words = typeof w.message === 'string' ? w.message.replace(UI_OPENING, '').trim() : '';
    const ids = (key: string): string[] => (Array.isArray(w[key]) ? (w[key] as unknown[]).filter((id): id is string => typeof id === 'string') : []);
    return { withheld: true, say: words === '' ? OPENING : words, node_ids: ids('node_ids'), note: PRODUCT_NOT_READ_NOTE, option_ids: ids('option_ids') };
  }
  // RT-10 B′ R2: every withhold is the untestable target and it KEPT the shares (no `win_share` withheld) → the target-only
  // licence, and the reply says the B′ tail the warning carries (`say`, from `untestableTargetParts`).
  const targetOnly = warnings.every((w) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE
    && Array.isArray(w.withheld_claims) && !(w.withheld_claims as unknown[]).includes('win_share'));
  if (targetOnly) {
    const nodeIds = [...new Set(warnings.flatMap((w) => (Array.isArray(w.node_ids) ? w.node_ids : [])).filter((id): id is string => typeof id === 'string'))];
    const tail = warnings.map((w) => (typeof w.say === 'string' ? w.say.trim() : '')).find((t) => t !== '');
    const outcomeWithheld = warnings.some((w) => (w.withheld_claims as unknown[]).includes('outcome'));
    return { withheld: true, say: tail ?? OPENING, node_ids: nodeIds, note: outcomeWithheld ? TARGET_ONLY_NOTE : TARGET_ONLY_OUTCOME_KEPT_NOTE };
  }
  // F1b [R1]: every withhold is the untestable target with the outcome KEPT → the outcome-kept licence, never the ban on
  // quoting an option's value (which would contradict the outcomes the panel now shows).
  const outcomeKept = warnings.every((w) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE
    && Array.isArray(w.withheld_claims) && !(w.withheld_claims as unknown[]).includes('outcome'));
  if (outcomeKept) {
    const nodeIds = [...new Set(warnings.flatMap((w) => (Array.isArray(w.node_ids) ? w.node_ids : [])).filter((id): id is string => typeof id === 'string'))];
    return { withheld: true, say: OPENING, node_ids: nodeIds, note: OUTCOME_KEPT_NOTE };
  }
  // One reason per cause, identity first (unchanged when it is alone), then PLoT #422's cut link — each in PLoT's words.
  const reasonFor = (code: string): string => {
    const words = warnings.filter((w) => w.code === code)
      .map((w) => (typeof w.message === 'string' ? w.message.trim() : '')).find((m) => m !== '');
    return words === undefined ? '' : words.replace(UI_OPENING, '').trim();
  };
  // ⭐ MC D1 (f) (DL 6 Oct; Acceptance g1-b501 drafts 1 and 6, full wire on CEE 231affb): a placeholder path beside an
  // untestable target that KEPT the shares fell through to the bare opening, so the chat asked nothing answerable while
  // the panel named a link. The placeholder's own words ARE its one ask ("… whose strengths nobody has set yet. Set them
  // to see how much they matter."), so they are said here, after any PLoT reason; the target's own question is not added.
  const reason = [reasonFor(GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED), reasonFor(GOAL_FIGURES_USER_EFFECT_CLAMPED),
    reasonFor(GOAL_FIGURES_PLACEHOLDER_PATH)].filter((r) => r !== '').join(' ');
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
  if (say === null || sameWordsIn(replyText, say)) return null;
  // MC D1 (Codex buddy r2 P2): a composite line (the opening + a warning's own words) owes only what the reply does not
  // already carry — the Agent quoting the placeholder's "Set them …" must not get it a second time.
  if (say.startsWith(OPENING) && say.length > OPENING.length && sameWordsIn(replyText, say.slice(OPENING.length).trim())) {
    return sameWordsIn(replyText, OPENING) ? null : OPENING;
  }
  return say;
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
export function sameWordsIn(text: string, sentence: string): boolean {
  const plain = (t: string): string => t.replace(/[\u0027\u0022\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u2032\u2033`]|\*\*|__|(?<![\w])[*_]|[*_](?![\w])/g, '')
    .replace(/\s+/g, ' ').trim();
  return plain(text).includes(plain(sentence));
}

/**
 * ⭐ NEVER RE-ASK WHAT IS ALREADY ASKED (DL 0df0e1, 6 Oct; Acceptance G1b d4, pd 22fe54b8): a host line's closing QUESTION
 * already among the Agent's recent answers is still open, so it is not asked again; the line's reason is still said, since
 * the Run withheld the chance THIS time too. d4: the user answered "about 2 customers per 1% rise" three times, in a unit the
 * £/month link cannot hold, and every Run and every Explain asked the same question again. This is the D1 target ask's rule
 * (PANEL 5944136475, `decision-input-ask.ts`) for every host line that ends in a question. Returns '' when the whole line
 * was that question; the line unchanged when it asks nothing, or asks something not yet asked.
 */
export function withoutAskedQuestion(line: string, recentReplies: readonly string[]): string {
  const body = line.trimEnd();
  if (!body.endsWith('?') || recentReplies.length === 0) return line;
  const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z\u2018\u201c"'])/u);
  const question = sentences[sentences.length - 1]!;
  return recentReplies.some((reply) => sameWordsIn(reply, question)) ? sentences.slice(0, -1).join(' ') : line;
}

/**
 * ⭐ MC D1 (c) ON THE RUN TURN ITSELF (served witness on CEE b501eda4, draw 6, #87 6008006944): the chip Run's reply is
 * Olumi's fixed line plus the owed lines, so PLoT #416's reason was said ("'Monthly starter support cost' depends on … ×
 * …, but this run couldn't calculate it that way") and nothing asked — the fail-closed closing only speaks when ranking
 * prose is dropped. The ONE ask that would let the identity be worked out (`composeIdentityAskForNode`, from the graph the
 * Run analysed) is its own owed line, after the reason; null when the Run carries no #416 or the graph shows no ask.
 */
export function identityAskLineFor(result: unknown, graph: unknown): string | null {
  const block = recordOf(result);
  if (block === undefined) return null;
  const warning = [recordOf(block.enrichment)?.inference_warnings, block.inference_warnings]
    .flatMap((w) => (Array.isArray(w) ? w : [])).map(recordOf)
    .find((w) => w?.code === GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED);
  const nodeId = Array.isArray(warning?.node_ids) && typeof warning.node_ids[0] === 'string' ? warning.node_ids[0] : undefined;
  return nodeId === undefined ? null : composeIdentityAskForNode(nodeId, graph)?.assistant_text ?? null;
}

/** The latest Run this turn's typed identity ask (`identity_ask_say` on its tool result), unless the reply already says it. */
export function identityAskLineOwed(toolResults: readonly unknown[], replyText: string): string | null {
  let say: string | undefined;
  for (const r of toolResults) {
    const rec = recordOf(r);
    if (typeof rec?.identity_ask_say === 'string' && rec.identity_ask_say.trim() !== '') say = rec.identity_ask_say;
    // Any later Run clears it — one with a result or one without (Codex buddy r2 P1: a no-result Run after the operand
    // was set must not repeat the earlier "is 0 today … how many …?").
    else if (typeof rec?.ran === 'boolean') say = undefined;
  }
  return say !== undefined && !sameWordsIn(replyText, say) ? say : null;
}
