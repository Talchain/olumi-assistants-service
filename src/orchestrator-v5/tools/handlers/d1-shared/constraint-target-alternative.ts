/**
 * ⭐⭐ WHEN A LIMIT LANDS ON A TARGET THAT CANNOT CARRY IT, NAME THE ONE THAT CAN.
 *
 * ── THE DEFECT, MEASURED ──────────────────────────────────────────────────
 * Paul's 16 Sep session `1dd2133d`. He said *"that's all we have to spend on
 * hiring resources this year"* and the £200,000 limit was written against
 * `dac3fdc3` — **"Budget Overrun Risk"**, `kind: risk`, `observed_state: null`.
 * **"Hiring and Onboarding Cost" (`7809def4`) was in the same graph.**
 *
 * From the CEE logs:
 *   v5.entity_kind_repaired  handler_id: add_constraint  entity_id: dac3fdc3
 *     proposed_kind: "constraint" -> resolved_kind: "node"
 *   v5.validator_outcome     handler_proposed: add_constraint   valid: true
 *
 * The system repaired the KIND LABEL and passed the entity as valid. Nothing
 * asked whether a *risk* is a plausible target for a *pound* limit.
 *
 * ⚠⚠ AND THE HONEST DISCLOSURE WAS ALREADY THERE AND ALREADY FIRED.
 * `constraint-write-admissibility.ts` (built 14 Sep for the identical defect on
 * "Subscriber Churn Rate") correctly told him *"Budget Overrun Risk has no
 * number recorded against it."* True, and useless: it names the SYMPTOM — this
 * node has no value — and not the CAUSE — the wrong node was chosen.
 *
 * ⇒ The pattern this closes: **converting a silent failure into an honest
 * failure and stopping there.** A truthful dead end is still a dead end.
 *
 * ── WHY THIS DOES NOT MATCH ON LABELS ─────────────────────────────────────
 * ⛔ The obvious implementation — find a factor whose label looks like a cost —
 * is the "label bound the metric" escape hatch, removed from this estate after
 * sixteen defects in one rule (CEE #1328) with a standing instruction never to
 * re-add it. A word in a label is not evidence about a quantity.
 *
 * The basis here is DATA: a candidate is a factor whose own recorded unit
 * matches the constraint's, symbol/code normalised (`£` and `GBP` are one unit
 * spelled two ways). That is the same comparison the writer uses, so a target
 * this names is one the analysis can actually check.
 *
 * ⚠ DEPENDS ON THE SCALE BEING RECORDED. Before the companion transform fix,
 * ZERO of 29 factors carried a unit on the wire, so this would find nothing and
 * correctly stay silent. It gets sharper as that data arrives — it never guesses
 * to fill the gap.
 *
 * ── REFUSALS ──────────────────────────────────────────────────────────────
 * Returns `null` — say nothing — when the chosen target is fine, when the
 * constraint has no unit to match on, or when the candidates number 0 or 2+.
 * Two candidates mean the question is genuinely open and the estate's ruling
 * for that is to ask, never to pick.
 *
 * Pure: no I/O, no LLM, no graph mutation. It proposes a QUESTION, never a write.
 */
import { isCurrencyUnit, sameUnit } from '../../../../utils/currency-alphabet.js';

export interface TargetAlternativeNode {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly label?: unknown;
  readonly observed_state?: unknown;
  readonly goal_threshold_frame?: unknown;
}

export interface TargetAlternativeEdge {
  readonly from?: unknown;
  readonly to?: unknown;
  readonly edge_type?: unknown;
}

export interface TargetAlternativeOption {
  readonly interventions?: unknown;
}

