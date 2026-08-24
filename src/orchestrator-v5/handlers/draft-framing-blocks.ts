/**
 * draft-framing-blocks — emit AT MOST ONE FRAME/IDEATE coaching card on a draft
 * turn whose model is NOT yet analysis-ready.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Derived at CEE `d1da6706` (the DEPLOYED staging build, `/healthz` →
 * `build: "d1da670"`): **every draft-time coaching surface in this service is
 * gated on `analysisReady.status === 'ready'`.**
 *
 *   - `draft-bias-signal-blocks.ts:210`      `if (analysisReady?.status !== 'ready') return [];`
 *   - `draft-option-widening-blocks.ts:611`  `if (analysisReady?.status !== 'ready') return [];`
 *   - `post-draft-narrative.ts:526`          `mayServeFreeformCoaching = analysisReady?.status === 'ready'`
 *
 * So on a model that is NOT analysis-ready the product serves a fixed generic
 * assumption, a trade-off line assembled from node labels, and a readiness
 * next-step. Every affordance `readiness-recovery.ts` can offer at that point is
 * a COMPLETION instruction — `map_option`, `provide_value`, `encode_option`,
 * `connect_option`, `configure_option`, `review_model`, `resolve_model_issue`.
 *
 * That is the product telling a team that is still FRAMING to go and finish
 * their option set. It is the mechanical form of "the workspace only accepts a
 * decision that already has options".
 *
 * ⭐ AND THE KNOWLEDGE TO DO BETTER IS ALREADY THERE, ALREADY PAID FOR.
 * The coaching pass runs at DRAFT time with no analysis whatsoever — its own
 * system prompt says so in capitals (`unified-pipeline/stages/coaching-pass.ts`:
 * *"NO ANALYSIS HAS BEEN RUN YET. You are given structure only: no values, no
 * probabilities, no strengths, no results."*). It returns up to four typed
 * `strengthen_items`, each with a short imperative `label`, one sentence of
 * `detail`, and a contract-typed `action_type`. All four of those items are
 * discarded on a non-ready turn, and `action_type` is **read by nothing** on
 * either side of the wire.
 *
 * Two of the four action types are precisely the pre-option reasoning stages of
 * the canonical vocabulary `STRATEGISE → FRAME → IDEATE → EVALUATE → ACT →
 * IMPROVE`:
 *
 *   `reframe_goal`  → FRAME  — is this the outcome the team actually wants?
 *   `add_option`    → IDEATE — is a further possibility in scope?
 *
 * The other two (`add_risk`, `add_constraint`) are model-completion work; the
 * post-draft narrative owns them when the model is ready, and this module is
 * silent on them by design.
 *
 * ── WHY THIS IS NOT "RELAXING THE READY GATE" ──────────────────────────────
 * The ready-only policy on the NARRATIVE path is deliberate and its stated
 * reason is specific (`post-draft-narrative.ts:519-525`): *"Freeform coaching
 * fragments can contain action copy that the fragment gate is not designed to
 * classify"*, and *"a producer-built clarification and an LLM item are
 * distinguished only by a spoofable ID prefix … Until provenance is carried
 * structurally, direction copy follows the same ready-only policy."*
 *
 * **That reason is about the carrier, not about the knowledge.** A typed
 * `CoachingBlock` IS provenance carried structurally: it declares
 * `source: 'draft_graph'` (which the UI renders as *"Raised while drafting your
 * model"*), it passes the same `gateCoachingCardBody` lexicon gate, it is
 * validated whole against `CoachingBlockSchema` before egress, and it can carry
 * `dsk_claim_provenance`. This module does not loosen the prose gate by one
 * byte — it moves the knowledge onto the carrier whose absence that comment
 * names as the blocker.
 *
 * ── THE COMPLEMENT PROPERTY (and it is a design guarantee, not a coincidence) ─
 * The gate here is the EXACT INVERSE of every sibling's: this module returns
 * `[]` when `status === 'ready'`. So it can never double-emit with the widening
 * card, the bias card, or the narrative's freeform coaching. Ready and not-ready
 * partition the space; each half now has a producer. Pinned by T2.
 *
 * ── WHAT THIS MODULE WILL NOT DO ───────────────────────────────────────────
 * It never GENERATES a goal, an option, a value or a number. Every byte it ships
 * is the drafting model's own `label` and `detail`, quoted, gated, truncated at
 * a word boundary, and attributed to the drafter by `source: 'draft_graph'`.
 * The team remain the authors: the card contributes an observation and asks;
 * it does not decide, and it never names or ranks a preferred option (the
 * coaching prompt forbids that at draft time and `gateCoachingCardBody`
 * enforces it on the exact bytes that ship).
 *
 * It also ships NO ACTION CHIP, on either arm, and both reasons are derived:
 *
 *   - `reframe_goal` — **P8**: the product's own advised phrasing must have an
 *     acceptance path. No route accepts a goal reframe, so advising one would
 *     be the product advertising an action that terminates in refusal. The card
 *     puts the question to the team instead, which is the trap-22f exit: where
 *     direction cannot be determined, ask rather than guess.
 *   - `add_option` — the captured items designate no concrete option NAME
 *     (they read *"consider whether a partial or phased combination of routes
 *     is in scope"*), so the only constructible chip is a generic "widen your
 *     options" prompt. The product already mounts FOUR of those and every one
 *     is a generic prompt with nothing behind it. A fifth is not a capability.
 *     The value here is the SPECIFIC, brief-grounded observation.
 *
 * An `action_label` without an `action_prompt` renders an inert `<span>` in the
 * UI, so "no chip" means no `action_label` either. T6 pins that over both arms.
 *
 * ── FAIL-CLOSED GATES, in order ────────────────────────────────────────────
 *   1. `analysisReady?.status === 'ready'`               → [] (the inverse gate)
 *   2. `strengthenItems` is not a non-empty array        → []
 *   3. intake reconciler reports `options_missing`       → [] (see below)
 *   4. no item carries a FRAME/IDEATE `action_type`      → []
 *   5. an item's `label`/`detail` is empty after trim    → skip that item
 *   6. `gateCoachingCardBody` rejects title or body      → skip that item
 *   7. the assembled block fails `CoachingBlockSchema`   → []
 *
 * ── GATE 3, STATED SEPARATELY BECAUSE IT IS THE TRAP-21 SHAPE ──────────────
 * `intake-option-reconciliation.ts` (row 2.579, live) answers *"did the intake
 * keep every option the user NAMED?"* and, on a hit, WITHHOLDS the ranking —
 * the product is in a repair state because it lost one of the team's own
 * options. This module answers *"what pre-option reasoning did the drafter
 * itself record?"* and, on a hit, OFFERS. Those are near-inverses, and #709/#737
 * showed what happens when two authorities speak about one subject without
 * anyone writing down which question each answers. A card inviting a team to
 * consider more possibilities, on a turn whose ranking is withheld BECAUSE the
 * product mislaid an option they named, would be the product changing the
 * subject away from its own error. So: repair outranks ideation, and T9 pins it
 * with the reconciler's state asserted in-test before the suppression is.
 *
 * ⚠ AND THE ADJACENT RULING THAT DOES **NOT** BIND HERE, named so nobody
 * re-derives it: `intake-option-reconciliation.ts:41-43` rules out
 * `strengthen_items.action_type === 'add_option'` as an oracle, on the grounds
 * that it *"fires as WIDENING advice ('consider a further option'), which is the
 * OPPOSITE claim"*. That ruling is about using the field to detect a MISSING
 * option. This module uses it as widening advice — which is the meaning that
 * ruling itself assigns to it. Different claim, same field, and the difference
 * is the whole of gate 3.
 */
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import {
  deriveIntakeOptionReconciliation,
  readGraphOptionLabels,
} from '../../orchestrator/context/intake-option-reconciliation.js';
import type { GraphV3T } from '../../orchestrator/types.js';
import { gateCoachingCardBody } from '../coaching/copy-quality-gate.js';
import { deterministicBlockId } from '../compose/block-id.js';
import { resolveDskClaimProvenance } from '../compose/dsk-claim-record.js';
import { guidanceSignalsForCoachingKind } from '../compose/guidance-signals.js';

