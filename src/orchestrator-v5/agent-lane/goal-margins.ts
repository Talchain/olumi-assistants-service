/**
 * EXACT-FIGURE COACHING AT SOURCE (DL brief, 23 Oct; Track 3 R2 c1: 0 full / 3 half / 5 zero). With every input the person's
 * own exact figure, a Run's results have no spread and no chance is shown, so the reply had nothing to coach from but "which
 * figure are you least sure of?". These are the Run's own measured facts for that case: how far each option lands from the
 * target, and, only where the model's own exact identity makes it so, the value of the one input it rests on at which it would
 * reach the target. Arithmetic on the Run's recorded figures in the target's unit, never a second engine. Pure.
 *
 * Fails closed (fresh Codex on the approach, 23 Oct): a current Run with a verified static level question; every option
 * withheld by the licence for zero spread (the status quo by its own record), its recorded spread and centres agreeing; the
 * level's frame proved by the status quo's own row against the recorded baseline (ambiguous when both frames agree, unless
 * they are the same frame); no option whose outcome the Run keeps from the AI.
 */
import { goalChanceLicenceForAgent } from '../goal-target/goal-chance-licence.js';
import { recordedStaticLevelEvidence } from '../goal-target/static-run-evidence.js';
import type { SelectedRunEvidence } from '../goal-target/goal-chance-licence.js';
import { keptOutcomeOptionIds } from './decision-sensitivity.js';
import { readRecordedRunQuestion } from '../tools/handlers/run-input-snapshot.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Float noise only, relative to the figures themselves (Codex r1: no absolute floor that makes tiny frames agree). */
const close = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b));
/** A level converted from the encoded frame, read at float's own precision (1.1 × 500 is the 550 the Run means). */
const clean = (v: number): number => Number(v.toPrecision(15)) + 0;
/**
 * A level the Run recorded in the target's own unit, used exactly as recorded: only when it is exactly its 15-digit form, so
 * neither float noise nor a real last digit is ever rounded into a different figure (Codex r2/r3: 1.2e15 + 1); else nothing.
 */
const asRecorded = (v: number): number | undefined => (Number(v.toPrecision(15)) === v ? v + 0 : undefined);
/** A finite figure's own shortest decimal digits as an integer n and places p (value n × 10^−p), trailing zeros dropped. */
const digitsOf = (v: number): { readonly n: bigint; readonly p: number } | undefined => {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/u.exec(String(v + 0));
  if (m === null) return undefined;
  let n = BigInt(m[2]! + (m[3] ?? '')) * (m[1] === '-' ? -1n : 1n);
  let p = (m[3] ?? '').length - Number(m[4] ?? 0);
  if (p < 0) { n *= 10n ** BigInt(-p); p = 0; }
  while (p > 0 && n % 10n === 0n) { n /= 10n; p -= 1; }
  return { n, p };
};
/**
 * a + b exactly as decimals, from each figure's own digits (0.3 − 0.1 is 0.2, 1e15 + 1 − 400 keeps its last digit; Codex r2;
 * 8.00000000000001 + 1.000000000000001 is 9.000000000000011, never a float-scaled 9.000000000000012), or undefined when the
 * exact sum is not exactly what the number it becomes says: nothing is said rather than a rounded figure.
 */
const add = (a: number, b: number): number | undefined => {
  const x = digitsOf(a), y = digitsOf(b);
  if (x === undefined || y === undefined) return undefined;
  const p = Math.max(x.p, y.p);
  const sum = x.n * 10n ** BigInt(p - x.p) + y.n * 10n ** BigInt(p - y.p);
  const digits = (sum < 0n ? -sum : sum).toString().padStart(p + 1, '0');
  const out = Number(`${sum < 0n ? '-' : ''}${digits.slice(0, digits.length - p)}.${digits.slice(digits.length - p)}0`) + 0;
  const back = digitsOf(out);
  let n = sum, q = p;
  while (q > 0 && n % 10n === 0n) { n /= 10n; q -= 1; }
  return back !== undefined && back.n === n && back.p === q ? out : undefined;
};

