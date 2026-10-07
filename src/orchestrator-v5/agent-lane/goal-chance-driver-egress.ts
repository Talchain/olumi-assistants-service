/**
 * ⭐ THE CHAT NEVER DENIES THE DRIVER THE SCREEN SHOWS (Science 393023, PR-S2 r5; DL GO #87, 7 Oct).
 *
 * Prod cut-6 smoke (7 Oct 00:34Z, guest T1b, CEE 0f2c3b2): the screen said "It rests most on Olumi’s own estimate of how
 * strongly ‘Starter tier MRR’ affects …" while the Run narration said "…; sensitivity has not established which
 * assumption matters most." The base prompt already forbade that claim (none_measurable → "make no claim about which
 * assumption matters most") and the model said it anyway, so a prompt rule alone is not a guarantee.
 *
 * At the final egress, while the Run's ruled driver display (`goalChanceDriverDisplayForAgent`, the screen's own
 * sentences) is non-empty, ONLY the clause that claims no assumption/factor is established, measured or most worth
 * investigating is removed; the rest of its sentence stays and stays grammatical. Nothing else is touched: a claim about
 * an option, a link's existence, a deadline or timing shares words but is a different claim. One log line per edit
 * (code + turn id + counts, never prose) measures how often the prompt rule misses.
 */
import { log } from '../../utils/telemetry.js';
import { goalChanceDriverDisplayForAgent } from '../goal-target/goal-chance-range-agent.js';

export const GOAL_CHANCE_DRIVER_ABSENCE_REMOVED = 'GOAL_CHANCE_DRIVER_ABSENCE_REMOVED';
export const GOAL_CHANCE_DRIVER_ABSENCE_KEPT_UNSAFE = 'GOAL_CHANCE_DRIVER_ABSENCE_KEPT_UNSAFE';

const R = String.raw;
const ITEM = R`(?:assumption|factor|input|driver)s?`;
const WHICH = R`(?:which|what)`;
/** "which assumption in this model matters most": at most four words between the noun and its "most". */
const GAP = R`(?:\s+[\w’'-]+){0,4}?`;
const MOST = R`\s+(?:(?:matters?|mattered)\s+(?:the\s+)?most|(?:is|was|are|were)\s+(?:the\s+)?most\s+(?:worth\s+investigating|important|sensitive|influential|consequential|decisive)|(?:is|are|was|were)\s+the\s+(?:biggest|main|key|largest|strongest)\s+(?:driver|factor|assumption)|(?:deserves?|merits?|needs?)\s+(?:investigation|attention|checking|testing)\s+first|(?:to\s+)?(?:investigate|check|test|examine)\s+first|drives?\s+(?:the\s+)?(?:result|outcome|chance|comparison)\s+most|most\s+(?:affects?|influences?|drives?|moves?|shapes?|changes?)\b)`;
const NEG = R`(?:\b(?:does|do|did|has|have|had|could|can|ca|was|were|will|wo|is|would)\s*(?:not|n[’']t)|\bcannot|\bnever)(?:\s+(?:yet|also|itself|still))*`;
const VERB = R`\s+(?:been\s+)?(?:able\s+to\s+)?(?:establish|identif|determin|measur|show|tell|say|know|pin\w*\s+down|single\w*\s+out|isolat|find|found|reveal|indicat|clarif|settl)\w*`;
const ABSENT = R`(?:\s*(?:not|n[’']t)\s*(?:yet\s+)?(?:been\s+)?(?:established|measurable|measured|identified|determined|clear|known|settled|found)|\s+(?:still\s+)?(?:unclear|unknown|undetermined|unmeasured|unestablished))`;
/** "which assumption" · "which of the assumptions" · "what of these factors". */
const WHICH_ITEM = R`${WHICH}\s+(?:of\s+(?:the|these|those|your)\s+)?${ITEM}`;
const MOST_ADJ = R`most[-\s](?:sensitive|important|influential|consequential|decisive)`;

