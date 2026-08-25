/**
 * Model-version creation policy. This is a decision predicate, not a third
 * identity/hash authority: CAS/restore use full identity and freshness uses
 * the analysis-affecting hash.
 */
import { stableStringify } from "../../orchestrator/context/stable-stringify.js";
import type { GraphStateIngress } from "../boundary/request-extensions.js";
import {
  computeGraphIdentityHash,
  normaliseGraphForIdentity,
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

export function decideModelVersionCreation(
  priorGraph: unknown,
  projectedGraph: unknown
): VersionCreationDecision {
  const current = asIngress(projectedGraph);
  if (current === null) return { create: false, reason: "no_graph" };
  const currentIdentity = computeGraphIdentityHash(current);
  if (currentIdentity === null) return { create: false, reason: "no_graph" };

  const prior = asIngress(priorGraph);
  if (prior === null) return { create: true, reason: "initial" };
  const priorIdentity = computeGraphIdentityHash(prior);
  if (priorIdentity?.value === currentIdentity.value) {
    return { create: false, reason: "no_op" };
  }

  const priorNormalised = normaliseGraphForIdentity(prior);
  const currentNormalised = normaliseGraphForIdentity(current);
  if (priorNormalised === null || currentNormalised === null) {
    return { create: true, reason: "semantic_change" };
  }
  const priorPolicyShape = stableStringify(
    stripPresentation(priorNormalised.graph)
  );
  const currentPolicyShape = stableStringify(
    stripPresentation(currentNormalised.graph)
  );
  return priorPolicyShape === currentPolicyShape
    ? { create: false, reason: "presentation_only" }
    : { create: true, reason: "semantic_change" };
}
