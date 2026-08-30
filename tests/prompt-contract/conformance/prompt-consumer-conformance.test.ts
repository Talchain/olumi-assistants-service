/**
 * PROMPT -> CONSUMER CONFORMANCE GATE
 * ===================================
 *
 * Per live route: the shape the SERVED PROMPT instructs must be a shape the
 * CONSUMER accepts.
 *
 * THE DEFECT CLASS. A served routing prompt once forbade the exact
 * representation the value binder required -- the product was instructed never
 * to say the one thing it could hear, and recovery measured 0 of 13. Nothing
 * could see it: prompts and consumers had never been checked against each other
 * in this direction. `prompt-pack-sanction.gate.test.ts` checks the INPUT
 * direction on one route. This checks the OUTPUT direction on every live route.
 *
 * WHAT IS DERIVED, AND FROM WHAT
 *   - the ROUTE UNIVERSE from `deriveLiveEstate()`, which computes
 *     `resolvable \ gated \ retired` from `OPERATION_TO_TASK_ID` -- a map no
 *     prompt can bypass, so a newly-wired prompt appears without being named;
 *   - the ACCEPTED SHAPE from the grammar OBJECT production attaches, rebuilt
 *     at assertion time through a thunk, never transcribed;
 *   - the INSTRUCTED SHAPE extracted from the served prompt BYTES;
 *   - enum vocabulary lists recognised by MAJORITY MEMBERSHIP in the enum, so
 *     no rule here names a section of any prompt.
 *
 * WHERE IT CANNOT DERIVE, IT FAILS LOUD. The prompt->grammar pairing exists
 * only inside adapter call sites and cannot be read off anything, so it is
 * hand-written in `routes.ts` -- and the union of mapped and unmapped routes is
 * asserted EQUAL to the live estate. An unclassified route REDs; it is never
 * skipped.
 *
 * CONTROLS, because a green gate is a claim about an instrument:
 *   - POSITIVE per discriminator, against artefacts FROZEN BY HASH -- never
 *     against "whatever is served now", which decays into a tautology the first
 *     time now changes (the prompt-drift gate's controls were hollowed out
 *     exactly that way by a v119->v120 re-pin);
 *   - CONTRAST in the same run: a route that must read ZERO on a discriminator
 *     that another route fires on, so a blanket-failing detector is
 *     distinguishable from a discriminating one;
 *   - NON-EMPTY preconditions, in the checker itself: a probe that extracted
 *     nothing agrees with every other probe that extracted nothing.
 *
 * SCOPE, stated so it cannot be over-read: this tier reads the EXPORTED SERVED
 * BYTES in `Prompts/canonical/`, identity-pinned by sha256 against the
 * manifest. The PMS can be re-pinned with NO deploy, so the pin is necessary
 * and not sufficient; `scripts/verify-served-prompt-conformance.ts`
 * (`pnpm verify:served-conformance`) points the SAME pure checker at the live
 * `/admin/prompts/status` bytes. STATUS-LADDER RUNG of every
 * claim below: DERIVED-AT-THE-PINNED-BYTES. Not wire-witnessed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { deriveLiveEstate } from '../../../src/prompts/estate.js';
import {
  MAPPED_ROUTES,
  UNMAPPED_ROUTES,
  readPinnedCanonical,
  sha256,
  REPO_ROOT,
  MANIFEST_PATH,
} from './routes.js';
import {
  checkRoute,
  checkExampleConformance,
  checkEnumVocabulary,
  checkRequiredKeyCoverage,
  declaredObjectNodes,
  declaredStringEnums,
  nodeAccepts,
  type Violation,
} from './checker.js';
import { WAIVERS, activeWaivers } from './waivers.js';

const FIXTURES = join(REPO_ROOT, 'tests/prompt-contract/conformance/fixtures');

/** Historical artefacts, FROZEN. Pinned by hash so no live change can hollow them. */
const HISTORICAL = {
  draftGraphV195: {
    path: join(FIXTURES, 'historical/draft_graph.v195.txt'),
    sha256: '152998b447819c2e9e797b1727f8e05b34480486dca6f672a5d2839facd2353f',
  },
  routingV121: {
    path: join(FIXTURES, 'historical/routing.v121.txt'),
    sha256: 'bec840a6488009284f4bf3c5a6b5ebe604a96ab973946911fec8639af182d949',
  },
} as const;

