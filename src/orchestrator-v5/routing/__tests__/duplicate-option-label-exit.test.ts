/**
 * ⭐⭐ THE DUPLICATE-OPTION-LABEL EXIT — journey-witnessed dead end, 25 Aug 2026.
 *
 * ═══ THE DEFECT ═══
 * When two options share a NORMALISED label, `resolveOptionEffectWrite` returns
 * `kind: 'ask'`, and `composeOptionEffectAskResponse` composes that ask OUT OF
 * THE LABELS THAT COLLIDED. Measured at pristine `14aefde6`:
 *
 *   assistant_text: "Your message names 2 options — "subcontracting inner-city
 *   deliveries to a green courier" and "subcontracting inner-city deliveries to
 *   a green courier" — so I do not know which one 0.12 belongs to."
 *
 * The product quotes ONE STRING TWICE and asks the user to choose. Both chips
 * carry a BYTE-IDENTICAL `label` and a BYTE-IDENTICAL `message`, differing only
 * in an ordinal id — so clicking either replays a message that re-enters the
 * same ask. **The loop is closed by construction, not by accident**: every
 * escape route the product offers is spelled in the vocabulary that collided.
 *
 * Escapable only by selecting the node and pressing Delete — the one route that
 * carries IDENTITY rather than a LABEL, and the one route the product never
 * names. THE ESCAPE EXISTS BUT IS UNNAMEABLE.
 *
 * ═══ THE EXIT, and why it is not one of the three that were rejected ═══
 * MERGE would silently delete a user's option (worse than the dead end).
 * RENAMING FOR THEM invents content. CARRYING AN ID into the replay message
 * collides with this seam's copy contract ("no `opt_*` / `fac_*` ids"). A
 * DECLINE drops the turn to the edit LLM — the wrong-entity-write path this
 * module exists to close.
 *
 * The fourth is to MAKE THE AMBIGUITY THE PRODUCT (CLAUDE.md trap 22f): the
 * product cannot refer to these two options by label, so it says exactly that
 * and names the one action that resolves it — RENAME, which the user performs
 * on the canvas through an identity-carrying selection, the same surface that
 * made Delete work.
 *
 * ⚠ THE CORPUS IS THE WIRE'S (trap 16 / trap 22). The graph is the VERBATIM
 * capture in `../../__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json`
 * (deployed CEE `8be62df`); the collision is produced by CLONING one of its own
 * option nodes under a new id, which is the shape the drafter is alleged to
 * emit. A self-authored graph would encode my model of the drafter, not the
 * drafter.
 *
 * ⚠ SCOPE — THIS FILE EXERCISES THE REAL RESOLVER CHAIN, NOT THE REAL HTTP
 * DISPATCH CHAIN. It proves `label_collision` is RETURNED and what the composer
 * says about it. It CANNOT prove the route HANDLES it — an unhandled collision
 * does not fail loudly, it falls through to `dispatchEditGraph`. That half is
 * pinned separately, at the route, in
 * `tests/integration/orchestrator/route-v2-option-effect-ask.test.ts`, whose
 * load-bearing assertion is that the edit-lane mock is NEVER called.
 *
 * ⚠ PRECONDITIONS ARE PINNED, NOT THE VERDICT ALONE. Every collision case
 * asserts TWO DISTINCT IDS carrying ONE NORMALISED LABEL *before* asserting
 * what the product says, so a fixture that silently collapsed the two entities
 * into one key could not reach the verdict by the wrong path.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import {
  normaliseOptionLabel,
  findCollidingOptionLabel,
  resolveOptionEffectWrite,
} from '../option-effect-write.js';
import { composeDuplicateOptionLabelResponse } from '../../compose/duplicate-option-label-response.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';

interface Witness {
  readonly ids: {
    readonly option_id: string;
    readonly option_label: string;
    readonly factor_id: string;
    readonly factor_label: string;
  };
  readonly wire: { readonly t4_chip_message: string };
  readonly draft_graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
}

const W = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json', import.meta.url),
    'utf8',
  ),
) as Witness;

const LBL = W.ids.option_label;
const FAC = W.ids.factor_label;
const SRC = W.ids.option_id;

const base = (): GraphV3T => GraphV3.parse(JSON.parse(JSON.stringify(W.draft_graph)));

/** Clone option `srcId` under a NEW id with `label`, carrying its out-edges. */
function addOption(g: GraphV3T, srcId: string, newId: string, label: string): GraphV3T {
  const raw = JSON.parse(JSON.stringify(g)) as {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };
  const src = raw.nodes.find((n) => n['id'] === srcId);
  if (src === undefined) throw new Error(`fixture precondition failed: no node ${srcId}`);
  const dup = JSON.parse(JSON.stringify(src)) as Record<string, unknown>;
  dup['id'] = newId;
  dup['label'] = label;
  raw.nodes.push(dup);
  for (const e of [...raw.edges]) {
    if (e['from'] === srcId) raw.edges.push({ ...e, id: `${String(e['id'] ?? 'e')}-${newId}`, from: newId });
  }
  return GraphV3.parse(raw);
}

