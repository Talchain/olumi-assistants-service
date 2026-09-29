/**
 * EXPERIMENT (exp/mem0-context-spike-20260929) — the deterministic guard between recalled conversation and the model.
 *
 * ⛔ CANONICAL STATE IS THE ONLY AUTHORITY. A recalled memory is the user's earlier words, never a fact about the
 * model, the analysis, or what the user has approved. This guard decides, with no model call, which recalled words
 * may reach the Agent as supplementary context:
 *
 *   1. scope      — a memory from another scenario or subject is dropped (isolation is not left to the vendor);
 *   2. approval   — words that approve / authorise are dropped: an earlier yes never carries to a new change
 *                   (and cannot anyway: dispatch binds approval from the route, never from model input);
 *   3. analysis   — words asserting an analysis result are dropped unless the canonical run is `complete_current`
 *                   AND the words were said after that run was computed;
 *   4. figures / strength words that disagree with the model:
 *        · the graph revision has NOT moved since the words were said → the model never absorbed them, so they are
 *          surfaced as an UNRECONCILED discrepancy ("you said 4%; the model holds 5%") for the Agent to ASK about;
 *        · the revision moved, or the words cannot be tied to one entity / link → dropped (fail closed: the change
 *          may be exactly the user's later correction, and we cannot tell);
 *   5. supersession — two attributable statements about the same entity / link: only the newest survives.
 *
 * Pure: same input, same output. Never throws on malformed state (a missing section just means "cannot verify",
 * which drops the memories that needed it).
 */
import { findStatedAmounts } from '../../../cee/provenance/stated-amounts.js';

/** One recalled memory, as the adapter normalised it. `user_words` are the user's own (verbatim unless `verbatim: false`). */
export interface RecalledMemory {
  readonly memory_id: string;
  readonly user_words: string;
  readonly answered_question?: string;
  readonly said_at?: string;
  readonly turn_id?: string;
  readonly scenario_id?: string;
  readonly user_id?: string;
  readonly graph_revision_at_time?: string;
  readonly relevance?: number;
  /** false when the vendor rewrote the words (Mem0 `infer=true`): then they are a paraphrase, not a quote. */
  readonly verbatim?: boolean;
}

/** What the Agent may see: supplementary, scenario-scoped, traceable, never authoritative. */
export interface SupplementaryConversationMemory extends RecalledMemory {
  readonly source: 'mem0';
  readonly scope: 'scenario';
  readonly authoritative: false;
  /** The words agree with what the model holds (so they add provenance — "the user said it" — not a new fact). */
  readonly agrees_with_model_state?: true;
}

export const UNRECONCILED_STATUS = 'unreconciled: ask the user which is right; never assume either, never write without approval' as const;

export interface MemoryDiscrepancy {
  readonly memory_id: string;
  readonly about: string;
  readonly user_said: string;
  readonly model_holds: string;
  readonly said_at?: string;
  readonly status: typeof UNRECONCILED_STATUS;
}

export type SuppressionReason =
  | 'scope_mismatch'
  | 'approval_not_transferable'
  | 'analysis_claim_not_current'
  | 'figure_conflict_revision_moved'
  | 'figure_unattributable'
  | 'band_conflict_revision_moved'
  | 'band_ambiguous'
  | 'superseded_by_newer'
  | 'empty';

export interface GuardResult {
  readonly kept: readonly SupplementaryConversationMemory[];
  readonly discrepancies: readonly MemoryDiscrepancy[];
  readonly suppressed: readonly { readonly memory_id: string; readonly reason: SuppressionReason }[];
}

export interface GuardContext {
  readonly scenarioId: string;
  /** The Mem0 subject this request is scoped to. */
  readonly userId: string;
  /** `getCanonicalState`'s result, as read at the start of THIS turn. */
  readonly state: unknown;
}

const APPROVAL = /\b(approve[sd]?|approving|approval|authori[sz](e|ed|es|ing)|go ahead|go for it|do it|apply (it|that|this|them|those)|yes,? (please )?(do|apply|make|add|change|go|save)|sign(ed)? off|permission)\b/i;
const ANALYSIS_CLAIM = /\b(analysis|analy[sz]ed|the run|simulation|results? (show|shows|say|says|said|suggest|suggests|showed)|came out|is ahead|leads?|leading|winner|wins|won|outperform\w*|probability of|chance of|best option)\b/i;
const BAND_WORD = /\b(very strong|strong|moderate|slight|weak)\b/gi;
const STOP = new Set(['the', 'and', 'with', 'from', 'that', 'this', 'what', 'which', 'your', 'have', 'into', 'about', 'rate', 'level', 'total', 'much', 'many', 'does', 'affect', 'effect']);

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const arr = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

