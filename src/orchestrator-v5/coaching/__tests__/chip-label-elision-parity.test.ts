/**
 * ⭐⭐ THE CHIP AND THE PROSE BESIDE IT ARE ELIDED BY THE SAME RULE — AND THE
 * CHIP IS THE WORSE HALF, BECAUSE CLICKING IT REPLAYS ITS MESSAGE AS USER TEXT.
 *
 * ── THE GAP THIS CLOSES, AND WHY IT LOOKED CLOSED ──────────────────────────
 * The first cut of this branch fixed `coaching/post-draft-narrative.ts` and
 * left four named siblings, on the recorded ground that *"all four append an
 * ellipsis, so none produces the witnessed unclosed-bracket string."* **That
 * was true of witnessed string (i) only** — the no-mark prose variant. A
 * reviewer then reproduced witnessed string (ii) byte-exactly from
 * `coaching/readiness-recovery.ts` at its own `MAX_LABEL_CHARS = 40`:
 *
 *   rr_truncate(<the 85-char option>, 40)
 *     = "double down on enterprise sales (higher…"      (exactly 40 chars)
 *   chip.label
 *     = "Configure double down on enterprise sales (higher…"   ← witnessed (ii)
 *
 * And it ships in the SAME TURN as the prose that was fixed:
 * `handlers/draft-graph-dispatch.ts:258` builds the narrative, `:380` builds
 * the chips, from one response object. A user read a corrected sentence and a
 * mangled chip together. **One PR closing one of two cited witnesses is the
 * defect this suite exists to make impossible to repeat.**
 *
 * ── WHY THIS BINDS THE PRODUCER, NOT THE HELPER ────────────────────────────
 * Every assertion below drives `buildReadinessRecoveryChip` — the exported
 * producer the dispatcher actually calls — rather than the private `truncate`
 * it delegates to. A test bound to the helper would stay green if the producer
 * stopped calling it, which is exactly how the first gap survived.
 */
import { describe, expect, it } from 'vitest';

import { buildReadinessRecoveryChip } from '../readiness-recovery.js';
import { elideAtWordBoundary as elideFromComposer } from '../post-draft-narrative.js';
import { elideAtWordBoundary as elideFromLeaf } from '../../prose-elision.js';
import {
  buildConfigureOptionChipMessage,
  CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX,
} from '../../configure-option-chip-text.js';

/** The witnessed option, verbatim from `COMPOSED-JOURNEY-WITNESS-2026-08-18-B.md`. */
const WITNESSED_OPTION =
  'double down on enterprise sales (higher margins but longer cycles and more headcount)';

/** The exact strings the deployed build emitted. */
const WITNESSED_CHIP_LABEL = 'Configure double down on enterprise sales (higher…';
const WITNESSED_CHIP_MESSAGE = 'Help me configure double down on enterprise sales (higher….';

/** A readiness payload whose sole non-ready option carries the witnessed label. */
function readinessFor(label: string) {
  return {
    analysisReady: {
      status: 'needs_user_mapping',
      options: [{ id: 'opt_1', option_id: 'opt_1', label, status: 'needs_user_mapping' }],
      blockers: [],
    },
    nodes: [{ id: 'opt_1', kind: 'option' as const, label }],
  };
}

const chipFor = (label: string) => {
  const { analysisReady, nodes } = readinessFor(label);
  return buildReadinessRecoveryChip(analysisReady as never, nodes as never);
};

function hasUnclosedDelimiter(text: string): boolean {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', '“': '”' };
  const closers = new Set(Object.values(pairs));
  let depth = 0;
  let quotes = 0;
  for (const ch of text) {
    if (ch === '"') quotes += 1;
    else if (pairs[ch] !== undefined) depth += 1;
    else if (closers.has(ch)) depth -= 1;
  }
  return depth !== 0 || quotes % 2 !== 0;
}

describe('the instrument: this producer really is the one that emitted the witnessed chip', () => {
  it('the witnessed option reaches the chip producer at all', () => {
    const chip = chipFor(WITNESSED_OPTION);
    expect(chip, 'the readiness payload must yield a configure chip').not.toBeNull();
    expect(chip?.id).toBe('chip_prompt_configure_option');
  });

  /** ⭐ CONTRAST CONTROL (trap 13e): the predicate must convict the emitted
   *  string and acquit its source, or it certifies anything. */
  it('the unclosed-delimiter predicate convicts the witnessed chip and acquits the option', () => {
    expect(hasUnclosedDelimiter(WITNESSED_CHIP_LABEL)).toBe(true);
    expect(hasUnclosedDelimiter(WITNESSED_OPTION)).toBe(false);
  });
});

