/**
 * ⭐ A LEVEL LIMIT ON A FACTOR THE OPTIONS MOVE IS CHECKED AGAINST THAT FACTOR'S CURRENT LEVEL — carried on the WIRE graph
 * at run time, NEVER persisted (#70 5841905430 / 5841918509; #1919 reviews 5842183627 B1/B2, 5842400886 B3).
 *
 * ISL checks a level limit on a NON-ROOT target as `baseline + (option − status quo)` per draw and refuses without
 * `observed_state.baseline` (`missing_target_baseline`), so Paul's churn limit read "could not be checked". The node's
 * current level is already on it — `observed_state.value`, in the node's own frame — so the carrier is THAT value, never
 * a new number.
 *
 * ⛔ WHY AT RUN TIME (B2). A persisted copy is a snapshot of `value`: `set_factor_value` and the rescale writers rewrite
 * `value` and leave `baseline` alone, so a user who corrects Olumi's 7% estimate to 12% would be checked against the 7%
 * they just replaced. Derived from the graph the run reads, the level the limit is checked against is the level on the
 * model at that moment, by construction. The persisted graph, its hash and every reader of it are untouched.
 *
 * ⛔ WHY A FACTOR, AND ONLY ONE WHOSE LEVEL HAS AN AUTHOR (B3). This runs for every scenario, so it must not reach a cell
 * another path owns or a level nobody can vouch for:
 *   · `add_constraint` mints a baseline for an OUTCOME/RISK target only from the user's own statement and otherwise ASKS
 *     for it (`mintEligible` → `elicitBaseline`: "no statement ⇒ no mint"). Filling that cell from a model-authored value
 *     would answer the question for the user. Factors only — the cell is outcome/risk, so the two never meet.
 *   · the level is either the user's (`brief_extraction`, `user*`) or Olumi's in the form the run DISCLOSES —
 *     `deriveInferredValues`, the disclosure's own predicate, not a copy of it ("I supplied the value behind this").
 *     A level with no author marker carries nothing.
 *
 * Conditions, each a RED row in `run-analysis-level-limit-baseline.test.ts`:
 *   · the limit is framed `level` (a delta needs no baseline; an unframed limit keeps failing closed at the frame hop);
 *   · the target is a FACTOR, not the goal (#1840 owns the goal's), NON-ROOT on the model PLoT scores (an in-edge from a
 *     node that is not an option or the decision — PLoT strips those; ISL reads a root at its own level);
 *   · FILL-ONLY: an existing baseline, whoever wrote it, is never overwritten;
 *   · its level has an author, as above;
 *   · (R-c is per option, AFTER the run — AIQ 5900908629 — so it no longer gates the carrier here), AND PLoT reads the
 *     limit and the level on one scale, decision-grade
 *     (`levelLimitReadsOnNodeLevel`, B1), or the limit is in the factor's own unit on its own cap and the level's pair
 *     attests that cap (`levelLimitReadsOnNodeCap`).
 */
import { valuesMatch } from '../../../utils/reduction-framing.js';
import { deriveInferredValues } from '../../coaching/inferred-value-disclosure.js';
import { percentLimitFrameProvable, percentPeriodsDiffer, statedOperatorOf, type LimitTargetScale } from '../../agent-lane/admit-constraint.js';
import { classifyUnitScaleClass } from '../../../cee/draft/records/unit-scale-class.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * ⛔ PLoT READS THE LIMIT AND THE LEVEL ON ONE SCALE, DECISION-GRADE — one shape, proven end to end (B1, B3):
 *   · the limit is spelled exactly `"%"` with 1 < value ≤ 100. PLoT normalises constraints only when some value leaves
 *     [0,1] (`constraintsNeedNormalisation`); value > 1 guarantees THIS row takes the unit_percent rung (`[0,100]`,
 *     decision-grade) in every batch. A `"%"` row ≤ 1 is forwarded raw OR read as a fraction depending on its batch-mates
 *     — "0.5%" certified as 50% beside a £ budget — so it never carries (`add-constraint.ts` refuses the same row for the
 *     same reason). ≤ 100 keeps it unclamped;
 *   · the node's level is ATTESTED to be that percentage ÷ 100: framed on exactly 100 (`cap`, or the agent-lane estimate's
 *     `scale_frame`) AND `value` = `raw_value` ÷ 100 on the node itself. A unitless level in [0, 1) is NOT proof of a
 *     proportion on the `"%"` scale, and a node framed on 20 is read "≤ 10%" against raw/20 — neither carries.
 * Every other shape — unitless, a percent phrasing PLoT does not read as `"%"`, a currency in another unit — carries
 * nothing through THIS proof and fails closed at ISL's `missing_target_baseline`: an honest "could not be checked", never
 * a guessed frame. A limit in the factor's OWN unit, read on its own cap, has its own proof (`levelLimitReadsOnNodeCap`).
 */
