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
import { shortfallNoteLabel } from '../goal-target/goal-chance-licence.js';
import { RANGE_OPENING, sameWordsIn } from './goal-chance-withheld.js';

export const GOAL_CHANCE_SCREEN_LINES_OWED = 'GOAL_CHANCE_SCREEN_LINES_OWED';

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
  const line = (optionId: string, figure: string, depends: string, spreadNote?: string, shortfallNote?: string): GoalChanceScreenLine[] => {
    const label = labels.get(optionId);
    // An option the graph cannot name has no line (the screen drops it too); never an id.
    if (label === undefined) return [];
    // The licence checks the two exact templates; this reader owns whether their named option is the graph's label.
    const shortfall = shortfallNoteLabel(shortfallNote) === label ? shortfallNote : undefined;
    return [{ option_id: optionId, label, figure, chance: `‘${label}’: ${figure} ${CHANCE_LABEL}.`
      + (spreadNote === undefined ? '' : ` ${spreadNote}`) + (shortfall === undefined ? '' : ` ${shortfall}`), depends,
      ...(spreadNote === undefined ? {} : { spread_note: spreadNote }),
      ...(shortfall === undefined ? {} : { shortfall_note: shortfall }) }];
  };
  const points = facts.goal_chance_licence?.form === 'each' && facts.goal_chance_display !== undefined
    ? facts.goal_chance_licence.option_ids.flatMap((id) => {
      const figure = facts.goal_chance_display![id];
      return figure === undefined ? [] : line(id, figure, facts.goal_chance_driver_display?.[id] ?? '',
        facts.goal_chance_licence?.spread_note_by_option?.[id], facts.goal_chance_licence?.shortfall_note_by_option?.[id]);
    }) : [];
  const ranges = Object.entries(facts.goal_chance_range_display ?? {}).flatMap(([id, d]) => {
    const lead = d.depends_on.among === 'unsized_links' ? 'Of the links not sized yet, it depends most on' : 'It depends most on';
    const link = d.depends_on.kind === 'link_strength'
      ? `how strongly ‘${d.depends_on.from_label}’ affects ‘${d.depends_on.to_label}’, which isn’t sized in the model yet.`
      : `whether ‘${d.depends_on.from_label}’ affects ‘${d.depends_on.to_label}’ at all, which Olumi assumed.`;
    return line(id, d.range, `${lead} ${link}`);
  });
  return [...points, ...ranges];
}

/** Every exact occurrence of `needle` in `text`. */
function spansOf(text: string, needle: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (let at = text.indexOf(needle); needle !== '' && at >= 0; at = text.indexOf(needle, at + needle.length)) {
    spans.push({ start: at, end: at + needle.length });
  }
  return spans;
}

/**
 * ⭐ B19 (DL ruling, 8 Oct: EXACT-ONLY, correctness by construction). A line that carries CEE's notes (the spread note,
 * the shortfall sentence) is said only as CEE's whole unit, never assembled inside the Agent's own wording: no label,
 * figure or quote is matched loosely. Every option's exact unit is masked first, so a shared spread sentence inside
 * another option's unit is never touched. The first exact unit stays; outside every unit, this line's notes are removed;
 * else the screen's own chance sentence (bare, or with its spread note) becomes the unit in place; else the unit is owed.
 * Known row: beside the Agent's own phrasing ("Raise prices 10%: about 55%.") the figure is said twice.
 */
function withNotesUnit(body: string, l: GoalChanceScreenLine, lines: readonly GoalChanceScreenLine[]): { text: string; owed: boolean } {
  const chanceOnly = `‘${l.label}’: ${l.figure} ${CHANCE_LABEL}.`;
  const noted = lines.filter((o) => o.spread_note !== undefined || o.shortfall_note !== undefined);
  const strays = (segment: string): string => {
    let clean = segment;
    if (l.shortfall_note !== undefined) clean = clean.split(l.shortfall_note).join('');
    if (l.spread_note !== undefined) clean = clean.split(l.spread_note).join('');
    return clean;
  };
  // Outside every option's exact unit (first occurrence of this line's own unit kept; its later copies are strays).
  const keptOwn = spansOf(body, l.chance)[0];
  const masks = [...noted.filter((o) => o.option_id !== l.option_id).flatMap((o) => spansOf(body, o.chance)),
    ...(keptOwn !== undefined ? [keptOwn] : [])].sort((x, y) => x.start - y.start)
    .filter((m, i, all) => i === 0 || m.start >= all[i - 1]!.end);
  let clean = '';
  let from = 0;
  for (const m of masks) {
    clean += strays(body.slice(from, m.start).split(l.chance).join('')) + body.slice(m.start, m.end);
    from = m.end;
  }
  clean += strays(body.slice(from).split(l.chance).join(''));
  if (keptOwn !== undefined) return { text: clean, owed: false };
  // The screen's own chance sentence, as it stands after the strays went, becomes the unit in place.
  const at = clean.indexOf(chanceOnly);
  if (at >= 0) return { text: `${clean.slice(0, at)}${l.chance}${clean.slice(at + chanceOnly.length)}`, owed: false };
  return { text: clean, owed: true };
}

/** A line WITHOUT notes: whether the reply already gives its figure (the screen's sentence, or the option named with it). */
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
  const owedBy = new Map<string, string[]>();
  let added = 0;
  for (const l of lines) {
    const owed: string[] = [];
    owedBy.set(l.option_id, owed);
    const notes = [l.spread_note, l.shortfall_note].filter((n): n is string => n !== undefined);
    if (notes.length > 0) {
      const said = withNotesUnit(body, l, lines);
      // Counted as said only when its unit is new here (a re-formed unit adds nothing).
      if (said.text.split(l.chance).length > body.split(l.chance).length) added += 1;
      body = said.text;
      if (!said.owed) continue;
    } else if (alreadySaid(body, l)) continue;
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
  const owed = lines.flatMap((l) => owedBy.get(l.option_id) ?? []);
  if (owed.length === 0) return { text: body, added };
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
