/**
 * The DRAW STRUCTURE of a Run's recorded input — the ONE key that decides whether two Runs' Monte Carlo draws line up.
 * Read by C1 seed reuse (`seed-reuse.ts`, the producer) and by the attribution classifier (`build-run-delta.ts`), so
 * the two cannot disagree. Built only from `input_snapshot`s made by the ONE builder (`buildRunInputSnapshot`).
 *
 * R3 ruling #75 5920859011: a draw-structure change EXCLUDES C1 (it says C2). ISL draws each sample on one
 * stream in list order (ISL `robustness_analyzer_v2.py:1027-1037`): a Bernoulli per edge, then a Normal ONLY when the
 * edge exists — so a changed `exists_probability` changes which samples draw, and every later draw shifts. PLoT turns
 * a value of 0 into `point_mass` (no draw) and switches type on pinning (`translator-v3.ts:1560/1579`). So the key
 * holds: the option×factor settings (pinning) with any stated range, the factor/link id sets, each link's
 * `exists_probability`, and which values sit at 0. A mean or std that stays off 0 draws the same count and is NOT in the key — that is the edit C1
 * attributes. The SAME key gates the classifier (`build-run-delta.ts`), so reuse and C1 cannot disagree.
 */
import type { HandlerFact, RunInputSnapshot } from '@talchain/schemas/orchestrator';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const isZero = (v: unknown): boolean => v === 0;

/**
 * The DRAW STRUCTURE of one recorded Run input (see the header). Sorted, so key order never matters. Values other
 * than 0 are NOT in the key: a value edit is exactly what C1 attributes.
 */
export function drawStructureKey(snapshot: RunInputSnapshot): string {
  const s = snapshot as unknown as Record<string, unknown>;
  const options = Array.isArray(s.options) ? s.options.filter(isRec) : [];
  const optionIds: string[] = [];
  const settingKeys: string[] = [];
  const zeroKeys: string[] = [];
  for (const o of options) {
    const oid = str(o.option_id);
    if (oid === null) continue;
    optionIds.push(oid);
    for (const st of Array.isArray(o.settings) ? o.settings.filter(isRec) : []) {
      const fid = str(st.factor_id);
      if (fid === null) continue;
      // A stated range (TEMPORAL 0.66, sent once #2382 lands) is sampled by the engine; how many draws it takes is not
      // verified here, so the WHOLE range is structure — a range edit reads C2, an under-claim, never a false C1.
      const range = isRec(st.range) ? `~${String(st.range.meaning)}:${String(st.range.low)}:${String(st.range.high)}` : '';
      settingKeys.push(`${oid}|${fid}${range}`);
      if (isZero(st.encoded) || isZero(st.raw)) zeroKeys.push(`s:${oid}|${fid}`);
    }
  }
  const factorIds: string[] = [];
  for (const f of Array.isArray(s.factors) ? s.factors.filter(isRec) : []) {
    const fid = str(f.factor_id);
    if (fid === null) continue;
    factorIds.push(fid);
    if (isZero(f.encoded) || isZero(f.raw)) zeroKeys.push(`f:${fid}`);
  }
  const linkKeys: string[] = [];
  for (const l of Array.isArray(s.links) ? s.links.filter(isRec) : []) {
    const from = str(l.from);
    const to = str(l.to);
    if (from === null || to === null) continue;
    // The edge's Bernoulli: any change to p changes which samples then draw a strength.
    linkKeys.push(`${from}->${to}@${typeof l.exists_probability === 'number' ? l.exists_probability : 'default'}`);
    if (isZero(l.mean)) zeroKeys.push(`l:${from}->${to}`);
  }
  const sorted = (a: string[]) => [...a].sort();
  return JSON.stringify({
    v: s.snapshot_version ?? null,
    options: sorted(optionIds),
    settings: sorted(settingKeys),
    factors: sorted(factorIds),
    links: sorted(linkKeys),
    zero: sorted(zeroKeys),
  });
}

/** The draw-structure key of a Run fact's recorded input, or null for a Run that recorded none (legacy). */
export function drawStructureKeyOfFact(fact: HandlerFact): string | null {
  const result = (fact as { result?: unknown }).result;
  return isRec(result) && isRec(result.input_snapshot) ? drawStructureKey(result.input_snapshot as unknown as RunInputSnapshot) : null;
}