export function levelLimitReadsOnNodeLevel(value: number, unit: string | undefined, node: Rec, os: Rec): boolean {
  if (unit === undefined || unit.trim() !== '%') return false;
  if (!(Number.isFinite(value) && value > 1 && value <= 100)) return false;
  if (!(os.cap === 100 || (os.cap === undefined && node.scale_frame === 100))) return false;
  return typeof os.value === 'number' && typeof os.raw_value === 'number' && valuesMatch(os.value, os.raw_value / 100);
}

/**
 * ⛔⛔ A `"%"` LIMIT RELABELLED FROM ANOTHER PERIOD GOES OUT IN THE UNIT IT WAS STATED IN (rule1-limit-period, PLoT 22f3d94).
 *
 * Admission keeps a percent limit whose period differs from its node's verbatim (`canonicaliseLimitUnit`). A row stored
 * before that, or whose node's unit was rewritten since, still holds `"%"`, and PLoT (which never reads the stamp) scores
 * it on the node's period: "annual churn ≤ 10 %" on a monthly node read P = 1, decision-grade. The stamp says what the
 * user stated, so the WIRE copy sends that unit — refused by PLoT with the unit named — with no stamp and no baseline.
 * Returns the unit to send, else `undefined`. The record is untouched.
 */
function statedUnitAcrossPeriod(c: Rec, node: Rec | undefined): string | undefined {
  if (node === undefined || typeof c.unit !== 'string' || c.unit.trim() !== '%') return undefined;
  const stamp = c.provenance_unit_relabelled;
  if (!isRec(stamp) || typeof stamp.pre_normalisation_unit !== 'string') return undefined;
  const os = isRec(node.observed_state) ? node.observed_state : {};
  const nodeUnit = typeof os.unit === 'string' ? os.unit : undefined;
  return percentPeriodsDiffer(stamp.pre_normalisation_unit, nodeUnit) ? stamp.pre_normalisation_unit : undefined;
}

/**
 * ⛔ A LIMIT IN THE FACTOR'S OWN UNIT IS READ ON ITS OWN CAP — AND SO IS THE LEVEL IT IS CHECKED AGAINST (served journey C,
 * `pj-20260928T082121Z`: "£30,000 to spend" came back `unscored / CONSTRAINT_NOT_CONVERTIBLE` before AND after the user
 * gave every figure).
 *
 * The budget factor is NON-ROOT on the scored model (the draft wired `feature spend → total spend` and `advertising spend
 * → total spend`), so ISL checks the limit as `baseline + (option − status quo)` and refuses without a baseline
 * (`missing_target_baseline`), and PLoT's sample-frame gate withholds it for the same reason (CONSTRAINT_TARGET_UNRELIABLE).
 * `limitTargetCaps` already proves the THRESHOLD is read on `[0, cap]` (it carries the cap as `goal_threshold_cap`); the
 * node's level is on that same scale when its own pair attests it — `value` = `raw_value` ÷ that cap. Then the carrier is
 * the node's `value`, exactly as for the `"%"` shape: the same number, on the same scale as the threshold, never a new one.
 * A level whose pair does not attest that cap (no `raw_value`, or `value` on another frame) carries nothing and keeps its
 * honest refusal. Pure.
 */