/** The ONE claim class: "no assumption/factor is established as mattering most". Every form is a row in the tests. */
export const DRIVER_ABSENCE_CLAIM = new RegExp([
  // "this run does not establish which assumption matters most" · "sensitivity has not established which …"
  R`${NEG}${VERB}\s+${WHICH_ITEM}${GAP}${MOST}`,
  // "the run does not establish the most important assumption"
  R`${NEG}${VERB}\s+(?:the\s+)?${MOST_ADJ}\s+${ITEM}`,
  // "this run doesn't tell us what matters most" (never "what matters most to you")
  R`${NEG}${VERB}(?:\s+(?:us|you))?\s+what\s+matters\s+most(?!\s+to\s+(?:you|your|them|the\s+team))`,
  // fronted: "Which assumption matters most has not been established"
  R`\b${WHICH_ITEM}${GAP}${MOST}\s+(?:has|have|is|was|remains?)${ABSENT}`,
  // impersonal: "it is unclear which assumption matters most"
  R`\b(?:it\s+is|it[’']s|it\s+remains|it\s+was)\s+(?:still\s+)?(?:unclear|not\s+(?:yet\s+)?(?:clear|known|established)|unknown|uncertain|undetermined)\s+${WHICH_ITEM}${GAP}${MOST}`,
  // "nothing in this run shows which assumption matters most"
  R`\bnothing\b(?:\s+[\w’'-]+){0,4}?\s+(?:shows?|establish(?:es)?|identifies|indicates|tells?\s+us)\s+${WHICH_ITEM}${GAP}${MOST}`,
  // "no most-sensitive assumption was measurable / has been established"
  R`\bno\s+(?:single\s+)?${MOST_ADJ}\s+${ITEM}\s+(?:was|is|has\s+been|could\s+be|were|are)\s+(?:established|measurable|measured|identified|found|determined)`,
  // "no assumption has been identified as the most important"
  R`\bno\s+(?:single\s+)?${ITEM}\s+(?:has\s+been|was|is|could\s+be)\s+(?:identified|established|shown|found|singled\s+out)\s+as\s+(?:the\s+)?(?:most\s+(?:important|influential|sensitive)|(?:main|key|biggest)\s+driver)`,
  // "no single assumption stands out" · "none of the assumptions stands out"
  R`\b(?:no\s+(?:single\s+)?|none\s+of\s+the\s+)${ITEM}\s+(?:stands?|stood)\s+out`,
  // predicative: "investigation priority is not established" · "the most important assumption is unknown"
  R`\b(?:investigation\s+priority|(?:the\s+)?${MOST_ADJ}\s+${ITEM}|(?:the\s+)?${ITEM}\s+(?:that|which)\s+matters?\s+most|(?:the\s+)?key\s+${ITEM})\s+(?:is|was|has|remains?)${ABSENT}`,
].join('|'), 'i');

const CONNECTOR = /^\s*(?:and|but|so|yet|while|though|although|because|which\s+means)\b\s*/i;
/** Clause starts: ";", ":" (not a time), a dash, ", connector", or a comma-less connector with text before it. */
const STRONG_LEFT = /;|:(?!\d)|—|\s[–-]\s/g;
const COMMA_CONNECTOR_LEFT = /,\s*(?:and|but|so|yet|while|though|although|because|which\s+means)\b/gi;
const BARE_CONNECTOR_LEFT = /\s(?:and|but|while|so|yet)\s/gi;
const RIGHT_STOP = /;|:(?!\d)|\s*—|\s[–-]\s|,\s*(?:and|but|so|yet|while|though|although|because)\b/i;
/**
 * ⛔ DL ruling (S2 review r1 #2): the edit NEVER removes a figure, a percentage, the deadline or horizon, an option
 * label or a lead-in's content. Such a span is kept and logged (`kept_unsafe`): a missed removal is the old behaviour.
 */
const PROTECTED = /\d|%|\b(?:deadline|horizon|within|months?|weeks?|years?|quarters?)\b/i;

