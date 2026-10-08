import { horizonSteadyAttested } from '../goal-target/horizon-basis.js';
import { draftedTeamPartOf, teamTimeAsk } from '../goal-target/event-by-date-model.js';
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

import { statedGoalTargetOf } from '../goal-target/stated-goal-target.js';
import { evaluatedIdentityCarriers } from '../admission/identity-evaluations.js';
import { GOAL_CHANCE_LICENSED } from '../goal-target/goal-chance-licence.js';
import { GOAL_CHANCE_RANGE } from '../goal-target/goal-chance-range.js';
import { chanceGoalDeadlineAsk, DEADLINE_ASK_ENDING, goalDeadlineOf, goalKindOf } from '../goal-target/goal-kind.js';
import { deriveEmittedGoalDirection } from '../goal-target/goal-direction.js';
import { deriveGoalIntent } from '../coaching/objective-contradiction.js';
import { inertRiskBranch, preconditionRiskIds } from '../../graph/inert-risk.js';
import { reliesOnRiskLine } from '../routing/relies-on-risk.js';
import { withoutProposalIds } from './display-ids.js';
import { NodeV3 } from '../../schemas/cee-v3.js';
import { readMoneyTotal } from './same-unit.js';
import { sayFigure } from './say-figure.js';
import type { CanonicalAnalysisCell } from '../../routes/canonical-analysis-view.js';

type Rec = Record<string, unknown>;
const recordOf = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const OBJECTIVE_ASK_QUESTION = 'What should this model help you explore?';
const TARGET_ASK_TAIL = "I'll propose it as your target.";

/** The same exact host-owned words still count as said when the composer places the question apart from its context. */
function ownAskAlreadySaid(wanted: string, recentReplies: readonly string[]): boolean {
  const ending = wanted.endsWith(OBJECTIVE_ASK_QUESTION) ? OBJECTIVE_ASK_QUESTION
    : wanted.endsWith(TARGET_ASK_TAIL) ? TARGET_ASK_TAIL : null;
  const units = ending === null ? [wanted] : [wanted.slice(0, -ending.length).trimEnd(), ending].filter((s) => s !== '');
  return recentReplies.some((reply) => units.every((unit) => reply.includes(unit)));
}

/** The goal node of a persisted graph, when there is exactly one. */
function goalOf(graph: unknown): Rec | undefined {
  const nodes = recordOf(graph)?.nodes;
  const goals = Array.isArray(nodes) ? nodes.map(recordOf).filter((n): n is Rec => n !== undefined && n.kind === 'goal') : [];
  return goals.length === 1 ? goals[0] : undefined;
}

/**
 * Whether the goal carries a target the user stated: any of the fields the goal-target writer sets, or (RT-10 B′ R3) the
 * goal's own limit row, read by the ONE target reader — "at most 400" is a target, so it is never asked for again.
 */
export function goalHasStatedTarget(goal: Rec, graph?: unknown): boolean {
  const g = recordOf(graph);
  return finite(goal.goal_threshold_raw) || finite(goal.success_threshold) || finite(goal.goal_threshold)
    || (g !== undefined && statedGoalTargetOf(g, goal) !== null);
}

export interface DecisionInputAskContext {
  readonly scenarioId?: string;
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
  /** The selected current Run's UI cells own the horizon's chance wording. */
  readonly chanceCells?: readonly CanonicalAnalysisCell[];
}

/** A duration limit the analysis scores (a week/month/day constraint): then the deadline is answered, not just held. */
function hasDurationLimit(graph: unknown): boolean {
  const ks = recordOf(graph)?.goal_constraints;
  return Array.isArray(ks) && ks.some((k) => {
    const row = recordOf(k);
    const unit = row?.unit;
    const label = typeof row?.label === 'string' ? row.label : '';
    // A money total measured per month/year is a target's rate, not a duration the analysis scores.
    return readMoneyTotal(unit, label) === null && /week|month|day/i.test(String(unit ?? ''));
  });
}

