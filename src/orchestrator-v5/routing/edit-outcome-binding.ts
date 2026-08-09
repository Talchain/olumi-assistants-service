/**
 * Edit-outcome binding — "did the model actually change?"
 *
 * ROADMAP 2.1003 / audit finding F3.
 *
 * Measured on deployed staging, 2026-08-09: an edit was sent, then the
 * IDENTICAL message was sent again. The second turn produced no new graph
 * identity and still told the user *"Applied edit. Graph now has 21 nodes and
 * 43 edges."* The composer's truth condition is `appliedGraph != null` —
 * presence of a graph, not occurrence of a change.
 *
 * ⚠⚠ TRAP 21 — THIS ANSWERS A DIFFERENT QUESTION FROM
 * `isSuccessfulAppliedMutation`, AND THE TWO MUST NOT BE MERGED.
 *   `isSuccessfulAppliedMutation`  →  "is there a persisted post-edit graph to
 *                                      commit?"   (12+ readers: persistence,
 *                                      analysis_ready, fact emission, the GM
 *                                      gate, the returned graph)
 *   `didModelChange` (here)        →  "did the user-meaningful model actually
 *                                      move?"     (3 readers, by design: the
 *                                      confirmation copy, the turn event, and
 *                                      the edit fact summary)
 * Adding a conjunct to the former would stop a byte-identical-but-correct
 * graph being persisted. Committing an unchanged graph is harmless; the harm
 * is the CLAIM. Keep them apart.
 *
 * ⚠ THE COMPARATOR IS A WHITELIST, AND THAT IS THE WHOLE POINT.
 * The obvious implementation — `computeGraphHash` (SHA-256 of
 * `JSON.stringify`) over both graphs — is unsafe here for two independent
 * reasons, either of which would leave a guard that silently stops
 * discriminating and therefore looks exactly like a real result:
 *   1. `JSON.stringify` is KEY-ORDER SENSITIVE. The applied graph has made a
 *      round trip through PLoT; a re-serialisation with different key order
 *      reads as "changed" on every PLoT-served turn.
 *   2. PLoT legitimately annotates passthrough fields (edge `validation`,
 *      `defaulted`, repair metadata) that are not part of the user's model.
 * A whitelist projection is immune to both BY CONSTRUCTION. `stableStringify`
 * additionally sorts keys recursively, so ordering cannot leak in.
 *
 * The projection reuses the repo's existing analysis-affecting hash rather
 * than inventing a second one (the two-`generateGraphHash`-twins trap), and
 * adds the ONE thing that hash deliberately excludes but a user plainly reads:
 * labels. `computeAnalysisAffectingGraphHash` excludes labels so that a rename
 * does not falsely stale an analysis — correct for freshness, wrong here,
 * because a rename IS a change the user made and must be confirmed honestly.
 * `display_value` stays excluded on both halves: a display anchor repaired by
 * `reconcileDisplayAnchors` is a consequence of the write, not a second change.
 *
 * Pure: no I/O, no LLM, no telemetry. The caller owns emission and copy.
 */

import { createHash } from 'node:crypto';

import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

const HASH_HEX_LENGTH = 16;

interface LabelledNode {
  id?: unknown;
  label?: unknown;
}

interface LabelledEdge {
  from?: unknown;
  to?: unknown;
  label?: unknown;
}

/**
 * The label identity a user reads off the canvas: node id → label, and edge
 * endpoints → label. Sorted, so ordering cannot fake a difference.
 */
