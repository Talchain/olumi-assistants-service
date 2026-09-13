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
 * "which of its reasons fired" then cannot be answered from logs, from
 * telemetry, or from anywhere at all.
 *
 * ⛔ MEASURED BEFORE THIS GUARD EXISTED: of the seven resumer bindings whose
 * PRODUCER returns a `skip_reason`, only THREE had it read at the call site.
 * The convention was followed for some siblings and dropped for others — which
 * is exactly the drift a hand-maintained list cannot catch and a derived guard
 * can.
 *
 * ⭐ THE POPULATION IS DERIVED FROM THE PRODUCERS, NEVER LISTED HERE. A binding
 * qualifies when the function it is assigned from returns a `skip_reason`. Add
 * an eighth resumer tomorrow and it is in scope automatically; this file needs
 * no edit to cover it.
 *
 * ⚠ WHAT THIS CANNOT DO (trap 12d, stated rather than discovered): a derived
 * guard proves AGREEMENT, never COMPLETENESS. It cannot tell you the reasons
 * are the RIGHT eleven, nor that the emitted value reaches a readable sink. It
 * tells you only that no resumer computes a reason this file then throws away.
 */

const SRC = join(__dirname, '..', 'turn-executor.ts')
const ROOT = join(__dirname, '..', '..')

/**
 * ⛔ THE HONEST GAP, PINNED AS AN EXACT SET.
 *
 * These resumers compute a `skip_reason` that is still discarded. They are NOT
 * fixed here: each belongs to a different repair and widening this diff to
 * touch four routers at once is the "while we're here" this estate bans.
 *
 * ⭐ The set is asserted EXACTLY — this REDs if it GROWS (a new resumer drops
 * its reason) and equally if it SHRINKS (one was fixed and nobody updated the
 * record). A gap recorded in the suite is honest; a gap invisible to it is how
 * this one survived.
 */
const KNOWN_DROPPED: ReadonlySet<string> = new Set([
  'anaphoricDispatch',
  'baselineAnswer',
  'compoundDispatch',
  'goalTargetAnswer',
])

/**
 * Does the producer's own module declare a `skip_reason`?
 *
 * ⭐ RESOLVED THROUGH THE IMPORT STATEMENT, never by searching for the name.
 * Two same-named helpers are this estate's chronic defect, and a name search
 * cannot tell them apart; the import says which module this file actually
 * calls.
 */
function producerReturnsSkipReason(source: string, fnName: string): boolean {
  const importRe = new RegExp(
    `import\\s*\\{[^}]*\\b${fnName}\\b[^}]*\\}\\s*from\\s*'([^']+)'`,
    's',
  )
  const m = source.match(importRe)
  if (!m) return false
  const spec = m[1]!.replace(/\.js$/, '')
  const resolved = join(__dirname, '..', `${spec.replace(/^\.\//, '')}.ts`)
  try {
    return readFileSync(resolved, 'utf8').includes('skip_reason')
  } catch {
    return false
  }
}

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
function reasonIsEmitted(source: string, binding: string): boolean {
  const asPayloadValue = new RegExp(
    `(?:reason|skip_reason):[\\s\\S]{0,120}?\\b${binding}\\.skip_reason`,
  )
  return asPayloadValue.test(source)
}

describe('every resumer that can decline says why, observably', () => {
  const source = readFileSync(SRC, 'utf8')

  /** `const someBinding = trySomething({` — the resumer call shape. */
  const bindings = [
    ...source.matchAll(/const ([a-zA-Z][a-zA-Z0-9_]*) = (try[A-Za-z0-9_]+)\(/g),
  ].map((m) => ({ binding: m[1]!, producer: m[2]! }))

  it('PRECONDITION — the probe actually finds resumer bindings', () => {
    // A zero here would make every assertion below vacuous: the regex could
    // stop matching after any refactor and this file would applaud.
    expect(bindings.length).toBeGreaterThan(5)
  })

  it('PRECONDITION — and at least one producer is confirmed to return a skip_reason', () => {
    // Proves the producer probe can see a PRESENCE, so a zero elsewhere is a
    // real absence rather than a blind instrument.
    const withReason = bindings.filter((b) => producerReturnsSkipReason(source, b.producer))
    expect(withReason.length).toBeGreaterThan(0)
  })

  it('⭐ no resumer computes a skip_reason that this file then discards', () => {
    const dropped = bindings
      .filter((b) => producerReturnsSkipReason(source, b.producer))
      .filter((b) => !reasonIsEmitted(source, b.binding))
      .map((b) => b.binding)
      .sort()

    expect(dropped).toEqual([...KNOWN_DROPPED].sort())
  })
})