export function levelLimitReadsOnNodeCap(graph: unknown, c: Rec, node: Rec, os: Rec): boolean {
  const cap = limitTargetCaps(graph, [c]).get(node.id as string);
  if (cap === undefined) return false;
  return typeof os.value === 'number' && typeof os.raw_value === 'number' && valuesMatch(os.value, os.raw_value / cap);
}

/** The level's author is known: the user's own figure, or Olumi's in the form the run discloses. */
function levelHasAnAuthor(node: Rec, os: Rec): boolean {
  const source = typeof os.source === 'string' ? os.source : undefined;
  if (source !== undefined && (source === 'brief_extraction' || source.startsWith('user'))) return true;
  return deriveInferredValues({ nodes: [node] }).length === 1;
}

/**
 * The ids of the nodes whose current level a level limit is checked against on this run. `_options` (the run's final wire
 * options) no longer decide it: R-c is per option, after the run (AIQ 5900908629). Kept so callers stay unchanged.
 */
export function levelLimitBaselineNodeIds(
  graph: unknown,
  goalConstraints: unknown,
  goalNodeId?: string,
  _options?: ReadonlyArray<Record<string, unknown>>,
): Set<string> {
  const out = new Set<string>();
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(goalConstraints)) return out;
  const nodes = graph.nodes.filter(isRec);
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const kindById = new Map(nodes.map((n) => [n.id, n.kind] as const));
  const scoredTargets = new Set(
    edges
      .filter((e) => {
        const k = kindById.get(e.from);
        return typeof k === 'string' && k !== 'option' && k !== 'decision';
      })
      .map((e) => e.to),
  );
  for (const c of goalConstraints) {
    if (!isRec(c) || c.value_frame !== 'level' || typeof c.value !== 'number') continue;
    const node = nodes.find((n) => n.id === c.node_id);
    if (node === undefined || typeof node.id !== 'string') continue;
    if (node.kind !== 'factor' || node.id === goalNodeId || !scoredTargets.has(node.id)) continue;
    const os = node.observed_state;
    if (!isRec(os) || typeof os.value !== 'number' || !Number.isFinite(os.value) || os.baseline !== undefined) continue;
    if (!levelHasAnAuthor(node, os)) continue;
    if (statedUnitAcrossPeriod(c, node) !== undefined) continue;
    const unit = typeof c.unit === 'string' ? c.unit : undefined;
    // ⭐ R-c is PER OPTION since AIQ #72 5900908629 (lock A PJ-A3, R3 5900778834: #2268's per-limit gate here dropped
    // churn's baseline for ALL options when one added option moved churn through a placeholder, so Paul's churn ≤ 4% went
    // unscored). The baseline now always carries, so PLoT scores every option; the options a placeholder moves have
    // their own P withheld after the run (`collectLimitLevelOwners` → `withholdOptionLimitScores`, `run-analysis.ts`).
    const onLevel = levelLimitReadsOnNodeLevel(c.value, unit, node, os);
    const onCap = !onLevel && levelLimitReadsOnNodeCap(graph, c, node, os);
    if (!onLevel && !onCap) continue;
    out.add(node.id);
  }
  return out;
}

/** The wire graph with each such node's current level carried as its baseline. Returns `graph` itself when none. */
export function carryLevelLimitBaselines<G>(
  graph: G,
  goalConstraints: unknown,
  goalNodeId?: string,
  options?: ReadonlyArray<Record<string, unknown>>,
): G {
  const ids = levelLimitBaselineNodeIds(graph, goalConstraints, goalNodeId, options);
  if (ids.size === 0 || !isRec(graph) || !Array.isArray(graph.nodes)) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((n: unknown) =>
      isRec(n) && typeof n.id === 'string' && ids.has(n.id) && isRec(n.observed_state)
        ? { ...n, observed_state: { ...n.observed_state, baseline: n.observed_state.value } }
        : n,
    ),
  } as G;
}

