/**
 * ⭐ S4c (Wave B4/B5, 7 Oct): THE SCREEN'S CHANCE LINES ARE SAID BY OLUMI.
 *
 * - Ranges (B4, CEE 01a2b27): beside "‘Fourth Shop in Clifton’: between about 4% and 55% chance of meeting your goal, in
 *   this model. …", both Run narrations said only "This run shows some options’ chances only as a range." The prompt asks
 *   the Agent to say each range (coach-route-v0_2); it skipped that 2/2, and no gate removed one (Render logs).
 * - Points (B5 T1b, CEE 3fce64f): the narration said "For reaching at least £126,000 …, on current information:" and then
 *   nothing, while the screen showed 47% / 34% / <1%: the withheld-leader gate deleted the three lines (Render:
 *   withheld_leader_ranking_dropped, 3). Its classifier codes a per-option chance line as a ranking, and the leader is
 *   withheld on a near tie and beside every range, so the prompt rule could never carry these figures.
 *
 * So on a turn that RAN an analysis, each option's chance line is said in the words the screen draws, in the screen's
 * order, owed only when the reply does not already give that option's figure. Points only for the `each` licence (the
 * screen lists every option's own line; superlative and `similar` forms word the headline differently). Never a figure
 * the screen does not show, never an order by size. Placed right after the range opening, else right after a dangling
 * "…on current information:" style lead-in, else as a closing paragraph.
 */
import { goalChanceFactsForAgent } from '../goal-target/goal-chance-range-agent.js';
import { sayDate } from '../goal-target/deadline-date.js';
import { RANGE_OPENING, sameWordsIn } from './goal-chance-withheld.js';

export const GOAL_CHANCE_SCREEN_LINES_OWED = 'GOAL_CHANCE_SCREEN_LINES_OWED';

