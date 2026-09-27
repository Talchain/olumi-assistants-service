/**
 * ⭐ SUBTRACT A4a's KNOWN DELTA before a byte-for-byte fidelity compare against a graph served before it (DL build
 * train #70 5855068711 row A4; AI Quality 5854837708 and 5854861848; `risk-mediator-fold.ts`). Served captures
 * pre-date the fold, so a one-parent risk Olumi drafted between two factors now registers as ONE link from its parent
 * to each child, and the risk and its two links are gone. That is the ONLY expected difference. It is not re-recorded:
 * each folded link is restored to the served risk and its served links, at their served places, and COUNTED, so a
 * fidelity row still fails on any other change and the delta itself is asserted, never hidden. Same doctrine as
 * `subtractMagnitudeDelta` (PR1b) and #2003's `subtractEdgeBandVocabularyDelta`.
 *
 * What it checks on each folded link, from the served bytes alone (the strengths themselves are sized by the magnitude
 * contract after the capture, so they are checked by `construction-risk-mediator-fold.test.ts`, not here): it is
 * `cee_hypothesis`, its rationale names the served risk in the drafter's own words, it runs from the risk's one served
 * parent to a served child, its sign is the product of the two served signs, and exists′ = p₁·p₂ on the served values.
 */
type AnyNode = { id: string; kind?: string; label?: string; description?: string } & Record<string, unknown>;
type AnyEdge = {
  from: string; to: string; exists_probability?: number; effect_direction?: string;
  strength?: { mean?: number }; provenance?: { source?: string; reasoning?: string };
} & Record<string, unknown>;

const FOLDED = /^Olumi's risk "(.+?)", folded into this link: /;
const key = (e: { from: string; to: string }): string => `${e.from}\u0000${e.to}`;

/** Put `item` back where the served order has it: after its served predecessor, else before its served successor. */
function reinsert<T>(into: T[], item: T, served: readonly T[], same: (a: T, b: T) => boolean): void {
  const at = served.findIndex((s) => same(s, item));
  for (let i = at - 1; i >= 0; i--) {
    const j = into.findIndex((x) => same(x, served[i]!));
    if (j >= 0) { into.splice(j + 1, 0, item); return; }
  }
  for (let i = at + 1; i < served.length; i++) {
    const j = into.findIndex((x) => same(x, served[i]!));
    if (j >= 0) { into.splice(j, 0, item); return; }
  }
  into.push(item);
}

export function subtractRiskFoldDelta<N, E>(
  registered: { readonly nodes: readonly N[]; readonly edges: readonly E[] },
  served: { readonly nodes: readonly unknown[]; readonly edges: readonly unknown[] },
): { nodes: N[]; edges: E[]; folded: string[] } {
  const sNodes = served.nodes as readonly AnyNode[];
  const sEdges = served.edges as readonly AnyEdge[];
  const nodes = [...registered.nodes] as unknown as AnyNode[];
  let edges = [...registered.edges] as unknown as AnyEdge[];
  const folded: string[] = [];

  const byRisk = new Map<string, AnyEdge[]>();
  for (const e of edges) {
    const m = FOLDED.exec(String(e.provenance?.reasoning ?? ''));
    if (m === null) continue;
    const risk = sNodes.find((n) => n.kind === 'risk' && String(n.description ?? n.label) === m[1]);
    if (risk === undefined) throw new Error(`a folded link names a risk the served graph does not hold: ${JSON.stringify(e)}`);
    byRisk.set(risk.id, [...(byRisk.get(risk.id) ?? []), e]);
  }
  for (const [riskId, links] of byRisk) {
    const risk = sNodes.find((n) => n.id === riskId)!;
    if (nodes.some((n) => n.id === riskId)) throw new Error(`folded risk ${riskId} is still registered`);
    const inbound = sEdges.filter((e) => e.to === riskId);
    if (inbound.length !== 1) throw new Error(`served risk ${riskId} has ${inbound.length} parents, not one`);
    const into = inbound[0]!;
    for (const f of links) {
      const out = sEdges.find((e) => e.from === riskId && e.to === f.to);
      if (f.from !== into.from || out === undefined) throw new Error(`folded link ${f.from} -> ${f.to} is not ${riskId}'s served path`);
      if (f.provenance?.source !== 'cee_hypothesis') throw new Error(`folded link ${f.from} -> ${f.to} is not cee_hypothesis`);
      const p = Number(into.exists_probability) * Number(out.exists_probability);
      if (!(Math.abs(Number(f.exists_probability) - p) < 1e-12)) throw new Error(`folded link ${f.from} -> ${f.to}: exists ${f.exists_probability}, not p1*p2 = ${p}`);
      const sign = Math.sign(Number(into.strength?.mean)) * Math.sign(Number(out.strength?.mean));
      if (f.effect_direction !== (sign > 0 ? 'positive' : 'negative')) throw new Error(`folded link ${f.from} -> ${f.to}: direction ${f.effect_direction}`);
      edges = edges.map((e) => (e === f ? out : e));
    }
    reinsert(edges, into, sEdges, (a, b) => key(a) === key(b));
    reinsert(nodes, risk, sNodes, (a, b) => a.id === b.id);
    folded.push(riskId);
  }
  return { nodes: nodes as unknown as N[], edges: edges as unknown as E[], folded };
}
