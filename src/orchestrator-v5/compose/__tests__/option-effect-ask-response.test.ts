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
import { describe,expect,it } from 'vitest';


import { resolveOptionEffectWrite } from '../../routing/option-effect-write.js';
import { findForbiddenPhraseHit } from '../forbidden-user-facing-phrases.js';

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


const OPTION_LABEL = WITNESS.ids.option_label;

const FACTOR_LABEL = WITNESS.ids.factor_label;

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


describe('the ask copy is shippable', () => {


  it('positive control — the forbidden-phrase detector CAN fire on this surface', () => {
    // Without this the assertions above would pass on a broken detector
    // (trap 13: an absence assertion needs a proven presence).
    expect(findForbiddenPhraseHit('I recommend the winner here.')).not.toBeNull();
  });


});

describe('P8 — every chip has a named, pinned acceptance path', () => {


  it('OPPOSITE-DIRECTION TWIN — the ORIGINAL ambiguous sentence still does not write', () => {
    // If the chip replay resolved to a write only because the resolver claims
    // everything, this twin would fail.
    const resolution = ambiguousOptionResolution();
    expect(resolution.kind).toBe('ask');
  });




});

// ═══════════════════════════════════════════════════════════════════════════
// W5 — THE `outstanding_ask` OPENING (rule 3b).
//
// Rule 3b's candidates come from the product's own outstanding ask on a
// message that named NO option. Reusing the pre-existing sentence — "Your
// message names 2 options" — would be a fabricated claim about the user's own
// words (P5), inside the copy written to stop the product guessing. The
// discriminator below is a PAIR: the same value, the same factor, two
// different `optionSource`s, and the two openings must differ in exactly that
// claim.
// ═══════════════════════════════════════════════════════════════════════════





/** Rule 3b's ask, produced by the SHIPPED resolver — not a hand-built input. */
