/**
 * Replacement conversation layer — the two READ tools.
 *
 * THE MEASURED FAILURE THESE ADDRESS
 * ----------------------------------
 * On two live sessions the product computed, for the user's own model, a full
 * outcome distribution per option, a downside block, a separation verdict
 * against an explicit tie threshold, a whole-decision information value, and a
 * ranked list of causal links each carrying "if this link is wrong, a
 * different option wins, and here is how often". The user was shown none of
 * it. The numbers were computed, transported, parsed, persisted — and then
 * dropped one hop short of the conversation.
 *
 * They were dropped because the only projection pointed at the coach
 * (`format/format-analysis-for-context.ts`) is a DISPLAY-SAFE BANDER: by
 * design every numeric becomes prose, and the fields below never enter its
 * input type at all (`ContextPackAnalysis` carries `outcome_mean` and nothing
 * else of the distribution; its fragile edge is `{from_label, to_label}`).
 * That band is correct for the surface it serves. It is the wrong instrument
 * for a model that has to REASON, so this module reads the raw enrichment
 * instead, and says so where the raw shape is not contract-typed.
 *
 * WHAT A READ TOOL MAY AND MAY NOT DO
 * -----------------------------------
 * Both are {@link AgentTool} `kind: 'read'`. A read returns information or a
 * refusal and NEVER stages operations — the loop throws on a read that
 * returns a proposal, so the property is structural. Neither tool touches the
 * graph, the session store, the clock, or the network: everything arrives
 * through `deps`, which is what makes them replayable against fixtures.
 *
 * ABSENCE IS NEVER ZERO. THIS IS THE CONTRACT, NOT A PREFERENCE.
 * -------------------------------------------------------------
 * The shared schema states the rule on the fields themselves, and both cases
 * are reachable here:
 *
 *   · `switch_probability` — "Absence means NOT COMPUTED, never 0 and never 1.
 *     A measured 0 is a real measurement and must be preserved. Higher means
 *     MORE fragile, so reading absence as 1 fabricates the maximum of the
 *     scale. Consumers MUST branch on presence, never coalesce, and MUST omit
 *     anything derived from it."
 *   · `decision_evpi` — "Absence means NOT COMPUTED, never 0. A measured 0 is
 *     a real result (nothing about this decision is worth learning)."
 *   · `percentiles_source` — "Absence means the producer did not state
 *     provenance — consumers MUST NOT assume 'samples'."
 *
 * So every number below is printed only when the producer sent it, and every
 * gap is named as a gap. There is no `?? 0` in this file, deliberately.
 *
 * STALENESS IS INFORMATION, NOT A REASON TO WITHHOLD
 * --------------------------------------------------
 * A stale analysis still describes a model the user worked on, and the thing
 * they need to know is BOTH the numbers AND that the numbers pre-date their
 * latest edit. Hiding the figures on a stale turn produces the silence this
 * layer exists to end; printing them without the warning produces the
 * confident wrongness it exists to prevent. {@link createReadResultsTool}
 * leads with the currency verdict and then reports everything.
 */

import type { AnalysisEnrichment } from '@talchain/schemas/boundary';

import {
  compactGraphForContextPack,
  type CompactGraphOutcome,
} from '../context/compact-graph-for-contextpack.js';
// The producer's own fragility-priority authority: finite `switch_probability`
// descending, producer order preserved on ties and for rows with no finite
// value. Pure, zero imports. Re-deriving a ranking here would be a second
// opinion about the producer's metric, which is how two orderings drift apart.
import { orderFragilityPriorityRows } from '../../orchestrator/shared/fragile-edge-authority.js';

import type { GraphStateIngress } from '../boundary/request-extensions.js';
import type { AnalysisFreshness } from '../context/freshness.js';
import type { GoalConstraintT } from '../../schemas/assist.js';
import type { AgentTool, AgentToolOutcome } from './agent-loop.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared shape-defensive readers
//
// The enrichment envelope is `z.record(z.unknown())` on the wire and every
// enrichment object is `.passthrough()`, so a field being declared in the
// contract does not mean it arrived. These read without coercing.
// ─────────────────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** A number only when the producer sent a finite one. Never a default. */
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Round for reading, not for truth.
 *
 * A model reasons no better from 0.31651156735119257 than from 0.3165, and the
 * long tail costs context. Six significant figures is far beyond any decision
 * this layer supports while still preserving order between near-tied options —
 * which is the one thing a rounding step here could destroy.
 */
