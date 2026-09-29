/**
 * ⭐ FRAME INVARIANCE ORACLE (AIQ 5895140735; R3 5893508312 / 5894964169): a frame is a choice of units, so re-framing
 * a node must change NOTHING the user sees in natural units, except that a cut disappears.
 *
 * `frameInvariance(before, after)` lists every violation between two graphs (an empty list means the re-frame is sound):
 *   · natural_size_moved: a link's implied natural size β·F_to/F_from (or its natural σ) changed. This covers DEFAULT
 *     links too (AIQ 5895140735 (2)), not only links with a `natural_effect`;
 *   · beta_out_of_contract: |β| > 1 after the re-frame (a new cut, so the re-frame must be refused);
 *   · natural_effect_off: a stated size no longer reads back exactly, or its `strength_mean` is stale;
 *   · level_moved: a node's raw level, or the goal's raw target, changed, or a normalised value no longer equals raw/F;
 *   · spread_moved: a factor's sampled spread in natural units changed (PLoT's default is max(0.1, 0.15·value) on the
 *     FRAME, `translator-v3.ts` `buildParameterUncertaintiesV3`; a user-stated level is sent at 1e-4; a std is clamped to
 *     [1e-4, 2.0], so a carried spread that binds moves and the re-frame must be refused, R3-B 5895208669).
 *   · bounded_scale (AIQ 5895590866 (1)): a frame widened past a bounded unit's natural top ("out of 5" → 10);
 *   · frame_below_level (design R3): a frame below the node's own level or an option's value for it (normalised > 1);
 *   · level_moved <option>→<factor> (intervention): an option's value for a re-framed factor no longer reads back raw.
 *   A synthesised spread on PLoT's 0.1 floor (0.15·|value| < 0.1) at either frame is reported `(floor-bound)`: AIQ
 *   5895379601 (2) refuses those re-frames rather than minting a std.
 *
 * `reframe(graph, nodeId, F)` is the REFERENCE re-framer for AIQ's rule. It keeps every touching link's natural size,
 * rescales an EXISTING std only (marked with its original owner) and never mints one, carries every option's value for
 * the node, and rewrites the goal's normalised threshold. A floor-bound spread therefore moves and is refused (AIQ 5895379601). MG's
 * builder must produce a graph the oracle accepts; its exact numbers can be checked against this one.
 */
type Rec = Record<string, any>;

const TOL = 1e-9;
const close = (a: number, b: number): boolean => Math.abs(a - b) <= TOL * Math.max(1, Math.abs(a), Math.abs(b));
const above1 = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 1;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const STATED_TOL = 1e-4; // a stated natural_effect's amount is stored rounded to ~6 significant figures
const [MIN_STD, MAX_STD] = [1e-4, 2.0]; // `translator-v3.ts` `buildParameterUncertaintiesV3`: a std outside is clamped, so a carried spread that binds MOVES

/** The node's frame, in CEE's reading order (`resolveMagnitudeFrame`): scale_frame → cap → goal cap → raw/value. */
export function frameOf(n: Rec | undefined): number | undefined {
  if (n === undefined) return undefined;
  if (above1(n.scale_frame)) return n.scale_frame;
  const os = n.observed_state ?? {};
  if (above1(os.cap)) return os.cap;
  if (n.kind === 'goal' && above1(n.goal_threshold_cap)) return n.goal_threshold_cap;
  if (num(os.raw_value) && num(os.value) && os.value !== 0) {
    const f = os.raw_value / os.value;
    if (Number.isFinite(f) && f > 0) return f;
  }
  return undefined;
}

const usersLevel = (n: Rec): boolean => {
  const s = n.observed_state?.source;
  return s === 'brief_extraction' || (typeof s === 'string' && s.startsWith('user'));
};

/** The sampled spread PLoT would send, in NATURAL units, for a factor (undefined when it is a point mass or n/a). */
export function naturalSpread(n: Rec): number | undefined {
  const os = n.observed_state;
  const F = frameOf(n);
  if (n.kind !== 'factor' || os === undefined || F === undefined || !num(os.value)) return undefined;
  if (num(os.std) && os.std > 0) return Math.min(MAX_STD, Math.max(MIN_STD, os.std)) * F; // PLoT clamps any std to [1e-4, 2.0]
  if (usersLevel(n)) return 0; // CEE sends a stated level at 1e-4 on its frame: EXACT as stated, on any frame
  if (os.value === 0) return undefined; // held exact, or scaled by option levels (frame-free)
  return Math.max(0.1, 0.15 * Math.abs(os.value)) * F;
}

const interventionsOn = (g: Rec, id: string): [string, Rec][] =>
  (g.nodes ?? []).flatMap((o: Rec) => (o.interventions?.[id] ? [[o.id, o.interventions[id]] as [string, Rec]] : []));
