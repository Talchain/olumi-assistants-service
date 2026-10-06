/**
 * SC-24 — WHAT DIFFERED IN THE INPUTS between two Runs, diffed from their recorded `input_snapshot`s
 * (`@talchain/schemas` 0.68.0 `RunDeltaInputChangeSchema`).
 *
 * ⭐ INDEPENDENT OF ATTRIBUTION. This says what the two Runs were SENT differently; `attribution_case` says whether
 * the pair licenses a causal reading of the outcome. A C2 pair still had £59 → £60 as its input.
 *
 * PRODUCER ORDER (the UI shows the first two rows, then "all N"): option settings (the edit a person usually made),
 * options added to / dropped from the comparison, factor values, the goal, limits, links. Within a kind: by id.
 *
 * RULES
 *   - A row carries AUTHORED figures only (`raw` + `unit`, the user's units). A consumer prints `raw` verbatim as the
 *     user's figure, so the number PLoT received (`encoded`) never enters a row (AIQ + P0 SHARED DATA on #2378).
 *   - A sent input that changed but cannot be stated that way (an end with no authored figure, any of a link's
 *     engine numbers — mean, spread, existence probability — a goal/limit frame, a baseline flag, a limit's node) is
 *     NOT a row: it makes the diff
 *     INCOMPLETE, and the delta says `input_coverage: 'partial'` — never "complete" over a change it could not show.
 *   - A label-only difference is never a row; a unit difference is. (0.68 carries no `kind` on a Run setting or row.)
 *   - Equal authored figures whose SENT number differs (£59 both ends, 0.4 → 0.5 dispatched) is unexpressed → partial.
 *   - A stated RANGE (TEMPORAL, 0.68 `range`) that differs between the Runs — added, removed or moved — has no row kind:
 *     it is unexpressed → partial (UNDO 5918366712, AIQ 5918201688).
 *   - A status-quo setting CEE HELD at the factor's current value on BOTH Runs is not an option edit — the factor-value
 *     row already says what moved.
 *   - Nothing here computes a delta: rows carry both ends, and a consumer shows before → after.
 */

import type { RunDeltaInputChange } from '@talchain/schemas/boundary';
import type { RunInputSnapshot } from '@talchain/schemas/orchestrator';
import { olumiSpreadForMean } from '../../cee/magnitude/olumi-spread.js';
import { edgeBandFromStrengthBand, edgeBandStd } from '../format/edge-strength-bands.js';
import { valueWriteAuthorshipDigests } from '../tools/handlers/run-input-residual.js';

type Value = { raw: number | string | boolean; unit?: string };
type Row = RunDeltaInputChange;

const valueOf = (raw: number | string | boolean | undefined, unit: string | undefined): Value | null =>
  raw === undefined ? null : unit !== undefined ? { raw, unit } : { raw };

type Sent = { raw?: number | string | boolean; unit?: string; encoded?: number };
const sameSent = (a: Sent, b: Sent): boolean =>
  a.raw === b.raw && a.unit === b.unit && a.encoded === b.encoded;

/**
 * The two ends as AUTHORED values, or `'unexpressed'` when the ends differ in what was sent but at least one end has
 * no authored figure to show (so no honest row exists).
 */
function authoredPair(a: Sent | undefined, b: Sent | undefined): [Value | null, Value | null] | 'unexpressed' {
  if (a !== undefined && b !== undefined) {
    if (a.raw !== undefined && b.raw !== undefined) {
      // The same authored figure on both ends but a different number SENT: no honest row states that (P0 SHARED DATA
      // 5918159419) — unexpressed, so the pair is partial.
      if (a.raw === b.raw && a.unit === b.unit && a.encoded !== b.encoded) return 'unexpressed';
      return [valueOf(a.raw, a.unit), valueOf(b.raw, b.unit)];
    }
    return sameSent(a, b) ? [null, null] : 'unexpressed';
  }
  const one = a ?? b;
  if (one === undefined) return [null, null];
  if (one.raw === undefined) return 'unexpressed';
  return a !== undefined ? [valueOf(a.raw, a.unit), null] : [null, valueOf(b!.raw, b!.unit)];
}

