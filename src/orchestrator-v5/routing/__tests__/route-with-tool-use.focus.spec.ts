/**
 * SELECTION-AWARE ANSWERING (hop 4) — the prompt seam.
 *
 * `buildUserMessage` spreads `...rest`, so the `focus` section reaches the
 * serialised `## ContextPack` with no serialisation edit at all. What this file
 * pins is the part that is NOT automatic:
 *
 *  - `FOCUS_INSTRUCTION` is appended IFF `focus` is on the pack (both
 *    directions — an unconditional instruction is a mutant this must catch);
 *  - the selected element's LABEL actually reaches the prompt (the end-to-end
 *    reason this slice exists), bound to the exact fixture label;
 *  - a pack WITHOUT `focus` serialises BYTE-IDENTICALLY to the pre-change tip,
 *    pinned by a sha256 golden captured at `ae0b4af8` BEFORE any hop-4 edit
 *    existed (see GOLDEN below);
 *  - `could_not_check` carries the "could not read" sanction and NOT the
 *    "not in the model" one — asserted as a DISCRIMINATING PAIR against
 *    `not_in_model`, because each alone passes under a mutant that collapses
 *    the two states into one sentence.
 *
 * SCOPE, STATED HONESTLY (status ladder). These tests prove what the MODEL
 * RECEIVES and what the code-owned instruction DEMANDS. They do not — and
 * cannot, in-process with no live model — prove what the model ANSWERS. The
 * "the answer text demonstrably reasons about that element" half is a WIRE
 * witness, taken post-merge by the battery lane.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { resolveTurnSelection, type TurnSelection } from '../../build-turn-context.js';
import { assembleContextPack, type ContextPack } from '../../context/context-pack-assembler.js';
import { buildUserMessage, FOCUS_INSTRUCTION } from '../route-with-tool-use.js';
import { observeSerialisedPack } from '../../context/__tests__/observe-serialised-pack.js';
import { ANALYSIS_NOT_CURRENT_NOTE } from '../../format/format-analysis-for-context.js';

const USER_MESSAGE = 'why does this matter?';
const FACTOR_ID = 'factor_salary';
const FACTOR_LABEL = 'Engineer salary in the local market';
const OPTION_ID = 'opt_local';
const OPTION_LABEL = 'Hire locally';

const GRAPH = {
  nodes: [
    {
      id: FACTOR_ID,
      kind: 'factor',
      label: FACTOR_LABEL,
      description: 'What a senior engineer costs in this market.',
      category: 'external',
      observed_state: { value: 95000, unit: 'GBP', source: 'user_edited' },
    },
    {
      id: 'factor_ramp',
      kind: 'factor',
      label: 'Ramp-up time for a new joiner',
      observed_state: { value: 12, unit: 'weeks', source: 'cee_inference' },
    },
    { id: OPTION_ID, kind: 'option', label: OPTION_LABEL },
    { id: 'opt_offshore', kind: 'option', label: 'Offshore partner' },
    { id: 'goal_rev', kind: 'goal', label: 'Revenue growth over the next year' },
  ],
  edges: [{ from: FACTOR_ID, to: 'goal_rev', strength: { mean: 0.4, std: 0.1 } }],
};

const ANALYSIS = {
  winner: { option_id: OPTION_ID, option_label: OPTION_LABEL, win_probability: 0.62 },
  options: [
    { option_id: OPTION_ID, option_label: OPTION_LABEL, win_probability: 0.62 },
    { option_id: 'opt_offshore', option_label: 'Offshore partner', win_probability: 0.38 },
  ],
  // The REAL upstream `DriverSummary` shape (see the sibling spec's note).
  top_drivers: [
    { factor_id: FACTOR_ID, factor_label: FACTOR_LABEL, sensitivity: 0.42, direction: 'positive' },
    { factor_id: 'factor_ramp', factor_label: 'Ramp-up time for a new joiner', sensitivity: 0.11, direction: 'negative' },
  ],
  robustness_level: 'moderate',
  fragile_edge_count: 1,
  margin: 0.24,
  margin_pp: 24,
  analysis_status: 'computed',
} as unknown as Parameters<typeof assembleContextPack>[0]['analysis'];

function packWith(selection?: TurnSelection, analysisCurrent = true): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({ scenario_id: 'scen-focus-golden', message: USER_MESSAGE }),
    priorTurns: [],
    priorFacts: [],
    analysis: ANALYSIS,
    graph: GRAPH as never,
    ...(selection !== undefined
      ? {
          selection,
          // Direct assembler fixtures must declare the same canonical
          // currency verdict production supplies. Identity alone is not
          // permission to attach analysis figures to a selected node.
          coachingContext: {
            analysis_present: true,
            freshness: analysisCurrent ? 'fresh' : 'stale',
            readiness_status: 'ready',
            rerun_required: !analysisCurrent,
            usable_for_prose: true,
            usable_for_chips: analysisCurrent,
            blocked: false,
            actionable_blocker_count: 0,
          } as never,
        }
      : {}),
  });
}

function selectionFor(ids: readonly string[]): TurnSelection {
  const r = resolveTurnSelection(ids, GRAPH, 'ok_present');
  if (r === null) throw new Error('fixture: resolveTurnSelection returned null');
  return r;
}

// ---------------------------------------------------------------------------
// BYTE-IDENTITY — the no-selection prompt is unchanged by this slice
// ---------------------------------------------------------------------------

/**
 * sha256 of `buildUserMessage(packWith(undefined), USER_MESSAGE)` captured on
 * `staging` @ `ae0b4af8e403de5b1663c27425cfe5a140f65f32` with the hop-4 SOURCE
 * EDITS STASHED OUT — i.e. genuinely pre-change bytes, produced by THIS file's
 * final fixture (message length 3419).
 *
 * ⚠ THE CAPTURE PROCEDURE IS PART OF THE EVIDENCE. An earlier golden
 * (`ffb1b105…`, length 3154) was captured before the fixture was corrected, and
 * it "broke" when the fixture changed — which would have been trivially and
 * wrongly fixed by pasting in the new value FROM THE PATCHED TREE, converting
 * this guarantee into a tautology. It was instead re-captured with the source
 * stashed, and the patched tree then reproduced it EXACTLY. Re-capture the same
 * way (pristine source, final fixture) if this ever legitimately moves.
 *
 * Pinned to a HISTORICAL artefact, never to "whatever is current" — a control
 * pinned to current decays into a tautology the first time current changes.
 */
