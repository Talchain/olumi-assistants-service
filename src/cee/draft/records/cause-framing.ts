/**
 * ⭐⭐⭐ THE CONDITIONAL OPTION FLOOR — a stated CAUSE is not a course of action,
 * and a diagnosis brief is allowed to end with no options at all.
 *
 * ── THE WITNESSED DEFECT (CEE issue #1287, fresh guest, 31 Aug 2026) ────────
 * Quartet UI `45b927b2` / CEE `d0544243`; served `draft_graph` **v201** from the
 * store, wire hash `fab9aa27bb82`. A diagnosis brief — renewal rate 91% → 78%,
 * four teams each blaming a different cause, *"I need to understand which of
 * these is actually driving the drop"* — drafted **five `kind:"option"` nodes,
 * four of them the user's competing hypotheses**, three as raw clause fragments:
 *
 *   option  "the migration backlog - we still have about 40 accounts stuck on the o…"
 *   option  "The Price Rise We Pushed Through in January"
 *   option  "the competitor's new analytics module is genuinely better than ours"
 *   option  "we simply stopped doing exec-level QBRs after the reorg"
 *   option  "Run a structured churn analysis…"        ← the only genuine action
 *
 * Each hypothesis was ALSO modelled as a factor, so the same four concepts
 * existed twice — once as choices, once as causes — and the product was
 * preparing to compute a win probability for *"The Price Rise We Pushed Through
 * in January"*. That is a number about a hypothesis presented as a choice.
 *
 * ── ⭐ WHY THIS IS CODE AND NOT MORE PROMPT TEXT ───────────────────────────
 * The prompt lever has now been pulled TWICE against this exact defect, and the
 * wire has refuted both. Do not pull it a third time without new evidence:
 *
 *   1. `instruction.ts` (records instruction **v11**, in this repo, deployed)
 *      already carries the rule in full — *"A proposed CAUSE is the case this
 *      catches most often… It is not a stated_item of any kind… Put the span in
 *      `claims` instead"* and *"do not hunt the brief for an option that is not
 *      there, and do not promote one of the causes to fill the gap."* That text
 *      was live at `d0544243`, the commit the #1287 capture was taken on.
 *   2. `draft_graph` **v201** (PR #1238, the ACTION TEST delta) was minted for
 *      this defect and is the version #1287 was captured against. Its own PR
 *      states the candidate arm was UNMEASURED; #1287 is that measurement, and
 *      it is a fail.
 *
 * Two prompt revisions, one of them written specifically for this class, and the
 * model still promoted four hypotheses to options. A third wording is a
 * probabilistic containment, not a fix. This module is deterministic.
 *
 * ── ⚠ TRAP 21: THIS IS NOT THE DECISION-FRAMING GUARD, AND MUST NOT BE MERGED
 * WITH IT ──────────────────────────────────────────────────────────────────
 * `option-framing.ts` and this module look adjacent and answer DIFFERENT
 * questions, so their RECOVERIES are opposites and aligning them would recreate
 * one of the two defects:
 *
 *   · `decision_framing_not_an_option` — *the user IS choosing; the model put the
 *     QUESTION on the graph as a branch.* The alternatives exist and were
 *     mis-shaped, so `optionFramingRecovery` correctly returns 400 and asks the
 *     user to name them.
 *   · `cause_framing_not_an_option` (here) — *the user is NOT choosing; the model
 *     promoted their EXPLANATIONS to branches.* There are no alternatives to
 *     name. Asking for two courses of action is the exact fabrication pressure
 *     the ruling forbids, so this class must NEVER reach that 400. It does not:
 *     `optionFramingGaps` filters on the other reason string by name.
 *
 * ── WHAT THE CONTRACTS ALREADY ADMIT (derived at the bytes, not assumed) ────
 * No new node kind is needed and none is minted here. `validators/decision-free-
 * shape.ts` already makes `decisions === 0 && options === 0` a LEGAL, admitted
 * shape at every gate that could refuse it — `graph-structure-validator.ts:374`,
 * `graph-validator.ts:363/393/614`, `cee/options/index.ts:55`,
 * `cee/bias/index.ts:115`, `cee/quality/index.ts:91`. The hypotheses have a
 * legal substrate already: they are `claims` with `claim_kind: "factor"`, which
 * is where the records instruction sends them and where the #1287 capture had
 * already put them a second time. So the honest end state for a diagnosis brief
 * is the MAPPING shape, and the platform accepts it today.
 *
 * ── THE CARDINALITY FALL-BACK, AND WHY IT IS PART OF THIS MODULE ───────────
 * Quarantining the four hypotheses in the #1287 capture leaves ONE option and
 * one minted decision — the `>=1 decision, <2 options` cell, which every
 * validator refuses. A guard that withdrew the hypotheses and stopped there
 * would trade a fabrication for a 422. So when a withdrawal drops the surviving
 * set below `MIN_OPTIONS`, the projection falls the rest of the way to the
 * MAPPING shape: the remaining options and the minted decision are withdrawn too
 * and DISCLOSED under their own reason. Nothing is invented to make the count.
 * That is the conditional floor: 2–6 options when the brief is choosing, zero
 * when it is not, and never a number reached by promoting a cause.
 *
 * ── THE PREDICATE IS DELIBERATELY NARROW, AND ITS GAP IS PINNED ────────────
 * `isStatedCauseFraming` guards TWO OPPOSITE HARMS that cannot share a window
 * (trap 22b): too wide and it DELETES a user's real alternative; too narrow and
 * the fabrication survives. Platform trap 22f is explicit that no further
 * punctuation rule settles an ambiguous natural-language predicate, so this one
 * does not try to classify English. It requires a CONJUNCTION of three
 * independently-checkable facts, two of them structural:
 *
 *   1. the node is an option the projector marked `provenance_class: "stated"` —
 *      an AI-authored `option_refinement` is NEVER touched, so the model's own
 *      proposed actions cannot be suppressed by this guard at all;
 *   2. the span is SUBJECT-HEADED — it opens with a determiner or a pronoun, not
 *      with a verb. Every genuine stated option in this repo's own fixture
 *      corpus is verb-headed ("hire more support staff", "open a second
 *      warehouse in Leeds", "Keep prices unchanged", "cutting our burn rate by
 *      30%"); not one is subject-headed;
 *   3. the span makes a FINITE DECLARATIVE PREDICATION — a copula, or a pronoun
 *      subject with a stative/past verb. This is what makes a span true-or-false
 *      rather than something you carry out, which is the producer's OWN stated
 *      discriminator (`instruction.ts`: *"If the span is instead something that
 *      can be TRUE or FALSE, it is not an option"*). It is also why a bare noun
 *      phrase survives: *"the events budget"* is subject-headed and asserts
 *      nothing, and the instruction names it as a legitimate option span.
 *
 * The corpus is not this author's. The positives are the four labels banked in
 * #1287; the negatives are every `kind: "option"` span already present in this
 * repo's fixtures plus the instruction's own examples. `KNOWN_NOT_CAUGHT` in the
 * spec pins the gap EXACTLY — spans that are causes and are deliberately not
 * matched — so the suite REDs if the gap grows OR shrinks, rather than the gap
 * being invisible (trap 22f's honest-gap rule).
 *
 * ⚠ THE GUARD ONLY EVER WITHDRAWS AND DISCLOSES. It never renames a node, never
 * reclassifies one, never mints a replacement, and never adds an edge — the
 * three moves that would turn a suppression into a new fabrication.
 */
