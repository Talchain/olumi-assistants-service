/**
 * ⭐ WHAT WOULD HAVE TO BE TRUE FOR THE CONSENT TESTS TO PASS WHILE AN
 * UNCONFIRMED MUTATION STILL HAPPENS — and the guards that cover it.
 *
 * The acceptance suite (`__tests__/calibration-consent-boundary.test.ts`)
 * asserts at `sessionStore.append`. That is the right oracle, but it can
 * only see turns that go THROUGH `runTurnExecutor`'s `commitTurn` closure.
 * Three things could therefore be true while the suite stays green:
 *
 *   (1) A NEW MUTATING HANDLER is registered and `GRAPH_MUTATING_HANDLER_IDS`
 *       is not updated. The STEP 2 gate would let it through.
 *       → COVERED HERE, derived: the set is checked against the handler
 *         modules that import `applyAndValidateMutation`, the single
 *         in-memory mutation chokepoint. (The commit backstop would still
 *         strip the write, so this is a response-honesty guard, not the
 *         property itself — but a stripped write under an "Applied" receipt
 *         is its own lie, so it must not drift.)
 *
 *   (2) A DURABLE GRAPH WRITER OUTSIDE the executor applies the change.
 *       `commitDirectAnswer` is the service's single `scenarios.graph`
 *       writer, but several dispatchers call it directly, bypassing
 *       `commitTurn` and therefore bypassing the backstop.
 *       → ENUMERATED HERE, derived from the source. The manifest is
 *         asserted so a NEW out-of-executor writer turns this RED and
 *         forces a decision, instead of silently widening the hole.
 *       ⚠ HONEST SCOPE: these writers are NOT covered by this change. The
 *         per-writer reason is recorded beside each entry in the manifest
 *         below — `edit-graph-dispatch` already has the GM referee;
 *         `system-events/dispatch` (the inspector value edit) and
 *         `route-v2` are UI-originated direct manipulations that carry no
 *         conversational message to withhold consent in. Recorded, not
 *         hidden.
 *
 *   (3) THE DETECTOR FAILS TO FIRE on a phrasing a user considers a hold.
 *       → COVERED by the hand-written corpus in `mutation-consent.test.ts`,
 *         which is the only guard that can notice a short list.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { GRAPH_MUTATING_HANDLER_IDS } from '../mutation-consent.js';
import { getDefaultRegistry } from '../../tools/registry.js';

const SRC_ROOT = new URL('../../../', import.meta.url).pathname;
const HANDLERS_DIR = join(SRC_ROOT, 'orchestrator-v5/tools/handlers');

/** `set-factor-value.ts` -> `set_factor_value` */
function moduleToHandlerId(fileName: string): string {
  return fileName.replace(/\.ts$/, '').replace(/-/g, '_');
}

describe('DERIVED: GRAPH_MUTATING_HANDLER_IDS matches the modules that can mutate a graph', () => {
  /**
   * The source of truth is not a list — it is "which registered handler
   * module imports the in-memory mutation chokepoint".
   */
  const derived = readdirSync(HANDLERS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => {
      const body = readFileSync(join(HANDLERS_DIR, f), 'utf8');
      return body.includes('applyAndValidateMutation');
    })
    .map(moduleToHandlerId)
    .sort();

  it('the derivation found handlers at all (positive control — an empty scan would pass every assertion below)', () => {
    expect(derived.length).toBeGreaterThan(0);
  });

  it('every derived mutating module is a REGISTERED handler id', () => {
    const registered = new Set(getDefaultRegistry().keys());
    for (const id of derived) {
      expect(registered.has(id as never)).toBe(true);
    }
  });

  it('the constant equals the derived set exactly — a new mutating handler REDs here on the day it is written', () => {
    expect([...GRAPH_MUTATING_HANDLER_IDS].sort()).toEqual(derived);
  });
});

describe('DERIVED: the manifest of durable graph writers OUTSIDE the executor commit closure', () => {
  /**
   * Every `commitDirectAnswer(` call site in `src/` that passes a `graph`.
   * `turn-executor.ts` is excluded because its writes funnel through
   * `commitTurn`, which carries the backstop.
   *
   * ⚠ THIS LIST IS A CLAIM ABOUT COVERAGE. It is asserted, not narrated,
   * so widening the hole cannot happen quietly.
   */
  const KNOWN_UNCOVERED_WRITERS: readonly string[] = [
    // Has its own consent machinery: the GM referee HOLDS every structural
    // op and demotes ops targeting user-protected entities.
    'orchestrator-v5/handlers/edit-graph-dispatch.ts',
    // First-draft persistence — there is no prior model to protect.
    'orchestrator-v5/handlers/draft-graph-dispatch.ts',
    // The inspector value edit: a UI direct manipulation. It carries no
    // conversational message, so there is no consent clause to honour.
    'orchestrator-v5/system-events/dispatch.ts',
    // Chip-click dispatch declares a `graph` on its outcome union but passes
    // none to `commitDirectAnswer` today. Listed because the scan is
    // deliberately conservative — it flags the SHAPE, not a proven write.
    'orchestrator-v5/handlers/chip-click-dispatch.ts',
    // V4 add-option / decline / offer.
    'orchestrator/route-v2.ts',
  ];

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(p, out);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        out.push(p);
      }
    }
    return out;
  }

  const graphBearingWriters = walk(SRC_ROOT)
    .filter((p) => {
      // `grep -a` equivalent: readFileSync is NUL-safe, unlike plain grep
      // (CLAUDE.md trap 17 — a NUL-bearing source file is invisible to it,
      // and `edit-graph-referee-gate.ts` in this very tree carries one).
      const body = readFileSync(p, 'utf8');
      if (!body.includes('commitDirectAnswer(')) return false;
      return /\bgraph:\s/.test(body);
    })
    .map((p) => p.slice(SRC_ROOT.length))
    // `turn-executor.ts` funnels through `commitTurn`, which carries the
    // backstop; `commit.ts` is where `commitDirectAnswer` is DEFINED, not a
    // caller of it.
    .filter(
      (p) =>
        p !== 'orchestrator-v5/turn-executor.ts' && p !== 'orchestrator-v5/commit.ts',
    )
    .sort();

  it('the scan found writers at all (positive control)', () => {
    expect(graphBearingWriters.length).toBeGreaterThan(0);
  });

  it('the set of out-of-executor graph writers is EXACTLY the known, recorded set', () => {
    // A new entry here means a durable graph writer exists that the
    // withheld-consent backstop does not cover. That is a decision to make
    // deliberately, in review — not a line to discover in production.
    expect(graphBearingWriters).toEqual([...KNOWN_UNCOVERED_WRITERS].sort());
  });
});