const PRISTINE_GOLDEN_SHA256 =
  '8f43569dcdbfee06ab0bad056ce746e61a17980f6cfa7ac0afbc622663f9c504';

describe('buildUserMessage — a turn with no selection is BYTE-IDENTICAL to pre-hop-4', () => {
  it('matches the sha256 golden captured at the pre-change tip', () => {
    // ⚠ THE GOLDEN IS NOT RE-CAPTURED — see this constant's docblock, which
    // warns that pasting a value from the patched tree converts the guarantee
    // into a tautology. Context/Memory V5 defect 2 added ONE key to the
    // display-safe analysis projection (`analysis_not_current_note`), and this
    // fixture triggers it because `packWith(undefined)` declares no currency
    // verdict — a real production state (no canonical analysis state means no
    // `coaching_context`) in which qualifying the figures is exactly the
    // intended fail-closed behaviour.
    //
    // So the delta is SUBTRACTED STRUCTURALLY — the key is removed from the
    // pack before serialisation, not spliced out of the rendered text, because
    // JSON text surgery has to get indentation and trailing commas right and
    // silently fails when it does not (it did, twice). Removing the key and
    // re-serialising is exact by construction.
    //
    // This keeps hop-4's byte-identity evidence intact AND proves the new key
    // is the whole delta: if any other byte moves, this REDs as it always has.
    const pack = packWith(undefined);
    const analysis = pack.display_analysis as Record<string, unknown> | null;
    expect(
      analysis?.analysis_not_current_note,
      'precondition: this fixture declares no currency, so the fail-closed disclosure must be present — ' +
        'if it is absent the subtraction is vacuous and this golden proves nothing',
    ).toBeTypeOf('string');
    delete analysis?.analysis_not_current_note;

    const msg = buildUserMessage(pack, USER_MESSAGE);
    expect(msg).not.toContain(ANALYSIS_NOT_CURRENT_NOTE);
    expect(createHash('sha256').update(msg).digest('hex')).toBe(PRISTINE_GOLDEN_SHA256);
  });

  it('carries no focus section and no focus instruction', () => {
    const msg = buildUserMessage(packWith(undefined), USER_MESSAGE);
    expect(Object.keys(observeSerialisedPack(msg))).not.toContain('focus');
    expect(msg).not.toContain(FOCUS_INSTRUCTION);
  });
});

