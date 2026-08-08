/**
 * ROADMAP 2.855 — THE NEGATIVE HALF of the `value_frame` chain: the producers
 * that deliberately stamp NOTHING, plus a completeness guard over the stamp
 * SITES themselves.
 *
 * WHY THIS FILE EXISTS AT ALL. `constraint-value-frame-stamp.test.ts` cited
 * this filename before the file existed (found by the adversarial review of
 * PR #862, 2026-08-07). The three deliberate non-stamps were therefore
 * UNGUARDED, and a blanket default — by a wide margin the most likely
 * "tidy-up" against a field that is present on most rows — would have reddened
 * nothing anywhere in the repo. `@talchain/schemas` 0.38.0 names that exact
 * harm on the field itself: *"Absence means UNATTESTED ... MUST NOT default
 * this field — a defaulted frame is a manufactured attestation."*
 *
 * TWO KINDS OF GUARD, DELIBERATELY BOTH (trap 12d — a derived guard proves
 * agreement and can never prove completeness):
 *   - DERIVED, over the real `src/` tree: which files stamp a literal frame at
 *     all. A NEW stamp site anywhere reddens here, including one this file's
 *     author never imagined. That is the completeness half.
 *   - BEHAVIOURAL, at each non-stamping producer's own validator: the schema
 *     that producer actually parses through must not inject a frame. That is
 *     the "does the guard bite where it matters" half.
 * Neither supersedes the other and dropping either reopens a class.
 *
 * EVERY ABSENCE ASSERTION HERE PINS ITS OWN PRECONDITION IN-TEST (trap 13b).
 * An absence test is vacuous unless it can first demonstrate a PRESENCE: a
 * schema that stripped `value_frame` unconditionally, or a walker that matched
 * nothing, would satisfy a naive "no frame appeared" assertion while proving
 * nothing at all. So each absence case is a PAIR — the same schema/walker is
 * shown carrying a frame through on a sibling input first.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import { GoalThresholdFrame } from '@talchain/schemas';

import {
  extractCompoundGoals,
  toGoalConstraints,
  normaliseConstraintUnits,
} from '../extractor.js';
import { GoalConstraintSchema } from '../../../schemas/assist.js';
import { GraphStateIngressSchema } from '../../../orchestrator-v5/boundary/request-extensions.js';
import { LLMDraftResponse } from '../../../adapters/llm/shared-schemas.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `src/cee/compound-goal/__tests__` -> `src` */
const SRC_ROOT = join(HERE, '..', '..', '..');

/**
 * A STAMP is an object-literal assignment of a FRAME LITERAL — `valueFrame:
 * 'level'` / `value_frame: 'delta'`. Deliberately narrower than "the identifier
 * appears": the type declaration (`valueFrame: GoalThresholdFrameType`), the
 * Zod declaration (`value_frame: GoalThresholdFrame.optional()`) and the
 * by-presence carry (`value_frame: c.valueFrame`) are NOT attestations and must
 * not be counted as ones, or this guard would agree with itself.
 */