function num(value: number): string {
  return String(Number(value.toPrecision(6)));
}

// ─────────────────────────────────────────────────────────────────────────────
// read_workspace
// ─────────────────────────────────────────────────────────────────────────────

export interface ReadWorkspaceDeps {
  /** The graph as it stands now. `null` when the session has none yet. */
  readonly getGraph: () => GraphStateIngress | null | undefined;
  /** Correlation id for the compactor's own diagnostics. Injected so this
   *  module reads no ambient state. */
  readonly requestId?: string;
}

/**
 * What the compactor supplies and what it does NOT.
 *
 * `compactGraphForContextPack` gives us id / kind / label / value / unit /
 * baseline identity / a human-readable intervention summary per node, already
 * deterministic and already bounded — reusing it means this tool and the
 * ContextPack cannot describe the same node differently.
 *
 * ⚠ IT DROPS THE GOAL TARGET. `compactGraph` discards `goal_threshold` per
 * node and `GraphV3Compact` is `{nodes, edges, _node_count, _edge_count}`, so
 * the top-level `goal_node_id` and `goal_constraints` never survive it. That
 * is the same loss `coaching/decision-review-graph-projection.ts` had to
 * repair after a live session where a spend limit WAS the question and the
 * reviewing model was handed a graph with the limit deleted. So the target is
 * read from the ingress graph directly, beside the compaction rather than
 * through it.
 */
interface CompactNodeView {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly label?: unknown;
  readonly value?: unknown;
  readonly unit?: unknown;
  readonly is_baseline?: unknown;
  readonly description?: unknown;
  readonly intervention_summary?: unknown;
}

function compactNodes(outcome: CompactGraphOutcome): readonly CompactNodeView[] {
  return outcome.kind === 'compacted' ? outcome.compact.nodes : [];
}

/**
 * Kinds that carry a quantity of their own.
 *
 * A decision and an option do NOT: an option's quantity is what it SETS, and
 * `compactGraph` gives that as `intervention_summary`. Printing "no value set"
 * against every option would report an absence that is not a gap, and the
 * whole value of this tool is that the gaps it names are real ones.
 *
 * Risks and outcomes DO carry one and frequently have none set — measured on
 * a starter board: risks 0 of 14, outcomes 0 of 10. That silence is a genuine
 * finding about the model and is reported.
 */
const KINDS_WITH_OWN_VALUE = new Set(['factor', 'risk', 'outcome', 'goal']);

/** One node line: what it is, what it is worth, and what it sets. */
function describeNode(node: CompactNodeView): string {
  const id = text(node.id);
  const label = text(node.label);
  const head = `${label === null ? '(unlabelled)' : label}${id === null ? '' : ` [${id}]`}`;

  const parts: string[] = [];

  const kind = text(node.kind);
  if (kind !== null && KINDS_WITH_OWN_VALUE.has(kind)) {
    const value = finite(node.value);
    if (value === null) {
      parts.push('no value set');
    } else {
      const unit = text(node.unit);
      parts.push(`value ${num(value)}${unit === null ? '' : ` ${unit}`}`);
    }
  }

  // ⚠ `is_baseline` is licensed ONLY by the strict-GraphV3 arm of the
  // compactor: `withoutBaselineIdentity` strips it from every structural
  // fallback, on the rule that a degraded parse does not get to attest
  // status-quo identity. So absence here is NOT "this is not the baseline" —
  // it is "nothing attested it", and the line says nothing rather than
  // claiming either way.
  if (node.is_baseline === true) parts.push('this is the status-quo option');

  // `intervention_summary` is already a sentence of the form "sets X=…".
  const sets = text(node.intervention_summary);
  if (sets !== null) parts.push(sets);

  const description = text(node.description);
  if (description !== null) parts.push(description);

  return parts.length === 0 ? `  - ${head}` : `  - ${head} — ${parts.join('; ')}`;
}

