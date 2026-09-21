/**
 * CAN EDITING THIS FACTOR'S BASELINE VALUE MOVE THE OPTION COMPARISON?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THIS IS **NOT** THE QUESTION `intervention-controlled-drivers.ts` ASKS,
 * AND THE TWO MUST NEVER BE COLLAPSED (CLAUDE.md trap #21).
 *
 *   `collectInterventionControlledFactorIds` asks:
 *     "is this factor a lever **SOME** option pulls?"
 *   Its remedy is claim safety in prose: never describe such a factor as an
 *   independently tunable sensitivity driver.
 *
 *   THIS MODULE asks:
 *     "is this factor's baseline value replaced by **EVERY** option?"
 *   Its remedy is a coaching moment at EDIT time: when every option supplies
 *   its own value, the factor's own value is a baseline every option discards,
 *   so editing it cannot move the comparison at all.
 *
 * SOME and EVERY are different predicates with different truth sets. A factor
 * two options out of three override is genuinely tunable — the third option
 * still consumes the baseline, so an edit really does move the comparison. Any
 * "convergence" of these two modules would either silence honest coaching on
 * the SOME case or, far worse, tell a user their edit is inert when it is not.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * DERIVED FROM THE RAW TURN GRAPH, from the same union of intervention
 * locations `intervention-controlled-drivers.ts` reads, and for the same
 * reason: a factor must not escape detection by living in one shape and not
 * another. The one difference is the KEY — options are keyed by `id` here, so
 * a graph that describes the same option both as a `nodes[]` entry and as an
 * `options[]` entry counts it ONCE. Counting it twice would make "every
 * option" arithmetic silently wrong.
 *
 * ⭐ FAIL-CLOSED MEANS "DO NOT CLAIM INERTNESS". Every degenerate shape — no
 * options, one option, an option with no resolvable id, an unreadable graph —
 * returns {@link BaselineOverrideReach.kind} `'unknown'`. The dangerous error
 * here is asserting an edit is inert when it is not, so absence of evidence
 * never becomes evidence of inertness.
 *
 * READ-ONLY and PURE. Computes, corrects and overwrites nothing.
 */

type Dict = Record<string, unknown>;

function isPlainObject(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Slash-keyed flat intervention entry, e.g. `data/interventions/fac_annual_cost`. */
const SLASH_KEY_RE = /^data\/interventions\/(.+)$/;

/**
 * The factor ids one option node intervenes on, UNIONED across all known
 * locations — the same three shapes `addNodeInterventionFactorIds` reads in
 * `intervention-controlled-drivers.ts`:
 *   1. canonical top-level `node.interventions`
 *   2. `node.data.interventions` (pre-normalisation / just-edited shape)
 *   3. slash-keyed flat entries `node["data/interventions/<fac>"]`
 */
function optionInterventionFactorIds(node: Dict): Set<string> {
  const ids = new Set<string>();
  const add = (factorId: unknown): void => {
    if (typeof factorId !== 'string') return;
    const id = factorId.trim();
    if (id.length > 0) ids.add(id);
  };

  if (isPlainObject(node.interventions)) {
    for (const fac of Object.keys(node.interventions)) add(fac);
  }
  const data = node.data;
  if (isPlainObject(data) && isPlainObject(data.interventions)) {
    for (const fac of Object.keys(data.interventions)) add(fac);
  }
  for (const key of Object.keys(node)) {
    const m = SLASH_KEY_RE.exec(key);
    if (m !== null && typeof m[1] === 'string') add(m[1]);
  }
  return ids;
}

function readOptionId(node: Dict): string | null {
  const raw = node.id;
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return id.length > 0 ? id : null;
}

/**
 * The decision's options, keyed by id, each with the set of factor ids it
 * overrides. `null` when any option in the graph carries no resolvable id —
 * see the fail-closed note in the module header.
 */
function collectOptionsById(graph: unknown): Map<string, Set<string>> | null {
  if (!isPlainObject(graph)) return null;
  const byId = new Map<string, Set<string>>();

  const absorb = (node: unknown): boolean => {
    if (!isPlainObject(node)) return false;
    const id = readOptionId(node);
    if (id === null) return false;
    const existing = byId.get(id);
    const found = optionInterventionFactorIds(node);
    if (existing === undefined) {
      byId.set(id, found);
    } else {
      for (const fac of found) existing.add(fac);
    }
    return true;
  };

  if (Array.isArray(graph.nodes)) {
    for (const node of graph.nodes) {
      if (!isPlainObject(node)) continue;
      // `kind` is the canonical discriminator; `type` is the ingress spelling
      // the persisted graph and the debug bundle both carry. Reading only one
      // of them makes this blind to a real option on a shape we ship.
      if (node.kind !== 'option' && node.type !== 'option') continue;
      if (!absorb(node)) return null;
    }
  }

  if (Array.isArray(graph.options)) {
    for (const option of graph.options) {
      if (!absorb(option)) return null;
    }
  }

  return byId;
}

export type BaselineOverrideReach =
  /**
   * Every option in the decision supplies its own value for this factor, so
   * the factor's own value is a baseline they all replace. An edit to it
   * cannot move the comparison.
   */
  | { readonly kind: 'replaced_by_every_option'; readonly optionCount: number }
  /** At least one option consumes the baseline, so an edit can move the comparison. */
  | { readonly kind: 'reaches_comparison' }
  /** Not derivable from this graph. Claim nothing. */
  | { readonly kind: 'unknown' };

/**
 * Does every option override this factor?
 *
 * @param graph    the RAW turn graph (never the compacted ContextPack
 *                 projection, which strips intervention bundles)
 * @param factorId the STRUCTURAL id of the factor being edited. Never a label:
 *                 labels collide, and a label join would report a different
 *                 factor's inertness (trap 19).
 */
export function baselineOverrideReach(
  graph: unknown,
  factorId: string,
): BaselineOverrideReach {
  const target = typeof factorId === 'string' ? factorId.trim() : '';
  if (target.length === 0) return { kind: 'unknown' };

  const options = collectOptionsById(graph);
  if (options === null) return { kind: 'unknown' };
  // A comparison needs at least two options. With fewer, "every option
  // overrides it" is vacuously true and would licence a sentence about a
  // comparison that does not exist.
  if (options.size < 2) return { kind: 'unknown' };

  for (const overridden of options.values()) {
    if (!overridden.has(target)) return { kind: 'reaches_comparison' };
  }
  return { kind: 'replaced_by_every_option', optionCount: options.size };
}
