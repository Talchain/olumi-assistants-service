/**
 * DETERMINISTIC OPENAI REQUEST ASSEMBLY.
 *
 * One pure module that decides what goes into a provider request, so the answer
 * is the same every time and can be asserted in a test rather than hoped for in
 * a prompt. It performs NO I/O: callers pass the prompt snapshot, the context
 * packet and the history, and get back a split request plus diagnostics.
 *
 * ⭐ WHY IT EXISTS, MEASURED. The same turn, driven two ways:
 *   with a redundant `get_canonical_state` call : 18.58s · 7 provider calls · $0.0231
 *   with fresh server-supplied state, tool omitted: 12.32s · 4 provider calls · $0.0132
 * ~34% faster, ~43% cheaper. The saving is simply not offering a tool whose
 * answer the server already has. That rule has to be deterministic, because a
 * tool that is offered WILL eventually be called.
 *
 * ⛔ THE INVARIANT THAT OUTRANKS THE SAVING: CONTEXT IS DATA, NEVER AUTHORITY.
 * A context packet is assembled from prior state. It can be stale, replayed,
 * hand-crafted or simply wrong. So every decision in this file can only ever
 * REMOVE a tool from what the mode already allows — never add one. `toolsFor()`
 * remains the sole authority on what a mode may do; this module is a filter
 * underneath it, and `eligibleTools` is pinned by a test asserting its output is
 * always a SUBSET of `toolsFor(mode)`.
 *
 * That is also why `claimedGrants` exists and is deliberately ignored: a packet
 * may assert anything about what the user approved, and asserting it must
 * change nothing. Approval authority lives in the durable proposal machinery,
 * not in a blob that travelled with a request.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { AGENT_TOOLS, toolsFor, type AgentLaneMode, type ToolDefinition } from './agent-tools.js';

/**
 * The authenticated canonical context packet.
 *
 * "Authenticated" means it names the scenario AND the user it was built for, so
 * a packet cannot be lifted from one subject and replayed against another. Both
 * are checked; a mismatch is `invalidated`, not merely `stale`, because it is a
 * different subject rather than an older view of the same one.
 */
export interface CanonicalContextPacket {
  readonly scenario_id: string;
  readonly authenticated_user_id: string;
  /** The graph revision this state describes. Moves => the view is behind. */
  readonly graph_revision: string;
  /** The turn this was captured on. Older than the current turn => behind. */
  readonly captured_at_turn: number;
  /** The projected canonical state itself. Opaque here, hashed for diagnostics. */
  readonly state: unknown;
  /**
   * HMAC over the subject AND the state, keyed on a server secret.
   *
   * ⛔ THIS IS WHAT "AUTHENTICATED" MEANS. Without it a packet merely ASSERTS
   * its scenario, user and revision, and comparing those assertions to what the
   * server expects catches an honest mistake but never a fabrication — a
   * fabricator simply writes the values the server expects. The binding is how
   * the server recognises its OWN packet.
   */
  readonly binding: string;
}

/** What the server believes is true right now, to judge the packet against. */
export interface ContextExpectation {
  readonly scenario_id: string;
  readonly authenticated_user_id: string;
  readonly graph_revision: string;
  readonly current_turn: number;
  /** Required. A packet that cannot be verified is not evidence of anything. */
  readonly binding_secret: string;
}

export type ContextFreshness =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'stale'; readonly reason: 'revision_moved' | 'captured_earlier' }
  | {
      readonly kind: 'invalidated';
      readonly reason: 'binding_invalid' | 'scenario_mismatch' | 'user_mismatch' | 'malformed';
    };

/**
 * An immutable, versioned prompt snapshot.
 *
 * Immutable is the operative word: a snapshot is identified by (id, version)
 * and its text never changes under that pair. Editing a prompt produces a NEW
 * version, which produces a new prefix hash, which is what stops a cache from
 * serving text the current version no longer says.
 */
export interface PromptSnapshot {
  readonly id: string;
  /** `null` when the PMS could not name a version (a fallback). Never cacheable. */
  readonly version: number | null;
  readonly text: string;
  /** True when this text came from the PMS rather than a hardcoded fallback. */
  readonly governed?: boolean;
  /** False whenever there is no immutable (id, version) key to cache it under. */
  readonly cacheable?: boolean;
}

/** What `IPromptReader.getActivePrompt` returns. Accepted verbatim. */
export interface ActivePromptResult {
  readonly content: string;
  readonly source: 'database' | 'cache' | 'fallback';
  readonly promptId?: string;
  readonly version?: number;
  readonly contentHash: string;
}