/** Namespace for every signal id this module mints. */
export const DRAFT_FRAMING_SIGNAL_PREFIX = 'draft_framing:';

/**
 * The two `StrengthenItemActionType` members that do reasoning work BEFORE a
 * complete option set exists, in canonical stage order: FRAME precedes IDEATE.
 *
 * The order is not a preference — it is the stage vocabulary. If the goal the
 * model was built on is the wrong goal, generating further options against it
 * is wasted work, so the framing question is asked first. `add_risk` and
 * `add_constraint` are deliberately absent: they are model-completion work, not
 * pre-option reasoning, and the post-draft narrative already owns them.
 */
export const FRAMING_ACTION_TYPE_PRECEDENCE = ['reframe_goal', 'add_option'] as const;

export type FramingActionType = (typeof FRAMING_ACTION_TYPE_PRECEDENCE)[number];

/**
 * Rendering taxonomy per arm. Both resolve to `could_fix` via
 * `guidanceSignalsForCoachingKind` — an opportunity to take, never a defect to
 * fix. `orientation` is deliberately NOT used: it already means "lifecycle /
 * freshness nudge" (the stale-rerun block) and carries `should_fix`, so reusing
 * it here would put two different questions under one name.
 */
const KIND_BY_ACTION_TYPE: Readonly<Record<FramingActionType, 'strengthen' | 'widening'>> = {
  reframe_goal: 'strengthen',
  add_option: 'widening',
};

