# Lane 3 — harness prose reliability (2026-07-07)

Branch: `claude-lane3/harness-prose-reliability` (fresh worktree off `origin/staging` @ `010bb4229`).
Doctrine authorization: provisional_doctrine_v0 (Paul, 7 Jul). All touched wording surfaces are tagged `provisional_doctrine_v0` in code comments and listed in the claim register below.

## Mission A — prose claim-safety rule (IMPLEMENTED)

**Defect (live):** deterministic run_analysis narration said "the result is sensitive to Tech Lead in Place" while that factor carried `sensitivity_score=0`, `elasticity=0`, `zero_reason='intervention_override'` (option-pinned). Grounding was `influence_score=1` + a fragile edge (switch_probability 0.61).

**Composer located:** `src/orchestrator-v5/coaching/analysis-result-headline.ts` (pure deterministic builder consumed by the `run_analysis` handler; `llm_calls=0`). The old `resolveFragileLabel` picked a fragile edge's *node label* (from-side preferred) and rendered it as "the result is sensitive to {label}" with no pin awareness; `resolveTopDriverLabel` could also name a `sensitivity_score: 0` factor as "the strongest driver" when all scores were zero.

**Rule implemented:** a factor is never described as "sensitive to" / "strongest driver" when
`sensitivity_score === 0` OR `zero_reason === 'intervention_override'` OR its id is in the structural `interventionControlledFactorIds` set. Candidate preference order:
1. genuinely non-pinned named candidate — wording unchanged ("the result is sensitive to X");
2. the fragile EDGE itself — "the link between X and Y is fragile" (the claim transfers to the edge, which is truthfully grounded by switch_probability);
3. generic provisional — "treat this as provisional: the result is not highly stable".

**RED→GREEN:** `src/orchestrator-v5/coaching/__tests__/analysis-headline-claim-safety-pinned.test.ts` reproduces Paul's exact bundle (leader `opt_tech_lead`, `fac_tech_lead` pinned, sensitivity 0, fragile edge 0.61). RED run before implementation: 11 failed / 4 passed. After: 15/15 GREEN; Paul's bundle now renders
`Hire a Tech Lead currently leads by 16 percentage points, but treat this as provisional: the link between Tech Lead in Place and Delivery Confidence is fragile.`

## Mission B — narration completeness (IMPLEMENTED)

Same composer, same single-block `assistant_text`, no new block types, no schema changes:
- `robustness.is_robust === false` OR `level === 'low'` → appends `The result is not yet robust — small changes could flip it.`
- ≥2 non-winner options with finite `win_probability < 0.01` (same-source count) → appends `<N> options are effectively eliminated (each has less than a 1% chance of winning).`

Tails ride a separate length budget (`MAX_ASSISTANT_TEXT_CHARS`) so honesty never forces a stronger case shape to shed information; the registry allowlist grammar (`isAllowedRunAnalysisAssistantText`) was extended in lockstep (tail patterns + the two new caution-reason bodies), so the second line of defence still pins every emittable string.

## Claim register — wording surfaces touched (all tagged `provisional_doctrine_v0`)

| Surface | File | Change |
|---|---|---|
| Caution reason: fragile-link wording (NEW) | `src/orchestrator-v5/coaching/analysis-result-headline.ts` (`cautionReasonText`) | `, but treat this as provisional: the link between {X} and {Y} is fragile.` |
| Caution reason: generic provisional (NEW) | same | `, but treat this as provisional: the result is not highly stable.` — the mission example noun "recommendation" is FORBIDDEN vocabulary on this surface (`FORBIDDEN_HEADLINE_VOCABULARY_REGEX` bans `recommend*`), so the noun is "result". Flag if Paul wants the regex carve-out instead. |
| Robustness honesty sentence (NEW) | same (`NOT_ROBUST_SENTENCE`) | ` The result is not yet robust — small changes could flip it.` |
| Eliminated-options sentence (NEW) | same (`eliminatedSentence`) | ` {N} options are effectively eliminated (each has less than a 1% chance of winning).` |
| Driver clause suppression (BEHAVIOUR) | same (`resolveTopDriverLabel`) | zero-score / intervention_override factors never named as "the strongest driver" |
| Registry grammar + length cap | same (grammar regexes, `MAX_ASSISTANT_TEXT_CHARS`) | extended to accept exactly the new shapes; outer cap 220 → 220+tails budget |

