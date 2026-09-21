/**
 * Deterministic DSK allowlist for the widener.
 *
 * WHY AN ALLOWLIST AT ALL. The widener may cite decision-science ids; if it can
 * cite anything, a fabricated id is indistinguishable from a real one and
 * "grounded in the science" becomes unfalsifiable. The prompt receives a closed
 * list, and `dsk_refs` outside it are counted AGAINST the arm.
 *
 * WHY KEYWORD→TAG AND NOT A MODEL. Selection must be identical on every run of
 * every arm, or the DSK on/off comparison measures the selector instead of the
 * widener. This is a pure function of the brief bytes.
 */

import { readFileSync } from "node:fs";

export interface DskObject {
  id: string;
  type: string;
  title: string;
  context_tags?: string[];
  evidence_pack?: { key_findings?: string };
  recommended_behaviour?: string;
  steps?: string[];
  deprecated?: boolean;
}

export interface DskSelection {
  tags: string[];
  ids: string[];
  block: string;
}

/**
 * Brief keyword → context tag. Lower-cased substring match on the brief body.
 * `general` is always included: every DSK object carries it, so the allowlist is
 * never empty, and an empty allowlist would make `--dsk on` silently equal to
 * `--dsk off`.
 */
export const KEYWORD_TAGS: ReadonlyArray<[RegExp, string]> = Object.freeze([
  [/\b(price|pricing|plan|mrr|arr|churn|discount|subscription|tier)\b/i, "pricing"],
  [/\b(hire|hiring|headcount|recruit|candidate|salary|team size)\b/i, "hiring"],
  [/\b(build|buy|vendor|licence|license|outsourc|in-house|supplier)\b/i, "build_vs_buy"],
  [/\b(vendor|procure|supplier|rfp)\b/i, "vendor_selection"],
  [/\b(feature|scope|roadmap|backlog|release)\b/i, "feature_scope"],
  [/\b(budget|allocate|allocation|capacity|resource|headroom|spend)\b/i, "resource_allocation"],
  [/\b(prioritis|prioritiz|sequence|order of work)\b/i, "prioritisation"],
  [/\b(market|segment|expand|launch|geography|region)\b/i, "market_entry"],
  [/\b(product strategy|positioning|differentiat)\b/i, "product_strategy"],
  [/\b(team structure|reorg|org design|reporting line)\b/i, "team_structure"],
  [/\b(invest|funding|round|capital)\b/i, "investment"],
  [/\b(partner|partnership|alliance|channel)\b/i, "partnership"],
  [/\b(go.to.market|gtm|sales motion|campaign)\b/i, "go_to_market"],
]);

export const DEFAULT_MAX_DSK_OBJECTS = 8;

/** One line the widener can act on, capped so the block cannot crowd the brief. */
export function oneLineClaim(obj: DskObject, maxLength = 200): string {
  const source =
    obj.evidence_pack?.key_findings ??
    obj.recommended_behaviour ??
    (obj.steps != null && obj.steps.length > 0 ? obj.steps[0] : "");
  const firstSentence = source.split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  const line = firstSentence.length > 0 ? firstSentence : obj.title;
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}

export function tagsForBrief(briefBody: string, vocabulary: readonly string[]): string[] {
  const hits = new Set<string>(["general"]);
  for (const [pattern, tag] of KEYWORD_TAGS) {
    if (pattern.test(briefBody)) hits.add(tag);
  }
  return [...hits].filter((t) => vocabulary.includes(t)).sort();
}

/**
 * Select up to `max` DSK objects for a brief. Deterministic: tag match, then
 * sort by (number of matching tags DESC, id ASC), then cap.
 */
export function selectDskForBrief(
  briefBody: string,
  dskPath: string,
  contextTagsPath: string,
  max: number = DEFAULT_MAX_DSK_OBJECTS,
): DskSelection {
  const vocabulary = JSON.parse(readFileSync(contextTagsPath, "utf-8")) as string[];
  const store = JSON.parse(readFileSync(dskPath, "utf-8")) as { objects: DskObject[] };
  const tags = tagsForBrief(briefBody, vocabulary);

  const scored = store.objects
    .filter((o) => o.deprecated !== true)
    .map((o) => ({
      obj: o,
      score: (o.context_tags ?? []).filter((t) => tags.includes(t) && t !== "general").length,
    }))
    .filter((s) => s.score > 0 || (s.obj.context_tags ?? []).includes("general"))
    .sort((a, b) => (b.score - a.score) || (a.obj.id < b.obj.id ? -1 : 1))
    .slice(0, max);

  const lines = scored.map((s) => `${s.obj.id} | ${s.obj.title} | ${oneLineClaim(s.obj)}`);
  const block =
    scored.length === 0
      ? ""
      : [
          "",
          "<decision_science_principles>",
          "Cite ONLY these ids in dsk_refs. Never invent an id.",
          ...lines,
          "</decision_science_principles>",
        ].join("\n");

  return { tags, ids: scored.map((s) => s.obj.id), block };
}
