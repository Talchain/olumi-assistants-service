/**
 * Confirmation Flow
 *
 * Two-turn confirmation for high-risk actions (add_factor, add_option, remove_factor).
 *
 * Turn 1: Build proposal → ProposalBlockData → store in pending_confirmation
 * Turn 2: User confirms → execute from stored proposal. User declines → clear.
 */

import { randomUUID } from "node:crypto";
import type { PatchOperation } from "../types.js";
import type { DeterministicTurnContext, ActionResult, ProposalBlockData } from "./types.js";
import type { ActionName } from "./actions/types.js";
import { ACTION_CATALOGUE } from "./actions/registry.js";

// ============================================================================
// Constants
// ============================================================================

const CONFIRM_PATTERNS = /^(yes|confirm|go\s*ahead|do\s*it|proceed|apply|accept|ok|sure|yep|yeah|approved?)\b/i;
const DECLINE_PATTERNS = /^(no|cancel|dismiss|decline|stop|never\s*mind|don'?t|nope|nah)\b/i;

// ============================================================================
// Public API
// ============================================================================

export interface ConfirmationResult {
  handled: boolean;
  actionResult?: ActionResult;
  /** If the user confirmed, the proposal that was executed. */
  executedProposal?: ProposalBlockData;
  /** If the user declined, clear the pending state. */
  cleared?: boolean;
}

/** Stored proposal for the deterministic pipeline (extends PendingProposalState). */
export interface StoredProposal {
  proposal_id: string;
  action_type: ActionName;
  operations: PatchOperation[];
  description: string;
  affected_elements: string[];
  /** Timestamp for TTL-based eviction. */
  created_at: number;
}

// ============================================================================
// Bounded proposal store with TTL
// ============================================================================

/** Maximum pending proposals in memory. */
const MAX_PENDING = 1000;
/** TTL for pending proposals (15 minutes). */
const PROPOSAL_TTL_MS = 15 * 60 * 1000;

const pendingProposals = new Map<string, StoredProposal>();

/** Evict expired entries. Called on every store to keep memory bounded. */
function evictExpired(): void {
  const now = Date.now();
  for (const [key, value] of pendingProposals) {
    if (now - value.created_at > PROPOSAL_TTL_MS) {
      pendingProposals.delete(key);
    }
  }
  // Hard cap: evict oldest if still over limit
  if (pendingProposals.size > MAX_PENDING) {
    const entries = [...pendingProposals.entries()]
      .sort((a, b) => a[1].created_at - b[1].created_at);
    const excess = pendingProposals.size - MAX_PENDING;
    for (let i = 0; i < excess; i++) {
      pendingProposals.delete(entries[i][0]);
    }
  }
}

export function storePendingProposal(scenarioId: string, proposal: Omit<StoredProposal, 'created_at'>): void {
  evictExpired();
  pendingProposals.set(scenarioId, { ...proposal, created_at: Date.now() });
}

export function getPendingProposal(scenarioId: string): StoredProposal | null {
  const proposal = pendingProposals.get(scenarioId);
  if (!proposal) return null;
  // Check TTL
  if (Date.now() - proposal.created_at > PROPOSAL_TTL_MS) {
    pendingProposals.delete(scenarioId);
    return null;
  }
  return proposal;
}

export function clearPendingProposal(scenarioId: string): void {
  pendingProposals.delete(scenarioId);
}

/** Test-only: reset the store. */
export function _resetPendingProposals(): void {
  pendingProposals.clear();
}

/**
 * Check if the current message is a confirmation/decline of a pending proposal.
 */
export function handlePendingConfirmation(
  message: string,
  ctx: DeterministicTurnContext,
): ConfirmationResult {
  // Check both the legacy pending_proposal state and our in-memory store
  const storedProposal = getPendingProposal(ctx.scenario_id);
  if (!storedProposal) {
    return { handled: false };
  }

  const trimmed = message.trim();

  // Check for confirmation
  if (CONFIRM_PATTERNS.test(trimmed)) {
    clearPendingProposal(ctx.scenario_id);
    return {
      handled: true,
      executedProposal: {
        proposal_id: storedProposal.proposal_id,
        action_type: storedProposal.action_type,
        description: storedProposal.description,
        operations: storedProposal.operations,
        impact_summary: `Applied ${storedProposal.operations.length} operation(s)`,
        affected_elements: storedProposal.affected_elements,
      },
      actionResult: {
        blocks: [],
        assistantText: 'Applied the proposed changes.',
        guidance_items: [],
        operations: storedProposal.operations,
      },
    };
  }

  // Check for decline
  if (DECLINE_PATTERNS.test(trimmed)) {
    clearPendingProposal(ctx.scenario_id);
    return {
      handled: true,
      cleared: true,
      actionResult: {
        blocks: [],
        assistantText: 'Got it — proposal dismissed.',
        guidance_items: [],
      },
    };
  }

  // Message doesn't look like a confirm/decline — don't consume it
  return { handled: false };
}

/**
 * Build a proposal for a confirmable action.
 */
export function buildProposal(
  actionType: ActionName,
  operations: PatchOperation[],
  description: string,
  affectedElements: string[],
): ProposalBlockData {
  return {
    proposal_id: randomUUID(),
    action_type: actionType,
    description,
    operations,
    impact_summary: `${operations.length} operation${operations.length !== 1 ? 's' : ''}: ${operations.map((o) => o.op).join(', ')}`,
    affected_elements: affectedElements,
  };
}
