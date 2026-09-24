/**
 * Agent lane — Olumi discloses what it could not represent. Not
hat
 * they are TOLD when the model now holds a number they never gave.
 *
 * So the disclosure is appended deterministically by Olumi, from what actually
 * happened, after the Agent has written its reply. The Agent may also mention it;
 * this does not depend on whether it does.
 *
 * ⭐ It is appended ONLY when a placeholder was actually written. A disclosure
 * that appears on every turn is noise, and noise is how a real one gets missed.
 */

export interface DisclosableOutcome {
  /** A write happened. */
  readonly mutated: boolean;
  /** The written strength was a placeholder, not a stated one. */
  readonly placeholder_strength?: boolean;
}

export const PLACEHOLDER_STRENGTH_DISCLOSURE =
  'Note: you set the direction of that link, not its strength. The model needs a number to ' +
  'compute with, so it is holding a placeholder — that figure is not yours and should not be ' +
  'read as a measurement. Tell me how strong you think the effect is and I will replace it.';

/** The disclosures owed for this turn, in order. Empty when nothing is owed. */
export function disclosuresFor(outcomes: readonly DisclosableOutcome[]): readonly string[] {
  const owed: string[] = [];
  if (outcomes.some((o) => o.mutated && o.placeholder_strength === true)) {
    owed.push(PLACEHOLDER_STRENGTH_DISCLOSURE);
  }
  return owed;
}

/** Append owed disclosures to the Agent's own text, without rewriting it. */
export function withDisclosures(assistantText: string, owed: readonly string[]): string {
  if (owed.length === 0) return assistantText;
  const body = assistantText.trimEnd();
  return body.length === 0 ? owed.join('\n\n') : `${body}\n\n${owed.join('\n\n')}`;
}

/**
 * ⭐⭐ A VALUE THE USER APPROVED, STORED AS SOMETHING ELSE — SAID IN PROSE.
 *
 * ⛔ WHY PROSE AND NOT A BLOCK. This was first built as a `coaching` block with
 * `coaching_kind: 'calibration_prompt'`. Measured end to end against the UI at
 * `origin/staging`, that carrier CANNOT REACH THE USER on a normal turn:
 *   · `messageComposition.ts:110` sets `MAX_POINTS = 3`; `v5_coaching` is an
 *     unpinned point candidate (`:134-161`), so only the first three phase-3
 *     cards render in composed order and the rest are demoted to `detail`;
 *   · `InlineBlocks.tsx:609` renders `detail` only when `detailExpanded`, which
 *     starts `false` (`:235`) — a demoted block is NOT IN THE DOM;
 *   · and the contract reserves the 200+ `priority_rank` band for calibration
 *     prompts (`phase3Pacing.ts:96-97`), i.e. LAST. Independently reproduced on
 *     two real committed `/proxy/v5/turn` captures: `probe2154` put its two
 *     calibration prompts at composed positions 14 and 15 of 15, and
 *     `seeded-w2d` put its one at 9 of 9 — behind a collapsed "Show N more"
 *     both times. The UI's own docblock says the same thing in general:
 *     "Real turns carry 9-17 point candidates against MAX_POINTS, so 6-14 are
 *     demoted on every analysis turn" (`InlineBlocks.tsx:420-422`).
 *
 * `assistant_text` has no such budget: it is always rendered. This is the same
 * channel, and the same reasoning, as `PLACEHOLDER_STRENGTH_DISCLOSURE` above —
 * the user is TOLD when the model holds a number they did not give, and it does
 * not depend on the model electing to mention it.
 *
 * ⚠ The structured twin survives on `_agent.state_facts`, so a surface can still
 * reconcile mechanically. Prose is readable; structure is reliable.
 */

/** Prose budget for one disclosure paragraph, so the turn with the MOST to
 *  disclose still discloses. A named remainder beats a wall of text, and beats
 *  silently dropping entries. */
export const VALUE_CHANGE_DISCLOSURE_MAX_CHARS = 420;

function within(
  items: readonly string[],
  build: (shown: readonly string[], hidden: number) => string,
): string {
  for (let n = items.length; n > 0; n -= 1) {
    const body = build(items.slice(0, n), items.length - n);
    if (body.length <= VALUE_CHANGE_DISCLOSURE_MAX_CHARS) return body;
  }
  return build([], items.length);
}

function andMore(hidden: number): string {
  return hidden === 0 ? '' : ` …and ${hidden} more.`;
}

/**
 * The disclosures owed for values this product changed or scales it chose.
 * Empty when nothing was changed — a disclosure on every turn is noise, and
 * noise is how a real one gets missed.
 */
