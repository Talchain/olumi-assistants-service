import { shareGoalChanceWords } from '../goal-target/share-goal-chance-words.js';
export { shareGoalChanceWords } from '../goal-target/share-goal-chance-words.js';
import { shareByDateGoalOf } from '../goal-target/goal-kind.js';
import { olumiAssumedRangeLine, olumiAssumedTeamRange, shareOptionEstimateWords } from '../goal-target/share-by-date-run.js';
/** Licensed screen facts and the retained count check. The AI owns reply wording. */
import { goalChanceFactsForAgent } from '../goal-target/goal-chance-range-agent.js';
import { sayDate } from '../goal-target/deadline-date.js';
import { shortfallNoteLabel, UNVERIFIED_SOURCES_NOTE, STATIC_MODEL_SCOPE_NOTE } from '../goal-target/goal-chance-licence.js';
import { foldQuotes } from './quote-normalisation.js';
import { narratorCountGuard } from './olumi-estimates-feeding-result.js';
import { goalChanceEstimateCounts, goalChanceEstimateLinkCount, olumiEstimateWords, type GoalChanceEstimateCounts } from './goal-chance-estimate-attribution.js';
import { sayDisplayedPct } from '../goal-target/goal-targets-joint.js';

/** One option's line as the screen words it: chance and licensed notes, then what it depends on most ('' = none). */
export interface GoalChanceScreenLine {
  readonly option_id: string;
  readonly label: string;
  /** The figure as the screen shows it: "about 46%", "less than 1%", "between about 4% and 55%". */
  readonly figure: string;
  readonly chance: string;
  readonly depends: string;
  readonly spread_note?: string;
  readonly shortfall_note?: string;
  /**
   * GP §(i): this point's link-size count, from RC4 only. Present whenever its full labelled sentence is owed — any Olumi
   * input on its result (amendment 7: a starting value or its own setting too, so it may be 0).
   */
  readonly olumi_estimate_link_count?: number;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const CHANCE_LABEL = 'chance of meeting your goal, in this model';
const ESTIMATE_POINT_END = '(see Check estimates).';
const estimatePointSentence = (l: GoalChanceScreenLine): string => l.chance.slice(0, l.chance.indexOf(ESTIMATE_POINT_END) + ESTIMATE_POINT_END.length);

type ComposedChanceLine = Omit<GoalChanceScreenLine, 'label'> & { readonly label?: string };

/** The ranges' census: this Run's options and the scored goal's own upstream set (`goalChanceEstimateCounts`). */
function rangeCensusOf(facts: ReturnType<typeof goalChanceFactsForAgent>, graph: unknown): GoalChanceEstimateCounts | undefined {
  return Object.keys(facts.goal_chance_range_display ?? {}).length === 0 ? undefined
    : goalChanceEstimateCounts(graph, facts.goal_chance_licence?.option_ids, facts.goal_chance_licence?.goal_node_id);
}

/** Pure extraction of the existing sentence composer; consumers keep their own label/narration gates. */
function composeGoalChanceLines(result: unknown, graph: unknown, current: boolean): {
  points: ComposedChanceLine[]; ranges: ComposedChanceLine[]; pointsOwed: boolean;
} {
  const facts = goalChanceFactsForAgent(result, graph, current);
  const share = shareByDateGoalOf(graph);
  const chanceWords = facts.goal_chance_words !== undefined ? `${facts.goal_chance_words}, in this model`
    : share === null ? CHANCE_LABEL
      : `${shareGoalChanceWords(String(share.goal.goal_threshold_unit).replace(/^(?:%|percent)[ \t]{1,4}of[ \t]{1,4}/i, ''), share.deadline)}, in this model`;
  // §(i) amendment: RC4 owns k. Reuse its existing goal-path signal inputs, never a second sizing/count rule.
  // Specialised deadline points keep their existing chance words and option-specific time/pace disclosures.
  const k = facts.goal_chance_display === undefined ? 0
    : facts.goal_chance_licence?.olumi_estimate_link_count ?? goalChanceEstimateLinkCount(graph);
  // ⭐ Amendment 7 (independent check r1 item 6): the label names EVERY Olumi input kind on the goal paths, not only links —
  // the shared starting values and relationships, and THIS option's own Olumi settings (never another option's).
  const values = facts.goal_chance_licence?.olumi_estimate_value_count ?? 0;
  const settingsOf = (optionId: string): number => facts.goal_chance_licence?.olumi_estimate_settings_by_option?.[optionId] ?? 0;
  const olumiInputsOf = (optionId: string): string | undefined => facts.goal_chance_display === undefined ? undefined
    : olumiEstimateWords({ links: k, values, settings: settingsOf(optionId) });
  // ⭐ Condition 6 of a correct chance / r1 item 6 (DL, 12 Oct): a RANGE rests on the same Olumi inputs as a point and says
  // so in the point's own words — the same census (`goalChanceEstimateCounts`) over this Run's options and scored goal, with
  // THIS option's own settings only. A deadline range keeps its own estimate words (`shareOptionEstimateWords`).
  // ⛔ RE-SCOPE 2 (DL AMEND item 3; AIE 0518): a range measures the GOAL's own event, so it keeps the goal's own dependency
  // set (its upstream inputs) — never the joint's union, which would claim the range rests on inputs it does not.
  const rangeCounts = rangeCensusOf(facts, graph);
  const rangeInputsOf = (optionId: string): { readonly words: string; readonly links: number } | undefined => {
    const words = rangeCounts === undefined ? undefined
      : olumiEstimateWords({ links: rangeCounts.links, values: rangeCounts.values, settings: rangeCounts.settingsByOption[optionId] ?? 0 });
    return words === undefined ? undefined : { words, links: rangeCounts!.links };
  };
  const nodes = rec(graph)?.nodes;
  const labels = new Map((Array.isArray(nodes) ? nodes : []).map(rec)
    .filter((n): n is Rec => n !== undefined && typeof n.id === 'string' && typeof n.label === 'string' && n.label.trim() !== '')
    .map((n) => [n.id as string, n.label as string]));
  const line = (optionId: string, figure: string, depends: string, spreadNote?: string, shortfallNote?: string, point = false,
    rangeInputs?: { readonly words: string; readonly links: number }): ComposedChanceLine[] => {
    const recorded = rec(facts.goal_chance_licence?.option_labels_by_option)?.[optionId];
    const label = typeof recorded === 'string' && recorded.trim() !== '' ? recorded : labels.get(optionId);
    // Narration still drops unnamed options below. A cell can carry the same
    // chance words without a quoted label; no raw id or guessed label is added.
    const prefix = label === undefined ? '' : `‘${label}’: `;
    // The licence checks the two exact templates; this reader owns whether their named option is the graph's label.
    const shortfall = shortfallNoteLabel(shortfallNote) === label ? shortfallNote : undefined;
    const estimates = shareOptionEstimateWords(graph, optionId);
    const olumiInputs = point ? olumiInputsOf(optionId) : rangeInputs?.words;
    const estimateRelationships = olumiInputs !== undefined ? `, using Olumi's estimates for ${olumiInputs} (see Check estimates)` : '';
    return [{ option_id: optionId, label, figure,
      chance: `${prefix}${figure} ${chanceWords}${estimates === '' ? '' : `, ${estimates}`}${estimateRelationships}.`
        + (spreadNote === undefined ? '' : ` ${spreadNote}`) + (shortfall === undefined ? '' : ` ${shortfall}`), depends,
      ...(estimateRelationships === '' ? {} : { olumi_estimate_link_count: point ? k : rangeInputs!.links }),
      ...(spreadNote === undefined ? {} : { spread_note: spreadNote }),
      ...(shortfall === undefined ? {} : { shortfall_note: shortfall }) }];
  };
  const anyOlumiInput = facts.goal_chance_display !== undefined && (k + values > 0
    || Object.keys(facts.goal_chance_licence?.olumi_estimate_settings_by_option ?? {}).length > 0);
  const pointsOwed = anyOlumiInput || facts.goal_chance_licence?.form === 'each' || facts.goal_chance_words !== undefined || share !== null;
  const points = facts.goal_chance_display !== undefined
    ? facts.goal_chance_licence!.option_ids.flatMap((id) => {
      const figure = facts.goal_chance_display![id];
      return figure === undefined ? [] : line(id, figure, facts.goal_chance_driver_display?.[id] ?? '',
        facts.goal_chance_licence?.spread_note_by_option?.[id], facts.goal_chance_licence?.shortfall_note_by_option?.[id], true);
    }) : [];
  const ranges = Object.entries(facts.goal_chance_range_display ?? {}).flatMap(([id, d]) => {
    if (d.depends_on.kind === 'stated_time') {
      const label = labels.get(id), stated = d.stated_time;
      if (stated === undefined) return [];
      const prefix = label === undefined ? '' : `‘${label}’: `;
      const words = stated.deliverable !== undefined && stated.by_date !== undefined
        ? shareGoalChanceWords(stated.deliverable, stated.by_date)
        : `chance of meeting your goal${stated.by_date === undefined ? '' : ` by ${sayDate(stated.by_date)}`}`;
      // EBD E2 (AIE 6122738619): a range Olumi assumed from the user's single forecast is said in its own sentence, never as "your".
      const assumed = olumiAssumedTeamRange(graph);
      const estimates = shareOptionEstimateWords(graph, id, { withoutTeam: assumed !== null });
      const tail = `in this model${estimates === '' ? '' : `, ${estimates}`}`;
      const extremeEndpoints = d.range === 'between less than 1% and more than 99%'
        && stated.slow_time !== undefined && stated.fast_time !== undefined;
      return [{ option_id: id, label, figure: d.range,
        chance: extremeEndpoints
          ? `${prefix}less than 1% ${words} if it takes ${stated.slow_time}, and more than 99% if it takes ${stated.fast_time}, ${tail}.`
            + (assumed !== null ? ` ${olumiAssumedRangeLine(assumed)}` : '')
          : assumed !== null
            ? `${prefix}${d.range} ${words}, ${tail}, from the slow end of the range to the fast end. ${olumiAssumedRangeLine(assumed)}`
            : `${prefix}${d.range} ${words}, ${tail}, from the slow end of your ${stated.estimate} to the fast end.`,
        depends: '' }];
    }
    const lead = d.depends_on.among === 'unsized_links' ? 'Of the links not sized yet, it depends most on' : 'It depends most on';
    const link = d.depends_on.kind === 'link_strength'
      ? `how strongly ‘${d.depends_on.from_label}’ affects ‘${d.depends_on.to_label}’, which isn’t sized in the model yet.`
      : `whether ‘${d.depends_on.from_label}’ affects ‘${d.depends_on.to_label}’ at all, which Olumi assumed.`;
    return line(id, d.range, `${lead} ${link}`, undefined, undefined, false, rangeInputsOf(id));
  });
  const scope = facts.goal_chance_notes?.includes(STATIC_MODEL_SCOPE_NOTE) === true;
  const scoped = (lines: ComposedChanceLine[]): ComposedChanceLine[] => scope
    ? lines.map(l => ({ ...l, chance: `${l.chance} ${STATIC_MODEL_SCOPE_NOTE}` })) : lines;
  return { points: scoped(points), ranges: scoped(ranges), pointsOwed };
}

/** The screen's chance lines for the selected Run (`current` = its run state is complete and current); [] otherwise. */
export function goalChanceScreenLinesForAgent(result: unknown, graph: unknown, current: boolean): GoalChanceScreenLine[] {
  const { points, ranges, pointsOwed } = composeGoalChanceLines(result, graph, current);
  // Preserve the existing owed-point and named-option gates exactly.
  return [...(pointsOwed ? points : []), ...ranges]
    .filter((line): line is GoalChanceScreenLine => line.label !== undefined);
}

/**
 * ⭐ RECOVERY BATCH C: the sentences said ONCE beside the chances, in the screen's order — for several targets, the joint's
 * withheld reason (and the Fréchet bound, amendment 6) and then each target's own chance (ruling 15: "each target separately
 * below"); the status quo row by assumption (amendment 1); then the licence's disclosures (amendments 1, 2, 4, 7, 10). Read only
 * from the Run's stored licence (`goalChanceFactsForAgent`); [] when it carries none or the Run is not current.
 */
export function goalChanceNotesForAgent(result: unknown, graph: unknown, current: boolean,
  /** The Run's card under this reply: a note it shows is said there, once. A group is said only for notes the card does not show. */
  onCard?: { has(line: string): boolean } | null): string[] {
  const facts = goalChanceFactsForAgent(result, graph, current);
  const nodes = rec(graph)?.nodes;
  const labels = new Map((Array.isArray(nodes) ? nodes : []).map(rec)
    .filter((n): n is Rec => n !== undefined && typeof n.id === 'string' && typeof n.label === 'string' && n.label.trim() !== '')
    .map((n) => [n.id as string, n.label as string]));
  const recorded = rec(facts.goal_chance_licence?.option_labels_by_option);
  const labelOf = (id: string): string | undefined => {
    const r = recorded?.[id];
    return typeof r === 'string' && r.trim() !== '' ? r : labels.get(id);
  };
  const out: string[] = [];
  const targets = facts.goal_targets;
  if (targets !== undefined) {
    const joint = targets.joint;
    if (joint.status === 'withheld') {
      if (!targets.note_groups?.some((group) => group.joint_line === joint.line)) out.push(joint.line);
      if (joint.frechet_line !== undefined) out.push(joint.frechet_line);
    }
    for (const t of targets.per_target) {
      const each = Object.entries(t.pct_by_option).flatMap(([id, pct]) => {
        const label = labelOf(id);
        return label === undefined ? [] : [`‘${label}’ ${sayDisplayedPct(pct)}`];
      });
      if (each.length > 0) out.push(`On its own, the chance of ${t.words}, in this model: ${each.join('; ')}.`);
    }
  }
  if (facts.goal_chance_status_quo !== undefined) out.push(facts.goal_chance_status_quo.line);
  const saidGroups = new Set<number>();
  for (const note of facts.goal_chance_notes ?? []) {
    // ⭐ Marketing e2e 25d14238 (DL 14 Oct, judge item 2): the card listed each note and the reply said them again, joined
    // into a group line no card line equals, so the route's card filter missed it ("…current level is missing." ×3).
    if (onCard?.has(note) === true) continue;
    const groups = targets?.note_groups?.flatMap((group, index) => group.source_notes.includes(note) ? [{ group, index }] : []) ?? [];
    if (groups.length === 0) out.push(note);
    for (const { group, index } of groups) {
      if (!saidGroups.has(index)) out.push(group.line);
      saidGroups.add(index);
    }
  }
  // ⛔ RE-SCOPE 2 (R5-2): a range resting on an unverified input says so once too (never "zero estimates"), unless said already.
  const ranges = rangeCensusOf(facts, graph);
  const rangeIds = Object.keys(facts.goal_chance_range_display ?? {});
  if (ranges !== undefined && !out.includes(UNVERIFIED_SOURCES_NOTE)
    && (ranges.unread || ranges.unverifiedValues > 0 || ranges.unverifiedLinks > 0
      || rangeIds.some((id) => (ranges.unverifiedSettingsByOption[id] ?? 0) > 0))) {
    out.push(UNVERIFIED_SOURCES_NOTE);
  }
  return out;
}

/** Every licensed cell's SAME sentence, including point forms not owed in narration. */
export function goalChanceCellFacesForAgent(result: unknown, graph: unknown, current: boolean): ReadonlyMap<string, string> {
  const { points, ranges } = composeGoalChanceLines(result, graph, current);
  return new Map([...points, ...ranges].map(line => [line.option_id, line.chance]));
}

/** Check narrator counts without appending any screen sentence. */
export function checkScreenLineClaims(text: string, lines: readonly GoalChanceScreenLine[], sourceTexts: readonly string[] = [], speaker?: 'olumi'): string {
  // Narration never supplies k, even when it guessed correctly. Complete producer-bound sentences are already authorised;
  // keep their exact bytes while applying RC4's existing guard to all other narrator text before deterministic assembly.
  const authorised: string[] = [];
  let body = text;
  if (speaker === 'olumi' || lines.some(l => l.olumi_estimate_link_count !== undefined)) {
    const recordSentences = lines.flatMap(l => [l.olumi_estimate_link_count === undefined ? l.chance : estimatePointSentence(l), l.depends]);
    for (const sentence of [...recordSentences, ...sourceTexts].filter(s => s !== '')) {
      const folded = foldQuotes(body), needle = foldQuotes(sentence);
      const positions: number[] = [];
      for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + needle.length)) positions.push(at);
      for (const at of positions.reverse()) {
        const key = `\u0000GP_ESTIMATE_POINT_${authorised.length}\u0000.`;
        authorised.push(body.slice(at, at + sentence.length));
        body = body.slice(0, at) + key + body.slice(at + sentence.length);
      }
    }
    body = narratorCountGuard(body, null, speaker).text;
    for (const [i, chance] of authorised.entries()) body = body.split(`\u0000GP_ESTIMATE_POINT_${i}\u0000.`).join(chance);
  }
  return body;
}
