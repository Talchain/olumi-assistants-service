/**
 * ⭐⭐ THE SERVER STATES WHAT IT DID, instead of asking the model to.
 *
 * ⛔ THE GAP, MEASURED. `authoriseChange` knows two things the user must be told
 * and tells only the MODEL:
 *
 *   · `rescaled_by_the_model` — a value the user APPROVED was stored
 *     DIFFERENTLY. It rides with `must_disclose_rescaling: true` and an
 *     instruction: *"state every value the model stored differently from the one
 *     approved."*
 *   · `ranges_added_for_analysis` — a factor had no range, which would have
 *     stopped the analysis, so **the product took one from the figure itself**.
 *     That is a denominator Olumi chose.
 *
 * `must_disclose_rescaling` occurs at exactly ONE site in the whole tree — the
 * one that SETS it. **Nothing reads it and nothing verifies it.** Contrast
 * control: the estate does police narration elsewhere (`narration.stripped`
 * strips write claims the model had no right to make), so the mechanism exists
 * and simply is not applied here.
 *
 * ⇒ Whether a person learns their approved value was changed, or that a
 * denominator was chosen for them, depends entirely on the model electing to say
 * so. The charter is explicit that this class must be visible:
 * *"Its own assumptions, estimates, causal claims and alternatives remain
 * distinguishable … and open to correction."* An obligation carried in a prompt
 * is not a guarantee.
 *
 * ⭐ NO EXTRA IO AND NOTHING NEW IS CLAIMED. `AgentTurnResult.tool_results`
 * already carries the full results. These are the server's OWN comparisons —
 * `recorded !== requested`, computed by the code that performed the write.
 *
 * ⛔ IT DOES NOT SUPPRESS THE PROMPT OBLIGATION. The model should still say it
 * in its own words; this makes the fact available whatever the model does. Two
 * channels for one fact is right here, because they fail differently: prose is
 * readable, structure is reliable.
 *
 * ⚠ LABELS TRAVEL, AND THAT IS NECESSARY. A rescaling the user cannot locate is
 * not a disclosure, so the option and factor labels ride along — the user's OWN
 * words, already present elsewhere in the same response (`draft_graph` carries
 * every node label), so this is no new exposure.
 */

/** One approved value that was stored differently. */
export interface RescaledValue {
  readonly option: string;
  readonly factor: string;
  readonly requested: number | null;
  readonly recorded: number | null;
}

/** One range the PRODUCT chose so the analysis could run at all. */
export interface RangeAddedForAnalysis {
  readonly factor: string;
  readonly range: number;
}

export interface TurnStateFacts {
  readonly rescaled: readonly RescaledValue[];
  readonly ranges_added: readonly RangeAddedForAnalysis[];
}

const EMPTY: TurnStateFacts = { rescaled: [], ranges_added: [] };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/**
 * Collect what the server itself observed about this turn's writes.
 *
 * ⚠ BOUND BY THE FIELDS A DISCLOSURE NEEDS. An entry that cannot name WHICH
 * option and factor it concerns is dropped: a rescaling the user cannot locate
 * is not a disclosure, and shipping a half-one is worse than shipping none
 * because it looks like an answer.
 */
export function collectTurnStateFacts(toolResults: readonly unknown[] | undefined): TurnStateFacts {
  if (!Array.isArray(toolResults)) return EMPTY;
  const rescaled: RescaledValue[] = [];
  const ranges: RangeAddedForAnalysis[] = [];
  const seenRescaled = new Set<string>();
  const seenRange = new Set<string>();

  for (const result of toolResults) {
    const r = asRecord(result);
    if (r === null) continue;

    for (const entry of Array.isArray(r.rescaled_by_the_model) ? r.rescaled_by_the_model : []) {
      const e = asRecord(entry);
      if (e === null) continue;
      if (typeof e.option !== 'string' || typeof e.factor !== 'string') continue;
      const key = `${e.option}\u0000${e.factor}`;
      if (seenRescaled.has(key)) continue;
      seenRescaled.add(key);
      rescaled.push({
        option: e.option,
        factor: e.factor,
        requested: numberOrNull(e.requested),
        recorded: numberOrNull(e.recorded),
      });
    }

    for (const entry of Array.isArray(r.ranges_added_for_analysis) ? r.ranges_added_for_analysis : []) {
      const e = asRecord(entry);
      if (e === null) continue;
      // A range of 0 or below cannot be a denominator, so it is not a range this
      // product chose — it is a malformed entry, and reporting it would tell the
      // user something untrue about their model.
      if (typeof e.factor !== 'string' || typeof e.range !== 'number' || e.range <= 1) continue;
      if (seenRange.has(e.factor)) continue;
      seenRange.add(e.factor);
      ranges.push({ factor: e.factor, range: e.range });
    }
  }

  return { rescaled, ranges_added: ranges };
}
