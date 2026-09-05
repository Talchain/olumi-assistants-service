/**
 * ⭐⭐ THE PRODUCT MUST NOT ASK A USER TO CONFIRM A LINK THE ENGINE WILL THROW AWAY.
 *
 * ## The witnessed P0
 *
 * A user asked for a risk ("we need a risk of spending more money on development
 * resources and still not hitting our launch date"). The product agreed, proposed
 * it, held it for confirmation, the user approved, and it confirmed — creating
 * `option → risk` links from two hiring options. PLoT then deleted both links
 * before the analysis ran, and nothing said so. The user believes a risk they
 * asked for is in the model. It is not.
 *
 * ## The mechanism, DERIVED at the bytes (PLoT `d37c8cfd`, CEE `a401cc9a`)
 *
 *   · `filterOptionNodes` (PLoT `src/normalisation/option-filter.ts:91-96`) drops
 *     every edge **incident to** an option or decision node. There is no
 *     target-kind test and no exception: `NON_CAUSAL_NODE_KINDS = ['option',
 *     'decision']` (`src/types/engine-v3.ts:3437`).
 *   · An option's effect reaches the engine through the option's `interventions`
 *     map — a flat `Record<string, number>` (PLoT
 *     `src/integrations/isl/translator-v3.ts:116`) carried in `body.options`,
 *     **outside** `body.graph`, so the filter never touches it
 *     (`src/routes/v2/run.ts:5503-5504`).
 *     ⚠ That citation proves the map REACHES the engine. It does **not** prove
 *     the target must be a FACTOR: the key is a bare string, and PLoT validates
 *     only that the target exists in the graph, with no kind test
 *     (`translator-v3.ts:468-475`). The factor constraint is CEE-side —
 *     `orchestrator/tools/encode-option-interventions.ts:213-225`. Clause 4 of
 *     the refusal copy asserts both halves, so both are cited there.
 *   · The edit prompt already says this to the model:
 *     *"Do not use add_edge. Structural option-to-factor edges already exist;
 *     interventions set what values flow through them."* (`prompts/edit-graph-v6.ts:95-96`.)
 *
 * ⚠ **THE SENTENCE THIS MODULE MUST NEVER SHIP** is the one a previous attempt
 * (#1347) was rejected for: *"An option reaches a risk through a factor."* It is
 * FALSE. **No** edge out of an option survives, whatever its target. What survives
 * is the intervention VALUE, so the answerable question is about a value, not
 * about a connection — which is why the copy below asks *which factor, and by how
 * much*, and offers no route to build a link of any shape.
 *
 * ⚠⚠ **AND A TRUE SENTENCE IS NOT YET A ROUTABLE ONE** — the round-2 rejection.
 * Being unable to make a false promise is one requirement; the phrasing the copy
 * hands over must also reach the writer IN THE STATE THIS GATE CREATES, which is
 * not the state the estate's other option-effect copy was measured in. See
 * {@link buildEffectExemplar} for the executed matrix and the discriminating
 * pair. **If a fourth phrasing ever looks necessary, that is the signal to stop
 * and report rather than to try one** (trap 22f).
 *
 * ## Why the predicate is derived rather than a hand-written `option → risk` test
 *
 * Writing the guard against the failure mode in hand — rather than against the
 * spec — is CLAUDE.md trap 13d, and it is exactly how a fix ships blind to the
 * class it did not come in on. The spec here is PLoT's rule, which is symmetric
 * over option/decision **incidence**, so the predicate is:
 *
 *     incident to an option or a decision  AND  not a shape `ALLOWED_EDGES` admits
 *
 * `ALLOWED_EDGES` (`validators/graph-validator.types.ts:293-302`) is IMPORTED, not
 * copied — the two shapes it admits that touch a non-causal node are
 * `decision → option` and `option → factor`. Both are harmless: the first is pure
 * scaffolding carrying no causal claim, and the second is the structural companion
 * of an intervention, which is the route that does reach the engine. Everything
 * else incident to an option or a decision is deleted with nothing carrying it.
 *
 * ## NAMED RESIDUAL — a known gap, pinned rather than hidden
 *
 * The admission test reads **kind pairs only** and does not derive factor
 * categories, so `option → factor(observable)` is treated as admitted and does not
 * fire. That is a deliberate UNDER-fire in the conservative direction: a factor
 * target is answerable by the very question this gate asks, and firing there would
 * newly refuse a shape that ships today. `engine-discarded-link-gate.test.ts`
 * asserts this residual as an EXACT set, so the suite REDs if it grows or shrinks
 * (trap 22f's known-dropped-set rule).
 */

