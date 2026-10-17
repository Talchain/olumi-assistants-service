/** Disclosure only. The caller owns current-run binding and leader permission. */
import { isExampleFigureLink, valueProvenanceOf, type Provenance } from '../../cee/provenance/provenance-of.js';
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

/** Source facts for the current comparison, not evidence of a historical Run's inputs or a statement's approval. */
export interface ConditionalInputFacts {
  readonly analysed_option_ids: readonly string[];
  readonly factor_starting_values: {
    readonly coverage: 'material_factor_starting_values_only';
  } & ({ readonly status: 'unavailable' } | { readonly status: 'available'; readonly inputs: readonly {
    readonly node_id: string; readonly label: string; readonly provenance: Provenance;
    /** The provenance owner's positive adoption marker concerns this value, never the quoted statement's reading. */
    readonly adoption: 'accepted_olumi_value' | 'unknown';
  }[] });
  readonly example_links: { readonly status: 'unavailable' }
    | { readonly status: 'available'; readonly links: readonly { readonly from_id: string; readonly to_id: string }[] };
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

export function conditionalInputFactsOf(input: ConditionalInputBasis): ConditionalInputFacts {
  const basis = factorStartingValueFacts(input);
  const graph = rec(input.graph);
  if (!Array.isArray(graph?.nodes)) return { analysed_option_ids: [...input.analysedOptionIds], factor_starting_values: basis,
    example_links: { status: 'unavailable' } };
  // The graph the Run computes on (`asAnalysed`): a node kept out of the calculation, and its links, are not "used"
  // (Codex #2591 r1 P2). Causal links only (non-option, non-decision ends), each relationship once however many
  // stored copies it has (r1 P2: duplicates).
  const analysed = asAnalysed({ nodes: Array.isArray(graph?.nodes) ? graph.nodes : [], edges: graph?.edges });
  // `asAnalysed` never drops a goal-kind node; the Run protects only the SELECTED goal (Codex #2591 r2 P2), so another
  // goal the user kept out of the calculation, and its links, are not "used" either.
  const selectedGoal = typeof graph?.goal_node_id === 'string' ? graph.goal_node_id : undefined;
  const causalNodeIds = new Set(analysed.nodes.map(rec)
    .filter((n): n is Rec => n !== undefined && typeof n.id === 'string' && n.kind !== 'option' && n.kind !== 'decision')
    .filter((n) => !(n.kind === 'goal' && n.analysis_participation === 'retained_excluded' && n.id !== selectedGoal))
    .map((n) => n.id));
  const examples = (Array.isArray(analysed.edges) ? analysed.edges : []).map(rec)
    .filter((e): e is Rec => e !== undefined && causalNodeIds.has(e.from) && causalNodeIds.has(e.to)
      && isExampleFigureLink(e));
  const links = [...new Map(examples.map(e => [JSON.stringify([e.from, e.to]),
    { from_id: String(e.from), to_id: String(e.to) }])).values()];
  return { analysed_option_ids: [...input.analysedOptionIds], factor_starting_values: basis,
    example_links: { status: 'available', links } };
}

function factorStartingValueFacts(input: ConditionalInputBasis): ConditionalInputFacts['factor_starting_values'] {
  const unavailable = { status: 'unavailable', coverage: 'material_factor_starting_values_only' } as const;
  const inputs: Extract<ConditionalInputFacts['factor_starting_values'], { status: 'available' }>['inputs'][number][] = [];
  const raw = rec(rec(input.admission)?.semantic_signals)?.material_parameters_awaiting_user_node_ids;
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string' || id.trim() === '')) return unavailable;
  if (raw.length === 0) return { status: 'available', coverage: unavailable.coverage, inputs };
  const rawNodes = rec(input.graph)?.nodes;
  if (!Array.isArray(rawNodes)) return unavailable;
  const nodes = rawNodes.map(rec).filter((n): n is Rec => n !== undefined);
  const options = input.analysedOptionIds.map((id) => nodes.find((n) => n.kind === 'option' && n.id === id));
  if (options.length === 0 || options.some((n) => n === undefined)) return unavailable;
  for (const id of new Set(raw as string[])) {
    const node = nodes.find((n) => n.id === id);
    if (node?.kind !== 'factor' || typeof node.label !== 'string' || node.label.trim() === '') return unavailable;
    // Only a submitted absolute value replaces this baseline. No inference from labels or excluded options.
    if (options.every((o) => {
      const entry = (rec(o?.interventions) ?? rec(rec(o?.data)?.interventions))?.[id];
      return finite(entry) || finite(rec(entry)?.value);
    })) continue;
    const state = rec(node.observed_state) ?? rec(rec(node.data)?.observed_state);
    if (state === undefined || (!finite(state.raw_value) && !finite(state.value))) return unavailable;
    // ⭐ ONE PROVENANCE AUTHORITY: Olumi's (accepted or not, repaired included) is said as Olumi's estimate; a human
    // figure whose current-level role is unverified is scoped to that starting value; an unestablished origin "source unrecorded"; the
    // person's verified figure and a structural definition need no estimate warning. An accepted Olumi value is still
    // Olumi's, and absence of a positive adoption marker is unknown adoption, never a different origin.
    const p = valueProvenanceOf(state);
    inputs.push({ node_id: id, label: node.label.trim(), provenance: p,
      adoption: p.origin === 'ai' && p.accepted ? 'accepted_olumi_value' : 'unknown' });
  }
  return { status: 'available', coverage: unavailable.coverage, inputs };
}

/** Existing factual qualifications, unchanged, for the AI packet and the host fallback's remaining callers. */
export function conditionalInputDisclosuresOf(facts: ConditionalInputFacts): readonly string[] {
  const count = facts.example_links.status === 'available' ? facts.example_links.links.length : 0;
  const example = count === 0 ? [] : [`This comparison uses the example's figures for ${count} ${count === 1 ? 'link' : 'links'}.`];
  const basis = facts.factor_starting_values;
  if (basis.status === 'unavailable') return [...example, UNAVAILABLE];
  const names = (test: (p: Provenance) => boolean): string[] => basis.inputs.filter(i => test(i.provenance)).map(i => `"${i.label}"`);
  const estimates = names(p => p.origin === 'ai' && !p.structural);
  const unverified = names(p => p.origin === 'human' && p.role === 'unverified');
  const unrecorded = names(p => p.origin === 'unknown');
  const lines = [
    ...(estimates.length > 0 ? [`This comparison uses Olumi’s estimates for ${estimates.join(', ')}.`] : []),
    ...(unverified.length > 0 ? [`The starting ${unverified.length === 1 ? 'value for' : 'values for'} ${unverified.join(', ')} ${unverified.length === 1 ? 'has' : 'have'} not been verified as today's ${unverified.length === 1 ? 'level' : 'levels'}.`] : []),
    ...unrecorded.map((name) => `${name}: source unrecorded.`),
  ];
  return [...example, ...(lines.length === 0 ? [] : [`${lines.join(' ')} ${COVERAGE}`])];
}

/** Legacy fallback only; the AI reads conditionalInputFactsOf with these same scoped disclosures. */
export function conditionalInputBasis(input: ConditionalInputBasis): string | null {
  return conditionalInputDisclosuresOf(conditionalInputFactsOf(input)).join(' ') || null;
}
