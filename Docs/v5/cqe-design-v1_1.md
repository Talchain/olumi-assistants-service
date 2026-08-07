# CQE Design v1.1: Custom Quantity Extractor

**Date:** 19 April 2026
**Status:** Implementation-ready (post ChatGPT challenger pass 2)
**Component:** V5 Deterministic Components — Component 1 (CQE)
**Parent:** V5 Architecture and Design Specification v3.2 §11.1
**Schema:** `QuantityExtractionResult` v1.1
**Related:** Routing Prompt v6 (PARAMETERS section), Boundary Contract v1.1, CC Development Standards v3
**Supersedes:** CQE Design v1

**Changes from v1:**
- §4.2: precedence-and-exclusion table for overlapping rules P2/P11/P12
- §4.2: expanded UNIT regex (`grand`, `quid`), P5 (spaced word fractions), NUM (word `minus`), P13 (decimal pp, `5pp` form), P1/P11 (per-side units in shared-unit ranges)
- §4.5: vague quantifier wording — `null` is a successful ambiguity signal, not a failed parse
- §6 (new): `value_origin` execution-safety policy table
- §5: catastrophic backtracking quality note
- §7: additional fixtures (total 68, up from 50)

---

## 1. Purpose

CQE extracts numeric quantities from raw user messages before Sonnet sees them. F.6 invariant: the LLM never touches numbers. CQE owns the deterministic parse; the validator owns range and bounds checks; the handler owns final value computation against current state.

CQE is graph-blind by design. It operates on raw text only. It does not know factor scales, units, or current values. The validator and routing prompt reconcile CQE output with graph context.

---

## 2. Position in Layer 0

```
User message arrives at CEE
  → Layer 0 deterministic gate
      → System event check (return early if event)
      → Chip click check (return early if chip)
      → CQE: extractQuantities(rawMessage) → ContextPack.parsed_quantities  ← THIS COMPONENT
      → Compound detection → ContextPack.compound_detected
      → Context pack assembly
  → Layer 1 Sonnet 4.6 with tool use
```

CQE runs once per turn. Output is a deterministic, ordered array of `QuantityExtractionResult` objects, populated into `ContextPack.parsed_quantities`. Empty array is valid output.

---

## 3. Schema

Per spec v3.1 §11.1:

```typescript
interface QuantityExtractionResult {
  raw_text: string;                    // original matched span
  value: number | null;
  unit: string | null;
  direction: "up" | "down" | "set" | "unknown" | null;
  multiplier: number | null;
  operator: ParameterOperator | null;  // set | add | multiply | increment | decrement
  comparator: "at_least" | "at_most" | "between" | null;
  range_min: number | null;
  range_max: number | null;
  approximate: boolean;
  source: "cqe" | "compromise" | "unparsed";
  value_origin?: "literal" | "lexical_quantifier" | "word_fraction" | "suffix_expansion" | "word_number" | "parsed_numeric";
}
```

`value_origin` is additive (v1.1). Tells downstream how the value was derived. Routing prompt and validator pick clarification strategy by origin type.

---

## 4. Algorithm

### 4.1 Pipeline

```
INPUT: rawMessage: string (capped at 2000 chars)
OUTPUT: QuantityExtractionResult[]

1. PRE-NORMALISE
   - Cap input length at 2000 chars (longer → return [] + telemetry flag)
   - Lowercase a working copy (preserve original for raw_text spans)
   - NFKC unicode normalisation (smart quotes → straight, currency symbols preserved)
   - Collapse whitespace
   - Strip thousand separators inside numbers ("150,000" → "150000") only when comma is between digits with no space

2. WORD-NUMBER PRE-PASS (narrow lexicon)
   - Replace word numbers with numerals before regex passes:
     one→1, two→2, three→3, four→4, five→5, six→6, seven→7, eight→8, nine→9, ten→10
   - Set per-replacement marker: span has value_origin=word_number
   - Word fractions (third, half, quarter, two thirds, three quarters) NOT replaced here;
     handled by P5 to preserve operator/multiplier semantics

3. RUN ORDERED RULE TABLE (P1 → P13)
   - For each rule in priority order:
     - Scan working copy for matches
     - For each match: emit { span_start, span_end, parsed_fields, pattern_id, value_origin }
     - Mask matched spans with equal-length spaces
   - Masking guarantees no double-extraction without post-hoc dedup logic

4. RUN COMPROMISE-NUMBERS BACKSTOP
   - Pass remaining unmasked text to compromise + compromise-numbers
   - For each numeric token:
     - Skip if overlaps existing match
     - Else emit { value, unit: null, operator: null, source: "compromise", value_origin: "parsed_numeric" }

5. ASSEMBLE RESULTS
   - Sort by span_start
   - Apply post-match exclusion filters (versions, ordinals, time, long digit runs)
   - Return array
```