import { ALLOWED_EDGES } from '../../validators/graph-validator.types.js';
import { parseEdgeTargetPath } from '../graph-management/adapters/edit-graph-producer.js';
import { buildConfigureOptionAdvisedFormat } from '../configure-option-chip-text.js';
import { clampLabel, type ChangesetOpLike } from './describe-changeset.js';

/**
 * The kinds PLoT strips before the analysis runs — DERIVED from PLoT
 * `src/types/engine-v3.ts:3437` (`NON_CAUSAL_NODE_KINDS`). Named here because the
 * two services share no module and a silent divergence is the defect class this
 * file exists in. Documentation of the engine's rule; **not** this gate's trigger.
 */
const ENGINE_STRIPPED_KINDS: ReadonlySet<string> = new Set(['option', 'decision']);

/**
 * ⭐ THE GATE FIRES ON OPTION INCIDENCE ONLY, AND THAT IS A SCOPE DECISION, NOT AN
 * OVERSIGHT.
 *
 * PLoT strips decision-incident edges too, so `factor → decision` is discarded
 * exactly as `option → risk` is. It is deliberately out of scope here because
 * **this gate's remedy would not fit it**: the answerable question below is
 * *which factor does this option change, and by how much*, and that question is
 * meaningless when no option is involved. A predicate whose copy cannot honour
 * part of its own domain is the estate's trap 21 — two questions under one name.
 * The decision-only case is a different question with a different answer and
 * needs its own owner; until it has one it falls through to the ordinary hold,
 * which is where it is today. Pinned as a residual by the suite so it is visible
 * rather than forgotten.
 *
 * ⚠ Measured, not assumed: `edit-graph-dispatch-structural-split.test.ts`'s PROBE
 * C is a WITNESSED batch that links three new factors at `dec_plan`. Firing on
 * decision incidence hijacked that turn's structural-split disclosure and offered
 * it an option-shaped question about a factor. Caught by running the neighbouring
 * suites before the gate, not by inspection.
 */
const GATED_INCIDENT_KINDS: ReadonlySet<string> = new Set(['option']);

/**
 * The gate may only ever claim a link is discarded for a kind the ENGINE actually
 * strips. Asserted at module load rather than written in a comment: widening
 * {@link GATED_INCIDENT_KINDS} to a kind PLoT keeps would make every sentence this
 * module emits false, and a comment saying so is the hand-maintained mirror this
 * estate keeps paying for. Fails loud, at import, on the first wrong edit.
 */
for (const kind of GATED_INCIDENT_KINDS) {
  if (!ENGINE_STRIPPED_KINDS.has(kind)) {
    throw new Error(
      `engine-discarded-link-gate: '${kind}' is not stripped by the engine, so the ` +
        'refusal copy would be false for it',
    );
  }
}

/** One proposed link the engine would delete before the analysis runs. */
export interface EngineDiscardedLink {
  /** Resolved label of the link's source, or null when none is safe to render. */
  readonly fromLabel: string | null;
  /** Resolved label of the link's target, or null when none is safe to render. */
  readonly toLabel: string | null;
  /** The endpoint kind whose incidence causes the deletion ('option' | 'decision'). */
  readonly strippedKind: string;
  /** DISPLAY label of the option/decision endpoint, when one is safe to render. */
  readonly strippedLabel: string | null;
  /**
   * ⭐ THE SAME LABEL, UNTRUNCATED — and the two are NOT interchangeable.
   *
   * `strippedLabel` is clamped to 60 characters for prose. That clamp is the
   * reason the previous cut's exemplar could not name the option: a clamped
   * label matches NOTHING in `resolveOptionEffectWrite`, so a user who copies
   * the sentence back gets `option_not_named`. Measured (see the exemplar
   * header below): at an 87-character label the clamped form declines in BOTH
   * graph states while this form writes in both.
   *
   * Whitespace-normalised but never cut. Prose reads the clamped one; the
   * sentence the user is invited to SEND reads this one. Different jobs,
   * different strings — the split `validation-failure-responses.ts:1158-1163`
   * already established for the same seam.
   */
  readonly strippedRawLabel: string | null;
}

interface ResolvedNode {
  readonly label: string | null;
  readonly rawLabel: string | null;
  readonly kind: string | null;
}

/**
 * The label as the ROUTER will see it: whitespace-normalised (because
 * `resolveOptionEffectWrite` normalises the message the same way before
 * matching) and NEVER truncated. `clampLabel` does this and then cuts at 60;
 * this is that function without the cut, which is precisely the difference
 * between a sentence that binds and one that resolves `option_not_named`.
 */
function routableLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ');
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * Node identity from the persisted graph, falling back to the batch's own
 * `add_node` payloads — a link into a risk created in the SAME batch must still
 * resolve, or the gate would go quiet on the commonest shape of the witnessed P0
 * (add the risk and link it in one instruction).
 */
function collectBatchAdds(
  operations: readonly ChangesetOpLike[],
): ReadonlyMap<string, ResolvedNode> {
  const adds = new Map<string, ResolvedNode>();
  for (const op of operations) {
    if (op.op !== 'add_node') continue;
    const v = asRecord(op.value);
    const id = typeof v.id === 'string' ? v.id : typeof op.path === 'string' ? op.path : null;
    if (id === null || id.length === 0) continue;
    const declared = typeof v.label === 'string' ? v.label.trim() : '';
    adds.set(id, {
      label: declared.length > 0 ? clampLabel(declared) : null,
      rawLabel: declared.length > 0 ? routableLabel(declared) : null,
      kind: typeof v.kind === 'string' ? v.kind : null,
    });
  }
  return adds;
}

function resolveNode(
  nodeId: string,
  currentGraph: unknown,
  batchAdds: ReadonlyMap<string, ResolvedNode>,
): ResolvedNode {
  const nodes = asRecord(currentGraph).nodes;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      const rec = asRecord(n);
      if (rec.id !== nodeId) continue;
      const declared = typeof rec.label === 'string' ? rec.label.trim() : '';
      return {
        label: declared.length > 0 ? clampLabel(declared) : null,
        rawLabel: declared.length > 0 ? routableLabel(declared) : null,
        kind: typeof rec.kind === 'string' ? rec.kind : null,
      };
    }
  }
  return batchAdds.get(nodeId) ?? { label: null, rawLabel: null, kind: null };
}

/**
 * Is this kind pair one `ALLOWED_EDGES` admits? Kind pair ONLY — see the NAMED
 * RESIDUAL on the module header for why factor categories are deliberately not
 * read here.
 */
function admittedByAllowedEdges(fromKind: string | null, toKind: string | null): boolean {
  if (fromKind === null || toKind === null) return false;
  return ALLOWED_EDGES.some((r) => r.fromKind === fromKind && r.toKind === toKind);
}

/** Endpoints of an `add_edge` op — `value.from`/`value.to`, else the `a::b` path. */
function edgeEndpoints(op: ChangesetOpLike): { from: string; to: string } | null {
  const v = asRecord(op.value);
  if (typeof v.from === 'string' && typeof v.to === 'string' && v.from.length > 0 && v.to.length > 0) {
    return { from: v.from, to: v.to };
  }
  return typeof op.path === 'string' ? parseEdgeTargetPath(op.path) : null;
}

/**
 * Every `add_edge` in the batch that the engine would delete before the analysis
 * runs, with nothing else carrying the user's intent. Order-preserving.
 *
 * TOTAL: a hostile or unparseable operation contributes nothing rather than
 * throwing — the referee gate's own contract is that it never breaks a turn.
 */
export function findEngineDiscardedLinks(
  operations: readonly ChangesetOpLike[],
  currentGraph: unknown,
): readonly EngineDiscardedLink[] {
  const batchAdds = collectBatchAdds(operations);
  const found: EngineDiscardedLink[] = [];
  for (const op of operations) {
    if (op.op !== 'add_edge') continue;
    const endpoints = edgeEndpoints(op);
    if (endpoints === null) continue;
    const from = resolveNode(endpoints.from, currentGraph, batchAdds);
    const to = resolveNode(endpoints.to, currentGraph, batchAdds);
    // BOTH kinds must be known before this gate will speak. Incidence alone is
    // enough to know the edge is DELETED, but not enough to know nothing else
    // carries the user's intent — an unresolved target could be the factor an
    // intervention legitimately keys on. Refusing on a kind we could not read
    // would be asserting a harm we have not established, so the unresolved case
    // falls through to the ordinary hold. Conservative by construction.
    if (from.kind === null || to.kind === null) continue;
    const fromGated = GATED_INCIDENT_KINDS.has(from.kind);
    const toGated = GATED_INCIDENT_KINDS.has(to.kind);
    if (!fromGated && !toGated) continue;
    if (admittedByAllowedEdges(from.kind, to.kind)) continue;
    found.push({
      fromLabel: from.label,
      toLabel: to.label,
      strippedKind: fromGated ? from.kind : to.kind,
      strippedLabel: fromGated ? from.label : to.label,
      strippedRawLabel: fromGated ? from.rawLabel : to.rawLabel,
    });
  }
  return found;
}

