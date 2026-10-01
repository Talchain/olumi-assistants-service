/**
 * ⭐ L1: OLUMI ASKS FOR A LINK'S SIZE WHEN THE USER ASKS ABOUT A LINK OLUMI HAS NOT SIZED (DL #75 5925649954 item 5; R3
 * 5925627855 L1; AIQ words 5925678816 (B); lease 5925667650).
 *
 * Served R3 `train-0545Z` step 05 (CEE `3b0537c1`): "Tell me about the link from "Qualified angel investor conversations" to
 * "securing funding"." The reply said the link's strength was "a default placeholder—not a strength you supplied or anyone
 * has estimated yet" and asked nothing. That is true but incomplete: the figure the model needs is never asked for, so the
 * user has to volunteer it. Now the host asks once, at rest, in AIQ's words, naming the LINK's own target and unit (never
 * the goal by default), and only when:
 *   · the user's message names exactly ONE causal link (both ends' labels; structural decision/option links never count);
 *   · that link is a placeholder: `sizedLinkTest` (the ONE "is this link sized" test, `placeholder-parts.ts`) says unsized,
 *     and the user has not stated it (`user_specified` / `user_stated`);
 *   · its direction is known (`effect_direction` and the mean's sign agree, or only one is present);
 *   · nothing at rest already asks and no card awaits a yes (≤1 ask per turn, AIQ 5923232439), and the message itself
 *     states no figure (that answer is the model's to propose, never asked back).
 * Words with no unit to say them in are never improvised: no ask.
 */

import { sizedLinkTest } from '../../orchestrator/context/placeholder-parts.js';
import { unitOf } from '../../cee/magnitude/link-effect.js';
import { CURRENCY_SYMBOL_TO_CODE, isCurrencyUnit } from '../../utils/currency-alphabet.js';

type Rec = Record<string, unknown>;
const recordOf = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const labelOf = (n: Rec): string => (typeof n.label === 'string' ? n.label.trim() : '');
/** A label as the ask says it: in straight double quotes. */
const quoted = (label: string): string => `"${label}"`;

/** Links into or out of these carry no causal size: a decision's options and an option's levers. */
const STRUCTURAL_KINDS: ReadonlySet<unknown> = new Set(['decision', 'option']);

export interface LinkSizeAskContext {
  /** The user's message this turn. */
  readonly message: string;
  /** The reply AS IT RESTS ON SCREEN without this line (`textAtRest`): any "?" there is the turn's one ask. */
  readonly restingText: string;
  /** A proposal awaits the user's yes: that card is the step, so nothing else is asked. */
  readonly awaitingApproval: boolean;
}