import type { DraftRecordSet } from './grammar.js';
import type {
  ProjectedEdge,
  ProjectedNode,
  RecordProjection,
} from './projector.js';
import { canonicalText } from './projector.js';
import { MIN_OPTIONS } from '../../../validators/graph-validator.types.js';
import { decisionFreeCountsFromNodes, isDecisionFreeShape } from '../../../validators/decision-free-shape.js';

/**
 * A span opens with a subject rather than an action: a determiner, a
 * demonstrative, a possessive determiner, or a personal pronoun.
 *
 * Function words only, so this is not a content mirror that drifts as the
 * product's vocabulary changes (trap 12). It is the cheap half of the
 * conjunction and it alone decides nothing.
 */
const SUBJECT_HEAD =
  /^(?:the|a|an|this|that|these|those|our|their|its|his|her|my|your|we|they|it|he|she|i|you)\b/iu;

/**
 * A finite copula asserting a predicate about the world.
 *
 * The two exclusions are load-bearing, not tidiness:
 *   · `is to <verb>` — *"our best move is to cut prices"* names an ACTION in a
 *     copular frame. Flagging it would delete a real alternative.
 *   · `is <verb>ing` — the progressive *"the change we are planning"* likewise
 *     describes something being done, not a state being asserted.
 */
const COPULA_PREDICATION =
  /\b(?:is|are|was|were)\s+(?!to\s)(?![\p{L}]+ing\b)[\p{L}\p{N}]/iu;