7 pre-existing exact-match test expectations updated (fixtures with `level: 'low'` now carry the robustness tail); each test's original concern (no overclaim / no margin / no sensitivity naming) is re-asserted unchanged.

## Mission C — structured-outputs grammar failure (IMPLEMENTED; LIVE VERIFICATION PENDING)

**Live wiring confirmed** (origin/staging): `draftGraphWithAnthropic` (`src/adapters/llm/anthropic.ts`) sends `output_config.format = { type: "json_schema", schema: ANTHROPIC_DRAFT_GRAPH_SCHEMA }`; no tools are registered on the request, so the compiled grammar is entirely this schema. `claude-sonnet-4-6` is in `STRUCTURED_OUTPUTS_SUPPORTED_MODELS`; flag `CEE_ANTHROPIC_STRUCTURED_OUTPUTS`.

**Diagnosis (evidence):**
- Measured pre-fix: 5,452 serialized bytes; 16 object nodes / 79 properties (max 12 per object); 16 enums with 50 values; 10 anyOf unions with 22 branches.
- Git history: commit `7eaee1131` (2026-04-02) hit the *same* error at 11KB and fixed it by slimming to nodes+edges+goal_constraints (3.2KB) — that shape **verifiably compiled**. Commit `7f7fdb7c3` (v0.11.0 amendment) re-added `coaching` + `causal_claims` + `topology_plan` as required top-level fields → ~5.5KB → the failure returned on every staging draft (silent prompt-only fallback, ~48s drafts).
- Mechanism (inference, marked as such): grammar compilation cost is driven by object key-tracking (any-order keys under `additionalProperties:false`), enum literal alternations, and anyOf branching; the v0.11.0 delta added the 4-branch causal_claims object union and three nested coaching objects — exactly the subtrees between the known-good 3.2KB point and the failing 5.5KB point.

**Reduction implemented (v7, grammar becomes a strict SUPERSET — accepted output surface unchanged; downstream Zod/normalisers remain the enforcement, identical to the prompt-only path that runs today):**
- `causal_claims`: 4-branch object anyOf → ONE flat object (`type` enum kept; per-variant fields grammar-optional). Safe because `validateCausalClaims` Zod-parses each claim and drops malformed ones item-wise (`CAUSAL_CLAIM_DROPPED`).
- Enum → plain string where downstream owns the values: `data.extractionType`, `data.factor_type`, `strengthen_items[*].bias_category` (the enum actively forbade the legacy values the ingress normaliser at anthropic.ts:884 is documented to map — correctness-positive), `widening_log.brief_completeness`, `bias_signals[*].type`, causal `stated_strength`.
- Kept (load-bearing): node `kind`, factor `category`, edge `effect_direction`/`edge_type`, constraint `operator`, strengthen `action_type`, causal `type`.

**Post-fix measurements:** 4,578 bytes (−16%); enums 16→7 (values 50→25); unions 10→9 (branches 22→18); objects 16→13; optionals 15/24; unions 9/16.

**Budget tripwire:** `tests/unit/anthropic-graph-schema-grammar-budget.test.ts` pins serialized bytes ≤5,000 plus union/optional/enum/object tripwires and the flat causal_claims shape (superset keys asserted). The test header documents that a budget pass does NOT guarantee compilation and gives the live verification procedure.

**HONEST CAVEAT:** I could not verify grammar compilation against the live Anthropic API from this environment. The 4,578-byte point sits between the known-good 3.2KB and known-bad 5.5KB anchors; **live verification on staging is REQUIRED**: trigger one draft_graph with `CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true` and check that (a) no `cee.draft_graph.structured_outputs_fell_back` event fires and (b) draft latency drops from the ~48s prompt-only baseline. If it still fails, the next reduction candidates are the coaching subtree (3 nested objects) and the 11-required-key `data` object.

