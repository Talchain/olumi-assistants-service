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
import { foldQuotes } from './quote-normalisation.js';

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

const plain = (t: string): string => t.replace(/['"‘’“”`*_]/g, '').replace(/\s+/g, ' ').toLowerCase();
// Keep quote delimiters inside a candidate label: ‘Raise’ prices is not the option ‘Raise prices’.
const labelWords = (t: string): string => foldQuotes(t).replace(/[*_]/g, '').replace(/\s+/g, ' ').toLowerCase();
interface Span { start: number; end: number }

/** Match normalized words, retaining the span of the actual quoted/styled source. */
function plainSpans(value: string, words: string, normalise = plain): Span[] {
  const starts: number[] = [];
  const ends: number[] = [];
  let normalized = '';
  for (const m of value.matchAll(/['"‘’“”`*_]|\s+|[^]/g)) {
    for (const c of normalise(m[0])) {
      if (c === ' ' && normalized.endsWith(' ')) {
        ends[ends.length - 1] = m.index + m[0].length;
      } else {
        normalized += c;
        starts.push(m.index);
        ends.push(m.index + m[0].length);
      }
    }
  }
  const needle = normalise(words);
  const spans: Span[] = [];
  if (needle === '') return spans;
  for (let at = normalized.indexOf(needle); at >= 0; at = normalized.indexOf(needle, at + needle.length)) {
    spans.push({ start: starts[at]!, end: ends[at + needle.length - 1]! });
  }
  return spans;
}

function withoutSpans(value: string, spans: readonly Span[]): string {
  let clean = value;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    clean = clean.slice(0, span.start) + clean.slice(span.end);
  }
  return clean;
}

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u;
const QUOTE_CLOSE: Readonly<Record<string, string>> = { "'": "'", '"': '"', '‘': '’', '“': '”', '`': '`' };

/** Complete option identities: a quoted label stands alone; an unquoted prefix cannot name a longer option. */
function labelSpans(row: string, l: GoalChanceScreenLine, lines: readonly GoalChanceScreenLine[]): Span[] {
  return plainSpans(row, l.label, labelWords).filter(label => {
    const before = row.slice(0, label.start).replace(/[*_]+$/, '');
    const after = row.slice(label.end).replace(/^[*_]+/, '');
    const closing = QUOTE_CLOSE[before.at(-1) ?? ''];
    if (closing !== undefined && after.startsWith(closing)) return true;
    if (WORD_CHARACTER.test(plain(before).at(-1) ?? '') || WORD_CHARACTER.test(plain(after)[0] ?? '')) return false;
    return !lines.some(other => other.option_id !== l.option_id && labelWords(other.label).length > labelWords(l.label).length
      && plainSpans(row, other.label, labelWords).some(longer => longer.start <= label.start && longer.end >= label.end));
  });
}

/** A named figure in its own clause; a note's orphaned option label cannot borrow a later option's figure. */
function chanceSpans(row: string, l: GoalChanceScreenLine, lines: readonly GoalChanceScreenLine[]): (Span & { figureEnd: number })[] {
  return labelSpans(row, l, lines).flatMap(label => {
    const figure = plainSpans(row, l.figure).find(span => span.start >= label.end
      && !/[.;]/.test(row.slice(label.end, span.start)));
    return figure === undefined ? [] : [{ start: label.start, end: figure.end, figureEnd: figure.end }];
  });
}

/** Shared spread words belong to their chance unit, their named shortfall pair, or a standalone spread row. */
function noteSpans(row: string, l: GoalChanceScreenLine, lines: readonly GoalChanceScreenLine[]): Span[] {
  const shortfalls = l.shortfall_note === undefined ? [] : plainSpans(row, l.shortfall_note);
  if (l.spread_note === undefined) return shortfalls;
  const pairs = l.shortfall_note === undefined ? [] : [
    ...plainSpans(row, `${l.spread_note} ${l.shortfall_note}`),
    ...plainSpans(row, `${l.shortfall_note} ${l.spread_note}`),
  ];
  const otherPairs = lines.flatMap(other => other.option_id === l.option_id || other.spread_note === undefined
    || other.shortfall_note === undefined ? [] : [
      ...plainSpans(row, `${other.spread_note} ${other.shortfall_note}`),
      ...plainSpans(row, `${other.shortfall_note} ${other.spread_note}`),
    ]);
  // Preserve offsets while hiding labels inside shortfall sentences from chance detection.
  let chanceRow = row;
  const allShortfalls = lines.flatMap(other => other.shortfall_note === undefined ? [] : plainSpans(row, other.shortfall_note));
  for (const span of allShortfalls) {
    chanceRow = chanceRow.slice(0, span.start) + ' '.repeat(span.end - span.start) + chanceRow.slice(span.end);
  }
  const chances = lines.flatMap(other => chanceSpans(chanceRow, other, lines).map(span => ({ ...span, option_id: other.option_id })))
    .sort((a, b) => a.start - b.start);
  const spreads = plainSpans(row, l.spread_note).filter(span => {
    if (pairs.some(pair => pair.start <= span.start && span.end <= pair.end)) return true;
    if (otherPairs.some(pair => pair.start <= span.start && span.end <= pair.end)) return false;
    if (plain(row).trim() === plain(l.spread_note!).trim()) return true;
    const preceding = chances.filter(chance => chance.figureEnd <= span.start).at(-1);
    return preceding?.option_id === l.option_id
      || (preceding === undefined && chances.length > 0 && chances.every(chance => chance.option_id === l.option_id));
  });
  return [...shortfalls, ...spreads];
}

/** Whether the reply already gives exactly one of this option's complete chance/notes units. */
function alreadySaid(text: string, l: GoalChanceScreenLine, lines: readonly GoalChanceScreenLine[]): boolean {
  // The Agent's own phrasing ("Raise prices 10%: about 46%") gives the same figure: never said twice in two wordings.
  if (l.spread_note !== undefined || l.shortfall_note !== undefined) {
    const notes = [l.spread_note, l.shortfall_note].filter((note): note is string => note !== undefined);
    const suffix = notes.join(' ');
    // A split or orphaned note is moved beside its chance, including when one complete unit already has a duplicate note.
    const rows = text.split('\n');
    if (rows.flatMap(row => noteSpans(row, l, lines)).length !== notes.length) return false;
    if (l.shortfall_note === undefined) {
      // Keep the established spread-only wording/placement when its one owned note is already said.
      return rows.some(row => chanceSpans(row, l, lines).length > 0 && noteSpans(row, l, lines).length === 1);
    }
    return rows.some(row => {
      const p = plain(row);
      return chanceSpans(row, l, lines).some(chance => {
        const figureEnd = plain(row.slice(0, chance.figureEnd)).length;
        const notesAt = p.indexOf(plain(suffix), figureEnd);
        if (notesAt < 0) return false;
        const figureTail = p.slice(figureEnd, notesAt);
        const stop = figureTail.search(/[.;]/);
        return stop < 0 || figureTail.slice(stop + 1).trim() === '';
      });
    });
  }
  return text.split('\n').some(row => chanceSpans(row, l, lines).length > 0);
}

/** A lead-in the Agent left with nothing under it ("For reaching at least £126,000 …, on current information:"). */
const LEAD_IN = /\b(?:chances?|goal|target|reach(?:ing)?|meeting|current information)\b[^\n]{0,200}:$/i;
const LIST_START = /^\s*(?:[-*•]|\d{1,3}[.)])\s/;

/**
 * `text` with every chance line it does not already give; `added` counts the sentences added. A driver sentence the reply
 * already carries word for word, apart from its owed figure (the leader gate keeps it and deletes the figure: B5 T1b), is
 * MOVED to follow that figure, never said twice. A licensed spread + shortfall pair moves as one unit beside its chance.
 */
export function withScreenLinesOwed(text: string, lines: readonly GoalChanceScreenLine[]): { text: string; added: number } {
  let body = text;
  const owed: string[] = [];
  let added = 0;
  for (const l of lines) {
    const notes = [l.spread_note, l.shortfall_note].filter((note): note is string => note !== undefined);
    const suffix = notes.length === 0 ? undefined : notes.join(' ');
    const chanceOnly = suffix === undefined ? l.chance : l.chance.slice(0, l.chance.length - suffix.length).trimEnd();
    const withoutNotes = (value: string): string => value.split('\n')
      .map(row => withoutSpans(row, noteSpans(row, l, lines))).join('\n');
    if (suffix !== undefined && !alreadySaid(body, l, lines)) {
      if (body.includes(chanceOnly)) {
        body = withoutNotes(body);
        body = body.replace(chanceOnly, l.chance);
        added += 1;
      } else {
        // A shortfall itself names the option. Its orphaned label must not borrow another option's figure on that row.
        const candidate = withoutNotes(body);
        const rows = candidate.split('\n');
        const rowAt = rows.findIndex(row => chanceSpans(row, l, lines).length > 0);
        if (rowAt >= 0) {
          body = candidate;
          const cleanRows = body.split('\n');
          const row = cleanRows[rowAt]!;
          const figureEnd = chanceSpans(row, l, lines)[0]!.figureEnd;
          const stop = row.slice(figureEnd).search(/[.;]/);
          const end = stop < 0 ? row.length : figureEnd + stop + 1;
          cleanRows[rowAt] = `${row.slice(0, end)} ${suffix}${row.slice(end)}`;
          body = cleanRows.join('\n');
          added += 1;
        }
      }
    }
    if (alreadySaid(body, l, lines)) continue;
    // Move any existing note behind its own chance, including when the Agent gave only the figure.
    if (suffix !== undefined) {
      body = withoutNotes(body);
      body = body.split(chanceOnly).join('');
    }
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
