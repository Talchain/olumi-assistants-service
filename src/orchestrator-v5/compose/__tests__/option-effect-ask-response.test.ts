/**
 * ⭐ ROADMAP 2.1266 / ACCEPTANCE 4 — an unbindable option-effect request ASKS,
 * and every chip it offers routes back into the lane that offered it.
 *
 * The estate's ruling for a genuinely ambiguous entity is to make the
 * ambiguity the product (CLAUDE.md trap 22f) — never a guess, never the
 * byte-identical refusal. This suite pins the two properties that make such a
 * question honest rather than another dead end:
 *
 *   1. the copy survives the shipped egress guards and names no internal ids;
 *   2. every chip message, run through the SHIPPED resolver against the SAME
 *      graph, resolves to a WRITE for exactly the candidate it offers (P8: the
 *      acceptance path for a direct answer is named and pinned, not asserted
 *      in prose).
 *
 * Property 2 is DERIVED, never mirrored (trap 12): it invokes
 * `resolveOptionEffectWrite` rather than re-stating the routing rules here, so
 * a change to either the advised phrasing or the resolver reddens this file.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import { composeOptionEffectAskResponse } from '../option-effect-ask-response.js';
import { findForbiddenPhraseHit } from '../forbidden-user-facing-phrases.js';
import { resolveOptionEffectWrite } from '../../routing/option-effect-write.js';

interface WitnessFixture {
  readonly ids: {
    readonly option_id: string;
    readonly option_label: string;
    readonly factor_id: string;
    readonly factor_label: string;
  };
  readonly draft_graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
}

const WITNESS = JSON.parse(
  readFileSync(
    new URL(
      '../../__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as WitnessFixture;

const OPTION_ID = WITNESS.ids.option_id;
const OPTION_LABEL = WITNESS.ids.option_label;
const FACTOR_ID = WITNESS.ids.factor_id;
const FACTOR_LABEL = WITNESS.ids.factor_label;
const SIBLING_OPTION_ID = '862169d7';
const SIBLING_OPTION_LABEL = 'Subcontract inner-city runs to green courier';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const graph = () => clone(WITNESS.draft_graph);

/** The ambiguous-OPTION sentence, resolved by the shipped resolver. */
function ambiguousOptionResolution() {
  const message =
    `Set the ${OPTION_LABEL} option's effect and the ${SIBLING_OPTION_LABEL} option's `
    + `effect on ${FACTOR_LABEL} to 0.4.`;
  const resolution = resolveOptionEffectWrite({ message, graph: graph() });
  if (!resolution.matched || resolution.kind !== 'ask') throw new Error('expected an ask');
  return resolution;
}

/** The ambiguous-FACTOR sentence, resolved by the shipped resolver. */
function ambiguousFactorResolution() {
  const message =
    `Set the ${SIBLING_OPTION_LABEL} option's effect on ${FACTOR_LABEL} and `
    + `Annual clean-air charge burden to 0.4.`;
  const resolution = resolveOptionEffectWrite({ message, graph: graph() });
  if (!resolution.matched || resolution.kind !== 'ask') throw new Error('expected an ask');
  return resolution;
}

describe('the ask copy is shippable', () => {
  it.each([
    ['ambiguous option', ambiguousOptionResolution],
    ['ambiguous factor', ambiguousFactorResolution],
  ])('%s — no forbidden phrase, no internal id', (_name, resolve) => {
    const resolution = resolve();
    const response = composeOptionEffectAskResponse({
      ambiguity: resolution.ambiguity,
      value: resolution.value,
      candidates: resolution.candidates,
      optionLabels: resolution.optionLabels,
      stage: 'frame',
    });
    const surfaces = [
      response.assistant_text,
      ...response.suggested_actions.map((a) => `${a.label} ${a.message ?? ''}`),
    ];
    for (const text of surfaces) {
      expect(findForbiddenPhraseHit(text)).toBeNull();
      expect(text).not.toContain(OPTION_ID);
      expect(text).not.toContain(FACTOR_ID);
      expect(text).not.toContain(SIBLING_OPTION_ID);
    }
  });

  it('positive control — the forbidden-phrase detector CAN fire on this surface', () => {
    // Without this the assertions above would pass on a broken detector
    // (trap 13: an absence assertion needs a proven presence).
    expect(findForbiddenPhraseHit('I recommend the winner here.')).not.toBeNull();
  });

  it('says plainly that nothing was written', () => {
    const resolution = ambiguousOptionResolution();
    const response = composeOptionEffectAskResponse({
      ambiguity: resolution.ambiguity,
      value: resolution.value,
      candidates: resolution.candidates,
      optionLabels: resolution.optionLabels,
      stage: 'frame',
    });
    expect(response.assistant_text).toContain('not changed the model');
    expect(response.assistant_text).toContain(OPTION_LABEL);
    expect(response.assistant_text).toContain(SIBLING_OPTION_LABEL);
    expect(response.assistant_text).toContain('0.4');
  });
});

describe('P8 — every chip has a named, pinned acceptance path', () => {
  it.each([
    ['ambiguous option', ambiguousOptionResolution],
    ['ambiguous factor', ambiguousFactorResolution],
  ])('%s — each chip message resolves to a WRITE for its own candidate', (_name, resolve) => {
    const resolution = resolve();
    const response = composeOptionEffectAskResponse({
      ambiguity: resolution.ambiguity,
      value: resolution.value,
      candidates: resolution.candidates,
      optionLabels: resolution.optionLabels,
      stage: 'frame',
    });
    expect(response.suggested_actions.length).toBeGreaterThan(0);
    expect(response.suggested_actions).toHaveLength(resolution.candidates.length);

    response.suggested_actions.forEach((action, index) => {
      const candidate = resolution.candidates[index]!;
      const replayed = resolveOptionEffectWrite({
        message: action.message ?? '',
        graph: graph(),
      });
      // The chip does not merely "route somewhere" — it resolves to the exact
      // write it advertises, by identity.
      expect(replayed).toEqual({
        matched: true,
        kind: 'write',
        optionId: candidate.optionId,
        optionLabel: candidate.optionLabel,
        factorId: candidate.factorId,
        factorLabel: candidate.factorLabel,
        value: resolution.value,
      });
    });
  });

  it('OPPOSITE-DIRECTION TWIN — the ORIGINAL ambiguous sentence still does not write', () => {
    // If the chip replay resolved to a write only because the resolver claims
    // everything, this twin would fail.
    const resolution = ambiguousOptionResolution();
    expect(resolution.kind).toBe('ask');
  });

  it('offers no chip it cannot complete honestly', () => {
    // A candidate is only emitted when exactly one of that option's linked
    // factors was named; with no complete candidate the copy still asks, and
    // asks in prose rather than shipping a chip that guesses.
    const response = composeOptionEffectAskResponse({
      ambiguity: 'option',
      value: 0.4,
      candidates: [],
      optionLabels: [OPTION_LABEL, SIBLING_OPTION_LABEL],
      stage: 'frame',
    });
    expect(response.suggested_actions).toEqual([]);
    expect(response.assistant_text).toContain('Name the option and the factor');
    expect(findForbiddenPhraseHit(response.assistant_text)).toBeNull();
  });
});