function projectLabels(graph: unknown): {
  nodes: Array<{ id: string; label: string | null }>;
  edges: Array<{ from: string; to: string; label: string | null }>;
} {
  const g = graph as { nodes?: unknown; edges?: unknown } | null | undefined;
  const nodes = Array.isArray(g?.nodes) ? (g.nodes as LabelledNode[]) : [];
  const edges = Array.isArray(g?.edges) ? (g.edges as LabelledEdge[]) : [];
  return {
    nodes: nodes
      .map((n) => ({
        id: typeof n?.id === 'string' ? n.id : '',
        label: typeof n?.label === 'string' ? n.label : null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges
      .map((e) => ({
        from: typeof e?.from === 'string' ? e.from : '',
        to: typeof e?.to === 'string' ? e.to : '',
        label: typeof e?.label === 'string' ? e.label : null,
      }))
      .sort((a, b) => {
        const fromCmp = a.from.localeCompare(b.from);
        return fromCmp !== 0 ? fromCmp : a.to.localeCompare(b.to);
      }),
  };
}

/**
 * A 16-char hex fingerprint of everything about a graph a user would call
 * "the model": every analysis-affecting field, plus the labels.
 *
 * Returns `null` only for a null/undefined graph.
 */
export function computeUserMeaningfulModelHash(graph: unknown): string | null {
  if (graph === null || graph === undefined) return null;
  // ⚠ TOTAL BY CONSTRUCTION — DO NOT REMOVE THIS GUARD.
  //
  // What was MEASURED (directly, by calling it): `computeAnalysisAffectingGraphHash`
  // THROWS when `edges` is absent — `computeUserMeaningfulModelHash({ nodes: [...] })`
  // raised "Cannot read properties of undefined (reading 'map')". This helper
  // runs on the critical path of EVERY edit turn, and the graphs it sees are
  // not all strict-V3 (`buildStructuralFallback` legitimately produces shapes
  // that fail `GraphV3.safeParse`, e.g. `strength.std = 0`). An uncaught throw
  // here would cost the user an edit that otherwise succeeded.
  //
  // ⚠ WHAT IS **NOT** CLAIMED: this guard is not known to have been reached by
  // any existing test. An earlier draft of this comment said it fixed the
  // V3-invalid-base regression in `normal-path-value-op-canonicalisation.test.ts`;
  // that was WRONG — a mutant removing this guard leaves that test GREEN, so
  // the throw is not on that path. The regression there was caused by a
  // routing demotion that has since been withdrawn. The guard stays because
  // the throw is real and the blast radius is a lost edit, not because it was
  // observed firing in production.
  //
  // A hash we cannot compute must produce NO VERDICT, never a wrong one.
  // `null` flows to `not_applicable`, which the composer treats as "could not
  // tell" and which leaves today's copy untouched.
  try {
    const analysis = computeAnalysisAffectingGraphHash(graph as GraphStateIngress);
    const canonical = stableStringify({ analysis, labels: projectLabels(graph) });
    return createHash('sha256').update(canonical).digest('hex').slice(0, HASH_HEX_LENGTH);
  } catch {
    return null;
  }
}

export type EditModelChangeVerdict =
  /** The user-meaningful model moved. */
  | 'changed'
  /** A graph was applied and committed, and it is identical to the pre-edit graph. */
  | 'unchanged'
  /**
   * No verdict is available — no applied graph, or no pre-edit graph to
   * compare against. A GUESS IS NOT A VERDICT: the caller must not render
   * "no change" copy from this. (Same law as `configure-option-outcome.ts`'s
   * `not_applicable`: an unnamed target never earns a verdict.)
   */
  | 'not_applicable';

export interface EditModelChangeResult {
  verdict: EditModelChangeVerdict;
  /** The pre-edit fingerprint, when one could be computed. */
  beforeHash: string | null;
  /** The post-edit fingerprint, when one could be computed. */
  afterHash: string | null;
}

/**
 * Compare the pre-edit graph with the applied graph using ONE locally-owned
 * function over BOTH. Never reads a producer-supplied `graph_hash`: PLoT's
 * hash is a different function over a different projection, and comparing it
 * against a locally computed one reads "changed" every time.
 */
export function evaluateEditModelChange(
  before: unknown,
  after: unknown,
): EditModelChangeResult {
  if (after === null || after === undefined || before === null || before === undefined) {
    return { verdict: 'not_applicable', beforeHash: null, afterHash: null };
  }
  const beforeHash = computeUserMeaningfulModelHash(before);
  const afterHash = computeUserMeaningfulModelHash(after);
  if (beforeHash === null || afterHash === null) {
    return { verdict: 'not_applicable', beforeHash, afterHash };
  }
  return {
    verdict: beforeHash === afterHash ? 'unchanged' : 'changed',
    beforeHash,
    afterHash,
  };
}