/** The natural top of a BOUNDED unit (AIQ 5895590866 (1)): "out of N", ratings/stars, a share in %, a fixed-end index. */
export function naturalTop(n: Rec | undefined): number | undefined {
  const u = String(n?.observed_state?.unit ?? n?.unit ?? '').toLowerCase().trim();
  const outOf = /out of\s*(\d+(?:\.\d+)?)/.exec(u);
  if (outOf) return Number(outOf[1]);
  if (/\b(stars?|rating)\b/.test(u)) return 5;
  if (/\bnps\b/.test(u)) return 100;
  if (/^(%|percent|percentage)$/.test(u)) return 100; // a share or probability; a % CHANGE is not bounded
  return undefined;
}
const byId = (g: Rec): Map<string, Rec> => new Map((g.nodes ?? []).map((n: Rec) => [n.id, n]));
const edgeKey = (e: Rec): string => `${e.from}→${e.to}`;
const meanOf = (e: Rec): number | undefined => (num(e.strength?.mean) ? e.strength.mean : num(e.strength_mean) ? e.strength_mean : undefined);
const stdOf = (e: Rec): number | undefined => (num(e.strength?.std) ? e.strength.std : undefined);

/** Every violation of frame invariance between `before` and `after` (the same graph, re-framed). */
export function frameInvariance(before: Rec, after: Rec): string[] {
  const out: string[] = [];
  const nb = byId(before);
  const na = byId(after);
  const edgesAfter = new Map<string, Rec>((after.edges ?? []).map((e: Rec) => [edgeKey(e), e]));
  for (const eb of before.edges ?? []) {
    const ea = edgesAfter.get(edgeKey(eb));
    if (ea === undefined) { out.push(`edge_missing ${edgeKey(eb)}`); continue; }
    const [fsb, ftb, fsa, fta] = [frameOf(nb.get(eb.from)), frameOf(nb.get(eb.to)), frameOf(na.get(eb.from)), frameOf(na.get(eb.to))];
    if ([fsb, ftb, fsa, fta].some((f) => f === undefined)) continue; // a structural edge (decision/option): no natural size
    const [mb, ma] = [meanOf(eb), meanOf(ea)];
    if (mb !== undefined && ma !== undefined && !close((mb * ftb!) / fsb!, (ma * fta!) / fsa!)) {
      out.push(`natural_size_moved ${edgeKey(eb)} ${((mb * ftb!) / fsb!).toPrecision(6)} → ${((ma * fta!) / fsa!).toPrecision(6)}`);
    }
    const [sb, sa] = [stdOf(eb), stdOf(ea)];
    if (sb !== undefined && sa !== undefined && !close((sb * ftb!) / fsb!, (sa * fta!) / fsa!)) out.push(`natural_size_moved(σ) ${edgeKey(eb)}`);
  }
  for (const ea of after.edges ?? []) {
    const m = meanOf(ea);
    if (m === undefined || frameOf(na.get(ea.from)) === undefined || frameOf(na.get(ea.to)) === undefined) continue;
    if (Math.abs(m) > 1 + TOL) out.push(`beta_out_of_contract ${edgeKey(ea)} ${m.toPrecision(4)}`);
    const ne = ea.provenance?.natural_effect;
    if (ne && num(ne.amount) && num(ne.per_source_change) && ne.per_source_change !== 0) {
      const size = (m * frameOf(na.get(ea.to))!) / frameOf(na.get(ea.from))!;
      const stated = ne.amount / ne.per_source_change; // stored rounded (66,666.7 per 4): a readback within 1e-4 is exact
      if (Math.abs(size - stated) > STATED_TOL * Math.max(Math.abs(stated), 1e-12) || (num(ne.strength_mean) && !close(ne.strength_mean, m))) out.push(`natural_effect_off ${edgeKey(ea)}`);
    }
  }
  for (const [id, a] of na) {
    const F = frameOf(a);
    if (F === undefined) continue;
    const levels = [a.observed_state?.raw_value, ...interventionsOn(after, id).map(([, iv]) => iv.raw_value)].filter(num).map(Math.abs);
    const top = Math.max(0, ...levels);
    if (top > F * (1 + TOL)) out.push(`frame_below_level ${id} ${F} < ${top}`);
  }
  for (const [id, a] of na) { // a bounded scale's top is NEVER widened (AIQ 5895590866 (1))
    const [top, Fb, Fa] = [naturalTop(a), frameOf(nb.get(id)), frameOf(a)];
    if (top !== undefined && Fb !== undefined && Fa !== undefined && Fa > Fb * (1 + TOL) && Fa > top * (1 + TOL)) out.push(`bounded_scale ${id} ${Fb} → ${Fa} (top ${top})`);
  }
  for (const o of after.nodes ?? []) {
    for (const [fid, iv] of Object.entries<Rec>(o.interventions ?? {})) {
      const F = frameOf(na.get(fid));
      const ivb = nb.get(o.id)?.interventions?.[fid];
      if (num(ivb?.raw_value) && (!num(iv?.raw_value) || !close(ivb.raw_value, iv.raw_value))) out.push(`level_moved ${o.id}→${fid} (intervention)`);
      else if (F !== undefined && num(iv?.value) && num(iv?.raw_value) && !close(iv.value * F, iv.raw_value)) out.push(`level_moved ${o.id}→${fid} (intervention ≠ raw/F)`);
    }
  }
  for (const [id, a] of na) {
    const b = nb.get(id);
    if (b === undefined) continue;
    const [rb, ra] = [b.observed_state?.raw_value, a.observed_state?.raw_value];
    if (num(rb) && (!num(ra) || !close(rb, ra))) out.push(`level_moved ${id}`);
    const F = frameOf(a);
    if (num(ra) && num(a.observed_state?.value) && F !== undefined && !close(a.observed_state.value * F, ra)) out.push(`level_moved ${id} (value ≠ raw/F)`);
    if (a.kind === 'goal' && num(b.goal_threshold_raw)) {
      if (!num(a.goal_threshold_raw) || !close(a.goal_threshold_raw, b.goal_threshold_raw)) out.push(`level_moved ${id} (target)`);
      if (a.goal_threshold_frame === 'change_rel') { // a relative change (−15%) is scale-free: it must not move at all
        if (num(b.goal_threshold) && (!num(a.goal_threshold) || !close(a.goal_threshold, b.goal_threshold))) out.push(`level_moved ${id} (relative target)`);
      } else if (num(a.goal_threshold) && F !== undefined && !close(a.goal_threshold * F, a.goal_threshold_raw)) out.push(`level_moved ${id} (goal_threshold ≠ raw/F)`);
    }
    const [spb, spa] = [naturalSpread(b), naturalSpread(a)];
    if (spb !== undefined && spa !== undefined && !close(spb, spa)) {
      const floor = [b, a].some((n) => !(num(n.observed_state?.std) && n.observed_state.std > 0) && 0.15 * Math.abs(n.observed_state.value) < 0.1);
      out.push(`spread_moved ${id} ${spb.toPrecision(4)} → ${spa.toPrecision(4)}${floor ? ' (floor-bound)' : ''}`);
    }
  }
  return out;
}

