/**
 * Model-version creation policy. This is a decision predicate, not a third
 * identity/hash authority: CAS/restore use full identity and freshness uses
 * the analysis-affecting hash.
 */
import { stableStringify } from "../../orchestrator/context/stable-stringify.js";
import type { GraphStateIngress } from "../boundary/request-extensions.js";
import {
  isIdentityEmptyGraph,
  orderGraphEntriesForComparison,
} from "../context/graph-identity.js";

export type VersionCreationDecision =
  | { readonly create: true; readonly reason: "initial" | "semantic_change" }
  | {
      readonly create: false;
      readonly reason: "no_graph" | "no_op" | "presentation_only";
    };

const PRESENTATION_KEYS = new Set([
  "position",
  "layout",
  "dimensions",
  "style",
  "viewport",
  "ui",
  "ui_state",
  "panel_state",
  "selected",
  "selection",
  "hover",
  "hovered",
  "dragging",
]);

/**
 * Remove presentation keys from ONE entry's OWN top-level keys. Values are
 * copied by reference and never descended into.
 *
 * ⚠ THIS USED TO RECURSE AT EVERY DEPTH, AND THAT MADE A SEMANTIC CHANGE
 * INVISIBLE (Codex C8-A review, 2026-08-25). The strip matched a BARE KEY NAME
 * anywhere in the tree, but graph entries carry records KEYED BY NODE ID —
 * `option.data.interventions[<factor_id>]` is the live one (see
 * `handlers/edit-graph-dispatch.ts`, which writes
 * `/nodes/<opt>/data/interventions/<factor_id>`). A factor whose id happens to
 * be `position` (or `style`, `layout`, `selected`, …) therefore had its ENTIRE
 * intervention entry deleted from BOTH sides of the comparison, so editing that
 * factor's value compared equal and the policy answered `presentation_only` —
 * no version, no head move, no event, no receipt. Reproduced by execution: the
 * identity hashes differ, and the classifier still said presentation_only,
 * while the same edit on a non-colliding id said semantic_change.
 *
 * The fix binds the strip to POSITION rather than to a name: a presentation
 * field is a direct property of the graph root or of a node/edge/option entry.
 * Anything nested inside an entry's values is DATA and survives.
 *
 * Direction of the residual error is deliberate, and matches the identity
 * projection's own fail-safe asymmetry (`context/graph-identity.ts`): a
 * presentation key nested deeper than an entry is now RETAINED, so at worst a
 * cosmetic change mints a spare version. Over-INCLUDING costs a redundant row;
 * over-EXCLUDING silently destroys durable history. Only the second is
 * unrecoverable.
 */
function stripPresentationOwnKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const out: Record<string, unknown> = Object.create(null);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PRESENTATION_KEYS.has(key.toLowerCase())) continue;
    out[key] = child;
  }
  return out;
}

/** Entry collections whose members are graph entities carrying presentation fields. */
const ENTRY_COLLECTIONS = ["nodes", "edges", "options"] as const;

/**
 * The policy shape: the graph root and each node/edge/option entry with their
 * OWN presentation keys removed. Never descends past an entry.
 */
function stripPresentation(graph: unknown): unknown {
  const root = stripPresentationOwnKeys(graph) as Record<string, unknown>;
  if (root === null || typeof root !== "object") return root;
  for (const collection of ENTRY_COLLECTIONS) {
    const entries = root[collection];
    if (Array.isArray(entries)) {
      root[collection] = entries.map(stripPresentationOwnKeys);
    }
  }
  return root;
}

/**
 * Structural narrowing to the ingress shape: an object carrying `nodes` and
 * `edges` arrays. Exported so the commit seam's version carrier can hash the
 * EXACT bytes it persists without minting a second copy of this predicate — a
 * hand-maintained twin of a narrowing rule is precisely how two same-named
 * graph authorities drift apart.
 */
export function asGraphStateIngress(value: unknown): GraphStateIngress | null {
  return asIngress(value);
}

function asIngress(value: unknown): GraphStateIngress | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.nodes) && Array.isArray(record.edges)
    ? (value as GraphStateIngress)
    : null;
}

/**
 * The two shapes this policy compares, both taken from the graph ITSELF.
 *
 * ⚠⚠ THIS POLICY NO LONGER ASKS `computeGraphIdentityHash` WHETHER ANYTHING
 * CHANGED (C8-A review lead finding, 2026-08-25). It used to, and that made a
 * factor labelled "UI" silently destroy version history.
 *
 * `normaliseIdBase("UI")` → `"ui"`; `CANONICAL_ID_REGEX` requires no prefix, so
 * an ordinary factor name becomes a bare id that is ALSO a member of
 * `TRANSIENT_UI_KEYS`. Options key their interventions BY FACTOR ID
 * (`tools/plot-intervention-scale.ts:444/:653`), so that id appears as an
 * object KEY — and the identity projection's `stripTransientDeep` removes such
 * keys at EVERY depth. Both sides of the comparison lost the entry, the hashes
 * matched, the policy answered `no_op`, and `no_op` is a DESIGNED-SILENT arm:
 * graph and turn persisted, version + head + event + receipt gone, with no
 * telemetry to notice it. Measured for all sixteen members of that set;
 * "UI", "Viewport", "Panel State" and "Selection" are ordinary names in a
 * strategic model.
 *
 * The identity hash still collides. That is a CAS-authority defect with its own
 * blast radius — closing it means an `IDENTITY_NORMALISER_VERSION` bump and a
 * rehash of every persisted value — and it is ROWED, not absorbed here. What is
 * fixed is this policy resting a history decision on a function that collides.
 *
 * Ordering comes from `orderGraphEntriesForComparison`, which is the identity
 * normaliser's ordering WITHOUT its strip, reusing the same comparators so
 * there is no second copy of the ordering rule.
 *
 * `full` retains everything, so it answers "did anything at all change?".
 * `policy` additionally drops entry-level presentation fields, so it answers
 * "did anything the user would call the MODEL change?".
 */
function comparableShapes(graph: GraphStateIngress): {
  full: string;
  policy: string;
} {
  const ordered = orderGraphEntriesForComparison(graph);
  return {
    full: stableStringify(ordered),
    policy: stableStringify(stripPresentation(ordered)),
  };
}

export function decideModelVersionCreation(
  priorGraph: unknown,
  projectedGraph: unknown
): VersionCreationDecision {
  const current = asIngress(projectedGraph);
  if (current === null) return { create: false, reason: "no_graph" };
  // Emptiness ONLY — deliberately not the identity hash. `isIdentityEmptyGraph`
  // reads the raw graph's top-level entry arrays BEFORE any strip runs, so it
  // cannot be perturbed by the key collision above. The check must stay: an
  // identity-empty graph has no derivable version, and letting one through
  // would make the commit seam throw after deciding to version it.
  if (isIdentityEmptyGraph(current)) return { create: false, reason: "no_graph" };

  const prior = asIngress(priorGraph);
  if (prior === null) return { create: true, reason: "initial" };

  const priorShapes = comparableShapes(prior);
  const currentShapes = comparableShapes(current);
  if (priorShapes.full === currentShapes.full) {
    return { create: false, reason: "no_op" };
  }
  return priorShapes.policy === currentShapes.policy
    ? { create: false, reason: "presentation_only" }
    : { create: true, reason: "semantic_change" };
}
