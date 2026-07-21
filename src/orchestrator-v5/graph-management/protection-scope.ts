/**
 * F-3 negation guard — protection-scope extraction + would_apply demotion.
 *
 * WHY THIS EXISTS (S-AUDIT-2026-07-20 probe-edit-lane.md, P8/P9 — F-3
 * ESCALATED): the edit LLM is negation-blind. On the live wire, both
 * adversarial phrasings
 *
 *   A5: "Set CRM Platform Cost to 0.5 - the configuration of Cloud-Native
 *        CRM shouldn't change."
 *   A6: "Configure nothing on Cloud-Native CRM; just set CRM Platform Cost
 *        to 0.52."
 *
 * produced an op TARGETING the option the user explicitly protected, which
 * the D-S tunable auto-apply then applied (DB-verified twice: intervention
 * 0.58→0.5→0.52) while the legitimate factor half was dropped. #581's
 * rationale ("the LLM reads the message for itself") is REFUTED on this
 * phrasing class; before #581 the defect was latent only because the lane
 * stalled. The containment must therefore be a deterministic MECHANISM at
 * the one seam every edit-lane op passes through post-LLM (the referee
 * gate), independent of LLM emission behaviour and prompt wording — per the
 * standing edit-target demotion ruling: option-configuration redirects go
 * propose_and_confirm, never auto-apply.
 *
 * THE RULE: when the user's message contains protection/negation context
 * NAMING an entity (do not / don't / leave / keep / except / but not /
 * nothing on / shouldn't change / … + an entity reference), any op the LLM
 * emits that TARGETS a protected entity must not auto-apply — its
 * would_apply verdict is demoted to held (USER_PROTECTED_ENTITY), which the
 * gate routes onto the existing propose-confirm surface with copy naming
 * the protected entity. Ops NOT targeting protected entities keep their
 * verdicts (per-op discrimination — the legitimate half is never dropped;
 * it either proceeds or rides the batch's one confirm tap).
 *
 * DETECTION IS DETERMINISTIC AND DELIBERATELY CONSERVATIVE (stated bias):
 * a false positive costs the user one confirm tap; a false negative costs a
 * silent wrong write to a thing the user explicitly protected. So the cue
 * vocabulary is broad (including bare "not"), clause scoping is coarse
 * (sentence enders, spaced dashes, "but"/"except" seams — NOT bare commas,
 * so list constructions like "leave A, B and C alone" stay in one
 * protective clause), and any graph entity whose label or id appears inside
 * a cue-bearing clause is protected. Detection MISSES degrade to today's
 * behaviour (no demotion), never worse.
 *
 * Import boundary (isolation-guards.test.ts): local files only — this
 * module consumes the parsed envelope and the raw graph, and never touches
 * hashing, persistence, or the turn executor. Total: every export catches
 * and degrades to "no protection" rather than throwing.
 */
import type { CandidateMutationEnvelope, RefereeVerdict } from './types.js';
import { USER_PROTECTED_ENTITY } from './reason-codes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProtectedEntity {
  readonly nodeId: string;
  readonly label: string;
}

export interface ProtectionDemotionResult {
  /** Verdicts with protected-target would_apply entries demoted to held. */
  readonly verdicts: readonly RefereeVerdict[];
  /** Indices (parallel to `verdicts`) that were demoted. */
  readonly demotedIndices: readonly number[];
  /**
   * Labels of the protected entities whose ops were demoted — deduped,
   * first-hit order. Feeds the gate's named hold copy ("you asked me not
   * to change X"). Labels are graph-sourced, NOT user text, and the gate
   * still render-safety-filters them before they reach prose.
   */
  readonly demotedEntityLabels: readonly string[];
}

const NO_DEMOTION = (verdicts: readonly RefereeVerdict[]): ProtectionDemotionResult => ({
  verdicts,
  demotedIndices: [],
  demotedEntityLabels: [],
});

// ---------------------------------------------------------------------------
// Protection-cue grammar (conservative by design — see module doc)
// ---------------------------------------------------------------------------

