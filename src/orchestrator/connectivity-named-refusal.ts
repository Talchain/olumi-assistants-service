/**
 * POC-BOARD #5c — connectivity/orphan NAMED refusal (conservative, deterministic).
 *
 * Pure helper. NO LLM, NO I/O, NO schema/validator changes.
 *
 * The secondary compound-edit defect (live-confirmed 2026-07-17, Step-0 s1-05):
 * an edit batch that touches graph structure and whose FINAL post-batch state
 * genuinely fails connectivity (a newly-added / newly-orphaned item has no path
 * through to the goal) is rejected WHOLESALE with a GENERIC message that names
 * nothing — so a batch that is mostly legitimate (e.g. rename + remove-link +
 * one orphaning add) dead-ends with no clue as to WHICH item broke it.
 *
 * Within-turn atomicity is DOCTRINE and is preserved here — this helper NEVER
 * partially applies anything. The whole edit is still declined; the only change
 * is that the refusal is HONEST and BOUNDED: it names the specific offending
 * item(s) so the user can connect exactly that item and re-request the whole
 * edit. Validation itself remains a check of the FINAL post-batch graph (the
 * caller validates `applyPatchOperations(base, allOps)`, not intermediate
 * states), so a batch whose end state IS connected already passes untouched.
 *
 * Conservative by design: returns `null` (→ caller keeps its existing generic /
 * Cap-2A copy) unless EVERY new violation is connectivity-class and at least one
 * offending item resolves to a real, labelled node. It can never broaden a
 * non-connectivity rejection, and it never invents a rule or a concept name.
 *
 * Copy discipline (claim-safe): the prose is grounded ONLY in graph reachability
 * ("isn't connected to your goal / has no path through to your goal"), offers a
 * factor as an EXAMPLE host, and carries NO held-science vocabulary
 * (sensitivity / fragile / driver / robustness / influence / causal / EVPI / …),
 * NO internal identifiers, and NO forbidden user-facing phrases. The only
 * dynamic content is the user-authored NODE LABEL(S) (quoted verbatim).
 */

import type { GraphV3T } from "../schemas/cee-v3.js";
import type {
  StructuralViolation,
  StructuralViolationCode,
} from "./graph-structure-validator.js";

/**
 * Connectivity-class violation codes: an offending node either has no
 * connections at all (ORPHAN_NODE) or is edged but cannot reach the goal via
 * forward directed edges (NO_PATH_TO_GOAL). Both carry a per-node
 * `Node "<id>" (<label>) …` detail that names the specific offender.
 */
const CONNECTIVITY_CODES: ReadonlySet<StructuralViolationCode> = new Set<StructuralViolationCode>([
  'ORPHAN_NODE',
  'NO_PATH_TO_GOAL',
]);

/**
 * Per-node violation detail shape: `Node "<id>" (<label>) …`. Capital-`N`
 * `Node` deliberately does NOT match the lower-case `Goal node "<id>"`
 * goal-level reachability variant, so a goal-not-reachable violation never
 * extracts a goal id here (same convention as add-risk-rejection-guidance.ts).
 */
const NODE_ID_IN_DETAIL = /Node "([^"]+)"/;

/**
 * Build an honest, bounded, NODE-NAMING refusal for a connectivity/orphan
 * structural rejection, or `null` to defer to the caller's existing copy.
 *
 * @param candidateGraph the FINAL post-batch graph (the one that was validated)
 * @param newViolations  the NEW structural violations (baseline-filtered by the caller)
 */
export function buildConnectivityNamedRefusal(
  candidateGraph: GraphV3T,
  newViolations: readonly StructuralViolation[],
): string | null {
  // Gate 1 — only connectivity-class failures, and EVERY new violation must be
  // connectivity-class. A mixed/compound failure (limits, cycles, missing kinds,
  // option-factor, …) is a different problem → defer to the generic copy.
  if (newViolations.length === 0) return null;
  if (!newViolations.every((v) => CONNECTIVITY_CODES.has(v.code))) return null;

  // Read the offending node ids from the per-node details (machine token, no
  // quotes), then resolve each to its user-facing LABEL from the candidate
  // graph — mapping id→label avoids parsing a possibly-parenthesised label out
  // of the detail string. Goal-level "Goal node …" details do not match and so
  // never contribute an id (fail-safe to the generic copy for that shape).
  const ids = new Set<string>();
  for (const v of newViolations) {
    const m = NODE_ID_IN_DETAIL.exec(v.detail);
    if (m && m[1]) ids.add(m[1]);
  }
  if (ids.size === 0) return null;

  const labels: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const node = candidateGraph.nodes.find((n) => n.id === id);
    const label = typeof node?.label === 'string' ? node.label.trim() : '';
    if (label.length === 0) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  if (labels.length === 0) return null;

  return renderConnectivityNamedRefusal(labels);
}

/**
 * Render the claim-safe refusal prose for one or more offending labels.
 * Exported so tests assert the exact wire copy without re-deriving it (single
 * source of truth — no hand-maintained mirror to drift).
 */
export function renderConnectivityNamedRefusal(labels: readonly string[]): string {
  const quoted = labels.map((l) => `"${l}"`);

  if (quoted.length === 1) {
    return (
      `I couldn't make that change in one edit, because ${quoted[0]} isn't connected to your goal `
      + `yet. On its own it has no path through to your goal, so I've left everything as it was. `
      + `To go ahead, connect ${quoted[0]} to a factor that already feeds your goal. `
      + `Which factor should it relate to?`
    );
  }

  const list = quoted.length === 2
    ? `${quoted[0]} and ${quoted[1]}`
    : `${quoted.slice(0, -1).join(', ')}, and ${quoted[quoted.length - 1]}`;

  return (
    `I couldn't make that change in one edit, because ${list} aren't connected to your goal `
    + `yet. On their own they have no path through to your goal, so I've left everything as it was. `
    + `To go ahead, connect each one to a factor that already feeds your goal.`
  );
}
