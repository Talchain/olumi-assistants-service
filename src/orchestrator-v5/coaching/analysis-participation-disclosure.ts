/**
 * THE RUN-LEVEL PARTICIPATION DISCLOSURE — the analyse turn tells the user that
 * the numbers they are reading describe a SMALLER MODEL than the one on screen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES.
 *
 * #1588 taught `run_analysis` to honour `node.analysis_participation ===
 * 'retained_excluded'`: such a node is withheld from the graph CEE hands PLoT,
 * AND SO IS EVERY EDGE INCIDENT TO IT — not for tidiness, but because PLoT's
 * `/v2/run` preflight raises `INVALID_EDGE_ENDPOINT` through `createBlocker`
 * for a dangling endpoint, so leaving the edges would REFUSE THE WHOLE RUN.
 * The guard says exactly what it withheld, in `excludedNodeIds` and
 * `prunedEdgeCount`.
 *
 * `run-analysis.ts` read `participation.graph` AND NOTHING ELSE. Both counts
 * went to telemetry and nowhere a user could reach.
 *
 * ⛔ AND THE SHARP HARM IS THE EDGES, NOT THE NODES. The UI already ships a
 * NODE-level mark ("Unfinished — not included in analysis."), so the user knows
 * that ONE node was left out. Nothing told them the RUN excluded anything, and
 * nothing told them EDGES went with it. A user who marks one factor unfinished
 * can lose several connections they never marked — and every number in the
 * result is then internally consistent with a graph they are not looking at,
 * SO THEY CANNOT DETECT IT BY READING CAREFULLY. A disclosure is the only
 * instrument that reaches this; no amount of care with the numbers does.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY EACH CLAUSE IS THE WEAKEST TRUE ONE.
 *
 *   1. "This analysis ran on a reduced model" — the whole claim, and it is a
 *      claim about the CALCULATION INPUT, which is the one thing this seam
 *      knows for certain: the guard returned a pruned clone and the handler
 *      sent it. It says nothing about whether the result would have differed,
 *      because nothing here can know that.
 *
 *   2. "N part(s) of your model are kept out of the calculation" — the user's
 *      own act, in the house voice this handler already uses on the refusal
 *      path ("You've kept '…' out of the calculation"). Present tense, because
 *      the field still reads `'retained_excluded'` when they come back.
 *
 *   3. "which also leaves out M connection(s) to it/them" — ⭐ THE CLAUSE THE
 *      WHOLE MODULE EXISTS FOR, and its grammar is load-bearing. The user
 *      marked a NODE; the edges are a CONSEQUENCE of that exclusion, not a
 *      second thing they did. "which also leaves out" attributes the edges to
 *      the exclusion; it deliberately does NOT say "you removed", which would
 *      be false and would send them looking for an act they never performed.
 *
 * ⛔ ZERO EXCLUSIONS EMIT NOTHING — NOT "0 nodes were excluded". An absent
 * disclosure and a disclosure of absence are different claims, and the second
 * is noise on every ordinary run. Same rule the sibling
 * `unset-option-effect-disclosure.ts` states as NO-DEFAULTS-⇒-NOT-ONE-BYTE.
 * Zero PRUNED EDGES likewise drops the edge clause entirely rather than saying
 * "0 connections".
 *
 * ⛔ NO LABEL, NO ID, NO MAGNITUDE. Two counts and nothing else. The excluded
 * node's VALUE is precisely what the user kept and did not want computed; the
 * UI already names the node. Quoting a label here would add an egress budget, a
 * sanitiser and a whole failure mode for information the surface beside it
 * already carries.
 *
 * ⚠ IT MAY NOT TRIP THE LEADER OR STABILITY VOCABULARIES. This suffix ships on
 * withheld turns too (it makes no comparative claim, so it is honest there —
 * see the registry entry in `analysis-result-headline.ts`), so copy reaching
 * for "leads"/"ahead" would be replaced wholesale by
 * `leading-option-egress-guard.ts`, and copy reaching for "stable"/"robust"
 * would be SUPPRESSED by `compose/defaulted-value-egress.ts`. Pinned in this
 * module's test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE PIECES OF PLUMBING ANY run_analysis SUFFIX NEEDS (stated again
 * here because a disclosure missing any one of them is INERT in production — it
 * composes correctly, fails the registry-side egress allowlist, and the user
 * silently receives the locked template instead):
 *
 *   - {@link ANALYSIS_PARTICIPATION_DISCLOSURE_RE_SRC} — the grammar the
 *     allowlist admits, built by escaping THE VERY CONSTANTS the builder emits;
 *   - {@link ANALYSIS_PARTICIPATION_DISCLOSURE_MAX_CHARS} — the length budget,
 *     DERIVED from the builder's own worst case, never hand-estimated;
 *   - {@link PARTICIPATION_DISCLOSURE_SURVIVES_EGRESS} — the build-time probe.
 */

import { passesAssistantTextContentDefences } from './assistant-text-defences.js';
import type { AnalysisParticipationGuardResult } from '../tools/handlers/run-analysis-participation-guard.js';