const same = (a: Value | null, b: Value | null): boolean =>
  a === null || b === null ? a === b : a.raw === b.raw && a.unit === b.unit;

function changeRow(base: Omit<Row, 'before' | 'after' | 'change'>, before: Value | null, after: Value | null): Row | null {
  if (before === null && after === null) return null;
  const change = before === null ? 'added' : after === null ? 'removed' : 'changed';
  if (change === 'changed' && same(before, after)) return null;
  return {
    ...base,
    before,
    after,
    change,
  } as Row;
}

const byId = <T,>(rows: readonly T[], id: (r: T) => string): Map<string, T> => new Map(rows.map((r) => [id(r), r]));
const unionIds = (a: Map<string, unknown>, b: Map<string, unknown>): string[] => [...new Set([...a.keys(), ...b.keys()])].sort();
const labels = (a?: string, b?: string) => ({
  ...(a !== undefined ? { label_before: a } : {}),
  ...(b !== undefined ? { label_after: b } : {}),
});

/** The rows only — see {@link diffRunInputs} for whether they are the whole difference. */
export function diffRunInputSnapshots(prior: RunInputSnapshot, current: RunInputSnapshot): Row[] {
  return diffRunInputs(prior, current).rows;
}

const sameNumber = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a));

/**
 * A link's new spread is EXPLAINED by its band move only when it is exactly a spread CEE's own writer derives for that
 * move (`adjust-edge-strength.ts`): the TYPED band's own spread (`edgeBandStd` of the band the link moved into — the
 * user named a band; DL ruling #2482 r3 P1-1), or, for an exact figure, Olumi's spread carried to the new mean
 * (`olumiSpreadForMean` from the prior Run's mean and spread). Anything else — another stated spread, a spread on one
 * Run only — is a change no row states.
 */
function spreadFollowsBand(prior: { mean: number; std?: number }, current: { mean: number; std?: number; band?: RunInputSnapshot['links'][number]['band'] }): boolean {
  if (prior.std === current.std) return true;
  if (prior.std === undefined || current.std === undefined) return false;
  if (current.band !== undefined && sameNumber(edgeBandStd(edgeBandFromStrengthBand(current.band)), current.std)) return true;
  return sameNumber(olumiSpreadForMean({ oldMean: prior.mean, oldStd: prior.std, newMean: current.mean }), current.std);
}

/**
 * 0.72.0 (DL ruling #2482 r3, option A) — is a change in a link's AUTHORSHIP (`authorship_digest`) the one a `sizing`
 * row states? Only two writers move authorship as part of an edit the pair shows: the user's own write (the link is now
 * `user`) and the Accept (Olumi's `placeholder` → `olumi_accepted`). Any other authorship change — a source moving
 * inside one sizing class (CODEX r2), a digest on one Run only — is unexplained.
 */
function authorshipExplained(prior: { sizing?: string; authorship_digest?: string }, current: { sizing?: string; authorship_digest?: string }): boolean {
  if (prior.authorship_digest === current.authorship_digest) return true;
  if (prior.authorship_digest === undefined || current.authorship_digest === undefined) return false;
  if (prior.sizing === undefined || current.sizing === undefined || prior.sizing === current.sizing) return false;
  return current.sizing === 'user' || (prior.sizing === 'placeholder' && current.sizing === 'olumi_accepted');
}

/**
 * 0.73.0 (F1b lease #85 5945475375) — is a change in a factor's AUTHORSHIP (`authorship_digest`) explained? Only when BOTH
 * hold: that factor's own value row moved, AND its current authorship is exactly what CEE's value writer leaves after
 * writing a figure (`valueWriteAuthorshipDigests`: a typed figure or an approved adoption). Same-factor identity alone
 * proves nothing (CODEX on 4c043a64 P1-2: an independent `extractionType` change beside a value write). Alone — a source
 * moving at the same figure (CODEX r2), a digest on one Run only, a colleague's apply — it is unexplained.
 */