const STAMP_PATTERN = /\b(?:value_frame|valueFrame)\s*:\s*['"](level|delta)['"]/g;

/**
 * The DELIBERATE STAMPER REGISTER. Adding a file here is the explicit act of
 * saying "this producer knows its own minting arithmetic". The register is
 * short by construction and the derived walk below is what makes it fail loud
 * rather than drift (trap 12): a new stamp site reddens until someone puts it
 * here on purpose.
 */
const REGISTERED_STAMPERS = [
  'cee/compound-goal/extractor.ts',
  'cee/compound-goal/qualitative-proxy.ts',
] as const;

/**
 * The producers that deliberately stamp NOTHING, by path. Each one holds a
 * number whose FRAME CEE does not know:
 *   - `add_constraint`: the value was computed by the ROUTING MODEL, and
 *     `routing/tool-schema.ts` explicitly instructs a NEGATIVE `at_most`
 *     encoding for reduction framing — so both frames are reachable through
 *     one parameter and the handler cannot tell which it holds.
 *     ⚠ REFINED BY ROADMAP 2.877 (link 1), AND THE DISTINCTION IS THE WHOLE
 *     POINT — the sentence above is about the PARAMETER and stays exactly true.
 *     Since 2.877 the handler DOES emit a frame on some turns, by RELAYING one
 *     `cee/compound-goal/extractor.ts` already attested for the user's own
 *     words, gated on the parsed number being the number persisted
 *     (`cee/compound-goal/constraint-frame-evidence.ts`, itself literal-free
 *     and therefore correctly not a stamper either). "Emits a frame" and
 *     "ATTESTS a frame" are different claims: this register is about the
 *     second, and `add_constraint` still never makes one — which is why its
 *     entry stays here and its literal count stays zero. Do NOT read this row
 *     as "no `value_frame` can leave this handler"; that would be false, and a
 *     register that overstates what it guards teaches the next reader to stop
 *     looking (CLAUDE.md trap 7b / 14).
 *   - the two draft adapters: the DRAFT LLM's own `goal_constraints` array,
 *     prompt-only and unenforced in code.
 *   - the client ingress: `z.array(z.unknown())`, wholly unconstrained.
 * Inferring a frame from `(operator, sign)` is not sound — `<=` with a POSITIVE
 * value is a level — so all four fail closed instead, which the contract's own
 * "absence means UNATTESTED" clause vindicates.
 */
const REGISTERED_NON_STAMPERS = [
  'orchestrator-v5/tools/handlers/add-constraint.ts',
  'adapters/llm/anthropic.ts',
  'adapters/llm/openai.ts',
  'orchestrator-v5/boundary/request-extensions.ts',
] as const;

/** Every non-test `.ts` file under `src/`, as paths relative to `src/`. */
function walkProductionSources(): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        visit(full);
        continue;
      }
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) continue;
      out.push(relative(SRC_ROOT, full).split(sep).join('/'));
    }
  };
  visit(SRC_ROOT);
  return out;
}

/**
 * Read with `readFileSync`, never a shelled `grep`: CEE carries deliberate
 * `'\0'` sentinels in at least one source file, `file(1)` classifies those as
 * binary, and plain `grep` then reports ZERO MATCHES in the very file being
 * hunted (CLAUDE.md trap 17). A byte-level read cannot go blind that way.
 */
function stampsIn(relPath: string): string[] {
  const text = readFileSync(join(SRC_ROOT, relPath), 'utf8');
  return [...text.matchAll(STAMP_PATTERN)].map((m) => m[1]!);
}

/** Mint via the real extractor, then run the real downstream carry. */
function mintFromBrief(brief: string) {
  const extraction = extractCompoundGoals(brief);
  return toGoalConstraints(normaliseConstraintUnits(extraction.constraints));
}

