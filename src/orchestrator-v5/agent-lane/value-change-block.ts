/**
 * ⭐⭐ THE USER SEES THAT THEIR APPROVED VALUE WAS CHANGED.
 *
 * ⛔ THE GAP. `authoriseChange` knows two things the person must be told and
 * told only the MODEL, on `must_disclose_rescaling: true` with an instruction to
 * relay it:
 *
 *   · a value the user APPROVED was stored DIFFERENTLY;
 *   · a factor had no range, which would have stopped the analysis, so THE
 *     PRODUCT took one from the figure itself — a denominator Olumi chose.
 *
 * `must_disclose_rescaling` occurs at exactly ONE site in the tree, the one that
 * SETS it. Nothing reads it and nothing verifies it.
 *
 * ⚠ AND THE OBLIGATION WAS NOT LAZINESS — it was the only channel that existed.
 * Measured: the agent response carries NO `coaching` object at all, so
 * `coaching.summary` (the rendered prose channel the Conventional path uses) is
 * not available here. The model's own `assistant_text` was the only user-facing
 * prose an Agent turn had.
 *
 * ⭐ BUT A BLOCK IS. The route already appends `blocks`, `V5CoachingBlock.tsx`
 * renders them, and a typed `CoachingBlock` carries its own provenance
 * structurally. So the server can state this itself, and the person sees it
 * whatever the model chose to say.
 *
 * ⛔ IT DOES NOT REPLACE THE PROMPT OBLIGATION. The model should still say it in
 * its own words. Two channels for one fact is right here because they fail
 * differently: prose is readable, a block is reliable.
 *
 * ── WHAT THIS WILL NOT DO ───────────────────────────────────────────────────
 * It never invents a value, never re-states a number the product chose as
 * though the user set it, and never ranks or recommends. Every figure it shows
 * is one of two things: what the user APPROVED, or what was RECORDED — and it
 * labels which is which, because a disclosure that blurs them is worse than
 * silence.
 */

import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';
import { gateCoachingCardBody } from '../coaching/copy-quality-gate.js';
import { deterministicBlockId } from '../compose/block-id.js';
import { guidanceSignalsForCoachingKind } from '../compose/guidance-signals.js';
import type { TurnStateFacts } from './turn-state-facts.js';

const TITLE_MAX = 80;

/**
 * ⛔ ONE BLOCK PER CONCERN, AND THAT IS A CORRECTNESS FIX, NOT A STYLE CHOICE.
 *
 * A single combined card ran to ~380 characters against the gate's own
 * `CARD_BODY_MAX_CHARS = 300`, so it was REJECTED — meaning the turn with the
 * MOST to disclose (a changed value AND a chosen scale) was the one that
 * silently shipped nothing. Found by probing the builder rather than reading it.
 *
 * Splitting removes the truncation risk entirely, and each card is separately
 * actionable: "check this figure" and "check this scale" are different asks.
 */

