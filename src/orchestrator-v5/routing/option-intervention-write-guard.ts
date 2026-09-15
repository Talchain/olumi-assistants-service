/**
 * ⭐⭐ ROADMAP 2.1266 — WHEN AN OPTION CARRYING NO EFFECT VALUES IS NAMED, A
 * WRITE BOUND TO THE WRONG ENTITY IS WITHHELD, NOT APPLIED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ SCOPE, STATED BEFORE ANYTHING ELSE — AND IT HAS MOVED TWICE. READ BOTH
 * HALVES; THE SUPERSEDED HALF IS KEPT BECAUSE IT NAMES THE MECHANISM.
 *
 * ── SUPERSEDED (accurate until the deliberate-edit lane, 15 Sep 2026) ──────
 * ~~This module covers an option that carries **no effect values at all**. A
 * **PARTIALLY-CONFIGURED** option is outside it entirely, and the wrong-entity
 * write still persists for that class, false-success reply and all.~~
 *
 * The mechanism that caused it, which is still worth knowing:
 * `hasNumericInterventions` in `analysis-ready-helper.ts` marks an option
 * `ready` on ANY one numeric intervention, and `resolveConfigureOptionFacts`
 * searched only the OUTSTANDING-SLOT projection — so a named-but-configured
 * option fell through before this guard was ever consulted. **A drafted graph
 * arrives already populated, so every later edit is a REVISION, and a revision
 * has no outstanding slot: the guard protected the FIRST configuration of a
 * model and never a correction to one.** Measured live on deployed CEE staging,
 * 14 Sep 2026: `evaluateConfigureOptionOutcome` returned `not_applicable` on
 * **46 of 46** real captured turns while the shipped detector matched 46/46.
 *
 * ── CURRENT ───────────────────────────────────────────────────────────────
 * `configure-option-outcome.ts` now splits TARGET RESOLUTION from COPY
 * REPLACEMENT and emits `not_honoured_no_copy` for a resolvable option with no
 * honest sentence. This guard accepts BOTH verdicts, so a REVISION is protected
 * on the same terms as a first configuration. Driving the identical
 * wrong-entity write against the two shapes now:
 *
 *   option with NO effect values   → `not_honoured`          → **withhold**
 *   option with ONE effect value   → `not_honoured_no_copy`  → **withhold**
 *
 * ⚠ WHAT IS STILL OUT OF SCOPE, and it is a real residual, not a footnote: a
 * message that names NO option, or names TWO, reaches no verdict and the write
 * is **allowed**. That is deliberate — see W1 below; withholding on an unnamed
 * subject discards correct, explicitly-requested edits wholesale, which is the
 * direction that destroys user work. The rowed exit is to ASK, not to widen.
 *
 * **A narrowed true claim is worth more than a broad one that is false**, and
 * the overclaim enters at the moment of recording (trap 20), which is why the
 * scope sits at the top of the file rather than in a footnote.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — DO NOT DELETE IT AS REDUNDANT WITH `configure-option-outcome`
 *
 * `evaluateConfigureOptionOutcome` (ROADMAP 2.427) already DETECTS this exact
 * state — its own header calls it *"branch (b): something landed for a
 * DIFFERENT entity"* — and already replaces the assistant text wholesale. It
 * has never withheld the WRITE. The two are complementary, not duplicates:
 *
 *      2.427 owns the TEXT.        This module owns the WRITE.
 *
 * Remove this and the product goes back to shipping an honest refusal on top of
 * a persisted wrong mutation, with nothing red anywhere — because the text
 * guard's own tests keep passing. That is precisely how the defect below
 * reached a user.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, wire-witnessed on deployed CEE `8be62df`
 * (`olumi-docs/witness-acceptance-2026-08-17/captures/`, scenario
 * `289c2690-f605-4f3c-8e43-465b339fda1e`, J4 turn 5):
 *
 *   REQUEST  "For the subcontracting inner-city deliveries to a green courier
 *            option, set the effect value on Subcontractor cost as share of
 *            affected-route revenue to 0.12 — a share, no unit."
 *   APPLIED  a FACTOR-baseline `parameter_update`: factor `49a2b80b`
 *            `observed_state` 0.5, sourced to the system's own inference,
 *            became 0.12 stamped as the user's own value.
 *   REPLY    byte-identical to the previous turn's refusal — "…still has no
 *            effect value on Subcontractor cost as share of affected-route
 *            revenue, so that link is not carrying anything yet…"
 *   RELOAD   (`j6-reload-J4.json`) the guest reloads and sees factor `49a2b80b`
 *            at 0.12, while option `21ea9b80` still carries `interventions:
 *            {}`. The exact bytes are in this lane's witness fixture.
 *
 * So the shared FACTOR BASELINE every option reads was silently rewritten, the
 * option's effect value the user actually asked for was not, the readiness
 * blocker never retired, and the reply denied that anything had happened.
 *
 * ⚠⚠ WHY THE EXISTING GUARD DID NOT FIRE, derived at the bytes.
 * `option-intervention-guard.ts` exists to refuse exactly this mutation — its
 * header says the caller must *"refuse the factor mutation and clarify instead
 * — graph unchanged"*. It is wired at ONE place, `turn-executor.ts` (the
 * `proposedHandlerId === 'set_factor_value'` validate block), whose comment
 * claims *"one guard here covers every dispatch path."* **That claim is false
 * for the edit lane.** A turn whose `exit_path` is `edit_graph` never reaches
 * that block: `handleEditGraph` owns its own applier and its own commit. The
 * witnessed turn took exactly that route. (Trap 20 at the level of a comment:
 * "one guard covers every path" was a claim about a call graph nobody
 * re-derived.)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE QUESTION THIS MODULE ANSWERS, AND THE ONE IT DELIBERATELY DOES NOT
 *
 * It adds no second reading of the user's message. Intent and option IDENTITY
 * come from `evaluateConfigureOptionOutcome`, unchanged — a second intent
 * predicate here would be the two-same-named-helpers defect (CLAUDE.md trap
 * 21), and its `named_in_message` requirement is what keeps this identity-bound
 * rather than a guess (trap 19). The one further question asked here is:
 *
 *   *Did this turn move the baseline of a factor THIS OPTION IS WIRED TO — or
 *    one of THIS OPTION'S OWN OUTGOING EDGES — while writing no effect value
 *    for ANY option?*
 *
 * ⭐ The edge disjunct was added by the deliberate-edit lane and is documented
 * at `optionEdgeWritesLanded`. It is a STRICTER guard, not a wider one: its
 * identity binding (`edge.from === optionId`) is tighter than the node arm's,
 * and it is orthogonal to the W1 false positive below, which moves a node and
 * no edge at all.
 *
 * All three conjuncts are load-bearing and all three are narrow ON PURPOSE:
 *
 *   - **"no effect value for ANY option"** — if an interventions write DID land
 *     somewhere, the turn accomplished a real option edit and discarding it
 *     would be a new harm. Checked across all options, not just the named one,
 *     because the outcome verdict already says the named one missed out.
 *   - **"a node baseline moved, or one of the option's own edges moved"** —
 *     this is the wrong-entity signature. Both captures that motivated the two
 *     rows are in it: a factor `observed_state` (2.1266) and an option→factor
 *     edge `strength.mean` / `exists_probability` (2.427, and the live capture
 *     in `wrong-entity-write-capture.fixture.ts`).
 *   - **"a factor THIS OPTION IS WIRED TO"** — the identity binding, added
 *     after an adversarial review executed a false positive against the
 *     version that lacked it. See `optionLinkedNodeIds`.
 *
 * ⚠ WHAT IS AND IS NOT PRESERVED ON A COMPOUND TURN — corrected, because the
 * first version of this sentence overclaimed. A turn whose effects are
 * **structural ONLY** (an add, a rename, an edge change) is not withheld, so it
 * survives intact. But a compound turn that BOTH moves a linked baseline AND
 * does something structural is withheld **WHOLESALE** — the rename goes with
 * the baseline write. Withholding is all-or-nothing at the graph level, so
 * "a compound message keeps the part that landed" is true only of the
 * structural-only case.
 *
 * SAFE-BIASED, BUT NOT COST-FREE. Every uncertainty returns `allow`, leaving
 * today's behaviour byte-identical: no mutation, an unparseable graph, an
 * outcome verdict that is not `not_honoured`, a baseline move on a factor the
 * option is not wired to.
 *
 * ⚠⚠ W1 — THE ALLOW-LIST ABOVE DOES **NOT** EXHAUST THE LEGITIMATE-EDIT CASES,
 * AND AN EARLIER VERSION OF THIS PARAGRAPH IMPLIED IT DID. Measured and
 * reproducible: *"For the &lt;option&gt; option, our &lt;factor&gt; assumption is stale
 * — change the &lt;factor&gt; baseline to 0.3"*, where that factor **IS** wired to
 * the option, is **WITHHELD**. The user's explicit, correct request, correctly
 * executed by the applier, is discarded.
 *
 * That is not a bug to be tuned out. **At the graph, this shape and the
 * witnessed wrong-entity write are indistinguishable** — same option named,
 * same no-effect-value-landed, same linked baseline moved. The obvious next
 * rule (gate on the intent trigger) was tested and rejected: `option_value_set`
 * is the ASSISTANT'S OWN suggested phrasing for a genuine effect request, so
 * gating on it would blind the guard to the product's recommended format. That
 * is the oscillation pattern in CLAUDE.md trap 22f, and the exit is not a
 * better predicate.
 *
 * So the ambiguity is landed where the graph matches the reply: **withholding
 * is an honest omission; allowing would be a reply that denies a write which
 * happened.** The cost is paid openly rather than silently — every withheld
 * turn carries `formatWithheldWriteNotice`, which tells the user plainly that
 * nothing was saved. **A silent withhold would be the worse defect of the two.**
 *
 * ⭐ THE REAL FIX, rowed and deliberately not built here: where the guard cannot
 * determine which entity the user meant, the product should ASK rather than
 * guess — turning an unwinnable parsing problem into a coaching moment (the
 * documented trap-22f exit).
 */

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { mergeInterventionSources } from '../../orchestrator/tools/analysis-ready-helper.js';
import { evaluateConfigureOptionOutcome } from './configure-option-outcome.js';