/**
 * ⛔ A LIMIT ON A FACTOR IS READ ON THAT FACTOR'S OWN SCALE (option-set limit; DL #70 5848250258, seam 5848242345).
 *
 * SERVED (R&C `w1983-price-10fbbdf`, #70 5847390325): "keep the Pro plan price under £60", options £49 / £59 / £55. The
 * price is a factor every option sets, and CEE sends its levels normalised (0.49 / 0.59 on a cap of 100). PLoT's threshold
 * ladder then reads the RAW limit (60) on the identity [0, 1] intervention scale BEFORE the node's own cap, so the range
 * is `default` → `threshold_normalisation_defaulted` → `CONSTRAINT_TARGET_UNRELIABLE`, and the reply asked for a rerun
 * that could never help. PLoT reads a node's `goal_threshold_cap` first (`nodeCap`, plot-lite-service
 * `intervention-normaliser.ts` threshold ladder): engine-direct on served PLoT `1f6ad52` / ISL `8a5e973`, the same limit with
 * `goal_threshold_cap: 100` on the price node is decision-grade, each option compared at the level it sets —
 * "≤ £55": keep £49 → 1, raise to £59 → 0 (`option-set-limit-20260926/RESULTS.md`).
 *
 * So the factor's own cap is carried as `goal_threshold_cap` on the WIRE copy, never persisted, only where it is proven
 * to be the limit's scale:
 *   · the limit is framed `level` (unframed keeps failing closed at the frame hop; a delta needs no scale);
 *   · the target is a FACTOR, with no `goal_threshold_cap` of its own (fill-only);
 *   · its scale is declared: `observed_state.cap`, else the admission estimate's `scale_frame`, above 1;
 *   · the limit is spelled in the factor's OWN unit (trimmed, case-folded equality). A limit in another unit — "£/year"
 *     on a "£/month" price — would be scored against the wrong number, so it keeps its honest refusal;
 *   · the unit is not a percentage of any class: the percent rung owns those (`withholdUnprovablePercentFrames`);
 *   · 1 < value ≤ cap: a value above 1 takes PLoT's scaled rung in every batch (the B1 lesson above), and a value
 *     within the cap stays inside the factor's own frame.
 */
export function limitTargetCaps(graph: unknown, goalConstraints: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(goalConstraints)) return out;
  const nodes = graph.nodes.filter(isRec);
  const fold = (u: unknown): string | undefined => (typeof u === 'string' && u.trim() !== '' ? u.trim().toLowerCase() : undefined);
  const aboveOne = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 1;
  for (const c of goalConstraints) {
    if (!isRec(c) || c.value_frame !== 'level' || typeof c.node_id !== 'string') continue;
    const node = nodes.find((n) => n.id === c.node_id);
    if (node === undefined || node.kind !== 'factor' || node.goal_threshold_cap !== undefined) continue;
    const os = isRec(node.observed_state) ? node.observed_state : {};
    const cap = aboveOne(os.cap) ? os.cap : aboveOne(node.scale_frame) ? node.scale_frame : undefined;
    if (cap === undefined) continue;
    const unit = fold(c.unit);
    if (unit === undefined || unit !== fold(os.unit) || classifyUnitScaleClass(unit) !== 'unknown') continue;
    if (!aboveOne(c.value) || c.value > cap) continue;
    out.set(node.id as string, cap);
  }
  return out;
}

/** The wire graph with each such factor's own cap carried as `goal_threshold_cap`. Returns `graph` itself when none. */
export function carryLimitTargetCaps<G>(graph: G, goalConstraints: unknown): G {
  const caps = limitTargetCaps(graph, goalConstraints);
  if (caps.size === 0 || !isRec(graph) || !Array.isArray(graph.nodes)) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((n: unknown) =>
      isRec(n) && typeof n.id === 'string' && caps.has(n.id) ? { ...n, goal_threshold_cap: caps.get(n.id) } : n,
    ),
  } as G;
}