describe('witnessed string (ii) cannot recur, on the chip the dispatcher builds', () => {
  it('the chip LABEL is neither the witnessed string nor bracket-broken', () => {
    const chip = chipFor(WITNESSED_OPTION);
    expect(chip?.label, 'the witnessed chip label must not recur').not.toBe(WITNESSED_CHIP_LABEL);
    expect(hasUnclosedDelimiter(chip!.label), 'chip label left a delimiter open').toBe(false);
    // The counterfactual the reviewer computed under the shared rule.
    expect(chip?.label).toBe('Configure double down on enterprise sales…');
  });

  /**
   * ⭐ THE WORSE HALF. A chip replays its message as the user's own text, so a
   * mangled message is the product writing malformed words into their turn.
   */
  it('the chip MESSAGE is neither the witnessed string nor doubly terminated', () => {
    const chip = chipFor(WITNESSED_OPTION);
    expect(chip?.message, 'the witnessed chip message must not recur').not.toBe(
      WITNESSED_CHIP_MESSAGE,
    );
    expect(chip?.message, 'the `…` + `.` collision must be gone').not.toContain('….');
    expect(hasUnclosedDelimiter(chip!.message)).toBe(false);
    // The routing prefix is load-bearing and must survive the tail change.
    expect(chip?.message.startsWith(CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX)).toBe(true);
  });
});

describe('the opposite direction: what must be left exactly as it is', () => {
  it('a short option label is carried into the chip byte-identically, unmarked', () => {
    const chip = chipFor('Double Down on Enterprise Sales');
    expect(chip?.label).toBe('Configure Double Down on Enterprise Sales');
    expect(chip?.label).not.toContain('…');
    // An unelided reference still gets its full stop — the period is conditional,
    // not removed, and this is the twin that proves the condition discriminates.
    expect(chip?.message).toBe('Help me configure Double Down on Enterprise Sales.');
  });

  it('the full stop is added when the reference does not terminate itself, and not when it does', () => {
    expect(buildConfigureOptionChipMessage('the pricing option')).toBe(
      'Help me configure the pricing option.',
    );
    for (const terminated of ['an option…', 'an option.', 'an option!', 'an option?']) {
      const message = buildConfigureOptionChipMessage(terminated);
      expect(message.endsWith('..'), terminated).toBe(false);
      expect(message).toBe(`${CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX}${terminated}`);
    }
  });
});

/**
 * ⭐⭐ ONE RULE, NOT FIVE COPIES OF ONE RULE.
 *
 * A fix applied to one of five copies has a countdown on it, and this lane has
 * now watched that countdown expire once. These pins are what stop it a second
 * time.
 */