/** Why the write was allowed to proceed. Every value is today's behaviour. */
export type OptionInterventionWriteAllowReason =
  /** No mutation applied this turn — nothing to withhold. */
  | 'no_write'
  /** Pre- or post-edit graph does not strict-parse; the harm is unestablished. */
  | 'graph_unparseable'
  /**
   * The configure-option outcome guard reached no write-protecting verdict —
   * neither `not_honoured` nor `not_honoured_no_copy`.
   */
  | 'outcome_not_unhonoured'
  /** An effect value DID land for some option — a real option edit. */
  | 'interventions_write_landed'
  /**
   * Neither a node's own value NOR one of the option's outgoing edges moved;
   * the write was not the wrong-entity kind.
   */
  | 'no_baseline_write'
  /**
   * A baseline DID move, but on a node the named option is not wired to — so
   * it cannot be a substitute for that option's effect value. Named apart from
   * `no_baseline_write` deliberately: they are two different facts, and
   * collapsing them is what let the false positive below through unseen.
   */
  | 'baseline_write_unrelated_to_option';

export type OptionInterventionWriteVerdict =
  | { readonly verdict: 'allow'; readonly reason: OptionInterventionWriteAllowReason }
  | {
      readonly verdict: 'withhold';
      /** The option the USER NAMED, by identity, from the outcome verdict. */
      readonly optionId: string;
      readonly optionLabel: string;
      /** Node ids whose own value this turn moved — what is being discarded. */
      readonly baselineNodeIds: readonly string[];
      /**
       * `<from>-><to>` for each of the NAMED OPTION'S OWN outgoing edges whose
       * `strength.mean` or `exists_probability` this turn moved.
       *
       * Deliberately NOT folded into `baselineNodeIds`: a moved edge and a
       * moved node value are two different facts about what was discarded, and
       * `formatWithheldWriteNotice` may only name a NODE it can truthfully call
       * unchanged. On an edge-only withhold the node really is unchanged — it
       * is the LINK that moved — so the notice correctly falls back to its
       * unqualified sentence rather than naming the factor.
       */
      readonly optionEdgeKeys: readonly string[];
    };

