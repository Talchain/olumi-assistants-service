# CQE Investigation Proposal

**Brief:** cqe-investigation-v1.1 (19 April 2026)
**Author:** CC (Claude Code), assisted by Paul (review, decisions)
**Date:** 20 April 2026
**Branch:** `claude/v5-cqe-investigation` (local, uncommitted)
**Status:** For Paul review. No implementation work to follow until this proposal is approved.

**Tag legend:** every finding or recommendation in §2-§4 and §10 carries one of:
- **OBS:** observed in code, with file:path:line citation
- **INF:** inferred from code patterns, not directly verified
- **DES:** design assumption from spec v3.2 or CQE Design v1.1
- **OPN:** open question for Paul

---

## 1. Executive summary

The CQE component fits cleanly into the existing V5 turn pipeline. The exact insertion point ([context-pack-assembler.ts:138](src/orchestrator-v5/context/context-pack-assembler.ts#L138), `assembleContextPack()`), the serialisation path to Sonnet ([route-with-tool-use.ts:310-318](src/orchestrator-v5/routing/route-with-tool-use.ts#L310-L318), `JSON.stringify(contextPack, null, 2)` with no replacer), the sibling component pattern ([compound-detector.ts:49](src/orchestrator-v5/routing/compound-detector.ts#L49)), and the package surface (`@talchain/schemas/orchestrator` at vendored 0.5.1) all align with the design with one terminology gap and one ownership question that must be flagged.

**Recommended path:** add `QuantityExtractionResult` to `@talchain/schemas/orchestrator` as a minor bump from 0.5.1 to 0.6.0, vendor as a new tarball, then build the CQE module under `src/orchestrator-v5/context/cqe/` and wire it into `assembleContextPack()` between compound detection and graph projection. Telemetry uses both the routing log (per-turn debugging) and a new `cqe.extraction` telemetry event (aggregate observability and upgrade-trigger alerts), with a per-field split that excludes the high-cardinality `patterns_matched` from the event.

**Two findings the reader must hold while reading the rest of this proposal:**

1. **Routing prompt v6 is a PMS artefact, not a code-loaded template.** CQE Design v1.1 §11 and §12 reference the routing prompt's PARAMETERS section as a code-side construct. In CEE V5, no string-template prompt is loaded. The LLM receives `JSON.stringify(contextPack)` as the user message together with a hardcoded tool description ([tool-schema.ts:37-41](src/orchestrator-v5/routing/tool-schema.ts#L37-L41)). PARAMETERS-section additions for `value_origin` and `percentage_points` are PMS-side edits Paul authors. CEE code does not need a routing prompt loader for CQE to ship. Detail in §5 and Appendix B.

2. **`ContextPack` is currently CEE-local, not exported from `@talchain/schemas`.** Boundary Contract v1.1 §2.1 lists `ContextPack` as an `@olumi/contracts/orchestrator` export. The codebase has it defined locally in [context-pack-assembler.ts:85-100](src/orchestrator-v5/context/context-pack-assembler.ts#L85-L100). This is permitted for CEE-internal types under §1 of the contract, but the `parsed_quantities` field that CQE adds is a cross-service-shaped shape (the QER schema itself goes in the package). The proposal recommends keeping `ContextPack` local for now and migrating it later as a separate cleanup brief; CQE does not block on this. Detail in §4 and Appendix B.

**Top risks:**
- Adding `compromise + compromise-numbers` as new dev/runtime dependencies (neither is currently installed; see [package.json](package.json) verified absent). Bundle size impact and Node V8 backtracking behaviour need empirical validation per the §8 benchmark matrix.
- Pattern P11 (`from X to Y` with per-side units) is the highest-risk regex by construction; structural rewrite recommended before implementation. See §3.
- Telemetry event `cqe.extraction` requires explicit per-event Datadog routing in [telemetry.ts](src/utils/telemetry.ts) (the switch is hardcoded, not a registry). See §7.

---

## 2. Codebase findings

### 2.1 Layer 0 insertion point

**Finding [OBS]:** `assembleContextPack(input: AssembleContextPackInput): ContextPack` is the assembler's entry function at [src/orchestrator-v5/context/context-pack-assembler.ts:138](src/orchestrator-v5/context/context-pack-assembler.ts#L138). Its current order of operations is:
1. [line 139](src/orchestrator-v5/context/context-pack-assembler.ts#L139): `const compound = detectCompound(input.payload.message)` (Layer 0 deterministic gate)
2. [line 143](src/orchestrator-v5/context/context-pack-assembler.ts#L143): `projectGraph(input.graph)` (graph projection)
3. [line 144](src/orchestrator-v5/context/context-pack-assembler.ts#L144): `projectAnalysis(input.analysis)` (analysis compaction)
4. [line 145](src/orchestrator-v5/context/context-pack-assembler.ts#L145): `projectConversation(input.payload, input.priorTurns)` (conversation projection)

**Finding [OBS]:** The assembler is called from [src/orchestrator-v5/turn-executor.ts:301](src/orchestrator-v5/turn-executor.ts#L301) inside the ORIENT step, before any routing or validation. No conditional bypass: the same assembly runs for action turns and for non-action turns where Sonnet emits no tool call.

**CQE insertion point:** between line 139 (compound detect) and line 143 (graph projection). One line added in the assembler body, one field added to the `ContextPack` interface, one helper module imported. **[INF]** No other call sites need changes.

**Conclusion:** `assembleContextPack()` is the correct insertion point and has the exact name the design references; the file:line is unambiguous.

### 2.2 Seven-step turn assembly

**Finding [OBS]:** `runTurnExecutor(payload, requestId, options): Promise<TurnExecutorRunResult>` at [src/orchestrator-v5/turn-executor.ts:174](src/orchestrator-v5/turn-executor.ts#L174) implements the seven steps as discrete code regions: ORIENT (lines 287-344), VALIDATE (358-426), EXECUTE (428-445), CONFIRM (450-452), COACH (454-455, currently a null stub), COMPOSE (457-542), COMMIT (544-572). The Layer 0 assembly happens inside ORIENT.

**Finding [OBS]:** Non-action turns (intent_class `coach`, `converse`, `clarify`, or text-only with no tool call) skip VALIDATE/EXECUTE/CONFIRM but execute the same ORIENT step. The assembler call at line 301 is unconditional. CQE output therefore reaches Sonnet on every turn class, satisfying CQE Design v1.1 §2 and brief §4.1.

**Conclusion:** the V5 seven-step structure exists in code and the non-action turn path was traced; CQE inherits the right call frequency without any changes to TurnExecutor's branching.

### 2.3 Existing Layer 0 inventory

**Finding [OBS]:** Layer 0 in the current code consists of compound detection only (executed inline within `assembleContextPack()`). The CQE Design v1.1 §2 ASCII diagram lists "system event check" and "chip click check" as preceding Layer 0 functions; **neither exists in the V5 code path today.** [DES] These are aspirational gates that will be added in future briefs. CQE inserts after compound detect, before graph projection. The diagram in CQE Design v1.1 §2 should be updated; see Appendix B.

**Conclusion:** the existing Layer 0 is a single-step pipeline (compound detect); CQE makes it two-step. System-event and chip-click gates do not block CQE.

### 2.4 Pre-existing quantity-parsing code

**Finding [OBS]:** `extractNumericValues(text: string): number[]` at [src/context/resolver.ts:340](src/context/resolver.ts#L340) is a V4 utility used for hallucination validation (post-LLM, not pre-LLM). It returns a flat `number[]` with no operator, direction, comparator, or unit. Its regex patterns (currency with k/m/b multipliers at [resolver.ts:353](src/context/resolver.ts#L353), percentages at [resolver.ts:364](src/context/resolver.ts#L364), plain numbers at [resolver.ts:372](src/context/resolver.ts#L372)) are conceptually similar to several of CQE's 13 patterns. The output shape is incompatible with `QuantityExtractionResult`, so the function cannot be reused as-is.

**Conclusion:** no existing quantity-parsing utility serves CQE's purpose. The V4 patterns are a useful sanity check on regex construction but the new code is greenfield.

### 2.5 ContextPack type and `parsed_quantities` field

**Finding [OBS]:** `ContextPack` interface at [src/orchestrator-v5/context/context-pack-assembler.ts:85-100](src/orchestrator-v5/context/context-pack-assembler.ts#L85-L100) does not declare a `parsed_quantities` field. Codebase grep for `parsed_quantities` returns zero matches. CQE adds the field as a purely additive change.

**Finding [OBS]:** `ContextPack` is locally defined and not imported from `@talchain/schemas`. Per Boundary Contract v1.1 §2.1, this type belongs in `@talchain/schemas/orchestrator`. Currently it is not. This is permitted by §1 (CEE-internal types) but it is a known gap. **[OPN]** Whether to migrate `ContextPack` into the package as part of CQE work, or as a separate cleanup brief, is Paul's call. The proposal recommends the latter to keep CQE scope tight.

**Conclusion:** the field is greenfield and additive; the broader question of `ContextPack` ownership is a separate cleanup. CQE does not block on it.

### 2.6 Available imports and current package surface

**Finding [OBS]:** `@talchain/schemas` v0.5.1 is pinned at [package.json:69](package.json#L69) as `"file:./vendor/talchain-schemas-0.5.1.tgz"`. The package exports three sub-paths via `node_modules/@talchain/schemas/package.json` (verified): `.` (root), `./boundary`, `./orchestrator`. The `/orchestrator` namespace currently exports (per source at `~/Documents/GitHub/olumi-schemas/src/orchestrator/index.ts`): `TurnContextSchema`, `LLMAdapterRequestSchema`/`Response`, `ConversationMessageSchema`, `V5ActionTypeSchema`, session types, decision context, and seven per-handler argument and result schemas. **No `QuantityExtractionResult` or `ContextPack` exists today.** **[OBS]**

**Conclusion:** the namespace exists, the structure supports a new schema export, no name collision.

---

## 3. Library recommendation

### 3.1 Library choice for the deterministic backstop

**Finding [OBS]:** Neither `compromise` nor `compromise-numbers` is currently in [package.json](package.json) (verified by grep). They must be added as runtime dependencies if the design's compromise backstop is implemented as specified.

**Comparison:**

| Option | Where it runs | Pros | Cons | Recommendation |
|---|---|---|---|---|
| compromise + compromise-numbers (CQE Design choice) | In-process Node.js | Deterministic, zero infra, ~150-200KB gzipped, F.6-compliant | New dependency, Node V8 backtracking risk on adversarial input | **Recommended.** Aligns with design; matches PoC cost target (£0); compatible with `@talchain/schemas` policy of in-process types |
| Duckling | Haskell sidecar | Mature, multi-language, strong on time/dates | Out-of-process, deployment complexity, design says "no off-the-shelf tool preserves directional modifiers" | Reject for PoC |
| Quantulum3 | Python sidecar | Strong scientific units | Out-of-process, Python runtime needed | Reject for PoC |
| Custom word-number lexicon only (no compromise) | In-process Node.js | Smallest surface | Misses compromise's broad numeric coverage; risks under-extraction | Reject. Compromise is the safety net, not the primary path |

**Recommendation [OBS]:** keep CQE Design's compromise backstop. Add `compromise` and `compromise-numbers` to `package.json` runtime dependencies. Latency expectations are validated empirically in §8.

### 3.2 Regex engine and timeout strategy

**Finding [OBS]:** Node.js V8 regex is a backtracking NFA (no native timeout). The CQE Design's 50ms per-pattern hard timeout (§5) requires either:
- Wrapping each `regex.exec()` in a wall-clock timer with abort (no V8 hook for mid-execution cancellation, so this is a CPU-second after-the-fact check)
- Switching to a re2-like library (`re2` Node binding, `safe-regex2` for static analysis only)

**Recommendation [INF]:** **defence-in-depth via wall-clock check, not a re2 swap.** Rationale:
- The 13 design patterns can be authored to avoid catastrophic backtracking by construction (see §3.3)
- Adding `re2` introduces a native dependency with platform-specific build artefacts (problematic for a vendored-only stack)
- The 50ms timeout is a circuit-breaker, not a normal control-flow mechanism. If a pattern routinely approaches 50ms, redesign the pattern.
- Defence-in-depth: if a pattern goes pathological in production, fail closed to `[]` and log via the new `cqe.extraction` event (§7) with `timeout: true`.

### 3.3 Per-pattern regex safety assessment (all 13 patterns)

**Finding [OBS]:** the 13 patterns in CQE Design v1.1 §4.2 each carry a different backtracking risk profile. Per-pattern assessment (this is design-side analysis ahead of implementation):

| ID | Pattern | Backtracking risk [INF] | Concern | Action before implementation |
|---|---|---|---|---|
| P1 | `range_between` | medium | Per-side units add alternation; "between X[unit] and Y[unit]" needs careful boundary | Anchor unit token to NUM, no nested quantifier |
| P2 | `range_dash` | medium | `from`/directional-verb negative lookbehinds compound with hyphen-or-en-dash alternation | Use lookbehind, not capture; bounded alternation |
| P3 | `comparator_value` | low | Bounded fixed-list alternation | None |
| P4 | `multiplier_verb` | low | Small fixed verb set | None |
| P5 | `word_fraction` | medium | Spaced word-fraction forms multiply with directional verbs (e.g. "reduce by two thirds") | Pre-tokenise word fractions as their own pass before P5 runs |
| P6 | `directional_percent` | low | Percent guard is a literal `%` | None |
| P6b | `directional_absolute` | low | Negative lookahead for `%` | None |
| P7 | `set_verb_value` | low | Small verb set, fixed alternation | None |
| P8 | `currency` | medium | Colloquial words (`grand`, `quid`) plus suffix table; multiple currency symbol alternations | Anchor to NUM; bound suffix repetition; explicit symbol set |
| P9 | `bare_percentage` | low | Negative lookbehind for direction verbs | None |
| P10 | `vague_quantifier` | low | Small fixed quantifier list | None |
| P11 | `from_to` | **high** | Leading `from` + per-side units + trajectory inference; nested optional unit on each side | **Structural rewrite required:** split into two anchored sub-patterns (with-unit and without-unit), merge in code. Avoid one mega-regex. |
| P12 | `to_value` | medium | Directional-verb-immediately-before-`to` lookbehind | Anchor to verb token; bounded verb list |
| P13 | `percentage_points` | low | Bounded suffix forms (`pp`, `percentage points`) | None |

**Highest-risk pattern: P11.** Implement as split sub-patterns (with-units and without-units variants), merge the results in code. Do not author a single regex with optional per-side unit alternation.

**Conclusion:** compromise + compromise-numbers is the correct backstop choice; native V8 regex with a 50ms wall-clock timer is sufficient if the patterns are authored to avoid backtracking by construction; P11 needs structural rewriting before implementation.

---

## 4. Schema integration plan

### 4.1 Where `QuantityExtractionResult` v1.1 lives

**Recommendation [OBS]:** add the schema to `@talchain/schemas/orchestrator`. Specifically:
- New file: `~/Documents/GitHub/olumi-schemas/src/orchestrator/quantity-extraction.ts` (alongside existing `handler-args.ts`, `handler-results.ts`, `turn-context.ts`, etc.)
- Re-exported from `~/Documents/GitHub/olumi-schemas/src/orchestrator/index.ts`
- Zod schema named `QuantityExtractionResultSchema`; type alias `QuantityExtractionResult` via `z.infer<>`
- Field shape per CQE Design v1.1 §3 (the v1.1 schema with optional `value_origin`)

This matches the namespace pattern used for handler args/results [OBS at `~/Documents/GitHub/olumi-schemas/src/orchestrator/index.ts`].

**Take-away:** QER lives in `@talchain/schemas/orchestrator` alongside the existing handler-args and handler-results modules.

### 4.2 Version bump

**Recommendation [OBS]:** **bump from 0.5.1 to 0.6.0 (minor).**

Rationale, evidence-based:
- The `olumi-schemas` repo documents an explicit semver policy at `~/Documents/GitHub/olumi-schemas/README.md` lines 90-100: "New schemas, new optional fields, new enum values: Minor."
- Observed history matches the policy. Recent minor bumps:
  - 0.4.0 → 0.5.0 (handler-fact union + per-handler args/results) was a multi-schema additive expansion
  - 0.3.0 → 0.4.0 (populate `/orchestrator` subpath) was a new namespace populated
  - 0.2.1 → 0.3.0 (boundary subpath + orchestrator stub) was new namespaces
- The most recent patch bump (0.5.0 → 0.5.1) was explicitly "defensive schema tightening" with no new exports, which is different in kind from adding a schema
- A new exported schema for a new component is the canonical minor-bump case per both the policy and history
- Major bump (1.0.0) is reserved for breaking changes and rare in pre-1.0 [DES per Boundary Contract v1.1 §2.3]

**Take-away:** bump 0.5.1 to 0.6.0 (minor) per the documented semver policy and observed history.

### 4.3 Vendor mechanics

**Recommendation [OBS]:** the vendoring procedure is documented at [vendor/README.md:22-42](vendor/README.md#L22-L42). The exact steps for the bump are:

1. Edit `~/Documents/GitHub/olumi-schemas/src/orchestrator/quantity-extraction.ts` (new file with QER schema)
2. Edit `~/Documents/GitHub/olumi-schemas/src/orchestrator/index.ts` (re-export)
3. Bump `~/Documents/GitHub/olumi-schemas/package.json` version to 0.6.0
4. `npm run build` then `npm pack` in the schemas repo
5. Copy `talchain-schemas-0.6.0.tgz` into CEE's `vendor/` directory
6. Update CEE [package.json:69](package.json#L69) to `"@talchain/schemas": "file:./vendor/talchain-schemas-0.6.0.tgz"`
7. `pnpm install` in CEE
8. Verification: existing imports compile cleanly; `import { QuantityExtractionResult } from '@talchain/schemas/orchestrator'` resolves

The pin is path-based (not semver-based), so the version string is cosmetic from CEE's perspective. What matters is that the tarball contents at the pinned path contain the new schema.

**Take-away:** vendor mechanics are documented and mechanical; eight steps from edit to consumable.

### 4.4 Downstream consumer impact

**Finding [OBS]:** schema addition is purely additive. Existing imports in CEE (verified by grep across `src/`) reference specific named symbols from `@talchain/schemas/orchestrator`, never wildcard imports that would be affected by a new export. No CEE code changes are needed alongside the package bump.

**Finding [INF]:** PLoT and UI repos are not in this workspace and were not investigated. **[OPN]** if either consumes `@talchain/schemas` and needs `QuantityExtractionResult` (probably not for PoC; it is a CEE-internal Layer 0 output), they would need their own vendor swap. The proposal assumes CEE-only consumption for now.

**Finding [OBS]:** the schemas repo has no CHANGELOG file. Versioning is captured entirely in commit messages (verified by `find` at `~/Documents/GitHub/olumi-schemas/`). The bump commit message should follow the observed convention: `feat(v5): v0.6.0 quantity extraction schema for CQE`.

**Take-away:** schema addition is purely additive; no CEE code changes are needed alongside the bump; PLoT and UI consumption is not assumed for PoC and is flagged as an open question.

### 4.5 PR structure

**Recommendation [OBS]:** **single CEE PR covering all of: schemas package bump (vendored tarball), CQE module, assembler wire-up, telemetry hookup, tests.** Rationale:
- The vendored `file:` pin means the schemas repo and CEE are in lock-step. Splitting them into two PRs creates a window where CEE imports from a tarball that doesn't yet exist in the vendored path.
- Boundary Contract v1.1 §2.4 says cross-service schema changes require accompanying PRs in all four repos before merge. Adding `QuantityExtractionResult` is CEE-internal in practice (no PLoT or UI consumer in PoC), so the cross-repo requirement reduces to "one CEE PR with the vendored bump and the consumer code together."

**Take-away:** single CEE PR bundles the vendored tarball and the consumer code; splitting them creates a broken-state window.

**Conclusion (section §4):** the schema bump is a minor (0.5.1 to 0.6.0); the vendor procedure is documented; the change is additive and bundled into one CEE PR.

---

## 5. Routing prompt alignment and serialisation

### 5.1 Serialisation path: `value_origin` survives end-to-end

**Finding [OBS]:** the headline path is `JSON.stringify(contextPack, null, 2)` at [route-with-tool-use.ts:313](src/orchestrator-v5/routing/route-with-tool-use.ts#L313) inside `buildUserMessage(contextPack: ContextPack, message: string): string`. No replacer, no allowlist, no field filtering, no Pick<>/Omit<>.

**Finding [OBS]:** the assembler-to-router path at [turn-executor.ts:301-308](src/orchestrator-v5/turn-executor.ts#L301-L308) preserves the full `ContextPack` reference. No intermediate transform, no destructuring, no narrowing.

**Finding [OBS]:** verified absence of stripping helpers across the codebase. Grep for `compactContextPack`, `summariseContextPack`, `redactContextPack`, `Pick<ContextPack`, `Omit<ContextPack` returns zero results. There is no narrowing helper between `assembleContextPack()` and `routeWithToolUse()`.

**Finding [OBS]:** sanitisation in [src/utils/telemetry.ts:520-579](src/utils/telemetry.ts#L520-L579) (`sanitizeTelemetryValue`) is recursively permissive: it walks `Object.entries()` and only drops fields whose values are `undefined`. Optional `value_origin` strings would survive.

**Finding [OBS]:** the routing log at [src/orchestrator-v5/routing/routing-log.ts:38-73](src/orchestrator-v5/routing/routing-log.ts#L38-L73) is a structured projection (explicit field list, not a spread), so `parsed_quantities` (and therefore `value_origin`) does not appear there today. Adding it requires explicit edits per §7.

**Finding [OBS]:** the `TurnExecutorCompleted` telemetry event at [turn-executor.ts:575](src/orchestrator-v5/turn-executor.ts#L575) plucks specific scalar fields (`stages_completed`, `wall_clock_ms`, etc.) and does not pass the ContextPack object. `value_origin` would not surface there unless explicitly added.

**Conclusion:** `value_origin` survives the headline path that matters for the LLM input. Routing log and telemetry event surfaces require explicit schema additions per §7; that is a feature, not a bug, since those surfaces are deliberately structured projections rather than passthroughs.

### 5.2 Test fixture support

**Finding [OBS]:** the assembler test file [src/orchestrator-v5/context/__tests__/context-pack-assembler.test.ts](src/orchestrator-v5/context/__tests__/context-pack-assembler.test.ts) constructs `ContextPack` by calling `assembleContextPack()` (lines 22-91 inspected). No fixture helper uses `Pick<>` or constructs the object literal field-by-field with an allowlist. Adding `parsed_quantities` to the assembler's return type means the field automatically appears in test output too.

**Conclusion:** test fixtures inherit the new field for free; no fixture rewrites required.

### 5.3 Routing prompt v6: design-versus-code mismatch

**Finding [OBS]:** the V5 routing path does not load a string-template prompt. [route-with-tool-use.ts:160-184](src/orchestrator-v5/routing/route-with-tool-use.ts#L160-L184) builds a `chatWithTools` call with `messages: [{ role: 'user', content: userMessage }]` (where `userMessage` is the JSON-serialised ContextPack plus the raw user message) and a tool definition. The tool's description is a hardcoded string at [tool-schema.ts:37-41](src/orchestrator-v5/routing/tool-schema.ts#L37-L41), not loaded from a file.

**Finding [DES]:** CQE Design v1.1 §11 and §12 state that the routing prompt's PARAMETERS section consumes `parsed_quantities` and that two additions (value_origin consumption, percentage_points distinction) must happen when CQE ships. The reference docs the user supplied include `olumi-v5-routing-prompt-v6.txt` as a flat text file structured as XML-like sections (`<ROLE>`, `<PRIMARY_RULES>`, `<PARAMETERS>`, etc.), suggesting it is a PMS artefact that Sonnet sees via system message wiring elsewhere (not in CEE code).

**Conclusion:** the spec's terminology assumes a code-side prompt template. The code does not have one. The PARAMETERS-section additions for value_origin and percentage_points are PMS-side edits Paul authors. CEE code does not need a routing prompt loader for CQE to work; the JSON-serialised ContextPack already delivers the data structure to Sonnet. **This is the most important Appendix B mismatch.**

---

## 6. Testing plan

### 6.1 Test framework and conventions

**Finding [OBS]:** Vitest is the test framework (verified at `vitest.config.ts`). Test naming convention is `*.test.ts` (no `*.spec.ts`). Coverage thresholds: 90% lines/functions/statements, 85% branches.

### 6.2 Fixture file

**Recommendation [OBS]:** **place fixtures at `tests/fixtures/cqe-fixtures.ts`** as the design specifies. The repo has both JSON fixtures (under `tests/fixtures/`) and inline TypeScript fixtures (e.g. [tests/integration/phase1-routing-end-to-end.test.ts:45-84](tests/integration/phase1-routing-end-to-end.test.ts#L45-L84)). For CQE, a TypeScript fixture array is the right fit because the expected output is a typed `QuantityExtractionResult[]` and the test cases are heterogeneous strings with structured expectations. JSON would lose type safety and would not catch mismatches at edit time.

Fixture shape:

```typescript
import type { QuantityExtractionResult } from '@talchain/schemas/orchestrator';

export interface CqeFixture {
  id: string;            // e.g. "C01", "M01", "Cu01" matching CQE Design v1.1 §8
  category: string;      // "canonical" | "multi" | "currency" | "vague" | ...
  input: string;
  expected: ReadonlyArray<Partial<QuantityExtractionResult>>;
  notes?: string;        // optional rationale per fixture
}

export const cqeFixtures: ReadonlyArray<CqeFixture> = [...];
```

### 6.3 Unit tests

**Recommendation [INF]:** unit tests at `src/orchestrator-v5/context/cqe/__tests__/extract-quantities.test.ts` (mirroring the [src/orchestrator-v5/routing/__tests__/compound-detector.test.ts](src/orchestrator-v5/routing/__tests__/compound-detector.test.ts) sibling). One test per fixture asserting deep equality on the expected fields; a separate test per pattern asserting the rule fires for its representative case.

### 6.4 Integration tests

**Recommendation [INF]:** add a thin integration test that exercises `assembleContextPack()` with a payload containing quantity-bearing prose and asserts the resulting `ContextPack.parsed_quantities` is populated, mirroring the assembler test pattern at [src/orchestrator-v5/context/__tests__/context-pack-assembler.test.ts](src/orchestrator-v5/context/__tests__/context-pack-assembler.test.ts).

### 6.5 Property-based tests

**Finding [OBS]:** `fast-check` is not installed in [package.json](package.json) (verified absent by grep). CQE Design v1.1 §5 calls for one property-based test ("length of input, no exception thrown, output is valid array"). Two options:

- **Add `fast-check` as a dev dependency.** Cost: one new dev dep, ~50KB. Benefit: idiomatic property tests for the no-throw and output-type invariants.
- **Hand-roll a small fuzz harness.** A while-loop that generates random ASCII strings of varying lengths and asserts no throw plus type validity. Lower fidelity but no new dependency.

**Recommendation [OBS]:** **add `fast-check` as a dev dependency.** Two invariants are worth property-checking and the dep is widely used; hand-rolling is false economy. **[OPN]** Paul confirmation appreciated since it adds a new dep.

**Conclusion:** Vitest is the framework, fixtures live as a typed TypeScript array at `tests/fixtures/cqe-fixtures.ts`, unit tests sit alongside the CQE module, integration tests exercise `assembleContextPack()`, property tests use a new `fast-check` dev dep.

---

## 7. Telemetry plan

### 7.1 Recommended approach: routing log AND `cqe.extraction` event (split payload)

**Recommendation [OBS]:** implement both surfaces. Diverges from the compound-detector pattern (routing-log-only) because CQE is an algorithmic stage with continuous-value metrics, not a binary routing decision.

**Rationale, evidence-based:**
- Compound detection is a routing choice (does this turn need compound handling?). CQE is an extraction stage (what numbers were in the message?). The two have different observability needs.
- Upgrade triggers in CQE Design v1.1 §10 are quantitative thresholds (`word_range_missed > 5%`, `compromise extractions > 30%`). These need real-time aggregate metrics for alerting; routing-log-only requires offline scripts to surface them. [OBS at CQE Design v1.1 §10]
- Per-turn debugging needs the routing log (joins to scenario_id, intent_class, handler_id). Aggregate observability needs the telemetry event (Datadog histograms, alert rules).
- Compound-detector chose routing-log-only because its signal is single-bit (matched or not), which is adequate for offline triage. CQE produces 10 fields per turn including continuous values like `duration_ms` and counts; routing-log-only would lose the dashboards.

### 7.2 Per-field placement

**Finding [OBS]:** the 10 telemetry fields in CQE Design v1.1 §9 should be split:

| Field | Routing log | Event | Why |
|---|---|---|---|
| `message_length` | yes | yes | per-turn context + distribution metric |
| `result_count` | yes | yes | per-turn count + volume histogram |
| `cqe_match_count` | yes | yes | per-turn count + pattern-effectiveness metric |
| `compromise_match_count` | yes | yes | per-turn count + fallback-reliance metric (upgrade trigger) |
| `patterns_matched` | yes | **no** | high cardinality; Datadog tag explosion. Offline analysis only |
| `duration_ms` | yes | yes | per-turn latency + p95/p99 histograms (SLO tracking) |
| `timeout` | yes | yes | per-turn signal + failure-rate counter (alerting) |
| `message_too_long` | yes | no | low-signal rate; per-turn triage only |
| `word_range_missed` | yes | yes | per-turn signal + critical upgrade trigger metric |
| `ambiguous_phrasing_detected` | yes | no | per-turn signal; rate tracking unnecessary at PoC |

### 7.3 Routing log additions

**Required edits [OBS]:**
- [src/orchestrator-v5/routing/routing-log.ts:38-73](src/orchestrator-v5/routing/routing-log.ts#L38-L73): add 10 fields to `RoutingLogInput` interface
- [src/orchestrator-v5/routing/routing-log.ts:75-100](src/orchestrator-v5/routing/routing-log.ts#L75-L100): add 10 fields to `RoutingLog` interface
- [src/orchestrator-v5/routing/routing-log.ts:105-161](src/orchestrator-v5/routing/routing-log.ts#L105-L161): update `buildRoutingLog()` to project the new fields (both redacted and unredacted branches)
- [src/orchestrator-v5/turn-executor.ts:613-643](src/orchestrator-v5/turn-executor.ts#L613-L643): pass CQE telemetry data into `buildRoutingLog()` at the call site

The routing log is JSONL ([src/orchestrator-v5/routing/routing-log.ts:171-188](src/orchestrator-v5/routing/routing-log.ts#L171-L188)); existing parsers handle extra fields without breakage.

### 7.4 Telemetry event addition

**Required edits [OBS]:**
- [src/utils/telemetry.ts:53-482](src/utils/telemetry.ts#L53-L482): add `CqeExtraction: "cqe.extraction"` to the `TelemetryEvents` enum
- [src/utils/telemetry.ts:785-1860](src/utils/telemetry.ts#L785-L1860): add a `case TelemetryEvents.CqeExtraction:` block to the Datadog-routing switch with explicit per-field metric extraction (counters for `timeout`/`word_range_missed`; histograms for `message_length`/`result_count`/`duration_ms`; gauges for `cqe_match_count`/`compromise_match_count`)
- New emit call site inside the CQE module after extraction completes

**CI safety [OBS]:** [.github/workflows/telemetry-validation.yml](.github/workflows/telemetry-validation.yml) gates merges by validating that every `emit("...")` call in source uses an event name registered in `VALID_EVENT_NAMES` (built from the `TelemetryEvents` enum). The new event name and the new switch case must land in the same PR; otherwise CI fails.

### 7.5 Telemetry sanitisation

**Finding [OBS]:** `sanitizeTelemetryValue()` at [src/utils/telemetry.ts:520-579](src/utils/telemetry.ts#L520-L579) is recursively permissive (drops only `undefined` values, truncates large arrays, no field-name filtering). The 10 CQE fields including the array `patterns_matched` would pass through cleanly.

**Conclusion:** telemetry uses both surfaces with a justified per-field split; the exact edits are enumerated; CI gating is understood; sanitisation does not interfere.

---

## 8. Performance plan

### 8.1 Latency budgets in current code

**Finding [OBS]:** [src/config/timeouts.ts](src/config/timeouts.ts) exposes turn-wide budgets but no Layer 0 sub-budget:
- `ROUTE_TIMEOUT_MS` 135s default ([line 49-51](src/config/timeouts.ts#L49-L51))
- `ORCHESTRATOR_TURN_BUDGET_MS` 60s default ([line 142-144](src/config/timeouts.ts#L142-L144))
- `LLM_POST_PROCESSING_HEADROOM_MS` 15s ([line 210](src/config/timeouts.ts#L210))

**Finding [DES]:** spec v3.2 §14 sets end-to-end p95 at <4s and LLM call p95 at <2.5s. CQE Design v1.1 §5 sets CQE itself at <5ms for messages <500 chars. There is no explicit Layer 0 budget; the implicit budget is "everything outside the LLM call must fit inside the post-processing headroom (15s)."

**Conclusion:** CQE's 5ms target is two orders of magnitude inside any plausible Layer 0 budget. No code-side timeout constants need to change.

### 8.2 Benchmark matrix (5 cases per brief §4.7)

**Recommendation [OBS]:** extend the existing bench infrastructure at [tests/benchmarks/](tests/benchmarks/) (vitest bench config + `run-benchmark.ts` runner) with a new CQE bench file. Per-case targets:

| # | Case | Input characteristic | Sample size | p95 latency target | Failure mode |
|---|---|---|---|---|---|
| 1 | Idle path | "what about churn?" (no numbers, <30 chars) | 1000 | <1ms | Investigate fixed overhead per call (regex compile cache, module load) |
| 2 | Multi-pattern realistic | "set A to 5%, B to 10%, and C between 20 and 30" | 500 | <5ms | Investigate per-pattern cost; consider pattern reordering |
| 3 | Adversarial backtracking | Per-pattern adversarial inputs (10 cases × 13 patterns = 130 inputs) | 1300 | <50ms (timeout cap) | Pattern redesign; the 50ms cap is defence-in-depth, not normal flow |
| 4 | 2000-char cap boundary | Synthetic dense quantity prose at exactly 2000 chars | 200 | <20ms | Verify cap enforcement; verify truncation at 2000 chars not larger |
| 5 | Compromise-only fallback | "the project rolled forward 7 weeks then back 3" (no CQE pattern matches; compromise handles) | 200 | <10ms | Compromise is the cost ceiling; bound it so a misconfiguration doesn't dominate |

**Go/no-go thresholds:** any case breaching its p95 by more than 25% blocks ship. Case 3 is special: any individual input timing out (>50ms) is acceptable IF the timeout circuit-breaker activates and the function returns `[]` cleanly with telemetry; what fails ship is uncaught backtracking that crashes Node.

### 8.3 Performance risks

**Finding [INF]:** the word-number pre-pass runs on every message including quantity-free messages. For Case 1 (no numbers) this is the dominant cost. Watch the p95.

**Finding [INF]:** `compromise + compromise-numbers` adds bundle weight; the cold-start cost of importing the package (one-time, on server boot) is not counted in per-turn p95 but matters for cold-start scenarios.

**Conclusion:** the bench harness is incremental over existing infrastructure; the matrix is enumerated with concrete thresholds; the dominant per-call cost is expected to be the word-number pre-pass on idle turns.

---

## 9. Edge cases and risks

### 9.1 Edge cases not covered in CQE Design v1.1

- **Pre-pipeline ordering with future system-event/chip-click gates.** When those gates are added (currently absent), CQE should NOT run if a system event short-circuits the turn. Recommendation: when those gates land, they happen BEFORE CQE in the assembler; CQE is skipped on system-event turns. Today this is moot since the gates do not exist.
- **2000-char cap truncation.** CQE Design v1.1 §4.1 specifies "longer messages truncated, `cqe_message_too_long` flag." Edge case: a quantity straddles the 2000-char boundary. The truncation should happen on a word boundary, not a character boundary, to avoid false partial matches. **[OPN]** if a quantity is in the truncated region, telemetry flags `cqe_message_too_long: true` and downstream chooses how to react.
- **Non-ASCII inputs.** CQE Design v1.1 §4.1 says NFKC normalisation. Emoji-heavy or RTL inputs need explicit handling: NFKC preserves emojis but does not strip them; regexes on `\d` and Latin letter classes will simply not match emoji-only inputs and return `[]` cleanly. RTL text (Arabic numerals are still ASCII digits in modern Unicode) should mostly work; verify with a fixture.
- **Adjacent quantities without whitespace.** "£150k£200k" is unusual but plausible. P8 currency pattern with a bounded NUM and explicit whitespace lookbehind would split this correctly. Add to fixtures.
- **Compromise running after CQE timeout.** If a CQE pattern times out mid-pass, the pipeline should still pass the unmasked text to compromise (i.e. fail closed for the timed-out pattern but not for the entire CQE step). Implementation: the 50ms timeout aborts that pattern only; subsequent patterns continue. Compromise still runs on the remainder.

### 9.2 Risks (general)

- **Compromise dependency surface.** Adding `compromise` and `compromise-numbers` brings in their transitive deps. Audit before merge.
- **Bundle size impact on cold starts.** Server-side Node, so minor compared to UI. Quantify in §8 bench.
- **Boundary contract drift.** `ContextPack` stays local while QER moves into the package. This split needs to be tracked and resolved in a future cleanup brief.

**Conclusion:** edge cases are tractable and add fixtures; risks are bounded; the design is implementable as specified with the noted refinements.

---

## 10. Ground truth vs design assumption

Mandatory tagging applied. Each finding classified.

| # | Finding | Classification | Evidence | Notes |
|---|---|---|---|---|
| 1 | `assembleContextPack()` exists with the spec's exact name | **OBS** | [context-pack-assembler.ts:138](src/orchestrator-v5/context/context-pack-assembler.ts#L138) | Insertion point unambiguous |
| 2 | The seven-step turn assembly exists as discrete code regions | **OBS** | [turn-executor.ts:174-572](src/orchestrator-v5/turn-executor.ts#L174-L572) | Confirms spec v3.2 §4 |
| 3 | Same assembler runs for action and non-action turns (no conditional bypass) | **OBS** | [turn-executor.ts:301](src/orchestrator-v5/turn-executor.ts#L301), unconditional | Satisfies brief §4.1 |
| 4 | `parsed_quantities` field is absent from `ContextPack` today | **OBS** | grep returns zero matches; [context-pack-assembler.ts:85-100](src/orchestrator-v5/context/context-pack-assembler.ts#L85-L100) | Pure greenfield |
| 5 | Serialisation to Sonnet is `JSON.stringify(contextPack, null, 2)` with no replacer | **OBS** | [route-with-tool-use.ts:313](src/orchestrator-v5/routing/route-with-tool-use.ts#L313) | `value_origin` survives by default |
| 6 | `@talchain/schemas` v0.5.1 is vendored; source repo at `~/Documents/GitHub/olumi-schemas` | **OBS** | [package.json:69](package.json#L69) and direct repo inspection | Confirmed |
| 7 | `/orchestrator` namespace exists; no `QuantityExtractionResult` exported | **OBS** | `node_modules/@talchain/schemas/dist/orchestrator/`; index.ts at source repo | New schema is greenfield |
| 8 | `ContextPack` is locally defined, not in `@talchain/schemas` | **OBS** | [context-pack-assembler.ts:85-100](src/orchestrator-v5/context/context-pack-assembler.ts#L85-L100); not in package | Permitted but flagged for future migration |
| 9 | Telemetry has fixed taxonomy validated by CI | **OBS** | [src/utils/telemetry.ts:53-487](src/utils/telemetry.ts#L53-L487) and [.github/workflows/telemetry-validation.yml](.github/workflows/telemetry-validation.yml) | New event needs both registration and CI-passing edits |
| 10 | Routing log schema is fixed, requires four edit points to add fields | **OBS** | [routing-log.ts:38-161](src/orchestrator-v5/routing/routing-log.ts#L38-L161), [turn-executor.ts:613-643](src/orchestrator-v5/turn-executor.ts#L613-L643) | Enumerated in §7.3 |
| 11 | `compound_pattern_matched` is routing-log-only, not a telemetry event | **OBS** | grep `Compound` in telemetry.ts returns zero event names | Confirms agent finding; CQE diverges from this pattern with rationale |
| 12 | Compound detector is the closest sibling design (pure, sync, stop-list + regex) | **OBS** | [compound-detector.ts:49-103](src/orchestrator-v5/routing/compound-detector.ts#L49-L103) | CQE follows the same idiom |
| 13 | "System event check" and "chip click check" do not exist in current Layer 0 | **OBS** (absence) | No grep matches for `systemEventGate`, `chipClickGate`, etc. | Aspirational in CQE Design v1.1 §2 diagram |
| 14 | V4 has `extractNumericValues()` but it returns flat `number[]`, incompatible with QER | **OBS** | [src/context/resolver.ts:340](src/context/resolver.ts#L340) | Cannot reuse; greenfield code |
| 15 | `fast-check` is not installed; `compromise`/`compromise-numbers` not installed either | **OBS** (absence) | grep [package.json](package.json) | Three new deps for CQE PR |
| 16 | Routing prompt v6 is a PMS artefact, not loaded as a string template by code | **OBS** | [tool-schema.ts:37-41](src/orchestrator-v5/routing/tool-schema.ts#L37-L41) is the only "prompt" in code; it is a hardcoded tool description | Most important Appendix B mismatch |
| 17 | Vendor procedure for `@talchain/schemas` is documented | **OBS** | [vendor/README.md:22-42](vendor/README.md#L22-L42) | Step-by-step bump procedure clear |
| 18 | `olumi-schemas` repo has explicit semver policy at README §90-100 matching observed history | **OBS** | `~/Documents/GitHub/olumi-schemas/README.md` lines 90-100 + git log on package.json | Recommended bump 0.5.1 → 0.6.0 (minor) |

---

## 11. Implementation options and recommendation

### 11.1 Schema location (D1 from plan §3)

**Options:**
- **A.** `@talchain/schemas/orchestrator` (vendored bump 0.5.1 → 0.6.0): slower ship, boundary-contract-clean
- **B.** CEE-local type definition: faster ship, creates a future migration debt

**Recommendation: A.** Boundary Contract v1.1 §1 prefers one source of truth; the bump procedure is documented and well-trodden ([vendor/README.md:22-42](vendor/README.md#L22-L42)); the schema is small and additive. Confirmed by Paul (decision D1 in the plan).

### 11.2 Telemetry surface

**Options:**
- **A.** Routing log only (compound-detector pattern)
- **B.** Telemetry event only
- **C.** Both with a per-field split

**Recommendation: C.** CQE produces continuous metrics that need real-time observability (upgrade triggers, latency SLOs, error rates) plus per-turn structured context (debugging joins to scenario_id, intent_class). Compound detection's routing-log-only pattern is appropriate for a binary routing decision, not for an algorithmic stage with 10 fields per turn. Detail in §7.

### 11.3 Property-based testing

**Options:**
- **A.** Add `fast-check` as a dev dependency
- **B.** Hand-roll a small fuzz harness

**Recommendation: A.** The two invariants (no throw, output-type validity) are textbook property tests; hand-rolling is false economy. **[OPN]** Paul confirmation appreciated since it adds a dev dependency.

### 11.4 PR structure

**Options:**
- **A.** Single CEE PR (vendor bump + CQE module + telemetry + tests)
- **B.** Split: schemas-vendor PR first, then CEE consumer PR

**Recommendation: A.** The vendored `file:` pin couples the two tightly; splitting creates a window where CEE imports a tarball that is not yet in `vendor/`. Bundling avoids the broken-state window. Detail in §4.5.

---

## 12. Implementation sequence

Phased with verification gates. No time estimates per brief constraints.

**Phase 0: Schema in `@talchain/schemas`**
1. Add `~/Documents/GitHub/olumi-schemas/src/orchestrator/quantity-extraction.ts` with `QuantityExtractionResultSchema` (Zod) and `QuantityExtractionResult` type.
2. Re-export from `~/Documents/GitHub/olumi-schemas/src/orchestrator/index.ts`.
3. Bump `~/Documents/GitHub/olumi-schemas/package.json` to 0.6.0.
4. `npm run build` then `npm pack` in the schemas repo.
5. **Gate:** `dist/orchestrator/index.d.ts` exports `QuantityExtractionResult`; tarball produced.

**Phase 1: Vendor bump in CEE**
1. Copy `talchain-schemas-0.6.0.tgz` into CEE's `vendor/` directory.
2. Update [package.json:69](package.json#L69) to `"file:./vendor/talchain-schemas-0.6.0.tgz"`.
3. Add `compromise`, `compromise-numbers`, `fast-check` to `package.json` (runtime deps for the first two, dev dep for fast-check).
4. `pnpm install`.
5. **Gate:** `tsc -p tsconfig.build.json --noEmit` passes; `import { QuantityExtractionResult } from '@talchain/schemas/orchestrator'` resolves.

**Phase 2: CQE module + assembler wire-up**
1. New module structure under `src/orchestrator-v5/context/cqe/`: `extract-quantities.ts`, `rules.ts` (declarative `PatternRule[]`), `pre-normalise.ts`, `word-numbers.ts`, `compromise-backstop.ts`, `post-filters.ts`.
2. Add `parsed_quantities: readonly QuantityExtractionResult[]` to `ContextPack` interface in [context-pack-assembler.ts:85-100](src/orchestrator-v5/context/context-pack-assembler.ts#L85-L100).
3. Wire `extractQuantities()` into `assembleContextPack()` between [line 139](src/orchestrator-v5/context/context-pack-assembler.ts#L139) and [line 143](src/orchestrator-v5/context/context-pack-assembler.ts#L143).
4. **Gate:** unit tests against `tests/fixtures/cqe-fixtures.ts` (68 cases per CQE Design v1.1 §8) all pass; assembler integration test confirms `parsed_quantities` populated; bench Cases 1-5 meet thresholds per §8.

**Phase 3: Telemetry + routing log**
1. Add `'cqe.extraction'` to `TelemetryEvents` enum in [src/utils/telemetry.ts:53-482](src/utils/telemetry.ts#L53-L482).
2. Add `case TelemetryEvents.CqeExtraction:` block with explicit Datadog routing (lines 785-1860).
3. Add 10 CQE fields to `RoutingLogInput` and `RoutingLog` interfaces in [src/orchestrator-v5/routing/routing-log.ts:38-100](src/orchestrator-v5/routing/routing-log.ts#L38-L100).
4. Update `buildRoutingLog()` to project the new fields ([routing-log.ts:105-161](src/orchestrator-v5/routing/routing-log.ts#L105-L161)).
5. Pass CQE telemetry into the routing log call site at [turn-executor.ts:613-643](src/orchestrator-v5/turn-executor.ts#L613-L643).
6. **Gate:** [.github/workflows/telemetry-validation.yml](.github/workflows/telemetry-validation.yml) passes (event name registered); routing log JSONL contains the new fields after a sample turn; `cqe.extraction` event fires once per turn.

**Out of scope for the implementation brief:**
- Routing prompt v6 PARAMETERS additions (PMS-side, Paul authors)
- Haiku selective fallback (production upgrade triggered by telemetry)
- Migration of `ContextPack` itself into `@talchain/schemas` (separate cleanup brief)
- `DEFAULT_FACTOR_SCALES` registry (validator scope, separate brief)
- System-event and chip-click Layer 0 gates (separate briefs)

---

## 13. Open questions for Paul

1. **Property-based testing dep.** Is adding `fast-check` as a dev dependency acceptable? §11.3 recommends yes; flagged because new deps are non-trivial.
2. **`ContextPack` migration timing.** Proposal recommends keeping `ContextPack` CEE-local for now and migrating it to `@talchain/schemas/orchestrator` in a separate cleanup brief. Confirm this defers cleanly.
3. **PLoT/UI consumption of `QuantityExtractionResult`.** Proposal assumes CEE-only consumption for PoC. Confirm no PLoT or UI work needs the schema in the first wave; otherwise their vendor swap is needed alongside CEE's.
4. **Routing prompt v6 PARAMETERS edit.** Proposal flags this as a PMS-side edit you author. Confirm this is the right ownership and that no code-side prompt loader is wanted for PoC.
5. **2000-char cap truncation point.** Should truncation happen on a word boundary or a character boundary? Slight semantic difference for §9.1.

---

## Appendix A: code path trace

### A.1 Turn ingress to ContextPack assembly to Sonnet call

```
HTTP POST /orchestrate/v2/turn
  └─ src/server.ts handler (Fastify)
      └─ runTurnExecutor(payload, requestId, options)
         (src/orchestrator-v5/turn-executor.ts:174)
          ├─ ORIENT step (lines 287-344)
          │   ├─ assembleContextPack({ payload, priorTurns, graph, analysis })
          │   │  (line 301; assembler at src/orchestrator-v5/context/context-pack-assembler.ts:138)
          │   │   ├─ const compound = detectCompound(input.payload.message)
          │   │   │  (line 139; detector at src/orchestrator-v5/routing/compound-detector.ts:49)
          │   │   │
          │   │   ├─ // FUTURE INSERTION POINT: extractQuantities(input.payload.message)
          │   │   │  // sets parsed_quantities on ContextPack
          │   │   │
          │   │   ├─ projectGraph(input.graph)         (line 143)
          │   │   ├─ projectAnalysis(input.analysis)   (line 144)
          │   │   ├─ projectConversation(...)          (line 145)
          │   │   └─ return ContextPack
          │   │
          │   └─ routeWithToolUse(contextPack, payload.message, options)
          │      (line 308; router at src/orchestrator-v5/routing/route-with-tool-use.ts:160)
          │       ├─ buildUserMessage(contextPack, message)
          │       │  (line 165; impl at src/orchestrator-v5/routing/route-with-tool-use.ts:310)
          │       │   └─ JSON.stringify(contextPack, null, 2)  ← serialisation point
          │       │      (line 313, no replacer; value_origin survives)
          │       │
          │       ├─ chatWithToolsArgs = { messages: [...], tools: [OLUMI_ACTION_TOOL] }
          │       │  (line 170; tool def at src/orchestrator-v5/routing/tool-schema.ts:35)
          │       │
          │       └─ adapter.chatWithTools(args)  ← call to Sonnet
          │
          ├─ VALIDATE step (lines 358-426; skipped on non-action turns)
          ├─ EXECUTE step (lines 428-445; skipped on non-action turns)
          ├─ CONFIRM step (lines 450-452; skipped on non-action turns)
          ├─ COACH step   (lines 454-455; null stub)
          ├─ COMPOSE step (lines 457-542; branches per intent)
          └─ COMMIT step  (lines 544-572; routing log written here)
              └─ buildRoutingLog({...}) → writeRoutingLog → logs/v5-routing-logs.jsonl
                 (turn-executor.ts:613-644; log builder at src/orchestrator-v5/routing/routing-log.ts:105)
```

### A.2 ContextPack type today vs after CQE

**Today** ([context-pack-assembler.ts:85-100](src/orchestrator-v5/context/context-pack-assembler.ts#L85-L100)):
```typescript
export interface ContextPack {
  readonly version: typeof CONTEXT_PACK_VERSION;
  readonly stage: string;
  readonly graph: ContextPackGraph;
  readonly analysis: ContextPackAnalysis | null;
  readonly conversation: ContextPackConversation;
  readonly coaching: null;
  readonly compound_detected: boolean;
  readonly compound_segments?: readonly string[];
  readonly compound_pattern_matched: string | null;
  readonly system_event: unknown | null;
}
```

**After CQE (one-line addition):**
```typescript
export interface ContextPack {
  // ...existing fields...
  readonly parsed_quantities: readonly QuantityExtractionResult[];
  readonly system_event: unknown | null;
}
```

`QuantityExtractionResult` imported from `@talchain/schemas/orchestrator` per §4.

### A.3 Layer 0 ordering today vs after CQE

**Today:**
1. detectCompound (compound detection)
2. projectGraph
3. projectAnalysis
4. projectConversation

**After CQE:**
1. detectCompound (compound detection)
2. **extractQuantities (CQE)** ← new
3. projectGraph
4. projectAnalysis
5. projectConversation

---

## Appendix B: design doc mismatches

Each row independently verified against the codebase.

| # | Design doc claim | Codebase reality | Evidence | Proposed resolution |
|---|---|---|---|---|
| 1 | "Routing prompt v6 PARAMETERS section consumes parsed_quantities" (CQE Design v1.1 §11, §12) | V5 code does not load a string-template prompt; LLM receives `JSON.stringify(contextPack)` plus a hardcoded tool description | [route-with-tool-use.ts:310-318](src/orchestrator-v5/routing/route-with-tool-use.ts#L310-L318), [tool-schema.ts:37-41](src/orchestrator-v5/routing/tool-schema.ts#L37-L41) | **Keep design.** PARAMETERS-section additions are PMS-side concerns Paul authors. JSON serialisation already delivers data to Sonnet. No code-side prompt loader needed. |
| 2 | "@olumi/contracts/orchestrator" (spec v3.2 §11.1, §10; CQE Design v1.1 §11) | Actual package is `@talchain/schemas` (aspirational naming in spec) | [package.json:69](package.json#L69), [vendor/README.md](vendor/README.md), `node_modules/@talchain/schemas/package.json` | **Revise design.** Update spec terminology. Recommendation: spec v3.3 corrects `@olumi/contracts` to `@talchain/schemas` everywhere. |
| 3 | "ContextPack lives in @olumi/contracts/orchestrator" (Boundary Contract v1.1 §2.1) | Defined locally in CEE; not exported from `@talchain/schemas` | [context-pack-assembler.ts:85-100](src/orchestrator-v5/context/context-pack-assembler.ts#L85-L100); not present in `~/Documents/GitHub/olumi-schemas/src/orchestrator/index.ts` | **Open question for Paul.** Permitted by §1 (CEE-internal types). Migration is separate cleanup brief; CQE does not block on it. |
| 4 | "compound_pattern_matched" emitted as telemetry event (implied by spec v3.2 §11.2 cite) | Field is written to routing log only; no standalone event | grep `Compound` in [src/utils/telemetry.ts:53-482](src/utils/telemetry.ts#L53-L482) returns zero hits | **Revise design.** Spec terminology should clarify: compound detection is a routing-log signal, not a telemetry event. Note that CQE deliberately diverges from this pattern (justification in §7.1) and uses both surfaces. |
| 5 | "DEFAULT_FACTOR_SCALES registry exposure" (spec v3.2 §6 check #4) | Not in `@talchain/schemas/orchestrator` exports | `~/Documents/GitHub/olumi-schemas/src/orchestrator/index.ts` does not export this | **Open question for Paul.** Out of CQE scope; flag as separate brief item for the validator work. |
| 6 | "System event check" and "chip click check" precede CQE in Layer 0 (CQE Design v1.1 §2 ASCII diagram) | Layer 0 has compound detect → graph projection → analysis projection → conversation projection; no system-event or chip-click gates exist | [context-pack-assembler.ts:139-145](src/orchestrator-v5/context/context-pack-assembler.ts#L139-L145); grep returns no `systemEventGate` or `chipClickGate` | **Revise design.** CQE Design v1.1 §2 diagram should be updated: those gates are aspirational (future briefs). CQE inserts after compound detect; no other Layer 0 dependency. |
| 7 | `compound + compromise-numbers` are available as standard libs | Not in [package.json](package.json) (verified by grep) | `package.json` runtime deps do not include them | **Keep design.** Add as new runtime dependencies in the implementation PR. |
| 8 | `fast-check` available for property tests | Not in [package.json](package.json) | Same | **Keep design.** Add as new dev dependency in the implementation PR. Confirmed by Paul as recommended. |

If additional mismatches emerge during implementation, document them in the implementation brief's review pack.

---

*End of proposal. No commits. No push. Paul reviews in-place on `claude/v5-cqe-investigation`.*
