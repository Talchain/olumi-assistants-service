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

const R = String.raw;
const ITEM = R`(?:assumption|factor|input|driver)s?`;
const WHICH = R`(?:which|what)`;
/** "which assumption in this model matters most": at most four words between the noun and its "most". */
const GAP = R`(?:\s+[\w’'-]+){0,4}?`;
const MOST = R`\s+(?:(?:matters?|mattered)\s+(?:the\s+)?most|(?:is|was|are|were)\s+(?:the\s+)?most\s+(?:worth\s+investigating|important|sensitive|influential|consequential|decisive)|(?:deserves?|merits?|needs?)\s+(?:investigation|attention|checking|testing)\s+first|(?:to\s+)?(?:investigate|check|test|examine)\s+first|drives?\s+(?:the\s+)?(?:result|outcome|chance|comparison)\s+most|most\s+(?:affects?|influences?|drives?|moves?|shapes?|changes?)\b)`;
const NEG = R`(?:\b(?:does|do|did|has|have|had|could|can|ca|was|were|will|wo|is|would)\s*(?:not|n[’']t)|\bcannot|\bnever)(?:\s+(?:yet|also|itself|still))*`;
const VERB = R`\s+(?:been\s+)?(?:able\s+to\s+)?(?:establish|identif|determin|measur|show|tell|say|pin\w*\s+down|single\w*\s+out|isolat|find|found|reveal|indicat|clarif|settl)\w*`;
const ABSENT = R`(?:\s*(?:not|n[’']t)\s*(?:yet\s+)?(?:been\s+)?(?:established|measurable|measured|identified|determined|clear|known|settled|found)|\s+(?:still\s+)?(?:unclear|unknown|undetermined|unmeasured|unestablished))`;

/** The ONE claim class: "no assumption/factor is established as mattering most". Every form is a row in the tests. */
export const DRIVER_ABSENCE_CLAIM = new RegExp([
  // "this run does not establish which assumption matters most" · "sensitivity has not established which …"
  R`${NEG}${VERB}\s+${WHICH}\s+${ITEM}${GAP}${MOST}`,
  // fronted: "Which assumption matters most has not been established"
  R`\b${WHICH}\s+${ITEM}${GAP}${MOST}\s+(?:has|have|is|was|remains?)${ABSENT}`,
  // impersonal: "it is unclear which assumption matters most"
  R`\b(?:it\s+is|it[’']s|it\s+remains|it\s+was)\s+(?:still\s+)?(?:unclear|not\s+(?:yet\s+)?(?:clear|known|established)|unknown|uncertain|undetermined)\s+${WHICH}\s+${ITEM}${GAP}${MOST}`,
  // "no most-sensitive assumption was measurable / has been established"
  R`\bno\s+(?:single\s+)?most[-\s](?:sensitive|important)\s+${ITEM}\s+(?:was|is|has\s+been|could\s+be|were|are)\s+(?:established|measurable|measured|identified|found|determined)`,
  // "no single assumption stands out"
  R`\bno\s+(?:single\s+)?${ITEM}\s+(?:stands?|stood)\s+out`,
  // predicative: "investigation priority is not established" · "the most important assumption is unknown"
  R`\b(?:investigation\s+priority|(?:the\s+)?most[-\s](?:sensitive|important)\s+${ITEM}|(?:the\s+)?${ITEM}\s+(?:that|which)\s+matters?\s+most|(?:the\s+)?key\s+${ITEM})\s+(?:is|was|has|remains?)${ABSENT}`,
].join('|'), 'i');

const CONNECTOR = /^\s*(?:and|but|so|yet|while|though|although|because|which\s+means)\b\s*/i;
const RIGHT_STOP = /;|:|,\s*(?:and|but|so|yet|while|though|although|because)\b/i;

const capitalised = (s: string): string => s.replace(/^([^A-Za-z]*)([a-z])/, (_m, lead: string, c: string) => `${lead}${c.toUpperCase()}`);

/** One sentence body (no terminal punctuation) without its absence clause(s); '' when nothing of it remains. */
function bodyWithoutClaim(body: string): { body: string; removed: number } {
  let out = body;
  let removed = 0;
  for (let guard = 0; guard < 4; guard += 1) {
    const m = DRIVER_ABSENCE_CLAIM.exec(out);
    if (m === null) break;
    removed += 1;
    const pre = out.slice(0, m.index);
    const strong = Math.max(pre.lastIndexOf(';'), pre.lastIndexOf(':'));
    const comma = pre.lastIndexOf(',');
    // A comma opens the clause only when a connector follows it ("…, so this run does not establish …"); otherwise the
    // clause runs back to the last ';' / ':' or the sentence start (never a comma inside the subject).
    const left = comma > strong && CONNECTOR.test(pre.slice(comma + 1)) ? comma : strong;
    const post = out.slice(m.index + m[0].length);
    const stop = RIGHT_STOP.exec(post);
    const head = (left < 0 ? '' : out.slice(0, left)).replace(/[\s,;:]+$/, '');
    const tail = stop === null ? '' : post.slice(stop.index);
    if (head.trim() === '') {
      out = capitalised(tail.replace(/^[\s,;:]+/, '').replace(CONNECTOR, ''));
    } else {
      out = `${head}${tail}`;
    }
  }
  return { body: out.trim(), removed };
}

/** The text without every absence clause; lines and paragraphs keep their shape; a line left empty is dropped. */
export function removeDriverAbsenceClaims(text: string): { text: string; removed: number } {
  let removed = 0;
  const lines = text.split('\n').map((line) => {
    const prefix = /^(\s*(?:[-*•]|\d+[.)])\s+|\s*)/.exec(line)![0];
    const content = line.slice(prefix.length);
    if (!DRIVER_ABSENCE_CLAIM.test(content)) return line;
    // Sentences end at . ! ? (plus any closing markdown or quote) followed by space or end ("4.1%" is not an end).
    const parts = content.split(/(?<=[.!?][*_”’"')\]]*)(?=\s+)/);
    const kept = parts.map((part) => {
      const lead = /^\s*/.exec(part)![0];
      const sentence = part.slice(lead.length);
      const end = /[.!?]+[*_”’"')\]]*$/.exec(sentence)?.[0] ?? '';
      const cut = bodyWithoutClaim(sentence.slice(0, sentence.length - end.length));
      removed += cut.removed;
      if (cut.removed === 0) return part;
      return cut.body === '' ? '' : `${lead}${cut.body}${end || '.'}`;
    }).filter((p) => p !== '').join('').trim();
    return kept === '' ? null : `${prefix}${kept}`;
  });
  if (removed === 0) return { text, removed };
  const joined = lines.filter((l): l is string => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: joined, removed };
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
    const edit = removeDriverAbsenceClaims(body.assistant_text);
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