/**
 * Bound on scanned message length — hostile input stays O(bounded). Set to
 * the ingress message cap so a WELL-FORMED request is scanned IN FULL and no
 * protection clause is ever silently dropped for sitting past the bound. Both
 * ingress paths that reach this seam cap `message` at 10,000:
 *   - the V5 turn payload — `MessageTurnPayload.message`
 *     (@talchain/schemas boundary: `z.string().min(1).max(10000)`), and
 *   - the V1 edit route — `edit_description`
 *     (routes/assist.v1.edit-graph.ts: `z.string().min(1).max(10_000)`).
 *
 * The prior value (4_000) truncated the scan while ingress accepted 10,000, so
 * `"x".repeat(4001) + " do not touch Option B"` had its protection clause
 * sliced off and the op AUTO-APPLIED — the exact silent wrong write this
 * module exists to stop.
 *
 * FAIL-CLOSED on overflow (never silently drop): a message LONGER than this
 * cap — ingress drift, or a future looser path — has an UNSCANNABLE tail that
 * may name a protected entity we cannot see, so `messageExceedsScanCap`
 * reports it and `demoteProtectedEntityTargets` demotes EVERY would_apply
 * verdict to held (one confirm tap, never a silent wrong write to something
 * the tail protected). Derive-don't-mirror (trap-12): correctness does NOT
 * depend on this constant EQUALLING the ingress cap — any drift LARGER fails
 * closed rather than reading as green, so the equality is a convenience, not a
 * load-bearing hand-synced mirror.
 */
const MESSAGE_SCAN_CAP = 10_000;

/**
 * True when the message OVERFLOWS the scannable bound — its tail cannot be
 * read, so protection detection must FAIL CLOSED (see
 * `demoteProtectedEntityTargets`). Total: a non-string has nothing to scan and
 * is therefore not an overflow.
 */
function messageExceedsScanCap(userMessage: string | null | undefined): boolean {
  return typeof userMessage === 'string' && userMessage.length > MESSAGE_SCAN_CAP;
}

/**
 * A clause is PROTECTIVE when any of these cues appears in it. Broad on
 * purpose (bare "not" included): the blast radius of a false positive is
 * one confirm tap, and only for ops targeting an entity NAMED in the same
 * clause.
 */
const PROTECTION_CUE = new RegExp(
  [
    // negated auxiliaries / imperatives
    "do\\s+not",
    "don['’]?t",
    'does\\s+not',
    "doesn['’]?t",
    'must\\s+not',
    "mustn['’]?t",
    'should\\s+not',
    "shouldn['’]?t",
    'shall\\s+not',
    'will\\s+not',
    "won['’]?t",
    'cannot',
    "can['’]?t",
    'never',
    'not',
    'no\\s+changes?',
    'nothing',
    'none\\s+of',
    // preservation verbs / adjectives
    'leave',
    'keep',
    'preserve',
    'retain',
    'unchanged',
    'untouched',
    'intact',
    'as[-\\s]is',
    'alone',
    'stays?\\s+the\\s+same',
    // exclusion prepositions
    'except',
    'other\\s+than',
    'apart\\s+from',
    'aside\\s+from',
    'excluding',
    'without\\s+(?:changing|touching|affecting|modifying|altering|updating|configuring)',
    'hold\\s+off',
    'skip',
    'ignore',
  ]
    .map((s) => `\\b${s}\\b`)
    .join('|'),
  'i',
);

/**
 * Clause boundaries: sentence enders (require trailing whitespace/end so
 * decimals like "0.52" never split), spaced dashes (hyphen/en/em — the A5
 * phrasing), and adversative/exception seams. Bare commas are deliberately
 * NOT boundaries (list constructions must stay in one protective clause).
 */
const CLAUSE_BOUNDARY = /[.;!?]+(?=\s|$)|\n+|\s[-–—]+\s|,?\s+\bbut\b\s+|,?\s+\bexcept\b\s+/gi;

function splitIntoClauses(message: string): string[] {
  return message
    .slice(0, MESSAGE_SCAN_CAP)
    .split(CLAUSE_BOUNDARY)
    .map((c) => (typeof c === 'string' ? c.trim() : ''))
    .filter((c) => c.length > 0)
    // "but"/"except" are consumed by the split; re-prefix is unnecessary —
    // the FOLLOWING clause carries its own cue ("not touch X") or names the
    // exception, and "except" clauses are protective by construction, so
    // re-add the cue word to keep them so.
    .map((c) => c);
}

/** True when the clause carries a protection cue. The "except"/"but" seam
 *  consumed by the splitter is restored by scanning the ORIGINAL message —
 *  see extractProtectedEntities (clause offsets are not tracked; instead a
 *  clause immediately following an except-seam is found by re-testing with
 *  the cue regex, which "not touch X" style clauses satisfy on their own;
 *  bare "except X" is handled by treating the exception list itself as
 *  protective below). */
