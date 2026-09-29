/**
 * ROADMAP 2.467c — THE `kind`/`type` NODE-FIELD PAIR, RESOLVED ONCE, BEFORE ANY WRITE.
 *
 * THE HAZARD THIS EXISTS FOR (Codex rider on 2.467, adopted verbatim into the
 * design review as amendment A8): *"the server-write design must normalise the
 * `kind`/`type` node-field pair before any write — a divergent-field file must
 * not let UI and CEE interpret the same node differently."*
 *
 * The hazard is real at the bytes on both sides:
 *
 *  - CEE's canonical spelling is `kind`, EVERYWHERE on the persisted path.
 *    `GraphStateIngressSchema`'s `NodeContentSchema` REQUIRES `kind: z.string()`
 *    (`boundary/request-extensions.ts`), `GraphV3`'s `NodeV3` requires the
 *    `NodeKindV3` enum (`schemas/cee-v3.ts`), and the analysis-affecting hash
 *    projects the `'kind'` field by name (`context/graph-hash.ts`). A node
 *    carrying only `type` therefore contributes NO kind to the analysis hash
 *    and fails the ingress parse — which degrades `computeExpectedGraphCasHashes`
 *    to `{null, null}` SILENTLY (`context/graph-cas-conflict.ts` `parseFailed`).
 *  - The UI's canvas node carries THREE spellings at once — `node.type` (the
 *    ReactFlow renderer key), `node.data.type` and `node.data.kind` — and its
 *    own snapshot normaliser writes `data.type` and `data.kind` to the SAME
 *    canonical value. A file whose two spellings DISAGREE is therefore not a
 *    shape CEE can resolve by preference: it is a file that says two things.
 *
 * ── WHY DIVERGENCE IS REFUSED RATHER THAN RESOLVED ─────────────────────────
 * Picking a winner would be a guess dressed as a rule, and the cost of guessing
 * wrong is the exact defect 2.467 exists to kill: the screen showing one model
 * while the server computes another. A whole-graph registration is an
 * ALL-OR-NOTHING act — there is no partially-registered graph — so the only
 * honest answer to an ambiguous node is to refuse the batch and name the nodes.
 * Absence is different from disagreement and is resolved, not refused: a node
 * with only `type` is unambiguous about what it means.
 *
 * ── THE OUTPUT CARRIES EXACTLY ONE SPELLING ────────────────────────────────
 * `type` is DROPPED from every node, not merely shadowed by `kind`. Leaving both
 * in the persisted bytes would re-create the divergence one write later, and
 * would leave `type` inside the identity hash's input (the identity normaliser
 * hashes the whole stripped object, so a stray `type` moves the hash without
 * meaning anything). One spelling in, one spelling stored, one spelling hashed.
 *
 * PURE AND TOTAL: never mutates its input, never throws. A graph it cannot
 * shape (non-object, no `nodes` array) is returned UNCHANGED with
 * `changedNodeCount: 0` — the caller's schema parse is what refuses that, and
 * this module must not become a second, weaker validator.
 */

/** Why a graph cannot be registered as written. */
export type NodeKindRefusalReason =
  /** At least one node carries `kind` AND `type` as different non-empty strings. */
  | 'divergent_node_kind'
  /** At least one node carries neither `kind` nor `type` as a non-empty string. */
  | 'missing_node_kind';

export interface NodeKindNormalisationOk {
  readonly ok: true;
  /** The graph with exactly one kind spelling per node. Same reference when nothing changed. */
  readonly graph: unknown;
  /** How many nodes were rewritten (a `type` folded into `kind`, or a redundant `type` dropped). */
  readonly changedNodeCount: number;
}

export interface NodeKindNormalisationRefused {
  readonly ok: false;
  readonly reason: NodeKindRefusalReason;
  /**
   * The ids of the offending nodes, in input order, capped. Named so the caller
   * can tell the user WHICH node is ambiguous — a refusal that cannot be acted
   * on is only marginally better than a silent guess.
   */
  readonly nodeIds: readonly string[];
}

export type NodeKindNormalisation =
  | NodeKindNormalisationOk
  | NodeKindNormalisationRefused;

/** Bounded so a hostile 10k-node payload cannot make the error body the attack. */
const MAX_REPORTED_NODE_IDS = 10;

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function describeNodeId(node: Record<string, unknown>, index: number): string {
  const id = readNonEmptyString(node.id);
  return id ?? `#${index}`;
}

/**
 * Resolve every node's kind spelling, or refuse.
 *
 * @param graph an untrusted, request-supplied graph
 */
export function normaliseGraphNodeKindField(graph: unknown): NodeKindNormalisation {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) {
    return { ok: true, graph, changedNodeCount: 0 };
  }
  const source = graph as Record<string, unknown>;
  const nodes = source.nodes;
  if (!Array.isArray(nodes)) {
    return { ok: true, graph, changedNodeCount: 0 };
  }

  const divergent: string[] = [];
  const missing: string[] = [];
  const nextNodes: unknown[] = [];
  let changedNodeCount = 0;

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      // Not a node shape. The schema parse refuses it; this module does not.
      nextNodes.push(node);
      continue;
    }
    const record = node as Record<string, unknown>;
    const kind = readNonEmptyString(record.kind);
    const type = readNonEmptyString(record.type);

    if (kind !== null && type !== null && kind !== type) {
      divergent.push(describeNodeId(record, index));
      nextNodes.push(node);
      continue;
    }
    if (kind === null && type === null) {
      missing.push(describeNodeId(record, index));
      nextNodes.push(node);
      continue;
    }

    const resolved = kind ?? type;
    // `type` always leaves. When it was the only spelling it becomes `kind`;
    // when it merely agreed with `kind` it was redundant and is still dropped,
    // so the persisted bytes carry ONE spelling on every path.
    if (!('type' in record) && record.kind === resolved) {
      nextNodes.push(node);
      continue;
    }
    const { type: _dropped, ...rest } = record;
    void _dropped;
    nextNodes.push({ ...rest, kind: resolved });
    changedNodeCount += 1;
  }

  // Divergence is reported ahead of absence: it is the strictly more dangerous
  // of the two (absence fails a schema loudly; disagreement resolves silently
  // into whichever reader looked first), and a caller fixing a file wants the
  // ambiguity named before the omission.
  if (divergent.length > 0) {
    return {
      ok: false,
      reason: 'divergent_node_kind',
      nodeIds: divergent.slice(0, MAX_REPORTED_NODE_IDS),
    };
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'missing_node_kind',
      nodeIds: missing.slice(0, MAX_REPORTED_NODE_IDS),
    };
  }

  if (changedNodeCount === 0) {
    // Byte-identical outcome: return the ORIGINAL reference so a caller that
    // projects twice cannot tell the difference (same discipline as
    // `projectGraphForPersistence`).
    return { ok: true, graph, changedNodeCount: 0 };
  }
  return { ok: true, graph: { ...source, nodes: nextNodes }, changedNodeCount };
}
