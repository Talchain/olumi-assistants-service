# V5 numeric & identity honesty audit

**Type:** read-only audit + implementation plan. No production code, tests, prompts, PMS,
schemas, DGAI/PLoT/ISL, env flags or data were changed.
**Verified on:** `origin/staging` @ `638ecbe9` (identical to audited HEAD; all cited files
byte-for-byte equal between HEAD and `origin/staging`).
**Branch:** `audit/v5-numeric-identity-honesty`.
**Scope guard:** does not duplicate the handler-coverage map or the design-system compliance
audit.

**Evidence tags:** `source-verified: file:line` · `test-verified` · `runtime-needed` ·
`inferred` · `unknown-needs-follow-up`.

---

## 1. Verdict

The headline risk is **correctness, not presentation polish.**

- **Link-safe correctness blockers**
  - **#1 — driver direction can be wrong.** The primary `deriveTopDrivers` derives direction
    from `factor.sensitivity ?? factor.elasticity`, but the documented contract says `elasticity`
    is **unsigned** and **`factor.direction` is authoritative**. The derive path never reads
    `factor.direction`. If PLoT populates per-option `results[].factor_sensitivity` with unsigned
    elasticity, every negative-direction driver is rendered as "strengthens". Status is
    **latent vs live and requires runtime proof** (see §7) — it is masked today only if staging
    routes through the enum-honouring fallback.
  - **#5 — `neutral` collapses to "strengthens".** `direction: 'neutral'` is a real contract
    value; both derive paths and the sign-reattachment treat it as positive, so a neutral factor
    with non-trivial magnitude reads as a positive directional claim. This is a **live**
    trust/correctness issue (mitigated only when `|magnitude| < 0.05`).
- **Important before pilot (trust / presentation)**
  - **#7 — schema-vocab leak.** The canonical band token `highly_stable` (with underscore) and
    the phrase "robustness band" reach user prose in three composers.
  - **#4 — robustness `unknown` is silently omitted**, never caveated. A product/UX decision.
- **Lower priority / verified already closed (keep regression tests)**
  - **#2** non-finite probabilities, **#3** raw long floats, **#6** opaque ID fallback.

**Priority call:** when we later choose the first implementation lane, **direction honesty (#1 +
#5) should outrank the coaching quick wins surfaced in the handler-coverage map** (the A1–A3
"safe V5-only" items such as `widening_log` and `strengthen_items[1..n]`). Those improve coverage;
this prevents Olumi stating the wrong thing. This ranking holds **unless the §7 runtime trace
shows the primary derive path is unreachable on the live envelope shape** and no surface mis-states
direction — in which case #1 drops to a contract-hardening item and #7/#5 lead.

---

## 2. Known-finding reconciliation

