/**
 * C8 — THE `scenarios.graph` WRITER POPULATION PIN.
 *
 * ⭐ THIS FILE IS WORTH MORE THAN THE FIX IT SHIPPED WITH. The fix closes ONE
 * bypass (the restore tier). This closes the CLASS: a FOURTH writer appearing
 * anywhere in this service REDs by construction, whether it arrives as a TS call
 * site or as a new SQL function.
 *
 * ── WHY THE CLASS KEEPS RE-OPENING ─────────────────────────────────────────
 * The floor's own header has now been wrong TWICE about its own population, in
 * opposite directions: it first said there were "TWO production writers, not
 * one", and after that correction it said the third writer was "NOT ON THIS
 * FLOOR" when the true statement is narrower — it could not take the floor's
 * APPEND, and always could have taken its CHECK. Each sentence was written by
 * someone who had just measured it, and each went stale under the next change.
 * That is the hand-maintained mirror (CLAUDE.md trap 12): a list a human must
 * remember to sync WILL drift, and the drift always reads as green. The answer
 * is not a better-written header. It is a derivation that fails loud.
 *
 * ── WHAT THIS PIN ASSERTS, AND WHY EACH HALF IS NECESSARY ──────────────────
 * A new writer can arrive by two routes and the halves are NOT redundant:
 *   TS  — a new call site on an existing writer (`store.append`,
 *         `appendCheckedGraphWrite`, `restoreVersionAtomic`). Caught below by
 *         the exact-set assertions.
 *   SQL — a brand-new RPC that writes `scenarios.graph`, reached from TS by a
 *         name this file has never heard of. NO TS-side pin can see that; only
 *         the migration sweep can. This is the half that would have caught the
 *         restore tier on the day it landed.
 * Drop either and a whole arrival route goes unobserved.
 *
 * ── THE PRECISION PROBLEM, NAMED ───────────────────────────────────────────
 * A naive `\.append\(` sweep over `src/` returns THIRTEEN hits and TWELVE are
 * false: `supabase-store.ts` calls `this.append` (the store calling itself),
 * `assist.evidence-pack.ts` calls `archive.append` (a ZIP archiver, nothing to
 * do with graphs), and seven more sit inside JSDoc describing the very rule this
 * file pins. A pin that counted those would be green today and meaningless
 * tomorrow. So the sweep below strips comments FIRST and matches the receiver,
 * and `stripComments` has its own positive control — an instrument that cannot
 * fail is not evidence (CLAUDE.md trap 13).
 *
 * ⚠ SCOPE OF THIS PIN, STATED SO NO ABSENCE CLAIM IS READ WIDER:
 *   · It reads `src/**\/*.ts` (production only) and `supabase/migrations/*.sql`
 *     AT THIS TIP. It cannot see an unmerged branch, and it says nothing about
 *     what a deployed database actually contains.
 *   · No PL/pgSQL was executed. The SQL half is a TEXTUAL sweep of migration
 *     files, not a catalogue query against a live database.
 *   · It pins WHERE writes happen, never that any of them is CORRECT.
 *
 * ⚠ IF THIS TEST GOES RED: do not edit the expected set to match. Establish
 * which half tripped, then either route the new writer through
 * `assertNoIntroducedGraphViolations` (at minimum) or record, in the same
 * commit, why it cannot be — with the measurement, as C8 did for the CAS.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const SRC_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MIGRATIONS_ROOT = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));

function walkProductionTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'generated') continue;
      walkProductionTsFiles(full, out);
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Remove `//` and block comments so a rule DESCRIBED in prose is never counted
 * as a rule BROKEN in code. Deliberately simple; its blind spots (a `//` inside
 * a string literal) can only ADD hits, never hide one, so it cannot make this
 * pin silently permissive.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const PRODUCTION_TS = walkProductionTsFiles(SRC_ROOT).map((f) => ({
  path: relative(SRC_ROOT, f),
  code: stripComments(readFileSync(f, 'utf8')),
}));

const filesMatching = (re: RegExp): string[] =>
  PRODUCTION_TS.filter((f) => re.test(f.code))
    .map((f) => f.path)
    .sort();

describe('instrument controls — this sweep can SEE, and it discriminates', () => {
  it('the corpus is non-empty and plausible in magnitude', () => {
    // A sweep that collected nothing agrees with every other sweep that
    // collected nothing. Assert the inputs before believing any absence below.
    expect(PRODUCTION_TS.length).toBeGreaterThan(300);
  });

  it('POSITIVE CONTROL — `stripComments` removes prose but keeps code', () => {
    const sample = stripComments(
      ['/** store.append( in a docblock */', "// store.append( in a line comment", 'x.append(write);'].join(
        '\n',
      ),
    );
    expect(sample).not.toContain('docblock');
    expect(sample).not.toContain('line comment');
    expect(sample).toContain('x.append(write);');
  });

  it('CONTRAST CONTROL — the sweep returns a NON-ZERO, plausible count for a symbol known present', () => {
    // Absence is only meaningful when a same-family symbol reads non-zero in the
    // same instrument. `projectGraphForPersistence` is on every graph writer.
    const present = filesMatching(/projectGraphForPersistence\s*\(/);
    expect(present.length).toBeGreaterThanOrEqual(3);
  });

  it('DISCRIMINATION — the sweep does NOT match a symbol that exists only in prose', () => {
    // If this ever returns a hit, `stripComments` has stopped working and every
    // exact-set assertion below has quietly become a superset check.
    expect(filesMatching(/\bNOT_A_REAL_GRAPH_WRITER_SYMBOL\s*\(/)).toEqual([]);
  });
});

