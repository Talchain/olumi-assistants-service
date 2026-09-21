/**
 * PROMPT ↔ TOOL-ENUM HANDLER COVERAGE GATE
 * ========================================
 *
 * MOTIVATING DEFECT (measured 2026-08-29, at served `routing` v120
 * `adcc5128d4e6e6bc`): the served prompt's `<HANDLERS>` section opens
 *
 *     "Only propose a handler_id available in the current tool set."
 *
 * and then enumerates SEVEN handlers — of which only FIVE are in the tool set.
 * `add_constraint` and `adjust_edge_strength` appeared **zero times** in the
 * whole 25,149-char prompt, while the contrast controls in the same probe fired
 * (`set_factor_value` 3, `run_analysis` 4). Both handlers are fully live:
 * registered (`resolveHandler(getDefaultRegistry(), 'adjust_edge_strength')`),
 * fact-emitting, chip-generating, UI-directive-producing.
 *
 * So a user saying *"keep margin above 30%"* or *"make that link stronger"* had
 * a dedicated deterministic handler that the model was never told about. The
 * turn fell through to `edit_graph`, whose prompt carries sixteen instructions
 * to return an empty patch and none telling it to complete a clear one.
 *
 * This is the estate's chronic failure — we build more than we plug in — and
 * the missing plug was ~250 characters of prompt text.
 *
 * WHAT THIS GATE ASSERTS
 * ----------------------
 * Every member of the `olumi_action` `handler_id` enum is NAMED in the served
 * prompt's `<HANDLERS>` section — the section whose own first sentence claims to
 * enumerate the available tool set.
 *
 * DERIVED, NOT MIRRORED (platform CLAUDE.md trap 12)
 * --------------------------------------------------
 * The handler universe is READ OUT OF `OLUMI_ACTION_TOOL` at runtime. A
 * hand-copied list here is precisely the defect that produced the gap: the
 * prompt WAS a hand-maintained copy of this enum, and it drifted silently
 * because nothing compared them. Adding a handler to the enum now REDs this
 * gate until the prompt is taught about it.
 *
 * ONE-DIRECTIONAL ON PURPOSE — DO NOT "FIX" THE ASYMMETRY
 * ------------------------------------------------------
 * enum ⊆ prompt is asserted. prompt ⊆ enum is NOT, and must not be:
 * `draft_graph` and `edit_graph` are legitimately named in `<HANDLERS>` and are
 * legitimately absent from the enum — they are dispatched by the system layer
 * BEFORE routing and never reach this tool call (`tool-schema.ts:101-105`).
 * A future author who "tidies" this into a set-equality assertion will delete
 * the model's only instructions for drafting and editing a model.
 *
 * THE PROBE CANNOT BE BLIND (trap 13 / 13e)
 * -----------------------------------------
 * An extraction that silently yields nothing agrees with every other extraction
 * that yields nothing. So, in the same run: the derived enum is asserted
 * NON-EMPTY and of plausible magnitude; the extracted section is asserted
 * non-empty and identity-pinned; a POSITIVE control (a handler known present)
 * must read non-zero; and a CONTRAST control (a handler-shaped id that is not
 * in the enum) must read exactly zero. Absence is only provable when the
 * contrast fires.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OLUMI_ACTION_TOOL } from '../tool-schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');

/**
 * The PMS-served bytes, checked in as a snapshot, and the repo-canonical file
 * that PMS is populated FROM (`Prompts/canonical/README.md`: *"These files are
 * the verified canonical bytes of the captured PMS prompt set. PMS is populated
 * FROM here."*). Both are read, and both are pinned to the manifest below, so
 * this gate cannot be satisfied by a file the service does not serve.
 */
const SERVED_FIXTURE_PATH = resolve(
  REPO_ROOT,
  'src/orchestrator-v5/context/__tests__/fixtures/served-orchestrator-prompt.txt',
);
const CANONICAL_PATH = resolve(REPO_ROOT, 'Prompts/canonical/routing.txt');
const MANIFEST_PATH = resolve(REPO_ROOT, 'Prompts/canonical/manifest.json');

