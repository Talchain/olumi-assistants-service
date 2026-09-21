/**
 * Replacement conversation layer — ONE bounded repair plan for a model that
 * cannot be analysed yet.
 *
 * ── THE SESSION THIS EXISTS TO STOP REPEATING (`48a1ce84`, 21 Sep 2026) ────
 * Across nine exchanges the product asked Paul for one number at a time,
 * repeated the same four-item list four times — including immediately after he
 * asked for concision — and told him:
 *
 *   "Tackling them together isn't possible in one step. Each mapping is a
 *    separate fix, so pick one option to start with."
 *
 * He never reached analysis. His verdict: *"It only works if you have a really
 * good understanding of causal models. It's not giving science-grounded
 * coaching to enhance reasoning."*
 *
 * ── THE THREE THINGS THAT PRODUCED IT, EACH MEASURED ON THIS BRANCH ───────
 *
 * 1. **THE PRODUCT CANNOT TELL ITS OWN GUESSES FROM THE USER'S JUDGEMENT WHEN
 *    IT SPEAKS.** The readiness authority already decides this, per gap, and
 *    stamps it: `CanonicalReadinessRequiredInput.obligation` is `'required'`
 *    (the user authored the structure, so this may be asked of them) or
 *    `'offered'` (Olumi authored it, so it may be offered and never demanded —
 *    INV-P6). That field's own docblock says the consuming surface is a
 *    different lane and that "until it reads this field, the marking is
 *    carried and unread". It is still unread: `readinessQuestions()` projects
 *    `unresolved_inputs[].prompt` and **drops `obligation`, `provenance`,
 *    `option_id` and `factor_id`**, and `run-analysis-tool.ts`'s
 *    `refusalForBlockedModel` then tells the model that "the missing
 *    judgements are theirs" — of every gap, without distinction. This module
 *    is that consuming surface.
 *
 * 2. **A SINGLE BLOCKER PRODUCES NO BREAKDOWN AT ALL.**
 *    `repairProposal` is null unless `blockingIssues.length >= 2`
 *    (`analysis-ready-helper.ts`), so `readinessQuestions` returns `[]` and the
 *    model gets one `blockedNextStep` sentence. This module reads
 *    `assessment.blockingIssues` directly, which is populated at every count.
 *
 * 3. **"TACKLING THEM TOGETHER ISN'T POSSIBLE" WAS TRUE OF THE MACHINERY.**
 *    `accept_proposal` refuses a second write per turn (`second_write_this_turn`),
 *    correctly — the applier's `ON CONFLICT (scenario_id, turn_id) DO NOTHING`
 *    swallows the second append entirely. `operationsToApplyBatch` was built to
 *    fix that and, measured at this tip with a contrast control, **had zero
 *    production callers** (`operationsToApply`, the singular, is called at
 *    `run-replacement-turn.ts:641`). So the sentence was a true report of an
 *    unfinished mechanism. Wiring it is the other half of this change.
 *
 * ── THE TWO POPULATIONS, AND WHY THEY ARE TWO TYPES RATHER THAN ONE FLAG ──
 *
 * Paul's first requirement is to *"distinguish AI estimates from genuinely
 * missing human judgement"*. Those are not two shades of one list; they are
 * different objects with different evidence, so they are {@link RepairOffer}
 * and {@link RepairAsk} and the discrimination is structural rather than a
 * string a caller might forget to branch on.
 *
 *   · **An OFFER** is a cell where Olumi already holds a number it can stand
 *     behind — a machine-authored `interventions[factorId]` value sitting in
 *     the graph that the user has never seen or endorsed. Olumi shows the
 *     number and asks whether it is about right. These do NOT block the run,
 *     and that is exactly why they matter: the analysis would proceed on
 *     Olumi's own guesses.
 *   · **An ASK** is a gap the readiness authority reports as blocking, where
 *     Olumi holds nothing it may offer. It gets the authority's own prompt,
 *     verbatim.
 *
 * ⛔ **NO NUMBER IS EVER INVENTED HERE, AND THE PROOF IS THAT THIS MODULE
 * CANNOT.** Every offer is built by calling the shipped {@link setOptionEffect}
 * with a value READ OUT OF THE GRAPH, so every refusal that tool already makes
 * — `factor_has_no_range`, `factor_not_linked_to_option`, `value_out_of_range`,
 * `unknown_option` — applies unchanged, and this path cannot acquire a power
 * the ordinary one does not have. A cell whose stored figure is unusable (a
 * string, a bare `raw_value` with no normalised share) yields NO offer: it is
 * silently absent from `offers`, because converting it would be the invention
 * that both the prompt and `set-option-effect.ts`'s own docblock forbid.
 *
 * ⚠ **AND THE DISTINCTION THIS MODULE MUST NOT COLLAPSE (trap 21).**
 * `obligation` answers *"may this gap be put to the user as a demand?"*.
 * Whether Olumi HOLDS a number answers *"is there anything to offer?"*. They
 * are different questions with different authorities, and they disagree:
 * measured on the captured journey graph, `structureProvenanceOfEffect` returns
 * `ai_drafted` for `36ab03a2 × 35a64cfe`, a cell with **no intervention entry
 * and no edge at all**, because it falls back to the weakest end. So
 * provenance alone can never tell you a value exists. Both are carried, neither
 * is derived from the other.
 *
 * NO CLOCK, NO NETWORK, NO WRITES. Pure over (admission, graph).
 */

