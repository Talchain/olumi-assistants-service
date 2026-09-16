/**
 * ⭐⭐⭐ THE FINDING THE USER ACTUALLY CLICKED.
 *
 * The UI's "Strengthen" list is built from the phase-3 blocks CEE emitted, and
 * clicking one sends `chip.parameters.block_id` — the RAW producer UUID of that
 * block. CEE has been receiving it and throwing it away: `chip.parameters` had
 * exactly one reader, gated on typed MUTATION action types, so a discussion
 * chip's selection reached nothing. The user pointed at a specific finding and
 * the coach answered as though nothing had been selected.
 *
 * That is the same family as the defect this estate keeps paying for: asking
 * the user for something the product already has.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⭐ RESOLUTION IS A RE-DERIVATION. NO NEW PERSISTENCE, NO NEW TABLE.
 *
 * `block_id = uuidv5("{prefix}:{key}:{graph_hash_at_generation}")` under a
 * frozen namespace (compose/block-id.ts:37, phase3-blocks.ts:3143-3151). So
 * rebuilding the blocks from the same fact under the same hash reproduces the
 * same ids exactly.
 *
 * ⚠ THAT IS MEASURED, NOT ASSUMED. Against a real captured session
 * (`1dd2133d`, 16 Sep 2026), SEVEN of seven production block ids re-derive
 * exactly — e.g. `review:assumption:1:f45e54f21f8c3a66` →
 * `558e05de-46a6-5369-8c99-4bb6ae19b036`. Two contrast controls fire: a moved
 * graph hash yields a different id, and a wrong namespace yields a different
 * id, so the derivation discriminates rather than agreeing with everything.
 *
 * ⭐ AND THE STALE CASE FALLS OUT FOR FREE, which is why this shape was chosen.
 * If the model has moved since the finding was generated, the hash differs, the
 * id cannot match, and the selection does not resolve. That is CORRECT, not a
 * degradation: the finding is about a model that no longer exists, and silently
 * answering about it would be worse than saying the source could not be
 * recovered.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⛔ WHY THIS GOES THROUGH THE AGGREGATE AND NOT THE INDIVIDUAL BUILDERS.
 *
 * `rebuildPhase3BlocksFresh` applies `mayPresentLeaderClaimForFact`, which drops
 * every `LEADER_PRESUMING_COACHING_KINDS` block on a withheld turn — and every
 * lens suggestion is `coaching_kind: 'strengthen'`. Hand-assembling the four
 * builders would rebuild the same block set and LOSE that wire decision, so a
 * user could click their way to a finding the turn was never entitled to
 * present. Going through the aggregate makes a withheld finding unresolvable
 * BY CONSTRUCTION. That is the single most important decision in this module.
 */

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import type { AnalysisFreshness } from '../context/freshness.js';

import { rebuildPhase3BlocksFresh } from '../compose.js';
import { buildGraphNodeLookup } from '../compose/phase3-blocks.js';

/** Why a selection could not be resolved. Bounded vocabulary — R-004-clean. */
export type SelectedFindingUnresolvedReason =
  /** The id is well-formed but names no block in this run's rebuilt set. */
  | 'not_in_model'
  /** No usable source fact, or a legacy fact with no `graph_hash_at_run`. */
  | 'could_not_check'
  /** The model moved since the finding was generated, so the id cannot match. */
  | 'graph_moved';

/**
 * The projection handed to the prompt. Deliberately small: identity, kind, and
 * the producer's own words.
 *
 * ⚠ NO SECOND CHARACTER BUDGET. `title` and `body` are already bounded at
 * source (`TITLE_MAX` / `BODY_MAX`, phase3-blocks.ts). A cap here would be a
 * budget sized against a different box from the one that produced the text —
 * the defect this estate has shipped repeatedly.
 */
export interface SelectedFindingContext {
  readonly block_id: string;
  readonly block_type: string;
  readonly coaching_kind?: string;
  readonly title: string | null;
  readonly body: string | null;
}