function section(title: string, nodes: readonly CompactNodeView[]): string[] {
  if (nodes.length === 0) return [];
  return [`${title} (${nodes.length}):`, ...nodes.map(describeNode)];
}

function ofKind(nodes: readonly CompactNodeView[], kind: string): readonly CompactNodeView[] {
  return nodes.filter((n) => text(n.kind) === kind);
}

function goalConstraintsOf(graph: GraphStateIngress): readonly unknown[] {
  const raw = graph.goal_constraints;
  return Array.isArray(raw) ? raw : [];
}

/**
 * Render one target the way a person stated it, or say plainly that we cannot
 * read it. `GoalConstraintT` requires `operator` and `value`; anything that
 * does not carry them arrived through the passthrough and is reported as
 * present-but-unreadable rather than silently skipped.
 */
function describeConstraint(constraint: unknown): string {
  const record = asRecord(constraint);
  if (record === null) return '  - a target is recorded but its shape could not be read';

  const partial = record as Partial<GoalConstraintT>;
  const operator = text(partial.operator);
  const value = finite(partial.value);
  if (operator === null || value === null) {
    const label = text(partial.label);
    return `  - ${label === null ? 'a target is recorded' : label} (no readable threshold on it)`;
  }

  const unit = text(partial.unit);
  const label = text(partial.label);
  const threshold = `${operator} ${num(value)}${unit === null ? '' : ` ${unit}`}`;
  return `  - ${label === null ? 'target' : label}: ${threshold}`;
}

function goalSection(graph: GraphStateIngress, nodes: readonly CompactNodeView[]): string[] {
  const goalId = text(graph.goal_node_id);
  const goalNodes = ofKind(nodes, 'goal');
  const named =
    goalId === null ? undefined : nodes.find((n) => text(n.id) === goalId);
  const goal = named ?? goalNodes[0];

  const constraints = goalConstraintsOf(graph);

  if (goal === undefined && constraints.length === 0) {
    return ['GOAL: none recorded on this model.'];
  }

  const lines: string[] = [];
  if (goal === undefined) {
    lines.push('GOAL: no goal node is recorded, but a target is:');
  } else {
    const label = text(goal.label);
    const id = text(goal.id);
    lines.push(`GOAL: ${label === null ? '(unlabelled)' : label}${id === null ? '' : ` [${id}]`}`);
  }

  if (constraints.length === 0) {
    // The honest phrasing matters: an absent target is a thing the user can
    // fix, and it changes what the analysis is able to say about any option.
    lines.push('  - NO TARGET SET. Nothing states what counts as success, so no');
    lines.push('    option can be scored against one.');
    return lines;
  }

  lines.push(`  target set (${constraints.length} recorded):`);
  for (const constraint of constraints) lines.push(describeConstraint(constraint));
  return lines;
}

export const READ_WORKSPACE_EMPTY =
  'There is no model yet — no decision, no options, no factors. ' +
  'Nothing has been built for this session to read.';

/**
 * A compact, model-readable description of the model as it stands.
 *
 * Every node is addressed by ID as well as label, because the operation this
 * conversation most often needs next is a write, and a write addressed by
 * label is the failure that ended a live session: an option was named back at
 * the user as "I wasn't sure what you meant by ..." and the turn died there.
 */
