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

/**
 * One approved value that was stored differently.
 *
 * ⚠ `option` IS OPTIONAL and usually ABSENT. The sole producer of
 * `rescaled_by_the_model` is the factor-value path
 * (`agent-capabilities.ts:1202`), which changes a factor rather than one option's
 * intervention and so emits no option. Typing it as required is what made the
 * collector drop every real entry.
 */
export interface RescaledValue {
  readonly option?: string;
  readonly factor: string;
  readonly requested: number | null;
  readonly recorded: number | null;
}

/** One range the PRODUCT chose so the analysis could run at all. */
export interface RangeAddedForAnalysis {
  readonly factor: string;
  readonly range: number;
}

/**
 * A range this turn INTENDED to attach and could not, so the analysis is still
 * blocked for that factor even though the value itself was saved.
 *
 * ⛔ WITHOUT THIS THE PROSE COULD NOT SAY IT. The tool result reports the
 * partial outcome (`ranges_not_attached`, `analysis_still_blocked_for`), but a
 * field only the model reads is a field that is disclosed only if the model
 * elects to — which is the exact dependence this module exists to remove.
 */
export interface RangeNotAttached {
  readonly factor: string;
  readonly range: number;
}

export interface TurnStateFacts {
  readonly rescaled: readonly RescaledValue[];
  readonly ranges_added: readonly RangeAddedForAnalysis[];
  /** Ranges that were refused — the value landed, the range did not. */
  readonly ranges_not_attached: readonly RangeNotAttached[];
}

const EMPTY: TurnStateFacts = { rescaled: [], ranges_added: [], ranges_not_attached: [] };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function numberOrNull(value: unknown): number | null {
  // ⛔ `Number.NaN` IS the producer's sentinel for "no requested figure"
  // (`agent-capabilities.ts:1204`: `typeof req === 'number' ? req : Number.NaN`),
  // and `typeof NaN === 'number'`. Passing it through put `NaN` where a user
  // would be shown a number. Finiteness, not typeof, is the question.
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
  const notAttached: RangeNotAttached[] = [];
  const seenRescaled = new Set<string>();
  const seenRange = new Set<string>();
  const seenNotAttached = new Set<string>();

  for (const result of toolResults) {
    const r = asRecord(result);
    if (r === null) continue;

    for (const entry of Array.isArray(r.rescaled_by_the_model) ? r.rescaled_by_the_model : []) {
      const e = asRecord(entry);
      if (e === null) continue;
      // ⛔⛔ `option` IS OPTIONAL, AND REQUIRING IT KILLED THIS FEATURE.
      //
      // Proven at the source: `rescaled_by_the_model` is emitted at exactly ONE
      // site, `agent-capabilities.ts:1292`, fed by `const landed` at `:1208`,
      // fed by the `applied.push({ factor, requested, recorded })` at `:1202` —
      // which carries NO `option`. The other push (`:1111`) does carry one, but
      // it feeds the block ending `:1130`, which never emits this key. So the
      // old `typeof e.option !== 'string' -> continue` dropped **100% of real
      // entries** and the disclosure could never fire.
      //
      // It is SEMANTICALLY absent there, not merely missing: a factor-value edit
      // changes a factor, not one option's intervention. `factor` alone names the
      // change, so `factor` is what is required.
      if (typeof e.factor !== 'string' || e.factor === '') continue;
      const option = typeof e.option === 'string' && e.option !== '' ? e.option : undefined;
      const key = `${option ?? ''}\u0000${e.factor}`;
      if (seenRescaled.has(key)) continue;
      seenRescaled.add(key);
      rescaled.push({
        ...(option === undefined ? {} : { option }),
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

    /**
     * ⚠ SAME SHAPE AS `ranges_added_for_analysis`, OPPOSITE MEANING. The
     * producer emits exactly one of the two per factor: a range was attached,
     * or it was refused. Reading only the first told the user a range had been
     * chosen and never that one was missing.
     */
    for (const entry of Array.isArray(r.ranges_not_attached) ? r.ranges_not_attached : []) {
      const e = asRecord(entry);
      if (e === null) continue;
      if (typeof e.factor !== 'string' || e.factor === '') continue;
      // A range must be a usable denominator to be worth naming; the producer
      // applies the same `> 1` rule when it chooses one.
      if (typeof e.range !== 'number' || !Number.isFinite(e.range) || e.range <= 1) continue;
      if (seenNotAttached.has(e.factor)) continue;
      seenNotAttached.add(e.factor);
      notAttached.push({ factor: e.factor, range: e.range });
    }
  }

  return { rescaled, ranges_added: ranges, ranges_not_attached: notAttached };
}
