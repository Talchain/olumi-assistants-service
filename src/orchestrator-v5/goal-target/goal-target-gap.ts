/**
 * ⭐ THE ONE "NO TARGET" GAP (C1, Paul's funding test 14 Oct). Moved verbatim from `modelGapOf` (`widen-turn.ts`), which
 * calls it: no target means no option can have a chance of meeting it (D-01). Read in these words by the standing gap
 * (`modelGapOf`, the action bar's "Set target") and the Run cells (`canonical-analysis-view.ts`), which rank it first.
 * Light by design: it imports only the goal readers the cells already load (a `widen-turn.ts` import reordered mocks).
 */
import { statedGoalTargetOf } from './stated-goal-target.js';
import { goalKindOf } from './goal-kind.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const quote = (label: string): string => `‘${label}’`;

export interface GoalTargetGap {
  /** `goal_level_missing`: a core goal's change target the person stated, with no level today to measure it from. */
  readonly kind: 'goal_target_missing' | 'goal_level_missing';
  readonly goal_id: string;
  readonly deadline_known: boolean;
  readonly question: string;
}

/**
 * Whether the goal carries a target: any of the fields the goal-target writer sets (a legacy goal's normalised threshold too,
 * which the Run sends as its threshold), or (RT-10 B′ R3) the goal's own limit row, read by the ONE target reader — "at most
 * 400" is a target, so it is never asked for again. Moved verbatim from `decision-input-ask.ts`, which re-exports it: the
 * target ask and this gap decide with ONE predicate (C1 r1 Codex: a legacy normalised threshold read as "no target").
 */
export function goalHasStatedTarget(goal: Rec, graph?: unknown): boolean {
  const g = rec(graph);
  return finiteNum(goal.goal_threshold_raw) || finiteNum(goal.success_threshold) || finiteNum(goal.goal_threshold)
    || (g !== undefined && statedGoalTargetOf(g, goal) !== null);
}

/**
 * A goal Olumi inferred is a PROVISIONAL objective: its one question is the objective reader's ("What should this model
 * help you explore?", `decision-input-ask.ts`), never a target (AIE Q4; C1 r1 Codex). ONE predicate for both readers.
 */
export const isProvisionalObjective = (goal: Rec): boolean => goal.provenance === 'ai_inferred';

/** The goal the graph names (its named goal id when that is a goal node), else the ONE goal node; undefined otherwise. */
function namedGoalOf(raw: Rec): Rec | undefined {
  const goals = (Array.isArray(raw.nodes) ? raw.nodes.map(rec) : []).filter((n): n is Rec => n?.kind === 'goal');
  const named = raw.goal_node_id;
  if (typeof named === 'string') return goals.find((n) => n.id === named);
  return goals.length === 1 ? goals[0] : undefined;
}

/**
 * DL ruling 23 Oct (a) (Track 3 funding/hiring): on a core graph the living model is the single source of meaning (A2), so
 * this ONE reader reads the goal's own aim there; undefined on a legacy graph (no `living_model`), whose words are unchanged.
 */
function coreAimTargetOf(raw: Rec, goalId: string): Rec | null | undefined {
  const aims = rec(raw.living_model)?.aims;
  if (!Array.isArray(aims)) return undefined;
  const aim = aims.map(rec).find((a) => a?.id === goalId);
  return aim === undefined ? undefined : rec(aim.target) ?? null;
}

/** "Productivity" mid-sentence is "productivity"; "GitHub stars" and "NPS" keep their case (only a plain capitalised first word). */
const midSentence = (q: string): string => (/^\p{Lu}\p{Ll}*(?=\s|$)/u.test(q) ? `${q.charAt(0).toLowerCase()}${q.slice(1)}` : q);
/** A whole-word prefix plus an ellipsis, so the question fits the cell's 400-character carrier. */
const cut = (v: string, limit: number): string => (v.length <= limit ? v : `${v.slice(0, v.lastIndexOf(' ', limit - 1) > 0 ? v.lastIndexOf(' ', limit - 1) : limit - 1).trimEnd()}\u2026`);
/** A reference that is today ("today", "current productivity…", "now"): the change is measured from today's level. */
const TODAY_REFERENCE = /\b(?:today|now|current(?:ly)?|present)\b/i;