/**
 * ⭐⭐ THE EXEMPLAR NAMES THE OPTION, FROM THE **RAW** LABEL — round three on this
 * one sentence, and the only round that is a measurement rather than a rephrasing.
 *
 * ## What the previous two cuts got wrong
 *
 *  · **#1347** advised *"tell me which factor they change and I will connect it
 *    that way instead"* — it promised a route the same filter deletes. FALSE.
 *  · **#1348 round 2** advised the OPTION-LESS form
 *    (`Set the option's effect on that factor to 0.6`). The sentence is TRUE, and
 *    it still does not reach the writer in the state this gate creates.
 *
 * ## Why the option-less form fails HERE, derived at the resolver
 *
 * With no option named, `resolveOptionEffectWrite` takes rule 3b
 * (`routing/option-effect-write.ts:1247`), which resolves the option from the
 * product's OUTSTANDING ASK — and rule 3b's first act is
 * `if (pairs.length === 0) return decline('option_not_named')` (`:967`). Those
 * pairs are live `missing_value` blockers. **This gate fires on a structural
 * `add_edge`, which says nothing about whether any effect value is outstanding**,
 * so the blocker set is routinely empty exactly when the gate speaks — it is
 * empty on this module's own fixture, whose option already carries
 * `interventions: { 'f-velocity': 0.6 }`.
 *
 * ## The measured matrix (executed against this resolver, both graph states)
 *
 * ```
 *                                    effect ALREADY set     effect OUTSTANDING
 *   option-less                      option_not_named       WRITE
 *   option named, RAW label          WRITE                  WRITE
 *   option named, CLAMPED label      option_not_named       option_not_named   (87-char label)
 * ```
 *
 * **The discriminating pair is the last two rows.** Naming the option is not what
 * broke the earlier attempt; TRUNCATING the name is. At a label short enough to
 * survive `clampLabel` the middle and bottom rows are the same string, which is
 * how the clamp hid in the earlier reasoning.
 *
 * ## The inherited premise, re-derived rather than trusted
 *
 * Round 2 omitted the option citing `validation-failure-responses.ts:1191-1196`.
 * That note is TRUE and was generalised too far: it says a **`safeLabel`-truncated**
 * label does not route. The comment block 33 lines ABOVE it
 * (`:1158-1163`) resolves the tension and was not carried across — *"the message
 * names the option IN FULL, from the RAW label rather than the displayed one …
 * The rendered sentence the user READS stays truncated; the replay the chip SENDS
 * is whole. Different jobs, different strings."* That is exactly the split applied
 * here.
 *
 * ## The two states this exemplar still does NOT write in, pinned not hidden
 *
 *  · The option already has this factor at this exact value → `value_already_set`.
 *    A truthful decline about a request that is already satisfied, not a dead end.
 *  · The option has NO `option → factor` edge at all → `factor_not_named`, which
 *    `option-effect-write.ts:1345-1350` makes a DELIBERATE hand-off to the edit
 *    lane ("the edit LLM can paraphrase-match a factor name this exact reader
 *    cannot, and can add a missing structural edge").
 *
 * Both are asserted as an EXACT set by the suite, so they RED if they grow or
 * shrink (trap 22f's known-dropped-set rule). Neither is a fourth phrasing
 * waiting to happen: a fourth phrasing cannot change either, because both are
 * facts about the GRAPH rather than about the sentence.
 *
 * ⚠ The factor slot stays the placeholder `that factor`, which the user
 * substitutes — the gate must not guess WHICH factor the option changes, and the
 * question one clause earlier is precisely that question. The routing claim is
 * therefore about the substituted sentence, and the suite substitutes a real
 * factor and runs the REAL resolver rather than asserting the string alone.
 */
function buildEffectExemplar(rawOptionLabel: string | null): string {
  return buildConfigureOptionAdvisedFormat(
    rawOptionLabel !== null ? `'${rawOptionLabel}'` : '',
    'that factor',
    '0.6',
  );
}