/** Every effect value the graph holds, keyed `<optionId>::<factorId>`. */
function projectInterventionValues(graph: GraphV3T): Map<string, number> {
  const out = new Map<string, number>();
  for (const node of graph.nodes) {
    // Single cast, matching `configure-option-outcome.ts`'s call site verbatim
    // — deliberately NOT `as unknown as`, which the forbidden-boundary ratchet
    // freezes. The reader below is duck-typed precisely so callers need not
    // force it.
    const merged = mergeInterventionSources(node as Record<string, unknown>);
    if (merged === undefined) continue;
    for (const [factorId, value] of Object.entries(merged)) {
      out.set(`${node.id}::${factorId}`, value);
    }
  }
  return out;
}

/**
 * Did ANY option gain, change or lose an effect value between the two graphs?
 *
 * Read through `mergeInterventionSources` — the SAME reader
 * `evaluateConfigureOptionOutcome` and `computeStructuralReadiness` use — so
 * this guard cannot disagree with the verdict it consumes, or with the badge on
 * the user's screen, about whether an effect value exists (trap 12: derive, do
 * not re-spell the three-source precedence).
 */
export function anyInterventionWriteLanded(before: GraphV3T, after: GraphV3T): boolean {
  const pre = projectInterventionValues(before);
  const post = projectInterventionValues(after);
  for (const [key, value] of post) {
    if (!pre.has(key)) return true;
    if (pre.get(key) !== value) return true;
  }
  // A REMOVED effect value is a write too — an edit that cleared one did
  // something real to an option, so it is not the wrong-entity signature.
  for (const key of pre.keys()) {
    if (!post.has(key)) return true;
  }
  return false;
}

