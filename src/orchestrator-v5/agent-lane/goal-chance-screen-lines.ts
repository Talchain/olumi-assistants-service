import { shareGoalChanceWords } from '../goal-target/share-goal-chance-words.js';
export { shareGoalChanceWords } from '../goal-target/share-goal-chance-words.js';
import { shareByDateGoalOf } from '../goal-target/goal-kind.js';
import { shareOptionEstimateWords } from '../goal-target/share-by-date-run.js';
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
 * order, owed only when the reply does not already give that option's figure. For a B19 shortfall option, only its complete
 * canonical chance/notes line counts as said (quote glyphs aside); any other Agent wording stays as it stands.
 * Points only for the `each` licence (the
 * screen lists every option's own line; superlative and `similar` forms word the headline differently). Never a figure
 * the screen does not show, never an order by size. Placed right after the range opening, else right after a dangling
 * "…on current information:" style lead-in, else as a closing paragraph.
 */
import { goalChanceFactsForAgent } from '../goal-target/goal-chance-range-agent.js';
import { sayDate } from '../goal-target/deadline-date.js';
import { shortfallNoteLabel } from '../goal-target/goal-chance-licence.js';
import { RANGE_OPENING, sameWordsIn } from './goal-chance-withheld.js';
import { foldQuotes } from './quote-normalisation.js';
import { withB3LinesAtRest } from './decision-input-ask.js';
import { sentencesOf } from './reply/compose-reply.js';

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

/**
 * Science goals §(r)(b): ONE omission beside the chance for risks kept out by Olumi's draft-time producer family.
 * Participation and authorship are the persisted carrier; no new node field or inference from a risk's label.
 */
export function unitlessRiskChanceCaveatForAgent(graph: unknown): string | undefined {
  const g = rec(graph);
  const nodes = (Array.isArray(g?.nodes) ? g.nodes : []).map(rec).filter((n): n is Rec => n !== undefined);
  const excluded = nodes.filter(n => n.kind === 'risk' && n.analysis_participation === 'retained_excluded'
    && n.provenance === 'ai_inferred' && typeof n.id === 'string' && typeof n.label === 'string' && n.label.trim() !== '');
  if (excluded.length === 0) return undefined;
  const goals = nodes.filter(n => n.kind === 'goal' && typeof n.id === 'string');
  const byId = new Map(nodes.filter(n => typeof n.id === 'string').map(n => [n.id as string, n]));
  const outgoing = new Map<string, Rec[]>();
  for (const e of (Array.isArray(g?.edges) ? g.edges : []).map(rec)) {
    if (e === undefined || typeof e.from !== 'string' || typeof e.to !== 'string' || !byId.has(e.to)) continue;
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e]);
  }
  const signOf = (e: Rec): number => {
    if (e.effect_direction === 'positive') return 1;
    if (e.effect_direction === 'negative') return -1;
    // An explicitly unknown sign stays unknown, even beside a placeholder strength.
    if (e.effect_direction !== undefined) return 0;
    const mean = rec(e.strength)?.mean;
    return typeof mean === 'number' && Number.isFinite(mean) ? Math.sign(mean) : 0;
  };
  const pointsDown = (riskId: string): boolean => {
    if (goals.length !== 1) return false;
    const goalId = goals[0]!.id;
    let reachesGoal = false;
    const pending: { id: string; sign: number }[] = [{ id: riskId, sign: 1 }];
    // At most three signed states per node: bounded even for a malformed cyclic graph. Unknown propagates as 0.
    const visited = new Map<string, Set<number>>();
    for (let at = 0; at < pending.length; at += 1) {
      const state = pending[at]!;
      const seen = visited.get(state.id) ?? new Set<number>();
      if (seen.has(state.sign)) continue;
      seen.add(state.sign);
      visited.set(state.id, seen);
      for (const e of outgoing.get(state.id) ?? []) {
        const to = e.to as string;
        const kind = byId.get(to)?.kind;
        if (kind === 'option' || kind === 'decision') continue;
        const sign = state.sign * signOf(e);
        if (to === goalId) {
          reachesGoal = true;
          if (sign !== -1) return false;
        } else pending.push({ id: to, sign });
      }
    }
    return reachesGoal;
  };
  const first = excluded[0]!;
  const others = excluded.length - 1;
  const omission = `It doesn't yet include ‘${first.label}’${others === 0 ? '' : ` (and ${others} other risk${others === 1 ? '' : 's'} Olumi added)`}`;
  return `${omission}, so it ${excluded.every(n => pointsDown(n.id as string)) ? 'may be too high' : "may move when they're included"}.`;
}