/**
 * ⭐⭐ WOULD A LIMIT ON THIS NODE ACTUALLY BE SCORED? — a deliberately
 * SUFFICIENT mirror of the consumer's own anchor test.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * A unit match and a recorded figure make a node look like a good target and
 * do not make it a SCORABLE one. PLoT refuses to score a constraint whose
 * sample frame it cannot anchor, and the refusal is silent to this module:
 * `constraints_status: 'unavailable'`, no exception. Offering such a node is
 * proposing a dead end with a confident sentence attached — the exact thing
 * this whole module exists to stop, reproduced one level up.
 *
 * ── DERIVED, AND I GOT IT WRONG ONCE BY NOT DOING THAT ────────────────────
 * Read at `plot-lite-service` staging `d68d4ffb` (16 Sep 2026),
 * `src/lib/constraint-reliability.ts` `resolveConstraintSampleFrameAnchor`
 * :216-245 and `collectDirectedEdgeTargets` :409-419. ⚠ I previously reported
 * that PLoT rejects every non-root target. That was FALSE — I relayed a lane's
 * sentence instead of reading the function, and Codex refuted it. Non-root is
 * the THIRD test, and two routes return before it. A blanket non-root refusal
 * would have suppressed legitimate offers.
 *
 * The real order, mirrored below exactly:
 *   1. the node's own `goal_threshold_frame === 'delta'`  -> attested
 *   2. EVERY option intervenes on it                      -> pinned
 *   3. it has a directed (non-bidirected) incoming edge    -> UNANCHORED
 *   4. it is a root carrying a finite observed value       -> anchored
 *
 * ⚠ ROOT IS DERIVED FROM THE CALCULATION GRAPH, NOT FROM UI LINKS. PLoT
 * strips `option` / `decision` / `constraint` nodes before the engine
 * (`option-filter.ts`, mirrored by this estate's own `strippedByPlot`), so an
 * option→factor intervention link never reaches that edge set and cannot
 * un-root a factor. Counting it would make almost every factor look unanchored
 * and silence the offer entirely.
 *
 * ⛔ SUFFICIENT, NEVER COMPLETE — and that asymmetry is the safety argument.
 * Anchoring is necessary for a score, not sufficient: the unit gate, the range
 * gate and the temporal drop can each still suppress the constraint
 * afterwards. So a node this accepts MAY still not be scored, and nothing here
 * may be read as "the analysis will check it". What it does buy is the other
 * direction: a node this REFUSES would certainly not have been scored, so the
 * offer stops naming it.
 *
 * ⚠ IT IS A MIRROR OF ANOTHER SERVICE'S PREDICATE, which is this estate's
 * chronic defect class, and it is here deliberately rather than by accident:
 * there is no shared carrier for the anchor verdict today. It is dated and
 * SHA-pinned above so a reader can re-derive it, and it fails CLOSED — an
 * unreadable graph offers nothing.
 */
function sampleFrameIsAnchored(
  nodeId: string,
  node: TargetAlternativeNode,
  input: {
    readonly nodes: readonly TargetAlternativeNode[];
    readonly edges?: readonly TargetAlternativeEdge[];
    readonly options?: readonly TargetAlternativeOption[];
  },
): boolean {
  // 1. The node itself attests a delta frame.
  if (node.goal_threshold_frame === 'delta') return true;

  // 2. Every option pins it. `length > 0` is load-bearing: `[].every()` is
  //    true, so an empty option list would anchor everything.
  const options = input.options;
  if (
    Array.isArray(options) &&
    options.length > 0 &&
    options.every((o) => {
      const interventions = o?.interventions;
      return (
        interventions !== null &&
        typeof interventions === 'object' &&
        Object.prototype.hasOwnProperty.call(interventions, nodeId)
      );
    })
  ) {
    return true;
  }

  // 3. A directed (non-bidirected) incoming edge un-roots it. Edges from a
  //    node PLoT strips never reach the engine, so they cannot un-root.
  const strippedKinds = new Set(['option', 'decision', 'constraint']);
  const kindById = new Map<string, string>();
  for (const n of input.nodes) {
    if (typeof n.id === 'string' && typeof n.kind === 'string') kindById.set(n.id, n.kind);
  }
  for (const edge of input.edges ?? []) {
    if (edge.edge_type === 'bidirected') continue;
    if (edge.to !== nodeId) continue;
    const fromKind = typeof edge.from === 'string' ? kindById.get(edge.from) : undefined;
    if (fromKind !== undefined && strippedKinds.has(fromKind)) continue;
    return false;
  }

  // 4. A root carrying a finite observed value anchors on its own level. The
  //    candidate gate already proved the figure, so reaching here means yes.
  return true;
}

