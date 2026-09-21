/**
 * Replacement conversation layer — durable proposals, consent and receipts.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three failures measured on live sessions (20 Sep 2026, CEE `3f238b1`), all
 * of them this module's territory:
 *
 *   1. The assistant proposed a specific change. The user replied "Yes, make
 *      that update now." The product answered: "I don't have a pending
 *      suggested update to apply." The proposal had never been a durable
 *      object — it existed only as conversational text.
 *   2. An edit landed, was announced as "Updated Monthly Churn Rate", and was
 *      then DENIED twice inside 100 seconds. Nothing recorded what had
 *      actually persisted, so the next turn had nothing to check itself
 *      against.
 *   3. A held change "lapsed because the model changed" — correct behaviour,
 *      communicated as internal bookkeeping the user could not parse, with no
 *      route back to the thing he still wanted.
 *
 * THE SHAPE OF THE ANSWER
 * -----------------------
 * Proposing, authorising and applying are THREE separate events, each
 * recorded, each with its own evidence. The store never infers one from
 * another, and it never guesses.
 *
 *   open ──authorise──▶ authorised ──beginApply──▶ apply_in_flight
 *     │                      │                          │
 *     │                      │                    recordApplied
 *     ▼                      ▼                          ▼
 *   stale (revision moved) / withdrawn                applied
 *
 * `apply_in_flight` is the state that makes an interrupted save survivable.
 * It is written BEFORE the mutation is attempted and carries an idempotency
 * key. If the response is lost, the next turn finds a proposal that is neither
 * clearly applied nor clearly not, and {@link needsReconciliation} says so —
 * so the conversation asks the mutation path what happened instead of telling
 * the user a story. Guessing in either direction is a defect: guess "applied"
 * and you lie; guess "not applied" and a retry double-applies.
 *
 * WHAT THIS MODULE REFUSES
 * ------------------------
 * · `open → applied` directly. Authorisation is mandatory and must name the
 *   user turn that gave it. An assistant-generated proposal NEVER becomes
 *   authorised by sitting in conversational memory.
 * · Applying against a model revision other than the one authorised. The
 *   binding is the whole point: consent was given to a change against a
 *   specific state of the model.
 * · A second `recordApplied` with a DIFFERENT receipt. Same receipt is an
 *   idempotent no-op (a retry); a different receipt means two writes landed
 *   and that is a fault to surface, not to absorb.
 */

/** Operations a proposal would perform. Opaque here — the mutation path owns
 *  their meaning; this module owns only that they were consented to as a set. */