/** One option's line as the screen words it: the chance sentence, then what it rests or depends on most ('' = none). */
export interface GoalChanceScreenLine {
  readonly option_id: string;
  readonly label: string;
  /** The figure as the screen shows it: "about 46%", "less than 1%", "between about 4% and 55%". */
  readonly figure: string;
  readonly chance: string;
  readonly depends: string;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const CHANCE_LABEL = 'chance of meeting your goal, in this model';

/** The screen's chance lines for the selected Run (`current` = its run state is complete and current); [] otherwise. */
export function goalChanceScreenLinesForAgent(result: unknown, graph: unknown, current: boolean): GoalChanceScreenLine[] {
  const facts = goalChanceFactsForAgent(result, graph, current);
  const nodes = rec(graph)?.nodes;
  const labels = new Map((Array.isArray(nodes) ? nodes : []).map(rec)
    .filter((n): n is Rec => n !== undefined && typeof n.id === 'string' && typeof n.label === 'string' && n.label.trim() !== '')
    .map((n) => [n.id as string, n.label as string]));
  const line = (optionId: string, figure: string, depends: string): GoalChanceScreenLine[] => {
    const label = labels.get(optionId);
    // An option the graph cannot name has no line (the screen drops it too); never an id.
    return label === undefined ? [] : [{ option_id: optionId, label, figure, chance: `‘${label}’: ${figure} ${CHANCE_LABEL}.`, depends }];
  };
  const points = facts.goal_chance_licence?.form === 'each' && facts.goal_chance_display !== undefined
    ? facts.goal_chance_licence.option_ids.flatMap((id) => {
      const figure = facts.goal_chance_display![id];
      return figure === undefined ? [] : line(id, figure, facts.goal_chance_driver_display?.[id] ?? '');
    }) : [];
  const ranges = Object.entries(facts.goal_chance_range_display ?? {}).flatMap(([id, d]) => {
    if (d.depends_on.kind === 'stated_time') {
      const label = labels.get(id), stated = d.stated_time;
      if (label === undefined || stated === undefined) return [];
      const goal = stated.launching ? 'launching' : 'meeting your goal';
      const by = stated.by_date === undefined ? '' : ` by ${sayDate(stated.by_date)}`;
      return [{ option_id: id, label, figure: d.range,
        chance: `‘${label}’: ${d.range} chance of ${goal}${by}, in this model, from the slow end of your ${stated.estimate} to the fast end.`,
        depends: '' }];
    }
    const lead = d.depends_on.among === 'unsized_links' ? 'Of the links not sized yet, it depends most on' : 'It depends most on';
    const link = d.depends_on.kind === 'link_strength'
      ? `how strongly ‘${d.depends_on.from_label}’ affects ‘${d.depends_on.to_label}’, which isn’t sized in the model yet.`
      : `whether ‘${d.depends_on.from_label}’ affects ‘${d.depends_on.to_label}’ at all, which Olumi assumed.`;
    return line(id, d.range, `${lead} ${link}`);
  });
  return [...points, ...ranges];
}

/** Whether the reply already gives this option's figure: the screen's sentence, or the option named with its figure. */
function alreadySaid(text: string, l: GoalChanceScreenLine): boolean {
  if (sameWordsIn(text, l.chance)) return true;
  // The Agent's own phrasing ("Raise prices 10%: about 46%") gives the same figure: never said twice in two wordings.
  const plain = (t: string): string => t.replace(/['"‘’“”`*_]/g, '').replace(/\s+/g, ' ').toLowerCase();
  const p = plain(text);
  return p.includes(plain(l.label)) && p.includes(plain(l.figure));
}

/** A lead-in the Agent left with nothing under it ("For reaching at least £126,000 …, on current information:"). */
const LEAD_IN = /\b(?:chances?|goal|target|reach(?:ing)?|meeting|current information)\b[^\n]{0,200}:$/i;
const LIST_START = /^\s*(?:[-*•]|\d{1,3}[.)])\s/;

/**
 * `text` with every chance line it does not already give; `added` counts the sentences added. A driver sentence the reply
 * already carries word for word, apart from its owed figure (the leader gate keeps it and deletes the figure: B5 T1b), is
 * MOVED to follow that figure, never said twice.
 */
export function withScreenLinesOwed(text: string, lines: readonly GoalChanceScreenLine[]): { text: string; added: number } {
  let body = text;
  const owed: string[] = [];
  let added = 0;
  for (const l of lines) {
    if (alreadySaid(body, l)) continue;
    owed.push(l.chance);
    added += 1;
    if (l.depends === '') continue;
    const at = body.indexOf(l.depends);
    if (at >= 0) {
      body = `${body.slice(0, at)}${body.slice(at + l.depends.length)}`;
      owed.push(l.depends);
    } else if (!sameWordsIn(body, l.depends)) {
      owed.push(l.depends);
      added += 1;
    }
  }
  if (owed.length === 0) return { text, added: 0 };
  // What a move leaves behind: no doubled spaces, no blank paragraph.
  body = body.split('\n\n').map((p) => p.replace(/[ \t]{2,}/g, ' ').trim()).filter((p) => p !== '').join('\n\n');
  const said = owed.join(' ');
  const at = body.indexOf(RANGE_OPENING);
  if (at >= 0) {
    const end = at + RANGE_OPENING.length;
    return { text: `${body.slice(0, end)} ${said}${body.slice(end)}`, added };
  }
  const paras = body.split('\n\n');
  const lead = paras.findIndex((p, i) => LEAD_IN.test(p.trim())
    && (i + 1 >= paras.length || (!LIST_START.test(paras[i + 1]!) && !lines.some((l) => paras[i + 1]!.includes(l.label)))));
  if (lead >= 0) return { text: [...paras.slice(0, lead + 1), said, ...paras.slice(lead + 1)].join('\n\n'), added };
  return { text: body.trim() === '' ? said : `${body.trimEnd()}\n\n${said}`, added };
}