// ---------------------------------------------------------------------------
// The instruction is appended IFF the section is on the pack
// ---------------------------------------------------------------------------

describe('FOCUS_INSTRUCTION — appended iff `focus` is on the pack', () => {
  it('IS appended when a selection was carried', () => {
    const msg = buildUserMessage(packWith(selectionFor([FACTOR_ID])), USER_MESSAGE);
    expect(msg).toContain(FOCUS_INSTRUCTION);
  });

  it('is NOT appended when no selection was carried', () => {
    const msg = buildUserMessage(packWith(undefined), USER_MESSAGE);
    expect(msg).not.toContain(FOCUS_INSTRUCTION);
  });

  it('is CODE-OWNED — the exported constant is the same bytes the prompt receives', () => {
    // A prompt-store edit could drift from the field it describes; this
    // instruction cannot, because it ships from the same commit as the
    // projection that writes the section.
    expect(FOCUS_INSTRUCTION.length).toBeGreaterThan(100);
    const msg = buildUserMessage(packWith(selectionFor([FACTOR_ID])), USER_MESSAGE);
    expect(msg.split(FOCUS_INSTRUCTION)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The selected element reaches the prompt — the reason the slice exists
// ---------------------------------------------------------------------------

describe('the serialised prompt carries the SELECTED element', () => {
  it('contains the selected element id and label inside the focus section', () => {
    const msg = buildUserMessage(packWith(selectionFor([FACTOR_ID])), USER_MESSAGE);
    const focus = observeSerialisedPack(msg).focus as Record<string, unknown>;
    expect(focus).toBeDefined();
    const serialised = JSON.stringify(focus);
    // Bound to the exact fixture identity, not to "some label appears".
    expect(serialised).toContain(FACTOR_ID);
    expect(serialised).toContain(FACTOR_LABEL);
  });

  it('carries the selected element ANALYSIS context (the amended acceptance half)', () => {
    const msg = buildUserMessage(packWith(selectionFor([OPTION_ID])), USER_MESSAGE);
    const focus = observeSerialisedPack(msg).focus as {
      elements: { id: string; analysis?: { win_probability?: string } }[];
    };
    const el = focus.elements.find((e) => e.id === OPTION_ID)!;
    expect(el.analysis?.win_probability).toBe('62%');
  });

  it('forbids rejoining stale selected figures from the broader analysis by label', () => {
    const msg = buildUserMessage(
      packWith(selectionFor([OPTION_ID]), false),
      USER_MESSAGE,
    );
    const serialised = observeSerialisedPack(msg);
    const focus = serialised.focus as {
      elements: {
        id: string;
        analysis_link: string;
        analysis?: { win_probability?: string };
      }[];
    };
    const selected = focus.elements.find((element) => element.id === OPTION_ID)!;

    // The temptation is real: display_analysis is serialised under the
    // model-facing `analysis` key and still contains the same label + 62%.
    const broaderAnalysis = JSON.stringify(serialised.analysis);
    expect(broaderAnalysis).toContain(OPTION_LABEL);
    expect(broaderAnalysis).toContain('62%');

    // Focus refuses the stale attachment, and the code-owned instruction
    // explicitly forbids the model from reconstructing it by label.
    expect(selected.analysis_link).toBe('analysis_not_current');
    expect(selected.analysis).toBeUndefined();
    expect(msg).toContain(FOCUS_INSTRUCTION);
    const notCurrentClause = FOCUS_INSTRUCTION.split('\n').find((line) =>
      line.includes('do not recover, infer or rejoin'),
    );
    expect(notCurrentClause).toContain('analysis_not_current');
    expect(notCurrentClause).toContain('`analysis` section by label');
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE CONTROL — selection present vs absent, measurable specificity delta
// ---------------------------------------------------------------------------

describe('NEGATIVE CONTROL — the same question without the selection is measurably less specific', () => {
  /**
   * The trap-13 positive control for the whole capability: if the two prompts
   * were indistinguishable, the grounding would be decoration.
   *
   * WHAT IS AND IS NOT CLAIMED. `display_analysis` already carries every
   * option's win probability, so the VALUE alone appears in both arms. The
   * discriminator is that the value is BOUND TO THE SELECTED ELEMENT — by id —
   * only in the selected arm. That is the honest measurable difference, and it
   * is asserted by identity, never by a substring another object could satisfy.
   */
  const selected = buildUserMessage(packWith(selectionFor([OPTION_ID])), USER_MESSAGE);
  const generic = buildUserMessage(packWith(undefined), USER_MESSAGE);

  it('the element id appears in the SELECTED arm and not in the generic arm', () => {
    const selectedPack = observeSerialisedPack(selected);
    const genericPack = observeSerialisedPack(generic);
    expect(JSON.stringify(selectedPack.focus)).toContain(OPTION_ID);
    expect('focus' in genericPack).toBe(false);
    // A strictly measurable delta, not a vibe: the id occurs more often.
    const count = (hay: string, needle: string): number => hay.split(needle).length - 1;
    expect(count(selected, OPTION_ID)).toBeGreaterThan(count(generic, OPTION_ID));
  });

  it('the analysis value is ATTACHED TO THE ELEMENT only in the selected arm', () => {
    const selectedFocus = observeSerialisedPack(selected).focus as {
      elements: { id: string; analysis?: { win_probability?: string } }[];
    };
    const el = selectedFocus.elements.find((e) => e.id === OPTION_ID)!;
    expect(el.analysis?.win_probability).toBe('62%');
    // The generic arm has no structure that binds a probability to this id.
    expect('focus' in observeSerialisedPack(generic)).toBe(false);
  });

  it('the answering sanction is present only in the selected arm', () => {
    expect(selected).toContain(FOCUS_INSTRUCTION);
    expect(generic).not.toContain(FOCUS_INSTRUCTION);
  });

  it('the two prompts are NOT identical (if they were, the grounding is decoration)', () => {
    expect(selected).not.toBe(generic);
    expect(selected.length).toBeGreaterThan(generic.length);
  });
});

// ---------------------------------------------------------------------------
// The three-state discrimination, at the PROMPT
// ---------------------------------------------------------------------------

describe('the prompt never tells a user their node is gone when the read FAILED', () => {
  function unresolvedPack(graphRead: TurnSelection['graph_read']): ContextPack {
    return packWith({
      requested_ids: ['ghost_a'],
      elements: [],
      unresolved_ids: ['ghost_a'],
      graph_read: graphRead,
    });
  }

  it('degraded serialises could_not_check', () => {
    const msg = buildUserMessage(unresolvedPack('degraded'), USER_MESSAGE);
    const focus = observeSerialisedPack(msg).focus as { unresolved: string };
    expect(focus.unresolved).toBe('could_not_check');
  });

  it('ok_present serialises not_in_model', () => {
    const msg = buildUserMessage(unresolvedPack('ok_present'), USER_MESSAGE);
    const focus = observeSerialisedPack(msg).focus as { unresolved: string };
    expect(focus.unresolved).toBe('not_in_model');
  });

  it('DISCRIMINATING PAIR — the two states serialise DIFFERENTLY on identical input', () => {
    const degraded = observeSerialisedPack(
      buildUserMessage(unresolvedPack('degraded'), USER_MESSAGE),
    ).focus as { unresolved: string };
    const present = observeSerialisedPack(
      buildUserMessage(unresolvedPack('ok_present'), USER_MESSAGE),
    ).focus as { unresolved: string };
    expect(degraded.unresolved).not.toBe(present.unresolved);
  });

  it('the instruction SANCTIONS both states apart — each is named, and named differently', () => {
    // The instruction is what makes the distinction operative for the model.
    // A mutant collapsing the two clauses into one must turn this red.
    expect(FOCUS_INSTRUCTION).toContain('not_in_model');
    expect(FOCUS_INSTRUCTION).toContain('could_not_check');
    const notInModelClause = FOCUS_INSTRUCTION.indexOf('not_in_model');
    const couldNotCheckClause = FOCUS_INSTRUCTION.indexOf('could_not_check');
    expect(notInModelClause).not.toBe(couldNotCheckClause);
    // And it must forbid the specific lie: asserting absence on a failed read.
    expect(FOCUS_INSTRUCTION.toLowerCase()).toContain('could not read');
  });
});