// ── DecisionGuideAI staging `69c05df1` `serverOpenQuestions.ts` (`splitServerOpenQuestions`), the consumer's predicate:
// from the marker to the first producer sentence after it is behind the questions toggle; the rest is at rest. ──
const QUESTIONS_MARKER = 'Questions this model does not answer yet:';
const PRODUCER_SENTENCE =
  String.raw`(?:No option changes |Not included in this proposal: |Saved\b|Not saved\b|Partly saved\b|That change was already saved\b|The model was |This model had already been built\b)`;
const AFTER_THE_QUESTIONS = new RegExp(String.raw`[.?!)]\s+(?=${PRODUCER_SENTENCE})`);
const NO_QUESTION_FIRST = new RegExp(String.raw`^\s*${PRODUCER_SENTENCE}`);

/**
 * The questions segment the panel puts behind its toggle, by the consumer's own predicate: the words before it (`lead`),
 * the segment itself verbatim from the marker (`segment`), and the producer sentences after it (`after`). Null when the
 * panel would not split this text. ONE predicate: `textAtRest` and the reply composer (`reply/compose-reply.ts`) both read it.
 */
export function openQuestionsSegment(text: string): { readonly lead: string; readonly segment: string; readonly after: string } | null {
  const at = text.indexOf(QUESTIONS_MARKER);
  if (at === -1 || text.indexOf(QUESTIONS_MARKER, at + 1) !== -1 || !/\s$/.test(text.slice(0, at))) return null;
  const lead = text.slice(0, at).trimEnd();
  const tail = text.slice(at + QUESTIONS_MARKER.length);
  if (NO_QUESTION_FIRST.test(tail)) return null;
  const end = tail.search(AFTER_THE_QUESTIONS);
  const questions = (end === -1 ? tail : tail.slice(0, end + 1)).trim();
  if (lead.length === 0 || questions.length === 0) return null;
  const after = end === -1 ? '' : tail.slice(end + 1).trim();
  const segment = text.slice(at, at + QUESTIONS_MARKER.length + (end === -1 ? tail.length : end + 1)).trim();
  return { lead, segment, after };
}

/** The words a reply leaves on screen with the questions toggle closed (the whole text when the panel does not split it). */
export function textAtRest(text: string): string {
  const split = openQuestionsSegment(text);
  if (split === null) return text;
  return split.after ? `${split.lead} ${split.after}` : split.lead;
}

