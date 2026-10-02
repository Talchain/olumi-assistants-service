/**
 * 0.71.0 — THE RESIDUAL: every input a Run sent PLoT that its input snapshot does NOT record, digested
 * (`RunInputSnapshot.residual_digest`; DL ruling on CEE #2482 5939864517: `complete` means VERIFIED).
 *
 * WHY. A diff of the recorded fields says nothing about the fields it does not record. CODEX overflow on #2482 changed
 * a factor's σ and an encoded goal threshold — neither recorded — and the pair read `input_coverage: 'complete'` with
 * no row. Listing more fields one by one leaves the next one open; this closes the class: two Runs with equal residuals
 * were sent the same value for every input outside the snapshot.
 *
 * WHAT IS DIGESTED: THE WHOLE REQUEST PLoT RECEIVED (graph, options, goal, limits, every other member), minus only the
 * request id and the seed (a pairing matter, C1). Not the freshness vocabulary: PLoT reads members that vocabulary
 * leaves out — `observed_state.std_source` (spread ownership) and node labels (its binary classifier's synthesised σ)
 * among them (CODEX pre-review on r2) — so nothing is assumed cosmetic.
 *
 * ⭐ THE STRIP RULE — a member is removed only when BOTH hold:
 *   (a) the snapshot recorded EXACTLY its value (same member, same value), and
 *   (b) the diff (`coaching/run-input-changes.ts`) compares that recorded value, so a change to it is a row or `partial`.
 * A member recorded but not compared (a label; a factor's `source`; a held status-quo setting) STAYS in the residual.
 * Named exceptions, each recoverable from what IS recorded and compared:
 *   1. a SENT option's intervention objects on its graph node: PLoT normalises them away and filters option nodes; it
 *      computes on the request's options, whose numbers the snapshot records and compares per factor;
 *   2. a recorded link's AUTHORSHIP members (exactly {@link LINK_AUTHORSHIP_MEMBERS}): 0.72.0 records them as the link's
 *      `authorship_digest`, and the diff decides pairwise whether a change is the one a `sizing` row states (DL ruling
 *      #2482 r3, option A);
 *   3. REVIEW METADATA (`reviewed_by_user`), removed identically on every node and from every recorded link's authorship:
 *      a review is not an analysis input (graph-hash vocabulary, R11); a link review's only analysis meaning, a confirm on
 *      Olumi's size, is the `olumi_accepted` sizing the snapshot records (DL ruling #2482 r3 P1-2);
 *   4. a recorded factor's AUTHORSHIP members (exactly {@link FACTOR_AUTHORSHIP_MEMBERS}, plus `observed_state.std` only
 *      where THIS Run's stated-level carry set it): 0.73.0 records them as the factor's `authorship_digest`, and the diff
 *      credits a change only when that factor's value row moved AND the current authorship is exactly what CEE's value
 *      writer produces (F1b lease #85 5945475375; served 5945463610: a user's value edit read `partial`).
 *
 * Pure.
 */
import { createHash } from 'node:crypto';
import { STATED_LEVEL_STD } from './stated-level-spread.js';
import { APPROVED_ADOPTION_SOURCE } from '../../agent-lane/approved-adoption-context.js';
import { synthesiseDisplayValue } from '../../../cee/factor-extraction/display-value.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deterministic JSON: object keys sorted (the same rule `sentDigest` uses). */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isRec(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Remove `key` from `obj` only when it holds exactly `recorded` (strip rule (a); the caller owns (b)). */
function stripIfRecorded(obj: Rec, key: string, recorded: unknown): void {
  if (recorded !== undefined && obj[key] === recorded) delete obj[key];
}

/** What the snapshot recorded — only the members the strip rule reads (the builder's own values, before the parse). */
interface Recorded {
  readonly goal: { readonly node_id: string; readonly target_raw?: number; readonly unit?: string; readonly operator?: string; readonly frame?: string; readonly direction?: string } | null;
  readonly options: ReadonlyArray<{
    readonly option_id: string;
    readonly is_baseline?: true;
    readonly settings: ReadonlyArray<{ readonly factor_id: string; readonly encoded: number; readonly held?: true; readonly range?: { readonly low?: unknown; readonly high?: unknown; readonly meaning?: unknown } }>;
  }>;
  readonly factors: ReadonlyArray<{ readonly factor_id: string; readonly raw?: number | string; readonly unit?: string; readonly encoded?: number; readonly authorship_digest?: string }>;
  readonly constraints: ReadonlyArray<{ readonly constraint_id: string; readonly node_id: string; readonly operator: string; readonly raw: number; readonly unit?: string; readonly frame?: string }>;
  readonly links: ReadonlyArray<{ readonly from: string; readonly to: string; readonly mean: number; readonly std?: number; readonly exists_probability?: number; readonly sizing?: string; readonly authorship_digest?: string }>;
}

