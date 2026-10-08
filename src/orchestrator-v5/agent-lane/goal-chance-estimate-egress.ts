import { agentLicenceRecordOf } from '../goal-target/goal-chance-licence.js';
import { goalChanceScreenLinesForAgent } from './goal-chance-screen-lines.js';
import { foldQuotes } from './quote-normalisation.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const plain = (s: string): string => foldQuotes(s).replace(/['"`*_]/g, '').replace(/\s+/g, ' ').toLowerCase();

/**
 * The shared live, stored-answer replay and conversation-reload boundary. A named licensed option and its goal
 * bind any narrated percentage, so a wrong figure cannot escape the producer's attribution. Goal-only narration
 * still needs one exact licensed value; explicit other subjects and exact user-authored spans stay untouched.
 * The screen producer owns the replacement, including its attribution and notes; each option is said once.
 */
export function withEstimateGoalPointsAtEgress<T extends { assistant_text?: unknown }>(body: T, context: {
  analysisResult: unknown; graph: unknown; current: boolean;
  /** Exact user-authored text from the turn/history, never a narration guess about whose words these are. */
  userAuthoredTexts?: readonly string[];
}): T {
  const licence = agentLicenceRecordOf(context.analysisResult);
  if (!context.current || typeof body.assistant_text !== 'string'
    || typeof licence?.olumi_estimate_link_count !== 'number' || !Number.isSafeInteger(licence.olumi_estimate_link_count)
    || licence.olumi_estimate_link_count <= 0) return body;
  const nodes = rec(context.graph)?.nodes;
  const goals = (Array.isArray(nodes) ? nodes : []).map(rec).filter(n => n?.kind === 'goal');
  // Run identity comes ONLY from analysis_result: the producer captures snapshot.goal_node_id on the licence.
  // Historical Run snapshots may supply it, but current graph selection/order cannot supply or override it.
  const run = rec(context.analysisResult), enrichment = rec(run?.enrichment);
  const goalIds = new Set([licence.goal_node_id, rec(run?.input_snapshot)?.goal_node_id,
    rec(enrichment?.input_snapshot)?.goal_node_id, run?.goal_node_id, enrichment?.goal_node_id]
    .filter((id): id is string => typeof id === 'string' && id.trim() !== ''));
  if (goalIds.size > 1) return body;
  const [goalId] = goalIds;
  const goal = goals.find(n => n?.id === goalId);
  const goalLabel = typeof licence.goal_label === 'string' ? licence.goal_label : goal?.label;
  const lines = goalChanceScreenLinesForAgent(context.analysisResult, context.graph, true)
    .filter(l => l.olumi_estimate_link_count !== undefined);
  if (lines.length === 0) return body;
  // Specialized goals (for example launching by a recorded date) carry their own producer-owned predicate.
  // Match that goal wording rather than assuming every licence says 'meeting your goal'.
  const producerGoalPredicates = lines.flatMap(l => {
    const match = plain(l.chance).match(/\bchance of (.+?), in this model\b/);
    return match === null ? [] : [match[1]!];
  });
  // Also resolve explicitly named unlicensed options: they cannot fall through to another option's goal-only tuple.
  const labelsById = new Map((Array.isArray(nodes) ? nodes : []).map(rec).flatMap(n =>
    n?.kind === 'option' && typeof n.id === 'string' && typeof n.label === 'string' ? [[n.id, n.label] as const] : []));
  for (const [id, label] of Object.entries(rec(licence.option_labels_by_option) ?? {})) {
    if (typeof label === 'string') labelsById.set(id, label);
  }
  const optionLabels = [...labelsById].map(([id, label]) => ({ id, label }));
  const names = (sentence: string, label: string): boolean => {
    const needle = plain(label).trim();
    if (needle === '') return false;
    for (let at = sentence.indexOf(needle); at >= 0; at = sentence.indexOf(needle, at + needle.length)) {
      if (!/[\p{L}\p{N}]/u.test(sentence[at - 1] ?? '')
        && !/[\p{L}\p{N}]/u.test(sentence[at + needle.length] ?? '')) return true;
    }
    return false;
  };
  const text = body.assistant_text;
  const protectedSpans: { start: number; end: number }[] = [];
  const userSpans: { start: number; end: number }[] = [];
  const edits: { start: number; end: number; replacement: string }[] = [];
  const said = new Set<string>();
  const folded = foldQuotes(text);
  // An echoed user statement is still theirs. Keep those exact spans opaque even when an option name and percentage
  // happen to coincide with this Run's licensed tuple; only assistant-authored narration can earn a replacement.
  for (const authored of context.userAuthoredTexts ?? []) {
    if (authored.trim() === '') continue;
    // Storage carries full turns. A narrator may echo just one sentence; derive only exact source slices, without
    // guessing authorship from phrases such as "you said". Decimal stops remain inside the sentence.
    const ends = [...authored.matchAll(/[.!?]["'”’`*_)]*(?=\s|$)|\n/g)].map(m => m.index! + m[0].length);
    if (ends[ends.length - 1] !== authored.length) ends.push(authored.length);
    const pieces = [authored];
    let cursor = 0;
    for (const end of ends) { pieces.push(authored.slice(cursor, end).trim()); cursor = end; }
    for (const piece of new Set(pieces)) {
      if (piece === '') continue;
      const needle = foldQuotes(piece);
      for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + needle.length)) {
        const span = { start: at, end: at + needle.length };
        protectedSpans.push(span); userSpans.push(span);
      }
    }
  }
  // Producer-bound sentences and conditional drivers are opaque, including their own percentages.
  for (const l of lines) {
    for (const sentence of [l.chance, l.depends].filter(s => s !== '')) {
      const needle = foldQuotes(sentence);
      for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + needle.length)) {
        protectedSpans.push({ start: at, end: at + needle.length });
        if (userSpans.some(span => at < span.end && at + needle.length > span.start)) continue;
        if (sentence === l.chance) {
          if (said.has(l.option_id)) edits.push({ start: at, end: at + needle.length, replacement: '' });
          said.add(l.option_id);
        }
      }
    }
  }
  // Walk only the gaps between producer spans: a canonical sentence never shields adjacent narration.
  const gaps: { start: number; end: number }[] = [];
  let protectedEnd = 0;
  for (const span of protectedSpans.sort((a, b) => a.start - b.start)) {
    if (span.start > protectedEnd) gaps.push({ start: protectedEnd, end: span.start });
    protectedEnd = Math.max(protectedEnd, span.end);
  }
  if (protectedEnd < text.length) gaps.push({ start: protectedEnd, end: text.length });
  for (const gap of gaps) {
    let rowStart = gap.start;
    for (const row of text.slice(gap.start, gap.end).split('\n')) {
      let cursor = 0;
      // Sentence stops do not require the next sentence to start with a capital. Decimal points remain inside figures.
      // A stop inside a licence label is part of the name, even when it is followed by a space.
      let boundaries = row;
      const foldedRow = foldQuotes(row).toLowerCase();
      for (const label of [...lines.map(l => l.label), ...(typeof goalLabel === 'string' ? [goalLabel] : [])]) {
        const needle = foldQuotes(label).toLowerCase();
        if (needle === '') continue;
        for (let at = foldedRow.indexOf(needle); at >= 0; at = foldedRow.indexOf(needle, at + needle.length)) {
          boundaries = boundaries.slice(0, at) + ' '.repeat(needle.length) + boundaries.slice(at + needle.length);
        }
      }
      const ends = [...boundaries.matchAll(/[.!?]["'”’`*_)]*(?=\s|$)/g)].map(m => m.index! + m[0].length);
      if (ends[ends.length - 1] !== row.length) ends.push(row.length);
      for (const sentenceEnd of ends) {
        const sentence = row.slice(cursor, sentenceEnd).trim();
        if (sentence === '') { cursor = sentenceEnd; continue; }
        const at = row.indexOf(sentence, cursor);
        cursor = sentenceEnd;
        const start = rowStart + at, end = start + sentence.length;
        const subject = plain(sentence);
        // Percentages inside node labels are names, not narrated figures (e.g. 'Raise prices 10%').
        let figures = subject;
        for (const label of [...lines.map(l => l.label), ...(typeof goalLabel === 'string' ? [goalLabel] : [])]) {
          figures = figures.split(plain(label).trim()).join('');
        }
        // Parse the percentage expression, including stacked approximation/comparison qualifiers, never a reply shape.
        const percentages = [...figures.matchAll(/((?:(?:(?:no\s+)?(?:less|more|greater)\s+than|at\s+(?:least|most)|up\s+to|under|over|below|above|[<>]=?|[≤≥]|about|roughly|around|approximately|circa)\s*)*)([-+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+))\s*(?:%|\bpercent\b|\bper\s+cent\b)/g)];
        // A named option binds its ID, even when another option licenses this percentage. A named other goal conflicts.
        const namedOptions = optionLabels.filter(o => names(subject, o.label) || names(subject, o.id));
        if (namedOptions.length > 1 || (goalId !== undefined && goals.some(g => g?.id !== goalId
          && typeof g?.label === 'string' && names(subject, g.label)))) continue;
        if (percentages.length === 0) continue;
        let withoutFigures = subject;
        for (const p of percentages) withoutFigures = withoutFigures.replace(p[0], ' ');
        const bareChance = /^this gives (?:a )?chance[.!?]?$/.test(withoutFigures.replace(/\s+/g, ' ').trim());
        // A bare pronoun supplies no option identity. A sole option resolves it; beside every complete producer
        // point it is only an unlabelled duplicate, so remove it without guessing which option the pronoun means.
        if (namedOptions.length === 0 && bareChance) {
          if (lines.length === 1) {
            const [l] = lines;
            const replacement = said.has(l!.option_id) ? '' : l!.chance;
            said.add(l!.option_id);
            edits.push({ start, end, replacement });
          } else if (lines.every(l => said.has(l.option_id))) edits.push({ start, end, replacement: '' });
          continue;
        }
        const genericGoalPoint = /\b(?:chance|probability|likelihood) (?:of |to )?(?:meet(?:ing)?|reach(?:ing)?|achiev(?:e|ing)|hit(?:ting)?) (?:your|the|our|this) (?:goal|target)\b/.test(subject);
        const goalSubject = typeof goalLabel === 'string' && plain(goalLabel).trim() !== ''
          ? subject.split(plain(goalLabel).trim()).join('__scored_goal__') : subject;
        const namedGoalPoint = /\b(?:chance|probability|likelihood) (?:of |to )?(?:meet(?:ing)?|reach(?:ing)?|achiev(?:e|ing)|hit(?:ting)?) (?:the )?__scored_goal__\b/.test(goalSubject)
          || (/\b__scored_goal__ (?:meets|reaches|achieves|hits) (?:its |the |your )?(?:goal|target)\b/.test(goalSubject)
            && /\bruns\b/.test(subject))
          || (/\b(?:meets|reaches|achieves|hits) (?:the )?__scored_goal__ (?:in|on)\b/.test(goalSubject)
            && /\bruns\b/.test(subject));
        const producerGoalPoint = producerGoalPredicates.some(predicate =>
          ['chance', 'probability', 'likelihood'].some(word => names(subject, `${word} of ${predicate}`)));
        let shorthand = withoutFigures;
        for (const o of namedOptions) {
          shorthand = shorthand.split(plain(o.label).trim()).join('').split(plain(o.id).trim()).join('');
        }
        shorthand = shorthand.replace(/^\s*[-•]\s*/, '').replace(/\bin this model\b/g, '')
          .replace(/[:;,.!?]/g, '').replace(/\s+/g, ' ').trim();
        // The familiar option: percentage display and recorded option chance imply the licensed goal. Any named
        // alternate subject (supplier failure, competitor launch, market share) prevents this shorthand binding.
        const optionGoalPoint = namedOptions.length === 1 && (genericGoalPoint || namedGoalPoint || producerGoalPoint
          || shorthand === '' || /^(?:has|gives) (?:a )?chance$/.test(shorthand)
          || /^(?:the )?recorded (?:chance|figure|probability) for (?:is|was)$/.test(shorthand));
        const matched = lines.filter(l => {
          const pct = rec(licence.pct_by_option)?.[l.option_id];
          const valueMatches = percentages.some(p => {
            const value = Number(p[2]!.replace(/,/g, ''));
            const prefix = p[1]!.trim();
            const comparison = prefix.replace(/\b(?:about|roughly|around|approximately|circa)\b/g, '').trim();
            // pct_by_option is already rounded by the licence producer; only its exact value or ruled edge display binds.
            return comparison === '' ? value === pct
              : (pct === 0 && value === 1 && ['<', 'less than'].includes(prefix))
                || (pct === 100 && value === 99 && ['>', 'more than'].includes(prefix));
          });
          return namedOptions.length === 1 ? optionGoalPoint && namedOptions[0]!.id === l.option_id
            : valueMatches && goalId !== undefined && namedGoalPoint;
        });
        // Goal-only narration still needs one exact (option_id, scored goal_id, displayed value), never a guessed tie.
        if (matched.length !== 1) continue;
        const replacement = matched.filter(l => !said.has(l.option_id)).map(l => { said.add(l.option_id); return l.chance; }).join(' ');
        edits.push({ start, end, replacement });
      }
      rowStart += row.length + 1;
    }
  }
  if (edits.length === 0) return body;
  let result = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return { ...body, assistant_text: result };
}