| # | Risk | Status on HEAD | Failure type | Source evidence | User-facing surfaces affected | Existing tests | Recommended fix |
|---|------|---------------|--------------|-----------------|-------------------------------|----------------|-----------------|
| 1 | PLoT→CEE sensitivity sign/direction contract | **STILL TRUE — latent vs live needs runtime proof** | **Correctness** | `source-verified: src/orchestrator/context/analysis-compact.ts:501-507` — `deriveTopDrivers` sets `sensitivityRaw = factor.sensitivity ?? factor.elasticity`, `direction = sensitivityRaw >= 0 ? 'positive' : 'negative'`, and **never reads `factor.direction`**. `source-verified: src/orchestrator-v5/types/sensitivity-contract.md:15-32` — `elasticity` is **unsigned** [0,∞); `direction ∈ {positive,negative,neutral}` is authoritative. Enum honoured **only** in the fallback `source-verified: src/orchestrator-v5/context/analysis-fallback.ts:124-127`. Masked today: staging is documented to emit top-level `enrichment.factor_sensitivity[]`, which `compactAnalysis` ignores → falls to the enum-honouring fallback (`source-verified: src/orchestrator-v5/context/analysis-fallback.ts:207-214`). | explain_results / what_would_flip fallback prose; post-analysis advice gate; decision_review (raw `elasticity`+`direction` passthrough) | `test-verified: tests/contract/sensitivity-sign-contract.test.ts` pins **only** `projectAnalysis` reattachment (feeds a pre-built summary, **bypasses `deriveTopDrivers`**). `test-verified: …/explanation-fallback-direction.test.ts` pins the formatter given a **signed** input. **No test pins `deriveTopDrivers` honouring the enum** → `unknown-needs-follow-up`. | Centralise one direction-resolution rule honouring the enum first; sign-derive only when `direction` absent. Add the missing derive-path contract test. |
| 2 | NaN / Infinity / non-finite probabilities | **FIXED / well-guarded** | Correctness | `source-verified`: ingress numeric-integrity walker (`src/orchestrator-v5/tools/handlers/numeric-integrity.ts`, called `…/run-analysis.ts:535`); `formatProbability`/`formatPercentagePoints`/`formatProbabilityMargin` guard non-finite **and** out-of-range → "Not available" + telemetry (`src/orchestrator-v5/format/format-analysis-value.ts:86-172`); `isProbabilityValid` filter (`…/context-pack-assembler.ts:514`); `isFiniteSensitivity` filter (`:545`); `formatSensitivityDirection` finite guard (`…/format/sensitivity-phrases.ts:41`); `finiteMargin` guard (`…/explanation-fallback.ts:216-219`). | all numeric prose & chips | `test-verified: …/format/__tests__/format-analysis-value.test.ts`; `…/run-analysis.test.ts` ingress cases; `…/explanation-fallback-direction.test.ts` non-finite cases | None. Keep regression tests. |
| 3 | Raw long floats (e.g. `0.4826…`) in copy | **FIXED on traced surfaces / low residual** | Presentation | `source-verified`: `margin_pp` rounded to 1dp (`…/analysis-fallback.ts:277`) and rendered via `formatPercentagePoints`; sensitivities render as **band words**, never the number (`…/format/sensitivity-phrases.ts:40-55`); probabilities via `formatProbability`; LLM-authored free prose has the `numeric-prose-formatter.ts` egress backstop, wired in `src/orchestrator-v5/turn-executor.ts`. Advice-gate numeric helpers all format (`…/post-analysis-advice-gate.ts:1060,1068-1070,1079-1080`). | explain prose; advice gate; chips | `test-verified: …/explanation-fallback-direction.test.ts` "output never contains a raw decimal" invariant; `format-analysis-value.test.ts` | None on traced paths. Confirm `analysis-result-headline` + decision_review at runtime (§7). |
| 4 | Robustness `unknown` silently omitted, not caveated | **STILL TRUE (intentional omission)** | Trust | `source-verified`: when robustness is `unknown`/null the closing robustness sentence is **omitted entirely** (`…/explanation-fallback.ts:283-298`; explain_results emits one only when band is truthy `:144-148`); `isRawFragile(null) === false` (`…/coaching/robustness-honesty.ts`). Honest, but the user is never told confidence is unknown. | explain_results / what_would_flip prose | `test-verified: …/explanation-fallback.test.ts:362-374, 429-443` pin the omission | **Product/UX decision:** keep silent omission, or add one calm caveat (e.g. "how stable this is isn't clear from this run"). Tranche B. |
| 5 | Mixed / unknown direction collapsed to binary | **PARTIAL — `neutral` collapsed (live)** | **Correctness / Trust** | `source-verified`: contract defines `direction: 'neutral'` (`sensitivity-contract.md:16,25`). Sign reattachment `…/context-pack-assembler.ts:548` maps `negative ? -x : x`, so **`neutral` → positive → "strengthens"**; both derive paths drop `neutral` to a sign too. Only mitigation is the near-zero band `|v| < 0.05` (`…/sensitivity-phrases.ts:43`). | explain prose; advice gate | `inferred`: no test feeds `direction:'neutral'` with non-trivial magnitude → `unknown-needs-follow-up` | Render `neutral` as "has little effect / no clear directional effect" regardless of magnitude. Folds into the #1 fix. |
| 6 | Opaque factor/node/edge ID fallback in copy | **FIXED / well-guarded** | Presentation | `source-verified`: `resolveLabelOrFallback` never returns a raw id — generic prefix fallback (`…/compose/resolve-label.ts:206`, `PREFIX_GENERIC` in `src/orchestrator/shared/output-safety.ts`); `isUnsafeLabel` two-tier slug gate (`…/resolve-label.ts:92-112`); Phase 3 blocks fail-closed (drop block on label miss); egress `ENTITY_ID_LEAK_RE` backstop (`…/compose/output-safety.ts`). | chat, chips, cards, validation errors | `test-verified: …/resolve-label.test.ts:98-195`; `…/validation-failure-responses.test.ts:232-620` | None. Keep regression tests. |
| 7 | Internal codes / enum / schema vocab / IDs leak | **PARTIAL — robustness band token leaks** | Presentation | Broadly well-guarded: `humaniseEvidenceType`/`humaniseBiasType`, S-bucket replacements (`…/compose/sanitise-enrichment.ts`), forbidden-phrase scanner, egress sanitiser. **BUT** the canonical token `highly_stable` (underscore) + the jargon "robustness band" are interpolated **raw** at `source-verified: …/explanation-fallback.ts:146`, `…/explanation-fallback.ts:294`, and `…/routing/post-analysis-advice-gate.ts:1131`. Tokens originate at `mapRobustnessToCanonical` (`…/analysis-compact.ts:146-147`). | explain_results / what_would_flip prose; advice-gate lead paragraph | `inferred`: `…/forbidden-user-facing-phrases.test.ts` does not assert against band tokens → `unknown-needs-follow-up` | Humanise the band ("highly stable") and drop the "robustness band is …" framing; route the three sites through one shared phrase map. |

