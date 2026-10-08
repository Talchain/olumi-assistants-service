import { agentLicenceRecordOf } from '../goal-target/goal-chance-licence.js';
import { goalChanceScreenLinesForAgent } from './goal-chance-screen-lines.js';
import { foldQuotes } from './quote-normalisation.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const plain = (s: string): string => foldQuotes(s).replace(/['"`*_]/g, '').replace(/\s+/g, ' ').toLowerCase();

/**
 * The shared live, stored-answer replay and conversation-reload boundary. Only a current licence's own percentage
 * AND an unambiguous option on its scored goal identify a goal point. All other sentence bytes and whitespace stay untouched.
 * The screen producer owns the replacement, including its attribution and notes; each option is said once.
 */
export function withEstimateGoalPointsAtEgress<T extends { assistant_text?: unknown }>(body: T, context: {
  analysisResult: unknown; graph: unknown; current: boolean;
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
  if (goalIds.size !== 1) return body;
  const [goalId] = goalIds;
  const goal = goals.find(n => n?.id === goalId);
  const goalLabel = typeof licence.goal_label === 'string' ? licence.goal_label : goal?.label;
  const lines = goalChanceScreenLinesForAgent(context.analysisResult, context.graph, true)
    .filter(l => l.olumi_estimate_link_count !== undefined);
  if (lines.length === 0) return body;
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
  const edits: { start: number; end: number; replacement: string }[] = [];
  const said = new Set<string>();
  const folded = foldQuotes(text);
  // Producer-bound sentences and conditional drivers are opaque, including their own percentages.
  for (const l of lines) {
    for (const sentence of [l.chance, l.depends].filter(s => s !== '')) {
      const needle = foldQuotes(sentence);
      for (let at = folded.indexOf(needle); at >= 0; at = folded.indexOf(needle, at + needle.length)) {
        protectedSpans.push({ start: at, end: at + needle.length });
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
        const namedOptions = optionLabels.filter(o => names(subject, o.label));
        if (namedOptions.length > 1 || goals.some(g => g?.id !== goalId
          && typeof g?.label === 'string' && names(subject, g.label))) continue;
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
          return valueMatches && (namedOptions.length === 1 ? namedOptions[0]!.id === l.option_id
            : typeof goalLabel === 'string' && names(subject, goalLabel));
        });
        // Goal-only narration must resolve exactly one (option_id, scored goal_id, displayed value), never guess a tie.
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
