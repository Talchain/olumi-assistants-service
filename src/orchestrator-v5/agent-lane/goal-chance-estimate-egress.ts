import { agentLicenceRecordOf } from '../goal-target/goal-chance-licence.js';
import { licensedGoalChanceLinesForAgent } from './goal-chance-screen-lines.js';
import { foldQuotes } from './quote-normalisation.js';
import { goalHorizonVerdict, heldGoalHorizonMonths } from '../goal-target/goal-horizon-verdict.js';
import { goalTargetBasisOf } from '../goal-target/goal-target-basis.js';
import { readGoalRecord } from '../goal-target/goal-record.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const plain = (s: string): string => foldQuotes(s.replace(/â€˜|â€™|â€œ|â€\u009d/g, "'")).replace(/['"`*_]/g, '').replace(/\s+/g, ' ').toLowerCase();

/** DL rule v2: bare likelihood belongs to the named option; an explicit other subject does not.
 * Grammar only: of + noun phrase, (that) + clause, likely to + verb phrase.
 * Callers retain the existing option identity, display precision and attribution checks.
 */
export function isGoalChanceStatement(sentence: string, optionLabel: string, goalLabel: string): boolean {
  const goalWords = new Set(['goal', 'goals', 'target', 'targets', 'objective', 'aim']);
  const likelihoodWords = new Set(['chance', 'chances', 'likely', 'likelihood', 'probability', 'probable', 'odds']);
  const text = plain(sentence);
  const hasLabel = (part: string, label: string): boolean => {
    const needle = plain(label).trim();
    if (!needle) return false;
    for (let at = part.indexOf(needle); at >= 0; at = part.indexOf(needle, at + needle.length)) {
      if (!/[\p{L}\p{N}]/u.test(part[at - 1] ?? '') && !/[\p{L}\p{N}]/u.test(part[at + needle.length] ?? '')) return true;
    }
    return false;
  };
  if (!hasLabel(text, optionLabel)) return false;
  const hasGoal = (part: string): boolean => hasLabel(part, goalLabel)
    || (part.match(/\b[a-z]+\b/g) ?? []).some(word => goalWords.has(word));
  const terms = [...text.matchAll(/\b[a-z]+\b|%\s+of\s+(?:(?:the|model)\s+)?(?:time|cases|runs|scenarios|simulations|samples|draws)\b/g)]
    .filter(term => likelihoodWords.has(term[0]) || term[0].startsWith('%'));
  return terms.some(term => {
    const after = text.slice(term.index! + term[0].length).trimStart();
    let attached: string | undefined;
    if (term[0].startsWith('%')) {
      // A frequency's subject precedes its figure, within the same clause.
      const before = text.slice(0, term.index).split(/[;,:]/).at(-1) ?? '';
      const predicate = before.replace(plain(optionLabel), '').replace(/[-+]?\d+(?:\.\d+)?\s*$/, '').trim();
      if (predicate !== '') attached = before;
    } else if (/^(?:of|that)\s+/.test(after) || (term[0] === 'likely' && /^to\s+/.test(after))) {
      const subject = after.replace(/^(?:of|that|to)\s+/, '');
      // 'chance of 24%' is a bare value, not an explicit other subject.
      if (!/^(?:(?:about|roughly|around|approximately)\s+)?[-+<>=≤≥]?\s*\d/.test(subject)) attached = subject;
    } else if (/^(?:a|an|the|this|that|these|those|my|your|our|their|its|it|we|you|they|he|she)\s+/.test(after)
      || /^(?!is\b|was\b|are\b|were\b|for\b|in\b|at\b|on\b|as\b|with\b)[\p{L}]+\s+(?:[\p{L}]+s|is|was|will|would|can|could|may|might)\b/u.test(after)) {
      attached = after;
    }
    // A following independent clause cannot turn supplier failure into a goal subject.
    const subject = attached?.split(/[;,.!?]|\b(?:but|which)\b/)[0];
    return subject === undefined || hasGoal(subject);
  });
}

/**
 * The shared live, stored-answer replay and conversation-reload boundary. A named licensed option and its goal
 * bind goal-attainment percentages to the licence display or a verified input in that sentence. Goal-only narration
 * cannot invent an option identity. Exact user-authored spans and producer-bound statements stay untouched.
 * The screen producer owns the replacement, including its attribution and notes; each option is said once.
 */
export function withEstimateGoalPointsAtEgress<T extends { assistant_text?: unknown }>(body: T, context: {
  analysisResult: unknown; graph: unknown; current: boolean;
  /** Exact user-authored text from the turn/history, never a narration guess about whose words these are. */
  userAuthoredTexts?: readonly string[];
  /** Forwarded replies already own their wording; only a failing numerical licence may replace it. */
  preserveLicensedWords?: boolean;
}): T {
  const licence = rec(agentLicenceRecordOf(context.analysisResult)) ?? {};
  if (!context.current || typeof body.assistant_text !== 'string') return body;
  const nodes = rec(context.graph)?.nodes;
  const goals = (Array.isArray(nodes) ? nodes : []).map(rec).filter(n => n?.kind === 'goal');
  // Run identity comes ONLY from analysis_result: the producer captures snapshot.goal_node_id on the licence.
  // Historical Run snapshots may supply it, but current graph selection/order cannot supply or override it.
  const run = rec(context.analysisResult), enrichment = rec(run?.enrichment);
  const goalIds = new Set([licence.goal_node_id, rec(run?.input_snapshot)?.goal_node_id,
    rec(enrichment?.input_snapshot)?.goal_node_id, run?.goal_node_id, enrichment?.goal_node_id]
    .filter((id): id is string => typeof id === 'string' && id.trim() !== ''));
  const goalId = goalIds.size === 1 ? [...goalIds][0] : undefined;
  const goal = goals.find(n => n?.id === goalId);
  const goalLabel = typeof licence.goal_label === 'string' ? licence.goal_label : goal?.label;
  const lines = goalIds.size > 1 ? [] : licensedGoalChanceLinesForAgent(context.analysisResult, context.graph, true);
  // Zero links is not zero estimates: the licence also counts shared starting
  // values and this option's own settings. Never borrow another option's setting.
  const positiveCount = (value: unknown): boolean => typeof value === 'number' && value > 0;
  const hasOlumiEstimates = (line: (typeof lines)[number]): boolean =>
    positiveCount(line.olumi_estimate_link_count)
    || positiveCount(licence.olumi_estimate_value_count)
    || positiveCount(rec(licence.olumi_estimate_settings_by_option)?.[line.option_id]);
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
  const figureParts = (value: string): string[] => [...plain(value).matchAll(/((?:(?:(?:no\s+)?(?:less|more|greater)\s+than|at\s+(?:least|most)|up\s+to|under|over|below|above|[<>]=?|[≤≥]|about|roughly|around|approximately|circa)\s*)*)([-+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+))\s*(?:%|\bpercent\b|\bper\s+cent\b)/g)]
    .map(p => `${p[1]!.replace(/\b(?:about|roughly|around|approximately|circa)\b/g, '').trim().replace('<', 'less than').replace('>', 'more than')}:${Number(p[2]!.replace(/,/g, ''))}`);
  const exactFigure = (sentence: string, figure: string): boolean => {
    const a = figureParts(sentence), b = figureParts(figure);
    return a.length === b.length && a.every((part, i) => part === b[i]);
  };
  const text = body.assistant_text;
  const protectedSpans: { start: number; end: number }[] = [];
  const userSpans: { start: number; end: number }[] = [];
  const edits: { start: number; end: number; replacement: string }[] = [];
  let removedTimedAttainment = false;
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
        const quoted = /["'‘’“”]/.test(text[at - 1] ?? '') && /["'‘’“”]/.test(text[at + needle.length] ?? '');
        const span = { start: at - (quoted ? 1 : 0), end: at + needle.length + (quoted ? 1 : 0) };
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
  // Protected quotes/producer spans exempt their own figures, not the identity of the
  // sentence around them. Keep full sentence context when checking a gap beside a quote.
  const sentenceContexts: { start: number; end: number; subject: string }[] = [];
  let contextRowStart = 0;
  for (const row of text.split('\n')) {
    let boundaries = row;
    const foldedRow = foldQuotes(row).toLowerCase();
    for (const label of [...optionLabels.map(o => o.label), ...goals.flatMap(g => typeof g?.label === 'string' ? [g.label] : [])]) {
      const needle = foldQuotes(label).toLowerCase();
      if (needle === '') continue;
      for (let at = foldedRow.indexOf(needle); at >= 0; at = foldedRow.indexOf(needle, at + needle.length)) {
        boundaries = boundaries.slice(0, at) + ' '.repeat(needle.length) + boundaries.slice(at + needle.length);
      }
    }
    const ends = [...boundaries.matchAll(/[.!?]["'”’`*_)]*(?=\s|$)/g)].map(m => m.index! + m[0].length);
    if (ends.at(-1) !== row.length) ends.push(row.length);
    let cursor = 0;
    for (const end of ends) {
      sentenceContexts.push({ start: contextRowStart + cursor, end: contextRowStart + end, subject: plain(row.slice(cursor, end)) });
      cursor = end;
    }
    contextRowStart += row.length + 1;
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
      for (const label of [...optionLabels.map(o => o.label), ...goals.flatMap(g => typeof g?.label === 'string' ? [g.label] : []), ...(typeof goalLabel === 'string' ? [goalLabel] : [])]) {
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
        const bindingSubject = sentenceContexts.find(context => context.start <= start && start < context.end)?.subject ?? subject;
        // K-a: bind a positive timed-attainment assertion to this turn's goal and
        // period. Questions and limitations are not assertions. This deliberately
        // recognises the narrow month-based claim, not arbitrary timing vocabulary.
        const claimGoal = goal ?? (goals.length === 1 ? goals[0] : undefined);
        const period = subject.match(/\b(?:by month (\d+(?:\.\d+)?)|within (\d+(?:\.\d+)?) months)\b/);
        const attainmentSubject = typeof claimGoal?.label === 'string' ? subject.split(plain(claimGoal.label)).join('__goal__') : subject;
        const attainment = !sentence.trimEnd().endsWith('?') && (
          /^(?:the (?:leading )?option|__goal__|(?:the|your|our) (?:goal|target)) (?:is|will be) on track (?:by month|within)\b/.test(attainmentSubject)
          || /^(?:__goal__|(?:the|your|our) (?:goal|target)) (?:is|will be) (?:met|reached|achieved) (?:by month|within)\b/.test(attainmentSubject)
          || optionLabels.some(o => names(subject, o.label) && (
            subject.startsWith(`${plain(o.label)} is on track `) || subject.startsWith(`${plain(o.label)} will be on track `))));
        if (period !== null && claimGoal !== undefined && attainment) {
          const months = Number(period?.[1] ?? period?.[2]);
          const heldMonths = heldGoalHorizonMonths(claimGoal) ?? goalTargetBasisOf(claimGoal)?.period_months;
          const verdict = goalHorizonVerdict(context.graph, enrichment ?? run);
          const named = optionLabels.filter(o => names(subject, o.label) || names(subject, o.id));
          const target = typeof claimGoal.id === 'string' ? readGoalRecord(context.graph, claimGoal.id)?.target : undefined;
          const licensedTarget = rec(licence.target);
          const comparator = target?.comparator === '>=' ? 'at_least' : target?.comparator === '<=' ? 'at_most'
            : target?.comparator === '>' ? 'above' : target?.comparator === '<' ? 'below' : undefined;
          const licensed = licence.code === 'GOAL_CHANCE_LICENSED' && goalId === claimGoal.id
            && target?.raw !== undefined && target.unit !== undefined && comparator !== undefined
            && licensedTarget?.value === target.raw && licensedTarget.unit === target.unit && licensedTarget.comparator === comparator
            && months === heldMonths
            && ['computed_at_h', 'basis_at_h', 'steady_attested'].includes(verdict)
            && lines.some(l => named.length === 0 || (named.length === 1 && l.option_id === named[0]!.id));
          if (!licensed) {
            edits.push({ start, end, replacement: '' });
            removedTimedAttainment = true;
            continue;
          }
        }
        // Percentages inside node labels are names, not narrated figures (e.g. 'Raise prices 10%').
        let figures = subject;
        for (const label of [...optionLabels.map(o => o.label), ...goals.flatMap(g => typeof g?.label === 'string' ? [g.label] : []), ...(typeof goalLabel === 'string' ? [goalLabel] : [])]) {
          const name = plain(label).trim();
          if (name !== '') figures = figures.split(name).join(' '.repeat(name.length));
        }
        // Parse the percentage expression, including stacked approximation/comparison qualifiers, never a reply shape.
        const percentages = [...figures.matchAll(/((?:(?:(?:no\s+)?(?:less|more|greater)\s+than|at\s+(?:least|most)|up\s+to|under|over|below|above|[<>]=?|[≤≥]|about|roughly|around|approximately|circa)\s*)*)([-+]?(?:\d[\d,]*(?:\.\d+)?|\.\d+))\s*(?:%|\bpercent\b|\bper\s+cent\b)/g)];
        const namedOptions = optionLabels.filter(o => names(bindingSubject, o.label) || names(bindingSubject, o.id));
        if (percentages.length === 0) continue;
        let withoutFigures = subject;
        for (const p of percentages) withoutFigures = withoutFigures.replace(p[0], ' ');
        const chanceWithoutFigure = withoutFigures.replace(/\s+/g, ' ').trim();
        // A bare numerical chance with an unbound subject has no licensed option/goal tuple.
        // Withhold the claim; do not infer an alias or borrow another option's number. Explicit
        // other predicates ('chance of supplier failure') and exact user spans remain untouched.
        if (namedOptions.length === 0 && /^.+ has (?:a )?chance[.!?]?$/.test(chanceWithoutFigure)) {
          edits.push({ start, end, replacement: '' });
          continue;
        }
        const bareChance = /^this gives (?:a )?chance[.!?]?$/.test(chanceWithoutFigure);
        // A bare pronoun supplies no option identity. A sole option resolves it; beside every complete producer
        // point it is only an unlabelled duplicate, so remove it without guessing which option the pronoun means.
        if (namedOptions.length === 0 && bareChance) {
          if (lines.length === 1) {
            const [l] = lines;
            if (exactFigure(figures, l!.figure) && (context.preserveLicensedWords || !hasOlumiEstimates(l!))) continue;
            const replacement = said.has(l!.option_id) ? '' : l!.chance;
            said.add(l!.option_id);
            edits.push({ start, end, replacement });
          } else if (lines.every(l => said.has(l.option_id))) edits.push({ start, end, replacement: '' });
          continue;
        }
        // B2q: sentence-level admission, independent of the narrator's predicate/word order.
        // A number in a different sentence or in an unverified history is never evidence.
        const namesGoal = goals.some(g => typeof g?.label === 'string' && names(bindingSubject, g.label))
          || (typeof goalLabel === 'string' && names(bindingSubject, goalLabel))
          || /\b(?:your|the|our|this) (?:goal|target)\b/.test(bindingSubject);
        // Keep the old scored-goal identity rules: another goal and ambiguous labels do not bind.
        if (goalId !== undefined && goals.some(g => g?.id !== goalId
          && typeof g?.label === 'string' && names(bindingSubject, g.label))) continue;
        const duplicateLabel = namedOptions.some((o, i) => namedOptions.some((other, j) => i !== j
          && plain(o.label) === plain(other.label)));
        if (duplicateLabel) continue;
        let shorthand = withoutFigures.split(';')[0]!;
        for (const o of namedOptions) shorthand = shorthand.split(plain(o.label)).join('').split(plain(o.id)).join('');
        shorthand = shorthand.replace(/^\s*[-•]\s*/, '').replace(/\bin this model\b/g, '')
          .replace(/[:;,.!?]/g, '').replace(/\s+/g, ' ').trim();
        const optionShorthand = namedOptions.length === 1 && (shorthand === ''
          || /^(?:has|gives) (?:a )?chance$/.test(shorthand)
          || /^is likely$/.test(shorthand)
          || /^(?:the )?recorded (?:chance|figure|probability) for (?:is|was)$/.test(shorthand));
        const goalAttainment = namedOptions.some(o => isGoalChanceStatement(bindingSubject, o.label,
          typeof goalLabel === 'string' ? goalLabel : '')
          || isGoalChanceStatement(bindingSubject, o.id, typeof goalLabel === 'string' ? goalLabel : ''));
        // Legacy compact points and unbound goal narration retain their identity/precision contract.
        const unboundGoalChance = namedOptions.length === 0 && namesGoal
          && /\b(?:chance|chances|likely|likelihood|probability|probable|odds)\b|% of (?:the |model )?(?:time|cases|runs|scenarios|simulations|samples|draws)\b/.test(bindingSubject);
        if (!optionShorthand && !goalAttainment && !unboundGoalChance) continue;
        if (namedOptions.length === 0 && !namesGoal) continue;
        if (optionShorthand && goalIds.size > 1 && !/^is likely$/.test(shorthand)) continue;
        if (namedOptions.length === 0 && goalId === undefined && goalIds.size === 0
          && percentages.every(p => Object.values(rec(licence.pct_by_option) ?? {}).includes(Number(p[2]!.replace(/,/g, ''))))) continue;
        const matched = lines.filter(l => namedOptions.some(o => o.id === l.option_id));
        const licensedFigures = matched.length === 1 ? figureParts(matched[0]!.figure) : [];
        const target = goalIds.size > 1 ? undefined : rec(licence.target);
        const percentageUnit = (unit: unknown): unit is string => typeof unit === 'string'
          && /^(?:%|percent\b|per cent\b)/i.test(unit.trim());
        const inputFigure = (p: RegExpMatchArray): boolean => {
          const value = Number(p[2]!.replace(/,/g, ''));
          const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // A matching number somewhere in the sentence is insufficient: the input's label and
          // unit must bind this occurrence as an input value. In particular, a 10% target cannot
          // license "a 10% chance of meeting your goal" beside a different licensed chance.
          const inputOccurrence = (label: string, unit: string): boolean => {
            const tail = plain(unit).replace(/^(?:%|percent|per cent)/, '').trim();
            const before = subject.slice(0, p.index);
            const after = figures.slice(p.index! + p[0].length);
            const labelAtValue = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(plain(label))}\\s*(?:(?:is|of|at(?: or)?|was|equals|being|up)\\s*|[:=]\\s*)$`, 'u');
            return labelAtValue.test(before) && (tail === '' || after.trimStart().startsWith(tail));
          };
          if (namesGoal && percentageUnit(target?.unit) && target?.value === value) {
            const labels = ['target', ...(typeof goalLabel === 'string' ? [goalLabel] : [])];
            const after = subject.slice(p.index! + p[0].length).trimStart();
            // The typed target can also be a prenominal value: '10% productivity target'.
            const targetAfterValue = typeof goalLabel === 'string'
              && new RegExp(`^${escape(plain(goalLabel))}\\s+target\\b`).test(after);
            if (targetAfterValue || labels.some(label => inputOccurrence(label, target.unit as string))) return true;
          }
          // Only typed raw values with an explicit percentage unit can exempt a model input.
          // Internal normalized values and analysis outputs (win shares, sensitivities) cannot.
          return (Array.isArray(nodes) ? nodes : []).some(raw => {
            const n = rec(raw), observed = rec(n?.observed_state), unit = observed?.unit;
            if (typeof n?.label !== 'string' || !names(subject, n.label) || !percentageUnit(unit)) return false;
            return observed?.raw_value === value && inputOccurrence(n.label, unit);
          });
        };
        const residual = percentages.filter(p => !inputFigure(p));
        // A complete range is one licensed display; endpoints alone cannot become point chances.
        // Compare with the producer's formatted figure, never a locally rounded probability.
        const parts = residual.flatMap(p => figureParts(p[0]));
        const correctSingle = matched.length === 1 && (licensedFigures.length === 1
          ? parts.length > 0 && parts.every(part => part === licensedFigures[0])
          : parts.length === licensedFigures.length && parts.every((part, i) => part === licensedFigures[i]));
        // Multiple named options can share a sentence only when each percentage has one
        // unambiguous option in its own clause; a matching number cannot choose an option.
        const clauses = [...subject.matchAll(/[^,;]+?(?=\s+and\s+|[,;]|$)/g)];
        const correctMultiple = namedOptions.length > 1 && residual.every(p => {
          const clause = clauses.find(c => p.index! >= c.index! && p.index! < c.index! + c[0].length);
          if (clause === undefined) return false;
          const owners = namedOptions.filter(o => names(clause[0], o.label) || names(clause[0], o.id));
          const line = owners.length === 1 ? matched.find(l => l.option_id === owners[0]!.id) : undefined;
          return line !== undefined && exactFigure(p[0], line.figure);
        });
        const correct = correctSingle || correctMultiple;
        const attributionOwed = correct && matched.length === 1 && hasOlumiEstimates(matched[0]!)
          && !context.preserveLicensedWords
          && !/\busing olumis estimates? for\b/.test(subject);
        if (residual.length === 0 || (correct && !attributionOwed)) continue;
        // Existing mismatch path: replace with the producer's own sentence, once per option;
        // an absent/ambiguous tuple is suppressed, never guessed from another option's figure.
        const replacement = matched.length === 1
          ? matched.filter(l => !said.has(l.option_id)).map(l => { said.add(l.option_id); return l.chance; }).join(' ')
          : '';
        const separator = replacement !== '' && start > 0 && !/\s/.test(text[start - 1]!)
          && protectedSpans.some(span => span.end === start) ? ' ' : '';
        edits.push({ start, end, replacement: separator + replacement });
      }
      rowStart += row.length + 1;
    }
  }
  if (edits.length === 0) return body;
  let result = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return { ...body, assistant_text: removedTimedAttainment && result.trim() === ''
    ? 'The recorded comparison does not support that explanation.' : result };
}