/**
 * DSK grounding per arm, resolved from the hash-verified bundle — never
 * hand-typed.
 *
 * `DSK-B-007` ("Narrow framing and insufficient option generation",
 * `stage_applicability: ["frame","ideate"]`, Nutt 2004) grounds the IDEATE arm.
 *
 * ⚠ The FRAME arm is `null` DELIBERATELY. A census of `data/dsk/v1.json` (27
 * objects) found NO claim grounding goal-vs-outcome framing: the nearest,
 * DSK-B-007, is about option-set SIZE. An invented or stretched claim id would
 * be a fabricated citation on a user-visible card, so the honest shape is the
 * field's absence. `DskClaimProvenanceSchema` is optional, so absence validates.
 * T8 asserts the asymmetry in both directions.
 */
const DSK_CLAIM_BY_ACTION_TYPE: Readonly<Record<FramingActionType, string | null>> = {
  reframe_goal: null,
  add_option: 'DSK-B-007',
};

/** Contract bounds. Module-private in `@talchain/schemas`, so mirrored here —
 *  and the mirror is contained: `CoachingBlockSchema.safeParse` is the real
 *  authority and drops the block whole if either drifts. */
const TITLE_BUDGET = 80;
const BODY_BUDGET = 300;
/** Cap on the model-authored slug used inside a signal id. */
const SIGNAL_ID_SEGMENT_MAX = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Truncate at a word boundary; never mid-word, never past the budget. */
function truncateAtWordBoundary(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cut = text.slice(0, budget);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

function isFramingActionType(value: unknown): value is FramingActionType {
  return (
    typeof value === 'string' &&
    (FRAMING_ACTION_TYPE_PRECEDENCE as readonly string[]).includes(value)
  );
}

/** A stable, id-safe segment derived from the item's own identity. */
function signalIdSegment(item: Record<string, unknown>, label: string): string {
  const rawId = readTrimmedString(item.id);
  const basis = rawId.length > 0 ? rawId : label;
  const slug = basis
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, SIGNAL_ID_SEGMENT_MAX);
}