const fold = (s: string): string => s.toLowerCase().replace(/[“”"‘’'`]/g, '').replace(/\s+/g, ' ').trim();
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
/** The label appears in the message as whole words (quotes and case ignored). */
const names = (message: string, label: string): boolean =>
  label.length >= 3 && new RegExp(`(?:^|[^a-z0-9])${escape(fold(label))}(?:$|[^a-z0-9])`).test(fold(message));

/** The ONE causal link whose two ends the message names, or null (none, or more than one). */
function namedLink(graph: unknown, message: string): { edge: Rec; source: Rec; target: Rec; nodes: Rec[] } | null {
  const g = recordOf(graph);
  const nodes = Array.isArray(g?.nodes) ? g.nodes.map(recordOf).filter((n): n is Rec => n !== undefined) : [];
  const edges = Array.isArray(g?.edges) ? g.edges.map(recordOf).filter((e): e is Rec => e !== undefined) : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const named = new Set(nodes.filter((n) => names(message, labelOf(n))).map((n) => n.id));
  const hits = edges.filter((e) => {
    const s = byId.get(e.from); const t = byId.get(e.to);
    return s !== undefined && t !== undefined && named.has(e.from) && named.has(e.to)
      && !STRUCTURAL_KINDS.has(s.kind) && !STRUCTURAL_KINDS.has(t.kind);
  });
  if (hits.length !== 1) return null;
  const edge = hits[0]!;
  return { edge, source: byId.get(edge.from)!, target: byId.get(edge.to)!, nodes };
}

/** The user has said this link's strength or size: never asked back. */
function usersOwnLink(edge: Rec): boolean {
  const p = recordOf(edge.provenance);
  return p?.source === 'user_specified' || p?.magnitude === 'user_stated';
}

/** +1 / -1 when the stored direction is known and consistent, else null. */
function directionOf(edge: Rec): 1 | -1 | null {
  const d = edge.effect_direction;
  const byField = d === 'positive' ? 1 : d === 'negative' ? -1 : null;
  const mean = recordOf(edge.strength)?.mean;
  const byMean = finite(mean) && mean !== 0 ? (mean > 0 ? 1 : -1) : null;
  if (byField !== null && byMean !== null && byField !== byMean) return null;
  return byField ?? byMean;
}

/** The symbol for an ISO code, DERIVED from the one currency vocabulary (never a second list: `currency-vocabulary.union.test.ts`). */
const symbolForCode = (code: string): string | undefined =>
  Object.entries(CURRENCY_SYMBOL_TO_CODE).find(([, c]) => c === code.toUpperCase())?.[0];

/** A money unit, alone or per period ("GBP", "£", "GBP/month"): its symbol and period; null when not money. */
function moneyUnit(unit: string): { symbol: string; per?: string } | null {
  const m = /^(\S+?)\s*(?:(?:\/|\bper\s)\s*(.+))?$/i.exec(unit.trim());
  if (m === null || !isCurrencyUnit(m[1]!)) return null;
  const symbol = Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOL_TO_CODE, m[1]!) ? m[1]! : symbolForCode(m[1]!);
  return symbol === undefined ? null : { symbol, ...(m[2] !== undefined ? { per: m[2].trim() } : {}) };
}

const PERCENT = /^(?:%|percent|percentage|pct)$/i;
/** Plain unit words: letters, spaces, hyphens and one "/" or "per". */
const PLAIN_UNIT = /^[a-z][a-z -]*(?:\s*(?:\/|\bper\b)\s*[a-z][a-z -]*)?$/i;

/** The target's unit, said after "in": "£", "£ per month", "percentage points", or plain words ("hours per week"). */
function targetUnitWords(unit: string): string | null {
  const money = moneyUnit(unit);
  if (money !== null) return money.per === undefined ? money.symbol : `${money.symbol} per ${money.per}`;
  if (PERCENT.test(unit.trim())) return 'percentage points';
  return PLAIN_UNIT.test(unit.trim()) ? unit.trim().replace(/\s*(?:\/|\bper\b)\s*/i, ' per ') : null;
}

/** "one <unit>" for a non-count source: "hours/week" → "hour per week", "%" → "percentage point"; null when unsayable (money too). */
function oneSourceUnit(unit: string): string | null {
  const u = unit.trim();
  if (PERCENT.test(u)) return 'percentage point';
  if (moneyUnit(u) !== null || !PLAIN_UNIT.test(u)) return null;
  const [head, per] = u.split(/\s*(?:\/|\bper\b)\s*/i);
  const one = head!.replace(/([a-z])s$/i, (_w, c: string) => c);
  return per === undefined ? one : `${one} per ${per}`;
}

/** Units a source is MEASURED in, never counted ("one more hours" is not English). */
const MEASURE_WORDS = /^(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|points?|percent|percentage|kg|km|miles?)$/i;
/** A plural noun you count: "conversations", "deals", "customers"; never "responsiveness", "status", "analysis", "earnings". */
const COUNT_NOUN = (w: string): boolean => /^[a-z]{3,}s$/i.test(w) && !/(?:ss|us|is|ics|ings|ws)$/i.test(w) && !MEASURE_WORDS.test(w);

/**
 * AIQ 5925678816 (B) templates, WITHOUT their closing promise (AIQ CR 5925991084 on #2437, option (b)):
 *   count source:     How much does one more "<source>" add to "<target>", in <target unit>?
 *                     ("add to" only for a positive link into money; otherwise "change")
 *   non-count source: How much does "<target>" change when "<source>" goes up by one <source unit>?
 * ⛔ "I'll propose it as your figure." is NOT said: the link-size door (`linkEffectTheUserStated`) refuses the natural
 * answer "About £20,000" (no per-one written), so the promise would end in "restate it" (the E1 dead end). It returns
 * only when that door binds a bare amount answering THIS ask (MG/R3's door, HIGH).
 */
export function linkSizeAsk(graph: unknown, ctx: LinkSizeAskContext): string | null {
  if (ctx.awaitingApproval || /\?/.test(ctx.restingText)) return null;
  const link = namedLink(graph, ctx.message);
  if (link === null) return null;
  const { edge, source, target, nodes } = link;
  if (usersOwnLink(edge) || sizedLinkTest(nodes)(edge)) return null;
  const direction = directionOf(edge);
  if (direction === null) return null;
  const s = labelOf(source); const t = labelOf(target);
  // The message states a figure (outside the two labels): the model proposes it; it is never asked back.
  if (/\d/.test(fold(ctx.message).split(fold(s)).join(' ').split(fold(t)).join(' '))) return null;
  const sourceUnit = unitOf(source as never);
  const targetUnit = unitOf(target as never);
  const lastWord = s.split(/\s+/).at(-1) ?? '';
  const counted = sourceUnit === undefined ? COUNT_NOUN(lastWord) : COUNT_NOUN(sourceUnit.trim());
  if (counted) {
    const inWords = targetUnit === undefined ? null : targetUnitWords(targetUnit);
    if (inWords === null) return null;
    const verb = direction === 1 && moneyUnit(targetUnit!) !== null ? 'add to' : 'change';
    return `How much does one more ${quoted(s)} ${verb} ${quoted(t)}, in ${inWords}?`;
  }
  const one = sourceUnit === undefined ? null : oneSourceUnit(sourceUnit);
  if (one === null) return null;
  return `How much does ${quoted(t)} change when ${quoted(s)} goes up by one ${one}?`;
}