export interface ProposalOperation {
  readonly kind: string;
  readonly summary: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export type ProposalStatus =
  | 'open'
  | 'authorised'
  | 'apply_in_flight'
  | 'applied'
  /**
   * TERMINAL AND HONEST: the outcome could not be established, and we have
   * stopped trying.
   *
   * ⛔ IT EXISTS BECAUSE `apply_in_flight` WAS A ONE-WAY DOOR. A proposal whose
   * retries were exhausted stayed in flight, so `needsReconciliation` returned
   * it on EVERY later turn, the controller short-circuited before the agent
   * loop, and the user got the same notice forever with no model call. The
   * conversation was bricked by the mechanism meant to keep it honest.
   *
   * This status says the one thing that is true — nobody knows whether that
   * write landed — while letting the conversation continue. It is NOT
   * `applied` and NOT a failure: claiming either would be the guess this whole
   * module refuses to make.
   */
  | 'unresolved'
  | 'stale'
  /**
   * TERMINAL: the user changed the offer rather than accepting or rejecting it,
   * and this proposal has been replaced by the amended one it names.
   *
   * ⛔ IT IS NOT `withdrawn`. Withdrawn means the change is off the table;
   * superseded means the change is still wanted with different numbers. A user
   * who says "yes, but make it 0.6" has not rejected anything, and telling them
   * their change was "set aside" would be false.
   */
  | 'superseded'
  | 'withdrawn';

export interface Proposal {
  readonly id: string;
  readonly status: ProposalStatus;
  readonly operations: readonly ProposalOperation[];
  /** The model revision the proposal was made against. Consent binds to it. */
  readonly model_revision: string;
  readonly proposed_at: string;
  readonly proposed_in_turn: string;
  /** Set on authorise. Names the user turn that gave consent — never inferred. */
  readonly authorised_in_turn?: string;
  readonly authorised_at?: string;
  /** Set on beginApply. The key the mutation path must use, so a retry is a
   *  no-op rather than a second write. */
  readonly idempotency_key?: string;
  readonly apply_started_at?: string;
  /** Set on recordApplied. Proof it persisted, from the mutation path. */
  readonly receipt_id?: string;
  readonly applied_at?: string;
  /** Set when the revision moved under an un-applied proposal. */
  readonly stale_reason?: 'model_revision_moved';
  readonly stale_from_status?: ProposalStatus;  /** Set when the write path affirmatively reported the save did not land.
   *  Distinct from an unknown outcome, which stays in flight. */
  readonly last_apply_failure?: { readonly reason: string; readonly failed_at: string };  /** How many times a save has been SENT for this proposal, including the
   *  first. Bounds the retry loop — see {@link MAX_APPLY_ATTEMPTS}. */
  readonly apply_attempts?: number;
  /** Set when the retries were exhausted and we stopped. See `unresolved`. */
  readonly unresolved_at?: string;
  /** Set on the ORIGINAL when amended: the id of the proposal replacing it. */
  readonly superseded_by?: string;
  /** Set on the AMENDMENT: the id of the proposal it replaces. */
  readonly amends?: string;
  readonly amended_at?: string;
  /** Names the user turn whose words asked for the change. Never inferred. */
  readonly amended_in_turn?: string;
}

export interface ProposalStore {
  readonly proposals: readonly Proposal[];
}

export const EMPTY_PROPOSAL_STORE: ProposalStore = { proposals: [] };

export class ProposalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalStateError';
  }
}

function assertState(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ProposalStateError(message);
}

function isNonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function find(store: ProposalStore, id: string): Proposal {
  const p = store.proposals.find((x) => x.id === id);
  assertState(p !== undefined, `unknown proposal: ${id}`);
  return p;
}

function replace(store: ProposalStore, next: Proposal): ProposalStore {
  return { proposals: store.proposals.map((p) => (p.id === next.id ? next : p)) };
}

export interface OpenProposalInput {
  readonly id: string;
  readonly operations: readonly ProposalOperation[];
  readonly model_revision: string;
  readonly proposed_at: string;
  readonly proposed_in_turn: string;
}

/**
 * Deep-equal over an operation list, by the store's own serialisation.
 *
 * The store's header says operations are "Opaque here — the mutation path owns
 * their meaning", so comparing them structurally is the only comparison this
 * module is entitled to make. `JSON.stringify` is exact for the shape the store
 * persists: it round-trips through `deps.state.save` as JSON already, so any
 * value it cannot represent could not have been stored in the first place.
 */