**Non-silent fallback:** new telemetry event `cee.draft_graph.structured_outputs_fell_back` (TelemetryEvents.CeeStructuredOutputsFellBack) emitted alongside the existing WARN-level pino log on BOTH structured-outputs fallback paths (draft_graph + generic chat), payload: `operation`, `model`, `error_snippet` (first 200 chars), `schema_bytes`. Unit tests pin: fires exactly once on the exact live error string; does not fire on success.

## Mission D — edit_graph 'missing operations array' (INVESTIGATED ONLY — no behaviour change)

**Trace** (`src/orchestrator/tools/edit-graph.ts`):
- Response parse: `parseEditGraphResponse` (line ~3249) → `extractJson` (line ~3213).
- `extractJson` order: (1) strip fences, (2) whole-string `JSON.parse`, (3) `cleaned.match(/\{[\s\S]*\}/)` → **unguarded** `JSON.parse(objectMatch[0])`, (4) array match — only reached if step 3 found no `{`.

**Root cause (mechanism, verified in code):** when the model wraps a LEGACY ARRAY response in any prose (step 2 fails), step 3's greedy object regex spans from the array's first element's `{` to its last `}`:
- single-element array `text [ {op...} ] text` → extracts the inner OPERATION object, which parses fine → `parseEditGraphResponse` takes the v2-object branch → no `operations` key → throws **`v2 response missing required "operations" array`** (line ~3304);
- multi-element array → extracted `{...}, {...}` is invalid JSON → the unguarded parse throws → the array fallback in step 4 is dead code for any prose-wrapped array.

**The zod `value Required` half:** `PatchOperationSchema` (`src/orchestrator/patch-validation.ts`) requires `value` for `add_node`/`update_node`/`add_edge`/`update_edge`; `normaliseOperation` (edit-graph.ts ~3387) only wraps scalars into `{field: value}` for field-suffixed paths — it never lifts inline top-level payloads (`{op:'add_node', id, kind, label}`) or alternate keys (`changes`, `new_value`) into `value`, so such operations fail Zod. On repair attempts the system prompt swaps to `repair_edit_graph` (mandates the v2 envelope), but the repair user message embeds `Previous (Invalid) Operations` as a BARE ARRAY (line ~1790) — priming bare-array replies that then hit the extractJson trap above; also `lastRawOps` is reset to `[]` on parse failures (line ~1879), so the repair prompt shows an empty previous-ops block.

**Observed staging sequence explained:** attempt 1 bare array (fires `edit_graph.legacy_array_response`) → items without `value` → zod `value Required` → repair attempt returns prose-wrapped array or bare single object → `missing operations array` / JSON syntax parse failure → 2/3 turns fail.

**Proposed followup (separate lane):**
1. `extractJson`: guard the object-extraction parse with try/catch and fall through to array extraction; prefer whichever candidate parses (fixes the dead array fallback).
2. `parseEditGraphResponse`: accept a bare single-operation object (`op` + `path` present, no `operations` key) by wrapping into `operations: [obj]` with additive telemetry (mirrors the existing legacy-array wrap pattern).
3. `normaliseOperation`: for value-requiring ops with `raw.value === undefined`, lift known alternate payload keys / inline payload fields into `value` (or at minimum emit targeted telemetry to drive a prompt fix).
4. Repair prompt: embed previous ops inside a `{ "operations": [...] }` envelope (not a bare array) and preserve the actual raw ops on parse failures.
5. Check the staging Supabase `edit_graph` prompt version for drift vs code defaults (live legacy-array emissions suggest the deployed prompt may still mandate the v1 array format).

## Verification summary

- Typecheck (authoritative gate): `npx tsc --noEmit -p tsconfig.build.json` → clean (after `pnpm openapi:generate`, a standard pretypecheck step).
- Focused vitest: `analysis-headline-claim-safety-pinned` 15/15; `analysis-result-headline` 112/112; run-analysis / permissive-status / staleness-prefix / validation-registry / analysis-claim-safety / copy-quality-gate all green; schema suites (grammar-budget, by-construction, compliance, alignment, draft-graph-params, structured-outputs) 169+29 green.
- Pre-existing failure (NOT introduced here, reproduced on clean origin/staging): `src/orchestrator-v5/compose/__tests__/forbidden-user-facing-phrases.test.ts > route-v2.ts EDIT_GRAPH_RECOVERY_TEXT is clean` — 5s test timeout.