### 4.2 Rule table

CC implements as a declarative table, not hand-coded blocks:

```typescript
interface PatternRule {
  pattern_id: string;
  priority: number;          // lower = higher priority
  regex: RegExp;
  parse: (match: RegExpMatchArray) => Partial<QuantityExtractionResult>;
  overlap_policy: "mask" | "merge_into_range";
  guards: string[];          // explicit lookbehind/lookahead exclusions
  fixture_ids: string[];     // links to test fixtures
}
```

The 13 rules:

| # | Pattern ID | Priority | What it captures | Fields populated | Guards |
|---|---|---|---|---|---|
| P1 | `range_between` | 1 | "between X and Y [unit]" or "between X[unit] and Y[unit]" (per-side units accepted, must match) | range_min, range_max, comparator: between, unit | None |
| P2 | `range_dash` | 2 | "X-Y unit" or "X to Y unit" (en dash and hyphen both accepted) | range_min, range_max, comparator: between, unit | Must NOT be preceded by `from` (P11 territory) or directional verb (P12 territory) |
| P3 | `comparator_value` | 3 | "at least N", "at most N", "under N", "over N", "no more than N", "minimum N", "maximum N", "up to N" | value, comparator, unit | None |
| P4 | `multiplier_verb` | 4 | "double", "triple", "quadruple", "halve" (and -ing forms) | multiplier, operator: multiply | None |
| P5 | `word_fraction` | 5 | "(reduce/cut/decrease/increase) by a/two-thirds/half/quarter" — accepts hyphenated, single-word, and **spaced** forms (`one third`, `two thirds`, `three quarters`) | value, operator: decrement/increment, direction, value_origin: word_fraction | None |
| P6 | `directional_percent` | 6 | "(direction-verb) by N%" e.g. "increase by 10%" | value/100, direction, operator: increment/decrement, unit: percentage | Must contain `%` |
| P6b | `directional_absolute` | 7 | "(direction-verb) by N [unit]" or "(direction-verb) N [unit]" e.g. "add 2 engineers", "cut £50k", "grew 5%" | value (**/100 when unit is percentage**), direction, operator: add/decrement, unit | Defers to P6 whenever P6 matches (P6 runs first and masks). See note below — P6b is NOT `%`-free. |
| P7 | `set_verb_value` | 8 | "set/change/update/make X to N [unit]" | value, operator: set, direction: set, unit | None |
| P8 | `currency` | 9 | "£/$/€ N [k\|m\|bn]" or "N GBP/USD/EUR" or "N grand/quid" (UK colloquial → GBP) | value × suffix, unit: currency code, value_origin: suffix_expansion if suffix or colloquial | None |
| P9 | `bare_percentage` | 10 | "N%" not preceded by direction verb | value/100, unit: percentage | Must NOT be preceded by direction verb (P6 territory) |
| P10 | `vague_quantifier` | 11 | "a couple [of]", "a few", "several", "many", "handful" | value (couple=2 only; others null), approximate: true, value_origin: lexical_quantifier | None |
| P11 | `from_to` | 12 | "from X to Y [unit]" or "from X[unit] to Y[unit]" e.g. "cut budget from 200k to 150k", "from £50k to £70k" | value: Y, range_min: X, range_max: Y, operator: set, direction inferred from X→Y trajectory and verb context, unit | **Must require leading `from`** |
| P12 | `to_value` | 13 | "(direction-verb) to N [unit]" e.g. "reduce to 5%", "bring down to 4 months" | value, operator: set, direction inferred from verb, unit | **Must require directional verb immediately before `to`** |
| P13 | `percentage_points` | 14 | "N percentage points", "N pp", "Npp", decimals accepted (e.g. "1.5 percentage points") | value (raw, not /100), unit: percentage_points | None |