interface CanonEntity { readonly id: string; readonly label: string; readonly shown: string; readonly numbers: readonly number[] }
interface CanonLink { readonly from: string; readonly to: string; readonly band: string }
interface Canon {
  readonly revision?: string;
  readonly entities: readonly CanonEntity[];
  readonly links: readonly CanonLink[];
  readonly numbers: readonly number[];
  readonly runKind?: string;
  readonly runComputedAt?: string;
}

/** Every number a figure could legitimately match: the stored value, its raw form, a fraction as a percent, and the display text's own amounts. */
function numbersOf(values: readonly unknown[], display?: unknown): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (!num(v)) continue;
    out.push(v);
    if (Math.abs(v) <= 1) out.push(v * 100);
  }
  if (str(display)) for (const a of findStatedAmounts(display)) out.push(a.magnitude);
  return out;
}

function readCanon(state: unknown): Canon {
  const s = isRec(state) ? state : {};
  const labelOf = new Map<string, string>();
  const entities: CanonEntity[] = [];
  const all: number[] = [];
  for (const e of arr(s.entities)) {
    if (!isRec(e) || !str(e.id) || !str(e.label)) continue;
    labelOf.set(e.id, e.label);
    const levels = arr(e.levels).filter(isRec);
    const nums = numbersOf([e.value, e.raw_value, ...levels.map((l) => l.level)], e.display_value);
    const shown = str(e.display_value) ? e.display_value : num(e.raw_value) ? `${e.raw_value}${str(e.unit) ? ` ${e.unit}` : ''}` : num(e.value) ? `${e.value}${str(e.unit) ? ` ${e.unit}` : ''}` : 'no value set';
    entities.push({ id: e.id, label: e.label, shown, numbers: nums });
    all.push(...nums);
  }
  const goals = [s.goal, ...arr(s.goals)].filter(isRec);
  for (const g of goals) {
    const t = isRec(g.target) ? g.target : undefined;
    if (t !== undefined) all.push(...numbersOf([t.value]));
    if (str(g.label) && t !== undefined && num(t.value)) {
      entities.push({ id: str(g.id) ? g.id : `goal:${g.label}`, label: g.label, shown: `${t.value}${str(t.unit) ? ` ${t.unit}` : ''} (target)`, numbers: numbersOf([t.value]) });
    }
  }
  for (const l of arr(s.limits)) if (isRec(l)) all.push(...numbersOf([l.value]));
  const links: CanonLink[] = [];
  for (const l of arr(s.links)) {
    if (!isRec(l) || !str(l.from) || !str(l.to) || !str(l.band)) continue;
    links.push({ from: labelOf.get(l.from) ?? l.from, to: labelOf.get(l.to) ?? l.to, band: l.band.toLowerCase() });
  }
  const analysis = isRec(s.analysis) ? s.analysis : undefined;
  const run = analysis !== undefined && isRec(analysis.run_state) ? analysis.run_state : undefined;
  return {
    ...(str(s.graph_revision) ? { revision: s.graph_revision } : {}),
    entities,
    links,
    numbers: all,
    ...(str(analysis?.earlier_analysis) ? { runKind: analysis!.earlier_analysis as string } : str(run?.kind) ? { runKind: run!.kind as string } : {}),
    ...(str(run?.computed_at) ? { runComputedAt: run!.computed_at as string } : {}),
  };
}

const tokensOf = (label: string): string[] =>
  label.toLowerCase().split(/[^a-z0-9£$€%]+/).filter((t) => t.length >= 4 && !STOP.has(t));

/** How many of a label's significant words appear in the text (stemmed crudely by prefix). 0 = not mentioned. */
function mentionScore(text: string, label: string): number {
  const hay = text.toLowerCase();
  return tokensOf(label).filter((t) => hay.includes(t.length > 5 ? t.slice(0, t.length - 1) : t)).length;
}

/** The candidates with the single best score, or [] when none is mentioned. Ties are returned together (ambiguous). */
function best<T>(items: readonly T[], score: (t: T) => number): T[] {
  const scored = items.map((t) => ({ t, s: score(t) })).filter((x) => x.s > 0);
  const top = Math.max(0, ...scored.map((x) => x.s));
  return scored.filter((x) => x.s === top).map((x) => x.t);
}

const sameNumber = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-6);
const normBand = (w: string): string => (w.toLowerCase() === 'weak' ? 'slight' : w.toLowerCase());
const time = (iso: string | undefined): number => (iso === undefined ? NaN : Date.parse(iso));