/**
 * ⛔⛔ A PERCENT LIMIT IS SENT FRAMED ONLY WHERE PLoT READS IT ON THE LEVEL'S OWN SCALE (#70 5843365832).
 *
 * PLoT's percent rung is `[0,100]` whatever the target's frame, so a FRAMED percent limit on a level held on another
 * frame is scored against the wrong number and certified (WIRE: the same 4% root level read P(meet ≤ 10%) 1 on a frame
 * of 100 and 0.017 on 20; the same 12% read 0.017 on 100 and 1 on 200, all `decision_grade: true`). Unframed, ISL
 * refuses it (`frame_not_stamped`): an honest "could not be checked".
 *
 * ⛔ WHY AT RUN TIME, ON THE WIRE COPY (the B2 lesson). The frame is the user's meaning and stays on the record; whether
 * PLoT can read it depends on the target's frame WHEN THE RUN HAPPENS — a node with no level yet may be framed later,
 * and a value writer may frame it differently. It also covers every writer of the row at one site: agent-lane
 * admission and V5 `add_constraint` (which stamps a frame on factor targets too).
 *
 * A node carrying its own `goal_threshold_cap` is read on `[0, cap]` before the percent rung, so it is left alone.
 */
function unprovablePercentFrameIndices(graph: unknown, goalConstraints: unknown): number[] {
  const out: number[] = [];
  if (!Array.isArray(goalConstraints)) return out;
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  goalConstraints.forEach((c, i) => {
    if (!isRec(c) || (c.value_frame !== 'level' && c.value_frame !== 'delta')) return;
    const node = nodes.find((n) => n.id === c.node_id);
    const gtc = node?.goal_threshold_cap;
    if (typeof gtc === 'number' && Number.isFinite(gtc) && gtc > 0) return;
    if (percentLimitFrameProvable(typeof c.unit === 'string' ? c.unit : undefined, node === undefined ? undefined : targetScaleOf(node))) return;
    out.push(i);
  });
  return out;
}

/** The node's scale as admission reads it (`admit-model.ts`): its `observed_state` plus its `scale_frame`. */
function targetScaleOf(node: Rec): LimitTargetScale {
  const os = isRec(node.observed_state) ? node.observed_state : {};
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const unit = typeof os.unit === 'string' ? os.unit : undefined;
  const cap = num(os.cap);
  const value = num(os.value);
  const rawValue = num(os.raw_value);
  const scaleFrame = num(node.scale_frame);
  return {
    ...(unit !== undefined ? { unit } : {}),
    ...(cap !== undefined ? { cap } : {}),
    ...(value !== undefined ? { value } : {}),
    ...(rawValue !== undefined ? { raw_value: rawValue } : {}),
    ...(scaleFrame !== undefined ? { scale_frame: scaleFrame } : {}),
  };
}

/** The constraint ids (or `#<index>` for a row with none) whose frame this run withholds on the wire. */
export function unprovablePercentFrameIds(graph: unknown, goalConstraints: unknown): string[] {
  if (!Array.isArray(goalConstraints)) return [];
  return unprovablePercentFrameIndices(graph, goalConstraints).map((i) => {
    const c = goalConstraints[i] as Rec;
    return typeof c.constraint_id === 'string' ? c.constraint_id : `#${i}`;
  });
}

/**
 * The wire copy of `goalConstraints` with each unprovable percent frame removed, and each `"%"` row relabelled from
 * another period sent in its stated unit without the stamp (`statedUnitAcrossPeriod`). Returns the input itself when none.
 */
export function withholdUnprovablePercentFrames<C>(graph: unknown, goalConstraints: C): C {
  if (!Array.isArray(goalConstraints)) return goalConstraints;
  const idx = new Set(unprovablePercentFrameIndices(graph, goalConstraints));
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const stated = new Map<number, string>();
  goalConstraints.forEach((c: unknown, i: number) => {
    if (!isRec(c)) return;
    const unit = statedUnitAcrossPeriod(c, nodes.find((n) => n.id === c.node_id));
    if (unit !== undefined) stated.set(i, unit);
  });
  if (idx.size === 0 && stated.size === 0) return goalConstraints;
  return goalConstraints.map((c: unknown, i: number) => {
    if (!isRec(c) || (!idx.has(i) && !stated.has(i))) return c;
    let out: Rec = c;
    if (idx.has(i)) {
      const { value_frame: _withheld, ...rest } = out;
      out = rest;
    }
    const unit = stated.get(i);
    if (unit !== undefined) {
      const { provenance_unit_relabelled: _stamp, ...rest } = out;
      out = { ...rest, unit };
    }
    return out;
  }) as C;
}