function readFrozen(f: { path: string; sha256: string }): string {
  const text = readFileSync(f.path, 'utf8');
  const got = sha256(text);
  if (got !== f.sha256) {
    throw new Error(
      `FROZEN FIXTURE MUTATED: ${f.path}\n` +
        `  expected ${f.sha256}\n  got      ${got}\n` +
        `These are the bytes a dated build actually served. They are a RECORD, not a fixture ` +
        `to keep current: append to this directory, never edit it. If the divergence they ` +
        `demonstrate is genuinely gone, that is a finding to report, not an edit to make.`,
    );
  }
  return text;
}

function unwaived(route: string, promptSha: string, found: Violation[]): Violation[] {
  const ids = new Set(activeWaivers(route, promptSha).map((w) => w.id));
  return found.filter((v) => !ids.has(v.id));
}

// ===========================================================================
// 0. THE MIRROR CANNOT DRIFT
// ===========================================================================

describe('route table: the one hand-written mirror, and it fails loud', () => {
  it('MAPPED ∪ UNMAPPED === deriveLiveEstate().live, exactly', () => {
    const live = [...deriveLiveEstate().live].sort();
    const classified = [
      ...MAPPED_ROUTES.map((r) => r.route),
      ...UNMAPPED_ROUTES.map((r) => r.route),
    ].sort();

    expect(
      classified,
      'A live prompt is unclassified, or a classified route is no longer live.\n' +
        'This gate cannot derive which grammar judges which prompt -- that association exists\n' +
        'only inside adapter call sites -- so the pairing is hand-written in routes.ts and this\n' +
        'assertion is what stops it rotting. Classify the route as MAPPED (naming its attach\n' +
        'site) or UNMAPPED (stating why no model-facing schema adjudicates it). Do not delete\n' +
        'this assertion to get to green.',
    ).toEqual(live);
  });

  it('no route is classified twice', () => {
    const all = [...MAPPED_ROUTES.map((r) => r.route), ...UNMAPPED_ROUTES.map((r) => r.route)];
    expect(new Set(all).size).toBe(all.length);
  });

  it('every unmapped route states WHY and HOW that was established', () => {
    for (const u of UNMAPPED_ROUTES) {
      expect(u.reason.length, `${u.route}: reason is not a reason`).toBeGreaterThan(60);
      expect(u.derivedFrom.length, `${u.route}: no derivation recorded`).toBeGreaterThan(30);
    }
  });

  it('every mapped route names the attach site its pairing rests on', () => {
    for (const r of MAPPED_ROUTES) {
      expect(r.attachSite, `${r.route}`).toMatch(/\.ts/);
    }
  });
});

// ===========================================================================
// 1. IDENTITY: the bytes judged are the bytes attested
// ===========================================================================

describe('served-prompt identity pin (match by HASH, never by filename)', () => {
  it.each(MAPPED_ROUTES.map((r) => [r.route, r] as const))(
    '%s: canonical file sha256 === manifest sha256',
    (route, r) => {
      const p = readPinnedCanonical(r);
      expect(
        p.fileSha,
        `${route}: the file at ${r.canonicalFile} is NOT the digest the manifest attests as ` +
          `served (v${p.servedVersion}). Every conformance verdict below would be about bytes ` +
          `nobody serves.`,
      ).toBe(p.manifestSha);
    },
  );

  it('every waiver is keyed to a sha the manifest actually attests', () => {
    // Without this, a waiver keyed to a mistyped or invented sha would simply
    // never match, and the gate would report the divergence as unwaived --
    // noisy but safe. The dangerous inverse is a waiver keyed to a sha that is
    // real but belongs to a DIFFERENT route, which this also catches.
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      pms_prompts: Array<{ key: string; sha256: string }>;
    };
    for (const w of WAIVERS) {
      const row = manifest.pms_prompts.find((p) => p.key === w.route);
      expect(row, `waiver for unknown route ${w.route}`).toBeDefined();
      expect(
        w.promptSha256,
        `waiver ${w.route}/${w.id} is keyed to a sha that is not ${w.route}'s attested digest`,
      ).toBe(row!.sha256);
    }
  });
});

