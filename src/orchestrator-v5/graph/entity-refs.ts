/**
 * STABLE ENTITY REFERENCES — one persisted human reference per entity (`O2`, `F1`, `R1`, `G1` …) that NEVER renumbers
 * after creation and is NEVER reused (PTL #77 5909519622 §2; DL lease 5909544405; AIQ 5909556023 → 5909608045 →
 * 5909721329). Identity only: never ranking, never meaning.
 *
 * ── WHERE IT RUNS ─────────────────────────────────────────────────────────────
 * Each graph WRITER calls `assignEntityRefs(graph, base)` on the bytes it is about to hash and persist, BEFORE it
 * computes a version or a hash. Never on a read (a read-time ref would not be in the stored identity), and never
 * inside the persistence floor (`appendCheckedGraphWrite` must not mutate after the caller hashed).
 *
 * ── THE TWO FIELDS ────────────────────────────────────────────────────────────
 * - `node.ref` — display identity, like `label` and layout: IN the identity hash, OUT of the analysis hash (the
 *   published allow-list `CANONICAL_GRAPH_HASH_NESTED_PROJECTION` does not name it), so a ref never stales a Run.
 * - `graph.ref_high_water` — the highest number ever issued per prefix. A counter, not content: OUT of both hashes
 *   (`graph-identity.ts`), so a restore that raises it still binds to the restored version's identity.
 *
 * ── THE RULES ─────────────────────────────────────────────────────────────────
 * 1. The base graph's ref for a node id WINS (carry-forward). An edit path that drops `ref`, or a client that sends a
 *    different one, cannot renumber an entity.
 * 2. A ref is claimed once. A duplicate keeps its owner (base holder, else first in array order); the copy gets a
 *    fresh number.
 * 3. A new number is 1 + the max of: both high-waters and every valid ref in base and incoming. So a deleted O2 stays
 *    retired (the next option is O3), and a lowered counter on the incoming graph cannot pull numbers back.
 * 4. A ref whose prefix does not match the node's kind (an option holding `F1`), or that is malformed, is replaced.
 * 5. NO BACKFILL, AND THE BASE DECIDES: a node the base already held WITHOUT a ref stays ref-less — whatever ref the
 *    incoming graph puts on it (valid, wrong-kind or malformed) is removed and never raises the counter (PR Review CR
 *    on #2357). Only new entities (and every entity of a first construction) are issued refs, so an unchanged write to
 *    a pre-refs graph is byte-identical: no spurious version, no identity change. Backfilling is a separate step.
 * 7. BOUNDED: a ref's number and every counter are safe integers ≤ {@link MAX_REF_NUMBER}; anything larger is not a
 *    ref (and not a counter), so no issued ref is `OInfinity` or a rounded repeat. Past the bound, no ref is issued.
 * 6. AN UNKNOWN BASE ASSIGNS NOTHING. `base === undefined` means the writer could not read what it replaces (e.g. a
 *    failed read), so neither carry-forward nor "is this entity new?" can be decided: the graph passes through
 *    unchanged. A first construction passes `null` (known: nothing there).
 *
 * Pure. Returns the ORIGINAL object when nothing changes, so an unchanged graph is not a spurious write.
 */

export const REF_PREFIX_BY_KIND = Object.freeze({
  goal: 'G',
  option: 'O',
  factor: 'F',
  outcome: 'OC',
  risk: 'R',
  decision: 'D',
  action: 'A',
} as const);

type Kind = keyof typeof REF_PREFIX_BY_KIND;
type Prefix = (typeof REF_PREFIX_BY_KIND)[Kind];
export type RefHighWater = Partial<Record<Prefix, number>>;

/** The largest ref number (nine digits): far above any real model, far below `Number.MAX_SAFE_INTEGER`. */
export const MAX_REF_NUMBER = 999_999_999;
const REF_PATTERN = /^(OC|G|O|F|R|D|A)([1-9][0-9]{0,8})$/;
const boundedCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= MAX_REF_NUMBER;

type NodeLike = { id?: unknown; kind?: unknown; ref?: unknown } & Record<string, unknown>;
type GraphLike = { nodes?: unknown; ref_high_water?: unknown } & Record<string, unknown>;