const capitalised = (s: string): string => s.replace(/^([^A-Za-z]*)([a-z])/, (_m, lead: string, c: string) => `${lead}${c.toUpperCase()}`);
const words = (s: string): number => s.trim() === '' ? 0 : s.trim().split(/\s+/).length;
function lastMatch(re: RegExp, text: string): { index: number; end: number } | null {
  let last: { index: number; end: number } | null = null;
  for (const m of text.matchAll(re)) last = { index: m.index!, end: m.index! + m[0].length };
  return last;
}

type Cut = { kind: 'cut'; body: string } | { kind: 'lead_in_empty' } | { kind: 'unsafe' };

/** One claim out of one sentence body (no terminal punctuation), or why it must stay. */
function cutOnce(body: string, m: RegExpExecArray, labels: readonly string[]): Cut {
  const pre = body.slice(0, m.index);
  const strong = lastMatch(STRONG_LEFT, pre);
  const comma = lastMatch(COMMA_CONNECTOR_LEFT, pre);
  const bareAll = [...pre.matchAll(BARE_CONNECTOR_LEFT)].map((b) => ({ index: b.index!, end: b.index! + b[0].length }));
  const floor = Math.max(strong?.index ?? -1, comma?.index ?? -1);
  // A comma-less connector opens the clause only with a real clause before it (≥ 3 words since the last boundary).
  const bare = bareAll.filter((b) => b.index > floor && words(pre.slice(Math.max(strong?.end ?? 0, comma?.end ?? 0), b.index)) >= 3).pop() ?? null;
  const left = [strong, comma, bare].filter((b): b is { index: number; end: number } => b !== null)
    .sort((a, b) => b.index - a.index)[0] ?? null;
  // The claim's subject ("the run also", "sensitivity", "it") must be short and plain; a comma or figure in it is unsafe.
  const subject = pre.slice(left?.end ?? 0);
  if (/[,\d%]/.test(subject) || words(subject.replace(/\*+/g, ' ')) > 6) return { kind: 'unsafe' };
  const post = body.slice(m.index + m[0].length);
  const stop = RIGHT_STOP.exec(post);
  const tailStart = m.index + m[0].length + (stop === null ? post.length : stop.index);
  const removeStart = left?.index ?? 0;
  const removed = body.slice(removeStart, tailStart);
  if (PROTECTED.test(removed) || labels.some((l) => l !== '' && removed.includes(l))) return { kind: 'unsafe' };
  const head = body.slice(0, removeStart).replace(/[\s,;:—–-]+$/, '');
  const tail = body.slice(tailStart);
  const colon = left !== null && strong !== null && left.index === strong.index && body[left.index] === ':';
  // "**Sensitivity:** …" / "In short: …": a lead-in left with nothing after it goes with its line.
  if (colon && tail.trim() === '' && words(head.replace(/\*+/g, ' ')) <= 3) return { kind: 'lead_in_empty' };
  if (head.trim() === '') return { kind: 'cut', body: capitalised(tail.replace(/^[\s,;:—–-]+/, '').replace(CONNECTOR, '')) };
  return { kind: 'cut', body: `${head}${tail}` };
}

type SentenceCut = { body: string; removed: number; kept: number; leadInEmpty: boolean };

function bodyWithoutClaim(body: string, labels: readonly string[]): SentenceCut {
  let out = body;
  let removed = 0;
  for (let guard = 0; guard < 4; guard += 1) {
    const m = DRIVER_ABSENCE_CLAIM.exec(out);
    if (m === null) break;
    const cut = cutOnce(out, m, labels);
    if (cut.kind === 'unsafe') return { body, removed: 0, kept: 1, leadInEmpty: false };
    if (cut.kind === 'lead_in_empty') return { body, removed: 0, kept: 0, leadInEmpty: true };
    removed += 1;
    out = cut.body;
  }
  return { body: out.trim(), removed, kept: 0, leadInEmpty: false };
}

/**
 * The text without every absence clause; lines and paragraphs keep their shape; a line left empty is dropped. A lead-in
 * whose whole content was the claim drops its line only when that sentence is the whole line; otherwise it is kept.
 */