**Compromise backstop:** runs last on unmasked remainder. `value_origin: parsed_numeric`.

**UNIT regex includes:** `%`, `pp`, `percentage points`, `months?`, `weeks?`, `days?`, `years?`, `hours?`, `minutes?`, `kg`, `km`, `miles?`, currencies (`£`, `$`, `€`, `GBP`, `USD`, `EUR`), and UK colloquial currency words (`grand`, `quid` → both treated as GBP).

**NUM regex accepts:** digits with optional decimal, optional leading `-`, and the word `minus` immediately before a digit token (`minus 5` → `-5`, `value_origin: literal`).

**Precedence and exclusion (overlapping rules):**

| Surface form | Wins | Why |
|---|---|---|
| `from 200k to 150k` | P11 | Leading `from` required (P11 guard); P2 excludes leading `from` (P2 guard) |
| `200k to 150k` | P2 | No leading `from`; not preceded by directional verb |
| `reduce to 150k` | P12 | Directional verb immediately before `to` (P12 guard); P2 excludes preceding directional verb |
| `5 to 10 months` | P2 | No `from`, no directional verb — treated as bare range |
| `between 5% and 7%` | P1 | Per-side units validated to match before merge |
| `between 5 and 10 months` | P1 | Single trailing unit applied to both bounds |
| `reduce by 10%` | P6 | Directional verb + `%` |
| `reduce by 10 engineers` | P6b | Directional verb + no `%` |
| `grew 5%` (no `by`) | P6b | Directional verb + `%` but **no `by`** — outside P6, refused by P9. See below. |
| `10%` (standalone) | P9 | No preceding directional verb |
| `5pp` | P13 | `pp` suffix takes precedence over bare number |
| `1.5 percentage points` | P13 | Word form of pp |

These guards must be implemented as explicit regex lookbehinds/lookaheads in the rule table, not relied on via priority alone.

#### P6 / P6b / P9 percentage territory — CORRECTED 2026-07-27 (ROADMAP 1.235)

This table previously said P6b "Must NOT contain `%` (P6 territory)", and
`P6B_REGEX` carries a trailing `(?!\s*%)` that was evidently written to enforce
it. **That guard does not work, and — more importantly — the rule it encodes is
not achievable as stated.**

- **Why the guard does not fire:** the lookahead sits *after* the optional
  `(UNIT)` group, and `UNIT` includes `%`. When `UNIT` consumes the `%`, the
  lookahead is evaluated past it and is trivially satisfied.
- **Why the rule is unachievable:** `P6_REGEX` requires a **mandatory** `by`,
  while P6b's `by` is optional. So `"grew 5%"`, `"raise it 5%"`,
  `"grow revenue 5%"` are outside P6 *by construction*, and P9 refuses any
  `N%` preceded by a direction verb. If P6b also declined them, the span would
  fall through to the compromise backstop — which returns the right number but
  drops `operator` and `direction` and reports `source: 'compromise'`
  (measured). That is the lower-fidelity-substitute failure §5 exists to
  prevent.

**Resolution: P6b legitimately owns "(direction-verb) N%" without `by`, and
normalises it like every other rule.** P6 still wins wherever it matches,
because P6 runs before P6b and masks the span — precedence, not exclusion.

**THE CONVENTION, stated once so it is not re-derived:** a result with
`unit: 'percentage'` always carries its value as a **fraction** (`5%` → `0.05`),
in `value`, `range_min` and `range_max` alike; `unit` is metadata, not a scale
factor. This is load-bearing: `mapCqeQuantityToProposalValue`
(`routing/deterministic-value-update.ts`) multiplies by 100 to recover user
units, so an un-normalised value becomes a 100x error on a value that is
deterministically applied to the user's graph. **`percentage_points` is the
deliberate exception** and stays a raw count (`5pp` → `5`); the same consumer
passes it through unscaled. Pinned over the whole rule table in
`extract-quantities.p6b-percentage.test.ts`.