import {
  classifyIssueObligation,
  reflectsAHumanAct,
  structureProvenanceOfEffect,
  type ObligationClass,
  type StructureProvenance,
} from '../../cee/graph-readiness/obligation-provenance.js';
import { mergeInterventionSources } from '../../orchestrator/tools/analysis-ready-helper.js';
import { isDirectedEdge } from '../../schemas/graph.js';
import { MAX_COMPOUND_OPERATIONS } from './proposal-store.js';
import { setOptionEffect, type EffectGraph } from './set-option-effect.js';

import type { CanonicalReadinessIssue } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { RunAdmission } from '../tools/handlers/analysis-ready-core.js';

/**
 * A number Olumi holds and can stand behind, put to the user for confirmation
 * or change.
 *
 * `value`, `summary` and `operations` all come from one {@link setOptionEffect}
 * call over the value read out of the graph — so the sentence the user sees and
 * the bytes that would be written cannot disagree about what is being offered.
 */
export interface RepairOffer {
  readonly option_id: string;
  readonly option_label: string;
  readonly factor_id: string;
  readonly factor_label: string;
  /** Read from the graph through {@link mergeInterventionSources}. Never derived. */
  readonly value: number;
  /**
   * Who authored the number, from the ONE authority. Guaranteed NOT to
   * {@link reflectsAHumanAct} — a value the user stated or ratified is theirs,
   * and describing it back to them as Olumi's invention is the worse error of
   * the two (`obligation-provenance.ts`, `reflectsAHumanAct`).
   */
  readonly provenance: StructureProvenance;
  /** `setOptionEffect`'s own summary — the proposal's user-facing line. */
  readonly summary: string;
  /** `setOptionEffect`'s own patch operations. Nothing is composed here. */
  readonly operations: readonly Record<string, unknown>[];
}

/**
 * A gap the readiness authority reports and Olumi has no basis to fill.
 *
 * `prompt` is the authority's own message, verbatim. This module SELECTS; it
 * never composes a question, for the same reason `readinessQuestions` does not:
 * a second module minting prompts would be a second authority on what is
 * outstanding.
 */
export interface RepairAsk {
  readonly issue_id: string;
  readonly category: CanonicalReadinessIssue['category'];
  /** The authority's own words. Never composed here. */
  readonly prompt: string;
  readonly option_id?: string;
  readonly option_label?: string;
  readonly factor_id?: string;
  readonly factor_label?: string;
  /**
   * ⛔ THE FIELD PAUL'S FIRST REQUIREMENT TURNS ON. `'required'` may be put as a
   * question the user owes an answer to; `'offered'` may only be invited,
   * because Olumi authored the structure the gap is over (INV-P6). Copied from
   * the authority, never re-derived.
   */
  readonly obligation: ObligationClass;
  readonly provenance: StructureProvenance;
  /** True when the run will proceed by excluding or holding this option — the
   *  exclusion answers the gap, not the user. Carried so the copy can say so. */
  readonly waived_by_exclusion: boolean;
}

