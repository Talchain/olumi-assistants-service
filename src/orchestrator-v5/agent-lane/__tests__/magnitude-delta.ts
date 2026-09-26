/**
 * ⭐ SUBTRACT THE MAGNITUDE CONTRACT'S KNOWN DELTA before a byte-for-byte fidelity compare against a graph served
 * before it (PR1b, #70 5848092404). Served captures pre-date PR1b, so a link into a bounded target that PR1b now sizes
 * to the target's frame is the ONLY expected difference. It is not re-recorded: each such edge is restored to today's
 * projection (sign · 0.5 / 0.125, no magnitude stamp) and COUNTED, so a fidelity row still fails on any other change
 * and the delta itself is asserted, never hidden. Same doctrine as #2003's `subtractEdgeBandVocabularyDelta`.
 */
type AnyEdge = { strength?: { mean?: number; std?: number }; provenance?: Record<string, unknown> } & Record<string, unknown>;

export function subtractMagnitudeDelta<E>(edges: readonly E[]): { edges: E[]; sized: number } {
  let sized = 0;
  const out = edges.map((raw) => {
    const e = raw as unknown as AnyEdge;
    if (e.provenance?.magnitude !== 'olumi_placeholder') return raw;
    const mean = e.strength?.mean ?? 0;
    if (!(Math.abs(mean) < 0.5)) throw new Error(`a placeholder that is not smaller than the old projection: ${JSON.stringify(e)}`);
    sized += 1;
    const { magnitude: _m, natural_effect: _n, ...provenance } = e.provenance;
    return { ...e, strength: { mean: Math.sign(mean) * 0.5, std: 0.125 }, provenance } as unknown as E;
  });
  return { edges: out, sized };
}
