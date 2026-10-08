/**
 * ⭐ THE GOAL'S DERIVED LEVEL IN THE GOAL'S OWN UNITS (DL 58e392, 8 Oct; Paul's 10:00Z path, try-guide step 4). ISL's
 * `GOAL_LEVEL_FROM_IDENTITY_INPUTS` warning says "…the level its inputs give today: 12,250.00 in its own units; …" for an
 * MRR goal in £ a month. PLoT forwards only its `message` (never ISL's typed `today_level`), so the figure is re-said here,
 * ONCE, where the Run's warnings enter CEE, so the chat and every reader of the stored result say the same words:
 *   · the goal's money (stated unit, else its unit reading) through the shared readers → "£12,250 a month";
 *   · any other unit the shared reader can read → said in that unit;
 *   · no readable unit → the bare number, WITHOUT "in its own units". A unit is never invented.
 * Only that template's figure is touched; every other warning, and every other word of this one, is unchanged. Pure.
 */
import { CURRENCY_SYMBOL_TO_CODE } from '../../utils/currency-alphabet.js';
import { readMoneyTotal, readUnitParts } from './same-unit.js';
import { sayFigure } from './say-figure.js';

export const GOAL_LEVEL_FROM_IDENTITY_INPUTS = 'GOAL_LEVEL_FROM_IDENTITY_INPUTS';
/** ISL's template (robustness_analyzer_v2.py): `{level:,.2f} in its own units;`. Bounded: no backtracking run. */
const OWN_UNITS = /: (-?\d{1,3}(?:,\d{3}){0,6}(?:\.\d{1,6})?) in its own units;/;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined);

/** The one-character symbol the canonical alphabet reads as this code ("GBP" → "£"); else the code itself. */
function symbolOf(code: string): string {
  return Object.entries(CURRENCY_SYMBOL_TO_CODE).find(([symbol, c]) => c === code && Array.from(symbol).length === 1)?.[0] ?? code;
}

/** "£12,250 a month" / "12,250 subscribers" / "12,250": the goal's level in its own units, or bare. */
export function goalLevelWords(value: number, goal: Rec | undefined): string {
  const label = typeof goal?.label === 'string' ? goal.label : '';
  const unit = [rec(goal?.observed_state)?.unit, goal?.unit, rec(goal?.unit_reading)?.unit]
    .find((u): u is string => typeof u === 'string' && u.trim() !== '');
  const money = readMoneyTotal(unit, label);
  if (money !== null) return sayFigure(value, `${symbolOf(money.code)} a ${money.period}`);
  if (unit !== undefined && readUnitParts(unit) !== null) return sayFigure(value, unit.trim());
  return sayFigure(value, '');
}

/** One warnings list, its own-units figure re-said; the same array when nothing matched. */
function sayGoalLevels(warnings: unknown, graph: unknown): unknown {
  if (!Array.isArray(warnings)) return warnings;
  const nodes = rec(graph)?.nodes;
  let changed = false;
  const next = warnings.map((w) => {
    const r = rec(w);
    if (r?.code !== GOAL_LEVEL_FROM_IDENTITY_INPUTS || typeof r.message !== 'string') return w;
    const m = OWN_UNITS.exec(r.message);
    const value = m === null ? NaN : Number(m[1]!.replace(/,/g, ''));
    if (!Number.isFinite(value)) return w;
    const id = typeof r.node_id === 'string' ? r.node_id : undefined;
    const goal = Array.isArray(nodes)
      ? nodes.map(rec).find((n) => n !== undefined && (id !== undefined ? n.id === id : n.kind === 'goal')) : undefined;
    changed = true;
    return { ...r, message: r.message.replace(OWN_UNITS, `: ${goalLevelWords(value, goal)};`) };
  });
  return changed ? next : warnings;
}

/**
 * The Run's warnings (top level, as PLoT's envelope carries them, and `enrichment`, as the stored result does) with this
 * template's figure said in the goal's units. Every other warning and field is untouched; the same object when none match.
 */
export function withGoalLevelInGoalUnits<E>(envelope: E, graph: unknown): E {
  const env = rec(envelope);
  if (env === undefined) return envelope;
  const top = sayGoalLevels(env.inference_warnings, graph);
  const enrichment = rec(env.enrichment);
  const inner = enrichment === undefined ? undefined : sayGoalLevels(enrichment.inference_warnings, graph);
  if (top === env.inference_warnings && inner === enrichment?.inference_warnings) return envelope;
  return { ...env,
    ...(top !== env.inference_warnings ? { inference_warnings: top } : {}),
    ...(enrichment !== undefined && inner !== enrichment.inference_warnings ? { enrichment: { ...enrichment, inference_warnings: inner } } : {}),
  } as E;
}