/**
 * How a blocked option→risk link can be cleared. Two kinds, and they are not
 * interchangeable — see {@link RepairBlockedLink}.
 */
export type LinkResolutionKind =
  /** Keep the link, mark it so the engine never sees it. Non-destructive. */
  | 'keep_out_of_comparison'
  /** Take the link out of the model entirely. Destructive, and honest. */
  | 'remove_link';

export interface RepairLinkResolution {
  readonly kind: LinkResolutionKind;
  readonly summary: string;
  readonly operations: readonly Record<string, unknown>[];
  /** Set when the resolution encodes a claim beyond "leave it out". Must be
   *  said out loud; see {@link buildLinkResolution}. */
  readonly caveat?: string;
}

/**
 * ⭐⭐⭐ AN OPTION HELD BACK BY A LINK, NOT BY A MISSING NUMBER — and the reason
 * the product asked Paul the wrong question for a whole session.
 *
 * ── THE GATE, VERIFIED AT THE BYTES (`cee/transforms/analysis-ready.ts:680-694`)
 * ANY option→risk edge that is not `bidirected` stamps the option
 * `needs_user_mapping`, and `unresolvedTargetCount > 0` short-circuits every
 * other check (`cee/transforms/option-status.ts:266`). The code says in its own
 * comment why no value can clear it: *"A causal coefficient is not an
 * intervention level; other numeric effects cannot resolve this missing
 * mapping."*
 *
 * ⛔ SO EVERY "SET THIS VALUE" REPAIR LEAVES THE MODEL EXACTLY AS UNANALYSABLE.
 * Reproduced on this branch against the captured graph with a contrast control:
 * adding one option→risk edge flips `willProceed` true→false with
 * `OPTION_NEEDS_MAPPING`, and the SAME edge marked `bidirected` leaves it
 * analysable. The option already carried three effect values; nothing was
 * missing. The authority's own prompt for it is *"Choose which factor
 * <option> changes and by how much"* — it names a FACTOR when the blocker is a
 * RISK, which is the question Paul spent a session trying to satisfy.
 *
 * ⛔ AND THE EXCLUSION ROUTE DOES NOT REACH IT, measured with a positive
 * control. `OPTION_NEEDS_MAPPING` is in `WAIVABLE_BY_EXCLUSION`, but
 * `gateAnalysableOptions` only ever considers options where
 * `hasEmptyInterventions` holds — it returns the input by reference otherwise.
 * A risk-blocked option HAS interventions, so it is never excluded:
 * `waivedOptionIds` is empty and `will_scaffold_options` is false. The control
 * is that the same machinery DOES fire on this graph when an option's
 * interventions are deleted, so the absence is a rule and not blindness.
 *
 * ⚠ THE GATE ITSELF IS NOT OURS TO FIX — readiness/admission is Core's, and so
 * is the contract question underneath (is an option→risk edge a qualitative
 * hypothesis to exclude with disclosure, or a quantity the user must supply?).
 * What is built here is the INTERACTION that repairs the graph, and it works
 * whether or not that ruling lands.
 */
export interface RepairBlockedLink {
  readonly issue_id: string;
  readonly option_id: string;
  readonly option_label: string;
  readonly risk_id: string;
  readonly risk_label: string;
  /**
   * The readiness authority's own prompt for this blocker, kept for the record.
   * It asks about a FACTOR. It is deliberately NOT put to the user — that is
   * the whole point of this class — but discarding it silently would leave
   * nothing to show that the two disagree.
   */
  readonly authority_prompt: string;
  /** Ordered: the non-destructive one first. Never empty. */
  readonly resolutions: readonly RepairLinkResolution[];
}

export interface RepairPlan {
  /** The authority's verdict, copied. `true` means nothing here blocks a run. */
  readonly analysable: boolean;
  /**
   * Options held back by a link rather than by a missing value. These carry
   * the ONLY repairs that can clear that blocker — no effect value can.
   */
  readonly blocked_links: readonly RepairBlockedLink[];
  /**
   * Estimates put to the user, bounded — see {@link MAX_COMPOUND_OPERATIONS}.
   * Each becomes ONE proposal, so the whole set can be agreed in ONE write.
   */
  readonly offers: readonly RepairOffer[];
  /** Gaps only the user can settle. These carry no operations by construction. */
  readonly asks: readonly RepairAsk[];
  /**
   * Offers that did not fit under the bound — NAMED, never dropped.
   *
   * ⛔ A silently truncated set is the defect this whole module is against: the
   * user would agree to "all of it" and get part of it. The caller must say
   * these are coming next.
   */
  readonly deferred: readonly RepairOffer[];
}