/**
 * Build an immutable snapshot from the PMS reader's result.
 *
 * ⛔ THE FALLBACK ARM IS WHY THIS IS NOT BOOKKEEPING. `getActivePrompt` falls
 * back to hardcoded text when the PMS is unreachable, and that text may carry
 * NO version. Caching it under a governed key would serve ungoverned text and
 * would look like a cache HIT rather than an outage. It is admitted — refusing
 * it would take the product down whenever the PMS blinked — but marked
 * `governed: false, cacheable: false`, and `assembleRequest` reports that.
 *
 * `source: 'cache'` is NOT a downgrade: the repository's cache holds text that
 * came from the PMS, so it is still governed. Cache is a transport.
 *
 * The integrity check is the immutability guarantee doing real work: if the
 * text does not hash to the `contentHash` it travelled with, the pair (id,
 * version) is no longer naming one text, and every prefix hash keyed on it
 * would be a lie. That throws rather than degrades.
 */
export function promptSnapshotFrom(result: ActivePromptResult): PromptSnapshot {
  const actual = createHash('sha256').update(result.content, 'utf8').digest('hex');
  if (result.contentHash !== actual) {
    throw new Error(
      `Prompt snapshot integrity failure: ${result.promptId ?? '<unknown>'}` +
        `@${result.version ?? '<unversioned>'} content does not match its contentHash.`,
    );
  }
  const governed = result.source !== 'fallback';
  const version = typeof result.version === 'number' ? result.version : null;
  return Object.freeze({
    id: result.promptId ?? '<unidentified>',
    version,
    text: result.content,
    governed,
    cacheable: governed && version !== null,
  });
}

/**
 * Canonical JSON: object keys sorted at every depth, so two structurally equal
 * values hash identically regardless of construction order. Without this the
 * hashes would be a property of how a caller happened to build an object, and
 * every cache diagnostic would be noise.
 */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = canonicalise(src[k]);
    return out;
  }
  return value;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalise(value))).digest('hex');
}

/** The exact fields the binding covers. Order is fixed by `canonicalise`. */
function bindingPayload(p: Omit<CanonicalContextPacket, 'binding'>): unknown {
  return {
    scenario_id: p.scenario_id,
    authenticated_user_id: p.authenticated_user_id,
    graph_revision: p.graph_revision,
    captured_at_turn: p.captured_at_turn,
    state: p.state,
  };
}

function computeBinding(p: Omit<CanonicalContextPacket, 'binding'>, secret: string): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify(canonicalise(bindingPayload(p))))
    .digest('hex');
}

/**
 * ⭐ THE SERVER SECRET, AND WHY IT IS NOT A CREDENTIAL.
 *
 * `ContextExpectation.binding_secret` had no source: the signer
 * ({@link issueContextPacket}) and the verifier were both here and both tested,
 * with no configuration key and no production caller. That read as "blocked on a
 * credential somebody has to issue", and it is not.
 *
 * A per-process random key satisfies the binding's stated purpose exactly —
 * "a packet is evidence the SERVER assembled this state, not a claim anyone can
 * make" — because:
 *   · the packet NEVER leaves the process. Every reference to
 *     `CanonicalContextPacket` outside the tests is this module and `agent-loop`;
 *     nothing serialises it into a response and nothing parses it from a request.
 *   · a packet has no life beyond its own turn anyway. `assessContextFreshness`
 *     compares `graph_revision` and `captured_at_turn` against what the server
 *     believes NOW, so one that outlived a restart would be `stale` regardless of
 *     which key signed it.
 *   · the failure mode is fail-safe. `agent-loop` states it: "a forged or stale
 *     one simply keeps the read tool." An unverifiable packet costs the saving,
 *     never authority — and `claimedGrants` is ignored by design.
 *
 * So the property required is "no code path can mint a verifying packet without
 * going through the signer", and a key this process alone holds gives that. A
 * configured, shared, restart-stable secret would only be needed if a packet had
 * to verify somewhere it was not signed, which the first point rules out. If that
 * ever changes — a packet handed to a client, or verified on another instance —
 * this must become configuration, and the packet would then need an expiry, since
 * the freshness check above would no longer bound its lifetime.
 *
 * ⚠ Deliberately NOT read from the environment. An operator-set value here would
 * be a credential to rotate and leak with no benefit over a random one, and a
 * MISSING env var would silently hand every request an empty-string secret —
 * which still verifies, against itself, while looking configured.
 */
