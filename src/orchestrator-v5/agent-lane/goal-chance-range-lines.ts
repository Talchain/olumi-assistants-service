/**
 * ⭐ S4c (Wave B4, 7 Oct 05:00–05:08Z, CEE 01a2b27): beside a range line on the screen ("‘Fourth Shop in Clifton’: between
 * about 4% and 55% chance of meeting your goal, in this model. Of the links not sized yet, it depends most on …"), both
 * Run narrations said only "This run shows some options’ chances only as a range." — no figure. The prompt asks the
 * Agent to say each range (coach-route-v0_2), and it skipped that rule 2/2. Render logs for that window show no gate
 * removed one: the omission was the model's.
 *
 * So the screen's own line is said by Olumi on a turn that RAN an analysis: each range option's line, in the words the
 * screen draws (DGAI `goalChanceRangeLine`), in the record's order, owed only when the reply does not already say it
 * (`sameWordsIn`: quotes and emphasis ignored). Never a point figure for a ranged option, never an order by size.
 * Placed right after the range opening when the reply has it, otherwise as its own closing paragraph.
 */
import { goalChanceFactsForAgent } from '../goal-target/goal-chance-range-agent.js';
import { RANGE_OPENING, sameWordsIn } from './goal-chance-withheld.js';

export const GOAL_CHANCE_RANGE_LINES_OWED = 'GOAL_CHANCE_RANGE_LINES_OWED';

/** One ranged option's two sentences, exactly as the screen words them. */
export interface GoalChanceRangeLine {
  readonly option_id: string;
  readonly range: string;
  readonly depends: string;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;

/** The screen's range lines for the selected Run (`current` = its run state is complete and current); [] otherwise. */
export function goalChanceRangeLinesForAgent(result: unknown, graph: unknown, current: boolean): GoalChanceRangeLine[] {
  const ranges = goalChanceFactsForAgent(result, graph, current).goal_chance_range_display;
  if (ranges === undefined) return [];
  const nodes = rec(graph)?.nodes;
  const labels = new Map((Array.isArray(nodes) ? nodes : []).map(rec)
    .filter((n): n is Rec => n !== undefined && typeof n.id === 'string' && typeof n.label === 'string' && n.label.trim() !== '')
    .map((n) => [n.id as string, n.label as string]));
  return Object.entries(ranges).flatMap(([optionId, d]) => {
    const option = labels.get(optionId);
    // An option the graph cannot name has no line (the screen drops it too); never an id.
    if (option === undefined) return [];
    const lead = d.depends_on.among === 'unsized_links' ? 'Of the links not sized yet, it depends most on' : 'It depends most on';
    const link = d.depends_on.kind === 'link_strength'
      ? `how strongly ‘${d.depends_on.from_label}’ affects ‘${d.depends_on.to_label}’, which isn’t sized in the model yet.`
      : `whether ‘${d.depends_on.from_label}’ affects ‘${d.depends_on.to_label}’ at all, which Olumi assumed.`;
    return [{ option_id: optionId, range: `‘${option}’: ${d.range} chance of meeting your goal, in this model.`, depends: `${lead} ${link}` }];
  });
}

/** `text` with every range sentence it does not already say; `added` counts the sentences added. */
export function withRangeLinesOwed(text: string, lines: readonly GoalChanceRangeLine[]): { text: string; added: number } {
  const owed = lines.flatMap((l) => [l.range, l.depends].filter((s) => !sameWordsIn(text, s)));
  if (owed.length === 0) return { text, added: 0 };
  const said = owed.join(' ');
  const at = text.indexOf(RANGE_OPENING);
  if (at < 0) return { text: text.trim() === '' ? said : `${text.trimEnd()}\n\n${said}`, added: owed.length };
  const end = at + RANGE_OPENING.length;
  return { text: `${text.slice(0, end)} ${said}${text.slice(end)}`, added: owed.length };
}
