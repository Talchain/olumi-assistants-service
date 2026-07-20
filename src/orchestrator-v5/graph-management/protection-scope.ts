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

/** Bound on scanned message length — hostile input stays O(bounded). */
const MESSAGE_SCAN_CAP = 4_000;

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
 * The EXISTING node ids a candidate mutation TARGETS (i.e. whose state or
 * configuration it would change). Exhaustive over CandidateKind — a new
 * kind is a COMPILE error here, never a silent guard bypass (the
 * hand-maintained-mirror trap): whoever adds a kind must decide its
 * protection semantics.
 */
export function envelopeTargetNodeIds(env: CandidateMutationEnvelope): readonly string[] {
  switch (env.kind) {
    case 'add_node':
      return []; // creates a NEW entity; no existing target
    case 'add_edge':
      return [env.payload.edge.from, env.payload.edge.to];
    case 'update_node_field':
      return [env.payload.node_id];
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
    const protectedEntities = extractProtectedEntities(userMessage, currentGraph);
    if (protectedEntities.length === 0) return NO_DEMOTION(verdicts);
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
      if (hits.length === 0) {
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