/**
 * The two ways a blocked option→risk link can be cleared, as real patch
 * operations. ONE producer, so the tool that offers a resolution and the tool
 * that amends one cannot drift apart (CLAUDE.md trap 12).
 *
 * ⚠ THE EDGE PATH IS `from::to`, which is CEE's internal spelling for an edge
 * operation — `mapOpsForPlot` converts it to `from->to` on the way out, and
 * `structure-tools.ts` already stages `add_edge` this way. It is NOT
 * `compose/edge-address.ts`'s vocabulary, which owns a different seam
 * (fragile-edge target refs), and whose `parseEdgeId` explicitly REJECTS `::`.
 * Two spellings, two seams, named apart.
 *
 * ⛔ THE CAVEAT ON `keep_out_of_comparison` IS LOAD-BEARING AND MUST BE SAID.
 * `bidirected` is the only marking the gate exempts, and operationally it does
 * exactly what is wanted — `schemas/graph.ts:502-504`: *"ISL never sees
 * bidirected edges"*, kept for *"trust warnings only"*. But the contract also
 * defines it as *"A↔B — indicates an unmeasured common cause (Pearl's ADMG
 * notation)"*, which is a SPECIFIC causal claim and not simply "we could not
 * quantify this". Using it to mean the second is a reinterpretation, and
 * whether that is right is Core's contract question, not this lane's. So the
 * caveat travels with the resolution and the user is told what it records.
 */
export function buildLinkResolution(input: {
  readonly optionId: string;
  readonly optionLabel: string;
  readonly riskId: string;
  readonly riskLabel: string;
  readonly kind: LinkResolutionKind;
}): RepairLinkResolution {
  const { optionId, optionLabel, riskId, riskLabel, kind } = input;
  const path = `${optionId}::${riskId}`;
  if (kind === 'remove_link') {
    return {
      kind,
      summary: `Take the link from ${optionLabel} to ${riskLabel} out of the model`,
      operations: [
        {
          op: 'remove_edge',
          path,
          old_value: null,
          impact: 'high',
          rationale:
            `The user chose to drop this link rather than keep it. It is the only other way to `
            + `clear the block on ${optionLabel}.`,
        },
      ],
    };
  }
  return {
    kind,
    summary: `Keep the link from ${optionLabel} to ${riskLabel}, but leave it out of the comparison`,
    operations: [
      {
        op: 'update_edge',
        path,
        value: { edge_type: 'bidirected' },
        old_value: null,
        impact: 'moderate',
        rationale:
          `Marks the link so the engine does not try to put a number on it. The relationship stays `
          + `on the model as a note.`,
      },
    ],
    caveat:
      `This records the link as an "unmeasured common cause", which is the only marking the `
      + `checker accepts and is a slightly stronger statement than "we could not put a number on `
      + `it". Say that plainly rather than describing it as just a note.`,
  };
}

function nodesOf(graph: unknown): readonly Record<string, unknown>[] {
  const g = graph as { nodes?: unknown } | null | undefined;
  return Array.isArray(g?.nodes) ? (g.nodes as Record<string, unknown>[]) : [];
}

function edgesOf(graph: unknown): readonly Record<string, unknown>[] {
  const g = graph as { edges?: unknown } | null | undefined;
  return Array.isArray(g?.edges) ? (g.edges as Record<string, unknown>[]) : [];
}

function labelOf(node: Record<string, unknown> | undefined, fallback: string): string {
  const l = node?.label;
  return typeof l === 'string' && l.trim().length > 0 ? l : fallback;
}

/**
 * Build the plan.
 *
 * `admission` is the caller's ONE assessment of this graph — passed in rather
 * than re-derived, because "two independent assessments of one graph can in
 * principle disagree" is the hazard `analysis-ready-core.ts` exists to remove,
 * and a second call here would reintroduce it.
 *
 * `graph` must be the SAME graph the admission was taken over. A caller that
 * passes a different one gets a plan about neither.
 */