function factorAuthorshipExplained(
  prior: { authorship_digest?: string },
  current: { authorship_digest?: string; source?: string },
  pair: ReturnType<typeof authoredPair>,
): boolean {
  if (prior.authorship_digest === current.authorship_digest) return true;
  if (prior.authorship_digest === undefined || current.authorship_digest === undefined) return false;
  if (pair === 'unexpressed' || pair[0] === null || pair[1] === null || same(pair[0], pair[1])) return false;
  return current.source !== undefined && valueWriteAuthorshipDigests(current.source).includes(current.authorship_digest);
}

/**
 * ⭐ SD-1 INTERIM (DL 0df0e1 ruling, 6 Oct, cut 5): a link whose size moved INSIDE one band between two Runs. No row can
 * state it (the contract's `strength` row is a band literal; `effect` lands with schemas 0.78 in cut 6), so the pair is
 * `partial` (`diffRunInputs` below). This list lets S7 NAME the link while coverage stays partial; it never rides the wire.
 * Read from the two Runs' OWN persisted input snapshots (each Run's `mean` and `band`), never the current graph.
 * - Counted: the link is in both Runs, both record a band and it is the same band, the sign is the same, the mean differs.
 *   (A band move is a `strength` row; a sign flip is a direction change this sentence must not call a size change.)
 * - `author` picks S7's words (c6's three lines):
 *   - `user`: the pair's persisted record shows the USER wrote this link between the two Runs: user-sized now
 *     (`sizing: 'user'`) AND its authorship (`authorship_digest`) differs between the Runs. A move on a user-sized link that
 *     kept its authorship is not one (DL: "you changed" only on a user write);
 *   - `olumi`: Olumi-sized now (`olumi_estimate`, `olumi_accepted`, `placeholder`), so the figure is said to be Olumi's;
 *   - `unknown`: anything else (no user write recorded, `unmarked`, sizing not recorded): no author is claimed.
 */
export interface WithinBandLinkMove {
  readonly from: string;
  readonly to: string;
  readonly band: NonNullable<RunInputSnapshot['links'][number]['band']>;
  readonly author: 'user' | 'olumi' | 'unknown';
}

const OLUMI_SIZED: ReadonlySet<string> = new Set(['olumi_estimate', 'olumi_accepted', 'placeholder']);

export function linksMovedWithinBand(prior: RunInputSnapshot, current: RunInputSnapshot): WithinBandLinkMove[] {
  const key = (l: { from: string; to: string }) => `${l.from}->${l.to}`;
  const pL = byId(prior.links, key);
  const cL = byId(current.links, key);
  const out: WithinBandLinkMove[] = [];
  for (const id of [...cL.keys()].sort()) {
    const pl = pL.get(id);
    const cl = cL.get(id)!;
    if (pl === undefined || pl.band === undefined || cl.band === undefined || pl.band !== cl.band) continue;
    if (pl.mean === cl.mean || Math.sign(pl.mean) !== Math.sign(cl.mean)) continue;
    const userWrite = cl.sizing === 'user'
      && pl.authorship_digest !== undefined && cl.authorship_digest !== undefined && pl.authorship_digest !== cl.authorship_digest;
    const author = userWrite ? 'user' : cl.sizing !== undefined && OLUMI_SIZED.has(cl.sizing) ? 'olumi' : 'unknown';
    out.push({ from: cl.from, to: cl.to, band: cl.band, author });
  }
  return out;
}