/** The one input an option's result rests on, where the model's exact sum makes its level today's level plus that input. */
export interface GoalMarginRestsOn {
  /** The person's link, by its living-model id (what `stress_test` tests). */
  readonly link_id: string;
  /** Its saved effect, signed, in the target's unit. */
  readonly saved: number;
  /**
   * The effect at which the option's level equals the target exactly: the boundary between meeting and missing it. For a
   * strict target (above / below) the boundary itself still misses.
   */
  readonly boundary: number;
}
export interface GoalMargin {
  readonly option_id: string;
  readonly label: string;
  /** The option's level in this Run, in the target's unit. */
  readonly level: number;
  /** How far it lands beyond the target (positive) or short of it (negative), in the target's unit. */
  readonly margin: number;
  readonly meets: boolean;
  readonly rests_on?: GoalMarginRestsOn;
}
export interface GoalMargins {
  readonly target: number;
  readonly comparator: string;
  readonly unit: string;
  /** Today's level, as the Run recorded it. */
  readonly baseline: number;
  /**
   * Present (false) only when the licence declared no static scope (a Run with no "carry on" option): these are the model's
   * figures as they stand, not a forecast to the goal's date.
   */
  readonly static_scope_declared?: false;
  readonly options: readonly GoalMargin[];
}

/** One zero-spread level from a row, in its recorded frame: every recorded centre equal and no spread, or undefined. */
function exactLevelOf(row: Rec | undefined): number | undefined {
  const o = rec(row?.outcome);
  if (o === undefined || !finite(o.p50)) return undefined;
  const p50 = o.p50;
  if (finite(o.std) && Math.abs(o.std) > 1e-12 * Math.abs(p50)) return undefined;
  return ['p10', 'p90', 'mean'].every((k) => !(k in o) || (finite(o[k]) && close(o[k] as number, p50))) ? p50 : undefined;
}

/**
 * The selected CURRENT Run's margins against the target (see the header), or undefined. Its input snapshot is the Run's own
 * retained evidence where the stored result does not carry it, only when that evidence is this same Run (as `deriveRunQuestion`).
 */
