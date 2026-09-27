/**
 * ⭐ C6-2 — "READING YOUR DECISION": the user's own goal and options, a few seconds into a first brief (X5).
 *
 * A first brief takes 75–110 s on served CEE (#70 5858945391), most of it one construction call no lever shortens
 * (Runtime 5858909953). Meanwhile the user sees nothing that says Olumi has understood THEIR decision. One fast call
 * copies two things out of the brief, and the route streams them as a `BRIEF_READ` stage frame.
 *
 * AI Quality's ruling (#70 5858767026), measured on Paul's 10 first briefs (AIC 5858747922):
 *   · SOURCE: one gpt-4.1 span-copy call (p50 1.3 s, 94/95 items verbatim). The deterministic extractor was REJECTED:
 *     it named an OPTION as the goal on two of Paul's briefs, which is a wrong claim, not a gap.
 *   · v1 = GOAL + OPTIONS. v2 (AIQ GO #70 5859288025) adds LIMITS, shown only when the span carries its OWN
 *     comparator cue ({@link LIMIT_CUE}) and is not also a goal or an option (role exclusivity: "raise the ad budget
 *     to £5k" is an option, never a limit). Measured on Paul's 10 + 10 external briefs × 2: 0 costs or facts kept.
 *     A limit without a cue is DROPPED, never relabelled: recall is traded for precision, because a heading is a claim.
 *   · EVERY item is an exact substring of the user's message, or it is DROPPED (`gateBriefReading`): fails closed
 *     per item. Nothing is rewritten, converted or rescaled.
 *   · No leader, no ranking, no recommendation: the schema has no field that could carry one.
 *   · Superseded by the model and never persisted: the frame is display-only, sent before GRAPH_READY or not at all.
 */

/** The model the measurement ran (gpt-4.1-2025-04-14 served it). */
export const BRIEF_READING_MODEL = 'gpt-4.1';

/** The instructions the measurement ran, verbatim (`c62-spans.mjs`, #70 5858747922 and 5859279077). */
export const BRIEF_READING_INSTRUCTIONS = [
  'You copy words out of a decision brief. You never paraphrase, summarise, convert or rescale.',
  'Every string you return must be copied character-for-character from the brief, including its numbers, units and currency symbols.',
  'goal: the words that state the outcome the user wants to reach (for example a target figure and date), or null if the brief states none.',
  'limits: the words that state each limit the user must stay within (a cap, a floor, a budget, a deadline they set). Omit context facts that are not limits.',
  'options: the words naming each course of action the user says they are choosing between, exactly as the user wrote them. Never add an option the user did not write, including "carry on as now" or "do nothing".',
  'Do not rank, compare, recommend or judge the options.',
].join('\n');

export const BRIEF_READING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['goal', 'limits', 'options'],
  properties: {
    goal: { type: ['string', 'null'] },
    limits: { type: 'array', items: { type: 'string' } },
    options: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * A limit is shown only if its OWN words carry a comparator (AIQ's list + the EXT additions AIQ accepted, 5859288025).
 * "$40,000 to $50,000" (a cost) and "£200k runway remaining" (a fact) carry none, so they are never called limits.
 */
export const LIMIT_CUE = /\b(under|at most|no more than|below|up to|at least|maximum|budget of|budget|capped|can[’']?t [a-z ]{0,20}more than|cannot [a-z ]{0,20}more than)\b|≤|</i;
/** More limits than this is not a list of caps the user set: ALL limits are dropped, never a subset. */
export const MAX_LIMITS = 6;

/** A span longer than this is a paragraph, not a goal or an option: dropped. */
export const MAX_SPAN_CHARS = 240;
/** More options than this and the list is not a choice the user named: ALL options are dropped, never a subset. */
export const MAX_OPTIONS = 6;
/** Past this the reading is too late to be useful; the model is close behind. */
export const BRIEF_READING_TIMEOUT_MS = 8_000;

export interface BriefReading {
  readonly goal: string | null;
  readonly options: readonly string[];
  /** v2: the user's own words for each limit that carries a comparator cue; never a goal's or an option's words. */
  readonly limits: readonly string[];
}

/**
 * The per-item verbatim gate (limits: see {@link LIMIT_CUE} and role exclusivity). `text` is the model's JSON; `message` is the USER'S message, never the Agent's
 * restatement. A span survives only if, trimmed, it is non-empty, at most {@link MAX_SPAN_CHARS} and an exact
 * substring of `message`. Duplicate options and an option equal to the goal are dropped. More than
 * {@link MAX_OPTIONS} surviving options drops them all (a partial list would claim the choice is only those).
 * Null when nothing survives. Never throws.
 */
export function gateBriefReading(message: string, text: string): BriefReading | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { goal?: unknown; options?: unknown };
  const span = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t.length > 0 && t.length <= MAX_SPAN_CHARS && message.includes(t) ? t : null;
  };
  const goal = span(r.goal);
  const seen = new Set<string>(goal !== null ? [goal] : []);
  const options: string[] = [];
  for (const o of Array.isArray(r.options) ? r.options : []) {
    const t = span(o);
    if (t === null || seen.has(t)) continue;
    seen.add(t);
    options.push(t);
  }
  const kept = options.length > MAX_OPTIONS ? [] : options;
  // v2 limits: verbatim, cue-bearing, and NEVER overlapping a goal or option span (role exclusivity, both directions).
  const roles = [...(goal !== null ? [goal] : []), ...kept];
  const cued: string[] = [];
  for (const l of Array.isArray(r.limits) ? r.limits : []) {
    const t = span(l);
    if (t === null || !LIMIT_CUE.test(t) || cued.includes(t)) continue;
    if (roles.some((x) => x.includes(t) || t.includes(x))) continue;
    cued.push(t);
  }
  // Overlapping limits ("budget is £200,000" inside "budget is £200,000, but we'd like to spend less"): the longer only.
  const limits = cued.filter((t) => !cued.some((o) => o !== t && o.includes(t)));
  const shownLimits = limits.length > MAX_LIMITS ? [] : limits;
  return goal === null && kept.length === 0 && shownLimits.length === 0 ? null : { goal, options: kept, limits: shownLimits };
}

/** The one model call, injected by the route (provider policy, usage ledger, timeout). Returns the output text. */
export type CallBriefReading = (req: {
  readonly model: string;
  readonly instructions: string;
  readonly input: string;
  readonly schema: Record<string, unknown>;
}) => Promise<string>;

/**
 * Read the brief. NEVER THROWS and never delays the turn: the route starts it without awaiting, and any failure,
 * refusal or timeout is simply no reading.
 */
export async function readBrief(message: string, call: CallBriefReading): Promise<BriefReading | null> {
  if (message.trim().length === 0) return null;
  try {
    const text = await call({ model: BRIEF_READING_MODEL, instructions: BRIEF_READING_INSTRUCTIONS, input: message, schema: BRIEF_READING_SCHEMA });
    return gateBriefReading(message, text);
  } catch {
    return null;
  }
}