/** Place the omission after this turn's chance findings, including accepted narrator words and their qualifiers. */
export function withUnitlessRiskChanceCaveat(text: string, lines: readonly GoalChanceScreenLine[], caveat?: string): string {
  if (caveat === undefined || caveat.trim() === '') return text;
  const foldedCaveat = foldQuotes(caveat);
  let body = text;
  // Own the ONE omission, even if the narrator put a copy elsewhere. Remove only exact copies (quotes aside).
  for (let at = foldQuotes(body).lastIndexOf(foldedCaveat); at >= 0; at = foldQuotes(body).lastIndexOf(foldedCaveat)) {
    const start = at > 0 && body[at - 1] === ' ' ? at - 1 : at;
    body = `${body.slice(0, start)}${body.slice(at + caveat.length)}`;
  }
  let afterEvidence = -1;
  const folded = foldQuotes(body);
  // The existing chance reader accepts markdown styling and collapsed whitespace. Reuse its exact reading and find
  // the source end by monotonic prefix search, so this placement reader cannot invent a competing normalizer.
  const sameWordsEnd = (source: string, finding: string): number => {
    if (!sameWordsIn(source, finding)) return -1;
    let low = 0, high = source.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (sameWordsIn(source.slice(0, mid), finding)) high = mid;
      else low = mid + 1;
    }
    return low;
  };
  const closingEnd = (source: string, end: number): number => end + /^["'”’`*_]{0,4}/.exec(source.slice(end))![0].length;
  for (const line of lines) {
    const findings = [line.chance, ...ownWordsLeadTexts(body, line, sentencesOf)];
    for (const finding of findings) {
      const at = folded.lastIndexOf(foldQuotes(finding));
      let end = at < 0 ? sameWordsEnd(body, finding) : at + finding.length;
      if (end < 0) continue;
      end = closingEnd(body, end);
      if (line.depends !== '') {
        const gap = /^\s+/.exec(body.slice(end))?.[0] ?? '';
        if (gap !== '') {
          const tail = body.slice(end + gap.length);
          const driverEnd = foldQuotes(tail).startsWith(foldQuotes(line.depends)) ? line.depends.length : sameWordsEnd(tail, line.depends);
          // Only the immediately following driver's own words qualify; an unrelated prefix never extends the finding.
          if (driverEnd >= 0 && sameWordsIn(line.depends, tail.slice(0, driverEnd))) {
            end += gap.length + closingEnd(tail, driverEnd);
          }
        }
      }
      afterEvidence = Math.max(afterEvidence, end);
    }
  }
  if (afterEvidence < 0) return withB3LinesAtRest(body, [caveat]);
  return `${body.slice(0, afterEvidence)} ${caveat}${body.slice(afterEvidence)}`;
}

