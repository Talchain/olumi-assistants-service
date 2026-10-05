/** Disclosure only. The caller owns current-run binding and leader permission. */
import { structureProvenance } from '../../cee/graph-readiness/obligation-provenance.js';
import { isAcceptedOlumiEstimate } from '../../cee/transforms/provenance-display.js';
import { winnerOptionResultSource, isUsableWinProbability } from '../../orchestrator/context/option-result-source.js';
import { asAnalysed } from '../../orchestrator/context/placeholder-parts.js';
import { isRecommendableOption } from '../tools/handlers/recommendable-option.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const UNAVAILABLE = 'The sources of this comparison’s factor starting values are unavailable.';
const COVERAGE = 'These are factor starting values on the comparison’s paths. Other model assumptions may also affect the result.';

export interface ConditionalInputBasis {
  readonly graph: unknown;
  readonly admission: unknown;
  readonly analysedOptionIds: readonly string[];
}
/** The existing current-first option-result reader; an excluded option never joins the set. */
export function analysedOptionIds(result: unknown): readonly string[] {
  const block = rec(result);
  // Comparison participation is wider than crown eligibility: ISL partial rows have real samples.
  // Retain them only with the finite-result proof below; failed/error/skipped rows remain excluded.
  const rows = winnerOptionResultSource(rec(block?.enrichment) ?? block ?? {})
    .filter((row) => isRecommendableOption(row) || row.status === 'partial');
  if (rows.some((r) => !isUsableWinProbability(r.win_probability) && !finite(rec(r.outcome)?.mean))) return [];
  const ids = rows.map((r) => r.option_id ?? r.id);
  return ids.every((id): id is string => typeof id === 'string' && id.trim() !== '') && new Set(ids).size === ids.length ? ids : [];
}

export function conditionalInputBasis(input: ConditionalInputBasis): string | null {
  const basis = factorStartingValueBasis(input);
  const graph = rec(input.graph);
  // The graph the Run computes on (`asAnalysed`): a node kept out of the calculation, and its links, are not "used"
  // (Codex #2591 r1 P2). Causal links only (non-option, non-decision ends), each relationship once however many
  // stored copies it has (r1 P2: duplicates).
  const analysed = asAnalysed({ nodes: Array.isArray(graph?.nodes) ? graph.nodes : [], edges: graph?.edges });
  const causalNodeIds = new Set(analysed.nodes.map(rec)
    .filter((n): n is Rec => n !== undefined && typeof n.id === 'string' && n.kind !== 'option' && n.kind !== 'decision')
    .map((n) => n.id));
  const count = new Set((Array.isArray(analysed.edges) ? analysed.edges : []).map(rec)
    .filter((e): e is Rec => e !== undefined && causalNodeIds.has(e.from) && causalNodeIds.has(e.to)
      && rec(e.provenance)?.magnitude === 'example_figure')
    .map((e) => JSON.stringify([e.from, e.to]))).size;
  if (count === 0) return basis;
  const example = `This comparison uses the example's figures for ${count} ${count === 1 ? 'link' : 'links'}.`;
  return basis === null ? example : `${example} ${basis}`;
}

function factorStartingValueBasis(input: ConditionalInputBasis): string | null {
  const raw = rec(rec(input.admission)?.semantic_signals)?.material_parameters_awaiting_user_node_ids;
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string' || id.trim() === '')) return UNAVAILABLE;
  if (raw.length === 0) return null;
  const rawNodes = rec(input.graph)?.nodes;
  if (!Array.isArray(rawNodes)) return UNAVAILABLE;
  const nodes = rawNodes.map(rec).filter((n): n is Rec => n !== undefined);
  const options = input.analysedOptionIds.map((id) => nodes.find((n) => n.kind === 'option' && n.id === id));
  if (options.length === 0 || options.some((n) => n === undefined)) return UNAVAILABLE;
  const estimates: string[] = []; const unrecorded: string[] = [];
  for (const id of new Set(raw as string[])) {
    const node = nodes.find((n) => n.id === id);
    if (node?.kind !== 'factor' || typeof node.label !== 'string' || node.label.trim() === '') return UNAVAILABLE;
    // Only a submitted absolute value replaces this baseline. No inference from labels or excluded options.
    if (options.every((o) => {
      const entry = (rec(o?.interventions) ?? rec(rec(o?.data)?.interventions))?.[id];
      return finite(entry) || finite(rec(entry)?.value);
    })) continue;
    const state = rec(node.observed_state) ?? rec(rec(node.data)?.observed_state);
    if (state === undefined || (!finite(state.raw_value) && !finite(state.value))) return UNAVAILABLE;
    const origin = structureProvenance(node);
    const name = `"${node.label.trim()}"`;
    if (state.source === 'user_confirmed' || isAcceptedOlumiEstimate(state) || origin === 'ai_drafted' || origin === 'system_repaired') estimates.push(name);
    else if (origin === 'unattributed') unrecorded.push(name);
  }
  const lines = [
    ...(estimates.length > 0 ? [`This comparison uses Olumi’s estimates for ${estimates.join(', ')}.`] : []),
    ...unrecorded.map((name) => `${name}: source unrecorded.`),
  ];
  return lines.length === 0 ? null : `${lines.join(' ')} ${COVERAGE}`;
}