/** Keep selected host obligations visible using the existing consumer split. */
export function withB3LinesAtRest(text: string, lines: readonly (string | null)[]): string {
  let out = text;
  for (const line of lines) {
    if (line === null || textAtRest(out).includes(line)) continue;
    // Only the caller's bound basis/selected objective moves. Other prose stays verbatim.
    const body = out.split(line).join('').trimEnd();
    const at = textAtRest(out) === out ? -1 : body.indexOf(QUESTIONS_MARKER);
    out = at < 0 ? `${body}\n\n${line}`
      : `${body.slice(0, at).trimEnd()}\n\n${line}\n\n${body.slice(at)}`;
  }
  return out;
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
  const allEdges = (Array.isArray(g?.edges) ? g.edges : []).map(recordOf)
    .filter((e): e is Rec => e !== undefined && typeof e.from === 'string' && typeof e.to === 'string')
    .map((e) => ({ from: e.from as string, to: e.to as string, edge_type: e.edge_type }));
  const edges = allEdges.filter((e) => e.edge_type !== 'bidirected');
  const limits = (Array.isArray(g?.goal_constraints) ? g.goal_constraints : []).map((k) => recordOf(k)?.node_id)
    .filter((id): id is string => typeof id === 'string');
  const typedNodes = nodes as { id: string; kind?: unknown; category?: unknown; relies_on?: unknown }[];
  const leftOut = inertRiskBranch(typedNodes, allEdges, limits);
  const preconditions = preconditionRiskIds(typedNodes, allEdges, limits);
  const labelOf = (n: Rec): string => String(n.label ?? n.id);
  return nodes.filter((n) => n.kind === 'risk' && leftOut.has(n.id as string)).map((r) => {
    if (preconditions.has(r.id as string)) {
      // A member is either CEE's `relies_on` stamp or an Olumi draft-time widening (#2854: `draft_widening.hits`, NO
      // relies_on). Never read one shape blind: the served B1 draft 500'd on exactly that (27dfd9e5, 8 Oct).
      const optionId = recordOf(r.relies_on)?.option_id ?? recordOf(recordOf(r.draft_widening)?.hits)?.id;
      const option = nodes.find((n) => n.id === optionId && n.kind === 'option');
      if (option !== undefined) return reliesOnRiskLine(labelOf(r), labelOf(option));
    }
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

/**
 * The goal is projected AT its own month (graph-only twin of the Run's `accumulationTestedAtGoalHorizon`, so chat and
 * Run agree): the user's confirmed goal product binds a confirmed accumulation carrier whose horizon is the goal's
 * held month. Then nothing about the horizon is owed: the model does project over time, to that deadline.
 */
export function goalProjectedAtItsMonth(graph: unknown): boolean {
  const goal = goalOf(graph);
  if (goal === undefined || !Number.isInteger(goal.goal_horizon_months)) return false;
  const product = NodeV3.shape.nonlinear_identity.safeParse(goal.nonlinear_identity).data;
  if (product?.operation !== 'product' || product.stated_in_brief !== true) return false;
  const nodes = recordOf(graph)?.nodes;
  return Array.isArray(nodes) && product.factor_ids.some((id) => {
    const carrier = NodeV3.shape.nonlinear_identity.safeParse(nodes.map(recordOf).find((n) => n?.id === id)?.nonlinear_identity).data;
    return carrier?.operation === 'accumulation' && carrier.stated_in_brief === true && carrier.horizon_months === goal.goal_horizon_months;
  });
}

/** The exact singular/plural prefixes identify the one horizon fact without interpreting narrator wording. */
export const UNTESTED_HORIZON_PREFIXES = [
  "This chance uses the model's numbers as they are today",
  "These chances use the model's numbers as they are today",
] as const;
export const CHANCE_FREE_HORIZON_PREFIX = "This model doesn't yet say whether any option gets there";
const A7_OPENER = CHANCE_FREE_HORIZON_PREFIX;

/** One horizon form for the reply and stored Run, from the same cells the UI reads. */
export function untestedHorizonLineForCells(graph: unknown, cells: readonly CanonicalAnalysisCell[], scenarioId?: string): string | null {
  if (horizonSteadyAttested(graph, scenarioId) || goalProjectedAtItsMonth(graph)) return null;
  const shown = cells.filter(cell => cell.kind === 'figure' || cell.kind === 'range').length;
  if (shown > 0) return untestedHorizonLine(graph, { besideChance: true, plural: shown > 1, scenarioId });
  if (goalKindOf(graph) === 'share_by_date') return null;
  const goal = goalOf(graph);
  if (goal === undefined) return null;
  const within = withinMonths(goal);
  return within !== '' && !hasDurationLimit(graph) ? `${CHANCE_FREE_HORIZON_PREFIX}${within}.` : null;
}

/** The single goal's stated target in the user's unit, shared by the horizon and withheld-chance sentences. */
export function statedTargetWords(graph: unknown): string | null {
  const goal = goalOf(graph);
  if (goal === undefined) return null;
  const target = statedGoalTargetOf(recordOf(graph)!, goal);
  if (target === null) return null;
  const unit = target.unit ?? '';
  const money = readMoneyTotal(unit, typeof goal.label === 'string' ? goal.label : '');
  return sayFigure(target.value, money?.code ?? unit);
}

/**
 * Format the established chance wording, including its held target/deadline and short present-number basis. This
 * function supplies byte-stable identities for formatting and old-copy normalization; the cell rule above owns
 * whether any chance form is licensed. Event-by-date chances already model time and never owe this clause.
 */
export function untestedHorizonLine(graph: unknown, opts?: { besideChance?: boolean; plural?: boolean; scenarioId?: string }): string | null {
  if (horizonSteadyAttested(graph, opts?.scenarioId) || goalKindOf(graph) === 'share_by_date' || goalProjectedAtItsMonth(graph)) return null;
  const goal = goalOf(graph);
  if (goal === undefined) return null;
  const prefix = UNTESTED_HORIZON_PREFIXES[opts?.plural ? 1 : 0];
  const basis = `${prefix}; the model doesn't project how they change over time yet`;
  const within = withinMonths(goal);
  if (within !== '' && !hasDurationLimit(graph)) {
    const target = statedTargetWords(graph);
    const destination = target === null ? 'get there' : `reach ${target}`;
    return `${basis}, so it can't say whether you'll ${destination}${within}.`;
  }
  return opts?.besideChance ? `${basis}.` : null;
}

/** The code the Run carries A7 under: an `info` inference warning whose `message` a consumer shows verbatim. */
export const GOAL_HORIZON_NOT_TESTED = 'GOAL_HORIZON_NOT_TESTED';
/** A retained diagnostic, never a range licence: its original horizon qualifiers conflicted. */
export const GOAL_CHANCE_RANGE_HORIZON_CONFLICT = 'GOAL_CHANCE_RANGE_HORIZON_CONFLICT';

/**
 * Write the horizon as one typed Run fact after the final current cells are projected. A point/range cell supplies
 * the chance form; otherwise held months supply staging's chance-free form. No figure or licence is inferred here.
 * A withdrawn accumulation retains that sentence even with no deadline or a duration limit.
 */
export function withUntestedHorizonWarning<E>(
  envelope: E, graph: unknown, cells: readonly CanonicalAnalysisCell[] | boolean = [], accumulationWithdrawn = false, scenarioId?: string,
): E {
  // Retain staging's pre-cell third-argument form for callers that only carry the withdrawal fact.
  return withCellHorizonWarning(envelope, graph, typeof cells === 'boolean' ? [] : cells,
    typeof cells === 'boolean' ? cells : accumulationWithdrawn, scenarioId);
}

/**
 * The same final-cell rule also writes the short basis where a visible point/range has no untested month count, and
 * keeps any point licence's horizon_line in agreement. The presence/order of a licence or warning chooses no form.
 */
export function withShortHorizonBesideChance<E>(
  envelope: E, graph: unknown, cells: readonly CanonicalAnalysisCell[] = [], accumulationWithdrawn = false, scenarioId?: string,
): E {
  return withCellHorizonWarning(envelope, graph, cells, accumulationWithdrawn, scenarioId);
}

/** A horizon is tested only along the selected goal's Run-attested identity dependencies. */
function accumulationTestedAtGoalHorizon(graph: unknown, envelope: Rec): boolean {
  const goal = goalOf(graph);
  const rawNodes = recordOf(graph)?.nodes;
  if (goal === undefined || !finite(goal.goal_horizon_months) || !Array.isArray(rawNodes)) return false;
  const nodes = rawNodes.map(recordOf).filter((node): node is Rec => node !== undefined);
  const evaluations = Array.isArray(envelope.identity_evaluations) ? envelope.identity_evaluations : undefined;
  // This reader binds accumulation attestations to their declared month and positional inputs.
  const evaluated = evaluatedIdentityCarriers(nodes, evaluations);
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const seen = new Set<unknown>();
  const tested = (id: unknown): boolean => {
    if (seen.has(id) || !evaluated.has(id)) return false;
    seen.add(id);
    const identity = recordOf(byId.get(id)?.nonlinear_identity);
    if (identity?.operation === 'accumulation') return identity.horizon_months === goal.goal_horizon_months;
    return Array.isArray(identity?.factor_ids) && identity.factor_ids.some(tested);
  };
  return tested(goal.id);
}

/** Replace any intermediate wording with the final cell form; the warning and licence stay in agreement. */
function withCellHorizonWarning<E>(
  envelope: E, graph: unknown, cells: readonly CanonicalAnalysisCell[], accumulationWithdrawn: boolean, scenarioId?: string,
): E {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) return envelope;
  const env = envelope as Rec;
  const warnings: unknown[] = Array.isArray(env.inference_warnings) ? env.inference_warnings : [];
  const goal = goalOf(graph);
  const line = horizonSteadyAttested(graph, scenarioId) || (!accumulationWithdrawn && accumulationTestedAtGoalHorizon(graph, env)) ? null
    : untestedHorizonLineForCells(graph, cells, scenarioId) ?? (accumulationWithdrawn && goal !== undefined
      ? `${A7_OPENER}${withinMonths(goal)}.` : null);
  const hasChance = cells.some(cell => cell.kind === 'figure' || cell.kind === 'range');
  const hasRange = cells.some(cell => cell.kind === 'range');
  let changed = false;
  let wroteHorizon = false;
  const next = warnings.flatMap(w => {
    const r = recordOf(w);
    // Removing or normalizing the global qualifier must not repair a range the original cells refused to admit.
    if (r?.code === GOAL_CHANCE_RANGE && !hasRange && typeof r.horizon_line === 'string'
      && warnings.some(prior => recordOf(prior)?.code === GOAL_HORIZON_NOT_TESTED
        && recordOf(prior)?.message !== r.horizon_line)) {
      changed = true;
      return [{ ...r, code: GOAL_CHANCE_RANGE_HORIZON_CONFLICT, original_code: GOAL_CHANCE_RANGE,
        ...(r.message === undefined ? {} : { original_message: r.message }),
        message: 'Range not shown: its recorded horizon qualifiers conflict.',
      }];
    }
    if (r?.code === GOAL_HORIZON_NOT_TESTED) {
      if (line === null || wroteHorizon) { changed = true; return []; }
      wroteHorizon = true;
      if (r.message === line) return [w];
      changed = true;
      return [{ ...r, message: line }];
    }
    // Only a range the original projection admitted may have its metadata aligned; an inconsistent/barred record
    // stays under that reader's existing authority and is never repaired into display permission here.
    if (r?.code === GOAL_CHANCE_LICENSED || (r?.code === GOAL_CHANCE_RANGE && hasRange)) {
      if (line !== null && hasChance) {
        if (r.horizon_untested === true && r.horizon_line === line) return [w];
        changed = true;
        return [{ ...r, horizon_untested: true, horizon_line: line }];
      }
      if (r.horizon_line !== undefined || r.horizon_untested !== undefined) {
        changed = true;
        const { horizon_line: _line, horizon_untested: _untested, ...licence } = r;
        return [licence];
      }
    }
    return [w];
  });
  if (line !== null && !wroteHorizon) {
    const goalId = goalOf(graph)?.id;
    next.push({ code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: line,
      ...(typeof goalId === 'string' ? { node_ids: [goalId] } : {}),
    });
    changed = true;
  }
  return changed ? { ...env, inference_warnings: next } as E : envelope;
}

/** The one ask writer, before display scrubbing or turn eligibility. */
function rawDecisionInputAsk(graph: unknown): string | null {
  const part = draftedTeamPartOf(graph);
  if (part !== null) return goalDeadlineOf(part.goal) === undefined ? chanceGoalDeadlineAsk(part.deliverable) : teamTimeAsk(graph);
  const goal = goalOf(graph);
  const label = typeof goal?.label === 'string' ? goal.label.trim() : '';
  if (goal === undefined || label === '') return null;
  // ⭐ S-E GOALS (Science ruling 7 Oct §2/§4): a goal measured as a CHANCE is never given a target figure ("What figure
  // should '…' reach?" asked for the chance Olumi computes, Paul's turn 7). Its one question is the deadline, while the
  // goal holds no date; with the date held, nothing more is asked here (the model does not yet say what must be done).
  if (goalKindOf(goal) === 'chance_of_event') return goalDeadlineOf(goal) === undefined ? chanceGoalDeadlineAsk(label) : null;
  return goal.provenance === 'ai_inferred' ? `I used "${label}" as a provisional objective. ${OBJECTIVE_ASK_QUESTION}`
    : !goalHasStatedTarget(goal, graph) ? targetAsk(graph, goal, label, withinMonths(goal)) : null;
}

/** Normalise only exact narrator copies of this graph's host ask before placement. */
export function withDecisionInputAskDisplay(text: string, graph: unknown): string {
  const raw = rawDecisionInputAsk(graph);
  return raw === null ? text : text.split(raw).join(withoutProposalIds(raw));
}

export function decisionInputLines(graph: unknown, ctx: DecisionInputAskContext): string[] {
  if (!ctx.builtOrRan) return [];
  const goal = goalOf(graph);
  const label = typeof goal?.label === 'string' ? goal.label.trim() : '';
  if (goal === undefined || label === '') return [];
  // ⭐ K3 (DL on lease 5945974225; CODEX P1; HARNESS CR): the HOST is the one writer — said on the build turn (and its
  // automatic first analysis) and on every Run, never handed to the narrator, so it is said exactly once by construction.
  const leftOut = leftOutLines(graph, label);
  const a7 = untestedHorizonLineForCells(graph, ctx.chanceCells ?? [], ctx.scenarioId);
  const rawWanted = ctx.awaitingApproval || /\?/.test(ctx.restingText) ? null : rawDecisionInputAsk(graph);
  // Dedup the host's displayed ask, independent of unrelated proposal IDs in the narrator's reply.
  const wanted = rawWanted === null ? null : withoutProposalIds(rawWanted);
  const ask = wanted !== null && ownAskAlreadySaid(wanted, ctx.recentReplies ?? []) ? null : wanted;
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
  if (deriveEmittedGoalDirection(graph, goal.id) === 'minimise') return `What is the most that "${label}" can be${within}? ${TARGET_ASK_TAIL}`;
  if (deriveGoalIntent(label).direction === 'increase') return `What is the least that "${label}" must reach${within}? ${TARGET_ASK_TAIL}`;
  return `What figure should "${label}" reach or stay under${within}? ${TARGET_ASK_TAIL}`;
}

/** The host's framing or target ask, recognised by every selector and replay reader. */
export function isDecisionInputAsk(line: string): boolean {
  if (line === 'Roughly how long could it take at the soonest, and at the latest, with the team you have now?') return true;
  if (line.startsWith('How long would ') && line.endsWith(' take with the team you have now?')) return true;
  return line.endsWith('as your target.') || line.endsWith(DEADLINE_ASK_ENDING) || line.endsWith(OBJECTIVE_ASK_QUESTION);
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
  ctx: Pick<DecisionInputAskContext, 'awaitingApproval' | 'builtOrRan' | 'chanceCells' | 'scenarioId'>,
  statusText: string | null,
): string {
  // Unfolded: the lines owed with nothing at rest yet; only A7 is ever inserted here.
  const owedLines = decisionInputLines(graph, { ...ctx, restingText: '', questionsToggle: false });
  const a7 = owedLines.find((l) => l.startsWith(CHANCE_FREE_HORIZON_PREFIX)
    || UNTESTED_HORIZON_PREFIXES.some((prefix) => l.startsWith(prefix)));
  if (a7 === undefined || text.includes(a7)) return text;
  const rest = textAtRest(text);
  if (rest !== text && words(rest) + TOGGLE_LABEL_WORDS + words(a7) > AT_REST_WORD_BOUND) return text;
  const ask = owedLines.find(isDecisionInputAsk);
  if (ask !== undefined && text.split(ask).length === 2) return text.replace(ask, `${a7}\n\n${ask}`);
  if (statusText === null) return text;
  const at = text.lastIndexOf(`\n\n${statusText}`);
  return at < 0 ? text : `${text.slice(0, at)}\n\n${a7}${text.slice(at)}`;
}