export function valueChangeDisclosures(facts: {
  readonly rescaled: readonly {
    readonly option?: string;
    readonly factor: string;
    readonly requested: number | null;
    readonly recorded: number | null;
  }[];
  readonly ranges_added: readonly { readonly factor: string; readonly range: number }[];
  readonly ranges_not_attached?: readonly { readonly factor: string; readonly range: number }[];
  readonly current_state_unknown?: boolean;
} | null | undefined): readonly string[] {
  if (facts === null || facts === undefined) return [];
  const owed: string[] = [];

  /**
   * ⛔⛔ UNKNOWN WINS BEFORE ANYTHING IS COMPOSED — not after.
   *
   * CHANGES_REQUIRED on `044fe50c`, accepted in full. The check used to sit
   * BELOW the rescaled and range blocks, so one turn could say "the current
   * model is unknown" and, in the same breath, "those stored figures are the
   * ones it will compute with" and "tell me the right ranges and I will replace
   * them". Both of those are PRESENT-STATE claims. A partial write followed by a
   * failed readback can emit rescaled+unknown from a single operation, so the
   * contradiction was reachable, not theoretical.
   *
   * ⭐ THE RULE: when the producer could not read the model back, the ONLY thing
   * that may be said is what happened, in the past tense. No figure is named as
   * current, no range is offered for replacement, and no advice is given —
   * because every one of those asserts a present state nothing verified.
   *
   * The early return is the mechanism: composing first and suppressing later is
   * what let a claim slip through, so nothing is composed at all.
   */
  if (facts.current_state_unknown === true) {
    return [
      'Note: this turn recorded changes to your model and then could not read it back, because it changed '
      + 'underneath the write. Those writes were accepted AT THE TIME. What the model now holds — the values, '
      + 'their ranges, and whether the analysis can run — is NOT KNOWN. Ask me to re-read it before changing '
      + 'anything, and do not treat any figure as current until then.',
    ];
  }

  const rescaled = (facts.rescaled ?? []).map((r) => {
    const where = typeof r.option === 'string' && r.option !== '' ? `${r.factor} for ${r.option}` : r.factor;
    // `null` is "the producer stated no figure" — never printed as a number.
    const req = r.requested === null ? 'the value you approved' : String(r.requested);
    const rec = r.recorded === null ? 'a different value' : String(r.recorded);
    return `${where} (you approved ${req}, stored as ${rec})`;
  });
  if (rescaled.length > 0) {
    owed.push(
      within(rescaled, (shown, hidden) =>
        'Note: the model did not store some values exactly as you approved them — ' +
        `${shown.join('; ')}.${andMore(hidden)} ` +
        'Those stored figures are the ones it will compute with. Tell me if any is wrong and I will change it.'),
    );
  }

  const ranges = (facts.ranges_added ?? []).map((r) => `${r.factor} (0 to ${r.range})`);
  if (ranges.length > 0) {
    owed.push(
      within(ranges, (shown, hidden) =>
        'Note: the analysis needed a range for some factors and Olumi chose one so it could run — ' +
        `${shown.join('; ')}.${andMore(hidden)} ` +
        'Those ranges are not yours. Tell me the right ones and I will replace them.'),
    );
  }

  /**
   * ⛔⛔ A VALUE THAT SAVED WITH NO RANGE IS THE ONE THE USER MUST BE TOLD ABOUT.
   *
   * The value write and the range write are two registrations; the first can
   * land and the second refuse. When that happens the values ARE saved and the
   * analysis is STILL blocked — and the wording that shipped before said
   * "nothing was written", which invites the user to redo a write that succeeded.
   *
   * ⚠ OPTIONAL BY DESIGN: the producing field (`ranges_not_attached`) is emitted
   * by the partial-outcome repair on #1743. Absent, this discloses nothing and
   * changes no behaviour, so the two PRs are independent in either merge order.
   */
  /**
   * ⛔⛔ THIS SAID MORE THAN ITS INPUT PROVED, AND THAT IS THE DEFECT.
   *
   * CHANGES_REQUIRED on `f028650d`, accepted in full. It previously said the
   * user's values "were saved and are unchanged", that the analysis "still needs
   * a range", and "Do not re-enter the values" — all inferred from
   * `ranges_not_attached` alone. That field proves ONE thing: this operation's
   * range did not attach. A competing writer may already have changed the value
   * or supplied the range, so every one of those sentences could be false, and
   * the last is advice that can cost the user the version that landed.
   *
   * ⚠ `current_state_unknown` is handled at the TOP of this function, before ANY
   * present-state claim is composed — see the header there. By the time execution
   * reaches here it is false, so `ranges_not_attached` is READBACK-VERIFIED by
   * contract and the missing range may be stated. Still NOTHING about the VALUES,
   * which the readback does not check: no "unchanged", no "do not re-enter".
   */
  const refused = (facts.ranges_not_attached ?? []).map((r) => r.factor);
  if (refused.length > 0) {
    owed.push(
      within(refused, (shown, hidden) =>
        'Note: the analysis still needs a range for ' +
        `${shown.join('; ')}${andMore(hidden) === '' ? '' : `.${andMore(hidden)}`}` +
        (andMore(hidden) === '' ? '. ' : '') +
        'Checked against the model as it now stands. Tell me the range and I will attach it.'),
    );
  }

  return owed;
}
