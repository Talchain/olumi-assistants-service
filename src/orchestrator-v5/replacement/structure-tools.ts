/**
 * Replacement conversation layer — the STRUCTURE tools.
 *
 * `add_factor`, `add_option`, `add_link`. All three are `kind: 'propose'`:
 * they RETURN operations and never write. The write happens only through
 * `accept_proposal`, against a proposal the user has already seen.
 *
 * WHAT THE DESCRIPTIONS ARE FOR
 * ------------------------------
 * A tool description is a prompt, and every refusal here names a next move —
 * the same contract `propose-tools.ts` states. The measured failure was never
 * a model that could not call a tool; it was a model reaching for a mutation
 * it could not complete, and a product that answered with a dead end.
 *
 * WHY THESE RULES LIVE IN THE TOOL AND NOT IN THE PROMPT
 * ------------------------------------------------------
 * `set-option-effect.ts` records the reason in a measurement: two identical
 * four-turn conversations at temperature 0 diverged on one rule the prompt
 * stated plainly — one run asked the user for the missing range, the other
 * invented a normalised value and offered it as the user's own. The prompt was
 * followed once out of twice. A rule that must hold EVERY time belongs in a
 * tool, where it is structural. Everything below that refuses, refuses for
 * that reason.
 *
 * THE OPERATION SHAPE IS DERIVED, NOT INVENTED
 * ---------------------------------------------
 * Every operation this module emits is the shape the apply contract already
 * requires, read at three places that must agree:
 *
 *   · `src/orchestrator/patch-validation.ts:46-50, 91-96`   — `AddNodeValue`
 *     requires `{id, kind, label}` (passthrough); `AddNodeOp` requires `path`.
 *   · `src/orchestrator/patch-validation.ts:62-71, 110-115` — `AddEdgeValue`
 *     requires `{from, to, strength:{mean,std}, exists_probability,
 *     effect_direction}` (passthrough); `AddEdgeOp` requires `path`.
 *   · `src/orchestrator/patch-applier.ts:99-112`            — `applyAddNode`
 *     treats `op.path` as the authoritative id and OVERRIDES any id in value.
 *   · `src/orchestrator/patch-applier.ts:169-187`           — `applyAddEdge`
 *     reads `value.from`/`value.to`, not the path.
 *
 * ⚠ THE IDENTITY IS WRITTEN TWICE ON PURPOSE, AND THAT IS NOT A DUPLICATE.
 * The applier reads a node's id from `op.path`
 * (`patch-applier.ts:100`), while the referential-integrity check reads it
 * from `op.value.id` (`patch-validation.ts:191-192, 204-205`). An operation
 * carrying only one of them passes one check and fails the other — which is
 * exactly how every composed `add_node` from `propose-structural-edit`
 * failed apply with `zod:invalid_type` at `value.id`, deterministically, 100%
 * of the time, witnessed live (`propose-structural-edit.ts:366-386`). The two
 * are written from ONE variable here, so they cannot disagree.
 *
 * Producer precedents matched exactly:
 *   · `add-option-transaction.ts:299-317`  — `add_node`(option) + structural
 *     edges, and the op ORDER rule: the node MUST precede its edges so the
 *     referee's intra-batch sequencing sees it (`:227-229`).
 *   · `structural-add.ts:494`              — `{op:'add_node', path: id, value}`.
 *   · `add-option-transaction.ts:213-221`  — the structural edge value.
 *
 * WHAT IS IMPORTED RATHER THAN RESTATED (trap 12 — derive, never mirror)
 * ----------------------------------------------------------------------
 * `ALLOWED_EDGES`, `STRUCTURAL_EDGE_DEFAULTS`, `isLegalStructuralEdge`,
 * `buildAddedNode` and `normaliseIdBase` are all IMPORTED. A hand-copied
 * adjacency matrix in this file would be a fifth copy of a rule that has
 * already drifted across four (see the report), and nothing would go red when
 * it diverged.
 *
 * TESTABILITY
 * -----------
 * `getGraph` is injected. Every behaviour below runs offline against a plain
 * object — no network, no provider credentials, no spend.
 */

