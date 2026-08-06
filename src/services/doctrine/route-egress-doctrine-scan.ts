/**
 * ROADMAP 2.725 — doctrine COVERAGE for the `assist.v1.*` route family.
 *
 * ## What this closes
 *
 * The V5 egress guard (`orchestrator-v5/compose/forbidden-user-facing-phrases.ts`,
 * ROADMAP 2.213) scans exactly one thing: `assistant_text` on the turn path. The
 * registered routes `/assist/v1/review`, `/assist/v1/isl-synthesis`,
 * `/assist/v1/elicit-risk-tolerance`, `/assist/v1/suggest-edge-function` and
 * `/assist/v1/narrate-conditions` never pass through it — and every producer-side
 * verdict string the 2026-08-06 audit found in CEE sat behind one of them.
 *
 * ## Why this module DETECTS but does not REMEDY — the reasoned half of the brief
 *
 * The brief asked for the 2.213 guard to be EXTENDED to this route family, and
 * invited a refusal-with-reason if extending it were unsafe. Extending its
 * DETECTION is safe and is done here. Importing its REMEDY is not, for three
 * measured reasons:
 *
 * 1. **The remedy would corrupt USER-AUTHORED content.** The turn-path guard's
 *    rewrite-first path (`applyTerminologyRewrite`) is calibrated for ONE free-text
 *    field that CEE itself authored. A review response is a schema-validated
 *    structured document whose string leaves include the user's own graph labels —
 *    `factor_enrichments[].factor_label` and the drivers block's `suggestions[].label`
 *    both come straight from node labels. A user whose option is literally named
 *    "Recommended Vendor" would have it rewritten to "Leading option Vendor". The
 *    doctrine's own limit is explicit: change language, never information. A blanket
 *    rewrite over string leaves changes the user's information.
 *
 * 2. **The whole-response fallback is meaningless here.** On a residual fatal hit the
 *    turn-path guard replaces the entire text with
 *    `EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT` ("Let me know what you'd like me to do
 *    next…"). Substituting that for a review document destroys `readiness`,
 *    `blocks`, `decision_quality` and `quality` — all measured information — to fix
 *    one sentence. The remedy is proportionate on a chat turn and destructive here.
 *
 * 3. **The full phrase list would fire on CORRECT copy.** `FORBIDDEN_USER_FACING_PHRASES`
 *    carries internal-jargon patterns (`\bvalidator\b`, `\borchestrator\b`,
 *    `\bgraph[\s_]hash\b`, `\b(?:node|edge)\s+op(?:eration)?s?\b`) that a
 *    graph-STRUCTURE review route legitimately needs. `readinessAssessor.ts` correctly
 *    emits "Add a goal node to define what you're trying to achieve." and "Review
 *    graph structure for disconnected or orphan nodes." Wiring the whole set here
 *    would fire on copy that is right.
 *
 * So the coverage extension is: the DOCTRINE subset only (the recommendation-noun
 * class + the six choice-directive frames, both imported from the 2.213 module so
 * there is exactly one definition), detection over EVERY string leaf, and a
 * structured warning at the route seam. The enforcement that actually stops a
 * regression shipping is the fail-loud spec that drives the real producers across
 * their branch matrix and asserts zero hits — see
 * `__tests__/route-egress-doctrine-scan.test.ts` and
 * `tests/unit/assist-v1-verdict-language-doctrine.test.ts`.
 *
 * Detection is DERIVED (a recursive walk over every string leaf), so it cannot go
 * blind as fields are added — the failure mode a hand-listed field allowlist would
 * have had (CLAUDE.md trap 12). What it deliberately does NOT claim: that a hit is
 * always a violation. A user-authored label containing "recommended" will be
 * reported. That is the correct trade for a non-mutating scanner — a false report
 * costs a log line, and the alternative (narrowing detection to a hand-listed set of
 * paths) buys precision by reintroducing the mirror.
 */

import {
  DOCTRINE_FATAL_PATTERNS,
  DOCTRINE_VERDICT_PATTERNS,
} from '../../orchestrator-v5/compose/forbidden-user-facing-phrases.js';

/**
 * The doctrine subset applied at route egress: the recommendation-NOUN class plus
 * the six choice-directive frames. Both are spread from the 2.213 module — adding a
 * pattern there covers this surface automatically, which is the whole point of
 * naming them (CLAUDE.md trap 12: derive, don't mirror).
 */
export const ROUTE_EGRESS_DOCTRINE_PATTERNS: readonly RegExp[] = [
  ...DOCTRINE_VERDICT_PATTERNS,
  ...DOCTRINE_FATAL_PATTERNS,
];

export interface DoctrineScanHit {
  /** Dotted path to the offending string leaf, e.g. `rationale.summary`. */
  readonly path: string;
  /** The matched substring, verbatim — generic banned vocabulary, safe to log. */
  readonly term: string;
}

/** Guard against pathological payloads; the review response is nowhere near this. */
const MAX_SCAN_NODES = 20_000;

/**
 * Walk every string leaf of `payload` and return each doctrine hit with its path.
 *
 * Pure and non-mutating by construction — it takes `unknown` and returns hits, so
 * there is no code path on which it can alter a response. Arrays are indexed
 * (`improvement_guidance.0.reason`) so a hit names the exact leaf.
 */
export function scanPayloadForDoctrineHits(payload: unknown): DoctrineScanHit[] {
  const hits: DoctrineScanHit[] = [];
  let visited = 0;
  const seen = new WeakSet<object>();

  const walk = (value: unknown, path: string): void => {
    if (visited >= MAX_SCAN_NODES) return;
    visited += 1;

    if (typeof value === 'string') {
      const term = findDoctrineHit(value);
      if (term !== null) hits.push({ path, term });
      return;
    }
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value as object)) return;
    seen.add(value as object);

    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, path === '' ? String(i) : `${path}.${i}`));
      return;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walk(v, path === '' ? k : `${path}.${k}`);
    }
  };

  walk(payload, '');
  return hits;
}

/**
 * Return the first doctrine phrase that hits in `text`, or null when clean.
 * Mirrors `findForbiddenPhraseHit`'s shape so both signals read the same way.
 */
export function findDoctrineHit(text: string): string | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  for (const re of ROUTE_EGRESS_DOCTRINE_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}
