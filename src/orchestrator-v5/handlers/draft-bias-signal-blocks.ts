/**
 * draft-bias-signal-blocks — project the draft LLM's already-emitted
 * `coaching.bias_signals` into UP TO 2 structured `coaching` blocks
 * (`coaching_kind: 'bias_signal'`, `source: 'draft_graph'`) so the UI's
 * merged block renderer can surface them as bias cards.
 *
 * Why this exists (verified 2026-07-19): the draft pipeline emits
 * `coachingBiasSignals` (live logs show `coaching_bias_signals_count=2` on
 * the 16-Jul supplier journey), but the V5 dispatch consumed them only as
 * at most ONE post-draft prose bullet that loses priority to
 * strengthen_items — never as structured blocks. DGAI PR #356 (MERGED)
 * renders `coaching_kind:'bias_signal'` cards via `mapV5Blocks` and had
 * nothing to read. Schema 0.18.0 already types the enum value. This is the
 * producer side of the exact same contract the UI-side bridge
 * (`src/canvas/conversation/draftBiasSignalBlocks.ts`) implements: when
 * CEE emits these typed blocks, the bridge steps aside (producer wins) and
 * the same renderer carries them.
 *
 * This is ADDITIVE. The prose-bullet path (buildPostDraftNarrative) is
 * unchanged — these blocks ride alongside it, they do not replace it.
 *
 * Node-grounding is OPTIONAL (verdict B, 2026-07-19). The deployed
 * BiasSignalSchema (@talchain/schemas 0.18.0) is
 * `z.object({type, detail}).strict()` — the real draft engine emits signals
 * carrying NO `target`, and `.strict()` would reject one. Requiring a
 * resolvable target therefore skipped EVERY real signal and emitted nothing
 * on the wire (the merged+green #537 contract test passed only because its
 * fixture supplied a target the wire never has). So a signal that names a
 * resolvable target now gets a grounded `target_ref`; a signal that does not
 * still emits a card with `target_refs: []`. That is schema-legal:
 * CoachingBlockSchema.target_refs is `z.array(TargetRefSchema)` — no
 * `.min(1)`, so `[]` validates.
 *
 * Grounding rules (fail-closed on the REAL gates; grounding is best-effort):
 *   - not an array / empty → []
 *   - malformed entry (non-object, blank/non-string type or detail) → skipped
 *   - unknown bias code (not on the shared registry allowlist) → skipped —
 *     the wire `type` is machine vocabulary, never visible copy, so an
 *     unmapped code has no honest human title (mirrors resolveBiasSignal)
 *   - target absent / unresolvable / blank-label / non-boundary-TargetRefKind
 *     → card STILL emits, ungrounded (`target_refs: []`); a bad kind never
 *     reaches the wire because we only attach a resolved, valid ref
 *   - identical canonical titles collapse BEFORE the cap, first occurrence
 *     wins, so a duplicate can never displace a distinct third signal
 *   - at most DRAFT_BIAS_SIGNAL_CARD_CAP (2) blocks, in engine order
 *
 * NEVER synthesises: every emitted block is backed by a signal the engine
 * actually produced; when present, the grounded ref points at a node the
 * draft graph actually contains.
 *
 * Copy: `title` is the canonical humanised bias name (same names as the
 * DGAI bias registry — one bias, one name everywhere); `body` is the
 * engine's `detail` verbatim (trimmed + length-capped); the grounded
 * reference rides as a single `target_ref` resolved against the draft
 * graph. Entity-id leaks in `body`/`title` are scrubbed downstream by the
 * central egress chokepoint (sanitiseOlumiResponseForEgress → sanitiseBlock
 * 'coaching'), exactly as for every other coaching block.
 */
import type { CoachingBlock, TargetRefKindLiteral } from '@talchain/schemas/boundary';

import type { GraphV3T } from '../../orchestrator/types.js';
import { deterministicBlockId } from '../compose/block-id.js';
import { gateCoachingCardBody } from '../coaching/copy-quality-gate.js';
import { guidanceSignalsForCoachingKind } from '../compose/guidance-signals.js';

/**
 * Ratified render budget: at most 2 bias-signal cards per draft turn. The
 * DGAI render layer enforces the same cap (DRAFT_BIAS_SIGNAL_CARD_CAP in
 * canvas/conversation/types); enforcing it on the producing side keeps the
 * two in lockstep — a producer that emitted 3 would be trimmed to 2 by the
 * UI anyway, so we never put a card on the wire that cannot render.
 */
export const DRAFT_BIAS_SIGNAL_CARD_CAP = 2;

/** Schema constraints (CoachingBlockSchema, @talchain/schemas 0.18.0). */
const BODY_MAX = 300;