/** Trim at a word boundary — a disclosure cut mid-word reads as a bug. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd();
}

function rescaledCopy(facts: TurnStateFacts): { title: string; body: string } | null {
  if (facts.rescaled.length === 0) return null;
  const parts: string[] = [];
  // ⚠ BOTH NUMBERS, LABELLED. "Stored differently" without saying what to and
  // from is not something a person can check or correct.
  const named = facts.rescaled
    .filter((r) => r.requested !== null && r.recorded !== null)
    // ⛔⛔ `option` IS USUALLY ABSENT, and this interpolated it unconditionally.
    // The sole producer of `rescaled_by_the_model` (`agent-capabilities.ts:1202`,
    // feeding the emit at `:1292`) carries no option, so the real shape rendered
    // "Monthly churn rate for undefined (you approved 3.5, stored as 0.035)".
    // Showing a user the literal word "undefined" in a disclosure about their own
    // number is worse than the silence this block replaced. The factor alone
    // names the change on that path; the option is added only when it exists.
    .map((r) => {
      const where = typeof r.option === 'string' && r.option !== '' ? `${r.factor} for ${r.option}` : r.factor;
      return `${where} (you approved ${r.requested}, stored as ${r.recorded})`;
    });
  const unnamed = facts.rescaled.length - named.length;
  if (named.length > 0) {
    parts.push(`Some values were stored differently from the figures you approved: ${named.join('; ')}.`);
  }
  // ⛔ NEVER SILENTLY DROPPED. An entry whose numbers could not be read is still
  // a change the user should know happened.
  if (unnamed > 0) {
    parts.push(`${unnamed} further ${unnamed === 1 ? 'value was' : 'values were'} stored differently, and the figures could not be read back.`);
  }
  if (parts.length === 0) return null;
  return {
    title: truncate('What was stored differs from what you approved', TITLE_MAX),
    body: parts.join(' '),
  };
}

function rangeCopy(facts: TurnStateFacts): { title: string; body: string } | null {
  if (facts.ranges_added.length === 0) return null;
  const ranges = facts.ranges_added.map((r) => `${r.factor} (0 to ${r.range})`).join('; ');
  return {
    title: truncate('A scale was chosen for you', TITLE_MAX),
    body:
      `A scale was taken from your own figures so the analysis could run at all: ${ranges}. ` +
      'That is a unit of measurement rather than a forecast or a limit, and it is the product\u2019s choice, not yours \u2014 correct it if it is wrong.',
  };
}

/**
 * Build the disclosure blocks, or `[]` when there is nothing to disclose.
 *
 * ⚠ FAILS CLOSED AT EVERY GATE, AND THE GATE IS USED PROPERLY.
 * `gateCoachingCardBody` returns a `GateResult`, NOT a boolean — my first
 * version wrote `if (!gate(text))`, which is always falsy-negated on an object,
 * so the lexicon gate was INERT and rejected nothing. The probe caught it; a
 * reading would not have.
 */
export function buildValueChangeBlocks(facts: TurnStateFacts, createdAt: string): readonly CoachingBlock[] {
  const blocks: CoachingBlock[] = [];

  for (const [concern, copy] of [
    ['rescaled', rescaledCopy(facts)],
    ['scale_frame', rangeCopy(facts)],
  ] as const) {
    if (copy === null) continue;

    // Gate 1 — the shared lexicon gate, consumed by its VERDICT and using the
    // text it returns (it may normalise style).
    const titleGate = gateCoachingCardBody(copy.title);
    const bodyGate = gateCoachingCardBody(copy.body);
    if (!titleGate.accept || !bodyGate.accept) continue;

    const signalId = `agent:value_change:${concern}:${facts.rescaled.length}:${facts.ranges_added.length}`;
    const candidate = {
      block_id: deterministicBlockId(signalId),
      signal_id: signalId,
      created_at: createdAt,
      source_handler: 'agent_turn',
      freshness: 'fresh',
      type: 'coaching',
      // `calibration_prompt` is the admitted kind that fits: a scale or a value
      // the product settled and the person should check. NOT `assumption_check`
      // — they did not assume this, we did it.
      coaching_kind: 'calibration_prompt',
      title: titleGate.text,
      body: bodyGate.text,
      // ⛔ `source` IS A CLOSED ENUM and `agent_turn` is not in it. The type
      // system refused that, correctly — inventing a contract value here would
      // be a schemas change smuggled in as a literal. `deterministic_signal` is
      // both ADMITTED and TRUE: the server computed `recorded !== requested`
      // itself, in code, with no model involved.
      source: 'deterministic_signal',
      // No canvas node id is resolvable without a lookup this module does not
      // hold, and the UI marks only a real node — a ref to nothing renders
      // nothing. `[]` is schema-legal and is the sibling's measured lesson.
      target_refs: [],
      // ⚠ RANK 1 IS NOT A FORMALITY. Coaching cards collapse behind "Show N
      // more" past the sixth, and a disclosure the user must scroll to find is
      // a disclosure that did not happen.
      priority_rank: 1,
      ...guidanceSignalsForCoachingKind('calibration_prompt'),
    } as CoachingBlock;

    // Gate 2 — fail closed rather than hand egress a block it drops whole.
    if (!CoachingBlockSchema.safeParse(candidate).success) continue;
    blocks.push(candidate);
  }

  return blocks;
}