describe('C8 — the `scenarios.graph` writer population is EXACTLY these call sites', () => {
  it('`store.append(` — the ONE append, inside the floor and nowhere else', () => {
    // Receiver-bound on purpose: `this.append(` (the store's own retry) and
    // `archive.append(` (a ZIP writer) are NOT graph writes and must not count.
    expect(filesMatching(/\bstore\.append\s*\(/)).toEqual([
      'orchestrator-v5/persist-graph-write.ts',
    ]);
  });

  it('`appendCheckedGraphWrite(` — exactly two callers take the CHECK **and** the APPEND', () => {
    const callers = filesMatching(/(?<!function\s)\bappendCheckedGraphWrite\s*\(/).filter(
      (p) => p !== 'orchestrator-v5/persist-graph-write.ts',
    );
    expect(callers).toEqual([
      'orchestrator-v5/commit.ts',
      'routes/assist.v1.scenario-graph-register.ts',
    ]);
  });

  it('`assertNoIntroducedGraphViolations(` — the CHECK half reaches the restore tier too', () => {
    const callers = filesMatching(
      /(?<!function\s)\bassertNoIntroducedGraphViolations\s*\(/,
    ).filter((p) => p !== 'orchestrator-v5/persist-graph-write.ts');
    // ⭐ THE C8 CLOSURE ITSELF. If `assist.v1.scenario-versions.ts` drops out of
    // this list, the restore tier is silently writing unchecked graphs again —
    // which is exactly the state this pin was written to make impossible.
    expect(callers).toEqual(['routes/assist.v1.scenario-versions.ts']);
  });

  it('the restore route hands the CHECK the SAME projected object it hands the RPC', () => {
    // ⚠ THE CALL-SITE PINS ABOVE PROVE THE CHECK IS WIRED, NEVER THAT IT IS
    // WIRED TO THE RIGHT BYTES. Swapping the check's argument to the raw,
    // unprojected `parsedGraph.data` left this whole file GREEN 11/11 and the
    // route suite GREEN 51/51 — the check still ran, on bytes nobody stores.
    // That is the C8 defect class one level up, so the ARGUMENT is pinned here
    // as well as behaviourally in the route suite. Two independent reds.
    const route = PRODUCTION_TS.find(
      (f) => f.path === 'routes/assist.v1.scenario-versions.ts',
    );
    expect(route).toBeDefined();
    const code = route!.code;
    // Both consumers must name the PROJECTED binding. `graphForStore` is the
    // output of `projectGraphForPersistence`; `parsedGraph.data` is the raw
    // stored version and must reach NEITHER.
    expect(code).toMatch(/assertNoIntroducedGraphViolations\(\{\s*graph:\s*graphForStore\b/);
    expect(code).toMatch(/restoreVersionAtomic\(\{[\s\S]{0,400}?\bgraph:\s*graphForStore\b/);
    expect(code).not.toMatch(/graph:\s*parsedGraph\.data\b/);
  });

  it('`restoreVersionAtomic(` — the third writer has exactly one caller', () => {
    expect(filesMatching(/\.restoreVersionAtomic\s*\(/)).toEqual([
      'routes/assist.v1.scenario-versions.ts',
    ]);
  });

  it('EVERY production file that writes a graph is one of the three known writers', () => {
    // The union assertion. The three sets above each pin one symbol; this pins
    // that no file reaches persistence by a combination none of them names.
    const writers = new Set([
      ...filesMatching(/\bstore\.append\s*\(/),
      ...filesMatching(/(?<!function\s)\bappendCheckedGraphWrite\s*\(/),
      ...filesMatching(/\.restoreVersionAtomic\s*\(/),
      ...filesMatching(/\.storeDraftGraph\s*\(/),
    ]);
    expect([...writers].sort()).toEqual([
      'orchestrator-v5/commit.ts',
      'orchestrator-v5/persist-graph-write.ts',
      'routes/assist.v1.scenario-graph-register.ts',
      'routes/assist.v1.scenario-versions.ts',
    ]);
  });
});

describe('C8 — the SQL half: no NEW migration writes `scenarios.graph` unnoticed', () => {
  // The only route by which a fourth writer can arrive invisible to every
  // TS-side pin above. A new migration that writes this column REDs here.
  const SQL_WRITERS = readdirSync(MIGRATIONS_ROOT)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => {
      const body = readFileSync(join(MIGRATIONS_ROOT, f), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*--/.test(l))
        .join('\n');
      return /\bSET\s+graph\s*=/i.test(body);
    })
    .sort();

  it('the set of migrations writing `scenarios.graph` is frozen', () => {
    expect(SQL_WRITERS).toEqual([
      // `store_draft_graph` — DORMANT. Zero TS call sites, pinned separately in
      // `context/__tests__/graph-identity-guards.test.ts`.
      '20260422120000_v5_store_draft_graph.sql',
      // The `append_turn_atomic_*` family — ALL reached through `store.append`,
      // i.e. through the floor. `_v5` does not write the column itself; it
      // delegates to `_v4`.
      '20260422200000_v5_append_turn_atomic_with_graph.sql',
      '20260422210000_v5_append_turn_atomic_graph_idempotency_fix.sql',
      '20260502120000_v5_brief_text_persistence.sql',
      '20260505120000_v5_pending_actions.sql',
      '20260602120000_v5_coaching_state_snapshot.sql',
      '20260609120000_v5_conversation_content.sql',
      '20260711000000_v5_append_turn_atomic_for_share.sql',
      '20260717120000_v5_append_turn_atomic_v3_graph_cas.sql',
      '20260731130000_v5_turn_fence_atomic_append.sql',
      '20260802120000_v5_turn_fence_atomic_append_generation_key.sql',
      '20260806120000_v5_turn_fence_first_write_exemption.sql',
      // The restore tier — its OWN atomic statement, on the CHECK half of the
      // floor since C8. Its CAS is unconditional; the turn family's is
      // `p_cas_enforce DEFAULT FALSE`, so this one must NOT be converged onto
      // `store.append`. See `assertNoIntroducedGraphViolations`' JSDoc.
      '20260824200000_c8_atomic_model_version_restore.sql',
    ]);
  });

  it('CONTROL — the SQL sweep discriminates (not every migration matches)', () => {
    const allSql = readdirSync(MIGRATIONS_ROOT).filter((f) => f.endsWith('.sql'));
    // If these were ever equal, the filter has stopped filtering and the freeze
    // above would be asserting "all files" rather than "the graph writers".
    expect(SQL_WRITERS.length).toBeLessThan(allSql.length);
    expect(SQL_WRITERS.length).toBeGreaterThan(0);
  });
});