/**
 * THE canonical bias-code → human-title registry. Mirrors DGAI's
 * `src/canvas/shared/biasSignalTitles.ts` BIAS_SIGNAL_REGISTRY: one bias,
 * one name, everywhere. Cross-repo there is no shared package for these
 * titles, so this is a deliberate mirror — but it fails CLOSED on drift: an
 * unknown code yields no block (safe) rather than an ugly raw-token title.
 * The UI parser reads `block.title` verbatim, so these titles are what
 * render.
 *
 * Keys are canonical lowercase; the resolver lowercases + trims first (both
 * wire conventions — lowercase `type`, uppercase `code` — arrive) and uses
 * an own-key guard so hostile prototype-chain codes ('__proto__',
 * 'constructor') fail closed like any other unknown code.
 */
const BIAS_SIGNAL_TITLES: Readonly<Record<string, string>> = {
  framing: 'Narrow framing',
  framing_bias: 'Narrow framing',
  narrow_framing: 'Narrow framing',
  anchoring: 'Anchoring',
  anchoring_bias: 'Anchoring',
  confidence: 'Overconfidence',
  overconfidence: 'Overconfidence',
  optimism_bias: 'Optimism bias',
  blind_spots: 'Blind spots',
  status_quo_bias: 'Status quo bias',
  confirmation: 'Confirmation bias',
  confirmation_bias: 'Confirmation bias',
  authority_bias: 'Authority bias',
  availability_bias: 'Availability bias',
  sunk_cost: 'Sunk cost',
};

/** Guarded registry lookup for WIRE input. Fails closed on unknown codes. */
function resolveBiasTitle(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const key = code.trim().toLowerCase();
  if (key.length === 0) return null;
  return Object.prototype.hasOwnProperty.call(BIAS_SIGNAL_TITLES, key)
    ? BIAS_SIGNAL_TITLES[key]!
    : null;
}

/**
 * Map a draft-graph node kind (NodeKindV3) to a boundary TargetRefKind.
 * `decision` and `action` node kinds have no TargetRefKind and fail closed
 * (a target_ref carrying them would be rejected by the strict egress
 * schema, replacing the whole draft response with an error envelope).
 */
function toTargetRefKind(nodeKind: unknown): TargetRefKindLiteral | null {
  switch (nodeKind) {
    case 'factor':
    case 'option':
    case 'goal':
    case 'risk':
    case 'outcome':
      return nodeKind;
    default:
      // 'decision', 'action', anything unexpected → not a TargetRefKind.
      return null;
  }
}

interface GraphNodeShape {
  readonly id: string;
  readonly kind?: unknown;
  readonly label?: unknown;
}

/**
 * Best-effort grounding. Returns a single resolved target_ref when `rawTarget`
 * names a real graph node with a non-blank label AND a boundary-valid
 * TargetRefKind; otherwise returns [] (the card still emits ungrounded). A ref
 * with a non-boundary kind (e.g. a `decision` node) NEVER reaches the wire —
 * the strict egress schema would reject it — so unresolvable/invalid grounding
 * degrades to an empty array rather than an invalid ref.
 */
