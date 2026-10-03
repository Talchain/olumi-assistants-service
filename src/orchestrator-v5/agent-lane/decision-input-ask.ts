/**
 * ⭐ OLUMI ASKS FOR THE DECISION INPUT IT LACKS (DL #75 5923918068: R3's dry run D1 "no ask for the minimum amount" + A7
 * "the deadline neither asked nor scored"; lease 5923944336).
 *
 * Measured 0-LLM on R3's `accept-paul/train-0258Z` (served `eea49f5b`): the producer HAD the facts (its open questions name
 * "the current amount of funding already secured is not stated" and "confirm the practical runway date"), but they sit behind
 * the questions toggle, and the brief and Run replies asked NOTHING. After the build the goal holds a horizon
 * (`goal_horizon_months`) and a unit but NO stated target; the user's answer later adds `goal_threshold_raw` /
 * `success_threshold`. So, while the target is missing, the host asks once, at rest (an owed line, before the status line and
 * its questions marker), and only when nothing at rest already asks (≤1 ask per turn, AIQ 5923232439): the model's words,
 * and the host's own at-rest asks (#2420's full-toggle context ask, the levels ask) — CODEX 5923981385.
 */

import { deriveEmittedGoalDirection } from '../goal-target/goal-direction.js';
import { deriveGoalIntent } from '../coaching/objective-contradiction.js';
import { inertRiskBranch } from '../../graph/inert-risk.js';

type Rec = Record<string, unknown>;
const recordOf = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The goal node of a persisted graph, when there is exactly one. */
function goalOf(graph: unknown): Rec | undefined {
  const nodes = recordOf(graph)?.nodes;
  const goals = Array.isArray(nodes) ? nodes.map(recordOf).filter((n): n is Rec => n !== undefined && n.kind === 'goal') : [];
  return goals.length === 1 ? goals[0] : undefined;
}

/** Whether the goal carries a target the user stated (any of the fields the goal-target writer sets). */
export function goalHasStatedTarget(goal: Rec): boolean {
  return finite(goal.goal_threshold_raw) || finite(goal.success_threshold) || finite(goal.goal_threshold);
}

export interface DecisionInputAskContext {
  /**
   * The reply AS IT RESTS ON SCREEN without these lines (`textAtRest` of the composed text: the model's words, the owed
   * lines and the host status). Any ask there, the model's or the host's, is the turn's one ask (CODEX 5923981385).
   */
  readonly restingText: string;
  /** The composed reply puts questions behind the toggle (`textAtRest` split it): A7's fact is already there. */
  readonly questionsToggle: boolean;
  /**
   * ⭐ ASKED ONCE (PANEL #85 5944136475: each Rerun re-asked the target verbatim, ×3 in one session). The user-visible text
   * of this conversation's recent answers (durable rows, as shipped). An ask already among them is still OPEN (the goal
   * has no stated target, or there would be no ask), so it is not said again. Our own exact string, never a wording rule;
   * the goal changing changes the ask, which is then new. Absent (no read, or a failed one) ⇒ ask, exactly as before.
   */
  readonly recentReplies?: readonly string[];
  /** A proposal awaits the user's yes: that card is the step, so nothing else is asked. */
  readonly awaitingApproval: boolean;
  /** This turn built the model or ran the analysis (the brief and Run turns). */
  readonly builtOrRan: boolean;
}

/** A duration limit the analysis scores (a week/month/day constraint): then the deadline is answered, not just held. */
function hasDurationLimit(graph: unknown): boolean {
  const ks = recordOf(graph)?.goal_constraints;
  return Array.isArray(ks) && ks.some((k) => /week|month|day/i.test(String(recordOf(k)?.unit ?? '')));
}

// ── DecisionGuideAI staging `69c05df1` `serverOpenQuestions.ts` (`splitServerOpenQuestions`), the consumer's predicate:
// from the marker to the first producer sentence after it is behind the questions toggle; the rest is at rest. ──
const QUESTIONS_MARKER = 'Questions this model does not answer yet:';
const PRODUCER_SENTENCE =
  String.raw`(?:No option changes |Not included in this proposal: |Saved\b|Not saved\b|Partly saved\b|That change was already saved\b|The model was |This model had already been built\b)`;
const AFTER_THE_QUESTIONS = new RegExp(String.raw`[.?!)]\s+(?=${PRODUCER_SENTENCE})`);
const NO_QUESTION_FIRST = new RegExp(String.raw`^\s*${PRODUCER_SENTENCE}`);