/**
 * The graph's own option labels, for gate 3.
 *
 * ⚠ DERIVED THE HARD WAY, AND THE REASON MATTERS. `readGraphOptionLabels`
 * accepts either a bare array of `{label}` or an object carrying an `.options`
 * array — it does NOT walk `GraphV3.nodes` looking for `kind === 'option'`. So
 * `readGraphOptionLabels(graphV3)` returns `[]` on a real drafted graph, and
 * `deriveIntakeOptionReconciliation(brief, [])` short-circuits to
 * `not_applicable` (`intake-option-reconciliation.ts:522`) — i.e. the gate
 * would be structurally incapable of ever firing, while every test that fed it
 * an options-shaped fixture passed.
 *
 * That was caught here only because T9 PINS THE RECONCILER'S STATE IN-TEST
 * before asserting the suppression (trap 13b, third face): the precondition
 * assertion went green while the suppression assertion went red, which is
 * exactly the signal a bare "expect([])" would have swallowed.
 *
 * So the labels are read from BOTH shapes and unioned: the node walk is what
 * makes the gate real on a drafted graph, and the `readGraphOptionLabels` call
 * keeps the reconciler's own accepted input shapes working.
 *
 * ⚠ STANDING TRIPWIRE FOR THE ADJACENT LANE, deliberately NOT fixed here (it is
 * another lane's shipped file, and "while we're here" work is prohibited):
 * `draft-option-widening-blocks.ts:499-504` (`isRepairState`) passes
 * `readGraphOptionLabels(graph)` straight to the reconciler with NO node walk,
 * so #1006's own trap-21 anti-collision gate looks live and is dark on a real
 * GraphV3. Its gate 5 walks the nodes correctly a few lines later, which is why
 * the omission reads as deliberate at a glance. Reported, not touched.
 */
function readOptionLabels(graph: GraphV3T | null | undefined): string[] {
  const labels = [...readGraphOptionLabels(graph ?? null)];
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  for (const node of nodes as ReadonlyArray<unknown>) {
    if (!isRecord(node)) continue;
    if (node.kind !== 'option') continue;
    const label = readTrimmedString(node.label);
    if (label.length > 0) labels.push(label);
  }
  return labels;
}

export interface BuildDraftFramingBlocksParams {
  /**
   * Sole admission authority — and INVERTED relative to every sibling. This
   * module serves the non-ready half only, so an exact `'ready'` returns `[]`
   * and every other value (including missing and unknown) may proceed. That is
   * not a loosened gate: a not-ready model is precisely the population no
   * draft-time coaching producer currently serves.
   */
  readonly analysisReady?: { readonly status?: unknown } | null;
  /**
   * The draft's raw `coaching.strengthen_items`. Shape is
   * `{id, label, detail, action_type, bias_category?}` per the contract, but it
   * is model-authored, so every field is re-checked here.
   */
  readonly strengthenItems: ReadonlyArray<unknown> | null | undefined;
  /** The drafted graph. OPTIONAL — used only for gate 3's option labels. */
  readonly graph: GraphV3T | null | undefined;
  /** The SAME brief the drafter drafted from, for gate 3. OPTIONAL. */
  readonly briefText: string | null | undefined;
  /** ISO-8601 timestamp with offset, stamped on the emitted block. */
  readonly createdAt: string;
}

/**
 * Build at most one FRAME/IDEATE coaching block. Pure, never throws, returns
 * `[]` on every doubt.
 */