function resolveTargetRef(
  rawTarget: unknown,
  nodesById: ReadonlyMap<string, GraphNodeShape>,
): CoachingBlock['target_refs'] {
  if (typeof rawTarget !== 'string' || rawTarget.trim().length === 0) return [];
  const targetId = rawTarget.trim();
  const node = nodesById.get(targetId);
  if (node === undefined) return [];
  const label = typeof node.label === 'string' ? node.label.trim() : '';
  if (label.length === 0) return [];
  const kind = toTargetRefKind(node.kind);
  if (kind === null) return [];
  return [{ id: targetId, label, kind }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function truncateBody(detail: string): string {
  if (detail.length <= BODY_MAX) return detail;
  // Reserve one char for the ellipsis so the result is exactly ≤ BODY_MAX.
  return `${detail.slice(0, BODY_MAX - 1).trimEnd()}…`;
}

export interface BuildDraftBiasSignalBlocksParams {
  /**
   * Sole admission authority for model-authored card bodies. Bias detail is
   * free-form coaching text, so it may reach a user-visible block only when
   * the typed draft payload is exactly ready. Missing, unknown and every
   * non-ready status fail closed.
   */
  readonly analysisReady?: { readonly status?: unknown } | null;
  /**
   * The engine's raw `coachingBiasSignals`. The real wire shape is
   * `{type, detail}` (BiasSignalSchema is `.strict()`, no target); a `target`
   * is honoured for best-effort grounding when present but is not required.
   */
  readonly biasSignals: ReadonlyArray<unknown> | null | undefined;
  /**
   * The draft graph — grounding is best-effort against its nodes. OPTIONAL:
   * a missing graph yields ungrounded cards (`target_refs: []`), not zero.
   */
  readonly graph: GraphV3T | null | undefined;
  /** ISO-8601 timestamp with offset, stamped on every emitted block. */
  readonly createdAt: string;
}

/**
 * Build up to 2 grounded `bias_signal` coaching blocks from the draft's
 * bias signals. Returns `[]` when nothing honest can be shown.
 */
export function buildDraftBiasSignalBlocks(
  params: BuildDraftBiasSignalBlocksParams,
): CoachingBlock[] {
  const { analysisReady, biasSignals, graph, createdAt } = params;
  if (analysisReady?.status !== 'ready') return [];
  if (!Array.isArray(biasSignals) || biasSignals.length === 0) return [];

  // One lookup for best-effort grounding. The graph is OPTIONAL now — a real
  // draft signal carries no target, so a missing/empty graph does not gate
  // emission; it just means every card is ungrounded (`target_refs: []`).
  const rawNodes = graph?.nodes;
  const nodesById = new Map<string, GraphNodeShape>();
  if (Array.isArray(rawNodes)) {
    for (const n of rawNodes as GraphNodeShape[]) {
      if (n && typeof n.id === 'string' && n.id.length > 0) nodesById.set(n.id, n);
    }
  }

  const out: CoachingBlock[] = [];
  // Identity = canonical title. Grounding is optional, so two signals that
  // share a title collapse regardless of target. Alias codes (anchoring /
  // anchoring_bias) share a title, so they dedupe too. First occurrence wins,
  // BEFORE the cap, so a duplicate can never displace a distinct third signal.
  const seen = new Set<string>();

  for (const raw of biasSignals) {
    if (out.length >= DRAFT_BIAS_SIGNAL_CARD_CAP) break;
    if (!isRecord(raw)) continue;

    const title = resolveBiasTitle(raw.type);
    if (title === null) continue;

    const detail = typeof raw.detail === 'string' ? raw.detail.trim() : '';
    if (detail.length === 0) continue;

    // ── P1 CONTENT GATE (2026-07-27) ──────────────────────────────────────
    // `detail` becomes `body` verbatim on a user-visible card. Until now the
    // only downstream treatment was an entity-ID scrub, so a detail naming a
    // leading option ("…which is the best option here") shipped intact — on a
    // DRAFT turn, where no analysis exists and the estate's leader-claim egress
    // alarm short-circuits (may_name_leading_option is honestly `true` when
    // nothing has been computed). Gate the exact bytes that will ship.
    //
    // DROP, never rewrite: this mirrors the rule one layer up, where a bias
    // whose TYPE is off-contract is dropped rather than re-labelled, because a
    // bias label is a claim about a real person. Rewriting the explanation of
    // such a claim would have the same dishonesty.
    //
    // Gated AFTER truncation so the check runs on precisely the shipped text —
    // an offence living beyond the 300-char cap is never shown, so it must not
    // cost the user the card. Gated BEFORE the dedupe so a dropped card does
    // not consume its title's slot and can be replaced by a later clean signal.
    const body = truncateBody(detail);
    if (!gateCoachingCardBody(body).accept) continue;

    if (seen.has(title)) continue;
    seen.add(title);

    // Best-effort grounding: attach a resolved target_ref when the signal
    // names one, else emit ungrounded. Real wire signals carry no target.
    const targetRefs = resolveTargetRef(raw.target, nodesById);
    const groundedId = targetRefs.length > 0 ? targetRefs[0]!.id : null;

    const signalId = groundedId !== null
      ? `draft_bias_signal:${groundedId}:${title}`
      : `draft_bias_signal:${title}`;
    out.push({
      block_id: deterministicBlockId(signalId),
      signal_id: signalId,
      created_at: createdAt,
      source_handler: 'draft_graph',
      freshness: 'fresh',
      type: 'coaching',
      coaching_kind: 'bias_signal',
      title,
      // The ORIGINAL bytes the gate approved — the gate is a predicate, not a
      // rewriter, so a benign detail is byte-identical to what the model wrote.
      body,
      source: 'draft_graph',
      target_refs: targetRefs,
      // Priority order IS engine order — the signals carry no rank of their
      // own. 1-based so the value is never a falsy 0.
      priority_rank: out.length + 1,
      // Wave-2 ask 1 (0.19.0): producer-owned guidance signals — a detected
      // reasoning bias is should_fix (see compose/guidance-signals.ts).
      ...guidanceSignalsForCoachingKind('bias_signal'),
    });
  }

  return out;
}