/** The members of a link's AUTHORSHIP (schemas 0.72.0 `authorship_digest`), in one place: the digest and the strip. */
export const LINK_AUTHORSHIP_MEMBERS = ['provenance', 'provenance_display', 'defaulted', 'exists_defaulted', 'std_defaulted'] as const;

/**
 * 0.72.0 — the canonical digest of a link's authorship as the request carried it: exactly {@link LINK_AUTHORSHIP_MEMBERS},
 * with review metadata (`provenance.reviewed_by_user`) removed, absent members as `null`, keys sorted.
 */
export function linkAuthorshipDigest(edge: Rec): string {
  const provenance = isRec(edge.provenance) ? (({ reviewed_by_user: _review, ...rest }) => rest)(edge.provenance) : edge.provenance;
  const canonical: Rec = {};
  for (const m of LINK_AUTHORSHIP_MEMBERS) canonical[m] = (m === 'provenance' ? provenance : edge[m]) ?? null;
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

/**
 * The members of a factor's AUTHORSHIP (schemas 0.73.0 `authorship_digest`), in one place: the digest and the strip.
 * MEASURED, not listed from memory: the real `factor_value_edit` writer → `run_analysis` wire (`run-input-residual.test`
 * F1) moves `observed_state.{source, extractionType}` and the node's `provenance` and `display_value`; `elicited_from` and
 * the node's `extractionType` are the same writer's other authorship carriers (`set-factor-value.ts`). The wire also adds
 * `observed_state.std` = {@link STATED_LEVEL_STD} where `carryStatedLevelSpread` sent a person's level exactly — a
 * member ONLY where this Run's carry set it (the caller passes those ids): a stored σ, even of exactly that number, is the
 * figure's own spread and stays in the residual (CODEX on 4c043a64 P1-1: numeric equality cannot prove the origin).
 */
export const FACTOR_AUTHORSHIP_MEMBERS = {
  observed_state: ['source', 'extractionType', 'elicited_from'],
  node: ['provenance', 'display_value', 'extractionType'],
} as const;

/** `set-factor-value.ts`'s stamp on a typed figure (`USER_EDIT_SOURCE`; pinned equal by `run-input-residual.test`). */
export const VALUE_WRITE_USER_SOURCE = 'user_override';

/**
 * Is this factor's authorship EXACTLY what CEE's value writer (`set-factor-value.ts`) leaves after writing its figure —
 * a typed figure (`user_override`, node `user_set`) or an approved adoption of Olumi's (`user_assumption`, node
 * `ai_inferred`): both extraction stamps and `elicited_from` cleared, and `display_value` recomputed from the figure by
 * `synthesiseDisplayValue` (the writer passes the edit's unit and cap only when the edit carried them: all four ways are
 * accepted). A colleague's verified apply carries `elicited_from` and is NOT matched (its pairs stay `partial`).
 */
function isValueWriteOutput(node: Rec): boolean {
  const os = isRec(node.observed_state) ? node.observed_state : {};
  const source = os.source;
  if (source !== VALUE_WRITE_USER_SOURCE && source !== APPROVED_ADOPTION_SOURCE) return false;
  if (os.extractionType !== undefined || node.extractionType !== undefined || os.elicited_from !== undefined) return false;
  if (node.provenance !== (source === APPROVED_ADOPTION_SOURCE ? 'ai_inferred' : 'user_set')) return false;
  const value = typeof os.value === 'number' && Number.isFinite(os.value) ? os.value : undefined;
  if (value === undefined) return false;
  const raw = typeof os.raw_value === 'number' && Number.isFinite(os.raw_value) ? os.raw_value : undefined;
  const factorType = typeof node.factor_type === 'string' ? node.factor_type : undefined;
  const units = [undefined, typeof os.unit === 'string' ? os.unit : undefined];
  const caps = [undefined, typeof os.cap === 'number' ? os.cap : undefined];
  const written = new Set(units.flatMap((unit) => caps.map((cap) => synthesiseDisplayValue({
    value,
    ...(raw !== undefined ? { raw_value: raw } : {}),
    ...(unit !== undefined ? { unit } : {}),
    ...(factorType !== undefined ? { factor_type: factorType } : {}),
    ...(cap !== undefined ? { cap } : {}),
  }))));
  return written.has(node.display_value as string | undefined);
}

function authorshipDigestOf(canonical: Rec): string {
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

/**
 * 0.73.0 — the canonical digest of a factor's authorship as the request carried it: `source`, whether THIS Run's
 * stated-level carry set its σ, and either the token `value_write` (the rest is exactly the value writer's output —
 * {@link isValueWriteOutput}) or every other {@link FACTOR_AUTHORSHIP_MEMBERS} member as sent (absent → `null`).
 * Review metadata is never a member.
 */
export function factorAuthorshipDigest(node: Rec, statedLevelCarried: boolean): string {
  const os = isRec(node.observed_state) ? node.observed_state : {};
  const rest: Rec = {};
  for (const m of FACTOR_AUTHORSHIP_MEMBERS.observed_state) if (m !== 'source') rest[`observed_state.${m}`] = os[m] ?? null;
  for (const m of FACTOR_AUTHORSHIP_MEMBERS.node) rest[m] = node[m] ?? null;
  return authorshipDigestOf({
    source: os.source ?? null,
    stated_level_carry: statedLevelCarried,
    rest: isValueWriteOutput(node) ? 'value_write' : rest,
  });
}

/** The digests a factor whose authorship is exactly the value writer's output, with recorded `source`, can carry. */
export function valueWriteAuthorshipDigests(source: string): readonly string[] {
  return [true, false].map((carried) => authorshipDigestOf({ source, stated_level_carry: carried, rest: 'value_write' }));
}

/**
 * The residual digest of `plotPayload` given what the snapshot `recorded` from it. `null` when the request carries no
 * graph (the snapshot then records no residual, and its pairs are never `complete`).
 */
export function residualDigest(plotPayload: Rec, recorded: Recorded, statedLevelCarried: ReadonlySet<string> = new Set()): string | null {
  if (!isRec(plotPayload.graph)) return null;
  const { request_id: _requestId, seed: _seed, ...request } = structuredClone(plotPayload) as Rec;
  const graph = request.graph as Rec;

  const goal = recorded.goal;
  const factorById = new Map(recorded.factors.map((f) => [f.factor_id, f]));
  const optionById = new Map(recorded.options.map((o) => [o.option_id, o]));

  // ── nodes ─────────────────────────────────────────────────────────────────────────────────────────────────
  for (const n of Array.isArray(graph.nodes) ? graph.nodes : []) {
    if (!isRec(n) || typeof n.id !== 'string') continue;
    const id = n.id;
    // Exception 3: review metadata, identically on every node (a factor's `confirm_current` records only this).
    if (isRec(n.observed_state)) delete n.observed_state.reviewed_by_user;
    // A factor's value as the diff compares it (`authoredPair`: raw, unit, encoded).
    const f = goal?.node_id === id ? undefined : factorById.get(id);
    // Exception 4: the authorship members, only when the snapshot recorded THIS node's authorship digest. The diff then
    // decides pairwise (CODEX r2: the source moving from Olumi's inference to the user's own at the same value moves no
    // row, so it is unexplained there — `partial`).
    const carried = statedLevelCarried.has(id) && isRec(n.observed_state) && n.observed_state.std === STATED_LEVEL_STD;
    if (f?.authorship_digest !== undefined && f.authorship_digest === factorAuthorshipDigest(n, carried)) {
      const os = isRec(n.observed_state) ? n.observed_state : {};
      for (const m of FACTOR_AUTHORSHIP_MEMBERS.observed_state) delete os[m];
      for (const m of FACTOR_AUTHORSHIP_MEMBERS.node) delete n[m];
      if (carried) delete os.std;
    }
    if (f !== undefined && isRec(n.observed_state)) {
      const os = n.observed_state;
      stripIfRecorded(os, 'value', f.encoded);
      stripIfRecorded(os, typeof f.raw === 'number' ? 'raw_value' : 'display_value', f.raw);
      stripIfRecorded(os, 'unit', f.unit);
    }
    // The goal members the diff compares (target, unit, operator, frame). Its label stays.
    if (goal !== null && id === goal.node_id) {
      stripIfRecorded(n, 'goal_threshold_raw', goal.target_raw);
      stripIfRecorded(n, 'goal_threshold_unit', goal.unit);
      stripIfRecorded(n, 'goal_direction', goal.operator);
      stripIfRecorded(n, 'goal_threshold_frame', goal.frame);
    }
    // Exception 1 (header).
    if (optionById.has(id)) delete n.interventions;
  }

  // ── links ─────────────────────────────────────────────────────────────────────────────────────────────────
  const linkByKey = new Map(recorded.links.map((l) => [`${l.from}\u0000${l.to}`, l]));
  for (const e of Array.isArray(graph.edges) ? graph.edges : []) {
    if (!isRec(e)) continue;
    const l = linkByKey.get(`${String(e.from)}\u0000${String(e.to)}`);
    if (l === undefined) continue;
    if (isRec(e.strength)) {
      stripIfRecorded(e.strength, 'mean', l.mean);
      stripIfRecorded(e.strength, 'std', l.std);
    }
    stripIfRecorded(e, 'exists_probability', l.exists_probability);
    // Exceptions 2 + 3: the authorship members, only when the snapshot recorded THIS edge's authorship digest.
    if (l.authorship_digest !== undefined && l.authorship_digest === linkAuthorshipDigest(e)) {
      for (const m of LINK_AUTHORSHIP_MEMBERS) delete e[m];
    }
  }

  // ── the request's options ─────────────────────────────────────────────────────────────────────────────────
  for (const opt of Array.isArray(request.options) ? request.options : []) {
    if (!isRec(opt)) continue;
    const id = typeof opt.option_id === 'string' && opt.option_id.length > 0 ? opt.option_id : typeof opt.id === 'string' ? opt.id : '';
    const o = optionById.get(id);
    if (o === undefined) continue;
    // Identity (presence rows) and the baseline flag (compared) — each only as recorded. The label stays.
    stripIfRecorded(opt, 'option_id', o.option_id);
    stripIfRecorded(opt, 'id', o.option_id);
    stripIfRecorded(opt, 'is_baseline', o.is_baseline);
    const settings = new Map(o.settings.map((s) => [s.factor_id, s]));
    // A HELD status-quo number is not compared when held on both Runs (the factor row speaks for it), so it stays.
    if (isRec(opt.interventions)) {
      for (const [factorId, s] of settings) if (s.held !== true) stripIfRecorded(opt.interventions, factorId, s.encoded);
    }
    if (isRec(opt.intervention_ranges)) {
      for (const [factorId, s] of settings) {
        const r = opt.intervention_ranges[factorId];
        if (s.range === undefined || !isRec(r)) continue;
        stripIfRecorded(r, 'low', s.range.low);
        stripIfRecorded(r, 'high', s.range.high);
        stripIfRecorded(r, 'meaning', s.range.meaning);
      }
    }
  }

  // ── limits: each recorded limit's compared members (target + unit, operator, node, frame). Its label stays. ─
  const limitById = new Map(recorded.constraints.map((c) => [c.constraint_id, c]));
  for (const c of Array.isArray(request.goal_constraints) ? request.goal_constraints : []) {
    if (!isRec(c) || typeof c.constraint_id !== 'string') continue;
    const rc = limitById.get(c.constraint_id);
    if (rc === undefined) continue;
    delete c.constraint_id;
    stripIfRecorded(c, 'node_id', rc.node_id);
    stripIfRecorded(c, 'operator', rc.operator);
    stripIfRecorded(c, 'value', rc.raw);
    stripIfRecorded(c, 'unit', rc.unit);
    stripIfRecorded(c, 'value_frame', rc.frame);
  }

  // ── the goal's identity and the request's direction ───────────────────────────────────────────────────────
  if (goal !== null) {
    stripIfRecorded(request, 'goal_node_id', goal.node_id);
    stripIfRecorded(request, 'goal_direction', goal.direction);
  }

  return createHash('sha256').update(stableStringify(request)).digest('hex');
}
