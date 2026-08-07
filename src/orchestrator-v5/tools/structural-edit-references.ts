/**
 * ROADMAP 2.474 — ENTITY REFERENCES CARRIED BY A STRUCTURAL EDIT OPERATION.
 *
 * A leaf, extracted so exactly ONE answer exists to "what does this operation
 * name?" and both readers get it:
 *
 *   · `propose-structural-edit.ts` — the GROUNDING validator, which rejects a
 *     batch naming anything the persisted graph does not have;
 *   · `structural-edit-batch-split.ts` — the SPLITTER, which must not put an
 *     operation in a part that runs BEFORE the part creating the id it names.
 *
 * Those two must agree. A splitter with its own idea of what an op references
 * would happily emit a part whose ids the validator has already proved live
 * only in a later part — the hand-maintained mirror (CLAUDE.md trap 12) in the
 * one place where drift produces an ungrounded batch behind a confirm chip.
 *
 * ── THE `interventions` SCAN (moved here verbatim; its history matters) ─────
 * ⚠ THE DEFECT THIS EXISTS FOR, measured at three rungs before the guard
 * existed: the validator checked `path` and copied `value` through verbatim, so
 * an id in a field it did not read reached the graph unchallenged —
 * `update_node path='option_1' value={interventions:{ghost_factor:…}}` was
 * accepted, governed `proceed` in live mode (no hold, NO CONFIRM CHIP), and
 * REPLACED the option's real intervention map on apply. That is the 2.461
 * fabrication class inside the tool built to kill it, sitting on the headline
 * scenario's most natural composition: "give each option its own driver" is an
 * option `update_node` carrying an `interventions` map KEYED BY FACTOR ID.
 *
 * The scan is BY KEY NAME AT ANY DEPTH, deliberately, and not a list of paths.
 * field-safety sanctions the intervention subtree in three places
 * (`interventions`, `observed_state/interventions`, `data/interventions/<id>`),
 * so a path list here would be a mirror of that list and would drift from it
 * the first time the field-parity table grants a fourth (trap 12). One rule
 * about a key NAME covers all of them, and covers a nesting nobody has thought
 * of yet.
 *
 * SCOPE, stated so the guarantee upstream is not read as wider than it is:
 * this resolves ENTITY REFERENCES — intervention map keys, and the identity
 * fields `id`/`from`/`to`. It does not and cannot validate opaque content in
 * `value` (a label, a description, a number); WHICH fields may be written at
 * all is field-safety's judgement downstream, not this module's.
 */

/** The op kinds a structural edit may carry. Kept as a plain union — the
 *  authoritative list (and its set-equality guard against the canonical
 *  PatchOperation discriminators) lives in `propose-structural-edit.ts`. */
export type StructuralEditOpKind =
  | 'add_node'
  | 'remove_node'
  | 'update_node'
  | 'add_edge'
  | 'remove_edge'
  | 'update_edge';

/** The minimal op shape both readers consume. */
export interface StructuralEditOpLike {
  readonly op: string;
  readonly path: string;
  readonly value?: unknown;
  readonly old_value?: unknown;
}

const INTERVENTION_KEY = 'interventions';

/** Depth bound — a hostile/deep payload must not cost unbounded work. */
const MAX_VALUE_SCAN_DEPTH = 12;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Canonical edge key. Directional — the graph's edges are directional. */
export function edgeKeyOf(from: string, to: string): string {
  return `${from}::${to}`;
}

/** Parse "from::to" (CEE canonical) or "from->to" (v2) edge paths; null on malformed. */
export function parseEdgePath(path: string): { from: string; to: string } | null {
  const sep = path.includes('::') ? '::' : path.includes('->') ? '->' : null;
  if (sep === null) return null;
  const parts = path.split(sep);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { from: parts[0], to: parts[1] };
}

/**
 * Collect every factor id used as an INTERVENTION MAP KEY anywhere in `value`.
 * Total: cycles and depth overruns stop the walk rather than throwing, and a
 * truncated walk can only under-collect, which the caller treats as "nothing
 * more to check" — so the failure mode is a missed rejection, never a
 * fabricated one.
 */
export function collectInterventionTargetIds(value: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_VALUE_SCAN_DEPTH) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const record = asRecord(node);
    if (record === null) return;
    if (seen.has(record)) return;
    seen.add(record);
    for (const [key, child] of Object.entries(record)) {
      if (key === INTERVENTION_KEY) {
        const map = asRecord(child);
        if (map !== null) {
          for (const targetId of Object.keys(map)) {
            if (targetId.length > 0) found.push(targetId);
          }
        }
        // Keep walking: an intervention map's VALUES are payloads, and a
        // nested `interventions` inside one is still an intervention map.
      }
      walk(child, depth + 1);
    }
  };
  walk(value, 0);
  return found;
}

/**
 * The node id this operation CREATES, or null.
 *
 * Only `add_node` creates. An `add_edge` introduces an edge, never a node —
 * both its endpoints must already exist or be created by an earlier op, which
 * is precisely the dependency the splitter must not break.
 */
export function createdNodeIdOf(op: StructuralEditOpLike): string | null {
  return op.op === 'add_node' ? readString(op.path) : null;
}

/**
 * Every NODE ID this operation references but does not create.
 *
 * Deliberately a superset of "ids the validator will look up": over-collecting
 * can only make the splitter keep an op WITH its dependency (a larger, still
 * cap-legal part, or one more part), while under-collecting would let a part
 * reference an id that does not exist yet. The safe direction is up.
 */
export function referencedNodeIdsOf(op: StructuralEditOpLike): string[] {
  const out: string[] = [];
  const push = (id: string | null): void => {
    if (id !== null) out.push(id);
  };
  const value = asRecord(op.value);

  switch (op.op) {
    case 'add_node':
      // Creates its own target; only smuggled references remain.
      break;
    case 'remove_node':
    case 'update_node':
      push(readString(op.path));
      break;
    case 'add_edge': {
      // The canonical add_edge carries endpoints in `value`; `path` may also be
      // a from::to pair. Read both — see the "safe direction is up" note.
      push(readString(value?.from));
      push(readString(value?.to));
      const viaPath = parseEdgePath(op.path);
      if (viaPath !== null) {
        push(viaPath.from);
        push(viaPath.to);
      }
      break;
    }
    case 'remove_edge':
    case 'update_edge': {
      const target = parseEdgePath(op.path);
      if (target !== null) {
        push(target.from);
        push(target.to);
      }
      push(readString(value?.from));
      push(readString(value?.to));
      break;
    }
    default:
      // Unknown op: assume it references its path. The validator rejects it
      // long before the splitter runs; this keeps the splitter total.
      push(readString(op.path));
      break;
  }

  // The smuggle class, at any depth, for EVERY op kind.
  for (const targetId of collectInterventionTargetIds(op.value)) out.push(targetId);

  return out;
}
