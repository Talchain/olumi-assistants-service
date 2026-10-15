import { shareGoalChanceWords } from '../goal-target/share-goal-chance-words.js';
export { shareGoalChanceWords } from '../goal-target/share-goal-chance-words.js';
import { shareByDateGoalOf } from '../goal-target/goal-kind.js';
import { olumiAssumedRangeLine, olumiAssumedTeamRange, shareOptionEstimateWords } from '../goal-target/share-by-date-run.js';
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
 * Points on the `each` licence, and on every point form while unaccepted Olumi estimates feed this result:
 * §(i)'s estimate label must accompany each licensed figure even when the comparison has a different headline. Never a figure
 * the screen does not show, never an order by size. Placed right after the range opening, else right after a dangling
 * "…on current information:" style lead-in, else as a closing paragraph.
 */
import { goalChanceFactsForAgent } from '../goal-target/goal-chance-range-agent.js';
import { sayDate } from '../goal-target/deadline-date.js';
import { shortfallNoteLabel, UNVERIFIED_SOURCES_NOTE } from '../goal-target/goal-chance-licence.js';
import { RANGE_OPENING, sameWordsIn } from './goal-chance-withheld.js';
import { foldQuotes } from './quote-normalisation.js';
import { narratorCountGuard } from './olumi-estimates-feeding-result.js';
import { goalChanceEstimateCounts, goalChanceEstimateLinkCount, olumiEstimateWords, type GoalChanceEstimateCounts } from './goal-chance-estimate-attribution.js';
import { sentencesOf } from './reply/compose-reply.js';
import { figuresIn, isLicensedChanceLine } from './licensed-chance-lines.js';
import { sayDisplayedPct } from '../goal-target/goal-targets-joint.js';

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
  return { points, ranges, pointsOwed };
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

/**
 * B15 (DL CHANGES_REQUIRED on #2783, Codex P1): ONE sentence in which the narrator gave this option's screen figure in its
 * own accepted words (the option named, then its figure) — the same acceptance `alreadySaid` uses, bound to one sentence
 * so the route can type it as this finding's leading evidence. Never the canonical sentence (typed already).
 */
export function chanceInOwnWords(sentence: string, l: GoalChanceScreenLine): boolean {
  if (l.olumi_estimate_link_count !== undefined) return false;
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
  if (l.olumi_estimate_link_count !== undefined) {
    const sentence = estimatePointSentence(l);
    if (!sameWordsIn(text, sentence)) return false;
    if (l.spread_note === undefined) return true;
    const at = foldQuotes(text).indexOf(foldQuotes(sentence));
    return at >= 0 && sameWordsIn(text.slice(at + sentence.length), l.spread_note);
  }
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
export function withScreenLinesOwed(text: string, lines: readonly GoalChanceScreenLine[], notes: readonly string[] = [],
  opts: { readonly onCard?: ReadonlySet<string> } = {}): { text: string; added: number } {
  // Recovery Batch C: the run-wide sentences said once, after the chance lines, each only when the reply does not already
  // carry it word for word (quotes aside).
  const owedNotes = notes.filter((n) => n.trim() !== '');
  if (owedNotes.length === 0) return withScreenLinesOwedOnly(text, lines, opts.onCard);
  const base = withScreenLinesOwedOnly(text, lines, opts.onCard);
  const missing = owedNotes.filter((n) => !sameWordsIn(base.text, n));
  if (missing.length === 0) return base;
  const said = missing.join(' ');
  return { text: base.text.trim() === '' ? said : `${base.text.trimEnd()}\n\n${said}`, added: base.added + missing.length };
}

/**
 * `onCard`: the options whose chance this reply's bound result card displays (the route decides, by the Run's identity).
 * Their chance is not said in the chat (their `depends` sentence still is); every line still feeds RC4's narrator guard
 * and the shortfall units below.
 */
function withScreenLinesOwedOnly(text: string, lines: readonly GoalChanceScreenLine[], onCard?: ReadonlySet<string>): { text: string; added: number } {
  // Narration never supplies k, even when it guessed correctly. Complete producer-bound sentences are already authorised;
  // keep their exact bytes while applying RC4's existing guard to all other narrator text before deterministic assembly.
  const authorised: string[] = [];
  let body = text;
  if (lines.some(l => l.olumi_estimate_link_count !== undefined)) {
    for (const l of lines) {
      const chance = l.olumi_estimate_link_count === undefined ? l.chance : estimatePointSentence(l);
      for (const sentence of [chance, l.depends].filter(s => s !== '')) {
        const folded = foldQuotes(body), needle = foldQuotes(sentence);
        const positions: number[] = [];
        for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + needle.length)) positions.push(at);
        for (const at of positions.reverse()) {
          const key = `\u0000GP_ESTIMATE_POINT_${authorised.length}\u0000`;
          authorised.push(body.slice(at, at + sentence.length));
          body = body.slice(0, at) + key + body.slice(at + sentence.length);
        }
      }
    }
    body = narratorCountGuard(body, null).text;
    for (const [i, chance] of authorised.entries()) body = body.split(`\u0000GP_ESTIMATE_POINT_${i}\u0000`).join(chance);
  }
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
    // DL ruling on #3027 (PL 07:45Z): the card says the face, so the chance is not said again; what it rests on, the
    // coaching question on the consequential assumption, is still said once.
    if (onCard?.has(l.option_id) === true) {
      if (l.depends !== '' && !sameWordsIn(body, l.depends)) {
        owed.push(l.depends);
        added += 1;
      }
      continue;
    }
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
    if (l.spread_note !== undefined && !alreadySaid(spreadBody(body), l)
      && (l.olumi_estimate_link_count === undefined || sameWordsIn(spreadBody(body), estimatePointSentence(l)))) {
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
      } else if (l.olumi_estimate_link_count === undefined) {
        // A previously accepted shorthand figure owes only its qualifier. Complete shortfall units remain opaque;
        // neither their shared note words nor a neighbouring option can provide this sentence's insertion point.
        let inserted = false;
        const clean = removeSpread(body, l.spread_note);
        const completed = outsideShortfallUnits(clean, lines, part => {
          if (inserted) return part;
          const [own] = ownWordsLeadTexts(part, l, sentencesOf);
          if (own === undefined || !/[.!]["'”’`*_]*$/.test(own)) return part;
          inserted = true;
          return part.replace(own, `${own} ${l.spread_note}`);
        });
        if (inserted) { body = completed; added += 1; }
      }
    }
    if (alreadySaid(spreadBody(body), l)) continue;
    // ⭐ S7 B1 (DL 15 Oct): the leader gate now keeps the AI's own sentence for this option's licensed figure. Where it lacks
    // the line's disclosures, it BECOMES the canonical line in place (one copy, every disclosure), never a second figure.
    // By the gate's own rule (`isLicensedChanceLine`), for THIS option and its own licensed figure only.
    const mine = { options: [{ label: l.label, figures: figuresIn(l.figure), displays: [l.figure] }] };
    const own = l.shortfall_note !== undefined ? undefined : body.split('\n')
      .map((row) => row.replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/, '')).flatMap((row) => sentencesOf(row))
      .find((sentence) => !l.chance.includes(sentence) && (chanceInOwnWords(sentence, l)
        || isLicensedChanceLine(sentence, mine, lines.map((x) => x.label))));
    if (own !== undefined) {
      const depends = l.depends !== '' && !sameWordsIn(body, l.depends) ? ` ${l.depends}` : '';
      body = body.replace(own, `${l.chance}${depends}`);
      added += 1;
      continue;
    }
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