/**
 * ⭐ THE SOURCING CONTRACT, EXPRESSED AS A TYPE.
 *
 * Both numbers come from the guard's OWN RETURN VALUE and are never re-derived
 * from graph shape — not here, and not at the UI. The exclusion decision is
 * CEE's; two derivations of one fact drift, and the drift is invisible because
 * both look plausible (trap 21 — one fact, two authorities). The type-level
 * bolt below makes that binding structural rather than a comment: if the guard
 * renames or re-types either field, this module stops compiling.
 */
export interface AnalysisParticipationCounts {
  /** Node ids the guard actually withheld. The COUNT is what ships. */
  readonly excludedNodeIds: readonly string[];
  /** Edges the guard removed because an endpoint left the graph. */
  readonly prunedEdgeCount: number;
}

/**
 * Compile-time bolt: the guard's result IS a valid source for this builder.
 * Type-only, so it adds no runtime import and cannot create a cycle.
 */
type _GuardResultIsASource = AnalysisParticipationGuardResult<unknown> extends
  AnalysisParticipationCounts
  ? true
  : never;
/** Referenced so the alias cannot be dropped as unused. */
export const PARTICIPATION_COUNTS_SOURCED_FROM_GUARD: _GuardResultIsASource = true;

// ── THE COPY ────────────────────────────────────────────────────────────────
// Every constant below is consumed BOTH by the builder and by the grammar, so a
// copy edit that breaks the allowlist breaks this module's own build-time probe
// loudly instead of reverting the user-facing summary to the locked template.

const LEAD = ' This analysis ran on a reduced model: ';
const NODE_SINGULAR = '1 part of your model is kept out of the calculation';
const NODE_PLURAL_SUFFIX = ' parts of your model are kept out of the calculation';
const EDGE_LEAD = ', which also leaves out ';
const EDGE_SINGULAR_SUBJECT = '1 connection to ';
const EDGE_PLURAL_SUBJECT = ' connections to ';
const PRONOUN_ONE = 'it';
const PRONOUN_MANY = 'them';
const FULL_STOP = '.';

/**
 * Largest count this module will SPELL. Not a cap on what the guard may report:
 * it is the digit budget the grammar admits and the worst case the length
 * budget is derived from. A graph cannot carry more nodes than this in any
 * persisted scenario, and the grammar admitting more digits than the builder can
 * emit would be the mirror of the hand-maintained mirror this file avoids.
 */
const COUNT_MAX_DIGITS = 6;

function composeDisclosure(excludedNodeCount: number, prunedEdgeCount: number): string {
  const pronoun = excludedNodeCount === 1 ? PRONOUN_ONE : PRONOUN_MANY;
  const nodeClause =
    excludedNodeCount === 1
      ? NODE_SINGULAR
      : `${excludedNodeCount}${NODE_PLURAL_SUFFIX}`;
  const edgeClause =
    prunedEdgeCount <= 0
      ? ''
      : prunedEdgeCount === 1
        ? `${EDGE_LEAD}${EDGE_SINGULAR_SUBJECT}${pronoun}`
        : `${EDGE_LEAD}${prunedEdgeCount}${EDGE_PLURAL_SUBJECT}${pronoun}`;
  return `${LEAD}${nodeClause}${edgeClause}${FULL_STOP}`;
}

/** A count safe to spell: a non-negative integer within the digit budget. */
function readCount(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const n = Math.floor(raw);
  if (n <= 0) return 0;
  return n > 10 ** COUNT_MAX_DIGITS - 1 ? 10 ** COUNT_MAX_DIGITS - 1 : n;
}

/**
 * ⭐ THE builder. Returns `''` when the guard withheld nothing — the run that
 * excluded nothing must not be told it did.
 *
 * ⚠ THE NODE COUNT GATES THE WHOLE SENTENCE, AND THE EDGE COUNT NEVER DOES.
 * `prunedEdgeCount > 0` with `excludedNodeIds: []` is not a state the guard can
 * produce (edges are pruned only BY a dropped node), and if it ever became one
 * it would mean something this module cannot describe. Gating on the nodes is
 * the direction that fails silent rather than emitting a sentence about a
 * consequence with no cause.
 */
export function buildAnalysisParticipationDisclosure(
  participation: AnalysisParticipationCounts,
): string {
  const excludedNodeCount = readCount(participation.excludedNodeIds.length);
  if (excludedNodeCount === 0) return '';
  const prunedEdgeCount = readCount(participation.prunedEdgeCount);

  const composed = composeDisclosure(excludedNodeCount, prunedEdgeCount);
  // The copy carries no user text at all, so this can only fail on a copy edit
  // — which is what the build-time probe below catches at import. Belt and
  // braces: a suffix the egress would reject costs the user the WHOLE summary,
  // so returning '' is strictly better than shipping an unrenderable one.
  return survivesEgress(composed) ? composed : '';
}