const servedPrompt = readFileSync(SERVED_FIXTURE_PATH, 'utf8');
const canonicalPrompt = readFileSync(CANONICAL_PATH, 'utf8');

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// The handler universe — DERIVED from the live tool definition
// ---------------------------------------------------------------------------

/**
 * Read straight out of the tool Anthropic actually receives. Typed loosely on
 * purpose: the shape is a JSONSchema literal, and narrowing it here would mean
 * restating the structure — a second mirror of the thing being checked.
 */
function deriveHandlerIds(): readonly string[] {
  const schema = OLUMI_ACTION_TOOL.input_schema as unknown as {
    properties: {
      action: { properties: { handler_id: { enum?: readonly string[] } } };
    };
  };
  return schema.properties.action.properties.handler_id.enum ?? [];
}

const HANDLER_IDS = deriveHandlerIds();

/**
 * A handler-shaped id that is NOT in the enum and NOT in the prompt. Its job is
 * to prove the probe DISCRIMINATES: if this ever reads non-zero, the matcher is
 * matching something other than what it claims to.
 */
const CONTRAST_ABSENT_HANDLER = 'smooth_the_gradient';

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

function extractHandlersSection(prompt: string): string {
  const match = /<HANDLERS>([\s\S]*?)<\/HANDLERS>/.exec(prompt);
  return match ? match[1]! : '';
}

const handlersSection = extractHandlersSection(servedPrompt);

// ---------------------------------------------------------------------------
// 0. Instrument checks — run BEFORE any coverage claim is believed
// ---------------------------------------------------------------------------

describe('instrument — the probe can see, and can discriminate', () => {
  it('derives a NON-EMPTY handler enum from the live tool definition', () => {
    // A blind derivation returning [] would make every coverage assertion below
    // pass vacuously (`[].every(...)` is true). Magnitude is checked too: a
    // silently-truncated enum is a smaller, quieter version of the same lie.
    expect(HANDLER_IDS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(HANDLER_IDS).size).toBe(HANDLER_IDS.length);
    for (const id of HANDLER_IDS) {
      expect(id, 'a handler id must be a non-empty string').toMatch(/^[a-z][a-z_]+$/);
    }
  });

  it('extracts a NON-EMPTY <HANDLERS> section from the served prompt', () => {
    expect(servedPrompt.length).toBeGreaterThan(18_500);
    expect(handlersSection.length).toBeGreaterThan(500);
    // POSITIVE control: the section's own opening claim, verbatim. If the
    // section is ever restructured this REDs and the gate is re-derived rather
    // than silently pointed at an empty string.
    expect(handlersSection).toContain(
      'Only propose a handler_id available in the current tool set',
    );
  });

  it('CONTRAST control — a handler-shaped id absent from the enum reads exactly zero', () => {
    expect(HANDLER_IDS).not.toContain(CONTRAST_ABSENT_HANDLER);
    expect(countOccurrences(servedPrompt, CONTRAST_ABSENT_HANDLER)).toBe(0);
    expect(countOccurrences(handlersSection, CONTRAST_ABSENT_HANDLER)).toBe(0);
  });

  it('the bytes under test ARE the served prompt (sha256 pinned to the canonical manifest)', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
      pms_prompts: ReadonlyArray<{ key: string; sha256: string; cee_content_hash_16: string }>;
    };
    const routing = manifest.pms_prompts.find((p) => p.key === 'routing');
    expect(routing, 'manifest has no `routing` entry').toBeDefined();
    expect(sha256(servedPrompt)).toBe(routing!.sha256);
    expect(sha256(servedPrompt).slice(0, 16)).toBe(routing!.cee_content_hash_16);
  });

  it('the served snapshot and the repo-canonical source have not drifted apart', () => {
    // PMS is populated FROM `Prompts/canonical/routing.txt`, and the CI gate
    // validates against the fixture. Nothing bound the two before this, so an
    // edit to one alone would ship a prompt no gate had checked.
    expect(sha256(canonicalPrompt)).toBe(sha256(servedPrompt));
  });
});

// ---------------------------------------------------------------------------
// 1. The gate
// ---------------------------------------------------------------------------