/**
 * A personal-pronoun subject carrying a stative or past-tense verb: *"we still
 * have about 40 accounts stuck"*, *"We Pushed Through in January"*, *"we simply
 * stopped doing exec-level QBRs"*. Both report how things ARE or what ALREADY
 * HAPPENED, which the records instruction names as not-an-option twice.
 *
 * The adverb slot is optional and bounded at two, so the pattern stays a
 * predication test rather than a sentence parser.
 */
const SUBJECT_PREDICATION =
  /\b(?:we|they|i|he|she|it|you)\s+(?:(?:[\p{L}]+ly|still|already|just|never|only|then|also|simply|recently)\s+){0,2}(?:have|has|had|[\p{L}]{3,}ed)\b/iu;

/**
 * Words ending in `-ed` that are NOT past-tense verbs. Without this, *"we speed
 * up the migration"* and *"we proceed with the Leeds warehouse"* — legitimate,
 * if unusually phrased, options — match `[\p{L}]{3,}ed` and are withdrawn.
 *
 * ⭐ EVERY ENTRY CAN ACTUALLY FIRE, AND THAT IS NOT A TIDY-UP. This list first
 * carried `need`, `feed`, `deed`, `heed`, `seed`, `weed`, `reed` as well —
 * SEVEN entries that `[\p{L}]{3,}ed` cannot match at all, because that pattern
 * needs three letters BEFORE the `ed` and so has a five-character floor. A
 * mutation neutralising the whole list SURVIVED the first corpus, and the
 * shortest explanation was that half of it was guarding nothing: an exclusion
 * that cannot fire is a guard agreeing with itself, and it makes the list look
 * better tested than it is. Entries below the floor are removed and the floor is
 * named as what protects them.
 *
 * The remainder IS a hand-written list, deliberately: it is closed vocabulary of
 * English, not a list of product concepts, so it does not drift with the
 * codebase. The spec exercises it by name.
 */
const NON_PAST_ED = new Set([
  'indeed', 'exceed', 'proceed', 'succeed', 'speed', 'embed', 'breed', 'greed',
  'creed', 'bleed', 'steed', 'tweed', 'misdeed',
]);

/** Strip the `-ed` matches that are not past-tense verbs before testing. */
function withoutNonPastEd(source: string): string {
  return source.replace(/[\p{L}]+/gu, (word) =>
    NON_PAST_ED.has(word.toLowerCase()) ? '·' : word,
  );
}

/**
 * TRUE only for a subject-headed span that asserts something — a proposition,
 * which can be true or false and therefore cannot be carried out.
 *
 * Deliberately narrow. A cause phrased as a bare noun phrase ("the migration
 * backlog") asserts nothing and is NOT matched; see `KNOWN_NOT_CAUGHT` in the
 * spec, which pins that gap exactly rather than leaving it unobserved.
 */
export function isStatedCauseFraming(text: string): boolean {
  const source = canonicalText(text);
  if (!SUBJECT_HEAD.test(source)) return false;
  const scanned = withoutNonPastEd(source);
  return COPULA_PREDICATION.test(scanned) || SUBJECT_PREDICATION.test(scanned);
}

export type CauseFramingReason =
  | 'cause_framing_not_an_option'
  | 'no_comparison_after_cause_withdrawal';

