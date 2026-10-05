/**
 * ⛔ A RECEIPT DESCRIBES ONE GRAPH — THE BINDING BETWEEN `graph.stated_dispositions` AND ITS MODEL (P1 + R2, 5 Oct 2026).
 *
 * The register route reconciles the records compiler's receipt against the exact bytes it stores. Staging's other
 * writers drop the key, but production CEE `abed3b51` (sharing the same Supabase) copies a stored graph's top-level
 * keys forward on every edit (`apply-graph-mutation.ts:228-236`, `edit-graph-dispatch.ts:2170-2174` @abed3b51), so a
 * receipt can sit on a model it no longer describes: a carried row whose carrier was removed, or a rejected/asked
 * row for a figure the edit has since modelled.
 *
 * So the stored receipt names the graph it was reconciled against (`reconciled_against`), and a reader uses the rows
 * ONLY while the current graph still hashes to it. Anything else — stale, unbound, malformed, unhashable — is absence:
 * the clause falls back to the untyped read-time path, exactly as if no receipt were stored.
 *
 * ⛔ WHY THE RECEIPT HAS ITS OWN CONTENT HASH, NOT `graph_identity_hash` (R2, Codex P1 @7d2dc3cf). The identity
 * projection drops "transient UI" keys AT EVERY DEPTH (`graph-identity.ts` TRANSIENT_UI_KEYS, e.g. `ui`), so a factor
 * whose id is `ui` could change 0 → 300 inside an intervention map with the identity unchanged, and the stale rejection
 * survived. The binding therefore hashes the graph's FULL content: a stable serialisation (object keys sorted at every
 * depth — `jsonb` does not keep key order; array order kept) of the graph minus `stated_dispositions` and minus
 * `ref_high_water` ONLY, with no other stripping. Any content change makes the receipt stale: fail closed. The CAS and
 * identity hashes are untouched.
 */
import { createHash } from 'node:crypto';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import {
  STATED_DISPOSITIONS_KEY,
  StatedDispositionsReceiptV3,
  omitStatedDispositions,
  type StatedDispositionV3T,
} from '../../schemas/graph-stated-dispositions.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The content hash a receipt binds to: sha256 of the stable serialisation of the graph minus the receipt and minus
 * `ref_high_water` (a counter a restore raises without changing the model). `null` = not a graph / unhashable.
 */
export function statedDispositionsBindingHash(graph: unknown): string | null {
  const bare = omitStatedDispositions(graph);
  if (!isRecord(bare) || !Array.isArray(bare.nodes) || !Array.isArray(bare.edges)) return null;
  const { ref_high_water: _counter, ...content } = bare;
  try {
    return createHash('sha256').update(stableStringify(content)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * The receipt's rows ONLY while it still describes this graph. `undefined` when the key is absent, malformed, unbound
 * (the pre-binding bare array), or stale (`reconciled_against` is not this graph's content hash).
 */
export function currentStatedDispositionRows(graph: unknown): readonly StatedDispositionV3T[] | undefined {
  if (!isRecord(graph) || !Object.prototype.hasOwnProperty.call(graph, STATED_DISPOSITIONS_KEY)) return undefined;
  const receipt = StatedDispositionsReceiptV3.safeParse(graph[STATED_DISPOSITIONS_KEY]);
  if (!receipt.success) return undefined;
  const current = statedDispositionsBindingHash(graph);
  return current !== null && current === receipt.data.reconciled_against ? receipt.data.rows : undefined;
}