describe('every dispatchable handler is named in the served prompt', () => {
  it.each(HANDLER_IDS.map((id) => [id] as const))(
    '<HANDLERS> names `%s`',
    (handlerId) => {
      expect(
        countOccurrences(handlersSection, handlerId),
        `\`${handlerId}\` is in the olumi_action tool enum but is NOT named in the ` +
          `served prompt's <HANDLERS> section. The model is told to "only propose a ` +
          `handler_id available in the current tool set" and then shown a list that ` +
          `omits this one, so the intent it serves falls through to edit_graph. ` +
          `Add a line for it to Prompts/canonical/routing.txt, mirror the bytes to ` +
          `the served fixture, and re-pin the manifest sha256 ` +
          `(Prompts/canonical/README.md, "Version-bump procedure").`,
      ).toBeGreaterThan(0);
    },
  );

  it('the two handlers the 2026-08-29 defect hid are present (regression pin)', () => {
    // Bound BY IDENTITY, not by a count another handler could satisfy. These
    // two names are the measured defect; if a future prompt edit drops either,
    // this REDs naming the exact one.
    for (const handlerId of ['add_constraint', 'adjust_edge_strength'] as const) {
      expect(HANDLER_IDS, `${handlerId} left the tool enum`).toContain(handlerId);
      expect(
        countOccurrences(handlersSection, handlerId),
        `${handlerId} left the prompt`,
      ).toBeGreaterThan(0);
    }
  });

  it('edit_graph is told to defer to the specific handlers rather than absorb them', () => {
    // The gap did not merely omit two names, it MISROUTED their traffic:
    // edit_graph is the "when no more specific handler fits" fallback, so its
    // carve-out is what actually redirects a threshold or link-strength turn.
    const editGraphLine = handlersSection
      .split('\n')
      .find((line) => line.startsWith('- edit_graph:'));
    expect(editGraphLine, '<HANDLERS> no longer has an edit_graph line').toBeDefined();
    expect(editGraphLine!).toContain('add_constraint');
    expect(editGraphLine!).toContain('adjust_edge_strength');
  });
});

// ---------------------------------------------------------------------------
// 2. The prompt must not cite its own rules to the user
// ---------------------------------------------------------------------------

describe('the numbered rules are internal', () => {
  /**
   * WITNESSED VERBATIM IN A USER'S CHAT WINDOW (reported in 5 of 7 evaluation
   * briefs, 29 Aug 2026):
   *
   *   "Per rule 9 (one action per turn), I'll handle the value change first…"
   *
   * Rule 9 IS `ONE ACTION PER TURN` in the served prompt. Rule 4 and <STYLE>
   * enumerated the forbidden internals — handler names, validator terms, raw
   * JSON, action ids, graph hashes — and the numbered rules were not among
   * them, so nothing forbade this. The code-side containment (#1199) covers the
   * execute and clarify compose paths only; `text_only` and the coach/converse
   * `orientation_fallback` still ship the model's text verbatim, which is why
   * the ban has to exist in the prompt as well.
   */
  it('rule 4 forbids quoting or numbering the model\'s own instructions', () => {
    const rulesSection = /<RULES>([\s\S]*?)<\/RULES>/.exec(servedPrompt)?.[1] ?? '';
    expect(rulesSection.length).toBeGreaterThan(500); // positive control
    const ruleFour = rulesSection
      .split('\n')
      .find((line) => line.startsWith('4. NO INTERNAL LANGUAGE'));
    expect(ruleFour, '<RULES> no longer has a rule 4 NO INTERNAL LANGUAGE line').toBeDefined();
    expect(ruleFour!).toMatch(/never quote, cite or number your own rules or instructions/i);
  });

  it('rule 9 is still ONE ACTION PER TURN, so the witnessed leak is the one being banned', () => {
    // Binds the ban to the ACTUAL leaked text. If the rules are renumbered this
    // REDs, and the comment above must be re-derived rather than left claiming
    // a rule number that no longer means what it says.
    expect(servedPrompt).toContain('9. ONE ACTION PER TURN');
  });

  it('<STYLE> lists the rule numbers among the never-internal terms', () => {
    const styleSection = /<STYLE>([\s\S]*?)<\/STYLE>/.exec(servedPrompt)?.[1] ?? '';
    expect(styleSection.length).toBeGreaterThan(200); // positive control
    expect(styleSection).toContain('your own rule numbers or instructions');
  });
});