function prefixOf(kind: unknown): Prefix | null {
  return typeof kind === 'string' && Object.hasOwn(REF_PREFIX_BY_KIND, kind) ? REF_PREFIX_BY_KIND[kind as Kind] : null;
}

/** `{ prefix, n }` for a well-formed ref, else null. */
export function parseEntityRef(ref: unknown): { prefix: Prefix; n: number } | null {
  if (typeof ref !== 'string') return null;
  const m = REF_PATTERN.exec(ref);
  return m ? { prefix: m[1] as Prefix, n: Number(m[2]) } : null;
}

/** A ref that is well-formed AND belongs to this node's kind. */
function refFor(node: NodeLike, ref: unknown): string | null {
  const p = parseEntityRef(ref);
  return p !== null && p.prefix === prefixOf(node.kind) ? (ref as string) : null;
}

function nodesOf(graph: unknown): NodeLike[] | null {
  const nodes = graph && typeof graph === 'object' ? (graph as GraphLike).nodes : undefined;
  return Array.isArray(nodes) ? (nodes as NodeLike[]) : null;
}

function highWaterOf(graph: unknown): RefHighWater {
  const hw = graph && typeof graph === 'object' ? (graph as GraphLike).ref_high_water : undefined;
  const out: RefHighWater = {};
  if (hw && typeof hw === 'object' && !Array.isArray(hw)) {
    for (const prefix of Object.values(REF_PREFIX_BY_KIND)) {
      const v = (hw as Record<string, unknown>)[prefix];
      if (boundedCount(v)) out[prefix] = v;
    }
  }
  return out;
}

/** Max of every counter and every valid ref across the given graphs. */
function combinedHighWater(...graphs: unknown[]): RefHighWater {
  const out: RefHighWater = {};
  const raise = (prefix: Prefix, n: number) => { if ((out[prefix] ?? 0) < n) out[prefix] = n; };
  for (const graph of graphs) {
    for (const [prefix, n] of Object.entries(highWaterOf(graph)) as [Prefix, number][]) raise(prefix, n);
    for (const node of nodesOf(graph) ?? []) {
      const ref = refFor(node, node.ref);
      if (ref !== null) { const p = parseEntityRef(ref)!; raise(p.prefix, p.n); }
    }
  }
  return out;
}

function sameHighWater(a: RefHighWater, b: RefHighWater): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<Prefix>;
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

export interface EntityRefAssignment<G> {
  readonly graph: G;
  /** Refs newly issued by this call (id → ref). */
  readonly assigned: ReadonlyArray<{ readonly id: string; readonly ref: string }>;
  /** Refs restored from the base because the incoming node lacked or changed them. */
  readonly carried: ReadonlyArray<{ readonly id: string; readonly ref: string }>;
}

/**
 * Give every entity its stable ref, carrying the base's refs forward by node id. `base` is the graph this write
 * replaces (absent on a first write).
 */
