# Lane CEE-D — edit-loop reliability (2026-07-07)

Branch: `claude-lane5/edit-loop-reliability` (fresh worktree from `origin/staging` @ `393fa088b`)
Mission: make the edit loop reliable. Two root-caused defect clusters, both with live traces:

- **A — LLM `edit_graph` response parsing** (2/3 LLM-path failures two nights ago; Lane-3 Mission-D root cause)
- **B — tool-call relative-delta rejection** (this morning, `request_id baca4f1c`)

Method: RED fixtures from the live failures FIRST, then GREEN. All fixtures committed
before the fixes (commit `test(edit-loop): RED fixtures …`), then made green by the
two implementation commits.

---

## Cluster A — `edit_graph` LLM response parsing

File: `src/orchestrator/tools/edit-graph.ts`

| # | Defect (live symptom) | Fix |
|---|---|---|
| A1 | `extractJson` greedy `/\{[\s\S]*\}/` with UNGUARDED `JSON.parse` BEFORE the array fallback → prose-wrapped multi-op legacy array mis-extracts `{op1}, {op2}`, throws SyntaxError, array branch never reached | object-parse wrapped in try/catch, falls through to array extraction |
| A2/A3 | prose-wrapped SINGLE-op array mis-extracts the first op object; bare single-op objects → live error `v2 response missing required "operations" array` | `parseEditGraphResponse` wraps an unambiguous bare patch-op object (known `op` + non-empty string `path`) into `operations: [op]` with the legacy-branch safe coaching defaults; additive telemetry `edit_graph.bare_single_op_wrapped` |
| A4 | `PatchOperationSchema` requires `value` for add/update ops; `normaliseOperation` never lifted inline/alternate-key payloads → live zod `value — Required` | `liftAlternateValuePayload`: exactly-one alternate key (`new_value`, `newValue`, `updated_value`, `updatedValue`, `data`, `payload`, `node`, `edge`, `fields`, `updates`, `properties`, `changes`) → lifted; else inline non-reserved top-level keys → lifted as a record; 2+ alternate keys = ambiguous → untouched (Zod + repair loop as before). **Every lift is logged** (`edit_graph.value_lifted`, with `source: alternate_key\|inline_payload`) |
| A5 | repair prompt embedded previous ops as a BARE ARRAY (contradicting the repair prompt's mandated `{ "operations": [...] }` output format) and `lastRawOps` was reset to `[]` on parse failures — priming repeat failures | repair message now embeds `{ "operations": [...] }`; `lastRawOps` PRESERVED across parse failures (first-attempt parse failure still renders `{ "operations": [] }` — nothing to keep) |

### A(5) report-only: code-default prompt drift check

- The **code-default** `edit_graph` prompt is **v6** (`src/prompts/edit-graph-v6.ts`,
  registered in `src/prompts/defaults.ts` `registerDefaultPrompt('edit_graph', getEditGraphPromptV6())`,
  version map `edit_graph: 'v6'`). It mandates: *"Return ONLY a JSON object. No text
  outside the JSON."* with an `"operations": [...]` envelope — it does **NOT** mandate
  the v1 bare-array format.
- The repair prompt (`REPAIR_EDIT_GRAPH_PROMPT`, defaults.ts ~1989) likewise mandates
  the same JSON object format.
- **Implication:** the live bare-array responses came from either (a) a drifted
  **deployed** prompt at the Supabase tier of the 3-tier store (cache → Supabase →
  hardcoded default, `getSystemPrompt('edit_graph')`), or (b) model non-compliance.
  The deployed Supabase prompt row is not readable from this session — flagged for a
  deployed-prompt audit. The parser now tolerates both formats either way.

---

## Cluster B — relative-delta rejection at the `set_factor_value` seam

Live trace `baca4f1c`: "increase it slightly by 5%" → `handler_proposed
set_factor_value` with `{ value: 5, unit: '%' }` + operator `increase` on a £ factor
→ V5 validator `unit_mismatch` → `PARAMETER_INVALID parameter:"value"` → recovered
template. Absolute set succeeded same session (turn `91a45b0a`). Both reproduced as
executor-level fixtures (RED before the fix; the absolute-set control was green
before AND after).

Seam located: TurnExecutor STEP 2 (`validateToolCall` at the execute-intent block).
Fix: `src/orchestrator-v5/routing/resolve-relative-factor-delta.ts`, called BEFORE
`validateToolCall` so the validator, the P0-A value/unit containment, and the handler
all see the same **resolved absolute** proposal:

- **Recognised relative shapes (unambiguous only):** structured percent
  (`{ value, unit:'%' }` or bare number with parameter-level `'%'`) with
  `increase`/`decrease`, targeting a factor whose own unit is NOT `%`; string
  `"+5%"` / `"-10%"` (sign gives direction; signless string requires a delta operator
  — `"set to 5%"` stays absolute).
- **Resolution:** LHS de-normalised with the shared `resolveExistingRawValue`
  (the validator/handler parity helper), `after = current × (1 ± N/100)`, float dust
  stripped; rewritten to operator `set` with the absolute value in the factor's own
  unit. All downstream guards (cap range, finiteness, unit match) still run against
  the resolved value.
- **Never guess** (proposal untouched → today's clarify/recovery path): `%`-unit
  factors (pp-addition semantics preserved and pinned by a control fixture),
  missing/ambiguous current value, decrease > 100 %, zero/negative/non-finite
  percent, `multiply`, non-percent deltas.
- **P0-A guard interaction:** the raw-message value/unit containment guard is skipped
  ONLY for a resolved proposal — the `%` token was deliberately consumed by the
  resolution, not silently dropped; the skip is recorded on the telemetry event
  (`value_unit_guard_skipped: true`).
- **Structural honesty:** the receipt states the resolved absolute change via the
  EXISTING handler wording (`Updated Budget from £40,000 to £42,000.`), rendered only
  after durable commit — the STEP 6.6 swap gate is untouched.
- Telemetry: `v5.turn_executor.relative_delta_resolved` (system ids + closed enums
  only; no user values, per the P1-2 log-privacy convention).

### provisional_doctrine_v0 surfaces (rule 9)

1. `src/orchestrator-v5/routing/resolve-relative-factor-delta.ts` — the
   interpretation doctrine "percent delta on a non-percent factor = N% of current
   value; receipt states the resolved absolute change; percent-on-percent stays
   pp-addition" is tagged `provisional_doctrine_v0` at the multiplier computation
   (single change site if doctrine later prefers clarify-always).

No other new user-facing wording was introduced; both clusters reuse existing
deterministic wording surfaces.

---

## Telemetry registry (rule 11)

New events, both `emit(TelemetryEvents.X, …)` (no string-literal emits — passes the
Telemetry Event Name Validation workflow's grep):

| Event | Enum member | Registered in |
|---|---|---|
| `edit_graph.bare_single_op_wrapped` | `EditGraphBareSingleOpWrapped` | frozen `eventSnapshot`, sorted `frozenEvents` spec list, `debugOnlyEvents` (no Datadog metric), namespace regex widened `edit_graph\.(no_operations\|bare_single_op_wrapped)$` |
| `v5.turn_executor.relative_delta_resolved` | `V5RelativeDeltaResolved` | frozen `eventSnapshot`, sorted `frozenEvents` spec list, `debugOnlyEvents`; matches the existing `v5.(…\|turn_executor…)` namespace group |

`tests/utils/telemetry-events.test.ts` passes (frozen enum, VALID_EVENT_NAMES parity,
namespace, Datadog-classification, spec list). `future-hooks-registry` tripwires: the
suite reads `src/utils/telemetry.ts` (touched here) but only asserts the continued
presence of `v5.graph_cas.evaluated` — my additions are purely additive, and
`tests/unit/ai-harness/future-hooks-registry.test.ts` was RUN against this branch:
**11 passed, 4 skipped, 0 failed**. No tripwire manifest names any other touched
substrate (edit-graph.ts / turn-executor.ts / routing/*).

## Wire contract

No boundary schema changes. The proposal rewrite is value-level inside CEE (the wire
`ProposalParameterSchema` already carries `operator` and open-typed `value`);
telemetry events are additive. No `@talchain/schemas` change needed.

---

## Verification

Gates (run in the lane worktree; final re-run in a fresh verification worktree at the
branch tip — see PR):

- `pnpm typecheck:src` (tsc -p tsconfig.build.json) — **clean**.
- `npx eslint` over all 8 changed/added files — **clean**.
- Focused vitest:
  - `tests/unit/orchestrator/tools/` — 27 files, **503 passed**, 1 todo (includes the
    10 new parse-reliability fixtures).
  - `src/orchestrator-v5/routing/__tests__/` — 41 files, **1587 passed**, 1 skipped
    (includes 17 new resolver unit tests).
  - `src/orchestrator-v5/__tests__/` — **736 passed, 4 failed** — all 4 failures
    **pre-existing** (see below).
  - `src/orchestrator-v5/tools/ + handlers/` — **883 passed, 5 failed** — all 5
    **pre-existing** (see below).
  - `tests/utils/telemetry-events.test.ts` — passed.

### Pre-existing failures (honest report, rule 7)

The following 9 test failures were reproduced **byte-identically on a pristine
detached worktree at `origin/staging` (393fa088b) with none of this lane's changes**
(scope: the 5 named files; claim type: same-failure-reproduces-at-base):

- `src/orchestrator-v5/__tests__/d1-followup-fixes.test.ts` — 2 (P1-5 cap-formatting
  message assertions)
- `src/orchestrator-v5/__tests__/turn-executor-explain-precondition-chip.test.ts` — 1
- `src/orchestrator-v5/__tests__/turn-executor-recoverable-handler.test.ts` — 1
- `src/orchestrator-v5/handlers/__tests__/chip-click-dispatch-analysis-ready.test.ts` — 3
- `src/orchestrator-v5/handlers/__tests__/chip-click-dispatch.test.ts` — 2

No test that passed at base fails with this lane's changes.

### RED→GREEN evidence

| Fixture | RED (before) | GREEN (after) |
|---|---|---|
| A1 prose-wrapped multi-op array | SyntaxError from greedy object parse | 2 ops parsed |
| A2 prose-wrapped single-op array | `v2 response missing required "operations" array` (live error) | 1 op recovered |
| A3 bare single-op object | same live error | wrapped, safe coaching defaults |
| A4 `new_value` / inline payload | `value` undefined → zod `value — Required` | lifted into `value`, lift logged |
| A5 repair embedding | bare array embedded; ops wiped on parse failure | `{operations:[...]}` embedded; ops preserved across parse failure |
| B live-trace repro (structured % on £) | validator recovery `direct_answer`, `PARAMETER_INVALID` | handler executes, £40,000 → £42,000, receipt states both values, resolution event emitted |
| B string `-10%` | same recovery | £40,000 → £36,000 |
| B absolute control (91a45b0a shape) | green | green (unchanged) |
| B no-current-value control | clarify/recovery | clarify/recovery (unchanged — never guess) |
| B percent-on-percent control | pp addition 4 % → 9 % | unchanged, no resolution event |

## Scope notes / follow-ups

- The resolver covers every proposal that flows through TurnExecutor STEP 2
  `validateToolCall` — the Sonnet tool-call path (the live trace) AND the
  deterministic pre-route synthesis, which joins the same lifecycle. The chip-click
  dispatch path was not modified.
- Deployed-prompt audit (Supabase tier) for `edit_graph` recommended — see A(5).
- Plain-number deltas ("increase by 5000") already worked via the existing operator
  path and are deliberately not touched.