/**
 * The refusal copy. EVERY clause is a claim this module can point at:
 *
 *  1. "I have not put that link in the model."  — the gate returns
 *     `blockApply: true` with no chip and no pending on both the initial turn and
 *     the confirm re-referee, so nothing applies on either.
 *  2. "A link that starts or ends at {an option|a decision} is dropped before the
 *     analysis runs"  — PLoT `option-filter.ts:91-96`, incidence test, no
 *     exceptions.
 *  3. "so this one would never reach the numbers"  — same bytes; the deleted edge
 *     is not replaced by anything.
 *  4. "What does reach the numbers is an option's effect value on a factor"  —
 *     TWO claims with TWO different owners, and conflating them is how the
 *     earlier citation went wrong:
 *       · *reaches the numbers* — PLoT. The `interventions` map travels in
 *         `body.options`, outside the filtered graph, and is typed
 *         `Record<string, number>` (`run.ts:5503-5504`,
 *         `translator-v3.ts:116`, both exact at PLoT `d37c8cfd`).
 *       · *on a FACTOR* — **CEE, not PLoT.** `translator-v3.ts:116` types the
 *         key as a bare string, and PLoT's own request validation checks only
 *         that the target EXISTS in the graph, with no kind test
 *         (`translator-v3.ts:468-475` at PLoT `f19ed87a`). The factor
 *         constraint is ours: `orchestrator/tools/encode-option-interventions.ts:213-225`
 *         builds `factorById` from `kind === 'factor'` alone and admits an
 *         option's target only if it is in that map.
 *  5. the withheld-change disclosure  — see {@link buildEngineDiscardedLinkRefusal}'s
 *     `operationCount` parameter; a co-batched LEGAL edit is refused with the rest
 *     and the user is told so.
 *  6. the question, and the exemplar  — see {@link buildEffectExemplar} for the
 *     executed routing matrix.
 *
 * It states NO consequence for the goal, NO claim about what `0.0` means to the
 * solver, and offers NO alternative link shape. Each of those would be a sentence
 * this lane has not verified.
 *
 * Copy constraints, asserted by the suite rather than assumed: no em dash, no
 * internal token, clean against `findForbiddenPhraseHit` and `findSuccessClaimHit`
 * (the `Set …` exemplar is mid-sentence, never at a line start, because
 * `SUCCESS_CLAIM_PATTERNS` anchors that verb with the `m` flag).
 *
 * @param operationCount how many operations the refused batch carried IN TOTAL.
 *   ⭐ REQUIRED, NOT OPTIONAL, and that is the fix for the second defect this
 *   round closed. The disclosure used to be gated on `links.length > 1`, so a
 *   batch of `[option → risk, factor → risk, add_node]` was refused WHOLE while
 *   the copy named only the illegal link: two legal edits vanished and the
 *   *"I have left the whole change out"* sentence never fired (executed: 3
 *   operations, 1 discarded link, 2 silently withheld). The count the sentence
 *   turns on is `operationCount - links.length`, which is a different question
 *   from "how many links did I refuse" — two questions, two parameters
 *   (trap 21). A DEFAULT would make it a hand-maintained mirror of the caller's
 *   diligence, which is the shape `buildRepairPairChip`'s header already refuses.
 */
export function buildEngineDiscardedLinkRefusal(
  links: readonly EngineDiscardedLink[],
  operationCount: number,
): string {
  const first = links[0];
  if (first === undefined) {
    throw new Error('buildEngineDiscardedLinkRefusal requires at least one link');
  }
  const named =
    first.fromLabel !== null && first.toLabel !== null
      ? `the link from '${first.fromLabel}' to '${first.toLabel}'`
      : 'that link';
  // Two independent clauses because they answer two independent questions: how
  // many OTHER links share this fate, and whether anything LEGAL was withheld
  // with them. One conjunction served both and could only ever tell the truth
  // about the first.
  const alsoCount = links.length - 1;
  const alsoDiscarded =
    alsoCount > 0
      ? ` The same is true of ${alsoCount} other link${alsoCount === 1 ? '' : 's'} in this change.`
      : '';
  const withheldCount = Math.max(0, operationCount - links.length);
  const withheld =
    withheldCount > 0
      ? ` I have left the whole change out rather than apply part of it, so the ` +
        `${withheldCount} other change${withheldCount === 1 ? '' : 's'} in the same ` +
        `instruction ${withheldCount === 1 ? 'is' : 'are'} not in the model either.`
      : '';
  const subject =
    first.strippedLabel !== null ? `'${first.strippedLabel}'` : 'that option';
  return (
    `I have not put ${named} in the model, because it would not survive to the ` +
    `analysis. A link that starts or ends at an option is dropped before the ` +
    `analysis runs, so this one would never reach the numbers, and telling you it ` +
    `was in the model would be untrue.${alsoDiscarded}${withheld} What does reach ` +
    `the numbers is an option's effect value on a factor. Tell me which factor ` +
    `${subject} changes and by how much, like this: ` +
    `"${buildEffectExemplar(first.strippedRawLabel)}" (any number from 0 to 1).`
  );
}
