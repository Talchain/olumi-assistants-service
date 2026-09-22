/**
 * Agent lane — a proposal the user authorises is the proposal that gets applied.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⛔ THE FORBIDDEN SHAPE, spelled out because it is the natural one to write:
 *
 *     Agent describes a change in prose
 *       -> user says "yes"
 *       -> Agent regenerates the mutation
 *       -> write
 *
 * The regenerated object is NOT the object the user agreed to. Same prompt, same
 * model, a different sample — and the user's "yes" has been transferred onto
 * something they never saw. The banked conversation shows why the gap is real:
 * the user said "at least 2%", and a regeneration could just as easily encode
 * 2% exactly, or 2.5%, and still look like what was discussed.
 *
 * ⭐ SO THE APPROVED OBJECT IS STORED, AND THE WRITE APPLIES THE STORED ONE.
 * `proposal_id` is a hash OVER THE CONTENT, so a proposal whose operations,
 * scenario or base revision differ is a different id by construction: you cannot
 * quietly swap the payload under an authorisation. That is what "structurally
 * bound" means here — the id is not a lookup key that happens to point at
 * content, it is a statement about the content.
 *
 * ⭐ AND THE BASE REVISION IS PART OF IT. A proposal is a claim about a specific
 * model state. If the model moved after the Agent proposed, the change is
 * `superseded` — not applied to a state nobody evaluated it against. This is the
 * same rule the existing conversational proposal path applies via
 * `preconditions.graph_hash`; it is reused as a rule, not reimplemented as a
 * second copy of the CAS itself, which still lives in the write boundary.
 */

import { createHash } from 'node:crypto';

/** One structural change. Deliberately the estate's existing op vocabulary. */
export interface ProposalOperation {
  readonly op: 'add_node' | 'remove_node' | 'update_node' | 'add_edge' | 'remove_edge' | 'update_edge';
  /** Node id, or `from::to` for an edge. */
  readonly path: string;
  readonly value?: unknown;
}

export interface ProposalValidation {
  readonly admitted: boolean;
  /** Every field the system supplied that nobody authored. */
  readonly loss_count: number;
  readonly refusals: readonly string[];
}

export interface StructuredProposal {
  readonly proposal_id: string;
  readonly scenario_id: string;
  /** The subject this proposal belongs to. `null` for a guest scenario. */
  readonly user_id: string | null;
  /** The model state this proposal was evaluated against. */
  readonly base_graph_identity_hash: string;
  readonly operations: readonly ProposalOperation[];
  /** Who authored the change being proposed — never the user, for an AI proposal. */
  readonly provenance: { readonly authored_by: 'model_proposed' | 'user_stated'; readonly basis?: string };
  readonly validation: ProposalValidation;
  /** What the user was actually shown. Stored so the receipt can quote it. */
  readonly public_label: string;
}

export type ProposalContent = Omit<StructuredProposal, 'proposal_id'>;

/**
 * A stable id over the CONTENT. Key order is fixed explicitly rather than left
 * to `JSON.stringify` of an object literal, so a re-ordered but identical
 * proposal hashes the same and a changed one cannot collide.
 */
export function computeProposalId(c: ProposalContent): string {
  const canonical = JSON.stringify([
    c.scenario_id,
    c.user_id,
    c.base_graph_identity_hash,
    c.operations.map((o) => [o.op, o.path, o.value === undefined ? null : o.value]),
    [c.provenance.authored_by, c.provenance.basis ?? null],
    [c.validation.admitted, c.validation.loss_count, [...c.validation.refusals].sort()],
    c.public_label,
  ]);
  return 'prop_' + createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export function createProposal(content: ProposalContent): StructuredProposal {
  return { ...content, proposal_id: computeProposalId(content) };
}

export type AuthorisationDecision =
  | { readonly status: 'execute'; readonly proposal: StructuredProposal }
  /** The model moved since the proposal was made. */
  | { readonly status: 'superseded'; readonly expected: string; readonly actual: string }
  /** Applied already under this identity — return the original outcome. */
  | { readonly status: 'already_applied'; readonly proposal: StructuredProposal }
  | { readonly status: 'unknown_proposal' }
  /** The authorising subject is not the proposal's subject. */
  | { readonly status: 'not_authorised' }
  /** The stored content no longer hashes to its id. */
  | { readonly status: 'integrity_failed' };

export interface AuthorisationRequest {
  readonly proposal_id: string;
  readonly scenario_id: string;
  readonly authenticated_user_id: string | null;
  /** The model's CURRENT revision, read server-side. Never client-supplied. */
  readonly current_graph_identity_hash: string;
}

export const MAX_PROPOSALS = 200;

export class ProposalStore {
  private readonly items = new Map<string, StructuredProposal>();
  private readonly applied = new Set<string>();
  private order: string[] = [];

  put(p: StructuredProposal): StructuredProposal {
    if (this.items.size >= MAX_PROPOSALS && !this.items.has(p.proposal_id)) {
      const oldest = this.order.shift();
      if (oldest !== undefined) this.items.delete(oldest);
    }
    if (!this.items.has(p.proposal_id)) this.order.push(p.proposal_id);
    this.items.set(p.proposal_id, p);
    return p;
  }

  get(id: string): StructuredProposal | undefined {
    return this.items.get(id);
  }

  markApplied(id: string): void {
    this.applied.add(id);
  }

  /**
   * Decide whether this authorisation may execute. Returns the STORED proposal —
   * a caller that regenerates the mutation instead of applying `decision.proposal`
   * has defeated the whole mechanism.
   */
  authorise(req: AuthorisationRequest): AuthorisationDecision {
    const p = this.items.get(req.proposal_id);
    if (p === undefined) return { status: 'unknown_proposal' };
    if (p.scenario_id !== req.scenario_id || p.user_id !== req.authenticated_user_id) {
      return { status: 'not_authorised' };
    }
    // The content must still hash to its id. Cheap, and it turns a silent
    // in-memory mutation into a refusal rather than an unnoticed swap.
    const { proposal_id: _ignored, ...content } = p;
    if (computeProposalId(content) !== p.proposal_id) return { status: 'integrity_failed' };
    if (this.applied.has(p.proposal_id)) return { status: 'already_applied', proposal: p };
    if (p.base_graph_identity_hash !== req.current_graph_identity_hash) {
      return {
        status: 'superseded',
        expected: p.base_graph_identity_hash,
        actual: req.current_graph_identity_hash,
      };
    }
    return { status: 'execute', proposal: p };
  }

  size(): number {
    return this.items.size;
  }
}