export interface WithdrawnOption {
  readonly reason: CauseFramingReason;
  readonly node_id: string;
  readonly label: string;
  /** Retained for the caller's disclosure/evidence; never an analysis option. */
  readonly original_node: ProjectedNode;
  readonly incident_edges: readonly ProjectedEdge[];
}

export interface DraftCauseFramingResult {
  readonly projection: RecordProjection;
  readonly withdrawn: readonly WithdrawnOption[];
  /** TRUE when the projection was taken all the way to the mapping shape. */
  readonly fellToMappingShape: boolean;
}

/** Remove a node set and its incident edges; recompute roots/leaves. */
function withoutNodes(
  projection: RecordProjection,
  removedIds: ReadonlySet<string>,
): RecordProjection {
  const provenance: Record<string, unknown> = { ...projection.provenance };
  const nodes = projection.graph.nodes.filter((node) => !removedIds.has(node.id));
  const edges = projection.graph.edges.filter((edge) => {
    if (!removedIds.has(edge.from) && !removedIds.has(edge.to)) return true;
    delete provenance[edge.id];
    return false;
  });
  for (const id of removedIds) delete provenance[id];
  const hasIncoming = new Set(edges.map((edge) => edge.to));
  const hasOutgoing = new Set(edges.map((edge) => edge.from));
  return {
    ...projection,
    graph: {
      ...projection.graph,
      nodes,
      edges,
      meta: {
        ...projection.graph.meta,
        roots: nodes.filter((node) => !hasIncoming.has(node.id)).map((node) => node.id),
        leaves: nodes.filter((node) => !hasOutgoing.has(node.id)).map((node) => node.id),
      },
    },
    provenance: provenance as RecordProjection['provenance'],
  };
}

function describe(
  projection: RecordProjection,
  node: ProjectedNode,
  reason: CauseFramingReason,
  label: string,
): WithdrawnOption {
  return {
    reason,
    node_id: node.id,
    label,
    original_node: structuredClone(node),
    incident_edges: structuredClone(
      projection.graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id),
    ),
  };
}

/**
 * Pure and idempotent. Records are evidence and are never rewritten; only their
 * PROJECTION is corrected. Every numerical field on every surviving node is
 * preserved untouched.
 *
 * `records` is read for nothing but the stated spans behind the option nodes, so
 * the guard cannot be defeated by a projector label rewrite: a node whose
 * DISPLAY string was authored while `provenance_class` stayed `stated` is still
 * tested against the user's verbatim `source_quote` (`projector.ts:2085`).
 */