export function assignEntityRefs<G>(graph: G, base: unknown): EntityRefAssignment<G> {
  const nodes = nodesOf(graph);
  if (nodes === null || base === undefined) return { graph, assigned: [], carried: [] }; // rule 6

  const baseRefById = new Map<string, string>();
  const baseIds = new Set<string>();
  for (const b of nodesOf(base) ?? []) {
    if (typeof b.id === 'string') baseIds.add(b.id);
    const ref = typeof b.id === 'string' ? refFor(b, b.ref) : null;
    if (ref !== null && !baseRefById.has(b.id as string)) baseRefById.set(b.id as string, ref);
  }
  // ⛔ NEVER REUSED (PR Review CR on #2357): everything the base ever issued, per prefix. A node the base does not hold
  // never claims a number at or below it — a ref retired before this write, or removed in it, stays retired, so an
  // old reference can never come to name a different entity. The same base node keeps its own (`fromBase`).
  const issuedByBase = combinedHighWater(base);
  const notYetIssued = (ref: string | null): string | null => {
    const p = ref === null ? null : parseEntityRef(ref);
    return p !== null && p.n > (issuedByBase[p.prefix] ?? 0) ? ref : null;
  };
  // Pass 1 — claims. The base holder of a ref claims it first, so a later copy cannot take it.
  const claimed = new Set<string>();
  const chosen: (string | null)[] = nodes.map(() => null);
  const order = nodes.map((n, i) => i).sort((i, j) => {
    const hi = typeof nodes[i]!.id === 'string' && baseRefById.has(nodes[i]!.id as string) ? 0 : 1;
    const hj = typeof nodes[j]!.id === 'string' && baseRefById.has(nodes[j]!.id as string) ? 0 : 1;
    return hi - hj || i - j;
  });
  const carried: { id: string; ref: string }[] = [];
  for (const i of order) {
    const n = nodes[i]!;
    const fromBase = typeof n.id === 'string' ? refFor(n, baseRefById.get(n.id)) : null;
    // Rule 5: the base decides for an entity it already holds. A ref-less legacy node takes no incoming ref.
    const legacy = typeof n.id === 'string' && baseIds.has(n.id) && fromBase === null;
    const candidate = fromBase ?? (legacy ? null : notYetIssued(refFor(n, n.ref)));
    if (candidate !== null && !claimed.has(candidate)) {
      claimed.add(candidate);
      chosen[i] = candidate;
      if (fromBase !== null && n.ref !== fromBase) carried.push({ id: n.id as string, ref: fromBase });
    }
  }

  // The counter: everything the BASE ever issued, and every ref this write keeps. The incoming graph's own counter and
  // any ref it carries that is not kept (a legacy node's, a copy's) never raise it (rule 5).
  const hw = combinedHighWater(base);
  for (const ref of chosen) {
    const p = ref === null ? null : parseEntityRef(ref);
    if (p !== null && (hw[p.prefix] ?? 0) < p.n) hw[p.prefix] = p.n;
  }

  // Pass 2 — issue new numbers above the high-water, in array order.
  const assigned: { id: string; ref: string }[] = [];
  nodes.forEach((n, i) => {
    if (chosen[i] !== null) return;
    if (typeof n.id === 'string' && baseIds.has(n.id)) return; // rule 5: never backfill an entity the base held ref-less
    const prefix = prefixOf(n.kind);
    if (prefix === null) return; // an unknown kind gets no ref (never guess one)
    const next = (hw[prefix] ?? 0) + 1;
    if (next > MAX_REF_NUMBER) return; // rule 7: never an unbounded or repeated number
    hw[prefix] = next;
    chosen[i] = `${prefix}${next}`;
    assigned.push({ id: typeof n.id === 'string' ? n.id : String(i), ref: chosen[i]! });
  });

  // A node keeps exactly the ref chosen for it; a node with none carries no `ref` key at all (rule 5 / rule 4).
  const wrong = (n: NodeLike, i: number) => (chosen[i] !== null ? n.ref !== chosen[i] : Object.hasOwn(n, 'ref'));
  const nodesChanged = nodes.some(wrong);
  const hwChanged = !sameHighWater(highWaterOf(graph), hw);
  if (!nodesChanged && !hwChanged) return { graph, assigned, carried };

  const nextNodes = nodes.map((n, i) => {
    if (!wrong(n, i)) return n;
    if (chosen[i] !== null) return { ...n, ref: chosen[i] };
    const { ref: _dropped, ...rest } = n;
    return rest;
  });
  // A graph whose counter would be empty carries none (a legacy graph stays as it was).
  if (Object.keys(hw).length === 0) {
    const { ref_high_water: _noCounter, ...withoutCounter } = graph as GraphLike;
    return { graph: { ...withoutCounter, nodes: nextNodes } as G, assigned, carried };
  }
  return { graph: { ...(graph as object), nodes: nextNodes, ref_high_water: hw } as G, assigned, carried };
}

/**
 * RESTORE: the restored bytes keep every ref exactly (a restored node brings its own ref back, AIQ condition 2); only
 * the counter rises to cover everything the current graph has issued, so the next new entity never reuses a number a
 * later version used. The counter is outside identity, so the restored graph still binds to its version.
 */
export function raiseRefHighWaterForRestore<G>(restored: G, current: unknown): G {
  if (nodesOf(restored) === null) return restored;
  const hw = combinedHighWater(restored, current);
  if (sameHighWater(highWaterOf(restored), hw)) return restored;
  return { ...(restored as object), ref_high_water: hw } as G;
}