function clauseIsProtective(clause: string): boolean {
  return PROTECTION_CUE.test(clause);
}

/** "except X" / "other than X" tails: the splitter eats the seam word, so a
 *  clause that FOLLOWED an except-seam has no cue of its own. Rather than
 *  track offsets, the extractor ALSO scans the unsplit message for
 *  exception tails and treats everything after the seam (to the sentence
 *  end) as one protective clause. */
const EXCEPTION_TAIL = /\b(?:except(?:\s+for)?|other\s+than|apart\s+from|aside\s+from|excluding|but\s+not)\b([^.;!?\n]{0,200})/gi;

// ---------------------------------------------------------------------------
// Entity mention matching
// ---------------------------------------------------------------------------

/** Minimum label length considered matchable (shorter labels false-positive
 *  on ordinary prose far too often to be useful). */
const MIN_LABEL_LENGTH = 3;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-boundary-ish, whitespace-flexible, case-insensitive mention test. */
function mentionPattern(name: string): RegExp | null {
  const trimmed = name.trim();
  if (trimmed.length < MIN_LABEL_LENGTH) return null;
  const flexible = trimmed.split(/\s+/).map(escapeRegExp).join('\\s+');
  try {
    return new RegExp(`(?<![A-Za-z0-9])${flexible}(?![A-Za-z0-9])`, 'i');
  } catch {
    return null;
  }
}

interface GraphNodeLike {
  readonly id: string;
  readonly label: string;
}