export function reconcileDraftCauseFraming(
  records: DraftRecordSet,
  projection: RecordProjection,
): DraftCauseFramingResult {
  void records;
  const withdrawn: WithdrawnOption[] = [];
  const removedIds = new Set<string>();

  const optionNodes = projection.graph.nodes.filter((node) => node.kind === 'option');
  for (const node of optionNodes) {
    const prov = projection.provenance[node.id] ?? node.provenance;
    // An option the MODEL proposed is never withdrawn by this guard. The defect
    // is the promotion of the USER's explanations, and confining the guard to
    // `stated` is what makes a suppressed genuine alternative impossible on the
    // whole `ai_inferred` half of the option set.
    if (prov?.provenance_class !== 'stated') continue;
    const quote = typeof prov.source_quote === 'string' ? prov.source_quote : undefined;
    const framingText = quote !== undefined && isStatedCauseFraming(quote)
      ? quote
      : isStatedCauseFraming(node.label) ? node.label : undefined;
    if (framingText === undefined) continue;
    removedIds.add(node.id);
    withdrawn.push(describe(projection, node, 'cause_framing_not_an_option', framingText));
  }

  if (removedIds.size === 0) {
    return { projection, withdrawn: [], fellToMappingShape: false };
  }

  // ── The conditional floor ────────────────────────────────────────────────
  // A withdrawal that leaves fewer than MIN_OPTIONS leaves an INVALID graph, not
  // a smaller one. The honest completion is the mapping shape the platform
  // already admits, never an invented alternative and never a 400 demanding one.
  //
  // ⭐ ADMISSIBILITY IS NOT DECIDED HERE. `isDecisionFreeShape` is the platform's
  // ONE structural-admission predicate and this module CONSUMES it rather than
  // restating the rule — a second definition of "legally admissible with zero
  // options" is the differently-named-twin defect this estate keeps paying for.
  // The only local judgement is the FLOOR (`MIN_OPTIONS`), which is this seam's
  // own question, and it is imported from the validator that owns it.
  const survivors = optionNodes.filter((node) => !removedIds.has(node.id));
  const wouldStayAdmissible = survivors.length >= MIN_OPTIONS
    || isDecisionFreeShape(decisionFreeCountsFromNodes(
      projection.graph.nodes.filter((node) => !removedIds.has(node.id)),
    ));
  const fellToMappingShape = !wouldStayAdmissible;
  if (fellToMappingShape) {
    for (const node of survivors) {
      removedIds.add(node.id);
      withdrawn.push(
        describe(projection, node, 'no_comparison_after_cause_withdrawal', node.label),
      );
    }
    // The decision node is MINTED by the projector and only because options
    // existed (`projector.ts:3207`). With none left it names a choice that is
    // not being made, so it goes with them — that is what makes the result the
    // legal `decisions === 0 && options === 0` shape rather than the refused
    // `0 options with a decision` one.
    for (const node of projection.graph.nodes) {
      if (node.kind !== 'decision' || removedIds.has(node.id)) continue;
      removedIds.add(node.id);
      withdrawn.push(
        describe(projection, node, 'no_comparison_after_cause_withdrawal', node.label),
      );
    }
  }

  return { projection: withoutNodes(projection, removedIds), withdrawn, fellToMappingShape };
}

export const CAUSE_FRAMING_WARNING_ID = 'HYPOTHESIS_NOT_AN_OPTION';
export const NO_COMPARISON_WARNING_ID = 'NO_COMPARISON_TO_RUN';

interface CauseFramingGap {
  reason: CauseFramingReason;
  node_id: string;
  label: string;
}

/** Read the existing disclosure carrier; never infer a gap from a node count. */
export function causeFramingGaps(disclosures: unknown): CauseFramingGap[] {
  if (!Array.isArray(disclosures)) return [];
  return disclosures.filter((entry): entry is CauseFramingGap =>
    entry !== null && typeof entry === 'object'
    && (entry.reason === 'cause_framing_not_an_option'
      || entry.reason === 'no_comparison_after_cause_withdrawal')
    && typeof entry.node_id === 'string' && typeof entry.label === 'string',
  );
}

/**
 * Explicit human-readable disclosure. A withdrawal the user is not told about is
 * the same defect one level down — their words left the model and nothing said
 * so — and the second message must not read as a failure: ending with no
 * comparison is the CORRECT outcome for a brief that was not choosing.
 */
export function causeFramingWarnings(disclosures: unknown) {
  const gaps = causeFramingGaps(disclosures);
  const causes = gaps.filter((gap) => gap.reason === 'cause_framing_not_an_option');
  const warnings = causes.map((gap) => ({
    id: CAUSE_FRAMING_WARNING_ID,
    severity: 'medium' as const,
    affected_node_ids: [],
    affected_edge_ids: [],
    explanation:
      `“${gap.label}” is an explanation for what is happening, not a course of action. `
      + 'It was kept out of the comparison; it stays in the model as something that varies.',
    fix_hint:
      'Name a course of action if you want alternatives compared. '
      + 'No alternative has been invented to fill the gap.',
  }));
  if (gaps.some((gap) => gap.reason === 'no_comparison_after_cause_withdrawal')) {
    warnings.push({
      id: NO_COMPARISON_WARNING_ID,
      severity: 'medium' as const,
      affected_node_ids: [],
      affected_edge_ids: [],
      explanation:
        'This brief sets out competing explanations rather than alternatives to choose between, '
        + 'so the model holds them as causes and there is no comparison to run yet.',
      fix_hint:
        'Add the courses of action you are weighing when you have them. '
        + 'Nothing was invented to make a comparison possible.',
    });
  }
  return warnings;
}