/** The reference re-framer (AIQ 5895140735): node `id` moves to frame `F`; nothing moves in natural units. Pure. */
export function reframe(graph: Rec, id: string, F: number): Rec {
  const g: Rec = JSON.parse(JSON.stringify(graph));
  const node = (g.nodes as Rec[]).find((n) => n.id === id);
  const Fold = frameOf(node);
  if (node === undefined || Fold === undefined) throw new Error(`reframe: ${id} has no frame`);
  const k = Fold / F; // normalised values scale by Fold/F
  const spreadBefore = naturalSpread(node);
  const os = node.observed_state ?? (node.observed_state = {});
  if (num(os.value)) os.value = os.value * k;
  if (num(os.baseline)) os.baseline = os.baseline * k;
  if (above1(node.scale_frame)) node.scale_frame = F; else os.cap = F;
  if (node.kind === 'goal') {
    node.goal_threshold_cap = F;
    if (num(node.goal_threshold) && node.goal_threshold_frame !== 'change_rel') node.goal_threshold = node.goal_threshold * k; // a relative change is scale-free
  }
  // AIQ 5895379601 (2) × R3-B 5895208669: rescale an EXISTING std only, and mark it with its ORIGINAL owner (a user's stays
  // `user`; Olumi's → ISL `template`). NEVER mint one: a floor-bound synthesised spread moves, so the oracle refuses it.
  if (num(os.std) && os.std > 0 && spreadBefore !== undefined) {
    os.std = spreadBefore / F;
    os.std_source ??= usersLevel(node) ? 'user' : 'olumi';
  }
  for (const o of g.nodes as Rec[]) { const iv = o.interventions?.[id]; if (iv && num(iv.value)) iv.value = iv.value * k; } // an option's value for it
  const nodes = byId(g);
  for (const e of g.edges as Rec[]) {
    const scale = e.from === id ? F / Fold : e.to === id ? Fold / F : 1; // β·F_to/F_from held
    if (scale === 1) continue;
    if (frameOf(nodes.get(e.from === id ? e.to : e.from)) === undefined) continue; // structural (decision/option) edge
    if (num(e.strength?.mean)) e.strength.mean *= scale;
    if (num(e.strength?.std)) e.strength.std *= scale;
    if (num(e.provenance?.natural_effect?.strength_mean)) e.provenance.natural_effect.strength_mean *= scale;
  }
  return g;
}