/**
 * ⭐⭐ THE CONSTRAINT IDS WHOSE TARGET IS **PROVED** UNANCHORABLE.
 *
 * ── WHY IT LIVES HERE ─────────────────────────────────────────────────────
 * {@link sampleFrameIsAnchored} is this estate's single mirror of PLoT's
 * anchor rule, derived at that service's bytes and SHA-pinned in its docblock.
 * A second copy of that question, minted next to its consumer, is the
 * differently-named-twin defect this repo pays for most often (CLAUDE.md trap
 * 12). So the question keeps ONE owner and gains a second reader.
 *
 * ── WHAT IT IS FOR, AND WHAT IT IS EMPHATICALLY NOT FOR ───────────────────
 * Its only consumer chooses a REPAIR SENTENCE. It does **not** feed
 * `deriveConstraintVerdict`, does not partition any constraint out of the
 * withholding, and cannot move `may_name_leading_option`. That separation is
 * deliberate and is the lesson of release blocker r1225-constraint-regression:
 * a scoreability predicate wired into the VERDICT silently un-fixed
 * trust-spine board #1 and had to be reverted. The same predicate wired into
 * the COPY can, at worst, print a less useful true sentence.
 *
 * ── DIRECTION OF USE, WHICH IS THE SAFETY ARGUMENT ────────────────────────
 * {@link sampleFrameIsAnchored} is documented as SUFFICIENT, NEVER COMPLETE:
 * a node it ACCEPTS may still go unscored, but a node it REFUSES would
 * certainly not have been scored. This collector reads only the REFUSAL side —
 * the side that carries a proof — and every unreadable shape yields "not
 * proved", i.e. today's copy. A constraint naming a node this graph does not
 * contain is NOT collected: we have established that we could not look, not
 * that the target is derived.
 *
 * ── GAP RECORDED, NOT CHASED ──────────────────────────────────────────────
 * ⚠ This caller does NOT pre-gate on {@link recordsATestableFigure}, which
 * {@link findConstraintTargetAlternative} does before it calls the predicate —
 * so limb 4's comment (*"the candidate gate already proved the figure"*) does
 * not hold here, and a ROOT node carrying no observed value reads ANCHORED.
 * That is deliberate and it is the safe direction: such a node is not proved
 * derived, so it keeps today's sentence. The class is not lost — a target
 * recording no level is the `unmeasured_target` voice's own subject, and
 * "set a current value" is the advice that lands there, not "your target is
 * computed". Widening this to cover it would put the wrong cause on screen.
 *
 * @param constraintsSource the same two shapes `readRatifiedConstraints`
 *   accepts — the `goal_constraints` array, or an object carrying one —
 *   because `RatifiedConstraint` drops `node_id` and this needs it.
 * @param graphSource an object carrying `nodes[]`, and optionally `edges[]` /
 *   `options[]`.
 *
 * Pure. Fails closed (empty set) on every malformed shape.
 */
export function collectUnanchoredConstraintTargetIds(
  constraintsSource: unknown,
  graphSource: unknown,
): Set<string> {
  const out = new Set<string>();

  const rawConstraints = Array.isArray(constraintsSource)
    ? constraintsSource
    : constraintsSource !== null && typeof constraintsSource === 'object'
      ? (constraintsSource as Record<string, unknown>).goal_constraints
      : undefined;
  if (!Array.isArray(rawConstraints) || rawConstraints.length === 0) return out;

  const graph =
    graphSource !== null && typeof graphSource === 'object'
      ? (graphSource as Record<string, unknown>)
      : undefined;
  const rawNodes = graph?.nodes;
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) return out;

  const nodes = rawNodes.filter(
    (n): n is TargetAlternativeNode => n !== null && typeof n === 'object',
  );
  const rawEdges = graph?.edges;
  const edges = Array.isArray(rawEdges)
    ? rawEdges.filter((e): e is TargetAlternativeEdge => e !== null && typeof e === 'object')
    : undefined;
  const rawOptions = graph?.options;
  const options = Array.isArray(rawOptions)
    ? rawOptions.filter((o): o is TargetAlternativeOption => o !== null && typeof o === 'object')
    : undefined;

  const byId = new Map<string, TargetAlternativeNode>();
  for (const n of nodes) {
    if (typeof n.id === 'string' && n.id !== '') byId.set(n.id, n);
  }

  for (const item of rawConstraints) {
    if (item === null || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const constraintId = typeof obj.constraint_id === 'string' ? obj.constraint_id : null;
    const nodeId = typeof obj.node_id === 'string' ? obj.node_id : null;
    if (constraintId === null || nodeId === null) continue;
    const node = byId.get(nodeId);
    // Absent target ⇒ we could not look ⇒ NOT proved unanchored.
    if (node === undefined) continue;
    if (!sampleFrameIsAnchored(nodeId, node, { nodes, edges, options })) out.add(constraintId);
  }
  return out;
}

export interface TargetAlternative {
  readonly nodeId: string;
  readonly label: string;
  /** The unit the candidate already records, which is why it is a candidate. */
  readonly unit: string;
}

