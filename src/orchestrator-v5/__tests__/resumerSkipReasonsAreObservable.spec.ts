import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ⭐⭐ A DERIVED GUARD OVER A CLASS, NOT A MIRROR OF ONE CASE.
 *
 * `turn-executor.ts` runs a row of deterministic resumers. Each returns a
 * discriminated result: `matched: true` with a dispatch, or `matched: false`
 * with a `skip_reason` naming WHY it declined. Those reasons exist for
 * telemetry only — a resumer that declines silently is unobservable, and
 * "which of its reasons fired" cannot then be answered from logs, from
 * telemetry, or from anywhere at all.
 *
 * ⛔ MEASURED: of the EIGHT bound producers, THREE emit their reason and FIVE
 * do not. The convention is followed for some siblings and dropped for others —
 * exactly the drift a hand-maintained list cannot catch and a derived guard can.
 *
 * ⚠ WHAT THIS CANNOT DO (trap 12d, stated rather than discovered): a derived
 * guard proves AGREEMENT, never COMPLETENESS. It cannot say the reasons are the
 * RIGHT ones, nor that an emitted value reaches a readable sink.
 */
const SRC = join(__dirname, '..', 'turn-executor.ts')

/**
 * ⛔⛔ IS THE REASON **EMITTED**, OR MERELY **MENTIONED**? THE FIRST VERSION OF
 * THIS GUARD ASKED THE WRONG ONE, AND A MUTANT CAUGHT IT.
 *
 * It tested `source.includes(binding + '.skip_reason')`. A sibling that keeps a
 * BRANCH on its reason (`if (x.skip_reason === 'no_pending')`) while dropping
 * its `emit` still contained the string, so the guard stayed GREEN — measured:
 * removing one sibling's emit line left 3/3 passing. **Presence of the symbol
 * is not observability of the value**, which is the same defect class this
 * change exists to fix, committed inside the guard written to fix it.
 *
 * So the predicate is now: the reason must reach a TELEMETRY PAYLOAD KEY
 * (`reason:` or `skip_reason:`), not a comparison. `baselineAnswer` moves into
 * the known-dropped set on that definition — it only ever branches on its
 * reason and nothing emits it — and that is the honest reading, not a
 * regression.
 */
/**
 * ⛔ THE HONEST GAP, PINNED AS AN EXACT SET.
 *
 * These resumers compute a `skip_reason` that is still discarded. They are NOT
 * fixed here: each belongs to a different repair, and widening this diff to
 * touch five routers at once is the "while we're here" this estate bans.
 *
 * ⭐ Asserted EXACTLY — RED if it GROWS (a new resumer drops its reason) and
 * equally RED if it SHRINKS (one was fixed and nobody updated the record).
 *
 * ⛔ AND THE LIABILITY OF AN EXACT SET, DEMONSTRATED ON THIS VERY FILE: it
 * shipped with FOUR members while the true answer was five, because the
 * population predicate was shape-dependent and never saw `deicticDispatch`.
 * **A wrong exact set is enforced as correct by its own test.** That is why the
 * population is now derived from the imports and pinned by name above.
 *
 * ⚠ `baselineAnswer` is here on the EMITTED definition, not by oversight: it
 * only ever BRANCHES on its reason and nothing sends it anywhere.
 */
const KNOWN_DROPPED: ReadonlySet<string> = new Set([
  'anaphoricDispatch',
  'baselineAnswer',
  'compoundDispatch',
  'deicticDispatch',
  'goalTargetAnswer',
])

function reasonIsEmitted(source: string, binding: string): boolean {
  const asPayloadValue = new RegExp(
    `(?:reason|skip_reason):[\\s\\S]{0,120}?\\b${binding}\\.skip_reason`,
  )
  return asPayloadValue.test(source)
}