/**
 * The question for a change target the person stated (+10%) with no starting level: that level, never the target. Said
 * from today, or from the reference they stated ("against last year"; Codex r2), which is quoted only when it is short.
 */
function startingLevelQuestion(label: string, t: Rec): string {
  const ref = typeof t.baseline === 'string' && t.baseline.trim() !== '' && !TODAY_REFERENCE.test(t.baseline) ? t.baseline.trim() : null;
  const ask = (lab: string, q: string): string => (ref === null
    ? `One gap: ${quote(lab)} is a change from today\u2019s level of ${q}, which isn\u2019t given yet. What is today\u2019s level of ${q}?`
    : `One gap: ${quote(lab)} is a change from ${q} ${ref.length <= 40 ? `as at ${quote(ref)}` : 'at its stated starting point'}, which isn\u2019t given yet. What was ${q} then?`);
  const q = midSentence(String(t.quantity).trim());
  const full = ask(label, q);
  return full.length <= 400 ? full : ask(cut(label, 120), cut(q, 80));
}

/**
 * The named goal holds no target ({@link goalHasStatedTarget}), or null. A chance goal takes no target quantity (the goal-kind
 * registry, #2742 S1): its one question is S1's deadline ask. A provisional objective's is the objective ask. Never this one.
 */
export function goalTargetGapOf(graph: unknown): GoalTargetGap | null {
  const raw = rec(graph);
  const goal = raw === undefined ? undefined : namedGoalOf(raw);
  const label = typeof goal?.label === 'string' && goal.label !== '' ? goal.label : null;
  if (raw === undefined || goal === undefined || typeof goal.id !== 'string' || label === null
    || goalKindOf(goal) === 'chance_of_event' || isProvisionalObjective(goal) || goalHasStatedTarget(goal, raw)) return null;
  const rows = Array.isArray(raw.goal_constraints) ? raw.goal_constraints.map(rec) : [];
  const horizon = rec(goal.goal_horizon);
  const core = coreAimTargetOf(raw, goal.id);
  // On a core graph the aim's own deadline counts, in the person's words ("within the next 2 months" has no date).
  const deadlineKnown = rows.some((r) => r?.node_id === goal.id && rec(r?.deadline_metadata) !== undefined)
    || typeof horizon?.deadline === 'string' || finiteNum(horizon?.months)
    || (typeof core?.by_when === 'string' && core.by_when.trim() !== '');
  // A core aim whose target holds the person's own figure HAS a target, whatever the mapper held it for: never "no target".
  // A change from a level not given yet asks for that level; any other held target is said by its own reason elsewhere.
  // Olumi's suggested measure (`source: 'olumi'`) is not their target, so it is still asked for.
  if (core !== undefined && core !== null && core.source !== 'olumi' && [core.value, core.low, core.high].some(finiteNum)) {
    const change = core.comparator === 'increase' || core.comparator === 'decrease';
    return change && finiteNum(core.value) && core.current === null && typeof core.quantity === 'string' && core.quantity.trim() !== ''
      ? { kind: 'goal_level_missing', goal_id: goal.id, deadline_known: deadlineKnown, question: startingLevelQuestion(label, core) }
      : null;
  }
  return {
    kind: 'goal_target_missing', goal_id: goal.id, deadline_known: deadlineKnown,
    question: deadlineKnown
      ? `One gap: ${quote(label)} has no target yet. What would count as meeting it?`
      : `One gap: ${quote(label)} has no target or deadline yet. What would count as meeting it, and by when?`,
  };
}