/**
 * The factors the NAMED option is wired to — its own causal neighbourhood.
 *
 * ⭐⭐ THIS IS THE IDENTITY BINDING, AND IT IS THE WHOLE DIFFERENCE BETWEEN A
 * GUARD AND A BLUNT INSTRUMENT (trap 19). Without it the withhold asks *"did
 * ANY pre-existing node's value move?"* — a VALUE PREDICATE that any node in
 * the graph can satisfy, with nothing tying the moved node to the option, the
 * factor, or the message.
 *
 * ⚠ MEASURED, not hypothesised — this is the false positive an adversarial
 * review executed against the unbound version of this module. Message: *"For
 * the Subcontract inner-city runs to a green courier option, our Fuel price
 * assumption is stale — change Fuel price to 1.40."* The applier does exactly
 * what the user asked (`fac_fuel` 1.2 → 1.40) and the unbound guard returned
 * `withhold` naming `baselineNodeIds: ["fac_fuel"]` — **discarding a correct,
 * explicitly requested edit** and answering with recovery copy about a
 * different factor: true, non-responsive, and silent about the write it threw
 * away. That is the exact direction this module's header calls unacceptable.
 * The witnessed shape and the false-positive shape returned IDENTICAL verdicts:
 * no discrimination at all.
 *
 * Read from the **BEFORE** graph on purpose. The pre-edit graph is the persisted
 * authority; resolving against `after` would let the very edit under suspicion
 * invent an edge that justifies withholding it.
 *
 * Edge direction matches `collectCandidateFactorLabels` in
 * `configure-option-clarify.js` — the shipped reader for "this option's
 * factors", whose labels become the recovery copy — so the guard and the copy
 * cannot disagree about which factors belong to the option (trap 12).
 */
export function optionLinkedNodeIds(graph: GraphV3T, optionId: string): ReadonlySet<string> {
  const linked = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from === optionId) linked.add(edge.to);
  }
  return linked;
}