---

## 3. Prioritised implementation tranches

1. **Tranche A — link-safe correctness (direction honesty).** Fix #1 + #5. Honour
   `factor.direction`; handle `neutral`; **introduce the single shared direction-resolution
   helper here** (see §4 — it belongs in Tranche A to prevent the two paths drifting again); add
   the missing contract test on the derive path.
2. **Tranche B — surgical trust / presentation.** Fix #7 (humanise `highly_stable`, remove the
   "robustness band" jargon across the three sites). Decide #4 (calm unknown-robustness caveat vs
   keep silent omission) and implement the chosen behaviour.
3. **Tranche C — contract / DRY hardening.** Only if not fully completed inside Tranche A:
   finish consolidating the shared helper across all three consumers and extend
   `sensitivity-sign-contract.test.ts` to pin the derive-path enum-honouring (not just
   `projectAnalysis` reattachment).
4. **Tranche D — runtime / PLoT proof (blocking on evidence, not code).** Live envelope shape;
   whether #1 is live or latent; the producer-side `factor_sensitivity` vs `decision_brief.top_drivers`
   disagreement; whether per-option `results[].factor_sensitivity` is populated on staging.

---

## 4. Recommended first implementation brief (smallest safe, structural)

**Goal:** close the highest-risk correctness issue — driver direction can be wrong or
direction-blind — with one shared rule, without touching PLoT/DGAI/schemas/prompts.

**Single shared rule (the core of this brief).** Introduce/centralise one
`resolveInfluenceDirection(rawDirection, magnitude)` used consistently by **all** consumers —
no divergent local rules:

- `deriveTopDrivers` — `src/orchestrator/context/analysis-compact.ts:483-538`
- `deriveTopDriversFromTopLevel` — `src/orchestrator-v5/context/analysis-fallback.ts:87-149`
- `projectAnalysis` / sign-reattachment — `src/orchestrator-v5/context/context-pack-assembler.ts:544-551`

The helper **must honour the authoritative enum first**:

- `positive` → strengthens
- `negative` → weakens
- `neutral` → has little effect / no clear directional effect
- **absent direction** → sign-derived fallback **only** when no authoritative enum exists

Place the helper next to the contract doc (`src/orchestrator-v5/types/sensitivity-contract.md`)
so the rule and its documentation live together. This mirrors the prior CQE lesson — share the
rule, never duplicate it locally.

