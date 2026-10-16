/**
 * MEMORY-RETENTION EVAL — floors + the per-fact retention table
 * (POC-STATE-ASSESSMENT rec 8; the `HARNESS-CONTEXT-ORCHESTRATOR-2026-07-30`
 * finding that the ≤1,600-char haiku rolling summary is the sole carrier of
 * conversational memory and nothing measures its retention).
 *
 * House style follows the #750 clarify-v2 floors pack: golden fixtures + floors
 * that import the PRODUCTION modules from src/ — never copies. The engine and
 * its honest limits are documented in `../scorer/memory-retention.ts`; read that
 * header before quoting any number out of this file.
 *
 * ── WHAT IS A FLOOR AND WHAT IS A MEASUREMENT ───────────────────────────────
 *
 * Retention of a live-model paraphrase remains GRADED because the lexical
 * detector cannot judge semantic equivalence. The deterministic production-
 * budget arms are different: they carry the user's words verbatim and exercise
 * the real rolling-summary chain, so every seeded durable fact is now a floor.
 * The old 1,200-char behaviour remains as an explicit mutant proving the new
 * floor would have failed before this change.
 *
 *   MEM-FLOOR 1  the DECISION GOAL or a USER CORRECTION is absent from the
 *                injected summary — the two losses a tester experiences
 *                directly as "it forgot what I said".
 *   MEM-FLOOR 2  a SUPERSEDED value survives while the correction that replaced
 *                it does not — an active falsehood, worse than forgetting.
 *
 * and three protect the measurement from being theatre:
 *
 *   MEM-FLOOR 3  the detector discriminates IN BOTH DIRECTIONS (a planted fact
 *                is FOUND; a never-stated one is MISSED; a fact removed from a
 *                planted summary makes the floors FIRE).
 *   MEM-FLOOR 4  no measured fact is present in the verbatim window at the
 *                measurement turn — otherwise the reading is the window's, not
 *                memory's — WITH a positive control proving that channel can
 *                report a presence.
 *   MEM-FLOOR 5  pack integrity / non-vacuity: the fixture is big enough, the
 *                summary actually injected, no pass was rejected or floored,
 *                and the faithful output sits above the explicit legacy mutant
 *                while fitting the production target and hard cap.
 *
 * NOT REQUIRED, and honestly so. `staging`'s only required check is
 * `Lint, TypeCheck, Unit Tests` (derived from the branch-protection API, 30
 * Jul), and this suite runs in `Conversation Harness Gates (advisory)`, which
 * triggers on `tools/conversation-harness/**` and `src/orchestrator-v5/**` — so
 * it DOES execute on every PR that can move the memory path, it simply does not
 * block. The brief's rule applies verbatim: the summariser call is live-LLM with
 * no replay seam in this repo, so the eval is advisory-not-required and says so
 * here rather than implying a guarantee it does not have.
 *
 * Run: pnpm exec vitest run --config tools/conversation-harness/vitest.config.ts
 */
import { readFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe,expect,it } from 'vitest';

import { CONTEXT_PACK_RECENT_TURNS_CAP } from '../../../src/orchestrator-v5/context/context-pack-schema.js';



const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'memory-retention-cases.json',
);
const pack = JSON.parse(readFileSync(fixturePath, 'utf8')) as typeof import('../fixtures/memory-retention-cases.json');
const kase = pack.cases[0]!;

/** The measurement turns, derived from the fixture (never hardcoded here). */
const MEASURE_TURNS = kase.measure_at_turns;
/** An in-window control turn: early enough that turn-5's fact is still verbatim. */


/**
 * Historical mutant only — NOT a runtime authority. Keeping the superseded
 * value here proves the all-facts floor turns red under the exact old policy,
 * rather than merely asserting that 1,400 is better.
 */








/** The assembled report string, so the extracted artefact itself is assertable. */






// ---------------------------------------------------------------------------
// MEM-FLOOR 5 — pack integrity / non-vacuity (run first: everything else
// depends on the pack being able to say anything at all)
// ---------------------------------------------------------------------------

describe('MEM-FLOOR 5 — pack integrity and non-vacuity', () => {
  it('the fixture covers the fact classes the brief asks for, with a negative control', () => {
    const kinds = new Set(kase.facts.map((f) => f.kind));
    expect(kase.facts.length, 'at least five seeded facts').toBeGreaterThanOrEqual(5);
    expect(kinds.has('decision_goal')).toBe(true);
    expect(kinds.has('numeric_constraint')).toBe(true);
    expect(kinds.has('option_name')).toBe(true);
    expect(kinds.has('preference')).toBe(true);
    expect(kinds.has('user_correction')).toBe(true);
    expect(kinds.has('never_stated_control')).toBe(true);
    expect(kase.facts.filter((f) => f.floor).length, 'the defect floor is non-empty').toBe(2);
    expect(kase.facts.some((f) => f.supersedes !== undefined)).toBe(true);
  });

  it('the turn list is well-formed and long enough to push facts out of the window', () => {
    kase.turns.forEach((t, i) => expect(t.n).toBe(i + 1));
    expect(kase.turns.length).toBeGreaterThan(CONTEXT_PACK_RECENT_TURNS_CAP);
    // Every measured fact must be stated OUTSIDE the verbatim window at every
    // measurement turn — derived from the real cap, not asserted as a constant.
    for (const turn of MEASURE_TURNS) {
      const firstVerbatim = turn - CONTEXT_PACK_RECENT_TURNS_CAP + 1;
      for (const f of kase.facts) {
        if (f.stated_at_turn === null) continue;
        expect(
          f.stated_at_turn,
          `${f.id} is stated at turn ${f.stated_at_turn}, inside the verbatim window at ` +
            `measurement turn ${turn} (window starts at ${firstVerbatim}) — its retention ` +
            'reading would be the window, not memory',
        ).toBeLessThan(firstVerbatim);
      }
    }
  });


















});

// ---------------------------------------------------------------------------
// MEM-FLOOR 3 — the detector discriminates, in both directions
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// MEM-FLOOR 4 — the reading comes from memory, not from the verbatim window
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// MEM-FLOOR 1 + 2 — the defect floor, on the arm where a loss means a bug
// ---------------------------------------------------------------------------





// ---------------------------------------------------------------------------
// CORE-PoC RETENTION FLOOR — the licensed production envelope
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// LEGACY MUTANT — proves the floor would have caught the old 1,200 policy
// ---------------------------------------------------------------------------
