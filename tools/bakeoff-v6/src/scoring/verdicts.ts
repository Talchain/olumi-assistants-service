/**
 * Verdict providers — the seam where the cleared proposal-quality judge
 * plugs in.
 *
 * FGQ consumes per-element gate/value/flag verdicts. Until the judge clears
 * its held-out gate on Paul's blind labels, the ONLY provider available is a
 * deterministic smoke stub that maps structural safety-cell hits and
 * duplicate detection onto verdicts. Its name is stamped on every score it
 * touches and any run using it is watermarked NOT EVIDENCE by construction.
 */
import type { BlindCandidate, RItemInput, SafetyCellHit } from "../types.ts";
import { decompose, normalizeText, type DecomposedElement } from "./decompose.ts";
import type { FgqElement, FgqRItem } from "./fgq/fgq.ts";

export interface VerdictBundle {
  provider: string;
  elements: FgqElement[];
  r_items: FgqRItem[];
  /** True when R was absent — recall is "pending R", never a coverage claim. */
  r_pending: boolean;
}

export interface VerdictProvider {
  readonly name: string;
  provide(blind: BlindCandidate, safetyHits: SafetyCellHit[], r?: RItemInput[]): VerdictBundle;
}

/**
 * Deterministic smoke stub. NEVER evidence. Mapping:
 *  - element hit by a safety cell => that cell's flag; invented-value hits
 *    also gate as ungrounded_or_fabricated (structural corroboration);
 *  - duplicate normalized labels => value duplicate_or_restatement;
 *  - defer artifacts => grounded useful defer artifacts (clarification flag);
 *  - everything else => grounded/useful;
 *  - R matching: exact normalized-text equality with an R item description
 *    (real matching is judge-side work).
 */
export class SmokeStubVerdictProvider implements VerdictProvider {
  readonly name = "deterministic_smoke_stub";

  provide(blind: BlindCandidate, safetyHits: SafetyCellHit[], r?: RItemInput[]): VerdictBundle {
    const decomposed = decompose(blind);
    const hitsByElement = new Map<string, SafetyCellHit[]>();
    for (const hit of safetyHits) {
      const list = hitsByElement.get(hit.element_id) ?? [];
      list.push(hit);
      hitsByElement.set(hit.element_id, list);
    }

    const seenTexts = new Map<string, string>();
    const rItems: FgqRItem[] = (r ?? []).map((item) => ({ id: item.id, kind: item.kind }));
    const rByText = new Map<string, RItemInput>();
    for (const item of r ?? []) {
      if (item.description) rByText.set(normalizeText(item.description), item);
    }

    const elements = decomposed.map((el) => this.verdictFor(el, hitsByElement, seenTexts, rByText));
    return { provider: this.name, elements, r_items: rItems, r_pending: !r || r.length === 0 };
  }

  private verdictFor(
    el: DecomposedElement,
    hitsByElement: Map<string, SafetyCellHit[]>,
    seenTexts: Map<string, string>,
    rByText: Map<string, RItemInput>
  ): FgqElement {
    const hits = hitsByElement.get(el.element_id) ?? [];
    const flags = [...new Set(hits.map((h) => h.cell))];
    const invented = flags.includes("invented_value_unit_or_effect");

    let value: FgqElement["value"] = "useful";
    if (el.element_kind !== "artifact") {
      const dupKey = `${el.element_kind}:${el.text}`;
      if (seenTexts.has(dupKey)) value = "duplicate_or_restatement";
      else seenTexts.set(dupKey, el.element_id);
    }

    const isDefer = el.element_kind === "artifact";
    const rMatch = rByText.get(el.text);

    return {
      id: el.element_id,
      gate: invented ? "ungrounded_or_fabricated" : "grounded",
      value: invented ? null : value,
      flags: isDefer ? [...flags, "clarification_needed"] : flags,
      corroborated: true, // all stub flags are structurally derived
      satisfies: rMatch ? rMatch.id : null,
      is_defer_artifact: isDefer,
    };
  }
}