**Reuse (do not reinvent):** `formatSensitivityDirection` + `bandFromMagnitude`
(`format/sensitivity-phrases.ts`, `format/influence-bands.ts`); `formatProbability` /
`formatPercentagePoints` (`format/format-analysis-value.ts`, unchanged); `mapRobustnessToCanonical`
(token source for #7); `resolveLabelOrFallback` (#6, unchanged); the `humanise*` map pattern in
`compose/phase3-blocks.ts` (template for the #7 band humanisation in Tranche B).

**Behaviour to add:** a driver PLoT marks `direction:'negative'` (with unsigned elasticity)
renders "weakens the lead"; `neutral` renders "has little effect on the lead"; `positive` renders
"strengthens"; direction is **never** inferred from the sign of an unsigned magnitude.

**Tests to add/update:** `deriveTopDrivers` unit test feeding `{ elasticity: 0.6, direction:
'negative' }` (no `sensitivity` field) → `DriverSummary.direction === 'negative'` and downstream
`sensitivity_value < 0`; a `neutral` case → "has little effect"; extend
`tests/contract/sensitivity-sign-contract.test.ts` to pin the derive-path enum-honouring;
snapshot regression that positive happy-path prose is unchanged.

**Acceptance criteria:** no factor marked `negative` ever reads "strengthens"; `neutral` never
reads as a directional claim; positive happy-path copy is byte-identical; no new raw
decimals/IDs/tokens introduced.

**Out of scope (this brief):** producer-side disagreement fix (PLoT); #7 band humanisation
(Tranche B); #4 caveat wording (Tranche B); any schema/DGAI/PLoT/ISL/prompt/flag edits.

---

## 5. Test plan

- **Sensitivity direction/sign:** authoritative enum honoured over magnitude; `negative` →
  "weakens"; unsigned-elasticity input does not flip to "strengthens".
- **Non-finite probabilities:** regression — formatters return "Not available" + telemetry.
- **Long-decimal suppression:** regression — no `-?\d+\.\d` in any user prose.
- **Unknown robustness caveat:** Tranche B behaviour test for the chosen #4 outcome.
- **Mixed / `neutral` direction:** renders "has little effect", never a directional verb.
- **Missing-label fallback:** regression — generic phrase, never a raw id/slug.
- **ID leakage:** regression — `ENTITY_ID_LEAK_RE` egress; no entity-id tokens survive.
- **No regression in good happy-path analysis copy:** snapshot the positive, finite, stable case.

---

## 6. UX acceptance criteria (British English, calm, non-technical)

- No raw decimal values unless intentionally formatted (percentages, percentage points, bands).
- No `factor_id` / `node_id` / `edge_id` / UUID-like / internal slug fallback in user copy.
- No enum tokens such as `highly_stable`, and no "robustness band" jargon.
- Uncertainty is clearly caveated without sounding broken or brittle.
- Directionality is correct or explicitly "has little / no clear directional effect".
- Copy stays concise and useful — no excessive caveats, no scary error text.

**Design-system scope (narrow, deferred).** Affected visible surfaces: the explanation prose
(explain_results / what_would_flip chat text) and the analysis lead paragraph produced by the
post-analysis advice gate. Flag these for design-system alignment of the revised copy when
Tranche B lands. This audit does **not** run a token/colour/typography/spacing audit and invents
no styles — that remains the separate design-system workstream.

---

## 7. Runtime proof needed (not optional)

These cannot be proven statically and **must be folded into the existing planned V5 staging trace
work — not run as a separate, unrelated trace.** The trace must capture:

1. Whether live staging uses top-level `factor_sensitivity[]` or per-option
   `results[].factor_sensitivity[]` (`runtime-needed`).
2. Whether the primary-path bug (#1) is **live or latent** as a direct consequence of (1)
   (`runtime-needed`).
3. Any disagreement between `factor_sensitivity` and `decision_brief.top_drivers` direction on the
   same factors (the escalated producer-side inconsistency; `source-verified:
   sensitivity-contract.md:53-71`, `runtime-needed` to confirm current state).
4. Whether affected user-facing surfaces (explain prose, advice-gate lead, decision_review card,
   `analysis-result-headline`) render the **correct** direction and no raw decimals/tokens on a
   real run (`runtime-needed`).

---

## Appendix — read-only commands used

```
git fetch origin; git merge-base --is-ancestor HEAD origin/staging
git diff --stat origin/staging HEAD -- <cited files>            # confirmed identical
grep -n "sensitivity_value|direction|robustness|elasticity|flip_value" src/orchestrator/context/analysis-compact.ts
grep -rn "robustness band is" src/orchestrator-v5                 # 3 leak sites
grep -rln "resolveLabelOrFallback|isUnsafeLabel" src/orchestrator-v5/compose/resolve-label.ts
# plus targeted Read of: analysis-fallback.ts, context-pack-assembler.ts, explanation-fallback.ts,
# projection-summaries.ts, sensitivity-phrases.ts, format-analysis-value.ts, post-analysis-advice-gate.ts,
# sensitivity-contract.md, sensitivity-sign-contract.test.ts, explanation-fallback-direction.test.ts
```