export function buildRepairPlan(input: {
  readonly admission: RunAdmission;
  readonly graph: unknown;
}): RepairPlan {
  const { admission, graph } = input;
  const nodes = nodesOf(graph);
  const byId = new Map(
    nodes
      .filter((n): n is Record<string, unknown> & { id: string } => typeof n.id === 'string')
      .map((n) => [n.id, n] as const),
  );

  // ── ASKS: the authority's blocking issues, with its own marking kept ─────
  //
  // Read off `assessment.blockingIssues` rather than `readinessQuestions`,
  // which returns NOTHING below two blockers because `repairProposal` is null
  // there. A one-blocker model is exactly as stuck as a six-blocker one.
  // ── LINK BLOCKERS ───────────────────────────────────────────────────────
  //
  // ⭐ BOUND TO THE AUTHORITY'S VERDICT, NOT TO A COPY OF ITS RULE. This does
  // NOT re-derive "does an option→risk edge block?" — that predicate lives in
  // `cee/transforms/analysis-ready.ts` and mirroring it here would be a second
  // opinion about readiness (trap 12). The authority decides IF the option is
  // blocked; this only works out WHAT WOULD CLEAR IT, by finding the links the
  // gate's own comment names. `isDirectedEdge` is imported rather than
  // re-spelled — it is the estate's single directed-edge policy point.
  //
  // An option the authority blocks with OPTION_NEEDS_MAPPING that has NO such
  // link falls through to an ordinary ask, unchanged. That is the honest
  // fallback and it is what makes this narrow rather than a catch-all.
  const blockedLinks: RepairBlockedLink[] = [];
  const linkHandledIssueIds = new Set<string>();
  for (const issue of admission.assessment.blockingIssues) {
    if (issue.code !== 'OPTION_NEEDS_MAPPING') continue;
    const optionId = issue.option_id;
    if (optionId === undefined) continue;
    const optionLabel = issue.option_label ?? labelOf(byId.get(optionId), optionId);
    for (const edge of edgesOf(graph)) {
      if (edge.from !== optionId) continue;
      if (byId.get(String(edge.to))?.kind !== 'risk') continue;
      if (!isDirectedEdge(edge as { edge_type?: 'directed' | 'bidirected' })) continue;
      const riskId = String(edge.to);
      const riskLabel = labelOf(byId.get(riskId), riskId);
      linkHandledIssueIds.add(issue.issue_id);
      blockedLinks.push({
        issue_id: issue.issue_id,
        option_id: optionId,
        option_label: optionLabel,
        risk_id: riskId,
        risk_label: riskLabel,
        authority_prompt: String(issue.message ?? ''),
        // Non-destructive first. A deleted causal relationship is the user's
        // modelling thrown away, and they may well want it kept.
        resolutions: [
          buildLinkResolution({ optionId, optionLabel, riskId, riskLabel, kind: 'keep_out_of_comparison' }),
          buildLinkResolution({ optionId, optionLabel, riskId, riskLabel, kind: 'remove_link' }),
        ],
      });
    }
  }

  const asks: RepairAsk[] = [];
  for (const issue of admission.assessment.blockingIssues) {
    // ⛔ A LINK-BLOCKED OPTION MUST NOT ALSO BE ASKED THE FACTOR QUESTION.
    // That prompt is the measured defect: it names a factor when the blocker is
    // a risk, and no answer to it can clear the block. It is carried on the
    // link repair as `authority_prompt` rather than discarded.
    if (linkHandledIssueIds.has(issue.issue_id)) continue;
    const prompt = typeof issue.message === 'string' ? issue.message.trim() : '';
    if (prompt.length === 0) continue;
    const decision = classifyIssueObligation(issue, graph, admission.waivedOptionIds);
    // The authority's own labels where it carries them; the graph's only as a
    // fallback, so this module never mints a name for something it is quoting.
    const optionLabel =
      issue.option_label ??
      (issue.option_id === undefined ? undefined : labelOf(byId.get(issue.option_id), issue.option_id));
    const factorLabel =
      issue.factor_label ??
      (issue.factor_id === undefined ? undefined : labelOf(byId.get(issue.factor_id), issue.factor_id));
    asks.push({
      issue_id: issue.issue_id,
      category: issue.category,
      prompt,
      ...(issue.option_id === undefined ? {} : { option_id: issue.option_id }),
      ...(optionLabel === undefined ? {} : { option_label: optionLabel }),
      ...(issue.factor_id === undefined ? {} : { factor_id: issue.factor_id }),
      ...(factorLabel === undefined ? {} : { factor_label: factorLabel }),
      obligation: decision.obligation,
      provenance: decision.provenance,
      waived_by_exclusion: decision.waived_by_exclusion,
    });
  }

  // ── OFFERS: machine-authored values already sitting in the model ─────────
  //
  // ⚠ NOT the blocking set, and that is the finding rather than an oversight.
  // Measured on this authority: a cell carrying a usable `cee_hypothesis` value
  // does NOT block — so if offers were drawn from blockers the branch would be
  // unreachable by construction (trap 16-inverse: a live code path the producer
  // cannot feed). The values that make an analysis untrustworthy are precisely
  // the ones that let it proceed.
  const askedCells = new Set(
    asks
      .filter((a) => a.option_id !== undefined && a.factor_id !== undefined)
      .map((a) => `${a.option_id} ${a.factor_id}`),
  );

  const candidates: RepairOffer[] = [];
  for (const node of nodes) {
    if (node.kind !== 'option') continue;
    const optionId = typeof node.id === 'string' ? node.id : '';
    if (optionId.length === 0) continue;

    // ⭐ ONE READER FOR THE VALUE — the same one the readiness badge, #1016's
    // guard and the write-back acknowledgement consult. A private reader here
    // would be a second opinion about what the model holds (trap 12).
    let held: Record<string, number> | undefined;
    try {
      held = mergeInterventionSources(node);
    } catch {
      continue;
    }
    if (held === undefined) continue;

    for (const [factorId, raw] of Object.entries(held)) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      // A cell the authority is already asking about is an ASK. Offering and
      // asking about the same cell in one message is the incoherence Paul saw.
      if (askedCells.has(`${optionId} ${factorId}`)) continue;

      const provenance = structureProvenanceOfEffect(graph, optionId, factorId);
      // ⛔ A value the user stated OR RATIFIED is theirs. Re-offering it as
      // "Olumi's estimate" would tell them their own number was our invention —
      // named in `reflectsAHumanAct` as the worse of the two errors.
      if (reflectsAHumanAct(provenance)) continue;

      // ⛔ THE REAL TOOL, over the value READ OUT OF THE GRAPH. This is what
      // makes "no number is invented here" structural rather than a promise:
      // an unusable cell simply produces no offer.
      const resolved = setOptionEffect({
        graph: graph as EffectGraph,
        optionId,
        factorId,
        value: raw,
      });
      if (!resolved.ok) continue;

      candidates.push({
        option_id: optionId,
        option_label: resolved.option_label,
        factor_id: factorId,
        factor_label: resolved.factor_label,
        value: resolved.value,
        provenance,
        summary: resolved.summary,
        operations: resolved.operations,
      });
    }
  }

  // ── THE BOUND ───────────────────────────────────────────────────────────
  //
  // Each offer becomes ONE proposal carrying exactly ONE `ProposalOperation`
  // (the composer wraps a staged change into one), and `operationsToApplyBatch`
  // counts those wrappers — so the store's bound is, at this seam, a bound on
  // OFFERS. Taken from the store rather than re-spelled, so the two cannot
  // drift: a batch built at this size is guaranteed not to be refused for size.
  const offers = candidates.slice(0, MAX_COMPOUND_OPERATIONS);
  const deferred = candidates.slice(MAX_COMPOUND_OPERATIONS);

  return {
    analysable: admission.willProceed,
    blocked_links: blockedLinks,
    offers,
    asks,
    deferred,
  };
}

/** Nothing to do: no estimate to confirm and no gap to settle. */
export function planIsEmpty(plan: RepairPlan): boolean {
  return (
    plan.offers.length === 0 &&
    plan.asks.length === 0 &&
    plan.deferred.length === 0 &&
    plan.blocked_links.length === 0
  );
}