### 4.3 Cross-cutting modifiers

Applied after primary pattern match:

- **`approximate: true`** when matched span is preceded within 3 tokens by `roughly | about | approximately | around | nearly | circa`
- **Suffix expansion** in P8: `k → ×1000`, `m | million → ×1,000,000`, `bn | billion → ×1,000,000,000`, `thousand → ×1000`. Sets `value_origin: suffix_expansion`
- **Direction inference** in P12 from verb: reduce/cut/lower/decrease/drop → down; increase/raise/grow → up; set/change → set
- **Word-fraction values** in P5: third → 0.333, quarter → 0.25, half → 0.5, two thirds → 0.667, three quarters → 0.75 (3 decimal places)

### 4.4 Post-match exclusion filters

After all rules run, drop matches where:

- Number is preceded by `v | V | q | Q | #` and followed by digit (versions: v2, Q4, #5)
- Number is followed by `st | nd | rd | th` (ordinals: 1st, 2nd, 3rd)
- Number is followed by `am | pm` or contains `:` (times: 4pm, 9:30)
- Number raw span exceeds 12 chars (phone numbers, IDs)

These exclusions apply to all patterns including compromise.

### 4.5 Ambiguous semantics handling (F.6 safety)

Where two interpretations are linguistically valid:

- **"reduce by a third"** → `operator: decrement, value: 0.333` (subtract one-third, leaving two-thirds). Per spec v3.1, this is the standard business reading. The alternative reading ("multiply by one-third") is rare in this phrasing
- **"reduce by -5"** → pass through as extracted (`value: -5, direction: down, operator: decrement`). Validator's scale check enforces bounds. CQE does not normalise into something "helpful"
- **"a few percent"** → `value: null, approximate: true, value_origin: lexical_quantifier, unit: percentage`. Sonnet clarifies
- **"set X to 70"** with no unit → `value: 70, unit: null`. Validator/Sonnet reconciles against target factor's unit

**Vague quantifier semantics (important):** when P10 emits `value: null` with `value_origin: lexical_quantifier`, this is a **successful ambiguity signal, not a failed parse**. The extraction did what it was designed to do — it detected a quantity intent without a defensible magnitude. Downstream consumers (routing prompt, validator) must treat these results as "clarify-required" not "fall back to other parsing" or "expand CQE to guess a number". Over-expanding CQE to assign numeric defaults where linguistic evidence is weak reintroduces F.6-adjacent risk: false precision in user-facing flows is worse than one extra clarification turn.

---

## 5. Interface contract

```typescript
function extractQuantities(rawMessage: string): QuantityExtractionResult[]
```

**Properties:**
- Pure function — no side effects, no state, no caching across calls
- Synchronous — no async
- Never throws — invalid input returns `[]` and emits telemetry
- Graph-blind — no graph or context access
- Deterministic — same input always produces same output
- Target latency: <5ms for messages <500 chars
- Hard cap: 2000 chars (longer messages truncated, `cqe_message_too_long` flag)
- Regex timeout: 50ms per pattern execution — see **Timeout behaviour** below (amended 2026-07-19; the original "fail closed to `[]`" clause is RETIRED and was never what the code did)

**Timeout behaviour (amended 2026-07-19 — supersedes the retired clause above):**

The original bullet read: *"On timeout: fail closed to `[]` plus telemetry. **No partial-result fallback** — risky without semantic guarantees."* It is retired for two reasons, and the deviation is recorded here rather than left implicit, because code and contract silently contradicting each other is how a future reader "fixes" this straight back into the P0.

1. **The shipped code never implemented it.** From the original CQE commit through 2026-07-19 the per-rule branch did `continue` — it neither returned `[]` nor failed closed. It dropped ONE rule's result and let later rules and the compromise backstop re-claim the now-unmasked span. That is precisely the "partial-result fallback" this clause forbade, and it was the mechanism of the P0: a skipped rule's span silently re-claimed by a lower-fidelity substitute emitting a **different number** (`"from £50k to £70k"` → two point quantities `50000, 70000` instead of one range, claimed by P8 with `source` still `cqe`; `"USD 1.2bn"` → `1.2` instead of `1200000000`, claimed by the backstop). *(The example originally given here was `"increase by about 10%"` → `10` instead of `0.1` via P6b. That one is withdrawn: the 100x was not caused by degradation but by P6b failing to normalise percentages at all — it returned `10` on the healthy path too. Fixed under ROADMAP 1.235; see §4.2. The degradation class itself is unaffected and is re-evidenced by the two examples above plus the operator-flip mode `"reduce to 5%"` `set` → `decrement`.)*

2. **The semantic guarantee the clause said was missing now exists.** `PatternRule.apply()` is all-or-nothing across all 15 rules — it returns a complete match set or nothing, never a partial one — and extraction output is timing-invariant (300/300 identical pairs at HEAD vs 18 divergences before the fix, same harness). Given that guarantee, a rule that ran to completion but slowly has produced a result exactly as correct as an in-budget one: a deterministic regex's slowness does not change what it matches.

**Behaviour as built:**

- **Per-rule cap exceeded, rule COMPLETED** → keep the result; emit `cqe.pattern_timeout`. This is a SLOW signal, not a correctness signal, and is the regex-redesign trigger the *Regex quality* note below asks for. The check runs *after* `apply()` returns, and JS regex is synchronous and non-interruptible, so discarding the result reclaims **zero** latency — the cost is already sunk — while destroying a correct answer. `summary.degraded` stays `false`; routing may apply the value.
- **Total budget exhausted, rules NEVER RAN** → those rules are genuinely missing, so `summary.degraded = true` and `cqe.budget_exhausted` is emitted naming exactly which pattern ids were skipped. Consumers that deterministically APPLY a value must refuse on `degraded` and fall through to LLM/clarify (`tryDeterministicValueUpdate` / `tryDeicticValueUpdate` return `skip_reason: 'degraded_extraction'`).

The invariant this preserves is the one the retired clause was reaching for: **a degraded extraction must never silently yield a value that gets deterministically applied.** It is enforced on provenance (did every rule run?), never on quantity count — the count is unchanged in the two demo corruption modes, and the corrupting rule may still report `source: 'cqe'`.

**Regex quality (for CC):** patterns must be designed to avoid catastrophic backtracking by construction — no unbounded nested quantifiers, no overlapping alternations without anchors, bounded repetition where possible. The 50ms timeout is defence-in-depth against pathological input, not a normal control-flow mechanism. If a regex regularly approaches the timeout, redesign the regex.

**Integration:** Called from `assembleContextPack()` at the start of turn assembly. Output populates `ContextPack.parsed_quantities`.

---

## 6. `value_origin` execution-safety policy

How downstream (routing prompt, validator) should treat each origin value:

| `value_origin` | Execution policy | Rationale |
|---|---|---|
| `literal` | Execution-safe subject to validation | Digits as written — highest confidence |
| `parsed_numeric` | Execution-safe subject to validation | Compromise-extracted from raw text — confidence equivalent to literal |
| `suffix_expansion` | Execution-safe subject to validation | Deterministic multiplication (k/m/bn) — confidence equivalent to literal |
| `word_fraction` | Execution-safe; preserve original phrasing in orientation | Linguistic convention is stable ("reduce by a third" means decrement by 0.333). Preserve phrasing so user sees what the system understood |
| `word_number` | Execution-safe **only when surrounding phrase is otherwise unambiguous** | "three engineers" = 3 engineers, safe. "add three" alone = ambiguous context, clarify |
| `lexical_quantifier` with `value != null` | Clarify-first | Only `couple → 2` falls here. Offer the inferred value as clarification ("Did you mean 2?"), don't execute silently |
| `lexical_quantifier` with `value == null` | Clarify-required | Successful ambiguity signal. No defensible magnitude. Ask for the number |

The validator enforces these policies structurally. The routing prompt's PARAMETERS section teaches Sonnet to apply the same rules in its orientation text. When validator and prompt disagree, **validator wins** (same principle as entity resolution in spec v3.2 §6 check #3).

---

## 7. Internal match metadata

Kept internal (not in public schema), available via debug telemetry:

```typescript
interface InternalMatchMetadata {
  char_offset_start: number;
  char_offset_end: number;
  raw_span: string;
  pattern_id: string;          // P1, P2, ..., P13, "compromise"
  source: "cqe" | "compromise";
}
```

Used for: debugging extraction errors, evaluation harness analysis, identifying which patterns fire most/least, telemetry.

---

## 8. Test fixtures (68 cases)

Format: TypeScript fixtures file at `tests/fixtures/cqe-fixtures.ts`. CC writes unit tests against this fixture set plus a property-based test (length of input, no exception thrown, output is valid array).

### 8.1 Canonical patterns (13)

| # | Input | Expected primary fields |
|---|---|---|
| C01 | `"set X to 0.9"` | value: 0.9, operator: set, direction: set, value_origin: literal |
| C02 | `"reduce by a third"` | value: 0.333, operator: decrement, direction: down, value_origin: word_fraction |
| C03 | `"roughly double"` | multiplier: 2.0, operator: multiply, approximate: true |
| C04 | `"increase by about 10%"` | value: 0.10, operator: increment, direction: up, unit: percentage, approximate: true |
| C05 | `"increase by 5 percentage points"` | value: 5, unit: percentage_points, operator: increment, direction: up |
| C06 | `"the budget is £150k"` | value: 150000, unit: GBP, value_origin: suffix_expansion |
| C07 | `"between 5 and 10"` | range_min: 5, range_max: 10, comparator: between |
| C08 | `"cut budget from 200k to 150k"` | value: 150000, range_min: 200000, range_max: 150000, operator: set, direction: down |
| C09 | `"reduce churn to 5%"` | value: 0.05, operator: set, direction: down, unit: percentage |
| C10 | `"4 months"` | value: 4, unit: months |
| C11 | `"at least 3 senior developers"` | value: 3, comparator: at_least |
| C12 | `"70% confidence"` | value: 0.70, unit: percentage |
| C13 | `"a couple of factors"` | value: 2, approximate: true, value_origin: lexical_quantifier |

### 8.2 Multi-quantity (3)

| # | Input | Expected |
|---|---|---|
| M01 | `"Set speed to 0.9 and cost to 50000"` | Two: speed=0.9 set; cost=50000 set |
| M02 | `"Increase price by 10% and reduce churn by 5%"` | Two: 0.10 increment up percentage; 0.05 decrement down percentage |
| M03 | `"Budget £150k, 6 months, at least 3 developers"` | Three results in order |

### 8.3 Embedded in prose (6)

| # | Input | Expected |
|---|---|---|
| E01 | `"I think the budget should be around £150k given our constraints"` | One: 150000 GBP, approximate: true |
| E02 | `"We need at least 80% confidence before committing"` | One: 0.80 at_least percentage |
| E03 | `"The team grew by roughly half over the year"` | One: 0.5 multiply approximate, value_origin: word_fraction |
| E04 | `"raise price by 5 points"` | One: 5 increment up. "points" not in unit table — unit: null. Acceptable for PoC |
| E05 | `"reduce by one third"` | value: 0.333, operator: decrement, direction: down, value_origin: word_fraction (spaced form of P5) |
| E06 | `"a couple more factors"` | value: 2, approximate: true, value_origin: lexical_quantifier (P10 handles "a couple" with or without "of") |

### 8.4 Vague quantifiers (5)

| # | Input | Expected |
|---|---|---|
| V01 | `"add a couple of factors"` | value: 2, approximate: true, value_origin: lexical_quantifier |
| V02 | `"a few options"` | value: null, approximate: true, value_origin: lexical_quantifier |
| V03 | `"several risks to consider"` | value: null, approximate: true, value_origin: lexical_quantifier |
| V04 | `"a handful of constraints"` | value: null, approximate: true, value_origin: lexical_quantifier |
| V05 | `"many factors affect this"` | value: null, approximate: true, value_origin: lexical_quantifier |

### 8.5 Currency variants (7)

| # | Input | Expected |
|---|---|---|
| Cu01 | `"$50k budget"` | One: 50000 USD, value_origin: suffix_expansion |
| Cu02 | `"€200 million"` | One: 200000000 EUR, value_origin: suffix_expansion |
| Cu03 | `"150 GBP"` | One: 150 GBP |
| Cu04 | `"£1.5m budget"` | One: 1500000 GBP, value_origin: suffix_expansion |
| Cu05 | `"USD 1.2bn"` | One: 1200000000 USD, value_origin: suffix_expansion |
| Cu06 | `"about 50 grand"` | One: 50000 GBP, approximate: true, value_origin: suffix_expansion |
| Cu07 | `"150 quid"` | One: 150 GBP, value_origin: suffix_expansion |

### 8.6 By/to/from patterns (8)

| # | Input | Expected |
|---|---|---|
| B01 | `"increase budget by £50k"` | value: 50000, unit: GBP, operator: increment, direction: up |
| B02 | `"increase conversion from 3% to 5%"` | value: 0.05, range_min: 0.03, range_max: 0.05, operator: set, direction: up, unit: percentage |
| B03 | `"bring timeline down to 4 months"` | value: 4, unit: months, operator: set, direction: down |
| B04 | `"add 2 engineers"` | value: 2, operator: add, direction: up |
| B05 | `"cut 50k from budget"` | value: 50000, operator: decrement, direction: down |
| B06 | `"between 5% and 7%"` | range_min: 0.05, range_max: 0.07, comparator: between, unit: percentage (per-side units match, P1) |
| B07 | `"from £50k to £70k"` | value: 70000, range_min: 50000, range_max: 70000, operator: set, direction: up, unit: GBP (P11 per-side units) |
| B08 | `"increase by 1.5 percentage points"` | value: 1.5, unit: percentage_points, operator: increment, direction: up (decimal pp) |

### 8.7 Comparators (5)

| # | Input | Expected |
|---|---|---|
| Co01 | `"under 6 months"` | value: 6, unit: months, comparator: at_most |
| Co02 | `"up to 5 options"` | value: 5, comparator: at_most |
| Co03 | `"no more than 3 hires"` | value: 3, comparator: at_most |
| Co04 | `"three to five months"` | range_min: 3, range_max: 5, comparator: between, unit: months (after word-number pre-pass) |
| Co05 | `"under £50k"` | value: 50000, unit: GBP, comparator: at_most, value_origin: suffix_expansion |

### 8.8 Negatives and edge values (4)

| # | Input | Expected |
|---|---|---|
| N01 | `"set the offset to -5"` | value: -5, operator: set, direction: set |
| N02 | `"reduce to 0"` | value: 0, operator: set, direction: down |
| N03 | `"increase by 0%"` | value: 0, operator: increment, direction: up, unit: percentage |
| N04 | `"set offset to minus 5"` | value: -5, operator: set, direction: set (word "minus" resolves via NUM regex) |

### 8.9 Compound action with question (per finding C) (2)

| # | Input | Expected (CQE only) |
|---|---|---|
| Q01 | `"Set churn to 5% and what's the impact?"` | One: 0.05 set down percentage. Question handled by Component 5 (compound detection) |
| Q02 | `"Add a factor and explain why it matters"` | Empty from CQE. Component 5 handles compound action+question |

### 8.10 Adversarial / edge (5)

| # | Input | Expected |
|---|---|---|
| A01 | `"between five and ten"` | range_min: 5, range_max: 10, comparator: between (after word-number pre-pass) |
| A02 | `"a few percent"` | value: null, approximate: true, unit: percentage, value_origin: lexical_quantifier |
| A03 | `"set churn to roughly 5% to 7%"` | range_min: 0.05, range_max: 0.07, comparator: between, unit: percentage, approximate: true (P2 takes precedence over P9 via masking) |
| A04 | `"one or two factors"` | Two compromise extractions (1, 2). Acceptable for PoC; flagged for review |
| A05 | `"3–5 months"` (en dash, U+2013) | range_min: 3, range_max: 5, comparator: between, unit: months (P2 accepts hyphen and en dash) |

### 8.11 Should not extract (5)

| # | Input | Expected |
|---|---|---|
| X01 | `"version 2 of the proposal"` | `[]` (excluded by version filter) |
| X02 | `"Q4 results were strong"` | `[]` (excluded by version filter) |
| X03 | `"option 3 looks best"` | `[]` (compromise extracts 3, but excluded by post-filter — option N is a UI reference, not a quantity) |
| X04 | `"meeting at 4pm tomorrow"` | `[]` (excluded by time filter) |
| X05 | `"call me on 020 7946 0123"` | `[]` (excluded by length cap) |

### 8.12 No quantities (3)

| # | Input | Expected |
|---|---|---|
| Z01 | `"I think we should outsource"` | `[]` |
| Z02 | `""` | `[]` |
| Z03 | `"What about churn?"` | `[]` |

### 8.13 Acceptable misses (PoC) (2)

These are documented as acceptable misses for PoC. CQE does not extract; logged via telemetry for upgrade decisions.

| # | Input | Expected | Why |
|---|---|---|---|
| Mi01 | `"double-digit growth"` | `[]` | Hyphenated descriptor, not a quantity |
| Mi02 | `"mid-single-digit churn"` | `[]` | Vague descriptor, not a quantity |

Note: `grand` and `quid` are now supported via P8 (UK colloquial currency → GBP). Previously acceptable misses `"about 50 grand"` and `"150 quid"` moved to §8.5 Currency variants.

---

## 9. Telemetry

Per extraction call, emit:

```typescript
{
  event: 'cqe.extraction',
  message_length: number,
  result_count: number,
  cqe_match_count: number,
  compromise_match_count: number,
  patterns_matched: string[],          // e.g. ["P7", "P9"]
  duration_ms: number,
  timeout: boolean,
  message_too_long: boolean,
  word_range_missed: boolean,          // e.g. "between five and ten" failed
  ambiguous_phrasing_detected: boolean // for upgrade signal
}
```

This data answers: which patterns are firing in production, where compromise compensates for CQE gaps, where CQE is timing out, where the upgrade trigger is approaching.

---

## 10. Production upgrade triggers

Per spec v3.1 §11.1: Haiku selective fallback when telemetry shows creative phrasings the deterministic path misses. Concrete triggers:

- `word_range_missed` rate exceeds 5% of turns with quantities
- Compromise-only extractions exceed 30% of all extractions (CQE patterns too narrow)
- Per-pattern miss rate from human transcript review exceeds 10%
- New ambiguous phrasings appear in transcripts that don't fit existing patterns

When triggered: design Haiku fallback brief, JSON-schema validation + fail-closed.

---

## 11. Dependencies and constraints

**Depends on:**
- Routing prompt v6 live in PMS (precondition for end-to-end testing, not for CQE itself)
- `QuantityExtractionResult` v1.1 in `@olumi/contracts/orchestrator`

**Does NOT depend on:**
- Graph state (CQE is graph-blind)
- Handler registry
- Validator
- Coaching context
- LLM adapters

**Must NOT contain:**
- Graph access of any kind
- LLM calls or async operations
- State or caching across calls
- Knowledge of specific factor scales beyond the generic UNIT regex
- Partial-result fallback on timeout
- Silent normalisation of ambiguous semantics (e.g. clamping negatives to zero)
- Hand-coded if/else cascades — use the declarative rule table

---

## 12. Routing prompt v6 alignment

Routing prompt v6 PARAMETERS section already teaches Sonnet to consume `parsed_quantities`. Two small additions required when CQE ships (Paul authors):

1. **`value_origin` consumption rule:** "When `value_origin: lexical_quantifier` is present and `value` is non-null, present the inferred value as a clarification ('Did you mean 2?'). When `value` is null, ask for the magnitude. When `value_origin: word_fraction`, trust the value but note the original phrasing in the orientation text."

2. **Percentage points distinction:** "When `unit: percentage_points`, the value is raw (e.g. 5 means 5pp, not 0.05). Do not divide. Distinct from `unit: percentage` where value is already a fraction."

These prompt changes are not blockers for CQE implementation — they ship together but the prompt edit is independent.

---

## 13. Open questions

None outstanding. All design decisions resolved per ChatGPT challenger pass 1 and Paul approval (19 April 2026).

---

*End of CQE Design v1*