import { ALLOWED_EDGES, type AllowedEdgeRule } from '../../validators/graph-validator.types.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../orchestrator/context/constants.js';
import { isLegalStructuralEdge } from '../../cee/utils/structural-edge-classifier.js';
import { buildAddedNode } from '../system-events/structural-add.js';
import { normaliseIdBase } from '../../cee/utils/id-normalizer.js';
import type { AgentTool, AgentToolOutcome } from './agent-loop.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

/** The minimum graph shape these tools read. Deliberately narrow, and the
 *  same `Pick` `set-option-effect.ts` takes. */
export type StructureGraph = Pick<GraphStateIngress, 'nodes' | 'edges'>;

export interface StructureToolDeps {
  /** The graph as it stands. `null` when there is none — every tool then
   *  refuses with that as the reason rather than throwing. */
  readonly getGraph: () => StructureGraph | null | undefined;
}

const NO_GRAPH =
  'There is no model on screen yet, so there is nothing to add to. Talk the decision through first.';

// ---------------------------------------------------------------------------
// Reading the graph without casting
// ---------------------------------------------------------------------------

interface NodeView {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

/** Nodes, narrowed to the three fields every consumer here needs. Anything
 *  malformed is skipped rather than throwing: a hostile or half-written graph
 *  must not break a turn. */
function nodesOf(graph: StructureGraph): readonly NodeView[] {
  const out: NodeView[] = [];
  for (const n of graph.nodes) {
    if (typeof n.id !== 'string' || typeof n.kind !== 'string') continue;
    out.push({ id: n.id, kind: n.kind, label: typeof n.label === 'string' ? n.label : n.id });
  }
  return out;
}

function edgesOf(graph: StructureGraph): readonly { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const e of graph.edges) {
    if (typeof e.from !== 'string' || typeof e.to !== 'string') continue;
    out.push({ from: e.from, to: e.to });
  }
  return out;
}

function readString(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  return typeof v === 'string' ? v.trim() : '';
}