/**
 * True when a composed suffix would SURVIVE the registry-side egress:
 * single-line, matches this module's own published grammar exactly, and passes
 * the shared content defences. Compiled from
 * {@link ANALYSIS_PARTICIPATION_DISCLOSURE_RE_SRC} — the SAME source the
 * allowlist compiles — so builder/grammar drift fails loudly here instead of
 * silently downgrading every disclosure-bearing summary at the wire.
 */
function survivesEgress(suffix: string): boolean {
  if (suffix.includes('\n') || suffix.includes('\r')) return false;
  if (!SUFFIX_EXACT_REGEX().test(suffix)) return false;
  return passesAssistantTextContentDefences(suffix);
}

let suffixExactRegex: RegExp | null = null;
function SUFFIX_EXACT_REGEX(): RegExp {
  suffixExactRegex ??= new RegExp(`^(?:${ANALYSIS_PARTICIPATION_DISCLOSURE_RE_SRC})$`);
  return suffixExactRegex;
}

/** Local regex-literal escape (kept local to avoid an import cycle). */
function escapeForRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COUNT_SLOT = `\\d{1,${COUNT_MAX_DIGITS}}`;
const PRONOUN_SLOT = `(?:${escapeForRegex(PRONOUN_ONE)}|${escapeForRegex(PRONOUN_MANY)})`;

/**
 * Grammar source for the disclosure suffix, consumed by the registry-side
 * egress allowlist (`isAllowedRunAnalysisAssistantText`) and by this module's
 * own survival probe. Mirrors the shapes the builder can emit: singular or
 * plural node clause, each with an optional singular or plural edge clause.
 * Every fixed sentence is escaped from the very constants the builder emits,
 * and the count slot interpolates {@link COUNT_MAX_DIGITS} rather than
 * hand-mirroring a `{1,N}`.
 *
 * IT CANNOT MATCH THE EMPTY STRING — every branch requires the lead-in — which
 * the anchored template branch of the allowlist depends on.
 */
export const ANALYSIS_PARTICIPATION_DISCLOSURE_RE_SRC =
  '(?:' +
  escapeForRegex(LEAD) +
  '(?:' +
  escapeForRegex(NODE_SINGULAR) +
  '|' +
  `${COUNT_SLOT}${escapeForRegex(NODE_PLURAL_SUFFIX)}` +
  ')' +
  '(?:' +
  escapeForRegex(EDGE_LEAD) +
  '(?:' +
  `${escapeForRegex(EDGE_SINGULAR_SUBJECT)}${PRONOUN_SLOT}` +
  '|' +
  `${COUNT_SLOT}${escapeForRegex(EDGE_PLURAL_SUBJECT)}${PRONOUN_SLOT}` +
  ')' +
  ')?' +
  escapeForRegex(FULL_STOP) +
  ')';

/**
 * Egress budget the allowlist length cap is extended by — computed from the
 * builder's own worst-case output (never hand-estimated), so an honest
 * disclosure cannot silently knock the summary back to the locked template on
 * length.
 *
 * Worst case: the plural node clause and the plural edge clause, both counts at
 * the digit budget.
 */
export const ANALYSIS_PARTICIPATION_DISCLOSURE_MAX_CHARS = composeDisclosure(
  10 ** COUNT_MAX_DIGITS - 1,
  10 ** COUNT_MAX_DIGITS - 1,
).length;

/**
 * BUILD-TIME PROBE — this module's copy must survive its own egress.
 *
 * Evaluated at module load, so a copy edit that breaks the grammar or the
 * budget throws at import rather than degrading the wire. Without it the only
 * symptom of a broken disclosure is a telemetry rate nobody had a reason to
 * look at. Same construction as the sibling `unset-option-effect-disclosure.ts`.
 *
 * The leader- and stability-vocabulary halves are checked in this module's test
 * rather than here, to avoid import cycles through the compose/ surfaces that
 * import this coaching layer.
 */
export const PARTICIPATION_DISCLOSURE_SURVIVES_EGRESS: true = (() => {
  const shapes: readonly string[] = [
    composeDisclosure(1, 0),
    composeDisclosure(1, 1),
    composeDisclosure(1, 7),
    composeDisclosure(2, 0),
    composeDisclosure(2, 1),
    composeDisclosure(2, 3),
    composeDisclosure(10 ** COUNT_MAX_DIGITS - 1, 10 ** COUNT_MAX_DIGITS - 1),
  ];
  for (const shape of shapes) {
    if (!survivesEgress(shape)) {
      throw new Error(
        `[analysis-participation-disclosure] composed suffix does not survive its own ` +
          `egress grammar — the user would silently receive the locked template: ${shape}`,
      );
    }
    if (shape.length > ANALYSIS_PARTICIPATION_DISCLOSURE_MAX_CHARS) {
      throw new Error(
        `[analysis-participation-disclosure] composed suffix exceeds its own derived ` +
          `budget (${shape.length} > ${ANALYSIS_PARTICIPATION_DISCLOSURE_MAX_CHARS})`,
      );
    }
  }
  return true as const;
})();