export function removeDriverAbsenceClaims(text: string, labels: readonly string[] = []): { text: string; removed: number; keptUnsafe: number } {
  let removed = 0;
  let keptUnsafe = 0;
  const lines = text.split('\n').map((line) => {
    const prefix = /^(\s*(?:[-*•]|\d+[.)])\s+|\s*)/.exec(line)![0];
    const content = line.slice(prefix.length);
    if (!DRIVER_ABSENCE_CLAIM.test(content)) return line;
    // Sentences end at . ! ? (plus any closing markdown or quote) followed by space or end ("4.1%" is not an end).
    const parts = content.split(/(?<=[.!?][*_”’"')\]]*)(?=\s+)/);
    let dropLine = false;
    const kept = parts.map((part) => {
      const lead = /^\s*/.exec(part)![0];
      const sentence = part.slice(lead.length);
      if (!DRIVER_ABSENCE_CLAIM.test(sentence)) return part;
      const end = /[.!?]+[*_”’"')\]]*$/.exec(sentence)?.[0] ?? '';
      const cut = bodyWithoutClaim(sentence.slice(0, sentence.length - end.length), labels);
      if (cut.leadInEmpty) {
        if (parts.length === 1) { dropLine = true; removed += 1; return ''; }
        keptUnsafe += 1;
        return part;
      }
      removed += cut.removed;
      keptUnsafe += cut.kept;
      if (cut.removed === 0) return part;
      return cut.body === '' ? '' : `${lead}${cut.body}${end || '.'}`;
    }).filter((p) => p !== '').join('').trim();
    return dropLine || kept === '' ? null : `${prefix}${kept}`;
  });
  if (removed === 0) return { text, removed, keptUnsafe };
  const joined = lines.filter((l): l is string => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: joined, removed, keptUnsafe };
}

export interface DriverAbsenceEgressOpts {
  readonly analysisResult: unknown;
  readonly graph: unknown;
  readonly requestId: string;
  readonly exitPath: string;
  readonly turnId?: string;
}

/** Final-egress edit: the body by reference unless the Run shows a driver AND the reply denied one. Never throws. */
export function withoutDriverAbsenceClaimsAtEgress<T extends { assistant_text?: unknown }>(body: T, opts: DriverAbsenceEgressOpts): T {
  try {
    if (typeof body.assistant_text !== 'string' || body.assistant_text === '') return body;
    if (Object.keys(goalChanceDriverDisplayForAgent(opts.analysisResult, opts.graph)).length === 0) return body;
    const nodes = (opts.graph as { nodes?: unknown } | null | undefined)?.nodes;
    const labels = (Array.isArray(nodes) ? nodes : []).flatMap((n) => {
      const node = n as { kind?: unknown; label?: unknown } | null;
      return node?.kind === 'option' && typeof node.label === 'string' && node.label.trim() !== '' ? [node.label.trim()] : [];
    });
    const edit = removeDriverAbsenceClaims(body.assistant_text, labels);
    // A reply that would be left empty is kept whole: nothing true would remain to send (logged, never silent).
    const keptUnsafe = edit.keptUnsafe + (edit.removed > 0 && edit.text === '' ? edit.removed : 0);
    if (keptUnsafe > 0) {
      log.warn(
        { event: 'agent_lane.goal_chance_driver_absence_kept_unsafe', code: GOAL_CHANCE_DRIVER_ABSENCE_KEPT_UNSAFE, turn_id: opts.turnId ?? null,
          request_id: opts.requestId, exit_path: opts.exitPath, kept_count: keptUnsafe },
        'agent-lane: a reply denied a goal-chance driver the screen shows, but no clean clause boundary exists; the sentence was kept',
      );
    }
    if (edit.removed === 0 || edit.text === '') return body;
    log.warn(
      { event: 'agent_lane.goal_chance_driver_absence_removed', code: GOAL_CHANCE_DRIVER_ABSENCE_REMOVED, turn_id: opts.turnId ?? null,
        request_id: opts.requestId, exit_path: opts.exitPath, removed_count: edit.removed },
      'agent-lane: the reply denied a goal-chance driver the screen shows; the clause was removed (prompt rule missed)',
    );
    return { ...body, assistant_text: edit.text };
  } catch {
    return body;
  }
}