export function goalMarginsOf(result: unknown, graph: unknown, current: boolean, evidence?: SelectedRunEvidence,
  /** The selected Run's id: the evidence must be THAT Run's (Codex r1: a stored result may carry no id of its own). */
  selectedRunId?: string | null): GoalMargins | undefined {
  const stored = rec(result);
  if (!current || stored === undefined) return undefined;
  if (evidence !== undefined && (typeof selectedRunId !== 'string' || evidence.runId !== selectedRunId
    || (typeof stored.run_id === 'string' && stored.run_id !== selectedRunId))) return undefined;
  const ev = recordedStaticLevelEvidence(evidence?.inputSnapshot === undefined ? stored : { ...stored, input_snapshot: evidence.inputSnapshot });
  if (ev === undefined) return snapshotMarginsOf(stored, graph, evidence, selectedRunId);
  if (!ev.static_scope_declared) return undefined;
  const enrichment = rec(stored.enrichment);
  const rows = Array.isArray(enrichment?.option_comparison) ? enrichment!.option_comparison.map(rec) : [];
  const rowOf = (id: string) => rows.find((r) => r?.option_id === id || (r?.option_id === undefined && r?.id === id));
  if (enrichment === undefined || keptOutcomeOptionIds(enrichment).size > 0) return undefined;
  const licence = goalChanceLicenceForAgent(result);
  const reasons = licence?.withheld_reason_by_option ?? {};
  // Every option is an exact result: withheld for zero spread, the status quo by its own record.
  const sq = ev.status_quo_option_id;
  if (!ev.option_ids.every((id) => reasons[id]?.reason === 'zero_spread' || (id === sq && (licence?.status_quo?.option_id === sq || reasons[id] === undefined)))) return undefined;
  // The frame, from the status quo's own row: today's level in the target's unit, or its encoded value.
  const sqLevel = exactLevelOf(rowOf(sq));
  if (sqLevel === undefined) return undefined;
  // The same frame only when the Run recorded identical figures in both (Codex r1: a near-zero scale is not the same frame).
  const sameFrame = ev.baseline === ev.encoded_baseline && ev.target === ev.encoded_target;
  const natural = close(sqLevel, ev.baseline);
  const encoded = close(sqLevel, ev.encoded_baseline);
  if (!natural && !encoded) return undefined;
  if (natural && encoded && !sameFrame) return undefined;
  let toNatural = 1;
  if (!natural) {
    const scale = ev.target !== 0 ? ev.encoded_target / ev.target : ev.baseline !== 0 ? ev.encoded_baseline / ev.baseline : undefined;
    if (scale === undefined || !(scale > 0)) return undefined;
    toNatural = 1 / scale;
  }
  const upward = ev.comparator === '>=' || ev.comparator === '>';
  const strict = ev.comparator === '>' || ev.comparator === '<';
  const g = rec(graph);
  const living = rec(g?.living_model);
  const lmLinks = Array.isArray(living?.links) ? living!.links.map(rec) : [];
  const lmOptions = Array.isArray(living?.options) ? living!.options.map(rec) : [];
  const nodes = Array.isArray(g?.nodes) ? g!.nodes.map(rec) : [];
  // The mapper's exact sum (`mapper.ts`, exactSum): the goal IS today's level plus the option's change, each a +1 definitional
  // part, so an option's level moves one-for-one with its own exact effect. Without it, no input is said to tip the result.
  const goalNode = nodes.find((n) => n?.id === ev.goal_id);
  const identity = rec(goalNode?.nonlinear_identity);
  const ids = Array.isArray(identity?.factor_ids) ? identity!.factor_ids : [];
  const exactSum = identity?.operation === 'sum' && ids.length === 2 && ids[0] === `${ev.goal_id}_today` && ids[1] === `${ev.goal_id}__change`;
  const options: GoalMargin[] = [];
  for (const id of ev.option_ids) {
    const raw = exactLevelOf(rowOf(id));
    if (raw === undefined) return undefined;
    const level = toNatural === 1 ? asRecorded(raw) : clean(raw * toNatural);
    if (level === undefined) return undefined;
    const margin = upward ? add(level, -ev.target) : add(ev.target, -level);
    if (margin === undefined) return undefined;
    const meets = strict ? margin > 0 : margin >= 0;
    // The licence's own side for this result: a disagreement is a frame we have not understood, so nothing is said.
    const side = reasons[id]?.reason === 'zero_spread' ? (reasons[id] as { side?: string }).side : undefined;
    if (side !== undefined && (side === 'meets') !== meets) return undefined;
    const lmOption = lmOptions.find((o) => o?.id === id);
    const label = typeof lmOption?.label === 'string' ? lmOption.label : undefined;
    if (label === undefined) return undefined;
    let restsOn: GoalMarginRestsOn | undefined;
    const own = lmLinks.filter((l) => l?.from === id);
    const link = own.length === 1 && own[0]?.to === ev.goal_id ? own[0]! : undefined;
    const effect = rec(link?.effect);
    // Never the status quo: it is the Run's paired reference, and testing its effect would remove that reference (Codex r1).
    if (exactSum && id !== sq && link !== undefined && typeof link.id === 'string' && effect?.form === 'exact' && finite(effect.value)
      && (effect.sign === '+' || effect.sign === '-') && (effect.unit === null || effect.unit === ev.unit)
      && Array.isArray(lmOption?.settings) && lmOption!.settings.length === 0) {
      const saved = (effect.sign === '-' ? -1 : 1) * Math.abs(effect.value) + 0;
      // The identity checked on THIS Run: its level is today's level plus that effect, or nothing is said.
      const boundary = add(ev.target, -ev.baseline);
      const reached = add(ev.baseline, saved);
      // A zero boundary would make the option another "carry on as now" (Codex r1): no test is offered there.
      if (boundary !== undefined && reached !== undefined && level === reached && boundary !== 0 && boundary !== saved) restsOn = { link_id: link.id, saved, boundary };
    }
    options.push({ option_id: id, label, level, margin, meets, ...(restsOn === undefined ? {} : { rests_on: restsOn }) });
  }
  return { target: ev.target, comparator: ev.comparator, unit: ev.unit, baseline: ev.baseline, options };
}

