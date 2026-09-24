/**
 * ⭐ AN OPTION LEVEL WITH NO RECORDED ORIGIN IS OLUMI'S — AND IS STORED SAYING SO.
 *
 * MEASURED on served staging (Canvas manual witness, #63 5805819378 OC-1; Render logs
 * 24 Sep 01:23:27Z / 01:24:10Z, scenario `768133d1…`): every edit of a CDP example's
 * "same as baseline" option level answered 422 `invalid_existing_intervention`, and the UI
 * reverted silently. The stored cells were `{ value: 0.5, display_value: '£60k' }` — no
 * `source` at all — so the option-level writer's reader (`ExistingInterventionRead`,
 * `option-intervention-edit.ts`) refused them, as its recorded ruling says it must: "an
 * entry with no stated origin cannot be overwritten with user authority without silently
 * erasing what it was… the fix is the WRITER'S INPUT, never a relaxation of the writer"
 * (`constructed-level-cells-carry-source.test.ts`).
 *
 * So the input states the origin, at the one place imported bytes enter: an unattributed
 * cell is Olumi's — MG&Q's ruling (#63 5801075453: "an unknown source maps to Olumi, never
 * to 'you'"). The writer can then revise it, and a replaced value reads as the user's while
 * the untouched ones read as Olumi's.
 *
 * ⛔ What this never does: it never invents `user_specified` or `brief_extraction`, and it
 * never rewrites a PRESENT `source` — not even one outside the producer's enum, which the
 * writer must go on refusing. Only an absent (or null) origin is stated. Non-option nodes,
 * non-object cells and cells with no numeric `value` are left exactly as they are.
 */
export const UNSOURCED_LEVEL_SOURCE = 'cee_hypothesis' as const;

export function attributeUnsourcedLevelCells<G extends { readonly nodes: readonly unknown[] }>(graph: G): G {
  let changed = false;
  const nodes = graph.nodes.map((n) => {
    const node = n as { kind?: unknown; interventions?: unknown };
    if (node === null || typeof node !== 'object' || node.kind !== 'option') return n;
    const cells = node.interventions;
    if (cells === null || typeof cells !== 'object' || Array.isArray(cells)) return n;
    let nodeChanged = false;
    const next: Record<string, unknown> = {};
    for (const [factorId, cell] of Object.entries(cells as Record<string, unknown>)) {
      const c = cell as { value?: unknown; source?: unknown } | null;
      if (c !== null && typeof c === 'object' && !Array.isArray(c)
        && typeof c.value === 'number' && Number.isFinite(c.value)
        && (c.source === undefined || c.source === null)) {
        next[factorId] = { ...c, source: UNSOURCED_LEVEL_SOURCE };
        nodeChanged = true;
      } else {
        next[factorId] = cell;
      }
    }
    if (!nodeChanged) return n;
    changed = true;
    return { ...node, interventions: next };
  });
  return changed ? { ...graph, nodes } : graph;
}
