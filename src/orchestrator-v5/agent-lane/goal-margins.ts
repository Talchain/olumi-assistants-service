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

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Float noise only, relative to the figures themselves (Codex r1: no absolute floor that makes tiny frames agree). */
const close = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b));
/** The Run's figure without float noise (549.9999999999999 is the 550 the Run reports), never a rounded figure (1e12 + 1 stays). */
const clean = (v: number): number => Number(v.toPrecision(15)) + 0;

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
  if (ev === undefined || !ev.static_scope_declared) return undefined;
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
    const level = clean(raw * toNatural);
    const margin = clean(upward ? level - ev.target : ev.target - level);
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
      const boundary = clean(ev.target - ev.baseline);
      // A zero boundary would make the option another "carry on as now" (Codex r1): no test is offered there.
      if (level === clean(ev.baseline + saved) && boundary !== 0 && !close(boundary, saved)) restsOn = { link_id: link.id, saved, boundary };
    }
    options.push({ option_id: id, label, level, margin, meets, ...(restsOn === undefined ? {} : { rests_on: restsOn }) });
  }
  return { target: ev.target, comparator: ev.comparator, unit: ev.unit, baseline: ev.baseline, options };
}