/**
 * ⚠⚠ THE CANDIDATE TEST IS *NARROWER* THAN WRITE-TIME ADMISSIBILITY, AND THAT
 * INVERSION IS THE WHOLE POINT (Codex CX-150, then derived by execution).
 *
 * The obvious move — and the one I first shipped — was to run the chosen
 * target's own `classifyConstraintWriteAdmissibility` on each candidate. **It
 * does not discriminate here, proven by running it:** that classifier speaks
 * from `constraintTargetCarriesNoQuantity`, which asks *"does this node record
 * any number, on any of the fields a quantity can arrive on"* by reading the
 * TOP-LEVEL keys. A node carrying `observed_state: {unit: 'GBP'}` and no figure
 * has a non-null `observed_state`, so it answers YES and classifies as
 * checkable — while PLoT's `classifyConstraintPu` reads `observed_state.value`
 * specifically and emits `missing_observed_state`.
 *
 * ⭐ That gap is DELIBERATE AND CORRECT WHERE IT LIVES, which is why widening
 * the shared predicate would be the wrong repair. For a REFUSAL the safe error
 * is a false silence — telling a user their good limit will be ignored is worse
 * than the defect. **Here the direction is inverted: a false positive NAMES A
 * NODE TO THE USER.** Two questions under one predicate (CLAUDE.md trap 21), so
 * they get two predicates, not one relaxed one.
 *
 * Derived at the consumer's bytes (`plot-lite-service`
 * `src/integrations/isl/translator-v3.ts` → `buildParameterUncertaintiesV3`,
 * pass 1): `kind === 'factor' && Number.isFinite(observed_state.value)`.
 *
 * ⚠ GAP RECORDED, NOT CHASED: PLoT's pass 2 also admits a factor carrying a
 * non-degenerate uniform `prior` and no `observed_state.value`. This stays
 * SILENT about that class rather than proposing it, because the entailment then
 * runs the safe way — everything proposed here is evaluable; not everything
 * evaluable is proposed.
 */
function recordsATestableFigure(node: TargetAlternativeNode): boolean {
  const os = node.observed_state;
  if (os === null || typeof os !== 'object' || Array.isArray(os)) return false;
  const value = (os as { value?: unknown }).value;
  return typeof value === 'number' && Number.isFinite(value);
}

function recordedUnit(node: TargetAlternativeNode): string | null {
  const os = node.observed_state;
  if (os === null || typeof os !== 'object' || Array.isArray(os)) return null;
  const unit = (os as { unit?: unknown }).unit;
  return typeof unit === 'string' && unit.trim() !== '' ? unit : null;
}

/**
 * The one factor that could carry this limit, when exactly one can.
 *
 * @param chosenNodeId the target actually written, which is excluded from the
 *   candidates — proposing the node the user already has is not an alternative.
 */
export function findConstraintTargetAlternative(input: {
  /** The admissibility verdict for the chosen target. */
  readonly chosenIsCheckable: boolean;
  readonly chosenNodeId: string;
  /** The constraint's own unit, from the persisted row. Never inferred. */
  readonly constraintUnit: string | null | undefined;
  readonly nodes: readonly TargetAlternativeNode[];
  /** The calculation graph's edges. Absent ⇒ every candidate reads as a root. */
  readonly edges?: readonly TargetAlternativeEdge[];
  /** Options, for the all-option-pin anchor route. */
  readonly options?: readonly TargetAlternativeOption[];
}): TargetAlternative | null {
  // A checkable target needs no alternative, whatever else is in the graph.
  if (input.chosenIsCheckable) return null;

  const unit = typeof input.constraintUnit === 'string' ? input.constraintUnit.trim() : '';
  // With no unit there is nothing to match on, and matching on anything else
  // would be the label heuristic wearing a different hat.
  if (unit === '') return null;
  // ⛔ AND ONLY A CURRENCY. A shared `%` or `scale` says the two factors use
  // the same NOTATION, not that they measure the same kind of thing.
  if (!isCurrencyUnit(unit)) return null;

  const candidates: TargetAlternative[] = [];
  for (const node of input.nodes) {
    const id = typeof node.id === 'string' && node.id.trim() !== '' ? node.id : null;
    const label = typeof node.label === 'string' && node.label.trim() !== '' ? node.label.trim() : null;
    if (id === null || label === null) continue;
    if (id === input.chosenNodeId) continue;
    // Only a factor. An outcome or goal is derived by the engine, and a second
    // risk is the same mistake again.
    if (node.kind !== 'factor') continue;

    const candidateUnit = recordedUnit(node);
    if (candidateUnit === null || !sameUnit(candidateUnit, unit)) continue;

    // ⚠⚠ A MATCHING UNIT IS NOT A USABLE TARGET (Codex CX-150). It establishes
    // NOTIONAL COMPATIBILITY and nothing else — not amount, not scale, not
    // period, not quantity identity. A factor recording `{unit: 'GBP'}` and no
    // figure passes a unit match and is still the same dead end with a
    // different label — which is the very state this path exists to report.
    // See {@link recordsATestableFigure} for why this is NOT the chosen
    // target's own admissibility classifier.
    if (!recordsATestableFigure(node)) continue;

    // ⛔ AND IT MUST BE SCORABLE, NOT MERELY MEASURED (Codex CX-255). A node
    // whose sample frame PLoT cannot anchor is silently not scored, so naming
    // it would be an actionable-looking dead end.
    if (!sampleFrameIsAnchored(id, node, input)) continue;

    candidates.push({ nodeId: id, label, unit: candidateUnit });
  }

  // Exactly one, or the question is genuinely open and must be asked rather
  // than answered (trap 22f — where direction cannot be determined, ask).
  return candidates.length === 1 ? candidates[0]! : null;
}