// ===========================================================================
// 2. THE GATE
// ===========================================================================

describe('prompt instructs only what the consumer accepts', () => {
  it.each(MAPPED_ROUTES.map((r) => [r.route, r] as const))(
    '%s: no unwaived divergence between served prompt and attached grammar',
    (route, r) => {
      const p = readPinnedCanonical(r);
      const found = checkRoute({
        route,
        promptText: p.text,
        grammar: r.grammar(),
        additionalText: r.additionalText?.(),
      });
      const open = unwaived(route, p.fileSha, found);

      expect(
        open.map((v) => `[${v.kind}] ${v.detail} (@${v.offset})`),
        `${route} v${p.servedVersion}: the served prompt instructs a shape the consumer rejects.\n` +
          `Attached grammar: ${r.attachSite}\n` +
          `Either fix the prompt, or triage the divergence and add a hash-keyed waiver in ` +
          `waivers.ts stating the derivation.`,
      ).toEqual([]);
    },
  );

  it('NO STALE WAIVERS — every waiver still describes a live divergence', () => {
    // The other direction of trap 12: a waiver that outlives its defect teaches
    // the next reader that a fixed thing is still broken, and quietly licenses
    // the divergence if it ever returns.
    const stale: string[] = [];
    for (const r of MAPPED_ROUTES) {
      const p = readPinnedCanonical(r);
      const foundIds = new Set(
        checkRoute({
          route: r.route,
          promptText: p.text,
          grammar: r.grammar(),
          additionalText: r.additionalText?.(),
        }).map((v) => v.id),
      );
      for (const w of activeWaivers(r.route, p.fileSha)) {
        if (!foundIds.has(w.id)) stale.push(`${w.route}/${w.id}`);
      }
    }
    expect(stale, 'waiver no longer needed — remove it').toEqual([]);
  });
});

// ===========================================================================
// 3. POSITIVE CONTROLS — prove each discriminator CAN fail
// ===========================================================================