/** The words a reply leaves on screen with the questions toggle closed (the whole text when the panel does not split it). */
export function textAtRest(text: string): string {
  const at = text.indexOf(QUESTIONS_MARKER);
  if (at === -1 || text.indexOf(QUESTIONS_MARKER, at + 1) !== -1 || !/\s$/.test(text.slice(0, at))) return text;
  const lead = text.slice(0, at).trimEnd();
  const tail = text.slice(at + QUESTIONS_MARKER.length);
  if (NO_QUESTION_FIRST.test(tail)) return text;
  const end = tail.search(AFTER_THE_QUESTIONS);
  const questions = (end === -1 ? tail : tail.slice(0, end + 1)).trim();
  if (lead.length === 0 || questions.length === 0) return text;
  const after = end === -1 ? '' : tail.slice(end + 1).trim();
  return after ? `${lead} ${after}` : lead;
}

/** DL #75 5923219186 (R3 K4): words on screen per turn — the reply at rest plus the toggle's label. */
export const AT_REST_WORD_BOUND = 160;
const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;
/** The toggle's own label, "<N> questions this model does not answer yet" (DGAI `MessageBubble`): 7 words. */
const TOGGLE_LABEL_WORDS = 7;

const withinMonths = (goal: Rec): string => {
  const m = goal.goal_horizon_months;
  return finite(m) && m > 0 ? ` within ${m} ${m === 1 ? 'month' : 'months'}` : '';
};

/**
 * The lines, in order (AIQ words 5923963470): A7, a TRUE line (the horizon is held but nothing scores it), then D1, the ONE
 * ask (no stated target). Both are said at rest. A7 asks nothing, so it holds beside a pending proposal or the model's own
 * question; D1 never does. When the reply on screen would pass `AT_REST_WORD_BOUND` and a questions toggle holds A7's
 * fact, A7 stays behind it.
 */
/**
 * ⭐ K3 (`graph/inert-risk.ts`, ONE definition with readiness): a kept risk nobody has said the direction of is left out of
 * the Run, which proceeds — so the Run says so, or its results would silently ignore a risk the user can see on the canvas.
 */
function leftOutLines(graph: unknown, goalLabel: string): string[] {
  const g = recordOf(graph);
  const nodes = (Array.isArray(g?.nodes) ? g.nodes : []).map(recordOf).filter((n): n is Rec => n !== undefined && typeof n.id === 'string');
  const edges = (Array.isArray(g?.edges) ? g.edges : []).map(recordOf)
    .filter((e): e is Rec => e !== undefined && e.edge_type !== 'bidirected' && typeof e.from === 'string' && typeof e.to === 'string')
    .map((e) => ({ from: e.from as string, to: e.to as string }));
  const limits = (Array.isArray(g?.goal_constraints) ? g.goal_constraints : []).map((k) => recordOf(k)?.node_id)
    .filter((id): id is string => typeof id === 'string');
  const leftOut = inertRiskBranch(nodes as { id: string; kind?: unknown; category?: unknown }[], edges, limits);
  const labelOf = (n: Rec): string => String(n.label ?? n.id);
  return nodes.filter((n) => n.kind === 'risk' && leftOut.has(n.id as string)).map((r) => {
    // ⭐ THE ONE WRITER (HARNESS CR on #2509): everything left out with this risk is named HERE, however many hops
    // (DL condition 3), in words that stay true when one cause feeds two left-out risks.
    const upstream = new Set<string>(); const walk = [r.id as string];
    while (walk.length > 0) {
      const at = walk.pop()!;
      for (const e of edges) if (e.to === at && leftOut.has(e.from) && !upstream.has(e.from)) { upstream.add(e.from); walk.push(e.from); }
    }
    const named = nodes.filter((n) => n.kind !== 'risk' && upstream.has(n.id as string)).map((n) => `"${labelOf(n)}"`);
    const list = named.length <= 1 ? named.join('') : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
    const withIt = named.length === 0 ? '' : ` (with ${list}, which ${named.length === 1 ? 'feeds' : 'feed'} only what is left out)`;
    return `"${labelOf(r)}"${withIt} is left out of this analysis until you say whether it raises or lowers "${goalLabel}".`;
  });
}

/** A7's own opener: the one way A7 is told apart from the other owed lines (CODEX K3 P2: never "the first non-ask line"). */
const A7_OPENER = 'This model doesn\'t yet say whether any option gets there';