/** The rows, and `complete: false` when a sent input changed that no row states. */
export function diffRunInputs(prior: RunInputSnapshot, current: RunInputSnapshot): { rows: Row[]; complete: boolean } {
  const rows: Row[] = [];
  // ⭐ 0.71.0 — `complete` means VERIFIED (DL ruling #2482 5939864517): the rows below can only speak for the fields the
  // snapshots record, so the pair is complete only when every OTHER analysis input is proven unchanged — both Runs
  // carry a residual digest (`run-input-residual.ts`) and they are equal. An older Run without one is never complete.
  let complete =
    prior.residual_digest !== undefined && current.residual_digest !== undefined && prior.residual_digest === current.residual_digest;
  const push = (r: Row | null) => {
    if (r !== null) rows.push(r);
  };
  const pushPair = (base: Omit<Row, 'before' | 'after' | 'change'>, pair: ReturnType<typeof authoredPair>) => {
    if (pair === 'unexpressed') { complete = false; return; }
    push(changeRow(base, pair[0], pair[1]));
  };

  // ── option settings, for options on both Runs ─────────────────────────────
  const pOpts = byId(prior.options, (o) => o.option_id);
  const cOpts = byId(current.options, (o) => o.option_id);
  for (const optionId of unionIds(pOpts, cOpts)) {
    const p = pOpts.get(optionId);
    const c = cOpts.get(optionId);
    if (p === undefined || c === undefined) continue; // presence rows below
    const pSet = byId(p.settings, (s) => s.factor_id);
    const cSet = byId(c.settings, (s) => s.factor_id);
    for (const factorId of unionIds(pSet, cSet)) {
      const ps = pSet.get(factorId);
      const cs = cSet.get(factorId);
      // The range's VALUE (low, high, meaning); its author alone differing is not an input change (as a factor's `source`).
      const rangeOf = (x: typeof ps) => (x?.range === undefined ? null : [x.range.low, x.range.high, x.range.meaning]);
      if (ps !== undefined && cs !== undefined && JSON.stringify(rangeOf(ps)) !== JSON.stringify(rangeOf(cs))) complete = false;
      if (ps?.held === true && cs?.held === true) continue;
      pushPair(
        { entity_kind: 'option_setting', entity_id: factorId, option_id: optionId, field: 'value', ...labels(ps?.label, cs?.label) },
        authoredPair(ps, cs),
      );
    }
    if ((p.is_baseline === true) !== (c.is_baseline === true)) complete = false;
  }

  // ── options entering / leaving the comparison ─────────────────────────────
  for (const optionId of unionIds(pOpts, cOpts)) {
    const p = pOpts.get(optionId);
    const c = cOpts.get(optionId);
    if (p !== undefined && c !== undefined) continue;
    push(changeRow(
      { entity_kind: 'option', entity_id: optionId, field: 'presence', ...labels(p?.label, c?.label) },
      p === undefined ? null : { raw: true },
      c === undefined ? null : { raw: true },
    ));
  }

  // ── factor values ─────────────────────────────────────────────────────────
  const pF = byId(prior.factors, (f) => f.factor_id);
  const cF = byId(current.factors, (f) => f.factor_id);
  for (const factorId of unionIds(pF, cF)) {
    const pf = pF.get(factorId);
    const cf = cF.get(factorId);
    const pair = authoredPair(pf, cf);
    pushPair({ entity_kind: 'factor_value', entity_id: factorId, field: 'value', ...labels(pf?.label, cf?.label) }, pair);
    if (pf !== undefined && cf !== undefined && !factorAuthorshipExplained(pf, cf, pair)) complete = false;
  }

  // ── the goal ──────────────────────────────────────────────────────────────
  const pg = prior.goal;
  const cg = current.goal;
  if (pg !== null || cg !== null) {
    if (pg !== null && cg !== null && pg.node_id === cg.node_id) {
      const base = { entity_kind: 'goal' as const, entity_id: cg.node_id, ...labels(pg.label, cg.label) };
      const v = (raw: number | string | undefined): Value | null => (raw === undefined ? null : { raw });
      push(changeRow({ ...base, field: 'target' }, pg.target_raw !== undefined ? valueOf(pg.target_raw, pg.unit) : null,
        cg.target_raw !== undefined ? valueOf(cg.target_raw, cg.unit) : null));
      if (pg.frame !== cg.frame) complete = false;
      // A unit-only edit (AIQ 5912905493) is its own row even when the target number is unchanged.
      push(changeRow({ ...base, field: 'unit' }, v(pg.unit), v(cg.unit)));
      push(changeRow({ ...base, field: 'operator' }, v(pg.operator), v(cg.operator)));
      push(changeRow({ ...base, field: 'direction' }, v(pg.direction), v(cg.direction)));
    } else {
      // A different goal node: the old goal left, the new one arrived.
      if (pg !== null) push(changeRow({ entity_kind: 'goal', entity_id: pg.node_id, field: 'presence', ...labels(pg.label, undefined) }, { raw: true }, null));
      if (cg !== null) push(changeRow({ entity_kind: 'goal', entity_id: cg.node_id, field: 'presence', ...labels(undefined, cg.label) }, null, { raw: true }));
    }
  }

  // ── limits ────────────────────────────────────────────────────────────────
  const pC = byId(prior.constraints, (c) => c.constraint_id);
  const cC = byId(current.constraints, (c) => c.constraint_id);
  for (const id of unionIds(pC, cC)) {
    const pc = pC.get(id);
    const cc = cC.get(id);
    const base = { entity_kind: 'constraint' as const, entity_id: id, ...labels(pc?.label, cc?.label) };
    push(changeRow({ ...base, field: 'target' }, pc ? valueOf(pc.raw, pc.unit) : null, cc ? valueOf(cc.raw, cc.unit) : null));
    if (pc !== undefined && cc !== undefined) {
      push(changeRow({ ...base, field: 'operator' }, { raw: pc.operator }, { raw: cc.operator }));
      if (pc.node_id !== cc.node_id || pc.frame !== cc.frame) complete = false;
    }
  }

  // ── links ─────────────────────────────────────────────────────────────────
  const key = (l: { from: string; to: string }) => `${l.from}->${l.to}`;
  const pL = byId(prior.links, key);
  const cL = byId(current.links, key);
  for (const id of unionIds(pL, cL)) {
    const pl = pL.get(id);
    const cl = cL.get(id);
    const ends = (pl ?? cl) as { from: string; to: string };
    if (pl === undefined || cl === undefined) {
      // A link entered or left the model: a PRESENCE row, with no figure (the same marker an option's presence uses).
      push(changeRow(
        { entity_kind: 'link', entity_id: id, link: { from: ends.from, to: ends.to }, field: 'presence' },
        pl ? { raw: true } : null,
        cl ? { raw: true } : null,
      ));
      continue;
    }
    // A link's mean, spread and existence probability are the ENGINE's numbers on the model scale — the user never
    // wrote them and they carry no unit. None is a row figure (AIQ 5918134795, the class rule already applied to
    // `encoded`).
    // ⭐ 0.70.0 (R3 DEFECT 3; DL 5937207590): each Run also records the link in the user's terms, and those ARE rows:
    //   - its BAND moving (`moderate` → `strong`) is a `strength` row, raw = the contract's band literals; the engine
    //     numbers that moved with it (mean, and the spread that follows the band) are what that row states;
    //   - WHO SIZED it changing (`placeholder` → `olumi_accepted`: the user accepted Olumi's estimate, no number moved)
    //     is a `sizing` row.
    // Still partial, never a row: a mean/spread move INSIDE one band (or with a band unrecorded on either Run), any
    // existence-probability move, and sizing recorded on one Run only (whether it changed cannot be known).
    const linkBase = { entity_kind: 'link' as const, entity_id: id, link: { from: ends.from, to: ends.to } };
    const bandMoved = pl.band !== undefined && cl.band !== undefined && pl.band !== cl.band;
    if (bandMoved) push(changeRow({ ...linkBase, field: 'strength' }, { raw: pl.band! }, { raw: cl.band! }));
    if (pl.sizing !== undefined && cl.sizing !== undefined) {
      if (pl.sizing !== cl.sizing) push(changeRow({ ...linkBase, field: 'sizing' }, { raw: pl.sizing }, { raw: cl.sizing }));
    } else if (pl.sizing !== cl.sizing) {
      complete = false;
    }
    // A band row states the move of the MEAN and nothing else (DL ruling #2482, P1 #1): the band never absorbs a sign
    // flip or a spread the move does not explain. Either is a change no row states → partial.
    if (pl.mean !== cl.mean && !bandMoved) complete = false;
    if (Math.sign(pl.mean) !== Math.sign(cl.mean)) complete = false;
    if (!(bandMoved ? spreadFollowsBand(pl, cl) : pl.std === cl.std)) complete = false;
    if (pl.exists_probability !== cl.exists_probability) complete = false;
    if (!authorshipExplained(pl, cl)) complete = false;
  }

  return { rows, complete };
}