/**
 * ⭐ A2 FOLLOW-UP (DL verdict on #2180): THE ONE CASE WHERE "LESS THAN" AND "AT MOST" DIFFER. An option that SETS the
 * limited quantity at EXACTLY a strict limit's threshold does not meet it: "keep churn under 4%" is not met by an option
 * that sets churn at 4%. The store holds that limit as `operator: "<="` + `operator_as_stated: "<"`, and PLoT/ISL get
 * `<=` only (`run-analysis.ts` `withholdStatedOperator`), so the engine counts that option as meeting it. Over continuous
 * draws P(X < 4) = P(X <= 4) and the engine's score IS the stated limit's; the pinned level is the exception.
 *
 * Returned per option (option id → the constraint ids it pins at the threshold) for the verdict's one owner,
 * `deriveConstraintVerdict` (`constraint-feasibility.ts`), which withholds that option's result for that limit. Nothing
 * is modelled: no P is rewritten and the wire is unchanged.
 *
 * SAME FRAME, from the two proofs this module already owns and nothing else — no unit is parsed here:
 *   · a `"%"` limit PLoT reads on the node's own level (`levelLimitReadsOnNodeLevel`): the level is the percentage ÷ 100;
 *   · a limit in the factor's own unit read on its own cap (`limitTargetCaps`): the level is the figure ÷ cap.
 * The option's level is the number PLoT received (the run's final wire options), compared with `valuesMatch`. A limit in
 * any other shape proves no frame and is left alone: PLoT does not score it against the node's level either (it is
 * refused or unscored upstream). Level-framed rows only (a delta limit is on a change, not a level). A strict row is
 * read through `statedOperatorOf`, so a stamp that contradicts the held operator is never strict here. Pure.
 */
export function strictLimitsPinnedAtThreshold(
  graph: unknown,
  goalConstraints: unknown,
  options: ReadonlyArray<Record<string, unknown>>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(goalConstraints)) return out;
  const nodes = graph.nodes.filter(isRec);
  for (const c of goalConstraints) {
    if (!isRec(c) || c.value_frame !== 'level' || typeof c.constraint_id !== 'string' || typeof c.node_id !== 'string') continue;
    const stated = statedOperatorOf(c);
    if (stated !== '<' && stated !== '>') continue;
    const node = nodes.find((n) => n.id === c.node_id);
    if (node === undefined || typeof c.value !== 'number' || !Number.isFinite(c.value)) continue;
    const threshold = thresholdOnNodeLevel(graph, c, node, c.value);
    if (threshold === undefined) continue;
    for (const o of options) {
      const id = typeof o.option_id === 'string' && o.option_id !== '' ? o.option_id : typeof o.id === 'string' && o.id !== '' ? o.id : undefined;
      const level = isRec(o.interventions) ? o.interventions[c.node_id] : undefined;
      if (id === undefined || typeof level !== 'number' || !valuesMatch(level, threshold)) continue;
      const ids = out.get(id) ?? new Set<string>();
      ids.add(c.constraint_id);
      out.set(id, ids);
    }
  }
  return out;
}

/** A level limit's threshold on its node's own level, where this module proves PLoT reads it there; else `undefined`. */
function thresholdOnNodeLevel(graph: unknown, c: Rec, node: Rec, value: number): number | undefined {
  const os = isRec(node.observed_state) ? node.observed_state : {};
  if (levelLimitReadsOnNodeLevel(value, typeof c.unit === 'string' ? c.unit : undefined, node, os)) return value / 100;
  const cap = limitTargetCaps(graph, [c]).get(node.id as string);
  return cap === undefined ? undefined : value / cap;
}