export function decisionInputLines(graph: unknown, ctx: DecisionInputAskContext): string[] {
  if (!ctx.builtOrRan) return [];
  const goal = goalOf(graph);
  const label = typeof goal?.label === 'string' ? goal.label.trim() : '';
  if (goal === undefined || label === '') return [];
  // ⭐ K3 (DL on lease 5945974225; CODEX P1; HARNESS CR): the HOST is the one writer — said on the build turn (and its
  // automatic first analysis) and on every Run, never handed to the narrator, so it is said exactly once by construction.
  const leftOut = leftOutLines(graph, label);
  const within = withinMonths(goal);
  const a7 = within !== '' && !hasDurationLimit(graph) ? `${A7_OPENER}${within}.` : null;
  const wanted = ctx.awaitingApproval || /\?/.test(ctx.restingText) ? null
    : goal.provenance === 'ai_inferred' ? `I used "${label}" as a provisional objective. What should this model help you explore?`
    : !goalHasStatedTarget(goal) ? targetAsk(graph, goal, label, within) : null;
  const ask = wanted !== null && (ctx.recentReplies ?? []).some((t) => t.includes(wanted)) ? null : wanted;
  // AIQ 5923963470: over the bound, A7 is the line that folds back behind the toggle (its fact is there) — never the ask.
  const onScreen = (ls: readonly (string | null)[]) => words(ctx.restingText) + (ctx.questionsToggle ? TOGGLE_LABEL_WORDS : 0)
    + ls.reduce((n, l) => n + (l === null ? 0 : words(l)), 0);
  const keepA7 = a7 !== null && !(ctx.questionsToggle && onScreen([...leftOut, a7, ask]) > AT_REST_WORD_BOUND);
  return [...leftOut, keepA7 ? a7 : null, ask].filter((l): l is string => l !== null);
}

/**
 * The ask follows the goal's ONE direction authority (AIQ CR 5924149215 on #2426): a floor only where the goal reads
 * increase, a ceiling where it is minimised, and neutral words otherwise — never "the least your costs must reach".
 */
function targetAsk(graph: unknown, goal: Rec, label: string, within: string): string {
  if (deriveEmittedGoalDirection(graph, goal.id) === 'minimise') return `What is the most that "${label}" can be${within}? I'll propose it as your target.`;
  if (deriveGoalIntent(label).direction === 'increase') return `What is the least that "${label}" must reach${within}? I'll propose it as your target.`;
  return `What figure should "${label}" reach or stay under${within}? I'll propose it as your target.`;
}

/** The host's framing or target ask, recognised by every selector and replay reader. */
export function isDecisionInputAsk(line: string): boolean {
  return line.endsWith('as your target.') || line.endsWith('What should this model help you explore?');
}

/** The one framing or target ask, or null. */
export function decisionInputAsk(graph: unknown, ctx: DecisionInputAskContext): string | null {
  return decisionInputLines(graph, ctx).find(isDecisionInputAsk) ?? null;
}

/**
 * ⭐ A7 IS FOLDED ON WHAT THE USER SEES, NOT ON A DRAFT OF IT (R3 #75 5924618869; served `5ab41dda`, PROMPT STRIKE
 * 5924604707): the lines are composed before the withheld-leader gate, which can then drop a ranking sentence the model
 * wrote. Served: the composed reply was over the bound, so A7 folded behind the toggle, and the gate then left 116 words
 * at rest, where A7 fitted. Called after the gate: when A7 is owed, absent, and now fits the bound, it returns where it
 * would have sat — before the ask if the ask was said, else before the status line. Nothing else is added or moved.
 */
export function withA7AfterGate(
  text: string,
  graph: unknown,
  ctx: Pick<DecisionInputAskContext, 'awaitingApproval' | 'builtOrRan'>,
  statusText: string | null,
): string {
  // Unfolded: the lines owed with nothing at rest yet; only A7 is ever inserted here.
  const owedLines = decisionInputLines(graph, { ...ctx, restingText: '', questionsToggle: false });
  const a7 = owedLines.find((l) => l.startsWith(A7_OPENER));
  if (a7 === undefined || text.includes(a7)) return text;
  const rest = textAtRest(text);
  if (rest !== text && words(rest) + TOGGLE_LABEL_WORDS + words(a7) > AT_REST_WORD_BOUND) return text;
  const ask = owedLines.find(isDecisionInputAsk);
  if (ask !== undefined && text.split(ask).length === 2) return text.replace(ask, `${a7}\n\n${ask}`);
  if (statusText === null) return text;
  const at = text.lastIndexOf(`\n\n${statusText}`);
  return at < 0 ? text : `${text.slice(0, at)}\n\n${a7}${text.slice(at)}`;
}