/**
 * The question. Names the node that cannot carry the limit and the one that
 * MIGHT be meant — so the user can correct it in one reply instead of
 * discovering two turns later that nothing was checked.
 *
 * ⚠⚠ IT OFFERS A CANDIDATE, NOT AN ASSURED TARGET (Codex CX-150). An earlier
 * draft said the alternative "does" have a figure the analysis can test. A
 * shared currency establishes notional compatibility only: a £revenue factor
 * is not a hiring-cost subject, and claiming otherwise is the same overreach
 * as the partial record this lane already shipped once. The copy states the
 * one thing that IS established — it is the only node recorded in that unit —
 * and asks.
 *
 * ⚠ It ASKS. It does not re-target anything: the user chose a node, and moving
 * their limit under them on a unit match would be exactly the confident
 * wrongness the admissibility check exists to prevent.
 *
 * ⚠⚠ AND IT PROMISES ONLY WHAT THE WRITE PATH CAN GUARANTEE — which is now
 * neither "as well" nor "move", and the reason is worth stating.
 *
 * With the correction offer armed, confirming MOVES the limit. But the offer
 * is armed in the executor and can legitimately be absent (no graph hash, or
 * the emitter refusing the copy), and on that path a confirmation APPENDS. So
 * a sentence promising removal would be false exactly when the carrier is
 * missing — the failure mode hardest to notice.
 *
 * The sentence therefore asserts only the part that holds either way: the
 * limit will end up on that node. WHICH of the two happened is stated by the
 * RECEIPT, after the fact, where it is known rather than predicted.
 *
 * Superseded reasoning kept for the record — "add", NOT "move"
 * (derived at `add-constraint.ts`, Codex CX-150's second half, which I had
 * claimed nothing about until I checked).
 *
 * The idempotency key for a constraint row is **`(node_id, operator)`**
 * (`add-constraint.ts:448`). Accepting this suggestion writes a DIFFERENT
 * `node_id`, so `existing` is `undefined` and the row **APPENDS**. `add_constraint`
 * is the only constraint handler in the estate, `apply-graph-mutation.ts:195`
 * states it "does NOT prune", and no removal path exists — so the original row
 * against the un-testable node SURVIVES, and keeps producing "One limit on your
 * model could not be checked" on every later rerun.
 *
 * ⭐ A first draft of this sentence said *"I will move the limit to it."* That
 * would have been a promise the write path cannot keep, invited by the very
 * disclosure meant to fix a dead end — the same shape as the honest-failure
 * pattern this module exists to break, pointed the other way. The copy says
 * "as well" because that is what actually happens.
 *
 * The exact move needs a supersession carrier (`{from_node_id, to_node_id,
 * operator}`) AND a consumer on the accept path. Named as the follow-up, NOT
 * built here: a producer without a round-trip is a mechanism this lane has
 * already shipped once and had to withdraw.
 */
export function formatConstraintTargetAlternative(input: {
  readonly chosenLabel: string;
  readonly alternative: TargetAlternative;
}): string {
  return (
    `I recorded this against ${input.chosenLabel}, which has no figure for the `
    + `analysis to test. ${input.alternative.label} may be the one you meant \u2014 `
    + `it is the only thing in your model recorded in ${input.alternative.unit}. `
    + `Say so and I will put the limit on it.`
  );
}

