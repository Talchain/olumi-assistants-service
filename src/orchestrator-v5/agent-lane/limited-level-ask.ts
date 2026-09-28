/**
 * ⭐ THE USER IS ASKED FOR TODAY'S LEVEL OF A QUANTITY THEY LIMIT, WHEN THE MODEL HOLDS NONE OF THEIRS (DL ruling #72
 * 5863840239 (ii), condition 2).
 *
 * Served journey C ("…while keeping monthly churn under 4%", no churn level stated): `analysis_ready.status` was
 * `ready` with 0 questions while the reply said the churn limit "could not be checked" (MG 5863817204). Under the
 * ruling the level is Olumi's labelled estimate (`cee_inference`, the limit verdict `estimate_only`), so the one figure
 * that would make the user's OWN limit checkable against THEIR number is asked for — typed here, and said where the
 * user always sees it (`open_questions`, appended to the reply and carried whole as `_agent.open_questions`).
 *
 * NON-BLOCKING by construction: it is never a readiness issue, never `analysis_ready.user_questions` (the UI's pre-run
 * check lists those beside its blockers), and the build still registers and runs.
 *
 * Read from the graph construction registers, by identity: a LEVEL limit row (`value_frame` not `delta`: a change from
 * today needs no level of its own) → its ONE factor node → whose level it holds (`classifyValueSource`, the one
 * authority). Asked when that level is Olumi's, or when there is none; never when it is the user's (stated or ratified),
 * and never when an option SETS the factor (that option is checked at the level it sets — the run card's rule,
 * `estimated-limit-card.ts`). Pure.
 */
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { CURRENCY_SYMBOL_TO_CODE } from '../../utils/currency-alphabet.js';
import { collectInterventionControlledFactorIds } from '../context/intervention-controlled-drivers.js';
import { LIMIT_OPERATOR_WORDS, statedOperatorOf } from './limit-operator-words.js';

export interface LimitedLevelAsk {
  readonly kind: 'limited_quantity_level';
  readonly node_id: string;
  readonly quantity: string;
  /** Every level limit on this node, by id. */
  readonly constraint_ids: readonly string[];
  /** Olumi's provisional level the limit can be checked against, or null when the model holds no level at all. */
  readonly estimate: { readonly value: number; readonly unit: string } | null;
  readonly question: string;
}

interface LimitRow {
  readonly constraint_id: string;
  readonly node_id: string;
  readonly operator: string;
  readonly operator_as_stated?: string;
  readonly value: number;
  readonly unit?: string;
  readonly value_frame?: 'level' | 'delta';
}

interface GraphNode {
  readonly id: string;
  readonly kind: string;
  readonly label?: string;
  readonly observed_state?: unknown;
}

/**
 * A prefix symbol by itself or by its code, DERIVED from the one currency vocabulary (never a list of our own: the
 * `currency-vocabulary.union` guard): its single-character, non-letter keys, as that guard reads them. "GBP" and the
 * pound sign both say the pound sign; "CHF", "kr" and the dollar variants stay after the figure.
 */
const PREFIX_SYMBOL: ReadonlyMap<string, string> = new Map(Object.entries(CURRENCY_SYMBOL_TO_CODE)
  .filter(([symbol]) => [...symbol].length === 1 && !/[a-z]/i.test(symbol))
  .flatMap(([symbol, code]) => [[symbol, symbol], [code, symbol]] as const));

/**
 * As the user writes a figure: "3%", "£49 per month", "1,500 subscribers". A currency CODE unit says its symbol
 * ("GBP" → "£30,000", DL copy nit on #2205 5864058391), never "30,000 GBP".
 */
function sayFigure(value: number, unit: string): string {
  const n = value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  if (unit === '') return n;
  if (unit.startsWith('%')) return `${n}${unit}`;
  // The leading token, up to a space or a "/" (served journey E: "GBP/year"); the rest keeps its own separator.
  const [, head = '', rest = ''] = /^([^\s/]+)(.*)$/u.exec(unit) ?? [];
  const symbol = PREFIX_SYMBOL.get(head.toUpperCase()) ?? PREFIX_SYMBOL.get(head);
  if (symbol !== undefined) return `${symbol}${n}${rest}`;
  return `${n} ${unit}`;
}

function sayLimit(row: LimitRow): string {
  const op = statedOperatorOf(row);
  const figure = sayFigure(row.value, typeof row.unit === 'string' ? row.unit.trim() : '');
  return op === undefined ? figure : `${LIMIT_OPERATOR_WORDS[op]} ${figure}`;
}

export function limitedLevelAsks(graph: {
  readonly nodes: readonly GraphNode[];
  readonly goal_constraints?: readonly LimitRow[];
}): LimitedLevelAsk[] {
  const set = collectInterventionControlledFactorIds(graph);
  const rowsByNode = new Map<string, LimitRow[]>();
  for (const row of graph.goal_constraints ?? []) {
    if (row.value_frame === 'delta' || set.has(row.node_id)) continue;
    rowsByNode.set(row.node_id, [...(rowsByNode.get(row.node_id) ?? []), row]);
  }
  const asks: LimitedLevelAsk[] = [];
  for (const [nodeId, rows] of rowsByNode) {
    const matches = graph.nodes.filter((n) => n.id === nodeId);
    if (matches.length !== 1 || matches[0]!.kind !== 'factor') continue;
    const node = matches[0]!;
    const quantity = typeof node.label === 'string' ? node.label.trim() : '';
    if (quantity === '') continue;
    const os = (node.observed_state ?? null) as Record<string, unknown> | null;
    const raw = os?.raw_value;
    const unit = typeof os?.unit === 'string' ? os.unit.trim() : '';
    const estimate = typeof raw === 'number' && Number.isFinite(raw) ? { value: raw, unit } : null;
    // A level that is not Olumi's is not asked about: the user's own (stated or ratified), or an unsourced one — at
    // construction only the definitional "100 % of today" frame (`admit-model.ts`), which is no estimate of anything.
    const whose = classifyValueSource(os?.source);
    if (estimate !== null && whose !== 'ai_drafted' && whose !== 'system_repaired') continue;
    const limits = rows.map(sayLimit).join(' and ');
    asks.push({
      kind: 'limited_quantity_level',
      node_id: nodeId,
      quantity,
      constraint_ids: rows.map((r) => r.constraint_id),
      estimate,
      question: estimate !== null
        ? `What is "${quantity}" today? Your limit (${limits}) can only be checked against Olumi's estimate of ${sayFigure(estimate.value, estimate.unit)}, not a figure you gave, until you give yours.`
        : `What is "${quantity}" today? Your limit (${limits}) cannot be checked until the model has its current level.`,
    });
  }
  return asks;
}