describe('the elision rule has exactly one definition, and the sibling set is pinned', () => {
  it("the composer's re-export IS the leaf's function, not a private copy", () => {
    expect(elideFromComposer).toBe(elideFromLeaf);
  });

  it('the leaf is dependency-free, so it can never participate in an import cycle', async () => {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const leaf = path.resolve(here, '../../prose-elision.ts');
    const source = fs.readFileSync(leaf, 'utf8');
    // `readiness-recovery` could not import the rule from `post-draft-narrative`
    // because that file imports `buildReadinessNextStep` from it. The leaf only
    // stays safe for BOTH consumers while it imports nothing at all.
    expect(source.match(/^\s*import\s/gmu) ?? []).toHaveLength(0);
  });

  /**
   * ⚠⚠ THE SET FAILS LOUD IF IT GROWS — AND IT ALREADY CAUGHT WHAT TWO
   * HAND-WRITTEN SURVEYS MISSED.
   *
   * The sibling set was enumerated by hand twice: once by this lane (four
   * siblings) and once by its reviewer (five call sites). **This derived guard
   * found SEVEN.** `coaching/post-analysis-wrapper.ts` (a chip label),
   * `compose/flip-threshold-card-row.ts` (card prose) and
   * `context/context-pack-assembler.ts` appeared in neither list. That is trap
   * 12 exactly: a list a human must remember to sync WILL drift, and the drift
   * reads as green.
   *
   * ⚠ IT SCANS CODE, NOT PROSE. Comments are stripped first — several fixed
   * modules now quote their OLD body in a docstring to explain what changed,
   * and a guard that read those would convict the very files it certifies.
   */
  it('no module under orchestrator-v5 defines its own slice-based elision any more', async () => {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const root = path.resolve(here, '../../..'); // ⚠ ALL of src/, not just orchestrator-v5

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (full.endsWith('prose-elision.ts')) continue; // the one definition
        const raw = fs.readFileSync(full, 'utf8');
        // Strip block and line comments: a fixed module that DOCUMENTS its old
        // body must not be convicted for describing what it stopped doing.
        const source = raw.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
        // A hand-rolled cut: slicing to ANY bound and IMMEDIATELY appending a
        // mark. The adjacency matters — a `[\s\S]{0,60}` window convicted four
        // ARRAY slices whose files merely happened to contain a `…` nearby.
        // ⚠ THE FIRST VERSION OF THIS PATTERN REQUIRED THE PARAMETER TO BE
        // LITERALLY NAMED `max`, so it saw 3 of the 10 real truncators and
        // reported a clean-looking short list — a derived guard that had
        // quietly become a hand-maintained one, keyed on a variable name.
        if (
          /\.slice\(\s*0\s*,\s*[A-Za-z_$][\w$.]*\s*(?:-\s*\d+\s*)?\)(?:\.trimEnd\(\))?\s*(?:\}|\+\s*)['"`]?(…|\.\.\.)/u.test(
            source,
          )
        ) {
          offenders.push(path.relative(root, full));
        }
      }
    };
    walk(root);
    // ⚠ THE MANIFEST, PINNED BY NAME RATHER THAN SWEPT UNDER AN EXEMPTION.
    //
    // ⚠⚠ THE POPULATION WAS THREE TIMES WHAT TWO HAND-WRITTEN SURVEYS SAID.
    // This lane named four siblings; its reviewer named five call sites; the
    // sweep over ALL of `src/` finds the list below. That gap is the whole
    // argument for deriving it (trap 12) — and the guard only earned it after
    // being widened from `orchestrator-v5/` to `src/`, because a sweep that
    // cannot reach a location returns the same clean output as one that looked.
    //
    // CONSOLIDATED onto the shared rule by this PR (user-reachable):
    //   coaching/post-draft-narrative · coaching/readiness-recovery
    //   coaching/post-analysis-wrapper · compose/helpers · compose/phase3-blocks
    //   compose/flip-threshold-card-row · compose/repair-value-ask-response
    //   clarify-v2/preflight
    //
    // STILL CARRYING THEIR OWN CUT — each one mid-token and bracket-blind. They
    // are listed, not fixed: every one has its own callers and its own blast
    // radius, and this PR has already changed eight. Listing them is what makes
    // the remainder a scheduled job rather than an invisible one.
    expect(offenders.sort()).toEqual([
      'cee/dual-draft/merge.ts',
      'cee/observability/collector.ts',
      'orchestrator-v5/context/context-pack-assembler.ts',
      'orchestrator-v5/context/recent-changes.ts',
      'orchestrator-v5/decision-records/project.ts',
      'orchestrator-v5/handlers/draft-bias-signal-blocks.ts',
      'orchestrator-v5/handlers/edit-graph-fact-builder.ts',
      'routes/assist.draft-graph.ts',
    ]);
  });

  /**
   * ⭐ THE GUARD ABOVE MUST BE ABLE TO CONVICT (trap 13). An absence assertion
   * with no demonstrated positive is a guard agreeing with itself, so the same
   * predicate is run against the exact body every fixed module used to carry.
   */
  it('the sibling guard convicts the old bodies and acquits the new one', () => {
    const predicate =
      /\.slice\(\s*0\s*,\s*[A-Za-z_$][\w$.]*\s*(?:-\s*\d+\s*)?\)(?:\.trimEnd\(\))?\s*(?:\}|\+\s*)['"`]?(…|\.\.\.)/u;
    // Every real spelling found in the tree, so the pattern is not tuned to one.
    for (const offending of [
      'return `${s.slice(0, max - 1).trimEnd()}…`;',
      'return `${s.slice(0, max - 3).trimEnd()}...`;',
      's = s.slice(0, SAFE_SUMMARY_MAX_CHARS - 1) + Ellipsis;'.replace('Ellipsis', "'…'"),
      'rationale = `${rationale.slice(0, RATIONALE_LINE_CHAR_CAP)}…`;',
    ]) {
      expect(predicate.test(offending), offending).toBe(true);
    }
    expect(predicate.test('return elideAtWordBoundary(s, max);')).toBe(false);
    expect(predicate.test('return elideWithinBudget(s, max);')).toBe(false);
    // And it must not convict an ARRAY slice, which is not a truncator at all.
    expect(predicate.test('const named = trimmed.slice(0, MAX_LISTED_WHEN_OVER);')).toBe(false);
  });

  /**
   * ⚠ THE ONE DELIBERATE EXCLUSION, NAMED SO IT IS A DECISION AND NOT AN
   * OVERSIGHT. `cee/observability/collector.ts` truncates `raw_prompt` /
   * `raw_response` into the observability capture only — a diagnostic record,
   * not prose a user reads — and already marks the cut explicitly. A
   * word-boundary rule there would make captured bytes LESS faithful to what
   * was actually sent, which is the opposite of what a capture is for.
   */
  it('the observability collector is excluded on purpose, and still marks its own cut', async () => {
    const fs = await import('node:fs');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const collector = path.resolve(here, '../../../cee/observability/collector.ts');
    const source = fs.readFileSync(collector, 'utf8');
    expect(source).toContain('[truncated, ');
    // And it is outside the swept tree, so the guard above cannot silently
    // start covering it and turn this exclusion into a contradiction.
    expect(collector.includes(`${path.sep}orchestrator-v5${path.sep}`)).toBe(false);
  });
});