export function createReadWorkspaceTool(deps: ReadWorkspaceDeps): AgentTool {
  const execute = (): AgentToolOutcome => {
    const graph = deps.getGraph();
    if (graph === null || graph === undefined) {
      return { type: 'result', content: READ_WORKSPACE_EMPTY };
    }

    const outcome = compactGraphForContextPack(graph, {
      requestId: deps.requestId === undefined ? 'read_workspace' : deps.requestId,
    });
    const nodes = compactNodes(outcome);

    if (nodes.length === 0) {
      return { type: 'result', content: READ_WORKSPACE_EMPTY };
    }

    const decisions = ofKind(nodes, 'decision');
    const options = ofKind(nodes, 'option');
    const factors = ofKind(nodes, 'factor');
    const risks = ofKind(nodes, 'risk');
    const outcomes = ofKind(nodes, 'outcome');

    const known = new Set(['decision', 'option', 'factor', 'risk', 'outcome', 'goal']);
    const others = nodes.filter((n) => {
      const kind = text(n.kind);
      return kind === null || !known.has(kind);
    });

    const lines: string[] = [];

    if (decisions.length === 0) {
      lines.push('DECISION: none recorded.');
    } else {
      for (const decision of decisions) {
        const label = text(decision.label);
        const id = text(decision.id);
        lines.push(
          `DECISION: ${label === null ? '(unlabelled)' : label}${id === null ? '' : ` [${id}]`}`,
        );
      }
    }

    lines.push(...goalSection(graph, nodes));
    lines.push(...section('OPTIONS', options));
    lines.push(...section('FACTORS', factors));
    lines.push(...section('RISKS', risks));
    lines.push(...section('OUTCOMES', outcomes));
    lines.push(...section('OTHER NODES', others));

    return { type: 'result', content: lines.join('\n') };
  };

  return {
    kind: 'read',
    definition: {
      name: 'read_workspace',
      description:
        'Read the shared model as it stands right now: the decision, each option and ' +
        'what it sets, the factors with their values and units, the risks, the outcomes, ' +
        'and the goal with whether a target has been set for it. Every element is given ' +
        'with its id, which is how you address it in any later operation. Call this ' +
        'before reasoning about the model, and again after anything has changed.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    execute,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// read_results
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One analysis, plus the currency verdict that belongs with it.
 *
 * `freshness` is REQUIRED (nullable) rather than optional on purpose: a caller
 * that has not wired the verdict must say so explicitly, because the
 * alternative — a missing key defaulting to "current" — is precisely the
 * confident wrongness this layer exists to stop. Deriving freshness here is
 * not an option and should not be attempted: it is a function of the fact
 * chain and the live graph hash (`context/freshness.ts`), which are exactly
 * the I/O this module refuses to do.
 */
export interface AnalysisSnapshot {
  /**
   * The RAW `enrichment` object from the latest `analysis_result` block.
   *
   * Typed as the shared contract, and read shape-defensively anyway: the
   * transport field is `z.record(z.unknown())` by design
   * (`@talchain/schemas` `AnalysisResultBlockSchema`), so what arrives is only
   * whatever the producer sent.
   */
  readonly enrichment: AnalysisEnrichment | null;
  /** `null` means the caller could not establish currency — reported as such. */
  readonly freshness: AnalysisFreshness | null;
  /** The freshness derivation's reason code, when the caller has one. */
  readonly freshnessReason?: string | null;
  /** ISO timestamp the analysis was computed at, when known. */
  readonly computedAt?: string | null;
}

export interface ReadResultsDeps {
  /** The latest analysis, or `null` when none has ever been run. */
  readonly getAnalysis: () => AnalysisSnapshot | null | undefined;
}

export const READ_RESULTS_NO_ANALYSIS =
  'NO ANALYSIS HAS BEEN RUN on this model, so there are no results to read. ' +
  'There are no probabilities, no outcome ranges and no comparison between the ' +
  'options — not withheld, simply never computed. Say so plainly rather than ' +
  'reasoning as if figures existed.';

/**
 * The currency line, which always comes first.
 *
 * Four verdicts, and three of them are NOT 'fresh'. Each gets its own sentence
 * because they mean different things and a single "may be out of date" would
 * flatten them: `stale` is a positive finding (the model moved), `unknown` is
 * an absence of proof either way, `none` contradicts having an analysis at all
 * and is reported as the inconsistency it is.
 */
function currencyLine(snapshot: AnalysisSnapshot): string {
  const reason = text(snapshot.freshnessReason);
  const at = text(snapshot.computedAt);
  const suffix =
    `${at === null ? '' : ` Computed at ${at}.`}` +
    `${reason === null ? '' : ` (freshness reason: ${reason})`}`;

  switch (snapshot.freshness) {
    case 'fresh':
      return `ANALYSIS IS CURRENT for the model as it stands.${suffix}`;
    case 'stale':
      return (
        'ANALYSIS IS OUT OF DATE. It was computed against an earlier version of ' +
        'this model, so the figures below describe a model that has since changed. ' +
        'They are still real measurements and are reported in full — but say they ' +
        'are out of date, and offer to re-run before anything is decided on them.' +
        suffix
      );
    case 'none':
      return (
        'CURRENCY CANNOT BE VOUCHED FOR: the caller reports no analysis on record, ' +
        'yet an analysis payload is present. Treat the figures below as unverified ' +
        'and re-run before relying on them.' + suffix
      );
    case 'unknown':
    default:
      return (
        'CURRENCY COULD NOT BE ESTABLISHED. Nothing here proves these figures are ' +
        'current for the model as it stands, and nothing proves they are not. ' +
        'Report them as unverified rather than as current.' + suffix
      );
  }
}

/** `option_comparison[]`, defensively. */
function optionRows(enrichment: AnalysisEnrichment): readonly Record<string, unknown>[] {
  const raw = (enrichment as Record<string, unknown>)['option_comparison'];
  if (!Array.isArray(raw)) return [];
  return raw.map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
}

/**
 * The distribution line for one option.
 *
 * `percentiles_source` is reported, never assumed. Its own contract says
 * absence means the producer did not state provenance, and a model told
 * "p10/p50/p90" with no provenance will reason about sampling error it has no
 * basis for.
 */
function outcomeLine(row: Record<string, unknown>): string[] {
  const outcome = asRecord(row['outcome']);
  if (outcome === null) return ['      outcome: not reported for this option'];

  const pairs: string[] = [];
  for (const [key, name] of [
    ['mean', 'mean'],
    ['p10', 'p10'],
    ['p50', 'p50 (median)'],
    ['p90', 'p90'],
  ] as const) {
    const value = finite(outcome[key]);
    if (value !== null) pairs.push(`${name} ${num(value)}`);
  }
  if (pairs.length === 0) return ['      outcome: reported, but carries no usable figures'];

  const source = text(outcome['percentiles_source']);
  const provenance =
    source === 'samples'
      ? ' (percentiles computed from simulation samples)'
      : source === null
        ? ' (the producer did not state where the percentiles came from — do not assume they are sampled)'
        : ` (percentiles source: ${source})`;

  return [`      outcome: ${pairs.join(', ')}${provenance}`];
}

/**
 * The downside line for one option.
 *
 * ⚠ `downside` IS NOT IN THE TYPED CONTRACT. `p05`, `cvar_10` and
 * `expected_regret` appear in `contracts/population-registry.json` as ISL
 * metrics and in live captures, but `EnrichmentOptionComparisonEntrySchema`
 * declares none of them — they ride the `.passthrough()`. That is CLAUDE.md's
 * hazard 2 (the untyped enrichment seam), so nothing about this block may be
 * assumed: each field is read independently and each absence is silent rather
 * than filled.
 */
function downsideLine(row: Record<string, unknown>): string[] {
  const downside = asRecord(row['downside']);
  if (downside === null) return [];

  const pairs: string[] = [];
  const p05 = finite(downside['p05']);
  if (p05 !== null) pairs.push(`p05 ${num(p05)}`);
  const cvar = finite(downside['cvar_10']);
  if (cvar !== null) pairs.push(`worst-decile average (cvar_10) ${num(cvar)}`);
  const regret = finite(downside['expected_regret']);
  if (regret !== null) pairs.push(`expected regret ${num(regret)}`);

  if (pairs.length === 0) return [];
  return [`      downside: ${pairs.join(', ')}`];
}

function optionSection(enrichment: AnalysisEnrichment): string[] {
  const rows = optionRows(enrichment);
  if (rows.length === 0) {
    return ['PER-OPTION RESULTS: none reported in this analysis.'];
  }

  const lines: string[] = [`PER-OPTION RESULTS (${rows.length}):`];
  for (const row of rows) {
    const label = text(row['option_label']) ?? text(row['label']);
    const id = text(row['option_id']) ?? text(row['id']);
    lines.push(`  - ${label === null ? '(unlabelled option)' : label}${id === null ? '' : ` [${id}]`}`);

    const win = finite(row['win_probability']);
    if (win !== null) lines.push(`      wins most often in ${num(win)} of runs`);

    lines.push(...outcomeLine(row));
    lines.push(...downsideLine(row));

    const status = text(row['status']);
    if (status !== null && status !== 'computed') {
      const why = text(row['status_reason']);
      lines.push(`      status: ${status}${why === null ? '' : ` — ${why}`}`);
    }
  }
  return lines;
}

/**
 * The separation verdict.
 *
 * ⚠ WHY THIS DOES NOT USE `coaching/pick-raw-robustness.ts`. That reader is
 * the estate's shared robustness selector, and it returns `null` unless
 * `level` is a non-empty string or `near_tie.is_tie === true`. The producer
 * emits no `level`, so on a payload with a CLEANLY SEPARATED leader —
 * `near_tie: { is_tie: false, gap, threshold }` — it returns null and the gap
 * is lost. That is the measured shape in which the leader gets withheld from
 * the user. Reading `near_tie` directly loses nothing: `gap`, `is_tie` and
 * `threshold` are all REQUIRED on `EnrichmentNearTieSchema`, so when the
 * object is there the verdict is complete.
 */
function separationSection(enrichment: AnalysisEnrichment): string[] {
  const robustness = asRecord((enrichment as Record<string, unknown>)['robustness']);
  const nearTie = robustness === null ? null : asRecord(robustness['near_tie']);

  if (nearTie === null) {
    return [
      'SEPARATION: not computed. This analysis carries no tie verdict, so nothing ' +
        'here establishes whether one option is genuinely ahead. Do not infer a ' +
        'leader from the figures above.',
    ];
  }

  const gap = finite(nearTie['gap']);
  const threshold = finite(nearTie['threshold']);
  const isTie = nearTie['is_tie'] === true;

  const measured =
    gap === null
      ? 'the gap between the top two was not reported'
      : `the gap between the top two is ${num(gap)}`;
  const against =
    threshold === null
      ? ''
      : `, against a tie threshold of ${num(threshold)}`;

  const verdict = isTie
    ? 'THE OPTIONS TIE: the producer judged the top options too close to separate. ' +
      'Do not name a leader.'
    : 'THE OPTIONS DO NOT TIE: the producer judged the top option genuinely ahead ' +
      'of the next one.';

  return [`SEPARATION: ${measured}${against}. ${verdict}`];
}

/**
 * The ranked fragile edges — the eight sentences the user never saw.
 *
 * Each row answers a question a person actually asks: if this causal link is
 * wrong, does the answer change, to what, and how often? The ordering is the
 * producer's metric via the shared authority, never a local re-scoring.
 *
 * A row with no finite `switch_probability` is KEPT and marked, not dropped
 * and not defaulted. Dropping it would hide a link the producer thought worth
 * listing; defaulting it to 0 or 1 would fabricate the bottom or the top of
 * the scale, which the field's own contract forbids by name.
 */
function fragileEdgeSection(enrichment: AnalysisEnrichment): string[] {
  const robustness = asRecord((enrichment as Record<string, unknown>)['robustness']);
  const raw = robustness === null ? undefined : robustness['fragile_edges'];
  if (!Array.isArray(raw)) {
    return ['FRAGILE LINKS: not computed for this analysis.'];
  }

  const rows = raw.map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
  if (rows.length === 0) {
    return [
      'FRAGILE LINKS: none. The producer found no causal link whose being wrong ' +
        'would change which option comes out ahead.',
    ];
  }

  const ordered = orderFragilityPriorityRows(rows);
  const lines: string[] = [
    `FRAGILE LINKS (${ordered.length}, most fragile first — if one of these is wrong, the answer can change):`,
  ];

  ordered.forEach((row, index) => {
    const from = text(row['from_label']) ?? text(row['from_id']) ?? '(unnamed)';
    const to = text(row['to_label']) ?? text(row['to_id']) ?? '(unnamed)';
    const winner = text(row['alternative_winner_label']) ?? text(row['alternative_winner_id']);
    const probability = finite(row['switch_probability']);

    const consequence =
      winner === null
        ? 'the producer did not name which option would win instead'
        : `"${winner}" wins instead`;

    const likelihood =
      probability === null
        ? 'switch probability NOT COMPUTED for this link, so its position in this ' +
          'list is the producer\'s own order and nothing may be derived from it'
        : `that happens in ${num(probability)} of runs`;

    lines.push(`  ${index + 1}. ${from} -> ${to}: if this link is wrong, ${consequence}; ${likelihood}.`);

    const marginal = finite(row['marginal_switch_probability']);
    if (marginal !== null) {
      lines.push(`      attributable to this link alone: ${num(marginal)}`);
    }
  });

  return lines;
}

/**
 * Whole-decision information value.
 *
 * A measured `0` is a real and useful answer — nothing about this decision is
 * worth learning more about — and it must not read the same as "we did not
 * compute it". The wire carries no discriminator beyond key presence, which is
 * why this branches on presence instead of coalescing.
 */
function informationValueSection(enrichment: AnalysisEnrichment): string[] {
  const value = finite((enrichment as Record<string, unknown>)['decision_evpi']);
  if (value === null) {
    return ['VALUE OF PERFECT INFORMATION: not computed for this decision.'];
  }
  if (value === 0) {
    return [
      'VALUE OF PERFECT INFORMATION: 0 — measured, not missing. On this model, ' +
        'resolving every uncertainty would not change which option is chosen.',
    ];
  }
  return [
    `VALUE OF PERFECT INFORMATION: ${num(value)} — what resolving every uncertainty ` +
      'in this model would be worth, in the same units as the outcome above.',
  ];
}

/**
 * What this comparison covers — and the one thing it cannot tell you.
 *
 * FOUND BY A LIVE RUN. Shown an analysis covering two of a model's three
 * options, the assistant wrote that the third "doesn't appear in the results
 * at all, which suggests it's not been set up yet or performs so poorly it's
 * not in contention." The first half is a fact; the second is a guess, and it
 * was delivered in the same breath, in a paragraph otherwise made of measured
 * numbers. That is the most damaging shape a fabrication can take.
 *
 * The cause is a gap, not a bad model: this tool sees the ANALYSIS, never the
 * graph, so it cannot know which options exist and were left out. It can say
 * exactly that, and naming the limit is what removes the space to invent one.
 */
function coverageSection(enrichment: AnalysisEnrichment): string[] {
  const options = optionRows(enrichment);
  if (options.length === 0) return [];
  const named = options
    .map((o) => text(o['option_label']) ?? text(o['option_id']) ?? 'an unnamed option')
    .join(', ');
  return [
    `WHAT THIS COMPARISON COVERS: ${options.length} option${options.length === 1 ? '' : 's'} — ${named}.`,
    'If the model holds any option not in that list, it was not compared, and THIS TOOL ' +
      'CANNOT TELL YOU WHY. Do not offer a reason. Say it was not included and offer to find out.',
  ];
}

/**
 * The analysis a model can reason from, with its currency stated first.
 *
 * Nothing is summarised away. If the producer computed it, it is here; if the
 * producer did not, that is said in words rather than left to be inferred from
 * a missing line.
 */
export function createReadResultsTool(deps: ReadResultsDeps): AgentTool {
  const execute = (): AgentToolOutcome => {
    const snapshot = deps.getAnalysis();
    if (snapshot === null || snapshot === undefined || snapshot.enrichment === null) {
      return { type: 'result', content: READ_RESULTS_NO_ANALYSIS };
    }

    const enrichment = snapshot.enrichment;
    const lines: string[] = [currencyLine(snapshot), ''];

    const tier = text((enrichment as Record<string, unknown>)['confidence_tier']);
    if (tier !== null) lines.push(`PRODUCER'S OWN CONFIDENCE TIER: ${tier}`, '');

    lines.push(...optionSection(enrichment), '');
    lines.push(...separationSection(enrichment), '');
    lines.push(...fragileEdgeSection(enrichment), '');
    lines.push(...informationValueSection(enrichment));
    lines.push('', ...coverageSection(enrichment));

    return { type: 'result', content: lines.join('\n') };
  };

  return {
    kind: 'read',
    definition: {
      name: 'read_results',
      description:
        'Read the latest analysis of this model: for each option its outcome range ' +
        '(mean, p10, median, p90) and its downside, whether the top options are ' +
        'genuinely separated or too close to call, the causal links whose being wrong ' +
        'would change the answer (with which option would win instead and how often), ' +
        'and what resolving every uncertainty would be worth. Always states first ' +
        'whether the analysis is current for the model as it stands; if it is out of ' +
        'date the figures are still reported, and you must say they are out of date.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    execute,
  };
}
