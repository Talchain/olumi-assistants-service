/**
 * ⭐ A FACTOR THE AGENT ADDS IS SIZED BY THE FIRST MODEL'S OWN RULE (R2; DL #72 5862693164, MG 5862666217).
 *
 * Served journey A (`pj-20260928T025327Z` A13, CEE 7b883a4): `propose_new_option` minted the switch "grandfather existing
 * customers" with its link into Monthly churn at `hypothesisEdgeValue`'s flat −0.5 (std 0.125), on a scale where churn
 * today is 0.03. The switch alone moved churn by −50 points, 80% of the leading option's draws fell outside churn's
 * possible levels (`CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN`), and the churn limit withheld the leader.
 *
 * Admission never writes that. A link Olumi sizes gets D6's `frameAwarePlaceholder` (−min(0.5, headroom/4): −0.0075
 * here), and `frameDefaultedLinks` re-sizes such links after a value edit. The confirm path for the Agent's new factors
 * skipped both.
 *
 * So at the confirm, after the today stamps and BEFORE the apply: apply the batch to a scratch copy, run
 * `frameDefaultedLinks` for every new SWITCH the batch adds, and write each re-sized link back into its own `add_edge` op.
 * Only a switch: a new GRADED factor keeps its own sizing path (DL 5862693164). It is valueless until the user gives its
 * level, and that write re-sizes its links (`set-factor-value` → `frameDefaultedLinks`). A switch's today-0 is Olumi's
 * own stamp at this confirm, so no later write ever re-sizes it: this is its one chance.
 * The apply and its all-landed postcondition then see the same values. Only a new factor's own Olumi-sized links change
 * (`frameDefaultedLinks` never touches a user's size, Olumi's stated estimate, or a structural edge). A batch the scratch
 * apply cannot take is returned untouched; the real apply then declines it honestly.
 */
import { applyPatchOperations } from '../../orchestrator/patch-applier.js';
import type { PatchOperation } from '../../orchestrator/types.js';
import { frameDefaultedLinks } from '../../cee/magnitude/frame-defaulted-links.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface SizedNewFactorLinks {
  readonly operations: PatchOperation[];
  /** `from::to` of every new-factor link re-sized. */
  readonly sized: readonly string[];
}

export function sizeNewFactorLinks(
  operations: readonly PatchOperation[],
  currentGraph: unknown,
  /** The new switches the hold names (`switch_factors`); each must be a factor this batch adds. */
  switchFactorIds: readonly string[],
): SizedNewFactorLinks {
  const unchanged: SizedNewFactorLinks = { operations: [...operations], sized: [] };
  const newFactorIds = operations
    .filter((op) => op.op === 'add_node' && isRec(op.value) && op.value.kind === 'factor' && typeof op.value.id === 'string')
    .map((op) => (op.value as Rec).id as string)
    .filter((id) => switchFactorIds.includes(id));
  if (newFactorIds.length === 0 || !isRec(currentGraph)) return unchanged;

  let scratch: unknown;
  try {
    // The applier returns nodes + edges only; the rest (goal_constraints: a % LEVEL limit is what gives a bare "%" its
    // [0, 1] domain, `percentLevelIds`) is the current graph's.
    scratch = { ...currentGraph, ...applyPatchOperations(currentGraph as never, [...operations]) };
  } catch {
    return unchanged;
  }
  const sized: string[] = [];
  for (const id of newFactorIds) {
    const framed = frameDefaultedLinks(scratch, id);
    scratch = framed.graph;
    sized.push(...framed.sized);
  }
  if (sized.length === 0 || !isRec(scratch) || !Array.isArray(scratch.edges)) return unchanged;

  const edgeByKey = new Map<string, Rec>((scratch.edges as unknown[]).filter(isRec).map((e) => [`${String(e.from)}::${String(e.to)}`, e]));
  const resized = new Set<string>(sized);
  return {
    operations: operations.map((op) => {
      if (op.op !== 'add_edge' || !isRec(op.value)) return op;
      const key = `${String(op.value.from)}::${String(op.value.to)}`;
      const edge = edgeByKey.get(key);
      if (!resized.has(key) || edge === undefined) return op;
      return { ...op, value: { ...op.value, strength: edge.strength, provenance: edge.provenance, defaulted: edge.defaulted } };
    }),
    sized,
  };
}