describe('POSITIVE CONTROL: the gate REDs on a prompt whose shape the consumer rejects', () => {
  /**
   * The requirement in full: "It must FAIL if a prompt is promoted whose
   * instructed shape the consumer rejects. Prove that by writing exactly such a
   * prompt as a fixture and showing the test goes RED."
   *
   * So this runs the REAL gate path -- `checkRoute` with the REAL
   * `buildDraftRecordsSchema()` -- over a candidate promotion, rather than a
   * lookalike assertion. A control that exercises a different path than the one
   * it names is a guard agreeing with itself.
   */
  const candidate = readFileSync(
    join(FIXTURES, 'violating/draft_graph.rejected-promotion.txt'),
    'utf8',
  );
  const draftRoute = MAPPED_ROUTES.find((r) => r.route === 'draft_graph')!;

  it('the fixture is a plausible promotion, not a strawman', () => {
    // If the control fixture could not pass for a real prompt, it proves the
    // gate catches nonsense and nothing about the defect class.
    expect(candidate.length).toBeGreaterThan(1500);
    expect(candidate).toContain('<OUTPUT_SCHEMA>');
    expect(candidate).toContain('<ROLE>');
  });

  it('RED: the gate reports the divergence, naming the unemittable keys', () => {
    const found = checkRoute({
      route: 'draft_graph',
      promptText: candidate,
      grammar: draftRoute.grammar(),
      additionalText: draftRoute.additionalText?.(),
    });
    const examples = found.filter((v) => v.kind === 'unacceptable_example');
    expect(examples.length, 'the gate did not fire on a prompt the grammar rejects').toBeGreaterThan(
      0,
    );
    expect(found.map((v) => v.detail).join('\n')).toMatch(/nodes,edges,coaching|no node of the consumer grammar accepts it/);
  });

  it('RED: and the gate ASSERTION itself fails, not merely the helper', () => {
    // Runs the same expectation the gate runs, and asserts it throws. Without
    // this, a refactor could leave `checkRoute` finding violations while the
    // gate stopped asserting on them, and every test above would stay green.
    const found = checkRoute({
      route: 'draft_graph',
      promptText: candidate,
      grammar: draftRoute.grammar(),
      additionalText: draftRoute.additionalText?.(),
    });
    const open = unwaived('draft_graph', 'sha-of-a-prompt-never-ratified', found);
    expect(() => expect(open.map((v) => v.id)).toEqual([])).toThrow();
  });

  it('DISCRIMINATING PAIR: a CONFORMING promotion of the same route passes', () => {
    /**
     * The other half of the pair, and the half that makes this gate usable
     * rather than merely loud. A detector that REDs on every new draft_graph
     * prompt would block the fix as readily as the defect, and no single
     * failing mutant can tell those apart -- only the RED/GREEN pair can.
     *
     * This fixture is what the open draft_graph divergence looks like FIXED:
     * the output contract is the records shape (`stated_items` / `claims`,
     * with the reference fields the grammar declares), so the gate must accept
     * it against the same real `buildDraftRecordsSchema()` that rejects its
     * twin above.
     */
    const conforming = readFileSync(
      join(FIXTURES, 'violating/draft_graph.conforming-promotion.txt'),
      'utf8',
    );
    const found = checkRoute({
      route: 'draft_graph',
      promptText: conforming,
      grammar: draftRoute.grammar(),
      additionalText: draftRoute.additionalText?.(),
    });
    expect(
      found.map((v) => `[${v.kind}] ${v.detail}`),
      'the gate rejects a promotion that conforms to the attached grammar — it is blanket-failing, ' +
        'not adjudicating, and would block the fix as readily as the defect',
    ).toEqual([]);
  });

  it('CONTRAST: the same fixture passes a grammar that DOES accept its shape', () => {
    // Proves the detector discriminates on the GRAMMAR, not on the fixture
    // being unusual. The permissive schema accepts anything, so a detector that
    // fired here would be blanket-failing rather than adjudicating.
    const permissive = { type: 'object', properties: {}, additionalProperties: true };
    expect(checkExampleConformance(candidate, permissive)).toEqual([]);
  });
});