describe('2.855 — the stamp SITES are a closed, derived set', () => {
  it('exactly the REGISTERED stampers carry a frame literal anywhere in src/', () => {
    const files = walkProductionSources();

    // Positive control FIRST. A walker that resolved the wrong root, or a
    // pattern that stopped matching, would make every assertion below pass by
    // finding nothing — the vacuity this whole file exists to refuse (trap 13).
    expect(files.length, 'the src/ walk found no TypeScript files at all').toBeGreaterThan(100);

    const stamping = files.filter((f) => stampsIn(f).length > 0).sort();
    expect(
      stamping,
      'a NEW value_frame stamp site appeared in src/. A frame is an ATTESTATION: ' +
        'only a producer that knows its own minting arithmetic may stamp one. ' +
        'Add it to REGISTERED_STAMPERS deliberately, or remove the stamp.',
    ).toEqual([...REGISTERED_STAMPERS].sort());

    // ...and every registered stamper really does stamp, so the equality above
    // cannot be satisfied by two silently-emptied files.
    for (const f of REGISTERED_STAMPERS) {
      expect(stampsIn(f).length, `${f} is registered as a stamper but stamps nothing`).toBeGreaterThan(0);
    }
  });

  it('every stamped literal is a member of the CONTRACT enum (no local vocabulary)', () => {
    // Derived from the vendored package rather than a hand-copied union, so a
    // contract change reddens here instead of drifting silently (trap 12).
    const options = new Set<string>(GoalThresholdFrame.options);
    const all = REGISTERED_STAMPERS.flatMap((f) => stampsIn(f));
    expect(all.length, 'no stamps found — the pattern has stopped matching').toBeGreaterThan(0);
    for (const literal of all) {
      expect(options.has(literal), `stamped frame '${literal}' is not in the contract enum`).toBe(true);
    }
  });

  it("'delta' has exactly ONE producer in the whole tree, and it is the reduction branch", () => {
    // The delta path is the one the cross-service chain constrains hardest:
    // PLoT REFUSES a delta-framed constraint whose normalisation would alter
    // the stated quantity (plot-lite-service 38bc3826, ROADMAP 2.878) and ISL
    // trusts a delta attestation UNCONDITIONALLY — no domain guard on that
    // branch. A second delta producer would therefore be a new trust surface,
    // not a new feature, and must not appear without that being noticed.
    const deltaFiles = walkProductionSources()
      .filter((f) => stampsIn(f).includes('delta'))
      .sort();
    expect(deltaFiles).toEqual(['cee/compound-goal/extractor.ts']);
  });

  it('the four deliberate NON-STAMPERS stamp nothing, each bound by its own path', () => {
    for (const f of REGISTERED_NON_STAMPERS) {
      // Precondition: the file exists and is non-trivial. A typo'd path would
      // otherwise make this loop assert "no stamps in a file we never read".
      const text = readFileSync(join(SRC_ROOT, f), 'utf8');
      expect(text.length, `${f} read as empty — the path is wrong`).toBeGreaterThan(500);
      expect(
        stampsIn(f),
        `${f} has started stamping a value_frame. It holds a number whose frame ` +
          'CEE does not know; a stamp here is a manufactured attestation.',
      ).toEqual([]);
    }
  });
});