export function buildDraftFramingBlocks(
  params: BuildDraftFramingBlocksParams,
): CoachingBlock[] {
  const { analysisReady, strengthenItems, graph, briefText, createdAt } = params;

  // Gate 1 — the inverse gate. The ready half already has three producers.
  if (analysisReady?.status === 'ready') return [];

  // Gate 2.
  if (!Array.isArray(strengthenItems) || strengthenItems.length === 0) return [];

  // Gate 3 — repair outranks ideation. Derived, never inferred from a count.
  if (deriveIntakeOptionReconciliation(briefText, readOptionLabels(graph)).state === 'options_missing') {
    return [];
  }

  // Gate 4 + 5 + 6 — FRAME before IDEATE; within an arm, engine order wins.
  for (const actionType of FRAMING_ACTION_TYPE_PRECEDENCE) {
    for (const raw of strengthenItems) {
      if (!isRecord(raw)) continue;
      if (raw.action_type !== actionType) continue;

      const label = readTrimmedString(raw.label);
      const detail = readTrimmedString(raw.detail);
      if (label.length === 0 || detail.length === 0) continue;

      const title = truncateAtWordBoundary(label, TITLE_BUDGET);
      const body = truncateAtWordBoundary(detail, BODY_BUDGET);

      // Gated on the EXACT bytes that will ship (after truncation), and used as
      // a PREDICATE, never a rewriter: a model-authored sentence is either
      // honest enough to show verbatim or it is dropped. Rewriting the
      // product's own account of a team's framing would be its own dishonesty.
      // Title and body are both model-authored, so both are gated.
      if (!gateCoachingCardBody(title).accept) continue;
      if (!gateCoachingCardBody(body).accept) continue;

      const segment = signalIdSegment(raw, label);
      if (segment.length === 0) continue;

      const signalId = `${DRAFT_FRAMING_SIGNAL_PREFIX}${actionType}:${segment}`;
      const claimId = DSK_CLAIM_BY_ACTION_TYPE[actionType];
      const provenance = claimId === null ? null : resolveDskClaimProvenance(claimId);

      const candidate: CoachingBlock = {
        block_id: deterministicBlockId(signalId),
        signal_id: signalId,
        created_at: createdAt,
        source_handler: 'draft_graph',
        freshness: 'fresh',
        type: 'coaching',
        coaching_kind: KIND_BY_ACTION_TYPE[actionType],
        title,
        body,
        source: 'draft_graph',
        // No node exists for a goal not yet reframed or an option not yet
        // added, and the UI surfaces a node marker ONLY for a real canvas node
        // id, so grounding here would be a ref to nothing. `[]` is schema-legal
        // and is the sibling's measured lesson: requiring a resolvable target
        // "skipped EVERY real signal and emitted nothing on the wire".
        target_refs: [],
        // ⚠ NOT A FORMALITY. Coaching sits in the UI's PHASE3_CARD_TYPES with
        // PHASE3_DEFAULT_EXPANDED = 6 and measured live counts of 8-14 cards
        // per turn; only `bias_signal` holds a visibility exemption. A card
        // ranked 7th or later collapses behind "Show N more" and renders NULL.
        // Rank 1 is the difference between shipping this card and dark-shipping
        // it. NOTE the honest scope: on a NON-ready turn the sibling producers
        // are all silent, so contention is lower here than on a ready turn —
        // but the rank is asserted regardless so a later refactor cannot push
        // the card into the overflow unnoticed.
        priority_rank: 1,
        // Omitted ENTIRELY when the bundle cannot vouch for the claim, and
        // `null` by construction on the FRAME arm — see DSK_CLAIM_BY_ACTION_TYPE.
        ...(provenance !== null ? { dsk_claim_provenance: provenance } : {}),
        // Producer-owned guidance signals, derived from the kind, never
        // hand-typed. Both arms resolve to `could_fix`.
        ...guidanceSignalsForCoachingKind(KIND_BY_ACTION_TYPE[actionType]),
      } as CoachingBlock;

      // Gate 7 — fail closed rather than hand egress a block it drops whole.
      if (!CoachingBlockSchema.safeParse(candidate).success) continue;

      return [candidate];
    }
  }

  return [];
}
