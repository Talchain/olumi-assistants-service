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
import { collectInterventionControlledFactorIds } from '../context/intervention-controlled-drivers.js';
import { LIMIT_OPERATOR_WORDS, statedOperatorOf } from './limit-operator-words.js';
import { sayFigure } from './say-figure.js';
import { mergeInterventionSourceObjects } from '../../orchestrator/tools/analysis-ready-helper.js';

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

/**
 * ⭐ A LIMIT ON A QUANTITY THE OPTIONS SET AT OLUMI'S FIGURES (DL ruling #72 5865003207 §1; MG finding 5864956818, scope
 * note 5865054192).
 *
 * Served journey C (DL run `pj-20260928T063347Z`): "at most £30,000" on Total investment. Two options SET it at Olumi's
 * £20,000 (`cee_hypothesis` — the brief's "£20k" was the budget, not either option's spend), "Carry on as now" holds
 * today's level, Olumi's £0 (`cee_inference`). The limit was checked, but only against Olumi's figures
 * (`estimate_only / level_olumi_estimate`), and {@link limitedLevelAsks} is silent on a quantity an option sets.
 *
 * ONE ask per limited quantity (every level limit on it named), only when at least one option sets it at a figure that is
 * Olumi's (`classifyValueSource`: `ai_drafted` / `system_repaired`), naming each such figure with its unit. It also asks
 * for TODAY's level when that level is Olumi's or absent: the verdict is `scored` only on the user's own level of the
 * quantity (`constraint-feasibility.ts` `collectLimitLevelOwners`), so a spend-only ask could never move it. Absent when
 * every option's figure is the user's. NON-BLOCKING, as {@link limitedLevelAsks}. Pure.
 */
export interface OptionSetLimitAsk {
  readonly kind: 'option_set_limit_level';
  readonly node_id: string;
  readonly quantity: string;
  readonly constraint_ids: readonly string[];
  /** Olumi's figure for each option that sets the quantity at one, by option label, in the options' order. */
  readonly assumed: readonly { readonly option: string; readonly value: number; readonly unit: string }[];
  /** Olumi's level today; null when the model holds none; absent when today's level is not Olumi's to ask about. */
  readonly today?: { readonly value: number; readonly unit: string } | null;
  readonly question: string;
}

const OLUMIS: ReadonlySet<string> = new Set(['ai_drafted', 'system_repaired']);

interface OptionSource {
  readonly id?: unknown;
  readonly label?: unknown;
  readonly kind?: unknown;
  readonly interventions?: unknown;
}