/** The option's own single exact link to the goal in the living model, with its signed saved effect (the existing conditions). */
function ownExactLink(graph: unknown, optionId: string, goalId: string, unit: string): { readonly id: string; readonly saved: number; readonly label: string } | undefined {
  const living = rec(rec(graph)?.living_model);
  const lmOption = (Array.isArray(living?.options) ? living!.options.map(rec) : []).find((o) => o?.id === optionId);
  const own = (Array.isArray(living?.links) ? living!.links.map(rec) : []).filter((l) => l?.from === optionId);
  const link = own.length === 1 && own[0]?.to === goalId ? own[0]! : undefined;
  const effect = rec(link?.effect);
  if (typeof lmOption?.label !== 'string' || link === undefined || typeof link.id !== 'string' || effect?.form !== 'exact'
    || !finite(effect.value) || (effect.sign !== '+' && effect.sign !== '-') || (effect.unit !== null && effect.unit !== unit)
    || !Array.isArray(lmOption.settings) || lmOption.settings.length !== 0) return undefined;
  return { id: link.id, saved: (effect.sign === '-' ? -1 : 1) * Math.abs(effect.value) + 0, label: lmOption.label };
}

/**
 * The second route (Track 2, 23 Oct; served R2 P01/P04/P07/P08 had no "carry on" option, so the licence recorded no sent
 * threshold and #3636's route said nothing). Every figure comes from the selected Run's OWN retained inputs: its recorded
 * question, bound by run id, evaluated revision, sent digest and the graph hash it was computed against, whose dispatched
 * threshold must be the target on the goal's own scale (Codex approach: the performed threshold, not the snapshot alone); today's
 * level and each option's one dispatched change; the model's exact sum as the rule that makes a level today plus change. The
 * engine's rows and the licence's sides only have to AGREE; they never supply a figure. Anything else: nothing.
 */