describe('POSITIVE CONTROL: each discriminator, against FROZEN historical bytes', () => {
  // Pinned to artefacts by hash, permanently. When draft_graph is re-promoted
  // and the live divergence disappears, these controls must keep firing --
  // that is the whole point of freezing them (a control pinned to "current"
  // stops testing anything the moment current changes).

  it('C1 example conformance: draft_graph v195 fires, and names the graph shape', () => {
    const v = checkExampleConformance(
      readFrozen(HISTORICAL.draftGraphV195),
      MAPPED_ROUTES.find((r) => r.route === 'draft_graph')!.grammar(),
    );
    expect(v.length, 'C1 has stopped detecting the v195 divergence').toBe(11);
    expect(v.map((x) => x.id)).toContain(
      'unacceptable_example:nodes,edges,goal_constraints,causal_claims,coaching',
    );
  });

  it('C1 CONTRAST: routing v121 fires ZERO on the same discriminator, same run', () => {
    // routing carries no JSON examples at all. A detector that reported
    // violations here would be blanket-failing; one that reports zero here and
    // eleven above is discriminating. Sameness across inputs that ought to
    // differ is evidence about the instrument, not about the world.
    const v = checkExampleConformance(
      readFrozen(HISTORICAL.routingV121),
      (MAPPED_ROUTES.find((r) => r.route === 'routing')!.grammar()),
    );
    expect(v).toEqual([]);
  });

  it('C2 enum vocabulary: routing v121 fires on both strays', () => {
    const v = checkEnumVocabulary(
      readFrozen(HISTORICAL.routingV121),
      MAPPED_ROUTES.find((r) => r.route === 'routing')!.grammar(),
    );
    expect(v.map((x) => x.id).sort()).toEqual([
      'enum_stray:handler_id:draft_graph',
      'enum_stray:handler_id:edit_graph',
    ]);
  });

  it('C2 CONTRAST: draft_graph v195 fires ZERO on the enum discriminator', () => {
    const v = checkEnumVocabulary(
      readFrozen(HISTORICAL.draftGraphV195),
      MAPPED_ROUTES.find((r) => r.route === 'draft_graph')!.grammar(),
    );
    expect(v).toEqual([]);
  });

  it('C2 recognises an enum list only by MAJORITY MEMBERSHIP, not by section name', () => {
    const grammar = {
      type: 'object',
      properties: { op: { type: 'string', enum: ['alpha', 'beta', 'gamma'] } },
      additionalProperties: false,
    };
    const majority = '- alpha: does a thing\n- beta: does another\n- delta: not in the enum\n';
    expect(checkEnumVocabulary(majority, grammar).map((v) => v.id)).toEqual([
      'enum_stray:op:delta',
    ]);
    // An unrelated bullet list must be ignored entirely, or every prose list in
    // every prompt becomes a false positive.
    const unrelated = '- shipping: costs money\n- storage: costs money\n- staffing: costs money\n';
    expect(checkEnumVocabulary(unrelated, grammar)).toEqual([]);
  });

  it('C3 required-key coverage fires when a required key is named nowhere', () => {
    const grammar = {
      type: 'object',
      properties: { stated_items: { type: 'array' }, claims: { type: 'array' } },
      required: ['stated_items', 'claims'],
      additionalProperties: false,
    };
    expect(checkRequiredKeyCoverage('emit some claims please', grammar).map((v) => v.id)).toEqual([
      'unnamed_required_key:stated_items',
    ]);
  });

  it('C3 counts a declared SECOND system block as naming the key', () => {
    // draft_graph's required keys reach the model only through
    // DRAFT_RECORDS_INSTRUCTION, appended after the cache breakpoint. Ignoring
    // that would manufacture a false violation on every draft turn.
    const grammar = {
      type: 'object',
      properties: { stated_items: { type: 'array' } },
      required: ['stated_items'],
      additionalProperties: false,
    };
    expect(checkRequiredKeyCoverage('nothing here', grammar).length).toBe(1);
    expect(checkRequiredKeyCoverage('nothing here', grammar, 'emit stated_items[]')).toEqual([]);
  });
});

// ===========================================================================
// 4. THE INSTRUMENT ITSELF
// ===========================================================================