/** A node's own observed value, or undefined when it carries none. */
function readObservedValue(node: unknown): number | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  const observed = (node as Record<string, unknown>).observed_state;
  if (observed === null || typeof observed !== 'object') return undefined;
  const value = (observed as Record<string, unknown>).value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Which nodes' OWN values this turn moved — gained, changed, or lost.
 *
 * This is the wrong-entity signature: the shared baseline every option reads,
 * rewritten in place of the option's effect value. Identity-bound by node id so
 * the answer names what would be discarded rather than asserting "something
 * changed" (trap 19).
 *
 * Deliberately reads ONLY `observed_state.value`. The witnessed write also moved
 * `display_value` and `provenance`, but a guard that fired on those would
 * withhold on presentation-only edits — the direction that destroys user work.
 */
export function baselineWritesLanded(before: GraphV3T, after: GraphV3T): string[] {
  const pre = new Map<string, number | undefined>();
  for (const node of before.nodes) pre.set(node.id, readObservedValue(node));
  const moved: string[] = [];
  for (const node of after.nodes) {
    // A NEW node is a structural add, not a rewrite of shared state.
    if (!pre.has(node.id)) continue;
    if (pre.get(node.id) !== readObservedValue(node)) moved.push(node.id);
  }
  return moved;
}

/**
 * ⭐⭐⭐ THE EDGE ARM — the originally-witnessed wrong-entity write, which
 * `baselineWritesLanded` above is STRUCTURALLY BLIND TO.
 *
 * ── THE DEFECT, measured at the stored object ─────────────────────────────
 * `baselineWritesLanded` reads only node `observed_state.value`. An EDGE-only
 * write therefore yields `movedNodeIds.length === 0`, the guard returns
 * `allow` / `no_baseline_write`, and the wrong mutation PERSISTS — with
 * `evaluateConfigureOptionOutcome` having already replaced the prose. **Honest
 * text over a persisted wrong mutation** is the precise state this module's own
 * header says it exists to prevent, surviving in the case it was built from:
 *
 *   factor `observed_state`   → withhold   (the node arm — already covered)
 *   edge `strength.mean`      → allow      ⛔ PERSISTED
 *   edge `exists_probability` → allow      ⛔ PERSISTED
 *
 * ⭐ AND IT IS THE ORIGINAL DEFECT, NOT A NEW CLASS.
 * `configure-option-outcome.ts`'s header witnesses an EDGE-STRENGTH write as
 * the 2.427 capture (`opt_cloud_native → fac_adoption_complexity`,
 * `strength.mean = 0.7`, `interventions` absent), and this module's own live
 * capture fixture is an `exists_probability` write (1 → 0.79). **2.427 fixed
 * the TEXT; 2.1266 withheld the WRITE for node baselines only.** The
 * originally-witnessed edge write persisted the whole time, under both guards.
 *
 * ── WHY THIS IS A STRICTER GUARD, NOT A WIDER ONE ─────────────────────────
 * Its identity binding is TIGHTER than the node arm's. The node arm must ask
 * whether the moved node is one the option happens to be wired to — a shared
 * baseline every option reads, which is why the W1 false positive lives there.
 * An edge whose `from` IS the named option is unambiguously ABOUT that option:
 * there is no other entity it could belong to. So this arm cannot convert an
 * honest refusal into a corruption, and it is orthogonal to W1, whose measured
 * shape (*"change Fuel price to 1.40"*) moves a node and no edge at all.
 *
 * ── SCOPE, STATED AS A BOUND (trap 20) ────────────────────────────────────
 * Reads `strength.mean` and `exists_probability` ONLY — the two numeric claims
 * the captures actually moved. `effect_direction`, `provenance` and
 * `validation` are excluded on the same reasoning that excludes
 * `display_value` from the node arm: a guard that fired on them would withhold
 * on descriptive edits, the direction that destroys user work.
 *
 * Read from the BEFORE graph's edge set, so the edit under suspicion cannot
 * invent an edge that justifies withholding it.
 */
