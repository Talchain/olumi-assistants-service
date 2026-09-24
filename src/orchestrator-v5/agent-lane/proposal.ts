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
  readonly op:
    | 'add_node' | 'remove_node' | 'update_node'
    | 'add_edge' | 'remove_edge' | 'update_edge'
    /**
     * ⭐ SET A FACTOR TO A STATED ASSUMPTION.
     *
     * The gap this exists to close, measured on a real session: the model had
     * 17 factors with no value, the Agent proposed sensible assumptions in
     * prose, the user replied "these look like a good set of assumptions, can
     * you update the model with them?" — and nothing happened. Honest and
     * inert. Current CEE fills the same blanks by INVENTING values and
     * attributing them to itself, which is worse; the right answer is a value
     * the USER adopts, recorded as an assumption rather than a measurement.
     */
    | 'set_factor_value'
    /**
     * ⭐ SAY WHAT AN OPTION DOES — `path` is `optionId::factorId`.
     *
     * Measured live: with every factor valued and the scale frame in place,
     * the analysis was STILL refused because two options connected to a factor
     * without saying what level they set it to. An option that sets nothing
     * cannot be compared with one that does, so it blocks the comparison for
     * every option, not only itself.
     *
     * ⚠ This op was written once and WITHDRAWN before shipping, because
     * `option_intervention_edit.value` is bounded `[0, 1]` and the contract
     * states "the client converts nothing" — so a user's "£54" could not be
     * expressed without inventing a scale. It is buildable now only because
     * the factor carries a DECLARED `cap`: `raw / cap` reads the user's own
     * number against a range the model already published and disclosed, which
     * is a different act from choosing one at the point of writing.
     */
    | 'set_option_intervention';
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

/**
 * ⭐ WHAT A SAVED CHANGE BECAME — the compact, user-meaningful half of a
 * `model_version_receipt`.
 *
 * Deliberately NOT the whole receipt: the receipt carries the entire committed
 * `graph`, and a tool result is JSON-stringified straight back into the model's
 * context on every hop. These four fields are what identifies the version and
 * what a retry must be able to hand back unchanged.
 */
export interface ReceiptSummary {
  /** The version number the user would see ("version 7"). */
  readonly version: number;
  readonly version_id: string;
  readonly mutation_id: string;
  readonly source_turn_id: string | null;
}

/**
 * ⭐ PROPOSAL-OWNED PARTIAL PROGRESS (independent review of #1788, 5806071796). A partial write
 * moves the model's hash, so a retry of the SAME proposal was refused as `superseded` before it
 * could add what was missing. What THIS proposal's own write landed is recorded with the canonical
 * revision it left; a retry continues only from exactly that revision. Any other revision means
 * someone else changed the model since — still `superseded`, never bypassed.
 */
export interface PartialProgress {
  /** The canonical revision this proposal's own partial write left. */
  readonly revision: string;
  /** The operation paths confirmed landed from readback. */
  readonly landed: readonly string[];
  readonly receipts: readonly ReceiptSummary[];
}