describe('every resumer that can decline says why, observably', () => {
  const source = readFileSync(SRC, 'utf8')

  /**
   * ⭐⭐ THE POPULATION IS DERIVED FROM THE IMPORTS, NEVER FROM THE CALL SHAPE.
   *
   * ⛔ THE FIRST VERSION OF THIS FILE MATCHED `const (\w+) = (try\w+)\(` AND
   * LOST TWO OF THE EIGHT. Both missed bindings are
   * `const|let X = <guard> ? tryY(…) : <fallback>` — the producer call inside a
   * TERNARY, arbitrarily far from the `=`. A reviewer's mutant isolated it
   * exactly: reshaping ONLY the call syntax at the deictic site, emitting
   * nothing new, turned this guard RED. **So the blind spot was the regex
   * shape and nothing about emits.**
   *
   * ⛔ AND A SECOND, "CORRECTED" REGEX MISSED THEM TOO — newline-tolerant,
   * `const|let|var`, no `try` prefix: 234 bindings matched, neither of the two
   * among them. *The first failed on line breaks, the second on ternaries, a
   * third would fail on something else.* **When an instrument is refuted,
   * change instrument; sharpening is re-running the failure with more care.**
   *
   * So: resolve every import, keep the symbols whose MODULE declares a
   * `skip_reason`, then bind each producer to the nearest preceding
   * declaration — which is tolerant of line breaks, ternaries and `let`.
   *
   * ⚠ ITS OWN LIMIT, STATED HERE RATHER THAN DISCOVERED LATER: this resolves
   * THROUGH IMPORT STATEMENTS. A producer reached by a dynamic import, a
   * re-export, or a namespace object is invisible to it. That is a narrower
   * blind spot than a call-shape regex, not the absence of one.
   */
  /**
   * ⭐⭐ A PRODUCER IS A SYMBOL THAT **CONSTRUCTS** A `skip_reason`, NOT ONE THAT
   * MERELY LIVES IN A MODULE THAT MENTIONS IT.
   *
   * Measured while building this: filtering at MODULE level admitted seven
   * helpers from the same files (`buildClarifyAssistantText`, `deriveOperator`,
   * `computeRequestHash`, …) and the dropped set read TWELVE. Filtering on
   * "the symbol's own span mentions `skip_reason`" still admitted one that only
   * CONSUMES one. **Requiring `skip_reason:` — the object KEY, i.e. the symbol
   * builds the value — lands on exactly the right population.**
   */
  function skipReasonProducers(): string[] {
    const out: string[] = []
    for (const imp of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/gs)) {
      const spec = imp[2]!
      if (!spec.startsWith('.')) continue
      let mod: string
      try {
        mod = readFileSync(
          join(__dirname, '..', `${spec.replace(/^\.\//, '').replace(/\.js$/, '')}.ts`),
          'utf8',
        )
      } catch {
        continue
      }
      if (!mod.includes('skip_reason')) continue
      for (const raw of imp[1]!.split(',')) {
        const name = raw.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0]!.trim()
        if (!name) continue
        const decl = new RegExp(`^export\\s+(?:async\\s+)?(?:function|const)\\s+${name}\\b`, 'm').exec(mod)
        if (!decl) continue
        const after = mod.slice(decl.index + decl[0].length)
        const next = /^export\s+(?:async\s+)?(?:function|const|type|interface)\s/m.exec(after)
        const span = after.slice(0, next ? next.index : undefined)
        if (span.includes('skip_reason:')) out.push(name)
      }
    }
    return [...new Set(out)]
  }

  /**
   * The binding a producer's result flows into.
   *
   * ⭐ The nearest preceding declaration WHOSE STATEMENT STILL GOVERNS THE CALL:
   * a `;` between the `=` and the call means that declaration ended first and
   * the call belongs to something else. That one rule is what makes this
   * tolerant of line breaks and ternaries — the two shapes that defeated the
   * regex versions — while refusing the unrelated declarations a bare
   * "nearest preceding" heuristic picks up. Measured: without it the dropped
   * set reads 17 and includes `activeHandlerRegistry`.
   */
  function bindingFor(producer: string): string | null {
    const call = source.indexOf(`${producer}(`)
    if (call === -1) return null
    const decls = [...source.slice(0, call).matchAll(/(?:const|let|var)\s+([a-zA-Z][a-zA-Z0-9_]*)\s*=/g)]
    const last = decls[decls.length - 1]
    if (!last) return null
    const between = source.slice(last.index! + last[0].length, call)
    return between.includes(';') ? null : last[1]!
  }

  const bindings = skipReasonProducers()
    .map((producer) => ({ producer, binding: bindingFor(producer) }))
    .filter((b): b is { producer: string; binding: string } => b.binding !== null)

  it('PRECONDITION — the import-derived population is non-empty and plausible', () => {
    // A zero here would make every assertion below vacuous. It also catches the
    // failure mode that started this: a population that silently shrinks.
    expect(bindings.length).toBeGreaterThanOrEqual(8)
  })

  it('PRECONDITION — and it contains the two the call-shape regex lost', () => {
    // Pinned BY NAME. These are the exact bindings a shape-dependent predicate
    // missed, so a regression to shape-matching REDs here rather than silently
    // measuring less.
    const names = bindings.map((b) => b.binding)
    expect(names).toContain('deicticDispatch')
    expect(names).toContain('deterministicValueUpdate')
  })

  it('⭐ no resumer computes a skip_reason that this file then discards', () => {
    const dropped = bindings
      .filter((b) => !reasonIsEmitted(source, b.binding))
      .map((b) => b.binding)
      .sort()

    expect(dropped).toEqual([...KNOWN_DROPPED].sort())
  })
})