function readNumber(raw: Record<string, unknown>, key: string): number | undefined {
  const v = raw[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// ---------------------------------------------------------------------------
// REQUIREMENT 1 — the duplicate refusal
// ---------------------------------------------------------------------------

/**
 * Compare labels case-insensitively and whitespace-normalised.
 *
 * WHY THIS EXISTS. A live product put THREE churn nodes on one graph. The
 * user never asked for three; each turn added one because nothing compared
 * the new label against what was already there. A graph with three nodes for
 * one quantity does not merely look untidy — it splits the evidence for one
 * belief across three places and every downstream comparison reads a
 * fragment.
 *
 * ⚠ WHAT THIS DELIBERATELY DOES NOT DO, AND WHY.
 * It does NOT attempt fuzzy, stemmed, synonym or semantic matching. "Monthly
 * Churn Rate" and "Customer Churn %" are NOT caught. That is a known and
 * accepted gap, chosen rather than overlooked.
 *
 * The reason is a measured one, and it is not squeamishness about hard
 * problems. A near-duplicate predicate is a predicate over natural language,
 * and this estate has already spent four consecutive rounds oscillating on
 * one: each round fixed one direction and reopened the other, every round
 * passed a fully green suite, and a reviewer eventually proved the NEXT round
 * would oscillate too. The settled ruling from that episode is that where a
 * natural-language boundary cannot be determined, the product must ASK rather
 * than guess — so the exit here is the same. A too-eager matcher REFUSES A
 * NODE THE USER GENUINELY WANTED and tells them it already exists, which is a
 * lie about their own model and strictly worse than the duplicate it prevents.
 * A too-shy matcher lets a near-duplicate through, which is visible on the
 * canvas and reversible.
 *
 * Exact-after-normalisation is the part that is decidable, so it is the part
 * that is enforced. The rest is the model's job in conversation, and the tool
 * description says so.
 */
export function normaliseLabelForComparison(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The first node whose label matches after normalisation, or undefined. */
function findLabelClash(nodes: readonly NodeView[], label: string): NodeView | undefined {
  const target = normaliseLabelForComparison(label);
  return nodes.find((n) => normaliseLabelForComparison(n.label) === target);
}

/**
 * The duplicate refusal, shared by both node tools.
 *
 * Names the existing node — its label, its kind and its id — so the model's
 * next move is to USE it, not to try again with a different spelling. Naming
 * only "a node already exists" would send the model straight back to invent a
 * variant, which is how the third churn node arrived.
 */
function duplicateRefusal(existing: NodeView, wanted: string): AgentToolOutcome {
  return {
    type: 'refused',
    content:
      `There is already a ${existing.kind} called "${existing.label}" (id ${existing.id}) on this ` +
      `model, and "${wanted}" is the same name. Adding it again would split one quantity across ` +
      `two nodes. Use ${existing.id} for whatever you were about to do. If the user really means a ` +
      `DIFFERENT thing, ask them what distinguishes it and add it under that name.`,
  };
}

// ---------------------------------------------------------------------------
// Minting an id
// ---------------------------------------------------------------------------

/**
 * A collision-free canonical id, derived from the label.
 *
 * Mirrors `deriveOptionId` (`add-option-transaction.ts:198-206`) and uses the
 * SAME imported `normaliseIdBase`, so an id minted here is indistinguishable
 * from one minted by the live add-option path. `fac_` is the dominant factor
 * prefix in this codebase (1,684 occurrences against 80 for `factor_`).
 */
function deriveId(prefix: string, label: string, taken: ReadonlySet<string>): string {
  const base = `${prefix}${normaliseIdBase(label)}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ---------------------------------------------------------------------------
// REQUIREMENT 3 — a new factor's range
// ---------------------------------------------------------------------------

/**
 * ⭐ THE DECISION, AND WHY IT IS NEITHER OF THE TWO OBVIOUS ANSWERS.
 *
 * The question: a new factor needs a range, or it cannot later take an option
 * effect. Require the range in the tool input, or refuse and say one is
 * needed?
 *
 * WHAT `setOptionEffect` DOES TODAY (`set-option-effect.ts:169-187`). It
 * refuses with `factor_has_no_range` when the factor carries no numeric
 * bounds, and its refusal tells the caller to ASK the user for the lowest and
 * highest values — explicitly, "Do not convert figures into a share
 * yourself." That refusal exists because a live run measured the model
 * silently translating "churn went from 3% to 4.4%" into 0.47 and offering it
 * as the user's own number. So a factor created with no range does, really,
 * dead-end the very next operation.
 *
 * That argues for requiring the range. It is the wrong answer, and the code
 * says why.
 *
 * ⚠ REQUIRING A RANGE FORCES THE FABRICATION ONE STEP EARLIER. The live path
 * that adds a factor today is `structural-add.ts`, and it stamps
 * `prior: uniform(0,1)` marked `prior_is_unquantified` (`:273-275`). Its
 * header names "guessing a range" among the defects it exists to prevent
 * (`:106`), and `unquantified-factor.ts:38-44` states the rule this module
 * obeys: MARK, NEVER SUPPRESS — "A NARROWED range would be an information
 * claim, and there is no" basis for one. If this tool made `range_min` and
 * `range_max` mandatory, a model that does not know them would supply
 * plausible numbers, because that is the only way to complete the call. The
 * fabrication `set_option_effect` refuses would simply move upstream, where
 * it is HARDER to see: an invented effect value is visible against a factor's
 * stated range, whereas an invented range is just two more numbers on a new
 * node.
 *
 * SO: the range is OPTIONAL, and its absence is DISCLOSED rather than
 * guessed. When the user has given bounds they are written as a real uniform
 * prior. When they have not, `buildAddedNode` stamps the ignorance prior and
 * the tool result tells the model, in terms, that this factor cannot yet take
 * an option effect and that the bounds must be ASKED for. The dead end
 * requirement 3 is about is therefore named at the moment the factor is
 * created, one turn before the user would otherwise hit it — which is the
 * outcome requiring the range was reaching for, without the fabrication.
 *
 * This is a deviation from the two options the brief listed, taken on the
 * evidence above and reported rather than made silently.
 *
 * ⚠⚠ AND A SEPARATE, MEASURED DEFECT THIS CANNOT FIX FROM HERE. Whichever
 * spelling is written, `setOptionEffect` will refuse the factor today: it
 * reads `factor.range.{range_min, range_max}` (`set-option-effect.ts:172-174`),
 * a combination declared in NO schema in this repo. The schemas declare
 * `prior.{range_min, range_max}` (`cee-v3.ts:340`) and a separate
 * `range.{min, max}` (`graph.ts:167`). Measured by execution, all three cases
 * discriminating: the spelling it accepts is the one no schema declares, and
 * both declared spellings are refused. This module writes the CANONICAL
 * spelling — the one the live add path, the readiness reader and the analysis
 * consume — and does not add a second copy under the reader's private
 * spelling, because two fields holding one fact is how this estate builds its
 * next disagreement. The repair belongs in `set-option-effect.ts`, which this
 * lane may not modify; it is reported.
 */
interface FactorPriorResult {
  readonly ok: true;
  /** `undefined` means "let `buildAddedNode` stamp the ignorance prior". */
  readonly prior: Record<string, unknown> | undefined;
  readonly quantified: boolean;
}

function resolveFactorPrior(
  raw: Record<string, unknown>,
): FactorPriorResult | { readonly ok: false; readonly content: string } {
  const min = readNumber(raw, 'range_min');
  const max = readNumber(raw, 'range_max');

  if (min === undefined && max === undefined) {
    return { ok: true, prior: undefined, quantified: false };
  }

  // Exactly one bound is not a range, and the missing half cannot be inferred.
  // Refusing here rather than defaulting the other end is the same rule as
  // above: half a range plus a guess is a whole fabrication.
  if (min === undefined || max === undefined) {
    const given = min === undefined ? 'range_max' : 'range_min';
    const missing = min === undefined ? 'range_min' : 'range_max';
    return {
      ok: false,
      content:
        `Only ${given} was given, so there is no range — a range needs both ends. Ask the user for ` +
        `${missing} as well, or leave both out and add the factor without a range for now. Do not ` +
        `pick the other end yourself.`,
    };
  }

  if (min >= max) {
    return {
      ok: false,
      content:
        `range_min (${String(min)}) must be below range_max (${String(max)}). Check which way round ` +
        `the user meant them and ask if it is not clear.`,
    };
  }

  return {
    ok: true,
    prior: { distribution: 'uniform', range_min: min, range_max: max },
    quantified: true,
  };
}

// ---------------------------------------------------------------------------
// Building the operations
// ---------------------------------------------------------------------------

/**
 * One `add_node` operation.
 *
 * The node body comes from the LIVE builder `buildAddedNode`
 * (`structural-add.ts:262-277`) rather than an object literal here, so a
 * factor's ignorance prior and the `provenance: 'user_set'` stamp cannot
 * drift from what the system-event path writes. `path` and `value.id` are
 * both the same `id` variable — see the header on why both are required.
 */
function addNodeOperation(
  id: string,
  kind: string,
  label: string,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const value = buildAddedNode(id, kind, label);
  if (extra !== undefined) Object.assign(value, extra);
  return { op: 'add_node', path: id, value };
}

/**
 * One `add_edge` operation, with the canonical structural payload.
 *
 * `STRUCTURAL_EDGE_DEFAULTS` is the SAME imported constant the apply path
 * stamps (`add-option-transaction.ts:213-221`), so what the user is shown is
 * what lands — composed output is a fixed point of the apply-side enforcer.
 */
function structuralEdgeOperation(from: string, to: string): Record<string, unknown> {
  return {
    op: 'add_edge',
    path: `${from}::${to}`,
    value: { from, to, ...STRUCTURAL_EDGE_DEFAULTS, provenance: { source: 'user_specified' } },
  };
}

// ---------------------------------------------------------------------------
// add_factor
// ---------------------------------------------------------------------------

/**
 * Propose a new factor node.
 *
 * A factor is a quantity the decision turns on. It is added UNLINKED: the
 * link to whatever it affects is a separate claim about the world, and
 * `add_link` is where that claim is made and checked.
 */
export function createAddFactorTool(deps: StructureToolDeps): AgentTool {
  return {
    kind: 'propose',
    definition: {
      name: 'add_factor',
      description:
        'Propose a new factor — a quantity the decision turns on, like a cost, a rate or a volume. ' +
        'Use this when the user has named something the model is missing. Check first whether it is ' +
        'already there under another name: this tool only catches an EXACT repeat of a label, so a ' +
        'near-duplicate is yours to notice. Give range_min and range_max only if the user has told ' +
        'you the lowest and highest the quantity can be — leave them out otherwise, and never ' +
        'estimate them. This proposes only: nothing is saved until they agree.',
      input_schema: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'What the user calls this quantity.' },
          range_min: {
            type: 'number',
            description: 'The lowest value, ONLY if the user gave it. Never estimate it.',
          },
          range_max: {
            type: 'number',
            description: 'The highest value, ONLY if the user gave it. Never estimate it.',
          },
        },
        required: ['label'],
      },
    },
    execute: (raw): AgentToolOutcome => {
      const graph = deps.getGraph();
      if (graph == null) return { type: 'refused', content: NO_GRAPH };

      const label = readString(raw, 'label');
      if (label.length === 0) {
        return {
          type: 'refused',
          content:
            'A factor needs a name before it can be added. Ask the user what to call this quantity.',
        };
      }

      const nodes = nodesOf(graph);
      const clash = findLabelClash(nodes, label);
      if (clash !== undefined) return duplicateRefusal(clash, label);

      const prior = resolveFactorPrior(raw);
      if (!prior.ok) return { type: 'refused', content: prior.content };

      const id = deriveId('fac_', label, new Set(nodes.map((n) => n.id)));
      const extra = prior.prior === undefined ? undefined : { prior: prior.prior };

      return {
        type: 'proposed',
        summary: `Add a factor called ${label}`,
        operations: [addNodeOperation(id, 'factor', label, extra)],
        content: prior.quantified
          ? `${label} will be added with a range of ${String(prior.prior?.range_min)} to ` +
            `${String(prior.prior?.range_max)}, and nothing links to it yet. Say what it affects ` +
            `and offer that link next.`
          : `${label} will be added with NO range — it is marked as an explicit unknown, not given ` +
            `an invented one. Until the user tells you the lowest and highest it can be, an ` +
            `option's effect on it cannot be set. Ask for those two numbers when it matters; do ` +
            `not work them out yourself. Nothing links to it yet either.`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// add_option
// ---------------------------------------------------------------------------

/**
 * Propose a new option node, hanging off its decision.
 *
 * ⚠ WHY THIS EMITS AN EDGE AS WELL AS A NODE. An option with no incoming
 * `decision → option` edge is not a valid graph: `ALLOWED_EDGES` admits that
 * pair and no other route into an option, and `graph-validator.ts:511-524`
 * separately forbids anything pointing INTO a decision, so there is exactly
 * one legal way to attach an option and it is not optional. Proposing the
 * bare node would put a change in front of the user that fails on apply —
 * advertising an action that terminates in a refusal, which is the failure
 * class this whole layer exists to end. `buildAddOptionTransaction`
 * (`add-option-transaction.ts:299-311`) is the live precedent and emits the
 * same two operations in the same order; that ORDER is load-bearing, because
 * the referee's intra-batch sequencing must see the node before it referees
 * the edge (`:227-229`).
 *
 * What it does NOT do is link the option to its factors — those carry effect
 * values, which are claims only the user can make. The result says so and
 * names `add_link` as the next move, because an option with no outbound
 * factor edge cannot be analysed (`graph-structure-validator.ts:424-440`).
 */
export function createAddOptionTool(deps: StructureToolDeps): AgentTool {
  return {
    kind: 'propose',
    definition: {
      name: 'add_option',
      description:
        'Propose a new option — a course of action the user could choose. Use this when they have ' +
        'named one the model does not have. It attaches to the decision it belongs to, which must ' +
        'already exist. This tool only catches an EXACT repeat of a label, so a near-duplicate is ' +
        'yours to notice. An option does nothing until it is linked to the factors it moves, so ' +
        'expect to follow this with add_link. This proposes only: nothing is saved until they agree.',
      input_schema: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'What the user calls this course of action.' },
          parent_decision_id: {
            type: 'string',
            description: 'The decision this option belongs to. Read it from the workspace.',
          },
        },
        required: ['label', 'parent_decision_id'],
      },
    },
    execute: (raw): AgentToolOutcome => {
      const graph = deps.getGraph();
      if (graph == null) return { type: 'refused', content: NO_GRAPH };

      const label = readString(raw, 'label');
      if (label.length === 0) {
        return {
          type: 'refused',
          content:
            'An option needs a name before it can be added. Ask the user what to call this course ' +
            'of action.',
        };
      }

      const nodes = nodesOf(graph);
      const clash = findLabelClash(nodes, label);
      if (clash !== undefined) return duplicateRefusal(clash, label);

      const parentId = readString(raw, 'parent_decision_id');
      const parent = nodes.find((n) => n.id === parentId);
      if (parent === undefined) {
        const decisions = nodes.filter((n) => n.kind === 'decision');
        return {
          type: 'refused',
          content:
            `There is no node with id ${parentId} on this model, so the option has nothing to hang ` +
            `off. ` +
            (decisions.length > 0
              ? `The decision on this model is ${decisions.map((d) => d.id).join(', ')} — use that.`
              : `This model has no decision node yet, so there is nothing an option could belong ` +
                `to. Ask the user what the decision actually is.`),
        };
      }
      if (parent.kind !== 'decision') {
        return {
          type: 'refused',
          content:
            `${parent.label} is a ${parent.kind}, and an option hangs off a DECISION, not off a ` +
            `${parent.kind}. Read the workspace for the decision's id and use that instead.`,
        };
      }

      const id = deriveId('opt_', label, new Set(nodes.map((n) => n.id)));

      return {
        type: 'proposed',
        summary: `Add an option called ${label} under ${parent.label}`,
        // Order is load-bearing — the node must precede the edge.
        operations: [
          addNodeOperation(id, 'option', label),
          structuralEdgeOperation(parent.id, id),
        ],
        content:
          `${label} will hang off ${parent.label}, but it does not yet affect anything, so it ` +
          `cannot be compared with the other options until it does. Ask the user which factors it ` +
          `moves, then use add_link for each one. Do not guess at them.`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// add_link — REQUIREMENT 2
// ---------------------------------------------------------------------------

/**
 * Is this kind pair one `ALLOWED_EDGES` admits?
 *
 * ⚠ NAMED RESIDUAL: KIND PAIR ONLY. `ALLOWED_EDGES` refines two of its rules
 * with a `toFactorCategory` constraint — `option → factor` is admitted only
 * for a CONTROLLABLE factor, and `factor → factor` only for an observable or
 * external one. Those categories are deliberately NOT read here, for the same
 * reason `engine-discarded-link-gate.ts:225-233` does not read them: a factor
 * whose category is absent or unreadable would be refused on a constraint we
 * could not actually evaluate, and refusing on an unestablished harm is worse
 * than passing it to the validator that owns the rule. The consequence is
 * stated rather than hidden: this tool admits an `option → factor` link to a
 * non-controllable factor, and the downstream validator is what rejects it.
 */
function admittedByAllowedEdges(fromKind: string, toKind: string): boolean {
  return ALLOWED_EDGES.some((r: AllowedEdgeRule) => r.fromKind === fromKind && r.toKind === toKind);
}

/**
 * Propose a new link between two nodes that already exist.
 *
 * ⭐ WHY DIRECTION IS CHECKED HERE, AND WHERE THE RULE COMES FROM.
 * `ALLOWED_EDGES` (`graph-validator.types.ts:303-313`) is a CLOSED-WORLD
 * allowlist of eight ordered kind pairs, enforced at
 * `graph-validator.ts:546-575` as `INVALID_EDGE_TYPE` at severity `error`.
 * Because it is an allowlist of ORDERED pairs, every pair it does not list —
 * including every reversal of a pair it does list — is already illegal in
 * this product. The rule is IMPORTED, never restated: four hand-maintained
 * copies of it exist in this repo and they have measurably drifted, and a
 * fifth copy here would be one more thing with nothing to go red on it.
 *
 * The refusal is the interesting part. When the pair is inadmissible but the
 * REVERSE pair is admitted, the user has almost always said a true thing
 * backwards, so the refusal names the direction that works instead of
 * reporting a violation. That is the difference between a dead end and a
 * conversation.
 *
 * A causal link's strength, probability and sign are claims about the world
 * that only the user can make. This tool will not default them — it refuses
 * and names exactly which are missing, following
 * `propose-structural-edit.ts:423-455`, whose header records why: a
 * fabricated strength behind a confirm chip is worse than a refusal, because
 * the user cannot see it. Structural links (`decision → option`,
 * `option → factor`) are topology rather than belief and take the shared
 * canonical defaults.
 */
export function createAddEdgeTool(deps: StructureToolDeps): AgentTool {
  return {
    kind: 'propose',
    definition: {
      name: 'add_link',
      description:
        'Propose a link between two nodes that already exist, saying that the first affects the ' +
        'second. Direction matters and is checked: causes point at effects. Use this when the user ' +
        'has told you one thing drives another — not to wire up a connection you think looks ' +
        'plausible. For a link between two factors, or from a factor to an outcome or a risk, you ' +
        'must also give how strong it is and which way it pushes, and those must come from the ' +
        'user; if you do not have them, ask. This proposes only: nothing is saved until they agree.',
      input_schema: {
        type: 'object',
        properties: {
          from_id: { type: 'string', description: 'The node the link starts at — the cause.' },
          to_id: { type: 'string', description: 'The node the link ends at — what is affected.' },
          strength_mean: {
            type: 'number',
            description:
              'Causal links only, between -1 and 1: how strongly the cause moves the effect. From ' +
              'the user, never estimated.',
          },
          strength_std: {
            type: 'number',
            description: 'Causal links only: how uncertain that strength is. Above 0.',
          },
          exists_probability: {
            type: 'number',
            description:
              'Causal links only, between 0 and 1: how confident the user is the link is real.',
          },
          effect_direction: {
            type: 'string',
            enum: ['positive', 'negative'],
            description:
              'Causal links only: whether more of the cause means more of the effect, or less.',
          },
        },
        required: ['from_id', 'to_id'],
      },
    },
    execute: (raw): AgentToolOutcome => {
      const graph = deps.getGraph();
      if (graph == null) return { type: 'refused', content: NO_GRAPH };

      const fromId = readString(raw, 'from_id');
      const toId = readString(raw, 'to_id');
      const nodes = nodesOf(graph);

      // Unknown endpoints. Named one at a time, because "one or both of these
      // do not exist" makes the model re-read both.
      const from = nodes.find((n) => n.id === fromId);
      const to = nodes.find((n) => n.id === toId);
      if (from === undefined || to === undefined) {
        const missing = from === undefined ? fromId : toId;
        const end = from === undefined ? 'starts at' : 'ends at';
        return {
          type: 'refused',
          content:
            `There is no node with id ${missing} on this model, so the link ${end} nothing. Read ` +
            `the workspace for the real ids. If the user means something the model does not have ` +
            `yet, add it first with add_factor or add_option.`,
        };
      }

      // A self-edge. Nothing in the apply path refuses this — `applyAddEdge`
      // checks that both endpoints exist, which a self-edge satisfies — so
      // without this check a node could be made to cause itself.
      if (fromId === toId) {
        return {
          type: 'refused',
          content:
            `${from.label} cannot affect itself. If the user means it changes over time, or that ` +
            `something else drives it, ask which node the other end should be.`,
        };
      }

      // An edge that already exists, in either direction. The forward case is
      // caught at apply (`patch-applier.ts:183`) — but only AFTER the user has
      // agreed to it, so the proposal would be offered and then fail. The
      // REVERSE case is caught nowhere, and is the one that silently builds a
      // two-way cycle out of one honest restatement.
      const edges = edgesOf(graph);
      if (edges.some((e) => e.from === fromId && e.to === toId)) {
        return {
          type: 'refused',
          content:
            `${from.label} already affects ${to.label} — that link is on the model, that way ` +
            `round. If the user is describing it differently, they may want to change its strength ` +
            `rather than add it again; ask which they mean.`,
        };
      }
      if (edges.some((e) => e.from === toId && e.to === fromId)) {
        return {
          type: 'refused',
          content:
            `There is already a link between these two, but the other way round: ${to.label} ` +
            `affects ${from.label}. Adding this one would say each causes the other. Ask the user ` +
            `which direction they mean, and change the existing link if it is the wrong way.`,
        };
      }

      // Direction by kind, against the imported allowlist.
      if (!admittedByAllowedEdges(from.kind, to.kind)) {
        if (admittedByAllowedEdges(to.kind, from.kind)) {
          return {
            type: 'refused',
            content:
              `A ${from.kind} does not affect a ${to.kind} in this model, but a ${to.kind} does ` +
              `affect a ${from.kind}. If the user means ${to.label} drives ${from.label}, propose ` +
              `it that way round. If they really mean it the way you asked, something else is ` +
              `going on — ask them to say it in their own words.`,
          };
        }
        return {
          type: 'refused',
          content:
            `A ${from.kind} cannot link to a ${to.kind} in this model, in either direction, so ` +
            `there is no version of this link that would work. What connects them is a chain: ask ` +
            `the user what sits in between ${from.label} and ${to.label}, and link through that.`,
        };
      }

      if (isLegalStructuralEdge(from.kind, to.kind)) {
        return {
          type: 'proposed',
          summary: `Link ${from.label} to ${to.label}`,
          operations: [structuralEdgeOperation(fromId, toId)],
          content:
            `This is structural wiring rather than a claim about how much one moves the other. ` +
            (from.kind === 'option' && to.kind === 'factor'
              ? `${from.label} now has somewhere to have an effect, but no effect VALUE — use ` +
                `set_option_effect once the user has told you how much it moves ${to.label}.`
              : `Say what it means for their decision, not just that you have offered it.`),
        };
      }

      // A causal link. Every field below is a claim about the world.
      const mean = readNumber(raw, 'strength_mean');
      const std = readNumber(raw, 'strength_std');
      const prob = readNumber(raw, 'exists_probability');
      const directionRaw = readString(raw, 'effect_direction');
      const direction = directionRaw === 'positive' || directionRaw === 'negative' ? directionRaw : undefined;

      const missing: string[] = [];
      if (mean === undefined) missing.push('how strong the link is (strength_mean, -1 to 1)');
      if (std === undefined) missing.push('how uncertain that is (strength_std, above 0)');
      if (prob === undefined) missing.push('how sure they are it is real (exists_probability, 0 to 1)');
      if (direction === undefined) missing.push('which way it pushes (effect_direction)');

      if (missing.length > 0) {
        return {
          type: 'refused',
          content:
            `A link from a ${from.kind} to a ${to.kind} is a claim about how the world works, so ` +
            `it needs numbers the user has given you. Still missing: ${missing.join('; ')}. Ask ` +
            `them, then propose it. Do not fill these in yourself — a strength nobody chose looks ` +
            `exactly like one they did.`,
        };
      }

      // Bounds, checked here rather than left to the apply-side Zod contract:
      // a proposal the user agrees to and which then fails validation is the
      // same dead end as a refusal, arriving one turn later.
      if (mean === undefined || std === undefined || prob === undefined || direction === undefined) {
        return { type: 'refused', content: 'The link is missing the numbers it needs.' };
      }
      if (mean < -1 || mean > 1) {
        return {
          type: 'refused',
          content:
            `A link's strength runs from -1 to 1, and I was given ${String(mean)}. Check what the ` +
            `user actually said — if they gave a percentage or an amount, that is a different ` +
            `thing from strength, and you should ask how strong they think the link is instead.`,
        };
      }
      if (std <= 0) {
        return {
          type: 'refused',
          content:
            `Uncertainty on a link's strength has to be above 0, and I was given ${String(std)}. A ` +
            `0 would say the user is perfectly certain. Ask how confident they are.`,
        };
      }
      if (prob < 0 || prob > 1) {
        return {
          type: 'refused',
          content:
            `How likely the link is to be real runs from 0 to 1, and I was given ${String(prob)}. ` +
            `If the user gave a percentage, divide it by 100 — but only if that is plainly what ` +
            `they meant.`,
        };
      }

      return {
        type: 'proposed',
        summary: `Link ${from.label} to ${to.label}`,
        operations: [
          {
            op: 'add_edge',
            path: `${fromId}::${toId}`,
            value: {
              from: fromId,
              to: toId,
              strength: { mean, std },
              exists_probability: prob,
              effect_direction: direction,
              provenance: { source: 'user_specified' },
            },
          },
        ],
        content:
          `This says ${from.label} moves ${to.label}, ${direction === 'positive' ? 'in the same' : 'in the opposite'} ` +
          `direction, at a strength of ${String(mean)}. Those are the user's numbers, not yours — ` +
          `say what the link means for their decision, not just that you have offered it.`,
      };
    },
  };
}