/** The screen's chance lines for the selected Run (`current` = its run state is complete and current); [] otherwise. */
export function goalChanceScreenLinesForAgent(result: unknown, graph: unknown, current: boolean): GoalChanceScreenLine[] {
  const facts = goalChanceFactsForAgent(result, graph, current);
  const share = shareByDateGoalOf(graph);
  const chanceWords = facts.goal_chance_words !== undefined ? `${facts.goal_chance_words}, in this model`
    : share === null ? CHANCE_LABEL
      : `${shareGoalChanceWords(String(share.goal.goal_threshold_unit).replace(/^(?:%|percent)[ \t]{1,4}of[ \t]{1,4}/i, ''), share.deadline)}, in this model`;
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
    const estimates = shareOptionEstimateWords(graph, optionId);
    return [{ option_id: optionId, label, figure,
      chance: `‘${label}’: ${figure} ${chanceWords}${estimates === '' ? '' : `, ${estimates}`}.`
        + (spreadNote === undefined ? '' : ` ${spreadNote}`) + (shortfall === undefined ? '' : ` ${shortfall}`), depends,
      ...(spreadNote === undefined ? {} : { spread_note: spreadNote }),
      ...(shortfall === undefined ? {} : { shortfall_note: shortfall }) }];
  };
  const points = (facts.goal_chance_licence?.form === 'each' || facts.goal_chance_words !== undefined || share !== null) && facts.goal_chance_display !== undefined
    ? facts.goal_chance_licence!.option_ids.flatMap((id) => {
      const figure = facts.goal_chance_display![id];
      return figure === undefined ? [] : line(id, figure, facts.goal_chance_driver_display?.[id] ?? '',
        facts.goal_chance_licence?.spread_note_by_option?.[id], facts.goal_chance_licence?.shortfall_note_by_option?.[id]);
    }) : [];
  const ranges = Object.entries(facts.goal_chance_range_display ?? {}).flatMap(([id, d]) => {
    if (d.depends_on.kind === 'stated_time') {
      const label = labels.get(id), stated = d.stated_time;
      if (label === undefined || stated === undefined) return [];
      const words = stated.deliverable !== undefined && stated.by_date !== undefined
        ? shareGoalChanceWords(stated.deliverable, stated.by_date)
        : `chance of meeting your goal${stated.by_date === undefined ? '' : ` by ${sayDate(stated.by_date)}`}`;
      const estimates = shareOptionEstimateWords(graph, id);
      const tail = `in this model${estimates === '' ? '' : `, ${estimates}`}`;
      const extremeEndpoints = d.range === 'between less than 1% and more than 99%'
        && stated.slow_time !== undefined && stated.fast_time !== undefined;
      return [{ option_id: id, label, figure: d.range,
        chance: extremeEndpoints
          ? `‘${label}’: less than 1% ${words} if it takes ${stated.slow_time}, and more than 99% if it takes ${stated.fast_time}, ${tail}.`
          : `‘${label}’: ${d.range} ${words}, ${tail}, from the slow end of your ${stated.estimate} to the fast end.`,
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

/**
 * B15 (DL CHANGES_REQUIRED on #2783, Codex P1): ONE sentence in which the narrator gave this option's screen figure in its
 * own accepted words (the option named, then its figure) — the same acceptance `alreadySaid` uses, bound to one sentence
 * so the route can type it as this finding's leading evidence. Never the canonical sentence (typed already).
 */
export function chanceInOwnWords(sentence: string, l: GoalChanceScreenLine): boolean {
  // EXACTLY "<label>: <figure>." (quotes/emphasis aside): the sentence IS this option's figure, never a share or a range
  // that mentions it, never a longer label that starts with this one (Codex r on 297d1f1b, P1).
  const plain = (t: string): string => t.replace(/['"‘’“”`*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const said = plain(sentence).replace(/[.!]$/, '');
  const own = `${plain(l.label)}: ${plain(l.figure)}`;
  // Also the screen's own words with the Agent's emphasis/quotes ("**Label**: about 47% chance of meeting your goal, …").
  return sentence !== l.chance && (said === own || said === `${own} ${plain(CHANCE_LABEL)}`);
}

/**
 * The leading-evidence texts for this option's figure said in the narrator's own accepted words: the sentence, and — when
 * the screen's spread note follows it (as `withScreenLinesOwed` places it) — the sentence WITH its note as ONE unit, so the
 * qualifier can never be split from its chance (Codex r3 on #2783 ed3964a6, P1). [] when the canonical line is present.
 */
export function ownWordsLeadTexts(reply: string, l: GoalChanceScreenLine, sentencesOf: (row: string) => string[]): string[] {
  if (l.shortfall_note !== undefined || reply.includes(l.chance)) return [];
  const said = reply.split('\n').map((row) => row.replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/, ''))
    .flatMap((row) => sentencesOf(row)).find((sentence) => chanceInOwnWords(sentence, l));
  if (said === undefined) return [];
  if (l.spread_note === undefined) return [said];
  // The note as it actually stands right after the sentence (spacing and the Agent's emphasis aside), bound as said.
  const plain = (t: string): string => t.replace(/['"‘’“”`*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const at = reply.indexOf(said);
  const after = reply.slice(at + said.length);
  const lead = /^[ \t]+/.exec(after)?.[0] ?? '';
  const want = plain(l.spread_note);
  for (let end = lead.length + 1; end <= Math.min(after.length, lead.length + l.spread_note.length * 2); end += 1) {
    if (after[end - 1] === '\n') break;
    if (plain(after.slice(lead.length, end)) !== want) continue;
    // Closing emphasis/quotes after the note's stop belong to it ("…further **short.**": Codex r5 on #2783).
    const close = /^["'”’`*_]{0,4}/.exec(after.slice(end))![0];
    return [`${said}${after.slice(0, end + close.length)}`, said];
  }
  return [said];
}

/** Whether the reply already gives this option's figure: the screen's sentence, or the option named with its figure. */
function alreadySaid(text: string, l: GoalChanceScreenLine): boolean {
  // B19 r3: only this complete canonical unit pays a shortfall option; quote folding preserves source offsets.
  if (l.shortfall_note !== undefined) return foldQuotes(text).includes(foldQuotes(l.chance));
  if (sameWordsIn(text, l.chance)) return true;
  // The Agent's own phrasing ("Raise prices 10%: about 46%") gives the same figure: never said twice in two wordings.
  const plain = (t: string): string => t.replace(/['"‘’“”`*_]/g, '').replace(/\s+/g, ' ').toLowerCase();
  if (l.spread_note !== undefined) return text.split('\n').some(row =>
    plain(row).includes(plain(l.label)) && plain(row).includes(plain(l.figure)) && sameWordsIn(row, l.spread_note!));
  const p = plain(text);
  return p.includes(plain(l.label)) && p.includes(plain(l.figure));
}

/** Canonical shortfall units are opaque to the existing spread-only path, even when their spread words match. */
function shortfallUnitsIn(text: string, lines: readonly GoalChanceScreenLine[]): { start: number; end: number }[] {
  const folded = foldQuotes(text);
  const spans = lines.filter(l => l.shortfall_note !== undefined).flatMap(l => {
    const needle = foldQuotes(l.chance);
    const found: { start: number; end: number }[] = [];
    for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + needle.length)) {
      found.push({ start: at, end: at + needle.length });
    }
    return found;
  }).sort((a, b) => a.start - b.start);
  return spans.filter((span, i) => i === 0 || span.start >= spans[i - 1]!.end);
}

function outsideShortfallUnits(text: string, lines: readonly GoalChanceScreenLine[], change: (part: string) => string): string {
  let at = 0;
  let result = '';
  for (const span of shortfallUnitsIn(text, lines)) {
    result += change(text.slice(at, span.start)) + text.slice(span.start, span.end);
    at = span.end;
  }
  return result + change(text.slice(at));
}

/** A lead-in the Agent left with nothing under it ("For reaching at least £126,000 …, on current information:"). */
export const LEAD_IN = /\b(?:chances?|goal|target|reach(?:ing)?|meeting|current information)\b[^\n]{0,200}:$/i;
const LIST_START = /^\s*(?:[-*•]|\d{1,3}[.)])\s/;

/**
 * `text` with every chance line it does not already give; `added` counts the sentences added. A driver sentence the reply
 * already carries word for word, apart from its owed figure (the leader gate keeps it and deletes the figure: B5 T1b), is
 * MOVED to follow that figure for options without shortfalls. A shortfall option only appends its missing canonical unit;
 * its existing wording, notes and driver sentence stay as they stand.
 */
export function withScreenLinesOwed(text: string, lines: readonly GoalChanceScreenLine[]): { text: string; added: number } {
  let body = text;
  const hasShortfall = lines.some(l => l.shortfall_note !== undefined);
  const spreadBody = (value: string): string => {
    let masked = value;
    for (const span of shortfallUnitsIn(value, lines).reverse()) {
      masked = masked.slice(0, span.start) + ' '.repeat(span.end - span.start) + masked.slice(span.end);
    }
    return masked;
  };
  const removeSpread = (value: string, note: string): string => outsideShortfallUnits(value, lines, part => part.split(note).join(''));
  const owed: string[] = [];
  let added = 0;
  for (const l of lines) {
    if (l.shortfall_note !== undefined) {
      if (alreadySaid(body, l)) continue;
      owed.push(l.chance);
      added += 1;
      // Preserve the Agent's own text for this option, including any existing driver sentence.
      if (l.depends !== '' && !sameWordsIn(body, l.depends)) {
        owed.push(l.depends);
        added += 1;
      }
      continue;
    }
    if (l.spread_note !== undefined && !alreadySaid(spreadBody(body), l)) {
      const chanceOnly = l.chance.slice(0, l.chance.length - l.spread_note.length).trimEnd();
      if (spreadBody(body).includes(chanceOnly)) {
        body = removeSpread(body, l.spread_note);
        let replaced = false;
        body = outsideShortfallUnits(body, lines, part => {
          if (replaced || !part.includes(chanceOnly)) return part;
          replaced = true;
          return part.replace(chanceOnly, l.chance);
        });
        added += 1;
      } else {
        const rows = spreadBody(body).split('\n');
        const rowAt = rows.findIndex(row => row.includes(l.label) && row.includes(l.figure));
        if (rowAt >= 0) {
          body = removeSpread(body, l.spread_note);
          const cleanRows = body.split('\n');
          const row = cleanRows[rowAt]!;
          const figureEnd = spreadBody(row).indexOf(l.figure) + l.figure.length;
          const stop = spreadBody(row).indexOf('.', figureEnd);
          const end = stop < 0 ? row.length : stop + 1;
          cleanRows[rowAt] = `${row.slice(0, end)} ${l.spread_note}${row.slice(end)}`;
          body = cleanRows.join('\n');
          added += 1;
        }
      }
    }
    if (alreadySaid(spreadBody(body), l)) continue;
    // Move any existing note behind its own chance, including when the Agent gave only the figure.
    if (l.spread_note !== undefined) {
      body = removeSpread(body, l.spread_note);
      const chanceOnly = l.chance.slice(0, l.chance.length - l.spread_note.length).trimEnd();
      body = outsideShortfallUnits(body, lines, part => part.split(chanceOnly).join(''));
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
  if (!hasShortfall) body = body.split('\n\n').map((p) => p.replace(/[ \t]{2,}/g, ' ').trim()).filter((p) => p !== '').join('\n\n');
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
  return { text: (hasShortfall ? body === '' : body.trim() === '') ? said : `${hasShortfall ? body : body.trimEnd()}\n\n${said}`, added };
}