export type AuthorisationDecision =
  | { readonly status: 'execute'; readonly proposal: StructuredProposal; readonly continuation?: PartialProgress }
  /** The model moved since the proposal was made. */
  | { readonly status: 'superseded'; readonly expected: string; readonly actual: string }
  /** Applied already under this identity — return the original outcome. */
  /**
   * Applied already under this identity. Carries the ORIGINAL receipts, so a
   * retry recovers what the first authorisation produced instead of only being
   * told that something happened once.
   */
  | { readonly status: 'already_applied'; readonly proposal: StructuredProposal; readonly receipts: readonly ReceiptSummary[] }
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
  /** Applied proposals, with the receipts their writes produced (empty when none was minted). */
  private readonly applied = new Map<string, readonly ReceiptSummary[]>();
  /** Proposals whose own write landed only in part, with what landed and the revision it left. */
  private readonly partial = new Map<string, PartialProgress>();
  private order: string[] = [];

  put(p: StructuredProposal): StructuredProposal {
    if (this.items.size >= MAX_PROPOSALS && !this.items.has(p.proposal_id)) {
      this.evictOne();
    }
    if (!this.items.has(p.proposal_id)) this.order.push(p.proposal_id);
    this.items.set(p.proposal_id, p);
    return p;
  }

  /**
   * ⛔ NEVER EVICT AN APPLIED PROPOSAL WHILE AN UNAPPLIED ONE IS AVAILABLE.
   *
   * This used to be `this.order.shift()` — drop the oldest id from `items`, and
   * leave `applied` untouched. But `authorise` reads `items` FIRST and returns
   * `unknown_proposal` before it ever consults `applied`, so an approval that HAD
   * been applied came back as "no longer available".
   *
   * The user-visible cost is not a wrong code. `REFUSAL_WORDS.unknown_proposal`
   * USED TO read "that proposal is no longer available, so nothing was changed — ask me
   * to suggest it again and approve the new one", so the user is told nothing was
   * saved when it WAS, and invited to apply the same change a second time.
   *
   * Eviction targeted exactly the wrong entries: `order` is FIFO and an applied
   * proposal is by definition one that has already been through a full cycle, so
   * it sits among the oldest. And this store is a PROCESS-WIDE singleton shared by
   * every user and scenario, so the cap is reached by total traffic rather than by
   * any one conversation.
   *
   * ⚠ The bound is unchanged: exactly one entry is removed per call. When every
   * candidate IS applied — which needs 200 applied proposals and no outstanding
   * one, so it is a far corner rather than the path above — the oldest is removed
   * and its `applied` record goes with it, keeping `applied` a SUBSET of `items`.
   * A receipt we can no longer name a proposal for is worse than none, because
   * `authorise` would find the record and have nothing to return with it.
   */
  private evictOne(): void {
    /**
     * ⛔ PARTIAL PROGRESS IS COMMITTED STATE (Codex 5810472138, the interaction with #1788): an option
     * whose node landed but whose links did not was promised a same-proposal continuation. Evicting it as
     * "unapplied" broke that promise and orphaned its `partial` record. So: an untouched proposal first,
     * then an applied one (forgotten, it is told honestly — `write-outcome.ts` `unknown_proposal`), and a
     * partially saved one only when nothing else is left. Every record for the victim goes with it.
     */
    const held = (id: string) => this.items.has(id);
    const victim =
      this.order.find((id) => held(id) && !this.applied.has(id) && !this.partial.has(id))
      ?? this.order.find((id) => held(id) && this.applied.has(id))
      ?? this.order.find((id) => held(id));
    if (victim === undefined) return;
    this.items.delete(victim);
    this.applied.delete(victim);
    this.partial.delete(victim);
    this.order = this.order.filter((x) => x !== victim);
  }

  /** How many records each map holds — so a test can prove no record outlives its proposal. */
  recordCounts(): { items: number; applied: number; partial: number } {
    return { items: this.items.size, applied: this.applied.size, partial: this.partial.size };
  }

  get(id: string): StructuredProposal | undefined {
    return this.items.get(id);
  }

  markApplied(id: string, receipts: readonly ReceiptSummary[] = []): void {
    this.applied.set(id, receipts);
    this.partial.delete(id);
  }

  /** Record what THIS proposal's own write landed, and the canonical revision that left. */
  markPartial(id: string, progress: PartialProgress): void {
    this.partial.set(id, progress);
  }

  /**
   * Remove a proposal that was only ever a BUILDING BLOCK of another one — the
   * two halves a starting point is composed from, or a compound's part that
   * refused. Left in the store they would be listed as awaiting approval, and
   * "if there is exactly one, authorise THAT proposal_id" would pick the wrong
   * object. Never called on a proposal the user was shown.
   */
  discard(id: string): void {
    this.items.delete(id);
    this.order = this.order.filter((x) => x !== id);
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
    if (this.applied.has(p.proposal_id)) {
      return { status: 'already_applied', proposal: p, receipts: this.applied.get(p.proposal_id) ?? [] };
    }
    const partial = this.partial.get(p.proposal_id);
    if (partial !== undefined) {
      // Continue ONLY from the revision this proposal's own partial write left.
      if (partial.revision === req.current_graph_identity_hash) return { status: 'execute', proposal: p, continuation: partial };
      return { status: 'superseded', expected: partial.revision, actual: req.current_graph_identity_hash };
    }
    if (p.base_graph_identity_hash !== req.current_graph_identity_hash) {
      return {
        status: 'superseded',
        expected: p.base_graph_identity_hash,
        actual: req.current_graph_identity_hash,
      };
    }
    return { status: 'execute', proposal: p };
  }

  /**
   * ⭐ THE PROPOSALS STILL AWAITING A YES, newest first.
   *
   * ⛔ MEASURED on the deployed build: the user said "Yes, apply it" and the
   * Agent called NO tools, answering that the changes "have been proposed but
   * not approved or applied". Two proposals were outstanding from earlier
   * turns and it had no way to name either, so the approval simply evaporated
   * — the single worst thing this loop can do, because the user believes the
   * model changed and it did not.
   *
   * Exposed through `get_canonical_state` so an approval always has an id to
   * bind to, and so "which one?" is a question the Agent can actually ask.
   */
  outstanding(scenarioId: string, userId: string | null): { proposal_id: string; public_label: string }[] {
    const out: { proposal_id: string; public_label: string }[] = [];
    for (let i = this.order.length - 1; i >= 0; i -= 1) {
      const p = this.items.get(this.order[i]);
      if (p === undefined) continue;
      if (p.scenario_id !== scenarioId || p.user_id !== userId) continue;
      if (this.applied.has(p.proposal_id)) continue;
      out.push({ proposal_id: p.proposal_id, public_label: p.public_label });
    }
    return out;
  }

  size(): number {
    return this.items.size;
  }
}