function sameOperations(
  a: readonly ProposalOperation[],
  b: readonly ProposalOperation[],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Record a proposal the assistant has put to the user. Not consent. */
export function openProposal(store: ProposalStore, input: OpenProposalInput): ProposalStore {
  assertState(isNonEmpty(input.id), 'proposal id is required');
  assertState(input.operations.length > 0, 'a proposal with no operations is not a proposal');
  assertState(isNonEmpty(input.model_revision), 'model_revision is required — consent binds to a specific state of the model');
  assertState(isNonEmpty(input.proposed_in_turn), 'proposed_in_turn is required');

  // ⭐ A RETRY OF THE SAME TURN IS A NO-OP, NOT AN ERROR — and this was found by
  // an adversarial review AFTER the change that made it reachable.
  //
  // Proposal ids are `proposal-<turnId>-<index>`, and `turnId` is the PAYLOAD's
  // turn id (it was the per-attempt request id until it was changed so a retry
  // would reuse the applier's `(scenario_id, turn_id)` idempotency key). Stable
  // ids are the point. But that made a client retry of the same logical turn —
  // the exact case the change was for — re-propose with an id already in the
  // persisted store, and this assertion threw. Nothing catches it: the
  // controller has NO FALLBACK by design, so every later retry of that turn id
  // failed the same way, permanently.
  //
  // A regression introduced in the name of retry safety, which is why it is
  // worth the paragraph.
  //
  // The distinction that matters: the SAME offer arriving twice is the retry
  // working as intended, so it is idempotent. The same id carrying DIFFERENT
  // operations is a genuine id-minting defect and must still be loud — silently
  // keeping the first would show the user one change and hold another.
  const existing = store.proposals.find((p) => p.id === input.id);
  if (existing !== undefined) {
    assertState(
      sameOperations(existing.operations, input.operations),
      `duplicate proposal id with different operations: ${input.id}`,
    );
    return store;
  }
  return {
    proposals: [
      ...store.proposals,
      {
        id: input.id,
        status: 'open',
        operations: input.operations,
        model_revision: input.model_revision,
        proposed_at: input.proposed_at,
        proposed_in_turn: input.proposed_in_turn,
      },
    ],
  };
}

/**
 * The user consented. Must name the user turn — an assistant-generated
 * proposal never becomes authorised merely by remaining in memory.
 *
 * Refuses when the model revision has moved: consent was given to a change
 * against a specific model state, and the conversation must ask again rather
 * than apply something the user did not actually agree to.
 */
export function authoriseProposal(
  store: ProposalStore,
  id: string,
  opts: { readonly authorised_in_turn: string; readonly authorised_at: string; readonly current_model_revision: string },
): ProposalStore {
  const p = find(store, id);
  assertState(isNonEmpty(opts.authorised_in_turn), 'authorised_in_turn is required — consent must name the user turn that gave it');
  assertState(p.status === 'open', `cannot authorise a proposal in status "${p.status}"`);
  assertState(
    p.model_revision === opts.current_model_revision,
    'the model changed after this was proposed — re-propose against the current revision rather than applying unconsented work',
  );
  return replace(store, {
    ...p,
    status: 'authorised',
    authorised_in_turn: opts.authorised_in_turn,
    authorised_at: opts.authorised_at,
  });
}

/**
 * Mark the write as being attempted. Call this BEFORE the mutation, so an
 * interrupted save is visible afterwards. The key returned must be the one the
 * mutation path uses, so a retry cannot double-apply.
 */
export function beginApply(
  store: ProposalStore,
  id: string,
  opts: { readonly idempotency_key: string; readonly apply_started_at: string; readonly current_model_revision: string },
): ProposalStore {
  const p = find(store, id);
  assertState(isNonEmpty(opts.idempotency_key), 'idempotency_key is required');
  assertState(p.status === 'authorised', `cannot apply a proposal in status "${p.status}" — authorisation is mandatory`);
  assertState(
    p.model_revision === opts.current_model_revision,
    'the model changed between consent and the write — do not apply against a revision the user did not consent to',
  );
  return replace(store, {
    ...p,
    status: 'apply_in_flight',
    idempotency_key: opts.idempotency_key,
    apply_started_at: opts.apply_started_at,
  });
}

/**
 * The mutation path returned a receipt. Idempotent for the SAME receipt (a
 * retry, or a reconciliation discovering the write had landed). A DIFFERENT
 * receipt means two writes landed and is raised, not absorbed.
 */
export function recordApplied(
  store: ProposalStore,
  id: string,
  opts: { readonly receipt_id: string; readonly applied_at: string },
): ProposalStore {
  const p = find(store, id);
  assertState(isNonEmpty(opts.receipt_id), 'receipt_id is required — a change without a receipt is a claim');

  if (p.status === 'applied') {
    assertState(
      p.receipt_id === opts.receipt_id,
      `proposal ${id} already applied under receipt ${String(p.receipt_id)}; a second receipt ${opts.receipt_id} means two writes landed`,
    );
    return store; // idempotent no-op
  }

  assertState(
    p.status === 'apply_in_flight' || p.status === 'authorised',
    `cannot record a receipt against status "${p.status}"`,
  );
  return replace(store, { ...p, status: 'applied', receipt_id: opts.receipt_id, applied_at: opts.applied_at });
}

/**
 * The user changed their mind, or the assistant retracted.
 *
 * ⚠ CANCELLATION IS NOT ROLLBACK, AND THIS FUNCTION GOT THAT WRONG ONCE.
 *
 * As first written, this refused only `applied` — so an `apply_in_flight`
 * proposal could be withdrawn, which silently removed it from
 * {@link needsReconciliation} while its write may already have landed. The
 * store would then hold no record that anything was outstanding, and the
 * conversation would be free to say the change did not happen. That is the
 * "updated then denied" defect arriving through the cancel path instead of
 * the save path.
 *
 * The reasoning was already written out, correctly, in
 * {@link markStaleForRevision} directly below — and was not applied here.
 * Caught by review (Codex, 20 Sep 2026), not by this module's own suite,
 * which is why the case is now pinned by two tests and a mutant.
 *
 * An unknown outcome survives every state change except reconciliation.
 */
export interface AmendProposalInput {
  /** The AMENDMENT's own id. A new proposal, not a mutation of the old one. */
  readonly amended_id: string;
  readonly operations: readonly ProposalOperation[];
  readonly amended_at: string;
  readonly amended_in_turn: string;
  readonly current_model_revision: string;
}

/**
 * ⭐ THE THIRD VERB. The user neither accepted nor rejected — they changed it.
 *
 * ⛔⛔ WHY THIS EXISTS RATHER THAN A WIDER CONFIRMATION PREDICATE, which is the
 * fix that suggests itself and is WRONG. An authorised change replays from its
 * STORED OPERATIONS and never re-reads the user's message. So widening the
 * confirm predicate to accept "yes, make it 0.6" writes the OFFER's number and
 * discards the user's — and issues a receipt saying it saved what they asked
 * for. A silent wrong write with a truthful-looking confirmation is strictly
 * worse than a refusal, which is why the predicate is RIGHT to refuse a value
 * restatement and why the remedy belongs here instead.
 *
 * ⛔⛔ AND THE RULE THAT MAKES IT SAFE: THE AMENDMENT DOES NOT INHERIT CONSENT.
 * It opens at `'open'`. Authorisation binds to SPECIFIC OPERATIONS at a
 * specific revision (see {@link authoriseProposal}); once the operations
 * change, the earlier consent does not cover them, and carrying it across would
 * reintroduce the exact harm above by another route. Whether the same user
 * message ALSO authorises the amended operations is a question for the caller,
 * which can read the message; this store cannot, and must not guess.
 *
 * Amendable from `open` or `authorised` only. An in-flight save cannot be
 * changed — the bytes are already gone — and an applied change needs a
 * reversing change with its own consent, the same rule withdraw follows.
 */
export function amendProposal(
  store: ProposalStore,
  id: string,
  input: AmendProposalInput,
): ProposalStore {
  assertState(isNonEmpty(input.amended_id), 'the amendment needs its own id');
  assertState(input.amended_id !== id, 'an amendment is a new proposal, so it cannot reuse the id it replaces');
  assertState(input.operations.length > 0, 'an amendment with no operations is a withdrawal, not an amendment');
  assertState(isNonEmpty(input.amended_in_turn), 'amended_in_turn is required — an amendment names the user turn that asked for it');

  const p = find(store, id);

  // Retry-safe, on the same reasoning as openProposal: the SAME amendment
  // arriving twice is a client retry working as intended. A different one
  // against an already-superseded proposal is a genuine defect and stays loud.
  if (p.status === 'superseded') {
    const already = store.proposals.find((q) => q.id === p.superseded_by);
    assertState(
      p.superseded_by === input.amended_id
        && already !== undefined
        && sameOperations(already.operations, input.operations),
      `proposal "${id}" was already amended by "${p.superseded_by ?? '(unknown)'}"`,
    );
    return store;
  }

  assertState(
    p.status === 'open' || p.status === 'authorised',
    `cannot amend a proposal in status "${p.status}"`,
  );
  assertState(
    !sameOperations(p.operations, input.operations),
    'an amendment must change the operations — identical operations mean nothing was amended',
  );
  // Same rule authorise follows, for the same reason: an amendment is consent
  // work against a specific model state. `markStaleForRevision` normally moves
  // a proposal to `stale` first, so this is the belt to that braces — but a
  // caller that skips it must not get a silent pass.
  assertState(
    p.model_revision === input.current_model_revision,
    'the model changed after this was proposed — re-propose against the current revision rather than amending stale work',
  );

  const superseded: Proposal = { ...p, status: 'superseded', superseded_by: input.amended_id };
  const amendment: Proposal = {
    id: input.amended_id,
    // ⛔ NOT `authorised`, whatever `p.status` was. See the docblock.
    status: 'open',
    operations: input.operations,
    model_revision: input.current_model_revision,
    proposed_at: input.amended_at,
    proposed_in_turn: input.amended_in_turn,
    amends: id,
    amended_at: input.amended_at,
    amended_in_turn: input.amended_in_turn,
  };
  return {
    proposals: [...store.proposals.map((q) => (q.id === id ? superseded : q)), amendment],
  };
}

export function withdrawProposal(store: ProposalStore, id: string): ProposalStore {
  const p = find(store, id);
  assertState(p.status !== 'applied', 'an applied change cannot be withdrawn here — it needs a reversing change with its own consent');
  assertState(
    p.status !== 'apply_in_flight',
    'a save that is already in flight cannot be withdrawn — its outcome is unknown, and cancelling it here would discard that fact. Reconcile it first, then withdraw or reverse whatever actually happened',
  );
  return replace(store, { ...p, status: 'withdrawn' });
}

/**
 * The model moved. Un-applied proposals become `stale` and must be re-offered.
 *
 * `apply_in_flight` is deliberately NOT marked stale: its write may already
 * have landed, so it stays in flight for {@link needsReconciliation} to
 * surface. Marking it stale would assert it did not land.
 */
export function markStaleForRevision(store: ProposalStore, current_model_revision: string): ProposalStore {
  return {
    proposals: store.proposals.map((p) => {
      if (p.model_revision === current_model_revision) return p;
      if (p.status !== 'open' && p.status !== 'authorised') return p;
      return { ...p, status: 'stale' as const, stale_reason: 'model_revision_moved' as const, stale_from_status: p.status };
    }),
  };
}

/**
 * Proposals whose outcome is genuinely unknown — a save was started and no
 * receipt came back. The conversation must ask the mutation path (by
 * idempotency key) what happened, and must NOT tell the user either story
 * until it knows. This is the interrupted-save case.
 */
export function needsReconciliation(store: ProposalStore): readonly Proposal[] {
  return store.proposals.filter((p) => p.status === 'apply_in_flight');
}

/**
 * Stop trying, and say so — the exit from {@link ProposalStatus} `unresolved`'s
 * docblock.
 *
 * Called only when {@link isRetryExhausted} holds, so the cap is the single
 * authority on when to give up and this function does not re-decide it.
 */
export function recordUnresolved(
  store: ProposalStore,
  id: string,
  opts: { readonly at: string },
): ProposalStore {
  const p = find(store, id);
  assertState(
    p.status === 'apply_in_flight',
    `only a save in flight can become unresolved, and this one is "${p.status}"`,
  );
  assertState(
    isRetryExhausted(p),
    'a save may only be abandoned once its attempts are exhausted — the cap is the authority',
  );
  return replace(store, { ...p, status: 'unresolved', unresolved_at: opts.at });
}

/** Proposals abandoned with an unknown outcome. Rendered so the user can see
 *  that one exists rather than discovering it later. */
export function unresolvedProposals(store: ProposalStore): readonly Proposal[] {
  return store.proposals.filter((p) => p.status === 'unresolved');
}

/** Proposals a "yes" could still attach to. Excludes stale and in-flight. */
export function openProposals(store: ProposalStore): readonly Proposal[] {
  return store.proposals.filter((p) => p.status === 'open');
}

/** Everything that actually persisted, with its receipt. The only honest
 *  source for an "I changed X" sentence. */
export function appliedProposals(store: ProposalStore): readonly Proposal[] {
  return store.proposals.filter((p) => p.status === 'applied');
}

/**
 * Plain-language state for the conversation. Deliberately not the internal
 * status string: "The held change 'Set this value' has lapsed because the
 * model changed" was an accurate internal status shown raw to a user who then
 * asked what it meant and could not be told.
 */
export function describeForUser(p: Proposal): string {
  switch (p.status) {
    case 'open':
      return 'waiting for you to say yes';
    case 'authorised':
      return 'you agreed to this and it is about to be saved';
    case 'apply_in_flight':
      return 'the save was started and I have not confirmed the outcome yet';
    case 'unresolved':
      // Says the unknown plainly and does not resolve it in either direction.
      // "failed" and "saved" are both guesses here, and the whole point of the
      // status is that nobody is entitled to either.
      return 'the save was started and its outcome could never be confirmed — it may or may not be in the model';
    case 'applied':
      return 'saved';
    case 'stale':
      return 'the model has changed since I offered this, so I need to put it to you again';
    case 'superseded':
      // Never "set aside": the user still wants the change, with different
      // numbers. See the status docblock.
      return 'replaced by the amended version you asked for';
    case 'withdrawn':
      return 'set aside';
  }
}

/**
 * How many times a save may be sent for one proposal before this layer stops
 * retrying and leaves the question open for the user.
 *
 * WHY A CAP EXISTS. Retrying an unknown save under its original idempotency
 * key is safe ONLY IF the write path honours that key. This layer cannot
 * enforce that — it is a property of another module, declared as a hard
 * precondition on `ApplyOperations`. A precondition you depend on and cannot
 * check deserves a blast radius.
 *
 * With the cap, a write path that silently ignores the key costs at most
 * three attempts instead of one per turn for the life of the conversation.
 * Without it, the retry that fixed a bricked conversation would be strictly
 * WORSE than the bricking wherever that precondition failed.
 *
 * Three rather than one: a transient fault genuinely does clear on a second
 * or third attempt, and resolving those without troubling the user is the
 * whole point of retrying.
 */
export const MAX_APPLY_ATTEMPTS = 3;

/** Count a save being sent. Called before each attempt, including the first. */
export function recordApplyAttempt(store: ProposalStore, id: string): ProposalStore {
  const p = find(store, id);
  return replace(store, { ...p, apply_attempts: (p.apply_attempts ?? 0) + 1 });
}

/** True when this proposal has exhausted its attempts and must not be sent
 *  again without a human deciding. */
export function isRetryExhausted(p: Proposal): boolean {
  return (p.apply_attempts ?? 0) >= MAX_APPLY_ATTEMPTS;
}

/**
 * The mutation path came back and said, affirmatively, that it did NOT land.
 *
 * This is the third outcome, and it must be kept apart from the other two.
 *  · a receipt            → `applied`. It happened.
 *  · an affirmative "no"  → here. It did not happen, and a retry is safe.
 *  · nothing, or a throw  → stays `apply_in_flight`. UNKNOWN, and the only
 *                           honest move is to reconcile before saying anything.
 *
 * Only call this when the write path has actually told you the write did not
 * land. A timeout, a dropped connection or a thrown error is NOT that: it is
 * the unknown case, and routing it here would assert something nobody knows —
 * which is the "updated then denied" defect with the sign flipped.
 *
 * Returns to `authorised` and KEEPS the idempotency key, so a retry is the
 * same write rather than a second one.
 */
export function recordApplyFailed(
  store: ProposalStore,
  id: string,
  opts: { readonly reason: string; readonly failed_at: string },
): ProposalStore {
  const p = find(store, id);
  assertState(
    p.status === 'apply_in_flight',
    `only a save in flight can be reported as failed, and this one is "${p.status}"`,
  );
  return replace(store, {
    ...p,
    status: 'authorised',
    last_apply_failure: { reason: opts.reason, failed_at: opts.failed_at },
  });
}

/**
 * The exact operations a "yes" authorised — the ONLY thing that may be applied.
 *
 * WHY THIS EXISTS AS A FUNCTION RATHER THAN A FIELD READ
 * ------------------------------------------------------
 * The tempting shape is: user agrees, the assistant re-derives the change from
 * the conversation, and applies that. It is tempting because it looks more
 * responsive — the re-derivation can incorporate whatever the user said in the
 * same breath as "yes". It is also how a user consents to one thing and gets
 * another, and no test of the mutation path can see it, because the operation
 * it receives is perfectly valid.
 *
 * So consent binds to the operations as they were offered, and the apply path
 * takes them from here. Anything the user added alongside their yes is a NEW
 * proposal, offered and agreed on its own terms.
 *
 * Refuses on any status other than `authorised`:
 *  · `open`        — not agreed yet
 *  · `stale`       — the model moved; the offer must be made again
 *  · `apply_in_flight` / `applied` — already sent; re-sending is the
 *                    double-apply this store exists to prevent
 *  · `withdrawn`   — retracted
 */
/**
 * ⭐ THE BOUND ON A COMPOUND COMMIT.
 *
 * WHY A COMPOUND COMMIT EXISTS AT ALL, and it is not convenience. The writer
 * keys idempotency on `(scenario_id, turn_id)`, so a SECOND write under one
 * turn id is swallowed — and swallowed looks exactly like saved. That is why
 * the controller refuses a second write per turn (`second_write_this_turn`),
 * and why a user who agrees to three changes in one breath is currently told
 * two of them did not happen. The only honest way to honour all three is ONE
 * write carrying all three, which is this.
 *
 * WHY IT IS BOUNDED. One write earns ONE receipt. If it fails, the user must
 * be told exactly what did not happen, and that sentence has to be readable —
 * an unbounded batch produces a failure notice nobody can act on, and a
 * consent nobody can hold in their head at the moment they give it.
 *
 * The bound is on OPERATIONS, not on proposals, because operations are what
 * the writer receives and what the receipt has to account for. Twelve is
 * deliberately not one-per-proposal: a single proposal may legitimately carry
 * several operations, so bounding proposals would bound the wrong thing and
 * would drift the moment a propose tool changed its arity.
 */
export const MAX_COMPOUND_OPERATIONS = 12;

/**
 * Gather several authorised proposals into ONE write.
 *
 * ⛔ EVERY member must be `authorised` and must share ONE model revision.
 * Consent binds to a specific state of the model, so proposals agreed against
 * different revisions are not a batch — they are two conversations, and
 * concatenating them would apply one of them against a state its user never
 * saw. Refused rather than reconciled here.
 *
 * Order is the caller's order, preserved: the operations are opaque to this
 * module and a later one may depend on an earlier one.
 */
export function operationsToApplyBatch(
  store: ProposalStore,
  ids: readonly string[],
): { readonly operations: readonly ProposalOperation[]; readonly model_revision: string } {
  assertState(ids.length > 0, 'a compound commit needs at least one proposal');
  assertState(
    new Set(ids).size === ids.length,
    'the same proposal appears twice in one compound commit — it would be applied twice',
  );

  const members = ids.map((id) => {
    const p = find(store, id);
    assertState(
      p.status === 'authorised',
      `only an authorised proposal can be applied, and "${id}" is "${p.status}"`,
    );
    return p;
  });

  const revision = members[0]!.model_revision;
  for (const p of members) {
    assertState(
      p.model_revision === revision,
      `"${p.id}" was agreed against a different model revision — proposals agreed against different states of the model cannot share one write`,
    );
  }

  const operations = members.flatMap((p) => [...p.operations]);
  assertState(
    operations.length <= MAX_COMPOUND_OPERATIONS,
    `a compound commit carries at most ${MAX_COMPOUND_OPERATIONS} operations and this one has ${operations.length} — offer the rest on the next turn rather than sending a write whose failure could not be explained`,
  );

  return { operations, model_revision: revision };
}

export function operationsToApply(
  store: ProposalStore,
  id: string,
): { readonly operations: readonly ProposalOperation[]; readonly model_revision: string } {
  const p = find(store, id);
  assertState(
    p.status === 'authorised',
    `only an authorised proposal can be applied, and this one is "${p.status}"`,
  );
  return { operations: p.operations, model_revision: p.model_revision };
}