function snapshotMarginsOf(stored: Rec, graph: unknown, evidence: SelectedRunEvidence | undefined, selectedRunId: string | null | undefined): GoalMargins | undefined {
  const snapshot = rec(evidence?.inputSnapshot), goal = rec(snapshot?.goal);
  const revision = evidence?.occurrence?.evaluated_scenario_revision;
  const hash = stored.computed_against_hash;
  if (evidence === undefined || typeof selectedRunId !== 'string' || snapshot === undefined || goal === undefined
    || typeof revision !== 'number' || !Number.isSafeInteger(revision) || typeof hash !== 'string' || hash === '') return undefined;
  const asked = readRecordedRunQuestion(evidence.evaluatedQuestion, { runId: selectedRunId, revision, inputSnapshot: snapshot, graphHashAtRun: hash });
  const calc = asked?.calculated;
  const goalId = goal.node_id, target = goal.target_raw, unit = goal.unit, comparator = goal.operator;
  if (asked === undefined || calc == null || typeof goalId !== 'string' || goalId === ''
    || goal.frame !== 'level' || calc.frame !== 'level' || !finite(target) || typeof unit !== 'string' || unit.trim() === ''
    || typeof comparator !== 'string' || !['>=', '>', '<=', '<'].includes(comparator) || calc.comparator !== comparator || calc.unit !== unit) return undefined;
  if (goal.direction !== undefined && goal.direction !== 'maximise' && goal.direction !== 'minimise') return undefined;
  if (goal.direction === 'minimise' ? !['<=', '<'].includes(comparator) : !['>=', '>'].includes(comparator)) return undefined;
  // Today's level and the change the options set, each once, in the goal's unit; the change itself recorded at zero.
  const factors = Array.isArray(snapshot.factors) ? snapshot.factors.map(rec) : [];
  const one = (id: string) => { const f = factors.filter((x) => x?.factor_id === id); return f.length === 1 && f[0]!.unit === unit && finite(f[0]!.raw) ? f[0]!.raw as number : undefined; };
  const level0 = one(goalId), today = one(`${goalId}_today`), change0 = one(`${goalId}__change`);
  if (level0 === undefined || today !== level0 || change0 !== 0 || calc.baseline !== today) return undefined;
  // The performed target: the dispatched threshold IS the raw target on the dispatched baseline's own scale (relative, no floor).
  const sentT = asked.dispatched_goal_threshold, sentB = asked.dispatched_goal_baseline;
  if (sentT === null || sentB === null || today === 0) return undefined;
  const scale = sentB / today, expected = target * scale;
  // Every step finite (Codex r1: an overflowed product is "close" to an overflowed threshold).
  if (!(scale > 0) || !Number.isFinite(scale) || !Number.isFinite(expected) || !close(sentT, expected)) return undefined;
  // The licence's carrier: one, with no sent threshold (the first route owns those), describing this same goal and target.
  const carriers = [stored.inference_warnings, rec(stored.enrichment)?.inference_warnings].flatMap((v) => (Array.isArray(v) ? v : []))
    .map(rec).filter((w): w is Rec => w?.code === 'GOAL_CHANCE_LICENSED');
  const carrier = carriers.length === 1 ? carriers[0]! : undefined;
  const shown = rec(carrier?.target);
  const said: Readonly<Record<string, string>> = { at_least: '>=', above: '>', at_most: '<=', below: '<' };
  if (carrier === undefined || carrier.sent_threshold !== undefined || carrier.goal_node_id !== goalId || shown === undefined
    || shown.value !== target || shown.unit !== unit || said[String(shown.comparator)] !== comparator
    || (shown.frame !== undefined && shown.frame !== 'level')) return undefined;
  // The model's exact sum is the rule that makes each level today plus its change (Codex approach #3: required, not optional).
  const nodes = Array.isArray(rec(graph)?.nodes) ? (rec(graph)!.nodes as unknown[]).map(rec) : [];
  const identity = rec(nodes.find((n) => n?.id === goalId)?.nonlinear_identity);
  const parts = Array.isArray(identity?.factor_ids) ? identity!.factor_ids : [];
  if (identity?.operation !== 'sum' || parts.length !== 2 || parts[0] !== `${goalId}_today` || parts[1] !== `${goalId}__change`) return undefined;
  const enrichment = rec(stored.enrichment);
  if (enrichment === undefined || keptOutcomeOptionIds(enrichment).size > 0) return undefined;
  const rows = Array.isArray(enrichment.option_comparison) ? enrichment.option_comparison.map(rec) : [];
  const reasons = goalChanceLicenceForAgent(stored)?.withheld_reason_by_option ?? {};
  const options = Array.isArray(snapshot.options) ? snapshot.options.map(rec) : [];
  if (options.length === 0 || !Array.isArray(snapshot.options_not_sent) || snapshot.options_not_sent.length !== 0) return undefined;
  const upward = comparator === '>=' || comparator === '>';
  const strict = comparator === '>' || comparator === '<';
  const boundary = add(target, -today);
  const out: GoalMargin[] = [];
  const seen = new Set<string>();
  for (const o of options) {
    const id = o?.option_id;
    const settings = Array.isArray(o?.settings) ? o!.settings.map(rec) : [];
    if (typeof id !== 'string' || id === '' || seen.has(id) || o?.is_baseline === true || settings.length !== 1) return undefined;
    seen.add(id);
    const set = settings[0]!;
    if (set.factor_id !== `${goalId}__change` || set.unit !== unit || !finite(set.raw)) return undefined;
    const level = add(today, set.raw);
    const margin = level === undefined ? undefined : upward ? add(level, -target) : add(target, -level);
    if (level === undefined || margin === undefined) return undefined;
    const meets = strict ? margin > 0 : margin >= 0;
    // Agreement only: the engine's zero-spread row is this level within float noise; the licence withheld it for zero
    // spread on the same side.
    const row = rows.find((r) => r?.option_id === id || (r?.option_id === undefined && r?.id === id));
    const engine = exactLevelOf(row);
    const reason = reasons[id] as { reason?: string; side?: string } | undefined;
    if (engine === undefined || !close(engine, level) || reason?.reason !== 'zero_spread' || (reason.side === 'meets') !== meets) return undefined;
    const link = ownExactLink(graph, id, goalId, unit);
    const label = typeof o?.label === 'string' ? o.label : undefined;
    if (link === undefined && label === undefined) return undefined;
    // The person's link bound to what the Run dispatched: its saved effect IS the change the Run sent, exactly.
    const restsOn = link !== undefined && link.saved === set.raw && link.saved !== 0 && boundary !== undefined && boundary !== 0
      && boundary !== link.saved ? { link_id: link.id, saved: link.saved, boundary } : undefined;
    out.push({ option_id: id, label: link?.label ?? label!, level, margin, meets, ...(restsOn === undefined ? {} : { rests_on: restsOn }) });
  }
  // The licence covered exactly the Run's options.
  const licensed = Array.isArray(carrier.option_ids) ? carrier.option_ids : [];
  if (licensed.length !== seen.size || licensed.some((id) => typeof id !== 'string' || !seen.has(id))) return undefined;
  return { target, comparator, unit, baseline: today, static_scope_declared: false, options: out };
}
