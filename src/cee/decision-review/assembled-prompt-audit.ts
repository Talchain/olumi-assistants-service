/**
 * ⭐⭐⭐ THE CONTRACT BETWEEN A PROMPT AND ITS PAYLOAD, MADE EXECUTABLE.
 *
 * ⛔ THE DEFECT THIS EXISTS TO MAKE IMPOSSIBLE, measured on real sessions:
 *
 * For the entire life of the feature, the reviewing model received
 * `<GRAPH>\n\n{}\n\n</GRAPH>` — TWENTY-ONE CHARACTERS against a 43,100-char
 * budget — on 6 of 6 captured reviews. It was coaching about a model it had
 * never seen.
 *
 * ⚠ AND NOTE HOW IT SURVIVED. `v5.context_budget` logged `graph_json: 21`
 * every single turn. The number was RIGHT THERE. It survived because 21 is
 * only recognisable as `{}` by ARITHMETIC — the telemetry reported the SHAPE
 * of the payload and never its SUBSTANCE, so nobody could read what nobody
 * had rendered. A guard that counts characters cannot see an empty graph.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE RULE, AND WHY IT IS THIS RULE AND NOT "SECTIONS MUST BE NON-EMPTY".
 *
 * Every section the assembler EMITS must be one of:
 *
 *   · SUBSTANTIVE        — it carries content the model can reason about.
 *   · EXPLICITLY_ABSENT  — it says so, in words, e.g. "Not available".
 *
 * and never:
 *
 *   · DEGENERATE — `{}`, `[]`, `{"nodes":[],"edges":[]}`, `null`, blank.
 *
 * ⭐ THE DISTINCTION IS THE WHOLE POINT. `"Not available"` is HONEST: it costs
 * a few tokens and tells the model plainly that it has nothing, which stops it
 * inventing. `{}` is DISHONEST BY ACCIDENT: it has the shape of data, so the
 * model reads it as "a graph, which happens to be empty" rather than "no graph
 * was sent". A rule of "must be non-empty" would have banned the honest form
 * and kept the dishonest one, because `{}` is not empty — it is two characters.
 *
 * A section with nothing to say should be OMITTED (as `SCAFFOLDED_OPTIONS`
 * already is) or marked absent. It must not be emitted looking like data.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY A SHARED MODULE RATHER THAN ONE MORE TEST.
 *
 * This is deliberately not scoped to the graph. The same failure has six
 * measured forms in this estate — a prompt demanding edge ids the payload
 * cannot carry, `goal_constraints` deleted by both projection arms before the
 * model saw them, qualifiers dropped while their numbers survived, a quarter
 * of the context budget used, and four decomposed calls receiving no graph at
 * all. Each was fixed as an instance. None of those fixes could see the next
 * one.
 *
 * Auditing the ASSEMBLED MESSAGE — the actual bytes a model receives — is the
 * one place where all of them are visible at once, because it is the only
 * place where prompt and payload meet.
 */

/** Verdict for one emitted section of an assembled prompt. */
export type AssembledSectionVerdict = 'substantive' | 'explicitly_absent' | 'degenerate';

export interface AssembledSectionAudit {
  readonly section: string;
  readonly verdict: AssembledSectionVerdict;
  /** Present only for `degenerate` — what was found, for the failure message. */
  readonly found?: string;
  readonly chars: number;
}

/**
 * Bodies that state an absence in words. Matched case-insensitively against the
 * WHOLE trimmed body, never as a substring: a section that merely mentions
 * "not available" inside real content is substantive, not absent.
 */
const EXPLICIT_ABSENCE_BODIES: readonly string[] = [
  'not available',
  'none',
  'not provided',
  'no data',
];

/** Collection keys whose emptiness makes a JSON body carry nothing. */
const COLLECTION_KEYS = ['nodes', 'edges', 'options', 'factors', 'items', 'blocks'] as const;

function stripDisclosureMarker(body: string): string {
  // `[TRUNCATED: …]` is appended by the bounding helpers and is metadata about
  // the body, not body content. A section whose ONLY content is a truncation
  // marker is still degenerate.
  const at = body.lastIndexOf('\n[TRUNCATED: ');
  return (at === -1 ? body : body.slice(0, at)).trim();
}

/**
 * Is this body carrying nothing the model can use?
 *
 * ⚠ Deliberately structural, not a string match on `'{}'`. A pretty-printed
 * `{\n "nodes": [],\n "edges": []\n}` is 30+ characters and is exactly as empty
 * as `{}` — a character-count or literal check would pass it, which is the
 * class of blindness this module exists to end.
 */
function isDegenerateJson(body: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false; // not JSON — judged as prose elsewhere
  }
  if (parsed === null) return true;
  if (Array.isArray(parsed)) return parsed.length === 0;
  if (typeof parsed !== 'object') return false;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) return true; // `{}` — the original defect
  // An object whose only content is empty collections and bookkeeping counts
  // carries nothing either.
  const meaningful = keys.filter((k) => {
    if (k.startsWith('_')) return false; // `_node_count`, `_omitted`, `_truncated`
    const value = record[k];
    if (Array.isArray(value)) return value.length > 0;
    if (value === null || value === undefined) return false;
    if (typeof value === 'object') return Object.keys(value as object).length > 0;
    return true;
  });
  if (meaningful.length > 0) return false;
  // Every remaining key was an empty collection. Degenerate only if at least
  // one of them was a collection we recognise — otherwise stay quiet rather
  // than fail an unfamiliar shape.
  return keys.some((k) => (COLLECTION_KEYS as readonly string[]).includes(k));
}

/**
 * Audit every `<TAG>…</TAG>` section of an assembled prompt.
 *
 * Derived from the message itself — it iterates the sections the assembler
 * ACTUALLY EMITTED rather than a hand-listed set, so a section added later is
 * covered the day it ships and cannot be forgotten. That is the difference
 * between this and the mirror it replaces.
 */
export function auditAssembledPrompt(message: string): readonly AssembledSectionAudit[] {
  const out: AssembledSectionAudit[] = [];
  const pattern = /<([A-Z][A-Z0-9_]*)>\n([\s\S]*?)\n<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message)) !== null) {
    const section = match[1] as string;
    const raw = match[2] as string;
    const body = stripDisclosureMarker(raw);
    const chars = raw.length;
    if (body.length === 0) {
      out.push({ section, verdict: 'degenerate', found: '(empty)', chars });
      continue;
    }
    if (EXPLICIT_ABSENCE_BODIES.includes(body.toLowerCase())) {
      out.push({ section, verdict: 'explicitly_absent', chars });
      continue;
    }
    if (isDegenerateJson(body)) {
      out.push({
        section,
        verdict: 'degenerate',
        found: body.length > 60 ? `${body.slice(0, 60)}…` : body,
        chars,
      });
      continue;
    }
    out.push({ section, verdict: 'substantive', chars });
  }
  return out;
}

/** The sections that carry nothing while looking as though they do. */
export function degenerateSections(message: string): readonly AssembledSectionAudit[] {
  return auditAssembledPrompt(message).filter((s) => s.verdict === 'degenerate');
}