describe('every discriminator is WIRED INTO the gate path, not merely present', () => {
  /**
   * FOUND BY MUTATION, and it had already shipped inside this file: deleting
   * `checkRequiredKeyCoverage` from `checkRoute` left all 31 tests GREEN.
   * C3 was exercised only by its own unit controls, so the gate would have gone
   * on reporting conformance with a third of its predicate silently unwired.
   *
   * The cause is that no live route currently HAS an unnamed required key, so
   * C3 contributes zero on every real route and its absence is invisible to
   * every route-level assertion. Presence of a control is not coverage of the
   * branch; a discriminator must pin its own precondition.
   *
   * Each case below feeds `checkRoute` -- the real gate entry point -- an input
   * that ONLY that discriminator can catch, so removing any one of the three
   * turns exactly one of these RED.
   */
  const grammar = {
    type: 'object',
    properties: {
      stated_items: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['goal', 'option'] } }, additionalProperties: false } },
      claims: { type: 'array' },
    },
    required: ['stated_items', 'claims'],
    additionalProperties: false,
  };
  const filler = 'Prose that carries no JSON and no bullet list. '.repeat(40);

  it('C1 (example conformance) reaches checkRoute', () => {
    const text = `${filler}\nEmit: {"nodes": [{"id": "a"}], "claims": []}\nclaims stated_items`;
    const kinds = checkRoute({ route: 't', promptText: text, grammar }).map((v) => v.kind);
    expect(kinds, 'checkExampleConformance is no longer wired into checkRoute').toContain(
      'unacceptable_example',
    );
  });

  it('C2 (enum vocabulary) reaches checkRoute', () => {
    const text = `${filler}\n- goal: a target\n- option: a choice\n- wildcard: not in the enum\nclaims stated_items`;
    const kinds = checkRoute({ route: 't', promptText: text, grammar }).map((v) => v.kind);
    expect(kinds, 'checkEnumVocabulary is no longer wired into checkRoute').toContain('enum_stray');
  });

  it('C3 (required-key coverage) reaches checkRoute', () => {
    const text = `${filler}\nMention claims only, never the other required key.`;
    const found = checkRoute({ route: 't', promptText: text, grammar });
    expect(
      found.map((v) => v.id),
      'checkRequiredKeyCoverage is no longer wired into checkRoute — the gate would report ' +
        'conformance with a third of its predicate silently unwired',
    ).toContain('unnamed_required_key:stated_items');
  });
});

describe('the checker cannot pass by seeing nothing', () => {
  it('refuses a prompt too short to be a real one', () => {
    expect(() =>
      checkRoute({ route: 'x', promptText: 'tiny', grammar: { properties: { a: {} } } }),
    ).toThrow(/refusing to report conformance/);
  });

  it('refuses a grammar that declares no object node', () => {
    expect(() =>
      checkRoute({ route: 'x', promptText: 'y'.repeat(2000), grammar: { type: 'string' } }),
    ).toThrow(/nothing to conform TO/);
  });

  it('a free-form object slot is NOT counted as an accepting node', () => {
    // Otherwise edit_graph's stringified `operations[].value` would make the
    // whole route vacuously green -- a guard agreeing with itself.
    expect(declaredObjectNodes({ type: 'object' })).toEqual([]);
    expect(declaredObjectNodes({ type: 'object', properties: { a: { type: 'string' } } })).toHaveLength(
      1,
    );
  });

  it('nodeAccepts closes the world only where the schema says so', () => {
    const closed = { type: 'object', properties: { a: {} }, additionalProperties: false };
    const open = { type: 'object', properties: { a: {} } };
    expect(nodeAccepts({ a: 1, b: 2 }, closed)).toBe(false);
    expect(nodeAccepts({ a: 1, b: 2 }, open)).toBe(true);
    expect(nodeAccepts({ a: 1 }, closed)).toBe(true);
  });

  it('nodeAccepts rejects an out-of-enum value', () => {
    const s = {
      type: 'object',
      properties: { k: { type: 'string', enum: ['x', 'y'] } },
      additionalProperties: false,
    };
    expect(nodeAccepts({ k: 'x' }, s)).toBe(true);
    expect(nodeAccepts({ k: 'z' }, s)).toBe(false);
  });

  it('the real grammars expose what the discriminators need', () => {
    // A grammar that stopped declaring enums or object nodes would silently
    // hollow C1/C2 out; this notices before the gate reports a green.
    const draft = MAPPED_ROUTES.find((r) => r.route === 'draft_graph')!.grammar();
    const routing = MAPPED_ROUTES.find((r) => r.route === 'routing')!.grammar();
    expect(declaredObjectNodes(draft).length).toBeGreaterThan(0);
    expect(declaredStringEnums(routing).length).toBeGreaterThan(0);
    expect(
      declaredStringEnums(routing).some((e) => e.field === 'handler_id'),
      'routing grammar no longer declares handler_id as a string enum — C2 is now blind on this route',
    ).toBe(true);
  });
});