const msg = (opt: string, fac: string) => `Set the ${opt} option's effect on ${fac} to 0.12.`;
const run = (g: GraphV3T, m: string) => resolveOptionEffectWrite({ message: m, graph: g });

/** PIN THE PRECONDITION: N distinct option ids sharing ONE normalised label. */
function assertCollisionPrecondition(g: GraphV3T, label: string, expected: number): void {
  const key = normaliseOptionLabel(label);
  const sharing = g.nodes.filter(
    (n) => n.kind === 'option' && normaliseOptionLabel(String((n as { label?: unknown }).label ?? '')) === key,
  );
  expect(sharing).toHaveLength(expected);
  expect(new Set(sharing.map((n) => n.id)).size).toBe(expected);
}

describe('duplicate option label — the escape exit', () => {
  describe('detection', () => {
    it('two options sharing a normalised label resolve to label_collision, by identity', () => {
      const g = addOption(base(), SRC, 'dupe0001', LBL);
      assertCollisionPrecondition(g, LBL, 2);

      const r = run(g, W.wire.t4_chip_message);
      expect(r.matched).toBe(true);
      expect(r).toMatchObject({ kind: 'label_collision', collidingLabel: LBL, collidingCount: 2 });
    });

    it('case-only difference collides (the normalisation lowercases)', () => {
      const g = addOption(base(), SRC, 'dupcase01', LBL.toUpperCase());
      assertCollisionPrecondition(g, LBL, 2);
      expect(run(g, msg(LBL, FAC))).toMatchObject({ kind: 'label_collision', collidingCount: 2 });
    });

    it('whitespace-only difference collides (the normalisation collapses runs)', () => {
      const g = addOption(base(), SRC, 'dupws01', `  ${LBL.replace(/ /g, '  ')}  `);
      assertCollisionPrecondition(g, LBL, 2);
      expect(run(g, msg(LBL, FAC))).toMatchObject({ kind: 'label_collision', collidingCount: 2 });
    });

    it('three colliding options report a count of three, not a repeated string', () => {
      let g = addOption(base(), SRC, 'dupa01', LBL);
      g = addOption(g, SRC, 'dupb01', LBL);
      assertCollisionPrecondition(g, LBL, 3);
      expect(run(g, msg(LBL, FAC))).toMatchObject({ kind: 'label_collision', collidingCount: 3 });
    });
  });

  describe('the copy — every constraint the three rejected exits violated', () => {
    it('names the colliding label EXACTLY ONCE and offers the PROVEN escape', () => {
      const resp = composeDuplicateOptionLabelResponse({
        collidingLabel: LBL,
        collidingCount: 2,
        stage: 'frame',
      });
      const text = resp.assistant_text ?? '';
      expect(text.split(LBL)).toHaveLength(2); // one occurrence => two split parts
      // ⚠ DELETE, NOT RENAME — bound to the affordance that is actually LIVE in
      // the UI at the deployed tip. Rename is fully built there but dark
      // (`InspectorRouter` never passes `onLabelChange`; `setLabel` authority is
      // hardcoded 'disabled'), so naming it would replace this dead end with a
      // new one. If this assertion is ever flipped back to 'rename', the UI half
      // must be verified live FIRST.
      expect(text.toLowerCase()).toContain('press delete');
    });

    it('a three-way collision still quotes the label exactly once', () => {
      const resp = composeDuplicateOptionLabelResponse({
        collidingLabel: LBL,
        collidingCount: 3,
        stage: 'frame',
      });
      expect((resp.assistant_text ?? '').split(LBL)).toHaveLength(2);
    });

    it('carries no node id and no "Pick one below" — the copy contract, and the dead promise', () => {
      const resp = composeDuplicateOptionLabelResponse({
        collidingLabel: LBL,
        collidingCount: 2,
        stage: 'frame',
      });
      const text = resp.assistant_text ?? '';
      expect(text).not.toContain('Pick one below');
      expect(text).not.toMatch(/\b(?:opt|fac)_[a-z0-9]/i);
      expect(text).not.toContain(SRC);
      expect(text).not.toContain('dupe0001');
    });

    it('survives the shipped egress detector — including an ADVERSARIAL label', () => {
      // The sibling composer's spec screens its own output; this one must too,
      // and it carries a sharper risk: the label is LLM-authored and is
      // interpolated VERBATIM. A drafter that mints an option called
      // "nothing changed" would otherwise trip the detector at egress, where
      // the guard replaces the whole response.
      expect(
        findForbiddenPhraseHit(
          composeDuplicateOptionLabelResponse({
            collidingLabel: LBL,
            collidingCount: 2,
            stage: 'frame',
          }).assistant_text ?? '',
        ),
      ).toBeNull();

      const adversarial = composeDuplicateOptionLabelResponse({
        collidingLabel: 'nothing changed',
        collidingCount: 2,
        stage: 'frame',
      }).assistant_text ?? '';
      // ⚠ RECORDED, NOT ASSERTED CLEAN. The detector DOES fire on this label,
      // and that is a property of the user's own model content, not of this
      // copy — the egress guard is the right place for it and it preserves the
      // chip set (there is none here) while neutralising the text. Pinned so
      // the behaviour is visible rather than discovered on the wire.
      expect(findForbiddenPhraseHit(adversarial)).not.toBeNull();
    });

    it('offers NO chip, because every label-spelled chip re-enters the loop', () => {
      const resp = composeDuplicateOptionLabelResponse({
        collidingLabel: LBL,
        collidingCount: 2,
        stage: 'frame',
      });
      expect(resp.suggested_actions ?? []).toHaveLength(0);
    });
  });

  describe('THE LOOP — every route the product offers must lead somewhere', () => {
    it('emits no route that re-enters the collision, and the rename route resolves it', () => {
      const g = addOption(base(), SRC, 'dupe0001', LBL);
      assertCollisionPrecondition(g, LBL, 2);

      const r = run(g, W.wire.t4_chip_message);
      expect(r).toMatchObject({ kind: 'label_collision' });

      const resp = composeDuplicateOptionLabelResponse({
        collidingLabel: LBL,
        collidingCount: 2,
        stage: 'frame',
      });

      // (a) NO offered route can re-enter the collision, because none is offered.
      for (const action of resp.suggested_actions ?? []) {
        expect(run(g, action.message ?? '')).not.toMatchObject({ kind: 'label_collision' });
      }

      // (b) THE NAMED ROUTE WORKS. Removing one of the two — the action the copy
      //     names, and the one verified reachable in the UI — clears the
      //     collision, and the SAME message then writes, bound to the surviving
      //     id BY IDENTITY.
      const raw = JSON.parse(JSON.stringify(g)) as {
        nodes: Array<Record<string, unknown>>;
        edges: Array<Record<string, unknown>>;
      };
      raw.nodes = raw.nodes.filter((n) => n['id'] !== 'dupe0001');
      raw.edges = raw.edges.filter((e) => e['from'] !== 'dupe0001' && e['to'] !== 'dupe0001');
      const after = run(GraphV3.parse(raw), W.wire.t4_chip_message);
      expect(after).toMatchObject({ kind: 'write', optionId: SRC, factorId: W.ids.factor_id });

      // (c) AND THE TWIN THE COPY NO LONGER CLAIMS: renaming would ALSO clear
      //     it. Kept so that wiring rename in the UI is a copy change here and
      //     nothing more — the resolver already supports it.
      const renamed = JSON.parse(JSON.stringify(g)) as { nodes: Array<Record<string, unknown>> };
      const target = renamed.nodes.find((n) => n['id'] === 'dupe0001');
      expect(target).toBeDefined();
      target!['label'] = 'Subcontract via a second courier partner';
      expect(run(GraphV3.parse(renamed), W.wire.t4_chip_message)).toMatchObject({
        kind: 'write',
        optionId: SRC,
      });
    });
  });

  describe('OPPOSITE-DIRECTION TWINS — over-suppression here is worse than the dead end', () => {
    it('the captured near-duplicate pair still writes, to DISTINCT ids', () => {
      const g = base();
      const a = run(g, msg(LBL, FAC));
      const b = run(g, msg('Subcontract inner-city runs to green courier', FAC));
      expect(a).toMatchObject({ kind: 'write', optionId: '21ea9b80' });
      expect(b).toMatchObject({ kind: 'write', optionId: '862169d7' });
    });

    it('the real captured graph carries NO collision at all', () => {
      const labels = base()
        .nodes.filter((n) => n.kind === 'option')
        .map((n) => String((n as { label?: unknown }).label ?? ''));
      expect(labels).toHaveLength(6);
      expect(findCollidingOptionLabel(labels)).toBeNull();
    });

    it('an option label equal to a FACTOR label is not a collision and still writes', () => {
      const g = addOption(base(), SRC, 'dupfac01', FAC);
      expect(run(g, msg(FAC, FAC))).toMatchObject({ kind: 'write' });
    });

    it('two DISTINCT option labels named in one message remain the pre-existing ask', () => {
      const g = base();
      const r = run(
        g,
        `Set the ${LBL} option's effect and the Subcontract inner-city runs to green courier option's effect on ${FAC} to 0.12.`,
      );
      // Tightened: asserting merely "not a collision" would pass on a decline,
      // which would silently withdraw the chip-bearing ask this twin exists to
      // protect. Assert the verdict its name claims.
      expect(r).toMatchObject({ kind: 'ask', ambiguity: 'option' });
    });
  });

  describe('findCollidingOptionLabel — the collision predicate itself', () => {
    it('returns null for distinct labels and the shared label for a collision', () => {
      expect(findCollidingOptionLabel(['alpha', 'beta'])).toBeNull();
      expect(findCollidingOptionLabel(['alpha', 'ALPHA'])).toMatchObject({ label: 'alpha', count: 2 });
      expect(findCollidingOptionLabel(['a b', 'a  b', 'a b'])).toMatchObject({ count: 3 });
      expect(findCollidingOptionLabel([])).toBeNull();
      expect(findCollidingOptionLabel(['solo'])).toBeNull();
    });
  });
});