describe('2.855 — no non-stamping producer VALIDATOR manufactures a frame', () => {
  it("`add_constraint`'s validator leaves an unframed constraint unframed", () => {
    // The exact shape `add-constraint.ts` builds and parses (see the
    // `GoalConstraintSchema.safeParse(newConstraint)` call in that handler):
    // the routing model supplies value/operator/unit and never a frame.
    const routingMinted = {
      constraint_id: 'gc-11111111-2222-3333-4444-555555555555',
      node_id: 'fac_marketing_cost',
      operator: '<=' as const,
      value: -0.15,
      label: 'Marketing cost ceiling',
      provenance: 'explicit' as const,
      unit: '%',
    };

    const parsed = GoalConstraintSchema.parse(routingMinted);

    // PRECONDITION PAIR (trap 13b): the same schema, same call, MUST carry a
    // frame through when the input has one. Without this, a schema that
    // stripped `value_frame` outright — or one whose declaration was deleted —
    // would satisfy the absence assertion below while proving the opposite.
    const withFrame = GoalConstraintSchema.parse({ ...routingMinted, value_frame: 'level' });
    expect(
      withFrame.value_frame,
      'GoalConstraintSchema is not carrying value_frame at all — the absence ' +
        'assertion below would be vacuous',
    ).toBe('level');

    expect(
      parsed.value_frame,
      "add_constraint's validator injected a frame the routing model never " +
        'attested — a defaulted frame is a manufactured attestation',
    ).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(parsed, 'value_frame')).toBe(false);
  });

  it('the CLIENT INGRESS array leaves an unframed constraint unframed', () => {
    const ingress = {
      nodes: [],
      edges: [],
      goal_constraints: [
        { constraint_id: 'gc-client-1', node_id: 'fac_churn', operator: '<=', value: 0.05 },
      ],
    };

    const parsed = GraphStateIngressSchema.parse(ingress);
    const row = (parsed.goal_constraints as Array<Record<string, unknown>>)[0]!;

    // PRECONDITION PAIR: the same ingress schema demonstrably PRESERVES a frame
    // that is present, so the absence below is the input's doing, not a strip.
    const withFrame = GraphStateIngressSchema.parse({
      ...ingress,
      goal_constraints: [{ ...ingress.goal_constraints[0], value_frame: 'level' }],
    });
    expect(
      (withFrame.goal_constraints as Array<Record<string, unknown>>)[0]!.value_frame,
      'the ingress schema is dropping value_frame outright — the absence ' +
        'assertion below would be vacuous',
    ).toBe('level');

    expect(
      Object.prototype.hasOwnProperty.call(row, 'value_frame'),
      'the client ingress array manufactured a frame for a client-supplied ' +
        'constraint; that array is z.array(z.unknown()) and attests nothing',
    ).toBe(false);
  });

  it("the DRAFT LLM's own goal_constraints array passes through unframed", () => {
    // Both adapters spread `parsed.goal_constraints` verbatim, so the only
    // place a frame could be injected on that path is this schema.
    const draft = {
      nodes: [],
      edges: [],
      goal_constraints: [
        { constraint_id: 'gc-llm-1', node_id: 'fac_churn', operator: '<=', value: 0.05 },
      ],
    };

    const parsed = LLMDraftResponse.parse(draft) as Record<string, unknown>;
    const row = (parsed.goal_constraints as Array<Record<string, unknown>>)[0]!;

    // PRECONDITION PAIR: passthrough demonstrably carries the field when set.
    const withFrame = LLMDraftResponse.parse({
      ...draft,
      goal_constraints: [{ ...draft.goal_constraints[0], value_frame: 'level' }],
    }) as Record<string, unknown>;
    expect(
      (withFrame.goal_constraints as Array<Record<string, unknown>>)[0]!.value_frame,
      'LLMDraftResponse is dropping value_frame — the absence assertion below ' +
        'would be vacuous',
    ).toBe('level');

    expect(
      Object.prototype.hasOwnProperty.call(row, 'value_frame'),
      "the draft adapter manufactured a frame for the LLM's own constraint array",
    ).toBe(false);
  });
});

describe('2.855 — on the wire, only the reduction branch carries a delta', () => {
  it("the ONLY row stamped 'delta' is the negative-valued reduction row, by node identity", () => {
    const rows = mintFromBrief(
      'Reduce marketing cost by 15%, keep churn under 5%, retention must be at least 90%, ' +
        'keep headcount between 20 and 30, and deliver within 6 months.',
    );

    // PRECONDITION (trap 13b): this brief really does mint several branches. A
    // brief that silently stopped matching would make "only one delta" true by
    // minting nothing at all.
    expect(rows.length, 'the corpus brief minted nothing — the assertions below are vacuous').toBeGreaterThan(3);
    const levels = rows.filter((r) => r.value_frame === 'level');
    expect(levels.length, 'no level stamps present — the stamp machinery is not running').toBeGreaterThan(1);

    const deltas = rows.filter((r) => r.value_frame === 'delta');
    expect(deltas).toHaveLength(1);

    // Bind by IDENTITY (node id + operator), never by a value predicate another
    // row could satisfy (trap 19), and pin the arithmetic that MAKES it a delta
    // in the same assertion so the frame claim is not floating free.
    expect(deltas[0]!.node_id).toBe('fac_marketing_cost');
    expect(deltas[0]!.operator).toBe('<=');
    expect(deltas[0]!.value).toBeLessThan(0);
  });
});