export function optionEdgeWritesLanded(
  before: GraphV3T,
  after: GraphV3T,
  optionId: string,
): string[] {
  const numeric = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const claims = (edge: GraphV3T['edges'][number]): string => {
    const strength = (edge as { strength?: { mean?: unknown } }).strength;
    return JSON.stringify([
      numeric(strength?.mean) ?? null,
      numeric((edge as { exists_probability?: unknown }).exists_probability) ?? null,
    ]);
  };

  const pre = new Map<string, string>();
  for (const edge of before.edges) {
    if (edge.from !== optionId) continue;
    pre.set(`${edge.from}->${edge.to}`, claims(edge));
  }

  const moved: string[] = [];
  const seen = new Set<string>();
  for (const edge of after.edges) {
    if (edge.from !== optionId) continue;
    const key = `${edge.from}->${edge.to}`;
    seen.add(key);
    // A NEW edge is a structural add, not a rewrite of an existing claim —
    // same posture as the node arm's treatment of a new node.
    if (!pre.has(key)) continue;
    if (pre.get(key) !== claims(edge)) moved.push(key);
  }

  // ⭐ A DELETED EDGE IS A WRITE TOO, and omitting it was a hole in this arm.
  //
  // The first cut of this function only walked `after.edges`, so an edge
  // present in `before` and ABSENT afterwards was never looked at: severing
  // the option's link to the factor the user named — the most destructive
  // wrong-entity outcome available — read as "no edge write" and was ALLOWED.
  // `anyInterventionWriteLanded` already treats a REMOVED effect value as a
  // write for exactly this reason; this arm now matches that posture.
  for (const key of pre.keys()) {
    if (!seen.has(key)) moved.push(key);
  }
  return moved;
}

/** At most this many factor names are spelled out before the notice summarises. */
const MAX_NAMED_IN_NOTICE = 3;

/**
 * The sentence a withheld turn MUST carry: *your change was not saved*.
 *
 * ⭐⭐ WHY THIS IS NOT OPTIONAL. Withholding is the honest choice when the graph
 * and the reply would otherwise disagree — but a SILENT withhold is its own
 * trust defect, and a worse one. In the W1 case (see the header) the user makes
 * an explicit, correct request, the applier does exactly what they asked, the
 * write is discarded, and without this sentence they are handed recovery copy
 * about the option's missing effect value and never told their edit was
 * dropped. That reads as the product quietly ignoring them.
 *
 * ⚠ IT STATES, IT DOES NOT OFFER (P8 — never ask what you cannot accept). There
 * is no "tell me again and I'll fix it": the product cannot currently bind that
 * answer, so promising it would be the same defect one level along. Asking the
 * user which entity they meant is the real exit and is rowed separately; until
 * that exists, the honest move is a plain statement of fact.
 *
 * ⚠ It must also survive the finaliser's success-claim backstop, so it is
 * phrased as a negation and never as a commit acknowledgement.
 */
export function formatWithheldWriteNotice(labels: readonly string[]): string {
  const named = labels.map((l) => l.trim()).filter((l) => l.length > 0);
  if (named.length === 0) {
    // Labels could not be resolved — say the true, unqualified thing rather
    // than naming nothing awkwardly.
    return 'Note: nothing from this message was saved, so the model is unchanged.';
  }
  const shown = named.slice(0, MAX_NAMED_IN_NOTICE).map((l) => `"${l}"`);
  const remainder = named.length - shown.length;
  const list =
    remainder > 0
      ? `${shown.join(', ')} and ${remainder} other${remainder === 1 ? '' : 's'}`
      : shown.length === 1
        ? shown[0]
        : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  const verb = named.length === 1 && remainder === 0 ? 'is' : 'are';
  return `Note: nothing from this message was saved, so ${list} ${verb} unchanged.`;
}

