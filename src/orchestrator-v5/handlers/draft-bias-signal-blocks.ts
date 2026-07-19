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
 * Grounding rules (mirror the UI bridge exactly, fail-closed per entry):
 *   - not an array / empty / no graph to ground against → []
 *   - malformed entry (non-object, blank/non-string type or detail) → skipped
 *   - unknown bias code (not on the shared registry allowlist) → skipped —
 *     the wire `type` is machine vocabulary, never visible copy, so an
 *     unmapped code has no honest human title (mirrors resolveBiasSignal)
 *   - ungrounded (missing / unresolvable / blank-label target, or a target
 *     node whose kind is not a boundary TargetRefKind) → skipped
 *   - identical (canonical title, target id) pairs collapse BEFORE the cap,
 *     first occurrence wins, so a duplicate can never displace a distinct
 *     third signal
 *   - at most DRAFT_BIAS_SIGNAL_CARD_CAP (2) blocks, in engine order
 *
 * NEVER synthesises: every emitted block is backed by a signal the engine
 * actually produced, grounded on a node the draft graph actually contains.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function truncateBody(detail: string): string {
  if (detail.length <= BODY_MAX) return detail;
  // Reserve one char for the ellipsis so the result is exactly ≤ BODY_MAX.
  return `${detail.slice(0, BODY_MAX - 1).trimEnd()}…`;
}

export interface BuildDraftBiasSignalBlocksParams {
  /** The engine's raw `coachingBiasSignals` (shape: {type, detail, target?}). */
  readonly biasSignals: ReadonlyArray<unknown> | null | undefined;
  /** The persisted draft graph — target refs are grounded against its nodes. */
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
  const { biasSignals, graph, createdAt } = params;
  if (!Array.isArray(biasSignals) || biasSignals.length === 0) return [];

  const rawNodes = graph?.nodes;
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) return [];

  // One lookup for the whole signal loop.
  const nodesById = new Map<string, GraphNodeShape>();
  for (const n of rawNodes as GraphNodeShape[]) {
    if (n && typeof n.id === 'string' && n.id.length > 0) nodesById.set(n.id, n);
  }

  const out: CoachingBlock[] = [];
  // Identity = canonical title + resolved target id. Alias codes
  // (anchoring / anchoring_bias) share a title, so they dedupe. First
  // occurrence wins, BEFORE the cap.
  const seen = new Set<string>();

  for (const raw of biasSignals) {
    if (out.length >= DRAFT_BIAS_SIGNAL_CARD_CAP) break;
    if (!isRecord(raw)) continue;

    const title = resolveBiasTitle(raw.type);
    if (title === null) continue;

    const detail = typeof raw.detail === 'string' ? raw.detail.trim() : '';
    if (detail.length === 0) continue;

    // Ground the signal on a real graph node with a non-blank label and a
    // boundary-valid TargetRefKind.
    if (typeof raw.target !== 'string' || raw.target.trim().length === 0) continue;
    const targetId = raw.target.trim();
    const node = nodesById.get(targetId);
    if (node === undefined) continue;
    const label = typeof node.label === 'string' ? node.label.trim() : '';
    if (label.length === 0) continue;
    const kind = toTargetRefKind(node.kind);
    if (kind === null) continue;

    const identity = `${title}|${targetId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const signalId = `draft_bias_signal:${targetId}:${title}`;
    out.push({
      block_id: deterministicBlockId(signalId),
      signal_id: signalId,
      created_at: createdAt,
      source_handler: 'draft_graph',
      freshness: 'fresh',
      type: 'coaching',
      coaching_kind: 'bias_signal',
      title,
      body: truncateBody(detail),
      source: 'draft_graph',
      target_refs: [{ id: targetId, label, kind }],
      // Priority order IS engine order — the signals carry no rank of their
      // own. 1-based so the value is never a falsy 0.
      priority_rank: out.length + 1,
    });
  }

  return out;
}
