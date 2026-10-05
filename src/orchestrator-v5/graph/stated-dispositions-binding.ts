/**
 * ⛔ A RECEIPT DESCRIBES ONE GRAPH — THE BINDING BETWEEN `graph.stated_dispositions` AND ITS MODEL (P1, DL 5 Oct 2026).
 *
 * The register route reconciles the records compiler's receipt against the exact bytes it stores. Staging's other
 * writers drop the key, but production CEE `abed3b51` (sharing the same Supabase) copies a stored graph's top-level
 * keys forward on every edit (`apply-graph-mutation.ts:228-236`, `edit-graph-dispatch.ts:2170-2174` @abed3b51), so a
 * receipt can sit on a model it no longer describes: a carried row whose carrier was removed, or a rejected/asked
 * row for a figure the edit has since modelled.
 *
 * So the stored receipt names the graph it was reconciled against (`reconciled_against`: that graph's
 * `graph_identity_hash` value with the receipt OMITTED — the identity normaliser includes every unknown root key, so
 * hashing it WITH the receipt would bind the receipt to itself), and a reader uses the rows ONLY while the current
 * graph, receipt omitted, still has that identity. Anything else — stale, unbound, malformed, unhashable — is absence:
 * the clause falls back to the untyped read-time path, exactly as if no receipt were stored.
 *
 * Identity, not bytes: a change the identity projection excludes (`ref_high_water`, transient UI keys) does not
 * change the model, so it does not invalidate the receipt.
 */
import { computeGraphIdentityHash } from '../context/graph-identity.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import {
  STATED_DISPOSITIONS_KEY,
  StatedDispositionsReceiptV3,
  omitStatedDispositions,
  type StatedDispositionV3T,
} from '../../schemas/graph-stated-dispositions.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The identity a receipt binds to: `graph_identity_hash` of the graph with the receipt omitted. `null` = unhashable. */
export function statedDispositionsBindingIdentity(graph: unknown): string | null {
  const bare = omitStatedDispositions(graph);
  if (!isRecord(bare) || !Array.isArray(bare.nodes) || !Array.isArray(bare.edges)) return null;
  try {
    return computeGraphIdentityHash(bare as GraphStateIngress)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * The receipt's rows ONLY while it still describes this graph. `undefined` when the key is absent, malformed, unbound
 * (the pre-binding bare array), or stale (`reconciled_against` is not this graph's identity).
 */
export function currentStatedDispositionRows(graph: unknown): readonly StatedDispositionV3T[] | undefined {
  if (!isRecord(graph) || !Object.prototype.hasOwnProperty.call(graph, STATED_DISPOSITIONS_KEY)) return undefined;
  const receipt = StatedDispositionsReceiptV3.safeParse(graph[STATED_DISPOSITIONS_KEY]);
  if (!receipt.success) return undefined;
  const current = statedDispositionsBindingIdentity(graph);
  return current !== null && current === receipt.data.reconciled_against ? receipt.data.rows : undefined;
}