export type SelectedFindingResolution =
  | { readonly status: 'resolved'; readonly finding: SelectedFindingContext }
  | { readonly status: 'unresolved'; readonly reason: SelectedFindingUnresolvedReason };

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Read the selected block id off the turn payload.
 *
 * ⛔⛔ IT READS ONE KEY AND FALLS BACK TO NOTHING, AND THAT IS A HAZARD-DRIVEN
 * CONSTRAINT, NOT MINIMALISM.
 *
 * The UI's own extraction chain PREFERS `entry.id` over `entry.block_id` when
 * minting the item id, and on a block carrying neither it MINTS A SYNTHETIC
 * POSITIONAL ID (`<prefix>:phase3_blocks[<i>]`). So a "helpful" fallback that
 * tried `chip.id`, an index, or a fuzzy match would not fail — it would resolve
 * a DIFFERENT finding from the one the user clicked, and answer confidently
 * about the wrong thing. A non-match must stay a non-match.
 *
 * The synthetic positional id is unresolvable here by construction: it is not a
 * UUID and matches no block. It lands in the unresolved path, which is exactly
 * where it belongs.
 */
export function readSelectedFindingBlockId(payload: {
  readonly source?: string;
  readonly chip?: { readonly parameters?: Record<string, unknown> | undefined } | undefined;
}): string | undefined {
  if (payload.source !== 'chip' && payload.source !== 'chip_click') return undefined;
  const parameters = readRecord(payload.chip?.parameters);
  if (parameters === null) return undefined;
  return nonEmptyString(parameters['block_id']) ?? undefined;
}

/**
 * Resolve a selected block id against the run the prompt is already built from.
 *
 * ⚠ THE FACT AND THE FRESHNESS VERDICT ARE PASSED IN, NEVER DERIVED HERE. The
 * turn-executor already selected `promptAnalysisSourceFact` and already derived
 * `promptAnalysisFreshness` over the same fact set, and both carry explicit
 * rulings against a second derivation. A resolver that picked its own fact or
 * compared its own hashes would be a second authority answering the same
 * question, which is how this estate grows contradictory answers.
 */
export function resolveSelectedFinding(args: {
  readonly blockId: string;
  readonly fact: RunAnalysisHandlerFact | null | undefined;
  /**
   * ⚠ THE AUTHORITY'S OWN TYPE, IMPORTED NOT RE-SPELLED. A local
   * `'fresh' | 'stale' | 'unknown'` union was written here first and was SHORT
   * — `AnalysisFreshness` also carries `'none'`. A hand-copied alphabet that
   * drifts from its source is the defect this estate pays for most often, and
   * `tsc` caught this one only because the union was narrower, not because
   * copying was noticed.
   */
  readonly freshness: AnalysisFreshness | undefined;
  readonly persistedGraph: unknown;
}): SelectedFindingResolution {
  const { blockId, fact, freshness, persistedGraph } = args;

  if (fact === null || fact === undefined) {
    return { status: 'unresolved', reason: 'could_not_check' };
  }

  const graphHash = nonEmptyString(
    (fact.result as { graph_hash_at_run?: unknown } | undefined)?.graph_hash_at_run,
  );
  if (graphHash === null) {
    // A legacy fact minted before the hash existed. Cannot re-derive, and must
    // not guess — `could_not_check` is a different answer from `not_in_model`
    // and collapsing them would hide an instrument failure as a real absence.
    return { status: 'unresolved', reason: 'could_not_check' };
  }

  if (freshness !== 'fresh') {
    // The model moved. The id genuinely cannot match, because the hash is part
    // of the id. Reported as its own reason so a stale selection is never
    // mistaken for an invented one.
    return { status: 'unresolved', reason: 'graph_moved' };
  }

  const lookup = buildGraphNodeLookup(fact, persistedGraph);
  const blocks = rebuildPhase3BlocksFresh(
    fact,
    graphHash,
    lookup,
    'fresh',
    persistedGraph,
    undefined,
    undefined,
    undefined,
    // Never emit companion telemetry from a lookup — see the parameter's
    // docblock on `rebuildPhase3BlocksFresh`.
    false,
  );

  // Exact string equality, one pass, no second matching rule.
  for (const raw of blocks) {
    const block = readRecord(raw);
    if (block === null) continue;
    if (block['block_id'] !== blockId) continue;
    const blockType = nonEmptyString(block['type']);
    if (blockType === null) continue;
    const coachingKind = nonEmptyString(block['coaching_kind']);
    return {
      status: 'resolved',
      finding: {
        block_id: blockId,
        block_type: blockType,
        ...(coachingKind === null ? {} : { coaching_kind: coachingKind }),
        title: nonEmptyString(block['title']),
        body: nonEmptyString(block['body']),
      },
    };
  }

  return { status: 'unresolved', reason: 'not_in_model' };
}