/** Total read of the graph's node id/label pairs (hostile shapes → []). */
function readGraphNodes(graph: unknown): GraphNodeLike[] {
  try {
    if (graph === null || typeof graph !== 'object') return [];
    const nodes = (graph as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodes)) return [];
    const out: GraphNodeLike[] = [];
    for (const n of nodes) {
      if (n === null || typeof n !== 'object') continue;
      const id = (n as { id?: unknown }).id;
      const label = (n as { label?: unknown }).label;
      if (typeof id === 'string' && id.length > 0 && typeof label === 'string') {
        out.push({ id, label });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Extract the entities the user's message PROTECTS: every graph node whose
 * label (or id) is mentioned inside a protection-cue-bearing clause or an
 * exception tail. Deterministic, total, conservative (see module doc).
 */
export function extractProtectedEntities(
  userMessage: string | null | undefined,
  currentGraph: unknown,
): readonly ProtectedEntity[] {
  try {
    if (typeof userMessage !== 'string' || userMessage.trim().length === 0) return [];
    const nodes = readGraphNodes(currentGraph);
    if (nodes.length === 0) return [];

    const protectiveTexts: string[] = [];
    for (const clause of splitIntoClauses(userMessage)) {
      if (clauseIsProtective(clause)) protectiveTexts.push(clause);
    }
    const capped = userMessage.slice(0, MESSAGE_SCAN_CAP);
    EXCEPTION_TAIL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EXCEPTION_TAIL.exec(capped)) !== null) {
      const tail = (m[1] ?? '').trim();
      if (tail.length > 0) protectiveTexts.push(tail);
    }
    if (protectiveTexts.length === 0) return [];

    const out: ProtectedEntity[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      if (seen.has(node.id)) continue;
      const byLabel = mentionPattern(node.label);
      const byId = mentionPattern(node.id);
      const hit = protectiveTexts.some(
        (t) => (byLabel !== null && byLabel.test(t)) || (byId !== null && byId.test(t)),
      );
      if (hit) {
        seen.add(node.id);
        out.push({ nodeId: node.id, label: node.label });
      }
    }
    return out;
  } catch {
    return []; // TOTALITY: detection failure degrades to no protection.
  }
}

// ---------------------------------------------------------------------------
// Envelope targeting
// ---------------------------------------------------------------------------

/**
 * The EXISTING entity ids a candidate mutation TARGETS — EVERY entity whose
 * state or configuration it would change, DIRECT and INDIRECT. Exhaustive
 * over CandidateKind — a new kind is a COMPILE error here, never a silent
 * guard bypass (the hand-maintained-mirror trap): whoever adds a kind must
 * decide its protection semantics.
 *
 * INDIRECT TARGETS — the F-3 P1 bypass (adversarial review, 2026-07-20):
 * an option-configure write reaches a FACTOR through the OPTION's
 * interventions map, not through the factor's own id. On the live wire the
 * op is `update_node_field{ node_id: <option>, field:
 * "data/interventions/<factor>" | "interventions", to: … }` (the standard
 * option-configure shape — see candidate-graph.ts setTunableFieldPath field
 * spellings). If this returned only the direct `node_id`, a user who
 * protected the FACTOR ("… do not touch CRM Platform Cost") would have the
 * write AUTO-APPLY, because the factor never appears in the target set —
 * precisely the A5/A6 class the guard exists for (the probe's real writes
 * went through interventions maps). So `update_node_field` also yields every
 * factor id reachable via an interventions key. Derived from the op SHAPE,
 * not a hand-list of paths.
 *
 * The OTHER kinds carry no such gap ON THE AUTO-APPLY SURFACE (verified
 * against classify-mutation.ts + referee.ts): only the three TUNABLE kinds
 * (rename_node, update_node_field, update_edge_field) are would_apply-
 * eligible, and this function is only ever consulted for would_apply
 * verdicts (demoteProtectedEntityTargets skips the rest). rename_node
 * touches only its own node; update_edge_field already returns BOTH
 * endpoints; every structural kind (add_node/add_edge/add_option/
 * remove_node/remove_edge — the latter carrying interventions maps or
 * cascade neighbours) is HELD (propose-confirm) and never auto-applies, so
 * the demotion never inspects it. Should any structural kind ever become
 * would_apply-eligible, its indirect references (add_option interventions
 * keys, remove_node cascade neighbours) must be added here at that time.
 */
export function envelopeTargetNodeIds(env: CandidateMutationEnvelope): readonly string[] {
  switch (env.kind) {
    case 'add_node':
      return []; // creates a NEW entity; no existing target
    case 'add_edge':
      return [env.payload.edge.from, env.payload.edge.to];
    case 'update_node_field':
      // Direct node + every factor reached through its interventions map.
      return [
        env.payload.node_id,
        ...interventionTargetIds(env.payload.field, env.payload.to, env.payload.from),
      ];
    case 'update_edge_field':
      return [env.payload.from_node, env.payload.to_node];
    case 'rename_node':
      return [env.payload.node_id];
    case 'add_option': {
      const ids = env.payload.option.edges.map((e) => e.to_factor_id);
      return env.payload.option.parent_decision_id !== undefined
        ? [...ids, env.payload.option.parent_decision_id]
        : ids;
    }
    case 'remove_node':
      return [env.payload.node_id];
    case 'remove_edge':
      return [env.payload.from_node, env.payload.to_node];
    case 'flag_uncertainty':
    case 'clarification':
      return []; // never mutate
    default: {
      const _never: never = env;
      return _never;
    }
  }
}

/** Total object-record read (null/array/scalar → not a record). */
function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The factor ids an `update_node_field` write reaches INDIRECTLY through an
 * option's interventions map. Derived from the op shape, mirroring
 * setTunableFieldPath's `/`+`.` field segmentation (candidate-graph.ts), so
 * it covers every producer spelling of an option-configure write:
 *
 *  - slash/dot-keyed leaf — `field: "data/interventions/<factor>"` (the
 *    canonical live shape) or `"interventions/<factor>"` /
 *    `"interventions.<factor>"`: the factor is the segment AFTER
 *    `interventions`;
 *  - whole-map replacement — `field: "interventions"` /
 *    `"data/interventions"`, `to`/`from` a record whose KEYS are factor ids
 *    (both new and old, so an intervention REMOVAL that names the factor
 *    only in `from` is still caught);
 *  - nested value — `field: "data"`, `to: { interventions: { <factor>: … } }`
 *    (or a whole-node/root write): the interventions record sits inside the
 *    payload value; its keys are factor ids.
 *
 * Conservative by construction: any id this over-yields is inert — the
 * caller (demoteProtectedEntityTargets) intersects the result with the
 * graph's protected set, so a non-protected extra id demotes nothing. Total;
 * never throws.
 */
function interventionTargetIds(field: unknown, to: unknown, from: unknown): string[] {
  try {
    const out: string[] = [];
    if (typeof field === 'string') {
      const segments = field.split(/[/.]/).filter((s) => s.length > 0);
      const ivIdx = segments.indexOf('interventions');
      if (ivIdx !== -1) {
        const factorSeg = segments[ivIdx + 1];
        if (typeof factorSeg === 'string' && factorSeg.length > 0) {
          // Leaf write: …/interventions/<factor>[/subfield].
          out.push(factorSeg);
        } else {
          // Whole-map write: factor ids are the value-record keys (new + old).
          if (isPlainRecord(to)) out.push(...Object.keys(to));
          if (isPlainRecord(from)) out.push(...Object.keys(from));
        }
      }
    }
    // Nested/whole-node write: an interventions record inside the payload
    // value (e.g. field "data", to { interventions: { <factor>: … } }).
    collectNestedInterventionKeys(to, out);
    collectNestedInterventionKeys(from, out);
    return out.filter((s) => typeof s === 'string' && s.length > 0);
  } catch {
    return []; // TOTALITY: extraction failure degrades to direct-target only.
  }
}

/** Depth-bounded scan for an `interventions` record nested in a payload value
 *  (directly or under `data`); appends its keys to `out`. Bounded so hostile
 *  deeply-nested input stays O(bounded). */
function collectNestedInterventionKeys(value: unknown, out: string[], depth = 0): void {
  if (depth > 4 || !isPlainRecord(value)) return;
  const iv = value.interventions;
  if (isPlainRecord(iv)) out.push(...Object.keys(iv));
  if (isPlainRecord(value.data)) collectNestedInterventionKeys(value.data, out, depth + 1);
}

// ---------------------------------------------------------------------------
// The demotion
// ---------------------------------------------------------------------------

/** Fixed, REDACTED readable — never echoes user text or payload values. */
export const USER_PROTECTED_ENTITY_READABLE =
  'The request asked for this part of the model to stay as it is; held for explicit confirmation.';

/**
 * Demote every would_apply verdict whose envelope targets a protected
 * entity to held (USER_PROTECTED_ENTITY). All other verdicts pass through
 * untouched — structural holds, rejects, stales and the NON-protected
 * would_apply entries keep their exact objects (per-op discrimination).
 * Total; any failure returns the input verdicts unchanged.
 */
export function demoteProtectedEntityTargets(
  verdicts: readonly RefereeVerdict[],
  envelopes: readonly (CandidateMutationEnvelope | null)[],
  userMessage: string | null | undefined,
  currentGraph: unknown,
): ProtectionDemotionResult {
  try {
    // FAIL-CLOSED (never silently drop): when the message overflows the
    // scannable bound its tail is unreadable and MAY protect any op's target,
    // so every would_apply is demoted regardless of the (partial) protected
    // set extracted from the scanned prefix. See MESSAGE_SCAN_CAP.
    const overflow = messageExceedsScanCap(userMessage);
    const protectedEntities = extractProtectedEntities(userMessage, currentGraph);
    if (!overflow && protectedEntities.length === 0) return NO_DEMOTION(verdicts);
    const byId = new Map(protectedEntities.map((p) => [p.nodeId, p] as const));

    const out: RefereeVerdict[] = [];
    const demotedIndices: number[] = [];
    const demotedLabels: string[] = [];
    const seenLabels = new Set<string>();
    for (let i = 0; i < verdicts.length; i += 1) {
      const v = verdicts[i]!;
      const env = envelopes[i] ?? null;
      if (v.verdict !== 'would_apply' || env === null) {
        out.push(v);
        continue;
      }
      const hits = envelopeTargetNodeIds(env).filter((id) => byId.has(id));
      // On overflow, demote even ops with no scanned-prefix hit — the tail we
      // could not read may protect this target. Prefix hits still contribute
      // their names to the copy (the fail-closed default names nothing).
      if (!overflow && hits.length === 0) {
        out.push(v);
        continue;
      }
      demotedIndices.push(i);
      for (const id of hits) {
        const label = byId.get(id)!.label;
        if (!seenLabels.has(label)) {
          seenLabels.add(label);
          demotedLabels.push(label);
        }
      }
      out.push({
        ...v,
        verdict: 'held',
        blocker: { code: USER_PROTECTED_ENTITY, readable: USER_PROTECTED_ENTITY_READABLE },
      });
    }
    if (demotedIndices.length === 0) return NO_DEMOTION(verdicts);
    return { verdicts: out, demotedIndices, demotedEntityLabels: demotedLabels };
  } catch {
    return NO_DEMOTION(verdicts); // TOTALITY: never break the gate.
  }
}