/** Every option, from its graph node and the top-level `options[]` alike (the first seen per id wins). */
function optionsOf(graph: { readonly nodes: readonly GraphNode[]; readonly options?: readonly unknown[] }): OptionSource[] {
  const seen = new Set<string>();
  const out: OptionSource[] = [];
  for (const o of [...graph.nodes.filter((n) => n.kind === 'option'), ...(graph.options ?? [])] as OptionSource[]) {
    if (o === null || typeof o !== 'object' || typeof o.id !== 'string' || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(o);
  }
  return out;
}

const names = (labels: readonly string[]): string =>
  labels.length === 1 ? `"${labels[0]}"` : `${labels.slice(0, -1).map((l) => `"${l}"`).join(', ')} and "${labels[labels.length - 1]}"`;

export function optionSetLimitAsks(graph: {
  readonly nodes: readonly GraphNode[];
  readonly goal_constraints?: readonly LimitRow[];
  readonly options?: readonly unknown[];
}): OptionSetLimitAsk[] {
  const rowsByNode = new Map<string, LimitRow[]>();
  for (const row of graph.goal_constraints ?? []) {
    if (row.value_frame === 'delta') continue;
    rowsByNode.set(row.node_id, [...(rowsByNode.get(row.node_id) ?? []), row]);
  }
  const options = optionsOf(graph);
  const asks: OptionSetLimitAsk[] = [];
  for (const [nodeId, rows] of rowsByNode) {
    const matches = graph.nodes.filter((n) => n.id === nodeId);
    if (matches.length !== 1 || matches[0]!.kind !== 'factor') continue;
    const node = matches[0]!;
    const quantity = typeof node.label === 'string' ? node.label.trim() : '';
    if (quantity === '') continue;
    const os = (node.observed_state ?? null) as Record<string, unknown> | null;
    const nodeUnit = typeof os?.unit === 'string' ? os.unit.trim() : '';

    const assumed: { option: string; value: number; unit: string }[] = [];
    for (const option of options) {
      const label = typeof option.label === 'string' ? option.label.trim() : '';
      const entry = mergeInterventionSourceObjects(option as Record<string, unknown>)[nodeId];
      if (label === '' || entry === null || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (!OLUMIS.has(classifyValueSource(e.source)) || typeof e.raw_value !== 'number' || !Number.isFinite(e.raw_value)) continue;
      assumed.push({ option: label, value: e.raw_value, unit: typeof e.unit === 'string' && e.unit.trim() !== '' ? e.unit.trim() : nodeUnit });
    }
    if (assumed.length === 0) continue;

    const raw = os?.raw_value;
    const known = typeof raw === 'number' && Number.isFinite(raw);
    const whose = classifyValueSource(os?.source);
    const today = !known ? null : OLUMIS.has(whose) ? { value: raw as number, unit: nodeUnit } : undefined;

    const limits = rows.map(sayLimit).join(' and ');
    const said = assumed.map((a) => sayFigure(a.value, a.unit));
    const figures = assumed.length > 1 && said.every((f) => f === said[0])
      ? `${said[0]} each under those options`
      : assumed.map((a, i) => `${said[i]} under "${a.option}"`).join(' and ');
    const under = names(assumed.map((a) => a.option));
    const question = today === undefined
      ? `What would "${quantity}" be under ${under}? Your limit (${limits}) can only be checked against Olumi's assumed ` +
        `${figures}, not figures you gave, until you give yours.`
      : today === null
        ? `What is "${quantity}" today, and what would it be under ${under}? Your limit (${limits}) cannot be checked against ` +
          `figures you gave until you give them: the model has no level for today, and Olumi assumed ${figures}.`
        : `What is "${quantity}" today, and what would it be under ${under}? Your limit (${limits}) can only be checked ` +
          `against Olumi's figures (${sayFigure(today.value, today.unit)} today, and ${figures}), not figures you gave, ` +
          'until you give yours.';
    asks.push({
      kind: 'option_set_limit_level',
      node_id: nodeId,
      quantity,
      constraint_ids: rows.map((r) => r.constraint_id),
      assumed,
      ...(today !== undefined ? { today } : {}),
      question,
    });
  }
  return asks;
}

/**
 * ⭐ THE ONE PRODUCER OF A LIMIT'S ASK SENTENCE, per limit (DL ruling 5865003207 §2; seam agreed with Runtime 5865068147):
 * `run_analysis`'s per-limit check row quotes `question` verbatim as its `ask`, joined on `constraint_id`, read from the
 * same graph read. Both kinds; a limit with neither has no row, and the check row's own sentence stands alone. Pure.
 */
export interface LimitCheckAsk {
  readonly kind: LimitedLevelAsk['kind'] | OptionSetLimitAsk['kind'];
  readonly constraint_id: string;
  readonly node_id: string;
  readonly question: string;
}

export function limitCheckAsks(graph: {
  readonly nodes: readonly GraphNode[];
  readonly goal_constraints?: readonly LimitRow[];
  readonly options?: readonly unknown[];
}): LimitCheckAsk[] {
  return [...limitedLevelAsks(graph), ...optionSetLimitAsks(graph)].flatMap((a) =>
    a.constraint_ids.map((constraint_id) => ({ kind: a.kind, constraint_id, node_id: a.node_id, question: a.question })));
}