let processBindingSecret: string | undefined;
export function contextBindingSecret(): string {
  processBindingSecret ??= randomBytes(32).toString('hex');
  return processBindingSecret;
}

/**
 * Mint a packet. Only a holder of the server secret can produce one that will
 * verify, which is the whole point: a packet is evidence the SERVER assembled
 * this state, not a claim anyone can make.
 */
export function issueContextPacket(
  fields: Omit<CanonicalContextPacket, 'binding'>,
  secret: string,
): CanonicalContextPacket {
  return Object.freeze({
    scenario_id: fields.scenario_id,
    authenticated_user_id: fields.authenticated_user_id,
    graph_revision: fields.graph_revision,
    captured_at_turn: fields.captured_at_turn,
    state: fields.state,
    binding: computeBinding(fields, secret),
  });
}

/** Constant-time compare, so a binding cannot be probed a byte at a time. */
function bindingVerifies(packet: CanonicalContextPacket, secret: string): boolean {
  if (typeof packet.binding !== 'string' || packet.binding.length !== 64) return false;
  const expected = computeBinding(packet, secret);
  const a = Buffer.from(packet.binding, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * Is this packet a usable description of the CURRENT subject and state?
 *
 * Order matters. Subject mismatches are checked FIRST and reported as
 * `invalidated`, because "this belongs to someone else" is a different fact
 * from "this is a bit behind" — conflating them would let a subject mismatch be
 * read as a refresh-and-continue.
 */
export function assessContextFreshness(
  packet: CanonicalContextPacket | undefined | null,
  expect: ContextExpectation,
): ContextFreshness {
  if (packet === undefined || packet === null) return { kind: 'absent' };
  if (
    typeof packet.scenario_id !== 'string' ||
    typeof packet.authenticated_user_id !== 'string' ||
    typeof packet.graph_revision !== 'string' ||
    typeof packet.captured_at_turn !== 'number'
  ) {
    return { kind: 'invalidated', reason: 'malformed' };
  }
  // ⛔ BINDING FIRST. If it does not verify, nothing the packet says is
  // trustworthy — including its scenario and user — so reporting "stale" or
  // "scenario mismatch" would dress an untrusted claim up as a diagnosis.
  if (!bindingVerifies(packet, expect.binding_secret)) {
    return { kind: 'invalidated', reason: 'binding_invalid' };
  }
  if (packet.scenario_id !== expect.scenario_id) return { kind: 'invalidated', reason: 'scenario_mismatch' };
  if (packet.authenticated_user_id !== expect.authenticated_user_id) {
    return { kind: 'invalidated', reason: 'user_mismatch' };
  }
  if (packet.graph_revision !== expect.graph_revision) return { kind: 'stale', reason: 'revision_moved' };
  if (packet.captured_at_turn < expect.current_turn) return { kind: 'stale', reason: 'captured_earlier' };
  return { kind: 'fresh' };
}

/** A tool that was withheld, and the reason, so the omission is never silent. */
export interface OmittedTool {
  readonly name: string;
  readonly reason: 'context_already_supplied';
}

export interface ToolEligibility {
  readonly tools: readonly ToolDefinition[];
  readonly omitted: readonly OmittedTool[];
  /** The verdict this call DERIVED. Returned so callers reuse it, never supply it. */
  readonly freshness: ContextFreshness;
}

/**
 * The tool whose whole job is to fetch what a fresh packet already contains.
 * This is the only tool eligibility removes, and it is restored the moment the
 * context is anything other than fresh.
 */
const CONTEXT_EQUIVALENT_TOOL = 'get_canonical_state';

/**
 * Does this state carry entities the Agent can actually ACT on?
 *
 * ⛔ WHY AN OMISSION NEEDS EVIDENCE, NOT JUST A VERIFIED BINDING. Verification
 * proves the packet is the server's own and current. It says nothing about
 * whether the state inside it is rich enough to stand in for the tool. Those are
 * two different questions, and one predicate answering both is how this estate
 * has been bitten before.
 *
 * Staging #1698 established ONE projection of a stored node into what the Agent
 * is shown, `projectEntity`, used by every tool that hands the Agent entities —
 * because, in its own words, "two field lists will always drift; one cannot".
 * `CanonicalContextPacket.state` is `unknown` and supplied by the caller, so it
 * is a second list by construction. This predicate is the join that keeps the
 * drift from mattering.
 *
 * ⚠ WHAT MAKES A THIN PACKET WORSE THAN A SLOW ONE: dropping
 * `get_canonical_state` removes the Agent's RECOVERY. With the tool present a
 * thin context is merely inefficient — the model fetches the carriers itself.
 * With it absent, a thin packet is terminal for the turn. So this fails SAFE:
 * anything it cannot positively recognise keeps the tool. The cost of a false
 * negative is one round trip; the cost of a false positive is an Agent reasoning
 * without the carriers #1698 restored, unable to ask for them.
 *
 * ⚠ DELIBERATELY NOT IMPORTING `projectEntity`. It lives in
 * `agent-capabilities.ts`, which this lane may not edit without a lease, and it
 * does not exist at this branch's base — #1698 merged after it. So the check is
 * STRUCTURAL: the four keys that projection emits UNCONDITIONALLY. It cannot
 * drift into asserting more than the projection guarantees, because the
 * conditional carriers (`unit`, `cap`, `scale_frame`, `provenance`, …) are
 * omitted-when-absent by design and requiring any of them would reject a
 * perfectly good sparse graph.
 *
 * `id` is the load-bearing one. Its own docblock in that projection: "⭐ THE ID.
 * Without it the only way to act on an entity was a fuzzy label match, which
 * collides and cannot address two entities that read alike."
 *
 * An EMPTY entity list satisfies this — `every` over nothing is true, and that is
 * the intended reading, not an accident. A packet with no entities is equivalent
 * to what the tool would return for a graph with no nodes, so there are no
 * carriers to lose.
 */
function carriesAddressableEntities(state: unknown): boolean {
  if (typeof state !== 'object' || state === null) return false;
  const entities = (state as { entities?: unknown }).entities;
  if (!Array.isArray(entities)) return false;
  return entities.every((e) => {
    if (typeof e !== 'object' || e === null) return false;
    const n = e as Record<string, unknown>;
    return (
      typeof n.id === 'string' &&
      n.id.length > 0 &&
      typeof n.label === 'string' &&
      typeof n.kind === 'string' &&
      // Present, not truthy: `projectEntity` emits `value: null` deliberately,
      // because absence reported as a zero would read to a model as a stated fact.
      'value' in n
    );
  });
}

export function eligibleTools(input: {
  readonly mode: AgentLaneMode;
  readonly context?: CanonicalContextPacket | null;
  readonly expectation: ContextExpectation;
  /**
   * Anything the packet ASSERTS it was granted. Accepted so that a caller can
   * pass a packet through verbatim, and then deliberately ignored — see the
   * file header. It exists to make the "ignored" explicit and testable rather
   * than implicit in the absence of code.
   */
  readonly claimedGrants?: readonly string[];
}): ToolEligibility {
  // ⛔ THE VERDICT IS DERIVED HERE TOO, NOT ONLY IN `assembleRequest`.
  //
  // This function used to take a `freshness` verdict. Assembly was fixed to
  // derive its own, which closed the reachable hole — but leaving a verdict
  // parameter on an EXPORTED function keeps the bypass one import away, and
  // "callers must verify first" in a doc comment is not a boundary, for the
  // same reason a prompt sentence is not one. There is now no function in this
  // module that will accept a verdict from a caller.
  const freshness = assessContextFreshness(input.context, input.expectation);

  // `toolsFor` is the authority. Starting from it is what makes the subset
  // property structural rather than something this function has to remember.
  const allowed = toolsFor(input.mode);
  if (freshness.kind !== 'fresh') return { tools: allowed, omitted: [], freshness };

  // ⛔ A VERIFIED PACKET IS NOT AUTOMATICALLY A SUFFICIENT ONE. The packet still
  // becomes authoritative context in `assembleRequest` — a thin packet is real
  // canonical state, just sparse. What is withheld here is only the OMISSION:
  // the tool stays on the list so the Agent can fetch the carriers itself.
  // Fails safe by construction; see `carriesAddressableEntities`.
  if (!carriesAddressableEntities(input.context?.state)) {
    return { tools: allowed, omitted: [], freshness };
  }

  const tools = allowed.filter((t) => t.name !== CONTEXT_EQUIVALENT_TOOL);
  const omitted: OmittedTool[] =
    tools.length === allowed.length
      ? []
      : [{ name: CONTEXT_EQUIVALENT_TOOL, reason: 'context_already_supplied' }];
  return { tools, omitted, freshness };
}

export interface AssembledRequest {
  /** Prompt + tools. Identical across turns while neither changes — cacheable. */
  readonly stablePrefix: {
    readonly instructions: string;
    readonly tools: readonly ToolDefinition[];
  };
  /** State + history. Different every turn by nature — never in the prefix. */
  readonly dynamic: {
    readonly context: CanonicalContextPacket | null;
    readonly history: readonly unknown[];
  };
  readonly hashes: {
    readonly prompt: string;
    readonly tools: string;
    readonly prefix: string;
    readonly context: string;
  };
  readonly diagnostics: {
    readonly prompt_id: string;
    readonly prompt_version: number | null;
    readonly prompt_governed: boolean;
    /** False => this prefix must not be cached, however stable it looks. */
    readonly prefix_cacheable: boolean;
    readonly context_freshness: ContextFreshness['kind'];
    readonly context_reason: string | null;
    /** True only when a verified, current packet was carried to the model. */
    readonly context_admitted: boolean;
    readonly tool_count: number;
    readonly omitted_tools: readonly string[];
  };
}

/**
 * Split a request into the part that can be cached and the part that cannot,
 * and report the hashes that make a cache hit verifiable rather than assumed.
 *
 * The prefix hash covers the prompt AND the tool set deliberately: serving a
 * cached prefix built with a different tool set would offer the model a
 * capability this turn did not grant, which is the same failure the subset
 * invariant exists to prevent — just arriving via the cache instead.
 */
export function assembleRequest(input: {
  readonly promptSnapshot: PromptSnapshot;
  readonly mode: AgentLaneMode;
  readonly context?: CanonicalContextPacket | null;
  /** What the server believes right now. Freshness is DERIVED against this. */
  readonly expectation: ContextExpectation;
  readonly history: readonly unknown[];
}): AssembledRequest {
  // ⛔ FRESHNESS IS DERIVED HERE, NEVER SUPPLIED.
  //
  // This function used to accept a `freshness` verdict as a parameter,
  // independently of the packet. Every piece around it was sound — the binding
  // verified, the subject checks were right, eligibility could only narrow —
  // and the bypass sat in the JOIN: a caller could pass `{kind: 'fresh'}` with
  // no packet, or a forged or stale one, and assembly would suppress the
  // canonical reread and hand that packet to the model. The verification lived
  // in a function assembly never called. Found by independent review, not by
  // this module's own tests.
  //
  // A doc comment telling callers to verify first would not close it, for the
  // same reason a prompt sentence is not a safety boundary.
  const { tools, omitted, freshness } = eligibleTools({
    mode: input.mode,
    context: input.context,
    expectation: input.expectation,
  });

  const promptHash = hash({ id: input.promptSnapshot.id, version: input.promptSnapshot.version, text: input.promptSnapshot.text });
  const toolsHash = hash(tools.map((t) => ({ name: t.name, parameters: t.parameters })));
  const prefixHash = hash({ prompt: promptHash, tools: toolsHash });
  // ⛔ ONLY A VERIFIED, CURRENT PACKET BECOMES AUTHORITATIVE CONTEXT. Anything
  // else is dropped outright rather than passed along unused: an unverified
  // packet in the model's context is attacker-controlled text sitting where
  // canonical state is supposed to be, whether or not a tool was omitted.
  const admitted = freshness.kind === 'fresh' ? (input.context ?? null) : null;
  // Hashed on what was ACTUALLY carried, so the diagnostic describes the
  // request that was sent rather than the one that was offered.
  const contextHash = hash(admitted);

  return {
    stablePrefix: { instructions: input.promptSnapshot.text, tools },
    dynamic: { context: admitted, history: input.history },
    hashes: { prompt: promptHash, tools: toolsHash, prefix: prefixHash, context: contextHash },
    diagnostics: {
      prompt_id: input.promptSnapshot.id,
      prompt_version: input.promptSnapshot.version,
      prompt_governed: input.promptSnapshot.governed !== false,
      // Defaults are chosen so an under-specified snapshot cannot silently
      // become cacheable: a snapshot with no version never is.
      prefix_cacheable:
        input.promptSnapshot.cacheable ??
        (input.promptSnapshot.governed !== false && input.promptSnapshot.version !== null),
      context_freshness: freshness.kind,
      context_reason: 'reason' in freshness ? freshness.reason : null,
      context_admitted: admitted !== null,
      tool_count: tools.length,
      omitted_tools: omitted.map((o) => o.name),
    },
  };
}

/** Exported for a test that pins the full catalogue size. */
export const TOTAL_TOOL_COUNT = AGENT_TOOLS.length;