export function guardMemories(memories: readonly RecalledMemory[], ctx: GuardContext): GuardResult {
  const canon = readCanon(ctx.state);
  const suppressed: { memory_id: string; reason: SuppressionReason }[] = [];
  const kept: (SupplementaryConversationMemory & { readonly key?: string })[] = [];
  const discrepancies: (MemoryDiscrepancy & { readonly key: string })[] = [];

  // Newest first, so supersession keeps the latest statement about any one thing.
  const ordered = [...memories].sort((a, b) => (time(b.said_at) || 0) - (time(a.said_at) || 0));
  const claimed = new Set<string>();

  for (const m of ordered) {
    const drop = (reason: SuppressionReason) => { suppressed.push({ memory_id: m.memory_id, reason }); };
    if (!str(m.user_words)) { drop('empty'); continue; }
    if (m.scenario_id !== ctx.scenarioId || m.user_id !== ctx.userId) { drop('scope_mismatch'); continue; }
    if (APPROVAL.test(m.user_words)) { drop('approval_not_transferable'); continue; }
    if (ANALYSIS_CLAIM.test(m.user_words)) {
      const current = canon.runKind === 'complete_current';
      const after = !Number.isNaN(time(m.said_at)) && !Number.isNaN(time(canon.runComputedAt)) && time(m.said_at) > time(canon.runComputedAt);
      if (!(current && after)) { drop('analysis_claim_not_current'); continue; }
    }
    const context = `${m.answered_question ?? ''} ${m.user_words}`;
    const sameRevision = canon.revision !== undefined && m.graph_revision_at_time !== undefined && m.graph_revision_at_time === canon.revision;

    // ── figures ────────────────────────────────────────────────────────────────────────────────────────────────
    const figures = findStatedAmounts(m.user_words).filter((a) => a.kind === 'currency' || a.kind === 'percent');
    const unmatched = figures.filter((a) => !canon.numbers.some((n) => sameNumber(a.magnitude, n)));
    let key: string | undefined;
    let agrees = figures.length > 0 && unmatched.length === 0;
    if (figures.length > 0) {
      const about = best(canon.entities, (e) => mentionScore(context, e.label));
      if (about.length === 1) key = `entity:${about[0]!.id}`;
      if (unmatched.length > 0) {
        if (about.length !== 1) { drop('figure_unattributable'); continue; }
        if (!sameRevision) { drop('figure_conflict_revision_moved'); continue; }
        if (claimed.has(key!)) { drop('superseded_by_newer'); continue; }
        claimed.add(key!);
        discrepancies.push({
          key: key!, memory_id: m.memory_id, about: about[0]!.label, user_said: unmatched.map((a) => a.matchedText.trim()).join(', '),
          model_holds: about[0]!.shown, ...(m.said_at !== undefined ? { said_at: m.said_at } : {}), status: UNRECONCILED_STATUS,
        });
        continue;
      }
    }

    // ── strength words ─────────────────────────────────────────────────────────────────────────────────────────
    const bands = [...m.user_words.matchAll(BAND_WORD)].map((x) => normBand(x[1]!));
    if (bands.length > 0) {
      const onLinks = best(canon.links, (l) => {
        const f = mentionScore(context, l.from);
        const t = mentionScore(context, l.to);
        return f > 0 && t > 0 ? f + t : 0;
      });
      if (onLinks.length > 1 && new Set(onLinks.map((l) => l.band)).size > 1) { drop('band_ambiguous'); continue; }
      if (onLinks.length >= 1) {
        const link = onLinks[0]!;
        key = `link:${link.from}->${link.to}`;
        const said = bands[bands.length - 1]!;
        if (said !== link.band) {
          if (!sameRevision) { drop('band_conflict_revision_moved'); continue; }
          if (claimed.has(key)) { drop('superseded_by_newer'); continue; }
          claimed.add(key);
          discrepancies.push({
            key, memory_id: m.memory_id, about: `link ${link.from} → ${link.to}`, user_said: said, model_holds: link.band,
            ...(m.said_at !== undefined ? { said_at: m.said_at } : {}), status: UNRECONCILED_STATUS,
          });
          continue;
        }
        agrees = true;
      }
    }

    if (key !== undefined) {
      if (claimed.has(key)) { drop('superseded_by_newer'); continue; }
      claimed.add(key);
    }
    kept.push({ ...m, source: 'mem0', scope: 'scenario', authoritative: false, ...(agrees ? { agrees_with_model_state: true as const } : {}), ...(key !== undefined ? { key } : {}) });
  }

  return {
    kept: kept.map(({ key: _k, ...rest }) => rest),
    discrepancies: discrepancies.map(({ key: _k, ...rest }) => rest),
    suppressed,
  };
}