/** Resolve node ids to their labels, in the order given, skipping unknowns. */
export function resolveNodeLabels(graph: GraphV3T, nodeIds: readonly string[]): string[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  for (const id of nodeIds) {
    const label = byId.get(id)?.label;
    if (typeof label === 'string' && label.trim().length > 0) out.push(label);
  }
  return out;
}

/**
 * Decide whether this edit turn's graph write may persist.
 *
 * Pure: no I/O, no LLM, no telemetry. The caller owns emission and the
 * withhold, so the decision is testable without a dispatcher.
 */
export function decideOptionInterventionWrite(params: {
  readonly message: string;
  /** The pre-edit graph this turn was dispatched against. */
  readonly before: unknown;
  /** The applied graph, or null when the edit produced none. */
  readonly after: unknown;
  /** The dispatcher's own "a mutation truly applied" predicate. */
  readonly appliedMutation: boolean;
}): OptionInterventionWriteVerdict {
  if (!params.appliedMutation) return { verdict: 'allow', reason: 'no_write' };

  const parsedBefore = GraphV3.safeParse(params.before);
  const parsedAfter = GraphV3.safeParse(params.after);
  if (!parsedBefore.success || !parsedAfter.success) {
    return { verdict: 'allow', reason: 'graph_unparseable' };
  }
  const before = parsedBefore.data;
  const after = parsedAfter.data;

  // Reuse the SHIPPED verdict — the same intent detection, the same identity
  // resolution, the same `named_in_message` requirement, the same reader.
  const outcome = evaluateConfigureOptionOutcome({
    message: params.message,
    before: params.before,
    after: params.after,
  });
  // ⭐⭐ BOTH WRITE-PROTECTING VERDICTS, and the difference between them is
  // about COPY, not about the write. `not_honoured_no_copy` says exactly what
  // `not_honoured` says — configure-option intent, option resolved BY NAME, no
  // interventions write for it — and adds only that no true sentence is
  // available to replace the response with (the option already carries a value,
  // so *"this option has no effect values yet"* would be a lie).
  //
  // Accepting only `not_honoured` here made the WRITE protection inherit the
  // COPY predicate's domain, which is why a REVISION was unguarded: a drafted
  // graph arrives populated, so every later edit is a revision. Measured live,
  // 46 of 46 real captured turns reached no verdict at all.
  if (outcome.status !== 'not_honoured' && outcome.status !== 'not_honoured_no_copy') {
    return { verdict: 'allow', reason: 'outcome_not_unhonoured' };
  }

  if (anyInterventionWriteLanded(before, after)) {
    return { verdict: 'allow', reason: 'interventions_write_landed' };
  }

  // ⭐⭐ BIND BY IDENTITY, NEVER BY A VALUE PREDICATE (trap 19). A moved
  // baseline is only a substitute for THIS option's missing effect value if the
  // option is actually wired to that factor. Everything else is a different
  // edit — very often the one the user asked for — and discarding it destroys
  // their work. See `optionLinkedNodeIds` for the measured false positive.
  const movedNodeIds = baselineWritesLanded(before, after);
  const linked = optionLinkedNodeIds(before, outcome.optionId);
  const baselineNodeIds = movedNodeIds.filter((id) => linked.has(id));

  // The edge arm. Identity binding is `edge.from === optionId` — tighter than
  // the node arm's, because an edge out of the named option cannot be about any
  // other entity. See `optionEdgeWritesLanded`.
  const optionEdgeKeys = optionEdgeWritesLanded(before, after, outcome.optionId);

  if (baselineNodeIds.length === 0 && optionEdgeKeys.length === 0) {
    // The two allow reasons stay NAMED APART (they are two different facts, and
    // collapsing them is what let the W1 false positive through unseen): a turn
    // that moved nothing of either kind, vs one that moved a node the option is
    // not wired to.
    return {
      verdict: 'allow',
      reason: movedNodeIds.length === 0 ? 'no_baseline_write' : 'baseline_write_unrelated_to_option',
    };
  }

  return {
    verdict: 'withhold',
    optionId: outcome.optionId,
    optionLabel: outcome.optionLabel,
    baselineNodeIds,
    optionEdgeKeys,
  };
}
